-- Nigeria bank-transfer auto-reconciliation (Paystack Dedicated Virtual Accounts). Additive.
--
-- * virtual_accounts: which dedicated account (NUBAN) belongs to which order or customer.
--   Written ONLY by record_virtual_account (service role), which is what the adapter's
--   assignVirtualAccount would call after a real provider assignment. That provider call
--   is NOT implemented (adapter_only), so in a real deployment this table stays empty
--   until Paystack DVA is connected and verified end to end.
-- * The unmatched-receipts queue (mpesa_receipts) is generalised: source 'bank_transfer'
--   rows carry the provider reference (Paystack `data.reference`) instead of an M-Pesa
--   code. Same statuses, same attach/dismiss RPCs, provider column tells them apart.
-- * reconcile_bank_transfer (service role, called by payment-webhook after the HMAC
--   SHA512 signature check): idempotent on the provider reference; records a verified
--   payment only when the amount equals the amount due now (unpaid deposit) or the full
--   balance of the mapped order; otherwise the transfer waits in the merchant's queue.
-- Rules mirror src/domain/reconciliation.ts (decideBankTransfer).
--
-- Unconfirmed: Paystack's amount unit for DVA credits (assumed kobo, like the rest of
-- Paystack's API). Confirm in a sandbox test before trusting automatic matching.

-- ───────────────────────── Virtual account mapping ─────────────────────────
create table public.virtual_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  provider text not null check (provider in ('paystack_dva', 'flutterwave_va')),
  bank_name text not null check (length(trim(bank_name)) between 2 and 80),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  account_name text check (account_name is null or length(account_name) <= 120),
  -- Provider customer reference (Paystack customer_code), used when the webhook lacks the account number.
  customer_ref text check (customer_ref is null or length(customer_ref) between 1 and 80),
  order_id uuid,
  customer_id uuid,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  foreign key (order_id, org_id) references public.orders(id, org_id) on delete cascade,
  foreign key (customer_id, org_id) references public.customers(id, org_id) on delete cascade,
  check (order_id is not null or customer_id is not null)
);
create unique index virtual_accounts_active_number_idx on public.virtual_accounts(provider, account_number) where status = 'active';
create unique index virtual_accounts_active_order_idx on public.virtual_accounts(order_id) where status = 'active' and order_id is not null;
create index virtual_accounts_customer_ref_idx on public.virtual_accounts(provider, customer_ref) where status = 'active' and customer_ref is not null;
create index virtual_accounts_org_idx on public.virtual_accounts(org_id, created_at desc);

alter table public.virtual_accounts enable row level security;
create policy virtual_accounts_read on public.virtual_accounts for select using (public.is_member(org_id));
revoke all on public.virtual_accounts from anon, authenticated;
grant select on public.virtual_accounts to authenticated;
create trigger audit_virtual_accounts after insert or update on public.virtual_accounts for each row execute function public.write_audit();

-- ───────────────────────── Generalised receipts queue ─────────────────────────
alter table public.mpesa_receipts drop constraint mpesa_receipts_source_check;
alter table public.mpesa_receipts add constraint mpesa_receipts_source_check
  check (source in ('stk', 'c2b', 'aggregator', 'bank_transfer'));
alter table public.mpesa_receipts drop constraint mpesa_receipts_receipt_check;
alter table public.mpesa_receipts add constraint mpesa_receipts_receipt_check check (
  (source <> 'bank_transfer' and receipt ~ '^[A-Z0-9]{8,12}$')
  or (source = 'bank_transfer' and receipt ~ '^[A-Za-z0-9][A-Za-z0-9_.=-]{3,99}$'));
-- account_ref for bank transfers = the dedicated account number that received the money.

-- ───────────────────────── Shared after-payment rule ─────────────────────────
-- Same deposit-aware rule as _mpesa_after_payment (20261120000031), with the rail named in the note.
create or replace function public._after_verified_payment(p_order uuid, p_ref text, p_via text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders;
  v_amounts jsonb;
  v_note text;
  v_label text := case when p_via = 'bank_transfer' then 'bank transfer (verified reference ' else 'M-Pesa (verified receipt ' end;
begin
  select * into v_order from public.orders where id = p_order for update;
  if v_order.status <> 'pending_confirmation' then return false; end if;
  v_amounts := public._order_amounts(p_order);
  if public._order_outstanding(p_order) <= 0 then
    v_note := 'Paid in full by ' || v_label || p_ref || ')';
  elsif (v_amounts ->> 'deposit_due_minor')::bigint > 0 and (v_amounts ->> 'deposit_outstanding_minor')::bigint <= 0 then
    v_note := 'Deposit paid by ' || v_label || p_ref || '); balance due on delivery';
  else
    return false;
  end if;
  update public.orders set status = 'confirmed' where id = p_order;
  insert into public.order_status_history (org_id, order_id, from_status, to_status, note)
  values (v_order.org_id, p_order, 'pending_confirmation', 'confirmed', v_note);
  return true;
end $$;

-- ───────────────────────── Service role: store an assigned account ─────────────────────────
create or replace function public.record_virtual_account(
  p_org uuid, p_provider text, p_bank_name text, p_account_number text, p_account_name text,
  p_customer_ref text, p_order uuid, p_customer uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_currency text;
begin
  if p_provider not in ('paystack_dva', 'flutterwave_va') then raise exception 'Unknown provider' using errcode = '22023'; end if;
  if coalesce(p_account_number, '') !~ '^[0-9]{10}$' then raise exception 'A NUBAN account number is 10 digits' using errcode = '22023'; end if;
  if p_order is null and p_customer is null then raise exception 'Assign the account to an order or a customer' using errcode = '22023'; end if;
  select base_currency into v_currency from public.organisations where id = p_org;
  if v_currency is distinct from 'NGN' then raise exception 'Virtual accounts are only for NGN businesses' using errcode = '22023'; end if;
  if p_order is not null and not exists (select 1 from public.orders where id = p_order and org_id = p_org and currency = 'NGN') then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  -- One active account per order: a re-assignment retires the previous one.
  if p_order is not null then
    update public.virtual_accounts set status = 'retired', retired_at = now()
     where order_id = p_order and status = 'active';
  end if;
  insert into public.virtual_accounts (org_id, provider, bank_name, account_number, account_name, customer_ref, order_id, customer_id)
  values (p_org, p_provider, trim(p_bank_name), p_account_number, nullif(trim(coalesce(p_account_name, '')), ''),
          nullif(trim(coalesce(p_customer_ref, '')), ''), p_order, p_customer)
  returning id into v_id;
  return v_id;
end $$;

-- ───────────────────────── Service role: verified transfer ─────────────────────────
-- Returns {outcome: recorded | unmatched | duplicate | invalid | unknown_account, ...}.
-- unknown_account: no active mapping, so no business can be named; payment-webhook leaves
-- the event unprocessed in webhook_events for manual review (same as an unknown C2B shortcode).
create or replace function public.reconcile_bank_transfer(
  p_provider text, p_reference text, p_amount_minor bigint, p_currency text,
  p_receiver_account text, p_customer_ref text, p_sender_hint text, p_paid_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ref text := trim(coalesce(p_reference, ''));
  v_currency text := upper(trim(coalesce(p_currency, '')));
  v_va public.virtual_accounts;
  v_pay_provider text;
  v_order public.orders;
  v_count integer;
  v_reason text;
  v_payment uuid;
  v_confirmed boolean;
  v_hint text := case when p_sender_hint ~ '^[0-9]{4}$' then '···' || p_sender_hint end;
begin
  if p_provider not in ('paystack_dva', 'flutterwave_va') or v_ref !~ '^[A-Za-z0-9][A-Za-z0-9_.=-]{3,99}$'
     or p_amount_minor is null or p_amount_minor <= 0 or v_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  v_pay_provider := case p_provider when 'paystack_dva' then 'paystack' else 'flutterwave' end;

  if p_receiver_account ~ '^[0-9]{10}$' then
    select * into v_va from public.virtual_accounts
     where provider = p_provider and account_number = p_receiver_account and status = 'active';
  end if;
  if v_va.id is null and nullif(trim(coalesce(p_customer_ref, '')), '') is not null then
    select count(*) into v_count from public.virtual_accounts
     where provider = p_provider and customer_ref = trim(p_customer_ref) and status = 'active';
    if v_count = 1 then
      select * into v_va from public.virtual_accounts
       where provider = p_provider and customer_ref = trim(p_customer_ref) and status = 'active';
    end if;
  end if;
  if v_va.id is null then return jsonb_build_object('outcome', 'unknown_account'); end if;

  if exists (select 1 from public.mpesa_receipts where receipt = v_ref)
     or exists (select 1 from public.payments where org_id = v_va.org_id and idempotency_key = v_pay_provider || ':' || v_ref) then
    return jsonb_build_object('outcome', 'duplicate', 'org_id', v_va.org_id);
  end if;

  if v_va.order_id is not null then
    select * into v_order from public.orders where id = v_va.order_id for update;
  else
    -- Account belongs to a customer: match only when exactly one open order of theirs is due exactly this amount.
    select count(*) into v_count from public.orders o
     where o.org_id = v_va.org_id and o.customer_id = v_va.customer_id and o.currency = v_currency
       and o.status not in ('draft', 'cancelled', 'refunded')
       and (p_amount_minor = public._order_outstanding(o.id) or p_amount_minor = public.order_amount_due_now(o.id));
    if v_count = 1 then
      select o.* into v_order from public.orders o
       where o.org_id = v_va.org_id and o.customer_id = v_va.customer_id and o.currency = v_currency
         and o.status not in ('draft', 'cancelled', 'refunded')
         and (p_amount_minor = public._order_outstanding(o.id) or p_amount_minor = public.order_amount_due_now(o.id))
       for update;
    else
      v_reason := 'No single open order for this customer is due exactly this amount';
    end if;
  end if;

  if v_reason is not null then null;
  elsif v_order.id is null then v_reason := 'No order with that number';
  elsif v_order.status in ('draft', 'cancelled', 'refunded') then v_reason := 'The order was cancelled or closed before the payment arrived';
  elsif v_currency <> 'NGN' or v_order.currency <> v_currency then v_reason := 'The transfer is not in the order''s currency';
  elsif p_amount_minor <> public._order_outstanding(v_order.id)
        and p_amount_minor <> public.order_amount_due_now(v_order.id) then v_reason := 'The amount does not equal the deposit or balance due';
  end if;

  if v_reason is null then
    begin
      v_payment := public.record_verified_payment(v_order.id, v_pay_provider, 'bank_transfer', p_amount_minor, v_currency, v_ref,
                                                  coalesce(p_paid_at, now()));
    exception when others then
      -- e.g. the provider is not connected_verified for this business: keep the money visible for review.
      v_reason := left('Could not record automatically: ' || sqlerrm, 300);
    end;
  end if;

  insert into public.mpesa_receipts (org_id, provider, source, receipt, amount_minor, currency, account_ref, payer_hint,
                                     transacted_at, status, reason, order_id, payment_id, resolved_at)
  values (v_va.org_id, v_pay_provider, 'bank_transfer', v_ref, p_amount_minor, v_currency, v_va.account_number, v_hint,
          coalesce(p_paid_at, now()), case when v_reason is null then 'matched' else 'unmatched' end, v_reason,
          case when v_reason is null then v_order.id else v_va.order_id end, v_payment, case when v_reason is null then now() end);
  if v_reason is null then
    v_confirmed := public._after_verified_payment(v_order.id, v_ref, 'bank_transfer');
    return jsonb_build_object('outcome', 'recorded', 'payment_id', v_payment, 'confirmed', v_confirmed, 'org_id', v_va.org_id);
  end if;
  return jsonb_build_object('outcome', 'unmatched', 'org_id', v_va.org_id, 'reason', v_reason);
end $$;

-- ───────────────────────── Attach: works for every rail ─────────────────────────
create or replace function public.attach_mpesa_receipt(p_org uuid, p_receipt_id uuid, p_order uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_r public.mpesa_receipts;
  v_order public.orders;
  v_payment uuid;
  v_bank boolean;
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
  v_bank := v_r.source = 'bank_transfer';

  insert into public.payments (org_id, order_id, provider, method, amount_minor, currency, status, verification,
                               external_ref, note, received_at, idempotency_key)
  values (p_org, p_order, v_r.provider, case when v_bank then 'bank_transfer' else 'mobile_money' end, v_r.amount_minor, v_r.currency,
          'succeeded', 'provider_verified', v_r.receipt,
          case when v_bank then 'Verified bank transfer attached by staff' else 'Verified M-Pesa receipt attached by staff' end,
          v_r.transacted_at, v_r.provider || ':' || v_r.receipt)
  on conflict do nothing
  returning id into v_payment;
  if v_payment is null then
    raise exception 'This receipt is already recorded as a payment' using errcode = '23505';
  end if;
  update public.mpesa_receipts
     set status = 'attached', order_id = p_order, payment_id = v_payment, resolved_by = auth.uid(), resolved_at = now()
   where id = p_receipt_id;
  perform public._after_verified_payment(p_order, v_r.receipt, case when v_bank then 'bank_transfer' else 'mpesa' end);
  return v_payment;
end $$;

-- ───────────────────────── Storefront (link holder): transfer details ─────────────────────────
-- Account details for the buyer of an NGN bank-transfer order. Only ever an active mapping that
-- record_virtual_account stored; null means "the shop will share details".
create or replace function public.storefront_bank_transfer(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders;
  v_va public.virtual_accounts;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select * into v_o from public.orders where tracking_token = p_token;
  if v_o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if v_o.currency <> 'NGN' or coalesce(v_o.payment_preference, '') <> 'bank_transfer' then return null; end if;
  select * into v_va from public.virtual_accounts where order_id = v_o.id and status = 'active';
  if v_va.id is null and v_o.customer_id is not null then
    select * into v_va from public.virtual_accounts
     where customer_id = v_o.customer_id and org_id = v_o.org_id and order_id is null and status = 'active'
     order by created_at desc limit 1;
  end if;
  return jsonb_build_object(
    'provider', coalesce(v_va.provider, (select bank_transfer_provider from public.shop_extras where org_id = v_o.org_id)),
    'account', case when v_va.id is null then null else jsonb_build_object(
      'bank_name', v_va.bank_name, 'account_number', v_va.account_number, 'account_name', v_va.account_name) end,
    'due_now_minor', public.order_amount_due_now(v_o.id),
    'reference', v_o.number);
end $$;

-- ───────────────────────── Privileges ─────────────────────────
revoke execute on function public._after_verified_payment(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.record_virtual_account(uuid, text, text, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reconcile_bank_transfer(text, text, bigint, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public._after_verified_payment(uuid, text, text) to service_role;
grant execute on function public.record_virtual_account(uuid, text, text, text, text, text, uuid, uuid) to service_role;
grant execute on function public.reconcile_bank_transfer(text, text, bigint, text, text, text, text, timestamptz) to service_role;

revoke execute on function public.attach_mpesa_receipt(uuid, uuid, uuid) from public, anon;
grant execute on function public.attach_mpesa_receipt(uuid, uuid, uuid) to authenticated, service_role;

revoke execute on function public.storefront_bank_transfer(text) from public;
grant execute on function public.storefront_bank_transfer(text) to anon, authenticated, service_role;
