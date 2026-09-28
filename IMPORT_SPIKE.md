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
database (`igcse_spike_test`) is recreated and migrated on each run, then read back.
**Assumed because the sheet does not say:** prices (subjects at 0 EGP), the exam board (one
placeholder), and payment (registrations left waiting for payment).
**Personal data:** the sheet holds real families. It stays where the owner keeps it; the
script cites sheet row numbers and counts, never names, emails or phones; the per-tab reports
are in the git-ignored `.audit/import-spike-evidence/`. Trail: `.audit/import-spike.tsv`.

---

## 1. Headline

**Most of the sheet goes in, and what does not is the part the model has never seen.**

| | November 2026 | June 2023 |
|---|---|---|
| Registration rows | 220 | 434 |
| Registrations the desk accepted | 196 (89%) | 396 (91%) |
| Students / parents (by email) | 118 / 113 (119 links) | 145 / 157 (169 links) |
| Subjects (name × level) / of them single units or papers | 15 / 9 | 38 / 6 |
| Teachers, linked to their subjects | 8 (196 registrations with a teacher) | — (tab has no teacher column) |
| Sessions needed (series × level) | 5 | 3 |

What worked without change: families (find-or-create onboarding handles a parent with several
children and a child with two parents), grades read from the class, teachers and their subject
links, one session per series and level including January A Level, and desk registration of
every in-school row.

What blocks a day-one import, in order: the **A-Level structure** (units, papers, AS and A2
in one row, carried-forward AS results: IS-01, IS-02), **self-study** (refused outright:
IS-03), **no money** (IS-09), and **identity** (emails as the key break on siblings and typos:
IS-06). Sections (IS-04) and the mixed-series tab (IS-05) confirm two of the four model
changes already planned (STRATEGY.md Phase 4).

---

## 2. Findings

Counts are rows (Nov 2026 / June 2023). "Rows" name the first sheet rows, so the school can
look them up in its own copy.

| ID | Sev | Finding | Evidence | Consequence | Recommendation |
|---|---|---|---|---|---|
| **IS-01** | **High** | A-Level entries are **units and papers**, not whole subjects, and one row can mean **two levels**. | Units as their own "subject": Pure Mathematics 1–4 (P1–P4), Mechanics 1, Statistics 1, Biology "(Paper 1 & Paper 2)", "(Paper 3)", "(Paper 3 & Paper 4)", "(Paper 4)", "(Paper 1 & Paper 4)": 9 / 6 catalogue rows. "A.S./A.2." (AS and A2 in one series): 29 / 61 rows. "A.2." (the second year alone): 2 / 30 rows. | The catalogue has one row per subject per level (igcse, as_level, a_level). A unit becomes a free-standing subject with its own price, nothing ties P1 and P2 to "AS Mathematics", and an A2-only entry is indistinguishable from a full A Level. Entries, fees and results per unit cannot be modelled. | The planned **paper-level units** change, now evidenced: a qualification (e.g. AS Mathematics) with units; an entry names the units sat this series. Ask the coordinator what "A.S./A.2." costs and enters. |
| **IS-02** | **High** | **"Carry forward" is an A2 entry with the AS result carried from an earlier series.** | All 19 carry-forward rows (June 2023) are "A.2." rows; the notes read "Carry forward on June 2022 / November 2022"; subjects Biology, Computer Science, Economics, Physics, Psychology. | Q-02 had two readings; the data supports (b), a board-recognised carried-forward AS result. The model would import these as new full A-Level registrations, charging and entering what the student is not sitting. | Model: an A-Level entry records "AS carried forward from <series>". Confirm with the coordinator, and whether the fee differs (DISCOVERY.md Q-02, updated). |
| **IS-03** | **High** | **Self-study is refused.** | 13 of 14 self-study rows (Nov 2026) and 19 of 20 (June 2023) refused: "Subjects can only be taken outside school when retaking or when the school does not offer them". June 2023 fee notes: "Self Study 50%" (16), "Self Study 20%" (4), "External 20%" (1). | The pricing engine allows outside-school study only for a retake or an unoffered subject, at a flat 50%. The school lets students self-study offered subjects on a first attempt (A-02: 50% first attempt, 20% retake). No history is imported, so nothing is a retake either. A teacher is also named on one self-study row. | Change the rule: self-study as a registration mode on any subject, at a percentage that depends on the attempt (A-02) — needs the coordinator's answer on 50% vs 20% and on what "External" means. The day-one import also needs prior attempts to know a retake. |
| IS-04 | Medium | **Homeroom sections have nowhere to go.** | 9 sections (11A–11E, 12A–12D) / 8 sections. | The user has a grade but no section: class lists, per-section reports and anything timetabled per class cannot be produced. | The planned **sections** change, evidenced. |
| IS-05 | Medium | **One tab holds two exam series and three levels.** | November 2026 tab: November 2026 and January 2027 rows (18 January rows, all A-Level Biology); five sessions needed (November IGCSE, AS, A Level; January AS, A Level). | A family fills one form; the model splits it into up to five sessions, each opened, closed and paid separately. A-03 reads the January rows as deposits (preregistrations); the spike imported them as January registrations. | The planned **multi-series windows** change; decide with the coordinator whether January rows are entries or deposits (A-03). |
| IS-06 | Medium | **Email is not a safe identity.** | Two children under one student email: 1 / 13. Student and parent give the same email: 5 / 2 (skipped). Email with no "@" or no domain dot (typos such as a missing ".com"): 5 / 4 (skipped). One email, several spellings of the name: 1 / 2; one parent email, several spellings: 7 / 26; one student with several phones: 1 / 8. Two student emails under the same name: 1 / 18. | Loaded blindly, siblings merge into one account (one child's registrations land on the other), 10 / 6 rows are lost, and namesakes or duplicates are guessed. | A day-one import with a **review step**: load into a staging list, let the desk resolve merges, typos and siblings, then create accounts. Ask the school whether a child may share an email with a sibling or a parent (the app needs one per person). |
| IS-07 | Medium | **No money in the sheet.** | No prices, board, payments, receipt numbers or refunds anywhere (DISCOVERY.md §1). | Imported subjects cost 0 EGP and every registration waits for payment; a 0 EGP registration still needs a 0 EGP payment to confirm (MO-9). The API has no way to import a cycle already paid: it can only take new desk payments. | The finance record (F-01) and the fee list (F-02) before a day-one import of a cycle in progress; an admin import path that records existing payments and receipts, reconciled against F-01. |
| IS-08 | Medium | **The sheet records drop and refund outcomes as free text.** | June 2023 fee notes: "Dropped 0% / 20% / 50% / 80% School fees", "Refund 100%", "N% from the School Fees" (on "I will drop the course" rows). November 2026 has a Yes/No self-study column instead. "I will drop the course": 9 rows (June 2023). | The model computes a drop refund from the refund window at the moment of the drop; the sheet records a percentage per case, and an intention to drop has no state. | Compare with F-01 whether the percentages follow dates (refund windows) or are decided per case (exceptions). Import past drops as history, not as live registrations. |
| IS-09 | Low | **Phones stored as numbers.** | Leading 0 lost: 218 / 426 rows; unusable after normalising: 1 / 4. | Restorable by rule (a 10-digit number starting with 1 is an Egyptian mobile missing its 0). | Normalise on import; show the unusable ones in the review step (IS-06). |
| IS-10 | Low | **Names need cleaning.** | Trailing, non-breaking or doubled spaces: 62 / 133 rows. | Cosmetic, but it also hides duplicates. | Normalise on import. |
| IS-11 | Low | **The form's shape drifts.** | Columns differ between tabs (a Teacher column in 2026, a Signature column in 2023; a series column only in 2026); inside the June 2023 tab 2 rows sit one column over. | An importer that reads by position imports wrong. | Map by header, per tab, and flag rows whose values do not fit their column. |
| IS-12 | Low | **The Signature column** (June 2023) holds staff names on 161 rows. | Who signs and what it means is Q-03. | Not imported. | Keep Q-03 parked; the 2026 tab's Teacher column (imported, 8 teachers) may have replaced it. |
| IS-13 | Low | **Duplicate rows.** | The same subject twice for a student in one series: 1 / 5. | Registered once. | Show in the review step. |

---

## 3. What this changes

- **Three of the four planned model changes are now evidenced by the school's data:**
  paper-level units (IS-01), sections (IS-04), multi-series windows (IS-05). The fourth,
  teacher accounts, is less pressing than thought: the 2026 tab names one teacher per row, and
  the existing teacher table and subject links carried all 196 of them.
- **Two changes nobody had planned:** carried-forward AS results (IS-02), and self-study as a
  mode on any subject with an attempt-dependent rate (IS-03).
- **The day-one import is a review workflow, not a load** (IS-06, IS-07): a staging list the
  desk resolves, then accounts and registrations, then the money from F-01.
- **Q-02 has evidence now** (DISCOVERY.md, updated): carry forward is an AS result carried
  into an A2 entry. A-02 and the pricing engine disagree (IS-03).

**Sharpened questions for the coordinator** (in place of the five sent on 27 Sep, which stand):
1. Self-study: is it allowed on any subject the school teaches, first attempt included, and are
   50% and 20% first attempt and retake (A-02)? What is "External 20%"?
2. Carry forward: is it the Cambridge carry-forward of an AS result, and is the A2-only entry
   charged differently?
3. "A.S./A.2." on one row: one entry for both levels, or two?
4. May a child share an email with a sibling or a parent?
5. Where is the money record for November 2026 (F-01)?

---

## 4. Reproduce

```bash
pnpm --filter @repo/api exec tsx scripts/import-spike/import-spike.ts <path to the sheet>.xlsx \
  --tab 2024 --out .audit/import-spike-evidence/report-nov2026.md      # the "Nov. 2026 Session" tab
pnpm --filter @repo/api exec tsx scripts/import-spike/import-spike.ts <path to the sheet>.xlsx \
  --tab Sheet1 --out .audit/import-spike-evidence/report-june2023.md   # the "June 2023 Session" tab
```

The run needs the test container (`apps/api/test/README.md`); it drops and recreates
`igcse_spike_test` only. The script type-checks with the API's test gate.
