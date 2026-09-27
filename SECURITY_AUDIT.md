# Security Audit — Phase 1.1

**Date:** 27 September 2026
**Scope:** STRATEGY.md Phase 1.1: authorization across every endpoint and role, the
money-authority paths, object-level access between families, input handling, rate limits,
email verification, configuration and secrets, and audit-trail completeness. Plus the two
items the repo cull handed on: the unused file-upload surface and the audit rows written after
the response.
**Method:** everything was driven through the running app, never inferred from code alone.
Four new test files do the probing and now guard the result permanently; runtime-only
properties (rate limiting, body limits, headers, the browser path) were proven against the
real dev servers. An independent review on Opus 5.5 raised 19 flags against the first version;
every flag that was a fact was fixed, including one finding the audit had missed (RF-23).
Every decision and its evidence is in `.audit/security-audit.tsv`; every cross-family attempt
and its answer is in `.audit/security-object-access.tsv`.

---

## 1. Headline

**The spine's authorization is sound.** Across 152 endpoints and six principals, nothing
answers an anonymous caller except the health probes, nothing returned a 500, and every role
gate matches its endpoint's audience. In attempts by one family against another family's
registrations, payments, receipts, escrow, drop requests, remarks, links, notifications and
files, every attempt was refused and nothing changed, with one exception (RF-13).

**Thirteen findings: one high, three medium.** The high one: the sign-in rate limiter trusted a
header any client can send, so password guessing against staff accounts, which confirm and
reverse money, was unlimited. The medium ones: the session token was readable by page scripts
through four auth responses; banning an account left its sessions working, so a banned officer
kept money authority; and the actions that grant access to a child or change what families pay
left no audit row. All thirteen are fixed, each with a test that fails when its fix is undone,
and the fixes were re-proven on the real servers.

---

## 2. What was proven

| Area | How | Result |
|---|---|---|
| Role gates, every endpoint | `04-authz-matrix.test.ts`: each /v1 route called as anonymous, student, parent, finance officer, finance admin, admin | Matches the reviewed policy in `apps/api/test/authz-policy.tsv`; now enforced. This proves the gate that runs before a record is looked up |
| Checks after the lookup | `05-object-access.test.ts` with real records | A student cannot read even their own family's payments; staff cannot create remark requests; another family's records are refused |
| Anonymous access | matrix | Only `GET /v1/health` and `/v1/health/ready` answer |
| One family reaching another | `05` | Every attempt refused, no state changed (after RF-13) |
| Links | `05` | A pending link grants nothing; another family's student cannot approve a link addressed to someone else |
| Privilege escalation | `06-auth-surface.test.ts` | Sign-up refuses injected role and student fields; update-user and profile update ignore them; better-auth's admin endpoints refuse everyone but an admin; account setup cannot switch a role |
| Bans | `06` | A banned account is signed out at once and cannot sign in (after RF-23) |
| Money authority | matrix plus `06` | Only the roles in the V3 capability table confirm, reverse, void, grant exceptions or approve withdrawals. No request sets a price or a fee; the amounts a client does send (escrow to apply, transfer, withdrawal) are bounded by the server against the balance |
| Session token | `06` | HttpOnly, SameSite=Lax cookie; the token is in no response body (after RF-12) |
| Cross-site requests | `06` and dev server | Cookie-bearing writes from another origin are refused on both /api/auth and /v1 |
| SQL and HTML injection | code read | Every SQL fragment is a Drizzle tagged template (values bound); no raw HTML rendering in the web app; email templates escape their inputs |
| Rate limiting | `06` and dev server | Rotating a client IP header no longer escapes the limit; session reads no longer spend the sign-in budget |
| Browser path | preview browser and scripted sign-in | Sign-in, sign-out and a profile save work through the new origin rule; the save is audited |

---

## 3. Findings

Severity is by impact on the school if exploited. Each fix has a test that fails when the fix is
undone; the four most important were checked by undoing them (trail, "control" row).

| ID | Sev | Finding | Fix | Test |
|---|---|---|---|---|
| **RF-11** | **High** | The sign-in rate limiter keyed on `cf-connecting-ip` from any client. With a rotating header, 0 of 60 wrong-password attempts were throttled. Audit rows recorded the same forgeable address. | `lib/client-ip.ts` trusts only the header named in `CLIENT_IP_HEADER` (rightmost entry), else the socket address; audit rows use the same function; session reads no longer count against the sign-in budget; the API warns at boot in production without the setting. Dev server afterwards: 10 of 60 throttled. | `06`, in-process through the limiter's own headers |
| RF-12 | Medium | The session token was returned in the JSON of `get-session`, `list-sessions` (every active session), sign-in, sign-up and `/v1/session`, so an injected script could steal a working session despite the HttpOnly cookie. | One better-auth after-hook strips it from all four; `/v1/session` strips it; the web's hand-written session type is now derived from its fetcher. | `06` |
| RF-14 | Medium | No audit row for an admin changing a user (role, ban, grade), for a parent-student link being requested, answered or removed, for remark fee or deadline changes, or for a remark payment. | Seven new audit actions; the admin update records before and after. | `07` |
| RF-23 | Medium | Banning a user left their sessions working until they expired: better-auth checks a ban only at sign-in, and the admin's ban wrote the database directly. A banned finance officer kept confirm and reverse authority. | A banned user is treated as signed out on every request; banning through the admin form also deletes the user's sessions. | `06` |
| RF-13 | Low | Any parent who knew another family's file id could attach it as their InstaPay screenshot or remark consent form. A parent could delete a file after attaching it, erasing the evidence (the foreign keys are ON DELETE SET NULL). `POST /v1/files` accepted any type up to 50 MB from any account and had no caller. | Both services require `isFileOwner`; an attached file cannot be deleted; the general upload route is removed. | `05` |
| RF-15 | Low | Of 73 audit-write call sites on main, only 2 were awaited, so a money action could answer before its audit row existed. This race failed the first CI run on main. | All 80 call sites are awaited (still non-fatal); a source-scan test fails on any new unawaited write. | `07` |
| RF-16 | Low | No request body limit anywhere. | 1 MB for JSON, 11 MB for uploads. Dev server: a 2 MB body answers 413. | `06` |
| RF-17 | Low | Sign-up with a weak password answered 500. | The password hook throws a 400 with the rule. | `06` |
| RF-18 | Low | better-auth turns its origin check off whenever `NODE_ENV=test`, so the suite never exercised it and a deploy started with that value would run without it. | `disableOriginCheck: false`, always on. | `06` |
| RF-19 | Low | Cookie-bearing writes to /v1 had no origin check. Hono's JSON validator accepts a `text/plain` body as `{}`, so a form post from a sibling subdomain reached endpoints whose fields are all optional or that take no body. | /v1 middleware requires a trusted Origin on cookie-bearing writes, using better-auth's own check. | `06`; runtime and browser |
| RF-20 | Low | Every signed-in parent and student could read teachers' phone numbers and emails, through the teacher list and a subject's teacher list. | Only the admin sees them; others get null, on every route that returns a teacher. | `06` |
| RF-21 | Low | No security headers on the API or web app; the desk could be framed by another site. | API: nosniff, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, same-site resource policy, HSTS (`max-age=15552000; includeSubDomains`) and Hono's other defaults. Web: framing denied, nosniff, referrer and permissions policy. | `06` (API); curl (web) |
| RF-22 | Low | Email verification was off unless explicitly enabled, in production too. | Unset now means required in production; accounts staff create in person (the desk and the admin's team form) are marked verified so they are not locked out. | `06` |

---

## 4. How the result stays true

- **A new endpoint needs a policy row.** `04-authz-matrix.test.ts` fails if an endpoint has no
  row in `apps/api/test/authz-policy.tsv`, if any principal is let through or turned away
  against its row, or if a row outlives its endpoint.
- **An endpoint that takes a family's id gets a cross-family case** in `05-object-access.test.ts`
  (CLAUDE.md).
- **Every audit write is awaited**, enforced by a source scan in `07`; it found two scheduler
  writes the first pass missed.
- **The web may not hand-type API responses** (CLAUDE.md); the one that had drifted, the
  session type, is now derived from its fetcher.
- All of it runs in CI on every pushed branch.

---

## 5. Observations handed on

| ID | Observation | Owner |
|---|---|---|
| O-1 | Some refusals answer 400 rather than 403 (request-drop and request-swap on another's registration, revert, link answer, checkout summary, staff creating a remark). Nothing leaks; the status is imprecise. | Engineering health |
| O-2 | Remark creation and approval revert check a record's state before its ownership, so someone who already knows a record's UUID learns its state. UUIDs are unguessable, which is also why RF-13 is Low. | Engineering health |
| O-3 | Staff accounts carry money authority on a password alone. A second factor for finance roles (better-auth's two-factor plugin) is the next strongest control. | Owner decision |
| O-4 | Behind a proxy, `CLIENT_IP_HEADER` must name the header that proxy writes. Unset, the whole school shares one sign-in budget and can be locked out; the API now warns at boot, and session reads no longer spend the budget. | Deployment checklist, §6 |
| O-5 | Finance cannot read a parent's uploaded screenshot or consent form, because file reads are owner-only. This becomes a gap when those uploads get a screen. | Feature work |
| O-6 | `next.config.js` still names the starter template's R2 bucket host. | Cleanup |
| O-7 | Audit rows are written after the money movement commits, in a separate statement. Writing them inside the same transaction would make "no money without its audit row" absolute. | Money-correctness audit |
| O-8 | better-auth does not origin-check sign-in itself, since no cookie exists yet: a minor login-CSRF. | Accepted |
| O-9 | `CORS_ORIGINS` feeds the /v1 origin rule; when the Expo app ships, its origins (`app://`, `exp://…`) must be added or its writes will be refused. | Mobile work |

---

## 6. Production checklist

Set these before the first deployment; each one is a control this audit relies on.

- `NODE_ENV=production` (secure cookies, HSTS, email verification on by default).
- `CLIENT_IP_HEADER` set to the header the edge proxy overwrites (`cf-connecting-ip` behind
  Cloudflare, `x-real-ip` behind a load balancer), and only if such a proxy is in front. Use
  `x-forwarded-for` only with exactly one proxy. Trust `cf-connecting-ip` only if the origin
  refuses traffic that did not come through Cloudflare.
- `CORS_ORIGINS` set to the exact web origins (and the Expo origins once mobile ships); it also
  feeds better-auth's trusted origins and the /v1 origin rule.
- `BETTER_AUTH_SECRET` random, 32 characters or more; `COOKIE_DOMAIN` set when the API and web
  share a parent domain.
- `REQUIRE_EMAIL_VERIFICATION` left unset or `true`, never `false`.
- The API served over HTTPS only (HSTS is sent).

---

## 7. Not covered

Dependency vulnerability scanning; infrastructure and hosting (none exists yet); denial of
service beyond the body limit and rate limits; the Expo app (still the template); per-officer
scoping, since finance staff act across all families by design; and the state and concurrency
questions that belong to the state-and-time audit.

## 8. Reproduce

```bash
pnpm --filter @repo/api test        # includes 04–07; needs the Postgres from apps/api/test/README.md
AUTHZ_MATRIX_OUT=/tmp/matrix.tsv OBJECT_ACCESS_OUT=/tmp/access.tsv pnpm --filter @repo/api test
```

The rate-limit, body-limit and header checks against real servers are shell commands recorded
in the trail's evidence column.
