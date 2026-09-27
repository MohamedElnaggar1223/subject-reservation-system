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

import { db, exception, eq, and } from '@repo/db';
import { randomUUID } from 'crypto';
import type { CreateExceptionType, ListExceptionsQueryType } from '@repo/validations';
import type { RegistrationPricing } from './pricing.services';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Management ──────────────────────────────────────────────────────────────

export async function grantException(data: CreateExceptionType, grantedBy: string) {
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, data.studentId),
    columns: { id: true, role: true },
  });
  if (!student || student.role !== 'student') {
    throw new Error('Exceptions can only be granted to students');
  }

  const [created] = await db
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
      grantedBy,
    })
    .returning();
  return created;
}

export async function revokeException(id: string, revokedBy: string) {
  const [updated] = await db
    .update(exception)
    .set({ status: 'revoked', revokedBy, revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(exception.id, id), eq(exception.status, 'active')))
    .returning();
  if (!updated) throw new Error('Exception not found or already revoked');
  return updated;
}

export async function getExceptions(filters?: ListExceptionsQueryType) {
  return db.query.exception.findMany({
    where: (e, { eq, and }) => {
      const conditions = [];
      if (filters?.studentId) conditions.push(eq(e.studentId, filters.studentId));
      if (filters?.status) conditions.push(eq(e.status, filters.status));
      if (filters?.type) conditions.push(eq(e.type, filters.type));
      return conditions.length > 0 ? and(...conditions) : undefined;
    },
    with: {
      student: { columns: { id: true, name: true, email: true, grade: true } },
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

/**
 * Hook 1 — pricing. Applied after the 50% rule: custom_price replaces
 * the total outright; then percentage discounts; then fixed discounts.
 * The split is kept summing to the total (custom/fixed adjust courseFee).
 */
export async function applyPricingExceptions(
  studentId: string,
  sessionId: string,
  subjectId: string,
  pricing: RegistrationPricing
): Promise<RegistrationPricing> {
  const rows = await getActiveExceptions(
    studentId,
    ['custom_price', 'discount_percent', 'discount_fixed'],
    { sessionId, subjectId }
  );
  if (rows.length === 0) return pricing;

  let { courseFee, registrationFee, total } = pricing;

  const custom = rows.find((e) => e.type === 'custom_price' && e.value != null);
  if (custom) {
    total = round2(custom.value!);
    courseFee = total;
    registrationFee = 0;
  }

  for (const e of rows.filter((r) => r.type === 'discount_percent' && r.value != null)) {
    const factor = 1 - e.value! / 100;
    courseFee = round2(courseFee * factor);
    registrationFee = round2(registrationFee * factor);
    total = round2(courseFee + registrationFee);
  }

  for (const e of rows.filter((r) => r.type === 'discount_fixed' && r.value != null)) {
    const off = Math.min(e.value!, total);
    const fromCourse = Math.min(off, courseFee);
    courseFee = round2(courseFee - fromCourse);
    registrationFee = round2(registrationFee - (off - fromCourse));
    total = round2(courseFee + registrationFee);
  }

  return { ...pricing, courseFee, registrationFee, total };
}

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
