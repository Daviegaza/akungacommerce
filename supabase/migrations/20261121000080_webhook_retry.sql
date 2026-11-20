-- Reliable webhook processing (WhatsApp opt-outs first).
--
-- Before: whatsapp-webhook stored the event, tried the consent update, logged any error and then
-- marked the event processed anyway, so a transient failure could lose an opt-out for good. It also
-- wrote through the consent trigger as an anonymous caller, so the source was stamped 'checkout'.
--
-- Now:
--   * whatsapp_apply_opt_out() does the consent change AND marks the event processed in ONE
--     transaction, with the event row locked. Either both happen or neither does.
--   * webhook_event_failed() records the attempt and error durably. After 8 failed attempts the
--     event is parked (dead_at) for a person to look at; it is never silently marked processed.
--   * Unprocessed, non-dead events stay retryable: the edge function reprocesses them when the
--     provider re-delivers, and webhook_events_pending() lets a scheduled retry pick them up.
--   * Duplicate deliveries are idempotent: a processed event returns 'duplicate' and changes nothing.

alter table public.webhook_events
  add column attempts integer not null default 0 check (attempts >= 0),
  add column last_error text check (last_error is null or length(last_error) <= 500),
  add column last_attempt_at timestamptz,
  add column dead_at timestamptz;

create index webhook_events_pending_idx on public.webhook_events (provider, received_at)
  where processed_at is null and dead_at is null;

-- One WhatsApp business number belongs to exactly one organisation; otherwise an opt-out could not
-- be routed (the old code silently dropped it when two rows matched).
create unique index integration_connections_whatsapp_number_uidx
  on public.integration_connections ((public_config->>'phone_number_id'))
  where provider = 'whatsapp' and public_config ? 'phone_number_id';

-- Applies a STOP reply. Service role only.
-- Returns {outcome: 'opted_out' | 'no_org' | 'duplicate' | 'dead' | 'not_found', customers?: int, org_id?: uuid}
create or replace function public.whatsapp_apply_opt_out(
  p_event_id text, p_phone_number_id text, p_from_e164 text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event public.webhook_events;
  v_org uuid;
  v_count integer := 0;
begin
  if p_event_id is null or length(p_event_id) = 0 then
    raise exception 'Event id required' using errcode = '22023';
  end if;
  if p_from_e164 is null or p_from_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Sender must be E.164' using errcode = '22023';
  end if;

  select * into v_event from public.webhook_events
   where provider = 'whatsapp' and event_id = p_event_id
   for update;
  if v_event.id is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_event.processed_at is not null then return jsonb_build_object('outcome', 'duplicate'); end if;
  if v_event.dead_at is not null then return jsonb_build_object('outcome', 'dead'); end if;

  select org_id into v_org from public.integration_connections
   where provider = 'whatsapp' and public_config->>'phone_number_id' = p_phone_number_id;

  if v_org is not null then
    perform set_config('akunga.consent_source', 'stop_reply', true);
    update public.customers
       set marketing_consent = false, updated_at = now()
     where org_id = v_org and phone_e164 = p_from_e164 and marketing_consent;
    get diagnostics v_count = row_count;
  end if;

  update public.webhook_events
     set org_id = coalesce(v_org, org_id), processed_at = now(), last_error = null,
         attempts = attempts + 1, last_attempt_at = now()
   where id = v_event.id;

  return jsonb_build_object(
    'outcome', case when v_org is null then 'no_org' else 'opted_out' end,
    'customers', v_count, 'org_id', v_org);
end $$;

-- Marks a non-actionable event (delivery status, non-STOP message) processed. Idempotent.
create or replace function public.webhook_event_processed(p_provider text, p_event_id text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  update public.webhook_events
     set processed_at = now(), last_error = null, attempts = attempts + 1, last_attempt_at = now()
   where provider = p_provider and event_id = p_event_id and processed_at is null and dead_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- Records a failed processing attempt. Never marks the event processed.
-- Returns {attempts, dead}. Parks the event after p_max_attempts (default 8).
create or replace function public.webhook_event_failed(
  p_provider text, p_event_id text, p_error text, p_max_attempts integer default 8
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.webhook_events;
begin
  update public.webhook_events
     set attempts = attempts + 1,
         last_error = left(coalesce(nullif(p_error, ''), 'unknown error'), 500),
         last_attempt_at = now(),
         dead_at = case when attempts + 1 >= greatest(p_max_attempts, 1) then now() else null end
   where provider = p_provider and event_id = p_event_id and processed_at is null
  returning * into v_row;
  if v_row.id is null then return jsonb_build_object('attempts', null, 'dead', false); end if;
  return jsonb_build_object('attempts', v_row.attempts, 'dead', v_row.dead_at is not null);
end $$;

-- Events still waiting (for a scheduled retry run). Oldest first, with a short back-off.
create or replace function public.webhook_events_pending(p_provider text, p_limit integer default 50)
returns table (event_id text, payload jsonb, attempts integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.event_id, e.payload, e.attempts
    from public.webhook_events e
   where e.provider = p_provider and e.processed_at is null and e.dead_at is null
     and (e.last_attempt_at is null or e.last_attempt_at < now() - make_interval(mins => least(60, (1 << least(e.attempts, 6)))))
   order by e.received_at
   limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;

revoke execute on function public.whatsapp_apply_opt_out(text, text, text) from public, anon, authenticated;
revoke execute on function public.webhook_event_processed(text, text) from public, anon, authenticated;
revoke execute on function public.webhook_event_failed(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.webhook_events_pending(text, integer) from public, anon, authenticated;
grant execute on function public.whatsapp_apply_opt_out(text, text, text) to service_role;
grant execute on function public.webhook_event_processed(text, text) to service_role;
grant execute on function public.webhook_event_failed(text, text, text, integer) to service_role;
grant execute on function public.webhook_events_pending(text, integer) to service_role;
