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
import { pgTable, text, timestamp, boolean, index, numeric, integer, jsonb, uniqueIndex, unique, check, date, primaryKey, foreignKey, type AnyPgColumn } from "drizzle-orm/pg-core";

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
  // (F0a dropped the stored `grade`: a grade is derived from cohortYear.)
  studentId: text("student_id").unique(), // Auto-generated unique ID for students
  phone: text("phone"), // Optional contact number
  // F0a: the academic year (its start year, 2026 = 2026/27) the student
  // starts grade 10 in. A grade is derived from it for any academic year
  // (10 + year − cohort); nothing moves it but an audited correction. Null
  // for staff and parents, and for a student whose grade was never recorded.
  cohortYear: integer("cohort_year"),
  // F0a: a student who left the school — withdrawn or transferred — on
  // leftOn, for leftReason. Refused from new registrations; everything they
  // did stays. Cleared when they are readmitted (both audited).
  leftOn: date("left_on", { mode: "string" }),
  leftKind: text("left_kind"), // 'withdrawn' | 'transferred'
  leftReason: text("left_reason"),
  leftRecordedBy: text("left_recorded_by").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  leftRecordedAt: timestamp("left_recorded_at", { withTimezone: true }),
}, (table) => [
  index("user_cohortYear_idx").on(table.cohortYear),
  check("user_left_kind_valid", sql`${table.leftKind} IS NULL OR ${table.leftKind} IN ('withdrawn', 'transferred')`),
  check("user_left_whole", sql`(${table.leftOn} IS NULL) = (${table.leftKind} IS NULL)`),
  check("user_cohort_year_range", sql`${table.cohortYear} IS NULL OR ${table.cohortYear} BETWEEN 2000 AND 2100`),
]);

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
    // F0a: what the file is for (UPLOAD_PURPOSES in @repo/validations), which
    // decides its limits and who may read it.
    purpose: text("purpose").notNull().default("document"),

    // Ownership
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // F0a: the student the file concerns, for purposes read by a family.
    studentId: text("student_id").references(() => user.id, { onDelete: "cascade" }),

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
    index("file_studentId_idx").on(table.studentId),
    index("file_purpose_idx").on(table.purpose),
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

export const userRelations = relations(user, ({ one, many }) => ({
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
  paymentsLateTransferRecorded: many(payment, { relationName: "lateTransferPayments" }),
  changeRequestsRequested: many(changeRequest, { relationName: "requestedChangeRequests" }),
  changeRequestsApproved: many(changeRequest, { relationName: "approvedChangeRequests" }),
  notifications: many(notification),
  auditLogs: many(auditLog),
  // F0a: the teacher record this account teaches as, if any.
  teachingAs: one(teacher, {
    fields: [user.id],
    references: [teacher.userId],
  }),
  sectionMemberships: many(sectionMembership),
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
 * F0b — THE EXAM CATALOGUE
 * ============================================
 *
 * Boards, the qualifications (awards) they issue, the units or components a
 * candidate sits, and which units count toward which awards (FEATURES_PLAN.md
 * F0b; DISCOVERY_RESEARCH.md §5 notes 2–4; IMPORT_SPIKE.md IS-01). A unit's
 * own level (AS, A2, IGCSE) is kept apart from the awards it counts toward
 * and from the student's year: the school's "A.S./A.2." is derived from the
 * three (@repo/validations level-code.ts), never stored.
 *
 * The registrable row families register for (`subject`) enters a whole
 * qualification or a set of units (`subject_unit`); its board is
 * `subject.council`, a board code here.
 */
export const examBoard = pgTable(
  "exam_board",
  {
    // 'pearson_edexcel' | 'cambridge' | 'oxford' — the subject table's council values.
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    entryPortal: text("entry_portal"),
    // The months the board sits series in ('january' | 'june' | 'october' | 'november').
    seriesMonths: jsonb("series_months").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
);

export const qualification = pgTable(
  "qualification",
  {
    id: text("id").primaryKey(),
    boardCode: text("board_code").notNull().references(() => examBoard.code, { onDelete: "restrict" }),
    // A Pearson cash-in code (XMA01, YMA01), a Cambridge syllabus (9700, 0610), an International GCSE (4BI1).
    code: text("code").notNull(),
    title: text("title").notNull(),
    // 'igcse' | 'as_level' | 'a_level'
    level: text("level").notNull(),
    // "International A Level", "International GCSE", "Cambridge IGCSE", "O Level"…
    suite: text("suite").notNull().default(""),
    // The subject it is in: AS and A Level of one subject share it (F5 counts them once).
    subjectArea: text("subject_area").notNull(),
    // 'qualification' | 'units_cash_in' | 'syllabus_option'
    entryMethod: text("entry_method").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // One award per board, code and level: Cambridge's syllabus 9700 leads to
    // an AS Level and to an A Level, two awards under one code.
    uniqueIndex("qualification_board_code_level_idx").on(table.boardCode, table.code, table.level),
    check("qualification_level_valid", sql`${table.level} IN ('igcse', 'as_level', 'a_level')`),
    check("qualification_entry_method_valid", sql`${table.entryMethod} IN ('qualification', 'units_cash_in', 'syllabus_option')`),
  ]
);

export const examUnit = pgTable(
  "exam_unit",
  {
    id: text("id").primaryKey(),
    boardCode: text("board_code").notNull().references(() => examBoard.code, { onDelete: "restrict" }),
    // A Pearson W unit (WMA11) or a Cambridge component (9700/12).
    code: text("code").notNull(),
    // What the school calls it: "P1", "M1", "Paper 3".
    shortCode: text("short_code"),
    title: text("title").notNull(),
    // The unit's own level (IS-01): 'igcse' | 'as' | 'a2'.
    unitLevel: text("unit_level").notNull(),
    // 'unit' | 'component'
    kind: text("kind").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("examUnit_board_code_idx").on(table.boardCode, table.code),
    check("exam_unit_level_valid", sql`${table.unitLevel} IN ('igcse', 'as', 'a2')`),
    check("exam_unit_kind_valid", sql`${table.kind} IN ('unit', 'component')`),
  ]
);

/** The unit-to-award map: which units count toward which awards. */
export const qualificationUnit = pgTable(
  "qualification_unit",
  {
    id: text("id").primaryKey(),
    qualificationId: text("qualification_id").notNull().references(() => qualification.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull().references(() => examUnit.id, { onDelete: "restrict" }),
    // 'required' | 'optional'
    requirement: text("requirement").notNull(),
    // Units one chooses from ("Applied: one of M1, S1, D1").
    choiceGroup: text("choice_group"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("qualificationUnit_unique_idx").on(table.qualificationId, table.unitId),
    index("qualificationUnit_unitId_idx").on(table.unitId),
    check("qualification_unit_requirement_valid", sql`${table.requirement} IN ('required', 'optional')`),
  ]
);

/** Cambridge option codes: the component sets a syllabus can be entered with. */
export const qualificationOption = pgTable(
  "qualification_option",
  {
    id: text("id").primaryKey(),
    qualificationId: text("qualification_id").notNull().references(() => qualification.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    // Marks from an earlier series count (carry forward, DISCOVERY.md Q-02).
    carryForward: boolean("carry_forward").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("qualificationOption_code_idx").on(table.qualificationId, table.code),
  ]
);

export const qualificationOptionUnit = pgTable(
  "qualification_option_unit",
  {
    optionId: text("option_id").notNull().references(() => qualificationOption.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull().references(() => examUnit.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.optionId, table.unitId] })]
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
    // The board the row is entered with (F0b: a board of the catalogue; staff
    // change it on the Catalogue screen — owner decision 3).
    council: text("council").notNull().references(() => examBoard.code, { onDelete: "restrict" }), // 'pearson_edexcel' | 'cambridge' | 'oxford'
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
    // F0b: the award this row enters, or counts toward when it is units
    // (subject_unit). Its board is `council`.
    qualificationId: text("qualification_id").references(() => qualification.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("subject_qualificationId_idx").on(table.qualificationId),
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
    sessionType: text("session_type").notNull(), // 'june' | 'october' | 'november' | 'january'
    // F0a: the year of the exam series (2027 for June 2027). The series
    // belongs to one academic year — June and January of Y to Y−1/Y, October
    // and November of Y to Y/Y+1 — which decides every student's grade in it.
    seriesYear: integer("series_year").notNull(),
    // 'igcse' | 'as_level' | 'a_level'. January series are A-Level-only in
    // Egypt (no January IGCSE exists — V3_PLAN §2.1); enforced in the service.
    qualificationLevel: text("qualification_level").notNull().default("igcse"),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    // F0b: the exam board's entry deadline (owner decision MO-10) moved to the
    // board series the window feeds (board_series.entry_deadline): one window
    // can feed several series with different deadlines (IS-14). Migration
    // 0038 carried each window's deadline to its series; 0039 dropped it here.
    status: text("status").notNull().default("draft"), // 'draft' | 'active' | 'closed'
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
    closeReason: text("close_reason"),
    // Task 1.5: Persistent flag for 24h closing reminder (replaces volatile in-memory Set)
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    // Set when the close's finalisation (expire what is left, reject pending
    // change requests, notify) has completed. The scheduler finalises any
    // closed session still missing it, so a close interrupted halfway is
    // finished on the next tick (state audit ST-06).
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
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
    // (F0b: the window closing before its deadline is now kept by the
    // triggers of migration 0038, against every board series it feeds.)
    check("session_series_year_range", sql`${table.seriesYear} BETWEEN 2000 AND 2100`),
    index("reg_session_series_idx").on(table.sessionType, table.seriesYear),
  ]
);

/**
 * ============================================
 * F0b — BOARD SERIES
 * ============================================
 *
 * One board's sitting (Pearson IAL October 2026, Cambridge November 2026)
 * with every date the board sets (DISCOVERY_RESEARCH.md §5 note 1). A
 * registration window feeds one or more series (IS-14); each registration is
 * entered in exactly one (`registration.board_series_id`).
 *
 * The entry deadline is the school's hard stop (owner decision MO-10): past
 * it nothing more is entered, paid or confirmed for the series, and the
 * scheduler closes what is still open on it. The late-fee dates are shown
 * for information only. The database keeps every window a series feeds
 * closing before its deadline, and every series of a window in the window's
 * academic year and, like the window, June or not (triggers, migration
 * 0038).
 */
export const boardSeries = pgTable(
  "board_series",
  {
    id: text("id").primaryKey(),
    boardCode: text("board_code").notNull().references(() => examBoard.code, { onDelete: "restrict" }),
    // 'january' | 'june' | 'october' | 'november' — the same names as a window's session type.
    month: text("month").notNull(),
    year: integer("year").notNull(),
    // Only when one board runs two calendars in one month ("IAL").
    label: text("label").notNull().default(""),
    entryDeadline: timestamp("entry_deadline", { withTimezone: true }),
    estimatedEntriesDue: date("estimated_entries_due", { mode: "string" }),
    lateFeeFrom: date("late_fee_from", { mode: "string" }),
    highLateFeeFrom: date("high_late_fee_from", { mode: "string" }),
    lateEntriesClose: date("late_entries_close", { mode: "string" }),
    retakeDeadline: date("retake_deadline", { mode: "string" }),
    forecastGradesDue: date("forecast_grades_due", { mode: "string" }),
    neaDue: date("nea_due", { mode: "string" }),
    accessArrangementsDue: date("access_arrangements_due", { mode: "string" }),
    examsStart: date("exams_start", { mode: "string" }),
    examsEnd: date("exams_end", { mode: "string" }),
    resultsOn: date("results_on", { mode: "string" }),
    certificatesOn: date("certificates_on", { mode: "string" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("boardSeries_unique_idx").on(table.boardCode, table.month, table.year, table.label),
    index("boardSeries_entryDeadline_idx").on(table.entryDeadline),
    check("board_series_month_valid", sql`${table.month} IN ('january', 'june', 'october', 'november')`),
    check("board_series_year_range", sql`${table.year} BETWEEN 2000 AND 2100`),
    check("board_series_exams_ordered", sql`${table.examsStart} IS NULL OR ${table.examsEnd} IS NULL OR ${table.examsEnd} >= ${table.examsStart}`),
  ]
);

/** The series a window feeds; per board, one is the default its subjects are entered in. */
export const sessionBoardSeries = pgTable(
  "session_board_series",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => registrationSession.id, { onDelete: "restrict" }),
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "restrict" }),
    // The series' board, kept here so the database holds one default per board per window.
    boardCode: text("board_code").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // A constraint, not an index: the composite keys below reference it.
    unique("sessionBoardSeries_pair_key").on(table.sessionId, table.boardSeriesId),
    uniqueIndex("sessionBoardSeries_one_default_idx").on(table.sessionId, table.boardCode).where(sql`is_default`),
    index("sessionBoardSeries_seriesId_idx").on(table.boardSeriesId),
  ]
);

/** A subject a window enters in another of its series of that board than the default. */
export const sessionSubjectSeries = pgTable(
  "session_subject_series",
  {
    sessionId: text("session_id").notNull(),
    subjectId: text("subject_id").notNull().references(() => subject.id, { onDelete: "cascade" }),
    boardSeriesId: text("board_series_id").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.subjectId] }),
    // Only to a series the window feeds; unlinking the series removes the route.
    foreignKey({
      name: "sessionSubjectSeries_link_fk",
      columns: [table.sessionId, table.boardSeriesId],
      foreignColumns: [sessionBoardSeries.sessionId, sessionBoardSeries.boardSeriesId],
    }).onDelete("cascade"),
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
    // F0a: the staff account that teaches as this teacher (teaching is a
    // capability: any staff role can hold it). One account per record.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("teacher_isActive_idx").on(table.isActive),
    uniqueIndex("teacher_userId_unique_idx").on(table.userId),
  ]
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

// The grade progression run table (V3 §5.5, GRADE-001) was dropped by F0a:
// grades are derived from each student's cohort and the series' academic
// year, so nothing progresses when a window closes (STATE_AUDIT.md ST-13).

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
    // F0b: the board series this entry goes to — one the window feeds (the
    // composite key below). Its entry deadline is this registration's hard
    // stop (MO-10). Null only in a window that feeds no series.
    boardSeriesId: text("board_series_id"),
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
    // F0b: entered only in a series its window feeds; a series with entries cannot leave the window.
    foreignKey({
      name: "registration_board_series_link_fk",
      columns: [table.sessionId, table.boardSeriesId],
      foreignColumns: [sessionBoardSeries.sessionId, sessionBoardSeries.boardSeriesId],
    }).onDelete("restrict"),
    index("registration_boardSeriesId_idx").on(table.boardSeriesId),
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
  // F0b: the board series the window feeds, and its subject routes.
  boardSeriesLinks: many(sessionBoardSeries),
  subjectRoutes: many(sessionSubjectSeries),
}));

/**
 * SUBJECT RELATIONS
 * (reverse side — one subject has many registrations)
 */
export const subjectRelations = relations(subject, ({ one, many }) => ({
  registrations: many(registration),
  subjectTeachers: many(subjectTeacher),
  // F0b: what the row enters with the board.
  qualification: one(qualification, { fields: [subject.qualificationId], references: [qualification.id] }),
  units: many(subjectUnit),
  board: one(examBoard, { fields: [subject.council], references: [examBoard.code] }),
}));

/**
 * F0b: the units a registrable row enters — a unit ("P1") or a paper set
 * ("Biology (Paper 1 & Paper 2)"). None: the row enters its whole qualification.
 */
export const subjectUnit = pgTable(
  "subject_unit",
  {
    subjectId: text("subject_id").notNull().references(() => subject.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull().references(() => examUnit.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.subjectId, table.unitId] }),
    index("subjectUnit_unitId_idx").on(table.unitId),
  ]
);

export const subjectUnitRelations = relations(subjectUnit, ({ one }) => ({
  subject: one(subject, { fields: [subjectUnit.subjectId], references: [subject.id] }),
  unit: one(examUnit, { fields: [subjectUnit.unitId], references: [examUnit.id] }),
}));

export const examBoardRelations = relations(examBoard, ({ many }) => ({
  qualifications: many(qualification),
  units: many(examUnit),
  series: many(boardSeries),
}));

export const qualificationRelations = relations(qualification, ({ one, many }) => ({
  board: one(examBoard, { fields: [qualification.boardCode], references: [examBoard.code] }),
  units: many(qualificationUnit),
  options: many(qualificationOption),
  subjects: many(subject),
}));

export const examUnitRelations = relations(examUnit, ({ one, many }) => ({
  board: one(examBoard, { fields: [examUnit.boardCode], references: [examBoard.code] }),
  awards: many(qualificationUnit),
  subjects: many(subjectUnit),
}));

export const qualificationUnitRelations = relations(qualificationUnit, ({ one }) => ({
  qualification: one(qualification, { fields: [qualificationUnit.qualificationId], references: [qualification.id] }),
  unit: one(examUnit, { fields: [qualificationUnit.unitId], references: [examUnit.id] }),
}));

export const qualificationOptionRelations = relations(qualificationOption, ({ one, many }) => ({
  qualification: one(qualification, { fields: [qualificationOption.qualificationId], references: [qualification.id] }),
  units: many(qualificationOptionUnit),
}));

export const qualificationOptionUnitRelations = relations(qualificationOptionUnit, ({ one }) => ({
  option: one(qualificationOption, { fields: [qualificationOptionUnit.optionId], references: [qualificationOption.id] }),
  unit: one(examUnit, { fields: [qualificationOptionUnit.unitId], references: [examUnit.id] }),
}));

export const boardSeriesRelations = relations(boardSeries, ({ one, many }) => ({
  board: one(examBoard, { fields: [boardSeries.boardCode], references: [examBoard.code] }),
  windowLinks: many(sessionBoardSeries),
  registrations: many(registration),
}));

export const sessionBoardSeriesRelations = relations(sessionBoardSeries, ({ one }) => ({
  session: one(registrationSession, { fields: [sessionBoardSeries.sessionId], references: [registrationSession.id] }),
  boardSeries: one(boardSeries, { fields: [sessionBoardSeries.boardSeriesId], references: [boardSeries.id] }),
}));

export const sessionSubjectSeriesRelations = relations(sessionSubjectSeries, ({ one }) => ({
  session: one(registrationSession, { fields: [sessionSubjectSeries.sessionId], references: [registrationSession.id] }),
  subject: one(subject, { fields: [sessionSubjectSeries.subjectId], references: [subject.id] }),
  boardSeries: one(boardSeries, { fields: [sessionSubjectSeries.boardSeriesId], references: [boardSeries.id] }),
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
    // Whether a reversal gave the money back to the family (true: money out
    // on the day of the reversal) or corrected a confirmation made by mistake
    // when no money had come in (false: the confirmation day's money in is
    // corrected instead). Null unless reversed (owner decision MO-11).
    reversalMoneyReturned: boolean("reversal_money_returned"),
    // An InstaPay checkout still waiting for its transfer reference when the
    // window closed survives the close until this time (the close plus the
    // grace period); after it, it lapses and its subjects are released
    // (owner decision MO-10). Null otherwise.
    referenceDueAt: timestamp("reference_due_at", { withTimezone: true }),
    // A transfer this payment claimed, found on the bank statement after the
    // payment had failed (lapsed, rejected, or closed at the board deadline):
    // a finance admin recorded it with the statement's reference, and the
    // amount that arrived was credited to the family's escrow. Money in on
    // that day; the registrations stay as they are.
    lateTransferAt: timestamp("late_transfer_at", { withTimezone: true }),
    lateTransferBy: text("late_transfer_by").references(() => user.id, { onDelete: "set null" }),
    lateTransferAmount: numeric("late_transfer_amount", { precision: 12, scale: 2, mode: "number" }),
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
    // One school fee per student per academic year: one payment open or paid
    // at a time. Two desk collections at once, or the desk while the family's
    // transfer was being checked, both took it (state audit ST-02).
    uniqueIndex("payment_one_school_fee_per_year_idx")
      .on(table.studentId, table.academicYear)
      .where(sql`purpose = 'school_fee' AND status IN ('pending', 'pending_verification', 'completed')`),
    // L-8: Payment amount may be 0 for fully-escrow-funded payments (C-8
    // auto-confirm path) but never negative. Same for the escrow portion.
    check("payment_amount_nonneg", sql`${table.amount} >= 0`),
    check(
      "payment_escrow_applied_nonneg",
      sql`${table.escrowAmountApplied} >= 0`,
    ),
    // A transfer found later is recorded with the amount that arrived, or not at all.
    check(
      "payment_late_transfer_recorded_whole",
      sql`(${table.lateTransferAt} IS NULL AND ${table.lateTransferAmount} IS NULL) OR (${table.lateTransferAt} IS NOT NULL AND ${table.lateTransferAmount} > 0)`,
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
    reason: text("reason").notNull(), // 'drop' | 'swap_refund' | 'transfer_in' | 'transfer_out' | 'withdrawal' | 'payment' | 'payment_refund' | 'prereg_hold' | 'prereg_capture' | 'prereg_release' | 'late_transfer' | 'late_transfer_undone'
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
    status: text("status").notNull().default("active"), // 'active' | 'revoked' | 'lapsed' (a grade-10 exception past its validUntil, F0a)
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
  lateTransferByUser: one(user, {
    fields: [payment.lateTransferBy],
    references: [user.id],
    relationName: "lateTransferPayments",
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
  // F0b: the board series it is entered in.
  boardSeries: one(boardSeries, {
    fields: [registration.boardSeriesId],
    references: [boardSeries.id],
  }),
}));

/**
 * TEACHER RELATIONS
 */
export const teacherRelations = relations(teacher, ({ one, many }) => ({
  subjectTeachers: many(subjectTeacher),
  registrations: many(registration),
  account: one(user, {
    fields: [teacher.userId],
    references: [user.id],
  }),
  homeroomSections: many(section),
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


/**
 * ============================================
 * F0a — SCHOOL SETTINGS
 * ============================================
 *
 * One row per setting the school has changed from its default. Keys and
 * their schemas, defaults and the roles that may change them are declared in
 * @repo/validations (SETTINGS); a key never set reads as its default. Every
 * change is audited (SETTING_CHANGED) in the transaction that writes it.
 */
export const schoolSetting = pgTable("school_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
});

/**
 * ============================================
 * F0a — ACADEMIC STRUCTURE
 * ============================================
 *
 * Academic years (1 July – 30 June, named by their start year) with the
 * school's own first and last day; terms inside them; the school calendar
 * (holidays, early dismissals, exam-only days, extra school days) on top of
 * the school week (the calendar.schoolWeekdays setting); bell schedules and
 * their periods per weekday; rooms; homeroom sections per academic year and
 * their membership, which keeps its history.
 */
export const academicYear = pgTable(
  "academic_year",
  {
    id: text("id").primaryKey(),
    startYear: integer("start_year").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("academicYear_startYear_idx").on(table.startYear),
    check("academic_year_dates_ordered", sql`${table.startsOn} <= ${table.endsOn}`),
    // The school's days fall inside 1 July – 30 June of the year.
    check(
      "academic_year_dates_inside",
      sql`${table.startsOn} >= make_date(${table.startYear}, 7, 1) AND ${table.endsOn} <= make_date(${table.startYear} + 1, 6, 30)`,
    ),
  ]
);

export const academicTerm = pgTable(
  "academic_term",
  {
    id: text("id").primaryKey(),
    academicYearId: text("academic_year_id")
      .notNull()
      .references(() => academicYear.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("academicTerm_yearId_idx").on(table.academicYearId),
    check("academic_term_dates_ordered", sql`${table.startsOn} <= ${table.endsOn}`),
  ]
);

export const bellSchedule = pgTable(
  "bell_schedule",
  {
    id: text("id").primaryKey(),
    academicYearId: text("academic_year_id")
      .notNull()
      .references(() => academicYear.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The school's ordinary day; every other schedule is a variant a
    // calendar day runs on.
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("bellSchedule_yearId_idx").on(table.academicYearId),
    uniqueIndex("bellSchedule_one_default_idx").on(table.academicYearId).where(sql`is_default`),
  ]
);

export const bellPeriod = pgTable(
  "bell_period",
  {
    id: text("id").primaryKey(),
    bellScheduleId: text("bell_schedule_id")
      .notNull()
      .references(() => bellSchedule.id, { onDelete: "cascade" }),
    // 0 = Sunday … 6 = Saturday; null = every school day.
    weekday: integer("weekday"),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    kind: text("kind").notNull(), // 'lesson' | 'break' | 'assembly' | 'registration'
    startsAt: text("starts_at").notNull(), // HH:MM
    endsAt: text("ends_at").notNull(),
  },
  (table) => [
    index("bellPeriod_scheduleId_idx").on(table.bellScheduleId),
    check("bell_period_weekday_range", sql`${table.weekday} IS NULL OR ${table.weekday} BETWEEN 0 AND 6`),
    check("bell_period_times", sql`${table.startsAt} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${table.endsAt} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${table.endsAt} > ${table.startsAt}`),
  ]
);

export const calendarEntry = pgTable(
  "calendar_entry",
  {
    id: text("id").primaryKey(),
    academicYearId: text("academic_year_id")
      .notNull()
      .references(() => academicYear.id, { onDelete: "cascade" }),
    // 'holiday' | 'early_dismissal' | 'exam_only' | 'school_day'
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    // The bells that day, when not the default schedule.
    bellScheduleId: text("bell_schedule_id").references(() => bellSchedule.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("calendarEntry_yearId_idx").on(table.academicYearId),
    index("calendarEntry_dates_idx").on(table.startsOn, table.endsOn),
    check("calendar_entry_dates_ordered", sql`${table.startsOn} <= ${table.endsOn}`),
    check("calendar_entry_kind_valid", sql`${table.kind} IN ('holiday', 'early_dismissal', 'exam_only', 'school_day')`),
  ]
);

export const room = pgTable(
  "room",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    capacity: integer("capacity"),
    // 'classroom' | 'science_lab' | 'computer_lab' | 'hall' | 'library' | 'art_room' | 'sports' | 'other'
    type: text("type").notNull().default("classroom"),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("room_name_unique_idx").on(sql`lower(${table.name})`),
    check("room_capacity_positive", sql`${table.capacity} IS NULL OR ${table.capacity} > 0`),
  ]
);

export const section = pgTable(
  "section",
  {
    id: text("id").primaryKey(),
    academicYearId: text("academic_year_id")
      .notNull()
      .references(() => academicYear.id, { onDelete: "restrict" }),
    grade: integer("grade").notNull(),
    name: text("name").notNull(),
    homeroomTeacherId: text("homeroom_teacher_id").references(() => teacher.id, { onDelete: "set null" }),
    roomId: text("room_id").references(() => room.id, { onDelete: "set null" }),
    capacity: integer("capacity"),
    // The section of the year before that a roll-over made this one from;
    // a second roll-over finds it and changes nothing.
    rolledFromSectionId: text("rolled_from_section_id").references((): AnyPgColumn => section.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("section_yearId_idx").on(table.academicYearId),
    uniqueIndex("section_year_name_idx").on(table.academicYearId, sql`lower(${table.name})`),
    uniqueIndex("section_rolled_from_idx").on(table.rolledFromSectionId),
    check("section_grade_range", sql`${table.grade} BETWEEN 10 AND 12`),
    check("section_capacity_positive", sql`${table.capacity} IS NULL OR ${table.capacity} > 0`),
  ]
);

export const sectionMembership = pgTable(
  "section_membership",
  {
    id: text("id").primaryKey(),
    sectionId: text("section_id")
      .notNull()
      .references(() => section.id, { onDelete: "restrict" }),
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    // The section's year, kept here so the database holds the rule: one open
    // membership per student per academic year.
    academicYearId: text("academic_year_id")
      .notNull()
      .references(() => academicYear.id, { onDelete: "restrict" }),
    startedOn: date("started_on", { mode: "string" }).notNull(),
    endedOn: date("ended_on", { mode: "string" }),
    endReason: text("end_reason"),
    addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
    endedBy: text("ended_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("sectionMembership_sectionId_idx").on(table.sectionId),
    index("sectionMembership_studentId_idx").on(table.studentId),
    uniqueIndex("sectionMembership_one_open_per_year_idx")
      .on(table.studentId, table.academicYearId)
      .where(sql`ended_on IS NULL`),
    check("section_membership_dates_ordered", sql`${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn}`),
  ]
);

export const academicYearRelations = relations(academicYear, ({ many }) => ({
  terms: many(academicTerm),
  calendarEntries: many(calendarEntry),
  bellSchedules: many(bellSchedule),
  sections: many(section),
}));

export const academicTermRelations = relations(academicTerm, ({ one }) => ({
  academicYear: one(academicYear, { fields: [academicTerm.academicYearId], references: [academicYear.id] }),
}));

export const bellScheduleRelations = relations(bellSchedule, ({ one, many }) => ({
  academicYear: one(academicYear, { fields: [bellSchedule.academicYearId], references: [academicYear.id] }),
  periods: many(bellPeriod),
}));

export const bellPeriodRelations = relations(bellPeriod, ({ one }) => ({
  schedule: one(bellSchedule, { fields: [bellPeriod.bellScheduleId], references: [bellSchedule.id] }),
}));

export const calendarEntryRelations = relations(calendarEntry, ({ one }) => ({
  academicYear: one(academicYear, { fields: [calendarEntry.academicYearId], references: [academicYear.id] }),
  bellSchedule: one(bellSchedule, { fields: [calendarEntry.bellScheduleId], references: [bellSchedule.id] }),
}));

export const sectionRelations = relations(section, ({ one, many }) => ({
  academicYear: one(academicYear, { fields: [section.academicYearId], references: [academicYear.id] }),
  homeroomTeacher: one(teacher, { fields: [section.homeroomTeacherId], references: [teacher.id] }),
  room: one(room, { fields: [section.roomId], references: [room.id] }),
  memberships: many(sectionMembership),
}));

export const sectionMembershipRelations = relations(sectionMembership, ({ one }) => ({
  section: one(section, { fields: [sectionMembership.sectionId], references: [section.id] }),
  student: one(user, { fields: [sectionMembership.studentId], references: [user.id] }),
  academicYear: one(academicYear, { fields: [sectionMembership.academicYearId], references: [academicYear.id] }),
}));

/**
 * ============================================
 * F0b — COURSE ENROLMENT
 * ============================================
 *
 * What each student is taught in an academic year: each subject or unit (a
 * registrable row), by which teacher, in school or as self-study. Not an exam
 * registration — the two are checked against each other and disagreements
 * are flagged, never blocked. F1 builds teaching groups from the in-school
 * enrolments (self-study forms no group); F4 takes the student's teacher for
 * forecast grades from here. History is kept: an enrolment that stops is
 * ended, never deleted; one open enrolment per student, subject and year.
 */
export const courseEnrolment = pgTable(
  "course_enrolment",
  {
    id: text("id").primaryKey(),
    academicYearId: text("academic_year_id").notNull().references(() => academicYear.id, { onDelete: "restrict" }),
    studentId: text("student_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    subjectId: text("subject_id").notNull().references(() => subject.id, { onDelete: "restrict" }),
    teacherId: text("teacher_id").references(() => teacher.id, { onDelete: "set null" }),
    // 'in_school' | 'self_study'
    mode: text("mode").notNull().default("in_school"),
    // 'manual' | 'carried_forward' | 'registrations' | 'section' | 'import'
    source: text("source").notNull(),
    // The enrolment, registration or sheet row it came from.
    sourceRef: text("source_ref"),
    startedOn: date("started_on", { mode: "string" }).notNull(),
    endedOn: date("ended_on", { mode: "string" }),
    endReason: text("end_reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    endedBy: text("ended_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("courseEnrolment_year_idx").on(table.academicYearId),
    index("courseEnrolment_studentId_idx").on(table.studentId),
    index("courseEnrolment_subjectId_idx").on(table.subjectId),
    index("courseEnrolment_teacherId_idx").on(table.teacherId),
    uniqueIndex("courseEnrolment_one_open_idx")
      .on(table.studentId, table.subjectId, table.academicYearId)
      .where(sql`ended_on IS NULL`),
    check("course_enrolment_mode_valid", sql`${table.mode} IN ('in_school', 'self_study')`),
    check("course_enrolment_source_valid", sql`${table.source} IN ('manual', 'carried_forward', 'registrations', 'section', 'import')`),
    // Self-study is not taught: it has no teacher and forms no teaching group.
    check("course_enrolment_self_study_untaught", sql`${table.mode} <> 'self_study' OR ${table.teacherId} IS NULL`),
    check("course_enrolment_dates_ordered", sql`${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn}`),
  ]
);

export const courseEnrolmentRelations = relations(courseEnrolment, ({ one }) => ({
  academicYear: one(academicYear, { fields: [courseEnrolment.academicYearId], references: [academicYear.id] }),
  student: one(user, { fields: [courseEnrolment.studentId], references: [user.id] }),
  subject: one(subject, { fields: [courseEnrolment.subjectId], references: [subject.id] }),
  teacher: one(teacher, { fields: [courseEnrolment.teacherId], references: [teacher.id] }),
}));

/**
 * ============================================
 * F1 — SCHEDULING (the timetable)
 * ============================================
 *
 * Teaching groups per academic year — formed from the course enrolment (one
 * per subject and teacher, self-study excluded) or from a homeroom section
 * (a subject the whole section is taught together) — with a membership that
 * keeps its history. The school's rules for the year: when a teacher or a
 * room cannot be used, a teacher's periods per day and per week, and groups
 * whose lessons must not fall on the same day. Timetables per term: drafts,
 * and published versions with the date each takes effect (published versions
 * are never changed or deleted). Each lesson card of a timetable sits at a
 * (weekday, lesson period) of the default bell schedule, or is unplaced.
 * Teachers' absences and the cover given for each lesson, and a per-user
 * token for the calendar feed. docs/features/SCHEDULING.md.
 */
export const teachingGroup = pgTable(
  "teaching_group",
  {
    id: text("id").primaryKey(),
    academicYearId: text("academic_year_id").notNull().references(() => academicYear.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // What is taught: a registrable subject, or null for a course the school
    // teaches outside the exam catalogue (a national subject, PE). Fixed once
    // the group exists (members carry it: one open group per subject).
    subjectId: text("subject_id").references(() => subject.id, { onDelete: "restrict" }),
    teacherId: text("teacher_id").references(() => teacher.id, { onDelete: "set null" }),
    // 'enrolment' (formed from the course enrolment), 'section' (a homeroom
    // section taught together: its students are the section's on each date),
    // 'manual' (made by hand, or by a split).
    kind: text("kind").notNull(),
    sectionId: text("section_id").references(() => section.id, { onDelete: "restrict" }),
    weeklyPeriods: integer("weekly_periods").notNull().default(4),
    // How many of the weekly periods come as double lessons (each double is two periods).
    doublePeriods: integer("double_periods").notNull().default(0),
    // What its room must be: a type, features, or one fixed room.
    roomType: text("room_type"),
    roomFeatures: jsonb("room_features").$type<string[]>().notNull().default([]),
    roomId: text("room_id").references(() => room.id, { onDelete: "set null" }),
    // The group a split took these students from.
    splitFromGroupId: text("split_from_group_id").references((): AnyPgColumn => teachingGroup.id, { onDelete: "set null" }),
    // From this day on the group is not taught (merged into another, or retired).
    archivedOn: date("archived_on", { mode: "string" }),
    archivedReason: text("archived_reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("teachingGroup_yearId_idx").on(table.academicYearId),
    index("teachingGroup_subjectId_idx").on(table.subjectId),
    index("teachingGroup_teacherId_idx").on(table.teacherId),
    index("teachingGroup_sectionId_idx").on(table.sectionId),
    uniqueIndex("teachingGroup_year_name_idx").on(table.academicYearId, sql`lower(${table.name})`).where(sql`archived_on IS NULL`),
    check("teaching_group_kind_valid", sql`${table.kind} IN ('enrolment', 'section', 'manual')`),
    check("teaching_group_section_kind", sql`(${table.kind} = 'section') = (${table.sectionId} IS NOT NULL)`),
    check("teaching_group_periods", sql`${table.weeklyPeriods} BETWEEN 0 AND 30 AND ${table.doublePeriods} >= 0 AND ${table.doublePeriods} * 2 <= ${table.weeklyPeriods}`),
  ]
);

export const teachingGroupMember = pgTable(
  "teaching_group_member",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id").notNull().references(() => teachingGroup.id, { onDelete: "restrict" }),
    studentId: text("student_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    academicYearId: text("academic_year_id").notNull().references(() => academicYear.id, { onDelete: "restrict" }),
    // The group's subject, kept here so the database holds the rule: one open
    // group per student per subject and year.
    subjectId: text("subject_id").references(() => subject.id, { onDelete: "restrict" }),
    // The enrolment it came from (formed or refreshed from the course enrolment).
    enrolmentId: text("enrolment_id").references(() => courseEnrolment.id, { onDelete: "set null" }),
    startedOn: date("started_on", { mode: "string" }).notNull(),
    // The last day in the group (inclusive), null while open.
    endedOn: date("ended_on", { mode: "string" }),
    endReason: text("end_reason"),
    addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
    endedBy: text("ended_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("teachingGroupMember_groupId_idx").on(table.groupId),
    index("teachingGroupMember_studentId_idx").on(table.studentId),
    uniqueIndex("teachingGroupMember_one_open_idx").on(table.groupId, table.studentId).where(sql`ended_on IS NULL`),
    uniqueIndex("teachingGroupMember_one_subject_idx")
      .on(table.studentId, table.subjectId, table.academicYearId)
      .where(sql`ended_on IS NULL AND subject_id IS NOT NULL`),
    check("teaching_group_member_dates_ordered", sql`${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn}`),
  ]
);

/** A teacher or a room that cannot be used at a period (or a whole day) of the week, for a year. */
export const scheduleUnavailability = pgTable(
  "schedule_unavailability",
  {
    id: text("id").primaryKey(),
    academicYearId: text("academic_year_id").notNull().references(() => academicYear.id, { onDelete: "cascade" }),
    teacherId: text("teacher_id").references(() => teacher.id, { onDelete: "cascade" }),
    roomId: text("room_id").references(() => room.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    // A lesson period (1 = the day's first); null = the whole day.
    period: integer("period"),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("scheduleUnavailability_yearId_idx").on(table.academicYearId),
    check("schedule_unavailability_one_resource", sql`(${table.teacherId} IS NULL) <> (${table.roomId} IS NULL)`),
    check("schedule_unavailability_weekday", sql`${table.weekday} BETWEEN 0 AND 6`),
    check("schedule_unavailability_period", sql`${table.period} IS NULL OR ${table.period} >= 1`),
  ]
);

/** A teacher's most periods in a day and in a week, for a year. */
export const teacherLoadLimit = pgTable(
  "teacher_load_limit",
  {
    id: text("id").primaryKey(),
    academicYearId: text("academic_year_id").notNull().references(() => academicYear.id, { onDelete: "cascade" }),
    teacherId: text("teacher_id").notNull().references(() => teacher.id, { onDelete: "cascade" }),
    maxPerDay: integer("max_per_day"),
    maxPerWeek: integer("max_per_week"),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("teacherLoadLimit_year_teacher_idx").on(table.academicYearId, table.teacherId),
    check("teacher_load_limit_positive", sql`(${table.maxPerDay} IS NULL OR ${table.maxPerDay} >= 1) AND (${table.maxPerWeek} IS NULL OR ${table.maxPerWeek} >= 1)`),
  ]
);

/** Lessons of these two groups never fall on the same day (a group with itself: its own lessons on different days). */
export const groupDayRule = pgTable(
  "group_day_rule",
  {
    id: text("id").primaryKey(),
    academicYearId: text("academic_year_id").notNull().references(() => academicYear.id, { onDelete: "cascade" }),
    groupAId: text("group_a_id").notNull().references(() => teachingGroup.id, { onDelete: "cascade" }),
    groupBId: text("group_b_id").notNull().references(() => teachingGroup.id, { onDelete: "cascade" }),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("groupDayRule_pair_idx").on(table.groupAId, table.groupBId),
    check("group_day_rule_ordered", sql`${table.groupAId} <= ${table.groupBId}`),
  ]
);

/**
 * A timetable of a term. A draft is edited and generated; publishing gives it
 * the date it takes effect and freezes it. On a date, the timetable in force
 * is the term's published one with the latest effective date on or before it
 * (the later publication wins a tie).
 */
export const timetable = pgTable(
  "timetable",
  {
    id: text("id").primaryKey(),
    termId: text("term_id").notNull().references(() => academicTerm.id, { onDelete: "restrict" }),
    academicYearId: text("academic_year_id").notNull().references(() => academicYear.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // 'draft' | 'published'
    status: text("status").notNull().default("draft"),
    effectiveFrom: date("effective_from", { mode: "string" }),
    // The version it was copied from.
    basedOnId: text("based_on_id").references((): AnyPgColumn => timetable.id, { onDelete: "set null" }),
    // Bumped by every change, so an editor knows its picture is stale.
    revision: integer("revision").notNull().default(0),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishNote: text("publish_note"),
  },
  (table) => [
    index("timetable_termId_idx").on(table.termId),
    check("timetable_status_valid", sql`${table.status} IN ('draft', 'published')`),
    check("timetable_published_whole", sql`(${table.status} = 'published') = (${table.effectiveFrom} IS NOT NULL AND ${table.publishedAt} IS NOT NULL)`),
  ]
);

export const timetableLesson = pgTable(
  "timetable_lesson",
  {
    id: text("id").primaryKey(),
    timetableId: text("timetable_id").notNull().references(() => timetable.id, { onDelete: "cascade" }),
    groupId: text("group_id").notNull().references(() => teachingGroup.id, { onDelete: "restrict" }),
    // Its number among the group's lessons of the week (doubles first).
    seq: integer("seq").notNull(),
    // 1 = one period, 2 = a double.
    length: integer("length").notNull().default(1),
    weekday: integer("weekday"),
    // The lesson period it starts at (1 = the day's first); null with weekday = unplaced.
    period: integer("period"),
    roomId: text("room_id").references(() => room.id, { onDelete: "set null" }),
    locked: boolean("locked").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("timetableLesson_timetableId_idx").on(table.timetableId),
    index("timetableLesson_groupId_idx").on(table.groupId),
    uniqueIndex("timetableLesson_group_seq_idx").on(table.timetableId, table.groupId, table.seq),
    check("timetable_lesson_length", sql`${table.length} IN (1, 2)`),
    check("timetable_lesson_slot_whole", sql`(${table.weekday} IS NULL) = (${table.period} IS NULL)`),
    check("timetable_lesson_slot_range", sql`(${table.weekday} IS NULL OR ${table.weekday} BETWEEN 0 AND 6) AND (${table.period} IS NULL OR ${table.period} >= 1)`),
    check("timetable_lesson_locked_placed", sql`NOT ${table.locked} OR ${table.weekday} IS NOT NULL`),
  ]
);

/** Each run of the generator on a draft: what it was given, what it did, and why a lesson stayed unplaced. */
export const timetableGenerationRun = pgTable(
  "timetable_generation_run",
  {
    id: text("id").primaryKey(),
    timetableId: text("timetable_id").notNull().references(() => timetable.id, { onDelete: "cascade" }),
    startedBy: text("started_by").references(() => user.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    durationMs: integer("duration_ms").notNull(),
    // 'applied' | 'stale' (the draft changed while it ran; nothing written)
    outcome: text("outcome").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash").notNull(),
    seed: text("seed").notNull(),
    iterations: integer("iterations").notNull(),
    lessons: integer("lessons").notNull(),
    placed: integer("placed").notNull(),
    unplaced: integer("unplaced").notNull(),
    locked: integer("locked").notNull(),
    measures: jsonb("measures").$type<Record<string, unknown>>().notNull(),
    explanations: jsonb("explanations").$type<unknown[]>().notNull(),
  },
  (table) => [
    index("timetableGenerationRun_timetableId_idx").on(table.timetableId),
    check("timetable_generation_run_outcome", sql`${table.outcome} IN ('applied', 'stale')`),
  ]
);

/** A teacher away for a day or a range of days (or some periods of one day). */
export const teacherAbsence = pgTable(
  "teacher_absence",
  {
    id: text("id").primaryKey(),
    teacherId: text("teacher_id").notNull().references(() => teacher.id, { onDelete: "restrict" }),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    // Only these lesson periods (one day only); null = the whole of each day.
    periods: jsonb("periods").$type<number[] | null>(),
    // 'sick' | 'personal' | 'training' | 'school_business' | 'other'
    reason: text("reason").notNull(),
    note: text("note"),
    recordedBy: text("recorded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    index("teacherAbsence_teacherId_idx").on(table.teacherId),
    index("teacherAbsence_dates_idx").on(table.startsOn, table.endsOn),
    check("teacher_absence_dates_ordered", sql`${table.startsOn} <= ${table.endsOn}`),
    check("teacher_absence_periods_one_day", sql`${table.periods} IS NULL OR ${table.startsOn} = ${table.endsOn}`),
    check("teacher_absence_reason_valid", sql`${table.reason} IN ('sick', 'personal', 'training', 'school_business', 'other')`),
  ]
);

/**
 * What happens to one lesson on one date when its teacher is away: another
 * teacher covers it, or it is cancelled. History is kept: a change removes the
 * row (status 'removed') and adds a new one.
 */
export const coverAssignment = pgTable(
  "cover_assignment",
  {
    id: text("id").primaryKey(),
    absenceId: text("absence_id").references(() => teacherAbsence.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    timetableId: text("timetable_id").notNull().references(() => timetable.id, { onDelete: "restrict" }),
    lessonId: text("lesson_id").notNull().references(() => timetableLesson.id, { onDelete: "restrict" }),
    groupId: text("group_id").notNull().references(() => teachingGroup.id, { onDelete: "restrict" }),
    originalTeacherId: text("original_teacher_id").references(() => teacher.id, { onDelete: "set null" }),
    coverTeacherId: text("cover_teacher_id").references(() => teacher.id, { onDelete: "restrict" }),
    // 'assigned' | 'cancelled' | 'removed'
    status: text("status").notNull(),
    note: text("note"),
    assignedBy: text("assigned_by").references(() => user.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
    removedBy: text("removed_by").references(() => user.id, { onDelete: "set null" }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    index("coverAssignment_date_idx").on(table.date),
    index("coverAssignment_coverTeacherId_idx").on(table.coverTeacherId),
    uniqueIndex("coverAssignment_one_live_idx").on(table.lessonId, table.date).where(sql`status <> 'removed'`),
    check("cover_assignment_status_valid", sql`${table.status} IN ('assigned', 'cancelled', 'removed')`),
    check("cover_assignment_teacher", sql`${table.status} <> 'assigned' OR ${table.coverTeacherId} IS NOT NULL`),
    check("cover_assignment_cancelled_no_teacher", sql`${table.status} <> 'cancelled' OR ${table.coverTeacherId} IS NULL`),
  ]
);

/** A user's calendar feed: only the hash of its secret is kept; revoking it ends the feed. */
export const calendarFeedToken = pgTable(
  "calendar_feed_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("calendarFeedToken_one_live_idx").on(table.userId).where(sql`revoked_at IS NULL`),
  ]
);

export const teachingGroupRelations = relations(teachingGroup, ({ one, many }) => ({
  academicYear: one(academicYear, { fields: [teachingGroup.academicYearId], references: [academicYear.id] }),
  subject: one(subject, { fields: [teachingGroup.subjectId], references: [subject.id] }),
  teacher: one(teacher, { fields: [teachingGroup.teacherId], references: [teacher.id] }),
  section: one(section, { fields: [teachingGroup.sectionId], references: [section.id] }),
  room: one(room, { fields: [teachingGroup.roomId], references: [room.id] }),
  members: many(teachingGroupMember),
}));

export const teachingGroupMemberRelations = relations(teachingGroupMember, ({ one }) => ({
  group: one(teachingGroup, { fields: [teachingGroupMember.groupId], references: [teachingGroup.id] }),
  student: one(user, { fields: [teachingGroupMember.studentId], references: [user.id] }),
}));

export const timetableRelations = relations(timetable, ({ one, many }) => ({
  term: one(academicTerm, { fields: [timetable.termId], references: [academicTerm.id] }),
  academicYear: one(academicYear, { fields: [timetable.academicYearId], references: [academicYear.id] }),
  lessons: many(timetableLesson),
}));

export const timetableLessonRelations = relations(timetableLesson, ({ one }) => ({
  timetable: one(timetable, { fields: [timetableLesson.timetableId], references: [timetable.id] }),
  group: one(teachingGroup, { fields: [timetableLesson.groupId], references: [teachingGroup.id] }),
  room: one(room, { fields: [timetableLesson.roomId], references: [room.id] }),
}));
