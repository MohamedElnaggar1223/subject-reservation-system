#!/bin/bash
# The F8 walkthrough's full run, from an empty database to the end of part 4, on the merged code in /tmp/f8-clone.
# Stops the API this agent started (by its PIDs, passed as arguments), recreates igcse_walk_dev, migrates,
# starts the API again, then drives every part in the order the events happen. Every screenshot is retaken.
set -euo pipefail
LOG=/tmp/f8/final-run.log
: > "$LOG"
say() { echo "[$(date -u +%H:%M:%SZ)] $*" | tee -a "$LOG"; }
for pid in "$@"; do kill "$pid" 2>/dev/null || true; done
sleep 3
say "api stopped: $*"
docker exec igcse-walk-db dropdb -U audit --if-exists igcse_walk_dev
docker exec igcse-walk-db createdb -U audit igcse_walk_dev
say "database recreated"
cd /tmp/f8-clone
DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:5434/igcse_walk_dev pnpm --filter @repo/db db:migrate > /tmp/f8/final-migrate.log 2>&1
say "migrated: $(docker exec igcse-walk-db psql -U audit -d igcse_walk_dev -tAc 'select count(*) from drizzle.__drizzle_migrations')"
nohup pnpm --filter @repo/api dev > /tmp/f8/api.log 2>&1 &
echo $! > /tmp/f8/api.pid
say "api started: pid $(cat /tmp/f8/api.pid)"
until curl -s -o /dev/null -w '%{http_code}' http://localhost:3191/health | grep -q 200; do sleep 1; done
rm -rf /tmp/f8-pw/shots && mkdir -p /tmp/f8-pw/shots
cd /tmp/f8-pw
run() { say "run $*"; node "$@" >> "$LOG" 2>&1 || { say "FAILED $*"; exit 1; }; }
run p1-signup.mjs
(cd /tmp/f8-clone && pnpm --filter @repo/db seed > /tmp/f8/final-seed.log 2>&1)
say "seeded: $(grep -c 'created if missing' /tmp/f8/final-seed.log) rows; $(grep 'Promoted' /tmp/f8/final-seed.log)"
until docker exec igcse-walk-db psql -U audit -d igcse_walk_dev -tAc "select status from registration_session where id='sess_june-2026'" | grep -q closed; do sleep 3; done
say "June 2026 closed by the scheduler"
run p1-first.mjs
run p2a-team.mjs
run p2b-catalogue.mjs
run p2c-settings.mjs
run p2d-session.mjs
run p2e-sheet.mjs
run p2f-fees-dates.mjs
run p2g-preview-open.mjs
run p34a-family-start.mjs
run p4b-reserve.mjs
run p4c-pay.mjs
run p2h-desk.mjs
run p2i-workbench.mjs
run p34b-request.mjs
run p2j-follow-up.mjs
run p34c-drop.mjs
run p2l-entries.mjs
run p2m-import.mjs
run p34d-end.mjs
run p5-screens.mjs
say "done: $(ls /tmp/f8-pw/shots | wc -l) shots"
