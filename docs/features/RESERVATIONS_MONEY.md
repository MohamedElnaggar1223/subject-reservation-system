# Reservations rework — step C (agent C): money changes, charges, exceptions

Branch `feature/rework-money`, from `origin/feature/rework-sessions` (agent A's step 1, merged
again at 977848d). The design is `RESERVATIONS_REWORK.md` version 8 (accepted 7 Oct 2026 with
its §17 defaults); this step is its §3.6, §3.7, §3.9, §3.10 items 1–9, §4.7, the School fees
push and the desk-drop of §3.3. A's contract is `docs/features/RESERVATIONS.md` §2 (§2.1 the
lock order, §2.8 the adapter this step replaces, §2.10 what is not mine to touch, §2.11 what
the contract gained). The trail is `.audit/rework-money.tsv`; evidence (suite logs, controls,
the dev-copy migration, screenshots) is `.audit/rework-money-evidence/` (git-ignored). The
progress log is the last section.

---

## 1. The data model

Everything is in `packages/db/src/schema.ts`. Migrations after A's 0043:
`0044_rework_money_structure` (generated, additive), `0045_rework_money_backfill` (custom,
idempotent: run twice on the dev copy, the second run inserts nothing), and
`0046_rework_money_constraints` (what the backfill makes true).

### 1.1 `exception` (reshaped, §3.7)

One row lifts one policy of the registry for one holder, optionally narrowed.

- **The policy**: `policy_key` (not null after 0046), a key of `POLICIES`
  (`packages/validations/src/exception/policies.ts`). `type` stays for V3's eight types (null on
  a new-shape row).
- **The holder**: `student_id` **or** `family_id` (a parent account: every child linked to it,
  now and later) — `exception_one_holder` checks exactly one.
- **The scope** (each column narrows it; all set must match): `session_id`, `subject_id`
  (any session), `offer_id`, `offer_item_id`, `registration_id` (one line), `charge_id`,
  `board_series_id`, `academic_year`. What no scope means is the policy's `nullScope`.
- **The value**, in its type's column: `value_number` (a percent or an amount), `value_date`,
  `value_json` (a plan's schedule). `value` (V3's) is kept: a V3-shaped insert is filled by the
  trigger `exception_legacy_fill` (0045) exactly as the backfill maps it.
- **The life**: `status` (`active`, `revoked`, `lapsed`, `used` — a one-shot gate used by the
  reservation it let through, `used_at`, `used_for.registrationIds`), `valid_until`,
  `revoke_reason`; `check_reason` / `confirmed_at` / `confirmed_by` for "Check these".

The eight V3 types map in 0045 (`exception_policy_from_legacy`): `discount_percent` →
`price.discountPercent`, `discount_fixed` → `price.discountFixed`, `custom_price` →
`price.custom`, `fee_waiver` → `gate.schoolFee`, `deadline_extension` and `late_registration` →
`deadline.window` with `value_date` = their `valid_until`, `custom_refund_percent` →
`refund.percent`, `grade10_other_series` → `eligibility.grade10OtherSeries`. A subject-scoped
deadline extension or refund percent (which V3 never applied) gets a `check_reason` and applies
to nothing until a finance admin confirms it. One `REWORK_BACKFILL_EXCEPTION` audit row per
moved exception.

### 1.2 The boards' services (§3.6)

- `board_service` — the catalogue: per board, `code`, `label`, `kind` (`remark`, `cash_in`,
  `late_cash_in`, `certificate_split`), `per_component`, `level_rates`, `refund_rule`
  (`none`, `full`, `less_fixed` with `refund_deduction`), `requestable_by_family`,
  `legacy_service_type` (V3's remark service it replaces). Seeded with stable ids:
  Cambridge 1, 1S, 2, 2S and the certificate split; Pearson review of marking, clerical
  re-check, access to scripts, priority review, cash-in, late cash-in, certificate split;
  Oxford clerical re-check, review of marking, access to scripts. Every refund rule is `full`
  until the owner answers Q-21.
- `board_service_fee` — the fee per series × service × level (`igcse` or `as_a_level`),
  `provisional` until confirmed, `copied_from_default` when it came from V3's
  `remark_fee_schedule` (0045 copies each V3 remark fee, provisional, into every open or
  future series of that board at both levels, with `REWORK_BACKFILL_SERVICE` rows).
- `board_service_deadline` — the board's last date for a service in a series. 0045 moves each
  V3 `remark_deadline` (board × window × service) onto the series the window's items sit in;
  two windows feeding one series keep the earlier date.
- `remark_request` gains `board_service_id` and `service_level`.

### 1.3 `charge` and `payment_charge` (§3.6, §3.10)

A charge is money the family owes that is not a line: `kind` (`cash_in`, `late_cash_in`,
`certificate_split`, `late_entry_fee`, `school_fee_push`, `instalment`, `price_adjustment`,
`custom`), `student_id`, what it is for (`registration_id`, `board_series_id`,
`board_service_id` and `level`, or `academic_year`), `description`, `amount`, `due_at`,
`status` (`requested` → `pending_payment` → `paid` → `refunded`; or `cancelled`),
`plan_exception_id` and `instalment_no` for an instalment, `settled_by_payment_id` for a pushed
school fee, `refund_amount` (never above `amount`, checked), `pricing_basis` (its base and the
exceptions applied). One live push per student and year, one instalment per plan and number
(unique indexes).

`payment_charge` links a payment to the charges it pays (as `payment_registration` does
lines). A payment has one purpose: `charge` (charges only) or the old ones (lines, the school
fee, a preregistration, a remark). `payment_method` gains `held_deposits` (a plan's capture).

### 1.4 Receipts and the ledger

- `receipt.registration_id` is nullable and `receipt.charge_id` added (unique); 0046's
  `receipt_one_subject` checks a receipt is for exactly one line or one charge. A charge's
  receipt is `RCP-C…` (`-R` when reissued after a reversal).
- `escrow_transaction.related_charge_id` (a charge's refund). New ledger reasons: `instalment`
  and `instalment_reversed` (held, earmarked by `related_registration_id`), `plan_capture`,
  `plan_forfeit`, `plan_release`, `charge_refund`.

### 1.5 Settings (F0a's store)

- `payment.expireOverdueAfterDays` — 0 (off) by default; admin or finance admin. On, a waiting
  line that many days past its due date, with no payment in progress, expires `overdue`.
- `exceptions.boardEntryDeadline` — false by default; admin; owner question Q-20. Off, the
  board's entry deadline is a hard stop: `deadline.boardEntry` cannot be granted and a
  `late_entry_fee` charge cannot be created.

---

## 2. Money paths: what each writes, its audit row, its locks

Every money transition writes its audit row in its own transaction (`logAction(..., tx)`).
Locks follow RESERVATIONS.md §2.1: the student `FOR NO KEY UPDATE` first, then the line(s) in
id order, then the exception; a payment is locked before its lines; the escrow row is locked
before any held sum is read.

| Path | Writes | Audit rows | Locks, in order |
|---|---|---|---|
| Create a charge (`createCharge`) | `charge` (`pending_payment`; `requested` from a family for a requestable service) | `CHARGE_CREATED` / `CHARGE_REQUESTED`; `SERVICE_FEE_DEFAULT_COPIED` when the fee came from the default | student; its line `FOR SHARE` |
| Accept / cancel (`acceptCharge`, `cancelCharge`) | status | `CHARGE_ACCEPTED`, `CHARGE_CANCELLED` | the charge |
| Pay charges (`initiateChargePayment`, desk `collectAtDesk`) | one payment per deadline group (one per plan line for instalments), `payment_charge`; escrow applied (never to an instalment) | `CHARGE_PAYMENT_INITIATED`, `PAYMENT_CONFIRMED` when fully paid from escrow or at the desk | the student; an instalment's line, its plan `FOR SHARE`; the charges in id order; a price read before the lock is compared again (`PRICE_CHANGED_REFUSAL`) |
| Confirm a charge payment (`confirmChargesInTx`, `finishChargesInTx`) | charges `paid`, receipts (`RCP-C…`), an instalment's held credit and deposit slip (`DEP-…`, no paper receipt) | `CHARGE_PAID`, `PAYMENT_CONFIRMED` | the payment; an instalment's line, its plan; the charges |
| A plan's capture (`capturePlanInTx`, in the last instalment's confirmation) | a payment `held_deposits`, amount 0, `escrow_amount_applied` = the price; `plan_capture` held debit with the payment's id; `payment_registration`; the line `confirmed`; its receipt naming the slips; the plan `used` | `PLAN_CAPTURED`, `PAYMENT_CONFIRMED`, `REGISTRATION_CONFIRMED` | the payment, the line, the plan, the escrow row |
| A plan's settlement (`settlePlanInTx`, inside any expiry of its line, a revocation, a lapse, a release in full) | keep = min(deposits, price − refundFor(line, that day)) as `plan_forfeit`, the rest `plan_release` to free escrow; unpaid instalments cancelled | `PLAN_SETTLED` (cause, kept, released, deposits) | the line (held by the caller), the plan, the escrow row |
| Reverse a charge payment (`reverseChargesInTx`) | charges back to `pending_payment`, receipts void, an instalment's held credit taken back (`instalment_reversed`) while the plan is live; a capture is never reversed, nor an instalment after it | `CHARGE_REOPENED`, `PAYMENT_REVERSED` | the payment, the charges, the escrow row |
| Refund a charge (`refundCharge`, finance admin) | `charge_refund` free credit with `related_charge_id`, `refund_amount`; the paper first (an issued receipt is refused, one not yet issued is voided) | `CHARGE_REFUNDED` | the receipt, the charge |
| Push the school fee (`pushSchoolFees`) | a `school_fee_push` charge per student who owes the year (skips paid, waived, A-13 graduates, already pushed or paying) | `CHARGE_CREATED` each, `SCHOOL_FEE_PUSHED` once | each student |
| Settle / reopen a push | a school-fee payment's confirmation marks the open push `paid` (`settled_by_payment_id`); its reversal reopens it; a waiver granted after cancels it | `CHARGE_SETTLED`, `CHARGE_REOPENED`, `CHARGE_CANCELLED` | the student (both orders of push and confirmation serialise on it) |
| The service-deadline sweep (`closeChargesAtServiceDeadlines`) | an unpaid service charge past its board's date `cancelled`; its open payment failed first, escrow back | `CHARGE_CLOSED_AT_DEADLINE`, `PAYMENT_FAILED` | claimed by a status-guarded update under the charge's lock (two sweeps close it once) |
| Dead plans' payments (`failInstalmentPaymentsOfDeadPlans`) | an open instalment payment of a plan no longer live failed (`The instalment plan ended before this payment was confirmed`) | `PAYMENT_FAILED` | the payment (after the ending committed) |
| The overdue expiry (`expireOverdueLines`) | waiting lines past due by the setting's days expire `overdue`, a live plan settled | `REGISTRATION_EXPIRED` (`overdue`), `PLAN_SETTLED` | the line (status-filtered `FOR UPDATE`, so two ticks expire it once) |
| Plans lapsing (`lapsePlans`) | the plan `lapsed`, its line expired `plan_lapsed`, settled | `EXCEPTION_LAPSED`, `REGISTRATION_EXPIRED`, `PLAN_SETTLED` | the line, then the plan's status-guarded claim |
| The desk-drop (`deskDrop`) | a confirmed line past its effective deadline dropped through the receipt-gated drop with `refundFor` (board fee kept when sent); F4's withdrawal is a seam | `DESK_DROP_EXECUTED` (and the drop's own rows) | the line, its receipt (the core drop's locks) |
| A drop's refund (`refundFor` in every drop path) | course fee by the policy's week, board fee until the entry is sent | the drop's rows | the drop's |
| Grant / revoke an exception | the row; a line-scoped price exception re-prices the unpaid line (and back on revoke); a charge-scoped one re-prices a charge awaiting payment; `deadline.payment` re-dates; a plan creates its instalments, re-dates the line; a waiver cancels open pushes; a plan revoked expires and settles its line | `EXCEPTION_GRANTED` / `EXCEPTION_REVOKED`, `LINE_REPRICED`, `CHARGE_REPRICED`, `LINE_DUE_MOVED`, `CHARGE_CREATED` | the students it covers, the line or charge it rests on, the exception |
| A one-shot gate used | `used`, `used_for` | `EXCEPTION_USED` | the gate `FOR UPDATE` in the reservation (after the student) |
| Release a plan in full | every deposit to free escrow, unpaid instalments cancelled, the line due by its usual date again | `EXCEPTION_REVOKED` (release), `PLAN_SETTLED`, `LINE_DUE_MOVED` | student, line, plan |

---

## 3. The registry and its hooks (§3.7, §6)

`POLICIES` declares, for each key: group, label, sentence (`{who}`, `{value}`, `{scope}`),
value type and bounds, the scopes it accepts and what no scope means, one-shot or not, who may
grant it, the hook that reads it, and its status (`live`, `gated` — `deadline.boardEntry` —,
or `pending` — the four `pricing.*` percents). `GET /v1/policies` returns it with
`grantable` and `whyNot` (`not_your_role`, `not_applied_yet`, `off_by_setting`) for the caller.
`POST /v1/exceptions` checks a grant against it (grantors, value and bounds, scopes accepted,
a scope where `nullScope` is null, ownership of a line or charge in the scope, never a price
exception on a push or an instalment) and still takes V3's shape.

Every hook reads exceptions through `exception-registry.services.ts` (`activeExceptions`:
the student's or the family's, active, not past `valid_until`, confirmed if listed under
"Check these", covering the scope; `FOR SHARE` / `FOR UPDATE` when the caller asks). A's
adapter (`line-exceptions.ts`) keeps its interface over it; asked for `deadline.payment` on a
line under a live plan it answers the plan's last date first.

- **`refundFor(executor, lineId, at, { neverSent })`** → `{ percent, basis, byException,
  anchor, week, coursePart, boardPart, boardSent, amount, fullPrice }`. The line's policy (its
  snapshot, else its session's) by the week since the anchor (`refund.courseStart`, else
  F1's first lesson, else the offer's course start, else the session's); `refund.percent`
  overrides the step on the course fee; the board fee comes back until the entry is sent
  (§3.9). A converted line keeps V3's windows on its whole price. Used by every drop, the
  swap, the preregistration cancel, the preview and the plan's settlement.
- **`chargeRules(tx, charge)`** — asked at a charge's creation, acceptance and payment: refuses
  past its deadline (`charge_effective_deadline`: the service's date in the series, an
  instalment its line's), applies the charge-scoped price exceptions to its base (never to a
  push or an instalment).
- **The school-fee gate**: `schoolFeeWaived(student, academicYear)` (`gate.schoolFee`, a year
  or every year). **The window**: `windowExtended` (`deadline.window`). **Grade 10**:
  `mayRegisterFor` reads `eligibility.grade10OtherSeries` (the student's or the family's).
  **Gates** and **prices** through the adapter (`assertLineRules`, `priceLine`).
- **Check these** (`GET /v1/exceptions/check-these`, `POST /:id/confirm`): migrated rows with
  a `check_reason`, and a price exception on an old unit row whose unit an item of another
  subject now enters (it still applies to that row's lines only).

---

## 4. Decisions made while building (each has its trail row)

1. **Service fees in their own table** (`board_service_fee`), not a service kind of
   `board_fee`: `board_fee` is A's (§2.10) and a service fee needs level rates and per-paper
   pricing. *For the lead.*
2. **`pricing.*` registered as `pending`** (a grant is refused 409): `priceLine` reads those
   percents from the settings only. *For the lead.*
3. **`refundFor`'s fallbacks**: no snapshot → the session's policy; a converted line → V3's
   windows on the whole price; the anchor order above.
4. **"Sent"** = confirmed (or parked for its paper) and F4's `entrySentAt` or the line's
   effective deadline passed; a line never confirmed is never sent (the lead's point 4).
5. **Revocation**: `/revoke` keeps V3's bodiless shape; `/revocation { reason }` is the
   screen's (the typed client cannot send `/revoke`'s optional body); `/release` is a plan's
   release in full.
6. **The lapse step split**: `lapseGrade10Exceptions` (unchanged meaning) and `lapsePlans`.
7. **A plan line ending for any reason is settled inside `expireWaitingRegistrations`**; its
   open instalment payments are failed afterwards (a payment is locked before a line).
8. **The held wallet is earmarked per line**: a plan debit needs its line's own sum; any other
   held debit leaves every live plan's deposits alone.
9. **One purpose per payment**; a charge payment covers one deadline group or one plan line;
   instalments never from escrow; the desk applies escrow to lines first, then charges.
10. **`deadline.payment` re-dates at grant and revocation**; a plan's last date is its line's
    due date.
11. **`exception.value` kept** for the V3 writers still in the code; its drop is deferred.
12. **`PUT /v1/board-services/fees`** added for the fee grid's writer.
13. **The overdue expiry is off by default** and settles a live plan (the lead's point 3).
14. **The Student 360 lists the family's exceptions** by policy (the desk showed a blank for a
    new-shape row).
15. **A revocation locks the students it covers first** (§2.1), then the line or charge, then
    the exception; a revoked line-scoped price exception re-prices its unpaid line back; a
    charge-scoped one re-prices a charge awaiting payment at once.

---

## 5. Endpoints (each has its row in `apps/api/test/authz-policy.tsv`)

| Endpoint | Who | Notes |
|---|---|---|
| `GET /v1/policies` | staff | the registry with `grantable` / `whyNot` |
| `GET /v1/exceptions` `?studentId&familyId&status&policyKey&type` | finance admin, admin, coordinator | only policies the caller may grant |
| `POST /v1/exceptions` | the policy's grantors | new shape `{ policyKey, studentId \| familyId, scope, value?, validUntil?, reason }` or V3's |
| `POST /v1/exceptions/:id/revoke` | the policy's grantors | V3's shape (optional `{ reason }` read by hand) |
| `POST /v1/exceptions/:id/revocation` `{ reason }` | the policy's grantors | the screen's |
| `POST /v1/exceptions/:id/release` `{ note? }` | finance admin, admin | a plan released in full |
| `GET /v1/exceptions/check-these`, `POST /:id/confirm` `{ note? }` | finance admin, admin, coordinator (theirs) | §3.7 |
| `GET /v1/charges` `?studentId&status&kind` | staff; a family its own | the Statement reads `listChargesFor(studentId)` |
| `POST /v1/charges` | staff; a family a requestable service | `price_adjustment`, `custom` finance only; `late_entry_fee` behind Q-20's setting |
| `POST /v1/charges/:id/accept`, `/cancel` `{ reason }` | finance desk, admin | |
| `POST /v1/charges/:id/refund` `{ amount, reason }` | finance admin, admin | to escrow, the paper first |
| `POST /v1/payments/initiate` `{ chargeIds }` | the family | charges or lines, never both |
| `POST /v1/registrations/desk/collect` `{ registrationIds?, chargeIds? }` | finance desk | |
| `GET /v1/board-services`; `PUT /:id`; `PUT /deadlines` | staff read; admin, coordinator write | |
| `PUT /v1/board-services/fees` | finance admin, admin | the fee grid |
| `POST /v1/school-fees/push` `{ academicYear, grade? \| sectionId? \| studentIds?, dueAt }` | finance admin, admin | |
| `POST /v1/registrations/:id/desk-drop` `{ reason }` | finance desk, admin | past the line's effective deadline only |

---

## 6. The rules 09 checks (`09-money-invariants.test.ts`, step C's block)

Five existing rules were extended for the new movements, none changed for the rows they already
judged (trail row 2026-10-07T23:56:25Z, not pre-authorised by the brief: the lead to confirm):
escrow applied counts `plan_capture`; MA-15's held wallet adds live plans' deposits; the
creation actions add `CHARGE_PAYMENT_INITIATED` and `PLAN_CAPTURED`; the expiry reasons add
`overdue`, `declaration_rejected`, `hold_unverified`, `plan_revoked`, `plan_lapsed`,
`plan_ended`; every `plan_capture` has its `PLAN_CAPTURED` row for the amount.

Step C's own rules:
1. there are charges, plans and exceptions to check (every kind happened above);
2. a charge payment charges exactly the sum of its charges; one purpose per payment;
3. an open charge payment's charges share one deadline; an instalment payment covers one line;
4. no charge paid twice, every paid charge once; a push settled by its school-fee payment, never
   as a charge; no open push on a year already paid;
5. a charge's refund never exceeds it and escrow was credited exactly that;
6. every paid charge has its receipt, never a void one — an instalment its deposit slip;
7. an instalment's payment credited the held wallet for exactly its amount, earmarked for its
   line, and its reversal took exactly that back;
8. a line under a plan is confirmed only by one capture of its held deposits, equal to its price;
9. a plan's deposits end as one capture, or at most one release and one forfeit summing to
   them; a live plan's are all still held;
10. a plan line that ended was settled, keeping at most what a paid drop that day would keep;
11. every one-shot gate is used at most once, by the reservation it let through;
12. every exception carries a registry policy, its value in its policy's own column and a scope
    the policy accepts;
13. every charge has one creation row; every desk drop was past its line's deadline.

---

## 7. Tests, races and controls

- `08q-charges.test.ts` (27): the seeded services; cash-in end to end (requested, accepted,
  paid beside a line in one desk action, reversed and reissued, refunded with the paper first);
  two deadlines refused in one payment; the service sweep (two at once close once); a Cambridge
  remark at the AS rate from the grid and its refund rule; the push (paid, waived, graduate
  skipped; settled, reopened, cancelled by a waiver; to a grade); drops by the policy (week 3 of
  June 1,000; an offer's later start 1,500; `refund.courseStart` 1,500; winter week 7 500; a
  custom price 600; a converted line 750); the desk-drop past the deadline with the paper first
  and at the exams' start; the overdue expiry; plans (refusals; three instalments, capture,
  reversal, escrow refused, takings; not sent back for approval; Q-15's worked example; release
  in full; overdue, leaver and failed-payment endings; the close sparing the last instalment;
  the deadline sweep and the lapse).
- `08r-exceptions-registry.test.ts` (10): the policies per caller; grant checks; a family's
  exception for every child and no one else; a one-shot gate used once; a line's price
  exception and its revocation; a charge's; `deadline.payment` re-dated and back; the eight V3
  types as the trigger maps them; Check these (a subject-scoped refund percent applies only
  once confirmed: 100% then 30% of the course fee; a unit row a parent item now enters).
- `08t-rework-races.test.ts`, step C's block (4): an exception revoked while a line relies on
  it, both orders; a family's one-shot gate used by two children at once; the last
  instalment's confirmation and the deadline sweep on one line, both orders.
- `05-object-access`: a family cannot read, ask for, pay, accept, cancel or refund another's
  charges, nor scope an exception to another's line or charge, nor desk-drop.
- Assertions restated (pre-authorised, trail rows): 08's refund block (750 → 1,000; 1,350 →
  1,400; 0 → 500) and 08m (2,250 → 2,500). 03's remark refund (1,600) unchanged. 08f's settings
  enumeration gains the two keys (not money).
- Controls (each guard undone once, red, restored): the registry's lock, the one-shot gate's
  two layers, the revocation's student lock, `assertNoLivePlan`, the refund's paper gate and
  cap, the service sweep's claim, the confirmation's plan-live check.

---

## 8. Screens

- **Exceptions** (`/admin/exceptions`, its own route group: admin, finance admin,
  coordinator; in the coordinator's nav): "Check these" with confirm and revoke; the grant
  form — the student (or the whole family, from the Student 360's parents), the policy grouped
  (what this role cannot grant shown disabled with why), the scope narrowed to what the policy
  accepts (session, subject, the subject in a session and its item, one line, one charge, a
  board series, an academic year), the value by type or a plan's instalments, the registry's
  sentence, a reason, valid until; the list by status with revoke and, for a plan, release in
  full. Coordinators are offered the seven academic gates only.
- **School fees → Push to families**: year, a grade or a section, the due date; pushed and
  skipped listed with why.
- **The desk** names a student's exceptions (their own and the family's) by policy.
- Arabic for all of it in `apps/web/lib/i18n-money.ts` (words, the registry's sentences with
  their parts, the dialogs and the API's refusals), merged in `lib/i18n.tsx` as A's file is.
  The excel version of the grant is a note beside the family's row someone must remember at
  the next payment; here every hook applies it and the sentence says what it will do first.

---

## 9. Seams

- **For B**: `listChargesFor(studentId)` (`charge.services.ts`) — a student's charges with
  their kind, amount, due date, status, plan and instalment number, refund — for the
  Statement (also `GET /v1/charges?studentId=`). `refundFor` reads `refund_policy_snapshot`
  when B writes it. The line inputs, consent, verification and the Statement page are B's.
- **For F1**: `firstLessonFor(line)` in `refund.services.ts` (returns null) — the refund
  anchor once lessons exist.
- **For F4**: `entrySentAt(lineId)` (null) — when the entry is sent, the board fee is kept;
  `withdrawEntry(line, reason)` in `desk-drop.services.ts` (null) — the desk-drop's
  withdrawal from the board.

---

## 10. Not in this step

- A **Charges screen** for finance (list, accept a family's request, cancel, refund, add a
  custom charge or price adjustment) and the **desk's collection of charges** in its UI: the
  API does it; the screens do not yet.
- The **board services admin UI** (catalogue, deadlines per series, the fee grid): API only.
- **Charges on the Statement** (B's page) and in the session's **Money tab** (A's service).
- The **remarks pages** choosing a board service: they still send V3's service type, which the
  API maps.
- **`deadline.boardEntry` is not read by any hook**: A's `effectiveDeadlineFor` and
  `line_effective_deadline` do not ask the registry, so a late entry granted while the setting
  is on would change nothing. Off by default (Q-20).
- `exception.value`'s drop; reminders per instalment (step D, §3.8); a family's plan screens.

---

## 11. For the lead

1. **`priceLine` should read the four `pricing.*` exceptions through the adapter**; then their
   status flips to `live` in `POLICIES` (one line each) and 08r's 409 case changes.
2. **Service fees are in `board_service_fee`**, not a service kind of `board_fee` (§2.10
   says the latter; `board_fee` is A's). If the lead prefers A's table, A adds the kind and the
   level and this table's rows move with a migration.
3. **`deadline.boardEntry` needs A's effective deadline to ask the registry** before Q-20's
   setting can be turned on usefully.
4. **Charges in the session's Money tab** (A's service and screen; A's comment says "charges
   join it in step C").
5. **The five extended 09 rules** (§6): they were not pre-authorised; the trail row has OLD and
   NEW.
6. **Arabic pages log a hydration mismatch** on every page (A's Sessions too): the
   `I18nProvider` reads the language from `localStorage` in its initial state on the client.
   Not this step's; worth one fix in the provider.
7. **Migration numbers** 0044–0046 follow A's 0043; if B's land first on main, mine are
   regenerated at merge (`drizzle-kit generate --name rework_money_structure`, the two custom
   files renumbered) — their content does not depend on B's.
8. **A plan whose `valid_until` passed but whose lapse has not run** is still live for a
   confirmation until the next tick claims it (the plan is live while its exception is
   `active`, §3.6). The tick runs every minute.

---

## 12. Questions for the owner

- **Q-21** (still open): each board service's refund rule — seeded `full` for all until
  answered; a finance admin can set `less_fixed` with a deduction per service.
- The **service fees copied from V3's remark fees are provisional**: the school confirms each
  series' grid before families pay them.
- **The overdue expiry** stays off until the school chooses how many days after the due date an
  unpaid line is released.

---

## 13. Progress log (UTC)

- 2026-10-07 22:10 — worktree from A's WIP; 22:28 baseline (338 passed, A's three 08t not yet
  run), fast-forwarded to A's 27e3233.
- 23:34 — A's finished step 1 (977848d) merged in, no conflicts.
- 23:45–23:56 — 08 and 08m refund assertions restated (pre-authorised); 08f's settings; the
  09 extensions (§6).
- 23:52 — f8a6021: the registry behind A's adapter, refundFor, charges and their payments,
  board services and the remark fee from the grid, plans, the push, the desk-drop, the overdue
  expiry, the sweep over charges; migrations 0044–0046.
- 00:20 — the suite red in 09 only (my tests rewrote a series' deadline after use); fixed in
  the tests.
- 00:29 — 08r green; 00:32 / 00:36 — the suite green at c2c62d9 (393, local and UTC).
- 00:52–00:56 — the 08t races; eight controls red, restored, green.
- 01:00 / 01:04 — the suite green at 19c203a (398, local and UTC); 01:02 — the dev copy
  migrated through 0046, 0045 idempotent; 01:06 — first push (8d61a40), CI green.
- 01:09–01:41 — the Student 360's family exceptions; `/revocation`; the Exceptions screen and
  Push to families; Arabic; driven headless on 3140/3141 (§8); the suite green (398).
