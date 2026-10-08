# F1 — Scheduling: teaching groups, the timetable, cover (as built)

Branch `feature/scheduling`, started from `origin/feature/catalogue` 682907a (F0b, which brings
F0a), merged with `origin/main` at e5da650 once F0b landed (§14). The plan is
FEATURES_PLAN.md §1 "F1", its §2 row and §5's rules, with §0/§0b's "full versions" (the
generator **and** the aSc/FET exports). The trail is `.audit/scheduling.tsv`; evidence (suite
logs, control logs, screenshots, scratch scripts) is `.audit/scheduling-evidence/`
(git-ignored). The progress log is §15.

**Resumed 8 Oct 2026 on the reservations rework's model** (RESERVATIONS_REWORK.md §9's F1 list and
§10's F1 contract) and the second review round's flags: §17 says what changed, how each item was
checked against main's code, the lock order, and the proof. Merged with main four times on the
way (§14; a fifth, of trail rows only, after the review); F1's migrations are now `0056`/`0057`,
after main's `0055`. The Opus 5.5 review of
88898f6 (eight items, two material) is §17.5.

F1 gives the school what its sheet cannot hold: **who is taught together** (teaching groups
drawn from the course enrolment and the sections, with dated membership), **a week that is
checked while it is made** (every clash found with its reason before and after a move, and a
generator that places the whole week and says why a lesson will not go), **versions** that take
effect on a date and are kept, **every person's own week** (student, parent, teacher, room,
section; print, CSV, a phone calendar), and **cover** for an absent teacher.

---

## 1. Data model

All in `packages/db/src/schema.ts`; migrations `0056_scheduling.sql` (generated after main's
`0055_rework_messages_overdue_text`: every F1 table and column, the review round's and the
rework's included) and `0057_scheduling_leavings.sql` (custom, idempotent: the leavings of
students away when it runs, kept in `student_leaving`). F1 never shipped, so its tables start
empty and need no other backfill (the branch's earlier `0043` rebuilt group teachers for
databases that had F1's first migration; none is kept). The branch's migrations were
regenerated at each merge with main (0040 → 0041–0043 → 0050/0051 → 0055/0056 → 0056/0057, §14);
F4 (two migrations) and F7 (one) land first, so F1's merge renumbers them once more.

| Table | What it holds | Rules |
|---|---|---|
| `teaching_group` | a class taught together in one academic year: name, kind (`enrolment` from the course enrolment, `section` for a whole section, `manual`), subject, **unit** (an IAL paper taught on its own, the rework's enrolment key), teacher, **delivery** (`in_school`; `online`: timetabled, no room), **weekly periods**, **double periods**, room type and features needed, a fixed room, the group it was split from, `archived_on` | `section_id` iff kind `section`; a unit needs a subject and is never a section's; an online group has no room and no room needs; `double_periods × 2 ≤ weekly_periods ≤ 30`; one live group per name per year (case-insensitive) |
| `teaching_group_member` | a student in a group from `started_on` to `ended_on` (inclusive; open while null), the enrolment it came from, the subject and unit (denormalised: the group's), who added/ended it and why | one open row per (group, student); **one open group per enrolment key** — (student, unit, year) when the unit is set, else (student, subject, year), two partial unique indexes as RESERVATIONS_REWORK.md §10 keys enrolments; `ended_on ≥ started_on − 1` (an *empty stay*: a membership ended before its first day, kept as history) |
| `schedule_unavailability` | a teacher or a room unavailable on a weekday, at one period or all day, with a note | teacher xor room |
| `teacher_load_limit` | a teacher's most periods a day and a week, per year | one per (year, teacher) |
| `group_day_rule` | two groups kept on different days (a = b: a group's own lessons on different days) | ordered pair, unique |
| `timetable` | a version for a term: `draft` or `published`, `effective_from`, `based_on_id`, `revision` (every edit bumps it), who published and when, a note | a published row has its date and time (check) |
| `timetable_lesson` | a lesson card: group, number (`seq`), length 1 or 2, weekday and lesson period (null together = off the grid), room, locked | unique (timetable, group, seq); a locked card is placed |
| `timetable_generation_run` | each generator run: who, how long, input and output hashes, seed, steps, placed/unplaced/locked, measures before and after, the explanations, `applied` or `stale` | |
| `teacher_absence` | a teacher away from a date to a date (or some periods of one day), a reason (`sick`, `personal`, `training`, `school_business`, `other`), a note, cancelled | periods only on a one-day absence |
| `cover_assignment` | one lesson on one date: `assigned` to a cover teacher, `cancelled` (the lesson does not take place), or `removed` (history), the absence it rests on, the original teacher | **one live arrangement per (lesson, date)** (unique partial index); assigned has a teacher, cancelled has none |
| `calendar_feed_token` | a user's private calendar link: the token's SHA-256 (never the token), created, last used, revoked | **one live link per user** |
| `teaching_group_teacher` | who teaches a group from a date to a date (a row with no teacher: none from then), why, who set it | **one open row per group**; `ended_on ≥ started_on − 1`; `teaching_group.teacher_id` is the latest row's teacher |
| `student_leaving` | each time a student left (last day, kind, reason, when recorded) and came back (first day back, who, why) | one open leaving per student; `readmitted_on ≥ left_on` |
| `published_clash` | a clash in a published timetable a change after publishing caused and the coordinator went ahead with: version, student or teacher, the two lessons, from and to, the sentence, the cause, who and when | one person (student xor teacher) |

`cover_assignment` also keeps why a removed arrangement was removed (`removal`: `by_hand`,
`absence_withdrawn`, `cover_teacher_away`, `timetable_changed`) and the reason given.

A lesson's slot is (weekday, *n*-th lesson period of the year's **default** bell schedule). On a
date with another bell schedule (a short day), the *n*-th lesson period of that day's bells gives
its times; a lesson beyond the day's last lesson period is *not held* that day.

## 2. Who is in a group on a date (ST-16, SO-9)

`groupMembersBetween(groupIds, from, to)` (`scheduling-shared.services.ts`) is the one reader of
groups; for sections it reads F0a's module, where `sectionsBetween` / `sectionOn(studentId, date)`
/ `sectionsOn` (`academic.services.ts`, next to `sectionOf`) are the one reading of "which section
on a date" — the class list and the editor use them too, so F2 and F3 cannot diverge:

- **Enrolment and manual groups** read their member rows. **Section groups** read the section's
  membership (F0a), so moving a student between sections moves their section-taught lessons.
- **The later membership wins a shared day (ST-16).** F0a leaves both section memberships
  covering the day of a same-day move (`[joined, joined]` in 11A, `[joined, …)` in 11B); the
  reader gives that day to the one that started later (on the same start day, the one recorded
  later). The same rule holds for two groups of one enrolment key — one subject with no unit, or
  one unit; two units of one subject are two keys, so a P1 group never ends the same student's
  P2 group on a day (fixed 8 Oct, §17). F0a's rows are not changed.
- **Leaving wins (SO-9).** Nobody is in a group on a day they were away from the school — after
  their last day until the day they came back — and a membership they had been given before the
  leaving was recorded, starting after their last day, never begins (F0a clamps it to one day).
  Every leaving is kept (`student_leaving`), so readmission (which clears F0a's `left_on`) does
  not undo either; the student's own schedule says `left` for each day away.
- Writes keep the rows honest too: leaving the school ends every open group row in the same
  transaction (`endGroupMembershipsOnLeaving`); an enrolment ended or made self-study ends that
  subject's group row (`endGroupMembershipsForSubject`); a row that would end before it began
  becomes an empty stay. Adding a student who has left, or a move dated before the student
  joined their current group, is refused.

## 3. The engine and the generator

**The engine** (`packages/validations/src/scheduling/engine.ts`) is pure and shared by the API
and the editor, so the grid shows exactly what the server will refuse. It knows sixteen kinds of
clash, each with a sentence: `teacher_busy`, `students_busy` (groups overlap **by student**, not
by section: "9 students are in both Arabic 10C and Biology 10 at Monday Period 4"), `room_busy`,
`teacher_unavailable`, `room_unavailable`, `teacher_day_limit`, `teacher_week_limit`,
`room_type`, `room_features`, `room_capacity` (the group's largest size in the term), `room_closed`,
`room_fixed`, `no_room`, `same_day` (a day rule), `no_period` (a slot the bells do not have),
`double_split` (a double across a break). `evaluate` lists every clash and unplaced lesson;
`optionsFor` judges every cell for one picked lesson (green, or red with the reasons) and
`judgeMove` one cell — both from the lesson alone (2 ms a pick-up at the dev school's size),
proven equal to the whole-timetable evaluation on 3 990 lesson-by-cell checks
(`scratch/equivalence.mjs`). `measure` gives the soft goals: unplaced, same-day repeats,
teacher gaps, uneven teacher days, uneven student days.

**The generator** (`generator.ts`):
1. *Construction* — lessons in order of difficulty (doubles, fewest feasible places, most
   conflicting groups, largest), each at its cheapest feasible slot and room (a fixed room,
   then the group's majority homeroom, then a classroom for a group needing no special room,
   then the smallest that fits); a lesson with no feasible slot may displace up to two unlocked
   lessons that are re-placed elsewhere.
2. *Improvement* — simulated annealing over moves (a lesson to another feasible slot, two
   lessons of one length swapped, an unplaced lesson retried with displacement), keeping the
   best timetable seen. Every candidate is feasible before it is costed: hard rules are never
   traded for soft ones. Cost weights: unplaced 1 000 000, same-day repeat 40, teacher gap 6,
   uneven teacher day 3, uneven student day 0.5. Starting temperature 10, linear cooling,
   40 000 steps a lesson (at least 400 000, at most 4 000 000).
3. *Explanations* — each lesson left unplaced gets its reasons counted over every slot and
   summed into sentences ("teacher X is unavailable at every period", "Its students have
   another lesson at 22: …", "No room in use is a science lab seating 25").

**Locked lessons stay where they are.** A locked lesson on a slot the bells no longer have is
reported ("locked at a period the bell schedule does not have: unlock it or move it").

**Deterministic.** No clock and no `Math.random`: a seeded generator (mulberry32) whose seed is
a hash of the canonical input (lessons keyed by group and number, not row id, so a second draft
of the same term gives the same timetable); a fixed number of steps. The run records both
hashes. *Limit:* the input includes the groups' and teachers' ids, so the same school entered
twice in two databases gets two different (equally valid) timetables.

**Measured** (`08s2`, the plan's school: 9 sections, 8 teachers, 25 groups, 96 lessons, a
part-time teacher off on Thursdays): all placed with no clash in 2.7 s (limit 30 s); teacher gaps
26 → 2 and same-day repeats 4 → 0 against its own construction. The dev school (10 teachers,
41 groups, 114 lessons, 14 rooms): 3.1 s, all placed, 0 gaps, the same result twice. Three
schools on one grid (288 lessons): 2.8 s, all placed (the step cap). The tuning was measured
over eight seeds (`scratch/seeds.mjs`, trail row of 02:31Z): the first settings (30, 10 000
steps) gave teacher gaps from 2 to 10 depending on the seed; now 0 to 4.

**Concurrency.** The generator reads, searches outside any transaction, then writes only if the
draft's revision **and** its canonical input are unchanged; otherwise the run is recorded as
`stale` and the coordinator is told to run it again (08s4, control C2).

## 4. Versions and publishing

A term has any number of versions. A **draft** is edited (moves, locks, the generator) and may
start empty or as a copy of any version of the same year. **Publishing** takes a date inside the
term, today or later ("what has been taught is not rewritten"), refuses clashes, and refuses
unplaced lessons unless the coordinator publishes without them. The version in force on a date is
the latest published one effective by then. A published version never changes and is never
deleted; a new draft is made from it. Publishing notifies — through F0a's notifications, linked
to the right screen — the students in the changed groups, their approved parents (one notice per
parent naming their children) and the teachers; a first version tells everyone, a later one only
those whose groups' lessons changed. Groups follow the draft: forming, splitting, merging,
retiring or changing a group's weekly periods or doubles adds or removes that group's cards in
the drafts of every term not yet over.

## 5. Views and output

- **The reader** — `getScheduleRange(target, from, to)` for a student, teacher, room or section
  (at most 400 days) applies, per date: the school calendar (F0a `getSchoolDays`: holidays,
  weekends, out of term, exam-only days, early dismissal with its bell schedule), the version in
  force, membership on that date (§2), leaving, retired groups, the teacher's absences and cover.
  Each lesson: period(s), label, start and end times, group, subject, room, the teacher that
  day (cover applied) and the one timetabled, and a status: `scheduled`, `covered`, `uncovered`
  (teacher away, nothing arranged), `cancelled`, and in a teacher's view `covering` or
  `covered_by_other`. Lessons that a short day or an exam-only day drops are listed as *not
  held* with the reason.
- **Who may read what** (`assertMayRead`): a student their own; a parent an approved child's
  (else 404); the desk, coordinator and admin any student; a teacher their own teaching (else
  404); the coordinator and admin any teacher, room or section (others 403). A lesson's class
  list (`classListFor`) is the coordinator's and admin's, the group's teacher's, or the cover
  teacher's **on the covered date only**.
- **The calendar feed** — `POST /v1/schedule/feed` makes a private link (the token is shown
  once; only its hash is stored); a new link ends the old one; `DELETE` revokes it.
  `GET /v1/ical/<token>.ics` is anonymous (the token is the key; a wrong or revoked one gets a
  bare 404): the account's lessons (a parent's: each child's, prefixed with the name) from a week
  ago to the end of each term with a published timetable, at UTC instants computed in
  Africa/Cairo, with cover, cancellations (`STATUS:CANCELLED`) and RFC 5545 line folding.
- **Exports** (a version): **CSV** one row per lesson (whole school, or one section, teacher or
  room; cells that could run as a formula are quoted); **aSc XML** (periods, days, subjects,
  teachers, classes, groups, rooms, lessons and a card per placed lesson); **FET** (`.fet` with
  activities, students sets per group, the teachers' unavailability and daily maximums, preferred
  rooms, breaks, `MinDaysBetweenActivities` for day rules and for a group's own lessons, groups
  sharing students kept from overlapping, locked and placed lessons as preferred starting times).
- **Print** — every section, teacher or room on its own page (`/timetable/versions/<id>/print`),
  and each person's week prints on one page from their own screen.

## 6. Cover

The coordinator records an absence (teacher, one day with some periods or a range up to 120 days,
reason, note; overlapping absences refused). The lessons it leaves are listed at once, day by day,
each with its status. **Find cover** suggests teachers for one lesson: free and **qualified**
(linked to the subject, `subject_teacher`) first, then free but not their subject, then the rest
with why ("teaches Physics 11 then", "covers Arabic 10A then", "is away that day", "is not
available then", "would teach more than 6 periods that day"); when no teacher of the subject is
free it says so and points to cancelling. **Assign** refuses the lesson's own
teacher, an inactive, busy, away, unavailable, over-limit or unqualified one, and a lesson that is
not held that day or whose teacher is not recorded away; the lesson may instead be **cancelled**.
The cover teacher is notified (link to Today) and the class is told (covered: who takes it;
cancelled: that it does not take place). Removing a cover keeps it as history; withdrawing an
absence removes its covers. **Log**: every arrangement in a date range. **Report**: per teacher,
lessons missed, covered by others, and cover given; as CSV.

## 7. Roles and endpoints

The coordinator and the admin own groups, rules, timetables and cover (`/v1/scheduling/*`,
`/v1/timetables/*`, `/v1/cover/*`: rows `D D D D D A A D D` in `authz-policy.tsv`). Everyone signed
in reaches `/v1/schedule/me/day|week` and the feed; students, parents, the desk, the coordinator,
the admin and teachers reach `/v1/schedule/day|week` and the handler decides whose (§5);
`/v1/schedule/lesson` (a class list) is staff-only at the gate and the handler decides which
staff; `/v1/ical/:token` is anonymous. 49 endpoints (48 in the first round, then
`GET /v1/timetables/clashes`), each with a policy row; 05 has one F1 case covering another
family's child, another class's lesson, a cover teacher outside the covered lesson and date, the
gate, a wrong or revoked feed link, a banned account's link (revoked by the ban, and refused on
the request for a ban written outside the admin form) and a deactivated teacher record's link. `role-grants.ts` gives the
coordinator the F1 prefixes and teachers the read endpoints.

## 8. Contracts for later features (F2, F3)

From `apps/api/src/services/schedule.services.ts` unless noted; types in
`@repo/validations` (`DaySchedule`, `LessonOnDay`, `LessonStatus`, `NotHeld`):

- **`getScheduleFor(target, date): Promise<DaySchedule>`** with `target` `{ studentId }` or
  `{ teacherId }` — the plan's `getScheduleFor(studentId | teacherId, date)`, an object so a
  student's and a teacher's ids cannot be confused. Lessons with period(s), label, times, group,
  subject, room, teacher (cover applied), scheduled teacher, status and cover; `note` says why a
  day has none (`holiday`, `weekend`, `out_of_term`, `no_academic_year`, `exam_only`,
  `no_timetable`, `left`, and since the review round `extra_day`: an extra school day on a weekday
  the timetable has no lessons); `notHeld` lists lessons a short or exam-only day drops. The
  teacher of a lesson is the group's teacher **on that date** (a change of teacher does not reach
  back); a lesson is someone's to cover only on the version in force that date. New in the review
  round and additive: `LessonOnDay.needsNewCover` (true when the lesson is `uncovered` because the
  teacher given its cover is away themselves).
  *F2 (campus leave):* the lessons between the leave time and the return are the ones whose
  `startsAt`–`endsAt` overlap it. *F3 (attendance):* expected presence is the student's
  lessons that day; an `uncovered` lesson has nobody to take its register.
- **`getScheduleRange(target, from, to)`** — the same for a range (≤ 400 days), also for
  `{ roomId }` and `{ sectionId }`.
- **`lessonAccess(viewer, lessonId, date)`** → `'staff' | 'teacher' | 'cover' | null` — who may
  act on a lesson that date (F3: take its register); `'teacher'` means the group's teacher **on
  that date**. **`classListFor(viewer, lessonId, date)`** — the lesson's students that date with
  their section (`sectionOn`; 404 for anyone else). `lessonOnDate(lessonId, date)` now also
  returns `teacherId`, the teacher that date.
- **Who is where** (`academic.services.ts`): `sectionOn(studentId, date)`, `sectionsOn(ids, date)`,
  `sectionsBetween(ids, from, to)`; `leavingPeriodsOf(ids)` and `awayOn(periods, id, date)`.
- **Who teaches** (`scheduling-shared.services.ts`): `groupTeachersBetween(groupIds, from, to)`,
  `teachersOn(groupIds, date)`, `groupsTaughtBetween(teacherId, from, to)`.
- **Today** (`apps/api/src/lib/clock.ts`): `todayAtSchool()` and `now()` — the school's today for
  every date rule (a test run may move it; nothing over HTTP can). F2 and F3 should read today
  from it so their scenarios can stand inside a term too.
- **A change after publishing** (`timetable-clash.services.ts`): `guardPublishedTimetable(tx,
  { studentIds, teacherIds }, from, { anyway, cause, actorId }, change)` — wrap any new path
  that moves students or teachers between lessons (F2 does not; F7's import will).
- **`groupMembersBetween(groupIds, from, to)`** (`scheduling-shared.services.ts`) — membership
  as date intervals with §2's rules.
- **`getSchoolDays(from, to)`** (`academic.services.ts`, extended from F0a's `getSchoolDay`) —
  the calendar for a range in a few queries.

**On the rework's model (8 Oct, §17)** — RESERVATIONS_REWORK.md §10's F1 row, as built:

- **`getTeachingDemand(academicYearId)`** (`enrolment.services.ts`) — per (subject, unit,
  teacher) the students taught in school this year, with `delivery` (the teacher's mode on the
  item that names them, else on the offer, the year's sessions latest first; `in_school` when no
  offer names them), the teacher's kind (`provider`: no lessons) and the unit's code and name.
  Self-study forms no group; "no preference" is a row with `teacherId` null.
- **The group follows the enrolment** — `upsertEnrolments(tx, yearId, rows, actorId, { source,
  commit, follow, reason, lockStudents })` (`enrolment.services.ts`): with `follow`, an open
  enrolment of the same key with another teacher or mode is updated (`ENROLMENT_UPDATED`) and
  every enrolment made or updated is handed to **`followEnrolments(tx, changes, actorId, ctx)`**
  (`group.services.ts`) in the same transaction (`'defer'` returns the `changes` for a caller
  that hands several over at once). B's `changeLineTeacher` (now `changeLineTeacherTx` inside,
  the line's keys from `lineEnrolmentUnits`), A's `replaceTeacher` (`lockStudents: false`, §17)
  and F0b's `updateEnrolment` go through it. It returns `groupsFollowed`: `left`, `moved`,
  `groupsGiven`, `waiting` (each with `why`) and `coversLost`; the caller calls
  `groupFollowNotices(outcome)` after its commit (cover lost is told). The rules: self-study now
  → out of the group after today; every open member of the group now with one teacher → the
  group's teacher changes (dated, from the year's default start; guarded as any change after
  publishing) and the group takes that teacher's delivery from the offers (online: its room needs
  and its draft lessons' rooms go); otherwise, **or when that change is refused** (a clash in a
  published timetable, a provider) → each student into the smallest live group of the key whose
  teacher today is the new one, under the move's own check; none, or a move that would add a
  clash → the student stays and waits, with the reason. **A desk or admin change never fails for a
  timetable reason.** Its callers hold the students first (§17.3).
- **Who waits** — `groupsWaiting(academicYearId)` (`GET /v1/scheduling/groups/waiting`): students
  enrolled with another teacher than their group's (with the group to move to, if one exists),
  groups whose every member now has another teacher, and "no preference" per subject or unit
  with the teachers its lines may take. **No preference assigned** — `assignGroupTeacher`
  (`POST /v1/scheduling/groups/assign-teacher`): B's line rules in the caller's transaction (one
  `LINE_TEACHER_CHANGED` per line; a refused line reported by name with B's reason), then the
  groups follow once; one `TEACHING_GROUP_TEACHER_ASSIGNED` row.
- **For step D's teaching-group audience** (RESERVATIONS_MESSAGES.md §2): **`studentsOfGroup(groupId,
  date = today, executor)`** (`group.services.ts`) — the students in a group on a date by §2's
  rules — with `listGroups(academicYearId)` for D's picker. D reads the course enrolments
  (`getTeachingDemand`) until F1 is on main and switches to these then.
- **A change after publishing** (changed in round two) — `guardPublishedTimetable(tx, persons,
  from, { anyway, clashToken, cause, actorId }, change)` and, for a change that is not one
  function, `checkpointPublished(tx, persons, from)` then `.settle(opts)`: refused (409) with the
  clashes it adds and `[confirm <code>]`; going ahead needs `anyway` **and** the code of exactly
  those clashes (`clashConfirmation`), else it is refused again with the list as it is now. The
  web reads it through `components/published-clash.tsx` (`clashMessage` hides the code,
  `goAheadWith` sends it back).
- **Step D's `studentsOfGroup`** has its scenario now (08s6, "step D's contract"): a move that day goes
  to the later group, a leaver is out after their last day, a section's group follows the section.
- **For F2 and F3**: `LessonOnDay.delivery` (`in_school` | `online`, added 8 Oct): an online lesson
  has `room: null` and says Online in the week, on Today and in the phone calendar
  (`LOCATION:Online`); a provider's group has no lessons, so no register is expected for it. `groupMembersBetween` keys a shared day per enrolment key (§2).

## 9. Screens

Each replaces a part of the coordinator's sheet (UX_AUDIT.md §4: the Excel version, then ours).
Navigation: a **Timetable** section for the coordinator and the admin (Timetables, Teaching
Groups, Timetable Rules, Cover); **My Timetable** for students; **Timetables** for parents;
teachers see their day on **Today** and their week on **My Teaching**.

- **Timetables** (`/timetable/versions`). *Excel:* `timetable v3 final (2).xlsx`, a copy per
  change, and nobody sure which one is on the wall. *Here:* a checklist before the first
  timetable (terms, the default bell schedule, groups — with how many lack a teacher — and the
  optional rules, each a link); per term, its versions with state (Draft, In force, Scheduled,
  Replaced), the date each takes effect, placed/total; a new draft, or a copy of any version, in
  one form.
- **The editor** (`/timetable/versions/<id>`). *Excel:* one coloured grid per section tab; a
  teacher double-booked is found by eye across nine tabs, or by the teacher on Sunday morning.
  *Here:* one grid seen by **section, teacher, room or student**, or **the whole school** (every
  section's lessons in one table); five measures on top (placed, clashes, same-day repeats,
  teacher gaps, uneven days). Pick up a card (click, or drag): every cell turns green or red and
  pointing at a red cell says why, before anything moves; drop or click to move; Escape puts it
  back. A move that would clash is refused with the sentences, or placed anyway on a second
  confirmation and then listed as a clash. The picked lesson's panel: teacher, students,
  lesson *n* of *m* (double), its slot, the room (a select of suitable rooms), Lock here, Take
  off the grid. Off-the-grid cards below the grid. **Generate** (a dialog: what it does, how
  many lessons; then placed *n* of *m* in *t* s and each unplaced lesson's explanation), the
  **last generation** panel (measures before and after), **Publish** (date, note, publish
  without unplaced lessons), exports (CSV, aSc XML, FET) and Print. A published version opens
  read-only.
- **Teaching groups** (`/timetable/groups`). *Excel:* a column of names per subject copied from
  class lists each September, and sets rebuilt by hand when a student changes teacher.
  *Here:* **From the course enrolment** — a preview (groups to make or update, students to add
  or remove, students whose enrolled teacher differs from the group's) and one click to commit;
  running it again changes nothing. **Taught to whole sections** — Arabic or Religion for every
  section in one click. A group by hand. Each group's row: subject, teacher, size, weekly
  periods, doubles, room needs (edited in place). **Details**: its members with their dates,
  add, end, split into parts (each with its teacher), merge others into it, retire — history
  kept.
- **Timetable rules** (`/timetable/rules`). *Excel:* "Omar is part-time, not Thursdays" in
  someone's memory. *Here:* per teacher the most periods a day and a week and the periods they
  cannot teach (a week grid, whole days in one click); per room the periods it is out of use;
  pairs of groups kept on different days.
- **Cover** (`/timetable/cover`). *Excel:* the staffroom whiteboard — look up the absent
  teacher's lessons in the timetable file, then scan every other teacher's column for a free
  period, then phone them, then tell the class. *Here:* **By day** — record an absence (three
  fields), its lessons listed at once with status; **Find cover** per lesson ranks the free
  qualified teachers first with the reasons for the rest; **Assign** or **Cancel the lesson** —
  the cover teacher and the class are told. **Log** and **Report** (a date range; CSV). Three
  clicks a lesson, nothing to remember.
- **Print** (`…/print?view=section|teacher|room`): every section, teacher or room one to a page.
- **My timetable** (student) and **Timetables** (parent, a tab per child): the week as it will
  run — holidays, short days, exam-only days, cover and cancellations — week by week, printable
  on one page, and **In your phone's calendar** (make, copy, replace or revoke the link).
- **The teacher**: **My lessons today** on Today (tablet-first: each lesson with its time,
  room, status — covering, covered by someone else, cancelled — and a tap opens the class list
  with sections), and the week on My Teaching.
- **The student record** (desk, coordinator, admin): the student's week under the academic
  panel, as the family sees it.

All strings are in `apps/web/lib/i18n-scheduling.ts` (Arabic; sentences with names, numbers and
days as patterns, English names inside them wrapped in Unicode isolates so they read as one
unit right to left); checked right to left (`.audit/scheduling-evidence/screens/ar-*.png`). The
screens use the shared components and the project's tone colours; no `useQuery` generic was
added (32 in the app).

## 10. Tests

`apps/api/test/08s1-scheduling.test.ts` (groups, clashes, publishing, versions, the calendar,
views, sections on a date, leaving, the feed, exports), `08s2-scheduling-generator.test.ts`
(the generator at the school's size), `08s3-scheduling-cover.test.ts`,
`08s4-scheduling-races.test.ts`, `08s0-scheduling-engine.test.ts` (pure: the editor's per-cell
judgement equals the full evaluation; the generator's two kinds of unplaced lesson),
`08s5-scheduling-review.test.ts` (the review round, §16), one F1 case in
`05-object-access.test.ts`, and `09b-scheduling-invariants.test.ts` over every row the suite
leaves. Each suite takes an academic year 20–30 years ahead so no other suite's calendar can move
its lessons; where a rule depends on today, the test clock puts the school on a day inside one of
its terms (`setClockForTests`).

| Scenario (plan) | Test |
|---|---|
| groups from enrolment excluding self-study | 08s1 "groups from enrolment excluding self-study: a preview, a commit, and a second run that changes nothing"; "a student no longer taught a subject in school leaves its group…" |
| each clash type detected | 08s1 "each clash type detected: refused before the move with its reason, listed after it when placed anyway" (all sixteen kinds) |
| the generator at school size within the time limit | 08s2 "a school-sized input (9 sections, 8 teachers, 25 groups) placed in under 30 seconds with no clash — by the engine and by the rows" |
| deterministic (two runs, same result) | 08s2 "deterministic: the same draft generated again, and a second draft of the term, give the same timetable" |
| respecting locks | 08s2 "locked lessons stay where they are; the rest is placed around them" |
| explaining an impossible lesson | 08s2 "explaining an impossible lesson: a teacher away every day, a room that does not exist — the rest still placed" |
| publish notifying | 08s1 "publish refuses clashes, dates outside the term and unplaced lessons; then notifies students, parents and teachers…", "a second version from a later date: only the people whose lessons changed are told…" |
| cover refusing an unqualified or busy teacher | 08s3 "a cover assignment refusing an unqualified or busy teacher; then assigned, the cover teacher and the class told" |
| a parent sees only their child's timetable; a teacher only their own | 08s1 "a parent sees only their child's timetable; a teacher sees only their own…"; 05 F1 case |

Also: the soft goals measured (08s2), the calendar (holiday, weekend, short day, exam-only day,
between terms), ST-16 and SO-9 with the class list, a student leaving while in a group, the feed
(Cairo times, replaced link, revoked link), the three exports, cover on a date only, cancel and
re-assign, withdrawing an absence. **Races** (forced order with row or advisory locks held from
the test): two editors moving two lessons of one teacher into one period; the generator against
a move; one draft published twice; one lesson given cover twice; one teacher given two lessons
at once; forming the year's groups twice. **09b** checks every published timetable (no teacher,
room or student twice in a period on any day they are in both groups; effective inside its term;
whole slots; locked means placed), drafts' cards against their groups, members against leaving
and subjects, cover (one live per lesson and date, never the lesson's own teacher, never two at
once, always resting on an absence), one live feed link per account.

**The rework and round two (8 Oct)**: `08s6-scheduling-rework.test.ts` (22 scenarios through the
typed client, on its own years): the teaching demand per unit with delivery; forming per unit,
an online group without a room, a provider's group with no lessons (and refused periods, a
published group never given to one, a group given to one later losing its draft cards); a
student in two units of one subject counted in both groups and both lessons in their week; a
line's teacher changed at the desk reaching the group of its unit; A's replace-teacher moving
the June P1 group whole and not the winter P2 group; no preference assigned (a teacher outside
the line's pool refused by name, then line, enrolment and group follow); no group of the new
teacher (the student waits, then a group is made and they are Moved); a move clashing in the
published timetable (the desk's change stands, the student waits, the reason holds the clashes
and no confirmation); self-study leaving; the enrolment check per unit with the subject-and-unit
flag; round-two flags 1 (a dated clash in the grid, publish refused, a move refused, the
generator keeping the two apart), 2 (a carried cover lost inside the publication; a group's
teacher change removing the cover of its old teacher's absence), 3 (forced orders: a teacher
change against a publication both ways, two teacher changes for one teacher, forming against an
add of its student both ways and forming's re-read, cover against a publication both ways, a
line change against an add of the same student), 4 (a second generation refused, a cancelled one
writing nothing) and 5 (the roll-over refused with its code, then recorded). 08s0 gains flag 7 (a
student changing sets counted once); 08s5 sends the confirmation code; 09b gains a live cover never
against the cover teacher's own lesson, a member's unit equal to its group's, one open group per
unit or per subject, no published lesson of a provider's group, no room on an online group's
lessons, no draft card for a provider's group.

Controls of the resumption (rows in the trail, logs in `resume/controls/`), each red once and
restored: RW1 the follow-up made a no-op; RW2 the whole-group branch off; RW3 the follow-up's
published check removed; RW4 a provider's group given cards (green at first — forming already
gave none — until the "given to a provider later" scenario was added); RW5 an online group given
a room; RW6 the member key by subject only; RW7 the converted line's subject-level fallback off;
RW8 the subject-and-unit flag never raised; RW9 the waiting reason as the raw refusal; RW10
`groupMembersBetween`'s shared day by subject; RW11 every lesson read as in school; F1 no `teacherOverlaps`; F2a publishing not judging
carried covers (08s6 red; 09b's rule shown red with the suite stopped after that scenario, F2a-09b);
F2b a teacher change not judging cover; F3a–F3e the terms' share lock, the teachers' lock,
forming's student lock, forming's re-read, cover's term lock; F4a–F4b one generation per draft and
the cancelled request; F5a–F5b the confirmation code and the roll-over's checkpoint; F7 the
student load counted once. After the review of 88898f6 (§17.5): RV1a–RV1d the students first on A's
replace-teacher, its re-read, the enrolment's student first and the enrolments' lock mode; RV2 the
teacher `FOR NO KEY UPDATE`; RV3 cover after a teacher's rules change; RV5a–RV5b delivery per unit
and on handover; RV6a–RV6c the dated teachers' rules in the model, the generator and the grid; RV8
a refused whole group's members moving. 08s6 also has eleven forced races for it (§17.5, items 1,
2 and 4).

**Controls** C1–C17 (each guard undone once, its test red, restored; rows in
`.audit/scheduling.tsv`, logs in `controls/`): the draft lock; the generator's stale check; the
publish lock pair (the term lock and the draft's own lock are redundant for one draft — each
alone holds — and judging the status from a read before the lock publishes twice); cover's
lesson lock and its unique index (the index alone still refuses, in the database's words);
cover's teacher lock; forming's advisory lock (the forced order depends on it; the one-group-per-
subject index is the backstop); the stale-move check; later-wins; the leaving clip; the leaving
hook; the revoked-link check; cover's date limit; the qualification check; a parent's link; a
teacher's own record; publish's clash refusal; the generator's locks; the empty stay. Two
controls first came back green (the leaving clip and the leaving hook) — no test turned them
red — and 08s1 gained the assertions that do.

## 11. Decisions and why

- **Groups, not sections, are what is timetabled.** The school's sets cross sections (IS: "groups
  overlap by student"); a section-taught subject is a group of kind `section` that follows the
  section.
- **Membership is dated and never deleted.** A move, a split, a merge, a leaving each end a row
  and start another; the timetable of any past date is what it was.
- **A shared day goes to the later membership; leaving wins** (§2). F0a's own rows are left as
  they are; the rule is the reader's, so F2 and F3 inherit it.
- **One engine for the grid and the server.** The editor's green and red cells are the server's
  refusals, computed in the browser from the same code.
- **The generator never trades a hard rule for a soft one**, and a lesson it cannot place is
  left off the grid with the reasons rather than placed with a clash.
- **Deterministic by design**, so "Generate" twice does not reshuffle the week behind the
  coordinator's back; the seed is a hash of the input.
- **A published version is frozen and takes effect today or later.** Attendance and cover are
  recorded against the version in force; rewriting the past would move them.
- **Cover goes to a qualified teacher.** The plan's rule (`subject_teacher`); when none is free
  the lesson is cancelled (the owner question below asks about supervision).
- **The calendar link is a bearer token**, anonymous at the gate, stored hashed, one per
  account, replaceable and revocable.
- **The student record shows the week** so the desk can answer a family without switching
  screens (the desk comes first).
- **The group follows the enrolment, and the enrolment follows the line** (the lead, 8 Oct): one
  path for the desk, A's replace-teacher and the coordinator. **A desk change never fails for a
  timetable reason**: when the group cannot follow, the student waits on To place with the reason
  and one action (Move, Give the group, Assign) — the coordinator, not the desk, decides a clash.
- **Group keys are the enrolment's keys**: a unit when the enrolment has one, else the subject;
  pre-rework subject-level enrolments stay as they are, and one held beside unit enrolments of the
  same subject is flagged by the check with its fix named (the coordinator ends one or the other).
- **Delivery is the offer's**: the item's teacher mode, else the offer's, latest session first;
  an online group is timetabled without a room; a provider teaches outside the timetable, so its
  group has no lessons, and a group with published lessons is never given to one.
- **A dated teacher clash is the engine's** (`teacherOverlaps`): the grid, the generator and
  publishing judge it alike, from the day the change takes effect.
- **Going ahead with a clash after publishing needs the code of exactly the clashes shown**, so
  a confirmation never covers a clash nobody saw.
- **The student first, on every path** (§17.3): the order §2.1 set is kept by A's replace-teacher,
  F0b's enrolment change and end too, not worked around.
- **A teacher's dated interval brings their own rules**: a teacher who takes a group later in the
  term is judged by their unavailability and limits from that day (the engine's `teacherSpans`),
  as their double-booking already was.
- **A whole group refused its new teacher still lets its members follow**: each tries the move into
  that teacher's group before waiting (the lead's rule: "otherwise the student moves").
- **A waiting student's reason names the clashes only**: the confirmation belongs to the action
  that would make them (Move, Give), which asks for it itself.

## 12. Deferred, and why

- **A split after publishing**: the new groups are in no published timetable, so their students
  have no lessons for that subject until a new version is published (the split says so on the
  screen). Keeping them in the parent group's lessons until then would need the version to
  follow the split.
- **Leavings before the review round**: 0043 keeps the leavings of students away when it ran;
  a leaving already undone by a readmission before then is in the audit log only.
- **The editor judges a draft from today** (or its term's first day): a clash that ends before
  the date the draft will take effect still shows in the editor, and publishing (judged from its
  own date) is what decides.
- **Subject-less groups** (study skills, a manual group without a subject) may be covered by any
  free teacher: there is no subject to be qualified in.
- **aSc and FET files** follow the tools' published formats and are tested for their structure,
  not by importing them into aSc or FET (neither is available here); importing a timetable back
  from them is not built.
- **One-week timetables only**; a two-week rotation would need a week index on the lesson.
- **The generator's goals have fixed weights** and it knows no teacher preferences (preferred
  periods, most consecutive periods) or room-change minimisation; each could be a weight.
- **The whole-school print** is per section, teacher or room, not one sheet for the school.
- **Room and section timetables** are read by the coordinator and the admin only.
- **The desk is not shown why a group did not follow.** B's teacher change returns
  `groupsFollowed` with each waiting student's reason, but the desk's screen (B's) does not show
  it; the coordinator sees the student on To place with the reason. Showing it at the desk is B's
  screen to change.
- **Forming makes a group for a subject-level enrolment held beside unit enrolments** (a
  pre-rework row): the check flags the pair with its fix; forming does not judge it.
- **Families are not told when their group's teacher changes by the follow-up** (owner question 6
  still stands); the cover it loses is told.
- **The Arabic hydration error is not F1's** (§17): every screen that renders text on the
  server shows it when the language is Arabic before the page loads; `I18nProvider` (main's,
  since 30 May) is where it is fixed.

## 13. Questions for the owner (through the coordinator)

1. **Supervision cover.** When no teacher of the subject is free (on the dev school, Maths 11
   set 2 at period 4 on 30 September), may any free teacher supervise, or is the lesson
   cancelled? Today it is cancelled.
2. **Publishing late.** A first timetable published after the term has begun takes effect today
   at the earliest. Should it be allowed to take effect from the term's first day?
3. **Weekly periods and doubles per subject and grade**, and which subjects are taught to whole
   sections — the dev school guesses (four a week by default).
4. **The rooms**: which are labs, computer rooms or halls, and their seats — the room rules are
   only as good as this list.
5. **Cover limits**: should a teacher's cover lessons count against their daily maximum (they do
   today), and is there a weekly cap on cover?
6. **Mid-term teacher changes** are dated now (§16, flag 7); how often do they happen, and
   should the students be told when their teacher changes?
7. **What families see**: the cover teacher's name is shown to students and parents today.
8. **A split after publishing**: should the students moved into a new group keep the old group's
   lessons until a new version is published (today they have none for that subject; §12)?
9. **Going ahead with a clash**: the lead decided a change after publishing may go ahead with a
   clash on the coordinator's confirmation. Should the admin be told, or only the list kept?
10. **A student who waits for a group** (a desk change with no group of the new teacher yet, or one
    that would clash): the coordinator sees them on To place. Should the family be told that their
    timetable changes only when the coordinator places them?
11. **An IAL subject taught whole and by units at once** for one student (the check's flag): is
    that ever right (a student retaking one paper while taught the year whole), or always an
    error to fix?

## 14. Merging with main

Merged `origin/main` at e5da650 (F0b landed, with ST-15/ST-16 and the F8 plan update) in
cdfd046, no rebase. FEATURES_PLAN §3's protocol: the only conflicts were drizzle's meta files;
main's journal and snapshots were taken, `0040_scheduling.sql` and its snapshot deleted, and
`drizzle-kit generate --name scheduling` run again on top of main's `0040_catalogue_tier`:
`0041_scheduling.sql`, byte-identical to the old file (F0b touches none of F1's tables). F1 had
no hand-written migration to recreate. Proven on a database that already had main's
migrations — `igcse_scheduling_dev` recreated from the template, migrated with main's migration
folder (41 applied, no F1 table), then at the merged head (42, the eleven F1 tables) — and on the
suite's empty database (the full suite, local time and UTC). Trail rows are written with
`scripts/trail-row.py` from the merge on; 21 earlier rows written in batches now carry their
events' own times.

**The resumption's merges (8 Oct)** — four — each its own commit with two parents, made from lead-env
with `git merge-tree` (nothing in lead-env touched), the rework's side winning on the model:

1. `2a26557` (the rework's steps A, B, C and step 4) into `94e9d32` → `e8f669d`. Eleven files in
   conflict: FEATURES_PLAN.md (main's status rows, F1's row updated after), `app.ts` (both route
   sets), `05-object-access` (main's case, then F1's), `authz-policy.tsv` (main's rework block,
   then F1's), `i18n.tsx` (main's first, so its words win a shared phrase), the drizzle journal and
   the 0041–0043 snapshots (main's), audit and notification validations (union). F1's migrations
   were folded into one generated `0050_scheduling` and the custom `0051_scheduling_leavings`.
2. `c2d7a78` (step D) and `2858e25` (its plan update) into `7266f26` → `98443e9`: the policy,
   i18n, audit and notification files by union, the journal and snapshots main's; F1's migrations
   regenerated as `0055`/`0056`. A first commit named `2858e25` as parent while its files came
   from `c2d7a78`; it was never pushed, the ref was moved back and the merge redone (trail
   13:21:49Z); `merge.py` now refuses a parent its tree was not merged from.
3. `0acd8b5` (D's follow-ups, the messages merge; last migration `0055_rework_messages_overdue_text`)
   into `d450556`: only the journal and `0055`'s snapshot conflicted (main's); F1's migrations
   regenerated as `0056_scheduling` and `0057_scheduling_leavings`, stamped after main's. The dev
   database recreated from the template and migrated with main's folder (56, no F1 table), then
   F1's (58); the full suite green in local time and UTC (37 files, 619 passed, 1 todo) before the
   commit (a201282).
4. `061468a` (the lead's trail rows and FEATURES_PLAN.md's line queuing the Arabic hydration error
   under F6) into `eb823b2` → `bc471b3`: no conflict, no code; CI green on it (run 37818174482).
5. After the review's fixes (`759c066`): `5b911d2` (the lead's trail rows) → `681e98c`: no conflict
   (`.audit/school-forms.tsv` only), no code; CI green on it (run 37834144754).

## 15. Progress log

- 2026-09-29 23:53Z — started on `feature/scheduling` from `origin/feature/catalogue` 682907a;
  baseline suite green; dev database `igcse_scheduling_dev` from the template.
- 2026-09-30 00:26Z — the engine and generator, schema and migration 0040, groups, rules,
  timetables, views, cover, the calendar feed (af54ea4).
- 00:36–00:50Z — scenarios 08s1–08s4, the 05 case, 09b; suite green at 4ddc0c6 in local time and
  UTC (25 files, 322 passed, 1 todo).
- 00:57–01:08Z — the web: the editor, Timetables, Teaching groups, Rules, Cover, the family and
  teacher views, print, navigation (e51c2dc, e2f3290, ef006a1).
- 01:08–01:56Z — the dev school built through the Team page and the API (126 students, 9
  sections, 10 teachers, 41 groups, 114 lessons); driven in headless Chrome as the coordinator,
  a parent, a student and two teachers; fixes found by driving (rooms, pick-up speed, retired
  groups' cards, the publish confirmation, Today for non-teachers) (5da1e42).
- 02:07Z — Arabic and right to left over every screen (fd58ec3).
- 02:22Z — controls C1–C17; two guards found untested and the tests added (d389695).
- 02:31Z — the generator tuned after the logs showed its result varying with the seed (4406433).
- 02:35Z — the student's week on the student record (d47886a); this document.
- 02:42Z — merged `origin/main` (e5da650); the migration regenerated as 0041 (cdfd046); the
  batch-written trail rows retimed.
- 02:44Z — 0041 proven on the dev database at main's migrations, then at the merged head.
- 02:48Z — suite green at cdfd046 in local time and UTC (27 files, 348 passed, 1 todo).
- 02:53Z — the dev school rebuilt at the merged head and re-driven (a first timetable made,
  generated and published from the screens, cover, a parent, a teacher); cover says when no
  teacher of the subject is free (d45ee44). FEATURES_PLAN's F1 row and status updated.
- 03:00Z — the cover log ordered a lesson's arrangements on one date by when they were made
  (the local suite caught the tie once) (963779a).
- 03:05Z — gates at 963779a: suite green in local time and UTC (27 files, 348 passed, 1 todo),
  api and web check-types clean; pushed.
- 03:11Z — CI green on 80c60b4. The Opus 5.5 review of 9569dd9: twelve flags, don't merge yet.
- 04:46Z — review round 1, the code: shared readers, dated teachers, the published-timetable
  guard, cover carried over or lost, the worker thread, the clock, the explanations (085bd2c);
  migrations 0042 and 0043.
- 05:13Z — the scenarios for every flag; a version judged from its own date (56fe9a8).
- 05:17–05:27Z — controls R1–R12 (e82617d); claims corrected in the trail.
- 05:40–06:03Z — the web: go ahead anyway, a teacher from a date, published clashes, cover
  carried or lost, the unplaced kinds, Today; driven on the dev school in English and Arabic,
  three fixes found (0f42f60, 7a32ba2).
- 30 Sep 07:00Z — the second review round: eight flags (in the session log); the fixes written
  07:03–07:18Z and stopped by the spend limit before their tests. Frozen 7 Oct at 2c2a910.
- **8 Oct 2026**, resumed by a new Opus 5.5 implementer on the rework's model:
- 11:04Z — the round-two fixes found uncommitted, committed as found (94e9d32).
- 12:09Z — the lead accepted the five proposals (the follow-up through `upsertEnrolments`, keys,
  pre-rework rows, no preference, delivery).
- 12:23Z — merged `2a26557` (e8f669d).
- 13:03Z — the model and round-two flags 1–3 in code (0af8aef); a teacher's cover judged again when
  their rules change (7266f26).
- 13:16–13:21Z — merged `c2d7a78` and `2858e25` (98443e9), the first attempt's parent corrected.
- 13:42Z — 08s6 (22 scenarios), 08s0's flag 7, 09b's new rules (099b472); 13:43–13:56Z controls
  RW1–RW8 and F1–F7, all red.
- 13:58Z — `lockStudents: false` for A's replace-teacher (§17), `studentsOfGroup` for D, the web
  (d450556).
- 13:59Z — merging `0acd8b5`; 14:07Z and 14:13Z the suite green in local time and UTC.
- 14:11Z — the screens driven in English and Arabic; six findings. 14:19Z the Arabic hydration
  error traced to main's `I18nProvider` (not F1's). 14:23Z the badge, the editor's Arabic and the
  check's screenshots fixed and retaken.
- 14:30Z — the waiting reason without the confirmation, the assignment's outcome kept on To
  place; 14:32Z RW9 red.
- 14:36Z — the drive's group sizes led to `groupMembersBetween` keying a shared day by subject:
  reproduced (08s6 red), fixed per enrolment key (green 40 s later). The session limit stopped
  work 14:37–16:59Z. 17:00Z RW10 red.
- 17:04Z — no preference assigned and its outcome driven in English and Arabic ("now in" fixed).
- 17:17Z — the suite green in local time and UTC on the final code; the third merge committed as
  tested (a201282).
- 17:22Z — an online lesson says Online in the week, on Today and in the phone calendar
  (`LessonOnDay.delivery`); 17:23Z RW11 red; 17:24Z the student's week retaken.
- 17:37Z — the gates on the code committed next: check-types clean, the suite green in local time
  and UTC (37 files, 619 passed, 1 todo).
- 17:38Z — merged `061468a` (bc471b3); pushed; 17:51Z CI green on bc471b3 (run 37818174482); the
  trail row (88898f6).
- The Opus 5.5 review of 88898f6: "merge after fixes: 1, 2", eight items (§17.5); all done the same
  evening, each with a scenario and a control (times in the trail).
- 18:52–19:00Z — the fixes (items 1, 2, 5, 6, 8); 19:11Z 08s6 (39) and 08s0 green; 19:16–19:23Z
  controls RV1a–RV8 (RV1d green: redundant while the students come first), F3b, RW1–RW3 again;
  19:26Z a race found timing out under load during a control (5 s), three clean runs, waits raised
  to 20 s; 19:42Z the suite green in local time and UTC (637 passed, 1 todo); 759c066.
- 19:43Z — merged `5b911d2` (681e98c), pushed; 19:52Z CI green on 681e98c (run 37834144754).

## 16. The review round (Opus 5.5 review of 9569dd9; the lead's decisions applied)

Each flag, what was done, and the proof (scenario, control):

1. **Publishing left cover behind.** Publishing now moves each live arrangement dated on or
   after its date, on another version of the term, to its own same lesson (group, number, slot)
   or removes it (`timetable_changed`) and tells the cover teacher and the class; the
   confirmation lists both. A teacher's `covering` needs the version in force. 09b: a live
   arrangement's lesson is the one held that date. 08s5; controls R1 (red), R1b (red), R1c (the
   view rule alone: green, redundant while carry-over holds).
2. **A cover teacher later recorded away kept the duty.** Recording an absence removes the
   covers that teacher gives in it (`cover_teacher_away`); the lesson shows `uncovered` with
   `needsNewCover`, the class is told, the coordinator sees the list. 09b: nobody gives cover on a
   day they are away. 08s5; R2.
3. **Changes after publishing could put someone in two lessons.** Adding a student, merging,
   splitting, forming, changing a group's teacher and F0a's section move are checked from their
   date against the versions in force and scheduled: refused with the clashes, or — with
   "anyway" — recorded (`published_clash`) and listed on the Timetables screen with whether each
   still happens. 09b's student and teacher rules allow only recorded clashes (and read dated
   teachers). 08s5 (each path); R3 (the shared guard: red, and 09b red), R3b (the section path's
   wiring: red).
4. **The generator ran on the API's thread.** It runs on a worker thread
   (`generator-runner.ts`); the same input gives the same result. Measured on an infeasible
   school-sized input on the full 3.84M-step budget: 13 s (87 placed, 9 explained as impossible),
   the API answering in 3–10 ms meanwhile (08s2); scratch runs of three infeasible kinds 4.7–10.8 s.
   Under 30 s, so the budget stays. R4 (red: the pings waited).
5. **No scenario had today inside a term.** `src/lib/clock.ts` (test runs only); F0a's leaving and
   readmission and F1's date rules read it. 08s5: "today or later", a leaving part-way through a
   membership, a group retired by today, the version in force today. R5a–R5d (each red).
6. **Explanations.** "Cannot be placed" (no room of the kind, the teacher never free or over their
   week, students with more lessons than the week has periods) apart from "was not fitted in by
   the search" (places exist; each was taken), and every count "at N of the M periods". 08s0,
   08s2; R6; Arabic: `screens/ar-r6-cannot-be-placed.png`.
7. **A group's teacher is dated** (`teaching_group_teacher`); earlier weeks keep their teacher;
   the views, `lessonAccess`, the class list, cover and the publish notices read the teacher on
   the date; the Teaching groups screen asks from which day. 08s5; R7.
8. **Withdrawing an absence or removing a cover told nobody.** Both now tell the cover teacher
   and the class (`COVER_CHANGED`). 08s5; R8.
9. **The feed served banned or deactivated accounts.** Refused on the request for a banned
   account and for a deactivated teacher record's teaching; the admin's ban revokes the links.
   05; R9a–R9c.
10. **Claims corrected**: the five room kinds are now shown listed after a forced move (08s1);
    the 03:00:03Z row's evidence kept (`suite-3eea725-local-failure.txt`, from the transcript);
    C3 and C6 said to go red by the harness timeout, with what holds named; §7 counts 49; the
    editor's per-cell judgement is a test (08s0: 3 360 cells equal to the full evaluation; R10e).
11. **One "which section on a date"**: `sectionsBetween` / `sectionOn` / `sectionsOn` next to F0a's
    `sectionOf`, used by the groups, the class list and the editor. R11.
12. **Smaller gaps**: leavings kept through readmission (R12a, R12b); an extra school day says
    `extra_day` (R12c); Today reads whether the account teaches through a query and shows a
    failure as one instead of an empty `catch`.

Found on the way: publishing judged a version by who was in its groups over the whole term, so a
student who left a group before the version's date made it clash; a version is now judged from
the day it takes effect.

## 17. On the rework's model, and the second review round (8 Oct 2026)

### 17.1 RESERVATIONS_REWORK.md §9's F1 list, item by item

Each was checked against main's code at `2a26557`, `c2d7a78` and `0acd8b5` (the merges, §14), not
only the plan:

- **`course_enrolment.unit_id`** — main's (step A): one open row per (student, unit, year) when the
  unit is set, else per (student, subject, year), two partial unique indexes. F1 reads it as is.
- **`teaching_group.unit_id` and `delivery`** — F1's (§1): checks that a unit has a subject and no
  section and that an online group has no room. Proof: 08s6 "forming makes a group per unit and
  teacher…" (the online group's lessons have no room; the provider's group none); controls RW4, RW5.
- **One open group per (student, subject, unit, year)** — as the enrolment's two keys (the lead's
  "mirror A's keys"): the member's unit is its group's (09b), `sameKey`/`memberKey` in every
  membership path, and the shared reader's later-wins rule per key (fixed 8 Oct: it was per
  subject, so a student in P1 and P2 groups was read in one). Proof: 08s6 (P1 and P2 both count the
  student, their week has both); RW6, RW10.
- **`getTeachingDemand` per (subject, unit, teacher)** with `delivery` and the teacher's kind (§8).
  Proof: 08s6 "getTeachingDemand groups per subject, unit and teacher…".
- **`endGroupMembershipsForSubject` and `checkEnrolments` take the unit** — leaving self-study ends
  only that unit's group; the check pairs a unit line with its unit's enrolment and flags a subject
  held whole and by units at once, the fix named. Proof: 08s6's self-study and check scenarios; RW8.
- **A line's teacher, its change or its replacement reaches the group through `upsertEnrolments`**
  (§10's row) — B and A wrote `course_enrolment` directly; asked of the lead and decided (trail
  12:09Z): `upsertEnrolments`' `follow`, F1's `followEnrolments` (§8). Proof: 08s6's desk change,
  A's replace-teacher, the clash and the no-group scenarios; RW1–RW3, RW7.
- **"No preference" is an enrolment with no teacher until assigned** — a no-teacher group per
  subject or unit, listed under To place with Assign. Proof: 08s6's no-preference scenario;
  screenshots `en-11`/`en-12`, `ar-11`/`ar-12`.

### 17.2 The second review round's flags

1. **Dated teacher clashes across intervals** — the engine judges `teacherOverlaps` (pairs of groups
   one teacher has on a common day, from that day): the grid, the generator and publishing alike;
   publish's separate check and its own "anyway" went. 08s6 "a teacher change dated inside a draft's
   time…"; control F1; screenshots `en-03`/`ar-03` (the grid's sentence "… from 1 November 2026").
2. **Carried covers re-checked after a change** — `recheckCovers` inside the publication's
   transaction for every cover it carries, and after a group's teacher change or a teacher's rules
   change from that day (`whyCoverNoLongerHolds`; removal `no_longer_holds`, audited, told). 08s6's
   two cover scenarios; 09b's rule; F2a, F2a-09b, F2b.
3. **Lock and race tests for memberships and covers** — the order in §17.3, and 08s6's forced
   orders (held locks from the test, both orders where both exist); F3a–F3e.
4. **One generation per draft; a cancelled request writes nothing** (found committed): 08s6; F4a, F4b.
5. **The roll-over checked as any move; the confirmation code** (found committed): 08s5, 08s6; F5a, F5b.
6. **0043's group-teacher rebuild** — moot now: F1's tables are created empty (§1).
7. **A student's load counted once across sets** (`studentPeriods`): 08s0; F7.
8. **Today's readers on `todayAtSchool()`** — kept.

### 17.3 F1's locks in RESERVATIONS.md §2.1's order

§2.1's first rule holds for every F1 path: **the student first**, before anything else the path
takes. Then the path's own rows in §2.1's order (lines, then enrolments), then F1's:

1. **The students** `FOR NO KEY UPDATE` in id order — a membership change's own (`lockMembershipChange`),
   F0b's enrolment change and end (`enrolmentForChange`: the enrolment's student, then the enrolment),
   A's replace-teacher (the students of its lines, before the session and the offer, re-read after
   the offer lock and run again with a newcomer locked first: `lib/student-locks.ts`), B's desk
   change (`FOR SHARE`, A's order) and `upsertEnrolments` (`FOR SHARE`). Forming and section groups
   first take the year's advisory lock `teaching-groups:<year>`; no path takes it after a student.
2. **The enrolments** `FOR NO KEY UPDATE`: only their teacher, mode or end changes, so a member row
   naming one (`FOR KEY SHARE` through its foreign key) never waits on it.
3. **Teaching groups** `FOR UPDATE` in id order, then **their member rows** `FOR UPDATE` in id order.
4. **The running terms** `FOR SHARE` in id order (the published check: a publication, which takes
   its term `FOR UPDATE` and then the draft, waits for the change or is seen by it), then **the
   teachers** concerned `FOR NO KEY UPDATE` in id order: two changes giving one teacher lessons wait
   for each other, while a row naming the teacher that the caller wrote first (a line, an
   enrolment, an offer's teacher: `FOR KEY SHARE`) does not block it.
5. Behind the terms, **the change's own rows**: the group's teacher rows, the covers `FOR UPDATE` in
   id order (`recheckCovers`) and the drafts' cards (`syncDraftCards`). A publication reaches the
   same drafts and covers only after its term lock, so the two never hold them crosswise.

Cover's own path: the lesson `FOR UPDATE`, the term `FOR SHARE`, the cover teacher `FOR UPDATE`, then
the cover rows. The generator holds a session-level try-lock `timetable-generate:<id>` outside any
transaction (a second run is refused, not queued).

**Corrected after the review of 88898f6** (§17.5, item 1): this section first said A's
replace-teacher could keep "lines before students" by passing `lockStudents: false` to
`upsertEnrolments`. That read §2.1 backwards: its rule is the student first, everywhere. Without the
students, the replacement, F0b's enrolment change and its end held a line or an enrolment and then
wanted a group or member row whose foreign keys share-lock the student and the enrolment — the
reviewer reproduced "deadlock detected" with two sessions, and the lines-then-enrolments order
against F0a's leaving (the student, enrolments, then lines) was the same cycle. `lockStudents` is
gone; each of these paths takes its students first now, and §17.5 names the races that prove it.

### 17.4 Found while driving the screens

- The groups list counted a student in P1 and P2 of one subject in one group only — the shared
  reader's key (17.1); fixed at its cause, so sizes, weeks, clash checks, class lists, the
  generator and D's `studentsOfGroup` are right together.
- An assignment's outcome vanished with its form; it stays on To place now, with who waits and
  why (the clashes only, no confirmation code).
- The unit badge read "UnitP1"; the editor's problem lines and "1 students" had no Arabic; "in"
  before a group read "after" in Arabic (the shared dictionary's "in" is "in 5 min").
- A student's online lesson showed only its teacher: nothing said it was online. Each lesson now
  carries its group's delivery (§8).
- **The Arabic hydration error is main's**: `I18nProvider` reads the language from localStorage
  in its first client render while the server rendered English; pages F1 never touched show it
  too (`/sign-in`, `/academic/years`, `/academic/rooms`, `/today`), English never does. Not
  changed in F1.

The evidence: `.audit/scheduling-evidence/resume/` — the merges' suite summaries, `controls/`
(RW1–RW10, F1–F7), `unit-key-red.txt` / `unit-key-green.txt`, and `screens/` (English and
Arabic; placeholders only: Teacher A–F, Provider One, Students and Parents 0–10).

### 17.5 The review of 88898f6 (Opus 5.5): eight items

The reviewer re-ran 88898f6 (619 passed in both time zones), confirmed the thirteen items, found no
cycle against A's moves, B's paths, C's desk or D's step, and reproduced two deadlocks on this
schema. Each item, what was done, and its proof (08s6 unless named; controls in `resume/controls/`):

1. **(material) Three ways into the follow-up never locked the student.** A's replace-teacher now
   locks the students of its lines `FOR NO KEY UPDATE` in id order before the session and the offer,
   re-reads its lines after the offer lock and runs again with a newcomer locked first (A's own
   `lib/student-locks.ts`); `lockStudents` is gone. F0b's `updateEnrolment` and `endEnrolment` take
   the enrolment's student first; `course_enrolment` is locked `FOR NO KEY UPDATE` wherever only its
   teacher, mode or end changes (`upsertEnrolments`, the two, the leaving's `endOpenEnrolments`).
   Forced races, both orders each, fixed outcomes: replace-teacher against an add of its student,
   against F0a's leaving and against F0a's cohort correction; the enrolment change against an add;
   and a line reserved for a new student while the replacement waits (the replacement takes no line
   before its student: probed with `FOR UPDATE NOWAIT`). Controls RV1a (no students first: red),
   RV1b (no re-read: red), RV1c (the enrolment's student not first: red), RV1d (enrolments
   `FOR UPDATE` again — see the trail: the students first already serialise these paths).
2. **(material) The published check took the teacher `FOR UPDATE`** after the caller had written the
   teacher into a line or an enrolment (`FOR KEY SHARE`): two follow-ups giving whole groups to one
   teacher deadlocked and the desk change failed with a server error. Now `FOR NO KEY UPDATE`. Race:
   two desk changes of two subjects to one teacher, both held at their audit row and released
   together — both land. Control RV2 (red: "deadlock detected").
3. **Covers after a teacher's rules change** (7266f26) — scenario: the cover a teacher gives at a
   period their new rules keep them off goes (`no_longer_holds`), audited, they are told. Control RV3.
4. **The line change against an add** — both orders now, each with its fixed outcome (the change
   first: the student moves to the new teacher's group, then the add moves them on; the add first:
   the change gives the student's new group, all of it with the new teacher, to that teacher).
5. **Delivery**: `offerDeliveries` reads a unit's delivery only from items entering that unit and
   offers with such an item (the subject's, from items entering no unit), so a later session's offer
   of the other unit, in school, no longer overrides a unit's online item (scenario; control RV5a). A
   whole group handed to its new teacher takes that teacher's delivery — online: its room needs and
   its draft lessons' rooms go (scenario; control RV5b).
6. **A teacher who takes a group later in the term** has their unavailability and limits judged for
   it from that day: the model loads every such teacher's rules and gives the engine
   `teacherSpans`; the grid, a server move, publishing and the generator judge alike (scenario in
   08s6; 08s0: the cell judgement equals the full evaluation with spans, the generator places
   nothing they refuse). Controls RV6a (no spans from the model), RV6b (the generator without them),
   RV6c (the cell judgement without later loads).
7. **`studentsOfGroup`**: step D's contract scenario (§8). D switches to it after F1 lands.
8. **Four merges, not three** (§14); and a whole group's change of teacher refused for a clash now
   lets each member try the move into the new teacher's group before waiting (scenario: a member
   moves where the group could not go; control RV8).

