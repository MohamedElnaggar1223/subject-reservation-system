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

import { db, subject, subjectTeacher, subjectUnit, eq, and, or, ilike } from '@repo/db';
import { applyBoardChange, lockStudentsOfSubject, tellBoardChangePrices } from './catalogue.services';
import { withStudentsFirst } from '../lib/student-locks';
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
      qualificationLevel: data.qualificationLevel ?? 'igcse',
      courseFee: data.courseFee,
      registrationFee: data.registrationFee,
      // Legacy column kept in sync so pre-V3 readers stay coherent
      priceInSchool: data.courseFee + data.registrationFee,
      isOfferedAtSchool: data.isOfferedAtSchool ?? true,
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
  qualificationLevel?: string;
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

      if (filters?.qualificationLevel) {
        conditions.push(eq(s.qualificationLevel, filters.qualificationLevel));
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
export async function updateSubject(id: string, data: UpdateSubjectType, actorId?: string) {
  let repriced: Awaited<ReturnType<typeof applyBoardChange>>['repriced'] = [];
  const updatedRow = await withStudentsFirst((extra) => db.transaction(async (tx) => {
    // A board change moves lines into series: their students before the subject (§6).
    const locked = data.council ? await lockStudentsOfSubject(tx, id, extra) : new Set<string>();
    const [current] = await tx.select().from(subject).where(eq(subject.id, id)).for('update');
    if (!current) return undefined;

    // Keep the legacy single-price column in sync with the fee split
    const mergedCourseFee = data.courseFee ?? current.courseFee;
    const mergedRegistrationFee = data.registrationFee ?? current.registrationFee;

    // F0b: a new board moves the subject's live registrations to their
    // windows' series of that board (or is refused, naming why), and clears
    // the old board's catalogue links (catalogue.services.ts applyBoardChange).
    const { council, ...rest } = data;
    if (council && council !== current.council) {
      repriced = (await applyBoardChange(tx, current, council, actorId ?? null, locked)).repriced;
    }
    // A new level no longer fits the old award and units: they are cleared,
    // for the Catalogue screen to map again.
    const levelChanged = data.qualificationLevel && data.qualificationLevel !== current.qualificationLevel;
    if (levelChanged) await tx.delete(subjectUnit).where(eq(subjectUnit.subjectId, id));

    const [updated] = await tx
      .update(subject)
      .set({
        ...rest,
        ...(levelChanged ? { qualificationId: null } : {}),
        priceInSchool: mergedCourseFee + mergedRegistrationFee,
        updatedAt: new Date(),
      })
      .where(eq(subject.id, id))
      .returning();

    return updated;
  }));
  await tellBoardChangePrices(repriced);
  return updatedRow;
}

/**
 * Replace the set of teachers linked to a subject (V3 §6.7).
 * Delete-then-insert inside a transaction; an empty list unlinks all.
 */
export async function setSubjectTeachers(subjectId: string, teacherIds: string[]) {
  if (teacherIds.length > 0) {
    const teachers = await db.query.teacher.findMany({
      where: (t, { inArray }) => inArray(t.id, teacherIds),
      columns: { id: true },
    });
    if (teachers.length !== new Set(teacherIds).size) {
      throw new Error('One or more teacher IDs are invalid');
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(subjectTeacher).where(eq(subjectTeacher.subjectId, subjectId));
    if (teacherIds.length > 0) {
      await tx.insert(subjectTeacher).values(
        [...new Set(teacherIds)].map((teacherId) => ({
          id: randomUUID(),
          subjectId,
          teacherId,
        }))
      );
    }
  });

  return getSubjectTeachers(subjectId);
}

/**
 * List the active teachers linked to a subject.
 *
 * Explicit return type: the drizzle relational inference chained through
 * Hono RPC + JSONParsed exceeds TS instantiation depth in the web
 * compile and silently degrades the client type — a concrete type here
 * short-circuits that.
 */
export type SubjectTeacherRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function getSubjectTeachers(subjectId: string): Promise<SubjectTeacherRow[]> {
  const links = await db.query.subjectTeacher.findMany({
    where: (st, { eq }) => eq(st.subjectId, subjectId),
    with: { teacher: true },
  });
  return links.map((l) => l.teacher);
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
