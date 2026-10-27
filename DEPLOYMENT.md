# DEPLOYMENT.md — the free-tier deployment (21 Oct 2026)

Not production: a public copy of `main` for the school to try, on free plans. The
decision trail is `.audit/deploy-free-tier.tsv`.

## Where things run

| Part | Service | Address |
| --- | --- | --- |
| Web (Next.js, `apps/web`) | Vercel project `subject-reservation-system`, team `mohamedelnaggar1223s-projects`, functions in `fra1` | https://subject-reservation-system.vercel.app |
| API (Hono, `apps/api`) | Render web service `subject-reservation-api`, free plan, Frankfurt | https://subject-reservation-api.onrender.com |
| Database | Render Postgres `subject-reservation-db`, free plan, Frankfurt, Postgres 17 | internal URL only |

Both services deploy `main` on every push. Vercel builds nothing for other branches
(preview deployments are off: the feature worktrees push many branches). Render builds
only `main`.

## How the browser reaches the API

The web and the API live on different sites (`vercel.app` and `onrender.com`), so a
cookie the API set directly would be third-party and browsers would drop it. Instead:

- The browser's `NEXT_PUBLIC_API_URL` is the web origin itself. `next.config.js`
  rewrites `/api/auth/*` and `/v1/*` to `API_URL` (the Render address), so every
  request leaves the browser same-origin and the session cookie is first-party.
- The Next.js server (server components, `lib/hono-server.ts`) calls `API_URL`
  directly, forwarding the session cookie.
- On the API, `BETTER_AUTH_URL`, `APP_URL` and `CORS_ORIGINS` are all the web origin:
  from better-auth's point of view its public address is the web host. `COOKIE_DOMAIN`
  stays unset.

Locally nothing changes: `API_URL` unset means no rewrite and the browser calls
`NEXT_PUBLIC_API_URL` (`http://localhost:3001`) as before.

## Render service

- Build: `pnpm install --frozen-lockfile --prod=false && pnpm build --filter=@repo/api`
  (`--prod=false` keeps `tsc`, `drizzle-kit` and `tsx` installed; Render sets
  `NODE_ENV=production` at runtime only).
- Start: `pnpm --filter @repo/db db:migrate && pnpm --filter @repo/db seed && pnpm --filter @repo/api start`.
  Migrations run on every boot; the seed (admin promotion only, no samples) is
  idempotent and promotes the `ADMIN_EMAIL` account when it exists. The API itself loads the
  board's list (the reference data in `packages/db/reference`) at every start, before it serves
  (P1c, 27 Oct 2026): idempotent, so no deploy step is needed for it, and a database copied from
  an older one holds the list the coordinator picks subjects from. Its log line reads
  `[reference] loaded at start: …`.
- P1c's migration 0072 (the fee grid and availability dropped) refuses to run while a waiting
  line is priced provisional from the fee grid, on a row with no exam fee of its own, in a
  session whose prices are already final (it names each one: nothing could make such a line
  payable once the grid is gone). Migrations run at start, so that refusal stops the boot: the
  new build never serves and Render keeps the previous one running. Fix those lines first
  **from the previous build** — set each row's exam fee in the subject editor (it re-prices
  them) — then deploy again; nothing of 0072 is applied until it passes (one transaction).
- Environment: `DATABASE_URL` (internal), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `APP_URL`, `CORS_ORIGINS`, `RESEND_API_KEY`, `EMAIL_FROM`, `NODE_VERSION`,
  `REQUIRE_EMAIL_VERIFICATION=false`, `ADMIN_EMAIL`, the rate-limit ceilings and the
  `SCHOOL_*` placeholders. No R2 (uploads answer with a sentence) and no
  `CLIENT_IP_HEADER` (see below).

## Known limits of this deployment

- **Free Postgres expires 30 days after creation (20 Nov 2026)**, is unreachable for
  14 days after that, then deleted with its data. Upgrade the instance or export
  before then. No backups on the free plan.
- The free web service sleeps after 15 minutes without traffic; the first request
  after that takes about a minute.
- Rate limits share one bucket: the API sees the proxy's address, so
  `AUTH_RATE_LIMIT_MAX` and `API_RATE_LIMIT_MAX` are raised for the demo. Before
  production, put the two on one domain (or Cloudflare in front) and set
  `CLIENT_IP_HEADER`.
- Email: Resend sends from `onboarding@resend.dev`, which delivers only to the Resend
  account's own address. Verify the school's domain and set `EMAIL_FROM` before
  anyone relies on password-reset mail. Email verification at sign-up is off.
- Uploads are refused until the four `R2_*` values are set.

## Changing the deployment

- Env vars: Render dashboard (the service's Environment tab, redeploys on save) and
  Vercel project settings (redeploy afterwards: `NEXT_PUBLIC_API_URL` and `API_URL`
  are read at build time).
- A new migration lands by itself on the next Render boot.
- Database reads: Render's dashboard has a read-only SQL console; `psql` with the
  external URL (`?sslmode=require`) for anything else.
