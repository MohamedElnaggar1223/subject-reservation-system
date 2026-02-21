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

import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, index, numeric, integer } from "drizzle-orm/pg-core";

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

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

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
 * TODO TABLE
 *
 * EXAMPLE: Demonstrates a typical application table with:
 * - Primary key (id)
 * - User relationship (userId with cascade delete)
 * - Timestamps (createdAt, updatedAt with auto-update)
 * - Index on foreign key for query performance
 * - Nullable text field (description)
 * - Boolean field with default (completed)
 *
 * This is a reference implementation - feel free to modify or remove.
 */
export const todo = pgTable(
  "todo",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    completed: boolean("completed").default(false).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Index on userId for efficient user-scoped queries
    index("todo_userId_idx").on(table.userId),
  ],
);

/**
 * TODO RELATIONS
 *
 * Defines relationships for type-safe joins:
 * - Each todo belongs to one user
 * - Each user can have many todos
 */
export const todoRelations = relations(todo, ({ one }) => ({
  user: one(user, {
    fields: [todo.userId],
    references: [user.id],
  }),
}));

/**
 * FILE TABLE
 *
 * Stores metadata for uploaded files with support for variants.
 * Tracks ownership, type, and storage location.
 *
 * Pattern: Similar to todo table with user relationship
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

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Index on userId for efficient user-scoped queries
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

    createdAt: timestamp("created_at").defaultNow().notNull(),
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

// Update user relations to include todos and files
export const userRelationsExtended = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  todos: many(todo),
  files: many(file),
  // Parent-Student Link Relations
  linkRequestsAsParent: many(parentStudentLink, { relationName: "parentLinks" }),
  linkRequestsAsStudent: many(parentStudentLink, { relationName: "studentLinks" }),
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
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    // When the student responded (approved/rejected)
    respondedAt: timestamp("responded_at"),
    // Standard timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Indexes for efficient queries
    index("parentStudentLink_parentId_idx").on(table.parentId),
    index("parentStudentLink_studentId_idx").on(table.studentId),
    index("parentStudentLink_status_idx").on(table.status),
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
