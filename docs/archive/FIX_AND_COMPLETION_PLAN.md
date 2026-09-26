# IGCSE Subject Reservation System — Fix & Completion Plan

**Document Version:** 1.1
**Created:** April 2026
**Last Updated:** April 8, 2026 (incorporated peer review feedback — 12 corrections)
**Purpose:** Systematic plan to resolve all verified audit findings and complete the project to full URD compliance
**Basis:** Independent verification audit (64 findings verified, 61 confirmed, 3 partially confirmed, 0 false positives)

---

## Table of Contents

0. [Phase 0: Build Health Prerequisite](#phase-0-build-health-prerequisite)
1. [Guiding Principles](#1-guiding-principles)
2. [Phase Overview](#2-phase-overview)
3. [Phase 1: Database Schema & Foundation Fixes](#3-phase-1-database-schema--foundation-fixes)
4. [Phase 2: Validation Layer Hardening](#4-phase-2-validation-layer-hardening)
5. [Phase 3: Security Hardening](#5-phase-3-security-hardening)
6. [Phase 4: Financial Integrity](#6-phase-4-financial-integrity)
7. [Phase 5: Data Correctness & Query Fixes](#7-phase-5-data-correctness--query-fixes)
8. [Phase 6: Registration & Session Lifecycle Completion](#8-phase-6-registration--session-lifecycle-completion)
9. [Phase 7: Notification System Overhaul](#9-phase-7-notification-system-overhaul)
10. [Phase 8: Audit Trail Completion](#10-phase-8-audit-trail-completion)
11. [Phase 9: Grade Progression & Session Close Fixes](#11-phase-9-grade-progression--session-close-fixes)
12. [Phase 10: Report System Fixes & Completion](#12-phase-10-report-system-fixes--completion)
13. [Phase 11: Frontend & UX Polish](#13-phase-11-frontend--ux-polish)
14. [Phase 12: Missing Feature Implementation](#14-phase-12-missing-feature-implementation)
15. [Dependency Graph](#15-dependency-graph)
16. [Verification Checklist](#16-verification-checklist)

---

## Phase 0: Build Health Prerequisite

**Before any phase begins, the API project must compile cleanly.**

### Task 0.1: Fix TypeScript Compilation Error in `report.routes.ts`

**Current state:** `tsc --noEmit` in `apps/api` fails with a syntax error at `report.routes.ts:66`:
```
src/routes/report.routes.ts(66,50): error TS1005: '>' expected.
```

The line `Parameters<ReturnType<typeof new Hono().get>>` is invalid TypeScript — `typeof new Hono().get` cannot be used in a type position.

**What to change:** Replace the invalid type expression with a correct Hono context type. Use `Context` from `hono` or the specific `HonoEnv` context type already defined in the project. The `respond` function only needs a context object to call `success(c, data)` — type it accordingly.

**Acceptance criteria:**
- `cd apps/api && npx tsc --noEmit` exits with code 0 (no errors)
- All report endpoints still function correctly
- This is a **blocking prerequisite** — no other phase should begin until the build is green

### Task 0.2: Establish Build Gate

After fixing the compilation error, ensure every phase maintains a clean build:
- Run `tsc --noEmit` after each task within a phase
- If a task introduces a type error, fix it before proceeding to the next task

---

## 1. Guiding Principles

1. **Fix broken before building new.** Existing features with confirmed bugs take priority over unimplemented features.
2. **Schema first.** Database changes generate migrations that must be applied before service-layer fixes that depend on them.
3. **Security before features.** Any finding that enables data breach, financial fraud, or unauthorized access is fixed before feature completions.
4. **Atomicity for money.** Every operation that touches financial data (escrow balances, payments, transfers) must be wrapped in a database transaction.
5. **No production code in this document.** This plan describes *what* to change and *why*, not *how* to write the code. Implementation details belong in the implementation itself. Where this document includes pseudo-code fragments, SQL-ish descriptions, or type signatures, these are normative illustrations of the *what* — not copy-paste-ready implementation. Do not strip them; they clarify intent.
6. **Every change must be verifiable.** Each task includes acceptance criteria so the fix can be confirmed correct.

---

## 2. Phase Overview

```
Phase 0  ──► Build Health Prerequisite     (Fix tsc errors — BLOCKS ALL OTHER PHASES)
Phase 1  ──► Schema & Foundation           (Database migrations, env validation)
Phase 2  ──► Validation Layer              (Input sanitization, schema fixes)
Phase 3  ──► Security Hardening            (Auth, webhooks, XSS, rate limiting)
Phase 4  ──► Financial Integrity           (Transaction wrapping, atomicity)
Phase 5  ──► Data Correctness              (Wrong values, wrong column names)
Phase 6  ──► Registration & Session        (Lifecycle gaps, race conditions)
Phase 7  ──► Notification Overhaul         (Wiring, missing triggers, email fixes)
Phase 8  ──► Audit Trail Completion        (16 missing action types)
Phase 9  ──► Grade Progression             (Transaction wrapping, manual close)
Phase 10 ──► Report System                 (Broken queries, pagination, CSV)
Phase 11 ──► Frontend & UX                 (Layout guards, redirects, polish)
Phase 12 ──► Missing Features              (Password reset, email verification, PDF receipts)
```

### Estimated Scope

| Phase | Tasks | Severity Addressed | Files Affected |
|-------|-------|--------------------|----------------|
| 0 | 2 | Blocker | 1 (report.routes.ts) |
| 1 | 8 | Critical, High | 2-3 (schema, env, migration) |
| 2 | 5 | High | 3-4 (validations, route schemas) |
| 3 | 8 | Critical, High | 8-10 (auth, email, middleware, routes) |
| 4 | 8 | Critical, High | 3 (escrow, swap, payment services) |
| 5 | 7 | Critical, High | 5 (notification, report, swap, registration services) |
| 6 | 9 | High | 4-5 (registration, session services + routes) |
| 7 | 9 | Critical, High | 3-4 (notification service, email, session-closer) |
| 8 | 6 | High | 6-8 (all route files) |
| 9 | 4 | High | 3 (grade service, session routes, session-closer) |
| 10 | 6 | High, Medium | 4 (report service, routes, frontend) |
| 11 | 6 | High, Medium | 6-8 (frontend pages, lib) |
| 12 | 5 | P0/P1 URD gaps | 5-8 (auth, email, frontend pages) |

---

## 3. Phase 1: Database Schema & Foundation Fixes

**Goal:** Establish a correct, consistent, and safe database foundation. All subsequent phases depend on these schema changes being applied first.

**Files primarily affected:**
- `packages/db/src/schema.ts`
- `apps/api/src/env.ts`

**After all changes in this phase, generate a single migration:**
```
cd packages/db && pnpm db:generate:migrations
```

---

### Task 1.1: Migrate Financial Columns from `doublePrecision` to `numeric`

**Audit Finding:** #7 (Critical)
**URD Alignment:** All payment, escrow, and pricing operations across PAY, ESC, REG, SWAP, SUB

**What to change:**

All 11 financial columns must change from `doublePrecision` to `numeric` with appropriate precision. The replacement type should be `numeric("column_name", { precision: 12, scale: 2 })` — supporting values up to 9,999,999,999.99 which is more than sufficient for school subject pricing in EGP.

| Table | Column | Current Line in schema.ts |
|-------|--------|---------------------------|
| `subject` | `priceInSchool` | ~368 |
| `subject` | `customPrice` | ~370 |
| `registration` | `priceAtRegistration` | ~498 |
| `payment` | `amount` | ~581 |
| `payment` | `escrowAmountApplied` | ~583 |
| `escrow` | `balance` | ~657 |
| `escrowTransaction` | `amount` | ~684 |
| `withdrawalRequest` | `requestedAmount` | ~725 |
| `withdrawalRequest` | `releasedAmount` | ~726 |
| `changeRequest` | `priceAtRequest` | ~798 |
| `changeRequest` | `priceDifference` | ~800 |

**Important:** The `numeric` type is already imported in schema.ts (line 21) and used for non-financial fields. No new import needed.

**Critical implementation detail — Drizzle `numeric` returns strings:**

Drizzle ORM's `numeric()` type returns JavaScript `string` values by default (not `number`), because JS `number` cannot represent all `numeric` precision. This codebase already handles this for `file.size` (using `toString()` on write and `parseInt()` on read). After migrating from `doublePrecision` (which returns JS `number`) to `numeric` (which returns JS `string`), every location that performs arithmetic, JSON serialization, or Zod validation on these columns will break unless explicitly handled.

**Two approaches:**
- **Option A (Recommended):** Use `numeric("column_name", { precision: 12, scale: 2, mode: 'number' })`. Drizzle ORM 0.45.1 (the version locked in this project's `pnpm-lock.yaml`) supports the `mode` option on `numeric` columns — `'string' | 'number' | 'bigint'`. With `mode: 'number'`, Drizzle returns JS `number` directly, avoiding the string conversion issue. Since precision 12 / scale 2 fits safely within JS `number` range (max ~10 billion EGP), this is safe for this project's financial amounts.
- **Option B (Fallback):** Keep default string behavior (`mode: 'string'`, the default) and add `z.coerce.number()` transformations in Zod schemas, plus explicit `Number()` casts in service layer arithmetic. Use this if `mode: 'number'` causes any unexpected behavior in query results or Drizzle's query builder.

**Note:** `.mapWith(Number)` is NOT used anywhere in this codebase and is a lower-level Drizzle API. Prefer `mode: 'number'` as the idiomatic approach for this Drizzle version.

**Acceptance criteria:**
- All 11 columns use `numeric` with precision 12, scale 2
- Migration generated successfully
- Migration applies without data loss (PostgreSQL auto-casts `double precision` → `numeric`)
- Application arithmetic no longer suffers from IEEE 754 rounding (e.g., `0.1 + 0.2 === 0.3`)
- **All arithmetic in service files, all JSON API responses, and all Zod validations are audited to ensure they handle the numeric type correctly (string vs number)** — run a project-wide search for all 11 column names and verify each usage site
- Frontend components that display prices continue to work (no `NaN` or `[object Object]`)

---

### Task 1.2: Consolidate Duplicate User Relations

**Audit Finding:** H-SCHEMA-1 (High)
**URD Alignment:** Cross-cutting — affects all Drizzle `db.query.user.*` calls

**What to change:**

`schema.ts` defines two `relations(user, ...)` blocks:
- `userRelations` at line ~104: only `sessions` and `accounts`
- `userRelationsExtended` at line ~284: `sessions`, `accounts`, `todos`, `files`, plus all business relations

Drizzle ORM expects exactly one `relations()` declaration per table. Merge these into a single `export const userRelations = relations(user, ...)` that includes all relations from both blocks. Delete the second declaration entirely.

**The merged declaration must use the exact relation names from `userRelationsExtended` in schema.ts:**

`sessions`, `accounts`, `todos`, `files`, `linkRequestsAsParent`, `linkRequestsAsStudent`, `registrationsAsStudent`, `registrationsRequested`, `registrationsApproved`, `paymentsAsStudent`, `paymentsAsParent`, `paymentsConfirmed`, `changeRequestsRequested`, `changeRequestsApproved`, `notifications`, `auditLogs`

**Do not invent new names** — use exactly what the schema already exports. The plan previously mentioned `registrationsAsRequester` — the correct name is `registrationsRequested`.

**Acceptance criteria:**
- Only one `relations(user, ...)` export exists
- It contains all 16 relations listed above, using the exact names from the current schema
- All existing `db.query.user.*` calls continue to work

---

### Task 1.3: Fix Cascade Delete Chain for Financial Records

**Audit Finding:** H-SCHEMA-2 (High), H-SCHEMA-3 (High)
**URD Alignment:** REP-006 (Audit trail integrity), ESC-001 through ESC-007 (Escrow data preservation)

**What to change:**

The current FK `onDelete` policies create two problems:
1. **Inconsistency:** `registration.studentId` uses `cascade` but `payment.studentId` uses `restrict` — the database will block user deletion anyway due to `restrict` on payments, making the cascade on registrations misleading.
2. **Data destruction:** If a user *could* be deleted, `escrow → escrowTransaction → withdrawalRequest` all cascade-delete, destroying the financial ledger.

Change the following FK `onDelete` policies to `restrict`:

| Table.Column | Current | Change To | Line |
|-------------|---------|-----------|------|
| `registration.studentId` → `user.id` | cascade | **restrict** | ~488 |
| `escrow.studentId` → `user.id` | cascade | **restrict** | ~656 |
| `escrowTransaction.escrowId` → `escrow.id` | cascade | **restrict** | ~681 |
| `withdrawalRequest.escrowId` → `escrow.id` | cascade | **restrict** | ~724 |

**Rationale:** In a financial system, deleting a user should never silently destroy payment records, escrow balances, or transaction history. If user deletion is needed in the future, implement a soft-delete pattern instead.

**Acceptance criteria:**
- All four FKs use `onDelete: "restrict"`
- Attempting to delete a user with any registration, payment, or escrow record raises a FK constraint error
- Financial records are never silently destroyed

---

### Task 1.4: Fix Timestamp Timezone Inconsistency

**Audit Finding:** H-SCHEMA-4 (High)
**URD Alignment:** Cross-cutting — all date comparisons and scheduling (SES-006, auto-close, grade progression)

**What to change:**

Early tables use bare `timestamp()` (which creates `timestamp without time zone` in PostgreSQL), while business tables use `timestamp("...", { withTimezone: true })` (creating `timestamptz`). When the database server timezone differs from UTC, comparisons between these column types produce incorrect results.

Add `{ withTimezone: true }` to all `timestamp()` calls in these tables:

| Table | Columns to fix |
|-------|---------------|
| `user` (lines ~29-37) | `createdAt`, `updatedAt`, `banExpires` |
| `session` (auth, lines ~48-53) | `expiresAt`, `createdAt`, `updatedAt` |
| `account` (lines ~76-83) | `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `createdAt`, `updatedAt` |
| `verification` (lines ~94-99) | `expiresAt`, `createdAt`, `updatedAt` |
| `todo` (lines ~155-159) | `createdAt`, `updatedAt` |
| `file` (lines ~214-218) | `createdAt`, `updatedAt` |
| `fileVariant` (line ~257) | `createdAt` |
| `parentStudentLink` (lines ~328-336) | `requestedAt`, `respondedAt`, `createdAt`, `updatedAt` |
| `subject` (lines ~373-377) | `createdAt`, `updatedAt` |

**Note:** The better-auth tables (`user`, `session`, `account`, `verification`) are managed by better-auth's schema generation. Verify that better-auth supports `withTimezone` before modifying those tables. If better-auth enforces bare timestamps, document this as a known inconsistency and ensure all application-level date comparisons explicitly cast to UTC.

**Acceptance criteria:**
- All application-controlled tables use `{ withTimezone: true }` consistently
- Migration applies successfully
- Date comparisons in session auto-close and scheduling still work correctly

---

### Task 1.5: Add `closeReason` Column to Registration Session

**Audit Finding:** H-SES-4 (High)
**URD Alignment:** SES-004 ("Confirmation required before closing" — the reason *is* the confirmation context)

**What to change:**

The `CloseSession` Zod schema at `packages/validations/src/session/session.validations.ts:146-153` accepts an optional `reason` field, but:
- The route handler never extracts it from the request body
- The `closeSession` service function has no `reason` parameter
- No `closeReason` column exists in the `registrationSession` table

Add to `registrationSession` in schema.ts:

| Column | Type | Constraints |
|--------|------|-------------|
| `closeReason` | `text("close_reason")` | Optional (nullable) |

**Acceptance criteria:**
- Column exists in schema and migration
- Column is nullable (auto-close has no human-provided reason)
- The column is accessible from the session service

---

### Task 1.6: Rename Withdrawal Resolution Columns

**Audit Finding:** H-ESC-4 (High)
**URD Alignment:** ESC-006 (Admin fulfills withdrawal), ESC-004 (rejection flow)

**What to change:**

The `withdrawalRequest` table uses `fulfilledAt` and `fulfilledBy` for both fulfillment AND rejection — semantically incorrect. Two approaches:

**Option A (Recommended — Rename):** Rename to generic resolution columns:

| Current | Rename To |
|---------|-----------|
| `fulfilledAt` | `resolvedAt` |
| `fulfilledBy` | `resolvedBy` |

This accurately describes both fulfillment and rejection. All code referencing `fulfilledAt`/`fulfilledBy` must be updated:
- `escrow.services.ts` (fulfillWithdrawalRequest ~line 475, rejectWithdrawalRequest ~line 522)
- Any report or query referencing these columns

**Cross-reference with Task 4.5:** When Task 4.5 modifies `fulfillWithdrawalRequest` to remove the `debitEscrow` call, the same function's `set({...})` block also references `fulfilledAt`/`fulfilledBy`. After this rename, those must become `resolvedAt`/`resolvedBy`. Implementers must apply the column rename (from the migration) AND the field name change in the service code in the same pass — do not edit old column names into new service logic or vice versa.

**Option B (Add separate columns):** Keep `fulfilledAt`/`fulfilledBy` for fulfillment, add `rejectedAt`/`rejectedBy` for rejection. More explicit but adds schema complexity.

**Acceptance criteria:**
- Column names accurately represent their usage for both fulfillment and rejection
- Service code references the correct column names
- Migration renames cleanly

---

### Task 1.7: Add Database CHECK Constraints

**Audit Finding:** Medium (data integrity)
**URD Alignment:** Cross-cutting financial safety

**What to change:**

Add PostgreSQL CHECK constraints in the migration SQL (Drizzle doesn't natively support CHECK, so these must be added as raw SQL in the migration):

| Table | Constraint |
|-------|-----------|
| `escrow` | `CHECK (balance >= 0)` |
| `payment` | `CHECK (amount > 0)` |
| `payment` | `CHECK (escrow_amount_applied >= 0)` |
| `escrow_transaction` | `CHECK (amount > 0)` |
| `withdrawal_request` | `CHECK (requested_amount > 0)` |
| `withdrawal_request` | `CHECK (released_amount > 0)` — when not null |

**Approach:** After generating the Drizzle migration, manually append the CHECK constraints as `ALTER TABLE ... ADD CONSTRAINT ...` statements to the migration SQL file.

**Acceptance criteria:**
- Database rejects negative escrow balances
- Database rejects zero or negative financial amounts
- Existing data does not violate any new constraint

---

### Task 1.8: Add `BETTER_AUTH_SECRET` to Environment Validation

**Audit Finding:** #13 (Critical)
**URD Alignment:** AUTH-001 through AUTH-008 (session security underpins all auth)

**What to change:**

In `apps/api/src/env.ts`, add `BETTER_AUTH_SECRET` to the `envSchema` object:
- Type: `z.string().min(32)` — enforce minimum entropy for session token signing
- This ensures the server refuses to start if the secret is missing or too short

Also add `RESEND_API_KEY` validation — but **preserve the existing stub mode for development/CI:**
- The email integration (`email.ts`) already has a graceful stub mode: when `RESEND_API_KEY` is absent, it logs a warning and stubs all sends as `{ success: true, stubbed: true }`
- Making `RESEND_API_KEY` unconditionally required would break local development and CI pipelines that don't need real email sending
- Type: `z.string().min(1).optional()` — but add a **runtime production guard**: if `NODE_ENV === 'production'` and `RESEND_API_KEY` is missing, log an error and fail startup
- In development/test: log a loud warning at startup ("Email sending is stubbed — set RESEND_API_KEY for real email delivery") but allow the server to start

**Acceptance criteria:**
- Server refuses to start with error message if `BETTER_AUTH_SECRET` is missing or under 32 characters
- In production: server refuses to start if `RESEND_API_KEY` is missing
- In development/test: server starts with a warning, email stub mode works as before
- Existing local development workflows and CI pipelines are unaffected

---

## 4. Phase 2: Validation Layer Hardening

**Goal:** Fix input validation defects that allow malformed, dangerous, or incorrect data to enter the system.

**Files primarily affected:**
- `packages/validations/src/common.validations.ts`
- `packages/validations/src/escrow/escrow.validations.ts`
- `packages/validations/src/payment/payment.validations.ts`
- `packages/validations/src/report/report.validations.ts` (new file)
- `apps/api/src/routes/report.routes.ts`

---

### Task 2.1: Fix `CommonSchemas.id` — Remove Permissive String Fallback

**Audit Finding:** H-VAL-1 (High)
**URD Alignment:** Cross-cutting — every API endpoint that accepts an entity ID

**What to change:**

In `common.validations.ts` line ~51, `CommonSchemas.id` is defined as:
```
z.string().uuid().or(z.string().min(1))
```

The `.or(z.string().min(1))` fallback means any non-empty string passes validation, completely negating the UUID constraint. This allows SQL fragments, path traversal strings, or arbitrary text to be accepted as entity IDs.

Change to strictly: `z.string().uuid()` — remove the `.or()` fallback entirely.

**Impact assessment:** Search the codebase for any ID values that are legitimately not UUIDs (e.g., better-auth session IDs, studentId codes). If any exist, create separate schemas for those specific cases rather than weakening the general-purpose ID schema.

**Acceptance criteria:**
- `CommonSchemas.id` only accepts valid UUID strings
- Non-UUID strings return a validation error
- No endpoint breaks because it was relying on non-UUID IDs passing through this schema

---

### Task 2.2: Fix Name Sanitizer — Support Unicode Characters

**Audit Finding:** H-VAL-4 (High)
**URD Alignment:** AUTH-001, AUTH-002 (Account creation — Egyptian students have Arabic names)

**What to change:**

In `common.validations.ts` lines ~21-26, `sanitizers.name` uses the regex `[^a-zA-Z\s-']` which strips all non-ASCII characters. For a system serving Egyptian students, Arabic names (e.g., "محمد النجار") are completely destroyed — the function returns an empty string.

Replace the regex with one that preserves Unicode letters. The sanitizer should:
- Trim whitespace
- Collapse multiple spaces to single space
- Remove control characters and symbols that are not letters, spaces, hyphens, or apostrophes
- Preserve Arabic, accented Latin, and other Unicode letter categories

Use a Unicode-aware character class such as `\p{L}` (Unicode letter category) with the `u` flag.

**Acceptance criteria:**
- `sanitizers.name("محمد النجار")` returns `"محمد النجار"` (unchanged)
- `sanitizers.name("José María")` returns `"José María"` (unchanged)
- `sanitizers.name("  John   O'Brien  ")` returns `"John O'Brien"` (trimmed + collapsed)
- `sanitizers.name("<script>alert(1)</script>")` returns `"scriptalert1script"` (symbols stripped, letters preserved) — **Note:** This is data sanitization for storage, NOT HTML safety. The name sanitizer prevents garbage characters in stored names; `escapeHtml` (Task 3.3) is the separate defense against XSS in rendered HTML email templates. These are different layers with different purposes.

---

### Task 2.3: Add Upper Bounds to Financial Amount Schemas

**Audit Finding:** H-VAL-2 (High)
**URD Alignment:** ESC-003, ESC-004, ESC-006, PAY-001 through PAY-005

**What to change:**

All financial amount fields currently use `.positive()` with no `.max()`. Add a reasonable upper bound to prevent absurdly large values from passing validation:

| File | Schema Field | Add |
|------|-------------|-----|
| `escrow.validations.ts` | `TransferEscrow.amount` (~line 53) | `.max(1_000_000)` |
| `escrow.validations.ts` | `RequestWithdrawal.amount` (~line 69) | `.max(1_000_000)` |
| `escrow.validations.ts` | `FulfillWithdrawal.releasedAmount` (~line 83) | `.max(1_000_000)` |
| `payment.validations.ts` | `InitiatePayment.escrowAmountToApply` (~line 94) | `.max(1_000_000)` |

The upper bound of 1,000,000 EGP is generous enough for any legitimate school subject payment while preventing obviously malicious values.

**Acceptance criteria:**
- Amounts above the upper bound return validation error
- Legitimate amounts (e.g., 5000 EGP for a subject) pass validation
- Zero and negative amounts are still rejected by existing `.positive()` constraint

---

### Task 2.4: Create Shared Report Validation Schemas

**Audit Finding:** H-VAL-3 (High)
**URD Alignment:** REP-001 through REP-009

**What to change:**

Four Zod schemas are currently defined inline in `apps/api/src/routes/report.routes.ts` (lines ~86-108):
- `SessionQuery`
- `RegistrationReportQuery`
- `RosterQuery`
- `FormatQuery`

Create a new file `packages/validations/src/report/report.validations.ts` and move these schemas there. Export them from the validations package index. Update `report.routes.ts` to import from `@repo/validations`.

This enables schema reuse by the frontend for type-safe query building and keeps all validation schemas in the centralized package.

**Acceptance criteria:**
- All four schemas live in `packages/validations/src/report/report.validations.ts`
- `report.routes.ts` imports them from `@repo/validations`
- Schemas are exported from the package's `index.ts`
- No behavioral change to the report endpoints

---

### Task 2.5: Add Server-Side Password Complexity Schema

**Audit Finding:** #11 (Critical)
**URD Alignment:** AUTH-001 ("Password meets security requirements: min 8 chars, 1 uppercase, 1 number")

**What to change:**

There is currently zero server-side password complexity enforcement. Create a `password` schema in `common.validations.ts` that enforces the URD requirements:
- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 number

This schema must be applied:
1. In the better-auth configuration (`apps/api/src/lib/auth.ts`) via the `password` config option if better-auth supports it
2. As a pre-validation in the sign-up route/service if better-auth doesn't support custom password validation natively

Also add the schema to the client-side sign-up forms for immediate user feedback.

**Acceptance criteria:**
- `"password"` (no uppercase, no number) → rejected
- `"Password"` (no number, only 8 chars) → rejected
- `"Password1"` → accepted
- `"P@ssw0rd123"` → accepted
- Server rejects weak passwords even if client-side validation is bypassed

---

## 5. Phase 3: Security Hardening

**Goal:** Close all security vulnerabilities — unauthorized access, payment fraud, data exposure, and injection attacks.

**Files primarily affected:**
- `apps/api/src/integrations/fawry.ts`
- `apps/api/src/integrations/paymob.ts`
- `apps/api/src/integrations/email.ts`
- `apps/api/src/index.ts`
- `apps/api/src/middleware/access-control.middleware.ts`
- `apps/api/src/routes/report.routes.ts`
- `apps/api/src/lib/auth.ts`
- `apps/web/app/admin/layout.tsx` (new file)
- `apps/web/app/admin/notifications/page.tsx`

---

### Task 3.1: Implement Webhook Signature Validation

**Audit Finding:** #2 (Critical — payment bypass)
**URD Alignment:** PAY-001 (Fawry), PAY-002 (Card/Paymob)

**What to change:**

Both `fawry.ts:67` and `paymob.ts:65` contain `return true;` with TODO comments. These must be replaced with actual cryptographic signature verification:

**Fawry (`fawry.ts`):**
- Fawry webhooks include a `messageSignature` field
- The signature is computed as: `SHA-256(merchantCode + merchantRefNum + paymentAmount + orderAmount + orderStatus + paymentMethod + fawryRefNumber + sharedSecureKey)`
- Compute the expected signature from the payload fields and the merchant's shared secret key
- Compare using a timing-safe comparison function
- **Important:** The exact concatenation order and field names MUST be verified against the current official Fawry API documentation before implementation. Gateway specifications change; do not rely solely on this plan's description of the algorithm.

**Paymob (`paymob.ts`):**
- Paymob sends an HMAC signature in the request
- The HMAC is computed from a specific concatenation of transaction fields using the HMAC secret key
- Verify using `crypto.timingSafeEqual` against the provided HMAC

**Environment variables to add** (in `env.ts`):
- `FAWRY_MERCHANT_CODE` — the Fawry merchant identifier
- `FAWRY_SECURE_KEY` — the shared secret for Fawry signature validation
- `PAYMOB_HMAC_SECRET` — the HMAC key for Paymob webhook verification

**Acceptance criteria:**
- Forged webhooks (with invalid or missing signatures) are rejected with 401
- Legitimate webhooks (with correct signatures) are processed normally
- Timing-safe comparison prevents timing attack side-channels

---

### Task 3.2: Fix Rate Limiter and Expand Coverage

**Audit Finding:** H-AUTH-1 (High — spoofable), H-AUTH-2 (High — missing coverage)
**URD Alignment:** Cross-cutting security

**What to change:**

**Fix the key generator** in `apps/api/src/index.ts` (lines ~43-52):

The current `keyGenerator` trusts `X-Forwarded-For` directly, which is client-controlled. Two options:
1. If behind a trusted reverse proxy (Render, Vercel, Cloudflare): configure the proxy to set a trusted header and only read that header
2. If not behind a trusted proxy: fall back to the TCP socket remote address (via `c.req.raw` or Hono's connection info)

At minimum, prefer `cf-connecting-ip` (Cloudflare-set, not client-spoofable) over `x-forwarded-for`, and fall back to the socket address.

**Add rate limiting to business endpoints:**

Create additional rate limiter instances and apply them:

| Endpoint Pattern | Recommended Limits | Rationale |
|-----------------|-------------------|-----------|
| `POST /v1/payments/*` | 10 requests / 15 min / user | Prevent payment spam |
| `POST /v1/registrations/*` | 20 requests / 15 min / user | Prevent registration spam |
| `POST /v1/escrow/*` | 10 requests / 15 min / user | Prevent transfer/withdrawal spam |
| `POST /v1/change-requests/*` | 15 requests / 15 min / user | Prevent swap/drop spam |

These should be keyed by the authenticated user ID (from session), not by IP, to prevent one user from consuming another's quota.

**Acceptance criteria:**
- Rate limiter key cannot be spoofed by setting client headers
- Payment, registration, and escrow endpoints are rate-limited
- Rate limits return 429 with appropriate `Retry-After` header
- Legitimate users are not impacted under normal usage

---

### Task 3.3: Prevent XSS in Email Templates

**Audit Finding:** #15 (Critical)
**URD Alignment:** NOT-001 through NOT-011 (all email notifications)

**What to change:**

All email templates in `apps/api/src/integrations/email.ts` interpolate user-controlled values directly into HTML without escaping. This enables HTML injection in emails (phishing links, spoofed UI, CSS attacks).

Create an `escapeHtml` utility function that escapes at minimum: `&`, `<`, `>`, `"`, `'`.

Apply `escapeHtml()` to every user-controlled value before HTML interpolation. The affected template variables include:

| Variable | Found in templates | Risk |
|---------|-------------------|------|
| `data.recipientName` | All templates (~line 142+) | User's display name |
| `data.comments` | Approval emails (~line 246) | Free-text input |
| `data.reason` | Drop/swap emails (~line 317) | Free-text input |
| `data.adminNotes` | Withdrawal emails (~line 422) | Admin free-text |
| `data.title` | Announcement (~line 515) | Admin-controlled but still dangerous |
| `data.body` | Announcement (~line 517) | Admin-controlled — highest risk (full HTML) |
| Subject names | Registration emails (~line 188) | From database but originally admin input |

**Do NOT escape** the static HTML structure — only the dynamic values injected into it.

**Acceptance criteria:**
- `<script>alert(1)</script>` in any user name renders as escaped text in the email, not executable
- `<a href="http://evil.com">Click here</a>` in comments renders as visible text, not a clickable link
- Normal names like "John O'Brien" render correctly (apostrophe escaped but visually fine in HTML)

---

### Task 3.4: Fix Bulk Announcement Email Privacy

**Audit Finding:** #14 (Critical — mass privacy breach)
**URD Alignment:** NOT-011 (Admin bulk announcements)

**What to change:**

In `notification.services.ts` lines ~797-804, `sendBulkAnnouncementEmail` receives an array of all recipient emails and passes it to `sendEmail` which puts them all in the `to:` field. Every recipient sees every other recipient's email address.

Two approaches:

**Option A (Recommended — Individual sends with batching):**
- Loop through recipients and send individual emails, batching with Resend's batch API if available
- Each recipient only sees their own address in the `to:` field
- Rate-limit to avoid hitting Resend's send limits

**Option B (BCC approach):**
- Send one email with the system address in `to:` and all recipients in `bcc:`
- Simpler but some email providers flag BCC-heavy emails as spam

**Acceptance criteria:**
- A bulk announcement to 100 users does NOT expose any recipient's email to other recipients
- Each recipient receives the announcement email
- The sender address is the system's configured `EMAIL_FROM`

---

### Task 3.5: Create Centralized Admin Layout Guard

**Audit Finding:** H-AUTH-6 (High — fragile pattern), H-AUTH-7 (High — unguarded page)
**URD Alignment:** AUTH-008 (Admin dashboard access control)

**What to change:**

There is no `layout.tsx` under `apps/web/app/admin/`. Each of the 8 admin pages must individually call `requireAdmin()`, and one page (`admin/notifications/page.tsx`) forgot to do so — leaving it completely unguarded.

Create `apps/web/app/admin/layout.tsx` that:
1. Calls `requireAdmin()` (from `~/lib/auth/session`)
2. Wraps all admin child pages
3. Optionally provides a shared admin navigation sidebar

After creating the layout:
- Remove individual `requireAdmin()` calls from each admin page (they become redundant)
- The previously unguarded `admin/notifications/page.tsx` is now automatically protected
- **Fix invalid metadata export:** `admin/notifications/page.tsx` currently has `'use client'` on line 1 AND `export const metadata = { title: 'Announcements — Admin' }` on line 25. In Next.js App Router, `metadata` exports are only valid in server components — this is an invalid combination. Move the `metadata` export to the new `admin/layout.tsx` (which is a server component) or create a thin server `page.tsx` wrapper that exports metadata and renders the client component as a child.

**Acceptance criteria:**
- Unauthenticated users visiting any `/admin/*` route are redirected to `/sign-in`
- Non-admin authenticated users visiting any `/admin/*` route are redirected to `/unauthorized`
- Adding a new admin page in the future automatically inherits the guard
- `admin/notifications/page.tsx` is no longer accessible without admin auth

---

### Task 3.6: Remove Role Information Leakage from 403 Responses

**Audit Finding:** H-AUTH-3 (High)
**URD Alignment:** Security best practice

**What to change:**

In `apps/api/src/middleware/access-control.middleware.ts` lines ~79-82, the 403 response includes `requiredRoles: allowedRoles` — telling the attacker exactly which role they need.

Remove `requiredRoles` from the response body. Return only:
```json
{ "error": "Forbidden" }
```

**Acceptance criteria:**
- 403 responses contain only `{ "error": "Forbidden" }` (or the standard error format)
- No internal authorization configuration is exposed
- Existing role-based access control behavior is unchanged

---

### Task 3.7: Add CSV Formula Injection Protection

**Audit Finding:** H-REP-1 (High)
**URD Alignment:** REP-001 through REP-009 (all CSV exports)

**What to change:**

The `toCSV` function in `apps/api/src/routes/report.routes.ts` (lines ~48-54) handles commas, quotes, and newlines but does not sanitize formula injection prefixes.

When a CSV cell value starts with `=`, `+`, `-`, `@`, `\t`, or `\r`, prepend it with a single quote (`'`) or tab character to prevent spreadsheet applications from interpreting it as a formula.

Apply this sanitization inside the existing `escape` function, before the comma/quote handling.

**Acceptance criteria:**
- A field containing `=CMD("calc")` is exported as `'=CMD("calc")` in the CSV
- A field containing `+1234567` is exported as `'+1234567`
- Normal numeric values like `5000` are unaffected
- Normal text values like `"John Smith"` are unaffected

---

### Task 3.8: Configure Authentication Security Features

**Audit Finding:** #10 (Critical — no email verification), #11 (Critical — no password complexity), #12 (Critical — no password reset)
**URD Alignment:** AUTH-001, AUTH-002 (email verification), AUTH-006 (password reset)

**What to change in this phase (configuration only — full implementation in Phase 12):**

In `apps/api/src/lib/auth.ts`, update the `emailAndPassword` configuration block to include:

1. **Email verification flag:** `requireEmailVerification: true` (or equivalent better-auth config)
2. **Password validation callback:** A callback that enforces the min 8 chars, 1 uppercase, 1 number rule from Task 2.5
3. **Send verification email callback:** Wire up to the email integration (Resend) to send verification links
4. **Send reset password email callback:** Wire up for password reset flow

**Note:** The actual email templates and password reset pages are built in Phase 12. This task establishes the auth configuration so the security infrastructure is in place.

**Incremental rollout risk:** Turning on `requireEmailVerification: true` in Phase 3 while Phase 12 builds the verification UX will lock out all new signups if the verification email callback only stubs. Two mitigations:
1. **Preferred:** Guard with an environment variable (e.g., `REQUIRE_EMAIL_VERIFICATION=true`) that defaults to `false` in development and is only set to `true` in production after Phase 12 is complete and the verification email template + confirmation page are deployed.
2. **Alternative:** Implement the verification email sending in this task (Phase 3) as a minimal functional callback (using the existing Resend integration), even before the full Phase 12 UX is built. Users would receive a working verification email with a basic link, even if the confirmation landing page is minimal.

**Acceptance criteria:**
- better-auth is configured with email verification requirement (behind a feature flag or env var until Phase 12 completes the UX)
- better-auth is configured with password complexity validation
- better-auth is configured with password reset capability
- If the email sending implementation is not yet complete (Phase 12), the callbacks should log and stub gracefully rather than crash
- New user signups are NOT broken in development or staging environments

---

## 6. Phase 4: Financial Integrity

**Goal:** Make every financial operation atomic and correct. Prevent money from appearing, disappearing, or being double-counted.

**Files primarily affected:**
- `apps/api/src/services/escrow.services.ts`
- `apps/api/src/services/swap.services.ts`
- `apps/api/src/services/payment.services.ts`
- `apps/api/src/routes/payment.routes.ts`

---

### Task 4.1: Add Transaction Parameter to Escrow Functions

**Audit Finding:** #4 (Critical), #5 (Critical)
**URD Alignment:** ESC-001 through ESC-007 (all escrow operations must be reliable)

**What to change:**

Both `creditEscrow` and `debitEscrow` in `escrow.services.ts` currently use the global `db` connection and have no way to participate in an external transaction. They must accept an optional transaction handle (`tx`) parameter.

Modify both function signatures to accept an optional `tx` parameter (the Drizzle transaction object). When `tx` is provided, use it for all database operations. When not provided, create an internal `db.transaction()` wrapper for atomicity.

Additionally, inside both functions, replace the read-compute-write pattern with an atomic SQL update:
- **Current (race-prone):** Read balance → compute `newBalance = balance + amount` in JS → write `newBalance`
- **Correct (atomic):** `UPDATE escrow SET balance = balance + $amount WHERE id = $id` using Drizzle's `sql` template tag

This eliminates the lost-update race condition entirely.

**Affected functions:**
- `creditEscrow` (line ~78): Add optional `tx` param, use atomic SQL update
- `debitEscrow` (line ~114): Add optional `tx` param, use atomic SQL update, use `balance - $amount` with a `RETURNING` check that the new balance is >= 0

**Acceptance criteria:**
- Both functions accept an optional transaction handle
- Balance updates use atomic SQL (`balance + amount`) not read-compute-write
- Two concurrent `creditEscrow` calls for the same student both succeed without lost updates
- `debitEscrow` rejects if the result would be negative (using the DB CHECK from Task 1.7 as a safety net)

---

### Task 4.2: Make Escrow Transfer Atomic

**Audit Finding:** #6 (Critical)
**URD Alignment:** ESC-003 (Parent transfers escrow between children)

**What to change:**

In `escrow.services.ts`, `transferEscrow` (line ~239) calls `debitEscrow` then `creditEscrow` sequentially without a transaction wrapper. If `creditEscrow` fails after `debitEscrow` succeeds, funds disappear.

Wrap the entire transfer in a single `db.transaction()`. Pass the `tx` handle (from Task 4.1) to both `debitEscrow` and `creditEscrow`:

```
db.transaction(async (tx) => {
  await debitEscrow({ ...debitParams }, tx);
  await creditEscrow({ ...creditParams }, tx);
});
```

If either operation fails, the entire transfer rolls back.

**Acceptance criteria:**
- A transfer either fully completes (both debit and credit) or fully rolls back
- If `creditEscrow` throws, the debit is rolled back — no funds are lost
- The escrow balances of both students are consistent after any error scenario

---

### Task 4.3: Fix `creditEscrow` Calls in Swap Services

**Audit Finding:** #4 (Critical)
**URD Alignment:** SWAP-001 through SWAP-004 (Drop/swap financial processing)

**What to change:**

In `swap.services.ts`, all three call sites invoke `creditEscrow` inside a `db.transaction()` callback but pass the global `db` connection instead of the transaction handle `tx`:

| Call Site | Line | Function |
|-----------|------|----------|
| `approveChangeRequest` | ~430 | Drop approval → escrow credit |
| `executeDirectDrop` | ~589 | Parent direct drop → escrow credit |
| `executeDirectSwap` | ~660 | Parent direct swap → escrow credit (if price difference is negative) |

After Task 4.1 adds the `tx` parameter to `creditEscrow`, update all three call sites to pass `tx` as the transaction handle.

**Acceptance criteria:**
- All `creditEscrow` calls in swap.services.ts use the transaction handle `tx`
- If the parent transaction rolls back, the escrow credit also rolls back
- No orphaned escrow credits after a failed swap/drop operation

---

### Task 4.4: Fix Dead Code in `approveChangeRequest`

**Audit Finding:** #3 (Critical — notifications silently lost, undefined `result`)
**URD Alignment:** SWAP-003 (Parent approves drop/swap), NOT-007, NOT-008

**What to change:**

In `swap.services.ts`, `approveChangeRequest` (line ~383) currently:
1. Uses `return db.transaction(...)` at line ~416 — the function returns immediately when the transaction completes
2. Lines ~461-498 contain notification code (NOT-007, NOT-008) that is unreachable
3. Line ~498 references an undefined variable `result`

Fix by:
1. Change `return db.transaction(...)` to `const result = await db.transaction(...)`
2. The notification code at lines ~461-498 is now reachable and executes after the transaction
3. The `return result` at line ~498 now correctly references the transaction result

**Compare with `executeDirectDrop`** (line ~569) which correctly uses `const result = await db.transaction(...)` — follow the same pattern.

**Acceptance criteria:**
- Notification code (NOT-007, NOT-008) executes after the transaction completes
- `result` is defined and contains the transaction return value
- The function returns the correct result to the caller
- Students receive notification when their change request is approved

---

### Task 4.5: Implement Withdrawal Fund Holding

**Audit Finding:** H-ESC-1 (High)
**URD Alignment:** ESC-004 (Parent requests withdrawal)

**What to change:**

Currently, `createWithdrawalRequest` (line ~320 in `escrow.services.ts`) only checks if the balance is sufficient but does not debit or hold the funds. This allows a student with 100 EGP to create two 100 EGP withdrawal requests simultaneously.

Two options:

**Option A (Recommended — Debit on creation, credit back on rejection):**
- When creating a withdrawal request, immediately debit the requested amount from the escrow balance
- If the admin rejects the request, credit the amount back
- If the admin fulfills, the funds are already debited — just update the request status

**Critical: This requires a paired change to `fulfillWithdrawalRequest`.**

Today, `fulfillWithdrawalRequest` (line ~409) calls `debitEscrow` at line ~440 when releasing funds. If Option A debits on creation, `fulfillWithdrawalRequest` must be refactored to **NOT** call `debitEscrow` again — it should only update `releasedAmount`, `status`, and `resolvedAt`/`resolvedBy`. Otherwise, the same funds are debited twice (once at request creation, once at fulfillment), corrupting the balance.

The lifecycle under Option A follows a state machine. The current code supports incremental partial fulfillment — `fulfillWithdrawalRequest` can be called multiple times, with `releasedAmount` accumulating across calls (lines 430-431: `newTotalReleased = currentReleased + data.releasedAmount`). This must be preserved.

**State machine:**
```
create (debit full requestedAmount)
  │
  ├──► partial fulfill (no debit, no credit — funds already held)
  │       │
  │       ├──► further partial fulfill (same — no debit, no credit)
  │       │       └──► ... repeat until cumulative = requestedAmount
  │       │
  │       └──► final fulfill (cumulative >= requestedAmount → status: fulfilled, no debit)
  │
  ├──► single full fulfill (same — no debit, status: fulfilled)
  │
  └──► rejection (credit back: requestedAmount − cumulativeReleased)
```

Key rules:
- **Creation:** `debitEscrow(requestedAmount)` — holds the full amount
- **Each partial/full fulfillment call:** NO `debitEscrow` — funds were already debited at creation. Only update `releasedAmount` (cumulative), `status`, and `resolvedAt`/`resolvedBy`
- **Rejection (only from `pending`):** `creditEscrow(requestedAmount)` — restores the full held amount (no partial fulfillment has occurred yet, since rejection is only allowed from `pending` status per current code at line ~511-513)
- **Do NOT credit back the unreleased remainder on each partial fulfillment step** — the remainder stays reserved until either the request is fully fulfilled or rejected

**Option B (Pending balance tracking):**
- Track a `pendingWithdrawal` amount on the escrow account
- `availableBalance = balance - pendingWithdrawal`
- Validation checks `availableBalance` instead of `balance`
- This requires a new column and more complex logic

With Option A, the existing `rejectWithdrawalRequest` (line ~499) must be updated to credit the funds back using `creditEscrow`, AND `fulfillWithdrawalRequest` must be updated to remove the `debitEscrow` call.

**Acceptance criteria:**
- Creating a withdrawal request reduces the available escrow balance
- A student cannot create withdrawal requests exceeding their total balance
- Rejected withdrawals restore the held funds
- Fulfilled withdrawals do not double-debit (funds already held)

---

### Task 4.6: Fix `inArray([])` Crash for Childless Parents

**Audit Finding:** H-ESC-2 (High)
**URD Alignment:** ESC-002 (Parent views children escrow balances)

**What to change:**

In `escrow.services.ts`, `getChildrenEscrowBalances` (line ~199) calls `inArray(e.studentId, children.map(c => c.id))` where `children` can be an empty array if the parent has no approved links. Drizzle's `inArray` with an empty array generates invalid SQL (`WHERE col IN ()`) which crashes.

Add an early-return guard: if `children` is empty, return an empty array immediately without executing the query.

**Acceptance criteria:**
- A parent with no linked children gets an empty array, not a database error
- A parent with linked children gets correct escrow balances
- No SQL syntax error in the logs

---

### Task 4.7: Fix Admin Notes Overwriting External Reference

**Audit Finding:** H-PAY-5 (High)
**URD Alignment:** PAY-007 (Admin confirms bank transfer)

**What to change:**

In `payment.routes.ts` line ~219, the route handler passes the admin's `notes` as the `externalRef` parameter to `confirmPayment`, which overwrites the original external reference (bank transfer reference number) with the admin's free-text notes.

Fix by:
1. Not passing `notes` as the `externalRef` argument
2. Either store admin notes in the `metadata` JSONB field, or add a dedicated `adminNotes` column to the payment table
3. Preserve the original `externalReference` value

**Acceptance criteria:**
- Admin confirmation notes are stored separately from the external reference
- The original bank transfer reference number (`IGCSE-...`) is preserved
- Admin notes are retrievable for audit/reporting purposes

---

### Task 4.8: Fix Fawry Webhook Non-PAID Status Handling

**Audit Finding:** H-PAY-1 (High)
**URD Alignment:** PAY-001 (Fawry payment — must handle expiry/cancellation)

**What to change:**

In `payment.routes.ts` lines ~252-263, the Fawry webhook handler for non-PAID statuses (EXPIRED, CANCELLED, UNPAID) only logs a message but does not call `failPayment`. This means failed Fawry payments remain in `pending` status forever.

Add logic to:
1. Look up the payment by `merchantRefNum` (which maps to the payment ID)
2. Call `paymentService.failPayment(paymentId)` to transition the payment to `failed` status
3. If escrow was applied, credit it back to the student's escrow balance

**Acceptance criteria:**
- Fawry EXPIRED webhooks transition the payment to `failed`
- Fawry CANCELLED webhooks transition the payment to `failed`
- Any escrow amount applied to the payment is refunded on failure
- The student's registration status is updated appropriately (back to `pending_payment` or notified)

---

## 7. Phase 5: Data Correctness & Query Fixes

**Goal:** Fix all wrong values, column names, and relation names that cause silent data loss or runtime crashes.

**Files primarily affected:**
- `apps/api/src/services/notification.services.ts`
- `apps/api/src/services/report.services.ts`
- `apps/api/src/services/swap.services.ts`
- `apps/api/src/services/registration.services.ts`
- `apps/web/app/register/register.client.tsx`

---

### Task 5.1: Fix `'accepted'` → `'approved'` Status Value

**Audit Finding:** #1 (Critical — breaks ALL parent notifications)
**URD Alignment:** NOT-003, NOT-006, NOT-008, NOT-010, REP-003, REP-007

**What to change:**

Three locations use the wrong status value `'accepted'` instead of `'approved'` for parent-student link lookups:

| File | Line | Context |
|------|------|---------|
| `notification.services.ts` | ~192 | `getLinkedParents()` — affects ALL parent notifications |
| `report.services.ts` | ~312 | Escrow report parent data |
| `report.services.ts` | ~489 | Student roster parent data |

Change `'accepted'` to `'approved'` in all three locations.

**Context:** The `parentStudentLink` table uses `'pending' | 'approved' | 'rejected'` as documented in the schema comments (line ~325-326) and consistently used in `link.services.ts`.

**Verification step:** Before closing this task, run a repo-wide case-sensitive search for the string `'accepted'` across all `.ts` and `.tsx` files (excluding `node_modules`, `dist`, `.git`). As of this writing, only 3 occurrences exist (verified by full-repo grep), but this search should be repeated to catch any that may be introduced by concurrent work on other phases.

**Acceptance criteria:**
- `getLinkedParents(studentId)` returns the actual linked parents (not an empty array)
- Parent notifications (NOT-003, NOT-006, NOT-008, NOT-010) are delivered to the correct parents
- Report queries return linked parent data instead of empty results
- Repo-wide search for `'accepted'` in the context of `parentStudentLink.status` returns zero results

---

### Task 5.2: Fix `subjectCode` → `code` Column References

**Audit Finding:** Part of #8 (Critical), H-SWAP-2 (High)
**URD Alignment:** SWAP-007 (View pending change requests), REG-006 (Registration history)

**What to change:**

The `subject` table has a column named `code` (schema.ts line ~366), but several queries reference `subjectCode` which does not exist:

| File | Lines | Context |
|------|-------|---------|
| `swap.services.ts` | ~735, ~739 | `getPendingChangeRequests` — subject columns |
| `swap.services.ts` | ~779, ~786 | `getPendingChangeRequestsForParent` — subject columns |
| `registration.services.ts` | ~641 | `getRegistrationHistory` — subject columns |

Change `subjectCode: true` to `code: true` in all five locations.

**Acceptance criteria:**
- `getPendingChangeRequests` returns results with the subject code
- `getPendingChangeRequestsForParent` returns results with the subject code
- `getRegistrationHistory` returns results with the subject code
- No Drizzle ORM runtime errors about unknown columns

---

### Task 5.3: Fix Report Service Column Mismatches

**Audit Finding:** #8 (Critical — 5 endpoints crash)
**URD Alignment:** REP-001, REP-002, REP-003

**What to change:**

| File | Line | Wrong | Correct |
|------|------|-------|---------|
| `report.services.ts` | ~243 | `payments` (relation) | `paymentRegistrations` |
| `report.services.ts` | ~246 | `totalAmount` (column) | `amount` |
| `report.services.ts` | ~303 | `studentId` (column on withdrawalRequest) | `escrowId` |
| `report.services.ts` | ~303 | `amount` (column on withdrawalRequest) | `requestedAmount` |

**Acceptance criteria:**
- Financial report (REP-002) loads without errors and returns payment data
- Escrow report (REP-003) loads without errors and returns withdrawal data
- Returned data matches the actual schema column names

---

### Task 5.4: Fix Report Service Relation Mismatches

**Audit Finding:** #8 (Critical — REP-001, REP-009 crash)
**URD Alignment:** REP-001 (Registration report), REP-009 (Pending approvals report)

**What to change:**

| File | Line | Wrong | Correct |
|------|------|-------|---------|
| `report.services.ts` | ~196 | `approvedBy` (in `with` clause) | `approvedByUser` |
| `report.services.ts` | ~538 | `approvedBy` (in `with` clause) | `approvedByUser` |

**Context:** `approvedBy` is a column name on the `registration` table (stores the user ID). `approvedByUser` is the Drizzle relation name (defined in schema.ts line ~945-948) that resolves to the actual user record.

**Acceptance criteria:**
- Registration report (REP-001) loads and includes the approver's name and role
- Pending approvals report (REP-009) loads and includes the approver's information
- No Drizzle runtime error about unknown relation names

---

### Task 5.5: Fix Core Subjects Not Included in Registration Submission

**Audit Finding:** #9 (Critical — Grade 10 June registration broken)
**URD Alignment:** CORE-003 (Grade 10 students MUST register all core subjects in June)

**What to change:**

In `apps/web/app/register/register.client.tsx`, the `toggleSubject` function (line ~173) returns early for core subjects, meaning they are never added to `selectedSubjectIds`. They appear visually selected (line ~377 uses `isSelected || isCore`) but are excluded from the form submission.

Fix by initializing `selectedSubjectIds` with all core subject IDs when:
- The student is Grade 10, AND
- The session type is `june`

This should happen when the available subjects data loads (in a `useEffect` or during data initialization). Core subjects should be added to the set automatically and the `toggleSubject` early-return should remain (preventing deselection).

**Acceptance criteria:**
- Grade 10 students in June sessions see core subjects pre-selected AND they are included in `selectedSubjectIds`
- The mutation submits core subject IDs along with elective selections
- Core subjects cannot be deselected (existing behavior preserved)
- Non-Grade-10 students and non-June sessions are unaffected

---

### Task 5.6: Fix Notification Type for Registration Rejection

**Audit Finding:** H-NOT-3 (High)
**URD Alignment:** NOT-004 (Student receives email when registration approved/rejected)

**What to change:**

In `notification.services.ts` line ~414, `notifyRegistrationDecision` always uses `'REGISTRATION_APPROVED'` as the notification type, even when `data.approved === false`.

Change to use a conditional:
- When `data.approved === true`: use `'REGISTRATION_APPROVED'`
- When `data.approved === false`: use `'REGISTRATION_REJECTED'`

Both types are defined in the schema notification type documentation (schema.ts line ~964-966).

**Acceptance criteria:**
- Approved registrations create notifications with type `REGISTRATION_APPROVED`
- Rejected registrations create notifications with type `REGISTRATION_REJECTED`
- Students can filter their notifications by approval vs rejection

---

### Task 5.7: Fix `useSuspenseQuery` Pattern in Registration Client

**Audit Finding:** H-REG-6 (Partially confirmed — anti-pattern)
**URD Alignment:** REG-001 (Student registration flow)

**What to change:**

In `register.client.tsx` line ~83, `useSuspenseQuery` is used with `enabled: false` for non-parent users. While this doesn't crash at runtime with TanStack Query v5.90, it violates the suspense contract (suspense queries guarantee `data` is always defined).

Replace `useSuspenseQuery` with `useQuery` for the children query. The destructured default `= []` already handles the undefined case, so this is a straightforward swap.

**Acceptance criteria:**
- Student users see the registration page without errors
- Parent users still see the children selector
- No TypeScript type errors introduced

---

## 8. Phase 6: Registration & Session Lifecycle Completion

**Goal:** Close all gaps in the core registration and session management workflows — race conditions, missing validations, and incomplete lifecycle actions.

**Files primarily affected:**
- `apps/api/src/services/registration.services.ts`
- `apps/api/src/services/session.services.ts`
- `apps/api/src/routes/session.routes.ts`

---

### Task 6.1: Add Session Active Check to Parent Approval

**Audit Finding:** H-REG-1 (High)
**URD Alignment:** REG-002 (Parent approves request), REG-005 (Cannot register when window closed)

**What to change:**

In `registration.services.ts`, `approveRegistrationRequest` (line ~365) approves registrations without checking if the session is still active. A parent could approve a request days after the registration window closed.

Add a session lookup before processing approvals:
1. Fetch the session ID from the first registration being approved
2. Query the `registrationSession` table for that session
3. If `session.status !== 'active'`, throw an error: "Registration window is closed"

**Compare with** `createRegistrationRequest` (line ~220) and `createDirectRegistration` (line ~311), both of which already perform this check.

**Acceptance criteria:**
- Approving a registration for a closed session returns an error
- Approving a registration for an active session succeeds
- The error message clearly indicates the window is closed

---

### Task 6.2: Scope Registration Updates to Current Status

**Audit Finding:** H-REG-2 (High — race condition)
**URD Alignment:** REG-002 (Approval flow integrity)

**What to change:**

In `registration.services.ts`:
- `approveRegistrationRequest` (lines ~392-402): The UPDATE WHERE clause only filters by `inArray(registration.id, data.registrationIds)` — it does not include `eq(registration.status, 'pending_approval')`
- `rejectRegistrationRequest` (lines ~463-473): Same problem

Add `eq(registration.status, 'pending_approval')` to both UPDATE WHERE clauses. Then check the number of returned rows — if fewer rows were updated than expected, some registrations were already processed (by a concurrent request) and the response should indicate this.

**Acceptance criteria:**
- Double-clicking "Approve" does not transition an already-approved registration
- A concurrent rejection prevents a later approval from succeeding on the same registration
- The response indicates how many registrations were actually updated vs. how many were requested

---

### Task 6.3: Add Notification for Parent Direct Registration

**Audit Finding:** H-REG-4 (High)
**URD Alignment:** REG-003 ("Child receives email notification of registration")

**What to change:**

`createDirectRegistration` in `registration.services.ts` (line ~295) creates registrations for a child but sends no notification to the student. The URD explicitly requires: "Child receives email notification of registration."

After the registrations are created and returned, call an appropriate notification function to inform the student. This can reuse `notifyRegistrationRequestReceived` (adapted for the direct-registration case) or create a new `notifyDirectRegistrationCreated` function.

The notification should include:
- Which subjects were registered
- Who initiated the registration (parent name)
- Total cost
- That payment is pending

**Acceptance criteria:**
- Student receives an in-app notification when their parent directly registers subjects for them
- Student receives an email about the direct registration
- Notification includes subject details and cost

---

### Task 6.4: Add Student Validation to Admin Override

**Audit Finding:** H-REG-5 (High)
**URD Alignment:** REG-007 (Admin override for exceptional cases)

**What to change:**

In `registration.services.ts`, `adminOverrideApproval` (line ~508) never verifies that `data.studentId` references an actual user record, nor does it check if the student has graduated.

Add two checks before creating registrations:
1. Query `db.query.user.findFirst({ where: eq(user.id, data.studentId) })` — throw if null ("Student not found")
2. If the student exists, check if their grade is null (graduated) — throw if so ("Cannot register for graduated student")

**Compare with** `createRegistrationRequest` (line ~212) and `createDirectRegistration` (line ~303), both of which call `isGraduated()`.

**Acceptance criteria:**
- Admin override for a non-existent student ID returns "Student not found"
- Admin override for a graduated student returns appropriate error
- Admin override for a valid, non-graduated student succeeds as before

---

### Task 6.5: Store Close Reason from Session Close

**Audit Finding:** H-SES-4 (High)
**URD Alignment:** SES-004 (Admin manually closes with confirmation)

**What to change:**

This task depends on Task 1.5 (which adds the `closeReason` column).

1. In `apps/api/src/routes/session.routes.ts`, the close route handler (~line 228-255) must extract the validated JSON body using `c.req.valid('json')` to get the `reason` field
2. Pass `reason` to the `closeSession` service function
3. In `session.services.ts`, update `closeSession` (line ~271) to accept and store the `closeReason` in the UPDATE statement

**Acceptance criteria:**
- Admin can provide a reason when closing a session
- The reason is stored in the `closeReason` column
- The reason is optional (auto-close has no reason)
- The reason is visible in audit/admin views

---

### Task 6.6: Fix editHistory TOCTOU Race Condition

**Audit Finding:** H-SES-3 (High)
**URD Alignment:** SES-003 (Admin edits active session — changes logged)

**What to change:**

In `session.services.ts`, `extendActiveSessionDeadline` (line ~194) reads the session, appends to `editHistory` in JavaScript, then writes the array back. Two concurrent edits overwrite each other.

Replace with an atomic SQL-level JSONB append:
- Use PostgreSQL's `jsonb_set` or `|| jsonb_build_array(...)` operator via Drizzle's `sql` template tag
- This way the database itself handles the append atomically, preventing TOCTOU

Alternatively, wrap the read-modify-write in a serializable transaction with `SELECT ... FOR UPDATE` to lock the row during the operation.

**Acceptance criteria:**
- Two concurrent deadline extensions both have their entries recorded in `editHistory`
- No edit history entries are silently lost
- The most recent endDate is the one that persists

---

### Task 6.7: Trigger Notifications for Immediately-Active Sessions

**Audit Finding:** H-SES-5 (High)
**URD Alignment:** NOT-001 (Email when registration window opens)

**What to change:**

In `session.services.ts`, `createSession` (line ~130) resolves the initial status based on `startDate`. If `startDate` is in the past, the session starts as `'active'` immediately. But neither the service function nor its route handler calls `notifySessionOpened`.

After creating a session, check `initialStatus`:
- If `'active'`, call `notifySessionOpened` with the session details
- If `'draft'`, do nothing (notifications will fire when the session-closer activates it)

**Acceptance criteria:**
- Creating a session with a past start date immediately notifies all students and parents
- Creating a session with a future start date does not send premature notifications
- The notification includes session name, type, and deadline

---

### Task 6.8: Add Re-Validation of Subject Availability at Swap Approval

**Audit Finding:** H-SWAP-4 (High)
**URD Alignment:** SWAP-003 (Parent approves swap — subject must still be valid)

**What to change:**

In `swap.services.ts`, `approveChangeRequest` (line ~383) processes a swap using data captured at request creation time (`cr.newSubjectId`, `cr.priceAtRequest`) without re-verifying that:
- The new subject is still active
- The student hasn't already registered for the new subject through another path
- The session is still active

Before executing the swap within the transaction, add validation:
1. Query the new subject — verify `isActive === true`
2. Check for conflicting registration — verify the student has no existing registration for `cr.newSubjectId` in the same session
3. Check session status — verify the session is still `'active'`

If any validation fails, reject the change request automatically with an appropriate reason rather than creating invalid data.

**Acceptance criteria:**
- Approving a swap for a deactivated subject returns an error
- Approving a swap for a subject the student already registered for returns an error
- Approving a swap after the session closed returns an error
- Normal swap approvals are unaffected

---

### Task 6.9: Fix Parent Authorization on Change Request GET

**Audit Finding:** H-SWAP-1 (High)
**URD Alignment:** SWAP-007 (Student views pending change requests — access control)

**What to change:**

In `swap.routes.ts` lines ~208-225, the `GET /:id` handler checks student ownership but allows any authenticated parent to view any change request without verifying the parent-student link.

Add parent authorization:
- When `user.role === 'parent'`, look up the change request's student ID from `cr.registration.studentId` (this is the authoritative source for whose registration it is — `cr.requestedBy` can be the parent in parent-initiated flows, so it is NOT a reliable student identifier)
- Call `validateParentStudentLink(user.id, studentId)` to verify the parent is linked to this student
- If not linked, return 403

**Compare with** `approveChangeRequest` service (line ~406) which correctly calls `validateParentStudentLink`.

**Acceptance criteria:**
- A parent can view change requests for their linked children
- A parent cannot view change requests for unlinked students
- Students can only view their own change requests (existing behavior)
- Admins can view any change request (if applicable)

---

## 9. Phase 7: Notification System Overhaul

**Goal:** Fix the notification system so all URD-required notifications are delivered correctly to the right recipients.

**Depends on:** Phase 5 (the `'accepted'` → `'approved'` fix that unbreaks `getLinkedParents`)

**Files primarily affected:**
- `apps/api/src/services/notification.services.ts`
- `apps/api/src/integrations/email.ts`
- `apps/api/src/jobs/session-closer.ts`

---

### Task 7.1: Implement NOT-002 — 24-Hour Closing Reminder Scheduler

**Audit Finding:** H-NOT-1 (High)
**URD Alignment:** NOT-002 ("Sent 24 hours before window closes")

**What to change:**

The `notifySessionClosingSoon` function exists in `notification.services.ts` but is never called. No scheduler triggers it.

Add a check to the existing session-closer job (`apps/api/src/jobs/session-closer.ts`):
- In addition to closing expired sessions and activating draft sessions, check for active sessions whose `endDate` is within the next 24 hours
- For each such session that hasn't already been reminded (track this — e.g., a `reminderSentAt` column on `registrationSession`, or a flag in `editHistory`, or a separate tracking mechanism), call `notifySessionClosingSoon`

**Implementation detail:** To avoid sending the reminder multiple times (the job runs every minute), either:
- Add a `reminderSentAt` timestamp column to `registrationSession` and only send if null
- Or track sent reminders in the notification table and check before sending

**Acceptance criteria:**
- Sessions closing within 24 hours trigger the reminder notification once
- The reminder is sent to all active students and parents
- Sessions that already received the reminder are not re-notified
- Sessions that close before 24 hours (e.g., created with only 12 hours until close) still receive the reminder when they enter the 24-hour window

---

### Task 7.2: Include Parents in Session Opened Email

**Audit Finding:** H-NOT-2 (High)
**URD Alignment:** NOT-001 ("Sent to all active students and parents")

**What to change:**

In `notification.services.ts`, `notifySessionOpened` (line ~295-311), the email blast query filters by `eq(user.role, 'student')`, excluding parents entirely.

Change the filter to include both roles:
- Use `inArray(user.role, ['student', 'parent'])` or `or(eq(user.role, 'student'), eq(user.role, 'parent'))`

**Note:** The in-app notification (lines ~286-292) already includes both students and parents via `allUserIds`. Only the email sending is broken.

**Acceptance criteria:**
- Both students AND parents receive the session-opened email
- Email content is appropriate for both audiences
- In-app notification behavior is unchanged

---

### Task 7.3: Create and Send Session Closure Notifications

**Audit Finding:** H-SES-2 (High)
**URD Alignment:** SES-006 ("Email notification sent to all users" on closure)

**What to change:**

Neither manual close nor auto-close sends closure notifications. Create a `notifySessionClosed` function in `notification.services.ts` that:
- Sends in-app notifications to all students and parents
- Sends email notifications to all students and parents
- Includes the session name, type, and closure reason (if manually closed)

Call `notifySessionClosed`:
1. In `session-closer.ts` after auto-closing sessions
2. In the manual close route handler (or `closeSession` service) after closing

**Acceptance criteria:**
- Auto-closed sessions trigger closure notifications to all users
- Manually-closed sessions trigger closure notifications to all users
- The notification includes the session name and (for manual close) the reason

---

### Task 7.4: Create Withdrawal Creation and Rejection Notifications

**Audit Finding:** H-ESC-5 (High)
**URD Alignment:** ESC-004 ("Parent and child notified when request is received")

**What to change:**

Currently, only `fulfillWithdrawalRequest` sends a notification (`notifyWithdrawalFulfilled`). The following scenarios send no notification:

1. **Withdrawal creation:** When a parent creates a withdrawal request, the student should be notified
2. **Withdrawal rejection:** When admin rejects a withdrawal, both parent and student should be notified

Create two new notification functions:
- `notifyWithdrawalRequested(data)` — notify the student that their parent requested a withdrawal
- `notifyWithdrawalRejected(data)` — notify the parent (and student) that the withdrawal was rejected

Call them from:
- `createWithdrawalRequest` in `escrow.services.ts` → `notifyWithdrawalRequested`
- `rejectWithdrawalRequest` in `escrow.services.ts` → `notifyWithdrawalRejected`

Create corresponding email templates in `email.ts`.

**Acceptance criteria:**
- Students are notified when a parent requests a withdrawal from their escrow
- Parents and students are notified when a withdrawal is rejected
- Notifications include the amount and reason/notes

---

### Task 7.5: Update `emailSentAt` After Sending

**Audit Finding:** H-NOT-4 (High)
**URD Alignment:** Cross-cutting notification tracking

**What to change:**

The `emailSentAt` column exists in the `notification` schema (line ~997) but is never set. The `fireEmail` wrapper (line ~252-258 in `notification.services.ts`) sends the email but does not update the notification record.

After a successful email send inside `fireEmail`:
1. Query the notification records that were just created (by the `createNotification` or `createBulkNotifications` call that preceded `fireEmail`)
2. Update their `emailSentAt` to the current timestamp

**Challenge:** `fireEmail` is a fire-and-forget wrapper. It needs access to the notification IDs. Options:
- Return notification IDs from `createNotification`/`createBulkNotifications` and pass them to `fireEmail`
- Or have `fireEmail` accept notification IDs and update them after sending

**Bulk paths must be first-class, not an afterthought.** `createBulkNotifications` creates many rows in a single call. The concrete pattern should be:
1. `createBulkNotifications` returns the array of created notification IDs
2. These IDs are passed to the email-sending path
3. After successful email sends, a single batch UPDATE sets `emailSentAt` for all IDs: `UPDATE notification SET email_sent_at = NOW() WHERE id = ANY($ids)`
4. If individual emails fail within a batch, only the successful IDs are updated

**Acceptance criteria:**
- Notifications that successfully had emails sent have a non-null `emailSentAt`
- Notifications where email sending failed or was skipped keep `emailSentAt` as null
- Admin/user notification views can distinguish between "email sent" and "email pending"

---

### Task 7.6: Add Missing Notification for Manual Close Pending Registrations

**Audit Finding:** H-SES-1 (High)
**URD Alignment:** SES-004 ("All pending registrations are finalized, students/parents notified of early closure")

**What to change:**

This task depends on Task 7.3 (closure notifications) and Task 6.5 (close reason).

When a session is manually closed, in addition to the general closure notification:
1. Query all registrations in `pending_approval` or `pending_payment` status for that session
2. Transition them to an appropriate terminal status (e.g., `rejected` for pending_approval, or a new status like `expired`)
3. Notify each affected student (and their parents) individually about their unfinished registration being cancelled due to early session closure

**Acceptance criteria:**
- Pending registrations are finalized (not left in limbo) when a session is manually closed
- Affected students/parents receive individual notifications about their cancelled registrations
- The general closure notification is still sent to all users

---

### Task 7.7: Add Notification for Parent Direct Drop/Swap

**Audit Finding:** Related to H-REG-4 (extending the pattern)
**URD Alignment:** SWAP-004 ("Child receives email notification of changes")

**What to change:**

Verify that `executeDirectDrop` and `executeDirectSwap` in `swap.services.ts` send notifications to the student. Given that Task 4.4 fixes the dead code in `approveChangeRequest`, ensure that the direct-action functions also call notification functions for:
- Student notification about the drop/swap (NOT-007 equivalent)
- Parent escrow balance change notification (NOT-008) — which fires from within the escrow credit function

**Acceptance criteria:**
- Students are notified when a parent directly drops a subject for them
- Students are notified when a parent directly swaps a subject for them
- Escrow balance change notifications fire for the parent

---

### Task 7.8: Create Notification for Registration Payment Confirmation

**Audit Finding:** Cross-reference with PAY-006 (receipt), NOT-005
**URD Alignment:** NOT-005 ("Parent receives email confirming payment")

**What to change:**

Verify that when a payment is confirmed (via webhook or admin action), a notification is sent to:
1. The parent (payment receipt — NOT-005)
2. The student (registration confirmed — NOT-004 equivalent for post-payment)

If these notifications are not being triggered from `confirmPayment` in `payment.services.ts`, add calls to appropriate notification functions.

**Acceptance criteria:**
- Parent receives payment confirmation notification with subject list, amount, and method
- Student receives registration confirmation notification
- Both in-app and email notifications are sent

---

### Task 7.9: Fix Bulk Announcement Duplicate Email in `to:` Field

**Note:** This is the implementation of Task 3.4 — listed here for notification phase completeness. See Task 3.4 for details.

---

## 10. Phase 8: Audit Trail Completion

**Goal:** Ensure every state-changing operation in the system is logged for full chain-of-custody tracking.

**URD Alignment:** REP-006 ("Chronological log of all transactions — includes user who initiated, approver, action, timestamp, details — shows full chain: Requested by → Approved by → Processed by")

**Files primarily affected:**
- `apps/api/src/routes/registration.routes.ts`
- `apps/api/src/routes/payment.routes.ts`
- `apps/api/src/routes/swap.routes.ts`
- `apps/api/src/routes/escrow.routes.ts`
- `apps/api/src/routes/notification.routes.ts`
- `apps/api/src/routes/user.routes.ts`

---

### Task 8.1: Add Audit Logging to Registration Operations

**Audit Finding:** H-REG-3 (High — 4 of 5 operations unlogged)

**What to add:**

| Route | Action Type | Where |
|-------|------------|-------|
| `POST /registrations/request` | `REGISTRATION_REQUESTED` | After successful creation |
| `POST /registrations/direct` | `REGISTRATION_DIRECT` | After successful creation |
| `PUT /registrations/approve` | `REGISTRATION_APPROVED` | After successful approval |
| `PUT /registrations/reject` | `REGISTRATION_REJECTED` | After successful rejection |

The existing `POST /registrations/admin-override` already logs `REGISTRATION_ADMIN_OVERRIDE`.

Each `logAction` call should include:
- `userId`: The acting user's ID
- `entityType`: `'registration'`
- `entityId`: The registration ID(s)
- Context from `extractAuditContext(c)` (IP, user-agent)

**Acceptance criteria:**
- All five registration operations appear in the audit log
- Each entry includes the acting user, entity, and request context
- The audit trail supports the "Requested by → Approved by" chain

---

### Task 8.2: Add Audit Logging to Payment Operations

**Audit Finding:** H-PAY-4 (Partially confirmed — initiation and webhooks unlogged)

**What to add:**

| Route | Action Type | Where |
|-------|------------|-------|
| `POST /payments/initiate` | `PAYMENT_INITIATED` | After successful initiation |
| Fawry webhook handler (success path) | `PAYMENT_CONFIRMED` | After `confirmPayment` succeeds |
| Fawry webhook handler (failure path) | `PAYMENT_FAILED` | After `failPayment` (from Task 4.8) |
| Paymob webhook handler (success path) | `PAYMENT_CONFIRMED` | After `confirmPayment` succeeds |
| Paymob webhook handler (failure path) | `PAYMENT_FAILED` | After `failPayment` |

**Note:** Webhook audit logs should use `null` for userId (system-initiated) and include the payment provider and reference in the audit data.

The existing `POST /payments/:id/confirm` already logs `PAYMENT_CONFIRMED`.

**Acceptance criteria:**
- Payment initiation is logged with parent ID and payment method
- Webhook confirmations are logged with provider details
- Payment failures are logged with failure reason

---

### Task 8.3: Add Audit Logging to Swap/Change Operations

**Audit Finding:** H-SWAP-3 (High — 4 of 6 operations unlogged)

**What to add:**

| Route | Action Type | Where |
|-------|------------|-------|
| `POST /:id/request-drop` | `CHANGE_REQUEST_CREATED` | After drop request created |
| `POST /:id/request-swap` | `CHANGE_REQUEST_CREATED` | After swap request created |
| `POST /:id/drop` | `DIRECT_DROP_EXECUTED` | After direct drop executed |
| `POST /:id/swap` | `DIRECT_SWAP_EXECUTED` | After direct swap executed |

The existing `PUT /:id/approve` and `PUT /:id/reject` already log `CHANGE_REQUEST_APPROVED` and `CHANGE_REQUEST_REJECTED`.

**Acceptance criteria:**
- All six swap/change operations appear in the audit log
- Drop and swap requests are distinguishable in the log
- Direct parent actions vs. student requests are distinguishable

---

### Task 8.4: Add Audit Logging to Escrow Operations

**Audit Finding:** H-ESC-3 (High — zero audit logging)

**What to add:**

| Route | Action Type | Where |
|-------|------------|-------|
| `POST /escrow/transfer` | `ESCROW_TRANSFER` | After transfer completes |
| `POST /escrow/withdraw` | `WITHDRAWAL_REQUESTED` | After withdrawal request created |
| `POST /escrow/withdrawals/:id/fulfill` | `WITHDRAWAL_FULFILLED` | After fulfillment |
| `POST /escrow/withdrawals/:id/reject` | `WITHDRAWAL_REJECTED` | After rejection |

Import `logAction` and `extractAuditContext` into `escrow.routes.ts` (currently not imported).

**Acceptance criteria:**
- Every escrow transfer is logged with from/to students and amount
- Every withdrawal lifecycle event is logged
- Financial audit trail is complete

---

### Task 8.5: Add Audit Logging to User and Notification Operations

**Audit Finding:** H-REP-2 (16 actions unlogged)

**What to add:**

| Route | Action Type | Where |
|-------|------------|-------|
| `PUT /users/me` | `USER_UPDATED` | After profile update |
| `POST /notifications/admin/announce` | `ADMIN_ANNOUNCEMENT` | After announcement sent |

Also add `REGISTRATION_CONFIRMED` logging inside `confirmPayment` in `payment.services.ts` — when payment confirmation transitions registrations to `confirmed` status.

**Acceptance criteria:**
- Profile updates are logged
- Admin announcements are logged with recipient scope
- Registration confirmation (the "Processed by system" step) is logged, completing the chain

---

### Task 8.6: Verify Complete Audit Coverage

After completing Tasks 8.1–8.5, all 30 defined audit action types should have at least one `logAction` call site:

**Already logging (14):** SUBJECT_CREATED, SUBJECT_UPDATED, SUBJECT_DEACTIVATED, SUBJECT_ACTIVATED, SUBJECT_CORE_UPDATED, SESSION_CREATED, SESSION_UPDATED, SESSION_ACTIVATED, SESSION_CLOSED, REGISTRATION_ADMIN_OVERRIDE, PAYMENT_CONFIRMED (admin), CHANGE_REQUEST_APPROVED, CHANGE_REQUEST_REJECTED, USER_GRADE_CHANGED

**Added in this phase (16):** REGISTRATION_REQUESTED, REGISTRATION_DIRECT, REGISTRATION_APPROVED, REGISTRATION_REJECTED, REGISTRATION_CONFIRMED, PAYMENT_INITIATED, PAYMENT_FAILED, CHANGE_REQUEST_CREATED, DIRECT_DROP_EXECUTED, DIRECT_SWAP_EXECUTED, ESCROW_TRANSFER, WITHDRAWAL_REQUESTED, WITHDRAWAL_FULFILLED, WITHDRAWAL_REJECTED, USER_UPDATED, ADMIN_ANNOUNCEMENT

**Acceptance criteria:**
- A search for `logAction(` across the codebase returns at least one call for each of the 30 action types
- No action type enum value is orphaned (defined but never used)

---

## 11. Phase 9: Grade Progression & Session Close Fixes

**Goal:** Make grade progression atomic, triggered correctly, and performant.

**Files primarily affected:**
- `apps/api/src/services/grade.services.ts`
- `apps/api/src/routes/session.routes.ts`
- `apps/api/src/jobs/session-closer.ts`

---

### Task 9.1: Wrap Grade Progression in a Database Transaction

**Audit Finding:** H-GRADE-3 (High)
**URD Alignment:** GRADE-001 (System auto-progresses grades)

**What to change:**

In `grade.services.ts`, `progressGrades` (line ~54) iterates over students and issues individual UPDATE statements without a transaction. If the process crashes mid-loop, some students are progressed and others are not.

Wrap the entire function body in `db.transaction(async (tx) => { ... })`. Use `tx` for all UPDATE operations within the loop.

**Acceptance criteria:**
- Either all eligible students are progressed, or none are (atomic)
- A crash or error mid-progression rolls back all changes
- Grade progression logs are also part of the transaction (or fire-and-forget after commit)

---

### Task 9.2: Optimize Grade Progression with Batch Updates

**Audit Finding:** H-GRADE-2 (High — N+1 queries)
**URD Alignment:** GRADE-001 (Performance for large student bodies)

**What to change:**

Currently, `progressGrades` issues one UPDATE per student (line ~82) plus one audit INSERT per student (line ~99). For 100 students, this is 200+ queries.

Optimize by:
1. Group students by their current grade level
2. Issue one batch UPDATE per grade transition: e.g., `UPDATE user SET grade = 11 WHERE grade = 10 AND role = 'student'`
3. Issue one batch INSERT for audit logs (using `db.insert(auditLog).values([...array])`
4. Fire notifications in bulk (using `createBulkNotifications`)

**Acceptance criteria:**
- Grade progression for N students uses O(1) or O(grades) database queries instead of O(N)
- Audit logs are still created for each individual student transition
- Notifications are still sent to each affected student

---

### Task 9.3: Trigger Grade Progression on Manual Session Close

**Audit Finding:** H-GRADE-1 (High)
**URD Alignment:** GRADE-001 (Auto-progression after session closes — includes manual close)

**What to change:**

In `apps/api/src/routes/session.routes.ts` (~line 245-254), the manual close handler calls `closeSession` and `logAction` but does NOT call `progressGrades`.

After `closeSession` succeeds, call `progressGrades(closedSession.sessionType)` — the same way the auto-close path in `session-closer.ts` does.

**Acceptance criteria:**
- Manually closing a November session progresses Grade 10 → 11 and Grade 12 → Graduated
- Manually closing a June session progresses Grade 11 → 12
- The progression runs the same logic as auto-close (same function, same rules)

---

### Task 9.4: Add `reminderSentAt` Tracking for NOT-002

**Note:** This supports Task 7.1. If the reminder tracking approach requires a schema change, handle it here alongside the grade progression schema work.

If using a column approach: add `reminderSentAt` (nullable timestamp) to `registrationSession`.
If using a notification-table approach: no schema change needed — query notifications for `SESSION_CLOSING_SOON` type and the session ID.

---

## 12. Phase 10: Report System Fixes & Completion

**Goal:** Make all report endpoints functional, safe, and usable.

**Depends on:** Phase 5 (column/relation fixes), Phase 8 (audit trail populated)

**Files primarily affected:**
- `apps/api/src/services/report.services.ts`
- `apps/api/src/routes/report.routes.ts`
- `apps/web/app/admin/reports/reports.client.tsx`

---

### Task 10.1: Add Pagination to All Report Endpoints

**Audit Finding:** H-REP-3 (High)
**URD Alignment:** REP-001 through REP-009 (all reports must handle large datasets)

**What to change:**

None of the 8 report endpoints accept pagination parameters. All service functions call `findMany` without `limit` or `offset`.

For each report:
1. Add `limit` (default: 500, max: 5000) and `offset` (default: 0) to the query schemas (created in Task 2.4)
2. Apply these parameters in the service layer using Drizzle's `.limit()` and `.offset()`
3. Return total count alongside the data for frontend pagination
4. The audit log endpoint already has pagination — use the same pattern

**Acceptance criteria:**
- All report endpoints accept `limit` and `offset` query parameters
- Default limits prevent unbounded result sets
- Response includes `total` count for frontend pagination controls
- Existing report functionality is unchanged for small datasets

---

### Task 10.2: Fix CSV Download URL

**Audit Finding:** H-REP-4 (High — CSV downloads return 404)
**URD Alignment:** REP-001 through REP-009 (CSV export)

**What to change:**

In `apps/web/app/admin/reports/reports.client.tsx` line ~46, the CSV URL is built as `/api/v1/reports/${reportId}` — a relative path that hits the Next.js server, not the API server.

Fix by addressing both the URL and the authentication challenge:

**URL fix:** Replace the hardcoded `/api/v1/reports/...` prefix with the correct API origin.

**Authentication challenge:** Report routes require admin session auth (cookie-based via Better Auth). The current download uses a bare `<a href="...">` tag. If the API is on a different origin than the web app, the browser will NOT send session cookies with the `<a>` navigation (cross-origin cookie policy). Three options:

- **Option A (Recommended):** Use `fetch()` with `credentials: 'include'`, receive the CSV as a blob, and create a temporary `URL.createObjectURL(blob)` download link. This sends cookies cross-origin (if CORS allows credentials, which it does — the API has `credentials: true`).
- **Option B:** Implement a signed/temporary URL mechanism — the client first calls an API endpoint that returns a one-time download token, then uses that token in the `<a>` href as a query parameter (no cookie needed).
- **Option C:** Proxy API requests through Next.js rewrites so everything is same-origin. The Next.js config has commented-out rewrites — re-enable them for the reports path.

**Acceptance criteria:**
- CSV download links point to the correct API server
- CSV files download successfully in both development and production
- JSON report viewing is unaffected

---

### Task 10.3: Replace Session ID Text Input with Dropdown Selector

**Audit Finding:** Medium (UX — requires manual UUID pasting)
**URD Alignment:** REP-001, REP-002, REP-004, REP-005 (session-scoped reports)

**What to change:**

In `reports.client.tsx` (~line 274-287), reports that need a session ID show a raw text input with a UUID placeholder. Replace this with:

1. Fetch available sessions from the API on component mount (`GET /v1/sessions`)
2. Render a `<select>` dropdown showing session name and type (e.g., "June 2026 (active)", "November 2025 (closed)")
3. On selection, set the session ID from the selected session's ID
4. Sort sessions by date (most recent first)

**Acceptance criteria:**
- Admins can select sessions from a dropdown, not by pasting UUIDs
- The dropdown shows session name, type, and status
- Selecting a session populates the session ID correctly
- Reports generate correctly with the selected session

---

### Task 10.4: Verify All Column/Relation Fixes from Phase 5

After Phase 5 tasks 5.1–5.4 are complete, verify that all report endpoints work:

| Report | Endpoint | Previously Crashed? | Dependencies |
|--------|----------|--------------------|----|
| REP-001 Registration | `/v1/reports/registrations` | Yes (`approvedBy` relation) | Task 5.4 |
| REP-002 Financial | `/v1/reports/financial` | Yes (`payments` relation, `totalAmount`) | Task 5.3 |
| REP-003 Escrow | `/v1/reports/escrow` | Yes (`studentId`, `amount` columns + `'accepted'`) | Task 5.1, 5.3 |
| REP-004 Enrollment | `/v1/reports/enrollment` | Verify | — |
| REP-005 Compliance | `/v1/reports/compliance` | Verify | — |
| REP-006 Audit Trail | `/v1/audit` | OK (separate service) | — |
| REP-007 Roster | `/v1/reports/roster` | Partial (`'accepted'` status) | Task 5.1 |
| REP-008 Dashboard | `/v1/reports/dashboard` | Verify | — |
| REP-009 Pending | `/v1/reports/pending` | Yes (`approvedBy` relation) | Task 5.4 |

**Acceptance criteria:**
- All 9 report endpoints return data without runtime errors
- Data includes correct parent information (after `'accepted'` → `'approved'` fix)
- All column references match the actual schema

---

### Task 10.5: Complete Report Data Quality

After Phase 8 (audit trail completion), verify that reports contain meaningful data:

- REP-006 (Audit trail): Should now show entries for all 30 action types instead of only 14
- REP-001 (Registration report): Should show "Requested by → Approved by → Processed by" chain
- REP-009 (Pending approvals): Should show pending registration AND change requests with age

**Acceptance criteria:**
- Audit trail shows complete chain of custody for registration lifecycle
- Reports accurately reflect the full history of each transaction

---

## 13. Phase 11: Frontend & UX Polish

**Goal:** Fix frontend patterns, improve usability, and ensure consistent UX.

**Files primarily affected:**
- `apps/web/app/sign-in/page.tsx`
- `apps/web/app/admin/layout.tsx` (from Task 3.5)
- Various `*.client.tsx` files
- `apps/web/lib/format.ts` (new shared utility)

---

### Task 11.1: Implement Role-Based Sign-In Redirect

**Audit Finding:** H-AUTH-4 (High)
**URD Alignment:** AUTH-005 ("Successful login redirects to appropriate dashboard")

**What to change:**

In `apps/web/app/sign-in/page.tsx`, both redirect paths (lines ~21, ~35) send all users to `/`.

After successful authentication, check the user's role and redirect:
- `admin` → `/admin/dashboard`
- `student` → `/register` (or `/registrations` if a session is active)
- `parent` → `/approvals` (or `/registrations` if no pending approvals)

The role is available from the session data returned by `authClient.signIn.email`.

**Acceptance criteria:**
- Admin users land on the admin dashboard after sign-in
- Student users land on their primary student page after sign-in
- Parent users land on their approvals/primary parent page after sign-in
- The redirect is fast and does not cause a visible flash

---

### Task 11.2: Deduplicate `formatPrice` Utility

**Audit Finding:** Medium (5 independent definitions across 4 files)
**URD Alignment:** Code quality / maintainability

**What to change:**

Create a shared utility file `apps/web/lib/format.ts` with a single exported `formatPrice` function using `Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 })`.

Replace all 5 independent definitions:

| File | Line | Current Name |
|------|------|-------------|
| `register.client.tsx` | ~45 | `formatPrice` |
| `registrations.client.tsx` | ~70 | `formatPrice` |
| `approvals.client.tsx` | ~49 | `formatPrice` (first definition) |
| `approvals.client.tsx` | ~796 | `formatPrice` (second definition in same file) |
| `history/history.client.tsx` | ~117 | `fmtPrice` |

Replace each with an import from `~/lib/format`.

**Acceptance criteria:**
- One definition of `formatPrice` in the entire codebase
- All 5 previous locations import from the shared utility
- Price formatting is visually identical everywhere

---

### Task 11.3: Implement SES-005 — Session Status Dashboard Countdown

**Audit Finding:** Medium (frontend missing)
**URD Alignment:** SES-005 ("Dashboard shows if window is open/closed — countdown timer if window is open")

**What to change:**

The student and parent dashboards need a visible session status component that shows:
1. Whether a registration window is currently open or closed
2. If open: the session name, type, and a live countdown timer to the closing date
3. If closed: "No active registration window" with the next session date (if known)

This component should:
- Fetch active sessions from `GET /v1/sessions/active`
- Render a countdown using a client-side interval (update every second)
- Show prominently on the dashboard (not buried in navigation)

**Acceptance criteria:**
- Students see a countdown timer when a registration window is open
- Parents see a countdown timer when a registration window is open
- The countdown updates in real-time (every second)
- When the timer reaches zero, the component refreshes to show "Window closed"

---

### Task 11.4: Implement Admin Provisioning/Seeding

**Audit Finding:** H-AUTH-5 (implied — no admin provisioning mechanism)
**URD Alignment:** AUTH-008 (Admin login requires an admin account to exist)

**What to change:**

There is no mechanism to create the first admin account. Options:

**Option A (Recommended — Seed script):**
- Create a script `packages/db/seed.ts` (or `apps/api/src/scripts/seed-admin.ts`)
- Reads admin email and password from environment variables (`ADMIN_EMAIL`, `ADMIN_PASSWORD`)
- Creates a user with `role: 'admin'` using better-auth's admin creation API or direct DB insert
- Add a `pnpm db:seed` command

**Option B (CLI command):**
- Add a CLI command to the API: `pnpm api:create-admin --email admin@school.com`
- Prompts for password interactively

**Acceptance criteria:**
- A fresh deployment can create an admin account without direct database manipulation
- The admin can log in and access the admin dashboard
- The provisioning mechanism is documented in README

---

### Task 11.5: Improve Notification Pagination UX

**Audit Finding:** Medium (pagination replaces instead of appending)
**URD Alignment:** NOT (notifications center usability)

**What to change:**

In the notifications client component, verify that pagination appends new notifications to the existing list rather than replacing them. This provides an infinite-scroll or "load more" experience.

If the current implementation replaces the list on page change, modify the TanStack Query setup to use `getNextPageParam` with `useInfiniteQuery` for proper infinite scroll, or at minimum maintain accumulated data across page navigations.

**Acceptance criteria:**
- Users can scroll through their full notification history
- Loading more notifications does not discard previously loaded ones
- The "Load more" button (or infinite scroll trigger) is intuitive

---

### Task 11.6: Add Accessibility to Modals

**Audit Finding:** Medium (no focus trap, no Escape key handling)
**URD Alignment:** UX best practices

**What to change:**

Review all modal/dialog components in the frontend for:
1. Focus trap (Tab key should cycle within the modal, not escape to background)
2. Escape key closes the modal
3. Background overlay click closes the modal
4. Proper ARIA attributes (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`)

If using Radix UI `Dialog` component (already in dependencies), these behaviors come built-in. Ensure all custom modals use Radix Dialog or equivalent.

**Acceptance criteria:**
- All modals trap focus
- Pressing Escape closes the modal
- Screen readers can identify modal content

---

## 14. Phase 12: Missing Feature Implementation

**Goal:** Implement URD features that are completely absent from the codebase.

**Files primarily affected:** Various (new code)

---

### Task 12.1: Implement Password Reset Flow (AUTH-006)

**Audit Finding:** #12 (Critical — P0 requirement)
**URD Alignment:** AUTH-006 ("User requests reset with email — reset link sent via email valid for 24 hours — user can set new password")

**What to implement:**

1. **Backend configuration:** In `auth.ts`, configure better-auth's `forgetPassword` plugin/flow:
   - `sendResetPassword` callback: sends an email with a reset link using the email integration
   - Token expiry: 24 hours (per URD)

2. **Email template:** Add `sendPasswordResetEmail(to, data)` to `email.ts`:
   - Include the reset link
   - Include expiry notice ("This link expires in 24 hours")
   - Escape all dynamic values (per Task 3.3)

3. **Frontend pages:**
   - `apps/web/app/forgot-password/page.tsx` — Email input form, calls better-auth's forgot password endpoint
   - `apps/web/app/reset-password/page.tsx` — New password form (with token from URL), calls better-auth's reset password endpoint
   - Add "Forgot password?" link to the sign-in page

**Acceptance criteria:**
- User can request a password reset by entering their email
- Reset email is sent with a unique, time-limited link
- User can set a new password using the link
- Expired links show an appropriate error
- New password must meet complexity requirements (from Task 2.5)

---

### Task 12.2: Implement Email Verification (AUTH-001, AUTH-002)

**Audit Finding:** #10 (Critical — P0 requirement)
**URD Alignment:** AUTH-001 ("Email verification required"), AUTH-002 ("Email verification required")

**What to implement:**

1. **Backend configuration:** In `auth.ts`, enable email verification:
   - `requireEmailVerification: true`
   - `sendVerificationEmail` callback: sends a verification email with a link using the email integration

2. **Email template:** Add `sendVerificationEmail(to, data)` to `email.ts`:
   - Include the verification link
   - Friendly welcome message

3. **Frontend:**
   - `apps/web/app/verify-email/page.tsx` — Handles the verification token from the email link
   - Update sign-up completion pages to show "Check your email for verification"
   - Optionally show a "Resend verification email" button

4. **Access control:** Unverified users should be redirected to a "Please verify your email" page when attempting to access protected routes

**Acceptance criteria:**
- New users receive a verification email after registration
- Clicking the verification link activates the account
- Unverified users cannot access protected features
- Users can request a new verification email

---

### Task 12.3: Implement PDF Payment Receipt (PAY-006)

**Audit Finding:** Missing feature
**URD Alignment:** PAY-006 ("Downloadable PDF receipt available in dashboard")

**What to implement:**

1. **PDF generation:** Add a PDF generation utility (`apps/api/src/lib/pdf.ts` or similar):
   - Use a library like `@react-pdf/renderer`, `pdfkit`, or `puppeteer` for PDF generation
   - Create a receipt template that includes:
     - School name and logo
     - Receipt number (payment ID)
     - Student name and grade
     - List of registered subjects with individual prices
     - Total amount and payment method
     - Date of payment
     - Escrow amount applied (if any)

2. **API endpoint:** Add `GET /v1/payments/:id/receipt` — returns PDF:
   - Only accessible by the parent who made the payment (or admin)
   - Generates PDF on-the-fly or caches it

3. **Email attachment:** Update the payment confirmation email (NOT-005) to attach the PDF receipt

4. **Frontend:** Add a "Download Receipt" button on the payment details view in the dashboard

**Acceptance criteria:**
- Parents can download a PDF receipt for any confirmed payment
- Receipt includes all required information per URD
- Receipt is attached to the payment confirmation email
- Receipt is available from the dashboard

---

### Task 12.4: Implement Fawry Payment Code Expiry Handling

**Audit Finding:** H-PAY-2 (High — no expiry cron)
**URD Alignment:** PAY-001 ("Code valid for limited time, e.g., 24 hours")

**What to implement:**

1. **Scheduled job:** Add payment expiry checking to the session-closer job (or create a separate job):
   - Query all payments with `status = 'pending'` and `paymentMethod = 'fawry'`
   - Check the `fawryExpiresAt` timestamp from the payment metadata
   - For expired payments, call `failPayment(paymentId)` to transition to `failed`
   - Credit back any escrow amount that was applied

2. **Run frequency:** Every 5 minutes (more frequent than session-closer's session checks)

**Acceptance criteria:**
- Fawry payments that exceed their expiry time are automatically failed
- Escrow amounts applied to expired payments are refunded
- Students/parents are notified of the expired payment
- The payment's registration is moved back to `pending_payment` (or appropriate status)

---

### Task 12.5: Implement Webhook Idempotency

**Audit Finding:** H-PAY-3 (Partially confirmed — implicit guard only)
**URD Alignment:** PAY-001, PAY-002, PAY-003 (payment reliability)

**What to implement:**

The current `confirmPayment` function throws if `pay.status !== 'pending'`, providing an implicit guard. But this is fragile. Implement proper idempotency:

1. **Idempotency tracking:** Add a `processedAt` timestamp to the payment record (or use a separate webhook events table)
2. **On webhook receipt:**
   - Check if the webhook has already been processed (via external reference + provider)
   - If already processed, return 200 immediately without re-processing
   - If new, process the webhook and mark as processed
3. **Response:** Always return 200 to the payment provider (even for already-processed webhooks) to prevent retries

**Acceptance criteria:**
- Replaying the same webhook multiple times has no side effects
- The first successful webhook processes the payment
- Subsequent replays return 200 without changes
- A separate, different webhook for the same payment (e.g., different status) is processed correctly

---

## 15. Dependency Graph

```
Phase 0 (Build Health) ──► BLOCKS ALL OTHER PHASES
    │
    ▼
Phase 1 (Schema)
    ├──► Phase 2 (Validations)
    │       └──► Phase 3 (Security)
    │               └──► Phase 12 (Missing Features — auth config)
    ├──► Phase 4 (Financial Integrity) ◄──► Phase 5 (Data Correctness) [TIGHTLY COUPLED]
    │       │                                   │
    │       │   (Both touch swap.services.ts     │
    │       │    — Task 4.4 dead code fix and    │
    │       │    Task 5.2 column name fix are    │
    │       │    in the same function)           │
    │       │                                    │
    │       └───────────┬────────────────────────┘
    │                   │
    │                   ├──► Phase 7 (Notifications — depends on BOTH 4+5)
    │                   │       └──► Phase 9.4 (Reminder tracking)
    │                   └──► Phase 10 (Reports — depends on correct queries from 5)
    ├──► Phase 6 (Registration/Session Lifecycle)
    │       ├──► Phase 7 (Notifications — new lifecycle events)
    │       └──► Phase 9 (Grade Progression — manual close trigger)
    └──► Phase 8 (Audit Trail — depends on schema being correct)
            └──► Phase 10.5 (Report data quality — depends on populated audit)

Phase 11 (Frontend) ──► can proceed in parallel with Phases 7-10
                        (depends on Phase 3 for admin layout, Phase 5 for core subjects fix)

Phase 12 (Missing Features) ──► can proceed in parallel after Phase 3
```

**Critical coupling warning:** Phases 4 and 5 are tightly coupled because they both modify `swap.services.ts` — Task 4.4 (fix dead code in `approveChangeRequest`) and Task 5.2 (fix `subjectCode` → `code` in the same file's query functions) must be coordinated. **Do NOT start Phase 7 (Notifications) until both Phases 4 and 5 are complete,** as the notification wiring depends on both the financial atomicity fixes and the data correctness fixes being in place.

### Parallelizable Work

| Stream A | Stream B | Stream C |
|----------|----------|----------|
| Phase 0 (blocking) | — | — |
| Phase 1 → 4+5 (sequential) | Phase 2 → 3 | — |
| Phase 6 | Phase 8 | — |
| Phase 7 (after 4+5+6) | Phase 9 (after 6) | Phase 11 (after 3+5) |
| Phase 10 (after 5+8) | Phase 12 (after 3) | — |

Phases 7, 8, and 11 can run in parallel once their respective dependencies are complete. Phase 0 must complete before anything else starts.

---

## 16. Verification Checklist

After all phases are complete, verify these end-to-end workflows:

### Critical Workflow 1: Student Registration → Parent Approval → Payment → Confirmation
- [ ] Student creates account with email verification
- [ ] Parent creates account and links to student
- [ ] Student requests registration for subjects (including core subjects for Grade 10 June)
- [ ] Parent receives notification (in-app + email)
- [ ] Parent approves registration
- [ ] Student receives approval notification
- [ ] Parent pays via Fawry (generate code → webhook confirmation)
- [ ] Student's registration status transitions to `confirmed`
- [ ] Parent receives payment receipt email with PDF
- [ ] Escrow balance is updated if escrow was applied
- [ ] Full audit trail exists: Requested by student → Approved by parent → Confirmed by system

### Critical Workflow 2: Drop/Swap → Escrow Credit → Transfer → Withdrawal
- [ ] Student requests to drop a subject
- [ ] Parent receives drop request notification
- [ ] Parent approves drop
- [ ] Student's escrow is credited with the subject price
- [ ] Parent receives escrow balance change notification
- [ ] Parent transfers escrow from child A to child B
- [ ] Both children's balances updated atomically
- [ ] Parent requests withdrawal for child B
- [ ] Admin sees pending withdrawal
- [ ] Admin fulfills withdrawal
- [ ] Parent and student notified
- [ ] Full audit trail for every step

### Critical Workflow 3: Session Lifecycle
- [ ] Admin creates session (immediate activation sends notifications)
- [ ] 24-hour reminder fires before closing
- [ ] Session auto-closes at end time
- [ ] Closure notifications sent to all users
- [ ] Pending registrations finalized
- [ ] Grade progression runs
- [ ] All events logged in audit trail

### Critical Workflow 4: Admin Reporting
- [ ] All 9 reports load without errors
- [ ] CSV export works (correct URL, formula injection protected)
- [ ] Session selector dropdown works (no UUID pasting)
- [ ] Reports show complete data (parents linked, amounts correct)
- [ ] Audit trail shows full chain of custody
- [ ] Reports paginate for large datasets

### Security Verification
- [ ] Forged Fawry webhook is rejected (invalid signature)
- [ ] Unverified email cannot access protected routes
- [ ] Weak password is rejected server-side
- [ ] Admin pages are inaccessible to non-admins
- [ ] Rate limiting prevents brute force on auth endpoints
- [ ] CSV cells with formula prefixes are sanitized
- [ ] Bulk announcements don't expose recipient emails
- [ ] 403 responses don't leak role requirements
- [ ] XSS in email fields renders as escaped text

### Data Integrity Verification
- [ ] Concurrent escrow transfers don't cause lost updates
- [ ] Escrow transfer is atomic (debit + credit or nothing)
- [ ] Withdrawal requests hold funds (prevent over-withdrawal)
- [ ] Financial columns use `numeric` (no floating-point rounding)
- [ ] All financial records use `restrict` on delete (no silent destruction)
- [ ] `'approved'` status used consistently for parent-student links

---

**End of Fix & Completion Plan**

*This plan covers all 61 confirmed and 3 partially confirmed audit findings, plus all URD P0/P1 features that remain unimplemented. P3 features (GRAD-001 through GRAD-007: Graduation Plan & Career Visualization) are explicitly deferred to post-launch.*
