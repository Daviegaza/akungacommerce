-- 1. Daraja STK Push Query fallback for callbacks that never arrive. Additive.
--    mpesa-stk-query (service role, run every 2-5 min by a scheduler) asks Daraja what
--    happened to prompts pending for more than 2 minutes (and less than 24 hours).
--    The query answer has NO receipt number and NO amount, so a "paid" answer never
--    records money: the prompt becomes 'awaiting_receipt' and waits for the real
--    callback / C2B confirmation (reconcile_mpesa_stk still accepts it, because it only
--    treats paid/mismatch/late as already resolved). Failures resolve the prompt.
-- 2. Buyer-visible payment events for the tracking page (storefront_track_payments):
--    every succeeded payment with amount and time, so a partial payment, or one that
--    arrives after confirmation, is visible without touching status history.

-- ───────────────────────── Prompt lifecycle: awaiting receipt ─────────────────────────
alter table public.mpesa_requests drop constraint mpesa_requests_status_check;
alter table public.mpesa_requests add constraint mpesa_requests_status_check
  check (status in ('pending', 'awaiting_receipt', 'paid', 'cancelled', 'timeout', 'failed', 'mismatch', 'late'));
alter table public.mpesa_requests
  add column last_queried_at timestamptz,
  add column query_count integer not null default 0 check (query_count >= 0);
create index mpesa_requests_pending_idx on public.mpesa_requests(created_at) where status = 'pending';

-- Prompts the scheduler should ask Daraja about. Spaced at least 2 minutes apart per prompt.
create or replace function public.mpesa_prompts_due_for_query(p_limit integer)
returns table (checkout_request_id text, org_id uuid, created_at timestamptz, query_count integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.checkout_request_id, r.org_id, r.created_at, r.query_count
    from public.mpesa_requests r
   where r.status = 'pending'
     and r.provider = 'mpesa'
     and r.created_at < now() - interval '2 minutes'
     and r.created_at > now() - interval '24 hours'
     and (r.last_queried_at is null or r.last_queried_at < now() - interval '2 minutes')
   order by r.created_at
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

-- Apply one STK Push Query answer. p_result_code null = Daraja could not say yet
-- (still processing, or the query itself failed): only the query bookkeeping changes.
-- Returns {outcome: awaiting_receipt | not_paid | still_pending | noop | unknown_request}.
create or replace function public.apply_mpesa_stk_query(p_checkout_request_id text, p_result_code integer, p_result_desc text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.mpesa_requests;
  v_status text;
begin
  select * into v_req from public.mpesa_requests where checkout_request_id = p_checkout_request_id for update;
  if v_req.checkout_request_id is null then return jsonb_build_object('outcome', 'unknown_request'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('outcome', 'noop', 'status', v_req.status); end if;

  if p_result_code is null then
    update public.mpesa_requests set last_queried_at = now(), query_count = query_count + 1
     where checkout_request_id = p_checkout_request_id;
    return jsonb_build_object('outcome', 'still_pending', 'org_id', v_req.org_id);
  end if;

  if p_result_code = 0 then
    -- No receipt, no amount: never a payment. The callback or C2B confirmation records the money.
    update public.mpesa_requests
       set status = 'awaiting_receipt', result_code = 0, result_desc = left(p_result_desc, 300),
           last_queried_at = now(), query_count = query_count + 1
     where checkout_request_id = p_checkout_request_id;
    return jsonb_build_object('outcome', 'awaiting_receipt', 'org_id', v_req.org_id);
  end if;

  v_status := case when p_result_code = 1032 then 'cancelled' when p_result_code in (1037, 1019) then 'timeout' else 'failed' end;
  update public.mpesa_requests
     set status = v_status, result_code = p_result_code, result_desc = left(p_result_desc, 300), resolved_at = now(),
         last_queried_at = now(), query_count = query_count + 1
   where checkout_request_id = p_checkout_request_id;
  return jsonb_build_object('outcome', 'not_paid', 'status', v_status, 'org_id', v_req.org_id);
end $$;

-- ───────────────────────── Buyer-visible payment events ─────────────────────────
create or replace function public.storefront_track_payments(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_o public.orders;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select * into v_o from public.orders where tracking_token = p_token;
  if v_o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  -- No references, providers or notes: amount, rail, whether a provider verified it, and when.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'amount_minor', p.amount_minor, 'currency', p.currency, 'method', p.method,
             'verified', p.verification = 'provider_verified', 'received_at', p.received_at) order by p.received_at, p.created_at)
      from public.payments p where p.order_id = v_o.id and p.status = 'succeeded'), '[]'::jsonb);
end $$;

-- The "Payment receipt" card on the tracking page says "Confirmed by M-Pesa" and shows an
-- "M-Pesa code"; with bank transfers (and Paystack cards) now verified too, limit it to
-- mobile-money payments so a bank reference is never presented as an M-Pesa code.
-- Same body as 20261120000040 plus `and method = 'mobile_money'`; grants are kept.
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
               and method = 'mobile_money'
             order by received_at desc limit 5) p), '[]'::jsonb);
end $$;

revoke execute on function public.mpesa_prompts_due_for_query(integer) from public, anon, authenticated;
revoke execute on function public.apply_mpesa_stk_query(text, integer, text) from public, anon, authenticated;
grant execute on function public.mpesa_prompts_due_for_query(integer) to service_role;
grant execute on function public.apply_mpesa_stk_query(text, integer, text) to service_role;
revoke execute on function public.storefront_track_payments(text) from public;
grant execute on function public.storefront_track_payments(text) to anon, authenticated, service_role;
