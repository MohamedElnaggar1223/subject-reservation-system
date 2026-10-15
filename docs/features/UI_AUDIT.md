# F6 — The UI audit of the reservation cycle

**Spec:** FEATURES_PLAN.md §1 "F6" (scoped on 15 Oct 2026 to the reservation cycle; the owner's standard of
14 Oct 2026 in §1 "F6b"). **Branch:** `feature/ui-audit` (worktree `.claude/worktrees/ui-audit`), from main
d6c6715. **Databases:** `igcse_ui_dev` (a copy of `igcse_template_dev`), `igcse_ui_test`. **Ports:** API 3071,
web 3070. **Built by:** one Opus 5.5 implementer; one Opus 5.5 reviewer and the lead's drive follow.
**Trail:** `.audit/ui-audit.tsv`. **Evidence:** `.audit/ui-audit-evidence/<screen>/before-en.jpg`,
`before-ar.jpg`, `after-en.jpg`, `after-ar.jpg`, with each drive's measurements in
`.audit/ui-audit-evidence/drive-before.json` and `drive-after.json`.

The owner, 14 Oct 2026: *"the exact same person who created the forms is the one who will be the Admin, the
parents/students who dealt with the form will be the people who use the system so our system should make the
process much much more easy while staying being familiar and so easy to use, it should be like a flow … 'That
was exactly what I was going to do next and it's here in front of me' … very simple, yet offer all the
complexity needed."*

**In one sentence.** Every screen a role reaches while F6b's switch is on was driven at its device in English
and Arabic, judged against a written checklist (the principles below and the owner's standard), and fixed in
its presentation and flow — the project's own components and tokens, no model change, no new endpoint, the
money paths untouched.

(The sections below are filled in as each group of screens is finished; the progress log at the end says
where the work stands.)

---

## 1. Scope — the screens per role, from the switch

The switch is `RESERVATION_CYCLE_ONLY` (`apps/web/lib/reservation-focus.ts`); every screen a role reaches
from its sidebar or from a link on a kept screen while it is on (RESERVATION_FOCUS.md §2), at the device the
role uses. Hidden screens are not audited. The drive's screen ids (`.audit/ui-audit-evidence/<id>/`) are in
brackets.

| Group | Screens (role that drives them) |
|---|---|
| The shell | the sidebar and its controls, every page's language, the top bar at a phone (every role) |
| 1. Landings and set up | admin landing `/` [s01], coordinator landing [s02], teacher and gate landings [s03, s04]; Sessions [s05]; the Session screen's tabs — Subjects [s06], Fees [s07], Money [s08], Grade 10 [s09], To verify [s10], the coordinator's sheet [s11], a session being prepared [s12]; Exam Catalogue [s13]; Subjects [s14]; Board Series and its dates form (also the session header's dates dialog) [s15]; Board Services [s16]; School Fees [s17]; Settings [s18]; Day-one Import [s19]; Team [s20] |
| 2. The desk and the Student 360 | the desk with Today (finance officer) [s30], the desk with a student open — the Student 360 [s31], the desk as the admin [s32], Students [s33], the student record [s34] |
| 3. Money and follow-up | Charges [s40], Payments (transfers to confirm) [s41], Exceptions [s42], Messages (compose, the Sent log, reminders) [s43], Escrow (withdrawals) [s44], Finance Workbench [s45], Daily Takings [s46], the Money tab as the officer [s47], Sessions as the officer [s48] |
| 4. The entries to the board | Exam Deadlines [s50], Exam Entries [s51], Entry Lists [s52] |
| 5. Account and the papers | Notifications [s55], Profile [s56], the printed receipt [s58], the reservation slip [s59] |
| 6. Families (at a phone) | home — a parent owing money [f01], a parent before the school fee [f02], a parent with a request to approve and a wallet [f03], a parent paid with instalments [f04], a student [f05]; Reserve — a parent [f06], a student [f07]; My Registrations [f08]; History [f09]; Approvals [f10]; Statement [f11], a student's [f22]; School Fee [f12]; Charges & Instalments [f13]; the wallet (Escrow Balance) [f14] with its withdraw [f15] and transfer [f16]; Linked Children [f17]; Checkout [f18]; Pending Requests (student) [f19]; Notifications [f20]; Profile [f21] |
| 7. Sign-in and sign-up | sign-in at a desktop [a01] and a phone [a02], sign-up [a03], as a parent [a04], as a student [a05], forgot password [a06], verify email [a07], unauthorized [a08] |

## 2. Method

1. **Dev data, placeholders only, through the API** (never a migration or a seed): the scripts are in
   `.audit/ui-audit-evidence/drive/` and reproduce it on a fresh copy of `igcse_template_dev` in order:
   `setup-1-catalogue.mjs` (F6a's catalogue: Biology's papers, IAL Mathematics' units, Physics 9702's
   routes, Arabic A level's two qualifications; three placeholder teachers; a coordinator),
   `setup-2-cs.mjs` (Computer Science's papers), `setup-3-sessions.mjs` (June 2027 open with the six
   shapes, November 2026 – January 2027 and June 2028 being prepared, the board fees),
   `setup-4-shapes.mjs` (the boards' June 2027 dates; Biology's Paper 4 a retake in school or self study;
   Chemistry "Retake (Self Study ONLY)"; Computer Science with an external team and no board fee yet),
   `setup-5-families.mjs` (a teacher and a gate account; the academic year 2026–2027 with sections 11A and
   12A; the school fee; four families — A paid at the desk with Physics on three instalments, B reserved in
   the app with a declared Biology Paper 4 retake to verify and a pushed charge two days overdue, C with a
   student's request awaiting the parent and a paid line dropped and refunded to the wallet, D with nothing
   yet; a message to every parent and a payment reminder), `setup-6-drop.mjs` (C's drop),
   `setup-7-transfer.mjs` (B's InstaPay transfer to confirm; C's withdrawal request). Each takes the ports
   from `API`/`WEB` (default 3071/3070).
2. **The drive** (`drive/drive.mjs`, `drive/screens.mjs`; `playwright-core` with `channel: 'chrome'`): every
   screen of §1 as its role, signed in through the real sign-in page, staff at 1366×900 and families at
   390×844, in English and in Arabic (the language set as the reader would: the cookie and the old
   localStorage). Per screen: the whole main area as a JPEG under 300 KB, axe-core 4 with the WCAG 2.0/2.1/2.2
   A and AA rules, the console's errors (React's hydration warning among them), the API requests the screen
   made and the time to settle — `drive-before.json` and `drive-after.json`.
3. **The checklist** per screen (§3): Nielsen's heuristics, WCAG 2.2 AA (contrast, focus, labels, target
   size, reduced motion), UX_AUDIT.md §4's desk-first test, information architecture, consistency with the
   project's tokens and components, keyboard use for staff, Arabic and right to left, the device (staff at
   desks and tablets, families at phones), loading, empty and error states, sentences not codes, tables
   (sorting, filters, density, export), print, performance — and the owner's standard: what the person just
   did on the form or the sheet (SCHOOL_FORMS.md §1, §2) and whether the next step is in front of them,
   nothing outside the cycle, the forms' words (SCHOOL_FORMS.md §2.5, SESSION_WORDS.md §2). Only a finding
   is written down; a principle with nothing to say about a screen is not repeated on it.
4. **The fix**, in the project's components and tokens: no new palette or hex value (one token's value
   changed to another token's, §3.0), no new component library, no model change, no new endpoint, the money
   paths untouched. Every new or rewritten string has its Arabic in `lib/i18n-ui-audit.ts`.
5. **After**: the same drive (`after-*.jpg`, `drive-after.json`); the steps counted where a fix changes them
   (§6, by RESERVATIONS_REWORK.md §11's method: inputs and clicks).

Severity: **H** — the person cannot do the next step, or the screen says something untrue; **M** — the next
step is there but costs a search, a guess or a scroll, or a WCAG AA failure; **L** — polish.

## 3. The checklist, screen by screen

### 3.0 The shell (every screen)

| Principle | Finding | Sev | Fix |
|---|---|---|---|
| Arabic, errors | React's hydration warning on every page read in Arabic (70 of 71 Arabic screens in the before drive; Next's dev overlay "1 Issue"): the language provider's first render read localStorage, which the server does not have — the server rendered English, the browser's first render Arabic (since 2c3d27f, 30 May) | H | **The cause fixed:** the language lives in a cookie the root layout reads, so the server renders the page in the reader's language and direction and the first render agrees (`lib/language.ts`, `app/layout.tsx`, `lib/i18n.tsx`); an earlier localStorage-only choice is carried into the cookie once. After: no screen in either language logs a hydration error, and an Arabic page arrives right-to-left from the server (no flash of a left-to-right layout) |
| WCAG 1.4.3 contrast | the sidebar's lit item and the "IG" tile: white on the bright teal, 2.92:1 (every staff screen); the subtitle and role at 50% (4.17:1); the stage titles at 40% (3.11:1) | M | the lit item's text takes the sidebar's own deep teal (`--sidebar-primary-foreground` set to the `--sidebar` value: 5.98:1); the subtitle and role at 70% (7.0:1), the stage titles at 60% (5.46:1). No new colour: a token takes another token's value |
| WCAG 4.1.2 names | the sidebar's collapse button and the phone's menu button had no name (axe `button-name` on all 71 screens) | M | "Collapse the menu" / "Expand the menu" and "Open the menu", with `aria-expanded`; the phone's menu button 40 px (it was 36) |
| WCAG 2.5.3 label in name | the sign-in pages' language button was named "Switch language" while it shows "العربية" | M | its visible word is its name, marked `lang` in the other language; "Switch language" stays its tooltip |
| Screen readers | the current page was not marked in the sidebar; the unread badge said "3 unread" in English on an Arabic page | L | `aria-current="page"` on the lit item; "unread" from the dictionary |
| Hono RPC | the sidebar's unread count hand-cast its response (`as { count?: number }`) | L | the response's own type |
| RTL | the badge and the collapsed dot sat by `right`/`ml-auto` | L | logical `end`/`ms-auto` |

### 3.1 The admin's landing `/` [s01] and the coordinator's [s02]

What she did on the sheet: opened the links sheet and scanned it for a missing teacher or fee, opened the
response sheet to count who paid, kept the boards' dates in her head. F6b's landing already does the scan
and puts one filled button in front of her ("Set the fees": Computer Science has no board fee).

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Owner's standard / consistency | each closed session still in progress said "Closed to new reservations." under its "Closed" badge — twice on the card, and again on every closed card (the lead's drive) | M | said once, as a heading above the closed sessions still in progress, with what keeps them there ("families still owe money, or entries still go to the board: each card says which"); the cards drop the sentence |
| IA | "8 reservations · 1 paid · 7 unpaid": the unpaid count includes the two waiting for the parent's approval | L | recorded: the Sessions list's summary counts them so; the Money tab splits them ("2 awaiting the parent") one click away |
| WCAG | sidebar contrast (§3.0) | M | fixed in the shell |

### 3.2 The teacher's and the gate's landings [s03, s04]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Owner's standard | nothing in the cycle; the sentence says their screens come later and puts notifications and profile in front | — | none needed |

### 3.3 Sessions `/admin/sessions` [s05, s48]

What she did: the links PDF per cycle; the cycle she is running is the one she opens.

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Owner's standard / IA | ordered by start date, latest first: June 2028 (empty, being prepared) at the top, the open June 2027 third | M | the cycle's order: open first, then those being prepared (soonest first), then the closed (newest first) |
| Sentences, not codes | "Reserve … Due …" — reserve what, due what | L | "Families reserve …", "Payment due …" |
| Sentences | a sitting's badge "128 days left" did not say to what | M | "entries by 20 Feb 2027 · 128 days left" |
| Next step | a session being prepared read "0 subjects · 0 boards" | L | "No subjects on the sheet yet." in amber (open and being prepared only; a closed converted window keeps its count) |
| Noise | "Money" on sessions with nothing reserved | L | shown where the session has reservations |
| HTML validity | each button was a `<button>` inside a link | L | the link styled as the button (`asChild`) |

### 3.4 The Session screen [s06–s12]

The header, the deadlines line and the Subjects tab are F6a's work in the forms' words and were judged
again only for what F6a left open.

**Subjects [s06, s11] and the subject's form**

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Aesthetic and minimal | Mathematics A.S./A.L. read "P1 (Teacher A) · P2 (Teacher A) · P3 (Teacher A) · P4 (Teacher A) · M1 (Teacher A) · S1 (Teacher A)": a unit taught by the subject's own teachers repeated them | L | a unit names its teachers only when they are its own: "P1 · P2 · P3 · P4 · M1 · S1" (the Teachers column names Teacher A once) |
| Queued (follow-ups' review) | rebuilding the subject's form after a Replace a teacher discarded what was typed on it before | M | **kept**: what was typed (offered as, fees, papers, units' offers and sittings, grade-10 core, course start, notes) is carried into the form made again; only its teachers are read again (a kept tick could send the teacher who left back with the next Save). The dialog says so: "Anything else you changed on the subject's form stays; its teachers are read again after the replacement." |
| Next step | "Set this subject's papers on the Catalogue" opened the Catalogue's first tab; the papers are set on its Qualifications tab | L | the link opens that tab |

**Fees [s07]**

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Owner's standard / IA | the two rows needing her (Arabic's fee not published, Computer Science's missing) were 4th and 26th of 26; seventeen rows of the board's list no subject on the sheet reads filled the grid | M | the missing fee first, then the provisional ones, then the confirmed fees the sheet reads, each by its code; the board's other rows behind "17 more fees on the board's list, not read by any subject on this sheet — Show them" |
| Sentences | the column "Lines" (the model's word; Arabic "الأسطر", text lines) | M | "Reservations" |
| Consistency | Pearson's grid out of code order | L | by code |

**Money [s08, s47]**

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Sentences | the first tile "Lines" | M | "Reservations"; the empty state "No reservation here" |
| IA | "2 provisional (not payable yet)" sat under the Overdue tile | L | under Unpaid, with what is unpaid |
| Consistency | the Charges table's header looked unlike the lines' table above it | L | the same header |
| Tables | no column sort | L | recorded: the order is student then subject, and the filters (unpaid, overdue, provisional, paid, section, subject) and Export cover what finance asks; a sort is §8 |

**Grade 10 [s09]**, **a session being prepared [s12]**: nothing to fix (the empty sheet offers "Copy from"
first, F6a).

**To verify [s10]**

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Sentences | the column "Line" and the intro's and answers' "line" | M | "Reservation"; the intro and the three outcomes in words of reservations, with their Arabic rewritten (the old Arabic read "السطر") |

**The dates dialog** (the header's deadlines, and the Board Series page) — see §3.7.

### 3.5 Exam Catalogue `/exams/catalogue` [s13]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Responsive | the subjects' table (1100 px) pushed its "Change" buttons off a 1366 px screen beside the sidebar | M | the table wraps within 940 px; the units' table likewise |

### 3.6 Subjects `/admin/subjects` [s14] — kept in doubt (RESERVATION_FOCUS §8, Q4)

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Forms' words | "Council" (column and filter) | L | "Board", as the sheet and the forms say |
| WCAG 4.1.2 | the two filters had no name (axe `select-name`), the search only a placeholder | M | named |
| RTL | headers aligned `left`/`right` | L | `start`/`end` |
| Owner's standard | the fee column ("EGP 1,500 · 1,200 + 300 reg") predates the session's fees and differs from the sheet's | M | recorded for the owner's answer to Q4 (keep, relabel or hide the page); not changed |

### 3.7 Board Series `/exams/series` [s15] and the dates dialog

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Owner's standard (the lead's drive) | the dates form carries eleven "other dates" and notes the school never fills, above Save, in the session header's dialog and on this page | M | behind a disclosure — "The board's other dates (information) (none set)" with the sentence that the entry deadline is what stops reservations; it opens by itself when one is set |
| Sentences | the column "Windows feeding it", "No window yet" (the pre-rework word) | M | "Sessions", "No session yet" |
| Sentences | "1 payments open" | L | singular and plural |
| Responsive | the table (1080 px) cut its Dates button off | M | the late-fee columns only when a series has one (860 px otherwise) |
| Sentences | the empty state told her to "give each window the series it feeds on the Sessions page" — a step that no longer exists | M | "A sitting appears here once a subject on a session's sheet is entered in it; add one here only to type a board's dates early." |

### 3.8 Board Services `/exams/services` [s16] — kept in doubt (Q3)

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Next step | "Dates and fees in a series" waits on "Pick a series…" with nothing chosen | L | recorded (§8): the services' series are the remark services' (outside the cycle) and the cash-in's; the owner's Q3 decides whether this page stays |

### 3.9 School Fees `/admin/school-fees` [s17]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Truth | "Refund Windows … No refund windows — drops refund 100% until configured.": since the rework each session carries its own refund policy (the session's header; `refund.services` reads these windows for converted reservations only) | H | the windows behind a disclosure titled "Refund windows (reservations made before October 2026)" that says each session's policy applies; the empty state "No refund windows: the sessions' own refund policies apply." |
| Consistency | dates as the browser writes them ("9/1/2026", month first) | M | the school's dates ("1 Sep 2026") through the shared `Day` |
| WCAG 1.3.1 / 4.1.2 | twelve inputs whose labels were not tied to them (axe `label` 6, `select-name` 2) | M | every label tied to its input |
| Hono RPC | three hand-written row types with three `useQuery<…>` generics and `as` casts | M | the fetchers' own types; the generics count falls from 19 to 16 |
| RTL | `text-left`/`text-right` | L | `start`/`end` |

### 3.10 Settings `/settings` [s18]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Error | the Exam catalogue group was listed twice — its setting showed twice and React warned of a duplicate key on every load | M | once |
| IA | eighteen settings in an order unrelated to the cycle; nothing to find one by | M | the groups in the cycle's order (who may register, school fee, prices, payment, refunds, declared sittings, exceptions, reminders, then the catalogue, the import, the exam centre, the calendar) and a list of them at the top to jump to |
| Sentences | "How a line's price is made", "When a line's money is due" | L | "a reservation's" |

### 3.11 Day-one Import `/imports` [s19], Team `/admin/team` [s20]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| — | nothing beyond the shell; the import's review screen is §4's queued finding | — | — |

## 4. The queued findings, one by one

## 5. Accessibility results

## 6. Measurements

## 7. Decisions and why

## 8. Deferred, and why

## 9. Questions for the owner

## 10. Proof

## 11. Progress log (UTC)

- 15 Oct 04:36Z — setup: worktree installed and built, `igcse_ui_dev` from the template and migrated (61),
  env files on 3071/3070, dev servers started (API pnpm pid 99084, web pnpm pid 99085).
- 04:36Z — the Arabic hydration warning reproduced on /sign-in and traced to `I18nProvider`'s initialiser.
- 04:38–04:45Z — the dev data through the API (`setup-1` … `setup-7`, §2).
- 04:46Z — the suite on main d6c6715 in local time: 43 files, 836 passed, 1 todo (the baseline).
- 04:47Z — the before drive started (every screen, English then Arabic); finished 04:52Z: 142 records,
  `drive-before.json` (axe: colour contrast on 41 screens, an unnamed button on 63, `select-name` 5,
  `label` 2, `label-content-name-mismatch` 7, `dlitem` 2, `scrollable-region-focusable` 2; errors: the
  hydration warning on 70 Arabic screens, a duplicate key on Settings, a server log on the sign-up pages).
- 04:56Z — the hydration warning fixed at its cause (the language cookie), probed clean.
- 04:57–05:10Z — the shell (contrast tokens, names) and group 1 fixed (§3.0–§3.11); `useQuery<` generics 16.
- 05:15Z — CSS edits were not picked up by the running dev server (Turbopack served the old
  `globals.css`): the web server (my PIDs 99085/99088) stopped, `apps/web/.next` cleared, restarted (pnpm pid
  28901). A CSS change needs that restart. 05:16–05:19Z group 1 driven after: no axe violation and no console
  error on any of its 20 screens in either language (`drive-after.json`).
- Next: commit group 1; group 2 (the desk and the Student 360).
