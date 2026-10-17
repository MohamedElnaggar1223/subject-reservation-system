#!/bin/bash
# The migration proof on igcse_findings_walk: a fresh database migrated with main 2a149dd's 62, the June 2027 cycle
# built on it by main's code (docs/walkthrough/demo/build-june-2027.mjs), families reserved and paid on it by main's
# code; then the branch's migrations (0062, 0063).
P="postgresql://audit:auditpass@127.0.0.1:5433/igcse_findings_walk"
WT=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/walkthrough-findings
OUT=/tmp/wf/mig/proof-walk.txt
export PGPASSWORD=auditpass
{
  echo "== The migration proof of 0062 and 0063 on a cycle built by main's code, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "igcse_findings_walk: empty, migrated with main 2a149dd's 62; the demo script and the drive's families (main's API)."
  echo
  echo "== Before"
  psql "$P" -f /tmp/wf/mig/read-walk.sql 2>&1
  echo "== drizzle-kit migrate with the branch's set"
  (cd "$WT/packages/db" && DATABASE_URL=$P pnpm exec drizzle-kit migrate 2>&1 | tr '\r' '\n' | grep -E 'applied|error|Error' | tail -2)
  echo
  echo "== After"
  psql "$P" -f /tmp/wf/mig/read-walk.sql 2>&1
} > "$OUT"
cat "$OUT"
