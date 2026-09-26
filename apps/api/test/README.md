# API integration tests

These tests drive the real Hono app in-process against a real Postgres and assert outcomes by
reading the database back. Every request goes through the Hono RPC client (`hc<AppType>`
bound to `appWithRoutes.request`), exactly as the web and mobile apps call the API, so a test
is typed end to end and a route change that breaks a client breaks the test at compile time
(`pnpm --filter @repo/api check-types` covers `test/` too). The only raw requests are the two
better-auth endpoints (sign-up, sign-in), which sit outside the typed surface; the apps use
better-auth's own client for those.

They are the executable form of the foundation audit (`FOUNDATION_AUDIT.md`): every money
path that was proven by hand on 26 September 2026 has a scenario here, so a change that
breaks one of them fails a test instead of a family.

## Prerequisite

A Postgres the tests may create databases in. Default: the foundation-audit container.

```bash
docker run -d --name igcse-audit-db -e POSTGRES_USER=audit -e POSTGRES_PASSWORD=auditpass \
  -e POSTGRES_DB=igcse_audit -p 127.0.0.1:5433:5432 postgres:17.5
```

Override with `TEST_PG_ADMIN_URL` (maintenance connection, must be allowed to `CREATE DATABASE`)
and optionally `TEST_DB_NAME` (default `igcse_test`).

## Run

```bash
pnpm --filter @repo/api test
```

`global-setup.ts` drops and recreates the test database and runs `pnpm db:migrate` against
it, so the schema under test is exactly what production gets. The shared packages must be
built first (`pnpm build --filter=@repo/db --filter=@repo/validations --filter=@repo/storage`).

## Layout

| File | What it covers |
|---|---|
| `00-harness.test.ts` | the harness itself: app answers, database is the migrated test DB, accounts for every role |
| `01-desk.test.ts` | desk onboarding, desk registration with cash, receipts, printable receipt data, receipt-gated drop and refund, daily takings, RF-03 |
| `02-money.test.ts` | InstaPay with partial escrow, duplicate reference (RF-07), withdrawal maker-checker, finance-admin reversal (RF-08) |
| `03-v3-flows.test.ts` | student request → parent approve, school-fee gate + waiver and the three views (RF-10), held-wallet preregistration, results → remark → outcome |

Files run one at a time and share the database; each file creates its own sessions with a
distinct (type, level) pair because only one session per pair may be active. Tests inside a
file run in order because each scenario is a chain of real money movements.

## Writing a test

Call the code the way its users do and assert the value they see, against a literal:
`expect(money(payment.amount)).toBe(3000)`, not `toBeGreaterThan(0)`. A test that would still
pass if a service returned nothing is not a test. Use `waitFor` for fire-and-forget side
effects such as notifications and emails.
