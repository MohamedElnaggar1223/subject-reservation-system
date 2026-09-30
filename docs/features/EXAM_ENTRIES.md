# F4 — Exam-entry management (as built)

Branch `feature/exam-entries`, started from `origin/main` e5da650 (F0a and F0b merged). The plan
is FEATURES_PLAN.md §1 "F4 — Exam-entry management", its §2 row and §5's rules; the design basis
is DISCOVERY_RESEARCH.md §2 (what a centre must do, per board) and §5 (notes 2, 4, 5, 6),
DISCOVERY.md (Q-02 carry forward, Q-05 identifiers, F-07 the boards' files, A-08 the hard stop)
and IMPORT_SPIKE.md. It builds on F0b's catalogue and board series (docs/features/CATALOGUE.md,
§7: `entryItemsFor`, `teacherOf`, `registration.boardSeriesId`) and F0a's settings store,
uploads, rooms and roles (docs/features/FOUNDATION.md). The trail is `.audit/exam-entries.tsv`;
evidence (suite logs, control logs, screenshots) is `.audit/exams-evidence/` (git-ignored). The
progress log is the last section.

F4 makes the school an exam centre in the system: **who the boards' candidates are** (the name as
on the ID, date of birth, gender, Pearson's permanent UCI, a candidate number per series with
its history, and a national ID only the coordinator and admin can read); **what each candidate is
entered for** (per unit or award, derived from confirmed registrations, with option codes, tiers,
retakes, carry forward, forecast grades and access arrangements); **the boards' lists** (one row
per entry in each portal's fields, and a check of everything the board would refuse); **the exam
timetable and exam days** (papers, each candidate's timetable, clashes, rooms, seats,
invigilators, the boards' attendance registers, special consideration, the statement of entry);
**results** (a board's file read through a column mapping, every attempt kept, publication to
families); **certificates** (received, collected once, unclaimed ones kept for the retention
period); and **a deadlines dashboard** across every series. Nothing here takes or moves family
money.

---

## 1. Data model

Migrations `0041_exam_entries.sql` (structure, generated) and `0042_exam_entries_board_rules.sql`
(custom: each board's rules seeded from the research). All tables in `packages/db/src/schema.ts`,
section "F4".

| Table | What it holds | Rules |
|---|---|---|
| `exam_board_rule` | per board: forecast required / fixed once sent; option code required; UCI required; candidate number fixed once entries are sent; amendments after the deadline (allowed with a fee, or refused) and from which date they cost a fee; up to which date a withdrawal is refunded; carry-forward months; what the results file keys on (candidate number or UCI); notes | seeded for Cambridge, Pearson Edexcel, OxfordAQA (0042); the coordinator and admin edit it (audited); a board with no row reads lenient defaults and says so |
| `exam_candidate` | per student: legal forenames and surname (as on the ID), date of birth, gender, UCI, approved access arrangements with the board's reference and expiry, notes | UCI unique and 13 characters of Pearson's shape (a check); a recorded UCI changes only with a reason (`CANDIDATE_UCI_CORRECTED`) |
| `exam_candidate_identity` | per student: national ID or passport, its number, who recorded it | **its own table**, read by one function; unique per (type, number); never in a list, a log or an audit row |
| `exam_candidate_number` | per student and board series: the four-digit number, the centre it was issued under, how it came (assigned, manual, import) | unique per (student, series) and per (series, number); fixed once an entry in the series has gone to a board that fixes numbers |
| `exam_entry` | one unit or award per candidate per series: board, registration (null for a cash-in added by hand), kind, unit or qualification, the code and title as entered, option code, tier, status (`draft`, `submitted`, `amended`, `withdrawn`), retake and why, carry forward (`none`, `suggested`, `confirmed`) with the source month and year, previous centre, previous candidate number and option type, forecast grade with who and when and when it was sent, access arrangements (null: the candidate's), the board's fee tier when sent, sent / amended / withdrawn with who, when, why, and the board's fee sentence | one live entry per (candidate, series, unit) and per (candidate, series, award) (partial unique indexes); a unit entry has a unit, an award entry an award (a check); a sent entry has its time; a withdrawn one its time |
| `exam_series_state` | per board series: when its timetable, forecasts and results went out (and the timetable's version) | |
| `exam_paper` | a series' timetable: code, title, the unit (component) it belongs to or an award with a tier, date, session (am, pm, ev), start, duration | unique per (series, code); times and durations checked |
| `exam_clash_note` | how a candidate's clash between two papers is handled | the pair ordered, unique per candidate |
| `exam_room_sitting` | a room used in a sitting (a date and session) with its seat grid (rows A–Z, seats 1–40) | unique per (date, session, room) |
| `exam_seat` | a candidate's seat in a sitting | **unique per (date, session, room, seat) and per (date, session, candidate)**: no seat double-booked, no candidate seated twice |
| `exam_invigilation` | a teacher in a room in a sitting, lead or not | one room per teacher per sitting (unique) |
| `exam_attendance` | the board's register as marked: per paper and candidate, present / absent / late (minutes), note, who | unique per (paper, candidate) |
| `exam_special_consideration` | per candidate and series (and paper): category, description, evidence (an upload, RESTRICT), status (draft, submitted, outcome received), board reference, outcome | |
| `exam_result_import` | one read of a results file: series, file, mapping, counts | |
| `exam_result` | a result as the board reported it: candidate, series, kind (unit or award), code, the matched unit or award and entry, grade, mark, source, import, provisional or published | **every attempt a row, and a board's later report of the same attempt another row beside it**: nothing is overwritten (RF-09) |
| `exam_result_mapping` | a saved column mapping per board, by name | unique per (board, name) |
| `exam_certificate` | per candidate and series: what it lists, received on, collected (when, by which member of staff, the collector's name and relation, the ID seen, the scanned signed slip), returned to the board or destroyed with a reason | one per (candidate, series); collected only once (a status-guarded update); the states' fields whole (checks) |
| `exam_deadline_reminder` | a reminder sent: series, date field, the date, days before | the primary key is the claim (ST-06, ST-12) |

**Settings** (F0a's store, `packages/validations/src/settings/settings.ts`), each editable by the
admin and the coordinator, audited:

| Key | Default | Stands for |
|---|---|---|
| `exams.centres` | none | the centre number with each board and the entry route, direct or through the British Council (Q-05) |
| `exams.carryForward` | `suggest` | whether an A Level entry after the candidate's AS of the same syllabus within the board's period is suggested as carry forward (Q-02: the coordinator's answer changes this, not code) |
| `exams.selfStudyForecast` | `coordinator` | who gives a self-study candidate's forecast grade, or that none is asked for (IS-03) |
| `exams.certificateRetentionMonths` | 12 | how long an unclaimed certificate is kept (Cambridge: at least 12 months) |
| `exams.candidatesPerInvigilator` | 30 | one invigilator per this many candidates in a room |
| `exams.reminderDaysBefore` | 14 | when staff are reminded of a board date the school acts by (and again the day before) |

## 2. Entries

**Derived per component from confirmed registrations** (`deriveEntries`, preview then commit), by
F0b's `entryItemsFor` and the award's entry method:

| The registration enters… | Entries made |
|---|---|
| a Cambridge syllabus (`syllabus_option`), whole | the award, with its option code when the syllabus has exactly one (else the coordinator chooses; the check flags it) and the tier the option's components share |
| a Cambridge syllabus's components (a paper set) | the award, with the option that enters exactly those components (else flagged) |
| Pearson units (a unit, a paper set) | one unit entry per W unit |
| a whole Pearson award (`units_cash_in`) | its required units and the cash-in; a choice group ("one of M1, S1, D1") is named for the coordinator to add |
| an International GCSE (`qualification`) | the award, with its option code if it has one |
| a subject not mapped on the Catalogue | nothing — the preview says so and the entry list lists the registration as unentered |

Retakes are flagged from the registration (`isRetake`) or from history (an earlier entry or
result for the same unit or award). Carry forward is suggested (setting) for an A Level award
after an AS entry of the same syllabus code within the board's months, with the source series,
the previous centre and candidate number, and the board's carry-forward option code where the
syllabus has exactly one; the coordinator confirms it (`carry_forward_to_confirm` until then).
Two commits at once run one after the other (an advisory lock per series) and the partial unique
indexes keep one live entry per unit or award (08x3). The coordinator can add an entry by hand (a
cash-in with no unit sat this series, the unit of a choice group).

**Statuses.** A draft changes freely. "Mark as sent" records the time the entries went to the
board (default now; an earlier time can be given) and the board's fee tier that day. A change to
what the board sees on a sent entry (option, tier, retake, carry forward) is an **amendment**: it
needs a reason; after the deadline the board's rule says whether it is taken
(`amendmentAfterDeadline`) and the answer carries the fee sentence; the entry becomes `amended`.
A **withdrawal** is allowed at any time; its answer and row carry what the board does with its
fee (a draft: nothing to pay; a sent entry: refunded up to the rule's date — the entry deadline as
an instant, or the late or high-late date — else kept). The family is told when an entry that had
gone to the board is withdrawn.

**MO-10's hard stop is unchanged.** After a series' entry deadline no entry is made (derived or by
hand) and no draft is marked as sent at a time after it (`hardStopSentence`); the series row is
read `FOR SHARE` in the same transaction, so a deadline change and a derivation run one after the
other. 09 checks over every row that no entry was made or sent after its series' deadline.

**Forecast grades** (Cambridge requires them). Given by the teacher `teacherOf(student, subject,
the series' academic year)` names — F0b's contract — or by the coordinator or admin; any other
teacher is refused (403, 05). A teacher's list holds only their own candidates. "Mark forecasts as
sent" fixes them where the board says so (Cambridge: a change after is refused). A self-study
candidate's forecast is the coordinator's or not asked for (setting).

## 3. The entry list and its check

`GET /v1/exams/entry-lists?boardSeriesId=`: one row per live entry with the **board portal's
fields in the portal's order**, what each row is missing, and the confirmed registrations with no
entry. The boards' own files are not in hand (DISCOVERY.md F-07), so **every column is marked
assumed** (`ENTRY_LIST_COLUMNS`, `packages/validations/src/exams/exam-entry.validations.ts`) until
the coordinator checks it against the board's template:

| Board | Columns (assumed) |
|---|---|
| Cambridge International (Direct entries) | Centre number · Candidate number · Candidate name (as on ID, SURNAME, Forenames) · Date of birth (DD/MM/YYYY) · Gender (M/F) · UCI (optional) · Syllabus code · Option code · Tier · Retake (Y/N) · Previous centre number · Previous candidate number · Carried forward from (series) · Forecast grade · Access arrangements |
| Pearson Edexcel (Edexcel Online / EDI basedata) and any other board | Centre number · Candidate number · UCI · Surname · Forenames · Date of birth · Sex (M/F) · Entry code (unit, cash-in or qualification) · Option · Tier (F/H) · Resit (Y/N) · Series · Estimated grade · Access arrangements |

The check flags, per entry: no centre number for the board (Settings); no candidate number in the
series; no legal name; no date of birth; no gender; no UCI where the board requires one; no option
code where the board requires one; no tier on a tiered syllabus; no forecast grade where the board
requires one; carry forward incomplete or still to confirm; the registration no longer confirmed;
access arrangements without a board approval or expired. The screen downloads the rows as CSV
(formula-safe, `lib/csv.ts`).

## 4. The timetable and exam days

- **Papers** are pasted from the board's timetable as a table (tab- or comma-separated, the first
  line the headings): the columns are guessed from the headings and can be chosen; dates are read
  as 2026-10-12, 12/10/2026, "12 October 2026" or an Excel date; times as 09:00, 9.00 or 1:30 pm;
  durations as 90, 1:30, "1h 30m" or "2 hours". The preview says per line new, changed, unchanged
  or what is wrong, and which catalogue unit or award it belongs to (by code; Pearson's
  "WMA11/01" is unit WMA11). Keyed by paper code, a second paste changes nothing and a corrected
  one changes only what moved. Papers can be entered and changed one by one.
- **Which papers an entry sits:** a unit entry its unit's papers; an award entry the components
  its option code enters (else the award's required components of its tier), or the award's own
  papers when the board lists the syllabus only; a Pearson cash-in none.
- **A candidate's timetable** counts their extra time (25% or 50%) in each end time. **A clash** is
  two papers of one candidate overlapping on a day — across boards and series (a Cambridge paper
  and a Pearson paper the same morning) — and the coordinator notes how it is handled.
- **Publication** shows each candidate their statement of entry and timetable and tells them and
  their parents (first time "ready", after that "changed"); a paper moved after publication tells
  its candidates' families.
- **A sitting** is a date and session across every board. Its rooms (F0a's rooms) get a seat grid;
  "seat everyone" places the candidates without a seat, candidates of one paper together in
  candidate-number order, row by row; a seat can be changed; the database refuses a double-booked
  seat. A room holding candidates cannot leave the sitting or shrink under them.
- **Invigilators** (teacher records): one room per sitting each; the screen shows the invigilators
  a room needs (the setting). A teacher sees their own duties and keeps the register of their own
  room only.
- **The boards' attendance registers**: per paper (and room), candidate number, name as on the ID,
  seat, access arrangements; marked present, absent or late (minutes); printable.
- **Special consideration**: per candidate and series (and paper), with evidence (a supporting
  document uploaded for that student), sent to the board with its reference, outcome recorded.

## 5. Results and certificates

- **Results import with a mapping** (the boards' files are unconfirmed, F-07): the file is uploaded
  as an import file (F0a uploads; .xlsx or .csv) or pasted. The mapping says the shape — **long**
  (a row per result: Pearson's results file) or **wide** (a row per candidate, a column per
  syllabus: Cambridge's broadsheet) — the header row (broadsheets carry a title block), the column
  naming the candidate and whether it holds the candidate number in the series or the UCI, and the
  code, grade and mark columns (long) or the result columns (wide, whose headings start with the
  code). Without one, the board's saved mapping is used, else a guess from the headings. The
  preview says per line: new, unchanged (the same file again), a revision (the board reported
  another grade for the same attempt), an unknown candidate or an unknown code. The commit is one
  at a time per series and idempotent; it can save the mapping under a name.
- **Every attempt is kept**: a unit sat in June and again in January is two rows, and a revised
  report is a third beside the first. **Which grade is of record after a remark is the owner's
  open question (RF-09)**: nothing here decides it.
- **Publication** makes a series' results visible to families (and tells them), and gives each
  registration with no grade yet the board's grade (its award's, or its only unit's, the latest
  report), so the existing results screen and the remark flow read it. A registration that already
  has a grade keeps it; the answer lists them.
- **Certificates** are received for a series (by default every candidate with a published result),
  families are told to collect; handed over once at the desk with the collector's name, relation
  and the ID seen, and a printed slip to sign (its scan can be attached); a second hand-over is
  told who took it. Unclaimed past the retention period, one is destroyed with a reason; returned to
  the board at any time with a reason.

## 6. Roles and endpoints

Every endpoint is in `apps/api/test/authz-policy.tsv` for all nine principals (04 probes each);
`lib/role-grants.ts` grants the coordinator `* /v1/exams/*` and the teacher the five endpoints
below; the gate reaches nothing here.

| Endpoints (under `/v1/exams`) | Principals |
|---|---|
| `candidates…`, `candidate-numbers…`, `board-rules…`, `entries` (list, add, derive, submit, change, withdraw), `forecasts/submit`, `entry-lists`, `papers…`, `clashes`, `timetable/publish`, `sittings…`, `seats`, `invigilation` (set), `special-consideration…`, `results…`, `certificates/receive`, `certificates/:id/dispose`, `deadlines` | admin, coordinator |
| `candidates/:studentId/identity` (GET, PUT) — the national ID | admin, coordinator; each read audited (`CANDIDATE_IDENTITY_VIEWED`, without the number) |
| `entries/:id/forecast`, `forecasts`, `invigilation/mine`, `registers` (GET, PUT) | staff; the handler allows a teacher only their own candidates (`teacherOf`) and the room they invigilate |
| `students/:studentId/series`, `/timetable`, `/statement`, `/exams`, `/results`, `/sittings` | the student themself, a linked parent (published only), and staff with student records (desk, coordinator, admin); another family's child is "not found" |
| `certificates`, `certificates/:id/collect`, `certificates/:id/slip` | desk (finance officer, finance admin), coordinator, admin |

**The national ID.** Its own table; set and read through two endpoints for the coordinator and the
admin; each read audited without the number; lists, the candidate's page and entry lists carry
only whether one is recorded (and its last four characters on the candidate's page); the audit
row of a change says only that it changed; writing it catches the driver's error itself (a failed
query's message carries its parameters and would reach the console) — 08x1 spies the console
through a duplicate and 09 checks that no audit row holds any recorded number.

## 7. Contracts for later features

| For | Contract | Where |
|---|---|---|
| **F2** (campus leave), **F3** (attendance) | `getExamsFor(studentId, date)` — the papers a student sits on a school date (YYYY-MM-DD, Cairo), across every board and series: `{ paperId, code, title, entryId, boardSeriesId, seriesName, date, session, startTime, endTime, durationMinutes, extraMinutes, room, seat }[]`, end times counting the candidate's extra time; withdrawn entries left out (a family view: only entries gone to the board). F3 excuses the lessons these overlap; F2 warns a leave request. Also `GET /v1/exams/students/:studentId/exams?date=` | `exam-timetable.services.ts` |
| **F5** (pathway advisor) | `getSittings(studentId)` — every sitting recorded here, per series and unit or award: `{ boardSeriesId, series: { month, year, label, name, sitting, academicYearStart, academicYear }, boardCode, boardName, kind, code, title, subjectArea, level (an award's igcse / as_level / a_level, or a unit's own igcse / as / a2), tier, entryId, entryStatus, isRetake, grade and mark (the board's latest report), reports[] (every report, latest first), remarks[] (the remark requests on its registration with each paper's outcome), gradeOfRecord: null }`. **`gradeOfRecord` is always null** until the owner answers RF-09; entries without results yet are included (`grade` null). Also `GET /v1/exams/students/:studentId/sittings` | `exam-result.services.ts` |
| F2, F3, F5 | the candidates, entries and results tables above | schema |

## 8. Screens

(Written as each is built and driven; see the progress log.)

## 9. Tests

`08x1-exam-entries`, `08x2-exam-days-results`, `08x3-exam-races` (with `exam-helpers.ts`: a
school of every role, a catalogue per suite tag, an open window on the one free pair, families
registered at the desk), cases in `05` and rules in `09`.

| Scenario (FEATURES_PLAN §1 F4) | Test |
|---|---|
| entries derived from registrations per component | 08x1 "a preview says what each registration enters; the commit makes each entry once", "a Cambridge syllabus is entered as the award…" |
| an entry list flagging a missing forecast grade | 08x1 "flags a missing forecast grade (Cambridge requires one) and every other gap; the teacher of the subject fills it" |
| a new entry after the deadline refused (MO-10) while a withdrawal after it is allowed with the board's fee shown | 08x1 "past the deadline a new entry is refused, and a draft cannot be sent; a withdrawal is allowed with the board's fee shown", "an amendment after the deadline follows the board's rules…", "Pearson refunds a withdrawn entry up to its high-late date…" |
| an exam clash flagged | 08x2 "each candidate's own timetable, extra time counted; a clash across boards flagged…" |
| a seating plan without double-booked seats | 08x2 "a sitting is seated room by room…; no seat holds two candidates"; 08x3 "two coordinators put two candidates in the same free seat at once" |
| a results import with a mapping, keeping two attempts | 08x2 "a results file read through a mapping; every attempt kept…", "Cambridge's broadsheet (Excel…)" |
| a certificate collected once (a race test) | 08x3 "a certificate collected at two desks at once"; 08x2 "collected once at the desk…" |
| national IDs hidden from roles without the need | 08x1 "national IDs … read only by the coordinator and the admin…"; 05; 09 |

Races (08x3): two derivations, two numberings, a withdrawal against an amendment, one seat for two
candidates, two results imports, a certificate at two desks, two scheduler instances, a failed
reminder retried. 05: another family (every student-scoped endpoint "not found", staff endpoints
refused), another class (a teacher refused another teacher's candidate's forecast and another
room's register), the gate (nothing). 09: no entry made or sent after its series' deadline; an
entry is its registration's student's in its series, a result its entry's; one withdrawal and one
hand-over audit row each; no seat double-booked, no candidate seated twice, no invigilator in two
rooms; no national ID in an audit row.

**Negative controls** (`.audit/exams-evidence/controls.py`; one trail row each; logs in
`.audit/exams-evidence/controls/`): each guard undone once, its tests red, restored.

| Control | Undone | Red |
|---|---|---|
| C1 | the hard stop on making an entry (derived and by hand) | 08x1; 09's MO-10 rule |
| C2 | the hard stop on sending a draft | 08x1 |
| C3 | the national ID read opened to all staff (route and service) | 08x1 |
| C4 | the national ID write lets the driver's error (with the number) through | 08x1 |
| C5 | the forecast's `teacherOf` check | 08x1, 05 |
| C6 | the entry list's missing-forecast flag | 08x1 |
| C7 | clash detection | 08x2 |
| C8 | the database's one-candidate-per-seat index (0041) | 08x2, 08x3 |
| C9 | the certificate hand-over's status guard | 08x3 (the race), 08x2 |
| C10 | results: a line compared with the latest report | 08x2 |
| C11 | derivation's advisory lock and conflict guard | 08x3 |
| C12 | numbering's advisory lock | 08x3 |
| C13 | an entry's row lock (withdraw against amend) | 08x3 |
| C14 | a reminder's notices sent before its claim, outside the transaction | 08x3 |
| C15 | a parent's link to the child (family endpoints) | 05 |
| C16 | a teacher's register limited to the room they invigilate | 08x2, 05 |

## 10. Decisions and why

- **Board rules are data** (`exam_board_rule`), seeded from the research with what is not in it
  marked "assumed": the coordinator's answers and the boards' handbooks change rows, not code
  (owner decision 3).
- **The national ID has its own table** so no `select *` of candidates can carry it, and one
  function reads it.
- **The hard stop covers sending as well as making**: a draft marked as sent after the deadline is
  a late entry at the board. The time it went can be given, so a school that sent on time and
  recorded late is not refused.
- **Withdrawal fees are sentences, not money**: the board's fee is between the school and the
  board; what the family is refunded stays the drop and refund flows' (IS-08, MONEY_AUDIT).
- **Results are never overwritten** (RF-09): a revised report is a new row; publication fills a
  registration's grade only where none is recorded.
- **A sitting spans boards**: rooms, seats and invigilators belong to a date and session, because a
  Cambridge and a Pearson paper the same morning share the hall.
- **The .xlsx reader is the import spike's, hardened** (a size cap on each inflated part, part,
  row and cell limits) rather than a new dependency: F1 and F7 share the lockfile in parallel.
- **Deadline reminders claim and send in one transaction** per reminder, so a failure leaves no
  claim and the next tick retries; one series' failure does not stop the others.

## 11. Deferred, and why

(Kept current as the work goes; see §13.)

## 12. Questions for the owner (through the coordinator)

1. The centre numbers with each board, and whether the school enters directly or through the
   British Council (Q-05) — the `exams.centres` setting.
2. Carry forward (Q-02): are the A2 rows' notes Cambridge carry-forward entries? The setting
   `exams.carryForward` suggests them today.
3. Forecast grades for self-study candidates (IS-03): the coordinator's, or none?
4. Each board's portal template, results file and broadsheet (F-07): the entry-list columns and
   the results mappings are assumed until checked.
5. Cambridge's rule for an entry withdrawn after the deadline (assumed: the fee is kept), and
   OxfordAQA's rules (not researched).
6. Which grade is of record after a remark (RF-09): results keep every report; nothing decides.

## 13. Progress log

- 2026-09-30 02:44Z — started on `feature/exam-entries` from origin/main e5da650; read the plan
  and the read-first documents; dev database `igcse_exams_dev` from the template.
- 03:21Z — schema (0041, 0042), validations, services, routes, authz rows (c2039ea); 08x1
  (1c45e1c); baseline suite green at c2039ea (22 files, 308 passed).
- 03:38Z — 08x2, 08x3, 05 and 09 (a53e161, 079a955, 5eb605c); gates green at 5eb605c (25 files,
  350 passed, 1 todo; local time and UTC); branch pushed.
- 03:40Z — running system on API 3043 (3041 is held by another project's server) and web 3040;
  demo data through the API (`apps/api/scripts/exams-demo/seed-exams.ts`).
- 03:55Z — web foundation (a2c1151): exam pages guard their own roles; shared fetchers; nav for
  staff, the desk, teachers and families; Arabic plumbing; Settings shows the exam settings (and
  F0b's catalogue setting, which had no group on the screen).
