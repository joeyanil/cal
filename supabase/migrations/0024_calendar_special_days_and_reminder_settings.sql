-- =============================================================================
-- Calendar Engine - Migration 0024: special days and reminder settings.
--
--  1. special_days: days the school adds itself (sports day, parents' meeting,
--     teachers' training, a trip, a ceremony ...). Each one says whether
--     students come to school and which grades it affects. They sit BESIDE the
--     published timeline, so adding one never forces a rebuild.
--  2. calendar_reminder_settings: which of the nine reminder groups the school
--     sends, and at which of 30 / 15 / 5 days.
--  3. calendar_reminder_dispatch: a note of every reminder already sent, so a
--     reminder can never go out twice.
--  4. calendar_reminder_known_dates: the last date we saw for every reminded
--     item, so a moved date can be noticed and announced.
-- =============================================================================

CREATE TABLE special_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    situation TEXT NOT NULL CHECK (situation IN (
        'SPORTS_DAY', 'PARENTS_MEETING', 'TEACHERS_TRAINING', 'SCHOOL_TRIP', 'CEREMONY',
        'JOB_CHOICE_WEEK', 'CLUB_CULTURE_DAY', 'HEALTH_DAY', 'CLEANUP_DAY', 'RESULTS_DAY', 'CUSTOM'
    )),
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    students_come BOOLEAN NOT NULL,
    -- NULL = the whole school. Otherwise the affected grades.
    grades SMALLINT[] CHECK (grades IS NULL OR (cardinality(grades) BETWEEN 1 AND 4 AND grades <@ ARRAY[9,10,11,12]::SMALLINT[])),
    -- The admin's own reminder wording. NULL or empty = the ready-made wording.
    custom_message TEXT CHECK (custom_message IS NULL OR length(custom_message) <= 500),
    teacher_audience TEXT NOT NULL DEFAULT 'AFFECTED_GRADES' CHECK (teacher_audience IN ('AFFECTED_GRADES', 'ALL_TEACHERS')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_special_day_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_special_days_year_dates ON special_days(academic_year_id, start_date);

CREATE TRIGGER trg_special_days_updated_at
    BEFORE UPDATE ON special_days
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_special_days_audit
    AFTER INSERT OR UPDATE OR DELETE ON special_days
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE special_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY special_days_select_authenticated ON special_days
    FOR SELECT TO authenticated USING (has_permission('calendar.view'));

CREATE POLICY special_days_insert_manage ON special_days
    FOR INSERT TO authenticated
    WITH CHECK (
        has_permission('calendar.manage')
        AND (SELECT status FROM academic_years WHERE id = academic_year_id) <> 'CLOSED'
    );

CREATE POLICY special_days_update_manage ON special_days
    FOR UPDATE TO authenticated
    USING (
        has_permission('calendar.manage')
        AND (SELECT status FROM academic_years WHERE id = academic_year_id) <> 'CLOSED'
    )
    WITH CHECK (has_permission('calendar.manage'));

CREATE POLICY special_days_delete_manage ON special_days
    FOR DELETE TO authenticated
    USING (
        has_permission('calendar.manage')
        AND (SELECT status FROM academic_years WHERE id = academic_year_id) <> 'CLOSED'
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON special_days TO authenticated;
GRANT ALL ON special_days TO service_role;

-- -----------------------------------------------------------------------------
-- Reminder settings: school-wide, one row per group. All nine start switched on
-- at 30, 15 and 5 days; the admin turns off what the school does not need.
-- -----------------------------------------------------------------------------
CREATE TABLE calendar_reminder_settings (
    group_key TEXT PRIMARY KEY CHECK (group_key IN (
        'TESTS', 'HALF_START', 'HALF_END', 'BREAK', 'STUDENTS_RETURN',
        'YEAR_START', 'YEAR_END', 'HOLIDAYS', 'SPECIAL_DAYS'
    )),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    send_30 BOOLEAN NOT NULL DEFAULT TRUE,
    send_15 BOOLEAN NOT NULL DEFAULT TRUE,
    send_5 BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO calendar_reminder_settings (group_key) VALUES
    ('TESTS'), ('HALF_START'), ('HALF_END'), ('BREAK'), ('STUDENTS_RETURN'),
    ('YEAR_START'), ('YEAR_END'), ('HOLIDAYS'), ('SPECIAL_DAYS');

CREATE TRIGGER trg_calendar_reminder_settings_updated_at
    BEFORE UPDATE ON calendar_reminder_settings
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

ALTER TABLE calendar_reminder_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_reminder_settings_select ON calendar_reminder_settings
    FOR SELECT TO authenticated USING (has_permission('calendar.view'));

CREATE POLICY calendar_reminder_settings_update ON calendar_reminder_settings
    FOR UPDATE TO authenticated
    USING (has_permission('calendar.manage'))
    WITH CHECK (has_permission('calendar.manage'));

GRANT SELECT, UPDATE ON calendar_reminder_settings TO authenticated;
GRANT ALL ON calendar_reminder_settings TO service_role;

-- -----------------------------------------------------------------------------
-- Reminders already sent. Written only by the daily job (service role).
-- dispatch_key = item key | days | the date the item falls on.
-- -----------------------------------------------------------------------------
CREATE TABLE calendar_reminder_dispatch (
    dispatch_key TEXT PRIMARY KEY,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    group_key TEXT NOT NULL,
    sent_on DATE NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_calendar_reminder_dispatch_year ON calendar_reminder_dispatch(academic_year_id, sent_on);

ALTER TABLE calendar_reminder_dispatch ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_reminder_dispatch_select ON calendar_reminder_dispatch
    FOR SELECT TO authenticated USING (has_permission('calendar.view'));
GRANT SELECT ON calendar_reminder_dispatch TO authenticated;
GRANT ALL ON calendar_reminder_dispatch TO service_role;

-- -----------------------------------------------------------------------------
-- The last date seen for every reminded item, to notice when one moves.
-- -----------------------------------------------------------------------------
CREATE TABLE calendar_reminder_known_dates (
    item_key TEXT PRIMARY KEY,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    group_key TEXT NOT NULL,
    item_name TEXT NOT NULL,
    due_date DATE NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_calendar_reminder_known_year ON calendar_reminder_known_dates(academic_year_id);

ALTER TABLE calendar_reminder_known_dates ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_reminder_known_dates_select ON calendar_reminder_known_dates
    FOR SELECT TO authenticated USING (has_permission('calendar.view'));
GRANT SELECT ON calendar_reminder_known_dates TO authenticated;
GRANT ALL ON calendar_reminder_known_dates TO service_role;

-- A visitor who is not signed in must not be able to call the correction
-- function at all (it also checks the permission, this is a second lock).
REVOKE ALL ON FUNCTION fn_apply_calendar_correction(
    UUID, calendar_fact_kind, SMALLINT, holiday_type_key, exam_type_key, DATE
) FROM anon;
