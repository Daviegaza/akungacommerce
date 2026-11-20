#!/usr/bin/env bash
# Backup-restore drill: dump a database, restore it into a fresh scratch database,
# and prove the copy matches (row counts per table, migrations, RLS, functions).
# Prints how long the dump and the restore took, so the restore time objective can be measured.
#
# Usage:
#   scripts/backup-restore-drill.sh                      # local Supabase (docker container)
#   SOURCE_DB_URL=postgresql://... RESTORE_ADMIN_URL=postgresql://... scripts/backup-restore-drill.sh
#
#   SOURCE_DB_URL      database to back up (read-only use). Default: the local stack.
#   RESTORE_ADMIN_URL  a server where the script may CREATE and DROP a scratch database named
#                      rafu_restore_drill_<timestamp>. Never point this at production.
#   KEEP_DUMP=1        keep the dump file (default: deleted at the end).
#
# Local mode needs only Docker (it runs pg_dump/psql inside the Supabase DB container).
# Remote mode needs pg_dump/psql 17 on PATH.
set -euo pipefail

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_akungacommerce}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
SCRATCH="rafu_restore_drill_${STAMP}"
WORK="$(mktemp -d)"
DUMP="${WORK}/rafu-${STAMP}.dump"
trap 'if [ "${KEEP_DUMP:-0}" != "1" ]; then rm -rf "$WORK"; else echo "Dump kept at $DUMP"; fi' EXIT

if [ -n "${SOURCE_DB_URL:-}" ]; then
  [ -n "${RESTORE_ADMIN_URL:-}" ] || { echo "Set RESTORE_ADMIN_URL (a non-production server) too." >&2; exit 2; }
  case "$RESTORE_ADMIN_URL" in *prod*) echo "RESTORE_ADMIN_URL looks like production; refusing." >&2; exit 2 ;; esac
  MODE=remote
  run_sql() { psql "$1" -v ON_ERROR_STOP=1 -tAX -c "$2"; }
  scratch_url() { echo "${RESTORE_ADMIN_URL%/*}/${SCRATCH}"; }
  dump_size() { du -h "$DUMP" | cut -f1; }
  do_dump() { pg_dump "$SOURCE_DB_URL" --format=custom --no-owner --no-privileges --file "$DUMP"; }
  do_restore() { pg_restore --dbname "$(scratch_url)" --no-owner --no-privileges --exit-on-error "$DUMP"; }
  SRC="$SOURCE_DB_URL"
  ADMIN="$RESTORE_ADMIN_URL"
else
  MODE=local
  docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "Local Supabase is not running ($CONTAINER)." >&2; exit 2; }
  run_sql() { docker exec -i "$CONTAINER" psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -tAX -c "$2"; }
  scratch_url() { echo "$SCRATCH"; }
  # The dump stays inside the container (/tmp/drill.dump) and is removed at the end.
  dump_size() { MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" du -h /tmp/drill.dump | cut -f1; }
  do_dump() { MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" pg_dump -U postgres -d postgres --format=custom --no-owner --no-privileges -f "/tmp/drill.dump"; }
  do_restore() { MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" pg_restore -U postgres -d "$SCRATCH" --no-owner --no-privileges "/tmp/drill.dump"; }
  SRC=postgres
  ADMIN=postgres
fi

# Per-table row counts in the public schema (the business data).
COUNTS_SQL="select string_agg(t.relname || '=' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.relname), false, true, '')))[1]::text, ',' order by t.relname)
  from pg_class t join pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public' and t.relkind = 'r'"
CHECKS_SQL="select json_build_object(
  'migrations', (select count(*) from supabase_migrations.schema_migrations),
  'rls_tables', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity),
  'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  'policies', (select count(*) from pg_policies where schemaname = 'public'))::text"

echo "== Backup-restore drill ($MODE) $STAMP"
SRC_COUNTS="$(run_sql "$SRC" "$COUNTS_SQL")"
SRC_CHECKS="$(run_sql "$SRC" "$CHECKS_SQL")"

t0=$(date +%s)
do_dump
t1=$(date +%s)
echo "Dump:    $((t1 - t0)) s, $(dump_size)"

run_sql "$ADMIN" "create database ${SCRATCH}" >/dev/null
cleanup_db() {
  run_sql "$ADMIN" "drop database if exists ${SCRATCH} with (force)" >/dev/null || true
  if [ "$MODE" = local ]; then MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" rm -f /tmp/drill.dump || true; fi
}
trap 'cleanup_db; if [ "${KEEP_DUMP:-0}" != "1" ]; then rm -rf "$WORK"; else echo "Dump kept at $DUMP"; fi' EXIT

# Supabase roles/extensions already exist on the server; pg_restore may warn about objects that
# belong to them (e.g. extension-owned schemas). Count real errors from the comparison below instead.
t2=$(date +%s)
do_restore 2> "${WORK}/restore.err" || true
t3=$(date +%s)
echo "Restore: $((t3 - t2)) s ($(grep -c 'error:' "${WORK}/restore.err" || true) pg_restore messages)"
# Expected in a scratch database: pg_cron lives only in the 'postgres' database, and vault.secrets
# belongs to supabase_admin. A logical restore therefore does NOT bring back Vault secrets (shops'
# M-Pesa keys, rafu_functions_url, rafu_service_role_key) or cron jobs. See docs/OPERATIONS.md §6.
grep 'error:' "${WORK}/restore.err" | sed 's/^pg_restore: error: could not execute query: /  restore note: /' | cut -c1-140 || true

DST="$(scratch_url)"
DST_COUNTS="$(run_sql "$DST" "$COUNTS_SQL")"
DST_CHECKS="$(run_sql "$DST" "$CHECKS_SQL")"

echo "Source:   $SRC_CHECKS"
echo "Restored: $DST_CHECKS"
if [ "$SRC_COUNTS" != "$DST_COUNTS" ]; then
  echo "FAIL: row counts differ"
  diff <(tr ',' '\n' <<<"$SRC_COUNTS") <(tr ',' '\n' <<<"$DST_COUNTS") || true
  exit 1
fi
if [ "$SRC_CHECKS" != "$DST_CHECKS" ]; then
  echo "FAIL: schema checks differ"
  exit 1
fi
echo "Rows:     $(tr ',' '\n' <<<"$SRC_COUNTS" | wc -l | tr -d ' ') tables, counts identical"
echo "PASS: restore matches the source. Total $((t3 - t0)) s."
