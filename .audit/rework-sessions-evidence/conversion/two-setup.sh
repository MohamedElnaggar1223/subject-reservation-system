#!/bin/zsh
# A fresh copy of the template migrated to main, with two lines of the November window in a second
# Cambridge series (one routed there, one moved there and dropped).
set -u
export PGPASSWORD=auditpass
psql -h 127.0.0.1 -p 5433 -U audit -d postgres -c "DROP DATABASE IF EXISTS igcse_rwa_conv_two" > /dev/null
psql -h 127.0.0.1 -p 5433 -U audit -d postgres -c "CREATE DATABASE igcse_rwa_conv_two TEMPLATE igcse_template_dev" > /dev/null
cd /Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions/packages/db
DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:5433/igcse_rwa_conv_two npx drizzle-kit migrate --config /tmp/rwa/main-db/main.config.ts > /dev/null 2>&1
psql -h 127.0.0.1 -p 5433 -U audit -d igcse_rwa_conv_two -c "insert into board_series (id, board_code, month, year, label) values ('bs_two', 'cambridge', 'november', 2026, 'two')" > /dev/null
psql -h 127.0.0.1 -p 5433 -U audit -d igcse_rwa_conv_two -c "insert into session_board_series (id, session_id, board_series_id, board_code, is_default) select 'sbs_two', id, 'bs_two', 'cambridge', false from registration_session where name = 'November 2026'" > /dev/null
psql -h 127.0.0.1 -p 5433 -U audit -d igcse_rwa_conv_two -f /tmp/rwa/conv/two.sql 2>&1 | tail -4
