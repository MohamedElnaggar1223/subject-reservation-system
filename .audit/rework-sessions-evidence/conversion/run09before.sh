#!/bin/zsh
# Main's 09 over the state before conversion: a copy of the source migrated to main only.
# Usage: run09before.sh <source> <short name>
set -u
SRC=$1; T=igcse_rwa_c09${2}b_test
EV=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions/.audit/rework-sessions-evidence/conversion
: "${PGPASSWORD:?set PGPASSWORD: the local test container password}"; export PGPASSWORD
psql -h 127.0.0.1 -p 5433 -U audit -d postgres -c "DROP DATABASE IF EXISTS $T" >/dev/null 2>&1
for i in $(seq 1 30); do
  out=$(psql -h 127.0.0.1 -p 5433 -U audit -d postgres -c "CREATE DATABASE $T TEMPLATE $SRC" 2>&1)
  if echo "$out" | grep -q "CREATE DATABASE"; then break; fi
  echo "waiting: $out"; sleep 10
done
cd /Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions/packages/db
DATABASE_URL=postgresql://audit:${PGPASSWORD}@127.0.0.1:5433/$T npx drizzle-kit migrate --config /tmp/rwa/main-db/main.config.ts > /dev/null 2>&1
cd /tmp/rwa/main-src/apps/api
TEST_DB_NAME=$T npx vitest run --config /tmp/rwa/conv/vitest.09.main.config.ts > $EV/$SRC-09-before.log 2>&1
grep -E "×|Tests " $EV/$SRC-09-before.log | sed 's/^ *//' | cut -c1-170
psql -h 127.0.0.1 -p 5433 -U audit -d postgres -c "DROP DATABASE IF EXISTS $T" >/dev/null
