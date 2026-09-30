# F1 — Scheduling: teaching groups, the timetable, cover (as built)

Branch `feature/scheduling`, started from `origin/feature/catalogue` 682907a (F0b, which brings
F0a), merged with `origin/main` at e5da650 once F0b landed (§14). The plan is
FEATURES_PLAN.md §1 "F1", its §2 row and §5's rules, with §0/§0b's "full versions" (the
generator **and** the aSc/FET exports). The trail is `.audit/scheduling.tsv`; evidence (suite
logs, control logs, screenshots, scratch scripts) is `.audit/scheduling-evidence/`
(git-ignored). The progress log is the last section.

F1 gives the school what its sheet cannot hold: **who is taught together** (teaching groups
drawn from the course enrolment and the sections, with dated membership), **a week that is
checked while it is made** (every clash found with its reason before and after a move, and a
generator that places the whole week and says why a lesson will not go), **versions** that take
effect on a date and are kept, **every person's own week** (student, parent, teacher, room,
section; print, CSV, a phone calendar), and **cover** for an absent teacher.

---

## 1. Data model

All in `packages/db/src/schema.ts`; one migration, `0041_scheduling.sql` (generated; it was
0040 before main's `0040_catalogue_tier` landed, §14).

| Table | What it holds | Rules |
|---|---|---|
| `teaching_group` | a class taught together in one academic year: name, kind (`enrolment` from the course enrolment, `section` for a whole section, `manual`), subject, teacher, **weekly periods**, **double periods**, room type and features needed, a fixed room, the group it was split from, `archived_on` | `section_id` iff kind `section`; `double_periods × 2 ≤ weekly_periods ≤ 30`; one live group per name per year (case-insensitive) |
| `teaching_group_member` | a student in a group from `started_on` to `ended_on` (inclusive; open while null), the enrolment it came from, the subject (denormalised), who added/ended it and why | one open row per (group, student); **one open group per (student, subject, year)**; `ended_on ≥ started_on − 1` (an *empty stay*: a membership ended before its first day, kept as history) |
| `schedule_unavailability` | a teacher or a room unavailable on a weekday, at one period or all day, with a note | teacher xor room |
| `teacher_load_limit` | a teacher's most periods a day and a week, per year | one per (year, teacher) |
| `group_day_rule` | two groups kept on different days (a = b: a group's own lessons on different days) | ordered pair, unique |
| `timetable` | a version for a term: `draft` or `published`, `effective_from`, `based_on_id`, `revision` (every edit bumps it), who published and when, a note | a published row has its date and time (check) |
| `timetable_lesson` | a lesson card: group, number (`seq`), length 1 or 2, weekday and lesson period (null together = off the grid), room, locked | unique (timetable, group, seq); a locked card is placed |
| `timetable_generation_run` | each generator run: who, how long, input and output hashes, seed, steps, placed/unplaced/locked, measures before and after, the explanations, `applied` or `stale` | |
| `teacher_absence` | a teacher away from a date to a date (or some periods of one day), a reason (`sick`, `personal`, `training`, `school_business`, `other`), a note, cancelled | periods only on a one-day absence |
| `cover_assignment` | one lesson on one date: `assigned` to a cover teacher, `cancelled` (the lesson does not take place), or `removed` (history), the absence it rests on, the original teacher | **one live arrangement per (lesson, date)** (unique partial index); assigned has a teacher, cancelled has none |
| `calendar_feed_token` | a user's private calendar link: the token's SHA-256 (never the token), created, last used, revoked | **one live link per user** |

A lesson's slot is (weekday, *n*-th lesson period of the year's **default** bell schedule). On a
date with another bell schedule (a short day), the *n*-th lesson period of that day's bells gives
its times; a lesson beyond the day's last lesson period is *not held* that day.

## 2. Who is in a group on a date (ST-16, SO-9)

`groupMembersBetween(groupIds, from, to)` (`scheduling-shared.services.ts`) is the one reader:

- **Enrolment and manual groups** read their member rows. **Section groups** read the section's
  membership (F0a), so moving a student between sections moves their section-taught lessons.
- **The later membership wins a shared day (ST-16).** F0a leaves both section memberships
  covering the day of a same-day move (`[joined, joined]` in 11A, `[joined, …)` in 11B); the
  reader gives that day to the one that started later (on the same start day, the one recorded
  later). The same rule holds for two groups of one subject. F0a's rows are not changed.
- **Leaving wins (SO-9).** Nobody is in a group after `left_on`, even where F0a clamped a
  section's end to its start; the student's own schedule says `left` for every later date.
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
staff; `/v1/ical/:token` is anonymous. 47 new endpoints, each with a policy row; 05 has one F1
case covering another family's child, another class's lesson, a cover teacher outside the
covered lesson and date, the gate, and a wrong or revoked feed link. `role-grants.ts` gives the
coordinator the F1 prefixes and teachers the read endpoints.

## 8. Contracts for later features (F2, F3)

From `apps/api/src/services/schedule.services.ts` unless noted; types in
`@repo/validations` (`DaySchedule`, `LessonOnDay`, `LessonStatus`, `NotHeld`):

- **`getScheduleFor(target, date): Promise<DaySchedule>`** with `target` `{ studentId }` or
  `{ teacherId }` — the plan's `getScheduleFor(studentId | teacherId, date)`, an object so a
  student's and a teacher's ids cannot be confused. Lessons with period(s), label, times, group,
  subject, room, teacher (cover applied), scheduled teacher, status and cover; `note` says why a
  day has none (`holiday`, `weekend`, `out_of_term`, `no_academic_year`, `exam_only`,
  `no_timetable`, `left`); `notHeld` lists lessons a short or exam-only day drops.
  *F2 (campus leave):* the lessons between the leave time and the return are the ones whose
  `startsAt`–`endsAt` overlap it. *F3 (attendance):* expected presence is the student's
  lessons that day; an `uncovered` lesson has nobody to take its register.
- **`getScheduleRange(target, from, to)`** — the same for a range (≤ 400 days), also for
  `{ roomId }` and `{ sectionId }`.
- **`lessonAccess(viewer, lessonId, date)`** → `'staff' | 'teacher' | 'cover' | null` — who may
  act on a lesson that date (F3: take its register). **`classListFor(viewer, lessonId, date)`** —
  the lesson's students that date with their section (404 for anyone else).
- **`groupMembersBetween(groupIds, from, to)`** (`scheduling-shared.services.ts`) — membership
  as date intervals with §2's rules.
- **`getSchoolDays(from, to)`** (`academic.services.ts`, extended from F0a's `getSchoolDay`) —
  the calendar for a range in a few queries.

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
`08s4-scheduling-races.test.ts`, one F1 case in `05-object-access.test.ts`, and
`09b-scheduling-invariants.test.ts` over every row the suite leaves. Each suite takes an
academic year 20–30 years ahead so no other suite's calendar can move its lessons.

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

## 12. Deferred, and why

- **A group's teacher is not dated.** Changing it changes the group's past weeks in the views
  (not the cover log or audit). A mid-term change can be made by splitting the group on the day.
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
6. **Mid-term teacher changes**: how often a group changes teacher during a term (§12).
7. **What families see**: the cover teacher's name is shown to students and parents today.

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
