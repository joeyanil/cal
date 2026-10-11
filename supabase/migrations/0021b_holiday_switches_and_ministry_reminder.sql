-- 0021b: run AFTER 0021a. Safe to run more than once.

-- 1. The new permanent holiday: Ginbot 20 (month 9, day 20).
INSERT INTO holiday_types (key, name, movable, fixed_month, fixed_day)
VALUES ('DERG_DOWNFALL', 'Downfall of the Derg', FALSE, 9, 20)
ON CONFLICT (key) DO NOTHING;

-- 2. A school can switch a moving holiday off ("we teach that day"), so there
--    is no date to enter. Such a row has no date and does not close school.
ALTER TABLE holiday_occurrences ALTER COLUMN date DROP NOT NULL;
ALTER TABLE holiday_occurrences DROP CONSTRAINT IF EXISTS chk_holiday_date_or_not_observed;
ALTER TABLE holiday_occurrences
    ADD CONSTRAINT chk_holiday_date_or_not_observed
    CHECK (date IS NOT NULL OR closes_school = FALSE);

-- 3. Optional reminder: the Ministry's total school days, for comparison only.
ALTER TABLE academic_years
    ADD COLUMN IF NOT EXISTS ministry_target_days SMALLINT
    CHECK (ministry_target_days BETWEEN 1 AND 366);
-- Updates on academic_years are granted column by column (migration 0015).
GRANT UPDATE (ministry_target_days) ON academic_years TO authenticated;
