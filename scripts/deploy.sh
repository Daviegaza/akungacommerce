#!/usr/bin/env bash
# Deploy the backend to a hosted Supabase project (staging first, then production).
# Dry run by default: prints every command and changes nothing. Add --apply to run them.
#
#   SUPABASE_PROJECT_REF=abcd1234 scripts/deploy.sh                 # dry run
#   SUPABASE_PROJECT_REF=abcd1234 SECRETS_FILE=.env.staging scripts/deploy.sh --apply
#
# Needs: the Supabase CLI logged in (`supabase login`), and for --apply on a production project
# CONFIRM_PRODUCTION=<project ref> as a second guard.
#
# What it does, in order:
#   1. link the project
#   2. show pending migrations (db push --dry-run), then apply them
#   3. set Edge Function secrets from SECRETS_FILE (KEY=value lines; never committed)
#   4. deploy every Edge Function with the right JWT setting
#   5. store the two Vault secrets the scheduled jobs need (rafu_functions_url, rafu_service_role_key)
#      when SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL are in the environment
#   6. call /health and print the result
#
# It never prints secret values.
set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
REF="${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF}"
ENVIRONMENT="${DEPLOY_ENV:-staging}"
SUPA="${SUPABASE_CLI:-npx supabase}"

if [ "$ENVIRONMENT" = production ] && [ "$APPLY" = 1 ] && [ "${CONFIRM_PRODUCTION:-}" != "$REF" ]; then
  echo "Production deploy needs CONFIRM_PRODUCTION=$REF" >&2
  exit 2
fi

run() {
  echo "+ $*"
  if [ "$APPLY" = 1 ]; then "$@"; fi
}

echo "== Deploying to $ENVIRONMENT ($REF) $([ "$APPLY" = 1 ] && echo '' || echo '[DRY RUN: nothing will change; add --apply]')"

# 1-2. Database
run $SUPA link --project-ref "$REF"
echo "+ $SUPA db push --dry-run"
if [ "$APPLY" = 1 ]; then $SUPA db push --dry-run; fi
run $SUPA db push

# 3. Secrets
if [ -n "${SECRETS_FILE:-}" ]; then
  [ -f "$SECRETS_FILE" ] || { echo "SECRETS_FILE not found: $SECRETS_FILE" >&2; exit 2; }
  echo "Secrets in $SECRETS_FILE: $(grep -cE '^[A-Z_][A-Z0-9_]*=' "$SECRETS_FILE") (names: $(grep -oE '^[A-Z_][A-Z0-9_]*' "$SECRETS_FILE" | tr '\n' ' '))"
  run $SUPA secrets set --env-file "$SECRETS_FILE" --project-ref "$REF"
else
  echo "(no SECRETS_FILE: secrets left as they are)"
fi

# 4. Functions. Providers and monitors cannot send a Supabase JWT, so those skip the gateway check
#    and authenticate themselves (signatures, shared secrets, service-role bearer).
NO_JWT="health whatsapp-webhook payment-webhook mpesa-callback mpesa-c2b media-cleanup"
WITH_JWT="send-message mpesa-stk mpesa-stk-query verify-custom-domain"
for f in $NO_JWT; do run $SUPA functions deploy "$f" --no-verify-jwt --project-ref "$REF"; done
for f in $WITH_JWT; do run $SUPA functions deploy "$f" --project-ref "$REF"; done

# 5. Vault secrets for pg_cron -> Edge Function calls (jobs are no-ops until these exist).
FUNCTIONS_URL="https://${REF}.supabase.co/functions/v1"
if [ -n "${SUPABASE_DB_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "+ psql \$SUPABASE_DB_URL: upsert vault secrets rafu_functions_url, rafu_service_role_key"
  if [ "$APPLY" = 1 ]; then
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q \
      -v url="$FUNCTIONS_URL" -v key="$SUPABASE_SERVICE_ROLE_KEY" <<'SQL'
select vault.update_secret(id, :'url') from vault.secrets where name = 'rafu_functions_url';
select vault.create_secret(:'url', 'rafu_functions_url') where not exists (select 1 from vault.secrets where name = 'rafu_functions_url');
select vault.update_secret(id, :'key') from vault.secrets where name = 'rafu_service_role_key';
select vault.create_secret(:'key', 'rafu_service_role_key') where not exists (select 1 from vault.secrets where name = 'rafu_service_role_key');
SQL
  fi
else
  echo "(SUPABASE_DB_URL / SUPABASE_SERVICE_ROLE_KEY not set: HTTP jobs stay idle; see docs/OPERATIONS.md §5)"
fi

# 6. Health
echo "+ curl $FUNCTIONS_URL/health"
if [ "$APPLY" = 1 ]; then curl -fsS "$FUNCTIONS_URL/health" && echo; fi
echo "== Done. Next: set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY on the web host and redeploy the frontend."
