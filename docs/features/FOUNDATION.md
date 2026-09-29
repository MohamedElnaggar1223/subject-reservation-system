# F0a — Core foundation (as built)

Branch `feature/foundation`, started from `origin/main` 7243da8. The plan is FEATURES_PLAN.md
§1 "F0a — Core foundation", its §2 row and §5's rules; the owner's decisions are §0 and the
lead's interpretations §0b. The trail is `.audit/foundation.tsv`; evidence (logs, screenshots,
backfill counts) is `.audit/foundation-evidence/` (git-ignored). The progress log is the last
section.

F0a replaces the stored grade with a **cohort**, gives every registration window its **exam
series**, answers "may this student register for this series?" in one place
(`mayRegisterFor`), and lays down what every later feature stands on: the academic year, terms,
the school calendar, bell schedules, rooms, homeroom sections, three staff roles, a settings
store and one upload path.

---

## 1. Data model

Migrations `0034_foundation_structure.sql` (additive), `0035_foundation_backfill.sql`
(hand-written: SQL functions and the backfill) and `0036_foundation_drop_stored_grade.sql`
(drops what the cohort replaces). The drop is a separate migration so the backfill always runs
against the old column, and so type-checking found every reader of `user.grade` (all removed).

**`user`** gains:
- `cohort_year` — the start year of the academic year the student is in grade 10 (2026 for
  "grade 10 in 2026/27"); null = grade not recorded. Checked 2000–2100.
- `left_on`, `left_kind` (`withdrawn` | `transferred`), `left_reason`, `left_recorded_by`,
  `left_recorded_at` — a student who left (a check keeps them all-or-nothing).
- `grade` and the `grade_progression_run` table are **dropped**, with `registration_session`'s
  progression stamps (ST-13's stop-gap) and `AUTO_GRADE_PROGRESSION`.

**`registration_session`** gains `series_year` (NOT NULL, 2000–2100). With `session_type` it
names the exam series ("June 2027"). The type gains **`october`** (A-Level only, like January).

**`teacher`** gains `user_id` (unique, nullable): the staff account that teaches as this record.

**`file`** gains `purpose` (default `document`) and `student_id` (the student a family file
concerns).

**New tables:** `school_setting` (key, jsonb value, who and when), `academic_year` (start year,
first and last day, one per start year, inside 1 July – 30 June), `academic_term`,
`calendar_entry` (holiday, early dismissal with its time, exam-only day, extra school day — a
date range with a note), `bell_schedule` (a named day variant: default, short day…) and
`bell_period` (weekday, start, end, label, break or lesson), `room` (name, capacity, type,
features, in use), `section` (academic year, grade, name, homeroom teacher, room, capacity,
`rolled_from_section_id`) and `section_membership` (student, section, year, started, ended,
why, by whom; a unique index allows one open membership per student per academic year).

**SQL functions** (0035), exported to TypeScript as Drizzle helpers in
`packages/db/src/academic.ts`:

| SQL | Drizzle | TypeScript (`@repo/validations`, `academic/academic-year.ts`) |
|---|---|---|
| `school_academic_year_start(ts)` — 1 July in Africa/Cairo | `academicYearStartSql(ts)` | `academicYearStartOf(instant)` |
| `school_grade(cohort, year)` = 10 + (year − cohort) | `gradeInYearSql(cohort, year)` | `gradeInAcademicYear(cohort, year)` |
| today's grade | `gradeTodaySql(cohort)`, `gradeTodayExtras` (a relational `extras` that keeps a `grade` field on responses) | `gradeToday(cohort)` |
| `school_series_academic_year_start(type, year)` | `seriesAcademicYearStartSql` | `seriesAcademicYearStart(type, year)` |

June and January of year Y belong to Y−1/Y; October and November of Y to Y/Y+1. Labels:
`academicYearLabel(2026)` = "2026-2027" (what fee schedules carry), `academicYearShortLabel` =
"2026/27", `seriesLabel('june', 2027)` = "June 2027", `gradeLabel(grade)` = "Grade 11",
"Graduated" (past 12), "Grade 9 (starts grade 10 next year)", "Not started yet", "Grade not
recorded" (null).

### The backfill (0035)

1. A student with a stored grade G: cohort = (academic year the migration runs in) − (G − 10).
2. A student with no grade was either graduated (graduation stored `grade = null`) or never
   finished sign-up. A graduate is told apart by evidence they once had a grade: the audit row
   that set it to null, or any registration (every old path required a grade). The row's date
   in Cairo decides which year was their grade 12: **July–December** — they had just finished
   grade 12, so cohort = the row's academic year − 3; **January–June** — graduated during their
   grade-12 year, so cohort = the row's academic year − 2 (the lead's decision on review flag
   3). A registration alone: graduated as of the migration (this academic year − 3). Each
   inferred cohort writes a `STUDENT_COHORT_INFERRED` row (basis, the date read), so staff can
   review them: the Students screen filters "graduation inferred by the backfill" and the
   record lists the row; an admin corrects a wrong one with the cohort correction.
   Otherwise the cohort stays null ("grade not recorded"), marked by a
   `STUDENT_COHORT_UNRECORDED` row: refused registration, listed on the Students screen, and
   recorded by staff only — the student cannot record it at the setup page.
3. Every window gets its series year: the year in its name ("November 2026") when there is one,
   otherwise the first time the series month comes on or after the window closes.
4. Files get a purpose (`avatar` for avatars, otherwise `document`).

Proven on three fresh copies (evidence `backfill-{plain,rich,audit}-{before,after}.txt`):
`igcse_template_dev` as is, a copy enriched with every branch (grades 10 and 11, a graduate by
audit row, a graduate with only a registration, a never-graded student, October and January
windows without a year in the name), and `igcse_audit` (the database the plan names; copied
with pg_dump, untouched). Every copy: 0 mismatches between the stored grade before and today's
grade after, 0 non-students with a cohort, 0 windows without a series, the boundary instants
right in SQL, row counts unchanged. The graduate rule was then proven on a fourth fresh copy
enriched with a **20 May 2026** graduation (→ cohort 2023, grade 13 today) and a **10 November
2025** graduation (→ 2022, grade 14), with one `STUDENT_COHORT_INFERRED` row per inferred
graduate (`backfill-rich2-{before,after}.txt`). **At the current 0035** (with the audit rows) the
proof was re-run on fresh copies of `igcse_audit` (pg_dump; 77 audit rows before and after,
nothing inferred or unrecorded, counts unchanged) and of the enriched set (80 → 85 audit rows:
four `STUDENT_COHORT_INFERRED`, one `STUDENT_COHORT_UNRECORDED`, 0 mismatches)
(`backfill-{audit3,rich3}-{before,after}.txt`); the dev database `igcse_foundation_dev` was
rebuilt from a fresh copy of `igcse_template_dev` and the stale proof copies dropped.

---

## 2. Grade and eligibility

### mayRegisterFor(studentId, sessionId)

`apps/api/src/services/eligibility.services.ts`. Returns `{ allowed, code, reason, grade,
academicYearStart, academicYear, series, graduateRetake, grade10ExceptionId }`; the grade is
the one **in the series' academic year**, never today's and never the window's dates.

| Case | Answer |
|---|---|
| not a student | refused (`not_a_student`) |
| left the school | refused (`left`), naming the date |
| cohort unknown | refused (`grade_unknown`) |
| below grade 10 in that year | refused (`not_started`) |
| grade 10, June | allowed |
| grade 10, any other series | refused (`grade10_june_only`) unless an active `grade10_other_series` exception covers it |
| grade 11 or 12 | allowed |
| grade 13, October/November/January | allowed when A-12 (`eligibility.graduateRetakes`) is on (`graduateRetake: true`), else refused |
| otherwise past 12 | refused (`graduated`) |

`GET /v1/registrations/eligibility?studentId=&sessionId=` returns it to the student themself,
a linked parent, and the student-record roles.

**Every call site.** The 22 references to `isGraduated` / `requireNotGraduated` on origin/main
(middleware 4, registration.routes 2, swap.routes 3, desk 2, grade.services 1, prereg 2,
registration.services 5, swap.services 3) are gone with `grade.services.ts`. Every path that
creates, approves, moves or pays for a registration now asks `mayRegisterFor`; each call site
is numbered in the source and each is refused in `08d` for a grade-10 November and a
withdrawn student:

| # (08d) | Path | Where |
|---|---|---|
| 1 | a student's registration request | `registration.services.ts` createRegistrationRequest (call site 1) |
| 2 | a parent's direct registration | createDirectRegistration (2) |
| 3 | an admin override | adminOverrideApproval (4) |
| 4 | the desk registering | `desk.services.ts` executeDeskRegistration (5) |
| 5 | a preregistration | `prereg.services.ts` (11) |
| 6 | a parent approving a request | approveRegistrationRequest (3) |
| 7 | a checkout | `payment.services.ts` initiate (asked before the window) |
| 8 | the desk taking the money | `desk.services.ts` (6) |
| 9 | a drop request / 10 a swap request | `swap.services.ts` (7, 8): a student who may no longer sit the series cannot rearrange it |
| 11 | a parent's direct swap | `swap.services.ts` (10) |
| 12 | approving a swap | `swap.services.ts` (9) |
| 13 | the subjects offered | getAvailableSubjects: none for a series the student may not sit |

Readers that are not gates: the core-subject rule (validateCoreSubjectRequirements), the swap
pricing's series grade, the Student 360's open series, the student record, the home page and
the register page.

**Asked again inside the transaction.** Each transaction that creates a registration
(request, direct, override, desk with and without money, preregistration, swap approval,
direct swap) runs `assertMayRegisterForInTx` first: the student and window rows FOR SHARE, and
the grade-10 exception row or the A-12 key (a transaction advisory lock — a never-set key has
no row) the verdict rests on, then the same judgement. Every eligibility change takes the same
row FOR UPDATE (the student: withdrawal, transfer, cohort correction; the window: series
correction; the exception: revocation; the setting: `updateSetting` holds its key) before its
clean-up reads registrations. So a change either lands first and the registration is refused,
or waits and then expires the registration. `08g` forces both orders: a registration queued
behind an uncommitted row while each change fires (controls C19, C20), and a withdrawal that
lands first against the desk taking money, a preregistration, a swap approval and a direct swap
(controls C22–C25). The approval path needs nothing: its UPDATE is guarded by status.

**A grade-10 exception that runs out** (`validUntil` passes) stops allowing new registrations,
and a scheduler step gives the waiting registrations it covered the same clean-up as a
revocation (the lead's decision on the confirmation review): `lapseGrade10Exceptions`
(`exception-lapse.services.ts`), every tick, claims each due exception with a status-guarded
update (active → `lapsed`), writes `EXCEPTION_LAPSED` and expires what it covered (cause
`exception_lapsed`) in that transaction, and closes their open checkouts after the commit.
Paid registrations stand. A second scheduler instance or a revocation at the same moment finds
nothing to claim; a failure leaves it active for the next tick (ST-06, ST-12). `08e` "a grade-10
exception that runs out" (two instances at once, one claim), control C29.

### Today's grade

The Student 360, the student record, current-year inputs and every list show today's grade:
the academic year of now in Cairo. `2027-06-30T20:30:00Z` is still 30 June (grade 10 for cohort
2026); `22:30:00Z` is 1 July (grade 11) — tested in code and in SQL (`08d`).

### Inputs

Sign-up, the setup page, desk onboarding and the Team form take "grade this academic year"
(9–12; 9 = starts grade 10 next year) and store the cohort, each with a
`STUDENT_COHORT_RECORDED` row naming who recorded it (`self_setup`, `desk`, `admin`). A student
records their own grade only at their own first setup — a cohort nobody ever set
(`recordMissingCohort` refuses, 403, when any row shows it was set, cleared or left for staff,
such as the backfill's `STUDENT_COHORT_UNRECORDED`). A correction is the admin's, audited with a
reason: `PUT /v1/students/:id/cohort { cohortYear | gradeNow, reason }`
(`STUDENT_COHORT_CORRECTED`, the family told).

**A draft window's series.** The draft update (`PUT /v1/sessions/:id`) writes its
`SESSION_UPDATED` row in its own transaction; it refuses a change to the series type or year
once anyone has preregistered (409, pointing to "Correct series", which records a reason and
checks each student again), and records `seriesChanged` when there is none.

### The core-subject rule and the school fee

Both read the series' grade and academic year. `schoolFeeGateReason(studentId, eligibility)`:
the fee of the series' academic year at the series' grade; a graduate retaking under A-12 owes
none when A-13 (`schoolFee.graduatesExempt`) is on, or that year's uniform fee when off; a
series whose year has no schedule proceeds (A-14 `proceed`) or waits for it (`hold`).
`GET /v1/school-fees/status` and `POST /v1/school-fees/pay` take an optional `academicYear`
(`payableAcademicYears`: this year, and the next once its schedule exists), and the status
names `nextYear`, so a parent pays 2027/28's fee ahead for a November 2027 window.
`academicYearForDate` is now Cairo-based.

---

## 3. When eligibility changes after a registration exists

`expireIneligibleRegistrations(tx, scope, cause)` runs inside the change's own transaction:
waiting registrations (awaiting approval or payment) the student may no longer sit expire with
one `REGISTRATION_EXPIRED` row each (reason `ineligible`, `detail` = the cause), and pending
change requests on them are rejected with their rows. A registration held by a transfer being
checked, or by an InstaPay checkout inside its grace, is kept (the family may have paid). After
the commit `closePaymentsOfExpiredRegistrations` fails their open checkouts (escrow back,
`PAYMENT_FAILED`, the family told why); the recovery sweep catches anything it misses.

| Cause | Trigger | Scenario (08e / 08g) |
|---|---|---|
| `withdrawn`, `transferred` | `POST /v1/students/:id/leave` (coordinator, admin) | withdrawn with a checkout open; race |
| `cohort_corrected` | `PUT /v1/students/:id/cohort` (admin) | moved back a year |
| `graduate_retakes_off` | A-12 turned off (the setting's hook) | graduates' registrations pending; race |
| `series_corrected` | `PUT /v1/sessions/:id/series` (admin) | series corrected; race |
| `exception_revoked` | a grade-10 exception revoked | revoked; race |
| `exception_lapsed` | a grade-10 exception's `validUntil` passes (scheduler) | runs out; two instances at once |

A rejected transfer later releases a kept registration the student may no longer sit
(`failOpenPayment` expires it when the window is closed **or** the student is ineligible —
STATE_AUDIT SO-7), and checkout refuses it. `closePaymentsOfGraduatedStudents` and
`notifyPaymentClosedAtGraduation` were deleted once `08b`'s ST-04 scenarios (now triggered by
a withdrawal and a transfer) and `08e` showed nothing called them. Readmission
(`POST /v1/students/:id/readmit`, admin) revives nothing.

Preregistrations are left alone by the clean-up: a paid one holds money whose refund is the
owner's decision (SO-4). **At the series' opening the capture asks too** (inside its locked
transaction, `mayRegisterForInTx`): a preregistration of a student who may no longer sit the
series is neither confirmed nor moved to payment — it stays preregistered, its money held, one
`PREREG_HELD_INELIGIBLE` row (the reason, the amount held) and a notice to finance and the admin
(`PREREGISTRATION_HELD`), once. While the window is open, the recovery sweep asks again each
tick and captures it if the student may sit the series again (a readmission). **Nothing else
releases a held preregistration:** the family cannot cancel an opened series' preregistration
and the direct drop moves only confirmed subjects, so it stays preregistered, its money held,
until the owner decides (SO-4) — and after the window closes it stays held (no release path is
built, by the lead's decision). `08e` "withdrawn with preregistrations, then the series opens"
(a paid and an unpaid one), control C21, and `09`.

A leaver's **confirmed** registrations are untouched: only waiting ones expire.

---

## 4. Roles and capabilities

`coordinator`, `teacher` and `gate` (one role per user, as before). `lib/role-grants.ts` is a
global allowlist in `app.ts`: these roles reach only the endpoints listed there (self-service,
school information, and what a feature grants), because many older endpoints decide by role
inside the handler ("not a student and not a parent" reads as staff). Route gates still apply
on top. They never hold better-auth's admin `user` permissions (`permissions.ts`; `06` proves
each is refused at better-auth's admin endpoints).

| Role | F0a powers |
|---|---|
| coordinator | the academic structure (years, terms, calendar, bells, rooms, sections, roll-over), the student record, recording a student's leaving, the grade-10 exception, the school week setting |
| teacher | the school day and their own teaching (`GET /v1/teaching/me`) |
| gate | the school day (F2 adds the leave list) |
| admin | everything, except the parent-only actions that already refuse admin |
| finance officer / admin | as before, plus reading the student record and sections (the desk) |

**Teaching is a capability:** `teacher.user_id` links a teacher record to any staff account
(`PUT /v1/teachers/:id/account`, or the Team form: an existing record or a new one from the
account's name). A teacher account must be linked; any linked account gets "My teaching".
`authz-policy.tsv` has a column per new role on every row (39 new endpoints); `04` probes all
of them for all nine principals.

---

## 5. The settings store (contract)

`packages/validations/src/settings/settings.ts` declares each key: schema, default, group,
label, description, the roles that may change it (`editableBy`), how the screen offers it.
Values live in `school_setting`; a key never set reads as its default.

- `getSetting(key, executor?)` — the typed value.
- `updateSetting(key, value, reason, actor)` — refused (403) unless the actor's role is in
  `editableBy`, validated against the schema (400), a no-op refused (409); writes the value and
  `SETTING_CHANGED` (before, after, reason) in one transaction holding the key's lock; runs the
  key's hook.
- `onSettingChanged(key, { inTransaction, afterCommit })` — what a change sets off (A-12 off
  expires graduates' registrations in the transaction, closes their checkouts after).
- `lockSetting(tx, key, 'shared' | 'exclusive')` — hold a key while relying on it.
- `GET /v1/settings` (admin, finance, coordinator: every key with value, default, who may
  change it, `canEdit`), `PUT /v1/settings/:key { value, reason }`.

| Key | Default | Changed by | Stands for |
|---|---|---|---|
| `eligibility.graduateRetakes` | on | admin | A-12 |
| `schoolFee.graduatesExempt` | on | admin, finance admin | A-13 |
| `schoolFee.newYearWithoutSchedule` | `proceed` | admin, finance admin | A-14 |
| `calendar.schoolWeekdays` | Sunday–Thursday | admin, coordinator | the school week |

Adding a key (F2's policies, F3's thresholds, F4's centre numbers): one `defineSetting` entry;
the screen lists it for the roles that may read settings.

## 6. Uploads (contract)

`packages/validations/src/file/upload-purposes.ts`: every file has a purpose that decides its
types, size, who may upload it, whether it concerns a student, and who may read it back
(`owner`, `family` = the student and their approved linked parents, or named roles). The
magic bytes decide a file's type, and the stored name's extension is the detected type's, never
the uploader's (a PDF named `letter.exe` is stored as `.pdf`).

| Purpose | Upload | Read | Used by |
|---|---|---|---|
| `avatar` | anyone | owner | profile |
| `document` | anyone | owner (staff once attached as evidence) | legacy uploads |
| `payment_evidence` | parent | owner, finance, admin | InstaPay reference (closes O-5) |
| `remark_consent` | parent | owner, finance, admin | remarks |
| `supporting_document` | family, coordinator, finance, admin | owner, family, coordinator, finance, admin | leave, exceptions, withdrawals |
| `collector_photo` | parent, coordinator, admin | owner, family, coordinator, admin, gate | campus leave (F2) |
| `excuse_note` | family, coordinator, admin | owner, family, coordinator, admin | attendance (F3) |
| `import_file` | admin, coordinator | owner, admin, coordinator | day-one import (F7) |

- `POST /v1/files/upload` (form: `file`, `purpose`, `studentId?`) — refused to a role the
  purpose does not name, or for a student outside the uploader's family.
- `GET /v1/files/:id/content` — the bytes, under the purpose's read rule.
- Services: `uploadForPurpose`, `mayRead`, `getReadableFile`, `getFileContent`,
  `isAttachableEvidence` (a parent's own `payment_evidence`/`remark_consent`, or a legacy
  `document`, for that child).
- Storage: R2 in production (`packages/storage` `R2StorageClient`), a local directory in
  development and tests (`LOCAL_UPLOAD_DIR`, default `.uploads`, git-ignored). Production
  without R2 refuses uploads rather than writing to disk.

SECURITY_AUDIT.md O-5 is marked closed by this design.

## 7. Academic structure

Services in `academic.services.ts`, routes under `/v1/academic` (reads: all staff; writes:
coordinator and admin).

- Academic years inside 1 July – 30 June, one per start year; terms inside their year, never
  overlapping.
- `getSchoolDay(date)` → what the day is: a school day with its bell schedule, the weekend
  (the `calendar.schoolWeekdays` setting), a holiday, an early dismissal (with its time), an
  exam-only day, an extra school day, or between terms. F1–F3 read it.
- Bell schedules: a default and variants; each weekday's periods never overlap.
- Rooms: unique names; a room out of use is refused to a section.
- Sections per academic year and grade (homeroom teacher, room, capacity). Members must be in
  the section's grade that year; moving a student ends their previous membership the day
  before (history kept); leaving the school ends it. `sectionOf(studentId, year?)`.
- **Roll-over** (`POST /v1/academic/sections/roll-over`, preview then commit): each grade-10
  and -11 section becomes one a grade up in the next year with its teacher and room and the
  members in that grade then; grade 12 graduates; a repeater or a leaver stays for the
  coordinator. Idempotent (a target remembers its source) and serialized on the target year.

---

## 8. Screens

Staff first. Every string goes through `lib/i18n.tsx` (F0a's Arabic in
`lib/i18n-foundation/`); each screen was driven in headless Chrome in English and Arabic
(right-to-left), screenshots in `.audit/foundation-evidence/screens/`.

The academic, students, sections and teaching screens were built by two helpers (Opus 5.5)
and reviewed, driven and committed by the lead; each client file opens with its spreadsheet
comparison (UX_AUDIT §4). New screens are registered in `nav-shell.tsx`: the coordinator lands
on Today with Academic (Students, Sections, Academic year, Calendar, Bell schedules, Rooms) and
Settings; the teacher on Today and My teaching; the gate on Today; the desk gains Students;
the finance admin Settings; the admin all of them. "My teaching" appears for any account linked
to a teacher record.

| Screen | Route | Who | The spreadsheet version, and why this beats it |
|---|---|---|---|
| Today | `/today` | all staff | The bell sheet by the gate, the wall calendar and a call to the office ("is today the short day?"). One headline says what today is (school day, holiday, early dismissal, exam-only, weekend, out of term), the term and bells, the current period with minutes left and what is next. |
| Academic years and terms | `/academic/years` | coordinator, admin (staff read) | A workbook copied each summer, retyped; nothing stops overlapping terms. Every year on one screen, labels from the start year, dates held inside 1 July – 30 June, terms on a timeline with today marked; an overlap is refused beside the row. |
| Calendar | `/academic/calendar` | coordinator, admin (staff read) | Twelve month blocks coloured by hand and a legend. Each day already shows what it is (school week, terms, entries); a click asks the API; shift-click selects a range, so a week's break is two clicks, a name and Enter; school days counted per month and year. |
| Bell schedules | `/academic/bells` | coordinator, admin (staff read) | Bell times typed cell by cell, a second copy for the short day. "Fill a day in one go" from first bell, lesson count, length and breaks; Enter adds the next lesson; 815 becomes 08:15; a variant starts as a copy; a weekday can have its own rows; overlaps marked on the row. |
| Rooms | `/academic/rooms` | coordinator, admin (staff read) | A rooms sheet with free-text equipment. The add row keeps type, capacity and features, so identical classrooms are a name and Enter each; features are chips; rooms leave use rather than being deleted. |
| Students | `/students` | coordinator, desk, admin | A sheet per class plus a master list with a grade column retyped every September. Grade and standing derived; one box searches name, email or ID; "without a section this year" in one tick; "graduation inferred by the backfill" lists every cohort the migration inferred, for review; filters in the address; Enter opens the first match. |
| Student record | `/students/:id` (and the desk's "Academic record") | coordinator, desk (read), admin | The grade, class and "left" note live in three places. One panel: today's grade and standing, the cohort and its three years, this year's section (warning when a correction left it in the wrong grade), each open series with the rule's sentence, the section history, the record's changes; actions say beforehand what they will do and afterwards what happened. |
| Sections | `/academic/sections` | coordinator, admin (desk read) | A tab per class retyped each September. The year on one screen by grade with teacher, room and fill, and how many students still have no section; a section opens to a search already showing exactly those; several searches build one selection. |
| Roll-over | `/academic/sections` (roll-over) | coordinator, admin | A day of renaming tabs and deleting rows. A preview (new names editable, who moves, who stays and why, who graduates), then one click; running it again changes nothing. |
| My teaching | `/teaching` | any account linked to a teacher record | A printed class list corrected by hand. The live homeroom list with today's grades, and the subjects; an unlinked account is told who links it. |
| Team | `/admin/team` | admin | A staff list in a sheet plus a separate ask to IT for an account. One form makes the account, picks the role (with what it does) and links the teacher record; the grid changes a role or the link in place; students show grade and standing. |
| Settings | `/settings` | admin, finance, coordinator | Today a rule change is a message to a developer. One card per rule in plain words: current value, who last changed it, who may; a change needs a reason and is audited. |
| Sessions | `/admin/sessions` | admin | The window's series was implied by its name. The form suggests the series year from the type and start date and shows the academic year its grades are read in; a wrong series is corrected with a reason, and the result says how many waiting registrations expired. |
| Student 360 | `/desk` | desk | The officer's sheet row had a grade column that went stale every July. The header shows today's grade, section, standing and "started grade 10 in"; "Academic record" opens the record in place. |
| Home (student, parent) | `/` | families | A student who left, has no recorded grade, or is in grade 9 is told so; a graduate sees whether a retake window is open; parents see each child's grade and section. |
| Register | `/register` | families | The page says why a series is closed to this student (the rule's own sentence) instead of an empty list; core subjects lock by the series' grade. |
| Dashboard | `/admin/dashboard` | admin | Counts of students with no recorded grade (linked to the Students screen), grade 9 and left, beside the grade counts. |

---

## 9. Tests

| File | Proves |
|---|---|
| `08d-foundation-grade` | the boundary table (rows 1–10, each a test), unknown cohort, the 1 July instants in code and SQL, all 13 call sites, the grade-10 exception, the core rule by series grade, row 4's fee with and without a 2027/28 schedule, paying next year's fee, A-13, A-14, inputs, the cohort correction |
| `08e-foundation-eligibility-changes` | withdrawn (an InstaPay and an in-school checkout), cohort moved back, A-12 off, series corrected, exception revoked, an exception running out, readmission; a withdrawn student's preregistrations held at the opening; a draft's series refused under preregistrations and audited without |
| `08f-foundation-structure` | settings, uploads, years and terms, bells, the calendar day, rooms, sections, the teacher linked to a coordinator, the Team rules, the roll-over |
| `08g-foundation-races` | a registration racing a withdrawal, a transfer, a cohort correction, a series correction, a revoked grade-10 exception and A-12 turned off (forced order); a withdrawal landing first against the desk taking money, a preregistration, a swap approval and a direct swap (on a window of its own); two withdrawals, two A-12 changes, two placements, two roll-overs |
| `05` | uploads between families, eligibility between families, each exception type's roles in both directions, another class and the gate |
| `04` | every endpoint for every role, the three new ones included |
| `06` | the new roles refused at better-auth's admin endpoints; privilege fields (`cohortYear`, `leftOn`) cannot be injected at sign-up or profile update |
| `09` | an `ineligible` expiry must name its cause; nothing waits for a series its student may not sit (bar the clean-up's own holds: a transfer being checked, an InstaPay checkout inside its grace), and no preregistration was captured while its student was refused |

**Negative controls** (`.audit/foundation-evidence/controls.py`, one trail row each, naming
the commit they ran on): C01–C29, each fix undone once and shown red, then restored (C01
undoes both the check and its locked re-check: either alone still refuses). C21 capture
without eligibility; C22–C25 the locked re-check at the desk with money, a preregistration, a
swap approval and a direct swap; C26 a draft's series edited under preregistrations; C27 a
backfilled student recording their own grade; C28 the clean-up held by any open checkout (an
in-school one: 08e and 09 red); C29 a lapsed exception without the clean-up.
`grep -rn "NEGATIVE CONTROL" apps packages` returns nothing.

**Changed assertions** (each with its own trail row: old, new, why):
- `01` desk onboarding: the stored grade → cohort and derived grade (not money).
- `03` a refused January-IGCSE window: gains `seriesYear` (an input; the 400 is unchanged).
- `06` privilege injection: `grade` → `cohortYear`, `leftOn` (not money).
- `08b` ST-04 (pre-authorised): the trigger is a withdrawal and a transfer instead of manual
  graduation; every money outcome kept (expired, payment failed, escrow back to 1500,
  `PAYMENT_FAILED`, the family told) and extended (a rejected transfer then releases the
  registration: SO-7).
- `09`: the "every expiry says why" rule accepts the new reason `ineligible` and requires it to
  name a cause (not pre-authorised; the reviewer judged it sound and the lead kept it). The new
  eligibility invariant is added, not changed.
- Helpers feeding money scenarios (trail rows): `academicYearOf` now reads the academic year in
  Cairo (the API's rule), and `session()` derives the window's `seriesYear` from its start
  date, so each family keeps its onboarded grade in the suites' windows.

---

## 10. Decisions and why

- **Drop the column, don't rename it.** Type-checking had to find every reader; a renamed
  column would have kept compiling.
- **The grade is decided by the series, never the window's dates or today.** A November 2027
  window opening in June 2027 is grade 11 in 2027/28 (row 4).
- **Eligibility before the window** on checkout and swap paths: the family hears the reason
  that matters (a withdrawn student, not "window closed").
- **Uploads' `document` purpose stays owner-only** until attached as evidence, so nothing a
  family uploaded before F0a became visible to staff by the migration.
- **Global grants for the new roles** rather than per-route checks: older handlers treat any
  non-family role as staff.
- **A race between a registration and an eligibility change is closed, not accepted:** SO-2's
  twin, but here the stranded registration belongs to a student who may no longer sit the
  series. The same session lock would let the lead close SO-2 itself by re-checking the window
  inside the transaction (left to the lead: it is SO-2's status).

## 11. Deferred, and why

- **Pending swap requests on a paid subject of a student who left** stay pending; approving
  one is refused with the reason (call site 9). Rejecting them at the withdrawal would be
  tidier; it touches the change-request flow and was left for the lead's call (FEATURES_PLAN
  §7 lists this and the other narrowings).
- **Refund windows** still pick their academic year from the window's start date
  (`refund.services`); now that `academicYearForDate` is Cairo-based the two agree, but moving
  refunds to the series' year is a money change for the lead.
- **API refusal sentences** that carry a name, a date or a year have Arabic patterns for
  eligibility and the academic structure (`translateFoundationRefusal` in `lib/i18n.tsx`);
  other API errors stay English, as before F0a. Section end reasons and roll-over "why" texts
  are English sentences from the API that the screens translate by format; structured fields
  would be sturdier.
- **Students list:** `withoutSection` and the section name are this year's only, so adding
  students to a next-year section cannot filter "no section that year"; the calendar grid
  repeats the API's day rules in the browser (a range endpoint, `GET
  /academic/calendar/days?from&to`, would remove the duplicate). Both noted by the helpers.
- **Found, not F0a's:** every Arabic page logs a hydration mismatch (the I18nProvider reads
  localStorage during its first render — on origin/main too; the Next dev badge "1 Issue").
  The translator's month rule also rewrites month names inside other English API sentences.

## 12. Questions for the owner

- A-12, A-13 and A-14 are settings defaulting to the lead's interpretation (on, on, proceed);
  the owner can flip them on the Settings screen.
- Should a withdrawn student's paid preregistrations be refunded automatically (SO-4)?
- Is Sunday–Thursday the school week (the `calendar.schoolWeekdays` default)?

---

## 13. Progress log

- 2026-09-29 11:40Z — started from origin/main 7243da8; baseline suite green.
- 11:51Z — cohort model, SQL functions, backfill rules; backfill proven on two copies.
- 12:35–12:47Z — assertions in 01, 06, 08b, 09 moved (trail rows); graduation's closer deleted.
- 12:56Z — API suite green at cef4b16 in local time and UTC (217 passed, 1 todo).
- 12:58–13:01Z — controls C01–C18 red, restored.
- 13:24Z — web ported to the cohort; Team, Settings, Sessions (9ed8ac7).
- 13:35Z — backfill proven on a copy of `igcse_audit`.
- 13:48Z — registration-creating transactions re-check eligibility with locks; 08g races; C19,
  C20 red; 05 class and gate cases (ed2f0a0).
- 13:58Z — web check-types surfaced TS2742 once every screen compiled; the Eligibility answer's
  type moved to `@repo/validations`.
- 14:07Z — the helpers' screens reviewed, driven and committed (4276c24, 06a008e); the panel
  gains the exception's revoke; the student record's series carry `code`.
- 14:09Z — gates green at 06a008e: API and web check-types clean; the suite in local time and
  with `TZ=UTC`, 16 files, 226 passed, 1 todo each. Branch pushed; CI green.
- 16:00–16:50Z — the Opus 5.5 review's flags fixed: the capture holds an ineligible student's
  preregistration; the graduate backfill by month with an audit row per inference (proven on a
  fresh copy: May → 2023, November → 2022); a draft's series guarded; a student's own grade only
  at first setup; the 09 eligibility invariant; races for every creating path; controls
  C01–C27 re-run (C24/C25 bit once the swap races ran on an open window); FEATURES_PLAN §7's
  narrowings and STATE_AUDIT ST-04, ST-13, SO-4, SO-7 updated; Team, Settings and Sessions
  re-driven in Arabic.
- 16:55Z — gates green at 9c84172: check-types clean; the suite in local time and UTC, 16 files,
  236 passed, 1 todo each.
- 17:10–17:40Z — the confirmation's eight flags: held preregistrations described truly (no
  release path, SO-4); the backfill proof re-run at the current 0035 and the dev database
  rebuilt; 09 exempts only the clean-up's holds (C28 with an in-school checkout); a lapsed
  grade-10 exception cleaned up by a claimed scheduler step (C29); reviewed inferences leave the
  filter; 08g races a transfer and a cohort correction and its swaps use a window of their own;
  dates in the page language; controls C01–C29 re-run on 03cd5ee.
