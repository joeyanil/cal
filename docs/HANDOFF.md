# Handoff and integration guide

This engine was built and tested as a standalone tool and is ready to be merged into the
main K2 system. This guide is the one document to read before doing that.

## 1. What it does

For one Ethiopian school year at a time (2019 E.C. is the reference year):

- **Year** with a lifecycle: Preparing, Ready, Active, Closed (one Active year at a time; a Closed year is locked).
- **Semesters** (two), and the **break between them**, worked out automatically.
- **Holidays**: six permanent ones are added automatically (New Year, Genna, Timkat, Adwa, Patriots' Day, Downfall of the Derg on Ginbot 20); four move every year and are entered by hand (Siklet, Fasika, Eid al-Fitr, Eid al-Adha). **Every** holiday has an on/off switch for schools that still teach that day; a moving holiday that is off needs no date.
- **Exams** (five): placement rules are enforced in the app and in the database. No exam on a weekend, on a closing holiday, or in any Monday–Friday week that contains one. While typing, the admin sees the problem in Ethiopian dates plus one-tap fixes (swap, nearest earlier, nearest later window).
- **Student return day** (orientation: no lessons, no attendance).
- **Daily timeline**: every calendar day gets exactly one type (learning day, exam day, holiday, semester break, student return, last day of year, weekend), built deterministically and verified after building.
- **Counts**: learning days, exam days, days without lessons, per semester and per month. Optional "Ministry total" reminder for comparison only.
- **Validation** with four levels (Missing, Error, Warning, Information); a year cannot become Ready with missing items or errors.
- **API only (no screen yet)**: dependency rules (one date derived from another), formal corrections to a Closed year with audit trail. **Engine logic only (no screen, route or scheduled job yet)**: reminders (the `calendar_reminders` table exists) and year-to-year rollover.

## 2. Business rules decided during the build

These came from the Ministry's 2019 E.C. plan and from decisions made with the product owner. Change them deliberately, not by accident.

| Rule | Decision |
|---|---|
| Learning day | A weekday that is not a closing holiday, exam day (school-closing exam), semester-break day, student-return day or the last day of the year. Lessons are held and attendance is taken. |
| Exam day | Held **at school**; no lessons and no attendance. Counted separately. |
| Last day of the school year | Never a teaching day; no attendance. |
| Grade 12 national exam | Held outside the school's timetable; school stays open; those days stay learning days. (Open question below.) |
| Holiday on a weekend | Counts as a weekend day; no school day is lost. Decided from the real date of that year, never hard-coded. |
| Holiday outside the school year | No effect (for example New Year, Meskerem 1, when the year starts on Meskerem 4). |
| Ginbot 20 (Downfall of the Derg) | Added as a permanent holiday, **on by default**; a school can switch it off. It is not in the Ministry 2019 plan. |
| Moving holidays | Never calculated by the system; always typed from the Ministry plan or the religious authority. |
| Exams and holiday weeks | No exam in a Monday–Friday week containing a school-closing holiday (Ministry notice). |
| Ministry day total | Optional reminder typed by the admin; never drives a count. |
| Not modelled | Vocational-choice week (Sene 1–6), teacher-only days before school opens (Nehase 25 to Pagume 5). |

2019 E.C. reference numbers (all ten holidays on): 297 calendar days, 179 learning days, 20 exam days. All ten off: 186 learning days.

## 3. How it is built

- **Next.js 15 (App Router) + TypeScript + Tailwind**, Supabase (PostgreSQL, Auth, row-level security), `kenat` for Ethiopian dates, `zod` for input checks.
- `src/lib/calendar/`: the engine. Pure functions only; this is the part to protect with tests.
- `src/lib/services/`: each service checks the caller's permission, talks to Supabase, and throws `AppError` with a stable code (`src/lib/errors/codes.ts`).
- `src/app/api/v1/`: thin route handlers. `withAuth()` resolves the signed-in user and permissions.
- UI: `src/components/calendar/` (`SetupWizard`, `YearView`, `YearStatusCard`, `EthiopianDateField`, `ValidationPanel`), pages in `src/app/calendar/`.
- Deployment: Cloudflare Workers through OpenNext (`npm run deploy`), see `DEPLOYMENT.md`.

## 4. Environment variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (these two are baked in at build time, so they must be **build** variables), and `SUPABASE_SERVICE_ROLE_KEY` (server only).

## 5. Integration checklist

1. **Database contract.** Read `supabase/README.md` section 4. The main system must provide `users`, `has_permission(text)`, `fn_update_timestamp()`, `fn_audit_log()` and `audit_logs`. Replace `supabase/standalone/0000_standalone_bootstrap.sql` with the main system's versions.
2. **Run the SQL** in the order given in `supabase/README.md`: migrations 0001 to 0022, with **0021a run on its own**. Never edit a migration that has run; add the next number.
3. **Permissions.** Grant the seven `calendar.*` permissions (`view`, `manage`, `manage_exams`, `manage_holidays`, `build_timeline`, `manage_dependencies`, `correct_history`) to the right roles.
4. **Auth.** Pages redirect signed-out visitors to `/login`; change `src/app/calendar/layout.tsx` if the main system uses another path. The layout uses a stand-in shell (`src/components/layout/`); replace it with the main system's shell.
5. **Mount** the `/calendar` pages and `/api/v1` routes in the main app (or keep this app as a sub-application).
6. **Verify.** `npm test`, `npm run typecheck`, `npm run build`, then `bash scripts/local-db/setup.sh` and `npm run test:integration` against a database built from the combined SQL.
7. **Check the live database** against the repo with `scripts/local-db/fingerprint.sql` and `docs/DB_FINGERPRINT.md`.
8. **Create each year, run its setup wizard to the end** (Save & build calendar), then mark it Ready and Active.

## 6. Tests

| Command | What it covers |
|---|---|
| `npm test` | 219 tests: date conversion, timeline, holidays, exams and suggestions, validation, wizard logic, year summary, holiday impact across 21 years |
| `npm run test:integration` | Real PostgreSQL + PostgREST: every holiday off and back on, the full wizard over HTTP, security rules from migration 0022 (needs `scripts/local-db/setup.sh` first, Linux) |
| `tests-integration/ui/` | Screen bugs found by rendering every page in a real browser (optional: `npm i --no-save jsdom @testing-library/react @testing-library/dom`) |

## 7. Open items and known limits

- **Grade 12 exam week.** The Ministry text says secondary-school teaching is interrupted; the engine keeps school open. Decide which applies to your schools.
- **Fasika date.** Miazia 24, 2019 (Sunday, May 2, 2027) is not in the Ministry plan; confirm it.
- **Eid dates** depend on moon sighting. If Eid al-Adha is announced for Monday (Ginbot 9) it removes one learning day.
- **Two internal helper functions** (`fn_bump_calendar_config_revision`, `fn_audit_log`) can still be called by any *signed-in* user. Logged-out access was closed in migration 0022. When the real roles exist, make the revision-bump triggers `SECURITY DEFINER` and revoke `authenticated` from them.
- **Leaked-password protection** is a Supabase dashboard setting; turn it on in the real project.
- **Free Supabase projects pause after a week idle.** A keep-alive workflow is provided in `docs/keep-supabase-awake.yml` (move it to `.github/workflows/`).
- **No export or print** (PDF, Excel) of the calendar yet.
- **Phones have no navigation menu** beyond the top bar; the only module today is Academic Years.
- Not modelled: vocational-choice week, teacher-only days (see section 2).

## 8. Document index

`docs/HANDOFF.md` (this file) · `supabase/README.md` (database) · `docs/DB_FINGERPRINT.md` (check a live database) · `docs/MINISTRY_2019_AUDIT.md` (the Ministry plan checked against the engine) · `DEPLOYMENT.md` (Cloudflare + Supabase) · `scripts/local-db/README.md` (real local test database) · older notes listed in `README.md`.
