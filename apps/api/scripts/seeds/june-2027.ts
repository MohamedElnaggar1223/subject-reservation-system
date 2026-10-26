/**
 * The June 2027 pre-load (COORDINATOR_REWORK.md §8, §11): P0's packages/db/seeds/june-2027.json loaded
 * through the coordinator's set-up services, only when asked. The reference data must be loaded first
 * (`pnpm --filter @repo/db seed:reference`); teachers' names come from the git-ignored
 * packages/db/seeds/local/june-2027.teachers.json when present, else their placeholders. The actor is the
 * first admin. Idempotent: a June 2027 session already there is left as it is. It reads the API's own
 * environment (apps/api/.env: DATABASE_URL, BETTER_AUTH_SECRET), since it runs the API's services.
 *
 *   pnpm --filter @repo/api seed:june-2027
 */
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

config();
const here = path.dirname(fileURLToPath(import.meta.url));
const seedsDir = path.resolve(here, '../../../../packages/db/seeds');

const { SessionSeedFileSchema, LocalTeachersFileSchema } = await import('@repo/validations');
const { db, user, eq, asc } = await import('@repo/db');
const { loadSessionSeed } = await import('../../src/services/setup/preload.services');

const seed = SessionSeedFileSchema.parse(JSON.parse(readFileSync(path.join(seedsDir, 'june-2027.json'), 'utf8')));
const localPath = path.join(seedsDir, 'local', 'june-2027.teachers.json');
const names = existsSync(localPath) ? LocalTeachersFileSchema.parse(JSON.parse(readFileSync(localPath, 'utf8'))) : null;
const [adminUser] = await db.select({ id: user.id }).from(user).where(eq(user.role, 'admin')).orderBy(asc(user.createdAt)).limit(1);
if (!adminUser) throw new Error('No admin account yet: sign up the admin and run the db seed first');
const out = await loadSessionSeed(seed, names, adminUser.id);
console.log(`[seed:june-2027] ${out.created ? `made session ${out.sessionId} with ${out.offerings} subjects` : `left session ${out.sessionId} as it is`}${names ? '' : ' (teachers as placeholders)'}`);
await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
