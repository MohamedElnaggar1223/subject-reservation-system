# Import Spike — the school's registration sheet, through the API

**Date:** 28 September 2026
**Scope:** STRATEGY.md §6 step 6. Load the school's own registration sheet (`Nov 1 2026.xlsx`,
DISCOVERY.md §1) into a throwaway database the way the desk would enter it by hand, and count
every row that does not fit the model. Two tabs: **November 2026** (220 rows, the live cycle)
and **June 2023** (434 rows, an older cycle with fee notes).
**Method:** `apps/api/scripts/import-spike/import-spike.ts` reads the workbook, normalises it,
and drives the API through the typed client as an admin and a finance officer: catalogue,
teachers and their subjects, one session per series and level, desk onboarding for each family,
desk registration for each student's subjects. Every refusal is the API's own sentence. The
database (`igcse_spike_test`) is recreated and migrated for the run, read back, and dropped at
the end.
**Assumed because the sheet does not say:** prices (subjects at 0 EGP), the exam board (one
placeholder), payment (registrations left waiting for payment), and whether the school teaches
a subject (taught, unless every row for it is self-study).
**Personal data:** the sheet holds real families. It stays where the owner keeps it; the
script cites sheet row numbers and counts, never names, emails or phones; the per-tab reports
are in the git-ignored `.audit/import-spike-evidence/`. Trail: `.audit/import-spike.tsv`.
**Reviewed** on Opus 5.5: the first draft overstated four findings and the script misread three
rows; both are corrected here (trail, "review" rows).

---

## 1. Headline

**Most of the sheet goes in; what does not is the part the model has never seen.**

| | November 2026 | June 2023 |
|---|---|---|
| Registration rows | 220 | 434 |
| Registrations the desk accepted | 199 (90%) | 399 (92%) |
| Students / parents (by email) | 118 / 113 (119 links) | 145 / 157 (169 links) |
| Subjects (name × level) / of them units or paper sets | 15 / 9 | 38 / 6 |
| Teachers, linked to their subjects | 8 (196 registrations with a teacher) | — (tab has no teacher column) |
| Sessions needed (series × level) | 5 | 3 |
| Self-study rows / registered outside school | 14 / 3 | 23 / 6 |

What worked without change: families (find-or-create onboarding handles a parent with several
children and a child with two parents), grades read from the class, teachers and their subject
links, one session per series and level including January, and desk registration of every
in-school row.

What blocks a day-one import, in order: the **A-Level structure** — units and paper sets, and
level codes the model cannot hold (IS-01); **identity** (email as the key breaks on siblings,
misfiled rows and typos: IS-06); **no money** (IS-07); and **self-study** on subjects the school
also teaches (IS-03). Carry forward (IS-02) and mixed boards in one session (IS-14) need the
coordinator before anything is built. Sections (IS-04) and the two-series tab (IS-05) confirm
two of the four model changes already planned (STRATEGY.md Phase 4).

---

## 2. Findings

Counts are rows (November 2026 / June 2023). "Rows" name the first sheet rows in the reports,
so the school can look them up in its own copy.

| ID | Sev | Finding | Evidence | Consequence | Recommendation |
|---|---|---|---|---|---|
| **IS-01** | **High** | A-Level entries are **units and paper sets**, and the **level codes** say something the model has no field for. | Units and paper sets as their own "subject": Pure Mathematics 1–4, Mechanics 1, Statistics 1, Biology "(Paper 1 & Paper 2)", "(Paper 3)", "(Paper 3 & Paper 4)", "(Paper 4)", "(Paper 1 & Paper 4)": 9 / 6 catalogue rows. Codes beyond O.L. and A.S.: "A.S./A.2." 29 (Nov); "A.2." 2 / 30; June's "A.L." 42, "A.S./A.L." 60, "A.S.A.L." 1. A combined code sits on a single unit on 21 / 61 rows (in June, every combined-code row is M1 or S1); the other 8 November "A.S./A.2." rows are Biology paper sets that really mix AS and A2 papers (Paper 3 & 4, Paper 1 & 4). | The catalogue has one row per subject per level (igcse, as_level, a_level). A unit becomes a free-standing subject with its own price; nothing ties P1 and P2 to "AS Mathematics". On a single unit, which cannot be two entries at two levels, "A.S./A.2." must mark something else — the student's year, or the qualifications the unit counts toward; on the mixed Biology paper sets it may mean both levels. The same code seems to mean different things on units and on paper sets. All codes beyond AS were imported as a_level, so A2-only, full A Level and the combined codes look the same. | The planned **paper-level units** change, now evidenced, with a unit's own level kept separate from the student's year. Ask the coordinator what "A.S./A.2." marks, and whether June's "A.L." is today's "A.2.". |
| **IS-02** | **High** | **"Carry forward" sits on A2 rows — consistent with a carried-forward AS result, not conclusive.** | All 19 carry-forward notes (June 2023) are on "A.2." rows: Biology 12, Physics 3, Economics 2, Computer Science 1, Psychology 1; "Carry forward on June 2022" 10, "November 2022" 9. 11 of the 30 "A.2." rows carry no such note. The note is in the staff Signature column. | Reading (b) of Q-02 (an AS result carried into an A2 entry) fits the level; but if it were (b), every A2-only entry would carry an AS result forward, and a note written by staff also fits reading (a), a payment carried forward — the owner's own belief. The subjects are offered by both boards, so the board cannot be told from them. Imported as new registrations either way. | Nothing to build yet. Put the question to the coordinator (§3); if it is (b), an A-Level entry records "AS carried forward from <series>" (DISCOVERY.md Q-02, updated). |
| **IS-03** | **High** | **Self-study on a subject the school teaches is refused.** | Subjects with no in-school row at all were created as not taught: 3 / 4 subjects, whose 3 / 6 self-study rows registered outside school. Still refused: 10 of 14 (Nov) and 16 of 23 (June), all in subjects with at least one in-school row — every November one an A-Level unit or paper set (Biology papers, P1, P2, M1); 12 of June's 16 are O.L. Mathematics (5), Chemistry (4) and Physics (3), each counted as taught on the strength of a single in-school row, so one mis-marked row would flip it. The other self-study row is a duplicate (Nov row 124) and a row with no student email (June row 435). June fee notes: "Self Study 50%" 19, "Self Study 20%" 4, "External 20%" 1. | The pricing engine allows outside-school study only for a retake or a subject the school does not teach, at a flat 50%. Nothing imported is a retake, because no history is imported; the November refusals are A-Level units, which may well be unit re-sits. So the sheet does not show first-attempt self-study on taught subjects — only that the model cannot hold any of these rows without history and without "taught" per unit. | Record "taught at school" per subject **and per unit**, and the attempt per unit (history in the day-one import), before deciding whether self-study is allowed on any subject. A-02 (50% vs 20%, first attempt vs retake) is the question for the coordinator either way. |
| IS-04 | Medium | **Homeroom sections have nowhere to go.** | 9 sections (11A–11E, 12A–12D) / 8 sections. | The user has a grade but no section: class lists, per-section reports and anything timetabled per class cannot be produced. | The planned **sections** change, evidenced. |
| IS-05 | Medium | **One tab holds two exam series.** | November 2026 tab: November 2026 and January 2027 rows; the 18 January rows are Biology papers (AS 9, "A.S./A.2." 7, "A.2." 2). Five sessions needed (November IGCSE, AS, A Level; January AS, A Level). | A family fills one form; the model splits it into up to five sessions, each opened, closed and paid separately. A-03 reads the January rows as deposits (preregistrations); the spike imported them as January registrations. | The planned **multi-series windows** change; decide with the coordinator whether January rows are entries or deposits (A-03). |
| IS-06 | Medium | **Email is not a safe identity.** | Two children under one student email (different classes, or first names that are not a respelling): 1 / 11. A child's rows filed under a sibling's email as well as under their own: 0 / 11. Student and parent give the same email: 5 / 2 (skipped). Emails missing or malformed (no "@", no domain dot, empty, a space inside): 5 / 4 (skipped). One email, several spellings of the name: 1 / 4; one parent email, several spellings: 7 / 26. Two student emails under the same name, neither shared: 1 / 7. | Loaded blindly, a misfiled or shared email merges two children into one account (one child's registrations land on the other), 10 / 6 rows are lost, and namesakes are guessed. | A day-one import with a **review step**: load into a staging list, match on name plus parent email (which resolves most misfiling), let the desk decide the rest and fix typos, then create accounts. Ask whether a child may share an email with a sibling or a parent (the app needs one per person). |
| IS-07 | Medium | **No money in the sheet.** | No prices, board, payments, receipt numbers or refunds anywhere (DISCOVERY.md §1). | Imported subjects cost 0 EGP and every registration waits for payment; a 0 EGP registration still needs a 0 EGP payment to confirm (MO-9). The API has no way to import a cycle already paid: it can only take new desk payments. | The finance record (F-01) and the fee list (F-02) before a day-one import of a cycle in progress; an admin import path that records existing payments and receipts, reconciled against F-01. |
| IS-08 | Medium | **The sheet records drop and refund outcomes as free text.** | June 2023 fee notes: "Dropped 0% / 20% / 50% / 80% School fees" (3, 1, 1, 1), "Refund 100%" (1), "N% from the School Fees" (2, on "I will drop the course" rows). "I will drop the course": 9 rows. November 2026 has a Yes/No self-study column instead. | The model computes a drop refund from the refund window at the moment of the drop; the sheet records a percentage per case, and an intention to drop has no state. | Compare with F-01 whether the percentages follow dates (refund windows) or are decided per case (exceptions). Import past drops as history, not as live registrations. |
| IS-09 | Low | **Phones stored as numbers.** | Leading 0 lost: 218 / 426 rows; unusable after normalising: 1 / 4. | Restorable by rule (a 10-digit number starting with 1 is an Egyptian mobile missing its 0). | Normalise on import; show the unusable ones in the review step (IS-06). |
| IS-10 | Low | **Names need cleaning.** | Trailing, non-breaking or doubled spaces: 62 / 133 rows. | Cosmetic, but it also hides duplicates. | Normalise on import. |
| IS-11 | Low | **The form's shape drifts.** | Columns differ between tabs (a Teacher column in 2026, a Signature column in 2023; a series column only in 2026). Inside the June 2023 tab, 5 rows have the confirmation and the fee note in each other's column (329, 330 one way; 349, 428, 429 the other). | Read by column, those rows import wrong: the spike's first draft took three self-study rows as in-school for exactly this reason. | Map by header, per tab; read free-text answers by content, and flag any value that does not fit its column — in the review step. |
| IS-12 | Low | **The Signature column** (June 2023) holds staff names on 161 rows. | Who signs and what it means is Q-03. | Not imported. | Keep Q-03 parked; the 2026 tab's Teacher column (imported, 8 teachers) may have replaced it. |
| IS-13 | Low | **Duplicate rows.** | The same subject twice for a student in one series: 1 / 5. | Registered once. | Show in the review step. |
| IS-14 | Medium | **Two exam boards appear to share one session.** | The unit names P1, P2, M1, S1 read like Pearson Edexcel IAL; the Biology paper sets read like Cambridge — yet both are in the November AS session. The January 2027 Biology rows point the other way: Cambridge International has no January series; Pearson Edexcel IAL does. | The model sets one board entry deadline per session (MO-10) and one board per subject; if two boards share a series and a level, their deadlines and entry files differ. | Ask the coordinator which board each subject and unit is entered with, alongside the "A.S./A.2." question; a session may need a deadline per board. **Research (DISCOVERY_RESEARCH.md §1), reframing this finding:** P1–P4, M1 and S1 are Pearson IAL units (confirmed: Pearson's own titles, and Cambridge 9709 has no Pure Mathematics 4); the January Biology rows are not Cambridge (confirmed: it has no January series) and most likely IAL (a strong inference: OxfordAQA also sits AS/A Level in January); the Biology paper sets are most likely IAL units too (none matches a Cambridge 9700 route, though the sheet says "Paper", Cambridge's word, and may register teaching groups rather than board entries). So the finding stands in another form: the tab feeds **several board series** — IAL October, Cambridge and International GCSE November, IAL January — each with its own dates, and possibly several boards. A session needs a deadline per board series, not per board. |

---

## 3. What this changes

- **Three of the four planned model changes are evidenced by the school's data:** paper-level
  units (IS-01), sections (IS-04), multi-series windows (IS-05). The fourth, teacher accounts,
  is less pressing than thought: the 2026 tab names one teacher per row, and the existing
  teacher table and subject links carried all 196 of them.
- **Open until the coordinator answers:** carried-forward AS results (IS-02), self-study on
  taught subjects (IS-03), which board each unit belongs to (IS-14). None should be built on
  the spike's evidence alone.
- **The day-one import is a review workflow, not a load** (IS-06, IS-07, IS-11): a staging list
  the desk resolves, then accounts and registrations, then the money from F-01.

**Sharpened questions for the coordinator** (in addition to the five sent on 27 Sep):
1. **Level codes:** what does "A.S./A.2." mark on a single unit such as M1 — the student's
   year, or what the unit counts toward? Is June's "A.L." the same as "A.2."?
2. **Carry forward:** on the A2 rows, is it an AS result carried into this series (Cambridge's
   carry-forward), or a payment carried forward? Is the A2-only entry charged differently?
3. **Self-study:** on a subject or unit the school teaches, is it allowed on a first attempt,
   or only on a re-sit? Are 50% and 20% first attempt and retake (A-02)? What is "External 20%"?
4. **Boards:** which board is each subject and unit entered with — in particular Biology, which
   appears in both November and January?
5. **Emails:** may a child share an email with a sibling or a parent?

---

## 4. Reproduce

```bash
pnpm --filter @repo/api exec tsx scripts/import-spike/import-spike.ts <path to the sheet>.xlsx \
  --tab 2024 --out .audit/import-spike-evidence/report-nov2026.md      # the "Nov. 2026 Session" tab
pnpm --filter @repo/api exec tsx scripts/import-spike/import-spike.ts <path to the sheet>.xlsx \
  --tab Sheet1 --out .audit/import-spike-evidence/report-june2023.md   # the "June 2023 Session" tab
```

The run needs the test container (`apps/api/test/README.md`); it creates `igcse_spike_test`,
and drops it at the end (`--keep` leaves it for inspection — it then holds real family data
under a known password, so drop it by hand afterwards). The script type-checks with the API's
test gate.
