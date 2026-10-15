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

(The progress log at the end says how the work went, group by group.)

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
| Reduced motion (WCAG 2.3.3) | every page fades its parts in (`animate-fade-up`, staggered) and a few pulse forever; nothing in the project answered a system's "reduce motion" | L | under `prefers-reduced-motion: reduce` the entrance animations and the pulses are off (`globals.css`); the loading spinner keeps turning |

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

### 3.12 The desk `/desk` [s30, s32] and the Student 360 [s31, s35, s36]

What the officer did on the sheet: found the family's rows with Ctrl-F, wrote the fee note, wrote a paper
receipt per column (UX_AUDIT.md §1). The desk already answers it in one screen; what stood between the
officer and the next step:

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Owner's standard / money shown | for a family on three instalments, "To collect now" ticked all three — "Collect EGP 24,850" for a plan whose first instalment falls due in three days | H | each plan's next instalment (and any already due) ticked; the later ones listed, unticked: "Collect EGP 8,283". The officer can tick the rest. The API, the payment and the receipts are unchanged |
| Owner's standard (queued: step 4) | the parent-consent tick ("Refund policy and declaration read and signed by the parent") showed for every waiting line, also those the family had reserved itself with both consents | M | shown — and sent — only when a ticked line carries the school's consent alone (a grade-10 line the school reserved). The summary gains `familyConsentNeeded` per line, read from `consentStanding` as the checkout reads it; a new 08o scenario and its control (§10) |
| Owner's standard | a walk-in family whose school fee gates reserving: the fee unticked in "Also collect now", so "Reserve and collect" was refused for it; and three more "Collect fee — Cash / Credit / InstaPay" buttons in the header, a third place to take the same fee | M | the fee ticked first in "Also collect now" (the button reads "Reserve and collect EGP 30,000"); the header keeps the fee's badge and drops its three buttons ("To collect now" collects the fee alone, with its instrument) |
| Desk-first (memory) | the student record's "Payments and receipts at the desk" opened an empty desk: the officer searched again | M | it opens the desk on that student (`/desk?student=`): one input and one click fewer |
| Queued (C) / Hono RPC | the desk hand-cast API responses: the school fee's answer (`as unknown as { amount: number }`) and three statuses (`as keyof typeof …`) | M | the answer's own type (and the header's fee buttons that used it are gone); the statuses read through `labelFor(map, value)` in `lib/format.ts`, the response untouched |
| Sentences, not codes | "Recent payments": "10/15/2026", "registration · cash", "completed" (codes, the browser's date) | M | "15 Oct 2026 · Reservations · Cash · Completed" |
| WCAG 1.4.3 | "Owes now" in amber-600 on white, 3.2:1 | M | amber-700, 5.0:1 |
| Jargon | "+ New Family (Onboard)", "Close Onboarding" | L | "+ New family", "Close" |
| Reserve card | "Cambridge International June 2027" under every paper of a one-sitting subject (20 rows); "0 lines · EGP 0", "Reserve 2 lines" | M | the sitting only where a subject's papers sit in more than one; "reservations", "Reserve (2)"; the Arabic sentences say حجوزات, not أسطر |
| RTL | `text-right`, `ml-1` in the tables | L | logical |
| Keyboard | the search is focused on arrival (kept); opened from a record it is not, so the page does not jump | — | — |

### 3.13 Students `/students` [s33] and the student record [s34]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Arabic, errors | a hydration warning in Arabic remained here after the language cookie: the page translator rewrote the list's server HTML inside a Suspense boundary before React hydrated it | H | the translator touches only what React owns and looks again while a part waits to hydrate (§4.1) |
| Jargon | the filter "Graduation inferred by the backfill" | L | "Graduation worked out from the old records (not confirmed)" |
| Owner's word | "Subjects this year: Not enrolled… 3 exam registrations have no enrolment" (course enrolment, outside the cycle) | — | kept for the owner's word (RESERVATION_FOCUS §8, Q5): recorded, not changed |
| Search-first | "Enter opens the first student; the arrow keys move through the list" — already the desk standard | — | — |

### 3.14 Charges `/charges` [s40]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Owner's standard | per family, the charges owed with one Collect — the desk's own pattern | — | none needed |
| Consistency | each family's card aligns its columns on its own, so amounts do not line up across cards | L | recorded (§8): a shared grid would change the component for all money lists |

### 3.15 Payments `/admin/payments` [s41]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Truth | "No pending bank transfers — All transfers have been confirmed." while a family's InstaPay transfer waited: the page lists only the old bank-transfer method (`pending-bank`, `paymentMethod = 'bank_transfer'`, which no new payment uses); InstaPay transfers are confirmed on the Finance Workbench | H | the page says how many InstaPay transfers wait on the Finance Workbench, with the button that opens it; its empty state "No bank transfer is waiting — transfers families make by InstaPay are confirmed on the Finance Workbench". Whether the admin's sidebar keeps this screen is the owner's question (§9) — F6b's list is not F6's to change |
| Consistency | a big green tick for "nothing waiting" | L | removed with the untrue sentence |

### 3.16 Exceptions `/admin/exceptions` [s42]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Sentences, not codes | "Every hook reads them" (the code's word for where a rule is applied) | L | "Each takes effect where its rule applies" |
| Forms' words | the scope "Item (paper, unit or route)", "One reservation line" — the model's words (SESSION_WORDS.md's rule) | M | "Paper, unit or component", "One reservation" (`POLICY_SCOPE_LABELS` in `@repo/validations`, read by the screen from the policies endpoint) |

### 3.17 Messages `/admin/messages` [s43, s43b–d]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Queued (follow-ups' review) | the Sent log named a class by its teacher on the day the log was read, not when the message went out | L | **fixed** (it was cheap): a sent message is named by the words its MESSAGE_SENT audit row keeps — the words it went out with; reminders keep their rule's words. An 08s scenario and its control (§10) |
| Queued (owner's word) | "A section" is فصل on Messages (C's dictionary), and a teaching group is فصل on the desk | — | recorded for the owner (§9): the brief keeps it for the owner's word |
| Sentences | the composer's variables `{guardian}`, `{student}` read as code | L | recorded (§8): they are the template's own tokens and each is filled before sending; naming them in words would need a second set of tokens |

### 3.18 Escrow `/admin/escrow` [s44]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Truth / next step | requests whose cash was already handed over (status fulfilled, or declined after a partial hand-over) wait in this queue for the second signature, yet showed "Fulfill" and "Reject" and no "Approve" | H | such a request reads "Cash released — approval pending", says a second person approves it, and offers **Approve** (the admin may: `POST …/approve` is the admin's and the finance admin's); the others keep Fulfill and Reject |
| Consistency | "10000.00 EGP", "9/27/2026, 5:18:29 AM" | M | "EGP 10,000", "27 Sep 2026 05:18" (the shared `Money`, `InstantText`) |
| Hono RPC | a hand-written request type and a `useQuery<…>` generic | M | the fetcher's type (generics 16 → 15) |
| WCAG 1.4.3 | white on emerald-600, 3.65:1 | M | emerald-700, 5.36:1 (the tone palette's own) |

### 3.19 Finance Workbench `/finance` [s45]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Consistency | "8800.00 EGP", "Requested 600.00 EGP", "10/15/2026, 7:41:55 AM", "9/27/2026" | M | the shared `Money`, `Day` and `InstantText`; the sentences split around them, each part with its Arabic |
| WCAG 1.4.3 | amber-600 notes (3.2:1) and white on emerald-600 buttons (3.65:1) | M | amber-700 and emerald-700 |

### 3.20 Daily Takings `/takings` [s46]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| WCAG 1.3.1 | the day's date input had no name (axe `label`) | M | named "Day" |
| Consistency | "07:41 AM" here, "07:41" everywhere else | L | the school's 24-hour time |
| Print | `Print` and a print layout exist (the drawer's day on paper) | — | — |

### 3.21 Exam Deadlines `/exams/deadlines` [s50]

The group-4 before shots were taken again after the Cambridge June 2027 entries were derived (`setup-8-entries.mjs`), so
the entries screens are judged with an entry on them; the shell's fixes were already in.

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Next step / noise | "Series without an entry deadline" listed Cambridge June 2026 in October 2026 — a sitting already sat, which needs no deadline now | M | only the sittings still ahead (exams not over, or month not gone) — in `getDeadlines`; an 08x2 case and its control (§10) |
| Sentences | "1 draft entries not sent to the board", "1 registrations still waiting…" | L | one or many, the Arabic rules taking both |
| Owner's word | the exam-start rows say "No timetable imported yet" (the timetable is outside the cycle) | — | recorded: RESERVATION_FOCUS §8 Q6 (show only the entry dates?) is the owner's |

### 3.22 Exam Entries `/exams/entries` [s51]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Forms' words | "Each paid reservation becomes what its item enters with the board" — "item", "enters" are the model's words | M | "Each paid reservation becomes its entry with the board: a Cambridge syllabus with its option code, Pearson units one by one, a paid cash-in as its award." |
| Owner's standard | from the landing's "Exam entries" the series is chosen and Preview / Make them is one step — the board's own list one click on | — | — |

### 3.23 Entry Lists `/exams/entry-lists` [s52]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Sentences | "Each comes from the research" | L | "Each was set from the board's handbook" |
| Truth / internal names | the board's rules end "From DISCOVERY_RESEARCH.md §2 (Cambridge Handbook 2026)" — an internal file's name on a staff screen | L | recorded (§8): the text is the rule's stored source (migration 0057's data); changing it is a data change, not F6's — the admin's "Change the rules" edits it |
| Tables | the board portal's columns run past the screen; they scroll inside the card | — | kept: they are the board's file, column for column |

### 3.24 Notifications [s55, f20], Profile [s56, f21]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| WCAG 1.3.1 | the profile's facts were `dt`/`dd` with no `dl` (axe `dlitem` on every profile) | M | a `dl` |
| Screen readers | the "email verified" tick had no name | L | "Verified" |
| Consistency | "Member Since 10/15/2026" | L | the school's date |

### 3.25 The printed papers: the receipt [s58] and the reservation slip [s59]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Forms' words | the receipt said "Council" and "Registration fee" | M | "Board", "Board fee" — the sheet's and the forms' words |
| Consistency | "EGP 14000.00" | M | "EGP 14,000" |
| Empty state / print | the slip opened without its reservations (a bookmark, the record) printed an empty slip at EGP 0 and sent it to the printer by itself | M | it prints the student's live reservations of their latest session; with none it says "Nothing to print" and does not open the print dialog |
| Sentences | the slip's column "Line" | L | "Subject" |
| Arabic | "قيد أول, في المدرسة" (an English comma between two Arabic phrases) | L | a neutral "·" |

### 3.26 The family's home `/` [f01–f05]

What the family did on the forms: one Google Form per subject, the seven identity questions each time, no
price, no due date, nothing to come back to (SCHOOL_FORMS.md §1, §2.1). F6b put the next step on the home;
the lead's drive found the old page still around it.

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Owner's standard (the lead's drive) | the old banner ("IGCSE Subject Reservation System", the role pill, "Registration open — June 2027 … CLOSING IN 119d 23h 50m", or "No active registration window") above F6b's card, and six quick-link cards under it repeating the sidebar | H | **one page in the cycle's order**: the welcome and one sentence of what the page is, the next step for each child, "Coming up", then the family's other pages as one short list (Reserve subjects · My Registrations · School Fee · Charges & Instalments · Wallet, with what it holds · Linked Children; a student's: Reserve · My Registrations · My requests · Linked Parents). The switch off gives back the old home exactly |
| Owner's standard | the filled button — "the one thing in front of her" — went to "Preregister" for November 2026 – January 2027, a session opening in three weeks, ahead of "Pay now" for June 2027's EGP 23,150 (parent B) and ahead of "Approve" for two subjects a child had asked for (parent C); each child listed two sessions to preregister for | H | each child's steps in the order the family meets them: the school fee that gates reserving, a request waiting for the parent, what is owed (overdue first), reserving in the session open now, then what is done and what waits on the school. A session that opens later is not today's step: it is said once, under "Coming up", for the family, with outlined buttons |
| Hono RPC | the home's open sessions were a hand-written row type with a cast (`as ActiveSessionRow[]`) | M | the fetcher's type |
| Forms' words | "Escrow Balance" for a family's money held by the school (the landings already said "the wallet") | M | "Wallet" (المحفظة) in the family's sidebar, on the home and on the wallet page |

Measured (step 4's method, what the person must read or click before the right action): parent B, before:
the filled button was "Preregister" and "Pay now" the third action, two rows down; after: "Pay now" is the
first and only filled button. Parent C, before: "Approve" the third action, below two "Preregister" rows;
after: "Approve" first and filled. The page is half its length at a phone (f03: 2309 px → 1262 px; f01: 1950 px → 1154 px).

### 3.27 Reserve `/register` [f06, f06b, f07]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Responsive (families at phones) | the rows were a 760 px table: at a phone the teacher, the entry and the price were off the screen, reached by scrolling the table sideways; the Session select ran past the card | H | at a phone each paper's teacher, entry and price stack under it (CSS only, the same component; from 640 px it is the table); the selects take the card's width |
| Aesthetic and minimal | "Cambridge International June 2027" under every paper | M | only where a subject's papers sit in different sittings (§3.12) |
| Forms' words | "0 lines · EGP 0", "Reserve 2 lines" | M | "0 reservations", "Reserve (2)"; the Arabic sentences say حجوزات |

### 3.28 My Registrations [f08], History [f09], Approvals [f10], Pending Requests [f19]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Responsive | the status filter ran off a phone's screen ("Dropp…"), the subject cut ("Arabic Langua…") | M | the filter scrolls inside its frame, as a labelled group with `aria-pressed`; the name wraps |
| WCAG 4.1.2 | History's child select had no name | M | tied to its label |
| WCAG 1.4.3 | "Core" in amber-600 on Approvals (3.2:1) | M | amber-700 |
| Hono RPC | My Registrations types its rows by hand (`type Registration = {…}`, a 900-line screen from before the rework) | M | recorded (§8): its rows come from three endpoints and a rewrite of the screen's types is beyond F6's presentation pass; the casts on its status labels now read through `labelFor` |
| Forms' words | a card names the subject, not the paper ("Biology" for "Paper 4 only (retake)") | M | recorded (§8): the registrations read does not carry the item's label; adding it is an API change F6 did not need for any other screen |

### 3.29 Statement `/statement` [f11, f22]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Responsive | an 820 px table: at a phone the price, what is paid and what is owed were off the screen (and the scrolling region took no keyboard focus, axe `scrollable-region-focusable`) | H | at a phone each reservation stacks its figures, each under its name (Price, Paid, Outstanding, Due, Receipt); from 640 px the table; the same component on the desk's Student 360 |
| Forms' words | "Line" (column), "Show ended lines", "Every line with its price" | M | "Subject", "Show ended reservations", "Every reservation with its price" |

### 3.30 Checkout `/checkout` [f18], School Fee [f12], Charges & Instalments [f13]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Consistency | "14350.00 EGP" in every figure; "Pay 14350.00 EGP via Pay at School" | M | "EGP 14,350"; "Pay EGP 14,350 at the school desk" / "… by InstaPay"; the open-payment notice's sentences split around the amount and the date, each with its Arabic |
| School Fee, Charges & Instalments | the fee and the charges owed, each with its pay action | — | none needed |

### 3.31 The wallet `/escrow` [f14] with withdraw [f15] and transfer [f16]; Linked Children [f17]

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Sentences, not codes | "Escrow Management — Manage your children's escrow balances" | M | "Wallet — Money the school holds for each child — refunds and credits — to use on a later payment, move to another child, or take back." |
| Consistency | "14850.00 EGP", dates "10/15/2026" | M | "EGP 14,850", the school's dates |
| WCAG 4.1.2 | the child, from and to selects had no names (axe `select-name` 3) | M | tied to their labels |

### 3.32 Sign-in [a01, a02], sign-up [a03–a05], the password and email links [a06, a07], unauthorized [a08]

What the family did before: opened the school's Google Form from a link, nothing to sign in to. The first
screen of the app is where they decide whether it is worth the switch, so it must say what the account is for
and say only what is true.

| Principle | Finding | Sev | Fix / reason |
|---|---|---|---|
| Untrue | the panel beside every sign-in form: "500+ Active Students · 30+ IGCSE Subjects · 98% Satisfaction" — invented figures; the sign-up's "2 min Quick Setup · Secure Data Protected · Free To Register" | H | one panel for every auth page: "The school's subject reservations, in one place. One account for the family, in place of a form for every subject." and the three things the account does — reserve each child's subjects; pay at the school desk or by InstaPay; see every receipt, and what is still owed. The sign-up, parent and student pages' own copies of the panel (each with its slogans: "Shape your academic future", "Support your child's success") gone with it |
| Forms' words | the sign-up cards and the parent's box: "Register for IGCSE subjects … track your escrow balance", "register subjects on their behalf, and manage escrow transfers", "After registration … Manage escrow and payments" | M | "Reserve your own subjects and follow each one until it is paid"; "Link each child's account, reserve their subjects, and pay at the school desk or by InstaPay"; the parent's box "After you create the account": link each child's account (the child accepts the link), reserve their subjects, pay at the desk or by InstaPay |
| Errors | every visitor's sign-up page logged "[session] getSession failed: Unauthorized" as an error (Next's dev overlay "1 Issue" at a03–a05): the server's session helper counted the API's "no one signed in" as a failure | M | **at the cause** (`lib/auth/session.ts`): a 401 from `/v1/session` is a visitor — null without a log; any other failure is still logged |
| WCAG 4.1.3 status messages | the refusals (wrong password, passwords that differ, a reset that fails) appeared in a plain box a screen reader does not announce | M | `role="alert"` on the five forms' error box. Driven: a wrong password reads "The email or password you entered is incorrect…" in English and "البريد الإلكتروني أو كلمة المرور غير صحيحة…" in Arabic; parent sign-up with two different passwords, "Passwords do not match" / "كلمتا المرور غير متطابقتين" |
| RTL | the cards' chevrons pointed right in Arabic (backwards), the "Back to account type" / "Back to sign in" arrows pointed left (forwards); the cards' hover bar sat on the left | M | `rtl:rotate-180` (the project's pattern, as on the home's list), the bar on the start side |
| Responsive | at a phone the language button sat on the title of the long forms (a04, a05) | L | the form panel leaves the button its own line at a phone |
| Sentences, not codes | "Missing verification token" | M | "This link is incomplete — Open the link in the email again, or copy all of it into the browser." |
| Dead end; sentences | `/unauthorized`: "Unauthorized — You do not have access to this page." and nothing to press; grey from outside the tokens (`text-gray-600`) | M | "This page is not open to your account — It belongs to another part of the school's work. Your own pages are on your home." with **Go to your home**, in the project's button and tokens |
| Arabic | the hydration warning on every Arabic auth page (a01, a02, a03–a07) | H | the shell's fix (§3.0) |
| Kept | the sign-in form itself (two fields, the forgot link, one button); the student's grade cards; forgot and reset password | — | nothing to change |

## 4. The queued findings, one by one

The findings FEATURES_PLAN.md §1 "F6" queued for this audit (from C's review, F6a's review, F1's merge review,
the cycle follow-ups' review), the records it keeps for the owner, and the lead's own drives.

**To fix**

| # | Finding (queued by) | Outcome | Where |
|---|---|---|---|
| Q1 | The Arabic hydration warning, at its cause — the language provider's initialiser since 2c3d27f (30 May); "1 Issue" on the Arabic drawer pages (F6a's review) | **fixed at both its causes** (§4.1). After: no hydration error on any of the 77 Arabic records | §3.0, §3.13, §4.1 |
| Q2 | Three hand-cast API responses in `desk.client.tsx` (C's review) | **fixed**: the school fee's answer takes its own type (the header's three fee buttons that used it are gone, §3.12); the three statuses read through `labelFor(map, value)` | §3.12 |
| Q3 | The import review offers "First entry" on a one-paper line, which the plan always makes a retake (F6a's review) | **fixed** (§4.2) | §4.2 |
| Q4 | F4's Arabic refusal reads "للمرشح the candidate" when the candidate has no name (F6a's review) | **fixed** in the rule (`i18n-sessions.ts`): "… للمرشح أُرسل إلى المجلس …" without a name, and the name when there is one — read through the translator's own functions (`drive/sentences-check.ts`) | trail 20:28:51Z |
| Q5 | F1's Arabic clash reason: English names isolated only up to the em dash; an English comma in the date (the follow-ups' review) | **fixed** (`i18n-scheduling.ts`): a Latin run carries across " — " before Latin ("Biology 11 — Teacher B", "Term 1 — first" whole), and the day reads "الأربعاء، 21 أكتوبر 2026" | trail 20:28:51Z |
| Q6 | The Sent log names a class by its teacher on the day it is read, not at send time — if cheap (the follow-ups' review) | **fixed** (it was cheap): the words the MESSAGE_SENT audit row keeps; an 08s scenario and its control | §3.17 |
| Q7 | Rebuilding the subject's form after a Replace a teacher discards what was typed (the follow-ups' review) | **fixed**: what was typed is carried into the rebuilt form; only its teachers are read again; the dialog says so | §3.4 |
| Q8 | Two document nits: CYCLE_FOLLOWUPS §9's year-picker bullet, SCHEDULING §8's "its teacher today" (the follow-ups' review) | **fixed** in both documents; with them the follow-ups' comment naming a function that does not exist (`message-audience.services.ts`) | trail 20:39:33Z |
| Q9 | The desk's parent-consent tick shown for every waiting line (step 4 of the rework's desk) | **fixed**: shown and sent only for a line carrying the school's consent alone; an 08o scenario and its control | §3.12 |
| Q10 | Cover and publishing notify families with `/my-timetable` while the switch hides it — say so in RESERVATION_FOCUS.md §4 (F1's merge review) | **said**: a row in RESERVATION_FOCUS.md §4 — the Notifications screen draws a notification's title and sentence, never its `data.link`, so none leads outside the cycle | RESERVATION_FOCUS.md §4 |
| — | The day-one import passes F1's published-timetable guard; a scenario and the import's sentence are owed (F1's merge review) | not F6's: owed to F7/F1 by the plan; no screen of the cycle shows it | — |

**To keep for the owner (recorded, not changed)**

| # | Record | Where it stands |
|---|---|---|
| R1 | Messages' "A section" is فصل (C's dictionary over D's قسم), and the desk's teaching group is فصل too | §9, question 12 |
| R2 | The Student 360's "Subjects this year" (course enrolment) | audited where it is drawn (§3.13), unchanged; §9, question 9 |
| R3 | Candidates, Board Services, Subjects, History, My Exams (RESERVATION_FOCUS §8) | as F6b left them: Board Services (§3.8), Subjects (§3.6) and History (§3.28) audited where reachable; Candidates and My Exams hidden; §9, questions 5–11 |

**The lead's drives**

| # | Finding | Outcome | Where |
|---|---|---|---|
| L1 | The family's home: the old banner and the quick-link cards around F6b's card | **one page in the cycle's order** with the switch on; the old home exactly with it off | §3.26 |
| L2 | The admin's landing: "Closed to new reservations" twice on a closed card | **once**, as a heading above the closed sessions still in progress | §3.1 |
| L3 | The Session dates dialog's "other dates" (the board's eleven dates and the notes) above Save | **behind a disclosure** that says how many are set and opens by itself when one is; on Board Series too | §3.7 |

### 4.1 The hydration warning's two causes

1. **The provider's first render.** `I18nProvider`'s state initialiser read localStorage, which the server does
   not have: the server rendered English, the browser's first render Arabic, and React threw away the tree
   (reproduced first on `/sign-in`: the language button's "Switch language" / "تغيير اللغة"). The language now
   lives in a cookie (`language`, a year, `SameSite=Lax`) that the root layout reads (`app/layout.tsx`,
   `lib/language.ts`): the server renders `<html lang dir>` and the first state in the reader's language, so
   an Arabic page also arrives right to left with no flash. A choice made before (localStorage only) is
   carried into the cookie once, after hydration.
2. **The page translator.** On `/students` the warning remained: `localizeDom` rewrote the list's server HTML
   inside a Suspense boundary before React hydrated it. It now touches only what React owns (the element's
   fiber attached) and looks again every 100 ms, up to 10 s, while part of a page waits to hydrate — hydrating
   mutates nothing, so the mutation observer alone would not see it. Control (trail 05:40:04Z): with the check
   disabled, four loads of `/students` in Arabic gave four hydration errors; restored, none.

### 4.2 The import review's entry choice on a one-paper line

The forms' "One paper ONLY" is always a retake (F6a, the lead's decision of 11 Oct 2026): the plan makes a
one-paper line a retake whatever staff choose (`import/view.ts`), so "First entry" on it lit up and changed
nothing. Now, when every line a row makes is a one-paper item, the editor offers no entry choice and says
"Retake — one paper only is always a retake; name the sitting it follows below." (Arabic in the dictionary); a
split row with other items keeps the choice, which the plan honours for those. Driven on an import staged in
the dev database (`drive/setup-9-import.mjs`: Biology "(One paper ONLY) From June 2026", staff choosing "Paper 4
only (retake)"; staged, never committed), the row editor at a desk (`drive/import-row.mjs`): before — "First
entry · Retake · As the sheet says"; after — the sentence, in English and Arabic; no axe violation, no console
error (`.audit/ui-audit-evidence/s19b-import-one-paper-line/`).

## 5. Accessibility results

axe-core 4 (WCAG 2.0, 2.1, 2.2 A and AA rules) on every record of both drives — the whole page as the role
reaches it (`drive-before.json`, `drive-after.json`); the console's errors on the same loads.

| | Before | After |
|---|---|---|
| Records (screens × EN, AR) | 150 (75 screens) | 154 (77: f06b and s36 added) |
| Records with an axe violation | 128 | **0** |
| Records with a console error | 71 | **0** |
| — of which React's hydration error (Arabic) | 67 of 75 Arabic records | **0** |

The eight Arabic records without it in the before file were taken after the shell's fix (s35, s43b–d, and
s50–s52 taken again once the entries were derived) or render nothing language-dependent on the server (a08).

| Rule (WCAG) | Records | Nodes | Screens | Fixed by |
|---|---|---|---|---|
| `button-name` (4.1.2) | 120 | 120 | 60 — every screen with the sidebar or the phone's menu | the collapse and menu buttons named (§3.0) |
| `color-contrast` (1.4.3) | 76 | 470 | 38 — every staff screen, and Approvals | the sidebar through its tokens (§3.0); amber-700 and emerald-700 from the tone palette (§3.12, §3.18, §3.19, §3.28) |
| `select-name` (4.1.2) | 10 | 16 | 5 — Subjects, School Fees, History, withdraw, transfer | each select tied to its label (§3.6, §3.9, §3.28, §3.31) |
| `label` (1.3.1) | 4 | 14 | 2 — School Fees, Daily Takings | labels tied to their inputs (§3.9, §3.20) |
| `dlitem` (1.3.1) | 4 | 24 | 2 — both profiles | a `dl` (§3.24) |
| `label-content-name-mismatch` (2.5.3) | 8 | 8 | 7 — sign-in, sign-up, forgot, verify | the language button named by its word (§3.0) |
| `scrollable-region-focusable` (2.1.1) | 4 | 4 | 2 — both statements at a phone | the statement stacked at a phone, no sideways scroll (§3.29) |

Console errors before, besides hydration: "[session] getSession failed: Unauthorized" on the three sign-up
pages (fixed at its cause, §3.32) and React's duplicate-key warning on Settings (§3.10).

Beyond axe: the refusals on the five auth forms are `role="alert"` (WCAG 4.1.3, §3.32); the current page is
marked in the sidebar (`aria-current`); the filter of My Registrations is a labelled group with
`aria-pressed`; a reader whose system asks for less motion gets no entrance animation and no pulse — there
was no such rule (§3.0); checked with Chrome's reduced-motion emulation (`drive/motion-check.mjs`: `fade-up`
without the preference, `none` with it).

## 6. Measurements

RESERVATIONS_REWORK.md §11's step-4 method: what the person must type, click or read before the right action.

| Task | Before | After |
|---|---|---|
| The desk: collect for a family on three instalments, the first due in three days (§3.12) | "Collect EGP 24,850", all three ticked: two unticks to take what is due | "Collect EGP 8,283": none |
| The desk: a walk-in family whose school fee gates reserving — reserve and collect (§3.12) | the fee unticked: "Reserve and collect" refused, one refusal read and one tick | the fee ticked: none |
| The student record's "Payments and receipts at the desk" (§3.12) | an empty desk: the name typed again (one input) and the result opened (one click) | the desk opens on the student: none |
| The desk: collect for a family that reserved in the app (§3.12) | a parent-consent tick that did not apply, on every waiting line | not shown: one question fewer |
| The family's home, parent B owing June 2027 (§3.26) | the filled button "Preregister" (a session opening later); "Pay now" the third action, two rows down | "Pay now" the first and only filled button |
| The family's home, parent C with a child's request (§3.26) | "Approve" the third action, below two "Preregister" rows | "Approve" first, filled |
| The family's home at a phone (§3.26) | f01 1950 px, f03 2309 px | 1154 px, 1262 px |
| The dates form (§3.7) | the two deadlines, then eleven dates and the notes, above Save | the two deadlines, then one closed line saying how many dates are set |
| The import review on a one-paper line (§4.2) | three entry buttons, one of which changed nothing | no choice to make; one sentence |

## 7. Decisions and why

1. **The language in a cookie, not a silenced warning.** `suppressHydrationWarning` would have hidden 67
   mismatches and left the server rendering English to an Arabic reader; reading the cookie in the root layout
   removes the mismatch and the left-to-right flash together (§4.1).
2. **The translator waits for React** rather than racing it: touching server HTML React has not hydrated was
   the second cause (§4.1).
3. **Contrast through the project's own values.** The sidebar's lit item takes the sidebar's own deep teal
   (`--sidebar-primary-foreground` given `--sidebar`'s value); text on tones moves from the -600 to the -700 of
   the tone palette already in `components/ui/tone.tsx`. No new colour.
4. **A new pattern, named: a table at a phone stacks.** No pattern existed for a table at a phone (they
   scrolled sideways, the price and the teacher off the screen). Below 640 px each row's cells stack under
   their names (`max-sm:` grid classes and a label shown only at a phone), the same component, CSS only; from
   640 px the table. Used on Reserve (`components/reservations/reserve.tsx`) and the statement
   (`components/reservations/statement.tsx`), which the desk's Student 360 shares.
5. **`labelFor(map, value)`** (`lib/format.ts`) reads a status code to its label without casting the response
   (CLAUDE.md: never hand-type an API response).
6. **No new endpoint; three existing reads changed, each proven.** The desk summary's `familyConsentNeeded`
   per line (08o), the Sent log's send-time words (08s), the deadlines' sittings still ahead (08x2) — each a
   scenario and a control (§10). No route was added, so no authz-policy row or 05 case was owed. One label set
   in `@repo/validations` (`POLICY_SCOPE_LABELS`: words only).
7. **The family's home is one page with the switch on, and the old home with it off** — F6b's contract that
   the switch gives the full system back unchanged.
8. **"Wallet" (المحفظة) on the family's screens only**: the landings already said "the wallet"; staff keep
   "Escrow", their ledger's word.
9. **One panel for every auth page**: the three page-specific copies (each with its own slogans and figures)
   removed; one truthful panel is less code and one thing to keep true.
10. **The session helper reads a 401 as a visitor** (`lib/auth/session.ts`): the fix where the misreading
    was, not a filter on the log; any other failure still logs.
11. **The import review hides the choice only when every line is one paper**: a mixed split keeps it, since the
    plan honours it for the other lines.
12. **F6's Arabic is merged last** (`Object.assign(autoArabicText, uiAuditArabic)`), so a rewritten sentence
    wins over an old one; a generic word whose override would have changed other screens ("Open now",
    "Closed", "Submitted", "Reservations", "Requested", …) was left to the dictionary that had it.

## 8. Deferred, and why

| Item | Why not now |
|---|---|
| My Registrations types its rows by hand (§3.28) | its rows come from three endpoints in a 900-line screen from before the rework; typing them from the fetchers is a rewrite, not a presentation pass |
| A registration card names the subject, not the paper (§3.28) | the registrations read does not carry the item's label: an API change no other screen needed |
| A sort on the Money tab's table (§3.4) | its order (student, then subject) and its filters and Export answer what finance asks |
| The Charges cards' columns do not line up across families (§3.14) | a shared grid changes the component every money list uses |
| The message composer's `{guardian}`, `{student}` (§3.17) | the template's own tokens, filled before sending; words would need a second set |
| Board Services' "Pick a series…" with nothing chosen (§3.8) | waits on the owner's Q3 (keep the page?) |
| Entry Lists' rule source "From DISCOVERY_RESEARCH.md §2 …" (§3.23) | stored data (migration 0057), editable by the admin's "Change the rules"; a data change is not F6's |
| The landing's unpaid count includes the lines awaiting the parent (§3.1) | the Money tab splits them one click on; the count is the Sessions list's own |
| A refusal on an auth form is drawn in English and translated a moment later (§3.32) | the DOM translator's way; in Arabic a screen reader may hear the English sentence before the Arabic. The fix is the auth errors through `t()` keys — every auth form's error path |
| `lib/hono-server.ts` warns "Cookie … not found" on every server render for a visitor | a server log, not a screen — the same misreading as the session helper's; left to whoever next touches the server client |
| Hidden screens | not audited (the brief): they come back with the switch |

## 9. Questions for the owner

Each with the default kept until the owner answers.

From SESSION_WORDS.md §12 (F6a):
1. "Retake (Self Study ONLY)": does the school ever take a first entry in self study on a subject it does not
   teach this cycle? Default: allowed, shown as "First entry, self-study (not taught this cycle)".
2. A unit's sitting in a winter session: hide November for IAL units? Default: every month the board sits.
3. A second qualification under one subject (Arabic A Level): who chooses — the family or the teacher (Q-16)?
   Default: the family, through the teacher.
4. The old drawer's tools (adding or removing an item, a labelled sitting, the exclusive group, fee keys,
   "required in a first entry"): does the coordinator need any on a screen? Default: API-only.

From RESERVATION_FOCUS.md §8 (F6b):
5. Candidates in the cycle's sidebar? (Reachable now from the entries' fix links.)
6. My Exams for families: show the statement of entry once entries are sent?
7. Board Services: keep it in the cycle? (§3.8)
8. Subjects `/admin/subjects`: its fee columns predate the session's fees and differ from the sheet's — keep,
   relabel or hide? (§3.6)
9. "Subjects this year" (course enrolment) on the Student 360: hide the block too? (§3.13)
10. Exam Deadlines: show only the entry dates? Its exam-start rows say "No timetable imported yet". (§3.21)
11. History for families: keep it? (§3.28)

From CYCLE_FOLLOWUPS.md §10:
12. The Arabic words for a section (11A) and a subject's class (Biology with Teacher A): Messages says فصل for
    a section, the desk فصل for a class, F1's screens مجموعة تدريس. Default: as they are.

F6's own:
13. **Payments** (`/admin/payments`) lists only the old bank transfers, a method no new payment uses; InstaPay
    transfers are confirmed on the Finance Workbench, and the page now says so (§3.15). Keep it on the admin's
    sidebar? Default: kept (F6b's list is not F6's to change).
14. **"Wallet"** (المحفظة) for the money the school holds for a child, on the family's screens (§3.31): the
    school's word? Default: Wallet.
15. **The sign-in page's words** (§3.32): "The school's subject reservations, in one place — One account for
    the family, in place of a form for every subject", under the app's name "IGCSE Reserve". Should it carry
    the school's own name and logo? Default: the app's name, as before.
16. **Entry Lists' rule source** reads "From DISCOVERY_RESEARCH.md §2 (Cambridge Handbook 2026)" (§3.23):
    change the stored text to the handbook's name alone? Default: as stored.

## 10. Proof

All on **0b71cb4** (`feature/ui-audit`), the last commit carrying code; what follows it is this document, the
trail and the evidence.

| Gate | Result | Evidence |
|---|---|---|
| `pnpm --filter @repo/api check-types` (source and tests) | green, in the ui-audit worktree | trail 21:39:43Z; CI |
| `pnpm --filter web check-types` | green, in the ui-audit worktree | trail 21:39:43Z; CI |
| `pnpm --filter @repo/api test`, local time (Africa/Cairo) | 43 files, **839 passed**, 1 todo (main d6c6715: 836; F6 added three scenarios) | `gates/suite-local-0b71cb4.txt` |
| the same with `TZ=UTC` | 43 files, **839 passed**, 1 todo | `gates/suite-utc-0b71cb4.txt` |
| CI (`.github/workflows/ci.yml`) | **green, run 38810433498** (gate 0, both type-checks, the suite) | `gh run list --branch feature/ui-audit` |
| `useQuery<…>` generics in `apps/web` | **15** (19 on main; the limit 35) | `grep -rn "useQuery<" apps/web` |
| The after drive, every screen of §1, EN and AR | 154 records: **0 axe violations, 0 console errors** (hydration included) | `drive-after.json`; trail 21:38:47Z |
| Before and after screenshots | 76 screens with all four (`before-en`, `before-ar`, `after-en`, `after-ar`), each under 300 KB; two after-only: f06b (Reserve with rows ticked, added to show the stacked rows) and s36 (the desk opened from the student record — before, the link opened the empty desk of s30) | `.audit/ui-audit-evidence/<screen>/` |

**Controls** — each guard undone once, its proof red, restored green:

| Change | Proof | Red when undone |
|---|---|---|
| The desk's `familyConsentNeeded` (§3.12) | 08o: a school's grade-10 line true, a family's own reservation false | the flag forced false: "expected [[pending_payment, false]] to deeply equal [[pending_payment, true]]" (trail 05:30:48Z) |
| The translator waits for React (§4.1) | `/students` in Arabic, four loads | the check disabled: four hydration errors (trail 05:40:04Z) |
| The Sent log's send-time words (§3.17) | 08s: a class sent to today, another teacher from tomorrow | the log reading today's words: red (trail 20:04:13Z) |
| Exam Deadlines lists only sittings ahead (§3.21) | 08x2: a past sitting not listed, one ahead listed | the filter dropped: "expected [true, true] to deeply equal [false, true]" (trail 20:26:19Z) |
| The import review on a one-paper line (§4.2) | the row editor on a staged import | the old file in place: "First entry · Retake · As the sheet says" (`s19b-…/before-*.jpg`) |
| The session helper's 401 (§3.32) | the sign-up pages' console | before: "[session] getSession failed: Unauthorized" on a03–a05 (`drive-before.json`); after: none |
| Reduced motion (§3.0) | `drive/motion-check.mjs` | without the preference `fade-up`, with it `none` (the stylesheet served first stale: the dev server restarted) |

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
- 05:21Z — group 1 committed (fd56215) and pushed.
- 05:22–05:45Z — group 2 (the desk, the Student 360, Students): the desk's casts, its instalment ticks,
  its consent tick (an API field and an 08o scenario, control red then green at 05:30Z), the school fee
  in one place, the desk opened on a student from the record; a second hydration cause found on
  Students (the translator inside an unhydrated Suspense boundary) and fixed (control at 05:40Z).
  Driven after: no axe violation, no console error in either language on s30–s36.
- 05:45Z — group 2 committed (79dbb80) and pushed; CI 38686414105 (group 1) and 38688334091 (group 2) green.
- (05:46Z–20:00Z: no work — the session was paused; the dev servers kept running.)
- 20:00–20:15Z — group 3 (money and follow-up): the Sent log's send-time words (an 08s scenario, control
  red then green at 20:04Z); the admin's Payments page tells of the InstaPay transfers waiting on the
  workbench; the Escrow queue offers Approve for cash already handed over; money and dates in the school's
  format on the workbench and Escrow; Exceptions' scope labels in the forms' words (`@repo/validations`
  rebuilt; the API server restarted, my PIDs 99084/99103, now pnpm pid 64513). Driven after: no axe
  violation, no console error on s40–s48 in either language. `useQuery<` generics 15.
- 20:20Z — group 3 committed (4cdf74a) and pushed.
- 20:21–20:35Z — groups 4 and 5: Exam Deadlines lists only sittings still ahead (an 08x2 case, control at
  20:26Z) and says one or many; the entries' and the rules' sentences in the forms' words; F4's and F1's
  queued Arabic sentences (20:28Z); the profile's `dl`; the receipt's "Board" and "Board fee"; the slip
  never empty nor printed by itself; the follow-ups' stale comment and the two document lines. Driven after:
  no axe violation, no console error on s50–s59 in either language.
- 20:40Z — groups 4–5 committed (e1bf2c2) and pushed.
- 20:41–21:05Z — group 6 (the families at a phone): the home as one page in the cycle's order (the old
  banner and quick links gone with the switch on; the steps reordered; "Coming up" once; the hand-cast
  sessions row typed by the API); the Reserve rows and the statement stacked at a phone; the checkout's and
  the wallet's money and dates in the school's format; "Wallet" for a family's escrow; three selects named.
  Driven after: 46 family records, none with an axe violation or a console error.
- 21:06Z — group 6 committed (d0c96c1) and pushed.
- 21:07–21:18Z — group 7 (sign-in and sign-up): the invented figures and slogans replaced by one truthful
  panel; the cards and the parent's box in the family's words; the session helper's "Unauthorized" log at
  its cause; the refusals announced; the chevrons and arrows the reading direction's; the incomplete link
  and the unauthorized page in sentences with a way on. Driven after: 16 records, none with an axe violation
  or a console error; the wrong-password and mismatched-password refusals driven in both languages
  (`drive/auth-errors.mjs`).
- 21:19Z — group 7 committed (f54260b) and pushed.
- 21:19–21:30Z — the import review's entry choice on a one-paper line (§4.2), driven on an import staged in
  dev, before and after; RESERVATION_FOCUS §4's row for the notifications' `/my-timetable`; the
  reduced-motion rule (none existed; the web server restarted for the stylesheet, my PIDs 28901/28905/28911
  stopped, now pnpm pid 83122); §4–§9 written. Type-checks green in the worktree; `useQuery<` generics 15.
- 21:30Z — committed (0b71cb4) and pushed.
- 21:31–21:38Z — the whole after drive once more on 0b71cb4: 154 records, none with an axe violation or a
  console error.
- 21:31–21:47Z — the full suite in local time (finished 21:39:43Z) and with `TZ=UTC` (21:47:26Z): 839 passed,
  1 todo, both. CI run 38810433498 green on 0b71cb4 (21:48Z). §10 written.
