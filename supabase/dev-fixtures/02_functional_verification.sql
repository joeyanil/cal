-- =============================================================================
-- DEV-ONLY — functional verification script. Not part of the deliverable
-- migrations. Run after supabase/dev-fixtures/00 and 01, and after every
-- migration in supabase/migrations/ has been applied.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

-- ---------------------------------------------------------------------------
-- Fixture: one admin user with every calendar.* permission, via a role.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_role_id UUID;
    v_user_id UUID;
BEGIN
    INSERT INTO roles (name) VALUES ('Calendar Test Admin') RETURNING id INTO v_role_id;
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_role_id, id FROM permissions WHERE resource = 'calendar';

    INSERT INTO users (id, supabase_uid, full_name, user_type)
    VALUES ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Test Admin', 'ADMIN')
    RETURNING id INTO v_user_id;

    INSERT INTO user_roles (user_id, role_id) VALUES (v_user_id, v_role_id);

    -- A second, permission-less user for negative tests.
    INSERT INTO users (id, supabase_uid, full_name, user_type)
    VALUES ('00000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'No Permissions', 'TEACHER');
END $$;

-- =============================================================================
-- TEST 1: RLS blocks a user with no calendar.view permission from SELECTing.
-- =============================================================================
SET ROLE authenticated;
SELECT set_config('app.current_uid', '22222222-2222-2222-2222-222222222222', false);

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count FROM academic_years;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'TEST 1 FAILED: no-permission user could see % academic_years rows', v_count;
    END IF;
    RAISE NOTICE 'TEST 1 PASSED: no-permission user sees zero academic_years rows via RLS';
END $$;

RESET ROLE;
RESET app.current_uid;

-- =============================================================================
-- TEST 2: the admin user CAN create an academic year, semesters, holidays.
-- =============================================================================
SET ROLE authenticated;
SELECT set_config('app.current_uid', '11111111-1111-1111-1111-111111111111', false);

INSERT INTO academic_years (id, year_ec, name, start_date, end_date, status, created_by)
VALUES ('a0000000-0000-0000-0000-000000000019', 2019, '2019 E.C.', '2026-09-15', '2027-07-07', 'PREPARING',
        '00000000-0000-0000-0000-000000000001');

DO $$ BEGIN
  IF (SELECT count(*) FROM academic_years WHERE year_ec = 2019) = 1 THEN
    RAISE NOTICE 'TEST 2 PASSED: admin created the 2019 E.C. academic year';
  ELSE
    RAISE EXCEPTION 'TEST 2 FAILED';
  END IF;
END $$;

-- Semesters no longer need to be (and can no longer safely be) inserted —
-- Migration 0016's fn_create_default_semesters trigger already created
-- both, UPCOMING, with NULL dates, atomically with the year itself. Set
-- their real dates, then use the transition RPC for semester 1's status
-- (ordinary UPDATE can no longer touch `status` directly — Migration
-- 0016 fix #6 — and the RPC itself now requires dates to be set first —
-- fix #7 — so this exercises the real, correct workflow end to end).
UPDATE semesters SET start_date = '2026-09-15', end_date = '2026-12-29'
 WHERE academic_year_id = 'a0000000-0000-0000-0000-000000000019' AND sem_order = 1;
UPDATE semesters SET start_date = '2027-01-28', end_date = '2027-07-07'
 WHERE academic_year_id = 'a0000000-0000-0000-0000-000000000019' AND sem_order = 2;
SELECT fn_transition_semester_status(
    (SELECT id FROM semesters WHERE academic_year_id = 'a0000000-0000-0000-0000-000000000019' AND sem_order = 1),
    'ACTIVE');

-- Fixed holiday: auto-proposed, source AUTO_PROPOSED — must succeed.
INSERT INTO holiday_occurrences (academic_year_id, holiday_type_key, date, source)
VALUES ('a0000000-0000-0000-0000-000000000019', 'GENNA', '2027-01-07', 'AUTO_PROPOSED');

DO $$ BEGIN RAISE NOTICE 'TEST 2b PASSED: semesters dated + semester 1 activated + fixed holiday created'; END $$;

-- =============================================================================
-- TEST 3: a movable holiday MUST be ADMIN_ENTERED — AUTO_PROPOSED is rejected
-- at the database layer (mission section 8's hard rule, enforced twice).
-- =============================================================================
DO $$
BEGIN
    BEGIN
        INSERT INTO holiday_occurrences (academic_year_id, holiday_type_key, date, source)
        VALUES ('a0000000-0000-0000-0000-000000000019', 'FASIKA', '2027-05-02', 'AUTO_PROPOSED');
        RAISE EXCEPTION 'TEST 3 FAILED: movable holiday accepted with source=AUTO_PROPOSED';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 3 PASSED: movable holiday with AUTO_PROPOSED source rejected: %', SQLERRM;
    END;
END $$;

INSERT INTO holiday_occurrences (academic_year_id, holiday_type_key, date, source)
VALUES ('a0000000-0000-0000-0000-000000000019', 'FASIKA', '2027-05-02', 'ADMIN_ENTERED');
DO $$ BEGIN RAISE NOTICE 'TEST 3b PASSED: movable holiday with ADMIN_ENTERED source accepted'; END $$;

-- =============================================================================
-- TEST 4: exam hard stops — weekend and closing-holiday overlap rejected.
-- =============================================================================
DO $$
BEGIN
    BEGIN
        INSERT INTO exam_instances (academic_year_id, exam_type_key, start_date, end_date)
        VALUES ('a0000000-0000-0000-0000-000000000019', 'S1_FINAL', '2026-12-14', '2026-12-19'); -- includes Sat 12-19
        RAISE EXCEPTION 'TEST 4 FAILED: exam spanning a weekend was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 4 PASSED: exam spanning a weekend rejected: %', SQLERRM;
    END;

    BEGIN
        INSERT INTO exam_instances (academic_year_id, exam_type_key, start_date, end_date)
        VALUES ('a0000000-0000-0000-0000-000000000019', 'S1_FINAL', '2027-01-05', '2027-01-07'); -- includes Genna 01-07
        RAISE EXCEPTION 'TEST 4c FAILED: exam overlapping a closing holiday was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 4c PASSED: exam overlapping Genna rejected: %', SQLERRM;
    END;
END $$;

INSERT INTO exam_instances (academic_year_id, exam_type_key, start_date, end_date)
VALUES ('a0000000-0000-0000-0000-000000000019', 'S1_FINAL', '2026-12-14', '2026-12-18');
DO $$ BEGIN RAISE NOTICE 'TEST 4b PASSED: a clean Mon-Fri exam window was accepted'; END $$;

-- =============================================================================
-- TEST 5: circular dependency rejected at the database layer.
-- =============================================================================
INSERT INTO calendar_dependencies (academic_year_id, anchor_kind, anchor_semester_order, dependent_kind, offset_days, created_by)
VALUES ('a0000000-0000-0000-0000-000000000019', 'SEMESTER_START', 1, 'STUDENT_RETURN', -1, '00000000-0000-0000-0000-000000000001');

DO $$
BEGIN
    BEGIN
        INSERT INTO calendar_dependencies (academic_year_id, anchor_kind, dependent_kind, dependent_semester_order, offset_days, created_by)
        VALUES ('a0000000-0000-0000-0000-000000000019', 'STUDENT_RETURN', 'SEMESTER_START', 1, 1, '00000000-0000-0000-0000-000000000001');
        RAISE EXCEPTION 'TEST 5 FAILED: circular dependency was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 5 PASSED: circular dependency rejected: %', SQLERRM;
    END;
END $$;

-- =============================================================================
-- TEST 6: fn_publish_calendar_timeline — happy path + staleness guard.
--
-- Migration 0015 replaced the build-counter model with a real
-- calendar_config_revision the database itself advances on every genuine
-- fact change (never on a no-op, never on a status-only transition).
-- source_config_revision is therefore captured from the year's live
-- revision at each point, not hardcoded — and every candidate now needs a
-- structurally complete day-set, since publish independently verifies
-- exact day count / exact span, not just a valid-looking header row.
-- =============================================================================
SELECT calendar_config_revision FROM academic_years
 WHERE id = 'a0000000-0000-0000-0000-000000000019' \gset rev1_

INSERT INTO calendar_timeline_builds (id, academic_year_id, status, source_config_revision, config_hash, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000019', 'CANDIDATE',
        :rev1_calendar_config_revision, 'hash1', '00000000-0000-0000-0000-000000000001');
INSERT INTO calendar_timeline_days (build_id, academic_year_id, date, ethiopian_year, ethiopian_month, ethiopian_day,
        weekday, is_weekend, school_open, teaching_day, attendance_available, grade12_attendance_available)
SELECT 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000019', d::date, 2019, 1, 1,
        extract(dow from d)::int, extract(dow from d) IN (0,6), true, true, true, true
FROM generate_series('2026-09-15'::date, '2027-07-07'::date, '1 day') d;

SELECT fn_publish_calendar_timeline('b0000000-0000-0000-0000-000000000001');

DO $$ BEGIN
  IF (SELECT status FROM calendar_timeline_builds WHERE id = 'b0000000-0000-0000-0000-000000000001') = 'CURRENT' THEN
    RAISE NOTICE 'TEST 6 PASSED: revision-1 build published as CURRENT';
  ELSE
    RAISE EXCEPTION 'TEST 6 FAILED';
  END IF;
END $$;

-- A real authoritative edit — this is what should genuinely advance the
-- revision, not a manually incremented test counter.
UPDATE semesters SET end_date = '2026-12-30'
 WHERE academic_year_id = 'a0000000-0000-0000-0000-000000000019' AND sem_order = 1;

SELECT calendar_config_revision FROM academic_years
 WHERE id = 'a0000000-0000-0000-0000-000000000019' \gset rev2_

SELECT :rev1_calendar_config_revision AS revision_before_edit, :rev2_calendar_config_revision AS revision_after_edit;

-- revision-2 candidate, publishes fine (newer than the now-CURRENT revision-1 build)
INSERT INTO calendar_timeline_builds (id, academic_year_id, status, source_config_revision, config_hash, created_by)
VALUES ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000019', 'CANDIDATE',
        :rev2_calendar_config_revision, 'hash2', '00000000-0000-0000-0000-000000000001');
INSERT INTO calendar_timeline_days (build_id, academic_year_id, date, ethiopian_year, ethiopian_month, ethiopian_day,
        weekday, is_weekend, school_open, teaching_day, attendance_available, grade12_attendance_available)
SELECT 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000019', d::date, 2019, 1, 1,
        extract(dow from d)::int, extract(dow from d) IN (0,6), true, true, true, true
FROM generate_series('2026-09-15'::date, '2027-07-07'::date, '1 day') d;
SELECT fn_publish_calendar_timeline('b0000000-0000-0000-0000-000000000002');

DO $$ BEGIN
  IF (SELECT status FROM calendar_timeline_builds WHERE id = 'b0000000-0000-0000-0000-000000000002') = 'CURRENT'
     AND (SELECT status FROM calendar_timeline_builds WHERE id = 'b0000000-0000-0000-0000-000000000001') = 'SUPERSEDED' THEN
    RAISE NOTICE 'TEST 6b PASSED: revision-2 build is now CURRENT, revision-1 build correctly SUPERSEDED';
  ELSE
    RAISE EXCEPTION 'TEST 6b FAILED';
  END IF;
END $$;

-- The exact scenario Migration 0015 exists to fix: a candidate captured at
-- the OLD revision (built, in spirit, before the semester-date edit above)
-- tries to publish AFTER a newer revision is already current. Note this
-- must be rejected purely on staleness grounds — its day-set is fully
-- complete and correctly shaped, isolating the revision check from the
-- structural checks tested separately below.
INSERT INTO calendar_timeline_builds (id, academic_year_id, status, source_config_revision, config_hash, created_by)
VALUES ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000019', 'CANDIDATE',
        :rev1_calendar_config_revision, 'hash1-late', '00000000-0000-0000-0000-000000000001');
INSERT INTO calendar_timeline_days (build_id, academic_year_id, date, ethiopian_year, ethiopian_month, ethiopian_day,
        weekday, is_weekend, school_open, teaching_day, attendance_available, grade12_attendance_available)
SELECT 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000019', d::date, 2019, 1, 1,
        extract(dow from d)::int, extract(dow from d) IN (0,6), true, true, true, true
FROM generate_series('2026-09-15'::date, '2027-07-07'::date, '1 day') d;

DO $$
BEGIN
    BEGIN
        PERFORM fn_publish_calendar_timeline('b0000000-0000-0000-0000-000000000003');
        RAISE EXCEPTION 'TEST 7 FAILED: stale build (old revision) was published over the newer revision';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 7 PASSED: stale late build correctly rejected: %', SQLERRM;
    END;
END $$;

DO $$ BEGIN
  IF (SELECT status FROM calendar_timeline_builds WHERE id = 'b0000000-0000-0000-0000-000000000002') = 'CURRENT' THEN
    RAISE NOTICE 'TEST 7b PASSED: revision-2 build is STILL current after the stale publish attempt (not overwritten)';
  ELSE
    RAISE EXCEPTION 'TEST 7b FAILED: revision-2 build was disturbed by the rejected stale build';
  END IF;
END $$;

-- =============================================================================
-- TEST 8: CLOSED-year protection — ordinary UPDATE blocked; correction works.
-- =============================================================================
SELECT fn_transition_academic_year_status('a0000000-0000-0000-0000-000000000019', 'READY');
SELECT fn_transition_academic_year_status('a0000000-0000-0000-0000-000000000019', 'ACTIVE');
SELECT fn_transition_academic_year_status('a0000000-0000-0000-0000-000000000019', 'CLOSED');

DO $$
BEGIN
    BEGIN
        UPDATE academic_years SET end_date = '2027-07-10' WHERE id = 'a0000000-0000-0000-0000-000000000019';
        -- An UPDATE against a row an RLS policy's USING clause excludes
        -- affects 0 rows rather than raising — check that explicitly.
        IF (SELECT end_date FROM academic_years WHERE id = 'a0000000-0000-0000-0000-000000000019') = '2027-07-10' THEN
            RAISE EXCEPTION 'TEST 8 FAILED: ordinary UPDATE succeeded against a CLOSED academic year';
        ELSE
            RAISE NOTICE 'TEST 8 PASSED: ordinary UPDATE against a CLOSED year silently affected 0 rows (RLS)';
        END IF;
    END;
END $$;

SELECT fn_apply_calendar_correction(
    'a0000000-0000-0000-0000-000000000019', 'ACADEMIC_YEAR_END', NULL, NULL, NULL,
    '2027-07-10'
);

DO $$ BEGIN
  IF (SELECT end_date FROM academic_years WHERE id = 'a0000000-0000-0000-0000-000000000019') = '2027-07-10' THEN
    RAISE NOTICE 'TEST 8b PASSED: fn_apply_calendar_correction updated the CLOSED year''s end date';
  ELSE
    RAISE EXCEPTION 'TEST 8b FAILED';
  END IF;
  IF to_regclass('public.calendar_corrections') IS NULL THEN
    RAISE NOTICE 'TEST 8c PASSED: no correction record is kept (owner decision)';
  ELSE
    RAISE EXCEPTION 'TEST 8c FAILED: a correction table still exists';
  END IF;
END $$;

-- =============================================================================
-- TEST 9: a permission-less user cannot call the correction RPC.
-- =============================================================================
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('app.current_uid', '22222222-2222-2222-2222-222222222222', false);

DO $$
BEGIN
    BEGIN
        PERFORM fn_apply_calendar_correction(
            'a0000000-0000-0000-0000-000000000019', 'ACADEMIC_YEAR_END', NULL, NULL, NULL,
            '2027-08-01'
        );
        RAISE EXCEPTION 'TEST 9 FAILED: permission-less user was able to apply a correction';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST 9 PASSED: permission-less user blocked from fn_apply_calendar_correction: %', SQLERRM;
    END;
END $$;

RESET ROLE;
RESET app.current_uid;

\echo '============================================================'
\echo 'ALL FUNCTIONAL VERIFICATION TESTS COMPLETED'
\echo '============================================================'
