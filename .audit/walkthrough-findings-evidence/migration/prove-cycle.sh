#!/bin/bash
# The migration proof of 0062, 0063 and 0064 on a cycle built by main's code: igcse_findings_cycle65, a copy of
# igcse_findings_before (migrated with main 2a149dd's 62, the June 2027 cycle built by the demo script and the before
# drive's families reserved and paid, all on main's code); then the branch's migrations.
P="postgresql://audit:auditpass@127.0.0.1:5433/igcse_findings_cycle65"
WT=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/walkthrough-findings
OUT=/tmp/wf/mig/proof-cycle.txt
export PGPASSWORD=auditpass
migrate() { (cd "$WT/packages/db" && DATABASE_URL=$P pnpm exec drizzle-kit migrate 2>&1 | tr '\r' '\n' | grep -E 'applied|error|Error' | tail -2); }
{
  echo "== The migration proof of 0062, 0063 and 0064 on a cycle built by main's code, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "igcse_findings_cycle65: a copy of igcse_findings_before (main 2a149dd's 62; the demo cycle and the before drive, main's API)."
  echo
  echo "== Before"
  psql "$P" -f /tmp/wf/mig/read-cycle.sql 2>&1
  echo "== drizzle-kit migrate with the branch's set"
  migrate
  echo
  echo "== After"
  psql "$P" -f /tmp/wf/mig/read-cycle.sql 2>&1
  echo "== A second migrate, and 0064 by hand"
  migrate
  psql "$P" -f "$WT/packages/db/drizzle/0064_one_paper_whole_item_row.sql" 2>&1
  psql "$P" -c "SELECT count(*) AS migrations FROM drizzle.__drizzle_migrations" 2>&1
} > "$OUT"
cat "$OUT"
