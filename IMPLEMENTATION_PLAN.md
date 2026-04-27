# IGCSE Subject Reservation System — Implementation Plan

**Version:** 3.1
**Created:** April 8, 2026
**Last Updated:** April 8, 2026 — line numbers verified against source code
**Basis:** Comprehensive 77-story audit (12 category team leads, per-story review)
**Supersedes:** `FIX_AND_COMPLETION_PLAN.md` v1.1 (which was based on a 64-finding audit)

---

## How to Read This Document

- **Phases are sequential.** Each phase depends on the phases before it. Do not start Phase N+1 until Phase N is complete.
- **Tasks within a phase may be parallelized** unless a dependency is noted.
- **Every task has acceptance criteria.** A task is not done until all criteria are met.
- **No code in this document.** This plan describes *what* to change and *why*. Implementation details belong in the code.
- **File paths and line numbers** have been verified against source code (as of April 8, 2026). Still verify before editing as changes may have been made since.
- **Audit references** use the format `[CATEGORY-STORY]` (e.g., `[AUTH-001]`) linking back to the audit findings.

---

## Table of Contents

0. [Phase 0: Build Health Prerequisite](#phase-0-build-health-prerequisite)
1. [Phase 1: Database Schema & Foundation](#phase-1-database-schema--foundation)
2. [Phase 2: Validation Layer Hardening](#phase-2-validation-layer-hardening)
3. [Phase 3: Security Hardening](#phase-3-security-hardening)
4. [Phase 4: Financial Integrity](#phase-4-financial-integrity)
5. [Phase 5: Data Correctness & Query Fixes](#phase-5-data-correctness--query-fixes)
6. [Phase 6: Registration & Session Lifecycle Completion](#phase-6-registration--session-lifecycle-completion)
7. [Phase 7: Notification System Overhaul](#phase-7-notification-system-overhaul)
8. [Phase 8: Audit Trail Completion](#phase-8-audit-trail-completion)
9. [Phase 9: Grade Progression & Graduation Enforcement](#phase-9-grade-progression--graduation-enforcement)
10. [Phase 10: Report System Fixes & Completion](#phase-10-report-system-fixes--completion)
11. [Phase 11: Frontend & UX Polish](#phase-11-frontend--ux-polish)
12. [Phase 12: Missing Feature Implementation](#phase-12-missing-feature-implementation)

---

## Phase Overview

```
Phase 0  ──► Build Health             (Fix tsc errors — BLOCKS ALL)
Phase 1  ──► Schema & Foundation      (Migrations, env, constraints)
Phase 2  ──► Validation Layer         (Input sanitization, schema fixes)
Phase 3  ──► Security Hardening       (Auth, webhooks, XSS, rate limiting)
Phase 4  ──► Financial Integrity      (Transactions, atomicity, escrow)
Phase 5  ──► Data Correctness         (Wrong values, column names, dead code)
Phase 6  ──► Registration & Session   (Lifecycle gaps, race conditions)
Phase 7  ──► Notification Overhaul    (Wiring, missing triggers, email fixes)
Phase 8  ──► Audit Trail Completion   (16+ missing action types)
Phase 9  ──► Grade Progression        (Graduation enforcement, cleanup)
Phase 10 ──► Report System            (Broken queries, pagination, export)
Phase 11 ──► Frontend & UX            (Guards, redirects, polish)
Phase 12 ──► Missing Features         (Password reset UX, email verification, PDF receipts)
```

### Estimated Scope

| Phase | Tasks | Severity | Primary Files |
|-------|-------|----------|---------------|
| 0 | 2 | Blocker | 1 |
| 1 | 9 | Critical, High | 3-4 |
| 2 | 6 | Critical, High | 4-5 |
| 3 | 9 | Critical, High | 10-12 |
| 4 | 9 | Critical, High | 4 |
| 5 | 8 | Critical, High | 6 |
| 6 | 11 | High | 5-6 |
| 7 | 11 | Critical, High | 4-5 |
| 8 | 6 | High | 7-8 |
| 9 | 7 | Critical, High | 4-5 |
| 10 | 7 | High, Medium | 4-5 |
| 11 | 10 | High, Medium | 8-10 |
| 12 | 5 | P0/P1 URD gaps | 5-8 |

---

## Phase 0: Build Health Prerequisite

**BLOCKS ALL OTHER PHASES. The API must compile cleanly before any work begins.**

### Task 0.1: Fix TypeScript Compilation Error in `report.routes.ts`

**File:** `apps/api/src/routes/report.routes.ts` (~line 66)
**Problem:** `Parameters<ReturnType<typeof new Hono().get>>` is invalid TypeScript.
**Fix:** Replace with a correct Hono context type (e.g., `Context` from `hono` or the project's `HonoEnv`).
**Acceptance:** `cd apps/api && npx tsc --noEmit` exits code 0.

### Task 0.2: Establish Build Gate

After Task 0.1, run `tsc --noEmit` after every subsequent task. If a task introduces a type error, fix it before proceeding.

---

## Phase 1: Database Schema & Foundation

**Goal:** Establish a correct, safe database foundation. All subsequent phases depend on these migrations.

**After all tasks, generate a single migration:** `cd packages/db && pnpm db:generate:migrations`

### Task 1.1: Add Unique Constraint on Parent-Student Link

**Audit:** `[AUTH-003]` — No DB-level unique constraint on `(parentId, studentId)`.
**File:** `packages/db/src/schema.ts` — `parentStudentLink` table (~line 304-333)
**Problem:** Application-level duplicate check in `link.services.ts:52-60` is vulnerable to race conditions. Two concurrent link requests can create duplicates.
**Fix:** Add a `uniqueIndex` on `(parentId, studentId)` to the table definition.
**Acceptance:**
- DB rejects duplicate link requests at the constraint level
- Existing application-level check remains as a friendlier error message layer

### Task 1.2: Fix Cascade Delete Chain for Financial Records

**Audit:** Cross-cutting financial safety
**File:** `packages/db/src/schema.ts`
**Problem:** Some FKs use `cascade` that would silently destroy financial records on user deletion.
**Fix:** Change these FKs to `onDelete: "restrict"`:

| Table.Column | Current | Change To |
|-------------|---------|-----------|
| `registration.studentId` | cascade | restrict |
| `escrow.studentId` | cascade | restrict |
| `escrowTransaction.escrowId` | cascade | restrict |
| `withdrawalRequest.escrowId` | cascade | restrict |

**Acceptance:** Attempting to delete a user with financial records raises a FK constraint error.

### Task 1.3: Fix Timestamp Timezone Inconsistency

**Audit:** Cross-cutting date correctness
**File:** `packages/db/src/schema.ts`
**Problem:** Early tables (`user`, `session`, `account`, `verification`) use bare `timestamp()` while business tables use `timestamp("...", { withTimezone: true })`.
**Fix:** Add `{ withTimezone: true }` to all `timestamp()` calls in: `user`, `session` (auth), `account`, `verification`, `todo`, `file`, `fileVariant`, `parentStudentLink`, `subject`.
**Note:** Verify better-auth supports `withTimezone` before modifying its managed tables. If not, document the inconsistency and ensure all date comparisons cast to UTC.
**Acceptance:** All application-controlled tables use `{ withTimezone: true }` consistently.

### Task 1.4: Add `closeReason` Column to Registration Session

**Audit:** `[SES-004]` — Close reason accepted by Zod but never stored.
**File:** `packages/db/src/schema.ts` — `registrationSession` table
**Fix:** Add `closeReason: text("close_reason")` (nullable).
**Acceptance:** Column exists, is nullable, and is accessible from the session service.

### Task 1.5: Add `reminderSentAt` Column to Registration Session

**Audit:** `[NOT-002]` — In-memory `remindedSessions` Set is volatile across restarts.
**File:** `packages/db/src/schema.ts` — `registrationSession` table
**Fix:** Add `reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true })` (nullable).
**Acceptance:** Column exists. Session-closer can check and set it to prevent duplicate 24h reminders.

### Task 1.6: Rename Withdrawal Resolution Columns

**Audit:** `[ESC-006]` — `fulfilledAt`/`fulfilledBy` used for both fulfillment AND rejection.
**File:** `packages/db/src/schema.ts` — `withdrawalRequest` table
**Fix:** Rename to `resolvedAt`/`resolvedBy`. Update all references in `escrow.services.ts`.
**Note:** Coordinate with Task 4.5 which also modifies the fulfillment function.
**Acceptance:** Column names accurately represent usage for both fulfillment and rejection.

### Task 1.7: Add Database CHECK Constraints

**Audit:** Cross-cutting financial safety
**Fix:** After generating the Drizzle migration, manually append CHECK constraints:

| Table | Constraint |
|-------|-----------|
| `escrow` | `CHECK (balance >= 0)` |
| `payment` | `CHECK (amount > 0)` |
| `payment` | `CHECK (escrow_amount_applied >= 0)` |
| `escrow_transaction` | `CHECK (amount > 0)` |
| `withdrawal_request` | `CHECK (requested_amount > 0)` |
| `withdrawal_request` | `CHECK (released_amount > 0)` — when not null |

**Acceptance:** Database rejects negative escrow balances and invalid financial amounts.

### Task 1.8: Add `BETTER_AUTH_SECRET` to Environment Validation

**Audit:** `[AUTH-001]` — Session security
**File:** `apps/api/src/env.ts`
**Fix:**
- Add `BETTER_AUTH_SECRET: z.string().min(32)` — refuse startup if missing/short
- Add `RESEND_API_KEY: z.string().min(1).optional()` — but fail in production if missing
**Acceptance:** Server refuses to start without `BETTER_AUTH_SECRET`. Email stub mode works in dev.

### Task 1.9: Consolidate Duplicate User Relations

**Audit:** Cross-cutting schema correctness
**File:** `packages/db/src/schema.ts`
**Problem:** If two `relations(user, ...)` blocks exist, Drizzle expects exactly one.
**Fix:** Verify only one `userRelations` export exists containing all 16 relations. (The current schema appears to have already been consolidated based on the audit reading — verify and confirm.)
**Acceptance:** Only one `relations(user, ...)` export. All `db.query.user.*` calls work.

---

## Phase 2: Validation Layer Hardening

**Goal:** Fix input validation defects that allow malformed or dangerous data to enter the system.

### Task 2.1: Fix `CommonSchemas.id` — Remove Permissive String Fallback

**File:** `packages/validations/src/common.validations.ts` (~line 51)
**Problem:** `z.string().uuid().or(z.string().min(1))` — the `.or()` fallback means any non-empty string passes, negating the UUID constraint.
**Fix:** Change to `z.string().uuid()`. Search codebase for any legitimate non-UUID IDs (e.g., better-auth session IDs) and create separate schemas for those.
**Acceptance:** `CommonSchemas.id` only accepts valid UUID strings.

### Task 2.2: Fix Name Sanitizer — Support Unicode Characters

**File:** `packages/validations/src/common.validations.ts` (~lines 21-26)
**Problem:** `sanitizers.name` regex `[^a-zA-Z\s-']` strips all non-ASCII characters. Egyptian students have Arabic names.
**Fix:** Use `\p{L}` (Unicode letter category) with the `u` flag.
**Acceptance:** `sanitizers.name("محمد النجار")` returns unchanged. `sanitizers.name("<script>")` strips symbols.

### Task 2.3: Add Upper Bounds to Financial Amount Schemas

**Files:** `packages/validations/src/escrow/escrow.validations.ts`, `packages/validations/src/payment/payment.validations.ts`
**Fix:** Add `.max(1_000_000)` to all financial amount fields that currently only use `.positive()`.
**Acceptance:** Amounts above 1M EGP return validation error. Legitimate amounts pass.

### Task 2.4: Create Shared Report Validation Schemas

**Problem:** 4 Zod schemas are defined inline in `report.routes.ts`.
**Fix:** Move to `packages/validations/src/report/report.validations.ts`. Export from package index.
**Acceptance:** Schemas importable from `@repo/validations`. No behavioral change.

### Task 2.5: Add Server-Side Password Complexity Enforcement

**Audit:** `[AUTH-001]`, `[AUTH-002]` — Password complexity only enforced on one frontend page.
**File:** `apps/api/src/lib/auth.ts` (~line 32)
**Problem:** Server enforces only `minPasswordLength: 8`. URD requires uppercase + number.
**Fix:** Configure better-auth with a password validation callback enforcing: min 8 chars, 1 uppercase, 1 number. The `CommonSchemas.password` Zod schema already defines these rules — wire it into the auth config.
**Acceptance:** `"password"` → rejected. `"Password1"` → accepted. Direct API calls cannot create weak-password accounts.

### Task 2.6: Fix `UpdateSubject` Refine Gap

**Audit:** `[SUB-003]` — Sending `{ customPrice: null }` on a non-school subject creates invalid state.
**File:** `packages/validations/src/subject/subject.validations.ts` (~lines 127-139)
**Problem:** The refine only checks when `isOfferedAtSchool` is in the request. If only `customPrice: null` is sent, the refine passes even though the DB record has `isOfferedAtSchool: false`.
**Fix:** In the `updateSubject` service function, after applying the partial update, re-validate the resulting state: if the subject is not offered at school and has no custom price, reject the update. This requires reading the current subject state before applying the partial update.
**Acceptance:** Cannot clear `customPrice` on a subject where `isOfferedAtSchool` is false.

---

## Phase 3: Security Hardening

**Goal:** Close all security vulnerabilities — unauthorized access, payment fraud, data exposure, injection.

### Task 3.1: Implement Webhook Signature Validation

**Audit:** `[PAY-001]`, `[PAY-002]` — Both Fawry and Paymob validators return `true` when credentials missing.
**Files:** `apps/api/src/integrations/fawry.ts` (~line 66), `apps/api/src/integrations/paymob.ts` (~line 57)
**Fix:**
- **Fawry:** Implement SHA-256 signature verification per Fawry API docs. Use `crypto.timingSafeEqual`.
- **Paymob:** Implement HMAC verification per Paymob docs. Use `crypto.timingSafeEqual`.
- **Fail closed:** When credentials are not configured, REJECT all webhooks (not silently accept).
- Add `FAWRY_MERCHANT_CODE`, `FAWRY_SECURE_KEY`, `PAYMOB_HMAC_SECRET` to `env.ts`.
**Acceptance:** Forged webhooks rejected with 401. Legitimate webhooks processed. Timing-safe comparison used.

### Task 3.2: Add Webhook Amount Verification

**Audit:** `[PAY-001]`, `[PAY-002]` — Neither handler verifies reported amount matches stored amount.
**Files:** `apps/api/src/routes/payment.routes.ts` (Fawry handler ~line 243, Paymob handler ~line 293)
**Fix:** After signature validation and before calling `confirmPayment`:
- Fawry: Compare `payload.paymentAmount` against `payment.amount`
- Paymob: Compare `obj.amount_cents / 100` against `payment.amount`
- If mismatch: log the discrepancy, do NOT confirm the payment, return 400.
**Acceptance:** A webhook with a different amount than stored does not confirm the payment.

### Task 3.3: Fix Rate Limiter Key and Expand Coverage

**Audit:** `[AUTH-005]` — Rate limiter trusts `X-Forwarded-For` (spoofable).
**File:** `apps/api/src/index.ts` (~lines 43-55)
**Fix:**
- Prefer `cf-connecting-ip` (Cloudflare-set) over `x-forwarded-for`. Fall back to socket address.
- Add per-user rate limiting on business endpoints:

| Endpoint Pattern | Limit | Key |
|-----------------|-------|-----|
| `POST /v1/payments/*` | 10/15min | userId |
| `POST /v1/registrations/*` | 20/15min | userId |
| `POST /v1/escrow/*` | 10/15min | userId |
| `POST /v1/change-requests/*` | 15/15min | userId |

**Acceptance:** Rate limiter key not spoofable. Business endpoints rate-limited per user.

### Task 3.4: Prevent XSS in Email Templates

**Audit:** Cross-cutting — all email templates interpolate user-controlled values into HTML.
**File:** `apps/api/src/integrations/email.ts`
**Fix:** Create `escapeHtml()` utility. Apply to every dynamic value: `recipientName`, `comments`, `reason`, `adminNotes`, `title`, `body`, subject names.
**Acceptance:** `<script>alert(1)</script>` in any user name renders as escaped text.

### Task 3.5: Fix Bulk Announcement Email Privacy

**Audit:** `[NOT-011]` — All recipients see each other's email addresses.
**File:** `apps/api/src/services/notification.services.ts` (~lines 878-886)
**Fix:** Send individual emails per recipient (batch with Resend batch API if available).
**Acceptance:** Bulk announcement to 100 users does NOT expose any recipient's email to others.

### Task 3.6: Create Centralized Admin Layout Guard

**Audit:** `[AUTH-008]` — No `admin/layout.tsx` exists. One admin page (`admin/notifications`) is unguarded.
**File:** Create `apps/web/app/admin/layout.tsx`
**Fix:**
- Layout calls `requireAdmin()` from `~/lib/auth/session`
- Remove individual `requireAdmin()` from each admin page (now redundant)
- Fix `admin/notifications/page.tsx` which has `'use client'` + `export const metadata` (invalid combo in Next.js App Router) — move metadata to the layout
**Acceptance:** All `/admin/*` routes require admin auth. Adding new admin pages inherits the guard.

### Task 3.7: Remove Role Information Leakage from 403 Responses

**File:** `apps/api/src/middleware/access-control.middleware.ts` (~lines 79-82)
**Fix:** Remove `requiredRoles` from 403 response body. Return only `{ "error": "Forbidden" }`.
**Acceptance:** 403 responses do not expose required roles.

### Task 3.8: Add CSV Formula Injection Protection

**File:** `apps/api/src/routes/report.routes.ts` (the `toCSV` / `escape` function)
**Fix:** When a cell value starts with `=`, `+`, `-`, `@`, `\t`, or `\r`, prepend with `'`.
**Acceptance:** `=CMD("calc")` exports as `'=CMD("calc")`. Normal values unaffected.

### Task 3.9: Prevent Student Enumeration via Link Endpoint

**Audit:** `[AUTH-003]` — "Student not found" error reveals account existence.
**File:** `apps/api/src/services/link.services.ts` (~line 47)
**Fix:** Return a generic message regardless of whether the student exists: "If a student with that email/ID exists, they will receive a link request."
**Acceptance:** Link request for non-existent student returns same response as existing student.

---

## Phase 4: Financial Integrity

**Goal:** Make every financial operation atomic and correct. Prevent money from appearing, disappearing, or being double-counted.

### Task 4.1: Make `creditEscrow` and `debitEscrow` Accept Transaction Handle

**Audit:** `[SWAP-003]`, `[PAY-005]`, `[ESC-006]` — Called inside transactions but without passing `tx`.
**File:** `apps/api/src/services/escrow.services.ts`
**Current:** `creditEscrow` (line 92) and `debitEscrow` (line 125) already accept optional `tx?: DbConn` parameter.
**Fix:**
- Verify callers actually pass `tx` when inside a transaction (most don't — see Task 4.2, 4.3)
- Replace read-compute-write with atomic SQL: `UPDATE escrow SET balance = balance + $amount WHERE id = $id`
- For `debitEscrow`: use `balance - $amount` with RETURNING check that new balance >= 0
**Acceptance:**
- Both functions accept optional `tx`
- Balance updates use atomic SQL, not read-compute-write
- Concurrent calls don't produce lost updates

### Task 4.2: Fix `creditEscrow` Calls in Swap Services — Pass `tx`

**Audit:** `[SWAP-003]`, `[SWAP-004]` — **Money created from nothing on rollback**.
**File:** `apps/api/src/services/swap.services.ts`
**Problem:** Three locations call `creditEscrow` inside `db.transaction(async (tx) => {...})` but never pass `tx`:
1. `approveChangeRequest` — drop approval escrow credit (~lines 452-458, tx available from line 441)
2. `executeDirectDrop` — parent direct drop escrow credit (~lines 605-610, tx available from line 599)
3. `executeDirectSwap` — parent direct swap escrow credit (~lines 676-681, tx available from line 668)

**Note:** `transferEscrow` in escrow.services.ts (lines 266-282) is the ONLY caller that correctly passes `tx`.

**Fix:** Pass `tx` as second argument to all three `creditEscrow` calls.
**Acceptance:** If the parent transaction rolls back, the escrow credit also rolls back.

### Task 4.3: Wrap Payment Operations in Transactions

**Audit:** `[PAY-005]` — `initiatePayment`, `confirmPayment`, `failPayment` lack `db.transaction()`.
**File:** `apps/api/src/services/payment.services.ts`
**Fix:**
- `initiatePayment` (~lines 217-225): `debitEscrow` is called BEFORE the payment record is created. If payment creation fails, escrow is already debited with no recovery. Wrap escrow debit + payment insert + paymentRegistration insert in `db.transaction()`. Pass `tx` to `debitEscrow`.
- `confirmPayment` (~lines 263-360): Wrap payment status update (lines 281-294) + registration status updates (lines 304-312) in `db.transaction()`.
- `failPayment` (~lines 372-400): Wrap payment status update (line 382-386) + registration status rollback + escrow refund (lines 389-397) in `db.transaction()`. Pass `tx` to `creditEscrow`.
**Acceptance:** A failure midway through any payment operation leaves the database consistent.

### Task 4.4: Make Escrow Transfer Fully Atomic

**Audit:** `[ESC-003]` — `transferEscrow` may already use `db.transaction()` — verify and ensure `tx` is passed to both `debitEscrow` and `creditEscrow`.
**File:** `apps/api/src/services/escrow.services.ts`
**Acceptance:** Transfer either fully completes (both debit and credit) or fully rolls back.

### Task 4.5: Implement Withdrawal Fund Holding

**Audit:** `[ESC-004]` — Multiple pending withdrawals can exceed actual balance.
**File:** `apps/api/src/services/escrow.services.ts`
**Fix (Option A — Debit on creation, credit back on rejection):**
- `createWithdrawalRequest`: Immediately `debitEscrow(requestedAmount)` — holds funds
- `fulfillWithdrawalRequest`: Remove the `debitEscrow` call — funds already held. Only update status/releasedAmount.
- `rejectWithdrawalRequest`: `creditEscrow(requestedAmount)` — restores held funds
- State machine: creation debits → fulfillment updates status only → rejection credits back

**Critical:** The lifecycle must be carefully implemented:
- Creation: debit full `requestedAmount`
- Each partial/full fulfillment: NO debit (already held). Only update `releasedAmount`, `status`, `resolvedAt`/`resolvedBy`
- Rejection (only from `pending`): credit back `requestedAmount`

**Acceptance:** Student cannot create withdrawal requests exceeding total balance. Rejected withdrawals restore funds. Fulfilled withdrawals don't double-debit.

### Task 4.6: Wrap Withdrawal Fulfillment in Transaction

**Audit:** `[ESC-006]` — `debitEscrow` and status update are separate operations.
**File:** `apps/api/src/services/escrow.services.ts` — `fulfillWithdrawalRequest` (lines 432-516, confirmed NOT wrapped in transaction)
**Fix:** Wrap the entire fulfillment in `db.transaction()`. After Task 4.5, this is simpler since fulfillment no longer calls `debitEscrow`, but the status update + resolvedAt/resolvedBy write must still be atomic.
**Also fix TOCTOU:** Read the withdrawal request inside the transaction with `SELECT ... FOR UPDATE` semantics to prevent two admins from simultaneously processing the same request.
**Acceptance:** Concurrent fulfillment attempts don't double-process. Status and balance are always consistent.

### Task 4.7: Verify Post-Transaction Code in `approveChangeRequest`

**Audit:** `[SWAP-003]` — Notification code was flagged as potentially unreachable.
**File:** `apps/api/src/services/swap.services.ts` — `approveChangeRequest`
**Status:** VERIFIED OK. Line 441 uses `const result = await db.transaction(async (tx) => {` and line 514 returns `result`. Post-transaction notification code (lines 482-512) IS reachable.
**Action:** No code change needed. Mark as verified during implementation. Focus on ensuring the notification calls (Tasks 7.5, 7.7) are properly wired in this post-transaction section.

### Task 4.8: Fix Fawry Webhook Non-PAID Status Handling

**Audit:** `[PAY-001]` — Expired/cancelled Fawry payments remain `pending` forever.
**File:** `apps/api/src/routes/payment.routes.ts` (~lines 252-263)
**Fix:** For non-PAID statuses (EXPIRED, CANCELLED, UNPAID): look up payment by `merchantRefNum`, call `failPayment(paymentId)`. If escrow was applied, credit it back.
**Acceptance:** Fawry EXPIRED/CANCELLED webhooks transition payment to `failed`. Escrow refunded.

### Task 4.9: Fix Admin Notes Overwriting External Reference

**Audit:** `[PAY-007]` — Admin bank transfer confirmation overwrites original reference.
**File:** `apps/api/src/routes/payment.routes.ts` (~line 219)
**Fix:** Store admin notes in `metadata` JSONB field, not as `externalReference`. Preserve original bank reference.
**Acceptance:** Original bank reference preserved. Admin notes stored separately.

---

## Phase 5: Data Correctness & Query Fixes

**Goal:** Fix wrong values, column names, and relation names that cause silent data loss or runtime crashes.

### Task 5.1: ~~Fix `'accepted'` → `'approved'` Status Value~~ — VERIFIED OK

**Status:** No bug found. All link status checks in `notification.services.ts` (line 195), `escrow.services.ts`, `registration.services.ts`, `swap.services.ts`, `link.services.ts`, and `report.services.ts` correctly use `'approved'`.
**Action:** No change needed. Verify once more during implementation with a repo-wide grep for `'accepted'` to confirm.

### Task 5.2: Fix `subjectCode` → `code` Column References

**Files:** `swap.services.ts` (4 locations), `registration.services.ts` (1 location)
**Problem:** Queries reference `subjectCode` which doesn't exist. The column is `code`.
**Fix:** Change `subjectCode: true` to `code: true` in all locations.
**Acceptance:** Pending change requests and registration history return subject codes.

### Task 5.3: Fix Report Service Column/Relation Mismatches

**File:** `apps/api/src/services/report.services.ts`
**Fix:**

| Line | Wrong | Correct |
|------|-------|---------|
| ~243 | `payments` (relation) | `paymentRegistrations` |
| ~246 | `totalAmount` (column) | `amount` |
| ~303 | `studentId` (on withdrawalRequest) | `escrowId` |
| ~303 | `amount` (on withdrawalRequest) | `requestedAmount` |
| ~196 | `approvedBy` (in `with` clause) | `approvedByUser` |
| ~538 | `approvedBy` (in `with` clause) | `approvedByUser` |

**Acceptance:** All report endpoints load without Drizzle runtime errors.

### Task 5.4: Fix `notifySessionClosed` Notification Type

**Audit:** `[SES-006]` — Uses `SESSION_OPENED` instead of `SESSION_CLOSED`.
**File:** `apps/api/src/services/notification.services.ts` (~line 367)
**Fix:** Change notification type to `'SESSION_CLOSED'`.
**Acceptance:** Session closure notifications categorized correctly.

### Task 5.5: Fix Session Name in Auto-Close Notifications

**Audit:** `[SES-006]` — `session-closer.ts` passes `sessionType` slug (e.g., "june") as `sessionName`.
**File:** `apps/api/src/jobs/session-closer.ts` (~line 76)
**Fix:** Pass the actual `sess.name` field (e.g., "June 2026") instead of `sess.sessionType`. This requires `autoManageSessions` to return `name` in the `closedSessions` array.
**Acceptance:** Notifications say "Registration Closed — June 2026" not "Registration Closed — june".

### Task 5.6: ~~Fix Notification Type for Registration Rejection~~ — VERIFIED OK

**Status:** Already correctly implemented at line 447: `data.approved ? 'REGISTRATION_APPROVED' : 'REGISTRATION_REJECTED'`.
**Action:** No change needed.

### Task 5.7: Fix Core Subjects Not Included in Registration Submission

**Audit:** `[CORE-003]` — `toggleSubject` returns early for core subjects, so they're never in `selectedSubjectIds`.
**File:** `apps/web/app/register/register.client.tsx` (~line 173)
**Fix:** Initialize `selectedSubjectIds` with all core subject IDs when student is Grade 10 AND session type is June. The `toggleSubject` early-return stays (prevents deselection).
**Acceptance:** Grade 10 June registration submissions include core subject IDs.

### Task 5.8: Remove Dead `CORE_SUBJECT_NAMES` Constant

**Audit:** `[CORE-004]` — Defined but never used. Misleading.
**File:** `apps/api/src/services/swap.services.ts` (~lines 72-77)
**Fix:** Delete the constant.
**Acceptance:** No dead code referencing hardcoded core subject names.

---

## Phase 6: Registration & Session Lifecycle Completion

**Goal:** Close all gaps in core registration and session workflows.

### Task 6.1: Add Graduated Status Check to Parent Approval

**Audit:** `[GRADE-003]` — Parent can approve registrations for graduated students.
**File:** `apps/api/src/services/registration.services.ts` — `approveRegistrationRequest` (~lines 382-458, currently only validates parent links at lines 409-415)
**Fix:** Before processing approvals, check `isGraduated(studentId)`. If graduated, throw error.
**Acceptance:** Approving registration for graduated student returns error.

### Task 6.2: Add Graduated Status Check to `getAvailableSubjects`

**Audit:** `[GRADE-003]` — Returns subjects for graduated students.
**File:** `apps/api/src/services/registration.services.ts` — `getAvailableSubjects` (~lines 176-195)
**Fix:** Check `isGraduated(studentId)` at the start. If graduated, return empty array.
**Note:** Both CREATE functions already have graduated checks (lines 212, 303) — these READ/APPROVE paths are the gaps.
**Acceptance:** Graduated students see no available subjects.

### Task 6.3: Add Session Active Check to Rejection Path

**Audit:** `[REG-002]` — `rejectRegistrationRequest` doesn't check session status (asymmetry with approve).
**File:** `apps/api/src/services/registration.services.ts`
**Fix:** Add session status check before rejection, consistent with the approval path.
**Acceptance:** Rejecting a registration for a closed session returns error (or succeeds — this is a design decision, but should be explicit).

### Task 6.4: Scope Registration Status Updates to Current Status

**Audit:** `[REG-002]` — Approve/reject UPDATE doesn't include status check in WHERE clause.
**File:** `apps/api/src/services/registration.services.ts`
**Fix:** Add `eq(registration.status, 'pending_approval')` to both approve and reject UPDATE WHERE clauses. Check row count — if fewer updated than requested, some were already processed.
**Acceptance:** Double-clicking "Approve" doesn't re-transition. Concurrent approve+reject doesn't corrupt.

### Task 6.5: Store Close Reason from Session Close

**Depends on:** Task 1.4
**Files:** `apps/api/src/routes/session.routes.ts`, `apps/api/src/services/session.services.ts`
**Fix:** Extract `reason` from validated body. Pass to `closeSession`. Store in `closeReason` column.
**Acceptance:** Admin-provided close reason stored and visible in audit views.

### Task 6.6: Fix editHistory TOCTOU Race Condition

**File:** `apps/api/src/services/session.services.ts` — `extendActiveSessionDeadline`
**Problem:** Read-modify-write on JSONB `editHistory` — concurrent edits overwrite.
**Fix:** Use atomic PostgreSQL JSONB append via `sql` template tag, or wrap in serializable transaction with `SELECT FOR UPDATE`.
**Acceptance:** Two concurrent deadline extensions both recorded in `editHistory`.

### Task 6.7: Finalize Pending Records on Session Close

**Audit:** `[SES-004]`, `[SES-006]`, `[GRADE-001]` — Pending registrations and change requests left orphaned.
**Files:** `apps/api/src/services/session.services.ts`, `apps/api/src/jobs/session-closer.ts`
**Fix:** When a session closes (manual or auto):
1. Query all `pending_approval` registrations for that session → transition to `rejected` (or new `expired` status) with system comment
2. Query all `pending_payment` registrations → transition to `expired`
3. Query all `pending_approval` change requests for registrations in that session → transition to `rejected` with system comment
4. Notify affected students/parents of each cancelled item
**Acceptance:** No `pending_*` registrations or change requests exist after session closes.

### Task 6.8: Add Re-Validation at Swap Approval Time

**Audit:** `[SWAP-003]` — Approval uses stale data from request creation.
**File:** `apps/api/src/services/swap.services.ts` — `approveChangeRequest`
**Fix:** Before executing swap within transaction:
1. Verify new subject is still `isActive === true`
2. Verify student has no existing registration for new subject in same session
3. Verify session is still `active`
**Acceptance:** Approving swap for deactivated/already-registered subject returns error.

### Task 6.9: Add Cancel Endpoint for Change Requests

**Audit:** `[SWAP-001]` — Error message says "cancel it" but no cancel endpoint exists.
**File:** `apps/api/src/routes/swap.routes.ts`, `apps/api/src/services/swap.services.ts`
**Fix:** Add `PUT /change-requests/:id/cancel` endpoint. Only the original requester (student) can cancel. Only `pending_approval` requests can be cancelled. Transitions to `cancelled` status.
**Acceptance:** Students can cancel their own pending change requests. Parents notified of cancellation.

### Task 6.10: Prevent Deactivating Core Subjects Without Warning

**Audit:** `[SUB-004]` — Deactivating a core subject silently removes it from Grade 10 requirements.
**File:** `apps/api/src/routes/subject.routes.ts` — deactivate endpoint
**Fix:** Before deactivating, check if subject `isCore === true`. If so, return 409 with message: "Cannot deactivate a core subject. Remove core designation first."
**Acceptance:** Admin must explicitly un-core a subject before deactivating it.

### Task 6.11: Fix History Child Selector Using Wrong ID

**Audit:** `[REG-006]` — `history.client.tsx:337` uses `child.id` (link PK) instead of `child.student.id` (user PK).
**File:** `apps/web/app/registrations/history/history.client.tsx` (~line 337)
**Fix:** Change `<option value={child.id}>` to `<option value={child.student.id}>`.
**Acceptance:** Parent history view returns correct registration data for selected child.

---

## Phase 7: Notification System Overhaul

**Goal:** Fix all notification wiring so URD-required notifications are delivered to the right recipients.

**Depends on:** Phase 5 Task 5.1 (the `'accepted'` → `'approved'` fix that unbreaks `getLinkedParents`)

### Task 7.1: Implement NOT-002 — 24-Hour Closing Reminder Email

**Audit:** `[NOT-002]` — Email template exists but is never called.
**Files:** `apps/api/src/services/notification.services.ts`, `apps/api/src/jobs/session-closer.ts`
**Fix:**
- In `notifySessionClosingSoon` (lines 326-348): currently only creates in-app notifications. `sendSessionClosingSoonEmail` IS imported (line 38) but never called. Add the email send call after `createBulkNotifications`.
- In session-closer: replace in-memory `remindedSessions` Set with DB column check (`reminderSentAt` from Task 1.5)
**Acceptance:** Sessions closing within 24 hours trigger email notification. No duplicates across server restarts.

### Task 7.2: Fix NOT-001 — Session Opened Email Includes Parents

**Audit:** `[NOT-001]` — Email blast only queries students, not parents.
**File:** `apps/api/src/services/notification.services.ts` — `notifySessionOpened` (~line 303)
**Fix:** Change email recipient query to include both `role = 'student'` and `role = 'parent'`.
**Acceptance:** Both students AND parents receive session-opened email.

### Task 7.3: Add Notifications for Manual Session Activation

**Audit:** `[SES-001]` / `[NOT-001]` — `POST /sessions/:id/activate` doesn't trigger `notifySessionOpened`.
**Files:** `apps/api/src/routes/session.routes.ts` or `apps/api/src/services/session.services.ts`
**Fix:** After `activateSession` succeeds, call `notifySessionOpened`.
**Acceptance:** Manually activated sessions send notifications to all users.

### Task 7.4: Create and Wire Session Closure Notifications

**Audit:** `[SES-004]`, `[SES-006]` — Neither manual nor auto-close sends closure notifications.
**Files:** `apps/api/src/services/notification.services.ts`, `apps/api/src/jobs/session-closer.ts`, `apps/api/src/routes/session.routes.ts`
**Fix:**
- Fix existing `notifySessionClosed` to also send email (currently only in-app)
- Call `notifySessionClosed` from manual close route handler
- Call `notifySessionClosed` from session-closer auto-close path (verify it's called)
**Acceptance:** Both auto-closed and manually-closed sessions notify all users via in-app + email.

### Task 7.5: Fix NOT-010 — Parent CC on NOT-004, NOT-005, NOT-007

**Audit:** `[NOT-010]` — Three notification functions don't CC parents.
**File:** `apps/api/src/services/notification.services.ts`
**Fix:**
- `notifyRegistrationDecision` (NOT-004): After notifying student, also create notification for linked parents
- `notifyPaymentConfirmed` (NOT-005): After notifying parent payer, also notify the student
- `notifyDropSwapProcessed` (NOT-007): After notifying student, also create notification for linked parents
**Acceptance:** Parents receive in-app notifications for all child actions. Students receive payment confirmation.

### Task 7.6: Fix Direct Registration Notification Text

**Audit:** `[REG-003]` / `[NOT-003]` — Parent-initiated registration sends "your child submitted a request" to the parent.
**File:** `apps/api/src/services/registration.services.ts` (~line 363)
**Fix:** When `requestedBy` is the parent (not the student), send a DIFFERENT notification to the STUDENT: "Your parent has registered subjects for you." Don't notify the parent about their own action.
**Acceptance:** Direct parent registration notifies the student, not the parent who initiated it.

### Task 7.7: Add Notification for Direct Parent Drop/Swap

**Audit:** `[SWAP-004]` — Child not notified when parent directly drops/swaps.
**File:** `apps/api/src/services/swap.services.ts` — `executeDirectDrop`, `executeDirectSwap`
**Fix:** Add `notifyDropSwapProcessed` call targeting the student.
**Acceptance:** Students notified via email when parent directly drops or swaps subjects for them.

### Task 7.8: Add Withdrawal Request Confirmation to Parent

**Audit:** `[ESC-004]` — Parent not notified of their own withdrawal request.
**File:** `apps/api/src/services/notification.services.ts` — `notifyWithdrawalRequested`
**Fix:** Notify both the student AND the parent who made the request.
**Acceptance:** Parent receives confirmation of their withdrawal request. Student is also notified.

### Task 7.9: Wire `notifyEscrowBalanceChanged` in Payment Flows

**Audit:** `[NOT-008]` — Not triggered on payment escrow debit or payment failure refund.
**File:** `apps/api/src/services/payment.services.ts`
**Fix:**
- After `debitEscrow` in `initiatePayment`: call `notifyEscrowBalanceChanged`
- After `creditEscrow` in `failPayment`: call `notifyEscrowBalanceChanged`
**Acceptance:** Parents notified of all escrow balance changes, including payment-related ones.

### Task 7.10: Remove Dead `notifyWithParentCC` Function

**Audit:** `[NOT-010]` — Defined but never called.
**File:** `apps/api/src/services/notification.services.ts` (~lines 207-247)
**Fix:** After Tasks 7.5-7.9 are complete, verify this function is truly unused and delete it.
**Acceptance:** No dead notification helper code.

### Task 7.11: Fix `emailSentAt` Not Being Updated

**File:** `apps/api/src/services/notification.services.ts`
**Fix:** After successful email send in `fireEmail`, update the corresponding notification record's `emailSentAt` timestamp. For bulk notifications, batch-update.
**Acceptance:** Notifications with sent emails have non-null `emailSentAt`.

---

## Phase 8: Audit Trail Completion

**Goal:** Every state-changing operation in the system is logged for full chain-of-custody.

### Task 8.1: Add Audit Logging to Registration Operations

**File:** `apps/api/src/routes/registration.routes.ts`
**Add:**
- `REGISTRATION_REQUESTED` — after student request
- `REGISTRATION_DIRECT` — after parent direct registration
- `REGISTRATION_APPROVED` — after approval
- `REGISTRATION_REJECTED` — after rejection

**Important:** For bulk operations, log one entry PER registration (not comma-separated IDs).
**Acceptance:** All 5 registration operations appear in audit log with individual entity IDs.

### Task 8.2: Add Audit Logging to Payment Operations

**File:** `apps/api/src/routes/payment.routes.ts`
**Add:**
- `PAYMENT_INITIATED` — after initiation
- `PAYMENT_CONFIRMED` — after webhook confirmation (use `null` userId for system)
- `PAYMENT_FAILED` — after failure/expiry
**Acceptance:** Payment lifecycle fully tracked in audit trail.

### Task 8.3: Add Audit Logging to Swap/Change Operations

**File:** `apps/api/src/routes/swap.routes.ts`
**Add:**
- `CHANGE_REQUEST_CREATED` — after drop/swap request
- `DIRECT_DROP_EXECUTED` — after parent direct drop
- `DIRECT_SWAP_EXECUTED` — after parent direct swap
**Acceptance:** All 6 swap/change operations in audit log.

### Task 8.4: Add Audit Logging to Escrow Operations

**File:** `apps/api/src/routes/escrow.routes.ts`
**Add:**
- `ESCROW_TRANSFER` — after transfer
- `WITHDRAWAL_REQUESTED` — after request creation
- `WITHDRAWAL_FULFILLED` — after fulfillment
- `WITHDRAWAL_REJECTED` — after rejection
**Acceptance:** Every escrow operation logged.

### Task 8.5: Add Audit Logging to Session Auto-Close

**Audit:** `[REP-006]` — `session-closer.ts` never calls `logAction`.
**File:** `apps/api/src/jobs/session-closer.ts`
**Fix:** After each auto-close and auto-activation, call `logAction` with `SESSION_AUTO_CLOSED` / `SESSION_AUTO_ACTIVATED` action types. Use `null` userId (system action).
**Acceptance:** Automatic session transitions appear in audit trail.

### Task 8.6: Add Remaining Audit Actions

**Add:**
- `USER_UPDATED` — after profile update (`user.routes.ts`)
- `ADMIN_ANNOUNCEMENT` — after bulk announcement (`notification.routes.ts`)
- `REGISTRATION_CONFIRMED` — inside `confirmPayment` when registrations move to `confirmed`

**Final verification:** Search `logAction(` across codebase — confirm all defined action types have at least one call site.

---

## Phase 9: Grade Progression & Graduation Enforcement

**Goal:** Make grade progression atomic, correct, and enforce graduated status across all features.

### Task 9.1: Wrap Grade Progression in Database Transaction

**Audit:** `[GRADE-001]` — Individual UPDATE per student, no transaction.
**File:** `apps/api/src/services/grade.services.ts`
**Fix:** The progression already uses `db.transaction()` with batch updates — verify this. If not, wrap in transaction with batch UPDATEs grouped by grade transition.
**Acceptance:** All eligible students progressed atomically, or none.

### Task 9.2: Clean Up Pending Records on Graduation

**Audit:** `[GRADE-001]`, `[GRADE-003]` — No cleanup when students graduate.
**File:** `apps/api/src/services/grade.services.ts` — `progressGrades`
**Fix:** After progressing Grade 12 → null (graduated):
1. Query all `pending_approval`/`pending_payment` registrations for graduated students
2. Transition to `expired`/`rejected` with system comment
3. Query all `pending_approval` change requests for graduated students
4. Transition to `rejected` with system comment
5. Notify affected parents
**Acceptance:** No orphaned pending records for graduated students.

### Task 9.3: Clean Up Pending Records on Manual Grade Adjustment

**File:** `apps/api/src/services/grade.services.ts` — `manualGradeAdjustment`
**Fix:** If the new grade is `null` (graduated), apply same cleanup as Task 9.2.
**Acceptance:** Admin manually graduating a student cleans up their pending records.

### Task 9.4: Add `requireNotGraduated` Middleware

**Audit:** `[GRADE-003]` — Graduated blocking is ad-hoc in service functions.
**File:** `apps/api/src/middleware/access-control.middleware.ts`
**Fix:** Create a `requireNotGraduated()` middleware that checks `user.role === 'student' && user.grade === null`. Apply to registration and swap route groups.
**Acceptance:** Graduated students get 403 on all registration/swap endpoints. New endpoints inherit the guard.

### Task 9.5: Fix Inconsistent Graduated Check in Admin Override

**Audit:** `[REG-007]` — Uses `student.grade === null` instead of `isGraduated()`.
**File:** `apps/api/src/services/registration.services.ts` (~line 553)
**Fix:** Replace `student.grade === null` with `await isGraduated(data.studentId)`.
**Acceptance:** Consistent graduated check across all code paths.

### Task 9.6: Fix Audit Log Await Pattern in Grade Services

**Audit:** `[GRADE-001]`, `[GRADE-002]` — `logAction` at line 116-117 is fire-and-forget (not awaited, only `.catch()` chained). Compare to line 175-182 where it IS properly awaited.
**File:** `apps/api/src/services/grade.services.ts`
**Fix:** Use proper try/catch. For auto-progression (line 116), if audit logging fails, log to error monitor but don't fail the progression. For manual adjustment (line 175), keep the await and propagate the error.
**Acceptance:** Audit log failures are properly handled, not silently swallowed.

### Task 9.7: Trigger Grade Progression on Manual Session Close

**Audit:** `[GRADE-001]` — Verify manual close triggers `progressGrades`.
**File:** `apps/api/src/routes/session.routes.ts` (~line 256)
**Fix:** Verify `progressGrades(session.sessionType)` is called. If fire-and-forget, add error handling/logging.
**Acceptance:** Manually closing a November session progresses grades correctly.

---

## Phase 10: Report System Fixes & Completion

**Depends on:** Phase 5 (column/relation fixes), Phase 8 (audit trail populated)

### Task 10.1: Fix Revenue Report Double-Counting

**Audit:** `[REP-002]` — Inner loop (~lines 255-266) adds full registration price for EACH `paymentRegistration` link. If one registration has multiple payment records, revenue is double-counted per payment link.
**File:** `apps/api/src/services/report.services.ts` — `generateFinancialReport`
**Fix:** Track revenue at the payment level, not registration level. For payment-method breakdown, iterate over unique payments, not paymentRegistrations. Each payment's `amount + escrowAmountApplied` is the total for that payment.
**Acceptance:** Revenue totals are accurate for group payments.

### Task 10.2: Add Missing Approval Trail to Registration Report

**Audit:** `[REP-001]` — Missing `requestedBy` and `processedBy`.
**File:** `apps/api/src/services/report.services.ts`
**Fix:** Join `requestedByUser` relation. Add `confirmedAt` / payment confirmation data as "processed by" chain.
**Acceptance:** Report shows full "Requested by → Approved by → Processed by" chain.

### Task 10.3: Add Council Filter/Breakdown

**Audit:** `[REP-001]`, `[REP-002]` — Missing council filter and breakdown.
**File:** `apps/api/src/services/report.services.ts`
**Fix:**
- REP-001: Add `council` to query schema and apply as filter
- REP-002: Add council-based revenue breakdown (group by `subject.council`)
**Acceptance:** Reports can be filtered/broken down by council.

### Task 10.4: Add Pagination to All Report Endpoints

**Audit:** `[REP-001]` through `[REP-009]` — All queries load entire result sets.
**File:** `apps/api/src/services/report.services.ts`
**Fix:** Apply `limit`/`offset` from query schemas. Return `total` count alongside data.
**Acceptance:** All report endpoints accept pagination. Default limits prevent unbounded results.

### Task 10.5: Add CSV Export to Audit Trail

**Audit:** `[REP-006]` — Audit route has no CSV export capability.
**File:** `apps/api/src/routes/audit.routes.ts`
**Fix:** Add `format` query parameter support (reuse the `toCSV` helper from report routes).
**Acceptance:** Audit trail exportable as CSV.

### Task 10.6: Add Pending Withdrawals Metric to Dashboard

**Audit:** `[REP-008]` — Missing from admin dashboard.
**File:** `apps/api/src/services/report.services.ts` — dashboard metrics
**Fix:** Add query for pending withdrawal request count and total pending amount.
**Acceptance:** Admin dashboard shows pending withdrawal count.

### Task 10.7: Fix CSV Download URL in Frontend

**File:** `apps/web/app/admin/reports/reports.client.tsx`
**Fix:** Replace hardcoded `/api/v1/reports/...` with correct API origin. Use `fetch()` with `credentials: 'include'` + blob download.
**Acceptance:** CSV files download successfully.

---

## Phase 11: Frontend & UX Polish

**Goal:** Close all frontend gaps identified in the audit.

### Task 11.1: Add "Graduated" Dashboard Banner

**Audit:** `[GRADE-003]` — No frontend graduated status indicator.
**Files:** `apps/web/app/page.tsx` or appropriate dashboard page
**Fix:** Check user's grade. If `null` and role is `student`, show "Graduated" banner with message that registration features are disabled. Disable navigation to registration/swap pages.
**Acceptance:** Graduated students see clear "Graduated" status. Registration links disabled.

### Task 11.2: Scope Core Subject Enforcement to Grade 10 June

**Audit:** `[CORE-003]` — Frontend auto-selects core subjects for ALL users, not just Grade 10 June.
**File:** `apps/web/app/register/register.client.tsx`
**Problem:** The auto-selection `useEffect` (~lines 118-125) runs unconditionally for all sessions and grades. The `toggleSubject` guard (~lines 174-185) also applies universally.
**Fix:** The auto-selection `useEffect` and the core subject banner must check:
- `user.grade === 10` (or the student being registered for, if parent)
- `session.sessionType === 'june'`
Only apply core enforcement when both conditions are true.
**Acceptance:** Grade 11/12 students and non-June sessions don't see core subject enforcement.

### Task 11.3: Show/Hide Drop/Swap Buttons Based on Core Status

**Audit:** `[SWAP-005]` — Frontend doesn't hide buttons for core subjects.
**File:** `apps/web/app/registrations/registrations.client.tsx`
**Fix:**
- Add `isCore` to the `Subject` type (or fetch it from the registration's subject data)
- In `RegistrationCard`: if subject is core AND student is Grade 10 AND session is June, hide drop/swap buttons. Show tooltip: "Core subjects cannot be dropped or swapped."
**Acceptance:** Core subject registrations show no drop/swap buttons with explanatory message.

### Task 11.4: Show Clear Message When Session Closed

**Audit:** `[SWAP-006]` — Buttons just disappear with no explanation.
**File:** `apps/web/app/registrations/registrations.client.tsx`
**Fix:** When `sessionActive` is false, instead of hiding buttons, show a disabled state with message: "Registration window is closed. Drop/swap operations are unavailable."
**Acceptance:** Users see explanation when actions are disabled due to closed window.

### Task 11.5: Add Session Type Filter to Admin Sessions Page

**Audit:** `[SES-002]` — Only status filter exists.
**File:** `apps/web/app/admin/sessions/sessions-admin.client.tsx`
**Fix:** Add session type filter buttons (June, November, January, All).
**Acceptance:** Admin can filter sessions by type and status.

### Task 11.6: Add Countdown Timer for Active Sessions

**Audit:** `[SES-005]` — Only static "X days remaining" text.
**File:** `apps/web/app/register/register.client.tsx`
**Fix:** Replace static days calculation with a `setInterval`-based countdown showing days, hours, minutes. Update every minute.
**Acceptance:** Users see live countdown to session closing.

### Task 11.7: Fix `useSuspenseQuery` Pattern

**Audit:** `[REG-001]` — `useSuspenseQuery` with `enabled: false` violates suspense contract.
**File:** `apps/web/app/register/register.client.tsx` (~line 83)
**Fix:** Replace `useSuspenseQuery` with `useQuery` for the children query.
**Acceptance:** No TypeScript errors. Both student and parent views work.

### Task 11.8: Replace Session ID Text Input with Dropdown in Reports

**File:** `apps/web/app/admin/reports/reports.client.tsx`
**Fix:** Fetch sessions on mount. Render `<select>` dropdown showing session name, type, and status.
**Acceptance:** Admin selects sessions from dropdown, not by pasting UUIDs.

### Task 11.9: Add External Teacher Pricing Note

**Audit:** `[SUB-006]` — Missing URD-required note.
**File:** `apps/web/app/subjects/subjects-browse.client.tsx` — SubjectDetailModal
**Fix:** Add informational note: "Students taking school subjects with external teachers pay the full school price."
**Acceptance:** Subject detail modal shows the pricing rule note.

### Task 11.10: Add Admin Payments Page Server-Side Guard

**Audit:** `[PAY-007]` — `admin/payments/page.tsx` doesn't call `requireAdmin()`.
**File:** `apps/web/app/admin/payments/page.tsx`
**Fix:** After Task 3.6 (admin layout guard), this is automatically fixed. Verify.
**Acceptance:** Admin payments page requires admin auth.

---

## Phase 12: Missing Feature Implementation

**Goal:** Implement URD features that are completely missing.

### Task 12.1: Implement Email Verification Flow

**Audit:** `[AUTH-001]`, `[AUTH-002]` — Email verification defaults to disabled.
**Files:** `apps/api/src/lib/auth.ts`, `apps/api/src/integrations/email.ts`, `apps/web/app/verify-email/page.tsx` (new)
**Fix:**
- Configure better-auth `sendVerificationEmail` callback using Resend
- Create verification email template
- Create `/verify-email` page that handles the verification token
- Set `requireEmailVerification: true` (or guard with env var for staging)
**Acceptance:** New signups receive verification email. Unverified users cannot access protected features.

### Task 12.2: Complete Password Reset Email Flow

**Audit:** `[AUTH-006]` — Pages exist but verify better-auth callbacks are fully wired.
**Files:** `apps/api/src/lib/auth.ts`
**Fix:** Ensure `sendResetPasswordEmail` callback is configured and uses Resend with proper template. Verify the reset page correctly handles the token.
**Acceptance:** Users can request and complete password reset via email.

### Task 12.3: Implement PDF Receipt Generation

**Audit:** `[PAY-006]` — URD requires "downloadable PDF in dashboard."
**Fix:**
- Add a PDF generation library (e.g., `@react-pdf/renderer` or `pdfkit`)
- Create `GET /payments/:id/receipt` endpoint that generates and returns a PDF
- Add download button in the registrations/payment history UI
- PDF includes: subjects registered, amounts, payment method, date, confirmation number
**Acceptance:** Parents can download PDF receipts from dashboard.

### Task 12.4: Implement Email Change with Re-Verification

**Audit:** `[AUTH-007]` — Only name/phone updates implemented.
**Files:** `apps/api/src/routes/user.routes.ts`, `apps/web/app/profile/profile.client.tsx`
**Fix:**
- Add email field to `UpdateProfile` schema (optional)
- When email is changed: send verification to NEW email, keep old email active until verified
- Use better-auth's email change flow if available, or implement custom
**Acceptance:** Email change requires verification of new address. Profile shows pending email change.

### Task 12.5: Implement Bulk Announcement Scheduling

**Audit:** `[NOT-011]` — Only "send immediately" exists. URD says "schedule or send immediately."
**Files:** `packages/validations/src/notification/notification.validations.ts`, `apps/api/src/services/notification.services.ts`
**Fix:**
- Add `scheduledAt` field to `BulkAnnouncement` schema (optional)
- If provided, store the announcement and use a job/cron to send at the scheduled time
- If not provided, send immediately (current behavior)
**Acceptance:** Admin can schedule announcements for future delivery.

---

## Dependency Graph

```
Phase 0 ──────────────────────────────────────────────────────►
         │
Phase 1  ─── Schema migrations ──────────────────────────────►
         │                    │
Phase 2  ─── Validation ──►  │
         │                    │
Phase 3  ─── Security ────►  │
         │                    │
Phase 4  ─── Financial ───►  │  (depends on Phase 1 for CHECK constraints)
         │                    │
Phase 5  ─── Data fixes ──►  │  (depends on Phase 1 for column renames)
         │                    │
Phase 6  ─── Lifecycle ────►  │  (depends on Phase 4 for transactions,
         │                    │   Phase 5 for correct data)
         │                    │
Phase 7  ─── Notifications ► │  (depends on Phase 5 Task 5.1 for
         │                    │   'approved' status fix)
         │                    │
Phase 8  ─── Audit ────────► │  (depends on Phases 4-7 for all
         │                    │   operations to exist)
         │                    │
Phase 9  ─── Grade ─────────►│  (depends on Phase 6 for lifecycle,
         │                    │   Phase 7 for notifications)
         │                    │
Phase 10 ─── Reports ───────►│  (depends on Phase 5 for query fixes,
         │                    │   Phase 8 for audit data)
         │                    │
Phase 11 ─── Frontend ──────►│  (depends on all backend phases)
         │                    │
Phase 12 ─── Missing ───────►│  (depends on Phase 3 for auth config)
```

### Parallelization Opportunities

Within the constraints above:
- **Phases 2, 3** can run in parallel (validation and security are independent)
- **Tasks within Phase 5** are all independent of each other
- **Phase 8** tasks are all independent of each other
- **Phase 11** tasks are all independent of each other (but depend on backend phases)

---

## Verification Checklist

After all phases are complete, verify:

- [ ] `cd apps/api && npx tsc --noEmit` — zero errors
- [ ] All 54 P0 stories pass their URD acceptance criteria
- [ ] All 15 P1 stories pass their URD acceptance criteria
- [ ] All financial operations use database transactions
- [ ] All webhook endpoints validate signatures
- [ ] All notification triggers send to correct recipients
- [ ] All 30+ audit action types have at least one `logAction` call
- [ ] Graduated students cannot access registration/swap features
- [ ] Core subjects cannot be dropped by Grade 10 students in June
- [ ] Session close finalizes all pending records
- [ ] All report endpoints support pagination and CSV export
- [ ] No password can be created without uppercase + number
- [ ] Email verification is enforced in production
- [ ] PDF receipts downloadable from dashboard
