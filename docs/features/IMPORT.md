# F7 — Day-one import (as built)

Branch `feature/import`, started from `origin/main` e5da650 (F0a and F0b merged), merged with
`origin/main` 20d87c8 (the walkthrough's format in the plan) at 332ef18. The plan is
FEATURES_PLAN.md §1 "F7 — Day-one import" and §5's rules. The evidence behind it:
- IMPORT_SPIKE.md (IS-01 to IS-14);
- DISCOVERY.md (A-02, A-03, A-04, Q-02, Q-03, Q-05, Q-09, F-01);
- DISCOVERY_RESEARCH.md §1.

The trail is `.audit/import.tsv`. The evidence is in `.audit/import-evidence/` (git-ignored):
suite logs, control logs, the real-sheet runs' counts, and screenshots of synthetic data. The
progress log is the last section.

**The school's real sheet never enters the repository, a test, a screenshot or a log.** It is
cited by row numbers and counts only; tests build synthetic sheets with the same shapes
(`apps/api/test/import-fixtures.ts`).

F7 is how the school goes live. It gives three things:
- **A staged review.** Staff check the school's own sheet before anything is made: every problem
  the spike found is flagged on its line; people and families are worked out; staff fix, merge
  or skip line by line; the coordinator's pending answers are settings.
- **A commit that makes exactly what the review showed.** One family per transaction. Every row
  it makes points back to its line, and running the same file again changes nothing.
- **Two templates** for what the school does not have yet: SCL's grade-9 roster, and the money
  record.

Money from before the system is history only: nothing here makes a payment, a receipt or a
balance.

---

## 1. Sources and templates

| Kind | What it is | How it is read |
|---|---|---|
| `school_sheet` | The school's registration workbook (.xlsx): session tabs such as "2024" (the November 2026 form) and "Sheet1" (June 2023), plus hand-made per-unit roster tabs. | A tab is a **session tab** when a header row has "student name", "subject" and "student email". Unlabelled columns are given their role by what most of their cells hold: the series (a date serial or text), the confirmation, self-study, the fee note, and the parent's name, which is the column after the student's email. The tab's title row ("Nov. 2026 Session") gives its main series. Roster tabs (no emails) are listed and not imported (note `roster_tab_ignored`, A-04). |
| `scl_roster` | SCL's export at the grade 9→10 boundary (DISCOVERY.md Q-09: SCL claims a CSV export). The template is `SCL_ROSTER_TEMPLATE`, downloadable on the upload screen. | CSV (RFC 4180; comma, semicolon or tab; BOM stripped). Headers: `student_name, student_email, student_phone, scl_student_id, grade, grade10_section, parent_name, parent_email, parent_phone, second_parent_name, second_parent_email, second_parent_phone`. Required: `student_name, student_email, grade, parent_email`; a file without them is refused, naming the missing columns. `grade` is the grade in the year the review's "grades are in" setting names: grade 9 means the student starts grade 10 the year after. `grade10_section` places them in that year's section. |
| `money_record` | The money record before the system (DISCOVERY.md F-01, not yet seen). The template is `MONEY_RECORD_TEMPLATE`. | CSV. Headers: `student, date, amount_egp, direction, kind, percent, method, receipt_number, series, subject, note`. Required: `student, kind`. `student` is an email or school ID of an account that exists. Dates are YYYY-MM-DD, DD/MM/YYYY (day first, as in Egypt) or an Excel serial. Each line becomes a `money_history` row, and nothing else. |

The reader is `apps/api/src/lib/xlsx.ts`, hardened from the spike's:
- zip offsets are checked against the buffer;
- only the workbook's own parts are inflated, each capped at 64 MB;
- the spike script now uses the same reader.

The CSV reader is `apps/api/src/lib/csv.ts`; source reading is `services/import/source.ts`.

**Normalising** (`services/import/normalise.ts`):
- **Phones.** Egyptian mobiles as `01xxxxxxxxx`. A leading 0 lost to a number cell is restored,
  and `+20` / `0020` is stripped. Anything else is left off the account and flagged.
- **Names.** Non-breaking, trailing and doubled spaces are removed.
- **Classes.** "11A" gives the grade and the section.
- **Level codes.** O.L., A.S., A.2., A.L., and the combined codes.
- **Series.** Read from the row's series column (a date serial or text), otherwise from the tab's
  title.
- **Fee notes and drops.** "Dropped 20% School fees" gives a percentage; "I will drop the course"
  is read as a drop the family intended.
- **Carry forward.** "Carry forward on June 2022" in the Signature column is read, with the
  series it came from.
- **Column drift.** A value in another value's column is read by what it says, and flagged
  (IS-11).

## 2. Data model (migration 0041)

All in `packages/db/src/schema.ts`.

| Table | What it holds | Rules |
|---|---|---|
| `import_batch` | One staged file: kind, the uploaded file (F0a's uploads, purpose `import_file`), name, SHA-256, status (`staged`, `committing`, `committed`, `partial`, `discarded`), the source's tabs, the mapping settings, the last summary, the commit's result, who staged, claimed, committed or discarded it and when. | The status moves only through the commit's claim (§5) and discard. |
| `import_row` | One line of the file: tab, row number (as Excel numbers it), the raw cells as `[header, value]` pairs, the staff's edits, the decision (`import`/`skip`, with a note and who decided), status (`pending`, `committed`, `failed`), what the commit made for it (`outcome`) and its error. | Unique (batch, tab, row). A committed row does not change. |
| `import_person` | A student or parent of the file, keyed by email: the name and phone staff chose, a merge into another key, "different people", "one child", skip; after the commit, the account it became. | Unique (batch, role, key). |
| `registration_history` | A registration the school recorded before the system: student, subject (when mapped) and the sheet's words, level code, series, in school or self-study, the teacher, the outcome (`registered`, `dropped`, `drop_intended`), a carried-forward reading, a note, a fingerprint, the batch and row it came from, and `source_ref` ("file — tab row n"). | Unique (student, fingerprint): the same line imported twice makes one row. |
| `money_history` | Money before the system, as history: kind (`payment`, `refund`, `drop`, `self_study_rate`, `external_rate`, `carried_forward`, `other`), direction, amount, percent, date, method, receipt number, series and subject as written, note, fingerprint, source. | Unique (student, fingerprint); amount ≥ 0; percent 0–100. No link to payments, escrow or receipts. |

## 3. The staged model

**1. Stage** (`POST /v1/imports`, admin or coordinator)
- The uploaded file is read into its tabs and lines, and one `import_row` is written per line.
  Nothing else in the school changes; 08n asserts it.
- The file's SHA-256 is recorded. When the same file (same kind) was staged before and not
  discarded, the latest such batch's settings, row edits and decisions, and person decisions are
  carried over. A re-run is then reviewed exactly as it was left (`sameFileBefore` names that
  batch).

**2. Review** (`GET /v1/imports/:id`)
- The review is **worked out each time it is read** (`services/import/view.ts`, which never
  writes). Its inputs are the raw lines, the staff's edits and decisions, the mapping settings
  and the database as it is now.
- Only the staff's own input is stored. Nothing the review works out can go stale: when another
  desk adds a family, or the admin adds a subject, the next read shows it.
- The review returns:
  - each line with its reading, its problems and its plan (what a commit would make, such as
    `student: create|match` or `registration: history|live|history_exists|live_exists`);
  - the people, the families and the mapping;
  - the file-wide notes;
  - a summary.

**3. Fix, merge, skip** (each change audited as `IMPORT_REVIEWED`)
- `PUT /:id/rows` (one line or many):
  - edits: name, email, phone, parent, "no parent on file", class, level code, subject, teacher,
    series, self-study, and the self-study answer for that line;
  - clearing an edit;
  - `import` / `skip`, with a note.
- `PUT /:id/people`:
  - the name or phone to use;
  - merge into another person, or undo the merge;
  - "different people";
  - "one child";
  - skip.
- `PUT /:id/settings`: the mapping (§4.3).

**4. Commit** (`POST /:id/commit`)
- Every family with nothing left to fix is committed, each in its own transaction (§5).
- The families still held wait. The batch becomes `partial` and can be committed again once they
  are fixed.

**Discard** (`POST /:id/discard`) puts a file aside. What it already committed stays.

### Families

A family is the set of students and parents the importing lines join: a union-find over student
and parent keys, after merges. It is the unit of a commit.
- A family is **held** while any line in it has an error.
- A family is **ready** when nothing in it is an error. Warnings and notes do not hold it.
- Its other statuses are `committed`, `partly_committed` and `failed` (with the reason).

## 4. The review

### 4.1 Every problem the spike found, flagged

Each code is defined in `IMPORT_PROBLEMS` (`@repo/validations`), with its severity, its finding,
a title and what it means. The Problems tab groups them by code.

| Finding | Codes |
|---|---|
| IS-01 units and level codes | `unit_row` (info), `level_code_combined_on_unit` (info), `level_code_differs` (info; the catalogue's derived code against the sheet's), `level_code_al` (info), `level_code_unknown` (error) |
| IS-02 carry forward | `carry_forward` (warning; read by the `import.carryForward` setting) |
| IS-03 self-study on a taught subject | `self_study_on_taught` (error on a first attempt registered in a window under today's rule; info otherwise), `self_study_retake`, `self_study_not_taught` |
| IS-04 classes and sections | `class_unreadable` (error), `grade_out_of_range` (error), `section_differs` (warning); the sections to make are listed on the Mapping tab |
| IS-05 two series in one tab | `series_other_than_tab` (warning; the line goes to its own series' mapping), note `two_series_one_tab`, `series_missing` (error) |
| IS-06 email is not identity | errors: `email_student_missing`, `email_parent_missing`, `email_student_is_parent`, `student_email_shared` (two children under one email), `email_taken` (the email is a staff account, or the other role); warnings: `duplicate_student` (the same child under two emails), `duplicate_parent`; info: `student_two_parents`, `name_variants` |
| IS-07 no money | note `no_money` |
| IS-08 fee notes and drops | `fee_note` (info; money history), `dropped` (warning; history, never live), `drop_intent` (warning; history "meant to drop") |
| IS-09 phones | `phone_restored` (info), `phone_unusable` (warning; the account is made without it) |
| IS-10 names | `name_cleaned` (info) |
| IS-11 drifted columns | `column_drift` (warning) |
| IS-12 Signature column | `signature` (info; not imported, Q-03) |
| IS-13 duplicate rows | `duplicate_row` (warning; the later line is left out by default) |
| IS-14 two boards in one series | `boards_in_series` (info; each registration is routed to its board's series by F0b) |

Other codes:
- the mapping and the live database: `subject_unmapped`, `teacher_missing`,
  `teacher_on_self_study`, `registration_refused` (the window's own refusal, word for word),
  `cohort_differs`, `graduated`, `left_school`, `already_imported`;
- the money record: `student_not_found`, `amount_unreadable`, `date_unreadable`.

### 4.2 People

For each person the review shows:
- the lines that name them;
- the name spellings, with the most used one chosen;
- the phone;
- the cohort, from class and year;
- the account it matches, when there is one;
- the family.

The review stops the IS-06 cases from becoming wrong accounts:
- **Two children under one student email** (different first names, or different classes) hold
  the family. Staff either give one child's lines their own email ("split") or say they are one
  child.
- **The same child under two emails** (same name, a shared parent) is a warning. Staff merge the
  two emails or say they are different people. A merge keeps the lines and points one key at the
  other.
- **A parent under two emails** (a shared phone, or a shared name and children): the same choice.
- **An email that is a staff account**, or a parent's email given for a student (or the other
  way round), is an error. The account is never reused across roles.
- An existing account with the same email and role is **matched**. It is never recreated or
  renamed, and its password stays.

### 4.3 Mapping settings: the coordinator's pending answers, with today's assumption as default

| Setting | Values (default first) | Where it is kept |
|---|---|---|
| Per tab: include, and the academic year its classes are in | included; the year of the tab's main series | the batch |
| Per series and level ("november-2026-igcse") | `history` (what the student sat before the system), `window` (registrations awaiting payment in an open window: the admin's), `skip` | the batch; the matching open window is suggested |
| Per subject as the sheet writes it, with its level | the best-scoring catalogue row (words, then level), or none (history keeps the sheet's words) | the batch; the admin can add every missing row at once (`POST /:id/subjects`) |
| Per teacher name | an exact match, otherwise "create" | the batch; made in the commit's reference-data step |
| Make the sections the sheet names | on | the batch |
| Course enrolments for the class year | on (F0b's `upsertEnrolments`, source `import`) | the batch |
| Self-study on a taught subject (IS-03, A-02) | `retake_only` (today's rule: a first attempt waits for staff), `in_school`, `enrol_only` | the school-wide setting `import.selfStudyOnTaught`, overridable per batch and per line |
| "Carry forward" (IS-02, Q-02) | `note_only` (kept as written), `result` (an AS result carried into this entry), `payment` (money history) | the school-wide setting `import.carryForward`, overridable per batch |
| Graduates (finished grade 12 by now) | `import` (with their history), `skip` | the batch |
| SCL roster: the year the grades are in | this academic year | the batch |

The two school-wide settings live in F0a's settings store, in the "Import" group, which admin
and coordinator can edit. The Mapping tab also shows the level-code readings (F0b's
`catalogue.levelCodeReading`): how many lines each reading agrees with.

### 4.4 What a commit would make

The summary counts, over the families that are ready:
- students and parents to create or match;
- links;
- section places and new sections;
- enrolments;
- history rows;
- registrations;
- money-history rows.

Each line shows its own plan. A line whose everything exists already says `already_imported`.

## 5. The commit

`services/import/commit.ts`, `commitImport(batchId, actor)`:

1. **The claim.** A status-guarded `UPDATE` moves `staged|partial → committing`.
   - A second commit at the same moment is refused with 409, naming who is committing.
   - A claim older than 15 minutes (a process that stopped) can be taken over.
   - On any error the status returns to what it was.
2. **The admin's part.** A non-admin commit that would make a live registration is refused with
   403: registering families is the admin's, because registrations wait for money. Adding
   catalogue rows is also the admin's (they carry prices). Changing a series to `window` is
   refused to the coordinator at the settings step too.
3. **Reference data**, in one transaction under an advisory lock (`import:reference`):
   - teachers the ready lines name, looked for again by name under the lock;
   - the sections the ready lines place students in, when the year is set up.

   Both are audited (`SECTION_CREATED` via import, `IMPORT_REFERENCE_DATA_CREATED`). The teacher
   ids are written back into the batch's settings.
4. **Each ready family in its own transaction:**
   - the family's `import_row`s are held `FOR UPDATE`, and only lines not yet committed are taken;
   - the students' sections are locked first, then the accounts are inserted. There is no
     password: the family sets one through "Forgot password"; better-auth creates the credential,
     and 08n proves the sign-in. Each account is audited as `IMPORT_ACCOUNT_CREATED` and
     `STUDENT_COHORT_RECORDED` (how: import);
   - links are made approved (`LINK_APPROVED` via import);
   - section places, through `addSectionMembersInTx`, F0a's own checks;
   - `registration_history` rows;
   - course enrolments, through `upsertEnrolments(..., { source: 'import' })` with
     `source_ref` = `import:<batch>:<tab>!<row>`;
   - registrations in an open window, through the desk's own path: `assertMayRegisterForInTx`,
     the window, core subjects in grade 10 June, the teacher link, `prepareRegistrationInputs`
     (price, retake, school-fee gate) and `insertRoutedRegistrations` (F0b's board series).
     They are `pending_payment`, with `[IMPORT] file — tab row n` in their comments, and
     audited as `IMPORT_REGISTRATION`;
   - fee notes and carried-forward payments as `money_history`;
   - finally, each line is marked committed with what it made, the persons are recorded, and
     `IMPORT_FAMILY_COMMITTED` lists what the family made.

   Every audit row is written inside the family's transaction.
5. **A family that fails rolls back whole.** Its lines say why, and the others stand.
   - An email taken at the same moment by someone else (a unique violation) makes the family be
     worked out again and retried once, and that account is then matched.
   - A database refusal is logged on the server and shown to staff as a plain sentence.
6. The batch becomes `committed`, or `partial` while held families remain, with the result: the
   families committed and failed, what was made, and the teachers and sections created.
   `IMPORT_COMMITTED` is written in the same transaction.

**Running it again changes nothing.** What exists is found (the plan says `match`, `exists`,
`history_exists`, `live_exists`). The database's unique keys stop a second copy of anything:
- users by email;
- links;
- open enrolments;
- `registration_history` and `money_history` by (student, fingerprint);
- active registrations.

A re-staged file carries its review over, so the same families are ready. 08n and the real
sheet both show a re-run making nothing.

**Money.** `commit.ts` imports no payment, escrow or receipt table. 08n checks this structurally,
and control C4 makes it red.

## 6. Changes outside the import

- **A subject recorded before the system is a sitting** (V3 §6.9).
  - `getRetakeSubjectIds` reads `registration_history` (outcome registered or dropped, subject
    mapped) as well as confirmed or dropped registrations in other windows.
  - A retake allows outside school at the outside rate, so this is a money path, with 08n
    scenarios.
  - **History counts only when its series is earlier than the window's** (`seriesOrder` in
    `@repo/validations`). History of the window's own series is the same sitting, and a later
    series has not happened yet.
  - The first version counted any history. The real sheet's re-run showed it: 30 self-study
    lines were called retakes of the history just written for their own series. At the desk that
    was a half-price retake, reproduced red in 08n first (§8, C13 and C14).
- `prepareRegistrationInputs(..., executor)`. The import reads inside its family's transaction,
  which holds the teacher links and the history it has just written. Every other caller reads
  committed data, as before.
- `addSectionMembersInTx(tx, ...)`, split out of `addSectionMembers`, which now wraps it with the
  same locks and checks.
- The settings store gains the "Import" group with two keys, and the Settings screen now shows the
  "catalogue" and "import" groups. F0b's `levelCodeReading` was missing from the screen and now
  shows too.
- Audit actions:
  - `IMPORT_STAGED`, `IMPORT_REVIEWED`, `IMPORT_REFERENCE_DATA_CREATED`, `IMPORT_ACCOUNT_CREATED`;
  - `IMPORT_FAMILY_COMMITTED`, `IMPORT_REGISTRATION`, `IMPORT_COMMITTED`, `IMPORT_DISCARDED`;
  - the entity type `import`.

## 7. Roles and endpoints

All endpoints sit under `/v1/imports`, behind `requireAuth` and `requireAcademic` (admin and
coordinator), and are gzipped (`hono/compress`).

| Endpoint | Who | What |
|---|---|---|
| `GET /` | admin, coordinator | every file, its state and counts |
| `POST /` | admin, coordinator | stage an uploaded file |
| `GET /:id` | admin, coordinator | the review |
| `PUT /:id/settings` | admin, coordinator (`window` mode: admin) | the mapping |
| `PUT /:id/rows` | admin, coordinator | fix, skip, include lines |
| `PUT /:id/people` | admin, coordinator | name, phone, merge, different, one child, skip |
| `POST /:id/subjects` | admin | add the missing catalogue rows at once |
| `POST /:id/commit` | admin, coordinator (live registrations: admin) | commit every ready family |
| `POST /:id/discard` | admin, coordinator | put the file aside |

`authz-policy.tsv` has a row for each endpoint across all nine principals. The coordinator's
grants are in `lib/role-grants.ts`. The uploaded file's content (`GET /v1/files/:id/content`,
F0a) is refused to every family and every other staff role (05).

## 8. Screens

The screens are at `/imports` and `/imports/:id`, in the nav under Management → Import for the
admin and School → Import for the coordinator. They use the existing components and CSS
variables. Every string goes through `lib/i18n.tsx`, in English and Arabic
(`lib/i18n-import.ts`), with right to left checked. Rows of data are marked `data-i18n-skip`.
There is no new `useQuery` generic: the count is 32. Row types are derived from the fetchers.

Each screen against the Excel version of the task (UX_AUDIT.md §4):

- **Upload** (`/imports`).
  - *Excel:* there is no import. Going live means typing every family into the system at the
    desk: 245 students and 246 parents in the real sheet, each one a sign-up, a link and a
    registration, with the sheet open beside it.
  - *Here:*
    - three source cards (the school's sheet, SCL's roster, the money record), each template
      downloadable;
    - a drop zone and "Stage for review";
    - the list of every file with its state and counts.
- **The staged review** (`/imports/:id`). A summary strip shows lines, importing, left out,
  families ready and held, and errors; "About this file" holds the notes.
  - **Problems.**
    - *Excel:* reading 654 lines by eye for shared emails and drifted columns.
    - *Here:* one group per problem, with how many lines it touches, what it means, and the first
      lines with a Fix button.
  - **Rows.**
    - Filters are kept in the address: to fix, with a problem, a tab, and a search.
    - Bulk skip and include.
    - A virtualised list: 460 lines draw 16 rows, with keyboard navigation.
    - "Open line" shows the editor. The field a problem is about is highlighted and focused, and
      Enter saves. The self-study answer is two buttons. It shows the decision, the plan and the
      outcome, and the raw line "As the sheet has it".
  - **People and conflicts.**
    - *Excel:* noticing that two lines are one child.
    - *Here:* conflicts first. Split a shared email, merge, "different people", "one child",
      another email, choose the name or phone, skip or bring back, undo a merge. Then come
      Students, Parents, Accounts found, and Merged or left out.
  - **Mapping.**
    - Tabs and their class year, and the SCL grade year.
    - Each series and level: history, window (admin only) or leave out, with the open windows.
    - Subjects mapped to the catalogue. "Add missing subjects" is the admin's; the default board
      is Pearson for units and Cambridge otherwise.
    - Teachers, and the sections toggle.
    - The coordinator's answers as radio buttons, the enrolment toggle, and the level-code
      readings.
- **Commit and its summary.**
  - *Excel:* none. A half-typed family stays half-typed.
  - *Here:* "Commit N families?" says what will be made. The Result tab shows each family
    committed or failed with its reason, what was made, and the teachers and sections created.
    Every line keeps its outcome.

The screens were driven in headless Chrome on synthetic data as the coordinator and the admin:
- upload, problems, a problem opened, rows, the editor;
- people before and after split and merge;
- mapping for both roles;
- the commit dialog and the result;
- the list, problems, rows, the editor, people and mapping in Arabic, right to left.

The screenshots are `.audit/import-evidence/screens/f7-*.png`.

**400+ lines** (`perf-460-rows.json`, a synthetic 460-line sheet):

| Measure | Result |
|---|---|
| Staging and the first view | 1.0 s |
| The review request | 32 ms |
| The review's size | 1.1 MB of JSON, 74 KB gzipped |
| The Rows tab to its first row | 145 ms |
| Rows drawn | 16 |
| A scroll across all 460 | median 17 ms, p95 17 ms, max 34 ms |
| A search | 16 ms |

## 9. Tests

`apps/api/test/08n-import.test.ts` (35 tests), with its fixtures in `import-fixtures.ts`: a
minimal xlsx writer, and synthetic sheets with the real sheet's shapes.

| Scenario (FEATURES_PLAN F7) | Test |
|---|---|
| a sheet with the spike's known problems staged with every problem flagged | "a sheet with the spike's known problems…": tabs read by their headers; one test per IS finding (IS-01 … IS-14); the mapping's suggestions and plan counts; staging changes nothing in the school |
| a commit creating exactly the reviewed rows | "the review, then a commit…": fix (a typed email, a split, a parent's own email, a class), merge and skip, carry forward read as an AS result, then the commit's exact users, links, sections, enrolments, history, money history and audit counts, each traceable to its line; an imported parent signs in after "Forgot password" |
| a re-run changing nothing | "a re-run of the same file changes nothing": staged again, the review carries over, everything is found, the commit makes nothing |
| registrations (the admin's) | an open window suggested; each line checked as the desk would (level, price, board series, eligibility, the school-fee gate for a new family, grade-10 June core subjects); the coordinator refused; the admin's commit makes `pending_payment` registrations in their board series, never paid; a retake of imported history at the outside rate; **history of the window's own series or a later one is not a retake**, at the desk or in the review |
| SCL template | a CSV missing columns refused with what is missing; the cohort that starts grade 10 next year, two parents, the grade-10 section in that year; the SCL id in the audit row |
| money record | history only; no payment, receipt or balance moves; the same file again adds nothing; the structural check that the commit touches no payment, escrow or receipt table |
| the race | two staff commit the same staged file while the claim row is held: [200, 409], each family made once (8 users, 4 `IMPORT_FAMILY_COMMITTED`, 1 `IMPORT_COMMITTED`) |

Also:
- **authz-policy.tsv:** a row for each of the 9 endpoints across the 9 principals.
- **05:** "F7 a staged file is staff-only". The parents and students of both families, the
  finance officer, the finance admin, the teacher and the gate get 403 on the review, the list,
  rows, people, commit and discard, and 404 on the file's content; nothing changes.
- **09:** "F7: money from before the system is history only". Every `money_history` row traces to
  a committed `import_row`, and none shares a transaction (`xmin`) with an escrow movement, a
  payment registration, a payment or a receipt.
- **08f:** the coordinator's editable settings gain the two import keys.

**Controls**
(`.audit/import-evidence/controls.py`, logs `control-C*.log`, a trail row each). Each guard was
undone once, run, and restored:

| Control | What was undone | Result |
|---|---|---|
| C1 | the commit claim | red, the race answers [200, 200] |
| C2 | the carried-over review | red |
| C3 | imported history read as a sitting | red |
| C4 | the commit module importing `payment` | red |
| C5 | the coordinator's `window` refusal | red |
| C6 | the school-fee gate for a new student | red |
| C7 | column drift flagged | red |
| C8 | the duplicate line left out | red |
| C9 | two children under one email | red |
| C10 | the routes' role gate | red in 05 |
| C11 | the family's lines re-read under the lock | **green**: the claim already serializes commits of a file. It stays as defence in depth for a claim taken over as stale |
| C12 | C1 and C11 together | red |
| C13 | `getRetakeSubjectIds` counting all history | red |
| C14 | the review counting all history | red |

## 10. Proof on the school's real sheet (privately)

`apps/api/scripts/import-real-sheet/counts.ts` runs the real sheet through the API exactly as
staff would:
1. stage the sheet;
2. the admin adds the missing catalogue rows (no prices);
3. the coordinator commits;
4. stage the same file again and commit it.

It runs on a throwaway database (`igcse_import_real_test`), dropped at the end together with the
uploaded copy, even on failure. The report holds counts and row numbers only; staff appear as a
count. It was run twice: on 9f8bd13 (`real-sheet-run.md`) and on c0a70a3 after the retake fix
(`real-sheet-run-2.md`).

**Staged**
- 654 lines, from tabs "2024" (220 lines, November 2026) and "Sheet1" (434 lines, June 2023);
  seven roster tabs were listed and left alone.
- 649 lines importing; 5 left out (duplicates).
- 244 families: 222 ready, 22 held by 74 error lines.

**The 74 error lines**

| Problem | Lines |
|---|---|
| two children under one email | 53 |
| a student's email is a parent's | 12 |
| parent email missing | 8 |
| student email missing | 3 |

**Warnings**

| Problem | Count |
|---|---|
| subject not in the catalogue (before the admin added 52 rows) | 649 lines |
| carry forward | 19 lines |
| a series other than its tab's | 18 lines |
| "I will drop the course" | 9 lines |
| dropped | 6 lines |
| unusable phone | 5 lines |
| duplicate line | 5 lines |
| column drift | 5 lines: Sheet1!329, 330, 349, 428, 429, as the spike found |
| the same parent under two emails? | 49 people |
| the same child under two emails? | 25 people |
| cohort differs | 6 people |

**Information**

| Note | Count |
|---|---|
| phone restored | 639 lines |
| name cleaned | 286 lines |
| unit lines | 208 |
| Signature | 157 lines |
| "A.S./A.2." on a unit | 82 lines |
| "A.L." | 42 lines |
| fee notes | 40 lines |
| self-study on a taught subject | 35 lines |
| self-study, not taught | 9 lines |
| name variants | 52 people |
| graduated | 149 people |
| a child with two parents | 26 people |

**The commit** (the coordinator, history only)

| Committed | Count |
|---|---|
| families | 222 (0 failed) |
| students | 245 |
| parents | 246 |
| links | 269 |
| section places | 114 |
| enrolments | 200 |
| history rows | 567 |
| money-history rows (fee notes) | 40 |
| teachers | 8 |
| sections (11A–E and 12A–D) | 9 |
| registrations | 0 |
| payments | 0 |

**The re-run.** The review carried over and found the 567 history rows there; the commit made
nothing, and no table changed. On the first run the re-run's review called 30 self-study lines
retakes of their own series' history. That was the bug fixed in c0a70a3; on the second run the
re-run reads as the first staging.

## 11. Decisions and why

- **The review is computed, not stored.** Stored state is only what staff decided. Everything
  else follows the database as it is when staff look, so a family onboarded at the desk during
  the review is matched rather than duplicated.
- **One transaction per family, not per file.** A file of 244 families should not wait on one
  shared email. Each family is whole or absent, and the held ones wait for their fixes.
- **Email is the key, and the review refuses what email cannot tell apart** (IS-06). Two children
  under one email are never made one account. A staff email is never reused as a family's.
- **A live series defaults to history.** Registering families makes money owed, so it is the
  admin's choice per series and level, and every live line faces the desk's own checks. The
  coordinator can bring the whole school in as history without that power.
- **No money is imported as money.** A fee note, a carried-forward payment or a money-record line
  is `money_history`. The module that commits cannot import the money tables. Registrations the
  import makes wait for payment like any other (F-01: how pre-system payments become confirmed
  is the owner's).
- **History is a sitting only before the window's series.** The same series is the same sitting;
  otherwise the default history import would make the live tab's subjects half-price "retakes".
- **Imported accounts have no password.** The school vouches for the email, as a desk-made
  account does (verified). The family sets its password through "Forgot password", whose link
  only the email's owner receives.
- **Idempotency lives in the database**, in unique keys over fingerprints. A re-run is safe even
  without the carried review.
- **Teachers are matched by exact name only.** Near matches are left to staff on the Mapping tab,
  because a wrong teacher is worse than a new one.

## 12. Deferred, and why

- **The SCL student id is not stored on the user.** It is kept in the audit row. Whether the
  school wants it as an identifier is a question (Q-05, Q-09).
- **No invitation emails.** The commit does not email families: the school decides when go-live
  is announced. "Forgot password" works today.
- **Registrations paid before go-live cannot be marked paid by the import.** They are history, or
  `pending_payment` in a window (F-01).
- **F4 and F5 do not read `registration_history` yet.** F4's `getSittings` and F5's advisor
  should (§2 contract).
- **The commit works the review out again per family.** It is correct under concurrent change.
  The real sheet's whole run (staging, the review, adding subjects, and committing 222
  families) took 13 s; it would be slow only at thousands of families.
- **The money record's own format** waits for the real record (F-01). The template is the
  mapping target.

## 13. Questions for the owner (through the coordinator)

1. **Shared and missing emails** (IS-06, Q-05): 53 lines where two children share an email, 12
   where a student's email is a parent's, 11 missing. Staff can split them in the review, but
   which email belongs to whom is the family's. Should the desk collect a proper email per
   child before go-live?
2. **Registrations paid before go-live** (F-01): how they become confirmed in the system (a
   money record the finance admin posts, or registrations created paid by the admin with a
   receipt).
3. **Carry forward** (IS-02, Q-02): a result or a payment. Today: kept as a note.
4. **Self-study on a taught subject** (IS-03, A-02): today's rule allows it only on a retake.
   Should the 35 real lines be in school, enrolment only, or allowed?
5. **Boards and level codes** (IS-01, IS-14): which board each subject and unit is entered with;
   what "A.S./A.2." on a single unit means; whether "A.L." is "A.2.".
6. **Graduates:** import the 149 students who have finished grade 12, with their history
   (today's default), or leave them out.
7. **The SCL id:** store it on the student as an identifier?
8. **Invitations:** email every imported family at go-live, or let the desk hand out "Forgot
   password"?

## 14. Contracts for later features

- `registration_history` (student, subject, series, outcome, mode, teacher, source): what a
  student sat before the system. `getRetakeSubjectIds` reads it; F4's sittings and F5's advisor
  should read it too.
- `money_history`: money before the system, for finance's history views; never balances.
- The settings `import.selfStudyOnTaught` and `import.carryForward`.

## 15. Progress log

- 2026-09-30 02:47Z — started on `feature/import` from origin/main e5da650; baseline suite green
  on `igcse_import_test` (22 files, 308 passed, 1 todo).
- 03:14Z — schema (0041), validations, reader, staging, review, commit, routes (86a524b).
- 03:24Z — 08n: the three named scenarios and the race (82a2e35).
- 03:30Z — registrations in a window, SCL roster, money record, authz rows, 05, 09; suite green
  in local time (23 files, 343 passed) (ea1f744).
- 03:45Z — the screens: /imports and /imports/:id (7f154bf); driven once end to end in headless
  Chrome on synthetic data as the coordinator (upload, fixes, split, merge, skip, commit).
- After a spend-limit stop — Arabic dictionary, compact summary, editor focus (2b25624).
- 03:46–04:20Z — screens driven in English and Arabic; 460 lines measured; the review gzipped
  (0a9d8d1).
- 04:25–04:27Z — controls C1–C12 (5c24ef7).
- 04:29Z — the real sheet, privately (9f8bd13).
- 04:45–04:51Z — the retake fix found writing this document: reproduced red, controls C13–C14,
  fixed (c0a70a3); the real sheet run again (ddccc18); 08n proves an imported account's first
  sign-in (3b3ce38).
- Merged origin/main 20d87c8 (332ef18).
- Next: the gates in local time and UTC, push, CI.
