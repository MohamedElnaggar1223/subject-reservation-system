#!/bin/bash
# F8-01's seed, proven on igcse_findings_seed (empty, the branch's 64 migrations): `seed` promotes the first admin and
# makes nothing else; ADMIN_EMAIL names another address; `--with-samples` adds the samples as before.
DB=postgresql://audit:auditpass@127.0.0.1:5433/igcse_findings_seed
WT=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/walkthrough-findings
export PGPASSWORD=auditpass
counts() { psql "$DB" -Atc "select 'subjects=' || (select count(*) from subject) || ' sessions=' || (select count(*) from registration_session) || ' admins=' || coalesce((select string_agg(email, ',' order by email) from \"user\" where role = 'admin'), '(none)')"; }
run() { (cd "$WT/packages/db" && DATABASE_URL=$DB pnpm exec tsx seed.ts "$@" 2>&1 | grep -v '^\s*$' | grep -v '^\[dotenv'); }
{
  echo "== seed proof, $(date -u +%Y-%m-%dT%H:%M:%SZ): igcse_findings_seed, empty, the branch's 64 migrations"
  echo "-- before: $(counts)"
  psql "$DB" -qc "insert into \"user\" (id, name, email, role) values ('seed-proof-admin', 'School Admin', 'admin@igcse.local', 'user'), ('seed-proof-head', 'Head of Finance', 'head@school.example', 'user')"
  echo "-- two accounts signed up (placeholders): $(counts)"
  echo; echo "== seed (no flag)"; run
  echo "-- after: $(counts)"
  echo; echo "== ADMIN_EMAIL=head@school.example seed"; ADMIN_EMAIL=head@school.example run
  echo "-- after: $(counts)"
  echo; echo "== seed --with-samples"; run --with-samples | head -8; echo "   …"
  echo "-- after: $(counts)"
  echo; echo "== seed --with-samples again (changes nothing)"; run --with-samples | tail -3
  echo "-- after: $(counts)"
} > /tmp/wf/mig/seed-proof.txt
cat /tmp/wf/mig/seed-proof.txt
