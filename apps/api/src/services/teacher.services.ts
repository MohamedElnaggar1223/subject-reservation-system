/**
 * Teacher Service (V3 §6.7, F0a)
 *
 * A teacher record is the person who teaches. Since F0a it can be linked to
 * one staff account (teacher.userId): teaching is a capability, so any staff
 * role that is linked gets the teacher screens for their own lessons, and a
 * `teacher` account is always linked.
 */

import { db, teacher, user, eq, gradeTodayExtras } from '@repo/db';
import { randomUUID } from 'crypto';
import { STAFF_ROLES, ROLES, academicYearStartOf, type CreateTeacherType, type UpdateTeacherType, type ListTeachersQueryType } from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class TeacherError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

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
      account: { columns: { id: true, name: true, email: true, role: true } },
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
      account: { columns: { id: true, name: true, email: true, role: true } },
    },
  });
}

/**
 * Link a teacher record to a staff account, or unlink it (userId null), in
 * the caller's transaction or its own. One account per record and one record
 * per account (the database's unique index). A `teacher` account cannot be
 * left without its record: change its role first.
 */
export async function linkTeacherAccount(
  teacherId: string,
  userId: string | null,
  actorId: string,
  ctx?: AuditContext,
  executor?: Tx,
) {
  const run = async (tx: Tx) => {
    const [t] = await tx.select().from(teacher).where(eq(teacher.id, teacherId)).for('update');
    if (!t) throw new TeacherError('Teacher not found', 404);
    if (t.userId === userId) return t;
    if (userId) {
      const [u] = await tx.select({ id: user.id, name: user.name, role: user.role }).from(user).where(eq(user.id, userId));
      if (!u) throw new TeacherError('Account not found', 404);
      if (!(STAFF_ROLES as readonly string[]).includes(u.role ?? '')) {
        throw new TeacherError(`${u.name} is not a member of staff: only staff accounts teach`);
      }
      const [other] = await tx.select({ name: teacher.name }).from(teacher).where(eq(teacher.userId, userId));
      if (other) throw new TeacherError(`${u.name} already teaches as ${other.name}`, 409);
    }
    if (t.userId) {
      const [prev] = await tx.select({ name: user.name, role: user.role }).from(user).where(eq(user.id, t.userId));
      if (prev?.role === ROLES.TEACHER) {
        throw new TeacherError(`${prev.name} has the teacher role, which needs this record: change their role first`, 409);
      }
    }
    const [updated] = await tx.update(teacher).set({ userId, updatedAt: new Date() }).where(eq(teacher.id, teacherId)).returning()
      .catch((err) => {
        if ((err as { cause?: { code?: string } } | null)?.cause?.code === '23505') throw new TeacherError('That account already teaches as another teacher', 409);
        throw err;
      });
    await logAction(actorId, 'TEACHER_ACCOUNT_LINKED', 'teacher', teacherId, { userId: t.userId }, { userId }, ctx, tx);
    return updated!;
  };
  return executor ? run(executor) : db.transaction(run);
}

/** Create a teacher record for a staff account and link it (the Team page's "create one"). */
export async function createTeacherForAccount(tx: Tx, account: { id: string; name: string; email: string }, actorId: string, ctx?: AuditContext) {
  const [created] = await tx.insert(teacher).values({
    id: randomUUID(), name: account.name, email: account.email, isActive: true, userId: account.id,
  }).returning();
  await logAction(actorId, 'TEACHER_CREATED', 'teacher', created!.id, null, created as Record<string, unknown>, ctx, tx);
  await logAction(actorId, 'TEACHER_ACCOUNT_LINKED', 'teacher', created!.id, { userId: null }, { userId: account.id }, ctx, tx);
  return created!;
}

/**
 * The teacher capability for the signed-in account (F0a): the record they
 * teach as, the subjects it teaches, and the homeroom sections they lead
 * this academic year with their students. Later features add the
 * timetable (F1) and registers (F3) here.
 */
export async function getTeachingFor(userId: string) {
  const t = await db.query.teacher.findFirst({
    where: (x, { eq: eqOp }) => eqOp(x.userId, userId),
    with: { subjectTeachers: { with: { subject: { columns: { id: true, name: true, code: true, qualificationLevel: true } } } } },
  });
  if (!t) return null;
  const current = academicYearStartOf();
  const sections = await db.query.section.findMany({
    where: (s, { eq: eqOp }) => eqOp(s.homeroomTeacherId, t.id),
    with: {
      academicYear: { columns: { id: true, startYear: true } },
      room: { columns: { id: true, name: true } },
      memberships: {
        where: (m, { isNull: isNullOp }) => isNullOp(m.endedOn),
        with: { student: { columns: { id: true, name: true, studentId: true, cohortYear: true, leftOn: true }, extras: gradeTodayExtras } },
      },
    },
    orderBy: (s, { asc }) => [asc(s.name)],
  });
  return {
    teacher: { id: t.id, name: t.name, isActive: t.isActive },
    subjects: t.subjectTeachers.map((st) => st.subject),
    homeroomSections: sections
      .filter((s) => s.academicYear.startYear === current)
      .map((s) => ({
        id: s.id, name: s.name, grade: s.grade, room: s.room,
        students: s.memberships.map((m) => m.student).sort((a, b) => a.name.localeCompare(b.name)),
      })),
  };
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
