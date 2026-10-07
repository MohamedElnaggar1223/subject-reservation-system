# The reservations rework — sessions, reservations, fees, exceptions, notifications

**Date:** 7 October 2026 (version 2, after the Opus 5.5 review of version 1 — §16)
**Status:** design for the owner's review (Phase 2 of FEATURES_PLAN.md §0c). Nothing here is
built. The questions only the owner can answer are in §17.
**Inputs:** `SCHOOL_FORMS.md` (every form and option, the fee lists, the 30-row gap map, the
admin's eleven points), the owner's confirmation of that reading (7 Oct), DISCOVERY.md (A-15,
A-16, Q-10 to Q-18 with the defaults the owner let stand), the system as built (F0a
`docs/features/FOUNDATION.md`, F0b `docs/features/CATALOGUE.md`, MONEY_AUDIT.md, the 09
invariants), the frozen branches F1, F2, F4, F7, the Opus 5.5 survey of today's screens
(§15) and the Opus 5.5 review of version 1 (§16).

**The one sentence.** The school's links sheet — subject, board, teachers, what can be entered —
becomes the session screen; a family's reservation is one line per paper or route with the
form's own choices; the fee is what the fee lists say per unit per series; every rule the forms
express is a policy an exception can lift; and the money core underneath changes in four named
places (§3.10) and nowhere else.

---

## 1. What the admin gets (the screens, in her order)

| Her priority | The screen | What it replaces |
|---|---|---|
| Reservations and fees paid | **Session** (`/admin/sessions/<id>`): the links sheet as a table — every subject open this cycle with its board, teachers, what can be entered and at what fee — and a **Money** tab: who has reserved what, who has paid, who has not, with one-click reminders | 25 Google Forms built by copy-and-edit, a links PDF, the response sheet, the fee note typed per row |
| Reservations | **Reserve** (desk `/desk`, family `/register`): one page per student per session with the same choices as the form, line by line, a running total, consent, pay | the family filling one form per subject; the desk reading the sheet |
| Fees paid | **Statement** (family `/statement`, per child and per family; Student 360): every line and charge with its price, what was paid, what is outstanding, the due date, the receipt | nothing (no prices on the forms) |
| Exceptions | **Exceptions** (`/admin/exceptions`): one rule picker over every policy, deadline and percentage; one sentence saying what the exception does; one audit trail | eight fixed types |
| Notifications | **Messages** (`/admin/messages`): broadcast, batch (any list in the system) or direct, templates, delivery log; **Reminders**: repeating rules per session | one broadcast form |
| Services | **Services** on a reservation: remark (the board's services), cash-in, late cash-in, certificate split, any charge the school adds | remarks only |

The admin never assembles a board series by hand again. A series is attached when an item of
the session is placed in it (§3.3); the only thing she sets on it is the entry deadline, the
hard stop the owner decided (MO-10; §17 asks whether it may ever have an exception), and the
session screen tells her when one is missing.

---

## 2. Principles (each traceable to the owner's words or an artefact)

1. **The form is the floor.** Every element of the forms (SCHOOL_FORMS.md §2) is one field or
   one derived fact here; nothing is asked that the form does not ask, and what the system
   already knows (class, guardian, the teacher pool) is never asked. Where the form trusts the
   family (a retake, the sitting it carries from), the system trusts and verifies (§3.5).
2. **A session is its subjects.** Type and year make the session; the name is derived; the
   subjects with their teachers, papers and fees are the session's content (point 7).
3. **A reservation line is what the board sees.** One line = one paper set, unit or route, priced
   on its own, entered in one board series (points 1, 2; IS-01).
4. **Fees are the fee lists.** Board fees per unit or option per series, course fees per subject
   per cycle; a line snapshots both; provisional until the board publishes (§3.4).
5. **Policies are settings, exceptions lift them.** Every percentage, deadline and gate is a
   named policy with a default; an exception is (policy, scope, value, until, reason) on one
   screen (point 9).
6. **Staff do everything the family can, in fewer steps than the form** (UX_AUDIT.md §4; §11
   counts, honestly).
7. **The money core changes only where §3.10 says** (one purpose per payment; a receipt per
   charge; reversal and refund of a charge; the sweep over charges). Everything else — escrow,
   takings, receipts' lifecycle, the held wallet, MO-10, MO-11, MO-21, MO-24 — keeps its tables,
   services and tests.
8. **No copy-and-edit.** A session is copied from the previous one of its kind, fees re-entered
   per series, and the family's page is generated from it (G-29).

---

## 3. The model

### 3.1 Session (`registration_session`, changed)

| Field | Was | Becomes |
|---|---|---|
| `name` | typed | **derived**: "June 2027"; "November 2026 – January 2027"; a converted window keeps a `label` (§7) that the name appends |
| `session_type` | `june` / `october` / `november` / `january`, one month | **`june`** (feeds the June series of every board) or **`winter`** (feeds the boards' October and November of the year and January of the next); `series_year` = the June year, or the winter's November year. `GRADUATE_RETAKE_SESSION_TYPES` and `A_LEVEL_ONLY_SESSION_TYPES` learn `winter` (A-12 holds for a winter session; the IGCSE-only-in-November rule moves to the item, §3.3) |
| `qualification_level` | one level per window | kept **nullable and unread** for one release, then dropped; one session per cycle, levels per subject (G-01, G-12) |
| `start_date`, `end_date` | the window | kept: when families may reserve |
| — | | `course_starts_on`: the cycle's first lesson, the refund anchor (G-19). **Precedence of the anchor for a line** (Q-11's default): an exception `refund.courseStart` for the student › the first lesson of the student's teaching group for the offer when F1 knows it › the offer's `course_starts_on` › the session's |
| — | | `refund_policy`: steps in weeks from the anchor, copied from the setting of the type at creation (June: 100 to week 2, 50 in week 3, 0 from week 4; winter: 100 to week 2, 50 in weeks 3–6, 0 after), editable **until the first line of the session carries a consent**; after that, only an exception changes one student's |
| — | | `payment_due_at`: the date every line of the session is due unless an exception says otherwise (point 11); never after the earliest entry deadline. A line reserved after it is due `payment.graceDays` (setting, default 7) after reservation, capped by its series' deadline |
| `status`, close fields, `finalized_at`, `edit_history` | | kept; the close, the sweep per series and MO-10 unchanged |

Uniqueness: one active session per (type, year, label); new sessions have an empty label.
F0a's eligibility (`mayRegisterFor`) judges the session's academic year and whether it is June
exactly as today: a winter session is "not June" (grade 10 refused without the grade-10
exception; A-12 for graduates), and all its series are in one academic year (F0b's rule).

**What `due_at` does.** It drives the reminders (§3.8), the Money tab's "overdue" and the
statement. It does **not** expire a line by itself: the series' entry deadline is the only
automatic cut-off (MO-10). A session may turn on `payment.expireOverdueAfterDays` (setting,
default off) to expire lines unpaid that long after their due date, with the sweep's clean-up.

### 3.2 Offer (`session_offer`, new) — a row of the links sheet

One per (session, subject). Fields: `subject_id` (the catalogue's registrable row: board,
qualification, units as F0b maps them), `availability` (`open`: first entries and retakes;
`retake_only`; `self_study_only`; `closed`), `course_fee` (EGP for a first entry in school
this cycle, Q-14), `course_starts_on` (null: the session's), `grade10_core` (the core-subject
mandate per cycle; replaces `subject.is_core`; `registration.was_core_at_registration` is set
from it), `notes`, `sort_order`. A subject the school does not teach (`is_offered_at_school`
false today) is an offer with availability `self_study_only`.

**Teachers** (`session_offer_teacher`): `teacher_id`, `mode` (`in_school`, `online`),
`sort_order`. An external team is a `teacher` row with `kind = 'provider'` (no account; a
name as the links sheet gives it). The pool is the existing `subject_teacher` link (who can
teach what); the offer picks from it; a teacher added here is linked there. An offer with no
teacher and availability `open` is refused ("who teaches it?") unless `self_study_only`. The
mode reaches F1 (§10).

**Items** (`session_offer_item`): what a family can tick under the subject. Fields: `label` (as
the form words it), `enters` (one of: the whole award; a `qualification_option_id`; a set of
`unit_ids`; the subject row itself when unmapped), `board_series_id` (§3.3), `availability` (as
the offer's, per item), `course_fee` (null: the offer's; IAL units and one-paper retakes are
priced per item), `board_fee_key` (what the series' fee grid is read for: by default what the
item enters; a one-paper item of a board that prices the qualification reads the qualification,
Q-13), `needs_prior_series` (default from the catalogue: a carry-forward option; set by hand
for a one-paper retake that carries the other components), `teacher_ids[]` (null: the offer's;
IAL Mathematics names a teacher per unit), `required_in_series` (a first entry of this subject
in that series must include it), `exclusive_group` (items of one group cannot be reserved
together: "whole subject" and "Paper 4 only"; "AS" and "A Level in one sitting"; units have no
group and combine freely), `sort_order`. One line per (student, session, item).

| Subject on the forms | Items generated from the catalogue (editable) |
|---|---|
| an IGCSE subject (Cambridge, Pearson, Oxford) | **Whole subject** (the award, its option code from the catalogue), plus the one-paper retake items the school offers: Cambridge sciences "Paper 4 only (retake)", ICT "Theory paper only (retake)", Edexcel Mathematics "Paper 1H only", "Paper 2H only", Arabic "Paper 1 only", "Paper 2 only" — availability `retake_only`, in one exclusive group with the whole subject; `needs_prior_series` on the Cambridge ones (components carried), not on Edexcel 1H/2H (the form does not ask) |
| a Pearson IAL subject | one item per unit (P1, P2, P3, P4, M1, S1; WBI11–WBI16), each in its series (winter: October by default, January selectable), each with its own teachers and fee; the AS and A Level cash-ins as award items when the school claims them (a `cash_in` charge, F4) |
| a Cambridge A Level subject | the routes, one exclusive group: **AS** (option S1/S2), **A2, carry forward** (option BY/CT, `needs_prior_series`), **A Level** (option AX/HX) — one price each (SCHOOL_FORMS.md §3.1); Chemistry and French: AS and A Level only |
| Arabic A Level (Edexcel) | two items entering two qualifications (IAL YAA01/WAA01–02; GCE 9AA1), one exclusive group, each with its own teacher (Q-16) |

The catalogue (F0b) already holds units, awards, option codes and `qualification_unit`
(required, optional, choice group); the items only choose and label them. An unmapped AS or A
Level subject can be offered with one item entering the row itself (its fee keyed on the row);
the Catalogue screen lists it to map, and F4 cannot derive its entry until it is.

### 3.3 Board series, attached (not assembled)

A series is attached to the session **when an item is placed in it** and detached when no item
uses it: `session_board_series` stays as the derived link that F0b's rules and the 09
invariants read; nothing is attached that no item uses, so F0b's rule "the window closes before
every attached series' deadline" refuses only what the session really feeds, and the sentence
says which item and which deadline. An item's default series: June — the board's June of the
year; winter — for an IGCSE item the board's **November** (IGCSE sits neither October nor
January: F0b's rule, now per item), for an AS or A2 unit or award the board's **October**, with
January selectable; the unlabelled series of that (board, month, year) by default, a labelled
one selectable. A series not yet on record is **created** with no deadline and the session
screen warns ("Pearson Edexcel October 2026: entry deadline not set"). The item's series is
changed per item (Biology units 1–2 to November, 3–4 to January); a change moves the item's
live lines with F0b's guards (no move across deadlines while a checkout is open) and audit
rows. `session_subject_series` (routes per subject) is **replaced** by the item's series; the
routing trigger `catalogue_route_registration()` (0038) is rewritten to read the line's item
(§7).

The "Board series" page (`/exams/series`, the coordinator's calendar of the boards' dates)
stays as it is. The window's series panel, the per-board default and "where each subject is
entered" go away from the admin's path; "move registrations" stays as an admin tool behind the
item's series.

### 3.4 Fees

**`board_fee`** (new): per `board_series_id`, what it prices (one of `unit_id`,
`qualification_option_id`, `qualification_id`, `subject_id` for an unmapped row, or
`board_service_id` with a `level` for the two EAR rates), `amount`, `provisional` (true when
copied from an earlier series or typed before the board publishes), `confirmed_at`,
`confirmed_by`. Entered as the fee lists are: a **fee grid per series** (paste the PDF's rows:
code and amount; unknown codes listed to map), copied from the previous series of the board
with every row provisional and highlighted. An item's board fee is the sum of the grid's rows
for its `board_fee_key`; a line snapshots it (`registration_fee_at_registration`, the existing
column).

**Provisional fees** (the June 2027 board fees are not published when the school opens its
forms in September): an item with a provisional fee **can be reserved**; the line is marked
`price_provisional` and the family sees "board fee provisional, confirmed before payment".
When the grid row is confirmed or changed, **"Re-price unpaid lines"** (one audited batch per
series, `LINE_REPRICED` per line, the family told the old and new price) re-prices every unpaid
line of that key; a paid line is never re-priced (a difference is a `price_adjustment` charge or
a refund to escrow, finance's explicit act with a reason). A line cannot be paid while its fee
row is provisional unless the setting `pricing.payOnProvisionalFee` is on (default off). An
item with no fee row at all shows a warning and cannot be reserved until one is set (or set 0
with a reason).

**Course fee**: `session_offer.course_fee` or `session_offer_item.course_fee` (Q-14), snapshotted
in `course_fee_at_registration`.

**Pricing policies** (settings, F0a's store; each exception-able, §3.7):

| Key | Default | Meaning |
|---|---|---|
| `pricing.selfStudyCoursePercent` | 50 | the course fee in self-study mode (every form) |
| `pricing.selfStudyBoardPercent` | 100 | the board fee in self-study mode (A-16, Q-12) |
| `pricing.retakeTaughtCoursePercent` | 100 | the course fee on a taught retake ("Retake in School 100%") |
| `pricing.onePaperCoursePercent` | 100 | scales a one-paper item's own course fee |
| `pricing.payOnProvisionalFee` | off | whether a line may be paid while its board fee is provisional |

`priceLine(item, attempt, mode, student, session)` is the one pricing function (replaces
`computeRegistrationPricing`): course = item or offer fee × the mode's and attempt's percent;
board = the series' fee × the mode's board percent; then the price exceptions in today's order
(percent discounts, fixed discount, a custom price — **a custom price is the total, the board
fee folded into it, as `exception.services.ts` does today**); total = course + board. The result
and its basis (`pricing_basis` json: attempt, mode, percents, fee rows, exception ids,
provisional) are snapshotted on the line so the receipt and the statement say why the price is
what it is. The 09 rule "price = course + registration fee" holds unchanged.

### 3.5 Reservation line (`registration`, changed)

| Field | Change |
|---|---|
| `subject_id` | kept: **the offer's subject** (for a unit line, the parent subject; a unit row that exists as its own subject today stays one, with an offer of one item) |
| `offer_item_id` | **new**, not null after the backfill: what the line enters |
| `attempt` | **new**: `first` or `retake` — the form's "First Entry" against "Retake" |
| `mode` | **new**: `in_school` or `self_study` — the form's teacher choice against "Self Study"; the two together are the Arabic form's options (first in school; retake in school; retake self-study; and first entry self-study, allowed only where the school does not teach it or by exception) |
| `prior_sitting_series_id`, `prior_sitting_source` | **new**: the sitting a retake or a carry-forward carries from (Q-13); source `known` (an earlier line or an F4 result for what the item enters), `declared_by_desk`, `declared_by_family`; a declared one is **verified** by staff (`prior_sitting_verified_by`, `_at`) from the desk's "Declared retakes to verify" list or by F4 against the board's results; rejecting it re-prices the line as a first entry in school (audited, the family told) or drops it |
| `is_retake`, `taken_outside_school` | kept for the ledger's readers; written from `attempt` and `mode` |
| `teacher_id` | kept; from the item's or offer's teachers; null in self-study; **changeable** by the admin, the coordinator and the finance desk (the family asks there) with a reason, audited; the enrolment and the group follow (§10); a change to self-study on a paid line does **not** re-price it (a refund is finance's explicit act) |
| `board_series_id` | kept; from the item |
| `due_at` | **new** (§3.1) |
| `price_provisional`, `pricing_basis` | **new** (§3.4) |
| `refund_policy_snapshot` | **new**: the policy steps and anchor the family consented to (§3.1) |
| unique index | (student, session, **offer_item**) where live — P1 and P2 under one subject are two lines; the exclusive group is checked in `assertLineRules` |

Statuses, the parent's approval of a student's request, the direct registration, the admin
override, the desk, preregistration, drops and swaps keep their paths; each now takes
`lines: [{ offerItemId, attempt, mode, teacherId?, priorSittingSeriesId? }]` and `consent`
instead of `subjectIds` and `subjectOptions` (`RequestRegistration`, `DirectRegistration`,
`DeskRegistration` change shape; the routes are the same). A swap's new line inherits the
dropped line's consent; an override and the desk record consent on the `desk` channel; an
imported line records the sheet's confirmation column on the `imported` channel.

**Rules on a line** (each a policy with a key, each exception-able, §3.7):

| Key | Rule | From |
|---|---|---|
| `gate.selfStudyFirstEntry` | `self_study` with `attempt = first` only where the school does not teach the item (availability `self_study_only`) or by exception | every form: "ONLY 2nd entry" (G-09) |
| `gate.retakeDeclared` | `attempt = retake` with no known history needs a declared prior sitting; the family may declare it (the form's "From June 2026"), the desk may; both are verified (above) | the forms trust the family; the winter cycle is mostly re-sits |
| `gate.availability` | an item `retake_only` takes `attempt = retake` only; `self_study_only` takes `mode = self_study` only; `closed` none | the links sheet (G-13) |
| `gate.exclusiveItems` | one line per exclusive group per student per session | §3.2 |
| `gate.requiredItems` | a first entry of a subject in a series includes its `required_in_series` items; an award claim includes the award's required units (catalogue) or banked results (F4) | point 2 |
| `gate.priorSeries` | an item that `needs_prior_series` has one, before this session's series and within the board's carry-forward period (F4's `exam_board_rule.carry_forward_months`; a stale option like "November 2025" for a June 2027 Cambridge A2 is refused with the sentence) | the forms' "From June 2026" |
| `gate.grade10Core` | grade 10 in June reserves every `grade10_core` offer | A-05 |
| `gate.schoolFee` | the school fee of the year is paid or waived | as today |
| `deadline.window` | the session is open (or the student's extension) | as today |
| `deadline.boardEntry` | the series' entry deadline — **the hard stop today (MO-10)**; the registry carries the key, gated off by the setting `exceptions.boardEntryDeadline` until the owner answers §17 Q-20 | the owner's point 9 against MO-10 |

**Consent** (`registration_consent`, new): per line, `kind` (`refund_policy`, `declaration`),
`text_version`, `confirmed_by`, `channel` (`app`, `desk`, `school` for grade-10 bulk lines the
school registers, `imported`), `at`. A family's own reservation cannot be submitted without
both; the desk ticks "read and signed by the parent" once for the whole reservation (one row
per line); a grade-10 bulk line's family consents at payment (the checkout asks once). The
printed reservation slip carries the texts (G-20).

### 3.6 Charges (`charge`, new) — services, pushed fees, instalments, adjustments

A charge is anything a family owes that is not a reservation line: `student_id`, `kind`
(`remark`, `cash_in`, `late_cash_in`, `certificate_split`, `school_fee_push`, `instalment`,
`price_adjustment`, `custom`), `registration_id` (when it concerns a line), `board_series_id`
and `board_service_id` (when a board's service and fee apply), `description`, `amount`,
`due_at`, `status` (`requested` — a family's request awaiting staff; `pending_payment`; `paid`;
`cancelled`; `refunded`), `refund_amount`, `created_by`, `reason`. How it is paid, receipted,
reversed and refunded is §3.10.

- **Board services** (`board_service`, new, catalogue): per board, `code`, `label`, `kind`
  (`remark`, `cash_in`, `late_cash_in`, `certificate_split`), `per_component`, `level_rates`
  (IGCSE / AS-A Level), `refund_rule` (`none`, `full`, `less_fixed` with the deduction),
  `requestable_by_family`. Seeded: Cambridge enquiry services 1, 1S, 2, 2S (today's
  `clerical_check` = 1; with `script_copy` = 1S; `review_of_marking` = 2; with a copy = 2S;
  `priority_review` is Pearson's); Pearson's review of marking, clerical re-check, access to
  scripts, cash-in and late cash-in; Oxford's equivalents; certificate split for Cambridge and
  Pearson (Q-17). **Deadlines per series** (`board_service_deadline`: series, service, instant)
  replace `remark_deadline`; a service's fee is a `board_fee` of the series. A remark request
  picks a service of the line's board; its fee becomes a `remark` charge; the existing remark
  states, consent and outcome recording stand, and "fee refunded" becomes a refund of the charge
  for what the rule says (fee − 100 EGP per component for Cambridge, the EAR sheet's rule; Q-21
  asks whether the school passes it on in full).
- **Cash-in, late cash-in, certificate split** (point 3): charges of their kind on a line or a
  student, with the board fee and deadline of the series; the family may request one
  (`requested` until staff accept) where the service allows, or the desk adds it; F4 turns an
  accepted cash-in into the award entry (G-22).
- **School fee pushed** (point 8): the schedule stays the gate's source; "Push to families"
  on the School fees screen creates a `school_fee_push` charge per chosen student (a grade, a
  section, a list) with the due date, skipping a student whose fee is paid or waived, a graduate
  exempt under A-13, and one with an open push (listed). It appears in the family's pending
  payments and is reminded; paying it goes through the **existing** school-fee payment path
  (purpose `school_fee`, its own payment and index), which marks the charge paid.
- **Instalments** (Q-15's default, the owner's): `plan.instalments` (§3.7) turns one unpaid
  line into N `instalment` charges with their dates and amounts summing to the line's price;
  each is paid on its own; the line is confirmed when the last is paid; a drop under a plan
  refunds what was paid by the refund rule. A 09 rule holds the sum and the confirmation.
- **Price adjustment**: finance's explicit act after a fee change or a verification (§3.4,
  §3.5), with a reason, never automatic.

### 3.7 Exceptions (`exception`, reshaped)

An exception lifts one **policy** for one **scope**. `policy_key` (from the registry below),
scope: `student_id` or `family_id` (a parent account: every linked child; one of the two
required) and optionally `session_id`, `subject_id` (any session), `offer_id`, `offer_item_id`,
`registration_id`, `charge_id`, `academic_year`; the value in a typed column (`value_number`,
`value_date`, `value_json` for an instalment schedule; the old `value` column is dropped after
the backfill); `valid_until`, `reason`, `granted_by`, `status` (`active`, `revoked`, `lapsed`,
`used` for one-shot gates). The registry (`@repo/validations`, `POLICIES`) declares for each
key: its label, its sentence, the value type and bounds, the scopes it accepts, whether it is
one-shot, the roles that may grant it, and the hook that applies it.

| Policy key | Lifts | Value | Scopes | Granted by |
|---|---|---|---|---|
| `pricing.selfStudyCoursePercent`, `pricing.selfStudyBoardPercent`, `pricing.retakeTaughtCoursePercent`, `pricing.onePaperCoursePercent` | the percents of §3.4 | percent | student/family × session, subject, offer, item, line | finance admin, admin |
| `price.discountPercent`, `price.discountFixed`, `price.custom` | the line's or charge's price (today's three) | percent, amount, amount | … × line or charge (and session/offer for percent) | finance admin, admin |
| `refund.percent` | the refund policy's step (today's custom refund) | percent | … × session, offer, line | finance admin, admin |
| `refund.courseStart` | the anchor for this student's line (joined late) | date | … × offer, line | finance admin, admin |
| `deadline.window` | the session's closing (today's extension; MO-12's "no session = every session" kept) | date | … × session | finance admin, admin |
| `deadline.payment` | a line's or charge's due date | date | … × session, line, charge | finance admin, admin |
| `deadline.boardEntry` | the series' entry deadline (**gated off** until Q-20) | date | … × line | admin |
| `gate.schoolFee` | the fee gate (today's waiver) | — | … × academic year | finance admin, admin |
| `gate.selfStudyFirstEntry` (one-shot) | self-study on a first entry | — | … × offer, item, line | finance admin, admin |
| `gate.availability` (one-shot) | reserve an item not open to them (retake-only, closed) | — | … × item | admin, coordinator |
| `gate.requiredItems` (one-shot) | a first entry without a required item | — | … × offer | admin, coordinator |
| `gate.priorSeries` (one-shot) | an item needing a prior sitting without one, or outside the carry-forward period | — | … × line | admin, coordinator |
| `gate.exclusiveItems` (one-shot) | two items of one exclusive group | — | … × offer | admin, coordinator |
| `gate.grade10Core` | grade 10 without a core subject | — | … × session | admin, coordinator |
| `eligibility.grade10OtherSeries` | today's grade-10 exception | — | … × session | coordinator, admin |
| `plan.instalments` | one payment per line | schedule (dates, amounts) | … × line | finance admin, admin |

The existing **eight** types map onto keys in the migration (`discount_percent` →
`price.discountPercent`, `discount_fixed` → `price.discountFixed`, `custom_price` →
`price.custom`, `fee_waiver` → `gate.schoolFee`, `deadline_extension` and `late_registration` →
`deadline.window`, `custom_refund_percent` → `refund.percent`, `grade10_other_series` →
`eligibility.grade10OtherSeries`; a subject scope without a session → `subject_id`); every hook
that reads an exception today reads the same rows through the registry. The screen: pick the
student or family (or open it from the Student 360 or a line), pick the policy (grouped: price,
refund, deadlines, gates, plans), the scope narrows itself to what the policy accepts, the
sentence previews, a reason, grant. The Student 360 and every line show the exceptions that
touched them.

### 3.8 Messages and reminders

**Audience** (`message_audience`, new): `kind` (`broadcast`: all, parents, students, a grade,
**parents of a grade**; `batch`: a saved list — the families of a session's unpaid lines or
charges, a section, a teaching group, the reservers of an offer, the holders of a charge kind;
`direct`: chosen users), the definition (json), `resolved_count`. **Message** (`message`, new):
`audience_id`, `template_id` or title and body with variables (`{guardian}`, `{student}`,
`{session}`, `{amount}`, `{due}`, `{closes}`), channels (`in_app`, `email`; `whatsapp` reserved,
no sender until the school has a business account), `scheduled_at`, `status`, `created_by`.
Each send writes the existing `notification` rows (so nothing a family sees changes) and a
`message_delivery` row per recipient and channel (`queued`, `sent`, `failed`, with the error).
Families mark read; nobody deletes (as today). **Templates** (`message_template`): the
school's texts in English and Arabic.

**Reminder rules** (`reminder_rule`, new): `kind` (`payment_due` for lines and charges,
`session_closing`, `entry_deadline` (staff), `school_fee_due`, `declared_retakes_to_verify`
(staff)), `offsets_days` (−7, −3, 0, +3, +7), `repeat_every_days` and `until` (`paid`,
`closed`, `deadline`, `verified`), `channels`, `session_id` (null: every session; a session's
own rule overrides), `active`. **`reminder_sent`** (claim table: rule, target, offset, sent at)
so two scheduler instances send once (ST-06, ST-12). The scheduler tick (the existing job) runs
due reminders and writes messages with audience `batch`. Defaults seeded as settings.

### 3.9 What is removed or kept

| Today | After |
|---|---|
| `registration_session.qualification_level`, typed `name`, one active per (type, level) | nullable and unread for one release; derived; one active per (type, year, label) |
| `session_subject_series` (subject routes) | emptied, kept one release; replaced by `session_offer_item.board_series_id`; the routing trigger rewritten |
| `session_board_series` | kept, derived (§3.3) |
| `subject.is_core`, `is_offered_at_school`, `course_fee`, `registration_fee`, `price_in_school`, `custom_price` | `is_core` → `session_offer.grade10_core`; `is_offered_at_school` → the offer's availability; fees → `session_offer(.item).course_fee` and `board_fee`; the subject's columns stay read-only for history |
| `subject_teacher` | kept as the pool |
| `refund_window` (absolute dates) | kept and gains an `offer_id` scope (the one-scope check becomes session xor year xor offer); a session with a `refund_policy` materialises its windows from it (and per offer with a different start), the refund service's computation unchanged; windows of a converted session or an academic year stay as they are |
| `exception` types and `value` | reshaped onto the registry with typed value columns (§3.7) |
| `remark_fee_schedule`, `remark_deadline` | `board_service`, `board_fee` (kind service) per series, `board_service_deadline` per series; the old tables kept one release as the defaults a new series copies; the remark request's states unchanged |
| `scheduled_announcement`, broadcast groups | `message` with audiences; the old rows migrate as broadcasts |
| `computeRegistrationPricing` | `priceLine` |
| `registration.subject_id` | kept; `offer_item_id` added |
| payments, escrow, receipts, takings, reversals, withdrawals, the held wallet | changed only as §3.10 says |

### 3.10 What changes in the money core, and what does not

The 09 invariants and the services are written over registration lines (`payment_registration`),
school-fee payments (purpose `school_fee`, one per year) and remark payments (purpose `remark`,
`metadata.remarkRequestId`, **not reversible today** — `payment.services.ts` 1510). A charge is
new money, so these four things change, and nothing else:

1. **One purpose per payment, never mixed.** A payment covers registration lines (as today) or
   charges (`purpose = 'charge'`, `payment_charge` rows) or the school fee (as today). The
   checkout and the desk show one payment per group — lines per entry deadline (F0b), charges
   per service deadline, the school fee — and the desk collects all of them in one action that
   creates several payments, as the deadline split does today. 09's "a registration payment
   charges exactly the price of what it covers" stands unchanged; a new rule says the same for
   a charge payment over `payment_charge`; "no line paid twice" gains its twin for charges;
   every charge payment has one creation row (`CHARGE_PAYMENT_INITIATED`).
2. **A receipt per charge.** `receipt.registration_id` becomes nullable and `receipt.charge_id`
   is added, exactly one of the two (check), unique per charge; the receipt's lifecycle (handed
   over, brought back, lost, void) and its tests apply as they are. Today's remark fees have
   no receipt; new remark charges get one.
3. **A charge payment is reversible and a charge refundable.** Reversal follows the registration
   payment's path and MO-11 (did the money go back); the charge returns to `pending_payment`,
   its receipt voided. A refund (a remark that changed the grade; a cash-in withdrawn before
   the board's date; a price adjustment) credits escrow with reason `charge_refund`, at most
   the charge's amount (09), audited in the transaction, by finance with a reason, and marks the
   charge `refunded`.
4. **The sweep covers charges.** A charge tied to a board series (remark, cash-in, late
   cash-in) is closed unpaid at its **service deadline** (`board_service_deadline`), its open
   payment failed with escrow back, the family told — the same clean-up a line gets at its
   entry deadline; an `instalment` charge follows its line's series.

Untouched: escrow's ledger and balances, the held wallet and capture, takings (a charge payment
is a payment on its day; a charge refund is money out when paid from the drawer or an escrow
credit otherwise), reversal maker-checker, cash refunds' hand-over, MO-10 for lines, MO-21,
MO-24, the receipt lifecycle. **Money assertions that change** (each pre-authorised with a
trail row, the money outcome asserted anew): the remark refund in `03-v3-flows.test.ts` (an
escrow of 1,600 after a refunded fee becomes the fee less the deduction, under the EAR sheet's
rule — or stays, per Q-21); the outside-school prices in 08 where A-16 halves the course fee
only; input shapes (`subjectIds` → `lines`, a window's level).

---

## 4. The screens

Each with the form or sheet it replaces, then ours. The prototype (§13) is the clickable
version for the owner; the build follows this document.

### 4.1 Sessions (`/admin/sessions`)

```
Sessions                                            [ New session ▾ ]  June · Winter
──────────────────────────────────────────────────────────────────────────────────
June 2027      open   reserve 15 Sep 26 – 15 Feb 27   course starts 20 Sep 26   due 30 Nov 26
               25 subjects · 3 boards · deadlines: Cambridge 20 Feb ✓ Pearson 25 Feb ✓ Oxford — ⚠
               412 lines · 318 paid · 94 unpaid (EGP 1,240,500 outstanding)   [ Open ] [ Money ]
November 2026 – January 2027   open  …
```

New session: **type**, **year**, **reserve from**, **reserve to**, **course starts**, **payment
due** — six inputs (today's form also has six, but makes one window of one level); the name,
the refund policy and the series follow. "Copy from June 2026" is offered when a session of the
kind exists: offers, teachers, items, availability and course fees come across; board fees come
across **provisional**.

### 4.2 Session (`/admin/sessions/<id>`) — the links sheet

```
June 2027   open · reserve 15 Sep – 15 Feb · course starts 20 Sep · due 30 Nov   [ Edit ] [ Close ]
Deadlines: Cambridge June 2027 20 Feb 2027 · Pearson Edexcel June 2027 25 Feb · Oxford June 2027 ⚠ not set
[ Subjects ] [ Fees ] [ Money ] [ Grade 10 ] [ To verify ]                 [ + Add subject ] [ Copy from… ]
O.L.
┌──────────────────────────┬───────────┬──────────────────────────┬──────────────────────┬───────────┬─────────┐
│ Subject                  │ Board     │ Teachers                 │ What can be entered   │ Course fee│ Board   │
├──────────────────────────┼───────────┼──────────────────────────┼──────────────────────┼───────────┼─────────┤
│ Arabic O.L.              │ Cambridge │ T1 · T2 · T3             │ whole · Paper 1 · Paper 2 (retake) │ 12,000 │ 9,850 ⓟ │
│ Biology O.L.             │ Cambridge │ T4 · T5 · T6             │ whole · Paper 4 only (retake)      │ 14,000 │ 10,850 ⓟ│
│ Computer Science O.L.    │ Cambridge │ External team            │ whole · Paper 4 only │ …         │ 9,850 ⓟ │
│ Global Perspectives O.L. │ Cambridge │ T7 (online)              │ whole                 │ …         │ ⚠ no fee│
│ Mathematics O.L.         │ Edexcel   │ T8 · T9 · T10            │ whole · 1H · 2H       │ …         │ 4,600×2 │
A.S. / A.L.
│ Mathematics A.S./A.L.    │ Edexcel IAL│ per unit                │ P1 T11 online · P2 T11 online · P3 · P4 · M1 T12/T11 · S1 … │
│ Physics A.S./A.L.        │ Cambridge │ T13                      │ AS (in school) · A2 carry-forward (self-study only) · A Level │
│ Biology A.S./A.L.        │ Edexcel IAL│ T14                     │ Papers 5, 6 (first entry) · Papers 1–4 (self-study only) │
└──────────────────────────┴───────────┴──────────────────────────┴──────────────────────┴───────────┴─────────┘
ⓟ provisional: copied from June 2026; confirm on the Fees tab when the board publishes
```

A row opens in a drawer: availability, teachers (with mode or provider), the items (generated;
tick which are open; a per-item teacher, series, fee, availability, exclusive group and
required flag where they differ), course fee, course start override, grade-10 core, notes.
Adding a subject: search the catalogue (an unmapped A Level row is offered with one item and
flagged "map on the Catalogue"), the board and the items come from the catalogue, the teachers
from the pool; three inputs for an IGCSE subject (subject, teachers, course fee). An offer or
item with lines cannot be closed or unticked silently: closing an offer stops new lines (its
lines stand); unticking an item with live lines is refused until they are moved or dropped,
like a series with entries. "Replace teacher" on an offer moves every line and group of a
teacher who leaves to another, audited.

**Fees** tab: one grid per attached series (the PDF's shape: code, title, amount, provisional
mark), paste or type, "copy from Cambridge June 2026" (every row provisional), "Confirm" per
row or grid, "Re-price unpaid lines" when a confirmed amount differs; the board services
beside them. **Money** tab (§4.6). **Grade 10** tab: the core offers ticked; "Register grade
10" previews every grade-10 student's lines and commits them once (A-15, Q-10): lines
`pending_payment`, consent channel `school`, teacher the offer's only one or none until F1's
section timetable assigns one. **To verify** tab: declared retakes awaiting a check (§3.5).

### 4.3 Reserve at the desk (`/desk`, the existing desk, reshaped)

```
Student  [ Student A 11C ▾ ]     Session [ June 2027 ▾ ]      Reserved so far: 2 lines, 1 unpaid
O.L.                                                     teacher          entry                 price
☑ Biology O.L.  (Cambridge)        whole subject       [ T4 ▾ ]         [ first entry ▾ ]     24,850
☐   Paper 4 only (retake)                              —                 [ retake, self-study ] from [ June 2026 ▾ ]
☑ Mathematics O.L. (Edexcel)       whole subject       [ — self-study ] [ retake, self-study ] 16,200  ← sat June 2026
☐ Chemistry O.L.  …
A.S. / A.L.
☑ Mathematics A.S./A.L. (IAL)      P1 [ T11 (online) ▾ ] first entry 9,800 · P2 [ T11 ▾ ] 9,800 · ☐ P3 · ☐ P4 · ☑ M1 [ T12 ▾ ] 9,450 · ☐ S1
──────────────────────────────────────────────────────────────────────────────────────────────────
5 lines · EGP 70,100 · due 30 Nov 2026 · paid per entry deadline: Cambridge 24,850 · Pearson 45,250
☑ Refund policy and declaration read and signed by the parent
[ Reserve only ]   [ Reserve and collect: cash ▾  escrow 0  → EGP 70,100 ]
```

A retake is **pre-set** when the system knows the earlier sitting; for a family new to the
system the officer chooses "retake" and names the sitting (`declared_by_desk`, audited, listed
to verify); self-study on a first entry needs an exception. A teacher defaults when the offer
has one. The price shown is the price charged, exceptions included (today's desk shows the
price before exceptions, §15); a provisional board fee is marked. The slip prints with the
consent texts. One action creates the lines and, with "collect", the payments per entry
deadline and per charge group (§3.10), as today's split.

### 4.4 Reserve in the app (`/register`)

The same page for the family: child (parents), session, the offers in the school's vocabulary,
items with teacher and entry — **a retake the system does not know is declared with its
sitting, as on the form**, and marked "to be verified by the school" — the total, the two
consent boxes, submit → lines awaiting payment (a student's request waits for the parent as
today) → checkout by series as today. The "Grade Level & Class", the guardian block and the
seven identity questions are gone: the system knows them.

### 4.5 Statement (`/statement`, per child and per family; on the Student 360)

```
June 2027 — Student A (11C)                                           [ Family statement ]
Line                                   price     paid      outstanding   due        receipt
Biology O.L. — whole, first entry      24,850    24,850    0             —          #1042 (12 Oct)
Mathematics O.L. — whole, retake SS    16,200    0         16,200        30 Nov     —   (board fee provisional)
Mathematics IAL — P1 (T11, online)      9,800    9,800     0             —          #1043
Remark: Chemistry O.L. June 2026, service 2   3,820   3,820   0   —   #1051 (refund 3,720 to escrow 2 Sep)
School fee 2026/27                     30,000    30,000    0             —          #0988
Payments: 12 Oct cash 34,650 (#1042–1043) · 5 Sep InstaPay 30,000 (#0988) · Escrow: 3,720 free
```

Every number is from the ledger; the new columns are `due_at`, the pricing basis (hover:
"course 14,000 × 50% + board 9,200 × 100%") and the receipt per charge.

### 4.6 Money (on the session)

Lines and charges by status with the family, the amount, the due date and days overdue;
filters (unpaid, overdue, by offer, by section, provisional); "Remind" sends the payment
reminder to the selected families now (a batch audience); export. The finance workbench,
takings and receipts are unchanged.

### 4.7 Exceptions (`/admin/exceptions`)

Student or family → policy (grouped) → scope (narrowed by the policy) → value → the sentence →
reason → grant. The list shows active, lapsed, revoked, used; each line of the Student 360 shows
the exceptions applied to it.

### 4.8 Messages and reminders (`/admin/messages`)

New message: audience (broadcast · batch from a list · direct, with the resolved count),
template or free text with variables, channels, now or scheduled; the log shows deliveries per
recipient. Reminders: the rules per kind with offsets and repeat, per session overrides, and what
went out.

---

## 5. Endpoints (new or changed)

| Endpoint | Principals | Notes |
|---|---|---|
| `POST /v1/sessions` `{ type, year, startDate, endDate, courseStartsOn, paymentDueAt, copyFromSessionId? }` | admin | derives name, refund policy; copies offers |
| `GET/PUT /v1/sessions/:id` | admin (coordinator, finance read) | the session header |
| `GET /v1/sessions/:id/offers`, `POST`, `PUT /offers/:offerId`, `POST /offers/:offerId/replace-teacher`, `DELETE` (no lines) | admin, coordinator | an offer with its teachers and items; attaches series by item |
| `PUT /v1/sessions/:id/offers/:offerId/items/:itemId` | admin, coordinator | series, availability, fee, teachers, required, group |
| `GET /v1/sessions/:id/money`, `GET /v1/sessions/:id/to-verify`, `POST /v1/registrations/:id/verify-prior` | admin, finance (verify: admin, coordinator, finance desk) | §4.6, §3.5 |
| `POST /v1/sessions/:id/grade10/preview`, `/commit` | admin, coordinator | A-15 |
| `GET/PUT /v1/board-fees?seriesId=`, `POST /v1/board-fees/:seriesId/confirm`, `POST /v1/board-fees/:seriesId/reprice` | admin, finance admin (coordinator read) | the fee grid, §3.4 |
| `GET /v1/registrations/offers?studentId&sessionId` | the student, a linked parent, staff with student records | replaces `/available`: offers and items with the student's known sittings, teachers and prices per attempt and mode |
| `POST /v1/registrations/request`, `/direct`, `/desk`, `/admin-override`, `/preregister` | as today | body: `lines: [{ offerItemId, attempt, mode, teacherId?, priorSittingSeriesId? }]`, `consent: { refundPolicy, declaration }` |
| `PUT /v1/registrations/:id/teacher` `{ teacherId, reason }` | admin, coordinator, finance desk | point 10 |
| `GET /v1/statement?studentId` / `?familyId` | the student, a linked parent, staff with student records | §4.5 |
| `GET/POST /v1/charges`, `POST /:id/accept`, `/cancel`, `/refund` | finance, admin; a family POSTs a `requested` charge for a requestable service and reads its own | §3.6, §3.10 |
| `POST /v1/school-fees/push` `{ academicYear, grade?, sectionId?, studentIds?, dueAt }` | finance admin, admin | §3.6 |
| `GET /v1/board-services`, `PUT /v1/board-services/:id`, `PUT /v1/board-services/deadlines` | admin, coordinator (families read) | the catalogue of services and their deadlines per series |
| `POST /v1/exceptions` `{ policyKey, studentId | familyId, scope, value?, validUntil?, reason }` | per the registry | §3.7 |
| `GET /v1/policies` | staff | the registry with sentences |
| `GET/POST /v1/messages`, `/audiences/resolve`, `/templates`, `/deliveries` | admin (finance for payment batches) | §3.8 |
| `GET/PUT /v1/reminders/rules`, `GET /v1/reminders/sent` | admin, finance admin | §3.8 |

Every new endpoint gets its row in `authz-policy.tsv`; every id belonging to a family gets a
cross-family case in 05. Removed from the admin's path: `PUT /v1/sessions/:id/board-series`
(the attach is by item); `POST …/board-series/move` stays admin-only behind the item's series
change; `/registrations/available` is replaced.

---

## 6. Where the policies are applied (the hooks), and the locks

| Hook | Called by | Reads |
|---|---|---|
| `priceLine(item, attempt, mode, student, session)` | every path that creates or re-prices a line (request, direct, desk, override, preregistration, swap, re-price) | `board_fee`, the offer's fees, the pricing settings, the student's and family's active price exceptions |
| `assertLineRules(tx, student, session, lines)` | the same paths, inside the transaction after `assertMayRegisterForInTx` | availability, self-study gate, declared retake, exclusive groups, required items, prior series and the board's carry-forward period, grade-10 core, the gate exceptions (each marked `used` when one-shot) |
| `refundPercentFor(line, at)` | drops, swaps, cancellations | the line's `refund_policy_snapshot` (its anchor by §3.1's precedence), `refund.percent` and `refund.courseStart` exceptions |
| `dueDateFor(line | charge)` | line and charge creation, the statement, reminders | the session's `payment_due_at`, `payment.graceDays`, `deadline.payment` exceptions, never after the series' or service's deadline |
| `sessionWindow(student, session, seriesId)` | as today | `deadline.window` exceptions; `deadline.boardEntry` only when the setting is on |
| `schoolFeeGateReason` | as today | `gate.schoolFee` exceptions |
| `chargeRules(tx, charge)` | charge creation, acceptance, payment | the service's deadline, `price.*` exceptions scoped to the charge |

**Locks**, in F0b's order and then the rework's: the session (window) `FOR SHARE` (`FOR UPDATE`
for a change to its offers' series), the series `FOR SHARE`, the subject's board `FOR SHARE`,
then the offer and the item `FOR SHARE` (a close of an offer, an untick of an item, a change of
its series, teachers or fee key take them `FOR UPDATE`), the fee rows the price reads
`FOR SHARE` (a confirm or a re-price takes them `FOR UPDATE`), the student's and family's
exceptions `FOR SHARE` (a grant or a revocation `FOR UPDATE`), and F0a's student and window
rows as today. Writers take the same rows in the same order, so a reservation and any of these
changes run one after the other; a revocation re-checks what rested on the exception (a used
one-shot gate stays used).

---

## 7. Migration (the protocol of FEATURES_PLAN.md §3)

Generated migrations on top of main's journal (0041 is free on main; the frozen branches'
0041–0043 are theirs to regenerate when they resume), with custom backfills:

1. **Structure**: the new tables (§3.2, §3.4, §3.5 consent, §3.6, §3.7's typed value columns,
   §3.8), the new columns, the relaxed uniqueness on sessions, `receipt.charge_id` with its
   check, `refund_window.offer_id` with its three-way scope check, the new partial unique index
   on lines (created after the backfill), the routing trigger rewritten to read the line's item.
2. **Backfill, idempotent**, one rule per row kind:
   - **Windows → sessions.** `june` stays `june`; `october` and `november` become `winter` of
     their year; `january` becomes `winter` of the year before. **Every converted window keeps
     a label** = its old type and level (`june-igcse`, `october-as_level`, `january-a_level`), so
     no two collide and nothing is merged; the derived name appends it ("June 2027 — IGCSE").
     `course_starts_on` = the window's start, `payment_due_at` = its end, `refund_policy` null
     (its absolute refund windows stay and are read as today), the old name kept in
     `edit_history`, the level column left as it was.
   - **Subjects → offers.** For every window (any status): an offer for every subject that has
     a line in it (any status) and for every active subject at its level; availability `open`
     for an open window, `closed` for a closed window or an inactive subject; `course_fee` =
     `subject.course_fee`; `grade10_core` = `subject.is_core`; teachers = the subject's linked
     teachers (`in_school`); a subject not offered at school → `self_study_only`; one item
     "whole subject" entering what the row maps to (the row itself when unmapped), in the series
     the window's route or default gave (null when the window fed none); a `board_fee` row per
     (series, the item's key) = `subject.registration_fee`, **confirmed** (it was the price).
   - **Lines.** Every line (any status) gets its window's offer's item; `attempt` = `retake` when
     `is_retake` else `first`; `mode` = `self_study` when `taken_outside_school` else
     `in_school`; `prior_sitting_source` = `known` with the earliest earlier line's series when
     one exists, else null (a converted retake with no history keeps `attempt = retake`, flagged
     `legacy`); `due_at` = the window's end; `pricing_basis` null; `refund_policy_snapshot` null
     (the window's absolute windows apply).
   - **Exceptions.** All eight types mapped as §3.7; `value` → `value_number`; a subject scope
     without a session → `subject_id`.
   - **Refund windows.** Kept as they are (session or year scope).
   - **Remark fees and deadlines.** `remark_fee_schedule` rows become `board_service` defaults;
     for every series that is open or future at migration time, a `board_fee` (kind service)
     per (board, service) from the schedule; `remark_deadline` rows (per council and window)
     become `board_service_deadline` rows on each series the window feeds of that board.
     Existing remark requests get no charge; their fee fields stay and the statement reads them.
   - **Announcements.** `scheduled_announcement` rows become messages with a broadcast audience.
   - Each converted row is audited once (`REWORK_BACKFILL_*`); a window with lines and no
     offer for one of them fails the migration naming it.
3. **Kept one release, then dropped** (a later migration, after the first live cycle):
   `registration_session.qualification_level`, `session_subject_series`, `exception.value`,
   `remark_fee_schedule`, `remark_deadline`, `scheduled_announcement`.

Proven as F0b's was: on a copy of the template dev data, on F0a's richer copy, and on **the
synthetic school shapes** F0b used (`igcse_catalogue_synth`, `_synth_closed`), before and after
dumps in `.audit/rework-evidence/`: every line keeps its price, series, payment and status;
every waiting line's `mayRegisterFor` answer is the same before and after; 09 green over the
converted rows. The structure migration is reversible (nothing is dropped until step 3).

---

## 8. Tests (the proof)

New suites `08n-session-offers`, `08o-reservation-lines`, `08p-pricing-policies`,
`08q-charges`, `08r-exceptions-registry`, `08s-messages-reminders`, `08t-rework-races`, cases in
04 (authz) and 05 (cross-family), rules in 09. Scenarios the forms and the review dictate:

| Scenario | From |
|---|---|
| a June session copied from the previous June: offers, teachers, items; board fees provisional; the derived name; Oxford's series created when an item lands in it, with the warning; a session with no predecessor set up from scratch | §4.1, G-29 |
| a Pearson IAL subject with units in October and January of one winter session; an IGCSE item refused in October and January; MO-10 closes each unit's lines at its own deadline; A-12 lets a graduate reserve the winter | SCHOOL_FORMS.md §2.4, flag 9 |
| Biology IAL: papers 5 and 6 first entry, papers 1–4 self-study only; a first entry on paper 1 refused; a retake self-study on paper 1 at 50% course and 100% board; a per-unit teacher reaching the enrolment and the group | §2.3 row 2, A-16, flag 4 |
| Cambridge Physics: AS in school; A2 carry-forward self-study only, needing the carried series within the board's period (November 2025 refused for June 2027); A Level; the three prices from the fee grid; AS and A Level in one sitting refused together | §2.3 row 7, §3.1, flag 15 |
| Arabic Edexcel: two items of two qualifications, the teacher choosing the item; the two refused together | §2.3 row 1, Q-16 |
| a one-paper retake (Paper 4 only, from June 2026) at its own course fee and the qualification's board fee; refused with the whole subject; Edexcel 1H without a prior series | §2.2, Q-13 |
| self-study on a first entry refused; granted by `gate.selfStudyFirstEntry`; the exception used once; a subject the school does not teach needs none | G-09 |
| a family declares a retake with its sitting; the line priced as a retake; staff verify; a rejected declaration re-prices the line and tells the family; the desk declares one | flag 6 |
| a required item missing refused; granted by exception | point 2 |
| a retake known from an earlier line and from an F4 result; `retake` in school at 100% | §2.5 |
| the teacher changed on a paid line: the enrolment and the group move, the price does not; "replace teacher" on an offer moves every line | point 10, flag 19 |
| a provisional board fee: reserved, not payable; confirmed higher: unpaid lines re-priced and the family told; a paid line untouched, a price adjustment charge by finance | flag 3 |
| a drop at week 3 of June refunds 50% of the course fee and the board fee by Q-19's default; at week 7 of winter 0%; an offer starting later than the session shifts its windows; `refund.courseStart` moves one student's; a group's first lesson anchors it when F1 knows it; the policy frozen on a line after consent | G-19, flag 2 |
| consent required in the app, ticked once at the desk; a grade-10 bulk line's family consents at checkout; a swap inherits it; a line without consent cannot be confirmed | G-20 |
| a cash-in charge requested by the family, accepted, paid in its own payment beside a line's payment in one desk action; its receipt; reversed (MO-11); refunded before the board's date, capped; closed unpaid at the service deadline | §3.6, §3.10 |
| a Cambridge remark priced per component at the AS rate from the fee grid; the grade changes; the refund of fee − 100 to escrow (Q-21) | SCHOOL_FORMS.md §3.3 |
| a pushed school fee for a grade: skipped for a paid, a waived and an A-13 graduate; paid through the school-fee path; the push marked paid | §3.6, flag 11 |
| an instalment plan: three charges summing to the line; the line confirmed at the last; a drop in between refunds what was paid | Q-15 |
| grade 10 registered in bulk; a second commit changes nothing; a grade-10 family's own reservation must include the core offers | A-15 |
| a due date past the series' deadline refused; `deadline.payment` moves one family's; a line reserved after the due date gets the grace; `payment.expireOverdueAfterDays` on | §3.1, flag 16 |
| a payment reminder sent at −7, −3, 0, +3, repeating until paid; two scheduler instances send once; the delivery log; parents of grade 11 as an audience | §3.8 |
| a batch message to a session's unpaid families; a direct message; families cannot delete | §3.8 |
| the migration on the three databases: prices, series, payments, statuses and eligibility unchanged; 09 green | §7 |
| races: two desks reserving one item for one student; an item's series changed while a checkout is open (refused, as F0b); an item closed or its teacher removed mid-reservation; a fee confirmed while a line is being priced; an exception revoked while a line relies on it | §6 |

09 adds: every live line has an item of its offer and a series of its item; every line with a
basis has its price equal to it; a charge payment charges exactly the sum of its charges; no
charge is paid twice and every paid charge once; a charge's refund never exceeds it; a line
under an instalment plan is confirmed only when its instalments sum to its price and are all
paid; every confirmed line created after the rework has its two consents; every one-shot gate
exception is used at most once; every reminder sent has its claim row; every charge payment
has one creation row.

---

## 9. Build order (Phase 3), two or three agents at most

| Step | Agent | Delivers | Depends on |
|---|---|---|---|
| 1 | **A — Sessions, offers, fees** | §3.1–§3.4, the migration (§7), the Sessions and Session screens with the Fees and Grade 10 tabs, `priceLine`, `/offers` for families (read), the pricing settings, the enrolment's unit dimension (§10); 08n, 08p, the conversion proof | — |
| 2 | **B — Reservations** | §3.5, consent, declared retakes and the verify list, the teacher change and replace, the desk and the family's Reserve pages, the Statement (child and family), the Money tab; 08o; the F0b money assertions re-shaped | A's contract: `session_offer_item`, `priceLine`, `/offers` |
| 2 | **C — Money changes, charges, exceptions** | §3.10, §3.6, §3.7, the registry and hooks (§6), the Exceptions screen, board services and deadlines, the remark fee as a charge, the school-fee push, instalments; 08q, 08r | A's `priceLine` signature; B calls the hooks (a contract agreed in writing before B and C start) |
| 3 | **D — Messages and reminders** | §3.8, the Messages screen, the scheduler step; 08s | B's lines and C's charges for the batch audiences |
| 4 | the lead | the end-to-end check on one running system, the step counts of §11 measured, the UI audit of these screens, the walkthrough regenerated (F8) | all |

Each step: one Opus 5.5 implementer, one Opus 5.5 reviewer, the lead's review on a running
system, merge on green (FEATURES_PLAN.md §4, §5 apply unchanged: Hono RPC, the audit row in the
transaction, row locks, `authz-policy.tsv`, 05, 09, trail rows through `scripts/trail-row.py`).
A's contract is published in `docs/features/RESERVATIONS.md` §"Contracts" before B and C start;
B and C run in parallel on their own worktrees, branches and databases.

**The frozen work after step 2** — what each must change, read from its own document:

- **F1 (scheduling)**: `course_enrolment` gains `unit_id` (nullable; one open row per student,
  subject, unit, year); `getTeachingDemand` groups per (subject, unit, teacher) — P1 online and
  M1 are two classes; a group gains `delivery` (`in_school` / `online`) from the offer's teacher
  mode; an external provider's group has no timetable lessons. Its open review flags are fixed
  on the rebased branch.
- **F4 (exam entries)**: entries derive from `lineItemsFor` (the item says what it enters, the
  option code with it); retake from `attempt` and history; carry forward from the line's
  verified prior sitting (the suggest-and-confirm flow applies only to a line without one;
  `exams.carryForward` keeps its meaning there); `exam_entry.charge_id` for a cash-in;
  `teacherOf(student, subject, unit?, year)`; a declared, unverified sitting is listed by the
  entry check; F4's verification of a result against a declared sitting closes it.
- **F7 (import)**: sheet rows map to offers and items (`findOffer`, `findItem`); the fee note to
  `attempt` and `mode`; prices from the fee grids at import time, **provisional where a grid
  has no row** — never 0 (MO-9).
- **F2 (campus leave)**: independent of the session model; resumes after F1.
- The preview branch and the walkthrough are rebuilt last (F8).

---

## 10. Contracts

| For | Contract |
|---|---|
| F1 | `getTeachingDemand(academicYearId)`: per (subject, unit, teacher) with `delivery`; a line's teacher (or its change or replacement) reaches the group through `upsertEnrolments(source: 'registrations')` with the unit |
| F4 | `lineItemsFor(registrationIds)`: per line the item, what it enters (unit ids, option or award), the series, `attempt`, `mode`, the prior sitting with its source and verification, the student's grade and level code; replaces `entryItemsFor`; `chargesOfKind('cash_in', seriesId)` for award entries |
| F5 | unchanged (the catalogue) |
| F7 | `findOffer(sessionId, term)`, `findItem(offerId, label)`, `priceLine` with provisional fees, `attempt`/`mode` from the sheet's fee note, consent channel `imported` |
| F8 | the demo school script seeds a June and a winter session from a fixture shaped like SCHOOL_FORMS.md §2 |

---

## 11. The step counts (UX_AUDIT.md §4), honestly

The school's own process is the baseline (the forms and the sheet), then today's system (the
survey, §15), then this design. The design's numbers are counted on the prototype and will be
measured on the running system before Phase 3 closes.

| Task | The school today | Our system today (§15) | This design |
|---|---|---|---|
| Open a June cycle with 25 subjects, their teachers and fees | build or copy-edit 25 Google Forms (about 12 questions each; the series left wrong on one), type the links sheet, print two fee PDFs | **three windows** (one per level), each with its series panel and deadlines, then every subject created and its teachers linked one modal at a time: **162–237 inputs, 127–152 clicks**, seven things to remember; no screen shows the session's subjects with teachers and fees | New session: 6 inputs, 1 click. With a predecessor: "Copy": 1 click, then per changed subject 1–3 inputs. From scratch: per subject 3 inputs (subject, teachers, course fee) and 2 clicks, 75 inputs and 50 clicks for 25. Fees: one paste per series (3) and one confirm each when published. Deadlines: 1 date and 1 reason per series on the Board series page (6 inputs, 3 clicks), as today. **Total from scratch: about 90 inputs and 60 clicks; with a predecessor, about 20 and 10.** One screen is the links sheet |
| A family reserves three subjects, one a self-study retake | three forms, 7 identity questions each, plus the subject's 2–4 choices and 3 consents: about 35 answers | the family: 4 steps on one page; **a walk-in family's retake cannot be set** (retake is derived from history only; the officer needs an exception first) | one page: 3 ticks, 1 teacher pick where the offer has several, the retake pre-set or declared with its sitting (1 pick), 2 consents: **6–8 answers** |
| The desk takes the family's money for them | read the sheet, write the fee note, write a paper receipt | onboard (7 inputs), find the student again, register (5–6 inputs), collect: **13–16 inputs, 5–6 clicks** plus a hand-over per receipt; the price shown omits exceptions | onboarding as today (7), then the same page: picks as above, 1 consent tick, "Reserve and collect" with the instrument: **about 12 inputs, 4 clicks**, receipts printed; the price shown is the price charged |
| Know who has paid | the sheet against the receipt book | the finance workbench (pending only) and the Student 360 one student at a time; nothing per session | the session's Money tab |
| Lift a rule for one family | a note in the sheet ("Self Study 20%") | 6–8 inputs, 1 click, one of eight types; the subject list mixes every level; self-study on a first entry has no type at all | one exception: student or family, policy, scope, value, reason: 5–6 inputs, 1 click; every policy |
| Set the refund windows | the policy text on the form | **15–18 inputs, 3 clicks** per session, on the School fees page, absolute dates typed, the form resetting after each row, ends at UTC midnight, no edit | copied from the type's policy at creation; one date (course start) |
| Remind unpaid families | by hand | not possible (one 24-hour closing reminder); "parents of grade 11" cannot be targeted | a rule once; or "Remind" on the Money tab; any list as an audience |

---

## 12. Decisions and why

- **One session per cycle, levels per subject.** The forms have one cycle; the school's windows
  per level were ours. F0a's eligibility and F0b's series rules read the session's academic year
  and kind, which one cycle has; the two type lists learn `winter`.
- **Items, not more subject rows.** The sheet registers units as rows (IS-01) and F0b made rows
  of them; the forms show the family one subject with its units under it. The line keeps the
  parent subject for the ledger's readers and adds the item for the board; a unit row that
  exists today stays a subject with one item.
- **Attempt and mode apart.** The form's five options are two facts: first or retake, taught
  or self-study. Storing them apart keeps a self-study first entry (not taught here, or by
  exception) from being entered with the board as a re-sit (F4).
- **Trust and verify the family's retake.** The form trusts "ONLY 2nd entry"; the system has no
  history on day one and the winter cycle is mostly re-sits; so the family declares the sitting
  and staff verify, as the desk checks the sheet today.
- **Board series attached by item, never assembled.** The admin called them confusing and
  redundant. They remain the hard stop's home (MO-10) and F0b's rules stay true; only the hand
  assembly goes, and nothing is attached that no item uses.
- **Fees per unit per series, provisional until published.** The fee lists are per series and
  differ per series for the same unit; the school opens nine months before the boards publish.
- **The 50% on the course fee by default, the board fee whole.** The forms say "School fees";
  A-16; a setting either way; Q-12 to the admin.
- **The refund percentage on the course fee; the board fee by its own rule.** The forms say
  "100% of the Course fees"; the board fee is money the school passes on, refundable while it
  has not been sent (Q-19).
- **The refund policy in weeks, frozen at consent, materialised into the existing windows.**
  The computation is proven and stays; what the family signed is what applies.
- **Charges in the one pipeline, with four named changes to the money core.** New money kinds
  join payments, receipts, reversals, refunds and the sweep; the 09 invariants extend by rows.
- **Instalments as charges.** Q-15's default was the owner's; a plan is N charges whose sum is
  the line, so "a payment equals what it covers" holds per payment and a new rule holds the sum.
- **A registry of policies, not more exception types.** "Everything can have an exception" is a
  registry where each policy names its hook; the screen reads the registry; the entry deadline
  is in it, gated by a setting until the owner answers Q-20.
- **Messages write notifications.** Families keep the notification centre they have; the admin
  gets audiences, templates and a delivery log around it; WhatsApp is a channel with no sender
  until the school has a business account (the owner, 7 Oct).
- **Grade 10 registered by the school.** No form has a grade-10 class (A-15); the family's own
  path still enforces the core subjects if a grade-10 family reserves.
- **The teacher change at the desk too.** The family asks at the desk; the change is audited
  and the coordinator sees it on the group.

## 13. The prototype

`docs/prototype/reservations-rework.html` (self-contained, no backend; open it in a browser;
deep links `#session/subjects`, `#desk`, `#family`, `#statement`, `#exceptions`, `#messages`):
the Session screen with the Subjects, Fees, Money and Grade 10 tabs and the offer drawer, the
desk's and the family's Reserve pages with live prices (the entry select is attempt and mode in
one list), the Statement, the Exceptions picker with its sentence, the Messages and reminders
page. Fixture data shaped like SCHOOL_FORMS.md §2 with placeholder names; course fees
illustrative; board fees from the June 2026 lists. It is for the owner's review and for showing
the admin; the build follows this document, not the prototype's pixels.

## 14. Review

The Opus 5.5 review of version 1 and the lead's answers are §16; the trail is
`.audit/school-forms.tsv`. Version 2 goes back to the same reviewer for the eight material
flags before it reaches the owner.

## 15. Today's steps (the survey)

An Opus 5.5 survey of today's screens (7 Oct, read-only; file and line references in its
report, kept in `.audit/school-forms-evidence/survey-today.md`). Inputs are fields set; clicks
are buttons, toggles and confirms, not navigation.

| Task | Today | Counts | Must remember |
|---|---|---|---|
| Open June 2027 with 25 subjects and their teachers | three windows (IGCSE, AS, A Level: `registration_session.qualification_level`, one active per type and level); each window's "Board series" panel: make or add Cambridge, Pearson and Oxford June 2027 and save; each series' deadline on `/exams/series` with a reason; every subject created on `/admin/subjects` (name, code, council, level, two fees, core, offered) or pasted as CSV; each subject's teachers in a modal; AS and A Level rows mapped on the Catalogue for F4 | windows and series: 29 inputs, 27 clicks; per subject 5–9 inputs and 4–5 clicks; **162–237 inputs, 127–152 clicks** without mapping (+25 inputs, +75 clicks with it) | distinct window names (every screen lists windows by name); each board's series added to each window or its subjects silently drop out; a deadline after every feeding window's close; fees and the core flag live on the subject, not the cycle; retyping a teacher's name makes a duplicate; the CSV's level and council spellings; board codes for mapping |
| A session's subjects with their teachers and fees | **no such screen**: the series panel lists subjects with their series, the Subjects page fees without the session, the desk prices for one student at a time | — | — |
| A walk-in family: three subjects, one a self-study retake, cash | onboard (parent and student emails, names, passwords, grade), search the student again, collect the school fee if due, "Register Subjects", pick the window by name, tick three subjects, tick "Outside school" where offered, teachers, "Register & Collect", hand over each receipt | **13–16 inputs, 5–6 clicks, plus a hand-over per receipt** | **the officer cannot mark a retake**: it is derived from an earlier registration in this system only, so a new family's retake is refused ("only when retaking…") until a finance admin grants an exception; the price shown omits exceptions, the amount charged includes them; which window matches the student's level |
| A 20% discount on one subject in one session | type, student search and pick, value, session, subject, valid until, reason, grant | 6–8 inputs, 1 click | the subject list mixes every level and status by "name (code)"; the discount applies only to lines created after it; percent discounts stack |
| Refund windows for a session | on the School fees page: scope, session, from, to, percent, label, add — per tier | **15–18 inputs, 3 clicks** for three tiers | the form resets to "academic year" after each add; windows may not overlap and ends are inclusive; a date is sent as UTC midnight so the "to" day is excluded; gaps refund 0%, no windows refund 100%; no edit, only delete and re-add; not tied to the session's dates |
| An announcement to parents of grade 11, and one for tomorrow | recipients button, title, message, send; again with "Schedule for later" and a time | 5 inputs, 5 clicks | **"parents of grade 11" cannot be targeted** (grade groups reach students; "All Parents" is too broad); the form resets between the two; grade membership is resolved at send time |
| The school fee 2026-2027 for three grades | year (as "2026-2027"), grade, amount, opens, due, add — per grade | 12–15 inputs, 3 clicks | the form resets each time; the year format differs from the rest of the app ("2026/27"); no edit in the UI |
| Which board series a registration goes to | before: the series panel's "Entered in"; after: the panel's registrations list, the series page's counts; **not at the desk** (the desk drops the series the API returns) | — | — |

## 16. The review round (Opus 5.5 review of version 1, 7 Oct; the lead's answers)

Verdict on version 1: not ready; eight material flags, twelve should-fix, six minor. Each and
what version 2 does:

| # | Flag | Version 2 |
|---|---|---|
| 1 | the money core is not untouched: receipts are per registration, remark payments are not reversible, 09's equality rule joins lines only, one purpose per payment, the school-fee index | **accepted**: §3.10 names the four changes (one purpose per payment, never mixed; a receipt per charge; reversal and refund of charges; the sweep over charges) and the 09 rules; the pushed school fee is paid through the existing path; §8's mixed-checkout scenario rewritten; the trail row corrected |
| 2 | the refund basis contradicts the form ("Course fees"); `refund_window` has no offer scope; re-materialising changes what families consented to | **accepted**: the percentage on the course fee, the board fee by its own rule (Q-19, default: full while not sent to the board); `refund_window.offer_id` with a three-way scope check; the policy frozen per line at consent (`refund_policy_snapshot`); a session's policy editable only until the first consent |
| 3 | reservations cannot open before the boards publish | **accepted**: provisional fees, reservable, not payable by default; an audited re-price of unpaid lines; paid lines adjusted only by finance's explicit act (§3.4) |
| 4 | per-unit teachers do not fit the enrolment F1 and F4 read; what a unit line's subject is; F4 changes more than one function; F1's flags not in the repo | **accepted**: the unit line's subject is the parent (§3.5); enrolment gains a unit dimension and groups form per unit with a delivery mode (§9, §10); F4's change list written out; F1's flags named as its open review flags |
| 5 | the migration undefined for labels, lines without an item, unmapped rows, course start and due, year-scoped refund windows, two exception types, outside-school first entries, remark fees and deadlines, remark requests, the routing trigger, the proof | **accepted**: §7 rewritten with one rule per row kind, every converted window labelled, offers for every window and every subject with lines, the trigger rewritten, the synthetic shapes and the eligibility check in the proof, nothing dropped for one release |
| 6 | the family path is harder than the form for re-sitters; "staff say so" against "an exception" | **accepted**: the family declares the retake and its sitting (as the form), the desk declares, staff verify (§3.5, §4.4); the exception is only for self-study on a first entry |
| 7 | the owner's decisions presented as settled where they conflict: the entry deadline against point 9; instalments against Q-15; Q-11's group anchor dropped | **accepted**: Q-20 and Q-21 put to the owner (§17), the deadline exception in the registry gated by a setting; instalments built as charges (§3.6); the group's first lesson in the anchor precedence (§3.1) |
| 8 | names in the repo: the provider's and a realistic student name; SCHOOL_FORMS.md on main | **accepted**: placeholders everywhere; SCHOOL_FORMS.md corrected in the same commit, which reaches main with this round (the name stays in main's history: history is never rewritten here) |
| 9 | `GRADUATE_RETAKE_SESSION_TYPES` and `A_LEVEL_ONLY_SESSION_TYPES` lack `winter`; IGCSE barred from October too | **accepted** (§3.1, §3.3) |
| 10 | automatic attaching collides with the window-closes-before-deadline rule; October/November ambiguous; labels ignored | **accepted**: attached by item, detached when unused; IGCSE → November, AS/A2 → October default, January selectable; unlabelled by default (§3.3) |
| 11 | cash-in, late cash-in, certificate split not board services; no family request; no exception on charges; the push ignores waivers and A-13 | **accepted** (§3.6, §3.7) |
| 12 | money outcomes change unlisted: the remark refund (03:189), A-16's prices, the custom price's board fee | **accepted**: listed in §3.10 with pre-authorisation; the custom price keeps today's semantics (the total); the remark refund is the EAR sheet's rule, and whether the school passes it on in full is Q-21 |
| 13 | F7 prices imported lines at 0 | **accepted**: provisional, never 0 (§9, §10) |
| 14 | step counts: six inputs, not five; deadlines and fee grids uncounted; no predecessor the first time; §15 empty; no prototype | **accepted**: §11 recounted with and without a predecessor, deadlines and fees included; §15 filled and the prototype written after the review read the draft |
| 15 | items under-specified: overlap, `required` across series, the board fee of one paper, attempt mixed with mode, every one-paper item needing a prior series | **accepted**: exclusive groups, `required_in_series`, `board_fee_key`, attempt and mode apart, `needs_prior_series` per item from the catalogue (§3.2, §3.5) |
| 16 | `due_at` unstated | **accepted** (§3.1): reminders and views, not expiry, unless the setting is on; the grace for late reservations |
| 17 | exception value typing, one-shot list, family scope, subject across sessions, the one-paper percent | **accepted** (§3.7) |
| 18 | lock order unstated; missing races | **accepted** (§6, §8) |
| 19 | edge cases and 09 gaps | **accepted** (§4.2 offer closed or item unticked with lines, replace teacher, self-study change on a paid line, grade-10 bulk lines' consent and teacher, consent on override, swap and import; 09's basis rule for converted lines, `refunded` allowed, the consent rule, the refund cap) |
| 20 | points 2, 3, 8, 9, 10, 11 partial | answered through flags 7, 11, 15, 16, 17, 19 |
| 21 | the statement per family | **accepted** (§4.5) |
| 22 | online and external never reach F1 | **accepted** (§10 `delivery`) |
| 23 | `gate.priorSeries` ignores the board's carry-forward period | **accepted** (§3.5) |
| 24 | `is_offered_at_school`, `was_core_at_registration` | **accepted** (§3.2, §3.9) |
| 25 | the admin's verdict misquoted ("not usable that much") | **accepted**: corrected in FEATURES_PLAN.md §0c, SCHOOL_FORMS.md and the memory |
| 26 | the teacher change granted to the desk; the remark service mapping | the desk kept, with the reason (§12); the mapping given (§3.6) |

## 17. Questions for the owner (new in this round), each with the default built unless answered

| # | Question | Default |
|---|---|---|
| Q-19 | On a drop, the forms refund a percentage of "the Course fees". Is the **board fee** refunded in full while the school has not yet sent the entry to the board (before the series' entry deadline), and not at all after — or does the percentage apply to the whole price as today? | the percentage on the course fee; the board fee in full before the entry deadline, 0 after (the board's own refund rule where F4 knows it) |
| Q-20 | The admin's point 9 says every deadline can have an exception; MO-10 (27 Sep) made the board's entry deadline a hard stop. May the admin grant a late entry past it, with the board's late fee charged to the family as a charge? | the hard stop stays; the `deadline.boardEntry` policy exists but is switched off by the setting until you say otherwise |
| Q-21 | When a remark changes the grade, Cambridge refunds the fee less 100 EGP per component to the school. Does the school pass exactly that on to the family (today the system refunds the whole fee)? | the family gets what the school gets (fee − 100 per component) |
| Q-15 (confirmed) | Instalments are built as charges on a line (your default); a plan is granted per family as an exception. Is that the shape you want, and who may grant it? | finance admin and admin |
