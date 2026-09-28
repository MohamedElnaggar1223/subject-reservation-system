# Discovery Research — Phase 2 (desk research)

**Date:** 28 September 2026 (every source accessed that day).
**Scope:** STRATEGY.md Phase 2, the part that needs no school artefact: what the exam boards
require of a centre; Egypt's equivalency rules for British certificates; what SCL is; how
option-block schools timetable; what comparable systems offer; how schools in the region handle
campus leave. Deliverable: design notes for the data model and a feature-value map for the gate.
**Method:** two research passes on Opus 5.5 over primary sources (board handbooks and timetables,
the Ministry of Higher Education's admission guide, vendor documentation), with local copies of
every PDF; the claims the model depends on were checked against those copies (below).
**Confidence:** *confirmed* = read in a primary source (a board document, the Ministry's guide,
a vendor's own page for what the vendor claims); *unconfirmed* = press report or inference.
Nothing here replaces the coordinator's answers (IMPORT_SPIKE.md §3); it sharpens them.

---

## 1. What the school's sheet is, board by board

| Sheet item | Reading | Confidence | Source |
|---|---|---|---|
| Pure Mathematics 1–4, Mechanics 1, Statistics 1 | **Pearson Edexcel International A Level (IAL)** units WMA11–14, WME01, WST01. Pearson's January 2027 timetable prints "P1: Pure Mathematics 1", "M1: Mechanics 1", "S1: Statistics 1"; Cambridge 9709 has no Pure Mathematics 4 | confirmed | [P6], [C6] |
| Biology "(Paper 1 & 2)", "(3)", "(3 & 4)", "(4)", "(1 & 4)" | IAL Biology units (WBI11–16, all six sat in January, June and October). Cambridge 9700 can only be entered as papers {1,2,3}, {4,5} or {1–5}; none of the sheet's sets matches | strong inference | [P1], [P6], [C5] |
| January 2027 Biology rows | IAL: Cambridge runs June and November (March for India and Romania only) — no January series | confirmed | [C1], [P6] |
| "A.S./A.2." on M1 or S1 | An AS unit that counts toward both the AS (XMA01) and the A Level (YMA01) cash-in | inference | [P4] |
| "A.S./A.2." on "Paper 3 & 4", "Paper 1 & 4" | One sitting mixing an AS unit and an A2 unit | inference | [P1] |
| June 2023 "Carry forward on June/November 2022" (A2 rows) | Cambridge's AS carry-forward: Cambridge's own terms ("June carry-forward", "November carry-forward" entry options), inside its 13-month limit, and one such row is Computer Science, which has no IAL | likely, not proven (IAL unit banking could be described the same way) | [C1], [C3], [C4], [P1] |
| The "Nov. 2026 Session" tab | Spans more than one board series: IAL's autumn series is **October**; Cambridge and International GCSE sit **November** | inference | [P2], [C1] |

**Consequence for the open findings.** IS-14 (two boards in one session) is real: the November
tab mixes Pearson IAL units with other boards' subjects, and a school window feeds several board
series with different dates. Q-02 moves toward reading (b) but stays open until the coordinator
confirms (DISCOVERY.md).

---

## 2. What a centre must do (per board)

**Cambridge International** [C1], [C2], [C3], [C4], [C5]
- Entries in **Direct**; option codes per administrative zone and series. Estimated entries for
  June 2027 due 10 Oct 2026.
- **Identifiers:** a four-digit candidate number per series (fixed once entries are made), a
  five-character centre number; the candidate's previous centre and candidate number are required
  for November retakes, for an A Level completed after an earlier AS, and for carry-forward.
- **Deadlines (November 2026):** first-time entries 16 Aug, late fees from 17 Aug; retakes of a
  June 2026 syllabus without a late fee until 21 Sep (retake box ticked); late entries close 21 Sep.
  Every change after the deadline has its own late fee; a "very late entry fee" after that.
- **Forecast grades are mandatory** for every candidate, cannot be changed once submitted
  (June 2026 due 30 Apr).
- **Carry forward:** an AS result can be carried forward twice within 13 months, all marks from one
  series and syllabus; the entry needs an option code and the previous centre and candidate number,
  and Cambridge does not check it automatically.
- **Results:** a PDF statement per candidate and a centre broadsheet in PDF and **Excel**.
  **Certificates:** June by end of October, November by end of March; kept at least 12 months.

**Pearson Edexcel** [P1], [P2], [P3], [P7], [P8]
- IAL series: **October, January, June** (international centres). International GCSE: November
  and June (the last January International GCSE series was 2023).
- Entries in Edexcel Online or by EDI files from Pearson's basedata.
- **Identifiers:** a four-digit candidate number per centre per series; the **UCI** (13 characters:
  centre number, "B" for international, year, number, check character), mandatory in EDI; IAL unit
  results are banked under it for life of the specification.
- **Deadlines 2026/27** (entry / late fee from / high-late fee from): IAL October 28 Aug / 29 Aug /
  25 Sep 2026; IAL January 16 Oct / 17 Oct / 14 Nov 2026; IAL June 21 Mar / 22 Mar / 22 Apr 2027;
  International GCSE November 12 Sep / 13 Sep / 10 Oct 2026. **The fee doubles at the late date
  and trebles at the high-late date** — so the hard stop in A-08 is the school's policy, not a
  board rule.
- **Units and cash-ins:** W = unit, X = AS award, Y = A Level award; "no grade can be issued unless
  the cash-in code is entered". AS Mathematics = P1 + P2 + one of M1, S1, D1; A Level = P1–P4 + a
  permitted pair. Any unit can be resat; the better of the two most recent attempts counts.
- **Results:** EDI or Edexcel Online, a day before candidates; unit UMS and grade under W-codes,
  cash-ins under X/Y.

---

## 3. Egypt's equivalency (Mo'adala), as dated

Source: the Ministry of Higher Education Coordination Office guide for **admission in 2025**
(file dated 21 Aug 2025) — the latest linked from tansik on 28 Sep 2026; no 2026/27 guide found
[E1], [E2]. Re-check every rule when the 2026/27 guide appears.

- **Eight subjects** at O, AS or A Level, each at grade C or better, Extended (not Core), no subject
  counted twice (AS and A Level in one subject count once, at the better grade).
- **At most five sittings within the three preceding academic years**; the best grades inside
  that window count.
- **Timing:** only students who complete in the May/June sitting are admitted that year; completing
  in October, November or January means applying the next year.
- **Score:** each grade to a percentage (A* 100, A 95, B 85, C 70; 9–1 grades from 100 down to 70),
  the average × **4.1** (maximum 410), per faculty group; AS and A Level carry no multiplier.
- **Faculty groups** add required subjects (English in every group; sciences for medicine and
  engineering) and A-Level or AS minimums for medicine and engineering.
- **National subjects:** Arabic and religious education must be passed at the Ministry's exams.
- **Decree 148/2024:** Arabic and history taught in grades 10–12 from the 2025/26 grade-10 cohort,
  counting 10% each of the equivalency total — reported, annulled and reinstated in the press;
  the decree text was not found (**unconfirmed**). At this school that cohort is grade 11 in 2026/27.

For the **pathway advisor** this is the rule set: it needs every sitting (series, board, subject,
level, grade, tier), a sitting count inside the window, the best level per subject, subject
equivalences (e.g. ICT and Computer Science count separately; First Language Arabic only), faculty
groups, and the national-subject status — each rule stored with the admission year it applies to.

---

## 4. SCL, and what the region already uses

**SCL** is almost certainly "SCL – School Communication & Learning Management System" by
Edurealm LLC (Nasr City, Cairo; founded 2014; Egyptian international-school clients) [S1–S4]. By
its own pages it covers attendance with parent alerts, fees with Egyptian Tax Authority e-receipts,
a parent app, timetables imported from aSc, AP-style course selection, and an early-leave
("Dismissals") workflow with QR pickup passes [S5–S9]; it exports CSV and offers an IP-locked API.
Two points change our premises:
- It **claims to carry records across years** [S10], contradicting DISCOVERY.md's "keeps no data
  across years" — ask the school (and for their SCL login address, to confirm it is this product).
- It publishes **nothing on exam-board entries or per-series, per-paper fees** — the likelier
  reason the school stops using it at grade 10. The grade 9→10 import may come from its CSV or API.

**Comparable systems** (vendor claims) [M1–M9]: attendance with alerts, fees with gateways, one
parent login, a published timetable, dismissal permissions and Arabic are **table stakes**
(SCL, PowerSchool, Fedena, Edunation, Orison, Skolera). **IGCSE board-entry management is the
gap**: only iSAMS advertises an external-exams module (basedata, EDI, results), and its page names
only the Scottish board.

**Campus leave** in the region is paper, email and in person (school handbooks) [L1–L3]; the good
products (SCL Dismissals, WAKI, Fedena gate pass, Edunation PIK) share one flow: the parent
requests (student, time, reason, collector) → the coordinator approves → the gate list or a pass →
check-out with the collector recorded → the parent is told, and missed periods are excused. SCL's
version is the bar families of younger siblings already know.

**Timetabling:** option blocks group subjects taught at the same time; tools exist (FET, free,
AGPL, command-line; aSc, which SCL imports; Untis; TimeTabler) [T1–T6]. At 9 sections and 8
teachers an in-house solver is not worth building: build the timetable data model with manual
entry and **clash detection**, and if generation is ever wanted export to aSc XML or FET.

---

## 5. Design notes for the data model

These refine the four model changes STRATEGY.md plans, with the import spike's evidence:

1. **A school registration window is not a board series.** Store board series (board, month, year)
   with their own dates — entry deadline, late-fee and high-late dates, the Cambridge retake
   deadline, forecast, NEA and access-arrangement deadlines, results and certificate dates — and
   let one window feed several series. MO-10's single entry deadline per session becomes one per
   board series (IS-14).
2. **An entry is per qualification component, not per subject.** Board, board series, qualification
   (Cambridge syllabus code; Pearson cash-in code), and:
   - Pearson: the W-unit entries, separate from the X/Y cash-ins requested (either can occur alone);
   - Cambridge: the option code, a carry-forward reference (source series, previous centre and
     candidate number, option type) and the retake flag;
   - both: forecast grade (Cambridge requires it), access arrangements, the fee tier applied.
3. **Three levels, kept apart:** a unit's own level (AS or A2), the qualifications it counts toward,
   and the student's year. "A.S./A.2." is then derived, not stored (IS-01). The catalogue needs a
   unit table and a unit-to-cash-in table.
4. **Identifiers:** per student the Pearson UCI (permanent), the Cambridge candidate number per
   series (with history, for carry-forward), the legal name as on ID, and the national ID (sensitive);
   per centre the Cambridge and Pearson centre numbers, and whether the school enters directly or
   through the British Council (Q-05).
5. **Results import:** Pearson's EDI results keyed on UCI + unit + series (keep every attempt: the
   better of the two most recent counts); Cambridge's Excel broadsheet keyed on centre + candidate
   number + series (component detail unconfirmed — F-07).
6. **Sections, and a grade derived from the year** (STATE_AUDIT.md ST-13): the same change can give
   each student an entry cohort and a homeroom section per academic year.

---

## 6. Feature-value map

Scores 1–5 (5 highest); **A** = assumption (the school's artefacts F-04 to F-07 are not in hand).

| Feature | Use frequency | Who | Pain today | Build cost | Depends on the spine | Value |
|---|---|---|---|---|---|---|
| **Exam-entry management** (candidate numbers, board entry lists, carry forward, deadlines per series, results import) | 2–3 series a year | Coordinator, exams officer; parents see confirmations | 4 A (likely re-keyed into Direct and Edexcel Online) | M–L | Very high — derived from registrations | **High: the differentiator** |
| **Campus-leave permissions** | 4 A (F-05) | Parents, coordinator, gate, teachers | 3 A (paper and email in peers) | S–M | Medium | **High: daily use; SCL sets the bar** |
| **Attendance** (homeroom first, per period later) | 5 | Teachers, coordinator, parents | 3 A | S daily; M per period | Medium; per period needs the timetable | **High: table stakes** |
| Timetable: data model + manual entry + clash detection | 1 to build, 5 to view | Coordinator; everyone views | unknown (F-04, F-09) | M | High (groups from registrations) | Medium: unlocks per-period attendance |
| Timetable generation | 1 | Coordinator | low at this size (A) | M | Low | Low: defer, export to aSc/FET |
| Pathway advisor (Mo'adala) | 2 | Parents, students, coordinator | 4 A (high stakes, rules change yearly) | M + yearly upkeep | Very high (multi-year results) | Medium–high: after exam entries |
| Parent app parity | grows with daily features | Parents | 3 A | L | All | Later: responsive web first |

**Recommended order for the gate:** the data-model changes (units and cash-ins, board series,
sections, derived grade) first, because every feature below needs them; then **exam-entry
management** (it extends the spine and no regional product offers it) and **campus leave** (cheap,
daily, parents feel it); **homeroom attendance** next; the pathway advisor once results history
exists; timetable generation deferred.

---

## 7. What to ask the school (in addition to IMPORT_SPIKE.md §3)

1. Is Biology entered with Pearson IAL in 2026–27? Which board is each O.L. subject entered with?
2. Does the "November session" include IAL's October series?
3. Were the 2023 carry-forward rows Cambridge carry-forward entries?
4. The centre numbers, and does the school enter directly or through the British Council?
5. SCL: the login address (to confirm the product), whether it really keeps no records across years,
   and whether it can export the grade-9 roster (CSV or API).

---

## Sources

All accessed 28 Sep 2026. **Checked against the local copies** (the claims the data model depends
on): the IAL January 2027 timetable prints "P1: Pure Mathematics 1", "M1: Mechanics 1", "S1:
Statistics 1" and Biology units WBI11–WBI16 [P6]; Cambridge 9709 has no Pure Mathematics 4 [C6];
Cambridge's carry-forward is limited to 13 months [C3], [C4]; Cambridge's March series is for India
and Romania [C1]; the Egyptian guide multiplies the percentage by 4.1 [E1].

| Key | Source |
|---|---|
| C1 | Cambridge Handbook 2026 — https://www.cambridgeinternational.org/Images/746922-cambridge-handbook-2026.pdf |
| C2 | Cambridge monthly calendar 2026 — https://www.cambridgeinternational.org/Images/746010-monthly-calendar-2026-international-.pdf |
| C3 | Cambridge carry-forward entry rules — https://www.cambridgeinternational.org/Images/459150-carry-forward-entry-rules.pdf |
| C4 | Cambridge carry-forward regulations supplement — https://www.cambridgeinternational.org/Images/723192-carry-forward-regulations-supplement.pdf |
| C5 | Cambridge 9700 Biology syllabus 2025–2027 — https://www.cambridgeinternational.org/Images/664560-2025-2027-syllabus.pdf |
| C6 | Cambridge 9709 Mathematics syllabus 2026–2027 — https://www.cambridgeinternational.org/Images/697427-2026-2027-syllabus.pdf |
| P1 | Pearson IAL information manual 2025/26 — https://qualifications.pearson.com/content/dam/pdf/Support/Information-manual/4-ial-2025-2026.pdf |
| P2 | Pearson key dates 2026/27 — https://qualifications.pearson.com/content/dam/pdf/Support/Information-manual/1-key-dates-2026-2027.pdf |
| P3 | Pearson International GCSE manual 2025/26 — https://qualifications.pearson.com/content/dam/pdf/Support/Information-manual/6-international-gcse-2025-2026.pdf |
| P4 | Pearson IAL Mathematics aggregation rules — https://qualifications.pearson.com/content/dam/pdf/International%20Advanced%20Level/Mathematics/2018/Teaching-and-Learning-Materials/aggregation-rules-and-guidance.pdf |
| P6 | Pearson IAL January 2027 timetable — https://qualifications.pearson.com/content/dam/pdf/Support/Examination-timetables-for-International-Advanced-Levels/ial-january-2027-final.pdf |
| P7 | Pearson registration and entry data (UCI) — https://qualifications.pearson.com/en/support/support-topics/registrations-and-entries/academic-registrations-and-entries/registration-and-entry-data.html |
| P8 | Pearson IAL results explained — https://qualifications.pearson.com/en/support/support-topics/results-certification/understanding-marks-and-grades/understanding-your-results-information-for-students/edexcel-international-advanced-level-results-explained.html |
| E1 | Ministry of Higher Education, British-certificate admission guide 2025 — https://tansik.digital.gov.eg/Application/Certificates/Mo3adla/Dalel/FTansikUserGuide.pdf |
| E2 | Tansik equivalency page — https://tansik.digital.gov.eg/application/Certificates/Mo3adla/DefaultFtansik.aspx |
| S1–S10 | SCL: Google Play listing (com.getscl.application); getscl.com — about, modules, attendance, billing, integrations, 2025.1 update notes, student-information-system, registrar, timetable, dismissals; mns.edu.eg/scl |
| M1–M9 | iSAMS External Exams Manager and Middle East pages; PowerSchool MEA; Tes Engage; Classera; Fedena pricing and modules; Edunation pricing and PIK; Orison (Capterra); Skolera |
| L1–L3 | Egypt Modern School attendance page; Merryland International School handbook 2025–26; Gulf News on UAE exit permits (Jan 2026) |
| T1–T6 | TimeTabler Options handbook; FET (lalescu.ro, fet-cl manual); aSc prices and EduPage help; Untis course scheduling and interfaces; UniTime; OR-Tools |

Press-only items (Decree 148/2024 and its court history; LRN recognition, Sep 2026) are
**unconfirmed** and listed with their URLs in the research notes kept with the audit evidence.
