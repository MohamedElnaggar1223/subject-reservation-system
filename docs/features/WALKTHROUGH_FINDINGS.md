# The fix round of F8's findings (F8-01 to F8-14)

**Spec:** the lead's brief of 17 Oct 2026 — the twelve items that remove the workarounds F8's walkthrough had to take
(`docs/features/WALKTHROUGH.md` §5, `docs/walkthrough/index.html`), and the decisions' reviewer's two low notes; then the
lead's review of 744e553 (17 Oct, "merge after fixes 1, 2, 3, 4, 6"; 5, 7 and 9 in scope too) and the answers to §10's
three questions — **round 2, §13**.
**Branch:** `feature/walkthrough-findings` (worktree `.claude/worktrees/walkthrough-findings`), from main 8ae295e; main
2a149dd (F8's walkthrough) merged as d73109d, main e90850d as 6c90d1f.
**Databases:** `igcse_findings_dev` (a copy of `igcse_template_dev`, migrated to 64), `igcse_findings_test` (the suite),
`igcse_findings_mig` and `igcse_findings_mig2` (the migration proofs on template copies), `igcse_findings_walk` (a cycle
built by main's code, then migrated and driven on the branch; 65 migrations since round 2), `igcse_findings_before`
(main's before-state for the screenshots), `igcse_findings_cycle65` (a copy of it, migrated 62 → 65 for round 2's proof),
`igcse_findings_seed` (the seed's proof). **Ports:** API 3211, web 3210 (the branch); 3213 and 3212 for main's code in
`/tmp/wf/main-src` while the before-state was shot. **Built by:** one Opus 5.5 implementer. **Trail:**
`.audit/walkthrough-findings.tsv`. **Evidence:** `.audit/walkthrough-findings-evidence/`: `before/` and `after/` (a JPEG per
screen in English and Arabic, with `readings*.json`: what each screen said), `controls/` (each guard undone, its test
red), `migration/` (0062–0064 on template copies and on cycles built by main's code; the seed), `changed-assertions.tsv`,
`gates/` (the suite's summaries), `drive/` (the drive scripts), `round2/` (round 2's drive: shots, readings, scripts,
item 7's email log and receipt text, item 6's dictionary check).

**In one sentence.** Each finding is fixed where it starts: a one-paper retake's board fee is the board's rule (a
column, two migrations), a payment under way is a fact of the statement and the desk's read, the API says amounts and
methods in words and "balance", the printed papers carry the school's name, the Catalogue adds subjects, the subject's
form adds a second qualification, a draft session can be deleted, and the seed promotes the first admin alone.

---

## 1. The findings, as fixed

### Item 1 — F8-05: a one-paper retake's board fee follows its board (money)

- **The rule.** `exam_board.one_paper_fee_key` (`packages/db/src/schema.ts`; text, default `'qualification'`, checked
  `IN ('qualification', 'unit')`). `'qualification'`: the syllabus's fee — Cambridge charges the syllabus for a
  carry-forward re-entry (Q-13). `'unit'`: the paper's own row, where the board's list prices per paper or unit — Pearson
  Edexcel ("4MA1 1H 4,600", SCHOOL_FORMS.md §3.2). OxfordAQA stays on `'qualification'`, the syllabus's fee, until its
  fee list is in hand (F8-07); the board card is where the admin changes it then (the lead's answer 1, §10).
- **Whose row on a syllabus-keyed board** (the lead's answer 2, round 2): a one-paper item reads the same fee row as the
  subject's whole item — the option's row when the whole item enters an option (0970 CX), the qualification's otherwise —
  so the fee list names a syllabus once. Migration `0064_one_paper_whole_item_row` re-keys the items already made (§13).
- **Read by** `onePaperFeeKeys()` in `apps/api/src/services/offer.services.ts`: `withOnePaper` (the items the catalogue
  gives a subject, so the sheet's Add subject and the form's "Paper N only") and `insertItem`'s default fee keys for a
  one-paper item made through the item endpoint with none given (before, that default was the unit for every board,
  so a Cambridge Paper 4 made there read a row nobody pastes). An award-less row falls back to its units. An item
  made keeps its keys: the property is read when an item is made.
- **Editable** on the Catalogue's board card (`catalogue.client.tsx`): "A one-paper retake: the paper's own board fee /
  the syllabus's board fee", and in its Edit "A one-paper retake's board fee" (a select), with "A one-paper retake added
  to a session from now on reads it; one already on a sheet keeps its fee." `UpdateBoard` gains `onePaperFeeKey`; the
  `BOARD_UPDATED` audit row now records its old value. Arabic: «إعادة ورقة واحدة: رسوم المجلس للورقة نفسها / للمنهج كله».
- **The admin's alone, with a reason** (round 2, the review's item 1). The rule decides what every new one-paper retake
  of the board costs, so it follows **MO-10's precedent** — a series' entry deadline is the admin's alone, asked with a
  reason and audited with it (`series.services.ts` `assertDeadlineChangeAllowed`, `series.client.tsx` `DatesForm`):
  `updateBoard` refuses `onePaperFeeKey` from any other role (403, "Only an admin changes a board's one-paper fee rule:
  it decides what every new one-paper retake costs") and without a reason (400); `UpdateBoard.reason` (5–500) goes into
  the `BOARD_UPDATED` row's new data. The route's authz row is unchanged: the coordinator still edits the board's other
  fields. The card shows the select to the admin only, sends the rule only when it changes, and asks a Reason then; the
  coordinator reads the rule with "Only an admin changes it: it decides what every new one-paper retake costs."
- **The paste.** `parseFees` (`board-fee.services.ts`) reads a unit's whole code ("4MA1/1H", or "4MA1 1H") before its
  parts. Read token by token, a paper's own row pasted as "4MA1/1H 4,600" was matched to the award 4MA1 and would have
  set the whole syllabus's fee to 4,600 — met while driving this item (§6), fixed here, asserted in 08u, control c1b.
- **Migrations** `0062_board_one_paper_fee` (the column and its check) and `0063_board_one_paper_fee_backfill` (custom):
  Pearson Edexcel set to `'unit'` with its `BOARD_UPDATED` row; every one-paper item of a `'unit'` board that enters one
  unit and reads one qualification key re-keyed on its unit, one `OFFER_ITEM_UPDATED` row each (reason naming 0063).
  Lines are untouched: a reserved line keeps the price snapshot it was given. Idempotent (a board still on
  `'qualification'`, an item still on the qualification key). §4 has the proofs.
- **Scenario** (08u, "F8-05: …"): Edexcel 4MA1's Paper 1H keyed on its unit, Cambridge 0970's Paper 4 on the
  qualification (its whole subject on the option CX); the preview prices 1H at EGP 7,600 (3,000 + 4,600) and Paper 4 at
  EGP 13,850 (3,000 + 10,850); a student's reservation of each records that price and the row it was priced from; the
  Fees tab's 1H row names the paper and its one line; the item endpoint's default follows the board; the paste reaches
  the paper; the board's rule changed and audited (OxfordAQA, set and set back). **Control c1:** the rule undone, red.
- **Screens:** `after/f02-f03-f05-catalogue-{en,ar}` (the board cards), `before|after/f05-fees-pearson-en` (before: 1H
  and 2H read 4MA1's EGP 9,200; after: rows 4MA1/1H and 4MA1/2H with "No fee" until the list's 4,600 is typed or pasted).

### Item 2 — F8-08: the family's Home after an InstaPay reference

- **API.** The statement's line gains `paymentInProgress: { paymentId, status, method } | null`
  (`statement.services.ts`): a checkout started (`pending`) or a transfer with finance (`pending_verification`).
- **Home** (`family-next.client.tsx`), per session: what can still be paid, with "Pay now" opening the checkout of those
  lines alone; what finance is checking, apart: "June 2027: EGP 45,700 being checked by the school" and "Biology ·
  Physics: your InstaPay transfer is with the finance office; nothing to do until it is confirmed." (no button); a
  checkout the family started and did not finish: "EGP … in a payment you started and have not finished" (or "… to pay
  at the finance desk, as you chose") with "Finish the payment". When nothing can be paid, only the "being checked" row
  is there. Arabic: «قيد التحقق لدى المدرسة», «تحويلك عبر إنستاباي لدى مكتب المالية؛ لا شيء عليك حتى يُؤكَّد.», «أكمل الدفع».
- **Drive** (family A: Biology and Physics, Cambridge, by InstaPay with the reference; Mathematics, Pearson, unpaid):
  before, "EGP 66,900 to pay — Pay now" opened "Payment already started"; after, "EGP 21,200 to pay — Pay now" opens the
  checkout of Mathematics alone. `before|after/f08-home-parent-{en,ar}`, `before|after/f08-checkout-from-pay-now-en`.

### Item 3 — F8-09: the desk during a pending transfer

- **API** (`desk.services.ts` `getStudentSummary`): per line `paymentInProgress`; `payableNow` false for such a line;
  `owing` is what can be collected now; `owingInProgress` is owed by lines whose payment is under way.
- **Desk** (`desk-collect.client.tsx`, `desk.client.tsx`): such lines are listed under "To collect now" without a
  checkbox — "Biology · awaiting the transfer's check · June 2027 · confirm or reject it on the Finance Workbench" (a
  link) — and "Owes now EGP 21,200" says "+EGP 45,700 awaiting the transfer's check" (or "with a payment under way" for
  a checkout the family started). Collect never sends them. Arabic: «بانتظار التحقق من التحويل», «أكّدها أو ارفضها في».
- **Scenario** (08o, "F8-08, F8-09: …"): the statement's and the desk's flags; owing 14,600 and owingInProgress 23,200;
  the other board's line collected; the transfer's line still refused with its sentence and its payment untouched; all
  cleared once finance confirms. **Control c3:** the lookup undone, red.
- **Drive:** before, all three ticked, "Collect EGP 66,900", refused 409; after, Mathematics ticked, the two apart,
  "Collect EGP 21,200" collected with its receipt. `before|after/f09-desk-to-collect-{en,ar}`, `…/f09-desk-collect-result-en`.

### Item 4 — F8-10: amounts, methods and "balance" at the source

- **Shared** (`packages/validations/src/payment/money-words.ts`): `formatEgp` ("EGP 16,850"; piastres only when there
  are some), `PAYMENT_METHOD_WORDS`, `IN_SCHOOL_INSTRUMENT_WORDS` and `paidByWords(method, instrument)` ("by InstaPay",
  "in cash at the school", "by card at the school", "at the school" …; a code is never printed).
- **The API's sentences** — notifications, emails, refusals, the family-facing reasons a balance notice carries: 59
  template amounts swept (`EGP ${x.toFixed(2)}`, `${x.toFixed(2)} EGP` → `formatEgp`), then by hand the method words
  (`notifyPaymentConfirmed` takes the instrument), "escrow" → "balance" in every sentence a family or the desk reads
  (titles "Added to X's balance" / "Taken from X's balance", "Balance withdrawal …", "… paid from the balance has been
  returned to it", "Not enough in the balance: EGP … asked for", the emails' "View the balance"), and the notification
  type label "Balance Updated". Files: `notification.services.ts`, `integrations/email.ts`, `payment.services.ts`,
  `escrow.services.ts`, `desk.services.ts`, `desk-drop.services.ts`, `swap.services.ts`, `charge.services.ts`,
  `plan.services.ts`, `verification.services.ts`, `school-fee.services.ts`, `board-fee.services.ts`,
  `line-moves.services.ts`, `refund.services.ts`, `exam-entry.services.ts`, `receipt.services.ts`,
  `session.services.ts`, `routes/escrow.routes.ts`. "escrow" stays the code's and the audit's word (decision 14), and the
  ledger's stored reasons are unchanged.
- **The web:** the statement's "Subjects (cash)" → "Subjects in cash at the school"; Pending Requests "22850.00 EGP" →
  "EGP 22,850", "+22850.00 EGP to the balance" → "+EGP 22,850 to the balance"; the Finance Workbench's dialogs and
  messages (`finance.client.tsx`), Balance withdrawals (`escrow-admin.client.tsx`), the exception form's line option.
- **Arabic** (`apps/web/lib/i18n-findings.ts`, merged last): the receipt states («مع ولي الأمر», «أُعيد إلى المدرسة», …),
  the method words («نقدًا في المدرسة», «عبر إنستاباي», …), and the rewritten notices («تم تأكيد دفعة ⁨45,700 جنيه⁩ نقدًا في
  المدرسة لتسجيل …», «أُضيف ⁨22,850 جنيه⁩ إلى رصيد …»), the notification centre's words and times.
- **Changed assertions:** §2 (19, pre-authorised). **Scenario:** 08o's F8 scenario asserts both payment notices ("Payment of
  EGP 14,600 in cash at the school …", "… EGP 23,200 by InstaPay …"). **Control c4:** the code put back, red.
- **Screens:** `before|after/f10-statement-{en,ar}`, `…/f10-notifications-{en,ar}`, `…/f10-pending-requests-{en,ar}`,
  `…/f10-workbench-confirm-dialog-en`, `after/f10-notifications-parent-a-en`.

### Item 5 — F8-11: the school's name on the slip and the receipt

- `apps/web/lib/school-name-server.ts` (`readSchoolName()`: the public read `GET /v1/settings/public` through the
  signed-in server client; a failure is logged and leaves the app's name) and `components/print-heading.tsx`
  (`PrintHeading`: the school's name, not translated, with "IGCSE Subject Reservation System" under it; the app's name
  alone when the setting is empty). Used by `reservation-slip/[studentId]/page.tsx` (passed to the slip) and
  `receipt-print/[id]/page.tsx`. **Drive:** `before|after/f11-slip-en`, `…/f11-receipt-en` ("Demo International School").

### Item 6 — F8-02: adding a subject

- **The Catalogue** (`exams/catalogue/registrable.client.tsx`), for the admin (the Subjects page's endpoint is the
  admin's; the coordinator maps): "Add a subject" — name as the forms write it, code, board, level, course fee ("the
  default the session's sheet offers when the subject is added") — through `POST /v1/subjects`; then "Subject added: …
  Map what it enters with its board, then add it to a session" with "Map it"; and "Import several from a list", which
  opens the Subjects page with its import open (`/admin/subjects?import=1`).
- **The Subjects page** (`admin/subjects/subjects-admin.client.tsx`): no Registration Fee field, no Core checkbox, no
  Core column; the table shows the course fee; the CSV is `name, code, board, level, course fee` (an older list's 6th and
  7th columns are not read, said once in the report); Export writes the same five. `CreateSubject` defaults
  `registrationFee` to 0 (`CreateSubjectInputType` for the screens). Subjects stays off the sidebar (decision 8).
- **Scenario** (08h): a subject added with the five fields alone (registrationFee 0, isCore false, audited), listed to
  map, offered on the sheet's Add subject with its course fee; the coordinator refused. **Drive:**
  `after/f02-catalogue-add-subject-dialog-{en,ar}`, `…/f02-catalogue-subject-added-{en,ar}`,
  `after/f02-sheet-add-subject-lists-it-en` (the sheet's Add subject lists "Sociology A.S./A.L. 9699"),
  `after/f02-import-entry-subjects-page-en`, `before|after/f02-subjects-new-subject-form-en`.

### Item 7 — F8-03: deactivating a subject whatever its core flag

- `DELETE /v1/subjects/:id` no longer refuses a core subject: `deactivateSubject` clears `is_core` with `is_active`, in one
  transaction with its `SUBJECT_DEACTIVATED` row ("its core designation cleared with it"). The Catalogue's
  `unmappedCount` and its "Only subjects not mapped yet" filter count active subjects only.
- **Scenario** (08h): flag cleared and audited; unmappedCount back to what it was; reactivated, counted again, flag
  still cleared. **Control c7:** the refusal put back, red. **Drive:** `before/f03-core-deactivate-refused-en` (409),
  `after/f03-core-deactivated-en`; the catalogue's
  "16 subjects are not mapped yet" (before) and "1" (after) in `before|after/f02-f03-f05-catalogue-en`.

### Item 8 — F8-04: Arabic A.L.'s second qualification

- **API:** `listOffers` gives each offer `qualificationsToAdd`: the board's other active awards of the subject's area and
  level **in another suite**, not yet entered by an item of the subject (the GCE 9AA0 beside the IAL YAA01) — and since
  round 2 only when the subject's own entry is a single whole item (§13, item 5).
- **The form** (`subjects-tab.client.tsx` `AddQualification`): "Another qualification — The board has another award of
  this subject at this level. Offered beside this one, the family chooses one of the two with its teacher." and "Add a
  qualification: Edexcel 9AA0 (Arabic (GCE A Level))": its teacher (required), its course fee (empty: the subject's).
  It puts the subject's own item into one exclusive group (`PUT …/items/:id`, when it has none), then makes the item
  through the item endpoint — kind `qualification`, entering the award, labelled as the form names it ("Edexcel 9AA0"),
  with its teacher, after the subject's rows — and the form comes back with both under Qualifications, what was typed
  kept. Decision 4 stands for everything else.
- **Scenario** (08u, "F8-04: …"): offered (and an older award of the same suite not offered); made; audited; the
  preview's own teacher and code; both together refused. **Control c8:** the list made empty, red.
- **Drive:** before, the GCE item (the demo's, made through the endpoint) removed and the form shown: nothing adds one
  (`before/f04-arabic-al-form-{en,ar}`); after, Add a qualification with Teacher 26 (`after/f04-arabic-al-add-panel-en`,
  `…-added-en`, `…-form-ar`) and the family's form: "Teacher 25 (Edexcel YAA01)", "Teacher 26 (Edexcel 9AA0)"
  (`after/f04-arabic-al-preview-en`).

### Item 9 — F8-01: the seed, and deleting a draft session

- **The seed** (`packages/db/seed.ts`): `pnpm --filter @repo/db seed` promotes the account with `ADMIN_EMAIL` (default
  `admin@igcse.local`) and makes nothing else; `seed --with-samples` adds the samples as before. The suite never calls the
  seed (`helpers.ts` promotes its admins itself). Proven in `migration/seed-proof.txt`.
- **Deleting a draft:** `DELETE /v1/sessions/:id` with `{ reason }` (admin; at least 5 characters) → `deleteDraftSession`
  (`session.services.ts`): the session row locked; refused for an open or closed session, one with a line (any
  status), exceptions of any status or sent reminders (kept as history, round 2); its sheet (subjects, items, teachers,
  fee keys), series links and never-sent reminder rules go with it; the subjects, the boards' series and their fee lists
  stay; one `SESSION_DELETED` row ("Draft Session Deleted") in the transaction. `authz-policy.tsv`: admin A, everyone
  else D. The Session screen's "Delete this draft" (a reason dialog), back to the Sessions list (§13, item 2).
- **Scenario** (08n, two): deleted with its sheet, audited, its subject and series kept; refused for an open session, a
  draft with a reservation, a short reason and the coordinator. **Control c9:** the draft-only check undone, red.
- **Drive:** `after/f01-admin-home-with-draft-en` → `…/f01-delete-draft-dialog-en` → `…/f01-sessions-after-delete-en` →
  `…/f01-admin-home-after-delete-en` (the draft gone from Home); `before|after/f01-draft-session-en`.

### Item 10 — F8-12: staff words, dialogs, Profile

- Settings' refund card: "(SCHOOL_FORMS.md §2.1)" removed (`settings.ts`, its Arabic in `i18n-sessions.ts`), and two
  import settings' "(IMPORT_SPIKE.md …, DISCOVERY.md …)" with it (the same class).
- The exception form (`grant-form.client.tsx`): a date value is written as the app writes one ("by 20 Dec 2026";
  Arabic «بحلول 20 ديسمبر 2026»); "1 due date moved." / "1 pushed school fee cancelled." in the singular.
- My Registrations' dialogs (`registrations.client.tsx` `Modal`): `role="dialog"`, `aria-modal`, named by their title;
  the close button labelled. Read in the drive: `[{ name: 'Request Drop', modal: 'true' }]` (before: none).
- The Profile's Linked Children / Linked Parents card for a parent or a student only.
- **Screens:** `before|after/f12-settings-refund-{en,ar}`, `…/f12-exception-sentence-{en,ar}`, `…/f12-exception-granted-en`,
  `…/f12-request-drop-dialog-en`, `…/f12-profile-admin-en`.

### Item 11 — F8-13: README.md and .env.example

- README.md: step 3 no longer seeds; "First admin" runs the seed once after signing up (ADMIN_EMAIL), "Sample data" says
  what `--with-samples` adds and that a stale draft can be deleted; uploads go to `LOCAL_UPLOAD_DIR` without R2 in
  development and are refused in production; "a wallet" → "a balance with the school".
- `.env.example`: `AUTO_GRADE_PROGRESSION` gone; `LOCAL_UPLOAD_DIR=.uploads` added with the rule as `env.ts` and
  `file.services.ts` have it.

### Item 12 — the decisions' reviewer's two low notes

- One starter-set note per set (`STARTER_SET_NOTES`, `catalogue.services.ts`): Mathematics names the IAL Mathematics
  aggregation rules; Biology names Pearson's unit aggregation and cash-in rules (DISCOVERY_RESEARCH.md's sources P1, P4,
  P5, P6).
- The offers read (`offers-read.services.ts`) reads the student's active `gate.selfStudyFirstEntry` exceptions once
  (`lineExceptions.held`, `activeExceptionsHeld`) and matches each item in memory (`coversScope`, the registry's own
  rule); 08p's scenario of the exception on the Reserve page stays green.

---

## 2. Changed assertions, old and new

**Approved by the lead for item 1** (the message of 16 Oct, 23:12:43Z; they asserted the old rule itself, no money outcome):

| File | Old | New |
|---|---|---|
| `08n-session-offers.test.ts`, "an IGCSE award with required papers gets its one-paper retake items …" | 1H's fee key `[{ key_kind: 'qualification', key_id: q }]`; title "… read for the qualification (§3.2, Q-13)" | `[{ key_kind: 'unit', key_id: h1 }]`; title "… read for the paper's own fee on a board that prices per paper (Pearson Edexcel), the qualification's on Cambridge (§3.2, Q-13, F8-05)" |
| `08u-session-form.test.ts`, "a paper the Catalogue gains …" | `[{ key_kind: 'qualification', key_id: q }]`; comment "read for the qualification's fee (Q-13)" | `[{ key_kind: 'unit', key_id: h1 }]`; comment "read for the paper's own fee (Edexcel prices per paper …)" |

**Pre-authorised for item 4** (the API's sentences; the money each test asserts is unchanged — only the sentence):

| File:line | Old | New |
|---|---|---|
| 02-money:77 | `Payment of EGP 1500.00 via instapay has been confirmed` | `Payment of EGP 1,500 by InstaPay has been confirmed` |
| 02-money:134 | `EGP 1500.00` | `EGP 1,500` |
| 03-v3-flows:75 | `… school fee (5000.00 EGP) must be paid …` | `… school fee (EGP 5,000) must be paid …` |
| 08-money-rules:221 | `EGP 500.00 applied from escrow has been returned` | `EGP 500 paid from the balance has been returned to it` |
| 08-money-rules:849 | `EGP 250.00 applied from escrow has been returned` | `EGP 250 paid from the balance has been returned to it` |
| 08-money-rules:1002 | `… was for (EGP 1400.00) — record at most that` | `… was for (EGP 1,400) — record at most that` |
| 08-money-rules:1043 | `The escrow this transfer added has already been used, so it can no longer be undone` | `What this transfer added to the balance has already been used, so it can no longer be undone` |
| 08-money-rules:1222 | `EGP 1500.00 paid for Geography (AS, money rules) has been returned to your escrow balance in full` | `EGP 1,500 paid for Geography (AS, money rules) has been returned to your balance in full` |
| 08d-foundation-grade:396 | `The 2027-2028 school fee (4000.00 EGP) must be paid …` | `… (EGP 4,000) must be paid …` |
| 08d-foundation-grade:442 | `The 2027-2028 school fee (6000.00 EGP) must be paid …` | `… (EGP 6,000) must be paid …` |
| 08n-session-offers:1164 | `Admin move price (08n …) was 1300.00 EGP and is now 1450.00 EGP.` | `… was EGP 1,300 and is now EGP 1,450.` |
| 08n-session-offers:1194 | `Correction priced (08n …) was 1300.00 EGP and is now 1450.00 EGP.` | `… was EGP 1,300 and is now EGP 1,450.` |
| 08n-session-offers:1197 | `Correction carried (08n …) stays at 1300.00 EGP, to be confirmed …` | `… stays at EGP 1,300, to be confirmed …` |
| 08n-session-offers:1218 | `Board change notice (08n …) stays at 1300.00 EGP, to be confirmed …` | `… stays at EGP 1,300, to be confirmed …` |
| 08n-import:668 | `The Y-Y+1 school fee (2500.00 EGP) must be paid …` | `… (EGP 2,500) must be paid …` |
| 08p-pricing-policies:457 | `/was 10000\.00 EGP and is now 10500\.00 EGP/` | `/was EGP 10,000 and is now EGP 10,500/` |
| 08q-charges:570 | `toContain('insufficient')` | `toContain('Not enough in the balance')` |
| 08q-charges:578 | `toContain('never from escrow')` | `toContain('never from the balance')` |
| 08x4-exam-entries-rework:327 | `… (exams xw) (EGP 700.00) — entered once it is paid` | `… (exams xw) (EGP 700) — entered once it is paid` |

The same list, with the exact text, is `evidence/changed-assertions.tsv`. No other assertion changed.

## 3. Controls (each guard undone once, its test red, put back)

| Guard | Undone | Red |
|---|---|---|
| c1 — item 1, the board's rule | `onePaperFeeKeys` returning the qualification on every board | 08u F8-05: `expected [ { key_kind: 'qualification', … } ] to deeply equal [ { key_kind: 'unit', … } ]` |
| c3 — item 3, the desk's payment under way | the lookup skipped | 08o F8-08/09: `expected { …(48) } to match object { status: 'pending_payment', …(2) }` |
| c4 — item 4, the method in words | ``const how = `via ${data.method}` `` | 08o F8-08/09: `expected [ …(2) ] to deeply equal [ …(2) ]` (the two notices) |
| c8 — item 8, the second qualification offered | `qualificationsToAdd` empty | 08u F8-04: `expected [] to deeply equal [ [ …(2) ] ]` |
| c9 — item 9, only a draft is deleted | the draft-only check skipped | 08n F8-01: `expected { status: 200 } to deeply equal { status: 409, … }` (the open session deleted) |
| c1b — item 1, the paste reads a unit's whole code | the whole-code reading skipped | 08u F8-05: `expected [ [ 'qualification', … ] ] to deeply equal [ [ 'unit', … ] ]` |
| c7 — item 7, a core subject deactivated | the route's core refusal put back | 08h F8-02/03: `Error: Cannot deactivate a core subject. Remove the core designation first.` |
| c-r1 — round 2, item 1: the rule the admin's | `updateBoard`'s admin check removed | 08u F8-05: `expected { status: 200, … } to match object { status: 403, … }` |
| c-r2a — round 2, item 2: kept as history | the old sentence ("… revoke them on the Exceptions page first") | 08n: the refusal's sentence differs |
| c-r2b — round 2, item 2 (finding 8): the locks | the locks on the session's subjects, items and reminder rules removed | 08n "finding 8": `expected { status: 200, … } to deeply equal { status: 409, … }` (deleted; the cascade would take the exception) |
| c-r3 — round 2, item 3: the code, not the words | `isInsufficientBalance` reading the message for "insufficient" | 08q: `"status": 400` for 422 |
| c-r5 — round 2, item 5: a single whole item | the gate removed | 08u F8-04: `expected [ { …(4) } ] to deeply equal []` (the GCE offered beside the units) |
| c-r7 / c-r7b — round 2, item 7: the school's name | the email's `<h1>` / the receipt's heading back on the app's name | 08f: the stub's heading / the PDF's text |
| c-a2 — answer 2: the whole item's row | `onePaperFeeKeys` back on the qualification | 08u F8-05: `expected [ { key_kind: 'qualification', … } ] to deeply equal [ { key_kind: 'option', … } ]` |
| item 6 on the screen — the Arabic rule | the old rule `\((.+) EGP\)` put back while the web reloaded | the Reserve page in Arabic shows the refusal in English (`round2/r2-i6-control-old-rule-ar.jpg`) |

Logs: `evidence/controls/`.

## 4. Migrations 0062 and 0063, proven (0064: §13)

- **On a template copy** (`migration/0062-0063-template-copy.txt`): `igcse_findings_mig`, a fresh copy of
  `igcse_template_dev` (34), migrated with main 2a149dd's set to 62, given a fixture of main's one-paper items
  (`fixture-at-62.sql`: a Pearson Paper 1H and a two-paper item, a Cambridge Paper 4, all keyed on the qualification);
  the branch's set: 62 → 64; Pearson `'unit'`, Cambridge and OxfordAQA `'qualification'`; Paper 1H re-keyed on its unit;
  the two-paper item, Paper 4 and the whole subject untouched; one `BOARD_UPDATED` and one `OFFER_ITEM_UPDATED` row; the
  8 lines' digest identical; a second migrate applies nothing; 0063's statements run again by hand: `INSERT 0 0` twice.
- **On a cycle built by main's code** (`migration/0062-0063-cycle-built-by-main.txt`): `igcse_findings_walk` — empty,
  main's 62, the June 2027 cycle by the demo script on main's API, four families reserving and paying on main's API;
  the branch's migrate: Mathematics' "1H only (retake)" and "2H only (retake)" from 4MA1 to 4MA1/1H and 4MA1/2H, the seven
  Cambridge one-paper items untouched, one `BOARD_UPDATED` and two `OFFER_ITEM_UPDATED` rows, the 6 lines' and 2
  payments' digests identical before and after.
- The suite starts from an empty database migrated through 0063 (§5). FEATURES_PLAN.md §3's protocol: 0062 generated by
  `drizzle-kit generate --name board_one_paper_fee`, 0063 by `--custom --name board_one_paper_fee_backfill`, after main's
  0061; no migration of main's was touched.

## 5. Gates

| Gate | Commit | Result | Evidence |
|---|---|---|---|
| `pnpm --filter @repo/api check-types` (source and tests) | 5d9da54 | green | session log, trail 03:48Z |
| `pnpm --filter web check-types` | 5d9da54 | green | session log |
| the suite, local time (Africa/Cairo), from an empty database migrated through 0063 | 5d9da54 | 43 files, **850 passed**, 1 todo (main: 843; seven scenarios added) | `gates/suite-local-5d9da54.txt` |
| the same with `TZ=UTC` | 5d9da54 | 43 files, **850 passed**, 1 todo | `gates/suite-utc-5d9da54.txt` |
| 09's invariants (in both runs) | 5d9da54 | 61 green | the same files |
| `useQuery<…>` generics in `apps/web/app` | — | 15 (unchanged) | `grep -rn "useQuery<" apps/web/app` |
| No file over 300 KB under `.audit`; no mobile number in the trail or the documents | — | none (largest shot 111 KB) | CI's gate 0 |
| CI (`.github/workflows/ci.yml`: gate 0, both type-checks, the suite) | 5d9da54 | run 38999618173 green | `gh run list --branch feature/walkthrough-findings` |

The seven scenarios added: 08u "F8-05" and "F8-04", 08o "F8-08, F8-09", 08h "a subject is added …" and "a subject marked
core is deactivated …", 08n "a draft with its sheet is deleted …" and "refused, nothing deleted …". An earlier local
run on 6c90d1f (849 passed, 1 failed) had loaded the fee service before the paste's fix and 08u after its new assertion:
superseded by these.

## 6. The drives

Two systems on the same container, each a fresh database: **before** — main 2a149dd's code (`/tmp/wf/main-src`, from
`git archive`) on `igcse_findings_before`: the admin signed up through the API, main's seed (with its samples), the demo
script's June 2027 cycle, families A (Cambridge's two by InstaPay with the reference, Pearson's unpaid), B (a walk-in at
the desk, cash, receipts handed over, a drop asked, then approved and its receipt back) and D1 (reserved, unpaid), 31
shots and their readings (`before/`); **after** — `igcse_findings_walk`, built the same way by main's code, then migrated
and driven on the branch with families C and D2, 44 shots (`after/`). Each screen's text is in `readings*.json`.

- What the drives met that the suite had not: the fee paste's token reading (item 1, fixed in `parseFees`), the
  notification centre's "Escrow Balance Updated" type label (now "Balance Updated") and its untranslated words.
- One mishap, recorded in the trail: the first before run's images were overwritten by the after run (the drive's
  library read its shot directory before the phase set it); the before phase was run again on its own database.

## 7. Decisions and why (mine)

1. **The board's rule is a column, not a list.** One property per board, read when an item is made; a board whose list
   changes is changed on its card, and the school's existing items stay as they are (the Fees tab re-prices unpaid lines).
2. ~~Cambridge's one-paper item stays on the qualification even where the whole subject enters an option~~ —
   superseded by the lead's answer 2 (round 2): it reads the whole item's row, the option's, and the list names 0970
   once ("0970 CX 10,850"); migration 0064 re-keys the items already made.
3. **The migration re-keys only a one-paper item that enters one unit and reads one qualification key**; an item made by
   hand with other keys is left as it was made.
4. **A payment under way is the API's fact**, not the screen's inference: the statement and the Student 360 say it, so
   Home, the desk and any later screen read one answer. The home summary's `owing` is unchanged (its assertions and old
   screen stay).
5. **"Another suite" narrows the second qualification** to what the brief describes (the IAL beside the GCE): on a
   migrated database the old Cambridge syllabi (0610 beside 0970) share an area, level and suite, and offering them as
   "another qualification" would be a trap.
6. **The second qualification goes through the item endpoint** as the brief says, in two requests ordered so that a
   failure leaves nothing reservable together: the group first, the item second.
7. **Deleting a draft refuses rather than cascades** where history would go with it (granted exceptions, sent reminders).
8. **"Escrow" stays in the ledger's stored reasons and the audit**; only sentences a person reads changed (decision 14).
9. **Attribution:** every commit ends with "Co-Authored-By: Claude Opus 5.5".

## 8. Deferred, and why

- **An unpaid line of a re-keyed item** (corrected in round 2, the review's item 4). A line keeps the price it was
  given, but the next re-price moves it: `repriceLines` (`board-fee.services.ts`) finds a line through the fee row its
  pricing basis names — the syllabus's row, for a one-paper line reserved before 0063 (Edexcel) or 0064 (Cambridge with
  an option) — and `repriceBoardPart` (`pricing.services.ts`) then prices it from the item's **current** keys. So the
  next "Re-price unpaid lines" after that syllabus row changes moves such a line to the paper's price (Edexcel) or the
  option's (Cambridge), and refuses with an error if that row is missing from the series. Acceptable (the lead's answer 3:
  leave them): no such line exists on the template or on the walk cycle (both proofs, §4 and §13, show none), and the same
  state already arises from the item endpoint's fee-key edit on any item with unpaid lines.
- **The old Home card** (`home-summary.client.tsx`, the screen with F6b's switch off) still offers "Pay" for every owed
  line; it is hidden while the switch is on, and the switch was not touched.
- **Hidden screens' amounts** (`admin/payments` "Incl. … escrow", the dashboard): hidden by decisions 13 and F6b; left with
  their screens.
- **Family-facing sentences the API wrote before and other notices' Arabic**: the drop/swap notices ("… requested to drop
  …", "… was approved …") keep English in Arabic; Pending Requests' "Submitted 10/17/2026" keeps the US date. Neither is
  one of F8's findings; both are listed for the next words pass.
- **Decision 2's month rule** is still enforced on the form only (CYCLE_DECISIONS.md §9).

## 9. Recorded, no change

- **F8-06** — form options with no shape of their own: Computer Science O.L.'s "Paper 41/42" (0984 has no Paper 4), Physics
  A.S./A.L.'s three A.2. choices as one route, the forms' separate "Self Study (ONLY 2nd entry)" question. The school's
  forms, not the system's.
- **F8-07** — the fee lists in hand are June 2026's; rows no list has are placeholders. With item 1, Pearson's list
  needs the papers' own rows (4,600 each) under the units' codes as the catalogue holds them.
- **F8-14** — one address over 600 requests in 15 minutes is refused: a deployment setting (`API_RATE_LIMIT_MAX`,
  `CLIENT_IP_HEADER` behind a proxy; SECURITY_AUDIT O-4).

## 10. Questions for the lead — answered (the review of 744e553), applied in round 2

1. OxfordAQA's one-paper rule: its fee list is not in hand; it stays on the syllabus's fee. Set it on the board card when
   the list arrives? — **Yes:** OxfordAQA stays on the syllabus's fee until its list is in hand; the board card is where
   the admin changes it then (now the admin's alone, with a reason: item 1 above).
2. Cambridge with an option code: should a one-paper retake read the option's row (the same 10,850, the list naming the
   syllabus once) instead of the qualification's? — **Yes:** the whole item's row, the option's where the whole item
   enters one, the qualification's otherwise; `withOnePaper` and the item endpoint's default follow it; migration 0064
   re-keys the existing Cambridge items (§13).
3. Unpaid lines of Edexcel one-paper items reserved before 0063 (if the school has any): re-price them to the paper's fee
   by hand, or leave them at the price the family was given? — **Leave them** (none exist); the next re-price of their
   syllabus row moves them (§8, corrected).

## 11. For F8's agent: the walkthrough's steps to retake

1.12–1.19 (the seed: the admin alone; `--with-samples`; no stale draft), 1.6 (`LOCAL_UPLOAD_DIR`), 2.6 (the subjects:
the Catalogue's Add a subject or Import several from a list), 2.8 (deactivating the samples: no "Remove core" first),
2.17 ("N subjects are not mapped yet" counts active subjects), 2.38 and 2.52 (Mathematics' 1H and 2H read their own rows:
the demo's `FEES_PASTE` needs `4MA1/1H 4,600` and `4MA1/2H 4,600`), 2.41–2.42 (Arabic A.L.: Add a qualification on the
form; the demo script's item-endpoint step can go), 2.74–2.79 and 4.28 (the school's name on the slip and the receipt),
2.91 ("1 due date moved.", the date), 4.10–4.11 and 4.16 (Home and Pay now), the desk's InstaPay family (To collect now),
the statement, notifications and Pending Requests in both languages, and Settings' refund card.

## 12. Progress log (UTC, 16–17 Oct 2026)

- 22:43 — set up (install, builds, `igcse_findings_dev` migrated, env on 3211/3210). 22:51 — main 2a149dd merged (d73109d).
- 23:12:43 — the lead approved the two fee-key assertions. 23:46 — item 1's scenario green, control c1. 23:55 —
  0062/0063 proven on a template copy.
- 00:47 — items 2 and 3 in the API, 08o's scenario, control c3. 01:01 — 6fc855d pushed (CI red as expected: the
  sentences' assertions not yet changed). 01:19 — item 8, control c8. 02:00 — item 4's sentences, 19 assertions,
  control c4. 02:03 — item 9, control c9. 02:13 — items 10–12; c79f8db pushed.
- 02:15–03:13 — the drives: main's before-state, the walk database migrated (02:45, second proof), the branch's after
  shots; the before phase run again on its own database. 03:21 — the seed's proof.
- 03:25 — adac39f (evidence), 6c90d1f (main e90850d merged), pushed.
- 03:28–03:35 — a local run on 6c90d1f; meanwhile the drive's parse check found the paste's token reading (item 1);
  fixed, 08u asserts it, controls c1b and c7 (03:37); 5d9da54 with this document, pushed.
- 03:41–03:48 — the suite on 5d9da54 in local time, 850 passed; 03:48–03:55 with `TZ=UTC`, 850 passed. Both type-checks
  green. The prints in Arabic and with the school's name emptied (`after/f11-*-named-ar`, `…-unnamed-en`), the name put back.
- The branch's dev servers are left running for the lead's drive: API on 3211 (pnpm 47310), web on 3210 (pnpm 47312), on
  `igcse_findings_walk` (the June 2027 cycle with families A, C, D2; the admin `admin@igcse.local` / `AdminPass1`, the
  demo's staff and families `TestPass1`). Main's servers (3212/3213) were stopped by their PIDs.

## 13. Round 2 — the review of 744e553 (17 Oct 2026)

The lead's review: "merge after fixes 1, 2, 3, 4, 6"; 5, 7 and 9 in scope too; 8 covered by 2; the three questions
answered (§10). One round on the branch, each item with its scenario or control and a trail row
(`.audit/walkthrough-findings.tsv`, phases `item-r1` … `item-r9`, `answer-2`).

**Item 1 — the one-paper rule is the admin's, with a reason.** §1, item 1 ("The admin's alone, with a reason"; MO-10's
precedent). 08u's F8-05 flips OxfordAQA as the admin with a reason (read back from the audit row) and back; the
coordinator is refused (403) and the admin without a reason (400); the coordinator's edit of the board's notes still
passes. Control c-r1. Screens: `round2/r2-i1-board-admin-changed-en` (the Reason field once the rule changes),
`…-admin-no-reason-en` ("Say why the one-paper rule changes (at least 5 characters) — it is recorded."),
`…-coordinator-{en,ar}` (the rule read, no select).

**Item 2 — a draft's kept history, its locks, and the screen after a deletion** (`session.services.ts`
`deleteDraftSession`, `session.client.tsx`).
- History is kept: an exception of any status (a revoked one too) or a sent reminder refuses the deletion with
  "An exception was granted for <session>: it is kept as history and cannot be deleted" and "Reminders were sent for
  <session>: it is kept as history and cannot be deleted" — nobody is sent to revoke anything.
- Finding 8: after the session's own lock, its subjects, its items and its reminder rules are locked `FOR UPDATE` in id
  order before anything is counted. A grant or a reminder writing a row that names one of them takes a key-share lock on
  it: one committed before is counted, one after waits and then fails its foreign key; none is deleted unseen by the
  cascade.
- Scenarios (08n): a draft with an item-scoped exception refused before and after the revoke (row kept, `revoked`, items
  intact); a draft with a sent reminder refused (its rule kept; no path of the app sends one for a draft today, so the
  step's records are written as the step writes them); and a forced race — the grant paused at its audit row with its
  exception written, the deletion fired and queued on the item's lock, the grant released: the deletion refused, the
  exception active. Controls c-r2a (the old sentence) and c-r2b (the locks removed: the deletion answered 200).
- The screen: on success it `router.replace`s to the Sessions list and refetches only the lists (the deleted session's
  own queries are left alone; each would answer 404). Driven: landed on `/admin/sessions`, which no longer lists it, and
  no response of 400 or more during the flow, GETs included (`round2/r2-i2-*`; `drive-readings.json`:
  `i2-after-delete-url`, `i2-responses-400-or-more: []`). The kept draft's refusal in English and Arabic
  (`r2-i2-kept-refusal-{en,ar}`); the deletion's refusals now have their Arabic (`i18n-findings.ts`).

**Item 3 — the balance refusals' status by a code** (`escrow.services.ts`). `InsufficientBalanceError` carries
`errorCode: 'INSUFFICIENT_BALANCE'` — not `code`: `clientMessage` (`lib/response.ts`) reads a string `code` as a
driver's SQLSTATE and hides the sentence, which the first run showed (422 with "Failed to initiate payment"). Thrown
by `debitEscrow`, `debitHeld` (three), `transferEscrow` and the desk's and the payment's balance checks; the escrow,
payment and registration routes answer 422 by `isInsufficientBalance(err)`. 08q's "three instalments …" asserts
`{ status: 422, error: 'Not enough in the balance…' }`. Control c-r3.

**Item 4 — §8 corrected** (the re-price of a re-keyed item's unpaid line).

**Answer 2 — the whole item's row on a syllabus-keyed board.** `onePaperFeeKeys(…, wholeOptionId)`: on a
`'qualification'` board, the option's row when the subject's whole item enters an option, the qualification's
otherwise; `withOnePaper` passes the whole item's option; the item endpoint's default reads the offer's whole item
(`wholeItemOption`). Migration **`0064_one_paper_whole_item_row`** (`drizzle-kit generate --custom`): an existing
one-paper item that enters units, reads exactly one key (its qualification), and whose offer has exactly one whole item
entering an option of that qualification, re-keyed on the option; an `OFFER_ITEM_UPDATED` row each, in the same
statement; lines untouched; idempotent.
- **On a fresh template copy** (`migration/0062-0064-template-copy.txt`): `igcse_findings_mig2`, 34 → main's 62 → the
  fixtures (`fixture-at-62.sql`, and `fixture-0064-at-62.sql`: a Cambridge syllabus entered through option CX, its Paper
  2 and Paper 4 keyed on the qualification as main's code makes them) → the branch's set, 65: Paper 2 and Paper 4 on
  option CX with their audit rows; the Cambridge Paper 4 under an offer whose whole subject enters the award kept on the
  qualification; 0063's Edexcel change as before; the 8 lines' digest identical; a second migrate applies nothing; 0063
  and 0064 by hand: `INSERT 0 0`.
- **On a cycle built by main** (`migration/0062-0064-cycle-built-by-main.txt`): `igcse_findings_cycle65`, a copy of
  `igcse_findings_before` (main's 62; the demo cycle and the before drive on main's API) → 65: the seven Cambridge
  one-paper items from their syllabus to its option (A, CX, DY) at the same fee read (9,850 / 10,850 / 12,950: the
  demo's list names both rows), Mathematics' 1H and 2H to 4MA1/1H and 4MA1/2H, 10 audit rows, the 6 lines' and 2
  payments' digests identical; 0064 again by hand: `INSERT 0 0`. The walk database was migrated to 65 the same way
  before round 2's drive.
- 08u's F8-05: Paper 4 and the endpoint's Paper 2 read option CX; the reserved line's basis names the option at 10,850
  (price 13,850 unchanged); the Cambridge fee list is the Fees tab's paste `F0970-RUN CX 10,850` — one row, read by the
  whole subject and each paper's retake; the qualification's row is no longer in it. Control c-a2.

**Item 5 — a second qualification only beside a single whole item** (`offer.services.ts` `qualificationsToAdd`):
offered only when the subject's own entry — its items, less the qualifications added beside it — is one whole item. A
subject entered by unit (one item per unit), by paper or by route gets none: nothing would make the new one a choice
against its entry. The form's `AddQualification` refuses without a whole item instead of falling back to an ungrouped
one. 08u's F8-04 adds an Arabic subject mapped to an IAL award and its two units: two unit items,
`qualificationsToAdd` `[]`. Control c-r5 (the GCE offered beside the units).

**Item 6 — the Arabic rules on round 1's shapes.** `i18n-import.ts`'s school-fee rule reads `(EGP N)` now; the year
is kept one left-to-right unit (the drive showed "2026-2027" reversed in a right-to-left line; the desk's "school fee
(EGP N) was collected" rule in `i18n-money.ts` had the same reversal and is isolated too). The check
(`round2/dict_old_shapes.py`, output `dict-old-shapes.txt`): every sentence round 1 removed from `apps/api/src`
(e90850d..744e553), and the web's and validations' rewritten ones, cut into their literal fragments and looked for in
every dictionary — this rule was the only one left on an old shape; the two hits remaining ("school fee (EGP") are text
both shapes share, and both rules capture "EGP 5,000". No rule captures an amount without its decimal point. The
deletion's, the board's and Add a qualification's new sentences have their Arabic. Driven in Arabic on the family's
Reserve page with a school-fee schedule made for the drive and deleted after: «يجب دفع الرسوم المدرسية لعام 2026-2027 (5,000
جنيه) قبل تسجيل المواد» (`r2-i6-school-fee-refusal-ar`); with the old rule put back while the web reloaded, the same
screen kept the English (`r2-i6-control-old-rule-ar`).

**Item 7 — the school's name on the emails and the emailed receipt.** `settings.services.ts` `senderNames()`: the
school's name (`school.name`) and the app's, the school's `null` when the setting is empty. The emails' layout
(`integrations/email.ts`): its `<h1>` is the school's name with "IGCSE Subject Reservation System" under it, or the
app's name alone; the footer the same; the link-request email's signature, the auth emails' subject and welcome line
name the school too. The receipt PDF (`payment.services.ts` `generatePaymentReceipt`): the school's name and the app's
under it, centred, or the old single line. The stub prints each email's heading. 08f's new scenario (a desk payment
with the name set, another with it empty): the receipt email's stub line and the PDF's text, both ways
(`round2/item7-email-stub-and-receipt-pdf.txt`, which also has the drive's receipt on the walk cycle with "Demo
International School" and with the name emptied). Controls c-r7, c-r7b. Known limit kept: the PDF writer's Courier
prints Latin-1 only, as it already does for students' names.

**Item 9 — one money formatter.** `lib/format.ts`'s `formatPrice` (Intl, no fraction digits) is gone; its 111 uses in 15
files call `formatEgp` (`@repo/validations`), and so do the hand-built amounts: the sessions screens' `Money`, the
receipt print, the dashboard's totals and price column, the checkout's exact InstaPay amount, the Reserve page's and the
desk's school-fee and collected sentences, the subjects list, the balance transfer and withdrawal pickers, the exception
form's charge picker. "EGP 9,412.50" with piastres, "EGP 9,850" without. Driven with a charge of EGP 150.50 pushed to
student C and cancelled after: the desk reads "EGP 150.50" and «150.50 جنيه» (`r2-i9-desk-{en,ar}`). §2's date of the
lead's approval is 16 Oct 23:12:43Z.

**Changed assertions (round 2)** — the pre-authorised 08u Cambridge expectations, and two the lead asked for:

| File:line | Old | New |
|---|---|---|
| 08u-session-form:234 | `keysOf(b4.id)` → `[{ key_kind: 'qualification', key_id: bio }]` | `[{ key_kind: 'option', key_id: cx }]` (answer 2, pre-authorised) |
| 08u-session-form:281 | `priced(l4)` → `rows: [{ keyKind: 'qualification', keyId: bio, amount: 10850 }]` | `rows: [{ keyKind: 'option', keyId: cx, amount: 10850 }]` (price 13,850 unchanged; pre-authorised) |
| 08u-session-form:307 | `keysOf(e2)` → `[{ key_kind: 'qualification', key_id: bio }]` | `[{ key_kind: 'option', key_id: cx }]` (pre-authorised) |
| 08u-session-form:245–259 (setup) | Cambridge's list: the option's row and the qualification's, both 10,850 | the option's row alone, from the Fees tab's paste, read by the whole subject and each paper |
| 08u-session-form:309–324 | the coordinator flips OxfordAQA's rule, no reason | the coordinator refused, the admin without a reason refused, the admin with reasons (item 1, as asked) |
| 08q-charges:570 | `.error).toContain('Not enough in the balance')` | `.toMatchObject({ status: 422, error: …'Not enough in the balance' })` (item 3, as asked) |

No other existing assertion changed (`changed-assertions.tsv` has the exact text).

**New scenarios:** 08n "refused … a draft whose exception was revoked and … a reminder went out for" and "finding 8: …",
08f "the emails and the emailed PDF receipt say who they come from …"; 08u's F8-05 and F8-04 and 08q's "three
instalments" extended.

**Gates (round 2)**

| Gate | Commit | Result | Evidence |
|---|---|---|---|
| `pnpm --filter @repo/api check-types` (source and tests) | 9231458 and 86e77c7 | green | session log |
| `pnpm --filter web check-types` | 9231458 | green | session log |
| the suite, local time (Africa/Cairo), from an empty database migrated through 0064 | 9231458 | **red**: 852 passed, 1 failed (09's O-7: 08n's hand-written reminder message had no audit row) | `gates/suite-local-9231458.txt` |
| the same with `TZ=UTC` | 9231458 | **red**: the same one | `gates/suite-utc-9231458.txt` |
| the suite, local time, after the scenario writes the send's audit row | 86e77c7 | 43 files, **853 passed**, 1 todo (round 1: 850; three scenarios added) | `gates/suite-local-86e77c7.txt` |
| the same with `TZ=UTC` | 86e77c7 | 43 files, **853 passed**, 1 todo | `gates/suite-utc-86e77c7.txt` |
| `useQuery<…>` generics in `apps/web/app` | 86e77c7 | 15 (unchanged) | `grep -rn "useQuery<" apps/web/app` |
| CI (gate 0, both type-checks, the suite) | 86e77c7 | run 39014603807 **green** (the run on 9231458, 39013733203, was cancelled by the push of 86e77c7) | `gh run list --branch feature/walkthrough-findings` |

**Left on the walk database by the drive:** the draft "June 2028 — r2-kept" (its revoked exception is history, so it
cannot be deleted: item 2 as decided), which the Reserve page lists to families as "(preregistration)". The
school-fee schedule, the EGP 150.50 charge and the school's name were removed, cancelled or put back. The branch's API
was restarted on the walk database at 65 (pnpm PID 99956; the web is the same server, pnpm 47312).

**Progress (UTC, 17 Oct):** 05:13 — the review received. 05:36 item 3 (control c-r3); 05:37 item 1 (c-r1); 06:07 items
5 and 2 (c-r5, c-r2a, c-r2b); 06:21–06:25 answer 2, 0064 proven twice (c-a2); 06:33 item 7 (c-r7, c-r7b); 06:41 item
6's dictionary check; 07:07–07:18 the drive on the walk cycle at 65 (items 1, 2, 6, 7, 9), item 6's on-screen control
and the year's isolation; 07:27 9231458 committed and pushed; both suites red on one test (09's O-7, the scenario's
hand-written message without its audit row), fixed in 86e77c7 (07:41), pushed; 07:41:58–07:50:10 both suites green on
86e77c7 (853 passed each); 07:42–07:56 CI run 39014603807 green.
