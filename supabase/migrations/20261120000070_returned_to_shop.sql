-- Failed delivery end state: "returned to shop".
--
-- Before this migration an order whose last delivery attempt failed stayed
-- "dispatched" for ever, and dispatched -> cancelled was not allowed. Now:
--
-- * The status machine allows dispatched -> cancelled, but ONLY through
--   return_order_to_shop(): transition_order and the rider-link core refuse it,
--   because goods that left the shop must come back to stock and the money owed
--   to the buyer must be worked out.
-- * return_order_to_shop puts every unreturned line back on the shelf (it reuses
--   return_order_items), cancels the order, stamps orders.returned_at, cancels
--   rider links, writes history + a 'returned' delivery event and, when the buyer
--   paid more than the delivery fee kept under the agreed policy, creates a
--   PENDING refund suggestion. Nothing moves money: the merchant refunds the buyer
--   themselves and then confirms the suggestion, which records ordinary refunds.
--
-- Also fixes marketing consent provenance: storefront orders now record
-- consent_source = 'checkout' even when the browser has a staff session.
--
-- Mirrors src/domain/orders.ts (needsReturnFlow), src/domain/delivery-policy.ts
-- (planReturnToShop) and src/gateway/delivery-demo.ts. Tests:
-- tests/db/operations.db.test.ts.

-- ───────────────────────── Status machine ─────────────────────────
create or replace function public.order_transition_allowed(p_from public.order_status, p_to public.order_status)
returns boolean language sql immutable as $$
  select case p_from
    when 'draft' then p_to in ('pending_confirmation', 'confirmed', 'cancelled')
    when 'pending_confirmation' then p_to in ('confirmed', 'cancelled')
    when 'confirmed' then p_to in ('preparing', 'ready', 'cancelled')
    when 'preparing' then p_to in ('ready', 'cancelled')
    when 'ready' then p_to in ('dispatched', 'delivered', 'cancelled')
    -- dispatched -> cancelled is the "returned to shop" end state (return_order_to_shop only).
    when 'dispatched' then p_to in ('delivered', 'cancelled')
    else false
  end
$$;

-- Transitions that must go through a dedicated flow instead of a plain status change.
create or replace function public.order_transition_needs_return_flow(p_from public.order_status, p_to public.order_status)
returns boolean language sql immutable as $$
  select p_from = 'dispatched' and p_to = 'cancelled'
$$;

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
  if public.order_transition_needs_return_flow(v_order.status, p_to) then
    raise exception 'An order that is out for delivery is cancelled by marking it returned to the shop' using errcode = '22023';
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

create or replace function public._transition_order_core(p_order uuid, p_to public.order_status, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if not public.order_transition_allowed(v_order.status, p_to) or public.order_transition_needs_return_flow(v_order.status, p_to) then
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

-- ───────────────────────── Schema ─────────────────────────
alter table public.orders add column returned_at timestamptz;

alter table public.delivery_events drop constraint delivery_events_kind_check;
alter table public.delivery_events add constraint delivery_events_kind_check
  check (kind in ('failed', 'picked_up', 'delivered', 'rider_accepted', 'rider_link_created', 'rider_link_revoked', 'handoff_set', 'returned'));

-- What the shop owes the buyer after a return. A suggestion only: confirming it records
-- refunds (which themselves only record money the merchant already sent back).
create table public.refund_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  order_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  kept_minor bigint not null default 0 check (kept_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (length(reason) between 1 and 300),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed')),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  foreign key (order_id, org_id) references public.orders(id, org_id) on delete cascade
);
create index refund_suggestions_org_idx on public.refund_suggestions(org_id, status, created_at desc);
create unique index refund_suggestions_one_pending on public.refund_suggestions(order_id) where status = 'pending';
alter table public.refund_suggestions enable row level security;
create policy refund_suggestions_read on public.refund_suggestions for select using (public.is_member(org_id));
revoke insert, update, delete on public.refund_suggestions from anon, authenticated;
create trigger audit_refund_suggestions after insert or update on public.refund_suggestions for each row execute function public.write_audit();

-- ───────────────────────── Returned to shop ─────────────────────────
create or replace function public._order_net_paid(p_order uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(0,
      coalesce((select sum(amount_minor) from public.payments where order_id = p_order and status = 'succeeded'), 0)
    - coalesce((select sum(amount_minor) from public.refunds where order_id = p_order and status = 'succeeded'), 0))::bigint
$$;

create or replace function public._return_result(p_order uuid, p_replayed boolean)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'order_id', o.id,
    'status', o.status,
    'returned_at', o.returned_at,
    'kept_minor', coalesce((select s.kept_minor from public.refund_suggestions s where s.order_id = o.id order by s.created_at desc limit 1),
                           least(o.forfeited_fee_minor, public._order_net_paid(o.id))),
    'refund_suggestion_id', (select s.id from public.refund_suggestions s where s.order_id = o.id order by s.created_at desc limit 1),
    'refund_minor', coalesce((select s.amount_minor from public.refund_suggestions s where s.order_id = o.id order by s.created_at desc limit 1), 0),
    'replayed', p_replayed)
  from public.orders o where o.id = p_order
$$;

-- p_note is an optional note for the team (not shown to the buyer).
create or replace function public.return_order_to_shop(p_order uuid, p_note text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders;
  v_method public.fulfilment_method;
  v_lines jsonb;
  v_net bigint;
  v_kept bigint;
  v_refund bigint;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 300), '');
begin
  select * into v_o from public.orders where id = p_order for update;
  if v_o.id is null or not public.is_member(v_o.org_id) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  -- Puts stock back and works out a refund: same permission as returns and refunds.
  perform public.require_permission(v_o.org_id, 'refunds.create');
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'Missing idempotency key' using errcode = '22023'; end if;
  if exists (select 1 from public.delivery_events where org_id = v_o.org_id and idempotency_key = p_idempotency_key) then
    return public._return_result(p_order, true);
  end if;
  if v_o.status <> 'dispatched' then
    raise exception 'Only an order that is out for delivery can be returned to the shop' using errcode = '22023';
  end if;
  select method into v_method from public.fulfilments where order_id = p_order;
  if v_method is distinct from 'delivery' then raise exception 'Pickup orders are not delivered' using errcode = '22023'; end if;

  -- 1. Everything that has not been returned yet goes back on the shelf (same rules and
  --    stock movements as "Return items to stock").
  select jsonb_agg(jsonb_build_object('line_id', id, 'quantity', quantity - returned_quantity) order by position)
    into v_lines from public.order_lines where order_id = p_order and quantity > returned_quantity;
  if v_lines is not null then
    perform public.return_order_items(p_order, v_lines, coalesce(v_note, 'Returned to shop after delivery'), p_idempotency_key);
  end if;

  -- 2. dispatched -> cancelled (the one place this transition is allowed).
  if not public.order_transition_allowed(v_o.status, 'cancelled') then
    raise exception 'An order cannot move from % to cancelled', v_o.status using errcode = '22023';
  end if;
  update public.orders set status = 'cancelled', returned_at = now() where id = p_order;
  insert into public.order_status_history (org_id, order_id, from_status, to_status, note)
  values (v_o.org_id, p_order, 'dispatched', 'cancelled',
    format('Returned to shop after %s failed delivery attempt%s. Items back in stock.%s', v_o.delivery_attempts,
      case when v_o.delivery_attempts = 1 then '' else 's' end, case when v_note is not null then ' ' || v_note else '' end));
  update public.rider_links set revoked_at = now() where order_id = p_order and revoked_at is null;

  -- 3. Money: the delivery fee kept under the agreed policy stays with the shop; the rest of
  --    what the buyer paid is owed back. Suggest it; never move it.
  v_net := public._order_net_paid(p_order);
  v_kept := least(v_o.forfeited_fee_minor, v_net);
  v_refund := greatest(0, v_net - v_kept);
  if v_refund > 0 then
    insert into public.refund_suggestions (org_id, order_id, amount_minor, kept_minor, currency, reason)
    values (v_o.org_id, p_order, v_refund, v_kept, v_o.currency,
      case when v_kept > 0 then 'Order returned to shop. Delivery fee kept per the agreed policy; the rest is refundable.'
           else 'Order returned to shop. Everything the buyer paid is refundable.' end);
  end if;

  insert into public.delivery_events (org_id, order_id, kind, actor, note, attempt, forfeited_minor, idempotency_key)
  values (v_o.org_id, p_order, 'returned', 'staff', v_note, v_o.delivery_attempts, 0, p_idempotency_key);
  return public._return_result(p_order, false);
end $$;

-- The merchant has refunded the buyer outside Rafu: record it as ordinary refunds against the
-- order's payments (newest first). All or nothing.
create or replace function public.confirm_refund_suggestion(p_suggestion uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s public.refund_suggestions;
  v_p record;
  v_left bigint;
  v_amt bigint;
  v_i integer := 0;
begin
  select * into v_s from public.refund_suggestions where id = p_suggestion for update;
  if v_s.id is null or not public.is_member(v_s.org_id) then raise exception 'Refund not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_s.org_id, 'refunds.create');
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'Missing idempotency key' using errcode = '22023'; end if;
  if v_s.status = 'confirmed' then return jsonb_build_object('status', 'confirmed', 'refunded_minor', v_s.amount_minor); end if;
  if v_s.status <> 'pending' then raise exception 'This refund was dismissed' using errcode = '22023'; end if;

  v_left := v_s.amount_minor;
  for v_p in
    select p.id, p.amount_minor - coalesce((select sum(r.amount_minor) from public.refunds r where r.payment_id = p.id and r.status <> 'failed'), 0) as refundable
      from public.payments p
     where p.order_id = v_s.order_id and p.status = 'succeeded' and p.currency = v_s.currency
     order by p.received_at desc, p.created_at desc
  loop
    exit when v_left <= 0;
    v_amt := least(v_left, v_p.refundable);
    continue when v_amt <= 0;
    perform public.record_refund(v_p.id, v_amt, v_s.currency, v_s.reason, p_idempotency_key || ':' || v_i);
    v_left := v_left - v_amt;
    v_i := v_i + 1;
  end loop;
  if v_left > 0 then
    raise exception 'The payments on this order no longer cover this refund. Record what you refunded on Payments instead.' using errcode = '22023';
  end if;
  update public.refund_suggestions set status = 'confirmed', resolved_at = now(), resolved_by = auth.uid() where id = p_suggestion;
  insert into public.order_status_history (org_id, order_id, from_status, to_status, note)
  select v_s.org_id, v_s.order_id, o.status, o.status, 'Refund to the buyer recorded for the returned order.'
    from public.orders o where o.id = v_s.order_id;
  return jsonb_build_object('status', 'confirmed', 'refunded_minor', v_s.amount_minor);
end $$;

create or replace function public.dismiss_refund_suggestion(p_suggestion uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s public.refund_suggestions;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 300), '');
begin
  select * into v_s from public.refund_suggestions where id = p_suggestion for update;
  if v_s.id is null or not public.is_member(v_s.org_id) then raise exception 'Refund not found' using errcode = 'P0002'; end if;
  perform public.require_permission(v_s.org_id, 'refunds.create');
  if v_s.status <> 'pending' then raise exception 'This refund is already settled' using errcode = '22023'; end if;
  if v_reason is null then raise exception 'Say why no refund is due' using errcode = '22023'; end if;
  update public.refund_suggestions set status = 'dismissed', resolution_note = v_reason, resolved_at = now(), resolved_by = auth.uid()
   where id = p_suggestion;
  insert into public.order_status_history (org_id, order_id, from_status, to_status, note)
  select v_s.org_id, v_s.order_id, o.status, o.status, 'Suggested refund dismissed: ' || v_reason
    from public.orders o where o.id = v_s.order_id;
end $$;

-- Merchant view: when the order came back and what is owed (read alongside order_delivery()).
create or replace function public.order_return_state(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order;
  if v_o.id is null or not public.is_member(v_o.org_id) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'returned_at', v_o.returned_at,
    'refund_suggestion', (select jsonb_build_object('id', s.id, 'amount_minor', s.amount_minor, 'kept_minor', s.kept_minor, 'currency', s.currency,
        'reason', s.reason, 'status', s.status, 'resolution_note', s.resolution_note, 'created_at', s.created_at, 'resolved_at', s.resolved_at)
      from public.refund_suggestions s where s.order_id = p_order order by s.created_at desc limit 1));
end $$;

-- Tracking page: same as before plus the return and refund state (no staff notes).
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
    'returned_at', v_o.returned_at,
    'refund', (select jsonb_build_object('amount_minor', s.amount_minor, 'kept_minor', s.kept_minor, 'status', s.status)
                 from public.refund_suggestions s where s.order_id = v_o.id order by s.created_at desc limit 1),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'actor', e.actor, 'reason', e.reason, 'note', null,
                  'attempt', e.attempt, 'forfeited_minor', e.forfeited_minor, 'created_at', e.created_at) order by e.id)
                from public.delivery_events e where e.order_id = v_o.id and e.kind in ('failed', 'picked_up', 'delivered', 'returned')), '[]'::jsonb));
end $$;

-- ───────────────────────── Consent provenance fix ─────────────────────────
-- The consent trigger falls back to 'staff' when auth.uid() is set, which mislabelled storefront
-- orders placed in a browser that also had a staff session. The checkout itself is the source.
-- The existing body is kept unchanged under a private name and wrapped, so later edits to the
-- order logic only have to replace _storefront_place_order_core.
alter function public.storefront_place_order(text, jsonb, text) rename to _storefront_place_order_core;
revoke execute on function public._storefront_place_order_core(text, jsonb, text) from public, anon, authenticated;

create or replace function public.storefront_place_order(p_slug text, p_input jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_result jsonb;
begin
  perform set_config('akunga.consent_source', 'checkout', true);
  v_result := public._storefront_place_order_core(p_slug, p_input, p_idempotency_key);
  perform set_config('akunga.consent_source', '', true);
  return v_result;
end $$;
revoke execute on function public.storefront_place_order(text, jsonb, text) from public;
grant execute on function public.storefront_place_order(text, jsonb, text) to anon, authenticated, service_role;

-- ───────────────────────── Privileges ─────────────────────────
revoke execute on function
  public.order_transition_needs_return_flow(public.order_status, public.order_status),
  public._order_net_paid(uuid), public._return_result(uuid, boolean),
  public.return_order_to_shop(uuid, text, text), public.confirm_refund_suggestion(uuid, text),
  public.dismiss_refund_suggestion(uuid, text), public.order_return_state(uuid),
  public.storefront_track_delivery(text), public._transition_order_core(uuid, public.order_status, text)
  from public, anon, authenticated;
grant execute on function public.order_transition_needs_return_flow(public.order_status, public.order_status) to authenticated, service_role;
grant execute on function
  public.return_order_to_shop(uuid, text, text), public.confirm_refund_suggestion(uuid, text),
  public.dismiss_refund_suggestion(uuid, text), public.order_return_state(uuid)
  to authenticated;
grant execute on function public.storefront_track_delivery(text) to anon, authenticated;
