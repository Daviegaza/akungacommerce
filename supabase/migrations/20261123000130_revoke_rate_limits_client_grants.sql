-- rate_limits is internal state used by SECURITY DEFINER storefront and job routines.
-- RLS has no client policies; remove the unnecessary direct API privileges as defense in depth.
revoke all on table public.rate_limits from anon, authenticated;
