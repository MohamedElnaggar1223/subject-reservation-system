# Reservations rework — step 2, agent B: reservation lines, consent, declared sittings, the Reserve pages, the statement

Branch `feature/rework-reservations` (worktree `.claude/worktrees/rework-reservations`), from
agent A's `feature/rework-sessions` (5367cf8, then 27e3233; merged at 977848d). The design is
`RESERVATIONS_REWORK.md` version 8 (accepted by the owner on 7 Oct 2026 with its §17
defaults); this is its §9 step 2, agent B, and §3.5, §4.3–§4.6. A's contract is
`docs/features/RESERVATIONS.md` §1, §2 and §2.11. The plan's rules are FEATURES_PLAN.md §3–§5.
Trail: `.audit/rework-reservations.tsv`; evidence (suite logs, controls, screenshots):
`.audit/rework-reservations-evidence/` (git-ignored). The progress log is the last section.

Resources (FEATURES_PLAN.md §7): test database `igcse_rwb_test`, dev database
`igcse_rwb_dev` (a copy of `igcse_template_dev`), API 3111, web 3110.

---

## 1. The data model this step adds

Migrations after A's 0043 (the lead regenerates the later-merging branch's on top of `main`'s
journal, FEATURES_PLAN.md §3):

### 1.1 `0044_rework_reservations` (generated)

| Table | Column / index | Rule |
|---|---|---|
| `registration` | `prior_sitting_verified_by` (user), `prior_sitting_verified_at`, `prior_sitting_verified_outcome` (`verified` \| `rejected`) | the coordinator's answer to a declared sitting; an outcome needs who and when and a sitting (check `registration_prior_sitting_outcome_valid`) |
| `registration` | `declaration_rejected` (bool, default false) | a paid line whose declaration was rejected before the first-entry deadline stands with it; F4 reads its attempt as `first` (check: only after a rejection) |
| `registration` | index `registration_to_verify_idx` | the To verify tab's rows (declared, unanswered), per session |
| `change_request` | `new_line` (jsonb) | the swap's new line as asked: attempt, mode, teacher, the sitting it follows, whether the family consented with the request |
| `registration_consent` | unique (line, kind, **channel**) | was (line, kind): a grade-10 line carries the school's pair (`school`) and the family's own (`app` or `desk`) beside it |

`prior_centre` and `prior_candidate_number` were added by A (0041); B fills them at
verification.

### 1.2 `0045_rework_reservations_consent_guard` (custom)

A deferred constraint trigger on `registration` (`AFTER INSERT OR UPDATE OF status`, `WHEN
status = 'confirmed'`): at the commit, a line that is confirmed and was not converted from before
the rework (`legacy ? 'converted'`) must have both consent kinds, else the transaction fails
(`check_violation`, constraint `registration_confirmed_has_consent`). The services refuse first
with a sentence (`CONSENT_MISSING_REFUSAL`); this is the structure behind the sentence, so no
later path can confirm a line nobody consented to.

### 1.3 The setting

`verification.unverifiedAtDeadline` (F0a's store, group `verification`, admin only, source Q-22):
`enter_as_declared` (default: the form trusts the family; F4 lists the line as declared,
unverified) or `hold`.

---

## 2. Contracts this step provides

| For | What |
|---|---|
| every reservation path | `reserveLines(tx, { …InsertLinesInput, lines: ReservationLineType[], declaredBy: 'family' \| 'desk', channel: 'app' \| 'desk' \| 'imported' \| null })` (`reservation.services.ts`), inside the caller's transaction after `assertMayRegisterForInTx` |
| C (charges at the checkout and the desk) | `consentStanding(executor, ids)` → `{ missing, schoolOnly }`; `writeConsents(tx, ids, { channel, confirmedBy })`; the sentences `CONSENT_MISSING_REFUSAL`, `FAMILY_CONSENT_NEEDED` |
| C (`refundFor`) | `refundForSystemDrop(line, at, { boardSent })` in `reservation.services.ts` is the one seam where a system drop on a declared sitting computes its refund: today's computation (the windows' percentage of the whole price) until C's `refundFor` lands; C replaces its body |
| C (the statement's charges) | `statementFor` returns `charges: []` per student — the extension point C fills (price, paid, outstanding, due); the totals already add it |
| D (reminders) | the To verify list (`listToVerify`) for the coordinator's `declared_retakes_to_verify` rule; the statement's `dueAt` / `overdueDays` per line |
| F4 | `registration.declaration_rejected` (enter as a first entry), `prior_sitting_verified_outcome`, `prior_centre`, `prior_candidate_number`; `prior_sitting_source` |
| F7 | `reserveLines(..., channel: 'imported')` writes the sheet's confirmation as consent rows |
| the scheduler | `holdUnverifiedAtDeadline(now)`, called first by `enforcePaymentDeadlines` (§3.4) |
| F1 | `PUT /v1/registrations/:id/teacher` moves the line's enrolment per unit or subject (§4) |

---

## 3. Declared sittings and their verification (§3.5)

### 3.1 How a line gets its sitting

`resolveReservationLines` (reservation.services) turns what a page sent into the lines
`insertLines` makes, inside the caller's transaction and after the student lock:

| The page sends | The line gets | `prior_sitting_source` |
|---|---|---|
| a retake (or a carry-forward item, `needs_prior_series`) naming nothing, and the student has a confirmed or dropped line for what the item enters in another session | the latest such sitting | `known` |
| a retake naming `priorSittingSeriesId` (a series on record) or `priorSitting { month, year }` | that series; for a month and year not on record, a `board_series` row with no dates and an empty label is created (`findOrCreateSeries`) | `known` when it is one of the student's known sittings, else `declared_by_family` (app paths) or `declared_by_desk` (staff paths) |
| a retake with no sitting and nothing known | refused by A's `gate.retakeDeclared` sentence | — |
| a first entry naming a sitting | refused (a first entry follows no sitting) unless its item carries one forward | — |

The named sitting must be of the item's board and before the item's series; `gate.priorSeries`
(A) checks the carry-forward period. The family's picker offers the board's sittings of the last
two years (`declarableSittings` on A's offers read). An F4 result as a `known` source is not
built: there is no F4 results table yet (§9).

### 3.2 The To verify list

`GET /v1/sessions/:id/to-verify?show=awaiting|decided` (coordinator, admin, finance officer,
finance admin). One row per declared sitting in the session: the student (name, number), the
line, the sitting, who declared it, whether it is paid and whether a payment is open, the line's
effective deadline and the days left; `decided` adds the outcome, who and when. Most urgent
first. Shown as the Session screen's **To verify** tab (§6.4).

### 3.3 The answer

`POST /v1/registrations/:id/verify-prior { outcome: 'verified' | 'rejected', prevCentre?,
prevCandidateNumber?, reason, evidence? }` — the coordinator and the admin; the finance desk too,
with `evidence` (what it was shown: the board's statement), as §3.5 says the desk may verify when
the family brings it. The centre and candidate number are taken only with `verified`. A sitting
is answered once (409 after). Locks: the line's receipt, then the line `FOR UPDATE` (MA-16's
order, as every drop), then its payments are read.

| Line when answered | `verified` | `rejected` |
|---|---|---|
| waiting (pending approval or payment, an unfunded preregistration), no payment open | stands; centre and number recorded on a carry-forward from another centre (the audit row says only that they were recorded) | **expires**, reason `declaration_rejected`; the family is told (`DECLARATION_REVIEWED`, student and linked parents) and may reserve a first entry where the item takes one |
| waiting, a payment open | stands | **refused 409**: "A payment for this line is in progress: confirm or reject it in the Finance Workbench first" (08t forces both orders) |
| paid (confirmed, or a funded preregistration), before the first-entry deadline | stands | **stands** with `declaration_rejected = true` (F4 enters it as a first entry); the family is told; finance decides any price adjustment (C's charge) |
| a funded preregistration, after that deadline | stands | stands as above: its capture or MO-21's deadline refund settles it |
| confirmed, after the first-entry deadline | stands | **dropped** through `executeReceiptGatedDrop` (MA-16: the paper receipt comes back before the money moves); the refund from `refundForSystemDrop(line, now, { boardSent })` where `boardSent` is the line's own sent state (its effective deadline passed); recorded on the audit row |

### 3.4 Unverified at the deadline: the setting and the hold step

`verification.unverifiedAtDeadline`: `enter_as_declared` (default) does nothing — F4 lists the
line as declared, unverified. `hold`: `holdUnverifiedAtDeadline(now)` runs first in
`enforcePaymentDeadlines` (the scheduler's deadline tick; its result adds `unverifiedExpired` and
`unverifiedDropped`; a failure is logged and the sweep goes on):

- a waiting line whose effective deadline passed, no payment open → **expires**
  (`hold_unverified`); with a payment open it is left to the deadline sweep that follows on the
  same tick (which fails the payment and expires the line, as at any deadline);
- a confirmed line → **dropped** through the receipt-gated drop with that day's refund, the
  board fee counted **not sent** (a held line was never entered), audit `LINE_DROPPED_UNVERIFIED`;
- only a deadline that passed **while `hold` was in force** counts (after the setting's own
  `updated_at`): a line whose deadline passed under `enter_as_declared` was entered as declared
  then, and turning `hold` on later does not reach back (§8, decision 4);
- claim before acting (ST-06, ST-12): each line is locked and read again in its own transaction
  and acted on only while still unverified and in the status it was found in. Two schedulers at
  once drop a line once (08t); the drop's own conditional update is a second layer (control
  `hold-two-schedulers` stayed green with the lock alone undone, red with both).

### 3.5 The refund seam

`refundForSystemDrop(line, at, { boardSent })` (reservation.services) is the one place a system
drop of a declared sitting computes its refund. It is **today's computation** (the refund
windows' percentage of the whole price, `refundPercentage`) because C's `refundFor` is not merged;
`boardSent` is passed correctly now and ignored by today's computation. C replaces the body.

## 4. The teacher on a line

`PUT /v1/registrations/:id/teacher { teacherId: string | null, mode?, reason }` — the admin, the
coordinator and the finance desk (the family asks there). Student `FOR SHARE`, then the line
`FOR UPDATE`. Rules, each with its sentence:

- the teacher must teach the item (its own teachers, else the offer's) and be active;
- `null` ("no preference") only where the item has several teachers; refused where it has one,
  and a subject nobody teaches can only be self-study;
- `mode: 'self_study'` takes the teacher off; a self-study line is **not** moved to taught (it was
  priced as self-study: drop it and reserve it in school); a move to self-study is **not**
  re-priced (a refund is finance's own act);
- nothing to change → 409;
- the line keeps its price; `taken_outside_school` follows the mode; audit
  `LINE_TEACHER_CHANGED`;
- the enrolment follows: per unit where the item enters units, else per subject — an open
  enrolment updated (`ENROLMENT_UPDATED`), else made from the line
  (`upsertEnrolments`, source `registrations`).

A's "replace teacher" on an offer (every line) is untouched.

## 5. The statement (§4.5)

`GET /v1/statement?studentId=` or `?familyId=` — a student sees their own; a parent their linked
children (by child or by family = themselves); staff with the student-record roles anyone.
Per student, per session: every line with its price, what completed payments covered, what is
outstanding, refunded, or waiting on a receipt's return; the due date and days overdue; whether
the board fee is provisional; **why the price is what it is** (`basisText`: "course 14,000 × 50% +
board 9,200 × 100%", from the line's pricing basis; a converted line shows its recorded split);
the series and its deadline; the sitting followed, its source and answer; the receipt; the
consents and the frozen refund steps; then remarks, the school fees, `charges: []` (C's extension
point; the totals already add it), the payments (what each covered, its deadline, its series)
and the escrow. Every number is read from the ledger.

Shown as the family's `/statement` page (nav "Statement" for a parent with finance access and for
a student) and as the Student 360's **Statement** section at the desk, where staff open the
teacher change (§4) from a line.

## 6. The screens

One component, `components/reservations/reserve.tsx` (`Reserve`, viewer `student | parent |
desk`), reads A's offers (`GET /v1/registrations/offers`) and writes through the typed client.
Per item: a tick; the entry in the forms' words ("First entry, in school", "Retake, self-study",
"… — name the sitting" when the system does not know it), defaulting to a retake when it does;
the sitting picker for a declared retake or a carry-forward; the teacher ("No preference" where
there are several, the one teacher shown where there is one, none in self-study); the price,
with ⓟ on a provisional board fee. Exclusive groups untick each other; a grade-10 June
reservation keeps the core offers ticked. The totals: lines, amount, due date, the provisional
part, and the split **per entry deadline** as the money is taken (a retake of the board's
previous sitting by the series' retake deadline). The page sends `expectedPrice` per line; a line
priced otherwise in between is refused with A's `PRICE_CHANGED_REFUSAL` and nothing is made.

### 6.1 The desk (§4.3, `/desk`)

The Student 360 gains **+ Reserve** (the `Reserve` card with the session picker, preselected when
one session is open), **Statement**, and the reservation slip. One consent tick ("Refund policy
and declaration read and signed by the parent") covers the reservation. **Reserve only** makes
the lines waiting for payment; **Reserve and collect** (instrument, escrow to apply) makes them
and collects in one payment per entry deadline; a line on a provisional board fee is reserved and
listed "collected once the fee is confirmed", the rest collected; everything provisional → nothing
collected. The answer lists the receipts to hand over and the slip link. A family onboarded at
the desk stays open with its Reserve page (no second search). The unpaid bar collects only lines
payable now, names the provisional ones, and takes the parent's consent for lines the school
reserved (grade 10). "Owes now" (and the family home's owing) leave out a provisional line unless
`pricing.payOnProvisionalFee` is on.

### 6.2 The family (§4.4, `/register`)

Child and session pickers (the session preselected when there is one), the school-fee notice
when the fee is not settled, the `Reserve` card with the two consents (the refund steps written
out, and the declaration). A student's reservation is sent to the parent for approval; a parent's
is a direct reservation, or a preregistration when the session has not opened; then **Pay now**
to the checkout by series. The checkout asks the family's consent for lines the school reserved.

### 6.3 The statement (§4.5)

`/statement` for the family; the Student 360's section at the desk. The reservation slip
(`/reservation-slip/[studentId]?ids=`) prints the lines and the consent texts.

### 6.4 The Session screen's tabs (§4.6)

**To verify** (coordinator, admin, finance): Awaiting and Answered; Verify (centre and candidate
number on a carry-forward, reason; the finance desk's evidence) and Not confirmed (reason), each
saying what will happen to that line. **Money** (A's): a section filter added, the student linked
to the statement, **Remind** shown disabled ("Reminders arrive with the messages step", D's),
Export as A built it.

### 6.5 Step counts (UX_AUDIT §4, RESERVATIONS_REWORK.md §11), measured in headless Chrome

| Task | §11's design | Measured | Evidence |
|---|---|---|---|
| The desk: onboard a walk-in family, 3 subjects (one a self-study retake declared with its sitting, one with a teacher picked), consent, instrument, collect | 14–15 inputs, 4 clicks | **15 inputs, 3 clicks** (7 onboarding, 3 ticks, entry + sitting 2, teacher 1, consent 1, instrument 1; + New Family, Create & Link, Reserve and collect). 14 inputs when the instrument is the default cash. EGP 53,000 collected in 3 payments, one per entry deadline | `s11-desk-count.txt`, `screens/s11-*.png` |
| The family: 3 subjects, one a declared self-study retake, one teacher pick | 6–8 answers | **8 answers, 1 click** (3 ticks, entry + sitting 2, teacher 1, 2 consents; Reserve) | same file, `screens/s11-family-*.png` |
| The desk for a student already on file (4 lines incl. a carry-forward naming its sitting) | — | 3 inputs and 8 clicks from the search box (ticks counted as clicks here) | `screens/desk-*-en.png` |

The Excel version of the desk task: read the sheet, fill three forms of about 35 answers, write
the fee note and a paper receipt. Our system today: 13–16 inputs and 5–6 clicks with no way to
set a walk-in family's retake. The design's count holds, with the retake possible and the price
right.

## 7. Tests

- **08o-reservation-lines** (15 scenarios): a family reserves in the app (one line per item, the
  entry chosen, both consents required and recorded, the refund steps frozen); the price shown is
  the price charged; a declared retake (created series, retake price, listed to verify; a first
  entry names none); a known sitting filled and not listed, its retake to the retake deadline;
  verified (previous centre recorded, answered once); rejected unpaid (refused while a checkout
  is open, then expired and told, a first entry reservable); rejected paid before the deadline
  (stands, `declaration_rejected`); rejected paid after it (receipt-gated drop, the refund on the
  receipt's return, `boardSent` false between the deadlines); unverified at the deadline under
  both settings, once; grade-10 lines: the school's consent, the family's at checkout, never
  confirmed without; a swap's line inherits consent and refund steps; the teacher on a line (all
  of §4); the desk's reserve only / reserve and collect with a provisional line (and "owes now");
  the family's flow end to end with the statement's numbers equal to the ledger's; `/available`
  gone.
- **08t** (A's file, extended): two desks at once (the loser 409, one consent pair); a declared
  sitting answered while its line is paid — checkout first, rejection first, verified while
  confirmed; the hold step by two schedulers. A's races now reserve through the desk's endpoint
  (typed client); the fee-confirm race stays on the services (a request cannot be paused between
  its fee lock and its commit).
- **05**: cross-family cases for `/statement` (by student and by family), `/to-verify`,
  `/verify-prior`, `/teacher`.
- **authz-policy.tsv**: rows for the four endpoints; `/registrations/available` removed.
- **09** (B's block, last): every line confirmed since the rework has both consents; a line the
  family or desk consented to has its refund steps frozen (weeks or dates); a declared sitting is
  answered once, by someone, only a paid line stands rejected, and every `declaration_rejected` /
  `hold_unverified` expiry and `LINE_DROPPED_UNVERIFIED` follows from its answer; the expiry
  reasons list gains the two.
- **The suites converted** to lines and consent (`reservationOf`, `swapTo` in helpers.ts); the
  assertions restated are in the trail (08d #13, 08i, 08f's settings count, 09's reasons).
- **Controls** (each guard undone, its test red; logs `control-*.log`): confirmation's consent
  check; 0045's trigger; the checkout's family consent; already reserved; the price shown;
  the rejection's open-payment refusal; the answer's row lock; hold's since-rule (query alone
  green — doubled by the re-check; both red); the statement's parent link; swap consent
  inheritance; the teacher pool; self-study to taught; the hold step's lock (alone green —
  doubled by the drop's conditional update; both red); the rejection's sent state; "owes now"
  on the desk and the home.

## 8. Decisions and why

1. **Consent is unique per (line, kind, channel)**, not (line, kind): a grade-10 line carries the
   school's pair and the family's own beside it (§3.5). Rows are written `on conflict do
   nothing`, so a retried write is harmless.
2. **A structural guard behind the sentence**: a deferred constraint trigger refuses, at commit,
   a confirmed line without both kinds (converted lines exempt). The services refuse first with
   `CONSENT_MISSING_REFUSAL`; the trigger keeps a later path from confirming a line nobody
   consented to.
3. **The refund steps are frozen with the consent** (`refund_policy_snapshot`): weeks from the
   session's policy, or dates from the absolute refund windows (session, else academic year).
   A's §5 lists the snapshot under C; §1.6/§2.10 and the brief give it to B, so B built it.
4. **`hold` reaches only deadlines that passed while it was on.** A line whose deadline passed
   under `enter_as_declared` was entered then; dropping it when the setting changes would act on
   a decision already made. Owner question Q-B1.
5. **A waiting line with a payment open is not ended by a rejection or by hold**: the rejection
   is refused until finance confirms or rejects the payment; hold leaves it to the deadline sweep
   on the same tick. A line is never expired under an open payment.
6. **A funded preregistration whose declaration is rejected stands**, before or after the
   first-entry deadline: it is not entered yet; capture or MO-21's deadline refund settles it.
7. **The finance desk verifies with evidence**; the coordinator and the admin need not give it.
8. **The swap's new line inherits the dropped line's consent**; a dropped line from before the
   rework has none to give, so the family ticks both for the new subject (the request carries it).
9. **The desk's provisional lines** are reserved now and collected once confirmed (§4.3), and
   "owes now" leaves them out: the header must not show money nobody can collect.
10. **The reservation totals split by the line's effective deadline**, as the desk and the
    checkout take the money, not by series: a Cambridge retake of the previous sitting is its own
    payment.
11. **The onboarded family stays open**: §11 counts on it.

## 9. Deferred, and why

- **An F4 result as a `known` sitting**: no F4 results table exists; `knownSittingsOf` reads
  earlier lines only. F4 adds its source there.
- **`refundFor`** is C's; `refundForSystemDrop` is the seam (§3.5).
- **The statement's charges** are C's (`charges: []`).
- **Remind** on the Money tab and the coordinator's "declared retakes to verify" reminder rule are
  D's; the button is shown disabled and the list is `listToVerify`.
- **The desk's handling of a line past its deadline**: the desk-drop is C's, and A's staff refusal
  is promised in RESERVATIONS.md §2.12, which had not landed when this was written.
- **The swap pickers** name the new line's entry; an old pending swap request (made before the
  rework) reads the subject's whole item, first entry, as §7 maps it.

## 10. For the lead

1. **`line_effective_deadline` should read a rejected declaration as a first entry.** A paid
   line standing with `declaration_rejected` keeps `attempt = retake` and its prior sitting, so
   its effective deadline stays the retake deadline; F4 enters it as a first entry, which the
   board takes only to the entry deadline. The SQL function is A's (0042). Until then, the "sent"
   rule, due dates and the statement read the later date for such a line.
2. **A's grade-10 commit writes the `school` consent rows without a refund snapshot**; B writes
   the snapshot when the family consents (at checkout or the desk's collect), which is when the
   family agrees to a policy. If the owner wants the policy frozen at the school's commit, it is a
   one-line change in A's commit.
3. **A's §5 vs §1.6/§2.10** on the refund snapshot: built by B (decision 3); A's §5 should say so.
4. **A's `replaceTeacher`** moves enrolments by subject and teacher for the year, not by the
   offer's units; a student taught the same subject by the same teacher in another session of the
   year moves too. B's per-line change works per unit.
5. **Pre-existing on `main`, not changed here**: an Arabic user gets a React hydration mismatch
   on every server-rendered page (`I18nProvider`'s `useState` initializer reads localStorage, so
   the server's English differs from the client's Arabic: the sign-in page's language button shows
   it); the receipt status "Ready to Hand Over" has no Arabic, nor do My Registrations' "Pay All",
   "Swap", "Drop" and its refund sentence; a swapped line's note shows the family the dropped line's
   internal id ("Direct swap from registration …").
6. **A's §2.12** had not landed when this was written: B's lines already pass
   `priorSittingSource` explicitly (null only with no prior sitting); merge and rerun when it lands.
7. **C**: `consentStanding` / `writeConsents` for the checkout and the desk; `refundForSystemDrop`
   to replace; `statementFor`'s `charges`. **D**: `DECLARATION_REVIEWED` notifications exist; the
   Remind button waits.

## 11. Questions for the owner

- **Q-B1 (Q-22's reading).** Under `hold`, should a declaration still unverified when the
  setting is turned on be dropped at once if its deadline already passed, or only declarations
  whose deadline passes after? Built: only after.
- **Q-B2.** The finance desk may verify a declared sitting when the family shows the board's
  statement; it must say what it saw. Is the coordinator's word needed as well?
- **Q-B3.** A rejected declaration on a paid line before the first-entry deadline stands as a
  first entry, and the family paid a retake's (or self-study's) price. Should the system raise the
  price adjustment itself, or is finance's explicit charge (C) the rule?

## 12. Progress log

Times UTC, from the trail (`.audit/rework-reservations.tsv`), which holds each event's source.

- 2026-10-07 22:12Z — worktree and branch from A's 5367cf8; git through plumbing from lead-env;
  env files for API 3111, web 3110, `igcse_rwb_dev`. 22:28Z fast-forwarded to A's 27e3233;
  22:30Z baseline suite green there (25 files, 341 passed, 1 todo).
- 22:38Z — migrations 0044 (generated) and 0045 (the consent guard).
- 22:55Z — API: lines and consent on every path, verification, the teacher change, the statement,
  the hold step; `/registrations/available` removed.
- 23:02Z–23:10Z — the suites converted to lines and consent; the restated assertions in the trail.
- 23:16Z — decision: hold reaches only deadlines that passed while it was on. 23:17Z 08o green
  (15 scenarios).
- 23:31Z — merged A's 977848d (step 1 finished); 23:38Z full suite green on the merge (26 files,
  361 passed, 1 todo).
- 23:47Z — 08t races and 05 cases green; 23:48Z–23:51Z eleven controls (nine red, two green with
  the guard doubled, then red with both layers undone).
- 2026-10-08 00:16Z — the web committed (a68e84b): Reserve, statement, To verify, Money, slip,
  checkout consent, swaps, Arabic.
- 00:23Z–00:26Z — desk, family and session screens driven in headless Chrome (English).
- 00:28Z–00:36Z — the Arabic runs: missing strings added, a three-node phrase joined, selects
  widened, consent ticks reset; a pre-existing hydration mismatch noted (§10.5).
- 00:39Z — "owes now" leaves provisional lines out (desk and home); 00:40Z controls red.
- 00:44Z–00:50Z — the onboarded family stays open; totals by effective deadline; §11 measured:
  desk 15 inputs and 3 clicks, family 8 answers and 1 click.
- 00:57Z — A's 08t races ported to the typed client (14 passed).
- 01:00Z–01:05Z — controls for the teacher change and the hold step's two schedulers; the
  rejection after the first-entry deadline passes the line's own sent state (control red).
- 01:09Z–01:12Z — **gates green on 0dbbbc7**: the API suite in local time and with `TZ=UTC`
  (26 files, 366 passed, 1 todo each), `@repo/api` and `web` check-types (01:10Z); useQuery
  generics 25. The commit after it adds only this document and the trail.
- 01:13Z — the dev API restarted (it ran without watch); the Arabic desk driven again: "owes
  now" 0 with a provisional line reserved.
- 01:20Z — CI green on cbd2d5a (the pushed branch: three gates).
- 01:16Z–01:28Z — the remaining screens driven: a student's reservation sent to the parent and
  the parent's approval; the parent's swap from a paid line to a new one (the line made, the old
  one dropped, consent inherited); the verification setting (its Arabic description and group hint
  were missing: added).
