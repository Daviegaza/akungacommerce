# Rafu

> **Rafu** (Swahili for "shelf") is the working product name. The owner has not approved it yet. It is set
> in `src/brand/brand.ts` (repository name: akungacommerce). Design system: [`docs/DESIGN.md`](docs/DESIGN.md).
> Operations runbook: [`docs/OPERATIONS.md`](docs/OPERATIONS.md). Product brief: [`PRODUCT_BUILD_BRIEF.md`](PRODUCT_BUILD_BRIEF.md).

A commerce operating system for businesses that sell through WhatsApp, Instagram, TikTok, direct links and in
person. Merchants get a public shop link with checkout and order tracking, plus a back office for catalogue,
orders, stock, payments, fulfilment and customers, in any country and currency.

> **Status: not in production.** Nothing is deployed to a production environment. There is no hosted Supabase
> project, and no payment or messaging provider is connected. Every provider integration is **adapter only**.
> See [Production blockers](#production-blockers).

## Two data modes, and what each one is

The same app runs in one of two modes, chosen at build time (`src/app/context.tsx`, `src/storefront/gateway.ts`):

| Mode | When | Data | What it is for |
| --- | --- | --- | --- |
| **Supabase** | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set | Real Postgres with RLS, Auth and server-side functions | Real merchants and real shops |
| **Demo** | Neither is set (or `VITE_DATA_MODE=demo`) | **Fictional** data in that browser's localStorage, two invented businesses (Kenya/KES and Germany/EUR) | Trying the product. A banner on every workspace screen says so. |

In Supabase mode, **the public shop at `/s/:slug` reads the merchant's real catalogue and creates orders through
the server function `storefront_place_order`**. Prices, tax, delivery fee and stock are computed and reserved on
the server. This is proven by automated tests against a real local Supabase stack (see [Tests](#tests)):

- `tests/db/e2e-commerce-flow.db.test.ts` drives the **same gateway code the browser uses** over HTTP, for two
  organisations at once. A merchant signs up, creates a product and receives stock, then publishes the shop. A
  guest gets a server quote, which ignores a forged price, and places an idempotent order. Stock is reserved,
  the merchant sees the order and the other merchant cannot, the merchant fulfils it (stock committed on
  dispatch), and the tracking link follows every step.
- `e2e/shop-to-order.spec.ts` (Playwright, real browser, real backend) runs the same journey through the UI:
  shop page, product page, add to cart, checkout with the server-calculated total, order placed, tracking
  page. Then the merchant signs in to `/app/orders` and sees the order, and tracking shows "preparing".

The demo shops `/s/mto-home` and `/s/atelier-lumen` exist **only in demo mode**. In demo mode the shop and the
workspace share the same browser-local state, so a product created in the demo workspace appears in the demo shop.

## Routes

| Route | Surface | Data |
| --- | --- | --- |
| `/` | Landing page | Static marketing copy |
| `/s/:slug` | Public shop: home, product pages, cart, wishlist, checkout | Supabase mode: real catalogue and orders. Demo mode: fictional. |
| `/t/:token` | Buyer order tracking (no login): timeline, deposit/balance, delivery, payment instructions, verified reviews | Same as above |
| `/r/:token` | Rider job link for the shop's own rider (no account, expires 1–72 h, revoked when the order closes) | Same as above |
| `/app` | Merchant workspace: Today, orders, fulfilment, products, inventory, customers, payments, analytics, selling tools, settings | Same as above |
| `/app/join/:token` | Accept a staff invitation | Same as above |
| `/classic` and any unknown URL | **Development builds only:** the original storefront template (mock products and invented testimonials, kept for reference). **Production builds show "This page doesn't exist" instead.** | Mock |

## Features (what is built, and how far it was verified)

"Unit" = Vitest on pure logic or the demo gateway. "DB" = tests against real local Postgres with RLS.
"E2E" = the gateway or browser end-to-end tests above. "Browser QA" = checked by hand in Chrome.

| Feature | State | Verified by |
| --- | --- | --- |
| Multi-tenant organisations, six roles, RLS on every table | Built | DB (tenant isolation across tables, role matrix parity SQL↔TS), E2E (two orgs) |
| Catalogue, variants, stock (reserve / release / commit, no oversell), adjustments | Built | Unit, DB, E2E |
| Orders: server-side totals (exclusive/inclusive tax), status machine, idempotency, returns | Built | Unit, DB, E2E |
| Public shop, cart, checkout, distance-band delivery fee, pickup, pick-up points | Built | Unit, DB, E2E (browser) |
| Order tracking link | Built | DB, E2E (browser) |
| Manual payments (always `manual_unverified`, capped at balance due), refunds, reversals | Built | Unit, DB |
| Deposits and failed-delivery rules, returned to shop, rider links | Built | Unit, DB, Browser QA |
| M-Pesa STK push + automatic reconciliation, C2B, STK query fallback | **Adapter only** (no Daraja account) | Unit, DB. The demo simulates the lifecycle and says so. |
| Product photo upload (camera, picker, drag and drop; resized in the browser) | Built | Unit (compression), DB (storage policies: own org folder, 5 MB, raster only). The upload UI was checked in demo mode. An upload to Supabase Storage from a browser has **not** been run as an automated test. |
| CSV product import (2,000 rows, dry run, all-or-nothing) | Built | Unit, DB |
| Staff invitations (link token, roles, revoke; email invites need a confirmed email) | Built. Rafu does not send them; the owner shares the link. | DB |
| Trust badges, report a shop, marketing consent, re-engagement list, "where's my money" | Built | Unit, DB |
| Reliable WhatsApp STOP handling (retryable, idempotent, durable failure state) | Built, adapter only | Unit (8), DB (8) |
| Outbound messages (named customers only, logged, rate-limited) | Built, adapter only (no provider secrets) | DB |
| Abuse protection on public checkout (IP/phone/shop limits, ≤3 open unpaid orders per phone, stale-order release, expected-total check) | Built | Unit, DB |
| Analytics per currency, CSV exports (decimal-exact, formula-injection safe) | Built | Unit |
| eTIMS-style tax invoices (manual entry, nothing sent to KRA) | Built | Unit, DB |
| Custom domains (DNS check only; no certificate or hosting) | Built, not deployed | Unit, DB |

## Architecture

```
React (Vite) ──► CommerceGateway ──► Supabase gateway ──► PostgREST ──► RLS-protected tables (reads)
     │                │                                       └─► SECURITY DEFINER RPCs (every money/stock write)
     │                └──► Demo gateway (localStorage, same domain rules, fictional data)
     └──► StorefrontGateway (anon key only) ──► storefront_* RPCs (rate-limited, server-priced)

Edge Functions (service role, server only) ──► reconcile_* / record_verified_payment / webhook_events
```

- **Tenancy.** Data belongs to an organisation. Users join through memberships with one of six roles: owner,
  admin, manager, sales, fulfilment or analyst. Child rows carry `org_id` with composite foreign keys, so a row
  can never reference another tenant's data.
- **Writes that touch money or stock** go only through `SECURITY DEFINER` functions that check membership,
  role permission and that every referenced row belongs to the organisation. Direct writes are revoked.
- **Server-calculated totals.** The server computes every total from catalogue prices, tax rates and delivery
  bands. Client-sent prices are ignored. Order lines are immutable snapshots.
- **Money** is `bigint` minor units with an ISO 4217 currency. It is never a float, and different currencies are
  never summed. Analytics and exports group by currency.
- **Idempotency keys** on orders, stock adjustments, payments, refunds and returns.
- **Append-only history** for stock movements, payments, refunds, status history and the audit log.
- **Honest payment status.** Staff entries are `manual_unverified`. Only a signature-verified provider callback
  (service role, replay-protected, for a `connected_verified` integration, amount within the balance) creates
  `provider_verified`.
- **No privileged keys in the browser.** The browser only ever has the anon key.

## Run it

Requirements: Node 24+, npm. Docker is needed for Supabase mode and the database tests.

```sh
npm ci
npm run dev                       # demo mode at http://localhost:5173
# or, if the dev server shows a blank page in your environment:
npm run build && npm run preview -- --port 4173
```

Supabase mode, local:

```sh
npx supabase start                # ports 58320-58329 (supabase/config.toml)
npx supabase status               # copy the API URL and anon key
cp .env.example .env.local        # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

Production setup, environment variables, backups, monitoring and rollback: [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Tests

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm run typecheck` | `tsc -b` | – |
| `npm run lint` | ESLint, **0 errors** | – |
| `npm test` | Unit tests: domain rules, demo gateway, integrations, Edge Function shared code | – |
| `npm run build` | Production build | – |
| `npm run test:db` | Database integration tests, including the two-org gateway end-to-end flow | `SUPABASE_DB_URL`; the gateway E2E file also needs `SUPABASE_API_URL` and `SUPABASE_ANON_KEY`. Without them those tests are **skipped, not passed**. |
| `npm run test:e2e` | Playwright browser test against a real backend (builds the app in Supabase mode on :4174) | `SUPABASE_API_URL`, `SUPABASE_ANON_KEY`, a Chromium (`npx playwright install chromium`) or `PW_CHANNEL=chrome` |
| `deno check supabase/functions/*/index.ts` | Type-checks every Edge Function | Deno 2 |

Local values: `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:58322/postgres`,
`SUPABASE_API_URL=http://127.0.0.1:58321`, `SUPABASE_ANON_KEY=` the anon key from `npx supabase status`.

**CI** (`.github/workflows/ci.yml`) runs on every push and pull request:
1. Node 24: `npm ci`, typecheck, unit tests, build and lint.
2. Deno: type-checks every Edge Function.
3. Database: starts Supabase, applies **every migration from an empty database** (`supabase db reset`), then runs
   `npm run test:db` and the Playwright browser E2E.

Database tests run each call as the `authenticated` or `anon` role with real JWT claims, so RLS and permission
checks apply exactly as they do for browser requests. They cover:
- tenant isolation and anonymous denial
- the role matrix
- totals with both tax modes
- idempotency and the status machine
- stock reserve, release, commit and oversell
- refunds, returns and reversal
- the audit trail and verified-payment guards
- M-Pesa and bank-transfer reconciliation
- deposits, rider links and returned-to-shop
- trust, consent and invitations
- WhatsApp opt-out reliability
- checkout abuse limits

## Global support

- Any ISO 4217 currency with its correct minor unit (JPY 0, KWD 3), formatted with `Intl` for the business locale.
- IANA time zone and locale per organisation. Timestamps are stored in UTC and reports bucket by the
  business date. This is tested for Nairobi, Berlin (including daylight-saving changes), Tokyo, London and New York.
- Phone numbers are stored in E.164, normalised with `libphonenumber-js` using the business country as the
  default region.
- Addresses are free-form lines plus optional region and postal code. Nothing is Kenya-specific.
- Tax rates are configurable metadata (basis points per product, exclusive or inclusive per business). They are
  **not** jurisdiction rules and do not make anyone tax-compliant; a qualified adviser must review them.

## Integration status

Every integration carries exactly one label: **connected and verified**, **configured but unverified**,
**adapter only**, or **not implemented**. **None is connected and verified.** "Adapter only" means the code
exists and is tested against fixtures, but no provider account, credentials or end-to-end test exists.

| Integration | Label | Notes |
| --- | --- | --- |
| WhatsApp Business Platform (Cloud API) | Adapter only | Signature-verified webhook, reliable retryable opt-out, send adapter behind `WHATSAPP_SEND_ENABLED`. Needs a Meta app, number, token, approved templates and an end-to-end test. |
| WhatsApp click-to-chat links | Works, no API | Opens the merchant's own WhatsApp with a prepared message. Nothing is sent automatically. |
| Email (Resend) | Adapter only | No account or secrets |
| SMS (Twilio) | Adapter only | No account or secrets |
| Stripe | Adapter only | Webhook signature and replay window. Rafu never creates charges. |
| Paystack (incl. NGN dedicated virtual accounts) | Adapter only | Webhook signature verification; DVA credits go to `reconcile_bank_transfer`. Account assignment is not implemented, and the kobo amount unit is unconfirmed in sandbox. |
| M-Pesa Daraja (STK, callback, C2B, STK query) | Adapter only | Reconciliation built and tested (unit + DB). Needs a registered Till/Paybill, Daraja keys and a sandbox end-to-end test. Callbacks are unsigned: protected by a URL secret, an optional IP allowlist, replay protection and exact-amount matching. |
| IntaSend, Pesapal (aggregators) | Adapter only | Interface only; no API called |
| Flutterwave (NGN virtual accounts) | Adapter only | `verif-hash` check only; nothing is recorded from it |
| Courier / delivery APIs, Pick Up Mtaani, Bolt Send | Not implemented | Rider links, your own pick-up points and manual carrier + tracking number are built in without any API |
| Xero, QuickBooks Online | Not implemented | |
| CSV export / import | Works (both modes) | |
| Meta Pixel / Google Analytics 4 | Works, no account verified | Loaded on the shop only after the shopper taps Allow; never in the staff app |
| Custom domains | DNS check built, not deployed | `verified` means DNS only. There is no certificate or hosting. |
| Product image storage (Supabase Storage) | Built, not deployed | Policies DB-tested; no hosted bucket exists |
| KRA eTIMS | Not implemented (manual) | Printable numbered tax invoices and a CSV for manual eTIMS Lite entry. Nothing is submitted to KRA. |

Edge Functions: [`supabase/functions/README.md`](supabase/functions/README.md). **No Edge Function is deployed.**
All nine type-check with Deno and have booted in the local edge runtime, but none has received a real provider call.

## Production blockers

1. **Hosted infrastructure.** No hosted Supabase project, deployed Edge Functions, production domain or
   production auth email (SMTP) exist. Only Vercel preview builds of this branch exist (demo mode).
2. **Provider accounts.** Each integration needs a real account, secrets and a passing end-to-end test before
   its label changes. For M-Pesa, Daraja does not support Pochi/personal numbers, so an aggregator decision is needed.
3. **Payout model.** A platform-wide Daraja shortcode would collect money for every merchant into one account.
   Choose per-merchant credentials (or an aggregator with sub-accounts) before going live.
4. **Scheduled jobs.** The stale-order release, rate-limit pruning, WhatsApp retry, STK query, photo cleanup and
   domain re-check jobs are built but not scheduled ([OPERATIONS §5](docs/OPERATIONS.md)).
5. **Ops.** Monitoring, alerting, a timed backup-restore drill and data-retention limits (webhook payloads
   contain phone numbers).
6. **Open product and security decisions:**
   - All staff roles, including analysts, can read customer contact details.
   - Order tracking tokens never expire.
   - Rate-limit counters roll back when a public call fails, so failed attempts are not counted. Token
     entropy (144–256 bits) is what protects against guessing.
   - A Till or Paybill entered by two shops is not blocked. C2B matching refuses the ambiguity rather than
     guessing.
7. **Legal and tax.** A privacy notice, terms and a data-protection review per launch country (Kenya: ODPC
   registration) are needed. A tax adviser must review the invoices.
8. **Brand.** The owner has not approved the name or the design.

## Data rules worth knowing

- **Deposits** (`20261120000030`, rules in `src/domain/delivery-policy.ts`): a shop picks pay on delivery,
  deposit (percent or fixed, optional minimum order, optionally at least the delivery fee) or full prepayment.
  The server computes the deposit from the all-in total, rounded up to a whole major unit. The M-Pesa prompt
  charges the amount due now. A direct Till payment of exactly the deposit, or of the full balance, matches
  automatically (`20261120000031`).
- **Failed deliveries** keep the order "out for delivery" and count the attempt. A delivery fee is kept from a
  paid deposit only for buyer-caused failures under a "buyer pays" policy. After the last attempt, rider links
  are cancelled.
- **Returned to shop** (`20261120000070`): this is the only way from dispatched to cancelled. Stock goes back,
  and what the buyer paid, minus any fee kept, becomes a pending refund suggestion. Rafu never moves money.
- **Unpaid storefront orders** hold stock while waiting. A buyer can have at most 3 open unpaid orders per shop.
  The scheduled `cancel_stale_storefront_orders` releases stock from unpaid orders after 24 hours (once scheduled).
- **Stock** is reserved for orders awaiting confirmation, confirmed, preparing or ready. It is committed on
  dispatch (or on delivery, for pickups) and released on cancel. Stock never goes negative or below what is reserved.
- **Refunds** record money returned; they do not move it. Use "Return items to stock" to restock goods.
- **Base currency** is fixed once products or orders exist.
