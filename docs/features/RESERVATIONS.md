# Reservations rework — step 1 (agent A): sessions, offers, fees, the per-item cut-off

Branch `feature/rework-sessions`, from `origin/main` c99b553 (7 Oct 2026). The design is
`RESERVATIONS_REWORK.md` version 8 (accepted by the owner on 7 Oct 2026 with its §17
defaults); this step is its §9 step 1. The plan's rules are FEATURES_PLAN.md §3–§5. The trail
is `.audit/rework-sessions.tsv`; evidence (suite logs, controls, migration dumps, screenshots)
is `.audit/rework-sessions-evidence/` (git-ignored). The progress log is the last section.

**Status of this document.** §1 (the data model) and §2 (Contracts) were written first, before
the code, so that agents B (reservations) and C (money changes, charges, exceptions) can start
from them; each later change to a contract is marked *(changed: date, why)* in place. The
sections after §2 describe what was built and are filled in as the work lands.

---

## 1. The data model this step creates

Everything is in `packages/db/src/schema.ts`. Migrations, on top of main's journal (0040):
`0041_rework_structure` (generated; additive, plus the routing and window rules rewritten),
`0042_rework_backfill` (custom; the conversion of §7 step 2), `0043_rework_constraints`
(generated; the NOT NULLs and the new unique index on lines, after the backfill). Nothing of the
design's §7 step 3 is dropped.

### 1.1 Session — `registration_session` (changed)

| Column | Rule |
|---|---|
| `session_type` | `june` or `winter` only (check). A converted `october`/`november` window becomes `winter` of its year, `january` becomes `winter` of the year before |
| `series_year` | the June year, or the winter's November year |
| `label` | text, not null, default `''`. A converted window keeps its old type and level (`june-igcse`, `october-as_level`, `january-a_level`); new sessions have `''` (the API accepts an optional label for the rare second cycle; the screen does not ask) |
| `name` | **derived** and stored: "June 2027", "November 2026 – January 2027", with the label appended ("June 2027 — IGCSE", "November 2026 – January 2027 — October AS"). `deriveSessionName(type, year, label)` in `@repo/validations` |
| `qualification_level` | nullable and **unread** (kept one release; dropped in §7 step 3) |
| `course_starts_on` | date, not null: the cycle's first lesson (refund anchor, §3.1). Converted: the window's start date (Cairo) |
| `refund_policy` | jsonb, nullable: `RefundPolicy` steps in weeks (§2.6), copied at creation from the setting of the type; editable until the first line of the session carries a consent; null on a converted session |
| `payment_due_at` | timestamptz, not null: when every line of the session is due unless an exception says otherwise. Converted: the window's end |
| unique | one **active** session per (`session_type`, `series_year`, `label`) — replaces one per (type, level) |

`GRADUATE_RETAKE_SESSION_TYPES` = `['winter', 'october', 'november', 'january']` (the old
three kept so a board series' month still answers); `A_LEVEL_ONLY_SESSION_TYPES` is retired:
"IGCSE sits neither October nor January" is checked per item.

### 1.2 Offer — `session_offer` (new): a row of the links sheet

`id`, `session_id`, `subject_id` (unique per session), `availability` (`open`,
`retake_only`, `self_study_only`, `closed`), `course_fee` (numeric ≥ 0: a first entry in school
this cycle), `course_starts_on` (date, null: the session's), `grade10_core` (bool; replaces
`subject.is_core` for the cycle; `registration.was_core_at_registration` is set from it),
`notes`, `sort_order`, `legacy` (jsonb: `{ converted: true }` on a converted offer), audit
columns.

**Teachers** — `session_offer_teacher`: `offer_id`, `teacher_id` (unique per offer), `mode`
(`in_school`, `online`), `sort_order`. The pool is `subject_teacher`; a teacher added to an
offer is linked there. An `open` offer needs a teacher (refused: "who teaches it?"); a
`self_study_only` offer needs none.

**`teacher.kind`** (new): `person` (default) or `provider` (an external team: no account,
`user_id` null, a name as the links sheet gives it).

### 1.3 Item — `session_offer_item` (new): what a family ticks under a subject

| Column | Rule |
|---|---|
| `id`, `offer_id`, `session_id` | `session_id` is the offer's (composite key to the offer) so the series link can be checked |
| `label` | as the form words it ("Whole subject", "Paper 4 only (retake)", "P1", "A2, carry forward") |
| `kind` | `whole` (the subject's whole award), `one_paper` (a paper of a whole subject, a retake), `unit` (an IAL unit or a paper set), `route` (a Cambridge AS / A2 / A Level option), `qualification` (one of two qualifications under one subject, e.g. Arabic IAL and GCE) |
| `enters_kind` | `award` (`qualification_id`), `option` (`qualification_option_id`), `units` (rows in `session_offer_item_unit`), `subject` (the offer's subject row, unmapped) |
| `qualification_id`, `qualification_option_id` | what it enters (the award an option or a unit set belongs to is kept in `qualification_id` too, for display) |
| `board_series_id` | the series it is entered in; **null only on a converted item of a window that fed no series** (availability `closed`, `legacy.no_series`). A composite key to `session_board_series (session_id, board_series_id)`: an item's series is always attached to its session |
| `availability` | as the offer's, per item; the stricter of the two applies |
| `course_fee` | null: the offer's |
| `needs_prior_series` | bool: a carry-forward option, or a one-paper retake carrying the other components |
| `required_in_series` | bool: a first entry of the subject in that series must include it |
| `exclusive_group` | text or null: items of one group cannot be reserved together |
| `sort_order`, `legacy` (jsonb: `converted`, `no_series`, `not_routed`) | `not_routed` *(changed: 7 Oct, the conversion proof)*: a converted item that exists only because lines sit in a series F0b would not route a new registration to; it is closed for new lines, its lines stand |

`session_offer_item_unit (item_id, unit_id)` — the units an `units` item enters.
`session_offer_item_teacher (item_id, teacher_id, mode, sort_order)` — none: the offer's.
`session_offer_item_fee_key (item_id, key_kind, unit_id | qualification_option_id |
qualification_id | subject_id)` — what the series' fee grid is read for (§1.5); one row per
unit for a units item, else one row. Default: what the item enters; a one-paper item of a
board that prices the qualification is keyed on the qualification (Q-13).

One line per (student, session, item) while live.

### 1.4 Board series (changed)

- `board_series.retake_deadline` becomes an **instant** (timestamptz). The old date is
  converted to the end of that day in Cairo (23:59:59). Its rules are the entry deadline's: the
  admin's alone, with a reason, in the future when set, audited (`BOARD_SERIES_DEADLINE_SET`
  names which deadline); it may not be before the entry deadline.
- `exam_board.carry_forward_months` (integer, null = no limit on record): Cambridge 13 (an AS
  result is carried forward within 13 months), Pearson and Oxford null. F4 reads it.
- `session_board_series` stays, **derived**: a link exists while an item or a line of the
  session is in the series; it is created when an item is placed in a series and removed when
  nothing references it. Its `is_default` is no longer read. The window's series panel and
  `PUT /v1/sessions/:id/board-series` are gone; `POST /v1/sessions/:id/board-series/move`
  stays (admin) behind the item's series change. `session_subject_series` is emptied by the
  backfill and kept one release.
- **The window rule** loses its deadline clause (`window_closes_before_series_deadline`); its
  academic-year, kind and board clauses stay in the database (0038's functions, rewritten).
- **The routing trigger** `catalogue_route_registration()` reads the line's item: a line is
  entered in its item's series (refused if another is named), of the subject's board, and the
  item must be of the line's session and subject.

### 1.5 Fees — `board_fee` (new)

`id`, `board_series_id`, `key_kind` (`unit`, `option`, `qualification`, `subject`) with the
matching id column (exactly one; unique per series and key), `amount` (≥ 0), `provisional`
(bool), `confirmed_at`, `confirmed_by`, `zero_reason` (an amount of 0 needs one),
`copied_from_fee_id`, audit columns. An item's board fee is the sum of the grid's rows for its
fee key rows; an item with a key that has no row cannot be reserved.

C adds the service kind (`board_service_id`, `level`) when it creates `board_service`; until
then remark fees stay on `remark_fee_schedule` (§2.10).

### 1.6 Line — `registration` (new columns; B fills most of them)

| Column | Type, default | Who fills it |
|---|---|---|
| `offer_item_id` | not null after 0043 (backfilled) | A's paths now; B's |
| `attempt` | `first` \| `retake`, not null, default `first` | A (from history on the old paths); B |
| `mode` | `in_school` \| `self_study`, not null, default `in_school` | A (from `takenOutsideSchool` / availability); B |
| `prior_sitting_series_id` | board series, null | A writes the known one on the old paths; B declarations |
| `prior_sitting_source` | `known` \| `declared_by_desk` \| `declared_by_family` \| `legacy`, null | A / B |
| `prior_centre`, `prior_candidate_number` | text, null | B (verification) |
| `due_at` | timestamptz, not null after 0043 | `dueDateFor` at creation; recomputed at fee confirmation (A) |
| `price_provisional` | bool, default false | `priceLine` |
| `pricing_basis` | jsonb, null (converted lines) | `priceLine` (§2.3) |
| `refund_policy_snapshot` | jsonb, null | B at consent (shape §2.6); A's grade-10 commit with its school consent |
| `legacy` | jsonb, null: `{ converted, no_series, retake_history_unknown }` | the backfill |
| `is_retake`, `taken_outside_school` | kept, written from `attempt` and `mode` | every path |
| unique | (student, session, `offer_item_id`) while live — replaces (student, session, subject) | |

Verification columns (who verified a declared sitting, when, the outcome,
`declaration_rejected`) are **B's** to add.

### 1.7 Consent — `registration_consent` (new; B fills it)

`id`, `registration_id`, `kind` (`refund_policy`, `declaration`), `text_version`,
`confirmed_by` (user), `channel` (`app`, `desk`, `school`, `imported`), `at`; unique per
(registration, kind). This step writes the `school` rows of a grade-10 bulk commit only.

### 1.8 Course enrolment — `course_enrolment.unit_id` (new)

Nullable `unit_id` (exam unit). The one-open index becomes two partial unique indexes: one open
enrolment per (student, unit, year) where `unit_id` is set, and per (student, subject, year)
where it is null.

---

## 2. Contracts

What B and C build on. Every function named here is exported from the file named; every type
from `@repo/validations` unless said otherwise. A change to any of it is made only on this
branch (or by agreement in writing), and marked here.

### 2.1 The lock order (RESERVATIONS_REWORK.md §6), as code takes it

1. `assertMayRegisterForInTx(tx, studentId, sessionId)` (eligibility.services) — the student
   **`FOR NO KEY UPDATE`** (raised from `FOR SHARE` by this step), the session `FOR SHARE`, then
   the grade-10 exception row or the A-12 setting key.
2. `routeAndCheck` / the item path — each subject's board (`subject` `FOR SHARE`).
3. The session's series links (`session_board_series` `FOR SHARE`), then the series rows the
   lines go to (`FOR SHARE`), then — for a move of lines or a fee write only — **the series' fee
   grid** (below).
4. The offers (`FOR SHARE`), then the items (`FOR SHARE`), in id order.
5. The fee rows the prices read (`board_fee` `FOR SHARE`, id order).
6. The student's and family's exceptions: read rows `FOR SHARE`, one-shot gates `FOR UPDATE`
   (marked used in the same transaction).

Writers take their row `FOR UPDATE` at its place in this order: a series change of an item,
an offer's close, an item's untick or availability change, a teacher removal (item/offer
`FOR UPDATE`); a fee write or Confirm (the series `FOR SHARE`, its fee grid exclusive, `board_fee`
`FOR UPDATE`, then the lines `FOR UPDATE` in id order) or a re-price (`board_fee` `FOR SHARE`,
then the lines); a grant or revocation (exception `FOR UPDATE`). Every path that puts
a line into a series takes the student lock first and runs `assertLineRules`: the reservation
paths, an item's series change (per affected student), the grade-10 bulk commit (per student),
F7's import (per student) and preregistration capture.

**A move of lines** — an item's series change, the admin's move, a board change, the session's
series correction — takes, after its students and items and **before its lines**, the fee grid
of each series its lines go to (shared), then the fee rows its lines will read there `FOR SHARE`
(`lockMoveFeeRows` / `lockFeeRows`, `line-moves.services.ts`; the old series' rows carried there
first): Confirm's own order, fee rows then lines. The admin's move also takes the items it may
move lines to `FOR SHARE` before them (an item's series change, which takes its item
`FOR UPDATE`, waits for it).

**The series' fee grid** (`lockFeeGrids`, `apps/api/src/lib/fee-grid-lock.ts`): a
transaction-scoped advisory lock on the series id (`pg_advisory_xact_lock(4041, hashtext(id))`),
taken right after the series row and before its fee rows, several in id order. A move takes it
**shared**; every path that creates or confirms a fee row takes it **exclusive**: the grid's put
(a save, a pasted list — and a put that confirms a provisional row), its copy from another
series, copy-from's fees, and Confirm. So no fee row is created or confirmed in a series while a
move into it is under way: a finance write either commits first (the move then holds the row it
reads) or waits for the move (and a Confirm then finds the moved lines by their basis). Moves do
not wait for each other. It is not a mode of the series row because the checkout and a change's
approval take the series row `FOR SHARE` *after* their lines: any row mode that conflicts with a
move's would deadlock a Confirm (series, then lines) against them. A path making lines takes it
**shared** too (`insertLines`' locks, before the fee rows it prices from: so does every
reservation since the review of B); the checkout does not (it reads no fee row). This
closes the case the rows alone left open — a row that existed nowhere when the move began,
created and confirmed by finance inside the move's transaction (08t, both orders; with the move's
lock removed the line is left provisional on a confirmed row). The put's lock alone and Confirm's
lock alone each close it too; Confirm's is the backstop for a row made by any path that forgets
the grid. Within it, the grid's put takes the rows it names that exist `FOR UPDATE` **in one
statement in id order** (as Confirm does; a reservation takes its rows `FOR SHARE` in id order),
never one by one in the order the list was pasted (08t: a paste out of id order against a
reservation deadlocked).

**A line's receipt, then the line** (MONEY_AUDIT.md MA-16's order). Wherever a path holds both,
the receipt (`FOR UPDATE`, `lockReceiptOf` in `receipt.services.ts`) comes first: a payment's
reversal, a receipt's void and return, `executeReceiptGatedDrop`, a drop's or swap's approval
(before its deadline check under the line's lock), a preregistration's cancel, capture and the
deadline sweep's preregistration refund. In the order above it sits where the receipt-gated drop
takes it: after the student and the session, before the line. The opposite order deadlocks a
drop's approval against a reversal (08t); B's verification takes it so.

**A swap: the new line's locks before the old line** (the review of B, 8 Oct). A path that holds
a line and then makes a new one — a swap's approval, the parent's own swap — takes what making the
new line locks first, right after the student (`holdNewLines`, `line.services.ts`): the subjects,
the session's series links, the series, the offers, the items, the fee grid (shared), the fee rows
`FOR SHARE` and the student's price exceptions `FOR SHARE`; then the old line's receipt and the old
line; then `insertLines` takes the same locks again, already held. Confirm and the grid save hold
their fee rows (after the grid, exclusive) and then want every line priced from them, a paid one
included; taken after the old line, the new line's rows closed a cycle with them whenever a row
being confirmed was in the old line's basis (old and new items reading one key, or a line paid on
a provisional fee). 08t forces it in both orders and for the parent's own swap: both sides land;
with the early locks removed each run ends in "deadlock detected". Accepted as is: none — the order
changes nothing elsewhere in this section (fee rows already came before lines).

**The desk's collection takes every line it touches in one pass** (step C, the review of
1cb38de item 5): the lines it pays and the plan lines of the instalments it takes, `FOR UPDATE` in
id order, before the charges — not its own lines first and the plan lines after, which deadlocked
against a fee re-price or a series move taking both in id order (08t).

**The reminder step: the sessions, then the lines and charges** (step D, RESERVATIONS_MESSAGES.md
§2, the review of 5c2f2bf). Its claim row has a foreign key to the line's session, which takes the
session `FOR KEY SHARE` at the insert; the step therefore takes each group's sessions `FOR KEY SHARE`
in id order **before** its lines and charges (`FOR SHARE`), as this order puts the session before
its lines. Taken after the lines, it waited behind `updateSession` / `correctSessionSeries` (the
session `FOR UPDATE`, then its waiting lines) while holding those lines: a deadlock (08t forces it).

**A payment, then the student, for a pushed school fee** (step C, RESERVATIONS_MONEY.md §2).
`settlePushInTx` runs inside a school-fee payment's confirmation, which holds the payment
`FOR UPDATE`, and then takes the student `FOR NO KEY UPDATE` to settle the open push of that year
(the push itself takes the student, so a push and a confirmation serialise on it). No path takes the
student and then an existing payment: a reservation, a grant or revocation, the push and the plan's
paths take the student and then lines, charges or new rows; a payment is locked first by every path
that locks one (confirmation, reversal, failure, the deadline sweeps).

**The student first on F1's paths too; then teaching groups and members, in id order, after the
lines and enrolments** (F1 on the rework, 8 Oct; corrected after the review of 88898f6;
docs/features/SCHEDULING.md §17.3). A line's teacher change, A's replace-teacher and the enrolment's
own change hand the enrolments they change to F1's `followEnrolments` in the same transaction
(`upsertEnrolments`' `follow`, §2.12). Each takes its students first: B's change as above; A's
replace-teacher the students of its lines `FOR NO KEY UPDATE` in id order before the session and the
offer, re-reading its lines after the offer lock and running again with a newcomer locked first
(`lib/student-locks.ts`, as an item's series change does); F0b's enrolment change and end the
enrolment's student before the enrolment. Enrolments are locked `FOR NO KEY UPDATE` (only their
teacher, mode or end changes). After them the follow-up takes the teaching groups `FOR UPDATE` in id
order, then their member rows; a change that could put someone in two lessons at once in a published
timetable then takes the running terms `FOR SHARE` and the teachers concerned `FOR NO KEY UPDATE`
(a line or enrolment naming the teacher, written first, holds it `FOR KEY SHARE`), each in id order,
before the covers it judges again. A first version of this paragraph let A's replace-teacher skip
the students ("lines before students"): that was wrong — it deadlocked against an add of a student
into a group, against F0a's leaving and cohort correction (which take the student, then the lines),
and two follow-ups deadlocked on one teacher; 08s6 forces each race in both orders.

### 2.2 Creating lines — `insertLines` (`apps/api/src/services/line.services.ts`)

```ts
insertLines(tx, {
  studentId, sessionId,
  lines: LineInput[],            // { offerItemId, attempt, mode, teacherId?, priorSittingSeriesId?, priorSittingSource? }
  status: 'pending_approval' | 'pending_payment' | 'preregistered',
  requestedBy, approvedBy?, approvedAt?, approvalComments?,
  eligibility,                   // the path's mayRegisterFor answer (fee gate, grade)
  now?,
}): Promise<InsertedLine[]>
```

Runs, in the caller's transaction and **after** `assertMayRegisterForInTx`: the series check
per line (`effectiveDeadlineFor` of the new line; a series with neither deadline nor exams
start is not reservable), `assertLineRules`, `priceLine`, `dueDateFor`, the insert (the
routing trigger enters the item's series) and the teacher check (the item's or offer's
teachers; `null` allowed: "no preference"). It writes `is_retake` / `taken_outside_school`
from `attempt` / `mode`. **It writes no consent rows** — the caller (B) does, in the same
transaction. The old paths (request, direct, desk, override, preregistration, swap) call it
with lines built by `resolveItem` (§2.4); B replaces their inputs with `lines` and `consent`.

### 2.3 `priceLine` (`apps/api/src/services/pricing.services.ts`) — replaces `computeRegistrationPricing`

```ts
priceLine(executor, {
  item,            // { id } or a loaded item; its offer, fee keys and series are read
  attempt,         // 'first' | 'retake'
  mode,            // 'in_school' | 'self_study'
  studentId,
  sessionId,
}, opts?: {
  exceptionIds?: string[],   // re-price: apply exactly these (the ids recorded in the basis), not the student's current ones
  lock?: boolean,            // FOR SHARE on the fee rows (inside a creating transaction)
}): Promise<{
  courseFee: number; registrationFee: number; total: number;   // registrationFee = the board part
  provisional: boolean;                                        // any fee row read is provisional
  basis: PricingBasis;
}>
```

course = (item's course fee ?? offer's) × the percent of the mode and attempt
(`self_study`: `pricing.selfStudyCoursePercent`; `retake` in school:
`pricing.retakeTaughtCoursePercent`; a `one_paper` item also × `pricing.onePaperCoursePercent`);
board = Σ fee rows of the item's keys in its series × (`self_study`:
`pricing.selfStudyBoardPercent`, else 100); then the price exceptions **in today's order**: a
custom price first (replaces the total, course = total, board = 0), else percent discounts,
then a fixed discount; total = course + board. Throws `PricingError` (400) when a key has no fee
row ("… has no board fee for … yet: set one on the Fees tab"). 09's "price = course + board"
holds.

`PricingBasis` (`@repo/validations`, `registration/line.validations.ts`):
`{ v: 1, attempt, mode, itemKind, courseFeeBase, coursePercent, onePaperPercent, boardFeeBase,
boardPercent, feeRows: [{ id, keyKind, keyId, amount, provisional }], exceptionIds: string[],
customPrice: boolean, courseFee, registrationFee, total }`.

### 2.4 Items for the paths that still name subjects — `resolveItem`

```ts
resolveItem(executor, sessionId, subjectId): Promise<ResolvedItem>   // offer.services.ts
```

The subject's **whole** item in the session (`kind = 'whole'`, not closed; for a converted offer
with two whole items, the one whose series is open). Refused, with a sentence, when the
session does not offer the subject or offers it only as units or routes ("choose the units").
`ResolvedItem` carries the item, its offer, subject, series, fee keys and teachers.

### 2.5 The rules on lines — `assertLineRules` (`apps/api/src/services/line-rules.services.ts`)

```ts
assertLineRules(tx, { studentId, sessionId, eligibility }, lines: RuleLine[], opts?: { excludeLineIds?: string[]; recheck?: boolean }): Promise<{ usedExceptionIds: string[] }>
// RuleLine = { offerItemId, attempt, mode, priorSittingSeriesId: string | null, priorSittingSource?: string | null }
//   (changed: 8 Oct, the review of 977848d) priorSittingSource 'legacy' lets a converted retake with no known sitting through gate.retakeDeclared
recheckLines(tx, lineIds): Promise<void>   // lines already made, checked again where they now are (§2.12)
```

Throws `LineRuleError` (400, the rule's sentence, `policyKey`) on the first rule broken:

| Policy key | Checked |
|---|---|
| `gate.availability` | the item's and offer's availability: `closed` none; `retake_only` takes `retake` only; `self_study_only` takes `self_study` only |
| `gate.selfStudyFirstEntry` | `self_study` with `first` only where availability is `self_study_only` |
| `gate.retakeDeclared` | a `retake` carries a prior sitting (known or declared — B decides which before calling) |
| `gate.exclusiveItems` | one live line per exclusive group per student per session (new and existing) |
| `gate.sameEntryOnce` | one live line per student entering the same unit or award (`q:`, `u:`, `s:` keys of what the items enter) in one board series, **across sessions** |
| `gate.requiredItems` | a first entry of an offer in a series includes the offer's `required_in_series` items of that series (new or existing lines). The award-claim half (required units or banked results) is F4's/C's |
| `gate.priorSeries` | an item that `needs_prior_series` has a prior sitting of its board, before this series in the board's calendar, within `exam_board.carry_forward_months` |
| `gate.grade10Core` | grade 10 in June: the student's live lines (new and existing) cover every `grade10_core` offer of the session |

Each gate asks the exception adapter (§2.8) for an active exception of its key in the line's
scope before refusing; a one-shot one is locked `FOR UPDATE` and returned in
`usedExceptionIds` for the caller to mark used in the same transaction (today's table has no
gate exceptions, so the adapter returns none; C's registry adds them).

### 2.6 Deadlines and due dates — `deadline.services.ts`

```ts
effectiveDeadlineFor(executor, line: {
  boardSeriesId: string | null; attempt: string; priorSittingSeriesId: string | null;
  declarationRejected?: boolean | null;   // B's registration.declaration_rejected (changed after the review of 40c1447)
  studentId?: string | null;              // the line's student: Q-20's late board entry is read when given
}): Promise<{ at: Date | null; kind: 'retake' | 'entry' | 'exams_start' | null }>
```

The retake deadline when the line is a `retake` whose prior sitting is **the board's latest
sitting before this series** in the board's calendar (`exam_board.series_months`: the month
and year before, label ignored) and the series has one; else the entry deadline; else, for a
series with no entry deadline, the start of its `exams_start` day in Cairo; else null (no
cut-off; such a series takes no new line). The same rule in SQL:
`line_effective_deadline(attempt, prior_sitting_series_id, board_series_id)` (0042), used by
`seriesDeadlineGroups`, `openCheckoutsSpanningDeadlines`, the sweep, `referenceDueFor`, the
InstaPay reference check, `moveRegistrations`, preregistration capture and cancellation, and
09.

*(Changed after the review of 40c1447.)* **A rejected declaration is a first entry** (§3.5): a
retake whose declared sitting the school rejected has the entry deadline, never the retake
deadline — `line_effective_deadline(attempt, prior, series, declaration_rejected)` and its
`_kind` (0044; the three-argument forms read as not rejected), and `declarationRejected` above.
The column is B's: at B's merge, `lineDeadlineSql`, `effectiveDeadlinesOf`, the sweep's and
`refundPreregistrationsAtDeadline`'s column conditions (and C's `charge_effective_deadline`) pass
`declaration_rejected` as the fourth argument, and the line objects handed to
`effectiveDeadlineFor` carry it. **Q-20's late board entry**: `lateEntryUntil(executor,
studentId, boardSeriesId)` reads `deadline.boardEntry` (student × series, its `value_date`)
through the adapter **only while the setting `exceptions.boardEntryDeadline` is on**; with the
student given, `effectiveDeadlineFor` moves an entry or retake deadline later to its date (kind
`entry`) — `sessionWindow`, `insertLines`, capture, cancellation, the family's read and
`dueDateFor` pass the student — and the sweep keeps such a line to that date
(`linesKeptByLateEntry`: its open payments, its expiry, a preregistration's refund). Off, a grant
changes nothing and the board's deadline is the hard stop (MO-10).

`sessionWindow(studentId, sessionId, line | null, executor?, now?)` (window.services) now takes
the **line** (`{ boardSeriesId, attempt, priorSittingSeriesId }`) instead of its series id; the
parameter stays required.

```ts
dueDateFor(executor, input:
  | { kind: 'line'; lineId: string }                    // reads the line, its session and fee rows
  | { kind: 'charge'; studentId: string; baseDueAt: Date; cap: Date | null; reservedAt: Date; scope: ExceptionScope }
): Promise<Date>
```

Line: the session's `payment_due_at`; a line reserved after it: reservation + `payment.graceDays`;
a provisional board fee: the later of that and the fee's confirmation + the grace (until then
the base); a `deadline.payment` exception (adapter) replaces it; capped by
`effectiveDeadlineFor`. Charge (C): the same steps from the charge's own base and cap.

`RefundPolicy` = `{ steps: { throughWeek: number | null; percent: number }[] }` (the last step
`throughWeek: null`). `RefundPolicySnapshot` (B writes at consent; the grade-10 commit with its school consent) =
`{ kind: 'weeks'; steps: RefundPolicy['steps'] }` or, in a converted session with no policy,
`{ kind: 'dates'; windows: { startsAt, endsAt, percent }[] }`. The anchor is resolved at refund
time by C's `refundFor` (precedence: `refund.courseStart` exception › the group's first lesson
(F1) › `session_offer.course_starts_on` › `registration_session.course_starts_on`).

### 2.7 Settings this step adds (F0a's store; `packages/validations/src/settings/settings.ts`)

| Key | Default | Edited by |
|---|---|---|
| `pricing.selfStudyCoursePercent` | 50 | admin, finance admin |
| `pricing.selfStudyBoardPercent` | 100 | admin, finance admin |
| `pricing.retakeTaughtCoursePercent` | 100 | admin, finance admin |
| `pricing.onePaperCoursePercent` | 100 | admin, finance admin |
| `pricing.payOnProvisionalFee` | false | admin, finance admin |
| `payment.graceDays` | 7 | admin, finance admin |
| `refund.defaultPolicy.june` | 100% to week 2, 50% in week 3, 0% from week 4 | admin, finance admin |
| `refund.defaultPolicy.winter` | 100% to week 2, 50% in weeks 3–6, 0% after | admin, finance admin |

C adds `payment.expireOverdueAfterDays`, `exceptions.boardEntryDeadline`; B adds
`verification.unverifiedAtDeadline`.

### 2.8 The exception adapter — `apps/api/src/services/line-exceptions.ts` (C replaces it)

```ts
export type ExceptionScope = { sessionId?: string; subjectId?: string; offerId?: string; offerItemId?: string;
  registrationId?: string; boardSeriesId?: string; academicYear?: string };
export type PolicyException = { id: string; policyKey: PolicyKey; value: number | null; valueDate: Date | null;
  oneShot: boolean; scope: ExceptionScope };
export interface LineExceptionSource {
  /** Active, unexpired exceptions of these keys that cover the scope, for the student or their family. */
  active(executor, studentId: string, keys: PolicyKey[], scope: ExceptionScope, opts?: { lock?: 'share' | 'update' }): Promise<PolicyException[]>;
  /** Exactly these (a re-price re-applies the basis' ids, whatever their status now). */
  byIds(executor, ids: string[]): Promise<PolicyException[]>;
  /** Mark one-shot gates used, in the caller's transaction. */
  markUsed(tx, ids: string[], ctx: { registrationIds: string[]; actorId: string | null }): Promise<void>;
}
export const lineExceptions: LineExceptionSource;   // today: over the `exception` table
```

Today's mapping: `custom_price` → `price.custom`, `discount_percent` → `price.discountPercent`,
`discount_fixed` → `price.discountFixed` (session and subject scope as today, applied exactly
as `applyPricingExceptions` did); no gate keys exist yet. `priceLine`, `assertLineRules` and
`dueDateFor` read exceptions **only** through `lineExceptions`; C swaps its implementation for
the registry, keeping the interface.

### 2.9 Endpoints this step adds or changes

| Endpoint | Principals |
|---|---|
| `POST /v1/sessions` `{ type, year, startDate, endDate, courseStartsOn, paymentDueAt, label?, copyFromSessionId? }` | admin |
| `GET /v1/sessions`, `GET /v1/sessions/:id` | admin, coordinator, finance officer, finance admin |
| `PUT /v1/sessions/:id` (dates, course start, payment due, refund policy until a consent exists) | admin |
| `POST /v1/sessions/:id/copy-from` `{ fromSessionId }` | admin |
| `GET /v1/sessions/:id/offers`; `POST …/offers`; `PUT/DELETE …/offers/:offerId`; `POST …/offers/:offerId/replace-teacher`; `POST …/offers/:offerId/items`; `PUT/DELETE …/offers/:offerId/items/:itemId` | admin, coordinator |
| `GET /v1/sessions/:id/money` (lines only) | admin, finance officer, finance admin |
| `POST /v1/sessions/:id/grade10/preview`, `/commit` | admin, coordinator |
| `GET/PUT /v1/board-fees?seriesId=`, `POST /v1/board-fees/:seriesId/confirm`, `/reprice`, `/copy`, `/parse` | admin, finance admin (GET: coordinator too) |
| `GET /v1/registrations/offers?studentId&sessionId` | the student, a linked parent, staff with student records |
| `PUT /v1/sessions/:id/board-series` | **removed** |
| `GET /v1/registrations/available` | kept, computed from the offers, until B's Reserve pages replace it (B removes it) |

`GET /v1/registrations/offers` answers, per offer: the subject, board, availability, teachers
(with mode), and per item: label, kind, what it enters, its series (with the effective
deadline that would apply to a first entry and to a qualifying retake), availability,
exclusive group, required flag, `needsPriorSeries`, the student's **known sittings** of what it
enters (earlier lines, with series and status), whether the student already holds a live line
on it, and the price for each allowed (attempt, mode) with `provisional`; plus the board's
series of the last two years for a declaration.

### 2.10 What B and C must not touch, and what each adds

- **Not touched by B or C:** the tables of §1.1–§1.5 and §1.8 (their columns and rules), the
  routing trigger and `line_effective_deadline`, `priceLine`'s formula, `resolveItem`,
  `assertLineRules`' gates (C adds exception keys behind the adapter; a new gate is agreed
  here first), `effectiveDeadlineFor`, the session, offer, item and fee services and routes,
  and migrations 0041–0043. Each adds its own migrations after the last on `main`
  (FEATURES_PLAN.md §3).
- **B adds:** the line inputs (`lines`, `consent`) on the request, direct, desk, override,
  preregistration and swap paths through `insertLines`; consent rows; the verification
  columns and the To verify tab; the teacher change and replace on lines; the Reserve pages;
  the Statement; it fills `refund_policy_snapshot`; it removes `/registrations/available`.
- **C adds:** the registry behind `lineExceptions`, `refundFor`, charges, `board_service` and
  its fees in a table of its own, **`board_service_fee`** (series × service × level, provisional
  until confirmed) — not a service kind of `board_fee`, whose columns and rules are this step's
  (the reviewer and the lead accepted the separate table; RESERVATIONS_MONEY.md §4) — and
  `board_service_deadline` (with the remark fee migration — this step leaves
  `remark_fee_schedule` and `remark_deadline` as they are), instalments, the overdue expiry,
  `dueDateFor`'s charge callers, the checkout's and desk's charge groups.
- **Shared, by agreement:** the 09 rules over lines (A adds its rules; B and C add theirs in
  their own blocks).

---

### 2.11 Added to the contract since it was published (read before branching)

- **Writers that move lines lock the students first** (`apps/api/src/lib/student-locks.ts`):
  `lockStudents(tx, ids)`, `assertStudentsLocked(locked, ids)` and `withStudentsFirst(run)`. An
  item's series change, a session's series correction and a subject's board change lock the
  students of the lines they move before their own rows, read the students again under their
  rows, and run again (at most three times) when a reservation landed meanwhile. A new writer
  that moves lines into a series (B's teacher replace does not; C's plan capture does not; F7's
  import does) uses the same three calls.
- **`insertLines` holds the series an item is in after its item lock** (an item moved while the
  reservation waited is read again), so a series' deadline writer and a line never interleave.
- **Due dates follow what they are computed from** (`deadline.services.ts`):
  `redateLines(tx, lineIds, actorId, why)` re-dates waiting lines the caller has locked
  (`LINE_DUE_MOVED` with why); `redateSeriesLines(seriesId, actorId, why)` runs in its own
  transaction after a series' dates change (a checkout locks lines before series, so the series'
  writer may not lock lines after it). Called by the session's payment-date change, an item's
  series change, the series correction, the board change, the admin's move and a series' dates.
- **A checkout and the desk refuse a line whose price changed after it was read**
  (`PRICE_CHANGED_REFUSAL`, `pricing.services.ts`): a re-price committing between the family's
  reading and the checkout's lock would otherwise charge the old price (09: a payment charges
  exactly what it covers). B's Reserve pages and C's charge payments that read a price before
  their transaction compare it again under the lock the same way.
- **A board change carries the old board's fee** into the new board's series as a provisional
  row when finance has set none there (`BOARD_FEES_SET`, reason "the old board's fee,
  provisional until confirmed"), so the subject stays reservable, not payable; and it compares
  each line's **effective** deadline (not only the entry deadline) where it would go.
- **The enrolment's unit** (`enrolment.services.ts`): `EnrolmentRowInput.unitId`; one open
  enrolment per (student, unit, year) with one, per (student, subject, year) without; `bulkEnrol`
  from registrations gives a line of an item entering units one enrolment per unit, with the
  line's teacher; `getTeachingDemand` groups per (subject, unit, teacher) and returns `unitId`,
  `unitCode` (F1's contract, §10).
- **The past-deadline change refusal** (`swap.services.ts`): a family is told to ask the desk.
  *(changed: 8 Oct, the review of 977848d)* — there is no staff refusal: every path through
  today's change check is a family's (a student's request, its approval by the parent, a
  parent's own drop or swap), so the promise of a staff sentence is withdrawn. The desk's drop
  past the deadline (`POST /registrations/:id/desk-drop`, with the receipt gate and the "sent"
  refund) is step C's.

### 2.12 Changed after the review of 977848d (read before merging B or C)

Each point is marked *(changed)* where the code now differs from what §2 promised before.

- **Approving a change asks the line's deadline** *(changed)*: `approveChangeRequest` refuses a
  drop or swap asked before the line's effective deadline once that deadline has passed (checked
  before, and again under the line's lock with its series held), with the family's sentence.
- **Lines that move series are checked and re-priced** *(changed)*: an item's series change, the
  admin's move, a subject's board change and the session's series correction call
  `recheckLines(tx, lineIds)` — `assertLineRules` with `recheck: true` and the moved lines left out
  of the student's own: the same entry once in the target series (any key: an award, a unit, an
  unmapped subject row), the required items there, the carry-forward period; what governs a new
  line (availability, self-study, a declared retake, exclusive groups, the grade-10 core) is not
  asked again. Then `carryFeeRows(tx, itemId, fromSeriesId, toSeriesId, actorId, why)` brings the
  old series' fee rows into the new one, **provisional**, where finance has none (since 40c1447's
  review through `lockMoveFeeRows`, before the lines: §2.1), and
  `repriceMovedLines(tx, lineIds, actorId, why)` re-prices every waiting line with no payment
  history on its board part against the new series' rows (the course part and the exceptions its
  basis recorded stay; `LINE_REPRICED`), so the new series' Confirm and Re-price reach it.
  `tellPriceChanged(lines, because)` tells each family after the commit
  (`apps/api/src/services/line-moves.services.ts`). A line with a payment keeps its price and its
  record. Any new path that moves lines into a series (F7's import, C's plans if they move lines)
  calls the same three.
- **Confirm, Re-price and the fee grid find lines by the fee rows their basis records**
  *(changed)*, wherever the line is entered now (they read `board_series_id` before).
- **Capture asks the line rules again** *(changed)*: `capturePreregistrationsForSession` runs
  `recheckLines` on each row after the deadline and eligibility; a row a rule now refuses is held
  as an ineligible row is (`PREREG_HELD_INELIGIBLE`, code `line_rule`), the owner deciding.
- **`priceLine(..., { lock: true })` reads the student's exceptions `FOR SHARE`** *(changed)*, as
  §2.1 said; `insertLines` passes it.
- **`insertLines` requires a prior sitting's source** *(changed)*: a line with
  `priorSittingSeriesId` and no `priorSittingSource` is refused ("Say where the earlier sitting is
  known from…"); nothing is assumed `known`. B passes `known`, `declared_by_desk`,
  `declared_by_family` or `legacy`.
- **`GET /registrations/offers` is open per attempt** *(changed)*: `item.open` is
  `{ first, retake }` — a first entry until the entry deadline (or the exams' start), a retake of
  the board's previous sitting until the retake deadline where set — each price row carries its
  attempt's `open`, and `item.retakeDeadline` is the qualifying retake's cut-off.
- **The admin's move** takes a retake of the previous sitting into a series past its entry
  deadline while the retake deadline is ahead (per line, as `insertLines`).
- **Re-price** records `LINE_PRICE_KEPT` on each listed line whose provisional mark it clears.
- **Copy-from** brings an open subject with no active teacher across **closed** ("who teaches
  it?"); `SESSION_COPIED` counts them (`closedNoTeacher`).
- **`generateItems`** adds an IGCSE award's one-paper retake items: one per component the
  catalogue says it requires (its own or its option's), `one_paper`, entering that component,
  read for the qualification (Q-13), in the exclusive group `entry` with the whole subject,
  `needs_prior_series` on a Cambridge syllabus, **closed** until the school opens the ones it
  offers.
- **The Money tab** (`GET /sessions/:id/money`): `unpaid` is what is owed (waiting for payment,
  and preregistrations not yet paid) — not a line still waiting for the parent's approval
  (`awaitingApproval`); `paid` includes a paid preregistration; the section is the student's in
  the session's academic year; `sections` lists them and `sectionId` filters.
- **0042 runs twice safely**: offers, items, units, fee keys and fees are made only where none
  exist; its triggers are dropped before they are made again (proved on converted copies).

After the review of 40c1447 (its follow-ups, and B's and C's findings in A's hooks):

- **A move holds the new series' fee rows before its lines** *(changed)*. The race: a Confirm
  committing inside a move's transaction read the lines before they moved (none had the row in its
  basis yet), while the move read the row before it was confirmed — the moved line stayed
  provisional on a confirmed row until a second Confirm. Every move path now takes those rows
  `FOR SHARE` before its lines, after carrying the old series' rows across (§2.1); 08t forces the
  Confirm inside each of the four moves (paused at its `LINE_REPRICED` write, `pauseAtAudit`) and
  the Confirm clears the moved line; each fails with its lock removed. 09: no waiting line is
  provisional when every fee row its basis names is confirmed at the amount it recorded (a row
  confirmed at another amount leaves the line to the Re-price). What is not held: a row that
  existed nowhere when the move began and that finance creates and confirms inside the move's
  transaction (the rule above names such a line). *Closed after the merge of af33662:* the
  series' fee grid lock (§2.1), shared by a move, exclusive by every fee create and Confirm.
- **The Fees tab lists any line still provisional on confirmed fees** *(changed)*: `GET
  /board-fees` returns `stuck` — the waiting lines read from the series' rows that are provisional
  though every row their basis names is confirmed at the amount they recorded (09's rule) — with
  the student, subject, session, price and the series' fee ids; the tab counts and lists them and
  "Confirm their fees again" (Confirm of those rows at their amounts) makes them payable. None
  should exist; the list is how one would be seen.
- **`effectiveDeadlinesOf` reads Q-20's late entry** *(changed)*, as `effectiveDeadlineFor` does
  with the student (each line's student and series, while the setting is on): the InstaPay
  reference check, the moves' "past its deadline" checks and the reversal's notice read it.
- **Replace teacher on a converted session** *(changed)*: the student's enrolments in the item's
  units where they have them, else the subject's own row (an enrolment from before the rework has
  no unit, and 0042's converted item enters all the subject's units).
- **The family's read: a retake open until the later of the retake and the first-entry deadline**
  *(changed with Q-20, recorded after the review of 40c1447..af33662)*: a late board entry can make
  the first entry's date later than the retake deadline. And the approval's deadline check (the
  line's student) and `getAvailableSubjects` (the student) pass the student, so a late entry is
  read there.
- **A swap takes the new line's locks before the old line** *(changed, the review of B)*: §2.1.
  `holdNewLines(tx, { studentId, sessionId, lines })` is exported for any path that holds a line
  before it makes new ones; every reservation's `insertLines` now takes the series' fee grid
  shared before its fee rows.
- **A put that confirms settles the lines** *(changed)*: `PUT /board-fees` saving a provisional
  row as the board's published fee (the grid's "published" save, a pasted published list) used to
  confirm the row and leave the lines priced from it provisional and unpayable; it now settles them
  as Confirm does (`settleLinesOfConfirmed`: at the recorded amount no longer provisional and
  re-dated; at another amount left for the Re-price) and returns `linesNoLongerProvisional`.
- **A line that turns provisional on a move is told** *(changed)*: `repriceMovedLines` also
  returns a line whose total stayed but which became provisional (the new series' fee not
  confirmed), and `tellPriceChanged` sends it `PRICE_TO_BE_CONFIRMED` ("The price of X is to be
  confirmed … it can be paid once the school confirms the board fee in its new series"); a
  changed price that also turned provisional says so in its `PRICE_CHANGED`.
- **A line's receipt before the line** *(changed)*: §2.1 (MA-16's order) — a drop's approval, a
  preregistration's cancel, capture and the deadline's preregistration refund take the receipt
  first.
- **The effective deadline reads a rejected declaration and Q-20's late entry** *(changed)*:
  §2.6. The flag and the setting are B's and C's; the wiring at their merges is listed there.
  `exceptions.boardEntryDeadline` is defined on this branch with C's text, at C's place, so the
  merge takes C's; `deadline.boardEntry` is in `DUE_POLICY_KEYS`.
- **`priceLine` reads the pricing.* exceptions** *(changed)*: with the price keys it asks the
  adapter for `pricing.selfStudyCoursePercent`, `pricing.selfStudyBoardPercent`,
  `pricing.retakeTaughtCoursePercent` and `pricing.onePaperCoursePercent`; one that applies to the
  line (self-study, a retake in school, a one-paper item) replaces its setting's percent — the
  first the adapter gives of each key — and only those that applied are recorded in
  `basis.exceptionIds`. Who holds one (a student or a family) is the registry's; C's registry
  marks the four policies live (step C's merge of main: granted by finance, 08r proves a student's
  and a family's through the real registry, in the line's price and basis).
- **One payment history for every re-price** *(changed, step C after main)*:
  `lineIdsWithPaymentHistory(executor, lineIds)` (and `paymentHistoryOf`, which says why) in
  `line-history.services.ts` — a payment of the line (`payment_registration`, any status), a live
  instalment plan on it, or what paid toward its price: a price adjustment, or an instalment of a
  live or captured plan, paid, refunded or being paid (not a service charge for the line's
  subject, nor the instalments of a plan released in full: the review of 1cb38de, item 9).
  `repriceLines` (the board fee's re-price; its listed reason names which), the Fees tab's
  count (`getFeeGrid`, item 6), `repriceMovedLines` (every series move) and step C's single-line
  price exception (granted or revoked) ask it and leave such a line's price; a plan line
  re-priced would never be captured (its deposits short of the new price).
  08q: a plan line is listed by the re-price and kept by a move, and its last instalment captures.
- **The window by subject** *(changed, step C after main)*: `sessionWindow(…, line, …,
  subjectIds?)` reads a line's `subjectId` (and a new reservation's subjects) and asks
  `hasDeadlineExtension(…, subjectId)`: a session-scoped `deadline.window` covers every subject, a
  subject-scoped one that subject alone — the reservation paths pass their `subjectIds`, the per-line
  call sites their line's subject.
- **Known earlier sittings are confirmed lines only** *(changed)*: `GET /registrations/offers`'
  `knownSittings` no longer lists a dropped line (never sat; it may be declared, then verified).
- **The grade-10 commit freezes the refund steps** *(changed)*: each line's
  `refund_policy_snapshot` with its school consent (§2.6's shape), so a bulk line is refunded like
  any other.
- **Replace teacher moves the enrolment per unit** *(changed)*: each replaced line's enrolment in
  each unit its item enters (or in the subject for an item entering none), not the student's other
  units of the subject taught through another session (§2.11).
- **The teaching group follows a line's teacher** *(changed, F1 on the rework, the lead's decision
  of 8 Oct)*: `changeLineTeacher` (now `changeLineTeacherTx` inside a transaction it is given),
  A's `replaceTeacher` (which now locks the students of its lines first, §2.1) and F0b's
  `updateEnrolment` (its student first) change the enrolment through
  `upsertEnrolments(..., { follow: true })` — an open enrolment of the same key with another
  teacher or mode is updated (`ENROLMENT_UPDATED`) — and F1's `followEnrolments` moves the group
  in the same transaction: self-study leaves it; a group whose every member now has the new
  teacher takes that teacher (dated); otherwise the student moves to that teacher's group of the
  subject or unit; with none, or a move that would clash in a published timetable, the student
  waits for the coordinator. The change itself never fails for a timetable reason; its response
  adds `groupsFollowed` (with each waiting student's reason), and the caller tells lost cover
  after the commit (`groupFollowNotices`). `lineEnrolmentUnits` gives a line's enrolment keys (a
  converted line whose student holds the subject whole goes through the subject's own row).
  Details: docs/features/SCHEDULING.md §8.

## 3. As built (step 1)

Commits on `feature/rework-sessions`: 7e83d60 (schema, migrations, services), d56ef27 (the F0b
suites on the item model, student-first locks, re-dating, 09), 1ba3de1 (WIP for B and C),
27e3233 (suite green), 19570e6 (the screens), 5360b1c (conversion proof, 0042's routing), and
the last commit (this section, the per-unit enrolment test).

**Sessions (§3.1).** `POST /v1/sessions` takes six inputs (`type`, `year`, reserve from and to,
`courseStartsOn`, `paymentDueAt`) and optionally `copyFromSessionId`; the name and the refund
policy follow (the policy from `refund.defaultPolicy.<type>`). Copying brings an earlier
session's open offers with their teachers, items (in the corresponding series of the new year,
made when not on record) and course fees; its board fees come across provisional. A session
converted while closed is copied as its subjects allow (0042 closed its offers with the window).
`PUT /v1/sessions/:id` changes the header (a draft: anything; an open session: its end with a
reason, course start, payment due; the refund policy until a consent exists); moving the payment
date re-dates every waiting line. `PUT /v1/sessions/:id/series` (F0a's correction) carries the
items and their lines to the corresponding series.

**Offers, teachers, items (§3.2).** `GET/POST/PUT/DELETE /v1/sessions/:id/offers…`, items,
`replace-teacher`, `offers/addable`. Items come from the catalogue (`generateItems`: an IAL row
one item per unit; a Cambridge syllabus with options one route per option, one exclusive group;
an award the whole subject; an unmapped row the row itself). An open offer names a teacher;
providers are teachers of kind `provider`. An item with live lines cannot be unticked; with only
history it is closed. An item's series change moves its live lines (refused past a line's
deadline, when a checkout would span two deadlines, or when the same entry is already in the
target series), each audited (`LINE_SERIES_MOVED`), re-dated.

**Series by item and the per-line cut-off (§3.3).** Links are derived (attached when an item
lands in a series, detached when nothing references it). A line's effective deadline
(`line_effective_deadline`, SQL and `effectiveDeadlineFor`): the retake deadline for a retake of
the board's previous sitting, else the entry deadline, else the exams' start (Cairo), else none;
a series with neither date takes no line. Read at: `insertLines`, the offers read (`open`), the
checkout's deadline groups and their lock, the payment sweep, InstaPay references and their
reversal, preregistration cancel and capture (deadline first: paid refunded in full, unfunded
expired, an open payment left, a SO-4 held row untouched; the student locked first), the
family's change and drop (refused past it; the desk's drop past it is B/C's `desk-drop`), the
admin's move, the board change, the series correction and the 09 rules. The window rule lost
its deadline clause; a session may open after one of its series' deadlines.

**Fees (§3.4).** `GET/PUT /v1/board-fees?seriesId`, `POST /v1/board-fees/:seriesId/confirm`,
`/reprice`, `/copy`, `/parse`. A provisional row prices a line provisional: reserved, not payable
(checkout and desk refuse `PROVISIONAL_REFUSAL`) unless `pricing.payOnProvisionalFee`; confirmed
at the same amount clears the line and moves its due date to the confirmation plus the grace;
confirmed at another amount, "Re-price" re-prices the board part of lines with no payment
history using the exceptions their basis recorded, lists the others, tells each family
(`PRICE_CHANGED`). The lines are locked before their payment history; a checkout that read the
price before a re-price is refused (`PRICE_CHANGED_REFUSAL`). `priceLine` replaces
`computeRegistrationPricing`; the pricing settings are in F0a's store.

**Enrolment unit (§10).** `upsertEnrolments` rows carry `unitId`; `bulkEnrol` from registrations
gives a line of an item entering units one enrolment per unit with the line's teacher;
`getTeachingDemand` groups per (subject, unit, teacher).

**Screens (§4.1, §4.2, §4.6).** `/admin/sessions` (a route group of its own: admin,
coordinator, finance admin, finance officer; each tab only for who may read it): the list (§4.1)
and the Session screen — the header with its deadlines line, Edit, Open now, Close, Correct the
series; Subjects (grouped O.L. and A.S./A.L., the offer drawer with availability, course fee and
start, grade-10 core, teachers from the pool or any teacher, notes, replace teacher, remove; per
item series, availability, course fee, exclusive group, required, untick; add an item; add a
subject; copy from), Fees (per series: type, paste, copy, confirm, change a confirmed amount,
re-price with what it will skip), Money (lines only: totals, filters, subject, export), Grade 10
(core, preview, register). Settings gain Prices, Payment and Refunds (number and refund-policy
editors); Board series gains the retake deadline. Arabic for all of it in
`apps/web/lib/i18n-sessions.ts` (data marked `data-i18n-skip`), checked right to left.

**Conversion (corrected after the review of 977848d).** Copies (never the originals) of
`igcse_template_dev`, `igcse_foundation_dev`, `igcse_catalogue_rich_dev`, `igcse_catalogue_synth`
and `igcse_catalogue_synth_closed`, each migrated to main (41 migrations), probed with main's code,
migrated to the branch (44), probed with the branch's code: every line's status, price, course and
board parts, series and payments, every wallet, every session's status, the eligibility answer of
every waiting line and the refund preview of every live line — **0 differences on each**. What
that proves, plainly: the template, foundation and catalogue_rich copies are **one data set** for
everything the probe reads (identical before-probes: 3 sessions, 8 lines, 5 waiting, 6 live); they
differ only in users and two teachers with no subject links. The synthetic pair is the second
shape (9 sessions, 16 lines, 24 subjects, 13 and 14 series). A scratch case on a copy of
catalogue_rich adds what none of them holds — a window whose lines sit in two series (one routed,
one moved and dropped) and subjects with linked teachers: 0 differences; the routed subject gets
its open item, the moved-and-dropped line keeps a closed `not_routed` item, the offers carry their
two teachers. 0042 run a second time on the scratch and both synthetic copies: every table's row
count and the probe unchanged. **09 over each converted copy fails exactly what main's 09 fails on
the same data before conversion** (the coverage counts the small data sets cannot reach, the SO-1
audit rows the demo and synthetic data never had, the synthetic data's own paid-twice and receipt
gaps, F0a's held-preregistration count) **plus one more: the new basis rule's coverage count** (a
converted database has no line priced by `priceLine` yet); every rule this step added passes on
converted rows.

**Gaps closed after the review of 977848d.** The Session screen now sets up what §3.2/§4.2
describe: one-paper retake items are generated from the catalogue (unticked until the school
opens them); "Add an item" takes what it enters (papers or units, the award, an option code, the
subject row), the board fee read for the qualification on a one-paper item (Q-13), "needs an
earlier sitting carried forward", the exclusive group, required in a first entry and its own
teachers; every item card has its own teacher picker (an IAL subject names a teacher per unit)
and the carry-forward tick.

**The step counts, measured on the screen (§11).** On `igcse_rwa_dev` in headless Chrome
(`.audit/rework-sessions-evidence/screens/measure-counts*.json`), every fill, select and tick an
input, every press a click. From scratch, June 2029 with the database's 17 IGCSE subjects, one
teacher each, course fees as the subjects', one series: new session 6 inputs and 2 clicks; the 17
subjects 16 inputs and 67 clicks (4 clicks a subject: Add subject, the subject, "Show every
teacher" when the teacher is not yet in its pool, Add — 3 when they are); the fee list pasted and
published 1 input and 4 clicks; the series' deadline 2 inputs and 2 clicks (plus 2 to choose a
far academic year on the Board series page) — **25–27 inputs and 75 clicks**. Copied from it
(June 2031 from June 2030): new session 5 inputs and 2 clicks; Confirm all 2 clicks; the
deadline 6 inputs and 2 clicks (2 for the deadline, 4 to choose June 2031's academic year on the
Board series page) — **11 inputs and 6 clicks**, the 17 subjects arriving open with their
teachers. *(Corrected after the review of 40c1447: this said 2 inputs for the deadline and 7 in
all; measure-counts-2.json records 6 and 11.)* Against §11's "about 150 and 70; about 20 and 10":
inputs far fewer than counted (the dev database has no A.S./A.L. subject, no one-paper item and
one teacher a subject — §11 counted about 26 teacher picks, 10 one-paper fees and 30 per-unit
inputs), clicks about the same, because each subject is added through its own dialog. Not
measured: the A.S./A.L. and one-paper inputs (no such subjects in the dev data).

**Tests.** 08n (17: sessions, copy, a winter session's per-item cut-off and retake deadline,
IGCSE never October/January, the defaults, capture's four cases, the line rules, a family's drop
past the deadline, the exams' start as the cut-off, the per-unit enrolment, grade 10 twice, due
dates; then, after the review of 977848d, 11 more: approval past a deadline, Biology units moved
October to January with provisional fees, the sweep at the exams' start and at the retake
deadline, the admin's move of a qualifying retake, replace teacher, the scheduler opening after
a deadline, the same award in a converted and a new session, the same entry on a move, one-paper
generation, the Money tab's counts; then, after the review of 40c1447, 9 more: capture's
`line_rule` hold, the unsourced prior sitting, the re-price on the admin's move and on the
correction, the to-be-confirmed notice on a board change, replace teacher per unit, the known
sittings, Q-20's late entry on, off and swept, the rejected declaration), 08p (7: A-16, one-paper
retake, settings for new lines only, the pricing.* exceptions, exceptions in order, provisional
fee, confirm higher and re-price), 08t (16 races: since 40c1447's review a Confirm inside each of
the four moves and a drop's approval against a reversal in both orders), a 05 cross-family case
for `/registrations/offers`, the authz rows, 09's rules (§8, and the provisional-line rule). Every
guard added since the reviews shown red when undone (trail rows `control`).

## 4. Decisions made while building (for the lead)

1. **Three F0b assertions changed outside the brief's explicit list**, all in the scenario class
   it pre-authorised: 08's MO-10 test (a deadline before the window's close was refused, now
   accepted; the database no longer rejects it), 08's "a window cannot be moved to close on or
   after its board entry deadline" (refused 400, now accepted — its trail row was missing until
   the review of 977848d, flag 6) and 08k's first race (a change to a window's series was refused
   once a registration landed; an item's series change now carries the line, its student locked
   first). Trail rows `assertion` at 21:00:24Z (two) and 21:25:07Z. The lead kept all three
   (8 Oct).
2. **Writers that move lines take the students first** and run again when a student appeared
   while they waited (`lib/student-locks.ts`), rather than locking students after their own rows
   (a deadlock with a reservation).
3. **A board change** moves each item to the new board's series of the same month and label
   (else its unlabelled series of that month, else the default), compares each line's effective
   deadline, and carries the old board's fee as a provisional row when finance has none there.
4. **Re-dating after a series' dates change** runs in its own transaction after the change (a
   checkout locks lines before series). A crash between the two leaves due dates stale until the
   next change; the money is safe (the sweep reads the effective deadline, not `due_at`).
5. **Past a line's deadline a family's drop or swap is refused** and sent to the desk; today's
   drop paths are all the family's, so until B/C's desk-drop (the receipt gate, the "sent"
   refund) exists, a line past its deadline is not dropped by anyone (08n).
6. **Grade 10 in bulk** applies the school-fee gate per student, and the school's consent rows
   lock the session's refund policy as a family's would.
7. **0042 routes new lines as F0b did** (`not_routed`, §1.3). A database that ran 0042 before
   commit 5360b1c (igcse_rwa_dev; B's and C's branches of 1ba3de1) keeps its converted items.
8. `GRADUATE_RETAKE_SESSION_TYPES` keeps the old winter types beside `winter`, so a board
   series' month still answers.
9. The running system is on API 3121 / web 3120: 3101/3100 are held by another worktree's dev
   servers, left alone.

## 5. Not in this step

- B: `lines`/consent inputs on the reservation paths, declarations and To verify, the teacher
  change, the desk's and the family's Reserve pages, the Statement, the desk-drop past a deadline.
- C: `refundFor` (the refund-policy snapshot it reads is written by B at consent, §1.6, §2.10,
  and by A's grade-10 commit), the exceptions registry (gates granted by
  exception, one-shot use, `deadline.payment`), charges and instalments, board services and the
  remark fee from the grid, the Money tab's charges.
- D: reminders and the Money tab's "Remind".
- F7: the import spike's sessions now take the new shape but get no offers; it must add them.
- §7 step 3: dropping `qualification_level`, `session_subject_series`, the old type names.

## 6. Progress log

- 2026-10-07 19:54Z — worktree and branch from origin/main c99b553; baseline suite green on
  `igcse_rwa_test` (22 files, 308 passed, 1 todo).
- 20:00Z — this document's §1 and §2 written before the code.
- 20:50Z — schema and migrations 0041–0043 and the services built; every old line-creating path
  goes through `insertLines` (commit 7e83d60, 20:50Z).
- 21:35Z — the F0b suites (08i–08m) adapted to sessions, offers and items, every assertion change
  with its trail row (two flagged for the lead); 09's rules of the rework; the student-first lock
  order for line movers; re-dating (commit d56ef27).
- 22:01Z — WIP commit 1ba3de1 pushed at the lead's request so B and C can branch from it (gates
  stated in its message); §2.11 lists what the contract gained since it was published. 08n,
  08p written and green alone; 08t written.
- 22:11Z — full suite green in local time and UTC on the tree of 27e3233 (25 files, 341
  passed); six guard controls red when undone. Pushed.
- 22:50Z — the Sessions and Session screens, settings and the series' retake deadline; driven
  in headless Chrome on igcse_rwa_dev (API 3121, web 3120) in English and Arabic; three defects
  found by driving and fixed. Commit 19570e6 pushed; CI green.
- 23:05Z — conversion run on copies of four databases (0 differences); 0042 now routes new
  lines as F0b did. Commit 5360b1c pushed. *Corrected after the review of 977848d:* the
  template and foundation copies are the same data for everything the probe reads (identical
  before-probes), so that run proved two shapes, not four — see §3's "Conversion".
- 23:20Z — §3–§5 above; the per-unit enrolment test in 08n.
- 8 Oct, after the review of 977848d — flags 1 and 2 (approval past a deadline; moved lines
  re-priced from the new series' grid), 3–9 and the cheap minors fixed, each with its test or
  trail row; §2.12 lists the contract changes; the conversion re-run on five copies with the
  final 0042 and stated as two shapes plus a scratch case; the step counts measured.
- 01:07Z — 40c1447 pushed (CI green 01:12Z). The reviewer's second pass, 01:20Z: ready to merge
  after five follow-ups; then B's four findings (01:53Z), C's two (02:05Z), MA-16's receipt-first
  correction (02:20Z) and the known sittings (02:21Z).
- 02:33Z — all of them built, each with its test and its control red when undone: the moves'
  fee-row locks (four 08t races), the 09 rule, capture's `line_rule` hold, the unsourced prior
  sitting, the re-price on the admin's move and the correction, the to-be-confirmed notice, the
  rejected declaration (0044), the grade-10 snapshot, replace-teacher per unit, the pricing.*
  exceptions, Q-20's late entry, the receipt before the line (an 08t race of an approval against
  a reversal), the known sittings; §2.1, §2.6, §2.12, §3's copy-from count and §5 corrected.
- 03:02Z — af33662 merged to main (with origin/main, b438976). The lead: close the open race.
  03:12Z — the series' fee grid lock (§2.1), two 08t races (the move first, finance first), the
  control red with the move's lock removed; and a put that confirms now settles its lines (08p).
- 03:3xZ — the bounded pass on 40c1447..af33662, "fix forward: 1–5": the published put (08p on a
  copied grid), replace teacher on a converted session, `effectiveDeadlinesOf` and Q-20 (08n
  submits a reference), the put's rows in id order (08t, a deadlock in its control), the Fees
  tab's stuck lines, and 09's rule seen failing (the suite with a move's lock removed); the
  evidence folder in git.
