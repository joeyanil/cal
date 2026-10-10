-- 0020: enforce the Ministry's "no exam in a holiday week" rule at the database
-- layer too (it is already enforced in the app by checkExamHardStops()).
--
-- A school week is Monday-Friday. An exam is rejected when any day of it falls
-- in a week that contains a school-closing holiday, unless that holiday is
-- itself inside the exam window (that case is already rejected, with its own
-- hint, by the closing-holiday check above).
--
-- Safe to run more than once. Run it in the Supabase SQL Editor.
CREATE OR REPLACE FUNCTION fn_validate_exam_placement() RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;
