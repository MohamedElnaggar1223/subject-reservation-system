# The coordinator rework — a session set up the way she works

**Date:** 26 October 2026 · **Status:** decisions final (the owner, 26 Oct); the coordinator's
answers pending, each replaced by a default she can change (§3) · **Supersedes** for session set-up:
RESERVATIONS_REWORK.md §3.1–§3.4 and §4.1–§4.2, CATALOGUE.md §1 and §4 (as the base of
reservations), SESSION_WORDS.md. The money core of RESERVATIONS_REWORK.md §3.10 stands.

## 0. Why

On 26 Oct 2026 the owner sat with the coordinator who runs the school's registration forms. She
builds the forms of each session's subjects and sets their prices; only collecting money is not
hers. The owner's verdict: the system "made her job a million times more complex". The target:
she replicates a session from her Drive "with the least amount of steps possible", keeps the
versatility of a custom form, and is controlled enough that she makes as few mistakes as possible;
families, who reserve and pay online, are served by the same design.

What the review found (the session of 26 Oct; evidence in that transcript and §1):

- **The coordinator role cannot build a session.** On main 83d3a15 she cannot create, edit, open
  or close a session, add a subject or a teacher, write a board fee, change the self-study share or
  the refund policy, copy a session, or switch reminders on. Her Home sends her to fee screens that
  are read-only for her.
- **The model was built from the board's side.** "A reservation line is what the board sees"
  (RESERVATIONS_REWORK.md §2 principle 3) put entry concepts (awards, suites, entry methods,
  option codes, sittings with a dozen dates, per-sitting deadlines, checkout split per deadline)
  into set-up. The Catalogue was designed before the forms reached us and then made the source of
  every family choice; MO-10, a decision about InstaPay at the close, grew into the per-sitting
  hard-stop machinery; "no copy-and-edit" (principle 8) removed her strongest tool; F6a changed the
  words, not the structure ("no model change, no migration").
- **The simulation** (all 25 June 2027 forms, three ways):

  | | Google Forms (copy last cycle) | Current system | This plan |
  |---|---|---|---|
  | First time on the tool | ~375 actions | ~860 (computed from the admin guide's data) | ~40 reviewing a pre-loaded June 2027; ~200 from scratch |
  | Every next cycle | ~375 | ~70 (admin only) | ~30 |
  | Board concepts to learn | 0 | 15+ | 0 |
  | Mistakes in her live June 2027 set prevented | — (19 got through) | 18 of 19 | 19 of 19 |
  | New traps | — | 6 | none known |
  | Forms expressed faithfully | 25, meaning ambiguous | 25, wording replaced on all, behaviour differs on 14 | 25 |

## 1. Ground truth

- **The 25 June 2027 forms**, Drive folder `1L63fF-ho5p_eL47VHK5Er_-EnU_3GM8-`, read again on
  26 Oct 2026 from each form's preview page (nothing submitted). 17 O.L., 8 A.S./A.L. On 7 Oct 9 were
  closed to responses; on 26 Oct 13 are closed and 12 open: **she closes subjects one at a time.**
  Every form: 7 identity questions, the subject's own choices, "I confirm my registration / I will
  drop", the refund policy to tick, the declaration. No price, no date, no branching.
- **The links sheets**: June 2027 (25 rows: subject, board, teachers, link) and November 2026 /
  January 2027 (one combined cycle: one sheet, one Biology A.S./A.L. form covering both sittings,
  an "Arabic A.L. (Edexcel) January 2027 ONLY" form).
- **The fee lists** (the school's own tables, EGP): Cambridge June 2026; Edexcel June 2026,
  January 2026, November 2026 (IAL and IGCSE). **The enquiry-about-results sheets** (Cambridge,
  Edexcel, June 2026) — post-results services, out of scope (A6).
- **Her mistakes that reached families in the June 2027 set (19)**, all of which this plan
  prevents: CS O.L. offers "From June 2025 / From November 2025"; CS O.L. class list has "Option 9"
  and no 11E; Chemistry O.L. has no 11E; Mathematics A.S./A.L. leaves the student's name optional;
  Global Citizenship's refund box has no policy text; the ESL form's title has no session; six
  teacher names disagree between the links sheet and the forms (ESL: Nevine Atabany / Mai Hesham;
  Mathematics O.L.: Bothaina Hamed / Seif Thabet; Global Citizenship: May Magdy / "Ms. Mai"; Engy
  Henein / Henin; Mo'men / Mo'man Fadly; Layla Elgueretly / Lyla El Gueretly); Arabic A.L. "9AA01"
  on the form, "9AA1" on the sheet; the links sheet numbers two rows 11, two rows 7 and has no 14;
  "50&" for "50%" on two forms.

## 2. Decisions (final)

Each decision is the owner's (26 Oct 2026) or follows from her forms (§1); her own answers, when she can be reached, change settings, not the design (§3).

### A. Principles

| ID | Decision |
|---|---|
| A1 | The system is built around **the school's offer per session**: its subjects, what each can be entered as, how it is studied, and what it costs. Not her forms' medium, not the board's entries. |
| A2 | **Two audiences, designed apart.** The coordinator works in her concepts through closed lists; families get one consistent page per child, personal to that child. |
| A3 | **Error rule:** derive rather than ask; pick rather than type; any change that affects families shows its impact before it is saved ("12 unpaid reservations will be re-priced"). No free text carries meaning (price, eligibility, sitting); free text is only ever an optional note. |
| A4 | **The money core stays**: payments, receipts, balance (escrow), refunds, charges, statements, the 09 invariants. |
| A5 | **The model changes now**, while no real family is on the system. A clean database, with June 2027 pre-loaded from her forms (§8) as the session she copies from. |
| A6 | **Scope:** set-up, reserving, paying, dropping and refunds, the desk. **Parked** (hidden, code kept): scheduling and timetables, exam entries, candidates, entry lists, results, remarks and enquiries about results, board services (cash-in, certificate split), school fees, the exam deadlines screen. |

### B. Roles

| ID | Decision |
|---|---|
| B1 | **Coordinator**: all of set-up (sessions, subjects, teachers, prices, policy, dates, open/close, copy) and read access to who reserved and who paid. She does not take payments, issue receipts or refund. |
| B2 | **Admin**: everything the coordinator has, plus money and staff accounts. |
| B3 | **Finance officer, finance admin**: unchanged; prices are read-only to them. |
| B4 | **Teacher, gate**: stay hidden. |

### C. Session

| ID | Decision |
|---|---|
| C1 | **Type**: a dropdown with **June** and **November / January** — the school's two cycles (one links sheet each). The sittings June, November and January live inside: a June session's rows sit in June; a winter session's rows sit in November or January, picked per row (D12). |
| C2 | **Year**: a dropdown (this year, +1, +2). **Name**: derived ("June 2027", "November 2027 / January 2028"); never typed. |
| C3 | **Start**: "Copy the last session of this type" (default) or empty. Copying moves every year forward (sittings, "carried from" lists, dates) and brings last cycle's prices marked "last year's — not final". |
| C4 | **Visibility**: a draft is invisible to families (no preregistration in a draft). The session has an **Accepting reservations** switch and an optional automatic close date; **each subject has its own switch and optional close date** (amendment 1). No automatic opening. |
| C5 | **Dates on the session**: reservations close (optional), payment due, first lesson (the refund weeks count from it). Each is a date picker with a sensible default when copied. |
| C6 | **Board deadlines** are reference data we keep (§7), never typed by staff (one exception: the admin enters a date the reference lacks, once, from the check list). They warn (her close, payment or cancel date after a board's deadline) and they stay the last money safety net: an unpaid line expires no later than its board deadline, and a transfer that reaches finance after it is credited to the family's balance, not to the line (today's late-transfer path). In every other respect her dates are the stop; reserving and paying no longer split by sitting. No late entries. |
| C7 | **Refund policy**: weeks and percentages (rows of "until week N → P%"), the sentence families read generated from them, so the words and the money cannot disagree. Defaults: June — 100% to week 2, 50% in week 3, 0% from week 4; November / January — 100% to week 2, 50% in weeks 3–6, 0% after (her forms). Copied from the last session of the type; locked once a family agrees, as today. |
| C8 | **Declaration**: one school-wide text (a new setting, `reservation.declarationText`, whose default is today's `DECLARATION_TEXT`), edited by the admin, snapshotted on each consent. |
| C9 | The form's "I confirm my registration / I will drop" question goes: reserving is confirming; a drop is its own action that shows the refund first. |
| C10 | **Unpaid reservations** expire (reason `cut_off`) a set number of days after their payment-due date (session setting, default 3), or at their board deadline if that is earlier (C6), with reminders before. At the cut-off an unfinished card or pay-at-school checkout ends first (money back to the balance); an InstaPay checkout waits for its reference until its own due time (cut-off + the grace hours, never past the board deadline) and protects its lines until then; a transfer under verification protects its lines until the earliest board deadline among them. A line whose price is not final never expires for being unpaid before its board deadline. |

### D. Subjects in a session

| ID | Decision |
|---|---|
| D1 | **Subjects are picked from a reference list we maintain** (§7): board, name, code, level, its papers, units and routes, the board's rules. "Not on the list" lets her add one (board, name, level, group; code optional), flagged for us. |
| D2 | **Rows — what can be entered**, suggested from the reference: all papers; each one-paper retake; each IAL unit; A.S., A.2. (carry forward), A.L.; a second qualification (Arabic A.L.). She ticks the rows the school offers and may add a custom row (name, optional code, its own price). |
| D3 | **Columns — how it is studied**, fixed: first entry in school · retake in school · retake self study. A fourth, **first entry self study** (not taught this cycle), sits under "more options" on a row (amendment 7). |
| D4 | **Teachers**: per subject, with an override per row (IAL Mathematics units, Arabic A.L. qualifications). Picked from the school's list or added with a duplicate check (spelling and initials: "Ms. Mai" against "May Magdy"). Tags: online, external team. **"Teacher to be confirmed"** is allowed (amendment 3); families then read "teacher to be announced". |
| D5 | **Teacher choice**: families choose the teacher, required, when they pick an in-school option and the row has more than one teacher (her forms require it); one teacher is preselected. Per subject she can switch to "the school assigns". |
| D6 | **"Carried from" sittings** (one-paper retakes, A.2.): the default list is the board's two previous sittings, worked out from the session (June 2027 → June 2026, November 2026); she unticks any and can add an older one (amendment 2); her list wins over the board's carry-forward months (an older sitting than the board allows — Cambridge: 13 months — shows a warning on her screen, not a refusal). A rule per board in the reference decides whether the question is asked at all (Edexcel International GCSE 1H/2H: not asked). |
| D7 | **"2nd entry only"**: enforced when the system holds the student's earlier entry for the subject; otherwise trusted, as her forms trust it. A one-paper or A.2. retake names its sitting from her list; the list of declared sittings is on the session for anyone who wants to check it (no verification step by default). |
| D8 | **Combinations**, fixed rules: all papers and any one-paper row exclude each other, and one-paper rows exclude each other; A.S., A.2. and A.L. exclude each other; qualification rows exclude each other; units combine freely; a teacher only on in-school options. |
| D9 | **Wording families read** is generated from her ticks, the same for every subject, in English and Arabic, in the school's vocabulary ("First entry · in school · all papers", "Retake · self study 50% · Paper 41/42 only"), plus an optional note per subject. No free-text choice labels. |
| D10 | **Order**: O.L. subjects, then A.S. / A.L.; inside a subject: all papers, one-paper rows, units in order, A.S., A.2., A.L. (her forms' order). |
| D11 | **Who may reserve**: grades 11 and 12 and graduates retaking (her class lists run 11A–12D). A session setting "grades that may reserve" (10, 11, 12, graduates), default 11, 12, graduates. |
| D12 | **Winter rows**: each row sits in November or January (dropdown, default from the reference), and may have its own close date and pay-by date. |
| D13 | **Extra questions** (amendment 6): optional, per session or per subject — yes/no, short text or a choice — that never affect price or eligibility; answers go into the reservations export. |

### E. Prices

| ID | Decision |
|---|---|
| E1 | **A price = exam fee + course fee.** The forms force the split: "Self Study 50% fees / 50% School fees" cannot halve the board's fee, and the refund policy refunds "Course fees". The exam fee comes from her lists; the course fee is the school's and may be 0. A fee that is not set is distinct from 0. |
| E2 | **Exam fees**: she pastes her list as printed (code, name, amount; "S1 / S2" pairs and old codes such as 9608 accepted through the reference's aliases); rows match by code. A **missing prices** list (amendment 4) shows every row without a fee, each filled by typing it, summing its units, or copying from another list. |
| E3 | **Course fee**: one per subject per session, overridden per row (a unit, a one-paper retake, an A.L.). |
| E4 | **Self study** pays the session's self-study share of the course fee (default 50%, shown on every subject, changeable on the session) and the whole exam fee; a row may override with its own amount. No global percentage settings. |
| E5 | **One-paper exam fee**: the board's rule from the reference (Cambridge: the syllabus's fee; Edexcel: the paper's own row), filled in on the row, overridable. |
| E6 | **Prices final**: one switch on the session. Families may reserve before it; they cannot pay until it is on. A subject with any price not set is not offered to families, and the check list says so. |
| E7 | **A price changed after reservations**: unpaid lines re-priced and their families told; paid lines listed for finance (a charge or a refund is finance's act). The dialog shows the counts before saving. |

### F. Families

| ID | Decision |
|---|---|
| F1 | **One reservation page per child per session**: every subject the child may take, only the options open to them, the price beside each, one total, one consent (refund policy and declaration) for the session, one checkout. No split by deadline. |
| F2 | **Records decide what shows**: a student the system knows has sat the subject (an earlier line or result for what the row enters) sees the retake options only, with that sitting filled in; every other student sees first entry and retake, a retake being declared as on her forms (a student may have sat elsewhere, so the system never hides a retake it cannot rule out). |
| F3 | No board jargon on family screens: no "sitting", "series", "component", "award". |
| F4 | Drop and teacher-change requests after reserving, with the refund shown before confirming. Drops stay open after the session closes, until the entry is sent (§10: an exam-entry mark, else the board deadline); swapping to another subject only while that subject accepts reservations. |
| F5 | Arabic and English; phones first. |

### G. What leaves the product

| ID | Decision |
|---|---|
| G1 | The Exam Catalogue leaves every role's screens; its reference role is taken by §7, maintained by us. |
| G2 | Board Series and the exam-entry screens are parked (A6). |
| G3 | The coordinator's Settings page is empty of session rules: they live on the session. |
| G4 | Exceptions: two kinds only, from the student's page — a price override for a line and a later date for one student (reserve or pay). |
| G5 | The Grade 10 tab, To verify, Correct the sitting, Subject Management, Board Services and School Fees leave the set-up path. |
| G6 | Messages and reminders: the existing reminders stay; the rest is parked. |

### H. How we get there

| ID | Decision |
|---|---|
| H1 | The coordinator cannot be reached for now: **the owner acts as her** for every acceptance test; her answers are collected later (§3) and applied as settings, not rebuilds. |
| H2 | A clickable mock of the coordinator's screens and the family page is shown to the owner before the screens are built (phase P2 starts from it). |
| H3 | This file is the plan of record; the trail is `.audit/coordinator-rework.tsv`. |

## 3. What we think she meant (her questions, answered by default)

Each default replicates what her form does or is the reading the forms support; each is changeable
by her without a rebuild. "Check" marks the ones to confirm when she can be reached.

| # | Question | Default built | How she changes it | Check |
|---|---|---|---|---|
| Q1 | Exam fee + course fee? What course fees? | E1: both; course fees not set until she types them (a subject with a fee not set is not offered) | the course fee on the subject and its rows | yes — the figures |
| Q2 | Self study: 50% of what? | 50% of the course fee, the exam fee whole | the session's self-study share; a row's own amount | yes |
| Q3 | Do families choose the teacher? | yes, required, as on her forms | per subject: "the school assigns" | yes |
| Q4 | "2nd entry only": trust or check? | enforced from records; otherwise trusted, as her forms | — (the declared list is on the session) | yes |
| Q5 | Grade 10 in June? | no (no form lists a grade-10 class) | the session's "grades that may reserve" | yes |
| Q6 | Ever a November-only or January-only cycle? | no; a winter session holds both, a row may be January only | per row sitting | yes |
| Q7 | Refund policies | C7's two defaults, from her June and November forms | the session's policy rows | yes |
| Q8 | "Penalty" families accept | read as the refund policy, the only penalty on the forms; no late-registration fee | a per-student price override (G4) | yes |
| Q9 | Late registration with the board's late fee | not offered; a per-student later date and price override cover a case | G4 | yes |
| Q10 | Retake in school (spelt out only on Arabic O.L.) | ticked wherever first entry in school is ticked — a retaker who picks a teacher on her forms is a retake in school — unless the form prices retakes another way (Biology A.S./A.L. units 5–6: "First entry 100%" or "Self Study 50% 2nd entry ONLY") | untick the cell | yes |
| Q11 | Physics A.S./A.L. "A.2. (Self Study 50% fees in June 2027)" vs the carry-forward A.2. options | one A.2. row, first entry self study, carried from June 2026 or November 2025 (her two options) | the row's cells and sitting list | yes |
| Q12 | On A level forms, which routes may be self-studied? | every route row offered gets retake self study (the form's Yes/No covers the whole subject) | untick per row | yes |
| Q13 | Arabic A.L. self study: which qualification? | both | untick per row | yes |
| Q14 | CS O.L. "Paper 41/42" question (with 2025 sittings) | not pre-loaded: the syllabus has no such paper in the reference; she can add a one-paper row | add the row | yes |
| Q15 | Teacher name disagreements (§1) | the form's names (what families chose from), the links sheet's spelling where it is plainly the same person; each listed on the session's check list | edit the teacher | yes |

## 4. The model

Plain terms first; table names are the implementer's (§9 maps them onto today's schema).

- **Session**: type (june, winter), year, derived name, status (draft, open, closed — the
  Accepting switch is the status; closed may reopen; nothing expires at the close), closes_at
  (optional), payment_due_at, course_starts_on, refund policy rows, self-study
  share (default 50), prices_final, grades that may reserve, unpaid-cancel days (default 3),
  copied_from.
- **Offering** (one per subject per session): reference subject (or a custom one), board, group
  (O.L. or A.S./A.L.), family note (optional), accepting switch, closes_at (optional),
  teacher choice (families choose / school assigns), teacher to be confirmed (flag), course fee
  (not set, or EGP), sort order, extra questions.
- **Offering teacher**: teacher, online, external.
- **Row** (what can be entered): kind (all papers, paper, unit, A.S., A.2., A.L., qualification,
  custom), reference codes, generated label, sitting (June, November, January), closes_at and
  pay_by (optional, winter), exam fee (not set, or EGP) and its source (list row, typed, summed),
  course fee override, the four cells (first in school, retake in school, retake self study, first
  self study), carried-from asked (board rule) and allowed sittings, teacher override with online
  flags, sort order.
- **Price list** (per session per board): its name ("Cambridge June 2026"), the pasted rows as
  printed (code, name, amount) and which row each matched.
- **Teacher**: one record per person, optional account, kind (person, external team).
- **Reference data** (ours, read-only to staff): boards and their sittings with board deadlines
  (information), subjects with codes, groups, rows, code aliases, the one-paper fee rule and
  whether a one-paper retake asks its sitting.
- **Reservation line** (today's `registration`, kept): the row, the column (attempt: first or
  retake; mode: in school or self study), teacher, carried-from sitting, due date, and the price
  snapshot (exam fee, course fee, basis) the money core reads today.

Rules the system derives (A3): the session name; the sittings of each row; the "carried from"
defaults; the family wording; the subject list families see per child; who may pick what; the
price of every option; due dates; warnings against board deadlines; the copy's year roll.

## 5. Screens

**Coordinator** (and admin):

1. **Sessions** — a card per session (status, dates, subjects, reservations), "New session".
2. **New session** — type, year, start from (copy / empty); name shown, never typed.
3. **Session** — header: name, status, Accepting switch, the three dates, prices final; then:
   - **Check before you open**: everything that blocks or deserves a look (subjects with a price not
     set, a teacher to be confirmed, a date after a board deadline, a sitting with no board date
     (blocks opening; the admin enters the missing date once and it joins the reference data), the
     payment date passed while prices are not final, teacher-name doubts, dates a copy moved, last year's prices);
   - **Subjects** in two groups (O.L., A.S./A.L.), each a tile with board, teachers, its switch;
     "Add a subject" (pick from the board's list, or copy a similar subject);
   - **Prices**: paste a list per board, the matched table, the missing-prices list;
   - **What families agree to**: refund policy rows and the generated sentence; the declaration (read);
     self-study share; grades that may reserve; unpaid-cancel days; extra questions;
   - **Reservations** (read): who reserved what, paid or not, with the export.
4. **Subject** — the grid of D2–D3 with fees on each row, teachers and their tags, the earlier exams
   a retake carries from, the note, extra questions, the subject's switch and close date, and the live preview
   of what a first-time student and a retaker see.

**Families** — the reservation page of F1; checkout as today without the split per deadline;
statement and receipts unchanged.

**Desk** — the same reservation page on a family's behalf, then collection as today.

## 6. Rules, stated once

- **Price of an option** = exam fee × 100% + course fee × (100% in school; the session's
  self-study share in self study, or the row's own self-study amount), then a per-student price
  override if any. The line snapshots exam fee, course fee and the basis; "price = course fee +
  exam fee" (09) holds.
- **Exam fee defaults**: a one-paper row by the board rule (E5); a unit row by its own list row; a
  qualification row made of units by the sum of its units (Arabic YAA01).
- **May reserve** (`mayReserve`): the session open; the offering accepting and not past its close;
  the row not past its close and not past its board deadline; the option's cell ticked; the
  student's grade in the session's list; F2 and D8; a G4 later reserve date overrides her dates,
  never the board deadline.
- **May pay** (`mayPay`): the line waiting and not expired; not past its cut-off; prices final; the
  student still at the school. Closing a subject or the session never stops a waiting line from
  being paid. A G4 later pay date overrides her dates, never the board deadline. **Confirming a
  transfer under verification, and capturing an instalment plan, check the board deadline instead
  of the cut-off** (today's exception, `payment.services.ts:578`; `plan.services.ts:308`).
- **Due date of a line**: the row's pay-by if set, else the session's payment due; a line reserved
  after that date is due `payment.graceDays` (global setting, as today) after reserving; while
  prices are not final, switching them final re-dates every waiting line from `prices_final_at`
  (today's confirm behaviour).
- **Cut-off of a line** = the earlier of due date + the session's cancel days and the line's board
  deadline (`line_effective_deadline`, dates from reference data). At the cut-off: an unfinished card
  or pay-at-school checkout covering the line ends first (money back to the balance), then the line
  expires with reason `cut_off`. An InstaPay checkout still awaiting its reference protects its
  lines until its `reference_due_at` (cut-off + `INSTAPAY_REFERENCE_GRACE_HOURS`, never past the
  board deadline). A transfer under verification protects its lines until the earliest board deadline among them;
  there today's per-series step fails it whole (escrow back), the lines past their own cut-off or
  deadline expire (reason `entry_deadline` at a board deadline, `cut_off` otherwise), and finance
  credits a transfer that did arrive with `recordLateTransfer` (`payment.services.ts:1104`). (A
  winter transfer covering November and January lines therefore ends at November's deadline;
  finance's verification list shows transfers nearing a board deadline first.) A line with any
  instalment payment in progress or under verification stays protected, exactly as today
  (`overdue.services.ts:27–29`, unchanged).
- **Expiry reason**: `entry_deadline` when the board deadline is the earlier date, `cut_off` when
  the session's own date is — decided by the dates, not by which job runs first. A line whose price is not final is skipped until its board
  deadline.
- **A request awaiting a parent's approval** (`pending_approval`) still expires at the session's
  close (`finalizePendingRecords`) or its subject's or row's close (the cut-off sweep), since
  approving it needs `mayReserve`.
- **Prices final is one-way** once any line exists in the session; later changes go through E7.
- **Changing a row's sitting** is refused while lines use the row (the routing trigger already
  refuses it); she closes the row and adds another.
- **Copy**: every offering, row, cell, teacher, note, extra question, policy and share; sittings,
  carried-from lists and dates moved one year; prices copied as last year's (prices final off).
- **Impact before saving** (A3): a price, a course fee or the self-study share changed, a row or a
  subject removed or closed, a cell that lines use unticked (refused if lines use it; closing the
  row is offered instead). Each impact route returns the counts and the save must send them back
  (409 `IMPACT_CHANGED` if they moved — today's `PRICE_CHANGED_REFUSAL` pattern).

## 7. Reference data

Kept in the repository as data (one file per board), loaded by a seed, maintained by us; staff read
it, never edit it, except the admin filling a missing board date from the check list (C6). For each board: its sittings per year and their deadlines (information), the
one-paper fee rule, whether a one-paper retake asks its sitting, code aliases. For each subject:
code, name, group, its rows (kind, code, label), default sitting for a winter session.

First version: the school's subjects in the June 2027 and November 2026 / January 2027 links sheets
(§8), drafted from the forms and fee lists. Codes on no list we hold are marked to check (Global
Citizenship; French A level; Psychology A level 9990; the two OxfordAQA subjects); until checked
they load as "not on the list" subjects with no code.

### 7.1 Data format (P0 writes it, P1a loads it)

Validated by a zod schema in `packages/validations/src/offering/reference.ts` (P0).

- `packages/db/reference/boards.json` — an array of boards:
  `{ code: 'cambridge' | 'pearson_edexcel' | 'oxford', name, onePaperFee: 'syllabus' | 'paper',
  onePaperAsksSitting: boolean, carryForwardMonths: number | null,
  sittings: [{ month: 1 | 6 | 10 | 11, year, entryDeadline: 'YYYY-MM-DD' | null,
  retakeDeadline: 'YYYY-MM-DD' | null, examsStart: 'YYYY-MM-DD' | null, source, confirmed }],
  aliases: [{ printed: '9608 SY', subject: '9618', row: 'as' }] }`.
- `packages/db/reference/subjects/<board>.json` — an array of subjects:
  `{ code, name, group: 'O.L.' | 'A.S./A.L.', level: 'igcse' | 'as_al', confirmed, note?,
  winterSitting: 'november' | 'january' | null,
  rows: [{ key, kind: 'all_papers' | 'paper' | 'unit' | 'as' | 'a2' | 'al' | 'qualification',
  codes: string[], priceCodes: string[], short?: string, label: { en, ar }, sumOfUnits?: string[] }] }`.
  `key` is stable across years (it is what a copied row and a price-list match refer to);
  `priceCodes` are the codes a printed price list uses for that row ("0970 CX", "WMA11", "4MA1H").
- `packages/db/seeds/june-2027.json` — the pre-load of §8: the session (type, year, refund policy,
  self-study share) and its offerings (subject code, teachers by placeholder key, note, rows by
  `key` with the four cells, exam fee and its source, course fee null, allowed prior sittings).
  Teachers' names are the forms' names and live in the git-ignored
  `packages/db/seeds/local/june-2027.teachers.json` (placeholder key → name), following the data
  rule of SCHOOL_FORMS.md; the seed uses the placeholder when the local file is absent.
- `packages/validations/src/offering/labels.ts` (P0): the generated wording of D9–D10 in English and
  Arabic, a pure function of a row and an option, shared by the API and the web.

## 8. June 2027, pre-loaded

The session she copies June 2028 from. FI first entry in school · RI retake in school · RS retake
self study · FS first entry self study. RI marked * is Q10's default. Exam fees are her latest
lists, "not final"; course fees are not set (Q1). Sittings carried from are D6's defaults unless
the form named others.

| # | Subject (board, code) | Teachers (form) | Rows → cells | Carried from | Exam fee (source) | Flags |
|---|---|---|---|---|---|---|
| 1 | Arabic O.L. (Cambridge 3180) | Hamdy Elshal, Mohamed Hamed, Wael Ehsan | All papers FI RI RS · Paper 1 only RI RS · Paper 2 only RI RS | June 2026 | 9,850 (Cambridge Jun 26, 3180 A); one-paper rows 9,850 (syllabus rule) | the June form does not ask which paper; the split follows her November form |
| 2 | Biology O.L. (Cambridge 0970) | Ahmed Rady, Heba Rashed, Kirolos Nabil | All papers FI RI* RS · Paper 41/42 only RS | June 2026, November 2026 | 10,850 (0970 CX) | — |
| 3 | Business O.L. (Cambridge 0986) | Karim Ashmawy | All papers FI RI* RS | — | 9,850 (0986 AX) | — |
| 4 | Chemistry O.L. (Cambridge 0971) | Mo'men Fadly, Dina Mohsen, Engy Henein | All papers FI RI* RS · Paper 41/42 only RS | June 2026, November 2026 | 10,850 (0971 CX) | — |
| 5 | Combined Science O.L. (Cambridge 0653) | Engy Henein | All papers FI RI* RS · Paper 41/42 only RS | June 2026, November 2026 | 10,850 (0653 CX) | spelling (Henin) |
| 6 | Computer Science O.L. (Cambridge 0984) | Ismail El Badawy — external (Komy's team) | All papers FI RI* RS | — | 9,850 (0984 AX) | Q14 |
| 7 | English as a Second Language (OxfordAQA) | Magda Morcos, Mai Hesham | All papers FI RI* RS | — | not set (no Oxford list) | Q15 (Nevine Atabany); code to check |
| 8 | Environmental Management O.L. (Cambridge 0680) | Heba Rashed | All papers FI RI* RS | — | not set | — |
| 9 | French O.L. (Cambridge 7156) | Rania Sabry | All papers FI RI* RS | — | 12,550 (7156 X) | — |
| 10 | German O.L. (Cambridge 7159) | Abir Ezz | All papers FI RI* RS | — | 12,550 (7159 Y) | — |
| 11 | Global Perspectives O.L. (Cambridge 0457) | Layla Elgueretly — online | All papers FI RI* RS | — | not set | spelling (Lyla El Gueretly) |
| 12 | Global Citizenship O.L. (Cambridge) | May Magdy | All papers FI RI* RS | — | not set | Q15 ("Ms. Mai"); code to check |
| 13 | Human Biology O.L. (Edexcel 4HB1) | Heba Rashed | All papers FI RI* RS | — | 9,840 (Edexcel Nov 26 — not June) | price source |
| 14 | ICT O.L. (Cambridge 0983) | Hossam Badawy — external (Komy's team) | All papers FI RI* RS · Theory paper only RS | June 2026, November 2026 | 12,950 (0983 DY) | — |
| 15 | Mathematics O.L. (Edexcel 4MA1) | Manar Madkour, Seif Thabet, Nevine El Khawaga | All papers FI RI* RS · Paper 1H only RS · Paper 2H only RS | not asked (Edexcel) | papers 4,600 each (Jun 26); all papers 9,200 (sum) | price to check (Nov 26 lists 9,840 per paper); Q15 (Bothaina Hamed) |
| 16 | Physics O.L. (Cambridge 0972) | John William | All papers FI RI* RS · Paper 41/42 only RS | June 2026, November 2026 | 10,850 (0972 CX) | — |
| 17 | Psychology O.L. (OxfordAQA) | Maria Maged | All papers FI RI* RS | — | not set | code to check |
| 18 | Arabic A.L. (Edexcel) | per row | International A Level (YAA01 = WAA01 + WAA02): FI Hamdy Elshal, RI*, RS · GCE A Level (9AA0): FI Wael Ehsan, RI*, RS | — | YAA01 18,300 (sum of 8,950 + 9,350, Jun 26); 9AA0 not set | Q13; code 9AA0 (form "9AA01", sheet "9AA1") |
| 19 | Biology A.S./A.L. (Edexcel IAL) | Rasha Nada | Units 1–4 (WBI11–14) RS · Units 5–6 (WBI15–16) FI RS (the form names no retake in school) | — | WBI15/16 4,450 (Jun 26); WBI11–14 4,790 (Nov 26) | price source (units 1–4) |
| 20 | Chemistry A.S. (Cambridge 9701) | Mo'men Fadly | A.S. FI RI* RS · A.L. FI RI* RS | — | A.S. 14,100 · A.L. 18,600 | Q12; spelling (Mo'man) |
| 21 | Computer Science A.S./A.L. (Cambridge 9618) | to be confirmed | A.S. FI RI* RS · A.2. FI RI* RS · A.L. FI RI* RS | A.2.: June 2026, November 2026 | A.S. 11,400 (list prints 9608 SY) · A.2. 12,450 · A.L. 16,950 | Q12; teacher |
| 22 | French A.S./A.L. (Cambridge) | Rania Sabry | A.S. FI RI* RS · A.L. FI RI* RS | — | not set | Q12; code to check |
| 23 | Mathematics A.S./A.L. (Edexcel IAL) | per row | one row per unit — P1 (WMA11), P2 (WMA12): FI Seif Thabet online, RI*, RS · P3 (WMA13), P4 (WMA14): FI Seif Thabet, RI*, RS · M1 (WME01), S1 (WST01): FI Manar Madkour or Seif Thabet, RI*, RS | — | P1–P4 4,800 · M1, S1 4,450 (Jun 26) | Q10 (the form offers a teacher or self study per unit) |
| 24 | Physics A.S./A.L. (Cambridge 9702) | John William | A.S. FI RI* RS · A.2. FS RS | A.2.: June 2026, November 2025 | A.S. 14,100 · A.2. 11,400 | Q11; November 2025 is past Cambridge's 13 months: kept (her list), warned (D6) |
| 25 | Psychology A.L. (Cambridge 9990) | Maria Maged | A.L. FI RI* RS | — | not set | code to check |

Not pre-loaded from any form: a close date, a payment date, a first-lesson date, course fees.

## 9. What changes in the code

**Re-base, don't rewrite.** The bottom of today's model already has the shape this plan needs: a
`session_offer` is an offering, a `session_offer_item` is a row, item and offer teachers exist,
and the money core reads the price snapshot on `registration` (`price_at_registration`,
`course_fee_at_registration`, `registration_fee_at_registration`, `pricing_basis`,
`refund_policy_snapshot`, `due_at`). `registration.offer_item_id` is NOT NULL and the money core
joins item → offer in four places (refund anchor and exception scope, statement and session-money
labels, 09). What goes is everything above and around that layer: the Catalogue as the source of
rows, the fee grid keyed by catalogue codes per series, the pricing percentages in Settings, the
availability enum, sitting deadlines as something staff type and as the thing that opens
reserving or splits a checkout. The critique of 26 Oct was aimed at those layers and at the
screens; the line and its snapshot were sound. The board deadline survives only as reference data
and as the money safety net of C6.

### 9.1 Schema (`packages/db/src/schema.ts`; migrations regenerated after main's journal at merge)

| Table | Change |
|---|---|
| `registration_session` | `status` draft / active / closed is the Accepting switch; closed → active is allowed (reopen); the close no longer expires lines (C10 does). `start_date` written at opening, no automatic opening; `end_date` → the optional close date (nullable; the automatic close reads it). New: `self_study_percent` (default 50), `prices_final` + `prices_final_at`, `allowed_grades` (default 11, 12, graduates; replaces the global `eligibility.graduateRetakes`), `unpaid_cancel_days` (default 3), `copied_from_session_id`. |
| `subject` | stays the cross-session identity (history, "2nd entry", known sittings). A reference or custom subject becomes a `subject` row on first use: `code` = the reference code, or `X-<board>-<slug>` for one without a code (`subject.code` is NOT NULL UNIQUE). Subject Management leaves the screens. |
| `session_offer` | `availability` ignored, then dropped; `course_fee` nullable (null = not set); `notes` → the family note; new: `reference_code`, `teacher_choice` ('families' / 'school'), `teacher_tbc`, `closes_at`, `accepting`. `grade10_core`, `course_starts_on` kept, unused by the new screens. |
| `session_offer_item` | `kind` → all_papers, paper, unit, as, a2, al, qualification, custom; `availability` replaced by `first_in_school`, `retake_in_school`, `retake_self_study`, `first_self_study`; new: `exam_fee` (nullable = not set), `exam_fee_source` (list, typed, units_sum, board_rule), `price_list_row_id`, `self_study_fee`, `reference_codes` (text[]), `allowed_prior_series_ids` (text[]), `closes_at`, `pay_by`; `needs_prior_series` set from the board rule; `exclusive_group` set by D8, never by staff; `entersKind` and the qualification links optional (kept for the parked exam entries); `label` generated. `board_series_id` is the row's sitting, created automatically (`findOrCreateSeries`) and linked in `session_board_series` (the composite FK requires it). |
| `price_list`, `price_list_row` | new: per session and board, the pasted rows as printed (code, name, amount) and the item each matched. |
| `session_question`, `registration_answer` | new: D13. |
| `reference_subject`, `reference_row` | new, read-only, loaded by a seed from `packages/db/reference/*.json` (§7). Board rules use `exam_board.one_paper_fee_key` and `carry_forward_months` (now a warning, D6), plus new `one_paper_asks_sitting`. |
| `board_series` | the internal record of a sitting; its dates are loaded from reference data, never edited by staff. |
| `board_fee`, `session_offer_item_fee_key` | leave the pricing path (readers in §9.2 repointed); kept for one release, then dropped. |
| `session_subject_series` | dead since 0042: dropped. |
| `registration` | unchanged columns; `pricing_basis` version 2 (exam fee and source, course fee, self-study share, exception ids); new expiry reason `cut_off`. |
| DB functions | `line_effective_deadline`, `_kind` and `charge_effective_deadline` (0048) **kept**: their dates now come from reference data and they are read only for the cut-off cap, the confirmation refusal (C6), the refund's "sent" and warnings. `catalogue_route_registration` keeps "the item's series onto the line; the item is of the line's session and subject"; `registration_move_board_series` keeps refusing a sitting change with lines; `rework_offer_item_check` keeps the board check and "IGCSE never sits in October or January". |
| Settings | `pricing.selfStudyCoursePercent` → the session's share; `pricing.selfStudyBoardPercent`, `pricing.retakeTaughtCoursePercent`, `pricing.onePaperCoursePercent` removed; `pricing.payOnProvisionalFee` → `prices_final`; `payment.expireOverdueAfterDays` → the session's `unpaid_cancel_days`; `exceptions.boardEntryDeadline` and the `deadline.boardEntry` exception removed (no late entries); `verification.unverifiedAtDeadline` removed (D7); `eligibility.graduateRetakes` → `allowed_grades`; `reservation.declarationText` added (C8); the refund defaults seed only a first session. |

### 9.2 Services (`apps/api/src/services/`)

| Service | Change |
|---|---|
| `window.services.ts` | `sessionWindow` split in two (B1 of the review): `mayReserve` and `mayPay` (§6). Callers: `registration.services.ts:65`, `desk.services.ts:179`, `import/commit.ts:534`, `import/view.ts:959` → `mayReserve`; `payment.services.ts` checkout (:236–246), `desk.services.ts:502` (collect), `payment.services.ts:2519` → `mayPay`; `confirmPayment` (:571–580) and plan capture (`plan.services.ts:308`) keep today's board-deadline check for a transfer under verification, not `mayPay`'s cut-off; `failOpenPayment` (:824) no longer expires a line because a subject closed — only past its cut-off. |
| `pricing.services.ts` | `priceLine` v2 (§6); `provisional = !session.prices_final`; re-pricing keyed by row. Lock order: `insertLines` reads the session, offering and row `FOR SHARE`; a re-price locks the row `FOR UPDATE`, then the lines `FOR UPDATE`, then reads their payment history (today's rule). A course-fee or self-study-share change runs the same batch. |
| `offer.services.ts` | the admin side rewritten: add a subject from the reference, the grid, teachers with the duplicate check, D8, labels, copy with the year roll (`copyOffersFrom` extended); `withOnePaper`, `onePaperFeeKeys`, `wholeItemOption`, default fee keys and the item series move (:692–748) leave. |
| price lists (new) | parse (codes, aliases, "S1 / S2"), match, units sum, board rule, missing prices, apply with impact counts. |
| `offers-read.services.ts` | the family payload (Appendix A): options from the cells, F2, prices, teacher choice, allowed sittings, questions; no series or deadline fields; a preview mode for a first-timer and a retaker (the coordinator's live preview). |
| `line-rules.services.ts` | v2: cells, D8, allowed sittings (her list; carry-forward months only warn), grade list, `mayReserve`; `gate.sameEntryOnce` kept on (row code, sitting); required items, availability and the grade-10 core leave; date refusals keep policy keys for G4. |
| `line.services.ts` | `insertLines`: the "no deadline / past deadline" refusal (:144–156) replaced by `mayReserve`. |
| `overdue.services.ts` | `expireOverdueLines` becomes the cut-off sweep (§6), reading the session's days and the board-deadline cap. Today it skips lines with any open payment, `pending` included (:24–29): narrow the first clause (checkout payments) to transfers under verification and InstaPay checkouts inside their grace; keep the second clause (:27–29, any instalment payment `pending` or under verification) unchanged; before expiring, fail card and pay-at-school `pending` checkouts whose earliest cut-off has passed, and give an InstaPay checkout with no reference its `reference_due_at` (cut-off + grace) instead of failing it. It also expires `pending_approval` lines whose subject or row has closed, and it already settles plans. |
| `payment.services.ts` | mixed-deadline refusal (:200, :399) and `getCheckoutSummary.deadlineGroups` (:2182, :2233) go; `enforcePaymentDeadlines` keeps the InstaPay reference step, **its per-series step at the board deadline** (:1311–1357: fail open payments including transfers under verification, expire waiting lines — now on reference dates, so `recordLateTransfer` keeps working), the service-charge and instalment steps, and drops `holdUnverifiedAtDeadline` (:1267) and the draft-session preregistration refunds; `confirmPayment` still refuses past the line's board deadline, the money going to the balance through the late-transfer path (C6). |
| `session.services.ts` | create, edit, copy, open, close, reopen for the coordinator and the admin; `autoManageSessions` only closes at `end_date`; `finalizePendingRecords` no longer expires waiting-for-payment lines or rejects drop requests (it still expires `pending_approval` lines, §6); its step that fails unfinished checkouts and sets InstaPay `reference_due_at` moves to the cut-off (`referenceDueFor` = earliest cut-off + `INSTAPAY_REFERENCE_GRACE_HOURS`, never past the board deadline). |
| `desk.services.ts` | one payment per collection (`createDeskPayments` per group goes); `pricing.payOnProvisionalFee` reads (:257, :843) → `prices_final`. |
| `swap.services.ts`, `desk-drop.services.ts`, `refund.services.ts` | a family drop is allowed after the close until the entry is sent (`assertBeforeLineDeadline` kept; the "session active" check :236–237 applies to swaps only); "sent" = an exam-entry mark, else the line's board deadline (kept); a line confirmed through the late-transfer path is never confirmed after the deadline, so "sent" cannot keep an exam fee for an entry not made. |
| `plan.services.ts`, `charge.services.ts` | the last-instalment cap reads the cut-off (not `session.endDate`); capture keeps its board-deadline check (:308). |
| `eligibility.services.ts` | `judgeEligibility` (:107–120, :181–182) reads the session's `allowed_grades` for new reservations only; the re-check at payment (`payment.services.ts:227`) ignores the grade list, so changing it never strands a line. |
| `prereg.services.ts`, `series.services.ts` (moves, spanning checks), `grade10.services.ts`, `verification.services.ts` (hold at deadline) | out of the reservation path; code kept. |
| `reminder.services.ts`, `payable-now.services.ts`, `message-audience.services.ts`, `home.services.ts` | `entry_deadline` reminders go; "payable now" = `mayPay`; `payOnProvisionalFee` reads (:158, :307, :75) → `prices_final`. |
| `statement.services.ts`, `session-money.services.ts` | deadline columns (:78, :218; :27) show the cut-off; board-fee reads go to the line snapshot. |
| `exception.services.ts`, `packages/validations/src/exception/policies.ts`, `registration/line.validations.ts` (:81–84) | the registry keeps `price.custom`, a later reserve date and a later pay date; removed settings leave the policy list and the line validations. |
| `import/view.ts`, `import/commit.ts`, `catalogue.services.ts` | parked; their `sessionWindow` calls (`import/commit.ts:534`, `import/view.ts:959`) move to `mayReserve`; they keep compiling against the backfilled columns (availability, fee keys); retired by name if they cannot. |
| authorisation | the coordinator gains the session, offering, price-list, teacher, question and preview routes (B1); `apps/api/test/authz-policy.tsv` gains a row per new route and loses the removed ones. |

### 9.3 Web (`apps/web/`)

| Screen | Change |
|---|---|
| `(sessions)/admin/sessions/sessions-list.client.tsx` | new-session dialog: type, year, start from. |
| `(sessions)/admin/sessions/[id]/session.client.tsx` + tabs | header (switch, dates, prices final); Check before you open; Subjects; Prices (replaces `fees-tab`); What families agree to; Reservations (read; the Money tab stays for finance). `grade10-tab`, `to-verify-tab`, "Correct the sitting" and the Deadlines line leave. |
| `subjects-tab.client.tsx` (1,187 lines) | replaced by the subject editor with the live preview from the preview endpoint. |
| `components/reservations/reserve.tsx` (586 lines) | rewritten for F1 (one page per child, one consent, questions); `deadlineOf`/`bySeries` (:221–252) and "Paid per entry deadline" (:376–380) go. Used by the family page and the desk. |
| `checkout/checkout.client.tsx` | one checkout: the per-series cards (:219–246) go. |
| `desk/desk.client.tsx`, `desk/desk-collect.client.tsx`, `family-next.client.tsx`, `components/reservations/statement.tsx`, `reservation-slip/[studentId]/slip.client.tsx` | "board fee provisional" → "prices not final yet"; deadline columns → the line's pay-by and cut-off. |
| `cycle-landing.client.tsx` | her Home: each session's check list and what families are doing; nothing she cannot act on. |
| `lib/reservation-focus.ts`, `components/nav-shell.tsx` | hidden for the coordinator and the admin: `/exams/catalogue`, `/exams/series`, `/exams/services`, `/admin/school-fees`, `/exams/deadlines`, `/exams/candidates`, `/exams/entries`, `/exams/entry-lists`, `/admin/subjects`; her Set up becomes Sessions (and Team for the admin). |

## 10. Money rules after the change

- **Unchanged**: payments, receipts, the balance and held wallet, reversals, refund approval and
  hand-over, charges and instalments, statements, the snapshot on the line, MO-11, MO-24.
- **Price**: §6; 09's "price = course + registration fee" (:99) and "price equals its basis"
  (:441, basis v2) hold.
- **Reserving and paying are separate checks** (§6): closing stops new lines, never payment of a
  waiting one.
- **The cut-off** (§6) replaces expiry at the close: the earlier of due + the session's days and the
  board deadline; an unfinished card or pay-at-school checkout ends first (escrow back), so no
  payment is left covering an expired line; an InstaPay checkout in its grace and a transfer under
  verification protect their lines (the latter until the earliest board deadline among them, where
  today's per-series step fails it and the late-transfer path takes over); lines with prices not final are skipped
  until their board deadline.
- **Confirming after the board deadline is refused** (as today); the transfer is credited to the
  balance through the late-transfer path. So a confirmed line was always paid before its deadline,
  and the refund's "sent" rule cannot keep an exam fee for an entry the school never made.
- **No split per deadline**: a checkout covers any waiting lines of the family; the desk takes one
  payment. A checkout whose lines have different cut-offs ends at the earliest one.
- **Board fee on a refund**: kept by "sent" = an exam-entry mark, else the line's board deadline;
  before it, the board part comes back, as today.
- **Prices not final**: lines can be reserved, not paid; switching final re-dates waiting lines.
- **A row's price, the course fee or the self-study share changed** (E7): unpaid lines with no
  payment history re-priced in one audited batch, families told; every other line listed for
  finance — today's re-price rule, keyed by row, with §9.2's lock order.

## 11. Migration and data

- **No real family data exists.** Dev and test databases are rebuilt; a backfill converts existing
  offers and items (availability → cells; fee keys → `exam_fee` from the confirmed grid row;
  provisional → `prices_final` false) so older dev data and the parked features' fixtures keep
  working.
- **Seeds**: the reference data (§7) and the June 2027 pre-load (§8) as idempotent seed scripts;
  the pre-load runs only when asked (`seed:june-2027`).
- **The free deployment** (Render database, expires 20 Nov 2026) holds the owner's trial data only;
  resetting it and loading the seeds is the owner's call at deploy time.
- Migrations are generated after main's journal at merge time (a migration stamped before the last
  applied one is skipped silently).

## 12. Tests

Gates: Gate 0 (evidence size, no phone numbers), Gate 1 (`pnpm --filter @repo/api check-types`,
tests included), Gate 2 (`pnpm --filter web check-types`), Gate 3 (`pnpm --filter @repo/api test`,
files in name order against Postgres 17.5).

- **Helpers first** (`apps/api/test/helpers.ts`): `session()`, `subject()`, `offer()`,
  `offerInSession`, `setSuiteFee`/`subjectFeeIn`, `feedSeries`, `placeItemsIn` move to the new
  routes (an offering with an all-papers row and its exam fee; prices final);
  `runPaymentDeadlines` runs the cut-off sweep. Files that use series and fees only through the
  helpers — 01, 02, 06, 07 — should pass once the helpers move.
- **Adapted**: 08b-state-and-time (expiry at the close and `reference_due_at` at the close → at the
  cut-off: :337, :443–504), 08c (its preregistration case, :371), 08g (`sessions/:id/series` and
  preregistration, :160, :276), 03-v3-flows, 08-money-rules (deadline-sweep cases → cut-off cases),
  08d, 08e (series correction leaves), 08f (settings list), 08j, 08r (policy keys), 08q (board
  services per series parked; instalments stay, cap at the cut-off), 08s-messages-reminders, 08t
  (re-price races by row, §9.2's lock order), 08o-reservation-lines.
- **Retired with the machinery** (one trail row each, their money outcomes re-stated in the new
  files): 08i-board-series, 08k-catalogue-races, 08l-board-change, 08m-checkout-per-series.
- **Rewritten**: 08n-session-offers, 08u-session-form, 08p-pricing-policies; 08n-import kept green
  on the backfill or retired by name.
- **New**: 08y-setup (reference rows, the grid, D8, generated labels in English and Arabic, copy
  with the year roll, per-subject close and reopen, duplicate teachers, her rights, impact routes
  and `IMPACT_CHANGED`); 08z-reserve-pay (`mayReserve` vs `mayPay` after a close, F2, teacher
  choice, allowed sittings and the carry-forward warning, grade list, questions, prices final, the
  cut-off with a checkout spanning two cut-offs, InstaPay at the cut-off, a transfer under
  verification, confirmation after the board deadline → balance, drops after the close, refunds
  before and after "sent"); 08za-price-lists (paste as printed, aliases, units sum, board rule,
  missing prices, re-price impact and its race).
- **09 invariants**: removed — 27 (one deadline per open payment); kept — 26 (expired at an
  entry deadline ⇒ past its effective deadline, now on reference dates); 43 loses its one-deadline clause and keeps "an instalment payment covers one plan's
  line"; reworded — 1 (no preregistration counts; checkouts after the close are legitimate), 13
  (an open payment never covers an expired line, any reason), 18 (the `cut_off` reason), 21 (series
  exist for rows that exist), 24 (no provisional line once prices are final), 25 (same row code
  once per sitting), 40 (import basis), 53 (a desk drop is after "sent"); added — every line's
  option was ticked on its row when reserved (or an exception says why), every `cut_off` expiry was
  past its cut-off and uncovered by a transfer under verification, an InstaPay checkout inside its
  grace or an instalment payment in progress, no line was confirmed after its
  board deadline, every line's basis matches its row's fees at reservation.
- **Parked features' files** (08h, 08s0–08s6, 08x1–08x4, 05's F1/F4 parts, 09b): kept green on the
  backfill; a test asserting removed behaviour is retired with a trail row naming it.
- **authz**: 04-authz-matrix against the updated TSV.

## 13. Build phases

One Opus 5.5 implementer per phase in its own worktree, an Opus 5.5 reviewer on the diff, the lead
drives the result headless as each role, the three gates green, then merge to main (CLAUDE.md).
The owner is the acceptance tester for the coordinator (H1). **An action** is one click on a
control that changes something or moves to another screen, or one field filled (typed or picked).

| Phase | What | Accepted when |
|---|---|---|
| **P0 Data** | `packages/db/reference/*.json` for the 25 subjects and 3 boards (rows, codes, aliases, rules, sittings 2026–2028 with board dates where known); the June 2027 pre-load as data (§8); a script printing every family label of the pre-load. | §8 reproduced row for row; the label print reviewed by the owner against the 25 forms; every "to check" listed. |
| **P1a Model and set-up** (alongside P0) | every schema change of §9.1 with the backfill (old `availability` and fee keys kept in step, so today's reservation path still runs); the reference loader; sessions, offerings, teachers, price lists, questions, impact routes and the preview of Appendix A; `offers-read` v2 (the family payload); `priceLine` v2 and re-pricing by row; the coordinator's rights; helpers; 08y-setup, 08za-price-lists, 08n/08u/08p rewritten. | gates green; reviewer's confirmation; Appendix A's set-up and read routes match (RPC types in the tests). |
| **P1b Reserving and paying** (after P1a) | `mayReserve`/`mayPay`, line rules v2, `insertLines`, the cut-off sweep, payments without the split, confirmation and capture at the board deadline, the desk's single payment, the close without expiry, drops after the close, refunds' "sent", plans and charges, eligibility's grade list, reminders and the other readers of §9.2, settings and policy keys removed, the old columns dropped; 08z-reserve-pay, the adapted and retired files and the 09 changes of §12. | gates green; reviewer's confirmation; the money files changed only where §12 says. |
| **P2 Coordinator screens** (after P1a; the mock may start earlier) | the mock first (H2), then §5's coordinator screens and §9.3's hiding; owns `nav-shell.tsx`, `reservation-focus.ts` and a new `lib/i18n-setup.ts`. | the owner, as the coordinator: reviews the pre-loaded June 2027 in ≤ 40 actions; builds Arabic O.L., Biology A.S./A.L. and Physics A.S./A.L. from scratch in ≤ 10 actions each; makes June 2028 by copying in ≤ 30; none of these words on her screens: award, suite, series, sitting, component, mapping, option code; every closed-list input is a select; axe and console clean. |
| **P3 Family and desk** (after P1b, alongside P2) | `reserve.tsx` v2, single checkout, the desk on the same page, questions, Arabic, phones; owns `lib/i18n-reservations.ts` and the §9.3 family and desk files. | a first-timer and a retaker reserve and pay; the desk reserves and collects; a parent with two children reserves 10 subjects in ≤ 30 actions; no jargon; axe and console clean. |
| **P4 Hand-over** | the pre-load seeded on a clean copy; a new short admin guide replacing `docs/admin-guide` (its step count is the score); a UI pass on every changed screen; the owner's acceptance; deployment when the owner says (database reset). | the guide: ≤ 40 steps reviewing June 2027, ≤ 30 making June 2028; the owner signs off. |

## 14. Risks and what to check later

- **Money**: the cut-off sweep, InstaPay at the cut-off and re-pricing by row replace proven code;
  each has a scenario in 08z/08za and the 09 changes; the reviewer probes lock order as in every
  earlier round.
- **Parked features**: the exam entries and scheduling read items, series and offer teachers; the
  backfill keeps their fixtures; anything that cannot stay green is retired by name, not silently.
- **Reference data**: codes and board dates we could not confirm are listed (§7); a wrong code
  shows in a family label, not in a price, and is corrected by us without her doing anything. Board
  dates now cap the cut-off and refuse late confirmations (C6), so each is checked against the
  board's published key dates before a session using it opens; a sitting without a date has no cap
  (her own dates still apply), and with exam entries parked its board fee is never "sent" — it stays
  refundable on a drop until we load the date. Every sitting a session uses needs its date before
  the session opens (the check list says so).
- **Her defaults** (§3): all are ticks, shares, switches or names she can change; none needs a
  rebuild if she disagrees.
- **Timing**: June 2027 is being collected on her Google Forms now (12 forms open on 26 Oct), so the
  first real cycle on the system is a later one; the free database expires on 20 Nov 2026.

## Appendix A. The API contract (P1 builds it; P2 and P3 build on it)

All through the Hono RPC client (CLAUDE.md); envelopes by `success()` / `error()`; roles as B1–B3.
Money amounts are EGP numbers; a fee not set is `null`.

**Set-up** (coordinator, admin; finance roles read)

| Route | Body / answer |
|---|---|
| `GET /v1/reference/boards`, `GET /v1/reference/subjects?board=` | boards with their sittings and rules; subjects with code, name, group, suggested rows |
| `GET /v1/sessions` · `POST /v1/sessions` | `{ type: 'june' \| 'winter', year, copyFromSessionId? }` → the session (name derived) |
| `GET /v1/sessions/:id` | header, settings, the check list, counts |
| `PUT /v1/sessions/:id` | `{ closesAt?, paymentDueAt, courseStartsOn, selfStudyPercent, allowedGrades, unpaidCancelDays, refundPolicy?, questions?, expected? }` — a share change answers its impact first (below) |
| `POST /v1/sessions/:id/open` · `/close` · `/reopen` | — |
| `PUT /v1/sessions/:id/prices-final` | `{ final: true, expected? }` — one-way once any line exists; the impact counts the due dates moved |
| `POST /v1/sessions/:id/offerings` | `{ referenceCode } \| { custom: { board, name, level, group, code? } } \| { copyFromOfferingId }` → the offering with its suggested rows |
| `GET /v1/sessions/:id/offerings/:offeringId` | the offering, rows, teachers, questions |
| `PUT /v1/sessions/:id/offerings/:offeringId` | `{ note, teacherChoice, teacherTbc, accepting, closesAt, courseFee, teachers: [{ teacherId \| newName, online, external }], rows: [{ id?, kind, referenceCodes, sitting, closesAt, payBy, examFee, examFeeSource, courseFee, selfStudyFee, cells: { firstInSchool, retakeInSchool, retakeSelfStudy, firstSelfStudy }, allowedPriorSittings, teachers }], questions, expected? }` |
| `DELETE /v1/sessions/:id/offerings/:offeringId` | refused while lines exist (close it instead) |
| `GET /v1/teachers?search=` · `POST /v1/teachers` | `{ name, kind }` → the teacher, or `{ duplicates: [...] }` to confirm against |
| `POST /v1/sessions/:id/price-lists/parse` | `{ board, text }` → rows matched and unmatched (writes nothing) |
| `POST /v1/sessions/:id/price-lists` | `{ board, name, rows, expected? }` → applied, unpaid lines re-priced |
| `GET /v1/sessions/:id/prices` | every row's exam fee and source; the missing-prices list |
| `PUT /v1/sessions/:id/rows/:rowId/exam-fee` | `{ amount } \| { source: 'units_sum' \| 'board_rule' }`, `expected?` |
| `GET /v1/sessions/:id/preview?as=first_timer\|retaker&offeringId=` | the family payload below, for the live preview |
| `GET /v1/sessions/:id/reservations` (+ `?format=csv`) | who reserved what, paid or not, answers to the questions |

**Impact**: a route that changes prices, closes or removes something first answers
`{ impact: { repriced, listedForFinance, linesAffected, dueDatesMoved } }` without writing; the client sends the
same counts back as `expected`; a mismatch answers 409 `IMPACT_CHANGED`.

**Families and the desk**

| Route | Body / answer |
|---|---|
| `GET /v1/registrations/offers?studentId=&sessionId=` | `{ session: { name, closesAt, paymentDueAt, pricesFinal, refundSentence, declaration, questions }, eligibility, offerings: [{ id, name, board, group, note, teacherChoice, teacherTbc, accepting, questions, rows: [{ id, label, kind, sitting, closed, payBy, exclusiveGroup, knownSitting?, options: [{ attempt, mode, label, price: { total, examFee, courseFee } \| null, needsCarriedFrom, allowedSittings: [{ id, label }], teachers: [{ id, name, online }] }] }] }] }` |
| `POST /v1/registrations/direct` · `/request` · `/desk` | `{ studentId, sessionId, lines: [{ rowId, attempt, mode, teacherId?, carriedFromSittingId?, expectedPrice }], answers, consent: { refundPolicy: true, declaration: true } }` |
| checkout, payments, receipts, statement, drops | as today, without `deadlineGroups`; the checkout summary shows each line's cut-off; a drop after the close until "sent" |

**Policy keys kept** (G4): `price.custom`, `deadline.reserve` (a later reserve date),
`deadline.payment` (a later pay date). **Refusal codes**: `NOT_ACCEPTING`, `PRICE_NOT_SET`,
`PRICES_NOT_FINAL` (payment), `CUT_OFF_PASSED`, `BOARD_DEADLINE_PASSED`, `PRICE_CHANGED` (as today), `IMPACT_CHANGED`.
