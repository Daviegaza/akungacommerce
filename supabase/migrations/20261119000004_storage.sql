-- Private product media bucket. Objects live under "<org_id>/..." and are only
-- readable/writable by members of that organisation. Images up to 5 MB, common web formats.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-media', 'product-media', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

create policy product_media_read on storage.objects for select to authenticated
  using (bucket_id = 'product-media' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy product_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-media' and public.has_permission(((storage.foldername(name))[1])::uuid, 'catalogue.write'));
create policy product_media_update on storage.objects for update to authenticated
  using (bucket_id = 'product-media' and public.has_permission(((storage.foldername(name))[1])::uuid, 'catalogue.write'));
create policy product_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-media' and public.has_permission(((storage.foldername(name))[1])::uuid, 'catalogue.write'));
