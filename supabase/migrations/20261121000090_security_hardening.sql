-- Security hardening from the independent audit (2026-11-21). Additive; no data is removed.
--
--  1. _client_ip() trusted the FIRST x-forwarded-for entry, which the client controls. It now uses
--     the LAST entry: the address appended by the gateway in front of PostgREST.
--  2. rate_limits grew without bound: prune_rate_limits() (service role, for a scheduled run).
--  3. Anonymous checkout could hold stock forever with unpaid orders:
--       - at most 3 open unpaid storefront orders per phone per shop;
--       - cancel_stale_storefront_orders() (service role) cancels unpaid, unconfirmed storefront
--         orders after a time limit, which releases their stock.
--  4. Checkout can pass expected_total_minor; if the server total differs (price changed between
--     quote and order) the order is refused and nothing is created.
--  5. An unauthenticated checkout could switch marketing back on for a customer who had opted out
--     (by STOP, a staff action or the buyer link). Only the customer or staff can do that now.
--  6. Rider links stayed usable after an order was delivered or cancelled: they are revoked then.
--  7. Staff could record a manual payment larger than the balance due: refused now.
--  8. Email invitations can only be accepted by an account whose email address is confirmed.
--  9. (Not changed: a Till/Paybill shared by two shops already fails safe; C2B refuses to match it.)
-- 10. Outbound messages: send-message must name a customer; every attempt is logged and limited
--     per organisation and per user before any provider is called.

-- ───────────────────────── 1. Client IP ─────────────────────────
create or replace function public._client_ip() returns text language sql stable as $$
  select coalesce(
    nullif(trim(regexp_replace(
      coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
      '^.*,', '')), ''),
    'unknown')
$$;

-- ───────────────────────── 2. Rate-limit pruning ─────────────────────────
create or replace function public.prune_rate_limits(p_older_than interval default interval '2 days')
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  delete from public.rate_limits where window_start < now() - greatest(p_older_than, interval '1 hour');
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ───────────────────────── 3 + 4. Checkout guards ─────────────────────────
create or replace function public.storefront_place_order(p_slug text, p_input jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_result jsonb;
  v_org uuid;
  v_phone text := nullif(trim(coalesce(p_input ->> 'phone_e164', '')), '');
  v_open integer;
  v_expected bigint;
begin
  select org_id into v_org from public.shop_settings where slug = lower(coalesce(p_slug, '')) and published;

  -- A retry with the same idempotency key must still return the original order, so the cap only
  -- applies to keys that have not been used for this shop.
  if v_org is not null and v_phone is not null and not exists (
    select 1 from public.orders where org_id = v_org and idempotency_key = 'sf:' || p_idempotency_key
  ) then
    select count(*) into v_open
      from public.orders o join public.customers c on c.id = o.customer_id and c.org_id = o.org_id
     where o.org_id = v_org and c.phone_e164 = v_phone and o.status = 'pending_confirmation'
       and o.tracking_token is not null and public._order_net_paid(o.id) = 0;
    if v_open >= 3 then
      raise exception 'You already have 3 orders waiting for this shop. Pay for one, or wait for the shop to confirm it, before ordering again.'
        using errcode = '54000';
    end if;
  end if;

  perform set_config('akunga.consent_source', 'checkout', true);
  v_result := public._storefront_place_order_core(p_slug, p_input, p_idempotency_key);
  perform set_config('akunga.consent_source', '', true);

  if p_input ? 'expected_total_minor' and jsonb_typeof(p_input -> 'expected_total_minor') = 'number' then
    v_expected := (p_input ->> 'expected_total_minor')::bigint;
    if v_expected <> (v_result ->> 'total_minor')::bigint then
      -- Raising rolls back the whole call: no order, no reservation.
      raise exception 'The total changed to % while you were checking out. Review your order and try again.',
        (v_result ->> 'total_minor') using errcode = '40001';
    end if;
  end if;
  return v_result;
end $$;
revoke execute on function public.storefront_place_order(text, jsonb, text) from public;
grant execute on function public.storefront_place_order(text, jsonb, text) to anon, authenticated, service_role;

create or replace function public.cancel_stale_storefront_orders(
  p_older_than interval default interval '24 hours', p_limit integer default 200
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in
    select o.id from public.orders o
     where o.status = 'pending_confirmation' and o.tracking_token is not null and o.created_by is null
       and o.created_at < now() - greatest(p_older_than, interval '1 hour')
       and public._order_net_paid(o.id) = 0
       -- never while an M-Pesa prompt may still be answered
       and not exists (select 1 from public.mpesa_requests r where r.order_id = o.id and r.status = 'pending'
                         and r.created_at > now() - interval '30 minutes')
     order by o.created_at
     limit least(greatest(coalesce(p_limit, 200), 1), 1000)
     for update skip locked
  loop
    perform public._transition_order_core(v_id, 'cancelled',
      'Not paid or confirmed in time; cancelled automatically and stock released');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ───────────────────────── 5. Consent cannot be forged back on ─────────────────────────
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
    -- An anonymous checkout proves nothing about who owns the phone number, so it may not undo an
    -- explicit opt-out. The customer (buyer link / reply) or staff can.
    if new.marketing_consent and not old.marketing_consent and v_src = 'checkout'
       and old.consent_source in ('stop_reply', 'staff', 'buyer_link') then
      new.marketing_consent := false;
      new.consent_updated_at := old.consent_updated_at;
      new.consent_source := old.consent_source;
    else
      new.consent_updated_at := now();
      new.consent_source := v_src;
    end if;
  else
    new.consent_updated_at := old.consent_updated_at;
    new.consent_source := old.consent_source;
  end if;
  return new;
end $$;

-- ───────────────────────── 6. Rider links end with the order ─────────────────────────
create or replace function public._revoke_rider_links_on_close() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.rider_links set revoked_at = now()
   where order_id = new.id and org_id = new.org_id and revoked_at is null;
  return new;
end $$;
create trigger orders_revoke_rider_links
  after update of status on public.orders
  for each row when (new.status in ('delivered', 'cancelled', 'refunded') and old.status is distinct from new.status)
  execute function public._revoke_rider_links_on_close();

-- ───────────────────────── 7. Manual payments within the balance ─────────────────────────
create or replace function public.record_manual_payment(
  p_order uuid, p_amount_minor bigint, p_currency text, p_method text,
  p_external_ref text, p_received_at timestamptz, p_note text, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders;
  v_id uuid;
  v_due bigint;
begin
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null or not public.is_member(v_order.org_id) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_order.org_id, 'payments.record');
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'Missing idempotency key' using errcode = '22023'; end if;
  select id into v_id from public.payments where org_id = v_order.org_id and idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;
  if v_order.status in ('draft', 'cancelled') then
    raise exception 'Payments cannot be recorded on a % order', v_order.status using errcode = '22023';
  end if;
  if upper(p_currency) <> v_order.currency then
    raise exception 'This order is in %; a % payment must be recorded separately after conversion', v_order.currency, upper(p_currency)
      using errcode = '22023';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Amount must be positive' using errcode = '22023'; end if;
  if p_received_at > now() + interval '5 minutes' then raise exception 'Payment date cannot be in the future' using errcode = '22023'; end if;
  v_due := public._order_outstanding(p_order);
  if p_amount_minor > v_due then
    raise exception 'This is more than the balance due (% minor units). Record only what was received for this order.', greatest(v_due, 0)
      using errcode = '22023';
  end if;

  insert into public.payments (org_id, order_id, provider, method, amount_minor, currency, status, verification,
    external_ref, note, received_at, idempotency_key)
  values (v_order.org_id, p_order, 'manual', p_method, p_amount_minor, v_order.currency, 'succeeded', 'manual_unverified',
    nullif(trim(coalesce(p_external_ref, '')), ''), nullif(trim(coalesce(p_note, '')), ''), coalesce(p_received_at, now()), p_idempotency_key)
  returning id into v_id;
  return v_id;
end $$;

-- ───────────────────────── 8. Invitations need a confirmed email ─────────────────────────
create or replace function public.accept_team_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.team_invites;
  v_email text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in to accept the invitation' using errcode = '28000'; end if;
  if p_token is null or length(p_token) < 30 or length(p_token) > 100 then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  perform public._rate_limit('invite:accept:' || auth.uid()::text, 20, interval '10 minutes');
  select * into v_row from public.team_invites where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if v_row.id is null then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  if v_row.status <> 'pending' then raise exception 'This invitation was already used or revoked' using errcode = '22023'; end if;
  if v_row.expires_at <= now() then raise exception 'This invitation has expired. Ask for a new one.' using errcode = '22023'; end if;
  select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  if v_row.email is not null then
    if v_row.email <> coalesce(v_email, '') then
      raise exception 'This invitation was sent to a different email address. Sign in with that address.' using errcode = '42501';
    end if;
    if v_confirmed is null then
      raise exception 'Confirm your email address first, then open the invitation again.' using errcode = '42501';
    end if;
  end if;
  if exists (select 1 from public.memberships where org_id = v_row.org_id and user_id = auth.uid()) then
    update public.team_invites set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = v_row.id;
    return v_row.org_id; -- already a member: keep the existing role
  end if;
  insert into public.memberships (org_id, user_id, role, email, display_name)
  values (v_row.org_id, auth.uid(), v_row.role, v_email, split_part(coalesce(v_email, 'Member'), '@', 1));
  update public.team_invites set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = v_row.id;
  return v_row.org_id;
end $$;

-- ───────────────────────── 10. Outbound message log and limits ─────────────────────────
create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  customer_id uuid not null,
  channel text not null check (channel in ('whatsapp', 'email', 'sms')),
  purpose text not null check (purpose in ('transactional', 'marketing')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'not_configured', 'refused')),
  provider_ref text check (provider_ref is null or length(provider_ref) <= 200),
  error text check (error is null or length(error) <= 300),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (customer_id, org_id) references public.customers(id, org_id) on delete cascade
);
create index outbound_messages_org_idx on public.outbound_messages (org_id, created_at desc);
alter table public.outbound_messages enable row level security;
create policy outbound_messages_read on public.outbound_messages for select using (public.has_permission(org_id, 'customers.write'));
revoke all on public.outbound_messages from anon, authenticated;
grant select on public.outbound_messages to authenticated;

-- Called by send-message as the signed-in user BEFORE any provider call. Checks permission,
-- consent for marketing, and limits; returns the log id and the recipient from the database.
create or replace function public.begin_outbound_message(p_org uuid, p_customer uuid, p_channel text, p_purpose text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_c public.customers;
  v_to text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  perform public.require_permission(p_org, 'orders.create');
  if p_channel not in ('whatsapp', 'email', 'sms') then raise exception 'Unknown channel' using errcode = '22023'; end if;
  if p_purpose not in ('transactional', 'marketing') then raise exception 'Unknown purpose' using errcode = '22023'; end if;
  select * into v_c from public.customers where id = p_customer and org_id = p_org;
  if v_c.id is null then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  if p_purpose = 'marketing' and not v_c.marketing_consent then
    raise exception 'This customer has not agreed to marketing messages' using errcode = '42501';
  end if;
  v_to := case when p_channel = 'email' then v_c.email else v_c.phone_e164 end;
  if v_to is null then raise exception 'This customer has no % on file', case when p_channel = 'email' then 'email address' else 'phone number' end
    using errcode = '22023'; end if;
  perform public._rate_limit('msg:org:' || p_org, 300, interval '1 hour');
  perform public._rate_limit('msg:user:' || auth.uid(), 100, interval '1 hour');
  perform public._rate_limit('msg:cust:' || p_customer, 10, interval '1 hour');
  insert into public.outbound_messages (org_id, customer_id, channel, purpose)
  values (p_org, p_customer, p_channel, p_purpose) returning id into v_id;
  return jsonb_build_object('id', v_id, 'to', v_to);
end $$;

create or replace function public.finish_outbound_message(p_id uuid, p_status text, p_provider_ref text, p_error text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('sent', 'failed', 'not_configured', 'refused') then raise exception 'Unknown status' using errcode = '22023'; end if;
  update public.outbound_messages
     set status = p_status, provider_ref = left(p_provider_ref, 200), error = left(p_error, 300), finished_at = now()
   where id = p_id and created_by = auth.uid() and status = 'pending';
end $$;

-- ───────────────────────── Privileges ─────────────────────────
revoke execute on function public.prune_rate_limits(interval) from public, anon, authenticated;
revoke execute on function public.cancel_stale_storefront_orders(interval, integer) from public, anon, authenticated;
revoke execute on function public._revoke_rider_links_on_close() from public, anon, authenticated;
revoke execute on function public.begin_outbound_message(uuid, uuid, text, text) from public, anon;
revoke execute on function public.finish_outbound_message(uuid, text, text, text) from public, anon;
grant execute on function public.prune_rate_limits(interval) to service_role;
grant execute on function public.cancel_stale_storefront_orders(interval, integer) to service_role;
grant execute on function public.begin_outbound_message(uuid, uuid, text, text) to authenticated;
grant execute on function public.finish_outbound_message(uuid, text, text, text) to authenticated;
