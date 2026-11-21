-- Public storefront: shop settings, product media, scheduled drops, compare-at
-- prices, guest orders with tracking links, verified reviews and rate limits.
-- Anonymous visitors only ever reach data through the security-definer
-- storefront_* functions below; tables stay closed to anon.

-- ───────────────────────── Catalogue additions ─────────────────────────
alter table public.products
  add column images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 12),
  add column featured boolean not null default false,
  add column available_from timestamptz; -- honest scheduled "drop": not sellable before this instant

alter table public.product_variants
  add column compare_at_minor bigint check (compare_at_minor is null or compare_at_minor > price_minor),
  add column swatch text check (swatch is null or swatch ~ '^#[0-9a-fA-F]{6}$');

-- ───────────────────────── Shop settings ─────────────────────────
create table public.shop_settings (
  org_id uuid primary key references public.organisations(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  published boolean not null default false,
  tagline text check (tagline is null or length(tagline) <= 140),
  about text check (about is null or length(about) <= 2000),
  cover_url text check (cover_url is null or cover_url ~ '^https://'),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  whatsapp_e164 public.e164,
  registered_name text check (registered_name is null or length(registered_name) <= 120),
  location_lat double precision check (location_lat between -90 and 90),
  location_lng double precision check (location_lng between -180 and 180),
  location_label text check (location_label is null or length(location_label) <= 160),
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default true,
  -- Ascending distance bands: [{"max_km": 3, "fee_minor": 15000}, ...]; beyond the last band = no delivery.
  delivery_bands jsonb not null default '[]'::jsonb check (jsonb_typeof(delivery_bands) = 'array'),
  delivery_promise text check (delivery_promise is null or length(delivery_promise) <= 80),
  cod_enabled boolean not null default false,
  mpesa_till text check (mpesa_till is null or mpesa_till ~ '^[0-9]{5,8}$'),
  mpesa_paybill text check (mpesa_paybill is null or mpesa_paybill ~ '^[0-9]{5,8}$'),
  return_policy text check (return_policy is null or length(return_policy) <= 2000),
  updated_at timestamptz not null default now(),
  -- A published shop that delivers must have a location to measure distance from.
  check (not (published and delivery_enabled) or (location_lat is not null and location_lng is not null))
);
alter table public.shop_settings enable row level security;
create policy shop_settings_read on public.shop_settings for select using (public.is_member(org_id));
revoke insert, update, delete on public.shop_settings from anon, authenticated;
create trigger shop_settings_touch before update on public.shop_settings for each row execute function public.touch_updated_at();
create trigger audit_shop_settings after insert or update on public.shop_settings for each row execute function public.write_audit();

-- ───────────────────────── Orders: storefront fields ─────────────────────────
alter table public.orders
  add column tracking_token text unique,
  add column payment_preference text check (payment_preference in ('mpesa', 'cod', 'card', 'bank_transfer', 'other'));

-- ───────────────────────── Verified reviews ─────────────────────────
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  product_id uuid not null,
  order_id uuid not null,
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or length(body) <= 1000),
  author_display text not null check (length(author_display) between 1 and 40),
  hidden boolean not null default false, -- merchant may hide abusive text; the rating still counts
  created_at timestamptz not null default now(),
  unique (order_id, product_id),
  foreign key (product_id, org_id) references public.products(id, org_id) on delete cascade,
  foreign key (order_id, org_id) references public.orders(id, org_id) on delete cascade
);
alter table public.reviews enable row level security;
create policy reviews_read on public.reviews for select using (public.is_member(org_id));
create policy reviews_hide on public.reviews for update using (public.has_permission(org_id, 'catalogue.write'))
  with check (public.has_permission(org_id, 'catalogue.write'));
revoke insert, delete on public.reviews from anon, authenticated;
create or replace function public.review_guard() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'hidden') <> (to_jsonb(old) - 'hidden') then
    raise exception 'Reviews cannot be edited, only hidden' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger reviews_guard before update on public.reviews for each row execute function public.review_guard();

-- ───────────────────────── Rate limiting ─────────────────────────
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);
alter table public.rate_limits enable row level security; -- no policies: definer functions only

create or replace function public._rate_limit(p_key text, p_max integer, p_window interval)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - p_window then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - p_window then now() else r.window_start end
  returning hits into v_hits;
  if v_hits > p_max then
    raise exception 'Too many attempts. Please wait a few minutes and try again.' using errcode = '54000';
  end if;
end $$;

create or replace function public._client_ip() returns text language sql stable as $$
  select coalesce(
    nullif(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1), ''),
    'unknown')
$$;

-- ───────────────────────── Distance and delivery fee ─────────────────────────
create or replace function public.haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371.0088 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Fee in minor units for a distance, or null when outside every band.
create or replace function public.delivery_fee_for(p_bands jsonb, p_km double precision)
returns bigint language sql immutable as $$
  select (b ->> 'fee_minor')::bigint
    from jsonb_array_elements(p_bands) b
   where (b ->> 'max_km')::double precision >= p_km
   order by (b ->> 'max_km')::double precision
   limit 1
$$;

-- ───────────────────────── Shared order core ─────────────────────────
create or replace function public._create_order_core(p_org uuid, p_input jsonb, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org public.organisations;
  v_order uuid;
  v_status public.order_status := coalesce(p_input ->> 'status', 'confirmed')::public.order_status;
  v_customer public.customers;
  v_line jsonb;
  v_variant record;
  v_qty integer;
  v_discount bigint;
  v_sub bigint;
  v_tax bigint;
  v_total bigint;
  v_pos integer := 0;
  v_sum_sub bigint := 0;
  v_sum_tax bigint := 0;
  v_sum_total bigint := 0;
  v_sum_discount bigint := 0;
  v_fee bigint := coalesce((p_input ->> 'delivery_fee_minor')::bigint, 0);
  v_number integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'Missing idempotency key' using errcode = '22023';
  end if;
  select id into v_order from public.orders where org_id = p_org and idempotency_key = p_idempotency_key;
  if v_order is not null then return v_order; end if;

  if v_status not in ('draft', 'pending_confirmation', 'confirmed') then
    raise exception 'New orders start as draft, awaiting confirmation or confirmed' using errcode = '22023';
  end if;
  if v_fee < 0 then raise exception 'Delivery fee cannot be negative' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_input -> 'lines', '[]'::jsonb)) = 0 then
    raise exception 'An order needs at least one line' using errcode = '22023';
  end if;

  select * into v_org from public.organisations where id = p_org;
  if nullif(p_input ->> 'customer_id', '') is not null then
    select * into v_customer from public.customers where id = (p_input ->> 'customer_id')::uuid and org_id = p_org;
    if v_customer.id is null then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  end if;

  perform set_config('akunga.allow_counter', 'on', true);
  update public.organisations set next_order_number = next_order_number + 1
   where id = p_org returning next_order_number - 1 into v_number;
  perform set_config('akunga.allow_counter', 'off', true);

  insert into public.orders (org_id, number, status, channel, currency, tax_mode, customer_id, customer_name, customer_phone,
    subtotal_minor, discount_minor, tax_minor, delivery_fee_minor, total_minor, note, idempotency_key)
  values (p_org, v_number, v_status, coalesce(p_input ->> 'channel', 'direct'), v_org.base_currency, v_org.tax_mode,
    v_customer.id, v_customer.name, v_customer.phone_e164, 0, 0, 0, v_fee, 0, nullif(p_input ->> 'note', ''), p_idempotency_key)
  on conflict (org_id, idempotency_key) do nothing
  returning id into v_order;
  if v_order is null then
    -- A concurrent retry with the same key won the race.
    select id into v_order from public.orders where org_id = p_org and idempotency_key = p_idempotency_key;
    return v_order;
  end if;

  for v_line in select * from jsonb_array_elements(p_input -> 'lines') loop
    v_qty := (v_line ->> 'quantity')::integer;
    v_discount := coalesce((v_line ->> 'discount_minor')::bigint, 0);
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be at least 1' using errcode = '22023'; end if;
    if v_discount < 0 then raise exception 'Discount cannot be negative' using errcode = '22023'; end if;

    select pv.id, pv.name as variant_name, pv.sku, pv.price_minor, pv.currency, p.name as product_name,
           p.tax_rate_bps, p.track_stock
      into v_variant
      from public.product_variants pv join public.products p on p.id = pv.product_id
     where pv.id = (v_line ->> 'variant_id')::uuid and pv.org_id = p_org
       and pv.is_active and p.status = 'active';
    if v_variant.id is null then raise exception 'A product in this order is unavailable' using errcode = 'P0002'; end if;
    if v_variant.currency <> v_org.base_currency then
      raise exception 'Cannot mix % and % in one order', v_variant.currency, v_org.base_currency using errcode = '22023';
    end if;

    v_sub := v_variant.price_minor * v_qty - v_discount;
    if v_sub < 0 then raise exception 'Discount cannot exceed the line amount' using errcode = '22023'; end if;
    if v_org.tax_mode = 'exclusive' then
      v_tax := round(v_sub::numeric * v_variant.tax_rate_bps / 10000);
      v_total := v_sub + v_tax;
    else
      v_tax := case when v_variant.tax_rate_bps = 0 then 0
                    else round(v_sub::numeric * v_variant.tax_rate_bps / (10000 + v_variant.tax_rate_bps)) end;
      v_total := v_sub;
    end if;

    insert into public.order_lines (org_id, order_id, variant_id, product_name, variant_name, sku, quantity, unit_price_minor,
      currency, tax_rate_bps, discount_minor, subtotal_minor, tax_minor, total_minor, track_stock, position)
    values (p_org, v_order, v_variant.id, v_variant.product_name, v_variant.variant_name, v_variant.sku, v_qty, v_variant.price_minor,
      v_variant.currency, v_variant.tax_rate_bps, v_discount, v_sub, v_tax, v_total, v_variant.track_stock, v_pos);

    v_sum_sub := v_sum_sub + v_sub;
    v_sum_tax := v_sum_tax + v_tax;
    v_sum_total := v_sum_total + v_total;
    v_sum_discount := v_sum_discount + v_discount;
    v_pos := v_pos + 1;
  end loop;

  update public.orders set subtotal_minor = v_sum_sub, discount_minor = v_sum_discount, tax_minor = v_sum_tax,
         total_minor = v_sum_total + v_fee
   where id = v_order;

  insert into public.fulfilments (order_id, org_id, method, recipient_name, recipient_phone, address)
  values (v_order, p_org,
    coalesce(p_input #>> '{fulfilment,method}', 'pickup')::public.fulfilment_method,
    nullif(p_input #>> '{fulfilment,recipient_name}', ''),
    nullif(p_input #>> '{fulfilment,recipient_phone}', ''),
    coalesce(p_input #> '{fulfilment,address}', '{}'::jsonb));

  insert into public.order_status_history (org_id, order_id, from_status, to_status, note)
  values (p_org, v_order, null, v_status, 'Order created');

  if public.order_holds_reservation(v_status) then
    perform public._order_stock(v_order, 'reserve');
  end if;
  return v_order;
end $$;
-- Staff RPC is now a permission check plus the shared core.
create or replace function public.create_order(p_org uuid, p_input jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission(p_org, 'orders.create');
  return public._create_order_core(p_org, p_input, p_idempotency_key);
end $$;

-- ───────────────────────── Merchant: shop settings & merchandising ─────────────────────────
create or replace function public.save_shop_settings(p_org uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_band jsonb;
  v_prev double precision := 0;
begin
  perform public.require_permission(p_org, 'org.manage');
  for v_band in select * from jsonb_array_elements(coalesce(p_settings -> 'delivery_bands', '[]'::jsonb)) loop
    if (v_band ->> 'max_km')::double precision is null or (v_band ->> 'max_km')::double precision <= v_prev
       or (v_band ->> 'max_km')::double precision > 500 or (v_band ->> 'fee_minor')::bigint is null or (v_band ->> 'fee_minor')::bigint < 0 then
      raise exception 'Delivery bands must have increasing distances (up to 500 km) and non-negative fees' using errcode = '22023';
    end if;
    v_prev := (v_band ->> 'max_km')::double precision;
  end loop;
  insert into public.shop_settings (org_id, slug, published, tagline, about, cover_url, logo_url, whatsapp_e164, registered_name,
    location_lat, location_lng, location_label, pickup_enabled, delivery_enabled, delivery_bands, delivery_promise, cod_enabled,
    mpesa_till, mpesa_paybill, return_policy)
  values (p_org, lower(p_settings ->> 'slug'), coalesce((p_settings ->> 'published')::boolean, false),
    nullif(p_settings ->> 'tagline', ''), nullif(p_settings ->> 'about', ''), nullif(p_settings ->> 'cover_url', ''), nullif(p_settings ->> 'logo_url', ''),
    nullif(p_settings ->> 'whatsapp_e164', ''), nullif(p_settings ->> 'registered_name', ''),
    (p_settings ->> 'location_lat')::double precision, (p_settings ->> 'location_lng')::double precision, nullif(p_settings ->> 'location_label', ''),
    coalesce((p_settings ->> 'pickup_enabled')::boolean, true), coalesce((p_settings ->> 'delivery_enabled')::boolean, true),
    coalesce(p_settings -> 'delivery_bands', '[]'::jsonb), nullif(p_settings ->> 'delivery_promise', ''),
    coalesce((p_settings ->> 'cod_enabled')::boolean, false), nullif(p_settings ->> 'mpesa_till', ''), nullif(p_settings ->> 'mpesa_paybill', ''),
    nullif(p_settings ->> 'return_policy', ''))
  on conflict (org_id) do update set
    slug = excluded.slug, published = excluded.published, tagline = excluded.tagline, about = excluded.about,
    cover_url = excluded.cover_url, logo_url = excluded.logo_url, whatsapp_e164 = excluded.whatsapp_e164,
    registered_name = excluded.registered_name, location_lat = excluded.location_lat, location_lng = excluded.location_lng,
    location_label = excluded.location_label, pickup_enabled = excluded.pickup_enabled, delivery_enabled = excluded.delivery_enabled,
    delivery_bands = excluded.delivery_bands, delivery_promise = excluded.delivery_promise, cod_enabled = excluded.cod_enabled,
    mpesa_till = excluded.mpesa_till, mpesa_paybill = excluded.mpesa_paybill, return_policy = excluded.return_policy;
exception when unique_violation then
  raise exception 'That shop link is already taken' using errcode = '23505';
end $$;

create or replace function public.set_product_merchandising(p_org uuid, p_product uuid, p_images jsonb, p_featured boolean, p_available_from timestamptz)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_img jsonb;
begin
  perform public.require_permission(p_org, 'catalogue.write');
  for v_img in select * from jsonb_array_elements(coalesce(p_images, '[]'::jsonb)) loop
    if coalesce(v_img ->> 'url', '') !~ '^https://' then
      raise exception 'Images must be https URLs' using errcode = '22023';
    end if;
  end loop;
  update public.products set images = coalesce(p_images, '[]'::jsonb), featured = coalesce(p_featured, false), available_from = p_available_from
   where id = p_product and org_id = p_org;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.set_variant_merchandising(p_org uuid, p_variant uuid, p_compare_at_minor bigint, p_swatch text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission(p_org, 'catalogue.write');
  update public.product_variants set compare_at_minor = p_compare_at_minor, swatch = nullif(p_swatch, '')
   where id = p_variant and org_id = p_org;
  if not found then raise exception 'Variant not found' using errcode = 'P0002'; end if;
end $$;

-- ───────────────────────── Public storefront ─────────────────────────
create or replace function public._shop_by_slug(p_slug text) returns public.shop_settings
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.shop_settings where slug = lower(p_slug) and published
$$;

create or replace function public.storefront_get(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_shop public.shop_settings;
  v_org public.organisations;
begin
  v_shop := public._shop_by_slug(p_slug);
  if v_shop.org_id is null then raise exception 'Shop not found' using errcode = 'P0002'; end if;
  select * into v_org from public.organisations where id = v_shop.org_id;
  return jsonb_build_object(
    'shop', jsonb_build_object(
      'slug', v_shop.slug, 'name', v_org.name, 'tagline', v_shop.tagline, 'about', v_shop.about,
      'cover_url', v_shop.cover_url, 'logo_url', v_shop.logo_url, 'whatsapp_e164', v_shop.whatsapp_e164,
      'registered_name', v_shop.registered_name, 'location_lat', v_shop.location_lat, 'location_lng', v_shop.location_lng,
      'location_label', v_shop.location_label, 'pickup_enabled', v_shop.pickup_enabled, 'delivery_enabled', v_shop.delivery_enabled,
      'delivery_bands', v_shop.delivery_bands, 'delivery_promise', v_shop.delivery_promise, 'cod_enabled', v_shop.cod_enabled,
      'mpesa_till', v_shop.mpesa_till, 'mpesa_paybill', v_shop.mpesa_paybill, 'return_policy', v_shop.return_policy,
      'currency', v_org.base_currency, 'locale', v_org.locale, 'timezone', v_org.timezone, 'country_code', v_org.country_code,
      'tax_mode', v_org.tax_mode,
      'rating', (select jsonb_build_object('average', round(avg(rating)::numeric, 1), 'count', count(*))
                   from public.reviews where org_id = v_org.id having count(*) > 0)
    ),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description, 'category', p.category, 'images', p.images,
        'featured', p.featured, 'available_from', p.available_from, 'track_stock', p.track_stock, 'tax_rate_bps', p.tax_rate_bps,
        'created_at', p.created_at,
        -- Real counts only: delivered units net of returns, hidden below 5.
        'sold_count', (select case when sum(ol.quantity - ol.returned_quantity) >= 5 then sum(ol.quantity - ol.returned_quantity) end
                         from public.order_lines ol join public.orders o on o.id = ol.order_id
                         join public.product_variants pv2 on pv2.id = ol.variant_id
                        where pv2.product_id = p.id and o.status = 'delivered'),
        'rating', (select jsonb_build_object('average', round(avg(r.rating)::numeric, 1), 'count', count(*))
                     from public.reviews r where r.product_id = p.id having count(*) > 0),
        'variants', (select jsonb_agg(jsonb_build_object(
            'id', v.id, 'name', v.name, 'price_minor', v.price_minor, 'compare_at_minor', v.compare_at_minor,
            'currency', v.currency, 'swatch', v.swatch, 'low_stock_threshold', v.low_stock_threshold,
            'available', case when p.track_stock then
                (select coalesce(sum(il.on_hand - il.reserved), 0) from public.inventory_levels il where il.variant_id = v.id) end
          ) order by v.position)
          from public.product_variants v where v.product_id = p.id and v.is_active)
      ) order by p.featured desc, p.created_at desc)
      from public.products p
      where p.org_id = v_org.id and p.status = 'active'
        and exists (select 1 from public.product_variants v where v.product_id = p.id and v.is_active)
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.storefront_reviews(p_slug text, p_product uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('rating', r.rating, 'body', case when r.hidden then null else r.body end,
           'author', r.author_display, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
    from public.reviews r join public.shop_settings s on s.org_id = r.org_id
   where s.slug = lower(p_slug) and s.published and r.product_id = p_product
$$;

-- Server-side price quote, including the delivery fee for a dropped pin.
create or replace function public.storefront_quote(p_slug text, p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_shop public.shop_settings;
  v_org public.organisations;
  v_line jsonb;
  v_v record;
  v_qty integer;
  v_sub bigint;
  v_tax bigint;
  v_lines jsonb := '[]'::jsonb;
  v_sum_sub bigint := 0;
  v_sum_tax bigint := 0;
  v_sum_total bigint := 0;
  v_method text := coalesce(p_input ->> 'method', 'pickup');
  v_km double precision;
  v_fee bigint := 0;
begin
  v_shop := public._shop_by_slug(p_slug);
  if v_shop.org_id is null then raise exception 'Shop not found' using errcode = 'P0002'; end if;
  select * into v_org from public.organisations where id = v_shop.org_id;
  if jsonb_array_length(coalesce(p_input -> 'lines', '[]'::jsonb)) = 0 then raise exception 'Your bag is empty' using errcode = '22023'; end if;
  if jsonb_array_length(p_input -> 'lines') > 50 then raise exception 'Too many items in one order' using errcode = '22023'; end if;

  for v_line in select * from jsonb_array_elements(p_input -> 'lines') loop
    v_qty := (v_line ->> 'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 999 then raise exception 'Invalid quantity' using errcode = '22023'; end if;
    select v.id, v.price_minor, v.name as vname, p.name as pname, p.tax_rate_bps, p.track_stock, p.available_from,
           (select coalesce(sum(il.on_hand - il.reserved), 0) from public.inventory_levels il where il.variant_id = v.id) as avail
      into v_v
      from public.product_variants v join public.products p on p.id = v.product_id
     where v.id = (v_line ->> 'variant_id')::uuid and v.org_id = v_org.id and v.is_active and p.status = 'active';
    if v_v.id is null then raise exception 'An item in your bag is no longer available' using errcode = 'P0002'; end if;
    if v_v.available_from is not null and v_v.available_from > now() then
      raise exception '% is not available yet', v_v.pname using errcode = '22023';
    end if;
    if v_v.track_stock and v_v.avail < v_qty then
      raise exception 'Only % of % left', greatest(v_v.avail, 0), v_v.pname using errcode = '23514';
    end if;
    v_sub := v_v.price_minor * v_qty;
    if v_org.tax_mode = 'exclusive' then
      v_tax := round(v_sub::numeric * v_v.tax_rate_bps / 10000);
    else
      v_tax := case when v_v.tax_rate_bps = 0 then 0 else round(v_sub::numeric * v_v.tax_rate_bps / (10000 + v_v.tax_rate_bps)) end;
    end if;
    v_sum_sub := v_sum_sub + v_sub;
    v_sum_tax := v_sum_tax + v_tax;
    v_sum_total := v_sum_total + v_sub + case when v_org.tax_mode = 'exclusive' then v_tax else 0 end;
    v_lines := v_lines || jsonb_build_object('variant_id', v_v.id, 'name', v_v.pname, 'variant', v_v.vname, 'quantity', v_qty,
      'unit_price_minor', v_v.price_minor, 'total_minor', v_sub + case when v_org.tax_mode = 'exclusive' then v_tax else 0 end);
  end loop;

  if v_method = 'delivery' then
    if not v_shop.delivery_enabled then raise exception 'This shop does not deliver' using errcode = '22023'; end if;
    if (p_input ->> 'lat') is null or (p_input ->> 'lng') is null then raise exception 'Drop a pin for your delivery address' using errcode = '22023'; end if;
    v_km := public.haversine_km(v_shop.location_lat, v_shop.location_lng, (p_input ->> 'lat')::double precision, (p_input ->> 'lng')::double precision);
    v_fee := public.delivery_fee_for(v_shop.delivery_bands, v_km);
    if v_fee is null then
      raise exception 'Sorry, this address is outside the delivery area (% km away)', round(v_km::numeric, 1) using errcode = '22023';
    end if;
  elsif v_method = 'pickup' then
    if not v_shop.pickup_enabled then raise exception 'This shop does not offer pickup' using errcode = '22023'; end if;
  else
    raise exception 'Choose delivery or pickup' using errcode = '22023';
  end if;

  return jsonb_build_object('currency', v_org.base_currency, 'tax_mode', v_org.tax_mode, 'lines', v_lines,
    'subtotal_minor', v_sum_sub, 'tax_minor', v_sum_tax, 'delivery_fee_minor', v_fee,
    'distance_km', case when v_km is null then null else round(v_km::numeric, 1) end,
    'total_minor', v_sum_total + v_fee);
end $$;

-- Guest checkout. Creates a pending_confirmation order (stock reserved) and returns a tracking token.
create or replace function public.storefront_place_order(p_slug text, p_input jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_shop public.shop_settings;
  v_quote jsonb;
  v_phone text := p_input ->> 'phone_e164';
  v_name text := trim(coalesce(p_input ->> 'name', ''));
  v_customer uuid;
  v_order uuid;
  v_token text;
  v_pay text := coalesce(p_input ->> 'payment', 'mpesa');
  v_method text := coalesce(p_input ->> 'method', 'pickup');
  v_row public.orders;
  v_fee bigint;
begin
  v_shop := public._shop_by_slug(p_slug);
  if v_shop.org_id is null then raise exception 'Shop not found' using errcode = 'P0002'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then raise exception 'Missing idempotency key' using errcode = '22023'; end if;

  -- Same key → same order (double taps, flaky networks).
  select * into v_row from public.orders where org_id = v_shop.org_id and idempotency_key = 'sf:' || p_idempotency_key;
  if v_row.id is not null then
    return jsonb_build_object('order_id', v_row.id, 'number', v_row.number, 'tracking_token', v_row.tracking_token,
      'total_minor', v_row.total_minor, 'currency', v_row.currency);
  end if;

  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Enter a valid phone number' using errcode = '22023'; end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Enter your name' using errcode = '22023'; end if;
  if v_pay not in ('mpesa', 'cod', 'card', 'bank_transfer', 'other') then raise exception 'Choose a payment method' using errcode = '22023'; end if;
  if v_pay = 'cod' and not v_shop.cod_enabled then raise exception 'Cash on delivery is not available here' using errcode = '22023'; end if;

  perform public._rate_limit('sf:ip:' || public._client_ip(), 20, interval '1 hour');
  perform public._rate_limit('sf:phone:' || v_shop.org_id || ':' || v_phone, 6, interval '1 hour');
  perform public._rate_limit('sf:shop:' || v_shop.org_id, 500, interval '1 hour');

  v_quote := public.storefront_quote(p_slug, p_input);
  v_fee := (v_quote ->> 'delivery_fee_minor')::bigint;

  select id into v_customer from public.customers where org_id = v_shop.org_id and phone_e164 = v_phone order by created_at limit 1;
  if v_customer is null then
    insert into public.customers (org_id, name, phone_e164, country_code, marketing_consent, consent_updated_at, tags)
    values (v_shop.org_id, v_name, v_phone, (select country_code from public.organisations where id = v_shop.org_id),
      coalesce((p_input ->> 'marketing_opt_in')::boolean, false), now(), array['storefront'])
    returning id into v_customer;
  elsif coalesce((p_input ->> 'marketing_opt_in')::boolean, false) then
    update public.customers set marketing_consent = true, consent_updated_at = now() where id = v_customer;
  end if;

  v_order := public._create_order_core(v_shop.org_id, jsonb_build_object(
    'status', 'pending_confirmation',
    'channel', case when p_input ->> 'channel' in ('whatsapp', 'instagram', 'facebook', 'tiktok', 'storefront') then p_input ->> 'channel' else 'storefront' end,
    'customer_id', v_customer,
    'note', nullif(left(coalesce(p_input ->> 'note', ''), 500), ''),
    'delivery_fee_minor', v_fee,
    'fulfilment', jsonb_build_object(
      'method', v_method, 'recipient_name', v_name, 'recipient_phone', v_phone,
      'address', case when v_method = 'delivery' then jsonb_build_object(
        'lat', (p_input ->> 'lat')::double precision, 'lng', (p_input ->> 'lng')::double precision,
        'line1', left(coalesce(p_input ->> 'address_line', ''), 160), 'landmark', left(coalesce(p_input ->> 'landmark', ''), 160),
        'building', left(coalesce(p_input ->> 'building', ''), 120), 'instructions', left(coalesce(p_input ->> 'instructions', ''), 300),
        'distanceKm', (v_quote ->> 'distance_km')::numeric) else '{}'::jsonb end),
    'lines', (select jsonb_agg(jsonb_build_object('variant_id', l ->> 'variant_id', 'quantity', (l ->> 'quantity')::integer))
                from jsonb_array_elements(p_input -> 'lines') l)
  ), 'sf:' || p_idempotency_key);

  v_token := translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
  update public.orders set tracking_token = v_token, payment_preference = v_pay where id = v_order returning * into v_row;

  return jsonb_build_object('order_id', v_row.id, 'number', v_row.number, 'tracking_token', v_token,
    'total_minor', v_row.total_minor, 'currency', v_row.currency);
end $$;

-- Order tracking for whoever holds the link. No account, no other orders, no staff data.
create or replace function public.storefront_track(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders;
  v_shop public.shop_settings;
  v_org public.organisations;
  v_f public.fulfilments;
  v_paid bigint;
  v_refunded bigint;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select * into v_o from public.orders where tracking_token = p_token;
  if v_o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select * into v_shop from public.shop_settings where org_id = v_o.org_id;
  select * into v_org from public.organisations where id = v_o.org_id;
  select * into v_f from public.fulfilments where order_id = v_o.id;
  select coalesce(sum(amount_minor), 0) into v_paid from public.payments where order_id = v_o.id and status = 'succeeded';
  select coalesce(sum(amount_minor), 0) into v_refunded from public.refunds where order_id = v_o.id and status = 'succeeded';
  return jsonb_build_object(
    'number', v_o.number, 'status', v_o.status, 'created_at', v_o.created_at, 'currency', v_o.currency,
    'subtotal_minor', v_o.subtotal_minor, 'tax_minor', v_o.tax_minor, 'delivery_fee_minor', v_o.delivery_fee_minor,
    'total_minor', v_o.total_minor, 'paid_minor', v_paid - v_refunded, 'payment_preference', v_o.payment_preference,
    'customer_first_name', split_part(coalesce(v_o.customer_name, ''), ' ', 1),
    'lines', (select jsonb_agg(jsonb_build_object('product_id', pv.product_id, 'name', ol.product_name, 'variant', ol.variant_name,
                'quantity', ol.quantity, 'total_minor', ol.total_minor) order by ol.position)
                from public.order_lines ol left join public.product_variants pv on pv.id = ol.variant_id where ol.order_id = v_o.id),
    'history', (select jsonb_agg(jsonb_build_object('status', h.to_status, 'at', h.created_at) order by h.id)
                  from public.order_status_history h where h.order_id = v_o.id),
    'fulfilment', jsonb_build_object('method', v_f.method, 'rider', v_f.assignee, 'tracking_ref', v_f.tracking_ref,
                  'delivered_at', v_f.delivered_at, 'drop_lat', (v_f.address ->> 'lat')::double precision,
                  'drop_lng', (v_f.address ->> 'lng')::double precision, 'landmark', v_f.address ->> 'landmark'),
    'shop', jsonb_build_object('name', v_org.name, 'slug', v_shop.slug, 'whatsapp_e164', v_shop.whatsapp_e164,
              'location_lat', v_shop.location_lat, 'location_lng', v_shop.location_lng, 'location_label', v_shop.location_label,
              'mpesa_till', v_shop.mpesa_till, 'mpesa_paybill', v_shop.mpesa_paybill, 'registered_name', v_shop.registered_name,
              'locale', v_org.locale, 'timezone', v_org.timezone),
    'reviewed_product_ids', (select coalesce(jsonb_agg(product_id), '[]'::jsonb) from public.reviews where order_id = v_o.id)
  );
end $$;

-- Verified review: only the holder of a delivered order's link, once per product in that order.
create or replace function public.storefront_review(p_token text, p_product uuid, p_rating integer, p_body text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_o public.orders;
begin
  select * into v_o from public.orders where tracking_token = p_token;
  if v_o.id is null or p_token is null or length(p_token) < 20 then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if v_o.status <> 'delivered' then raise exception 'You can review once your order is delivered' using errcode = '22023'; end if;
  if not exists (select 1 from public.order_lines ol join public.product_variants pv on pv.id = ol.variant_id
                  where ol.order_id = v_o.id and pv.product_id = p_product) then
    raise exception 'That product is not in this order' using errcode = '22023';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1 to 5' using errcode = '22023'; end if;
  perform public._rate_limit('sf:review:' || public._client_ip(), 30, interval '1 hour');
  insert into public.reviews (org_id, product_id, order_id, rating, body, author_display)
  values (v_o.org_id, p_product, v_o.id, p_rating, nullif(left(trim(coalesce(p_body, '')), 1000), ''),
          coalesce(nullif(split_part(coalesce(v_o.customer_name, ''), ' ', 1), ''), 'Customer'))
  on conflict (order_id, product_id) do nothing;
end $$;

-- ───────────────────────── Privileges ─────────────────────────
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public._stock_move(uuid, uuid, uuid, public.stock_movement_kind, integer, integer, text, text, uuid, text) from authenticated;
revoke execute on function public._default_location(uuid) from authenticated;
revoke execute on function public._order_stock(uuid, text) from authenticated;
revoke execute on function public._create_order_core(uuid, jsonb, text) from authenticated;
revoke execute on function public._rate_limit(text, integer, interval) from authenticated;
revoke execute on function public._shop_by_slug(text) from authenticated;
revoke execute on function public.record_verified_payment(uuid, text, text, bigint, text, text, timestamptz) from authenticated;
grant execute on function public.storefront_get(text) to anon;
grant execute on function public.storefront_reviews(text, uuid) to anon;
grant execute on function public.storefront_quote(text, jsonb) to anon;
grant execute on function public.storefront_place_order(text, jsonb, text) to anon;
grant execute on function public.storefront_track(text) to anon;
grant execute on function public.storefront_review(text, uuid, integer, text) to anon;
