# IGCSE Subject Reservation System — Project Activity Log

**Purpose:** A running record of all actions taken on this project — what was planned, why it was done, what the outcome was, and exactly what changed. Used by all contributors to track progress, understand decisions, and identify what still needs work.

**How to read this log:**
- Each entry has a unique code in the format `ACT-XXX`
- If a later action supersedes or overwrites a previous one, the earlier entry will have a `⚠️ Superseded by: ACT-XXX` notice
- The superseding entry will reference the entry it overwrote under `Overwrites`
- Entries are grouped by session date, then ordered sequentially within that session
- Status field indicates if the action's outcomes are still current (`Active`), superseded (`Superseded`), or partially overridden (`Partially Superseded`)

---

## Entry Format Reference

```
### ACT-XXX — [Title]
| Field       | Value             |
|-------------|-------------------|
| Code        | ACT-XXX           |
| Date        | YYYY-MM-DD        |
| Time        | HH:MM (UTC+2)     |
| Type        | [See types below] |
| Status      | Active / Superseded / Partially Superseded |
| Overwrites  | ACT-XXX (if applicable) |

**Intent:** What was planned to be done.
**Rationale:** Why this was being done.
**Result:** What was achieved or produced.
**Action Taken:** The specific files changed and what exactly changed in each.
**Still Needs Work:** Any known gaps, follow-up items, or deferred decisions arising from this action.
```

**Entry Types:**
| Type | Meaning |
|------|---------|
| `REQUIREMENTS` | Changes to the URD or user stories |
| `PLANNING` | Changes to the development plan or roadmap |
| `SCHEMA` | Database schema decisions or changes |
| `ARCHITECTURE` | Architecture decisions affecting how the system is built |
| `FEATURE` | Implementation of a new feature |
| `BUGFIX` | Correction of a defect |
| `REFACTOR` | Code restructuring without behavior change |
| `DECISION` | A decision was made and documented |

> **Log policy:** Only entries that result in actual file changes (code, schema, config, or documentation) are recorded. Status checks, explorations, and read-only analysis sessions are not logged.

---

---

# Session 1 — March 1, 2026

---

### ACT-002 — URD Upgrade: v1.0 → v2.0 (Full Document Replacement)

| Field | Value |
|-------|-------|
| Code | ACT-002 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `REQUIREMENTS` |
| Status | Active |
| Overwrites | URD v1.0 (the entire previous `urd-doc.md`) |

**Intent:**
Replace the entire contents of `urd-doc.md` with the updated Version 2.0 of the User Requirements Document, which incorporates significant workflow changes, a revised pricing model, new features, and a recount of user stories.

**Rationale:**
The v1.0 URD no longer reflected the intended system design. The following gaps and design decisions emerged that made v1.0 outdated:
1. **Students were allowed to register, drop, and swap subjects directly** — the business wanted a parent approval gate before any academic or financial action takes effect
2. **Students were allowed to initiate payments** — the business decided all financial transactions should be controlled exclusively by parents
3. **The external pricing model was flawed** — v1.0 had an `in_school`/`external` registration type, but the reality is students taking school subjects with external teachers still pay the same school price; the only pricing variation is for subjects not offered at school at all (custom price set by finance)
4. **Account lockout was rejected** — the business decided not to penalize users for login failures to reduce friction
5. **Multiple active session windows were needed** — v1.0 assumed only one active registration window at a time; the school may run June and November windows simultaneously
6. **Admin needed the ability to edit active window deadlines** — emergency changes should be possible (logged to audit trail)
7. **A graduation plan and career visualization feature was requested** — added as a P3 (post-launch) feature
8. **The audit trail needed to show full chain of custody** — "Requested by → Approved by → Processed by" for all transactions
9. **Notification coverage was insufficient** — the request-approval flow requires dedicated notifications at each step

**Result:**
`urd-doc.md` updated to v2.0 with the following changes from v1.0:

| Metric | v1.0 | v2.0 | Delta |
|--------|------|------|-------|
| Total user stories | 60 | 77 | +17 |
| P0 (Critical) | 47 | 54 | +7 |
| P1 (High) | 12 | 15 | +3 |
| P2 (Medium) | 1 | 1 | 0 |
| P3 (Low) | 0 | 7 | +7 |
| Feature categories | 11 | 12 | +1 |

**Specific story-level changes:**

| Story ID | Change Type | Summary |
|----------|-------------|---------|
| AUTH-005 | Modified | Removed account lockout after failed login attempts |
| SES-001 | Modified | Multiple windows allowed simultaneously (one per session type) |
| SES-003 | Modified | Admin can now edit active window deadlines (not just draft); changes audit-logged |
| SUB-001 | Modified | Replaced external price toggle with `isOfferedAtSchool` toggle + custom price for non-school subjects |
| SUB-002 | Modified | Column: "external option" → "school availability status" |
| SUB-003 | Modified | Field list updated to reflect new pricing model |
| SUB-005 | Modified | Browser view updated: no external price column; shows school availability |
| SUB-006 | Modified | Clarified: students using external teachers still pay full school price |
| CORE-003 | Modified | Added "parent approval" requirement alongside payment for core subjects |
| Section 5 | Renamed | "Subject Registration" → "Subject Registration & Approval Workflow" |
| REG-001 | Replaced | Student now submits a REQUEST that goes to parent for approval; no direct registration |
| REG-002 | Replaced | Parent approves or rejects child's registration request (was: parent registers directly) |
| REG-003 | Replaced | Parent directly registers for child with auto-approval (was: view registered subjects) |
| REG-004 | Replaced | View registered subjects with approval status (was: block when window closed) |
| REG-005 | Replaced | Block when window closed (was: registration history) |
| REG-006 | Replaced | Registration history with approval trail (was: — ) |
| REG-007 | Added | Admin can override parent approval for exceptional cases (P1) |
| PAY-001 to PAY-003 | Modified | Persona changed from `student/parent` → `parent` only |
| PAY-004 | Modified | Persona `student/parent` → `parent` only; both parent and student notified on bank confirmation |
| PAY-005 | Modified | Persona `student/parent` → `parent` only |
| PAY-006 | Modified | Persona `student/parent` → `parent` only |
| PAY-007 | Modified | Admin confirms bank transfer; now notifies parent AND student (was: student only) |
| Section 7 | Renamed | "Subject Swapping" → "Subject Swapping & Change Requests" |
| SWAP-001 | Replaced | Student submits DROP REQUEST (not a direct drop); pending parent approval |
| SWAP-002 | Replaced | Student submits SWAP REQUEST showing financial impact; pending parent approval |
| SWAP-003 | Replaced | Was "switch in-school/external type" (removed); now "parent approves/rejects drop/swap requests" |
| SWAP-004 | Replaced | Was "parent performs swaps directly"; now also covers direct drops with immediate processing |
| SWAP-005 | Renumbered | Core subject blocking (unchanged, was SWAP-005) |
| SWAP-006 | Renumbered | Window closed blocking (unchanged, was SWAP-006) |
| SWAP-007 | Added | Student views pending change requests with status and parent comments (P0) |
| ESC-001 | Modified | Added: read-only view for students; cannot perform transactions |
| ESC-002 | Modified | Added: parent has full control over escrow operations |
| ESC-004 | Replaced | Was "student requests withdrawal"; now "parent requests withdrawal for child" |
| ESC-005 | Renumbered | Was ESC-006; admin views withdrawal requests — now shows parent name alongside student name |
| ESC-006 | Renumbered | Was ESC-007; admin marks withdrawal fulfilled — now notifies parent AND student |
| ESC-007 | Replaced | Was ESC-008 "student/parent view history"; now parent-only withdrawal history per child (P1) |
| NOT-001 to NOT-002 | Unchanged | Window opens / closing soon |
| NOT-003 | Replaced | Was "registration confirmed"; now "parent notified when child submits registration request" |
| NOT-004 | Added | Student notified when registration request approved/rejected |
| NOT-005 | Added | Parent receives payment receipt |
| NOT-006 | Added | Parent notified when child requests drop/swap |
| NOT-007 | Added | Student notified when drop/swap request is processed |
| NOT-008 | Replaced | Was "escrow balance change"; now parent-only escrow balance change notification |
| NOT-009 | Replaced | Was "withdrawal fulfilled"; now parent-only withdrawal fulfilled notification |
| NOT-010 | Replaced | Was "parent receives all child notifications"; enhanced with full audit trail info |
| NOT-011 | Renumbered | Was NOT-008; admin bulk announcements (unchanged) |
| REP-001 | Modified | Added approval trail columns; filter by approval status (not registration type) |
| REP-002 | Modified | Breakdown by "school vs. non-school" (was "in-school vs. external") |
| REP-004 | Modified | Breakdown by "school vs. non-school" (was "in-school vs. external") |
| REP-005 | Modified | Added "shows approval status" column |
| REP-006 | Modified | Enhanced: shows full chain "Requested by → Approved by → Processed by" |
| REP-008 | Modified | Added "pending approval requests count" to dashboard metrics |
| REP-009 | Added | Pending approvals report: all pending requests with age, student, parent, subjects (P1) |
| GRADE-002 | Modified | Now notifies both student AND parent of manual grade adjustment |
| GRADE-003 | Modified | Clarified: parent (not graduated student) retains escrow withdrawal rights |
| Section 12 | Added | Graduation Plan & Career Visualization — GRAD-001 to GRAD-007, all P3 |

**Action Taken:**
- File modified: `urd-doc.md`
- Operation: Full document replacement (not a diff-based edit)
- Document version bumped from `1.0` to `2.0`
- Document date updated from `January 2026` to `February 2026`
- A "Key Changes in Version 2.0" section appended to the document

**Still Needs Work:**
- Email verification flow (AUTH-001, AUTH-002) is referenced in the URD but not yet implemented in the codebase
- The `"headmistress"` role referenced in GRAD-006 is not defined in the role system — this will need a new role or a special admin sub-role when GRAD features are implemented

---

### ACT-003 — Development Plan Alignment: Executive Summary and Phase Diagram

| Field | Value |
|-------|-------|
| Code | ACT-003 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `PLANNING` |
| Status | Active |
| Overwrites | Lines 30–34 and lines 119–147 of `DEVELOPMENT_PLAN.md` (v1.0 values) |

**Intent:**
Update the Development Plan's Executive Summary story counts and phase overview diagram to match the new URD v2.0 totals and story ID ranges.

**Rationale:**
The Executive Summary and phase diagram contained specific story counts and ID ranges that were now stale after the URD upgrade. Leaving them inconsistent would cause confusion for any developer reading the plan.

**Result:**
Executive Summary and phase diagram are now consistent with URD v2.0.

**Action Taken:**
File modified: `DEVELOPMENT_PLAN.md`

1. **Executive Summary — Project Scope section:**
   - `Total User Stories: 60` → `77`
   - `P0 (Critical): 47` → `54`
   - `P1 (High): 12` → `15`
   - Added new line: `P3 (Low): 7`

2. **Phase 3 block in the Phase Overview Diagram:**
   - `REG-001 to REG-005` → `REG-001 to REG-007`
   - `SWAP-001 to SWAP-006` → `SWAP-001 to SWAP-007`
   - `ESC-001 to ESC-008` → `ESC-001 to ESC-007`

3. **Phase 4 block in the Phase Overview Diagram:**
   - `NOT-001 to NOT-008` → `NOT-001 to NOT-011`
   - `REP-001 to REP-008` → `REP-001 to REP-009`
   - Added: `GRAD-001 to GRAD-007 (P3 — post-launch)`

4. **Feature Dependency Map — Critical Path:**
   - Replaced flat chain ending at `Subject Swapping` with the approval-aware chain:
     `Registration Request → Parent Approval → Payment Processing → Escrow → Change Requests`

**Still Needs Work:**
- None; this was a pure numbers/labels update

---

### ACT-004 — Development Plan Alignment: Subject Pricing Model

| Field | Value |
|-------|-------|
| Code | ACT-004 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `SCHEMA` + `PLANNING` |
| Status | Active |
| Overwrites | Phase 2 subject table schema and Step 2.1 validation schema in `DEVELOPMENT_PLAN.md` |

**Intent:**
Update the Phase 2 subject database schema and the subject validation/service definitions to reflect the new pricing model: replacing `priceExternal` with `isOfferedAtSchool` and `customPrice`.

**Rationale:**
The v1.0 plan modeled subjects with two prices (`priceInSchool`, `priceExternal`) and a toggle for whether the external option was available. This was based on the assumption that a student could choose between registering as "in-school" or "external" for the same subject at different prices. URD v2.0 clarifies:
- Students taking school subjects with external teachers still pay the **full school price** — there is no discounted external option
- The `priceExternal` field served no valid purpose in this model
- Some subjects are not offered at school at all (e.g., the school doesn't teach them) — for these, the finance department sets a custom price

The schema must be changed **before any Phase 2 implementation begins** to avoid a data migration later.

**Result:**
Phase 2 subject schema now reflects the correct pricing model. The `registrationType: 'in_school' | 'external'` field is also removed from the Registration table (see ACT-006).

**Action Taken:**
File modified: `DEVELOPMENT_PLAN.md`

1. **Subject table schema (Section 7.1):**
   - Removed: `priceExternal: numeric (nullable - null means external not available)`
   - Added: `isOfferedAtSchool: boolean (default true) - If false, finance sets custom price`
   - Added: `customPrice: numeric (nullable - only when isOfferedAtSchool is false)`
   - Added explanatory note below the schema block

2. **Step 2.1 — Subject validation schemas:**
   - `CreateSubject` description updated: removed "prices, external option"; replaced with `priceInSchool, isOfferedAtSchool, customPrice (required if not offered at school)`

**Still Needs Work:**
- The `packages/db/src/schema.ts` file has not yet been updated — this is a planned schema change, not yet implemented in code
- A new migration will need to be generated when the subject table is created

---

### ACT-005 — Development Plan Alignment: Session Management Updates

| Field | Value |
|-------|-------|
| Code | ACT-005 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `SCHEMA` + `PLANNING` |
| Status | Active |
| Overwrites | Phase 2 session table schema, SES-003 story mapping, and session service in `DEVELOPMENT_PLAN.md` |

**Intent:**
Update the Phase 2 session management plan to support: (1) multiple active windows for different session types simultaneously, and (2) admin ability to edit deadlines on active (not just draft) windows.

**Rationale:**
URD v1.0 stated "only one window can be active at a time" globally. URD v2.0 changed this to "only one window **per session type** can be active at a time." This is a meaningful architectural distinction — the school may open the June 2026 registration window while the November 2025 window is still being processed.

Additionally, SES-003 in v1.0 said admin "cannot edit once window is active." URD v2.0 allows deadline edits to active windows (for emergencies), but requires those changes to be audit-logged.

**Result:**
Session schema and service reflect the correct constraint and new admin capability.

**Action Taken:**
File modified: `DEVELOPMENT_PLAN.md`

1. **Session table schema (Section 7.2):**
   - Added note below table: "Unique constraint: Only one active window per `sessionType` at a time. Multiple sessions of different types may be active simultaneously."

2. **SES-003 story mapping table:**
   - Was: `"Only before active"` → Now: `"Draft sessions: any field; active sessions: deadline/endDate only, changes logged to audit trail"`

3. **Session service functions (Step 2.2):**
   - `getActiveSession()` → `getActiveSessions()` (returns all currently active, potentially multiple)
   - Added: `getActiveSession(sessionType?)` for type-specific lookup
   - `updateSession(id, data)` → `updateSession(id, data, adminId)` to enable audit logging on active-window edits

4. **Phase 2 Deliverables Checklist:**
   - Updated subject table line to reflect new pricing fields
   - Updated session table line to reflect "per-type unique active constraint"
   - Updated session CRUD API line to note active window deadline editing with audit log
   - Updated active session API line to `Active session(s)` (plural)

**Still Needs Work:**
- The unique constraint logic in `session.services.ts` (when built) must enforce uniqueness per `sessionType`, not globally
- The audit trail must capture the `adminId` and the `reason` for changes to active window deadlines (the UI should prompt for a reason)

---

### ACT-006 — Development Plan Alignment: Registration Approval Workflow

| Field | Value |
|-------|-------|
| Code | ACT-006 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `SCHEMA` + `ARCHITECTURE` + `PLANNING` |
| Status | Active |
| Overwrites | Phase 3 registration schema, REG stories mapping, registration service, registration routes, Phase 3 deliverables checklist, and Phase 3 web pages in `DEVELOPMENT_PLAN.md` |

**Intent:**
Redesign the entire registration workflow in the development plan to implement the student-request / parent-approval model mandated by URD v2.0.

**Rationale:**
This is the single largest workflow change in URD v2.0. In v1.0, both students and parents could register subjects directly — the flow was linear: select subjects → pay → confirmed. In v2.0:
- **Students submit requests** — they select subjects and submit, but no payment happens yet
- **Parents approve or reject** — the parent reviews the request, approves or rejects (with optional comments)
- **Payment only happens after approval** — and only the parent can pay
- **Parents can also register directly** — bypassing the request step (auto-approved, goes straight to payment)
- **Admin override** — for exceptional cases (orphaned students, legal guardianship) an admin can bypass the parent approval step

This changes the registration table's status enum, adds approval tracking fields, and fundamentally changes the service function signatures.

**Result:**
The registration schema, service, routes, pages, and deliverables checklist in the development plan now accurately reflect the approval-gated workflow.

**Action Taken:**
File modified: `DEVELOPMENT_PLAN.md`

1. **Registration table schema (Section 8.1):**
   - Removed: `registrationType: text ('in_school' | 'external')` — no longer exists
   - Updated `status` enum: `'pending_payment' | 'confirmed' | 'dropped'` → `'pending_approval' | 'pending_payment' | 'confirmed' | 'dropped' | 'rejected'`
   - Renamed `registeredBy` → `requestedBy` (clearer intent)
   - Added: `approvedBy: text (FK → user.id, nullable)` — parent who approved
   - Added: `approvedAt: timestamp (nullable)`
   - Added: `approvalComments: text (nullable)`
   - Added explanatory note on status flow below the table

2. **REG stories mapping table (Section 8):**
   - REG-001: "Cart → checkout → payment" → "Cart → submit request → pending_approval"
   - REG-002: "Same flow, specify child" → "View pending requests → approve (→ payment) or reject with comments"
   - REG-003: "View registered subjects" → "Cart → auto-approved → pending_payment → checkout"
   - REG-004: "Block when window closed" → "Per session view with approval status and initiator"
   - REG-005: "Registration history" → "Block when window closed"
   - REG-006: Added — "Registration history with approval trail"
   - REG-007: Added — "Admin override approval, audit logged"

3. **Registration service functions (Step 3.1):**
   - `createPendingRegistrations` → `createRegistrationRequest` (student flow: pending_approval)
   - Added: `createDirectRegistration` (parent flow: skip to pending_payment)
   - Added: `approveRegistrationRequest(registrationIds, parentId, comments?)`
   - Added: `rejectRegistrationRequest(registrationIds, parentId, comments)`
   - Added: `adminOverrideApproval(studentId, subjectIds, adminId, reason)`
   - Added: `getPendingApprovalRequests(parentId)`

4. **Registration routes (Step 3.1):**
   - `POST /registrations/checkout` now only handles payment initiation (not request creation)
   - Added: `POST /registrations/request` (student submits request)
   - Added: `POST /registrations/direct` (parent registers directly)
   - Added: `PUT /registrations/approve` (parent approves)
   - Added: `PUT /registrations/reject` (parent rejects)
   - Added: `GET /registrations/pending` (parent views children's pending)

5. **Phase 3 web pages (Step 3.5):**
   - Split into "Student pages" and "Parent pages" sections
   - Added: `apps/web/app/pending-requests/page.tsx` (student)
   - Added: `apps/web/app/approvals/page.tsx` (parent)
   - Added: `apps/web/app/escrow/transfer/page.tsx` (parent)

6. **Phase 3 Deliverables Checklist:**
   - Replaced single "Subject registration flow API" with itemized approval flow steps
   - Added approval workflow UI items for both student and parent perspectives

**Still Needs Work:**
- The `change_request` table may be needed as a separate table (not just a status on `registration`) to track drop/swap requests independently from the original registration record — this should be decided when building Phase 3
- The `adminOverrideApproval` route needs a careful permission guard: only admin, and must always write to audit log
- The pending approvals dashboard for parents needs to aggregate across all linked children

---

### ACT-007 — Development Plan Alignment: Payment Restriction to Parent-Only

| Field | Value |
|-------|-------|
| Code | ACT-007 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `ARCHITECTURE` + `PLANNING` |
| Status | Active |
| Overwrites | PAY stories mapping, payment service persona assumptions, and authorization matrix in `DEVELOPMENT_PLAN.md` |

**Intent:**
Update all payment-related entries in the development plan to reflect that only parents can initiate or complete payments; students have no payment access.

**Rationale:**
URD v2.0 restricts all financial transactions to parents. The reasoning is that IGCSE registrations represent a significant financial commitment and the school wants parents to be the single point of financial accountability. Students should not be able to trigger payments independently.

This affects:
- PAY-001 to PAY-006: persona changed from `student/parent` → `parent` only
- PAY-007: admin confirmation of bank transfer now notifies both parent and student (not just student)
- The `POST /registrations/checkout` route must verify the caller is a parent linked to the student

**Result:**
Payment entries in the development plan now explicitly state parent-only access. The authorization matrix is updated accordingly.

**Action Taken:**
File modified: `DEVELOPMENT_PLAN.md`

1. **PAY stories mapping table (Section 8):**
   - PAY-001: "Fawry payment" → "Fawry payment (parent only)"
   - PAY-002: "Card payment" → "Card payment (parent only)"
   - PAY-003: "Mobile wallet" → "Mobile wallet (parent only)"
   - PAY-004: "Bank transfer" → "Bank transfer (parent only)"
   - PAY-005: "Use escrow balance" → "Parent applies child's escrow at checkout, pays remainder via other method"
   - PAY-006: "Payment receipt email" → "Payment receipt email sent to parent"
   - PAY-007: Updated to note admin notifies parent AND student on bank confirmation

2. **Section 10.5 Financial Calculations:**
   - Added a note at the top: "All payment actions are parent-only."
   - Added "Subject Price Resolution" formula block for the new `isOfferedAtSchool` model
   - Updated "Registration Total" comment: "Escrow applied by parent at checkout"
   - Updated "Swap Price Difference" comment: "Parent pays the difference"
   - Removed the "Type Switch Price Difference" block entirely (no more registration type switching)

**Still Needs Work:**
- The payment gateway integrations (Fawry, Paymob, wallets) need the payer identity validated as a parent on the backend — this is a middleware check, not just a frontend restriction
- Webhook handlers must also validate that the payment was initiated by a parent before confirming the registration

---

### ACT-008 — Development Plan Alignment: Swap and Change Request Workflow

| Field | Value |
|-------|-------|
| Code | ACT-008 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `ARCHITECTURE` + `PLANNING` |
| Status | Active |
| Overwrites | SWAP stories mapping, swap validation schemas, swap service, swap routes in `DEVELOPMENT_PLAN.md` |

**Intent:**
Redesign the swap/drop workflow in the development plan to use the same request-approval model as registration: students submit change requests, parents approve or reject them. Also remove the "switch registration type" story (SWAP-003 v1.0) which no longer exists in URD v2.0.

**Rationale:**
Consistent with the approval model (see ACT-006), students should not be able to directly drop or swap subjects without parent knowledge and consent. This ensures:
- Parents remain in control of their child's academic and financial decisions
- No subject can be dropped (and no escrow credit created) without parent approval
- The audit trail can show the full "requested by → approved by → processed by" chain for drops and swaps

The "switch registration type" story (v1.0 SWAP-003) is removed because the `in_school`/`external` pricing distinction no longer exists in the system (see ACT-004).

**Result:**
The swap/change request flow now mirrors the registration approval flow. Students request, parents decide. A new `change_request` concept is introduced at the planning level.

**Action Taken:**
File modified: `DEVELOPMENT_PLAN.md`

1. **SWAP stories mapping table (Section 8):**
   - SWAP-001: "Full refund to escrow" → "Student submits DROP REQUEST → pending_approval"
   - SWAP-002: "Price diff calculation" → "Student submits SWAP REQUEST with price diff shown → pending_approval"
   - SWAP-003 (v1.0): "In-school ↔ External" → **Removed entirely** (this story no longer exists)
   - SWAP-003 (v2.0): New entry — "Parent approves/rejects drop/swap, processes financials"
   - SWAP-004: "Same as student for linked child" → "Parent: auto-approved, immediate financial processing, child notified"
   - SWAP-007: Added — "Student views pending change requests with status and parent comments"

2. **Swap validation schemas (Step 3.4):**
   - Removed: `DropSubject`, `SwapSubject`, `SwitchType`
   - Added: `RequestDrop`, `RequestSwap`, `ApproveChangeRequest`, `RejectChangeRequest`

3. **Swap service functions (Step 3.4):**
   - Removed: `dropSubject`, `swapSubject`, `switchRegistrationType`
   - Added: `createDropRequest`, `createSwapRequest` (student flows)
   - Added: `approveChangeRequest`, `rejectChangeRequest` (parent flows)
   - Added: `executeDirectDrop`, `executeDirectSwap` (parent direct flows)
   - Added: `getPendingChangeRequests(studentId)`, `getPendingChangeRequestsForParent(parentId)`

4. **Swap routes (Step 3.4):**
   - Removed: `POST /registrations/:id/switch-type`
   - Added: `POST /registrations/:id/request-drop`, `POST /registrations/:id/request-swap`
   - Added: `PUT /change-requests/:id/approve`, `PUT /change-requests/:id/reject`
   - Added: `GET /change-requests` (role-aware endpoint)

**Still Needs Work:**
- A dedicated `change_request` table may be needed in the database schema to separately track drop/swap requests without mutating the original `registration` row — this should be evaluated when building Phase 3 (the table design was not added to the development plan yet)
- The `executeDirectDrop` / `executeDirectSwap` flows must be atomic DB transactions (escrow credit/debit + registration status update in the same transaction)

---

### ACT-009 — Development Plan Alignment: Escrow Access Restrictions

| Field | Value |
|-------|-------|
| Code | ACT-009 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `ARCHITECTURE` + `PLANNING` |
| Status | Active |
| Overwrites | ESC stories mapping, escrow service, escrow routes, and data isolation rules in `DEVELOPMENT_PLAN.md` |

**Intent:**
Update the escrow section of the development plan to reflect that students have read-only escrow access and all transactional escrow operations (withdrawal requests, payments, transfers) are parent-only.

**Rationale:**
In URD v1.0, both students and parents could request escrow withdrawals independently (ESC-004 for students, ESC-005 for parents). URD v2.0 removes the student withdrawal path entirely. Students can see their balance and transaction history, but cannot initiate any action. All escrow operations that move money (payments, transfers, withdrawals) are exclusively parent-controlled.

This is consistent with the broader principle in URD v2.0 that parents are the sole financial decision-makers.

**Result:**
Escrow section reduced from 8 stories to 7 stories. Student escrow access is clearly marked as read-only. Withdrawal request is parent-only with both parent and student notified on fulfillment.

**Action Taken:**
File modified: `DEVELOPMENT_PLAN.md`

1. **ESC stories mapping table (Section 8) — renumbered and updated:**
   - ESC-001: Added clarification "read-only; no transactional actions"
   - ESC-002: Added clarification "parent has full escrow control"
   - ESC-003: Unchanged (parent transfers between children)
   - ESC-004 (v2.0): Was v1.0 ESC-005 "Parent requests withdrawal" — now clearly stated as parent-only
   - ESC-005 (v2.0): Was v1.0 ESC-006 — admin views requests; now includes parent name in the list
   - ESC-006 (v2.0): Was v1.0 ESC-007 — admin fulfills; now notifies parent AND student
   - ESC-007 (v2.0): Was v1.0 ESC-008 — withdrawal history; now parent-only view per child
   - **Removed:** v1.0 ESC-004 "Student requests withdrawal" — no longer in the system

2. **Escrow service functions (Step 3.3):**
   - `createWithdrawalRequest(studentId, amount, requestedBy)` → `createWithdrawalRequest(studentId, amount, parentId)` — parent-only; validates parent-child link
   - `fulfillWithdrawalRequest` — updated note to notify parent AND student
   - `getWithdrawalRequests(studentId)` → `getWithdrawalRequestsForParent(parentId)` — parent view only
   - `getPendingWithdrawalRequests()` — updated note to include parent name in results

3. **Escrow routes (Step 3.3):**
   - `GET /escrow` — updated to clarify: student gets own read-only; parent gets own children
   - `POST /escrow/withdraw` — updated to clarify: parent-only, specifying which child
   - `GET /escrow/withdrawals` — updated to clarify: parent views children's withdrawal history

4. **Section 10.2 Data Isolation Rules:**
   - Students section: "escrow" → "own escrow balance and transaction history (read-only; cannot initiate payments or withdrawals)"
   - Parents section: "Linked children's registrations, escrow" → "Linked children's registrations, escrow (full control: pay, transfer, withdraw)"
   - Added: Students can see own pending change requests
   - Added: Parents can see pending registration/change requests from linked children
   - Admin section: Added note about override capability being audit logged

**Still Needs Work:**
- The read-only enforcement for students' escrow access must be implemented at the API middleware level, not just the frontend — a student hitting `POST /escrow/withdraw` should get a 403
- When a parent is linked to multiple children, the withdrawal history endpoint must aggregate and clearly label which child each request belongs to

---

### ACT-010 — Development Plan Alignment: Notification Structure Overhaul

| Field | Value |
|-------|-------|
| Code | ACT-010 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `PLANNING` |
| Status | Active |
| Overwrites | Phase 4 notification stories mapping in `DEVELOPMENT_PLAN.md` |

**Intent:**
Update the Phase 4 notification stories mapping from 8 entries to 11, aligned with the new NOT-001 to NOT-011 structure in URD v2.0, which now covers the entire request-approval notification chain.

**Rationale:**
The v1.0 notifications were designed for a direct-action model: "user does X → user gets email about X." With the approval workflow introduced in URD v2.0, there are now distinct notification points at each step of the chain:
- When a student submits a request → parent notified
- When a parent approves or rejects → student notified
- When payment completes → parent receives receipt
- When a student requests a drop/swap → parent notified
- When a parent decides on a drop/swap → student notified

This doubles the notification surface compared to v1.0 and requires the notification service to be aware of parent-child relationships for routing.

**Result:**
Notification stories mapping updated to 11 entries with clear descriptions of who receives what at each step.

**Action Taken:**
File modified: `DEVELOPMENT_PLAN.md`

1. **Notification stories mapping table (Section 9):**
   - Replaced the entire 8-row table with an 11-row table
   - NOT-003: "Registration confirmed" → "Parent notified when child submits registration request (with approve/reject link)"
   - NOT-004: Added — "Student notified of registration request decision with parent comments"
   - NOT-005: Added — "Parent receives payment receipt"
   - NOT-006: Added — "Parent notified when child requests drop/swap (with approve/reject link)"
   - NOT-007: Added — "Student notified when drop/swap request is processed by parent"
   - NOT-008: "Escrow balance change" → parent-only
   - NOT-009: "Withdrawal fulfilled" → parent-only
   - NOT-010: "Parent all-child notifications" → enhanced with audit trail info
   - NOT-011: Renumbered from NOT-008; admin bulk announcements (unchanged)

2. **Phase 4 Deliverables Checklist:**
   - Split "Notification triggers" into separate line items by flow:
     - Request-approval flow notifications (NOT-003, NOT-004, NOT-006, NOT-007)
     - Payment/escrow/withdrawal notifications (NOT-005, NOT-008, NOT-009)
     - Parent auto-CC system (NOT-010)

**Still Needs Work:**
- The notification service must resolve parent recipients dynamically at send time: when notifying a student, the service must also look up all approved linked parents and send them a copy — this requires an efficient query (ideally a denormalized parent lookup)
- Email templates for the approve/reject notification flow need to include deep links to the approvals page

---

### ACT-011 — Development Plan Alignment: Reports and Audit Trail Updates

| Field | Value |
|-------|-------|
| Code | ACT-011 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `PLANNING` |
| Status | Active |
| Overwrites | Phase 4 reports stories mapping and report service in `DEVELOPMENT_PLAN.md` |

**Intent:**
Update the reports section to: (1) reflect the "school vs. non-school" breakdown replacing the "in-school vs. external" breakdown, (2) add the chain-of-custody display to the audit trail, (3) add the pending approval requests count to the admin dashboard, and (4) add the new REP-009 pending approvals report.

**Rationale:**
The reporting requirements change in two ways with URD v2.0:
- The pricing model change (ACT-004) means "in-school vs. external" breakdowns no longer exist — they are replaced by "school vs. non-school" subject breakdowns
- The approval workflow (ACT-006) means reports must show who requested, who approved, and who processed each registration — this is the "chain of custody" requirement in REP-006
- The volume of pending approval requests becomes operationally significant — admins need a dedicated report to monitor outstanding requests

**Result:**
Reports section updated with correct breakdowns and new REP-009. Report service function added for pending approvals.

**Action Taken:**
File modified: `DEVELOPMENT_PLAN.md`

1. **Reports stories mapping table (Section 9):**
   - REP-001: Added "approval trail" to columns; filter changed from "registration type" to "approval status"
   - REP-002: "in-school vs. external" → "school vs. non-school subjects"
   - REP-004: "in-school vs. external" → "school vs. non-school"
   - REP-005: Added "with approval status column"
   - REP-006: Updated to note full chain: "Requested by → Approved by → Processed by"
   - REP-008: Added "pending approval requests count" to dashboard metrics
   - REP-009: Added — "Pending approvals report with age of requests"

2. **Report service functions (Step 4.3):**
   - `generateRegistrationReport` — added note: "Includes approval trail columns"
   - `generateFinancialSummary` — added note: "School vs. non-school subject breakdown"
   - `generateSubjectEnrollmentReport` — added note: "School vs. non-school breakdown"
   - `generateGrade10ComplianceReport` — added note: "Includes approval status"
   - Added: `generatePendingApprovalsReport()` — all pending registration/change requests with age
   - `getAdminDashboardMetrics()` — added note: "Includes pending approval requests count"

3. **Phase 4 admin web pages (Step 4.5):**
   - `admin/reports/page.tsx` — added note: "includes pending approvals report"
   - `admin/audit/page.tsx` — added note: "chain-of-custody display"
   - `admin/dashboard/page.tsx` — added note: "includes pending approvals count"

**Still Needs Work:**
- The "age of pending requests" field in REP-009 requires computing `now() - created_at` — for large datasets this should be indexed
- The audit trail chain display requires that the `approvedBy` and `requestedBy` fields are always populated correctly (see ACT-006 registration schema changes)

---

### ACT-012 — Development Plan Alignment: Graduation Plan Feature (P3)

| Field | Value |
|-------|-------|
| Code | ACT-012 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `PLANNING` + `SCHEMA` |
| Status | Active |
| Overwrites | — (new content, nothing overwritten) |

**Intent:**
Add a deferred post-launch section to Phase 4 covering the Graduation Plan & Career Visualization feature (GRAD-001 to GRAD-007), including a preliminary database schema and service stub.

**Rationale:**
URD v2.0 adds a new Section 12 with 7 P3 user stories covering a graduation plan tool. These stories are:
- GRAD-001: Student sets career goal
- GRAD-002: Student creates a visual graduation timeline
- GRAD-003: Student adds subjects to the plan per grade/session
- GRAD-004: Student views plan progress (completed vs. planned)
- GRAD-005: Student shares plan with parents
- GRAD-006: Student shares plan with headmistress
- GRAD-007: Parent views child's graduation plan

These are all P3 (nice to have, post-launch) and do not block any other feature. However, documenting the intended schema early avoids schema debt later.

**Result:**
Phase 4 now includes a Step 4.6 section with the graduation plan schema design and planned service/page structure, clearly marked as P3 and deferred.

**Action Taken:**
File modified: `DEVELOPMENT_PLAN.md`

1. Added **Step 4.6** before Phase 4 deliverables checklist:
   - Description: "P3 — Post-Launch, does not block any P0 or P1 features"
   - Two new tables: `graduation_plan` (studentId, careerGoal, careerDescription) and `graduation_plan_entry` (planId, subjectId, plannedGrade, plannedSession)
   - New planned service: `graduation-plan.services.ts`
   - New planned pages: `graduation-plan/page.tsx` (interactive timeline), `graduation-plan/career/page.tsx` (career goal)

**Still Needs Work:**
- The `headmistress` role referenced in GRAD-006 is not currently in the role system — when implementing this feature, a decision must be made: add a `headmistress` role, or grant access via a special admin sub-role/permission
- The "interactive timeline" in GRAD-002 is a frontend-heavy feature — a charting or timeline library will need to be selected

---

### ACT-013 — Development Plan Alignment: Cross-Cutting Concerns and Appendices

| Field | Value |
|-------|-------|
| Code | ACT-013 |
| Date | 2026-03-01 |
| Time | Session 1 |
| Type | `ARCHITECTURE` + `PLANNING` |
| Status | Active |
| Overwrites | Section 10.1 (Authorization Matrix), Section 10.3 (Validation Checkpoints), Section 11.3 (Price Snapshot Pattern), Appendix A (API Routes), Appendix E (Web Pages) in `DEVELOPMENT_PLAN.md` |

**Intent:**
Update all cross-cutting documentation sections and appendices to be consistent with the changes introduced in ACT-004 through ACT-012.

**Rationale:**
After updating all the phase-specific sections, the cross-cutting sections (authorization matrix, data isolation, validation checkpoints, financial calculations, patterns) and appendices (route summary, web pages structure) still contained v1.0 assumptions. These needed to be updated to provide a coherent, non-contradictory reference for developers.

**Result:**
All cross-cutting sections and appendices now reflect URD v2.0 and the updated workflow design.

**Action Taken:**
File modified: `DEVELOPMENT_PLAN.md`

1. **Section 10.1 Authorization Matrix** — added new rows:
   - `PUT /sessions/:id` (active window edit) — admin only
   - `POST /registrations/request` — student only
   - `POST /registrations/direct` — parent only (child)
   - `PUT /registrations/approve` — parent only (child)
   - `POST /registrations/checkout` — parent only (child)
   - `POST /registrations/:id/request-drop` — student only
   - `POST /registrations/:id/drop` — parent only (child)
   - `PUT /change-requests/:id/approve` — parent only (child)
   - `GET /escrow` — student (own, read-only), parent (children)
   - `POST /escrow/withdraw` — parent only (child)

2. **Section 10.2 Data Isolation Rules** — updated all three roles:
   - Students: escrow is now explicitly "read-only; cannot initiate payments or withdrawals"; added "own pending change requests"
   - Parents: escrow clarified as "full control"; added "pending registration/change requests from linked children"
   - Admins: added "can override parent approval for exceptional cases (audit logged)"

3. **Section 10.3 Validation Checkpoints** — restructured and expanded:
   - Replaced flat "Before Registration" block with separate blocks for:
     - "Before Submitting Request (student) / Direct Registration (parent)"
     - "Before Parent Approves Registration"
     - "Before Payment / Checkout" — added parent-only payer check
     - "Before Drop/Swap Request (student) / Direct Drop/Swap (parent)"
     - "Before Parent Approves Drop/Swap"
     - "Before Escrow Operations" — added parent-only withdrawal check
   - Removed: "External option available if selected" check (no more external option)

4. **Section 11.3 Price Snapshot Pattern** — updated code example:
   - Old: `registrationType === 'in_school' ? subject.priceInSchool : subject.priceExternal`
   - New: `subject.isOfferedAtSchool ? subject.priceInSchool : subject.customPrice`
   - Added note: "There is no longer a `registrationType` field on registrations."

5. **Appendix A — API Route Summary:**
   - Registrations block: replaced 3 routes with 8 routes reflecting request/approve/direct/checkout flow
   - Added "Change Requests" block: `request-drop`, `request-swap`, `approve`, `reject`, `GET /change-requests`
   - Removed: `POST /registrations/:id/switch-type`
   - Payments block: added parent-only comments
   - Escrow block: added role-aware comments
   - Admin block: added `GET /v1/admin/reports/pending-approvals` and `POST /v1/admin/registrations/override`

6. **Appendix E — Web Pages Structure:**
   - Added: `pending-requests/page.tsx` (student) with inline comment
   - Added: `approvals/page.tsx` (parent) with inline comment
   - `escrow/` folder: `withdraw/` → added `transfer/` alongside it
   - `registrations/page.tsx` — added comment: "shows approval status"
   - `registrations/history/page.tsx` — added comment: "approval trail included"
   - `escrow/page.tsx` — added comment: "student: read-only; parent: full control per child"
   - Admin pages: added inline comments for dashboard, reports, audit changes

**Still Needs Work:**
- Appendix B (Database Tables Summary) and Appendix D (Service Files) were not updated in this session — minor additions from the new change request concept and graduation plan tables should be added when those are finalized
- The `change_request` table is referenced in service functions but not yet added to Appendix B — this needs a formal schema definition (see ACT-008 notes)

---

## Open Items Registry

Items flagged as "Still Needs Work" across this session, consolidated for easy tracking:

| Ref | Source | Item | Priority |
|-----|--------|------|----------|
| OI-001 | ACT-002 | Email verification flow (AUTH-001, AUTH-002) not yet implemented in codebase | P0 |
| OI-002 | ACT-002 | `headmistress` role needed for GRAD-006 — not in current role system | P3 |
| OI-003 | ACT-004 | `packages/db/src/schema.ts` not yet updated with new subject pricing fields | ~~P0 (before Phase 2)~~ **Resolved in ACT-015** |
| OI-004 | ACT-005 | Session unique constraint must enforce per `sessionType`, not globally | P0 (before Phase 2) |
| OI-005 | ACT-005 | Active window deadline edit UI must prompt for a reason (audit log) | P1 |
| OI-006 | ACT-006 | `change_request` table design not yet added to Appendix B or schema | P0 (before Phase 3) |
| OI-007 | ACT-006 | `adminOverrideApproval` route needs strict permission guard + mandatory audit log | P1 |
| OI-008 | ACT-007 | Payment gateway webhook handlers must validate payer is a linked parent | P0 (before Phase 3) |
| OI-009 | ACT-008 | `executeDirectDrop` / `executeDirectSwap` must use atomic DB transactions | P0 (before Phase 3) |
| OI-010 | ACT-009 | Student escrow read-only must be enforced at API level (not just frontend) | P0 (before Phase 3) |
| OI-011 | ACT-010 | Notification service needs efficient parent-lookup query for auto-CC | P1 |
| OI-012 | ACT-011 | Age-of-pending-request field in REP-009 should be indexed for performance | P2 |
| OI-013 | ACT-012 | `headmistress` role decision needed when implementing graduation plan | P3 |
| OI-014 | ACT-013 | Appendix B (DB Tables) and Appendix D (Service Files) not updated with `change_request` and `graduation_plan` | P2 |

---

## Session: 2026-03-01 — Phase 2 Implementation

---

### ACT-015 — Subject Table: Schema + Migration

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-015                      |
| Date        | 2026-03-01                   |
| Time        | (session)                    |
| Type        | Schema Change                |
| Status      | Active                       |
| Overwrites  | OI-003 (resolved)            |

**Intent:** Add the `subject` table to the database schema and generate the corresponding Drizzle migration, as the first step of Phase 2.

**Rationale:** Subjects are the foundational entity for the entire reservation system. No registration windows, registrations, payments, or reports can exist without subjects. This is the correct first move for Phase 2 per the development plan.

**Result:** A fully typed `subject` table was added to `packages/db/src/schema.ts`. A new migration file `0007_slim_fat_cobra.sql` was generated and is ready to apply.

**Action Taken:**
- `packages/db/src/schema.ts` — Added `doublePrecision` to the pg-core import. Added the `subject` table with fields: `id` (PK), `name`, `code` (unique), `council`, `priceInSchool` (doublePrecision), `isOfferedAtSchool` (boolean, default true), `customPrice` (doublePrecision, nullable), `isActive` (boolean, default true), `isCore` (boolean, default false), `createdAt`, `updatedAt`. Added 4 indexes on `code`, `council`, `isActive`, and `isCore`.
- `packages/db/drizzle/0007_slim_fat_cobra.sql` — Auto-generated migration file for the new subject table.

**Still Needs Work:**
- Migration needs to be applied to the database when a live DB environment is available (`pnpm db:migrate`).

---

### ACT-016 — Subject Validation Schemas

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-016                      |
| Date        | 2026-03-01                   |
| Time        | (session)                    |
| Type        | Validation / Schema          |
| Status      | Active                       |
| Overwrites  | None                         |

**Intent:** Create Zod validation schemas for all subject-related API operations, shared across API and web.

**Rationale:** Shared Zod schemas ensure type safety end-to-end (API validation, RPC client, and web forms). They enforce the business rule that `customPrice` is mandatory when `isOfferedAtSchool` is false.

**Result:** `packages/validations/src/subject/subject.validations.ts` created with `COUNCILS` constant, `CouncilSchema`, `COUNCIL_LABELS`, `CreateSubject`, `UpdateSubject`, `SetSubjectCore`, `SubjectId`, and `ListSubjectsQuery` schemas. Exported from `packages/validations/src/index.ts`. Validated against Zod v4 API (removed deprecated `required_error`/`invalid_type_error` constructor options).

**Action Taken:**
- `packages/validations/src/subject/subject.validations.ts` — Created with full Zod v4-compatible schemas and the `isOfferedAtSchool → customPrice` business rule enforced via `.refine()`.
- `packages/validations/src/index.ts` — Added `export * from './subject/subject.validations'`.

**Still Needs Work:**
- None at this time.

---

### ACT-017 — Subject Service (API Business Logic)

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-017                      |
| Date        | 2026-03-01                   |
| Time        | (session)                    |
| Type        | Feature (Service)            |
| Status      | Active                       |
| Overwrites  | None                         |

**Intent:** Implement the full subject service layer at `apps/api/src/services/subject.services.ts` covering all CRUD, soft-delete, and core-flag operations.

**Rationale:** Following the established service pattern: pure business logic with no HTTP concerns, all DB imports from `@repo/db`, typed using validation schemas from `@repo/validations`.

**Result:** Service file created with 7 exported functions: `isCodeUnique`, `subjectExists`, `createSubject`, `getSubjects`, `getSubjectById`, `updateSubject`, `deactivateSubject`, `activateSubject`, `setSubjectCore`.

**Action Taken:**
- `apps/api/src/services/subject.services.ts` — Created with full service implementation. `getSubjects` supports dynamic filters (council, search, isActive, isCore). Soft-delete via `deactivateSubject`/`activateSubject`. Code uniqueness validated before create/update.

**Still Needs Work:**
- None at this time.

---

### ACT-018 — Subject API Routes

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-018                      |
| Date        | 2026-03-01                   |
| Time        | (session)                    |
| Type        | Feature (API Routes)         |
| Status      | Active                       |
| Overwrites  | None                         |

**Intent:** Implement and mount the subject HTTP routes, enforcing role-based access: public read (authenticated), admin-only write.

**Rationale:** Subjects need to be browsable by all authenticated users (students, parents) but only modifiable by admins. The existing `requireAuth`/`requireAdmin` middleware provides this.

**Result:** 7 routes created and mounted at `/v1/subjects`. Non-admin `GET /subjects` always receives active subjects only. Conflict detection (409) on duplicate subject codes. Proper 404 responses for missing subjects.

**Action Taken:**
- `apps/api/src/routes/subject.routes.ts` — Created with routes: `GET /`, `GET /:id`, `POST /` (admin), `PUT /:id` (admin), `DELETE /:id` (admin, soft), `PUT /:id/core` (admin), `PUT /:id/activate` (admin). Exported as `SubjectsApi` for RPC type inference.
- `apps/api/src/index.ts` — Imported `subjects` and mounted at `.route('/subjects', subjects)`. Updated route comment documentation block.

**Still Needs Work:**
- None at this time.

---

### ACT-019 — Admin Subject Management Web Page

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-019                      |
| Date        | 2026-03-01                   |
| Time        | (session)                    |
| Type        | Feature (Web UI)             |
| Status      | Active                       |
| Overwrites  | None                         |

**Intent:** Build the admin subject management interface at `/admin/subjects` — full CRUD with server-side prefetch and type-safe RPC client calls.

**Rationale:** Admins need a functional UI to create, update, deactivate, and designate core subjects before any registration windows or registrations can be tested. Follows the server-component + HydrationBoundary + client-component pattern established in the codebase.

**Result:** Two-file implementation: `page.tsx` (server component, admin gate, SSR prefetch) and `subjects-admin.client.tsx` (client component, full CRUD). Features: modal create/edit form, subject table with inline activate/deactivate/core toggle, search and filter bar (council, status, text search), EGP price display.

**Action Taken:**
- `apps/web/app/admin/subjects/page.tsx` — Server component: calls `requireAdmin()`, prefetches all subjects, wraps in `HydrationBoundary`.
- `apps/web/app/admin/subjects/subjects-admin.client.tsx` — Client component with full CRUD mutations via Hono RPC, modal form, inline status/core toggles, and client-side search/filter.

**Still Needs Work:**
- No admin layout/navbar has been built yet — page is accessible but navigation must be done via direct URL until Phase 4 navigation scaffolding.

---

### ACT-020 — Subject Browse Web Page (Students & Parents)

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-020                      |
| Date        | 2026-03-01                   |
| Time        | (session)                    |
| Type        | Feature (Web UI)             |
| Status      | Active                       |
| Overwrites  | None                         |

**Intent:** Build the public subject browse page at `/subjects` for students and parents — searchable, filterable card grid with detail modal.

**Rationale:** Students and parents need to view available subjects, their prices, council affiliations, and core designations before they can make registration decisions. This page is the read-facing counterpart to the admin management page.

**Result:** Two-file implementation: `page.tsx` (server component, auth gate, SSR prefetch) and `subjects-browse.client.tsx` (client component). Features: card grid grouped by council, search by name/code, council filter, core-only toggle, subject detail modal showing effective price (school vs. external), admin "Manage Subjects" shortcut link.

**Action Taken:**
- `apps/web/app/subjects/page.tsx` — Server component: calls `requireAuth()`, prefetches active subjects, passes `userRole` to client for admin shortcut.
- `apps/web/app/subjects/subjects-browse.client.tsx` — Client component with `SubjectGrid` and `SubjectDetailModal` sub-components, council grouping, and complete filter logic.

**Still Needs Work:**
- None at this time.

---

### ACT-021 — Pre-existing Bug Fix: `ROLES.COACH` in Session Util

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-021                      |
| Date        | 2026-03-01                   |
| Time        | (session)                    |
| Type        | Bug Fix                      |
| Status      | Active                       |
| Overwrites  | None                         |

**Intent:** Fix a pre-existing TypeScript error in `apps/web/lib/auth/session.ts` where a `requireCoach` helper referenced `ROLES.COACH` which does not exist in this project's role system.

**Rationale:** Discovered during web typecheck phase. The error blocked clean compilation. The system has no coach role; the correct pattern for new role helpers follows `requireAdmin`/`requireStudent`.

**Result:** `requireCoach` removed and replaced with `requireParent`, which is the third primary role in the system and was missing.

**Action Taken:**
- `apps/web/lib/auth/session.ts` — Replaced `export const requireCoach = () => requireRole(ROLES.COACH)` with `export const requireParent = () => requireRole(ROLES.PARENT)`.

**Still Needs Work:**
- None.

---

## Open Items Registry

| Ref | Source | Item | Priority |
|-----|--------|------|----------|
| OI-001 | ACT-002 | Email verification flow (AUTH-001, AUTH-002) not yet implemented in codebase | P0 |
| OI-002 | ACT-002 | `headmistress` role needed for GRAD-006 — not in current role system | P3 |
| OI-003 | ACT-004 | ~~`packages/db/src/schema.ts` not yet updated with new subject pricing fields~~ **Resolved in ACT-015** | ~~P0~~ Done |
| OI-004 | ACT-005 | Session unique constraint must enforce per `sessionType`, not globally | ~~P0 (before Phase 2 Step 2)~~ **Resolved in ACT-022** |
| OI-005 | ACT-005 | Active window deadline edit UI must prompt for a reason (audit log) | P1 |
| OI-006 | ACT-006 | `change_request` table design not yet added to Appendix B or schema | P0 (before Phase 3) |
| OI-007 | ACT-006 | `adminOverrideApproval` route needs strict permission guard + mandatory audit log | P1 |
| OI-008 | ACT-007 | Payment gateway webhook handlers must validate payer is a linked parent | P0 (before Phase 3) |
| OI-009 | ACT-008 | `executeDirectDrop` / `executeDirectSwap` must use atomic DB transactions | P0 (before Phase 3) |
| OI-010 | ACT-009 | Student escrow read-only must be enforced at API level (not just frontend) | P0 (before Phase 3) |
| OI-011 | ACT-010 | Notification service needs efficient parent-lookup query for auto-CC | P1 |
| OI-012 | ACT-011 | Age-of-pending-request field in REP-009 should be indexed for performance | P2 |
| OI-013 | ACT-012 | `headmistress` role decision needed when implementing graduation plan | P3 |
| OI-014 | ACT-013 | Appendix B (DB Tables) and Appendix D (Service Files) not updated with `change_request` and `graduation_plan` | P2 |
| OI-005 | ACT-005 | Active window deadline edit UI must prompt for a reason (audit log) | ~~P1~~ **Resolved in ACT-023/ACT-025** |
| OI-015 | ACT-019/020 | Admin layout/navbar not yet built — `/admin/subjects` and `/admin/sessions` accessible only via direct URL | P1 |
| OI-016 | ACT-015 | Migration `0007_slim_fat_cobra.sql` generated but not yet applied to live DB | P0 (when DB is available) |
| OI-017 | ACT-022 | Migration `0008_cheerful_wendell_vaughn.sql` generated but not yet applied to live DB | P0 (when DB is available) |

---

## Session: 2026-03-03 — Phase 2 Step 2

---

### ACT-022 — Registration Session Table: Schema + Migration

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-022                      |
| Date        | 2026-03-03                   |
| Time        | (session)                    |
| Type        | Schema Change                |
| Status      | Active                       |
| Overwrites  | OI-004 (resolved)            |

**Intent:** Add the `registration_session` table to the database schema and generate the corresponding migration, including the partial unique index enforcing one active session per `sessionType` at a time.

**Rationale:** Registration windows are the second foundational entity. No student can register a subject without an active session. The partial unique index (`WHERE status = 'active'`) is the correct DB-level enforcement of the business rule that two sessions of the same type cannot be active simultaneously. Multiple types (e.g., June and November) may still be active at the same time.

**Result:** `registration_session` table added to schema with 11 columns and 3 indexes. `editHistory` JSONB column stores the audit trail for any deadline changes made while a session is active. Migration `0008_cheerful_wendell_vaughn.sql` generated, confirming the partial unique index SQL: `CREATE UNIQUE INDEX ... WHERE status = 'active'`.

**Action Taken:**
- `packages/db/src/schema.ts` — Added `sql`, `jsonb`, `uniqueIndex` to imports. Added `SessionEditEntry` type. Added `registrationSession` table with all required fields including FK to `user.id` for `closedBy` (ON DELETE SET NULL). Added partial unique index `one_active_per_session_type_idx`.
- `packages/db/drizzle/0008_cheerful_wendell_vaughn.sql` — Auto-generated migration with correct partial unique index.

**Still Needs Work:**
- Migration must be applied to the live DB when available (OI-017).

---

### ACT-023 — Registration Session Validation Schemas

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-023                      |
| Date        | 2026-03-03                   |
| Time        | (session)                    |
| Type        | Validation / Schema          |
| Status      | Active                       |
| Overwrites  | None                         |

**Intent:** Create Zod validation schemas for all session management operations.

**Rationale:** Two separate schemas for update operations (`UpdateDraftSession` vs `UpdateActiveSession`) enforce the business rule that draft sessions allow all-field edits while active sessions permit only endDate extension with a mandatory audit reason. Shared between API and web client for type safety end-to-end.

**Result:** `packages/validations/src/session/session.validations.ts` created with `SESSION_TYPES`, `SESSION_STATUSES`, `SessionTypeSchema`, `SessionStatusSchema`, `SESSION_TYPE_LABELS`, `CreateSession`, `UpdateDraftSession`, `UpdateActiveSession`, `UpdateSession` (union), `CloseSession`, `SessionId`, `ListSessionsQuery`.

**Action Taken:**
- `packages/validations/src/session/session.validations.ts` — Created.
- `packages/validations/src/index.ts` — Added `export * from './session/session.validations'`.

**Still Needs Work:**
- None.

---

### ACT-024 — Registration Session Service

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-024                      |
| Date        | 2026-03-03                   |
| Time        | (session)                    |
| Type        | Feature (Service)            |
| Status      | Active                       |
| Overwrites  | None                         |

**Intent:** Implement the full session service layer with lifecycle management (draft → active → closed), active-session conflict detection, deadline extension with audit logging, and batch auto-management for the background job.

**Rationale:** Service layer owns all business rules. The double-check pattern (service-level guard + DB partial unique index) ensures the constraint is enforced both with a meaningful error message and at the database level. `autoManageSessions()` combines auto-open and auto-close into one atomic function to avoid race conditions.

**Result:** Service file created with 10 exported functions: `sessionExists`, `getSessionById`, `getSessions`, `getActiveSessions`, `getActiveSession`, `hasActiveSessionOfType`, `createSession`, `updateDraftSession`, `extendActiveSessionDeadline`, `activateSession`, `closeSession`, `autoManageSessions`.

**Action Taken:**
- `apps/api/src/services/session.services.ts` — Created with full implementation.

**Still Needs Work:**
- None.

---

### ACT-025 — Session Auto-Close / Auto-Open Scheduler

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-025                      |
| Date        | 2026-03-03                   |
| Time        | (session)                    |
| Type        | Feature (Background Job)     |
| Status      | Active                       |
| Overwrites  | None                         |

**Intent:** Implement a 60-second interval scheduler that automatically opens draft sessions when their `startDate` arrives and closes active sessions when their `endDate` passes.

**Rationale:** Removes the need for manual admin intervention on every session transition. Runs immediately on server startup to catch any sessions that expired while the server was offline. Uses Node.js `setInterval` as the MVP approach; production replacement would be BullMQ or an external cron.

**Result:** `apps/api/src/jobs/session-closer.ts` created with `startSessionScheduler()` and `stopSessionScheduler()` functions. Scheduler is started from `apps/api/src/index.ts` just before `serve()`.

**Action Taken:**
- `apps/api/src/jobs/session-closer.ts` — Created.
- `apps/api/src/index.ts` — Added import and `startSessionScheduler()` call before `serve()`.

**Still Needs Work:**
- Replace with a distributed queue (BullMQ) before multi-instance deployment to avoid duplicate ticks.

---

### ACT-026 — Session API Routes

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-026                      |
| Date        | 2026-03-03                   |
| Time        | (session)                    |
| Type        | Feature (API Routes)         |
| Status      | Active                       |
| Overwrites  | None                         |

**Intent:** Implement and mount the 7 session HTTP routes, with status-aware update logic (draft vs active validation handled at the route layer).

**Rationale:** The `PUT /sessions/:id` route dynamically selects the appropriate validation schema based on the session's current status, ensuring the business rule about active-session-only-endDate is enforced at the API boundary with a proper validation error response.

**Result:** 7 routes created and mounted at `/v1/sessions`. Conflict errors (409) returned when active-session uniqueness constraint would be violated. Status-aware updates with distinct Zod schemas per session state. `GET /sessions/active` is accessible to all authenticated users.

**Action Taken:**
- `apps/api/src/routes/session.routes.ts` — Created.
- `apps/api/src/index.ts` — Imported `sessions`, mounted at `.route('/sessions', sessions)`, updated documentation comment block.

**Still Needs Work:**
- None.

---

### ACT-027 — Admin Session Management Web Page

| Field       | Value                        |
|-------------|------------------------------|
| Code        | ACT-027                      |
| Date        | 2026-03-03                   |
| Time        | (session)                    |
| Type        | Feature (Web UI)             |
| Status      | Active                       |
| Overwrites  | None                         |

**Intent:** Build the admin session management interface at `/admin/sessions` — full lifecycle control with audit-logged deadline extension and status-aware action buttons.

**Rationale:** Admins need a dedicated UI to create registration windows, activate drafts, extend deadlines with a justification, close sessions early, and review the full edit history for compliance and auditability.

**Result:** Two-file implementation: `page.tsx` (server component, admin gate, SSR prefetch) and `sessions-admin.client.tsx` (client component). Features: active session summary cards at the top, create modal, status-filter tabs, per-session action row (Activate / Extend Deadline / Close Early), extend-deadline modal with mandatory reason textarea, and edit-history audit modal.

**Action Taken:**
- `apps/web/app/admin/sessions/page.tsx` — Created.
- `apps/web/app/admin/sessions/sessions-admin.client.tsx` — Created. Fixed 3 Tailwind warnings (`dark:[color-scheme:dark]` → `dark:scheme-dark`).

**Still Needs Work:**
- No admin layout/navbar yet — page accessible via direct URL only (OI-015).

---

### ACT-028 — Registration Table: Schema + Relations

| Field       | Value                    |
|-------------|--------------------------|
| Code        | ACT-028                  |
| Date        | 2026-03-04               |
| Time        | (session)                |
| Type        | Database Schema          |
| Status      | Active                   |
| Overwrites  | None                     |

**Intent:** Add the `registration` table and all required relations to `packages/db/src/schema.ts`.

**Rationale:** The registration table is the central entity for Phase 3. It links a student, session, and subject with a price snapshot and full approval chain. A partial unique index at DB level prevents duplicate active registrations for the same student+session+subject combination.

**Result:** Table created with 13 columns and 5 FKs (cascade for studentId, restrict for sessionId/subjectId/requestedBy, set null for approvedBy). Partial unique index `WHERE status NOT IN ('dropped', 'rejected')`. Relations added: `registrationRelations`, `registrationSessionRelations`, `subjectRelations`. `userRelationsExtended` updated to include all three user roles in registrations.

**Action Taken:**
- `packages/db/src/schema.ts` — `registration` table + relations added.

---

### ACT-029 — Registration Validation Schemas

| Field       | Value                    |
|-------------|--------------------------|
| Code        | ACT-029                  |
| Date        | 2026-03-04               |
| Time        | (session)                |
| Type        | Validation               |
| Status      | Active                   |
| Overwrites  | None                     |

**Intent:** Create shared Zod schemas for all registration workflow operations.

**Result:** 9 schemas covering the full lifecycle: `RegistrationStatusSchema`, `RegistrationId`, `RequestRegistration`, `DirectRegistration`, `ApproveRegistrations`, `RejectRegistrations`, `AdminOverrideApproval`, `ListRegistrationsQuery`, `AvailableSubjectsQuery`. All exported from `@repo/validations`.

**Action Taken:**
- `packages/validations/src/registration/registration.validations.ts` — Created.
- `packages/validations/src/index.ts` — Export added.

---

### ACT-030 — Registration Service

| Field       | Value                         |
|-------------|-------------------------------|
| Code        | ACT-030                       |
| Date        | 2026-03-04                    |
| Time        | (session)                     |
| Type        | Service (Business Logic)      |
| Status      | Active                        |
| Overwrites  | None                          |

**Intent:** Implement the complete registration business logic covering REG-001 to REG-007.

**Result:** 10 exported service functions. Key decisions: (1) Price snapshots at registration time using `isOfferedAtSchool ? priceInSchool : (customPrice ?? priceInSchool)`. (2) Core subject validation fires only for Grade 10 + June session. (3) Admin override stores reason as `[ADMIN OVERRIDE] <reason>` in `approvalComments` with `approvedBy = adminId` — provides audit trail in the registration record (resolves OI-007). (4) `getRegistrations` accepts both `studentId` and `studentIds` for multi-child parent queries. (5) `getPendingApprovalRequests` queries all linked children at once, ordered oldest-first.

**Action Taken:**
- `apps/api/src/services/registration.services.ts` — Created.

**Open Items Resolved:** OI-007 (adminOverrideApproval strict admin-only guard + mandatory audit log now implemented).

---

### ACT-031 — Registration API Routes

| Field       | Value                    |
|-------------|--------------------------|
| Code        | ACT-031                  |
| Date        | 2026-03-04               |
| Time        | (session)                |
| Type        | API Routes               |
| Status      | Active                   |
| Overwrites  | None                     |

**Intent:** Expose the registration workflow through 10 typed Hono RPC endpoints with role-based access control.

**Result:** 10 endpoints mounted at `/v1/registrations`. Static routes (`/available`, `/pending`, `/history`) defined before `/:id` to prevent Hono path conflicts. Role-scoped: students see only their own data, parents see all linked children's data, admins have full access with optional filters.

**Action Taken:**
- `apps/api/src/routes/registration.routes.ts` — Created.
- `apps/api/src/index.ts` — Route imported and mounted; route comment block updated.

---

### ACT-032 — Registration DB Migration

| Field       | Value                              |
|-------------|------------------------------------|
| Code        | ACT-032                            |
| Date        | 2026-03-04                         |
| Time        | (session)                          |
| Type        | Database Migration                 |
| Status      | Generated (not yet applied to DB)  |
| Overwrites  | None                               |

**Intent:** Generate Drizzle SQL migration for the `registration` table.

**Result:** `0009_chilly_slipstream.sql` — CREATE TABLE, 5 ALTER TABLE FK constraints with correct cascade types, 5 CREATE INDEX, and the partial unique index: `CREATE UNIQUE INDEX "registration_unique_active_idx" ON "registration" USING btree ("student_id","session_id","subject_id") WHERE status NOT IN ('dropped', 'rejected')`.

**Action Taken:**
- `packages/db/drizzle/0009_chilly_slipstream.sql` — Generated via `pnpm --filter @repo/db db:generate:migrations`.

**Still Needs Work:** OI-019 (new): Migration not yet applied to live DB.

---

### ACT-033 — Registration Web Pages

| Field       | Value                    |
|-------------|--------------------------|
| Code        | ACT-033                  |
| Date        | 2026-03-04               |
| Time        | (session)                |
| Type        | Feature (Web UI)         |
| Status      | Active                   |
| Overwrites  | None                     |

**Intent:** Build three web pages covering the complete student and parent registration UX.

**Result:**
- `/register` — Multi-step role-aware form. Students: select session → select subjects → submit request (pending_approval). Parents: additionally select child first, then direct registration (pending_payment). Core subjects pre-selected and locked for Grade 10 June. Price summary before submission. Handles no active sessions gracefully.
- `/registrations` — Registrations grouped by session. Filterable by status and (for parents) by child. Status badges, price paid, parent comments shown on rejected items, payment prompt on pending_payment items.
- `/approvals` — Parent-only. Registrations grouped by child+session with checkboxes. Sticky action bar for bulk approve/reject. Approve modal with optional comment. Reject modal with mandatory reason enforced both client-side and server-side.

**Action Taken:**
- `apps/web/app/register/page.tsx` — Created.
- `apps/web/app/register/register.client.tsx` — Created.
- `apps/web/app/registrations/page.tsx` — Created.
- `apps/web/app/registrations/registrations.client.tsx` — Created.
- `apps/web/app/approvals/page.tsx` — Created.
- `apps/web/app/approvals/approvals.client.tsx` — Created.

---

### ACT-034 — Payment & Escrow Schema

| Field       | Value                    |
|-------------|--------------------------|
| Code        | ACT-034                  |
| Date        | 2026-03-04               |
| Time        | (session)                |
| Type        | Schema Change            |
| Status      | Active                   |
| Overwrites  | None                     |

**Intent:** Add 5 new tables to `packages/db/src/schema.ts` to support the full payment and escrow lifecycle (PAY-001 to PAY-007, ESC-001 to ESC-008).

**Result:**
- `payment` — payment transaction initiated by a parent. Stores method, amount, escrow applied, status (pending/completed/failed/refunded), external reference, and `jsonb` metadata for provider-specific data (Fawry code, payment URL, bank details).
- `payment_registration` — join table linking one payment to multiple registrations. Unique index on `(paymentId, registrationId)` prevents duplicates.
- `escrow` — one-per-student account with current balance. Unique constraint on `studentId`.
- `escrow_transaction` — immutable ledger of all escrow movements (credits and debits) with typed reason codes, optional FK links to registration and payment, and initiatedBy FK.
- `withdrawal_request` — parent-initiated cash withdrawal requests that admin fulfills (supports partial fulfillment).
- All relations defined: payment→user×3, payment→paymentRegistration, escrow→user, escrow→escrowTransaction×, escrow→withdrawalRequest×, escrowTransaction→escrow/registration/payment/user, withdrawalRequest→escrow/user.
- `registrationRelations` replaced by `registrationWithPaymentRelations` to include `paymentRegistrations: many(paymentRegistration)` back-reference.
- `userRelationsExtended` updated with `paymentsAsStudent`, `paymentsAsParent`, `paymentsConfirmed`.

**Action Taken:**
- `packages/db/src/schema.ts` — 5 new tables + 7 new relation definitions added. Old `registrationRelations` stub replaced with `registrationWithPaymentRelations`.

---

### ACT-035 — Payment Validation Schemas

| Field       | Value                    |
|-------------|--------------------------|
| Code        | ACT-035                  |
| Date        | 2026-03-04               |
| Time        | (session)                |
| Type        | Feature (Validation)     |
| Status      | Active                   |
| Overwrites  | None                     |

**Intent:** Define Zod validation schemas for the payment workflow.

**Result:**
- `PAYMENT_METHODS` / `PaymentMethodSchema` — fawry, card, mobile_wallet, bank_transfer.
- `PAYMENT_STATUSES` / `PaymentStatusSchema` — pending, completed, failed, refunded.
- `WALLET_PROVIDERS` / `WalletProviderSchema` — vodafone_cash, orange_money, etisalat_cash, we_pay.
- `InitiatePayment` — validates registrationIds (array, min 1), paymentMethod, escrowAmountToApply (≥0, default 0), walletProvider (required when method=mobile_wallet via `.refine()`).
- `ConfirmBankTransfer` — optional admin notes (max 500 chars).
- `FawryWebhookPayload` / `PaymobWebhookPayload` — inbound webhook validation.
- `ListPaymentsQuery` — optional studentId, status, method filters.
- `CheckoutSummaryQuery` — registrationIds comma-separated string.
- Exported from `packages/validations/src/index.ts`.

**Action Taken:**
- `packages/validations/src/payment/payment.validations.ts` — Created.
- `packages/validations/src/index.ts` — Added `export * from './payment/payment.validations'`.

---

### ACT-036 — Payment Provider Integration Stubs

| Field       | Value                    |
|-------------|--------------------------|
| Code        | ACT-036                  |
| Date        | 2026-03-04               |
| Time        | (session)                |
| Type        | Feature (Integration)    |
| Status      | Active (Stub)            |
| Overwrites  | None                     |

**Intent:** Create the `apps/api/src/integrations/` folder with stub implementations for Fawry, Paymob (card), and mobile wallet providers.

**Result:**
- Each stub returns structurally correct data (same shape as the real API response) so the rest of the codebase can call them as if they are real integrations.
- `fawry.ts` — `generateFawryPayment()`: returns 12-digit random reference + 24h expiry. `validateFawryWebhookSignature()`: stub always returns true.
- `paymob.ts` — `createPaymobOrder()`: returns placeholder payment URL + orderId. `validatePaymobWebhookSignature()`: stub always returns true.
- `wallet.ts` — `initiateWalletPayment()`: returns placeholder redirect URL + 6-digit reference code. Supports all 4 Egyptian wallet providers (Vodafone Cash, Orange Money, Etisalat Cash, WE Pay).
- Each file has detailed TODO comments specifying the exact production steps (Fawry SHA256 auth, Paymob 3-step auth→order→key flow, Paymob wallet integration ID per provider).

**Action Taken:**
- `apps/api/src/integrations/fawry.ts` — Created.
- `apps/api/src/integrations/paymob.ts` — Created.
- `apps/api/src/integrations/wallet.ts` — Created.

---

### ACT-037 — Payment Service

| Field       | Value                    |
|-------------|--------------------------|
| Code        | ACT-037                  |
| Date        | 2026-03-04               |
| Time        | (session)                |
| Type        | Feature (Service)        |
| Status      | Active                   |
| Overwrites  | None                     |

**Intent:** Implement the full payment business logic as `apps/api/src/services/payment.services.ts`, covering PAY-001 to PAY-007 and basic escrow management needed for checkout.

**Result:**
Key exported functions:
- `getOrCreateEscrow(studentId)` — atomic get-or-create of escrow account per student.
- `getEscrowBalance(studentId)` — returns 0 if no escrow exists yet.
- `creditEscrow(params)` / `debitEscrow(params)` — update `escrow.balance` and insert immutable `escrow_transaction` record. `debitEscrow` throws if balance insufficient.
- `initiatePayment(parentId, data)`:
  1. Loads and validates all registrations (same student, pending_payment, no existing pending payment).
  2. Validates parent-child link.
  3. Validates escrowAmountToApply ≤ balance and ≤ totalCost.
  4. Computes paymentMethodAmount = totalCost − escrow.
  5. Generates provider reference via integration stubs (Fawry code / Paymob URL / wallet URL / bank ref).
  6. Debits escrow immediately (committed at checkout, refunded if payment fails).
  7. Creates `payment` record (status: pending) + `payment_registration` join records.
- `confirmPayment(paymentId, confirmedBy?, externalRef?)` — marks payment completed, moves all linked registrations to 'confirmed'. Called by webhooks and admin bank confirmation.
- `failPayment(paymentId)` — marks payment failed, refunds escrow if it was applied.
- `getPaymentById(id)` — full payment with nested registration+subject+session.
- `getPayments(filters)` — role-aware filter query: parentId, studentIds, status, method.
- `getPendingBankTransfers()` — admin view with student+parent info, ordered oldest-first.
- `getCheckoutSummary(registrationIds, parentId)` — validates link, returns registrations + totalCost + escrowBalance for checkout page.

**Action Taken:**
- `apps/api/src/services/payment.services.ts` — Created.

---

### ACT-038 — Payment API Routes

| Field       | Value                    |
|-------------|--------------------------|
| Code        | ACT-038                  |
| Date        | 2026-03-04               |
| Time        | (session)                |
| Type        | Feature (API Routes)     |
| Status      | Active                   |
| Overwrites  | None                     |

**Intent:** Expose 8 payment API endpoints, mount them in `index.ts`, enforce parent-only payment initiation (resolves OI-008).

**Result:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/payments/checkout-summary` | Parent | Checkout summary with escrow balance |
| GET | `/payments/pending-bank` | Admin | Pending bank transfers for admin review |
| GET | `/payments` | Parent/Admin | Payment history (role-scoped) |
| POST | `/payments/initiate` | Parent only | Initiate payment (PAY-001 to PAY-005) |
| GET | `/payments/:id` | Parent/Admin | Single payment with registration details |
| POST | `/payments/:id/confirm` | Admin | Confirm bank transfer (PAY-007) |
| POST | `/payments/webhook/fawry` | None (sig) | Fawry payment notification |
| POST | `/payments/webhook/paymob` | None (HMAC) | Paymob card/wallet notification |

OI-008 resolved: `POST /payments/initiate` is `requireParent()` only; service validates parent-child link before accepting.

**Action Taken:**
- `apps/api/src/routes/payment.routes.ts` — Created.
- `apps/api/src/index.ts` — Imported `payments`, mounted at `/v1/payments`, updated route documentation comment.

---

### ACT-039 — Payment Web Pages

| Field       | Value                    |
|-------------|--------------------------|
| Code        | ACT-039                  |
| Date        | 2026-03-04               |
| Time        | (session)                |
| Type        | Feature (Web UI)         |
| Status      | Active                   |
| Overwrites  | None                     |

**Intent:** Build the checkout page (parents) and admin bank transfer confirmation page, and enhance the registrations page with "Pay Now" links.

**Result:**
- `/checkout?ids=...` — Parent-only checkout page. Displays registration summary, escrow balance toggle (apply up to available balance), payment method selector (Fawry / Card / Mobile Wallet with provider sub-selection / Bank Transfer), live total calculation, and confirmation UX showing provider-specific instructions post-submission (Fawry code, card payment URL, wallet redirect, bank details with reference number).
- `/admin/payments` — Admin bank transfer list, oldest-first. Each card shows student/parent details, amount, bank reference, and subject list. Confirm button opens modal with optional admin notes; on confirmation the payment is marked completed and all linked registrations move to confirmed. Auto-refreshes every 30 seconds.
- `/registrations` — Updated: "Pay Now" link added per session group (parent view) when pending_payment registrations exist, linking to `/checkout?ids=...` pre-populated. `RegistrationCard` accepts `userRole` prop to show context-aware messaging.

**Action Taken:**
- `apps/web/app/checkout/page.tsx` — Created.
- `apps/web/app/checkout/checkout.client.tsx` — Created.
- `apps/web/app/admin/payments/page.tsx` — Created.
- `apps/web/app/admin/payments/payments-admin.client.tsx` — Created.
- `apps/web/app/registrations/registrations.client.tsx` — Updated: `Link` import added, `RegistrationCard` prop extended with `userRole`, "Pay Now" link injected per session group, pending_payment messaging differentiated by role.

---

### ACT-040 — Payment DB Migration

| Field       | Value                    |
|-------------|--------------------------|
| Code        | ACT-040                  |
| Date        | 2026-03-04               |
| Time        | (session)                |
| Type        | Database Migration       |
| Status      | Active (not yet applied) |
| Overwrites  | None                     |

**Intent:** Generate Drizzle migration for the 5 new payment and escrow tables.

**Result:** Migration `0010_nifty_dark_beast.sql` generated.
- Creates `escrow`, `escrow_transaction`, `payment`, `payment_registration`, `withdrawal_request`.
- 16 tables total now tracked by Drizzle.
- All FKs, cascades (escrow ON DELETE CASCADE → user, paymentRegistration ON DELETE CASCADE → payment), and 11 indexes created.
- Unique index on `payment_registration(paymentId, registrationId)` prevents duplicate payment-registration links.

**Action Taken:**
- `packages/db/drizzle/0010_nifty_dark_beast.sql` — Generated.

---

## Open Items Registry

| Ref | Source | Item | Priority |
|-----|--------|------|----------|
| OI-001 | ACT-002 | Email verification flow (AUTH-001, AUTH-002) not yet implemented in codebase | P0 |
| OI-002 | ACT-002 | `headmistress` role needed for GRAD-006 — not in current role system | P3 |
| OI-003 | ACT-004 | ~~`packages/db/src/schema.ts` not yet updated with new subject pricing fields~~ | ~~P0~~ Done (ACT-015) |
| OI-004 | ACT-005 | ~~Session unique constraint must enforce per `sessionType`, not globally~~ | ~~P0~~ Done (ACT-022) |
| OI-005 | ACT-005 | ~~Active window deadline edit UI must prompt for a reason (audit log)~~ | ~~P1~~ Done (ACT-023/027) |
| OI-006 | ACT-006 | ~~`change_request` table design not yet added to schema — needed for SWAP-001 to SWAP-004~~ | ~~P0~~ Done (ACT-046) |
| OI-007 | ACT-006 | ~~`adminOverrideApproval` route needs strict permission guard + mandatory audit log~~ | ~~P1~~ Done (ACT-030) |
| OI-008 | ACT-007 | ~~Payment gateway webhook handlers must validate payer is a linked parent~~ | ~~P0~~ Done (ACT-038) |
| OI-009 | ACT-008 | ~~`executeDirectDrop` / `executeDirectSwap` must use atomic DB transactions~~ | ~~P0~~ Done (ACT-049) |
| OI-010 | ACT-009 | ~~Student escrow read-only must be enforced at API level (not just frontend)~~ | ~~P0~~ Done (ACT-044) |
| OI-011 | ACT-010 | Notification service needs efficient parent-lookup query for auto-CC | P1 |
| OI-012 | ACT-011 | Age-of-pending-request field in REP-009 should be indexed for performance | P2 |
| OI-013 | ACT-012 | `headmistress` role decision needed when implementing graduation plan | P3 |
| OI-014 | ACT-013 | Appendix B (DB Tables) and Appendix D (Service Files) not updated with `change_request` and `graduation_plan` | P2 |
| OI-015 | ACT-019 | Admin layout/navbar not yet built — admin pages accessible via direct URL only | P1 |
| OI-016 | ACT-015 | Migration `0007_slim_fat_cobra.sql` not yet applied to live DB | P0 (when DB available) |
| OI-017 | ACT-022 | Migration `0008_cheerful_wendell_vaughn.sql` not yet applied to live DB | P0 (when DB available) |
| OI-018 | ACT-025 | Session scheduler uses `setInterval` — replace with BullMQ before multi-instance deploy | P1 |
| OI-019 | ACT-032 | Migration `0009_chilly_slipstream.sql` not yet applied to live DB | P0 (when DB available) |
| OI-020 | ACT-036 | Fawry/Paymob/wallet integration stubs — replace with live API calls before production | P0 (pre-launch) |
| OI-021 | ACT-036 | Fawry/Paymob webhook signature validation is stubbed (always returns true) — must implement in production | P0 (pre-launch) |
| OI-022 | ACT-040 | Migration `0010_nifty_dark_beast.sql` not yet applied to live DB | P0 (when DB available) |

---

*Last updated: 2026-03-04 | Phase 3 Step 2 complete: Payment & Escrow workflow fully implemented — 5 new DB tables (payment, payment_registration, escrow, escrow_transaction, withdrawal_request), payment validation schemas, 3 provider integration stubs (Fawry, Paymob, wallet), full payment service (PAY-001 to PAY-007 + escrow helpers), 8 API endpoints, migration, checkout page, admin bank transfer page. OI-008 resolved.*

---

## Phase 3 Step 3 — Escrow Service

### ACT-041 | 2026-03-04 | Escrow Validation Schemas

**Why:** Define shared Zod validation schemas for all escrow management operations (ESC-001 to ESC-007) as the single source of truth across API and web layers.

**Action:**
- Created `packages/validations/src/escrow/escrow.validations.ts`
- Schemas: `WithdrawalStatusSchema` + labels, `WithdrawalRequestId`, `TransferEscrow` (with cross-field refine asserting fromStudentId ≠ toStudentId), `RequestWithdrawal`, `FulfillWithdrawal` (incremental releasedAmount + optional notes), `RejectWithdrawal` (mandatory notes), `EscrowQuery`, `WithdrawalsQuery`
- Exported `WITHDRAWAL_STATUS_LABELS` map for UI display
- Added `export * from './escrow/escrow.validations'` to `packages/validations/src/index.ts`

**Result:** All escrow types are available to both `apps/api` and `apps/web` via `@repo/validations`.

---

### ACT-042 | 2026-03-04 | Escrow Service (ESC-001 to ESC-007)

**Why:** Consolidate all escrow business logic into a single dedicated service. The escrow primitive helpers (`getOrCreateEscrow`, `getEscrowBalance`, `creditEscrow`, `debitEscrow`) previously lived in `payment.services.ts`; moving them here establishes correct architectural ownership and allows the payment and (future) swap services to share them without circular dependencies.

**Action:**
- Created `apps/api/src/services/escrow.services.ts`
- **Core primitives (moved from payment.services.ts):** `getOrCreateEscrow`, `getEscrowBalance`, `creditEscrow`, `debitEscrow`
- **New read operations:** `getEscrowForStudent`, `getEscrowTransactions`, `getChildrenEscrowBalances` (parent overview)
- **New transactional operations (parent-only):**
  - `transferEscrow` — validates parent links to both students, debits source, credits destination (ESC-003)
  - `createWithdrawalRequest` — validates parent link + balance, creates withdrawal_request record (ESC-004)
- **New admin operations:**
  - `getPendingWithdrawalRequests` — batches parent info lookup, ordered oldest-first (ESC-005)
  - `fulfillWithdrawalRequest` — incremental partial fulfillment, debits escrow immediately, sets status to `partially_fulfilled` or `fulfilled` (ESC-006)
  - `rejectWithdrawalRequest` — no fund movement, mandatory reason, only valid from `pending` status

**Result:** All escrow logic owned in one file. Payment service dependency graph: payment → escrow (not cyclic).

---

### ACT-043 | 2026-03-04 | payment.services.ts Refactored — Import Escrow Primitives

**Why:** After moving core escrow helpers to `escrow.services.ts`, payment.services.ts must import them from there rather than duplicating them.

**Action:**
- Removed `getOrCreateEscrow`, `getEscrowBalance`, `creditEscrow`, `debitEscrow` from `payment.services.ts`
- Removed `escrow` and `escrowTransaction` table imports (no longer directly used)
- Added `import { getOrCreateEscrow, getEscrowBalance, creditEscrow, debitEscrow } from './escrow.services'`
- All call sites within `payment.services.ts` (`initiatePayment`, `failPayment`, `getCheckoutSummary`) continue working unchanged

**Result:** Zero duplication. Payment service is now a consumer of escrow service.

---

### ACT-044 | 2026-03-04 | Escrow API Routes — OI-010 Resolved

**Why:** OI-010 required that student read-only access to escrow be enforced at the API level, not just in the frontend. Route-level middleware and role checks provide the enforcement guarantee.

**Action:**
- Created `apps/api/src/routes/escrow.routes.ts` with 9 endpoints:
  - `GET /escrow` — role-aware balance query; students see own balance only, parents pass `?studentId=`
  - `GET /escrow/children` — parent-only: all linked children with balances
  - `GET /escrow/transactions` — role-aware transaction history; students always see own, parents must provide `?studentId=`
  - `GET /escrow/withdrawals` — parent-only: withdrawal request history for linked children
  - `POST /escrow/transfer` — parent-only (`requireParent()` middleware); student attempts return 405
  - `POST /escrow/withdraw` — parent-only; creates pending withdrawal_request for admin queue
  - `GET /escrow/admin/withdrawals` — admin-only: pending + partially_fulfilled requests with parent info
  - `POST /escrow/admin/withdrawals/:id/fulfill` — admin-only: incremental fulfillment
  - `POST /escrow/admin/withdrawals/:id/reject` — admin-only: reject with mandatory reason
- Mounted `escrowRoutes` at `/v1/escrow` in `apps/api/src/index.ts`
- Updated API route documentation comment block in `index.ts`

**OI-010 resolution mechanism:**
- `POST /escrow/transfer` and `POST /escrow/withdraw` use `requireParent()` middleware → HTTP 403 for students
- `GET /escrow` and `GET /escrow/transactions` use role check: `ROLES.STUDENT` → always scoped to own account, no writes available

**Result:** Students are structurally incapable of initiating transactions via the API.

---

### ACT-045 | 2026-03-04 | Escrow Web Pages

**Why:** Complete the full-stack implementation of ESC-001 to ESC-007 with functional, integrated web UIs.

**Action — 8 files created:**

**Student/Parent shared escrow view (`apps/web/app/escrow/`):**
- `page.tsx` — server component: enforces student/parent access (admins redirected to /admin/escrow), prefetches balance + transaction history, additionally prefetches all children's balances for parents
- `escrow.client.tsx` — unified client component: students see read-only balance + transaction history with labeled reason codes; parents see children overview cards (click to drill in), transaction history for selected child, quick-action links to Transfer and Withdraw pages

**Parent transfer page (`apps/web/app/escrow/transfer/`):**
- `page.tsx` — server component: enforces parent-only access, prefetches children with balances
- `transfer.client.tsx` — form with from/to child selectors (disabled options prevent selecting same child on both sides), live balance display, client-side validation against available balance, success confirmation screen

**Parent withdrawal request page (`apps/web/app/escrow/withdraw/`):**
- `page.tsx` — server component: enforces parent-only access, prefetches children + withdrawal history
- `withdraw.client.tsx` — two-panel layout: withdrawal request form (child selector + amount with live balance guard) and full withdrawal history with status badges + admin notes

**Admin withdrawal management page (`apps/web/app/admin/escrow/`):**
- `page.tsx` — server component: enforces admin-only access, prefetches pending withdrawal requests
- `escrow-admin.client.tsx` — requests listed oldest-first with student, parent, amount, and escrow balance data; Fulfill modal (incremental amount, optional notes, shows remaining); Reject modal (mandatory reason); auto-refreshes every 30 seconds via `refetchInterval`

**Result:** Complete escrow feature from DB → service → API → UI. Phase 3 Step 3 fully implemented.

---

### Open Issues Updated

| OI ID | Opened | Description | Status |
|-------|--------|-------------|--------|
| OI-010 | ACT-009 | ~~Student escrow read-only must be enforced at API level (not just frontend)~~ | Done (ACT-044) |

---

*Last updated: 2026-03-04 | Phase 3 Step 3 complete: Escrow Service fully implemented — validation schemas (TransferEscrow, RequestWithdrawal, FulfillWithdrawal, RejectWithdrawal), dedicated escrow service (ESC-001 to ESC-007), payment service refactored to import escrow primitives, 9 escrow API routes, 4 web pages (balance overview, transfer, withdraw, admin fulfillment). OI-010 resolved.*

---

## Phase 3 Step 4 — Swap Service

### ACT-046 | 2026-03-04 | changeRequest Table Added to Schema (OI-006 Resolved)

**Why:** OI-006 flagged that the `change_request` table was required for SWAP-001 to SWAP-004 but had not yet been added to the database schema.

**Action:**
- Added `changeRequest` table to `packages/db/src/schema.ts` with:
  - `id`, `registrationId` (FK → registration.id, RESTRICT), `type` ('drop'|'swap'), `requestedBy` (FK → user.id, RESTRICT), `reason`, `newSubjectId` (FK → subject.id, RESTRICT, nullable), `priceAtRequest`, `priceDifference`, `status` ('pending_approval'|'approved'|'rejected'), `approvedBy` (FK → user.id, SET NULL), `comments`, `processedAt`, `createdAt`, `updatedAt`
  - Indexes: `registrationId`, `requestedBy`, `status`, and a **partial unique index** `changeReq_one_pending_per_registration_idx` — enforces at most one `pending_approval` change request per registration at DB level
- Added `changeRequestRelations` (registration, requestedByUser, newSubject, approvedByUser)
- Updated `registrationWithPaymentRelations` to include `changeRequests: many(changeRequest)`
- Updated `userRelationsExtended` with `changeRequestsRequested` and `changeRequestsApproved`
- Generated migration: `packages/db/drizzle/0011_graceful_sandman.sql` (17 tables)

**Result:** OI-006 resolved. Schema ready for swap service.

---

### ACT-047 | 2026-03-04 | Swap Validation Schemas

**Why:** Shared Zod schemas needed for all drop/swap request and approval operations.

**Action:**
- Created `packages/validations/src/swap/swap.validations.ts`
- Schemas: `CHANGE_REQUEST_STATUSES`, `CHANGE_REQUEST_STATUS_LABELS`, `ChangeRequestStatusSchema`, `ChangeRequestId`, `RegistrationIdParam`, `RequestDrop`, `RequestSwap`, `DirectDrop`, `DirectSwap`, `ApproveChangeRequest`, `RejectChangeRequest`, `ChangeRequestsQuery`
- Added `export * from './swap/swap.validations'` to `packages/validations/src/index.ts`

**Result:** All swap/change request types shared across API and web via `@repo/validations`.

---

### ACT-048 | 2026-03-04 | Swap Service (SWAP-001 to SWAP-007)

**Why:** Implement all business logic for student drop/swap requests, parent approval workflow, and parent direct operations per the DEVELOPMENT_PLAN.md and URD.

**Action:**
- Created `apps/api/src/services/swap.services.ts`
- **Internal helpers:** `validateParentStudentLink`, `resolveSubjectPrice`, `validateChangeEligibility` (checks confirmed status, active session, non-core subject for Grade 10 June, no existing pending request), `validateNewSubjectForSwap` (checks subject active, no duplicate registration)
- **Student operations:** `createDropRequest` (SWAP-001), `createSwapRequest` (SWAP-002) — both call `validateChangeEligibility` before creating the `pending_approval` change request
- **Parent approval/rejection:** `approveChangeRequest` (SWAP-003) — runs in DB transaction: marks CR approved, drops registration, credits escrow, creates new `pending_payment` registration for swaps; `rejectChangeRequest` — no financial impact, mandatory comments
- **Parent direct operations (OI-009 resolved):**
  - `executeDirectDrop` — atomic DB transaction: drops registration + credits escrow
  - `executeDirectSwap` — atomic DB transaction: drops registration + credits escrow + creates new `pending_payment` registration
- **Read operations:** `getPendingChangeRequests`, `getPendingChangeRequestsForParent`, `getChangeRequestById`
- Financial logic: drop always credits full `priceAtRegistration`; swap always credits full old price to escrow and creates new `pending_payment` registration for new subject

**OI-009 resolution:** Both `executeDirectDrop` and `executeDirectSwap` use `db.transaction(async (tx) => {...})` ensuring atomicity of all DB writes.

**Result:** Complete swap service owning SWAP-001 to SWAP-007 business logic.

---

### ACT-049 | 2026-03-04 | Swap & Change Request API Routes

**Why:** Expose all swap operations via typed API endpoints per the DEVELOPMENT_PLAN.md route design.

**Action:**
- Created `apps/api/src/routes/swap.routes.ts` with **two exported Hono apps**:

  **`registrationSwapRoutes`** (mounted at `/v1/registrations`):
  - `POST /:id/request-drop` — `requireStudent()` (SWAP-001)
  - `POST /:id/request-swap` — `requireStudent()` (SWAP-002)
  - `POST /:id/drop` — `requireParent()` (SWAP-004)
  - `POST /:id/swap` — `requireParent()` (SWAP-004)

  **`changeRequestRoutes`** (mounted at `/v1/change-requests`):
  - `GET /` — `requireStudentOrParent()` — role-aware list (SWAP-007 for student)
  - `GET /:id` — `requireStudentOrParent()` — single request with access control
  - `PUT /:id/approve` — `requireParent()` (SWAP-003)
  - `PUT /:id/reject` — `requireParent()` (SWAP-003)

- Updated `apps/api/src/index.ts`: added imports and mounted both route groups:
  - `.route('/registrations', registrationSwapRoutes)` — extends existing registration routes
  - `.route('/change-requests', changeRequestRoutes)`
  - Updated API route documentation comment block

**Result:** 8 new API endpoints fully wired and authenticated.

---

### ACT-050 | 2026-03-04 | Swap Web Pages

**Why:** Complete the full-stack swap/drop implementation with functional web UIs.

**Action — 6 files created/updated:**

**Student Pending Requests Dashboard (SWAP-007) — new:**
- `apps/web/app/pending-requests/page.tsx` — server component: enforces student access, pre-fetches change requests
- `apps/web/app/pending-requests/pending-requests.client.tsx` — displays pending/resolved requests with status badges, financial impact (credit vs. additional payment), subject details, swap target, parent comments, and processed timestamps

**Registration page updated — drop/swap action buttons:**
- `apps/web/app/registrations/registrations.client.tsx` — comprehensive rewrite:
  - "Request Drop" / "Request Swap" buttons on confirmed registrations (student, session active only)
  - "Drop" / "Swap" direct action buttons on confirmed registrations (parent, session active only)
  - `RequestDropModal` — reason field, escrow credit preview, submits to `POST /:id/request-drop`
  - `RequestSwapModal` — fetches available subjects, live price difference calculation, submits to `POST /:id/request-swap`
  - `DirectDropModal` — confirmation + escrow credit display, submits to `POST /:id/drop`
  - `DirectSwapModal` — subject selector, financial impact display, submits to `POST /:id/swap`
  - Added "My Requests" link to `/pending-requests` in page header for students
  - All modals invalidate registration query on success

**Approvals page updated — change requests section:**
- `apps/web/app/approvals/page.tsx` — pre-fetches change requests alongside registration approvals
- `apps/web/app/approvals/approvals.client.tsx` — new `ChangeRequestsSection` component appended:
  - Displays pending drop/swap requests from linked children
  - Shows student name, session, type badge, subject, swap target, financial impact grid
  - Approve modal with optional comments, Reject modal with mandatory reason
  - Calls `PUT /change-requests/:id/approve` and `PUT /change-requests/:id/reject`
  - Invalidates both `change-requests` and `registrations` query caches on action

**Result:** Complete Phase 3 Step 4. All SWAP-001 to SWAP-007 requirements implemented end-to-end.

---

### Open Issues Updated

| OI ID | Opened | Description | Status |
|-------|--------|-------------|--------|
| OI-006 | ACT-005 | ~~`change_request` table design not yet added to schema — needed for SWAP-001 to SWAP-004~~ | Done (ACT-046) |
| OI-009 | ACT-008 | ~~`executeDirectDrop` / `executeDirectSwap` must use atomic DB transactions~~ | Done (ACT-049) |

---

*Last updated: 2026-03-04 | Phase 3 Step 4 complete: Swap Service fully implemented — changeRequest DB table + migration (0011), swap validation schemas, atomic swap/drop service (SWAP-001 to SWAP-007, OI-006 and OI-009 resolved), 8 API endpoints, student pending requests dashboard, registration page drop/swap modals (student request + parent direct), approvals page change request approval/rejection section.*

---

## Phase 3 Step 5 — Web Pages

### ACT-051 | 2026-03-04 | Enriched Registration History Service

**Why:** The existing `getRegistrationHistory` function returned only basic subject and session data. The history page requires a complete audit trail including who requested, who approved, and any change requests made against each registration.

**Action:**
- Updated `getRegistrationHistory` in `apps/api/src/services/registration.services.ts`
- Now returns: `subject` (name, code, council, isCore), `session` (name, type, status, dates), `requestedByUser` (id, name, role), `approvedByUser` (id, name, role), `changeRequests` with nested `newSubject`, `requestedByUser`, `approvedByUser` (all change request audit entries per registration)
- Existing history API route at `GET /v1/registrations/history` unchanged — role-aware (student=own, parent=linked child, admin=any)

**Result:** History endpoint now serves a complete auditable chain of custody for every registration.

---

### ACT-052 | 2026-03-04 | Registration History Page

**Why:** The only remaining Step 3.5 page not yet built. All other pages in the Step 3.5 list were built incrementally alongside each service in Steps 3.1–3.4.

**Action — 2 files created:**

**`apps/web/app/registrations/history/page.tsx`** — server component:
- Enforces student/parent auth (admins redirected)
- Students: pre-fetches own history on server
- Parents: reads `?studentId=` query param, pre-fetches children list for selector, pre-fetches selected child's history
- Passes `initialStudentId` to client

**`apps/web/app/registrations/history/history.client.tsx`** — client component:
- **Student view**: history displayed immediately (no child selector)
- **Parent view**: child selector dropdown — switches history on change
- Sessions grouped newest-first with summary stats (confirmed total, dropped total)
- Per-session stats bar showing status distribution
- **Per-registration cards** with full audit trail:
  - Subject name, code, council, Core badge
  - Status badge + price at registration (snapshot)
  - Who requested + role + timestamp
  - Who approved/rejected + role + timestamp + comments
  - Dropped-at timestamp
  - Expandable "Show change requests" section: each change request shows type (drop/swap), target subject, status, requester, approver, reason, parent note, and financial impact
- "Full History" link added to the existing `/registrations` page header

**Also updated:**
- `apps/web/app/registrations/registrations.client.tsx`: Added "Full History" button in the page header linking to `/registrations/history`

**Result:** Phase 3 Step 5 complete. All pages from the Step 3.5 checklist now exist.

---

*Last updated: 2026-03-04 | Phase 3 Step 5 complete: Registration history page built with full audit trail (enriched service + history/page.tsx + history.client.tsx). "Full History" link added to registrations page. All Phase 3 web pages now complete.*

---

## Phase 4 — Support Systems

---

### ACT-053 | 2026-03-05 | Notification Table — Schema + Migration

**Why:** Phase 4 Step 4.1 begins. The `notification` table is the prerequisite for every notification trigger in Steps 4.2–4.5. All other services (payment, escrow, swap, grade) need this table to exist before notification calls can be added.

**Action:**
- Added `notification` table to `packages/db/src/schema.ts`:
  - Columns: `id`, `userId` (FK → user, ON DELETE CASCADE), `type`, `title`, `body`, `data` (jsonb), `readAt` (nullable), `emailSentAt` (nullable), `createdAt`, `updatedAt`
  - Indexes: `notification_userId_idx`, `notification_type_idx`, `notification_readAt_idx` (optimises unread queries)
  - Types cover all NOT-001 to NOT-011 user stories
- Added `notificationRelations` (`notification → user` one-to-one)
- Added `notifications: many(notification)` to `userRelationsExtended`
- Generated migration: `packages/db/drizzle/0012_kind_red_skull.sql` (18 tables including new `notification`)

**Result:** Database schema now supports all notification types. Migration file ready for deployment.

---

### ACT-054 | 2026-03-05 | Notification Validation Schemas

**Why:** Shared Zod schemas must be defined before both API service and web client reference notification types. Single source of truth in `@repo/validations`.

**Action:**
- Created `packages/validations/src/notification/notification.validations.ts`:
  - `NOTIFICATION_TYPES` const array — 12 types covering NOT-001 to NOT-011 + GRADE_CHANGED
  - `NotificationTypeSchema` (Zod enum), `NotificationType` (inferred type)
  - `NOTIFICATION_TYPE_LABELS` — human-readable labels for each type
  - `NOTIFICATION_TYPE_ICONS` — emoji icons used in notification center UI
  - `ANNOUNCEMENT_RECIPIENT_GROUPS` (`all`, `students`, `parents`, `grade_10/11/12`)
  - `AnnouncementRecipientGroupSchema` + `ANNOUNCEMENT_RECIPIENT_LABELS`
  - `NotificationId` — UUID param validator
  - `GetNotificationsQuery` — paginated query with `unreadOnly`, `limit`, `offset`
  - `BulkAnnouncement` — admin announcement payload with `title`, `body`, `recipients`, `sendEmail`
- Exported from `packages/validations/src/index.ts`

**Result:** Type-safe notification schemas available across API, web, and mobile packages.

---

### ACT-055 | 2026-03-05 | Email Integration (Resend)

**Why:** Email delivery is a dependency of the notification service. By isolating all Resend calls behind `apps/api/src/integrations/email.ts`, the rest of the codebase never imports Resend directly. This mirrors the established payment gateway isolation pattern.

**Action:**
- Installed `resend` package into `@repo/api`
- Created `apps/api/src/integrations/email.ts`:
  - Reads `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` from environment
  - **Stub mode**: when `RESEND_API_KEY` is absent, all calls log to console and return `{ stubbed: true }` — no errors thrown (same pattern as Fawry/Paymob stubs)
  - Core `sendEmail(payload)` function used by all templates
  - `emailLayout(title, body)` — shared HTML shell (school branding, responsive, blue header)
  - 9 typed email template helpers (one per NOT-XXX story):
    - `sendSessionOpenedEmail` (NOT-001)
    - `sendSessionClosingSoonEmail` (NOT-002)
    - `sendRegistrationRequestReceivedEmail` (NOT-003)
    - `sendRegistrationDecisionEmail` (NOT-004)
    - `sendPaymentReceiptEmail` (NOT-005)
    - `sendDropSwapRequestEmail` (NOT-006)
    - `sendDropSwapProcessedEmail` (NOT-007)
    - `sendEscrowBalanceChangedEmail` (NOT-008)
    - `sendWithdrawalFulfilledEmail` (NOT-009)
    - `sendBulkAnnouncementEmail` (NOT-011)

**Result:** Email layer is production-ready (add `RESEND_API_KEY` to env to go live). Stub mode ensures no breakage in dev/test.

---

### ACT-056 | 2026-03-05 | Notification Service

**Why:** Central service owning all notification primitives and trigger functions. Existing services (registration, payment, escrow, swap) will import named trigger functions from here — no service creates notifications directly.

**Action:**
- Created `apps/api/src/services/notification.services.ts`:

  **Core CRUD:**
  - `createNotification(userId, type, title, body, data?)` — inserts one in-app notification
  - `createBulkNotifications(userIds[], type, title, body, data?)` — batch insert
  - `getUserNotifications(userId, options)` — paginated, newest-first, optional unread filter
  - `getUnreadCount(userId)` — count for badge
  - `markAsRead(notificationId, userId)` — validates ownership; returns null if not found or already read
  - `markAllAsRead(userId)` — bulk update

  **Internal helpers:**
  - `getUserDetails(userId)` — fetches user name + email for email templates
  - `getLinkedParents(studentId)` — fetches all accepted parent links (for NOT-010 auto-CC)
  - `notifyWithParentCC(...)` — convenience: notifies primary user + all their parents
  - `fireEmail(label, fn)` — fire-and-forget wrapper; email failures are logged but never throw

  **Trigger functions (one per NOT-XXX story):**
  - `notifySessionOpened` (NOT-001) — fan-out to all students/parents + emails
  - `notifySessionClosingSoon` (NOT-002) — bulk notification + emails
  - `notifyRegistrationRequestReceived` (NOT-003) — notifies all linked parents + emails
  - `notifyRegistrationDecision` (NOT-004) — notifies student + emails
  - `notifyPaymentConfirmed` (NOT-005) — notifies parent + emails
  - `notifyDropSwapRequestReceived` (NOT-006) — notifies all linked parents + emails
  - `notifyDropSwapProcessed` (NOT-007) — notifies student + emails
  - `notifyEscrowBalanceChanged` (NOT-008) — notifies all linked parents + emails
  - `notifyWithdrawalFulfilled` (NOT-009) — notifies parent + student escrow notification
  - `notifyGradeChanged` (GRADE_CHANGED) — notifies student + all linked parents
  - `sendAdminAnnouncement` (NOT-011) — fans out to selected recipient group; optional email blast

  NOT-010 (parent auto-CC) is enforced by `getLinkedParents` called inside every student-action trigger.

**Result:** All notification trigger functions available for wiring into services in Step 4.2.

---

### ACT-057 | 2026-03-05 | Notification API Routes

**Why:** Exposes the notification service to web and mobile clients via typed Hono RPC endpoints. Required for the notification center UI.

**Action:**
- Created `apps/api/src/routes/notification.routes.ts`:
  - `GET  /notifications` — paginated notifications for authenticated user (`unreadOnly`, `limit`, `offset`)
  - `GET  /notifications/unread-count` — unread count for badge (defined before `/:id` to avoid routing conflicts)
  - `PUT  /notifications/read-all` — mark all unread as read
  - `PUT  /notifications/:id/read` — mark single notification as read (validates ownership; 404 if not found)
  - `POST /notifications/admin/announce` — admin bulk announcement (NOT-011, `requireAdmin`)
- Updated `apps/api/src/index.ts`:
  - Imported `notificationRoutes`
  - Mounted at `.route('/notifications', notificationRoutes)`
  - Added route documentation block

**Result:** Notification endpoints live at `/v1/notifications/*`. Typed via Hono RPC for use in `apps/web` and `apps/app`.

---

### ACT-058 | 2026-03-05 | Notification Center Web Page

**Why:** Step 4.5 specifies `apps/web/app/notifications/page.tsx` — the user-facing notification center. All roles (student, parent, admin) share this page.

**Action — 2 files created:**

**`apps/web/app/notifications/page.tsx`** — server component:
- `requireAuth()` enforces authentication (any role)
- Pre-fetches first 50 notifications (all types) and unread count on server via `getServerApi()`
- Hydrates TanStack Query cache for instant client render
- Passes hydrated state to `<NotificationsClient />`

**`apps/web/app/notifications/notifications.client.tsx`** — client component:
- Unread badge count next to page title (refetches every 30s)
- Toggle: "All" vs "Unread only" filter (resets offset on toggle)
- "Mark all as read" button (visible when unreadCount > 0)
- Notification list: each card shows type icon, type label, title, body, relative timestamp
- **Unread state**: type-specific colour border + background + blue dot indicator
- **Read state**: muted opacity
- Click any notification → marks it as read (fires `PUT /notifications/:id/read`)
- "Load more" pagination (offset-based, 50 per page)
- Empty state handling (distinct for unread-only vs all)

**Result:** Phase 4 Step 4.1 complete. Notification infrastructure is fully operational.

---

*Last updated: 2026-03-05 | Phase 4 Step 4.1 complete: notification table + migration, validation schemas, Resend email integration, notification service (all NOT-001 to NOT-011 trigger functions), API routes, and notification center web page.*

---

### ACT-059 | 2026-03-05 | Notification Triggers — Registration (NOT-003, NOT-004)

**Why:** Step 4.2 — wire notification trigger functions into existing services. Registration service covers the student-initiated approval flow.

**Action — `apps/api/src/services/registration.services.ts`:**
- Added import: `notifyRegistrationRequestReceived`, `notifyRegistrationDecision` from `notification.services`
- **`createRegistrationRequest`**: After successful insert, fetches student name and fires `notifyRegistrationRequestReceived` with subject list + total cost. All linked parents are notified in-app and by email (NOT-003). Fire-and-forget via `.catch()`.
- **`approveRegistrationRequest`**: After status update to `pending_payment`, queries session name and fires `notifyRegistrationDecision(approved: true)` for each unique student in the batch (NOT-004). Fire-and-forget.
- **`rejectRegistrationRequest`**: After status update to `rejected`, fires `notifyRegistrationDecision(approved: false)` for each unique student (NOT-004). Fire-and-forget.

**Result:** Parents receive in-app + email notification when a child submits a request. Students receive in-app + email notification when their request is approved or rejected.

---

### ACT-060 | 2026-03-05 | Notification Triggers — Payment (NOT-005)

**Why:** Parent must receive a payment receipt (in-app + email) when registration is confirmed.

**Action — `apps/api/src/services/payment.services.ts`:**
- Added import: `notifyPaymentConfirmed` from `notification.services`
- **`confirmPayment`**: After all linked registrations are moved to `confirmed`, fetches enriched payment record (with subject names and session name via paymentRegistrations join). Fires `notifyPaymentConfirmed` with total amount (payment method charge + escrow applied), method, paymentId, and subject list (NOT-005). Fire-and-forget.

**Result:** Parent receives in-app + email payment receipt on every successful payment confirmation (webhook or admin bank-transfer confirmation).

---

### ACT-061 | 2026-03-05 | Notification Triggers — Swap / Change Requests (NOT-006, NOT-007, NOT-008)

**Why:** Parents must be notified when a child submits drop/swap requests (NOT-006), students must be notified of the parent's decision (NOT-007), and parents must be notified whenever a child's escrow balance changes (NOT-008).

**Action — `apps/api/src/services/swap.services.ts`:**
- Added imports: `notifyDropSwapRequestReceived`, `notifyDropSwapProcessed`, `notifyEscrowBalanceChanged` from `notification.services`; `getEscrowBalance` from `escrow.services`
- **`approveChangeRequest` query**: Enriched with `registration.subject` (name) and `changeRequest.newSubject` (name) so subject names are available for notification payloads without extra queries
- **`rejectChangeRequest` query**: Enriched with `registration.subject` (name) and `changeRequest.newSubject` (name)
- **`createDropRequest`**: After insert, fetches student name and fires `notifyDropSwapRequestReceived` (changeType: 'drop', financial impact: full refund pending approval). NOT-006 fire-and-forget.
- **`createSwapRequest`**: After insert, fetches student name, computes financial impact text (extra charge / escrow credit / no change), fires `notifyDropSwapRequestReceived`. NOT-006 fire-and-forget.
- **`approveChangeRequest`**: After transaction commits, fires `notifyDropSwapProcessed(approved: true)` (NOT-007) + fetches post-transaction escrow balance and fires `notifyEscrowBalanceChanged` (NOT-008). Both fire-and-forget.
- **`rejectChangeRequest`**: After update, fires `notifyDropSwapProcessed(approved: false)` with "No changes made" financial impact. NOT-007 fire-and-forget.
- **`executeDirectDrop`**: After transaction commits, fetches new escrow balance and fires `notifyEscrowBalanceChanged` for the full refund amount. NOT-008 fire-and-forget.
- **`executeDirectSwap`**: After transaction commits, fires `notifyEscrowBalanceChanged` for the swap refund with `reason` including both subject names. NOT-008 fire-and-forget.

**Result:** Full notification coverage for the drop/swap workflow: parents see every child request, students see every parent decision, parents see every escrow change from drops/swaps.

---

### ACT-062 | 2026-03-05 | Notification Triggers — Escrow (NOT-008 transfers, NOT-009)

**Why:** Parents need to know about all escrow balance changes (NOT-008) including transfers, and need to be notified when a withdrawal is fulfilled (NOT-009).

**Action — `apps/api/src/services/escrow.services.ts`:**
- Added imports: `user` from `@repo/db` (for name lookups); `notifyEscrowBalanceChanged`, `notifyWithdrawalFulfilled` from `notification.services`
- **`transferEscrow`**: Refactored return to compute `newFromBalance`/`newToBalance` first, then fire-and-forget two `notifyEscrowBalanceChanged` calls — one for the source student (debit: negative changeAmount + recipient name in reason) and one for the destination student (credit: positive changeAmount + sender name in reason). NOT-008.
- **`fulfillWithdrawalRequest`**: After DB update, fetches remaining escrow balance, student name, and all linked parent IDs. Calls `notifyWithdrawalFulfilled` once per linked parent (fire-and-forget). The notification service internally also creates an `ESCROW_BALANCE_CHANGED` notification for the student. NOT-009.

**Result:** Parents see every escrow change across all channels (drop, swap, transfer-in, transfer-out, withdrawal). Students see their own balance updates.

---

### ACT-063 | 2026-03-05 | Notification Triggers — Session Opened (NOT-001)

**Why:** All students and parents must be notified when a registration window opens (NOT-001).

**Action — `apps/api/src/services/session.services.ts`:**
- Updated `autoManageSessions` return type: added `activatedSessions: { id, name, sessionType, endDate }[]`
- Updated `draftsDue` query columns to also select `name` and `endDate` (needed for notification payload)
- On each activation, pushes the session's details into `activatedSessions`

**Action — `apps/api/src/jobs/session-closer.ts`:**
- Added imports: `db`, `user`, `eq` from `@repo/db`; `notifySessionOpened` from `notification.services`
- In the `tick()` function, after sessions are activated, iterates over `activatedSessions` and for each:
  - Fetches all students (`role = 'student'`) and parents (`role = 'parent'`) IDs from DB
  - Calls `notifySessionOpened` to fan out in-app notifications (and emails via email integration) to all users
  - Logs success count; catches and logs errors without crashing the scheduler

**Note — NOT-002 deferred (P1):** The 24-hour closing reminder requires tracking which sessions have already had the reminder sent. This needs a `closingReminderSentAt` column on `registrationSession` (schema change). Deferred to a follow-up step to avoid scope creep in Step 4.2.

**Result:** Every registered student and parent receives an in-app + email notification the moment a registration window opens. The scheduler fan-out is safe: errors are caught per-session and the scheduler loop continues.

---

### Summary — Phase 4 Step 4.2 Complete

All P0 notification triggers are now wired:

| Story | Trigger Point | Status |
|---|---|---|
| NOT-001 Session opened | `session-closer.ts` on auto-activation | ✅ |
| NOT-002 Closing soon | Deferred (P1, needs schema field) | ⏳ |
| NOT-003 Parent: child submitted request | `registration.services.ts` → `createRegistrationRequest` | ✅ |
| NOT-004 Student: request approved/rejected | `registration.services.ts` → `approve/rejectRegistrationRequest` | ✅ |
| NOT-005 Parent: payment receipt | `payment.services.ts` → `confirmPayment` | ✅ |
| NOT-006 Parent: child requested drop/swap | `swap.services.ts` → `create{Drop,Swap}Request` | ✅ |
| NOT-007 Student: drop/swap processed | `swap.services.ts` → `approve/rejectChangeRequest` | ✅ |
| NOT-008 Parent: escrow balance changed | `swap.services.ts` (drops/swaps) + `escrow.services.ts` (transfers) | ✅ |
| NOT-009 Parent: withdrawal fulfilled | `escrow.services.ts` → `fulfillWithdrawalRequest` | ✅ |
| NOT-010 Parent auto-CC | Enforced in `notification.services.ts` via `getLinkedParents` | ✅ |
| NOT-011 Admin bulk announcement | `notification.routes.ts` → `sendAdminAnnouncement` | ✅ |

---

## Phase 4 Step 4.3 — Audit Trail

### ACT-064 — Add `audit_log` table to database schema

**Date/Time:** 2026-03-05  
**Why:** REP-006 requires a full chain-of-custody record of all significant system actions. The `audit_log` table is append-only and never updated or deleted, providing a tamper-resistant history.  
**What:** Added `auditLog` table to `packages/db/src/schema.ts` with columns: `id`, `userId` (nullable FK → user, ON DELETE SET NULL for system actions), `action` (text enum), `entityType`, `entityId`, `previousData` (jsonb), `newData` (jsonb), `ipAddress`, `userAgent`, `createdAt`. Added 4 indexes: `userId`, `(entityType, entityId)`, `action`, `createdAt`. Added `auditLogRelations` (belongs-to user). Added `auditLogs: many(auditLog)` to `userRelationsExtended`.  
**Result:** `db.query.auditLog` is fully available in services. Auto-generated migration `drizzle/0013_absurd_meltdown.sql` created with `drizzle-kit generate`.  
**Files changed:** `packages/db/src/schema.ts`, `packages/db/drizzle/0013_absurd_meltdown.sql`

---

### ACT-065 — Create audit validation schemas

**Date/Time:** 2026-03-05  
**Why:** Shared validation types for action/entity enums, human-readable labels, and the admin query filter schema.  
**What:** Created `packages/validations/src/audit/audit.validations.ts` with:
- `AUDIT_ENTITY_TYPES` + `AuditEntityTypeSchema` + `AUDIT_ENTITY_TYPE_LABELS` — 7 entity categories
- `AUDIT_ACTIONS` + `AuditActionSchema` + `AUDIT_ACTION_LABELS` — 31 action types covering all domain operations (subject CRUD, session lifecycle, registration flow, payment lifecycle, change requests, escrow, user/grade, admin)
- `AuditLogsQuery` — Zod schema for the admin log viewer filters (userId, action, entityType, entityId, dateFrom, dateTo, limit/offset with auto-capping at 200)  
Exported from `packages/validations/src/index.ts`.  
**Files changed:** `packages/validations/src/audit/audit.validations.ts`, `packages/validations/src/index.ts`

---

### ACT-066 — Create `audit.services.ts`

**Date/Time:** 2026-03-05  
**Why:** Encapsulate all audit log reads and writes in a single service, following the established service-layer pattern.  
**What:** Created `apps/api/src/services/audit.services.ts` with:
- `logAction(userId, action, entityType, entityId, previousData?, newData?, ctx?)` — single INSERT into `audit_log`; userId is nullable for system-initiated actions
- `getAuditLogs(filters)` — paginated, filterable query with joined user name/role/email; newest first (REP-006)
- `getEntityHistory(entityType, entityId)` — ordered chronological chain of custody for one entity
- `extractAuditContext(c)` — helper to extract `ipAddress` (from `cf-connecting-ip` / `x-forwarded-for` / `x-real-ip`) and `userAgent` from Hono request context  
**Files changed:** `apps/api/src/services/audit.services.ts` (new)

---

### ACT-067 — Wire audit logging into critical route handlers

**Date/Time:** 2026-03-05  
**Why:** All significant admin/parent mutations must be logged to support REP-006 (admin audit trail) and financial compliance.  
**What:** Added `logAction` + `extractAuditContext` calls (fire-and-forget `.catch()`) in 5 route files:

**`subject.routes.ts`** (5 audit points):
- `POST /subjects` → `SUBJECT_CREATED`
- `PUT /subjects/:id` → `SUBJECT_UPDATED` (previous state captured via `getSubjectById`)
- `PUT /subjects/:id/core` → `SUBJECT_CORE_UPDATED` (same)
- `DELETE /subjects/:id` → `SUBJECT_DEACTIVATED`
- `PUT /subjects/:id/activate` → `SUBJECT_ACTIVATED`

**`session.routes.ts`** (4 audit points):
- `POST /sessions` → `SESSION_CREATED`
- `PUT /sessions/:id` → `SESSION_UPDATED` (covers both draft field updates and active deadline extensions)
- `POST /sessions/:id/activate` → `SESSION_ACTIVATED`
- `POST /sessions/:id/close` → `SESSION_CLOSED`

**`registration.routes.ts`** (1 audit point):
- `POST /registrations/admin-override` → `REGISTRATION_ADMIN_OVERRIDE` (one entry per registration created)

**`payment.routes.ts`** (1 audit point):
- `POST /payments/:id/confirm` → `PAYMENT_CONFIRMED` (admin bank transfer confirmation with before/after state)

**`swap.routes.ts`** (2 audit points):
- `PUT /change-requests/:id/approve` → `CHANGE_REQUEST_APPROVED`
- `PUT /change-requests/:id/reject` → `CHANGE_REQUEST_REJECTED`

All audit calls are fire-and-forget: `.catch(err => console.error(...))` so a logging failure never blocks the primary operation.  
**Files changed:** `apps/api/src/routes/subject.routes.ts`, `apps/api/src/routes/session.routes.ts`, `apps/api/src/routes/registration.routes.ts`, `apps/api/src/routes/payment.routes.ts`, `apps/api/src/routes/swap.routes.ts`

---

### ACT-068 — Create `audit.routes.ts` and mount in `index.ts`

**Date/Time:** 2026-03-05  
**Why:** Expose audit log data to admin users via REST API endpoints.  
**What:** Created `apps/api/src/routes/audit.routes.ts` with two admin-only endpoints:
- `GET /audit/logs` — paginated, filterable list (uses `AuditLogsQuery`); includes joined user name/role/email
- `GET /audit/entity/:type/:id` — full chronological chain-of-custody for any single entity (returns 404 if no history exists)  
Mounted in `apps/api/src/index.ts` as `.route('/audit', audit)` under the `/v1` prefix.  
Added route documentation comment to `index.ts`.  
**Files changed:** `apps/api/src/routes/audit.routes.ts` (new), `apps/api/src/index.ts`

---

### ACT-069 — Create `/admin/audit` web page

**Date/Time:** 2026-03-05  
**Why:** Admins need a visual interface to browse and filter the audit trail (REP-006).  
**What:** Created two files under `apps/web/app/admin/audit/`:

**`page.tsx`** (server component):
- Enforces admin-only access via `requireAdmin()`
- Pre-fetches first page of audit logs for instant display
- Passes dehydrated data to client via `HydrationBoundary`

**`audit-log.client.tsx`** (interactive client component):
- **Filters bar**: Action type dropdown (all 31 actions), Entity type dropdown (7 types), Date from/to pickers, Clear filters button
- **Log table**: columns: Time (relative + absolute on hover), Action (color-coded badge), Entity type, Entity ID, Performed by (name + role), Diff toggle
- **Action color coding**: green=create/request/transfer, blue=update/activate, red=deactivate/close/reject/fail, amber=approve/confirm/fulfil/override
- **Expandable diff row**: Shows `previousData` and `newData` as formatted JSON, IP address
- **Entity history modal** (chain-of-custody): Clicking any entity ID opens a slide-over panel showing the full chronological history with numbered timeline, action badges, actor names, and timestamps. Powered by `GET /v1/audit/entity/:type/:id`
- **Pagination**: Previous/Next with 50 entries per page

**Files changed:** `apps/web/app/admin/audit/page.tsx` (new), `apps/web/app/admin/audit/audit-log.client.tsx` (new)

---

## Phase 4 Step 4.3 Deliverables Summary

| Deliverable | Status |
|---|---|
| `audit_log` DB table + migration | ✅ |
| Audit validation schemas (31 actions, 7 entity types) | ✅ |
| `audit.services.ts` (logAction, getAuditLogs, getEntityHistory, extractAuditContext) | ✅ |
| Subject CRUD audit points (5) | ✅ |
| Session lifecycle audit points (4) | ✅ |
| Registration admin-override audit | ✅ |
| Payment admin confirmation audit | ✅ |
| Change request approve/reject audit (2) | ✅ |
| `audit.routes.ts` (GET /audit/logs, GET /audit/entity/:type/:id) | ✅ |
| `/admin/audit` web page (filters, diff view, entity history modal) | ✅ |

**Audit coverage note:** All 13 wired audit points use fire-and-forget pattern so logging failures never block primary operations. The `PAYMENT_INITIATED`, `REGISTRATION_REQUESTED`, `REGISTRATION_DIRECT`, and `REGISTRATION_APPROVED/REJECTED` audit points are intentionally deferred as they are implicitly covered by the existing `registrationHistory` (jsonb audit trail already present on the registration table) and can be added later without schema changes.

---

*Last updated: 2026-03-05 | Phase 4 Step 4.3 complete: Audit trail fully implemented with DB table, validation schemas, service layer, 13 audit points wired across 5 route files, REST API endpoints, and interactive admin audit log viewer.*

---

## Phase 4 Step 4.4 — Grade Progression Service

### ACT-070 — Create `grade.services.ts`

**Date/Time:** 2026-03-05  
**Why:** GRADE-001 (automatic progression), GRADE-002 (manual admin adjustment), and GRADE-003 (graduation access restriction) are P0 requirements in the URD. The grade progression service encapsulates all logic for safely changing a student's grade level.  
**What:** Created `apps/api/src/services/grade.services.ts` with:
- `getNextGrade(currentGrade, sessionType)` — Internal helper implementing URD progression rules:
  - Grade 10 → 11 after November session
  - Grade 11 → 12 after June session
  - Grade 12 → null (Graduated) after November session
  - No change otherwise
- `progressGrades(sessionType)` — Queries all active students (role='student', grade≠null), applies `getNextGrade`, writes the DB update for each affected student, awaits a `USER_GRADE_CHANGED` audit log entry, and fires `notifyGradeChanged` (fire-and-forget). Returns a list of applied progressions.
- `manualGradeAdjustment(studentId, newGrade, reason, adminId)` — Validates student existence and role, applies the grade update, awaits audit log (admin action must always be logged), fires notification. Throws descriptive errors for invalid states.
- `getGraduatedStudents()` — Queries all users with role='student' and grade=null.
- `isGraduated(studentId)` — Lightweight boolean check used as a guard in other services.  
**Files changed:** `apps/api/src/services/grade.services.ts` (new)

---

### ACT-071 — Add grade-change email template and wire into `notifyGradeChanged`

**Date/Time:** 2026-03-05  
**Why:** Student and parents must receive both in-app and email notifications when a grade changes (per GRADE-001/002 and NOT-010).  
**What:**
- Added `sendGradeChangedEmail(to, data)` template to `apps/api/src/integrations/email.ts`. Renders different subject lines for students vs parents. Includes a congratulatory message for graduation (newGrade=null).
- Updated `notifyGradeChanged` in `notification.services.ts`:
  - Added `sendGradeChangedEmail` to email imports
  - After the in-app notification, fetches student details via `getUserDetails` and fires `sendGradeChangedEmail` (fire-and-forget via `fireEmail`)
  - For each linked parent, fetches parent details via `getUserDetails` and fires `sendGradeChangedEmail` with `isStudent: false`  
**Files changed:** `apps/api/src/integrations/email.ts`, `apps/api/src/services/notification.services.ts`

---

### ACT-072 — Wire `progressGrades` into session scheduler and update `autoManageSessions`

**Date/Time:** 2026-03-05  
**Why:** GRADE-001 requires grades to progress automatically when a session closes. The session scheduler is the only place that knows when sessions auto-close.  
**What:**
- Updated `autoManageSessions` in `session.services.ts`:
  - Changed `closedResult` to also `.returning({ id, sessionType })` so session types are available
  - Updated return type to include `closedSessions: { id, sessionType }[]`
- Updated `session-closer.ts`:
  - Imported `progressGrades` from `grade.services`
  - After auto-close block: deduplicates session types, then calls `progressGrades(sessionType)` for each unique closed type
  - Logs progression count to `logger.info`; errors caught and logged without throwing  
**Files changed:** `apps/api/src/services/session.services.ts`, `apps/api/src/jobs/session-closer.ts`

---

### ACT-073 — Add graduated student access guard to registration and swap services

**Date/Time:** 2026-03-05  
**Why:** GRADE-003 requires that graduated students (role='student', grade=null) cannot initiate new registrations or change requests. Parents retain escrow withdrawal rights.  
**What:** Added `isGraduated(studentId)` check as the first guard in:
- `createRegistrationRequest` (registration.services.ts) — throws `'Graduated students cannot submit new registration requests'`
- `createDirectRegistration` (registration.services.ts) — throws `'Graduated students cannot be registered for new subjects'`
- `createDropRequest` (swap.services.ts) — throws `'Graduated students cannot submit drop requests'`
- `createSwapRequest` (swap.services.ts) — throws `'Graduated students cannot submit swap requests'`

Admin override (`adminOverrideApproval`) intentionally bypasses this guard by design — admins can manually act on graduated student accounts if needed.  
**Files changed:** `apps/api/src/services/registration.services.ts`, `apps/api/src/services/swap.services.ts`

---

### ACT-074 — Create `grade.routes.ts`, add `ManualGradeAdjustment` schema, mount in `index.ts`

**Date/Time:** 2026-03-05  
**Why:** Expose grade management to the admin via REST API. GRADE-002 requires an admin endpoint to manually adjust grades.  
**What:**
- Added `ManualGradeAdjustment` Zod schema to `packages/validations/src/user/user.validations.ts`:
  - `newGrade: GradeSchema | null` — null = graduated
  - `reason: string` (min 5 chars, required)
- Created `apps/api/src/routes/grade.routes.ts` with two admin-only routes:
  - `GET /grade/graduated` — Lists all graduated students (GRADE-003 admin view)
  - `PUT /grade/:studentId` — Manual grade adjustment with validation (GRADE-002); maps service errors to correct HTTP codes (404/400/409)
- Mounted in `apps/api/src/index.ts` as `.route('/grade', grade)` under `/v1`. Added route documentation comment.  
**Files changed:** `packages/validations/src/user/user.validations.ts`, `apps/api/src/routes/grade.routes.ts` (new), `apps/api/src/index.ts`

---

## Phase 4 Step 4.4 Deliverables Summary

| Deliverable | Status |
|---|---|
| `progressGrades(sessionType)` — automatic progression (GRADE-001) | ✅ |
| `manualGradeAdjustment()` — admin manual adjustment (GRADE-002) | ✅ |
| `getGraduatedStudents()` + `isGraduated()` helpers (GRADE-003) | ✅ |
| Grade-change email template + notification wiring | ✅ |
| Auto-progression triggered by session scheduler on close | ✅ |
| `autoManageSessions` returns closed session types for grade progression | ✅ |
| Graduated student guard in `createRegistrationRequest` | ✅ |
| Graduated student guard in `createDirectRegistration` | ✅ |
| Graduated student guard in `createDropRequest` | ✅ |
| Graduated student guard in `createSwapRequest` | ✅ |
| `ManualGradeAdjustment` validation schema | ✅ |
| `GET /grade/graduated` + `PUT /grade/:studentId` routes (admin only) | ✅ |
| `USER_GRADE_CHANGED` audit log entries (awaited, not fire-and-forget) | ✅ |

**Note:** A frontend admin page for manual grade adjustment was not added as a separate file — the admin can use the existing user management page's existing edit flow, or this can be added as a small enhancement in Phase 4 Step 4.5. Parent escrow withdrawal rights for graduated students are preserved by design — no restriction was added to the escrow service as the URD explicitly states parents retain this right.

---

*Last updated: 2026-03-05 | Phase 4 Step 4.4 complete: Grade progression service fully implemented — automatic progression wired to session scheduler, manual admin adjustment API, graduated student access guards, email notifications, and full audit trail.*

---

## Phase 4 Step 4.5 — Web Pages (Reports, Dashboard, Notifications)

### ACT-075 — Create `report.services.ts` (REP-001 to REP-009)

**Date/Time:** 2026-03-05  
**Why:** Phase 4 deliverables require report generation service covering all REP stories. Centralises all read-only reporting queries.  
**What:** Created `apps/api/src/services/report.services.ts` with 8 exported functions:
- `getAdminDashboardMetrics()` (REP-008) — Student counts by grade/graduated, parent count, active sessions, pending approval counts, pending change requests, pending bank transfers, confirmed registrations this month, total escrow liability (EGP). Uses `Promise.all` for concurrent queries.
- `generateRegistrationReport(sessionId, filters?)` (REP-001) — Per-registration rows with student name/grade/ID, subject name/code/council, isOfferedAtSchool, status, price, approvedBy, approvalComments.
- `generateFinancialSummary(sessionId)` (REP-002) — Revenue breakdown: school vs. non-school subjects, confirmed vs. pending, by payment method.
- `generateEscrowReport()` (REP-003) — All escrow accounts with balance, pending withdrawal total, available balance, linked parent names.
- `generateSubjectEnrollmentReport(sessionId)` (REP-004) — Per-subject enrollment counts (confirmed/pending-payment/pending-approval) and total revenue.
- `generateGrade10ComplianceReport(sessionId)` (REP-005) — Grade 10 students vs. required core subjects; per-student compliance flag and per-subject registration status.
- `generateStudentRoster(grade?)` (REP-007) — All students by grade with contact info and linked parent names/emails.
- `generatePendingApprovalsReport()` (REP-009) — All pending registration requests + pending change requests with `daysWaiting` calculated at query time.  
**Files changed:** `apps/api/src/services/report.services.ts` (new)

---

### ACT-076 — Create `report.routes.ts` with CSV export + mount in `index.ts`

**Date/Time:** 2026-03-05  
**Why:** Expose report data via REST API for both web UI consumption and direct CSV download.  
**What:** Created `apps/api/src/routes/report.routes.ts` (all admin-only) with 8 GET endpoints:
- `GET /reports/dashboard` — Dashboard metrics (REP-008)
- `GET /reports/registrations?sessionId&grade?&status?` — REP-001
- `GET /reports/financial?sessionId` — REP-002
- `GET /reports/escrow` — REP-003
- `GET /reports/enrollment?sessionId` — REP-004
- `GET /reports/compliance?sessionId` — REP-005; CSV flattened to one row per student-subject
- `GET /reports/roster?grade?` — REP-007; `grade=graduated` for null-grade students
- `GET /reports/pending-approvals` — REP-009; CSV combines both lists

All endpoints support `?format=csv` for direct browser download. CSV generation uses an inline `toCSV()` helper (no external dependencies) with proper quoting/escaping.  
Mounted in `apps/api/src/index.ts` as `.route('/reports', reports)` with documentation comment.  
**Files changed:** `apps/api/src/routes/report.routes.ts` (new), `apps/api/src/index.ts`

---

### ACT-077 — Create admin dashboard page (REP-008 + REP-009)

**Date/Time:** 2026-03-05  
**Why:** Admins need a visual overview of system health and pending action items at a glance.  
**What:** Created two files under `apps/web/app/admin/dashboard/`:

**`page.tsx`** (server component):
- Enforces admin-only access via `requireAdmin()`
- Server-prefetches both `dashboard` and `pending-approvals` data for instant display

**`dashboard.client.tsx`** (interactive client component):
- **3 metric groups**: "Action Required" (pending approvals, payments, change requests, bank transfers), "Overview" (active sessions, confirmed this month, escrow liability, total parents), "Students by Grade" (10/11/12/graduated)
- MetricCard component with colour-coded left border (amber=action-required, red=urgent, green=healthy, indigo/blue/purple=info) and optional link navigation
- **Pending Approvals table**: combined view of registration requests + drop/swap requests, with DaysBadge showing age colour-coded by urgency (green=<3d, amber=<7d, red=7d+)
- Quick navigation links to Reports, Audit Log, Payments, Sessions, Escrow pages

**Files changed:** `apps/web/app/admin/dashboard/page.tsx` (new), `apps/web/app/admin/dashboard/dashboard.client.tsx` (new)

---

### ACT-078 — Create admin notifications page (NOT-011)

**Date/Time:** 2026-03-05  
**Why:** Admins need a UI to compose and send bulk announcements (NOT-011). The API was built in Phase 4.1; this provides the frontend.  
**What:** Created `apps/web/app/admin/notifications/page.tsx` as a self-contained client component:
- Recipient group selector (all / students / parents / grade 10/11/12) as pill buttons
- Title field (max 150 chars) + body textarea (max 2000 chars) with live character counts
- Email toggle: enables/disables sending email alongside in-app notification
- Preview pane: collapsible, shows formatted title/body/recipient summary
- Submit button disabled until both title (≥3) and body (≥10) are filled
- Success banner: shows recipient count after send; auto-resets the form
- Error banner for failed requests

**Files changed:** `apps/web/app/admin/notifications/page.tsx` (new)

---

### ACT-079 — Create admin reports page (REP-001 to REP-009)

**Date/Time:** 2026-03-05  
**Why:** Admins need a UI to generate, view, and download all report types.  
**What:** Created two files under `apps/web/app/admin/reports/`:

**`page.tsx`** (server component): Enforces admin-only access; no server-side prefetch (reports need user-supplied filters).

**`reports.client.tsx`** (interactive client component):
- **Sidebar**: 7 report type pickers with badge labels
- **Dynamic filter form**: shows Session ID input (required for session-scoped reports), Grade dropdown (optional for roster/registration), or no filters (escrow/pending-approvals)
- **Run Report button**: triggers TanStack Query `useQuery` with enabled gate — query only fires when user clicks
- **CSV download button**: appears after successful run; links directly to `/api/v1/reports/:id?format=csv` with applied filters
- **Specialised result renderers**:
  - `PendingApprovalsView`: split table for registration requests vs. change requests
  - `FinancialView`: flat key-value table including payment method breakdown
  - `ComplianceView`: table with isCompliant flag per student
  - `DataTable`: generic flat-object table used for roster, enrollment, escrow, registration reports
- Row count displayed in results header

**Files changed:** `apps/web/app/admin/reports/page.tsx` (new), `apps/web/app/admin/reports/reports.client.tsx` (new)

---

## Phase 4 Step 4.5 Deliverables Summary

| Deliverable | Status |
|---|---|
| `report.services.ts` — 8 report functions (REP-001 to REP-009 minus REP-006) | ✅ |
| `report.routes.ts` — 8 REST endpoints with CSV export | ✅ |
| Admin dashboard `/admin/dashboard` (REP-008 + pending approvals overview REP-009) | ✅ |
| Admin announcements `/admin/notifications` (NOT-011 composer) | ✅ |
| Admin reports `/admin/reports` (all report types with CSV download) | ✅ |
| `/admin/audit/page.tsx` (REP-006 chain-of-custody) | ✅ Done in Step 4.3 |
| `/notifications/page.tsx` (notification center) | ✅ Done in Step 4.1 |

**Note:** REP-006 (audit trail) was implemented as a dedicated route/page in Step 4.3. PDF/Excel export was not implemented — CSV covers the primary export requirement; PDF/Excel can be added post-launch with `pdfkit`/`xlsx` libraries.

---

*Last updated: 2026-03-05 | Phase 4 Step 4.5 complete: All remaining Phase 4 web pages built — admin dashboard (metrics + pending approvals), bulk announcement composer, and full report generator with CSV export for all 7 report types.*

---

## ACT-080 — Close Gap: Link Request Notifications (AUTH-003, AUTH-004)

**Date:** 2026-03-01
**Code:** ACT-080
**Phase:** Post Phase 4 — Gap Closure

### Why
During the final cross-check of all implemented features against the URD and DEVELOPMENT_PLAN.md, one genuine gap was identified: AUTH-003 (student is notified when a parent sends a link request) and AUTH-004 (parent is notified when a student approves or rejects a link request) were noted as "stub for Phase 4" in Phase 1 but were never wired in Phase 4's notification work.

### What was done

**1. `packages/validations/src/notification/notification.validations.ts`**
- Added `LINK_REQUEST_RECEIVED` and `LINK_DECISION` to `NOTIFICATION_TYPES`.
- Added display labels and icons (`🔗`) for both new types in `NOTIFICATION_TYPE_LABELS` and `NOTIFICATION_TYPE_ICONS`.
- Updated JSDoc header to reference AUTH-003 and AUTH-004.

**2. `apps/api/src/integrations/email.ts`**
- Added `sendLinkRequestEmail(to, data)` — email template sent to the **student** when a parent initiates a link. Includes parent name and email so the student can verify legitimacy.
- Added `sendLinkDecisionEmail(to, data)` — email template sent to the **parent** when a student approves or rejects. Decision is colour-coded (green/red) and message is conditional on outcome.

**3. `apps/api/src/services/notification.services.ts`**
- Imported `sendLinkRequestEmail` and `sendLinkDecisionEmail` from `../integrations/email`.
- Added `notifyLinkRequestReceived(studentId, parentId)` — creates in-app notification for the student (type `LINK_REQUEST_RECEIVED`) and fires `sendLinkRequestEmail` for both in-app and email delivery. Fire-and-forget pattern; failure does not propagate.
- Added `notifyLinkDecision(parentId, studentId, approved)` — creates in-app notification for the parent (type `LINK_DECISION`, title "Link Request Approved" or "Link Request Rejected") and fires `sendLinkDecisionEmail`. Fire-and-forget pattern.
- Both functions use the existing `getUserDetails` helper to resolve names/emails.

**4. `apps/api/src/services/link.services.ts`**
- Imported `notifyLinkRequestReceived` and `notifyLinkDecision` from `./notification.services`.
- In `createLinkRequest`: after inserting the new link row, fires `notifyLinkRequestReceived(student.id, parentId)` — fire-and-forget.
- In `respondToLinkRequest`: after updating the link row, fires `notifyLinkDecision(link.parentId, studentId, response.status === 'approved')` — fire-and-forget.

### Result
AUTH-003 and AUTH-004 are now fully implemented. The gap between the URD's link-request notification requirements and the codebase is closed.

**Files changed:** `packages/validations/src/notification/notification.validations.ts`, `apps/api/src/integrations/email.ts`, `apps/api/src/services/notification.services.ts`, `apps/api/src/services/link.services.ts`

---

---

# ⚠️  DEFERRED ITEMS — READ BEFORE MARKING PROJECT COMPLETE ⚠️

The following items from the URD and DEVELOPMENT_PLAN.md have been **intentionally deferred** and are **NOT implemented** in the current codebase. They must be addressed before any claim of full feature parity with the URD can be made.

---

## DEFERRED-001 — NOT-002: 24-Hour Session-Closing Reminder Email/Notification

**URD Reference:** NOT-002
**Plan Reference:** Phase 4 Step 4.2 — Notification Triggers

**What it requires:**
A scheduled reminder (in-app notification + email) sent to all registered students and their linked parents approximately 24 hours before a registration session deadline closes.

**Why deferred:**
The current background job (`apps/api/src/jobs/session-closer.ts`) uses a simple `setInterval`-based tick that only fires on the minute boundary and checks for sessions that have *already* crossed their deadline. A 24-hour lookahead requires a separate scheduled check (e.g., a cron running at a configurable offset before deadline) which would add complexity beyond MVP scope. The `SESSION_CLOSING_SOON` notification type and `sendSessionClosingSoonEmail` template are both implemented and ready — only the scheduler trigger is missing.

**Effort to implement:** Low-medium. Add a `checkClosingSoonSessions` function in `session.services.ts` and a second interval (or extend the existing tick) that queries sessions where `deadline BETWEEN now AND now + 24h` and fires `notifySessionClosingSoon` for all affected registrations.

**Status:** ⏳ DEFERRED — implementation ready, scheduler trigger missing

---

## DEFERRED-002 — Phase 4.6: Graduation Plan & Career Visualization

**URD Reference:** GRAD section (P3 Priority)
**Plan Reference:** Phase 4 Step 4.6

**What it requires:**
A student-facing "Graduation Plan" page that visualises subject choices, career pathway options, and predicted A-Level progression. Includes a career pathway selector, subject coverage map, and a printable summary.

**Why deferred:**
This feature is explicitly marked as **Priority 3 (P3)** in the URD — meaning it is a "nice to have" enhancement that should only be built after all P1 and P2 features are stable and tested. No backend schema changes are required; this is a purely frontend UI feature layered on top of existing registration/subject data.

**Effort to implement:** Medium-high (UI only). Build a new `/graduation-plan` page under `apps/web/app/` using existing API data (registered subjects, grade, session history). No new API routes needed.

**Status:** ⏳ DEFERRED — P3 priority, explicitly post-launch

---

## DEFERRED-003 — PDF / Excel Export for Reports

**URD Reference:** REP-001 to REP-009 (export format)
**Plan Reference:** Phase 4 Step 4.5

**What it requires:**
Downloadable PDF and/or Excel (`.xlsx`) versions of all admin reports in addition to the CSV export that is currently implemented.

**Why deferred:**
CSV export is implemented and covers the primary programmatic export requirement. PDF and Excel require additional dependencies (`pdfkit` or `@react-pdf/renderer` for PDF; `xlsx` or `exceljs` for Excel) and per-report formatting work. This was consciously scoped out of the initial implementation.

**Effort to implement:** Medium. Install the relevant library, create a generic `toXlsx` or `toPdf` utility in `report.routes.ts` parallel to the existing `toCSV` helper, and expose an additional `?format=xlsx` / `?format=pdf` query parameter.

**Status:** ⏳ DEFERRED — CSV covers MVP needs; PDF/Excel post-launch enhancement

---

*Last updated: 2026-03-01 | ACT-080 closes the final identified gap (AUTH-003/AUTH-004). All P1 and P2 features are now fully implemented. Three items remain intentionally deferred as documented above.*
