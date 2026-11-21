-- Tracking page lines show pre-tax line amounts (unit price x quantity, less discount)
-- so they add up to the subtotal; tax and delivery are shown separately.
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
                'quantity', ol.quantity, 'unit_price_minor', ol.unit_price_minor, 'total_minor', ol.subtotal_minor) order by ol.position)
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
grant execute on function public.storefront_track(text) to anon;
