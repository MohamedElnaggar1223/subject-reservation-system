# F0b — Exam catalogue, board series and course enrolment (as built)

Branch `feature/catalogue`, started from `origin/feature/foundation` 1e8f871 (F0a) and merged
with `origin/main` at b747d47 once F0a landed. The plan is FEATURES_PLAN.md §1 "F0b", its §2
row and §5's rules; the design basis is DISCOVERY_RESEARCH.md §5 (notes 1–4, 7) and
IMPORT_SPIKE.md IS-01, IS-05, IS-14. The trail is `.audit/catalogue.tsv`; evidence (suite
logs, control logs, migration counts, screenshots) is `.audit/catalogue-evidence/`
(git-ignored). The progress log is the last section.

F0b gives the school three things its sheet cannot hold: **what each registrable row enters
with the board** (a whole award, or units and papers with their own level, so "A.S./A.2." is
worked out rather than typed), **the boards' own sittings** (a window now feeds one or more
board series, each with its own dates and its own entry deadline — MO-10 per series), and
**what each student is taught this year** (course enrolment: subject, teacher, in school or
self-study), checked against the exam registrations without blocking them.

---

## 1. Data model

All in `packages/db/src/schema.ts`; migrations 0037 (structure), 0038 (backfill, functions,
triggers; custom), 0039 (the window's deadline column dropped, `subject.council` a foreign key).

| Table | What it holds | Rules |
|---|---|---|
| `exam_board` | code (= `subject.council`: `pearson_edexcel`, `cambridge`, `oxford`), name, short name, entry portal, the months it sits (`series_months`), notes | seeded by 0038; the coordinator edits names and months (a month with series on record stays) |
| `qualification` | an award: Pearson X/Y cash-in, a Cambridge syllabus, an International GCSE; board, code, title, level (`igcse`/`as_level`/`a_level`), suite, subject area, entry method (`qualification`, `units_cash_in`, `syllabus_option`), active | unique per (board, code, level) — Cambridge 9700 is one code at AS and A Level |
| `exam_unit` | a unit or component (paper): board, code (WMA11, 9700/41), short code (P1), title, **its own level** (`igcse`, `as`, `a2`), kind (`unit`/`component`) | unique per (board, code) |
| `qualification_unit` | the unit-to-award map: which units count toward which award, required or optional, a choice group ("Applied: one of M1, S1, D1") | same board; an A2 unit never counts toward an AS award; IGCSE components only on IGCSE awards |
| `qualification_option` / `qualification_option_unit` | Cambridge option codes: which components an option enters, whether it carries marks forward | the components must be on the award |
| `subject.qualification_id`, `subject_unit` | what a **registrable row** enters: a whole award, or a set of units (P1; M1; Biology "Paper 3 & Paper 4") | same board as the row; an AS row enters AS units only; an A Level row may mix AS and A2 |
| `board_series` | a board's sitting: board, month, year, optional label (a board with two calendars in one month); **entry deadline** (instant, the MO-10 hard stop) and the board's other dates as calendar dates for information: estimated entries, late fee, high late fee, late entries close, retake deadline, forecast grades, NEA, access arrangements, exams start and end, results, certificates; notes | unique per (board, month, year, label); the month must be one the board sits; its board is fixed once a window feeds it |
| `session_board_series` | the series a window feeds; one **default per board** (partial unique index) | same academic year and the same kind (June or not) as the window; an IGCSE window feeds no January or October series; the window closes before each fed series' deadline |
| `session_subject_series` | a subject routed to another series of its board than the default (IAL Biology to January while Mathematics stays in October) | the target must be fed by the window (composite FK, cascade) |
| `registration.board_series_id` | the series each registration is entered in | composite FK to (window, series): a registration's series is one its window feeds; set by the routing on insert |
| `course_enrolment` | per academic year: student, registrable row, teacher, mode (`in_school`/`self_study`), source (`manual`, `carried_forward`, `registrations`, `section`, `import`) and its reference, started, ended with a reason | one **open** enrolment per (student, subject, year) (partial unique index); self-study has no teacher (check) |

**Database rules** (0038, PL/pgSQL, each raising `check_violation` with a named constraint the
API turns into a sentence, `seriesRuleSentence`):
- `catalogue_window_series_check` on `session_board_series`: `window_series_same_academic_year`,
  `window_series_same_kind`, `window_closes_before_series_deadline`.
- `registration_session_series_check` on a window's end, type or year; `board_series_window_check`
  on a series' deadline, month, year or board (`board_series_board_fixed`): the same three rules
  from the other side, so a window and a deadline changed at the same moment never leave the
  window open past the deadline.
- `registration_route_board_series` (insert) and `registration_move_board_series` (a move):
  a registration is entered in the window's series for its subject (the subject's route, else
  its board's default) and a moved one stays within its subject's board
  (`registration_board_series_routed`, `registration_board_series_board`).

`registration_session.entry_deadline` and its check are gone (0039); the deadline lives on each
series. `subject.council` references `exam_board.code`.

## 2. What existed, migrated (0038)

- The three boards are seeded with their months (Pearson Edexcel January, June, October,
  November; Cambridge June, November; OxfordAQA January, June, November) and entry portals.
- Every **IGCSE subject** becomes a whole qualification of its board with its own code and
  title, and is linked to it (17 of 17 on both dev copies: Cambridge syllabus codes 0452…0625).
- **AS and A Level subjects are left unmapped**: they may be whole awards, single units or
  paper sets (IS-01), which the coordinator knows and the data does not. Registration works
  either way; the Catalogue screen lists them as "to map" and exam entries (F4) need the map.
- For every window, a board series is made for each board it has registrations or active
  subjects in, of the window's own month and year, with the window's entry deadline carried
  over; each is the window's default for its board. Every registration is routed to its
  window's series of its subject's board.
- Proven on a copy of the template dev data (3 windows, 8 registrations, one window with a
  deadline) and on a copy of F0a's richer dev data (20 students, 8 sections), before and after:
  `.audit/catalogue-evidence/migration-dev-before-2.txt`, `migration-dev-after-2.txt`,
  `migration-richdev-before.txt`, `migration-richdev-after.txt`: 17/17 subjects linked, each
  window feeding its Cambridge series, the June 2027 window's deadline on its series, 8/8
  registrations routed.

## 3. The level code (IS-01)

`deriveLevelCode` (`@repo/validations`) computes the school's code; nothing stores it. Three
facts stay apart: a unit's own level, the awards it counts toward, the student's year. An IGCSE
entry is **O.L.**; an entry mixing AS and A2 units **A.S./A.2.**; A2-only **A.2.**; a whole A
Level by its code **A.L.**; a whole AS **A.S.**. What "A.S./A.2." marks on a **single AS unit**
(M1, S1) is the coordinator's question, so it is the setting `catalogue.levelCodeReading`
(admin and coordinator; Settings page):

| Reading | "A.S./A.2." on an AS unit when… |
|---|---|
| `student_series` (default: the owner's words, 26 Sep) | the student also sits A2 units in the same board series |
| `student_year` | the student is in grade 12 in the series' academic year |
| `awards` | the unit counts toward an AS and an A Level award |
| `units` | never (only a mixed entry) |

Changing the reading moves nothing stored; the Catalogue screen shows each row's code for a
grade-11 student and for a grade-12 student sitting A2 units too, and F4 reads it per
registration (`entryItemsFor`).

## 4. Board series and the windows that feed them (IS-05, IS-14, MO-10)

- A window feeds one or more series: one default per board, subjects routed to another series
  of their board where needed. Every series a window feeds is **in the window's academic year
  and of its kind** (June feeds June; other windows feed October, November, January — November
  only for IGCSE), so F0a's `mayRegisterFor`, which judges the window's own type and year, gives
  every series one answer (the reconciliation with F0a: a window's academic year comes from its
  series and all agree, refused otherwise by the API and the database).
- **MO-10 per series.** The entry deadline is a series'. Each registration is judged by its own
  series' deadline everywhere the window's deadline was: registering, preregistering, paying,
  confirming, a reference, collecting at the desk, swaps (`sessionWindow(…, boardSeriesId)`).
  The sweep closes each series at its own deadline: its open payments fail with escrow back,
  its waiting registrations expire, a draft window's preregistrations in it are refunded
  (MO-21), and each family is told which subjects of which series were not entered. A window
  feeding IAL October and IAL January closes October's entries in October and January's in
  January. At the close, an InstaPay checkout's time to send a reference is capped by its own
  series' deadline.
- **The hard stop stays** (A-08, MO-10): the deadline is the admin's alone (403 with the reason
  for the coordinator), after every window feeding the series closes, in the future, with a
  reason, audited in its transaction (`BOARD_SERIES_DEADLINE_SET`). Late-fee dates are shown
  for information.
- **A window closes before the earliest deadline of the series it feeds** (strict, as the
  window's own check was): the sweep never runs inside an open window. Enforced by the route,
  by the draft update under F0a's row lock, and by the database for the open window's
  extension (08k).
- **Locks.** Window before series. A registration's routing reads the window's series links
  `FOR SHARE`; a change to a window's series locks the window `FOR UPDATE`; either alone
  serializes the two (controls C5, C5b green; both removed, C5c red). A deadline change reads
  the windows feeding the series `FOR SHARE`, then the series `FOR UPDATE`.
- **The coordinator's answer (decision 3).** A subject's board is staff data (Catalogue mapping
  or the Subjects form). Changing it moves its waiting and confirmed registrations to each
  window's default series of the new board, audited per registration; if a window feeds no
  series of the new board, or an entry's deadline has passed, nothing changes and the sentence
  says which window and what to add.
- The admin moves registrations between the series of one board in a window, with a reason
  (`REGISTRATION_SERIES_MOVED`); a registration that is history stays where it was.

## 5. Course enrolment

- One open enrolment per student, subject and academic year; grades 10–12 of that year, not a
  student who has left (leaving ends every open enrolment in the leaving's transaction); a
  subject the school does not teach can only be self-study; a teacher named is linked to the
  subject (as the Subjects page would); self-study has no teacher and forms no teaching group.
- **Bulk, preview then commit, idempotent:** carry last year forward (with a subject map: a
  finished subject replaced by the one that follows it, or dropped); from the year's exam
  registrations (the teacher each names, `registration.teacherId`; taken outside school =
  self-study); a whole section with one teacher per subject; rows pasted from a sheet (student
  ID or email, subject code or name, teacher, mode — each row resolves or is listed with its
  reason). All go through `upsertEnrolments`, which takes the year's advisory lock and lets the
  database's partial unique index decide: two commits of the same rows make each enrolment once
  (08j, forced order; control C7).
- **Checked, never blocked** (`checkEnrolments`): registered not enrolled; enrolled not
  registered (expected before June's window opens); mode differs; teacher differs. Per year and
  per student; the family reads its own child's (another family's child is "not found").

## 6. Roles and endpoints

Coordinator and admin keep the catalogue, the series and the enrolment; the admin alone sets an
entry deadline and changes the series a window feeds (the window is the admin's). Finance
reads the catalogue, the series and enrolments; a teacher reads the catalogue and **only their
own class list** (`GET /v1/enrolments/class`); a family reads its own child's enrolment. Every
row is in `apps/api/test/authz-policy.tsv`; 05 proves the family and teacher cases with real
records.

| Endpoints | Principals |
|---|---|
| `GET /v1/catalogue` | staff except gate; teacher |
| `GET /v1/catalogue/entries?sessionId`, and every catalogue write (`/boards/:code`, `/qualifications…`, `/options/:id`, `/units…`, `/registrable/:subjectId`, `/starter`) | admin, coordinator |
| `GET /v1/board-series` | admin, coordinator, finance |
| `POST/PUT/DELETE /v1/board-series…` | admin, coordinator (the deadline: admin only, in the handler) |
| `GET /v1/sessions/:id/board-series` | admin, coordinator |
| `PUT /v1/sessions/:id/board-series`, `POST …/move` | admin |
| `GET /v1/enrolments`, `/check` | admin, coordinator, finance |
| `GET /v1/enrolments/teaching-demand`, `/students`, and every enrolment write | admin, coordinator |
| `GET /v1/enrolments/class` | staff (a teacher's own class only) |
| `GET /v1/enrolments/student/:studentId` | staff with student records; the student; a linked parent |

## 7. Contracts for later features

| For | Contract | Where |
|---|---|---|
| **F1** (timetable) | `getTeachingDemand(academicYearId)`: per subject and teacher, the students taught in school (with their section); self-study forms no group; enrolments with no teacher yet form one group per subject with `teacherId` null. `GET /v1/enrolments/teaching-demand` | enrolment.services |
| **F4** (exam entries) | `entryItemsFor(registrationIds, reading?)` / `entryItemsForWindow(sessionId)` (`GET /v1/catalogue/entries`): per registration the board, the board series with its deadline, the award, the units with their own level, the awards they count toward, the student's grade in the series' year and the derived level code. `registration.boardSeriesId`; `listBoardSeries`, `seriesDeadline`, `windowDeadlines`. `teacherOf(studentId, subjectId, academicYearStart)` — the teacher who gives the forecast grade (null: self-study, none recorded, not enrolled), with `seriesYearOf(type, year)` | catalogue, series, enrolment services |
| **F5** (pathway advisor) | `getCatalogue()`: awards with their units (required/optional, choice groups), each unit's own level and the awards it counts toward, option codes; `listBoardSeries({ academicYear })` for the sittings ahead; `deriveLevelCode` | catalogue, series services; `@repo/validations` |
| **F7** (day-one import) | `upsertEnrolments(tx, academicYearId, rows, actorId, { source: 'import', commit })`, or `batchEnrol(yearId, rows, commit, actorId, ctx, 'import')` for rows naming students and subjects as the sheet does; `findRegistrable(term)` (a row by name or code); `mapRegistrable` / `applyBoardChange` for the board each row is entered with; `loadStarterSet` | enrolment, catalogue services |

## 8. Screens

Each replaces a part of the coordinator's sheet (UX_AUDIT.md §4: the Excel version, then ours).

- **Exam catalogue** (`/exams/catalogue`, Exams → Exam Catalogue). *Excel:* a syllabus list in
  one tab, the codes remembered, "A.S./A.2." typed per row by whoever fills it in. *Here:* the
  three boards with their months and portals; a starter set loads Pearson IAL Mathematics or
  Biology in one click (idempotent, "check against the board's specification"); awards with
  their units (required, optional, choice groups) and Cambridge option codes; every unit with
  its own level and what it counts toward; every registrable subject with what it enters, the
  awards it counts toward and **the school's code read back** — unmapped rows first, filtered
  by one tick; mapping is one dialog (board, award or units by search). The tab is in the
  address.
- **Board series** (`/exams/series`). *Excel:* the boards' key-dates PDFs, and a cell on the
  window for the deadline. *Here:* every series of an academic year with its deadline (days
  left, passed), late-fee dates, the windows feeding it and its registrations and open
  payments; the next deadline says what it will close; a series added in two clicks (board,
  month — only the board's months); its dates in one form; the deadline field is the admin's
  (read-only for the coordinator, with why).
- **A window's Board series** (Sessions → "Board series" on a window; opens after creating a
  window). *Excel:* one tab holding two series (IS-05). *Here:* the series the window feeds and
  each board's default, a series made and added in place (only the months that window may
  feed), where each subject is entered, and the window's registrations with their series,
  moved in bulk with a reason.
- **Course enrolment** (`/academic/enrolment`, Academic → Course Enrolment). *Excel:* September
  copies of last year's class lists, retyped teachers, a separate self-study list, and
  February's surprise when registrations do not match. *Here:* **Start of year** — carry last
  year forward with one subject map for everyone, or take this year's registrations with their
  teachers, or paste rows from a sheet; a preview with each row's outcome (untick to leave
  out), one click to commit, running it again changes nothing. **By section** — the class list
  as a grid like the sheet: students by subjects, one teacher and mode per column, "Enrol all",
  a tick per cell, a cell opens to change teacher or mode or end it with a reason; a quick start
  from the section's registrations. **By student** — one student's year changed in place (the
  teacher and mode selects save on change), a subject added in one row, their registrations
  without an enrolment enrolled in one click. **Check** — four lists of disagreements, each
  line with its fix beside it (Enrol, Make it self-study, Use the registration's teacher, End).
- **My classes** on My Teaching: each class this year with its count, opened to its list.
- **Subjects this year** on the student's record, with "Change the enrolment" for the
  coordinator and the admin, and how many exam registrations have no enrolment.

All strings are in `lib/i18n-catalogue.ts` (Arabic; sentences with names and dates as
patterns); names people or boards typed are kept out of the translator; checked right to left
(`.audit/catalogue-evidence/screens/*-ar.png`). The screens use the shared components and tone
colours; no `useQuery` generic was added (32 in the app).

## 9. Tests

`apps/api/test/08h-catalogue.test.ts` (catalogue), `08i-board-series.test.ts` (series, windows,
MO-10 per series), `08j-course-enrolment.test.ts` (enrolment), `08k-catalogue-races.test.ts`
(races), with cases in 05 (families and teachers) and rules in 09. The plan's scenarios:

| Scenario | Test |
|---|---|
| a unit counting toward AS and A Level | 08h "the Pearson IAL Mathematics starter set…", "the map keeps a unit's own level…", "registrable rows are units…", "'A.S./A.2.' is derived per registration…", "a paper set mixing AS and A2 papers…" |
| a window feeding two board series with different deadlines, each enforced (MO-10 per series) | 08i "a window feeding two board series…": only the admin sets a deadline; the reference time capped per checkout; past October's deadline October is refused and January goes on; the sweep closes October only; January closes at its own time |
| an enrolment carried forward | 08j "an enrolment carried forward: last year's subjects, teachers and modes, previewed, then committed once" |
| a registration without an enrolment flagged | 08j "a registration without an enrolment is flagged, and the registration stands" |
| a self-study enrolment excluded from teaching | 08j "a self-study enrolment is excluded from teaching: no group, no class list, no count" |

Races (forced order with row or advisory locks held from the test): a registration against a
change of its window's series; a window's end against its series' deadline, both orders, a
draft window and an open one; two coordinators setting an award's units; two commits of the
same enrolment rows; a single and a section enrolment at once. 09 checks over every row: each
live registration in a window feeding series is in one of them, of its subject's board; a
registration expired at a deadline was in a series whose deadline had passed; every window
closes before every fed series' deadline and every series is in its academic year and kind.
Controls C1–C14 (each guard undone once, red, restored) are rows in `.audit/catalogue.tsv`.

**Changed assertions.** The MO-10 assertions in `08-money-rules.test.ts` that a deadline per
board series changes (pre-authorised): each has its own trail row (old, new, why) and keeps its
money outcome; 08's subjects are entered with Pearson Edexcel so its January window can feed a
real series. 08f's settings enumeration gains `catalogue.levelCodeReading` (not money). No other
money assertion changed.

## 10. Decisions and why

- **Registrable rows stay subjects.** Families register and pay for rows; a row enters an award
  or units. The school's sheet registers units and paper sets as rows (IS-01), so a row can be
  "P1" or "Biology (Paper 3 & Paper 4)".
- **The level code is derived, its meaning a setting.** The coordinator has not said what
  "A.S./A.2." marks on a single unit; the default is the owner's own words.
- **The deadline moves to the series, the hard stop stays.** The boards take late entries with
  late fees; the school's policy is a hard stop (A-08) — now per series, since one window feeds
  several (IS-05, IS-14).
- **One academic year and kind per window.** F0a judges eligibility by the window's series; a
  window mixing years or June with another series would give two answers.
- **Strict: a window closes before its earliest series deadline.** Otherwise the sweep would
  close money in a window still open. A later series' registrations stay open until their own
  deadline after the window closes (confirmations, references), as before.
- **Enrolment flags, never blocks.** A student may register for a subject studied alone, and
  June's window opens months after teaching starts.
- **Enrolment is grades 10–12 of the year.** The school's registrations and sections are for
  those grades; a younger or graduated student has no year to be taught in here.
- **A named teacher is linked to the subject**, so the Subjects page and the enrolment agree.

## 11. Deferred, and why

- **Cambridge's March series** is not modelled: Egypt does not sit it (DISCOVERY_RESEARCH.md).
- **Board late-fee tiers as money**: information only (the hard stop stays, A-08).
- **The family's own view of enrolment** reads `GET /v1/enrolments/student/:id`; no family
  screen was built (staff side first).
- **AS and A Level subjects of the existing data** stay unmapped until the coordinator says what
  each enters (the Catalogue lists them first).
- **Candidate numbers, entry files, forecast grades** are F4's.

## 12. Questions for the owner (through the coordinator)

1. What "A.S./A.2." marks on a single AS unit such as M1 (IS-01) — today the setting's default,
   "an AS entry of a student who also sits A2 units in that series" — and whether June's "A.L."
   is today's "A.2.".
2. Which board each subject and unit is entered with (IS-14) — today's data says Cambridge for
   every existing subject; the answer is a change on the Catalogue screen.
3. The starter sets' codes need checking against Pearson's current specifications: XBI11/YBI11,
   WME02, WST02 and WDM11 are not all confirmed by the research.
4. Whether an IGCSE window may feed a January series: Pearson's International GCSE sits in
   January, but the school's windows treat January and October as A Level only (the existing
   rule, kept).
5. The strict order (a window closes before its earliest series deadline): if a window feeds
   October and January, it must close before October's deadline.
6. Whether enrolment should cover grades other than 10–12, and whether a subject the school does
   not teach should ever be "in school" (refused today).

## 13. Progress log

- 2026-09-29 15:50Z — started on `feature/catalogue` from `origin/feature/foundation` 1e8f871;
  baseline suite green; dev database from the template.
- 16:34Z — schema, migrations 0037–0039 (regenerated once for per-level qualification codes),
  services and routes (0d5c267); decisions in the trail.
- 16:55Z — scenarios 08h–08k, 05, 09; the MO-10 assertions in 08 moved (trail rows); suite green
  at 904e122 in local time and UTC (268 passed, 1 todo).
- 17:38–18:23Z — the web: Catalogue, Board series, the window's series panel, Course enrolment,
  My classes, the record's subjects (4676509); driven as coordinator, admin and teacher on a copy
  of F0a's dev data; fixes found by driving (the translator's stale attribute names, the panel
  losing an unsaved series, an IGCSE window offered January, the grid's quick start and
  initials) (73222ec); Arabic, right to left (0411b7c, 2460ac2).
- 18:30–18:37Z — controls C1–C11; 08j's enrolment race forced in order (3ca6f60).
- 18:45Z — merged `origin/main` (F0a at b747d47) (5ee540e).
- 18:52Z — a draft window's end judged under F0a's lock; 08k split into draft and open windows
  (9b713e4); controls C4b, C12–C14; suite green at 9b713e4 in local time and UTC (283 passed,
  1 todo); dev database recreated from the template and migrated.
- 19:03Z — the catalogue's tab read on the server (no hydration warning) (f4c9313); this
  document; MONEY_AUDIT's MO-10 text and FEATURES_PLAN's F0b row and status updated.
