# Reservations rework — step 2, agent B: reservation lines, consent, declared sittings, the Reserve pages, the statement

Branch `feature/rework-reservations` (worktree `.claude/worktrees/rework-reservations`), from
agent A's `feature/rework-sessions` (5367cf8, then 27e3233; merged at 977848d and at 40c1447,
which carries A's §2.12). The design is
`RESERVATIONS_REWORK.md` version 8 (accepted by the owner on 7 Oct 2026 with its §17
defaults); this is its §9 step 2, agent B, and §3.5, §4.3–§4.6. A's contract is
`docs/features/RESERVATIONS.md` §1, §2 and §2.11. The plan's rules are FEATURES_PLAN.md §3–§5.
Trail: `.audit/rework-reservations.tsv`; evidence (suite logs, controls, screenshots):
`.audit/rework-reservations-evidence/` (git-ignored). The progress log is the last section.

Resources (FEATURES_PLAN.md §7): test database `igcse_rwb_test`, dev database
`igcse_rwb_dev` (a copy of `igcse_template_dev`), API 3111, web 3110.

---

## 1. The data model this step adds

Migrations after A's 0044 (`0044_rework_sessions_followups`, on `main` since b438976): B's were
0044 and 0045 until the merge of `main`, regenerated then on top of A's journal as 0045 and 0046
(the generated SQL statement for statement the same; the custom one copied):

### 1.1 `0045_rework_reservations` (generated)

| Table | Column / index | Rule |
|---|---|---|
| `registration` | `prior_sitting_verified_by` (user), `prior_sitting_verified_at`, `prior_sitting_verified_outcome` (`verified` \| `rejected`) | the coordinator's answer to a declared sitting; an outcome needs who and when and a sitting (check `registration_prior_sitting_outcome_valid`) |
| `registration` | `declaration_rejected` (bool, default false) | a paid line whose declaration was rejected before the first-entry deadline stands with it; F4 reads its attempt as `first` (check: only after a rejection) |
| `registration` | index `registration_to_verify_idx` | the To verify tab's rows (declared, unanswered), per session |
| `change_request` | `new_line` (jsonb) | the swap's new line as asked: attempt, mode, teacher, the sitting it follows, whether the family consented with the request |
| `registration_consent` | unique (line, kind, **channel**) | was (line, kind): a grade-10 line carries the school's pair (`school`) and the family's own (`app` or `desk`) beside it |

`prior_centre` and `prior_candidate_number` were added by A (0041); B fills them at
verification.

### 1.2 `0046_rework_reservations_consent_guard` (custom)

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
| every page that asks for consent | `GET /v1/sessions/:id/refund-terms` → `{ terms }`, from `refundTermsFor(executor, sessionId)`: the snapshot a consent in that session freezes (weeks, or a converted session's dates); the checkout summary's `familyConsentTerms` per session |

---

## 3. Declared sittings and their verification (§3.5)

### 3.1 How a line gets its sitting

`resolveReservationLines` (reservation.services) turns what a page sent into the lines
`insertLines` makes, inside the caller's transaction and after the student lock:

| The page sends | The line gets | `prior_sitting_source` |
|---|---|---|
| a retake (or a carry-forward item, `needs_prior_series`) naming nothing, and the student has a confirmed line for what the item enters in another session | the latest such sitting | `known` |
| a retake naming `priorSittingSeriesId` (a series on record) or `priorSitting { month, year }` | that series; for a month and year not on record, a `board_series` row with no dates and an empty label is created (`findOrCreateSeries`, audited `BOARD_SERIES_CREATED` with the reason "Created when a family (or the desk) declared a sitting not on record") | `known` when it is one of the student's known sittings, else `declared_by_family` (app paths) or `declared_by_desk` (staff paths) |
| a retake with no sitting and nothing known | refused by A's `gate.retakeDeclared` sentence | — |
| a first entry naming a sitting | refused (a first entry follows no sitting) unless its item carries one forward | — |

The named sitting must be of the item's board and before the item's series; `gate.priorSeries`
(A) checks the carry-forward period. A family declares a sitting of the board's last two years
(24 months before the item's series), as its picker offers (`declarableSittings` on A's offers
read); an older one is refused with "… is declared at the finance desk, with the board's
statement", and the desk may declare it. A **known** sitting is one the student sat: a confirmed
line only — a dropped line was never sat, so naming it is a declaration, listed to verify (the
review, 8 Oct; the Reserve page and the swap pickers read the offers read's `knownSittings` the
same way, by their status). An F4 result as a `known` source is not built: there is no F4
results table yet (§9).

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
is answered once (409 after). Locks: the line's receipt first (when it has one), then the line
`FOR UPDATE` — MA-16's order, the one the reversal, a receipt's void and return, the
receipt-gated drop and a parent's approval take (the lead's decision of 8 Oct: receipt first
everywhere; §8 decision 12, §10.7) — then its payments are read. The To verify modal says,
before the answer, the one outcome below that applies to the line, and refuses a rejection
while a payment is open.

| Line when answered | `verified` | `rejected` |
|---|---|---|
| waiting (pending approval or payment, an unfunded preregistration), no payment open | stands; centre and number recorded on a carry-forward from another centre (the audit row says only that they were recorded) | **expires**, reason `declaration_rejected`; the family is told (`DECLARATION_REVIEWED`, student and linked parents) and may reserve a first entry where the item takes one |
| waiting, a payment open | stands | **refused 409**: "A payment for this line is in progress: confirm or reject it in the Finance Workbench first" (08t forces both orders) |
| paid (confirmed, or a funded preregistration), before the first-entry deadline | stands | **stands** with `declaration_rejected = true` (F4 enters it as a first entry); the family is told; finance decides any price adjustment (C's charge) |
| a funded preregistration, after that deadline | stands | stands as above: its capture or MO-21's deadline refund settles it |
| confirmed, after the first-entry deadline | stands | **dropped** through `executeReceiptGatedDrop` (MA-16: the paper receipt comes back before the money moves); the refund from `refundForSystemDrop(line, now, { boardSent })` where `boardSent` is the line's own sent state (its effective deadline passed): the window's percentage of the course part (the price less the recorded board fee), and the board fee in full while it is not sent (a declared retake of the previous sitting before the retake deadline), none once sent; `boardSent` and `boardFeeKept` on the audit row. A line paid while the answer waited for it (its receipt made after the answer looked for one) is refused with "open it again and answer again" rather than dropped with the receipt taken after the line |

### 3.4 Unverified at the deadline: the setting and the hold step

`verification.unverifiedAtDeadline`: `enter_as_declared` (default) does nothing — F4 lists the
line as declared, unverified. `hold`: `holdUnverifiedAtDeadline(now)` runs first in
`enforcePaymentDeadlines` (the scheduler's deadline tick; its result adds `unverifiedExpired` and
`unverifiedDropped`; a failure is logged and the sweep goes on):

- a waiting line whose effective deadline passed, no payment open → **expires**
  (`hold_unverified`); with a payment open it is left to the deadline sweep that follows on the
  same tick (which fails the payment and expires the line, as at any deadline);
- a confirmed line → **dropped** through the receipt-gated drop with that day's refund, the
  board fee counted **not sent** (a held line was never entered: refunded in full, beside the
  window's percentage of the course part), audit `LINE_DROPPED_UNVERIFIED`; a line found waiting
  and confirmed by the time it is locked is left to the next tick (its receipt is then taken
  first) — not reachable through a confirmation, which refuses a line past its deadline (MO-10),
  so a defence only;
- only a deadline that passed **while `hold` was in force** counts — from the moment the value
  became `hold` (its latest `SETTING_CHANGED` row to `hold`; the setting row's own time only for
  a row never changed through the settings page): a line whose deadline passed under
  `enter_as_declared` was entered as declared then, and turning `hold` on later does not reach
  back (§8, decisions 4 and 13);
- claim before acting (ST-06, ST-12): each line is locked and read again in its own transaction
  and acted on only while still unverified and in the status it was found in. Two schedulers at
  once drop a line once (08t); the drop's own conditional update is a second layer (control
  `hold-two-schedulers` stayed green with the lock alone undone, red with both).

### 3.5 The refund seam

`refundForSystemDrop(line, at, { boardSent })` (reservation.services) is the one place a system
drop of a declared sitting computes its refund: the design's rule (RESERVATIONS_REWORK.md §3.10)
with today's percentage (the refund windows', or a custom exception's: `refundPercentage`) until
C's `refundFor` merges — the **course part** (`price − registration_fee_at_registration`) by the
percentage, and the **board fee in full while it is not sent** (none once sent: the school has
paid the board). It returns `boardFeeKept`. C replaces the body with `refundFor` and the amounts
must not change then (08o pins them: 12,700 for a not-sent drop and 3,500 for a sent one, on a
16,200 line with a 9,200 board fee at 50%). History: the first review found `boardSent`
ignored (a sent board fee refunded); the second found the not-sent case keeping part of a board
fee the school never paid.

## 4. The teacher on a line

`PUT /v1/registrations/:id/teacher { teacherId: string | null, mode?, reason }` — the admin, the
coordinator and the finance desk (the family asks there). Locks in A's §2.1 order: the student
`FOR SHARE`, the offer and the item `FOR SHARE` (a teacher removed or the item closed at the
same moment waits, or is seen), then the line `FOR UPDATE`. Rules, each with its sentence:

- the teacher must teach the item (its own teachers, else the offer's) and be active;
- `null` ("no preference") only where the item has several teachers; refused where it has one,
  and a subject nobody teaches can only be self-study;
- `mode: 'self_study'` takes the teacher off; a self-study line is **not** moved to taught (it was
  priced as self-study: drop it and reserve it in school); a move to self-study is **not**
  re-priced (a refund is finance's own act);
- a **first entry** of an item the school teaches — a retake whose declaration was rejected
  counts as one (§3.5) — is not moved to self-study unless the student holds
  `gate.selfStudyFirstEntry` (G-09): a staff change is not the exception. The gate is asked as
  `assertLineRules` asks it: the exception `FOR UPDATE`, a one-shot one marked used (the reviews
  of 8 Oct, flags 7 and 5); a retake may move;
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
outstanding (as A's Money tab's `unpaid`: a line waiting for payment, or a preregistration nobody
has paid; a line still waiting for the parent's approval is not owed yet), refunded, or waiting
on a receipt's return; the due date and days overdue; whether
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
Per item: a tick (an item is open per attempt, §2.12: past the entry deadline with the retake
deadline ahead it says "retakes of the previous sitting only" and offers only retakes); the entry in the forms' words ("First entry, in school", "Retake, self-study",
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
when the fee is not settled, the `Reserve` card with the two consents (the refund terms the tick
freezes written out — the session's steps in weeks, or a converted session's windows as dates,
from `GET /v1/sessions/:id/refund-terms` — and the declaration). While the terms load the tick
says so and stays off; if they cannot be read it says so, and nothing can be reserved. A student's reservation is sent to the parent for approval; a parent's
is a direct reservation, or a preregistration when the session has not opened; then **Pay now**
to the checkout by series. The checkout asks the family's consent for lines the school reserved,
showing the terms of each line's session (`familyConsentTerms` on the checkout summary). A swap
asked since step B (it names its line) is approved at the price the request showed
(`priceAtRequest`) or refused with its own sentence ("The price of the subject to swap to has
changed since the swap was asked for: ask for the swap again to see the new price", in English
and Arabic); a request from before step B priced the subject, not a line, and is made at today's
price, as approval always did. A swap that must ask for consent (the dropped line has none to
give) shows the same terms, with the same loading and failure states.

### 6.3 The statement (§4.5)

`/statement` for the family; the Student 360's section at the desk. The reservation slip
(`/reservation-slip/[studentId]?ids=`) prints the lines and the consent texts, and marks a
declared sitting (a retake's or a carry-forward's) "to be verified by the school" until it is
answered; the Reserve page marks a declared carry-forward the same way.

### 6.4 The Session screen's tabs (§4.6)

**To verify** (coordinator, admin, finance): Awaiting and Answered; Verify (centre and candidate
number on a carry-forward, reason; the finance desk's evidence) and Not confirmed (reason), each
saying the one outcome that applies to that line (unpaid; paid and held; paid before or after the
first-entry deadline, a granted late entry counted), and refusing a rejection while a payment
is open (a warning `Notice`). **Money** (A's): a section filter added, the student linked
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

- **08o-reservation-lines** (19 scenarios): a family reserves in the app (one line per item, the
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
  gone. Added after the review (8 Oct): a dropped line is not a known sitting; a converted
  session freezes its windows as dates (the session's, else its academic year's) and the family
  reads the same terms; rejected after its own deadline the board fee the school paid is kept
  (escrow asserted in both cases); the statement's outstanding equals the Money tab's unpaid; a
  family's declaration bounded to two years and its series' audit reason; a taught first entry
  not moved to self-study by staff; a swap approved at a changed price refused; hold counting from
  its change row. After the second review: a rejected preregistration captured between the
  deadlines refunded in full; the deadline sweep and the preregistration refund reading the flag;
  the not-sent refund (12,700) and the sent one (3,500); a swap from before step B approved at
  today's price beside a new one refused with its own sentence; the teacher change's gate with a
  rejected declaration and a one-shot exception locked and used once. 08t: a payment confirmed
  while a rejection waits for the line — the rejection refused ("answer again"), then dropped
  with the receipt taken first.
- **08t** (A's file, extended): two desks at once (the loser 409, one consent pair); a declared
  sitting answered while its line is paid — checkout first, rejection first, verified while
  confirmed; a parent's approval of a drop against the coordinator's rejection of the same paid
  line, and a payment reversal against the rejection, each in both orders (one waits, nothing
  deadlocks: receipt first everywhere); the hold step by two schedulers. A's races
  now reserve through the desk's endpoint
  (typed client); the fee-confirm race stays on the services (a request cannot be paused between
  its fee lock and its commit).
- **05**: cross-family cases for `/statement` (by student and by family), `/to-verify`,
  `/verify-prior`, `/teacher`.
- **authz-policy.tsv**: rows for the five endpoints (`/sessions/:id/refund-terms` added);
  `/registrations/available` removed.
- **09** (B's block, last): every line confirmed since the rework has both consents; a line the
  family or desk consented to has its refund steps frozen (weeks or dates); a declared sitting is
  answered once, by someone, only a line paid when rejected stands rejected (a later reversal
  leaves it waiting), every `declaration_rejected` / `hold_unverified` expiry and
  `LINE_DROPPED_UNVERIFIED` follows from its answer, and a line the system dropped was refunded
  at most its price; the expiry reasons list gains the two.
- **The suites converted** to lines and consent (`reservationOf`, `swapTo` in helpers.ts); the
  assertions restated are in the trail (08d #13, 08i, 08f's settings count, 09's reasons).
- **Controls** (each guard undone, its test red; logs `control-*.log`, runner
  `scripts/controls.py` in the evidence). On d828ab7, 18 controls: 16 red, 2 green (the review's
  count; my first report said 19, wrongly): confirmation's consent check; the consent trigger (0046 now); the
  checkout's family consent; already reserved; the price shown; the rejection's open-payment
  refusal; the answer's row lock; hold's since-rule in the query alone (green — doubled by the
  re-check) and in both (red); the statement's parent link; swap consent inheritance; "owes now"
  on the desk and on the home; the teacher pool; self-study to taught; the hold step's lock alone
  (green — doubled by the drop's conditional update) and with the drop's condition (red); the
  rejection's sent state. After the review, 11 more, all red: the answer's lock order (the line
  first: the approval and reversal races deadlock); the approval's receipt lock (the approval race
  deadlocks); the sent board fee kept; the academic year's windows; known means confirmed; the
  checkout's terms; a taught first entry not moved to self-study; the statement's outstanding; the
  family's two-year bound; hold from its change row; the swap approval's price. The answer's row
  lock was run again on the receipt-first code (02:24Z) so its log matches the row that cites it.
  After the merge of `main`, 3 for the flag (the statement, `effectiveDeadlinesOf`,
  `lineDeadlineSql`); after the second review, 8 more, all red: capture's columns, the sweep's and
  the preregistration refund's conditions, the not-sent board fee, the paid-meanwhile refusal,
  the old swap's price, the teacher gate's lock and its rejected-declaration rule. 41 controls in
  all (39 red; the 2 green ones each doubled, red with both layers undone), counting
  `lock-order-receipt-first`, which proved the brief line-first order of 7550f5f and is obsolete
  since its revert. Logs are kept
  trimmed: the run's summary, the failing tests and their messages.

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
   a decision already made. Confirmed by the lead (decision 13, Q-B1).
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
12. **Receipt first, then the line, everywhere** (the lead's decision, 8 Oct, after correcting
    its earlier note; §10.7): the answer to a declared sitting and the hold step take the line's
    receipt (when it has one) before the line, as the reversal, a receipt's void and return, the
    receipt-gated drop and — since this step, as A is asked to do on its branch — a parent's
    approval of a change request. 08t forces the approval and the reversal against the rejection,
    both orders each; nothing deadlocks.
13. **Decided by the lead from the design (8 Oct), formerly questions for the owner:**
    - Q-B1: `hold` acts only on deadlines that pass after it is turned on, as built; a line whose
      deadline had already passed was entered as declared, and F4 lists it as "declared,
      unverified".
    - Q-B2: the finance desk's verification with the board's statement in hand is sufficient
      (§3.5: "the desk may verify when the family shows the board's statement"); no second
      confirmation.
    - Q-B3: a rejected declaration that stands on a paid line never raises a price adjustment
      automatically; finance decides with an explicit `price_adjustment` charge (§3.5, §3.6).

## 9. Deferred, and why

- **An F4 result as a `known` sitting**: no F4 results table exists; `knownSittingsOf` reads
  earlier lines only. F4 adds its source there. *(F4, after the review of 093dbd1: a declared
  sitting with a real grade on record is verified at declaration inside `reserveLines`, the
  importer answering through `recordVerifiedInTx`, and the To verify tab checks the awaiting ones;
  `knownSittingsOf` reading F4's results and sent entries stays B's — EXAM_ENTRIES.md §7.)*
- **`refundFor`** is C's; `refundForSystemDrop` is the seam (§3.5).
- **The statement's charges** are C's (`charges: []`).
- **Remind** on the Money tab and the coordinator's "declared retakes to verify" reminder rule are
  D's; the button is shown disabled and the list is `listToVerify`.
- **The desk's handling of a line past its deadline**: the desk-drop is C's; A's §2.12 refuses
  a family's approval of a drop or swap past the line's deadline.
- **The swap pickers** name the new line's entry; an old pending swap request (made before the
  rework) reads the subject's whole item, first entry, as §7 maps it.

## 10. For the lead

1. **Done by A (on `main`, b438976), wired by B at the merge and after the second review:**
   `line_effective_deadline` reads a rejected declaration as a first entry (its fourth argument,
   A's 0044). The flag is now **required** on `LineDeadlineKey` (`declarationRejected: boolean |
   null`), so no line object can leave it out by accident (the second review found four that did,
   each defaulting to "not rejected"). Every reader, in SQL and in TypeScript:
   - SQL, with `declaration_rejected` as the fourth argument: `lineDeadlineSql` (the deadline
     sweep's open payments, the checkout's grouping and every reader of it),
     `effectiveDeadlinesOf`, the deadline sweep's expiry condition, the preregistration refund's
     condition, the series correction's move, the statement (lines and payments), the Money tab,
     the InstaPay reference's cap, the hold step's query, and 09's per-series rules;
   - TypeScript, the line objects handed to `effectiveDeadlineFor` and `sessionWindow`, each
     reading the column: preregistration capture and cancellation, `confirmPayment`'s lines
     (both `sessionWindow` calls), `failOpenPayment`'s expiry check, `collectAtDesk`,
     `dueDateFor`, the approval's re-check and `assertBeforeLineDeadline`'s callers, the item's
     and the admin's moves, the answer to a declaration (its own deadline), the hold step's
     re-check and the To verify list;
   - `false` by construction where no line exists yet or a first entry is meant: a line being
     made (`insertLines`), the offers read's first-entry cut-off, the answer's and the To verify
     list's first-entry deadline (with the student, so a granted late entry counts there too, as
     on the line's own deadline).
   08o: a declared retake of the previous sitting reads the retake deadline, and rejected while
   paid the entry deadline (the statement, `effectiveDeadlinesOf`, `lineDeadlineSql`); a held
   preregistration rejected and captured between the two deadlines is refunded in full, not
   confirmed (MO-21); the deadline sweep expires a reverted waiting line and the preregistration
   refund returns a held one at the entry deadline. Six controls red (the statement,
   `effectiveDeadlinesOf`, `lineDeadlineSql`, capture's columns, the sweep's and the
   preregistration refund's conditions). The hold step's query passes the flag too, but it only
   selects unanswered declarations (`declaration_rejected` false), so no test can tell it from
   three arguments: it is passed for the rule's sake. C's `charge_effective_deadline` is C's at
   its merge.
2. **Done by A:** the grade-10 commit freezes the refund steps with the school's consent; A's §5
   says the snapshot is B's at consent; `replaceTeacher` moves enrolments per unit; the offers
   read lists only confirmed lines as known sittings (as B's server does).
3. (Merged into 1 and 2.)
4. (Merged into 1 and 2.)
5. **Pre-existing on `main`, not changed here**: an Arabic user gets a React hydration mismatch
   on every server-rendered page (`I18nProvider`'s `useState` initializer reads localStorage, so
   the server's English differs from the client's Arabic: the sign-in page's language button shows
   it); the receipt status "Ready to Hand Over" has no Arabic, nor do My Registrations' "Pay All",
   "Swap", "Drop" and its refund sentence; a swapped line's note shows the family the dropped line's
   internal id ("Direct swap from registration …").
6. **A's §2.12** is merged (40c1447): B's lines pass `priorSittingSource` explicitly (null only
   with no prior sitting); the Reserve page and the swap pickers read `item.open` per attempt and
   each price row's `open` (an object was always truthy, so the merge alone would have offered
   closed entries: fixed in 2f09f43 and driven with an item past its entry deadline).
7. **The lock order for a line and its receipt: decided, receipt first (MA-16).** The lead's
   note of 8 Oct asked B to take the line before its receipt "matching A's approval path (and
   MA-16's drop takes the line it drops first)". That premise was wrong, and the lead corrected
   it the same day: MONEY_AUDIT.md MA-16 fixed the order as the receipt first (the reversal's
   order), and the reversal (payment, receipts, then lines), the void (ST-14: "Receipt first,
   then its registration — the order a drop, a return and a reversal lock them in"), the return
   and `executeReceiptGatedDrop` all take it so. Measured before the decision: with B's answer
   line-first, a rejection holding a paid line while finance reversed its payment deadlocked
   (Postgres aborted the reversal, "Failed to reverse payment";
   `scratch-reversal-vs-rejection-line-first.log`); with B's answer receipt-first and A's
   approval line-first, the approval race deadlocked. **Decision (the lead): receipt first
   everywhere; the audited paths do not move.** B's answer and hold step take the receipt first
   (7550f5f's change reverted); A's approval re-check takes the receipt before the line on this
   branch too (the same change A is making on its own; A's version wins at the merge); A's
   preregistration cancel is A's to change; A writes the pair into RESERVATIONS.md §2.1 as
   "receipt, then line (MA-16)". 08t: approval against rejection and reversal against rejection,
   both orders each, green; controls `lock-order-line-first` and `approval-line-first` red.
8. **C**: the two expiries step B makes directly — a rejected declaration on an unpaid line
   (`verifyPriorSitting`) and `hold` at the deadline (`holdUnverifiedAtDeadline`) — set the line
   `expired` without C's plan settlement; at C's merge they go through it (on C's list too). The
   teacher change asks `gate.selfStudyFirstEntry` as `assertLineRules` does (the exception `FOR
   UPDATE`, a one-shot one marked used through the adapter's `markUsed`), so C's registry inherits
   it with no change here. `consentStanding` / `writeConsents` for the checkout and the desk; `refundForSystemDrop`
   to replace; `statementFor`'s `charges`. **D**: `DECLARATION_REVIEWED` notifications exist; the
   Remind button waits.
9. **Dev databases** migrated through A's migrations before B's consent guard (0046) hold interim lines B's trigger
   refuses to confirm (lines made between the two with no consent rows): dev only — a production
   database migrates 0045 and 0046 with the rest and has no such lines; a dev database is
   recreated from its template.
10. **F7's import must reserve through `reserveLines(..., channel: 'imported')`** so each imported
    line carries the sheet's confirmation as its two consent rows (a note for F7's document).
11. **`findOrCreateSeries` (A's, offer.services) takes an optional audit reason** so a series row
    created by a declaration says so; A's own callers keep their sentence (a one-parameter,
    defaulted addition).

## 11. Questions for the owner

None open. The three this step raised were answered by the lead from the design (§8, decision 13).

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
- 01:37Z — A's 40c1447 (§2.12) merged: four conflicts resolved (prereg imports, swap imports, 08n's
  helper, the Money tab — A's section filter from the API kept, B's own removed); A's two new 08n
  call sites converted; the Reserve page and swap pickers read openness per attempt; an item past
  its entry deadline driven: only retakes offered, a declared retake of the previous sitting
  reserved.
- 01:39Z–01:42Z — **gates green on 2f09f43** (the merge and its fixes): the API suite in local time
  and with `TZ=UTC` (26 files, 376 passed, 1 todo each), API check-types; web check-types on the
  final tree. The commit after it widens two selects and updates this document and the trail.
- 01:53Z — the lead's message: dev servers restarted on 3111/3110 against `igcse_rwb_dev`, left up
  for the lead's drive and the reviewer.
- 01:58Z–02:03Z — the answer to a declared sitting and the hold step take the line before its
  receipt; 08t forces a parent's approval against the coordinator's rejection in both orders
  (16 passed); control red (deadlock) with the receipt first; a scratch run shows the reversal
  still takes the receipt first and deadlocks against a line-first rejection (§10.7). The lead's
  answers to Q-B1–Q-B3 recorded (§8, decision 13).
- about 02:20Z (between CI on afb9018 at 02:18Z and the first edit at 02:21Z) — the lead's
  correction (receipt first everywhere) and the review of d828ab7: "merge after fixes: 1, 2".
- 02:21Z–03:04Z — the review's fixes, each with a test and a control: (1) the sent board fee kept;
  (2) receipt first again in the answer and the hold step, the approval's re-check receipt first,
  the reversal race committed; (3) the dates snapshot, session and academic-year windows; (4)
  known means confirmed; (6) the refund terms shown (the Reserve page, the swap consent, the
  grade-10 checkout); (7) the teacher change's locks and the taught first entry; (8) the
  statement's outstanding; (9) the two-year bound and the series' reason; (10) hold from its
  change row; (11) the modal's one outcome, the open-payment refusal, the slip's mark; (12) the
  control count (18 on d828ab7, 16 red and 2 green) and the row-lock log re-run; (13) the swap
  approval's price, and the notes in §10. Eleven controls red.
- 03:10Z–03:30Z — **origin/main merged** (b438976: A's step 1 with its follow-ups). Conflicts:
  `registration.services` (A had edited `getAvailableSubjects`, which B removed: B's side kept),
  `swap.services` (A's `lockReceiptOf` in the approval re-check kept, B's equivalent dropped, the
  flag added to its select), 08n's and 08t's imports and headers (both), 08t's new describes on
  both sides (A's approval-against-reversal and Confirm-inside-move races appended after B's,
  their five `reserve(…)` calls through `reserveAtDesk`), the notification types and the setting
  groups (both), and the migrations (A's 0044 kept; B's renumbered 0045 and 0046, regenerated on
  A's snapshot, `when` after A's). The flag wired (§10.1). `igcse_rwb_dev` dropped (nobody
  connected), recreated from `igcse_template_dev`, migrated to 0046, the placeholder demo session
  seeded again; B's API restarted on it.
- 03:32Z — the migration order proven on a scratch copy of `igcse_template_dev`: migrated at
  origin/main (45 migrations, the last A's 0044 at 1791425757386), then at this branch (47: B's 0045
  at 1791429270826 and 0046 at 1791429312401 applied, the step-B columns and the consent trigger
  present), then dropped (`migcheck-at-main.txt`, `migcheck-at-branch.txt`).
- 03:31Z–03:36Z — **gates green on 8f9aed9** (the merge of main): API and web check-types; the API
  suite in local time and with `TZ=UTC`, 26 files, 402 passed, 1 todo each; useQuery generics 25.
- 04:20Z — the evidence folder force-added (988f771, docs only): run logs trimmed to the vitest
  summary and the failures, screenshots under 300 KB, the scripts' local credentials read from
  the environment; scanned (no cookies or tokens, test emails only, placeholder names and the
  template's demo officer).
- 04:21Z–04:58Z — the second review's list: the flag required on every line object (the four
  missing selects and the rest, §10.1); the not-sent board fee refunded in full; the
  paid-meanwhile refusal; the old swap requests; the teacher gate as the line rules ask it; the
  09 rule tightened; the late entry on the first-entry deadline; the warning Notice; the terms'
  loading and failure states; four proof screenshots (the dates sentence in English and Arabic,
  the grade-10 checkout's terms, the slip's mark). Eight controls red.
