# Strategy and plan of record

**Date:** 26 September 2026
**Status:** the plan every session works from. Decisions here are made; open questions are
listed at the end and belong to the owner. Update in place when a decision changes; never
delete a decision, mark it superseded.

---

## 1. Where we are

The **subject-reservation system** exists and has now been proven at runtime for the first
time since the V3 build: every money path — desk registration with cash, physical receipts and
the receipt-gated refund, InstaPay, the cash-refund maker-checker, reversals, the school-fee
gate with waivers, the held wallet, results → remark → outcome — ran end to end on a fresh
database (`FOUNDATION_AUDIT.md`). Nine findings came out of that run and two more out of
building the test harness; all but the product-decision ones are fixed. The repo has its first
automated tests, 19 scenarios that drive the real API through the typed RPC client against a
real Postgres. Everything is on `main`, which was four months behind until this week.

The **direction has changed**. The school's incumbent system, SCL, covers only the pre-IGCSE
grades, forgets everything every year, and is not used from grade 10 onward. So the
reservation system is no longer the product; it is the spine of an **IGCSE Management System
for grades 10–12**. The candidate features — campus-leave permissions, timetabling, a
graduation-pathway advisor, and the two the personas add, attendance and exam-entry
management — are not yet decided; a bounded discovery precedes that decision.

The **school's real spreadsheet** has been read (`DISCOVERY.md` §1). It corrected the data
model in eight places no amount of reasoning would have found: A-Level subjects are registered
per paper, students belong to homeroom sections, teachers sign registrations, one November
window carries January rows, and self-study and drop percentages vary per case. The owner's
answers turned the rest into explicit assumptions with a stated blast radius.

---

## 2. The goal

The school runs grades 10 to 12 on this system instead of a spreadsheet, a Google Form and a
paper receipt book, and does so because it is easier than those, not because it was told to.
Concretely, in the first live cycle:

| Outcome | How we will know |
|---|---|
| The desk prefers the system to Excel | every staff task takes fewer steps and less to remember than its Excel version (`UX_AUDIT.md` §4 is the standing test) |
| Families open the app | a majority of parents log in at least monthly, not only at registration time |
| The cash drawer reconciles | daily takings match the drawer every day; disputes over paper receipts drop to zero |
| One record per student | a grade-10 entry, its results, retakes, fees and receipts are visible in one place through grade 12 |
| Day one is not a re-keying day | the current cohort is imported from the school's own sheet, not typed in |

The first live cycle we should aim at is **June 2027 registration**, which the school opens
around February. That gives release 1 until roughly January 2027 for setup and import.

---

## 3. Decisions made, and why

| Decision | Why |
|---|---|
| **Desk-first parity, app-first destination.** Everything a parent can do in the app, staff can do at the desk in fewer steps than Excel; the app is where we want families to end up. | Staff adoption is the whole ballgame and they compare every flow to their sheet. Families will not open an app twice a year; daily-use features are what make self-serve real. |
| **Pivot from reservation to management system.** | The school's pain is that grades 10–12 have no system and the three-year journey is invisible. Our multi-year features (progression, history, results, held wallet, Student 360) are already what SCL lacks. |
| **Audit before building on the spine.** | All prior verification was code reading. Migrations had never been applied; there were no tests. Nobody builds a second floor on a foundation that has never been run. |
| **Narrow the first audit to the absolute lenses** (runtime, security, money, state/time) and defer the standalone UX and value audits. | Value is being re-asked at the management-system level; a UX polish audit of screens that may be reshaped is wasted. Security and money are absolute. |
| **Fix six findings before the remaining audits** (RF-01/02/03/07/08/10). | Three were desk money communications, two broke every fresh environment, one was mechanical. Leaving them in would have made the money and state audits rediscover them. |
| **Build the tests from the audit before the next audits.** | The hand-driven run was a specification. The repo had zero tests; every fix and every management-system feature needs a harness or it regresses silently. |
| **Hono RPC for every request, tests included; root-cause the `never` quirk instead of casting around it.** | End-to-end types are the architecture's point. The "known quirk" had one cause in the response helper; fixing it exposed hand-written types that had drifted from the API in the escrow and checkout screens. Workarounds hide drift. |
| **Independent review on Opus 5.5 only, run as a CLI process.** | The owner's rule. Reviews by other models found real errors in my own conclusions, and the 5.5 reviews found more, including two of my earlier findings being wrong. The in-session tool cannot pin a version; the CLI can. |
| **Push `main` directly once the gates are green; keep a decision trail per effort.** | The owner does not want a merge round-trip. The trails are what let a reviewer, or a later session, trust a result without re-deriving it. |
| **An assumptions register instead of a new requirements document.** | Writing requirements before walking the desk is exactly the mistake V3 had to be corrected for. The school's artefacts are not obtainable now, so every belief is written down with its blast radius and corrected as facts arrive. |
| **Teachers become users.** | The pivot makes the V3 "data only" decision irrelevant; the school's own sheet shows teachers signing registrations. The owner asked that past decisions not be treated as constraints. |
| **Timetabling starts with data plus manual entry and clash detection; generation only after discovery, and then via an existing solver.** | Automated timetabling is NP-hard and a research field of its own; IGCSE option blocks change the problem shape. A generator built first would consume the roadmap. |
| **Leave true product questions open rather than guess.** | Where the post-remark grade lives, whether a fee waiver is per year, whether a second parent is notified, whether the headline owing includes the school fee — each changes behaviour the school will feel; they are the owner's calls. |
| **Keep the Expo app as the future mobile client, untouched for now** (owner, 27 Sep 2026). | Mobile parity is future work. The app stays in the workspace as the template it is, outside the gates, until the plan brings it in. |
| **CI runs the three gates on every pushed branch; merge on green** (27 Sep 2026). | The gates were enforced by discipline only, and a "green" claimed in one checkout had never run in another. The first run on `main` caught a test race no laptop had shown. |
| **Archive stale documents rather than delete them; the root holds only what is current** (27 Sep 2026). | Agents are told to read context files at the repo root, and stale plans there misled them. The history stays in `docs/archive/` with an index of what each file was and what replaced it. |

---

## 4. What we know about the school

From `Nov 1 2026.xlsx` and the owner's answers, all recorded with sources in `DISCOVERY.md`:

- **Scale:** about 125–150 students per session across grades 11–12, 220–434 registrations,
  1–7 subjects per student, 8 teachers, sections 11A–11E and 12A–12D.
- **Vocabulary:** O.L., A.S., A.2., A.L., and "A.S./A.2." for a combined sitting.
- **Shape:** one row per student and subject; A-Level by unit or paper (P1, M1, "Biology
  Paper 3 & 4"); a teacher per row and a sign-off column; carry-forward entries; no money in
  the sheet at all.
- **Rules the owner confirmed:** grade 10 sits June only and core subjects are the one thing
  unique to grade 10; outside-school is 50 % on a first attempt and 20 % on a retake; January
  rows inside the November window are preregistration deposits.
- **Parked, no decisions yet:** what carry-forward means, what the signature means, the two
  unlabeled lists, the board identifier, and the money record.
- **Data quality:** phones as integers without the leading zero, names spelled three ways,
  thirteen spellings of five level values. Import must match on email and phone, never name.

---

## 5. The plan

### Phase 0 — foundation (done)

Runtime foundation, spine fixes, harness, three Opus 5.5 reviews acted on. Exit met: all V3
paths proven, gates green, everything on `main`.

### Phase 1 — the remaining foundation audits (next; three efforts, each one session)

Each produces a trail, findings numbered on from RF-11, fixes applied to the spine as found,
and a test for every money path touched. Each is reviewed on Opus 5.5 before it counts.

1. **Security.** A scripted authorization matrix across every endpoint and every role plus
   unauthenticated, then hands-on attacks on the money-authority paths (confirm, reverse, void,
   lost, exception grant, withdrawal approve) and object-level access (a parent reaching
   another parent's child). Input handling on the CSV importers, rate limits, verification
   enforcement, config and secrets, audit-trail completeness.
2. **Money correctness.** Ledger invariants over the whole database after a full suite run
   (escrow transactions sum to balances; payment plus escrow applied equals registration
   total); refund windows with real percentages; exception stacking including a fixed discount
   that could go negative; the escrow held at InstaPay initiation with no release path; takings
   semantics (bank transfers in the drawer figure, reversals rewriting a closed day).
3. **State and time.** A transition table per state machine (registration, receipt, payment,
   change request, remark, session, withdrawal, which has no terminal state); expiry of pending
   payments and sessions; the 1 July rollover; two officers acting on one payment at once.

Exit: no High finding open; every finding either fixed with a test or explicitly handed to a
product decision.

### Phase 2 — discovery research (parallel with Phase 1; no code)

The school's artefacts are not obtainable, so the research that can proceed: what SCL actually
covers so we position against it rather than rebuild it; the three boards' centre obligations
(entries, predicted grades, coursework, results file formats); the Egyptian national-subject
requirement that constrains both the pathway advisor and the timetable; how option-block IGCSE
schools timetable and which solvers exist; what comparable Egyptian and regional schools use.

Deliverable: a **feature-value map** scoring every candidate feature — leave permissions,
attendance, timetable (three tiers), pathway advisor, exam-entry management, and the
data-model changes the sheet forces — on daily-use frequency, who uses it, pain today, build
cost, and dependence on the spine. Plus design notes for the four model changes: paper-level
units, sections, teacher accounts, multi-series windows and the retake-aware outside rate.

### Phase 3 — the gate (owner in the room)

Pick release 1 from the map, resolve the open product questions in §7, and only then write
requirements for that release. The register's parked questions that release 1 depends on get
answered or explicitly assumed.

### Phase 4 — release 1 (target: usable by January 2027 for June 2027 registration)

Recommended composition, to be confirmed at the gate:

- The four data-model changes, because the June cycle needs paper-level A-Level entries and
  sections regardless of which features ship.
- **Day-one import** from the school's sheet: families, students, sections, existing
  registrations, with normalisation of phones and names. Without it, day one is a re-keying
  day and the desk will not switch.
- **Campus-leave permissions** as the daily-use wedge: parent requests, coordinator approves,
  gate list, check-out, parent notified. Cheapest feature, touches every parent every week.
- The UX items from `PROJECT_AUDIT.md` that make the desk faster: consistent money formatting,
  modal accessibility, the Arabic strings, the standing Excel test applied to each desk flow.
- A test for every new money or state path, and a review on Opus 5.5.

Exit: the school can run a November-style cycle end to end from the desk on imported data, and
parents have a reason to open the app weekly.

### Phase 5 — release 2 candidates

Attendance; timetable data model with manual entry, publication and clash detection; the
pathway advisor with Mo'adala rules (subject count, minimum grade, the five-sitting cap, the
grade-12 November warning); exam-entry management (candidate numbers, board-format entry
lists, exam-day clashes, certificate collection tracked like receipts). Order decided by the
map and by what release 1 taught us.

### Continuous

Every effort keeps a trail in `.audit/`, is reviewed on Opus 5.5 before it counts, and lands
on `main` only with the three gates green. Every staff-facing change passes the Excel test
before it ships.

---

## 6. Immediate next steps

1. **Security audit** (Phase 1.1). Done on 27 Sep 2026, merged on a green CI run:
   `SECURITY_AUDIT.md`, trail `.audit/security-audit.tsv`. Thirteen findings (RF-11 to RF-23;
   one high, three medium) fixed with tests; the authorization matrix is now an enforced policy.
   Handed on: a second factor for finance roles (owner decision), audit rows inside the money
   transaction (money audit), and the production checklist in §6 of that report.
2. **Money-correctness audit** (Phase 1.2), then **state and time** (Phase 1.3).
3. **Discovery research pack** in parallel with 1 and 2.
4. **Housekeeping the audits already named.** Done on 27 Sep 2026: the suite is kept off third
   parties, CI runs the gates, `render.yaml` (another project's blueprint) and the template
   setup script are deleted, the template todo and documents screens are removed, stale
   documents are archived, and the Expo app is kept for future work. Still open: restore the
   ESLint config; remove the 36 remaining manual query generics (FOUNDATION_AUDIT.md counted
   38; `grep -rn 'useQuery<' apps/web/app` finds 36 at c0f246e); close RF-04 and RF-05. The
   security audit also inherits the unused `/v1/files` upload endpoints (see
   `.audit/housekeeping.tsv`).
5. **The gate**, once 1–3 are done.

---

## 7. Open decisions for the owner

- Should a **school-fee waiver carry an academic year**, or waive until it expires?
- Where does the **post-remark syllabus grade** live, and does it replace the grade of record?
- With **several linked parents**, is the earliest link the payer of record, and are the others
  notified of payments?
- Should the family's **headline "outstanding"** include a required unpaid school fee?
- **Keep or delete the Expo app** — decided 27 Sep 2026: keep it for future work (§3). Still
  open: when mobile parity enters the plan.
- Which **qualification labels** the school sees: their O.L./A.S./A.2./A.L. or ours?
- The **day-one import source**: the school's sheet, an SCL export at the grade 9→10 boundary,
  or both?

---

## 8. Risks

- **Scope.** "Complete management system" has ended many projects. Defence: the gate, one
  bounded release at a time, the feature-value map as the tie-breaker.
- **The school's artefacts.** Every assumption in `DISCOVERY.md` is a liability until a fact
  replaces it; the money record in particular has never been seen.
- **The SCL boundary.** If SCL exports nothing, grade-10 onboarding each year is an import from
  a spreadsheet forever.
- **Teachers as users** pulls attendance, timetables and gradebooks into scope; the gate must
  bound it.
- **Operations.** One process runs the scheduler; there is no production deployment, no
  backups plan, no local file storage, and no deployment blueprint for this project (the one
  in the repo belonged to another project and was deleted on 27 Sep 2026).
- **Time.** June 2027 registration is the first realistic live cycle; release 1 must be in the
  school's hands by January for setup and import.
