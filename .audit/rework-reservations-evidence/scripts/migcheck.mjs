// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// A scratch database for the migration-order check: create | rows | drop. Never disconnects anyone.
import pg from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations/packages/db/node_modules/pg/lib/index.js';
const mode = process.argv[2];
const NAME = 'igcse_rwb_migcheck';
if (mode === 'create' || mode === 'drop') {
  const c = new pg.Client({ connectionString: process.env.DEV_PG_ADMIN_URL });
  await c.connect();
  const busy = await c.query(`select datname from pg_stat_activity where datname in ($1, 'igcse_template_dev')`, [NAME]);
  if (busy.rows.length) { console.log('connected sessions, nothing done:', JSON.stringify(busy.rows)); process.exit(1); }
  await c.query(`drop database if exists ${NAME}`);
  if (mode === 'create') await c.query(`create database ${NAME} template igcse_template_dev`);
  console.log(mode, NAME, 'done');
  await c.end();
} else {
  const c = new pg.Client({ connectionString: `${process.env.DEV_PG_BASE_URL}/${NAME}` });
  await c.connect();
  const r = await c.query(`select id, created_at from drizzle.__drizzle_migrations order by created_at desc limit 4`);
  const n = await c.query(`select count(*)::int as n from drizzle.__drizzle_migrations`);
  const col = await c.query(`select count(*)::int as n from information_schema.columns where table_name = 'registration' and column_name in ('declaration_rejected', 'prior_sitting_verified_outcome')`);
  const trg = await c.query(`select count(*)::int as n from pg_trigger where tgname = 'registration_confirmed_has_consent'`);
  const fn = await c.query(`select pronargs from pg_proc where proname = 'line_effective_deadline' order by pronargs`);
  console.log(JSON.stringify({ migrations: n.rows[0].n, latest: r.rows.map((x) => x.created_at), stepBColumns: col.rows[0].n, consentTrigger: trg.rows[0].n, deadlineFunctionArities: fn.rows.map((x) => x.pronargs) }));
  await c.end();
}
