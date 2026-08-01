# V3 Requirements & Implementation Plan

**Date:** 31 July 2026
**Inputs:** 11 stakeholder requirements (school staff feedback), 6 confirmed product decisions, and three research reports (IGCSE operations in Egypt, per-council remark policies, InstaPay integration feasibility).
**Status:** ✅ IMPLEMENTED — all six phases landed on `main` (1 Aug 2026), commits
`1734b4d` (P1 money rails & finance roles), `1b98e25` (P2 fees & pricing),
`3d6b4df` (P3 receipts & refunds incl. refund windows), `cd96803` (P4 exceptions),
`3f3405b` (P5 held wallet & preregistration), `a0ad2e9` (P6 results & remarks).
Migrations 0020–0025 pending `pnpm db:migrate`. Fast-follows in §8 remain open.

---

## 1. Guiding Principle: Beat Excel

School staff currently run everything on Excel and Google Forms. If any flow in this system takes more steps, more memory, or more skill than the manual equivalent, staff will not use it. This principle outranks architectural purity everywhere in this plan.

Concrete design tenets applied throughout:

1. **One screen, one obvious action.** Every finance task is: search a student (or scan/enter a receipt number) → see everything pending for them → one click to resolve. No multi-step wizards for staff.
2. **Spreadsheet-shaped staff UI.** Grids with inline status changes, bulk select, filters, and column search — not detail-page-per-row navigation.
3. **CSV/Excel import and export everywhere.** Subjects, teachers, fee schedules, exam results, receipt reconciliation — all bulk-importable. Reports already export CSV; that stays.
4. **Sensible defaults, minimal mandatory fields.** Optional teacher choice, optional notes, prefilled amounts.
5. **The system never dead-ends staff.** When the rules block something legitimate, the exceptions framework (§6.3) is the sanctioned way around — with audit logging as the safety net instead of upfront friction.

---

## 2. Research Findings That Shape the Design

### 2.1 IGCSE operations in Egypt

- **Only two IGCSE series per year exist in Egypt: May/June and October/November.** Edexcel discontinued its January IGCSE series (last sitting January 2023, replaced by November); Cambridge's third series (March) is India/Romania-only; OxfordAQA's January series is International A-Level only. Since the school handles A-Levels too (D-G), the `january` session type survives — but as an **A-Level-only** series, enforced by validation (§5.6).
- **Entry deadlines come in bands**: standard → late (heavy surcharge — e.g. Cambridge via British Council June 2026: ~EGP 7,062 standard vs EGP 11,850 late, ~68% more) → hard cutoff. Cambridge blocks late entry entirely for subjects with coursework/speaking components.
- **The November-series entry deadline (mid-Aug–mid-Sep) falls during the summer holiday** — registration flows must work while school is out. This also strengthens the case for preregistration (§6.8).
- **Retakes are linear at IGCSE**: a retake means re-entering the whole subject at full board fee; unlimited attempts; highest grade stands. Exception: **OxfordAQA allows retaking individual papers.** Cambridge runs a *later* November entry deadline specifically for June retakers (June results ~Aug 19 → retake entries to ~Sep 21).
- **Mo'adala (Egyptian university equivalency) constraints** worth surfacing as advisory warnings (not blockers): minimum 8 subjects on the Extended tier, minimum grade C, maximum **5 exam sittings within 3 years**, Egyptian national subjects required. A Grade 12 student deferring a subject to November receives results in mid-January — *after* that year's tansik window — effectively costing a full admission cycle. Highest-value warning the system can show.
- Egyptian schools bill in exactly the three layers the stakeholders described: annual tuition (school fees), per-subject board entry fee passed through at cost (registration fees), and teaching fees (course fees). Validates §6.2.
- Caveat: exact British Council prices are order-of-magnitude (source PDFs unparseable); grade-to-percentage conversion tables circulate in three conflicting versions — anything touching them must be configurable data, never constants.

### 2.2 Remark (post-results) policies per council

- **All three councils operate per paper/component, not per subject.** A remark request must be modeled as a header + per-paper line items.
- **Cambridge adds a hard atomicity rule**: all components you will ever want reviewed for one candidate+syllabus must be submitted in a single one-shot request, all with the same service type; no later additions. Board-specific validation required.
- **Grades can go down as well as up, and written candidate consent is mandatory** at all three boards before a review. OxfordAQA treats a missing consent as *centre malpractice* (form retained 6 months); Cambridge blocks submission without the consent attestation. Consent must be a first-class, blocking, audited artifact.
- **Refund rules differ**: Cambridge waives the fee if the syllabus grade changes; Edexcel and OxfordAQA waive it only for components *submitted together* — the UI must encourage bundling papers into one request.
- **Deadlines are per-service, not per-series**: priority reviews close ~1 week after results day; standard services ~5 weeks. (June 2026: Edexcel results Aug 20 → priority Aug 27, standard Sep 24; Cambridge single deadline Sep 20.)
- **Only the exam centre (school) submits — never the candidate.** Perfect fit: parents request/consent/pay in-app; staff submit to the board and record outcomes.
- Fees: Edexcel publishes (£14 clerical, £50 review, £60 priority per component, current window); Cambridge and OxfordAQA do not publish — **remark fees must be admin-configurable per council + service, in EGP.**

### 2.3 InstaPay feasibility

- **No official InstaPay/IPN merchant API exists.** IPN is a closed bank-only network (proprietary messaging, scheme rules distributed only to member banks, no developer portal, no webhooks, no reference-verification API).
- **The InstaPay app is individuals-only — the school cannot hold a corporate IPA.** Parents can, however, send to the school's **corporate bank account number / IBAN** via InstaPay.
- InstaPay QR codes / payment links **cannot embed an amount** — they only prefill the destination.
- **Forged transfer screenshots are an organized fraud industry in Egypt. Never auto-confirm on submission.** Transaction reference numbers have no published format — store as opaque strings, unique-constrained, meaningful only for dedup and bank-statement search.
- No Egyptian PSP ships InstaPay today; **Paymob lists it "Coming Soon"** — design behind a provider interface so it can slot in later.
- Recommended real-world follow-ups for the school (outside the codebase): ask their bank about corporate InstaPay receiving + statement-export/API (HSBC Egypt has corporate Treasury APIs; CIB/Banque Misr/NBE have portals), ask EBC about biller onboarding under the InstaPay "Education" category, and ask Paymob for their InstaPay timeline.

---

## 3. Confirmed Product Decisions

| # | Decision |
|---|---|
| D-A | School fee amount is configurable **uniform or per-grade**; paying it is a prerequisite for the school year (gates subject registration — see Open Decision D2 to confirm interpretation). |
| D-B | The outside-school/retake price is **50% of the combined (course + registration) fee**. |
| D-C | Refunds: finance-officer cash disbursement is **not blocked** on finance-admin approval; approval is required for the record to reach full completion (async maker-checker). |
| D-D | **Receipt return is required to fully complete a drop.** An unreturned receipt means the student is still "registered" physically; it blocks swapping that subject for another. |
| D-E | Preregistration (held wallet) **locks the price at preregistration time** — consistent with the existing price-snapshot invariant. |
| D-F | Teacher choice at registration is **optional**. |
| D-G | The school handles **all qualification types** — IGCSE **and** AS/A-Level. Sessions and subjects gain a qualification level; the January series exists for A-Level only (§5.6). |
| D-H | **Unpaid school fee blocks subject registration** for that academic year (waivable via `fee_waiver` exception). |
| D-I | Migration: receipts for existing confirmed registrations are **bulk-generated as `issued`**; finance fixes stragglers inline. |
| D-J | **Receipts are created when payment is made** — including preregistration payments. A cancelled preregistration is handled as a **normal refund** (receipt returned, cash in school, subject to refund windows). |
| D-K | Late-entry deadline bands (standard/late/surcharge) are **deferred** to a fast-follow. |
| D-L | **Refund windows (new requirement):** refunds and drop credits follow admin-defined time windows with percentages — e.g. a mid-year drop may return 0%. See §6.12. |

## 4. Open Decisions

All resolved — see D-G through D-L above. (Historical note: D1→D-G, D2→D-H, D3→D-I, D4→D-J, D5→D-K.)

---

## 5. Cross-Cutting Changes

### 5.1 Roles & permissions

New roles: `finance_officer`, `finance_admin` (added to `ROLES` in `packages/validations/src/roles.ts`, better-auth access control in `apps/api/src/lib/permissions.ts` with a new `finance` resource, and middleware shortcuts `requireFinance()` / `requireFinanceAdmin()` in `access-control.middleware.ts`). Provisioned like admins (outside normal sign-up). `admin` retains a superset of all finance capabilities.

| Capability | finance_officer | finance_admin | admin |
|---|---|---|---|
| Confirm in-school / InstaPay payments (record instrument) | ✅ | ✅ | ✅ |
| Issue / mark returned / annotate receipts | ✅ | ✅ | ✅ |
| Disburse cash refunds (mark disbursed) | ✅ | ✅ | ✅ |
| Approve/complete refunds (maker-checker close) | — | ✅ | ✅ |
| Grant/revoke exceptions (discounts, extensions, waivers) | — | ✅ | ✅ |
| Mark receipt `lost` / `void` | — | ✅ | ✅ |
| Manage fee schedules (school fees, remark fees) | — | ✅ | ✅ |
| Enter/import exam results, manage remark submissions | ✅ | ✅ | ✅ |
| Subjects, sessions, users, links, audit, announcements | — | — | ✅ |

**Web:** new `(app)/finance` route group — a single **Finance Workbench** screen: student search / receipt-number entry → all pending items for that student (payments to verify, receipts to issue/take back, refunds to disburse) → one-click actions with an undo-window toast. Plus a queue view (grid of all pending finance items, bulk-actionable). Finance roles land here after login instead of the student dashboard.

### 5.2 One payments pipeline

`payment` gains a `purpose` column: `'registration' | 'school_fee' | 'preregistration' | 'remark'`. Every kind of money-in flows through the same table, the same finance verification queue, and the same receipt/notification machinery. This is the simplicity principle applied to the backend: finance staff learn one queue, not four.

`paymentMethod` narrows for new payments to `'in_school' | 'instapay'` (enum keeps the legacy values — existing rows are history). New columns: `instrumentUsed` (`'cash' | 'card' | 'instapay' | 'other'`, set by finance for in-school payments), `verificationReference` (unique, InstaPay transaction reference), `verificationFileId` (optional screenshot upload — existing `file` infra).

Fawry/Paymob/wallet integrations and webhooks are commented out (files kept, exports feature-flagged off via env), and `InitiatePayment` validation rejects the old methods. The provider layer keeps its interface so Paymob-InstaPay can slot in later.

### 5.3 Pricing engine

One pure function, one place (`apps/api/src/services/pricing.ts`), replacing scattered price resolution:

```
effectivePrice(subject, { isRetake, takeOutsideSchool, exceptions }) =
  base = subject.courseFee + subject.registrationFee
  if (!subject.isOfferedAtSchool || takeOutsideSchool) base = base × 0.5   // D-B
  apply per-student exceptions (custom_price overrides, then discounts)    // §6.3
```

Outside-school is only permitted when `!subject.isOfferedAtSchool` OR the registration is a retake (§6.9). `subject.customPrice` is deprecated (column retained for history, no longer read).

### 5.4 Results dimension (minimal)

Remarks and retakes both need to know what a student sat and (for remarks) what they got. Additions to `registration`: `gradeReceived` (nullable text — board grade as-is, e.g. `A*`, `7`), `resultRecordedAt/By`. Staff enter results via CSV import (grid paste also acceptable) once per results day. No grade-conversion or analytics in scope — see mo'adala advisory warnings as a future enhancement.

### 5.5 Qualification levels (D-G)

The school runs IGCSE **and** AS/A-Level. Additions:

- `subject.qualificationLevel`: `'igcse' | 'as_level' | 'a_level'` (backfill existing rows `'igcse'`). IGCSE Biology and AS Biology are separate subject rows with their own codes and fees — matching how boards sell them.
- `registration_session.qualificationLevel`: same enum (backfill `'igcse'`). A session only accepts registrations for subjects of its level. **Validation: `january` sessions must be AS/A-Level** (no January IGCSE exists in Egypt — §2.1).
- The one-active-session unique index widens from `(sessionType)` to `(sessionType, qualificationLevel)` — an IGCSE June window and an A-Level June window can be open simultaneously (already true in spirit; the URD allowed overlapping windows for different sessions).
- **Grade progression must fire once per calendar series, not once per session row.** Today `progressGrades(sessionType)` runs when a session closes; with two November sessions (IGCSE + A-Level) closing in the same series, running it twice would double-advance students. Fix: progression is guarded per `(sessionType, academicYear)` — the first closing session of a series triggers it, the guard (a series-level progression record, replacing the per-session `gradeProgressionCompletedAt` as the source of truth) makes the second a no-op. Retry-on-tick durability is preserved.
- Core-subject rules (Grade 10 / June) apply to **IGCSE-level** sessions only. Remarks (§6.10) work identically for both levels (same boards, same services).

### 5.6 Audit & notifications

Every new mutation gets an `AUDIT_ACTIONS` entry (receipt transitions, exception grant/revoke, refund disburse/approve, prereg capture, remark lifecycle, results entry). New notifications: payment-verified, refund-ready-for-pickup/disbursed, receipt-return-needed, prereg-captured (session opened), remark outcome recorded. All follow the existing fire-and-forget `.catch()` pattern.

---

## 6. Design by Requirement

### 6.1 Finance roles (R1)
Covered by §5.1. Existing admin screens for pending payments and withdrawals migrate into the Finance Workbench; the admin versions remain accessible to `admin`.

### 6.2 Fee split + school fees (R2)

**Schema — `subject`:** `priceInSchool` → `courseFee` + `registrationFee` (both non-negative, snapshot columns on `registration` become `courseFeeAtRegistration` + `registrationFeeAtRegistration`; existing `priceAtRegistration` retained read-only for old rows). Migration default: `courseFee = priceInSchool, registrationFee = 0`, then staff bulk-edit via CSV import/grid (simplicity: one spreadsheet-shaped screen, not 60 edit forms).

**Schema — school fees:** 
- `school_fee_schedule`: `academicYear` (text, e.g. `'2026-2027'`), `grade` (nullable → null means uniform), `amount`, `opensAt`, `dueAt` (nullable), unique on (academicYear, grade).
- School-fee payments are `payment` rows with `purpose='school_fee'` + `academicYear` metadata; a student's school-year access = a completed school-fee payment for the current academic year (or a `fee_waiver` exception).

**Gate:** subject registration (request/direct/prereg) for sessions inside an academic year requires school-fee payment for that year (D-A, pending D2 confirm). Parents see a clear "School fee for 2026–2027: pay first" banner with a one-click path.

### 6.3 Exceptions framework (R3)

**Schema — `exception`:** `type` (`'discount_percent' | 'discount_fixed' | 'custom_price' | 'fee_waiver' | 'deadline_extension' | 'late_registration' | 'custom_refund_percent'`), `studentId`, scope (`sessionId?`, `subjectId?` — null = all), `value` (numeric, semantic per type), `reason` (required), `validUntil` (nullable), `status` (`active | revoked`), `grantedBy`, `revokedBy/At`. Granted by finance_admin/admin only. Fully audit-logged.

**Enforcement hooks (exactly four):**
1. **Pricing** (§5.3): `custom_price`, `discount_*`.
2. **Window checks**: `deadline_extension` — a closed/not-yet-open session is treated as open for that student until `validUntil`. Applied wherever `session.status === 'active'` is currently required (registration, swap, checkout).
3. **School-fee gate** (§6.2): `fee_waiver`.
4. **Refund percentage** (§6.12): `custom_refund_percent` overrides the window schedule for one student.

Covers the school-world cases: sibling/staff-child/scholarship discounts (discount types with reasons), hardship custom prices, per-student deadline extensions, late registration after window close. Grants are one screen: pick student → pick type → value + reason → done.

### 6.4 Cash-only in-school refunds (R4)

`withdrawal_request` becomes the **refund request** (rename in UI only; table stays): parent requests refund of escrow (free balance) → appears in Finance Workbench → **officer hands cash at the desk and marks disbursed** (records amount, can be partial as today) → **finance_admin approves to complete** (D-C: approval is required for completion but never blocks the cash handover). Status flow: `pending → disbursed → completed` (+ `rejected`). Bank-transfer refund concepts are removed. Receipt gate: escrow that is pending a receipt return (§6.5) is not yet in the free balance, so it is structurally non-refundable until the receipt comes back — no special rule needed.

### 6.5 Physical receipt tracking (R5)

**Schema — `receipt`:** `registrationId` (unique FK), `receiptNumber` (unique, human-friendly sequential, e.g. `RCP-2026-000123`), `status`, `issuedBy/At`, `returnedTo/At`, `notes`. Statuses:

```
pending_issue → issued → return_required → returned
                     ↘ lost | void   (finance_admin only, reason required)
```

- Created `pending_issue` automatically **when the covering payment completes** (D-J) — for normal registrations that is the moment they confirm; for preregistrations it is the prereg payment, before the session opens. Officer clicks once when physically handing the paper over (`issued`).
- **Drop flow (D-D):** drop approval moves the registration to a new status `dropped_pending_receipt` and the receipt to `return_required`. **Escrow credit fires only when finance marks the receipt `returned`** — then the registration becomes `dropped`. An unreturned receipt therefore blocks the money and the "fully dropped" state, exactly matching "they can't claim they're still registered."
- **Swap flow:** swap = drop (receipt-gated as above) + new registration. The new registration's receipt is issued only after the old one is returned. The intended real-world moment is one desk visit: hand old receipt → officer marks returned (escrow credits) → pay difference in-school → new receipt issued. All three actions live on one Workbench screen.
- `lost` (finance_admin, reason) unblocks the same transitions as `returned` — the sanctioned escape hatch.
- Receipt-number search is a first-class Workbench entry point.
- Migration: per D3 (recommend bulk-generate `issued` for existing confirmed registrations).

### 6.6 Pay in school (R6)

`paymentMethod='in_school'`: parent selects at checkout → payment `pending` → registrations stay `pending_payment` → officer confirms at the desk, picking `instrumentUsed` (cash / card / InstaPay / other) → payment `completed`, registrations `confirmed`, receipts generated. Reuses the bank-transfer manual-confirmation machinery nearly verbatim. Also available for school fees, preregistrations, and remark fees via `purpose` (§5.2).

### 6.7 Teachers as data (R7)

**Schema:** `teacher` (`name`, `phone?`, `email?`, `isActive`), `subject_teacher` join (unique pair), `registration.teacherId` (nullable FK — D-F optional). Admin CRUD + CSV import; registration UI shows a teacher dropdown when the subject has linked teachers and is taken in school. No auth, no login, no portal.

### 6.8 Wallet split + preregistration (R8)

**Schema — `escrow`:** add `heldBalance` (non-negative check, same atomic-update discipline as `balance`). `escrow_transaction` gains `balanceType` (`'free' | 'held'`) and new reasons: `prereg_hold` (payment lands in held), `prereg_capture` (held → pays a now-open registration), `prereg_release` (held → free on cancellation).

**Preregistration flow:**
1. Admin creates future sessions as `draft` (already supported) — prereg targets draft sessions.
2. Parent preregisters subjects for a draft session: registration rows get status **`preregistered`**, with fees snapshotted at that moment (D-E — price never re-derived).
3. Parent pays (in-school or InstaPay, `purpose='preregistration'`): on completion the amount credits **held** balance, earmarked by the prereg registration IDs; physical receipts issued per D4.
4. When the session activates, the session-closer job **auto-captures**: held balance debits by the snapshotted amounts, prereg rows → `confirmed`, notifications fire. (The job already handles activation; this is one more idempotent step with the same retry-on-tick durability as grade progression.)
5. Cancellation before activation (D-J): prereg row cancelled → earmarked amount `prereg_release`d to free balance → handled as a **normal refund** from there (refund request, receipt returned, cash in school — §6.4), subject to refund windows (§6.12). The receipt was already issued at payment time, so the standard receipt-return gate applies unchanged.

Free balance behaves exactly as today (drops, swap credits, checkout application, transfers, refunds). Held balance is not spendable, transferable, or refundable — it exists only to fund its earmarked preregistrations.

### 6.9 Retakes + 50% pricing (R9)

`registration` gains `isRetake` and `takenOutsideSchool` booleans. Pricing per §5.3 (D-B: 50% of combined fee). Rules:
- `subject.isOfferedAtSchool = false` → automatically outside school, 50%, for everyone.
- Retake = a prior registration for the same subject in an earlier session (any of `confirmed | dropped` with a recorded sit — computed), OR staff-set flag for history predating the system. Retaking students may *choose* outside-school at request time → 50%.
- Anyone else: outside-school not offered — enforced at request validation.
- OxfordAQA per-paper retakes and board-fee pass-through nuances are out of scope for pricing (school policy is a flat 50%), but the research is retained above for future reference.

### 6.10 Remarks (R10)

**Schema:**
- `remark_request` (header): `studentId`, `registrationId` (subject + the session it was sat in), `serviceType` (per-council enum: clerical / review / priority_review / script_copy), `status`: `pending_approval → pending_consent → pending_payment → awaiting_submission → submitted → outcome_recorded → closed` (+ `rejected | cancelled`), `consentFileId` (signed form upload, **required before payment** — blocking, audited), `consentConfirmedBy/At`, `boardReference`, `feeCharged`, `feeRefunded` (boolean + amount), parent approval fields mirroring registrations (student requests → parent approves; parents can also request directly).
- `remark_request_item` (line items): `paperCode`, `paperName`, per-paper `outcome` (`mark_up | mark_down | unchanged`), `gradeAfter?`.
- `remark_fee_schedule`: per (council, serviceType) amount in EGP, admin/finance_admin-editable (Cambridge/OxfordAQA don't publish fees).
- Per-series service deadlines: `remark_deadline` (council, seriesSessionId, serviceType, deadline) — small admin grid, CSV-importable.

**Council rules enforced:** Cambridge — at most one remark request ever per (student, subject, series), single uniform service type across its items, warn about the 24-hour amendment window; Edexcel/OxfordAQA — bundling encouraged with an explicit "papers submitted separately lose the fee-refund benefit" warning; OxfordAQA — one review per paper.

**Flow:** parent (or student→parent approval) picks a *resulted* registration → picks service + papers → uploads signed consent (blocking) → pays remark fee (§5.2 pipeline) → staff see an **"awaiting board submission"** queue, submit through the board portal as today, record `boardReference` → on outcome, staff record per-paper results and the grade change if any → if the council's refund rule triggers (grade changed; for Edexcel/OxfordAQA only same-batch components), fee refunds **to escrow free balance** (cash-refundable via §6.4).

### 6.11 InstaPay + method narrowing (R11)

Covered by §2.3 and §5.2. Summary: manual-verification method (reference + optional screenshot → finance verifies against bank statement), unique reference constraint, no auto-confirm, provider-interface seam for future Paymob InstaPay. Fawry/Paymob/wallet code commented out behind env flags; old enum values retained for historical rows.

### 6.12 Refund windows (R12, D-L)

Money going *back out* is time-scaled: a drop early in the cycle refunds most of the fee; a mid-year drop may refund nothing. Finance-admin/admin define the schedule; the system computes the amount.

**Schema — `refund_window`:** scope (`sessionId?` or `academicYear?` — session-scoped wins over year-scoped), `startsAt`, `endsAt`, `percentage` (0–100), `label` (e.g. "Before entry deadline"). Managed on one grid screen, CSV-importable.

**Engine:** `refundPercentage(date, session)` in the pricing service — picks the window containing `date`; **if the scope has any windows configured, gaps between/after them are 0%; if no windows exist at all, 100%** (backwards-compatible with today's full-credit behavior until finance configures schedules). `custom_refund_percent` exceptions override per student.

**Where it applies (all money-out paths):**
- **Drop credit:** escrow credit on drop = snapshot fee × percentage at **drop-approval time** (not receipt-return time — the paperwork delay must not cost the parent percentage). The remainder is simply retained; the ledger records the credited amount with the applied percentage in the audit log.
- **Swap:** the drop leg of a swap uses the same percentage. Parents see the exact credit and the resulting difference-to-pay *before* confirming.
- **Prereg cancellation** (§6.8): released amount × percentage at cancellation time.
- **Escrow cash refunds** (§6.4) of already-credited balance are NOT re-scaled — the percentage was applied when the credit was computed; applying it twice would double-charge.

**Transparency rule (simplicity principle):** every drop/swap/cancel confirmation dialog shows "You will receive X% = EGP Y back" before the user commits — fewer desk arguments is the whole point.

---

## 7. Data Migration Summary

| Change | Migration |
|---|---|
| `subject` fee split | `courseFee = priceInSchool`, `registrationFee = 0`; staff correct via bulk grid/CSV. `customPrice` retained, deprecated. |
| `registration` fee snapshot split | Backfill `courseFeeAtRegistration = priceAtRegistration`, `registrationFeeAtRegistration = 0`; keep `priceAtRegistration`. |
| New tables | `school_fee_schedule`, `exception`, `receipt`, `teacher`, `subject_teacher`, `remark_request`, `remark_request_item`, `remark_fee_schedule`, `remark_deadline`, `refund_window`. |
| Qualification levels | `subject.qualificationLevel` + `registration_session.qualificationLevel`, both backfilled `'igcse'`; active-session unique index widened to (sessionType, qualificationLevel); series-level grade-progression guard. |
| `payment` | add `purpose` (backfill `'registration'`), `instrumentUsed`, `verificationReference` (unique), `verificationFileId`. |
| `escrow` | add `heldBalance` default 0; `escrow_transaction.balanceType` backfill `'free'`; new reason values. |
| `registration.status` | new values `preregistered`, `dropped_pending_receipt`. |
| Receipts for existing confirmed registrations | Bulk-generate `issued` (D-I). |
| Roles | additive; no data change. |
| Sessions | `january` retained, constrained to AS/A-Level going forward (D-G). |

All enum changes are additive at the DB layer (text columns + validation enums), so historical rows never break.

## 8. Implementation Phases

Ordered by dependency and stakeholder value; each phase ships schema + API + web + tests and leaves the system releasable.

1. **Phase 1 — Money rails & finance roles.** Roles/permissions/middleware, Finance Workbench shell, payment `purpose` column, in-school + InstaPay methods, comment out old integrations, migrate pending-payment/withdrawal admin screens into the Workbench. *(Everything later routes through this.)*
2. **Phase 2 — Fees & pricing.** Subject fee split + bulk-edit grid, school-fee schedule + gate + checkout, pricing engine with the 50%/retake/outside rules, teachers (data + optional choice), qualification levels (§5.5) incl. the series-level progression guard.
3. **Phase 3 — Receipts & refunds.** Receipt table + lifecycle + Workbench integration, receipt-gated drop/swap completion, refund flow rework (disburse → approve), **refund windows** (§6.12), receipt migration (D-I).
4. **Phase 4 — Exceptions.** The framework + its three enforcement hooks (needs pricing and gates from Phases 2–3 in place).
5. **Phase 5 — Held wallet & preregistration.** Escrow split, prereg flow, session-closer auto-capture.
6. **Phase 6 — Results & remarks.** Results entry (CSV), remark schema + flows + council rules + fee schedule + deadlines.

Fast-follows (explicitly deferred): late-entry deadline bands (D-K), mo'adala advisory warnings (5-sitting counter, Grade-12-November warning, 8-subject/Extended-tier tracker), bank-statement reconciliation feed, Paymob-InstaPay when it ships, mobile app parity.

## 9. Out of Scope for V3

- Any automated InstaPay integration (does not exist — §2.3).
- Grade-to-percentage conversion / tansik score calculation (conflicting unofficial tables).
- Board-side entry submission (staff continue using board portals; we track our side).
- Teacher logins/portals.
- Per-paper retake pricing for OxfordAQA (school policy is flat 50%).
