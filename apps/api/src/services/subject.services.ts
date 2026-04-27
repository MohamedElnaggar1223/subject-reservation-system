/**
 * Subject Service
 *
 * Business logic for all subject management operations:
 * - CRUD for subjects (admin)
 * - Browsing subjects (all authenticated users)
 * - Core subject designation (admin)
 *
 * All database imports come from @repo/db — never from drizzle-orm directly.
 */

import { db, subject, eq, and, or, ilike } from '@repo/db';
import { randomUUID } from 'crypto';
import type { CreateSubjectType, UpdateSubjectType } from '@repo/validations';

/**
 * Check whether a subject code is already taken.
 * Optionally excludes a specific subject ID (for update validation).
 */
export async function isCodeUnique(code: string, excludeId?: string): Promise<boolean> {
  const existing = await db.query.subject.findFirst({
    where: excludeId
      ? (s, { eq, and, ne }) => and(eq(s.code, code), ne(s.id, excludeId))
      : (s, { eq }) => eq(s.code, code),
    columns: { id: true },
  });

  return !existing;
}

/**
 * Check whether a subject exists by ID.
 */
export async function subjectExists(id: string): Promise<boolean> {
  const existing = await db.query.subject.findFirst({
    where: (s, { eq }) => eq(s.id, id),
    columns: { id: true },
  });

  return !!existing;
}

/**
 * Create a new subject.
 *
 * Admin-only operation.
 * Returns the created subject.
 */
export async function createSubject(data: CreateSubjectType) {
  const id = randomUUID();

  const [created] = await db
    .insert(subject)
    .values({
      id,
      name: data.name,
      code: data.code,
      council: data.council,
      priceInSchool: data.priceInSchool,
      isOfferedAtSchool: data.isOfferedAtSchool ?? true,
      customPrice: data.customPrice ?? null,
      isCore: data.isCore ?? false,
      isActive: true,
    })
    .returning();

  return created;
}

/**
 * Get a list of subjects with optional filters.
 *
 * Non-admin users should always have isActive forced to true.
 * Admin users can optionally filter by isActive to see deactivated subjects.
 */
export async function getSubjects(filters?: {
  council?: string;
  search?: string;
  isActive?: boolean;
  isCore?: boolean;
}) {
  return db.query.subject.findMany({
    where: (s, { eq, and, or, ilike }) => {
      const conditions = [];

      if (filters?.council) {
        conditions.push(eq(s.council, filters.council));
      }

      if (filters?.isActive !== undefined) {
        conditions.push(eq(s.isActive, filters.isActive));
      }

      if (filters?.isCore !== undefined) {
        conditions.push(eq(s.isCore, filters.isCore));
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        conditions.push(or(ilike(s.name, term), ilike(s.code, term)));
      }

      return conditions.length > 0 ? and(...conditions) : undefined;
    },
    orderBy: (s, { asc }) => [asc(s.name)],
  });
}

/**
 * Get a single subject by ID.
 * Returns undefined if not found.
 */
export async function getSubjectById(id: string) {
  return db.query.subject.findFirst({
    where: (s, { eq }) => eq(s.id, id),
  });
}

/**
 * Update an existing subject.
 *
 * Admin-only operation.
 * Only updates the fields provided (partial update).
 * Reads the current state first and validates that the merged result
 * does not create an invalid state (e.g. non-school subject without customPrice).
 * Returns the updated subject or undefined if not found.
 */
export async function updateSubject(id: string, data: UpdateSubjectType) {
  // Read current state to validate merged result
  const current = await db.query.subject.findFirst({
    where: (s, { eq }) => eq(s.id, id),
  });

  if (!current) return undefined;

  // Merge current state with partial update
  const merged = {
    isOfferedAtSchool: data.isOfferedAtSchool ?? current.isOfferedAtSchool,
    customPrice: data.customPrice !== undefined ? data.customPrice : current.customPrice,
  };

  // Post-merge validation: if the merged subject is not offered at school,
  // it must have a non-null customPrice
  if (!merged.isOfferedAtSchool && (merged.customPrice === null || merged.customPrice === undefined)) {
    throw new Error('Custom price is required when subject is not offered at school');
  }

  const [updated] = await db
    .update(subject)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(subject.id, id))
    .returning();

  return updated;
}

/**
 * Deactivate a subject (soft delete).
 *
 * Admin-only operation.
 * The subject remains in the database and existing registrations are unaffected.
 * Returns the updated subject or undefined if not found.
 */
export async function deactivateSubject(id: string) {
  const [updated] = await db
    .update(subject)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(subject.id, id))
    .returning();

  return updated;
}

/**
 * Reactivate a previously deactivated subject.
 *
 * Admin-only operation.
 * Returns the updated subject or undefined if not found.
 */
export async function activateSubject(id: string) {
  const [updated] = await db
    .update(subject)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(subject.id, id))
    .returning();

  return updated;
}

/**
 * Set the core designation for a subject.
 *
 * Admin-only operation.
 * Core subjects are mandatory for Grade 10 students in the June session.
 * Returns the updated subject or undefined if not found.
 */
export async function setSubjectCore(id: string, isCore: boolean) {
  const [updated] = await db
    .update(subject)
    .set({ isCore, updatedAt: new Date() })
    .where(eq(subject.id, id))
    .returning();

  return updated;
}
