#!/bin/zsh
# The admin guide's final run: an empty database built the way the deployed one is (migrations, the admin signed
# up on the sign-up page and promoted by the seed, no samples), then every chapter driven through the screens in the
# guide's order. Stops only the API it started (by the PID in /tmp/ag/api.pid) and starts it again on the new database.
set -e
WT=${WT:-$(cd "$(dirname "$0")/../../../.." && pwd)}
DB=${DB:-igcse_guide_dev}
cd "$(dirname "$0")"
echo "== $(date -u +%FT%TZ) stop the API started for the guide"
if [ -f /tmp/ag/api.pid ]; then
  P=$(cat /tmp/ag/api.pid)
  for c in $(pgrep -P $P); do for g in $(pgrep -P $c); do kill $g 2>/dev/null || true; done; kill $c 2>/dev/null || true; done
  kill $P 2>/dev/null || true
  sleep 3
fi
echo "== $(date -u +%FT%TZ) recreate $DB"
docker exec igcse-dev-db psql -U audit -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
cd $WT && DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:5433/$DB pnpm --filter @repo/db db:migrate 2>&1 | tail -1
echo "migrations: $(docker exec igcse-dev-db psql -U audit -d $DB -At -c 'select count(*) from drizzle.__drizzle_migrations')"
cd $WT && (nohup pnpm --filter @repo/api dev > /tmp/ag/api.log 2>&1 & echo $! > /tmp/ag/api.pid)
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}" http://localhost:3231/health 2>/dev/null | grep -q 200 && break; sleep 2; done
echo "== $(date -u +%FT%TZ) API up (pnpm pid $(cat /tmp/ag/api.pid))"
rm -rf /tmp/ag/shots && mkdir -p /tmp/ag/shots
cd "$(dirname "$0")" && node s00-signup.mjs
cd $WT && DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:5433/$DB pnpm --filter @repo/db seed 2>&1 | grep -E "Promoted|samples|Seed" || true
cd "$(dirname "$0")"
for s in d1-start d2-team d3-subjects d4-catalogue d5-settings d6-session d7-fees-dates d8-preview-open; do
  echo "== $(date -u +%FT%TZ) $s"
  node $s.mjs
done
echo "== $(date -u +%FT%TZ) done: $(ls /tmp/ag/shots | wc -l) shots"
