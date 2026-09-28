# CLAUDE.md — subject-reservation-system

Project rules that hold for every agent session in this repo. The general working
agreements live in the user's global CLAUDE.md; this file only adds what is specific here.

## Read first

`STRATEGY.md` (the plan of record: goal, decisions and why, phases, open questions),
`FOUNDATION_AUDIT.md` (what has been proven and what is still open, with finding ids
RF-nn / RH-nn), `SECURITY_AUDIT.md` (authorization, cross-family access, the auth surface,
and the production checklist), `MONEY_AUDIT.md` (ledger invariants, takings semantics, the
money findings MA-nn), `DISCOVERY.md` (assumptions about the school, parked questions, artefacts
still to obtain — check it before designing any feature), `PATTERNS.md` (the three golden
rules of the codebase), `V3_PLAN.md` and `UX_AUDIT.md` (why the system is shaped the way it is), `IMPORT_SPIKE.md`
(what the school's own sheet does not fit — read it before changing the data model), and
`DISCOVERY_RESEARCH.md` (what the exam boards and Egypt's equivalency rules require, and the
feature-value map for the gate).

## Models

**Opus 5.5 (`claude-opus-5-5`) is the only model other than the main session that may be
used in this project.** `.claude/settings.json` forces every subagent onto it; the reviewer
definition is `.claude/agents/opus-55-reviewer.md`. Never pass `model: "sonnet"`,
`"haiku"`, or the `"opus"` alias to the Agent tool here (the alias has resolved to Opus 5 and
Opus 4.6 in the past). A reviewer's last line names its model; a review that does not say
Opus 5.5 does not count.

If the session started before those files existed, the Agent tool cannot reach the pinned
model. Use the CLI from Bash instead, which accepts a full model ID and runs as its own
process:

```bash
env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT claude -p --model claude-opus-5-5 --output-format text \
  --allowedTools "Read" "Glob" "Grep" "Bash(git log:*)" "Bash(git show:*)" "Bash(git diff:*)" "Bash(grep:*)" "Bash(cat:*)" "Bash(sed:*)" "Bash(ls:*)" \
  < review-prompt.md > review.out
```

Probe first with a one-line "state your model" prompt; it must answer Opus 5.5.

## Hono RPC everywhere

Every request to the backend — web, mobile, and tests — goes through the Hono RPC client
(`hc<AppType>`), so the project is typed end to end. Never hand-type an API response or add a
generic to `useQuery`; derive row types from the fetcher
(`Awaited<ReturnType<typeof fetchX>>[number]`). The only raw requests allowed are the two
better-auth endpoints (sign-up, sign-in), which the apps call through better-auth's own client.
Response envelopes are typed by `success()` / `error()` in `apps/api/src/lib/response.ts`; do
not build `{ success, data }` by hand in a route.

## Tests are the proof

`pnpm --filter @repo/api test` runs the integration suite against a real Postgres
(`apps/api/test/README.md`). Every money path has a scenario there; a change to a money path
adds or updates one. `pnpm --filter @repo/api check-types` covers the tests too. Both must be
green, with `pnpm --filter web check-types`, before anything reaches main. The same three
gates run in GitHub Actions (`.github/workflows/ci.yml`) on every pushed branch and pull
request; push the worktree branch first and merge only on a green run, and a red run on
`main` is fixed before anything else lands. A claim of "green" names the checkout it ran
in — the main checkout's `node_modules` can be stale while a worktree's are current.

A new endpoint needs a row in `apps/api/test/authz-policy.tsv` saying which principals may
call it; the matrix test fails without one. An endpoint that takes an id belonging to a family
gets a cross-family case in `05-object-access.test.ts`.

`09-money-invariants.test.ts` runs last and checks rules over every row the suite leaves
behind (ledger equals balance, a payment equals what it covers, cash handed over equals what
was released). A new money table or movement gets a rule there as well as a scenario. A money
transition writes its audit row inside its own transaction (`logAction(..., tx)`), and a
guard that relies on "read, then write" takes a row lock (`.for('update')`): under READ
COMMITTED a re-read inside a transaction serializes nothing (MONEY_AUDIT.md MA-06, MA-08).

## Git

Work on a branch in a worktree; when the three gates above are green, merge to `main` and
push it directly — the owner does not want to wait for a merge. Never force-push. Decision
trails for audits and multi-phase work live in `.audit/*.tsv` (force-added; the directory is
otherwise ignored so cookies and test accounts never land in git).

## The desk comes first

Staff act on families' behalf at a desk and compare every flow to their spreadsheet. Before
shipping anything staff-facing, describe the Excel version of the task and beat it on steps
and memory load (`UX_AUDIT.md` §4). The destination is app-first for families; the desk is
how the school gets there.
