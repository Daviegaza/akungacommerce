# Operations and production readiness

This is the runbook for taking Fungua from staging to a production deployment. A dedicated hosted staging
project now exists, all 26 repository migrations are applied, all 10 Edge Functions are deployed, and a
feature-branch Vercel preview is ready. **No production Supabase project, production domain, provider
credentials, external monitoring or production release exists yet.** Each section distinguishes staging
verification from production readiness.

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
| `VITE_PLATFORM_HOSTS` | no | Hosts that serve Fungua itself; any other host is treated as a merchant custom domain. |
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
| `DARAJA_CALLBACK_URL`, `MPESA_CALLBACK_SECRET` | mpesa-stk, mpesa-callback, mpesa-c2b | Fungua's own callback endpoint and its URL secret (needed for any M-Pesa) |
| `DARAJA_ENV`, `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, `DARAJA_TRANSACTION_TYPE`, `DARAJA_PARTY_B` | mpesa-stk, mpesa-stk-query | **Platform-wide** account. Ignored unless `DARAJA_ALLOW_PLATFORM_SHORTCODE=true`. Normally each shop saves its own keys in the app instead (section 6). |
| `DARAJA_ALLOW_PLATFORM_SHORTCODE` | mpesa-stk, mpesa-stk-query | `true` lets shops without their own keys be paid into the platform account. Leave unset unless that payout model is chosen. |
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

1. **Staging already exists:** `fungua-staging` (ref `vlliyapedfzuzgxkgmmt`, `eu-west-1`, ACTIVE_HEALTHY).
   It is separate from AR Desk. No production project exists. Choose a production region based on buyer
   latency and data-residency needs when production is approved; enable PITR on a paid plan.
2. Auth: turn on email confirmation, set a production SMTP sender, set the Site URL and redirect URLs to the
   app origin, and review the auth rate limits.
3. Apply migrations in filename order from an empty database:

   ```sh
   npx supabase link --project-ref <ref>
   npx supabase db push            # applies supabase/migrations/* in order
   ```

   Every migration has been applied from an empty database locally with `npx supabase db reset`, and CI
   repeats that on every push. The hosted staging project currently has all 26 repository migrations applied
   through the Supabase management migration tool. **Before using `supabase db push` or
   `scripts/deploy.sh --apply` against this staging project, reconcile the CLI migration history:**

   ```sh
   npx supabase link --project-ref vlliyapedfzuzgxkgmmt
   npx supabase migration list
   # For each repository migration whose SQL is already present in staging but whose filename timestamp
   # is missing from the REMOTE column, mark that exact timestamp as applied (history only; no SQL runs):
   npx supabase migration repair --status applied <migration-timestamp>
   npx supabase migration list  # confirm LOCAL and REMOTE are aligned before db push
   ```

   The management tool records its own application timestamp in the remote history, while preserving the
   repository migration name. Consequently, `migration list` can show both REMOTE-only tool-generated
   timestamps and LOCAL-only filename timestamps. Reconcile both sides without re-running SQL:

   - For each REMOTE-only timestamp (the management-tool application record), run
     `npx supabase migration repair --status reverted <remote-only-version>`.
   - For each LOCAL-only filename timestamp whose migration SQL is already present in staging, run
     `npx supabase migration repair --status applied <local-file-timestamp>`.

   Repeat until `npx supabase migration list` shows LOCAL and REMOTE aligned. `migration repair` changes
   history only; it does not apply or revert SQL. Verify each migration name/schema before repairing. Do not
   re-run the SQL or use `db reset` on hosted staging to fix this. Once history is aligned, use normal
   forward-only `db push` for new migrations. There are no down migrations (see Rollback).
4. Create the platform admin row (Fungua reviewers) with the SQL editor, as the service role. No UI does this.
5. Storage: the `product-images` (public, 5 MB, raster images only) and `verification-docs` (private) buckets
   and their policies are created by migrations. Check them in the dashboard after `db push`.

## 4. Edge Function deployment

`scripts/deploy.sh` does the whole backend deploy: link, `db push` (dry run first), secrets from a file,
every function with the right JWT setting, the two Vault secrets the scheduler needs, then `/health`.
It is a **dry run unless you pass `--apply`**, and a production project also needs `CONFIRM_PRODUCTION=<ref>`:

```bash
SUPABASE_PROJECT_REF=<staging-ref> SECRETS_FILE=.env.staging scripts/deploy.sh            # prints the plan
SUPABASE_PROJECT_REF=<staging-ref> SECRETS_FILE=.env.staging \
  SUPABASE_DB_URL=<staging db url> SUPABASE_SERVICE_ROLE_KEY=<staging service key> scripts/deploy.sh --apply
```

All 10 functions are now deployed to Fungua staging and report ACTIVE, with the intended JWT settings.
They are adapter endpoints only: no M-Pesa, Stripe, Paystack, WhatsApp, Resend or Twilio provider credentials
have been configured or verified. The script's `--apply` path has not been run against staging; first
reconcile migration history as described in section 3. The two Vault scheduler secrets are absent, so HTTP
cron jobs intentionally remain idle. See `supabase/functions/README.md` for provider setup and callback URLs.

## 5. Scheduled jobs (built in, migration 20261122000100)

The migration enables `pg_cron` and `pg_net` and schedules every job. The list lives in one place,
`public.rafu_job_definitions()`; `select * from public.rafu_job_status()` (service role / SQL editor) shows each
job's schedule and its last run.

| Job | What it does | Schedule (UTC) |
| --- | --- | --- |
| `rafu-release-stale-orders` | `cancel_stale_storefront_orders()`: cancels unpaid, unconfirmed storefront orders past the limit and releases their stock; skips orders with a pending M-Pesa prompt | every 10 min |
| `rafu-prune-rate-limits` | `prune_rate_limits()`: deletes rate-limit windows older than 2 days | daily 03:17 |
| `rafu-expire-tracking-links` | `expire_tracking_links()`: clears buyer tracking tokens N days after the order closed (per shop, default 90) | daily 03:23 |
| `rafu-prune-webhook-payloads` | `prune_webhook_payloads()`: redacts processed or parked webhook payloads older than 30 days (event ids kept for idempotency) | daily 03:29 |
| `rafu-whatsapp-retry` | `POST /whatsapp-webhook?retry=1` | every 5 min |
| `rafu-mpesa-stk-query` | `POST /mpesa-stk-query` (each shop queried with its own keys) | every 3 min |
| `rafu-media-cleanup` | `POST /media-cleanup` | daily 02:41 |
| `rafu-domain-recheck` | `POST /verify-custom-domain` `{"scheduled": true}` | every 6 h |

**The four SQL jobs run as soon as the migration is applied.** The four HTTP jobs call Edge Functions through
`pg_net` with the service-role key and **do nothing until two Vault secrets exist**:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'rafu_functions_url');
select vault.create_secret('<service role key>', 'rafu_service_role_key');
```

**Naming note:** `rafu_functions_url` and `rafu_service_role_key` are legacy internal Vault identifiers retained for migration/job compatibility. They are not customer-facing brand names. Do not rename them without a forward migration that updates the scheduled functions and deployment tooling together.

`scripts/deploy.sh --apply` creates or updates both. Verified locally (2026-11-20): with both secrets set, the
`whatsapp-webhook` retry and `mpesa-stk-query` jobs reached the locally served functions and got HTTP 200;
without them `_invoke_edge_job` returns null and sends nothing. To pause a job:
`select cron.alter_job((select jobid from cron.job where jobname = 'rafu-mpesa-stk-query'), active := false);`

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
   (service role). The one tenant path is M-Pesa below, and it needs evidence.

**M-Pesa payout model (built, migration 20261122000100).** Each shop saves its **own** Daraja keys in
Payments → How you get paid (owner/admin only). The consumer key, consumer secret and passkey go into
Supabase Vault (encrypted at rest); staff only ever see the shortcode, environment and the last 4 characters
of the key, and only the service role can decrypt (`mpesa_credentials_for`). STK prompts and status queries
use the shop's keys, so **money goes straight to the shop's own Till or Paybill**. Saving keys marks the
connection `configured_unverified`; the owner can switch on prompts (`mark_mpesa_verified`) only after a real
M-Pesa payment for that shop has reached Fungua. The platform-wide `DARAJA_*` env account is used only when
`DARAJA_ALLOW_PLATFORM_SHORTCODE=true`. Still needed per shop: Daraja app approval for production and
C2B URL registration for the shop's shortcode (not automated here).

Provider-specific notes (Daraja STK and C2B, Paystack dedicated accounts, Stripe, WhatsApp, Resend, Twilio,
custom domains) are in `supabase/functions/README.md`.

## 7. Backup and restore

- **Backups:** Supabase takes daily backups on paid plans. Enable PITR for minute-level recovery of order
  and payment data. Storage objects (product photos, verification documents) are **not** part of database
  backups. Copy the buckets separately (for example a scheduled `supabase storage` sync to a private location).
- **Restore drill:** `scripts/backup-restore-drill.sh` dumps a database, restores it into a fresh scratch database
  and compares row counts for every public table, migrations, RLS tables, functions and policies, and prints how
  long dump and restore took. Default target is the local stack; for a hosted project set `SOURCE_DB_URL` and a
  **non-production** `RESTORE_ADMIN_URL`. Run it before launch, then quarterly.
  Last local run (2026-11-20): 40 tables, counts identical, 23 migrations, dump 1 s, restore 3 s, **PASS**.
- **What a logical dump does not bring back** (the drill prints these as restore notes):
  `pg_cron` jobs (re-run the job loop from migration 20261122000100) and **Vault secrets**: each
  shop's saved M-Pesa keys and the two `rafu_*` scheduler secrets. After a logical restore, shops must re-enter
  their M-Pesa keys. Supabase's own backups/PITR restore the whole database including Vault; prefer them for
  disaster recovery.
- Treat dumps as personal data: encrypt them and limit access.

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
- **Uptime check** on the app origin, on `/s/<a real shop>`, and on `GET /functions/v1/health`
  (200 `{ok, db}`; 503 when the database does not answer). With the service-role key as Bearer it also returns
  which integrations have their secrets set (booleans and missing secret names, never values) and the scheduled
  job status. Verified against the local stack (2026-11-20).
- **Jobs:** `select * from public.rafu_job_status()` where `last_status` is `failed`.

No external monitor or alerting is configured today; the endpoints above are ready for one.

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
- **Tokens:** order tracking tokens are 144-bit random values, stored in plain text and readable by staff.
  They are cleared a shop-chosen number of days (7–3650, default 90) after the order closes, after which every
  token-based public function treats the link as unknown. Rider links are 192-bit, stored as SHA-256 hashes, expire (1–72 h) and are revoked when
  the order is delivered, cancelled or refunded. Staff invitations are 256-bit, hashed, single use, expire
  in 7 days, and email invitations need a confirmed email address.
- **Payments:** only signed and verified callbacks create `provider_verified` payments. Manual payments are
  always `manual_unverified` and cannot exceed the balance due. Refunds are records; Fungua never moves money.
- **M-Pesa callbacks** are not signed by Safaricom. They are protected by a long URL secret, optional IP
  allowlisting, replay protection and exact-amount matching. Keep the secret out of logs and rotate it if exposed.
- **Personal data:** buyer name, phone, address and delivery pin are stored per business. All staff roles,
  including analysts, can read customer contact details today (see the open item in the README). Webhook
  payloads (which include phone numbers) are redacted 30 days after processing.
- **Consent:** marketing needs an explicit opt-in. STOP replies withdraw it reliably. An anonymous checkout
  cannot undo an explicit opt-out.
- **Legal:** draft privacy notice and terms are at `/legal/privacy` and `/legal/terms` (marked draft, with
  placeholders for the contact email, governing law and liability wording). A lawyer must review them, and a
  data-protection review for each launch country (Kenya: the Data Protection Act 2019 and ODPC registration)
  is still required.

## 11. Production deployment checklist

- [x] Dedicated hosted staging Supabase project created (`fungua-staging`, `eu-west-1`); no production project/PITR yet
- [x] All 26 repository migrations applied to staging; reconcile CLI migration history before any `db push`
- [ ] `npm run test:db` passes against a hosted staging copy
- [ ] Auth: email confirmation on, production SMTP, redirect URLs, rate limits reviewed
- [ ] Platform admin row created
- [x] Vercel preview deployed with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` scoped to the feature branch only
- [ ] Production frontend domain and environment configured (never the service key)
- [ ] `ALLOWED_ORIGIN` set on browser-called functions
- [x] All 10 Edge Functions deployed to staging with their intended JWT settings
- [ ] Hosted endpoint smoke tests completed; each function refuses unauthenticated/unconfigured calls as intended
- [ ] Vault secrets `rafu_functions_url` and `rafu_service_role_key` set so the HTTP jobs in section 5 run
- [ ] `GET /health` returns 200 and an external uptime monitor watches it
- [ ] Monitoring and alerts from section 8 in place
- [ ] `scripts/backup-restore-drill.sh` run against a staging copy and timed
- [ ] Each integration verified end to end before its label changes (section 6)
- [ ] `/legal/privacy` and `/legal/terms` reviewed by a lawyer, placeholders filled; data-protection registration; tax invoices reviewed by an adviser
- [ ] Each Kenyan shop: own Daraja keys saved, test payment received, prompts switched on (or the platform-account model chosen deliberately)
- [ ] Decision on whether analysts may see customer contact details
- [ ] Brand name and design approved by the owner
