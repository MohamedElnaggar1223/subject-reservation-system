#!/bin/zsh
set -u
EV=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions/.audit/rework-sessions-evidence/conversion
BR=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions
URL=postgresql://audit:${PGPASSWORD}@127.0.0.1:5433/igcse_rwa_conv_two
: "${PGPASSWORD:?set PGPASSWORD: the local test container password}"; export PGPASSWORD
cd /tmp/rwa/main-src/apps/api
env DATABASE_URL=$URL BETTER_AUTH_SECRET=conversion-proof-secret-at-least-32-chars NODE_ENV=test npx tsx /tmp/rwa/conv/probe.mts /tmp/rwa/main-src/apps/api $EV/igcse_rwa_conv_two-before.json 2>&1 | grep probe
cd $BR/packages/db
DATABASE_URL=$URL npx drizzle-kit migrate > $EV/igcse_rwa_conv_two-migrate-branch.log 2>&1 || { tail -20 $EV/igcse_rwa_conv_two-migrate-branch.log; exit 1; }
cd $BR/apps/api
env DATABASE_URL=$URL BETTER_AUTH_SECRET=conversion-proof-secret-at-least-32-chars NODE_ENV=test npx tsx /tmp/rwa/conv/probe.mts $BR/apps/api $EV/igcse_rwa_conv_two-after.json 2>&1 | grep probe
python3 /tmp/rwa/conv/compare.py $EV/igcse_rwa_conv_two-before.json $EV/igcse_rwa_conv_two-after.json | tee $EV/igcse_rwa_conv_two-compare.txt
psql -h 127.0.0.1 -p 5433 -U audit -d igcse_rwa_conv_two -c "select s.code, i.label, bs.label as series_label, i.availability, (select count(*) from registration r where r.offer_item_id = i.id) as lines, (select string_agg(r.status, ',') from registration r where r.offer_item_id = i.id) as statuses from session_offer_item i join session_offer o on o.id = i.offer_id join subject s on s.id = o.subject_id left join board_series bs on bs.id = i.board_series_id join registration_session w on w.id = i.session_id where w.label = 'november-igcse' and s.code in ('0417', '0400') order by s.code, bs.label" | tee -a $EV/igcse_rwa_conv_two-compare.txt
