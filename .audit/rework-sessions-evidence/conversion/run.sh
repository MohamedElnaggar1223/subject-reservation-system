#!/bin/zsh
# The conversion proof on a copy of one database: copy (wait while the source is in use; never
# disconnect anyone), migrate to main, probe with main's code, migrate to the branch, probe with
# the branch's code, then run 09's rules over the converted rows.
set -u
SRC=$1; COPY=$2
EV=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions/.audit/rework-sessions-evidence/conversion
BR=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions
mkdir -p $EV
: "${PGPASSWORD:?set PGPASSWORD: the local test container password}"; export PGPASSWORD
URL=postgresql://audit:${PGPASSWORD}@127.0.0.1:5433/$COPY
for i in $(seq 1 30); do
  out=$(psql -h 127.0.0.1 -p 5433 -U audit -d postgres -c "CREATE DATABASE $COPY TEMPLATE $SRC" 2>&1)
  if echo "$out" | grep -q "CREATE DATABASE"; then echo "copied $SRC -> $COPY"; break; fi
  if echo "$out" | grep -q "already exists"; then echo "$COPY exists"; break; fi
  echo "waiting: $out"; sleep 10
done
cd $BR/packages/db
DATABASE_URL=$URL npx drizzle-kit migrate --config /tmp/rwa/main-db/main.config.ts > $EV/$COPY-migrate-main.log 2>&1 || { echo "main migrate failed"; tail -5 $EV/$COPY-migrate-main.log; exit 1; }
ENVV=(DATABASE_URL=$URL BETTER_AUTH_SECRET=conversion-proof-secret-at-least-32-chars NODE_ENV=test)
cd /tmp/rwa/main-src/apps/api
env $ENVV npx tsx /tmp/rwa/conv/probe.mts /tmp/rwa/main-src/apps/api $EV/$COPY-before.json 2>&1 | grep -v "^\[INFO\]" | tail -3
psql -h 127.0.0.1 -p 5433 -U audit -d $COPY -Atc "select count(*) from drizzle.__drizzle_migrations" | sed 's/^/migrations before: /'
cd $BR/packages/db
DATABASE_URL=$URL npx drizzle-kit migrate > $EV/$COPY-migrate-branch.log 2>&1 || { echo "branch migrate failed"; tail -20 $EV/$COPY-migrate-branch.log; exit 1; }
psql -h 127.0.0.1 -p 5433 -U audit -d $COPY -Atc "select count(*) from drizzle.__drizzle_migrations" | sed 's/^/migrations after: /'
cd $BR/apps/api
env $ENVV npx tsx /tmp/rwa/conv/probe.mts $BR/apps/api $EV/$COPY-after.json 2>&1 | grep -v "^\[INFO\]" | tail -3
python3 /tmp/rwa/conv/compare.py $EV/$COPY-before.json $EV/$COPY-after.json | tee $EV/$COPY-compare.txt
