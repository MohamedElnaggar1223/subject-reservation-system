# Features plan — the full management system

**Date:** 28 September 2026 (revised the same day after an Opus 5.5 review: §8).
**Status:** the plan of record for building the new features. It supersedes STRATEGY.md's
Phase 3 (the gate), Phase 4 (release 1) and Phase 5 (release 2 candidates). Every implementing
and reviewing agent works from this file. Keep the status table (§7) current; never delete a
decision, mark it superseded.

---

## 0. The owner's decisions (28 September 2026)

In the owner's words, then what each settles.

1. *"I am expecting to actually implement the full complete version of each new feature. I am
   not looking for us to build a release or a basic version."* — Every feature below is built
   complete: every workflow a school running it for real needs.
2. *"For when a grade change its after their final exam of the june session, or basically at
   the end of the june session before it. For example, grade 10 does not have a november
   session as they start their grade in september or october … and they work the entire year
   studying towards the next June session in which they have the core subjects, then in the
   november session following it they are grade 11."* — Answers DISCOVERY.md Q-08 and
   STATE_AUDIT.md ST-13: a grade changes once a year, at the end of the June session.
3. *"Let's postpone the [coordinator's] answers for now and leave their effect take place after
   gathering these decisions later."* — IMPORT_SPIKE.md §3 and DISCOVERY_RESEARCH.md §7 stay
   open. What they would decide (which board each subject and unit is entered with, carry
   forward, self-study on taught subjects) is built as staff-editable settings and data, with
   the current assumption as the default, so their answers change configuration, not code.
4. *"Our priority should be the Admin, in which all of the new features where live, the
   scheduling, the campus-leave permissions, etc. and the UI of it should be optimized
   fully."* — The staff side, where the features are run, comes first and is optimised fully.
5. *"Spawn an Opus 5.5 agent for each new feature, then … another Opus 5.5 agent that will
   review their work, then you will do the final review, after all the new features are
   implemented, a complete UI audit."* — §4.

## 0b. The lead's interpretations, and assumptions awaiting the owner

Not the owner's words; each can be overturned by the owner.

- **The year boundary is 1 July, in Cairo time** (the end of the June session; the school fee
  already uses 1 July). Computed in `Africa/Cairo` explicitly, not in the server's zone.
- **"The Admin" means the staff side** — admin, a new coordinator role, the desk, and new
  teacher and gate roles where a feature is run by them (F0a).
- **A-12 (DISCOVERY.md):** a student who has finished grade 12 may still register for the
  **October, November and January** series of the academic year right after it (retakes to
  improve grades), not for the June after it. Default on, a school setting. Listed for the
  owner in STRATEGY.md §7.
- **A-13:** such a graduate retaking owes no school fee (the fee is for enrolled grades).
  A school setting; listed in STRATEGY.md §7.
- **A-14:** a registration for a series in a new academic year whose school fee has not yet
  been opened proceeds without it (the gate is off without a schedule, as today); the owner
  may prefer to hold it. Listed in STRATEGY.md §7.
- **Grade 10 sits June only** (from decision 2): a grade-10 student is refused for the
  October, November and January series of their grade-10 year.
- **The day-one import stays in scope** (F7): the school cannot go live on re-keyed data, and
  its June 2027 entries fall due in February–March 2027 (DISCOVERY_RESEARCH.md §2).
- **The in-house timetable generator overrides DISCOVERY_RESEARCH.md §4**, which advised
  exporting to aSc or FET at this size; decision 1 asks for the full feature, so F1 builds a
  generator and also offers the export.

---

## 0c. 7 October 2026 — the admin's direction, and the plan reset

The owner met the school's admin. Her priority is **subject reservations and fees paid**; her
verdict on the current implementation: "very hard to use, counter intuitive and not usable that
much".
The forms the school actively uses (Drive folder "June 2027") and eight PDFs (fees per board
and series, registration links for November 2026/January 2027 and June 2027, Cambridge's
enquiry-about-results service) are now the ground truth. The owner's instruction, verbatim:
"analyzing every single form and understanding every option and every thing about it and
mapping these onto changes to our current system is key"; "if our own implementation degrades
the experience or makes it harder or more complex then we failed"; "do not try and fix the
current implementation and if needed just redo it all over again correctly"; "we need to plan
first".

Her points: (1) subjects registrable per paper; (2) some papers required; (3) splitting
certificates (A Level) is a service like remarks, late cash-in, cash-in; (4) remark differs per
board; (5) broadcast, batch and direct notifications, email and WhatsApp, not deletable by
parents or students; (6) automated repeating reminders for payments and deadlines; (7) a
complete rework of the logic and UI of the admin side for reservations and sessions — a session
selects its subjects, each with its teachers, its name derived from its type, far fewer inputs;
board series "very confusing, redundant"; (8) school fees pushed by the admin into pending
payments; (9) the exception system revised so that "every policy, every deadline, every
percentage, literally everything can have an exception"; (10) the teacher of a subject
changeable later; (11) more payment data for parents (date, end date).

**The plan the owner accepted (7 Oct):** Phase 0 — freeze the six in-flight agents (F1 round
two, F2 fixes, F7 fixes, F4 review, the preview build, the walkthrough stage 1); their work stays
on disk and on their pushed branches until each feature's future is decided. Phase 1 — digest
every form and PDF into `SCHOOL_FORMS.md` (the register, the gap map, the questions), update
`DISCOVERY.md`, and have the owner confirm the reading before any design. Phase 2 — design the
rework (`RESERVATIONS_REWORK.md`: sessions from type and year with their subjects, papers,
teachers and fees; board series kept underneath but never assembled by hand; reservations per
paper with services as lines; admin-pushed charges; parent payment detail; one exceptions
engine; notifications and reminders; the proven money core kept: ledger, escrow, receipts,
takings, the 09 invariants), reviewed on Opus 5.5, then by the owner. Phase 3 — build in her
priority order with two or three agents at most, then re-plan F1/F2/F4/F7 on the new session
model. Phase 4 — regenerate the walkthrough (F8).

The owner's answers to the five strategy questions: the freeze, agreed; the admin is not
available until we show her the work again (no questions to her meanwhile); other cycles' forms
exist, but "work with what we have for now"; no WhatsApp Business account — postpone the
integration, keep it in mind; "take your time". Trail: `.audit/school-forms.tsv`.

**Status (7 Oct 2026, 19:08Z).** Phase 1 done: `SCHOOL_FORMS.md`, confirmed by the owner
("let's do it"). Phase 2 done to the review gate: `RESERVATIONS_REWORK.md` version 8 and the
prototype `docs/prototype/reservations-rework.html`, after six Opus 5.5 reviews and two diff
checks (its §16), the last verdict "ready for the owner"; the owner's questions Q-15 and Q-19 to
Q-22 (its §17, DISCOVERY.md §3) stand open with the defaults the design builds. Phase 3 (its
§9: agents A, B, C, D) waits for the owner's review of the design and the prototype.

**Phase 3 started (7 Oct 2026, 19:33Z).** The owner's "let's do it": the five defaults stand
(DISCOVERY.md Q-15, Q-19 to Q-22). Agent A launched on `feature/rework-sessions` (§7 below);
B and C start when A's contract (`docs/features/RESERVATIONS.md` §Contracts) is on its branch;
D after B and C. **Step 1 merged (8 Oct 2026, 03:08Z):** A's branch landed on main at b438976
after its Opus 5.5 review ("ready to merge") and the follow-ups it asked for; A keeps its branch
for post-merge items (the open fee-row race). B and C were each reviewed "merge after fixes 1, 2"
(8 Oct 02:20Z and 02:35Z), are fixing, and merge in that order after main has A; D after them.
**Step 1's follow-ups and step 2's B merged (8 Oct 2026, 04:39Z and 05:26Z):** A's fee-row race
closed by a per-series lock, its evidence trimmed under the new 300 KB rule (CLAUDE.md, CI gate 0),
landed at ee7eb11; B's branch, reviewed "confirmed: merge" after two rounds, landed at 88c8d5a.
C's final merge (its migrations renumbered after B's, B's expiries settling instalment plans) is
next, then D. **Step 2 complete (8 Oct 2026, 06:36Z):** C's branch landed at b76eae4 after three
Opus 5.5 passes; migrations 0041–0049 are on main's journal in stamp order. C finishes two
follow-ups on its branch (the statement's charges with the no-double-count rule for instalments;
the desk reservation taking the year's fee and the charges in one action). **Step 3 (D, messages
and reminders) launched 8 Oct 06:40Z** on `feature/rework-messages`; then step 4 (the lead). **Step 4's end-to-end
check done (8 Oct 08:04Z, main 9edefbb):** every flow driven from a bare template with no errors; the
counts measured against RESERVATIONS_REWORK.md §11 (`.audit/school-forms-evidence/step4/`); seven
observations queued under F6. **F4 and F7 resumed (08:20Z)** on the new model; F1 next, F2 after it,
F8 last. **Step 3 complete (8 Oct 2026, 13:03Z):** D's branch landed at c2d7a78 after three Opus 5.5
passes ("confirmed: merge"); migrations 0050–0054. Landing order now F4 → F7 → F1 → F2 → F8, each
renumbering its migrations after main's journal at its merge.

## 1. The features and their full scope

Each feature lists its scope, then **named scenarios** (tests in `apps/api/test`, driven
through the RPC client) and **screens** (driven in headless Chrome, screenshots kept). "Done"
means every scenario and screen exists and passes review. An implementer may add what a real
school needs beyond them (recorded in the feature's doc); dropping any needs the lead's
agreement and a line in §7.

### F0a — Core foundation

**Grade and eligibility (decision 2; §0b).**
- Replace `user.grade` with the **cohort**: the academic year the student started grade 10.
  Rename or drop the column so type-checking finds every reader (on 28 Sep 2026,
  `grep -rnw grade apps/api/src | wc -l` gives 256 lines, and `grep -rlw grade apps/web/app
  apps/web/components apps/web/lib | wc -l` 35 files). Provide the derived grade as a function *and* a SQL
  expression, for the queries that filter on it (announcements by grade, report counts, fee
  schedules by grade).
- Every **exam series** gets its academic year: add the series year to each registration window
  (`sessionType` plus year); June and January of year Y belong to Y−1/Y, October and November
  of year Y to Y/Y+1. A window's own open and close dates never decide a grade.
- The grade for a series = 10 + (series academic year − cohort); past 12 = graduated.
- Replace `isGraduated` and `requireNotGraduated` (22 references) with **`mayRegisterFor(studentId,
  sessionId)`**, applied at every registration, preregistration, desk, swap and approval path;
  list every call site in the feature's doc. Rules: grade 10–12 for that series; grade 10 only
  June; A-12 for graduates; withdrawn students refused. A coordinator or admin can grant a
  student an audited exception to the grade-10 rule through the existing exceptions mechanism
  (a new exception type). Each exception type names the roles that may grant it, checked in the
  handler: a `05` case shows a coordinator refused a fee waiver and a finance admin refused the
  grade-10 exception.
- The **core-subject rule** (A-05) and the **school-fee gate** read the series' grade and
  academic year, not the window's dates or today's grade (this changes a money path: its
  scenarios in `02`/`03`/`08` are updated and extended, never weakened). A-13 for graduates.
- Remove window-driven progression, `AUTO_GRADE_PROGRESSION`, the progression stamps and
  ST-13's stop-gap.
- **Eligibility can change after a registration exists** — a student is withdrawn, an admin
  corrects a cohort, A-12 is switched off. Each of these runs the clean-up graduation runs
  today (ST-04): registrations the student may no longer sit expire, their open checkouts
  close with any escrow returned, and each move writes its audit row in its transaction.
  Scenarios: withdrawn with a checkout open; a cohort moved back a year with a registration
  for a series now out of reach; A-12 turned off with graduates' registrations pending.
  `closePaymentsOfGraduatedStudents` is reused or replaced, not deleted, until those scenarios
  show nothing calls it. If any other state depends on today's date, a once-per-year job
  (claimed, idempotent, audit rows in its transaction) handles it.
- **Inputs** that took a grade (sign-up, desk onboarding, admin user edit) take "grade in the
  current academic year" and store the cohort; the admin's correction (a repeated year, a
  wrong entry) is an **audited cohort change** with a reason.
- **Backfill:** cohort from today's grade and academic year; graduated and unknown students
  are distinguished (read how graduation is stored today). Proven on a copy of the dev
  database (`igcse_audit`) with before/after counts in the evidence.
- **Boundary table** (each row a test). Registration is decided by the series, so these rows
  hold whatever today's date is:

  | Cohort | Series | Grade | May register? |
  |---|---|---|---|
  | 2026/27 | November 2026 | 10 | No (grade 10: June only) |
  | 2026/27 | January 2027 | 10 | No |
  | 2026/27 | June 2027 | 10 | Yes; core subjects locked |
  | 2026/27 | November 2027 (window opening June 2027) | 11 | Yes; school fee for 2027/28 at grade 11 |
  | 2024/25 | June 2027 | 12 | Yes |
  | 2024/25 | November 2027 | graduated | A-12 on: yes, no school fee (A-13); A-12 off: no |
  | 2024/25 | June 2028 | graduated | No (A-12 covers October, November, January only) |
  | 2024/25 | January 2028 | graduated | A-12 on: yes; off: no |
  | 2024/25 | November 2028 | graduated | No (A-12 covers only the year right after) |
  | withdrawn | any | — | No |

  Row 4's fee: with a 2027/28 fee schedule open, the gate asks for the 2027/28 fee at grade
  11; with none open yet, registration proceeds (the gate is off without a schedule, as today:
  `getApplicableFee`). Whether to hold such registrations until the new year's fee opens is a
  money decision for the owner (A-14).

  **Today's grade** (the Student 360, current-year inputs, F2's leave-alone grades) changes at
  1 July in Cairo. Tested with instants on the same side of midnight whether Egypt is on +2 or
  +3: `2027-06-30T20:30:00Z` is still 30 June (grade 10 for cohort 2026/27);
  `2027-06-30T22:30:00Z` is 1 July (grade 11).

**Students who leave.** A student can be withdrawn or transferred (date, reason): refused from
new registrations, history kept, shown as such everywhere.

**Roles and capabilities.**
- New roles (a user still has one role): `coordinator` (academic lead: calendar, sections,
  timetable, attendance oversight, leave approvals, exam entries, pathway overview),
  `teacher` (own timetable, attendance for own lessons, notices for own classes), `gate`
  (reception and security: the day's leave list, check-out, late arrivals).
- **Teaching is a capability, not a role:** a `teacher` record can be linked to any staff user,
  so a coordinator or admin who teaches gets the teacher screens for their own lessons.
- **The desk** (`finance_officer`, `finance_admin`) may create leave requests on a family's
  behalf (F2) and sees leave and attendance in the Student 360 (read); approving leave and
  correcting attendance belong to the coordinator and admin.
- **Admin is a superset except the parent-only actions** that already refuse admin (a change
  request's approval and rejection, a family's checkout: `authz-policy.tsv`).
- The new roles are denied every existing endpoint except self-service (profile,
  notifications, own session) until a feature grants one; every row of `authz-policy.tsv`
  gets their values. They never hold better-auth's admin `user` permissions (see the note in
  `permissions.ts`).
- Staff are created and managed on the Team page; a teacher account links to an existing
  teacher record or creates one.

**Settings store** (owned here, used by every feature): typed school settings, each key
declared with a schema in `packages/validations`, stored in one table, changed only by the
roles the key names, every change audited. A-12, A-13, F2's policies, F3's thresholds and F4's
centre numbers live here.

**Uploads** (owned here): one upload path for every feature (supporting documents, collector
photos, excuse notes, import files), built on the existing `/v1/files` endpoints (close
SECURITY_AUDIT.md's note on them): who may upload and read each purpose, size and type limits,
R2 in production and a local store in development.

**Academic structure:** academic years; terms (dates); the school calendar (school days,
holidays, early-dismissal days, exam-only days); bell schedules (periods with times per
weekday, variants such as a short day, breaks); rooms (name, capacity, type, features);
homeroom **sections** per academic year (grade, name, homeroom teacher, room) with student
membership that keeps its history, and a bulk step that moves sections into the new academic
year.

**Scenarios:** the boundary table; each `mayRegisterFor` call site refusing a grade-10
November and a withdrawn student; the fee gate by series; the backfill on a copy of dev data;
settings changed only by the permitted role and audited; uploads refused to the wrong role and
family; every new endpoint in the authz matrix for every role; a teacher linked to a
coordinator account; a section roll-over.
**Screens:** Team (the new roles, linking a teacher), Settings, Academic years and terms,
Calendar, Bell schedules, Rooms, Sections (with roll-over), the Student 360's grade, cohort,
section and status, the cohort correction.

### F0b — Exam catalogue, series and course enrolment

Built on DISCOVERY_RESEARCH.md §5 (design notes 1–4, 7) and IMPORT_SPIKE.md (IS-01, IS-05,
IS-14).
- **Qualification catalogue:** boards; qualifications; units or components; the unit-to-award
  map (Pearson W units and X/Y cash-ins; Cambridge syllabus codes, components and option
  codes); a unit's own level (AS or A2) kept apart from the qualifications it counts toward and
  from the student's year, so "A.S./A.2." is derived (IS-01). The board each subject and unit
  is entered with is staff-editable (decision 3). Registrable subject rows can be units.
- **Board series** (board, month, year) with every date the boards set (entry, late-fee and
  high-late dates, Cambridge's retake deadline, forecast, NEA and access-arrangement deadlines,
  results and certificate dates). A registration window feeds one or more board series
  (IS-14); MO-10's entry deadline becomes per board series. From here on a window's academic
  year comes from its board series, and every board series one window feeds must fall in the
  same academic year (refused otherwise), so F0a's eligibility has one year to judge. **The school's hard stop at the
  entry deadline stays** (owner decision MO-10, A-08); a board's late-fee tier is shown for
  information only. The MO-10 scenarios in `08-money-rules.test.ts` stay green.
- **Course enrolment per academic year:** which subjects and units each student is taught
  that year, by which teacher, in school or self-study. Created by staff at the start of the
  year (bulk: carry forward from last year's enrolment or registrations, by section), seeded
  from `registration.teacherId` where known, with an entry point F7's import fills later. Exam registrations are checked
  against it later: a registration without an enrolment, or an enrolment never registered, is
  flagged, not blocked. Self-study enrolments are not taught (they form no teaching group).
**Scenarios:** a unit counting toward AS and A Level; a window feeding two board series with
different deadlines, each enforced (MO-10 per series); an enrolment carried forward; a
registration without an enrolment flagged; a self-study enrolment excluded from teaching.
**Screens:** Catalogue (boards, qualifications, units, awards), Board series and their dates,
a window's series, Course enrolment (per student, per section, bulk).

### F1 — Scheduling (timetable)

- **Teaching groups** formed from the year's course enrolment (F0b) per subject or unit, and
  from sections for homeroom-taught subjects; self-study excluded; staff split, merge and edit
  membership; each group has its teacher (from the enrolment), weekly periods, double periods,
  room needs.
- **Constraints:** teacher availability and maximum periods per day and week, room capacity
  and type, no student in two groups at once (groups overlap by student, not by section),
  lessons not on the same day, locked placements.
- **Grid editor** per term: section, teacher, room and student views; drag and drop; clashes
  shown live with their reason before and after a move.
- **Automatic generation:** places every unlocked lesson meeting every hard constraint,
  optimising soft ones — measured: lessons of a group spread over the week (no two on one day
  unless doubled), teacher gaps minimised, days balanced; keeps locked placements; explains
  each lesson it cannot place and why; deterministic for the same input; at the school's size
  (9 sections, 8 teachers, about 25 groups) it finishes in under 30 seconds. Export to aSc XML
  or FET as well.
- **Versions:** draft and published per term with an effective date; publishing notifies
  students, parents and teachers; published versions kept.
- **Views and output:** student, parent (per child), teacher, room; a teacher's today; print
  layouts; CSV export; an iCal feed per user (a per-user token the user can revoke; the feed's
  endpoint is `anon` in `authz-policy.tsv` and has a case in `05` showing a wrong or revoked
  token gets nothing).
- **Cover:** a teacher absent for a date or range; the lessons affected; free cover teachers
  suggested — qualified means linked to the subject (`subject_teacher`); assign; notify the
  cover teacher and the classes; cover log and report.
- Exposes `getScheduleFor(studentId | teacherId, date)` (lessons with period, times, group,
  teacher, room, cover applied).
- Reads a student's section on a date knowing that a move made on the day they joined leaves them
  in both sections for that day (STATE_AUDIT.md ST-16), and that a leaving date is clamped to the
  section's start (SO-9): decide which membership wins, or refuse those cases first.
**Scenarios:** groups from enrolment excluding self-study; each clash type detected; the
generator placing a school-sized input within the time limit, deterministic (two runs, same
result), respecting locks, explaining an impossible lesson; publish notifying; a cover
assignment refusing an unqualified or busy teacher; a parent seeing only their child's
timetable; a teacher seeing only their own.
**Screens:** Groups, the grid editor (each view), Generate (with explanations), Versions,
Cover, the student, parent and teacher timetables, print.

### F2 — Campus-leave permissions

- **Requests** by a parent, by the desk for a family, or by staff on the school's own
  initiative (a sick student sent home): student, date, leave time, expected return (or not
  returning), reason category and note, optional document (F0a uploads), who collects (a
  parent, an authorised collector, or the student alone where policy allows for their grade).
  Recurring requests over a date range. Parents cancel before check-out.
- **Authorised collectors** per family (name, relation, phone, ID number, photo), approved by
  staff; **custody restrictions** — people who may not collect a child — recorded by staff
  and flagged at the gate.
- **Approval** by the coordinator (admin can): a queue by leave time with the student's leave
  history, the lessons and teachers affected (F1) and exams that day (F4); approve or reject
  with a reason; policy warnings.
- **Policy settings** (F0a settings): cut-off for same-day requests, grades that may leave
  alone, notice required, reason categories, limits per term, approvers.
- **The gate:** today's approved leaves by time; a pass (signed, expiring QR code on the
  parent's screen) scanned or looked up; check-out records the actual time and who collected,
  checked against the collectors and restrictions; returns recorded; no-shows and late returns
  flagged (by a claimed, idempotent job).
- **Notifications** at each step to parent and student; to teachers of affected lessons.
- **History and reports** per student and family; by reason, grade, section, month; export.
- Exposes `getLeaveCoverage(studentId, date)` (time ranges approved and checked out).
**Scenarios:** each request path; a recurring request; a custody-restricted collector refused
at the gate; a pass expired or forged refused; a no-show flagged once (a second scheduler
instance does not flag twice); approve and cancel at the same moment (a race test); a parent
reaching another family's leave refused; the gate role limited to today's list.
**Screens:** parent request and collectors, the approval queue, the gate (list, pass lookup,
check-out), policy settings, history and reports.

### F3 — Attendance

- **Expected presence** comes from each student's own timetable (F1), since subject sets
  differ; self-study, exam days (F4), study leave and approved leave (F2) are handled.
- **Taking attendance:** homeroom registration each morning and per-lesson attendance by the
  lesson's teacher (cover teachers included); statuses present, absent, late (minutes),
  excused, left early (F2); everyone present in one action, then the exceptions; usable on a
  tablet in class (touch targets, one column).
- **Late arrivals** recorded at the gate flow to the day's lessons.
- **Parents** notified of an unexplained absence the same day (a claimed, idempotent job); an
  excuse with an optional document; staff accept or reject it.
- **Coordinator oversight:** today (absent students, lessons not yet taken), follow-ups,
  chronic-absence alerts against thresholds (F0a settings), corrections with a reason and an
  audit row, a lock after a set number of days.
- **Reports:** per student (overall and by subject), per section and subject, per day and
  month; the Student 360 and the parent's and student's views; export.
- Exposes `getAttendanceSummary(studentId, range)`.
**Scenarios:** expected lessons from a student's own timetable; leave marking periods left
early; an exam day excusing lessons; one absence alert per student per day across two
scheduler instances; a teacher refused another group's register; a correction after the lock
refused without the coordinator; a parent's excuse accepted.
**Screens:** the teacher's register (desktop and tablet), homeroom register, the coordinator's
today, alerts and follow-ups, reports, the parent and student views.

### F4 — Exam-entry management

Built on DISCOVERY_RESEARCH.md §2 and §5; uses F0b's catalogue and series.
- **Candidates:** Pearson UCI (permanent), Cambridge candidate number per series with history,
  legal name as on ID, national ID (sensitive: only the roles that need it), centre numbers
  and entry route (direct or via the British Council) as settings.
- **Entries** derived from confirmed registrations per qualification component, with status
  (draft, submitted, amended, withdrawn), carry-forward references, retake flags, forecast
  grades (entered by the student's teacher, taken from F0b's course enrolment, or by the
  coordinator), access
  arrangements, and the board fee tier for information; amendments and withdrawals follow each
  board's rules. MO-10's hard stop is unchanged.
- **Entry lists** per board and series for upload or keying (structured exports mapping one to
  one to the board portals' fields; exact files unconfirmed), with a check flagging every entry
  missing something the board requires.
- **Exam timetables and exam days:** a series' timetable imported or entered; each candidate's
  exam timetable; clashes flagged; exam rooms, seating plans, invigilators, the boards'
  attendance registers, special consideration; families notified; statements of entry
  printable.
- **Results:** import (Cambridge's Excel broadsheet, Pearson's results file; formats
  unconfirmed, F-07, so a mapping step) into results per unit and award, keeping every attempt;
  publication to families; the existing results and remark flows read them. Which grade is of
  record after a remark stays the owner's open question (RF-09): keep every attempt and every
  remark outcome, decide nothing.
- **Certificates:** received, collected (signature, like receipts), unclaimed after the boards'
  retention period.
- Exposes `getSittings(studentId)` and `getExamsFor(studentId, date)`.
- **A deadlines dashboard** across all series.
**Scenarios:** entries derived from registrations per component; an entry list flagging a
missing forecast grade; a new entry after the deadline refused (MO-10) while a withdrawal
after it is allowed with the board's fee shown; an exam clash flagged;
a seating plan without double-booked seats; a results import with a mapping, keeping two
attempts; a certificate collected once (a race test); national IDs hidden from roles without
the need.
**Screens:** Candidates, Entries (per series and per student), Entry lists and checks, Exam
timetable, rooms and seating, invigilation, Results import, Certificates, the deadlines
dashboard, the family's statement of entry and exam timetable.

### F5 — Pathway advisor (Mo'adala)

Built on DISCOVERY_RESEARCH.md §3 (DISCOVERY.md A-10, A-11).
- **Rule sets per admission year**, editable by staff: eight subjects, minimum grade, Extended
  tier, the five-sittings-in-three-years window, grade-to-percentage tables (letters and 9–1),
  ×4.1, faculty groups and their required subjects and A-Level/AS minimums, subject
  equivalences (Arabic including O Level 3180, ICT and Computer Science, EAL and English,
  English Literature, IAL as AS/A Level), national subjects, Decree 148 as a switch
  (unconfirmed).
- **Inputs:** results from F4; sittings from before this system and from other centres,
  entered by staff; the Ministry's national-subject results.
- **Per student:** subjects counted and why, best grade per subject, sittings used and left in
  the window, the score per faculty group, requirements met and missing, warnings (completing
  in October, November or January means applying the next year; the sittings cap; a missing
  national subject).
- **What-if planning:** planned exams (subject, level, series, expected grade) and their effect.
- **Views:** student and parent (read-only, plain language), coordinator (cohort overview: on
  track for which faculty groups, at risk), printable report.
**Scenarios:** the guide's worked rules (eight subjects, a D at A Level, AS and A Level in one
subject counted once, IAL as A Level, ICT and CS as two); the sittings window; a what-if that
reaches a faculty group; a rule-set change for a new admission year leaving the old year's
results unchanged.
**Screens:** Rule sets, the student's pathway, what-if, the cohort overview, the report.

### F7 — Day-one import

The import spike's findings (IMPORT_SPIKE.md) turned into the tool the school uses to go live.
- Import from the school's sheet (and a CSV template for SCL's export at grade 9→10): families,
  students with cohort and section, teachers, course enrolments, registrations and their
  sessions and series; phones and names normalised; duplicates and conflicts found.
- **A review workflow, not a blind load:** a staged import the staff check row by row (fix,
  merge, skip), then commit; every row traceable to its source line; re-runnable.
- The coordinator's pending answers (decision 3) are mapping settings in the review step.
- Money history (DISCOVERY.md F-01, not yet seen) is imported as history, never as live
  payments, when the record arrives.
**Scenarios:** a sheet with the spike's known problems (per-paper rows, a duplicate family,
drifted columns, January rows in a November tab) staged with every problem flagged; a commit
creating exactly the reviewed rows; a re-run changing nothing. The school's real sheet never
enters the repo: tests use synthetic sheets with the same shapes.
**Screens:** upload, the staged review, conflicts, commit summary.

### F6 — The complete UI audit (after every feature has landed)

Every screen, every role, the staff side first, judged against named principles:
Nielsen's heuristics; WCAG 2.2 AA (contrast, focus order and visibility, labels, target size,
reduced motion); the desk-first standard (UX_AUDIT.md §4: fewer steps and less to remember
than the spreadsheet); information architecture for a system with many modules (navigation
grouped by domain and role, search-first where staff look people up); consistency with the
project's tokens and components; keyboard efficiency for staff; Arabic and right-to-left
throughout; responsive (staff on desktops and tablets, families on phones); loading, empty and
error states that say what to do; sentences, not codes; tables with sorting, filtering, density
and export; print layouts; performance (no screen waits on an unnecessary request). Before-and-
after screenshots of every screen changed; a written checklist per screen.

**Queued from the rework's step 4 check (8 Oct 2026, `.audit/school-forms-evidence/step4/measure-counts.json`):**
a new session lists every active subject closed and shows the catalogue's self-study-only
subjects to families at once (say which subjects families can see); the subject drawer has two
forms with two Save buttons; "Dates not set" on a session is not a link to the Board Series page
(where the next year's filter hides the series); the dates form's required reason is labelled
"Why it changes" while a Notes field sits below; the family's Reserve page should preselect the
only child and the only open session; the desk's parent-consent tick shows for lines the family
reserved itself; the Arabic hydration warning on every page (pre-existing; F1 traced it to `i18n.tsx`'s language initialiser, there since 2c3d27f of 30 May; it shows on /sign-in, /academic/years, /academic/rooms and /today too). Also
from C: three hand-cast API responses in `desk.client.tsx` that predate the rework.

### F8 — The demo school and the walkthrough (last, after F6)

The owner's request of 30 Sep 2026: once every feature and the UI audit are finished, an artifact
that walks a first-time user through the **whole program — every feature, the existing ones
included** — used to present the system to the school. For each feature it says which account to
sign in with, where to navigate and what to click, purely through the UI, and explains what the
feature does and how it works (its functionality, not its benefits), so that following it tries
every feature once.
- **A demo school**, built by a reproducible script through the API (not SQL), with an account
  for every role (admin, coordinator, teacher, gate, finance officer, finance admin, parents,
  students) and data in every state the walkthrough shows (sessions open, closed and in draft;
  registrations, payments, receipts, escrow, refunds, remarks, results; the academic year,
  calendar, bells, rooms, sections; the catalogue and board series; enrolments; a published
  timetable and a cover; leave requests at each stage; attendance; exam entries and results; the
  pathway; an import staged for review). No real school data.
- **The walkthrough**, ordered as one complete tour, every step driven in headless Chrome against
  the demo school so each instruction is proven to work, with a screenshot per step.
- **Format (owner, 30 Sep 2026): a self-contained HTML page** — one file with the steps and
  embedded screenshots, opened in any browser, for presenting on a screen.
- **Timing (owner, 30 Sep 2026):** a first version as soon as F1, F2, F4 and F7 have finished
  implementing — before their reviews — then updated as each review lands, as F5, F3 and F6
  land, and finally after F6. Each version is driven against one running system holding every
  feature: the merged features on `main`, and the not-yet-merged ones on a preview branch that
  merges their branches (migrations renumbered per §3), never on `main` itself.
- The demo school is rebuilt from its script for every version, so the page's steps stay true.

---

## 2. Contracts between features

Names are the intended ones; an implementer who changes one updates this section in the same
branch.

| From | Provides | Used by |
|---|---|---|
| F0a | the cohort (`user.cohortYear`); the grade as `gradeInAcademicYear(cohortYear, academicYearStart)` / `gradeToday(cohortYear)` and `academicYearStartOf(instant)`, `seriesAcademicYearStart(type, year)` (`@repo/validations`), and in SQL `gradeInYearSql` / `gradeTodaySql` / `gradeTodayExtras` (`@repo/db`, over the functions `school_grade`, `school_academic_year_start`, `school_series_academic_year_start`); `mayRegisterFor(studentId, sessionId)` and `expireIneligibleRegistrations(tx, scope, cause)` (eligibility.services); windows' `seriesYear`; academic years, terms, calendar entries and `getSchoolDay(date)`, bell schedules and periods, rooms, sections and memberships with `sectionOf(studentId, year?)`; roles `coordinator` / `teacher` / `gate` with `lib/role-grants.ts`; `teacher.userId` and `getTeachingFor(userId)`; the settings store (`SETTINGS` registry, `getSetting(key)`, `updateSetting`, `onSettingChanged`); uploads (`UPLOAD_PURPOSES`, `POST /v1/files/upload`, `GET /v1/files/:id/content`, `uploadForPurpose`, `getReadableFile`). Details: docs/features/FOUNDATION.md | all |
| F0b | the catalogue: `exam_board`, `qualification`, `exam_unit` (own level), `qualification_unit` (the unit-to-award map), option codes, `subject.qualificationId` / `subject_unit` (what a registrable row enters), `getCatalogue()`, `findRegistrable(term)`, `deriveLevelCode(input, reading)` with the setting `catalogue.levelCodeReading`; board series (`board_series` with the entry deadline and the board's dates, `listBoardSeries`, `seriesDeadline`, `windowDeadlines`), the series a window feeds (`session_board_series`, `session_subject_series`) and `registration.boardSeriesId`; F4's `entryItemsFor(registrationIds)` / `entryItemsForWindow(sessionId)` and `teacherOf(studentId, subjectId, academicYearStart)`; F1's `getTeachingDemand(academicYearId)`; F7's `upsertEnrolments(tx, academicYearId, rows, actorId, { source: 'import', commit })` / `batchEnrol(…, 'import')`; course enrolment (`course_enrolment`, `checkEnrolments`). Details: docs/features/CATALOGUE.md §7 | F1, F4, F5, F7 |
| F1 | teaching groups and members; published timetable; `getScheduleFor(studentId \| teacherId, date)` | F2, F3 |
| F4 | candidates, entries, results per unit and award, `getSittings(studentId)`, `getExamsFor(studentId, date)` | F2, F3, F5 |
| F2 | leave requests and states; `getLeaveCoverage(studentId, date)` | F3 |
| F3 | attendance; `getAttendanceSummary(studentId, range)` | Student 360, F6 |

---

## 3. Build order

1. **F0a** alone.
2. **F0b** alone.
3. **F1 (scheduling), F4 (exam entries) and F7 (import)** in parallel — the import needs only
   F0a and F0b, and the school's June 2027 entries fall due in February–March 2027.
4. **F2 (campus leave) and F5 (pathway advisor)** in parallel.
5. **F3 (attendance).**
6. **F6 (UI audit).**
7. **F8 (the demo school and the walkthrough)** — first version after step 3's implementers finish, updated at each later step.

**Every branch that lands after a parallel branch added migrations** (in step 3, possibly the
third, after two merges):
1. merges `origin/main` into its branch (never a rebase: no force-push), taking `main`'s
   `packages/db/drizzle/meta/_journal.json` and snapshots;
2. deletes its own generated migration and snapshot and runs `drizzle-kit generate` again, so
   its migration comes after `main`'s (Drizzle skips a migration older than the last one
   applied, without an error, so never renumber by hand);
3. keeps hand-written backfills as separate custom migrations (`drizzle-kit generate --custom`)
   and recreates them after the regeneration;
4. proves it on a database that already has `main`'s migrations (a fresh copy of its dev
   database migrated to `main` first), as well as on the suite's empty one.

---

## 4. How each feature is done

1. **Implement** (Opus 5.5, its own worktree). Start from a fresh `origin/main` (local `main`
   in the main checkout is stale). Never switch branches in the lead's `lead-env` worktree. In
   a worktree of your own: `git fetch origin && git switch --no-track -c feature/<name>
   origin/main`; without one: `git fetch origin && git worktree add --no-track -b
   feature/<name> .claude/worktrees/<name> origin/main`. Push with `git push -u origin
   feature/<name>`. Read the project's read-first docs and this plan; write
   `docs/features/<NAME>.md` (the feature as built: data model, workflows, screens, decisions
   and why, anything deferred, owner questions, and a progress log kept current so the work can
   resume); keep a trail in `.audit/<name>.tsv` with real `date -u` times; commit as work
   completes; push the branch. It does not merge.
2. **Review** (Opus 5.5, the pinned reviewer, read-only) against §1's scenarios and screens and
   §5's rules; findings ranked by severity; last line names its model.
3. **Fix** (the implementer, resumed), and confirm with the reviewer where findings were
   material.
4. **Lead review and merge:** the lead reads the diff, runs the gates, drives the feature on a
   running system, and fast-forwards `main` on a green CI run.

---

## 5. Rules every agent follows

- **Read first:** CLAUDE.md, PATTERNS.md, STRATEGY.md, FOUNDATION_AUDIT.md, SECURITY_AUDIT.md,
  MONEY_AUDIT.md, STATE_AUDIT.md, DISCOVERY.md, DISCOVERY_RESEARCH.md, IMPORT_SPIKE.md,
  V3_PLAN.md, UX_AUDIT.md, `apps/api/test/README.md`, this file.
- **Hono RPC everywhere;** response types derived from the fetcher; `success()` / `error()`
  envelopes. **No new `useQuery<…>` generics:** `grep -rn 'useQuery<' apps/web/app | wc -l` must
  not rise above 35 (its count on 28 Sep 2026).
- **Schema:** Drizzle in `packages/db`; migrations from `drizzle-kit generate --name <name>`;
  backfills as custom migrations; rebuild `packages/db`, `packages/validations` and `packages/storage` after editing
  them; the migration protocol in §3.
- **Tests are the proof.** Every workflow has scenarios in `apps/api/test` driven through the
  typed RPC client against real Postgres. Every new endpoint has its row in `authz-policy.tsv`
  for every role, the new ones included. Object-level cases in `05-object-access.test.ts` for
  each boundary: another **family** (a parent or student reaching someone else's child),
  another **class** (a teacher reaching a group they do not teach; a cover teacher outside the
  covered lesson and date), the **gate** (only today's leave list, only what check-out needs).
  Anything two people can act on at once has a race test. A money path follows MONEY_AUDIT.md's
  rules (audit row in the transaction, row locks, an invariant in `09`). Each fix is shown red
  once with it undone (a "control" row in the trail).
- **Scheduled jobs** (absence alerts, leave no-shows, deadline reminders, any yearly job) follow
  ST-06 and ST-12: claim before acting, idempotent, safe if a second instance runs the same
  tick, retried by the next tick; each has a scenario proving it acts once.
- **What only the lead changes:** an existing money scenario's assertions, an owner decision, a
  finding's status in the audit reports. An implementer who believes one must change stops and
  says so in its report. **Pre-authorised:** F0a may change the school-fee and grade assertions
  in `02`, `03` and `08` that the fee-by-series rule changes, and the ST-04 scenarios in `08b`
  whose trigger changes from manual graduation to withdrawal, cohort correction or A-12 off —
  provided each still asserts the money outcome (checkout closed, escrow returned, audit row,
  family told); and F0b the MO-10 assertions in `08` that a deadline per board series changes — each changed assertion with its own trail
  row (old, new, why), which the reviewer checks one by one.
- **Isolation on this shared machine:** the suite on its own database —
  `TEST_DB_NAME=igcse_<db>_test pnpm --filter @repo/api test` (snake_case; the name must end in
  `_test`). A running system on its own ports and database (§7): `CREATE DATABASE
  igcse_<db>_dev TEMPLATE igcse_template_dev` on the container at 127.0.0.1:5433 (user `audit`,
  password `auditpass`) — a copy of the dev data that nothing connects to (if the create
  reports the template busy, another agent is copying it: wait a few seconds and retry; never
  disconnect anyone), then migrated to the branch; copy `apps/api/.env` and `apps/web/.env.local` from the
  `lead-env` worktree and change the ports and URLs. A new worktree needs `pnpm install` and a
  build of `packages/db`, `packages/validations` and `packages/storage` (and again after merging
  `main`). Kill only processes it started, by PID.
- **Gates** before any push: `pnpm --filter @repo/api check-types`, `pnpm --filter web
  check-types`, the suite in local time and with `TZ=UTC`. A "green" claim names the commit it
  ran on.
- **UI:** the existing components (`apps/web/components/ui`), CSS variables and patterns — no
  new palette; every string through `apps/web/lib/i18n.tsx` in English and Arabic, right-to-left
  checked; staff flows pass UX_AUDIT.md §4's test; new screens registered in
  `apps/web/components/nav-shell.tsx` for the right roles; every screen driven in headless
  Chrome (`playwright-core` in a scratch directory under `/tmp`, `channel: 'chrome'`), with
  screenshots in `.audit/<name>-evidence/` (git-ignored).
- **Data:** the school's real sheet never enters the repo, a test or a screenshot.
- **Git:** commit on the feature branch as work completes; push the branch; never push `main`;
  never force-push.
- **Report:** what was built against §1's scenarios and screens, the gates with their commit,
  the controls, what is deferred and why, the owner's questions; the last line names the model.

---

## 6. Open owner questions these features touch

A-12, A-13 and A-14 (§0b); RF-09 (the grade of record after a remark: F4, F5); the coordinator's
answers (decision 3: F0b, F4, F7); DISCOVERY.md Q-02 (carry forward), Q-05 (candidate numbers
and the entry route), F-01 (the money record: F7).

---

## 7. Status

Each agent's own resources (test database `igcse_<db>_test`, dev database `igcse_<db>_dev`,
API and web ports):

| Feature | Branch | `<db>` | API / web |
|---|---|---|---|
| F0a Core foundation | `feature/foundation` | `foundation` | 3061 / 3060 |
| F0b Catalogue, series, enrolment | `feature/catalogue` | `catalogue` | 3081 / 3080 |
| F1 Scheduling | `feature/scheduling` | `scheduling` | 3011 / 3010 |
| F4 Exam entries | `feature/exam-entries` | `exams` | 3041 / 3040 |
| F2 Campus leave | `feature/campus-leave` | `leave` | 3021 / 3020 |
| F5 Pathway advisor | `feature/pathway-advisor` | `pathway` | 3051 / 3050 |
| F3 Attendance | `feature/attendance` | `attendance` | 3031 / 3030 |
| F7 Day-one import | `feature/import` | `import` | 3091 / 3090 |
| F6 UI audit | `feature/ui-audit` | `ui` | 3071 / 3070 |
| Rework A — sessions, offers, fees (RESERVATIONS_REWORK.md §9 step 1); merged to main 8 Oct 2026 (b438976) | `feature/rework-sessions` | `rwa` | 3121 / 3120 |
| Rework B — reservations (step 2); merged to main 8 Oct 2026 (88c8d5a) | `feature/rework-reservations` | `rwb` | 3111 / 3110 |
| Rework C — money changes, charges, exceptions (step 2); merged to main 8 Oct 2026 (b76eae4) | `feature/rework-money` | `rwc` | 3141 / 3140 (A's servers took 3121/3120 because 3101/3100 were held by an older worktree's dev servers) |
| Rework D — messages and reminders (step 3); merged to main 8 Oct 2026 (c2d7a78) | `feature/rework-messages` | `rwd` | 3131 / 3130 |

| Feature | Implemented | Reviewed | Merged | Notes |
|---|---|---|---|---|
| F0a Core foundation | yes — docs/features/FOUNDATION.md | Opus 5.5, three rounds; lead review | 29 Sep 2026, `b747d47`, main CI 36613182503 green | owner questions in FOUNDATION §12; A-12/13/14 as settings |
| F0b Catalogue, series, enrolment | yes — docs/features/CATALOGUE.md | Opus 5.5, three rounds (eleven flags, then six, then two); lead review | 30 Sep 2026, see the trail | owner questions in CATALOGUE §12; F1's 0040 collides with F0b's 0040 |
| F1 Scheduling | frozen 7 Oct at 2c2a910 on `feature/scheduling` (the round-two fixes uncommitted on the agent's disk); **resumed 8 Oct 2026 10:50Z** on the rework's session model (RESERVATIONS_REWORK.md §9's F1 list) in worktree `agent-a127f2284d74101e7`, the found fixes committed first | Opus 5.5, round one applied (SCHEDULING.md §16); round two (30 Sep, session log) left three flags to fix on resumption: dated teacher clashes checked across intervals, carried covers re-checked after a change, lock and race tests for memberships and covers | | |
| F4 Exam entries | frozen 7 Oct at ec7689b (CI green on 53fd152; the lead drove every screen 30 Sep); **resumed 8 Oct 2026 08:20Z** on the rework's model (RESERVATIONS_REWORK.md §9's F4 list) in worktree `agent-ae3ddd804d82aff1d`; **implemented on the new model 8 Oct**, three Opus 5.5 reviews applied (093dbd1, 426d565, 54c225f) — docs/features/EXAM_ENTRIES.md §2a; main merged at the final merge with F4's migrations as 0056 and 0057 | Opus 5.5 implementer and reviewer, three rounds; lead review | 8 Oct 2026, see `.audit/exam-entries.tsv` | owner questions in EXAM_ENTRIES §12 |
| F2 Campus leave | | | | |
| F5 Pathway advisor | | | | |
| F3 Attendance | | | | |
| F7 Day-one import | frozen 7 Oct at e58324b (gates green on 0036d64; fixing its review's flags, last flag 6); **resumed 8 Oct 2026 08:20Z** on the rework's model (§9's F7 list) in worktree `agent-acf43230a4e06e8b4` | Opus 5.5 implementer; reviewer after its push | | |
| F6 UI audit | | | | |
| F8 Demo school and walkthrough | | | | owner's request, 30 Sep 2026; after F6 |

**F0a narrowings** (as built; details in docs/features/FOUNDATION.md §3 and §11) — each is held
for the owner or the lead, not decided by the implementer:
- **Preregistrations are left out of the eligibility clean-up.** A student who leaves (or whose
  cohort or series is corrected, or A-12 turned off) keeps their preregistrations; at the series'
  opening the capture holds them instead of confirming them — money held, one audit row, finance
  told. Nothing releases a held preregistration until the owner decides (STATE_AUDIT SO-4): the
  family cannot cancel it once the series is open, and after the window closes it stays held.
- **Pending swap requests on a leaver's paid subject stay pending.** Approving one is refused with
  the reason (it would register a new subject); the request is not rejected at the withdrawal.
- **Refund windows still take their academic year from the window's start date**
  (`refund.services`), not the series'; moving them is a money change for the lead.
- **A leaver's confirmed registrations are untouched.** Only waiting registrations expire; paid
  subjects stay paid, and dropping one follows the ordinary drop and refund rules.

---

## 8. Review of this plan

An Opus 5.5 review on 28 Sep 2026 found the first draft not ready: the grade tied to window
dates rather than the exam series, "graduated" left without an event and colliding with A-12,
`user.grade`'s readers unaddressed, F1 depending on units built in parallel by F4, the day-one
import dropped, teaching groups without a workable source, local `main` stale, a migration
protocol that could lose backfills, no owner for settings and uploads, an under-specified role
model, object-level tests for families only, MO-10 at risk, the solver contradicting the
research unannounced, scope gaps (exam rooms and seating, past sittings, custody, leavers,
expected presence), missing rules for scheduled jobs and generics, and acceptance a reviewer
could not check. The revision acted on all eighteen flags. A confirmation review found thirteen
more — eligibility changing after a registration (withdrawal, cohort correction, A-12 off)
stranding payments; F4 using F1 in parallel; the lead-only rule blocking F0a and F0b; row 4's
fee undefined; no timed rows and two missing A-12 rows; a window's year once it feeds several
series; an F4 scenario beyond MO-10; F7 too late; a branch command that could move the lead's
worktree; a template database the lead's API holds; a trail without real times; the grade-10
override and the iCal feed; quotes edited — all acted on. The trail is
`.audit/features-plan.tsv`.
