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

A Postgres the tests may create databases in. Default: the local dev container below (the
same user, password and port the CI workflow's Postgres service uses).

```bash
docker run -d --name igcse-dev-db -e POSTGRES_USER=audit -e POSTGRES_PASSWORD=auditpass \
  -e POSTGRES_DB=igcse_audit -p 127.0.0.1:5433:5432 postgres:17.5
```

Override with `TEST_PG_ADMIN_URL` (maintenance connection, must be allowed to `CREATE DATABASE`)
and optionally `TEST_DB_NAME` (default `igcse_test`).

The suite never talks to a third party. The app does not load `apps/api/.env` (only the
server entry `src/index.ts` does), and `env.ts` blanks every Resend, R2 and payment key the
shell might hold before the app is imported; the harness test asserts the email module the
app uses is in stub mode.

## Run

```bash
pnpm --filter @repo/api test
```

`global-setup.ts` drops and recreates the test database and runs `pnpm db:migrate` against
it, so the schema under test is exactly what production gets. The shared packages must be
built first (`pnpm build --filter=@repo/db --filter=@repo/validations --filter=@repo/storage`).

The same three gates run in GitHub Actions on every pushed branch and every pull request
(`.github/workflows/ci.yml`), so a worktree branch can be pushed to get a verdict before it is
merged; a red run on `main` is fixed before anything else lands.

## Layout

| File | What it covers |
|---|---|
| `00-harness.test.ts` | the harness itself: app answers, database is the migrated test DB, accounts for every role |
| `01-desk.test.ts` | desk onboarding, desk registration with cash, receipts, printable receipt data, receipt-gated drop and refund, daily takings, RF-03 |
| `02-money.test.ts` | InstaPay with partial escrow, duplicate reference (RF-07), withdrawal maker-checker, finance-admin reversal (RF-08) |
| `03-v3-flows.test.ts` | student request → parent approve, school-fee gate + waiver and the three views (RF-10), held-wallet preregistration, results → remark → outcome |
| `04-authz-matrix.test.ts` | every /v1 endpoint called as each of six principals; the result must match `authz-policy.tsv` (security audit) |
| `05-object-access.test.ts` | one family's parent and student against another family's records of every kind; each attempt refused, nothing changed |
| `06-auth-surface.test.ts` | privilege escalation through better-auth, session token exposure, cookie flags, cross-site writes, body limit, rate-limit keying, security headers, teacher contact details |
| `07-audit-trail.test.ts` | the actions that move money, grant access to a child or change fees leave an audit row before the response |
| `08x1-exam-entries.test.ts` | F4: candidates (UCI, numbers per series), entries derived per component, the entry list's check, MO-10's hard stop with withdrawal fees and amendments, forecasts, national IDs hidden (docs/features/EXAM_ENTRIES.md) |
| `08x2-exam-days-results.test.ts` | F4: the timetable pasted with a mapping, clashes, publication and the statement, seating without double-booked seats, invigilators and registers, special consideration, results keeping every attempt, publication, certificates, the deadlines dashboard |
| `08x3-exam-races.test.ts` | F4: two people (or scheduler instances) at once — derivation, numbering, withdraw against amend, one seat, a results import, a certificate at two desks, reminders |
| `08x4-exam-entries-rework.test.ts` | F4 on the reservations rework (RESERVATIONS_REWORK.md §9, §10): entries from lines' items, teacherOf per unit, retake from the attempt, carry forward from a verified sitting with its centre and number, the carry-forward period on the board, a declared unverified sitting listed and held, results verifying a declared sitting, cash-ins with their charge, "mark as sent" and the refund, the line's own deadline, the desk-drop's withdrawal |
| `exam-helpers.ts` | F4's school for those suites: staff, a catalogue per suite tag, an open window on the free (type, level) pair, families registered at the desk |

**Adding an endpoint?** Add its row to `authz-policy.tsv` (A = may get past the role gate,
D = refused, one column per principal). The matrix test fails on an endpoint without a row, so
someone always decides who may call it.

Files run one at a time and share the database; each file creates its own sessions with a
distinct (type, level) pair because only one session per pair may be active. Tests inside a
file run in order because each scenario is a chain of real money movements.

## Writing a test

Call the code the way its users do and assert the value they see, against a literal:
`expect(money(payment.amount)).toBe(3000)`, not `toBeGreaterThan(0)`. A test that would still
pass if a service returned nothing is not a test. Use `waitFor` for fire-and-forget side
effects such as notifications and emails.
