/**
 * Load the reference data (COORDINATOR_REWORK.md §7, §11) from packages/db/reference/*.json into the
 * database: boards.json and subjects/<board>.json (P0's files). Idempotent: run it again after the
 * files change. The June 2027 pre-load is a separate seed, run only when asked (P0's seeds).
 *
 * Usage:  pnpm --filter @repo/db seed:reference
 */

import { config } from 'dotenv';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

config();
config({ path: '../../apps/api/.env' });

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'reference');
if (!existsSync(path.join(dir, 'boards.json'))) {
  console.error(`No reference data at ${dir}/boards.json (P0 writes it).`);
  process.exit(1);
}

const { db, loadReference } = await import('./src/index');
type Data = Parameters<typeof loadReference>[1];

const boards = JSON.parse(readFileSync(path.join(dir, 'boards.json'), 'utf8')) as Data['boards'];
const subjects: Data['subjects'] = {};
const subjectsDir = path.join(dir, 'subjects');
if (existsSync(subjectsDir)) {
  for (const f of readdirSync(subjectsDir).filter((x) => x.endsWith('.json')).sort()) {
    const board = f.replace(/\.json$/, '') as keyof Data['subjects'];
    subjects[board] = JSON.parse(readFileSync(path.join(subjectsDir, f), 'utf8'));
  }
}

const result = await loadReference(db, { boards, subjects });
console.log(`[reference] loaded: ${JSON.stringify(result)}`);
await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
