# The reservations rework — sessions, reservations, fees, exceptions, notifications

**Date:** 7 October 2026 (version 8, after six Opus 5.5 reviews and two diff checks — §16)
**Status:** design for the owner's review (Phase 2 of FEATURES_PLAN.md §0c). Nothing here is
built. The questions only the owner can answer are in §17.
**Inputs:** `SCHOOL_FORMS.md` (every form and option, the fee lists, the 30-row gap map, the
admin's eleven points), the owner's confirmation of that reading (7 Oct), DISCOVERY.md (A-15,
A-16, Q-10 to Q-21), the system as built (F0a `docs/features/FOUNDATION.md`, F0b
`docs/features/CATALOGUE.md`, MONEY_AUDIT.md, the 09 invariants), the frozen branches F1, F2,
F4, F7, the Opus 5.5 survey of today's screens (§15) and the six Opus 5.5 reviews (§16).

**The one sentence.** The school's links sheet — subject, board, teachers, what can be entered —
becomes the session screen; a family's reservation is one line per paper or route with the
form's own choices; the fee is what the fee lists say per unit per series; every rule the forms
express is a policy an exception can lift; and the money core underneath changes in the places
§3.10 names and nowhere else.

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
hard stop the owner decided (MO-10; §17 Q-20 asks whether it may ever have an exception), and
the session screen tells her when one is missing.

---

## 2. Principles (each traceable to the owner's words or an artefact)

1. **The form is the floor.** Every element of the forms (SCHOOL_FORMS.md §2) is one field or
   one derived fact here; nothing is asked that the form does not ask, and what the system
   already knows (class, guardian, the teacher pool) is never asked. Where the form trusts the
   family (a retake, the sitting it carries from), the system trusts and verifies (§3.5).
2. **A session is its subjects.** Type and year make the session; the name is derived; the
   subjects with their teachers, papers and fees are the session's content (point 7).
3. **A reservation line is what the board sees.** One line = one paper set, unit or route, priced
   on its own, entered in one board series, cut off at that series' deadline (IS-01, MO-10).
4. **Fees are the fee lists.** Board fees per unit or option per series, course fees per subject
   per cycle; a line snapshots both; provisional until the board publishes (§3.4).
5. **Policies are settings, exceptions lift them.** Every percentage, deadline and gate is a
   named policy with a default; an exception is (policy, scope, value, until, reason) on one
   screen (point 9).
6. **Staff do everything the family can, in no more steps than the form** (UX_AUDIT.md §4; §11
   counts).
7. **The money core changes only where §3.10 says.** Escrow, takings, the receipt lifecycle,
   the held wallet, reversal maker-checker, MO-11, MO-21, MO-24 keep their tables, services and
   tests; what changes is listed with the assertions it moves.
8. **No copy-and-edit.** A session is copied from the previous one of its kind, fees re-entered
   per series, and the family's page is generated from it (G-29).

---

## 3. The model

### 3.1 Session (`registration_session`, changed)

| Field | Was | Becomes |
|---|---|---|
| `name` | typed | **derived**: "June 2027"; "November 2026 – January 2027"; a converted window keeps a `label` (§7) that the name appends |
| `session_type` | `june` / `october` / `november` / `january`, one month | **`june`** (feeds the June series of every board) or **`winter`** (feeds the boards' October and November of the year and January of the next); `series_year` = the June year, or the winter's November year. `GRADUATE_RETAKE_SESSION_TYPES` gains `winter` (A-12 holds for a winter session); `A_LEVEL_ONLY_SESSION_TYPES` and the window-level check are **retired** — the rule "IGCSE sits neither October nor January" is checked per item (§3.3), so a session holding IGCSE November items and IAL October items is valid |
| `qualification_level` | one level per window | kept **nullable and unread** for one release, then dropped; one session per cycle, levels per subject (G-01, G-12) |
| `start_date`, `end_date` | the window | kept: when families may reserve. **The cut-off is per item, not per session** (§3.3): the session may stay open past a series' deadline; what that series' items can do ends at that deadline |
| — | | `course_starts_on`: the cycle's first lesson, the refund anchor (G-19). **Precedence of the anchor for a line** (Q-11's default): an exception `refund.courseStart` for the student › the first lesson of the student's teaching group for the offer and unit when F1 knows it › the offer's `course_starts_on` › the session's |
| — | | `refund_policy`: steps in weeks from the anchor, copied from the setting of the type at creation (June: 100 to week 2, 50 in week 3, 0 from week 4; winter: 100 to week 2, 50 in weeks 3–6, 0 after), editable **until the first line of the session carries a consent**; after that, only an exception changes one student's. **What a line's snapshot freezes is the steps** (the policy the family read); **the anchor is resolved at refund time** by the precedence above, so a group's first lesson learned later or an exception granted later still moves the start. A converted session that is still open has no policy: a new line in it snapshots the session's absolute refund windows as steps (dates, not weeks), so one reading serves both |
| — | | `payment_due_at`: the date every line of the session is due unless an exception says otherwise (point 11). Per line it is capped by the line's own series' deadline (`dueDateFor`). A line reserved after it is due `payment.graceDays` (setting, default 7) after reservation; a line whose board fee is provisional is due the later of that and its fee's confirmation plus the grace |
| `status`, close fields, `finalized_at`, `edit_history` | | kept; the close (the session's end), the sweep per series and MO-10 unchanged in meaning |

Uniqueness: one active session per (type, year, label); new sessions have an empty label. Two
active sessions of one (type, year) can exist only through conversion (§7); a student never
holds two live lines entering the same unit or award in one board series, whatever the session
(a rule in `assertLineRules` and in 09). F0a's eligibility (`mayRegisterFor`) judges the
session's academic year and whether it is June exactly as today: a winter session is "not June"
(grade 10 refused without the grade-10 exception; A-12 for graduates), and all its series are in
one academic year (F0b's rule).

**What `due_at` does.** It drives the reminders (§3.8), the Money tab's "overdue" and the
statement; reminders skip a line that cannot be paid yet (provisional fee). It does **not**
expire a line by itself. **What expires a waiting line automatically**, each with its
`REGISTRATION_EXPIRED` reason (the 09 rule that every expired line has one audit row saying why
learns the new reasons): the series' entry deadline, or the retake deadline for a retake line
(MO-10, the sweep); the session's close, as today; `payment.expireOverdueAfterDays` when a
session turns it on (setting, default off); a rejected declaration (§3.5, `declaration_rejected`); a plan revoked or lapsed, or an instalment
payment failed on a line that is no longer payable (§3.6, `plan_revoked`, `plan_lapsed`,
`plan_ended`).
A paid line is expired by none of these; the deadline sweep's `hold` case **drops** a paid line
through the receipt-gated drop (§3.5).

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
mode reaches F1 as the group's `delivery` (an online group is timetabled without a room;
a provider's group has no lessons) (§10).

**Items** (`session_offer_item`): what a family can tick under the subject. Fields: `label` (as
the form words it), `enters` (one of: the whole award; a `qualification_option_id`; a set of
`unit_ids`; the subject row itself when unmapped), `board_series_id` (§3.3; null only on a
converted item of a window that fed no series), `availability` (as the offer's, per item),
`course_fee` (null: the offer's; IAL units and one-paper retakes are priced per item),
`board_fee_key` (what the series' fee grid is read for: by default what the item enters; a
one-paper item of a board that prices the qualification reads the qualification, Q-13),
`needs_prior_series` (default from the catalogue: a carry-forward option; set by hand for a
one-paper retake that carries the other components), `teacher_ids[]` (null: the offer's; IAL
Mathematics names a teacher per unit), `required_in_series` (a first entry of this subject in
that series must include it), `exclusive_group` (items of one group cannot be reserved
together: "whole subject" and "Paper 4 only"; "AS" and "A Level in one sitting"; units have no
group and combine freely), `sort_order`. One line per (student, session, item).

| Subject on the forms | Items generated from the catalogue (editable) |
|---|---|
| an IGCSE subject (Cambridge, Pearson, Oxford) | **Whole subject** (the award, its option code from the catalogue), plus the one-paper retake items the school offers: Cambridge sciences "Paper 4 only (retake)", ICT "Theory paper only (retake)", Edexcel Mathematics "Paper 1H only", "Paper 2H only", Arabic "Paper 1 only", "Paper 2 only" — availability `retake_only`, in one exclusive group with the whole subject; `needs_prior_series` on the Cambridge ones (components carried), not on Edexcel 1H/2H (the form does not ask) |
| a Pearson IAL subject | one item per unit (P1, P2, P3, P4, M1, S1; WBI11–WBI16), each in its series (winter: Pearson's October by default, January selectable), each with its own teachers and fee; the AS and A Level cash-ins as award items when the school claims them (a `cash_in` charge, F4) |
| a Cambridge A Level subject | the routes, one exclusive group: **AS** (option S1/S2), **A2, carry forward** (option BY/CT, `needs_prior_series`), **A Level** (option AX/HX) — one price each (SCHOOL_FORMS.md §3.1); Chemistry and French: AS and A Level only |
| Arabic A Level (Edexcel) | two items entering two qualifications (IAL YAA01/WAA01–02; GCE 9AA1), one exclusive group, each with its own teacher (Q-16) |

The catalogue (F0b) already holds units, awards, option codes and `qualification_unit`
(required, optional, choice group); the items only choose and label them. **Where the parent
subject comes from**: F0b made each IAL unit its own registrable row ("P1"). The coordinator
creates the parent row ("Mathematics A.S./A.L.", a registrable row entering several units) on
the Catalogue when the school moves to per-item offers; the old unit rows stay as subjects for
their history. Nothing that matters is keyed on the subject row alone: a retake is known by
**what the item enters** (unit ids, option, award), exceptions may scope by subject or by item
(an exception scoped to an old unit row is listed under "Check these" when a parent row is
created, §3.7), and enrolment and groups are keyed by **the unit when one is set, else the
subject** (one open enrolment per (student, unit, year) or per (student, subject, year) with
no unit: a partial unique index each, so a nullable `unit_id` needs no `NULLS NOT DISTINCT`)
(§10), so the same unit under two subject rows does not split a student's history. An unmapped AS or A Level subject can be offered with
one item entering the row itself (its fee keyed on the row); the Catalogue screen lists it to
map, and F4 cannot derive its entry until it is.

### 3.3 Board series, attached by item; the cut-off per item

A series is attached to the session **when an item is placed in it** and detached when no item
and no line (live or history) references it: `session_board_series` stays as the derived link
that F0b's rules and the 09 invariants read. An item's default series: June — the board's June
of the year; winter — for an IGCSE item the board's **November** (IGCSE sits neither October
nor January: F0b's rule, now per item), for an AS or A2 unit or award **Pearson's October**,
**Cambridge's and Oxford's November** (neither sits October), with January selectable for AS
and A2 items of boards that sit it; the unlabelled series of that (board, month, year) by
default, a labelled one selectable. The school's fee list calls Pearson's IAL October series
"November 2026": the series is shown with its board name and month and the session's own
word beside it ("Pearson Edexcel October 2026 — the school's 'November 2026' IAL list"), and the
fee grid is pasted into the series the items use. A series not yet on record is **created**
with no deadline and the session screen warns ("Pearson Edexcel October 2026: entry deadline
not set"). The item's series is changed per item (Biology units 1–2 to November, 3–4 to
January); a change moves the item's live lines with F0b's guards (no move across deadlines while
a checkout is open) and audit rows. `session_subject_series` (routes per subject) is **replaced**
by the item's series; the routing trigger `catalogue_route_registration()` (0038) is rewritten
to read the line's item (§7).

**The cut-off is per item (the change to F0b's window rule).** F0b required a window to close
before the entry deadline of every series it feeds, so that the sweep never ran inside an open
window. One winter cycle feeds series whose deadlines fall weeks apart (Cambridge November
first entries in mid-August with retakes to late September, IAL October in late August,
International GCSE November in mid-September, IAL January in mid-October:
DISCOVERY_RESEARCH.md §2) and the school's forms for it are open from early summer to October,
so that rule would close January's items with October's or refuse October altogether. Under the
rework the session's `end_date` is only when new reservations stop; **each item is reservable
until its series' deadline** (`routeAndCheck` already refuses an item whose series' deadline
passed) — and a **retake line until the series' retake deadline** where the board sets one
(`board_series.retake_deadline`: on record since F0b as an information-only date; it becomes
an instant with the entry deadline's rules — the admin's alone, a reason, in the future when
set, audited — and applies to a line whose verified or declared prior sitting is **the board's
latest series before this one** (the rule below), which is what Cambridge's later date covers;
every other line keeps the entry deadline). A line's **effective deadline** is therefore the
retake deadline when that applies, else the entry deadline, and every site that reads
`entry_deadline` today reads the effective deadline per line: `sessionWindow`
(`window.services.ts`, which serves checkout, confirmation, approval and desk collection),
`routeAndCheck` / `assertRoutesOpen` (with the line's attempt and prior sitting),
`seriesDeadlineGroups` and `openCheckoutsSpanningDeadlines` and 09's "one deadline per open
payment" (grouped by the effective deadline — that 09 rule reads it; what the other per-series
rules read is said below), `enforcePaymentDeadlines` (two passes per series: first
entries at the entry deadline, qualifying retakes at the retake deadline),
`submitInstapayReference` and `referenceDueFor` in `finalizePendingRecords` (the InstaPay cap
at submission and at the close), `moveRegistrations` (the admin's move between series),
`cancelPreregistration`, preregistration capture, `dueDateFor`, and "sent" (§3.9: a
qualifying retake line is sent at its retake deadline). "Qualifying" is decided from the
line's prior sitting alone: it qualifies when that sitting is **the board's latest series
before this one** in the board's calendar order (year, month, label), which is what Cambridge's
later date covers; no table of syllabuses per series is needed. The sweep closes that series'
lines at its deadline inside the open session (expire the waiting ones, fail their open
payments with escrow back, tell the families — exactly what it does today for a later series
after the window closed), and an InstaPay checkout's time to send a reference is capped by its
own series' deadline as today. MO-10 keeps its meaning: nothing is entered, paid or confirmed
for a series after its deadline.

**Every site that enforces the old rule changes** (the second review found the database rule;
the third found the services): in the database function of 0038, only the clause
`window_closes_before_series_deadline` goes — the academic-year, kind and board clauses of
`catalogue_window_series_check`, `registration_session_series_check` and
`board_series_window_check` stay; in the services, `windowAfterEntryDeadline`
(`session.routes.ts`), `updateDraftSession` and `activateSession` (`session.services.ts`: a
session may open after one of its series' deadlines has passed; that series' items are simply
closed), `autoManageSessions` (opens a draft at its start date even past a deadline, for the
same reason), `updateBoardSeries` and `seriesMisfit` (`series.services.ts`: a deadline may fall
before a feeding session's end; it must still be in the future when set, a service check as
today, so that tests may backdate one). **Preregistration capture asks per series**
(`capturePreregistrationsForSession`, on the scheduler's tick, on manual activation and on
recovery): the deadline check comes **before** the eligibility check, per row, reusing
`refundPreregistrationsAtDeadline`'s own row logic: a **paid** held preregistration whose
series' deadline has passed is not captured but refunded in full as MO-21 says (the series
never opened for it), in the capture's transaction with its audit row; an **unfunded** one
expires as that function expires it; one with an **open payment** is left for that payment's
own deadline sweep; a row **held as ineligible under SO-4** is left as it is (the owner's
decision stands) — so no held money is confirmed for an entry the board refuses, and nothing
the owner has not decided is refunded by a tick; 08's and 08m's MO-21 scenarios gain these
cases. **Drops and swaps** (`swap.services.ts`, which today check only that the session is
active) learn the per-item rule too: a family's own drop or swap of a line whose **effective**
deadline has passed is refused ("the entry is with the board; ask the desk"); the desk drops it
through a new endpoint (`POST /v1/registrations/:id/desk-drop`, finance desk and admin, a
reason, the receipt gate as today, §5), with F4's withdrawal when F4 is live, refunded by the
"sent" rule (§3.9). **A series with no deadline** is reservable and payable until its
`exams_start`, the same fallback "sent" uses (09's "expired at a deadline ⇒ the deadline had
passed" accepts `exams_start` as that deadline); a series with neither date is not reservable
at all, and the session screen says so beside the subject. Of the 09 rules per series: "a
registration expired at an entry deadline was in a series whose deadline had passed" reads the
line's effective deadline, or `exams_start` for a series with none; "every open payment's
registrations share one entry deadline" reads the effective deadline; the held-wallet rule
gains the plans' instalments (§3.10 item 6); the rule "every window closes before the entry
deadline of every series it feeds" loses its deadline clause and keeps its academic-year and
kind clauses;
no wall-clock rule is added, because the suites backdate deadlines to make the sweep run
(08i, 08m) — the service check and 08i's scenarios are the proof that nothing is reserved after
a deadline. 08i's and 08k's window-end-versus-deadline scenarios change accordingly
(pre-authorised, one trail row each, the per-series money outcomes kept).

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
column). An item with no fee row at all cannot be reserved (nor imported, §10) until one is set
(or set 0 with a reason).

**Provisional fees** (the June 2027 board fees are not published when the school opens its
forms in September): an item with a provisional fee **can be reserved**; the line is marked
`price_provisional` and the family sees "board fee provisional, confirmed before payment".
"Confirm" on a grid row (at the same or another amount) clears `provisional`; when the amount
differs, **"Re-price unpaid lines"** (one audited batch per series, `LINE_REPRICED` per line,
the family told the old and new price) re-prices the **board part only** of every line of that key
that **has no payment history at all** (no `payment_registration` row of any status: 09's "a
payment charges exactly the price of what it covers" reads payments of every status, so a line
once in a checkout keeps the price that checkout saw) — the re-price **locks the lines
`FOR UPDATE` first and reads their payment history after**, so a checkout that commits while
it waits is seen (08t forces the race) — re-applying the exceptions recorded in the line's
`pricing_basis` (not the student's current ones); every other line of the key — paid,
in an open or a failed checkout, under an instalment plan — is **listed, not touched**, and a
difference on it is a `price_adjustment` charge or a refund to escrow, finance's explicit act
with a reason. A line cannot be paid while its fee row is provisional unless the setting
`pricing.payOnProvisionalFee` is on (default off): the checkout and the desk refuse it with the
sentence; its due date and reminders follow §3.1.

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
board = the series' fee × the mode's board percent; then the price exceptions **in today's
order** (`exception.services.ts`: a custom price first, which replaces the total with the board
fee folded in; else percent discounts, then a fixed discount); total = course + board. The result
and its basis (`pricing_basis` json: attempt, mode, percents, fee rows with their provisional
flag, exception ids) are snapshotted on the line so the receipt and the statement say why the
price is what it is. The 09 rule "price = course + registration fee" holds unchanged.

### 3.5 Reservation line (`registration`, changed)

| Field | Change |
|---|---|
| `subject_id` | kept: **the offer's subject** (for a unit line, the parent subject; a unit row that exists as its own subject today stays one, with an offer of one item) |
| `offer_item_id` | **new**, not null after the backfill: what the line enters |
| `attempt` | **new**: `first` or `retake` — the form's "First Entry" against "Retake" |
| `mode` | **new**: `in_school` or `self_study` — the form's teacher choice against "Self Study"; the two together are the Arabic form's options (first in school; retake in school; retake self-study; and first entry self-study, allowed where the school does not teach the item or by exception) |
| `prior_sitting_series_id`, `prior_sitting_source` | **new**: the sitting a retake or a carry-forward carries from (Q-13); source `known` (an earlier line or an F4 result for what the item enters), `declared_by_desk`, `declared_by_family`, `legacy` (a converted retake with no history); a declared one is **verified** (below) |
| `prior_centre`, `prior_candidate_number` | **new**, on a verified carry-forward from another centre (F4 needs them for the entry; asked at verification, never shown in lists) |
| `is_retake`, `taken_outside_school` | kept for the ledger's readers; written from `attempt` and `mode` |
| `teacher_id` | kept; from the item's or offer's teachers, **"no preference yet" allowed** when the offer has several (the coordinator assigns later, F1); null in self-study; **changeable** by the admin, the coordinator and the finance desk (the family asks there) with a reason, audited; the enrolment and the group follow (§10); a change to self-study on a paid line does **not** re-price it (a refund is finance's explicit act) |
| `board_series_id` | kept; from the item |
| `due_at` | **new** (§3.1) |
| `price_provisional`, `pricing_basis` | **new** (§3.4) |
| `refund_policy_snapshot` | **new**: the policy steps the family consented to (§3.1; the anchor is resolved at refund time); null on a converted line, which keeps its window's absolute refund windows |
| `legacy` | **new** json: what the conversion could not know (`converted: true`, `no_series: true`, `retake_history_unknown: true`) so the 09 rules can read it |
| unique index | (student, session, **offer_item**) where live — P1 and P2 under one subject are two lines; the exclusive group and the "same unit or award in one series" rule are checked in `assertLineRules` |

Statuses, the parent's approval of a student's request, the direct registration, the admin
override, the desk, preregistration, drops and swaps keep their paths; each now takes
`lines: [{ offerItemId, attempt, mode, teacherId?, priorSittingSeriesId? }]` and `consent`
instead of `subjectIds` and `subjectOptions` (`RequestRegistration`, `DirectRegistration`,
`DeskRegistration` change shape; the routes are the same; a pending swap request names an
item, §7 maps old ones to the subject's whole item). A swap's new line inherits the dropped
line's consent; an override and the desk record consent on the `desk` channel; an imported line
records the sheet's confirmation column on the `imported` channel.

**Verification of a declared sitting.** The owner is the **coordinator** (the academic record);
the desk may verify when the family shows the board's statement; F4 verifies from the board's
results when they are imported. The list is the session's **To verify** tab and a reminder rule
to the coordinator. Outcomes: *verified* (the line stands; on a carry-forward from another
centre the coordinator records the previous centre and candidate number); *rejected* on an
**unpaid** line — the line expires with reason `declaration_rejected`, the family is told and
may reserve again as a first entry where the item allows one (an item open to retakes only
cannot be reserved by them at all); *rejected* on a **paid** line — the line stands as paid
with `declaration_rejected: true`: F4 enters it as a **first** entry (the line's `attempt` is
read as `first` by `lineItemsFor` when the declaration was rejected), its self-study mode stands
(the family paid the self-study price and is not taught), the family is told, and finance
decides explicitly (a `price_adjustment` charge for the difference to a first entry's price, or
nothing); *unverified when the line's effective deadline passes* (§3.3: the retake deadline for a
declared retake of the previous series, which means that under `enter_as_declared` a family's
unverified declaration lets its line run to the later deadline — §17 Q-22) — the setting
`verification.unverifiedAtDeadline` says `enter_as_declared` (default: the form trusts the
family; F4 lists it as "declared, unverified" on the entry check) or `hold`: under `hold` the sweep
ends the line at that deadline — a waiting line expires (`hold_unverified`); a **paid** line is
**dropped by the system through the receipt-gated drop** (`executeReceiptGatedDrop`, as the
deadline's preregistration refund already is: the line goes `confirmed` → `dropped`, never
`expired`, and the paper receipt is asked back before cash leaves, MA-16), with that date's
refund (`refundFor` with the board fee counted **not sent**, since a held line was never
entered) to escrow and its audit row, so no paid line is left that can never be entered. A
**paid line whose declaration is rejected after the first-entry deadline has passed** is
dropped the same way, because it cannot be entered as a first entry past that deadline (MO-10)
— but its board fee follows the ordinary per-line "sent" rule (§3.9): under
`enter_as_declared` such a line was sent at its effective deadline or by F4's mark, and the
school does not refund a board fee it has paid; a waiting line rejected then expires with
reason `declaration_rejected`. The family's
sitting picker offers the board's series of the last two years (created as `board_series` rows
with no dates when not yet on record).

**Rules on a line** (each a policy with a key, each exception-able, §3.7):

| Key | Rule | From |
|---|---|---|
| `gate.selfStudyFirstEntry` | `self_study` with `attempt = first` only where the school does not teach the item (availability `self_study_only`) or by exception | every form: "ONLY 2nd entry" (G-09) |
| `gate.retakeDeclared` | `attempt = retake` with no known history needs a declared prior sitting; the family may declare it (the form's "From June 2026"), the desk may; both are verified (above) | the forms trust the family; the winter cycle is mostly re-sits |
| `gate.availability` | an item `retake_only` takes `attempt = retake` only; `self_study_only` takes `mode = self_study` only; `closed` none | the links sheet (G-13) |
| `gate.exclusiveItems` | one line per exclusive group per student per session | §3.2 |
| `gate.sameEntryOnce` | one live line per student entering the same unit or award in one board series, across sessions | §3.1 (converted sessions) |
| `gate.requiredItems` | a first entry of a subject in a series includes its `required_in_series` items; an award claim includes the award's required units (catalogue) or banked results (F4) | point 2 |
| `gate.priorSeries` | an item that `needs_prior_series` has one, before this session's series and within the board's carry-forward period (`exam_board.carry_forward_months`, a column added by step A that F4 reads; a stale option like "November 2025" for a June 2027 Cambridge A2 is refused with the sentence) | the forms' "From June 2026" |
| `gate.grade10Core` | grade 10 in June reserves every `grade10_core` offer | A-05 |
| `gate.schoolFee` | the school fee of the year is paid or waived | as today |
| `deadline.window` | the session is open (or the student's extension) | as today |
| `deadline.boardEntry` | the item's series' entry deadline — **the hard stop today (MO-10)**; the registry carries the key (scope: student × series, since the line does not exist yet), gated off by the setting `exceptions.boardEntryDeadline` until the owner answers §17 Q-20; when on, the board's late fee is a `late_entry_fee` charge | the owner's point 9 against MO-10 |

**Consent** (`registration_consent`, new): per line, `kind` (`refund_policy`, `declaration`),
`text_version`, `confirmed_by`, `channel` (`app`, `desk`, `school` for grade-10 bulk lines the
school registers, `imported`), `at`. A family's own reservation cannot be submitted without
both; the desk ticks "read and signed by the parent" once for the whole reservation (one row
per line); a grade-10 bulk line gets its `school` rows at commit (these satisfy the 09 rule)
and the family's own pair at checkout. The printed reservation slip carries the texts (G-20).

### 3.6 Charges (`charge`, new) — services, pushed fees, instalments, adjustments

A charge is anything a family owes that is not a reservation line, a remark fee or the school
fee itself: `student_id`, `kind` (`cash_in`, `late_cash_in`, `certificate_split`,
`late_entry_fee`, `school_fee_push`, `instalment`, `price_adjustment`, `custom`),
`registration_id` (when it concerns a line), `board_series_id` and `board_service_id` (when a
board's service and fee apply), `description`, `amount`, `due_at`, `status` (`requested` — a
family's request awaiting staff; `pending_payment`; `paid`; `cancelled`; `refunded`),
`refund_amount`, `settled_by_payment_id` (for a push), `created_by`, `reason`. How it is paid,
receipted, reversed and refunded is §3.10.

- **Board services** (`board_service`, new, catalogue): per board, `code`, `label`, `kind`
  (`remark`, `cash_in`, `late_cash_in`, `certificate_split`), `per_component`, `level_rates`
  (IGCSE / AS-A Level), `refund_rule` (`none`, `full`, `less_fixed` with the deduction),
  `requestable_by_family`. Seeded: Cambridge enquiry services 1, 1S, 2, 2S; Pearson's review of
  marking, clerical re-check, access to scripts, cash-in and late cash-in; Oxford's equivalents;
  certificate split for Cambridge and Pearson (Q-17). **Deadlines per series**
  (`board_service_deadline`: series, service, instant) replace `remark_deadline`; a service's
  fee is a `board_service_fee` of the series (its own table beside `board_fee`, carrying the
  level rates and per-paper pricing; built so by step C and accepted at its review, 8 Oct).
- **Remarks keep their own path.** A remark request stays what it is (`remark_request`, its
  states, consent, outcome, its payment with purpose `remark` and the hook that moves it on,
  ST-01); what changes: it picks a `board_service` of the line's board, its fee is read from the
  series' `board_service_fee` (today's `remark_fee_schedule` by council and service becomes the default
  a new series copies; today's service types map: `clerical_check` → Cambridge 1 / Pearson
  clerical; `review_of_marking` → 2 / review of marking; `script_copy` → 1S for Cambridge (a
  copy comes only with a re-check there) / access to scripts for Pearson; `priority_review` →
  Pearson's priority review), and its refund on a changed grade is the **rule's amount**
  (`refund_rule`; Q-21 — until the owner answers, the rule is seeded `full`, today's behaviour).
  Remark payments stay non-reversible as today; a refund credits escrow as today.
- **Cash-in, late cash-in, certificate split** (point 3): charges of their kind on a line or a
  student, with the board fee and deadline of the series; the family may request one
  (`requested` until staff accept) where the service allows, or the desk adds it; F4 turns an
  accepted cash-in into the award entry (G-22); `exam_entry.charge_id` links them.
- **School fee pushed** (point 8): the schedule stays the gate's source; "Push to families"
  on the School fees screen creates a `school_fee_push` charge per chosen student (a grade, a
  section, a list) with the due date, skipping a student whose fee is paid or waived, a graduate
  exempt under A-13, and one with an open push (listed). It appears in the family's pending
  payments and is reminded; paying it goes through the **existing** school-fee payment path
  (purpose `school_fee`, its own payment and `payment_one_school_fee_per_year_idx`): the
  school-fee confirmation marks the open push of that (student, year) `paid` with
  `settled_by_payment_id` in the same transaction; a reversal of that payment reopens it; a
  waiver granted after the push cancels it (the exception's hook). A push is never paid as a
  charge payment.
- **Instalments** (Q-15's default, the owner's): `plan.instalments` (§3.7) on an **unpaid**
  line whose board fee is confirmed (never on a provisional line) creates N `instalment`
  charges with dates and amounts summing to the line's price; the last date is capped by the
  earlier of the session's end and the line's series' deadline. A plan is **live** while its
  line is `pending_payment` and the exception is `active`; finance cancels it by revoking the
  exception. Each instalment is paid as a charge payment (cash, card, InstaPay — **never from
  escrow**, which would be circular) that **credits the family's held wallet, earmarked for the
  line** (the held balance, ledger reason `instalment`, `related_registration_id` = the line, so
  `debitHeld` reads that line's own held sum, never another line's deposits; held money is not
  free, not transferable, not withdrawable, not applicable to another checkout — what "held"
  blocks today); the line stays `pending_payment` with its due date = the last instalment's.
  **The capture at the last instalment is a new, specified payment** (§3.10 item 6): purpose
  `registration`, instrument `held_deposits`, cash amount 0, `escrow_amount_applied` = the
  line's price debited from the line's held sum with ledger reason `plan_capture` and the
  payment's id on the ledger row (`related_payment_id`, so 09's "applied once" rule joins it),
  created and confirmed in one transaction (the money is already in hand; both the creation
  row `PLAN_CAPTURED` and the `PAYMENT_CONFIRMED` row are written, as 09 counts them),
  `payment_registration` written as for any payment, the line's tracked receipt issued naming
  the deposit slips, the line's row locked for the per-line held check; capture refuses a line
  whose effective deadline has passed (the line expires instead); a plan-captured payment is
  **not reversible** (nothing was received that day; the instalment payments reverse one by one
  while the plan is live, and never after capture). Each instalment payment counts in the
  takings on its day; the capture shows in that day's takings only in the escrow-applied
  figure, never in cash. **When the line ends under a live plan** — any
  expiry (the deadline sweep at the line's effective deadline, the session's close, an overdue
  expiry, a rejected declaration, ineligibility, a closed payment: inside
  `expireWaitingRegistrations` **and** in `failOpenPayment`, which expires lines on its own
  today), the plan exception lapsing (the lapse step settles it **and expires the line**,
  reason `plan_lapsed`), or finance revoking the plan (which **expires the line**, reason
  `plan_revoked`, unless finance chooses "release in full and keep the line payable") — **the
  deposits are settled as a drop on that day** (Q-15's default, §17): the school **keeps what a
  paid drop that day, before the entry is sent, would keep**, `keep = min(deposits,
  price − refundFor(line, at))` (ledger
  reason `plan_forfeit`, an audit row, on the statement), and releases the rest to free escrow
  (`plan_release`); nothing is owed beyond the deposits. So the school keeps from a stopped plan
  the same course share that a paid drop made **before the entry is sent** leaves it, capped at
  the deposits: a family that stops paying **never loses more than such a drop**, and loses
  less only when its deposits are below that share, because it can lose only what it paid (the
  worked example in Q-15 shows both cases; a paid drop after the entry is sent leaves the
  school the board fee as well, which a plan line, never entered, never involves). For a line that was never confirmed **no entry was ever
  sent**, so `refundFor` counts its board fee as not sent whatever the date (§3.9). **A plan is
  refused on a line that has an open checkout**; a line under a live plan cannot be reverted to
  approval by the parent (the guard reads the live plan exception, so a plan with nothing paid
  yet is covered too); the session's close and
  the eligibility clean-up spare a line whose last instalment payment is still being checked,
  as they spare a line with an open checkout. The deadline sweep also **fails an open
  instalment payment of a dead plan** (a second query over `payment_charge`, `failPayment` with
  reason `plan_ended`), and confirmation refuses an instalment payment whose plan is no longer
  live; an instalment payment that fails or is rejected runs `failOpenPayment`'s own test on its
  line through the charge (a plan line has no `payment_registration` row for that function to
  find): the line expires, reason `plan_ended`, **only when it is no longer payable** — the
  window closed for the student, the line's effective deadline passed, the student no longer
  eligible — and otherwise the plan stands and the instalment can be paid again (a cancelled
  InstaPay checkout, a declined card or a rejected reference is not a family stopping). An instalment payment issues a **deposit slip**, not a tracked paper receipt (an escrow
  credit has none today); the line's tracked receipt comes at capture, so nothing is out that
  the settlement would have to ask back. Reminders fire per instalment.
- **Price adjustment**: finance's explicit act after a fee change or a verification (§3.4,
  §3.5), with a reason, never automatic.
- **Late entry fee**: only when Q-20 is answered yes and the setting is on.

### 3.7 Exceptions (`exception`, reshaped)

An exception lifts one **policy** for one **scope**. `policy_key` (from the registry below),
scope: `student_id` or `family_id` (a parent account: every linked child; one of the two
required — `student_id` becomes nullable, `family_id` is added) and optionally `session_id`,
`subject_id` (any session), `offer_id`, `offer_item_id`, `registration_id`, `charge_id`,
`board_series_id`, `academic_year`; the value in a typed column (`value_number`, `value_date`,
`value_json` for an instalment schedule; the old `value` column is dropped after the backfill);
`valid_until`, `reason`, `granted_by`, `status` (`active`, `revoked`, `lapsed`, `used` for
one-shot gates). The registry (`@repo/validations`, `POLICIES`) declares for each key: its
label, its sentence, the value type and bounds, the scopes it accepts **and what a null scope
means**, whether it is one-shot, the roles that may grant it, and the hook that applies it.

| Policy key | Lifts | Value | Scopes (null = ) | Granted by |
|---|---|---|---|---|
| `pricing.selfStudyCoursePercent`, `pricing.selfStudyBoardPercent`, `pricing.retakeTaughtCoursePercent`, `pricing.onePaperCoursePercent` | the percents of §3.4 | percent | student/family × session, subject, offer, item, line (null: every session) | finance admin, admin |
| `price.discountPercent`, `price.discountFixed`, `price.custom` | the line's or charge's price (today's three) | percent, amount, amount | … × session, subject, offer, item, line, charge (null: every line) | finance admin, admin |
| `refund.percent` | the refund policy's step (today's custom refund, now on the course fee: §3.9) | percent | … × session, offer, line (null: every session) | finance admin, admin |
| `refund.courseStart` | the anchor for this student's line (joined late) | date | … × offer, line | finance admin, admin |
| `deadline.window` | the session's closing (today's extension; MO-12's "no session = every session" kept) | date | … × session (null: every session) | finance admin, admin |
| `deadline.payment` | a line's, instalment's or charge's due date | date | … × session, line, charge | finance admin, admin |
| `deadline.boardEntry` | the series' entry deadline (**gated off** until Q-20) | date | … × board series | admin |
| `gate.schoolFee` | the fee gate (today's waiver) | — | … × academic year (null: every year, as today) | finance admin, admin |
| `gate.selfStudyFirstEntry` (one-shot) | self-study on a first entry | — | … × offer, item | finance admin, admin |
| `gate.availability` (one-shot) | reserve an item not open to them (retake-only, closed) | — | … × item | admin, coordinator |
| `gate.requiredItems` (one-shot) | a first entry without a required item | — | … × offer | admin, coordinator |
| `gate.priorSeries` (one-shot) | an item needing a prior sitting without one, or outside the carry-forward period | — | … × item | admin, coordinator |
| `gate.exclusiveItems` (one-shot) | two items of one exclusive group | — | … × offer | admin, coordinator |
| `gate.sameEntryOnce` (one-shot) | a second live line on the same unit or award in one series | — | … × board series | admin, coordinator |
| `gate.grade10Core` | grade 10 without a core subject | — | … × session | admin, coordinator |
| `eligibility.grade10OtherSeries` | today's grade-10 exception | — | … × session (null: every series of the grade-10 year, as today) | coordinator, admin |
| `plan.instalments` | one payment per line | schedule (dates, amounts) | … × line | finance admin, admin |

The existing **eight** types map onto keys in the migration (`discount_percent` →
`price.discountPercent`, `discount_fixed` → `price.discountFixed`, `custom_price` →
`price.custom`, `fee_waiver` → `gate.schoolFee`, `deadline_extension` and `late_registration` →
`deadline.window` with `value_date` = their `valid_until`, `custom_refund_percent` →
`refund.percent`, `grade10_other_series` → `eligibility.grade10OtherSeries`). Two meanings
change and are listed: a migrated custom refund percent applies to the course fee (§3.9); a
subject-scoped deadline or refund exception, which today's code never applied
(`exception.services.ts` 177), is migrated with its scope and **listed under "Check these"** for
a finance admin to confirm or revoke before it applies. Every hook that reads an exception today
reads the same rows through the registry. The screen: pick the student or family (or open it
from the Student 360 or a line), pick the policy (grouped: price, refund, deadlines, gates,
plans), the scope narrows itself to what the policy accepts, the sentence previews, a reason,
grant. The Student 360 and every line show the exceptions that touched them.

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

**Reminder rules** (`reminder_rule`, new): `kind` (`payment_due` for lines, instalments and
charges, `session_closing`, `entry_deadline` (staff), `school_fee_due`,
`declared_retakes_to_verify` (the coordinator)), `offsets_days` (−7, −3, 0, +3, +7),
`repeat_every_days` and `until` (`paid`, `closed`, `deadline`, `verified`), `channels`,
`session_id` (null: every session; a session's own rule overrides), `active`.
**`reminder_sent`** (claim table: rule, target, offset, sent at) so two scheduler instances
send once (ST-06, ST-12). The scheduler tick (the existing job) runs due reminders and writes
messages with audience `batch`; a line that cannot be paid yet (provisional fee) is skipped.
Defaults seeded as settings.

### 3.9 What is removed or kept

| Today | After |
|---|---|
| `registration_session.qualification_level`, typed `name`, one active per (type, level) | nullable and unread for one release; derived; one active per (type, year, label) |
| the window-level rules: `A_LEVEL_ONLY_SESSION_TYPES`, the window closes before every fed series' deadline | retired; per item (§3.3) |
| `session_subject_series` (subject routes) | emptied, kept one release; replaced by `session_offer_item.board_series_id`; the routing trigger rewritten |
| `session_board_series` | kept, derived (§3.3) |
| `subject.is_core`, `is_offered_at_school`, `course_fee`, `registration_fee`, `price_in_school`, `custom_price` | `is_core` → `session_offer.grade10_core`; `is_offered_at_school` → the offer's availability; fees → `session_offer(.item).course_fee` and `board_fee`; the subject's columns stay read-only for history |
| `subject_teacher` | kept as the pool |
| `refund_window` (absolute dates) | kept **for converted sessions and academic years only** (their lines have no snapshot and read the windows as today); **no window is materialised from a policy** — one source for the percentage: a new line's `refund_policy_snapshot`; the overlap check and the one-scope check stay as they are; `offer_id` is not added |
| `refund.services.ts` | **changed, not unchanged**: `refundPercentage(date, sessionId, studentId)` becomes `refundFor(line, at)` — the percent from the line's `refund_policy_snapshot` (its anchor by §3.1's precedence) or, for a converted line, from its window's absolute windows as today; then `refund.percent` and `refund.courseStart` exceptions (student, family, offer, line scope; today's `customRefundPercent` reader goes); **the amount = `course_fee_at_registration` × percent + the board fee by its rule** (Q-19's default: the board fee in full while the entry has **not been sent** — "sent" is **per line**: a line never confirmed was never sent, whatever the date; a confirmed line is sent by F4's "mark as sent" when F4 is live, else when its effective deadline has passed, else, for a series with no deadline, when its `exams_start` has passed; 0 after) in the five places that compute `priceAtRegistration × pct` today (`previewRefund`, the three swap legs, the preregistration cancel); **MO-21 keeps 100% of the whole price** (a series that never opened sent nothing and taught nothing); a line under an instalment plan refunds nothing itself (nothing was paid to the line; its deposits are settled by §3.6's rule). A custom-priced line (board fee folded in, course = total, board = 0 as `exception.services.ts` sets them) refunds its total by the course rule and never gets a board fee back, as today it refunds the whole by the window |
| `exception` types and `value` | reshaped onto the registry with typed value columns and a nullable `student_id` plus `family_id` (§3.7) |
| `remark_fee_schedule`, `remark_deadline` | `board_service`, `board_service_fee` per series, `board_service_deadline` per series; the old tables kept one release as the defaults a new series copies; the remark request's states and payment unchanged |
| `scheduled_announcement`, broadcast groups | `message` with audiences; the old rows migrate as broadcasts |
| `computeRegistrationPricing` | `priceLine` |
| `registration.subject_id` | kept; `offer_item_id` added |
| payments, escrow, receipts, takings, reversals, withdrawals, the held wallet | changed only as §3.10 says |

### 3.10 What changes in the money core, and what does not

The 09 invariants and the services are written over registration lines (`payment_registration`),
school-fee payments (purpose `school_fee`, one per year) and remark payments (purpose `remark`,
`metadata.remarkRequestId`, not reversible). Charges are new money, so these things change, and
nothing else:

1. **One purpose per payment, never mixed.** A payment covers registration lines (as today) or
   charges (`purpose = 'charge'`, `payment_charge` rows) or the school fee (as today) or a
   remark fee (as today). The checkout and the desk show one payment per group — lines per
   entry deadline (F0b), charges per service deadline, the school fee, the remark — and the
   desk collects all of them in one action that creates several payments, as the deadline split
   does today. 09's "a registration payment charges exactly the price of what it covers" stands
   unchanged; new rules: a charge payment charges exactly the sum of its charges; an open charge
   payment's charges share one service deadline (the twin of 09:414); no charge is paid twice
   and every paid charge once (a `school_fee_push` is paid by its `settled_by_payment_id`, a
   completed school-fee payment of that student and year, and is excluded from the
   `payment_charge` rule); every charge payment has one creation row
   (`CHARGE_PAYMENT_INITIATED`).
2. **A receipt per charge**, except an `instalment` charge, which issues a deposit slip (§3.6).
   `receipt.registration_id` becomes nullable and `receipt.charge_id` is added, exactly one of
   the two (check), unique per charge; the receipt's lifecycle (handed over, brought back,
   lost, void) and its tests apply as they are.
3. **A charge payment is reversible and a charge refundable.** Reversal follows the registration
   payment's path and MO-11 (did the money go back); the charge returns to `pending_payment`,
   its receipt voided (an instalment's deposit slip marked void); an `instalment` reversal
   debits the held amount it credited (refused when that
   escrow is already spent, as MO-24 refuses an undo of a spent "Transfer found"). A refund (a
   cash-in withdrawn before the board's date; a price adjustment) credits escrow with reason
   `charge_refund`, at most the charge's amount (09), audited in the transaction, by finance
   with a reason, and marks the charge `refunded`; cash leaves the drawer only through the
   existing cash-refund request and its maker-checker.
4. **The sweep covers charges.** A charge tied to a board series (cash-in, late cash-in) is
   closed unpaid at its **service deadline** (`board_service_deadline`), its open payment
   failed with escrow back, the family told — the same clean-up a line gets at its entry
   deadline; an `instalment` charge follows its line: when the line ends, the plan is settled
   as §3.6 says (the school keeps `min(deposits, price − refund)`, the rest is released).
5. **The window rule becomes a per-item rule** (§3.3): the database clause and the services
   named there change; the 09 invariant "every window closes before the entry deadline of every
   series it feeds" loses its deadline clause; **preregistration capture refuses, and
   MO-21-refunds, a held preregistration whose series' deadline has passed**, so the held
   wallet never pays for an entry the board refuses.
6. **The held wallet gains the instalments, and capture gains a payment** (§3.6): held money
   is also the deposits of a live plan, earmarked per line; the plan's capture creates and
   confirms the line's payment from the held sum (instrument `held_deposits`, ledger reason
   `plan_capture`, audit `PLAN_CAPTURED`) — today's preregistration capture creates no payment
   (the preregistration's own payment exists already), so this is a new mechanism, and the 09
   rules extend: "escrow applied to a payment is debited once" accepts `plan_capture` beside
   `payment`; "every capture of held money has its audit row" counts `PLAN_CAPTURED`; MA-15's
   rule becomes "the held wallet holds exactly the paid preregistrations still waiting plus the
   instalments of live plans"; "every payment has exactly one creation row" counts
   `PLAN_CAPTURED`, and the capture writes its `PAYMENT_CONFIRMED` row like any completed
   payment; a new rule: a plan's deposits end as exactly one capture, or at most one release
   and at most one forfeit summing to the net deposits (ledger rows are positive, so a zero part
   is no row). An instalment payment is never funded from escrow; its reversal (MO-24's
   "unspent" test on the line's held sum) debits what it credited; a plan-captured payment is
   not reversible; the capture appears in the takings' escrow-applied figure only.
7. **The checkout and the desk refuse** a line whose board fee is provisional (unless the
   setting allows it) and a second payment for a line under a plan (only the capture pays it);
   the desk's own school-fee collection (`DESK_SCHOOL_FEE_COLLECTED`) marks an open push paid
   like the family's payment does; a `price.*` exception never applies to a push (its amount is
   the schedule's; the waiver is the exception).
8. **New automatic expiries** of a waiting line (§3.1) each write their `REGISTRATION_EXPIRED`
   reason (`overdue`, `declaration_rejected`, `hold_unverified`, `plan_revoked`,
   `plan_lapsed`, `plan_ended` for an instalment failed on a line no longer payable); 09's "every expired
   registration has exactly one audit row saying why" accepts them; `CHARGE_PAYMENT_INITIATED`
   joins the creation actions 09 counts for "every payment has exactly one audit row for its
   creation".
9. **The refund amount** changes as §3.9 says (Q-19), the remark refund as §3.6 says (Q-21,
   today's behaviour until answered).

Untouched: escrow's ledger arithmetic and balances, preregistration capture's own path (it
gains the deadline check of item 5, the student lock first and `assertLineRules`, §6), takings (a charge payment is a payment on its day; a
charge refund to escrow is not money out), reversal maker-checker, cash refunds' hand-over,
MO-10's meaning, MO-21's refund, MO-24, the receipt lifecycle, remark payments.

**Money assertions that change** (each pre-authorised with a trail row, the money outcome
asserted anew): the refund scenarios of `08-money-rules.test.ts` (the 50% window, the 90%
exception, the 0% gap) and `08m-checkout-per-series.test.ts` (the free escrow after a drop)
post windows on a session today; they are **restated** to set the session's policy (so the
line's snapshot carries it) and, under Q-19's default with course 1,000 and board 500 before the
deadline, assert 1,000 instead of 750; 1,400 instead of 1,350; 500 instead of 0; 2,500 instead
of 2,250; **the 50%-of-the-total outside-school rule has no test today** (`takenOutsideSchool`
is set nowhere in the suite), so A-16's rule is proven by a new scenario in 08p, not by a
changed assertion; the window-end-versus-deadline scenarios of 08i and 08k and the MO-21
scenarios of 08 and 08m (§3.3); input shapes (`subjectIds` → `lines`, a window's level). Not
changed: `03-v3-flows.test.ts`'s remark refund (1,600) until Q-21 is answered; the custom
price's semantics.

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
November 2026 – January 2027   open   reserve 1 Jun – 31 Oct 26 …   Pearson Oct 28 Aug (passed: 61 lines entered) · Cambridge Nov 16 Aug (passed), retakes 21 Sep (passed) · Pearson IGCSE Nov 12 Sep (passed) · Pearson Jan 16 Oct (passed)
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
from the pool; three inputs for an IGCSE subject (subject, teachers, course fee), plus one
course fee per one-paper item the school opens and, on an IAL subject, a fee and a teacher per
unit. An offer or item with lines cannot be closed or unticked silently: closing an offer stops
new lines (its lines stand); unticking an item with live lines is refused until they are moved
or dropped, like a series with entries. "Replace teacher" on an offer moves every line and
group of a teacher who leaves to another, audited.

**Fees** tab: one grid per attached series (the PDF's shape: code, title, amount, provisional
mark), paste or type, "copy from Cambridge June 2026" (every row provisional), "Confirm" per
row or grid, "Re-price unpaid lines" when a confirmed amount differs (with the lines it must
skip listed); the board services beside them. **Money** tab (§4.6). **Grade 10** tab: the core
offers ticked; "Register grade 10" previews every grade-10 student's lines and commits them once
(A-15, Q-10): lines `pending_payment`, consent channel `school`, teacher the offer's only one or
none. **To verify** tab: declared sittings awaiting the coordinator (§3.5).

### 4.3 Reserve at the desk (`/desk`, the existing desk, reshaped)

```
Student  [ Student A 11C ▾ ]     Session [ June 2027 ▾ ]      Reserved so far: 2 lines, 1 unpaid
O.L.                                                     teacher          entry                 price
☑ Biology O.L.  (Cambridge)        whole subject       [ no preference ▾ ] [ first entry ▾ ]  24,850 ⓟ
☐   Paper 4 only (retake)                              —                 [ retake, self-study ] from [ June 2026 ▾ ]
☑ Mathematics O.L. (Edexcel)       whole subject       [ — self-study ] [ retake, self-study ] 16,200  ← sat June 2026
☐ Chemistry O.L.  …
A.S. / A.L.
☑ Mathematics A.S./A.L. (IAL)      P1 [ T11 (online) ] first entry 9,800 · P2 [ T11 ] 9,800 · ☐ P3 · ☐ P4 · ☑ M1 [ no preference ▾ ] 9,450 · ☐ S1
──────────────────────────────────────────────────────────────────────────────────────────────────
5 lines · EGP 70,100 · due 30 Nov 2026 · paid per entry deadline: Cambridge 24,850 (ⓟ) · Pearson 45,250
☑ Refund policy and declaration read and signed by the parent
[ Reserve only ]   [ Reserve and collect: cash ▾  escrow 0  → EGP 45,250 now; 24,850 when the fee is confirmed ]
```

A retake is **pre-set** when the system knows the earlier sitting; for a family new to the
system the officer chooses "retake" and names the sitting (`declared_by_desk`, audited, listed
to verify); self-study on a first entry needs an exception. A teacher defaults when the offer
has one; "no preference" is allowed when it has several. The price shown is the price charged,
exceptions included (today's desk shows the price before exceptions, §15); a provisional board
fee is marked and that line is not collected until confirmed. The slip prints with the consent
texts. One action creates the lines and, with "collect", the payments per entry deadline and
per charge group (§3.10), as today's split.

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
Mathematics IAL — P1 (T11, online)      9,800    9,800     0             —          #1043 (12 Oct)
Remark: Chemistry O.L. June 2026, service 2   3,820   3,820   0   —   — (remark fee; refund 3,820 to escrow 18 Oct)
School fee 2026/27                     30,000    30,000    0             —          —
Payments: 12 Oct cash 24,850 (Cambridge June 2027: #1042) · 12 Oct cash 9,800 (Pearson June 2027: #1043) · 12 Oct cash 3,820 (remark) · 5 Sep InstaPay 30,000 (school fee) · Escrow: 3,820 free
```

Every number is from the ledger; the new columns are `due_at`, the pricing basis (hover:
"course 14,000 × 50% + board 9,200 × 100%") and the receipt per line or charge (a school-fee
or a remark payment has no paper receipt today and gets none here). One payment per entry
deadline, as 09 requires.

### 4.6 Money (on the session)

Lines and charges by status with the family, the amount, the due date and days overdue;
filters (unpaid, overdue, by offer, by section, provisional); "Remind" sends the payment
reminder to the selected families now (a batch audience); export. The finance workbench,
takings and receipts are unchanged.

### 4.7 Exceptions (`/admin/exceptions`)

Student or family → policy (grouped) → scope (narrowed by the policy) → value → the sentence →
reason → grant. The list shows active, lapsed, revoked, used; "Check these" lists the migrated
exceptions whose scope now applies (§3.7); each line of the Student 360 shows the exceptions
applied to it.

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
| `GET /v1/sessions/:id/money`, `GET /v1/sessions/:id/to-verify`, `POST /v1/registrations/:id/verify-prior` `{ outcome, prevCentre?, prevCandidateNumber?, reason }` | admin, finance (verify: coordinator, admin, the finance desk with evidence) | §4.6, §3.5 |
| `POST /v1/sessions/:id/grade10/preview`, `/commit` | admin, coordinator | A-15 |
| `GET/PUT /v1/board-fees?seriesId=`, `POST /v1/board-fees/:seriesId/confirm`, `POST /v1/board-fees/:seriesId/reprice` | admin, finance admin (coordinator read) | the fee grid, §3.4 |
| `GET /v1/registrations/offers?studentId&sessionId` | the student, a linked parent, staff with student records | replaces `/available`: offers and items with the student's known sittings, teachers and prices per attempt and mode, the board's recent series for a declaration |
| `POST /v1/registrations/request`, `/direct`, `/desk`, `/admin-override`, `/preregister` | as today | body: `lines: [{ offerItemId, attempt, mode, teacherId?, priorSittingSeriesId? }]`, `consent: { refundPolicy, declaration }` |
| `PUT /v1/registrations/:id/teacher` `{ teacherId, reason }` | admin, coordinator, finance desk | point 10 |
| `POST /v1/registrations/:id/desk-drop` `{ reason }` | finance desk, admin | a drop after the line's effective deadline, with the receipt gate and the "sent" refund; F4's withdrawal when live (§3.3) |
| `GET /v1/statement?studentId` / `?familyId` | the student, a linked parent, staff with student records | §4.5 |
| `GET/POST /v1/charges`, `POST /:id/accept`, `/cancel`, `/refund` | finance, admin; a family POSTs a `requested` charge for a requestable service and reads its own | §3.6, §3.10 |
| `POST /v1/school-fees/push` `{ academicYear, grade?, sectionId?, studentIds?, dueAt }` | finance admin, admin | §3.6 |
| `GET /v1/board-services`, `PUT /v1/board-services/:id`, `PUT /v1/board-services/deadlines` | admin, coordinator (families read) | the catalogue of services and their deadlines per series |
| `POST /v1/exceptions` `{ policyKey, studentId | familyId, scope, value?, validUntil?, reason }`, `GET /v1/exceptions/check-these`, `POST /v1/exceptions/:id/confirm` | per the registry | §3.7 |
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
| `priceLine(item, attempt, mode, student, session)` | every path that creates or re-prices a line (request, direct, desk, override, preregistration, swap, re-price) | `board_fee`, the offer's fees, the pricing settings, the student's and family's active price exceptions (a re-price: the ids in the line's basis) |
| `assertLineRules(tx, student, session, lines)` | the same paths, inside the transaction after `assertMayRegisterForInTx` | availability, self-study gate, declared retake, exclusive groups, same entry once, required items, prior series and the board's carry-forward period, grade-10 core, the gate exceptions (each marked `used` when one-shot) |
| `refundFor(line, at)` | drops, swaps, cancellations, the sweep | §3.9 |
| `dueDateFor(line | charge)` | line and charge creation, fee confirmation, the statement, reminders | the session's `payment_due_at`, `payment.graceDays`, the fee's confirmation, `deadline.payment` exceptions, capped by the series' or service's deadline |
| `sessionWindow(student, session, seriesId)` | as today | `deadline.window` exceptions; `deadline.boardEntry` only when the setting is on |
| `schoolFeeGateReason` | as today | `gate.schoolFee` exceptions |
| `chargeRules(tx, charge)` | charge creation, acceptance, payment | the service's deadline, `price.*` exceptions scoped to the charge |

**One total lock order, as the code takes it today and then the rework's rows** (readers
`FOR SHARE`, writers of that row `FOR UPDATE`): `assertMayRegisterForInTx` — the student
**`FOR NO KEY UPDATE`** (the rework raises it from `FOR SHARE`: a student's own reservations
are serialised, which is what `gate.sameEntryOnce` and `gate.exclusiveItems` need, since no
unique index can express them across sessions; `NO KEY` so that concurrent inserts referencing
the student are not blocked) → the session (window) → the grade-10 exception row or the A-12
setting key, as F0a does; `routeAndCheck` — the subject's board → the window's series links;
then the rework's: the offer → the item → the fee rows the price reads → the student's and
family's exceptions, **one-shot gates `FOR UPDATE`** (marked used in the same transaction).
**Every path that puts a line into a series takes the same student lock and runs
`assertLineRules`**: the reservation paths, an item's series change (per affected student), the
grade-10 bulk commit (per student), F7's import (per student), and preregistration capture —
which today takes its own row lock first and `mayRegisterForInTx` after; it moves the student
lock first so the order is one.
A close of an offer, an untick or a series change of an item, a teacher removal, a fee confirm
or re-price, a grant or a revocation take their row `FOR UPDATE` at its place in the order, so
each runs before or after a reservation, never interleaved; a revocation re-checks what rested
on the exception (a used one-shot gate stays used). 08t forces: two reservations of the same
award in one series by one student from two sessions; two lines of one exclusive group at
once; a one-shot gate used by two reservations at once (one wins).

---

## 7. Migration (the protocol of FEATURES_PLAN.md §3)

Generated migrations on top of main's journal (0041 is free on main; the frozen branches'
0041–0043 are theirs to regenerate when they resume), with custom backfills:

1. **Structure**: the new tables (§3.2, §3.4, §3.5 consent, §3.6, §3.7's typed value columns
   with `student_id` nullable and `family_id`, §3.8), the new columns (including
   `exam_board.carry_forward_months`, `course_enrolment.unit_id`), the relaxed uniqueness on
   sessions, `receipt.charge_id` with its check, `board_series.retake_deadline` as an instant
   (the date converted to the end of that day, 23:59 Cairo, so the board's last day is kept),
   the new partial unique index on lines (created after
   the backfill), the routing trigger rewritten to read the line's item, the window-versus-
   deadline rule's deadline clause removed (§3.3).
2. **Backfill, idempotent**, one rule per row kind:
   - **Windows → sessions.** `june` stays `june`; `october` and `november` become `winter` of
     their year; `january` becomes `winter` of the year before. **Every converted window keeps
     a label** = its old type and level (`june-igcse`, `october-as_level`, `january-a_level`), so
     no two collide and nothing is merged; the derived name appends it ("June 2027 — IGCSE").
     `course_starts_on` = the window's start, `payment_due_at` = its end, `refund_policy` null
     (its absolute refund windows stay and are read as today), the old name kept in
     `edit_history`, the level column left as it was.
   - **Subjects → offers and items.** For every window (any status): an offer for every subject
     that has a line in it (any status) and for every active subject at its level; availability
     `open` for an open window, `closed` for a closed window or an inactive subject;
     `course_fee` = `subject.course_fee`; `grade10_core` = `subject.is_core`; teachers = the
     subject's linked teachers (`in_school`); a subject not offered at school →
     `self_study_only`; **one item "whole subject" per (subject, series its lines sit in)** —
     a window whose lines of one subject sit in two series gets two items, one per series, so
     every line keeps its series; a subject with no lines gets one item in the series the
     window's route or default gave; a window that fed no series gives items with a null series
     (`legacy.no_series`) and availability `closed` — no new line is ever reserved on them; a `board_fee` row per (series, the item's key) = `subject.registration_fee`,
     **confirmed** (it was the price).
   - **Lines.** Every line (any status) gets the item of its subject in its series; `attempt` =
     `retake` when `is_retake` else `first`; `mode` = `self_study` when `taken_outside_school`
     else `in_school`; `prior_sitting_source` = `known` with the **latest earlier confirmed** line's series
     when one exists, else `legacy` with `legacy.retake_history_unknown`; `due_at` = the
     window's end; `pricing_basis` null; `refund_policy_snapshot` null; `legacy.converted`.
     Pending swap requests: `newSubjectId` → that subject's whole item in the line's series.
   - **Exceptions.** All eight types mapped as §3.7; `value` → `value_number`; the extension's
     `valid_until` → `value_date` too; a subject scope → `subject_id` and, for deadline and
     refund keys, a "Check these" row; a price exception scoped to a unit row that later gets a
     parent subject (§3.2) is listed under "Check these" when the parent is created, so it is
     re-scoped or revoked rather than silently stopping.
   - **Refund windows.** Kept as they are (session or year scope).
   - **Remark fees and deadlines.** `remark_fee_schedule` rows become `board_service` defaults
     at **both** levels (the old row had none; both rows provisional); for every series that is
     open or future at migration time, a `board_service_fee` per (board, service, level)
     from the schedule; `remark_deadline` rows (per council and window) become
     `board_service_deadline` rows on each series the window feeds of that board. Existing
     remark requests are untouched (their path is kept).
   - **Announcements.** `scheduled_announcement` rows become messages with a broadcast audience.
   - Each converted row is audited once (`REWORK_BACKFILL_*`); a window with a line and no item
     for it fails the migration naming it.
3. **Kept one release, then dropped** (a later migration, after the first live cycle):
   `registration_session.qualification_level`, `session_subject_series`, `exception.value`,
   `remark_fee_schedule`, `remark_deadline`, `scheduled_announcement`.

Proven as F0b's was: on a copy of the template dev data, on F0a's richer copy, and on **the
synthetic school shapes** F0b used (`igcse_catalogue_synth`, `_synth_closed`), before and after
dumps in `.audit/rework-evidence/`: every line keeps its price, series, payment and status;
every waiting line's `mayRegisterFor` answer is the same before and after; every refund preview
of a live line is the same before and after (the converted lines keep their windows and, until
Q-19 is answered, the whole-price basis is kept for them: `legacy.converted` lines refund as
today); 09 green over the converted rows. The structure migration is reversible (nothing is
dropped until step 3).

---

## 8. Tests (the proof)

New suites `08n-session-offers`, `08o-reservation-lines`, `08p-pricing-policies`,
`08q-charges`, `08r-exceptions-registry`, `08s-messages-reminders`, `08t-rework-races`, cases in
04 (authz) and 05 (cross-family), rules in 09. Scenarios the forms and the reviews dictate:

| Scenario | From |
|---|---|
| a June session copied from the previous June: offers, teachers, items; board fees provisional; the derived name; Oxford's series created when an item lands in it, with the warning; a session with no predecessor set up from scratch | §4.1, G-29 |
| a winter session open from June to October feeding IAL October (deadline in late August), Cambridge November (first entries mid-August, retakes late September), IGCSE November and IAL January: October's deadline passes inside the open session and its lines are closed then; a Cambridge retake line reservable until the retake deadline and a first entry not; November and January items reservable, each cut off at its own deadline; a session opened by hand or by the scheduler after one deadline has passed; a held preregistration on a series past its deadline refused at capture and refunded in full (MO-21); a deadline set before the session's end accepted; A-12 lets a graduate reserve the winter; an IGCSE item refused in October and January; Cambridge AS defaults to November | §3.3, flags 9, 10, 27, 42, 43 |
| Biology IAL: papers 5 and 6 first entry, papers 1–4 self-study only; a first entry self-study on paper 1 allowed (not taught) at 50% course and 100% board; a per-unit teacher reaching the enrolment and a group per unit | §2.3 row 2, A-16, flag 4 |
| Cambridge Physics: AS in school; A2 carry-forward self-study only, needing the carried series within the board's period (November 2025 refused for June 2027); A Level; the three prices from the fee grid; AS and A Level in one sitting refused together; the same award twice in one series across a converted and a new session refused | §2.3 row 7, §3.1, flags 15, 40 |
| Arabic Edexcel: two items of two qualifications, the teacher choosing the item; the two refused together | §2.3 row 1, Q-16 |
| a one-paper retake (Paper 4 only, from June 2026) at its own course fee and the qualification's board fee; refused with the whole subject; Edexcel 1H without a prior series | §2.2, Q-13 |
| self-study on a first entry refused where taught; granted by `gate.selfStudyFirstEntry`; the exception used once | G-09 |
| a family declares a retake with its sitting; the line priced as a retake; the coordinator verifies; a rejected declaration on an unpaid line expires it (reason `declaration_rejected`) and tells the family; on a paid line before the first-entry deadline the line stands, F4 reads it as a first entry, and finance adjusts; on a paid line after that deadline the line is dropped through the receipt-gated drop; unverified at its effective deadline entered as declared (setting), or under `hold` a waiting line expired and a paid line dropped through the receipt-gated drop with that date's refund (board fee not sent) to escrow | flags 6, 50, 57, 66 |
| a Cambridge retake of the previous June's syllabus reservable and payable until the retake deadline after the entry deadline passed; a first entry not; its payment group, due date, sweep pass and "sent" all at the retake deadline; a retake of an older sitting at the entry deadline | flag 43 |
| a family's drop of a line whose effective deadline passed refused; the desk's drop allowed with the "sent" refund; a series with no deadline cut off at `exams_start` | flags 59, 60 |
| capture: a paid held preregistration past its deadline refunded in full; an unfunded one expired; one with an open payment left to that payment's sweep; a SO-4 held row untouched; capture takes the student lock first | flags 42, 58, 48 |
| a re-price racing a checkout: the lines locked first, the checkout's line left untouched | flag 46 |
| a required item missing refused; granted by exception | point 2 |
| a retake known from an earlier line and from an F4 result; `retake` in school at 100% | §2.5 |
| the teacher changed on a paid line: the enrolment and the group move, the price does not; "no preference" assigned later; "replace teacher" on an offer moves every line | point 10, flag 19 |
| a provisional board fee: reserved, not payable (the checkout and the desk refuse it), not reminded; confirmed at the same amount clears it; confirmed higher: lines with no payment history re-priced on the board part with their recorded exceptions, a line with any payment history (open, failed or paid) listed and untouched, a price adjustment charge by finance; the due date moved by the confirmation; no plan on a provisional line | flags 3, 32, 33, 46 |
| a drop at week 3 of June refunds 50% of the course fee plus the board fee before the deadline (Q-19's default); after the deadline, or after `exams_start` on a series with no deadline, the course part only; at week 7 of winter 0% course; an offer starting later than the session shifts its anchor; `refund.courseStart` moves one student's; a group's first lesson anchors it when F1 knows it; the policy frozen on a line's snapshot at consent (the session's windows are not materialised); a converted line refunds as today from its windows; MO-21 at 100%; a custom-priced line refunds its total by the course rule | G-19, flags 2, 34, 45, 47 |
| consent required in the app, ticked once at the desk; a grade-10 bulk line's `school` rows at commit and the family's at checkout; a swap inherits it; a line without consent cannot be confirmed | G-20 |
| a cash-in charge requested by the family, accepted, paid in its own payment beside a line's payment in one desk action; its receipt; reversed (MO-11); refunded before the board's date, capped; closed unpaid at the service deadline; two charges of different service deadlines refused in one payment | §3.6, §3.10 |
| a Cambridge remark priced per component at the AS rate from the fee grid; the grade changes; the refund by the rule (seeded `full` until Q-21) | SCHOOL_FORMS.md §3.3 |
| a pushed school fee for a grade: skipped for a paid, a waived and an A-13 graduate; paid through the school-fee path and marked paid in that transaction; the payment reversed reopens it; a waiver after the push cancels it | §3.6, flags 11, 30 |
| an instalment plan: three instalment charges paid on their dates into the held wallet, earmarked for the line, with deposit slips and in the takings; the held amount neither transferable, withdrawable nor applicable elsewhere while the plan is live, and never spent by another line's capture or reversal; the line captured in one specified payment at the last (`held_deposits`, `plan_capture` with the payment's id, `PLAN_CAPTURED` and `PAYMENT_CONFIRMED`, the line's receipt), not reversible, in the takings' escrow-applied figure only; a plan stopped in week 6 by the session's close, the deadline sweep, an overdue expiry, ineligibility, a closed payment (`failOpenPayment`), the exception lapsing or finance's revocation **settled as a drop that day**: the school keeps `min(deposits, price − refund)`, the rest released, both audited and on the statement — the worked example of Q-15 asserted (1,000 of 1,500 paid: 500 kept; 500 paid: 500 kept; 300 paid: 300 kept; a paid drop before its entry is sent: 500 kept; after: 1,000 kept); a revocation expires the line unless "release in full" is chosen; a plan refused on a line with an open checkout, on a provisional line; a plan line not revertible by the parent; the close and the eligibility clean-up sparing a line whose last instalment is being checked; an instalment reversed while unspent debits what it credited; an instalment payment of a dead plan failed by the sweep or refused at confirmation; an instalment paid from escrow refused; the last date capped by the session's end and the effective deadline; capture refused past it | Q-15, flags 29, 44, 54–56, 62–65 |
| grade 10 registered in bulk; a second commit changes nothing; a grade-10 family's own reservation must include the core offers | A-15 |
| a due date capped by the line's series' deadline; `deadline.payment` moves one family's; a line reserved after the due date gets the grace; `payment.expireOverdueAfterDays` on | §3.1, flag 16 |
| a payment reminder sent at −7, −3, 0, +3, repeating until paid; two scheduler instances send once; the delivery log; parents of grade 11 as an audience; a provisional line skipped | §3.8 |
| a batch message to a session's unpaid families; a direct message; families cannot delete | §3.8 |
| the migration on the three databases: prices, series, payments, statuses, eligibility and refund previews unchanged; a window with lines in two series gives two items; 09 green | §7 |
| races: two desks reserving one item for one student; the same award in one series from two sessions at once; two items of one exclusive group at once; a one-shot gate used twice at once; an item's series changed while a checkout is open (refused, as F0b); an item closed or its teacher removed mid-reservation; a fee confirmed while a line is being priced; an exception revoked while a line relies on it; a declaration verified while the line is being paid; capture racing a deadline | §6, flag 48 |
| A-16's self-study price (course 50%, board 100%) on a taught subject's retake and on an untaught subject's first entry — the 50%-of-the-total rule has no test today | §3.4, flag 34 |

09 adds: every live line has an item of its offer and, unless `legacy.no_series`, a series of
its item; every line with a basis has its price equal to it; one live line per student, unit or
award and series; a charge payment charges exactly the sum of its charges; an open charge
payment's charges share one service deadline; no charge is paid twice and every paid charge
once (a push by its settling school-fee payment); a charge's refund never exceeds it; an
instalment's payment credited the held wallet for exactly its amount, and the held wallet holds
exactly the paid preregistrations still waiting plus the live plans' instalments (MA-15
extended); a line under a plan is confirmed only by one payment capturing its held amount equal
to its price; every confirmed line created after the rework has its two consents; every
one-shot gate exception is used at most once; every reminder sent has its claim row; every
charge payment has one creation row (`CHARGE_PAYMENT_INITIATED` joins the counted actions);
every expired line's reason is one of the known ones (the six new ones included). The
per-series rules of F0b read the effective deadline, or `exams_start` for a series with none,
where §3.3 says so; the window rule keeps its year, kind and board clauses, its deadline clause
gone.

---

## 9. Build order (Phase 3), two or three agents at most

| Step | Agent | Delivers | Depends on |
|---|---|---|---|
| 1 | **A — Sessions, offers, fees, the per-item cut-off** | §3.1–§3.4, §3.3's rule change, the migration (§7), the Sessions and Session screens with the Fees and Grade 10 tabs, `priceLine`, `/offers` for families (read), the pricing settings, the enrolment's unit dimension (§10), `exam_board.carry_forward_months`; 08n, 08p, the conversion proof | — |
| 2 | **B — Reservations** | §3.5, consent, declared sittings and the To verify tab, the teacher change and replace, the desk and the family's Reserve pages, the Statement (child and family), the Money tab; 08o; the F0b money assertions re-shaped | A's contract: `session_offer_item`, `priceLine`, `/offers` |
| 2 | **C — Money changes, charges, exceptions** | §3.10, §3.6, §3.7, the registry and hooks (§6), the Exceptions screen with "Check these", board services and deadlines, the remark fee from the grid, the school-fee push, instalments; 08q, 08r | A's `priceLine` signature; B calls the hooks (a contract agreed in writing before B and C start) |
| 3 | **D — Messages and reminders** | §3.8, the Messages screen, the scheduler step; 08s | B's lines and C's charges for the batch audiences |
| 4 | the lead | the end-to-end check on one running system, the step counts of §11 measured, the UI audit of these screens, the walkthrough regenerated (F8) | all |

Each step: one Opus 5.5 implementer, one Opus 5.5 reviewer, the lead's review on a running
system, merge on green (FEATURES_PLAN.md §4, §5 apply unchanged: Hono RPC, the audit row in the
transaction, row locks, `authz-policy.tsv`, 05, 09, trail rows through `scripts/trail-row.py`).
A's contract is published in `docs/features/RESERVATIONS.md` §"Contracts" before B and C start;
B and C run in parallel on their own worktrees, branches and databases.

**The frozen work after step 2** — what each must change, read from its own document:

- **F1 (scheduling)**: `course_enrolment` gains `unit_id` (nullable; one open row per student,
  subject, unit, year); `teaching_group` gains `unit_id` and `delivery` (`in_school`, `online`:
  timetabled without a room; a provider's group has no lessons); `teaching_group_member`'s rule
  becomes one open group per (student, subject, unit, year); `getTeachingDemand` groups per
  (subject, unit, teacher); `endGroupMembershipsForSubject` and `checkEnrolments` take the unit.
  Its second review round (30 Sep, in the session log, not yet in a repo file) left three flags
  to fix on the rebased branch: dated teacher clashes across intervals, carried covers
  re-checked after a change, lock and race tests; they are recorded in FEATURES_PLAN.md §7 with
  this plan.
- **F4 (exam entries)**: entries derive from `lineItemsFor` (the item says what it enters, the
  option code with it); retake from `attempt` and history; carry forward from the line's
  verified prior sitting with its previous centre and candidate number (the suggest-and-confirm
  flow applies only to a line without one; `exams.carryForward` keeps its meaning there);
  `exam_entry.charge_id` for a cash-in; `teacherOf(student, subject, unit?, year)`;
  `exam_board_rule.carry_forward_months` moves to `exam_board` (step A adds the column; F4 reads
  it); a declared, unverified sitting is listed by the entry check and entered or held by the
  setting; F4's verification of a result against a declared sitting closes it.
- **F7 (import)**: sheet rows map to offers and items (`findOffer`, `findItem`); the fee note to
  `attempt` and `mode`; prices from the fee grids at import time — the grids must exist (the
  import refuses a row whose item has no fee row and says which grid); a provisional row prices
  the line provisional — never 0 (MO-9).
- **F2 (campus leave)**: independent of the session model; resumes after F1.
- The preview branch and the walkthrough are rebuilt last (F8).

---

## 10. Contracts

| For | Contract |
|---|---|
| F1 | `getTeachingDemand(academicYearId)`: per (subject, unit, teacher) with `delivery`; a line's teacher (or its change or replacement) reaches the group through `upsertEnrolments(source: 'registrations')` with the unit; a "no preference" line is an enrolment with no teacher until assigned |
| F4 | `lineItemsFor(registrationIds)`: per line the item, what it enters (unit ids, option or award), the series, `attempt`, `mode`, the prior sitting with its source, verification, previous centre and candidate number, the student's grade and level code; replaces `entryItemsFor`; `chargesOfKind('cash_in', seriesId)` for award entries; `exam_board.carry_forward_months` |
| F5 | unchanged (the catalogue) |
| F7 | `findOffer(sessionId, term)`, `findItem(offerId, label)`, `priceLine` with provisional fees, `attempt`/`mode` from the sheet's fee note, consent channel `imported` |
| F8 | the demo school script seeds a June and a winter session from a fixture shaped like SCHOOL_FORMS.md §2 |

---

## 11. The step counts (UX_AUDIT.md §4), honestly

The school's own process is the baseline (the forms and the sheet), then today's system (the
survey, §15), then this design. The design's numbers are counted from its own input lists
(§3, §4), not from the prototype (whose "Add subject" is a stub), and will be measured on the
running system before Phase 3 closes.

| Task | The school today | Our system today (§15) | This design |
|---|---|---|---|
| Open a June cycle with 25 subjects, their teachers and fees | build or copy-edit 25 Google Forms (about 12 questions each; the series left wrong on one), type the links sheet, print two fee PDFs | **three windows** (one per level), each with its series panel and deadlines, then every subject created and its teachers linked one modal at a time: **162–237 inputs, 127–152 clicks**, seven things to remember; no screen shows the session's subjects with teachers and fees | New session: 6 inputs, 1 click. From scratch, per subject: the subject, its teachers (about 26 picks across the 17 O.L. forms), the course fee, a course fee per one-paper item the school opens (about 10), and on the 8 A.S./A.L. subjects a fee and a teacher per unit or route (about 30): **about 140 inputs and 60 clicks for 25 subjects**; fees: one paste per series (3) and a confirm each when published; deadlines: 1 date and 1 reason per series on the Board series page (6 inputs, 3 clicks), as today. **Total from scratch about 150 inputs and 70 clicks; with a predecessor, about 20 and 10.** One screen is the links sheet |
| A family reserves three subjects, one a self-study retake | three forms, 7 identity questions each, plus the subject's 2–4 choices and 3 consents: about 35 answers | the family: 4 steps on one page; **a walk-in family's retake cannot be set** (retake is derived from history only; the officer needs an exception first) | one page: 3 ticks, 1 teacher pick where the offer has several (or none), the retake pre-set or declared with its sitting (1 pick), 2 consents: **6–8 answers** |
| The desk takes the family's money for them | read the sheet, write the fee note, write a paper receipt | onboard (7 inputs), find the student again, register (5–6 inputs), collect: **13–16 inputs, 5–6 clicks** plus a hand-over per receipt; the price shown omits exceptions | onboarding as today (7), the student stays open, then the same page: 3 ticks, a declared retake's entry and sitting (2), a teacher pick or none (0–1), 1 consent tick, the instrument (1): **14–15 inputs, 4 clicks** — the same count as today, with the retake possible, one screen fewer and the price right; receipts printed |
| Know who has paid | the sheet against the receipt book | the finance workbench (pending only) and the Student 360 one student at a time; nothing per session | the session's Money tab |
| Lift a rule for one family | a note in the sheet ("Self Study 20%") | 6–8 inputs, 1 click, one of eight types; the subject list mixes every level; self-study on a first entry has no type at all | one exception: student or family, policy, scope, value, reason: 5–6 inputs, 1 click; every policy |
| Set the refund windows | the policy text on the form | **15–18 inputs, 3 clicks** per session, on the School fees page, absolute dates typed, the form resetting after each row, ends at UTC midnight, no edit | copied from the type's policy at creation; one date (course start) |
| Remind unpaid families | by hand | not possible (one 24-hour closing reminder); "parents of grade 11" cannot be targeted | a rule once; or "Remind" on the Money tab; any list as an audience |

---

## 12. Decisions and why

- **One session per cycle, levels per subject, the cut-off per item.** The forms have one cycle
  whose series' deadlines fall weeks apart; F0b's "window closes before every deadline" cannot
  hold it, and its purpose — nothing entered, paid or confirmed after a series' deadline — is
  served per line. F0a's eligibility reads the session's academic year and kind, which one cycle
  has.
- **Items, not more subject rows.** The sheet registers units as rows (IS-01) and F0b made rows
  of them; the forms show the family one subject with its units under it. The line keeps the
  parent subject for the ledger's readers and adds the item for the board; history, enrolment
  and groups are keyed by what the item enters, so an old unit row and a new parent do not split
  a student's record.
- **Attempt and mode apart.** The form's five options are two facts: first or retake, taught
  or self-study. Storing them apart keeps a self-study first entry (not taught here, or by
  exception) from being entered with the board as a re-sit (F4).
- **Trust and verify the family's retake, the coordinator owning it.** The form trusts "ONLY 2nd
  entry"; the system has no history on day one and the winter cycle is mostly re-sits; so the
  family declares the sitting and the coordinator verifies, as the desk checks the sheet today;
  an unverified one is entered as declared unless the school says hold.
- **Board series attached by item, never assembled.** The admin called them confusing and
  redundant. They remain the hard stop's home (MO-10) and F0b's per-series rules stay true;
  only the hand assembly goes, and nothing is attached that no item uses.
- **Fees per unit per series, provisional until published.** The fee lists are per series and
  differ per series for the same unit; the school opens nine months before the boards publish;
  a re-price touches the board part of unpaid, uncommitted lines only.
- **The 50% on the course fee by default, the board fee whole.** The forms say "School fees";
  A-16; a setting either way; Q-12 to the admin.
- **The refund percentage on the course fee; the board fee by its own rule.** The forms say
  "100% of the Course fees"; the board fee is money the school passes on, refundable while it
  has not been sent (Q-19, with the assertions it moves listed).
- **The refund policy in weeks, its steps frozen on the line at consent, its anchor resolved
  at refund time.** What the family signed is what applies; the start moves with what the
  system learns (a group's first lesson) or finance grants; converted lines keep their windows
  and today's basis; nothing is materialised.
- **Charges in the one pipeline, with the money-core changes named.** New money kinds join
  payments, receipts, reversals, refunds and the sweep; the 09 invariants extend by rows; remarks
  and the school fee keep their own paths.
- **Instalments as held deposits, settled like a drop when they stop.** Q-15's default was the
  owner's; a plan is N charges paid into the held wallet, earmarked for the line, and one
  specified payment from them at the end, so every existing rule about a line's payment and
  receipt holds; a plan that stops lets the school keep what a paid drop that day, before the
  entry is sent, would leave it, capped at the deposits, so a family that stops paying never
  loses more than such a family, and loses less only because it paid less.
- **A registry of policies, not more exception types.** "Everything can have an exception" is a
  registry where each policy names its hook and what a null scope means; the screen reads the
  registry; the entry deadline is in it, gated by a setting until the owner answers Q-20.
- **Messages write notifications.** Families keep the notification centre they have; the admin
  gets audiences, templates and a delivery log around it; WhatsApp is a channel with no sender
  until the school has a business account (the owner, 7 Oct).
- **Grade 10 registered by the school.** No form has a grade-10 class (A-15); the family's own
  path still enforces the core subjects if a grade-10 family reserves.
- **The teacher change at the desk too.** The family asks at the desk; the change is audited
  and the coordinator sees it on the group.

## 13. The prototype

`docs/prototype/reservations-rework.html` (self-contained, no backend; open it in a browser;
deep links `#session/subjects`, `#session/fees`, `#session/verify`, `#desk`, `#family`,
`#statement`, `#exceptions`, `#messages`), kept in step with the design: the Session screen with the
Subjects, Fees (provisional marks, confirm), Money, Grade 10 and To verify tabs and the offer
drawer, the desk's and the family's Reserve pages with live prices (the entry select is attempt
and mode in one list; the family can declare a retake with its sitting; a provisional fee is
marked and not collected), the Statement (one payment per deadline), the Exceptions picker with
its sentence, the Messages and reminders page. Fixture data shaped like SCHOOL_FORMS.md §2 with
placeholder names; course fees illustrative; board fees from the June 2026 lists marked
provisional for June 2027. "Add subject" is a stub (§11 does not count on it). It is for the
owner's review and for showing the admin; the build follows this document, not the prototype's
pixels.

## 14. Review

The six Opus 5.5 reviews, the two diff checks and the lead's answers are §16; the trail is
`.audit/school-forms.tsv`. Round six found the settlement formula sound and its wording
overstated; versions 7 and 8 corrected the wording and the small money-path points it listed;
the reviewer's diff check of version 8 (7 Oct, 19:08Z): **ready for the owner, nothing
material left.** What the owner decides is §17; what is built next is §9.

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

## 16. The review rounds

### Round one (Opus 5.5 review of version 1, 7 Oct 17:11Z)

Verdict: not ready; eight material flags, twelve should-fix, six minor. Version 2 accepted all
of them; round two checked each (below) and found remainders in 1, 2, 3 and 5–7, which version
3 closes.

| # | Flag | Version 2 / version 3 |
|---|---|---|
| 1 | the money core is not untouched: receipts per registration, remark payments not reversible, 09's equality over lines only, one purpose per payment, the school-fee index | v2: §3.10 named four changes. **v3**: §3.10 names six, lists every invariant and service a charge touches, the push's settlement, instalments through escrow, remarks kept on their own path |
| 2 | the refund basis contradicts the form; `refund_window` has no offer scope; re-materialising changes what families consented to | v2: percentage on the course fee, Q-19, the snapshot, the offer scope. **v3**: §3.9 says exactly what changes in `refund.services.ts` (the signature, the five amount sites, MO-21 kept, no-deadline series, instalment lines, custom-priced lines) and §3.10 lists the assertions it moves |
| 3 | reservations cannot open before the boards publish | v2: provisional fees and a re-price. **v3**: the re-price skips lines in an open payment or under a plan, touches the board part only, re-applies the recorded exceptions; a confirm at the same amount clears provisional; the due date and reminders follow the confirmation |
| 4 | per-unit teachers do not fit the enrolment F1 and F4 read; what a unit line's subject is; F4 changes more than one function; F1's flags not in the repo | v2: the parent subject, the unit dimension, F4's list. **v3**: F1's group and member rules per unit, `delivery`, the per-unit `endGroupMembershipsForSubject` and `checkEnrolments`; F4's previous centre and candidate number; F1's three flags written into FEATURES_PLAN.md §7; where the parent subject comes from and why history does not split (§3.2) |
| 5 | the migration undefined for many row kinds and the routing trigger | v2: a rule per row kind. **v3**: an item per (subject, series) so lines in two series keep theirs; null series allowed for converted lines; `legacy` flags; the extension's date; the eight types with the two changed meanings listed and "Check these"; remark defaults at both levels; pending swaps; the refund-preview proof |
| 6 | the family path harder than the form for re-sitters | v2: the family declares. **v3**: the coordinator owns verification; every outcome defined (verified, rejected unpaid, rejected paid, unverified at the deadline by a setting); the picker's series; the prototype brought in line |
| 7 | the owner's decisions presented as settled where they conflict | v2: Q-20, Q-21, instalments, the group anchor. **v3**: Q-21's default is today's behaviour until answered; Q-19's default kept but its changed outcomes listed; Q-15 restated as the owner's default with the plan per line |
| 8 | names in the repo | resolved in v2 (round two confirmed main's tip clean) |
| 9 | `winter` missing from two type lists | **v3**: `GRADUATE_RETAKE_SESSION_TYPES` gains it; `A_LEVEL_ONLY_SESSION_TYPES` retired, the rule per item |
| 10 | attaching series vs the close-before-deadline rule; October/November; labels | **v3**: the rule itself replaced (§3.3); defaults per board (Pearson October; Cambridge and Oxford November); the school's "November" name shown beside the series; detach only when nothing references it |
| 11 | services incomplete; no family request; no exception on charges; the push ignores waivers and A-13 | resolved in v2; the push's lifecycle in v3 (§3.6) |
| 12 | money outcomes changed unlisted | **v3**: §3.10 lists the refund assertions with their numbers and the exception order kept as today |
| 13 | F7 prices at 0 | **v3**: the grids must exist; provisional otherwise; never 0 |
| 14 | step counts | **v3**: §11 recounted (about 150 from scratch; the desk about the same as today with the retake possible); nothing counted on the prototype |
| 15 | items under-specified | resolved in v2; the prototype's labels fixed in v3 |
| 16 | `due_at` unstated | resolved in v2; its interaction with provisional fees in v3 |
| 17 | exception typing and scopes | resolved in v2; §7 lists `student_id` nullable and `family_id` in v3 |
| 18 | lock order | **v3**: one total order (§6) |
| 19 | edge cases and 09 gaps | resolved in v2; the grade-10 consent rows named in v3 |
| 20–26 | the eleven points; the family statement; online groups in F1; the carry-forward period; `is_offered_at_school`; the quote; the desk's teacher change and the remark mapping | resolved in v2 and v3 (the online group without a room; the mapping with `script_copy` → 1S for Cambridge and access to scripts for Pearson) |

### Round two (Opus 5.5 review of version 2, 7 Oct 17:39Z)

Verdict: not ready; material: 1, 2, 3 (remainders) and 27, 28, 29; should-fix 30–38; minor
39–41. Each and what version 3 does:

| # | Flag | Version 3 |
|---|---|---|
| 27 | one winter session cannot satisfy F0b's "the window closes before every fed series' deadline"; January items would close with October's; a September session could not attach October; the prototype's winter row would be refused | **accepted, the rule replaced**: the cut-off is per item and per line (§3.3); the database rules and the 09 invariant rewritten; 08i/08k scenarios pre-authorised; MO-10's meaning kept |
| 28 | the prototype is still version 1 | **accepted**: brought to version 3 (§13): the family declares a retake, provisional fees, the To verify tab, the copy's provisional fees, the statement's remark rate and one payment per deadline, self-study-only items offered as first entries in self-study, "no preference" teacher |
| 29 | instalments break `payment_registration`, the line's receipt and the receipt-gated drop; the refund base; the sweep | **accepted, redesigned**: instalments are escrow deposits on a schedule; the line is paid in one payment from escrow (§3.6, §3.10); a 09 rule holds it |
| 30 | the pushed school fee: no link to its payment; confirmation, reversal, waiver | **accepted** (§3.6: `settled_by_payment_id`, the three hooks; excluded from the `payment_charge` rule) |
| 31 | remarks as charges: no request id; the hook and ST-01 keyed on the purpose; reversal undefined | **accepted**: remarks keep their own path and payment; only the fee's source and the refund rule change (§3.6) |
| 32 | re-pricing hits lines in open payments or plans; exceptions re-applied silently | **accepted** (§3.4) |
| 33 | the due date before the fee is confirmed | **accepted** (§3.1) |
| 34 | refund outcomes Q-19 changes, unlisted; the migrated 90% exception; the custom-priced line | **accepted**: listed in §3.10; converted lines keep today's basis; the custom-priced line's rule stated (§3.9) |
| 35 | the exception order: the custom price first in the code | **accepted**: today's order kept and stated (§3.4) |
| 36 | §11 counts optimistic; the desk requires a teacher pick; "counted on the prototype" | **accepted**: recounted; "no preference" allowed; the prototype disclaimed |
| 37 | IAL units under two subject ids | **accepted**: §3.2 says where the parent comes from and that history, exceptions, enrolment and groups are keyed by what the item enters |
| 38 | dependence on frozen F4's `exam_board_rule` | **accepted**: `exam_board.carry_forward_months` added by step A; "sent" = the deadline passed until F4 marks entries sent |
| 39 | as 9 | resolved |
| 40 | a converted and a new session active together feeding the same series | **accepted**: `gate.sameEntryOnce` and a 09 rule |
| 41 | `deadline.boardEntry`'s scope; the late fee's kind; the statement's two deadlines in one payment; refunds from the drawer | **accepted**: scope student × series; `late_entry_fee`; the statement redrawn; refunds to escrow, cash only through the cash-refund path |
| — | unsupported claims in §16 (F1's flags "named"; the prototype "version 2's"; "computation unchanged"; "nothing else") | **accepted**: each corrected above |

### Round three (Opus 5.5 review of version 3, 7 Oct 18:10Z)

Verdict: not ready; one material flag (42), should-fix 43–49, minor 50–53; flags 29, 30, 31,
33, 35, 38, 39, 41 resolved; 1, 2, 27, 34, 36, 37, 40 partly; 28 mostly. Each and what version 4
does:

| # | Flag | Version 4 |
|---|---|---|
| 42 | the window rule is also enforced by services (`updateBoardSeries`, `activateSession`, `autoManageSessions`, `windowAfterEntryDeadline`, `updateDraftSession`, `seriesMisfit`) and preregistration capture ignores a series' deadline, so held money could be confirmed for an entry the board refuses, skipping MO-21 | **accepted**: every site named with its new behaviour (§3.3); capture refuses and MO-21-refunds a held preregistration on a series past its deadline (§3.3, §3.10 item 5); the database keeps its year, kind and board clauses; "in the future when set" stays a service check |
| 43 | Cambridge's retake deadline ignored; §4.1's dates wrong | **accepted**: a retake line is cut off at `board_series.retake_deadline` where set (§3.3); §4.1 and the prototype's winter row corrected |
| 44 | instalment lifecycle gaps (deposits not earmarked; the close; provisional lines; receipts; escrow as the instrument) | **accepted**: deposits are held (earmarked) money, released on any expiry; the last date capped; no plan on a provisional line; no escrow instrument; instalment receipts named by the line's receipt (§3.6, §3.10 item 6) |
| 45 | two sources for the refund percentage | **accepted**: the snapshot only; no window is materialised; the 08 and 08m scenarios restated (§3.9, §3.10) |
| 46 | re-pricing breaks 09:84 for a line with payment history | **accepted**: only lines with no payment history are re-priced; the rest listed (§3.4) |
| 47 | "sent" undefined; a series with no deadline | **accepted**: F4's mark, else the deadline, else `exams_start` (§3.9); Q-19 says so (§17) |
| 48 | the lock order misstated; cross-session gates unguarded; one-shot gates under shared locks | **accepted**: the order as the code takes it, the student `FOR UPDATE`, one-shot gates `FOR UPDATE`, three races in 08t (§6, §8) |
| 49 | the desk count one input low | **accepted**: 14–16 (§11) |
| 50 | verification outcomes under `hold` and on a rejected paid line | **accepted** (§3.5) |
| 51 | prototype and text inconsistencies (the winter row's dates; shared receipts; receipts for school-fee and remark payments; the A2 label; a retake offered on a closed item) | **accepted**: each corrected in the prototype and §4.5 |
| 52 | the "in the future" check in the database; a wall-clock 09 rule against backdated deadlines; 09:427's other clauses | **accepted**: service check kept; no wall-clock rule; the year, kind and board clauses kept (§3.3, §8) |
| 53 | the latest earlier sitting; new lines on no-series items; exceptions on old unit rows | **accepted** (§7) |
| 1, 2, 27, 34, 36, 37, 40 | the remainders | closed by 42–49 above: the capture, the checkout's and desk's refusals, the new expiry reasons and `CHARGE_PAYMENT_INITIATED` in 09 (§3.10 items 5–8); the A-16 test that does not exist today (§3.10, §8); the enrolment key when a unit is set (§3.2); the sameEntryOnce race (§6) |

### Round four (Opus 5.5 bounded pass on version 4, 7 Oct 18:13–18:25Z)

Verdict: not ready; one material flag (54); should-fix 43, 47, 55–59, 61; minor 60; 42 mostly,
44–46, 48–51 partly, 52–53 resolved. Each and what version 5 does:

| # | Flag | Version 5 |
|---|---|---|
| 54 | a stopped plan released every deposit in full, so a family who stops paying in week six did better than one who paid and dropped | **accepted, the default built and put under Q-15**: a stopped plan is settled as a drop on that day — the policy's share released, the rest forfeited, both audited (§3.6, §17) |
| 55 | "the existing capture of held money into a line's payment" does not exist: preregistration capture creates no payment; the 09 rules at 70, 106 and 315 and reversal and takings were unaddressed | **accepted**: the plan capture is a new, specified payment (purpose, instrument, ledger reason, audit action, receipt, not reversible, nothing in the takings, refused past the deadline); the three 09 rules extended and a fourth added (§3.6, §3.10 item 6); "untouched" corrected |
| 56 | `debitHeld` reads the student's total; the release missed three expiry causes; the sweep never fails an open instalment payment; a late confirmation credits a dead plan | **accepted**: held deposits earmarked per line and read per line; the release inside `expireWaitingRegistrations` for every cause; the sweep fails such payments; confirmation refuses a dead plan's instalment (§3.6) |
| 57 | under `hold` a paid line "expired" from `confirmed` breaks 09's status rule and skips the receipt gate | **accepted**: dropped by the system through the receipt-gated drop, as the deadline's preregistration refund is (§3.5) |
| 58 | capture's past-deadline branch undefined for unfunded rows, rows with an open payment, SO-4 rows; the order of the two checks | **accepted**: the deadline check first, per row, reusing the deadline refund's row logic; SO-4 rows untouched (§3.3) |
| 59 | drops and swaps after a series' deadline | **accepted**: the family's refused, the desk's allowed with F4's withdrawal and the "sent" refund (§3.3) |
| 60 | a series with no deadline reservable after `exams_start` | **accepted**: the cut-off falls back to `exams_start` like "sent" (§3.3) |
| 61 | text still describing version 3 (§12 twice, §17 Q-15, §7's `refund_window.offer_id`, the round-three time) | **accepted**: each corrected |
| 43 | the retake deadline's enforcement sites unnamed; the column's rules; Cambridge's condition | **accepted**: the effective deadline per line, every site named, the column promoted to an instant with the entry deadline's rules, the condition on the prior sitting (§3.3, §7) |
| 45 | a new line in a still-open converted session has no policy; the anchor frozen at consent against later overrides | **accepted**: the snapshot freezes the steps, the anchor is resolved at refund time; a converted session's line snapshots its absolute windows as steps (§3.1) |
| 46 | the re-price's history check could miss a committing checkout | **accepted**: lines locked first, history read after; the race in 08t (§3.4, §8) |
| 47 | `hold` after the deadline counted the entry as sent; a retake line between the two deadlines | **accepted**: a held line's board fee counts as not sent (§3.5); a qualifying retake line is sent at its retake deadline (§3.3) |
| 48 | capture's lock order; `FOR UPDATE` on `user` blocking inserts; other line-creating paths | **accepted**: `FOR NO KEY UPDATE`; capture takes the student first; the series change, the grade-10 commit and the import take the lock and run the rules (§6) |
| 49 | 14–15, not 14–16 | **accepted** (§11) |
| 51 | the prototype's statement showed another student's line; the remark's refund date; the winter row's 12 Sep as not passed | **accepted**: corrected in the prototype and §4.5 |
| 42, 44, 50, 52, 53 | mostly or fully resolved | the residues above |

### Round five (Opus 5.5 bounded pass on version 5, 7 Oct 18:31–18:43Z)

Verdict: not ready; one material flag (54 again: the settlement formula), should-fix 62–66,
minor 67–68, residues in 43, 51, 55, 56, 59, 60, 61; 45–49, 57, 58 resolved. Each and what
version 6 does:

| # | Flag | Version 6 |
|---|---|---|
| 54 | releasing the refund of the full price out of partial deposits let a stopper keep the value of the unpaid instalments; "not better than a drop" was false; no cap | **accepted**: the school keeps `min(deposits, price − refund)`, the rest is released, nothing more is owed; the worked example and the "never pays at all" note in Q-15 (§3.6, §12, §17) |
| 55 | 09:280 and 09:441 unnamed; the ledger row's payment id; the takings' escrow-applied figure | **accepted** (§3.6, §3.10 item 6) |
| 56 | `failOpenPayment` expires on its own; a parent's revert; a lapsed plan; the sweep's query joins lines only | **accepted**: the settlement in `failOpenPayment` too; a plan refused on a line with an open checkout; no revert of a plan line; the lapse settles; a second sweep query over `payment_charge` (§3.6) |
| 62 | the close and the eligibility clean-up expire a plan line whose last instalment is being checked | **accepted**: both spare it (§3.6) |
| 63 | a revoked plan left the line payable after a forfeit | **accepted**: revocation expires the line (`plan_revoked`) unless "release in full" is chosen (§3.6) |
| 64 | instalment receipts never asked back | **accepted**: a deposit slip, not a tracked receipt; the line's receipt at capture (§3.6) |
| 65 | a never-confirmed line's board fee counted as sent after the deadline | **accepted**: "sent" is per line; never confirmed, never sent (§3.6, §3.9) |
| 66 | hold at the wrong deadline for a declared retake; a rejected paid line after the first-entry deadline | **accepted**: the effective deadline; such a line is dropped like hold; Q-22 for the owner (§3.5, §17) |
| 67 | a zero release or forfeit cannot be a ledger row | **accepted**: at most one of each (§3.10 item 6) |
| 68 | round four's times | **accepted**: 18:13–18:25Z (§16; a correction row in the trail) |
| 43 | three sites unnamed; a contradiction on 09; "of that syllabus"; midnight Cairo | **accepted**: `submitTransferReference`, `moveRegistrations`, `cancelPreregistration` named; the 09 rule that reads the effective deadline named; "the board's latest series before this one" from the prior sitting alone; the end of the day (§3.3, §7) |
| 59 | the desk's drop had no endpoint; "series' deadline" | **accepted**: `POST /v1/registrations/:id/desk-drop`; the effective deadline (§3.3, §5) |
| 60 | 09:402 against `exams_start`; a series with neither date | **accepted** (§3.3) |
| 61 | stale text (hold "expires"; "the escrow stays the family's"; "steps and anchor"; capture "gains only"; "version 3") | **accepted**: each corrected |
| 51 | a duplicated receipt number; events after the prototype's "now"; the winter session shown open past its end; §4.1's 12 Sep | **accepted**: the prototype's receipt, dates and the winter row corrected; §4.1 marks 12 Sep passed |

### Round six (Opus 5.5 bounded pass on version 6, 7 Oct 18:48–18:59Z)

Verdict: not ready on the wording alone — the settlement formula is sound (the reviewer's own
numbers: with course 1,000, board 500 and a 50% course step, a plan line's keep is 500 of any
deposit of 500 or more, and the deposit itself below that; a paid drop before the entry is sent
leaves the school 500, after it 1,000); the claims "never more" and "never does better" were
false when the deposits are below the school's share and when the paid drop comes after the
entry is sent. The reviewer: "if 69–73 are fixed as worded, checking the diff is enough and a
seventh full pass is not needed." Version 7 does each:

| # | Flag | Version 7 |
|---|---|---|
| 69 | the claims and the example overstate the comparison | **accepted**: "the same course share a paid drop before its entry is sent leaves the school, capped at the deposits"; the cap-binding case and the after-sent case in Q-15, §3.6, §8, §12 |
| 70 | three places still described the version-5 settlement (§3.10 item 4, §3.9, DISCOVERY Q-15) | **accepted**: each restated |
| 71 | a paid line rejected after the first-entry deadline refunded a board fee the school had paid; the waiting reason | **accepted**: the per-line "sent" rule; "not sent" only for a held line; `declaration_rejected` (§3.5) |
| 72 | "stay as they are" against the rules this design changes | **accepted**: the lists replaced by what each rule now reads (§3.3, §8) |
| 73 | a lapsing plan left the line payable; `plan_revoked` not a known reason | **accepted**: a lapse expires the line (`plan_lapsed`); the reasons listed in §3.1, §3.10, §8 |
| 74 | `failOpenPayment` cannot reach a plan line | **accepted**: an instalment payment's failure expires its line through the charge (§3.6) |
| 75 | items 2 and 3 against deposit slips; Q-22 missing from DISCOVERY.md; the prototype's January deadline | **accepted** |
| 43, 56, 59, 60, 61 | residues (`submitInstapayReference` and `referenceDueFor`; the revert guard; "series' deadline" in §8; the 09 wording; "of that syllabus") | **accepted**: each corrected |

The reviewer's diff check of version 7 (19:05Z): 70, 71, 73, 75 and the residues resolved; 72
mostly; **69 not** — the restated comparison was the wrong way round (a family whose deposits
are below the school's share loses *less* than a paid drop, not more, because it can lose only
what it paid), and three sentences still compared with a drop "that day" without "before the
entry is sent"; and a new material flag **76**: version 7 made *any* failed instalment payment
expire the line with a forfeit, where `failOpenPayment` expires a checkout's lines only when
they are no longer payable. Version 8 (this text): the comparison stated the right way round in
§3.6, §12 and Q-15, "before the entry is sent" added where it was missing (§3.6, Q-15,
DISCOVERY.md Q-15); an instalment payment's failure expires the line only under
`failOpenPayment`'s own test, otherwise the plan stands and the instalment can be paid again
(§3.1, §3.6, §3.10 item 8); the stray "other per-series rules are unchanged" clause removed
(§3.3). The reviewer's diff check of version 8 (19:08Z): 69, 72 and 76 resolved, the
comparison the right way round in all four places and every comparison with a paid drop
qualified; **"ready for the owner. Nothing material is left."** Last line: "I am Claude Opus
5.5."

## 17. Questions for the owner, each with the default built unless answered

| # | Question | Default |
|---|---|---|
| Q-19 | On a drop, the forms refund a percentage of "the Course fees". Is the **board fee** refunded in full while the school has not yet sent the entry to the board, and not at all after — or does the percentage apply to the whole price as today? "Sent" is F4's mark once F4 is live; until then the series' entry deadline; for a series whose deadline was never entered, the day its exams start — so a series left without a deadline refunds the board fee in full up to the exams. The default changes four test outcomes (§3.10). | the percentage on the course fee; the board fee in full before the entry is sent, 0 after; converted lines keep today's basis |
| Q-20 | The admin's point 9 says every deadline can have an exception; MO-10 (27 Sep) made the board's entry deadline a hard stop. May the admin grant a late entry past it, with the board's late fee charged to the family as a charge? | the hard stop stays; the `deadline.boardEntry` policy exists but is switched off by the setting until you say otherwise |
| Q-21 | When a remark changes the grade, the British Council refunds the fee less 100 EGP per component to the school. Does the school pass exactly that on to the family (today the system refunds the whole fee)? | **today's behaviour** (the whole fee) until you answer; the rule is a field per service |
| Q-15 | Instalments are built as your default: a plan per line, granted as an exception, each instalment paid into the family's held wallet on its date, the line paid from those deposits at the last. **When a family stops paying** (the line expires, or finance ends the plan), the deposits are settled as a drop on that day: the school keeps what it would have kept from a family who paid in full and dropped that day before the entry was sent to the board, capped at what was deposited; the rest returns to the family's escrow; nothing more is owed. Worked example with course 1,000 and board 500 in a winter week where the policy refunds 50% of the course fee: a family who paid 1,500 and drops before the school has sent the entry gets 1,000 back and the school keeps 500 (after the entry is sent the board fee is with the board, so that family gets 500 back and the school keeps 1,000); a plan family who paid 1,000 of 1,500 and stops gets 500 back and the school keeps 500; one who paid 500 gets nothing back and the school keeps 500; one who paid only 300 gets nothing back and the school keeps 300 — the deposits are the ceiling: a family that stops paying never loses more than the family that paid and dropped before the entry was sent, and loses less only because it paid less. Note what this does not change: a family with no plan that never pays at all is expired at no cost, as today (a line awaiting payment is taught, and costs nothing when it expires) — if you want an unpaid taught line to cost something, that is a separate rule to ask for. Is this the rule you want, and who may grant a plan? | finance admin and admin; a stopped plan settled as a drop on that day |
| Q-22 | A family may declare a retake the school has not verified yet. Until the coordinator verifies it, the line keeps the later retake deadline where the board sets one, so an unverified declaration lets a line run past the first-entry deadline. Keep that (the form trusts the family; the coordinator's list and reminders exist to verify in time), or hold every unverified line at the first-entry deadline? | keep it (`enter_as_declared`) |
