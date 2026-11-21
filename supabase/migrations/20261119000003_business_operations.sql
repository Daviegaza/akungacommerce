-- Server-side business operations. These are the only write paths for orders,
-- stock, payments, refunds and team membership. Every function:
--   * runs as security definer with a pinned search_path,
--   * checks membership + role permission for the target organisation,
--   * validates org ownership of every referenced row,
--   * is idempotent where a client may retry (idempotency keys).

-- ───────────────────────── Internal stock primitive ─────────────────────────
create or replace function public._stock_move(
  p_org uuid, p_variant uuid, p_location uuid, p_kind public.stock_movement_kind,
  p_on_hand_delta integer, p_reserved_delta integer,
  p_reason text, p_note text, p_order uuid, p_idem text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_level public.inventory_levels;
begin
  insert into public.inventory_levels (org_id, variant_id, location_id)
  values (p_org, p_variant, p_location)
  on conflict (variant_id, location_id) do nothing;

  select * into v_level from public.inventory_levels
   where variant_id = p_variant and location_id = p_location and org_id = p_org
   for update;
  if not found then
    raise exception 'Stock level not found for this business' using errcode = '42501';
  end if;

  if v_level.on_hand + p_on_hand_delta < 0 then
    raise exception 'Stock cannot go below zero' using errcode = '23514';
  end if;
  if v_level.reserved + p_reserved_delta < 0 then
    raise exception 'Cannot release more than is reserved' using errcode = '23514';
  end if;
  if v_level.reserved + p_reserved_delta > v_level.on_hand + p_on_hand_delta then
    raise exception 'Not enough stock available (on hand %, reserved %)', v_level.on_hand, v_level.reserved
      using errcode = '23514';
  end if;

  update public.inventory_levels
     set on_hand = on_hand + p_on_hand_delta,
         reserved = reserved + p_reserved_delta,
         updated_at = now()
   where variant_id = p_variant and location_id = p_location;

  insert into public.stock_movements (org_id, variant_id, location_id, kind, on_hand_delta, reserved_delta, reason, note, order_id, idempotency_key)
  values (p_org, p_variant, p_location, p_kind, p_on_hand_delta, p_reserved_delta, p_reason, p_note, p_order, p_idem);
end $$;
revoke all on function public._stock_move(uuid, uuid, uuid, public.stock_movement_kind, integer, integer, text, text, uuid, text) from public, anon, authenticated;

create or replace function public._default_location(p_org uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.locations where org_id = p_org and is_default
$$;
revoke all on function public._default_location(uuid) from public, anon, authenticated;

-- Apply a stock action to every stock-tracked line of an order.
create or replace function public._order_stock(p_order uuid, p_action text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_line record;
  v_org uuid;
  v_loc uuid;
begin
  select org_id into v_org from public.orders where id = p_order;
  v_loc := public._default_location(v_org);
  for v_line in select * from public.order_lines where order_id = p_order and track_stock and variant_id is not null order by position loop
    if p_action = 'reserve' then
      perform public._stock_move(v_org, v_line.variant_id, v_loc, 'reservation', 0, v_line.quantity, 'order', null, p_order, null);
    elsif p_action = 'release' then
      perform public._stock_move(v_org, v_line.variant_id, v_loc, 'release', 0, -v_line.quantity, 'order_cancelled', null, p_order, null);
    elsif p_action = 'commit' then
      perform public._stock_move(v_org, v_line.variant_id, v_loc, 'sale', -v_line.quantity, -v_line.quantity, 'order_fulfilled', null, p_order, null);
    end if;
  end loop;
end $$;
revoke all on function public._order_stock(uuid, text) from public, anon, authenticated;

create or replace function public.order_transition_allowed(p_from public.order_status, p_to public.order_status)
returns boolean language sql immutable as $$
  select case p_from
    when 'draft' then p_to in ('pending_confirmation', 'confirmed', 'cancelled')
    when 'pending_confirmation' then p_to in ('confirmed', 'cancelled')
    when 'confirmed' then p_to in ('preparing', 'ready', 'cancelled')
    when 'preparing' then p_to in ('ready', 'cancelled')
    when 'ready' then p_to in ('dispatched', 'delivered', 'cancelled')
    when 'dispatched' then p_to in ('delivered')
    else false
  end
$$;

create or replace function public.order_holds_reservation(p_status public.order_status)
returns boolean language sql immutable as $$
  select p_status in ('pending_confirmation', 'confirmed', 'preparing', 'ready')
$$;

-- ───────────────────────── Organisations ─────────────────────────
create or replace function public.create_organisation(
  p_name text, p_country text, p_timezone text, p_locale text, p_currency text,
  p_business_type text default null, p_tax_mode public.tax_mode default 'exclusive'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_email text;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if (select count(*) from public.memberships where user_id = auth.uid() and role = 'owner') >= 10 then
    raise exception 'Organisation limit reached' using errcode = '54000';
  end if;
  insert into public.organisations (name, country_code, timezone, locale, base_currency, business_type, tax_mode)
  values (trim(p_name), upper(p_country), p_timezone, p_locale, upper(p_currency), p_business_type, p_tax_mode)
  returning id into v_org;

  select email into v_email from auth.users where id = auth.uid();
  insert into public.memberships (org_id, user_id, role, email, display_name)
  values (v_org, auth.uid(), 'owner', v_email, split_part(coalesce(v_email, 'Owner'), '@', 1));

  insert into public.locations (org_id, name, is_default) values (v_org, 'Main location', true);
  return v_org;
end $$;

-- ───────────────────────── Team ─────────────────────────
create or replace function public.add_member_by_email(p_org uuid, p_email text, p_role public.member_role)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  perform public.require_permission(p_org, 'team.manage');
  if p_role = 'owner' and public.member_role_in(p_org) <> 'owner' then
    raise exception 'Only an owner can add another owner' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    -- Same message whether or not the address exists elsewhere, to avoid account enumeration.
    raise exception 'That person needs to create an Akunga account first, then you can add them.' using errcode = 'P0002';
  end if;
  insert into public.memberships (org_id, user_id, role, email, display_name)
  values (p_org, v_user, p_role, lower(trim(p_email)), split_part(lower(trim(p_email)), '@', 1))
  on conflict (org_id, user_id) do nothing;
  return v_user;
end $$;

create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role public.member_role)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_current public.member_role;
begin
  perform public.require_permission(p_org, 'team.manage');
  select role into v_current from public.memberships where org_id = p_org and user_id = p_user for update;
  if v_current is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if (v_current = 'owner' or p_role = 'owner') and public.member_role_in(p_org) <> 'owner' then
    raise exception 'Only an owner can change owner access' using errcode = '42501';
  end if;
  if v_current = 'owner' and p_role <> 'owner'
     and (select count(*) from public.memberships where org_id = p_org and role = 'owner') = 1 then
    raise exception 'A business must keep at least one owner' using errcode = '23514';
  end if;
  update public.memberships set role = p_role where org_id = p_org and user_id = p_user;
end $$;

create or replace function public.remove_member(p_org uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_current public.member_role;
begin
  perform public.require_permission(p_org, 'team.manage');
  select role into v_current from public.memberships where org_id = p_org and user_id = p_user for update;
  if v_current is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if v_current = 'owner' and public.member_role_in(p_org) <> 'owner' then
    raise exception 'Only an owner can remove an owner' using errcode = '42501';
  end if;
  if v_current = 'owner' and (select count(*) from public.memberships where org_id = p_org and role = 'owner') = 1 then
    raise exception 'A business must keep at least one owner' using errcode = '23514';
  end if;
  delete from public.memberships where org_id = p_org and user_id = p_user;
end $$;

-- ───────────────────────── Catalogue ─────────────────────────
-- Create or update a product and its variants in one transaction.
-- p_product: {id?, name, description, category, status, track_stock, tax_rate_bps, tax_code,
--             variants: [{id?, name, sku, price_minor, low_stock_threshold, is_active, cost_minor?}]}
create or replace function public.save_product(p_org uuid, p_product jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := nullif(p_product ->> 'id', '')::uuid;
  v_currency text;
  v_variant jsonb;
  v_variant_id uuid;
  v_pos integer := 0;
begin
  perform public.require_permission(p_org, 'catalogue.write');
  select base_currency into v_currency from public.organisations where id = p_org;
  if jsonb_array_length(coalesce(p_product -> 'variants', '[]'::jsonb)) = 0 then
    raise exception 'A product needs at least one variant' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.products (org_id, name, description, category, status, track_stock, tax_rate_bps, tax_code)
    values (
      p_org, p_product ->> 'name', nullif(p_product ->> 'description', ''), nullif(p_product ->> 'category', ''),
      coalesce(p_product ->> 'status', 'active')::public.product_status,
      coalesce((p_product ->> 'track_stock')::boolean, true),
      coalesce((p_product ->> 'tax_rate_bps')::integer, 0), nullif(p_product ->> 'tax_code', '')
    ) returning id into v_id;
  else
    update public.products set
      name = p_product ->> 'name',
      description = nullif(p_product ->> 'description', ''),
      category = nullif(p_product ->> 'category', ''),
      status = coalesce(p_product ->> 'status', 'active')::public.product_status,
      track_stock = coalesce((p_product ->> 'track_stock')::boolean, true),
      tax_rate_bps = coalesce((p_product ->> 'tax_rate_bps')::integer, 0),
      tax_code = nullif(p_product ->> 'tax_code', '')
    where id = v_id and org_id = p_org;
    if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  end if;

  for v_variant in select * from jsonb_array_elements(p_product -> 'variants') loop
    v_variant_id := nullif(v_variant ->> 'id', '')::uuid;
    if v_variant_id is null then
      insert into public.product_variants (org_id, product_id, name, sku, price_minor, currency, low_stock_threshold, is_active, position)
      values (
        p_org, v_id, coalesce(nullif(v_variant ->> 'name', ''), 'Default'), nullif(v_variant ->> 'sku', ''),
        (v_variant ->> 'price_minor')::bigint, v_currency,
        coalesce((v_variant ->> 'low_stock_threshold')::integer, 3),
        coalesce((v_variant ->> 'is_active')::boolean, true), v_pos
      ) returning id into v_variant_id;
      insert into public.inventory_levels (org_id, variant_id, location_id)
      values (p_org, v_variant_id, public._default_location(p_org)) on conflict do nothing;
    else
      update public.product_variants set
        name = coalesce(nullif(v_variant ->> 'name', ''), 'Default'),
        sku = nullif(v_variant ->> 'sku', ''),
        price_minor = (v_variant ->> 'price_minor')::bigint,
        low_stock_threshold = coalesce((v_variant ->> 'low_stock_threshold')::integer, 3),
        is_active = coalesce((v_variant ->> 'is_active')::boolean, true),
        position = v_pos
      where id = v_variant_id and product_id = v_id and org_id = p_org;
      if not found then raise exception 'Variant not found on this product' using errcode = 'P0002'; end if;
    end if;

    if v_variant ? 'cost_minor' and public.has_permission(p_org, 'cost.read') then
      if nullif(v_variant ->> 'cost_minor', '') is null then
        delete from public.variant_costs where variant_id = v_variant_id and org_id = p_org;
      else
        insert into public.variant_costs (variant_id, org_id, cost_minor, currency)
        values (v_variant_id, p_org, (v_variant ->> 'cost_minor')::bigint, v_currency)
        on conflict (variant_id) do update set cost_minor = excluded.cost_minor, updated_at = now();
      end if;
    end if;
    v_pos := v_pos + 1;
  end loop;
  return v_id;
end $$;

-- ───────────────────────── Inventory ─────────────────────────
create or replace function public.adjust_stock(
  p_org uuid, p_variant uuid, p_delta integer, p_reason text, p_note text, p_idempotency_key text,
  p_location uuid default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_kind public.stock_movement_kind;
begin
  perform public.require_permission(p_org, 'inventory.adjust');
  if p_delta is null or p_delta = 0 then raise exception 'Adjustment must be non-zero' using errcode = '22023'; end if;
  if p_reason not in ('stock_count', 'damaged', 'lost_or_stolen', 'expired', 'received_from_supplier', 'returned_to_supplier', 'correction') then
    raise exception 'Choose a reason for this adjustment' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'Missing idempotency key' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_movements where org_id = p_org and idempotency_key = p_idempotency_key) then
    return; -- already applied
  end if;
  v_kind := case when p_reason = 'received_from_supplier' then 'receipt' else 'adjustment' end;
  perform public._stock_move(p_org, p_variant, coalesce(p_location, public._default_location(p_org)), v_kind,
    p_delta, 0, p_reason, p_note, null, p_idempotency_key);
end $$;

-- ───────────────────────── Orders ─────────────────────────
-- p_input: {status, channel, customer_id?, note?, delivery_fee_minor?, fulfilment: {method, recipient_name?, recipient_phone?, address?},
--           lines: [{variant_id, quantity, discount_minor?}]}
-- Prices, tax and totals are computed here from the catalogue; client-sent prices are ignored.
create or replace function public.create_order(p_org uuid, p_input jsonb, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org public.organisations;
  v_order uuid;
  v_status public.order_status := coalesce(p_input ->> 'status', 'confirmed')::public.order_status;
  v_customer public.customers;
  v_line jsonb;
  v_variant record;
  v_qty integer;
  v_discount bigint;
  v_sub bigint;
  v_tax bigint;
  v_total bigint;
  v_pos integer := 0;
  v_sum_sub bigint := 0;
  v_sum_tax bigint := 0;
  v_sum_total bigint := 0;
  v_sum_discount bigint := 0;
  v_fee bigint := coalesce((p_input ->> 'delivery_fee_minor')::bigint, 0);
  v_number integer;
begin
  perform public.require_permission(p_org, 'orders.create');
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'Missing idempotency key' using errcode = '22023';
  end if;
  select id into v_order from public.orders where org_id = p_org and idempotency_key = p_idempotency_key;
  if v_order is not null then return v_order; end if;

  if v_status not in ('draft', 'pending_confirmation', 'confirmed') then
    raise exception 'New orders start as draft, awaiting confirmation or confirmed' using errcode = '22023';
  end if;
  if v_fee < 0 then raise exception 'Delivery fee cannot be negative' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_input -> 'lines', '[]'::jsonb)) = 0 then
    raise exception 'An order needs at least one line' using errcode = '22023';
  end if;

  select * into v_org from public.organisations where id = p_org;
  if nullif(p_input ->> 'customer_id', '') is not null then
    select * into v_customer from public.customers where id = (p_input ->> 'customer_id')::uuid and org_id = p_org;
    if v_customer.id is null then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  end if;

  perform set_config('akunga.allow_counter', 'on', true);
  update public.organisations set next_order_number = next_order_number + 1
   where id = p_org returning next_order_number - 1 into v_number;
  perform set_config('akunga.allow_counter', 'off', true);

  insert into public.orders (org_id, number, status, channel, currency, tax_mode, customer_id, customer_name, customer_phone,
    subtotal_minor, discount_minor, tax_minor, delivery_fee_minor, total_minor, note, idempotency_key)
  values (p_org, v_number, v_status, coalesce(p_input ->> 'channel', 'direct'), v_org.base_currency, v_org.tax_mode,
    v_customer.id, v_customer.name, v_customer.phone_e164, 0, 0, 0, v_fee, 0, nullif(p_input ->> 'note', ''), p_idempotency_key)
  on conflict (org_id, idempotency_key) do nothing
  returning id into v_order;
  if v_order is null then
    -- A concurrent retry with the same key won the race.
    select id into v_order from public.orders where org_id = p_org and idempotency_key = p_idempotency_key;
    return v_order;
  end if;

  for v_line in select * from jsonb_array_elements(p_input -> 'lines') loop
    v_qty := (v_line ->> 'quantity')::integer;
    v_discount := coalesce((v_line ->> 'discount_minor')::bigint, 0);
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be at least 1' using errcode = '22023'; end if;
    if v_discount < 0 then raise exception 'Discount cannot be negative' using errcode = '22023'; end if;

    select pv.id, pv.name as variant_name, pv.sku, pv.price_minor, pv.currency, p.name as product_name,
           p.tax_rate_bps, p.track_stock
      into v_variant
      from public.product_variants pv join public.products p on p.id = pv.product_id
     where pv.id = (v_line ->> 'variant_id')::uuid and pv.org_id = p_org
       and pv.is_active and p.status = 'active';
    if v_variant.id is null then raise exception 'A product in this order is unavailable' using errcode = 'P0002'; end if;
    if v_variant.currency <> v_org.base_currency then
      raise exception 'Cannot mix % and % in one order', v_variant.currency, v_org.base_currency using errcode = '22023';
    end if;

    v_sub := v_variant.price_minor * v_qty - v_discount;
    if v_sub < 0 then raise exception 'Discount cannot exceed the line amount' using errcode = '22023'; end if;
    if v_org.tax_mode = 'exclusive' then
      v_tax := round(v_sub::numeric * v_variant.tax_rate_bps / 10000);
      v_total := v_sub + v_tax;
    else
      v_tax := case when v_variant.tax_rate_bps = 0 then 0
                    else round(v_sub::numeric * v_variant.tax_rate_bps / (10000 + v_variant.tax_rate_bps)) end;
      v_total := v_sub;
    end if;

    insert into public.order_lines (org_id, order_id, variant_id, product_name, variant_name, sku, quantity, unit_price_minor,
      currency, tax_rate_bps, discount_minor, subtotal_minor, tax_minor, total_minor, track_stock, position)
    values (p_org, v_order, v_variant.id, v_variant.product_name, v_variant.variant_name, v_variant.sku, v_qty, v_variant.price_minor,
      v_variant.currency, v_variant.tax_rate_bps, v_discount, v_sub, v_tax, v_total, v_variant.track_stock, v_pos);

    v_sum_sub := v_sum_sub + v_sub;
    v_sum_tax := v_sum_tax + v_tax;
    v_sum_total := v_sum_total + v_total;
    v_sum_discount := v_sum_discount + v_discount;
    v_pos := v_pos + 1;
  end loop;

  update public.orders set subtotal_minor = v_sum_sub, discount_minor = v_sum_discount, tax_minor = v_sum_tax,
         total_minor = v_sum_total + v_fee
   where id = v_order;

  insert into public.fulfilments (order_id, org_id, method, recipient_name, recipient_phone, address)
  values (v_order, p_org,
    coalesce(p_input #>> '{fulfilment,method}', 'pickup')::public.fulfilment_method,
    nullif(p_input #>> '{fulfilment,recipient_name}', ''),
    nullif(p_input #>> '{fulfilment,recipient_phone}', ''),
    coalesce(p_input #> '{fulfilment,address}', '{}'::jsonb));

  insert into public.order_status_history (org_id, order_id, from_status, to_status, note)
  values (p_org, v_order, null, v_status, 'Order created');

  if public.order_holds_reservation(v_status) then
    perform public._order_stock(v_order, 'reserve');
  end if;
  return v_order;
end $$;

create or replace function public.transition_order(p_order uuid, p_to public.order_status, p_note text default null)
returns public.order_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null or not public.is_member(v_order.org_id) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  perform public.require_permission(v_order.org_id, case when p_to = 'cancelled' then 'orders.create' else 'orders.transition' end);
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
  return p_to;
end $$;

create or replace function public.update_fulfilment(p_order uuid, p_patch jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select org_id into v_org from public.orders where id = p_order;
  if v_org is null or not public.is_member(v_org) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_org, 'fulfilment.update');
  update public.fulfilments set
    method = coalesce((p_patch ->> 'method')::public.fulfilment_method, method),
    recipient_name = case when p_patch ? 'recipient_name' then nullif(p_patch ->> 'recipient_name', '') else recipient_name end,
    recipient_phone = case when p_patch ? 'recipient_phone' then nullif(p_patch ->> 'recipient_phone', '') else recipient_phone end,
    address = case when p_patch ? 'address' then coalesce(p_patch -> 'address', '{}'::jsonb) else address end,
    assignee = case when p_patch ? 'assignee' then nullif(p_patch ->> 'assignee', '') else assignee end,
    tracking_ref = case when p_patch ? 'tracking_ref' then nullif(p_patch ->> 'tracking_ref', '') else tracking_ref end,
    proof_of_delivery = case when p_patch ? 'proof_of_delivery' then nullif(p_patch ->> 'proof_of_delivery', '') else proof_of_delivery end
  where order_id = p_order;
end $$;

-- ───────────────────────── Payments ─────────────────────────
-- Manual payments are always recorded as manual_unverified. Provider-verified payments
-- can only be written by the payment webhook (service role), never by a browser.
create or replace function public.record_manual_payment(
  p_order uuid, p_amount_minor bigint, p_currency text, p_method text,
  p_external_ref text, p_received_at timestamptz, p_note text, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders;
  v_id uuid;
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

  insert into public.payments (org_id, order_id, provider, method, amount_minor, currency, status, verification,
    external_ref, note, received_at, idempotency_key)
  values (v_order.org_id, p_order, 'manual', p_method, p_amount_minor, v_order.currency, 'succeeded', 'manual_unverified',
    nullif(trim(coalesce(p_external_ref, '')), ''), nullif(trim(coalesce(p_note, '')), ''), coalesce(p_received_at, now()), p_idempotency_key)
  returning id into v_id;
  return v_id;
end $$;

-- Mark a manually recorded payment as reversed (entered in error, bounced cheque...). History is kept.
create or replace function public.reverse_payment(p_payment uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_payment public.payments;
begin
  select * into v_payment from public.payments where id = p_payment for update;
  if v_payment.id is null or not public.is_member(v_payment.org_id) then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_payment.org_id, 'refunds.create');
  if v_payment.status <> 'succeeded' then raise exception 'Only a succeeded payment can be reversed' using errcode = '22023'; end if;
  if v_payment.verification = 'provider_verified' then
    raise exception 'Provider-verified payments are reversed through a refund' using errcode = '22023';
  end if;
  if exists (select 1 from public.refunds where payment_id = p_payment and status <> 'failed') then
    raise exception 'This payment already has refunds; record a refund instead' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required' using errcode = '22023'; end if;
  update public.payments set status = 'reversed', reversed_reason = trim(p_reason) where id = p_payment;
end $$;

-- Records that money was returned to the customer. It does not move money through any provider.
create or replace function public.record_refund(
  p_payment uuid, p_amount_minor bigint, p_currency text, p_reason text, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payment public.payments;
  v_already bigint;
  v_id uuid;
  v_paid bigint;
  v_refunded bigint;
  v_status public.order_status;
begin
  select * into v_payment from public.payments where id = p_payment for update;
  if v_payment.id is null or not public.is_member(v_payment.org_id) then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_payment.org_id, 'refunds.create');
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'Missing idempotency key' using errcode = '22023'; end if;
  select id into v_id from public.refunds where org_id = v_payment.org_id and idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;
  if v_payment.status <> 'succeeded' then raise exception 'Only a succeeded payment can be refunded' using errcode = '22023'; end if;
  if upper(p_currency) <> v_payment.currency then
    raise exception 'Refund currency must match the payment currency (%)', v_payment.currency using errcode = '22023';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Refund amount must be positive' using errcode = '22023'; end if;
  select coalesce(sum(amount_minor), 0) into v_already from public.refunds where payment_id = p_payment and status <> 'failed';
  if v_already + p_amount_minor > v_payment.amount_minor then
    raise exception 'Refund exceeds the amount still refundable on this payment' using errcode = '22023';
  end if;

  insert into public.refunds (org_id, order_id, payment_id, amount_minor, currency, reason, idempotency_key)
  values (v_payment.org_id, v_payment.order_id, p_payment, p_amount_minor, v_payment.currency, trim(p_reason), p_idempotency_key)
  returning id into v_id;

  -- A shipped order whose payments are fully refunded becomes `refunded`.
  select coalesce(sum(amount_minor), 0) into v_paid from public.payments where order_id = v_payment.order_id and status = 'succeeded';
  select coalesce(sum(amount_minor), 0) into v_refunded from public.refunds where order_id = v_payment.order_id and status = 'succeeded';
  select status into v_status from public.orders where id = v_payment.order_id for update;
  if v_paid > 0 and v_refunded >= v_paid and v_status in ('dispatched', 'delivered') then
    update public.orders set status = 'refunded' where id = v_payment.order_id;
    insert into public.order_status_history (org_id, order_id, from_status, to_status, note)
    values (v_payment.org_id, v_payment.order_id, v_status, 'refunded', 'All payments refunded');
  end if;
  return v_id;
end $$;

-- Return delivered items to stock (a stock reversal), at most the quantity sold per line.
-- p_lines: [{line_id, quantity}]
create or replace function public.return_order_items(p_order uuid, p_lines jsonb, p_note text, p_idempotency_key text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders;
  v_item jsonb;
  v_line public.order_lines;
  v_qty integer;
  v_i integer := 0;
begin
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null or not public.is_member(v_order.org_id) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_order.org_id, 'refunds.create');
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'Missing idempotency key' using errcode = '22023'; end if;
  if exists (select 1 from public.stock_movements where org_id = v_order.org_id and idempotency_key like p_idempotency_key || ':%') then
    return;
  end if;
  if v_order.status not in ('dispatched', 'delivered', 'refunded') then
    raise exception 'Only shipped or delivered items can be returned to stock' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty is null or v_qty <= 0 then continue; end if;
    select * into v_line from public.order_lines where id = (v_item ->> 'line_id')::uuid and order_id = p_order for update;
    if v_line.id is null then raise exception 'Order line not found' using errcode = 'P0002'; end if;
    if v_line.returned_quantity + v_qty > v_line.quantity then
      raise exception 'Cannot return more of % than was sold', v_line.product_name using errcode = '22023';
    end if;
    update public.order_lines set returned_quantity = returned_quantity + v_qty where id = v_line.id;
    if v_line.track_stock and v_line.variant_id is not null then
      perform public._stock_move(v_order.org_id, v_line.variant_id, public._default_location(v_order.org_id), 'return',
        v_qty, 0, 'customer_return', p_note, p_order, p_idempotency_key || ':' || v_i);
    end if;
    v_i := v_i + 1;
  end loop;
end $$;

-- ───────────────────────── Service-role only: verified provider payments ─────────────────────────
create or replace function public.record_verified_payment(
  p_order uuid, p_provider text, p_method text, p_amount_minor bigint, p_currency text,
  p_external_ref text, p_received_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders;
  v_id uuid;
begin
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if upper(p_currency) <> v_order.currency then raise exception 'Currency mismatch' using errcode = '22023'; end if;
  insert into public.payments (org_id, order_id, provider, method, amount_minor, currency, status, verification, external_ref, received_at, idempotency_key)
  values (v_order.org_id, p_order, p_provider, p_method, p_amount_minor, v_order.currency, 'succeeded', 'provider_verified',
          p_external_ref, coalesce(p_received_at, now()), p_provider || ':' || p_external_ref)
  on conflict (org_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.payments where org_id = v_order.org_id and idempotency_key = p_provider || ':' || p_external_ref;
  end if;
  return v_id;
end $$;
revoke all on function public.record_verified_payment(uuid, text, text, bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_verified_payment(uuid, text, text, bigint, text, text, timestamptz) to service_role;

-- ───────────────────────── Function privileges ─────────────────────────
-- Signed-in users may call the public RPCs (each one checks membership + role itself).
-- Anonymous callers get nothing. Internal helpers and verified-payment writes are not exposed.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public._stock_move(uuid, uuid, uuid, public.stock_movement_kind, integer, integer, text, text, uuid, text) from authenticated;
revoke execute on function public._default_location(uuid) from authenticated;
revoke execute on function public._order_stock(uuid, text) from authenticated;
revoke execute on function public.record_verified_payment(uuid, text, text, bigint, text, text, timestamptz) from authenticated;
