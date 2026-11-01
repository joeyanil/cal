-- 0022: security hardening, from Supabase's security advisor.
-- Changes no behaviour of any screen; logged-in users keep every permission they had.
-- Safe to run more than once.

-- 1. Five functions had no fixed search_path. Pin it, so a function can never be
--    tricked into using look-alike objects from another schema.
ALTER FUNCTION public.fn_load_calendar_config_snapshot(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_validate_exam_placement() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_validate_fact_ref(calendar_fact_kind, smallint, holiday_type_key, exam_type_key, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_validate_holiday_occurrence() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_validate_semester_ordering() SET search_path = public, pg_temp;

-- 2. Internal functions must not be callable by people who are not signed in.
--    Before this, anyone on the internet could call fn_bump_calendar_config_revision
--    (a SECURITY DEFINER function) through the public API. Signed-in users and the
--    server keep access, because the app and the triggers call these as that user.
REVOKE ALL ON FUNCTION public.fn_audit_log() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bump_calendar_config_revision(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_load_calendar_config_snapshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_validate_fact_ref(calendar_fact_kind, smallint, holiday_type_key, exam_type_key, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_audit_log() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bump_calendar_config_revision(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_load_calendar_config_snapshot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_fact_ref(calendar_fact_kind, smallint, holiday_type_key, exam_type_key, text) TO authenticated, service_role;

-- 3. Supabase's own helper that switches on row-level security for new tables
--    (present on Supabase projects only). It runs as an event trigger and never
--    needs to be callable through the public API.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- Note for the future: Supabase gives anon/authenticated/service_role EXECUTE on every
-- NEW function by default. When adding a function that is not meant for signed-out
-- visitors, add a REVOKE like the ones above in the same migration.
