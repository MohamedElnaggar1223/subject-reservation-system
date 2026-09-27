/**
 * Database Schema
 *
 * This file defines all database tables using Drizzle ORM.
 *
 * BETTER-AUTH TABLES (Required - Do Not Modify):
 * - user, session, account, verification
 *
 * CUSTOM TABLES:
 * - Add your application tables below the Better-auth tables
 *
 * Key Patterns:
 * 1. Use pgTable for table definitions
 * 2. Add indexes on foreign keys for query performance
 * 3. Use relations() for type-safe joins
 * 4. Use $onUpdate for automatic timestamp updates
 * 5. Use onDelete: "cascade" for automatic cleanup
 */

import { relations, sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, index, numeric, integer, jsonb, uniqueIndex, check } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  // IGCSE System Extensions
  grade: integer("grade"), // 10, 11, 12, or null (for parents/admins/graduated)
  studentId: text("student_id").unique(), // Auto-generated unique ID for students
  phone: text("phone"), // Optional contact number
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

/**
 * ============================================
 * CUSTOM APPLICATION TABLES
 * ============================================
 *
 * Add your application-specific tables below.
 * Follow the patterns used in Better-auth tables.
 */

/**
 * FILE TABLE
 *
 * Stores metadata for uploaded files with support for variants.
 * Tracks ownership, type, and storage location.
 *
 * Pattern: a user-owned table
 * - Cascade delete removes files when user is deleted
 * - Indexes on userId and fileType for efficient queries
 * - Auto-updating timestamp on modifications
 */
export const file = pgTable(
  "file",
  {
    id: text("id").primaryKey(),

    // File metadata
    name: text("name").notNull(),              // Original filename
    mimeType: text("mime_type").notNull(),     // Detected MIME type
    size: numeric("size").notNull(),           // File size in bytes

    // Storage information (PRIVATE bucket - use signed URLs)
    storageKey: text("storage_key").notNull(), // R2 object key for generating signed URLs

    // Classification
    fileType: text("file_type").notNull(),     // 'avatar' | 'document' | 'general'

    // Ownership
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("file_userId_idx").on(table.userId),
    // Index on fileType for filtering by type
    index("file_fileType_idx").on(table.fileType),
  ],
);

/**
 * FILE VARIANT TABLE
 *
 * Stores different sizes/versions of image files.
 * Original image + thumbnails (thumbnail, medium, large).
 *
 * Pattern: Child table with cascade delete
 * - When parent file is deleted, all variants are auto-deleted
 * - Index on fileId for efficient variant lookups
 */
export const fileVariant = pgTable(
  "file_variant",
  {
    id: text("id").primaryKey(),

    // Parent file
    fileId: text("file_id")
      .notNull()
      .references(() => file.id, { onDelete: "cascade" }),

    // Variant information (PRIVATE bucket - use signed URLs)
    variant: text("variant").notNull(),        // 'original' | 'thumbnail' | 'medium' | 'large'
    storageKey: text("storage_key").notNull(), // R2 object key for generating signed URLs

    // Dimensions (for images)
    width: numeric("width").notNull(),
    height: numeric("height").notNull(),
    size: numeric("size").notNull(),           // Variant size in bytes

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Index on fileId for efficient variant lookups
    index("fileVariant_fileId_idx").on(table.fileId),
  ],
);

/**
 * FILE RELATIONS
 */
export const fileRelations = relations(file, ({ one, many }) => ({
  user: one(user, {
    fields: [file.userId],
    references: [user.id],
  }),
  variants: many(fileVariant),
}));

export const fileVariantRelations = relations(fileVariant, ({ one }) => ({
  file: one(file, {
    fields: [fileVariant.fileId],
    references: [file.id],
  }),
}));

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  files: many(file),
  linkRequestsAsParent: many(parentStudentLink, { relationName: "parentLinks" }),
  linkRequestsAsStudent: many(parentStudentLink, { relationName: "studentLinks" }),
  registrationsAsStudent: many(registration, { relationName: "studentRegistrations" }),
  registrationsRequested: many(registration, { relationName: "requestedRegistrations" }),
  registrationsApproved: many(registration, { relationName: "approvedRegistrations" }),
  paymentsAsStudent: many(payment, { relationName: "studentPayments" }),
  paymentsAsParent: many(payment, { relationName: "parentPayments" }),
  paymentsConfirmed: many(payment, { relationName: "confirmedPayments" }),
  paymentsReversed: many(payment, { relationName: "reversedPayments" }),
  changeRequestsRequested: many(changeRequest, { relationName: "requestedChangeRequests" }),
  changeRequestsApproved: many(changeRequest, { relationName: "approvedChangeRequests" }),
  notifications: many(notification),
  auditLogs: many(auditLog),
}));

/**
 * ============================================
 * PARENT-STUDENT LINK TABLE
 * ============================================
 *
 * Manages the relationship between parents and students.
 * Parents can request to link to students, who must approve.
 * 
 * Status workflow: pending -> approved/rejected
 */
export const parentStudentLink = pgTable(
  "parent_student_link",
  {
    id: text("id").primaryKey(),
    // Parent user who initiated the link request
    parentId: text("parent_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Student user being linked to
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Link status: 'pending' | 'approved' | 'rejected'
    status: text("status").notNull().default("pending"),
    // When the link was requested
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Indexes for efficient queries
    index("parentStudentLink_parentId_idx").on(table.parentId),
    index("parentStudentLink_studentId_idx").on(table.studentId),
    index("parentStudentLink_status_idx").on(table.status),
    // Task 1.1: Prevent duplicate parent-student links at DB level
    uniqueIndex("parentStudentLink_unique_pair_idx")
      .on(table.parentId, table.studentId)
      .where(sql`status IN ('pending', 'approved')`),
  ]
);

/**
 * ============================================
 * SUBJECT TABLE
 * ============================================
 *
 * Stores all IGCSE subjects available for registration.
 *
 * Key fields:
 * - council: The examination body (Pearson Edexcel, Cambridge, Oxford)
 * - priceInSchool: Standard price for students taught at school
 * - isOfferedAtSchool: Whether the school actively teaches this subject
 * - customPrice: Finance-set price for subjects not offered at school (nullable)
 * - isCore: If true, Grade 10 students must register this in the June session
 * - isActive: Soft-delete flag; inactive subjects are hidden from registration
 */
export const subject = pgTable(
  "subject",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    council: text("council").notNull(), // 'pearson_edexcel' | 'cambridge' | 'oxford'
    // V3 fee split (§6.2): teaching fee + board entry fee. The old single
    // priceInSchool is retained read-only for pre-V3 rows; new pricing
    // always derives from courseFee + registrationFee.
    courseFee: numeric("course_fee", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    registrationFee: numeric("registration_fee", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    // 'igcse' | 'as_level' | 'a_level' — IGCSE Biology and AS Biology are
    // separate rows with their own codes and fees (V3_PLAN §5.5).
    qualificationLevel: text("qualification_level").notNull().default("igcse"),
    // Legacy single price — superseded by the fee split above.
    priceInSchool: numeric("price_in_school", { precision: 12, scale: 2, mode: "number" }).notNull(),
    isOfferedAtSchool: boolean("is_offered_at_school").notNull().default(true),
    // Deprecated (V3 §6.9): replaced by the automatic 50% outside-school rule.
    customPrice: numeric("custom_price", { precision: 12, scale: 2, mode: "number" }),
    isActive: boolean("is_active").notNull().default(true),
    isCore: boolean("is_core").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("subject_code_idx").on(table.code),
    index("subject_council_idx").on(table.council),
    index("subject_isActive_idx").on(table.isActive),
    index("subject_isCore_idx").on(table.isCore),
    index("subject_qualificationLevel_idx").on(table.qualificationLevel),
    check("subject_course_fee_nonneg", sql`${table.courseFee} >= 0`),
    check("subject_registration_fee_nonneg", sql`${table.registrationFee} >= 0`),
    // L-8: Defense-in-depth — block negative prices at the DB layer.
    // Zod already enforces .positive() on input, but raw SQL or a future
    // code path bypassing Zod would still be caught here.
    check("subject_price_in_school_nonneg", sql`${table.priceInSchool} >= 0`),
    check(
      "subject_custom_price_nonneg",
      sql`${table.customPrice} IS NULL OR ${table.customPrice} >= 0`,
    ),
  ]
);

/**
 * ============================================
 * REGISTRATION SESSION TABLE
 * ============================================
 *
 * Represents an exam registration window (e.g., "June 2026").
 *
 * Lifecycle: draft → active → closed
 * - draft:  Admin has scheduled the window; students cannot register yet.
 * - active: Registration is open. Auto-opens when startDate arrives.
 * - closed: Registration ended (endDate passed or admin closed early).
 *
 * Key constraint: only ONE active session per sessionType at a time.
 * The partial unique index below enforces this at the DB level.
 *
 * editHistory stores an audit trail of any field changes made while the
 * session was in the 'active' state (endDate extensions, etc.).
 */
type SessionEditEntry = {
  editedBy: string;
  editedAt: string;
  field: string;
  oldValue: string;
  newValue: string;
  reason?: string;
};

export const registrationSession = pgTable(
  "registration_session",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sessionType: text("session_type").notNull(), // 'june' | 'november' | 'january'
    // 'igcse' | 'as_level' | 'a_level'. January series are A-Level-only in
    // Egypt (no January IGCSE exists — V3_PLAN §2.1); enforced in the service.
    qualificationLevel: text("qualification_level").notNull().default("igcse"),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("draft"), // 'draft' | 'active' | 'closed'
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
    closeReason: text("close_reason"),
    // Task 1.5: Persistent flag for 24h closing reminder (replaces volatile in-memory Set)
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    // GRADE-001 durability (M-10): null until the session-closer has
    // successfully run progressGrades for this session. The scheduler
    // retries any closed session with this still-null on each tick, so
    // a transient failure during progression doesn't leave students
    // stuck on the wrong grade indefinitely.
    gradeProgressionCompletedAt: timestamp("grade_progression_completed_at", { withTimezone: true }),
    editHistory: jsonb("edit_history")
      .$type<SessionEditEntry[]>()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("reg_session_status_idx").on(table.status),
    index("reg_session_type_idx").on(table.sessionType),
    // Enforces: only one active window per (sessionType, qualificationLevel).
    // An IGCSE June window and an A-Level June window may be open together.
    uniqueIndex("one_active_per_session_type_idx")
      .on(table.sessionType, table.qualificationLevel)
      .where(sql`status = 'active'`),
  ]
);

/**
 * PARENT-STUDENT LINK RELATIONS
 */
export const parentStudentLinkRelations = relations(parentStudentLink, ({ one }) => ({
  parent: one(user, {
    fields: [parentStudentLink.parentId],
    references: [user.id],
    relationName: "parentLinks",
  }),
  student: one(user, {
    fields: [parentStudentLink.studentId],
    references: [user.id],
    relationName: "studentLinks",
  }),
}));

/**
 * ============================================
 * TEACHER TABLE (V3 §6.7)
 * ============================================
 *
 * Teachers are data-only profiles — no login, no portal. They exist so
 * subjects can be linked to teachers and students can pick a preferred
 * teacher (optionally) when registering.
 */
export const teacher = pgTable(
  "teacher",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("teacher_isActive_idx").on(table.isActive)]
);

/**
 * Subject ↔ Teacher many-to-many link.
 */
export const subjectTeacher = pgTable(
  "subject_teacher",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subject.id, { onDelete: "cascade" }),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => teacher.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("subjectTeacher_subjectId_idx").on(table.subjectId),
    index("subjectTeacher_teacherId_idx").on(table.teacherId),
    uniqueIndex("subjectTeacher_unique_idx").on(table.subjectId, table.teacherId),
  ]
);

/**
 * ============================================
 * SCHOOL FEE SCHEDULE TABLE (V3 §6.2, D-A/D-H)
 * ============================================
 *
 * Annual school-year access fee. grade=null means the amount applies
 * uniformly to all grades; per-grade rows override for their grade.
 * Paying the school fee gates subject registration for sessions inside
 * that academic year (waivable via a fee_waiver exception). If no
 * schedule exists for a year, the gate is simply off.
 */
export const schoolFeeSchedule = pgTable(
  "school_fee_schedule",
  {
    id: text("id").primaryKey(),
    // e.g. '2026-2027'
    academicYear: text("academic_year").notNull(),
    // null = uniform for all grades; 10/11/12 = per-grade amount
    grade: integer("grade"),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("schoolFee_academicYear_idx").on(table.academicYear),
    uniqueIndex("schoolFee_year_grade_idx")
      .on(table.academicYear, table.grade)
      .where(sql`grade IS NOT NULL`),
    uniqueIndex("schoolFee_year_uniform_idx")
      .on(table.academicYear)
      .where(sql`grade IS NULL`),
    check("schoolFee_amount_nonneg", sql`${table.amount} >= 0`),
  ]
);

/**
 * ============================================
 * GRADE PROGRESSION RUN TABLE (V3 §5.5)
 * ============================================
 *
 * Series-level guard for GRADE-001. With qualification levels, two
 * sessions of the same series (e.g. IGCSE November + A-Level November)
 * can close in the same year; progression must fire exactly once per
 * (sessionType, academicYearLabel). The unique index makes the second
 * trigger a no-op; a failed run leaves no row so the scheduler retries.
 */
export const gradeProgressionRun = pgTable(
  "grade_progression_run",
  {
    id: text("id").primaryKey(),
    sessionType: text("session_type").notNull(),
    // Calendar year the series belongs to, e.g. '2026'
    seriesYear: text("series_year").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("gradeProgressionRun_unique_idx").on(table.sessionType, table.seriesYear),
  ]
);

/**
 * ============================================
 * REGISTRATION TABLE
 * ============================================
 *
 * Records each subject a student registers for in a session.
 *
 * Status workflow:
 * - pending_approval: Student-initiated; awaiting parent approval.
 * - pending_payment:  Parent-approved (or parent/admin-initiated); awaiting payment.
 * - confirmed:        Payment received and registration is complete.
 * - rejected:         Parent rejected the student's request (terminal state).
 * - dropped:          Previously confirmed registration later dropped via change request.
 *
 * priceAtRegistration is a snapshot of the subject price at the time of registration.
 * Changes to subject pricing do NOT affect existing registrations.
 *
 * The partial unique index prevents a student from having more than one
 * active (non-dropped, non-rejected) registration for the same subject
 * in the same session.
 */
export const registration = pgTable(
  "registration",
  {
    id: text("id").primaryKey(),
    // The student being registered
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    // The session this registration belongs to
    sessionId: text("session_id")
      .notNull()
      .references(() => registrationSession.id, { onDelete: "restrict" }),
    // The subject being registered for
    subjectId: text("subject_id")
      .notNull()
      .references(() => subject.id, { onDelete: "restrict" }),
    // Price snapshot — frozen at time of registration. Remains the
    // authoritative TOTAL (courseFee + registrationFee after any 50%
    // rule) — payments, escrow credits, and reports read this.
    priceAtRegistration: numeric("price_at_registration", { precision: 12, scale: 2, mode: "number" }).notNull(),
    // V3 fee-split breakdown of priceAtRegistration (§6.2). Backfilled
    // as courseFee=total, registrationFee=0 for pre-V3 rows.
    courseFeeAtRegistration: numeric("course_fee_at_registration", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    registrationFeeAtRegistration: numeric("registration_fee_at_registration", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    // V3 retake/outside-school pricing inputs (§6.9): a retake is a prior
    // registration for the same subject in an earlier session (or staff-set);
    // takenOutsideSchool triggers the 50% combined-fee rule and is only
    // valid for retakes or subjects not offered at school.
    isRetake: boolean("is_retake").notNull().default(false),
    takenOutsideSchool: boolean("taken_outside_school").notNull().default(false),
    // Student's preferred teacher (optional — V3 §6.7). Data-only profile.
    teacherId: text("teacher_id").references(() => teacher.id, { onDelete: "set null" }),
    // Core-subject snapshot — frozen at time of registration (URD CORE-002).
    // Enables the drop/swap core-lock rule to remain stable for existing
    // registrations even if an admin later clears subject.isCore for future
    // cohorts. Defaults to false; populated from subject.isCore at insert.
    wasCoreAtRegistration: boolean("was_core_at_registration").notNull().default(false),
    // Lifecycle status
    status: text("status").notNull().default("pending_approval"),
    // Who initiated this registration (student or parent)
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    // Parent who approved (null for parent-initiated or admin-override until explicitly set)
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // Parent's comments on approval or rejection
    approvalComments: text("approval_comments"),
    // Set when a confirmed registration is dropped
    droppedAt: timestamp("dropped_at", { withTimezone: true }),
    // V3 §5.4 — minimal results dimension: the board grade the student
    // received for this sitting (entered by staff after results day).
    // Remarks and retake detection read this; no analytics beyond that.
    gradeReceived: text("grade_received"),
    resultRecordedAt: timestamp("result_recorded_at", { withTimezone: true }),
    resultRecordedBy: text("result_recorded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("registration_studentId_idx").on(table.studentId),
    index("registration_sessionId_idx").on(table.sessionId),
    index("registration_subjectId_idx").on(table.subjectId),
    index("registration_status_idx").on(table.status),
    index("registration_requestedBy_idx").on(table.requestedBy),
    // One active registration per student per subject per session
    uniqueIndex("registration_unique_active_idx")
      .on(table.studentId, table.sessionId, table.subjectId)
      .where(sql`status NOT IN ('dropped', 'rejected', 'expired')`),
    // L-8: Price snapshot must never be negative.
    check(
      "registration_price_at_registration_nonneg",
      sql`${table.priceAtRegistration} >= 0`,
    ),
  ]
);

/**
 * REGISTRATION RELATIONS
 * (complete definition including payment link — see registrationWithPaymentRelations below)
 */

/**
 * REGISTRATION SESSION RELATIONS
 * (reverse side — one session has many registrations)
 */
export const registrationSessionRelations = relations(registrationSession, ({ many }) => ({
  registrations: many(registration),
}));

/**
 * SUBJECT RELATIONS
 * (reverse side — one subject has many registrations)
 */
export const subjectRelations = relations(subject, ({ many }) => ({
  registrations: many(registration),
  subjectTeachers: many(subjectTeacher),
}));

/**
 * ============================================
 * PAYMENT TABLE
 * ============================================
 *
 * Records a payment transaction initiated by a parent.
 * A single payment can cover multiple subject registrations for ONE student.
 *
 * - amount: the amount charged to the payment method (after escrow applied)
 * - escrowAmountApplied: portion deducted from the student's escrow balance
 * - amount + escrowAmountApplied = total registration cost
 *
 * Parent-only payer: parentId is always the authenticated parent.
 * For bank transfers, confirmedBy is the admin who manually confirmed payment.
 * metadata stores provider-specific data (Fawry code, payment URL, bank ref).
 */
export const payment = pgTable(
  "payment",
  {
    id: text("id").primaryKey(),
    // The student whose registrations are being paid for
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    // The parent making the payment (parent-only financial control)
    parentId: text("parent_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    // Amount charged to the payment method
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    // Portion of the total covered by escrow (deducted from student's escrow)
    escrowAmountApplied: numeric("escrow_amount_applied", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    // Payment method selected by the parent.
    // V3 active methods: 'in_school' | 'instapay'.
    // Legacy values retained on historical rows: 'fawry' | 'card' | 'mobile_wallet' | 'bank_transfer'
    paymentMethod: text("payment_method").notNull(),
    // What the money is for — one pipeline for all money-in (V3_PLAN §5.2).
    // 'registration' | 'school_fee' | 'preregistration' | 'remark'
    purpose: text("purpose").notNull().default("registration"),
    // For school_fee payments: which academic year was paid (e.g. '2026-2027')
    academicYear: text("academic_year"),
    // Lifecycle status. 'pending_verification' = InstaPay reference submitted,
    // awaiting finance verification against the bank statement.
    status: text("status").notNull().default("pending"), // 'pending' | 'pending_verification' | 'completed' | 'failed' | 'refunded'
    // Provider reference (Fawry code, transaction ID, etc.)
    externalReference: text("external_reference"),
    // InstaPay transaction reference submitted by the parent. Opaque string
    // (no published format exists); unique so the same transfer can never be
    // claimed against two payments. Presence is NOT proof of payment.
    verificationReference: text("verification_reference"),
    // Optional screenshot upload backing the InstaPay reference. RESTRICT, not
    // SET NULL: it is evidence finance relies on, so the database refuses to
    // delete the file while it is attached (security audit RF-13).
    verificationFileId: text("verification_file_id").references(() => file.id, {
      onDelete: "restrict",
    }),
    // Instrument the parent actually used at the finance desk for in_school
    // payments: 'cash' | 'card' | 'instapay' | 'other'
    instrumentUsed: text("instrument_used"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    // Staff member (finance/admin) who confirmed a manual payment
    confirmedBy: text("confirmed_by").references(() => user.id, { onDelete: "set null" }),
    // When and by whom a completed payment was reversed (status 'refunded').
    // The day's takings count a reversal on this date, never by rewriting the
    // day the payment was confirmed (money audit MA-05).
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: text("reversed_by").references(() => user.id, { onDelete: "set null" }),
    // Provider-specific data (payment URL, Fawry expiry, bank details)
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("payment_studentId_idx").on(table.studentId),
    index("payment_parentId_idx").on(table.parentId),
    index("payment_status_idx").on(table.status),
    index("payment_method_idx").on(table.paymentMethod),
    index("payment_purpose_idx").on(table.purpose),
    index("payment_confirmedAt_idx").on(table.confirmedAt),
    index("payment_reversedAt_idx").on(table.reversedAt),
    uniqueIndex("payment_verification_reference_idx").on(table.verificationReference),
    // L-8: Payment amount may be 0 for fully-escrow-funded payments (C-8
    // auto-confirm path) but never negative. Same for the escrow portion.
    check("payment_amount_nonneg", sql`${table.amount} >= 0`),
    check(
      "payment_escrow_applied_nonneg",
      sql`${table.escrowAmountApplied} >= 0`,
    ),
  ]
);

/**
 * ============================================
 * PAYMENT-REGISTRATION LINK TABLE
 * ============================================
 *
 * Many-to-many join between payments and registrations.
 * A payment can cover multiple registrations.
 * A registration should only appear in one completed payment.
 */
export const paymentRegistration = pgTable(
  "payment_registration",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payment.id, { onDelete: "cascade" }),
    registrationId: text("registration_id")
      .notNull()
      .references(() => registration.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("paymentReg_paymentId_idx").on(table.paymentId),
    index("paymentReg_registrationId_idx").on(table.registrationId),
    uniqueIndex("paymentReg_unique_idx").on(table.paymentId, table.registrationId),
  ]
);

/**
 * ============================================
 * ESCROW TABLE
 * ============================================
 *
 * One escrow account per student.
 * Balance is maintained atomically via escrow_transaction records.
 * Parents have full control; students have read-only access.
 *
 * Escrow is credited when: a confirmed registration is dropped/swapped.
 * Escrow is debited when: used at checkout or withdrawn.
 */
export const escrow = pgTable(
  "escrow",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "restrict" }),
    balance: numeric("balance", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    // V3 §6.8: the held part of the wallet — money paid for
    // preregistrations in not-yet-open sessions. Not spendable,
    // transferable, or refundable; auto-captured when the session opens.
    heldBalance: numeric("held_balance", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("escrow_studentId_idx").on(table.studentId),
    check("escrow_held_balance_nonneg", sql`${table.heldBalance} >= 0`),
    // L-8: Core invariant — escrow balance never drops below zero. The
    // app layer already enforces this via `debitEscrow`'s
    // `WHERE balance >= amount`, but raw SQL or a future bypass would
    // otherwise be silently accepted.
    check("escrow_balance_nonneg", sql`${table.balance} >= 0`),
  ]
);

/**
 * ============================================
 * ESCROW TRANSACTION TABLE
 * ============================================
 *
 * Immutable ledger of all escrow movements.
 * Every debit and credit has a reason and optional links
 * to the originating registration or payment.
 */
export const escrowTransaction = pgTable(
  "escrow_transaction",
  {
    id: text("id").primaryKey(),
    escrowId: text("escrow_id")
      .notNull()
      .references(() => escrow.id, { onDelete: "restrict" }),
    type: text("type").notNull(), // 'credit' | 'debit'
    // V3 §6.8: which side of the wallet moved — 'free' (default) or 'held'
    balanceType: text("balance_type").notNull().default("free"),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    // Reason categories for reporting and audit
    reason: text("reason").notNull(), // 'drop' | 'swap_refund' | 'transfer_in' | 'transfer_out' | 'withdrawal' | 'payment' | 'payment_refund' | 'prereg_hold' | 'prereg_capture' | 'prereg_release'
    // Optional audit links
    relatedRegistrationId: text("related_registration_id").references(
      () => registration.id,
      { onDelete: "set null" }
    ),
    relatedPaymentId: text("related_payment_id").references(
      () => payment.id,
      { onDelete: "set null" }
    ),
    // Who triggered this transaction (parent, admin, or system)
    initiatedBy: text("initiated_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("escrowTx_escrowId_idx").on(table.escrowId),
    index("escrowTx_type_idx").on(table.type),
    index("escrowTx_reason_idx").on(table.reason),
    // L-8: Every ledger entry carries a positive magnitude; direction
    // lives in `type` ('credit' | 'debit').
    check("escrowTx_amount_positive", sql`${table.amount} > 0`),
  ]
);

/**
 * ============================================
 * WITHDRAWAL REQUEST TABLE
 * ============================================
 *
 * Parent requests a cash withdrawal from a student's escrow.
 * Admin processes the withdrawal offline and marks it fulfilled.
 * Partial fulfillment is supported (releasedAmount ≤ requestedAmount).
 */
export const withdrawalRequest = pgTable(
  "withdrawal_request",
  {
    id: text("id").primaryKey(),
    escrowId: text("escrow_id")
      .notNull()
      .references(() => escrow.id, { onDelete: "restrict" }),
    requestedAmount: numeric("requested_amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    releasedAmount: numeric("released_amount", { precision: 12, scale: 2, mode: "number" }),
    status: text("status").notNull().default("pending"), // 'pending' | 'partially_fulfilled' | 'fulfilled' | 'rejected'
    adminNotes: text("admin_notes"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
    // V3 maker-checker (D-C): the officer's cash disbursement is never
    // blocked on approval, but a finance admin must approve afterwards
    // for the record to reach full completion.
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("withdrawalReq_escrowId_idx").on(table.escrowId),
    index("withdrawalReq_status_idx").on(table.status),
    // L-8: A parent must request a positive amount, and cumulative
    // released funds must stay within [0, requestedAmount].
    check("withdrawal_requested_positive", sql`${table.requestedAmount} > 0`),
    check(
      "withdrawal_released_nonneg",
      sql`${table.releasedAmount} IS NULL OR ${table.releasedAmount} >= 0`,
    ),
    check(
      "withdrawal_released_le_requested",
      sql`${table.releasedAmount} IS NULL OR ${table.releasedAmount} <= ${table.requestedAmount}`,
    ),
  ]
);

/**
 * ============================================
 * WITHDRAWAL DISBURSEMENT TABLE
 * ============================================
 *
 * One row per hand-over of cash against a withdrawal request. A request can
 * be paid in parts, on different days, and then have its remainder rejected;
 * the request row keeps only the running total and the latest resolution, so
 * the day's takings read cash out from here (money audit MA-09).
 * The sum of a request's rows always equals its releasedAmount.
 */
export const withdrawalDisbursement = pgTable(
  "withdrawal_disbursement",
  {
    id: text("id").primaryKey(),
    withdrawalRequestId: text("withdrawal_request_id")
      .notNull()
      .references(() => withdrawalRequest.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    disbursedBy: text("disbursed_by").references(() => user.id, { onDelete: "set null" }),
    disbursedAt: timestamp("disbursed_at", { withTimezone: true }).defaultNow().notNull(),
    notes: text("notes"),
  },
  (table) => [
    index("withdrawalDisb_requestId_idx").on(table.withdrawalRequestId),
    index("withdrawalDisb_disbursedAt_idx").on(table.disbursedAt),
    check("withdrawal_disbursement_amount_positive", sql`${table.amount} > 0`),
  ]
);

/**
 * ============================================
 * RECEIPT TABLE (V3 §6.5, D-D/D-J)
 * ============================================
 *
 * One physical receipt per subject registration — the paper the parent
 * holds proving the registration. Created (pending_issue) when the
 * covering payment completes; a finance officer marks it issued when
 * physically handed over.
 *
 * The receipt gates drop completion: a drop of a registration whose
 * receipt is out (issued) parks at 'dropped_pending_receipt' with the
 * refund parked on the receipt row (refundAmountOnReturn); when finance
 * marks the receipt returned, the escrow credit fires and the
 * registration becomes 'dropped'. 'lost'/'void' (finance admin only)
 * unblock the same transitions — the sanctioned escape hatch.
 */
export const receipt = pgTable(
  "receipt",
  {
    id: text("id").primaryKey(),
    registrationId: text("registration_id")
      .notNull()
      .unique()
      .references(() => registration.id, { onDelete: "restrict" }),
    // Human-friendly number quoted at the desk, e.g. RCP-2026-AB12CD34
    receiptNumber: text("receipt_number").notNull().unique(),
    // 'pending_issue' | 'issued' | 'return_required' | 'returned' | 'lost' | 'void'
    status: text("status").notNull().default("pending_issue"),
    issuedBy: text("issued_by").references(() => user.id, { onDelete: "set null" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    returnedTo: text("returned_to").references(() => user.id, { onDelete: "set null" }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    // Refund parked by a pending drop, released when the receipt comes
    // back (or is marked lost/void). Percentage-scaled per refund windows.
    refundAmountOnReturn: numeric("refund_amount_on_return", { precision: 12, scale: 2, mode: "number" }),
    refundReason: text("refund_reason"), // 'drop' | 'swap_refund'
    refundInitiatedBy: text("refund_initiated_by").references(() => user.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("receipt_status_idx").on(table.status),
    index("receipt_number_idx").on(table.receiptNumber),
    check(
      "receipt_refund_nonneg",
      sql`${table.refundAmountOnReturn} IS NULL OR ${table.refundAmountOnReturn} >= 0`,
    ),
  ]
);

export const receiptRelations = relations(receipt, ({ one }) => ({
  registration: one(registration, {
    fields: [receipt.registrationId],
    references: [registration.id],
  }),
}));

/**
 * ============================================
 * REFUND WINDOW TABLE (V3 §6.12, D-L)
 * ============================================
 *
 * Time-scaled refunds: a drop inside a window refunds that window's
 * percentage; if ANY windows are configured for the applicable scope,
 * gaps are 0%; if none exist, refunds stay 100% (pre-V3 behavior).
 * Session-scoped windows win over academic-year-scoped ones.
 */
export const refundWindow = pgTable(
  "refund_window",
  {
    id: text("id").primaryKey(),
    // Exactly one scope: a specific session, or an academic year label
    sessionId: text("session_id").references(() => registrationSession.id, { onDelete: "cascade" }),
    academicYear: text("academic_year"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    percentage: numeric("percentage", { precision: 5, scale: 2, mode: "number" }).notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("refundWindow_sessionId_idx").on(table.sessionId),
    index("refundWindow_academicYear_idx").on(table.academicYear),
    check("refundWindow_pct_range", sql`${table.percentage} >= 0 AND ${table.percentage} <= 100`),
    check(
      "refundWindow_one_scope",
      sql`(${table.sessionId} IS NOT NULL AND ${table.academicYear} IS NULL) OR (${table.sessionId} IS NULL AND ${table.academicYear} IS NOT NULL)`,
    ),
  ]
);

/**
 * ============================================
 * EXCEPTION TABLE (V3 §6.3)
 * ============================================
 *
 * The sanctioned way around the system's own rules — per-student
 * overrides granted by finance admins (or admins), fully audited.
 *
 * Types and their `value` semantics:
 * - discount_percent:      value = percentage off (0–100)
 * - discount_fixed:        value = EGP off the total
 * - custom_price:          value = absolute EGP price
 * - fee_waiver:            value unused — school-fee gate bypass
 * - deadline_extension:    value unused — closed window treated open
 *                          for this student until validUntil
 * - late_registration:     alias semantics of deadline_extension
 * - custom_refund_percent: value = refund percentage (0–100) overriding
 *                          refund windows
 *
 * Scope: sessionId/subjectId null = applies to all.
 */
export const exception = pgTable(
  "exception",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => registrationSession.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subject.id, { onDelete: "cascade" }),
    value: numeric("value", { precision: 12, scale: 2, mode: "number" }),
    reason: text("reason").notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    status: text("status").notNull().default("active"), // 'active' | 'revoked'
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("exception_studentId_idx").on(table.studentId),
    index("exception_type_idx").on(table.type),
    index("exception_status_idx").on(table.status),
    check("exception_value_nonneg", sql`${table.value} IS NULL OR ${table.value} >= 0`),
  ]
);

export const exceptionRelations = relations(exception, ({ one }) => ({
  student: one(user, {
    fields: [exception.studentId],
    references: [user.id],
    relationName: "studentExceptions",
  }),
  session: one(registrationSession, {
    fields: [exception.sessionId],
    references: [registrationSession.id],
  }),
  subject: one(subject, {
    fields: [exception.subjectId],
    references: [subject.id],
  }),
}));

/**
 * ============================================
 * CHANGE REQUEST TABLE
 * ============================================
 *
 * Tracks student-initiated drop and swap requests that require
 * parent approval before taking effect.
 *
 * OI-006 resolved: this table was planned but not yet in schema.
 *
 * Workflow (student-initiated):
 * - Student submits request → pending_approval
 * - Parent approves → approved (financials processed, registration updated)
 * - Parent rejects → rejected (no financial impact)
 *
 * Direct operations (parent-initiated, SWAP-004):
 * - No change_request record is created; parent calls executeDirectDrop/Swap directly
 * - This table only records student requests that go through the approval queue
 *
 * Key invariants:
 * - Only students can create change requests (parents use direct drop/swap)
 * - Only 'confirmed' registrations can be dropped or swapped
 * - Core subjects (Grade 10 June session) cannot be dropped or swapped
 * - At most one 'pending_approval' change request per registration at a time
 *
 * For swap requests:
 * - priceDifference = newSubjectPrice - droppedSubjectPrice
 * - Negative priceDifference → student gets escrow credit of the difference
 * - Positive priceDifference → new registration created at 'pending_payment'
 *
 * priceAtRequest stores the new subject's price snapshot at time of request.
 * For drops, it stores the amount that will be credited back (original price).
 */
export const changeRequest = pgTable(
  "change_request",
  {
    id: text("id").primaryKey(),
    // The confirmed registration being requested to drop or swap
    registrationId: text("registration_id")
      .notNull()
      .references(() => registration.id, { onDelete: "restrict" }),
    // 'drop' | 'swap'
    type: text("type").notNull(),
    // Always a student — parents use direct drop/swap
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    // Student's explanation for the change
    reason: text("reason").notNull(),
    // Null for drops; the subject the student wants to swap into
    newSubjectId: text("new_subject_id").references(() => subject.id, {
      onDelete: "restrict",
    }),
    // Snapshot of the new subject's price at time of request (for swaps)
    // For drops: stores the priceAtRegistration to be credited back
    priceAtRequest: numeric("price_at_request", { precision: 12, scale: 2, mode: "number" }).notNull(),
    // newSubjectPrice - droppedSubjectPrice; negative = escrow credit
    priceDifference: numeric("price_difference", { precision: 12, scale: 2, mode: "number" }).notNull(),
    // 'pending_approval' | 'approved' | 'rejected'
    status: text("status").notNull().default("pending_approval"),
    // Parent who approved or rejected (null until processed)
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    // Optional comments from the parent
    comments: text("comments"),
    // When the parent processed this request
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("changeReq_registrationId_idx").on(table.registrationId),
    index("changeReq_requestedBy_idx").on(table.requestedBy),
    index("changeReq_status_idx").on(table.status),
    // Enforce at most one pending change request per registration
    uniqueIndex("changeReq_one_pending_per_registration_idx")
      .on(table.registrationId)
      .where(sql`status = 'pending_approval'`),
    // L-8: priceAtRequest is a snapshot of either the new subject's
    // price (swap) or the registered price being credited back (drop).
    // Neither use case allows negative values. priceDifference is
    // intentionally NOT constrained — it is new_price − dropped_price,
    // so negative values are valid (swap into a cheaper subject).
    check("change_request_price_at_request_nonneg", sql`${table.priceAtRequest} >= 0`),
  ]
);

/**
 * CHANGE REQUEST RELATIONS
 */
export const changeRequestRelations = relations(changeRequest, ({ one }) => ({
  registration: one(registration, {
    fields: [changeRequest.registrationId],
    references: [registration.id],
  }),
  requestedByUser: one(user, {
    fields: [changeRequest.requestedBy],
    references: [user.id],
    relationName: "requestedChangeRequests",
  }),
  newSubject: one(subject, {
    fields: [changeRequest.newSubjectId],
    references: [subject.id],
  }),
  approvedByUser: one(user, {
    fields: [changeRequest.approvedBy],
    references: [user.id],
    relationName: "approvedChangeRequests",
  }),
}));

/**
 * PAYMENT RELATIONS
 */
export const paymentRelations = relations(payment, ({ one, many }) => ({
  student: one(user, {
    fields: [payment.studentId],
    references: [user.id],
    relationName: "studentPayments",
  }),
  parent: one(user, {
    fields: [payment.parentId],
    references: [user.id],
    relationName: "parentPayments",
  }),
  confirmedByUser: one(user, {
    fields: [payment.confirmedBy],
    references: [user.id],
    relationName: "confirmedPayments",
  }),
  reversedByUser: one(user, {
    fields: [payment.reversedBy],
    references: [user.id],
    relationName: "reversedPayments",
  }),
  paymentRegistrations: many(paymentRegistration),
}));

export const paymentRegistrationRelations = relations(paymentRegistration, ({ one }) => ({
  payment: one(payment, {
    fields: [paymentRegistration.paymentId],
    references: [payment.id],
  }),
  registration: one(registration, {
    fields: [paymentRegistration.registrationId],
    references: [registration.id],
  }),
}));

/**
 * ESCROW RELATIONS
 */
export const escrowRelations = relations(escrow, ({ one, many }) => ({
  student: one(user, {
    fields: [escrow.studentId],
    references: [user.id],
  }),
  transactions: many(escrowTransaction),
  withdrawalRequests: many(withdrawalRequest),
}));

export const escrowTransactionRelations = relations(escrowTransaction, ({ one }) => ({
  escrow: one(escrow, {
    fields: [escrowTransaction.escrowId],
    references: [escrow.id],
  }),
  relatedRegistration: one(registration, {
    fields: [escrowTransaction.relatedRegistrationId],
    references: [registration.id],
  }),
  relatedPayment: one(payment, {
    fields: [escrowTransaction.relatedPaymentId],
    references: [payment.id],
  }),
  initiatedByUser: one(user, {
    fields: [escrowTransaction.initiatedBy],
    references: [user.id],
  }),
}));

export const withdrawalRequestRelations = relations(withdrawalRequest, ({ one, many }) => ({
  escrow: one(escrow, {
    fields: [withdrawalRequest.escrowId],
    references: [escrow.id],
  }),
  resolvedByUser: one(user, {
    fields: [withdrawalRequest.resolvedBy],
    references: [user.id],
  }),
  disbursements: many(withdrawalDisbursement),
}));

export const withdrawalDisbursementRelations = relations(withdrawalDisbursement, ({ one }) => ({
  withdrawalRequest: one(withdrawalRequest, {
    fields: [withdrawalDisbursement.withdrawalRequestId],
    references: [withdrawalRequest.id],
  }),
  disbursedByUser: one(user, {
    fields: [withdrawalDisbursement.disbursedBy],
    references: [user.id],
  }),
}));

// Add payment back-references to registration and user
export const registrationWithPaymentRelations = relations(registration, ({ one, many }) => ({
  student: one(user, {
    fields: [registration.studentId],
    references: [user.id],
    relationName: "studentRegistrations",
  }),
  session: one(registrationSession, {
    fields: [registration.sessionId],
    references: [registrationSession.id],
  }),
  subject: one(subject, {
    fields: [registration.subjectId],
    references: [subject.id],
  }),
  requestedByUser: one(user, {
    fields: [registration.requestedBy],
    references: [user.id],
    relationName: "requestedRegistrations",
  }),
  approvedByUser: one(user, {
    fields: [registration.approvedBy],
    references: [user.id],
    relationName: "approvedRegistrations",
  }),
  paymentRegistrations: many(paymentRegistration),
  changeRequests: many(changeRequest),
  teacher: one(teacher, {
    fields: [registration.teacherId],
    references: [teacher.id],
  }),
}));

/**
 * TEACHER RELATIONS
 */
export const teacherRelations = relations(teacher, ({ many }) => ({
  subjectTeachers: many(subjectTeacher),
  registrations: many(registration),
}));

export const subjectTeacherRelations = relations(subjectTeacher, ({ one }) => ({
  subject: one(subject, {
    fields: [subjectTeacher.subjectId],
    references: [subject.id],
  }),
  teacher: one(teacher, {
    fields: [subjectTeacher.teacherId],
    references: [teacher.id],
  }),
}));

/**
 * ============================================
 * REMARK TABLES (V3 §6.10)
 * ============================================
 *
 * Post-results services (Enquiries About Results). All three councils
 * operate at PAPER level, so a request is a header + line items.
 * Council rules enforced in the service:
 * - Cambridge: one request ever per (candidate, syllabus, series),
 *   uniform service type — the atomic one-shot rule.
 * - OxfordAQA: once per paper.
 * - Consent is first-class and blocking (missing consent = centre
 *   malpractice at OxfordAQA).
 * Fees are admin-configured per (council, service) since Cambridge and
 * OxfordAQA don't publish theirs.
 */
export const remarkRequest = pgTable(
  "remark_request",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    registrationId: text("registration_id")
      .notNull()
      .references(() => registration.id, { onDelete: "restrict" }),
    // 'clerical_check' | 'review_of_marking' | 'priority_review' | 'script_copy'
    serviceType: text("service_type").notNull(),
    // 'pending_approval' | 'pending_consent' | 'pending_payment' |
    // 'awaiting_submission' | 'submitted' | 'outcome_recorded' |
    // 'rejected' | 'cancelled'
    status: text("status").notNull().default("pending_approval"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // Blocking consent (grades can go DOWN): parent attests + optionally
    // uploads the signed form; the school retains the paper per board rules.
    // Signed consent form: evidence the board can ask for, so RESTRICT (RF-13).
    consentFileId: text("consent_file_id").references(() => file.id, { onDelete: "restrict" }),
    consentConfirmedBy: text("consent_confirmed_by").references(() => user.id, { onDelete: "set null" }),
    consentConfirmedAt: timestamp("consent_confirmed_at", { withTimezone: true }),
    boardReference: text("board_reference"),
    feeCharged: numeric("fee_charged", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    feeRefunded: boolean("fee_refunded").notNull().default(false),
    comments: text("comments"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("remark_studentId_idx").on(table.studentId),
    index("remark_registrationId_idx").on(table.registrationId),
    index("remark_status_idx").on(table.status),
    check("remark_fee_nonneg", sql`${table.feeCharged} >= 0`),
  ]
);

export const remarkRequestItem = pgTable(
  "remark_request_item",
  {
    id: text("id").primaryKey(),
    remarkRequestId: text("remark_request_id")
      .notNull()
      .references(() => remarkRequest.id, { onDelete: "cascade" }),
    paperCode: text("paper_code").notNull(),
    paperName: text("paper_name"),
    // 'pending' | 'mark_up' | 'mark_down' | 'unchanged'
    outcome: text("outcome").notNull().default("pending"),
    gradeAfter: text("grade_after"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("remarkItem_requestId_idx").on(table.remarkRequestId)]
);

/** Admin-configured remark fees (per paper) — boards don't all publish */
export const remarkFeeSchedule = pgTable(
  "remark_fee_schedule",
  {
    id: text("id").primaryKey(),
    council: text("council").notNull(),
    serviceType: text("service_type").notNull(),
    amountPerPaper: numeric("amount_per_paper", { precision: 12, scale: 2, mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("remarkFee_council_service_idx").on(table.council, table.serviceType),
    check("remarkFee_amount_nonneg", sql`${table.amountPerPaper} >= 0`),
  ]
);

/** Per-service deadlines per session series (priority ≈ 1 week, standard ≈ 5) */
export const remarkDeadline = pgTable(
  "remark_deadline",
  {
    id: text("id").primaryKey(),
    council: text("council").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => registrationSession.id, { onDelete: "cascade" }),
    serviceType: text("service_type").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("remarkDeadline_unique_idx").on(table.council, table.sessionId, table.serviceType),
  ]
);

export const remarkRequestRelations = relations(remarkRequest, ({ one, many }) => ({
  student: one(user, {
    fields: [remarkRequest.studentId],
    references: [user.id],
    relationName: "studentRemarks",
  }),
  registration: one(registration, {
    fields: [remarkRequest.registrationId],
    references: [registration.id],
  }),
  items: many(remarkRequestItem),
}));

export const remarkRequestItemRelations = relations(remarkRequestItem, ({ one }) => ({
  remarkRequest: one(remarkRequest, {
    fields: [remarkRequestItem.remarkRequestId],
    references: [remarkRequest.id],
  }),
}));

/**
 * ============================================
 * NOTIFICATION TABLE
 * ============================================
 *
 * In-app notifications for all users.
 * Each notification can optionally trigger an email (tracked by emailSentAt).
 *
 * Notification types cover all NOT-001 to NOT-011 user stories:
 * - SESSION_OPENED / SESSION_CLOSING_SOON
 * - REGISTRATION_REQUEST_RECEIVED (parent: child submitted)
 * - REGISTRATION_APPROVED / REGISTRATION_REJECTED (student: decision made)
 * - PAYMENT_CONFIRMED (parent: receipt after payment)
 * - DROP_SWAP_REQUEST_RECEIVED (parent: child requested change)
 * - DROP_SWAP_PROCESSED (student: change request resolved)
 * - ESCROW_BALANCE_CHANGED (parent: balance updated)
 * - ESCROW_WITHDRAWAL_FULFILLED (parent: withdrawal processed)
 * - GRADE_CHANGED (student/parent: grade progression or manual)
 * - BULK_ANNOUNCEMENT (admin broadcast to all/groups)
 *
 * data stores context-specific IDs and links for deep-linking.
 * readAt is null until the user views/dismisses the notification.
 * emailSentAt is null if email was not sent (e.g., user opted out or email disabled).
 */
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    // The user this notification belongs to
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Notification category (matches NOT-XXX user story types)
    type: text("type").notNull(),
    // Short title shown in notification center
    title: text("title").notNull(),
    // Full notification body text
    body: text("body").notNull(),
    // Context-specific data: related IDs, deep-link URLs, etc.
    data: jsonb("data").$type<Record<string, unknown>>(),
    // When the user read/dismissed this notification (null = unread)
    readAt: timestamp("read_at", { withTimezone: true }),
    // When the corresponding email was sent (null = email not sent)
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("notification_userId_idx").on(table.userId),
    index("notification_type_idx").on(table.type),
    // Optimises "unread notifications" queries (null readAt = unread)
    index("notification_readAt_idx").on(table.readAt),
  ]
);

/**
 * NOTIFICATION RELATIONS
 */
export const notificationRelations = relations(notification, ({ one }) => ({
  user: one(user, {
    fields: [notification.userId],
    references: [user.id],
  }),
}));

/**
 * ============================================
 * AUDIT LOG TABLE
 * ============================================
 *
 * Append-only record of every significant system action (REP-006).
 * Never updated or deleted — provides full chain of custody.
 *
 * Action types cover all critical operations:
 * - Subject CRUD (SUBJECT_CREATED, SUBJECT_UPDATED, SUBJECT_DEACTIVATED, SUBJECT_ACTIVATED, SUBJECT_CORE_UPDATED)
 * - Session lifecycle (SESSION_CREATED, SESSION_UPDATED, SESSION_ACTIVATED, SESSION_CLOSED)
 * - Registration flow (REGISTRATION_REQUESTED, REGISTRATION_DIRECT, REGISTRATION_APPROVED, REGISTRATION_REJECTED,
 *                      REGISTRATION_ADMIN_OVERRIDE, REGISTRATION_CONFIRMED)
 * - Payment lifecycle (PAYMENT_INITIATED, PAYMENT_CONFIRMED, PAYMENT_FAILED)
 * - Change requests (CHANGE_REQUEST_CREATED, CHANGE_REQUEST_APPROVED, CHANGE_REQUEST_REJECTED,
 *                    DIRECT_DROP_EXECUTED, DIRECT_SWAP_EXECUTED)
 * - Escrow (ESCROW_TRANSFER, WITHDRAWAL_REQUESTED, WITHDRAWAL_FULFILLED, WITHDRAWAL_REJECTED)
 * - User/grade management (USER_GRADE_CHANGED, USER_UPDATED)
 * - Admin (ADMIN_ANNOUNCEMENT)
 *
 * userId is nullable to allow system-initiated actions (scheduler jobs).
 * previousData / newData capture before/after state for diffs (jsonb, optional).
 * ipAddress / userAgent are populated from the HTTP request context where available.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    // Who performed the action (null for system-initiated actions)
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    // What was done (enum-style text)
    action: text("action").notNull(),
    // The type of entity affected
    entityType: text("entity_type").notNull(),
    // The ID of the affected entity
    entityId: text("entity_id").notNull(),
    // Snapshot of entity state before the action (nullable)
    previousData: jsonb("previous_data").$type<Record<string, unknown>>(),
    // Snapshot of entity state after the action (nullable)
    newData: jsonb("new_data").$type<Record<string, unknown>>(),
    // Originating request IP (populated from x-forwarded-for or cf-connecting-ip)
    ipAddress: text("ip_address"),
    // Browser / client user agent string
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_userId_idx").on(table.userId),
    index("audit_log_entityType_entityId_idx").on(table.entityType, table.entityId),
    index("audit_log_action_idx").on(table.action),
    // Optimises date-range queries in the audit log viewer
    index("audit_log_createdAt_idx").on(table.createdAt),
  ]
);

/**
 * AUDIT LOG RELATIONS
 */
export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(user, {
    fields: [auditLog.userId],
    references: [user.id],
  }),
}));

/**
 * ============================================
 * SCHEDULED ANNOUNCEMENT TABLE
 * ============================================
 *
 * Stores bulk announcements that are scheduled for future delivery.
 * The session-closer cron job checks this table on each tick and
 * dispatches any announcements whose scheduledAt has arrived.
 *
 * Status workflow: pending -> sent | failed
 * - pending: Scheduled but not yet dispatched
 * - sent: Successfully dispatched (in-app + optional email)
 * - failed: Dispatch attempt failed (will not retry automatically)
 */
export const scheduledAnnouncement = pgTable(
  "scheduled_announcement",
  {
    id: text("id").primaryKey(),
    // Announcement content (matches BulkAnnouncement schema)
    title: text("title").notNull(),
    body: text("body").notNull(),
    recipients: text("recipients").notNull(), // 'all' | 'students' | 'parents' | 'grade_10' | etc.
    sendEmail: boolean("send_email").notNull().default(true),
    // When to send
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    // Current status
    status: text("status").notNull().default("pending"), // 'pending' | 'sent' | 'failed' | 'cancelled'
    // Result tracking
    sentAt: timestamp("sent_at", { withTimezone: true }),
    notificationCount: integer("notification_count"),
    errorMessage: text("error_message"),
    // Who created the scheduled announcement
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("schedAnn_status_idx").on(table.status),
    index("schedAnn_scheduledAt_idx").on(table.scheduledAt),
  ]
);

/**
 * SCHEDULED ANNOUNCEMENT RELATIONS
 */
export const scheduledAnnouncementRelations = relations(scheduledAnnouncement, ({ one }) => ({
  createdByUser: one(user, {
    fields: [scheduledAnnouncement.createdBy],
    references: [user.id],
  }),
}));

