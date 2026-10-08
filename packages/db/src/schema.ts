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
    // Reservations rework (RESERVATIONS_REWORK.md §3.5 gate.priorSeries): how
    // long a carried result stays usable, in months between the sitting it is
    // carried from and the series it is carried into (Cambridge: 13). Null: no
    // limit on record. F4 reads it.
    carryForwardMonths: integer("carry_forward_months"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check("exam_board_carry_forward_months_range", sql`${table.carryForwardMonths} IS NULL OR ${table.carryForwardMonths} BETWEEN 1 AND 60`),
  ]
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
    // The tier where the syllabus fixes it for the whole award ('core' |
    // 'extended' | 'foundation' | 'higher'); null when the candidate's
    // components or option decide it. Equivalency (Mo'adala) requires
    // Extended: F5 reads it; F4 records the tier and option code per entry.
    tier: text("tier"),
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
    check("qualification_tier_valid", sql`${table.tier} IS NULL OR ${table.tier} IN ('core', 'extended', 'foundation', 'higher')`),
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
    // A component's tier where the syllabus fixes it (Cambridge IGCSE Paper 2
    // is Extended, Paper 1 Core; Pearson 4MA1 Paper 1H Higher): 'core' |
    // 'extended' | 'foundation' | 'higher', or null.
    tier: text("tier"),
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
    check("exam_unit_tier_valid", sql`${table.tier} IS NULL OR ${table.tier} IN ('core', 'extended', 'foundation', 'higher')`),
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

/** A session's refund policy: steps in weeks from the course start (RESERVATIONS_REWORK.md §3.1). */
type RefundPolicyJson = { steps: { throughWeek: number | null; percent: number }[] };

export const registrationSession = pgTable(
  "registration_session",
  {
    id: text("id").primaryKey(),
    // Reservations rework: derived from the type, the year and the label
    // (deriveSessionName, @repo/validations) and stored, so every reader of a
    // session's name keeps working. A converted window's old name is in its
    // edit history.
    name: text("name").notNull(),
    // 'june' (the June series of every board) | 'winter' (the boards'
    // October and November of the year and January of the next). Converted
    // windows: october and november → winter of their year, january → winter
    // of the year before (migration 0042).
    sessionType: text("session_type").notNull(),
    // F0a: the year of the exam series (2027 for June 2027; a winter
    // session's November year). The series belongs to one academic year —
    // June of Y to Y−1/Y, winter of Y to Y/Y+1 — which decides every
    // student's grade in it.
    seriesYear: integer("series_year").notNull(),
    // '' for a new session. A converted window keeps its old type and level
    // ('june-igcse', 'october-as_level') so no two collide and nothing is merged.
    label: text("label").notNull().default(""),
    // Kept nullable and unread for one release, then dropped (§3.1, §7 step
    // 3): the level is per subject now.
    qualificationLevel: text("qualification_level"),
    // When families may reserve. The cut-off is per item: each item is
    // reservable until its series' deadline (§3.3).
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    // The cycle's first lesson: the refund anchor unless something closer to
    // the student says otherwise (§3.1). Not null after migration 0043.
    courseStartsOn: date("course_starts_on", { mode: "string" }).notNull(),
    // Steps in weeks from the anchor, copied from the type's setting at
    // creation; editable until the first line carries a consent. Null on a
    // converted session (its absolute refund windows apply).
    refundPolicy: jsonb("refund_policy").$type<RefundPolicyJson>(),
    // When every line is due unless an exception says otherwise; per line
    // capped by its series' deadline (dueDateFor). Not null after 0043.
    paymentDueAt: timestamp("payment_due_at", { withTimezone: true }).notNull(),
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
    // Reservations rework: one active session per (type, year, label) —
    // created by migration 0043 once the backfill had given every converted
    // window its label; the old one per (type, level) is gone. The window no
    // longer closes before its series' deadlines: the cut-off is per item.
    uniqueIndex("one_active_session_per_cycle_idx")
      .on(table.sessionType, table.seriesYear, table.label)
      .where(sql`status = 'active'`),
    check("session_type_valid", sql`${table.sessionType} IN ('june', 'winter')`),
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
    // Reservations rework (§3.3): an instant with the entry deadline's rules
    // (the admin's, a reason, in the future when set, audited). A retake line
    // whose prior sitting is the board's latest sitting before this series is
    // cut off here instead of at the entry deadline. Converted from a date to
    // the end of that day in Cairo (migration 0041).
    retakeDeadline: timestamp("retake_deadline", { withTimezone: true }),
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
    // Reservations rework (§3.2): 'person' | 'provider' — an external team
    // the links sheet names ("External"), with no account.
    kind: text("kind").notNull().default("person"),
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
    check("teacher_kind_valid", sql`${table.kind} IN ('person', 'provider')`),
    // A provider is a name, never an account.
    check("teacher_provider_no_account", sql`${table.kind} <> 'provider' OR ${table.userId} IS NULL`),
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
 * RESERVATIONS REWORK — OFFERS, ITEMS, BOARD FEES (step 1)
 * ============================================
 *
 * RESERVATIONS_REWORK.md §3.2–§3.4; docs/features/RESERVATIONS.md §1. A
 * session's offers are the school's links sheet: per subject its
 * availability, course fee, teachers and the items a family can tick
 * (whole subject, a one-paper retake, an IAL unit, a Cambridge route), each
 * entered in one board series and priced from that series' fee grid.
 */
export const sessionOffer = pgTable(
  "session_offer",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => registrationSession.id, { onDelete: "restrict" }),
    // The catalogue's registrable row (board, qualification, units as F0b maps them).
    subjectId: text("subject_id").notNull().references(() => subject.id, { onDelete: "restrict" }),
    // 'open' (first entries and retakes) | 'retake_only' | 'self_study_only' | 'closed'
    availability: text("availability").notNull().default("open"),
    // EGP for a first entry in school this cycle (Q-14).
    courseFee: numeric("course_fee", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    // Null: the session's course start.
    courseStartsOn: date("course_starts_on", { mode: "string" }),
    // The grade-10 core mandate for this cycle (replaces subject.is_core).
    grade10Core: boolean("grade10_core").notNull().default(false),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    // { converted: true } on an offer the conversion made (migration 0042).
    legacy: jsonb("legacy").$type<Record<string, unknown>>(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("sessionOffer_session_subject_key").on(table.sessionId, table.subjectId),
    // The items' composite key: an item is of its offer's session.
    unique("sessionOffer_id_session_key").on(table.id, table.sessionId),
    index("sessionOffer_subjectId_idx").on(table.subjectId),
    check("session_offer_availability_valid", sql`${table.availability} IN ('open', 'retake_only', 'self_study_only', 'closed')`),
    check("session_offer_course_fee_nonneg", sql`${table.courseFee} >= 0`),
  ]
);

/** Who teaches an offer: picked from the subject's pool (subject_teacher). */
export const sessionOfferTeacher = pgTable(
  "session_offer_teacher",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id").notNull().references(() => sessionOffer.id, { onDelete: "cascade" }),
    teacherId: text("teacher_id").notNull().references(() => teacher.id, { onDelete: "restrict" }),
    // 'in_school' | 'online' (F1 timetables an online group without a room)
    mode: text("mode").notNull().default("in_school"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sessionOfferTeacher_unique_idx").on(table.offerId, table.teacherId),
    index("sessionOfferTeacher_teacherId_idx").on(table.teacherId),
    check("session_offer_teacher_mode_valid", sql`${table.mode} IN ('in_school', 'online')`),
  ]
);

/**
 * What a family ticks under a subject. One line per (student, session,
 * item) while live. Its series is attached to the session (the composite key
 * to session_board_series): a series is attached when an item is placed in
 * it, and detached when nothing references it.
 */
export const sessionOfferItem = pgTable(
  "session_offer_item",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id").notNull(),
    sessionId: text("session_id").notNull(),
    // As the form words it: "Whole subject", "Paper 4 only (retake)", "P1".
    label: text("label").notNull(),
    // 'whole' | 'one_paper' | 'unit' | 'route' | 'qualification'
    kind: text("kind").notNull().default("whole"),
    // What it enters with the board: 'award' (qualification_id), 'option'
    // (qualification_option_id), 'units' (session_offer_item_unit), 'subject'
    // (the offer's row itself, unmapped).
    entersKind: text("enters_kind").notNull(),
    qualificationId: text("qualification_id").references(() => qualification.id, { onDelete: "restrict" }),
    qualificationOptionId: text("qualification_option_id").references(() => qualificationOption.id, { onDelete: "restrict" }),
    // Null only on a converted item of a window that fed no series (closed).
    boardSeriesId: text("board_series_id"),
    availability: text("availability").notNull().default("open"),
    // Null: the offer's course fee.
    courseFee: numeric("course_fee", { precision: 12, scale: 2, mode: "number" }),
    needsPriorSeries: boolean("needs_prior_series").notNull().default(false),
    requiredInSeries: boolean("required_in_series").notNull().default(false),
    exclusiveGroup: text("exclusive_group"),
    sortOrder: integer("sort_order").notNull().default(0),
    // { converted: true, no_series?: true }
    legacy: jsonb("legacy").$type<Record<string, unknown>>(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "sessionOfferItem_offer_fk",
      columns: [table.offerId, table.sessionId],
      foreignColumns: [sessionOffer.id, sessionOffer.sessionId],
    }).onDelete("cascade"),
    foreignKey({
      name: "sessionOfferItem_series_link_fk",
      columns: [table.sessionId, table.boardSeriesId],
      foreignColumns: [sessionBoardSeries.sessionId, sessionBoardSeries.boardSeriesId],
    }).onDelete("restrict"),
    index("sessionOfferItem_offerId_idx").on(table.offerId),
    index("sessionOfferItem_sessionId_idx").on(table.sessionId),
    index("sessionOfferItem_boardSeriesId_idx").on(table.boardSeriesId),
    check("session_offer_item_kind_valid", sql`${table.kind} IN ('whole', 'one_paper', 'unit', 'route', 'qualification')`),
    check("session_offer_item_enters_valid", sql`(${table.entersKind} = 'award' AND ${table.qualificationId} IS NOT NULL) OR (${table.entersKind} = 'option' AND ${table.qualificationOptionId} IS NOT NULL) OR ${table.entersKind} IN ('units', 'subject')`),
    check("session_offer_item_availability_valid", sql`${table.availability} IN ('open', 'retake_only', 'self_study_only', 'closed')`),
    check("session_offer_item_course_fee_nonneg", sql`${table.courseFee} IS NULL OR ${table.courseFee} >= 0`),
  ]
);

/** The units a units item enters (IAL P1; Biology Papers 1–4). */
export const sessionOfferItemUnit = pgTable(
  "session_offer_item_unit",
  {
    itemId: text("item_id").notNull().references(() => sessionOfferItem.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull().references(() => examUnit.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.unitId] }),
    index("sessionOfferItemUnit_unitId_idx").on(table.unitId),
  ]
);

/** An item's own teachers (IAL Mathematics names one per unit). None: the offer's. */
export const sessionOfferItemTeacher = pgTable(
  "session_offer_item_teacher",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => sessionOfferItem.id, { onDelete: "cascade" }),
    teacherId: text("teacher_id").notNull().references(() => teacher.id, { onDelete: "restrict" }),
    mode: text("mode").notNull().default("in_school"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sessionOfferItemTeacher_unique_idx").on(table.itemId, table.teacherId),
    index("sessionOfferItemTeacher_teacherId_idx").on(table.teacherId),
    check("session_offer_item_teacher_mode_valid", sql`${table.mode} IN ('in_school', 'online')`),
  ]
);

/**
 * What the series' fee grid is read for, for an item: by default what it
 * enters (one row per unit of a units item); a one-paper item of a board
 * that prices the qualification is keyed on the qualification (Q-13).
 */
export const sessionOfferItemFeeKey = pgTable(
  "session_offer_item_fee_key",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => sessionOfferItem.id, { onDelete: "cascade" }),
    // 'unit' | 'option' | 'qualification' | 'subject'
    keyKind: text("key_kind").notNull(),
    unitId: text("unit_id").references(() => examUnit.id, { onDelete: "restrict" }),
    qualificationOptionId: text("qualification_option_id").references(() => qualificationOption.id, { onDelete: "restrict" }),
    qualificationId: text("qualification_id").references(() => qualification.id, { onDelete: "restrict" }),
    subjectId: text("subject_id").references(() => subject.id, { onDelete: "restrict" }),
    keyId: text("key_id").notNull().generatedAlwaysAs(sql`COALESCE("unit_id", "qualification_option_id", "qualification_id", "subject_id")`),
  },
  (table) => [
    uniqueIndex("sessionOfferItemFeeKey_unique_idx").on(table.itemId, table.keyKind, table.keyId),
    index("sessionOfferItemFeeKey_key_idx").on(table.keyKind, table.keyId),
    check("session_offer_item_fee_key_one", sql`
      (${table.keyKind} = 'unit' AND ${table.unitId} IS NOT NULL AND num_nonnulls(${table.qualificationOptionId}, ${table.qualificationId}, ${table.subjectId}) = 0)
      OR (${table.keyKind} = 'option' AND ${table.qualificationOptionId} IS NOT NULL AND num_nonnulls(${table.unitId}, ${table.qualificationId}, ${table.subjectId}) = 0)
      OR (${table.keyKind} = 'qualification' AND ${table.qualificationId} IS NOT NULL AND num_nonnulls(${table.unitId}, ${table.qualificationOptionId}, ${table.subjectId}) = 0)
      OR (${table.keyKind} = 'subject' AND ${table.subjectId} IS NOT NULL AND num_nonnulls(${table.unitId}, ${table.qualificationOptionId}, ${table.qualificationId}) = 0)`),
  ]
);

/**
 * A board's fee in one series for one key — the fee lists' rows (§3.4).
 * Provisional when copied from an earlier series or typed before the board
 * publishes; "Confirm" clears it. An amount of 0 needs a reason. C adds the
 * service kind (board_service_id, level) with the board services.
 */
export const boardFee = pgTable(
  "board_fee",
  {
    id: text("id").primaryKey(),
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "restrict" }),
    // 'unit' | 'option' | 'qualification' | 'subject'
    keyKind: text("key_kind").notNull(),
    unitId: text("unit_id").references(() => examUnit.id, { onDelete: "restrict" }),
    qualificationOptionId: text("qualification_option_id").references(() => qualificationOption.id, { onDelete: "restrict" }),
    qualificationId: text("qualification_id").references(() => qualification.id, { onDelete: "restrict" }),
    subjectId: text("subject_id").references(() => subject.id, { onDelete: "restrict" }),
    keyId: text("key_id").notNull().generatedAlwaysAs(sql`COALESCE("unit_id", "qualification_option_id", "qualification_id", "subject_id")`),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    provisional: boolean("provisional").notNull().default(true),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").references(() => user.id, { onDelete: "set null" }),
    // A fee of 0 is a decision, not a gap: it says why.
    zeroReason: text("zero_reason"),
    copiedFromFeeId: text("copied_from_fee_id").references((): AnyPgColumn => boardFee.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("boardFee_series_key_idx").on(table.boardSeriesId, table.keyKind, table.keyId),
    index("boardFee_key_idx").on(table.keyKind, table.keyId),
    check("board_fee_key_one", sql`
      (${table.keyKind} = 'unit' AND ${table.unitId} IS NOT NULL AND num_nonnulls(${table.qualificationOptionId}, ${table.qualificationId}, ${table.subjectId}) = 0)
      OR (${table.keyKind} = 'option' AND ${table.qualificationOptionId} IS NOT NULL AND num_nonnulls(${table.unitId}, ${table.qualificationId}, ${table.subjectId}) = 0)
      OR (${table.keyKind} = 'qualification' AND ${table.qualificationId} IS NOT NULL AND num_nonnulls(${table.unitId}, ${table.qualificationOptionId}, ${table.subjectId}) = 0)
      OR (${table.keyKind} = 'subject' AND ${table.subjectId} IS NOT NULL AND num_nonnulls(${table.unitId}, ${table.qualificationOptionId}, ${table.qualificationId}) = 0)`),
    check("board_fee_amount_nonneg", sql`${table.amount} >= 0`),
    check("board_fee_zero_has_reason", sql`${table.amount} > 0 OR ${table.zeroReason} IS NOT NULL`),
    check("board_fee_confirmed_whole", sql`(${table.provisional} AND ${table.confirmedAt} IS NULL) OR (NOT ${table.provisional} AND ${table.confirmedAt} IS NOT NULL)`),
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
    // composite key below). Since the rework it is the line's item's series,
    // set by the routing trigger (0042). Null only on a converted line of a
    // window that fed no series.
    boardSeriesId: text("board_series_id"),
    // ── Reservations rework (RESERVATIONS_REWORK.md §3.5) ──
    // What the line enters: an item of its session's offer for its subject.
    // Not null after migration 0043.
    offerItemId: text("offer_item_id").notNull().references(() => sessionOfferItem.id, { onDelete: "restrict" }),
    // 'first' | 'retake' — the form's "First Entry" against "Retake".
    attempt: text("attempt").notNull().default("first"),
    // 'in_school' | 'self_study' — the form's teacher choice against "Self Study".
    mode: text("mode").notNull().default("in_school"),
    // The sitting a retake or a carry-forward carries from, and how it is known:
    // 'known' | 'declared_by_desk' | 'declared_by_family' | 'legacy'.
    priorSittingSeriesId: text("prior_sitting_series_id").references(() => boardSeries.id, { onDelete: "restrict" }),
    priorSittingSource: text("prior_sitting_source"),
    // On a verified carry-forward from another centre (asked at verification, never listed).
    priorCentre: text("prior_centre"),
    priorCandidateNumber: text("prior_candidate_number"),
    // Step B (§3.5): the coordinator's answer to a declared sitting — who, when and what. A
    // paid line whose declaration was rejected before the first-entry deadline stands with
    // declaration_rejected (F4 reads its attempt as 'first').
    priorSittingVerifiedBy: text("prior_sitting_verified_by").references(() => user.id, { onDelete: "set null" }),
    priorSittingVerifiedAt: timestamp("prior_sitting_verified_at", { withTimezone: true }),
    // 'verified' | 'rejected'; null while a declared sitting waits (or there is none to verify).
    priorSittingVerifiedOutcome: text("prior_sitting_verified_outcome"),
    declarationRejected: boolean("declaration_rejected").notNull().default(false),
    // When the line is due (dueDateFor). Not null after 0043.
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    // A board fee read was provisional: "confirmed before payment".
    priceProvisional: boolean("price_provisional").notNull().default(false),
    // Why the price is what it is (priceLine): attempt, mode, percents, fee rows, exception ids.
    pricingBasis: jsonb("pricing_basis").$type<Record<string, unknown>>(),
    // The refund steps the family consented to (B writes at consent).
    refundPolicySnapshot: jsonb("refund_policy_snapshot").$type<Record<string, unknown>>(),
    // What the conversion could not know: { converted, no_series, retake_history_unknown }.
    legacy: jsonb("legacy").$type<Record<string, unknown>>(),
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
    index("registration_offerItemId_idx").on(table.offerItemId),
    index("registration_priorSittingSeriesId_idx").on(table.priorSittingSeriesId),
    check("registration_attempt_valid", sql`${table.attempt} IN ('first', 'retake')`),
    check("registration_mode_valid", sql`${table.mode} IN ('in_school', 'self_study')`),
    check("registration_prior_sitting_source_valid", sql`${table.priorSittingSource} IS NULL OR ${table.priorSittingSource} IN ('known', 'declared_by_desk', 'declared_by_family', 'legacy')`),
    // Step B: an outcome is recorded with who and when, and only on a sitting there is to verify;
    // a line stands with its declaration rejected only after a rejection.
    check("registration_prior_sitting_outcome_valid", sql`${table.priorSittingVerifiedOutcome} IS NULL OR (${table.priorSittingVerifiedOutcome} IN ('verified', 'rejected') AND ${table.priorSittingVerifiedAt} IS NOT NULL AND ${table.priorSittingSeriesId} IS NOT NULL)`),
    check("registration_declaration_rejected_outcome", sql`NOT ${table.declarationRejected} OR ${table.priorSittingVerifiedOutcome} = 'rejected'`),
    index("registration_to_verify_idx").on(table.sessionId).where(sql`prior_sitting_source IN ('declared_by_family', 'declared_by_desk') AND prior_sitting_verified_outcome IS NULL`),
    // One live line per (student, session, item) — P1 and P2 under one
    // subject are two lines (RESERVATIONS_REWORK.md §3.5; migration 0043).
    // The exclusive groups and "the same unit or award once in a series" are
    // assertLineRules' (no index can express them across sessions).
    uniqueIndex("registration_unique_live_item_idx")
      .on(table.studentId, table.sessionId, table.offerItemId)
      .where(sql`status NOT IN ('dropped', 'rejected', 'expired')`),
    // The ledger's readers keep is_retake and taken_outside_school; they say what attempt and mode say.
    check("registration_retake_is_attempt", sql`${table.isRetake} = (${table.attempt} = 'retake')`),
    check("registration_outside_is_mode", sql`${table.takenOutsideSchool} = (${table.mode} = 'self_study')`),
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
  // Reservations rework: the session's offers (its links sheet).
  offers: many(sessionOffer),
}));

export const sessionOfferRelations = relations(sessionOffer, ({ one, many }) => ({
  session: one(registrationSession, { fields: [sessionOffer.sessionId], references: [registrationSession.id] }),
  subject: one(subject, { fields: [sessionOffer.subjectId], references: [subject.id] }),
  teachers: many(sessionOfferTeacher),
  items: many(sessionOfferItem),
}));

export const sessionOfferTeacherRelations = relations(sessionOfferTeacher, ({ one }) => ({
  offer: one(sessionOffer, { fields: [sessionOfferTeacher.offerId], references: [sessionOffer.id] }),
  teacher: one(teacher, { fields: [sessionOfferTeacher.teacherId], references: [teacher.id] }),
}));

export const sessionOfferItemRelations = relations(sessionOfferItem, ({ one, many }) => ({
  offer: one(sessionOffer, { fields: [sessionOfferItem.offerId], references: [sessionOffer.id] }),
  boardSeries: one(boardSeries, { fields: [sessionOfferItem.boardSeriesId], references: [boardSeries.id] }),
  qualification: one(qualification, { fields: [sessionOfferItem.qualificationId], references: [qualification.id] }),
  option: one(qualificationOption, { fields: [sessionOfferItem.qualificationOptionId], references: [qualificationOption.id] }),
  units: many(sessionOfferItemUnit),
  teachers: many(sessionOfferItemTeacher),
  feeKeys: many(sessionOfferItemFeeKey),
  registrations: many(registration),
}));

export const sessionOfferItemUnitRelations = relations(sessionOfferItemUnit, ({ one }) => ({
  item: one(sessionOfferItem, { fields: [sessionOfferItemUnit.itemId], references: [sessionOfferItem.id] }),
  unit: one(examUnit, { fields: [sessionOfferItemUnit.unitId], references: [examUnit.id] }),
}));

export const sessionOfferItemTeacherRelations = relations(sessionOfferItemTeacher, ({ one }) => ({
  item: one(sessionOfferItem, { fields: [sessionOfferItemTeacher.itemId], references: [sessionOfferItem.id] }),
  teacher: one(teacher, { fields: [sessionOfferItemTeacher.teacherId], references: [teacher.id] }),
}));

export const sessionOfferItemFeeKeyRelations = relations(sessionOfferItemFeeKey, ({ one }) => ({
  item: one(sessionOfferItem, { fields: [sessionOfferItemFeeKey.itemId], references: [sessionOfferItem.id] }),
}));

export const boardFeeRelations = relations(boardFee, ({ one }) => ({
  boardSeries: one(boardSeries, { fields: [boardFee.boardSeriesId], references: [boardSeries.id] }),
  unit: one(examUnit, { fields: [boardFee.unitId], references: [examUnit.id] }),
  option: one(qualificationOption, { fields: [boardFee.qualificationOptionId], references: [qualificationOption.id] }),
  qualification: one(qualification, { fields: [boardFee.qualificationId], references: [qualification.id] }),
  subject: one(subject, { fields: [boardFee.subjectId], references: [subject.id] }),
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

/**
 * Consent per line (§3.5): the refund policy and the declaration, with the
 * text's version, who confirmed, on which channel ('app', 'desk', 'school'
 * for a grade-10 bulk line, 'imported'). B writes the family's and the
 * desk's; this step writes the 'school' rows of the grade-10 bulk commit.
 */
export const registrationConsent = pgTable(
  "registration_consent",
  {
    id: text("id").primaryKey(),
    registrationId: text("registration_id").notNull().references(() => registration.id, { onDelete: "restrict" }),
    // 'refund_policy' | 'declaration'
    kind: text("kind").notNull(),
    textVersion: text("text_version").notNull(),
    confirmedBy: text("confirmed_by").references(() => user.id, { onDelete: "set null" }),
    // 'app' | 'desk' | 'school' | 'imported'
    channel: text("channel").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One row per line, kind and channel (step B): a line the school reserved (grade 10, channel
    // 'school') gets the family's own pair at checkout beside it.
    uniqueIndex("registrationConsent_unique_idx").on(table.registrationId, table.kind, table.channel),
    index("registrationConsent_registrationId_idx").on(table.registrationId),
    check("registration_consent_kind_valid", sql`${table.kind} IN ('refund_policy', 'declaration')`),
    check("registration_consent_channel_valid", sql`${table.channel} IN ('app', 'desk', 'school', 'imported')`),
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
  registrations: many(registration, { relationName: "registrationSeries" }),
  priorSittingRegistrations: many(registration, { relationName: "registrationPriorSitting" }),
  items: many(sessionOfferItem),
  fees: many(boardFee),
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
    // The reservations rework (§3.10): the charge a refund (charge_refund) is for.
    relatedChargeId: text("related_charge_id").references((): AnyPgColumn => charge.id, { onDelete: "set null" }),
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
    // A line's receipt, or (the reservations rework, §3.10 item 2) a charge's: exactly one of the two.
    registrationId: text("registration_id")
      .unique()
      .references(() => registration.id, { onDelete: "restrict" }),
    chargeId: text("charge_id")
      .unique()
      .references((): AnyPgColumn => charge.id, { onDelete: "restrict" }),
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
    check("receipt_one_subject", sql`num_nonnulls(${table.registrationId}, ${table.chargeId}) = 1`),
  ]
);

export const receiptRelations = relations(receipt, ({ one }) => ({
  registration: one(registration, {
    fields: [receipt.registrationId],
    references: [registration.id],
  }),
  charge: one(charge, {
    fields: [receipt.chargeId],
    references: [charge.id],
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
 * EXCEPTION TABLE — the policy registry (RESERVATIONS_REWORK.md §3.7)
 * ============================================
 *
 * An exception lifts one policy (`policy_key`, from POLICIES in @repo/validations) for one
 * student, or for one family (`family_id`, a parent account: every linked child), narrowed to a
 * scope by any of the scope columns (a null column: the policy's null scope). Its value is in the
 * typed column its policy names: a percent or an amount in `value_number`, a date in
 * `value_date`, an instalment schedule in `value_json`. Status: active, revoked, lapsed (past
 * its validUntil, or its plan's line ended), used (a one-shot gate used by the reservation it let
 * through; a plan captured into its line).
 *
 * The eight V3 types were moved onto policy keys by migration (0046); `type` and `value` are kept
 * one release and read by nothing. A migrated subject-scoped deadline or refund exception, and a
 * price exception scoped to an old unit row, carries `check_reason`: it applies only once a finance
 * admin confirms it ("Check these").
 */
export const exception = pgTable(
  "exception",
  {
    id: text("id").primaryKey(),
    // V3's type, kept one release (the migration mapped it onto policy_key).
    type: text("type"),
    // The registry's key (backfilled by 0045, not null since 0046).
    policyKey: text("policy_key").notNull(),
    // One of the two (a check, 0046): a student, or a family (a parent account).
    studentId: text("student_id").references(() => user.id, { onDelete: "cascade" }),
    familyId: text("family_id").references(() => user.id, { onDelete: "cascade" }),
    // The scope: each set column narrows it.
    sessionId: text("session_id").references(() => registrationSession.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subject.id, { onDelete: "cascade" }),
    offerId: text("offer_id").references(() => sessionOffer.id, { onDelete: "cascade" }),
    offerItemId: text("offer_item_id").references(() => sessionOfferItem.id, { onDelete: "cascade" }),
    registrationId: text("registration_id").references(() => registration.id, { onDelete: "cascade" }),
    chargeId: text("charge_id").references((): AnyPgColumn => charge.id, { onDelete: "cascade" }),
    boardSeriesId: text("board_series_id").references(() => boardSeries.id, { onDelete: "cascade" }),
    // '2026-2027'
    academicYear: text("academic_year"),
    // V3's value, kept one release (copied into value_number).
    value: numeric("value", { precision: 12, scale: 2, mode: "number" }),
    valueNumber: numeric("value_number", { precision: 12, scale: 2, mode: "number" }),
    valueDate: timestamp("value_date", { withTimezone: true }),
    valueJson: jsonb("value_json").$type<unknown>(),
    reason: text("reason").notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    // 'active' | 'revoked' | 'lapsed' | 'used'
    status: text("status").notNull().default("active"),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
    // A one-shot gate: when it was used, and by which lines.
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedFor: jsonb("used_for").$type<{ registrationIds: string[] }>(),
    // "Check these" (§3.7): why a migrated exception waits for a finance admin, and the confirmation.
    checkReason: text("check_reason"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("exception_studentId_idx").on(table.studentId),
    index("exception_familyId_idx").on(table.familyId),
    index("exception_type_idx").on(table.type),
    index("exception_policyKey_idx").on(table.policyKey),
    index("exception_status_idx").on(table.status),
    index("exception_registrationId_idx").on(table.registrationId),
    index("exception_chargeId_idx").on(table.chargeId),
    check("exception_value_nonneg", sql`${table.value} IS NULL OR ${table.value} >= 0`),
    check("exception_value_number_nonneg", sql`${table.valueNumber} IS NULL OR ${table.valueNumber} >= 0`),
    check("exception_status_valid", sql`${table.status} IN ('active', 'revoked', 'lapsed', 'used')`),
    // A student or a family, never both, never neither (0047, after the backfill).
    check("exception_one_holder", sql`num_nonnulls(${table.studentId}, ${table.familyId}) = 1`),
  ]
);

export const exceptionRelations = relations(exception, ({ one }) => ({
  student: one(user, {
    fields: [exception.studentId],
    references: [user.id],
    relationName: "studentExceptions",
  }),
  family: one(user, {
    fields: [exception.familyId],
    references: [user.id],
    relationName: "familyExceptions",
  }),
  session: one(registrationSession, {
    fields: [exception.sessionId],
    references: [registrationSession.id],
  }),
  subject: one(subject, {
    fields: [exception.subjectId],
    references: [subject.id],
  }),
  offer: one(sessionOffer, { fields: [exception.offerId], references: [sessionOffer.id] }),
  offerItem: one(sessionOfferItem, { fields: [exception.offerItemId], references: [sessionOfferItem.id] }),
  registration: one(registration, { fields: [exception.registrationId], references: [registration.id] }),
  charge: one(charge, { fields: [exception.chargeId], references: [charge.id], relationName: "chargeExceptions" }),
  boardSeries: one(boardSeries, { fields: [exception.boardSeriesId], references: [boardSeries.id] }),
  grantedByUser: one(user, { fields: [exception.grantedBy], references: [user.id], relationName: "grantedExceptions" }),
}));

/**
 * ============================================
 * BOARD SERVICES (RESERVATIONS_REWORK.md §3.6)
 * ============================================
 *
 * What a board offers after (or around) an entry: its enquiry-about-results services (Cambridge
 * 1, 1S, 2, 2S; Pearson's review of marking, clerical re-check, access to scripts, priority
 * review; Oxford's), cash-in and late cash-in, certificate splitting. A service's fee is per
 * series and per level (`board_service_fee`: IGCSE and AS/A Level rates), its deadline per series
 * (`board_service_deadline`, replacing `remark_deadline`). `refund_rule` is what a family gets
 * back when a remark changes the grade (Q-21: seeded `full`, today's behaviour).
 *
 * The fees sit in their own table beside `board_fee` rather than as a fourth kind of its key:
 * step A's fee grid (copy, labels, the generated key) knows four kinds, and a service row there
 * would break its copy (docs/features/RESERVATIONS_MONEY.md, "For the lead").
 */
export const boardService = pgTable(
  "board_service",
  {
    id: text("id").primaryKey(),
    boardCode: text("board_code").notNull().references(() => examBoard.code, { onDelete: "restrict" }),
    // The board's own code for it ("1", "2S") or a short name ("review_of_marking").
    code: text("code").notNull(),
    label: text("label").notNull(),
    // 'remark' | 'cash_in' | 'late_cash_in' | 'certificate_split'
    kind: text("kind").notNull(),
    // The fee is per component (paper) rather than per entry.
    perComponent: boolean("per_component").notNull().default(false),
    // The fee differs between IGCSE and AS/A Level (two rows per series).
    levelRates: boolean("level_rates").notNull().default(false),
    // 'none' | 'full' | 'less_fixed' (refund_deduction per component)
    refundRule: text("refund_rule").notNull().default("full"),
    refundDeduction: numeric("refund_deduction", { precision: 12, scale: 2, mode: "number" }),
    requestableByFamily: boolean("requestable_by_family").notNull().default(false),
    // The V3 remark service type it stands for on this board (clerical_check, review_of_marking,
    // script_copy, priority_review), so a request naming one keeps working.
    legacyServiceType: text("legacy_service_type"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("boardService_board_code_idx").on(table.boardCode, table.code),
    uniqueIndex("boardService_board_legacy_idx").on(table.boardCode, table.legacyServiceType).where(sql`legacy_service_type IS NOT NULL`),
    check("board_service_kind_valid", sql`${table.kind} IN ('remark', 'cash_in', 'late_cash_in', 'certificate_split')`),
    check("board_service_refund_rule_valid", sql`${table.refundRule} IN ('none', 'full', 'less_fixed')`),
    check("board_service_deduction_whole", sql`(${table.refundRule} = 'less_fixed') = (${table.refundDeduction} IS NOT NULL AND ${table.refundDeduction} > 0)`),
  ]
);

/** A service's fee in one series, per level ('igcse' | 'as_a_level'); provisional until confirmed. */
export const boardServiceFee = pgTable(
  "board_service_fee",
  {
    id: text("id").primaryKey(),
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "restrict" }),
    boardServiceId: text("board_service_id").notNull().references(() => boardService.id, { onDelete: "restrict" }),
    level: text("level").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    provisional: boolean("provisional").notNull().default(true),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").references(() => user.id, { onDelete: "set null" }),
    // Copied from the defaults (V3's remark_fee_schedule) when a series first needed it.
    copiedFromDefault: boolean("copied_from_default").notNull().default(false),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("boardServiceFee_series_service_level_idx").on(table.boardSeriesId, table.boardServiceId, table.level),
    check("board_service_fee_level_valid", sql`${table.level} IN ('igcse', 'as_a_level')`),
    check("board_service_fee_amount_nonneg", sql`${table.amount} >= 0`),
    check("board_service_fee_confirmed_whole", sql`(${table.provisional} AND ${table.confirmedAt} IS NULL) OR (NOT ${table.provisional} AND ${table.confirmedAt} IS NOT NULL)`),
  ]
);

/** A service's deadline in one series (replaces remark_deadline, which was per window). */
export const boardServiceDeadline = pgTable(
  "board_service_deadline",
  {
    id: text("id").primaryKey(),
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "restrict" }),
    boardServiceId: text("board_service_id").notNull().references(() => boardService.id, { onDelete: "restrict" }),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    setBy: text("set_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("boardServiceDeadline_series_service_idx").on(table.boardSeriesId, table.boardServiceId),
  ]
);

export const boardServiceRelations = relations(boardService, ({ one, many }) => ({
  board: one(examBoard, { fields: [boardService.boardCode], references: [examBoard.code] }),
  fees: many(boardServiceFee),
  deadlines: many(boardServiceDeadline),
}));
export const boardServiceFeeRelations = relations(boardServiceFee, ({ one }) => ({
  service: one(boardService, { fields: [boardServiceFee.boardServiceId], references: [boardService.id] }),
  boardSeries: one(boardSeries, { fields: [boardServiceFee.boardSeriesId], references: [boardSeries.id] }),
}));
export const boardServiceDeadlineRelations = relations(boardServiceDeadline, ({ one }) => ({
  service: one(boardService, { fields: [boardServiceDeadline.boardServiceId], references: [boardService.id] }),
  boardSeries: one(boardSeries, { fields: [boardServiceDeadline.boardSeriesId], references: [boardSeries.id] }),
}));

/**
 * ============================================
 * CHARGES (RESERVATIONS_REWORK.md §3.6, §3.10)
 * ============================================
 *
 * Anything a family owes that is not a line, a remark fee or the school fee itself. Paid in a
 * payment of purpose `charge` (payment_charge rows), never mixed with lines; receipted
 * (receipt.charge_id), except an instalment, which issues a deposit slip; reversible (MO-11) and
 * refundable to escrow (at most its amount). A `school_fee_push` is never paid as a charge: the
 * school-fee payment of that student and year settles it (settled_by_payment_id). An
 * `instalment` belongs to a plan (plan_exception_id) on a line (registration_id): paid into the
 * held wallet earmarked for that line, captured into the line's payment at the last.
 */
export const charge = pgTable(
  "charge",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    // 'cash_in' | 'late_cash_in' | 'certificate_split' | 'late_entry_fee' | 'school_fee_push' |
    // 'instalment' | 'price_adjustment' | 'custom'
    kind: text("kind").notNull(),
    registrationId: text("registration_id").references(() => registration.id, { onDelete: "restrict" }),
    boardSeriesId: text("board_series_id").references(() => boardSeries.id, { onDelete: "restrict" }),
    boardServiceId: text("board_service_id").references(() => boardService.id, { onDelete: "restrict" }),
    // A service's rate: 'igcse' | 'as_a_level'.
    level: text("level"),
    // A pushed school fee's year ('2026-2027').
    academicYear: text("academic_year"),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    // 'requested' | 'pending_payment' | 'paid' | 'cancelled' | 'refunded'
    status: text("status").notNull().default("pending_payment"),
    // An instalment: its plan (the plan.instalments exception) and its place in it.
    planExceptionId: text("plan_exception_id").references((): AnyPgColumn => exception.id, { onDelete: "restrict" }),
    instalmentNo: integer("instalment_no"),
    // What came back to escrow (charge_refund), at most the amount.
    refundAmount: numeric("refund_amount", { precision: 12, scale: 2, mode: "number" }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundedBy: text("refunded_by").references(() => user.id, { onDelete: "set null" }),
    refundReason: text("refund_reason"),
    // A pushed school fee: the school-fee payment that settled it.
    settledByPaymentId: text("settled_by_payment_id").references((): AnyPgColumn => payment.id, { onDelete: "restrict" }),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    // The price exceptions (charge scope) applied to its amount (chargeRules).
    pricingBasis: jsonb("pricing_basis").$type<Record<string, unknown>>(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("charge_studentId_idx").on(table.studentId),
    index("charge_registrationId_idx").on(table.registrationId),
    index("charge_status_idx").on(table.status),
    index("charge_kind_idx").on(table.kind),
    index("charge_planExceptionId_idx").on(table.planExceptionId),
    index("charge_series_service_idx").on(table.boardSeriesId, table.boardServiceId),
    // One live push per student and year: an open one, or the one its payment settled.
    uniqueIndex("charge_one_push_per_year_idx").on(table.studentId, table.academicYear)
      .where(sql`kind = 'school_fee_push' AND status IN ('pending_payment', 'paid')`),
    // One charge per instalment of a plan.
    uniqueIndex("charge_one_instalment_idx").on(table.planExceptionId, table.instalmentNo).where(sql`kind = 'instalment'`),
    check("charge_kind_valid", sql`${table.kind} IN ('cash_in', 'late_cash_in', 'certificate_split', 'late_entry_fee', 'school_fee_push', 'instalment', 'price_adjustment', 'custom')`),
    check("charge_status_valid", sql`${table.status} IN ('requested', 'pending_payment', 'paid', 'cancelled', 'refunded')`),
    check("charge_amount_nonneg", sql`${table.amount} >= 0`),
    check("charge_level_valid", sql`${table.level} IS NULL OR ${table.level} IN ('igcse', 'as_a_level')`),
    check("charge_refund_within", sql`${table.refundAmount} IS NULL OR (${table.refundAmount} > 0 AND ${table.refundAmount} <= ${table.amount})`),
    check("charge_refunded_whole", sql`(${table.status} = 'refunded') = (${table.refundAmount} IS NOT NULL)`),
    check("charge_push_shape", sql`(${table.kind} = 'school_fee_push') = (${table.academicYear} IS NOT NULL)`),
    check("charge_settled_push_only", sql`${table.settledByPaymentId} IS NULL OR ${table.kind} = 'school_fee_push'`),
    check("charge_instalment_shape", sql`(${table.kind} = 'instalment') = (${table.planExceptionId} IS NOT NULL AND ${table.instalmentNo} IS NOT NULL AND ${table.registrationId} IS NOT NULL)`),
    check("charge_service_shape", sql`${table.kind} NOT IN ('cash_in', 'late_cash_in', 'certificate_split') OR (${table.boardServiceId} IS NOT NULL AND ${table.boardSeriesId} IS NOT NULL)`),
  ]
);

/** The charges a charge payment covers (the twin of payment_registration). */
export const paymentCharge = pgTable(
  "payment_charge",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull().references(() => payment.id, { onDelete: "cascade" }),
    chargeId: text("charge_id").notNull().references(() => charge.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("paymentCharge_paymentId_idx").on(table.paymentId),
    index("paymentCharge_chargeId_idx").on(table.chargeId),
    uniqueIndex("paymentCharge_unique_idx").on(table.paymentId, table.chargeId),
  ]
);

export const chargeRelations = relations(charge, ({ one, many }) => ({
  student: one(user, { fields: [charge.studentId], references: [user.id], relationName: "studentCharges" }),
  registration: one(registration, { fields: [charge.registrationId], references: [registration.id] }),
  boardSeries: one(boardSeries, { fields: [charge.boardSeriesId], references: [boardSeries.id] }),
  boardService: one(boardService, { fields: [charge.boardServiceId], references: [boardService.id] }),
  plan: one(exception, { fields: [charge.planExceptionId], references: [exception.id], relationName: "planCharges" }),
  settledByPayment: one(payment, { fields: [charge.settledByPaymentId], references: [payment.id], relationName: "settledPushes" }),
  paymentCharges: many(paymentCharge),
  receipt: one(receipt, { fields: [charge.id], references: [receipt.chargeId] }),
}));

export const paymentChargeRelations = relations(paymentCharge, ({ one }) => ({
  payment: one(payment, { fields: [paymentCharge.paymentId], references: [payment.id] }),
  charge: one(charge, { fields: [paymentCharge.chargeId], references: [charge.id] }),
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
    // Reservations rework (§3.5, §7): the item a swap goes to. The backfill
    // maps a pending swap to its new subject's whole item; null on history.
    newOfferItemId: text("new_offer_item_id").references(() => sessionOfferItem.id, { onDelete: "restrict" }),
    // Step B: the swap's new line as the student asked for it (attempt, mode, teacher, the
    // sitting it follows). Null on a request made before step B: approval reserves a first entry.
    newLine: jsonb("new_line").$type<Record<string, unknown>>(),
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
  // The reservations rework (§3.10 item 1): a charge payment's charges.
  paymentCharges: many(paymentCharge),
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
  relatedCharge: one(charge, {
    fields: [escrowTransaction.relatedChargeId],
    references: [charge.id],
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
    relationName: "registrationSeries",
  }),
  // Reservations rework: what the line enters, the sitting it carries from, its consents.
  offerItem: one(sessionOfferItem, {
    fields: [registration.offerItemId],
    references: [sessionOfferItem.id],
  }),
  priorSitting: one(boardSeries, {
    fields: [registration.priorSittingSeriesId],
    references: [boardSeries.id],
    relationName: "registrationPriorSitting",
  }),
  consents: many(registrationConsent),
}));

export const registrationConsentRelations = relations(registrationConsent, ({ one }) => ({
  registration: one(registration, { fields: [registrationConsent.registrationId], references: [registration.id] }),
}));

/**
 * TEACHER RELATIONS
 */
export const teacherRelations = relations(teacher, ({ one, many }) => ({
  subjectTeachers: many(subjectTeacher),
  registrations: many(registration),
  offerTeachers: many(sessionOfferTeacher),
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
    // The reservations rework (§3.6): the board service of the line's board it is for, and the
    // rate it was priced at ('igcse' | 'as_a_level') from the series' fee grid.
    boardServiceId: text("board_service_id").references(() => boardService.id, { onDelete: "restrict" }),
    serviceLevel: text("service_level"),
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
  boardService: one(boardService, {
    fields: [remarkRequest.boardServiceId],
    references: [boardService.id],
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
    // Reservations rework (§3.2, §10): the unit when one is set — history,
    // enrolment and groups are keyed by the unit, else by the subject, so the
    // same unit under two subject rows does not split a student's record.
    unitId: text("unit_id").references(() => examUnit.id, { onDelete: "restrict" }),
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
    // One open enrolment per (student, subject, year) with no unit, and per
    // (student, unit, year) with one: two partial indexes, so a nullable
    // unit needs no NULLS NOT DISTINCT.
    uniqueIndex("courseEnrolment_one_open_idx")
      .on(table.studentId, table.subjectId, table.academicYearId)
      .where(sql`ended_on IS NULL AND unit_id IS NULL`),
    uniqueIndex("courseEnrolment_one_open_unit_idx")
      .on(table.studentId, table.unitId, table.academicYearId)
      .where(sql`ended_on IS NULL AND unit_id IS NOT NULL`),
    index("courseEnrolment_unitId_idx").on(table.unitId),
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
  unit: one(examUnit, { fields: [courseEnrolment.unitId], references: [examUnit.id] }),
  teacher: one(teacher, { fields: [courseEnrolment.teacherId], references: [teacher.id] }),
}));

/**
 * ============================================
 * F4 — EXAM-ENTRY MANAGEMENT
 * ============================================
 *
 * The school as an exam centre (FEATURES_PLAN.md F4; DISCOVERY_RESEARCH.md
 * §2 and §5 notes 2, 5, 6; docs/features/EXAM_ENTRIES.md). Built on F0b's
 * catalogue and board series: a confirmed registration is entered with its
 * board per unit or award (`exam_entry`), the candidate carries the
 * identifiers the boards ask for (`exam_candidate`, a candidate number per
 * board series with its history), the series' timetable becomes each
 * candidate's own (papers, rooms, seats, invigilators, the boards'
 * attendance registers), results come back per unit and award keeping every
 * attempt, and certificates are received and collected once. Nothing here
 * takes or moves family money. The school's hard stop at a series' entry
 * deadline (MO-10, A-08) holds for entries as for registrations: no new
 * entry after it; a withdrawal after it is recorded with the board's fee.
 */

/**
 * Each board's rules for entries (staff-editable data, owner decision 3):
 * whether it needs forecast grades, a UCI or an option code, and what an
 * amendment or a withdrawal after its dates costs (shown, never charged).
 */
export const examBoardRule = pgTable(
  "exam_board_rule",
  {
    boardCode: text("board_code").primaryKey().references(() => examBoard.code, { onDelete: "cascade" }),
    forecastRequired: boolean("forecast_required").notNull().default(false),
    // Cambridge: a forecast grade cannot be changed once submitted.
    forecastLockedOnSubmit: boolean("forecast_locked_on_submit").notNull().default(false),
    optionCodeRequired: boolean("option_code_required").notNull().default(false),
    uciRequired: boolean("uci_required").notNull().default(false),
    // A candidate number is fixed once an entry in the series is submitted.
    candidateNumberFixed: boolean("candidate_number_fixed").notNull().default(true),
    // After the entry deadline: 'allowed_with_fee' | 'refused'.
    amendmentAfterDeadline: text("amendment_after_deadline").notNull().default("allowed_with_fee"),
    // From which of the series' dates an amendment costs the board's fee.
    amendmentFeeFrom: text("amendment_fee_from").notNull().default("entry_deadline"),
    amendmentFeeNote: text("amendment_fee_note"),
    // Up to which date a withdrawn entry is refunded by the board ('never': not at all).
    withdrawalRefundUntil: text("withdrawal_refund_until").notNull().default("entry_deadline"),
    withdrawalFeeNote: text("withdrawal_fee_note"),
    // Cambridge carries an AS result forward within 13 months; null: not by months.
    carryForwardMonths: integer("carry_forward_months"),
    // How the board's results file names a candidate: 'candidate_number' | 'uci'.
    resultsKey: text("results_key").notNull().default("candidate_number"),
    notes: text("notes"),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("exam_board_rule_amendment_valid", sql`${table.amendmentAfterDeadline} IN ('allowed_with_fee', 'refused')`),
    check("exam_board_rule_amendment_from_valid", sql`${table.amendmentFeeFrom} IN ('entry_deadline', 'late_fee_from', 'high_late_fee_from')`),
    check("exam_board_rule_refund_valid", sql`${table.withdrawalRefundUntil} IN ('entry_deadline', 'late_fee_from', 'high_late_fee_from', 'never')`),
    check("exam_board_rule_results_key_valid", sql`${table.resultsKey} IN ('candidate_number', 'uci')`),
    check("exam_board_rule_cf_months", sql`${table.carryForwardMonths} IS NULL OR ${table.carryForwardMonths} BETWEEN 1 AND 60`),
  ]
);

/**
 * A student as an exam candidate: the name as on their ID, date of birth and
 * gender the boards' entry files ask for, Pearson's UCI (permanent), and the
 * access arrangements the boards approved. The national ID or passport is in
 * `exam_candidate_identity`, which one service reads.
 */
export const examCandidate = pgTable(
  "exam_candidate",
  {
    studentId: text("student_id").primaryKey().references(() => user.id, { onDelete: "restrict" }),
    legalForenames: text("legal_forenames"),
    legalSurname: text("legal_surname"),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    // 'female' | 'male' — as the boards' files record it.
    gender: text("gender"),
    // Pearson's Unique Candidate Identifier: 13 characters, permanent.
    uci: text("uci"),
    // Approved access arrangements (extra time, reader, scribe…), their board reference and expiry.
    accessArrangements: jsonb("access_arrangements").$type<string[]>().notNull().default([]),
    accessArrangementsRef: text("access_arrangements_ref"),
    accessArrangementsUntil: date("access_arrangements_until", { mode: "string" }),
    notes: text("notes"),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("examCandidate_uci_idx").on(table.uci),
    check("exam_candidate_gender_valid", sql`${table.gender} IS NULL OR ${table.gender} IN ('female', 'male')`),
    check("exam_candidate_uci_shape", sql`${table.uci} IS NULL OR ${table.uci} ~ '^[0-9]{5}[0-9A-Z][0-9]{6}[0-9A-Z]$'`),
  ]
);

/**
 * The candidate's national ID or passport: sensitive. Read only by the roles
 * that need it (coordinator, admin) through one endpoint that audits each
 * read; never in a list, a log or an audit row.
 */
export const examCandidateIdentity = pgTable(
  "exam_candidate_identity",
  {
    studentId: text("student_id").primaryKey().references(() => user.id, { onDelete: "restrict" }),
    // 'national_id' | 'passport'
    documentType: text("document_type").notNull(),
    documentNumber: text("document_number").notNull(),
    recordedBy: text("recorded_by").references(() => user.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("examCandidateIdentity_document_idx").on(table.documentType, table.documentNumber),
    check("exam_candidate_identity_type_valid", sql`${table.documentType} IN ('national_id', 'passport')`),
  ]
);

/**
 * A candidate number per board series, with its history: Cambridge and
 * Pearson each give a four-digit number per series, fixed once entries are
 * made; the previous one is what a carry-forward or retake entry names.
 */
export const examCandidateNumber = pgTable(
  "exam_candidate_number",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "restrict" }),
    boardCode: text("board_code").notNull(),
    number: text("number").notNull(),
    // The centre it was issued under (the school's number for the board when assigned).
    centreNumber: text("centre_number"),
    // 'assigned' | 'manual' | 'import'
    source: text("source").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("examCandidateNumber_student_series_idx").on(table.studentId, table.boardSeriesId),
    uniqueIndex("examCandidateNumber_series_number_idx").on(table.boardSeriesId, table.number),
    check("exam_candidate_number_shape", sql`${table.number} ~ '^[0-9]{4}$'`),
    check("exam_candidate_number_source_valid", sql`${table.source} IN ('assigned', 'manual', 'import')`),
  ]
);

/**
 * One entry with a board: a unit (a Pearson W unit, a paper) or an award (a
 * Cambridge syllabus with its option code, a Pearson cash-in or International
 * GCSE) for one candidate in one board series — derived from a confirmed
 * registration through F0b's entryItemsFor, or added by the coordinator (a
 * cash-in with no unit sat). Status: draft → submitted → amended; any →
 * withdrawn. One live entry per candidate, series and unit or award.
 */
export const examEntry = pgTable(
  "exam_entry",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "restrict" }),
    boardCode: text("board_code").notNull(),
    registrationId: text("registration_id").references(() => registration.id, { onDelete: "restrict" }),
    // 'unit' | 'award'
    kind: text("kind").notNull(),
    unitId: text("unit_id").references(() => examUnit.id, { onDelete: "restrict" }),
    qualificationId: text("qualification_id").references(() => qualification.id, { onDelete: "restrict" }),
    // The board's code and title at entry (WMA11, XMA01, 0610), kept as entered.
    entryCode: text("entry_code").notNull(),
    title: text("title").notNull(),
    optionCode: text("option_code"),
    tier: text("tier"),
    // 'draft' | 'submitted' | 'amended' | 'withdrawn'
    status: text("status").notNull().default("draft"),
    isRetake: boolean("is_retake").notNull().default(false),
    // Why it is a retake: 'registration' | 'history' | 'staff'
    retakeSource: text("retake_source"),
    // Carry forward (DISCOVERY.md Q-02): 'none' | 'suggested' | 'confirmed', with the reference the board needs.
    carryForward: text("carry_forward").notNull().default("none"),
    cfFromMonth: text("cf_from_month"),
    cfFromYear: integer("cf_from_year"),
    cfCentreNumber: text("cf_centre_number"),
    cfCandidateNumber: text("cf_candidate_number"),
    cfOption: text("cf_option"),
    forecastGrade: text("forecast_grade"),
    forecastBy: text("forecast_by").references(() => user.id, { onDelete: "set null" }),
    forecastAt: timestamp("forecast_at", { withTimezone: true }),
    // The forecasts were sent to the board (Cambridge: fixed from then on).
    forecastLockedAt: timestamp("forecast_locked_at", { withTimezone: true }),
    // Null: the candidate's own arrangements apply.
    accessArrangements: jsonb("access_arrangements").$type<string[] | null>(),
    // The board's fee tier when the entry was submitted — information only.
    feeTierAtSubmission: text("fee_tier_at_submission"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedBy: text("submitted_by").references(() => user.id, { onDelete: "set null" }),
    amendedAt: timestamp("amended_at", { withTimezone: true }),
    amendedBy: text("amended_by").references(() => user.id, { onDelete: "set null" }),
    amendmentCount: integer("amendment_count").notNull().default(0),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: text("withdrawn_by").references(() => user.id, { onDelete: "set null" }),
    withdrawalReason: text("withdrawal_reason"),
    // What the board does with its fee, as the withdrawal was told (information only).
    withdrawalCharge: text("withdrawal_charge"),
    withdrawalRefunded: boolean("withdrawal_refunded"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("examEntry_studentId_idx").on(table.studentId),
    index("examEntry_boardSeriesId_idx").on(table.boardSeriesId),
    index("examEntry_registrationId_idx").on(table.registrationId),
    uniqueIndex("examEntry_one_live_unit_idx")
      .on(table.studentId, table.boardSeriesId, table.unitId)
      .where(sql`status <> 'withdrawn' AND unit_id IS NOT NULL`),
    uniqueIndex("examEntry_one_live_award_idx")
      .on(table.studentId, table.boardSeriesId, table.qualificationId)
      .where(sql`status <> 'withdrawn' AND qualification_id IS NOT NULL`),
    check("exam_entry_kind_valid", sql`${table.kind} IN ('unit', 'award')`),
    check("exam_entry_kind_target", sql`(${table.kind} = 'unit' AND ${table.unitId} IS NOT NULL AND ${table.qualificationId} IS NULL) OR (${table.kind} = 'award' AND ${table.qualificationId} IS NOT NULL AND ${table.unitId} IS NULL)`),
    check("exam_entry_status_valid", sql`${table.status} IN ('draft', 'submitted', 'amended', 'withdrawn')`),
    check("exam_entry_tier_valid", sql`${table.tier} IS NULL OR ${table.tier} IN ('core', 'extended', 'foundation', 'higher')`),
    check("exam_entry_cf_valid", sql`${table.carryForward} IN ('none', 'suggested', 'confirmed')`),
    check("exam_entry_submitted_whole", sql`${table.status} NOT IN ('submitted', 'amended') OR ${table.submittedAt} IS NOT NULL`),
    check("exam_entry_withdrawn_whole", sql`(${table.status} = 'withdrawn') = (${table.withdrawnAt} IS NOT NULL)`),
  ]
);

/** What F4 keeps per board series: when its timetable, forecasts and results went out. */
export const examSeriesState = pgTable("exam_series_state", {
  boardSeriesId: text("board_series_id").primaryKey().references(() => boardSeries.id, { onDelete: "cascade" }),
  timetablePublishedAt: timestamp("timetable_published_at", { withTimezone: true }),
  timetablePublishedBy: text("timetable_published_by").references(() => user.id, { onDelete: "set null" }),
  timetableVersion: integer("timetable_version").notNull().default(0),
  forecastsSubmittedAt: timestamp("forecasts_submitted_at", { withTimezone: true }),
  forecastsSubmittedBy: text("forecasts_submitted_by").references(() => user.id, { onDelete: "set null" }),
  resultsPublishedAt: timestamp("results_published_at", { withTimezone: true }),
  resultsPublishedBy: text("results_published_by").references(() => user.id, { onDelete: "set null" }),
});

/**
 * The board's timetable for a series: each paper (component) with its date,
 * session, start and duration. A paper belongs to a catalogue unit (the
 * component a candidate sits), or to an award with a tier when the board
 * lists the syllabus only.
 */
export const examPaper = pgTable(
  "exam_paper",
  {
    id: text("id").primaryKey(),
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "restrict" }),
    boardCode: text("board_code").notNull(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    unitId: text("unit_id").references(() => examUnit.id, { onDelete: "set null" }),
    qualificationId: text("qualification_id").references(() => qualification.id, { onDelete: "set null" }),
    tier: text("tier"),
    examDate: date("exam_date", { mode: "string" }).notNull(),
    // 'am' | 'pm' | 'ev'
    session: text("session").notNull(),
    startTime: text("start_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("examPaper_series_code_idx").on(table.boardSeriesId, table.code),
    index("examPaper_date_idx").on(table.examDate, table.session),
    index("examPaper_unitId_idx").on(table.unitId),
    check("exam_paper_session_valid", sql`${table.session} IN ('am', 'pm', 'ev')`),
    check("exam_paper_start_time", sql`${table.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check("exam_paper_duration", sql`${table.durationMinutes} BETWEEN 5 AND 480`),
    check("exam_paper_tier_valid", sql`${table.tier} IS NULL OR ${table.tier} IN ('core', 'extended', 'foundation', 'higher')`),
  ]
);

/** How a candidate's clash (two papers at once) is handled, noted by the coordinator. */
export const examClashNote = pgTable(
  "exam_clash_note",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    // The two papers, the smaller id first.
    paperAId: text("paper_a_id").notNull().references(() => examPaper.id, { onDelete: "cascade" }),
    paperBId: text("paper_b_id").notNull().references(() => examPaper.id, { onDelete: "cascade" }),
    resolution: text("resolution").notNull(),
    notedBy: text("noted_by").references(() => user.id, { onDelete: "set null" }),
    notedAt: timestamp("noted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("examClashNote_unique_idx").on(table.studentId, table.paperAId, table.paperBId),
    check("exam_clash_note_ordered", sql`${table.paperAId} < ${table.paperBId}`),
  ]
);

/** A room used for one exam sitting (a date and session), with its seat grid. */
export const examRoomSitting = pgTable(
  "exam_room_sitting",
  {
    id: text("id").primaryKey(),
    examDate: date("exam_date", { mode: "string" }).notNull(),
    session: text("session").notNull(),
    roomId: text("room_id").notNull().references(() => room.id, { onDelete: "restrict" }),
    seatRows: integer("seat_rows").notNull(),
    seatColumns: integer("seat_columns").notNull(),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("examRoomSitting_unique_idx").on(table.examDate, table.session, table.roomId),
    check("exam_room_sitting_session_valid", sql`${table.session} IN ('am', 'pm', 'ev')`),
    check("exam_room_sitting_grid", sql`${table.seatRows} BETWEEN 1 AND 26 AND ${table.seatColumns} BETWEEN 1 AND 40`),
  ]
);

/**
 * A candidate's seat in one sitting: every paper they sit in that session is
 * sat there. No seat holds two candidates and no candidate has two seats in
 * one sitting (the two unique indexes).
 */
export const examSeat = pgTable(
  "exam_seat",
  {
    id: text("id").primaryKey(),
    examDate: date("exam_date", { mode: "string" }).notNull(),
    session: text("session").notNull(),
    roomId: text("room_id").notNull().references(() => room.id, { onDelete: "restrict" }),
    seatLabel: text("seat_label").notNull(),
    studentId: text("student_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    assignedBy: text("assigned_by").references(() => user.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("examSeat_seat_idx").on(table.examDate, table.session, table.roomId, table.seatLabel),
    uniqueIndex("examSeat_student_idx").on(table.examDate, table.session, table.studentId),
    check("exam_seat_session_valid", sql`${table.session} IN ('am', 'pm', 'ev')`),
    check("exam_seat_label_shape", sql`${table.seatLabel} ~ '^[A-Z][0-9]{1,2}$'`),
  ]
);

/** An invigilator in a room for a sitting; one room per invigilator per sitting. */
export const examInvigilation = pgTable(
  "exam_invigilation",
  {
    id: text("id").primaryKey(),
    examDate: date("exam_date", { mode: "string" }).notNull(),
    session: text("session").notNull(),
    roomId: text("room_id").notNull().references(() => room.id, { onDelete: "restrict" }),
    teacherId: text("teacher_id").notNull().references(() => teacher.id, { onDelete: "restrict" }),
    isLead: boolean("is_lead").notNull().default(false),
    assignedBy: text("assigned_by").references(() => user.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("examInvigilation_teacher_idx").on(table.examDate, table.session, table.teacherId),
    index("examInvigilation_room_idx").on(table.examDate, table.session, table.roomId),
    check("exam_invigilation_session_valid", sql`${table.session} IN ('am', 'pm', 'ev')`),
  ]
);

/** The board's attendance register, as marked in the room: one row per candidate and paper. */
export const examAttendance = pgTable(
  "exam_attendance",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id").notNull().references(() => examPaper.id, { onDelete: "restrict" }),
    studentId: text("student_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    // 'present' | 'absent' | 'late'
    status: text("status").notNull(),
    minutesLate: integer("minutes_late"),
    note: text("note"),
    recordedBy: text("recorded_by").references(() => user.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("examAttendance_unique_idx").on(table.paperId, table.studentId),
    check("exam_attendance_status_valid", sql`${table.status} IN ('present', 'absent', 'late')`),
    check("exam_attendance_late_minutes", sql`${table.status} <> 'late' OR ${table.minutesLate} > 0`),
  ]
);

/** Special consideration asked of the board for a candidate (illness, bereavement, a disturbance). */
export const examSpecialConsideration = pgTable(
  "exam_special_consideration",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "restrict" }),
    paperId: text("paper_id").references(() => examPaper.id, { onDelete: "set null" }),
    // 'illness' | 'bereavement' | 'accident' | 'disturbance' | 'other'
    category: text("category").notNull(),
    description: text("description").notNull(),
    // Evidence kept for the board: RESTRICT, as with payment and remark evidence (RF-13).
    evidenceFileId: text("evidence_file_id").references(() => file.id, { onDelete: "restrict" }),
    // 'draft' | 'submitted' | 'outcome_received'
    status: text("status").notNull().default("draft"),
    boardReference: text("board_reference"),
    outcome: text("outcome"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("examSpecialConsideration_student_idx").on(table.studentId),
    index("examSpecialConsideration_series_idx").on(table.boardSeriesId),
    check("exam_special_consideration_category_valid", sql`${table.category} IN ('illness', 'bereavement', 'accident', 'disturbance', 'other')`),
    check("exam_special_consideration_status_valid", sql`${table.status} IN ('draft', 'submitted', 'outcome_received')`),
  ]
);

/** One import of a board's results file: what was read, with which mapping. */
export const examResultImport = pgTable(
  "exam_result_import",
  {
    id: text("id").primaryKey(),
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "restrict" }),
    boardCode: text("board_code").notNull(),
    fileId: text("file_id").references(() => file.id, { onDelete: "set null" }),
    sourceName: text("source_name").notNull(),
    mapping: jsonb("mapping").$type<Record<string, unknown>>().notNull(),
    rowCount: integer("row_count").notNull(),
    resultCount: integer("result_count").notNull(),
    unmatchedCount: integer("unmatched_count").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("examResultImport_series_idx").on(table.boardSeriesId)]
);

/**
 * A result as the board reported it: per unit (W unit, component) or award
 * (cash-in, syllabus), per candidate and series. Every attempt is its own
 * row (a series each), and a board's later report of the same attempt with
 * another grade is a new row beside the first: nothing is overwritten, and
 * which grade is of record after a remark stays the owner's question
 * (FOUNDATION_AUDIT.md RF-09).
 */
export const examResult = pgTable(
  "exam_result",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "restrict" }),
    boardCode: text("board_code").notNull(),
    // 'unit' | 'award'
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    unitId: text("unit_id").references(() => examUnit.id, { onDelete: "set null" }),
    qualificationId: text("qualification_id").references(() => qualification.id, { onDelete: "set null" }),
    entryId: text("entry_id").references(() => examEntry.id, { onDelete: "set null" }),
    grade: text("grade").notNull(),
    mark: numeric("mark", { precision: 7, scale: 2, mode: "number" }),
    maxMark: numeric("max_mark", { precision: 7, scale: 2, mode: "number" }),
    // 'import' | 'manual'
    source: text("source").notNull(),
    importId: text("import_id").references(() => examResultImport.id, { onDelete: "set null" }),
    // 'provisional' | 'published'
    status: text("status").notNull().default("provisional"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("examResult_student_idx").on(table.studentId),
    index("examResult_series_idx").on(table.boardSeriesId),
    index("examResult_key_idx").on(table.studentId, table.boardSeriesId, table.kind, table.code),
    check("exam_result_kind_valid", sql`${table.kind} IN ('unit', 'award')`),
    check("exam_result_source_valid", sql`${table.source} IN ('import', 'manual')`),
    check("exam_result_status_valid", sql`${table.status} IN ('provisional', 'published')`),
    check("exam_result_published_whole", sql`(${table.status} = 'published') = (${table.publishedAt} IS NOT NULL)`),
  ]
);

/** A saved column mapping for a board's results file, so the next import is one click. */
export const examResultMapping = pgTable(
  "exam_result_mapping",
  {
    id: text("id").primaryKey(),
    boardCode: text("board_code").notNull(),
    name: text("name").notNull(),
    mapping: jsonb("mapping").$type<Record<string, unknown>>().notNull(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("examResultMapping_name_idx").on(table.boardCode, table.name)]
);

/**
 * A candidate's certificate from a board for a series: received, then
 * collected once (by the candidate or someone they send, who signs the slip),
 * or — unclaimed past the board's retention period — returned or destroyed.
 */
export const examCertificate = pgTable(
  "exam_certificate",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "restrict" }),
    boardCode: text("board_code").notNull(),
    description: text("description").notNull(),
    // 'received' | 'collected' | 'returned_to_board' | 'destroyed'
    status: text("status").notNull().default("received"),
    receivedOn: date("received_on", { mode: "string" }).notNull(),
    receivedBy: text("received_by").references(() => user.id, { onDelete: "set null" }),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    collectedBy: text("collected_by").references(() => user.id, { onDelete: "set null" }),
    collectorName: text("collector_name"),
    // 'candidate' | 'parent' | 'other'
    collectorRelation: text("collector_relation"),
    collectorIdChecked: text("collector_id_checked"),
    // The signed collection slip, scanned (RESTRICT: evidence, RF-13).
    signatureFileId: text("signature_file_id").references(() => file.id, { onDelete: "restrict" }),
    disposedAt: timestamp("disposed_at", { withTimezone: true }),
    disposedBy: text("disposed_by").references(() => user.id, { onDelete: "set null" }),
    disposalReason: text("disposal_reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("examCertificate_student_series_idx").on(table.studentId, table.boardSeriesId),
    index("examCertificate_status_idx").on(table.status),
    check("exam_certificate_status_valid", sql`${table.status} IN ('received', 'collected', 'returned_to_board', 'destroyed')`),
    check("exam_certificate_collected_whole", sql`(${table.status} = 'collected') = (${table.collectedAt} IS NOT NULL AND ${table.collectorName} IS NOT NULL)`),
    check("exam_certificate_relation_valid", sql`${table.collectorRelation} IS NULL OR ${table.collectorRelation} IN ('candidate', 'parent', 'other')`),
    check("exam_certificate_disposed_whole", sql`(${table.status} IN ('returned_to_board', 'destroyed')) = (${table.disposedAt} IS NOT NULL)`),
  ]
);

/**
 * A deadline reminder sent: the scheduler claims (series, date field, the
 * date, days before) by inserting it, so a second instance on the same tick
 * sends nothing (STATE_AUDIT.md ST-06, ST-12); a moved date reminds again.
 */
export const examDeadlineReminder = pgTable(
  "exam_deadline_reminder",
  {
    boardSeriesId: text("board_series_id").notNull().references(() => boardSeries.id, { onDelete: "cascade" }),
    dateField: text("date_field").notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    daysBefore: integer("days_before").notNull(),
    recipients: integer("recipients").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.boardSeriesId, table.dateField, table.dueOn, table.daysBefore] })]
);

export const examCandidateRelations = relations(examCandidate, ({ one }) => ({
  student: one(user, { fields: [examCandidate.studentId], references: [user.id] }),
}));

export const examEntryRelations = relations(examEntry, ({ one }) => ({
  student: one(user, { fields: [examEntry.studentId], references: [user.id] }),
  boardSeries: one(boardSeries, { fields: [examEntry.boardSeriesId], references: [boardSeries.id] }),
  registration: one(registration, { fields: [examEntry.registrationId], references: [registration.id] }),
  unit: one(examUnit, { fields: [examEntry.unitId], references: [examUnit.id] }),
  qualification: one(qualification, { fields: [examEntry.qualificationId], references: [qualification.id] }),
}));

export const examPaperRelations = relations(examPaper, ({ one }) => ({
  boardSeries: one(boardSeries, { fields: [examPaper.boardSeriesId], references: [boardSeries.id] }),
  unit: one(examUnit, { fields: [examPaper.unitId], references: [examUnit.id] }),
  qualification: one(qualification, { fields: [examPaper.qualificationId], references: [qualification.id] }),
}));

export const examResultRelations = relations(examResult, ({ one }) => ({
  student: one(user, { fields: [examResult.studentId], references: [user.id] }),
  boardSeries: one(boardSeries, { fields: [examResult.boardSeriesId], references: [boardSeries.id] }),
  entry: one(examEntry, { fields: [examResult.entryId], references: [examEntry.id] }),
}));

export const examCertificateRelations = relations(examCertificate, ({ one }) => ({
  student: one(user, { fields: [examCertificate.studentId], references: [user.id] }),
  boardSeries: one(boardSeries, { fields: [examCertificate.boardSeriesId], references: [boardSeries.id] }),
}));
