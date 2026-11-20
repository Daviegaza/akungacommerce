-- Go-live plumbing that needs no provider account, so accounts can be hooked in later.
--
--  1. Tracking links expire. A closed order (delivered / cancelled / refunded) keeps its buyer link for
--     shop_settings.tracking_link_days (default 90, 7..3650) after it closed; then the token is cleared and
--     every token-based RPC returns "not found". Rider links are already revoked on close (…090).
--  2. Webhook payload retention. Payloads (they contain phone numbers) of processed or parked events are
--     replaced by a redaction marker after 30 days. event_id stays, so duplicate deliveries remain idempotent.
--  3. Per-shop M-Pesa (Daraja) credentials. Each shop can store its own Till/Paybill credentials; the secrets
--     live in Supabase Vault (encrypted at rest) and are readable only by the service role. Money then goes
--     to the shop's own account. The platform-wide env credentials are used only when the operator opts in
--     with DARAJA_ALLOW_PLATFORM_SHORTCODE=true (Edge Function env).
--  4. Scheduled jobs (pg_cron). SQL jobs run as soon as this migration is applied. HTTP jobs call Edge
--     Functions through pg_net and do nothing until two Vault secrets exist:
--       rafu_functions_url      e.g. https://<ref>.supabase.co/functions/v1
--       rafu_service_role_key   the project's service role key (every scheduled function accepts it)

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ───────────────────────── 1. Tracking link expiry ─────────────────────────
alter table public.orders add column if not exists closed_at timestamptz;
update public.orders set closed_at = updated_at
 where closed_at is null and status in ('delivered', 'cancelled', 'refunded');

alter table public.shop_settings
  add column if not exists tracking_link_days integer not null default 90
  check (tracking_link_days between 7 and 3650);

create or replace function public._stamp_order_closed() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status in ('delivered', 'cancelled', 'refunded') then
    if new.closed_at is null then new.closed_at := now(); end if;
  else
    new.closed_at := null; -- reopened (e.g. a refund reversed); the link lives again until the next close
  end if;
  return new;
end $$;
create trigger orders_stamp_closed
  before update of status on public.orders
  for each row when (old.status is distinct from new.status)
  execute function public._stamp_order_closed();

create index if not exists orders_closed_with_token_idx
  on public.orders (closed_at) where tracking_token is not null and closed_at is not null;

create or replace function public.expire_tracking_links(p_limit integer default 1000)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  with due as (
    select o.id
      from public.orders o
      left join public.shop_settings s on s.org_id = o.org_id
     where o.tracking_token is not null
       and o.closed_at is not null
       and o.closed_at < now() - make_interval(days => coalesce(s.tracking_link_days, 90))
     order by o.closed_at
     limit greatest(1, least(coalesce(p_limit, 1000), 10000))
     for update of o skip locked
  )
  update public.orders o set tracking_token = null from due where o.id = due.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.set_tracking_link_days(p_org uuid, p_days integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission(p_org, 'org.manage');
  if p_days is null or p_days < 7 or p_days > 3650 then
    raise exception 'Keep tracking links for 7 to 3650 days' using errcode = '22023';
  end if;
  update public.shop_settings set tracking_link_days = p_days, updated_at = now() where org_id = p_org;
  if not found then raise exception 'Set up your shop link first' using errcode = '22023'; end if;
end $$;

-- ───────────────────────── 2. Webhook payload retention ─────────────────────────
create or replace function public.prune_webhook_payloads(p_older_than interval default interval '30 days', p_limit integer default 5000)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if p_older_than < interval '1 day' then raise exception 'Keep at least one day' using errcode = '22023'; end if;
  with due as (
    select id from public.webhook_events
     where received_at < now() - p_older_than
       and (processed_at is not null or dead_at is not null)
       and not (payload ? 'redacted')
     order by received_at
     limit greatest(1, least(coalesce(p_limit, 5000), 50000))
     for update skip locked
  )
  update public.webhook_events w
     set payload = jsonb_build_object('redacted', true, 'redacted_at', now())
    from due where w.id = due.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ───────────────────────── 3. Per-shop M-Pesa credentials ─────────────────────────
create table public.org_mpesa_credentials (
  org_id uuid primary key references public.organisations(id) on delete cascade,
  environment text not null check (environment in ('sandbox', 'production')),
  shortcode text not null check (shortcode ~ '^\d{5,8}$'),
  transaction_type text not null check (transaction_type in ('CustomerPayBillOnline', 'CustomerBuyGoodsOnline')),
  party_b text check (party_b is null or party_b ~ '^\d{5,8}$'),
  consumer_key_id uuid not null,
  consumer_secret_id uuid not null,
  passkey_id uuid not null,
  key_hint text not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.org_mpesa_credentials enable row level security;
revoke all on public.org_mpesa_credentials from anon, authenticated;
-- No policies: staff read the safe summary through mpesa_credentials_summary().

create or replace function public._vault_upsert(p_id uuid, p_name text, p_secret text) returns uuid
language plpgsql security definer set search_path = public, vault, pg_temp as $$
begin
  if p_id is not null and exists (select 1 from vault.secrets where id = p_id) then
    perform vault.update_secret(p_id, p_secret);
    return p_id;
  end if;
  delete from vault.secrets where name = p_name;
  return vault.create_secret(p_secret, p_name);
end $$;

create or replace function public.set_mpesa_credentials(
  p_org uuid, p_environment text, p_shortcode text, p_transaction_type text, p_party_b text,
  p_consumer_key text, p_consumer_secret text, p_passkey text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old public.org_mpesa_credentials;
  v_key text := btrim(coalesce(p_consumer_key, ''));
  v_sec text := btrim(coalesce(p_consumer_secret, ''));
  v_pass text := btrim(coalesce(p_passkey, ''));
  v_short text := btrim(coalesce(p_shortcode, ''));
  v_party text := nullif(btrim(coalesce(p_party_b, '')), '');
begin
  perform public.require_permission(p_org, 'integrations.manage');
  select * into v_old from public.org_mpesa_credentials where org_id = p_org for update;
  if p_environment not in ('sandbox', 'production') then raise exception 'Choose sandbox or production' using errcode = '22023'; end if;
  if v_short !~ '^\d{5,8}$' then raise exception 'The shortcode is 5 to 8 digits' using errcode = '22023'; end if;
  if p_transaction_type not in ('CustomerPayBillOnline', 'CustomerBuyGoodsOnline') then
    raise exception 'Choose Paybill or Buy Goods (Till)' using errcode = '22023';
  end if;
  if v_party is not null and v_party !~ '^\d{5,8}$' then raise exception 'The till number is 5 to 8 digits' using errcode = '22023'; end if;
  -- Blank secret fields keep the stored value (so the form never has to show secrets again).
  if v_old.org_id is null and (v_key = '' or v_sec = '' or v_pass = '') then
    raise exception 'Enter the consumer key, consumer secret and passkey' using errcode = '22023';
  end if;
  if length(v_key) > 200 or length(v_sec) > 200 or length(v_pass) > 300 then raise exception 'Value too long' using errcode = '22023'; end if;

  insert into public.org_mpesa_credentials as c (
    org_id, environment, shortcode, transaction_type, party_b,
    consumer_key_id, consumer_secret_id, passkey_id, key_hint, updated_by, updated_at
  ) values (
    p_org, p_environment, v_short, p_transaction_type, v_party,
    case when v_key = '' then v_old.consumer_key_id else public._vault_upsert(v_old.consumer_key_id, 'mpesa:' || p_org || ':consumer_key', v_key) end,
    case when v_sec = '' then v_old.consumer_secret_id else public._vault_upsert(v_old.consumer_secret_id, 'mpesa:' || p_org || ':consumer_secret', v_sec) end,
    case when v_pass = '' then v_old.passkey_id else public._vault_upsert(v_old.passkey_id, 'mpesa:' || p_org || ':passkey', v_pass) end,
    case when v_key = '' then v_old.key_hint else '…' || right(v_key, 4) end,
    auth.uid(), now()
  )
  on conflict (org_id) do update set
    environment = excluded.environment, shortcode = excluded.shortcode,
    transaction_type = excluded.transaction_type, party_b = excluded.party_b,
    consumer_key_id = excluded.consumer_key_id, consumer_secret_id = excluded.consumer_secret_id,
    passkey_id = excluded.passkey_id, key_hint = excluded.key_hint,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  -- New or changed credentials are never "verified": a real payment end to end must pass first.
  insert into public.integration_connections (org_id, provider, kind, state, public_config, last_error, updated_at)
  values (p_org, 'mpesa', 'payment', 'configured_unverified',
          jsonb_build_object('environment', p_environment, 'shortcode', v_short, 'transaction_type', p_transaction_type), null, now())
  on conflict (org_id, provider) do update set
    state = 'configured_unverified', public_config = excluded.public_config, last_error = null, updated_at = now();

  return public.mpesa_credentials_summary(p_org);
end $$;

create or replace function public.mpesa_credentials_summary(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.org_mpesa_credentials;
begin
  if not public.is_member(p_org) then raise exception 'Not found' using errcode = 'P0002'; end if;
  select * into v from public.org_mpesa_credentials where org_id = p_org;
  if v.org_id is null then return jsonb_build_object('configured', false); end if;
  return jsonb_build_object(
    'configured', true, 'environment', v.environment, 'shortcode', v.shortcode,
    'transaction_type', v.transaction_type, 'party_b', v.party_b, 'key_hint', v.key_hint, 'updated_at', v.updated_at);
end $$;

create or replace function public.clear_mpesa_credentials(p_org uuid) returns void
language plpgsql security definer set search_path = public, vault, pg_temp as $$
declare v public.org_mpesa_credentials;
begin
  perform public.require_permission(p_org, 'integrations.manage');
  delete from public.org_mpesa_credentials where org_id = p_org returning * into v;
  if v.org_id is not null then
    delete from vault.secrets where id in (v.consumer_key_id, v.consumer_secret_id, v.passkey_id);
  end if;
  update public.integration_connections set state = 'not_configured', public_config = '{}'::jsonb, updated_at = now()
   where org_id = p_org and provider = 'mpesa';
end $$;

-- Service role only: the decrypted credentials for one shop (Edge Functions).
create or replace function public.mpesa_credentials_for(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public, vault, pg_temp as $$
declare v public.org_mpesa_credentials;
begin
  select * into v from public.org_mpesa_credentials where org_id = p_org;
  if v.org_id is null then return null; end if;
  return jsonb_build_object(
    'environment', v.environment, 'shortcode', v.shortcode, 'transaction_type', v.transaction_type, 'party_b', v.party_b,
    'consumer_key', (select decrypted_secret from vault.decrypted_secrets where id = v.consumer_key_id),
    'consumer_secret', (select decrypted_secret from vault.decrypted_secrets where id = v.consumer_secret_id),
    'passkey', (select decrypted_secret from vault.decrypted_secrets where id = v.passkey_id));
end $$;

-- Owner/admin records the result of a live test (e.g. a 1 KES payment that reconciled). Only then do
-- payment prompts start for the shop.
create or replace function public.mark_mpesa_verified(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission(p_org, 'integrations.manage');
  if not exists (select 1 from public.org_mpesa_credentials where org_id = p_org) then
    raise exception 'Save the M-Pesa credentials first' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.payments
     where org_id = p_org and provider = 'mpesa' and verification = 'provider_verified' and status = 'succeeded'
  ) and not exists (
    select 1 from public.mpesa_requests where org_id = p_org and status in ('paid', 'awaiting_receipt')
  ) then
    raise exception 'No M-Pesa payment has reached Rafu yet. Send a test payment first.' using errcode = '22023';
  end if;
  update public.integration_connections set state = 'connected_verified', last_tested_at = now(), last_error = null, updated_at = now()
   where org_id = p_org and provider = 'mpesa';
end $$;

-- ───────────────────────── 4. Scheduled jobs ─────────────────────────
create or replace function public._invoke_edge_job(p_function text, p_query text default '', p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = public, vault, extensions, pg_temp as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'rafu_functions_url' limit 1);
  v_key text := (select decrypted_secret from vault.decrypted_secrets where name = 'rafu_service_role_key' limit 1);
begin
  if v_url is null or v_key is null or v_url = '' or v_key = '' then return null; end if; -- not hooked up yet
  return net.http_post(
    url := rtrim(v_url, '/') || '/' || p_function || p_query,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 30000);
end $$;

-- One list, so OPERATIONS.md and the schedule cannot drift.
create or replace function public.rafu_job_definitions()
returns table (job_name text, schedule text, command text)
language sql immutable as $$
  values
    ('rafu-release-stale-orders',  '*/10 * * * *', 'select public.cancel_stale_storefront_orders()'),
    ('rafu-prune-rate-limits',     '17 3 * * *',   'select public.prune_rate_limits()'),
    ('rafu-expire-tracking-links', '23 3 * * *',   'select public.expire_tracking_links()'),
    ('rafu-prune-webhook-payloads','29 3 * * *',   'select public.prune_webhook_payloads()'),
    ('rafu-whatsapp-retry',        '*/5 * * * *',  $c$select public._invoke_edge_job('whatsapp-webhook', '?retry=1')$c$),
    ('rafu-mpesa-stk-query',       '*/3 * * * *',  $c$select public._invoke_edge_job('mpesa-stk-query')$c$),
    ('rafu-media-cleanup',         '41 2 * * *',   $c$select public._invoke_edge_job('media-cleanup')$c$),
    ('rafu-domain-recheck',        '7 */6 * * *',  $c$select public._invoke_edge_job('verify-custom-domain', '', '{"scheduled": true}'::jsonb)$c$)
$$;

do $$
declare r record;
begin
  for r in select * from public.rafu_job_definitions() loop
    perform cron.schedule(r.job_name, r.schedule, r.command);
  end loop;
end $$;

-- Operators' view of the jobs and their last run (service role / SQL editor).
create or replace function public.rafu_job_status()
returns table (job_name text, schedule text, active boolean, last_status text, last_run timestamptz, last_message text)
language sql stable security definer set search_path = public, cron, pg_temp as $$
  select j.jobname::text, j.schedule::text, j.active, d.status::text, d.start_time, left(d.return_message, 200)
    from cron.job j
    left join lateral (
      select status, start_time, return_message from cron.job_run_details
       where jobid = j.jobid order by start_time desc limit 1
    ) d on true
   where j.jobname like 'rafu-%'
   order by j.jobname
$$;

-- ───────────────────────── Grants ─────────────────────────
revoke execute on function public._stamp_order_closed() from public, anon, authenticated;
revoke execute on function public.expire_tracking_links(integer) from public, anon, authenticated;
revoke execute on function public.set_tracking_link_days(uuid, integer) from public, anon;
grant execute on function public.set_tracking_link_days(uuid, integer) to authenticated;
revoke execute on function public.prune_webhook_payloads(interval, integer) from public, anon, authenticated;
revoke execute on function public._vault_upsert(uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.set_mpesa_credentials(uuid, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.mpesa_credentials_summary(uuid) from public, anon;
revoke execute on function public.clear_mpesa_credentials(uuid) from public, anon;
revoke execute on function public.mark_mpesa_verified(uuid) from public, anon;
revoke execute on function public.mpesa_credentials_for(uuid) from public, anon, authenticated;
revoke execute on function public._invoke_edge_job(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.rafu_job_status() from public, anon, authenticated;
grant execute on function public.expire_tracking_links(integer) to service_role;
grant execute on function public.prune_webhook_payloads(interval, integer) to service_role;
grant execute on function public.set_mpesa_credentials(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.mpesa_credentials_summary(uuid) to authenticated;
grant execute on function public.clear_mpesa_credentials(uuid) to authenticated;
grant execute on function public.mark_mpesa_verified(uuid) to authenticated;
grant execute on function public.mpesa_credentials_for(uuid) to service_role;
grant execute on function public._invoke_edge_job(text, text, jsonb) to service_role;
grant execute on function public.rafu_job_status() to service_role;
