# F8 — The complete journey of the reservation cycle (as built)

Branch `feature/walkthrough-cycle`, from main 622ba4d (16 Oct 2026), main 9a38c3d (the cycle decisions) merged in
at 29079c2 before any screenshot. Built by one Opus 5.5 agent end to end, as the owner asked on 16 Oct 2026
(FEATURES_PLAN.md §1 F8, "Scoped by the owner on 16 Oct 2026"). Trail: `.audit/walkthrough-cycle.tsv`. Evidence:
`.audit/walkthrough-cycle-evidence/`. No application code changed: the branch adds documents, the demo script and
evidence only.

## 1. What it is

`docs/walkthrough/` — open `index.html` in any browser, offline (inline CSS, no external request: checked, 0
requests). A navigation column lists the four parts and every step.

| Part | Steps | Screenshots | What it covers |
|---|---|---|---|
| 1 — Set up from a clean clone | 23 | 11 | prerequisites with versions; clone; install; the Postgres 17.5 container and the database; both env files with every variable explained and a safe local value; the builds; the 62 migrations and what a fresh database holds; the two servers; the first admin (sign-up, then the seed's promotion) and what the seed makes; the first sign-in; the school's name on sign-in (decision 15); the "before going live" pointer to SECURITY_AUDIT.md §6. Command steps show the commands as run and their output instead of a screenshot |
| 2 — The admin's journey | 124 | 124 | the June 2027 cycle rebuilt exactly as the 25 forms describe it: the team (a coordinator, a finance officer, Teacher 1 … 33), the catalogue (the forms' subjects, the seed's samples retired, the IAL starter sets, the papers of the one-paper retakes, 28 awards with their papers and option codes, every subject mapped), the settings (self-study share, the June refund policy), the session, the sheet subject by subject (25 steps, each beside its form), the fees pasted from the boards' lists and typed where no list has them, the boards' deadlines, Board Series, Grade 10, the family's form previewed next to the school's, opening, the reminders; then the running: the desk with a walk-in family (onboarding, a declared retake, collecting, the receipts, the slip), Students, the Finance Workbench (InstaPay and "pay at the desk"), Daily Takings, To verify, an exception, the Money tab and Remind, a message to the unpaid families, Charges, a drop with its receipt taken back and the refund taken as cash (maker-checker), the entries to the board (Exam Deadlines, Exam Entries, Candidates, the centre number, Entry Lists), the day-one import as the alternative start, each role's Home, Notifications, Profile |
| 3 — The student's journey | 13 | 13 | sign-up; accepting the parent's link; reserving with a teacher chosen and a one-paper self-study retake with its declared sitting; the request waiting for the parent; a drop requested; the statement; the notifications |
| 4 — The parent's journey | 36 | 36 | sign-up; linking the child; Home's next step; reserving three subjects as the forms asked (one a self-study retake with its sitting); paying per exam board (Cambridge by InstaPay with its reference, Pearson at the desk); approving the child's request; the reminder and the message received; approving the child's drop, the receipt to bring back, the statement and the balance, a receipt, the balance taken back; History, School Fee, Charges & Instalments, Profile; the switch to Arabic (Home, statement, Reserve, right to left) |

196 steps, 184 screenshots (JPEG, 35–149 KB each, 12.4 MB in all; `index.html` 136 KB). Each image is named by
its step (`img/2-25-0970.jpg` is step 2.25, Biology O.L.). Beside each step of Parts 2 to 4 that has one, the
school's own form wording (SCHOOL_FORMS.md §2.1–§2.5) is quoted in yellow; the screen's labels are marked as
the screen writes them.

## 2. Method

- **The clone.** `git clone --branch feature/walkthrough-cycle` into `/tmp/f8-clone`, its own container
  (`igcse-walk-db`, 127.0.0.1:5434, because 5433 was taken), database `igcse_walk_dev`, API 3191, web 3190. The
  set-up was done twice: once on main 622ba4d, then — when the decisions landed — the clone and its database were
  removed and the whole set-up done again from a fresh clone of the merge (29079c2). Every command in Part 1 is one
  that was run; the logs are in `evidence/setup/`.
- **Files.** The harness lets this session write files only in lead-env, so the artifact was written in a staging
  copy (`/tmp/f8/repo`) and copied into the worktree by `drive/sync.py` (never deleting); commits were made from
  lead-env with plumbing (`drive/commit.py`: a temporary index, `hash-object`, `write-tree`, `commit-tree`,
  `update-ref`), and the merge of main by `drive/merge.py` (`merge-tree --write-tree`). The clone pulls the branch.
- **The drive.** 21 scripts in `evidence/drive/` (playwright-core, headless Chrome, `channel: 'chrome'`), sharing
  `lib.mjs` (sign in through the real sign-in page, a JPEG under 150 KB per shot, quality lowered then the image
  scaled if needed) and `cycle-data.mjs` (the cycle's placeholders, also the demo script's data). Every step is done
  through the screens. Two things are not: the Arabic A.L. second qualification (no screen; the item endpoint, a
  finding) and, in the first exploratory run only, one deadline moved through the API (the final run sets every date
  in the dialog).
- **The final run.** `drive/final-run.sh` stops the API it started, drops and recreates `igcse_walk_dev`, migrates
  (62), restarts the API, then runs Part 1 and every later script in the order the events happen (the families of
  Parts 3 and 4 interleave with the desk and the follow-up of Part 2). Run 19:59Z–20:14Z on 16 Oct: 20 scripts, every
  one ending with no failed request and no page error (`final-run.log`), 162 shots. `p5-screens.mjs` (the
  withdrawal and the screens not yet shown) ran right after it on the same system (20:35Z–20:54Z); it is the run
  script's last line since. An earlier full run (19:14Z–19:28Z) was reviewed screen by screen (contact sheets) and
  led to the final run's changes (readable viewport shots instead of three tall ones; the IGCSE option codes the
  entry list asked for; the student's request with a teacher choice and a declared one-paper retake).
- **The page.** `drive/gen.py` (+ `gen_part2b.py`, `gen_part34.py`, `gen_writer.py`, `gen_style.css`) holds every
  step's words, numbers the steps, copies each shot under its step's name and writes `index.html`.
  `drive/check-page.mjs` opens it from disk: 184 images load, 212 in-page links resolve, no external request.

## 3. The demo script

`docs/walkthrough/demo/build-june-2027.mjs` (Node 22, no dependency) rebuilds Part 2's set-up through the API —
the school's name, the team, the catalogue, the June 2027 session and its sheet in the forms' words (the Arabic GCE
qualification included), the fees, the dates, the session opened and the reminders on — from a database Part 1 has
set up. Its data is `demo/cycle-data.mjs`, the same file the drive used. `demo/june-2027-placeholder-sheet.xlsx` is
the import's placeholder sheet (one family, three lines, no phone), made by `demo/make-placeholder-sheet.mts` with
the import tests' own xlsx writer (byte-identical when made again).

Proven on a second database `igcse_walk_script` (62 migrations, the admin signed up through the API's sign-up
endpoint and promoted by the seed, a second API on 3193): one run built everything; a second run changed nothing;
a normalised dump of the set-up (`evidence/compare.sql`: settings, staff, teachers, subjects with their awards and
units, awards with papers and options, units, sessions, the sheet's subjects with teachers and their papers, units
and routes with state, fees and teachers, every fee row, the deadlines) is identical, line for line, to the dump of
`igcse_walk_dev` built on the screens (`compare-ui.txt`, `compare-script.txt`, `compare.diff` empty).

It builds the set-up only, so that the later steps (the desk, the families' sign-ups) can be followed as written on
what it builds; the families and their money are the screens' to make.

## 4. Decisions and why

1. **Teachers numbered in the forms' order**, a new number per teacher a form names (33), since the forms name
   T1, T2, T3 per form and nothing says which are the same person. One provider, "External Team", for the three
   subjects the links sheets give an external team.
2. **The fee lists' codes** for the O.L. subjects (0970 Biology … — the seed's samples are older syllabi), the
   boards' codes for the IAL units and Arabic IAL, school codes for what no list names (ESL-OXFORD, PSY-OXFORD,
   GLOBAL-CIT, and the A.S./A.L. rows), marked as such.
3. **The seed's samples deactivated**, not used: they are not the forms' subjects and their codes are not the lists'.
4. **The A level option labels typed in the forms' words** ("A.S.", "A.2. (Carry forward)", "A.L."): the family's
   Reserve page shows the option's label.
5. **Placeholder course fees** (EGP 12,000 O.L.; 15,000 Cambridge A level; 4,000 an IAL unit; 4,000 one paper): the
   school's course fees are in no artefact (Q-14).
6. **The June 2026 lists pasted as published**, to let the demo families pay; the rows no list has typed and left
   "not published yet", to show that state too.
7. **Placeholder deadlines**, Pearson's a week earlier than Cambridge's (13 and 21 Feb 2027) so that the checkout's
   "Pay by exam series" — one payment per board — is seen.
8. **The session opened early** ("Open now" before its 1 Nov start) and the course starting 1 Nov 2026, so the drop
   is refunded at 100% under the June policy.
9. **A one-paper retake at the student's request** (Chemistry Paper 41/42, declared from June 2026) and a choice of
   teacher (Arabic, Teacher 2), so Part 3 shows both form questions.
10. **Local rate limits raised** in the clone's `.env` (`API_RATE_LIMIT_MAX=20000`): the scripted run exceeded the
    default 600 requests in 15 minutes from one address; Part 1 lists the variable and says so.

## 5. Findings — what the screens could not do as the forms describe it

| # | Finding | Where | For |
|---|---|---|---|
| F8-01 | On a fresh database the seed's 17 sample subjects carry older Cambridge codes and are unmapped (0038's backfill ran before them); its two sessions are of 2026: June 2026 closes at the scheduler's first tick, November 2026 – January 2027 stays a draft whose window ended 1 Oct 2026. Home leads with it ("Being prepared … Add the subjects"), a student's record lists it as an exam series open now, and no screen removes a draft | `packages/db/seed.ts`; Home; Sessions | the lead: a seed for a school installed after 2026, or a way to remove a draft |
| F8-02 | Adding a subject the forms name needs Subjects (`/admin/subjects`), hidden from the sidebar by decision 8; the Catalogue maps but cannot add. Its form and CSV still ask the old Registration Fee and Core | Subjects, Catalogue | decision 8 revisited, or "Add a subject" on the Catalogue |
| F8-03 | A core sample cannot be deactivated until "Remove core designation"; deactivated subjects still count in the Catalogue's "N subjects are not mapped yet" | Subjects, Catalogue | UI |
| F8-04 | Arabic A.L.'s second qualification (GCE 9AA0) has no screen: the item endpoint only (decision 4). The demo script and the drive use it | the subject's form | Q-16 / decision 4 |
| F8-05 | A one-paper retake reads the syllabus's whole board fee (Q-13): Paper 41/42 with 10,850; Edexcel 1H alone with 9,200 where the list prices a paper at 4,600; the list must name the syllabus twice ("0970 CX" and "0970") | pricing, Fees tab | Q-13 |
| F8-06 | Form options with no shape of their own: Computer Science O.L.'s "Paper 41/42" (left from last year: 0984 has no Paper 4); Physics A.S./A.L.'s three A.2. choices are one route; "Self Study (ONLY 2nd entry)" Yes/No is the entry choice | the sheet | none: recorded |
| F8-07 | The fee lists in hand are June 2026's; Oxford, Environmental Management, Global Perspectives, Global Citizenship, the French and Psychology A levels, Biology IAL units 1–4, Human Biology and Arabic GCE have no list row; Oxford's and Global Citizenship's codes are not the boards'; three Cambridge syllabi have no option code, so their entries would be flagged | Fees, Entry Lists | F-02, the school's lists |
| F8-08 | After an InstaPay reference, the family's Home still counts the lines awaiting verification (EGP 60,900) and its Pay now opens the checkout of all three, which stops at "Payment already started"; the other board's line is paid from My Registrations | family Home, checkout | UI (a family left without a way forward on Home) |
| F8-09 | The desk's "To collect now" lists and ticks lines whose InstaPay transfer awaits finance, "Owes now" counts them, and Collect is refused ("These subjects already have a transfer in progress …") | the desk | UI |
| F8-10 | Codes and raw amounts on families' screens: the statement's "(cash)", "(instapay)"; notifications "Payment of EGP 21200.00 via in_school", "Escrow balance credited … EGP 16850.00"; Pending Requests "16850.00 EGP"; the workbench dialog "39700.00 EGP"; in Arabic the statement's "With Parent", "Returned to School" | statement, notifications, requests | UI, decision 14's deferred API sentences |
| F8-11 | The reservation slip and the receipt print "IGCSE Subject Reservation System", not the school's name | slip, receipt | decision 15's reach |
| F8-12 | Staff words: Settings' refund card names "(SCHOOL_FORMS.md §2.1)"; the exception sentence "by 2026-12-20", "1 due dates moved."; My Registrations' Request Drop and Drop dialogs have no dialog role; the admin's Profile offers "Linked Parents" | Settings, Exceptions, My Registrations, Profile | UI |
| F8-13 | README.md says uploads fail without R2 (in development they go to `LOCAL_UPLOAD_DIR`); `.env.example` still lists `AUTO_GRADE_PROGRESSION` (removed) and lacks `LOCAL_UPLOAD_DIR` | README.md, .env.example | documents |
| F8-14 | One address exceeding 600 API requests in 15 minutes is refused (429): reached by the scripted run; a busy desk behind one public address reaches the API from one address unless `CLIENT_IP_HEADER` is set behind a proxy | `API_RATE_LIMIT_MAX` | SECURITY_AUDIT O-4: deployment |

None blocks a journey: every one has a way through, which the walkthrough takes and names.

## 6. Not in this version

Everything outside the reservation cycle (F6b's switch): timetables, attendance, leave, remarks, results,
forecasts, certificates. The November 2026 – January 2027 cycle (only its forms' titles are known). Staff screens
in Arabic beyond what Parts 2 shows (the family's are shown in Part 4). Grade 10's reservation by the school (no
form has a grade-10 class: Q-10).

## 7. Gates

No file under `apps/` or `packages/` changed, so the type-checks and the suite are main's (9a38c3d, CI run
38936639893 green); CI runs them on every push of this branch (gate 0 checks the evidence's size and the trails and
documents for mobile numbers: none here).

## 8. Progress log (UTC, 16 Oct 2026; the times are the trail's rows and the files' own)

- 17:04 — started (trail); the branch pushed at main 622ba4d; then the clone, install, container (5434), database,
  env, builds, 61 migrations of main, the servers on 3191/3190, the first sign-up, the seed, a first look at the
  catalogue.
- 17:20 — the decisions had landed (the coordinator's message): origin/main 9a38c3d merged as 29079c2 and pushed;
  the servers stopped by their PIDs; the clone and its database removed.
- 17:21–17:30 — the set-up again from a fresh clone of the merge: 62 migrations; Part 1 driven; the school's name.
- 17:30–18:18 — Part 2's set-up driven and refined (team, catalogue, settings, session, 25 subjects, fees, dates,
  previews, opening); the families, the desk, the workbench, the request and its approval explored.
- 18:20 — resumed after a lost connection: the state checked, nothing had died, every shot on the merged code.
- 18:20–19:07 — the follow-up, the drops, the entries, the import, the ends of Parts 3 and 4 driven; findings
  gathered. 19:07 — the first full run stopped at a 429 (rate limit); the clone's limits raised.
- 19:14–19:28 — the first full run, clean; its 156 shots reviewed. 19:19–19:27 — the demo script written; its
  database `igcse_walk_script` made (19:23), seeded (19:27); run twice.
- 19:59–20:14 — the final run, clean, 162 shots; 20:01 the script's set-up dumped, then compared with the screens':
  identical (trail 20:18).
- 20:35–20:54 — the remaining screens (p5); the page generated and checked offline; this document.
