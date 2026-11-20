-- Explicit function search paths prevent object shadowing through caller-controlled schemas.
-- All affected routines are invoker-security functions; retain the schemas they need and keep pg_temp last.
alter function public._client_ip() set search_path = public, extensions, pg_temp;
alter function public._currency_exponent(text) set search_path = public, extensions, pg_temp;
alter function public._default_policy() set search_path = public, extensions, pg_temp;
alter function public._deposit_due(jsonb, bigint, bigint, text) set search_path = public, extensions, pg_temp;
alter function public._failed_reason_label(text) set search_path = public, extensions, pg_temp;
alter function public._invite_json(public.team_invites) set search_path = public, extensions, pg_temp;
alter function public._mask_phone(text) set search_path = public, extensions, pg_temp;
alter function public.delivery_fee_for(jsonb, double precision) set search_path = public, extensions, pg_temp;
alter function public.forbid_change() set search_path = public, extensions, pg_temp;
alter function public.haversine_km(double precision, double precision, double precision, double precision) set search_path = public, extensions, pg_temp;
alter function public.order_holds_reservation(public.order_status) set search_path = public, extensions, pg_temp;
alter function public.order_line_guard() set search_path = public, extensions, pg_temp;
alter function public.order_transition_allowed(public.order_status, public.order_status) set search_path = public, extensions, pg_temp;
alter function public.order_transition_needs_return_flow(public.order_status, public.order_status) set search_path = public, extensions, pg_temp;
alter function public.payment_guard() set search_path = public, extensions, pg_temp;
alter function public.rafu_job_definitions() set search_path = public, extensions, pg_temp;
alter function public.review_guard() set search_path = public, extensions, pg_temp;
alter function public.role_has_permission(public.member_role, text) set search_path = public, extensions, pg_temp;
alter function public.touch_updated_at() set search_path = public, extensions, pg_temp;
