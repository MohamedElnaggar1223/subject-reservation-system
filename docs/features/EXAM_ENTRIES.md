# F4 — Exam-entry management (as built)

Branch `feature/exam-entries`, started from `origin/main` e5da650 (F0a and F0b merged), frozen on
7 Oct 2026 at ec7689b and **resumed on 8 Oct on the reservations rework's model** (main 2a26557
merged at 1a3ba69; §2a says what changed and how each item of RESERVATIONS_REWORK.md §9 and §10
was checked). The plan is FEATURES_PLAN.md §1 "F4 — Exam-entry management", its §2 row and §5's
rules; the design basis is DISCOVERY_RESEARCH.md §2 (what a centre must do, per board) and §5
(notes 2, 4, 5, 6), DISCOVERY.md (Q-02 carry forward, Q-05 identifiers, F-07 the boards' files,
A-08 the hard stop) and IMPORT_SPIKE.md; since the rework, RESERVATIONS_REWORK.md §3, §9, §10 and
the steps' documents (docs/features/RESERVATIONS.md, RESERVATIONS_LINES.md, RESERVATIONS_MONEY.md).
It builds on the rework's lines (`lineItemsFor`, attempt, mode, prior sittings and their
verification), C's charges (`chargesOfKind`, `refundFor`'s seams), F0b's catalogue and board series
and course enrolment (`teacherOf`), and F0a's settings store, uploads, rooms and roles
(docs/features/FOUNDATION.md). The trail is `.audit/exam-entries.tsv`; evidence since the rework is
`.audit/exams-evidence/rework/` (force-added, nothing over 300 KB: migration proofs, suite
summaries, control logs, screenshots); September's evidence stays in the git-ignored
`.audit/exams-evidence/`. The progress log is the last section.

F4 makes the school an exam centre in the system: **who the boards' candidates are** (the name as
on the ID, date of birth, gender, Pearson's permanent UCI, a candidate number per series with
its history, and a national ID only the coordinator and admin can read); **what each candidate is
entered for** (per unit or award, derived from paid reservation lines and paid cash-ins, with option
codes, tiers, retakes, carry forward, forecast grades and access arrangements); **the boards' lists** (one row
per entry in each portal's fields, and a check of everything the board would refuse); **the exam
timetable and exam days** (papers, each candidate's timetable, clashes, rooms, seats,
invigilators, the boards' attendance registers, special consideration, the statement of entry);
**results** (a board's file read through a column mapping, every attempt kept, publication to
families); **certificates** (received, collected once, unclaimed ones kept for the retention
period); and **a deadlines dashboard** across every series. Nothing here takes or moves family
money: the board's fees are sentences; what F4 records ("mark as sent") is what C's `refundFor`
reads to decide whether a dropped line's board fee comes back.

---

## 1. Data model

Migrations `0050_exam_entries.sql` (structure, generated) and `0051_exam_entries_board_rules.sql`
(custom: each board's rules seeded from the research) — 0041 and 0042 on the frozen branch,
regenerated on main's journal after the rework's 0049 (each journal `when` later than 0049's; the
order proved on a copy of the template, `.audit/exams-evidence/rework/migrate-proof-copy.txt`), and
renumbered again when step D's land. All tables in `packages/db/src/schema.ts`, section "F4".

| Table | What it holds | Rules |
|---|---|---|
| `exam_board_rule` | per board: forecast required / fixed once sent; option code required; UCI required; candidate number fixed once entries are sent; amendments after the deadline (allowed with a fee, or refused) and from which date they cost a fee; up to which date a withdrawal is refunded; what the results file keys on (candidate number or UCI); notes. **The carry-forward period is the board's own column since the rework** (`exam_board.carry_forward_months`, step A, which the line rules read too): read beside these rules and edited through them | seeded for Cambridge, Pearson Edexcel, OxfordAQA (0051); the coordinator and admin edit it (audited, one row for both tables); a board with no row reads lenient defaults and says so |
| `exam_candidate` | per student: legal forenames and surname (as on the ID), date of birth, gender, UCI, approved access arrangements with the board's reference and expiry, notes | UCI unique and 13 characters of Pearson's shape (a check); a recorded UCI changes only with a reason (`CANDIDATE_UCI_CORRECTED`) |
| `exam_candidate_identity` | per student: national ID or passport, its number, who recorded it | **its own table**, read by one function; unique per (type, number); never in a list, a log or an audit row |
| `exam_candidate_number` | per student and board series: the four-digit number, the centre it was issued under, how it came (assigned, manual, import) | unique per (student, series) and per (series, number); fixed once an entry in the series has gone to a board that fixes numbers |
| `exam_entry` | one unit or award per candidate per series: board, registration (the line it was made from; null for an entry from a cash-in or added by hand), **cash-in charge (`charge_id`, the rework: the paid cash-in or late cash-in an award entry was made from)**, kind, unit or qualification, the code and title as entered, option code, tier, status (`draft`, `submitted`, `amended`, `withdrawn`), retake and why, carry forward (`none`, `suggested`, `confirmed`) with the source month and year, previous centre, previous candidate number and option type, forecast grade with who and when and when it was sent, access arrangements (null: the candidate's), the board's fee tier when sent, sent / amended / withdrawn with who, when, why, and the board's fee sentence | one live entry per (candidate, series, unit), per (candidate, series, award) and per cash-in charge (partial unique indexes); a unit entry has a unit, an award entry an award, an entry with a charge is an award (checks); a sent entry has its time; a withdrawn one its time |
| `exam_series_state` | per board series: when its timetable, forecasts and results went out (and the timetable's version) | |
| `exam_paper` | a series' timetable: code, title, the unit (component) it belongs to or an award with a tier, date, session (am, pm, ev), start, duration | unique per (series, code); times and durations checked |
| `exam_clash_note` | how a candidate's clash between two papers is handled | the pair ordered, unique per candidate |
| `exam_room_sitting` | a room used in a sitting (a date and session) with its seat grid (rows A–Z, seats 1–40) | unique per (date, session, room) |
| `exam_seat` | a candidate's seat in a sitting | **unique per (date, session, room, seat) and per (date, session, candidate)**: no seat double-booked, no candidate seated twice |
| `exam_invigilation` | a teacher in a room in a sitting, lead or not | one room per teacher per sitting (unique) |
| `exam_attendance` | the board's register as marked: per paper and candidate, present / absent / late (minutes), note, who | unique per (paper, candidate) |
| `exam_special_consideration` | per candidate and series (and paper): category, description, evidence (an upload, RESTRICT), status (draft, submitted, outcome received), board reference, outcome | |
| `exam_result_import` | one read of a results file: series, file, mapping, counts | |
| `exam_result` | a result as the board reported it: candidate, series, kind (unit or award), code, the matched unit or award and entry, grade, mark, source, import, provisional or published | **every attempt a row, and a board's later report of the same attempt another row beside it**: nothing is overwritten (RF-09) |
| `exam_result_mapping` | a saved column mapping per board, by name | unique per (board, name) |
| `exam_certificate` | per candidate and series: what it lists, received on, collected (when, by which member of staff, the collector's name and relation, the ID seen, the scanned signed slip), returned to the board or destroyed with a reason | one per (candidate, series); collected only once (a status-guarded update); the states' fields whole (checks) |
| `exam_deadline_reminder` | a reminder sent: series, date field, the date, days before | the primary key is the claim (ST-06, ST-12) |

**Settings** (F0a's store, `packages/validations/src/settings/settings.ts`), each editable by the
admin and the coordinator, audited:

| Key | Default | Stands for |
|---|---|---|
| `exams.centres` | none | the centre number with each board and the entry route, direct or through the British Council (Q-05) |
| `exams.carryForward` | `suggest` | whether an A Level entry after the candidate's AS of the same syllabus within the board's period is suggested as carry forward (Q-02: the coordinator's answer changes this, not code). Since the rework it applies only to a line with no prior sitting of its own whose item fixes no route: a line that carries a sitting forward is entered from it |
| `exams.selfStudyForecast` | `coordinator` | who gives a self-study candidate's forecast grade, or that none is asked for (IS-03) |
| `exams.certificateRetentionMonths` | 12 | how long an unclaimed certificate is kept (Cambridge: at least 12 months) |
| `exams.candidatesPerInvigilator` | 30 | one invigilator per this many candidates in a room |
| `exams.reminderDaysBefore` | 14 | when staff are reminded of a board date the school acts by (and again the day before) |

## 2. Entries

**Derived per component from paid reservation lines** (`deriveEntries`, preview then commit), by
what each line's item enters (`lineItemsFor`, §2a) and the award's entry method, and **from paid
cash-ins** (§2a):

| The line's item enters… | Entries made |
|---|---|
| a Cambridge syllabus (`syllabus_option`), whole | the award, with its option code when the syllabus has exactly one (else the coordinator chooses; the check flags it) and the tier the option's components share |
| a Cambridge syllabus's components (a paper set) | the award, with the option that enters exactly those components (else flagged) |
| Pearson units (a unit, a paper set) | one unit entry per W unit |
| a whole Pearson award (`units_cash_in`) | its required units and the cash-in; a choice group ("one of M1, S1, D1") is named for the coordinator to add |
| an International GCSE (`qualification`) | the award, with its option code if it has one |
| a subject not mapped on the Catalogue (a `subject` item of an unmapped row) | nothing — the preview says so and the entry list lists the line as unentered |
| a carry-forward option (Cambridge's A2 carried forward) or a one-paper retake that carries the rest | the award, carried forward from the line's prior sitting (§2a) |
| a paid cash-in or late cash-in (C's charge) | the award its line's item enters, with the charge; one whose line does not say the award is added by hand with it |

Retakes are flagged from the line's attempt (a rejected declaration is a first entry) or from
history (an earlier entry or result for the same unit or award). Carry forward comes from the
line's prior sitting where its item carries one forward (§2a); for a line without one it is
suggested (setting) for an A Level award after an AS entry of the same syllabus code within the
board's months, with the source series, the previous centre and candidate number, and the board's
carry-forward option code where the syllabus has exactly one; the coordinator confirms it
(`carry_forward_to_confirm` until then). A line that follows a declared sitting the school has not
verified is entered as declared, or held, as `verification.unverifiedAtDeadline` says.
Two commits at once run one after the other (an advisory lock per series) and the partial unique
indexes keep one live entry per unit or award (08x3). The coordinator can add an entry by hand (a
cash-in with no unit sat this series, the unit of a choice group).

**Statuses.** A draft changes freely. "Mark as sent" records the time the entries went to the
board (default now; an earlier time can be given) and the board's fee tier that day. A change to
what the board sees on a sent entry (option, tier, retake, carry forward) is an **amendment**: it
needs a reason; after the deadline the board's rule says whether it is taken
(`amendmentAfterDeadline`) and the answer carries the fee sentence; the entry becomes `amended`.
A **withdrawal** is allowed at any time; its answer and row carry what the board does with its
fee (a draft: nothing to pay; a sent entry: refunded up to the rule's date — the entry deadline as
an instant, or the late or high-late date — else kept). The family is told when an entry that had
gone to the board is withdrawn.

**MO-10's hard stop, per line since the rework.** No entry is made (derived or by hand) and no
draft is marked as sent at a time after its own deadline: its line's effective deadline (A's
`effectiveDeadlinesOf`: the retake deadline for a retake of the board's previous sitting, a late
board entry while Q-20's setting is on), its cash-in's service deadline, else the series' entry
deadline (`entryStopSentence`). A derivation past the series' entry deadline with no line still open
is refused with the series' sentence, as before. The series row is read `FOR SHARE` in the same
transaction, so a deadline change and a derivation run one after the other. 09 checks over every
row that no entry was made or sent after its own deadline.

**Forecast grades** (Cambridge requires them). Given by the teacher `teacherOf(student, subject,
the series' academic year, unit)` names — the enrolment of that unit since the rework — or by the
coordinator or admin; any other
teacher is refused (403, 05). A teacher's list holds only their own candidates. "Mark forecasts as
sent" fixes them where the board says so (Cambridge: a change after is refused). A self-study
candidate's forecast is the coordinator's or not asked for (setting).

## 2a. On the reservations rework's model (8 Oct 2026)

F4 was frozen on 7 Oct at ec7689b while the school's reservations were redone
(RESERVATIONS_REWORK.md: sessions, offers and items — step A; reservation lines with attempt,
mode, prior sittings and verification — B; charges, board services and the exceptions registry —
C). It resumed on 8 Oct on that model, exactly as the rework's §9 (the F4 bullet) and §10 (the F4
row) say. Main (2a26557) was merged first as its own commit (1a3ba69: 17 textual conflicts, each
in the trail row of 08:23:13Z), then the model was changed. How each §9 item was checked against
the code on main, what F4 does now, and the scenario that proves it (`08x4-exam-entries-rework`
unless said):

| §9 / §10 asks | On main (how it was checked) | F4 now | Proved by |
|---|---|---|---|
| entries derive from `lineItemsFor(registrationIds)` | **not on main**: `grep -rn lineItemsFor` found nothing; F0b's `entryItemsFor` read the *subject row's* units, wrong for an item (P1 and P2 under one Mathematics subject) | added to A's `line.services.ts` (the lead, 8 Oct): per line its item and what it enters — `award`, `option` (its components), `units` (under the item's award or a Cambridge component's syllabus), `subject` (the subject row's own mapping, so a converted item still derives) — the series and both deadlines, the attempt F4 enters (`first` after a rejected declaration) beside the one reserved, mode, the prior sitting with source, answer, previous centre and number, grade, level code. `planDerivation` reads it; F0b's `entryItemsFor` now reads it too | "two items of one subject are two lines…"; 08x1's derivation scenarios unchanged; control C18 |
| retake from `attempt` and history | `registration.attempt`, B's `declaration_rejected` (0045) | `isRetake` from the line's attempt (`retakeSource` 'registration'), else from an earlier entry or result here ('history'); a rejected declaration is a first entry | "a retake comes from the line's attempt; a rejected declaration is entered as a first entry"; C19, C19b |
| carry forward from the line's verified prior sitting with its previous centre and candidate number; suggest-and-confirm only for a line without one | B's `prior_sitting_series_id`, `prior_sitting_source`, `prior_sitting_verified_outcome`, `prior_centre`, `prior_candidate_number` (0041, 0045); B's `verifyPriorSitting` records the centre and number | an award entry of an item that carries a sitting forward (`needs_prior_series`, a carry-forward option) is `confirmed` from that series, with the previous centre and number when verified at another centre, else the school's centre and the candidate's number then; without a prior sitting on the line, the suggest-and-confirm flow (`exams.carryForward`) as before — only for an item that fixes no route | "a sitting at another centre, verified with its centre and candidate number…", "a sitting here…", "a line with no prior sitting of its own keeps the suggest-and-confirm flow"; C20, C20b |
| `exam_entry.charge_id` for a cash-in; `chargesOfKind('cash_in', seriesId)` | **not on main** under that name: C's `charge` (0047) has `kind`, `board_series_id`, `registration_id`, no award | `chargesOfKind(kind, seriesId)` added to C's `charge.services.ts`; `exam_entry.charge_id` (FK, one live entry per charge, award entries only). A **paid** cash-in or late cash-in becomes its award entry — the award its line's item enters (A's `item.qualification_id`), else the coordinator adds it by hand with the charge; one accepted but unpaid is listed "cash-in awaiting payment" (the lead, 8 Oct) | "accepted but not paid…", "paid: derived as the award its line's item enters…", "a cash-in that names no line…", "…payment is reversed is flagged"; C21, C22, C29, C33 |
| `teacherOf(student, subject, unit?, year)` | `teacherOf(studentId, subjectId, year)` on main; A made enrolment per unit (0041, `course_enrolment.unit_id`) | `teacherOf(…, unitId?)` with `pickEnrolment` in `enrolment.services.ts`: the unit's own enrolment, else the subject's, else the one teacher of all its units; forecasts and the check read entries' teachers the same way | "the forecast's teacher is the one who teaches that unit…"; C28, C5 |
| `exam_board_rule.carry_forward_months` moves to `exam_board` | A added `exam_board.carry_forward_months` (0041, Cambridge 13 in 0042); line rules read it (`gate.priorSeries`) | F4's column is gone (regenerated 0050); the board rules read and edit `exam_board`'s, audited; so the coordinator's period is the one the line rules refuse with | "the carry-forward period is the board's own column…"; C30 |
| a declared, unverified sitting is listed by the entry check and entered or held by the setting | B's `verification.unverifiedAtDeadline` (`enter_as_declared` default, `hold`) and `holdUnverifiedAtDeadline` | the check flags `prior_sitting_unverified` (entered as declared) or `prior_sitting_held`; under `hold` derivation leaves the line out ('held') and "mark as sent" refuses its entry; the entry list lists such a line beside its subject | "entered as declared (the default)…", "held when the school holds unverified sittings…"; C25, C31, C32 |
| F4's verification of a result against a declared sitting closes it | B's `verifyPriorSitting` (verification.services); B's doc §9: "F4 adds its source there" | a committed results import verifies every open declared sitting of that series whose student has a result there for what the line enters, through B's own answer (the importer, the result as evidence); a sitting with no result is left to the coordinator | "the board's results verify a declared sitting…"; 09's rule; C24 |
| F4's "mark as sent" makes a line's board fee "sent" for refunds (C's `refundFor`) | C's seam `entrySentAt(executor, lineId)` returned null; `refundFor` falls back to the effective deadline | wired: the earliest time any entry made from the line was marked sent, withdrawn ones included (the lead, 8 Oct); `refundFor` and the preview carry `sentEntries` and a `boardNote` naming them and when; C's `withdrawEntry` seam in the desk-drop now withdraws the line's entries in its transaction | "a two-unit line with one unit sent…" (preview 1,500 → 500, drop refunds 500), "…with none sent: the board fee comes back in full" (1,500), "the desk drops a paid line past its deadline…"; C23, C27 |
| MO-10's hard stop per line (§3.3) | A's `line_effective_deadline`, `effectiveDeadlinesOf` (Q-20 included) | each line is cut off at its own deadline (a retake of the board's previous sitting at the retake deadline); a cash-in at its service's deadline; else the series' entry deadline; making (derived or by hand) and sending alike; 09's rule reads the same | "past the entry deadline a retake of the board's previous sitting is still entered and sent…"; 08x1's hard-stop scenarios unchanged; C1, C1b, C2, C26, C26b |

### The review of 093dbd1 (8 Oct 2026)

The Opus 5.5 reviewer re-ran the gates on 093dbd1, confirmed the thirteen claims and asked for two
fixes before the merge, with nine more items from the lead. What each now does (every scenario is
`08x4`'s; every control is in `.audit/exams-evidence/rework/controls.py`):

| Item | Now | Proved by |
|---|---|---|
| 1. an entry sent after its line was dropped and refunded | **every path that ends a paid line withdraws its live entries in its own transaction**, by F4's `withdrawEntriesOfLineInTx` (each entry `withdrawn_with_line`, audited, the family told after the commit when it had gone to the board): the desk's drop, the family's drop, a drop or swap request's approval, the family's swap, a payment's reversal, step B's rejection after the first-entry deadline and its `hold` drop. "Mark as sent" takes the entries' lines `FOR SHARE` (id order) and their cash-ins `FOR SHARE` before the entries (§2.1) and refuses, with a 409 naming the entry, one whose line is not confirmed or whose cash-in is not paid. An entry withdrawn with its line is made again if the line is paid again (one withdrawn by the coordinator is not) | "every other path that ends a paid line…" (approval of a drop and of a swap, the direct swap, the reversal and the second payment), the two refund scenarios (the family's drop), "a declared retake rejected past the first-entry deadline…", "step B's hold…", "a paid cash-in whose award…reversed, it is flagged and not sent", "\"mark as sent\" refuses an entry whose line is no longer confirmed"; C34–C41 |
| 2. an entry never follows an answer given after it was made | `lineDiff(entry, what the line says now)`: the check compares retake, carry forward (series), and a sitting at another centre's centre and candidate number with the line, and flags `retake_differs_from_line` or `carry_forward_differs_from_line` (the coordinator amends a sent entry); a derivation brings a **draft** up to date (`refresh`, audited `EXAM_ENTRY_UPDATED`); a declared sitting not verified is carried forward as **suggested**, confirmed once verified; a rejected one loses its carry forward and its carry-forward option | eight scenarios under "an entry follows its line's answer given after it was made" (before and after derivation, verified and rejected, retake and carry forward, draft and sent); C45–C47 |
| 3. a result on record is a known sitting | at declaration, inside the reservation's transaction (B's `reserveLines`), a declared sitting with a real grade on record for what the line enters is verified at once through B's own answer (`recordVerifiedInTx`), the one who imported the result answering; the session's To verify tab has "Check against the results on record" (`POST /v1/exams/results/verify-declared`), verified by the coordinator who asks. B's `knownSittingsOf` reading F4's results and sent entries is B's (the lead gives it to B) | "a retake declared after its sitting is on record is verified at once…", "…the To verify tab's check answers it later"; C48, C49 |
| 4. a refund priced before the line is locked | the desk's drop, the family's drop, a request's approval and the family's swap take the receipt, then the line `FOR UPDATE`, and only then price with `refundFor(tx, …)`: a "mark as sent" landing meanwhile is counted (the board fee kept). The desk's drop has no window in practice (it needs the line's deadline passed, and sending needs it not), so its race is not staged | "a refund is priced after the line is locked…" (the direct drop, a drop request's approval, the direct swap, each with "mark as sent" held at its audit row inside its transaction); C42–C44 |
| 5. the hold sweep always counted the board fee not sent | `neverSent` only when `sentEntriesOf` is empty: a line entered as declared, sent, then held keeps its board fee; the family's notice says the entry was withdrawn and the board fee stays | "step B's hold at the deadline…" (one line sent, one a draft); C53 |
| 6. a paid cash-in whose award is already entered is never linked | the derivation links it (`link`): the award entry of a whole-award line, or one added by hand without a cash-in, takes the charge (audited); the entry list stops listing the cash-in ("Derive it" while it waits); its reversal is flagged and stops the entry being sent | "a paid cash-in whose award a whole-award line already entered…", "…whose award was entered by hand without it…"; C54 |
| 7. verifying from results is loose | only a real grade verifies (not absent, pending, withheld: `isRealGrade`); the one who answers is the importer (or the coordinator asking from To verify, with their own role); a failure after the import commits is counted and reported — "Results saved; the verification of n declared sittings failed — answer them on the session's To verify tab" — never a failed import | "an import verifies … with a real grade, as the one who imported them…", "a verification failing after the import commits…"; C50–C52 |
| 8. recorded, no change | see §10: "withdrawn included" keeps the family's board fee when the board refunded the school; a paid line the school never entered keeps its board fee on a desk drop past the deadline (C's decision 4) | — |
| 9. cosmetic | C's `entrySentAt` stand-in removed (`refundFor` reads `sentEntriesOf`, the one seam); the withdrawal audit row's key is `withLine` (every path now). The line's retake word as the source when history says retake too was undone by the review of 426d565 (item 3): the history stays the source | C55 (now the history's) |
| 10. F4's Arabic rules before the rework's | F4's dictionary now loads after A's, B's and C's (a shared word keeps the rework's Arabic: "Session", "Dropped", "Collected"); F4's sentence rules still run before F0b's broad one, but never on a text one of the rework's rules translates; the broad rules narrowed ("… results" needs a series' month and year; "… was withdrawn from …" an entry code and a series; the room's "no longer in use" names the room; the file store's sentences their own kinds); F4's timetable says "Time of day" for a paper's morning or afternoon. A scan of every string outside F4's files found one text F4 took that was not its own (C's escrow sentence); now none | the Reserve, statement and To verify screens driven in Arabic (`screens/review-*`); the trail's row for the order |
| 11. privacy | the evidence note below | — |

### The review of 426d565 (8 Oct 2026)

The reviewer re-ran 426d565 (585 passed), confirmed all eleven items above and found one deadlock,
in derivation; "merge after: 1, 2, 3 (with 4 and 5 in the same pass; 6 at the merge)". Item 6 is
the final merge's (main after D's 0055; F4's migrations as 0056 and 0057).

| Item | Now | Proved by |
|---|---|---|
| 1. a unit line verified by an award's result | an award's result is evidence of a sitting of the line only when the line enters that award itself (an award, option or unmapped-subject item) or the award is entered by syllabus option (Cambridge reports per syllabus per series); a line of units of an award cashed in by units (Pearson's P1 under the IAL) needs its unit's result | "an award's result verifies a line that enters the award, never a unit line…"; C56 |
| 2. a line moved to another series strands its entries | every path that moves a line — the admin's move (`moveRegistrations`), an item's series change (`changeItemSeries`), a subject's board change (`applyBoardChange`) and, the same rule, a session's series correction (`correctSessionSeries`) — calls `entriesFollowMoveInTx` after its lines are locked: a line with an entry already sent refuses the move ("… has already gone to the board in …: withdraw its entries first", naming it), because the board has it; otherwise its drafts are withdrawn with the line (`withdrawn_with_line`) and the next derivation makes them in the series it went to | four scenarios under "a line moved to another series…"; C57–C60 |
| 3. a retake the history shows unticked after a rejection; staff's values brought back | a retake when the line or the history says so, the history kept as the source when both do (the review of 093dbd1's item 9 undone): a rejected declaration never unticks a retake the school's records show. What staff set by hand — a retake ticked or unticked, a carry forward or its numbers, an option — is recorded on the entry (`exam_entry.staff_set`) and a derivation never compares or brings it back | "a retake the candidate's history here shows stays one…", "a coordinator's untick on a draft stays…", "another centre's candidate number typed by hand on a draft stays…"; C55, C61, C62 |
| 4. the 09 rule's second clause; entries on unpaid lines | the clause is dropped (not an invariant between a second payment and the next derivation, nor after a coordinator's withdrawal); an entry by hand on a line not paid is refused (409); a derivation and an entry by hand take the lines FOR SHARE after the series, so one racing a drop waits for it and enters nothing on the dropped line | "an entry by hand on a line not paid is refused", "a derivation racing the family's drop of the line…"; C63, C64 |
| 5. derivation's deadlock with "mark as sent" | the drafts a derivation brings up to date and the entries it links are locked in one statement in id order before any is changed, as "mark as sent" and every withdrawal take entries | 08t "a derivation bringing drafts up to date while they are marked as sent…"; C65 |
| 7. the verification at declaration attributed to the importer | the one acting is the one declaring (the reservation's actor: the desk, a parent, a student), as `prior_sitting_verified_by` and on the audit row; the reason names the result, who imported it and when — for a family, no person since the review of 54c225f (below) | "a retake declared after its sitting is on record is verified at once, by the one declaring it…"; C48, C52 |

### The review of 54c225f (8 Oct 2026)

The reviewer re-ran 54c225f (596 passed), confirmed the six items above, found no deadlock, and
gave "merge after: 1, 2". The lead's list, before the final merge:

| Item | Now | Proved by |
|---|---|---|
| 1. after a move, the old series' send still counted | `sentEntriesOf` counts only the entries of the series the line is in now: a move is the school's act, and the old series' entry was withdrawn for it — the lead's "withdrawn included" narrowed to the line's own series (§10) | "a sent entry withdrawn so its line could move: dropped in the new series before anything is sent there, the board fee comes back"; C66 |
| 2. a family recorded as verifying its own declaration | at declaration the declarer answers only when they are staff; a family's declaration names no person (`prior_sitting_verified_by` null, the audit row's user null) and is marked `answeredFrom: 'results_on_record'`, the reason naming the result, its importer and the day; the To verify tab shows "The results on record"; B's 09 rule "answered by someone" accepts that mark | "a family's own declaration the results on record show is verified with no person as its answerer…"; C67 |
| 3. staff's values lost on a re-made entry | a derivation that makes again an entry withdrawn with its line (after a reversal and a second payment, or a move) carries over what staff had set and the mark; an option chosen on an entry added by hand is staff's | "…carried to the entry made again after a second payment", "…carried to the entry made in the new series", "an option chosen on an entry added by hand is staff's"; C68, C69 |
| 4. a line moved back | §11 | — |
| 5. the request context; the correction's refusal | the item's series change and the board change pass the request's context to the withdrawals of their move (the subject form's route now passes it too); the session's series correction refuses with a typed `SessionError` (409), its route honouring the status | the move scenarios |
| 6. the trail's estimated time | a correction row with the relay's time from the lead's log (14:05:05Z) | `.audit/exam-entries.tsv` |

**What else changed with the model.** The test world (`exam-helpers.ts`) is a winter session with
offers and items (an award item for the Cambridge syllabus, a units item for P1, an award item for
the whole Pearson award), fee grids per series, and families reserved and paid at the desk with
`lines` and `consent`; every F4 scenario of September runs on it unchanged except where a sentence
named a registration. The demo seed (`scripts/exams-demo/seed-exams.ts`) builds the same shape on
the template's data, with a declared self-study retake that June's results verify, a declared unit
retake left unverified, and a paid cash-in. The deadlines dashboard shows the retake deadline as an
instant (the hard stop for a retake of the previous series), as A made it.

## 3. The entry list and its check

`GET /v1/exams/entry-lists?boardSeriesId=`: one row per live entry with the **board portal's
fields in the portal's order**, what each row is missing, the paid lines with no entry (a held
one says so) and the paid cash-ins with no entry. The boards' own files are not in hand (DISCOVERY.md F-07), so **every column is marked
assumed** (`ENTRY_LIST_COLUMNS`, `packages/validations/src/exams/exam-entry.validations.ts`) until
the coordinator checks it against the board's template:

| Board | Columns (assumed) |
|---|---|
| Cambridge International (Direct entries) | Centre number · Candidate number · Candidate name (as on ID, SURNAME, Forenames) · Date of birth (DD/MM/YYYY) · Gender (M/F) · UCI (optional) · Syllabus code · Option code · Tier · Retake (Y/N) · Previous centre number · Previous candidate number · Carried forward from (series) · Forecast grade · Access arrangements |
| Pearson Edexcel (Edexcel Online / EDI basedata) and any other board | Centre number · Candidate number · UCI · Surname · Forenames · Date of birth · Sex (M/F) · Entry code (unit, cash-in or qualification) · Option · Tier (F/H) · Resit (Y/N) · Series · Estimated grade · Access arrangements |

The check flags, per entry: no centre number for the board (Settings); no candidate number in the
series; no legal name; no date of birth; no gender; no UCI where the board requires one; no option
code where the board requires one; no tier on a tiered syllabus; no forecast grade where the board
requires one; carry forward incomplete or still to confirm; the registration no longer confirmed;
access arrangements without a board approval or expired; **a declared earlier sitting not verified**
(entered as declared, or held — the fix links the session's To verify tab); **a cash-in no longer
paid** (its payment reversed or refunded); **the line's answer changed after the entry was made**
(its retake, or its carry forward — series, centre, candidate number, option — the line says
otherwise now: amend the entry; a draft is brought up to date by the next derivation). The screen downloads the rows as CSV
(formula-safe, `lib/csv.ts`).

## 4. The timetable and exam days

- **Papers** are pasted from the board's timetable as a table (tab- or comma-separated, the first
  line the headings): the columns are guessed from the headings and can be chosen; dates are read
  as 2026-10-12, 12/10/2026, "12 October 2026" or an Excel date; times as 09:00, 9.00 or 1:30 pm;
  durations as 90, 1:30, "1h 30m" or "2 hours". The preview says per line new, changed, unchanged
  or what is wrong, and which catalogue unit or award it belongs to (by code; Pearson's
  "WMA11/01" is unit WMA11). Keyed by paper code, a second paste changes nothing and a corrected
  one changes only what moved. Papers can be entered and changed one by one.
- **Which papers an entry sits:** a unit entry its unit's papers; an award entry the components
  its option code enters (else the award's required components of its tier), or the award's own
  papers when the board lists the syllabus only; a Pearson cash-in none.
- **A candidate's timetable** counts their extra time (25% or 50%) in each end time. **A clash** is
  two papers of one candidate overlapping on a day — across boards and series (a Cambridge paper
  and a Pearson paper the same morning) — and the coordinator notes how it is handled.
- **Publication** shows each candidate their statement of entry and timetable and tells them and
  their parents (first time "ready", after that "changed"); a paper moved after publication tells
  its candidates' families.
- **A sitting** is a date and session across every board. Its rooms (F0a's rooms) get a seat grid;
  "seat everyone" places the candidates without a seat, candidates of one paper together in
  candidate-number order, row by row; a seat can be changed; the database refuses a double-booked
  seat. A room holding candidates cannot leave the sitting or shrink under them.
- **Invigilators** (teacher records): one room per sitting each; the screen shows the invigilators
  a room needs (the setting). A teacher sees their own duties and keeps the register of their own
  room only.
- **The boards' attendance registers**: per paper (and room), candidate number, name as on the ID,
  seat, access arrangements; marked present, absent or late (minutes); printable.
- **Special consideration**: per candidate and series (and paper), with evidence (a supporting
  document uploaded for that student), sent to the board with its reference, outcome recorded.

## 5. Results and certificates

- **Results import with a mapping** (the boards' files are unconfirmed, F-07): the file is uploaded
  as an import file (F0a uploads; .xlsx or .csv) or pasted. The mapping says the shape — **long**
  (a row per result: Pearson's results file) or **wide** (a row per candidate, a column per
  syllabus: Cambridge's broadsheet) — the header row (broadsheets carry a title block), the column
  naming the candidate and whether it holds the candidate number in the series or the UCI, and the
  code, grade and mark columns (long) or the result columns (wide, whose headings start with the
  code). Without one, the board's saved mapping is used, else a guess from the headings. The
  preview says per line: new, unchanged (the same file again), a revision (the board reported
  another grade for the same attempt), an unknown candidate or an unknown code. The commit is one
  at a time per series and idempotent; it can save the mapping under a name.
- **Every attempt is kept**: a unit sat in June and again in January is two rows, and a revised
  report is a third beside the first. **Which grade is of record after a remark is the owner's
  open question (RF-09)**: nothing here decides it.
- **Publication** makes a series' results visible to families (and tells them), and gives each
  registration with no grade yet the board's grade (its award's, or its only unit's, the latest
  report), so the existing results screen and the remark flow read it. A registration that already
  has a grade keeps it; the answer lists them.
- **Certificates** are received for a series (by default every candidate with a published result),
  families are told to collect; handed over once at the desk with the collector's name, relation
  and the ID seen, and a printed slip to sign (its scan can be attached); a second hand-over is
  told who took it. Unclaimed past the retention period, one is destroyed with a reason; returned to
  the board at any time with a reason.

## 6. Roles and endpoints

Every endpoint is in `apps/api/test/authz-policy.tsv` for all nine principals (04 probes each);
`lib/role-grants.ts` grants the coordinator `* /v1/exams/*` and the teacher the five endpoints
below; the gate reaches nothing here.

| Endpoints (under `/v1/exams`) | Principals |
|---|---|
| `candidates…`, `candidate-numbers…`, `board-rules…`, `entries` (list, add, derive, submit, change, withdraw), `forecasts/submit`, `entry-lists`, `papers…`, `clashes`, `timetable/publish`, `sittings…`, `seats`, `invigilation` (set), `special-consideration…`, `results…`, `certificates/receive`, `certificates/:id/dispose`, `deadlines` | admin, coordinator |
| `candidates/:studentId/identity` (GET, PUT) — the national ID | admin, coordinator; each read audited (`CANDIDATE_IDENTITY_VIEWED`, without the number) |
| `entries/:id/forecast`, `forecasts`, `invigilation/mine`, `registers` (GET, PUT) | staff; the handler allows a teacher only their own candidates (`teacherOf`) and the room they invigilate |
| `students/:studentId/series`, `/timetable`, `/statement`, `/exams`, `/results`, `/sittings` | the student themself, a linked parent (published only), and staff with student records (desk, coordinator, admin); another family's child is "not found" |
| `certificates`, `certificates/:id/collect`, `certificates/:id/slip` | desk (finance officer, finance admin), coordinator, admin |

One endpoint was added on the rework's model, after the review of 093dbd1: `POST
results/verify-declared` (`{ sessionId }`; admin, coordinator) — the session's declared sittings
still awaiting an answer checked against the results on record, from the To verify tab. Otherwise
the answers grew: an entry by hand takes an optional `chargeId` (a paid cash-in of that candidate
in that series); a results import answers `sittingsVerified`, `verificationFailed` and
`verificationNote`; a derivation `updated` and `summary.updates` (drafts brought up to date, cash-ins
linked); the entry list `cashInsToEnter` (with `awardEntered`); the refund preview (C's)
`sentEntries` and `boardNote`.

**The national ID.** Its own table; set and read through two endpoints for the coordinator and the
admin; each read audited without the number; lists, the candidate's page and entry lists carry
only whether one is recorded (and its last four characters on the candidate's page); the audit
row of a change says only that it changed; writing it catches the driver's error itself (a failed
query's message carries its parameters and would reach the console) — 08x1 spies the console
through a duplicate and 09 checks that no audit row holds any recorded number.

## 7. Contracts for later features

| For | Contract | Where |
|---|---|---|
| **F2** (campus leave), **F3** (attendance) | `getExamsFor(studentId, date)` — the papers a student sits on a school date (YYYY-MM-DD, Cairo), across every board and series: `{ paperId, code, title, entryId, boardSeriesId, seriesName, date, session, startTime, endTime, durationMinutes, extraMinutes, room, seat }[]`, end times counting the candidate's extra time; withdrawn entries left out (a family view: only entries gone to the board). F3 excuses the lessons these overlap; F2 warns a leave request. Also `GET /v1/exams/students/:studentId/exams?date=` | `exam-timetable.services.ts` |
| **F5** (pathway advisor) | `getSittings(studentId)` — every sitting recorded here, per series and unit or award: `{ boardSeriesId, series: { month, year, label, name, sitting, academicYearStart, academicYear }, boardCode, boardName, kind, code, title, subjectArea, level (an award's igcse / as_level / a_level, or a unit's own igcse / as / a2), tier, entryId, entryStatus, isRetake, grade and mark (the board's latest report), reports[] (every report, latest first), remarks[] (the remark requests on its registration with each paper's outcome), gradeOfRecord: null }`. **`gradeOfRecord` is always null** until the owner answers RF-09; entries without results yet are included (`grade` null). Also `GET /v1/exams/students/:studentId/sittings` | `exam-result.services.ts` |
| F2, F3, F5 | the candidates, entries and results tables above | schema |

**Provided on the rework's contracts** (RESERVATIONS_REWORK.md §10's F4 row; not on main under these
names, added as the smallest pieces with the lead's agreement of 8 Oct, and noted in A's
RESERVATIONS.md §2.12 and C's RESERVATIONS_MONEY.md §10):

| Contract | Where | What |
|---|---|---|
| `lineItemsFor(registrationIds, executor?)` | A's `line.services.ts` | per line what its item enters (award; option with its components; units under the item's award or a Cambridge component's syllabus; a `subject` item: the subject row's own mapping), the series with both deadlines, the attempt F4 enters (`first` after a rejected declaration) and the one reserved, mode, teacher, the prior sitting (series, name, source, declared, answer, previous centre and number), the board's carry-forward months, grade, level code. F0b's `entryItemsFor` reads it now |
| `chargesOfKind(kind, seriesId, executor?)` | C's `charge.services.ts` | a series' accepted charges of a kind (awaiting payment or paid) with each one's deadline |
| `teacherOf(student, subject, year, unitId?)`, `pickEnrolment(rows, unitId?)` | `enrolment.services.ts` (F0b's) | the unit's own open enrolment, else the subject's, else the one teacher of all its units |
| `sentEntriesOf(executor, lineId)` | C's seam in `refund.services.ts` (the stand-in `entrySentAt` removed after the review of 093dbd1) | the entries made from the line marked sent, earliest first (withdrawn ones included): the earliest one's time is when the board fee became sent; `refundFor` and `previewRefund` carry `sentEntries` and a `boardNote` |
| `withdrawEntriesOfLineInTx(tx, lineId, reason, actorId, ctx?)`, `tellWithdrawn(withdrawn, reason)` | `exam-entry.services.ts`, called by every path that ends a paid line (the review of 093dbd1, item 1) | the line's live entries withdrawn in the path's own transaction, after its receipt and line, each `withdrawn_with_line` with its `EXAM_ENTRY_WITHDRAWN` row; the family told after the commit of each that had gone to the board |
| the calls, file by file | `desk-drop.services.ts` `deskDrop` (C's seam `withdrawEntry`); `swap.services.ts` `executeDirectDrop`, `approveChangeRequest` (a drop or a swap request), `executeDirectSwap`; `payment.services.ts` `reversePayment` (each reverted line, in id order); `verification.services.ts` `verifyPriorSitting` (the rejection after the first-entry deadline) and `holdUnverifiedAtDeadline` (the `hold` drop) | one call each, after the path's drop leg in its transaction, and `tellWithdrawn` after its commit; the four drops and swaps price their refund with `refundFor(tx, …)` after the receipt and the line are locked (item 4); the hold drop passes `neverSent` only when `sentEntriesOf` is empty (item 5) |
| `verifyDeclaredSittingsFromResults(series, actor, ctx?)` | `exam-result.services.ts` → B's `verifyPriorSitting` | after a results import commits: each open declared sitting of that series with a **real grade** for what its line enters is verified by step B's own answer, the importer answering; a failure is counted (`verificationFailed`), never thrown |
| `verifyDeclaredAtDeclarationInTx(tx, lineIds, actorId)` | `exam-result.services.ts`, called by B's `reserveLines` (`reservation.services.ts`, with the reservation's `requestedBy`) → B's `recordVerifiedInTx` (`verification.services.ts`, the verified answer as a function of its own) | in the reservation's transaction, a declared sitting with a real grade on record is verified at once by the one declaring it (`prior_sitting_verified_by` and the audit row; B's 09 rule: answered by someone), the reason naming the result and who imported it; an award's result only for a line that enters the award, or a Cambridge syllabus |
| `entriesFollowMoveInTx(tx, lineIds, reason, actorId)` | `exam-entry.services.ts`, called by `series.services.ts` `moveRegistrations`, `offer.services.ts` `changeItemSeries`, `catalogue.services.ts` `applyBoardChange` and `session.services.ts` `correctSessionSeries`, each after its lines are locked (the review of 426d565, item 2) | a line with an entry already sent refuses the move (the sentence returned for the path's own 409 — the subject form's route answers 400); otherwise the line's drafts are withdrawn with it, made again by the next derivation where it goes |
| `verifyDeclaredOfSession(sessionId, actor)` | `exam-result.services.ts`; `POST /v1/exams/results/verify-declared`; B's To verify tab (`to-verify-tab.client.tsx`, one button) | the session's awaiting declared sittings checked against the results on record, verified by the coordinator who asks |

## 8. Screens

All under `/exams`, in the nav of the roles that use them (`components/nav-shell.tsx`); each page
guards its own roles on the server. Strings are English in the code and Arabic through
`lib/i18n-exams/` (one dictionary per area, loaded after the rework's A, B and C so a shared word
keeps theirs; its sentence rules before F0b's broad ones, but never on a text a rework rule
translates — the review of 093dbd1, item 10); board names, codes,
candidate numbers and people's names are marked `data-i18n-skip` and stay as written. Each file's
header comment gives its spreadsheet version in full; the short form is below. Every screen was
driven in headless Chrome as its role in English and Arabic (`.audit/exams-evidence/screens/`,
`lead-*` for the lead's pass; the family's at 390 px). The only English left on an Arabic page is
"UCI", the board's own term.

| Screen | Who | The spreadsheet version | Here |
|---|---|---|---|
| **Deadlines** `/exams/deadlines` | coordinator, admin | each board's key-dates PDF pinned by the desk; to know what is left, count blanks in three sheets and ask finance | every board's dates in order, today marked, days left; each date counts what is outstanding live and links to the screen that fixes it; the entry deadline carries its time (the hard stop) |
| **Candidates** `/exams/candidates` | coordinator, admin | a candidates sheet with names retyped from ID photocopies, one column of numbers per series, national IDs readable by anyone with the file; blanks found by filtering each column | one searchable table; each gap a board refuses is one filter with its count; a row opens in place; a UCI changes only with a reason; the national ID shows its last four, the full number for 30 s on request (audited); "Assign candidate numbers" keeps last series' numbers and previews before saving |
| **Entries** `/exams/entries` | coordinator, admin | a sheet per series typed from the confirmed registrations; option codes looked up in the syllabus PDF; the retakes and carried sittings remembered from the forms' notes; cash-ins found in the receipt book; a "sent?" column; fees for withdrawals looked up in the handbook | derived from the paid reservations and cash-ins in one click with a preview that says, per line, what its item enters, the sitting it follows and whether it is verified, and why a line is held, past its deadline, awaiting its cash-in's payment or needing its award chosen; option and tier chosen from the syllabus's own; a paid cash-in whose line does not say the award added by hand with it; what the board would refuse beside each row; sent or withdrawn in bulk, with the board's fee shown before and after; a change after sending asks why; past the entry deadline the screen says only a retake of the previous series is still entered, until the retake deadline |
| **Entry lists** `/exams/entry-lists` | coordinator, admin | the entry sheet copied into the board's template column by column; problems learnt from the portal's rejection report | rows already in the portal's columns (marked assumed), each with what the board would refuse and a link to fix it (a declared sitting not verified links the session's To verify tab); download of the ready rows; paid reservations with no entry listed with the fix (a held one says why), and paid cash-ins with no entry; the board's rules on the same page — the carry-forward period now the board's own — changed with a reason |
| **Forecast grades** `/exams/forecasts` | teacher (own candidates), coordinator, admin | grades emailed back by teachers and retyped into the portal; chasing by memory | the teacher's own candidates by series and subject, due date and days left, saved on leaving the box; a grade the level does not use refused at once; the coordinator sees who gave each and marks a series sent |
| **Timetable** `/exams/timetable` | coordinator, admin | the board's PDF copied by hand; clashes found with a ruler, extra time forgotten; families phoned when a paper moves | the board's table pasted as it is, columns recognised; each line new / changed / unchanged / wrong before saving; clashes for every candidate across boards with extra time, each with how it is handled; Publish tells families, a moved paper tells only those who sit it |
| **Exam days** `/exams/days` | coordinator, admin | the hall drawn on squared paper, registers copied per room, a rota on the wall, consideration requests in an email folder | a card per sitting with candidates, seated and invigilators per room; "Seat everyone" with a preview (separate-room candidates listed to seat by hand); a desk for two refused by the database, naming who sits there; registers print per paper and room; special consideration per candidate and paper with its evidence |
| **Invigilation** `/exams/invigilation` | teacher | the rota on the wall, the register ticked on paper and typed up hours later | the teacher's own duties; the register of their room per paper; "All present", then a tap for absent or late; saved at once; another room refused by the API |
| **Results** `/exams/results` | coordinator, admin | each grade found by candidate number in the broadsheet and typed across; a remark overwrites the first grade | the file uploaded or pasted, read through a mapping saved per board (guessed the first time, shown beside the first rows); every line says what it will do before saving; nothing overwritten; one Publish per series |
| **Certificates** `/exams/certificates` | desk (finance officer, finance admin), coordinator, admin | envelopes in a box, a notebook of who took which; two officers can hand the same one twice | name or student ID then Enter opens the certificate ready to hand over; collector, relation and the ID seen (a choice); a printable slip to sign, its scan attachable later; a second desk is told who took it; unclaimed past retention listed to return or destroy with a reason |
| **My exams** `/exams/my` | student, parent (published only); the desk and coordinator with `?student=` | the statement of entry handed out in class and lost; papers highlighted on the board's PDF; the seat on a list at the hall door; results as a photo in a group chat | on the phone: the next exams first with end times counting extra time, room and seat, clashes with how they are handled; the statement of entry as sent, with one line to check it; results once published, a changed grade beside the earlier one |

**The evidence's people** (the review of 093dbd1, item 11). The committed screenshots
(`.audit/exams-evidence/rework/screens/`) and the drive's output (`drive/f4-drive.out`,
`f4-drive-held.out`) show the demo seed's people — legal names, dates of birth, UCIs and candidate
numbers. They are the repository's own fictional seed (`scripts/exams-demo/seed-exams.ts` and the
template it builds on), not real families, teachers or students, so they stay. Nothing from the
school's own sheet or forms appears in them, in the tests or in the seed, and none may.

The Settings screen shows the exam settings (centre numbers and entry route per board, carry
forward, self-study forecasts, certificate retention, candidates per invigilator, reminder days)
in their own group. The student record links to the student's exams, and for the coordinator and
the admin to their candidate details.

## 9. Tests

`08x1-exam-entries`, `08x2-exam-days-results`, `08x3-exam-races`, `08x4-exam-entries-rework` (with
`exam-helpers.ts`: a school of every role, a catalogue per suite tag, since the rework a winter
session whose offers' items enter that catalogue, fee grids per series, families reserved and paid
at the desk with lines and consent), cases in `05` and rules in `09`. Every September scenario of
08x1–08x3 and 05 runs on the new model unchanged (its world only is built differently).

| Scenario (FEATURES_PLAN §1 F4) | Test |
|---|---|
| entries derived from registrations per component | 08x1 "a preview says what each registration enters; the commit makes each entry once", "a Cambridge syllabus is entered as the award…" |
| an entry list flagging a missing forecast grade | 08x1 "flags a missing forecast grade (Cambridge requires one) and every other gap; the teacher of the subject fills it" |
| a new entry after the deadline refused (MO-10) while a withdrawal after it is allowed with the board's fee shown | 08x1 "past the deadline a new entry is refused, and a draft cannot be sent; a withdrawal is allowed with the board's fee shown", "an amendment after the deadline follows the board's rules…", "Pearson refunds a withdrawn entry up to its high-late date…" |
| an exam clash flagged | 08x2 "each candidate's own timetable, extra time counted; a clash across boards flagged…" |
| a seating plan without double-booked seats | 08x2 "a sitting is seated room by room…; no seat holds two candidates"; 08x3 "two coordinators put two candidates in the same free seat at once" |
| a results import with a mapping, keeping two attempts | 08x2 "a results file read through a mapping; every attempt kept…", "Cambridge's broadsheet (Excel…)" |
| a certificate collected once (a race test) | 08x3 "a certificate collected at two desks at once"; 08x2 "collected once at the desk…" |
| national IDs hidden from roles without the need | 08x1 "national IDs … read only by the coordinator and the admin…"; 05; 09 |

**On the rework's model** (`08x4-exam-entries-rework`, 56 scenarios: §2a's tables — 18 of them
for the rework's items, 23 for the review of 093dbd1, 10 for the review of 426d565 and 5 for the
review of 54c225f, listed after them — and one race in `08t-rework-races`):

| §9 / §10 item | Scenario |
|---|---|
| entries from `lineItemsFor` (the item, not the subject row) | "two items of one subject are two lines, each entered as its own unit with its own line" |
| `teacherOf(…, unit)` | "the forecast's teacher is the one who teaches that unit (teacherOf with the unit): the P1 teacher gives P1's, not P2's" |
| retake from the attempt; a rejected declaration a first entry | "a retake comes from the line's attempt; a rejected declaration is entered as a first entry" |
| `carry_forward_months` on `exam_board` | "the carry-forward period is the board's own column (exam_board), edited on the board rules and read by the line rules" |
| carry forward from the verified sitting with its centre and number | "a sitting at another centre, verified with its centre and candidate number, is carried forward with them"; "a sitting here, verified without another centre…" |
| suggest-and-confirm only without a prior sitting | "a line with no prior sitting of its own keeps the suggest-and-confirm flow (exams.carryForward)…" |
| a declared, unverified sitting listed, entered or held | "entered as declared (the default): the check lists it as declared, unverified"; "held when the school holds unverified sittings: not derived, not sent; verified, it goes" |
| the result verifying a declared sitting | "the board's results verify a declared sitting (step B's answer, by the importer); a sitting with no result is left to the coordinator" |
| a cash-in entry carrying its charge | "accepted but not paid: listed as 'cash-in awaiting payment', not entered"; "paid: derived as the award its line's item enters, with exam_entry.charge_id"; "a cash-in that names no line: the coordinator adds its award by hand, with the charge"; "a cash-in whose payment is reversed is flagged on its entry" |
| mark as sent → the board fee sent for `refundFor` | "a two-unit line with one unit sent: the board fee stays, the course part by the policy…" (preview 1,500 before: 50% of the 1,000 course fee plus the 1,000 board fee; 500 after; the drop refunds 500); "the same line with none sent: the board fee comes back in full" (1,500) |
| MO-10 per line; the desk-drop's withdrawal | "past the entry deadline a retake of the board's previous sitting is still entered and sent, until the retake deadline; a first entry is not sent"; "the desk drops a paid line past its deadline: its entries are withdrawn with it…" |
| review item 1: every path that ends a paid line withdraws its entries | the two refund scenarios (the family's drop: both units withdrawn, the sent one told); "a drop request the parent approves…"; "a swap request the parent approves…"; "the family's direct swap…"; "a payment reversal: … paid again, the next derivation makes it again"; "a declared retake rejected past the first-entry deadline is dropped…"; "step B's hold at the deadline…"; "\"mark as sent\" refuses an entry whose line is no longer confirmed, naming it" (the state made by hand: no path leaves it now) and, for a cash-in, "…reversed, it is flagged and not sent" |
| review item 4: the refund priced under the line's lock | "a refund is priced after the line is locked…": the family's direct drop, a drop request's approval, the family's direct swap — "mark as sent" held at its audit row (`pauseAtAudits`) with the line `FOR SHARE`, the path queued behind it (`lockWaiters(2)`), then released: the board fee kept, the entry withdrawn as sent |
| review item 2: the entry follows the line's answer | a retake rejected after it was sent (flagged, left alone), after its draft (brought up to date, audited), verified after (nothing); a carry forward declared (suggested), verified at another centre after (flagged, then the centre and number), verified here after (confirmed), rejected before (a first entry, no option), rejected after (the draft loses carry forward and option; a sent one is flagged) |
| review items 3, 7, 9: results | "an import verifies the declared sittings it shows with a real grade, as the one who imported them; absent and pending verify nothing"; "a retake declared after its sitting is on record is verified at once, by the importer…" (with the retake source the line's); "a verification failing after the import commits reads as results saved; the To verify tab's check answers it later, as the coordinator" |
| review item 5: hold and a sent entry | "step B's hold at the deadline…": the sent line keeps its board fee, the draft's gets it back, both withdrawn |
| review item 6: a cash-in linked to its award | "a paid cash-in whose award a whole-award line already entered is linked to that entry…"; "a paid cash-in that names no line, whose award was entered by hand without it, is linked to that entry" |
| review of 426d565, item 1 | "an award's result verifies a line that enters the award, never a unit line of an award cashed in by units" |
| review of 426d565, item 2 | "the admin's move…", "an item's series change…", "a subject's board change…", "a session's series correction…": each refused while a line has a sent entry (named), and, once it is withdrawn, moving the lines with their drafts withdrawn and made again where they went |
| review of 426d565, item 3 | "a retake the candidate's history here shows stays one after the declaration is rejected…", "a coordinator's untick on a draft stays…", "another centre's candidate number typed by hand on a draft stays…" |
| review of 426d565, item 4 | "an entry by hand on a line not paid is refused"; "a derivation racing the family's drop of the line: it waits for the line and enters nothing on the dropped line" (the drop held at its audit row with the line) |
| review of 426d565, item 5 | 08t "two drafts brought up to date as both are sent: the send waits for the derivation, nothing deadlocks" (the derivation held at its first update with its entries locked; the students named so its rows' order and the ids' cross) |
| review of 54c225f, items 1-3 | "a sent entry withdrawn so its line could move: dropped in the new series … the board fee comes back"; "a family's own declaration the results on record show is verified with no person as its answerer…"; "what staff set … carried to the entry made again after a second payment", "… carried to the entry made in the new series", "an option chosen on an entry added by hand is staff's" |
| review of 426d565, item 7 | "a retake declared after its sitting is on record is verified at once, by the one declaring it…" (the desk officer on the row and as the verifier; the reason names the admin who imported the result and the day) |

Races (08x3): two derivations, two numberings, a withdrawal against an amendment, one seat for two
candidates, two results imports, a certificate at two desks, two scheduler instances, a failed
reminder retried. 05: another family (every student-scoped endpoint "not found", staff endpoints
refused), another class (a teacher refused another teacher's candidate's forecast and another
room's register), the gate (nothing). 09: no entry made or sent after its own deadline (its line's
effective deadline, its cash-in's, else its series' entry deadline — and there was a retake entered
and sent between the two); an entry is its registration's student's in its series, a result its
entry's; an entry from a cash-in is an award of that charge's student in its series, one per charge;
a declared sitting verified from results had a result there; one withdrawal and one hand-over audit
row each; no seat double-booked, no candidate seated twice, no invigilator in two rooms; no national
ID in an audit row.

**Negative controls**, re-run on the rework's model (`.audit/exams-evidence/rework/controls.py`;
one trail row each; logs — the vitest summary and the failing tests with their messages — in
`.audit/exams-evidence/rework/controls/`): each guard undone once, its tests red, restored. C1–C17
are September's guards on the new code (C1, C2 now the per-entry deadline; C8 the index in 0050);
C18–C33 the rework's, C34–C55 the review of 093dbd1's, C56–C65 the review of 426d565's, C66–C69 the review of 54c225f's (the table below them). September's logs stay in the ignored
`.audit/exams-evidence/controls/`.

| Control | Undone | Red |
|---|---|---|
| C1 | the hard stop on making an entry (derived and by hand) | 08x1; 09's MO-10 rule |
| C2 | the hard stop on sending a draft | 08x1 |
| C3 | the national ID read opened to all staff (route and service) | 08x1 |
| C4 | the national ID write lets the driver's error (with the number) through | 08x1 |
| C5 | the forecast's `teacherOf` check | 08x1, 05 |
| C6 | the entry list's missing-forecast flag | 08x1 |
| C7 | clash detection | 08x2 |
| C8 | the database's one-candidate-per-seat index (0041) | 08x2, 08x3 |
| C9 | the certificate hand-over's status guard | 08x3 (the race), 08x2 |
| C10 | results: a line compared with the latest report | 08x2 |
| C11 | derivation's advisory lock and conflict guard | 08x3 |
| C12 | numbering's advisory lock | 08x3 |
| C13 | an entry's row lock (withdraw against amend) | 08x3 |
| C14 | a reminder's notices sent before its claim, outside the transaction | 08x3 |
| C15 | a parent's link to the child (family endpoints) | 05 |
| C16 | a teacher's register limited to the room they invigilate | 08x2, 05 |
| C17 | the entry list sorted by the entry's own code (put back: a column Cambridge's list lacks) | 08x1 |
| C1b | derivation's per-line cut-off (a line past its own deadline entered) | 08x4 |
| C18 | `lineItemsFor` reading the subject row's units instead of the line's item | 08x4 |
| C19, C19b | the retake from the line's attempt; a rejected declaration read as a first entry | 08x4 |
| C20, C20b | carry forward from the verified sitting's previous centre and number; from the line's prior sitting at all | 08x4 |
| C21, C22 | a cash-in entered only once paid (derived; by hand) | 08x4 |
| C23 | `refundFor`'s seam `entrySentAt` wired to "mark as sent" | 08x4 |
| C24 | the results import verifying declared sittings | 08x4 |
| C25, C31 | a held line not sent; not derived | 08x4 |
| C26, C26b | the line's own deadline (the retake deadline) in derivation; in sending | 08x4 |
| C27 | the desk-drop withdrawing the line's entries (`withdrawEntry`) | 08x4 |
| C28 | `teacherOf` with the unit | 08x4 |
| C29 | the database's one-live-entry-per-cash-in index (0050) | 08x4 |
| C30 | the carry-forward period written to `exam_board` | 08x4 |
| C32, C33 | the check listing a declared unverified sitting; a cash-in no longer paid | 08x4 |
| C34 | "mark as sent" refusing a draft whose line is not confirmed or whose cash-in is not paid | 08x4 |
| C35–C40 | the entries withdrawn by the family's drop; a request's approval; the family's swap; a payment reversal; B's rejection after the first-entry deadline; B's hold drop | 08x4 |
| C41 | an entry withdrawn with its line made again once the line is paid again | 08x4 |
| C42–C44 | the refund priced after the line's lock: the family's drop; a request's approval; the family's swap | 08x4 (the races) |
| C45, C46, C47 | the check comparing an entry with its line now; a draft brought up to date; a declared sitting carried forward as suggested until verified | 08x4 |
| C48, C49 | a sitting on record verified at declaration; the To verify tab's check | 08x4 |
| C50, C51, C52 | only a real grade verifies; a failure after the import reported, not thrown; the importer answers | 08x4 |
| C53 | the hold drop's board fee by "sent" | 08x4 |
| C54 | a paid cash-in linked to its award already entered | 08x4 |
| C55 | the history kept as a retake's source when the line says retake too (the review of 426d565, item 3; it was the line's until then) | 08x4 |
| C56 | an award's result verifying only a line that enters the award, or a Cambridge syllabus | 08x4 |
| C57–C60 | a line's entries following its move: the admin's move; an item's series change; a board change; a series correction | 08x4 |
| C61, C62 | staff-set values never compared nor brought back; a change by hand recorded as staff-set | 08x4 |
| C63, C64 | no entry by hand on a line not paid; derivation holding the series' paid lines | 08x4 |
| C65 | derivation locking its entries in one id-ordered statement | 08t |
| C66 | "sent" only in the line's own series | 08x4 |
| C67 | a family's declaration answered by no person | 08x4 |
| C68, C69 | staff's values carried to a re-made entry; an option chosen by hand recorded as staff's | 08x4 |

## 10. Decisions and why

- **Board rules are data** (`exam_board_rule`), seeded from the research with what is not in it
  marked "assumed": the coordinator's answers and the boards' handbooks change rows, not code
  (owner decision 3).
- **The national ID has its own table** so no `select *` of candidates can carry it, and one
  function reads it.
- **The hard stop covers sending as well as making**: a draft marked as sent after the deadline is
  a late entry at the board. The time it went can be given, so a school that sent on time and
  recorded late is not refused.
- **Withdrawal fees are sentences, not money**: the board's fee is between the school and the
  board; what the family is refunded stays the drop and refund flows' (IS-08, MONEY_AUDIT).
- **Results are never overwritten** (RF-09): a revised report is a new row; publication fills a
  registration's grade only where none is recorded.
- **A sitting spans boards**: rooms, seats and invigilators belong to a date and session, because a
  Cambridge and a Pearson paper the same morning share the hall.
- **The .xlsx reader is the import spike's, hardened** (a size cap on each inflated part, part,
  row and cell limits) rather than a new dependency: F1 and F7 share the lockfile in parallel.
- **Deadline reminders claim and send in one transaction** per reminder, so a failure leaves no
  claim and the next tick retries; one series' failure does not stop the others.

On the reservations rework's model (8 Oct 2026; the trail's build rows of 09:05Z and 09:37Z):

- **The contracts §10 named but main did not have are the smallest pieces in their owners' files**
  (`lineItemsFor` in A's line.services, `chargesOfKind` in C's charge.services, the unit on
  `teacherOf`), agreed with the lead before they were written, and noted in A's and C's documents.
  A `subject` item (every converted line, and the suites' own) enters the subject row's catalogue
  mapping, so a line converted from a window still derives its entries.
- **"Sent" is the earliest entry of the line marked sent**, withdrawn ones included (the lead): the
  board fee is one amount per line in `refundFor`, so a partly sent line is a sent line; the
  preview and the drop's notice name the entries sent and when, so the desk can explain it.
- **A cash-in is entered once paid** (the lead): the award its line's item enters (A's
  `item.qualification_id`, an award cashed in by units), else by hand with the charge; one
  accepted and not paid is listed "cash-in awaiting payment" in the preview and not entered. A
  cash-in's entry is cut off at its service's deadline (C's `board_service_deadline`), else the
  series' entry deadline.
- **The hard stop is per line, for making and for sending alike**: the line's effective deadline as
  A computes it (`effectiveDeadlinesOf`, Q-20's late entry included). A derivation is refused only
  when the series' entry deadline has passed and no line is still open, with the series' sentence
  as before; otherwise the rows past their deadline are listed and not made.
- **Held means not entered**: under `hold` derivation leaves a declared, unverified line out and
  "mark as sent" refuses its entry already made; the check flags it either way, and its fix is the
  session's To verify tab. The setting stays B's and the admin's.
- **Results only verify**: a result for what the line enters, in the declared series, verifies the
  sitting through B's own answer (its locks, its audit row, the importer as the one who answered,
  the result as the evidence), after the import commits, each line in its own transaction. A
  missing result rejects nothing: results files are partial (F-07) and the coordinator answers.
- **The carry-forward period has one home**, `exam_board.carry_forward_months`; F4's board rules
  read and edit it there (one audit row), so the period the coordinator sets is the one the line
  rules refuse a declared sitting with.
- **The suggest flow stays for a line with no prior sitting whose item fixes no route** (a whole
  A Level award): a route the family chose (A Level in one series, A2 carried forward) is never
  overridden by a suggestion.
- **The desk-drop withdraws in its own transaction** (after the receipt and the line, MA-16's order;
  the entries `FOR UPDATE` after the line), so a drop never leaves a live entry behind and a failed
  drop withdraws nothing; the family is told of each withdrawal after the commit.

After the review of 093dbd1 (8 Oct 2026):

- **Every path that ends a paid line withdraws, not only the desk's.** One call in each path's own
  transaction, after its drop leg, so the board is never sent an entry the family is no longer
  paying for; and "mark as sent" refuses one whose line or cash-in is no longer paid, as the
  backstop. An entry so withdrawn carries `withdrawn_with_line`: a line paid again (a reversal
  undone by a second payment) is derived again, while an entry the coordinator withdrew is never
  made again. Withdrawing a sent entry from the board is still the coordinator's act there; the app
  records it and says what the board does with its fee.
- **A sent entry is flagged, a draft is changed.** The line's answer can come after the entry
  (a sitting verified or rejected later). What the board has is not changed by the app: the check
  asks the coordinator to amend it. A draft has not gone, so the next derivation brings it up to
  date, audited. A declared sitting's carry forward is a suggestion until it is verified.
- **Prices after locks.** A path that ends a line prices its refund only once it holds the receipt
  and the line; "mark as sent" holds the line `FOR SHARE` — so the two serialize and the price sees
  whichever came first.
- **A result on record answers a declaration at once**, in the reservation's transaction, through
  B's own verified answer with the importer as the one who answered (B's 09 rule: answered by
  someone). Only a real grade is evidence of a sitting.
- **A move takes the drafts and refuses the sent** (the review of 426d565): an entry is made for one
  series. A line that moves before its deadline takes its drafts away with it (made again where it
  goes), but an entry the board already has is the board's: the school withdraws it there first,
  so the app refuses the move and names the entry rather than leave the board with two.
- **Staff's hand beats the line's answer** (the review of 426d565): a coordinator who unticks a
  retake or types another centre's number knows something the line does not; the derivation and
  the check leave such values alone (`staff_set`), as they leave a retake the history shows.
- **The one who declares answers at declaration — when staff** (the reviews of 426d565 and
  54c225f): the importer was not acting then; the desk's declaration is checked in the desk's name.
  A parent or a student never answers their own declaration: no person is recorded, the row says
  the school's results on record answered it, and the reason says whose import was the evidence.
- **"Sent" is the line's own series** (the lead, the review of 54c225f, narrowing "withdrawn
  included"): an entry of the line marked sent counts, withdrawn or not, only in the series the line
  is in now. A move is the school's act and the old series' entry was withdrawn for it, so a family
  dropping the line in its new series before anything is sent there gets the board fee back.
- **Staff's values follow a re-made entry** (the review of 54c225f): an entry withdrawn with its
  line and made again (a second payment, a move) takes what staff had set on it, with the mark.
- **Recorded, no change (the lead, item 8).** "Withdrawn included" keeps the family's board fee even
  when the board refunded the school for an entry withdrawn in time: the board fee is one amount per
  line, sent once any entry of it went. A paid line the school never entered keeps its board fee on
  a desk drop past the deadline (C's decision 4: past the line's deadline it counts as sent).

## 11. Deferred, and why

- **Each board's real formats.** The entry-list columns, the results files and the broadsheet
  mapping are assumed from the boards' public documents (every screen and file says so) until the
  coordinator shares a portal template and a past results file (§12 q4, F-07). Mappings are data,
  so the correction is a saved mapping or a column list, not a rewrite.
- **Submitting to the portals.** The boards take entries through their own portals (Direct,
  Edexcel Online or Pearson's EDI files); the app sends nothing to them, so the entry list is a
  file and "sent" is recorded by the coordinator.
- **Money.** Nothing here takes or moves a family's money (the plan's rule): the board's fees are
  shown as sentences; a family's refund for a withdrawal stays with the drop and refund flows.
- **The grade of record after a remark** (RF-09): every report is kept and `gradeOfRecord` is
  null; nothing decides until the owner answers.
- **The Arabic hydration error on every page.** The nav shell renders English on the server and
  Arabic on the client (its language comes from local storage), so React reports a mismatch on
  every Arabic page, the exam pages included (also `/notifications`, untouched here). It predates
  F4 and is the app shell's; the pages render correctly after it. The English mismatch the
  translator caused on Suspense pages was fixed here (`localizeDom` records an attribute's source
  in English only once Arabic needs it).
- **Word collisions in the Arabic dictionaries.** A few words ("Session", "Withdrawn", "Grade",
  "Dropped", "Collected") are translated by earlier features' dictionaries in their own sense; the
  rework's keep theirs (F4's dictionary loads after them), and the exam pages use longer phrases
  where it matters ("Time of day" for a paper's morning or afternoon).
- **The published count** after a revised report counts each report row, so a series with a
  remark says one more than its candidates' grades. The families see the latest grade either way.
- **The entry-list CSV carries no "assumed" line** (a portal import would reject it); the screen and
  this document say the columns are assumed.
- **The Entries screen after a deadline** was photographed with the series' responses changed in
  the browser (`entries-after-deadline-MOCKED-*.png`, named so); no demo series has passed its
  deadline yet. The refusal itself is the API's and is proven by 08x1 and control C1.

On the reservations rework's model (8 Oct 2026):

- **An F4 result as a `known` sitting on the Reserve page** (§3.5: "known — an earlier line or an
  F4 result"): F4's side is built (the review of 093dbd1, item 3): a declared sitting with a real
  grade on record is verified at declaration, and the To verify tab checks the awaiting ones. B's
  `knownSittingsOf` reading F4's results and sent entries — so the family's Reserve page pre-sets
  the retake — is B's, and the lead gives it to B once F4 lands.
- **A line moved back** to a series where its sent entry was withdrawn for the move (the review of
  54c225f, item 4): that entry was withdrawn by the coordinator, not with the line, so a derivation
  does not make it there again; the coordinator adds it by hand (with the board, it is a new entry).
- **Migration numbers**: 0050 and 0051 follow main's 0049; step D's migrations land first, so they
  are renumbered once more at the final merge (a journal `when` later than D's last).
- **The demo seed's new shapes** (a carried-forward A2 at another centre, an unpaid cash-in, a
  declared retake verified by June's results) are for the screens; the template's own converted
  session closed on 30 Sep, so the seed opens a new winter session labelled "exams demo".

## 12. Questions for the owner (through the coordinator)

1. The centre numbers with each board, and whether the school enters directly or through the
   British Council (Q-05) — the `exams.centres` setting.
2. Carry forward (Q-02): are the A2 rows' notes Cambridge carry-forward entries? The setting
   `exams.carryForward` suggests them today.
3. Forecast grades for self-study candidates (IS-03): the coordinator's, or none?
4. Each board's portal template, results file and broadsheet (F-07): the entry-list columns and
   the results mappings are assumed until checked.
5. Cambridge's rule for an entry withdrawn after the deadline (assumed: the fee is kept), and
   OxfordAQA's rules (not researched).
6. Which grade is of record after a remark (RF-09): results keep every report; nothing decides.

## 13. Progress log

- 2026-09-30 02:44Z — started on `feature/exam-entries` from origin/main e5da650; read the plan
  and the read-first documents; dev database `igcse_exams_dev` from the template.
- 03:21Z — schema (0041, 0042), validations, services, routes, authz rows (c2039ea); 08x1
  (1c45e1c); baseline suite green at c2039ea (22 files, 308 passed).
- 03:38Z — 08x2, 08x3, 05 and 09 (a53e161, 079a955, 5eb605c); gates green at 5eb605c (25 files,
  350 passed, 1 todo; local time and UTC); branch pushed.
- 03:40Z — running system on API 3043 (3041 is held by another project's server) and web 3040;
  demo data through the API (`apps/api/scripts/exams-demo/seed-exams.ts`).
- 03:55Z — web foundation (a2c1151): exam pages guard their own roles; shared fetchers; nav for
  staff, the desk, teachers and families; Arabic plumbing; Settings shows the exam settings (and
  F0b's catalogue setting, which had no group on the screen).
- 03:49Z–04:22Z — this document, FEATURES_PLAN §2 and §7, the test README; controls C1–C16 red
  once each and restored (bb7b45b); the student record's links (5f88fc5). Screens built by three
  helpers (Opus 5.5) in parallel, each driving its screens against the running system.
- 05:09Z–05:46Z — the helpers' reports fixed in the API with a test each: the entry list's sort
  (733678e, control C17), seating, timetable paste and moved-paper counts (6999b82), tiers,
  withdrawn re-derivation, forecasts (3d71097), statements, result titles, the slip after the
  hand-over, the collector's ID as a choice, certificates received for award results (7c75112).
- 06:00Z — the lead's drive of every screen as each role in English and Arabic (family at phone
  size); the translator's English hydration mismatch on Suspense pages fixed; screens and
  dictionaries committed (bf17f59); §8 and §11 written.
- 06:05Z — gates green at 5d338a5: api and web check-types; the suite in local time and in UTC
  (25 files, 353 passed, 1 todo; `.audit/exams-evidence/suite-{local,utc}-5d338a5.log`).
- 2026-10-07 — frozen at ec7689b (CI green on 53fd152) while the reservations were redone.

On the reservations rework's model (8 Oct 2026, UTC; the trail has a row per step):

- 08:10Z — resumed by the Opus 5.5 implementer; read CLAUDE.md, RESERVATIONS_REWORK.md §3, §6, §9,
  §10, the steps' documents A, B and C, FEATURES_PLAN §4, §5, §7, this document and its trail. Git
  from lead-env only, with plumbing (a temporary index, commit-tree, update-ref).
- 08:23Z — main 2a26557 merged as its own commit (1a3ba69): 17 conflicts resolved by hand, the
  rework's side winning on the model; F4's migrations regenerated after 0049 as 0050 and 0051.
- 08:57Z — F4's own API watcher of 30 Sep stopped by its PIDs; `igcse_exams_dev` recreated from the
  template and migrated (main's 50 migrations, then the branch's 52), the order proved on a copy.
- 09:05Z — the first pass compiles and is pushed (2d0e380, CI green): `lineItemsFor`,
  `chargesOfKind`, `teacherOf` with the unit, derivation from lines and paid cash-ins, the per-line
  hard stop, `exam_entry.charge_id`, the carry-forward period on `exam_board`; the test world and
  the demo seed on sessions, offers, items and desk lines. Both money defaults confirmed by the lead.
- 09:37Z — the §9 items wired and proved (398b527, CI green): 08x4's 18 scenarios, C's seams
  `entrySentAt` and `withdrawEntry`, results verifying declared sittings, 09's rules, the screens
  and their Arabic. The full suite: 32 files, 561 passed, 1 todo, in local time and in UTC.
- 09:38Z–09:44Z — controls C1–C33 (37 in all) on the new code: each red once with its guard undone,
  then restored (`.audit/exams-evidence/rework/controls/`).
- 09:46Z–09:55Z — the running system (API 3043, web 3040) seeded on the new model; the changed
  screens driven as the coordinator and as a parent at phone width, in English and Arabic; four
  defects found by driving fixed (`.audit/exams-evidence/rework/screens/`).
- 10:04Z — gates green on the final tree: api and web check-types; the full suite in local time and
  in UTC, 32 files, 561 passed, 1 todo each (`.audit/exams-evidence/rework/suite-{local,utc}-final.log`).
  Ready for the Opus 5.5 review.
- 11:57Z — the review of 093dbd1 received (the reviewer: "merge after fixes: 1, 2"), with the lead's
  eleven items.
- 12:02Z–12:12Z — items 1–7 and 9 in the code (one migration, 0052: `exam_entry.withdrawn_with_line`;
  the times are the edit scripts' own); the API's session limit stopped the work there, during item
  10, and it resumed where it stood (the worktree's uncommitted state kept).
- 12:18Z–12:55Z — item 10: every string outside F4's files scanned against F4's rules, the order
  changed and the broad rules narrowed; 08x4's 23 new scenarios, all green (41); controls C34–C55.
- 12:55Z — the first full run red twice (02: the reversal's answer had grown a field, now unchanged;
  09: the hold scenario's deadline set before its entries existed, now after hold's own row); 09
  gained the rule "no live entry of a line no longer paid".
- 12:58Z–13:11Z — `igcse_exams_dev` migrated to 0052 and the API restarted by its PIDs; the full suite
  green in local time and in UTC (32 files, 585 passed, 1 todo each); the rework's Reserve,
  statement and To verify screens and F4's new states driven in English and Arabic
  (`.audit/exams-evidence/rework/screens/review-*`); web check-types green.
- 13:13Z–13:29Z — all 59 controls red once each with their guard undone, restored; api check-types
  green on the final tree.
- 13:37Z — 426d565 pushed, CI green (run 37784906598).
- The review of 426d565 (the reviewer: "merge after: 1, 2, 3 (with 4 and 5 in the same pass; 6 at the
  merge)"): 14:10Z–14:22Z items 1–5 and 7 in the code (migration 0053: `exam_entry.staff_set`), 08x4's
  ten new scenarios and 08t's race green, controls C56–C65, the dev database at 0053 and the API
  restarted by its PIDs; 14:35Z–14:42Z the full suite green in local time and in UTC (32 files, 596
  passed, 1 todo) after one red run (09's series rule now for live entries). The API's session
  limit stopped the work there; it resumed at 17:00Z from the worktree's state, type-checks green,
  all 69 controls red once each and restored by 17:30Z.
