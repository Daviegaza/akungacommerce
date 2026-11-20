-- Parity and expansion: CSV product import, marketing pixel IDs, team invitations,
-- custom domains (model only), Nigeria bank-transfer rail (adapter only) and
-- KRA eTIMS tax invoices (manual entry; no KRA API). Additive only.
--
-- Rules mirror the pure TypeScript modules:
--   src/domain/catalogue-import.ts, tracking.ts, team-invites.ts,
--   custom-domain.ts, bank-transfer.ts, etims.ts
-- Every write is a security-definer function that checks membership + role.

-- ───────────────────────── Shop extras ─────────────────────────
-- Kept out of shop_settings so save_shop_settings (edited elsewhere) stays untouched.
create table public.shop_extras (
  org_id uuid primary key references public.organisations(id) on delete cascade,
  -- Digits only: the ID is interpolated into a script call on the storefront, so
  -- nothing but digits may ever reach it.
  meta_pixel_id text check (meta_pixel_id is null or meta_pixel_id ~ '^[0-9]{8,20}$'),
  ga4_id text check (ga4_id is null or ga4_id ~ '^G-[A-Z0-9]{4,15}$'),
  -- KRA PIN: letter + 9 digits + letter (e.g. P051234567X).
  kra_pin text check (kra_pin is null or kra_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
  bank_transfer_provider text not null default 'none'
    check (bank_transfer_provider in ('none', 'paystack_dva', 'flutterwave_va')),
  next_invoice_number integer not null default 1 check (next_invoice_number >= 1),
  updated_at timestamptz not null default now()
);
alter table public.shop_extras enable row level security;
create policy shop_extras_read on public.shop_extras for select using (public.is_member(org_id));
revoke all on public.shop_extras from anon, authenticated;
grant select on public.shop_extras to authenticated;
create trigger shop_extras_touch before update on public.shop_extras for each row execute function public.touch_updated_at();
create trigger audit_shop_extras after insert or update on public.shop_extras for each row execute function public.write_audit();

create or replace function public._ensure_shop_extras(p_org uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.shop_extras (org_id) values (p_org) on conflict (org_id) do nothing
$$;

create or replace function public.save_shop_tracking(p_org uuid, p_meta_pixel_id text, p_ga4_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pixel text := nullif(regexp_replace(coalesce(p_meta_pixel_id, ''), '\s', '', 'g'), '');
  v_ga4 text := nullif(upper(trim(coalesce(p_ga4_id, ''))), '');
begin
  perform public.require_permission(p_org, 'org.manage');
  if v_pixel is not null and v_pixel !~ '^[0-9]{8,20}$' then
    raise exception 'A Meta Pixel ID is 8 to 20 digits, numbers only' using errcode = '22023';
  end if;
  if v_ga4 is not null and v_ga4 !~ '^G-[A-Z0-9]{4,15}$' then
    raise exception 'A Google Analytics 4 ID looks like G-XXXXXXX' using errcode = '22023';
  end if;
  perform public._ensure_shop_extras(p_org);
  update public.shop_extras set meta_pixel_id = v_pixel, ga4_id = v_ga4 where org_id = p_org;
end $$;

create or replace function public.save_kra_pin(p_org uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pin text := nullif(upper(regexp_replace(coalesce(p_pin, ''), '\s', '', 'g')), '');
begin
  perform public.require_permission(p_org, 'org.manage');
  if v_pin is not null and v_pin !~ '^[A-Z][0-9]{9}[A-Z]$' then
    raise exception 'A KRA PIN is a letter, 9 digits and a letter, e.g. P051234567X' using errcode = '22023';
  end if;
  perform public._ensure_shop_extras(p_org);
  update public.shop_extras set kra_pin = v_pin where org_id = p_org;
end $$;

-- Bank-transfer rail (Nigeria). Extends the collections-provider idea: the shop picks a
-- provider; it only reaches buyers once an integration for it is connected_verified.
create or replace function public.set_bank_transfer_provider(p_org uuid, p_provider text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission(p_org, 'integrations.manage');
  if p_provider not in ('none', 'paystack_dva', 'flutterwave_va') then
    raise exception 'Choose Paystack, Flutterwave or none' using errcode = '22023';
  end if;
  if p_provider <> 'none' and (select base_currency from public.organisations where id = p_org) <> 'NGN' then
    raise exception 'Bank-transfer virtual accounts are only available for NGN businesses' using errcode = '22023';
  end if;
  perform public._ensure_shop_extras(p_org);
  update public.shop_extras set bank_transfer_provider = p_provider where org_id = p_org;
end $$;

-- ───────────────────────── CSV product import ─────────────────────────
-- p_rows: [{line, name, description?, category?, variant_name?, sku?, price_minor, compare_at_minor?, stock?, image_url?}]
-- p_on_duplicate: 'update' | 'skip' (rows whose SKU already exists in this business).
-- All or nothing: any invalid row means nothing is written. p_dry_run runs every write
-- inside a subtransaction and rolls it back, so a dry run checks exactly what a real run would do.
create or replace function public.import_products(p_org uuid, p_rows jsonb, p_on_duplicate text, p_dry_run boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_currency text;
  v_row jsonb;
  v_line integer;
  v_errors jsonb := '[]'::jsonb;
  v_name text;
  v_sku text;
  v_price bigint;
  v_compare bigint;
  v_stock integer;
  v_img text;
  v_seen text[] := '{}';
  v_products jsonb := '{}'::jsonb; -- lower(name) -> product id created in this import
  v_product uuid;
  v_variant uuid;
  v_existing public.product_variants;
  v_level public.inventory_levels;
  v_loc uuid;
  v_created_products integer := 0;
  v_created_variants integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_current_line integer := null;
begin
  perform public.require_permission(p_org, 'catalogue.write');
  perform public._rate_limit('import:' || p_org::text || ':' || auth.uid()::text, 30, interval '1 hour');
  if p_on_duplicate not in ('update', 'skip') then
    raise exception 'Choose whether to update or skip existing SKUs' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file has no product rows' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import at most 2,000 rows at a time' using errcode = '54000';
  end if;
  select base_currency into v_currency from public.organisations where id = p_org;
  v_loc := public._default_location(p_org);

  -- 1 · Validate every row first (same rules as src/domain/catalogue-import.ts).
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_line := coalesce((v_row ->> 'line')::integer, 0);
    v_name := trim(coalesce(v_row ->> 'name', ''));
    v_sku := nullif(trim(coalesce(v_row ->> 'sku', '')), '');
    if length(v_name) < 1 or length(v_name) > 160 then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Product name must be 1-160 characters');
    end if;
    if length(coalesce(v_row ->> 'description', '')) > 5000 then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Description is longer than 5,000 characters');
    end if;
    if length(coalesce(v_row ->> 'category', '')) > 80 then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Category is longer than 80 characters');
    end if;
    if length(coalesce(v_row ->> 'variant_name', '')) > 120 then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Variant name is longer than 120 characters');
    end if;
    if v_sku is not null and length(v_sku) > 64 then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'SKU is longer than 64 characters');
    end if;
    if v_sku is not null and lower(v_sku) = any(v_seen) then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'SKU appears more than once in this file');
    end if;
    if v_sku is not null then v_seen := v_seen || lower(v_sku); end if;
    if jsonb_typeof(v_row -> 'price_minor') <> 'number' or (v_row ->> 'price_minor') !~ '^[0-9]{1,15}$' then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Price must be zero or more');
    elsif jsonb_typeof(v_row -> 'compare_at_minor') = 'number' and (
          (v_row ->> 'compare_at_minor') !~ '^[0-9]{1,15}$' or (v_row ->> 'compare_at_minor')::bigint <= (v_row ->> 'price_minor')::bigint) then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Compare-at price must be higher than the price');
    end if;
    if jsonb_typeof(v_row -> 'stock') = 'number' and ((v_row ->> 'stock') !~ '^[0-9]{1,7}$' or (v_row ->> 'stock')::integer > 1000000) then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Stock must be a whole number from 0 to 1,000,000');
    end if;
    if nullif(v_row ->> 'image_url', '') is not null and (v_row ->> 'image_url' !~ '^https://[^\s"<>]+$' or length(v_row ->> 'image_url') > 2000) then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Image URL must start with https://');
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'dry_run', p_dry_run, 'created_products', 0, 'created_variants', 0,
      'updated_variants', 0, 'skipped', 0, 'errors', v_errors);
  end if;

  -- 2 · Apply, inside a subtransaction (rolled back for dry runs and on any failure).
  begin
    for v_row in select * from jsonb_array_elements(p_rows) loop
      v_current_line := coalesce((v_row ->> 'line')::integer, 0);
      v_name := trim(v_row ->> 'name');
      v_sku := nullif(trim(coalesce(v_row ->> 'sku', '')), '');
      v_price := (v_row ->> 'price_minor')::bigint;
      v_compare := case when jsonb_typeof(v_row -> 'compare_at_minor') = 'number' then (v_row ->> 'compare_at_minor')::bigint end;
      v_stock := case when jsonb_typeof(v_row -> 'stock') = 'number' then (v_row ->> 'stock')::integer end;
      v_img := nullif(v_row ->> 'image_url', '');

      v_existing := null;
      if v_sku is not null then
        select * into v_existing from public.product_variants where org_id = p_org and lower(sku) = lower(v_sku) for update;
      end if;

      if v_existing.id is not null then
        if p_on_duplicate = 'skip' then
          v_skipped := v_skipped + 1;
          continue;
        end if;
        update public.product_variants set
          price_minor = v_price,
          compare_at_minor = v_compare,
          name = coalesce(nullif(trim(coalesce(v_row ->> 'variant_name', '')), ''), name)
         where id = v_existing.id;
        update public.products set
          description = coalesce(nullif(trim(coalesce(v_row ->> 'description', '')), ''), description),
          category = coalesce(nullif(trim(coalesce(v_row ->> 'category', '')), ''), category)
         where id = v_existing.product_id and org_id = p_org;
        v_product := v_existing.product_id;
        if v_stock is not null and (select track_stock from public.products where id = v_product) then
          insert into public.inventory_levels (org_id, variant_id, location_id) values (p_org, v_existing.id, v_loc) on conflict do nothing;
          select * into v_level from public.inventory_levels where variant_id = v_existing.id and location_id = v_loc;
          if v_stock < v_level.reserved then
            raise exception 'Stock % is below the % already reserved for open orders', v_stock, v_level.reserved using errcode = '23514';
          end if;
          if v_stock <> v_level.on_hand then
            perform public._stock_move(p_org, v_existing.id, v_loc, 'adjustment', v_stock - v_level.on_hand, 0,
              'stock_count', 'CSV import', null, null);
          end if;
        end if;
        v_updated := v_updated + 1;
      else
        v_product := nullif(v_products ->> lower(v_name), '')::uuid;
        if v_product is null then
          insert into public.products (org_id, name, description, category, status, track_stock, tax_rate_bps)
          values (p_org, v_name, nullif(trim(coalesce(v_row ->> 'description', '')), ''), nullif(trim(coalesce(v_row ->> 'category', '')), ''),
            'active',
            exists (select 1 from jsonb_array_elements(p_rows) r
                     where lower(trim(r ->> 'name')) = lower(v_name) and jsonb_typeof(r -> 'stock') = 'number'),
            0)
          returning id into v_product;
          v_products := v_products || jsonb_build_object(lower(v_name), v_product);
          v_created_products := v_created_products + 1;
        end if;
        insert into public.product_variants (org_id, product_id, name, sku, price_minor, compare_at_minor, currency, position)
        values (p_org, v_product, coalesce(nullif(trim(coalesce(v_row ->> 'variant_name', '')), ''), 'Default'), v_sku, v_price, v_compare,
          v_currency, (select count(*) from public.product_variants where product_id = v_product))
        returning id into v_variant;
        insert into public.inventory_levels (org_id, variant_id, location_id) values (p_org, v_variant, v_loc) on conflict do nothing;
        if coalesce(v_stock, 0) > 0 then
          perform public._stock_move(p_org, v_variant, v_loc, 'receipt', v_stock, 0, 'received_from_supplier', 'CSV import', null, null);
        end if;
        v_created_variants := v_created_variants + 1;
      end if;

      if v_img is not null then
        update public.products set images = images || jsonb_build_array(jsonb_build_object('url', v_img))
         where id = v_product and jsonb_array_length(images) < 12
           and not exists (select 1 from jsonb_array_elements(images) i where i ->> 'url' = v_img);
      end if;
    end loop;

    if p_dry_run then
      raise exception 'dry run' using errcode = 'RFDRY';
    end if;
  exception
    when sqlstate 'RFDRY' then
      null; -- every write above is rolled back; the counts stay
    when others then
      return jsonb_build_object('ok', false, 'dry_run', p_dry_run, 'created_products', 0, 'created_variants', 0,
        'updated_variants', 0, 'skipped', 0,
        'errors', jsonb_build_array(jsonb_build_object('line', coalesce(v_current_line, 0), 'message', sqlerrm)));
  end;

  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'created_products', v_created_products,
    'created_variants', v_created_variants, 'updated_variants', v_updated, 'skipped', v_skipped, 'errors', '[]'::jsonb);
end $$;

-- ───────────────────────── Team invitations ─────────────────────────
-- Only a SHA-256 hash of the invite token is stored; the raw token is returned once.
create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone_e164 public.e164,
  role public.member_role not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid,
  accepted_by uuid,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  check ((email is null) <> (phone_e164 is null))
);
create index team_invites_org_idx on public.team_invites(org_id, created_at desc);
alter table public.team_invites enable row level security; -- no policies: read through list_team_invites only
revoke all on public.team_invites from anon, authenticated;
create trigger audit_team_invites after insert or update on public.team_invites for each row execute function public.write_audit();

create or replace function public._invite_json(i public.team_invites) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', i.id, 'email', i.email, 'phone_e164', i.phone_e164, 'role', i.role,
    'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
    'created_at', i.created_at, 'expires_at', i.expires_at, 'accepted_at', i.accepted_at)
$$;

create or replace function public.create_team_invite(p_org uuid, p_email text, p_phone text, p_role public.member_role)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_token text;
  v_row public.team_invites;
begin
  perform public.require_permission(p_org, 'team.manage');
  if p_role = 'owner' and public.member_role_in(p_org) <> 'owner' then
    raise exception 'Only an owner can invite another owner' using errcode = '42501';
  end if;
  if (v_email is null) = (v_phone is null) then
    raise exception 'Invite by email or by phone number' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Enter the phone number with its country code' using errcode = '22023';
  end if;
  if v_email is not null and exists (select 1 from public.memberships where org_id = p_org and lower(email) = v_email) then
    raise exception 'That person is already on the team' using errcode = '23505';
  end if;
  if (select count(*) from public.team_invites where org_id = p_org and status = 'pending' and expires_at > now()) >= 50 then
    raise exception 'Too many open invitations. Revoke some first.' using errcode = '54000';
  end if;
  -- One open invite per contact: a new one replaces the old link.
  update public.team_invites set status = 'revoked', revoked_at = now()
   where org_id = p_org and status = 'pending'
     and ((v_email is not null and email = v_email) or (v_phone is not null and phone_e164 = v_phone));
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.team_invites (org_id, email, phone_e164, role, token_hash, invited_by)
  values (p_org, v_email, v_phone, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
  returning * into v_row;
  return jsonb_build_object('invite', public._invite_json(v_row), 'token', v_token);
end $$;

create or replace function public.list_team_invites(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission(p_org, 'team.manage');
  return coalesce((select jsonb_agg(public._invite_json(i) order by i.created_at desc)
                     from public.team_invites i where i.org_id = p_org
                      and (i.status = 'pending' or i.created_at > now() - interval '30 days')), '[]'::jsonb);
end $$;

create or replace function public.revoke_team_invite(p_org uuid, p_invite uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.team_invites;
begin
  perform public.require_permission(p_org, 'team.manage');
  select * into v_row from public.team_invites where id = p_invite and org_id = p_org for update;
  if v_row.id is null then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  if v_row.role = 'owner' and public.member_role_in(p_org) <> 'owner' then
    raise exception 'Only an owner can revoke an owner invitation' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then raise exception 'This invitation is no longer open' using errcode = '22023'; end if;
  update public.team_invites set status = 'revoked', revoked_at = now() where id = p_invite;
end $$;

-- What the invite link shows before accepting. Contact is masked.
create or replace function public.preview_team_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.team_invites;
  v_org text;
begin
  if p_token is null or length(p_token) < 30 or length(p_token) > 100 then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  perform public._rate_limit('invite:preview:' || public._client_ip(), 60, interval '10 minutes');
  select * into v_row from public.team_invites where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_row.id is null then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  select name into v_org from public.organisations where id = v_row.org_id;
  return jsonb_build_object(
    'org_name', v_org, 'role', v_row.role,
    'status', case when v_row.status = 'pending' and v_row.expires_at <= now() then 'expired' else v_row.status end,
    'expires_at', v_row.expires_at,
    'contact_kind', case when v_row.email is not null then 'email' else 'phone' end,
    'contact_hint', case when v_row.email is not null
      then left(v_row.email, 1) || '***@' || split_part(v_row.email, '@', 2)
      else '***' || right(v_row.phone_e164, 3) end
  );
end $$;

-- Accept with the link token. Email invites must be accepted by the account with that
-- email. Phone invites are bearer links (we cannot verify a phone at sign-in yet): they are
-- single-use and expire after 7 days.
create or replace function public.accept_team_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.team_invites;
  v_email text;
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
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_row.email is not null and v_row.email <> coalesce(v_email, '') then
    raise exception 'This invitation was sent to a different email address. Sign in with that address.' using errcode = '42501';
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

-- ───────────────────────── Custom domains (model only) ─────────────────────────
-- Status moves to 'verified' / 'failed' ONLY through the service-role function below.
-- No DNS check or certificate issuance is wired in this build.
create table public.custom_domains (
  org_id uuid primary key references public.organisations(id) on delete cascade,
  hostname text not null unique
    check (length(hostname) <= 253 and hostname ~ '^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$'),
  status text not null default 'pending_dns' check (status in ('pending_dns', 'verified', 'failed')),
  verification_token text not null check (verification_token ~ '^[a-f0-9]{32}$'),
  failure_reason text check (failure_reason is null or length(failure_reason) <= 300),
  last_checked_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.custom_domains enable row level security;
create policy custom_domains_read on public.custom_domains for select using (public.is_member(org_id));
revoke all on public.custom_domains from anon, authenticated;
grant select on public.custom_domains to authenticated;
create trigger audit_custom_domains after insert or update on public.custom_domains for each row execute function public.write_audit();

create or replace function public.set_custom_domain(p_org uuid, p_hostname text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_host text := lower(trim(trailing '.' from trim(coalesce(p_hostname, ''))));
  v_row public.custom_domains;
begin
  perform public.require_permission(p_org, 'org.manage');
  if v_host !~ '^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$' then
    raise exception 'Enter a domain like shop.example.com (no https:// or paths)' using errcode = '22023';
  end if;
  if v_host ~ '(^|\.)(localhost|vercel\.app|supabase\.co|example\.com|example\.org|example\.net)$' then
    raise exception 'Use a domain you own' using errcode = '22023';
  end if;
  if not exists (select 1 from public.shop_settings where org_id = p_org) then
    raise exception 'Set up your shop link first (My shop)' using errcode = '22023';
  end if;
  insert into public.custom_domains (org_id, hostname, verification_token)
  values (p_org, v_host, encode(extensions.gen_random_bytes(16), 'hex'))
  on conflict (org_id) do update set hostname = excluded.hostname, status = 'pending_dns',
    verification_token = excluded.verification_token, failure_reason = null, last_checked_at = null, verified_at = null,
    created_at = now()
  returning * into v_row;
  return to_jsonb(v_row);
exception when unique_violation then
  raise exception 'That domain is already connected to another shop' using errcode = '23505';
end $$;

create or replace function public.remove_custom_domain(p_org uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission(p_org, 'org.manage');
  delete from public.custom_domains where org_id = p_org;
end $$;

-- For a future verifier (service role only).
create or replace function public.mark_custom_domain_status(p_hostname text, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('pending_dns', 'verified', 'failed') then raise exception 'Bad status' using errcode = '22023'; end if;
  update public.custom_domains set status = p_status, last_checked_at = now(),
    verified_at = case when p_status = 'verified' then now() end,
    failure_reason = case when p_status = 'failed' then left(p_reason, 300) end
   where hostname = lower(p_hostname);
end $$;

-- Hostname -> shop slug, only for verified domains of published shops.
create or replace function public.storefront_resolve_host(p_hostname text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select s.slug from public.custom_domains d join public.shop_settings s on s.org_id = d.org_id
   where d.hostname = lower(trim(trailing '.' from coalesce(p_hostname, ''))) and d.status = 'verified' and s.published
$$;

-- ───────────────────────── Storefront extras (anon) ─────────────────────────
create or replace function public.storefront_extras(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_shop public.shop_settings;
  v_x public.shop_extras;
  v_currency text;
begin
  v_shop := public._shop_by_slug(p_slug);
  if v_shop.org_id is null then raise exception 'Shop not found' using errcode = 'P0002'; end if;
  select * into v_x from public.shop_extras where org_id = v_shop.org_id;
  select base_currency into v_currency from public.organisations where id = v_shop.org_id;
  return jsonb_build_object(
    'meta_pixel_id', v_x.meta_pixel_id,
    'ga4_id', v_x.ga4_id,
    'bank_transfer_provider', coalesce(v_x.bank_transfer_provider, 'none'),
    'bank_transfer', v_currency = 'NGN' and coalesce(v_x.bank_transfer_provider, 'none') <> 'none' and exists (
      select 1 from public.integration_connections
       where org_id = v_shop.org_id and state = 'connected_verified'
         and provider = case v_x.bank_transfer_provider when 'paystack_dva' then 'paystack' else 'flutterwave' end)
  );
end $$;

-- ───────────────────────── eTIMS tax invoices ─────────────────────────
-- One invoice per order, gapless number per business. Prepared for manual entry into
-- eTIMS Lite; direct KRA submission is not implemented (kra_status stays 'not_submitted').
create table public.tax_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  order_id uuid not null unique,
  invoice_number integer not null check (invoice_number >= 1),
  seller_name text not null,
  seller_pin text not null check (seller_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
  buyer_pin text check (buyer_pin is null or buyer_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
  buyer_name text check (buyer_name is null or length(buyer_name) <= 160),
  currency public.currency_code not null,
  tax_mode public.tax_mode not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  net_minor bigint not null,
  tax_minor bigint not null,
  delivery_minor bigint not null,
  total_minor bigint not null,
  kra_status text not null default 'not_submitted' check (kra_status in ('not_submitted')),
  issued_by uuid default auth.uid(),
  issued_at timestamptz not null default now(),
  unique (org_id, invoice_number),
  foreign key (order_id, org_id) references public.orders(id, org_id)
);
alter table public.tax_invoices enable row level security;
create policy tax_invoices_read on public.tax_invoices for select using (public.is_member(org_id));
revoke all on public.tax_invoices from anon, authenticated;
grant select on public.tax_invoices to authenticated;
create trigger tax_invoices_immutable before update on public.tax_invoices for each row execute function public.forbid_change();
create trigger audit_tax_invoices after insert on public.tax_invoices for each row execute function public.write_audit();

create or replace function public.issue_tax_invoice(p_org uuid, p_order uuid, p_buyer_pin text, p_buyer_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing uuid;
  v_order public.orders;
  v_x public.shop_extras;
  v_number integer;
  v_pin text := nullif(upper(regexp_replace(coalesce(p_buyer_pin, ''), '\s', '', 'g')), '');
  v_lines jsonb;
  v_net bigint;
  v_tax bigint;
  v_id uuid;
begin
  perform public.require_permission(p_org, 'payments.record');
  select id into v_existing from public.tax_invoices where org_id = p_org and order_id = p_order;
  if v_existing is not null then return v_existing; end if; -- idempotent: an issued invoice never changes
  select * into v_order from public.orders where id = p_order and org_id = p_org;
  if v_order.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if v_order.status in ('draft', 'cancelled') then
    raise exception 'Invoices can only be issued for confirmed orders' using errcode = '22023';
  end if;
  if v_pin is not null and v_pin !~ '^[A-Z][0-9]{9}[A-Z]$' then
    raise exception 'Buyer KRA PIN must be a letter, 9 digits and a letter' using errcode = '22023';
  end if;
  perform public._ensure_shop_extras(p_org);
  select * into v_x from public.shop_extras where org_id = p_org for update; -- serialises numbering
  if v_x.kra_pin is null then
    raise exception 'Add your KRA PIN in Selling tools before issuing tax invoices' using errcode = '22023';
  end if;
  v_number := v_x.next_invoice_number;
  update public.shop_extras set next_invoice_number = next_invoice_number + 1 where org_id = p_org;

  -- Same line maths as src/domain/etims.ts: net excludes tax in both tax modes.
  select coalesce(jsonb_agg(jsonb_build_object(
           'description', l.product_name || case when l.variant_name <> 'Default' then ' - ' || l.variant_name else '' end,
           'sku', l.sku, 'quantity', l.quantity, 'unit_price_minor', l.unit_price_minor, 'discount_minor', l.discount_minor,
           'tax_rate_bps', l.tax_rate_bps,
           'net_minor', case when v_order.tax_mode = 'inclusive' then l.subtotal_minor - l.tax_minor else l.subtotal_minor end,
           'tax_minor', l.tax_minor,
           'gross_minor', case when v_order.tax_mode = 'inclusive' then l.subtotal_minor else l.subtotal_minor + l.tax_minor end
         ) order by l.position), '[]'::jsonb),
         coalesce(sum(case when v_order.tax_mode = 'inclusive' then l.subtotal_minor - l.tax_minor else l.subtotal_minor end), 0),
         coalesce(sum(l.tax_minor), 0)
    into v_lines, v_net, v_tax
    from public.order_lines l where l.order_id = p_order;

  insert into public.tax_invoices (org_id, order_id, invoice_number, seller_name, seller_pin, buyer_pin, buyer_name, currency, tax_mode,
    lines, net_minor, tax_minor, delivery_minor, total_minor)
  select p_org, p_order, v_number, coalesce(o.legal_name, o.name), v_x.kra_pin, v_pin,
    coalesce(nullif(trim(coalesce(p_buyer_name, '')), ''), v_order.customer_name), v_order.currency, v_order.tax_mode,
    v_lines, v_net, v_tax, v_order.delivery_fee_minor, v_order.total_minor
    from public.organisations o where o.id = p_org
  returning id into v_id;
  return v_id;
end $$;

-- ───────────────────────── Privileges ─────────────────────────
revoke execute on function public._ensure_shop_extras(uuid) from public, anon, authenticated;
revoke execute on function public._invite_json(public.team_invites) from public, anon, authenticated;
revoke execute on function public.mark_custom_domain_status(text, text, text) from public, anon, authenticated;
grant execute on function public.mark_custom_domain_status(text, text, text) to service_role;

revoke execute on function public.save_shop_tracking(uuid, text, text) from public, anon;
revoke execute on function public.save_kra_pin(uuid, text) from public, anon;
revoke execute on function public.set_bank_transfer_provider(uuid, text) from public, anon;
revoke execute on function public.import_products(uuid, jsonb, text, boolean) from public, anon;
revoke execute on function public.create_team_invite(uuid, text, text, public.member_role) from public, anon;
revoke execute on function public.list_team_invites(uuid) from public, anon;
revoke execute on function public.revoke_team_invite(uuid, uuid) from public, anon;
revoke execute on function public.accept_team_invite(text) from public, anon;
revoke execute on function public.set_custom_domain(uuid, text) from public, anon;
revoke execute on function public.remove_custom_domain(uuid) from public, anon;
revoke execute on function public.issue_tax_invoice(uuid, uuid, text, text) from public, anon;
grant execute on function public.save_shop_tracking(uuid, text, text) to authenticated, service_role;
grant execute on function public.save_kra_pin(uuid, text) to authenticated, service_role;
grant execute on function public.set_bank_transfer_provider(uuid, text) to authenticated, service_role;
grant execute on function public.import_products(uuid, jsonb, text, boolean) to authenticated, service_role;
grant execute on function public.create_team_invite(uuid, text, text, public.member_role) to authenticated, service_role;
grant execute on function public.list_team_invites(uuid) to authenticated, service_role;
grant execute on function public.revoke_team_invite(uuid, uuid) to authenticated, service_role;
grant execute on function public.accept_team_invite(text) to authenticated, service_role;
grant execute on function public.set_custom_domain(uuid, text) to authenticated, service_role;
grant execute on function public.remove_custom_domain(uuid) to authenticated, service_role;
grant execute on function public.issue_tax_invoice(uuid, uuid, text, text) to authenticated, service_role;

revoke execute on function public.preview_team_invite(text) from public;
revoke execute on function public.storefront_resolve_host(text) from public;
revoke execute on function public.storefront_extras(text) from public;
grant execute on function public.preview_team_invite(text) to anon, authenticated, service_role;
grant execute on function public.storefront_resolve_host(text) to anon, authenticated, service_role;
grant execute on function public.storefront_extras(text) to anon, authenticated, service_role;
