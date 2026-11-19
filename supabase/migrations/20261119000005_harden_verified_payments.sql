-- Harden provider-verified payments (service role only).
-- A signed webhook proves the event came from the provider account, not that the
-- referenced order belongs to that account's merchant. Until per-organisation
-- provider secrets exist, a verified payment is only accepted when:
--   * the order's organisation has a connected_verified integration for that provider,
--   * the order is live (not draft/cancelled),
--   * the amount does not exceed the outstanding balance.
-- Anything else is rejected and left in webhook_events for manual review.
create or replace function public.record_verified_payment(
  p_order uuid, p_provider text, p_method text, p_amount_minor bigint, p_currency text,
  p_external_ref text, p_received_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders;
  v_id uuid;
  v_paid bigint;
  v_refunded bigint;
begin
  if p_external_ref is null or length(p_external_ref) = 0 then
    raise exception 'Provider reference required' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;

  select id into v_id from public.payments
   where org_id = v_order.org_id and idempotency_key = p_provider || ':' || p_external_ref;
  if v_id is not null then return v_id; end if;

  if not exists (
    select 1 from public.integration_connections
     where org_id = v_order.org_id and provider = p_provider and state = 'connected_verified'
  ) then
    raise exception 'Provider % is not connected for this organisation', p_provider using errcode = '42501';
  end if;
  if v_order.status in ('draft', 'cancelled') then
    raise exception 'Order is not accepting payments' using errcode = '22023';
  end if;
  if upper(p_currency) <> v_order.currency then raise exception 'Currency mismatch' using errcode = '22023'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Amount must be positive' using errcode = '22023'; end if;
  select coalesce(sum(amount_minor), 0) into v_paid from public.payments where order_id = p_order and status = 'succeeded';
  select coalesce(sum(amount_minor), 0) into v_refunded from public.refunds where order_id = p_order and status = 'succeeded';
  if p_amount_minor > v_order.total_minor - (v_paid - v_refunded) then
    raise exception 'Amount exceeds the outstanding balance; needs manual review' using errcode = '22023';
  end if;

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
revoke execute on function public.record_verified_payment(uuid, text, text, bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_verified_payment(uuid, text, text, bigint, text, text, timestamptz) to service_role;
