#!/bin/zsh
# 09 over a converted copy: a further copy named *_test (09's env refuses anything else), the rules
# run with no global setup, the copy dropped after. Usage: run09.sh <converted copy> <short name>
set -u
SRC=$1; T=igcse_rwa_c09${2}_test
EV=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions/.audit/rework-sessions-evidence/conversion
export PGPASSWORD=auditpass
psql -h 127.0.0.1 -p 5433 -U audit -d postgres -c "DROP DATABASE IF EXISTS $T" >/dev/null
psql -h 127.0.0.1 -p 5433 -U audit -d postgres -c "CREATE DATABASE $T TEMPLATE $SRC" >/dev/null
cd /Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions/apps/api
TEST_DB_NAME=$T npx vitest run --config /tmp/rwa/conv/vitest.09.config.ts > $EV/$SRC-09.log 2>&1
grep -E "✓|×|Tests " $EV/$SRC-09.log | sed 's/^ *//' | cut -c1-170
psql -h 127.0.0.1 -p 5433 -U audit -d postgres -c "DROP DATABASE IF EXISTS $T" >/dev/null
