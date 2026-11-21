-- Audit rows for tables without an id column (e.g. integration_connections) fall back to the provider key.
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_org uuid := coalesce((v_row ->> 'org_id')::uuid, (v_row ->> 'id')::uuid);
  v_id text := coalesce(v_row ->> 'id', v_row ->> 'variant_id', v_row ->> 'order_id', v_row ->> 'user_id', v_row ->> 'provider', '(unknown)');
begin
  if tg_table_name = 'organisations' then v_org := (v_row ->> 'id')::uuid; end if;
  if tg_table_name = 'memberships' then v_id := v_row ->> 'user_id'; end if;
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then return new; end if;
  insert into public.audit_log (org_id, actor_id, entity, entity_id, action, before, after)
  values (
    v_org, auth.uid(), tg_table_name, v_id, lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;
