-- Deposits, failed-delivery rules and delivery handoff (own rider link, pick-up
-- point, courier). Rafu brokers delivery: it never runs a fleet, and no courier
-- or pick-up-point network is connected.
--
-- Mirrors src/domain/delivery-policy.ts (pure rules, used by the demo gateway).
-- tests/db/delivery.db.test.ts checks parity and the access rules below.
--
-- Money stays in bigint minor units. A deposit is not a new kind of money: it is
-- the "amount due now" on an order, and is paid with ordinary payment records.
-- deposit_paid and balance_due are always derived from payments minus refunds.

-- ───────────────────────── Shop payment & failed-delivery policy ─────────────────────────
create table public.shop_policies (
  org_id uuid primary key references public.organisations(id) on delete cascade,
  payment_mode text not null default 'pay_on_delivery' check (payment_mode in ('pay_on_delivery', 'deposit', 'full_prepay')),
  deposit_kind text not null default 'percent' check (deposit_kind in ('percent', 'fixed')),
  deposit_percent_bps integer not null default 3000 check (deposit_percent_bps between 100 and 10000),
  deposit_fixed_minor bigint not null default 0 check (deposit_fixed_minor >= 0),
  deposit_min_order_minor bigint not null default 0 check (deposit_min_order_minor >= 0),
  deposit_covers_delivery boolean not null default true,
  failed_delivery_payer text not null default 'seller' check (failed_delivery_payer in ('buyer', 'seller')),
  max_delivery_attempts smallint not null default 2 check (max_delivery_attempts between 1 and 5),
  updated_at timestamptz not null default now(),
  check (payment_mode <> 'deposit' or deposit_kind <> 'fixed' or deposit_fixed_minor > 0)
);
alter table public.shop_policies enable row level security;
create policy shop_policies_read on public.shop_policies for select using (public.is_member(org_id));
revoke insert, update, delete on public.shop_policies from anon, authenticated;
create trigger shop_policies_touch before update on public.shop_policies for each row execute function public.touch_updated_at();
create trigger audit_shop_policies after insert or update on public.shop_policies for each row execute function public.write_audit();

-- ───────────────────────── Pick-up points / agents ─────────────────────────
-- The shop's own list (an agent shop, a stall, a partner counter). Not a live integration.
create table public.pickup_points (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  area text check (area is null or length(area) <= 120),
  hours text check (hours is null or length(hours) <= 120),
  fee_minor bigint not null default 0 check (fee_minor >= 0),
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create index pickup_points_org_idx on public.pickup_points(org_id, active, position);
alter table public.pickup_points enable row level security;
create policy pickup_points_read on public.pickup_points for select using (public.is_member(org_id));
revoke insert, update, delete on public.pickup_points from anon, authenticated;
create trigger pickup_points_touch before update on public.pickup_points for each row execute function public.touch_updated_at();
create trigger audit_pickup_points after insert or update on public.pickup_points for each row execute function public.write_audit();

-- ───────────────────────── Orders & fulfilments ─────────────────────────
alter table public.orders
  add column deposit_due_minor bigint not null default 0 check (deposit_due_minor >= 0),
  add column delivery_attempts smallint not null default 0 check (delivery_attempts between 0 and 5),
  add column forfeited_fee_minor bigint not null default 0 check (forfeited_fee_minor >= 0),
  -- The policy the buyer saw and agreed to at checkout. Null for staff-created orders.
  add column delivery_policy jsonb;
alter table public.orders add constraint orders_deposit_within_total check (deposit_due_minor <= total_minor);

alter table public.fulfilments
  add column handoff text check (handoff in ('own_rider', 'pickup_point', 'courier')),
  add column carrier text check (carrier is null or length(carrier) <= 80),
  add column pickup_point jsonb;

-- Append-only delivery events (failed attempts, rider actions, handoff changes).
create table public.delivery_events (
  id bigserial primary key,
  org_id uuid not null,
  order_id uuid not null,
  kind text not null check (kind in ('failed', 'picked_up', 'delivered', 'rider_accepted', 'rider_link_created', 'rider_link_revoked', 'handoff_set')),
  actor text not null check (actor in ('staff', 'rider', 'system')),
  reason text check (reason is null or reason in ('buyer_unreachable', 'buyer_refused', 'wrong_address', 'buyer_rescheduled', 'rider_issue', 'shop_issue', 'other')),
  note text check (note is null or length(note) <= 300),
  attempt smallint,
  forfeited_minor bigint not null default 0 check (forfeited_minor >= 0),
  idempotency_key text,
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (order_id, org_id) references public.orders(id, org_id) on delete cascade
);
create index delivery_events_order_idx on public.delivery_events(order_id, id);
create unique index delivery_events_idem_idx on public.delivery_events(org_id, idempotency_key) where idempotency_key is not null;
alter table public.delivery_events enable row level security;
create policy delivery_events_read on public.delivery_events for select using (public.is_member(org_id));
revoke insert, update, delete on public.delivery_events from anon, authenticated;
create trigger delivery_events_immutable before update or delete on public.delivery_events
  for each row execute function public.forbid_change();

-- Account-free rider links. Only a SHA-256 of the token is stored; the token is shown once.
create table public.rider_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  order_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  rider_name text check (rider_name is null or length(rider_name) <= 60),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_name text check (accepted_name is null or length(accepted_name) <= 60),
  revoked_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (order_id, org_id) references public.orders(id, org_id) on delete cascade
);
create index rider_links_order_idx on public.rider_links(order_id, created_at desc);
alter table public.rider_links enable row level security; -- no policies: read through order_delivery() / rider_job()
revoke all on public.rider_links from anon, authenticated;

-- ───────────────────────── Pure helpers (mirrors of delivery-policy.ts) ─────────────────────────
-- ISO 4217 minor units as reported by Intl/CLDR in the browser (2 unless listed).
create or replace function public._currency_exponent(p_currency text)
returns integer language sql immutable as $$
  select case
    when upper(p_currency) in ('BIF', 'CLP', 'DJF', 'GNF', 'IQD', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') then 0
    when upper(p_currency) in ('BHD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') then 3
    else 2 end
$$;

-- Default policy for shops that have not saved one.
create or replace function public._default_policy()
returns jsonb language sql immutable as $$
  select jsonb_build_object('payment_mode', 'pay_on_delivery', 'deposit_kind', 'percent', 'deposit_percent_bps', 3000,
    'deposit_fixed_minor', 0, 'deposit_min_order_minor', 0, 'deposit_covers_delivery', true,
    'failed_delivery_payer', 'seller', 'max_delivery_attempts', 2)
$$;

create or replace function public._policy_json(p_org uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object('payment_mode', p.payment_mode, 'deposit_kind', p.deposit_kind, 'deposit_percent_bps', p.deposit_percent_bps,
       'deposit_fixed_minor', p.deposit_fixed_minor, 'deposit_min_order_minor', p.deposit_min_order_minor,
       'deposit_covers_delivery', p.deposit_covers_delivery, 'failed_delivery_payer', p.failed_delivery_payer,
       'max_delivery_attempts', p.max_delivery_attempts)
       from public.shop_policies p where p.org_id = p_org),
    public._default_policy())
$$;

-- Deposit due now for an all-in total: rounded up to a whole major unit, never above the total.
create or replace function public._deposit_due(p_policy jsonb, p_total bigint, p_fee bigint, p_currency text)
returns bigint language plpgsql immutable as $$
declare
  v_mode text := coalesce(p_policy ->> 'payment_mode', 'pay_on_delivery');
  v_raw numeric;
  v_unit numeric;
begin
  if p_total is null or p_total <= 0 then return 0; end if;
  if v_mode = 'full_prepay' then return p_total; end if;
  if v_mode <> 'deposit' then return 0; end if;
  if p_total < coalesce((p_policy ->> 'deposit_min_order_minor')::bigint, 0) then return 0; end if;
  if p_policy ->> 'deposit_kind' = 'fixed' then
    v_raw := coalesce((p_policy ->> 'deposit_fixed_minor')::bigint, 0);
  else
    v_raw := ceil(p_total::numeric * coalesce((p_policy ->> 'deposit_percent_bps')::integer, 3000) / 10000);
  end if;
  if coalesce((p_policy ->> 'deposit_covers_delivery')::boolean, true) then
    v_raw := greatest(v_raw, coalesce(p_fee, 0));
  end if;
  v_unit := power(10::numeric, public._currency_exponent(p_currency));
  return least(p_total, (ceil(v_raw / v_unit) * v_unit)::bigint);
end $$;

create or replace function public._mask_phone(p_phone text)
returns text language sql immutable as $$
  select case
    when p_phone is null then null
    when length(regexp_replace(p_phone, '\D', '', 'g')) < 7 then '•••'
    else '••• ••• ' || right(regexp_replace(p_phone, '\D', '', 'g'), 3) end
$$;

-- Deposit paid, balance and the amount the payment step should charge now.
create or replace function public._order_amounts(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders;
  v_net bigint;
  v_dep bigint;
  v_dep_paid bigint;
  v_balance bigint;
begin
  select * into v_o from public.orders where id = p_order;
  if v_o.id is null then return null; end if;
  select greatest(0,
      coalesce((select sum(amount_minor) from public.payments where order_id = p_order and status = 'succeeded'), 0)
    - coalesce((select sum(amount_minor) from public.refunds where order_id = p_order and status = 'succeeded'), 0))
    into v_net;
  v_dep := least(greatest(v_o.deposit_due_minor, 0), v_o.total_minor);
  v_dep_paid := least(v_net, v_dep);
  v_balance := greatest(0, v_o.total_minor - v_net);
  return jsonb_build_object(
    'deposit_due_minor', v_dep,
    'deposit_paid_minor', v_dep_paid,
    'deposit_outstanding_minor', v_dep - v_dep_paid,
    'balance_due_minor', v_balance,
    'due_now_minor', case when v_dep - v_dep_paid > 0 then v_dep - v_dep_paid else v_balance end,
    'forfeited_minor', v_o.forfeited_fee_minor,
    'attempts', v_o.delivery_attempts,
    'max_attempts', coalesce((v_o.delivery_policy ->> 'max_delivery_attempts')::integer,
                             (public._policy_json(v_o.org_id) ->> 'max_delivery_attempts')::integer));
end $$;

create or replace function public._order_handoff(p_order uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('kind', f.handoff, 'carrier', f.carrier, 'pickup_point', f.pickup_point)
    from public.fulfilments f where f.order_id = p_order
$$;

-- ───────────────────────── Merchant: policy & pick-up points ─────────────────────────
create or replace function public.save_shop_policy(p_org uuid, p_policy jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_mode text := p_policy ->> 'payment_mode';
  v_kind text := coalesce(p_policy ->> 'deposit_kind', 'percent');
  v_bps integer := (p_policy ->> 'deposit_percent_bps')::integer;
  v_fixed bigint := coalesce((p_policy ->> 'deposit_fixed_minor')::bigint, 0);
  v_min bigint := coalesce((p_policy ->> 'deposit_min_order_minor')::bigint, 0);
  v_payer text := p_policy ->> 'failed_delivery_payer';
  v_attempts integer := (p_policy ->> 'max_delivery_attempts')::integer;
begin
  perform public.require_permission(p_org, 'org.manage');
  if v_mode is null or v_mode not in ('pay_on_delivery', 'deposit', 'full_prepay') then raise exception 'Choose how buyers pay.' using errcode = '22023'; end if;
  if v_kind not in ('percent', 'fixed') then raise exception 'Choose a percentage or a fixed amount.' using errcode = '22023'; end if;
  if v_bps is null or v_bps < 100 or v_bps > 10000 then raise exception 'Deposit must be between 1%% and 100%%.' using errcode = '22023'; end if;
  if v_fixed < 0 or v_min < 0 then raise exception 'Enter an amount of zero or more.' using errcode = '22023'; end if;
  if v_mode = 'deposit' and v_kind = 'fixed' and v_fixed <= 0 then raise exception 'Enter a deposit above zero.' using errcode = '22023'; end if;
  if v_payer is null or v_payer not in ('buyer', 'seller') then raise exception 'Choose who pays.' using errcode = '22023'; end if;
  if v_attempts is null or v_attempts < 1 or v_attempts > 5 then raise exception 'Between 1 and 5 attempts.' using errcode = '22023'; end if;
  insert into public.shop_policies (org_id, payment_mode, deposit_kind, deposit_percent_bps, deposit_fixed_minor, deposit_min_order_minor,
    deposit_covers_delivery, failed_delivery_payer, max_delivery_attempts)
  values (p_org, v_mode, v_kind, v_bps, v_fixed, v_min, coalesce((p_policy ->> 'deposit_covers_delivery')::boolean, true), v_payer, v_attempts)
  on conflict (org_id) do update set
    payment_mode = excluded.payment_mode, deposit_kind = excluded.deposit_kind, deposit_percent_bps = excluded.deposit_percent_bps,
    deposit_fixed_minor = excluded.deposit_fixed_minor, deposit_min_order_minor = excluded.deposit_min_order_minor,
    deposit_covers_delivery = excluded.deposit_covers_delivery, failed_delivery_payer = excluded.failed_delivery_payer,
    max_delivery_attempts = excluded.max_delivery_attempts;
end $$;

create or replace function public.save_pickup_point(p_org uuid, p_point jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_name text := left(trim(coalesce(p_point ->> 'name', '')), 80);
  v_fee bigint := (p_point ->> 'fee_minor')::bigint;
begin
  perform public.require_permission(p_org, 'org.manage');
  if length(v_name) < 2 then raise exception 'Give the pick-up point a name' using errcode = '22023'; end if;
  if v_fee is null or v_fee < 0 then raise exception 'The fee must be zero or more' using errcode = '22023'; end if;
  if nullif(p_point ->> 'id', '') is not null then
    update public.pickup_points set name = v_name, area = nullif(left(trim(coalesce(p_point ->> 'area', '')), 120), ''),
      hours = nullif(left(trim(coalesce(p_point ->> 'hours', '')), 120), ''), fee_minor = v_fee,
      active = coalesce((p_point ->> 'active')::boolean, true)
     where id = (p_point ->> 'id')::uuid and org_id = p_org
    returning id into v_id;
    if v_id is null then raise exception 'Pick-up point not found' using errcode = 'P0002'; end if;
    return v_id;
  end if;
  if (select count(*) from public.pickup_points where org_id = p_org) >= 50 then
    raise exception 'A shop can list up to 50 pick-up points' using errcode = '22023';
  end if;
  insert into public.pickup_points (org_id, name, area, hours, fee_minor, active, position)
  values (p_org, v_name, nullif(left(trim(coalesce(p_point ->> 'area', '')), 120), ''), nullif(left(trim(coalesce(p_point ->> 'hours', '')), 120), ''),
    v_fee, coalesce((p_point ->> 'active')::boolean, true), (select count(*) from public.pickup_points where org_id = p_org))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.archive_pickup_point(p_org uuid, p_point uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission(p_org, 'org.manage');
  update public.pickup_points set active = false where id = p_point and org_id = p_org;
  if not found then raise exception 'Pick-up point not found' using errcode = 'P0002'; end if;
end $$;

-- ───────────────────────── Storefront: checkout options, quote, order ─────────────────────────
create or replace function public.storefront_checkout_options(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_shop public.shop_settings;
begin
  v_shop := public._shop_by_slug(p_slug);
  if v_shop.org_id is null then raise exception 'Shop not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'policy', public._policy_json(v_shop.org_id),
    'pickup_points', case when v_shop.delivery_enabled then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'area', p.area, 'hours', p.hours, 'fee_minor', p.fee_minor)
             order by p.position, p.name)
        from public.pickup_points p where p.org_id = v_shop.org_id and p.active), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- Server-side quote: catalogue prices, delivery fee by distance band or pick-up point,
-- and the deposit due now from the shop's payment policy.
create or replace function public.storefront_quote(p_slug text, p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_shop public.shop_settings;
  v_org public.organisations;
  v_line jsonb;
  v_v record;
  v_qty integer;
  v_sub bigint;
  v_tax bigint;
  v_lines jsonb := '[]'::jsonb;
  v_sum_sub bigint := 0;
  v_sum_tax bigint := 0;
  v_sum_total bigint := 0;
  v_method text := coalesce(p_input ->> 'method', 'pickup');
  v_km double precision;
  v_fee bigint := 0;
  v_point public.pickup_points;
  v_policy jsonb;
  v_total bigint;
  v_deposit bigint;
begin
  v_shop := public._shop_by_slug(p_slug);
  if v_shop.org_id is null then raise exception 'Shop not found' using errcode = 'P0002'; end if;
  select * into v_org from public.organisations where id = v_shop.org_id;
  if jsonb_array_length(coalesce(p_input -> 'lines', '[]'::jsonb)) = 0 then raise exception 'Your bag is empty' using errcode = '22023'; end if;
  if jsonb_array_length(p_input -> 'lines') > 50 then raise exception 'Too many items in one order' using errcode = '22023'; end if;

  for v_line in select * from jsonb_array_elements(p_input -> 'lines') loop
    v_qty := (v_line ->> 'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 999 then raise exception 'Invalid quantity' using errcode = '22023'; end if;
    select v.id, v.price_minor, v.name as vname, p.name as pname, p.tax_rate_bps, p.track_stock, p.available_from,
           (select coalesce(sum(il.on_hand - il.reserved), 0) from public.inventory_levels il where il.variant_id = v.id) as avail
      into v_v
      from public.product_variants v join public.products p on p.id = v.product_id
     where v.id = (v_line ->> 'variant_id')::uuid and v.org_id = v_org.id and v.is_active and p.status = 'active';
    if v_v.id is null then raise exception 'An item in your bag is no longer available' using errcode = 'P0002'; end if;
    if v_v.available_from is not null and v_v.available_from > now() then
      raise exception '% is not available yet', v_v.pname using errcode = '22023';
    end if;
    if v_v.track_stock and v_v.avail < v_qty then
      raise exception 'Only % of % left', greatest(v_v.avail, 0), v_v.pname using errcode = '23514';
    end if;
    v_sub := v_v.price_minor * v_qty;
    if v_org.tax_mode = 'exclusive' then
      v_tax := round(v_sub::numeric * v_v.tax_rate_bps / 10000);
    else
      v_tax := case when v_v.tax_rate_bps = 0 then 0 else round(v_sub::numeric * v_v.tax_rate_bps / (10000 + v_v.tax_rate_bps)) end;
    end if;
    v_sum_sub := v_sum_sub + v_sub;
    v_sum_tax := v_sum_tax + v_tax;
    v_sum_total := v_sum_total + v_sub + case when v_org.tax_mode = 'exclusive' then v_tax else 0 end;
    v_lines := v_lines || jsonb_build_object('variant_id', v_v.id, 'name', v_v.pname, 'variant', v_v.vname, 'quantity', v_qty,
      'unit_price_minor', v_v.price_minor, 'total_minor', v_sub + case when v_org.tax_mode = 'exclusive' then v_tax else 0 end);
  end loop;

  if v_method = 'pickup_point' then
    -- Delivered to one of the shop's own pick-up points: the point's fee, no pin needed.
    if not v_shop.delivery_enabled then raise exception 'This shop does not deliver' using errcode = '22023'; end if;
    if coalesce(p_input ->> 'pickup_point_id', '') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Choose a pick-up point' using errcode = '22023'; end if;
    select * into v_point from public.pickup_points
     where id = (p_input ->> 'pickup_point_id')::uuid and org_id = v_org.id and active;
    if v_point.id is null then raise exception 'Choose a pick-up point' using errcode = '22023'; end if;
    v_fee := v_point.fee_minor;
  elsif v_method = 'delivery' then
    if not v_shop.delivery_enabled then raise exception 'This shop does not deliver' using errcode = '22023'; end if;
    if (p_input ->> 'lat') is null or (p_input ->> 'lng') is null then raise exception 'Drop a pin for your delivery address' using errcode = '22023'; end if;
    v_km := public.haversine_km(v_shop.location_lat, v_shop.location_lng, (p_input ->> 'lat')::double precision, (p_input ->> 'lng')::double precision);
    v_fee := public.delivery_fee_for(v_shop.delivery_bands, v_km);
    if v_fee is null then
      raise exception 'Sorry, this address is outside the delivery area (% km away)', round(v_km::numeric, 1) using errcode = '22023';
    end if;
  elsif v_method = 'pickup' then
    if not v_shop.pickup_enabled then raise exception 'This shop does not offer pickup' using errcode = '22023'; end if;
  else
    raise exception 'Choose delivery or pickup' using errcode = '22023';
  end if;

  v_total := v_sum_total + v_fee;
  v_policy := public._policy_json(v_org.id);
  v_deposit := public._deposit_due(v_policy, v_total, v_fee, v_org.base_currency);

  return jsonb_build_object('currency', v_org.base_currency, 'tax_mode', v_org.tax_mode, 'lines', v_lines,
    'subtotal_minor', v_sum_sub, 'tax_minor', v_sum_tax, 'delivery_fee_minor', v_fee,
    'distance_km', case when v_km is null then null else round(v_km::numeric, 1) end,
    'total_minor', v_total,
    'deposit_due_minor', v_deposit,
    'balance_on_delivery_minor', v_total - v_deposit,
    'payment_mode', v_policy ->> 'payment_mode',
    'pickup_point', case when v_point.id is null then null else jsonb_build_object('id', v_point.id, 'name', v_point.name,
      'area', v_point.area, 'hours', v_point.hours, 'fee_minor', v_point.fee_minor) end);
end $$;

-- Guest checkout. Same as 20261120000007 plus: pick-up point delivery, the payment
-- policy (deposit due now, no cash on delivery when the shop needs prepayment) and a
-- snapshot of the policy the buyer agreed to.
create or replace function public.storefront_place_order(p_slug text, p_input jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_shop public.shop_settings;
  v_quote jsonb;
  v_phone text := p_input ->> 'phone_e164';
  v_name text := trim(coalesce(p_input ->> 'name', ''));
  v_customer uuid;
  v_order uuid;
  v_token text;
  v_pay text := coalesce(p_input ->> 'payment', 'mpesa');
  v_method text := coalesce(p_input ->> 'method', 'pickup');
  v_core_method text;
  v_row public.orders;
  v_fee bigint;
  v_policy jsonb;
  v_deposit bigint;
  v_point jsonb;
  v_address jsonb := '{}'::jsonb;
begin
  v_shop := public._shop_by_slug(p_slug);
  if v_shop.org_id is null then raise exception 'Shop not found' using errcode = 'P0002'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then raise exception 'Missing idempotency key' using errcode = '22023'; end if;

  -- Same key → same order (double taps, flaky networks).
  select * into v_row from public.orders where org_id = v_shop.org_id and idempotency_key = 'sf:' || p_idempotency_key;
  if v_row.id is not null then
    return jsonb_build_object('order_id', v_row.id, 'number', v_row.number, 'tracking_token', v_row.tracking_token,
      'total_minor', v_row.total_minor, 'currency', v_row.currency, 'deposit_due_minor', v_row.deposit_due_minor);
  end if;

  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Enter a valid phone number' using errcode = '22023'; end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Enter your name' using errcode = '22023'; end if;
  if v_pay not in ('mpesa', 'cod', 'card', 'bank_transfer', 'other') then raise exception 'Choose a payment method' using errcode = '22023'; end if;
  if v_pay = 'cod' and not v_shop.cod_enabled then raise exception 'Cash on delivery is not available here' using errcode = '22023'; end if;

  perform public._rate_limit('sf:ip:' || public._client_ip(), 20, interval '1 hour');
  perform public._rate_limit('sf:phone:' || v_shop.org_id || ':' || v_phone, 6, interval '1 hour');
  perform public._rate_limit('sf:shop:' || v_shop.org_id, 500, interval '1 hour');

  v_quote := public.storefront_quote(p_slug, p_input);
  v_fee := (v_quote ->> 'delivery_fee_minor')::bigint;
  v_deposit := (v_quote ->> 'deposit_due_minor')::bigint;
  v_policy := public._policy_json(v_shop.org_id);
  v_point := v_quote -> 'pickup_point';

  -- The deposit is due now, so it needs a way to pay now.
  if v_pay = 'cod' and v_policy ->> 'payment_mode' = 'full_prepay' then
    raise exception 'This shop needs full payment before delivery, so cash on delivery is not available' using errcode = '22023';
  end if;
  if v_pay = 'cod' and v_deposit > 0 and v_shop.mpesa_till is null and v_shop.mpesa_paybill is null then
    raise exception 'This shop needs a deposit before delivery, so cash on delivery is not available' using errcode = '22023';
  end if;

  v_core_method := case when v_method = 'pickup' then 'pickup' else 'delivery' end;
  if v_method = 'delivery' then
    v_address := jsonb_build_object(
      'lat', (p_input ->> 'lat')::double precision, 'lng', (p_input ->> 'lng')::double precision,
      'line1', left(coalesce(p_input ->> 'address_line', ''), 160), 'landmark', left(coalesce(p_input ->> 'landmark', ''), 160),
      'building', left(coalesce(p_input ->> 'building', ''), 120), 'instructions', left(coalesce(p_input ->> 'instructions', ''), 300),
      'distanceKm', (v_quote ->> 'distance_km')::numeric);
  elsif v_method = 'pickup_point' and v_point is not null and jsonb_typeof(v_point) = 'object' then
    v_address := jsonb_build_object(
      'line1', v_point ->> 'name',
      'landmark', concat_ws(', ', v_point ->> 'name', nullif(v_point ->> 'area', '')),
      'instructions', left(coalesce(p_input ->> 'instructions', ''), 300),
      'pickupPointId', v_point ->> 'id');
  end if;

  select id into v_customer from public.customers where org_id = v_shop.org_id and phone_e164 = v_phone order by created_at limit 1;
  if v_customer is null then
    insert into public.customers (org_id, name, phone_e164, country_code, marketing_consent, consent_updated_at, tags)
    values (v_shop.org_id, v_name, v_phone, (select country_code from public.organisations where id = v_shop.org_id),
      coalesce((p_input ->> 'marketing_opt_in')::boolean, false), now(), array['storefront'])
    returning id into v_customer;
  elsif coalesce((p_input ->> 'marketing_opt_in')::boolean, false) then
    update public.customers set marketing_consent = true, consent_updated_at = now() where id = v_customer;
  end if;

  v_order := public._create_order_core(v_shop.org_id, jsonb_build_object(
    'status', 'pending_confirmation',
    'channel', case when p_input ->> 'channel' in ('whatsapp', 'instagram', 'facebook', 'tiktok', 'storefront') then p_input ->> 'channel' else 'storefront' end,
    'customer_id', v_customer,
    'note', nullif(left(coalesce(p_input ->> 'note', ''), 500), ''),
    'delivery_fee_minor', v_fee,
    'fulfilment', jsonb_build_object('method', v_core_method, 'recipient_name', v_name, 'recipient_phone', v_phone, 'address', v_address),
    'lines', (select jsonb_agg(jsonb_build_object('variant_id', l ->> 'variant_id', 'quantity', (l ->> 'quantity')::integer))
                from jsonb_array_elements(p_input -> 'lines') l)
  ), 'sf:' || p_idempotency_key);

  v_token := translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
  update public.orders set tracking_token = v_token, payment_preference = v_pay,
         deposit_due_minor = least(v_deposit, total_minor), delivery_policy = v_policy
   where id = v_order returning * into v_row;
  if v_method = 'pickup_point' then
    update public.fulfilments set handoff = 'pickup_point', pickup_point = v_point where order_id = v_order;
  end if;

  return jsonb_build_object('order_id', v_row.id, 'number', v_row.number, 'tracking_token', v_token,
    'total_minor', v_row.total_minor, 'currency', v_row.currency, 'deposit_due_minor', v_row.deposit_due_minor);
end $$;

-- Deposit, balance, failed attempts and handoff for the tracking page (link holder only).
create or replace function public.storefront_track_delivery(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_o public.orders;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select * into v_o from public.orders where tracking_token = p_token;
  if v_o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  return public._order_amounts(v_o.id) || jsonb_build_object(
    'agreed_policy', v_o.delivery_policy,
    'handoff', public._order_handoff(v_o.id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'actor', e.actor, 'reason', e.reason, 'note', null,
                  'attempt', e.attempt, 'forfeited_minor', e.forfeited_minor, 'created_at', e.created_at) order by e.id)
                from public.delivery_events e where e.order_id = v_o.id and e.kind in ('failed', 'picked_up', 'delivered')), '[]'::jsonb));
end $$;

-- ───────────────────────── Status changes without a staff session ─────────────────────────
-- Same rules as transition_order (status machine, stock), for rider-link actions.
create or replace function public._transition_order_core(p_order uuid, p_to public.order_status, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if not public.order_transition_allowed(v_order.status, p_to) then
    raise exception 'An order cannot move from % to %', v_order.status, p_to using errcode = '22023';
  end if;
  if not public.order_holds_reservation(v_order.status) and public.order_holds_reservation(p_to) then
    perform public._order_stock(p_order, 'reserve');
  elsif public.order_holds_reservation(v_order.status) and p_to = 'cancelled' then
    perform public._order_stock(p_order, 'release');
  elsif public.order_holds_reservation(v_order.status) and p_to in ('dispatched', 'delivered') then
    perform public._order_stock(p_order, 'commit');
  end if;
  update public.orders set status = p_to where id = p_order;
  if p_to = 'delivered' then
    update public.fulfilments set delivered_at = now() where order_id = p_order;
  end if;
  insert into public.order_status_history (org_id, order_id, from_status, to_status, note)
  values (v_order.org_id, p_order, v_order.status, p_to, nullif(trim(coalesce(p_note, '')), ''));
end $$;

-- ───────────────────────── Failed delivery ─────────────────────────
create or replace function public._failed_reason_label(p_reason text)
returns text language sql immutable as $$
  select case p_reason
    when 'buyer_unreachable' then 'Buyer could not be reached'
    when 'buyer_refused' then 'Buyer refused the order'
    when 'wrong_address' then 'Wrong or incomplete address'
    when 'buyer_rescheduled' then 'Buyer asked to come another time'
    when 'rider_issue' then 'Rider could not make it'
    when 'shop_issue' then 'Problem on the shop''s side'
    else 'Other' end
$$;

-- Applies the policy the buyer agreed to: counts the attempt and, for buyer-caused
-- failures under a "buyer pays" policy, keeps the delivery fee from the paid deposit.
create or replace function public._apply_failed_delivery(p_order uuid, p_reason text, p_note text, p_actor text, p_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders;
  v_method public.fulfilment_method;
  v_prior public.delivery_events;
  v_amounts jsonb;
  v_max integer;
  v_attempt integer;
  v_forfeit bigint := 0;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 300), '');
begin
  select * into v_o from public.orders where id = p_order for update;
  if v_o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  v_max := coalesce((v_o.delivery_policy ->> 'max_delivery_attempts')::integer, (public._policy_json(v_o.org_id) ->> 'max_delivery_attempts')::integer);
  if p_key is not null then
    select * into v_prior from public.delivery_events where org_id = v_o.org_id and idempotency_key = p_key;
    if v_prior.id is not null then
      return jsonb_build_object('attempt', v_prior.attempt, 'forfeit_minor', v_prior.forfeited_minor, 'final', v_prior.attempt >= v_max);
    end if;
  end if;
  if p_reason is null or p_reason not in ('buyer_unreachable', 'buyer_refused', 'wrong_address', 'buyer_rescheduled', 'rider_issue', 'shop_issue', 'other') then
    raise exception 'Choose why the delivery failed' using errcode = '22023';
  end if;
  if v_o.status <> 'dispatched' then
    raise exception 'Only an order that is out for delivery can have a failed delivery' using errcode = '22023';
  end if;
  select method into v_method from public.fulfilments where order_id = p_order;
  if v_method is distinct from 'delivery' then raise exception 'Pickup orders are not delivered' using errcode = '22023'; end if;
  if v_o.delivery_attempts >= v_max then
    raise exception 'All % delivery attempts have been used', v_max using errcode = '22023';
  end if;

  v_attempt := v_o.delivery_attempts + 1;
  v_amounts := public._order_amounts(p_order);
  -- Never for the shop's or the rider's own failures, and never beyond what is left of the paid deposit.
  if v_o.delivery_policy ->> 'failed_delivery_payer' = 'buyer'
     and p_reason in ('buyer_unreachable', 'buyer_refused', 'wrong_address', 'buyer_rescheduled') then
    v_forfeit := least(greatest(v_o.delivery_fee_minor, 0), greatest(0, (v_amounts ->> 'deposit_paid_minor')::bigint - v_o.forfeited_fee_minor));
  end if;

  update public.orders set delivery_attempts = v_attempt, forfeited_fee_minor = forfeited_fee_minor + v_forfeit where id = p_order;
  insert into public.delivery_events (org_id, order_id, kind, actor, reason, note, attempt, forfeited_minor, idempotency_key)
  values (v_o.org_id, p_order, 'failed', p_actor, p_reason, v_note, v_attempt, v_forfeit, p_key);
  -- Same-status history row: the order stays out for delivery (goods are with the rider or on the way back).
  insert into public.order_status_history (org_id, order_id, from_status, to_status, note)
  values (v_o.org_id, p_order, v_o.status, v_o.status,
    format('Delivery attempt %s of %s failed: %s%s%s', v_attempt, v_max, public._failed_reason_label(p_reason),
      case when v_forfeit > 0 then '. Delivery fee kept from deposit per policy.' else '.' end,
      case when v_note is not null then ' ' || v_note else '' end));
  if v_attempt >= v_max then
    update public.rider_links set revoked_at = now() where order_id = p_order and revoked_at is null;
  end if;
  return jsonb_build_object('attempt', v_attempt, 'forfeit_minor', v_forfeit, 'final', v_attempt >= v_max);
end $$;

create or replace function public.mark_delivery_failed(p_order uuid, p_reason text, p_note text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select org_id into v_org from public.orders where id = p_order;
  if v_org is null or not public.is_member(v_org) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_org, 'fulfilment.update');
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'Missing idempotency key' using errcode = '22023'; end if;
  return public._apply_failed_delivery(p_order, p_reason, p_note, 'staff', p_idempotency_key);
end $$;

-- ───────────────────────── Handoff (own rider / pick-up point / courier) ─────────────────────────
create or replace function public.set_order_handoff(p_order uuid, p_input jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders;
  v_f public.fulfilments;
  v_kind text := p_input ->> 'kind';
  v_point public.pickup_points;
  v_carrier text := nullif(left(trim(coalesce(p_input ->> 'carrier', '')), 80), '');
begin
  select * into v_o from public.orders where id = p_order for update;
  if v_o.id is null or not public.is_member(v_o.org_id) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_o.org_id, 'fulfilment.update');
  if v_o.status in ('delivered', 'cancelled', 'refunded') then raise exception 'This order is closed' using errcode = '22023'; end if;
  select * into v_f from public.fulfilments where order_id = p_order;
  if v_f.method <> 'delivery' then raise exception 'Handoff options are for delivery orders' using errcode = '22023'; end if;
  if v_kind = 'pickup_point' then
    if coalesce(p_input ->> 'pickup_point_id', '') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Choose an active pick-up point' using errcode = '22023'; end if;
    select * into v_point from public.pickup_points where id = (p_input ->> 'pickup_point_id')::uuid and org_id = v_o.org_id and active;
    if v_point.id is null then raise exception 'Choose an active pick-up point' using errcode = '22023'; end if;
    update public.fulfilments set handoff = 'pickup_point', carrier = null,
      pickup_point = jsonb_build_object('id', v_point.id, 'name', v_point.name, 'area', v_point.area, 'hours', v_point.hours, 'fee_minor', v_point.fee_minor)
     where order_id = p_order;
  elsif v_kind = 'courier' then
    if v_carrier is null then raise exception 'Enter the courier''s name' using errcode = '22023'; end if;
    update public.fulfilments set handoff = 'courier', carrier = v_carrier, pickup_point = null,
      tracking_ref = nullif(left(trim(coalesce(p_input ->> 'tracking_ref', '')), 120), '')
     where order_id = p_order;
  elsif v_kind = 'own_rider' then
    update public.fulfilments set handoff = 'own_rider', carrier = null, pickup_point = null where order_id = p_order;
  else
    raise exception 'Choose how the order is handed over' using errcode = '22023';
  end if;
  insert into public.delivery_events (org_id, order_id, kind, actor, note) values (v_o.org_id, p_order, 'handoff_set', 'staff', v_kind);
end $$;

-- ───────────────────────── Rider links ─────────────────────────
create or replace function public.create_rider_link(p_order uuid, p_rider_name text, p_hours integer)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_o public.orders;
  v_method public.fulfilment_method;
  v_token text;
  v_expires timestamptz;
  v_name text := nullif(left(trim(coalesce(p_rider_name, '')), 60), '');
  v_max integer;
begin
  select * into v_o from public.orders where id = p_order for update;
  if v_o.id is null or not public.is_member(v_o.org_id) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_o.org_id, 'fulfilment.update');
  if v_o.status not in ('confirmed', 'preparing', 'ready', 'dispatched') then
    raise exception 'Confirm the order before sending it with a rider' using errcode = '22023';
  end if;
  select method into v_method from public.fulfilments where order_id = p_order;
  if v_method is distinct from 'delivery' then raise exception 'Rider links are for delivery orders' using errcode = '22023'; end if;
  v_max := (public._order_amounts(p_order) ->> 'max_attempts')::integer;
  if v_o.delivery_attempts >= v_max then raise exception 'All delivery attempts for this order have been used' using errcode = '22023'; end if;

  update public.rider_links set revoked_at = now() where order_id = p_order and revoked_at is null;
  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_'); -- 192 bits, 32 characters
  v_expires := now() + make_interval(hours => least(72, greatest(1, coalesce(p_hours, 12))));
  insert into public.rider_links (org_id, order_id, token_hash, rider_name, expires_at)
  values (v_o.org_id, p_order, encode(digest(v_token, 'sha256'), 'hex'), v_name, v_expires);
  update public.fulfilments set handoff = 'own_rider' where order_id = p_order and handoff is distinct from 'pickup_point';
  insert into public.delivery_events (org_id, order_id, kind, actor, note) values (v_o.org_id, p_order, 'rider_link_created', 'staff', v_name);
  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end $$;

create or replace function public.revoke_rider_link(p_order uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select org_id into v_org from public.orders where id = p_order;
  if v_org is null or not public.is_member(v_org) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_org, 'fulfilment.update');
  update public.rider_links set revoked_at = now() where order_id = p_order and revoked_at is null;
  if found then
    insert into public.delivery_events (org_id, order_id, kind, actor) values (v_org, p_order, 'rider_link_revoked', 'staff');
  end if;
end $$;

-- Resolve a rider token: well-formed, known, not revoked, not expired.
create or replace function public._rider_link(p_token text)
returns public.rider_links language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare v_link public.rider_links;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then raise exception 'This rider link is not valid' using errcode = 'P0002'; end if;
  select * into v_link from public.rider_links where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if v_link.id is null then raise exception 'This rider link is not valid' using errcode = 'P0002'; end if;
  if v_link.revoked_at is not null then raise exception 'The shop has cancelled this rider link' using errcode = 'P0001'; end if;
  if v_link.expires_at <= now() then raise exception 'This rider link has expired. Ask the shop for a new one.' using errcode = 'P0001'; end if;
  return v_link;
end $$;

-- What the rider sees: pickup, drop pin, first name; the buyer phone only after accepting.
create or replace function public._rider_job_json(p_link public.rider_links)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders;
  v_f public.fulfilments;
  v_shop public.shop_settings;
  v_org public.organisations;
  v_amounts jsonb;
  v_phone text;
  v_accepted boolean := p_link.accepted_at is not null;
begin
  select * into v_o from public.orders where id = p_link.order_id;
  select * into v_f from public.fulfilments where order_id = v_o.id;
  select * into v_shop from public.shop_settings where org_id = v_o.org_id;
  select * into v_org from public.organisations where id = v_o.org_id;
  v_amounts := public._order_amounts(v_o.id);
  v_phone := coalesce(v_f.recipient_phone, v_o.customer_phone);
  return jsonb_build_object(
    'order_number', v_o.number, 'shop_name', v_org.name, 'status', v_o.status, 'accepted', v_accepted,
    'rider_name', coalesce(p_link.accepted_name, p_link.rider_name), 'expires_at', p_link.expires_at,
    'pickup', jsonb_build_object('label', v_shop.location_label, 'lat', v_shop.location_lat, 'lng', v_shop.location_lng,
                'shop_phone', v_shop.whatsapp_e164),
    'drop', jsonb_build_object('lat', (v_f.address ->> 'lat')::double precision, 'lng', (v_f.address ->> 'lng')::double precision,
              'landmark', nullif(v_f.address ->> 'landmark', ''), 'address_line', nullif(v_f.address ->> 'line1', ''),
              'building', nullif(v_f.address ->> 'building', ''), 'instructions', nullif(v_f.address ->> 'instructions', ''),
              'pickup_point', v_f.pickup_point),
    'buyer_name', coalesce(nullif(split_part(coalesce(v_f.recipient_name, v_o.customer_name, ''), ' ', 1), ''), 'Buyer'),
    'buyer_phone', case when v_accepted then v_phone else public._mask_phone(v_phone) end,
    'phone_masked', not v_accepted,
    'item_count', (select coalesce(sum(quantity), 0) from public.order_lines where order_id = v_o.id),
    'collect_minor', (v_amounts ->> 'balance_due_minor')::bigint,
    'deposit_outstanding_minor', (v_amounts ->> 'deposit_outstanding_minor')::bigint,
    'currency', v_o.currency, 'locale', v_org.locale,
    'attempts', v_o.delivery_attempts, 'max_attempts', (v_amounts ->> 'max_attempts')::integer);
end $$;

create or replace function public.rider_job(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._rate_limit('rider:view:' || public._client_ip(), 300, interval '1 hour');
  return public._rider_job_json(public._rider_link(p_token));
end $$;

create or replace function public.rider_accept(p_token text, p_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_link public.rider_links;
  v_name text := nullif(left(trim(coalesce(p_name, '')), 60), '');
begin
  perform public._rate_limit('rider:act:' || public._client_ip(), 60, interval '1 hour');
  v_link := public._rider_link(p_token);
  if v_name is null or length(v_name) < 2 then raise exception 'Enter your name so the shop knows who has the order' using errcode = '22023'; end if;
  if v_link.accepted_at is null then
    update public.rider_links set accepted_at = now(), accepted_name = v_name where id = v_link.id returning * into v_link;
    update public.fulfilments set assignee = v_name where order_id = v_link.order_id;
    insert into public.delivery_events (org_id, order_id, kind, actor, note) values (v_link.org_id, v_link.order_id, 'rider_accepted', 'rider', v_name);
  end if;
  return public._rider_job_json(v_link);
end $$;

create or replace function public.rider_update(p_token text, p_action text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_link public.rider_links;
  v_o public.orders;
  v_amounts jsonb;
begin
  perform public._rate_limit('rider:act:' || public._client_ip(), 60, interval '1 hour');
  v_link := public._rider_link(p_token);
  if v_link.accepted_at is null then raise exception 'Accept the job first' using errcode = '22023'; end if;
  select * into v_o from public.orders where id = v_link.order_id for update;
  if v_o.status in ('cancelled', 'refunded') then raise exception 'The shop has cancelled this order' using errcode = '22023'; end if;
  if v_o.status = 'delivered' and p_action <> 'delivered' then raise exception 'This order has already been delivered' using errcode = '22023'; end if;

  if p_action in ('picked_up', 'delivered') and v_o.status not in ('dispatched', 'delivered') then
    v_amounts := public._order_amounts(v_o.id);
    if (v_amounts ->> 'deposit_outstanding_minor')::bigint > 0 then
      raise exception 'The buyer''s deposit has not been received yet. Check with the shop before collecting.' using errcode = '22023';
    end if;
    if v_o.status in ('draft', 'pending_confirmation') then raise exception 'The shop has not confirmed this order yet' using errcode = '22023'; end if;
    if v_o.status in ('confirmed', 'preparing') then perform public._transition_order_core(v_o.id, 'ready', null); end if;
    perform public._transition_order_core(v_o.id, 'dispatched', 'Picked up by rider ' || v_link.accepted_name);
    insert into public.delivery_events (org_id, order_id, kind, actor) values (v_o.org_id, v_o.id, 'picked_up', 'rider');
  end if;

  if p_action = 'delivered' then
    select * into v_o from public.orders where id = v_link.order_id;
    if v_o.status <> 'delivered' then
      perform public._transition_order_core(v_o.id, 'delivered', 'Delivered by rider ' || v_link.accepted_name);
      insert into public.delivery_events (org_id, order_id, kind, actor) values (v_o.org_id, v_o.id, 'delivered', 'rider');
    end if;
  elsif p_action = 'failed' then
    perform public._apply_failed_delivery(v_o.id, p_reason, null, 'rider', null);
  elsif p_action <> 'picked_up' then
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  select * into v_link from public.rider_links where id = v_link.id;
  return public._rider_job_json(v_link);
end $$;

-- ───────────────────────── Merchant view of an order's deposit & delivery ─────────────────────────
create or replace function public.order_delivery(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order;
  if v_o.id is null or not public.is_member(v_o.org_id) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  return public._order_amounts(p_order) || jsonb_build_object(
    'currency', v_o.currency, 'total_minor', v_o.total_minor, 'delivery_fee_minor', v_o.delivery_fee_minor,
    'agreed_policy', v_o.delivery_policy,
    'handoff', public._order_handoff(p_order),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'actor', e.actor, 'reason', e.reason, 'note', e.note,
                  'attempt', e.attempt, 'forfeited_minor', e.forfeited_minor, 'created_at', e.created_at) order by e.id)
                from public.delivery_events e where e.order_id = p_order), '[]'::jsonb),
    'rider_link', (select jsonb_build_object('rider_name', l.rider_name, 'expires_at', l.expires_at, 'accepted_at', l.accepted_at,
                     'accepted_name', l.accepted_name, 'revoked_at', l.revoked_at, 'created_at', l.created_at)
                     from public.rider_links l where l.order_id = p_order order by l.created_at desc limit 1));
end $$;

-- Amount the M-Pesa STK prompt should charge now (unpaid deposit, else the balance). Service role only.
create or replace function public.order_amount_due_now(p_order uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select (public._order_amounts(p_order) ->> 'due_now_minor')::bigint
$$;

-- ───────────────────────── Privileges ─────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated by default, so every
-- function here is closed first and then opened to exactly the roles that need it.
revoke execute on function
  public._currency_exponent(text), public._default_policy(), public._policy_json(uuid),
  public._deposit_due(jsonb, bigint, bigint, text), public._mask_phone(text), public._order_amounts(uuid), public._order_handoff(uuid),
  public.save_shop_policy(uuid, jsonb), public.save_pickup_point(uuid, jsonb), public.archive_pickup_point(uuid, uuid),
  public.storefront_checkout_options(text), public.storefront_track_delivery(text),
  public._transition_order_core(uuid, public.order_status, text), public._failed_reason_label(text),
  public._apply_failed_delivery(uuid, text, text, text, text), public.mark_delivery_failed(uuid, text, text, text),
  public.set_order_handoff(uuid, jsonb), public.create_rider_link(uuid, text, integer), public.revoke_rider_link(uuid),
  public._rider_link(text), public._rider_job_json(public.rider_links), public.rider_job(text), public.rider_accept(text, text),
  public.rider_update(text, text, text), public.order_delivery(uuid), public.order_amount_due_now(uuid)
  from public, anon, authenticated;

-- Staff (permission checked inside each function).
grant execute on function
  public.save_shop_policy(uuid, jsonb), public.save_pickup_point(uuid, jsonb), public.archive_pickup_point(uuid, uuid),
  public.mark_delivery_failed(uuid, text, text, text), public.set_order_handoff(uuid, jsonb),
  public.create_rider_link(uuid, text, integer), public.revoke_rider_link(uuid), public.order_delivery(uuid)
  to authenticated;

-- Buyers and riders (no account; the slug, tracking token or rider token is the key).
grant execute on function
  public.storefront_checkout_options(text), public.storefront_track_delivery(text),
  public.rider_job(text), public.rider_accept(text, text), public.rider_update(text, text, text)
  to anon, authenticated;

-- Server-side code (Edge Functions with the service role).
grant execute on function public.order_amount_due_now(uuid), public._deposit_due(jsonb, bigint, bigint, text),
  public._currency_exponent(text), public._mask_phone(text) to service_role;
