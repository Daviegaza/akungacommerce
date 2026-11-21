-- Orphaned product photos.
--
-- A photo is uploaded to the public 'product-images' bucket as soon as the merchant
-- picks it, before the product is saved. If the editor is closed, the photo removed,
-- or a saved photo later replaced, the object stays in storage. The browser deletes
-- what it can straight away (best effort); this function lists the rest for the
-- `media-cleanup` Edge Function (service role), which deletes them through the
-- Storage API. Scheduling is documented in supabase/functions/README.md and is NOT
-- enabled by this migration.
--
-- An object is an orphan when ALL of these hold:
--   * it is in 'product-images' under an org-id folder ("<org_id>/<file>")
--   * it is older than p_min_age (default 24 h, never less than 1 h, so an upload in
--     progress or an editor left open for a while is never touched)
--   * no product of ANY organisation has an image whose URL ends with
--     "/storage/v1/object/public/product-images/<name>", and no shop uses it as cover or logo.
create or replace function public.list_orphan_product_images(p_min_age interval default interval '24 hours', p_limit integer default 500)
returns table (name text, org_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with candidates as (
    select o.name, o.created_at, '/storage/v1/object/public/product-images/' || o.name as suffix,
           case when (storage.foldername(o.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then ((storage.foldername(o.name))[1])::uuid end as org_id
      from storage.objects o
     where o.bucket_id = 'product-images'
       and o.created_at < now() - greatest(coalesce(p_min_age, interval '24 hours'), interval '1 hour')
  )
  select c.name, c.org_id, c.created_at
    from candidates c
   where c.org_id is not null
     and array_length(storage.foldername(c.name), 1) = 1
     and not exists (
       select 1 from public.products p, jsonb_array_elements(p.images) i
        where right(i ->> 'url', length(c.suffix)) = c.suffix)
     and not exists (
       select 1 from public.shop_settings s
        where right(coalesce(s.cover_url, ''), length(c.suffix)) = c.suffix
           or right(coalesce(s.logo_url, ''), length(c.suffix)) = c.suffix)
   order by c.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 1000)
$$;

revoke execute on function public.list_orphan_product_images(interval, integer) from public, anon, authenticated;
grant execute on function public.list_orphan_product_images(interval, integer) to service_role;
