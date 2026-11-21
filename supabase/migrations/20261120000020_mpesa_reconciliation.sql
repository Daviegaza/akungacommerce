-- M-Pesa collections provider + automatic reconciliation. Additive only.
--
-- * shop_settings.collections_provider: which way the shop gets paid
--   ('manual' | 'daraja' | 'aggregator'). Secrets never live here: they stay in
--   Edge Function env. Changed only through set_collections_provider.
-- * mpesa_requests gains a lifecycle (pending -> paid/cancelled/timeout/failed/
--   mismatch/late), a phone hint (last 3 digits) and the result from M-Pesa.
-- * mpesa_receipts: every verified M-Pesa receipt that reached us (STK callback or
--   C2B confirmation). Unique per receipt code = idempotency. Receipts that cannot
--   be matched safely wait in the merchant's "unmatched" queue.
-- * Payments are created ONLY by service-role reconciliation from verified
--   callbacks (reconcile_mpesa_stk / reconcile_mpesa_c2b), or by staff attaching a
--   receipt that already arrived through such a callback (attach_mpesa_receipt).
-- Rules mirror src/domain/reconciliation.ts.

-- ───────────────────────── Shop: collections provider ─────────────────────────
alter table public.shop_settings
  add column collections_provider text not null default 'manual'
    check (collections_provider in ('manual', 'daraja', 'aggregator')),
  add column collections_aggregator text
    check (collections_aggregator is null or collections_aggregator ~ '^[a-z][a-z0-9_]{1,30}$'),
  add constraint shop_settings_aggregator_chosen
    check ((collections_provider = 'aggregator') = (collections_aggregator is not null));

-- ───────────────────────── STK prompt lifecycle ─────────────────────────
alter table public.mpesa_requests
  add column provider text not null default 'mpesa' check (length(provider) between 1 and 40),
  add column status text not null default 'pending'
    check (status in ('pending', 'paid', 'cancelled', 'timeout', 'failed', 'mismatch', 'late')),
  add column phone_hint text check (phone_hint is null or phone_hint ~ '^[0-9]{3}$'),
  add column result_code integer,
  add column result_desc text check (result_desc is null or length(result_desc) <= 300),
  add column receipt text check (receipt is null or receipt ~ '^[A-Z0-9]{8,12}$'),
  add column resolved_at timestamptz;
create index mpesa_requests_org_idx on public.mpesa_requests(org_id, created_at desc);

-- Members may read their own prompts (reconciliation view). Writes: service role / definer functions only.
create policy mpesa_requests_read on public.mpesa_requests for select using (public.is_member(org_id));
grant select on public.mpesa_requests to authenticated;

-- ───────────────────────── Verified receipts ─────────────────────────
create table public.mpesa_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  provider text not null check (length(provider) between 1 and 40),
  source text not null check (source in ('stk', 'c2b', 'aggregator')),
  receipt text not null unique check (receipt ~ '^[A-Z0-9]{8,12}$'),
  amount_minor bigint not null check (amount_minor > 0),
  currency public.currency_code not null default 'KES',
  account_ref text check (account_ref is null or length(account_ref) <= 40),
  payer_hint text check (payer_hint is null or length(payer_hint) <= 60),
  checkout_request_id text,
  transacted_at timestamptz not null default now(),
  status text not null check (status in ('matched', 'unmatched', 'mismatch', 'late', 'attached', 'dismissed')),
  reason text check (reason is null or length(reason) <= 300),
  order_id uuid,
  payment_id uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (order_id, org_id) references public.orders(id, org_id),
  foreign key (payment_id, org_id) references public.payments(id, org_id),
  check (status not in ('matched', 'attached') or payment_id is not null)
);
create index mpesa_receipts_org_idx on public.mpesa_receipts(org_id, status, created_at desc);

alter table public.mpesa_receipts enable row level security;
create policy mpesa_receipts_read on public.mpesa_receipts for select using (public.is_member(org_id));
revoke all on public.mpesa_receipts from anon, authenticated;
grant select on public.mpesa_receipts to authenticated;
create trigger audit_mpesa_receipts after insert or update on public.mpesa_receipts for each row execute function public.write_audit();

-- ───────────────────────── Internal helpers ─────────────────────────
create or replace function public._order_outstanding(p_order uuid) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select o.total_minor
         - coalesce((select sum(amount_minor) from public.payments where order_id = o.id and status = 'succeeded'), 0)
         + coalesce((select sum(amount_minor) from public.refunds where order_id = o.id and status = 'succeeded'), 0)
    from public.orders o where o.id = p_order
$$;

-- After a verified payment: a new order that is now fully paid is confirmed, with the
-- receipt in its status history. Stock is unchanged (both statuses hold the reservation).
create or replace function public._mpesa_after_payment(p_order uuid, p_receipt text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order for update;
  if v_order.status = 'pending_confirmation' and public._order_outstanding(p_order) <= 0 then
    update public.orders set status = 'confirmed' where id = p_order;
    insert into public.order_status_history (org_id, order_id, from_status, to_status, note)
    values (v_order.org_id, p_order, 'pending_confirmation', 'confirmed', 'Paid in full by M-Pesa (verified receipt ' || p_receipt || ')');
    return true;
  end if;
  return false;
end $$;

-- ───────────────────────── Service role: STK callback ─────────────────────────
-- Called by mpesa-callback after the shared-secret check and webhook_events dedupe.
-- Returns {outcome: recorded | not_paid | review | duplicate | invalid | unknown_request, ...}.
create or replace function public.reconcile_mpesa_stk(
  p_checkout_request_id text, p_result_code integer, p_result_desc text,
  p_amount_minor bigint, p_receipt text, p_phone_hint text, p_transacted_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.mpesa_requests;
  v_order public.orders;
  v_receipt text := upper(trim(coalesce(p_receipt, '')));
  v_status text;
  v_reason text;
  v_payment uuid;
  v_confirmed boolean;
  v_due bigint;
  v_hint text := case when p_phone_hint ~ '^[0-9]{3}$' then p_phone_hint end;
begin
  select * into v_req from public.mpesa_requests where checkout_request_id = p_checkout_request_id for update;
  if v_req.checkout_request_id is null then return jsonb_build_object('outcome', 'unknown_request'); end if;

  if p_result_code is distinct from 0 then
    if v_req.status <> 'pending' then return jsonb_build_object('outcome', 'duplicate'); end if;
    v_status := case when p_result_code = 1032 then 'cancelled' when p_result_code in (1037, 1019) then 'timeout' else 'failed' end;
    update public.mpesa_requests
       set status = v_status, result_code = p_result_code, result_desc = left(p_result_desc, 300),
           phone_hint = coalesce(v_hint, phone_hint), resolved_at = now()
     where checkout_request_id = p_checkout_request_id;
    return jsonb_build_object('outcome', 'not_paid', 'status', v_status, 'org_id', v_req.org_id);
  end if;

  if v_receipt !~ '^[A-Z0-9]{8,12}$' or p_amount_minor is null or p_amount_minor <= 0 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if exists (select 1 from public.mpesa_receipts where receipt = v_receipt) or v_req.status in ('paid', 'mismatch', 'late') then
    return jsonb_build_object('outcome', 'duplicate', 'org_id', v_req.org_id);
  end if;

  select * into v_order from public.orders where id = v_req.order_id for update;
  v_due := public._order_outstanding(v_order.id);
  if v_order.id is null or v_order.status in ('draft', 'cancelled', 'refunded') then
    v_status := 'late'; v_reason := 'The order was cancelled or closed before the payment arrived';
  elsif v_order.currency <> 'KES' then
    v_status := 'mismatch'; v_reason := 'The order is not in KES';
  elsif p_amount_minor <> v_req.amount_minor then
    v_status := 'mismatch'; v_reason := 'The amount paid differs from the amount requested';
  elsif p_amount_minor > v_due then
    v_status := 'late'; v_reason := 'The order was already paid; this is an extra payment';
  end if;

  if v_status is null then
    begin
      v_payment := public.record_verified_payment(v_order.id, v_req.provider, 'mobile_money', p_amount_minor, 'KES', v_receipt,
                                                  coalesce(p_transacted_at, now()));
    exception when others then
      -- e.g. the provider is not connected_verified for this business: keep the money visible for review.
      v_status := 'mismatch'; v_reason := left('Could not record automatically: ' || sqlerrm, 300);
    end;
  end if;

  if v_status is null then
    insert into public.mpesa_receipts (org_id, provider, source, receipt, amount_minor, currency, account_ref, payer_hint,
                                       checkout_request_id, transacted_at, status, order_id, payment_id, resolved_at)
    values (v_req.org_id, v_req.provider, 'stk', v_receipt, p_amount_minor, 'KES', null,
            case when v_hint is not null then '···' || v_hint end, p_checkout_request_id, coalesce(p_transacted_at, now()),
            'matched', v_order.id, v_payment, now());
    update public.mpesa_requests
       set status = 'paid', result_code = 0, result_desc = left(p_result_desc, 300), receipt = v_receipt,
           phone_hint = coalesce(v_hint, phone_hint), resolved_at = now()
     where checkout_request_id = p_checkout_request_id;
    v_confirmed := public._mpesa_after_payment(v_order.id, v_receipt);
    return jsonb_build_object('outcome', 'recorded', 'payment_id', v_payment, 'confirmed', v_confirmed, 'org_id', v_req.org_id);
  end if;

  insert into public.mpesa_receipts (org_id, provider, source, receipt, amount_minor, currency, payer_hint,
                                     checkout_request_id, transacted_at, status, reason, order_id)
  values (v_req.org_id, v_req.provider, 'stk', v_receipt, p_amount_minor, 'KES',
          case when v_hint is not null then '···' || v_hint end, p_checkout_request_id, coalesce(p_transacted_at, now()),
          v_status, v_reason, v_order.id);
  update public.mpesa_requests
     set status = v_status, result_code = 0, result_desc = left(p_result_desc, 300), receipt = v_receipt,
         phone_hint = coalesce(v_hint, phone_hint), resolved_at = now()
   where checkout_request_id = p_checkout_request_id;
  return jsonb_build_object('outcome', 'review', 'status', v_status, 'org_id', v_req.org_id);
end $$;

-- ───────────────────────── Service role: C2B confirmation ─────────────────────────
-- A customer paid the Till/Paybill directly. The shortcode must belong to exactly one
-- business whose Daraja connection was verified (a shortcode typed into shop settings
-- alone proves nothing). Auto-match only: account ref = live KES order number AND
-- amount = whole balance due. Otherwise the receipt waits in the unmatched queue.
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
  elsif p_amount_minor <> public._order_outstanding(v_order.id) then v_reason := 'The amount does not equal the balance due';
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

-- ───────────────────────── Merchant RPCs ─────────────────────────
create or replace function public.set_collections_provider(p_org uuid, p_provider text, p_aggregator text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission(p_org, 'integrations.manage');
  if p_provider not in ('manual', 'daraja', 'aggregator') then
    raise exception 'Choose manual, Daraja or an aggregator' using errcode = '22023';
  end if;
  if p_provider = 'aggregator' and coalesce(p_aggregator, '') !~ '^[a-z][a-z0-9_]{1,30}$' then
    raise exception 'Choose which aggregator' using errcode = '22023';
  end if;
  update public.shop_settings
     set collections_provider = p_provider,
         collections_aggregator = case when p_provider = 'aggregator' then p_aggregator end
   where org_id = p_org;
  if not found then
    raise exception 'Set up your shop link first (My shop), then choose how you get paid' using errcode = '22023';
  end if;
end $$;

-- Attach a queued receipt (it already arrived through a verified callback) to an order.
create or replace function public.attach_mpesa_receipt(p_org uuid, p_receipt_id uuid, p_order uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_r public.mpesa_receipts;
  v_order public.orders;
  v_payment uuid;
begin
  perform public.require_permission(p_org, 'payments.record');
  select * into v_r from public.mpesa_receipts where id = p_receipt_id and org_id = p_org for update;
  if v_r.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if v_r.status not in ('unmatched', 'mismatch', 'late') then
    raise exception 'This payment has already been resolved' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order and org_id = p_org for update;
  if v_order.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if v_order.status in ('draft', 'cancelled', 'refunded') then
    raise exception 'Payments cannot be attached to a draft, cancelled or refunded order' using errcode = '22023';
  end if;
  if v_order.currency <> v_r.currency then
    raise exception 'This order is in %; the payment is in %', v_order.currency, v_r.currency using errcode = '22023';
  end if;
  if v_r.amount_minor > public._order_outstanding(p_order) then
    raise exception 'This payment is more than the balance due on that order' using errcode = '22023';
  end if;

  insert into public.payments (org_id, order_id, provider, method, amount_minor, currency, status, verification,
                               external_ref, note, received_at, idempotency_key)
  values (p_org, p_order, v_r.provider, 'mobile_money', v_r.amount_minor, v_r.currency, 'succeeded', 'provider_verified',
          v_r.receipt, 'Verified M-Pesa receipt attached by staff', v_r.transacted_at, v_r.provider || ':' || v_r.receipt)
  on conflict do nothing
  returning id into v_payment;
  if v_payment is null then
    raise exception 'This receipt is already recorded as a payment' using errcode = '23505';
  end if;
  update public.mpesa_receipts
     set status = 'attached', order_id = p_order, payment_id = v_payment, resolved_by = auth.uid(), resolved_at = now()
   where id = p_receipt_id;
  perform public._mpesa_after_payment(p_order, v_r.receipt);
  return v_payment;
end $$;

create or replace function public.dismiss_mpesa_receipt(p_org uuid, p_receipt_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r public.mpesa_receipts;
begin
  perform public.require_permission(p_org, 'payments.record');
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required' using errcode = '22023'; end if;
  select * into v_r from public.mpesa_receipts where id = p_receipt_id and org_id = p_org for update;
  if v_r.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if v_r.status not in ('unmatched', 'mismatch', 'late') then
    raise exception 'This payment has already been resolved' using errcode = '22023';
  end if;
  update public.mpesa_receipts
     set status = 'dismissed', reason = left(trim(p_reason), 300), resolved_by = auth.uid(), resolved_at = now()
   where id = p_receipt_id;
end $$;

-- Check a code pasted from an SMS/screenshot against receipts that really reached us.
-- Only this business's receipts are searched; another business's codes look "not found".
create or replace function public.verify_mpesa_receipt(p_org uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_provider text;
  v_r public.mpesa_receipts;
  v_number integer;
  v_manual jsonb;
begin
  if not public.is_member(p_org) then raise exception 'Business not found' using errcode = 'P0002'; end if;
  select collections_provider into v_provider from public.shop_settings where org_id = p_org;
  if v_code !~ '^[A-Z0-9]{8,12}$' then
    return jsonb_build_object('format_ok', false, 'provider', coalesce(v_provider, 'manual'));
  end if;
  select * into v_r from public.mpesa_receipts where org_id = p_org and receipt = v_code;
  select number into v_number from public.orders where id = v_r.order_id;
  select coalesce(jsonb_agg(distinct o.number), '[]'::jsonb) into v_manual
    from public.payments p join public.orders o on o.id = p.order_id
   where p.org_id = p_org and p.verification = 'manual_unverified' and upper(replace(coalesce(p.external_ref, ''), ' ', '')) = v_code;
  return jsonb_build_object(
    'format_ok', true,
    'provider', coalesce(v_provider, 'manual'),
    'manual_order_numbers', v_manual,
    'receipt', case when v_r.id is null then null else jsonb_build_object(
      'code', v_r.receipt, 'status', v_r.status, 'amount_minor', v_r.amount_minor, 'currency', v_r.currency,
      'transacted_at', v_r.transacted_at, 'order_number', v_number, 'payer_hint', v_r.payer_hint, 'source', v_r.source) end
  );
end $$;

-- ───────────────────────── Storefront (anon) ─────────────────────────
-- Whether the buyer can get an STK prompt. Secrets are checked again by the Edge Function,
-- which answers not_configured if they are missing; the UI then falls back to Till/Paybill.
create or replace function public.storefront_payment_options(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_shop public.shop_settings;
begin
  v_shop := public._shop_by_slug(p_slug);
  if v_shop.org_id is null then raise exception 'Shop not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'provider', v_shop.collections_provider,
    'stk', v_shop.collections_provider in ('daraja', 'aggregator') and exists (
      select 1 from public.integration_connections
       where org_id = v_shop.org_id and state = 'connected_verified'
         and provider = case when v_shop.collections_provider = 'daraja' then 'mpesa' else v_shop.collections_aggregator end)
  );
end $$;

-- Status of one prompt, for whoever holds the order's tracking link.
create or replace function public.storefront_payment_status(p_token text, p_checkout_request_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders;
  v_req public.mpesa_requests;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Order not found' using errcode = 'P0002'; end if;
  -- Per order (not per IP: many buyers share carrier NAT addresses). ~1 poll / 3 s for 30 min.
  perform public._rate_limit('sf:paystatus:' || md5(p_token), 600, interval '1 hour');
  select * into v_order from public.orders where tracking_token = p_token;
  if v_order.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select * into v_req from public.mpesa_requests where checkout_request_id = p_checkout_request_id and order_id = v_order.id;
  if v_req.checkout_request_id is null then raise exception 'Payment request not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('status', v_req.status, 'result_code', v_req.result_code);
end $$;

-- ───────────────────────── Privileges ─────────────────────────
revoke execute on function public._order_outstanding(uuid) from public, anon, authenticated;
revoke execute on function public._mpesa_after_payment(uuid, text) from public, anon, authenticated;
revoke execute on function public.reconcile_mpesa_stk(text, integer, text, bigint, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reconcile_mpesa_c2b(text, text, bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public._order_outstanding(uuid) to service_role;
grant execute on function public._mpesa_after_payment(uuid, text) to service_role;
grant execute on function public.reconcile_mpesa_stk(text, integer, text, bigint, text, text, timestamptz) to service_role;
grant execute on function public.reconcile_mpesa_c2b(text, text, bigint, text, text, timestamptz) to service_role;

revoke execute on function public.set_collections_provider(uuid, text, text) from public, anon;
revoke execute on function public.attach_mpesa_receipt(uuid, uuid, uuid) from public, anon;
revoke execute on function public.dismiss_mpesa_receipt(uuid, uuid, text) from public, anon;
revoke execute on function public.verify_mpesa_receipt(uuid, text) from public, anon;
grant execute on function public.set_collections_provider(uuid, text, text) to authenticated, service_role;
grant execute on function public.attach_mpesa_receipt(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.dismiss_mpesa_receipt(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.verify_mpesa_receipt(uuid, text) to authenticated, service_role;

revoke execute on function public.storefront_payment_options(text) from public;
revoke execute on function public.storefront_payment_status(text, text) from public;
grant execute on function public.storefront_payment_options(text) to anon, authenticated, service_role;
grant execute on function public.storefront_payment_status(text, text) to anon, authenticated, service_role;
