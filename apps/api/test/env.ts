/**
 * Test environment. Runs before any test file (vitest setupFiles), so every
 * value is in place before src/env.ts, @repo/db, or better-auth are imported.
 * The app never loads apps/api/.env itself (only src/index.ts, the server
 * entry, imports `dotenv/config`), so that file cannot reach a test run at
 * all; what the shell holds is handled below.
 */
import { tmpdir } from 'node:os';
import path from 'node:path';

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
  // Uploads go to the local store (R2 keys are blanked below), one directory
  // per test database so parallel suites on this machine never share files.
  LOCAL_UPLOAD_DIR: path.join(tmpdir(), `igcse-uploads-${TEST_DB_NAME}`),
};

for (const [key, value] of Object.entries(defaults)) {
  if (process.env[key] === undefined || key === 'DATABASE_URL' || key === 'NODE_ENV') {
    process.env[key] = value;
  }
}

// The suite must never talk to a third party. The .env file is kept out by
// index.ts being the only dotenv loader; a key exported in the developer's
// shell would still reach the process, so every third-party credential is
// blanked here unconditionally and each integration stays in stub mode. On
// 26 Sep 2026, when app.ts still loaded .env, a run tried to send real mail
// through Resend for every notification the tests triggered.
// PAYMOB_REDIRECT_URL is deliberately absent: src/env.ts validates it with
// .url(), which an empty string fails, and it is not a credential.
const THIRD_PARTY_KEYS = [
  'RESEND_API_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'PAYMOB_API_KEY',
  'PAYMOB_HMAC_SECRET',
  'PAYMOB_SECRET_KEY',
  'PAYMOB_PUBLIC_KEY',
  'PAYMOB_INTEGRATION_ID',
  'FAWRY_MERCHANT_CODE',
  'FAWRY_SECURE_KEY',
];
for (const key of THIRD_PARTY_KEYS) {
  process.env[key] = '';
}
