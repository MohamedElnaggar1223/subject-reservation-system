#!/bin/bash
# The migration proof of 0062, 0063 and 0064 on igcse_findings_mig2, a fresh copy of igcse_template_dev (answer 2).
DBNAME=${1:-igcse_findings_mig2}
P="postgresql://audit:auditpass@127.0.0.1:5433/$DBNAME"
WT=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/walkthrough-findings
OUT=${2:-/tmp/wf/mig/proof2.txt}
export PGPASSWORD=auditpass
migrate() { (cd "$WT/packages/db" && DATABASE_URL=$P pnpm exec drizzle-kit migrate 2>&1 | tr '\r' '\n' | grep -v '^\s*$' | grep -v 'applying migrations\.\.\.' | tail -2); }
{
  echo "== The migration proof of 0062, 0063 and 0064 (F8-05 and the lead's answer 2), $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "$DBNAME: a fresh copy of igcse_template_dev (34 migrations), migrated with main 2a149dd's 62 (/tmp/wf/main-src/packages/db),"
  echo "then the fixtures fixture-at-62.sql (Edexcel one-paper items; a Cambridge one under an offer whose whole enters the award)"
  echo "and fixture-0064-at-62.sql (a Cambridge syllabus entered through option CX, its one-paper items keyed on the qualification)."
  echo
  echo "== Before (main's 62 + the fixtures)"
  psql "$P" -f /tmp/wf/mig/read2.sql 2>&1
  echo
  echo "== drizzle-kit migrate with the branch's set"
  migrate
  echo
  echo "== After"
  psql "$P" -f /tmp/wf/mig/read2.sql 2>&1
  echo
  echo "== A second migrate"
  migrate
  echo
  echo "== 0063's and 0064's statements run again by hand"
  psql "$P" -f "$WT/packages/db/drizzle/0063_board_one_paper_fee_backfill.sql" 2>&1
  psql "$P" -f "$WT/packages/db/drizzle/0064_one_paper_whole_item_row.sql" 2>&1
  echo
  echo "== After both"
  psql "$P" -f /tmp/wf/mig/read2.sql 2>&1
} > "$OUT"
cat "$OUT"
