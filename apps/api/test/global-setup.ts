/**
 * Once per test run: recreate the test database and apply every migration
 * through the project's own migration command, so the schema under test is
 * exactly what `pnpm db:migrate` produces in production.
 *
 * Runs in vitest's main process, not in a worker, so it must not leave open
 * handles behind: the maintenance pool is ended explicitly.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TEST_DB_NAME, TEST_DATABASE_URL, TEST_PG_ADMIN_URL } from './env';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPackageDir = path.resolve(here, '../../../packages/db');

export default async function globalSetup() {
  // Point @repo/db at the maintenance database for the create/drop only.
  // This process never imports the app, so the module-level pool inside
  // @repo/db is the maintenance pool and nothing else.
  process.env.DATABASE_URL = TEST_PG_ADMIN_URL;
  const { db, sql } = await import('@repo/db');

  if (!/^[a-z_][a-z0-9_]*$/.test(TEST_DB_NAME)) {
    throw new Error(`Refusing to use test database name '${TEST_DB_NAME}'`);
  }
  await db.execute(sql.raw(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`));
  await db.execute(sql.raw(`CREATE DATABASE ${TEST_DB_NAME}`));
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();

  execFileSync('pnpm', ['db:migrate'], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });

  // Leave the database in place after the run so a failing scenario can be
  // inspected; the next run drops it.
  return async () => {};
}
