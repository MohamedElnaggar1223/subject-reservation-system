#!/bin/zsh
# The guide's final run, end to end: a fresh database built the way the deployed one is after its reset (migrations;
# the admin signed up on the sign-up page and promoted by the db seed; the board's list loaded at the API's start; the
# June 2027 pre-load with its placeholder teachers), then every part driven through the screens in the guide's order:
# the staff on Team, Part A (review and open), the families made at the desk, Part B (a parent, the desk), Part C (June
# 2028 by copying). Then gen.py writes the page and check-page.mjs checks it.
#
# It starts its own API on API_PORT against DB and stops only that one, by the PID it wrote. The web must already run
# against that API (cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:$API_PORT npx next dev --webpack -p $WEB_PORT).
# Never point it at the deployed system: it builds a practice copy.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)   # docs/admin-guide/build
DRIVE=$HERE/drive
WT=${WT:-$(cd "$HERE/../../.." && pwd)}
DB=${DB:-igcse_guide_dev}
API_PORT=${API_PORT:-3299}
WEB_PORT=${WEB_PORT:-3300}
OUT=${OUT:-/tmp/ag}
export WT BASE=http://localhost:$WEB_PORT API=http://localhost:$API_PORT SHOTS=$OUT/shots
DBURL=postgresql://audit:auditpass@127.0.0.1:5433/$DB
mkdir -p $OUT
say() { echo "== $(date -u +%FT%TZ) $*"; }
killtree() { for c in $(pgrep -P $1); do killtree $c; done; kill $1 2>/dev/null || true; }
# Whatever happens, the API this script started is stopped when it ends (by the PID it wrote, never by name).
trap 'if [ -f $OUT/api.pid ]; then killtree $(cat $OUT/api.pid); rm -f $OUT/api.pid; fi' EXIT

# The guide never shows a real teacher's name: the pre-load must use its placeholders.
if [ -e $WT/packages/db/seeds/local/june-2027.teachers.json ]; then
  echo "refusing: $WT/packages/db/seeds/local/june-2027.teachers.json holds the real teachers' names"; exit 1
fi

say "stop the API this script started before"
if [ -f $OUT/api.pid ]; then killtree $(cat $OUT/api.pid); sleep 3; rm -f $OUT/api.pid; fi
if lsof -iTCP:$API_PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "port $API_PORT is taken by another process: stop it or set API_PORT"; exit 1; fi
curl -s -o /dev/null $BASE/sign-in || { echo "no web on $BASE (see the header of this script)"; exit 1; }

say "recreate $DB"
docker exec igcse-dev-db psql -U audit -d postgres -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
cd $WT && DATABASE_URL=$DBURL pnpm --filter @repo/db db:migrate 2>&1 | tail -1
echo "migrations: $(docker exec igcse-dev-db psql -U audit -d $DB -At -c 'select count(*) from drizzle.__drizzle_migrations') of $(ls $WT/packages/db/drizzle/*.sql | wc -l | tr -d ' ')"

say "start the API on $API_PORT"
cd $WT && (DATABASE_URL=$DBURL PORT=$API_PORT BETTER_AUTH_URL=$API APP_URL=$BASE CORS_ORIGINS=$BASE nohup pnpm --filter @repo/api dev > $OUT/api.log 2>&1 & echo $! > $OUT/api.pid)
for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code}" $API/health 2>/dev/null | grep -q 200 && break; sleep 2; done
grep -m1 "\[reference\] loaded at start" $OUT/api.log || { echo "the board's list was not loaded at the API's start"; exit 1; }

rm -rf $SHOTS && mkdir -p $SHOTS
say "the admin signs up, the seed promotes"
cd $DRIVE && node s00-signup.mjs
cd $WT && DATABASE_URL=$DBURL pnpm --filter @repo/db seed 2>&1 | grep -E "Promoted" || { echo "the admin was not promoted"; exit 1; }
say "the June 2027 pre-load"
cd $WT && DATABASE_URL=$DBURL pnpm --filter @repo/api seed:june-2027 2>&1 | grep "seed:june-2027" | tee $OUT/seed.log
grep -q "teachers as placeholders" $OUT/seed.log || { echo "the pre-load did not use its placeholder teachers"; exit 1; }

cd $DRIVE
for s in a0-team a1-review b0-families b1-parent b2-desk c1-copy; do
  say "$s"
  node $s.mjs
done
say "done: $(ls $SHOTS | wc -l | tr -d ' ') shots in $SHOTS"

say "stop the API this script started"
killtree $(cat $OUT/api.pid); rm -f $OUT/api.pid

cd $HERE && SHOTS=$SHOTS python3 gen.py && node check-page.mjs ../index.html $OUT/page
