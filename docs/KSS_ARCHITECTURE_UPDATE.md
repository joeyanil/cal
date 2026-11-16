# KSS architecture: what this engine replaces

The KSS architecture documents currently describe the **minimum calendar**: one `non_school_days` table, a fixed Monday-Friday week, holidays seeded by Kenat, and a `calendar.service` with `isSchoolDay()`. This engine replaces all of it. When the engine is accepted, update the KSS documents as below, then build the platform from this source.

## Replace

| KSS document and place | Today | Becomes |
|---|---|---|
| `01-contracts/00-database-design.md`, Migration 021 (line ~1624) "School Calendar (Non-School Days)" and its index and seed notes (lines ~347, ~1639, ~2949, ~2965, ~4392, ~4424) | `non_school_days` table; school day = Mon-Fri not in the table | The engine's tables (see below). Remove `non_school_days`. |
| `03-delivery/seed.sql` line ~1053 | Inserts into `non_school_days` | Remove. Fixed holidays are seeded by the engine (`ensureFixedHolidays`). |
| `02-implementation/01-backend-architecture.md` section 7.9b (line ~583) and the file tree (line ~153) | `calendar.service.ts`: `isSchoolDay`, `getSchoolDaysInPeriod`, `seedNationalHolidays` | The engine's services. `isSchoolDay` becomes `getDayStatus`; `getSchoolDaysInPeriod` keeps its name and its `enrolledFrom` argument; `seedNationalHolidays` becomes `ensureFixedHolidays` (the engine never calculates moving holidays; the admin enters them). |
| Same file, error table (line ~273) and `01-api-specification.md` (lines ~1593, ~3330) | `INVALID_ATTENDANCE_DATE`: not a school day | Unchanged name; the rule is now `getDayStatus(...).attendanceAvailable`, which includes Grade 12 and special days. |
| `01-api-specification.md` calendar endpoints (line ~1276-1290) | Holiday seeding and a note that there is no weekday setting | The engine's routes (see below). The fixed Mon-Fri rule stays. |
| `04-extensions/02-annual-operational-workflow.md` Phase 1 (line ~173) and the Phase 1 to Phase 2 gate | Calendar setup must finish before Registration | **Remove the gate.** Calendar setup runs in parallel with Registration and Staffing; the year only needs a valid calendar to go `READY` (the engine's `fn_*` checks). |
| `05-ux-specification/03-admin-portal.md` D.1 and D.7 (lines ~388, ~454) | One year form and a "Seed National Holidays" button | The engine's setup steps, special days, reminders and correction screens. |
| `05-ux-specification/02-teacher-portal.md` (lines ~210, ~369) | Read-only calendar of the teacher's own timetable | Add the read-only "year at a glance" page (`/calendar/[yearId]/year`). |

## Tables

The engine owns: `academic_years`, `semesters`, `holiday_occurrences`, `exam_instances`, `student_return_days`, `holiday_types`, `exam_types`, `calendar_dependencies`, `calendar_timeline_builds`, `calendar_timeline_days`, `calendar_validation_runs`, `calendar_reminders`, `special_days`, `calendar_reminder_settings`, `calendar_reminder_dispatch`, `calendar_reminder_known_dates`. The status values (`PREPARING / READY / ACTIVE / CLOSED` for years, `UPCOMING / ACTIVE / CLOSED` for semesters) already match the KSS documents. Reconcile the `academic_years` and `semesters` columns once, in the platform's migration order.

## Notifications

KSS already has an in-app `notifications` table (title, message, type, link) and a nightly job place. The engine does not write to it directly: implement the `NotificationPort` (see `docs/HANDOFF.md`) so each reminder becomes one notification row per user, and call the daily job from the nightly scheduler.

## Roles and permissions to add

`calendar.view`, `calendar.manage`, `calendar.manage_exams`, `calendar.manage_holidays`, `calendar.build_timeline`, `calendar.manage_dependencies`, `calendar.correct_history` (main admin only). Teachers and students get `calendar.view`.

## Owner decisions that change KSS wording

Grade 12 has no attendance during the national test. A special day can switch attendance off for the grades it affects. All four school tests close the school for lessons. Corrections in a closed year are main-admin only and leave no record.
