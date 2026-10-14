# F6b — The reservation cycle only: hide what is outside it

**Spec:** FEATURES_PLAN.md §1 "F6b" (14 Oct 2026). **Branch:** `feature/reservation-focus` (worktree
`.claude/worktrees/reservation-focus`), from main b6857cb; main e16e8e0 (F6a) merged in at e225805. **Databases:** `igcse_focus_dev` (a copy of
`igcse_template_dev`), `igcse_focus_test`. **Ports:** API 3161, web 3160. **Built by:** one Opus 5.5
agent end to end (the owner's instruction); the lead reads the diff, runs the gates, drives every role
and merges after F6a. **Trail:** `.audit/reservation-focus.tsv`. **Evidence:**
`.audit/reservation-focus-evidence/`.

The owner, 14 Oct 2026: *"we are currently purely focusing and prioritizing the reservation system only
and its complete cycle … any items in the sidebar, any items that do not belong in this lifecycle should
just be hidden for now and we will work on them later after we finalize and perfect the reservation
system"* — and the standard: the forms' author is the admin, the forms' fillers are the families, and the
UI should feel like *"That was exactly what I was going to do next and it's here in front of me."*

**In one sentence.** One switch hides every screen outside the reservation cycle from every sidebar and
every link on the screens that stay, orders each staff sidebar by the cycle's stages, and lands every
role on the cycle's next step for them — read from the endpoints that already exist; no page, route or
endpoint is removed, and switching it off gives back exactly what was there.

---

## 1. The switch and the list

Everything lives in **`apps/web/lib/reservation-focus.ts`**:

| Name | What it is |
|---|---|
| `RESERVATION_CYCLE_ONLY` | the switch (`true`). Set it to `false` and every sidebar, landing and link is as it was on main b6857cb — proved on the running system (§6). |
| `OUTSIDE_THE_CYCLE` | per role (admin, coordinator, finance admin, finance officer, teacher, gate, parent, student), the screens outside the cycle that the role would otherwise reach from its sidebar or from a link on one of its kept screens. A path hides itself and everything under it. |
| `CYCLE_LANDING` | per role, where it lands after sign-in and its sidebar's first item: `/` for the admin, coordinator, teacher, gate, parent and student; `/desk` for both finance roles. |
| `CYCLE_STAGES` | the staff sidebar's order: one group per stage of the cycle (Set up · Reserve and pay · Follow up · Money · Entries to the board · Account), each holding the role's kept items in this order. |
| `STAGE_OVERRIDE` | the one exception: the finance officer's Sessions sits under Follow up (the officer reads a session for its Money and To verify tabs, never its sheet or fees). |
| `isOutsideTheCycle(role, href)` | the sidebar's test, per role. |
| `leadsOutsideTheCycle(href)` | the test for a link on a kept screen. A screen is outside the cycle or not whoever looks at it — the per-role lists differ only in which screens each role reaches — so a link reads every role's list, and the component drawing it need not know the viewer. |
| `cycleLandingFor(role)`, `cycleStageOf(role, href)` | the landing and the stage of an item. |

**Who reads it.** `components/nav-shell.tsx` (`getCycleNavSections`: the role's items as before, less its
list; a family keeps its own groups — Registration, Financial, Account — which already run in the
cycle's order; staff get the landing first, then the stages; labels and icons are the items' own);
`app/(auth)/sign-in/page.tsx` (the redirect after sign-in); `app/(app)/page.tsx` (the landing on `/`);
`app/(app)/desk/desk.client.tsx` (the desk's Today); and the six kept screens with links that led out
(§4). With the switch off, `getCycleNavSections` returns `getNavSections` unchanged, the sign-in page's
own `roleRedirect` runs, `/` redirects staff as before and shows the old home card, the desk has no
Today, and every link is drawn.

---

## 2. Kept and hidden, role by role

Counts are the sidebar's items, read from the drive (`before/before-sidebars.json`,
`after/after-sidebars.json`). "Home" is the new landing on `/` (§3).

| Role | Before | After | Hidden | Added |
|---|---|---|---|---|
| Admin | 41 | 24 | 18 | Home |
| Coordinator | 26 | 14 | 13 | Home |
| Finance admin | 16 | 13 | 3 | — |
| Finance officer | 12 | 9 | 3 | — |
| Teacher (placeholder account) | 6 | 3 | 4 | Home |
| Gate (placeholder account) | 3 | 3 | 1 | Home |
| Parent | 14 | 12 | 2 | — |
| Student | 12 | 9 | 3 | — |

A member of staff linked to a teacher record also had My Teaching, Forecast Grades and Invigilation;
they are on every staff list (hidden). The reasons below are the plan's list (FEATURES_PLAN.md §1 F6b,
"The cycle") where it names the screen, and the owner's words where it is silent; **in doubt** marks a
screen kept because the doubt was real.

### 2.1 Admin (41 → 24)

| Screen | Before (group) | After | Why |
|---|---|---|---|
| Dashboard `/admin/dashboard` | first | **hidden** | "any dashboard that is not the cycle's next step"; the landing (§3.1) replaces it, its setup warnings included |
| Today `/today` | first | **hidden** | the school's day |
| Students `/students` | Academic | Reserve and pay | the student record a reservation reads: the grade decides what a student may reserve ("recorded on the student's page before they can register"), leaving refuses new lines |
| Sections, Course Enrolment, Academic Year, Calendar, Bell Schedules, Rooms `/academic/*` | Academic | **hidden** | named outside in the plan |
| Exam Deadlines `/exams/deadlines` | Exams | Entries to the board | the series' deadlines |
| Candidates `/exams/candidates` | Exams | **hidden** | named outside (see §8, Q1) |
| Exam Entries `/exams/entries`, Entry Lists `/exams/entry-lists` | Exams | Entries to the board | the entries derived from the lines and the boards' lists |
| Forecast Grades, Exam Timetable, Exam Days, Exam Results, Certificates | Exams | **hidden** | named outside |
| Exam Catalogue `/exams/catalogue` | Exams | Set up | the subjects' papers on the Catalogue |
| Board Series `/exams/series` | Exams | Set up | the boards' dates (F6a also sets them from the session) |
| Board Services `/exams/services` | Exams | Set up | **in doubt**: the services a reservation can carry and their fees per series (RESERVATIONS_REWORK.md §1 lists Services among the admin's screens); its remark services belong to remarks, which are outside (§8, Q3) |
| The Desk `/desk` | Management | Reserve and pay | the desk reserves on the family's behalf and takes the money |
| Team `/admin/team` | Management | Set up | the staff who run the desk and the teacher records the session names ("Teaches as") |
| Day-one Import `/imports` | Management | Set up | named in the cycle |
| Settings `/settings` | Management | Set up | "the settings behind them" |
| Sessions `/admin/sessions` | Management | Set up | the session: its sheet, teachers, fees, Money and To verify tabs |
| Subjects `/admin/subjects` | Management | Set up | **in doubt**: the subject list and each subject's teacher pool, which the session's form draws its teachers from; its fee columns predate the session's fees (§8, Q4) |
| Payments `/admin/payments` | Management | Reserve and pay | the bank-transfer confirmations: paying |
| Escrow `/admin/escrow` | Management | Follow up | the wallet's withdrawal requests: drops and refunds |
| Finance Workbench `/finance` | Management | Money | named in the cycle |
| Charges `/charges` | Management | Reserve and pay | instalments and charges, pushed or asked for |
| School Fees `/admin/school-fees` | Management | Set up | the school fee: the gate before reserving, and its push to families |
| Exceptions `/admin/exceptions` | Management | Follow up | lifting a rule for a family |
| Remarks Desk `/remarks-desk`, Results Entry `/results-entry` | Management | **hidden** | named outside |
| Daily Takings `/takings` | Management | Money | named in the cycle |
| Reports `/admin/reports`, Audit Log `/admin/audit` | Oversight | **hidden** | named outside |
| Messages `/admin/messages` | Oversight | Follow up | reminders and messages |
| Notifications, Profile | Account | Account | the account |
| **Home** `/` | — | first | the landing (§3.1) |

### 2.2 Coordinator (26 → 14)

| Screen | Before | After | Why |
|---|---|---|---|
| Today | first | **hidden** | the school's day |
| Students | Academic | Reserve and pay | the student record (grade, leaving) a reservation reads; the coordinator corrects a cohort |
| Sections, Course Enrolment, Academic Year, Calendar, Bell Schedules, Rooms | Academic | **hidden** | named outside |
| Exam Deadlines, Exam Entries, Entry Lists | Exams | Entries to the board | the entries and the series' deadlines |
| Candidates, Forecast Grades, Exam Timetable, Exam Days, Exam Results, Certificates | Exams | **hidden** | named outside |
| Exam Catalogue, Board Series, Board Services | Exams | Set up | the papers and the boards' dates; Board Services **in doubt** as for the admin |
| Sessions, Day-one Import, Settings | School | Set up | the session's sheet (the coordinator keeps subjects, teachers and items), the import, the settings |
| Exceptions | School | Follow up | the academic gates are the coordinator's to grant |
| Notifications, Profile | Account | Account | the account |
| **Home** `/` | — | first | the landing (§3.1) |

### 2.3 Finance admin (16 → 13)

| Screen | Before | After | Why |
|---|---|---|---|
| The Desk | first | first (the landing) | finance lands on the desk (§3.2) |
| Students | first group | Reserve and pay | the Student 360 at the desk |
| Finance Workbench, Daily Takings | first group | Money | named in the cycle |
| Charges | first group | Reserve and pay | instalments and charges |
| Sessions | first group | Set up | the session's Fees tab (the board fees), Money and To verify |
| Messages | first group | Follow up | the payment reminders |
| Remarks Desk, Results Entry, Certificates | first group | **hidden** | named outside |
| School Fees, Board Services, Settings | Management | Set up | the fees and the settings behind them (Board Services **in doubt**) |
| Exceptions | Management | Follow up | lifting a rule for a family; payment plans |
| Notifications, Profile | Account | Account | the account |

### 2.4 Finance officer (12 → 9)

As the finance admin without the Management group: The Desk (first, the landing); Students, Charges
(Reserve and pay); Sessions, Messages (Follow up — `STAGE_OVERRIDE`: the officer reads a session for its
Money tab and Remind, and its To verify tab); Finance Workbench, Daily Takings (Money); Notifications,
Profile. **Hidden:** Remarks Desk, Results Entry, Certificates (named outside).

### 2.5 Teacher (6 → 3) and gate (3 → 3)

| Screen | Before | After | Why |
|---|---|---|---|
| Today | first | **hidden** | the school's day |
| My Teaching, Forecast Grades, Invigilation (teacher) | first group | **hidden** | teaching, forecasts and invigilation are named outside |
| Notifications, Profile | Account | Account | "a role with nothing in the cycle sees its notifications and profile" |
| **Home** `/` | — | first | the sentence that their screens come later (§3.4) |

### 2.6 Parent (14 → 12)

| Screen | Before (group) | After | Why |
|---|---|---|---|
| Home `/` | first | first | the landing (§3.3) |
| Reserve Subjects, My Registrations, Approvals | Registration | Registration | reserving; a student's reservation waits for the parent's approval |
| History `/registrations/history` | Registration | Registration | **in doubt**: the reservations' own record (each line's changes — reserved, paid, dropped, refunded), part of drops and refunds |
| Remarks `/remarks` | Registration | **hidden** | named outside |
| My Exams `/exams/my` | Registration | **hidden** | its three parts are the exam timetable, the statement of entry the school publishes with it, and results — all after the entries go to the board (§8, Q2) |
| Statement, School Fee, Charges & Instalments, Escrow Balance | Financial | Financial | paying: the statement, the school fee, instalments, the wallet |
| Linked Children, Notifications, Profile | Account | Account | the family's link (needed to reserve for a child) and the account |

The families' groups are kept as they were: they already run reserve → pay → account, and renaming them
would change wording on the families' screens (point 4).

### 2.7 Student (12 → 9)

| Screen | Before (group) | After | Why |
|---|---|---|---|
| Home `/` | first | first | the landing (§3.3) |
| Reserve Subjects, My Registrations, Statement | Registration | Registration | reserving and what it costs |
| History | Registration | Registration | **in doubt**, as for the parent |
| Browse Subjects `/subjects` | Registration | **hidden** | "the students' subject browse" is named outside; the Reserve page lists the session's subjects with their prices |
| Remarks, My Exams | Registration | **hidden** | as for the parent |
| Pending Requests | Requests | Requests | drop and swap requests: drops and refunds |
| Linked Parents, Notifications, Profile | Account | Account | the account |

---

## 3. The landings

Every role lands after sign-in on its sidebar's first item, and that item is the cycle's next step for
it. The drive proves it: in the after drive no role's landing differs from its first item. Each landing
reads endpoints that exist; **no endpoint was added or changed**, so there is no new authz row, no new
05 case and no new scenario.

### 3.1 Admin and coordinator — `/` (`app/(app)/cycle-landing.client.tsx`)

**Reads:** `GET /v1/sessions` (each session's series with their dates, and its money summary: lines,
paid, unpaid, overdue, outstanding), `GET /v1/sessions/:id/offers` (the sheet's rows with their
`warnings`), `GET /v1/sessions/:id/to-verify?show=awaiting`. All three are the admin's and the
coordinator's already.

**Which sessions.** Every open one, then every one being prepared (a draft — "the next"), then the
closed ones whose cycle is not over (families still owing, or paid lines whose entry deadline has not
passed or is not set). With none open or being prepared, an amber line says so and — for the admin — the
one primary button is **Start the next session** (`/admin/sessions`, where New session copies the last
one); the coordinator reads "The admin starts the next session". With nothing in progress at all, the
last session is shown as the one the next starts from.

**Each session's card**, in the cycle's order, each finding with the one action that deals with it:

| Group | Finding (shown only when true) | Action |
|---|---|---|
| (header) | the session's name and status (Draft / Open / Closed) and where it stands: "Being prepared: not open to families yet. Families reserve from … to …" · "Open: families reserve until …. Payment due …" · "Closed to new reservations." | Open the sheet |
| What the sheet still needs (draft, open) | no subjects yet | Add the subjects → `#subjects` |
| | N subjects have no teacher: who teaches them? (F6a's rule: open with none, or brought across by a copy with none; never a self-study-only subject) | Name the teachers → `#subjects` |
| | N subjects need their papers set on the Catalogue (`unmapped`) | Open the Catalogue |
| | N subjects have no board fee (`no_fee`) | Set the fees → `#fees` |
| | N board fees not published yet — "families can reserve these subjects, not pay for them, until the fee is confirmed" | Confirm the fees → `#fees` |
| | *Series*: Dates not set (no entry deadline and no exam start: no line can be taken) | Set the dates → the session (F6a's dates dialog on its header) |
| | none of these: "Nothing is missing: every subject has its teachers, its fees and its dates." | — |
| Sittings to verify | N declared sittings to verify | Verify them → `#verify` |
| What families are doing | N reservations · N paid · N unpaid (EGP … outstanding — the admin only, as the Sessions list shows it) · N overdue; or "No family has reserved yet." | the admin: Remind the overdue families / See who has not paid → `#money`; Reserve for a family at the desk; the coordinator has no Money tab, so no action |
| Entries to the board | *Series*: entries by *date* (passed) · or "no entry deadline yet" | Exam entries → `/exams/entries?series=` once a line is paid; Set the dates |

The first action on the page, in this order, is the one filled button; every other is outlined — one
thing is in front of her.

**At each stage (driven, §6; files under `.audit/reservation-focus-evidence/`):** a draft with a
subject nobody teaches, two subjects with no board fee and the series' dates not set
(`stages/stage-draft-admin-*`, `stage-draft-coordinator-*`); open, before any family
(`stage-open-admin-*`); open with three lines reserved and one fee not published
(`stage-reserved-admin-*`, `-coordinator-*`); after a desk payment (`after/after-admin-*`,
`after-coordinator-*`); closed, with no session open or being prepared — the amber line with **Start the
next session**, and the closed sessions whose entries are still ahead with their entry deadline and
**Exam entries** (`stages/stage-closed-admin-*`, `-coordinator-*`).

The spreadsheet version, for the record (UX_AUDIT.md §4): open the links sheet, scan every row for a
missing teacher or fee, open the response sheet and count who has paid, keep the boards' dates in mind.
Here the scan is done on arrival and each finding opens the place that fixes it — no step to remember.

### 3.2 Finance — the desk with Today (`app/(app)/desk/desk-today.client.tsx`)

**Reads:** `GET /v1/payments/daily-takings?date=` (today, the browser's day, as Daily Takings reads it),
`GET /v1/sessions` (the sessions with unpaid lines), `GET /v1/sessions/:id/money?filter=unpaid` for each
of them (their due dates), `GET /v1/charges?status=pending_payment` (instalments and charges owed). All
finance's already.

**Shows**, above the desk's search, three tiles — each a link: **Collected today** (EGP, the number of
payments → Daily takings); **Due today** (EGP and items due on the school's day, Cairo; and "Next due
*date*: EGP …" so a quiet day still says what is coming → the session's Money tab, or Charges when more
than one session owes); **Overdue** (EGP and items past their due date → the Money tab with Remind). With
more than one session owing, a line per session follows. The desk itself is unchanged. Driven: due today
EGP 34,050 (`stage-due-today-finance_officer-*`), collected today EGP 11,350 after a desk payment
(`after-finance_*`).

### 3.3 Parent and student — `/` (`app/(app)/family-next.client.tsx`)

**Reads:** `GET /v1/users/me/home-summary` (the school fee, approvals, receipts to return, what is
payable now), `GET /v1/sessions/active` and `/upcoming` (the parent may preregister), `GET /v1/statement`
(each child's lines per session with what is outstanding and its due date), `GET
/v1/registrations/eligibility` per child and reservable session (the Reserve page's own check). It
replaces the old home card ("What needs you") while the switch is on; the welcome line, the session
banner and the quick links stay (Browse Subjects hidden).

**Per child** (a student: themselves), in the cycle's order:

| Step | Shown when | Action |
|---|---|---|
| School fee | the year's fee is required and unpaid: "reserving opens after it" (a student: "ask your parent") | Pay the school fee |
| Reserve | a session is open (or, for a parent, opening — preregistration) and the child has nothing in it | Reserve subjects → `/register` (F6a preselects the only open session) |
| — | the child may not reserve in it | the school's own reason (e.g. a graduate), no action |
| Approval | a student's reservation waits for the parent | Approve (a student reads that it waits) |
| Pay — the reminder | a session has something owed: "*Session*: EGP … to pay — due by *date*" or "overdue since *date*"; a line on a board fee not published yet is named apart ("Plus EGP … once the board publishes its fee") so the amount shown is what Pay now takes | Pay now → `/checkout?ids=` (the payable lines); a student: Ask your parent: see the statement |
| Done | everything reserved in an open session is paid | Add a subject / Reserve another subject |
| Receipts, requests | receipts to bring back; drop or swap requests | My Registrations; Review / My requests |

The header button is always the statement (**The family statement** / **My statement**); the wallet's
free balance closes the card. A parent with no linked child gets "Start by linking your child". Driven:
open (`stage-open-parent2-*`: Reserve subjects), a graduate (`stage-open-parent-*`: the reason),
reserved (`stage-reserved-parent2-*`, `-student2-*`), due today, after a payment (`after-parent2-*`).

The form version: one Google Form per subject, the seven identity questions each time, no price, no
due date, nothing to look back at. Here the family sees each session's state and the one next thing.

### 3.4 Teacher and gate — `/` (`app/(app)/later-landing.client.tsx`)

**Reads:** `GET /v1/notifications?limit=5`. **Shows:** "Your screens come later — the school is starting
with reservations and fees; your teaching screens (lessons, attendance, forecasts) / the gate's screens
(the day's leave list and check-out) come after them. Until then, your notifications and your profile are
here." Then the latest five notifications (See every notification) and the profile (Open your profile).

---

## 4. Links on kept screens

Hidden by the same switch (`leadsOutsideTheCycle`), each where it is drawn:

| Kept screen | Link | Treatment |
|---|---|---|
| Student record `/students/[id]` | "Exams: entries, timetable, results" (`/exams/my`), "Candidate details" (`/exams/candidates`) | buttons hidden (their row too when both are) |
| Student record and the desk's Student 360 (`components/student-academic-panel.tsx`) | the section's name (`/academic/sections`); "Move them to a section of their grade" | the name drawn as text; the button hidden |
| The same panel's "Subjects this year" (`components/student-enrolment-block.tsx`) | "Change the enrolment" (`/academic/enrolment`) | hidden; the block itself stays (point 4: no layout change beyond links — §8, Q5) |
| Exam Entries | "Forecast grades" (`/exams/forecasts`) | hidden |
| Exam Deadlines | "Open forecasts / candidates / the timetable / results / certificates" on those dates' rows | the link hidden, the row kept (§8, Q6) |
| Import result `/imports/[id]` | "Sections" and "Course enrolment" in "See them on Students, Sections and Course enrolment" | named, not linked (the sentence keeps its words) |
| Home `/` (family) | the Browse Subjects card (`/subjects`) | hidden |
| Sign-in | the admin's redirect to `/admin/dashboard` | the landing |

**Kept as steps of the cycle** ("a link that is a step of the cycle stays"): on Entry Lists, a row's fix
link to the candidate's details (candidate number, legal name, date of birth, UCI, access arrangements)
and to a missing forecast grade; on Exam Entries, a candidate's "Candidate details". Each fixes what the
board would refuse — part of sending the entries.

**Checked on the running system** (`after/links-on-kept-screens.json`): every kept screen of every role —
each sidebar item, plus the student record, the Session screen's tabs, Exam Entries and Entry Lists on a
series, the desk with a student open, the Reserve page and the checkout — 108 screens, and no link in
their main area opens a screen on any role's list.

The Session screen (F6a's files) has no link that leads outside; nothing there was touched.

---

## 5. Decisions and why

1. **One list per role, one test for links.** The plan asks for "one list … per role". Per role is what
   a sidebar needs; a link on a shared screen (the student panel is on the desk and the student record)
   reads the union, because a screen is outside or not whoever looks at it. No screen is kept for one role
   and hidden for another, so the union never hides a link a viewer should see.
2. **Staff sidebars regrouped by stage; families' kept as they were.** "The sidebar's order follows the
   cycle's order": the staff groups (Academic, Exams, Management, Oversight) cut across the cycle, so they
   are replaced by its stages. The families' groups already follow it, and renaming them would change the
   families' wording (point 4).
3. **The admin's and coordinator's landing is a new page on `/`, not the Session screen.** The Session
   screen is F6a's and must not change; the landing reads the same endpoints and links into its tabs by
   hash (`#subjects`, `#fees`, `#money`, `#verify`), which the screen already honours. It shows every open
   session (June and November–January overlap) rather than choosing one.
4. **Finance's landing is the desk itself**, with Today above its search — the plan says "finance on the
   desk with today's due and collected"; the desk's own behaviour is unchanged.
5. **The family's next step replaces the old home card** while the switch is on (the old card is drawn
   again with it off). Its pay amount excludes a line whose board fee is not published, which the API
   refuses to collect, so "Pay now" takes exactly the amount shown.
6. **Eligibility before "Reserve".** The landing asks the API's own eligibility check per child and
   session, so a graduate's parent reads why rather than a button that leads to a refusal.
7. **No new endpoint.** Every landing is built from endpoints the role already holds; the suite is
   unchanged.
8. **Strings.** Every new string is in `lib/i18n-focus.ts` (merged last into the page translator, so a
   word the app already translates keeps its Arabic) or, for the five stage titles, `nav.cycle*` in
   `lib/i18n.tsx`. Numbers, names and dates are their own text nodes. Right to left checked on every
   landing (the `-ar` screenshots).

---

## 6. Proof

| Gate | Result |
|---|---|
| `pnpm --filter web check-types` | green on e8f9619, 00cbbdf and **the merge e225805** |
| `pnpm --filter @repo/api check-types` | green on e8f9619, 00cbbdf and **e225805** |
| API suite, local time, `igcse_focus_test` | before the merge: 34 files, 725 passed, 1 todo — e8f9619 (`suite-local-e8f9619.log`); **on the merge e225805: 35 files, 737 passed, 1 todo** (`suite-local-e225805.log`; F6a's 08u is the 35th) |
| API suite, `TZ=UTC` | before the merge: 34 files, 725 passed, 1 todo — e8f9619 (`suite-utc-e8f9619.log`); **on the merge e225805: 35 files, 737 passed, 1 todo** (`suite-utc-e225805.log`) |
| CI (`.github/workflows/ci.yml`) | run 38637562968 green on bbd3708; run 38641932643 green on 00cbbdf (all four gates: evidence size, API type-check, web type-check, the suite); **run 38646535313 green on 602f980, the commit on top of the merge with main** |
| `useQuery<` count in `apps/web/app` | 19 (the limit is 35); a probe showed the home-summary, sessions and statement responses typed, not `any` |

**The drive** (headless Chrome, `playwright-core` in `/tmp/rf/pw`, `channel: 'chrome'`; every role signs
in through the real sign-in page; English, then Arabic):

- `before/` — every role's landing and sidebar before any change, and the sidebar's first item where it
  differed from the landing; `before-sidebars.json` holds every item.
- `after/` — every role's landing and sidebar after (the landing is now always the first item), plus the
  placeholder family (`parent2`, `student2`); `after-sidebars.json`.
- `stages/` — the landings through the cycle's stages on June 2028, set up through the API only
  (`/tmp/rf/pw/stage.mjs`, `stage2.mjs`): draft with needs → open → reserved → due today → (`after/`, a
  desk payment) → closed (`stage-closed-*`: closing ended the two unpaid lines, as the session closer
  does; the paid one waits for its entry).
- `switch-off/` — the switch set to `false` on the running system: every role's sidebar identical to the
  before drive item by item, and every landing after sign-in the same; then set back.
- `after/reachable-by-url.json` — every hidden screen opened by its URL as each role that had it: 48 of
  48 answered 200 and rendered; none is in a sidebar.
- `after/links-on-kept-screens.json` — §4's check.

The kept/hidden table (§2) was checked line by line against `after-sidebars.json` and the after
screenshots: every "hidden" line is absent, every kept line present in the group the table names, and
"Home" first where the table adds it.

**Not reached in the drive:** the overdue state. A line's due date keeps a grace after its reservation,
so moving the session's payment date into the past left the lines due on 22 Oct; reaching it needs the
clock moved. The overdue path is the same code with the `overdue` flags the endpoints already return
(the Money tab shows them), drawn in red ("overdue since", the Overdue tile, "Remind the overdue
families").

Data: the coordinator, teacher and gate accounts and the family "Parent Placeholder" / "Student
Placeholder" were made through the API on `igcse_focus_dev` only; no school name, family name or phone
number appears in this branch.

---

## 7. Deferred, and why

- **A link that preselects one of two open sessions** on the Reserve page (`/register?session=`): the
  page is F6a's file; with one open session F6a already preselects it. For F6 or after F6a lands.
- **The overdue state on screen** (above): needs the clock moved; the code path is the one the Money tab
  uses.
- **Board Services, Subjects, History, My Exams' statement of entry, Candidates** — kept or hidden as §2
  says, each with a question below; nothing else on those screens was changed.
- **Merging main — done.** F6a landed on main (fd436de, main e16e8e0) at the end of this work; on the
  coordinator's word `origin/main` was merged into the branch as its own commit **e225805** (plumbing
  from lead-env, `/tmp/rf/merge.py`). No conflict: this branch touches none of F6a's files. After the
  merge, driven: every role's sidebar and landing identical to the pre-merge after drive
  (`after-merge/`), §4's link check again clean (`after-merge/links-on-kept-screens.json`), and the
  landing's links into F6a's Session screen open the tab they name (`#subjects`, `#fees`, `#money`,
  `#verify`), its header's series line being the dates button "Set the dates" leads to. F6a's
  i18n-sessions.ts translates "reservation(s)" and "entries by" as this branch does; the sessions
  dictionary is merged into the translator before this branch's, so its Arabic is used — the same words.

---

## 8. Questions for the owner

1. **Candidates.** The plan names Candidates outside the cycle, but the boards' entry lists refuse an
   entry without a candidate number, legal name, date of birth or UCI, which are recorded on Candidates.
   Built: hidden from the sidebar, reachable from Entry Lists' and Exam Entries' fix links (steps of the
   cycle). Should Candidates be in the cycle's sidebar?
2. **My Exams for families.** Hidden: its parts are the exam timetable, the statement of entry the school
   publishes with it, and results. Once entries are sent, should families see their statement of entry?
3. **Board Services.** Kept (in doubt): the services a reservation can carry with their fees per series;
   remark services among them belong to remarks. Keep it in the cycle?
4. **Subjects (`/admin/subjects`).** Kept (in doubt): the subject list and each subject's teacher pool,
   which the session's form draws from; its fee columns predate the session's fees.
5. **"Subjects this year" on the Student 360** (course enrolment) — its link is hidden, the block stays
   (point 4 allows only links). Hide the block too?
6. **Exam Deadlines** lists every board date — forecasts due, results day, certificates — not only the
   entry deadlines; their links are hidden, their rows stay. Show only the entry dates?
7. **History** for families: kept (in doubt) as the reservations' record of drops and refunds. Keep it?

---

## 9. Progress log (UTC)

- 14 Oct 20:28Z — setup: worktree installed and built; `igcse_focus_dev` from the template, migrated
  (59 of 59); env files with ports 3161/3160; dev servers started (API pid 84853, web pid 84878); the
  coordinator, teacher and gate placeholder accounts made through `POST /v1/users` on the dev database.
  Git by plumbing from lead-env (`/tmp/rf/commit.py`).
- 20:33Z — the before drive (`before/`).
- 21:05Z — built: the switch and its list, the sidebar, the four landings, the sign-in redirect, the
  hidden links, the Arabic; committed bbd3708 and pushed (CI 38637562968 green).
- 21:08–21:20Z — the stages driven on June 2028 (draft, open, reserved, due today, a desk payment);
  refinements from what the drive showed: closed sessions still in progress on the landing, one filled
  button per page, the family's eligibility and payable amount, the desk's next due date (e8f9619).
- 21:21Z — the suite in local time green on e8f9619; 21:23Z — the switch proved off and on, every hidden
  screen opened by URL; 21:28Z — §4's link check; 21:29Z — the suite with `TZ=UTC` green, both
  type-checks green; 21:32Z — June 2028 closed through the API, the closed stage driven; 21:33Z — this
  document (73e7515).
- 21:36Z — the family's landing waits for the statement too (40745c2); 21:39Z — every new string checked
  against the dictionaries, the landings' own loading and error sentences (00cbbdf); both type-checks
  green on 00cbbdf; no file under `apps/api` or `packages` differs from b6857cb, so the suite's runs on
  e8f9619 stand for the branch; CI on each push (runs superseded by a newer push are cancelled by the
  workflow's concurrency rule).
- 21:51Z — CI 38641932643 green on 00cbbdf recorded (ccc0d28; its own run 38643458655 green).
- 22:02Z — F6a on main (the coordinator's message): `origin/main` e16e8e0 merged as e225805, no conflict;
  db, validations and storage rebuilt; both type-checks green on the merge; the suite in local time green
  on it (35 files, 737 passed, 1 todo); the API dev server restarted on the merged code; every role
  driven again (`after-merge/`, identical sidebars and landings), the link check again clean, the
  Session screen's tabs and dates button reached from the landing's links; 22:16Z — the suite with
  `TZ=UTC` green on the merge (35 files, 737 passed, 1 todo). Then this document, the evidence and the
  trail committed on top of the merge and pushed; the CI run on that push is the merge's.
- Dev servers left running for the lead's drive: API on 3161 (pnpm pid 34702, node 34724), web on 3160
  (pnpm pid 84878, node 84888), database `igcse_focus_dev` with June 2028 closed and the placeholder
  family.
- Next if interrupted: the final commit of this document and the evidence, push, CI; F6a's merge is the
  lead's (or this branch's, when told).
