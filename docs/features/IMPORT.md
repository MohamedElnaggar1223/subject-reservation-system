# F7 — Day-one import (as built, on the reservations rework)

Branch `feature/import`. Started from `origin/main` e5da650 (F0a and F0b merged); frozen on 7 Oct 2026 at
e58324b while the reservations rework was designed and built; resumed on 8 Oct 2026 by merging
`origin/main` 2a26557 (the rework's steps A, B and C and the lead's step 4) as its own commit
(2226d03) and moving the import onto sessions, offers, items, the fee grids and reservation lines
(RESERVATIONS_REWORK.md §9's F7 list and §10's row). The plan is FEATURES_PLAN.md §1 "F7 — Day-one
import" and §5's rules. The evidence behind it:
- IMPORT_SPIKE.md (IS-01 to IS-14);
- DISCOVERY.md (A-02, A-03, A-04, Q-02, Q-03, Q-05, Q-09, F-01);
- DISCOVERY_RESEARCH.md §1; SCHOOL_FORMS.md §2 and §3 (the forms' options, the fee lists);
- RESERVATIONS_REWORK.md §3.2–§3.5 and docs/features/RESERVATIONS.md, RESERVATIONS_LINES.md,
  RESERVATIONS_MONEY.md (the contracts the import uses).

The trail is `.audit/import.tsv`. The evidence of the work on the new model is in
`.audit/import-evidence/rework/` (force-added, every file under 300 KB: control logs kept as the
failing tests and the vitest summary, the gates' summaries, the drive's scripts and their
synthetic outputs, the screenshots). Evidence from before the freeze stayed on the implementer's
disk (it held full suite logs of 2.7 MB and the private real-sheet reports) and is not committed.
The progress log is the last section.

**The school's real sheet never enters the repository, a test, a screenshot or a log.** It is
cited by row numbers and counts only; tests build synthetic sheets with the same shapes
(`apps/api/test/import-fixtures.ts`), with placeholder names. On 8 Oct the 64 full names quoted in
the fixtures, tests, this document and the trail were checked privately against the sheet: none is
a student's, parent's or teacher's name there (§10).

F7 is how the school goes live. It gives three things:
- **A staged review.** Staff check the school's own sheet before anything is made: every problem
  the spike found is flagged on its line; people and families are worked out; each line of a
  series the admin maps to its session shows the reservation line it would be — its subject and
  item, its entry, the sitting it follows and its price from the session's fee grid; staff fix,
  merge or skip line by line; the coordinator's pending answers are settings.
- **A commit that makes exactly what the review showed.** One family per transaction. Every row
  it makes points back to its line, and running the same file again changes nothing.
- **Two templates** for what the school does not have yet: SCL's grade-9 roster, and the money
  record.

Money from before the system is history only: nothing here makes a payment, a receipt or a
balance. The lines it makes in a session wait for payment like any other line.

---

## 1. Sources and templates

| Kind | What it is | How it is read |
|---|---|---|
| `school_sheet` | The school's registration workbook (.xlsx): session tabs such as "2024" (the November 2026 form) and "Sheet1" (June 2023), plus hand-made per-unit roster tabs. | A tab is a **session tab** when a header row has "student name", "subject" and "student email". Unlabelled columns are given their role by what most of their cells hold: the series (a date serial or text — never a fee note that names a sitting), the confirmation, the self-study answer, the fee note, and the parent's name, which is the column after the student's email. The tab's title row ("Nov. 2026 Session") gives its main series. Roster tabs (no emails) are listed and not imported (note `roster_tab_ignored`, A-04). |
| `scl_roster` | SCL's export at the grade 9→10 boundary (DISCOVERY.md Q-09). The template is `SCL_ROSTER_TEMPLATE`, downloadable on the upload screen. | CSV (RFC 4180; comma, semicolon or tab; BOM stripped). Headers: `student_name, student_email, student_phone, scl_student_id, grade, grade10_section, parent_name, parent_email, parent_phone, second_parent_name, second_parent_email, second_parent_phone`. Required: `student_name, student_email, grade, parent_email`; a file without them is refused, naming the missing columns. |
| `money_record` | The money record before the system (DISCOVERY.md F-01, not yet seen). The template is `MONEY_RECORD_TEMPLATE`. | CSV. Headers: `student, date, amount_egp, direction, kind, percent, method, receipt_number, series, subject, note`. Required: `student, kind`. Each line becomes a `money_history` row, and nothing else. |

The reader is `apps/api/src/lib/xlsx.ts` (zip offsets checked; only the workbook's own parts are
inflated; at most 2000 parts and 128 MB inflated in total — review flag 10). The CSV reader is
`apps/api/src/lib/csv.ts`; source reading is `services/import/source.ts`.

**Normalising** (`services/import/normalise.ts`):
- **Phones.** Egyptian mobiles as `01xxxxxxxxx`; a leading 0 lost to a number cell restored.
- **Names.** Non-breaking, trailing and doubled spaces removed.
- **Classes.** "11A" gives the grade and the section.
- **Level codes.** O.L., A.S., A.2., A.L., and the combined codes.
- **Series.** From the row's series column, otherwise the tab's title.
- **The fee note and the self-study answer** (IS-03, IS-08, and §9 of the rework: *the fee note
  gives the attempt and the mode*). A note is read for: self-study (or the external rate); a
  retake or a second entry ("Retake …", "ONLY 2nd entry"); one paper only; the sitting it names
  ("From June 2026"); a drop and its percentage. Self-study is the yes/no answer or a note that
  says so; **a note that says self-study against an explicit "No" is read as self-study and
  flagged** `self_study_contradiction` (warning, review flag 7) — staff set the line's self-study
  themselves when the answer is right.
- **Carry forward.** "Carry forward on June 2022" in the Signature column, with its series.
- **Column drift.** A value in another value's column is read by what it says, and flagged (IS-11).

## 2. Data model (migration 0050_import)

All in `packages/db/src/schema.ts`. The migration is generated DDL only. It was 0041 on the frozen
branch; at the merge of main it was deleted and generated again on main's journal (review flag 8,
FEATURES_PLAN §3) as `0050_import`, the same statements, its journal time after 0049's; the order was
proven on a copy of the dev template migrated with main's migrations first (50 rows, no import
tables), then with the branch's (51 rows). Step D (messages and reminders) lands its own migrations
first, so the import's is generated once more at its merge.

| Table | What it holds | Rules |
|---|---|---|
| `import_batch` | One staged file: kind, the uploaded file (purpose `import_file`), name, SHA-256, status (`staged`, `committing`, `committed`, `partial`, `discarded`), the source's tabs, the mapping settings, the last summary, the commit's result, who staged, claimed, committed or discarded it and when. | The status moves only through the commit's claim (§5) and discard. |
| `import_row` | One line of the file: tab, row number, the raw cells as `[header, value]` pairs, the staff's edits, the decision, status (`pending`, `committed`, `failed`), what the commit made for it (`outcome`) and its error. | Unique (batch, tab, row). A committed row does not change. |
| `import_person` | A student or parent of the file, keyed by email: the staff's decisions; after the commit, the account it became. | Unique (batch, role, key). |
| `registration_history` | A registration the school recorded before the system: student, subject (when mapped) and the sheet's words, level code, series, in school or self-study, the teacher, the outcome (`registered`, `dropped`, `drop_intended`), a carried-forward reading, a fingerprint, the batch and row, `source_ref`. | Unique (student, fingerprint). |
| `money_history` | Money before the system, as history (kind, direction, amount, percent, date, method, receipt number, series, subject, note), fingerprint, source. | Unique (student, fingerprint); no link to payments, escrow or receipts. |

The lines the import makes in a session are ordinary `registration` rows (RESERVATIONS.md §1.6)
with their two `registration_consent` rows on the `imported` channel; nothing of the rework's
schema is added or changed by F7.

## 3. The staged model

**1. Stage** (`POST /v1/imports`, admin or coordinator)
- The uploaded file is read into its tabs and lines; one `import_row` per line. Nothing else in the
  school changes (08n asserts it).
- **What staff decided before is carried over** (review flag 3), from every earlier file of the
  same kind that was not discarded, whatever its bytes:
  - a line's fixes and decision go with **what the line says** (its cells, and which of several
    identical lines it is), never with where it sits, from the newest earlier file that has it;
  - a person's decisions (name and phone chosen, merge, "different people", "one child", skip) go
    with their role and email, from the newest earlier file that decided them;
  - the mapping comes from the same bytes staged before, or — for the school's sheet — from the
    newest earlier file with the same session tabs (the same names and titles: the same sheet
    exported again). Another sheet starts from the defaults.
  - `IMPORT_STAGED` records what was carried and from where.

**2. Review** (`GET /v1/imports/:id`) — worked out each time it is read (`services/import/view.ts`,
which writes nothing; the rules on lines are asked in a transaction that is rolled back, §4.5).
Only the staff's own input is stored.

**3. Fix, merge, skip** (each change audited as `IMPORT_REVIEWED`)
- `PUT /:id/rows`: edits (name, email, phone, parent, "no parent on file", class, level code,
  subject, teacher, series, self-study, the self-study answer for the line, **the item of the
  session** `offerItemId`, **first entry or retake** `attempt`, **the sitting a retake follows**
  `priorSitting`), clearing an edit, `import` / `skip` with a note, confirming a link to an
  existing account.
- `PUT /:id/people`: the name or phone; merge into another person **or into an account already in
  the system of the same role**; undo; "different people"; "one child"; skip.
- `PUT /:id/settings`: the mapping (§4.3).

**4. Commit** (`POST /:id/commit`) — every family with nothing left to fix, each in its own
transaction (§5). The held ones wait; the batch becomes `partial`.

**Discard** (`POST /:id/discard`) puts a file aside. What it already committed stays.

### Families

A family is the set of students and parents the importing lines join (union-find over student and
parent keys, after merges) — the unit of a commit. **Held** while any line in it has an error;
**ready** otherwise; then `committed`, `partly_committed` or `failed` (with the reason).

## 4. The review

### 4.1 Every problem, flagged

Each code is defined in `IMPORT_PROBLEMS` (`@repo/validations`) with its severity, its finding, a
title and what it means. The Problems tab groups them by code.

| Finding | Codes |
|---|---|
| IS-01 units and level codes | `unit_row`, `level_code_combined_on_unit`, `level_code_differs`, `level_code_al` (info); `level_code_unknown` (error) |
| IS-02 carry forward | `carry_forward` (warning; the `import.carryForward` setting) |
| IS-03 self-study | `self_study_on_taught` (error on a line in a session: a first entry in self-study of a taught item, "Self-study on a first entry needs the exception: grant it on the Exceptions page or make it a retake with its sitting"; info when the coordinator's answer, the line's choice or the student's exception settles it, and on history), `self_study_retake`, `self_study_not_taught` (info), `self_study_contradiction` (warning, review flag 7) |
| IS-04 classes | `class_unreadable`, `grade_out_of_range` (error); `section_differs` (warning) |
| IS-05 two series in one tab | `series_other_than_tab` (warning), note `two_series_one_tab`, `series_missing` (error) |
| IS-06 identity | errors: `email_student_missing`, `email_parent_missing`, `email_student_is_parent`, `student_email_shared`, `email_taken`, `link_to_existing_account` (review flag 6), `duplicate_account` (review flag 3: someone not matched by email looks like an account already in the system — the same name and a parent, or the same phone; accounts the same file's commit made are its own people and stay the in-file warnings); warnings: `duplicate_student`, `duplicate_parent`; info: `student_two_parents`, `name_variants` |
| IS-07, IS-08 money | note `no_money`; `fee_note` (info), `dropped`, `drop_intent` (warning) |
| IS-09, IS-10 | `phone_restored` (info), `phone_unusable` (warning), `name_cleaned` (info) |
| IS-11 to IS-14 | `column_drift` (warning), `signature` (info), `duplicate_row` (warning), `boards_in_series` (info) |

**The lines in a session** (the rework; §4.5):

| Code | Severity | When |
|---|---|---|
| `not_offered` | error | no subject of the session fits the line's words |
| `item_unclear` | error | the words fit none, or more than one, of the subject's items; the candidates are named |
| `fee_missing` | error | the item has no row in its series' fee grid; the detail is priceLine's sentence naming the grid |
| `price_provisional` | info | the grid's row is provisional: the line is priced at it and marked provisional |
| `retake_sitting_missing` | error | the note says a retake or a second entry and neither the history nor the line names the sitting |
| `consent_missing` | error | the sheet does not show the family's "I confirm my registration" |
| `teacher_not_on_offer` | warning | the teacher named does not teach the subject in the session |
| `registration_refused` | error | the session would refuse it: eligibility, the school fee, the session or series closed or past its effective deadline, a rule on lines (the sentence word for word), grade 10's core subjects |

Others: `subject_unmapped`, `subject_inactive`, `teacher_missing`, `teacher_on_self_study`,
`cohort_differs`, `graduated`, `left_school`, `already_imported`; the money record's
`student_not_found`, `amount_unreadable`, `date_unreadable`.

### 4.2 People

As before: the lines that name each person, the name spellings, the phone, the cohort, the account
matched by email, the family; two children under one email hold their family until split or said
to be one child; the same child or parent under two emails is a warning to merge or call
different; a staff email or the other role's is an error; an existing account with the same email
and role is matched, never recreated or renamed. New since flag 3: a person not matched by email who
looks like an account already in the system is `duplicate_account` until staff merge them into it
or say they are different people.

### 4.3 Mapping settings

| Setting | Values (default first) | Where it is kept |
|---|---|---|
| Per tab: include, and the academic year its classes are in | included; the year of the tab's main series | the batch |
| Per series and level ("november-2026-igcse") | `history`; **lines awaiting payment in the session of that series** (stored as `window`; the admin's); `skip` | the batch. The sessions offered are those of the series' cycle (June Y; winter Y for October and November Y; winter Y−1 for January Y); the only open one is suggested |
| Per subject as the sheet writes it, with its level | the best-scoring catalogue row, or none | the batch; the admin can add every missing row at once (`POST /:id/subjects`: active, **no fees** — §11) |
| Per teacher name | an exact match, otherwise "create" | the batch |
| Make the sections the sheet names; course enrolments for the class year | on | the batch |
| Self-study on a taught subject (IS-03, A-02) | `retake_only` (the forms' "ONLY 2nd entry"), `in_school`, `enrol_only` | `import.selfStudyOnTaught`, overridable per batch and per line |
| "Carry forward" (IS-02, Q-02) | `note_only`, `result` (an AS result carried: the line's sitting), `payment` | `import.carryForward`, overridable per batch |
| Graduates; SCL's grade year | `import`; this academic year | the batch |

### 4.4 What a commit would make

The summary counts, over the ready families: students and parents to create or match, links,
section places and new sections, enrolments, history rows, **lines awaiting payment**, money-history
rows. Each line shows its own plan; a line in a session also carries **its line** (`plan.line`,
`ImportLinePlan` in `@repo/validations`): the session, the offer and item and how they were found,
the board series, the attempt and mode, the sitting it follows with its month, year, source and
origin (history, the note, the line, a carry forward), the teacher, and the price with its course
and board parts, their bases and percents and the provisional mark.

### 4.5 A line in a session (RESERVATIONS_REWORK.md §9's F7 list)

For a line whose series and level the admin mapped to its session (`lineOf` in view.ts):

1. **Offer and item.** `findOffer(sessionId, term, { subjectId, levels })` and `findItem(offerId,
   label, { month, year })` (added to A's `offer.services.ts`, §6): the offer of the mapped catalogue
   row, else the subject named by name or code (or without its bracket) **at the line's level** (an
   A.S. line never lands on an IGCSE subject of the same name; two at its level are ambiguous and
   none is chosen), else the one offer with an item entering every unit the words name, or any of
   them when none enters all ("Pure Mathematics 1 (P1)" → the IAL Mathematics offer's P1 item); the
   item labelled so, else the one entering exactly the unit or paper named, else the whole subject;
   among several, the one in the sheet's month and year. Staff may choose the item on the line
   (`offerItemId`, one of the session's items).
   - **A line naming several units or papers is split** (the review of 8 Oct, item 2): when no
     single item enters them all ("Biology (Paper 1 & Paper 2)", "Mathematics (P1 & M1)"),
     `findItemsByCode` finds one item per code and the row makes **one line per item**, each with
     its own attempt, sitting, teacher and price, listed in the row's line section with its code
     (`line_split`, info, names each code and its item). A code no item of its own fits leaves the
     row `item_unclear` ("…: choose the item for p5 (M1 · P1 · P2)") until staff choose the item
     **for that code only** (`codeItems`); staff may instead choose one item for the whole line. A
     "one paper" note is one line of one paper, never split.
   - **A "one paper" note is never the whole subject** (the forms' "(One paper ONLY)"; the review of
     2ca07a4, item 1): when findItem falls back to the whole item (the words name no paper), the
     line's item is the subject's one-paper item when it has exactly one (a unit counts: it is one
     paper) and the words name no other paper; else the line is `item_unclear` — "<subject>: the note
     says one paper — choose which (Paper 4 only (retake) · Paper 5 only (retake))", or "…, and none
     of its items is one paper — choose the item (…)".
2. **Attempt, mode and the sitting** (the lead's rules of 8 Oct, MO-25's interim rule):
   - mode: self-study from the answer or the note, or when the item or offer is self-study only;
   - a **retake with source `legacy`** when the student's history has the subject **sat** (not
     dropped, nor a drop the family meant) in an earlier series of the item's board **that had ended
     when it was committed** (the history row's creation; a history line of the same file counts as
     committed now) — the latest such;
   - a **retake with source `declared_by_desk`** when the sheet names the sitting ("From June
     2026"; "Carry forward on …" read as a result) or staff name it on the line; listed on the
     session's To verify tab;
   - **an item that needs a prior series** (a carry-forward route, "A2, carry forward") is a
     **first entry carrying the sitting** — the one staff name, the student's legacy history, the one
     the note names, or a carry forward read as a result — and a retake only when the note or staff
     say so (the review of 8 Oct, item 1): a retake would take the retake deadline and the self-study
     share without the exception, and be entered with the board as a re-sit. Staff's "First entry"
     keeps the carried sitting;
   - a note that says a retake with neither: `retake_sitting_missing` (error) — never `legacy`
     without a series;
   - self-study on a first entry of a taught item: `self_study_on_taught` (error) unless the
     coordinator's answer (`in_school`: taught; `enrol_only`: enrolment, no line), the line's
     choice, or the student's `gate.selfStudyFirstEntry` exception;
   - B's known sittings (`knownSittingsOf`) are **not** extended to `registration_history`: at the
     desk a sitting not on record is declared and verified.
3. **The teacher**: the one the sheet names when the item or offer has them; else its only one;
   else none yet ("no preference").
4. **The price**: `priceLine(item, attempt, mode, student, session)` from the series' fee grid now —
   a missing row is `fee_missing` with priceLine's sentence naming the grid; a provisional row is
   `price_provisional` and the line priced at it, **never 0** (MO-9).
5. **The session's own checks**: `sessionWindow` with the line (open, or the student's extension),
   the effective deadline (`effectiveDeadlineFor`; a series with no dates takes no line), the
   student's eligibility (`mayRegisterFor`, or `judgeEligibility` for a student the import will
   make), the school-fee gate, the family's confirmation.
6. **The rules on lines**: `assertLineRules` per student and session in a transaction that is
   rolled back — each line against the student's lines in the system and the file's earlier ones
   (availability, a retake's sitting, exclusive items, the same entry once across sessions, the
   items a first entry requires, the carry-forward period; a sitting not on record is made inside
   the rollback to be checked); grade 10's core subjects over the student's lines together.

## 5. The commit

`services/import/commit.ts`, `commitImport(batchId, actor)`:

1. **The claim.** A status-guarded `UPDATE` moves `staged|partial → committing`; a second commit
   at the same moment is refused with 409 naming who is committing; a claim older than 15 minutes
   can be taken over, and a commit taken over writes neither its final status nor a reset (review
   flag 5).
2. **The admin's part.** A non-admin commit that would make a line in a session is refused with 403
   ("Reserving lines for families in a session is the admin's …"); mapping a series to a session is
   refused to the coordinator at the settings step too; adding catalogue rows is the admin's.
3. **Reference data**, in one transaction under an advisory lock: teachers the ready lines name, and
   the sections they place students in.
4. **Each ready family in its own transaction** (its view worked out again):
   - its `import_row`s held `FOR UPDATE`, only lines not yet committed taken;
   - sections locked; then **the family's students already in the system, `FOR NO KEY UPDATE` in id
     order, before any row that names a subject** (`lockStudents`; history, enrolments and lines
     share-lock the subject, and a subject's board change takes the students before the subject —
     the review of 2ca07a4, item 3); then accounts (no password: "Forgot password" sets one), links (a
     link to an existing account only once confirmed on its line), section places,
     `registration_history`, course enrolments (`upsertEnrolments`, source `import`);
   - **lines in a session** (`reserveImportLines`): **every student of the family with lines held
     `FOR NO KEY UPDATE` in id order before the first line** (`lockStudents`, RESERVATIONS.md §2.1;
     the review of 8 Oct, item 5: no student's line, fee row or one-shot exception is locked while
     another is still to be locked); then per student and session, in that order: the student's
     eligibility under the lock (`assertMayRegisterForInTx`); every line of each row — one per item
     of a split row; a line the student holds already on the item is not made again; each line's window and effective
     deadline; a sitting named but not on record made as a board series with no dates
     (`findOrCreateSeries`, audited); the school-fee gate; then **`insertLines`** — the rework's
     locks in their order, `assertLineRules`, `priceLine` from the grid, the due date, the teacher —
     status `pending_payment`, `[IMPORT] file — tab row n` in its comments; then
     **`writeConsents(…, { channel: 'imported' })`**: the sheet's "I confirm my registration" is the
     family's consent to the refund policy and the declaration, and freezes the session's refund
     steps on the line as B's consent does; `IMPORT_REGISTRATION` lists each line with its row,
     item, attempt, mode, sitting source, price and provisional mark;
   - money history (fee notes; carried-forward payments under that reading);
   - each line marked committed with what it made (`registrations`: every line it made);
     `IMPORT_FAMILY_COMMITTED`.
5. **A family that fails rolls back whole**; its lines say why. A unique violation (an email taken
   meanwhile) retries the family once.
6. The batch becomes `committed` or `partial`; `IMPORT_COMMITTED` in the same transaction. The
   result lists the sheet's lines split into several lines (`rowsSplit`: the line and how many).

The import does not move existing lines (RESERVATIONS.md §2.11–§2.12's three calls for a move of
lines do not apply): it makes new ones, through the reservation paths' own function.

**Running it again changes nothing**: what exists is found; the unique keys stop a second copy
(users by email, links, open enrolments, history and money history by fingerprint, the live line
per student, session and item).

**Money.** `commit.ts` imports no payment, escrow or receipt table (08n checks it; C4). The lines it
makes are priced and wait for payment; nothing is paid.

## 6. Changes outside the import

- **`findOffer`, `findItem` and `findItemsByCode`** (`apps/api/src/services/offer.services.ts`, A's
  service; the smallest addition: nothing on main served them — `resolveItem` gives a subject's
  whole item only). Named in RESERVATIONS.md §2.12.
- **`assertLineRules(…, { lockExceptions: false })`** (A's `line-rules.services.ts`): the review's
  rolled-back check reads the one-shot exception rows without `FOR UPDATE` (a GET holds no row);
  every path that makes lines keeps the lock.
- **MO-9 on the offer** (A's `offer.services.ts` and `offer.validations.ts`; the review of 8 Oct,
  item 6, and the lead's call on the review of 2ca07a4, item 2): an open or retakes-only offer is
  refused with a course fee of 0, at creation and on update, naming the subject ("Astronomy has no
  course fee: set the school's course fee before it is open in this session (a line is never priced
  without one)"); a self-study-only offer may be 0 with a reason (`zeroFeeReason`, on its audit row);
  a closed one may wait. `copyOffersFrom` brings an offer it would open at 0 that is not self-study
  only across closed, named in its summary (`closedNoFee`) and in the Copy dialog. A's Add subject
  dialog shows the field empty, not 0, for a catalogue row with no fee (an import-added subject has
  none), and asks the reason for self-study only at 0, as the offer's drawer does. Named in
  RESERVATIONS.md §2.12.
- **03-v3-flows**: F7's scenario of review flag 1b restated on the new model (an item with no fee row
  in its series refused on the student's request, the parent's direct reservation and the desk,
  naming the grid; reserved at its price once finance sets the row).
- **09-money-invariants**: F7's money-history rule also covers charges and charge payments; a new
  rule over every line the import made (§9).
- Gone with main's merge: F7's changes to `getRetakeSubjectIds` (sheet history as a sitting at the
  desk, the interim rule there) and to `prepareRegistrationInputs` (the no-price refusal, its
  executor) — both functions are gone on main; their purposes are kept by the import's own lines
  (§4.5) and by priceLine's refusal on every path.
- Kept from before: `addSectionMembersInTx`, the settings store's "Import" group and the Settings
  screen's catalogue and import groups, the audit actions (`IMPORT_*`, entity `import`).
- **Arabic**: the import's dictionary (`apps/web/lib/i18n-import.ts`) has patterns for the rework's
  refusals a line can carry (priceLine's missing grid row, the rules on lines, the deadline
  sentences). The import's translator runs before the rework's on every page, so its patterns must
  catch only the import's own sentences (the review of 8 Oct, item 4): the September patterns ("… is
  not open", "… has no price yet", "… is not at …'s level") are deleted — they read A's "Registration
  window is not open" as "Registration window غير مفتوحة" — "does not teach" is anchored to the
  import's sentence ("the sheet names …, who does not teach … in …") with exact keys for A's two
  sentences, the grade-10 core sentence is left to A's translator, "Add …" is only the import's
  aria-label ("Add Astronomy to the catalogue"), and a code's item select is "The session's item for
  the sheet's code p5" (the review of 2ca07a4, item 4: "The item for …" was too general). A scan of every string in apps/api/src and
  apps/web/app through the import's translator found what it still catches: the rework's line
  refusals the import shows on a line (the same words on the Reserve page) and none of B's.
  MO-9's sentence is in A's dictionary (`i18n-sessions.ts`).

## 7. Roles and endpoints

All under `/v1/imports`, behind `requireAuth` and `requireAcademic` (admin and coordinator), gzipped.
Unchanged by the rework: `GET /`, `POST /`, `GET /:id`, `PUT /:id/settings` (session mode: admin),
`PUT /:id/rows`, `PUT /:id/people`, `POST /:id/subjects` (admin; no fees now), `POST /:id/commit`
(lines in a session: admin), `POST /:id/discard`. `authz-policy.tsv` has a row for each across all
nine principals; 05's "F7 a staged file is staff-only" stands.

## 8. Screens

`/imports` and `/imports/:id` (Management → Import for the admin; School → Import for the
coordinator, beside Sessions and Exceptions). Existing components and CSS variables; every string
through `lib/i18n.tsx` in English and Arabic; rows of data `data-i18n-skip`; the sheet's own words
in a problem's detail are data. No new `useQuery` generic.

Against the Excel version of the task (UX_AUDIT.md §4), as before (upload, problems, rows, people,
mapping, commit and result), with the rework's additions:

- **Mapping → Series and levels.** *Excel:* the desk reads the sheet and types each family's
  reservation into the system at the desk. *Here:* one choice per series and level: history, or
  "Lines awaiting payment in <session>" (the admin's), the open session of the cycle suggested.
  Review flag 9: the suggestion is one translatable sentence for each role ("A session of this
  series is open" / "… — the admin can reserve these lines").
- **The row editor → The line in the session.** *Excel:* the desk works out the subject's paper,
  first entry or retake, the sitting, the teacher and the fee by hand. *Here:* the session, the
  subject and item, the board series, the entry, the sitting with its source (from the student's
  history / declared by the desk, listed to verify), the teacher and the price with its basis
  ("course 12,000 × 50% + board 10,850 × 100%", provisional marked); three choices: the item (the
  session's items), first entry or retake, and the sitting a retake follows. A line naming several
  units or papers shows "The lines in the session", one block per line with its code, and a choice
  of item per code ("The item for p5"; "As the sheet's words find it: P1"), or one item for the
  whole line. *Excel:* the desk copies the row once per paper and works out each fee; *here:* the
  split is made and priced, and only a code the words cannot tell asks for a choice.
- **The result** lists the sheet's lines split into one line per unit or paper ("Units row 5 (2
  lines)").
- **After the commit** the lines are on the session's Money tab (unpaid, provisional counted), the
  declared ones on its To verify tab, and each on the family's Statement ("from Cambridge
  International June 2026 (before the system)" for a legacy sitting; "(declared at the desk) to be
  verified by the school").

Driven headless (Chrome, `playwright-core`) on the dev system (3091/3090, `igcse_import_dev` from
the template) as the admin, in English and in Arabic (right to left), each on its own synthetic
sheet of placeholder families (`.audit/import-evidence/rework/drive/`: `seed.mts` builds the
session, subjects, teacher, items and fee grids — one row missing, one provisional, IAL Mathematics
by unit; `sheet.mts` the sheets; `drive.mjs` the drive): upload, staged review, mapping to the
session, the problems, the line of a legacy retake, of a declared sitting, of a self-study first
entry (then "Taught in school instead"), of a provisional fee, of a missing grid row (then left
out), of a retake naming no sitting (then the sitting named), of a unit, of a line whose item staff
choose, the commit dialog, the result, the session's Money and To verify tabs, and the statement.
Screenshots: `.audit/import-evidence/rework/screens/f7r-{en,ar}-*.png` (40), and for the review's
items 2 and 4 `f7s-*.png` (`drive/f7s-drive.mjs`, `sheet-split.mts`, `f7s-family.mjs`,
`seed-family.mts`): a split line, a code chosen by staff, the result's split rows, and the family's
Reserve page in Arabic — a placeholder family, the session closed by the admin while the page is open,
the refusal in A's own Arabic ("نافذة التسجيل غير مفتوحة"). For the review of 2ca07a4 `f7o-*.png`
(`drive/f7o-drive.mjs`, `seed-onepaper.mts`): the forms' one-paper retake as its "Paper 4 only
(retake)" line, and Add subject at a course fee of 0 as self-study only asking why. In Arabic every page of
the app reports one React hydration error (the language is read from local storage after the first
render); it is the same on pages F7 does not touch (`drive/hydration-check.mjs`) and is not F7's.

## 9. Tests

`apps/api/test/08n-import.test.ts` (67 tests), fixtures in `import-fixtures.ts`.

| Scenario | Test |
|---|---|
| a sheet with the spike's known problems staged with every problem flagged | "a sheet with the spike's known problems…", one test per IS finding |
| a commit creating exactly the reviewed rows | "the review, then a commit…" |
| a re-run changing nothing; the same sheet re-exported; the money record with a line inserted (flag 3) | "a re-run of the same file changes nothing" (four tests) |
| a look-alike inside one file stays a warning at the commit | "look-alikes inside one file…" |
| **§9: a row mapped to an offer and item** | "lines in a session…": each line's offer, item, series, attempt, mode, sitting, teacher and price; "a unit line finds the IAL subject's item…": P1 by its unit |
| **§9: the fee note to attempt and mode** | the same: self-study first entry refused (the lead's sentence); not taught → first entry in self-study at 50% / 100%; a retake of history (legacy) and of a sitting the note names (declared_by_desk), both at the self-study share; a retake naming no sitting refused (its sentence); staff naming the sitting; the coordinator's answer; the student's exception (and used) |
| **§9: a row refused for a missing fee grid, naming the grid** | the gridless subject (and priced once finance sets the row); the import-added subject (add-subjects test); 03 on every path |
| **§9: a provisional grid prices the line provisional, never 0** | the provisional subject: 1600 = 1000 + 600, provisional |
| **§9: consent 'imported' and the sitting's source on the line** | "the admin commits…": both consents `imported`, `prior_sitting_source` legacy / declared_by_desk, the series of the sitting; "a line whose family's confirmation is not on the sheet…" |
| **§9: the statement and the Money tab show imported lines right** | "the statement and the session's Money tab…"; the To verify tab lists the declared ones, not the legacy one; B's known sittings do not read sheet history |
| the rules on lines in the review | P2 (retakes only) refused as the commit refuses it; the dry run answers a GET while another transaction holds the student's exception row (no `FOR UPDATE` in a GET) |
| **the split** (review item 2) | "Biology (Paper 1 & Paper 2)": two lines, each priced, `line_split`, the commit makes both and the result lists the row; "Mathematics (P1 & P5)": item_unclear for p5 only, staff choose it, two lines; a "one paper" note: one line, staff choose the paper |
| **the carried sitting** (review item 1) | an "A2, carry forward" route with the student's ended AS history: in school a first entry carrying the legacy sitting; in self-study a first entry needing the exception; staff's "First entry" keeps the sitting; a carry forward read as a result is the declared sitting, and staff's "Retake" makes it a retake of it |
| **a dropped course** (review item 3) | a self-study line after a course dropped in the system's history, and after one dropped in the same file: a first entry, refused without the exception |
| **the lock order** (review item 5) | one family, two students: the commit waits for the student held second in id order, and for the one held first, holding neither child's fee row meanwhile; both lines made |
| **MO-9's course fee** (review item 6) | the import-added subject: an open offer at 0 refused naming it; closed it is kept; opening it at 0, or setting 0 once open, refused; opened with its fee |
| **a one-paper note** (review of 2ca07a4, item 1) | the forms' "Retake in School 100% fees (One paper ONLY) From June Y": on a subject with a whole item and "Paper 4 only (retake)", a retake of Paper 4 (declared June Y), never the whole subject; with two one-paper items, item_unclear naming them; with none, item_unclear naming the items |
| **the course fee, decided** (review of 2ca07a4, item 2) | open and retakes-only at 0 refused; self-study only at 0 refused without a reason, made with one (the reason on its audit row), edited without it again, made retakes-only at 0 refused; copied into the next session, an open offer at 0 comes across closed and named, the self-study one as it is |
| **students before subjects** (review of 2ca07a4, item 3) | a subject held FOR UPDATE (a board change): the commit waiting on it already holds the family's student; released, the history row is made |
| **the level** (review item 7) | an unmapped A.S. line never finds the IGCSE offer of the same name; it finds the A.S. one once offered |
| **the Arabic** (review item 4) | translateImportText on A's and B's sentences (none caught; A's two have their own keys; the grade-10 core sentence and MO-9's are A's translator's; other screens' "Add …" untouched) and on the import's own |
| the interim rule (MO-25) | committed on 15 November: a first entry; on 1 December: a legacy retake of Cambridge November Y; never for a line of November itself |
| the race: the import and the desk on one unit in one series from two sessions | forced with a pause at IMPORT_REGISTRATION: one live line, the desk refused (gate.sameEntryOnce) |
| two staff committing one file; a commit taken over; the re-read under the lock | as before (flag 5) |
| SCL template; money record; files not read whole; series order | as before |

Also: **authz-policy.tsv** (9 endpoints × 9 principals); **05** "F7 a staged file is staff-only";
**09** "F7: money from before the system is history only" (now with charges and charge payments) and
"F7: every line the import made is a line like any other" (its basis equals its price with its fee
rows, both consents on the imported channel, its committed import line names it, a sitting sourced
`legacy` or `declared_by_desk`, confirmed only by a completed payment); **03** the flag-1b scenario
on the new model; **08f** the import settings.

**Controls** on the new model (`.audit/import-evidence/rework/controls.py`, logs `control-C*.log`,
a trail row each, written by the script the moment the control finishes). Each guard undone once,
run, restored. All of them were run again on the review's fixes, each with its own row (the first
run's 27 rows shared one time; the trail's correction row of 8 Oct 13:02Z says what the session log
gives for each):

| Control | What was undone | Result |
|---|---|---|
| C26, C27 | flag 3: a line's / a person's decisions carried from every earlier file (not only the same bytes) | red |
| C28 | flag 3: `duplicate_account` | red |
| C29 | flag 3: the money fingerprint without the position | red |
| C30 | flag 7: `self_study_contradiction` | red |
| C31 | the review's `fee_missing` | red |
| C32 | priceLine's refusal of a missing fee row (A's; flag 1b on the new model) | red in 03 and 08n |
| C33 | priceLine counting provisional rows (a provisional line priced without its board fee) | red |
| C34 | consent on the imported channel | red |
| C35 | `consent_missing` | red |
| C36 | a history sitting's source `legacy` | red |
| C37 | `retake_sitting_missing` | red |
| C38 | a self-study first entry as an error | red |
| C39 | the student's `gate.selfStudyFirstEntry` exception read | red |
| C40 | the interim rule in the review | red |
| C41 | history before the item's series only | red (green at first: the interim rule covered every case built; a scenario where only the order tells was added) |
| C42 | findOffer by a unit's code | red |
| C43 | the rules on lines asked in the review | red |
| C44 | the commit's student lock (`assertMayRegisterForInTx`) | red on 669cf84 (green at first: the race was unforced, and a section place also held the student; the race is now forced and touches only the lines); **green on 7003e74**: since item 5 `lockStudents` holds every student before the first line, so this lock is no longer the only one — C60 undoes both |
| C60 | item 5 with C44: neither `lockStudents` nor `assertMayRegisterForInTx` holds the student | red (the race and the lock order) |
| C45 | the commit's 403 for lines in a session | red |
| C1, C4, C5, C6, C9, C11, C25 | the earlier guards, run again on the new base | red |
| C46 | item 1: the carried sitting of a first entry on an item needing a prior series | red |
| C47, C48 | item 2: the split (findItemsByCode); the commit making every line of a split row | red |
| C49 | item 2: findOffer taking the offer entering any unit named | red |
| C59 | item 2: a "one paper" note never split (since 2ca07a4's item 1 the note's own early return; the guard it undid at first became dead code and was removed, C59 green on 20be67b showed it) | red |
| C50, C51 | item 3: a dropped course not a sitting, in the file and in the system | red |
| C52, C53 | item 4: the deleted "… is not open" pattern; "Add …" only as the import's own | red |
| C54 | item 5: every student locked before the first line (since 2ca07a4's item 3, both `lockStudents` calls undone) | red (in the order where the student held is second) |
| C55 | item 5: the dry run without exception locks | red (the GET waits) |
| C56, C57 | item 6: course fee 0 refused on an open offer, at creation and on update | red |
| C58 | item 7: the name fallback at the line's level | red |
| C61 | 2ca07a4 item 1: a one-paper note never the whole subject | red |
| C62, C63 | 2ca07a4 item 2: self-study only at 0 says why; self-study only may be 0 | red |
| C64 | 2ca07a4 item 2: a copy closes an offer it would open at 0 | red |
| C65 | 2ca07a4 item 3: the students held before any row naming a subject | red |
| C66 | 2ca07a4 item 4: "The item for …" only as the import's own | red |

The earlier controls whose code main removed (C3, C13, C14, C19–C22: `getRetakeSubjectIds`,
`prepareRegistrationInputs`, inactive import subjects) are superseded by C32, C36–C41.

## 10. Proof on the school's real sheet (privately)

`apps/api/scripts/import-real-sheet/counts.ts` runs the real sheet through the API exactly as staff
would — stage; the admin adds the missing catalogue rows (active, no fees); the live tab mapped to
its session with nothing offered, then back to history; the coordinator commits; stage again and
commit — on a throwaway database (`igcse_import_real_test`), dropped at the end with the uploaded
copy (in a directory the script makes itself). The report is written outside the repository with
counts and row numbers only (other tabs as a count, staff as a count, ids hidden, emails masked).

**Data-rule incident (30 Sep).** The first run wrote the eight real teacher names and the run
admin's id into its report and the implementer printed it before redacting it; the names remain in
that session's transcript; `counts.ts` redacts before writing since. The trail's `incident` row
records it.

**On the new model (8 Oct, after the look-alike fix):**
- Staged: 654 lines, 649 importing, 5 left out (duplicates); 244 families: 222 ready, 22 held by 74
  error lines (two children under one email 53, a student's email is a parent's 12, parent email
  missing 8, student email missing 3) — as before.
- The commit (the coordinator, history only): 222 families, 0 failed; 245 students, 246 parents,
  269 links, 114 section places, 200 enrolments, 567 history rows, 40 money-history rows, 8
  teachers, 9 sections, 0 lines, 0 payments — as before.
- The re-run: the review carried over (222 ready, 22 held, 74 error lines) and no table changed.
- **Found on the run**: before the fix one family failed in the commit although the review had
  called it ready (§11, the look-alike decision); reproduced in 08n, fixed, run again.
- **The live tab mapped to the winter 2026 session** with nothing offered yet: 5 series groups
  (November 2026 at three levels, January 2027 at two), 219 lines that would be lines in the
  session, each `not_offered` until the school offers its subject there — 16 distinct subjects as
  the sheet writes them with their level — besides the identity errors already held.
- **The split (the review of 8 Oct, item 2).** Of the 219 lines, 26 name two or more units or
  papers (all two; November 2026 17, January 2027 9) and make 52 lines once the session offers
  those papers as items; the reviewer's 27 is the same count with live-tab row 124, which the
  review leaves out as a duplicate line (IS-13). None carries a "one paper" note.
- **Self-study, reconciled with the spike (review flag 7).** 44 self-study lines importing = the
  "2024" tab's 13 (its yes/no column holds 14 Yes; one of those lines is left out as a duplicate,
  IS-13) + Sheet1's 31 = the 23 "Self Study" fee notes the spike read + 7 Yes answers of Sheet1's
  own unlabelled yes/no column with no note (rows 29, 166, 208, 213, 214, 402, 427) + row 172,
  whose note gives the external rate. The spike's 37 was 14 + 23. Three lines carry a self-study
  note against an explicit No (Sheet1 rows 97, 172, 433): flagged `self_study_contradiction`.

## 11. Decisions and why

- **The review is computed, not stored**; **one transaction per family**; **email is the key, and
  the review refuses what email cannot tell apart**; **idempotency lives in the database**;
  **teachers matched by exact name only** — as before.
- **A series maps to its cycle's session; each line finds its offer and item** (RESERVATIONS_REWORK
  §9, §10). The sheet's words are the school's; the session is the links sheet; findOffer and
  findItem join them, and staff choose where the words cannot tell. A line is made by
  `insertLines`, the reservation paths' own function, so every rule, lock and price of a reservation
  applies to it.
- **Subjects the import adds are active, with no fees** (the lead's answer to flag 1 on the new
  model, 8 Oct). A subject carries no price since the rework: a line is priced from its offer's
  course fee and its series' grid, priceLine refuses a missing row on every path naming the grid,
  and a new session lists every active subject closed — so an active subject with no price cannot
  be reserved for free (**MO-9**: a line is never priced 0 for want of a fee). 08n keeps a row of
  such a subject refused, naming the grid, until its offer has a fee row.
- **A retake only from a legacy history series or a sitting named on the sheet** (the lead's answer
  Q2, 8 Oct; MONEY_AUDIT.md MO-25). History counts only when its series had ended when it was
  committed and is before the item's series; its source is `legacy` with that series on the
  item's board. A sitting named on the sheet or the line is the desk's declaration, verified on To
  verify. A retake or self-study note with neither is an error on the line; never `legacy` without a
  series (that would let sheet text alone unlock the 50% self-study course price, unverified).
  B's known sittings are not extended to `registration_history`.
- **A dropped course is not a sitting** (the lead's call on the review of 8 Oct, item 3; MO-25):
  history counts as a sitting only when the student sat it — outcome `registered`, not `dropped` nor
  `drop_intended` — so a self-study line after a dropped course is a first entry needing the
  exception.
- **On an item that needs a prior series, the sitting is carried, not retaken** (item 1): a legacy,
  noted or carried-forward sitting is the sitting a first entry carries forward, unless the note or
  staff say retake; otherwise sheet history would make a carry-forward a retake, with the retake
  deadline and the self-study share and no exception.
- **One line of the sheet naming several units or papers is one line per item** (item 2): each is a
  board entry; the review shows each priced, staff choose only the code the words cannot tell, and
  the result names the rows split (26 lines of the real sheet, 52 lines). A "one paper" note stays
  one line.
- **The commit locks every student before the first line, in id order** (item 5), as RESERVATIONS.md
  §2.1 orders it; the review's rolled-back check takes no row lock in a GET.
- **A course fee of 0 is refused on an offer that is not closed** (item 6, MO-9), in A's service, so
  an import-added subject (no fee) cannot be opened and priced at the board fee alone.
- **A name matches at the line's level, or not at all** (item 7).
- **A one-paper note is one paper** (the review of 2ca07a4, item 1): the whole subject never stands in
  for it; the one one-paper item, else staff choose.
- **Self-study only may be priced at the board fee alone** (the lead's call, 2ca07a4 item 2): a course
  fee of 0 with a reason on a self-study-only offer; never on an open or retakes-only one; a copy does
  not open one at 0.
- **The family's students before any subject** (2ca07a4 item 3): locked right after the sections.
- **Self-study on a first entry is an error on the line, never priced at the share silently** (the
  lead's addition): `gate.selfStudyFirstEntry` refuses it without the student's exception; the
  import shows it before the commit, with the way out.
- **The sheet's confirmation is the family's consent** (RESERVATIONS_REWORK.md §3.5: "an imported
  line records the sheet's confirmation column on the imported channel"); a line without it is an
  error, not a line made without consent. The consent freezes the session's refund steps on the
  line, so a session the import reserved in has its refund policy fixed, as after any family's
  consent.
- **The rules on lines are asked in the review in a rolled-back transaction**, line by line against
  the file's earlier lines, so the review judges as the commit will; grade 10's core rule is asked
  over the student's lines together (asked per line it would blame every line).
- **An account the same file's commit made is the file's own person** (found on the real sheet):
  `duplicate_account` compares with accounts already in the system, not with the families this
  commit has just made — their look-alikes are the review's warnings, which do not hold a family.

## 12. Deferred, and why

- **The SCL student id is not stored on the user** (audit row only; Q-05, Q-09).
- **No invitation emails** at the commit (the school decides when go-live is announced).
- **Lines paid before go-live cannot be marked paid by the import** (F-01): they are history, or
  lines awaiting payment.
- **The import does not create offers, items or fee rows**: the school's links sheet and fee lists
  are the session's (the admin's Subjects and Fees tabs). The real run shows 16 subjects the
  winter session must offer before the live tab can become lines.
- **F4 and F5 do not read `registration_history` yet** (§14).
- **The money record's own format** waits for the real record (F-01).

## 13. Questions for the owner (through the coordinator)

1. **Shared and missing emails** (IS-06, Q-05): should the desk collect a proper email per child
   before go-live?
2. **Lines paid before go-live** (F-01): how they become confirmed.
3. **Carry forward** (IS-02, Q-02): a result or a payment. Today: kept as a note.
4. **Self-study on a taught subject** (IS-03, A-02): the forms say "ONLY 2nd entry"; should the 35
   real first-entry lines be in school, enrolment only, or allowed by exception?
5. **Boards and level codes** (IS-01, IS-14).
6. **Graduates:** import the 149 students who have finished grade 12, or leave them out.
7. **The SCL id:** store it on the student?
8. **Invitations:** email every imported family at go-live, or "Forgot password" at the desk?
9. **A retake from sheet history** (MONEY_AUDIT.md MO-25): may a subject the sheet says was sat
   before the system make a line a retake — which unlocks self-study at its share — with no payment
   for that sitting in the system? Until the owner answers, the lead's interim rule holds: only
   history of a series that had ended when the file was committed, before the line's series, and
   the line says so (`legacy`); a sitting the sheet only names is the desk's declaration and is
   verified.

## 14. Contracts for later features

- `registration_history` (student, subject, series, outcome, mode, teacher, source): what a student
  sat before the system. The import's own lines read it (§4.5); F4's sittings and F5's advisor
  should read it too.
- `money_history`: money before the system, for finance's history views; never balances.
- The settings `import.selfStudyOnTaught` and `import.carryForward`.
- **`findOffer(executor, sessionId, term, { subjectId?, levels? })`, `findItem(executor, offerId,
  label, { month?, year? })` and `findItemsByCode(executor, offerId, label, { month?, year?, chosen?
  })`** (offer.services.ts; RESERVATIONS_REWORK.md §10's F7 row): the offer and item, or the item of
  each unit or paper, a school's words name in a session, for any later path that reads the school's
  own sheets.
- Lines made by the import: ordinary lines with consent channel `imported`, `prior_sitting_source`
  `legacy` (with its series) or `declared_by_desk`, `[IMPORT]` in their comments, and an
  `IMPORT_REGISTRATION` row naming each.

## 15. Progress log

- 2026-09-30 02:47Z — started on `feature/import` from origin/main e5da650; baseline green.
- 03:14Z–04:20Z — schema (0041), validations, reader, staging, review, commit, routes; 08n; the
  screens in English and Arabic; 460 lines measured; the review gzipped.
- 04:25–04:27Z — controls C1–C12. 04:29Z — the real sheet, privately (§10's incident).
- 04:45–04:51Z — the retake fix (history before the window's series), C13–C14; the real sheet again.
- 05:10–05:20Z — gates green on b6d57d0; CI 36672632642 green on 0036d64.
- 05:56Z — the Opus 5.5 review: don't merge yet, ten flags.
- 06:11–06:53Z — flags 10, 1, 2, 5, 6 fixed with controls C15–C25 (trail); flag 3 fixed, its suite
  green on the old base at 07:18Z, uncommitted when the spend limit stopped the session.
- 2026-10-07 — frozen at e58324b for the reservations rework.
- 2026-10-08 08:20Z — resumed (Opus 5.5). Flag 3 committed as found (9dc764b). origin/main 2a26557
  merged by hand, 14 conflicts, the rework's side winning; 0041_import regenerated as 0050_import
  (2226d03, flag 8).
- 08:37Z — the lead's answers: subjects added active with no fees; retake only from legacy history
  or a named sitting; a self-study first entry an error on the line; findOffer and findItem in A's
  service.
- 09:11Z — F7 on lines (39b524b): findOffer, findItem, the review's line, the commit through
  insertLines and the imported consent, flags 7 and 9, 03 and 08n restated; CI 37755012370 green.
- 09:25Z — new scenarios (flag 7, units and items, the rules in the review, the consent, the race)
  and 09's rule over imported lines (adda155); the migration order proven on a copy.
- 09:41Z — controls on the new model; C41 and C44 made to tell (the same-series scenario; the race
  forced at IMPORT_REGISTRATION, touching only the lines).
- 09:52Z — the real sheet on the new model: one family failed although ready — the look-alike case
  reproduced, fixed, run again: 222 committed, re-run unchanged; flag 7's 44 reconciled with 37.
- 10:01Z–10:28Z — the screens driven in English and Arabic on synthetic sheets, 40 screenshots;
  the line section's wording made one sentence per entry and basis for Arabic.
- 10:35Z — every control run again on the final code: 27 red (C26–C45, and C1, C4, C5, C6,
  C9, C11, C25 re-run); this document, the plan's F7 contract row, MO-25's text and RESERVATIONS.md
  §2.12's line for findOffer and findItem.
- 10:38–10:45Z — gates green on 669cf84: API and web types; the suite in local time and with TZ=UTC,
  29 files, 555 passed, 1 todo each; CI 37764801732 green on 669cf84.
- 12:19Z — the Opus 5.5 review of 6f18364: merge after fixes 1 and 2; eleven items with the lead's
  calls.
- 13:02Z — the trail's correction row for the 27 batch-stamped control rows.
- 13:09Z — items 1-7 and 9 fixed with their 08n cases (64 tests); 13:08Z the new controls tried (13
  red); 13:11Z the split counted on the real sheet privately (26 lines, 52 lines made).
- 13:17–13:20Z — gates green on 7003e74: the suite in local time and with TZ=UTC, 29 files, 564
  passed, 1 todo each; API and web types.
- 13:20–13:32Z — every control run again on 7003e74, each writing its own trail row as it finished:
  41 red and C44 green (its lock now doubled by `lockStudents`); C60, both locks undone, red.
- 13:34–13:38Z — the split driven in English and Arabic, and the family's Reserve page in Arabic with
  a session closed while open (`f7s-*.png`); the servers left running on 3091/3090 for the lead.
- 13:47Z — pushed ed02c2b; CI 37786206839 green (564 passed, 1 todo).
- 14:09Z — the review of 2ca07a4 (merge after: 1): /tmp/f7/real deleted (item 5).
- 14:21Z — items 1-4 fixed with their 08n cases (67 tests); 20be67b.
- 14:24–14:40Z — types green on 20be67b; the suite with TZ=UTC green (567 passed); in local time red
  once (the import-and-desk race: the desk's line first, not explained, recorded in the trail), green
  when run again, and 08n five times green after it; the one-paper line and Add subject at 0 driven in
  English and Arabic (`f7o-*.png`).
- 17:03–17:17Z — every control on 20be67b with its own row: 46 red, C44 green as before, C59 green — the
  one-paper note's early return made the guard C59 undid dead; removed, C59 pointed at the early return.
- Next: the reviewer confirms items 1 and 2 on the diff; the final merge waits for F4 on main (main
  has D at c2d7a78, its migrations to 0054): origin/main merged as its own commit, 0050_import
  regenerated after main's last migration with a later stamp and its snapshot chained, the order
  proven on a copy migrated at main then at the branch, the proof log kept in the evidence (item 11).
