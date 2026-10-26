/**
 * Load the reference data (COORDINATOR_REWORK.md §7, §11) from packages/db/reference/*.json into the
 * database: boards.json and subjects/<board>.json (P0's files), read through P0's schemas
 * (scripts/reference-files.ts). Idempotent: run it again after the files change. The June 2027
 * pre-load is a separate seed, run only when asked (`pnpm --filter @repo/api seed:june-2027`).
 *
 * Usage:  pnpm --filter @repo/db seed:reference
 */

import { config } from 'dotenv';

config();
config({ path: '../../apps/api/.env' });

const { loadReferenceFiles } = await import('./scripts/reference-files');
const files = loadReferenceFiles();
const { db, loadReference } = await import('./src/index');
const result = await loadReference(db, { boards: files.boards, subjects: files.subjects });
const { adminDatesKept, ...counts } = result;
console.log(`[reference] loaded: ${JSON.stringify(counts)}`);
for (const w of adminDatesKept) console.log(`[reference] warning: ${w}`);
await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
