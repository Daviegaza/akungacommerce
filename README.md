# Rafu

> **Rafu** (Swahili for "shelf") is the proposed product name. It is set in `src/brand/brand.ts` (repository name: akungacommerce). Design system: [`docs/DESIGN.md`](docs/DESIGN.md).

## Routes

| Route | Surface |
| --- | --- |
| `/` | Rafu landing page |
| `/s/:slug` | Public shop: home, product pages, cart, wishlist, checkout (demo shops: `/s/mto-home`, `/s/atelier-lumen`) |
| `/t/:token` | Buyer order tracking. No login: status timeline, map, payment instructions, verified reviews |
| `/app` | Merchant workspace (Today, orders, products, My shop, inventory, customers, payments, analytics, settings) |
| `/classic` | Original storefront template, kept for reference |

## Storefront features

- **Image-first shop and product cards:**
  - swipeable galleries, wishlist and search suggestions
  - category chips, rails for featured items, deals and coming-soon drops
  - a sticky Add to cart / Order on WhatsApp bar
- **Guest checkout:**
  - delivery pin on a map (MapLibre with OpenFreeMap tiles: free, no key), with landmark and building fields
  - delivery fee calculated on the server from distance bands
  - the full total, including delivery, shown before the order button
  - M-Pesa Till/Paybill instructions or cash on delivery
  - marketing opt-in is unticked by default
- **Order tracking link** with real timestamps. It never shows a moving rider unless one is real.
- **Honest signals only:**
  - ratings come from verified delivered orders
  - sold counts come from real deliveries and are hidden below 5
  - "only N left" comes from real stock
  - countdowns appear only for scheduled drops
  - a "was" price must be higher than the current price
- **Merchant side:**
  - live activity feed and an optional sale chime
  - milestone celebrations, KPI sparklines for each currency
  - order cards with status tabs and one-tap next actions
  - photo-grid products with storefront settings (images, compare-at price, swatches, drops)
  - product photo upload from phone or computer (camera, picker, drag and drop): resized and re-encoded to WebP/JPEG in the browser, then stored in the public `product-images` bucket under the org's folder (Supabase) or as small data URLs in localStorage (demo, max 8 per product)
  - "My shop" settings with a delivery-zone map, QR code and WhatsApp share kit
- **M-Pesa STK push:** Daraja adapter plus callback Edge Functions. It is **adapter only, not connected**, and payments are still confirmed by the merchant.


Under the hood: a merchant operating system for businesses that sell through WhatsApp, Instagram, other social channels, direct links and in person. Merchants use it to run their catalogue, orders, stock, payments, fulfilment and customer history, in any country and currency.

Product specification: [`PRODUCT_BUILD_BRIEF.md`](PRODUCT_BUILD_BRIEF.md).

> **Status: first vertical slice, not production.** Nothing is deployed. No integration is connected. See [What still blocks production](#what-still-blocks-production).

## What is in the repository

| Path | What it is |
| --- | --- |
| `/app/*` (`src/app/`) | **Merchant workspace**: Today queue, orders, fulfilment, products, inventory, customers, payments, analytics, settings |
| `/` and the other routes (`src/pages/`, `src/components/`) | The original storefront template, kept unchanged as a public-shop prototype. It still uses mock product data. |
| `src/domain/` | Pure TypeScript business rules: money, order totals and status machine, stock, payments/refunds, roles, locale/phone/time, analytics |
| `src/gateway/` | `CommerceGateway` interface, plus two implementations: Supabase, and an in-browser demo |
| `src/integrations/` | Honest integration registry, WhatsApp click-to-chat links, CSV exports |
| `supabase/migrations/` | Postgres schema, RLS, server-side business functions, audit log, storage bucket |
| `supabase/functions/` | Edge Functions: WhatsApp webhook, payment webhook (Stripe/Paystack), send-message. All are adapter only. |
| `tests/db/` | Integration tests run against a real Supabase Postgres |

## Architecture

```
React (Vite) ──► CommerceGateway ──► Supabase gateway ──► PostgREST ──► RLS-protected tables (reads)
                     │                                    └─► security-definer RPCs (all money/stock writes)
                     └──► Demo gateway (localStorage, same domain rules, fictional data)

Edge Functions (service role, server only) ──► record_verified_payment / webhook_events
```

- **Multi-tenant model.** Data belongs to an `organisation`. Users join through `memberships`, each with one of six roles: owner, admin, manager, sales, fulfilment or analyst. Every table has row-level security. Child rows carry `org_id` with composite foreign keys, so a row can never reference another tenant's data.
- **Writes that touch money or stock** go only through `SECURITY DEFINER` functions. These are `create_order`, `transition_order`, `record_manual_payment`, `reverse_payment`, `record_refund`, `return_order_items`, `adjust_stock`, `save_product`, `update_fulfilment` and the team functions. Each one checks membership and role permission and validates that every referenced row belongs to the organisation. Direct `INSERT`/`UPDATE` on those tables is revoked.
- **Server-calculated orders.** The server computes order totals from catalogue prices and ignores any prices the client sends. Order lines are immutable snapshots of name, SKU, quantity, unit price, currency and tax rate.
- **Money** is stored as `bigint` minor units with an explicit ISO 4217 currency, and is never a float. Variants are priced in the business's base currency. Mixed currencies are rejected, never summed. Analytics and exports group by currency.
- **Idempotency keys** on order creation, stock adjustments, payments, refunds and returns make retries and double taps safe.
- **Append-only history.** Stock movements, payments, refunds, status history and the audit log cannot be deleted. A payment can only move from succeeded to reversed, and needs a reason.
- **Audit log.** Triggers write before/after snapshots for prices, costs, stock levels, orders, payments, refunds, memberships and integrations. It is readable by managers and above, because it contains cost prices.
- **Honest payment status.** Any payment typed in by staff is `manual_unverified`. Only the service-role webhook can create `provider_verified` payments. That needs a valid signature, replay protection, a `connected_verified` integration for that organisation, a live order and an amount within the outstanding balance.
- **No privileged keys in the browser.** The browser only ever sees the anon key.

## Run it

Requirements: Node 24+, npm. Docker is needed for the Supabase mode.

### Demo workspace (no backend)

```sh
npm install
npm run dev            # open http://localhost:5173/app
```

With no Supabase variables set, the app runs the **demo workspace**: two fictional businesses (Kenya/KES with tax added on top, and Germany/EUR with tax included in prices). Data lives only in that browser's localStorage. A banner says so on every screen. Any email and password signs in. Settings → Demo resets the data.

### Supabase mode (real database, auth and RLS)

```sh
npx supabase start     # local stack on ports 58320-58329 (see supabase/config.toml)
npx supabase status    # copy API URL and anon key
cp .env.example .env.local   # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

Sign up, create your business (any country, currency, time zone and locale), add products, receive stock, then take orders.

## Checks

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | ESLint (see the note on pre-existing errors below) |
| `npm test` | Unit tests: domain, demo gateway, integrations, webhook signatures, analytics |
| `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:58322/postgres npm run test:db` | Database integration tests against the local Supabase. They are skipped when the variable is unset. |
| `npm run build` | Production build |

The DB tests run every operation as the `authenticated` role with real JWT claims, so RLS and permission checks apply exactly as they do for browser requests. They cover:

- tenant isolation across 13 tables, both direct and through RPCs
- anonymous access being denied
- the role matrix, checked for parity between SQL and TypeScript
- server-side totals, with exclusive and inclusive tax
- idempotency
- the status machine
- stock reserve, release, commit, oversell and adjustments
- refunds limits and automatic `refunded` status
- returns
- payment reversal
- the audit trail
- verified-payment guards

## Global support

- Any ISO 4217 currency, using its correct minor unit: JPY 0, KWD 3. Locale-aware formatting comes from `Intl`.
- Each organisation stores an IANA time zone and locale. Timestamps are stored in UTC, and reports bucket by the business date in that zone. This is tested for Nairobi, Berlin (including daylight-saving changes), Tokyo, London and New York.
- Phone numbers are stored in E.164 form, normalised with `libphonenumber-js` using the business country as the default region.
- Addresses are free-form lines plus optional region and postal code. Nothing is Kenya-specific.
- Tax rates are configurable metadata (basis points per product, with exclusive or inclusive mode per business). They are not jurisdiction rules and must be reviewed by a qualified professional.

## Integration status

Every integration carries exactly one of four labels: **connected and verified**, **configured but unverified**, **adapter only**, or **not implemented**.

| Integration | Label | Notes |
| --- | --- | --- |
| WhatsApp Business Platform (Cloud API) | Adapter only | Signature-verified webhook, opt-out handling, send adapter behind `WHATSAPP_SEND_ENABLED`. Needs a Meta app, number, token, approved templates and an end-to-end test. |
| WhatsApp click-to-chat links | Works, no API | Opens the merchant's own WhatsApp with a prepared message. Nothing is sent automatically. |
| Email (Resend) | Adapter only | Not configured |
| SMS (Twilio) | Adapter only | Not configured |
| Stripe | Adapter only | Webhook signature verification and replay window. Akunga never creates charges. |
| Paystack | Adapter only | Webhook signature verification |
| M-Pesa Daraja, Flutterwave | Not implemented | |
| Courier / delivery APIs | Not implemented | Manual assignee, tracking reference and proof of delivery are built in |
| Xero, QuickBooks Online | Not implemented | |
| CSV export (orders, payments, refunds) | Works locally | Exact decimal amounts with a currency column, protected against formula injection |

Setup and deploy instructions for the functions are in [`supabase/functions/README.md`](supabase/functions/README.md). Nothing has been deployed.

## What still blocks production

1. **A hosted Supabase project.** It has not been created, migrated or deployed. Hosting is not deployed either.
2. **Per-organisation payment provider credentials.** Today a single platform secret plus the connection, balance and order guards limit misuse. Stripe Connect or Paystack subaccounts are needed before merchants connect their own accounts.
3. **Integration verification.** Each integration needs real provider accounts, configured secrets and end-to-end tests. Message templates must be approved, and outbound messages need logging and rate limits.
4. **Team invitations by email.** Today a person needs an existing account before an admin can add them.
5. **Product image upload UI.** The private storage bucket and its policies exist, but there is no upload UI yet.
6. **Public storefront and catalogue.** The storefront template is still mock data and is not wired to the catalogue or order intake. It needs rate limiting on public order endpoints.
7. **Ops.** Backups and restore drills, monitoring, auth rate limits on the hosted project, and production email (SMTP) for auth.
8. **Legal and tax review** for each launch country, data-protection compliance and terms.
9. **Pre-existing lint errors** (10) in the original storefront template files. They were not introduced by this work.

## Data rules worth knowing

- Base currency is fixed once products or orders exist.
- Stock is reserved for orders that are awaiting confirmation, confirmed, preparing or ready. It is committed when an order is dispatched, or delivered for pickups. It is released on cancel. Stock can never go negative or drop below what is reserved.
- A refund records money that was returned. It does not move money. Use "Return items to stock" to restock goods.
- After a refund on a live order, "balance due" goes up by the refunded amount (total minus net paid). Merchants should cancel or adjust the order if the goods won't be supplied.
