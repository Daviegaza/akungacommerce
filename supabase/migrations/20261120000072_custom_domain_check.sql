-- Custom-domain DNS verifier support (Edge Function `verify-custom-domain`).
--
-- The function resolves DNS over HTTPS and then sets the result with the existing
-- service-role mark_custom_domain_status(). 'verified' here means DNS only: no
-- certificate is issued and no hosting serves the domain yet (the UI says so).
--
-- * request_custom_domain_check(org): what a merchant's "Check now" calls (through
--   the function, with the merchant's own JWT). Owners/admins only, rate-limited on
--   the server: 5 checks per 15 minutes per shop.
-- * list_custom_domains_to_check(limit): for a scheduled run (service role). Domains
--   waiting for DNS or failed, not checked in the last hour, oldest check first.

create or replace function public.request_custom_domain_check(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.custom_domains;
begin
  perform public.require_permission(p_org, 'org.manage');
  select * into v_row from public.custom_domains where org_id = p_org;
  if v_row.org_id is null then raise exception 'Add a domain first' using errcode = 'P0002'; end if;
  perform public._rate_limit('domain-check:' || p_org::text, 5, interval '15 minutes');
  return jsonb_build_object('hostname', v_row.hostname, 'verification_token', v_row.verification_token, 'status', v_row.status);
end $$;

create or replace function public.list_custom_domains_to_check(p_limit integer default 25)
returns table (hostname text, verification_token text, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.hostname, d.verification_token, d.status
    from public.custom_domains d
   where d.status in ('pending_dns', 'failed')
     and (d.last_checked_at is null or d.last_checked_at < now() - interval '1 hour')
   order by d.last_checked_at nulls first, d.created_at
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

revoke execute on function public.request_custom_domain_check(uuid) from public, anon;
grant execute on function public.request_custom_domain_check(uuid) to authenticated;
revoke execute on function public.list_custom_domains_to_check(integer) from public, anon, authenticated;
grant execute on function public.list_custom_domains_to_check(integer) to service_role;
