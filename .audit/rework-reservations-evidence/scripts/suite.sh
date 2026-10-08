#!/bin/bash
# The API suite on B's tree, its log saying the commit and time zone at the top, then trimmed
# (CLAUDE.md, Git). suite.sh <commit> <local|utc>
cd /Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations
LOG=.audit/rework-reservations-evidence/suite-$1-$2.log
if [ "$2" = "utc" ]; then export TZ=UTC; fi
{
  echo "# commit $1; TZ=${TZ:-(unset: local, $(date +%Z))}; started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  TEST_DB_NAME=igcse_rwb_test pnpm --filter @repo/api test 2>&1
  echo "exit $?"
} > "$LOG.full"
head -1 "$LOG.full" > "$LOG"
cp "$LOG.full" "/tmp/rwb/$(basename "$LOG").full"
cat "$LOG.full" >> "$LOG"
rm "$LOG.full"
python3 /tmp/rwb/trim-logs.py "$(basename "$LOG")" > /dev/null
# The trimmer keeps the summary; put the commit and time zone line back on top.
{ head -1 "/tmp/rwb/$(basename "$LOG").full"; cat "$LOG"; } > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
grep -E "Test Files|Tests |^exit|^# commit" "$LOG"
