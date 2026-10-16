# F6a — The session in the school's words

Branch `feature/session-words` (worktree `.claude/worktrees/session-words`), from main 1b6a216 (11 Oct
2026). The spec is FEATURES_PLAN.md §1 "F6a — The session in the school's words" (on the lead's branch
until it reaches main); the plan's rules are FEATURES_PLAN.md §4–§5. Trail: `.audit/session-words.tsv`;
evidence (screenshots before and after in English and Arabic, the control logs, the suite summaries, the
measurement, the drive scripts): `.audit/session-words-evidence/`. Resources (FEATURES_PLAN.md §7): test
database `igcse_words_test`, dev database `igcse_words_dev` (a copy of `igcse_template_dev`), API 3151,
web 3150. The progress log is the last section.

**Why.** The owner, on the rebuilt Session screen (11 Oct 2026): "creating the sessions is still a bit
confusing… they would feel so lost". The model holds everything the school's 25 Google Forms say
(SCHOOL_FORMS.md §2.2–§2.5); the screen spoke the model's language (availability, item, whole subject,
exclusive group, series, a drawer with two forms and two Save buttons, the deadlines on another page).
F6a changes the words and the places, not the model: **no model change, no migration**; one
form-shaped endpoint, one preview read, one rule (a one-paper item is always a retake).

**The rule.** Every word on the Session screen and the family's Reserve page is a word of the forms or
of the links sheet (SCHOOL_FORMS.md §2.5, left column), in English and Arabic. The model's words —
availability, item, offer, route, exclusive group, series id, fee key, "enters", "whole" — stay in the
API and the documents. §2 is the table the reviewer checks every string against.

---

## 1. What was built, against the spec's six points

| # | Point | Built |
|---|---|---|
| 1 | The Subjects tab is the links sheet | `subjects-tab.client.tsx` rewritten: the subjects added or copied, grouped O.L. and A.S./A.L.; per row the subject, its board, its teachers ("(ONLINE ONLY)", "(External)"), its entry options in the forms' words, the course fee with the self-study share ("EGP 12,000 · self study 50%: EGP 6,000", the share from `pricing.selfStudyCoursePercent`), the board fee ("not published yet" when provisional, "not set yet" when missing), its reservations, and "Preview the family's form". "Who teaches it?" for a subject not offered with nobody teaching it (what a copy brings across closed); "Retake (Self Study ONLY)" and "Not offered this cycle" where set. The empty sheet offers "Copy from <last session of this kind>" first (one click) and "Add subjects" second |
| 2 | One form per subject, in the form's order, one Save | The drawer is one form: (a) Teachers this cycle (the pool, a tick each, "online only" per teacher, "Show every teacher", an external team by name), (b) Offered as (four choices), (c) Course fee with "Self Study 50% School fees: EGP …", (d) One paper only (each paper the Catalogue gives an IGCSE subject: Not offered · Retake in school or self study · Retake self study only, with its fee; "Set this subject's papers on the Catalogue" with the link when it gives none), (e) Components (a Cambridge A level's A.S. · A.2. (carry forward on an earlier June or November) · A.L.), Units (an IAL subject's units with the board's codes: Taught by (its teachers, online) · Self study only · Not this cycle, its fee and its sitting) and Qualifications (Arabic A Level, Edexcel: each with its teacher), (f) Grade 10 core (June only), (g) Course starts, (h) Notes; Replace teacher and Remove subject as before. One request: `PUT /v1/sessions/:id/offers/:offerId/form` (§3). "Add subject" opens the same form; once added it stays open so the papers can be set (§5). The old item endpoints stay |
| 3 | Dates where she expects them | The header's "Deadlines" line: each series a button reading "Cambridge International June 2027: entries by 20 Feb 2027 · retakes by 20 Mar 2027" or "…: Dates not set", opening the Board Series page's own dates form (`DatesForm`, now exported) in a dialog; its reason is labelled "Reason" (on the Board Series page too); it writes through `PUT /v1/board-series/:id`. Admin and coordinator (the entry deadline stays the admin's, as on that page); finance reads the line |
| 4 | Preview as the family's form | "Preview the family's form" per row (and in the form's footer) renders the Reserve page's own rows (`OfferRows`, exported from `components/reservations/reserve.tsx`, with a `preview` flag the family's page never passes) from `GET /v1/registrations/offers/preview?sessionId=` (§4): the subject with its teacher choice, the entry choices with their prices, the sitting it follows, the price; the refund policy sentence and the declaration; read-only, in the viewer's language |
| 5 | The family's Reserve page preselects the only child and the only open session | `register.client.tsx`: the only session listed; else the only open one, even beside an upcoming one; else, none open, the only upcoming one. The only child as before. Confirmed on the running system first: parent.hany's child was preselected, the session was not (June 2027 open beside two sessions in preregistration) |
| 6 | Arabic for every new string, right to left | `lib/i18n-sessions.ts` (exact strings and the sentence rules for the refusals with a name); every changed screen driven in Arabic; what stays in Latin letters on an Arabic page is data (board names, the school's own option and qualification labels, "NEA") |

The display word "All papers" (the lead's decision of 11 Oct, answer 2): `itemDisplayLabel(item)` in
`@repo/validations` is the one place — a whole item whose stored label is generateItems' "Whole
subject" reads "All papers" (Arabic "كل الأوراق") on every screen that shows an item's label: the
links sheet, the form, the preview, the family's and the desk's Reserve rows, the exceptions grant
form. The stored label, generateItems and the 42 assertions that read it are unchanged; F7's `findItem`
matches the stored label and is unaffected. The import's review screens (F7's) show the label its line
plan carries, which has no item kind; they keep it (deferred, §11).

---

## 2. The mapping table — each screen phrase → the model's field and value

### 2.1 The links sheet (a row)

| Screen phrase (EN) | Arabic | Model |
|---|---|---|
| O.L. / A.S. / A.L. (the groups) | O.L. / A.S. / A.L. | `subject.qualification_level` `igcse` / `as_level`, `a_level` |
| Subject · Board · Teachers · Entry options · Course fee · Board fee · Reservations | المادة · المجلس · المعلمون · خيارات القيد · رسوم التدريس · رسوم المجلس · الحجوزات | the offer's subject; `exam_board.name`; `session_offer_teacher`; its items; `session_offer.course_fee`; the item's `board_fee` rows; live lines |
| (ONLINE ONLY) after a teacher | (أونلاين فقط) | `session_offer_teacher.mode = 'online'` |
| (External) after a teacher | (خارجي) | `teacher.kind = 'provider'` |
| All papers: first entry 100% · retake in school 100% · retake self study 50% | كل الأوراق: قيد أول 100% · إعادة في المدرسة 100% · إعادة دراسة ذاتية 50% | the whole item (`kind = 'whole'`) under an offer `availability = 'open'`; the percents are `pricing.retakeTaughtCoursePercent` and `pricing.selfStudyCoursePercent` |
| All papers: retake in school … · retake self study … (no first entry) | — | offer or whole item `availability = 'retake_only'` |
| Retake (Self Study ONLY) · All papers: self study 50% | إعادة (دراسة ذاتية فقط) · كل الأوراق: دراسة ذاتية 50% | offer `availability = 'self_study_only'` |
| 2nd entry only (badge) | القيد الثاني فقط | offer `availability = 'retake_only'` |
| Not offered this cycle | غير معروضة هذه الدورة | offer `availability = 'closed'` with teachers |
| Who teaches it? | من يدرّسها؟ | offer `availability = 'closed'` with no teacher (what `copyOffersFrom` brings across as `closedNoTeacher`), or the `no_teacher` warning |
| Paper 4 only (0610/41): in school or self study | Paper 4 فقط (0610/41): في المدرسة أو دراسة ذاتية | an item `kind = 'one_paper'`, `availability = 'retake_only'` (or `open`, the same since a one-paper item takes retakes only); the paper is its unit's `short_code` and `code` |
| Paper 4 only (…): self study only | … فقط: دراسة ذاتية فقط | a `one_paper` item `availability = 'self_study_only'` |
| A.S. · A.2. (carry forward) · A.L. | A.S. · A.2. (ترحيل نتيجة A.S.) · A.L. | items `kind = 'route'`: A.S. = its option's qualification `level = 'as_level'`; A.2. (carry forward) = `needs_prior_series` (the option's `carry_forward`); A.L. = the rest; "(self study only)" = `availability = 'self_study_only'`; a closed route is not listed |
| P1 (Teacher A, online) · M1 (Teacher B / Teacher A) · S1 (self study only) | — (names and codes are data) | items `kind = 'unit'`, the unit's `short_code`; the item's own teachers (`session_offer_item_teacher`) else the offer's; ", online" when one is `mode = 'online'`; "(self study only)" = `availability = 'self_study_only'`; a closed unit is not listed |
| Arabic (GCE A Level) (9AA0) (Teacher B) · Arabic (International A Level) (YAA01) (Teacher A) | — (data) | items `kind = 'qualification'` and the whole item beside them, each its `qualification.title (code)` and its own teachers |
| EGP 12,000 · self study 50%: EGP 6,000 | 12,000 جنيه · دراسة ذاتية 50%: 6,000 جنيه | `session_offer.course_fee` × `pricing.selfStudyCoursePercent` |
| EGP 10,850 · not published yet | لم تُنشر بعد | the main item's `board_fee` rows' sum; `provisional = true` |
| not set yet | لم تُحدَّد بعد | a fee key with no `board_fee` row (`boardFee.missing`) |
| Board fee not set · Dates not set · Set its papers on the Catalogue | رسوم المجلس غير محددة · لم تُحدَّد المواعيد · حدّد أوراقها في الكتالوج | the warnings `no_fee`, `series_without_dates`, `unmapped` |
| Grade 10 core | — (existing) | `session_offer.grade10_core` |
| Reservations (the number) | الحجوزات | live lines (status not rejected, expired, dropped) of the offer's items |

### 2.2 The subject's form

| Section / phrase | Arabic | Model (in `OfferForm`, the request) |
|---|---|---|
| (a) Teachers this cycle; a tick per teacher | المعلمون في هذه الدورة | `teachers[]` (`{ teacherId, mode }`), the whole set in order → `session_offer_teacher` |
| online only | أونلاين فقط | `mode: 'online'` (else `'in_school'`) |
| External team (badge); An external team + Add | فريق خارجي | `teacher.kind = 'provider'`; a new one is `{ providerName, mode }` (resolveTeachers makes the provider and joins it to the pool) |
| Show every teacher / Show this subject's teachers only | (existing) | the pool is `subject_teacher`; every active teacher on request (shown at once when the pool is empty) |
| (b) Offered as: First entry and retakes | قيد أول وإعادات | `availability: 'open'` |
| Retakes only (2nd entry only) | إعادات فقط | `availability: 'retake_only'` |
| Retake (Self Study ONLY) | إعادة (دراسة ذاتية فقط) | `availability: 'self_study_only'` |
| Not offered this cycle | غير معروضة هذه الدورة | `availability: 'closed'` (not offered when adding a subject) |
| (c) Course fee (EGP); Self Study 50% School fees: EGP … | رسوم التدريس (جنيه)؛ دراسة ذاتية 50% من رسوم المدرسة | `courseFee`; the share shown is `pricing.selfStudyCoursePercent` (read only) |
| Why the course fee is 0 | (existing) | `zeroFeeReason` (MO-9) |
| (d) One paper only; a paper: Not offered this cycle / Retake in school or self study / Retake self study only; its course fee | ورقة واحدة فقط؛ غير معروضة هذه الدورة / إعادة في المدرسة أو دراسة ذاتية / إعادة دراسة ذاتية فقط؛ رسوم تدريسها | `items[]: { itemId, availability: 'closed' / 'retake_only' / 'self_study_only', courseFee }` for a `one_paper` item; for a paper the Catalogue gives but the sheet does not have yet, `{ paperUnitId, … }` (made with withOnePaper's draft when offered, in one group with the whole subject, which joins that group if it had none — §3); an empty fee is `null` (the subject's) |
| A paper's name: "Paper 4 only (0610/41)"; a paper entering no unit: its own label ("… only (retake)") | — (data; "only" فقط) | the paper's unit `short_code` and `code`; with no unit, `itemDisplayLabel` of the item (never "… only (retake) only") |
| Set this subject's papers on the Catalogue | حدّد أوراق هذه المادة في الكتالوج | an IGCSE subject with no `one_paper` item and none in `papersToAdd`: a link to `/exams/catalogue` |
| (e) Components: A.S. / A.2. (carry forward on an earlier June or November) / A.L.; Offered / Self study only / Not offered this cycle | المكوّنات؛ معروضة / دراسة ذاتية فقط / غير معروضة هذه الدورة | `route` items: `availability: 'open' / 'self_study_only' / 'closed'` (and "Retakes only" shown only when the item is `retake_only` already) |
| Units: P1 (WMA11); Taught by / Self study only / Not this cycle; Its teachers (none ticked: the subject's); its course fee; Sitting | الوحدات؛ يدرّسها / دراسة ذاتية فقط / ليست هذه الدورة؛ معلموها؛ الدورة | `unit` items: `availability: 'open' / 'self_study_only' / 'closed'`; `teachers[]` (empty: the offer's); `seriesMonth`: one of the session's months the board sits (`sessionSeriesMonths`; IGCSE never October or January) → the board's unlabelled series of that month (`findOrCreateSeries`) |
| Reason (a unit moved with its reservations) | السبب | `reason` (kept on each moved line's and item's audit row) |
| Qualifications: each with "Its teacher (the family chooses the qualification with the teacher)" | المؤهلات | `qualification` items and the whole item beside them: `availability`, `teachers[]`, `courseFee` |
| (f) Grade 10 core (June only) · (g) Course starts (if not the session's) · (h) Notes | (existing) | `grade10Core`, `courseStartsOn` (null: the session's), `notes` |
| "<subject> has a reservation: it stands when it is not offered this cycle, and no new one is taken." + tick "Its reservation stands" / "Its N reservations stand" | لها حجز: يبقى حين لا تُعرض هذه الدورة… / يبقى حجزها / تبقى N حجوزات لها | `linesStand: true`; without it the server refuses (409) a close of the subject or of a paper, unit or qualification that has live lines |
| Save · Add subject (new) | (existing) | `PUT …/offers/:offerId/form`; a new subject `POST …/offers` (createOffer), then the same form |
| Saved. · Nothing to change. · Added. Its papers and their fees, if the Catalogue gives it any, can be set below. | (dictionary) | the answer's `changed` |

### 2.3 The header, the preview, the other words

| Phrase | Arabic | Model |
|---|---|---|
| Deadlines: "<board> <month> <year>: entries by <date> · retakes by <date>" | المواعيد النهائية: القيد حتى / الإعادات حتى | `board_series.entry_deadline`, `retake_deadline` of each series attached to the session |
| "…: Dates not set" | لم تُحدَّد المواعيد | neither `entry_deadline` nor `exams_start` |
| No sittings yet: a subject's sitting is added with the subject. | لا دورات بعد… | no `session_board_series` row |
| The board's dates (dialog); Reason | مواعيد المجلس؛ السبب | the Board Series page's form → `PUT /v1/board-series/:id`; `reason` |
| Preview the family's form; The family's form; What a family sees for <subject> on the Reserve page, every choice open. Nothing is reserved from here. | معاينة نموذج الأسرة؛ نموذج الأسرة… | `GET /v1/registrations/offers/preview` |
| All papers (an item's label) | كل الأوراق | `itemDisplayLabel`: `kind = 'whole'` and the stored label "Whole subject" |
| Paper 4 only (retake) (generated label, in Arabic) | Paper 4 فقط (إعادة) | generateItems' one-paper label (a rule in `i18n-sessions.ts`; the paper's name is data) |
| reservation / reservations (the Sessions list, the drawer's subtitle) | حجز / حجوزات | live lines |
| No sittings yet / A sitting appears here once a subject on the sheet is entered in it. (Fees tab's empty state, not its grid) | لا دورات بعد… | no attached series |
| Subject · papers (the Reserve rows' column: the family's page, the desk's card, the preview) | المادة · الأوراق | the offer's subject and its items (was "Subject · what is entered") |
| Correct the sitting; "The sitting decides the academic year every reservation is judged by. The subjects go to the same sitting of the new year with their reservations; …" | تصحيح الدورة؛ تحدد الدورة العام الدراسي… | `PUT /sessions/:id/series` (`session_type`, `series_year`; was "Correct the series") |
| No subject on this sheet reads a fee from this sitting yet. (a Fees grid with no row read) | لا مادة في هذا الكشف تقرأ رسومًا من هذه الدورة بعد. | a series with no fee key of the session's items (was "…of this session reads a fee from this series yet.") |
| Copy fees from an earlier sitting; "Every row comes across provisional (the rows this sitting has are kept): …" | نسخ الرسوم من دورة سابقة… | `POST /board-fees/:seriesId/copy` (was "…an earlier series") |
| "<paper or unit> has reservations past their deadline in the sitting it is entered in (<date>): their entries stand" | … لها حجوزات تجاوزت موعدها في الدورة المقيدة فيها… | a move refused: a live line of the item past its effective deadline where it is (was "…has lines past their deadline in the series…") |
| "A reservation cannot move to <sitting>: the board's entry / retake deadline there (<date>) has passed"; "…: its exams start on <date> and it has no entry deadline" | لا يمكن نقل حجز إلى …: انقضى موعد القيد / الإعادات… | a move refused: a line's effective deadline in the target series (was "<series> is past a line's deadline: …") |
| "<code> <title> for <candidate> has already gone to the board in <sitting>: withdraw its entries first" (F4's sentence, unchanged in English) | … للمرشح … أُرسل إلى المجلس في …: اسحب قيوده أولًا | a move refused: an F4 entry of a moving line already sent |

Words removed from the Session screen by F6a: "Availability", "What can be entered", "Add an item",
"Kind", "What it enters", "Only one of the group", "Needs an earlier sitting carried forward",
"Required in a first entry", "Its board fee is the qualification's", "Series" (the item's select),
"Untick", "Save item", "live lines", "Items with the same group cannot be reserved together", "Whole
subject" (displayed), "item" in the Replace teacher, Remove subject, Copy and Fees sentences; in the
review round "series" on the header's correction and in the Fees tab's two sentences, "lines" in the move
refusals, "Subject · what is entered" on the Reserve rows.

---

## 3. The form endpoint — `PUT /v1/sessions/:id/offers/:offerId/form`

Admin and coordinator (`requireRole(...LINKS_SHEET)`; the coordinator's grant `* /v1/sessions/:id/offers/*`
already covered it); authz row `PUT /v1/sessions/:id/offers/:offerId/form D D D D D A A D D`. Body
`OfferForm` (`packages/validations/src/session/offer.validations.ts`); answer `{ offer, itemsChanged,
itemsCreated, linesMoved, changed }`. Service `saveOfferForm` (`apps/api/src/services/offer.services.ts`).

**One transaction, through the existing services' logic.** The offer and item services' bodies were
split at their locks, so the old endpoints and the form run the same code:

- `changeOfferInTx` — updateOffer's change (teachers through `resolveTeachers`, `assertTeachersFor`
  "Who teaches X? An open subject names its teachers — or make it self-study only", `assertCourseFeeFor`
  MO-9, the row, `SESSION_OFFER_UPDATED`);
- `changeItemInTx` — updateItem's change after a move (its own teachers, fee keys, fields,
  `OFFER_ITEM_UPDATED`);
- `createItemInTx` — createItem's (`insertItem` with withOnePaper's draft, `OFFER_ITEM_CREATED` with
  `via: 'form'`);
- `liveLinesByItem` — deleteItem's count of live lines;
- `changeItemsSeries` — the series move, generalised to every move of one save (the lead's condition: the
  single-item endpoint calls it with one move; 08n's and 08t's move scenarios stay green unchanged; every
  moved line keeps its own `LINE_SERIES_MOVED` row, every item its `OFFER_ITEM_SERIES_CHANGED` with the
  lines it moved).

**The locks, in RESERVATIONS.md §2.1's order** (the same order updateItem took before F6a):

1. **The students** of the live lines of every item whose sitting the form changes — `lockStudents`
   (`FOR NO KEY UPDATE`, id order), read before the locks and checked again under them
   (`withStudentsFirst`: a student found unlocked runs the transaction again with that student first;
   a fourth newcomer is the 409 `STUDENTS_KEPT_CHANGING`). §2.1 step 1.
2. **The session** `FOR SHARE` (`sessionForChange`; a closed session is refused).
3. **The offer** `FOR UPDATE` (`offerForChange`) — a writer's row at §2.1 step 4's place; a reservation
   takes the offer `FOR SHARE` and waits here.
4. **The subject's items** `FOR UPDATE`, all of them, in id order — §2.1 step 4 (writers `FOR UPDATE`).
5. **A sitting change** (`changeItemsSeries`, for all moves at once): the series rows `FOR SHARE` in id
   order (§2.1 step 3, taken after the items as updateItem and `insertLines` take them, so an item moved
   while a reservation waited is read again); the target series' fee grids **shared**
   (`lockFeeGrids`) and the fee rows the items will read there `FOR SHARE`, carried provisional where
   finance has none (`lockMoveFeeRows`, once for all moves — §2.1 "a move of lines"); then **every moving
   line `FOR UPDATE` in one statement, id order**; then their F4 entries (`entriesFollowMoveInTx`, after
   the lines); then the rechecks, the re-price, the open-checkout check and the audit rows.

A move of several items in one save takes every grid and fee row before any line, so no Confirm or
re-price holding a fee row and waiting for a line can close a circle with it (taking them item by item
would hold item A's lines while waiting for item B's grid).

**Only what differs is written.** The subject's answers are compared with the row (teachers in order
with their mode — an external team named for the first time is a change; course fee, availability,
grade-10 core, course start, notes trimmed), each item's (availability, fee, its own teachers when the
form shows them, its sitting by month and year — a labelled series of the same month is kept), and a
catalogue paper already made is not made again. A form that changes nothing writes nothing and no audit
row (`changed: false`) — a full form as the screen builds it included (08u, the review's finding 7).

**A paper made later joins the whole subject's group** (the review of F6a, finding 1, a blocker). A
paper the Catalogue gains after the subject is on the sheet is made with withOnePaper's draft, in the
exclusive group 'entry'; the whole item made when the Catalogue had no papers had no group (the template's
17 IGCSE subjects are so), so a family could reserve "All papers" and "Paper N only" for one sitting — two
charges, two entries. When the form makes the first such paper, every whole item of the subject with no
group joins the paper's group ('entry', or the whole item's own if one has a group) through
`changeItemInTx` (updateItem's logic: `OFFER_ITEM_UPDATED` with the reason "A paper of the subject is
offered on its own: all papers or that paper, not both"); the paper is then made in that group. The
Reserve page's untick and assertLineRules' group check both fire (08u test 2; the drive's
`review-05-family-physics-*`: ticking Paper 4 unticks All papers). Every write's audit row is written inside the transaction (`logAction(..., tx)`):
a refused audit row rolls the whole form back.

**Refusals, in the form's words.** What the services refuse, as they say it ("Who teaches …?", "… is
self-study only at a course fee of 0: say why …", "… has no course fee: set the school's course fee …",
a move's deadline, entry and checkout refusals); and the form's own:
`"<subject> has N reservation(s): it stands / they stand when it is not offered this cycle, and no new
one is taken. Tick "Its reservation stands" / "Its N reservations stand" to save"` (409) for a subject,
paper, unit or qualification set to not offered while it has live lines without `linesStand`; "A paper
or unit is named twice in the form" (an item id or a catalogue paper's unit id named twice: finding 6); "That paper or unit is not under this subject" (404); "That paper
is not one of this subject's papers on the Catalogue" (404); "<Month> is not a sitting of this
session"; a sitting change refused by the move, in the form's words since the review (finding 4): "<paper or
unit> has reservations past their deadline in the sitting it is entered in (<date>): their entries stand",
"A reservation cannot move to <sitting>: the board's entry / retake deadline there (<date>) has passed" (or
"…: its exams start on <date> and it has no entry deadline"), and F4's "… has already gone to the board in
…: withdraw its entries first". Each has its Arabic in `i18n-sessions.ts`.

**The one-paper rule** (the lead's decision of 11 Oct, answer 3). "One paper ONLY" on the forms is
always a retake: `assertLineRules` refuses a first entry on a `one_paper` item ("<subject> — <paper> is
a retake of one paper: it takes no first entry"; a rule, not a gate: no exception lifts it), and the
offers read lists no first entry for one. With it, "Retake self study only" on a paper is exactly
`self_study_only`. Before writing it the scenarios were searched: 08p asserts a first entry on a
retake-only paper is refused ("takes retakes only", reached first, unchanged); no scenario reserves a
first entry on a one-paper item. **F7's import plans the same** (the review's finding 3; `import/view.ts`,
the one import file changed): a one-paper line is always planned as a retake — staff's "first" on the line
does not change it, and the coordinator's answer no longer turns a self-study one-paper row with no sitting
into a first entry; such a row asks for its sitting ("\"<note>\": one paper only is always a retake — name
the sitting it follows on the line", code `retake_sitting_missing`, Arabic in `i18n-sessions.ts`) instead
of advising "…or make it a first entry". The school's June rows ("(Paper 41/42 ONLY) From June/November
2026") name their sitting and are unaffected.

**listOffers (GET /sessions/:id/offers) gains** `shares` (the three percentages the sheet shows),
per item its `qualification` (code, title, level) and per IGCSE offer `papersToAdd` (withOnePaper's
papers not on the sheet yet); an item's own teachers are listed in their order.

## 4. The preview read — `GET /v1/registrations/offers/preview?sessionId=`

Admin and coordinator (`requireRole`; the coordinator's grant added to `lib/role-grants.ts`); authz row
`GET /v1/registrations/offers/preview D D D D D A A D D` — its own path, not `?preview=true` on the
family read (the lead's answer 1: the matrix keys on method and path, and one route with two shapes
would make the Reserve component's types a union). `offersPreview(sessionId)` and `offersForStudent`
are one read (`readOffers(sessionId, studentId | null)`): with no student there is no eligibility (the
key is absent), no earlier sitting (`knownSittings: []`), no held line (`held: null`), the series'
deadlines without a student's late entry, and each price through `priceLine(…, { exceptionIds: [] })`
— the school's price with no family's exception (a first entry in school, a retake in school, a retake
in self study at the settings' shares). The boards' sittings of the last two years (`declarableSittings`)
are listed, as they are the sitting choices the family's form shows. 08u proves it carries no student's
id, name, parent, line or discount and is refused to a parent, a student and both finance roles.

## 5. The screens

Screenshots (`.audit/session-words-evidence/screens/`, JPEG, EN and AR): `before-*` on main 1b6a216's
web files against the same API and data, `after-*` on this branch.

| Screen | Before | After |
|---|---|---|
| The links sheet (June 2027) | `before-01-sheet-{en,ar}` | `after-01-sheet-{en,ar}`; the coordinator's `after-15-coordinator-sheet-{en,ar}` |
| The subject's form — O.L. with a paper (Biology) | `before-02-drawer-biology-{en,ar}` (two forms, two Saves) | `after-02-form-biology-{en,ar}-{a,b,c}` |
| — IAL per unit (Mathematics A.S./A.L.) | `before-03-drawer-ial-{en,ar}` | `after-03-form-ial-{en,ar}-{a,b,c}`; the winter session's sittings `after-11-winter-*` |
| — Cambridge A level routes (Physics A.S./A.L.) | — | `after-04-form-alevel-{en,ar}-*`; coordinator `after-15-coordinator-form-*` |
| — Arabic A.L. two qualifications | — | `after-05-form-arabic-al-{en,ar}-*` |
| — Retake (Self Study ONLY) (Chemistry) | — | `after-06-form-retake-self-study-{en,ar}-*` |
| — Not offered with a reservation | — | `after-08-not-offered-with-reservation-{en,ar}` |
| The six previews | — | `after-09-preview-{ol,ol-one-paper,retake-self-study,ial,a-level,arabic-al}-{en,ar}`; coordinator `after-15-coordinator-preview-*` |
| Add subject | `before-04-add-subject-{en,ar}` | `after-m1-*` (measured), `after-14-add-subject-ar` |
| The empty sheet | `before-05-empty-{en,ar}` | `after-13-empty-copy-{en,ar}`, `after-13-copied-{en,ar}`, `after-10-empty-winter-en` |
| The dates (Board Series page; the header's dialog) | `before-06-series-dates-{en,ar}` ("Why it changes") | `after-12-series-page-reason-{en,ar}` ("Reason"); `after-m3-dates-dialog-{en,ar}`, `after-m3-dates-saved-en`, `after-m3-dates-dialog-cambridge-en`; coordinator `after-15-coordinator-dates-*`; finance's header `after-16-finance-header-en` |
| The family's Reserve page | `before-07-register-{en,ar}` (session "Choose…") | `after-07-register-{en,ar}` (child and June 2027 preselected; "All papers"), `after-07-register-ticked-en` |

The desk's Reserve card is the same component: its rows show "All papers" too; nothing else changed.

## 6. Tests

`apps/api/test/08u-session-form.test.ts` (11 scenarios): an O.L. subject's teachers (one online) and
Paper 4 opened in school or self study at its fee, one save with an audit row for the subject and one for
the paper, then the preview's prices (a paper: retakes only); a paper the Catalogue gains after the
subject is on the sheet, made by the form once offered, the same form again making nothing, the same paper
named twice refused, and the whole subject joining the paper's group so that assertLineRules refuses "All
papers" and the paper together for one student (each alone passes); an IAL
subject per unit (a teacher per unit, two online, M1 with two, S1 self study only, P4 not this cycle) and
its preview; two units moved to January in one save with three reservations, every line and item with its
own audit row, and a unit whose reservation is past its deadline refused in the form's words; a Cambridge
A level's three routes; "Retake (Self Study ONLY)" at 0 refused without a
reason, an open subject nobody teaches refused, nothing half-saved; "Not offered this cycle" refused with
its sentence for a subject (2 reservations) and a paper (1), then saved with `linesStand`, the lines
standing; the same form twice (with an external team, the grade-10 core, a course start and notes)
changing nothing and writing no audit row, and a refused item audit row rolling back the subject's change
and its row; a full form as the screen builds it (units with their teachers and sittings, two
qualifications with theirs) saved as it stands changing nothing and writing no audit row; a first entry on a one-paper item refused and the family's read listing retakes only; the
preview for admin and coordinator with no student's data (a family with a 50% discount and a line in the
same subject), refused 403 to a parent, a student and both finance roles, 404 for no session. The authz
matrix (04) has both rows.

**Controls** (`.audit/session-words-evidence/controls/`, `controls.py`): each guard undone once, 08u red,
put back: the one-paper rule in assertLineRules; the one-paper rule in the read; the linesStand refusal
for a subject; for a paper; the form's diff; the subject's audit row in the transaction; each moved
line's audit row; the preview's role gate; the coordinator's grant. Then 08u green. The review round
(`controls2.py`): the whole item joining the paper's group (08u test 2 red at the pair: the rules let both
through), the import's one-paper retake (08n-import's new case red), the paper named twice (08u red: 200,
made twice), the item-level diff (08u red in two scenarios, the full-form case among them). Then 08u and
08n-import green. `08n-import.test.ts` gains the case "a one-paper line is always a retake".

## 7. The catalogue set-up for the six shapes (dev data; never a migration or a seed)

`igcse_template_dev` holds 17 Cambridge IGCSE subjects mapped to syllabus-option qualifications with no
options, no units and no teachers. On `igcse_words_dev`, through the API as the admin and a coordinator
(what the Team, Catalogue and Sessions screens do), scripts in `.audit/session-words-evidence/drive/`:

1. `setup-dev.mjs` — a coordinator (`coordinator.words@igcse.local`); teachers "Teacher A", "Teacher B",
   "Teacher C" (placeholders); **Biology 0610**: components 0610/21 "Paper 2" and 0610/41 "Paper 4"
   (unit level igcse, kind component) set required on its qualification (`PUT /catalogue/qualifications/:id/units`),
   so withOnePaper gives "Paper 2 only (retake)" and "Paper 4 only (retake)"; **Pearson IAL Mathematics**:
   the starter set (`POST /catalogue/starter {set: pearson_ial_mathematics}`) and a parent registrable
   row "Mathematics A.S./A.L." (pearson_edexcel, a_level — an AS row may not enter A2 units) mapped to
   WMA11–WMA14, WME01, WST01; **Physics 9702 (Cambridge A level)**: qualifications 9702 at as_level and
   at a_level (syllabus_option), options S1 "AS Level", BX "A2, carrying the AS forward" (carry forward),
   AX "A Level in one sitting", and a row "Physics A.S./A.L." (as_level) mapped to the AS qualification;
   **Arabic A level (Edexcel)**: qualifications YAA01 (IAL, units_cash_in) and 9AA0 (GCE, qualification)
   and a row "Arabic A.L." mapped to YAA01.
2. `setup-sessions.mjs` — June 2027 (open), November 2026 – January 2027 (upcoming) and June 2028
   (upcoming, empty); on June 2027 Arabic Language (three teachers), Biology (Teacher B online),
   Physics, Chemistry, Mathematics A.S./A.L., Physics A.S./A.L., Arabic A.L. — whose second
   qualification is made through the item endpoint (`POST …/items`, kind `qualification`, entering 9AA0,
   exclusive group `qualification`, Teacher B; the whole item relabelled "Arabic IAL (YAA01)" in the same
   group with Teacher A) since no screen adds a qualification yet (§11); board fees for the two June
   series (one Cambridge row provisional).
3. `setup-cs.mjs` — Computer Science 0478: components 0478/11 "Paper 1" and 0478/21 "Paper 2" required
   (for the one-paper measurement).
4. The rest through the screens in `after.mjs` and `drive-measure.mjs`: Cambridge June 2027's dates and
   Pearson June 2027's from the header's dialog (the template's Cambridge deadline had passed), each
   shape's form, a reservation by parent.hany for Arabic Language, Economics and Computer Science added.

## 8. The measurement (`.audit/session-words-evidence/measure-counts.json`)

| Task | Target | Step 4 (main 9edefbb) | F6a |
|---|---|---|---|
| An O.L. subject set up open with a teacher | ≤ 3 inputs, ≤ 3 clicks | 3 inputs, 3 clicks | **3 inputs, 2 clicks** (every teacher listed at once for an empty pool) |
| A one-paper retake opened | ≤ 3 more inputs, no extra screen | (a separate item card and Save) | **2 more inputs, 1 more click, no extra screen** |
| A series' deadlines | no page change | 6 inputs (the year filter and five fields: entry deadline, retakes until, exams start, exams end, the reason), 2 clicks, on another page | **met: no page change**. Like for like, the same five fields: **5 inputs, 2 clicks** (14 Oct). The 11 Oct run typed two dates and the reason (3 inputs) and is not comparable |
| The family reserves (point 5) | the only child and open session preselected | 2 answers by hand | **preselected** (2 answers saved) |

The dates, honestly (the review's finding 8): the dialog is the Board Series page's own `DatesForm`, so
the same fields cost the same inputs; what the header saves is the page change and the academic-year
filter (one input), not the typing.

The Excel version (UX_AUDIT §4): a row typed on the links sheet (subject, board, teachers, the form
link) and a Google Form copied and edited per subject (about 12 questions, the series and paper options
retyped, last year's left in on one form); the deadlines in someone's head. Here the row and the form are
one: three inputs for a taught subject, two more for a paper, the deadlines on the same screen, and the
family's form previewed from the row instead of built.

## 9. Gates

| Gate | Commit | Result | Evidence |
|---|---|---|---|
| API check-types (source and tests) | 0252b82, and again on the push | green | session log |
| web check-types | 0252b82, and again on the push | green | session log |
| API suite, local time (Africa/Cairo) | 0252b82 | 35 files, 735 passed, 1 todo | `.audit/session-words-evidence/suite-local-0252b82.log` |
| API suite, `TZ=UTC` | 0252b82 | 35 files, 735 passed, 1 todo | `suite-utc-0252b82.log` |
| API and web check-types, the review round | 717475e | green | session log |
| API suite, local time, the review round | 717475e | 35 files, 737 passed, 1 todo | `suite-local-717475e.log` |
| API suite, `TZ=UTC`, the review round | 717475e | 35 files, 737 passed, 1 todo | `suite-utc-717475e.log` |
| `useQuery<` generics in apps/web/app | — | 19 (ceiling 35) | — |

The commit after 0252b82 changes only the web (a unit's sitting sent only when changed; the sheet's
column "Entry options"), the Arabic dictionary, this document and the evidence: the API and its suite
are 0252b82's. CI on the pushed branch: run 38144972830 green on 9646092 (the progress log).

## 10. Decisions and why

- **The preview has its own path** (`/offers/preview`), its own authz row and role gate (lead, answer 1).
- **"All papers" is a display word** through `itemDisplayLabel`; the stored label stays (lead, answer 2).
- **A one-paper item is always a retake** — a rule in the read and in assertLineRules (lead, answer 3).
- **Closing what has reservations is said, not silent**: the form refuses it without "Its N reservations
  stand"; the old endpoints are unchanged (lead, answer 4).
- **Point 5**: the only open session is preselected beside upcoming ones; else the only upcoming one (lead, answer 5).
- **The series move takes every move of one save at once** (lead's condition: 08n and 08t unchanged and
  green; every line its own audit row).
- **A unit's sitting is chosen by month**: the session's months the board sits; the board's unlabelled
  series of that month is found or made (`findOrCreateSeries`, as an item's default series is); a
  labelled series of the same month is kept. A labelled target (a board's second calendar in one month)
  has **no screen behind it** since F6a: only the item endpoint (`PUT …/items/:itemId` with `boardSeriesId`)
  reaches one (§11).
- **"Add subject" is two steps of one form**: the subject is created by `POST /offers` (createOffer, the
  catalogue's items generated), then the same form stays open for its papers, routes and units, which
  exist only once the subject does. A taught O.L. subject needs nothing more.
- **A paper the Catalogue gains later** is listed (`papersToAdd`) and made when offered, so the form's
  "One paper only" never depends on when the components were set.
- **An empty pool shows every teacher at once**: a subject nobody has taught yet (the template's case)
  costs no "Show every teacher" click.
- **The empty sheet's "Copy from"** copies at once (one click) from the latest session of the same kind
  that has subjects; "Copy from…" (any session of the kind) stays in the header.
- **Attribution**: commits end with "Co-Authored-By: Claude Opus 5.5" — the model that wrote them (the
  session's attribution rule); the task's "Claude Fable 5.1" line was not used. The first local commit was
  re-made before any push (trail 13:16:41Z).

## 11. Deferred, and why

- **What the screens no longer offer** (the review's finding 2): the old drawer's item cards went with
  F6a, so these are **API-only now** (`POST/PUT/DELETE /v1/sessions/:id/offers/:offerId/items…`): "Add an
  item" (an item of any kind, entering an award, an option, units or the subject row), "Untick" (removing
  an item, or closing it when it has history), placing an item in a **labelled** series, an item's
  **exclusive group**, its **fee keys** (which fee rows it reads), "Required in a first entry"
  (`requiredInSeries`) and "Needs an earlier sitting carried forward" (`needsPriorSeries`, set by the
  catalogue's option or by withOnePaper). The state finding 1 found (a whole item with no group beside a
  paper in 'entry') **could not have been repaired by hand on any screen** after F6a — only the item
  endpoint could set the group; F6a now prevents it when the form makes the paper, and a paper made
  otherwise (the endpoint, an older drawer) is not regrouped by a later save. Which of these the school
  needs back on a screen is §12's question 4.
- **Adding a second qualification under a subject from the form** (Arabic A Level, Edexcel): the form shows
  and edits the qualifications and their teachers; making the second one is the item endpoint's
  (`setup-sessions.mjs`). A words-version waits for Q-16 (does the family or the teacher choose?).
- **The import's review screens** (F7's): their line plan carries an item's label without its kind, so
  "Whole subject" is not mapped there; F6 (the UI audit) or F7.
- **"(online)" on the family's Reserve rows** (teacher names) stays as the family page had it (point 5:
  nothing else there changes).
- **The Money tab's CSV header "Item"** (an export, not a screen) and the To verify tab's sentences
  (board-entry wording) are unchanged.
- **The whole item's own availability** is not on the form: the subject's "Offered as" governs it (an old
  whole item closed by hand stays so).

## 12. Questions for the owner (each with the default kept)

1. **"Retake (Self Study ONLY)" on the sheet**: the system also lets a family take a first entry in self
   study on a subject not taught this cycle (G-09, the untaught subject); the sheet's phrase says
   retakes only. Does the school ever take a first entry in self study on a subject it does not teach this
   cycle? Default: allowed, and the preview shows it as the family sees it ("First entry, self-study (not
   taught this cycle)").
   **Decided 16 Oct 2026** (FEATURES_PLAN.md §6, 1): refused — self study is a second entry only, on the subject and on a unit or route marked self study only, the A.2. carry forward excepted; the student's exception is the only way (CYCLE_DECISIONS.md §1).
2. **A unit's sitting in a winter session**: the form offers the session's months the board sits
   (Pearson: October, November, January). Should November be hidden for IAL units (Pearson sits IAL in
   October and January)? Default: every month the board sits.
   **Decided 16 Oct 2026** (§6, 2): a unit of a units-cash-in award sits in October, January or June — the form offers those and refuses another; an IGCSE subject keeps every month its board sits (CYCLE_DECISIONS.md §1).
3. **A second qualification under one subject** (Arabic A Level): who chooses — the family or the teacher
   (Q-16)? Default: the family, through the teacher (the form's sentence).
   **Decided 16 Oct 2026** (§6, 3): the family, through the teacher; each teacher option names its qualification ("Teacher A (Edexcel YAA01)") on the Reserve page and the preview (CYCLE_DECISIONS.md §1).
4. **The tools the old drawer had** (§11): adding an item of any kind, removing one, a labelled sitting,
   which items are one-or-the-other, which fee rows an item reads, an item required in a first entry.
   Does the coordinator need any of them on a screen, or is the catalogue's generation (and the form's
   papers) enough? Default: API-only, the coordinator asks the lead.
   **Decided 16 Oct 2026** (§6, 4): API-only — no change.

## 13. Progress log

- 11 Oct 12:31Z — worktree installed and built; igcse_words_dev made and migrated; env on 3151/3150.
- 12:39Z — five points sent to the lead; 12:40Z the lead's answers (trail).
- 12:59Z — the one-paper grep and rule; 08u green alone; the full suite green in local time on the API
  part (35 files, 735 passed, 1 todo).
- 13:11Z — before shots on main's web files; point 5 confirmed on the running system.
- 13:16Z — first commit 4659d59 (API, 08u, the web's first version).
- 13:33Z — measured; after shots EN and AR as admin, coordinator, parent, finance officer.
- 13:35Z — nine controls red, all back green.
- 13:40Z — commit 0252b82 (the dates in place, the preview's entry list, point 5, the document, evidence).
- 13:44Z / 13:50Z — the suite green in local time and with TZ=UTC on 0252b82 (735 passed each).
- 13:52Z — a unit's sitting sent only when changed (an item in a series outside the session's months
  keeps it; the winter form saved unchanged says "Nothing to change."); the sheet's column renamed
  "Entry options" (no "offers" on the screen); the sheet re-shot in EN and AR.
- 13:53Z — commit 9646092 pushed (feature/session-words: 4659d59, 0252b82, 9646092 on main 1b6a216).
- 14:06Z — CI run 38144972830 green on 9646092 (gate 0, both type-checks, the suite: 35 files).
- 14 Oct 20:43Z — the Opus 5.5 review: "merge after fixes 1"; eight findings.
- 20:51Z–20:57Z — findings 1 (the blocker), 6, 3, 4, 5 and 7 fixed with their scenarios; their controls
  red, then green (trail rows each).
- 20:58Z–21:02Z — the round's screens re-driven (Physics given its papers on the Catalogue and its Paper 4
  offered by the form; ticking it unticks All papers on the family's page; "Correct the sitting", the Fees
  copy dialog, "Subject · papers", in EN and AR); the dates measured like for like (5 inputs, 2 clicks, no
  page change); findings 2 and 8 in §8, §10, §11, §12 and measure-counts.json.
- 21:09Z / 21:14Z — the suite green in local time and with TZ=UTC on 717475e (737 passed each).
- 21:15Z — 190db19 pushed; 21:28Z CI run 38638884585 green on it.
- Next: the reviewer confirms the fix diff (b9f3090..190db19); the lead merges.
