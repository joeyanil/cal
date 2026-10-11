-- 0021a: adds the Ginbot 20 (Downfall of the Derg) permanent holiday to the
-- list of holiday types. RUN THIS ALONE FIRST, then run 0021b.
-- (Postgres will not let a new enum value be used in the same run that adds it.)
ALTER TYPE holiday_type_key ADD VALUE IF NOT EXISTS 'DERG_DOWNFALL';
