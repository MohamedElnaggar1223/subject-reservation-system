# Discovery Register — assumptions, parked questions, artefacts to obtain

**Opened:** 26 September 2026
**Why this file exists:** The project is pivoting from a subject-reservation system to a
full IGCSE Management System for grades 10–12. The school's incumbent system (SCL) covers
only pre-IGCSE grades and retains no data across academic years, so the school does not use
it from grade 10 onward (desk research questions the second part: the likely product claims to
keep records across years — Q-09). The school's working artefacts are **not obtainable right now**, so
we build on explicit assumptions and correct them when facts arrive.

Every row in §2 and §3 is a liability until confirmed. **Before designing any feature, check
this file. When a fact arrives, update the row's status and note the source — never delete a
row**, so the trail of what we believed and why survives.

IDs: `A-nn` working assumption · `Q-nn` parked question · `F-nn` artefact to obtain.
Status: `assumed` · `confirmed` · `refuted` · `parked` · `obtained`.
Confidence: `high` = the school or the owner said it, or a primary published source states it
(a board document, the Ministry's guide) · `medium` = the user's belief or decision, not yet
confirmed by the school · `low` = our inference, or press reports only.

---

## 1. Facts confirmed from the school's own sheet

Source: `Nov 1 2026.xlsx` (a Google Form export; two session tabs — "June 2023 Session",
434 rows, and "Nov. 2026 Session", 220 rows — plus hand-made per-unit roster tabs). Read
26 Sep 2026. These are **facts**, not assumptions.

- One row per (student, subject). Parent name/email/phone repeated on every row. Checkbox
  text: "I confirm my registration" / "I will drop the course".
- **No prices, amounts, receipt numbers, or payment status anywhere.** The money record is a
  separate artefact (→ F-01).
- Level vocabulary: **O.L.** (= IGCSE), **A.S.**, **A.2.**, **A.L.**, and **"A.S./A.2."**
  for a student sitting both in one series.
- **A-Level subjects are registered at unit/paper level**: Pure Mathematics 1 (P1), P2, P3,
  P4; Mechanics 1 (M1); Statistics 1 (S1); Biology as "(Paper 1 & Paper 2)", "(Paper 3)",
  "(Paper 3 & Paper 4)", "(Paper 4)", "(Paper 1 & Paper 4)".
- **Homeroom sections**: 11A–11E (~20–23 students each), 12A–12D.
- **No Grade 10 rows** in either session tab (→ A-01, Q-01).
- A **teacher is named per registration row** (8 teachers) and a **"Signature" column** is
  filled by a teacher/coordinator (three named staff members; real names are kept out of
  this repository) (→ Q-03).
- **"(Carry forward on June 2022)"** and "(Carry forward on November 2022)" appear in the
  Signature column on some rows (→ Q-02).
- The November 2026 tab contains **18 rows dated January 2027**, all A-Level Biology papers
  (→ A-03). Consistent with "January series is A-Level only".
- **Fee-status free text**: "Self Study 50% School fees" (most common), "Self Study 20%",
  "External 20%", "Dropped 0% / 20% / 50% / 80%", "Refund 100%", plus a Yes/No self-study
  column (→ A-02).
- **Per-unit roster tabs** (S1, M1, P1, P2, Com. Science): numbered class lists derived by
  hand from the main sheet (→ A-04). Two **unlabeled lists** of 24 and 28 students with
  section (→ Q-04).
- Scale per session: ~125–150 distinct students (grades 11–12), 220–434 registrations,
  1–7 subjects per student (mode 3), 8 teachers, 9 sections.
- Data quality: phones stored as integers (leading 0 lost) or spaced free text; names with
  trailing non-breaking spaces and inconsistent case, same student spelled differently
  across tabs; 13 raw spellings of 5 level values; subject-name variants ("Arabic" vs
  "Arabic (Cambridge)"); 13 rows with no teacher; the tab named "2024" holds Nov 2026
  (copy-last-year-and-overwrite workflow). Email + phone are the de-facto identity; no
  student ID or board candidate number in the sheet (→ Q-05).
- **Found by the import spike (28 Sep, IMPORT_SPIKE.md):** a student email used by two
  children (11 in the June 2023 tab, 1 in November 2026), and a child's rows filed under a
  sibling's email as well as their own (11 in June 2023); student and parent give the same
  email on 5 / 2 rows (Nov 2026 / June 2023); 5 / 4 emails are missing or malformed; inside the
  June 2023 tab 5 rows have the confirmation and the fee note in each other's column; the level
  code "A.S./A.2." (and June's "A.S./A.L.") sits on single units such as M1 and S1; every
  carry-forward note is on an "A.2." row (→ Q-02).

---

## 2. Working assumptions

| ID | Assumption | Source | Conf. | If wrong, what changes | Status |
|---|---|---|---|---|---|
| A-01 | Grade 10 sits board exams in **June only**; they register the same way as grades 11–12 and simply do not appear in November sheets. | User, 26 Sep | medium | If grade 10 also sits November, session rules and the core-subject gate change. | assumed |
| A-02 | Outside-school ("self study" / "external") price is **50% of the combined fee on a first attempt and 20% on a retake**. | User, 26 Sep, interpreting sheet values | medium | Pricing engine today applies a flat 50% for any outside-school registration. Needs a retake-aware rate stored per registration. The other "20%" values in the sheet (dropped 20%) are refund percentages, not this rule. **Import spike, 28 Sep (IS-03):** the pricing engine refuses self-study on a subject the school teaches unless it is a retake; with no history imported, 10 of 14 self-study rows (Nov 2026) were refused — all A-Level units or paper sets, which may be unit re-sits. Whether first-attempt self-study on a taught subject exists is still this question. | assumed |
| A-03 | The January-2027 rows inside the November-2026 tab are **preregistrations (deposits) for the upcoming January series** — the held-wallet / preregistration feature already built. | User, 26 Sep | medium | If one window legitimately covers two exam series instead, the session model needs multi-series windows. **Import spike, 28 Sep (IS-05):** the 18 January rows are all Biology papers (AS 9, "A.S./A.2." 7, "A.2." 2); imported as January entries, they need their own sessions. **Research, 28 Sep (DISCOVERY_RESEARCH.md §1):** they are not Cambridge — Cambridge runs no January series (confirmed in its handbook); most likely Pearson IAL units, which sit in January (strong inference: OxfordAQA also sits AS/A Level in January, and the sheet says "Paper", Cambridge's word, and never lists IAL Units 5–6). Whether they are entries or deposits is still this question. | assumed |
| A-04 | The per-unit roster tabs are **teaching groups** — the natural input to timetabling. | User + our inference | low | If they are exam-entry or invigilation lists, they are a report to generate, not a scheduling input. | assumed |
| A-05 | The **Grade-10 core-subject mandate** (URD CORE-001..004: core subjects pre-selected, locked, cannot be dropped/swapped) still holds. | URD v2; **confirmed by user 26 Sep: "the core-subject is the unique thing to grade 10"** | high | — | confirmed |
| A-06 | Each **registration window is specific to one exam series**; a family may deposit against a future series from within the current window (A-03). | User, 26 Sep | medium | If windows span series, the `registrationSession` model and the one-active-per-(type, level) index change. | assumed |
| A-07 | Grade 10 is **"treated the same as the others"** in the sense of using the same registration form and pricing; the core-subject rule is the one thing unique to them. | User, 26 Sep (resolved Q-01) | high | — | confirmed |
| A-08 | The **exam board's entry deadline** for each series is known from the board's published calendar and is entered by the admin per session; the school does not accept entries (or money for them) after it, and late entries with board late fees are not handled by this system. | Owner decision MO-10, 27 Sep (MONEY_AUDIT.md §6) | medium | If the school takes late entries with the board's late fee, the cut-off becomes a fee step instead of a hard stop. **Research, 28 Sep:** Pearson's entry fee doubles at its late date and trebles at its high-late date, and Cambridge charges a fee per late change — the boards take late entries, so the hard stop is the school's policy, and each board series has its own dates (DISCOVERY_RESEARCH.md §2). | assumed |
| A-09 | The school **closes its books with the bank monthly**: a correction to a day in the current month may change that day's report, but a month already closed stays as printed and its corrections are posted on the day they are made. | Owner decision on MO-11, 28 Sep (MONEY_AUDIT.md §6b) | medium | If finance reconciles weekly or quarterly, the boundary moves (a one-line change in the takings). Confirm with the school's finance person. | assumed |
| A-10 | Egypt's equivalency (Mo'adala) for British certificates follows the Ministry of Higher Education's guide for **admission in 2025**: eight subjects at grade C or better (Extended), at most five sittings in the three preceding academic years, the average percentage × 4.1, Arabic and religion passed at the Ministry's exams, and IAL counted as AS/A Level. | The Ministry's guide, read 28 Sep (DISCOVERY_RESEARCH.md §3); no 2026/27 guide found | high (primary source) — for 2025 admission only | The pathway advisor stores each rule with the admission year it applies to; a new guide changes the rules, not the code. Re-check against the 2026/27 guide when it appears. | assumed |
| A-11 | **Decree 148/2024** adds Arabic and history, taught in grades 10–12, at 10% each of the equivalency total, from the 2025/26 grade-10 cohort (this school's grade 11 in 2026/27). | Press reports only (DISCOVERY_RESEARCH.md §3, [E3]–[E7]); the decree text was not found | low | If it does not apply, the advisor drops the two national subjects from the total; if it does, how the 20% combines with the ×4.1 score is not published. | assumed |

---

## 3. Parked questions — no decisions until answered

| ID | Question | Why it matters | Hypotheses on the table | Status |
|---|---|---|---|---|
| Q-01 | "Grade 10 treated just the same as the others" — does that mean the **core-subject lock does not exist**, or only that they register through the same form? | Decides whether CORE-001..004 stay or go. | **Answered 26 Sep (user): (a).** Same form and pricing as other grades; the core-subject mandate is the one thing unique to grade 10. CORE-001..004 stay. | confirmed |
| Q-02 | What is **"carry forward"**? | Very different models depending on the answer. | (a) User's belief: a payment carried from a prior session, or a payment moved. (b) Our reading: Edexcel IAL unit result carried into this series (no re-sit, no new fee). Possibly both exist. **Evidence, 28 Sep (IMPORT_SPIKE.md IS-02):** all 19 carry-forward notes in the June 2023 tab are on "A.2." rows (Biology, Computer Science, Economics, Physics, Psychology), noted "Carry forward on June / November 2022" — consistent with (b), an AS result carried into an A2 entry, but not conclusive: 11 of the 30 "A.2." rows carry no note, the note is in the staff Signature column (which also fits (a)), and the subjects exist on both boards. **Research, 28 Sep (DISCOVERY_RESEARCH.md §1):** does not settle it. Cambridge's entry options say "June carry-forward" and "November carry-forward", and both dates are inside its 13-month limit; but Pearson's own rules also speak of unit marks "carried forward", and IAL units stay banked for the life of the specification (in the 2021 edition of Pearson's cash-in rules). 12 of the 19 rows are Biology (IAL in the 2026 tab, on the evidence there); only the one Computer Science row, which Pearson does not offer as an IAL, points to Cambridge alone. | parked — consistent with (b), not conclusive; ask the coordinator |
| Q-03 | Who fills the **Signature column** and what does a signature mean? | Decides whether a teacher/coordinator approval step exists in the flow. | (a) teacher confirms they will teach the student; (b) coordinator approves the entry; (c) fee acknowledgement. | parked |
| Q-04 | What are the two **unlabeled lists** (24 and 28 students with section)? | Unknown; may be a routine report we should generate. | unpaid? unconfirmed? self-study? a class allocation? | parked |
| Q-05 | What **identifier** does the school use for a student with the exam boards (candidate number / centre number)? Where does it live? | Import matching, board-entry export, results import. | Lives in a board portal or another sheet. **Research, 28 Sep (DISCOVERY_RESEARCH.md §2, §5):** Cambridge assigns a four-digit candidate number per series (carry-forward needs the previous one) under a five-character centre number; Pearson gives each candidate a permanent 13-character UCI and a four-digit candidate number per series. Still to ask: the school's centre numbers, and whether it enters directly or through the British Council. | parked |
| Q-06 | What does the **money record** look like? | Finance import, day-one migration, refund/receipt reality. | Another sheet, paper receipt book, or both. | parked → F-01 |
| Q-07 | Do students carry **held/deposit** money across years (e.g. a Jan deposit made in November of grade 11 used in grade 12)? | Held-wallet lifecycle and year rollover. | — | parked |
| Q-08 | **When does a student's grade change?** Today grades move when registration windows close (10→11 at a November close, 11→12 at a June close, 12→graduated at a November close), so a new grade-10 student is grade 11 by the June window where the grade-10 core-subject rule applies, and pays grade 11's school fee. | Core-subject rule (A-05), school fee per grade, who may register after graduation. | (a) Derive the grade from the year the student entered grade 10 and the academic year of the session (1 July boundary) — recommended (STATE_AUDIT.md §6). (b) One rollover on 1 July. (c) Keep window-driven progression with corrected triggers. And: may a student register for the November after graduating? Meanwhile automatic progression is off (`AUTO_GRADE_PROGRESSION=false`, STATE_AUDIT.md ST-13). | parked — owner decision |
| Q-09 | **Which SCL, and what can it give us?** Desk research (DISCOVERY_RESEARCH.md §4) points to Edurealm's "SCL – School Communication & Learning Management System" (Cairo), which **claims to keep records across years** — against this file's opening premise — and offers CSV export and an API, but nothing on exam-board entries. | Whether the grade 9→10 import can come from SCL, and why the school stops using it at grade 10. | (a) The school wipes records at year end: SCL's 2025.1 release notes list wipe options at promotion, which would reconcile its claim with this file's premise. (b) The school means exam registrations and results, which SCL does not model. (c) The school's licence covers only the lower grades. The school's SCL login address confirms the product; ask which of these holds and whether it can export the grade-9 roster. | parked |

---

## 4. Artefacts to obtain — build on assumptions now, revisit when obtained

| ID | Artefact | What it would settle | Status |
|---|---|---|---|
| F-01 | The **finance record** for the same November 2026 session (who paid what, when, receipt numbers, refunds). | Q-06, money model, refund percentages, receipt lifecycle, daily-takings shape. | wanted |
| F-02 | The **fee list**: subject/unit prices, the school fee, and what 20% / 50% mean in EGP. | A-02, pricing engine, fee split, school-fee schedule. | wanted |
| F-03 | The **Google Form** itself (exact questions and options). | Parent-facing registration form parity; drop flow entry point. | wanted |
| F-04 | The current **timetable** for grades 11–12, in whatever form it exists. | Timetabling model, periods per week, teacher availability, A-04. | wanted |
| F-05 | The **leave-permission slip** (paper or form). | Campus-leave feature: who requests, who approves, who checks at the gate. | wanted |
| F-06 | The **attendance sheet**. | Attendance feature shape. | wanted |
| F-07 | The **board entry** export/upload and the **results file** that comes back (Cambridge and Edexcel formats). | Exam-entry management, results import, Q-05. | wanted |
| F-08 | A **June session sheet** (would contain grade 10). | A-01, Q-01, core-subject rule. | wanted |
| F-09 | Anything the school uses for **scheduling today** (who builds it, when, in what tool). | Whether automated timetable generation is worth building at all. | wanted |

---

## 5. Design implications already accepted — do not re-litigate

These follow from §1 and the user's direction on 26 Sep 2026 and are treated as settled
unless a fact in §1 changes.

- **Teachers become users.** Reversed from V3_PLAN §6.7 ("teachers as data only"). The
  sheet names a teacher on every row and a teacher/coordinator signs off. The pivot makes
  the old decision irrelevant; the user has said past decisions must not be treated as
  constraints.
- **Registration supports unit/paper-level items** for A-Level (P1, M1, "Biology Paper
  3 & Paper 4"), not only whole subjects. Remarks already model per-paper items; registration
  and pricing must too.
- **Students belong to a homeroom section** (11A…12D), not only a grade. Needed for
  rosters, timetabling, attendance, and leave permissions.
- **Import normalises phones and names and matches on email + phone**, never on name alone.
- **Level vocabulary shown to the school is theirs**: O.L. / A.S. / A.2. / A.L., with
  "A.S./A.2." for a combined sitting. Internal enum can stay.
- **The outside-school rate is per-registration data and retake-aware** (A-02), not a
  constant in the pricing engine. The refund percentage stays window-driven per registration.
- **Per-unit rosters are a first-class report** and, per A-04, the seed for teaching groups
  in scheduling.
- **Preregistration for an upcoming series stays** (A-03 validates the held wallet).
- **The Grade-10 June-only pattern stays** (A-01), and **the core-subject mandate stays**
  as the one grade-10-specific rule (A-05, A-07, Q-01 confirmed).
- **Money after the close** (owner, 27 Sep, MONEY_AUDIT.md MO-10): an InstaPay checkout with
  no reference yet gets 24 hours after the window closes; a series' board entry deadline
  (A-08) closes everything still unconfirmed on it. A transfer that turns up on the bank
  statement afterwards is credited to the family's escrow by finance and never re-opens the
  subject.
- **A reversal says whether the money went back** (owner, 27 Sep, MO-11): if it did, it is
  money out that day; if the confirmation was a mistake, it corrects the confirmation's day.

---

## 6. How to use this file

- Designing a feature: scan §2–§4 for rows it touches; cite the IDs in the design.
- A fact arrives from the school: update the row's Status and Source in place; if it
  refutes an assumption, add a one-line note of what was rebuilt.
- Adding a new assumption: next free ID, fill every column — especially *If wrong, what
  changes*. An assumption without a blast radius is not an assumption, it is a guess.
- This file is the input to the value / stakeholder-fit audit and to the feature-value map
  that precedes the first management-system release.
