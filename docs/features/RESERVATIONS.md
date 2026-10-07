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
| `sort_order`, `legacy` (jsonb: `converted`, `no_series`) | |

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
| `refund_policy_snapshot` | jsonb, null | B at consent (shape §2.6) |
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
   lines go to (`FOR SHARE`).
4. The offers (`FOR SHARE`), then the items (`FOR SHARE`), in id order.
5. The fee rows the prices read (`board_fee` `FOR SHARE`, id order).
6. The student's and family's exceptions: read rows `FOR SHARE`, one-shot gates `FOR UPDATE`
   (marked used in the same transaction).

Writers take their row `FOR UPDATE` at its place in this order: a series change of an item,
an offer's close, an item's untick or availability change, a teacher removal (item/offer
`FOR UPDATE`); a fee confirm or re-price (`board_fee` `FOR UPDATE`, then the lines
`FOR UPDATE` in id order); a grant or revocation (exception `FOR UPDATE`). Every path that puts
a line into a series takes the student lock first and runs `assertLineRules`: the reservation
paths, an item's series change (per affected student), the grade-10 bulk commit (per student),
F7's import (per student) and preregistration capture.

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
assertLineRules(tx, { studentId, sessionId, eligibility }, lines: RuleLine[]): Promise<{ usedExceptionIds: string[] }>
// RuleLine = { offerItemId, attempt, mode, priorSittingSeriesId: string | null }
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
effectiveDeadlineFor(executor, line: { boardSeriesId: string | null; attempt: string; priorSittingSeriesId: string | null })
  : Promise<{ at: Date | null; kind: 'retake' | 'entry' | 'exams_start' | null }>
```

The retake deadline when the line is a `retake` whose prior sitting is **the board's latest
sitting before this series** in the board's calendar (`exam_board.series_months`: the month
and year before, label ignored) and the series has one; else the entry deadline; else, for a
series with no entry deadline, the start of its `exams_start` day in Cairo; else null (no
cut-off; such a series takes no new line). The same rule in SQL:
`line_effective_deadline(attempt, prior_sitting_series_id, board_series_id)` (0041), used by
`seriesDeadlineGroups`, `openCheckoutsSpanningDeadlines`, the sweep, `referenceDueFor`, the
InstaPay reference check, `moveRegistrations`, preregistration capture and cancellation, and
09.

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
`throughWeek: null`). `RefundPolicySnapshot` (B writes at consent) =
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
  the service kind of `board_fee` (with the remark fee migration — this step leaves
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
- **The past-deadline change refusal** (`swap.services.ts`): a family is told to ask the desk; a
  staff caller is told it cannot be changed or dropped here — the desk-drop past the deadline
  (`POST /registrations/:id/desk-drop`, with the receipt gate and the "sent" refund) is step
  B/C's.

## 3. Progress log

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
