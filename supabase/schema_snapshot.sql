-- ============================================================================
-- K2 Calendar Engine - complete picture of the database after migrations
-- 0001 .. 0021b (and the standalone bootstrap) have been applied.
--
-- WHAT THIS IS: a generated, single-file record of the final structure
-- (tables, columns, constraints, indexes, functions, triggers, row-level
-- security policies, grants) plus the built-in catalog rows (holiday types,
-- exam types, permissions, roles). Use it to see exactly what the calendar
-- engine needs, or to build an empty copy in one step.
--
-- WHAT THIS IS NOT: the way to change a live database. Live databases are
-- changed only by the numbered files in supabase/migrations, in order.
--
-- Needs the Supabase roles (anon, authenticated, service_role) and
-- auth.uid() to exist first. Regenerate with scripts/local-db/snapshot.sh.
-- ============================================================================
SET check_function_bodies = false; -- functions are created before the tables they mention


\restrict 0p3mEJZZGYiQaaBng3uXyZyw8z6Cvh6s7pzLm9Y7gs2nKhU4ki5xsyWaaOWGYOH

CREATE TYPE public.academic_year_status AS ENUM (
    'PREPARING',
    'READY',
    'ACTIVE',
    'CLOSED'
);

CREATE TYPE public.calendar_fact_kind AS ENUM (
    'ACADEMIC_YEAR_START',
    'ACADEMIC_YEAR_END',
    'SEMESTER_START',
    'SEMESTER_END',
    'HOLIDAY_OCCURRENCE',
    'EXAM_START',
    'EXAM_END',
    'STUDENT_RETURN'
);

CREATE TYPE public.calendar_reminder_status AS ENUM (
    'PENDING',
    'SKIPPED',
    'SENT'
);

CREATE TYPE public.calendar_validation_severity AS ENUM (
    'MISSING',
    'ERROR',
    'WARNING',
    'INFORMATION'
);

CREATE TYPE public.exam_grade_scope AS ENUM (
    'ALL',
    'GRADE_12'
);

CREATE TYPE public.exam_type_key AS ENUM (
    'S1_REGIONAL_MODEL',
    'S1_FINAL',
    'S2_REGIONAL_MODEL',
    'S2_FINAL',
    'GRADE12_NATIONAL'
);

CREATE TYPE public.holiday_source AS ENUM (
    'AUTO_PROPOSED',
    'ADMIN_ENTERED'
);

CREATE TYPE public.holiday_type_key AS ENUM (
    'NEW_YEAR',
    'GENNA',
    'TIMKAT',
    'ADWA',
    'PATRIOTS',
    'SIKLET',
    'FASIKA',
    'EID_FITR',
    'EID_ADHA',
    'DERG_DOWNFALL'
);

CREATE TYPE public.semester_status AS ENUM (
    'UPCOMING',
    'ACTIVE',
    'CLOSED'
);

CREATE TYPE public.timeline_build_status AS ENUM (
    'CANDIDATE',
    'CURRENT',
    'FAILED',
    'SUPERSEDED'
);

CREATE TABLE public.calendar_corrections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year_id uuid NOT NULL,
    fact_kind public.calendar_fact_kind NOT NULL,
    fact_semester_order smallint,
    fact_holiday_type_key public.holiday_type_key,
    fact_exam_type_key public.exam_type_key,
    original_value date NOT NULL,
    corrected_value date NOT NULL,
    reason text NOT NULL,
    performed_by uuid NOT NULL,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_corrections_fact_semester_order_check CHECK ((fact_semester_order = ANY (ARRAY[1, 2]))),
    CONSTRAINT calendar_corrections_reason_check CHECK ((length(btrim(reason)) > 0))
);

CREATE FUNCTION public.fn_apply_calendar_correction(p_academic_year_id uuid, p_fact_kind public.calendar_fact_kind, p_fact_semester_order smallint, p_fact_holiday_type_key public.holiday_type_key, p_fact_exam_type_key public.exam_type_key, p_corrected_value date, p_reason text) RETURNS public.calendar_corrections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_year academic_years;
    v_semester semesters;
    v_original DATE;
    v_correction calendar_corrections;
    v_actor UUID;
BEGIN
    IF NOT has_permission('calendar.correct_history') THEN
        RAISE EXCEPTION 'permission denied for calendar.correct_history' USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_actor FROM users WHERE supabase_uid = auth.uid();

    SELECT * INTO v_year FROM academic_years WHERE id = p_academic_year_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Academic year % not found', p_academic_year_id USING ERRCODE = 'no_data_found';
    END IF;

    IF p_fact_kind IN ('SEMESTER_START', 'SEMESTER_END') THEN
        SELECT * INTO v_semester FROM semesters
         WHERE academic_year_id = p_academic_year_id AND sem_order = p_fact_semester_order FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Semester % not found for year %', p_fact_semester_order, p_academic_year_id
                USING ERRCODE = 'no_data_found';
        END IF;
        IF v_semester.status <> 'CLOSED' THEN
            RAISE EXCEPTION 'Semester % is not CLOSED; use ordinary editing instead', p_fact_semester_order
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CORRECTION_REQUIRES_CLOSED_SCOPE';
        END IF;
    ELSIF v_year.status <> 'CLOSED' THEN
        RAISE EXCEPTION 'Academic year is not CLOSED; use ordinary editing instead'
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CORRECTION_REQUIRES_CLOSED_SCOPE';
    END IF;

    CASE p_fact_kind
        WHEN 'SEMESTER_START' THEN
            v_original := v_semester.start_date;
            UPDATE semesters SET start_date = p_corrected_value WHERE id = v_semester.id;
        WHEN 'SEMESTER_END' THEN
            v_original := v_semester.end_date;
            UPDATE semesters SET end_date = p_corrected_value WHERE id = v_semester.id;
        WHEN 'STUDENT_RETURN' THEN
            SELECT date INTO v_original FROM student_return_days WHERE academic_year_id = p_academic_year_id;
            UPDATE student_return_days SET date = p_corrected_value WHERE academic_year_id = p_academic_year_id;
        WHEN 'HOLIDAY_OCCURRENCE' THEN
            SELECT date INTO v_original FROM holiday_occurrences
             WHERE academic_year_id = p_academic_year_id AND holiday_type_key = p_fact_holiday_type_key;
            UPDATE holiday_occurrences SET date = p_corrected_value
             WHERE academic_year_id = p_academic_year_id AND holiday_type_key = p_fact_holiday_type_key;
        WHEN 'EXAM_START' THEN
            SELECT start_date INTO v_original FROM exam_instances
             WHERE academic_year_id = p_academic_year_id AND exam_type_key = p_fact_exam_type_key;
            UPDATE exam_instances SET start_date = p_corrected_value
             WHERE academic_year_id = p_academic_year_id AND exam_type_key = p_fact_exam_type_key;
        WHEN 'EXAM_END' THEN
            SELECT end_date INTO v_original FROM exam_instances
             WHERE academic_year_id = p_academic_year_id AND exam_type_key = p_fact_exam_type_key;
            UPDATE exam_instances SET end_date = p_corrected_value
             WHERE academic_year_id = p_academic_year_id AND exam_type_key = p_fact_exam_type_key;
        WHEN 'ACADEMIC_YEAR_START' THEN
            v_original := v_year.start_date;
            UPDATE academic_years SET start_date = p_corrected_value WHERE id = p_academic_year_id;
        WHEN 'ACADEMIC_YEAR_END' THEN
            v_original := v_year.end_date;
            UPDATE academic_years SET end_date = p_corrected_value WHERE id = p_academic_year_id;
        ELSE
            RAISE EXCEPTION 'Correction not supported for fact kind %', p_fact_kind USING ERRCODE = 'check_violation';
    END CASE;

    IF v_original IS NULL THEN
        RAISE EXCEPTION 'Could not resolve the original value for %/% — nothing to correct',
            p_fact_kind, p_academic_year_id USING ERRCODE = 'no_data_found';
    END IF;

    INSERT INTO calendar_corrections (
        academic_year_id, fact_kind, fact_semester_order, fact_holiday_type_key, fact_exam_type_key,
        original_value, corrected_value, reason, performed_by
    ) VALUES (
        p_academic_year_id, p_fact_kind, p_fact_semester_order, p_fact_holiday_type_key, p_fact_exam_type_key,
        v_original, p_corrected_value, p_reason, v_actor
    ) RETURNING * INTO v_correction;

    RETURN v_correction;
END;
$$;

CREATE FUNCTION public.fn_audit_log() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_value, new_value, created_at)
        VALUES (NULLIF(current_setting('app.current_user_id', true), '')::UUID, TG_OP, TG_TABLE_NAME,
                OLD.id::TEXT, row_to_json(OLD)::JSONB, row_to_json(NEW)::JSONB, NOW());
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_value, created_at)
        VALUES (NULLIF(current_setting('app.current_user_id', true), '')::UUID, TG_OP, TG_TABLE_NAME,
                OLD.id::TEXT, row_to_json(OLD)::JSONB, NOW());
        RETURN OLD;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, new_value, created_at)
        VALUES (NULLIF(current_setting('app.current_user_id', true), '')::UUID, TG_OP, TG_TABLE_NAME,
                NEW.id::TEXT, row_to_json(NEW)::JSONB, NOW());
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;

CREATE FUNCTION public.fn_bump_calendar_config_revision(p_academic_year_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    UPDATE academic_years
       SET calendar_config_revision = calendar_config_revision + 1
     WHERE id = p_academic_year_id;
END;
$$;

CREATE FUNCTION public.fn_bump_revision_on_dependency_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_bump_calendar_config_revision(OLD.academic_year_id);
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT'
       OR NEW.active IS DISTINCT FROM OLD.active
       OR NEW.offset_days IS DISTINCT FROM OLD.offset_days
       OR NEW.anchor_kind IS DISTINCT FROM OLD.anchor_kind
       OR NEW.anchor_semester_order IS DISTINCT FROM OLD.anchor_semester_order
       OR NEW.anchor_holiday_type_key IS DISTINCT FROM OLD.anchor_holiday_type_key
       OR NEW.anchor_exam_type_key IS DISTINCT FROM OLD.anchor_exam_type_key
       OR NEW.dependent_kind IS DISTINCT FROM OLD.dependent_kind
       OR NEW.dependent_semester_order IS DISTINCT FROM OLD.dependent_semester_order
       OR NEW.dependent_holiday_type_key IS DISTINCT FROM OLD.dependent_holiday_type_key
       OR NEW.dependent_exam_type_key IS DISTINCT FROM OLD.dependent_exam_type_key THEN
        PERFORM fn_bump_calendar_config_revision(NEW.academic_year_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_bump_revision_on_exam_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_bump_calendar_config_revision(OLD.academic_year_id);
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
        PERFORM fn_bump_calendar_config_revision(NEW.academic_year_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_bump_revision_on_holiday_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_bump_calendar_config_revision(OLD.academic_year_id);
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT'
       OR NEW.date IS DISTINCT FROM OLD.date
       OR NEW.closes_school IS DISTINCT FROM OLD.closes_school
       OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
        PERFORM fn_bump_calendar_config_revision(NEW.academic_year_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_bump_revision_on_semester_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_bump_calendar_config_revision(OLD.academic_year_id);
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
        PERFORM fn_bump_calendar_config_revision(NEW.academic_year_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_bump_revision_on_student_return_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_bump_calendar_config_revision(OLD.academic_year_id);
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.date IS DISTINCT FROM OLD.date THEN
        PERFORM fn_bump_calendar_config_revision(NEW.academic_year_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_bump_revision_on_year_boundary_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
        NEW.calendar_config_revision := OLD.calendar_config_revision + 1;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_check_timeline_day_year_matches_build() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_build_year UUID;
BEGIN
    SELECT academic_year_id INTO v_build_year FROM calendar_timeline_builds WHERE id = NEW.build_id;
    IF v_build_year IS NULL THEN
        RAISE EXCEPTION 'timeline day references a build that does not exist (build_id=%)', NEW.build_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_build_year <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'timeline day academic_year_id (%) does not match its build''s academic_year_id (%)',
            NEW.academic_year_id, v_build_year
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_TIMELINE_DAY_YEAR_MISMATCH';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_create_default_semesters() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    INSERT INTO semesters (academic_year_id, sem_order, status)
    VALUES (NEW.id, 1, 'UPCOMING'), (NEW.id, 2, 'UPCOMING');
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_load_calendar_config_snapshot(p_academic_year_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_rev_before INT;
    v_rev_after INT;
    v_snapshot JSONB;
    v_attempt INT := 0;
BEGIN
    LOOP
        v_attempt := v_attempt + 1;

        SELECT calendar_config_revision INTO v_rev_before
          FROM academic_years WHERE id = p_academic_year_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Academic year % not found', p_academic_year_id USING ERRCODE = 'no_data_found';
        END IF;

        SELECT jsonb_build_object(
            'academicYear', (SELECT to_jsonb(y) FROM academic_years y WHERE y.id = p_academic_year_id),
            'semesters', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sem_order), '[]'::jsonb)
                            FROM semesters s WHERE s.academic_year_id = p_academic_year_id),
            'holidayOccurrences', (SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
                            FROM holiday_occurrences h WHERE h.academic_year_id = p_academic_year_id),
            'examInstances', (SELECT coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
                            FROM exam_instances e WHERE e.academic_year_id = p_academic_year_id),
            'studentReturn', (SELECT to_jsonb(sr) FROM student_return_days sr WHERE sr.academic_year_id = p_academic_year_id),
            'dependencies', (SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
                            FROM calendar_dependencies d WHERE d.academic_year_id = p_academic_year_id AND d.active)
        ) INTO v_snapshot;

        SELECT calendar_config_revision INTO v_rev_after
          FROM academic_years WHERE id = p_academic_year_id;

        EXIT WHEN v_rev_before = v_rev_after OR v_attempt >= 5;
    END LOOP;

    IF v_rev_before <> v_rev_after THEN
        RAISE EXCEPTION 'Configuration kept changing while reading a consistent snapshot (revision % -> % after % attempts)',
            v_rev_before, v_rev_after, v_attempt
            USING ERRCODE = 'serialization_failure', HINT = 'CALENDAR_CONFIG_SNAPSHOT_TORN';
    END IF;

    RETURN v_snapshot || jsonb_build_object('configRevision', v_rev_before);
END;
$$;

CREATE TABLE public.calendar_timeline_builds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year_id uuid NOT NULL,
    status public.timeline_build_status DEFAULT 'CANDIDATE'::public.timeline_build_status NOT NULL,
    source_config_revision integer NOT NULL,
    config_hash text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    failure_reason text
);

CREATE FUNCTION public.fn_publish_calendar_timeline(p_build_id uuid) RETURNS public.calendar_timeline_builds
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_build calendar_timeline_builds;
    v_current calendar_timeline_builds;
    v_year academic_years;
    v_expected_days INT;
    v_actual_days INT;
    v_min_date DATE;
    v_max_date DATE;
    v_mismatched_year_rows INT;
BEGIN
    IF NOT has_permission('calendar.build_timeline') THEN
        RAISE EXCEPTION 'permission denied for calendar.build_timeline' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_build FROM calendar_timeline_builds WHERE id = p_build_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Build % not found', p_build_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_build.status <> 'CANDIDATE' THEN
        RAISE EXCEPTION 'Build % is not a CANDIDATE (status=%)', p_build_id, v_build.status
            USING ERRCODE = 'check_violation';
    END IF;

    -- Lock the year row: this is both the concurrency boundary (two
    -- publishes for the same year can never interleave) AND, now, the
    -- source of truth for staleness — we read calendar_config_revision
    -- from this same locked row, not from a sibling build.
    SELECT * INTO v_year FROM academic_years WHERE id = v_build.academic_year_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Academic year % not found', v_build.academic_year_id USING ERRCODE = 'no_data_found';
    END IF;

    IF v_build.source_config_revision <> v_year.calendar_config_revision THEN
        UPDATE calendar_timeline_builds
           SET status = 'SUPERSEDED',
               failure_reason = format('Stale: year is now at revision %s; candidate was built from revision %s',
                                        v_year.calendar_config_revision, v_build.source_config_revision)
         WHERE id = v_build.id;
        RAISE EXCEPTION 'Stale build: the academic year is now at configuration revision % (candidate was built from revision %)',
            v_year.calendar_config_revision, v_build.source_config_revision
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_STALE_BUILD';
    END IF;

    -- Structural verification (fix #3). Every check below is against the
    -- database's own row counts, never against anything the caller merely
    -- asserted.
    v_expected_days := (v_year.end_date - v_year.start_date) + 1;

    SELECT count(*), min(date), max(date)
      INTO v_actual_days, v_min_date, v_max_date
      FROM calendar_timeline_days WHERE build_id = v_build.id;

    SELECT count(*) INTO v_mismatched_year_rows
      FROM calendar_timeline_days WHERE build_id = v_build.id AND academic_year_id <> v_build.academic_year_id;

    IF v_mismatched_year_rows > 0 THEN
        UPDATE calendar_timeline_builds SET status = 'FAILED',
               failure_reason = format('%s timeline day row(s) reference a different academic_year_id than this build', v_mismatched_year_rows)
         WHERE id = v_build.id;
        RAISE EXCEPTION 'Candidate has % timeline day row(s) whose academic_year_id does not match the build''s year',
            v_mismatched_year_rows
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_TIMELINE_DAY_YEAR_MISMATCH';
    END IF;

    IF v_actual_days IS DISTINCT FROM v_expected_days THEN
        UPDATE calendar_timeline_builds SET status = 'FAILED',
               failure_reason = format('Expected %s daily rows (year span), found %s', v_expected_days, coalesce(v_actual_days, 0))
         WHERE id = v_build.id;
        RAISE EXCEPTION 'Candidate is incomplete: expected % daily rows for the year''s span, found %',
            v_expected_days, coalesce(v_actual_days, 0)
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CANDIDATE_INCOMPLETE';
    END IF;

    IF v_min_date IS DISTINCT FROM v_year.start_date OR v_max_date IS DISTINCT FROM v_year.end_date THEN
        UPDATE calendar_timeline_builds SET status = 'FAILED',
               failure_reason = format('Candidate spans %s..%s, year requires %s..%s', v_min_date, v_max_date, v_year.start_date, v_year.end_date)
         WHERE id = v_build.id;
        RAISE EXCEPTION 'Candidate does not span the full academic year: got %..%, need %..%',
            v_min_date, v_max_date, v_year.start_date, v_year.end_date
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CANDIDATE_INCOMPLETE';
    END IF;
    -- Note: v_actual_days = v_expected_days, min = start_date, max =
    -- end_date, and (build_id, date) is UNIQUE on the table — together
    -- these mathematically guarantee the full contiguous date range is
    -- present exactly once each, with no separate gap/duplicate scan
    -- needed.

    SELECT * INTO v_current FROM calendar_timeline_builds
     WHERE academic_year_id = v_build.academic_year_id AND status = 'CURRENT'
     FOR UPDATE;

    IF FOUND THEN
        UPDATE calendar_timeline_builds SET status = 'SUPERSEDED' WHERE id = v_current.id;
    END IF;

    UPDATE calendar_timeline_builds
       SET status = 'CURRENT', published_at = NOW()
     WHERE id = v_build.id
     RETURNING * INTO v_build;

    RETURN v_build;
END;
$$;

CREATE FUNCTION public.fn_record_failed_build(p_build_id uuid, p_reason text) RETURNS public.calendar_timeline_builds
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_build calendar_timeline_builds;
BEGIN
    IF NOT has_permission('calendar.build_timeline') THEN
        RAISE EXCEPTION 'permission denied for calendar.build_timeline' USING ERRCODE = '42501';
    END IF;

    UPDATE calendar_timeline_builds
       SET status = 'FAILED', failure_reason = p_reason
     WHERE id = p_build_id AND status = 'CANDIDATE'
     RETURNING * INTO v_build;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Build % not found or not a CANDIDATE', p_build_id USING ERRCODE = 'no_data_found';
    END IF;
    RETURN v_build;
END;
$$;

CREATE TABLE public.academic_years (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    year_ec integer NOT NULL,
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_default_boundary boolean DEFAULT true NOT NULL,
    status public.academic_year_status DEFAULT 'PREPARING'::public.academic_year_status NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    calendar_config_revision integer DEFAULT 1 NOT NULL,
    ministry_target_days smallint,
    CONSTRAINT academic_years_ministry_target_days_check CHECK (((ministry_target_days >= 1) AND (ministry_target_days <= 366))),
    CONSTRAINT academic_years_year_ec_check CHECK (((year_ec >= 1900) AND (year_ec <= 2500))),
    CONSTRAINT chk_academic_year_range CHECK ((start_date <= end_date))
);

CREATE FUNCTION public.fn_transition_academic_year_status(p_year_id uuid, p_to public.academic_year_status) RETURNS public.academic_years
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_year academic_years;
    v_valid BOOLEAN;
    v_incomplete_semesters INT;
BEGIN
    IF NOT has_permission('calendar.manage') THEN
        RAISE EXCEPTION 'permission denied for calendar.manage' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_year FROM academic_years WHERE id = p_year_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Academic year % not found', p_year_id USING ERRCODE = 'no_data_found';
    END IF;

    v_valid := (v_year.status = 'PREPARING' AND p_to = 'READY')
            OR (v_year.status = 'READY' AND p_to = 'ACTIVE')
            OR (v_year.status = 'ACTIVE' AND p_to = 'CLOSED');
    IF NOT v_valid THEN
        RAISE EXCEPTION 'Invalid academic year transition: % -> %', v_year.status, p_to
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_INVALID_LIFECYCLE_TRANSITION';
    END IF;

    IF p_to IN ('READY', 'ACTIVE') THEN
        SELECT count(*) INTO v_incomplete_semesters
          FROM semesters WHERE academic_year_id = p_year_id AND (start_date IS NULL OR end_date IS NULL);
        IF v_incomplete_semesters > 0 THEN
            RAISE EXCEPTION '% semester(s) still have no dates entered; the calendar cannot become % yet', v_incomplete_semesters, p_to
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_YEAR_NOT_READY';
        END IF;
    END IF;

    UPDATE academic_years SET status = p_to WHERE id = p_year_id RETURNING * INTO v_year;
    RETURN v_year;
END;
$$;

CREATE TABLE public.semesters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year_id uuid NOT NULL,
    sem_order smallint NOT NULL,
    start_date date,
    end_date date,
    status public.semester_status DEFAULT 'UPCOMING'::public.semester_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_semester_range CHECK (((start_date IS NULL) OR (end_date IS NULL) OR (start_date <= end_date))),
    CONSTRAINT semesters_sem_order_check CHECK ((sem_order = ANY (ARRAY[1, 2])))
);

CREATE FUNCTION public.fn_transition_semester_status(p_semester_id uuid, p_to public.semester_status) RETURNS public.semesters
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_sem semesters;
    v_valid BOOLEAN;
BEGIN
    IF NOT has_permission('calendar.manage') THEN
        RAISE EXCEPTION 'permission denied for calendar.manage' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_sem FROM semesters WHERE id = p_semester_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Semester % not found', p_semester_id USING ERRCODE = 'no_data_found';
    END IF;

    v_valid := (v_sem.status = 'UPCOMING' AND p_to = 'ACTIVE')
            OR (v_sem.status = 'ACTIVE' AND p_to = 'CLOSED');
    IF NOT v_valid THEN
        RAISE EXCEPTION 'Invalid semester transition: % -> %', v_sem.status, p_to
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_INVALID_LIFECYCLE_TRANSITION';
    END IF;

    IF p_to = 'ACTIVE' AND (v_sem.start_date IS NULL OR v_sem.end_date IS NULL) THEN
        RAISE EXCEPTION 'Semester % has no dates entered; it cannot become ACTIVE yet', v_sem.sem_order
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_YEAR_NOT_READY';
    END IF;

    UPDATE semesters SET status = p_to WHERE id = p_semester_id RETURNING * INTO v_sem;
    RETURN v_sem;
END;
$$;

CREATE FUNCTION public.fn_update_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_validate_calendar_dependency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_cycle_found BOOLEAN;
    v_conflict_count INT;
BEGIN
    PERFORM fn_validate_fact_ref(NEW.anchor_kind, NEW.anchor_semester_order, NEW.anchor_holiday_type_key, NEW.anchor_exam_type_key, 'anchor');
    PERFORM fn_validate_fact_ref(NEW.dependent_kind, NEW.dependent_semester_order, NEW.dependent_holiday_type_key, NEW.dependent_exam_type_key, 'dependent');

    IF NEW.anchor_kind = NEW.dependent_kind
       AND NEW.anchor_semester_order IS NOT DISTINCT FROM NEW.dependent_semester_order
       AND NEW.anchor_holiday_type_key IS NOT DISTINCT FROM NEW.dependent_holiday_type_key
       AND NEW.anchor_exam_type_key IS NOT DISTINCT FROM NEW.dependent_exam_type_key THEN
        RAISE EXCEPTION 'A calendar fact cannot depend on itself'
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CIRCULAR_DEPENDENCY';
    END IF;

    IF NOT NEW.active THEN
        RETURN NEW; -- an inactive rule can't contribute to a live cycle or conflict
    END IF;

    -- Fix #12: does another ACTIVE rule (other than this row, on UPDATE)
    -- already target the same dependent?
    SELECT count(*) INTO v_conflict_count
      FROM calendar_dependencies
     WHERE academic_year_id = NEW.academic_year_id AND active AND id IS DISTINCT FROM NEW.id
       AND dependent_kind = NEW.dependent_kind
       AND dependent_semester_order IS NOT DISTINCT FROM NEW.dependent_semester_order
       AND dependent_holiday_type_key IS NOT DISTINCT FROM NEW.dependent_holiday_type_key
       AND dependent_exam_type_key IS NOT DISTINCT FROM NEW.dependent_exam_type_key;
    IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'Fact % already has % active incoming dependency(ies) — a fact must have exactly one authoritative source', NEW.dependent_kind, v_conflict_count
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CONFLICTING_DEPENDENCY';
    END IF;

    -- Cycle check: walk dependent -> anchor edges starting at NEW.dependent;
    -- if NEW.anchor is reachable, this edge would close a loop (mission
    -- §34 — mirrors dependencyGraph.ts's wouldCreateCycle()).
    WITH RECURSIVE reachable AS (
        SELECT dependent_kind AS k, dependent_semester_order AS so,
               dependent_holiday_type_key AS hk, dependent_exam_type_key AS ek
        FROM calendar_dependencies
        WHERE academic_year_id = NEW.academic_year_id AND active
          AND anchor_kind = NEW.dependent_kind
          AND anchor_semester_order IS NOT DISTINCT FROM NEW.dependent_semester_order
          AND anchor_holiday_type_key IS NOT DISTINCT FROM NEW.dependent_holiday_type_key
          AND anchor_exam_type_key IS NOT DISTINCT FROM NEW.dependent_exam_type_key
        UNION
        SELECT cd.dependent_kind, cd.dependent_semester_order, cd.dependent_holiday_type_key, cd.dependent_exam_type_key
        FROM calendar_dependencies cd
        JOIN reachable r
          ON cd.academic_year_id = NEW.academic_year_id AND cd.active
         AND cd.anchor_kind = r.k
         AND cd.anchor_semester_order IS NOT DISTINCT FROM r.so
         AND cd.anchor_holiday_type_key IS NOT DISTINCT FROM r.hk
         AND cd.anchor_exam_type_key IS NOT DISTINCT FROM r.ek
    )
    SELECT EXISTS (
        SELECT 1 FROM reachable
        WHERE k = NEW.anchor_kind
          AND so IS NOT DISTINCT FROM NEW.anchor_semester_order
          AND hk IS NOT DISTINCT FROM NEW.anchor_holiday_type_key
          AND ek IS NOT DISTINCT FROM NEW.anchor_exam_type_key
    ) INTO v_cycle_found;

    IF v_cycle_found THEN
        RAISE EXCEPTION 'Circular calendar dependency detected involving %', NEW.dependent_kind
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CIRCULAR_DEPENDENCY';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_validate_exam_placement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    d DATE;
    monday DATE;
    holiday_date DATE;
BEGIN
    d := NEW.start_date;
    WHILE d <= NEW.end_date LOOP
        IF EXTRACT(DOW FROM d) IN (0, 6) THEN
            RAISE EXCEPTION 'Exam % window includes weekend date %', NEW.exam_type_key, d
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_EXAM_ON_WEEKEND';
        END IF;

        IF EXISTS (
            SELECT 1 FROM holiday_occurrences h
            WHERE h.academic_year_id = NEW.academic_year_id
              AND h.date = d
              AND h.closes_school
        ) THEN
            RAISE EXCEPTION 'Exam % window includes a school-closing holiday on %', NEW.exam_type_key, d
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_EXAM_ON_CLOSING_HOLIDAY';
        END IF;

        d := d + 1;
    END LOOP;

    d := NEW.start_date;
    WHILE d <= NEW.end_date LOOP
        IF EXTRACT(DOW FROM d) NOT IN (0, 6) THEN
            monday := d - (EXTRACT(ISODOW FROM d)::int - 1);
            SELECT h.date INTO holiday_date
            FROM holiday_occurrences h
            WHERE h.academic_year_id = NEW.academic_year_id
              AND h.closes_school
              AND h.date BETWEEN monday AND monday + 4
              AND (h.date < NEW.start_date OR h.date > NEW.end_date)
            LIMIT 1;
            IF holiday_date IS NOT NULL THEN
                RAISE EXCEPTION 'Exam % is in a week with a school-closing holiday on %', NEW.exam_type_key, holiday_date
                    USING ERRCODE = 'check_violation', HINT = 'CALENDAR_EXAM_IN_HOLIDAY_WEEK';
            END IF;
        END IF;
        d := d + 1;
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_validate_fact_ref(p_kind public.calendar_fact_kind, p_semester_order smallint, p_holiday_key public.holiday_type_key, p_exam_key public.exam_type_key, p_label text) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    CASE p_kind
        WHEN 'SEMESTER_START', 'SEMESTER_END' THEN
            IF p_semester_order IS NULL OR p_holiday_key IS NOT NULL OR p_exam_key IS NOT NULL THEN
                RAISE EXCEPTION '% fact ref of kind % must set only semester_order', p_label, p_kind
                    USING ERRCODE = 'check_violation';
            END IF;
        WHEN 'HOLIDAY_OCCURRENCE' THEN
            IF p_holiday_key IS NULL OR p_semester_order IS NOT NULL OR p_exam_key IS NOT NULL THEN
                RAISE EXCEPTION '% fact ref of kind % must set only holiday_type_key', p_label, p_kind
                    USING ERRCODE = 'check_violation';
            END IF;
        WHEN 'EXAM_START', 'EXAM_END' THEN
            IF p_exam_key IS NULL OR p_semester_order IS NOT NULL OR p_holiday_key IS NOT NULL THEN
                RAISE EXCEPTION '% fact ref of kind % must set only exam_type_key', p_label, p_kind
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSE -- ACADEMIC_YEAR_START, ACADEMIC_YEAR_END, STUDENT_RETURN
            IF p_semester_order IS NOT NULL OR p_holiday_key IS NOT NULL OR p_exam_key IS NOT NULL THEN
                RAISE EXCEPTION '% fact ref of kind % must set no companion columns', p_label, p_kind
                    USING ERRCODE = 'check_violation';
            END IF;
    END CASE;
END;
$$;

CREATE FUNCTION public.fn_validate_holiday_occurrence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_movable BOOLEAN;
BEGIN
    SELECT movable INTO v_movable FROM holiday_types WHERE key = NEW.holiday_type_key;
    IF v_movable AND NEW.source <> 'ADMIN_ENTERED' THEN
        RAISE EXCEPTION 'Movable holiday % must be entered manually (source=ADMIN_ENTERED), got %',
            NEW.holiday_type_key, NEW.source
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_MOVABLE_HOLIDAY_REQUIRES_MANUAL_DATE';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_validate_semester_ordering() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_other semesters;
BEGIN
    IF NEW.start_date IS NULL AND NEW.end_date IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.sem_order = 2 AND NEW.start_date IS NOT NULL THEN
        SELECT * INTO v_other FROM semesters
         WHERE academic_year_id = NEW.academic_year_id AND sem_order = 1;
        IF FOUND AND v_other.end_date IS NOT NULL AND NEW.start_date < v_other.end_date THEN
            RAISE EXCEPTION 'Semester 2 start (%) is before Semester 1 end (%)', NEW.start_date, v_other.end_date
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_SEMESTERS_OVERLAP';
        END IF;
    ELSIF NEW.sem_order = 1 AND NEW.end_date IS NOT NULL THEN
        SELECT * INTO v_other FROM semesters
         WHERE academic_year_id = NEW.academic_year_id AND sem_order = 2;
        IF FOUND AND v_other.start_date IS NOT NULL AND v_other.start_date < NEW.end_date THEN
            RAISE EXCEPTION 'Semester 2 start (%) is before Semester 1 end (%)', v_other.start_date, NEW.end_date
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_SEMESTERS_OVERLAP';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.has_permission(p_permission_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE u.supabase_uid = auth.uid()
      AND u.deleted_at IS NULL
      AND u.status = 'ACTIVE'
      AND (p.resource || '.' || p.action) = p_permission_key
  ) OR EXISTS (
    SELECT 1
    FROM users u
    JOIN user_permissions up ON up.user_id = u.id
    JOIN permissions p ON p.id = up.permission_id
    WHERE u.supabase_uid = auth.uid()
      AND u.deleted_at IS NULL
      AND u.status = 'ACTIVE'
      AND (p.resource || '.' || p.action) = p_permission_key
  );
$$;

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text,
    old_value jsonb,
    new_value jsonb,
    reason text,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.calendar_dependencies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year_id uuid NOT NULL,
    anchor_kind public.calendar_fact_kind NOT NULL,
    anchor_semester_order smallint,
    anchor_holiday_type_key public.holiday_type_key,
    anchor_exam_type_key public.exam_type_key,
    dependent_kind public.calendar_fact_kind NOT NULL,
    dependent_semester_order smallint,
    dependent_holiday_type_key public.holiday_type_key,
    dependent_exam_type_key public.exam_type_key,
    offset_days integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_dependencies_anchor_semester_order_check CHECK ((anchor_semester_order = ANY (ARRAY[1, 2]))),
    CONSTRAINT calendar_dependencies_dependent_semester_order_check CHECK ((dependent_semester_order = ANY (ARRAY[1, 2])))
);

CREATE TABLE public.calendar_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year_id uuid NOT NULL,
    fact_kind public.calendar_fact_kind NOT NULL,
    fact_semester_order smallint,
    fact_holiday_type_key public.holiday_type_key,
    fact_exam_type_key public.exam_type_key,
    threshold_days smallint NOT NULL,
    trigger_date date NOT NULL,
    due_date date NOT NULL,
    status public.calendar_reminder_status DEFAULT 'PENDING'::public.calendar_reminder_status NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_reminders_fact_semester_order_check CHECK ((fact_semester_order = ANY (ARRAY[1, 2]))),
    CONSTRAINT calendar_reminders_threshold_days_check CHECK ((threshold_days = ANY (ARRAY[30, 15, 5])))
);

CREATE TABLE public.calendar_timeline_days (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    build_id uuid NOT NULL,
    academic_year_id uuid NOT NULL,
    date date NOT NULL,
    ethiopian_year integer NOT NULL,
    ethiopian_month smallint NOT NULL,
    ethiopian_day smallint NOT NULL,
    weekday smallint NOT NULL,
    is_weekend boolean NOT NULL,
    semester_order smallint,
    is_student_return boolean DEFAULT false NOT NULL,
    is_semester_break boolean DEFAULT false NOT NULL,
    school_open boolean NOT NULL,
    teaching_day boolean NOT NULL,
    attendance_available boolean NOT NULL,
    grade12_attendance_available boolean NOT NULL,
    reasons text[] DEFAULT '{}'::text[] NOT NULL,
    holidays jsonb DEFAULT '[]'::jsonb NOT NULL,
    holiday_closure boolean DEFAULT false NOT NULL,
    exams jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT calendar_timeline_days_ethiopian_day_check CHECK (((ethiopian_day >= 1) AND (ethiopian_day <= 30))),
    CONSTRAINT calendar_timeline_days_ethiopian_month_check CHECK (((ethiopian_month >= 1) AND (ethiopian_month <= 13))),
    CONSTRAINT calendar_timeline_days_semester_order_check CHECK ((semester_order = ANY (ARRAY[1, 2]))),
    CONSTRAINT calendar_timeline_days_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);

CREATE TABLE public.calendar_validation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year_id uuid NOT NULL,
    ran_at timestamp with time zone DEFAULT now() NOT NULL,
    missing_count integer NOT NULL,
    error_count integer NOT NULL,
    warning_count integer NOT NULL,
    information_count integer NOT NULL,
    issues jsonb NOT NULL
);

CREATE TABLE public.exam_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year_id uuid NOT NULL,
    exam_type_key public.exam_type_key NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_exam_range CHECK ((start_date <= end_date))
);

CREATE TABLE public.exam_types (
    key public.exam_type_key NOT NULL,
    name text NOT NULL,
    semester_order smallint,
    closes_school boolean NOT NULL,
    grade_scope public.exam_grade_scope NOT NULL,
    CONSTRAINT exam_types_semester_order_check CHECK ((semester_order = ANY (ARRAY[1, 2])))
);

CREATE TABLE public.holiday_occurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year_id uuid NOT NULL,
    holiday_type_key public.holiday_type_key NOT NULL,
    date date,
    closes_school boolean DEFAULT true NOT NULL,
    source public.holiday_source NOT NULL,
    confirmed_by uuid,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_holiday_date_or_not_observed CHECK (((date IS NOT NULL) OR (closes_school = false)))
);

CREATE TABLE public.holiday_types (
    key public.holiday_type_key NOT NULL,
    name text NOT NULL,
    movable boolean NOT NULL,
    fixed_month smallint,
    fixed_day smallint,
    CONSTRAINT chk_fixed_holiday_has_date CHECK (((movable AND (fixed_month IS NULL) AND (fixed_day IS NULL)) OR ((NOT movable) AND (fixed_month IS NOT NULL) AND (fixed_day IS NOT NULL)))),
    CONSTRAINT holiday_types_fixed_day_check CHECK (((fixed_day >= 1) AND (fixed_day <= 30))),
    CONSTRAINT holiday_types_fixed_month_check CHECK (((fixed_month >= 1) AND (fixed_month <= 13)))
);

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource text NOT NULL,
    action text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT permissions_action_check CHECK ((btrim(action) <> ''::text)),
    CONSTRAINT permissions_resource_check CHECK ((btrim(resource) <> ''::text))
);

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roles_name_check CHECK ((btrim(name) <> ''::text))
);

CREATE TABLE public.student_return_days (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year_id uuid NOT NULL,
    date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_permissions (
    user_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_roles (
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supabase_uid uuid NOT NULL,
    full_name text NOT NULL,
    user_type text DEFAULT 'ADMIN'::text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_full_name_check CHECK ((btrim(full_name) <> ''::text)),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text])))
);

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_year_ec_key UNIQUE (year_ec);

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_corrections
    ADD CONSTRAINT calendar_corrections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_dependencies
    ADD CONSTRAINT calendar_dependencies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_reminders
    ADD CONSTRAINT calendar_reminders_academic_year_id_fact_kind_fact_semester_key UNIQUE (academic_year_id, fact_kind, fact_semester_order, fact_holiday_type_key, fact_exam_type_key, threshold_days);

ALTER TABLE ONLY public.calendar_reminders
    ADD CONSTRAINT calendar_reminders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_timeline_builds
    ADD CONSTRAINT calendar_timeline_builds_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_timeline_days
    ADD CONSTRAINT calendar_timeline_days_build_id_date_key UNIQUE (build_id, date);

ALTER TABLE ONLY public.calendar_timeline_days
    ADD CONSTRAINT calendar_timeline_days_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_validation_runs
    ADD CONSTRAINT calendar_validation_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.exam_instances
    ADD CONSTRAINT exam_instances_academic_year_id_exam_type_key_key UNIQUE (academic_year_id, exam_type_key);

ALTER TABLE ONLY public.exam_instances
    ADD CONSTRAINT exam_instances_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.exam_types
    ADD CONSTRAINT exam_types_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.holiday_occurrences
    ADD CONSTRAINT holiday_occurrences_academic_year_id_holiday_type_key_key UNIQUE (academic_year_id, holiday_type_key);

ALTER TABLE ONLY public.holiday_occurrences
    ADD CONSTRAINT holiday_occurrences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.holiday_types
    ADD CONSTRAINT holiday_types_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_resource_action_key UNIQUE (resource, action);

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.semesters
    ADD CONSTRAINT semesters_academic_year_id_sem_order_key UNIQUE (academic_year_id, sem_order);

ALTER TABLE ONLY public.semesters
    ADD CONSTRAINT semesters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_return_days
    ADD CONSTRAINT student_return_days_academic_year_id_key UNIQUE (academic_year_id);

ALTER TABLE ONLY public.student_return_days
    ADD CONSTRAINT student_return_days_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (user_id, permission_id);

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_supabase_uid_key UNIQUE (supabase_uid);

CREATE UNIQUE INDEX idx_academic_years_one_active ON public.academic_years USING btree ((true)) WHERE (status = 'ACTIVE'::public.academic_year_status);

CREATE INDEX idx_academic_years_status ON public.academic_years USING btree (status);

CREATE INDEX idx_audit_logs_actor_id ON public.audit_logs USING btree (actor_id);

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);

CREATE INDEX idx_audit_logs_resource ON public.audit_logs USING btree (resource_type, resource_id);

CREATE INDEX idx_calendar_corrections_year ON public.calendar_corrections USING btree (academic_year_id, performed_at DESC);

CREATE INDEX idx_calendar_dependencies_anchor ON public.calendar_dependencies USING btree (academic_year_id, anchor_kind, anchor_semester_order, anchor_holiday_type_key, anchor_exam_type_key) WHERE active;

CREATE INDEX idx_calendar_dependencies_year ON public.calendar_dependencies USING btree (academic_year_id) WHERE active;

CREATE INDEX idx_calendar_reminders_due_today ON public.calendar_reminders USING btree (trigger_date) WHERE (status = 'PENDING'::public.calendar_reminder_status);

CREATE INDEX idx_exam_instances_year_dates ON public.exam_instances USING btree (academic_year_id, start_date, end_date);

CREATE INDEX idx_holiday_occurrences_year_date ON public.holiday_occurrences USING btree (academic_year_id, date);

CREATE UNIQUE INDEX idx_one_current_build_per_year ON public.calendar_timeline_builds USING btree (academic_year_id) WHERE (status = 'CURRENT'::public.timeline_build_status);

CREATE INDEX idx_role_permissions_permission_id ON public.role_permissions USING btree (permission_id);

CREATE INDEX idx_semesters_year ON public.semesters USING btree (academic_year_id);

CREATE INDEX idx_timeline_builds_year_revision ON public.calendar_timeline_builds USING btree (academic_year_id, source_config_revision DESC);

CREATE INDEX idx_timeline_days_build ON public.calendar_timeline_days USING btree (build_id);

CREATE INDEX idx_timeline_days_year_date ON public.calendar_timeline_days USING btree (academic_year_id, date);

CREATE INDEX idx_user_permissions_permission_id ON public.user_permissions USING btree (permission_id);

CREATE INDEX idx_user_roles_role_id ON public.user_roles USING btree (role_id);

CREATE INDEX idx_users_not_deleted ON public.users USING btree (id) WHERE (deleted_at IS NULL);

CREATE INDEX idx_users_status ON public.users USING btree (status);

CREATE INDEX idx_validation_runs_year_time ON public.calendar_validation_runs USING btree (academic_year_id, ran_at DESC);

CREATE TRIGGER trg_academic_years_audit AFTER INSERT OR DELETE OR UPDATE ON public.academic_years FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

CREATE TRIGGER trg_academic_years_updated_at BEFORE UPDATE ON public.academic_years FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_bump_revision_on_dependency_change AFTER INSERT OR DELETE OR UPDATE ON public.calendar_dependencies FOR EACH ROW EXECUTE FUNCTION public.fn_bump_revision_on_dependency_change();

CREATE TRIGGER trg_bump_revision_on_exam_change AFTER INSERT OR DELETE OR UPDATE ON public.exam_instances FOR EACH ROW EXECUTE FUNCTION public.fn_bump_revision_on_exam_change();

CREATE TRIGGER trg_bump_revision_on_holiday_change AFTER INSERT OR DELETE OR UPDATE ON public.holiday_occurrences FOR EACH ROW EXECUTE FUNCTION public.fn_bump_revision_on_holiday_change();

CREATE TRIGGER trg_bump_revision_on_semester_change AFTER INSERT OR DELETE OR UPDATE ON public.semesters FOR EACH ROW EXECUTE FUNCTION public.fn_bump_revision_on_semester_change();

CREATE TRIGGER trg_bump_revision_on_student_return_change AFTER INSERT OR DELETE OR UPDATE ON public.student_return_days FOR EACH ROW EXECUTE FUNCTION public.fn_bump_revision_on_student_return_change();

CREATE TRIGGER trg_bump_revision_on_year_boundary_change BEFORE UPDATE ON public.academic_years FOR EACH ROW EXECUTE FUNCTION public.fn_bump_revision_on_year_boundary_change();

CREATE TRIGGER trg_calendar_dependencies_validate BEFORE INSERT OR UPDATE ON public.calendar_dependencies FOR EACH ROW EXECUTE FUNCTION public.fn_validate_calendar_dependency();

CREATE TRIGGER trg_check_timeline_day_year_matches_build BEFORE INSERT OR UPDATE ON public.calendar_timeline_days FOR EACH ROW EXECUTE FUNCTION public.fn_check_timeline_day_year_matches_build();

CREATE TRIGGER trg_create_default_semesters AFTER INSERT ON public.academic_years FOR EACH ROW EXECUTE FUNCTION public.fn_create_default_semesters();

CREATE TRIGGER trg_exam_instances_audit AFTER INSERT OR DELETE OR UPDATE ON public.exam_instances FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

CREATE TRIGGER trg_exam_instances_updated_at BEFORE UPDATE ON public.exam_instances FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_exam_instances_validate BEFORE INSERT OR UPDATE ON public.exam_instances FOR EACH ROW EXECUTE FUNCTION public.fn_validate_exam_placement();

CREATE TRIGGER trg_holiday_occurrences_audit AFTER INSERT OR DELETE OR UPDATE ON public.holiday_occurrences FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

CREATE TRIGGER trg_holiday_occurrences_updated_at BEFORE UPDATE ON public.holiday_occurrences FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_holiday_occurrences_validate BEFORE INSERT OR UPDATE ON public.holiday_occurrences FOR EACH ROW EXECUTE FUNCTION public.fn_validate_holiday_occurrence();

CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_semesters_audit AFTER INSERT OR DELETE OR UPDATE ON public.semesters FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

CREATE TRIGGER trg_semesters_updated_at BEFORE UPDATE ON public.semesters FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_semesters_validate_ordering BEFORE INSERT OR UPDATE ON public.semesters FOR EACH ROW EXECUTE FUNCTION public.fn_validate_semester_ordering();

CREATE TRIGGER trg_student_return_days_audit AFTER INSERT OR DELETE OR UPDATE ON public.student_return_days FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

CREATE TRIGGER trg_student_return_days_updated_at BEFORE UPDATE ON public.student_return_days FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.calendar_corrections
    ADD CONSTRAINT calendar_corrections_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_corrections
    ADD CONSTRAINT calendar_corrections_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.calendar_dependencies
    ADD CONSTRAINT calendar_dependencies_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_dependencies
    ADD CONSTRAINT calendar_dependencies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.calendar_reminders
    ADD CONSTRAINT calendar_reminders_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_timeline_builds
    ADD CONSTRAINT calendar_timeline_builds_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_timeline_builds
    ADD CONSTRAINT calendar_timeline_builds_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.calendar_timeline_days
    ADD CONSTRAINT calendar_timeline_days_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_timeline_days
    ADD CONSTRAINT calendar_timeline_days_build_id_fkey FOREIGN KEY (build_id) REFERENCES public.calendar_timeline_builds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_validation_runs
    ADD CONSTRAINT calendar_validation_runs_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.exam_instances
    ADD CONSTRAINT exam_instances_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.exam_instances
    ADD CONSTRAINT exam_instances_exam_type_key_fkey FOREIGN KEY (exam_type_key) REFERENCES public.exam_types(key);

ALTER TABLE ONLY public.holiday_occurrences
    ADD CONSTRAINT holiday_occurrences_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.holiday_occurrences
    ADD CONSTRAINT holiday_occurrences_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.holiday_occurrences
    ADD CONSTRAINT holiday_occurrences_holiday_type_key_fkey FOREIGN KEY (holiday_type_key) REFERENCES public.holiday_types(key);

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.semesters
    ADD CONSTRAINT semesters_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_return_days
    ADD CONSTRAINT student_return_days_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_supabase_uid_fkey FOREIGN KEY (supabase_uid) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

CREATE POLICY academic_years_insert_manage ON public.academic_years FOR INSERT TO authenticated WITH CHECK (public.has_permission('calendar.manage'::text));

CREATE POLICY academic_years_select_authenticated ON public.academic_years FOR SELECT TO authenticated USING (public.has_permission('calendar.view'::text));

CREATE POLICY academic_years_update_manage ON public.academic_years FOR UPDATE TO authenticated USING ((public.has_permission('calendar.manage'::text) AND (status <> 'CLOSED'::public.academic_year_status))) WITH CHECK (public.has_permission('calendar.manage'::text));

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calendar_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_corrections_select_authenticated ON public.calendar_corrections FOR SELECT TO authenticated USING (public.has_permission('calendar.view'::text));

ALTER TABLE public.calendar_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_dependencies_insert_manage ON public.calendar_dependencies FOR INSERT TO authenticated WITH CHECK ((public.has_permission('calendar.manage_dependencies'::text) AND (( SELECT academic_years.status
   FROM public.academic_years
  WHERE (academic_years.id = calendar_dependencies.academic_year_id)) <> 'CLOSED'::public.academic_year_status)));

CREATE POLICY calendar_dependencies_select_authenticated ON public.calendar_dependencies FOR SELECT TO authenticated USING (public.has_permission('calendar.view'::text));

CREATE POLICY calendar_dependencies_update_manage ON public.calendar_dependencies FOR UPDATE TO authenticated USING (public.has_permission('calendar.manage_dependencies'::text)) WITH CHECK (public.has_permission('calendar.manage_dependencies'::text));

ALTER TABLE public.calendar_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_reminders_select_authenticated ON public.calendar_reminders FOR SELECT TO authenticated USING (public.has_permission('calendar.view'::text));

ALTER TABLE public.calendar_timeline_builds ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_timeline_builds_insert_manage ON public.calendar_timeline_builds FOR INSERT TO authenticated WITH CHECK ((public.has_permission('calendar.build_timeline'::text) AND (status = 'CANDIDATE'::public.timeline_build_status)));

CREATE POLICY calendar_timeline_builds_select_authenticated ON public.calendar_timeline_builds FOR SELECT TO authenticated USING (public.has_permission('calendar.view'::text));

ALTER TABLE public.calendar_timeline_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_timeline_days_insert_manage ON public.calendar_timeline_days FOR INSERT TO authenticated WITH CHECK ((public.has_permission('calendar.build_timeline'::text) AND (EXISTS ( SELECT 1
   FROM public.calendar_timeline_builds b
  WHERE ((b.id = calendar_timeline_days.build_id) AND (b.status = 'CANDIDATE'::public.timeline_build_status))))));

CREATE POLICY calendar_timeline_days_select_authenticated ON public.calendar_timeline_days FOR SELECT TO authenticated USING (public.has_permission('calendar.view'::text));

ALTER TABLE public.calendar_validation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_validation_runs_insert_manage ON public.calendar_validation_runs FOR INSERT TO authenticated WITH CHECK (public.has_permission('calendar.view'::text));

CREATE POLICY calendar_validation_runs_select_authenticated ON public.calendar_validation_runs FOR SELECT TO authenticated USING (public.has_permission('calendar.view'::text));

ALTER TABLE public.exam_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY exam_instances_delete_manage ON public.exam_instances FOR DELETE TO authenticated USING ((public.has_permission('calendar.manage_exams'::text) AND (EXISTS ( SELECT 1
   FROM public.academic_years y
  WHERE ((y.id = exam_instances.academic_year_id) AND (y.status <> 'CLOSED'::public.academic_year_status))))));

CREATE POLICY exam_instances_insert_manage ON public.exam_instances FOR INSERT TO authenticated WITH CHECK ((public.has_permission('calendar.manage_exams'::text) AND (( SELECT academic_years.status
   FROM public.academic_years
  WHERE (academic_years.id = exam_instances.academic_year_id)) <> 'CLOSED'::public.academic_year_status)));

CREATE POLICY exam_instances_select_authenticated ON public.exam_instances FOR SELECT TO authenticated USING (public.has_permission('calendar.view'::text));

CREATE POLICY exam_instances_update_manage ON public.exam_instances FOR UPDATE TO authenticated USING ((public.has_permission('calendar.manage_exams'::text) AND (EXISTS ( SELECT 1
   FROM public.academic_years y
  WHERE ((y.id = exam_instances.academic_year_id) AND (y.status <> 'CLOSED'::public.academic_year_status)))))) WITH CHECK (public.has_permission('calendar.manage_exams'::text));

ALTER TABLE public.exam_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY exam_types_select_authenticated ON public.exam_types FOR SELECT TO authenticated USING (true);

ALTER TABLE public.holiday_occurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY holiday_occurrences_delete_manage ON public.holiday_occurrences FOR DELETE TO authenticated USING ((public.has_permission('calendar.manage_holidays'::text) AND (EXISTS ( SELECT 1
   FROM public.academic_years y
  WHERE ((y.id = holiday_occurrences.academic_year_id) AND (y.status <> 'CLOSED'::public.academic_year_status))))));

CREATE POLICY holiday_occurrences_insert_manage ON public.holiday_occurrences FOR INSERT TO authenticated WITH CHECK ((public.has_permission('calendar.manage_holidays'::text) AND (( SELECT academic_years.status
   FROM public.academic_years
  WHERE (academic_years.id = holiday_occurrences.academic_year_id)) <> 'CLOSED'::public.academic_year_status)));

CREATE POLICY holiday_occurrences_select_authenticated ON public.holiday_occurrences FOR SELECT TO authenticated USING (public.has_permission('calendar.view'::text));

CREATE POLICY holiday_occurrences_update_manage ON public.holiday_occurrences FOR UPDATE TO authenticated USING ((public.has_permission('calendar.manage_holidays'::text) AND (EXISTS ( SELECT 1
   FROM public.academic_years y
  WHERE ((y.id = holiday_occurrences.academic_year_id) AND (y.status <> 'CLOSED'::public.academic_year_status)))))) WITH CHECK (public.has_permission('calendar.manage_holidays'::text));

ALTER TABLE public.holiday_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY holiday_types_select_authenticated ON public.holiday_types FOR SELECT TO authenticated USING (true);

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY permissions_select_authenticated ON public.permissions FOR SELECT TO authenticated USING (true);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_permissions_select_authenticated ON public.role_permissions FOR SELECT TO authenticated USING (true);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY roles_select_authenticated ON public.roles FOR SELECT TO authenticated USING (true);

ALTER TABLE public.semesters ENABLE ROW LEVEL SECURITY;

CREATE POLICY semesters_insert_manage ON public.semesters FOR INSERT TO authenticated WITH CHECK (public.has_permission('calendar.manage'::text));

CREATE POLICY semesters_select_authenticated ON public.semesters FOR SELECT TO authenticated USING (public.has_permission('calendar.view'::text));

CREATE POLICY semesters_update_manage ON public.semesters FOR UPDATE TO authenticated USING ((public.has_permission('calendar.manage'::text) AND (status <> 'CLOSED'::public.semester_status))) WITH CHECK (public.has_permission('calendar.manage'::text));

ALTER TABLE public.student_return_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_return_days_insert_manage ON public.student_return_days FOR INSERT TO authenticated WITH CHECK ((public.has_permission('calendar.manage'::text) AND (( SELECT academic_years.status
   FROM public.academic_years
  WHERE (academic_years.id = student_return_days.academic_year_id)) <> 'CLOSED'::public.academic_year_status)));

CREATE POLICY student_return_days_select_authenticated ON public.student_return_days FOR SELECT TO authenticated USING (public.has_permission('calendar.view'::text));

CREATE POLICY student_return_days_update_manage ON public.student_return_days FOR UPDATE TO authenticated USING ((public.has_permission('calendar.manage'::text) AND (EXISTS ( SELECT 1
   FROM public.academic_years y
  WHERE ((y.id = student_return_days.academic_year_id) AND (y.status <> 'CLOSED'::public.academic_year_status)))))) WITH CHECK (public.has_permission('calendar.manage'::text));

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_permissions_select_own ON public.user_permissions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = user_permissions.user_id) AND (u.supabase_uid = auth.uid())))));

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_roles_select_own ON public.user_roles FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = user_roles.user_id) AND (u.supabase_uid = auth.uid())))));

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own ON public.users FOR SELECT TO authenticated USING (((supabase_uid = auth.uid()) AND (deleted_at IS NULL)));

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.calendar_corrections TO anon;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.calendar_corrections TO authenticated;
GRANT ALL ON TABLE public.calendar_corrections TO service_role;

REVOKE ALL ON FUNCTION public.fn_apply_calendar_correction(p_academic_year_id uuid, p_fact_kind public.calendar_fact_kind, p_fact_semester_order smallint, p_fact_holiday_type_key public.holiday_type_key, p_fact_exam_type_key public.exam_type_key, p_corrected_value date, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_apply_calendar_correction(p_academic_year_id uuid, p_fact_kind public.calendar_fact_kind, p_fact_semester_order smallint, p_fact_holiday_type_key public.holiday_type_key, p_fact_exam_type_key public.exam_type_key, p_corrected_value date, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.fn_apply_calendar_correction(p_academic_year_id uuid, p_fact_kind public.calendar_fact_kind, p_fact_semester_order smallint, p_fact_holiday_type_key public.holiday_type_key, p_fact_exam_type_key public.exam_type_key, p_corrected_value date, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_apply_calendar_correction(p_academic_year_id uuid, p_fact_kind public.calendar_fact_kind, p_fact_semester_order smallint, p_fact_holiday_type_key public.holiday_type_key, p_fact_exam_type_key public.exam_type_key, p_corrected_value date, p_reason text) TO service_role;

GRANT ALL ON FUNCTION public.fn_audit_log() TO anon;
GRANT ALL ON FUNCTION public.fn_audit_log() TO authenticated;
GRANT ALL ON FUNCTION public.fn_audit_log() TO service_role;

GRANT ALL ON FUNCTION public.fn_bump_calendar_config_revision(p_academic_year_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_bump_calendar_config_revision(p_academic_year_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_bump_calendar_config_revision(p_academic_year_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.fn_bump_revision_on_dependency_change() TO anon;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_dependency_change() TO authenticated;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_dependency_change() TO service_role;

GRANT ALL ON FUNCTION public.fn_bump_revision_on_exam_change() TO anon;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_exam_change() TO authenticated;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_exam_change() TO service_role;

GRANT ALL ON FUNCTION public.fn_bump_revision_on_holiday_change() TO anon;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_holiday_change() TO authenticated;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_holiday_change() TO service_role;

GRANT ALL ON FUNCTION public.fn_bump_revision_on_semester_change() TO anon;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_semester_change() TO authenticated;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_semester_change() TO service_role;

GRANT ALL ON FUNCTION public.fn_bump_revision_on_student_return_change() TO anon;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_student_return_change() TO authenticated;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_student_return_change() TO service_role;

GRANT ALL ON FUNCTION public.fn_bump_revision_on_year_boundary_change() TO anon;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_year_boundary_change() TO authenticated;
GRANT ALL ON FUNCTION public.fn_bump_revision_on_year_boundary_change() TO service_role;

GRANT ALL ON FUNCTION public.fn_check_timeline_day_year_matches_build() TO anon;
GRANT ALL ON FUNCTION public.fn_check_timeline_day_year_matches_build() TO authenticated;
GRANT ALL ON FUNCTION public.fn_check_timeline_day_year_matches_build() TO service_role;

GRANT ALL ON FUNCTION public.fn_create_default_semesters() TO anon;
GRANT ALL ON FUNCTION public.fn_create_default_semesters() TO authenticated;
GRANT ALL ON FUNCTION public.fn_create_default_semesters() TO service_role;

GRANT ALL ON FUNCTION public.fn_load_calendar_config_snapshot(p_academic_year_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_load_calendar_config_snapshot(p_academic_year_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_load_calendar_config_snapshot(p_academic_year_id uuid) TO service_role;

GRANT ALL ON TABLE public.calendar_timeline_builds TO anon;
GRANT ALL ON TABLE public.calendar_timeline_builds TO authenticated;
GRANT ALL ON TABLE public.calendar_timeline_builds TO service_role;

REVOKE ALL ON FUNCTION public.fn_publish_calendar_timeline(p_build_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_publish_calendar_timeline(p_build_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_publish_calendar_timeline(p_build_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_publish_calendar_timeline(p_build_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.fn_record_failed_build(p_build_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_record_failed_build(p_build_id uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.fn_record_failed_build(p_build_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_record_failed_build(p_build_id uuid, p_reason text) TO service_role;

GRANT ALL ON TABLE public.academic_years TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE ON TABLE public.academic_years TO authenticated;
GRANT ALL ON TABLE public.academic_years TO service_role;

GRANT UPDATE(year_ec) ON TABLE public.academic_years TO authenticated;

GRANT UPDATE(name) ON TABLE public.academic_years TO authenticated;

GRANT UPDATE(start_date) ON TABLE public.academic_years TO authenticated;

GRANT UPDATE(end_date) ON TABLE public.academic_years TO authenticated;

GRANT UPDATE(is_default_boundary) ON TABLE public.academic_years TO authenticated;

GRANT UPDATE(ministry_target_days) ON TABLE public.academic_years TO authenticated;

REVOKE ALL ON FUNCTION public.fn_transition_academic_year_status(p_year_id uuid, p_to public.academic_year_status) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_transition_academic_year_status(p_year_id uuid, p_to public.academic_year_status) TO anon;
GRANT ALL ON FUNCTION public.fn_transition_academic_year_status(p_year_id uuid, p_to public.academic_year_status) TO authenticated;
GRANT ALL ON FUNCTION public.fn_transition_academic_year_status(p_year_id uuid, p_to public.academic_year_status) TO service_role;

GRANT ALL ON TABLE public.semesters TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE ON TABLE public.semesters TO authenticated;
GRANT ALL ON TABLE public.semesters TO service_role;

GRANT UPDATE(start_date) ON TABLE public.semesters TO authenticated;

GRANT UPDATE(end_date) ON TABLE public.semesters TO authenticated;

REVOKE ALL ON FUNCTION public.fn_transition_semester_status(p_semester_id uuid, p_to public.semester_status) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_transition_semester_status(p_semester_id uuid, p_to public.semester_status) TO anon;
GRANT ALL ON FUNCTION public.fn_transition_semester_status(p_semester_id uuid, p_to public.semester_status) TO authenticated;
GRANT ALL ON FUNCTION public.fn_transition_semester_status(p_semester_id uuid, p_to public.semester_status) TO service_role;

GRANT ALL ON FUNCTION public.fn_update_timestamp() TO anon;
GRANT ALL ON FUNCTION public.fn_update_timestamp() TO authenticated;
GRANT ALL ON FUNCTION public.fn_update_timestamp() TO service_role;

GRANT ALL ON FUNCTION public.fn_validate_calendar_dependency() TO anon;
GRANT ALL ON FUNCTION public.fn_validate_calendar_dependency() TO authenticated;
GRANT ALL ON FUNCTION public.fn_validate_calendar_dependency() TO service_role;

GRANT ALL ON FUNCTION public.fn_validate_exam_placement() TO anon;
GRANT ALL ON FUNCTION public.fn_validate_exam_placement() TO authenticated;
GRANT ALL ON FUNCTION public.fn_validate_exam_placement() TO service_role;

GRANT ALL ON FUNCTION public.fn_validate_fact_ref(p_kind public.calendar_fact_kind, p_semester_order smallint, p_holiday_key public.holiday_type_key, p_exam_key public.exam_type_key, p_label text) TO anon;
GRANT ALL ON FUNCTION public.fn_validate_fact_ref(p_kind public.calendar_fact_kind, p_semester_order smallint, p_holiday_key public.holiday_type_key, p_exam_key public.exam_type_key, p_label text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_validate_fact_ref(p_kind public.calendar_fact_kind, p_semester_order smallint, p_holiday_key public.holiday_type_key, p_exam_key public.exam_type_key, p_label text) TO service_role;

GRANT ALL ON FUNCTION public.fn_validate_holiday_occurrence() TO anon;
GRANT ALL ON FUNCTION public.fn_validate_holiday_occurrence() TO authenticated;
GRANT ALL ON FUNCTION public.fn_validate_holiday_occurrence() TO service_role;

GRANT ALL ON FUNCTION public.fn_validate_semester_ordering() TO anon;
GRANT ALL ON FUNCTION public.fn_validate_semester_ordering() TO authenticated;
GRANT ALL ON FUNCTION public.fn_validate_semester_ordering() TO service_role;

REVOKE ALL ON FUNCTION public.has_permission(p_permission_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_permission(p_permission_key text) TO anon;
GRANT ALL ON FUNCTION public.has_permission(p_permission_key text) TO authenticated;
GRANT ALL ON FUNCTION public.has_permission(p_permission_key text) TO service_role;

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.audit_logs TO anon;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;

GRANT ALL ON TABLE public.calendar_dependencies TO anon;
GRANT ALL ON TABLE public.calendar_dependencies TO authenticated;
GRANT ALL ON TABLE public.calendar_dependencies TO service_role;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE ON TABLE public.calendar_reminders TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE ON TABLE public.calendar_reminders TO authenticated;
GRANT ALL ON TABLE public.calendar_reminders TO service_role;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE ON TABLE public.calendar_timeline_days TO anon;
GRANT ALL ON TABLE public.calendar_timeline_days TO authenticated;
GRANT ALL ON TABLE public.calendar_timeline_days TO service_role;

GRANT ALL ON TABLE public.calendar_validation_runs TO anon;
GRANT ALL ON TABLE public.calendar_validation_runs TO authenticated;
GRANT ALL ON TABLE public.calendar_validation_runs TO service_role;

GRANT ALL ON TABLE public.exam_instances TO anon;
GRANT ALL ON TABLE public.exam_instances TO authenticated;
GRANT ALL ON TABLE public.exam_instances TO service_role;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.exam_types TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.exam_types TO authenticated;
GRANT ALL ON TABLE public.exam_types TO service_role;

GRANT ALL ON TABLE public.holiday_occurrences TO anon;
GRANT ALL ON TABLE public.holiday_occurrences TO authenticated;
GRANT ALL ON TABLE public.holiday_occurrences TO service_role;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.holiday_types TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.holiday_types TO authenticated;
GRANT ALL ON TABLE public.holiday_types TO service_role;

GRANT ALL ON TABLE public.permissions TO anon;
GRANT ALL ON TABLE public.permissions TO authenticated;
GRANT ALL ON TABLE public.permissions TO service_role;

GRANT ALL ON TABLE public.role_permissions TO anon;
GRANT ALL ON TABLE public.role_permissions TO authenticated;
GRANT ALL ON TABLE public.role_permissions TO service_role;

GRANT ALL ON TABLE public.roles TO anon;
GRANT ALL ON TABLE public.roles TO authenticated;
GRANT ALL ON TABLE public.roles TO service_role;

GRANT ALL ON TABLE public.student_return_days TO anon;
GRANT ALL ON TABLE public.student_return_days TO authenticated;
GRANT ALL ON TABLE public.student_return_days TO service_role;

GRANT ALL ON TABLE public.user_permissions TO anon;
GRANT ALL ON TABLE public.user_permissions TO authenticated;
GRANT ALL ON TABLE public.user_permissions TO service_role;

GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;

GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;

\unrestrict 0p3mEJZZGYiQaaBng3uXyZyw8z6Cvh6s7pzLm9Y7gs2nKhU4ki5xsyWaaOWGYOH


-- ---------------------------------------------------------------------------
-- Built-in catalog rows
-- ---------------------------------------------------------------------------

\restrict zGfc2vjyP5gn4mgbMqC6g0EXs4dh9WdEMDjXoMFgs0aKybaYpba1g8JMLpoFeH5

INSERT INTO public.exam_types (key, name, semester_order, closes_school, grade_scope) VALUES ('S1_REGIONAL_MODEL', 'Semester 1 Regional Model Exam', 1, true, 'ALL');
INSERT INTO public.exam_types (key, name, semester_order, closes_school, grade_scope) VALUES ('S1_FINAL', 'Semester 1 Final Exam', 1, true, 'ALL');
INSERT INTO public.exam_types (key, name, semester_order, closes_school, grade_scope) VALUES ('S2_REGIONAL_MODEL', 'Semester 2 Regional Model Exam', 2, true, 'ALL');
INSERT INTO public.exam_types (key, name, semester_order, closes_school, grade_scope) VALUES ('S2_FINAL', 'Semester 2 Final Exam', 2, true, 'ALL');
INSERT INTO public.exam_types (key, name, semester_order, closes_school, grade_scope) VALUES ('GRADE12_NATIONAL', 'Grade 12 National Exam', NULL, false, 'GRADE_12');

INSERT INTO public.holiday_types (key, name, movable, fixed_month, fixed_day) VALUES ('NEW_YEAR', 'Ethiopian New Year', false, 1, 1);
INSERT INTO public.holiday_types (key, name, movable, fixed_month, fixed_day) VALUES ('GENNA', 'Genna (Christmas)', false, 4, 29);
INSERT INTO public.holiday_types (key, name, movable, fixed_month, fixed_day) VALUES ('TIMKAT', 'Timkat (Epiphany)', false, 5, 11);
INSERT INTO public.holiday_types (key, name, movable, fixed_month, fixed_day) VALUES ('ADWA', 'Adwa Victory Day', false, 6, 23);
INSERT INTO public.holiday_types (key, name, movable, fixed_month, fixed_day) VALUES ('PATRIOTS', 'Patriots'' Day', false, 8, 27);
INSERT INTO public.holiday_types (key, name, movable, fixed_month, fixed_day) VALUES ('SIKLET', 'Siklet (Good Friday)', true, NULL, NULL);
INSERT INTO public.holiday_types (key, name, movable, fixed_month, fixed_day) VALUES ('FASIKA', 'Fasika (Easter)', true, NULL, NULL);
INSERT INTO public.holiday_types (key, name, movable, fixed_month, fixed_day) VALUES ('EID_FITR', 'Eid al-Fitr', true, NULL, NULL);
INSERT INTO public.holiday_types (key, name, movable, fixed_month, fixed_day) VALUES ('EID_ADHA', 'Eid al-Adha (Arefa)', true, NULL, NULL);
INSERT INTO public.holiday_types (key, name, movable, fixed_month, fixed_day) VALUES ('DERG_DOWNFALL', 'Downfall of the Derg', false, 9, 20);

INSERT INTO public.permissions (id, resource, action, description, created_at) VALUES ('fe9e8d5e-542f-4f21-bcea-7a5ccfa7d1dd', 'calendar', 'view', NULL, '2026-10-21 21:32:29.073429+00');
INSERT INTO public.permissions (id, resource, action, description, created_at) VALUES ('285ff0ab-4aae-49c0-8808-2345108c1b4e', 'calendar', 'manage', NULL, '2026-10-21 21:32:29.073429+00');
INSERT INTO public.permissions (id, resource, action, description, created_at) VALUES ('7e541ac2-20d3-4fc2-b029-df085d9af7b1', 'calendar', 'manage_holidays', NULL, '2026-10-21 21:32:29.073429+00');
INSERT INTO public.permissions (id, resource, action, description, created_at) VALUES ('9231fa8a-3328-47ea-9f35-84006cc95a55', 'calendar', 'manage_exams', NULL, '2026-10-21 21:32:29.073429+00');
INSERT INTO public.permissions (id, resource, action, description, created_at) VALUES ('9071a5c5-b9f6-4413-a9aa-333962c164ca', 'calendar', 'manage_dependencies', NULL, '2026-10-21 21:32:29.073429+00');
INSERT INTO public.permissions (id, resource, action, description, created_at) VALUES ('4cc3c1c8-45cc-4a3a-b58e-232cc5bba05a', 'calendar', 'build_timeline', NULL, '2026-10-21 21:32:29.073429+00');
INSERT INTO public.permissions (id, resource, action, description, created_at) VALUES ('d43982bc-3d99-4cbb-af60-d00281e71ed3', 'calendar', 'correct_history', NULL, '2026-10-21 21:32:29.073429+00');

INSERT INTO public.roles (id, name, description, created_at, updated_at) VALUES ('4da1aed6-0907-48e8-91aa-5797fbe39e0b', 'Admin', 'Standalone-mode bootstrap role: every calendar.* permission.', '2026-10-21 21:32:29.681527+00', '2026-10-21 21:32:29.681527+00');

INSERT INTO public.role_permissions (role_id, permission_id, created_at) VALUES ('4da1aed6-0907-48e8-91aa-5797fbe39e0b', 'fe9e8d5e-542f-4f21-bcea-7a5ccfa7d1dd', '2026-10-21 21:32:29.681527+00');
INSERT INTO public.role_permissions (role_id, permission_id, created_at) VALUES ('4da1aed6-0907-48e8-91aa-5797fbe39e0b', '285ff0ab-4aae-49c0-8808-2345108c1b4e', '2026-10-21 21:32:29.681527+00');
INSERT INTO public.role_permissions (role_id, permission_id, created_at) VALUES ('4da1aed6-0907-48e8-91aa-5797fbe39e0b', '7e541ac2-20d3-4fc2-b029-df085d9af7b1', '2026-10-21 21:32:29.681527+00');
INSERT INTO public.role_permissions (role_id, permission_id, created_at) VALUES ('4da1aed6-0907-48e8-91aa-5797fbe39e0b', '9231fa8a-3328-47ea-9f35-84006cc95a55', '2026-10-21 21:32:29.681527+00');
INSERT INTO public.role_permissions (role_id, permission_id, created_at) VALUES ('4da1aed6-0907-48e8-91aa-5797fbe39e0b', '9071a5c5-b9f6-4413-a9aa-333962c164ca', '2026-10-21 21:32:29.681527+00');
INSERT INTO public.role_permissions (role_id, permission_id, created_at) VALUES ('4da1aed6-0907-48e8-91aa-5797fbe39e0b', '4cc3c1c8-45cc-4a3a-b58e-232cc5bba05a', '2026-10-21 21:32:29.681527+00');
INSERT INTO public.role_permissions (role_id, permission_id, created_at) VALUES ('4da1aed6-0907-48e8-91aa-5797fbe39e0b', 'd43982bc-3d99-4cbb-af60-d00281e71ed3', '2026-10-21 21:32:29.681527+00');

\unrestrict zGfc2vjyP5gn4mgbMqC6g0EXs4dh9WdEMDjXoMFgs0aKybaYpba1g8JMLpoFeH5

