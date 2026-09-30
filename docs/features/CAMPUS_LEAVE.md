# F2 — Campus-leave permissions (as built)

Branch `feature/campus-leave`, started from `origin/feature/scheduling` 9569dd9 (F1, with main's
F0a and F0b merged into it). The plan is FEATURES_PLAN.md §1 "F2 — Campus-leave permissions", its
§2 row (`getLeaveCoverage(studentId, date)` for F3) and §5's rules. The trail is
`.audit/campus-leave.tsv`; evidence (suite logs, control logs, screenshots) is
`.audit/leave-evidence/` (git-ignored). The progress log is the last section.

F2 replaces the slip in the school bag, the phone call to the office and the list sent down to the
gate. A parent asks in the app (or the desk asks for them, or the school sends a student home); the
coordinator decides with everything the decision needs in front of them; the family's phone shows a
signed pass; the gate sees today's list with everyone authorised to collect each child and anyone a
custody note keeps away; check-out records who collected and when; the family, the student and the
teachers of the lessons missed are told at each step; the scheduler flags a leave nobody collected and
a student not back, once. SCL's "Dismissals" (DISCOVERY_RESEARCH.md §4: request → approval → pass →
check-out with the collector → parent told → missed periods excused) is the bar; F3 excuses the
missed periods through `getLeaveCoverage`.

---

## 1. Data model

One migration, `0042_campus_leave.sql` (generated, additive), after F1's `0041_scheduling`.

| Table | What it holds | Rules (checks) |
|---|---|---|
| `leave_request` | one leave: student, date, leave time, returning and the return time, reason (the setting's key and its label then), the family's note, a supporting document, who the family names to collect (`collector_kind` parent / collector / alone, with the parent's account or the collector), origin (`parent`, `desk`, `school`), on whose behalf, who made it and when; the decision (by, at, note); the cancellation (by, at, reason); `pass_version`; the check-out (at, by, who collected — kind, parent or collector, name — ID seen, by pass or looked up, note); the return (at, by); the flags `no_show_at`, `late_return_at` | status in pending, approved, rejected, cancelled, checked_out, returned; times HH:MM, the return after the leave; decided iff approved/rejected/out/back; a refusal has its reason; cancelled iff `cancelled_at`; out iff `checked_out_at` and who; back iff `returned_at` and returning; a late flag only on a leave out and returning |
| `leave_series` | a recurring request: student, from, until, weekdays | one per pattern; each date it made is a `leave_request` with `series_id` |
| `leave_collector` | someone a family trusts to collect: name, relation, phone, ID number, photo, status (pending, approved, rejected, withdrawn), who added it, the decision, the withdrawal | decided iff approved/rejected; a refusal has its reason |
| `leave_collector_student` | the children a collector may collect | one row per (collector, child) |
| `leave_custody_restriction` | a person who may not collect a student: name, relation, ID number, a parent's account it names, photo, document (court order), note, who recorded it; ended (at, by, reason) | ended iff a reason |

**States.** `pending → approved | rejected | cancelled`; `approved → checked_out | cancelled`;
`checked_out → returned` (when returning). The scheduler's flags never change the status: a family
arriving after the no-show flag still checks out, and a student back after the late flag is still
recorded back. Times of day are the school's (Africa/Cairo); instants are UTC.

**Settings** (F0a's store, group `leave`; the coordinator and the admin change them, except who
approves, the admin's):

| Key | Default | What it does |
|---|---|---|
| `leave.sameDayCutoff` | 10:00 (or none) | a request for today sent after it is flagged *after the cut-off* |
| `leave.noticeMinutes` | 60 | a request sent with less notice is flagged *short notice* |
| `leave.aloneGrades` | none | grades (on the leave's date) that may leave alone |
| `leave.reasonCategories` | medical appointment, feeling unwell, family matter, official appointment, exam or test elsewhere, religious occasion, other | the reasons offered; reports count by them; a reason taken off stays on the requests that used it |
| `leave.limitPerTerm` | none | a family's standing requests for one student in a term beyond it are flagged (the school's own leaves do not count) |
| `leave.familyRules` | warn | `refuse`: a request in the app breaking the cut-off, the notice or the limit is refused with the reason (staff are never refused for these) |
| `leave.approverRoles` | coordinator, admin | who approves requests and collectors and is told of new ones; the admin always |
| `leave.autoApprove` | off | on: a family request with no warning, collected by a parent or an approved collector, is approved at once (`decided_by` null, "Approved automatically") |
| `leave.noShowGraceMinutes` | 30 | minutes after the leave time before *not collected* |
| `leave.lateReturnGraceMinutes` | 15 | minutes after the return time before *late back* |

A setting's empty value (no cut-off, no limit) is stored as the JSON value `null` (F0a's
`updateSetting` now writes `'null'::jsonb`; before, a nullable key could not be set to none).

**Uploads** (F0a's purposes): `supporting_document` (a request's letter), `collector_photo` (the
desk may now upload it too, recording a family's collector), and two new purposes,
`custody_photo` (coordinator and admin upload; coordinator, admin and gate read) and
`custody_document` (coordinator and admin only). The gate reads a collector's or a restricted
person's photo **only for a student on today's list** (`file.services` `gateNeedsPhoto`); never the
custody document.

## 2. Requests

`POST /v1/leave/requests`. **Who asks, and as what:**

| Caller | Origin | Notes |
|---|---|---|
| a parent | `parent` | for a linked child (another family's child: 404); a time today must still be ahead |
| the desk (finance officer, finance admin) | `desk` | for any student, naming the parent who asked (`onBehalfOf`); never the school's own decision (403) |
| the coordinator or admin | `desk` (the family asked) or `school` (the school's decision) | may approve at once (`approveNow`, default on for the school's own); may record a time already passed today |

**What is checked:** the student exists and has not left by that date; the date is today or later;
the day is a school day — a holiday, the weekend and between terms are refused with the day's name,
a leave at or after the day's last bell is refused ("the school day ends at 12:00"); a date outside
every academic year is not judged (the school has not set it up). The reason is one of the school's.
Who collects: a parent linked to the student (not one a custody note names); an authorised collector
of the student, approved or still waiting (warned; the approval waits for the collector's); leaving
alone only for a grade the policy allows on that date. A collector a custody note names cannot be
named (the family is told to contact the school, not why). A supporting document must be one
uploaded for this student.

**Recurring:** `repeat: { until, weekdays }` makes one leave per school day on those weekdays up to
120 days (at most 60 dates); holidays and short days are left out and returned as `skipped` with why;
a date that clashes with a leave already standing is skipped too. The series is decided and cancelled
as one (`series: true`) or date by date.

**Overlap:** one student's requests are made one at a time (an advisory lock on the student), and a
leave overlapping one already standing (pending, approved, out, back) that day is refused.

**Warnings** (`warningsFor`), recomputed when read: *after the cut-off*, *short notice*, *over the
limit per term* ("The 3rd family request for this student in Term 1 (the limit is 2)"), *exam that
day* (F4's exams, §7), *exam-only day* (the calendar), *custody note on file* (never shown to a
family), *collector not approved*, *leaving alone no longer allowed*, *student left*. With
`familyRules = refuse` the first three refuse a parent's request (409, the sentence, "Please phone
the school"); staff requests carry them as warnings.

**Notices** (in the transaction): a waiting request → every approver (`LEAVE_REQUESTED`); a
request staff made → the family and the student; an approval → the family and the student
(`LEAVE_APPROVED`), and each teacher of a lesson the leave touches, cover applied
(`LEAVE_LESSON_MISSED`: "Student X leaves today at 10:30 and is back by 12:00: misses Physics 11
(P4, 10:30–11:15)").

## 3. Deciding and cancelling

`POST /v1/leave/requests/:id/approve { note?, series? }`, `/reject { reason, series? }`: the
approvers only (403 otherwise, naming who). Each takes the request's row `FOR UPDATE`, refuses one no
longer waiting with what happened to it ("This request was cancelled at 10:42 by Parent X"), and
updates it guarded by `status = 'pending'`. An approval also refuses a past date, a student who has
left, a collector not approved (the collector is read `FOR SHARE`), leaving alone no longer allowed,
and a named parent no longer allowed to collect.

`POST /v1/leave/requests/:id/cancel { reason?, series? }`: a parent of the student (a reason is
optional), the desk, the coordinator or the admin (a reason is required: the family is told it);
not a student. Only a waiting or approved leave for today or later; refused once the student has
left ("The student already left school at 11:05 — it can no longer be cancelled"). An approved
leave's teachers are told the student stays; a waiting one's approvers are told there is nothing to
approve.

A decision on a whole series (`series: true`) takes the series' row first, so two people acting on
two dates of one weekly request queue there instead of each holding one date and waiting for the
other's.

**Races** (08t2): approve and cancel at the same moment, both orders forced by the row lock and ten
times unforced — always cancelled, and the audit rows say exactly what each response said;
check-out and cancel, both orders; two gate staff checking one student out; two approvers approving
one request; two approvers approving one weekly request from two of its dates; two requests for one
student at once (queued on the student's lock: the overlapping second refused).

## 4. The pass

`GET /v1/leave/requests/:id/pass` (the parent or the student): for an approved leave today or later,
`L1.<leave id>.<pass version>.<expires>.<signature>` — the signature is the first 16 bytes of
HMAC-SHA256 over the rest, base64url, under a key derived from `LEAVE_PASS_SECRET` or, unset, from
`BETTER_AUTH_SECRET` with a label of its own (so the pass key is never the session key). It expires at
the next midnight in Cairo after the leave's date. `POST …/pass` (a parent) makes a new one: the
version is bumped, and the old pass is refused ("replaced"), for a screenshot shared too widely.

The gate's `POST /v1/leave/gate/scan { token }` checks, in order: the shape (not a pass), the
signature (**forged**: "do not release the student; call the coordinator"), the expiry
(**expired**), the leave (unknown = forged), the day (another day's pass), the version (replaced),
and the leave's state (not approved, cancelled — "do not release", already left). Every refusal
writes `LEAVE_PASS_REFUSED` with why. A pass proves the leave; it never replaces the check of who
collects.

## 5. Collectors and custody

**Collectors** (`/v1/leave/collectors`): a parent adds one for their own children (it waits; the
approvers are told); the desk adds one for a family (it waits); the coordinator or the admin adding
one vouches for it (approved at once, the family told). One live record per person (by ID number)
per child. Approve and refuse (with a reason) are the approvers'; approval re-checks custody under
the collector's row lock. A parent withdraws a collector **from their own children** (the collector
stays for another family's child, e.g. a sibling with another parent); staff withdraw it
altogether; leaves still to come that name it are flagged to the family ("choose who collects").
The ID number is shown whole only to the coordinator, the admin and the gate (for today's list);
families and the desk see `••••4567`.

**Custody restrictions** (`/v1/leave/restrictions`, the coordinator's and the admin's): a person
(name, relation, ID number, photo, a linked parent's account) who may not collect a student, with
what it rests on (a court order, a written instruction) and a document; ended with a reason, kept.
Recording one lists the collectors it matches and the leaves to come naming them. **Matching**
(`matchingRestrictions`): the same account, the same ID number (digits and letters, Arabic-Indic
digits folded), or the same name (case, spacing, Arabic diacritics and letter forms folded) when
either side has no ID number to tell two people of one name apart.

**A restricted parent is not the child's family in campus leave:** they do not see the child's leave
or pass, cannot request for the child, cannot be named to collect, and the family screen leaves the
child out. The family never sees a restriction; the desk sees only that one is on file.

## 6. The gate

`GET /v1/leave/gate/today`: today's approved, out and back leaves, and those cancelled after
approval (marked "do not release"), by time, each with only what check-out needs — the student
(grade and section today), the times, whom the family named, everyone authorised (the linked parents
with their phones, the approved collectors with photo and ID number), whether the student may leave
alone, the custody list (name, relation, ID number, photo), what happened at the gate — never the
reason, the note or a document. Counts: to leave, out, back, not collected, late back.

`POST /v1/leave/gate/:id/check-out { collectedBy, idChecked, via, token? }`: today's leave only
(another day's: 404). Who collects is resolved and checked — a linked parent, an approved collector
of this student, the student alone where the policy allows the grade, or **someone else**, who is
never released: a person a restriction names is refused with "Custody restriction: … Do not release
the student — the coordinator has been alerted", recorded (`LEAVE_CHECKOUT_REFUSED`, reason
`custody`) and alerted to every approver (`LEAVE_CUSTODY_ALERT`); anyone else is refused as not
authorised (`not_authorised`, no alert). The check runs before the transaction (so a refusal is
recorded though nothing changes) and again under the row lock. By pass, the token must match the
leave and its version. The family and the student are told who collected and when, and whether it
was someone other than the person named.

`POST /v1/leave/gate/:id/return`: a student out and returning is recorded back (late or not); the
family is told.

## 7. The scheduler: not collected, not back

`flagLeaveExceptions(now)` (`leave-jobs.services.ts`) runs every scheduler tick
(`jobs/session-closer.ts`). An approved leave not checked out by its leave time plus the grace is
flagged *not collected*; a student out, returning, and not back by the return time plus the grace is
flagged *late back*. Each flag is **claimed** by a guarded update (`no_show_at IS NULL` and the
state that earns it), and its audit row and its notices (the family, and every approver) are written
in that transaction — so a second instance at the same tick claims nothing and tells nobody twice,
and a failure rolls back for the next tick (STATE_AUDIT ST-06, ST-12). Days missed by a stopped
scheduler are caught up. 08t2 proves it with two instances reaching the leave while its row is held,
a later tick claiming nothing, and a late family still collecting.

## 8. History and reports

- `GET /v1/leave/requests` — a family: its children's, from 60 days back on; staff: by student (with
  `family=true`, every student sharing an approved parent), date, range, status (default: today).
- `GET /v1/leave/requests/:id` — the leave with its live warnings, its series, and (staff) its audit
  history.
- `GET /v1/leave/students/:studentId` — the desk, the coordinator, the admin: the student, siblings,
  this term's counts by reason, not collected, late back, every leave, collectors, and (coordinator,
  admin) every restriction, ended ones included; the desk sees only that one is on file.
- `GET /v1/leave/reports?from&to` — totals (requests, approved, waiting, refused, cancelled, taken,
  back, not collected, late back, sent home by the school, average time out), counts by reason,
  grade, section (each the student's **on the day**), month, weekday and origin, the students who
  leave most; `…/reports/csv` — every leave in the range, one row each, formula-safe cells.
- `GET /v1/leave/teaching?date` — the signed-in account's own teaching (a linked teacher record):
  each of its lessons that day with the students leaving or out during it.

## 9. Contracts

**Provided — for F3 (attendance): `getLeaveCoverage(studentId, date)`** (`leave.services.ts`):

```ts
{ studentId, date, ranges: {
    leaveId, kind: 'left' | 'planned',   // left: checked out (the gate's times); planned: approved, not gone yet
    from: 'HH:MM',                        // the check-out time, or the approved leave time
    to: 'HH:MM' | null,                   // the return recorded, else the approved return, else null (the rest of the day)
    excusedTo: 'HH:MM' | null,            // the approved return (null: the rest of the day)
    returned: boolean, lateReturn: boolean,
    reason: { key, label }, origin: 'parent' | 'desk' | 'school',
}[] }
```

F3 marks a lesson overlapping `[from, excusedTo ?? end of day)` of a `left` range "left early —
excused"; the part past `excusedTo` up to `to` (a late return) is not excused; a `planned` range is
not yet a leave (the student is still in school: "expected to leave"). Pending, refused and cancelled
requests give nothing. Tested in 08t1 and 08t2 (a late return's range).

**Consumed — F1:** `getScheduleFor({ studentId }, date)` and `getScheduleRange` (the lessons a leave
touches: `startsAt < to`, `endsAt > from`, not cancelled; the teacher with cover applied, and the
teacher record's account to notify), `groupMembersBetween` (a teacher's lessons' students), F0a's
`getSchoolDays` (school days, bells, holidays, exam-only days), `sectionOf` membership by date.

**Consumed — F4 (being built in parallel):** `examsFor(studentId, date)` in
`leave-exams.services.ts` is the interface the "exam that day" warning reads; it answers none until
F4 lands, and campus leave builds no exam data. Wiring it: replace its body with F4's
`getExamsFor(studentId, date)` mapped to `{ title, startsAt, endsAt, board }` (the file says how).
Nothing else changes.

## 10. Roles and endpoints

26 endpoints under `/v1/leave`, each with a row in `authz-policy.tsv` for all nine principals:

| | anon | student | parent | officer | fin. admin | admin | coordinator | teacher | gate |
|---|---|---|---|---|---|---|---|---|---|
| family view, pass (read) | D | A | A | D | D | D | D | D | D |
| requests list and read | D | A | A | A | A | A | A | D | D |
| request, cancel, collectors add and withdraw | D | D | A | A | A | A | A | D | D |
| replace a pass | D | D | A | D | D | D | D | D | D |
| approve, reject, queue, collectors approve and refuse, restrictions | D | D | D | D | D | A | A | D | D |
| the gate (today, scan, check-out, return) | D | D | D | D | D | A | A | D | A |
| a student's record, reports, CSV | D | D | D | A | A | A | A | D | D |
| teaching | D | D | D | A | A | A | A | A | A |

`role-grants.ts`: the coordinator `* /v1/leave/*`; the teacher and the gate `GET /v1/leave/teaching`;
the gate the four gate endpoints. The handlers then decide whose records: another family's leave,
pass or collector answers 404; the gate acts on today's leaves only.

## 11. Screens

Staff first (UX_AUDIT §4: the paper version, then ours). Every string is in `lib/i18n-leave.ts`
(Arabic; sentences with names, times and dates as patterns, English runs isolated), checked right to
left; the shared components and tone colours only (the QR code is black on white whatever the theme:
a scanner needs the contrast). No `useQuery` generic added (32 in the app). Navigation: families
**Campus leave**; the coordinator and the admin a **Campus leave** section (Leave requests, Gate,
Leave reports, Leave policy); the gate **Gate** first; the desk **Campus leave**.

| Screen | Route | Who | The paper version, and why this beats it |
|---|---|---|---|
| The approval queue | `/leave/manage` | coordinator, admin | Requests by phone, note and email, written in a sheet; the timetable opened to see what each misses; the sheet scrolled for how often; the family phoned; the teachers never told. Here the queue is by leave time (today, tomorrow, later, too late); one request shows the lessons and teachers it touches, exams, the term's history, the collector's photo and ID, custody notes, the rules it breaks; A approves, R refuses, J/K move; a weekly request is one item; the family, the student and the teachers follow by themselves. |
| The day | `/leave/manage` (The day) | coordinator, admin, desk | The gate's list typed each morning. Any day's leave with status and what happened at the gate, a link to each student. |
| Collectors to approve | `/leave/manage` (Collectors) | coordinator, admin | Photocopies of IDs in a drawer. Each with photo, ID, children, who added it, and a warning when a custody note matches. |
| A request at the desk | `/leave/manage` (New request), the Student 360, the student record | desk, coordinator, admin | A slip filled for the parent, then a call to the office. Search, pick, the same form the family uses plus "which parent asked", "the school sends them home" and "approve it now". |
| A student's leave record | `/leave/students/[id]` | desk, coordinator, admin | A filter on the leave sheet, a second sheet of collectors, a folder of court orders. Everything on one page: counts, every leave (with the siblings on one switch), who may collect, and for the coordinator who may not, each added or ended in place. |
| The gate | `/gate` | gate, coordinator, admin | A list from the office, a call for every change, a parent at the barrier while the guard rings the office. Today's list refreshing itself; a scanner box that keeps the focus (a USB or Bluetooth QR scanner types into it); the camera (the browser's barcode reader, else jsQR); a sheet per student with everyone authorised and anyone who may not collect in red; one tap for who, one for "ID seen", one to check out; "DO NOT RELEASE" when a custody note names the person; a return in one tap. Built for 390 px and 1024 px. |
| Reports | `/leave/reports` | desk, coordinator, admin | A pivot rebuilt by hand monthly with stale grades typed in. Presets and a range; totals; by reason, grade, section, month, weekday and origin; the students who leave most; every leave with filters; the whole range for Excel. |
| Leave policy | `/leave/policy` | coordinator, admin | A paragraph in a handbook. The ten rules as cards (the Settings screen's), each change with a reason, audited; the Settings screen gains inputs for times, minutes, counts, grades, roles and a list of reasons. |
| The family's leave | `/leave` | parent, student | A note in the bag, a call to check it arrived. The children's leave with status; the pass full-screen (QR, name, date, time, who collects; a new pass if shared by mistake); the request in one screen (today/tomorrow in one tap, reasons as buttons, who may collect as cards, the rules said first, weekly repeats); collectors with photo, masked ID, the school's decision, withdraw. Phone-first; a student sees their leave and pass. |
| Student 360 and student record | `/desk`, `/students/[id]` | desk, coordinator, admin | The leave card: what is coming, this term, custody on file, a request made there. |
| A teacher's Today | `/today` | any account teaching | "Leaving during your lessons": each lesson with who leaves, out or back. |

Screenshots: `.audit/leave-evidence/screens/` (English and `-ar`).

## 12. Tests

| File | Proves |
|---|---|
| `08t1-campus-leave` | each request path (parent, desk for a family, the school sending a student home) and what is refused (a student, a teacher, the gate; another family's child; a past day; a holiday; a time passed; after the last bell; an unknown reason; an unlinked parent; alone in grade 11; an overlap; the desk's "school" origin); approval with the queue's lessons, teachers, history (and a teacher of an untouched lesson not told), the approver-roles setting, a refusal's reason; a recurring request skipping a holiday, approved as one, cancelled date by date and as one; the warnings (cut-off, notice, limit, exam-only day), refuse mode, auto-approval, alone grades; collectors (waiting, masked, approval before the leave's, a sibling's other parent withdrawing for their child only, desk and coordinator entries, refusal); custody (a matching collector not approved, a family's add refused, a restricted father out of the family, the approver told and the family not, three custody refusals at the gate alerted, an unknown person refused without an alert, the mother collecting, a restriction ended); the gate and the pass (only today's, only what check-out needs, scan, check-out by pass, repeats refused, a student alone back later); passes refused (forged twice, expired, malformed, another day's, replaced, cancelled, each recorded); cancelling (teachers told); history and reports and CSV; `getLeaveCoverage`; a teacher's lessons |
| `08t2-campus-leave-races` | approve/cancel both orders and ten unforced; check-out/cancel both orders; two gate staff; two approvers; two approvers on one weekly request; two requests for one student; a no-show and a late return each flagged once by two scheduler instances, a later tick nothing, the late family still collecting, the return recorded and F3's late part |
| `05` F2 case | another family: 404 on the leave, pass, lists, collectors, photos, cancel, request, add, withdraw, and nothing changed; another class: a teacher reads nothing; the gate: today's list only, another day's leave 404 at check-out and return, its pass refused, collectors, restrictions, a student's record, reports, the queue and approval 403, photos only for today's students, never the custody document |
| `04` | the 26 endpoints for the nine principals |
| `09c-leave-invariants` | over every row the suite leaves: an audit row per step (requested once; approved, refused, cancelled, out, back, each flag exactly once; a pass version counting its replacements); approved before taken, out before back, never cancelled once taken; no two standing leaves overlapping; whoever collected was entitled then (a linked parent, an approved collector of that student, never a person an active restriction named); a series' dates its own; collectors and restrictions on record |
| `08f` | the settings map names the ten leave keys (changed assertion, trail row) |

Tests reach past the API in three places, each an honest boundary: the scheduler step
(`flagLeaveExceptions`, as `runPaymentDeadlines` does), `getLeaveCoverage` (F3's in-process
contract), and `signLeavePass` to make a genuinely signed but expired pass.

**Controls** (`.audit/leave-evidence/controls.py`, logs in `controls/`, one trail row each): every
guard undone once, its tests red, restored — C1 approval's lock, status check and guarded update; C2
cancellation's; C3 check-out's state check and guarded update; C4 the no-show claim; C5 the
late-return claim; C6 custody read at check-out; C7 the pass's signature; C8 its expiry; C9 its
version; C10 the gate's today-only; C11 a family's own children; C12 a restricted parent outside the
family; C13 the approver check; C14 a collector approved before the leave; C15 the overlap check; C16
the gate's photos for today's students only; C17 a collector a custody note matches refused approval;
C18 refuse mode; C19 the student's request lock; C20 the restriction's account match (first green —
the father's restriction also matched him by name — so 08t1 now names him by his legal name, and
red); C21 the series lock.

**Time:** today's scenarios make today a school day whose bells run 00:00–23:59 (`makeTodayASchoolDay`
in `helpers.ts`), so they run on any day; the one same-day family request is for 23:58 and cannot run
in the last two minutes before midnight in Cairo. Far dates run in academic years 26–28 years ahead.

## 13. Decisions and why

- **The pass proves the leave, not the person.** The gate always records who collected and checks
  them against the authorised list and the restrictions; a pass looked up by name is allowed
  (SCL's too), a forged or stale one is refused and recorded.
- **Flags are not states.** A no-show or a late return is a fact about the day, not the end of the
  leave: a family arriving late still collects, a student back late is still recorded back.
- **The gate checks the named person against everyone authorised**, not only the one the family
  named: any linked parent or approved collector may collect, and the family is told when it was
  someone else.
- **A restricted parent is outside the family for leave** (no view, no request, no pass, no
  collection). Showing a restricted parent that a child leaves at 11:00 with someone else could put
  the child at risk. The owner may decide otherwise (§15).
- **Custody matching by name when an ID is missing.** A false alarm at the gate costs a call to the
  coordinator; a missed match costs a child.
- **Warnings by default, refusals by choice.** The plan names the cut-off, the notice and the limit
  as warnings to the approver; a school that wants them enforced turns `familyRules` to refuse.
- **Staff may record a time already passed today** (a parent phoning from the gate, a student sent
  home at 9:00); families ask ahead.
- **No limit on how far ahead a request may be.** The school's calendar decides which days are
  school days; the first draft's 180-day limit was dropped (it served nothing but made far-dated
  scenarios impossible).
- **Grade on the leave's date** decides leaving alone (F0a's "today's grade" for today's leave, the
  grade of that academic year for a later one).
- **Notices inside the transaction** for every step and every flag, so a flag's notice is sent
  exactly once with its claim.
- **A series decision locks the series first**, one lock order for everyone who decides a weekly
  request, so two approvers cannot deadlock on two of its dates.

## 14. Deferred, and why

- **Email and push.** Every step is an in-app notification (the notification centre, translated);
  emails for leave were not added. The existing email layer is per-template; a later step can mail
  `LEAVE_APPROVED` and `LEAVE_CHECKED_OUT`.
- **Exams that day** answer none until F4's `getExamsFor` is wired in (§9).
- **Student photos at the gate.** Avatars are owner-read (F0a); the gate sees collectors' and
  restricted persons' photos, not the student's.
- **An `audit_log.created_at` of commit order.** It is the transaction's start (`now()`), so the rows of
  two racing transactions can read out of commit order (seen once in ten unforced races); the leave
  rows are right and the tests assert what each transaction found. A default of `clock_timestamp()`
  on F0's table would fix it everywhere: the lead's table (trail row "finding").
- **Editing a collector.** A change of name, ID or photo is a withdrawal and a new collector (the
  gate relies on the approved record).

## 15. Questions for the owner (through the coordinator)

1. **Leaving alone:** which grades may leave alone? Default none (`leave.aloneGrades`).
2. **The cut-off and the notice:** 10:00 and 60 minutes are guesses; warn or refuse?
3. **A restricted parent:** may a parent under a custody note see the child's leave at all (today:
   no)?
4. **Who approves:** the coordinator and the admin today; does the school want named approvers per
   grade?
5. **No-shows:** after how long, and who is told (today the family and the approvers)?
6. **Collectors:** should the desk's entry of a collector (with the ID card in hand) be approved at
   once, like the coordinator's?
7. F-05 (DISCOVERY.md): the school's own leave slip, to compare its fields with these.

## 16. Progress log

- 2026-09-30 03:20Z — started on `feature/campus-leave` from `origin/feature/scheduling` 9569dd9;
  baseline suite green (27 files, 348 passed, 1 todo).
- 03:40Z — backend first cut 0db5076: migration 0042_campus_leave, ten `leave.*` settings, services
  and 26 endpoints under `/v1/leave`, policy rows; the 04 matrix green.
- (interrupted by the account's spend limit; resumed with nothing lost: the working tree held the
  service fixes and the first scenario file.)
- 04:14Z — `08t1-campus-leave` green (12 scenarios) at 3f2fcbb. Fixes found by it: a series row
  written before its dates (FK), a setting's empty value stored as JSON null, a custody match
  checked before a duplicate collector, report timestamps parsed.
- 04:27Z — 08t2 races and the scheduler, the 05 F2 case, 09c invariants (2f30ea9); an audit-order
  finding for the lead.
- 04:30Z — the full suite in local time red once at 2f30ea9: 08f's settings map did not name the
  leave keys; assertion extended (trail row).
- 04:54Z — the web screens (49ae596).
- 05:05–05:20Z — the running system built and every screen driven in English and Arabic, phone and
  tablet widths for the gate and the family; fixes committed (56298eb).
- 05:24Z — suite green in local time at 56298eb (30 files, 376 passed); with `TZ=UTC` red once: a
  collector's children came back unordered (order fixed in the query, 87fb997).
- 05:28–05:34Z — controls C1–C21 (C20 first green: 08t1 made to catch it); a series decision locks
  the series first, with its race (62dd523).
- 05:40Z — gates green at 62dd523: api and web check-types clean; the suite in local time and with
  `TZ=UTC`, 30 files, 378 passed, 1 todo each. Pushed `feature/campus-leave`.
