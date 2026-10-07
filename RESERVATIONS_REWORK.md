# The reservations rework — sessions, reservations, fees, exceptions, notifications

**Date:** 7 October 2026
**Status:** design for the owner's review (Phase 2 of FEATURES_PLAN.md §0c); reviewed on
Opus 5.5 before it reaches the owner (§14). Nothing here is built.
**Inputs:** `SCHOOL_FORMS.md` (every form and option, the fee lists, the 30-row gap map, the
admin's eleven points), the owner's confirmation of that reading (7 Oct), DISCOVERY.md (A-15,
A-16, Q-10 to Q-18 with the defaults the owner let stand), the system as built (F0a
`docs/features/FOUNDATION.md`, F0b `docs/features/CATALOGUE.md`, MONEY_AUDIT.md, the 09
invariants), and the frozen branches F1, F2, F4, F7.

**The one sentence.** The school's links sheet — subject, board, teachers, what can be entered —
becomes the session screen; a family's reservation is one line per paper or route with the
form's own choices; the fee is what the fee lists say per unit per series; every rule the forms
express is a policy an exception can lift; and the money core underneath (ledger, escrow,
receipts, takings, the 09 invariants) is not touched.

---

## 1. What the admin gets (the screens, in her order)

| Her priority | The screen | What it replaces |
|---|---|---|
| Reservations and fees paid | **Session** (`/admin/sessions/<id>`): the links sheet as a table — every subject open this cycle with its board, teachers, what can be entered and at what fee — and a **Money** tab: who has reserved what, who has paid, who has not, with one-click reminders | 25 Google Forms built by copy-and-edit, a links PDF, the response sheet, the fee note typed per row |
| Reservations | **Reserve** (desk `/desk`, family `/register`): one page per student per session with the same choices as the form, line by line, a running total, consent, pay | the family filling one form per subject; the desk reading the sheet |
| Fees paid | **Statement** (family `/statement`, Student 360): every line with its price, what was paid, what is outstanding, the due date, the receipt | nothing (no prices on the forms) |
| Exceptions | **Exceptions** (`/admin/exceptions`): one rule picker over every policy, deadline and percentage; one sentence saying what the exception does; one audit trail | seven fixed types |
| Notifications | **Messages** (`/admin/messages`): broadcast, batch (any list in the system) or direct, templates, delivery log; **Reminders**: repeating rules per session | one broadcast form |
| Services | **Services** on a reservation: remark (per board's services), cash-in, late cash-in, certificate split, any charge the school adds | remarks only |

The admin never assembles a board series by hand again. The series is attached when a subject is
added to the session (§3.3); the only thing she sets on it is the entry deadline, the hard stop
the owner decided (MO-10), and the session screen tells her when one is missing.

---

## 2. Principles (each traceable to the owner's words or an artefact)

1. **The form is the floor.** Every element of the forms (SCHOOL_FORMS.md §2) is one field or
   one derived fact here; nothing is asked that the form does not ask, and what the system
   already knows (class, guardian, the teacher pool) is never asked.
2. **A session is its subjects.** Type and year make the session; the name is derived; the
   subjects with their teachers, papers and fees are the session's content (point 7).
3. **A reservation line is what the board sees.** One line = one paper set, unit or route, priced
   on its own, entered in one board series (points 1, 2; IS-01).
4. **Fees are the fee lists.** Board fees per unit or option per series, course fees per subject
   per cycle; a line snapshots both; the ledger stays as it is (G-16, G-17).
5. **Policies are settings, exceptions lift them.** Every percentage, deadline and gate is a
   named policy with a default; an exception is (policy, scope, value, until, reason) on one
   screen (point 9).
6. **Staff do everything the family can, in fewer steps than the form** (UX_AUDIT.md §4; §11
   below counts).
7. **The money core is not reopened.** Payments, escrow, receipts, takings, reversals and the 09
   invariants keep their tables and services; new kinds of money (charges) join the pipeline the
   way remarks and school fees did.
8. **No copy-and-edit.** A session is copied from the previous one of its kind, fees re-entered
   per series, and the family's page is generated from it (G-29).

---

## 3. The model

### 3.1 Session (`registration_session`, changed)

| Field | Was | Becomes |
|---|---|---|
| `name` | typed | **derived**: "June 2027"; "November 2026 – January 2027" (an optional `label` when two sessions of one kind and year must coexist) |
| `session_type` | `june` / `october` / `november` / `january`, one month | **`june`** (feeds the June series of every board) or **`winter`** (feeds October and November of the year and January of the next, per board); `series_year` = the June year, or the winter's November year |
| `qualification_level` | one level per window | **dropped**: one session per cycle, levels per subject (G-01, G-12) |
| `start_date`, `end_date` | the window | kept: when families may reserve |
| — | | `course_starts_on`: the cycle's first lesson, the refund anchor (G-19); overridable per offer |
| — | | `refund_policy`: steps in weeks from the course start, copied from the setting of the type at creation (June: 100 to week 2, 50 in week 3, 0 from week 4; winter: 100 to week 2, 50 in weeks 3–6, 0 after), editable per session |
| — | | `payment_due_at`: the date every line of the session is due unless an exception says otherwise (point 11); never after the earliest entry deadline |
| `status`, close fields, `finalized_at`, `edit_history` | | kept; the close, the sweep per series and MO-10 unchanged |

Uniqueness: one active session per (type, year, label). F0a's eligibility (`mayRegisterFor`)
judges the session's academic year and whether it is June, exactly as today: a winter session is
"not June" (grade 10 refused without the grade-10 exception; A-12 for graduates), and all its
series are in one academic year (F0b's rule, unchanged).

### 3.2 Offer (`session_offer`, new) — a row of the links sheet

One per (session, subject). Fields: `subject_id` (the catalogue's registrable row: board,
qualification, units as F0b maps them), `availability` (`open`: first entries and retakes;
`retake_only`; `self_study_only`; `closed`), `course_fee` (EGP for a first entry in school this
cycle, Q-14), `course_starts_on` (null: the session's), `grade10_core` (the core-subject mandate
per cycle; replaces `subject.is_core`), `notes`, `sort_order`. Shown with its board, the awards
it enters and the school's level code (F0b's `deriveLevelCode`).

**Teachers** (`session_offer_teacher`): `teacher_id`, `mode` (`in_school`, `online`), or
`provider` (text: an external team), `sort_order`. The pool is the existing `subject_teacher`
link (who can teach what); the offer picks from it; a teacher added here is linked there. An
offer with no teacher and availability `open` is refused ("who teaches it?") unless
`self_study_only`.

**Items** (`session_offer_item`): what a family can tick under the subject. Fields: `label` (as
the form words it), `kind`, what it enters (`unit_ids[]` or `qualification_option_id` or the
whole award), `board_series_id` (§3.3), `availability` (as the offer's, per item), `course_fee`
(null: the offer's; IAL units and one-paper retakes are priced per item), `needs_prior_series`
(a carry-forward route or a one-paper retake names the sitting it carries from),
`teacher_ids[]` (null: the offer's; IAL Mathematics names a teacher per unit), `required`
(a first entry of this subject must include it), `sort_order`.

| Subject on the forms | Items generated from the catalogue (editable) |
|---|---|
| an IGCSE subject (Cambridge, Pearson, Oxford) | **Whole subject** (the award, its option code from the catalogue), plus the one-paper retake items the school offers: Cambridge sciences "Paper 4 only (retake)", ICT "Theory paper only (retake)", Edexcel Mathematics "Paper 1H only", "Paper 2H only", Arabic "Paper 1 only", "Paper 2 only" — each `needs_prior_series`, availability `retake_only` |
| a Pearson IAL subject | one item per unit (P1, P2, P3, P4, M1, S1; WBI11–WBI16), each in its series (winter: October or January per unit), each with its own teachers and fee; the AS and A Level cash-ins as award items when the school claims them (F4) |
| a Cambridge A Level subject | the routes: **AS** (option S1/S2), **A2, carry forward** (option BY/CT, `needs_prior_series`), **A Level** (option AX/HX) — one price each (SCHOOL_FORMS.md §3.1); Chemistry and French: AS and A Level only |
| Arabic A Level (Edexcel) | two items entering two qualifications (IAL YAA01/WAA01–02; GCE 9AA1), each with its own teacher (Q-16) |

The catalogue (F0b) already holds units, awards, option codes and `qualification_unit`
(required, optional, choice group); the items only choose and label them. An unmapped AS or A
Level subject cannot be offered until it is mapped (the Catalogue screen lists them first).

### 3.3 Board series, attached (not assembled)

When an offer is added, the session attaches, for the subject's board, the board series of the
session's months (June: the board's June of the year; winter: the board's October or November of
the year and January of the next) — found by (board, month, year) or **created** with no deadline
and a warning on the session screen ("Cambridge June 2027: entry deadline not set"). Each item's
`board_series_id` defaults to the first of them and is changed per item (Biology units 1–2 to
November, 3–4 to January). `session_board_series` stays as the derived link that F0b's rules
and the 09 invariants read; `session_subject_series` (routes per subject) is **replaced** by the
item's series. An IGCSE item cannot sit in a January series (F0b's rule, per item now). A series
with lines in it is not detached; a change of an item's series moves its live lines with F0b's
guards (no move across deadlines while a checkout is open) and the audit rows it writes today.

The "Board series" page (`/exams/series`, the coordinator's calendar of the boards' dates) stays
as it is. The window's series panel, the per-board default and "where each subject is entered" go
away from the admin's path; "move registrations" stays as an admin tool behind the item.

### 3.4 Fees

**`board_fee`** (new): per `board_series_id`, what it prices (`unit_id`, or
`qualification_option_id`, or `qualification_id`, or `service_code` for a board service with a
`level` for the two EAR rates), `amount`. Entered as the fee lists are: a **fee grid per series**
(paste the PDF's rows: code and amount; unknown codes listed to map), copied from the previous
series of the board with a prompt to re-enter. An item's board fee is resolved from what it
enters; a line snapshots it (`registration_fee_at_registration`, the existing column). An item
with no board fee on its series shows a warning and cannot be reserved until one is set (or the
admin sets 0 with a reason).

**Course fee**: `session_offer.course_fee` or `session_offer_item.course_fee` (Q-14). Snapshotted
in `course_fee_at_registration`.

**Pricing policies** (settings, F0a's store; each exception-able, §6):

| Key | Default | Meaning |
|---|---|---|
| `pricing.selfStudyCoursePercent` | 50 | the course fee on a self-study retake (every form) |
| `pricing.selfStudyBoardPercent` | 100 | the board fee on a self-study retake (A-16, Q-12) |
| `pricing.retakeTaughtCoursePercent` | 100 | the course fee on a taught retake ("Retake in School 100%") |
| `pricing.onePaperCoursePercent` | 100 | the course fee of a one-paper item (the item has its own fee; this scales it) |

`priceLine(item, entryKind, policies, exceptions)` is the one pricing function (replaces
`computeRegistrationPricing`): course = item or offer fee × the kind's percent; board = the
series' fee × the kind's board percent; then the price exceptions (discount %, fixed, custom);
total = course + board. The result and its basis (`pricing_basis` json: kind, percents, exception
ids) are snapshotted on the line so the receipt and the statement say why the price is what it
is. The 09 rule "price = course + registration fee" holds unchanged.

### 3.5 Reservation line (`registration`, changed)

| Field | Change |
|---|---|
| `subject_id` | kept (the offer's subject) |
| `offer_item_id` | **new**, not null after the backfill: what the line enters |
| `entry_kind` | **new**: `first_entry`, `retake_taught`, `retake_self_study` (the five options of the Arabic form; "Self Study Y/N" is this field) |
| `carried_from_series_id` | **new**: the sitting a carry-forward route or a one-paper retake carries from (Q-13) |
| `is_retake`, `taken_outside_school` | kept for the ledger's readers; derived from `entry_kind` on write |
| `teacher_id` | kept; from the item's or offer's teachers; null on self-study; **changeable** by staff (`PUT /registrations/:id/teacher`, reason, audited; the enrolment and the group follow through F0b's `upsertEnrolments` and F1's membership move) (point 10) |
| `board_series_id` | kept; from the item |
| `due_at` | **new**: the session's `payment_due_at` or the exception's (point 11) |
| `pricing_basis` | **new** json (§3.4) |
| unique index | (student, session, **offer_item**) where live — P1 and P2 under one subject are two lines |

Statuses, the parent's approval of a student's request, the direct registration, the admin
override, the desk, preregistration, drops and swaps keep their paths; each now takes an
`offer_item_id` and an `entry_kind` per line instead of `subjectIds` and `subjectOptions`
(`RequestRegistration`, `DirectRegistration`, `DeskRegistration` change shape; the routes are the
same).

**Rules on a line** (each a policy with a key, each exception-able, §6):

| Key | Rule | From |
|---|---|---|
| `gate.selfStudyFirstEntry` | self-study only on a retake. A retake is **known** (an earlier line or an F4 result for what the item enters) or **declared at the desk**: the officer names the prior sitting (board series) and the line records it (`prior_sitting_series_id`, `prior_sitting_source` = `known` / `declared`, one `RETAKE_DECLARED` audit row). A family's own reservation can only use known history (the form trusts the family; the desk checks the sheet) | every form: "ONLY 2nd entry" (G-09); the survey: today a walk-in family's retake cannot be set at all (§15) |
| `gate.availability` | an item `retake_only` takes retakes only; `self_study_only` takes `retake_self_study` only; `closed` none | the links sheet (G-13) |
| `gate.requiredItems` | a first entry of a subject includes its `required` items; an award claim includes the award's required units (catalogue) or banked results (F4) | point 2 |
| `gate.priorSeries` | an item that `needs_prior_series` has one, and it is before this session's series | the forms' "From June 2026" |
| `gate.grade10Core` | grade 10 in June reserves every `grade10_core` offer | A-05 |
| `gate.schoolFee` | the school fee of the year is paid or waived | as today |
| `deadline.window` | the session is open (or the student's extension) | as today |
| — | the series' entry deadline | **the hard stop, no exception** (MO-10, the owner's decision) |

**Consent** (`registration_consent`, new): per line, `kind` (`refund_policy`, `declaration`),
`text_version`, `confirmed_by`, `channel` (`app`, `desk`), `at`. A family's own reservation
cannot be submitted without both; the desk ticks "read and signed by the parent" once for the
whole reservation (one row per line) and the printed reservation slip carries the texts (G-20).

### 3.6 Charges (`charge`, new) — services and pushed fees

A charge is anything a family owes that is not a reservation line: `student_id`, `kind`
(`cash_in`, `late_cash_in`, `certificate_split`, `remark` (the existing remark request keeps its
table; its fee becomes a charge), `school_fee_push`, `custom`), `registration_id` (when it
concerns a line), `board_series_id` (when a board's fee applies), `description`, `amount`,
`due_at`, `status` (`pending_payment`, `paid`, `cancelled`, `refunded`), `created_by`, `reason`.
`payment_charge` links payments to charges as `payment_registration` does to lines; the checkout
summary, the desk's collection and the family's pending payments list lines and charges alike;
receipts, reversals, takings and escrow treat a charge like a line (the services already treat a
remark fee so).

- **Board services** (`board_service`, new, catalogue): per board, `code`, `label`,
  `per_component`, `level_rates` (IGCSE / AS-A Level), `refund_rule` (`none`, `full`,
  `less_fixed` with the deduction), `deadline_days_after_results`. Seeded from the research and
  the EAR sheet: Cambridge services 1, 1S, 2, 2S; Pearson's review of marking, clerical
  re-check, access to scripts; Oxford's equivalents. A remark request picks a service of the
  line's board; its fee is a `board_fee` of the series (G-21). The existing remark states,
  consent and outcome recording stand; "fee refunded" becomes a refund of the charge to escrow
  for the amount the rule says (fee − 100 EGP per component for Cambridge).
- **Cash-in, late cash-in, certificate split** (point 3): charges of their kind on a line, with
  the board fee of the series when one is set, requested by the family or added at the desk; F4
  turns a cash-in charge into the award entry (G-22). Q-17 for the boards' own rules.
- **School fee pushed** (point 8): the schedule stays the gate's source; "Push to families"
  on the School fees screen creates a `school_fee_push` charge per chosen student (a grade, a
  section, a list) with the due date, so it appears in every family's pending payments and is
  reminded; paying it goes through the existing school-fee payment path (purpose
  `school_fee`), which marks the charge paid. Idempotent: a student with a paid fee or an open
  push is skipped and listed.

### 3.7 Exceptions (`exception`, reshaped)

An exception lifts one **policy** for one **scope**. `policy_key` (from the registry below),
`scope`: `student_id` (required) and optionally `session_id`, `offer_id`, `offer_item_id`,
`registration_id`, `charge_id`; `value` (typed per policy: a percent, an amount, a date, a
boolean), `valid_until`, `reason`, `granted_by`, `status` (`active`, `revoked`, `lapsed`,
`used` for one-shot gates). The registry (`@repo/validations`, `POLICIES`) declares for each key:
its label, its sentence ("Charge 20% of the course fee instead of 50% on this student's self-study
lines in June 2027"), the value type and bounds, the scopes it accepts, the roles that may grant
it, and where it is applied (a hook name the services call: `priceLine`, `assertLineRules`,
`refundPercentFor`, `sessionWindow`, `dueDateFor`, `schoolFeeGateReason`).

| Policy key | Lifts | Value | Granted by |
|---|---|---|---|
| `pricing.selfStudyCoursePercent`, `pricing.selfStudyBoardPercent`, `pricing.retakeTaughtCoursePercent` | the percents of §3.4 | percent | finance admin, admin |
| `price.discountPercent`, `price.discountFixed`, `price.custom` | the line's price (the existing three) | percent, amount, amount | finance admin, admin |
| `refund.percent` | the refund policy's step (the existing custom refund) | percent | finance admin, admin |
| `refund.courseStart` | the anchor for this student's line (joined late) | date | finance admin, admin |
| `deadline.window` | the session's closing (the existing extension) | date | finance admin, admin |
| `deadline.payment` | the line's or charge's due date | date | finance admin, admin |
| `gate.schoolFee` | the fee gate (the existing waiver) | — | finance admin, admin |
| `gate.selfStudyFirstEntry` | self-study on a first entry | — | finance admin, admin |
| `gate.availability` | reserve an item not open to the student (retake-only, closed) | — | admin, coordinator |
| `gate.requiredItems` | reserve without a required item | — | admin, coordinator |
| `gate.priorSeries` | a carry-forward or one-paper item without a recorded prior sitting | — | admin, coordinator |
| `gate.grade10Core` | grade 10 without a core subject | — | admin, coordinator |
| `eligibility.grade10OtherSeries` | the existing grade-10 exception | — | coordinator, admin |
| `plan.instalments` | **deferred** (Q-15): a line paid in parts breaks "a payment equals what it covers"; until the owner decides, a due date moved is the instrument | — | — |

The existing seven types map onto keys in the migration (`discount_percent` →
`price.discountPercent`, `fee_waiver` → `gate.schoolFee`, `deadline_extension` and
`late_registration` → `deadline.window`, `custom_refund_percent` → `refund.percent`,
`grade10_other_series` → `eligibility.grade10OtherSeries`); every hook that reads an exception
today reads the same rows through the registry. The screen: pick the student (or open it from
the Student 360 or a line), pick the policy (grouped: price, refund, deadlines, gates), the
scope narrows itself to what the policy accepts, the sentence previews, a reason, grant. The
Student 360 and every line show the exceptions that touched them.

### 3.8 Messages and reminders

**Audience** (`message_audience`, new): `kind` (`broadcast`: all, parents, students, a grade;
`batch`: a saved list — the families of a session's unpaid lines, a section, a teaching group,
the reservers of an offer, the holders of a charge kind; `direct`: chosen users), the
definition (json), `resolved_count`. **Message** (`message`, new): `audience_id`, `template_id`
or title and body with variables (`{student}`, `{session}`, `{amount}`, `{due}`), channels
(`in_app`, `email`; `whatsapp` reserved, no sender until the school has a business account),
`scheduled_at`, `status`, `created_by`. Each send writes the existing `notification` rows (so
nothing a family sees changes) and a `message_delivery` row per recipient and channel
(`queued`, `sent`, `failed`, with the error). Families mark read; nobody deletes (as today).
**Templates** (`message_template`): the school's texts in English and Arabic.

**Reminder rules** (`reminder_rule`, new): `kind` (`payment_due` for lines and charges,
`session_closing`, `entry_deadline`, `school_fee_due`), `offsets_days` (before or after:
−7, −3, 0, +3, +7), `repeat_every_days` and `until` (`paid`, `closed`, `deadline`),
`channels`, `session_id` (null: every session; a session's own rule overrides), `active`.
**`reminder_sent`** (claim table: rule, target, offset, sent at) so two scheduler instances
send once (ST-06, ST-12). The scheduler tick (the existing job) runs due reminders and writes
messages with audience `batch`. Defaults seeded as settings (`reminders.paymentDueOffsets`,
`reminders.repeatEveryDays`).

### 3.9 What is removed or kept

| Today | After |
|---|---|
| `registration_session.qualification_level`, typed `name`, one active per (type, level) | dropped; derived; one active per (type, year, label) |
| `session_subject_series` (subject routes) | replaced by `session_offer_item.board_series_id` |
| `session_board_series` | kept, derived (§3.3) |
| `subject.is_core`, `subject.course_fee`, `subject.registration_fee`, `price_in_school`, `custom_price` | `is_core` → `session_offer.grade10_core`; fees → `session_offer(.item).course_fee` and `board_fee`; the subject's columns stay read-only for history and the migration |
| `subject_teacher` | kept as the pool |
| `refund_window` (absolute dates) | kept as the materialisation of `refund_policy` per session (and per offer when its start differs): the refund service's computation is unchanged; a policy or anchor change re-materialises (refused while it would change a parked drop) |
| `exception` types | reshaped onto the registry (§3.7) |
| `remark_fee_schedule`, `remark_deadline` | `board_fee` (kind service) and `board_service.deadline_days_after_results` per series; the remark request's states unchanged |
| `scheduled_announcement`, broadcast groups | `message` with audiences; the old rows migrate as broadcasts |
| `computeRegistrationPricing` | `priceLine` |
| `registration.subject_id` | kept; `offer_item_id` added |
| payments, escrow, receipts, takings, reversals, withdrawals, the held wallet | **unchanged** |

---

## 4. The screens

Each with the form or sheet it replaces, then ours. Wireframes are text; the prototype (§13) is
the clickable version for the owner.

### 4.1 Sessions (`/admin/sessions`)

```
Sessions                                            [ New session ▾ ]  June · Winter
──────────────────────────────────────────────────────────────────────────────────
June 2027      open   reserve 15 Sep 26 – 15 Feb 27   course starts 20 Sep 26
               25 subjects · 3 boards · deadlines: Cambridge 20 Feb ✓ Pearson 25 Feb ✓ Oxford — ⚠
               412 lines · 318 paid · 94 unpaid (EGP 1,240,500 outstanding)   [ Open ] [ Money ]
November 2026 – January 2027   open  …
```

New session: **type** (June / Winter), **year**, **reserve from / to**, **course starts**,
**payment due** — five inputs; the name, the series and the refund policy follow. "Copy from
June 2026" is offered first: offers, teachers, items, availability and course fees come across;
board fees are asked per series.

### 4.2 Session (`/admin/sessions/<id>`) — the links sheet

```
June 2027   open · reserve 15 Sep – 15 Feb · course starts 20 Sep · due 30 Nov   [ Edit ] [ Close ]
Deadlines: Cambridge June 2027 20 Feb 2027 · Pearson Edexcel June 2027 25 Feb · Oxford June 2027 ⚠ not set
[ Subjects ] [ Fees ] [ Money ] [ Grade 10 ]                                [ + Add subject ] [ Copy from… ]
O.L.
┌──────────────────────────┬───────────┬──────────────────────────┬──────────────┬───────────┬─────────┐
│ Subject                  │ Board     │ Teachers                 │ Entries       │ Course fee│ Board   │
├──────────────────────────┼───────────┼──────────────────────────┼──────────────┼───────────┼─────────┤
│ Arabic O.L.              │ Cambridge │ T1 · T2 · T3             │ whole · P1/P2 │ 12,000    │ 9,850   │
│ Biology O.L.             │ Cambridge │ T4 · T5 · T6             │ whole · P4 only (retake) │ 14,000 │ 10,850 │
│ Computer Science O.L.    │ Cambridge │ Komy's team (external)   │ whole · P4 only │ …       │ 9,850   │
│ Global Perspectives O.L. │ Cambridge │ T7 (online)              │ whole         │ …         │ ⚠ no fee│
│ Mathematics O.L.         │ Edexcel   │ T8 · T9 · T10            │ whole · 1H · 2H │ …       │ 4,600×2 │
A.S. / A.L.
│ Mathematics A.S./A.L.    │ Edexcel IAL│ per unit                │ P1 T11 online · P2 T11 online · P3 · P4 · M1 T12/T11 · S1 … │
│ Physics A.S./A.L.        │ Cambridge │ T13                      │ AS (in school) · A2 carry-forward (self-study only) · A Level │
│ Biology A.S./A.L.        │ Edexcel IAL│ T14                     │ Papers 5, 6 (first entry) · Papers 1–4 (self-study only) │
└──────────────────────────┴───────────┴──────────────────────────┴──────────────┴───────────┴─────────┘
```

A row opens in a drawer: availability, teachers (with mode or provider), the items (generated;
tick which are open; a per-item teacher, series, fee and availability where they differ),
course fee, course start override, grade-10 core, notes. Adding a subject: search the catalogue
(unmapped A Level rows say "map first"), the board and the items come from the catalogue, the
teachers from the pool; three inputs for an IGCSE subject (subject, teachers, course fee).

**Fees** tab: one grid per attached series (the PDF's shape: code, title, amount), paste or
type, "copy from Cambridge June 2026" with the rows to re-enter highlighted; the EAR services
beside them. **Money** tab (§4.6). **Grade 10** tab: the core offers ticked; "Register grade
10" previews every grade-10 student's lines and commits them once (A-15, Q-10).

### 4.3 Reserve at the desk (`/desk`, the existing desk, reshaped)

```
Student  [ Ahmed Mahmoud 11C ▾ ]     Session [ June 2027 ▾ ]      Reserved so far: 2 lines, 1 unpaid
O.L.                                                     teacher          entry                 price
☑ Biology O.L.  (Cambridge)        whole subject       [ T4 ▾ ]         [ first entry ▾ ]     24,850
☐   Paper 4 only (retake)                              —                 [ retake, self-study ] from [ June 2026 ▾ ]
☑ Mathematics O.L. (Edexcel)       whole subject       [ — self-study ] [ retake, self-study ] 15,850  ← sat June 2026
☐ Chemistry O.L.  …
A.S. / A.L.
☑ Mathematics A.S./A.L. (IAL)      P1 [ T11 (online) ▾ ] first entry 9,800 · P2 [ T11 ▾ ] 9,800 · ☐ P3 · ☐ P4 · ☑ M1 [ T12 ▾ ] 9,450 · ☐ S1
──────────────────────────────────────────────────────────────────────────────────────────────────
5 lines · EGP 69,750 · due 30 Nov 2026      ☑ Refund policy and declaration read and signed by the parent
[ Reserve only ]   [ Reserve and collect: cash ▾  escrow 0  → EGP 69,750 ]
```

Retake is **detected** from history (an earlier line or F4 result for what the item enters) and
pre-set; for a family new to the system the officer **declares** it by naming the prior sitting
(the entry select offers "retake — sat in [ June 2026 ▾ ]"), which the line records and audits;
an exception is needed only for self-study on a first entry. A teacher defaults when the offer
has one. The slip prints with the consent texts. One action creates the lines and, with
"collect", the payments per entry deadline, as today (F0b's split). The price shown is the price
charged, exceptions included (today's desk shows the price before exceptions, §15).

### 4.4 Reserve in the app (`/register`)

The same page for the family: child (parents), session, the offers in the school's vocabulary,
items with teacher and entry, the total, the two consent boxes, submit → lines awaiting payment
(a student's request waits for the parent as today) → checkout by series as today. The
"Grade Level & Class", the guardian block and the seven identity questions are gone: the
system knows them.

### 4.5 Statement (`/statement`, and on the Student 360)

```
June 2027 — Ahmed Mahmoud (11C)
Line                                   price     paid      outstanding   due        receipt
Biology O.L. — whole, first entry      24,850    24,850    0             —          #1042 (12 Oct)
Mathematics O.L. — whole, retake SS    15,850    0         15,850        30 Nov     —
Mathematics IAL — P1 (T11, online)      9,800    9,800     0             —          #1043
Remark: Chemistry O.L. June 2026, service 2   3,820   3,820   0   —   #1051 (refund 3,720 to escrow 2 Sep)
School fee 2026/27                     30,000    30,000    0             —          #0988
Payments: 12 Oct cash 64,500 (#1042–1043) · 5 Sep InstaPay 30,000 (#0988) · Escrow: 3,720 free
```

Every number is from the ledger as it is; the new columns are `due_at` and the pricing basis
(hover: "course 14,000 × 50% + board 10,850").

### 4.6 Money (on the session)

Lines by status with the family, the amount, the due date and days overdue; filters (unpaid,
overdue, by offer, by section); "Remind" sends the payment reminder to the selected families
now (a batch audience); export. The finance workbench, takings and receipts are unchanged.

### 4.7 Exceptions (`/admin/exceptions`)

Student → policy (grouped) → scope (narrowed by the policy) → value → the sentence → reason →
grant. The list shows active, lapsed, revoked, used; each line of the Student 360 shows the
exceptions applied to it.

### 4.8 Messages and reminders (`/admin/messages`)

New message: audience (broadcast · batch from a list · direct, with the resolved count),
template or free text with variables, channels, now or scheduled; the log shows deliveries per
recipient. Reminders: the rules per kind with offsets and repeat, per session overrides, and what
went out.

---

## 5. Endpoints (new or changed)

| Endpoint | Principals | Notes |
|---|---|---|
| `POST /v1/sessions` `{ type, year, label?, startDate, endDate, courseStartsOn, paymentDueAt, copyFromSessionId? }` | admin | derives name, refund policy; copies offers |
| `GET/PUT /v1/sessions/:id` | admin (coordinator, finance read) | the session header |
| `GET /v1/sessions/:id/offers`, `POST`, `PUT /offers/:offerId`, `DELETE` (no live lines) | admin, coordinator | an offer with its teachers and items; attaches series |
| `PUT /v1/sessions/:id/offers/:offerId/items/:itemId` | admin, coordinator | series, availability, fee, teachers, required |
| `GET /v1/sessions/:id/money` | admin, finance | the money tab |
| `POST /v1/sessions/:id/grade10/preview`, `/commit` | admin, coordinator | A-15 |
| `GET/PUT /v1/board-fees?seriesId=` | admin, finance admin, coordinator (read) | the fee grid |
| `GET /v1/registrations/offers?studentId&sessionId` | the student, a linked parent, staff with student records | replaces `/available`: offers and items with the student's detected retakes, teachers and prices per entry kind |
| `POST /v1/registrations/request`, `/direct`, `/desk`, `/admin-override`, `/preregister` | as today | body: `lines: [{ offerItemId, entryKind, teacherId?, carriedFromSeriesId? }]`, `consent: { refundPolicy, declaration }` |
| `PUT /v1/registrations/:id/teacher` `{ teacherId, reason }` | admin, coordinator, finance desk | point 10 |
| `GET /v1/statement?studentId` | the student, a linked parent, staff with student records | §4.5 |
| `GET/POST /v1/charges`, `PUT /:id/cancel` | finance, admin (families read their own) | services, pushed fees |
| `POST /v1/school-fees/push` `{ academicYear, grade? , sectionId?, studentIds?, dueAt }` | finance admin, admin | §3.6 |
| `GET /v1/board-services` | staff; families read | the catalogue of services |
| `POST /v1/exceptions` `{ policyKey, studentId, scope, value?, validUntil?, reason }` | per the registry | §3.7 |
| `GET /v1/policies` | staff | the registry with sentences |
| `GET/POST /v1/messages`, `/audiences/resolve`, `/templates`, `/deliveries` | admin (finance for payment batches) | §3.8 |
| `GET/PUT /v1/reminders/rules`, `GET /v1/reminders/sent` | admin, finance admin | §3.8 |

Every new endpoint gets its row in `authz-policy.tsv`; every id belonging to a family gets a
cross-family case in 05. Removed: `PUT /v1/sessions/:id/board-series` (the attach is automatic),
`POST …/board-series/move` (kept, admin only, behind the item's series change),
`/registrations/available` (replaced).

---

## 6. Where the policies are applied (the hooks)

| Hook | Called by | Reads |
|---|---|---|
| `priceLine(item, entryKind, student, session)` | every path that creates or re-prices a line (request, direct, desk, override, preregistration, swap) | `board_fee`, the offer's fees, the pricing settings, the student's active price exceptions |
| `assertLineRules(tx, student, session, lines)` | the same paths, inside the transaction after `assertMayRegisterForInTx` | availability, self-study gate, required items, prior series, grade-10 core, the student's gate exceptions (each used once when one-shot) |
| `refundPercentFor(line, at)` | drops, swaps, cancellations | the session's materialised windows (per offer when overridden), `refund.percent` and `refund.courseStart` exceptions |
| `dueDateFor(line | charge)` | line creation, the statement, reminders | the session's `payment_due_at`, `deadline.payment` exceptions, never after the series' deadline |
| `sessionWindow(student, session, seriesId)` | as today | `deadline.window` exceptions |
| `schoolFeeGateReason` | as today | `gate.schoolFee` exceptions |

Every hook reads its exceptions `FOR SHARE` in the transaction that relies on them, as F0a does
for the grade-10 exception; a revocation takes the row `FOR UPDATE` and re-checks what rested
on it (a used one-shot gate stays used).

---

## 7. Migration (the protocol of FEATURES_PLAN.md §3)

Generated migrations on top of main's journal (0041 is free on main; the frozen branches'
0041–0043 are theirs to regenerate when they resume), with custom backfills:

1. **Structure**: the new tables (§3.2, §3.4, §3.5 consent, §3.6, §3.7 columns, §3.8), the new
   columns, the relaxed uniqueness on sessions and the new partial unique index on lines
   (created after the backfill).
2. **Backfill, idempotent**: every window becomes a session (`june` stays; `october` /
   `november` → `winter` of its year; `january` → `winter` of the year before; the level dropped;
   `label` = the old level when two windows of one kind and year differ in dates; the name
   derived and the old one kept in `edit_history`); every active subject offered at the window's
   level becomes an offer with availability `open`, course fee = `subject.course_fee`,
   `grade10_core` = `subject.is_core`, teachers = the subject's linked teachers (`in_school`),
   one item "whole subject" entering what the subject maps to (or the row itself when unmapped),
   in the series the window's route or default gave; a `board_fee` row per (series, what it
   enters) = `subject.registration_fee`; every live line gets the offer's whole item,
   `entry_kind` from `is_retake` and `taken_outside_school`, `due_at` = the window's end;
   existing exceptions mapped to policy keys; `refund_window` rows re-labelled as the session's
   materialised policy; remark fees and deadlines copied into `board_fee` and `board_service`;
   scheduled announcements into messages. Each converted row is audited once
   (`REWORK_BACKFILL_*`); a window that cannot be converted (no subject at its level and lines in
   it) fails the migration naming it.
3. **Drop**: `session_subject_series`, the window's level column, the old exception type column
   (after the key column is filled).

Proven as F0b's was: on a copy of the template dev data and of F0a's richer copy, before and
after dumps in `.audit/rework-evidence/`, every line keeping its price, series and payment; 09
green over the converted rows.

---

## 8. Tests (the proof)

New suites `08n-session-offers`, `08o-reservation-lines`, `08p-pricing-policies`,
`08q-charges`, `08r-exceptions-registry`, `08s-messages-reminders`, `08t-rework-races`, cases in
04 (authz) and 05 (cross-family), rules in 09. Scenarios the forms dictate:

| Scenario | From |
|---|---|
| a June session copied from the previous June: offers, teachers, items, fees asked per series; the derived name; Oxford's series created with no deadline and the warning | §4.1, G-29 |
| a Pearson IAL subject with units in two series of one winter session; MO-10 closes each unit's lines at its own deadline | SCHOOL_FORMS.md §2.4 |
| Biology IAL: papers 5 and 6 first entry, papers 1–4 self-study only; a first entry on paper 1 refused; a retake self-study on paper 1 priced at 50% course and 100% board | §2.3 row 2, A-16 |
| Cambridge Physics: AS in school; A2 carry-forward self-study only, needing the carried series; A Level; the three prices from the fee grid | §2.3 row 7, §3.1 |
| Arabic Edexcel: two items of two qualifications, the teacher choosing the item | §2.3 row 1, Q-16 |
| a one-paper retake (Paper 4 only, from June 2026) at its own fee; refused without a prior series; granted by exception | §2.2, Q-13 |
| self-study on a first entry refused; granted by `gate.selfStudyFirstEntry`; the exception used once | G-09 |
| a required item missing refused; granted by exception | point 2 |
| a retake detected from an earlier line and from an F4 result; `retake_taught` at 100% | §2.5 |
| the teacher changed on a paid line: the enrolment and the group move, the price does not | point 10 |
| a drop at week 3 of June refunds 50%, at week 7 of winter 0%; an offer starting later than the session shifts its windows; `refund.courseStart` moves one student's | G-19 |
| consent required in the app, ticked once at the desk; a line without consent cannot be confirmed | G-20 |
| a cash-in charge, a certificate-split charge and a pushed school fee in one checkout with a line, one payment per deadline; the receipt; a reversal; takings | §3.6 |
| a Cambridge remark priced per component at the AS rate from the fee grid; the grade changes; the refund of fee − 100 to escrow | §3.3 of SCHOOL_FORMS |
| grade 10 registered in bulk; a second commit changes nothing; a grade-10 family's own reservation must include the core offers | A-15 |
| a due date past the series' deadline refused; `deadline.payment` moves one family's | §3.5 |
| a payment reminder sent at −7, −3, 0, +3, repeating until paid; two scheduler instances send once; the delivery log | §3.8 |
| a batch message to a session's unpaid families; a direct message; families cannot delete | §3.8 |
| races: two desks reserving one item for one student; an item's series changed while a checkout is open (refused, as F0b); a fee changed while a line is being priced (the line holds the fee row `FOR SHARE`); an exception revoked while a line relies on it | §6 |

09 adds: every live line has an item of its offer and a series of its item; every line's price
equals its basis; every charge paid is covered by exactly one completed payment and every
completed payment's charges are paid; every one-shot gate exception is used at most once; every
reminder sent has its claim row; every converted window has a session and every converted line
an item (after the migration).

The money assertions of 08–08m stay as they are except where a window's level or `subjectIds`
shape is in the input (pre-authorised, one trail row each, the money outcome unchanged).

---

## 9. Build order (Phase 3), two or three agents at most

| Step | Agent | Delivers | Depends on |
|---|---|---|---|
| 1 | **A — Sessions, offers, fees** | §3.1–§3.4, the migration (§7), the Sessions and Session screens with the Fees and Grade 10 tabs, `priceLine`, `/offers` for families (read), the pricing settings; 08n, 08p, the conversion proof | — |
| 2 | **B — Reservations** | §3.5, consent, the teacher change, the desk and the family's Reserve pages, the Statement, the Money tab; 08o; the frozen F0b money assertions re-shaped | A's contract: `session_offer_item`, `priceLine`, `/offers` |
| 2 | **C — Exceptions, charges, policies** | §3.6, §3.7, the registry and hooks (§6), the Exceptions screen, board services, the remark fee as a charge, the school-fee push; 08q, 08r | A's `priceLine` signature; B calls the hooks (a contract agreed in writing before B and C start) |
| 3 | **D — Messages and reminders** | §3.8, the Messages screen, the scheduler step; 08s | B's lines and C's charges for the batch audiences |
| 4 | the lead | the end-to-end check on one running system, the step counts of §11 measured, the UI audit of these screens, the walkthrough regenerated (F8) | all |

Each step: one Opus 5.5 implementer, one Opus 5.5 reviewer, the lead's review on a running
system, merge on green (FEATURES_PLAN.md §4, §5 apply unchanged: Hono RPC, the audit row in the
transaction, row locks, `authz-policy.tsv`, 05, 09, trail rows through `scripts/trail-row.py`).
A's contract is published in `docs/features/RESERVATIONS.md` §"Contracts" before B and C start;
B and C run in parallel on their own worktrees, branches and databases.

**The frozen work after step 2.** F1 (scheduling) rebases: its groups already come from
enrolment, which the lines feed through F0b; its three required flags are fixed on the rebased
branch. F4 (exam entries) replaces `entryItemsFor` with the lines' items (simpler: the item says
what it enters, the carried-from series is recorded) and resumes its review. F7 (import) maps
sheet rows to offers and items, the fee note to `entry_kind`, and resumes. F2 (campus leave) is
independent of the session model and resumes after F1. The preview branch and the walkthrough
are rebuilt last (F8).

---

## 10. Contracts

| For | Contract |
|---|---|
| F1 | `getTeachingDemand` unchanged; a line's teacher (or its change) reaches the group through `upsertEnrolments(source: 'registrations')` |
| F4 | `lineItemsFor(registrationIds)`: per line the item, what it enters (unit ids or option or award), the series, `entry_kind`, `carried_from_series_id`, the student's grade and level code; replaces `entryItemsFor`; a `cash_in` charge is an award entry to derive |
| F5 | unchanged (the catalogue) |
| F7 | `findOffer(sessionId, term)`, `findItem(offerId, label)`, `priceLine` for the imported lines' prices (0 until the fee grids exist), `entry_kind` from the sheet's fee note |
| F8 | the demo school script seeds a June and a winter session from a fixture shaped like SCHOOL_FORMS.md §2 |

---

## 11. The step counts (UX_AUDIT.md §4)

The school's own process is the baseline (the forms and the sheet), then today's system (from
the survey of today's screens, §15), then this design.

| Task | The school today | Our system today (§15) | This design |
|---|---|---|---|
| Open a June cycle with 25 subjects, their teachers and fees | build or copy-edit 25 Google Forms (about 12 questions each; the series left wrong on one), type the links sheet, print two fee PDFs | **three windows** (one per level), each with its series panel and deadlines, then every subject created and its teachers linked one modal at a time: **162–237 inputs, 127–152 clicks**, seven things to remember; no screen shows the session's subjects with teachers and fees | New session: 5 inputs; "Copy from June 2026": 1 click; per changed subject 1–3 inputs; fees: one paste per series. One screen is the links sheet |
| A family reserves three subjects, one a self-study retake | three forms, 7 identity questions each, plus the subject's 2–4 choices and 3 consents: about 35 answers | the family: 4 steps on one page; **a walk-in family's retake cannot be set** (retake is derived from history only; the officer needs an exception first) | one page: 3 ticks, 1 teacher pick where the offer has several, 2 consents; the retake pre-set or declared with its sitting |
| The desk takes the family's money for them | read the sheet, write the fee note, write a paper receipt | onboard (7 inputs), find the student again, register (5–6 inputs), collect: **13–16 inputs, 5–6 clicks** plus a hand-over per receipt; the price shown omits exceptions | the same page: "Reserve and collect", instrument, done; receipts printed; the price shown is the price charged |
| Know who has paid | the sheet against the receipt book | the finance workbench (pending only) and the Student 360 one student at a time; nothing per session | the session's Money tab |
| Lift a rule for one family | a note in the sheet ("Self Study 20%") | 6–8 inputs, 1 click, one of seven types; the subject list mixes every level; self-study on a first entry has no type at all | one exception: student, policy, scope, value, reason; every policy |
| Set the refund windows | the policy text on the form | **15–18 inputs, 3 clicks** per session, on the School fees page, absolute dates typed, the form resetting after each row, ends at UTC midnight, no edit | copied from the type's policy at creation; one date (course start) |
| Remind unpaid families | by hand | not possible (one 24-hour closing reminder); "parents of grade 11" cannot be targeted | a rule once; or "Remind" on the Money tab; any list as an audience |

The design's numbers are measured on the running system before Phase 3 closes.

---

## 12. Decisions and why

- **One session per cycle, levels per subject.** The forms have one cycle; the school's windows
  per level were ours. F0a's eligibility and F0b's series rules read the session's academic year
  and kind, which one cycle has.
- **Items, not more subject rows.** The sheet registers units as rows (IS-01) and F0b made rows
  of them; the forms show the family one subject with its units under it. The line keeps the
  subject for the ledger's readers and adds the item for the board.
- **Board series attached, never assembled.** The admin called them confusing and redundant.
  They remain the hard stop's home (MO-10, the owner's decision) and F0b's rules stay true;
  only the hand assembly goes.
- **Fees per unit per series.** The fee lists are per series and differ per series for the same
  unit; a constant per subject could not hold them.
- **The 50% on the course fee by default, the board fee whole.** The forms say "School fees";
  A-16; a setting either way; Q-12 to the admin.
- **The refund policy in weeks, materialised into the existing windows.** The forms count from
  the first lesson; the refund computation is proven and stays.
- **Charges, not a second ledger.** New money kinds join the one pipeline; the 09 invariants
  extend by rows, not by a new model.
- **A registry of policies, not more exception types.** "Everything can have an exception" is a
  registry where each policy names its hook; the screen reads the registry.
- **Messages write notifications.** Families keep the notification centre they have; the admin
  gets audiences, templates and a delivery log around it; WhatsApp is a channel with no sender
  until the school has a business account (the owner, 7 Oct).
- **Instalments deferred.** A partial payment breaks "a payment equals what it covers" (09);
  until Q-15 is answered, a moved due date is the tool.
- **The entry deadline has no exception.** The owner decided the hard stop (MO-10); the admin
  moves the series' deadline itself if the school's policy changes.
- **Grade 10 registered by the school.** No form has a grade-10 class (A-15); the family's own
  path still enforces the core subjects if a grade-10 family reserves.

## 13. The prototype

`docs/prototype/reservations-rework.html` (self-contained, no backend, fixture data shaped like
SCHOOL_FORMS.md §2 with placeholder teacher names): the Session screen with the Subjects, Fees,
Money and Grade 10 tabs, the offer drawer, the desk's Reserve page with the running total, the
Statement, the Exceptions picker with its sentence, and the Messages page. It is for the
owner's review and for showing the admin; the build follows the design, not the prototype's
pixels.

## 14. Review

The Opus 5.5 review of this design and the lead's answers are recorded in §16 and in
`.audit/school-forms.tsv`.

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

## 16. The review round

(after the Opus 5.5 review)
