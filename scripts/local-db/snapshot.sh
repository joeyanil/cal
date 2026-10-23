#!/bin/bash
# Regenerates supabase/schema_snapshot.sql from the local test database ("k2"),
# which scripts/local-db/setup.sh builds from the numbered migrations.
# Run it after adding a migration, then commit the result.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/supabase/schema_snapshot.sql"
clean() { grep -vE "^(SET |SELECT pg_catalog.set_config|--|CREATE SCHEMA public;|ALTER SCHEMA public)" | sed '/^$/N;/^\n$/D'; }
{
cat <<'HEADER'
-- ============================================================================
-- K2 Calendar Engine - complete picture of the database after migrations
-- 0001 .. 0021b (and the standalone bootstrap) have been applied.
--
-- WHAT THIS IS: a generated, single-file record of the final structure
-- (tables, columns, constraints, indexes, functions, triggers, row-level
-- security policies, grants) plus the built-in catalog rows (holiday types,
-- exam types, permissions, roles). Use it to see exactly what the calendar
-- engine needs, or to build an empty copy in one step.
--
-- WHAT THIS IS NOT: the way to change a live database. Live databases are
-- changed only by the numbered files in supabase/migrations, in order.
--
-- Needs the Supabase roles (anon, authenticated, service_role) and
-- auth.uid() to exist first. Regenerate with scripts/local-db/snapshot.sh.
-- ============================================================================
HEADER
echo "SET check_function_bodies = false; -- functions are created before the tables they mention"
echo
su postgres -c "pg_dump -d k2 --schema-only --no-owner --no-comments -n public" | clean
echo
echo "-- ---------------------------------------------------------------------------"
echo "-- Built-in catalog rows"
echo "-- ---------------------------------------------------------------------------"
su postgres -c "pg_dump -d k2 --data-only --column-inserts --no-owner -t public.holiday_types -t public.exam_types -t public.permissions -t public.roles -t public.role_permissions" | clean
} > "$OUT"
echo "wrote $OUT ($(wc -l < "$OUT") lines)"
