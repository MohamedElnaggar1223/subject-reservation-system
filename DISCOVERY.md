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

### 1b. Facts from the school's registration forms and fee lists (7 October 2026)

Source: the 25 June 2027 Google Forms (Drive folder "June 2027"), the two registration-links
PDFs (June 2027: 25 links; November 2026/January 2027: 18 links, 4 forms readable), five board
fee lists and Cambridge's enquiry-about-results sheet. Read form by form in `SCHOOL_FORMS.md`.
These are **facts**.

- **One form per subject per cycle**, published through a links sheet of subject → board →
  teacher(s) → form. The links sheet is the cycle's definition. The June 2027 forms were made
  in September 2026: a cycle is the taught course plus the entry, and registration opens
  about nine months before a June series.
- Every form: seven identity questions (student name, **class 11A–11E / 12A–12D**, student
  mobile and email, guardian name, email and mobile), the subject's choices, "I confirm my
  registration / I will drop the course", a refund-policy acknowledgement and a declaration.
  One page, nothing conditional. **No grade-10 class on any form, June included** (→ A-01,
  Q-10).
- **Teacher choice** per subject from one to three teachers of the cycle, or self-study; some
  teachers "(ONLINE ONLY)"; two O.L. subjects taught by an external team; Cambridge Computer
  Science A Level "External".
- **Entry types**, spelled out on the Arabic O.L. form: First Entry in School 100% (All
  Papers) · Retake in School 100% (All Papers) · Retake Self Study 50% (All Papers) · Retake
  in School 100% (One paper ONLY) From June 2026 · Retake Self Study 50% (One paper ONLY)
  From June 2026. **Self-study is 50% and "ONLY 2nd entry" on every form**; no 20% appears
  (→ A-02). The wording is "50% **School** fees" (→ Q-12).
- **One-paper retakes** name the paper (Cambridge sciences "Paper 41/42", ICT "Theory
  Paper", Edexcel Mathematics "1H / 2H", Arabic "Paper 1 / Paper 2") and the series the rest
  is carried from ("From June 2026 / From November 2026").
- **A Level routes**: Cambridge forms offer "A.S. / A.2. (Carry forward on June) / A.2. (Carry
  forward on November) / A.L."; Physics names the series ("Carry forward on June 2026",
  "November 2025"). **Carry forward is the A2 entry carrying its AS result** (→ Q-02 (b)).
- **Per-unit registration with the board's codes**: Biology IAL as checkboxes per unit
  (WBI11–WBI16), each marked first entry 100% or self-study 50% 2nd entry; Mathematics IAL one
  question per unit (P1, P2, P3, P4, M1, S1) with the unit's own teacher or self-study.
- **One form, two series**: the Biology A.S./A.L. (November 2026 / January 2027) form assigns
  units 1–2 to November and 3–4 to January, and lists retakes from November 2025 and January
  2026 (→ A-03, A-06; IS-05, IS-14 confirmed). With the June form, Biology IAL runs units 1–2,
  3–4, 5–6 across three series in one academic year.
- **Availability per cycle**: on the November links sheet five O.L. subjects are "Retake (Self
  Study ONLY)"; the Edexcel November fee list marks units "RETAKE ONLY".
- **Refund policy, in weeks from the first lesson**: June — 100% within 2 weeks, 50% from
  week 3, 0% from week 4; November — 100% within 2 weeks, 50% from weeks 3 to 6, 0% after
  week 6 (→ Q-11).
- **Board fees are per unit (Edexcel) or per syllabus-and-option (Cambridge), per series**,
  and differ per series for the same unit (IAL P1: 4,800 June 2026; 4,910 January 2026; 5,140
  November 2026). Cambridge prices AS, A2 and the full A Level separately (option codes S1/S2,
  BY/CT, AX/HX). The school's course fees are in no artefact (→ F-02).
- **No price, payment step or deadline on any form.**
- **Enquiry about results (Cambridge, June 2026)**: four services (clerical re-check, with
  script copy; re-marking, with copies) at an IGCSE and an AS/A Level rate per component; the
  fee less 100 EGP is refunded if the grade changes.
- Form drift: last year's series left in options, a 2025 form linked for 2026, a class missing
  on two forms, a stale option — the forms are copied and edited by hand each cycle.

---

## 2. Working assumptions

| ID | Assumption | Source | Conf. | If wrong, what changes | Status |
|---|---|---|---|---|---|
| A-01 | Grade 10 sits board exams in **June only**; they register the same way as grades 11–12 and simply do not appear in November sheets. | User, 26 Sep | medium | If grade 10 also sits November, session rules and the core-subject gate change. **Forms, 7 Oct (SCHOOL_FORMS.md §2.1):** no June 2027 form lists a grade-10 class, so grade 10 does not register through the forms; "June only" stands, "the same way" does not (→ Q-10, A-15). | questioned |
| A-02 | Outside-school ("self study" / "external") price is **50% of the combined fee on a first attempt and 20% on a retake**. | User, 26 Sep, interpreting sheet values | medium | Pricing engine today applies a flat 50% for any outside-school registration. Needs a retake-aware rate stored per registration. The other "20%" values in the sheet (dropped 20%) are refund percentages, not this rule. **Import spike, 28 Sep (IS-03):** the pricing engine refuses self-study on a subject the school teaches unless it is a retake; with no history imported, 10 of 14 self-study rows (Nov 2026) were refused — all A-Level units or paper sets, which may be unit re-sits. Whether first-attempt self-study on a taught subject exists is still this question. **Forms, 7 Oct (SCHOOL_FORMS.md §2.5):** every form offers self-study at 50% and "ONLY 2nd entry" — never on a first attempt; no 20% rate appears on any form or fee list; the wording is "50% School fees", so the 50% may apply to the course fee only (→ A-16, Q-12). The first half of this assumption (50% on a first attempt) is refuted; the 20% retake rate is unsupported. | partly refuted |
| A-03 | The January-2027 rows inside the November-2026 tab are **preregistrations (deposits) for the upcoming January series** — the held-wallet / preregistration feature already built. | User, 26 Sep | medium | If one window legitimately covers two exam series instead, the session model needs multi-series windows. **Import spike, 28 Sep (IS-05):** the 18 January rows are all Biology papers (AS 9, "A.S./A.2." 7, "A.2." 2); imported as January entries, they need their own sessions. **Research, 28 Sep (DISCOVERY_RESEARCH.md §1):** they are not Cambridge — Cambridge runs no January series (confirmed in its handbook); most likely Pearson IAL units, which sit in January (strong inference: OxfordAQA also sits AS/A Level in January, and the sheet says "Paper", Cambridge's word, and never lists IAL Units 5–6). Whether they are entries or deposits is still this question. **Forms, 7 Oct (SCHOOL_FORMS.md §2.4):** the Biology A.S./A.L. (November 2026 / January 2027) form registers units 1–2 for November and 3–4 for January on one form — entries, each with its series; whether their money is a deposit stays with F-01 (→ Q-15). | refined |
| A-04 | The per-unit roster tabs are **teaching groups** — the natural input to timetabling. | User + our inference | low | If they are exam-entry or invigilation lists, they are a report to generate, not a scheduling input. | assumed |
| A-05 | The **Grade-10 core-subject mandate** (URD CORE-001..004: core subjects pre-selected, locked, cannot be dropped/swapped) still holds. | URD v2; **confirmed by user 26 Sep: "the core-subject is the unique thing to grade 10"** | high | — | confirmed |
| A-06 | Each **registration window is specific to one exam series**; a family may deposit against a future series from within the current window (A-03). | User, 26 Sep | medium | If windows span series, the `registrationSession` model and the one-active-per-(type, level) index change. **Forms, 7 Oct:** one cycle's form feeds November and January, unit by unit; F0b already lets a window feed several series (IS-14); the rework makes the series a property of each subject or unit of the session (SCHOOL_FORMS.md G-12). | refuted |
| A-07 | Grade 10 is **"treated the same as the others"** in the sense of using the same registration form and pricing; the core-subject rule is the one thing unique to them. | User, 26 Sep (resolved Q-01) | high | — | confirmed |
| A-08 | The **exam board's entry deadline** for each series is known from the board's published calendar and is entered by the admin per session; the school does not accept entries (or money for them) after it, and late entries with board late fees are not handled by this system. | Owner decision MO-10, 27 Sep (MONEY_AUDIT.md §6) | medium | If the school takes late entries with the board's late fee, the cut-off becomes a fee step instead of a hard stop. **Research, 28 Sep:** Pearson's entry fee doubles at its late date and trebles at its high-late date, and Cambridge charges a fee per late change — the boards take late entries, so the hard stop is the school's policy, and each board series has its own dates (DISCOVERY_RESEARCH.md §2). | assumed |
| A-09 | The school **closes its books with the bank monthly**: a correction to a day in the current month may change that day's report, but a month already closed stays as printed and its corrections are posted on the day they are made. | Owner decision on MO-11, 28 Sep (MONEY_AUDIT.md §6b) | medium | If finance reconciles weekly or quarterly, the boundary moves (a one-line change in the takings). Confirm with the school's finance person. | assumed |
| A-10 | Egypt's equivalency (Mo'adala) for British certificates follows the Ministry of Higher Education's guide for **admission in 2025**: eight subjects at grade C or better (Extended), at most five sittings in the three preceding academic years, the average percentage × 4.1, Arabic and religion passed at the Ministry's exams, and IAL counted as AS/A Level. | The Ministry's guide, read 28 Sep (DISCOVERY_RESEARCH.md §3); no 2026/27 guide found | high (primary source) — for 2025 admission only | The pathway advisor stores each rule with the admission year it applies to; a new guide changes the rules, not the code. Re-check against the 2026/27 guide when it appears. | assumed |
| A-11 | **Decree 148/2024** adds Arabic and history, taught in grades 10–12, at 10% each of the equivalency total, from the 2025/26 grade-10 cohort (this school's grade 11 in 2026/27). | Press reports only (DISCOVERY_RESEARCH.md §3, [E3]–[E7]); the decree text was not found | low | If it does not apply, the advisor drops the two national subjects from the total; if it does, how the 20% combines with the ×4.1 score is not published. | assumed |
| A-12 | A student who has finished grade 12 may still register for the **October, November and January series of the academic year right after it** (retakes to improve grades), not for the June after it. | Lead's default, 28 Sep, pending the owner (FEATURES_PLAN.md §0b) | low | If not, a graduate is refused every series after their grade-12 June. A school setting either way. | assumed |
| A-13 | A graduate registering under A-12 owes **no school fee** (the fee is for enrolled grades). | Lead's default, 28 Sep, pending the owner (FEATURES_PLAN.md §0b) | low | If not, the fee gate asks a graduate for a fee schedule that has no grade for them; the owner says which fee applies. A school setting. | assumed |
| A-14 | A registration for a series in a **new academic year whose school fee has not been opened yet** (a November window opening in June) proceeds without the fee, as the gate does today without a schedule. | Lead's default, 28 Sep, pending the owner (FEATURES_PLAN.md §0b) | low | If the owner prefers, such registrations wait until the new year's fee schedule opens, or ask for the fee later. | assumed |
| A-15 | **Grade 10 is registered by the school, not by a family form**: the school enters each grade-10 student's core subjects for June itself. | Lead's reading of the forms, 7 Oct (no grade-10 class on any June form; the core mandate A-05) | low | If grade 10 does fill a form of its own, the session's family-facing side covers grade 10 too. (→ Q-10) | assumed |
| A-16 | On a self-study retake the **board fee is paid in full; the 50% applies to the school's course fee** ("Self Study 50% School fees"). A "Retake in School 100%" pays both in full. | Lead's reading of the forms, 7 Oct | medium | If the 50% is on the total, the engine's current rule (50% of both) is right and the rework keeps it; either way a setting. (→ Q-12) | assumed |

---

## 3. Parked questions — no decisions until answered

| ID | Question | Why it matters | Hypotheses on the table | Status |
|---|---|---|---|---|
| Q-01 | "Grade 10 treated just the same as the others" — does that mean the **core-subject lock does not exist**, or only that they register through the same form? | Decides whether CORE-001..004 stay or go. | **Answered 26 Sep (user): (a).** Same form and pricing as other grades; the core-subject mandate is the one thing unique to grade 10. CORE-001..004 stay. | confirmed |
| Q-02 | What is **"carry forward"**? | Very different models depending on the answer. | (a) User's belief: a payment carried from a prior session, or a payment moved. (b) Our reading: Edexcel IAL unit result carried into this series (no re-sit, no new fee). Possibly both exist. **Evidence, 28 Sep (IMPORT_SPIKE.md IS-02):** all 19 carry-forward notes in the June 2023 tab are on "A.2." rows (Biology, Computer Science, Economics, Physics, Psychology), noted "Carry forward on June / November 2022" — consistent with (b), an AS result carried into an A2 entry, but not conclusive: 11 of the 30 "A.2." rows carry no note, the note is in the staff Signature column (which also fits (a)), and the subjects exist on both boards. **Research, 28 Sep (DISCOVERY_RESEARCH.md §1):** does not settle it. Cambridge's entry options say "June carry-forward" and "November carry-forward", and both dates are inside its 13-month limit; but Pearson's own rules also speak of unit marks "carried forward", and IAL units stay banked for the life of the specification (in the 2021 edition of Pearson's cash-in rules). 12 of the 19 rows are Biology (IAL in the 2026 tab, on the evidence there); only the one Computer Science row, which Pearson does not offer as an IAL, points to Cambridge alone. **Forms, 7 Oct (SCHOOL_FORMS.md §2.3):** the Cambridge Physics and Computer Science A Level forms offer "A.2. (Carry forward on June 2026)" and "(Carry forward on November 2025)" as entry routes beside "A.S." and "A.L.", and the Cambridge fee list prices AS (S1/S2), A2 (BY/CT) and the full A Level (AX/HX) separately — reading (b), in the school's own words. A payment carried forward, if it exists, is a separate matter for F-01. | answered 7 Oct: (b) — the A2 entry carrying its AS result forward from the named series |
| Q-03 | Who fills the **Signature column** and what does a signature mean? | Decides whether a teacher/coordinator approval step exists in the flow. | (a) teacher confirms they will teach the student; (b) coordinator approves the entry; (c) fee acknowledgement. | parked |
| Q-04 | What are the two **unlabeled lists** (24 and 28 students with section)? | Unknown; may be a routine report we should generate. | unpaid? unconfirmed? self-study? a class allocation? | parked |
| Q-05 | What **identifier** does the school use for a student with the exam boards (candidate number / centre number)? Where does it live? | Import matching, board-entry export, results import. | Lives in a board portal or another sheet. **Research, 28 Sep (DISCOVERY_RESEARCH.md §2, §5):** Cambridge assigns a four-digit candidate number per series (carry-forward needs the previous one) under a five-character centre number; Pearson gives each candidate a permanent 13-character UCI and a four-digit candidate number per series. Still to ask: the school's centre numbers, and whether it enters directly or through the British Council. | parked |
| Q-06 | What does the **money record** look like? | Finance import, day-one migration, refund/receipt reality. | Another sheet, paper receipt book, or both. | parked → F-01 |
| Q-07 | Do students carry **held/deposit** money across years (e.g. a Jan deposit made in November of grade 11 used in grade 12)? | Held-wallet lifecycle and year rollover. | — | parked |
| Q-08 | **When does a student's grade change?** Today grades move when registration windows close (10→11 at a November close, 11→12 at a June close, 12→graduated at a November close), so a new grade-10 student is grade 11 by the June window where the grade-10 core-subject rule applies, and pays grade 11's school fee. | Core-subject rule (A-05), school fee per grade, who may register after graduation. | (a) Derive the grade from the year the student entered grade 10 and the academic year of the session (1 July boundary) — recommended (STATE_AUDIT.md §6). (b) One rollover on 1 July. (c) Keep window-driven progression with corrected triggers. And: may a student register for the November after graduating? Meanwhile automatic progression is off (`AUTO_GRADE_PROGRESSION=false`, STATE_AUDIT.md ST-13). | **answered 28 Sep (owner): (a)** — the grade changes once a year, at the end of the June session after its last exam; grade 10 has no November session, and is grade 11 in the November after its June. Built in FEATURES_PLAN.md F0. The November after graduation: A-12. |
| Q-09 | **Which SCL, and what can it give us?** Desk research (DISCOVERY_RESEARCH.md §4) points to Edurealm's "SCL – School Communication & Learning Management System" (Cairo), which **claims to keep records across years** — against this file's opening premise — and offers CSV export and an API, but nothing on exam-board entries. | Whether the grade 9→10 import can come from SCL, and why the school stops using it at grade 10. | (a) The school wipes records at year end: SCL's 2025.1 release notes list wipe options at promotion, which would reconcile its claim with this file's premise. (b) The school means exam registrations and results, which SCL does not model. (c) The school's licence covers only the lower grades. The school's SCL login address confirms the product; ask which of these holds and whether it can export the grade-9 roster. | parked |
| Q-10 | **How is grade 10 registered for June?** No June 2027 form lists a grade-10 class. | The whole grade-10 flow (A-01, A-05, A-15). | (a) the school enters the core subjects itself, no form; (b) a grade-10 form is published later in the year; (c) grade 10 uses the same forms with a class added. | parked (7 Oct) — default (a) |
| Q-11 | The refund windows count **weeks from the first lesson**: the subject's own first lesson (per teacher group), or one date for the cycle? Is the November policy (50% in weeks 3–6, 0% after) the rule for every short cycle? | The refund computation on a drop (SCHOOL_FORMS.md G-19). | per cycle; per group. | parked (7 Oct) — default: per session type from the cycle's course start, a group's first lesson overriding when known |
| Q-12 | "Self Study 50% **School** fees": is the board fee paid in full on a self-study retake and only the course fee halved? On "Retake in School 100%", is the board fee the series' fee again? | The pricing engine (A-02, A-16; G-07, G-08). | course fee 50% + board fee 100%; or 50% of the total. | parked (7 Oct) — default A-16 |
| Q-13 | **One-paper retakes** (Edexcel IGCSE Mathematics 1H / 2H; Cambridge sciences Paper 41/42; ICT theory; Arabic Paper 1 / 2): does the board enter one component, or does the school enter the whole qualification and price one paper? What exactly is carried from the named series? | Papers per line and the board-fee basis (G-10, G-16); F4's entry file. | the school's price for one paper; the board's entry rules per syllabus. | parked (7 Oct) — default: a one-paper line priced by the school's per-paper fee |
| Q-14 | The **course fees** (the school's teaching fee) per subject and per unit, per cycle. | F-02, G-16. | a list exists at the school. | parked (7 Oct) — entered per session subject at set-up |
| Q-15 | **Payment timing**: in one go at registration, in instalments, or a deposit now and the balance later (A-03)? What "end date" should a parent see? | G-28; the held wallet. | — | parked (7 Oct) — default: one due date per line, instalments as an exception |
| Q-16 | **Arabic A Level**: the IAL (YAA01) and the GCE (9AA1) are both offered through one form, chosen with the teacher. Does the family choose, or the teacher? Are WAA01 / WAA02 on the June 2026 list the IAL's two units? | G-14. | — | parked (7 Oct) — default: two qualifications under one subject, chosen with the teacher |
| Q-17 | **Cash-in, late cash-in, certificate splitting**: which board, which fee, which deadline, and who asks — the family or the school on their behalf? | G-22. | — | parked (7 Oct) — default: service lines with a fee per series, requested at the desk or by the family |
| Q-18 | **Edexcel remarks**: which services the school offers (review of marking, clerical re-check, access to scripts) and at what fee. | G-21. | — | parked (7 Oct) — default: the board's published services, fees entered per series |

---

## 4. Artefacts to obtain — build on assumptions now, revisit when obtained

| ID | Artefact | What it would settle | Status |
|---|---|---|---|
| F-01 | The **finance record** for the same November 2026 session (who paid what, when, receipt numbers, refunds). | Q-06, money model, refund percentages, receipt lifecycle, daily-takings shape. | wanted |
| F-02 | The **fee list**: subject/unit prices, the school fee, and what 20% / 50% mean in EGP. | A-02, pricing engine, fee split, school-fee schedule. | half obtained 7 Oct: the **board** fees per unit or option per series for June 2026, January 2026 and November 2026 (SCHOOL_FORMS.md §3); the school's course fees and the school fee still wanted (Q-14) |
| F-03 | The **Google Form** itself (exact questions and options). | Parent-facing registration form parity; drop flow entry point. | obtained 7 Oct: all 25 June 2027 forms and 4 of the 18 November 2026/January 2027 forms, read question by question (SCHOOL_FORMS.md §2) |
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
