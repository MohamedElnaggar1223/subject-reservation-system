# The school's registration forms — register and gap map

**Date:** 7 October 2026
**Why this file exists:** On 7 October the school's admin told the owner that subject
reservations and fees paid are her priority and that the current admin side is "very hard to
use, counter intuitive and not usable that much" (FEATURES_PLAN.md §0c). The forms the school registers with, and its fee sheets, are now the
ground truth. This file reads every form and every option, records the fee lists, and maps each
element onto the system as it is today. It is Phase 1 of the plan the owner accepted: nothing
is designed here; §4–§7 are the input to the design (Phase 2), which waits for the owner's
confirmation of this reading.

**Sources.** All nine artefacts the owner shared on 7 October.

| # | Artefact | Read how | State |
|---|---|---|---|
| 1 | Drive folder "June 2027" (`1L63fF-ho5p_eL47VHK5Er_-EnU_3GM8-`): 25 Google Forms, the live forms (not copies), last edited 12–19 Sep 2026 | the preview page of each form (`/forms/d/<file id>/preview`) carries the form's definition even when the form is closed to responses; the Drive connector cannot read a Form | all 25 read |
| 2 | "June 2027 Registration links (Cambridge/Edexcel/Oxford)" PDF | the 25 links extracted from the PDF; 16 forms open, read from their public page; 9 closed, read from the folder (row 1) | complete |
| 3 | "November 2026/January 2027 Registration links (Cambridge/Edexcel)" PDF | 18 links; 4 forms open and read; 14 closed to responses and not in the folder | 14 forms: titles only |
| 4 | Cambridge Registration Fees June 2026 (Year 11 & 12) | pdftotext | read |
| 5 | Edexcel June 2026 (Registration Fees Y.11 & 12) | pdftotext | read |
| 6 | Edexcel January 2026 (Registration Fees), printed 2 Oct 2025 | pdftotext | read |
| 7 | A.S./A.L. Edexcel Registration fees (November 2026) | pdftotext | read |
| 8 | Edexcel November 2026 (Registration Fees), IGCSE | pdftotext | read |
| 9 | Enquiry About Results Service – Cambridge, June 2026 | pdftotext | read |

The form definitions were parsed from the public page's embedded data (question, type,
required, options, branching). The scripts and the full dumps are in
`.audit/school-forms-evidence/` (ignored by git). **Data rule:** the forms name teachers; this
file names none (T1, T2, T3 per form) and holds no family data (the forms are blank
definitions). The owner's exact words from the meeting are in FEATURES_PLAN.md §0c.

---

## 1. How the school registers today (what the artefacts show)

1. For each cycle the school publishes a **links sheet**: one row per subject — the subject,
   its board, the teacher(s) who teach it this cycle (or "Retake (Self Study ONLY)", or an
   external team), and the link to that subject's form. June 2027: 17 O.L. rows and 8
   A.S./A.L. rows, 25 forms. November 2026/January 2027: 13 and 5, 18 forms. **The links sheet
   is the session definition**: which subjects are open this cycle, with which board, taught by
   whom, and whether first entries are taken or only retakes.
2. One **Google Form per subject per cycle**. The family fills one form for each subject. Every
   form has the same seven identity questions, then the subject's own choices (teacher; first
   entry or retake; which papers; self-study), then a confirm-or-drop choice, the refund policy
   to acknowledge, and a declaration. No price appears anywhere, there is no payment step, and
   no deadline is shown.
3. The responses land in the response sheet the desk works from (DISCOVERY.md §1: one row per
   student per subject, the fee note typed by staff).
4. The **board fee lists** (artefacts 4–8) give, per board and per series, the board's fee per
   syllabus-and-option (Cambridge) or per unit (Edexcel). The school's own course fee (the
   teaching) is in none of the artefacts (F-02 is half obtained).
5. The **enquiry-about-results sheet** (artefact 9) prices Cambridge's four services per
   component at an IGCSE rate and an AS/A Level rate, with a refund rule.
6. The June 2027 forms were made in **September 2026**: registration for June opens nine months
   before the series, and the refund windows run "from the first lesson" — the cycle is the
   taught course plus the exam entry. The November/January forms carry a shorter refund policy
   (50% from week 3 to week 6). A "session" to the school is a cycle of teaching and entry,
   not a date window.

---

## 2. The forms, one by one

### 2.1 The block every form shares

| Q | Question | Type | Notes |
|---|---|---|---|
| 1 | Student full Name | short answer, required | left optional on one form by mistake |
| 2 | Grade Level & Class | dropdown, required: 11A, 11B, 11C, 11D, 11E, 12A, 12B, 12C, 12D | two June forms lack 11E; one carries a leftover "Option 9". **No grade-10 class on any form, June included.** |
| 3 | Student Mobile Number | short answer, required | |
| 4 | Student Email address | short answer, required | the de-facto identity (IS-06) |
| 5 | Guardian Name | short answer, required | |
| 6 | Guardian Email Address | short answer, required | |
| 7 | Guardian Mobile Number | short answer, required | |
| … | the subject's own questions (§2.2–§2.4) | | |
| n−2 | "Please choose one of the options": I confirm my registration / I will drop the course (some forms: "the subject") | single choice, required | the drop intent is submitted on the same form (IS-08) |
| n−1 | Refund Policy — one checkbox "I confirm that I read the refund policy" | required | **June:** 100% of the course fees if dropped within 2 weeks from the first lesson; 50% from 3 weeks from the first lesson; 0% from 4 weeks from the beginning of the course. **November:** 100% within 2 weeks; 50% from 3 to 6 weeks; 0% after 6 weeks. One June form shows the box without the policy text. |
| n | Student Declaration — "I confirm that the information given in this form is true, complete and accurate." | checkbox, required | |

Every form is one page: no sections, no branching, nothing conditional. Every question is
required except the per-unit questions of Mathematics A.S./A.L., which must be optional.

### 2.2 June 2027 — O.L. (17 forms)

"SS Y/N" = the question "Self Study 50% fees (ONLY 2nd entry)" with Yes / No. "All Papers Y/N" =
"Retake Self Study 50% fees (All Papers)" with Yes / No. "Paper 41/42" = "Retake Self Study 50%
fees (Paper 41/42 ONLY)" with From June 2026 / From November 2026 / None.

| # | Form (board) | Teacher | The subject's questions | Notes |
|---|---|---|---|---|
| 1 | Arabic O.L. (Cambridge) | choice: T1, T2, T3, "Self study (Only for 2nd entry ONLY)" | "Please choose from below", one of five: First Entry in School 100% fees (All Papers) · Retake in School 100% fees (All Papers) · Retake Self Study 50% fees (All Papers) · Retake in School 100% fees (One paper ONLY) From June 2026 · Retake Self Study 50% fees (One paper ONLY) From June 2026 | the only form that spells out all five entry types; which paper is not asked (the November form asks Paper 1 / Paper 2) |
| 2 | Biology O.L. (Cambridge) | choice: T1, T2, T3, Self Study 50% (Second entry ONLY) | All Papers Y/N · Paper 41/42 | closed to responses; read from the form |
| 3 | Business O.L. (Cambridge) | one teacher, named in the description | SS Y/N | closed; read from the form |
| 4 | Chemistry O.L. (Cambridge) | choice: T1, T2, T3, Self Study 50% | All Papers Y/N · Paper 41/42 | no 11E |
| 5 | Combined Science O.L. (Cambridge) | one teacher (description) | All Papers Y/N · Paper 41/42 | |
| 6 | Computer Science O.L. (Cambridge; an external team) | one teacher (description) | All Papers Y/N · Paper 41/42 with **From June 2025 / From November 2025** | last year's series left in the options; no 11E; "Option 9" |
| 7 | English As a Second Language (Oxford) | choice: T1 (Oxford), T2 (Oxford), Self Study 50% (ONLY 2nd entry) | SS Y/N | the title carries no session |
| 8 | Environmental Management O.L. (Cambridge) | one teacher (description) | SS Y/N | |
| 9 | French O.L. (Cambridge) | one teacher (description) | SS Y/N | closed; read from the form |
| 10 | German O.L. (Cambridge) | one teacher (description) | SS Y/N | closed; read from the form |
| 11 | Global Perspectives O.L. (Cambridge) | one teacher (description), "(ONLINE ONLY)" | SS Y/N | taught online |
| 12 | Global Citizenship O.L. (Cambridge) | one teacher (description) | SS Y/N | the refund box without the policy text |
| 13 | Human Biology O.L. (Edexcel GCSE) | one teacher (description) | SS Y/N | |
| 14 | ICT O.L. (Cambridge; an external team) | one teacher (description) | All Papers Y/N · "Retake Self Study 50% fees (Theory Paper ONLY)": From June 2026 / From November 2026 / None | the one-paper retake is the theory paper |
| 15 | Mathematics O.L. (Edexcel GCSE) | choice: T1, T2, T3, Self Study 50% (ONLY 2nd entry) | All Papers Y/N · "Retake Self Study 50% fees (One Paper ONLY)": 1H / 2H / None | closed; read from the form; the one-paper retake names the paper, not the prior series |
| 16 | Physics O.L. (Cambridge) | choice: T1, Self Study 50% | All Papers Y/N · Paper 41/42 | closed; read from the form |
| 17 | Psychology O.L. (Oxford) | one teacher (description) | SS Y/N | closed; read from the form |

### 2.3 June 2027 — A.S./A.L. (8 forms)

| # | Form (board) | Teacher | The subject's questions | Notes |
|---|---|---|---|---|
| 1 | Arabic A.L. (Edexcel) | choice: T1 "(Edexcel YAA01)", T2 "(Edexcel 9AA01)", Self Study 50% (second entry only) | SS Y/N | **the teacher choice chooses the qualification**: the IAL (YAA01) and the GCE (9AA1) Arabic A Levels in one form; closed; read from the form |
| 2 | Biology A.S./A.L. (Edexcel IAL) | one teacher (description) | checkboxes, any number: A.2. Paper 5 (WBI15/01) First entry 100% June 2027 · A.2. Paper 6 (WBI16/01) First entry 100% June 2027 · A.S. Paper 1 (WBI11/01) Self Study 50% 2nd entry ONLY · A.S. Paper 2 (WBI12/01) SS 50% · A.S. Paper 3 (WBI13/01) SS 50% · A.2. Paper 4 (WBI14/01) SS 50% · A.2. Paper 5 (WBI15/01) SS 50% · A.2. Paper 6 (WBI16/01) SS 50% | **per unit, with the board's unit code**; in June only units 5 and 6 are taught; the other four (and 5 and 6 again) are self-study retakes; no separate SS Y/N |
| 3 | Chemistry A.S. (Cambridge) | one teacher (description) | "Kindly specify the Components": Chemistry A.S. / Chemistry A.L. · SS Y/N | AS, or the full A Level in one sitting |
| 4 | Computer Science A.S./A.L. (Cambridge) | none listed (the November links sheet says "External") | Components: Computer Science A.S. · A.2. (Carry forward on June) · A.2. (Carry forward on November) · A.L. · "Self Study (ONLY 2nd entry)" Y/N | **the four Cambridge routes**: AS; A2 carrying the AS result forward from a June or a November sitting; A Level in one sitting |
| 5 | French A.S./A.L. (Cambridge) | one teacher (description) | Components: French A.S. / French A.L. · SS Y/N | |
| 6 | Mathematics A.S./A.L. (Edexcel IAL) | per unit | one optional question per unit — P1: T1 (ONLINE ONLY) / Self Study 50% School fees (2nd entry ONLY) · P2: the same · P3: T1 / SS · P4: T1 / SS · M1: T2 / T1 / SS · S1: T2 / T1 / SS — then "Self Study (ONLY 2nd entry)" Y/N | **the clearest per-paper form**: each unit chosen with its own teacher or as self-study; P1 and P2 taught online only; the description says "Edexcel June 2027 session"; student name left optional by mistake |
| 7 | Physics A.S./A.L. (Cambridge) | T1 inside the AS option | Components: Physics A.S. in School 100% fees (T1) · Physics A.2. (Self Study 50% fees in June 2027) · A.2. Self Study 50% (Carry forward on June 2026) · A.2. Self Study 50% (Carry forward on November 2025) · SS Y/N | A2 is self-study only this cycle; each A2 option names the series the AS result is carried from |
| 8 | Psychology A.L. (Cambridge) | one teacher (description) | SS Y/N | closed; read from the form |

### 2.4 November 2026 / January 2027 (18 links; 4 forms readable)

The four readable forms:

- **Mathematics O.L. (November 2026), Edexcel** — description "(SECOND ENTRY - SELF STUDY
  ONLY)"; All Papers Y/N; "(One paper ONLY)": 1H / 2H / None; the November refund policy. No
  teacher: the subject is in this cycle only for re-sitters.
- **Combined Science O.L. (November 2025), Cambridge** — last year's form, still linked; one
  teacher; All Papers Y/N; the November policy.
- **Biology A.S./A.L. (November 2026 / January 2027), Edexcel IAL** — "FIRST ENTRY"
  checkboxes: A.S. Paper 1 (WBI11/01) November 2026 · A.S. Paper 2 (WBI12/01) November 2026 ·
  A.S. Paper 3 (WBI13/01) January 2027 · A.2. Paper 4 (WBI14/01) January 2027 · None of them;
  "(50% SELF STUDY)" retake checkboxes: Papers 1–4 from November 2025 · Papers 1–6 from January
  2026 · None of them; SS Y/N; the November policy. **One form, two board series, each unit
  assigned to its series** — IS-05 and IS-14 in the school's own words. With the June form,
  Biology IAL runs units 1–2 in November, 3–4 in January, 5–6 in June: a full A Level across
  three series in one academic year.
- **Arabic O.L. (November 2026), Cambridge** — All Papers Y/N; "(One Paper ONLY)": Paper 1 /
  Paper 2 / None; teacher choice T1, T2, T3, "Self Study 50% School fees"; the November policy.

Closed to responses, titles only (14): Computer Science A.L.; English Oxford O.L.; ICT O.L.;
Biology O.L.; French O.L.; Environmental Management O.L.; Physics O.L.; Mathematics A.S./A.L.
(Nov.26/Jan.27); Arabic A.L. (Edexcel) January 2027 ONLY; Computer Science O.L.; Human Biology
O.L.; Chemistry O.L.; Psychology O.L.; Physics A.S./A.L. (November 2026).

The links sheet for this cycle, which is the part that matters: Arabic O.L. Cambridge (three
teachers; one teacher's line also says Edexcel); **Biology, Chemistry and Physics O.L.
(Cambridge), English ESL (Oxford) and Mathematics O.L. (Edexcel) are "Retake (Self Study
ONLY)"** — no teaching, re-sitters only; Computer Science and ICT O.L.: an external team;
Combined Science, Environmental Management, French (Cambridge), Human Biology (Edexcel),
Psychology (Oxford): one teacher each. A.S./A.L.: Arabic A.L. Edexcel IAL (one teacher; the
form says January 2027 only); Biology Edexcel IAL (one); Computer Science Cambridge
"External"; Mathematics Edexcel IAL (three teachers); Physics A.S. Cambridge (one).

### 2.5 The vocabulary, option by option

| Option as written | What it means | Fee effect | What the model must hold |
|---|---|---|---|
| First Entry in School 100% fees (All Papers) | a first sitting, taught at school, all the subject's papers | full course fee, full board fee | the default line |
| Retake in School 100% fees (All Papers) | a re-sit, taught again | full course fee | a retake flag with teaching |
| Retake Self Study 50% fees (All Papers) / Self Study 50% fees (ONLY 2nd entry) / Self Study 50% School fees | a re-sit without teaching; **only on a second entry**, never a first | "50% School fees": half the school's course fee; the board fee is not said to change (Q-12) | self-study as a retake-only mode; the 50% basis |
| Retake … (One paper ONLY) From June 2026 / From November 2026 | a re-sit of one component, the rest carried from the named earlier sitting; the paper is fixed per subject: Paper 41/42 (the Cambridge extended theory paper), the ICT theory paper, Mathematics 1H or 2H, Arabic Paper 1 or 2; "in School" or "Self Study" | the school's own price for one paper (the fee lists price Edexcel IGCSE Mathematics per paper) | papers per line; the prior sitting a line carries from |
| None | no one-paper retake | — | — |
| A.S. / A.2. / A.L. | the Cambridge staged route (AS now, A2 later with the AS carried forward) or the full A Level in one sitting | three prices on the Cambridge list: AS, A2, A Level | the route as a choice inside one subject, the option code and price following it |
| A.2. (Carry forward on June 2026 / November 2025) | the A2 entry carrying an AS result from that series | the A2 price | the carried-from series on the line — DISCOVERY Q-02 reading (b), now in the school's words |
| Self Study (ONLY 2nd entry) Yes / No | the self-study flag again, as its own question | — | redundant with the teacher/entry choice; the desk reconciles the two today |
| (ONLINE ONLY) | the teacher teaches online this cycle | — | a mode on the teacher's group |
| an external team (named on the links sheet) / External | an outside provider teaches the subject | — | a provider as the "teacher" |
| Retake (Self Study ONLY) — on the links sheet | the subject is in this cycle only for re-sitters, untaught | — | availability per session subject |
| I confirm my registration / I will drop the course | the family's intent; drops are submitted on the same form | a drop follows the refund policy | the drop flow (exists) |
| I confirm that I read the refund policy / Student Declaration | consent | — | a consent record per registration |

---

## 3. The fee lists — board fees per board per series (EGP)

### 3.1 Cambridge, June 2026 (per syllabus and option code)

| Group | Subject | Syllabus | Option | Fee |
|---|---|---|---|---|
| IGCSE | Arabic | 3180 | A | 9,850 |
| IGCSE | Biology | 0970 | CX | 10,850 |
| IGCSE | Business Studies | 0986 | AX | 9,850 |
| IGCSE | Chemistry | 0971 | CX | 10,850 |
| IGCSE | Combined Science | 0653 | CX | 10,850 |
| IGCSE | Computer Science | 0984 | AX | 9,850 |
| IGCSE | French | 7156 | X | 12,550 |
| IGCSE | German | 7159 | Y | 12,550 |
| IGCSE | ICT | 0983 | DY | 12,950 |
| IGCSE | Physics | 0972 | CX | 10,850 |
| AS Level | Biology / Chemistry / Physics | 9700 / 9701 / 9702 | S1 / S2 | 14,100 each |
| AS Level | Computer Science | 9608 | SY | 11,400 |
| A2 Level | Biology / Chemistry | 9700 / 9701 | BY / CT | 11,400 each |
| A2 Level | Computer Science | 9618 | BY / CT | 12,450 |
| A2 Level | Physics | 9702 | BX / CQ | 11,400 |
| A Level | Biology / Chemistry / Physics | 9700 / 9701 / 9702 | AX / HX | 18,600 each |
| A Level | Computer Science | 9618 | AY | 16,950 |

What it says: one price per (syllabus, option code); a syllabus has up to three prices by
route, so the form's "A.S. / A.2. / A.L." choice is a price choice, and the staged route costs
more than the single sitting (14,100 + 11,400 against 18,600). An option pair (S1 / S2, BY / CT)
is one price. Cambridge prices are per qualification, not per paper: the "one paper only" retake
is the school's price, not the board's. Computer Science AS still carries the old syllabus code
9608. Psychology, Global Perspectives, Global Citizenship, Environmental Management, English
and Human Biology are absent: the list is one cycle's "Year 11 & 12" list, not the catalogue.

### 3.2 Edexcel, per series (per unit)

| Series | Qualification | Unit | Code | Fee |
|---|---|---|---|---|
| June 2026 | IAL Arabic | — | WAA01 / WAA02 | 8,950 / 9,350 |
| June 2026 | IAL Mathematics | P1, P2, P3, P4 | WMA11–WMA14 | 4,800 each |
| June 2026 | IAL Mathematics | M1, M2, S1 | WME01, WME02, WST01 | 4,450 each |
| June 2026 | IAL Biology (listed under "IGCSE") | Paper 5, Paper 6 | WBI15, WBI16 | 4,450 each |
| June 2026 | IGCSE Mathematics | one row per paper | 4WM1H, 4WM2H | 4,600 each |
| January 2026 | IAL Biology | 3, 4 | WBI13, WBI14 | 4,550 each |
| January 2026 | IAL Mathematics | P1–P4 | WMA11–WMA14 | 4,910 each |
| January 2026 | IAL Mathematics | M1, S1 | WME01, WST01 | 4,550 each |
| November 2026 | IAL Mathematics | P1, P2 | WMA11, WMA12 | 5,140 each |
| November 2026 | IAL Mathematics | P3, P4 **(RETAKE ONLY)** | WMA13, WMA14 | 5,140 each |
| November 2026 | IAL Mathematics | M1, S1 | WME01, WST01 | 4,790 each |
| November 2026 | IAL Biology | 1, 2 | WBI11, WBI12 | 4,790 each |
| November 2026 | IAL Biology | 3, 4 **(RETAKE ONLY)** | WBI13, WBI14 | 4,790 each |
| November 2026 | IGCSE Human Biology | — | 4HB1 | 9,840 |
| November 2026 | IGCSE Mathematics | one row per paper | 4MA1H, 4MA2H | 9,840 each |

What it says: the board fee is **per unit per series**, and the same unit costs differently in
each series (P1: 4,800 in June 2026, 4,910 in January 2026, 5,140 in November 2026);
"RETAKE ONLY" marks units a series offers only to re-sitters; Arabic IAL is two units; IGCSE
Mathematics is priced per paper by the school (two rows) although the board enters the
qualification.

### 3.3 Enquiry About Results — Cambridge, June 2026 (per component)

| Service | IGCSE | AS / A Level |
|---|---|---|
| 1 — full clerical re-check | 1,650 | 1,890 |
| 1S — the same, with a copy of the script | 3,590 | 3,640 |
| 2 — full re-marking including re-check | 3,820 | 4,550 |
| 2S — the same, with copies of the scripts | 5,760 | 6,530 |

If the enquiry changes the grade, the British Council refunds the fee less 100 EGP per
component. What it says: four services (two, each with or without a script copy), two rates by
level, per component, per series, and a refund rule with a fixed deduction.

---

## 4. The gap map

Each row: one element of the school's artefacts, what the system has today (file or table
named where it matters), a verdict, and the change the element implies. Verdicts: **fits**,
**partial**, **contradicts**, **missing**.

| # | The school's artefact has | Today's system has | Verdict | Change implied |
|---|---|---|---|---|
| G-01 | A cycle is a links sheet: subject → board → teachers → form (§1) | a window: free-text name, type, series year, **one qualification level**, start, end, the board series it feeds (one default per board) and per-subject routes (`registration_session`, `session_board_series`, `session_subject_series`); **no subject list** — every active catalogue subject of the window's level is registrable (`registration.services.ts` `getAvailableSubjects`); teachers linked to subjects globally (`subject_teacher`), not per cycle; no "retake only", "online", "external" | contradicts | the session names its subjects, each with its board, its series, its teachers (mode: in school, online, external, none) and its entry options; one session spans O.L. and A.S./A.L.; the name derived from type and year |
| G-02 | One form per subject; the family fills one per subject | one registration per (student, session, subject); the desk and the parent register several subjects in one go | fits, and beats it | keep: the per-subject block of the form becomes one line of one registration |
| G-03 | Q2 Grade Level & Class (11A–12D) | sections and memberships (F0a, `section`, `section_membership`) | fits | pre-filled from membership, never asked |
| G-04 | Q1, Q3–Q7 identity and guardian contact | accounts, parent–student links, desk onboarding | fits | pre-filled; the desk's find-or-create |
| G-05 | **No grade-10 class on any form** | A-01: grade 10 sits June and registers the same way; the core mandate A-05 | contradicts A-01 as stated | Q-10: how grade 10 is registered — the school itself, core subjects, no form? |
| G-06 | Teacher choice per subject from this cycle's one to three teachers, or self-study | `registration.teacher_id` optional, from `subject_teacher`; no per-cycle list; no online/external mode; F1 holds teaching groups | partial | teachers per session subject (per unit for IAL Mathematics); the choice places the student in that teacher's group (F1); changeable later by staff (point 10) |
| G-07 | Entry type: first entry · retake in school · retake self-study · one paper only (in school or self-study) from a named series | `is_retake` + `taken_outside_school` (`pricing.services.ts`: 50% of course fee and board fee alike); the retake detected from history or set by staff; no one-paper retake; no prior-sitting link | partial | an entry type per line — first entry, retake taught, retake self-study — with the papers sat (all, or named) and the sitting it carries from; the price follows the type |
| G-08 | "Self Study 50% **School** fees" | the 50% applied to `courseFee` and `registrationFee` both | contradicts (probably) | Q-12; the default to build with: 50% of the course fee, the board fee at 100%; both as settings |
| G-09 | Self-study only on a second entry | the engine refuses outside-school unless a retake or a subject the school does not teach | fits | keep; make it a rule an exception can lift (point 9) |
| G-10 | Per-paper entry with the board's unit codes (Biology WBI11–16; Mathematics P1–S1); one-paper retakes; "some papers required" (point 2) | F0b: a registrable row may be a unit or a paper set (`subject_unit`); `exam_unit` per board; `qualification_unit.requirement` (required / optional) in the catalogue; no paper choice inside a registration; required papers enforced nowhere | partial | a line = subject + the papers entered this series, each priced; required papers enforced from `qualification_unit`; the catalogue already holds the units |
| G-11 | A.S. / A.2. (carry forward on <series>) / A.L. | one qualification level per subject row; `qualification_option.carry_forward` flag; no carried-from series on a registration; the three routes would be three catalogue rows | partial | one subject, a route choice; the option code and price follow the route; the carried-from series recorded (feeds F4's entry file) |
| G-12 | A2 units taught in June, AS units in November and January (Biology IAL) | subject routes to a series per window, **per subject**, not per unit; one level per window | partial | per-unit series inside one session; a session across levels |
| G-13 | "Retake (Self Study ONLY)" subjects; "RETAKE ONLY" units | nothing | missing | availability per session subject and unit: first entry and retake · retake only · self-study only |
| G-14 | Two Edexcel Arabic A Levels in one form, chosen through the teacher (IAL YAA01, GCE 9AA1) | one board and one qualification per subject row | partial | two qualifications under one subject line, chosen with the teacher |
| G-15 | Online-only teaching; an external team | nothing | missing | a mode on the session's teacher assignment |
| G-16 | A board fee per (syllabus + option · unit) **per series**; the same unit priced differently per series | `subject.registration_fee`, one constant; no fee on `exam_unit` or `qualification_option` | contradicts | a board fee keyed by (board series, unit or option); the course fee per (session, subject, unit); the line snapshots both — the ledger is untouched |
| G-17 | No prices on the forms; money at the desk | desk registration and collection, receipts, takings, escrow, the 09 invariants | fits | keep the money core as it is |
| G-18 | Confirm / drop on the form | statuses, change requests, direct drop | fits | the drop keeps its refund computation |
| G-19 | Refund policy in **weeks from the first lesson**; June and November differ | `refund_window`: absolute dates per session or academic year (`refund.services.ts`); `custom_refund_percent` exception | partial | windows in weeks from the course start, per session type, overridable per subject or group; computed from the group's first lesson (F1) or the session's course start; a percentage per case stays an exception (IS-08) |
| G-20 | The refund acknowledgement and the declaration, both required | nothing recorded | missing | a consent record per registration: text version, who, when, channel (app, or "signed at the desk") |
| G-21 | EAR: four services, an IGCSE and an AS/A Level rate, per component, per series; refund less 100 EGP on a grade change | remarks: four service types; a fee per (council, service) per paper (`remark_fee_schedule`); deadlines per (council, session, service); `fee_refunded` boolean; items per paper | partial | a fee per (board, level, service, series); the "with copy" variants; the refund amount = fee − deduction, to escrow; Edexcel's own services with their fees — "remark differs per board" (point 4) |
| G-22 | Services: cash-in, late cash-in, split certificates (point 3) | nothing family-facing; F4 planned entries per unit and award | missing | service lines on a registration or a student — cash-in (Pearson's award claim), late cash-in, certificate split — each with a board fee per series and its own deadline, through the same checkout and receipts |
| G-23 | Notifications (point 5): broadcast, batch, direct; email and WhatsApp; not deletable by families | in-app and email; broadcast to all / students / parents / grade groups; scheduled announcements; families can only mark read (the only delete is the admin cancelling a pending announcement, `notification.routes.ts`) | partial | direct and batch sends to chosen families or students from any list (a session's unpaid, a group, a section); templates; a delivery log per recipient; WhatsApp postponed (no business account) |
| G-24 | Repeating reminders (point 6) | one 24-hour window-closing reminder (NOT-002, `jobs/session-closer.ts`) | missing | reminder schedules: payment due, deadline near, repeating until paid or done, per session with overrides, logged |
| G-25 | School fees pushed into pending payments (point 8) | a schedule per year and grade with `opens_at`; it shows in the family's status and the desk's "due" list; the parent pays through the pipeline | partial | the admin pushes the fee (a charge) to chosen families or grades with a due date; it appears in pending payments; the same for any ad-hoc charge |
| G-26 | Exceptions on everything (point 9) | seven types per student (`exception`): discount %, discount fixed, custom price, fee waiver, deadline extension, late registration, custom refund %; scope session / subject | partial | an exception = (rule, scope: student / family / subject / line, value, until, reason, by) over every percentage (self-study 50%, retake rate, refund %), every deadline (window, board, payment) and every gate (self-study on a first entry, a one-paper retake, required papers, the school fee); one screen, one audit trail |
| G-27 | The teacher changeable later (point 10) | `teacher_id` set at registration; no change endpoint (`registration.routes.ts`) | missing | staff change the teacher on a line; the group membership moves; audited |
| G-28 | Payment detail for parents (point 11): date, end date | payments with dates; receipts | partial | per line: amount, paid, outstanding, due date, instalments if any, receipt; per family: a statement (Q-15 for "end date") |
| G-29 | Form drift: last year's series in the options (June 2025 / November 2025), a 2025 form linked for 2026, 11E missing, a stale "Option 9", a name left optional | — | — | the session generates what the family sees; no copy-and-edit of last year's form |
| G-30 | The forms never mention a deadline; the fee lists are per series | MO-10's hard stop per board series; windows feed series (F0b) | fits | keep underneath; never assembled by hand — the session picks the series when it picks a subject's board |

Count: 7 fit (G-02, 03, 04, 09, 17, 18, 30), 12 partial, 4 contradict (G-01, 05, 08, 16),
6 missing (G-13, 15, 20, 22, 24, 27), one observation (G-29). What fits is the family's
identity, the desk, the money core and the board series underneath; what contradicts is the
session itself, the fee model and the self-study basis; what is missing is per-cycle
availability, consent, services, reminders and the teacher change.

---

## 5. The admin's eleven points, each against the forms and the system

| Point (FEATURES_PLAN.md §0c) | What the forms show | Gap rows | Verdict |
|---|---|---|---|
| 1. Subjects registrable per paper | Biology IAL and Mathematics IAL per unit with codes; one-paper retakes on seven O.L. forms | G-10, G-12 | partial today; the catalogue holds the units, the registration does not |
| 2. Some papers required | not on the forms (the forms trust the family); the catalogue knows required units | G-10 | missing at registration |
| 3. Splitting certificates, remarks, cash-in, late cash-in as services | not on the forms; EAR sheet only | G-21, G-22 | remarks partial; the rest missing |
| 4. Remark differs per board | Cambridge's four services at two rates | G-21 | partial |
| 5. Broadcast, batch and direct notifications; email and WhatsApp; not deletable | not in the artefacts | G-23 | partial (in-app already not deletable; targeting and channels missing) |
| 6. Repeating reminders | not in the artefacts | G-24 | missing |
| 7. Sessions: pick the subjects, derive the name, fewer inputs, teachers per session; board series redundant; rework the admin side | the links sheet is exactly that: subjects with board and teachers | G-01, G-06, G-13, G-15, G-29, G-30 | contradicts today's window |
| 8. School fees pushed into pending payments | not in the artefacts | G-25 | partial |
| 9. Every policy, deadline, percentage can have an exception | the sheet's per-case percentages (IS-08) | G-26 | partial |
| 10. The teacher changeable later | the links sheet changes between cycles; the form fixes it at submission | G-27 | missing |
| 11. More payment data for parents | nothing on the forms (no prices) | G-28 | partial |

---

## 6. What this changes in DISCOVERY.md (applied on 7 October)

- §1b, new: the facts the forms and fee lists establish.
- A-01 questioned: no grade-10 class on any June form (→ Q-10).
- A-02 refined: self-study is 50% and "ONLY 2nd entry" on every form; "50% School fees"; no
  20% anywhere (→ Q-12).
- A-03 refined: the November 2026 / January 2027 Biology form registers units for both series
  on one form; they are entries with a series each, not deposits; the money side stays F-01.
- A-06 refuted by the same form: one cycle feeds several series (F0b already allows it).
- Q-02 answered (b) by the school's own options: "A.2. (Carry forward on June 2026 /
  November 2025)" is the A2 entry carrying its AS result forward, matching Cambridge's option
  codes (BY / CT) and prices.
- F-02 half obtained (the board fees per series; the course fees still wanted); F-03 obtained.
- New: A-15 (grade 10 is registered by the school, not by form), A-16 (the board fee is 100%
  on self-study; the 50% is on the course fee), Q-10 to Q-15 (§7 below).

---

## 7. Questions for the admin (when she next sees the work), with the default we build with

| # | Question | Why it matters | Default meanwhile |
|---|---|---|---|
| Q-10 | How is **grade 10** registered for June? No form lists a grade-10 class. Does the school enter the core subjects itself, with no form? | the whole grade-10 flow (A-01, A-05) | the school registers grade 10's core subjects from the session screen; no family form |
| Q-11 | The refund windows count **weeks from the first lesson**: the subject's first lesson (per teacher group), or one date for the cycle? Is the November policy (50% weeks 3–6) the rule for every short cycle? | the refund computation on a drop (G-19) | per session type, counted from the session's course start; a group's own first lesson overrides when F1 knows it |
| Q-12 | "Self Study 50% School fees": is the **board fee** paid in full on a self-study retake, and only the school's course fee halved? What of a "Retake in School 100%" — is the board fee the series' fee again? | the pricing engine (G-07, G-08) | course fee 50%, board fee 100% |
| Q-13 | **One-paper retakes** on Edexcel IGCSE Mathematics (1H / 2H) and Cambridge sciences (Paper 41/42): does the board enter one component, or does the school enter the qualification and price one paper? What is carried forward from the named series? | papers per line and the board-fee basis (G-10, G-16) | a one-paper line is priced by the school's per-paper fee; the entry file is F4's problem |
| Q-14 | The **course fees** (the school's teaching fee) per subject and per unit, per cycle — the list we do not have. | F-02, G-16 | entered per session subject when the session is set up |
| Q-15 | **Payment timing**: are fees paid in one go at registration, in instalments, or as a deposit now and the balance later (A-03)? What is the "end date" a parent should see? | G-28, the held wallet | one due date per line; instalments as an exception |
| Q-16 | **Arabic A Level**: the IAL (YAA01) and the GCE (9AA1) are both offered; does the family choose, or does the teacher? Is the June 2026 fee list's WAA01 / WAA02 the IAL's two units? | G-14 | two qualifications under one subject, chosen with the teacher |
| Q-17 | **Cash-in, late cash-in and certificate splitting**: which board, which fee, which deadline, and who asks for them — the family, or the school on their behalf? | G-22 | service lines with a fee per series, requested at the desk or by the family |
| Q-18 | For **Edexcel** remarks: which services does the school offer (review of marking, clerical, access to scripts) and at what fee? | G-21 | the board's published services, fees entered per series |

These are added to DISCOVERY.md §3; the coordinator's earlier questions (IMPORT_SPIKE.md §3)
stay parked as the owner decided.

---

## 8. Limits of this reading

- The 14 closed November 2026 / January 2027 forms could not be read: they are not in the
  shared folder and their public pages show only the title. Their links-sheet rows and the four
  readable forms give the cycle's shape; the per-form options are inferred from the June forms
  of the same subjects.
- The fee lists are last cycle's (June 2026, January 2026) plus November 2026; the June 2027
  board fees are not published yet. The course fees are in no artefact.
- The response sheet (DISCOVERY.md §1) was read on 26 September; it was not re-read for this
  file.
- No form was submitted and no response data was read.
