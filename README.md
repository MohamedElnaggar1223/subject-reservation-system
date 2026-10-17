# IGCSE Management System

A web system for an Egyptian school's IGCSE and A-Level grades (10 to 12). Families register
exam subjects per series, pay, keep a balance with the school, and request remarks; staff do all of it on a
family's behalf at a finance desk, with physical receipts, daily takings and audited
corrections. It began as a subject-reservation system and is becoming the school's system of
record for grades 10 to 12, which its incumbent system does not cover.

Where the project stands and what comes next: [`STRATEGY.md`](./STRATEGY.md).

## Repository

| Path | What it is |
|---|---|
| `apps/api` | Hono API with better-auth; routes, services, the session scheduler. Integration tests in `apps/api/test`. |
| `apps/web` | Next.js web app for families, the desk, finance and admin, in English and Arabic. |
| `apps/app` | Expo app, still the starter template. Kept for future mobile work; outside the gates. |
| `packages/db` | Drizzle schema, migrations (`packages/db/drizzle`) and the seed. |
| `packages/validations` | Shared Zod input schemas, roles and the RPC response unwrapper. |
| `packages/storage` | Cloudflare R2 file storage with signed URLs. |
| `packages/typescript-config`, `packages/eslint-config` | Shared tooling config. |

Every request to the API goes through the typed Hono RPC client. The rules that keep the
project typed end to end are in [`PATTERNS.md`](./PATTERNS.md) and [`CLAUDE.md`](./CLAUDE.md).

## Run it locally

Needs Node 22, pnpm 9 and Docker.

```bash
# 1. Postgres on 127.0.0.1:5433 (the integration suite uses the same container)
docker run -d --name igcse-dev-db -e POSTGRES_USER=audit -e POSTGRES_PASSWORD=auditpass \
  -e POSTGRES_DB=igcse_audit -p 127.0.0.1:5433:5432 postgres:17.5

# 2. Dependencies and environment (see .env.example for every variable)
pnpm install
cp .env.example apps/api/.env          # then set BETTER_AUTH_SECRET; the API won't start without it
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > apps/web/.env.local

# 3. Shared packages and schema (everything runs from the repo root)
pnpm build --filter=@repo/db --filter=@repo/validations --filter=@repo/storage
DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:5433/igcse_audit pnpm --filter @repo/db db:migrate

# 4. Servers
pnpm --filter @repo/api dev            # http://localhost:3001
pnpm --filter web dev                  # http://localhost:3000
```

**First admin.** Sign up through the web app with the email `admin@igcse.local`, then run
`pnpm --filter @repo/db seed` (it reads `DATABASE_URL` from `apps/api/.env`). It promotes that
account to admin and makes nothing else; set `ADMIN_EMAIL` to promote another address. Staff
accounts are created from the admin's Team page; the subjects, sessions and fees from the
Catalogue and the Sessions page.

**Sample data.** `pnpm --filter @repo/db seed --with-samples` also adds the old sample subjects
and two sample sessions with fixed 2026 dates (a June session the scheduler closes on its first
tick, and a November 2026 – January 2027 draft). They are for a demo or a test system, not a
school's: a draft session nobody reserved in can be deleted from its Session screen.

With no `RESEND_API_KEY`, emails are logged instead of sent. Without R2 keys, file uploads go to
`LOCAL_UPLOAD_DIR` (default `.uploads`) in development; in production they are refused until R2
is configured.

## The three gates

Nothing reaches `main` unless all three are green:

```bash
pnpm --filter @repo/api check-types    # API source and the integration tests
pnpm --filter web check-types
pnpm --filter @repo/api test           # integration suite against a real Postgres
```

The suite drives the real app through the typed client and asserts against the database; see
[`apps/api/test/README.md`](./apps/api/test/README.md). GitHub Actions runs the same three on
every pushed branch and pull request ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).

## Documents

| File | Read it for |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | Rules every agent session follows here. |
| [`STRATEGY.md`](./STRATEGY.md) | The plan of record: goal, decisions and why, phases, open questions. |
| [`DISCOVERY.md`](./DISCOVERY.md) | What we know and assume about the school; check it before designing a feature. |
| [`FOUNDATION_AUDIT.md`](./FOUNDATION_AUDIT.md) | What has been proven at runtime, and the findings (RF-nn, RH-nn). |
| [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) | The security audit: what was proven, findings RF-11 to RF-23, and the production checklist. |
| [`PATTERNS.md`](./PATTERNS.md) | The three golden rules of the codebase. |
| [`V3_PLAN.md`](./V3_PLAN.md), [`UX_AUDIT.md`](./UX_AUDIT.md), [`PROJECT_AUDIT.md`](./PROJECT_AUDIT.md) | Why the money rails, the desk and the current screens are shaped as they are. |
| [`urd-doc.md`](./urd-doc.md) | The original requirements (URD v2); code cites its story ids, such as CORE-001. |
| `.audit/*.tsv` | Decision trails for each audit and effort. |
| [`docs/archive/`](./docs/archive/README.md) | Superseded plans and the starter template's documents, kept for history. |
