# K2 Academic Calendar Engine

A complete, tested academic-calendar subsystem for Ethiopian (E.C.) school years: it
turns a school's dates (year, semesters, holidays, exams, student return) into a
verified day-by-day calendar, counts learning days, and checks every rule as the admin
types. Built to run standalone **and** to be dropped into the main K2 system.

**Start here:** [`docs/HANDOFF.md`](docs/HANDOFF.md) — what it does, how it is built, the
business rules, the integration checklist, and what is still open.

## What is in this repository

| Path | What it is |
|---|---|
| `src/lib/calendar/` | The domain engine: pure TypeScript, no database or framework. Ethiopian/Gregorian conversion, timeline builder, holidays, exams (placement rules + date suggestions), validation, teaching-day counts, dependencies, reminders, rollover |
| `src/lib/services/` | Persistence layer between the engine and Supabase |
| `src/app/api/v1/` | REST route handlers (years, semesters, holidays, exams, student return, timeline, validation, dependencies, corrections) |
| `src/app/calendar/`, `src/components/calendar/` | The admin screens: year list, year overview, six-step setup wizard, full-year calendar view, year status card |
| `supabase/` | **All SQL**: `migrations/0001`–`0022`, `standalone/` bootstrap, `schema_snapshot.sql`, and `README.md` (run order, integration contract) |
| `tests/` | 219 unit and screen-logic tests (`npm test`) |
| `tests-integration/` | Tests that run against a real PostgreSQL + PostgREST (`npm run test:integration`) |
| `scripts/local-db/` | Builds that real local database from the repo's SQL; database fingerprint and diagnostic queries |
| `docs/` | Handoff guide, database fingerprint, the 2019 Ministry plan audit |

Older working notes kept for history: `IMPLEMENTATION_NOTES.md`, `LEGACY_REMOVAL.md`,
`V2_REPAIR_NOTES.md`, `VERIFICATION_PATCH_NOTES.md`, `STANDALONE_DEPLOYMENT_NOTES.md`,
`DEPLOYMENT.md` (deployment steps for Cloudflare + Supabase).

## Quick start

```bash
npm install
npm test            # 219 tests
npm run typecheck
npm run build
```

Running the app needs a Supabase project with the SQL in `supabase/` applied
(see `supabase/README.md`) and three environment variables (see `.env.example`).
To try everything without a Supabase account, see `scripts/local-db/README.md`.
