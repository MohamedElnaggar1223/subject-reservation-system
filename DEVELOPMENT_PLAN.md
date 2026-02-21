# IGCSE Subject Reservation System - Development Plan

**Document Version:** 1.0  
**Created:** January 2026  
**Purpose:** Comprehensive development roadmap for implementing all URD features

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Role System Analysis](#3-role-system-analysis)
4. [Development Phases](#4-development-phases)
5. [Feature Dependency Map](#5-feature-dependency-map)
6. [Phase 1: Foundation Layer](#6-phase-1-foundation-layer)
7. [Phase 2: Core Domain Layer](#7-phase-2-core-domain-layer)
8. [Phase 3: Transaction Layer](#8-phase-3-transaction-layer)
9. [Phase 4: Support Systems](#9-phase-4-support-systems)
10. [Cross-Cutting Concerns](#10-cross-cutting-concerns)
11. [Implementation Patterns](#11-implementation-patterns)
12. [Testing Strategy](#12-testing-strategy)
13. [Risk Assessment](#13-risk-assessment)

---

## 1. Executive Summary

### Project Scope
- **Total User Stories:** 60
- **P0 (Critical):** 47
- **P1 (High):** 12
- **P2 (Medium):** 1
- **Personas:** Admin, Student, Parent

### Development Approach
The system will be built in **4 major phases**, each building upon the previous:

1. **Foundation Layer** (Weeks 1-3): Authentication, roles, and core user relationships
2. **Core Domain Layer** (Weeks 4-6): Subjects, sessions, and registration windows
3. **Transaction Layer** (Weeks 7-10): Registration, payments, swapping, escrow
4. **Support Systems** (Weeks 11-13): Notifications, reports, grade progression

### Critical Dependencies
```
Authentication → User Relationships → Subjects → Sessions → Registration → Payments → Escrow
                                                    ↓
                                              Core Subjects (Grade 10)
```

---

## 2. Architecture Overview

### Existing Stack (Do Not Modify)
```
apps/
├── api/      # Hono REST API (port 3001) - Add new routes here
├── web/      # Next.js 16 App Router (port 3000) - Add pages here
└── app/      # Expo React Native (future mobile)

packages/
├── db/           # Drizzle ORM - Add new tables to schema.ts
├── validations/  # Zod schemas - Add new validation files
├── storage/      # R2 file storage (existing)
├── typescript-config/
└── eslint-config/
```

### Key Patterns to Follow
1. **Hono RPC Type Inference** - Never manually type API responses
2. **Database Abstraction** - All imports from `@repo/db`, never `drizzle-orm`
3. **Input-Only Validation Types** - Only export types for inputs (Zod schemas)
4. **Service Layer Pattern** - Business logic in services, HTTP in routes
5. **Server-First Rendering** - Pre-fetch data on server, hydrate on client

---

## 3. Role System Analysis

### Current Roles (in codebase)
```typescript
// packages/validations/src/roles.ts
export const ROLES = {
  ADMIN: 'admin',
  COACH: 'coach',    // Will repurpose or remove
  STUDENT: 'student',
  USER: 'user',      // Will repurpose or remove
} as const;
```

### Required Roles (from URD)
| Role | URD Persona | Capabilities |
|------|-------------|--------------|
| `admin` | P01 Admin | Full system access, manage subjects, sessions, reports |
| `student` | P02 Student | Register subjects, manage own account, escrow |
| `parent` | P03 Parent | Manage linked children, register on behalf, transfer escrow |

### Role Migration Strategy
1. **Keep:** `admin`, `student`
2. **Add:** `parent`
3. **Repurpose/Remove:** `coach`, `user`

```typescript
// Updated ROLES (to implement)
export const ROLES = {
  ADMIN: 'admin',
  STUDENT: 'student',
  PARENT: 'parent',
} as const;
```

---

## 4. Development Phases

### Phase Overview Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PHASE 1: FOUNDATION LAYER                        │
│  AUTH-001 to AUTH-008 | User Model Extension | Parent-Student Link   │
│                           (Weeks 1-3)                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PHASE 2: CORE DOMAIN LAYER                        │
│  SUB-001 to SUB-006 | SES-001 to SES-006 | CORE-001 to CORE-004     │
│                           (Weeks 4-6)                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PHASE 3: TRANSACTION LAYER                        │
│  REG-001 to REG-005 | PAY-001 to PAY-007 | SWAP-001 to SWAP-006     │
│  ESC-001 to ESC-008                                                  │
│                          (Weeks 7-10)                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PHASE 4: SUPPORT SYSTEMS                          │
│  NOT-001 to NOT-008 | REP-001 to REP-008 | GRADE-001 to GRADE-003   │
│                          (Weeks 11-13)                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Feature Dependency Map

### Critical Path (Must be sequential)
```
User Auth (AUTH-001-008)
    └──► Parent-Student Link (AUTH-003, AUTH-004)
            └──► Subject Creation (SUB-001)
                    └──► Core Subjects Definition (CORE-001)
                            └──► Session Windows (SES-001)
                                    └──► Subject Registration (REG-001)
                                            └──► Payment Processing (PAY-001-007)
                                                    └──► Escrow Management (ESC-001-008)
                                                            └──► Subject Swapping (SWAP-001-006)
```

### Parallel Development Opportunities
These can be developed alongside their prerequisites:

| Feature Group | Prerequisites | Can Parallel With |
|---------------|---------------|-------------------|
| Subject Browse (SUB-005, SUB-006) | SUB-001 | SES-001-006 |
| Registration History (REG-005) | REG-001 | PAY-001-007 |
| Audit Trail (REP-006) | Any CRUD operations | All features |
| Email Notifications | SMTP setup | All transactional features |

### Bidirectional Dependencies (Affect Each Other)

| Feature A | Feature B | Relationship |
|-----------|-----------|--------------|
| Registration (REG) | Escrow (ESC) | Payments flow into escrow; escrow used for payments |
| Swapping (SWAP) | Escrow (ESC) | Drops credit escrow; swaps may debit/credit escrow |
| Core Subjects (CORE) | Swapping (SWAP) | Core subjects cannot be swapped |
| Sessions (SES) | Registration (REG) | Sessions control registration availability |
| Sessions (SES) | Swapping (SWAP) | Sessions control swapping availability |

---

## 6. Phase 1: Foundation Layer

### Objective
Establish authentication, user management, and parent-student relationships.

### Database Schema Changes

#### 6.1 User Table Extension

```
Table: user (extend existing)
├── id: text (PK) - existing
├── email: text - existing
├── name: text - existing
├── role: text - UPDATE: enforce 'admin' | 'student' | 'parent'
├── grade: integer (nullable) - NEW: 10, 11, 12, or null (graduated)
├── studentId: text (unique, nullable) - NEW: for parent linking
├── phone: text (nullable) - NEW: optional contact
├── emailVerified: boolean - existing
└── (timestamps) - existing
```

#### 6.2 Parent-Student Link Table (NEW)

```
Table: parent_student_link
├── id: text (PK)
├── parentId: text (FK → user.id)
├── studentId: text (FK → user.id)
├── status: text ('pending' | 'approved' | 'rejected')
├── requestedAt: timestamp
├── respondedAt: timestamp (nullable)
└── (timestamps)
```

### User Stories Mapping

| ID | Story | Implementation Notes |
|----|-------|---------------------|
| AUTH-001 | Student registration | Extend sign-up to capture grade (10-12) |
| AUTH-002 | Parent registration | Add `parent` role option during sign-up |
| AUTH-003 | Parent links child | New API: POST /v1/links - Create pending link |
| AUTH-004 | Student approves link | New API: PUT /v1/links/:id - Approve/reject |
| AUTH-005 | User login | Existing better-auth (update redirect logic) |
| AUTH-006 | Password reset | Existing better-auth (configure email) |
| AUTH-007 | Profile update | New API: PUT /v1/users/me |
| AUTH-008 | Admin login | Existing (role check for admin dashboard) |

### Implementation Steps

#### Step 1.1: Role System Update
**Files to modify:**
- `packages/validations/src/roles.ts` - Update ROLES constant
- `apps/api/src/lib/permissions.ts` - Add `parentRole` permissions
- `apps/api/src/lib/auth.ts` - Update role configuration

**Validation schemas to create:**
- `packages/validations/src/auth/auth.validations.ts`
  - `StudentSignUp` - includes grade selection
  - `ParentSignUp` - parent-specific fields
  - `UpdateProfile` - name, phone updates

#### Step 1.2: Database Schema Extension
**Files to modify:**
- `packages/db/src/schema.ts` - Add grade, studentId to user; add parent_student_link table

**Migration to generate:**
```bash
cd packages/db && pnpm db:generate:migrations
```

#### Step 1.3: Parent-Student Link Service
**New file:** `apps/api/src/services/link.services.ts`
- `createLinkRequest(parentId, studentIdentifier)` - email or studentId
- `getPendingLinksForStudent(studentId)`
- `getPendingLinksForParent(parentId)`
- `approveLinkRequest(linkId, studentId)`
- `rejectLinkRequest(linkId, studentId)`
- `getLinkedChildren(parentId)`
- `getLinkedParents(studentId)`

#### Step 1.4: Link API Routes
**New file:** `apps/api/src/routes/link.routes.ts`
- `POST /links` - Parent creates link request
- `GET /links/pending` - Get pending requests (student or parent view)
- `PUT /links/:id` - Approve/reject request
- `GET /links/children` - Parent gets linked children
- `GET /links/parents` - Student gets linked parents

#### Step 1.5: Profile Update Service & Routes
**New file:** `apps/api/src/services/user.services.ts`
- `getUserProfile(userId)`
- `updateUserProfile(userId, data)`
- `generateUniqueStudentId()` - Auto-generate on student creation

**New file:** `apps/api/src/routes/user.routes.ts`
- `GET /users/me` - Get own profile
- `PUT /users/me` - Update profile

#### Step 1.6: Web Pages
**New pages:**
- `apps/web/app/sign-up/student/page.tsx` - Student-specific sign-up
- `apps/web/app/sign-up/parent/page.tsx` - Parent-specific sign-up
- `apps/web/app/profile/page.tsx` - Profile management
- `apps/web/app/links/page.tsx` - Link management (for both roles)

### Phase 1 Deliverables Checklist
- [ ] Updated role system with `admin`, `student`, `parent`
- [ ] Extended user table with grade and studentId
- [ ] Parent-student link table and relations
- [ ] Link request/approval flow API
- [ ] Profile management API
- [ ] Role-specific sign-up pages
- [ ] Link management UI
- [ ] Email notifications for link requests (stub for Phase 4)

### Affects Future Development
- **Registration (REG)**: Must handle parent acting on behalf of student
- **Escrow (ESC)**: Must track per-student, accessible by parent
- **Notifications (NOT)**: Parent receives all child-related notifications
- **Reports (REP)**: Admin reports group by grade, show parent links

---

## 7. Phase 2: Core Domain Layer

### Objective
Implement subject catalog, session management, and core subject rules.

### Database Schema Changes

#### 7.1 Subject Table (NEW)

```
Table: subject
├── id: text (PK)
├── name: text
├── code: text (unique)
├── council: text ('pearson_edexcel' | 'cambridge' | 'oxford')
├── priceInSchool: numeric
├── priceExternal: numeric (nullable - null means external not available)
├── isActive: boolean (default true)
├── isCore: boolean (default false) - For Grade 10 core subjects
└── (timestamps)
```

#### 7.2 Registration Session Table (NEW)

```
Table: registration_session
├── id: text (PK)
├── name: text ('June 2026' | 'November 2026' | 'January 2027')
├── sessionType: text ('june' | 'november' | 'january')
├── startDate: timestamp
├── endDate: timestamp
├── status: text ('draft' | 'active' | 'closed')
├── closedAt: timestamp (nullable) - When actually closed
├── closedBy: text (FK → user.id, nullable) - If manually closed
└── (timestamps)
```

### User Stories Mapping

| ID | Story | Implementation Notes |
|----|-------|---------------------|
| SUB-001 | Admin creates subject | Full CRUD with council, pricing, external option |
| SUB-002 | Admin views subjects | List with filters (council, search) |
| SUB-003 | Admin edits subject | Update any field, future registrations only |
| SUB-004 | Admin deactivates subject | Soft delete, existing registrations unaffected |
| SUB-005 | User browses subjects | Public read with filters |
| SUB-006 | User views subject details | Single subject with all pricing info |
| SES-001 | Admin creates session | Date range, unique active constraint |
| SES-002 | Admin views sessions | List with status filter |
| SES-003 | Admin edits draft session | Only before active |
| SES-004 | Admin closes session early | Manual close with confirmation |
| SES-005 | User sees session status | Dashboard shows current window |
| SES-006 | Auto-close sessions | Scheduled job at endDate |
| CORE-001 | Admin marks core subject | Flag subjects as core for Grade 10 |
| CORE-002 | Admin removes core flag | Only affects future sessions |
| CORE-003 | Grade 10 sees locked cores | Pre-selected, cannot remove |
| CORE-004 | Grade 10 cannot swap cores | Block UI + API validation |

### Implementation Steps

#### Step 2.1: Subject Service & Routes

**Validation schemas:**
- `packages/validations/src/subject/subject.validations.ts`
  - `CreateSubject` - name, code, council, prices, external option
  - `UpdateSubject` - partial, all fields optional
  - `SubjectId` - UUID validation
  - `ListSubjectsQuery` - filters (council, search, active, core)

**Service:** `apps/api/src/services/subject.services.ts`
- `createSubject(data)` - Admin only
- `getSubjects(filters)` - Public with optional filters
- `getSubjectById(id)` - Public
- `updateSubject(id, data)` - Admin only
- `deactivateSubject(id)` - Admin only (soft delete)
- `setSubjectCore(id, isCore)` - Admin only

**Routes:** `apps/api/src/routes/subject.routes.ts`
- `GET /subjects` - List (public)
- `GET /subjects/:id` - Get one (public)
- `POST /subjects` - Create (admin)
- `PUT /subjects/:id` - Update (admin)
- `DELETE /subjects/:id` - Deactivate (admin)
- `PUT /subjects/:id/core` - Set core flag (admin)

#### Step 2.2: Registration Session Service & Routes

**Validation schemas:**
- `packages/validations/src/session/session.validations.ts`
  - `CreateSession` - name, type, dates
  - `UpdateSession` - dates only (before active)
  - `SessionId` - UUID validation

**Service:** `apps/api/src/services/session.services.ts`
- `createSession(data)` - Admin only, validates no overlap
- `getSessions(filters)` - Include status filter
- `getActiveSession()` - Returns current active or null
- `updateSession(id, data)` - Only draft sessions
- `closeSession(id, adminId)` - Manual close
- `autoCloseExpiredSessions()` - Called by scheduler

**Routes:** `apps/api/src/routes/session.routes.ts`
- `GET /sessions` - List all (admin)
- `GET /sessions/active` - Get active session (public)
- `POST /sessions` - Create (admin)
- `PUT /sessions/:id` - Update draft (admin)
- `POST /sessions/:id/close` - Manual close (admin)

#### Step 2.3: Core Subject Integration

The `isCore` flag on subjects determines:
1. **Registration flow**: Grade 10 students in June session auto-add all core subjects
2. **Swap/Drop validation**: API rejects drop/swap of core subjects for Grade 10
3. **UI treatment**: Core subjects shown as locked in registration UI

**Key validation function:**
```typescript
// In registration service
async function validateCoreSubjects(studentId: string, sessionType: string, subjectIds: string[]) {
  const student = await getUserById(studentId);
  if (student.grade !== 10 || sessionType !== 'june') return true;
  
  const coreSubjects = await getCoreSubjects();
  const coreIds = coreSubjects.map(s => s.id);
  
  // All core subjects must be included
  return coreIds.every(id => subjectIds.includes(id));
}
```

#### Step 2.4: Session Auto-Close Scheduler

**Options for implementation:**
1. **Cron job** (recommended for MVP) - Simple scheduled task
2. **BullMQ** (future) - If `@repo/queue` is implemented
3. **External scheduler** (Render cron, Vercel cron)

**Implementation:**
- Create `apps/api/src/jobs/session-closer.ts`
- Run every minute, check for expired active sessions
- Close and trigger notification emails

#### Step 2.5: Web Pages

**Admin pages:**
- `apps/web/app/admin/subjects/page.tsx` - Subject management
- `apps/web/app/admin/sessions/page.tsx` - Session management

**User pages:**
- `apps/web/app/subjects/page.tsx` - Browse subjects (student/parent)

### Phase 2 Deliverables Checklist
- [ ] Subject table with council enum and pricing
- [ ] Session table with status workflow
- [ ] Full subject CRUD API (admin)
- [ ] Subject browse API (public)
- [ ] Session CRUD API (admin)
- [ ] Active session check API (public)
- [ ] Core subject flag and validation
- [ ] Session auto-close scheduler
- [ ] Admin subject management UI
- [ ] Admin session management UI
- [ ] Subject browse UI for students/parents

### Affects Future Development
- **Registration (REG)**: Uses subjects, validates against active session
- **Payments (PAY)**: Prices come from subjects (at time of registration)
- **Swapping (SWAP)**: Validates core subjects cannot be dropped
- **Reports (REP)**: Subject enrollment reports reference this data

---

## 8. Phase 3: Transaction Layer

### Objective
Implement the complete registration, payment, escrow, and swapping workflow.

### Database Schema Changes

#### 8.1 Registration Table (NEW)

```
Table: registration
├── id: text (PK)
├── studentId: text (FK → user.id)
├── sessionId: text (FK → registration_session.id)
├── subjectId: text (FK → subject.id)
├── registrationType: text ('in_school' | 'external')
├── priceAtRegistration: numeric - Snapshot of price
├── status: text ('pending_payment' | 'confirmed' | 'dropped')
├── registeredBy: text (FK → user.id) - Student or parent
├── droppedAt: timestamp (nullable)
└── (timestamps)
```

#### 8.2 Payment Table (NEW)

```
Table: payment
├── id: text (PK)
├── studentId: text (FK → user.id)
├── amount: numeric
├── paymentMethod: text ('fawry' | 'card' | 'mobile_wallet' | 'bank_transfer')
├── status: text ('pending' | 'completed' | 'failed' | 'refunded')
├── externalReference: text (nullable) - Fawry code, transaction ID
├── confirmedAt: timestamp (nullable)
├── confirmedBy: text (nullable) - For bank transfer manual confirmation
├── metadata: jsonb (nullable) - Provider-specific data
└── (timestamps)
```

#### 8.3 Payment Registration Link Table (NEW)

```
Table: payment_registration
├── id: text (PK)
├── paymentId: text (FK → payment.id)
├── registrationId: text (FK → registration.id)
└── (timestamps)
```

#### 8.4 Escrow Table (NEW)

```
Table: escrow
├── id: text (PK)
├── studentId: text (FK → user.id)
├── balance: numeric (default 0)
└── (timestamps)
```

#### 8.5 Escrow Transaction Table (NEW)

```
Table: escrow_transaction
├── id: text (PK)
├── escrowId: text (FK → escrow.id)
├── type: text ('credit' | 'debit')
├── amount: numeric
├── reason: text ('drop' | 'swap_refund' | 'transfer_in' | 'transfer_out' | 'withdrawal' | 'payment')
├── relatedRegistrationId: text (nullable, FK → registration.id)
├── relatedPaymentId: text (nullable, FK → payment.id)
├── initiatedBy: text (FK → user.id)
└── (timestamps)
```

#### 8.6 Withdrawal Request Table (NEW)

```
Table: withdrawal_request
├── id: text (PK)
├── escrowId: text (FK → escrow.id)
├── requestedAmount: numeric
├── releasedAmount: numeric (nullable)
├── status: text ('pending' | 'partially_fulfilled' | 'fulfilled' | 'rejected')
├── adminNotes: text (nullable)
├── fulfilledAt: timestamp (nullable)
├── fulfilledBy: text (nullable, FK → user.id)
└── (timestamps)
```

### User Stories Mapping

#### Registration (REG-001 to REG-005)

| ID | Story | Implementation Notes |
|----|-------|---------------------|
| REG-001 | Student registers subjects | Cart system → checkout → payment |
| REG-002 | Parent registers for child | Same flow, specify child |
| REG-003 | View registered subjects | Per session view with details |
| REG-004 | Block when window closed | Validate session status |
| REG-005 | Registration history | All sessions view |

#### Payments (PAY-001 to PAY-007)

| ID | Story | Implementation Notes |
|----|-------|---------------------|
| PAY-001 | Fawry payment | Generate code, webhook for confirmation |
| PAY-002 | Card payment | Integrate payment gateway (e.g., Paymob) |
| PAY-003 | Mobile wallet | Integrate wallet providers |
| PAY-004 | Bank transfer | Manual confirmation by admin |
| PAY-005 | Use escrow balance | Deduct from escrow, pay remainder |
| PAY-006 | Payment receipt email | Email with PDF attachment |
| PAY-007 | Admin confirms bank transfer | Admin API + dashboard |

#### Swapping (SWAP-001 to SWAP-006)

| ID | Story | Implementation Notes |
|----|-------|---------------------|
| SWAP-001 | Drop subject | Full refund to escrow |
| SWAP-002 | Swap subjects | Price diff calculation |
| SWAP-003 | Switch registration type | In-school ↔ External |
| SWAP-004 | Parent performs swaps | Same as student for linked child |
| SWAP-005 | Block core subject swap | Validate Grade 10 + June |
| SWAP-006 | Block when window closed | Validate session status |

#### Escrow (ESC-001 to ESC-008)

| ID | Story | Implementation Notes |
|----|-------|---------------------|
| ESC-001 | Student views escrow | Balance + transactions |
| ESC-002 | Parent views children escrows | All linked children |
| ESC-003 | Parent transfers escrow | Between linked children |
| ESC-004 | Student requests withdrawal | Create pending request |
| ESC-005 | Parent requests withdrawal | On behalf of child |
| ESC-006 | Admin views withdrawal requests | Dashboard list |
| ESC-007 | Admin fulfills withdrawal | Partial or full, updates balance |
| ESC-008 | View withdrawal history | All past requests |

### Implementation Steps

#### Step 3.1: Registration Service

**Validation schemas:** `packages/validations/src/registration/registration.validations.ts`
- `CreateRegistration` - subjectId, type, studentId (for parent)
- `RegistrationCheckout` - array of registrations + payment method

**Service:** `apps/api/src/services/registration.services.ts`
- `getAvailableSubjects(studentId, sessionId)` - Filter already registered
- `createPendingRegistrations(studentId, registrations, registeredBy)`
- `confirmRegistrations(paymentId, registrationIds)`
- `getStudentRegistrations(studentId, sessionId?)`
- `getRegistrationHistory(studentId)`
- `validateCoreSubjectRequirements(studentId, sessionId, subjectIds)`

**Routes:** `apps/api/src/routes/registration.routes.ts`
- `GET /registrations` - Own or child registrations
- `POST /registrations/checkout` - Create pending + initiate payment
- `GET /registrations/history` - All sessions

#### Step 3.2: Payment Service

**Validation schemas:** `packages/validations/src/payment/payment.validations.ts`
- `InitiatePayment` - amount, method, registrationIds
- `ConfirmBankTransfer` - paymentId, confirmation details

**Service:** `apps/api/src/services/payment.services.ts`
- `initiatePayment(studentId, amount, method, registrationIds, escrowAmount?)`
- `confirmPayment(paymentId, externalRef?)` - Called by webhook or admin
- `getPaymentsByStudent(studentId)`
- `getPaymentById(id)`
- `getPendingBankTransfers()` - Admin view

**Payment Provider Integration:**
- Create `apps/api/src/integrations/` folder
- `fawry.ts` - Fawry API client
- `paymob.ts` - Card payment gateway
- `wallet.ts` - Mobile wallet integrations

**Routes:** `apps/api/src/routes/payment.routes.ts`
- `POST /payments/initiate` - Start payment flow
- `GET /payments` - Own payment history
- `GET /payments/:id` - Payment details
- `POST /payments/:id/confirm` - Admin confirms bank transfer
- `POST /payments/webhook/fawry` - Fawry callback
- `POST /payments/webhook/paymob` - Card payment callback

#### Step 3.3: Escrow Service

**Validation schemas:** `packages/validations/src/escrow/escrow.validations.ts`
- `TransferEscrow` - fromStudentId, toStudentId, amount
- `RequestWithdrawal` - amount, studentId (for parent)
- `FulfillWithdrawal` - requestId, amount, notes

**Service:** `apps/api/src/services/escrow.services.ts`
- `getOrCreateEscrow(studentId)`
- `getEscrowBalance(studentId)`
- `creditEscrow(studentId, amount, reason, relatedIds, initiatedBy)`
- `debitEscrow(studentId, amount, reason, relatedIds, initiatedBy)`
- `transferEscrow(fromStudentId, toStudentId, amount, parentId)`
- `createWithdrawalRequest(studentId, amount, requestedBy)`
- `fulfillWithdrawalRequest(requestId, amount, adminId, notes?)`
- `getEscrowTransactions(studentId)`
- `getWithdrawalRequests(studentId)`
- `getPendingWithdrawalRequests()` - Admin view

**Routes:** `apps/api/src/routes/escrow.routes.ts`
- `GET /escrow` - Own escrow balance
- `GET /escrow/children` - Parent view of children escrows
- `GET /escrow/transactions` - Transaction history
- `POST /escrow/transfer` - Parent transfers between children
- `POST /escrow/withdraw` - Request withdrawal
- `GET /escrow/withdrawals` - Withdrawal history

**Admin routes:**
- `GET /admin/escrow/withdrawals` - Pending withdrawals
- `POST /admin/escrow/withdrawals/:id/fulfill` - Fulfill request

#### Step 3.4: Swap Service

**Validation schemas:** `packages/validations/src/swap/swap.validations.ts`
- `DropSubject` - registrationId
- `SwapSubject` - dropRegistrationId, newSubjectId, newType
- `SwitchType` - registrationId, newType

**Service:** `apps/api/src/services/swap.services.ts`
- `validateCanModify(registrationId, userId)` - Session open, ownership, not core
- `dropSubject(registrationId, userId)` - Refund to escrow
- `swapSubject(registrationId, newSubjectId, newType, userId)` - Price diff handling
- `switchRegistrationType(registrationId, newType, userId)` - Price diff handling

**Routes:** `apps/api/src/routes/swap.routes.ts`
- `POST /registrations/:id/drop` - Drop subject
- `POST /registrations/:id/swap` - Swap for another
- `POST /registrations/:id/switch-type` - Change in-school/external

#### Step 3.5: Web Pages

**Student/Parent pages:**
- `apps/web/app/register/page.tsx` - Subject selection + checkout
- `apps/web/app/registrations/page.tsx` - Current registrations
- `apps/web/app/registrations/history/page.tsx` - All sessions
- `apps/web/app/escrow/page.tsx` - Balance + transactions
- `apps/web/app/escrow/withdraw/page.tsx` - Request withdrawal

**Admin pages:**
- `apps/web/app/admin/payments/page.tsx` - Bank transfer confirmations
- `apps/web/app/admin/escrow/page.tsx` - Withdrawal fulfillment

### Phase 3 Deliverables Checklist
- [ ] Registration table with status workflow
- [ ] Payment table with method enum
- [ ] Escrow tables (balance + transactions + withdrawals)
- [ ] Subject registration flow API
- [ ] Payment initiation API (stub for integrations)
- [ ] Fawry integration (or stub)
- [ ] Card payment integration (or stub)
- [ ] Bank transfer manual confirmation
- [ ] Escrow balance and transaction API
- [ ] Escrow transfer API (parent between children)
- [ ] Withdrawal request/fulfillment flow
- [ ] Drop/Swap/Switch API with validations
- [ ] Core subject swap blocking
- [ ] Registration UI with cart
- [ ] Payment selection UI
- [ ] Escrow management UI
- [ ] Admin payment/escrow dashboards

### Affects Future Development
- **Notifications (NOT)**: All transactions trigger notifications
- **Reports (REP)**: Financial reports pull from payments/escrow
- **Audit Trail (REP-006)**: All actions logged

---

## 9. Phase 4: Support Systems

### Objective
Implement notifications, reporting, and automated grade progression.

### Database Schema Changes

#### 9.1 Notification Table (NEW)

```
Table: notification
├── id: text (PK)
├── userId: text (FK → user.id)
├── type: text (enum of notification types)
├── title: text
├── body: text
├── data: jsonb (nullable) - Related IDs, links
├── readAt: timestamp (nullable)
├── emailSentAt: timestamp (nullable)
└── (timestamps)
```

#### 9.2 Audit Log Table (NEW)

```
Table: audit_log
├── id: text (PK)
├── userId: text (FK → user.id, nullable) - System actions have null
├── action: text (enum of action types)
├── entityType: text ('user' | 'subject' | 'registration' | 'payment' | 'escrow' | 'session')
├── entityId: text
├── previousData: jsonb (nullable)
├── newData: jsonb (nullable)
├── ipAddress: text (nullable)
├── userAgent: text (nullable)
└── (timestamps)
```

### User Stories Mapping

#### Notifications (NOT-001 to NOT-008)

| ID | Story | Implementation Notes |
|----|-------|---------------------|
| NOT-001 | Session window opens | Email blast to all students/parents |
| NOT-002 | Session closing soon | 24-hour reminder |
| NOT-003 | Registration confirmed | Email with subjects + receipt |
| NOT-004 | Drop/swap notification | Email with financial impact |
| NOT-005 | Escrow balance change | Email with transaction details |
| NOT-006 | Withdrawal fulfilled | Email with amount + instructions |
| NOT-007 | Parent notifications | CC parent on child's notifications |
| NOT-008 | Admin bulk announcements | Admin composes + sends to groups |

#### Reports (REP-001 to REP-008)

| ID | Story | Implementation Notes |
|----|-------|---------------------|
| REP-001 | Registration report | Per session, filterable, exportable |
| REP-002 | Financial summary | Revenue breakdown |
| REP-003 | Escrow report | Balances, liability, pending |
| REP-004 | Subject enrollment | Students per subject |
| REP-005 | Grade 10 compliance | Core subject check |
| REP-006 | Audit trail | All system actions |
| REP-007 | Student roster | By grade with contacts |
| REP-008 | Admin dashboard | Key metrics overview |

#### Grade Progression (GRADE-001 to GRADE-003)

| ID | Story | Implementation Notes |
|----|-------|---------------------|
| GRADE-001 | Auto grade progression | Scheduled job after sessions |
| GRADE-002 | Admin manual adjustment | Override grade + log reason |
| GRADE-003 | Graduated student access | Limited to history + escrow |

### Implementation Steps

#### Step 4.1: Notification Service

**Service:** `apps/api/src/services/notification.services.ts`
- `createNotification(userId, type, title, body, data?)`
- `createBulkNotifications(userIds, type, title, body, data?)`
- `getUserNotifications(userId, unreadOnly?)`
- `markAsRead(notificationId)`
- `markAllAsRead(userId)`

**Email Integration:**
- Create `apps/api/src/integrations/email.ts`
- Use Resend, SendGrid, or AWS SES
- Template system for different notification types

**Notification Triggers (integrate with existing services):**
```typescript
// After payment confirmation
await notificationService.createNotification(
  studentId,
  'REGISTRATION_CONFIRMED',
  'Registration Confirmed',
  'Your registration for June 2026 has been confirmed.',
  { sessionId, registrationIds }
);

// Also notify parent if linked
const parents = await getLinkedParents(studentId);
for (const parent of parents) {
  await notificationService.createNotification(
    parent.id,
    'CHILD_REGISTRATION_CONFIRMED',
    `${student.name}'s Registration Confirmed`,
    'Your child\'s registration has been confirmed.',
    { studentId, sessionId, registrationIds }
  );
}
```

#### Step 4.2: Audit Trail Service

**Service:** `apps/api/src/services/audit.services.ts`
- `logAction(userId, action, entityType, entityId, previousData?, newData?, request?)`
- `getAuditLogs(filters)` - Admin query with filters
- `getEntityHistory(entityType, entityId)` - All changes to one entity

**Integration pattern (middleware or service wrapper):**
```typescript
// In subject service
export async function updateSubject(id: string, data: UpdateSubjectType, adminId: string) {
  const previous = await getSubjectById(id);
  
  const updated = await db.update(subject)...;
  
  await auditService.logAction(
    adminId,
    'SUBJECT_UPDATED',
    'subject',
    id,
    previous,
    updated
  );
  
  return updated;
}
```

#### Step 4.3: Reports Service

**Service:** `apps/api/src/services/report.services.ts`
- `generateRegistrationReport(sessionId, filters)`
- `generateFinancialSummary(sessionId)`
- `generateEscrowReport()`
- `generateSubjectEnrollmentReport(sessionId)`
- `generateGrade10ComplianceReport(sessionId)`
- `generateStudentRoster(grade?)`
- `getAdminDashboardMetrics()`

**Export functionality:**
- Create `apps/api/src/lib/export.ts`
- CSV generation using `papaparse`
- PDF generation using `pdfkit` or `puppeteer`
- Excel using `xlsx` library

**Routes:** `apps/api/src/routes/report.routes.ts`
- `GET /admin/reports/registrations` - Query + export
- `GET /admin/reports/financial` - Financial summary
- `GET /admin/reports/escrow` - Escrow liability
- `GET /admin/reports/enrollment` - Subject stats
- `GET /admin/reports/compliance` - Grade 10 cores
- `GET /admin/reports/roster` - Student list
- `GET /admin/dashboard` - Metrics overview

#### Step 4.4: Grade Progression Service

**Service:** `apps/api/src/services/grade.services.ts`
- `progressGrades(sessionType)` - Called after session closes
- `manualGradeAdjustment(studentId, newGrade, reason, adminId)`
- `getGraduatedStudents()`

**Progression rules:**
```typescript
function getNewGrade(currentGrade: number, sessionType: string): number | null {
  // Grade 10 → 11 after November session
  if (currentGrade === 10 && sessionType === 'november') return 11;
  
  // Grade 11 → 12 after June session
  if (currentGrade === 11 && sessionType === 'june') return 12;
  
  // Grade 12 → Graduated after November session
  if (currentGrade === 12 && sessionType === 'november') return null; // null = graduated
  
  return currentGrade; // No change
}
```

#### Step 4.5: Web Pages

**Admin pages:**
- `apps/web/app/admin/notifications/page.tsx` - Bulk announcement composer
- `apps/web/app/admin/reports/page.tsx` - Report generator UI
- `apps/web/app/admin/audit/page.tsx` - Audit log viewer
- `apps/web/app/admin/dashboard/page.tsx` - Metrics dashboard

**User pages:**
- `apps/web/app/notifications/page.tsx` - Notification center

### Phase 4 Deliverables Checklist
- [ ] Notification table and service
- [ ] Email integration (Resend/SendGrid/SES)
- [ ] Notification triggers in all transactional services
- [ ] Parent CC on child notifications
- [ ] Audit log table and service
- [ ] Audit logging in all CRUD operations
- [ ] Report generation service
- [ ] Export functionality (CSV, PDF, Excel)
- [ ] Grade progression scheduler
- [ ] Manual grade adjustment API
- [ ] Graduated student access restrictions
- [ ] Admin dashboard with metrics
- [ ] Report generation UI
- [ ] Notification center UI
- [ ] Audit log viewer (admin)

---

## 10. Cross-Cutting Concerns

### 10.1 Authorization Matrix

| Endpoint | Admin | Student | Parent |
|----------|-------|---------|--------|
| `POST /subjects` | ✅ | ❌ | ❌ |
| `GET /subjects` | ✅ | ✅ | ✅ |
| `POST /sessions` | ✅ | ❌ | ❌ |
| `GET /sessions/active` | ✅ | ✅ | ✅ |
| `POST /registrations/checkout` | ❌ | ✅ (own) | ✅ (child) |
| `POST /registrations/:id/drop` | ❌ | ✅ (own) | ✅ (child) |
| `GET /escrow` | ✅ (all) | ✅ (own) | ✅ (child) |
| `POST /escrow/transfer` | ❌ | ❌ | ✅ |
| `POST /admin/escrow/withdrawals/:id/fulfill` | ✅ | ❌ | ❌ |
| `GET /admin/reports/*` | ✅ | ❌ | ❌ |

### 10.2 Data Isolation Rules

1. **Students** can only access:
   - Own profile, registrations, escrow, notifications
   - Public subject/session data
   - Link requests involving them

2. **Parents** can only access:
   - Own profile, notifications
   - Linked children's registrations, escrow
   - Cannot see unlinked students' data

3. **Admins** can access:
   - All data (with audit logging)
   - System-level operations

### 10.3 Validation Checkpoints

**Before Registration:**
- [ ] Session is active
- [ ] Subject is active
- [ ] Student not already registered for subject in session
- [ ] If Grade 10 + June: all core subjects included
- [ ] External option available if selected

**Before Drop/Swap:**
- [ ] Session is active
- [ ] Registration belongs to student (or parent's child)
- [ ] Registration is confirmed (not pending)
- [ ] Not a core subject (if Grade 10 + June)

**Before Escrow Operations:**
- [ ] Sufficient balance for debits
- [ ] Transfer: both students linked to same parent
- [ ] Withdrawal: not exceeding balance

### 10.4 Session Window State Machine

```
    ┌─────────┐
    │  DRAFT  │
    └────┬────┘
         │ Admin starts / reaches startDate
         ▼
    ┌─────────┐
    │ ACTIVE  │◄─── Registrations/Swaps allowed
    └────┬────┘
         │ Admin closes / reaches endDate
         ▼
    ┌─────────┐
    │ CLOSED  │───► All registration features disabled
    └─────────┘
```

### 10.5 Financial Calculations

**Registration Total:**
```
total = Σ(registration.priceAtRegistration)
     - min(escrow.balance, total)  // Escrow applied
     = amountToPay
```

**Swap Price Difference:**
```
diff = newSubject.price - currentRegistration.priceAtRegistration

if diff > 0:
    // User pays difference
    paymentRequired = diff
else:
    // Credit to escrow
    escrowCredit = abs(diff)
```

**Type Switch Price Difference:**
```
diff = newTypePrice - currentTypePrice
// Same logic as swap
```

---

## 11. Implementation Patterns

### 11.1 Parent Acting on Behalf of Child

Every endpoint that a student can access for themselves must also work for parents acting on behalf of linked children.

**Pattern:**
```typescript
// In route handler
async function (c) {
  const user = c.get('user')!;
  const { studentId } = c.req.valid('json'); // Optional - for parent
  
  // Determine target student
  const targetStudentId = studentId || user.id;
  
  // Validate access
  if (targetStudentId !== user.id) {
    // User is acting on behalf of someone else
    if (user.role !== ROLES.PARENT) {
      return error(c, 'Forbidden', 403);
    }
    const isLinked = await isParentLinkedToStudent(user.id, targetStudentId);
    if (!isLinked) {
      return error(c, 'Not linked to this student', 403);
    }
  }
  
  // Proceed with targetStudentId
  const result = await service.doSomething(targetStudentId, user.id);
  return success(c, result);
}
```

### 11.2 Audit Logging Pattern

Wrap all state-changing operations:

```typescript
// services/audit.services.ts
export async function withAuditLog<T>(
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  getPrevious: () => Promise<T | null>,
  operation: () => Promise<T>,
  request?: { ip?: string; userAgent?: string }
): Promise<T> {
  const previous = await getPrevious();
  const result = await operation();
  
  await logAction(userId, action, entityType, entityId, previous, result, request);
  
  return result;
}
```

### 11.3 Price Snapshot Pattern

Always store the price at time of transaction:

```typescript
// When creating registration
const subject = await getSubjectById(subjectId);
await db.insert(registration).values({
  ...data,
  priceAtRegistration: registrationType === 'in_school' 
    ? subject.priceInSchool 
    : subject.priceExternal,
});
```

### 11.4 Escrow Transaction Pattern

All escrow changes must be atomic with related operations:

```typescript
// In swap service
await db.transaction(async (tx) => {
  // 1. Update registration status
  await tx.update(registration).set({ status: 'dropped' }).where(...);
  
  // 2. Credit escrow
  await tx.update(escrow).set({ 
    balance: sql`${escrow.balance} + ${amount}` 
  }).where(...);
  
  // 3. Log transaction
  await tx.insert(escrowTransaction).values({
    escrowId,
    type: 'credit',
    amount,
    reason: 'drop',
    relatedRegistrationId: registrationId,
    initiatedBy: userId,
  });
});
```

---

## 12. Testing Strategy

### 12.1 Unit Tests (per service)

Each service should have tests for:
- Happy path operations
- Validation failures
- Authorization checks
- Edge cases (empty lists, not found, etc.)

### 12.2 Integration Tests (per feature)

Key flows to test:
1. Student sign-up → link request → approval
2. Session create → activate → auto-close
3. Full registration → payment → confirmation
4. Drop subject → escrow credit → use in next registration
5. Swap subject → price diff calculation
6. Parent escrow transfer between children
7. Withdrawal request → admin fulfillment

### 12.3 E2E Tests (critical paths)

1. **Complete registration flow** (student perspective)
2. **Parent manages child's registration** (parent perspective)
3. **Admin creates session and manages subjects** (admin perspective)
4. **Session auto-close with grade progression** (system perspective)

---

## 13. Risk Assessment

### 13.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Payment gateway integration delays | High | Start with bank transfer only, add others incrementally |
| Email deliverability issues | Medium | Use established provider (Resend/SendGrid), implement retry |
| Session auto-close failure | High | Multiple fallback mechanisms, admin manual override |
| Escrow balance inconsistency | Critical | Use database transactions, regular reconciliation |

### 13.2 Business Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| User doesn't complete payment | Medium | Expire pending registrations after 24h |
| Parent-student link abuse | Low | Student must approve; admin can revoke |
| Core subject bypass | High | Server-side validation (never trust client) |
| Simultaneous modifications | Medium | Optimistic locking on critical resources |

### 13.3 Data Integrity Rules

1. **Registration prices** - Snapshot at creation, never update
2. **Escrow balance** - Must equal sum of transactions
3. **Session status** - Only forward transitions allowed
4. **Core subjects** - Grade 10 June registrations must include all
5. **Linked children** - Only approved links count

---

## Appendix A: API Route Summary

```
Authentication:
  POST /api/auth/sign-up/student
  POST /api/auth/sign-up/parent
  POST /api/auth/*  (existing better-auth routes)

Users:
  GET  /v1/users/me
  PUT  /v1/users/me

Links:
  POST /v1/links
  GET  /v1/links/pending
  PUT  /v1/links/:id
  GET  /v1/links/children
  GET  /v1/links/parents

Subjects:
  GET  /v1/subjects
  GET  /v1/subjects/:id
  POST /v1/subjects (admin)
  PUT  /v1/subjects/:id (admin)
  DELETE /v1/subjects/:id (admin)
  PUT  /v1/subjects/:id/core (admin)

Sessions:
  GET  /v1/sessions (admin)
  GET  /v1/sessions/active
  POST /v1/sessions (admin)
  PUT  /v1/sessions/:id (admin)
  POST /v1/sessions/:id/close (admin)

Registrations:
  GET  /v1/registrations
  POST /v1/registrations/checkout
  GET  /v1/registrations/history
  POST /v1/registrations/:id/drop
  POST /v1/registrations/:id/swap
  POST /v1/registrations/:id/switch-type

Payments:
  POST /v1/payments/initiate
  GET  /v1/payments
  GET  /v1/payments/:id
  POST /v1/payments/:id/confirm (admin)
  POST /v1/payments/webhook/fawry
  POST /v1/payments/webhook/paymob

Escrow:
  GET  /v1/escrow
  GET  /v1/escrow/children
  GET  /v1/escrow/transactions
  POST /v1/escrow/transfer
  POST /v1/escrow/withdraw
  GET  /v1/escrow/withdrawals

Admin:
  GET  /v1/admin/escrow/withdrawals
  POST /v1/admin/escrow/withdrawals/:id/fulfill
  GET  /v1/admin/reports/registrations
  GET  /v1/admin/reports/financial
  GET  /v1/admin/reports/escrow
  GET  /v1/admin/reports/enrollment
  GET  /v1/admin/reports/compliance
  GET  /v1/admin/reports/roster
  GET  /v1/admin/dashboard
  GET  /v1/admin/audit
  POST /v1/admin/notifications/bulk
  PUT  /v1/admin/users/:id/grade

Notifications:
  GET  /v1/notifications
  PUT  /v1/notifications/:id/read
  PUT  /v1/notifications/read-all
```

---

## Appendix B: Database Tables Summary

```
Core Tables:
  - user (extend existing)
  - parent_student_link (new)
  
Domain Tables:
  - subject (new)
  - registration_session (new)
  
Transaction Tables:
  - registration (new)
  - payment (new)
  - payment_registration (new)
  - escrow (new)
  - escrow_transaction (new)
  - withdrawal_request (new)
  
Support Tables:
  - notification (new)
  - audit_log (new)
```

---

## Appendix C: Validation Schema Files

```
packages/validations/src/
├── index.ts (update exports)
├── roles.ts (update roles)
├── auth/
│   └── auth.validations.ts
├── user/
│   └── user.validations.ts
├── link/
│   └── link.validations.ts
├── subject/
│   └── subject.validations.ts
├── session/
│   └── session.validations.ts
├── registration/
│   └── registration.validations.ts
├── payment/
│   └── payment.validations.ts
├── escrow/
│   └── escrow.validations.ts
├── swap/
│   └── swap.validations.ts
├── notification/
│   └── notification.validations.ts
└── report/
    └── report.validations.ts
```

---

## Appendix D: Service Files

```
apps/api/src/services/
├── user.services.ts
├── link.services.ts
├── subject.services.ts
├── session.services.ts
├── registration.services.ts
├── payment.services.ts
├── escrow.services.ts
├── swap.services.ts
├── notification.services.ts
├── audit.services.ts
├── report.services.ts
└── grade.services.ts
```

---

## Appendix E: Web Pages Structure

```
apps/web/app/
├── page.tsx (dashboard - role-based)
├── sign-up/
│   ├── student/page.tsx
│   └── parent/page.tsx
├── profile/page.tsx
├── links/page.tsx
├── subjects/page.tsx
├── register/page.tsx
├── registrations/
│   ├── page.tsx
│   └── history/page.tsx
├── escrow/
│   ├── page.tsx
│   └── withdraw/page.tsx
├── notifications/page.tsx
└── admin/
    ├── dashboard/page.tsx
    ├── subjects/page.tsx
    ├── sessions/page.tsx
    ├── payments/page.tsx
    ├── escrow/page.tsx
    ├── reports/page.tsx
    ├── audit/page.tsx
    └── notifications/page.tsx
```

---

**End of Development Plan**

*This document should be referenced throughout development. Update as features are completed.*
