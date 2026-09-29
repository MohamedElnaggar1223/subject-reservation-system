/**
 * School Fee Service (V3 §6.2, D-A/D-H)
 *
 * The annual school-year access fee:
 * - Finance-admin/admin manage a schedule per academic year (uniform or
 *   per-grade amounts) with an opening date.
 * - Parents pay it through the shared payments pipeline
 *   (payment.purpose = 'school_fee', in-school or InstaPay).
 * - An unpaid school fee blocks subject registration for a series in that
 *   academic year. If no schedule exists for a year, the gate is off — the
 *   school hasn't configured it (or holds the registration, A-14).
 *
 * F0a: the gate reads the series' academic year and the student's grade in
 * it, never the window's dates or today's grade: a November window opening
 * in June asks for next year's fee at next year's grade. A graduate
 * registering under A-12 owes no fee while the school says so (A-13).
 */

import { db, payment, schoolFeeSchedule, eq } from '@repo/db';
import { hasFeeWaiver } from './exception.services';
import { logAction, type AuditContext } from './audit.services';
import { getSetting } from './settings.services';
import type { Eligibility } from './eligibility.services';
import { randomUUID } from 'crypto';
import {
  academicYearLabel,
  academicYearStartOf,
  academicYearStartFromLabel,
  gradeInAcademicYear,
  LAST_GRADE,
  type CreateSchoolFeeScheduleType,
  type UpdateSchoolFeeScheduleType,
} from '@repo/validations';

/**
 * The academic-year label a date falls in: 1 July to 30 June, in Cairo
 * time whatever the server's zone (F0a; it used to read the server's local
 * month).
 */
export function academicYearForDate(date: Date): string {
  return academicYearLabel(academicYearStartOf(date));
}

/** The student's grade in an academic year ('2026-2027'), from their cohort. */
export async function studentGradeInYear(studentId: string, academicYear: string): Promise<number | null> {
  const start = academicYearStartFromLabel(academicYear);
  if (start === null) return null;
  const s = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, studentId), columns: { cohortYear: true } });
  return gradeInAcademicYear(s?.cohortYear ?? null, start);
}

// ─── Schedule management ─────────────────────────────────────────────────────

export async function createSchedule(data: CreateSchoolFeeScheduleType) {
  try {
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
  } catch (err) {
    // One schedule per (year, grade). Drizzle wraps the pg unique violation;
    // the code sits on `cause` (same shape as the InstaPay reference path).
    const cause = (err as { cause?: { code?: string } } | null)?.cause;
    if (cause?.code === '23505' || (err as { code?: string } | null)?.code === '23505') {
      throw new Error('A schedule for that academic year and grade already exists');
    }
    throw err;
  }
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
 * The registration gate (D-H), for a student allowed to register for a
 * series (mayRegisterFor). Returns null when registration may proceed, or a
 * human-readable blocking reason.
 *
 * The fee is the one of the series' academic year at the student's grade in
 * it (F0a). A graduate retaking under A-12 owes none while the school says
 * so (A-13). With no schedule open for that year the gate is off, unless the
 * series is in a later academic year than today and the school holds such
 * registrations until the fee opens (A-14).
 */
export async function schoolFeeGateReason(studentId: string, eligibility: Eligibility): Promise<string | null> {
  const { academicYear, grade } = eligibility;
  if (eligibility.graduateRetake && (await getSetting('schoolFee.graduatesExempt'))) return null;

  const fee = await getApplicableFee(academicYear, grade);
  if (!fee) {
    const laterYear = eligibility.academicYearStart > academicYearStartOf(new Date());
    if (laterYear && (await getSetting('schoolFee.newYearWithoutSchedule')) === 'hold') {
      return `The ${academicYear} school fee is not open yet — registration for the ${eligibility.series.label} series waits until it opens`;
    }
    return null; // no configured/open schedule → gate off
  }

  // Hook 3 (§6.3): fee_waiver exception bypasses the gate
  if (await hasFeeWaiver(studentId)) return null;

  if (await hasCompletedSchoolFeePayment(studentId, academicYear)) return null;

  return `The ${academicYear} school fee (${fee.amount.toFixed(2)} EGP) must be paid before registering subjects`;
}

/**
 * The one answer to "does this student owe the school fee for this year?"
 * (RF-10). Every screen reads this; none recomputes it. Three screens used
 * to disagree: the desk and the fee page ignored an active waiver, and the
 * home summary reported a waived fee as paid.
 *
 * - required: an open schedule applies and the student is not waived
 * - waived:   an active fee_waiver exception exists. A waiver is per student,
 *             bounded only by validUntil — it carries no academic year, so an
 *             open-ended waiver settles every year until it is revoked or
 *             expires. Whether a waiver should be per year is a product
 *             decision (see the money audit's open items).
 * - paid:     a completed school_fee payment exists for `academicYear` — never inferred
 * - settled:  nothing is owed (no fee, waived, or paid)
 */
export async function getSchoolFeeStanding(
  studentId: string,
  // The student's grade in `academicYear` (F0a: from the cohort).
  grade: number | null,
  academicYear: string
) {
  // A graduate owes no fee while the school says so (A-13).
  const exempt = grade !== null && grade > LAST_GRADE && (await getSetting('schoolFee.graduatesExempt'));
  const fee = exempt ? null : await getApplicableFee(academicYear, grade);
  if (!fee) return { fee: null, required: false, waived: false, paid: false, settled: true };
  const [waived, paid] = await Promise.all([
    hasFeeWaiver(studentId),
    hasCompletedSchoolFeePayment(studentId, academicYear),
  ]);
  return { fee, required: !waived, waived, paid, settled: waived || paid };
}

/**
 * The academic years a family may pay the fee for: the one today falls in,
 * and the next (a series in it can open for registration before 1 July).
 */
export function payableAcademicYears(now: Date = new Date()): string[] {
  const start = academicYearStartOf(now);
  return [academicYearLabel(start), academicYearLabel(start + 1)];
}

function checkPayableYear(requested: string | undefined): string {
  const years = payableAcademicYears();
  const academicYear = requested ?? years[0]!;
  if (!years.includes(academicYear)) {
    throw new Error(`The school fee can be paid for ${years.join(' or ')} only`);
  }
  return academicYear;
}

/**
 * Status payload for the parent/student UI: the year today falls in by
 * default, or the next one (F0a).
 */
export async function getSchoolFeeStatus(studentId: string, requestedYear?: string) {
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: { id: true, name: true, cohortYear: true },
  });
  if (!student) throw new Error('Student not found');

  const academicYear = checkPayableYear(requestedYear);
  const grade = gradeInAcademicYear(student.cohortYear, academicYearStartFromLabel(academicYear)!);
  const standing = await getSchoolFeeStanding(studentId, grade, academicYear);
  const fee = standing.fee;
  const paid = standing.paid;

  const openPayment = await db.query.payment.findFirst({
    where: (p, { eq, and, inArray }) =>
      and(
        eq(p.studentId, studentId),
        eq(p.purpose, 'school_fee'),
        eq(p.academicYear, academicYear),
        inArray(p.status, ['pending', 'pending_verification'])
      ),
  });

  // Next year's fee, when its schedule is open and it is still owed: a family
  // registering for a series in that year is asked for it (F0a).
  const nextYear = payableAcademicYears()[1]!;
  const nextStanding = academicYear === nextYear
    ? null
    : await getSchoolFeeStanding(studentId, gradeInAcademicYear(student.cohortYear, academicYearStartFromLabel(nextYear)!), nextYear);

  return {
    academicYear,
    student: { id: student.id, name: student.name, grade },
    nextYear: nextStanding && nextStanding.fee && !nextStanding.settled
      ? { academicYear: nextYear, amount: nextStanding.fee.amount, dueAt: nextStanding.fee.dueAt }
      : null,
    amount: fee?.amount ?? null,
    dueAt: fee?.dueAt ?? null,
    required: standing.required,
    waived: standing.waived,
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
  schoolAccountDetails: Record<string, unknown>,
  auditCtx?: AuditContext,
  requestedYear?: string
) {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) =>
      and(eq(l.parentId, parentId), eq(l.studentId, studentId), eq(l.status, 'approved')),
    columns: { id: true },
  });
  if (!link) throw new Error('You are not linked to this student');

  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: { cohortYear: true },
  });
  if (!student) throw new Error('Student not found');

  const academicYear = checkPayableYear(requestedYear);
  const grade = gradeInAcademicYear(student.cohortYear, academicYearStartFromLabel(academicYear)!);
  const standing = await getSchoolFeeStanding(studentId, grade, academicYear);
  const fee = standing.fee;
  if (!fee) throw new Error('No school fee is currently open for payment');
  if (standing.waived) throw new Error(`The ${academicYear} school fee is waived for this student — nothing to pay`);

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

  return db.transaction(async (tx) => {
    const [created] = await tx
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
      .returning()
      .catch((err) => {
        // One open or paid school fee per student and year (state audit ST-02).
        if ((err as { cause?: { code?: string } } | null)?.cause?.code === '23505') {
          throw new Error('A school-fee payment is already pending for this student');
        }
        throw err;
      });
    // The payment and its audit row commit together (MO-1).
    await logAction(parentId, 'SCHOOL_FEE_PAYMENT_INITIATED', 'payment', paymentId, null,
      created as Record<string, unknown>, auditCtx, tx);
    return created;
  });
}
