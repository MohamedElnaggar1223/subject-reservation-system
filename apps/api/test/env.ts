/**
 * Test environment. Runs before any test file (vitest setupFiles), so every
 * value is in place before src/env.ts, @repo/db, or better-auth are imported.
 * `dotenv/config` (pulled in by src/lib/auth.ts) never overrides an existing
 * variable, so apps/api/.env cannot redirect tests at a real database.
 */
export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? 'igcse_test';

/** Maintenance connection used only to create/drop the test database. */
export const TEST_PG_ADMIN_URL =
  process.env.TEST_PG_ADMIN_URL ?? 'postgresql://audit:auditpass@127.0.0.1:5433/postgres';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? TEST_PG_ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, `/${TEST_DB_NAME}$1`);

// The run drops TEST_DB_NAME. Refuse anything that is not obviously a test
// database, and refuse a DATABASE_URL that names a different database than
// the one being dropped and migrated — both mistakes would otherwise only
// show up after the drop.
if (!/^[a-z_][a-z0-9_]*_test$/.test(TEST_DB_NAME)) {
  throw new Error(`TEST_DB_NAME must end in _test (got '${TEST_DB_NAME}')`);
}
const urlDb = /\/([^/?]+)(\?.*)?$/.exec(TEST_DATABASE_URL)?.[1];
if (urlDb !== TEST_DB_NAME) {
  throw new Error(`TEST_DATABASE_URL names database '${urlDb}' but TEST_DB_NAME is '${TEST_DB_NAME}'`);
}

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3999', // never listened on; env.ts requires >= 1
  DATABASE_URL: TEST_DATABASE_URL,
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
  BETTER_AUTH_URL: 'http://localhost:3001',
  CORS_ORIGINS: 'http://localhost:3000',
  APP_URL: 'http://localhost:3000',
  REQUIRE_EMAIL_VERIFICATION: 'false',
  // Hundreds of in-process requests share one "IP"; never throttle a test run.
  AUTH_RATE_LIMIT_MAX: '1000000',
  API_RATE_LIMIT_MAX: '1000000',
  SCHOOL_BANK_NAME: 'Test Bank',
  SCHOOL_ACCOUNT_NAME: 'IGCSE School (test)',
  SCHOOL_ACCOUNT_NUMBER: '0000000000000000',
};

for (const [key, value] of Object.entries(defaults)) {
  if (process.env[key] === undefined || key === 'DATABASE_URL' || key === 'NODE_ENV') {
    process.env[key] = value;
  }
}
