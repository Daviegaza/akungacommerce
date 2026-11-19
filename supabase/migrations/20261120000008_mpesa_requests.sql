-- M-Pesa Daraja STK push requests (adapter only; nothing is connected).
-- The mpesa-stk Edge Function records each prompt it sends so that the
-- mpesa-callback function can map Daraja's CheckoutRequestID back to the order
-- and compare the amount. Service role only: RLS on, no policies, no grants.
create table public.mpesa_requests (
  checkout_request_id text primary key check (length(checkout_request_id) between 1 and 100),
  org_id uuid not null references public.organisations(id) on delete cascade,
  order_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  created_at timestamptz not null default now(),
  foreign key (order_id, org_id) references public.orders(id, org_id) on delete cascade
);
create index mpesa_requests_order_idx on public.mpesa_requests(order_id);

alter table public.mpesa_requests enable row level security; -- no policies: service role only
revoke all on public.mpesa_requests from anon, authenticated;

-- Fix for 20261120000007: storefront_place_order calls gen_random_bytes (pgcrypto),
-- which Supabase installs in the `extensions` schema, but the function pinned
-- search_path to `public, pg_temp`, so every guest checkout failed with
-- "function gen_random_bytes(integer) does not exist". Only privileged roles can
-- create objects in `extensions`, so adding it after `public` is safe.
alter function public.storefront_place_order(text, jsonb, text) set search_path = public, extensions, pg_temp;
