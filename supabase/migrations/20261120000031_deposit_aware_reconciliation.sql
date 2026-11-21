-- Make M-Pesa reconciliation deposit-aware (joins 20261120000020 with 20261120000030).
-- 1. A verified payment that covers the deposit confirms a new order, not only full payment.
-- 2. A direct Till/Paybill (C2B) payment auto-matches when it equals the amount due now
--    (unpaid deposit first, else the balance) as well as the full outstanding balance.

create or replace function public._mpesa_after_payment(p_order uuid, p_receipt text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders;
  v_amounts jsonb;
  v_note text;
begin
  select * into v_order from public.orders where id = p_order for update;
  if v_order.status <> 'pending_confirmation' then return false; end if;
  v_amounts := public._order_amounts(p_order);
  if public._order_outstanding(p_order) <= 0 then
    v_note := 'Paid in full by M-Pesa (verified receipt ' || p_receipt || ')';
  elsif (v_amounts ->> 'deposit_due_minor')::bigint > 0 and (v_amounts ->> 'deposit_outstanding_minor')::bigint <= 0 then
    v_note := 'Deposit paid by M-Pesa (verified receipt ' || p_receipt || '); balance due on delivery';
  else
    return false;
  end if;
  update public.orders set status = 'confirmed' where id = p_order;
  insert into public.order_status_history (org_id, order_id, from_status, to_status, note)
  values (v_order.org_id, p_order, 'pending_confirmation', 'confirmed', v_note);
  return true;
end $$;

create or replace function public.reconcile_mpesa_c2b(
  p_shortcode text, p_receipt text, p_amount_minor bigint, p_account_ref text, p_payer_hint text, p_transacted_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_count integer;
  v_receipt text := upper(trim(coalesce(p_receipt, '')));
  v_ref text := nullif(left(trim(coalesce(p_account_ref, '')), 40), '');
  v_num integer;
  v_order public.orders;
  v_reason text;
  v_payment uuid;
  v_confirmed boolean;
begin
  if v_receipt !~ '^[A-Z0-9]{8,12}$' or p_amount_minor is null or p_amount_minor <= 0 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  select count(*), min(s.org_id::text)::uuid into v_count, v_org
    from public.shop_settings s
    join public.integration_connections c on c.org_id = s.org_id and c.provider = 'mpesa' and c.state = 'connected_verified'
   where s.collections_provider = 'daraja' and (s.mpesa_till = p_shortcode or s.mpesa_paybill = p_shortcode);
  if v_count <> 1 then return jsonb_build_object('outcome', 'unknown_shortcode'); end if;
  if exists (select 1 from public.mpesa_receipts where receipt = v_receipt) then
    return jsonb_build_object('outcome', 'duplicate', 'org_id', v_org);
  end if;

  if v_ref ~ '^#?\s*[0-9]{1,9}$' then
    v_num := regexp_replace(v_ref, '[^0-9]', '', 'g')::integer;
    select * into v_order from public.orders where org_id = v_org and number = v_num for update;
  end if;

  if v_num is null or v_num = 0 then v_reason := 'No order number in the account reference';
  elsif v_order.id is null then v_reason := 'No order with that number';
  elsif v_order.status in ('draft', 'cancelled', 'refunded') then v_reason := 'The order was cancelled or closed before the payment arrived';
  elsif v_order.currency <> 'KES' then v_reason := 'The order is not in KES';
  elsif p_amount_minor <> public._order_outstanding(v_order.id)
        and p_amount_minor <> public.order_amount_due_now(v_order.id) then v_reason := 'The amount does not equal the deposit or balance due';
  end if;

  if v_reason is null then
    begin
      v_payment := public.record_verified_payment(v_order.id, 'mpesa', 'mobile_money', p_amount_minor, 'KES', v_receipt,
                                                  coalesce(p_transacted_at, now()));
    exception when others then
      v_reason := left('Could not record automatically: ' || sqlerrm, 300);
    end;
  end if;

  insert into public.mpesa_receipts (org_id, provider, source, receipt, amount_minor, currency, account_ref, payer_hint,
                                     transacted_at, status, reason, order_id, payment_id, resolved_at)
  values (v_org, 'mpesa', 'c2b', v_receipt, p_amount_minor, 'KES', v_ref, left(p_payer_hint, 60), coalesce(p_transacted_at, now()),
          case when v_reason is null then 'matched' else 'unmatched' end, v_reason,
          case when v_reason is null then v_order.id end, v_payment, case when v_reason is null then now() end);
  if v_reason is null then
    v_confirmed := public._mpesa_after_payment(v_order.id, v_receipt);
    return jsonb_build_object('outcome', 'recorded', 'payment_id', v_payment, 'confirmed', v_confirmed, 'org_id', v_org);
  end if;
  return jsonb_build_object('outcome', 'unmatched', 'org_id', v_org);
end $$;

revoke execute on function public._mpesa_after_payment(uuid, text) from public, anon, authenticated;
