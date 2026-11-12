-- =============================================================================
-- Calendar Engine - Migration 0023: corrections in a closed year are simple.
--
-- Owner decision: when the main admin corrects a date in a closed year or a
-- closed half of the year, the date is simply updated. There is no reason
-- to type and no correction record is kept. The permission
-- `calendar.correct_history` stays, and is meant to be given to the main
-- admin role only.
--
-- What this does:
--   1. Replaces fn_apply_calendar_correction with a version that has no
--      reason and writes no record. It returns the new date.
--   2. Removes the calendar_corrections table (nothing is kept any more).
-- =============================================================================

DROP FUNCTION IF EXISTS fn_apply_calendar_correction(
    UUID, calendar_fact_kind, SMALLINT, holiday_type_key, exam_type_key, DATE, TEXT
);

CREATE OR REPLACE FUNCTION fn_apply_calendar_correction(
    p_academic_year_id UUID,
    p_fact_kind calendar_fact_kind,
    p_fact_semester_order SMALLINT,
    p_fact_holiday_type_key holiday_type_key,
    p_fact_exam_type_key exam_type_key,
    p_corrected_value DATE
) RETURNS DATE
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_year academic_years;
    v_semester semesters;
    v_found BOOLEAN := TRUE;
BEGIN
    IF NOT has_permission('calendar.correct_history') THEN
        RAISE EXCEPTION 'permission denied for calendar.correct_history' USING ERRCODE = '42501';
    END IF;

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
            UPDATE semesters SET start_date = p_corrected_value WHERE id = v_semester.id;
        WHEN 'SEMESTER_END' THEN
            UPDATE semesters SET end_date = p_corrected_value WHERE id = v_semester.id;
        WHEN 'STUDENT_RETURN' THEN
            UPDATE student_return_days SET date = p_corrected_value WHERE academic_year_id = p_academic_year_id;
            v_found := FOUND;
        WHEN 'HOLIDAY_OCCURRENCE' THEN
            UPDATE holiday_occurrences SET date = p_corrected_value
             WHERE academic_year_id = p_academic_year_id AND holiday_type_key = p_fact_holiday_type_key;
            v_found := FOUND;
        WHEN 'EXAM_START' THEN
            UPDATE exam_instances SET start_date = p_corrected_value
             WHERE academic_year_id = p_academic_year_id AND exam_type_key = p_fact_exam_type_key;
            v_found := FOUND;
        WHEN 'EXAM_END' THEN
            UPDATE exam_instances SET end_date = p_corrected_value
             WHERE academic_year_id = p_academic_year_id AND exam_type_key = p_fact_exam_type_key;
            v_found := FOUND;
        WHEN 'ACADEMIC_YEAR_START' THEN
            UPDATE academic_years SET start_date = p_corrected_value WHERE id = p_academic_year_id;
        WHEN 'ACADEMIC_YEAR_END' THEN
            UPDATE academic_years SET end_date = p_corrected_value WHERE id = p_academic_year_id;
        ELSE
            RAISE EXCEPTION 'Correction not supported for fact kind %', p_fact_kind USING ERRCODE = 'check_violation';
    END CASE;

    IF NOT v_found THEN
        RAISE EXCEPTION 'Nothing to correct for %/% - that date was never entered', p_fact_kind, p_academic_year_id
            USING ERRCODE = 'no_data_found';
    END IF;

    RETURN p_corrected_value;
END;
$$;

REVOKE ALL ON FUNCTION fn_apply_calendar_correction(
    UUID, calendar_fact_kind, SMALLINT, holiday_type_key, exam_type_key, DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_apply_calendar_correction(
    UUID, calendar_fact_kind, SMALLINT, holiday_type_key, exam_type_key, DATE
) TO authenticated;

DROP TABLE IF EXISTS calendar_corrections;
