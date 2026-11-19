-- Integrity triggers, audit history and row-level security.

-- ───────────────────────── updated_at ─────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger organisations_touch before update on public.organisations for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger product_variants_touch before update on public.product_variants for each row execute function public.touch_updated_at();
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();
create trigger fulfilments_touch before update on public.fulfilments for each row execute function public.touch_updated_at();

-- ───────────────────────── Organisation rules ─────────────────────────
create or replace function public.organisation_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.base_currency <> old.base_currency and (
      exists (select 1 from public.orders where org_id = new.id)
      or exists (select 1 from public.product_variants where org_id = new.id)
    ) then
      raise exception 'Base currency cannot change once products or orders exist' using errcode = '22023';
    end if;
    if new.next_order_number <> old.next_order_number and current_setting('akunga.allow_counter', true) is distinct from 'on' then
      raise exception 'Order counter is managed by the system' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger organisations_guard before insert or update on public.organisations
  for each row execute function public.organisation_guard();

-- Variants are priced in the organisation's base currency (price lists per currency come later).
create or replace function public.variant_currency_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_currency text;
begin
  select base_currency into v_currency from public.organisations where id = new.org_id;
  if new.currency <> v_currency then
    raise exception 'Variant currency % must match the business currency %', new.currency, v_currency using errcode = '22023';
  end if;
  return new;
end $$;
create trigger product_variants_currency before insert or update on public.product_variants
  for each row execute function public.variant_currency_guard();
create trigger variant_costs_currency before insert or update on public.variant_costs
  for each row execute function public.variant_currency_guard();

-- ───────────────────────── Append-only financial history ─────────────────────────
create or replace function public.forbid_change()
returns trigger language plpgsql as $$
begin
  raise exception '% rows are permanent history and cannot be %d', tg_table_name, lower(tg_op) using errcode = '42501';
end $$;

create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.forbid_change();
create trigger refunds_no_delete before delete on public.refunds
  for each row execute function public.forbid_change();
create trigger payments_no_delete before delete on public.payments
  for each row execute function public.forbid_change();
create trigger order_history_immutable before update or delete on public.order_status_history
  for each row execute function public.forbid_change();
create trigger audit_immutable before update or delete on public.audit_log
  for each row execute function public.forbid_change();

-- Payments: only status can move (succeeded -> reversed); money fields are frozen.
create or replace function public.payment_guard()
returns trigger language plpgsql as $$
begin
  if new.amount_minor <> old.amount_minor or new.currency <> old.currency or new.order_id <> old.order_id
     or new.verification <> old.verification or new.org_id <> old.org_id then
    raise exception 'Payment amounts and verification cannot be edited; reverse and record again' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger payments_guard before update on public.payments for each row execute function public.payment_guard();

-- Order line snapshots never change except returned quantity.
create or replace function public.order_line_guard()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'returned_quantity') <> (to_jsonb(old) - 'returned_quantity') then
    raise exception 'Order lines are an immutable record of the sale' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger order_lines_guard before update on public.order_lines for each row execute function public.order_line_guard();
create trigger order_lines_no_delete before delete on public.order_lines for each row
  when (pg_trigger_depth() = 0) execute function public.forbid_change();

-- ───────────────────────── Audit trail ─────────────────────────
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_org uuid := coalesce((v_row ->> 'org_id')::uuid, (v_row ->> 'id')::uuid);
  v_id text := coalesce(v_row ->> 'id', v_row ->> 'variant_id', v_row ->> 'order_id', v_row ->> 'user_id');
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

create trigger audit_organisations after update on public.organisations for each row execute function public.write_audit();
create trigger audit_memberships after insert or update or delete on public.memberships for each row execute function public.write_audit();
create trigger audit_products after insert or update on public.products for each row execute function public.write_audit();
create trigger audit_variants after insert or update on public.product_variants for each row execute function public.write_audit();
create trigger audit_costs after insert or update on public.variant_costs for each row execute function public.write_audit();
create trigger audit_inventory after insert or update on public.inventory_levels for each row execute function public.write_audit();
create trigger audit_orders after insert or update on public.orders for each row execute function public.write_audit();
create trigger audit_payments after insert or update on public.payments for each row execute function public.write_audit();
create trigger audit_refunds after insert on public.refunds for each row execute function public.write_audit();
create trigger audit_fulfilments after update on public.fulfilments for each row execute function public.write_audit();
create trigger audit_integrations after insert or update on public.integration_connections for each row execute function public.write_audit();

-- ───────────────────────── Row-level security ─────────────────────────
alter table public.organisations enable row level security;
alter table public.memberships enable row level security;
alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.variant_costs enable row level security;
alter table public.inventory_levels enable row level security;
alter table public.stock_movements enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.order_status_history enable row level security;
alter table public.fulfilments enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.integration_connections enable row level security;
alter table public.webhook_events enable row level security; -- no policies: service role only
alter table public.audit_log enable row level security;

-- Reads: any member of the organisation.
create policy org_read on public.organisations for select using (public.is_member(id));
create policy org_update on public.organisations for update using (public.has_permission(id, 'org.manage'))
  with check (public.has_permission(id, 'org.manage'));

create policy members_read on public.memberships for select using (public.is_member(org_id));

create policy locations_read on public.locations for select using (public.is_member(org_id));
create policy locations_write on public.locations for insert with check (public.has_permission(org_id, 'inventory.adjust'));
create policy locations_update on public.locations for update using (public.has_permission(org_id, 'inventory.adjust'))
  with check (public.has_permission(org_id, 'inventory.adjust'));

create policy products_read on public.products for select using (public.is_member(org_id));
create policy products_insert on public.products for insert with check (public.has_permission(org_id, 'catalogue.write'));
create policy products_update on public.products for update using (public.has_permission(org_id, 'catalogue.write'))
  with check (public.has_permission(org_id, 'catalogue.write'));

create policy variants_read on public.product_variants for select using (public.is_member(org_id));
create policy variants_insert on public.product_variants for insert with check (public.has_permission(org_id, 'catalogue.write'));
create policy variants_update on public.product_variants for update using (public.has_permission(org_id, 'catalogue.write'))
  with check (public.has_permission(org_id, 'catalogue.write'));

create policy costs_read on public.variant_costs for select using (public.has_permission(org_id, 'cost.read'));
create policy costs_insert on public.variant_costs for insert with check (public.has_permission(org_id, 'cost.read'));
create policy costs_update on public.variant_costs for update using (public.has_permission(org_id, 'cost.read'))
  with check (public.has_permission(org_id, 'cost.read'));

create policy inventory_read on public.inventory_levels for select using (public.is_member(org_id));
create policy movements_read on public.stock_movements for select using (public.is_member(org_id));

create policy customers_read on public.customers for select using (public.is_member(org_id));
create policy customers_insert on public.customers for insert with check (public.has_permission(org_id, 'customers.write'));
create policy customers_update on public.customers for update using (public.has_permission(org_id, 'customers.write'))
  with check (public.has_permission(org_id, 'customers.write'));

create policy orders_read on public.orders for select using (public.is_member(org_id));
create policy order_lines_read on public.order_lines for select using (public.is_member(org_id));
create policy order_history_read on public.order_status_history for select using (public.is_member(org_id));
create policy fulfilments_read on public.fulfilments for select using (public.is_member(org_id));
create policy payments_read on public.payments for select using (public.is_member(org_id));
create policy refunds_read on public.refunds for select using (public.is_member(org_id));

create policy integrations_read on public.integration_connections for select using (public.is_member(org_id));

-- Audit rows can contain cost prices, so only managers and above may read them.
create policy audit_read on public.audit_log for select using (public.has_permission(org_id, 'cost.read'));

-- Writes to orders, stock, payments, refunds and memberships go only through the
-- security-definer functions in the next migration. Make that explicit at the grant level too.
revoke insert, update, delete on public.orders, public.order_lines, public.order_status_history, public.fulfilments,
  public.payments, public.refunds, public.inventory_levels, public.stock_movements, public.memberships,
  public.audit_log, public.webhook_events, public.integration_connections
  from anon, authenticated;
revoke all on public.webhook_events from anon, authenticated;
revoke all on all tables in schema public from anon;
