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
| `mpesa-callback` | Daraja STK result callback: shared-secret check, dedupe, records a `provider_verified` payment on ResultCode 0. | adapter_only |

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
