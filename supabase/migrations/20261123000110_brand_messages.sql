-- Rebrand (Rafu -> Fungua, proposed name). Only user-visible error messages change; function names,
-- signatures, grants and behaviour are identical to 20261120000040 and 20261122000100.

create or replace function public._require_platform_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not public.is_platform_admin() then
    raise exception 'Only Fungua reviewers can do this' using errcode = '42501';
  end if;
end $$;

create or replace function public.mark_mpesa_verified(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission(p_org, 'integrations.manage');
  if not exists (select 1 from public.org_mpesa_credentials where org_id = p_org) then
    raise exception 'Save the M-Pesa credentials first' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.payments
     where org_id = p_org and provider = 'mpesa' and verification = 'provider_verified' and status = 'succeeded'
  ) and not exists (
    select 1 from public.mpesa_requests where org_id = p_org and status in ('paid', 'awaiting_receipt')
  ) then
    raise exception 'No M-Pesa payment has reached Fungua yet. Send a test payment first.' using errcode = '22023';
  end if;
  update public.integration_connections set state = 'connected_verified', last_tested_at = now(), last_error = null, updated_at = now()
   where org_id = p_org and provider = 'mpesa';
end $$;
