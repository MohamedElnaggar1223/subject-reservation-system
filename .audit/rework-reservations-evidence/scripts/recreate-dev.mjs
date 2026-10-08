// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// Recreate igcse_rwb_dev (B's own dev database) from igcse_template_dev. Never disconnects anyone:
// if any session is connected to either database, it stops and says who.
import pg from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations/packages/db/node_modules/pg/lib/index.js';
const c = new pg.Client({ connectionString: process.env.DEV_PG_ADMIN_URL });
await c.connect();
const busy = await c.query(`select datname, usename, application_name, client_addr, state from pg_stat_activity where datname in ('igcse_rwb_dev', 'igcse_template_dev')`);
if (busy.rows.length) {
  console.log('connected sessions, nothing done:', JSON.stringify(busy.rows));
  await c.end();
  process.exit(1);
}
await c.query('drop database if exists igcse_rwb_dev');
await c.query('create database igcse_rwb_dev template igcse_template_dev');
console.log('igcse_rwb_dev recreated from igcse_template_dev');
await c.end();
