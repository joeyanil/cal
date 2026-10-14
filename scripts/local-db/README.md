# Real local test environment

`setup.sh` builds PostgreSQL with **every migration**, PostgREST, a login-token stand-in and an admin user, so the app's real save code (and the real Next.js server) can be tested against a real database with real row-level security.

- `tests-integration/realdb.test.ts` runs the app's services directly: create a year, enter the whole 2019 plan, switch every holiday off and back on, rebuild and compare learning-day counts.
- `tests-integration/e2e.test.ts` sends the wizard's exact HTTP requests to a running `next dev`.
- `diagnostic.sql` is a read-only query to paste into the Supabase SQL editor to inspect a live database (holiday rows, triggers, policies, enum values, which migration functions exist).
