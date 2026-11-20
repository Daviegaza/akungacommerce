# Edge Functions

Nothing here is deployed or connected. Every integration is **adapter only** (code exists and is unit-tested,
but no credentials, provider registration or end-to-end test). Do not relabel an integration as
"connected and verified" until a real end-to-end test has passed.

Shared, runtime-agnostic code lives in `_shared/` (Web Crypto only) and is tested with vitest:
`npx vitest run supabase/functions`. Every function type-checks with Deno
(`deno check supabase/functions/*/index.ts`, also run in CI).

**What has actually been run:** unit tests of the shared code, database tests of every SQL function the
functions call, `deno check` of all nine functions, and (2026-11-20) a boot of all nine in the local
Supabase edge runtime, where they refused unconfigured or unsigned requests. **No function has been called
by a real provider (Meta, Safaricom, Stripe, Paystack, Resend, Twilio), and none is deployed.**

## Functions

| Function | Purpose | Current label |
| --- | --- | --- |
| `whatsapp-webhook` | Meta verification handshake (GET); signature-verified inbound events, dedupe, reliable opt-out (POST); `POST ?retry=1` re-runs stored events that failed. Never replies. See "WhatsApp opt-outs". | adapter_only |
| `payment-webhook` | `?provider=stripe` / `?provider=paystack`: verify signature, dedupe, record `provider_verified` payment via `record_verified_payment`. Paystack dedicated-account credits (`charge.success`, channel `dedicated_nuban`) go to `reconcile_bank_transfer` instead (see "Nigeria bank transfer" below). | adapter_only (Stripe, Paystack, Paystack DVA) |
| `send-message` | Authenticated send over WhatsApp / email (Resend) / SMS (Twilio) to a **named customer only** (the recipient is read from the database). Marketing requires recorded consent. Every attempt is logged in `outbound_messages` and limited (300 an hour per business, 100 per staff member, 10 per customer) before any provider is called. Returns `not_configured` until secrets are set. | adapter_only |
| `mpesa-stk` | Storefront asks M-Pesa (Daraja STK push) to show a payment prompt for a tracked order. Never marks anything paid. | adapter_only |
| `mpesa-callback` | Daraja STK result callback: shared-secret check, dedupe, then `reconcile_mpesa_stk` (auto-match, mismatch/late to review queue). | adapter_only |
| `mpesa-c2b` | Daraja C2B confirmation (customer paid the Till/Paybill directly): shared-secret check, dedupe, then `reconcile_mpesa_c2b`. | adapter_only |
| `mpesa-stk-query` | Scheduled fallback for lost STK callbacks: asks Daraja's STK Push Query API about prompts pending 2 min – 24 h, then `apply_mpesa_stk_query`. A "paid" answer never records money (no receipt/amount in the query). Service-role bearer only. | adapter_only, not scheduled |
| `media-cleanup` | Deletes orphaned product photos (in `product-images`, referenced by no product or shop, older than 24 h) through the Storage API. For a scheduled run; see "Orphaned photo cleanup". | built, not deployed, not scheduled |
| `verify-custom-domain` | Merchant "Check now" (rate-limited) or a scheduled run: resolves the CNAME/A and ownership TXT records over DNS-over-HTTPS and sets the domain status. DNS only, no certificate or hosting. See "Custom domain DNS check". | built, not deployed |

## Environment variables (placeholders only)

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase.
Set the rest with `supabase secrets set NAME=value` — never commit values.

- `whatsapp-webhook`: `WHATSAPP_VERIFY_TOKEN=<random-string>`, `WHATSAPP_APP_SECRET=<meta-app-secret>`, optional `WEBHOOK_RETRY_SECRET=<random, 16+ characters>` for the scheduled retry
- `payment-webhook`: `STRIPE_WEBHOOK_SECRET=<whsec_...>`, `PAYSTACK_SECRET_KEY=<sk_...>`
- `send-message`:
  - WhatsApp: `WHATSAPP_SEND_ENABLED=true` (feature flag, off by default), `WHATSAPP_PHONE_NUMBER_ID=<id>`, `WHATSAPP_ACCESS_TOKEN=<token>`
  - Email: `RESEND_API_KEY=<re_...>`, `RESEND_FROM="Shop <orders@your-verified-domain>"`
  - SMS: `TWILIO_ACCOUNT_SID=<AC...>`, `TWILIO_AUTH_TOKEN=<token>`, `TWILIO_FROM=<+E164 or MG... service sid>`
  - Optional: `ALLOWED_ORIGIN=<https://your-app-origin>` (CORS; defaults to `*`)
- `mpesa-stk` / `mpesa-callback` / `mpesa-c2b`: see the M-Pesa section below. Optional for the two callbacks:
  `MPESA_ALLOWED_IPS=<Safaricom IPv4 addresses or CIDR ranges>` together with
  `MPESA_CLIENT_IP_HEADER=<the header your hosting sets to the true caller IP>`. Both unset = no IP check
  (the URL secret still applies). An allowlist without the header is refused as a misconfiguration. Get the
  current IP list from Safaricom; none is shipped here. Which header carries the real caller IP on Supabase
  hosting has **not** been verified.

## Deploy (not run yet)

```sh
supabase functions deploy whatsapp-webhook --no-verify-jwt   # Meta cannot send a Supabase JWT
supabase functions deploy payment-webhook --no-verify-jwt    # providers cannot send a Supabase JWT
supabase functions deploy send-message                       # requires the caller's JWT
supabase functions deploy mpesa-stk                          # storefront calls it with the anon key
supabase functions deploy mpesa-callback --no-verify-jwt     # Safaricom cannot send a Supabase JWT
supabase functions deploy mpesa-c2b --no-verify-jwt          # Safaricom cannot send a Supabase JWT
supabase functions deploy mpesa-stk-query                    # scheduler sends the service role key
supabase functions deploy media-cleanup --no-verify-jwt      # x-cleanup-secret or service-role bearer
supabase functions deploy verify-custom-domain               # see "Custom domain DNS check"
```

## Webhook URLs to register (after deploy)

- Meta app > WhatsApp > Configuration: `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook`
  (verify token = `WHATSAPP_VERIFY_TOKEN`; subscribe to `messages`)
- Stripe Dashboard > Webhooks: `https://<project-ref>.supabase.co/functions/v1/payment-webhook?provider=stripe`
  (event `payment_intent.succeeded`; PaymentIntents must carry `metadata.akunga_order_id`)
- Paystack Dashboard > Settings > API Keys & Webhooks: `https://<project-ref>.supabase.co/functions/v1/payment-webhook?provider=paystack`
  (transactions must carry `metadata.akunga_order_id`)

## WhatsApp opt-outs (migration `20261121000080_webhook_retry.sql`)

A customer who replies STOP must never stay subscribed because of a passing error.

1. The event is stored in `webhook_events` (unique per provider and message id).
2. `whatsapp_apply_opt_out` withdraws consent (source `stop_reply`) **and** marks the event processed in one
   transaction, with the event row locked. Either both happen or neither does.
3. On any failure, `webhook_event_failed` records the attempt and the error, and the webhook answers 500 so
   Meta delivers the event again. A re-delivery of a stored but unprocessed event is processed again; a
   processed one is skipped, so there is no second side effect.
4. After 8 failed attempts the event is parked (`dead_at`) for a person to review. It is never marked processed.
5. Optional scheduled retry: `POST /whatsapp-webhook?retry=1` with `x-retry-secret: <WEBHOOK_RETRY_SECRET>`
   re-runs pending events, oldest first, with back-off (`webhook_events_pending`). Not scheduled anywhere.
6. One WhatsApp business number can belong to only one organisation (unique index), so an opt-out always
   routes to exactly one business.

Tested: 8 unit tests (`_shared/whatsapp-process.test.ts`: success, duplicate, failed update then retry,
scheduled retry, parking, and failure to record the failure) and 8 database tests
(`tests/db/webhook-retry.db.test.ts`, including a simulated database outage during the consent update).
Not tested with a real Meta delivery.

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

## STK Push Query fallback for lost callbacks (migration `20261120000061`, adapter only)

Safaricom sometimes never delivers an STK callback. `mpesa-stk-query` asks Daraja
(`POST /mpesa/stkpushquery/v1/query` with `BusinessShortCode`, `Password`, `Timestamp`, `CheckoutRequestID`,
built by `_shared/daraja.ts` → `buildStkQueryPayload` / `queryStkPush`, tested with mocked HTTP in
`_shared/stk-query.test.ts`) what happened to every prompt that has been `pending` for more than 2 minutes and
less than 24 hours (`mpesa_prompts_due_for_query`, at most 25 per run, each prompt at most every 2 minutes).

| Query answer | Prompt becomes | Money recorded? |
| --- | --- | --- |
| `ResultCode 0` | `awaiting_receipt` (merchant queue: "M-Pesa says paid — waiting for receipt"; buyer: "M-Pesa says you paid … do not pay again") | **No.** The query response has no receipt number and no amount. The payment is recorded only when the callback (`reconcile_mpesa_stk`, which still accepts an `awaiting_receipt` prompt) or a C2B confirmation arrives. |
| `1032` | `cancelled` | No |
| `1037`, `1019` | `timeout` | No |
| anything else (`1` insufficient funds, `2001` wrong PIN, …) | `failed` | No |
| "still processing" (`errorCode 500.001.1001`) or any query error | stays `pending` (`query_count`, `last_queried_at` updated) | No |

The "still processing" error code is taken from commonly observed Daraja behaviour, not verified in a sandbox
run here; anything unexpected is treated as an error and the prompt simply stays pending.

The function requires `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (constant-time compare) and the same
Daraja secrets as `mpesa-stk`. It returns `503 not_configured` until they are set.

### Scheduling (not enabled anywhere — do this only once Daraja is verified)

Option A, `pg_cron` + `pg_net` inside the project database (keep the key in Vault, never in a migration):

```sql
-- Run once in the SQL editor of the real project, after storing the key:
--   select vault.create_secret('<service-role-key>', 'service_role_key');
select cron.schedule(
  'mpesa-stk-query', '*/3 * * * *',
  $$ select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/mpesa-stk-query',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
       body := '{}'::jsonb) $$
);
-- Stop it: select cron.unschedule('mpesa-stk-query');
```

Option B, Supabase Dashboard → Integrations → Cron → "Supabase Edge Function" job every 3 minutes, POST to
`mpesa-stk-query` with the service-role Authorization header.

Every 2–5 minutes is enough; Daraja rate-limits the query API, so do not run it more often.

## Nigeria bank transfer: Paystack Dedicated Virtual Accounts (migration `20261120000060`, adapter only)

**Label: adapter only.** Webhook verification and matching are built and tested; account assignment is not.

1. **Account mapping.** `public.virtual_accounts` maps a 10-digit NUBAN (bank, account name, Paystack
   `customer_code`) to an order or a customer. Rows are written only by `record_virtual_account` (service role),
   which a real `assignVirtualAccount` adapter would call after Paystack returns an account.
   `_shared/bank-transfer.ts` → `assignVirtualAccount` is **not implemented**: it calls nothing and answers
   `not_configured`. In the app, "Get account number" says so honestly; the demo simulates an account.
2. **Webhook.** `payment-webhook?provider=paystack` verifies `x-paystack-signature` (HMAC SHA512 of the raw
   body), stores the event in `webhook_events`, and if `parsePaystackDvaCharge` recognises a `charge.success`
   with channel `dedicated_nuban` in NGN, calls `reconcile_bank_transfer` with the verified fields only.
3. **Matching** (`reconcile_bank_transfer`, mirrored by `decideBankTransfer` in `src/domain/reconciliation.ts`):
   - the receiving account number (or, failing that, a unique `customer_code`) must map to an active account;
     otherwise `unknown_account` and the event stays unprocessed for manual review;
   - idempotent on the Paystack `reference` (`mpesa_receipts.receipt` is unique; payments are keyed
     `paystack:<reference>`, the same key the card path uses, so one transaction is never recorded twice);
   - recorded (method `bank_transfer`, `provider_verified`) only when the amount equals the amount due now
     (unpaid deposit) or the full balance of the mapped order; a customer account matches only when exactly one
     open order of that customer is due exactly that amount. A new order is then confirmed by the same
     deposit-aware rule as M-Pesa (`_after_verified_payment`).
   - anything else goes to the shared unmatched queue (`mpesa_receipts`, `source = 'bank_transfer'`,
     `provider = 'paystack'`), where staff attach it to an order or dismiss it with a reason.
4. **Tracking page.** `storefront_bank_transfer(token)` returns bank name, account number, the exact amount due
   now and the order number to quote as the reference — or `account: null`, in which case the buyer is told the
   shop will share details.

**Unconfirmed:** Paystack's DVA docs do not restate the amount unit. Paystack amounts are in kobo elsewhere, so
`amount` is treated as kobo (`PAYSTACK_DVA_AMOUNT_UNIT_CONFIRMED = false`). Confirm with a sandbox transfer
before trusting automatic matching.

Before relabelling: Paystack secret set, DVA enabled on the Paystack account, a real `assignVirtualAccount`
implemented against the official API, webhook URL registered, and one sandbox transfer recorded once against the
right order (replay ignored).
## Orphaned photo cleanup (`media-cleanup`, migration `20261120000071`)

Product photos are uploaded to the public `product-images` bucket as soon as the merchant picks them, before the
product is saved. The browser deletes a photo it uploaded in the same editing session when the merchant removes it
or closes the editor without saving (best effort). Everything it misses, and photos removed from a saved product
later, is handled here:

- `list_orphan_product_images(min_age, limit)` (service role only) lists objects under an org-id folder that no
  product of any organisation and no shop cover/logo references, older than `min_age` (default 24 h, never under 1 h).
- `media-cleanup` calls it and deletes the objects through the Storage API with the service role, in batches of
  100. A failed batch is skipped and retried on the next run. It logs counts only.

Call it with `POST` and either `x-cleanup-secret: <MEDIA_CLEANUP_SECRET>` (at least 16 characters, set with
`supabase secrets set`) or `Authorization: Bearer <service role key>`. Body (optional):
`{ "dry_run": true, "min_age_hours": 24, "limit": 500 }`. Try a dry run first.

```sh
supabase functions deploy media-cleanup --no-verify-jwt   # the function checks its own secret
```

**Scheduling (not enabled).** On the hosted project, with the `pg_cron` and `pg_net` extensions enabled and the
secret stored in Vault as `media_cleanup_secret`, a nightly run would be:

```sql
select cron.schedule('media-cleanup-nightly', '30 2 * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/media-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'media_cleanup_secret')),
    body := '{}'::jsonb);
$$);
```

Nothing above has been run against any project. Demo mode has nothing to clean: demo photos are data URLs that only
reach browser storage when the product is saved, and saving replaces the product's image list.

## Custom domain DNS check (`verify-custom-domain`, migration `20261120000072`)

**Label: DNS check built, certificate and hosting not set up.** A domain can reach `verified`, but that only means
its DNS records are right. No certificate is issued and nothing serves the domain yet; the merchant screen says so.

- Records checked (same as the instructions shown to the merchant): a CNAME for a subdomain pointing at
  `CUSTOM_DOMAIN_CNAME_TARGET`, or an A record for an apex domain equal to `CUSTOM_DOMAIN_A_RECORD`, plus the TXT
  record `_rafu-verification.<host>` = `rafu-verify=<token>`. Without the target env set, a domain can never verify.
  Keep `VITE_CUSTOM_DOMAIN_CNAME_TARGET` / `VITE_CUSTOM_DOMAIN_A_RECORD` (what the UI shows) equal to these.
- DNS is resolved with Cloudflare's public DNS-over-HTTPS JSON API (`GET https://cloudflare-dns.com/dns-query?name=..&type=..`,
  header `accept: application/dns-json`). Resolver errors leave the domain unchanged and return `status: "error"`.
- Merchant "Check now": `POST { "org_id": "<uuid>" }` with the merchant's own JWT. `request_custom_domain_check` runs as
  that user: owners/admins only, 5 checks per 15 minutes per shop (HTTP 429 after that).
- Scheduled run: `POST { "scheduled": true, "limit": 25 }` with `x-cron-secret: <DOMAIN_CHECK_CRON_SECRET>` or the
  service role key. It checks domains that are `pending_dns` or `failed` and were not checked in the last hour.
  Scheduling works like the cleanup example above (not enabled).
- The result is written with the existing service-role `mark_custom_domain_status`.

```sh
supabase secrets set CUSTOM_DOMAIN_CNAME_TARGET=<domains.your-host.example> CUSTOM_DOMAIN_A_RECORD=<203.0.113.10> DOMAIN_CHECK_CRON_SECRET=<long-random-string>
supabase functions deploy verify-custom-domain   # JWT check on: merchants send their JWT; a cron call sends the anon key as Authorization plus x-cron-secret
```

The demo workspace simulates "Check now" (always a pass, labelled as simulated, same rate limit). Unit tests mock
`fetch`; no test makes a real DNS request.
