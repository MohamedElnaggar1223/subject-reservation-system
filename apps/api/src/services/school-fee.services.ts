/**
 * School Fee Service (V3 §6.2, D-A/D-H)
 *
 * The annual school-year access fee:
 * - Finance-admin/admin manage a schedule per academic year (uniform or
 *   per-grade amounts) with an opening date.
 * - Parents pay it through the shared payments pipeline
 *   (payment.purpose = 'school_fee', in-school or InstaPay).
 * - An unpaid school fee blocks subject registration for sessions inside
 *   that academic year (checked via isSchoolFeeSettled). If no schedule
 *   exists for a year, the gate is off — the school hasn't configured it.
 */

import { db, payment, schoolFeeSchedule, eq } from '@repo/db';
import { randomUUID } from 'crypto';
import type {
  CreateSchoolFeeScheduleType,
  UpdateSchoolFeeScheduleType,
} from '@repo/validations';

/**
 * Derive the academic-year label a date falls in. The Egyptian school
 * year runs roughly September–June; July+ counts toward the year that
 * starts that autumn.
 */
export function academicYearForDate(date: Date): string {
  const y = date.getFullYear();
  return date.getMonth() >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// ─── Schedule management ─────────────────────────────────────────────────────

export async function createSchedule(data: CreateSchoolFeeScheduleType) {
  const [created] = await db
    .insert(schoolFeeSchedule)
    .values({
      id: randomUUID(),
      academicYear: data.academicYear,
      grade: data.grade ?? null,
      amount: data.amount,
      opensAt: data.opensAt,
      dueAt: data.dueAt ?? null,
    })
    .returning();
  return created;
}

export async function updateSchedule(id: string, data: UpdateSchoolFeeScheduleType) {
  const [updated] = await db
    .update(schoolFeeSchedule)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(schoolFeeSchedule.id, id))
    .returning();
  return updated;
}

export async function deleteSchedule(id: string) {
  const [deleted] = await db
    .delete(schoolFeeSchedule)
    .where(eq(schoolFeeSchedule.id, id))
    .returning();
  return deleted;
}

export async function getSchedules() {
  return db.query.schoolFeeSchedule.findMany({
    orderBy: (s, { desc, asc }) => [desc(s.academicYear), asc(s.grade)],
  });
}

/**
 * Resolve the applicable fee amount for a student in a year:
 * per-grade row wins over the uniform (grade=null) row.
 * Returns null when no schedule applies (gate off).
 */
export async function getApplicableFee(academicYear: string, grade: number | null) {
  const rows = await db.query.schoolFeeSchedule.findMany({
    where: (s, { eq }) => eq(s.academicYear, academicYear),
  });
  if (rows.length === 0) return null;

  const perGrade = grade !== null ? rows.find((r) => r.grade === grade) : undefined;
  const uniform = rows.find((r) => r.grade === null);
  const row = perGrade ?? uniform;
  if (!row) return null;

  // Not yet open → not payable and not gating
  if (row.opensAt > new Date()) return null;
  return row;
}

// ─── Payment + gate ──────────────────────────────────────────────────────────

/**
 * Has this student settled the school fee for the year?
 * Settled = a completed payment with purpose='school_fee' for that year.
 */
export async function hasCompletedSchoolFeePayment(studentId: string, academicYear: string) {
  const paid = await db.query.payment.findFirst({
    where: (p, { eq, and }) =>
      and(
        eq(p.studentId, studentId),
        eq(p.purpose, 'school_fee'),
        eq(p.academicYear, academicYear),
        eq(p.status, 'completed')
      ),
    columns: { id: true },
  });
  return !!paid;
}

/**
 * The registration gate (D-H). Returns null when registration may
 * proceed, or a human-readable blocking reason.
 */
export async function schoolFeeGateReason(
  studentId: string,
  grade: number | null,
  sessionStartDate: Date
): Promise<string | null> {
  const academicYear = academicYearForDate(sessionStartDate);
  const fee = await getApplicableFee(academicYear, grade);
  if (!fee) return null; // no configured/open schedule → gate off

  if (await hasCompletedSchoolFeePayment(studentId, academicYear)) return null;

  return `The ${academicYear} school fee (${fee.amount.toFixed(2)} EGP) must be paid before registering subjects`;
}

/**
 * Status payload for the parent/student UI.
 */
export async function getSchoolFeeStatus(studentId: string) {
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: { id: true, name: true, grade: true },
  });
  if (!student) throw new Error('Student not found');

  const academicYear = academicYearForDate(new Date());
  const fee = await getApplicableFee(academicYear, student.grade ?? null);
  const paid = await hasCompletedSchoolFeePayment(studentId, academicYear);

  const openPayment = await db.query.payment.findFirst({
    where: (p, { eq, and, inArray }) =>
      and(
        eq(p.studentId, studentId),
        eq(p.purpose, 'school_fee'),
        eq(p.academicYear, academicYear),
        inArray(p.status, ['pending', 'pending_verification'])
      ),
  });

  return {
    academicYear,
    student: { id: student.id, name: student.name, grade: student.grade },
    amount: fee?.amount ?? null,
    dueAt: fee?.dueAt ?? null,
    required: !!fee,
    paid,
    pendingPayment: openPayment ?? null,
  };
}

/**
 * Parent initiates a school-fee payment for a linked child through the
 * shared pipeline. Amount always comes from the schedule.
 */
export async function initiateSchoolFeePayment(
  parentId: string,
  studentId: string,
  paymentMethod: 'in_school' | 'instapay',
  schoolAccountDetails: Record<string, unknown>
) {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) =>
      and(eq(l.parentId, parentId), eq(l.studentId, studentId), eq(l.status, 'approved')),
    columns: { id: true },
  });
  if (!link) throw new Error('You are not linked to this student');

  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: { grade: true },
  });
  if (!student) throw new Error('Student not found');

  const academicYear = academicYearForDate(new Date());
  const fee = await getApplicableFee(academicYear, student.grade ?? null);
  if (!fee) throw new Error('No school fee is currently open for payment');

  if (await hasCompletedSchoolFeePayment(studentId, academicYear)) {
    throw new Error(`The ${academicYear} school fee is already paid`);
  }

  const existing = await db.query.payment.findFirst({
    where: (p, { eq, and, inArray }) =>
      and(
        eq(p.studentId, studentId),
        eq(p.purpose, 'school_fee'),
        eq(p.academicYear, academicYear),
        inArray(p.status, ['pending', 'pending_verification'])
      ),
    columns: { id: true },
  });
  if (existing) {
    throw new Error('A school-fee payment is already pending for this student');
  }

  const paymentId = randomUUID();
  let metadata: Record<string, unknown>;
  let externalReference: string | null = null;

  if (paymentMethod === 'in_school') {
    externalReference = `SCH-${paymentId.slice(0, 8).toUpperCase()}`;
    metadata = {
      inSchool: { referenceNumber: externalReference },
      instructions: 'Pay the school fee at the finance desk. Quote this reference or the student name.',
    };
  } else {
    metadata = {
      instapay: { account: schoolAccountDetails, amountDue: fee.amount },
      instructions:
        'Transfer the exact amount via InstaPay to the school account, then submit your transaction reference.',
    };
  }

  const [created] = await db
    .insert(payment)
    .values({
      id: paymentId,
      studentId,
      parentId,
      amount: fee.amount,
      escrowAmountApplied: 0,
      paymentMethod,
      purpose: 'school_fee',
      academicYear,
      status: 'pending',
      externalReference,
      metadata,
    })
    .returning();

  return created;
}
