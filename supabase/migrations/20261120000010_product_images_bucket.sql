-- Public bucket for storefront product photos.
--
-- Storefront buyers are anonymous, so photos shown in the shop must be publicly
-- readable. The existing 'product-media' bucket stays private and unchanged.
--
-- Objects live under "<org_id>/<random>.<ext>". Anyone can download an object by
-- its public URL (/storage/v1/object/public/product-images/...), which bypasses
-- RLS for public buckets. Writes, and listing/selecting objects through the API,
-- are limited to members of that organisation with catalogue.write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

-- True when the first folder of an object key is an org id the caller can write
-- the catalogue for. A non-uuid folder is denied rather than raising a cast error.
create or replace function public.can_write_product_image(p_name text)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select case
    when (storage.foldername(p_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.has_permission(((storage.foldername(p_name))[1])::uuid, 'catalogue.write')
    else false
  end
$$;
revoke all on function public.can_write_product_image(text) from public, anon;
grant execute on function public.can_write_product_image(text) to authenticated;

create policy product_images_select on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and public.can_write_product_image(name));
create policy product_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.can_write_product_image(name));
create policy product_images_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.can_write_product_image(name))
  with check (bucket_id = 'product-images' and public.can_write_product_image(name));
create policy product_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.can_write_product_image(name));

-- Product images: https links as before. Additionally, for local development
-- only, the local Storage public URL of this org's own folder in product-images
-- (served over http://127.0.0.1 or http://localhost). Everything else is rejected.
create or replace function public.set_product_merchandising(p_org uuid, p_product uuid, p_images jsonb, p_featured boolean, p_available_from timestamptz)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_img jsonb;
  v_url text;
  v_local text := '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?/storage/v1/object/public/product-images/' || p_org::text || '/[A-Za-z0-9._-]+$';
begin
  perform public.require_permission(p_org, 'catalogue.write');
  for v_img in select * from jsonb_array_elements(coalesce(p_images, '[]'::jsonb)) loop
    v_url := coalesce(v_img ->> 'url', '');
    if v_url !~ '^https://' and v_url !~ v_local then
      raise exception 'Images must be https URLs' using errcode = '22023';
    end if;
  end loop;
  update public.products set images = coalesce(p_images, '[]'::jsonb), featured = coalesce(p_featured, false), available_from = p_available_from
   where id = p_product and org_id = p_org;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
end $$;
