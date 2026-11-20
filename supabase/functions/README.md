# Edge Functions

Nothing here is connected. Every integration is **adapter only** (code exists and is unit-tested,
but no credentials, provider registration or end-to-end test). Do not relabel an integration as
"connected and verified" until a real end-to-end test has passed.

Shared, runtime-agnostic code lives in `_shared/` (Web Crypto only) and is tested with vitest:
`npx vitest run supabase/functions`.

## Functions

| Function | Purpose | Current label |
| --- | --- | --- |
| `whatsapp-webhook` | Meta verification handshake (GET); signature-verified inbound events, dedupe, opt-out recording (POST). Never replies. | adapter_only |
| `payment-webhook` | `?provider=stripe` / `?provider=paystack`: verify signature, dedupe, record `provider_verified` payment via `record_verified_payment`. | adapter_only (Stripe, Paystack) |
| `send-message` | Authenticated send over WhatsApp / email (Resend) / SMS (Twilio). Marketing requires recorded consent. Returns `not_configured` until secrets are set. | adapter_only |
| `mpesa-stk` | Storefront asks M-Pesa (Daraja STK push) to show a payment prompt for a tracked order. Never marks anything paid. | adapter_only |
| `mpesa-callback` | Daraja STK result callback: shared-secret check, dedupe, then `reconcile_mpesa_stk` (auto-match, mismatch/late to review queue). | adapter_only |
| `mpesa-c2b` | Daraja C2B confirmation (customer paid the Till/Paybill directly): shared-secret check, dedupe, then `reconcile_mpesa_c2b`. | adapter_only |

## Environment variables (placeholders only)

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase.
Set the rest with `supabase secrets set NAME=value` — never commit values.

- `whatsapp-webhook`: `WHATSAPP_VERIFY_TOKEN=<random-string>`, `WHATSAPP_APP_SECRET=<meta-app-secret>`
- `payment-webhook`: `STRIPE_WEBHOOK_SECRET=<whsec_...>`, `PAYSTACK_SECRET_KEY=<sk_...>`
- `send-message`:
  - WhatsApp: `WHATSAPP_SEND_ENABLED=true` (feature flag, off by default), `WHATSAPP_PHONE_NUMBER_ID=<id>`, `WHATSAPP_ACCESS_TOKEN=<token>`
  - Email: `RESEND_API_KEY=<re_...>`, `RESEND_FROM="Shop <orders@your-verified-domain>"`
  - SMS: `TWILIO_ACCOUNT_SID=<AC...>`, `TWILIO_AUTH_TOKEN=<token>`, `TWILIO_FROM=<+E164 or MG... service sid>`
  - Optional: `ALLOWED_ORIGIN=<https://your-app-origin>` (CORS; defaults to `*`)
- `mpesa-stk` / `mpesa-callback`: see the M-Pesa section below.

## Deploy (not run yet)

```sh
supabase functions deploy whatsapp-webhook --no-verify-jwt   # Meta cannot send a Supabase JWT
supabase functions deploy payment-webhook --no-verify-jwt    # providers cannot send a Supabase JWT
supabase functions deploy send-message                       # requires the caller's JWT
supabase functions deploy mpesa-stk                          # storefront calls it with the anon key
supabase functions deploy mpesa-callback --no-verify-jwt     # Safaricom cannot send a Supabase JWT
supabase functions deploy mpesa-c2b --no-verify-jwt          # Safaricom cannot send a Supabase JWT
```

## Webhook URLs to register (after deploy)

- Meta app > WhatsApp > Configuration: `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook`
  (verify token = `WHATSAPP_VERIFY_TOKEN`; subscribe to `messages`)
- Stripe Dashboard > Webhooks: `https://<project-ref>.supabase.co/functions/v1/payment-webhook?provider=stripe`
  (event `payment_intent.succeeded`; PaymentIntents must carry `metadata.akunga_order_id`)
- Paystack Dashboard > Settings > API Keys & Webhooks: `https://<project-ref>.supabase.co/functions/v1/payment-webhook?provider=paystack`
  (transactions must carry `metadata.akunga_order_id`)

## Before relabelling anything as verified

1. Secrets set, function deployed, URL registered with the provider.
2. Provider test event delivered and stored in `webhook_events` with `processed_at` set.
3. For payments: a real test-mode payment recorded once (replays ignored) against the right order.
4. For WhatsApp: approved template delivered to a real handset; `STOP` withdraws consent.

## M-Pesa Daraja STK push (adapter only)

**Label: adapter only.** The code exists and `_shared/daraja.ts` is unit-tested with mocked HTTP
(`supabase/functions/_shared/daraja.test.ts`). No Daraja app, credentials, callback registration or
end-to-end test exists yet, so nothing is connected and no customer can be prompted.

How it fits together:

1. A shopper places a storefront order and gets a tracking link. On the tracking page they can ask
   for an M-Pesa prompt: the storefront calls `mpesa-stk` with `{ tracking_token, phone_e164 }`.
2. `mpesa-stk` (service role) loads the order by tracking token. It returns `503 { status: 'not_configured' }`
   unless **all** secrets below are set **and** the order's business has an `integration_connections`
   row with `provider = 'mpesa'` and `state = 'connected_verified'`. It refuses non-KES, unpayable or
   fully paid orders, throttles to 5 prompts per order per hour, asks Daraja for an OAuth token,
   sends the STK push for the outstanding balance (whole shillings only), stores
   `checkout_request_id -> order` in `public.mpesa_requests` (migration `20261120000008`; RLS on, no
   policies, service role only) and returns `{ status: 'prompt_sent', checkout_request_id }`. A prompt
   being sent is never shown as "paid".
3. Safaricom calls `mpesa-callback?secret=...`. Daraja does not sign callbacks, so the URL carries
   `MPESA_CALLBACK_SECRET` (added by `mpesa-stk`), compared in constant time. The callback is stored in
   `webhook_events` (`provider = 'mpesa'`, `event_id = CheckoutRequestID`) so replays are ignored.
   Only `ResultCode = 0` with a receipt and an amount equal to the requested amount calls
   `record_verified_payment(order, 'mpesa', 'mobile_money', amount * 100, 'KES', receipt)`, which itself
   refuses unless the business's `mpesa` connection is `connected_verified`. Cancelled or failed prompts
   are marked processed; unknown requests and amount mismatches stay unprocessed for manual review.

Secrets (placeholders only, set with `supabase secrets set`):

- `DARAJA_CONSUMER_KEY=<consumer-key>`, `DARAJA_CONSUMER_SECRET=<consumer-secret>`
- `DARAJA_SHORTCODE=<business-shortcode>`, `DARAJA_PASSKEY=<lipa-na-mpesa-passkey>`
- `DARAJA_ENV=sandbox` or `production`
- `DARAJA_CALLBACK_URL=https://<project-ref>.supabase.co/functions/v1/mpesa-callback`
- `MPESA_CALLBACK_SECRET=<long-random-string>` (used by both functions)
- Optional: `DARAJA_TRANSACTION_TYPE=CustomerBuyGoodsOnline` with `DARAJA_PARTY_B=<till-number>` for a
  Till (defaults to `CustomerPayBillOnline` with PartyB = shortcode); `ALLOWED_ORIGIN` for CORS.

Before relabelling M-Pesa as verified: run a sandbox STK push end to end, confirm the callback is stored
in `webhook_events` with `processed_at` set and a single `provider_verified` payment appears on the
right order (a replayed callback must not add a second payment). Only then set the business's
`integration_connections` row to `connected_verified`.

## Collections providers and automatic reconciliation (migration `20261120000020`)

Each shop picks how it gets paid by M-Pesa (`shop_settings.collections_provider`, changed only through
`set_collections_provider`, owner/admin). Code: `_shared/collections.ts`.

| Provider | Who it is for | Status |
| --- | --- | --- |
| `daraja` | Registered Till or Paybill (organisation KRA PIN). STK push + callback + C2B confirmation. | adapter_only |
| `aggregator` | Pochi la Biashara / personal-number sellers, through a licensed aggregator. | **interface only**: `AggregatorAdapter` is defined, IntaSend and Pesapal are listed as `adapter_only`, and `AGGREGATOR_ADAPTERS` is empty. No aggregator API was verified against official docs, so no endpoint is called and prompts return `not_configured`. |
| `manual` (default) | Anyone. The seller confirms payments by hand. | works; nothing verifiable automatically |

Reconciliation rules (SQL in the migration, mirrored in `src/domain/reconciliation.ts` and unit-tested):

- A payment is created **only** from a verified callback (`reconcile_mpesa_stk` / `reconcile_mpesa_c2b`, service role)
  or by staff attaching a receipt that already arrived through such a callback (`attach_mpesa_receipt`).
- Idempotent on the M-Pesa receipt (`mpesa_receipts.receipt` is unique) and on `CheckoutRequestID`
  (`webhook_events` + the prompt's status). Duplicate callbacks return `duplicate` and change nothing.
- STK amount must equal the amount requested **and** fit the balance due; otherwise the receipt goes to the
  merchant's queue as `mismatch` (different amount) or `late` (order cancelled, or already paid). Never auto-accepted.
- A success that arrives after the prompt was marked cancelled/timed out is still evaluated (money really moved).
- C2B is auto-matched only when the account reference is a live KES order number and the amount equals its whole
  balance; everything else (e.g. Till payments, which carry no reference) waits as `unmatched`.
- The C2B shortcode must belong to exactly one shop whose `mpesa` connection is `connected_verified`; a shortcode typed
  into shop settings alone never routes receipts to that shop.
- A fully paid `pending_confirmation` order is moved to `confirmed` with the receipt in its status history.
  (Orders already past confirmation, or partly paid, keep their status; the payment shows in payments + audit log.)
- `verify_mpesa_receipt` lets a member check a pasted code against this shop's receipts only. In manual mode it
  answers "not verifiable automatically".
- Buyers poll `storefront_payment_status(token, checkout_request_id)` (rate-limited per order) and read
  `storefront_payment_options(slug)` to decide whether to offer a prompt.

Extra Daraja setup for C2B: register `https://<project-ref>.supabase.co/functions/v1/mpesa-c2b?secret=<MPESA_CALLBACK_SECRET>`
as the ConfirmationURL with Daraja's C2B Register URL API (no ValidationURL), then set the shop's provider to Daraja.
