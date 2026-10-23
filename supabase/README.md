# Database guide (Supabase / PostgreSQL)

Everything the calendar engine needs in the database is in this repository. Nothing has to be remembered from chat or from the Supabase SQL editor.

## 1. What to run, in what order

| Step | File | Notes |
|---|---|---|
| 0 | `standalone/0000_standalone_bootstrap.sql` | **Stand-in for the main K2 system**: `users`, roles, permissions, `has_permission()`, `fn_update_timestamp()`, `fn_audit_log()`, `audit_logs`. Replace it with the real K2 equivalents when integrating (see section 4). |
| 1 | `migrations/0001` – `0019` | The calendar engine itself. Run in numeric order. |
| 2 | `migrations/0020_calendar_exam_holiday_week.sql` | Database-level "no exam in a holiday week" rule. |
| 3 | `migrations/0021a_holiday_derg_enum.sql` | **Run this one alone, by itself.** Adds the Ginbot 20 holiday type. PostgreSQL cannot use a new enum value in the same run that creates it. |
| 4 | `migrations/0021b_holiday_switches_and_ministry_reminder.sql` | Run after 0021a. Holiday on/off switches (a moving holiday can have no date), and the optional Ministry total. |

Rules that keep the database trustworthy:
- Change a live database **only** by adding a new numbered file here and running it. Never edit the SQL editor directly without also adding the file.
- Never edit a migration that has already been run on a live database. Add the next number instead (`0022_...`).
- A migration that adds an enum value goes in its own file (like 0021a).

## 2. What each migration does

| File | Purpose |
|---|---|
| 0001 | Types and catalogs: holiday types, exam types, enums |
| 0002 | Academic years (one per Ethiopian year, with lifecycle status) |
| 0003 | Semesters |
| 0004 | Holiday occurrences (dates per year, whether school closes) |
| 0005 | Exam instances (weekend and closing-holiday rules in the database) |
| 0006 | Student return / orientation day |
| 0007 | Dependency model (one date derived from another) |
| 0008 | Timeline builds and the daily timeline |
| 0009 | Validation runs |
| 0010 | Formal corrections (audit trail) |
| 0011 | Reminders |
| 0012 | Permission catalog (`calendar.*` permissions) |
| 0013 | RPC functions (load configuration snapshot, publish timeline, and others) |
| 0014 | Table grants, including column-level update grants |
| 0015 | Configuration revision counter |
| 0016 | Lifecycle integrity (Preparing, Ready, Active, Closed) |
| 0017 | Dependency integrity |
| 0018 | Multi-fact timeline days (several holidays or exams on one day) |
| 0019 | Closed-year insertion protection |
| 0020 | Exam may not be in a week that has a school-closing holiday |
| 0021a | Adds the Ginbot 20 (Downfall of the Derg) holiday type |
| 0021b | Ginbot 20 catalog row, holiday date optional (school teaches), `ministry_target_days` column and its grant |

## 3. Checking that a live database matches this repository

1. Open the Supabase SQL editor, paste `scripts/local-db/fingerprint.sql`, run it. It only reads.
2. Compare the result with `docs/DB_FINGERPRINT.md`.
3. If a kind of object differs, paste `scripts/local-db/fingerprint_detail.sql` (change the word `functions` on its first line to the kind that differs) to list that kind object by object.

`schema_snapshot.sql` is a generated single-file picture of the final structure and the built-in rows. It is for reading and for building an empty copy in one step. Regenerate it with `scripts/local-db/snapshot.sh` after adding a migration.

## 4. Integrating into the main K2 system

The calendar engine expects the host system to provide:
- `public.users` with `id`, `supabase_uid` (matches `auth.users.id`), `user_type`, `status`;
- `public.has_permission(text)` resolving a `calendar.*` permission for the signed-in user;
- `public.fn_update_timestamp()` and `public.fn_audit_log()` triggers, and an `audit_logs` table;
- Supabase's own `auth.uid()`.

Migration 0012 registers these permissions: `calendar.view`, `calendar.manage`, `calendar.manage_exams`, `calendar.manage_holidays`, `calendar.build_timeline`, `calendar.manage_dependencies`, `calendar.correct_history`. Grant them to the right roles in the main system.

Replace `standalone/0000_standalone_bootstrap.sql` with the main system's own versions of the objects above, then run migrations 0001 to 0021b unchanged. Test the combined database with `scripts/local-db/setup.sh` and the tests in `tests-integration/` before touching production.
