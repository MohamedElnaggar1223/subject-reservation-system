/**
 * Exception Service (V3 §6.3)
 *
 * Grant/revoke plus the four enforcement hooks:
 * 1. Pricing        — custom_price / discount_percent / discount_fixed
 * 2. Window checks  — deadline_extension / late_registration treat a
 *                     closed window as open for one student
 * 3. School-fee gate — fee_waiver
 * 4. Refund percent — custom_refund_percent overrides refund windows
 */

import { db, exception, user, registrationSession, eq, and, inArray, gradeTodayExtras } from '@repo/db';
import { randomUUID } from 'crypto';
import {
  EXCEPTION_GRANT_ROLES, EXCEPTION_TYPE_LABELS, exceptionTypesGrantableBy, hasRole,
  academicYearStartOf, gradeInAcademicYear, seriesAcademicYearStart, seriesLabel,
  type CreateExceptionType, type ListExceptionsQueryType, type ExceptionType, type Role,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { expireIneligibleRegistrations } from './eligibility.services';

export class ExceptionError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

function assertMayGrant(type: ExceptionType, role: string | null | undefined, verb: 'grant' | 'revoke') {
  const roles = EXCEPTION_GRANT_ROLES[type];
  if (!hasRole(role, ...(roles as readonly Role[]))) {
    throw new ExceptionError(
      `Only ${roles.map((r) => r.replace(/_/g, ' ')).join(' or ')} may ${verb} "${EXCEPTION_TYPE_LABELS[type]}"`,
      403,
    );
  }
}

/**
 * The grade-10 exception is for a student who is in grade 10 in the series
 * it names (or, with no series, in grade 10 this academic year or starting
 * next): a series they may sit anyway needs no exception.
 */
async function assertGrade10ExceptionFits(studentId: string, sessionId: string | null | undefined) {
  const [s] = await db.select({ name: user.name, cohortYear: user.cohortYear }).from(user).where(eq(user.id, studentId));
  if (!s) throw new ExceptionError('Student not found', 404);
  if (sessionId) {
    const [sess] = await db.select({ sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear })
      .from(registrationSession).where(eq(registrationSession.id, sessionId));
    if (!sess) throw new ExceptionError('Session not found', 404);
    if (sess.sessionType === 'june') throw new ExceptionError('Grade 10 already sits the June series: no exception is needed');
    const grade = gradeInAcademicYear(s.cohortYear, seriesAcademicYearStart(sess.sessionType, sess.seriesYear));
    if (grade !== 10) {
      throw new ExceptionError(`${s.name} is not in grade 10 for the ${seriesLabel(sess.sessionType, sess.seriesYear)} series: no exception is needed`);
    }
    return;
  }
  const now = academicYearStartOf();
  const grade = gradeInAcademicYear(s.cohortYear, now);
  if (grade !== 10 && grade !== 9) {
    throw new ExceptionError(`${s.name} is not in grade 10 this year or next: no exception is needed`);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Management ──────────────────────────────────────────────────────────────

/**
 * Grant an exception. Each type names the roles that may grant it
 * (EXCEPTION_GRANT_ROLES, F0a): money exceptions are the finance admin's,
 * the grade-10 exception the coordinator's; admin may grant any. The grant
 * and its audit row commit together.
 */
export async function grantException(data: CreateExceptionType, actor: { id: string; role: string | null | undefined }, ctx?: AuditContext) {
  assertMayGrant(data.type, actor.role, 'grant');
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, data.studentId),
    columns: { id: true, role: true },
  });
  if (!student || student.role !== 'student') {
    throw new ExceptionError('Exceptions can only be granted to students');
  }
  if (data.type === 'grade10_other_series') await assertGrade10ExceptionFits(data.studentId, data.sessionId);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(exception)
      .values({
        id: randomUUID(),
        type: data.type,
        studentId: data.studentId,
        sessionId: data.sessionId ?? null,
        subjectId: data.subjectId ?? null,
        value: data.value ?? null,
        reason: data.reason,
        validUntil: data.validUntil ?? null,
        status: 'active',
        grantedBy: actor.id,
      })
      .returning();
    await logAction(actor.id, 'EXCEPTION_GRANTED', 'exception', created!.id, null, created as Record<string, unknown>, ctx, tx);
    return created!;
  });
}

/**
 * Revoke an exception — by a role that may grant its type. Revoking a
 * grade-10 exception is an eligibility change (F0a): the waiting
 * registrations it allowed expire in the same transaction, and the caller
 * closes their open checkouts after it commits.
 */
export async function revokeException(id: string, actor: { id: string; role: string | null | undefined }, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(exception).where(eq(exception.id, id)).for('update');
    if (!row || row.status !== 'active') throw new ExceptionError('Exception not found or already revoked', 404);
    assertMayGrant(row.type as ExceptionType, actor.role, 'revoke');
    const now = new Date();
    const [updated] = await tx
      .update(exception)
      .set({ status: 'revoked', revokedBy: actor.id, revokedAt: now, updatedAt: now })
      .where(and(eq(exception.id, id), eq(exception.status, 'active')))
      .returning();
    await logAction(actor.id, 'EXCEPTION_REVOKED', 'exception', id, { status: 'active' }, updated as Record<string, unknown>, ctx, tx);
    const expired = row.type === 'grade10_other_series'
      ? await expireIneligibleRegistrations(tx, { studentIds: [row.studentId], ...(row.sessionId ? { sessionIds: [row.sessionId] } : {}) }, 'exception_revoked', now)
      : [];
    return { exception: updated!, expired };
  });
}

/** Exceptions of the types the caller may grant (a coordinator sees the grade-10 ones only). */
export async function getExceptions(filters: ListExceptionsQueryType | undefined, role: string | null | undefined) {
  const types = exceptionTypesGrantableBy(role);
  return db.query.exception.findMany({
    where: (e, { eq, and }) => {
      const conditions = [inArray(e.type, types.length ? types : ['__none__'])];
      if (filters?.studentId) conditions.push(eq(e.studentId, filters.studentId));
      if (filters?.status) conditions.push(eq(e.status, filters.status));
      if (filters?.type) conditions.push(eq(e.type, filters.type));
      return and(...conditions);
    },
    with: {
      student: { columns: { id: true, name: true, email: true, cohortYear: true }, extras: gradeTodayExtras },
      session: { columns: { id: true, name: true } },
      subject: { columns: { id: true, name: true, code: true } },
    },
    orderBy: (e, { desc }) => [desc(e.createdAt)],
  });
}

// ─── Enforcement helpers ─────────────────────────────────────────────────────

/**
 * Active, unexpired exceptions of the given types matching the scope.
 * A null sessionId/subjectId on the exception means "applies to all".
 */
export async function getActiveExceptions(
  studentId: string,
  types: string[],
  scope: { sessionId?: string; subjectId?: string } = {},
  executor: Pick<typeof db, 'query'> = db
) {
  const now = new Date();
  const rows = await executor.query.exception.findMany({
    where: (e, { eq, and, inArray }) =>
      and(eq(e.studentId, studentId), eq(e.status, 'active'), inArray(e.type, types)),
  });

  return rows.filter((e) => {
    if (e.validUntil && e.validUntil < now) return false;
    if (e.sessionId && scope.sessionId && e.sessionId !== scope.sessionId) return false;
    if (e.sessionId && !scope.sessionId) return false;
    if (e.subjectId && scope.subjectId && e.subjectId !== scope.subjectId) return false;
    if (e.subjectId && !scope.subjectId) return false;
    return true;
  });
}

// Hook 1 — pricing — moved to the exception adapter (line-exceptions.ts), which priceLine reads
// (RESERVATIONS_REWORK.md §3.4; the order of application is today's).

/**
 * Hook 2 — window checks. A closed (or not-yet-open) session is treated
 * as open for this student while an extension is active.
 */
export async function hasDeadlineExtension(
  studentId: string,
  sessionId: string,
  // A caller inside a transaction passes it, so the lookup does not take a
  // second pool connection while the transaction holds its locks.
  executor: Pick<typeof db, 'query'> = db
): Promise<boolean> {
  const rows = await getActiveExceptions(
    studentId,
    ['deadline_extension', 'late_registration'],
    { sessionId },
    executor
  );
  return rows.length > 0;
}

/** Hook 3 — school-fee gate bypass */
export async function hasFeeWaiver(studentId: string): Promise<boolean> {
  const rows = await getActiveExceptions(studentId, ['fee_waiver']);
  return rows.length > 0;
}

/** Hook 4 — refund percentage override; null = no override */
export async function customRefundPercent(
  studentId: string,
  sessionId: string
): Promise<number | null> {
  const rows = await getActiveExceptions(studentId, ['custom_refund_percent'], { sessionId });
  const row = rows.find((e) => e.value != null);
  return row ? row.value! : null;
}
