/**
 * Teacher Service (V3 §6.7)
 *
 * Teachers are data-only profiles managed by admins. No auth accounts.
 */

import { db, teacher, eq } from '@repo/db';
import { randomUUID } from 'crypto';
import type { CreateTeacherType, UpdateTeacherType, ListTeachersQueryType } from '@repo/validations';

export async function createTeacher(data: CreateTeacherType) {
  const [created] = await db
    .insert(teacher)
    .values({
      id: randomUUID(),
      name: data.name,
      phone: data.phone ?? null,
      email: data.email ?? null,
      isActive: true,
    })
    .returning();
  return created;
}

export async function updateTeacher(id: string, data: UpdateTeacherType) {
  const [updated] = await db
    .update(teacher)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(teacher.id, id))
    .returning();
  return updated;
}

export async function getTeachers(filters?: ListTeachersQueryType) {
  return db.query.teacher.findMany({
    where: (t, { eq, and, ilike }) => {
      const conditions = [];
      if (filters?.isActive !== undefined) conditions.push(eq(t.isActive, filters.isActive));
      if (filters?.search) conditions.push(ilike(t.name, `%${filters.search}%`));
      return conditions.length > 0 ? and(...conditions) : undefined;
    },
    with: {
      subjectTeachers: {
        with: { subject: { columns: { id: true, name: true, code: true } } },
      },
    },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
}

export async function getTeacherById(id: string) {
  return db.query.teacher.findFirst({
    where: (t, { eq }) => eq(t.id, id),
    with: {
      subjectTeachers: {
        with: { subject: { columns: { id: true, name: true, code: true } } },
      },
    },
  });
}

/**
 * Soft-deactivate — existing registrations keep their teacherId; the
 * teacher just stops appearing in pickers.
 */
export async function deactivateTeacher(id: string) {
  const [updated] = await db
    .update(teacher)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(teacher.id, id))
    .returning();
  return updated;
}
