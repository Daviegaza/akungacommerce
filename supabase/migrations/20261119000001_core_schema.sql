-- Akunga Commerce: core multi-tenant schema.
-- Money is stored as bigint minor units with an explicit ISO 4217 currency.
-- Timestamps are timestamptz (UTC); each organisation stores its own IANA time zone.

create extension if not exists pgcrypto;

-- ───────────────────────── Types ─────────────────────────
create type public.member_role as enum ('owner', 'admin', 'manager', 'sales', 'fulfilment', 'analyst');
create type public.order_status as enum (
  'draft', 'pending_confirmation', 'confirmed', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled', 'refunded'
);
create type public.product_status as enum ('active', 'draft', 'archived');
create type public.tax_mode as enum ('exclusive', 'inclusive');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'reversed');
create type public.payment_verification as enum ('manual_unverified', 'provider_verified');
create type public.stock_movement_kind as enum ('receipt', 'adjustment', 'reservation', 'release', 'sale', 'return');
create type public.fulfilment_method as enum ('pickup', 'delivery');
create type public.integration_state as enum ('not_configured', 'configured_unverified', 'connected_verified', 'error');

create domain public.currency_code as text check (value ~ '^[A-Z]{3}$');
create domain public.country_code as text check (value ~ '^[A-Z]{2}$');
create domain public.e164 as text check (value ~ '^\+[1-9][0-9]{6,14}$');

-- ───────────────────────── Organisations & team ─────────────────────────
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  legal_name text check (legal_name is null or length(legal_name) <= 200),
  country_code public.country_code not null,
  timezone text not null,
  locale text not null check (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  base_currency public.currency_code not null,
  business_type text check (business_type is null or length(business_type) <= 60),
  tax_mode public.tax_mode not null default 'exclusive',
  contact_email text check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone public.e164,
  next_order_number integer not null default 1001,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- ───────────────────────── Authorisation helpers ─────────────────────────
create or replace function public.member_role_in(p_org uuid)
returns public.member_role
language sql stable security definer set search_path = public, pg_temp
as $$
  select role from public.memberships where org_id = p_org and user_id = auth.uid()
$$;

create or replace function public.is_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.memberships where org_id = p_org and user_id = auth.uid())
$$;

-- Mirrors src/domain/permissions.ts. Keep both in sync (tested).
create or replace function public.role_has_permission(p_role public.member_role, p_permission text)
returns boolean
language sql immutable
as $$
  select case p_permission
    when 'org.manage'          then p_role in ('owner', 'admin')
    when 'team.manage'         then p_role in ('owner', 'admin')
    when 'integrations.manage' then p_role in ('owner', 'admin')
    when 'catalogue.write'     then p_role in ('owner', 'admin', 'manager')
    when 'cost.read'           then p_role in ('owner', 'admin', 'manager')
    when 'customers.write'     then p_role in ('owner', 'admin', 'manager', 'sales')
    when 'orders.create'       then p_role in ('owner', 'admin', 'manager', 'sales')
    when 'orders.transition'   then p_role in ('owner', 'admin', 'manager', 'sales', 'fulfilment')
    when 'inventory.adjust'    then p_role in ('owner', 'admin', 'manager')
    when 'payments.record'     then p_role in ('owner', 'admin', 'manager', 'sales')
    when 'refunds.create'      then p_role in ('owner', 'admin', 'manager')
    when 'fulfilment.update'   then p_role in ('owner', 'admin', 'manager', 'fulfilment')
    else false
  end
$$;

create or replace function public.has_permission(p_org uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(public.role_has_permission(public.member_role_in(p_org), p_permission), false)
$$;

create or replace function public.require_permission(p_org uuid, p_permission text)
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if not public.has_permission(p_org, p_permission) then
    raise exception 'You do not have permission to do this (%).', p_permission using errcode = '42501';
  end if;
end
$$;

-- ───────────────────────── Locations ─────────────────────────
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  is_default boolean not null default false,
  address jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);
create unique index locations_one_default on public.locations(org_id) where is_default;

-- ───────────────────────── Catalogue ─────────────────────────
create table public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  description text check (description is null or length(description) <= 5000),
  category text check (category is null or length(category) <= 80),
  status public.product_status not null default 'active',
  track_stock boolean not null default true,
  -- Tax classification is metadata only until reviewed for each jurisdiction.
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 10000),
  tax_code text check (tax_code is null or length(tax_code) <= 40),
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create index products_org_idx on public.products(org_id, status);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  product_id uuid not null,
  name text not null default 'Default' check (length(trim(name)) between 1 and 120),
  sku text check (sku is null or length(sku) between 1 and 64),
  price_minor bigint not null check (price_minor >= 0),
  currency public.currency_code not null,
  low_stock_threshold integer not null default 3 check (low_stock_threshold >= 0),
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, org_id) references public.products(id, org_id) on delete cascade,
  unique (id, org_id)
);
create unique index product_variants_sku_unique on public.product_variants(org_id, lower(sku)) where sku is not null;
create index product_variants_product_idx on public.product_variants(product_id);

-- Cost is permission-restricted, so it lives in its own table with its own RLS.
create table public.variant_costs (
  variant_id uuid primary key,
  org_id uuid not null,
  cost_minor bigint not null check (cost_minor >= 0),
  currency public.currency_code not null,
  updated_at timestamptz not null default now(),
  foreign key (variant_id, org_id) references public.product_variants(id, org_id) on delete cascade
);

-- ───────────────────────── Inventory ─────────────────────────
create table public.inventory_levels (
  org_id uuid not null,
  variant_id uuid not null,
  location_id uuid not null,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  primary key (variant_id, location_id),
  check (reserved <= on_hand),
  foreign key (variant_id, org_id) references public.product_variants(id, org_id) on delete cascade,
  foreign key (location_id, org_id) references public.locations(id, org_id) on delete cascade
);
create index inventory_levels_org_idx on public.inventory_levels(org_id);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  variant_id uuid not null,
  location_id uuid not null,
  kind public.stock_movement_kind not null,
  on_hand_delta integer not null,
  reserved_delta integer not null,
  reason text,
  note text check (note is null or length(note) <= 500),
  order_id uuid,
  idempotency_key text,
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (variant_id, org_id) references public.product_variants(id, org_id),
  foreign key (location_id, org_id) references public.locations(id, org_id)
);
create unique index stock_movements_idem on public.stock_movements(org_id, idempotency_key) where idempotency_key is not null;
create index stock_movements_variant_idx on public.stock_movements(org_id, variant_id, created_at desc);

-- ───────────────────────── Customers ─────────────────────────
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  phone_e164 public.e164,
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  country_code public.country_code,
  marketing_consent boolean not null default false,
  consent_updated_at timestamptz,
  tags text[] not null default '{}',
  notes text check (notes is null or length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create index customers_phone_idx on public.customers(org_id, phone_e164);
create index customers_email_idx on public.customers(org_id, lower(email));

-- ───────────────────────── Orders ─────────────────────────
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  number integer not null,
  status public.order_status not null,
  channel text not null default 'direct' check (channel in ('direct', 'whatsapp', 'instagram', 'facebook', 'tiktok', 'storefront', 'phone', 'walk_in', 'other')),
  currency public.currency_code not null,
  tax_mode public.tax_mode not null,
  customer_id uuid,
  customer_name text,
  customer_phone public.e164,
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  delivery_fee_minor bigint not null default 0 check (delivery_fee_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  note text check (note is null or length(note) <= 2000),
  idempotency_key text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number),
  unique (org_id, idempotency_key),
  unique (id, org_id),
  foreign key (customer_id, org_id) references public.customers(id, org_id)
);
create index orders_org_created_idx on public.orders(org_id, created_at desc);
create index orders_customer_idx on public.orders(customer_id);

-- Immutable snapshot of what was sold, at what price, in which currency.
create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  order_id uuid not null,
  variant_id uuid,
  product_name text not null,
  variant_name text not null,
  sku text,
  quantity integer not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  currency public.currency_code not null,
  tax_rate_bps integer not null check (tax_rate_bps between 0 and 10000),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  subtotal_minor bigint not null,
  tax_minor bigint not null,
  total_minor bigint not null,
  track_stock boolean not null,
  returned_quantity integer not null default 0 check (returned_quantity >= 0 and returned_quantity <= quantity),
  position integer not null default 0,
  foreign key (order_id, org_id) references public.orders(id, org_id) on delete cascade,
  foreign key (variant_id, org_id) references public.product_variants(id, org_id)
);
create index order_lines_order_idx on public.order_lines(order_id);

create table public.order_status_history (
  id bigserial primary key,
  org_id uuid not null,
  order_id uuid not null,
  from_status public.order_status,
  to_status public.order_status not null,
  note text,
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (order_id, org_id) references public.orders(id, org_id) on delete cascade
);
create index order_status_history_order_idx on public.order_status_history(order_id, created_at);

create table public.fulfilments (
  order_id uuid primary key,
  org_id uuid not null,
  method public.fulfilment_method not null default 'pickup',
  recipient_name text,
  recipient_phone public.e164,
  -- Country-specific address: free-form lines plus optional region/postal code.
  address jsonb not null default '{}'::jsonb,
  assignee text check (assignee is null or length(assignee) <= 120),
  provider text not null default 'manual',
  tracking_ref text check (tracking_ref is null or length(tracking_ref) <= 120),
  proof_of_delivery text check (proof_of_delivery is null or length(proof_of_delivery) <= 1000),
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (order_id, org_id) references public.orders(id, org_id) on delete cascade
);

-- ───────────────────────── Payments & refunds (append-only) ─────────────────────────
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  order_id uuid not null,
  provider text not null default 'manual',
  method text not null check (method in ('cash', 'bank_transfer', 'mobile_money', 'card', 'cheque', 'other')),
  amount_minor bigint not null check (amount_minor > 0),
  currency public.currency_code not null,
  status public.payment_status not null,
  verification public.payment_verification not null,
  external_ref text check (external_ref is null or length(external_ref) <= 120),
  note text check (note is null or length(note) <= 500),
  received_at timestamptz not null default now(),
  reversed_reason text,
  idempotency_key text not null,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key),
  unique (id, org_id),
  foreign key (order_id, org_id) references public.orders(id, org_id)
);
create unique index payments_provider_ref on public.payments(org_id, provider, external_ref)
  where verification = 'provider_verified' and external_ref is not null;
create index payments_order_idx on public.payments(order_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  order_id uuid not null,
  payment_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency public.currency_code not null,
  status text not null default 'succeeded' check (status in ('pending', 'succeeded', 'failed')),
  verification public.payment_verification not null default 'manual_unverified',
  reason text not null check (length(trim(reason)) between 1 and 500),
  idempotency_key text not null,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key),
  foreign key (payment_id, org_id) references public.payments(id, org_id),
  foreign key (order_id, org_id) references public.orders(id, org_id)
);
create index refunds_order_idx on public.refunds(order_id);

-- ───────────────────────── Integrations & webhooks ─────────────────────────
-- Secrets never live here: they belong in Supabase Edge Function secrets / Vault.
create table public.integration_connections (
  org_id uuid not null references public.organisations(id) on delete cascade,
  provider text not null,
  kind text not null check (kind in ('whatsapp', 'email', 'sms', 'payment', 'delivery', 'accounting')),
  state public.integration_state not null default 'not_configured',
  public_config jsonb not null default '{}'::jsonb,
  last_tested_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);

create table public.webhook_events (
  id bigserial primary key,
  provider text not null,
  event_id text not null,
  org_id uuid references public.organisations(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload jsonb not null,
  unique (provider, event_id)
);

-- ───────────────────────── Audit log ─────────────────────────
create table public.audit_log (
  id bigserial primary key,
  org_id uuid not null references public.organisations(id) on delete cascade,
  actor_id uuid,
  entity text not null,
  entity_id text not null,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log(org_id, created_at desc);
