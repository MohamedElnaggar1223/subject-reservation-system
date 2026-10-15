# Cycle follow-ups — D's teaching groups from F1, and B's desk display of the follow-up (as built)

Branch `feature/cycle-followups`, from `main` 6108fa3 (15 Oct 2026, F1 merged at ba7c978). Implementer:
Opus 5.5 (`claude-opus-5-5`). The two follow-ups owed since F1 landed, both inside the reservation
cycle (Messages and the desk), so both stay visible under F6b's switch (`apps/web/lib/reservation-focus.ts`,
unchanged); F1's own screens stay hidden.

1. **D's switch to F1's groups** — RESERVATIONS_REWORK.md §10's F1 row; RESERVATIONS_MESSAGES.md §2;
   SCHEDULING.md §8, "D's switch, once F1 is on main".
2. **B's desk display of `groupsFollowed`** — RESERVATIONS_LINES.md §9 ("F1's follow-up outcome on the desk").

The trail is `.audit/cycle-followups.tsv`; the evidence (controls, the drive's screenshots and readings,
the suite's summaries) is `.audit/cycle-followups-evidence/`. Resources: test database
`igcse_followups_test`, dev database `igcse_followups_dev` (a copy of `igcse_template_dev`, 61
migrations), API 3171, web 3170. The progress log is the last section.

---

## 1. D's switch: a teaching group is one of F1's groups

### 1.1 The audience

| | Before (step D, 8 Oct) | Now |
|---|---|---|
| Definition | `{ kind: 'batch', list: 'teaching_group', academicYearId, subjectId, unitId, teacherId, who }` — an enrolment key | `{ kind: 'batch', list: 'teaching_group', groupId, who }` — one of F1's groups (`TeachingGroupList`, `packages/validations/src/message/message.validations.ts`) |
| Its students | the open in-school `course_enrolment` rows of the key | **`studentsOfGroup(groupId, day, executor)`** (`group.services.ts`), `day` the group's day (below: today, or the year's first day before the year begins): who is in the group that day by SCHEDULING.md §2 — a student who left the group (last day before today) is not written to, one who joined (from today or before) is, one joining tomorrow is not; a move made today goes to the later group; nobody after their last day at the school; a section's group follows the section. Then D's `families()` as for a section: the students and/or their approved parents, left and barred students out |
| Read in | the caller's executor | the caller's executor: the resolve endpoint and the send read with `db`, the scheduler step's dispatch of a scheduled message inside its own transaction (`tx`) |
| Order | by name | by name (the ids `studentsOfGroup` gives, read back ordered by name, so the sample and the preview's first recipient are the first by name as before) |
| A group that does not exist | — | 404 "Teaching group not found" |
| Label (the summary, the log, the deliveries) | "Biology P1 with Teacher A — Parents" | "**Biology 11 — Teacher A: Biology with Teacher A — Parents**": the group's name, its subject (and unit, its short code), its teacher **on the group's day** (`teachersOn([groupId], day)`, else `teaching_group.teacher_id`), "no teacher yet" when none; a group with no subject reads "Homeroom 11 with Teacher H — Students". D's Arabic rule for "… with … — …" translates it unchanged |
| Who may send | the admin (not a payment list) | unchanged: the admin; finance is refused (403, D's sentence) |

`resolveAudience` (`message-audience.services.ts`) is the one place every path goes through — the resolve
endpoint (`previewAudience`), the send (`createMessage`), and the scheduler step's dispatch
(`dispatchScheduledMessages`, step D's part 1) — so the three cannot disagree: 08s sends one now and two
scheduled, and asserts each reached exactly the people the resolve counted at that moment (§3).

**The day** (`teachingGroupDay`, `message-audience.services.ts`). A group is read on the school's today
(`todayAtSchool()`, F1's clock, `apps/api/src/lib/clock.ts`) — **or on its year's first day while today is
before it.** This is the coordinator's decision after the Opus 5.5 review of d3f62cf (item 1), a departure
from SCHEDULING.md §8's literal `todayAtSchool()` (recorded there): the picker switches to the coming year
on 1 July (`academicYearStartOf`) and its members start on that year's first day, so read on today every
class resolved to nobody all summer — "Send now" refused as an empty audience, a scheduled message marked
sent to 0. The resolve, the send and the scheduler's step read the day in one place (`resolveAudience`), and
the picker counts each group on the same day (§1.2). It is the school's day in Cairo, never the server's:
outside a test run the clock is the real time; a test run may put it inside a far-ahead year so a scenario can
stand inside a term (08s does: its year is the start year + 33), and 08s resolves once at 22:30Z the day
before (01:30 in Cairo) expecting the same members, which a reading of the server's own date fails in the
TZ=UTC run (control C4).

### 1.2 The picker (`GET /v1/messages/lists`, `teachingGroups`)

From **`listGroups(academicYearId)`** (`group.services.ts`) for the school's year today (the year whose
start is `academicYearStartOf(now())` — F1's clock, so the picker and the resolve stand on the same day;
outside a test run, the real date as before). `asOf` is the group's day (§1.1: today, or the year's first day
before the year begins), and everything the picker says is as of that day: the groups not retired by then,
each row's `size` (its students that day — the count the resolve, the send and the step find; since the
review of d3f62cf counted here, not taken from `listGroups`' own `size`) and `teacher`. Each row: `id`,
`name`, `kind`, `label`, `subject` `{ id, name }`, `unit` `{ id, code, shortCode }` or null, `teacher`
`{ id, name }` or null, `size`, `asOf`.

The **label** is the group's own name, with its subject (and unit) and today's teacher after it only when
the name does not already say them: a formed group "Biology 11 — Teacher A" reads as it is; a hand-named
"Group 3" reads "Group 3 · Biology · Teacher A"; "Maths" taught per unit reads "Maths · Maths P1 · Teacher A". The composer (`composer.client.tsx`) keeps the group's id as the definition;
with no group in the year the select says "No teaching groups yet" (F1's words, already in Arabic). The
"Saved lists" quick-fill puts a saved group's id back in the picker, and clears the picker for a saved list
that names no group (an old-shape one, the review of d3f62cf item 4: kept, the picker showed and resolved
whichever class was picked before); its cast to the input type is gone (the saved audience's definition is
the API's own type). **An old-shape saved list sends through its saved id only** (the API's `{ savedId }`);
the composer cannot rebuild one as a definition.

### 1.3 Stored audiences of the old shape: both shapes are read

`message_audience.definition` rows written before the switch — a saved audience, and every message's own
copy (a scheduled message waiting for its minute included) — carry the enrolment key. **Both shapes are
read; nothing is converted and there is no migration.**

- `StoredAudienceDefinition` (validations) = the API's `AudienceDefinition` **or** `LegacyTeachingGroupList`
  (the old shape). Every read of a stored row parses with it: a saved audience picked by id
  (`audienceOf`), the cancel (who may), the step's dispatch, the log's and the deliveries' audience words
  (`describeAudience`), the saved list (`listSavedAudiences`).
- An old-shape audience resolves **as it was written**: the open in-school course enrolments of the key
  (the query step D shipped), labelled as before ("Biology with Teacher A — Parents").
- **Written only in the new shape**: `POST /v1/messages` and `…/audiences/resolve` take `AudienceDefinition`,
  which no longer has the key; an old-shape definition sent as a definition is refused (400). A saved
  old-shape audience picked by its id still sends.

Why not convert the old shape to the key's groups at read time: in the reservation cycle F1's screens are
hidden, so a school may have course enrolments and no groups at all; converting would send a saved or
scheduled message to nobody — a scheduled one would be marked sent to 0 people — and nothing would say why.
Read as written, a message saved or scheduled before the switch reaches who it named when it was made.

---

## 2. B's desk display: what happened to the student's class

### 2.1 The outcome

The desk's teacher change (`PUT /v1/registrations/:id/teacher`, `line-teacher.services.ts`) answers
`groupsFollowed: FollowOutcome | null` — F1's `followEnrolments` through `upsertEnrolments(…, { follow })`.
**A's "Replace a teacher" (`POST /v1/sessions/:id/offers/:offerId/replace-teacher`, `offer.services.ts`
`replaceTeacher`) answers the same `groupsFollowed`**, so its dialog shows it the same way.

`FollowOutcome` (`group.services.ts`): `left` (self-study: out after today), `moved` (into the new teacher's
class, `toGroupName`), `groupsGiven` (every member now has the new teacher: the whole class goes to them),
`waiting` (stays where they are, with `why`), `coversLost`. **One addition**: each `waiting` entry gains
`kind` — `no_group` (the new teacher has no class of the subject or unit yet) or `refused` (the move, or the
whole class's change, was refused; `why` is the API's reason, e.g. the clash in the published timetable,
without the confirmation code) — so the screens tell the two apart without reading the English of `why`.
Additive: F1's scenarios assert `waiting` with `objectContaining` / `toMatchObject`, and still pass.

### 2.2 The sentences, in the school's words

`apps/web/lib/groups-followed.ts` (`followSentences(outcome, { one, teacherName })`; no React, so the suite
calls it on real outcomes). A class is F1's teaching group under the name the coordinator gave it — "class",
as F6a's Replace teacher already says ("this year's class of the teacher who leaves"); no model word
(group, enrolment, waiting, outcome) on the screen. The teacher is named from the screen's own list (the
item's teachers at the desk, the school's teachers on the Session screen); one it cannot name is "The new
teacher". Each sentence is one text, translated on the page by `translateReservationsText`
(`lib/i18n-reservations.ts`); a refusal's reason is a second text, the API's own sentence, translated by F1's
`translateSchedulingText`. Names stay left-to-right inside the Arabic (Unicode isolates, as F1's rules do).

**The desk** (one student):

| Outcome | English | Arabic |
|---|---|---|
| moved | The student moves to the class *Biology 11 — Teacher B*. | ينتقل الطالب إلى فصل *Biology 11 — Teacher B*. |
| waiting, no class | *Teacher C* has no class of this subject yet: the student stays in *Biology 11 — Teacher A* and waits to be placed. | ليس لدى *Teacher C* فصل في هذه المادة بعد: يبقى الطالب في *Biology 11 — Teacher A* وينتظر توزيعه. |
| waiting, no class, "no preference" | No class of this subject is without a teacher yet: the student stays in *…* and waits to be placed. | لا فصل في هذه المادة بلا معلم بعد: يبقى الطالب في *…* وينتظر توزيعه. |
| waiting, refused | The move was refused: the student stays in *Biology 11 — Teacher A*. + the API's reason ("It would clash in the published timetable: Student … would be in … and … at Wednesday period 2 from …") | رُفض النقل: يبقى الطالب في *…*. + «سيتعارض في الجدول المنشور: …» (F1's rule) |
| the whole class | The whole class *Biology 11 — Teacher D* goes to *Teacher C*: the student stays in it. | ينتقل فصل *…* كله إلى *Teacher C*: ويبقى الطالب فيه. |
| the whole class, "no preference" | The whole class *…* waits for a teacher: the student stays in it. | ينتظر فصل *…* كله معلمًا: ويبقى الطالب فيه. |
| self-study (left) | The student leaves the class *…* after today: self-study from now. | يغادر الطالب فصل *…* بعد اليوم: دراسة ذاتية من الآن. |
| the student is in no class of the subject | (nothing: the dialog closes as before) | — |

**The Session screen's Replace a teacher** (several students, counted per class; Arabic counts agree with
their number as D's do — طالب واحد، طالبان، 3–10 طلاب، 11–99 طالبًا):

| Outcome | English | Arabic |
|---|---|---|
| moved | 2 students move to the class *…*. (1 student moves …) | ينتقل طالبان إلى فصل *…*. |
| the whole class | The whole class *…* goes to *Teacher D*. | ينتقل فصل *…* كله إلى *Teacher D*. |
| waiting, no class | *Teacher D* has no class of this subject yet: 1 student stays in *…* and waits to be placed. | ليس لدى *Teacher D* فصل في هذه المادة بعد: يبقى طالب واحد في *…* وينتظر توزيعه. |
| waiting, refused | The move was refused: 3 students stay in *…*. + the reason | رُفض النقل: يبقى 3 طلاب في *…*. + السبب |
| left | 2 students leave the class *…* after today: self-study from now. | يغادر طالبان فصل *…* بعد اليوم: دراسة ذاتية من الآن. |

### 2.3 The screens

- **The desk** — the Student 360's Statement, a line's **Teacher** → "Change the teacher"
  (`components/reservations/statement.tsx`, `TeacherModal`): after Save, when the outcome has something to
  say, the dialog keeps the line's name, shows the sentence(s) in a notice (`components/reservations/class-follow.tsx`,
  the existing `Notice`: success, or warning when a student waits) and a **Close**; with nothing to say it
  closes as before. The statement and the desk refresh as before.
- **The Session screen** — a subject's form, **Replace teacher** → "Replace a teacher"
  (`subjects-tab.client.tsx`, `ReplaceTeacher`): after Replace, the sentence(s) and **Close** in place of
  the fields; with nothing to say it closes as before. **Once a replacement closes** (its Close, its ×, or at
  once with nothing to say) the subject's form behind it is made again from the offer as it is now — the
  drawer's form version is bumped (`onReplaced`), as a Save bumps it (the review of d3f62cf, item 2: kept, the
  form's ticks still named the teacher who left, and a Save from it, which replaces the offer's whole teacher
  set, would have sent them back and dropped the new one). Cancel without a replacement keeps the form's edits.

The outcome's type is derived from the RPC client (`GroupsFollowed`: the `PUT /registrations/:id/teacher`
answer's `groupsFollowed`, through `hc<AppType>` and `apiResponse`'s inference) — no hand-typed response, no
`useQuery` generic (the count of `useQuery<` in `apps/web/app` is unchanged). The replace-teacher answer
carries the same type and is accepted as it is.

---

## 3. Tests

**No existing scenario's set-up or outcome changed.** The brief pre-authorised adapting 08s's
teaching-group scenarios' set-up to F1's groups; 08s had none (`grep -n teaching_group apps/api/test/*.ts`
on 6108fa3: nothing outside F1's own files), so there was nothing to adapt — the scenarios below are new,
and **no assertion was changed** (old and new: none).

- **08s-messages-reminders** — a `describe` at its end, "a teaching group is one of F1's groups, its students
  those in it on the school's day", in a year of its own (start year + 33) with the school's clock put on
  14 October of it:
  1. *The picker, the members on the day, and the three paths agreeing*: a class of A, B, C from the year's
     first day; B's last day yesterday; D joined today; E joins tomorrow; a class retired yesterday. The
     picker lists the one live class with its label, subject, today's teacher, `size` 3 and `asOf` today (the
     retired one left out). The resolve counts 6 (A, C, D and their parents; not B, not E), labels it, fills
     `{guardian}` and `{student}`. The send now reaches those six (A's parent's notification read literally;
     nothing for B's or E's family); the log names it as the resolve did; the message keeps the definition and
     6. A scheduled one is sent by the step at its minute to the same six. C then leaves (last day yesterday):
     the next resolve counts 4 and the next scheduled one reaches A and D only. Students only: 2. Finance
     refused (403); an unknown group 404.
  2. *An audience saved before the switch*: the row D's composer wrote (the enrolment key), inserted as it was
     (the only way to have a row from before the switch); A and C enrolled with the teacher. Listed with its
     words, resolved (2 parents), sent by its saved id (the message keeps the old shape as its copy; the log
     names it as before), scheduled and sent by the step, a scheduled one cancelled; the old shape sent as a
     definition refused (400).
  3. *Between 1 July and the year's first day* (the review of d3f62cf, item 1): the clock on 20 August of the
     scenario year; the picker lists the year's classes counted on the first day (the class 3, the class
     retired in October still live then, 0; `asOf` the first day); the class resolves to its three students of
     that day (A, B, C), "Send now" reaches them, a scheduled one is sent by the step to the same three.
  And in scenario 1, one resolve with the clock at 22:30Z the day before (01:30 in Cairo): the same members
  (item 3).
- **08s6-scheduling-rework** — one scenario at its end, "the desk's sentence for each outcome …": F1's race
  subjects (three teachers on an offer, students reserved with X), every change through the real endpoints as
  the desk and the coordinator call them, and the sentence read through `followSentences` with its Arabic
  through the page's rules: moves (to Y's class); waits with no class (Z's only class retired; `kind:
  'no_group'`), "the new teacher" when the screen cannot name one; the whole class (the last student taught by
  X goes to Z); refused for a clash in a version published from D1 (Y's class and the student's homeroom both
  on Wednesday at period 2; `kind: 'refused'`, the reason F1's sentence, its Arabic F1's); nothing to say (a
  student in no class); self-study (out of Z's class after today); A's replace-teacher handing the whole class
  to Y, and one moving two students (X's class keeping a third taught by X through no line of the offer). Each
  English sentence and its Arabic literal; and none of the seven is taken on the page by a dictionary that
  comes before B's (F4's, F0b's, F7's, A's, C's rules all return nothing for them).

The version this scenario publishes copies the one in force and moves the roll-over scenario's hall lesson
to a free slot (that version carries the clash the roll-over went ahead with, and publishing refuses
clashes) — the first run was red there, at its own set-up.

No new endpoint (the authorisation matrix and 05 unchanged); no money path touched (no 09 rule).

---

## 4. The drive (headless Chrome, `playwright-core`, channel `chrome`)

On the worktree's servers (web 3170, API 3171) over `igcse_followups_dev`, set up through the API by
`drive/setup-dev.mjs` (never a migration or a seed; placeholder names): a coordinator; Teachers A, B, C, D and
H; the year 2026-27 with Term 1, four periods a day and three rooms; a June 2027 sitting with its entries
open and a session "June 2027 — Follow-ups" open now, Biology taught by A, B, C and D; Students FU-1 to FU-6
(grade 11) onboarded and reserved at the desk (FU-6 a retake declared at the desk); their enrolments from
the lines; the classes "Biology 11 — Teacher A" (FU-1, 2, 3, 5, 6), "Biology 11 — Teacher B" (empty, on
Wednesday at period 2), "Biology 11 — Teacher D" (FU-4) and "Homeroom 11 — Teacher H" (FU-5, Wednesday at
period 2), the term's timetable published from today. `drive/drive.mjs` reads every sentence, switches the
language with the sidebar's button while the dialog is open, reads it again in Arabic (the page `dir="rtl"`)
and shoots both; the readings are `drive/drive-*.json`, the screenshots `drive/shots/`.

| Where | What was done | What the screen said (English; the Arabic is in the readings and shots) |
|---|---|---|
| The desk, FU-1 | A → B (B has a class) | The student moves to the class Biology 11 — Teacher B. |
| The desk, FU-3 | A → C (C has none) | Teacher C has no class of this subject yet: the student stays in Biology 11 — Teacher A and waits to be placed. |
| The desk, FU-5 | A → B (B's class meets when FU-5 has homeroom) | The move was refused: the student stays in Biology 11 — Teacher A. It would clash in the published timetable: Student FU-5 would be in Biology 11 — Teacher B and Homeroom 11 — Teacher H at Wednesday period 2 from Wednesday, 21 October 2026 (Term 1 — first) |
| The desk, FU-4 | D → C (FU-4 alone in D's class) | The whole class Biology 11 — Teacher D goes to Teacher C: the student stays in it. |
| The desk, FU-6 | self-study (a retake) | The student leaves the class Biology 11 — Teacher A after today: self-study from now. |
| Messages | A list in the system → A teaching group → Biology 11 — Teacher A | the picker lists the four classes (the one handed to C today reads "Biology 11 — Teacher D · Teacher C"); **8 people** — FU-2, 3, 5, 6 and their parents; FU-1, moved out today, is not among them — "Biology 11 — Teacher A: Biology with Teacher A — Parents and students" (Arabic: "8 أشخاص", "… مع Teacher A — أولياء الأمور والطلاب") |
| Messages | … → Biology 11 — Teacher B | **2 people**: FU-1 (joined today) and Parent FU-1 |
| The Session screen | Replace a teacher, A → D | Teacher D has no class of this subject yet: 1 student stays in Biology 11 — Teacher A and waits to be placed. (English shot; see below) |
| The Session screen | Replace a teacher, B → A | The whole class Biology 11 — Teacher B goes to Teacher A. (English and Arabic) |

No page error and no failed request in any of the three runs (`errors: []` in each reading).

**Found while driving** (none of them this change's; for the lead):

1. *The drive itself, twice*: the sidebar's language button sits under an open dialog's overlay, so the script
   clicks it as a keyboard user does (the button's own click); and the first Replace run's Arabic read lost
   the dialog because its accessible name is translated with the page — the second run finds it by its role.
   Putting FU-1 back on Teacher A through the desk (to run the drive again) gave Teacher B's whole class to A
   — the follow-up rule doing its job — so the database was copied from the template again and set up anew.
2. *F1's Arabic of the clash reason*: the date keeps an English comma ("الأربعاء, 21 أكتوبر 2026"), and the
   isolates F1's rule puts around Latin runs stop at the dash, so "Biology 11 — Teacher B" is isolated as two
   runs; it reads, but less cleanly than B's sentences (whose names are isolated whole). F1's dictionary;
   for F6.
3. *The Session screen's form behind Replace a teacher kept its ticks* — fixed in the review round (§2.3) and
   driven: Replace Teacher C → Teacher B, Close: the form shows Teacher B ticked and Teacher C gone; with the
   fix undone, Replace Teacher D → Teacher C left Teacher D ticked and C not (`drive/drive2-form-*.json`,
   `drive/shots/r2-*-form-*`). The old-shape saved list's quick-fill likewise (§1.2): with the fix the class
   picker reads "Choose a group" after the saved list is clicked; undone, it kept Biology 11 — Teacher B and
   resolved it (`drive/drive2-quickfill-*.json`, `drive/shots/r2-*-quickfill-*`). The second drive ran on
   the same dev copy, which by then also carried the lead's own checks (a "lead check" change of FU-3's
   teacher at 02:45Z).

---

## 5. Controls (each guard undone once, its test red, restored)

| # | Undone | Red | Kept |
|---|---|---|---|
| C1 | the date check: the audience read every membership row of the group (`select distinct student_id from teaching_group_member where group_id = …`) in place of `studentsOfGroup(groupId, todayAtSchool(), executor)` | 08s, the picker/members scenario: "expected 10 to be 6" (B, who left yesterday, and E, who joins tomorrow, written to with their parents) | `controls/c1-left-member-date-check.log` |
| C2 | the desk sentence's refusal branch: a refused move read as "no class of the new teacher yet" | 08s6, the desk sentence scenario: the clash refusal read "Race DC Y … has no class of this subject yet: …", with no reason | `controls/c2-desk-refusal-branch.log` |

| C3 | the group's day: the resolve back on `todayAtSchool()` in the summer too | 08s, the summer case: `[0, []]` for three students | `controls/c3-summer-day.log` |
| C4 | the school's day: the group's day read from the server's own date (the clock's instant in the process's zone) | 08s with `TZ=UTC`: the 22:30Z resolve finds yesterday's class (B in it); the same run in local time (+0300) passes, as the review predicted | `controls/c4-school-day-not-server-date.log` |
| C5 | the subject's form not made again after a replacement | the drive: after Replace Teacher D → Teacher C and Close, the form still shows D ticked and C not | `drive/drive2-form-control.json`, `drive/shots/r2-control-form-*` |
| C6 | the quick-fill's reset (the group kept unless the saved list names one) | the drive: after the old-shape saved list is clicked, the picker still holds Biology 11 — Teacher B and resolves it | `drive/drive2-quickfill-control.json`, `drive/shots/r2-control-quickfill-*` |

Each restored from a kept copy (`grep CONTROL` 0) and its file green again in the full runs (§6).

---

## 6. Gates (in the cycle-followups worktree)

**The review round (1688f24, the last commit with code):**

| Gate | Commit | Result | Kept |
|---|---|---|---|
| `pnpm --filter @repo/api check-types` (source and tests) | 1688f24 | clean | — |
| `pnpm --filter web check-types` | 1688f24 | clean | — |
| the suite, local time (+0300), `TEST_DB_NAME=igcse_followups_test` | 1688f24 | 43 files, **836 passed**, 1 todo (main 6108fa3: 832; the four new scenarios) | `suite/1688f24-local.log` |
| the suite, `TZ=UTC` | 1688f24 | 43 files, **836 passed**, 1 todo | `suite/1688f24-utc.log` |
| CI (`gates`) | 1688f24 | green: run 38676877485 | — |

**Before the review:**

| Gate | Commit | Result | Kept |
|---|---|---|---|
| `pnpm --filter @repo/api check-types` (source and tests) | 2bfc74c | clean | — |
| `pnpm --filter web check-types` | 2bfc74c | clean | — |
| the suite, local time (+0300), `TEST_DB_NAME=igcse_followups_test` | 2bfc74c | 43 files, **835 passed**, 1 todo (main 6108fa3: 832 and 1 todo; the three new scenarios) | `suite/2bfc74c-local.log` |
| the suite, `TZ=UTC` | 2bfc74c | 43 files, **835 passed**, 1 todo | `suite/2bfc74c-utc.log` |
| CI (`gates`) | 594fb6a, 2bfc74c, d015bdf, d3f62cf | green: runs 38665662013, 38667940887, 38669680333, 38671056078 | — |

The same suite on 594fb6a in local time (835 passed) is kept as `suite/594fb6a-local.log`; 2bfc74c differs from
it in one line of code (the picker's label) and the documents. `useQuery<` in `apps/web/app`: 19, unchanged.

---

## 7. Decisions and why

1. **Both shapes read, the old one resolved as written** (§1.3), rather than converted to the key's groups:
   with F1's screens hidden in the cycle a school may have no groups, and a converted audience would reach
   nobody silently. New audiences are written in the new shape only.
2. **The group on its day: today, or its year's first day before the year begins** (the coordinator's
   decision after the review of d3f62cf, item 1, replacing the contract's literal `todayAtSchool()`), the same
   day the picker counts on, read in one function for the resolve, the send and the step.
3. **The picker lists only live groups** (not archived), every kind (enrolment, section, manual; a provider's
   too: a message to its students is a message like any other).
4. **The label keeps D's "… with … — …" form** with the group's name in front, so D's Arabic rule reads it and
   the log of a message sent before the switch keeps its own words.
5. **`waiting.kind` on F1's outcome** rather than reading the English of `why`: the screen's branch rests on a
   value the API sets, and the reason stays the API's sentence.
6. **"Class"**, as F6a's Replace teacher says it, for F1's teaching group on the desk and the Session screen
   (Arabic فصل, as that dialog's Arabic says it); the class's name is the coordinator's.
7. **The dialog stays open on the result** (a Close button) only when there is something to say; otherwise
   it closes as before — at the desk in the cycle most students are in no class yet.
8. **The sentence builder in `apps/web/lib`, without React**, its input type derived from the RPC client, so
   the API suite reads the real endpoints' outcomes through the very function the screens use, as 08s and 08n
   already read the web's dictionaries.

---

## 8. Changed outside the two features' own files

- `apps/api/src/services/group.services.ts` (F1): `FollowOutcome.waiting[].kind` (§2.1) — two lines where the
  entries are made, and the type's comment.
- `apps/web/app/(app)/(sessions)/admin/sessions/[id]/subjects-tab.client.tsx` (A, F6a): the Replace a teacher
  dialog's result only.
- `apps/api/test/08s6-scheduling-rework.test.ts` (F1's suite): one scenario added at its end; no existing one
  touched.
- `docs/features/RESERVATIONS_MESSAGES.md` §2 (the F1 row) and `docs/features/RESERVATIONS_LINES.md` §9 (the
  deferred item): marked done, pointing here. In the review round, by the coordinator's leave:
  RESERVATIONS_MESSAGES.md decision 15 and §5's line, and SCHEDULING.md §8's "D's switch" (what D reads now,
  the group's day and its departure from `todayAtSchool()`, both shapes kept, `waiting.kind`).
- `subjects-tab.client.tsx` again in the review round: the drawer's form made again after a replacement
  (`onReplaced`).

Not changed: the model (no migration), F6b's switch and its lists, F1's screens, any money path,
`FEATURES_PLAN.md`.

---

## 9. Deferred, and why

- **A year picker for teaching groups** — the picker offers the school's year today, as the sections list
  does; a message to next year's classes before the year starts would need one (and the group read on that
  year's first day). Not asked for.
- **Sending an old-shape saved list from the composer** — clicking one sets the list and the recipients and
  clears the class picker (it names no group); it sends through its saved id only, which the API takes and the
  composer has no control for (it never had one for a saved batch).

**The review's low findings not fixed** (the review of d3f62cf; recorded at the coordinator's direction):

- *The Sent log names a class by its teacher on the group's day when the log is read*, not at send time: a
  class whose teacher changed since reads with the new teacher. The audit row (`MESSAGE_SENT`) keeps the words
  of the send.
- *F1's Arabic clash reason* isolates English names only up to the em dash and keeps an English comma in the
  date (§4, found 2); F6 fixes it in `i18n-scheduling.ts`.
- *Sending an old-shape definition* is refused with the validator's generic 400 (no sentence of its own); the
  composer cannot produce one.
- *`listOptions` reads the sections' year from the school clock* too (the line moved from `new Date()` to
  `now()` for the groups): the same outside a test run.

---

## 10. Questions for the owner

1. **The words for a section and for a class, in Arabic** — the Messages screen shows "A section" as فصل (C's
   dictionary, merged first, overriding D's قسم), while the desk and Replace a teacher use فصل for a teaching
   group ("class", as F6a's Replace teacher already said it), and F1's own screens call a teaching group
   مجموعة تدريس. Which word does the school use for each — a section (11A) and a subject's class (Biology with
   Teacher A)? (Defaults kept: "class" / فصل on the desk and Replace a teacher; the Messages screen as it is.)

---

## 11. Progress log (UTC)

- 2026-10-15 01:00–01:03 — worktree set up (install, builds, `igcse_followups_dev` from the template, 61
  migrations, env files on 3171/3170); baseline 08s and 08s6 on 6108fa3: 75 passed (01:03).
- 01:03–01:17 — D's switch (validations, the audience, the picker, the composer); B's display (the builder,
  the Arabic rules, the notice, the two dialogs, `waiting.kind`); both type-checks clean.
- 01:17 — 08s with the two new scenarios: 38 passed. 01:18 — control C1 red, restored.
- 01:21–01:23 — 08s6's new scenario: red at its own set-up (the in-force version's accepted clash), fixed;
  40 passed (01:22). 01:23 — control C2 red, restored.
- 01:26 — committed 594fb6a (plumbing from lead-env: the harness refuses adding with another work tree, so the
  files go in with `hash-object -w` and `update-index --index-info` into a temporary index) and pushed.
- 01:26–01:41 — the suite on 594fb6a in local time: 43 files, 835 passed, 1 todo; CI green (run 38665662013).
  The TZ=UTC run (01:34, 835 passed) had one line edited under it (the picker's label checks the subject with
  its unit), so it is not counted; the gates run again on the final commit.
- 01:42–01:48 — the servers started (API PID 16285, later 16638; web 16295), the dev data set up, the drive
  (§4); the database copied again from the template once (§4, found 1).
- 01:50 — this document, B's and D's documents marked done; 2bfc74c committed and pushed (01:51); the servers
  stopped by their PIDs.
- 01:52–02:08 — the gates on 2bfc74c: the suite in local time (01:52) and with TZ=UTC (01:59), 835 passed each;
  CI green (run 38667940887). 41b2778 (documents and evidence) pushed.
- 02:09–02:10 — **lead-env's `package.json` restored.** At 01:28Z, setting up the drive's scratch directory,
  `npm --prefix /tmp/cycle-followups-drive init -y` wrote a `package.json` into the shell's working directory —
  lead-env — instead of the prefix (npm's `init` does not honour `--prefix`). Found while checking lead-env's
  status; restored from lead-env's own index (its content written back over the file; index and HEAD untouched);
  `git status` there clean again; no other lead-env file changed in this session. For the lead: anything run in
  lead-env between 01:28Z and 02:10Z saw that file changed.
- 02:27–02:40 — d3f62cf (trail only) and its CI green (run 38671056078); the first report.
- 03:15–03:33 — **the Opus 5.5 review of d3f62cf** ("confirmed: merge", five items to fix in one round, via the
  coordinator): the group's day (item 1) with its summer case and control C3; the 22:30Z resolve (item 3) and
  control C4 (red with TZ=UTC only); 08s 39 passed in both zones (03:20Z, 03:21Z). The form made again after a
  replacement (item 2) and the quick-fill's reset (item 4), both driven on the servers started again (API PID
  52239, web 52240), with controls C5 and C6 in the drive (03:27–03:29Z); the documents (item 5); the servers
  stopped by their PIDs.
- 03:33–03:48 — 1688f24 committed and pushed; both type-checks clean; the suite in local time (03:33Z) and with
  TZ=UTC (03:41Z), 836 passed each; CI green (run 38676877485).
