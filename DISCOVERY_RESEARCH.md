# Discovery Research — Phase 2 (desk research)

**Date:** 28 September 2026 (every source accessed that day).
**Scope:** STRATEGY.md Phase 2, the part that needs no school artefact: what the exam boards
require of a centre; Egypt's equivalency rules for British certificates; what SCL is; how
option-block schools timetable; what comparable systems offer; how schools in the region handle
campus leave. Deliverable: design notes for the data model and a feature-value map for the gate.
**Method:** two research passes on Opus 5.5 over primary sources (board handbooks and timetables,
the Ministry of Higher Education's admission guide, vendor documentation), with local copies of
the PDFs; the claims the data model depends on were checked against those copies, and an
independent review on Opus 5.5 checked them again. It found claims in the first draft stated more
firmly than the sources allow, and two that were wrong: the resit rule without its Mathematics
exception, and "First Language Arabic only". All are corrected below.
**Confidence:** *confirmed* = read in a primary source (a board document, the Ministry's guide, a
vendor's own page for what the vendor claims); *strong inference* = several facts point one way
and none against, not stated anywhere; *unconfirmed* = a press report, or a weaker inference.
Nothing here replaces the coordinator's answers (IMPORT_SPIKE.md §3); it sharpens them.

---

## 1. What the school's sheet is, board by board

| Sheet item | Reading | Confidence | Source |
|---|---|---|---|
| Pure Mathematics 1–4, Mechanics 1, Statistics 1 | **Pearson Edexcel International A Level (IAL)** units WMA11–14, WME01, WST01. Pearson's January 2027 timetable prints "P1: Pure Mathematics 1", "M1: Mechanics 1", "S1: Statistics 1"; Cambridge 9709 has no Pure Mathematics 4 | confirmed | [P6], [C6] |
| Biology "(Paper 1 & 2)", "(3)", "(3 & 4)", "(4)", "(1 & 4)" | Most likely IAL Biology units (WBI11–16; each can be entered alone). Cambridge 9700 can only be entered as papers {1,2,3}, {4,5} or {1–5}, and none of the sheet's sets matches. **Against:** the sheet says "Paper" (Cambridge's word; Pearson says "Unit"), and IAL Units 5 and 6 never appear — the sheet may register teaching by paper rather than board entries | strong inference | [P1], [P6], [C5] |
| January 2027 Biology rows | Not Cambridge: Cambridge runs June and November (March for India and Romania only), no January series. IAL sits January; so does OxfordAQA for AS/A Level | "not Cambridge" confirmed; IAL a strong inference | [C1], [P6], [O1] |
| "A.S./A.2." on M1 or S1 | An AS unit that counts toward both the AS (XMA01) and the A Level (YMA01) award | inference | [P4] |
| "A.S./A.2." on "Paper 3 & 4", "Paper 1 & 4" | One sitting mixing an AS unit and an A2 unit | inference | [P1] |
| June 2023 "Carry forward on June/November 2022" (A2 rows) | Either board. For Cambridge: its AS carry-forward, allowed within 13 months, with "June/November carry-forward" entry options. For Pearson: its own rules also speak of unit marks being "carried forward", and IAL unit results stay banked for the life of the specification, not 13 months. 12 of the 19 rows are Biology, which the 2026 tab suggests is IAL; 1 is Computer Science, which Pearson does not offer as an IAL and so can only be Cambridge | unconfirmed (Q-02 stays open) | [C1], [C3], [C4], [P1], [P5] |
| The "Nov. 2026 Session" tab | Feeds several board series with different dates: IAL's autumn series is **October**, Cambridge and International GCSE sit **November**, and its January rows are a third series | inference | [P2], [C1] |

**Consequence for the open findings.** IS-14 stands in a different form: whatever the boards, the
November tab feeds **several board series** (October, November, January), each with its own
entry deadline and late-fee dates — possibly across several boards (the O.L. subjects could be
Cambridge IGCSE or Pearson International GCSE). The design conclusion (§5.1) holds either way.
Q-02 stays open.

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
- **Forecast grades are mandatory** for every candidate and cannot be changed once submitted
  (June 2026 due 30 Apr).
- **Carry forward:** an AS result can be carried forward twice within 13 months, all marks from one
  series and syllabus; the entry needs an option code and the previous centre and candidate number,
  and Cambridge does not check it automatically.
- **Results:** a PDF statement per candidate and a centre broadsheet in PDF and **Excel**.
  **Certificates:** June by end of October, November by end of March; kept at least 12 months.

**Pearson Edexcel** [P1], [P2], [P3], [P4], [P7], [P8]
- IAL series: **October, January, June** (international centres). International GCSE: November
  and June (the last January International GCSE series was 2023).
- Entries in Edexcel Online or by EDI files from Pearson's basedata.
- **Identifiers:** a four-digit candidate number per centre per series; the **UCI** (13 characters:
  centre number, "B" for international, year, number, check character), mandatory in EDI [P7 — a
  web page, not locally copied or spot-checked]. IAL unit results are banked under the UCI [P1]
  (the "life of the specification" wording is in a 2021 edition of the cash-in rules, [P5]).
- **Deadlines 2026/27** (entry / late fee from / high-late fee from): IAL October 28 Aug / 29 Aug /
  25 Sep 2026; IAL January 16 Oct / 17 Oct / 14 Nov 2026; IAL June 21 Mar / 22 Mar / 22 Apr 2027;
  International GCSE November 12 Sep / 13 Sep / 10 Oct 2026. **The entry fee doubles at the late
  date and trebles at the high-late date**; an option change after the high-late date costs an
  amendment fee; refunds are automatic up to the high-late date [P2]. The boards take late
  entries, so a hard stop at the deadline is the school's policy, not a board rule.
- **Units and awards:** W = unit, X = AS award, Y = A Level award; "no grade can be issued unless
  the cash-in code is entered". AS Mathematics = P1 + P2 + one of M1, S1, D1; A Level = P1–P4 + a
  permitted pair.
- **Resits:** any unit can be resat, and the better of the two most recent non-absent attempts
  counts toward an award — **except the IAL Mathematics suite**, where a unit used in an award is
  locked to its qualification group, Mathematics or Further Mathematics (pure units are not locked
  by an AS award). Inside its group a locked unit counts again without re-entry, so moving from AS
  to A Level Mathematics needs none. Re-grading an award after a resit, or using a unit in the
  other group, means re-entering the awards it was locked to, and a cash-in requested after the
  entry deadline costs a fee [P1], [P4 rules 3, 6, 7 and Appendix], [P2 §1.3]. The school enters
  IAL Mathematics units, so the results model needs this exception, not only the general rule.
- **Results:** EDI or Edexcel Online, a day before candidates; unit UMS and grade under W-codes,
  awards under X/Y.

**OxfordAQA** [O1], [O2] — only if the school uses it (nothing in the sheet points to it):
International GCSE in November, AS/A Level in January, both in May/June; entries through Centre
Services or EDI/A2C.

---

## 3. Egypt's equivalency (Mo'adala), as dated

Source: the Ministry of Higher Education Coordination Office guide for **admission in 2025**
(file dated 21 Aug 2025) — the latest linked from tansik on 28 Sep 2026; no 2026/27 guide found
[E1], [E2]. Re-check every rule when the 2026/27 guide appears (DISCOVERY.md A-10; Decree 148 is
A-11).

- **Eight subjects** at O, AS or A Level, each at grade C or better, Extended (not Core), no subject
  counted twice (AS and A Level in one subject count once, at the better grade) [E1 pp. 80–81].
- **At most five sittings within the three preceding academic years**; the best grades inside
  that window count [E1 pp. 80–81] (the same rule was reported in 2017 [E9]).
- **Timing:** only students who complete in the May/June sitting are admitted that year; completing
  in October, November or January means applying the next year [E1 p. 78].
- **Score:** each grade to a percentage (A* 100, A 95, B 85, C 70; 9–1 grades from 100 down to 70),
  the average × **4.1** (maximum 410), per faculty group; AS and A Level carry no multiplier
  [E1 pp. 81–82].
- **Subjects:** Arabic counts as "First Language Arabic" at O Level or Arabic at AS/A Level;
  Cambridge O Level Arabic (3180) was accepted "for 2022/23 only, pending review" — the case the
  sheet's "Arabic (Cambridge)" may fall into; ICT and Computer Science count as two subjects;
  English as an Additional Language may replace English but not count alongside it; **IAL counts
  as AS/A Level** [E1 pp. 82–83, items 1, 3, 6, 8] — so the school's IAL units count toward the
  eight subjects like Cambridge AS/A Levels.
- **Faculty groups** add required subjects (English in every group; sciences for medicine and
  engineering) and A-Level or AS minimums for medicine and engineering [E1 pp. 81, 125–127].
- **National subjects:** Arabic and religious education must be passed at the Ministry's exams
  [E1 p. 78].
- **Decree 148/2024:** Arabic and history taught in grades 10–12 from the 2025/26 grade-10 cohort,
  counting 10% each of the equivalency total — reported, annulled and reinstated in the press; the
  decree text was not found (**unconfirmed**) [E3]–[E7]. At this school that cohort is grade 11 in
  2026/27.
- **LRN:** on 6 Sep 2026 the Ministry asked the Supreme Council of Universities to recognise LRN
  British certificates under the existing rules (state media; **unconfirmed**) [E8].
- **Open:** how the Coordination Office counts a "sitting" against the five-in-three-years cap
  when a school sits up to four board series a year (§7).

For the **pathway advisor** this is the rule set: every sitting (series, board, subject, level,
grade, tier), a sitting count inside the window, the best level per subject, the subject
equivalences above, faculty groups, and the national-subject status — each rule stored with the
admission year it applies to.

---

## 4. SCL, and what the region already uses

**SCL** is almost certainly "SCL – School Communication & Learning Management System" by
Edurealm LLC (Nasr City, Cairo; founded 2014; Egyptian international-school clients) [S1]–[S4]. By
its own pages it covers attendance with parent alerts, fees with Egyptian Tax Authority
e-receipts, a parent app, timetables imported from aSc, AP-style course selection, and an
early-leave ("Dismissals") workflow with QR pickup passes [S5]–[S9]; it exports CSV and offers an
IP-locked API [S10]. On our premises:
- It **claims to carry records across years** [S11], against DISCOVERY.md's "keeps no data across
  years" — but its 2025.1 release notes also list **wipe options at promotion** [S10], which would
  reconcile the two (the school may wipe at year end). DISCOVERY.md Q-09.
- It publishes **nothing on exam-board entries or per-series, per-paper fees** — the likelier
  reason the school stops using it at grade 10. The grade 9→10 import may come from its CSV or API.

**Comparable systems** (vendor claims) [M1]–[M9]: attendance with alerts, fees with gateways, one
parent login, a published timetable, dismissal permissions and Arabic are **table stakes**
(SCL, PowerSchool, Fedena, Edunation, Orison, Skolera). **IGCSE board-entry management is the
gap**: only iSAMS advertises an external-exams module (basedata, EDI, results), and its page names
only the Scottish board.

**Campus leave** in the region is paper, email and in person (school handbooks) [L1]–[L3]; the good
products (SCL Dismissals, WAKI, Fedena gate pass, Edunation PIK) share one flow: the parent
requests (student, time, reason, collector) → the coordinator approves → the gate list or a pass →
check-out with the collector recorded → the parent is told, and missed periods are excused (which
needs attendance). SCL's version is the bar families of younger siblings already know.

**Timetabling:** option blocks group subjects taught at the same time; tools exist (FET, free,
AGPL, command-line; aSc, which SCL imports; Untis; TimeTabler) [T1]–[T6]. At 9 sections and 8
teachers an in-house solver is not worth building: build the timetable data model with manual
entry and **clash detection**, and if generation is ever wanted export to aSc XML or FET.

---

## 5. Design notes for the data model

These refine the model changes STRATEGY.md plans (paper-level units, sections, teacher accounts,
multi-series windows, the retake-aware outside rate), with the import spike's evidence:

1. **A school registration window is not a board series.** Store board series (board, month, year)
   with their own dates — entry deadline, late-fee and high-late dates, the Cambridge retake
   deadline, forecast, NEA and access-arrangement deadlines, results and certificate dates — and
   let one window feed several series. MO-10's single entry deadline per session becomes one per
   board series (IS-14).
2. **An entry is per qualification component, not per subject.** Board, board series, qualification
   (Cambridge syllabus code; Pearson cash-in code), and:
   - Pearson: the W-unit entries, separate from the X/Y awards requested (either can occur alone);
   - Cambridge: the option code, a carry-forward reference (source series, previous centre and
     candidate number, option type) and the retake flag;
   - both: forecast grade (Cambridge requires it), access arrangements, the fee tier applied, and
     withdrawal. Pearson refunds an entry automatically up to the high-late date and charges an
     amendment fee for an option change after it, so what a drop costs the school depends on its
     date; the sheet's per-case drop percentages (IS-08) are the school's refund to the family, a
     separate amount, and F-01 should show whether they follow these dates.
3. **Three levels, kept apart:** a unit's own level (AS or A2), the qualifications it counts toward,
   and the student's year. "A.S./A.2." is then derived, not stored (IS-01). The catalogue needs a
   unit table and a unit-to-award table.
4. **Retakes are per unit.** A Pearson unit resat is a retake of that unit (in Mathematics,
   re-grading an award after the resit also means re-entering that award); a Cambridge retake is
   flagged per syllabus and series. Whether the school's retake rate applies to a unit resit is
   still the coordinator's answer (A-02, IS-03); if it does, the rate can key on the attempt at
   this unit or syllabus, from the student's own entry history.
5. **Identifiers:** per student the Pearson UCI (permanent), the Cambridge candidate number per
   series (with history, for carry-forward), the legal name as on ID, and the national ID
   (sensitive); per centre the Cambridge and Pearson centre numbers, and whether the school enters
   directly or through the British Council (Q-05).
6. **Results import:** Pearson's EDI results keyed on UCI + unit + series, keeping every attempt
   (the better of the two most recent counts, except in Mathematics, which follows its own
   aggregation rules); Cambridge's Excel broadsheet keyed on centre + candidate number + series
   (component detail unconfirmed — F-07).
7. **Teachers and sections.** The 2026 tab names one teacher per row, and the existing teacher
   table and subject links carried all 196 of them (IMPORT_SPIKE.md). Teacher **accounts** (logins) are only needed once
   teachers act in the system — attendance, timetables, gradebooks — so they follow those features,
   not the model change. Sections belong with the student's year (below).
8. **A grade derived from the year** (STATE_AUDIT.md ST-13): the same change can give each student
   an entry cohort and a homeroom section per academic year.

---

## 6. Feature-value map

Scores 1–5 (5 highest); **A** = assumption (the school's artefacts F-04 to F-07 are not in hand).

| Feature | Use frequency | Who | Pain today | Build cost | Depends on the spine | Value |
|---|---|---|---|---|---|---|
| **Exam-entry management** (candidate numbers, board entry lists, carry forward, deadlines per series, sitting counts, results import) | up to four series a year | Coordinator, exams officer; parents see confirmations | 4 A (likely re-keyed into Direct and Edexcel Online) | M–L | Very high — derived from registrations | **High: the differentiator** |
| **Campus-leave permissions** | 4 A (F-05) | Parents, coordinator, gate, teachers | 3 A (paper and email in peers) | S–M | Medium; excusing missed periods needs attendance | **High: daily use; SCL sets the bar** |
| **Attendance** (homeroom first, per period later) | 5 | Teachers, coordinator, parents | 3 A | S daily; M per period | Medium; per period needs the timetable | **High: table stakes** |
| Timetable: data model + manual entry + clash detection | 1 to build, 5 to view | Coordinator; everyone views | unknown (F-04, F-09) | M | High (groups from registrations) | Medium: unlocks per-period attendance |
| Timetable generation | 1 | Coordinator | low at this size (A) | M | Low | Low: defer, export to aSc/FET |
| Pathway advisor (Mo'adala) | 2 | Parents, students, coordinator | 4 A (high stakes, rules change yearly) | M + yearly upkeep | Very high (multi-year results) | Medium–high: after exam entries |
| Parent app parity | grows with daily features | Parents | 3 A | L | All | Later: responsive web first |

**Order suggested by the research:** the data-model changes first (units and awards, board
series, sections, a derived grade), because every feature below needs them; then **exam-entry
management** (it extends the spine and no regional product offers it); **campus leave together
with homeroom attendance** (leave excuses missed periods); the pathway advisor once results history
exists; timetable generation deferred. **This differs from STRATEGY.md Phase 4**, which leads with
campus leave as the daily-use wedge and puts exam-entry management in Phase 5 — a choice for the
owner at the gate, not settled here.

---

## 7. What to ask the school (in addition to IMPORT_SPIKE.md §3)

1. Is Biology entered with Pearson IAL in 2026–27 — and does "Paper" in the sheet mean a board
   entry or a teaching group? Which board is each O.L. subject entered with?
2. Does the "November session" include IAL's October series?
3. Were the 2023 carry-forward rows Cambridge carry-forward entries or Pearson units banked?
4. The centre numbers, and does the school enter directly or through the British Council?
5. SCL: the login address (to confirm the product), whether it wipes records at year end, and
   whether it can export the grade-9 roster (CSV or API).
6. How does the Coordination Office count a "sitting" toward the five-sittings cap — per board
   series? (It decides what exam-entry management should warn about.)

---

## Sources

All accessed 28 Sep 2026. **Checked against local copies** (the claims the data model depends on):
the IAL January 2027 timetable prints "P1: Pure Mathematics 1", "M1: Mechanics 1", "S1: Statistics
1" and Biology units WBI11–WBI16 [P6]; Cambridge 9709 has no Pure Mathematics 4 [C6]; Cambridge's
carry-forward is limited to 13 months [C3], [C4]; Cambridge's March series is for India and Romania
[C1]; the IAL manual's resit rule and its Mathematics exception [P1]; the Egyptian guide's British
section multiplies the percentage by 4.1 [E1]. The research notes with every claim, and local copies of the
board PDFs and the Egyptian guide, are kept with the audit evidence (`.audit/discovery-evidence/`,
git-ignored); the table below lets each claim be re-checked online.

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
| P5 | Pearson unit aggregation and cash-in rules (2021 edition) — https://qualifications.pearson.com/content/dam/pdf/Support/unit-aggregation-and-certification-cash-in-rules.pdf |
| P6 | Pearson IAL January 2027 timetable — https://qualifications.pearson.com/content/dam/pdf/Support/Examination-timetables-for-International-Advanced-Levels/ial-january-2027-final.pdf |
| P7 | Pearson registration and entry data (UCI) — https://qualifications.pearson.com/en/support/support-topics/registrations-and-entries/academic-registrations-and-entries/registration-and-entry-data.html |
| P8 | Pearson IAL results explained — https://qualifications.pearson.com/en/support/support-topics/results-certification/understanding-marks-and-grades/understanding-your-results-information-for-students/edexcel-international-advanced-level-results-explained.html |
| O1 | OxfordAQA dates and timetables — https://www.oxfordaqa.com/exams-admin/dates-and-timetables/ |
| O2 | OxfordAQA entries — https://www.oxfordaqa.com/exams-admin/entries/ |
| E1 | Ministry of Higher Education, British-certificate admission guide 2025 — https://tansik.digital.gov.eg/Application/Certificates/Mo3adla/Dalel/FTansikUserGuide.pdf |
| E2 | Tansik equivalency page — https://tansik.digital.gov.eg/application/Certificates/Mo3adla/DefaultFtansik.aspx |
| E3 | Decree 148/2024 (press reproduction; unconfirmed) — https://www.almasdar.com/155780 |
| E4 | Decree 148: grades 10–12 from 2025/26 (Ahram Online, 7 Sep 2024; unconfirmed) — https://english.ahram.org.eg/NewsContent/1/2/531140/Egypt/Society/Experts-and-parents-debate-new-Arabic-subjects-in-.aspx |
| E5 | Administrative Court annulment (El Balad, 28 Mar 2025; unconfirmed) — https://www.elbalad.news/6526606 |
| E6 | Supreme Administrative Court upheld; 20% (Youm7, 14 May 2025; unconfirmed) — https://www.youm7.com/story/2025/5/14/%D8%A7%D9%84%D8%A5%D8%AF%D8%A7%D8%B1%D9%8A%D8%A9-%D8%A7%D9%84%D8%B9%D9%84%D9%8A%D8%A7-%D8%AA%D8%A4%D9%8A%D8%AF-%D9%82%D8%B1%D8%A7%D8%B1-%D8%A7%D9%84%D8%AA%D8%B9%D9%84%D9%8A%D9%85-%D8%A8%D8%A5%D8%B6%D8%A7%D9%81%D8%A9-20-%D9%85%D9%86-%D8%AF%D8%B1%D8%AC%D8%A7%D8%AA-%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%89/6986774 |
| E7 | Baccalaureate Arabic and history, 20% (Youm7, 30 Aug 2026; unconfirmed) — https://www.youm7.com/story/2026/8/30/%D8%AA%D8%AF%D8%B1%D9%8A%D8%B3-%D9%85%D9%86%D9%87%D8%AC-%D8%A7%D9%84%D8%A8%D9%83%D8%A7%D9%84%D9%88%D8%B1%D9%8A%D8%A7-%D9%81%D9%89-%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%89-%D9%88%D8%A7%D9%84%D8%AA%D8%A7%D8%B1%D9%8A%D8%AE-%D8%A8%D8%A7%D9%84%D8%B4%D9%87%D8%A7%D8%AF%D8%A7%D8%AA-%D8%A7%D9%84%D8%AF%D9%88%D9%84%D9%8A%D8%A9/7530503 |
| E8 | LRN recognition request (Maspero, 6 Sep 2026; unconfirmed) — https://www.maspero.eg/egypt/2026/09/06/986860/%D8%A7%D9%84%D8%AA%D8%B9%D9%84%D9%8A%D9%85-%D8%AA%D8%AE%D8%A7%D8%B7%D8%A8-%D8%A7%D9%84%D8%A3%D8%B9%D9%84%D9%89-%D9%84%D9%84%D8%AC%D8%A7%D9%85%D8%B9%D8%A7%D8%AA-%D8%A8%D9%85%D8%B9%D8%A7%D8%AF%D9%84%D8%A9-LRN-%D9%83%D8%B4%D9%87%D8%A7%D8%AF%D8%A9-%D8%A8%D8%B1%D9%8A%D8%B7%D8%A7%D9%86%D9%8A%D8%A9-%D9%85%D8%B9%D8%AA%D9%85%D8%AF%D8%A9 |
| E9 | Eight subjects, five sittings in three years, ×4.1, reported in 2017 (Ahram Gate; unconfirmed) — https://gate.ahram.org.eg/News/1557015.aspx |
| S1 | SCL on Google Play — https://play.google.com/store/apps/details?id=com.getscl.application |
| S2 | SCL about — https://getscl.com/about/ |
| S3 | Maadi Narmer School's SCL page — https://mns.edu.eg/scl/ |
| S4 | SCL modules — https://getscl.com/ |
| S5 | SCL attendance — https://getscl.com/attendance/ |
| S6 | SCL billing — https://getscl.com/billing/ |
| S7 | SCL timetable — https://getscl.com/timetable/ |
| S8 | SCL course selection — https://getscl.com/course-selection/ |
| S9 | SCL dismissals — https://getscl.com/dismissals/ |
| S10 | SCL integrations; 2025.1 release notes (API; wipe options at promotion) — https://getscl.com/integrations/ ; https://getscl.com/summary-of-new-features-in-scl-2025-1-update/ |
| S11 | SCL student information system; registrar — https://getscl.com/student-information-system/ ; https://getscl.com/registrar/ |
| M1 | iSAMS External Exams Manager — https://www.isams.com/platform/modules/external-exams-manager/ |
| M2 | iSAMS Middle East — https://www.isams.com/school-management-software-in-middle-east/ |
| M3 | PowerSchool Middle East & Africa — https://www.powerschool.com/global/middle-east-africa/powerschool-sis/ |
| M4 | Tes Engage — https://www.tes.com/for-schools/engage/school |
| M5 | Classera — https://classera.com/ |
| M6 | Fedena pricing and modules — https://fedena.com/pricing-and-plans ; https://fedena.com/feature-tour/ultimate-modules |
| M7 | Edunation pricing and PIK — https://www.edu-nation.net/pricing ; https://www.edu-nation.net/pik/ |
| M8 | Orison (Capterra) — https://www.capterra.ae/software/1060205/orison-school-erp |
| M9 | Skolera — https://skolera.com/en/school-management-system-features |
| L1 | Egypt Modern School attendance — https://ems.com.eg/life/attendance/ |
| L2 | Merryland International School handbook 2025–26 — https://www.merryland-school.com/assets/files/MIS%20Pupil-Parent%20Handbook%2025-2026.pdf |
| L3 | UAE exit permits (Gulf News, Jan 2026) — https://gulfnews.com/uae/education/no-exit-without-permit-under-new-uae-school-rules-1.500400308 |
| T1 | TimeTabler Options handbook — https://www.timetabler.com/Options-Handbook.pdf |
| T2 | FET — https://lalescu.ro/liviu/fet/ ; command line: https://manpages.debian.org/testing/fet/fet-cl.1.en.html |
| T3 | aSc prices and help — https://www.asctimetables.com/a/prices ; https://help.edupage.org/?p=u1/u3/t1148&lang=en |
| T4 | Untis course scheduling and interfaces — https://www.untis.at/en/products/untis-basic-software/course-scheduling-1 ; https://www.untis.at/en/why-untis/about-the-product/interfaces |
| T5 | UniTime — https://github.com/UniTime/unitime |
| T6 | OR-Tools — https://github.com/google/or-tools |
