import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiResponse } from '@repo/validations';
import { clientFor, admin, staff, refused, one } from './helpers';

/**
 * Proves the harness itself: the typed client reaches the in-process app,
 * the database is the freshly migrated test database, and accounts can be
 * created for every role the later suites need.
 */
describe('harness', () => {
  it('serves health and readiness through the typed client', async () => {
    const api = await clientFor();
    expect(await (await api.v1.health.$get()).json()).toEqual({ status: 'ok', version: 'v1' });
    expect(await (await api.v1.health.ready.$get()).json()).toEqual({ ready: true });
  });

  it('runs against the test database with all migrations applied', async () => {
    const { current_database } = await one<{ current_database: string }>('select current_database()');
    expect(current_database).toBe(process.env.TEST_DB_NAME ?? 'igcse_test');
    // Every migration in the journal must be applied — not a pinned number,
    // so adding a migration does not break the harness test.
    const journal = JSON.parse(
      readFileSync(path.resolve(fileURLToPath(import.meta.url), '../../../../packages/db/drizzle/meta/_journal.json'), 'utf8')
    ) as { entries: unknown[] };
    const { n } = await one<{ n: string }>('select count(*)::text as n from drizzle.__drizzle_migrations');
    expect(Number(n)).toBe(journal.entries.length);
    expect(journal.entries.length).toBeGreaterThanOrEqual(26);
  });

  it('provisions admin and finance accounts and refuses a finance officer at an admin route', async () => {
    const adm = await admin('h');
    expect((await apiResponse(adm.api.v1.session.$get())).user).toMatchObject({ role: 'admin' });
    const officer = await staff(adm, 'finance_officer', 'h');
    expect((await refused(officer.api.v1.users.$get({ query: {} }))).status).toBe(403);
    const finadmin = await staff(adm, 'finance_admin', 'h');
    expect((await apiResponse(finadmin.api.v1.session.$get())).user).toMatchObject({ role: 'finance_admin' });
  });
});
