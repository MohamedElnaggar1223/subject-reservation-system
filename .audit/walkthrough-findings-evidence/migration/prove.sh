#!/bin/bash
# The migration proof of 0062 and 0063 on igcse_findings_mig (item 1, F8-05).
DBNAME=${1:-igcse_findings_mig}
P="postgresql://audit:auditpass@127.0.0.1:5433/$DBNAME"
WT=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/walkthrough-findings
OUT=${2:-/tmp/wf/mig/proof.txt}
export PGPASSWORD=auditpass
migrate() { (cd "$WT/packages/db" && DATABASE_URL=$P pnpm exec drizzle-kit migrate 2>&1 | tr '\r' '\n' | grep -v '^\s*$' | grep -v 'applying migrations\.\.\.' | tail -2); }
{
  echo "== The migration proof of 0062 and 0063 (item 1, F8-05), $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "$DBNAME: a fresh copy of igcse_template_dev (34 migrations), migrated with main 2a149dd's 62 (/tmp/wf/main-src/packages/db),"
  echo "then the fixture /tmp/wf/mig/fixture-at-62.sql (main's one-paper items, keyed on the qualification)."
  echo
  echo "== Before (main's 62 + the fixture)"
  psql "$P" -f /tmp/wf/mig/read.sql 2>&1
  echo
  echo "== drizzle-kit migrate with the branch's set"
  migrate
  echo
  echo "== After"
  psql "$P" -f /tmp/wf/mig/read.sql 2>&1
  echo
  echo "== A second migrate"
  migrate
  echo
  echo "== 0063's statements run again by hand"
  psql "$P" -f "$WT/packages/db/drizzle/0063_board_one_paper_fee_backfill.sql" 2>&1
  echo
  echo "== After both"
  psql "$P" -f /tmp/wf/mig/read.sql 2>&1
} > "$OUT"
cat "$OUT"
