# The cycle decisions — the lead's sixteen decisions of 16 Oct 2026, and F6's two read-back notes

**Spec:** FEATURES_PLAN.md §6, "Decided by the lead on 16 Oct 2026" (the owner delegated the sixteen open questions
of F6a, F6b, the cycle follow-ups and F6 on 16 Oct 2026); the lead's answers of 16 Oct 2026 01:11Z to my three
questions (lead-env `.audit/school-forms.tsv`), which widened decision 1 and approved decision 15's anonymous read.
**Branch:** `feature/cycle-decisions` (worktree `.claude/worktrees/cycle-decisions`), from main 19dabff.
**Databases:** `igcse_decisions_dev` (a copy of `igcse_template_dev`), `igcse_decisions_test`. **Ports:** API 3181,
web 3180. **Built by:** one Opus 5.5 implementer. **Trail:** `.audit/cycle-decisions.tsv`. **Evidence:**
`.audit/cycle-decisions-evidence/`: `before/` and `after/` (one JPEG per screen in English and Arabic, with
`readings.json`, what each screen said), `after-set/` and `after-emptied/` (decision 15), `notes/` (F6's notes),
`controls/` (each guard undone, the test red), `migration-0061.txt` (decision 16's migration on a fresh database),
`after-exception/` (decision 1's exception on the Reserve page), `desk-transfer-ar/` (decision 14's desk dialogs in
Arabic), `drive/` (the scripts and the dev data's ids).

**In one sentence.** Each decision is applied exactly as the lead wrote it. A decision marked "no change" changes
nothing. The two rule changes (1, 2) and the new setting (15) each have a scenario and a control. Every changed
screen was driven as the role that reaches it, in English and Arabic, before and after.

**The review of dd68598** (Opus 5.5: "merge after fixes 1, 2") is answered in one round on top of it: item 1 in §1.16
and §6, item 2 in §1.1, item 3 in §2, item 4 in §1.14, item 5 in §9, item 6 in §3, and item 7's nits in the documents
and dictionaries they name.

---

## 1. The sixteen decisions, as applied

### 1 — Self study is a second entry only

**The rule, in one sentence** (the lead's answer of 01:11Z): *a first entry in self-study is refused on a subject the
links sheet offers "Retake (Self Study ONLY)" and on a unit or route marked self study only, unless the item carries
an earlier sitting forward (the A.2. carry forward); the student's exception "self-study on a first entry" is the only
way past it.*

- `apps/api/src/services/line-rules.services.ts` (`assertLineRules`). A first entry in self-study on a self-study-only
  item that carries nothing forward (`c.selfStudyOnly && !needs_prior_series`) asks the gate `gate.selfStudyFirstEntry`.
  Without the exception it is refused with: "*<subject>* is self study on a second entry only: name the earlier
  sitting, or ask for the exception". On a unit or route the sentence names "*<subject>* — *<item>*". The Arabic is in
  `i18n-import.ts`'s sentence rules: «… دراسة ذاتية في القيد الثاني فقط: سمِّ الدورة السابقة، أو اطلب الاستثناء». The
  taught subject's own refusal ("Subjects can only be taken outside school when retaking or when the school does not
  offer them") is unchanged (§10, question 1).
- `apps/api/src/services/offers-read.services.ts` (the family's read and staff's preview). A first entry in self-study
  is offered on a self-study-only item only when it carries an earlier sitting forward. G-09's allowance for the
  untaught subject is gone. The family's and the preview's option "First entry, self-study (not taught this cycle)" is
  therefore gone from Chemistry. It remains on the A.2. carry-forward route, whose form says "A.2. (Self Study 50%
  fees …)" as its own entry after the AS.
- **The student who holds the exception** (the review of dd68598, item 2). The read for a given student (the
  family's Reserve page, the desk's for that student) adds the first entry in self-study wherever that student holds
  `gate.selfStudyFirstEntry` in a scope that covers the item: `lineExceptions.active(db, studentId,
  ['gate.selfStudyFirstEntry'], { sessionId, subjectId, offerId, offerItemId, boardSeriesId })`, read without a lock
  (the reservation's own `assertLineRules` takes the exception under its lock and uses it up). It is priced for that
  student by `priceLine`, as every option is. The preview, which has no student, is unchanged. The Reserve row says
  "First entry, self-study" on a taught subject and "First entry, self-study (not taught this cycle)" on an untaught
  one (قيد أول، دراسة ذاتية). Once the exception is used, the option goes.
- **The day-one import.** The brief said the import "already treats it as an error naming the exception". That was
  not so. Before this change, 08n-import's row 5 ("Live Subject Self", not taught) was planned as a first entry in
  self-study, with only the information line `self_study_not_taught`. Now the review's own dry run of `assertLineRules`
  refuses the row as `registration_refused`, with the rule's sentence naming the exception. `import/view.ts` is
  unchanged: the import asks the same rule a reservation asks. Staff settle the row as the sentence says, by naming
  the earlier sitting, which makes it a declared retake on To verify (the lead confirmed this at 01:11Z).
  - A row for a student the import itself creates cannot be settled by the exception: no exception can be granted to
    a student who does not exist yet. That row stays refused until staff name an earlier sitting, or the student is
    made, granted the exception and the import reviewed again (§9).
- The settings description of `import.selfStudyOnTaught` and its Arabic now say "Today's rule allows studying outside
  school only on a retake, or on an A.2. that carries the AS forward: any other first entry in self-study is the
  student's exception" (the carry-forward case added by the review of dd68598, item 7).
- **Screens:** `before|after/d01-preview-chemistry-{en,ar}.jpg` shows Chemistry's preview: "First entry, self-study
  (not taught this cycle) · EGP 17,850" is gone and "Retake, self-study — name the sitting" stays.
  `d01-03-reserve-parent-*` shows parent B's Reserve page: Chemistry ticked now defaults to "Retake, self-study".
  `after-exception/d01-03-reserve-parent-{en,ar}.jpg`: after the finance admin grants student B1 the exception
  (`drive/grant-exception.mjs`), the same page offers Chemistry "First entry, self-study (not taught this cycle)" at
  EGP 17,850, and the taught Arabic IAL "First entry, self-study" beside "First entry, in school".

### 2 — An IAL unit sits in October, January or June

- `packages/validations` exports `IAL_UNIT_MONTHS = ['october', 'january', 'june']`.
- `apps/api/src/services/offer.services.ts`: `cashInUnitItems()` finds the unit items (kind `unit`) whose unit belongs,
  through `qualification_unit`, to a qualification with `entry_method = 'units_cash_in'`.
  - `listOffers` marks each item `ialUnit`.
  - `saveOfferForm` refuses a move of such a unit to another month: "*<subject>* — *<unit>*: an IAL unit sits in
    October, January or June, not November". The Arabic is in `i18n-sessions.ts`'s rules. A form that leaves the unit
    where it is is not refused.
- `subjects-tab.client.tsx`: a unit's Sitting offers its own months (`unitMonths`).
  - An IGCSE unit never October or January (as before).
  - An `ialUnit` only the session's months among October, January and June. The month the unit is in now stays on the
    list if it is another, so the list says where the unit is. Under the select: "An IAL unit sits in October, January
    or June." / «تُعقد وحدة IAL في أكتوبر أو يناير أو يونيو.»
  - A unit of no cash-in award keeps every month its board sits.
- **Screens:** `before|after/d02-winter-ial-units-*` shows the winter session's Mathematics A.S./A.L. Each unit's
  Sitting offered October 2026, November 2026 and January 2027 before, and October 2026 and January 2027 after.
- **Enforced on the form only** (accepted as is by the review of dd68598, item 5): the item endpoint and a sheet copied
  from another session can still place an IAL unit in November (§9).

### 3 — Arabic A Level: the family chooses the qualification through the teacher (a label only)

- `offers-read.services.ts`: each item carries `qualification: { code } | null` (the award it enters).
- `components/reservations/reserve.tsx` covers the family's Reserve page, the desk's card and the preview. On a subject
  with qualification items, each teacher is named with the row's qualification as the form names it: "Teacher A
  (Edexcel YAA01)" and "Teacher B (Edexcel 9AA0)". The board's word is the forms' own (Edexcel, Cambridge, Oxford).
- **Screens:** `before|after/d03-preview-arabic-al-*` shows the teacher cells changing from "Teacher B", "Teacher A"
  to "Teacher B (Edexcel 9AA0)", "Teacher A (Edexcel YAA01)".

### 4 — The old drawer's tools stay API-only. No change.

### 5 — Candidates joins "Entries to the board"

- `apps/web/lib/reservation-focus.ts` (F6b's lists; the switch untouched): `/exams/candidates` is off the admin's and
  the coordinator's lists, and in the stage `nav.cycleBoard` before Exam Entries. The Student 360's "Candidate details"
  (admin and coordinator) now shows, as do the entries' fix links. Exam Deadlines' "Open candidates" belongs to a date
  that decision 10 hides.
- **Screens:** `before|after/d05-08-13-admin-sidebar-*` and `d05-coordinator-sidebar-*`. The coordinator went from 14
  to 15 items. `after/reachable.json`: Candidates opens for both roles.

### 6 — My Exams stays hidden. No change; recorded in RESERVATION_FOCUS.md §8 (queued).

### 7 — Board Services stays; its remark services are hidden

- `reservation-focus.ts` gains `remarksHidden()`, which reads the lists as `timetableHidden()` does.
- `services.client.tsx`: rows of kind `remark` are not drawn in the services table or a series' grid, while that is
  true.
  - They are not sent with a save either. The API writes only the rows it is sent, so a save never touches them.
  - The board chips come from the rows shown.
  - The subtitle reads "Cash-in and certificate splits: what each board offers, what it costs in a series and until
    when." / «طلب الشهادة وفصلها: …»
- The API is untouched.
- **Screens:** `before|after/d07-board-services-*` shows the Cambridge rows. Before: Review of marking, Clerical
  re-check, Access to scripts, Priority review, Cash-in, Late cash-in, Certificate split. After: Cash-in, Late
  cash-in, Certificate split.

### 8 — Subjects is hidden from the sidebar

- `/admin/subjects` is on the admin's list. The admin is the only role whose sidebar had it, and no kept screen links
  to it.
- It still opens by URL (`after/reachable.json`: 200, "Subject Management").

### 9 — "Subjects this year" stays, titled in the cycle's words

- `components/student-enrolment-block.tsx`: the title is "This year's subjects and teachers" / «مواد هذا العام
  ومعلموها». The enrolment link stays hidden.
- **Screens:** `before|after/d09-student-record-*`.

### 10 — Exam Deadlines: only the dates that stop entries

- `deadlines.client.tsx`. While `entryDatesOnly()` (a `reservation-focus.ts` helper on the same lists) is true, the
  page lists:
  - the entry and retake deadlines;
  - the exams' start of a series with no entry deadline (one in `seriesWithoutDeadline`), marked "The series has no
    entry deadline: entries close when its exams start." / «لا موعد قيد لهذه الدورة: يُغلق القيد حين تبدأ امتحاناتها.»
    The timetable's to-do on that row (outside the cycle) is not shown.
- Forecasts, arrangements, the exams' end, results and certificates are hidden by the same switch. The board chips and
  the empty state read the dates shown, and the subtitle says what is listed.
- No API change.
- **Screens:** `before|after/d10-exam-deadlines-*`. Before: 25 rows. After: 8 (Pearson January 2027's exams start as
  the cut-off; June 2027's entry and retake deadlines).

### 11 — History stays for families. No change.

### 12 — The words: a section is فصل, a teaching group is مجموعة

| Where | Before | After |
|---|---|---|
| The desk's teacher change, Replace a teacher's result (`lib/groups-followed.ts`) | "The student moves to the class …", "The whole class … goes to …", "… has no class of this subject yet …", "No class of this subject …", "… leaves the class …" | "… the group …" in each |
| Their Arabic (`lib/i18n-reservations.ts`) | ينتقل الطالب إلى فصل …؛ ينتقل فصل … كله إلى …: ويبقى الطالب فيه | ينتقل الطالب إلى مجموعة …؛ تنتقل مجموعة … كلها إلى …: ويبقى الطالب فيها (feminine agreement throughout) |
| Replace a teacher's line (`subjects-tab.client.tsx`, `i18n-sessions.ts`) | "… this year's class of the teacher who leaves …" / وفصل هذا العام | "… this year's group …" / ومجموعة هذا العام |
| Messages, D's dictionary (`i18n-messages.ts`) | Choose a section اختر قسمًا; A section قسم; e.g. Section 11C parents قسم 11C; "Section 11A — Parents" قسم | فصل in each (C's فصل already won for "A section") |
| The base dictionary (`lib/i18n.tsx`) | 'Section': القسم (the composer's label, the Money tab, School Fees' push) | الفصل |
| The import's mapping (`review-mapping.tsx`, `import.validations.ts`, `i18n-import.ts`) | "A per-unit class list", "class lists" / قائمة فصل، قوائم فصول | "group list", "group lists" / قائمة مجموعة، قوائم مجموعات |

F1's مجموعة تدريس already agrees. فصل in the dictionaries now means a section, a school term (الفصل الدراسي), or the
certificate split (فصل الشهادة). The words of the hidden F1 and teaching screens are left (§9). On family-facing text
a section appears only as its name (11A), so no English word changed there.

- **Screens:** `before|after/d12-desk-teacher-change-*`, Student E1 before and F1 after, Teacher A → Teacher B:
  "The student moves to the class Biology 11 — Teacher B." / ينتقل الطالب إلى فصل … became "… to the group …" /
  ينتقل الطالب إلى مجموعة …. `d12-messages-section-ar`: «القسم», «اختر قسمًا» became «الفصل», «اختر فصلًا».

### 13 — Payments is hidden from the sidebar

- `/admin/payments` is on the admin's list.
- It still opens by URL (`after/reachable.json`: 200, "Bank Transfer Confirmations").

### 14 — "Balance": one word for the family's money with the school

- **The words.** Balance / الرصيد. The family's page title is "Your balance with the school" / رصيدك لدى المدرسة. The
  admin's sidebar item is "Balance withdrawals" / سحوبات الرصيد (its page is the withdrawal requests).
- **What was swept.** 61 source strings and 41 dictionary entries (`drive/balance.py`; each old text was checked present
  before any edit):
  - the two nav items;
  - the family's home ("Balance EGP … available") and the old home with the switch off;
  - the family's balance, transfer and withdraw pages and their titles;
  - the statement (Balance, "from the balance");
  - the desk (Balance; "Transfer found — added to the balance"; the transfer dialogs; "Add to the balance");
  - the desk's Reserve card ("Balance to use (EGP)");
  - the admin's withdrawals page;
  - checkout ("Use your balance", "From your balance", "Paid from your balance");
  - charges, daily takings, the finance workbench, exceptions (the held balance / الرصيد المحجوز and its policy
    sentence in `@repo/validations`), approvals, My Registrations, history, pending requests, linked parents, and the
    settings and board-series sentences;
  - every المحفظة in the dictionaries, now الرصيد.
- **What keeps its old word.** "escrow" stays the word of the code, the routes, the API's own sentences (notifications,
  refusals, emails: §9) and the audit. The mobile-wallet payment method ("Mobile Wallet") is another thing and keeps
  its word.
- **Screens:** `before|after/d14-parent-sidebar-*`, `d14-parent-home-*`, `d14-parent-balance-page-*`,
  `d14-parent-statement-*`, `d14-desk-*`, `d14-admin-balance-withdrawals-*`.
- **The Arabic the sweep had lost** (the review of dd68598, item 4). The sweep changed some English strings whose
  Arabic keys then matched nothing. `lib/i18n-decisions.ts` now gives them Arabic:
  - the desk's "Transfer found — added to the balance" and "Add to the balance";
  - the finance workbench's "Withdrawal rejected — unreleased amount returned to the balance." and "Receipt returned —
    any pending drop refund has been released to the balance.";
  - the checkout's "Only if you have not paid. What your balance paid toward it goes back to the balance.".

  The desk's sentences with data in them are translated by `translateDecisionsText`, whose rules are each anchored to
  their sentence's end. They cover the transfer and undo-transfer dialogs' descriptions, with their labels ("8,800
  جنيه عبر إنستاباي") and the family's reference, and the two sentences the desk writes after each.
  `translateDynamicText` asks them before its own rules. The first drive showed why that order matters: the
  record-transfer description starts with its amount, and the rule "EGP (.+)" took the whole sentence.

  The two dialogs' titles, fields, placeholders and buttons, and the row's "Transfer found" and "Undo", had no Arabic
  on main either. They have it now, so the dialog reads in one language.

  Driven as the finance admin on student B1 (`desk-transfer-ar/`, `drive/desk-transfer.mjs`). Its InstaPay payment
  was rejected first, then the transfer recorded and undone. Both dialogs and both sentences read in Arabic, and the
  balance went from 0 to 8,800 جنيه and back. No English "balance" was left on the desk.

  The finance and checkout strings were checked as dictionary keys (`balance-sentences-ar.json`), not driven. They
  take the path the desk's own strings prove on screen.

### 15 — The sign-in page carries the school's name

- **The setting.** `packages/validations/src/settings/settings.ts` gains `school.name`: a string, trimmed, at most 120
  characters (`SCHOOL_NAME_MAX`), default empty, group `school`, input `text`, the admin's alone.
  - The Settings screen gains the group "The school" (first). Its card shows the name, or "Not set: the sign-in page
    shows the app's name alone", and a text field with the hint "Empty: the app's name alone.".
- **The public read** (approved by the lead with conditions at 01:11Z). `GET /v1/settings/public` answers
  `{ schoolName }` and nothing else (`publicSettings()`: the one key read by its name, never a filtered copy of the
  settings).
  - It sits before the settings router's auth gate.
  - Its policy row is A for every principal, and the path joined `SELF_SERVICE` in `role-grants.ts`, so coordinator,
    teacher and gate reach it.
  - 04's anonymous list gained it.
  - SECURITY_AUDIT.md §2 has one line naming it, what it returns and why.
- **The pages.** `app/(auth)/layout.tsx` reads the name on the server for a visitor, through `hc<AppType>` and the
  public read, into `SchoolNameProvider` (`components/school-name.tsx`). An API that does not answer leaves the app's
  name alone and logs a warning.
  - `BrandNames` (`components/auth-layout.tsx`) shows the name above "IGCSE Reserve" on every auth page's panel and
    phone header, the forgot- and reset-password pages' own panels included. Empty, the app's name stands alone.
  - The sentence under it stays the family's words. There is no logo.
- **Screens.** `after-set/d15-{sign-in,sign-in-phone,sign-up,forgot-password,settings}-{en,ar}` with the name
  "Placeholder International School". `after/d15-*` and `after-emptied/d15-sign-in-*` with the setting empty.
  `before/d15-*`.

### 16 — Entry Lists' rule source names the handbook alone

- `packages/db/drizzle/0057_exam_entries_board_rules.sql` (F4's seed of `exam_board_rule.notes`) is untouched,
  byte-identical to main 19dabff: an applied migration is never edited (the review of dd68598, item 1).
- `packages/db/drizzle/0061_rule_source_notes.sql`, made with `drizzle-kit generate --custom --name rule_source_notes`
  (journal entry 61), changes each board's note to the text below. It is one statement (`WITH … UPDATE exam_board_rule
  … INSERT INTO audit_log`) and has no BEGIN or COMMIT: the migrator runs pending migrations in its own transaction.
  A new install gets 0057's text, then 0061's. A database that ran 0057 gets 0061's on its next migrate. §6 has the
  proof.

  | Board | Text after 0061 |
  |---|---|
  | Cambridge | "Cambridge Handbook 2026. Check each rule against the current handbook." |
  | Pearson | "Pearson key dates 2026/27, IAL information manual. IAL unit results are banked under the UCI." |
  | OxfordAQA | "OxfordAQA's entry rules were not researched: only its series and entry routes are known." |

  Pearson's and OxfordAQA's notes are changed on the same principle: no internal file's name on a staff screen. 0061
  changes each board's row only while it still holds 0057's text, so a note an admin edited through "Change the rules"
  is left alone. Each change writes its audit row (`EXAM_BOARD_RULE_UPDATED`, by no user, naming the decision and
  0061) in the same statement.
- The dictionary (`i18n-exams/entries.ts`) carries the new texts. The three old ones are removed: once 0061 has run, no
  database holds them.
- The IAL Mathematics starter set's note (`catalogue.services.ts`) said "Starter set from the research
  (DISCOVERY_RESEARCH.md §2) — …". It now names the board's documents: "Starter set from Pearson's IAL information
  manual 2025/26, the IAL Mathematics aggregation rules and the IAL January 2027 timetable — check it against the
  board's current specification." It is written on the units and awards the starter set makes. No screen shows it and
  no test asserts it.
- **Screens:** `before|after/d16-entry-lists-*`. The source line read "From DISCOVERY_RESEARCH.md §2 (Cambridge
  Handbook 2026). …" before, and "Cambridge Handbook 2026. Check each rule against the current handbook." / «دليل
  Cambridge 2026. …» after. The after drive ran with the update on `igcse_decisions_dev` as a hand-run statement.
  That statement is superseded by 0061, which changed nothing on that database when it ran there: its rows already
  held the new text.

---

## 2. F6's second review: the two notes on the subject form's read-back

`subjects-tab.client.tsx`, `readBack()` (it replaced `readSheet`) serves the Save, the Add, the Remove and Replace a
teacher.

- **(a) A fetch already running.** `queryClient.cancelQueries({ queryKey: offersKey(session.id) })` runs before
  `fetchQuery`, so the read is a request made after the change.
  - On main's code the race showed differently from what the review predicted. The read reused the held focus refetch,
    and the refresh's own `invalidateQueries(['sessions'])` (a prefix of the sheet's key) then cancelled that fetch.
    The drawer showed **"CancelledError" and no "Saved." after a save the API had taken**.
  - On the Replace path the held sheet came back. The form ticked **the teacher who left** (F6's finding 2, back
    through the race).
- **(b) A read that fails.** The read is caught: the sheet's query is invalidated instead and the read returns
  `failed`.
  - The drawer reports "Saved.". Until the sheet's copy is newer than the change, it holds a notice in place of the
    form: "The sheet could not be read again just now: the subject's form comes back once it is.", with "Read the
    sheet again". A form made from the copy taken before the change would send its old values back with the next Save.
  - Once the copy is newer, the form is made again from it, keeping what was typed before a Replace.
  - The Subjects tab no longer replaces itself with "Could not load this" when a read fails after the sheet had loaded.
    It keeps the sheet and the open form, with a notice "The sheet could not be read again just now: it shows the
    subjects as last read." and Try again. This is the cause of (b)'s visible symptom on main: a successful save
    followed by a screen that says nothing loaded.
- **The read-back on its own** (the review of dd68598, item 3). The refresh's `invalidateQueries` matches by prefix, so
  `['sessions']` also covered this sheet's offers. A failed read-back then joined the tab's refetch, with its retries,
  and the waiting state was never seen. Now:
  - `refresh()` invalidates the sessions' queries except this sheet's offers (a `predicate`), which the read-back
    reads itself;
  - `readBack`'s `fetchQuery` has `retry: false`: a failed read fails at once and the drawer says so.
  - After an Add, the drawer keeps the added subject's name (`addedName`) as its title while it waits.

  Driven again (`b-fixed2`, `add-fixed`): the sheet's reads were aborted for 9 s after the change, and the screen
  was sampled 1.5 s after it. Case b showed "Saved." and the waiting notice, the drawer titled Physics, with the sheet
  still shown. The Add path showed the drawer titled Accounting with "Added. …" and the waiting notice. In both, the
  form held the note typed after "Read the sheet again".
- **Driven** (`notes/`, `drive/notes.mjs`; the admin, June 2027, Physics O.L.; a focus refetch held 4 s with the sheet
  from before the change, after waiting out the app's one-minute `staleTime`):

  | Case | Main's read-back put back (control) | This branch |
  |---|---|---|
  | a — Save during a focus refetch | **CancelledError**, no "Saved." (`a-control`) | "Saved.", the note typed kept (`a-fixed`) |
  | b — the sheet unreadable for 9 s after a Save | the tab replaced by "Could not load this", no "Saved." (`b-control`) | "Saved.", the screen kept, the note back once the sheet answers (`b-fixed`, `b-fixed-during`); at 1.5 s "Saved." and the waiting notice (`b-fixed2`, `b-fixed2-during`) |
| Add a subject, the sheet unreadable for 9 s after it | — | the drawer titled with the subject, "Added. …" and the waiting notice at 1.5 s; the note kept (`add-fixed`, `add-fixed-during`) |
  | Replace a teacher during a focus refetch (C → A, then A → C) | the form ticks **the teacher who left** (`r-control`) | the new teacher ticked, the typed note carried (`r-fixed`) |

---

## 3. Changed assertions, old and new

**Pre-authorised** (decision 1's "an existing assertion of the allowance may change to the new rule", decision 12's
08s6 sentences, and the lead's answers of 01:11Z: 04's anonymous list, 08u's S1, 08n-import's row-5 chain).

| File | Old | New |
|---|---|---|
| `08n-session-offers.test.ts`, "self-study on a first entry …" | `reserve(…, selfOnly, first, self_study)` made a line, `mode` `self_study` | refused, "Not taught (08n rules …) is self study on a second entry only: name the earlier sitting, or ask for the exception"; a retake in self-study naming its sitting (`camNovRecent`) made, `mode` `self_study`; title "… and where it is "Retake (Self Study ONLY)" …" |
| `08n-import.test.ts`, row 5 | `codes(row 5)` = `['self_study_not_taught']` | `['registration_refused', 'self_study_not_taught']`, the refusal "Live Subject Self is self study on a second entry only: name the earlier sitting, or ask for the exception" (the line plan's assertion unchanged) |
| `08n-import.test.ts`, "staff settle each line" | (row 5 not settled) | staff name row 5's sitting (June *Y*); row 5 has no `registration_refused`, its line a retake in self-study, declared by the desk, 1000 at 50% |
| `08n-import.test.ts`, the commit's lines | `['live.one', 'Live Subject Self', 'first', 'self_study', 1000, 500, 500, false, null, null, null, 50, 100]` | `['live.one', 'Live Subject Self', 'retake', 'self_study', 1000, 500, 500, false, 'declared_by_desk', 'pearson_edexcel june Y', null, 50, 100]` |
| `08n-import.test.ts`, To verify | Live One's Subject C, Live Two's Subject A | the same and `['Live One', 'Live Subject Self', 'Pearson Edexcel June Y', 'desk']` |
| `08u-session-form.test.ts`, the IAL preview | `['S1', ['in_school'], ['first self_study', 'retake self_study']]` | `['S1', ['in_school'], ['retake self_study']]` |
| `08s6-scheduling-rework.test.ts`, the desk's sentence (14 lines) | "The student moves to the class …" / ينتقل الطالب إلى فصل …; "… has no class of this subject yet …" / ليس لدى … فصل …; "The whole class … goes to …: the student stays in it." / ينتقل فصل … كله إلى …: ويبقى الطالب فيه.; "The student leaves the class …" / يغادر الطالب فصل …; "The whole class … goes to …." / ينتقل فصل … كله إلى …; "2 students move to the class …" / ينتقل طالبان إلى فصل … | "group" in each English sentence; مجموعة, with تنتقل / كلها / فيها, in each Arabic one |
| `04-authz-matrix.test.ts`, the anonymous list | `['GET /v1/health', 'GET /v1/health/ready', 'GET /v1/ical/:token']` | the same and `'GET /v1/settings/public'` |
| `08f-foundation-structure.test.ts`, the coordinator's `canEdit` map | (no `school.name`) | `'school.name': false`: the coordinator reads `school.name` and cannot change it (a new setting's row, as each setting added before) |

**Set-ups that priced the allowance now grant the exception first.** No asserted value changed in these:

- `08p`: the A-16 test (`d`), "the pricing settings change new lines only" (`before`, `after`) and "a pricing.*
  exception …" (`self`, `none`) grant the student `gate.selfStudyFirstEntry` before their first entry on the untaught
  subject.
- `08j`: s3 is granted the exception before preregistering Physics.
- `08r`: "the pricing policies through the registry" grants a family's exception before each line. The test's own
  assertion that the plain student holds no exception stays true.

**New scenarios:**

- `08p`: decision 1 — subject, unit, plain route and carry-forward route; through the family's and the desk's endpoints
  and the read; the exception used once.
- `08p`: decision 1's exception reaches the screens (the review of dd68598, item 2). Once granted, the family's and the
  officer's reads for that student list `first self_study` at 16200 beside `retake self_study` on the untaught
  subject, and among the four options on a taught one. Another student and the preview get the retake alone. The
  desk's reservation of that option succeeds (7000 + 9200 = 16200) and uses the exception, after which the option is
  no longer offered.
- `08u`: decision 2 — an IAL unit's November refused with nothing moved and nothing audited; January taken; units of
  no cash-in award take November.
- `08f`: decision 15 — empty by default; refused to six roles; refused at 121 characters and as a number; trimmed and
  audited; read by a visitor and a parent; the exact `{ schoolName }` even with a row for every setting in the store;
  emptied again.

---

## 4. Controls (each guard undone once, its test red, put back)

| Guard | Undone | Red |
|---|---|---|
| Decision 1's rule | the branch `if (false)` | 08p: `expected { status: 201 } to deeply equal { status: 400 }` (`controls/c1a-rule-undone.log`) |
| … its reach to units and routes | the rule limited to the subject | 08p: the unit's first entry made, "promise resolved instead of rejecting" (`c1c`) |
| … its carry-forward exception | the exception dropped | 08p: the A.2. route refused (`c1d`) |
| Decision 1's read | the carry-forward condition dropped | 08p: `expected [ …(2) ] to deeply equal [['retake', 'self_study', 16200]]` (`c1b`) |
| … the exception in the read | `if (false && held.length)` | 08p: `expected [ 'retake self_study 16200' ] to deeply equal [ 'first self_study 16200', …(1) ]` (`c3-read-exception-undone.log`) |
| Decision 2's month check | `if (false && …)` | 08u: `expected { status: 200 } to deeply equal { status: 400 }` (`c2`) |
| Decision 15's shape | a second key in the public read | 08f: `expected { schoolName: '', …(1) } to deeply equal { schoolName: '' }` (`c15a`) |
| Decision 15's anonymous read | the route behind the auth gate | 08f: `Unauthorized` (`c15b`) |
| F6's notes a and b | main's read-back and tab put back on the running web | §2's table, the control column |

---

## 5. Gates

| Gate | Commit | Result | Evidence |
|---|---|---|---|
| `pnpm --filter @repo/api check-types` (source and tests) | c3ccc36's content | green | session log, trail 01:18Z |
| `pnpm --filter web check-types` | c3ccc36's content | green | session log |
| `pnpm --filter @repo/api test`, local time (Africa/Cairo) | c3ccc36 | 43 files, **842 passed**, 1 todo (main 19dabff: 839; three scenarios added) | `gates/suite-local-c3ccc36.txt` |
| the same with `TZ=UTC` | c3ccc36 | 43 files, **842 passed**, 1 todo | `gates/suite-utc-c3ccc36.txt` |
| both type-checks (the review round) | 57ec766's content | green | session log, trail 15:13Z |
| the suite, local time, from an empty database migrated through 0061 | 57ec766 | 43 files, **843 passed**, 1 todo (08p's new scenario) | `gates/suite-local-57ec766.txt` |
| the same with `TZ=UTC` | 57ec766 | 43 files, **843 passed**, 1 todo | `gates/suite-utc-57ec766.txt` |
| both type-checks, again after the resume | 115508f's content (57ec766's code) | green | session log, trail 16:07Z |
| the suite, local time, again after the resume | 115508f | 43 files, **843 passed**, 1 todo | `gates/suite-local-115508f.txt` |
| the same with `TZ=UTC` | 115508f | 43 files, **843 passed**, 1 todo | `gates/suite-utc-115508f.txt` |
| 0061 on a fresh template copy, again after the resume | 115508f | 61 → 62, three notes changed, three audit rows; a second run changes nothing | `migration-0061-115508f.txt` |
| `useQuery<…>` generics in `apps/web/app` | — | 15 (unchanged) | `grep -rn "useQuery<" apps/web/app` |
| No file over 300 KB under `.audit`; no mobile number in the trail or the documents | — | none | CI's gate 0 |

The commits between c3ccc36 and dd68598 change only the documents, the trail and the evidence. 57ec766 is the review
round, and the commits after it change only the documents, the trail and the evidence again. One earlier full run (on the work in progress, while the browser drive ran) timed out three 08s tests at
30 s; 08s alone passed (40), and both full runs on c3ccc36 ran with nothing else on the machine.

---

## 6. Decision 16's migration (0061)

0061 does this; nothing to run by hand. The one-off SQL the first round left for the lead is withdrawn (its file
removed from the evidence). The migration is its statement without BEGIN and COMMIT, with 0061 named in the audit
row's reason:

```sql
WITH changed AS (
  UPDATE exam_board_rule r SET notes = v.new_notes, updated_at = now()
  FROM (VALUES
    ('cambridge',
     'From DISCOVERY_RESEARCH.md §2 (Cambridge Handbook 2026). Check each rule against the current handbook.',
     'Cambridge Handbook 2026. Check each rule against the current handbook.'),
    ('pearson_edexcel',
     'From DISCOVERY_RESEARCH.md §2 (Pearson key dates 2026/27, IAL information manual). IAL unit results are banked under the UCI.',
     'Pearson key dates 2026/27, IAL information manual. IAL unit results are banked under the UCI.'),
    ('oxford',
     'OxfordAQA''s entry rules were not researched (DISCOVERY_RESEARCH.md §2 lists only its series and entry routes).',
     'OxfordAQA''s entry rules were not researched: only its series and entry routes are known.')
  ) AS v(board_code, old_notes, new_notes)
  WHERE r.board_code = v.board_code AND r.notes = v.old_notes
  RETURNING r.board_code, v.old_notes, v.new_notes
)
INSERT INTO "audit_log" ("id", "user_id", "action", "entity_type", "entity_id", "previous_data", "new_data")
SELECT gen_random_uuid()::text, NULL, 'EXAM_BOARD_RULE_UPDATED', 'exam_board_rule', board_code,
       jsonb_build_object('notes', old_notes),
       jsonb_build_object('notes', new_notes, 'reason', 'The rule source names the board''s documents alone (the lead''s decision of 16 Oct 2026, 16; migration 0061)')
FROM changed;
```

**Proof** (`migration-0061.txt`):

- `igcse_decisions_mig` is a fresh copy of `igcse_template_dev`, which held 34 migrations.
- Migrated with main's migration set (122 files, byte-identical to 19dabff) to 61, it holds 0057's three notes and no
  `EXAM_BOARD_RULE_UPDATED` row.
- Migrated with this branch's set to 62, it holds three notes changed and three audit rows.
- A second migrate applies nothing, and the statement run again by hand gives `INSERT 0 0`.
- The suite starts from an empty database migrated through 0061 (§5).

## 7. The dev data (through the API; never a migration or a seed; placeholders only)

On `igcse_decisions_dev`, in order:

1. The UI audit's `setup-1` to `setup-8` (`.audit/ui-audit-evidence/drive/`, copied to `/tmp/cd/drive` with ports
   3181/3180). They make:
   - F6a's catalogue: Biology's papers, IAL Mathematics' units (Pearson's starter set: WMA11 to WST01 under the
     units-cash-in awards XMA01/YMA01), Physics 9702's routes, and Arabic A level's two qualifications YAA01 (IAL,
     units_cash_in) and 9AA0 (GCE);
   - Teachers A, B and C, and a coordinator;
   - June 2027 (open) with the six shapes, Chemistry "Retake (Self Study ONLY)", November 2026 – January 2027 and June
     2028;
   - the families A to D, the drop, the transfer and the withdrawal, and Cambridge June 2027's entries.

   `setup-6` and `setup-7` take ids as arguments: C2's paid line; B1, the Mathematics line, C2.
2. `drive/setup-cd.mjs`:
   - Mathematics A.S./A.L. (IAL) on the winter sheet, for decision 2 (its units default to Pearson October 2026);
   - Cambridge June 2027's other dates (forecasts, arrangements, results, certificates) and Pearson January 2027 with
     exams on 8–28 Jan 2027 and no entry deadline, for decision 10;
   - students E1 and F1 (placeholders) reserving Biology with Teacher A at the desk, with the school fee collected;
     their course enrolments from the lines; and the teaching groups "Biology 11 — Teacher A" (A1, E1, F1) and
     "Biology 11 — Teacher B" (empty), for decision 12's desk sentence.
3. Decision 15: `drive/school-name.mjs "Placeholder International School"`, then `""`.

The three shapes the brief names were made without a new step: the IAL subject with units (step 1), the Arabic A Level
with two qualifications (step 1), and the self-study-only subject, Chemistry (step 1's `setup-4`).

---

## 8. Decisions and why (mine)

1. **Decision 1 reached the import through the rule, not the view.** The import's review already runs
   `assertLineRules` in a dry run, so the import refuses what a reservation refuses with the same sentence, and staff
   settle it as the sentence says. Changing `import/view.ts` as well would have meant a second statement of the rule.
2. **The taught subject's old refusal sentence is kept** (its assertions are 08n's and 08r's, which the
   pre-authorisation did not name). The lead's sentence is used where the rule changed. §10, question 1.
3. **Decision 2 refuses only a move.** A unit already in November (put there through the item endpoint) is not
   refused when the form leaves it there. The form lists its current month so the select tells the truth.
4. **Decision 7 and decision 10 read F6b's lists** through two helpers (`remarksHidden()`, `entryDatesOnly()`), as
   `timetableHidden()` does. The switch is untouched, and switching it off brings every row back.
5. **Decision 14 reaches every kept screen.** The decision says "escrow" stays the code's and the audit's word only.
   The hidden screens' strings (remarks, the remarks desk, the dashboard, reports) are left with their screens.
6. **Decision 15's name is read on the server**, so the page arrives with it and nothing moves once it loads. A failed
   read leaves the app's name alone and logs a warning; the sign-in form never depends on it.
7. **Decision 16 includes Pearson and OxfordAQA.** The decision's reason (an internal file's name on a staff screen)
   applies to all three notes. 0061 changes each board's row on its own, and only while it still holds 0057's text.
8. **Note (b) is fixed where its symptom comes from.** The read-back is caught, and the tab keeps a loaded sheet when a
   later read fails. The drawer waits for a fresh copy rather than rebuild the form from a stale one.
9. **Attribution:** every commit ends with "Co-Authored-By: Claude Opus 5.5".

---

## 9. Deferred, and why

- **The API's sentences still say "escrow"**: notifications ("… returned to your escrow balance"), refusals ("Escrow
  balance insufficient"), the desk's and checkout's messages built by the API, and emails. Changing them changes
  strings the suite asserts, which the brief did not pre-authorise. Their Arabic already says الرصيد. For the lead.
- **The hidden screens' words** are left as they are and come back with the switch. That covers F1's teaching screens
  ("My classes", "Close the class", cover's "the class is told") and the remarks screens' "escrow".
- **Decision 2 is enforced on the form only** (accepted as is by the review of dd68598, item 5). Two paths can still
  place an IAL unit in November:
  - the item endpoint (`PUT …/items/:itemId`, API-only by decision 4, which left the old tools as they are);
  - `copyOffersFrom`, when a sheet is copied from another session, which keeps each unit's month.

  The form lists such a unit's current month, so the select tells the truth, and refuses a move to November.
- **The import's brand-new student and the exception.** A row of the day-one import that is a first entry in
  self-study on a self-study-only item, for a student the import itself creates, stays refused: no exception can be
  granted before the student exists. Staff name an earlier sitting, or make the student, grant the exception and
  review the import again.
- **The register and registrations pages redirect an admin to `/admin/subjects`.** A redirect for a role that has no
  Reserve page, not a link; it now lands on a hidden screen.

---

## 10. Questions for the lead

1. The taught subject's refusal still reads "… when retaking or when the school does not offer them". Should it become
   the rule's sentence ("… is self study on a second entry only: …")? Two assertions would change: 08n's
   `toThrow` and 08r's `toContain('only be taken outside school')`.
2. The API's "escrow" sentences (§9): change them to "balance", with their assertions?

---

## 11. Progress log (UTC)

- 16 Oct 00:16Z: worktree installed and built; `igcse_decisions_dev` from the template, migrated (61); env on
  3181/3180.
- 00:39–00:52Z: servers started (API pnpm 86464 / node 86475, web pnpm 86466); dev data (§7); the before drive
  (`before/`).
- 01:04Z: decision 1 (the subject's version), its scenario and controls. 01:07Z: decision 2's API, scenario and
  control.
- 01:10Z: decision 15 needed an anonymous read, and 04's assertion was not pre-authorised: asked the lead, along with
  the import's premise and decision 1's scope. 01:11Z: the lead's answers.
- 01:15–01:18Z: decision 1 widened to units and routes (the carry-forward exception); 04, 08f and SECURITY_AUDIT.md per
  the conditions; eight files 182 passed; controls c1a–d and c15a–b.
- 01:19–01:47Z: the web: decisions 5, 8, 13, 7, 10, 12 (08s6 40 passed), 14, 9, 15, 3, 2; both type-checks green.
- 01:52–02:21Z: the after drive; decision 16's SQL run here; decision 15 set and emptied; the notes' drives (controls on
  main's code, then the fix); the hidden screens reached by URL.
- 02:24Z: c3ccc36 committed and pushed.
- 02:24–02:40Z: the suite on c3ccc36 in local time (02:32Z) and with `TZ=UTC` (02:40Z), 842 passed each; CI run
  38840245897 green on c3ccc36 (02:40Z). The questions marked decided in SESSION_WORDS.md §12, RESERVATION_FOCUS.md §2
  and §8, CYCLE_FOLLOWUPS.md §10 and UI_AUDIT.md §9; this document.
- The dev servers are left running for the lead's drive: API on 3181 (pnpm 86464, node 86475) and web on 3180 (pnpm
  86466), database `igcse_decisions_dev`, with the school's name emptied again.
- 02:57Z: CI run 38841703673 green on b4ee015 (the documents, the trail and the evidence).
- 14:45Z: the Opus 5.5 review of dd68598: merge after fixes 1, 2; seven items.
- 14:45–14:50Z: item 1 — 0057 restored byte-identical to 19dabff; 0061 generated and filled; proved on a fresh
  template copy, migrated 61 then 62 (`migration-0061.txt`); the starter-set note.
- 14:52Z: item 2 — the read for a student with the exception; 08p's new scenario (12 passed) and control c3.
- 14:54Z: item 7's nits. 14:55Z: item 4's dictionary and its check.
- 14:57Z: item 3 — case b and the Add path driven with the screen sampled at 1.5 s (`b-fixed2`, `add-fixed`).
- 14:58Z: item 2 on the Reserve page (`after-exception/`).
- 15:05Z: the desk's transfer dialogs in Arabic: the record dialog's description was taken by "EGP (.+)" (red).
  15:06Z: the decisions' rules asked first, the dialogs given Arabic, driven again (`desk-transfer-ar/`).
- Items 5 and 6: this document (§9, §3).
- 15:13Z: both type-checks green; 57ec766 committed and pushed. The suite on 57ec766 in local time (15:22Z) and with
  `TZ=UTC` (15:30Z), 843 passed each; CI run 38922344500 green on 57ec766 (15:31Z).
- The dev servers are still running for the lead's drive: API on 3181 (pnpm 86464), web on 3180 (pnpm 86466),
  database `igcse_decisions_dev`. Student B1 now holds the exception "self-study on a first entry", and its InstaPay
  payment of 8,800 is rejected, with the transfer found later recorded and undone.
- 15:48Z: CI run 38924987623 green on 115508f.
- 16:04Z: resumed on the coordinator's message (the harness had lost its connection while the local-time suite ran).
  The worktree read from lead-env with a temporary index: nothing differs from 115508f and nothing is untracked, so
  every item was committed. Neither suite run on 57ec766 had been cut: each ended with its summary.
- 16:06Z: the migration proof again on a fresh template copy (`migration-0061-115508f.txt`). 16:07Z: both
  type-checks. 16:15Z and 16:22Z: the suite again in local time and with `TZ=UTC` on 115508f, 843 passed each.
