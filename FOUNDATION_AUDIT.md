# Foundation Audit — first runtime pass

**Date:** 26 September 2026
**Scope:** Stage 0 of the audit program agreed the same day (context and assumptions in
`DISCOVERY.md`): stand the system up against a real database for the first time since V3, prove
the spine every future feature depends on, and record what breaks. This is **not** the security,
money-correctness, state-machine, or UX audit; those follow and take this file as their
starting point.
**Method:** every path was driven through the real API and database, never inferred from code.
Each claim below has a pointer into the decision log at `.audit/foundation-audit.tsv`
(one row per decision or checkpoint, append-only, evidence column holds the endpoint, SQL, or
`file:line`). Every `file:line` in the log was checked to resolve to the claimed code. A
separate reviewer on a different model (Claude Opus 5) then read the log and the session
transcript and raised 15 flags; each was verified and answered in log rows 42–56, and this
report was corrected accordingly (see §9). Where a checkpoint rests on an API response only,
the row says so.

---

## 1. Headline

**The spine works.** Every V3 money path that had never executed anywhere ran end to end on an
empty database: migrations, desk onboarding, desk registration with cash, physical receipts and
the receipt-gated refund, InstaPay with partial escrow, the cash-refund maker-checker, the
finance-admin reversal, the school-fee gate with a fee waiver, the held-wallet preregistration
with capture on activation, and results → remark → outcome with the Cambridge one-shot rule and
fee refund. Role enforcement held at every point tested (officer refused on approve, exceptions,
reversal).

**Nine findings** (ids run to RF-10; RF-06 was retired), three of them high. Two high findings are the same shape: **money moves and
the family is not told** — on the desk, the primary channel. The third is the desk and the
parent's fee page **telling people to pay a fee the finance admin waived**. The rest are a seed
that produces free subjects, a seed that reopens closed sessions, raw SQL leaking to parents, a
stale grade of record after a remark, and two low-severity mislabels.

---

## 2. Environment (isolated; nothing shared was touched)

| Item | Value |
|---|---|
| Worktree | `.claude/worktrees/project-understanding-report-ffa09b`, branch `claude/project-understanding-report-ffa09b` |
| Database | Docker `igcse-audit-db`, `postgres:17.5`, bound to `127.0.0.1:5433`, db `igcse_audit` (port 5432 belongs to another project's container and was left alone) |
| Env | `apps/api/.env`, `apps/web/.env.local` (gitignored), email in stub mode, verification off, R2 unset |
| Servers | API `:3001`, web `:3000` via `.claude/launch.json` |
| Accounts | `.audit/accounts.env` (gitignored): admin, finance_officer, finance_admin, one parent, one grade-11 student, plus the ids created during the run |
| Test data | 17 seeded subjects with prices repaired by SQL (see RF-01), 2 seeded sessions, 1 session created during the run |

To tear down: `docker rm -f igcse-audit-db` and stop the two preview servers.

---

## 3. What was proven (checkpoints)

| # | Path | Result | Log row |
|---|---|---|---|
| 1 | All 26 migrations on an empty DB | green, 2 s, 31 tables | 4 |
| 2 | Scheduler auto-closes an expired session and activates a due one on first tick; series-level grade-progression guard makes a second close a no-op | green | 8 |
| 3 | Desk onboarding: parent + grade-11 student + approved link in one call | green, phones keep leading zero, student ID minted; link confirmed in DB in row 46 | 9, 46 |
| 4 | Desk registration + cash in one call → 2 confirmed registrations, 1 completed payment linked to both, 2 receipts born, full audit trail | green | 10 |
| 5 | Officer signs in via the web UI and lands on `/desk` | green | 14 |
| 6 | Parent's home summary, registration list and receipt read match what the desk did | green | 15 |
| 7 | Receipt-gated drop: drop parks 1500 @ 100 % and credits nothing; escrow credit fires only when the officer marks the paper receipt returned; student + parent notified | green | 17 |
| 8 | Printable receipt renders number, student ID, subject, course fee and registration fee lines, total, issue date, signature lines | green for rendering; the registration fee was 0 throughout this run, so two-component pricing itself was **not** exercised (row 51) | 18, 51 |
| 9 | Daily takings reconciles the drawer (cash in, by instrument, confirmed-by) | green | 19 |
| 10 | InstaPay self-serve with 500 escrow applied: initiate → reference → pending_verification → officer confirm → confirmed + receipt; parent **and** student notified | green | 20 |
| 11 | Cash-refund maker-checker: withdrawal holds funds at request; officer fulfils; officer approve → 403; finance admin approve → 200 and stamps `approved_by/at` | green; note the status never changes past `fulfilled` (row 50) | 21, 22, 50 |
| 12 | Second payment cannot reuse an InstaPay reference | green (but see RF-07) | 26 |
| 13 | Student request → parent approve (REG-001/002) | green | 28 |
| 14 | School-fee gate blocks with a clear message; parent summary shows fee due; finance admin grants `fee_waiver`; officer grant → 403; student then allowed | green | 28 |
| 15 | Finance-admin reversal: officer → 403; reversal sets payment refunded, registration back to pending_payment, receipt void, escrow restored, takings show it | green (but see RF-08) | 29 |
| 16 | Held wallet: draft session → preregister (price locked) → in-school payment → held +1500, receipt born → parent sees held → activate → captured to confirmed, held 0 | green, **first ever run** | 33 |
| 17 | Results → remark (2 papers, fee per paper) → Cambridge one-shot rule refuses a second request → consent → pay → confirm → submit to board → outcome → fee refunded to escrow on grade change | green, **first ever run**; the consent-before-payment gate itself was not tested (consent was given before pay was tried, row 51); refund flag confirmed in DB in row 47 | 34, 47, 51 |
| 18 | Desk search finds the student by name in the UI | green | 36 |
| 19 | Student 360 renders parents, owed total, escrow, school fee, exceptions, every registration with receipt state and Hand Over / Print actions, recent payments — one screen | renders and routes correctly (but see RF-10); opened by a scripted in-page click, so this proves rendering, not that a person can operate it (row 63) | 37, 63 |
| 20 | Parent signs in and is sent straight to Pending Approvals because a child request is waiting | renders and routes correctly; the sign-in was scripted (form_input + requestSubmit), see row 63 | 40, 63 |
| 21 | Parent dashboard leads with actions: total outstanding, pay, approve, wallet, both open windows with countdowns | green | 41 |

UI note: harness clicks, typing and screenshots worked until 16:16:47, when the run set a
1280×800 viewport emulation; the first screenshot timeout came one second later and every failed
harness click afterwards happened under that emulation, which was only cleared at 16:30:46 (row
58). Pages were read as text and DOM instead, and the desk result row and Sign Out were clicked
from inside the page (rows 36, 38). So the likely cause is the emulation, not the app, but a
pointer-events or overlay defect on the desk result rows is still not excluded (row 55). The UX
audit should rerun with a visible pane and no emulation before drawing any conclusion.

---

## 4. Findings

Severity is by impact on the school on day one. Every row was reproduced at runtime; the log row
carries the exact evidence.

| ID | Sev | Finding | Why it matters | Where | Log |
|---|---|---|---|---|---|
| **RF-03** | **High** | A desk payment records the **finance officer** as `payment.parentId`, so the payment-confirmed notification goes to the officer and the real parent gets nothing. Same on desk school-fee collection. | The desk is the primary channel. A family pays 3000 EGP at the desk and their app shows no notification; the officer's inbox fills with other families' confirmations. | `apps/api/src/services/desk.services.ts:254`, `:339`; recipients read from that field in `notification.services.ts:612-628` | 11, 13, 16 |
| **RF-08** | **High** | A payment reversal notifies **nobody**. The registration silently drops to pending payment and the paper receipt the family holds is voided in the system without their knowledge. | Every other money movement notifies parent and student. This one invalidates a physical document and says nothing. | `reversePayment` at `apps/api/src/services/payment.services.ts:785` contains no notification call (verified, row 48); receipt voided | 30, 48 |
| **RF-10** | **High** | With an active `fee_waiver`, the desk Student 360 (observed) and the school-fee status API (observed) report the fee as **required and unpaid**; only the home summary and the registration gate consult the waiver. The desk fee-collection endpoint took the same view and would have charged the waived family (confirmed by test after the fix). | The officer sees "school fee due — EGP 5,000" with three collect buttons for a family the finance admin waived, and the collect endpoint would accept the money. An earlier version of this row also claimed the parent's dashboard said the fee was paid; that was wrong — the home summary's `paid: true` was its "nothing required" default and the dashboard hides a fee that is not required (row 57). | waiver ignored in `desk.services.ts` `getStudentSummary` and `collectSchoolFeeAtDesk`, and in `school-fee.services.ts:137` `getSchoolFeeStatus`; the gate at `school-fee.services.ts:127` and `home.services.ts` were right | 39, 44, 57 |
| RF-07 | Medium | **Repo-wide:** 51 route handlers in 14 files return `err.message` to the client unguarded; the `clientMessage` guard that swallows driver errors is used at only 10 call sites in 5 files. Reproduced on the duplicate-InstaPay-reference path, where the parent receives the full `UPDATE payment SET …` statement with column names. | Information disclosure (schema) wherever a database error reaches one of those handlers, plus parents reading "Failed query" instead of a sentence. PROJECT_AUDIT.md's claim that driver errors were stopped is broadly false, not false on one route. | reproduced at `apps/api/src/routes/payment.routes.ts:299`; guard at `apps/api/src/lib/response.ts:33`; scope by grep in row 45 | 27, 45 |
| RF-09 | Medium | A remark outcome with `gradeChanged: true` and a per-paper `gradeAfter` leaves `registration.gradeReceived` at the **old grade**. This is a schema gap, not a code bug: the outcome contract has no field for the new syllabus grade, so the fix is a product decision on where that grade lives (row 62). | The grade of record that retake detection and any future graduation plan read is stale after a successful remark. | `packages/validations/src/remark/remark.validations.ts:112-124`; remark service outcome handler | 35, 62 |
| RF-01 | Medium | The seed writes only the legacy `priceInSchool`; `courseFee` and `registrationFee` stay 0, so **every seeded subject prices at 0 EGP** under the V3 engine. | GETTING_STARTED and TESTING_GUIDE both send people through the seed. A fresh install or demo shows free subjects. | `packages/db/seed.ts:44-53` | 5 |
| RF-02 | Medium | Re-running the seed **resets `registration_session.status`** to the seeded values (June back to active, November back to draft). | The seed's own instructions say to re-run it after creating the admin. On a live DB that reopens a closed window; the scheduler then has to close it again. | `packages/db/seed.ts` session upsert `set: { status }` | 7 |
| RF-05 | Low (naming nit) | A parent **direct** registration stores the student's notification under the `REGISTRATION_REQUEST_RECEIVED` type. The title the student actually sees is "X registered subjects for you", so only the type enum is misused; an earlier version of this row claimed wrong copy that was never observed (row 60). | Filters and icons keyed on the type mislabel the notification; nothing the student reads is wrong. | `notification.services.ts:514-519` | 23, 60 |
| RF-04 | Low | The desk registration response returns registrations with `status: pending_payment` although the rows are already `confirmed`. | A client trusting the response shows "pending payment" right after cash was taken. | `desk.services.ts` returns the pre-confirmation snapshot | 12 |

RF-06 was reserved for the withdrawal approval stamp, which turned out correct (log row 22); the
id is unused.

---

## 5. Observations handed to the next audits (not defects yet)

- **Money audit — takings semantics.** `cashIn` and `net` add InstaPay bank transfers to drawer
  cash, and a reversed InstaPay payment is counted as cash out. `byInstrument` does split them,
  so the drawer can be derived, but the headline number is not the drawer (rows 24, 31).
- **Money audit — a reversal rewrites the day's takings after the fact.** Reversing the InstaPay
  payment moved the same day's totals from `cashIn 4000 / escrowApplied 500` to
  `cashIn 3000 / escrowApplied 0`. A closed drawer whose totals change later is the larger
  reconciliation problem (row 49).
- **State audit — withdrawals have no terminal state.** Statuses are pending, partially
  fulfilled, fulfilled, rejected; finance-admin approval only stamps `approved_by/at`. V3_PLAN
  §6.4 specified pending → disbursed → completed (row 50).
- **Product — the headline "owing" excludes a required unpaid school fee.** With 5,000 EGP due
  and not yet waived, `owing` was 2,900 and the fee appeared only as a separate action. Whether
  the headline should include it is a product call (row 56).
- **Money / state audit — escrow held at InstaPay initiation.** Applying escrow to an InstaPay
  payment debits the free balance immediately (1500 → 1000 at initiate, row 20). Nothing in this
  pass exercised what releases it if the parent never submits a reference. Needs a test.
- **Engineering — no local file storage.** The R2 client is built with empty credentials when R2
  env is unset; avatar, documents and the optional InstaPay screenshot cannot work without R2.
  Remark consent is an attestation with an optional file, so that flow is not blocked (row 32).
- **Seed dates are stale relative to today.** June 2026 (Feb–Apr) and November 2026 (Jul–Sep)
  were both past or expiring on 26 Sep 2026; the scheduler handled it correctly, but any demo
  needs live dates.
- **Receipt numbers are id-derived** (`RCP-3E10CFA0BD`), not the sequential `RCP-2026-000123`
  V3_PLAN §6.5 describes. Cosmetic; matters only if the school wants a counter.
- **UI screenshots stopped working at 16:16:47**, when the run set a viewport emulation (see the
  UI note under §3). Page text and DOM were read instead; the UX audit should rerun the visual
  checks and the print preview with a visible pane and no emulation.
- **This audit's API answered another project's traffic.** Another app on this machine targets
  port 3001; its requests for `/v1/citywide/*` and `/v1/talent-dashboard/summary` reached the
  audit API, so §2's "nothing shared was touched" is not quite true: that app got this API's
  answers while the audit ran. Extra traffic cannot hide a missing log line, so the row-36
  negative is weak only for lacking a positive control (rows 53, 59).
- **Row 8 proves less than it says:** the grade-progression guard ran with zero students, so it
  shows only that the run row was not inserted twice (row 64).

---

## 6. Not covered here (owned by the later audits)

Two-component pricing with a non-zero registration fee (every registration in this run carried
a registration fee of 0, row 51); the consent-before-payment gate on remarks (row 51);
real-mouse click-through on desk result rows (row 55); grade progression with real students
across a series close; session auto-close with registrations still pending (expiry); swaps;
escrow transfer between children; withdrawal rejection; the other six exception types
(discounts, custom price, deadline extension, late registration, custom refund percent); refund
windows with real percentages; teacher choice and the 50 % outside-school price; admin override;
email delivery (stubbed); Arabic; phone viewport; print CSS; any concurrency or race.

---

## 7. Reproduce

```bash
docker run -d --name igcse-audit-db -e POSTGRES_USER=audit -e POSTGRES_PASSWORD=auditpass \
  -e POSTGRES_DB=igcse_audit -p 127.0.0.1:5433:5432 postgres:17.5
# apps/api/.env → DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:5433/igcse_audit (+ secret, ports, school account)
pnpm install --frozen-lockfile --prefer-offline
pnpm build --filter=@repo/db --filter=@repo/validations --filter=@repo/storage
cd packages/db && DATABASE_URL=… pnpm db:migrate && DATABASE_URL=… pnpm seed
# RF-01 workaround until the seed is fixed:
#   update subject set course_fee = price_in_school where course_fee = 0 and registration_fee = 0;
```

Then start `api` and `web` from `.claude/launch.json`, sign up the admin through the API, re-run
the seed once to promote it (RF-02 applies), and create staff through `POST /v1/users`.

---

## 8. Suggested fix order

1. RF-03 and RF-08 together: a desk payment needs the linked parent as the notified party
   (payer of record can stay the staff member in a separate column), and a reversal needs a
   notification that names the voided receipt.
1. RF-10: one school-fee status function that consults the waiver, used by the desk summary,
   the parent fee page, and the home summary alike.
2. RF-07: one sweep over all 51 unguarded handlers, not one route. Either make every handler use
   `clientMessage` or move the guard into the shared error helper so a raw handler cannot leak;
   then map the unique violation on the InstaPay path to "this reference was already used".
3. RF-01 and RF-02: seed writes `courseFee`; seed stops overwriting `status` on existing sessions.
4. RF-09: decide where the post-remark syllabus grade lives and write it.
5. RF-05, RF-04.

---

## 9. Fixed on this branch (26 September 2026, same day)

Six of the nine findings were fixed before the remaining audits, because three are desk money
communications and the seed ones break every fresh environment. Each was verified at runtime the
same way it was found; the trail is `.audit/spine-fixes.tsv`.

| ID | Fix | Verified by |
|---|---|---|
| RF-03 | Desk payments record the earliest approved linked parent as payer of record; staff stays in `confirmedBy` and metadata | new desk cash payment: payer is the parent, confirmations to parent and student, none to the officer |
| RF-08 | New `PAYMENT_REVERSED` notification and email to every linked parent and the student, naming the voided receipt numbers | reversal produced two notifications whose body names the voided receipt |
| RF-10 | One `getSchoolFeeStanding` (required / waived / paid / settled) used by the desk summary, the fee status endpoint, and the home summary; Waived badge on the desk and the fee page | all three views agree with the waiver active and again after revoking it; fee page reads "Waived — nothing to pay" |
| RF-07 | All 51 unguarded handlers now use `clientMessage`; the guard refuses driver errors on `err.cause` and any "Failed query" text; the InstaPay path detects the unique violation by code | duplicate reference → 409 with a plain sentence |
| RF-01 | Seed writes `courseFee` + `registrationFee` (placeholder 300 EGP board fee, see DISCOVERY F-02) | brand-new database: 17 of 17 subjects priced, split sums to the legacy price |
| RF-02 | Session seed never touches an existing session | seed re-run on the live database left every status unchanged |

A second cross-model review of these fixes (log `.audit/spine-fixes.tsv` and the trail in
`.audit/test-harness.tsv`) found four gaps, all closed the same day: the desk fee-collection
endpoint still charged a waived family (now refused with a sentence); the seed re-run
overwrote admin-edited fees (now repairs zero-priced rows only); the sweep had turned the
duplicate-schedule 409 into a generic 400 (the service now maps the unique violation) and
missed one non-ternary handler; and an unlinked student silently made the officer the payer
again (money at the desk now requires a linked parent, register-only still works). A global
`onError` handler also answers anything thrown outside a handler with a generic 500.

Two more findings came out of building the test harness (§ Tests below):

| ID | Sev | Finding | Fix |
|---|---|---|---|
| RH-01 | Medium | The API carried better-auth's `nextCookies()` plugin, a Next.js-only integration. Every server-side `auth.api.*` call (desk onboarding creates accounts that way) tried to import `next/headers`, which does not exist in the API; under plain Node the failure was swallowed, under vitest it surfaced. | Plugin removed from `apps/api/src/lib/auth.ts`. |
| RH-02 | Medium | The repo's long-standing "several RPC endpoints infer `never`" quirk had one cause: `success()` typed its body through `c.json<ApiResponse<T>>`, and Hono's `JSONParsed` mapped type dropped the `data` key while `T` was a deferred generic. Every route using the helper typed as `{ success: true }` on the client, and call sites in the apps cast by hand. | Explicit `SuccessResponse`/`ErrorResponse` return types in `apps/api/src/lib/response.ts`; eight manual query generics removed and four screens' types derived from their fetchers in the web app; 38 harmless manual generics remain for the engineering-health audit. |

**Third pass, from the Opus 5.5 reviews of the fixes and the harness** (rows 10–16 of
`.audit/spine-fixes.tsv`, 17–26 of `.audit/test-harness.tsv`):

- The reversal's receipt check and void now run inside the transaction under a row lock, and
  the voided numbers come from the update itself; before, a receipt handed over between the
  check and the void was neither blocked nor voided yet named as void in the family's notice.
- `onError` passes Hono's own `HTTPException` through; the first version turned every
  malformed-request or body-limit 4xx into a 500.
- The seed no longer touches an existing subject at all (every column is admin-editable; a
  re-run would have reactivated a deactivated subject). Verified: fresh database 17 of 17
  priced; an admin-edited row survives a re-run unchanged.
- The text stored for a failed scheduled announcement goes through the same guard as client
  responses, closing the last path a driver error could take to a screen.
- The student's change-request listing now matches the parent's fully (`requestedByUser`
  included), so the claim of one response type is true.
- The web auth client carried the same Next-only `nextCookies()` plugin as the API; removed.
  The RH-01 story is also narrower than first written: desk onboarding did work under plain
  Node, and browser clients were never affected because the plugin returns early for HTTP.
- Checkout derives its summary and payment types from the RPC fetchers; the hand-written ones
  had drifted (grade as a string). The 38 remaining manual `useQuery` generics are a named
  risk, not "harmless": a hand type looser than the API compiles and hides drift.
- The suite no longer has an expiry date: sessions are placed relative to today and the
  academic year follows the API's 1 July rule; takings use the local date the server reads.
  The database-drop guard requires a `_test` suffix and a matching URL. Assertions tightened
  where a review found them loose.
- Recorded caveats on the response helpers: pass the status explicitly when it is not 200
  (an unpassed status with an explicit generic types 201 but sends 200), and the envelopes
  drop the unused `message?`/`details?` fields.

Still open: RF-09 (grade of record after a remark), RF-05, RF-04, and the observations in §5,
plus one product question the reviews sharpened: a fee waiver carries no academic year, so an
open-ended waiver settles every year until it expires.

### Tests

The foundation run is now the repo's first automated suite: `apps/api/test/`, run with
`pnpm --filter @repo/api test` against a Postgres it may create databases in (see
`apps/api/test/README.md`). Every request goes through the Hono RPC client bound to the
in-process app, so the tests are typed end to end; outcomes are asserted by reading the
database back. 19 scenarios cover checkpoints 3–17 of §3 plus RF-03, RF-07, RF-08 and RF-10,
and one `todo` marks RF-09.

## 10. What the cross-model reviews changed

**First review (Claude Opus 5; superseded).** It was launched at 16:28 before rows 37–41
existed and, under the repo's model rule, does not count; it is kept here because its flags
were acted on. It raised 15 flags (rows 42–56 answer each). The ones that changed this
document: five log-row pointers were off by one (fixed); RF-07 grew from one route to 51
handlers in 14 files; checkpoints 8 and 17 were reworded because the registration-fee
component and the consent gate were never exercised; three claims that rested on API responses
or inference (approved link, remark refund flag, RF-08's cause) were verified in the database
and code; and four observations were added for the money, state, and product audits. One of
its flags was accepted wrongly: the claim that the parent dashboard reported a waived fee as
paid (see RF-10 and row 57).

**Second review (Claude Opus 5.5, `claude-opus-5-5`, run as its own process with read-only
tools).** Nine flags, answered in rows 57–65. It reversed the wrong RF-10 extension; named the
viewport emulation, not a hidden pane, as the likely cause of the failed harness clicks and
corrected the onset time; drew the right lesson from the foreign traffic on port 3001; downgraded
RF-05 to a naming nit; split RF-03 into notification and payer-of-record, the second of which is
now asserted by the desk test through the parent's payment history; reclassified RF-09 as a
schema gap needing a product decision; and reworded checkpoints 19–20 as scripted rather than
operated. Three report claims that had no trail row (phones keep their leading zero, stale seed
dates, id-derived receipt numbers) now have one (row 65).
