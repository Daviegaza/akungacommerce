# Operations and production readiness

This is the runbook for taking Rafu from a local build to a production deployment. **Nothing described
here has been done for a production project yet.** There is no hosted Supabase project, no deployed Edge
Function, no production domain and no connected provider. Each section says what exists and what still
has to be done.

## 1. Local setup

Requirements: Node 24+, npm, and Docker (only for Supabase mode and the database tests).

```sh
npm ci
npm run dev                  # demo mode: http://localhost:5173 (fictional data in this browser)
```

If the Vite dev server shows a blank page (its hot-reload websocket can be blocked in some sandboxes),
use a production build instead: `npm run build && npm run preview -- --port 4173`.

Supabase mode (real database, auth and RLS):

```sh
npx supabase start           # local stack on ports 58320-58329 (supabase/config.toml)
npx supabase status          # API URL and anon key
cp .env.example .env.local   # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

## 2. Environment variable reference

### Browser (Vite, public: shipped to every visitor)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | for Supabase mode | Project URL. Empty = demo mode. |
| `VITE_SUPABASE_ANON_KEY` | for Supabase mode | Anon/publishable key. Never put the service-role key here. |
| `VITE_DATA_MODE` | no | `demo` forces demo mode even when Supabase is configured. |
| `VITE_PLATFORM_HOSTS` | no | Hosts that serve Rafu itself; any other host is treated as a merchant custom domain. |
| `VITE_CUSTOM_DOMAIN_CNAME_TARGET`, `VITE_CUSTOM_DOMAIN_A_RECORD` | no | DNS targets shown to merchants. Leave empty until custom-domain hosting exists. |

### Edge Function secrets (server only: `supabase secrets set NAME=value`)

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase.

| Secret | Function | Purpose |
| --- | --- | --- |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | whatsapp-webhook | Meta handshake and signature check |
| `WEBHOOK_RETRY_SECRET` | whatsapp-webhook | Optional; authorises the scheduled retry (`?retry=1`) |
| `WHATSAPP_SEND_ENABLED`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | send-message | WhatsApp sending (off unless `WHATSAPP_SEND_ENABLED=true`) |
| `RESEND_API_KEY`, `RESEND_FROM` | send-message | Email |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | send-message | SMS |
| `ALLOWED_ORIGIN` | send-message, mpesa-stk | CORS origin of the app (defaults to `*`; set it in production) |
| `STRIPE_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY` | payment-webhook | Signature checks |
| `DARAJA_*`, `MPESA_CALLBACK_SECRET` | mpesa-stk, mpesa-callback, mpesa-c2b, mpesa-stk-query | See `supabase/functions/README.md` |
| `MPESA_ALLOWED_IPS`, `MPESA_CLIENT_IP_HEADER` | mpesa-callback, mpesa-c2b | Optional source-IP allowlist |
| `MEDIA_CLEANUP_SECRET` | media-cleanup | Scheduler authorisation |
| `DOMAIN_CHECK_CRON_SECRET` | verify-custom-domain | Scheduler authorisation |

The exact names each function reads are listed at the top of its `index.ts` and in
`supabase/functions/README.md`. Never commit a value. `.env.example` holds placeholders only.

### Tests only

| Variable | Used by |
| --- | --- |
| `SUPABASE_DB_URL` | `npm run test:db` (Postgres URL, local: `postgresql://postgres:postgres@127.0.0.1:58322/postgres`) |
| `SUPABASE_API_URL`, `SUPABASE_ANON_KEY` | the gateway end-to-end test in `test:db`, and `npm run test:e2e` |
| `PW_CHANNEL` | optional; `chrome` makes Playwright use the installed Chrome locally |

## 3. Supabase project and migrations

1. Create a project in the region closest to buyers. Enable Point-in-Time Recovery (paid plans).
2. Auth: turn on email confirmation, set a production SMTP sender, set the Site URL and redirect URLs to the
   app origin, and review the auth rate limits.
3. Apply migrations in filename order from an empty database:

   ```sh
   npx supabase link --project-ref <ref>
   npx supabase db push            # applies supabase/migrations/* in order
   ```

   Every migration has been applied from an empty database locally with `npx supabase db reset`, and CI
   repeats that on every push. Migrations are forward-only. There are no down migrations (see Rollback).
4. Create the platform admin row (Rafu reviewers) with the SQL editor, as the service role. No UI does this.
5. Storage: the `product-images` (public, 5 MB, raster images only) and `verification-docs` (private) buckets
   and their policies are created by migrations. Check them in the dashboard after `db push`.

## 4. Edge Function deployment

See `supabase/functions/README.md` for the exact deploy commands, the `--no-verify-jwt` flags
(providers cannot send a Supabase JWT) and the webhook URLs to register with each provider.
After deploying, call each function without credentials and confirm it refuses (401/403/503).

## 5. Scheduled jobs (none is enabled)

These are service-role database functions or Edge Functions meant to run on a schedule. Choose a scheduler
(Supabase Cron / `pg_cron`, or an external cron that calls the function URL) and enable each one only
after the related integration is verified.

| Job | What it does | Suggested cadence |
| --- | --- | --- |
| `select public.cancel_stale_storefront_orders(interval '24 hours')` | Cancels unpaid, unconfirmed storefront orders older than the limit, releasing their stock. Skips orders with a pending M-Pesa prompt. | hourly |
| `select public.prune_rate_limits(interval '2 days')` | Deletes old rate-limit windows | daily |
| `POST /whatsapp-webhook?retry=1` | Retries WhatsApp events that failed processing | every 15 min |
| `POST /mpesa-stk-query` | Fallback for lost STK callbacks | every 2 min, only once Daraja is verified |
| `POST /media-cleanup` | Deletes orphaned product photos older than 24 h | daily |
| `POST /verify-custom-domain` (scheduled mode) | Re-checks pending custom-domain DNS | hourly |

Example with `pg_cron` (illustrative, **not** applied by any migration):

```sql
select cron.schedule('rafu-stale-orders', '0 * * * *', $$select public.cancel_stale_storefront_orders(interval '24 hours')$$);
select cron.schedule('rafu-prune-rate-limits', '30 3 * * *', $$select public.prune_rate_limits(interval '2 days')$$);
```

## 6. Integration setup

Every integration is labelled in the app (Settings → Integrations) and in `src/integrations/registry.ts`
with one of: connected and verified, configured but unverified, adapter only, not implemented. Today none
is connected. To move one to "connected and verified":

1. Create the provider account in the merchant's or platform's name (a business decision, see section 10).
2. Set the secrets, deploy the function, register the webhook URL.
3. Send a provider test event and confirm it is stored in `webhook_events` with `processed_at` set.
4. Payments: one real sandbox payment is recorded exactly once against the right order, and a replay is ignored.
5. WhatsApp: an approved template reaches a real handset, and replying STOP withdraws consent.
6. Only then set the `integration_connections` state for that organisation to `connected_verified`
   (service role). No tenant path can set it.

Provider-specific notes (Daraja STK and C2B, Paystack dedicated accounts, Stripe, WhatsApp, Resend, Twilio,
custom domains) are in `supabase/functions/README.md`.

## 7. Backup and restore

- **Backups:** Supabase takes daily backups on paid plans. Enable PITR for minute-level recovery of order
  and payment data. Storage objects (product photos, verification documents) are **not** part of database
  backups. Copy the buckets separately (for example a scheduled `supabase storage` sync to a private location).
- **Logical export:** `npx supabase db dump --data-only -f backup.sql` (and `--role-only`, schema dump) for
  an off-platform copy. Treat dumps as personal data: encrypt them and limit access.
- **Restore drill (do this before launch, then quarterly):** restore the latest backup into a separate
  project, run `npm run test:db` against it with `SUPABASE_DB_URL` pointing there, and spot-check one
  organisation's orders, payments and stock movements against the live project. Record the time it took.

## 8. Monitoring

Minimum before launch:

- **Edge Function logs and alerts:** 5xx rate per function; any `whatsapp-webhook` or `mpesa-*` 500
  (providers retry, but repeated failures mean lost events).
- **Stuck events:** `select provider, count(*) from webhook_events where processed_at is null and received_at < now() - interval '1 hour' group by 1;` should be zero. Parked events: `where dead_at is not null`.
- **Payment review queue:** unmatched or mismatched M-Pesa and bank receipts older than 24 h.
- **Stock holds:** count of `pending_confirmation` storefront orders older than 24 h (should be zero once the
  stale-order job runs).
- **Outbound messages:** `outbound_messages` with `status = 'failed'`, and rate-limit refusals.
- **Auth:** sign-up and sign-in error spikes. Database CPU and connections, and storage size.
- **Uptime check** on the app origin and on `/s/<a real shop>`.

No monitoring is configured today.

## 9. Rollback

- **Frontend:** Vercel keeps every deployment. Promote the previous production deployment (instant).
- **Edge Functions:** redeploy the previous git revision of the function (`git checkout <rev> -- supabase/functions/<name>` then `supabase functions deploy <name>`).
- **Database:** migrations are forward-only and additive by policy (new columns, new functions,
  `create or replace`). To undo a function change, write a new migration that restores the previous
  definition (copy it from the earlier migration file). Restoring a backup is the last resort, because it
  discards orders taken since the backup. Never edit an applied migration.
- Ship database changes **before** the frontend that needs them, so a frontend rollback never meets a
  missing function.

## 10. Privacy and security considerations

- **Tenancy:** every table has row-level security. Money and stock writes go only through `SECURITY DEFINER`
  functions that check membership and role. Covered by `tests/db/*` (tenant isolation, role matrix, two-org
  end-to-end flow).
- **Anonymous access:** an explicit list of storefront, rider and invite-preview functions is granted to
  `anon`. Order creation is rate-limited per IP (the last `x-forwarded-for` hop), per phone and per shop,
  with at most 3 open unpaid orders per phone per shop. Prices, tax and delivery fees are always computed
  on the server. A buyer-supplied expected total is only compared, never used.
- **Tokens:** order tracking tokens are 144-bit random values, stored in plain text and readable by staff;
  they do not expire. Rider links are 192-bit, stored as SHA-256 hashes, expire (1–72 h) and are revoked when
  the order is delivered, cancelled or refunded. Staff invitations are 256-bit, hashed, single use, expire
  in 7 days, and email invitations need a confirmed email address.
- **Payments:** only signed and verified callbacks create `provider_verified` payments. Manual payments are
  always `manual_unverified` and cannot exceed the balance due. Refunds are records; Rafu never moves money.
- **M-Pesa callbacks** are not signed by Safaricom. They are protected by a long URL secret, optional IP
  allowlisting, replay protection and exact-amount matching. Keep the secret out of logs and rotate it if exposed.
- **Personal data:** buyer name, phone, address and delivery pin are stored per business. All staff roles,
  including analysts, can read customer contact details today (see the open item in the README). Webhook
  payloads (which include phone numbers) are kept with no retention limit; set one before launch.
- **Consent:** marketing needs an explicit opt-in. STOP replies withdraw it reliably. An anonymous checkout
  cannot undo an explicit opt-out.
- **Legal:** a privacy notice, terms, and a data-protection review for each launch country (Kenya: the Data
  Protection Act 2019 and ODPC registration) are required and not written.

## 11. Production deployment checklist

- [ ] Hosted Supabase project created, PITR on, region chosen
- [ ] `supabase db push` from an empty database; `npm run test:db` passes against a staging copy
- [ ] Auth: email confirmation on, production SMTP, redirect URLs, rate limits reviewed
- [ ] Platform admin row created
- [ ] Frontend deployed with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (never the service key)
- [ ] `ALLOWED_ORIGIN` set on browser-called functions
- [ ] Edge Functions deployed; each refuses unauthenticated calls
- [ ] Scheduled jobs from section 5 enabled for the parts that are live (at least stale orders and rate-limit pruning)
- [ ] Monitoring and alerts from section 8 in place
- [ ] Backup restore drill done and timed
- [ ] Each integration verified end to end before its label changes (section 6)
- [ ] Privacy notice, terms, data-protection registration; tax invoices reviewed by an adviser
- [ ] Decision on whether analysts may see customer contact details
- [ ] Brand name and design approved by the owner
