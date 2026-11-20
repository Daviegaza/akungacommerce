-- Seller verification + buyer-visible proof, customer list portability with
-- consent-based re-engagement. Additive only. Rules mirror src/domain/trust.ts
-- and src/domain/marketing.ts.
--
-- * Verification is DERIVED on the server, never typed in by the merchant:
--     phone      = an owner/admin's Supabase Auth phone is confirmed (OTP) and equals the shop's WhatsApp number
--     M-Pesa name = a service-role record of the name M-Pesa reports for the shop's Till/Paybill
--                   matches the registered name (normalised)
--     documents  = uploaded to a private bucket, then approved by a platform admin (platform_admins)
-- * Buyers can report a shop anonymously (rate-limited); reports are visible to platform admins only.
-- * Marketing consent: customers.consent_updated_at / consent_source are maintained by a trigger, so a
--   timestamp only moves when consent actually changes. Marketing chats are logged and refused for
--   customers who did not agree, or who were messaged in the last 7 days.

-- ───────────────────────── Platform admins ─────────────────────────
-- Rafu staff who review documents and reports. Rows are added by an operator with SQL / service role only.
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security; -- no policies: definer functions only
revoke all on public.platform_admins from anon, authenticated;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function public._require_platform_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not public.is_platform_admin() then
    raise exception 'Only Rafu reviewers can do this' using errcode = '42501';
  end if;
end $$;

-- ───────────────────────── Customers: consent provenance ─────────────────────────
alter table public.customers
  add column consent_source text check (consent_source is null or consent_source in ('checkout', 'staff', 'stop_reply', 'buyer_link', 'system'));

-- The timestamp and source move only when marketing_consent really changes. Definer functions name the
-- source with set_config('akunga.consent_source', ..., true); otherwise anonymous = checkout, signed-in = staff.
create or replace function public._customer_consent_stamp() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_src text := coalesce(nullif(current_setting('akunga.consent_source', true), ''),
                         case when auth.uid() is null then 'checkout' else 'staff' end);
begin
  if tg_op = 'INSERT' then
    if new.marketing_consent then
      new.consent_updated_at := now();
      new.consent_source := v_src;
    else
      new.consent_updated_at := null;
      new.consent_source := null;
    end if;
  elsif new.marketing_consent is distinct from old.marketing_consent then
    new.consent_updated_at := now();
    new.consent_source := v_src;
  else
    new.consent_updated_at := old.consent_updated_at;
    new.consent_source := old.consent_source;
  end if;
  return new;
end $$;
create trigger customers_consent_stamp before insert or update on public.customers
  for each row execute function public._customer_consent_stamp();

-- ───────────────────────── M-Pesa business names (verified records) ─────────────────────────
-- Filled only by service-role code from a verified M-Pesa response (e.g. a Daraja transaction-status
-- result's CreditPartyName for the shop's own shortcode). Typing a name in shop settings proves nothing.
create table public.mpesa_business_names (
  org_id uuid not null references public.organisations(id) on delete cascade,
  shortcode text not null check (shortcode ~ '^[0-9]{5,8}$'),
  name text not null check (length(trim(name)) between 2 and 120),
  source text not null check (source in ('daraja_status', 'daraja_c2b', 'aggregator')),
  observed_at timestamptz not null default now(),
  primary key (org_id, shortcode)
);
alter table public.mpesa_business_names enable row level security;
create policy mpesa_business_names_read on public.mpesa_business_names for select using (public.is_member(org_id));
revoke all on public.mpesa_business_names from anon, authenticated;
grant select on public.mpesa_business_names to authenticated;

-- Same normalisation as normaliseBusinessName() in src/domain/trust.ts (ASCII names; M-Pesa names are ASCII).
create or replace function public._normalise_business_name(p_name text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              replace(regexp_replace(upper(btrim(coalesce(p_name, ''))), '^[0-9]{5,8}\s*-\s*', ''), '&', ' AND '),
              '[^A-Z0-9]+', ' ', 'g'),
            '\m(LTD|LIMITED)\M', 'LIMITED', 'g'),
          '\m(ENTERPRISES|ENTERPRISE|ENT)\M', 'ENTERPRISE', 'g'),
        '\m(CO|COMPANY)\M', 'COMPANY', 'g'),
      '^\s+|\s+$', '', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Service role: record the name M-Pesa reported for a shortcode. The shortcode must belong to exactly one
-- business that collects through a verified Daraja connection (same rule as reconcile_mpesa_c2b).
create or replace function public.record_mpesa_business_name(p_shortcode text, p_name text, p_source text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_count integer;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '^[0-9]{5,8}\s*-\s*', ''));
begin
  if p_source not in ('daraja_status', 'daraja_c2b', 'aggregator') then return jsonb_build_object('outcome', 'invalid'); end if;
  if coalesce(p_shortcode, '') !~ '^[0-9]{5,8}$' or length(v_name) < 2 or length(v_name) > 120 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  select count(*), min(s.org_id::text)::uuid into v_count, v_org
    from public.shop_settings s
    join public.integration_connections c on c.org_id = s.org_id and c.provider = 'mpesa' and c.state = 'connected_verified'
   where s.collections_provider = 'daraja' and (s.mpesa_till = p_shortcode or s.mpesa_paybill = p_shortcode);
  if v_count <> 1 then return jsonb_build_object('outcome', 'unknown_shortcode'); end if;
  insert into public.mpesa_business_names (org_id, shortcode, name, source, observed_at)
  values (v_org, p_shortcode, v_name, p_source, now())
  on conflict (org_id, shortcode) do update set name = excluded.name, source = excluded.source, observed_at = excluded.observed_at;
  return jsonb_build_object('outcome', 'recorded', 'org_id', v_org);
end $$;

-- ───────────────────────── Business documents ─────────────────────────
create table public.shop_verifications (
  org_id uuid primary key references public.organisations(id) on delete cascade,
  documents_status text not null default 'none' check (documents_status in ('none', 'submitted', 'approved', 'rejected')),
  document_kind text check (document_kind is null or document_kind in ('business_registration', 'business_permit', 'kra_pin', 'national_id')),
  document_paths text[] not null default '{}' check (cardinality(document_paths) <= 5),
  submitted_at timestamptz,
  submitted_by uuid,
  reviewed_at timestamptz,
  reviewed_by uuid,
  rejection_reason text check (rejection_reason is null or length(rejection_reason) <= 500),
  updated_at timestamptz not null default now(),
  check (documents_status <> 'rejected' or rejection_reason is not null)
);
alter table public.shop_verifications enable row level security;
create policy shop_verifications_read on public.shop_verifications for select using (public.is_member(org_id));
revoke all on public.shop_verifications from anon, authenticated;
grant select on public.shop_verifications to authenticated;
create trigger shop_verifications_touch before update on public.shop_verifications for each row execute function public.touch_updated_at();
create trigger audit_shop_verifications after insert or update on public.shop_verifications for each row execute function public.write_audit();

-- Private bucket: "<org_id>/<random>.<ext>". Owners/admins of that org upload and read; platform admins read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-docs', 'verification-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.can_manage_verification_file(p_name text)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select case
    when (storage.foldername(p_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.has_permission(((storage.foldername(p_name))[1])::uuid, 'org.manage')
    else false
  end
$$;
revoke all on function public.can_manage_verification_file(text) from public, anon;
grant execute on function public.can_manage_verification_file(text) to authenticated;

create policy verification_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'verification-docs' and public.can_manage_verification_file(name));
create policy verification_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'verification-docs' and (public.can_manage_verification_file(name) or public.is_platform_admin()));

create or replace function public.submit_verification_documents(p_org uuid, p_kind text, p_paths text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_path text;
begin
  perform public.require_permission(p_org, 'org.manage');
  if p_kind is null or p_kind not in ('business_registration', 'business_permit', 'kra_pin', 'national_id') then
    raise exception 'Choose which document this is' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_paths), 0) = 0 or cardinality(p_paths) > 5 then
    raise exception 'Upload between 1 and 5 files' using errcode = '22023';
  end if;
  foreach v_path in array p_paths loop
    if v_path !~ ('^' || p_org::text || '/[A-Za-z0-9._-]{1,120}$') then
      raise exception 'Documents must be uploaded to this business''s own folder' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'verification-docs' and name = v_path) then
      raise exception 'A document upload did not finish. Upload it again.' using errcode = 'P0002';
    end if;
  end loop;
  insert into public.shop_verifications (org_id, documents_status, document_kind, document_paths, submitted_at, submitted_by)
  values (p_org, 'submitted', p_kind, p_paths, now(), auth.uid())
  on conflict (org_id) do update set
    documents_status = 'submitted', document_kind = excluded.document_kind, document_paths = excluded.document_paths,
    submitted_at = excluded.submitted_at, submitted_by = excluded.submitted_by,
    reviewed_at = null, reviewed_by = null, rejection_reason = null;
end $$;

create or replace function public.review_verification_documents(p_org uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.shop_verifications;
begin
  perform public._require_platform_admin();
  if p_decision not in ('approved', 'rejected') then raise exception 'Approve or reject' using errcode = '22023'; end if;
  if p_decision = 'rejected' and length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say why, so the business can fix it' using errcode = '22023';
  end if;
  select * into v_row from public.shop_verifications where org_id = p_org for update;
  if v_row.org_id is null or v_row.documents_status <> 'submitted' then
    raise exception 'Nothing is waiting for review for this business' using errcode = '22023';
  end if;
  update public.shop_verifications
     set documents_status = p_decision, reviewed_at = now(), reviewed_by = auth.uid(),
         rejection_reason = case when p_decision = 'rejected' then left(btrim(p_reason), 500) end
   where org_id = p_org;
end $$;

create or replace function public.admin_verification_queue()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('org_id', v.org_id, 'business_name', o.name, 'slug', s.slug, 'kind', v.document_kind,
             'submitted_at', v.submitted_at, 'paths', to_jsonb(v.document_paths)) order by v.submitted_at)
      from public.shop_verifications v
      join public.organisations o on o.id = v.org_id
      left join public.shop_settings s on s.org_id = v.org_id
     where v.documents_status = 'submitted'), '[]'::jsonb);
end $$;

-- ───────────────────────── Derived trust facts ─────────────────────────
-- Internal: everything the server knows about one business's trust signals.
create or replace function public._shop_trust(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_shop public.shop_settings;
  v_org public.organisations;
  v_ver public.shop_verifications;
  v_name public.mpesa_business_names;
  v_phone boolean := false;
  v_digits text;
  v_delivered integer;
begin
  select * into v_shop from public.shop_settings where org_id = p_org;
  select * into v_org from public.organisations where id = p_org;
  select * into v_ver from public.shop_verifications where org_id = p_org;
  v_digits := regexp_replace(coalesce(v_shop.whatsapp_e164, ''), '[^0-9]', '', 'g');
  if length(v_digits) >= 7 then
    select exists (
      select 1 from public.memberships m join auth.users u on u.id = m.user_id
       where m.org_id = p_org and m.role in ('owner', 'admin') and u.phone_confirmed_at is not null
         and regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = v_digits) into v_phone;
  end if;
  select * into v_name from public.mpesa_business_names
   where org_id = p_org and shortcode in (v_shop.mpesa_till, v_shop.mpesa_paybill)
   order by observed_at desc limit 1;
  select count(*) into v_delivered from public.orders where org_id = p_org and status = 'delivered';
  return jsonb_build_object(
    'phone_verified', v_phone,
    'shop_phone', v_shop.whatsapp_e164,
    'reported_name', v_name.name,
    'reported_at', v_name.observed_at,
    'registered_name', v_shop.registered_name,
    'name_matched', v_name.name is not null and length(public._normalise_business_name(v_name.name)) >= 2
                    and public._normalise_business_name(v_name.name) = public._normalise_business_name(v_shop.registered_name),
    'documents_status', coalesce(v_ver.documents_status, 'none'),
    'document_kind', v_ver.document_kind,
    'document_count', coalesce(cardinality(v_ver.document_paths), 0),
    'submitted_at', v_ver.submitted_at,
    'reviewed_at', v_ver.reviewed_at,
    'rejection_reason', v_ver.rejection_reason,
    'on_rafu_since', v_org.created_at,
    'delivered_orders', v_delivered
  );
end $$;

-- Merchant view of their own verification.
create or replace function public.get_shop_verification(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(p_org) then raise exception 'Business not found' using errcode = 'P0002'; end if;
  return public._shop_trust(p_org) - 'delivered_orders' - 'on_rafu_since';
end $$;

-- Public trust facts for a published shop. Only earned badges; counts hidden below 5.
create or replace function public.storefront_trust(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_shop public.shop_settings;
  v_t jsonb;
begin
  v_shop := public._shop_by_slug(p_slug);
  if v_shop.org_id is null then raise exception 'Shop not found' using errcode = 'P0002'; end if;
  v_t := public._shop_trust(v_shop.org_id);
  return jsonb_build_object(
    'phone_verified', (v_t ->> 'phone_verified')::boolean,
    'mpesa_name', case when (v_t ->> 'name_matched')::boolean then v_t ->> 'reported_name' end,
    'documents_approved', v_t ->> 'documents_status' = 'approved',
    'on_rafu_since', v_t -> 'on_rafu_since',
    'completed_orders', case when (v_t ->> 'delivered_orders')::integer >= 5 then (v_t ->> 'delivered_orders')::integer end
  );
end $$;

-- ───────────────────────── Shop reports (anonymous) ─────────────────────────
create table public.shop_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  reason text not null check (reason in ('not_delivered', 'not_as_described', 'off_platform_payment', 'fake_shop', 'prohibited_items', 'other')),
  details text check (details is null or length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index shop_reports_status_idx on public.shop_reports(status, created_at desc);
alter table public.shop_reports enable row level security; -- no policies: reviewers read through definer functions
revoke all on public.shop_reports from anon, authenticated;

-- No reporter identity is stored. Rate limits key on a hash of the client IP (the raw IP is not kept).
create or replace function public.storefront_report_shop(p_slug text, p_reason text, p_details text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_shop public.shop_settings;
  v_ip text := md5(public._client_ip());
  v_details text := nullif(left(btrim(coalesce(p_details, '')), 1000), '');
begin
  v_shop := public._shop_by_slug(p_slug);
  if v_shop.org_id is null then raise exception 'Shop not found' using errcode = 'P0002'; end if;
  if p_reason is null or p_reason not in ('not_delivered', 'not_as_described', 'off_platform_payment', 'fake_shop', 'prohibited_items', 'other') then
    raise exception 'Choose what went wrong' using errcode = '22023';
  end if;
  if p_reason = 'other' and v_details is null then raise exception 'Tell us briefly what happened' using errcode = '22023'; end if;
  perform public._rate_limit('sf:report:ip:' || v_ip, 5, interval '1 hour');
  perform public._rate_limit('sf:report:' || v_shop.org_id || ':' || v_ip, 2, interval '1 day');
  perform public._rate_limit('sf:report:shop:' || v_shop.org_id, 100, interval '1 day');
  insert into public.shop_reports (org_id, reason, details) values (v_shop.org_id, p_reason, v_details);
end $$;

create or replace function public.admin_shop_reports(p_status text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'org_id', r.org_id, 'business_name', o.name, 'slug', s.slug, 'reason', r.reason,
             'details', r.details, 'status', r.status, 'created_at', r.created_at) order by r.created_at desc)
      from (select * from public.shop_reports where p_status is null or status = p_status order by created_at desc limit 200) r
      join public.organisations o on o.id = r.org_id
      left join public.shop_settings s on s.org_id = r.org_id), '[]'::jsonb);
end $$;

create or replace function public.resolve_shop_report(p_report uuid, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_platform_admin();
  if p_status not in ('reviewed', 'dismissed') then raise exception 'Mark it reviewed or dismissed' using errcode = '22023'; end if;
  update public.shop_reports set status = p_status, reviewed_by = auth.uid(), reviewed_at = now() where id = p_report and status = 'open';
  if not found then raise exception 'Report not found or already handled' using errcode = 'P0002'; end if;
end $$;

-- ───────────────────────── Buyer payment receipts ─────────────────────────
create or replace function public._mask_receipt(p_code text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when length(c) <= 5 then repeat('•', length(c)) else left(c, 3) || repeat('•', length(c) - 5) || right(c, 2) end
    from (select upper(btrim(coalesce(p_code, ''))) as c) x
$$;

-- Provider-verified payments only (manual entries are never shown as a receipt).
create or replace function public.storefront_payment_receipts(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders;
  v_t jsonb;
  v_name text;
  v_verified boolean;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select * into v_o from public.orders where tracking_token = p_token;
  if v_o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  v_t := public._shop_trust(v_o.org_id);
  v_verified := v_t ->> 'reported_name' is not null;
  v_name := coalesce(v_t ->> 'reported_name', v_t ->> 'registered_name');
  return coalesce((
    select jsonb_agg(jsonb_build_object('amount_minor', p.amount_minor, 'currency', p.currency, 'receipt_masked', public._mask_receipt(p.external_ref),
             'paid_at', p.received_at, 'paid_to_name', v_name, 'paid_to_verified', v_verified) order by p.received_at)
      from (select * from public.payments
             where order_id = v_o.id and status = 'succeeded' and verification = 'provider_verified' and external_ref is not null
             order by received_at desc limit 5) p), '[]'::jsonb);
end $$;

-- The buyer stops marketing from this shop (every customer record with the order's phone number).
create or replace function public.storefront_marketing_opt_out(p_token text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders;
  v_phone text;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform public._rate_limit('sf:optout:' || md5(p_token), 10, interval '1 hour');
  select * into v_o from public.orders where tracking_token = p_token;
  if v_o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select phone_e164 into v_phone from public.customers where id = v_o.customer_id;
  perform set_config('akunga.consent_source', 'buyer_link', true);
  update public.customers set marketing_consent = false
   where org_id = v_o.org_id and marketing_consent
     and (id = v_o.customer_id or (v_phone is not null and phone_e164 = v_phone));
  perform set_config('akunga.consent_source', '', true);
end $$;

-- ───────────────────────── Customer export ─────────────────────────
-- Mirrors canExportCustomers() in src/domain/marketing.ts.
create or replace function public._can_export_customers(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.member_role_in(p_org) in ('owner', 'admin', 'manager'), false)
$$;

create or replace function public.export_customers(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not public._can_export_customers(p_org) then
    raise exception 'Only owners, admins and managers can export the customer list' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'phone_e164', c.phone_e164, 'email', c.email,
           'order_count', coalesce(st.order_count, 0), 'last_order_at', st.last_order_at, 'spent', coalesce(st.spent, '[]'::jsonb),
           'marketing_consent', c.marketing_consent, 'consent_updated_at', c.consent_updated_at, 'consent_source', c.consent_source,
           'created_at', c.created_at) order by c.name), '[]'::jsonb)
    into v_rows
    from public.customers c
    left join lateral (
      select sum(t.n)::integer as order_count, max(t.last_at) as last_order_at,
             jsonb_agg(jsonb_build_object('currency', t.currency, 'total_minor', t.total) order by t.total desc) as spent
        from (select o.currency, count(*) as n, sum(o.total_minor) as total, max(o.created_at) as last_at
                from public.orders o
               where o.org_id = p_org and o.customer_id = c.id and o.status not in ('draft', 'cancelled')
               group by o.currency) t
    ) st on true
   where c.org_id = p_org;
  insert into public.audit_log (org_id, actor_id, entity, entity_id, action, after)
  values (p_org, auth.uid(), 'customers', 'export', 'export', jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return v_rows;
end $$;

-- ───────────────────────── Consent & re-engagement ─────────────────────────
create or replace function public.opt_out_customer(p_org uuid, p_customer uuid, p_how text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission(p_org, 'customers.write');
  if p_how not in ('stop_reply', 'staff') then raise exception 'Say how the customer opted out' using errcode = '22023'; end if;
  perform set_config('akunga.consent_source', p_how, true);
  update public.customers set marketing_consent = false where id = p_customer and org_id = p_org;
  if not found then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  perform set_config('akunga.consent_source', '', true);
end $$;

create table public.marketing_contacts (
  id bigserial primary key,
  org_id uuid not null references public.organisations(id) on delete cascade,
  customer_id uuid not null,
  segment text not null check (segment in ('recent', 'lapsed', 'top')),
  contacted_by uuid,
  contacted_at timestamptz not null default now(),
  foreign key (customer_id, org_id) references public.customers(id, org_id) on delete cascade
);
create index marketing_contacts_customer_idx on public.marketing_contacts(org_id, customer_id, contacted_at desc);
alter table public.marketing_contacts enable row level security;
create policy marketing_contacts_read on public.marketing_contacts for select using (public.is_member(org_id));
revoke all on public.marketing_contacts from anon, authenticated;
grant select on public.marketing_contacts to authenticated;

-- One-at-a-time click-to-chat: logs the contact and returns the phone. Refused without consent or within 7 days.
create or replace function public.start_marketing_chat(p_org uuid, p_customer uuid, p_segment text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_c public.customers;
  v_last timestamptz;
begin
  perform public.require_permission(p_org, 'customers.write');
  if p_segment is null or p_segment not in ('recent', 'lapsed', 'top') then raise exception 'Unknown customer group' using errcode = '22023'; end if;
  select * into v_c from public.customers where id = p_customer and org_id = p_org for update;
  if v_c.id is null then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  if not v_c.marketing_consent then
    raise exception 'This customer has not agreed to offers. You can still message them about their own orders.' using errcode = '42501';
  end if;
  if v_c.phone_e164 is null then raise exception 'This customer has no phone number' using errcode = '22023'; end if;
  select max(contacted_at) into v_last from public.marketing_contacts where org_id = p_org and customer_id = p_customer;
  if v_last is not null and v_last > now() - interval '7 days' then
    raise exception 'You sent this customer an offer in the last 7 days. Wait a week between offers.' using errcode = '54000';
  end if;
  insert into public.marketing_contacts (org_id, customer_id, segment, contacted_by) values (p_org, p_customer, p_segment, auth.uid());
  return v_c.phone_e164;
end $$;

-- ───────────────────────── Privileges ─────────────────────────
-- New functions are executable by PUBLIC (and anon via Supabase default privileges) unless revoked.
revoke execute on function public.is_platform_admin() from public, anon;
revoke execute on function public._require_platform_admin() from public, anon, authenticated;
revoke execute on function public._customer_consent_stamp() from public, anon, authenticated;
revoke execute on function public._normalise_business_name(text) from public, anon;
revoke execute on function public.record_mpesa_business_name(text, text, text) from public, anon, authenticated;
revoke execute on function public.submit_verification_documents(uuid, text, text[]) from public, anon;
revoke execute on function public.review_verification_documents(uuid, text, text) from public, anon;
revoke execute on function public.admin_verification_queue() from public, anon;
revoke execute on function public._shop_trust(uuid) from public, anon, authenticated;
revoke execute on function public.get_shop_verification(uuid) from public, anon;
revoke execute on function public.storefront_trust(text) from public;
revoke execute on function public.storefront_report_shop(text, text, text) from public;
revoke execute on function public.admin_shop_reports(text) from public, anon;
revoke execute on function public.resolve_shop_report(uuid, text) from public, anon;
revoke execute on function public._mask_receipt(text) from public, anon;
revoke execute on function public.storefront_payment_receipts(text) from public;
revoke execute on function public.storefront_marketing_opt_out(text) from public;
revoke execute on function public._can_export_customers(uuid) from public, anon;
revoke execute on function public.export_customers(uuid) from public, anon;
revoke execute on function public.opt_out_customer(uuid, uuid, text) from public, anon;
revoke execute on function public.start_marketing_chat(uuid, uuid, text) from public, anon;

grant execute on function public.is_platform_admin() to authenticated, service_role;
grant execute on function public._normalise_business_name(text) to authenticated, service_role;
grant execute on function public.record_mpesa_business_name(text, text, text) to service_role;
grant execute on function public.submit_verification_documents(uuid, text, text[]) to authenticated, service_role;
grant execute on function public.review_verification_documents(uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_verification_queue() to authenticated, service_role;
grant execute on function public._shop_trust(uuid) to service_role;
grant execute on function public.get_shop_verification(uuid) to authenticated, service_role;
grant execute on function public.storefront_trust(text) to anon, authenticated, service_role;
grant execute on function public.storefront_report_shop(text, text, text) to anon, authenticated, service_role;
grant execute on function public.admin_shop_reports(text) to authenticated, service_role;
grant execute on function public.resolve_shop_report(uuid, text) to authenticated, service_role;
grant execute on function public._mask_receipt(text) to authenticated, service_role;
grant execute on function public.storefront_payment_receipts(text) to anon, authenticated, service_role;
grant execute on function public.storefront_marketing_opt_out(text) to anon, authenticated, service_role;
grant execute on function public._can_export_customers(uuid) to authenticated, service_role;
grant execute on function public.export_customers(uuid) to authenticated, service_role;
grant execute on function public.opt_out_customer(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.start_marketing_chat(uuid, uuid, text) to authenticated, service_role;
