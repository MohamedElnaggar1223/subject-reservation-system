// Read-only query against B's dev database (the API's own DATABASE_URL): q.mjs "<sql>"
import { readFileSync } from 'node:fs';
import pg from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations/packages/db/node_modules/pg/lib/index.js';
const env = readFileSync('/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations/apps/api/.env', 'utf8');
const url = env.split('\n').find((l) => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim();
const c = new pg.Client({ connectionString: url });
await c.connect();
const r = await c.query(process.argv[2]);
console.log(JSON.stringify(r.rows));
await c.end();
