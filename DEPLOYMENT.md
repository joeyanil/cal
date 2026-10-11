# Deploying the Calendar Engine standalone

This is for running the Calendar Engine as its own, independent product —
its own Supabase project, its own Vercel deployment, usable end to end — for
example to demo or pilot it before the real K2 platform exists to merge it
into. If you're deploying into an existing K2 environment instead, skip this
whole document: apply the calendar migrations (0001–0020) in `supabase/migrations/` against
K2's real database and you're done, exactly as `README.md` describes.

## Why this needs one extra migration

The 18 migrations in `supabase/migrations/` are the actual product — they
assume K2's own `users` table, `has_permission()` function, and
`audit_logs` table already exist, because on a real K2 deployment they
would. Running this subsystem standalone means nothing has created those
yet, so `supabase/standalone/0000_standalone_bootstrap.sql` provides a
real, production-quality version of them first. Every table and function it
creates is commented `STANDALONE-MODE SCAFFOLDING` — see that file's header
for exactly what to do with it once a real K2 exists to merge into.

## Steps

1. **Create a Supabase project.** [database.new](https://database.new) (or
   the Supabase dashboard → New Project). Note the project's connection
   string, URL, and keys — you'll need them below.

2. **Apply the bootstrap migration, then the 18 calendar migrations, in
   this exact order**, via the Supabase SQL Editor (paste each file's
   contents and run it) or `psql "$DATABASE_URL" -f <file>` from a
   terminal with the Postgres connection string:

   ```
   supabase/standalone/0000_standalone_bootstrap.sql
   supabase/migrations/0001_calendar_types_and_catalogs.sql
   supabase/migrations/0002_calendar_academic_years.sql
   supabase/migrations/0003_calendar_semesters.sql
   supabase/migrations/0004_calendar_holidays.sql
   supabase/migrations/0005_calendar_exams.sql
   supabase/migrations/0006_calendar_student_return.sql
   supabase/migrations/0007_calendar_dependencies.sql
   supabase/migrations/0008_calendar_timeline.sql
   supabase/migrations/0009_calendar_validation_runs.sql
   supabase/migrations/0010_calendar_corrections.sql
   supabase/migrations/0011_calendar_reminders.sql
   supabase/migrations/0012_calendar_permissions_catalog.sql
   supabase/migrations/0013_calendar_rpc_functions.sql
   supabase/migrations/0014_calendar_table_grants.sql
   supabase/migrations/0015_calendar_config_revision.sql
   supabase/migrations/0016_calendar_lifecycle_integrity.sql
   supabase/migrations/0017_calendar_dependency_integrity.sql
   supabase/migrations/0018_calendar_timeline_multi_fact.sql
   supabase/migrations/0019_calendar_closed_year_insert_protection.sql
   supabase/migrations/0020_calendar_exam_holiday_week.sql
   supabase/migrations/0021a_holiday_derg_enum.sql        (run ALONE, first)
   supabase/migrations/0021b_holiday_switches_and_ministry_reminder.sql
   ```

   (If your Supabase project's CLI/migration tooling wants everything in
   one `supabase/migrations/` folder with sequential names, copy the
   bootstrap file in ahead of the rest as `0000_standalone_bootstrap.sql` —
   its filename already sorts first.)

3. **Set the app's environment variables** — locally in `.env.local` (copy
   `.env.example`), and in Vercel's Project Settings → Environment
   Variables for the deployed app:

   | Variable | Where to find it |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page, "anon public" key |
   | `SUPABASE_SERVICE_ROLE_KEY` | same page, "service_role" key — **server-side only, never expose to the browser** |

4. **Sign up the first admin through Supabase Auth.** Use the app's own
   sign-up screen once it's running (locally or deployed), or Supabase
   Studio → Authentication → Users → "Add user". Either way, note the
   resulting user's UUID (Supabase Studio shows it in the users list).

5. **Seed that person as an admin** — `withAuth()` rejects anyone without a
   matching `users` row, so this step is required before they can use the
   app at all:

   ```bash
   psql "$DATABASE_URL" \
     -v admin_supabase_uid="<the UUID from step 4>" \
     -v admin_full_name="Jane Doe" \
     -f supabase/standalone/seed_admin.sql
   ```

   This creates an "Admin" role holding every `calendar.*` permission,
   links it to that person's `users` row, and prints a confirmation row
   listing the permissions granted. It's safe to re-run (e.g. to fix a
   typo'd name, or to pick up a new `calendar.*` permission added by a
   future migration).

6. **Deploy to Vercel.** Connect the repo (or run `vercel`), set the three
   environment variables from step 3 in the Vercel project, and deploy.
   `npm run build` is a genuine `next build` — no additional build-time
   configuration is needed beyond those environment variables.

7. **Sign in as the seeded admin and confirm the app loads the calendar
   dashboard** (`/calendar`) without a 401/403. If it doesn't, see
   Troubleshooting below.

## Deploying to Cloudflare Workers (instead of Vercel)

This repo also includes a Cloudflare Workers build path, via the
[OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare)
(`@opennextjs/cloudflare`, `wrangler.jsonc`, `open-next.config.ts`,
`cloudflare-env.d.ts`). It targets **Workers**, not Pages — Cloudflare's
own guidance as of 2026 is that the OpenNext/Workers path is preferred
over the older, now-legacy "Next on Pages" adapter, which requires every
route to run on the Edge runtime. This app's API routes use the default
Node.js runtime (Supabase server client, etc.), which Workers supports
via the `nodejs_compat` compatibility flag already set in
`wrangler.jsonc`.

Steps, after completing 1–5 above (Supabase project, migrations, admin
seed):

1. `npm install`
2. Create `.env.local` (copy `.env.example`) with the same three Supabase
   variables from step 3 above. These are needed at build time — the two
   `NEXT_PUBLIC_*` values get embedded into the client bundle by
   `next build`.
3. `npx wrangler login` — authenticates the Wrangler CLI in your browser.
4. `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` — paste the real
   key when prompted. This is a Cloudflare Worker secret, resolved at
   runtime via `process.env` (thanks to `nodejs_compat`) — it is **not**
   read from `.env.local` in production, only during the local build.
5. `npm run deploy` — runs `opennextjs-cloudflare build` then
   `opennextjs-cloudflare deploy`. First run creates the
   `k2-calendar-engine` Worker; prints its `*.workers.dev` URL when done.
6. To test locally in the actual Workers runtime first: `npm run preview`.

## Troubleshooting

- **401 `UNAUTHENTICATED` right after signing in** — the signed-in
  Supabase Auth user has no matching `users` row yet. Re-run step 5 with
  their correct UUID.
- **403 `ACCOUNT_SUSPENDED`** — their `users.status` is `'SUSPENDED'`. Run
  `UPDATE users SET status = 'ACTIVE' WHERE supabase_uid = '<uuid>';`
  against the database.
- **403 on every calendar action despite being seeded** — confirm Migration
  0012 actually ran (`SELECT * FROM permissions WHERE resource =
  'calendar';` should return 7 rows) before you ran the seed script; if it
  ran afterward, re-run `seed_admin.sql` to pick up the missing grants.
- **A migration fails partway through** — each file in
  `supabase/migrations/` is a single transaction-safe unit written to be
  applied in order; if one fails, fix the reported error and re-apply from
  that file onward rather than from the beginning (earlier files are
  idempotent-safe to skip once successfully applied, but not designed to
  be re-run after later ones already have been).


## Keeping a free Supabase project awake

Free projects pause after about a week with no activity. The workflow in
`docs/keep-supabase-awake.yml` sends one small request every 3 days. It must be
moved to `.github/workflows/keep-supabase-awake.yml` (done in the GitHub web
uI: open the file, tap the pencil, change the file path, commit). Add two repository secrets (GitHub > Settings > Secrets and variables
> Actions): `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then run the workflow once
by hand (Actions > Keep Supabase awake > Run workflow) to confirm it says
"Project is awake." GitHub stops scheduled workflows in a repository with no
activity for 60 days; any push re-enables it.
