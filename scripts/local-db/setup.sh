#!/bin/bash
# Builds a REAL local copy of the backend so the calendar can be tested end to end:
#   PostgreSQL (all migrations) + PostgREST (the same component Supabase uses)
#   + a tiny proxy that fakes Supabase's /auth/v1/user and /rest/v1 paths
#   + one admin user and a signed login token written to /tmp/jwt.txt.
# Linux only; run as root. Needs: apt packages postgresql, node, curl, xz.
#   apt-get install -y postgresql postgresql-client
#   bash scripts/local-db/setup.sh
#   npx vitest run --config tests-integration/vitest.config.ts tests-integration/realdb.test.ts
# For the HTTP test (e2e.test.ts) also start the app:
#   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3000 NEXT_PUBLIC_SUPABASE_ANON_KEY=$(cat /tmp/jwt.txt) SUPABASE_SERVICE_ROLE_KEY=x npx next dev -p 3100
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
UID_=11111111-1111-4111-8111-111111111111
SECRET="super-secret-jwt-key-at-least-32-characters-long"
rm -f /var/lib/postgresql/16/main/postmaster.pid
(setsid nohup su postgres -c "/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main -c config_file=/etc/postgresql/16/main/postgresql.conf" > /tmp/pg.log 2>&1 &)
sleep 4
chmod 644 "$HERE"/*.sql
su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS k2'" ; su postgres -c "psql -q -c 'CREATE DATABASE k2'"
apply() { cp "$1" /tmp/apply.sql; chmod 644 /tmp/apply.sql; su postgres -c "psql -q -v ON_ERROR_STOP=1 -d k2 -f /tmp/apply.sql"; echo "applied $(basename "$1")"; }
apply "$HERE/roles_and_auth_stub.sql"
apply "$ROOT/supabase/standalone/0000_standalone_bootstrap.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do apply "$f"; done   # 0021a and 0021b each run on their own, as in production
su postgres -c "psql -q -d k2 -c \"INSERT INTO auth.users(id,email) VALUES ('$UID_','admin@test.local') ON CONFLICT DO NOTHING\""
cp "$ROOT/supabase/standalone/seed_admin.sql" /tmp/seed_admin.sql; chmod 644 /tmp/seed_admin.sql
su postgres -c "psql -q -d k2 -v admin_supabase_uid=$UID_ -v admin_full_name='Test Admin' -f /tmp/seed_admin.sql" >/dev/null
if [ ! -x /tmp/postgrest ]; then
  curl -sSL -o /tmp/pgrst.tar.xz https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  (cd /tmp && tar -xJf pgrst.tar.xz)
fi
cp "$HERE/pgrst.conf" /tmp/pgrst.conf
(cd /tmp && setsid nohup ./postgrest pgrst.conf > /tmp/pgrst.log 2>&1 &)
(setsid nohup node "$HERE/proxy.js" > /tmp/proxy.log 2>&1 &)
node -e "
const c=require('crypto');const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const h=b({alg:'HS256',typ:'JWT'});const p=b({role:'authenticated',sub:'$UID_',aud:'authenticated',exp:4102444800});
require('fs').writeFileSync('/tmp/jwt.txt',h+'.'+p+'.'+c.createHmac('sha256','$SECRET').update(h+'.'+p).digest('base64url'))"
sleep 3
echo "Ready. Database 'k2' on :5432, PostgREST on :3001, Supabase-style proxy on :3000, token in /tmp/jwt.txt"
