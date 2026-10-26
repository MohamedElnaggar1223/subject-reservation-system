/**
 * Who may register for which series (FEATURES_PLAN.md F0a).
 *
 * `mayRegisterFor(studentId, sessionId)` is the one answer every path asks —
 * a student's request, a parent's direct registration, a preregistration,
 * the desk, a swap, a parent's approval, an admin override, a checkout and a
 * desk collection. It replaced `isGraduated` and `requireNotGraduated`. The
 * series decides it, never today's date or the window's own dates:
 *
 *   grade for the series = 10 + (series' academic year − cohort)
 *
 *   - a student who left the school (withdrawn or transferred): refused
 *   - no recorded cohort: refused until an admin records it
 *   - below grade 10: refused (they have not started)
 *   - grades 10, 11, 12 and graduates (the academic year right after grade 12): for a new reservation, as
 *     the session's grade list says (`allowed_grades`, D11; default 11, 12, graduates — it replaced the
 *     June-only rule for grade 10 and the setting eligibility.graduateRetakes, A-12); a coordinator's
 *     grade-10 exception lets grade 10 through where the list does not (owner decision 28 Sep 2026)
 *   - past the year after grade 12: refused
 *
 * The grade list is asked of new reservations only (COORDINATOR_REWORK.md §9.2): the re-check at payment,
 * a payment closing and the clean-up below judge without it (`forNewReservation: false`), so changing the
 * list never strands a line.
 *
 * When eligibility changes after a registration exists — a student leaves,
 * an admin corrects a cohort or a window's series, a grade-10 exception is
 * revoked — `expireIneligibleRegistrations`
 * does what graduation did before F0a (state audit ST-04): registrations
 * the student may no longer sit expire, except one held by a transfer being
 * checked or by an InstaPay checkout inside its grace (as at a close); the
 * pending change requests on them are rejected; every move writes its audit
 * row in the caller's transaction. After the commit,
 * `closePaymentsOfExpiredRegistrations` (payment.services.ts) closes the
 * checkouts left open on them, escrow back, family told; the recovery sweep
 * catches any the close misses. Preregistrations are left alone: a paid
 * one holds money whose refund is the owner's decision (SO-4), and an unpaid
 * one cannot be paid (checkout asks here) and expires with its window.
 */

import {
  db, user, registration, registrationSession, changeRequest, paymentRegistration, payment, exception,
  and, eq, inArray, or, isNull, gt, sql,
} from '@repo/db';
import {
  academicYearLabel, academicYearShortLabel, seriesAcademicYearStart, seriesLabel, gradeInAcademicYear,
  academicYearStartOf, LAST_GRADE, FIRST_GRADE,
} from '@repo/validations';
import type { Eligibility, EligibilityCode, StudentStatus } from '@repo/validations';
import { logActions, type ExpiryReason } from './audit.services';
import { expireWaitingRegistrations } from './expiry.services';
import { lastInstalmentBeingCheckedSql } from './plan.services';

/** A calendar date as the school reads it ("12 March 2027"). */
function readableDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

// The answer's shape lives in @repo/validations so the web can name it.
export type { Eligibility, EligibilityCode };

export type EligibilityStudent = {
  id: string;
  name: string;
  role: string | null;
  cohortYear: number | null;
  leftOn: string | null;
  leftKind: string | null;
};

export type EligibilitySeries = { id: string; sessionType: string; seriesYear: number; allowedGrades: string[] };

/** The session's grade list in words ("grades 11 and 12 and graduates"). */
function gradesInWords(list: readonly string[]) {
  const grades = list.filter((g) => g !== 'graduates').sort();
  const parts = [...(grades.length ? [`grade${grades.length > 1 ? 's' : ''} ${grades.join(grades.length > 2 ? ', ' : ' and ')}`] : []), ...(list.includes('graduates') ? ['graduates'] : [])];
  return parts.join(' and ') || 'no grade';
}

/**
 * The rule itself, with everything it reads passed in: used for one student
 * and one series at a time, and in bulk by the clean-up below.
 */
export function judgeEligibility(
  student: EligibilityStudent,
  series: EligibilitySeries,
  // The session's grade list for a new reservation; null when the list does not enter (payment, a clean-up).
  ctx: { allowedGrades: readonly string[] | null; grade10ExceptionId: string | null },
): Eligibility {
  const academicYearStart = seriesAcademicYearStart(series.sessionType, series.seriesYear);
  const base = {
    academicYearStart,
    academicYear: academicYearLabel(academicYearStart),
    series: { sessionType: series.sessionType, seriesYear: series.seriesYear, label: seriesLabel(series.sessionType, series.seriesYear) },
    graduateRetake: false,
    grade10ExceptionId: null as string | null,
  };
  const grade = gradeInAcademicYear(student.cohortYear, academicYearStart);
  const refuse = (code: EligibilityCode, reason: string): Eligibility => ({ ...base, allowed: false, code, reason, grade });
  const name = student.name;
  const seriesName = base.series.label;

  if (student.role !== 'student') return refuse('not_a_student', 'Only students can be registered for subjects');
  if (student.leftOn) {
    const how = student.leftKind === 'transferred' ? 'transferred to another school' : 'was withdrawn from the school';
    return refuse('left', `${name} ${how} on ${readableDate(student.leftOn)} and cannot be registered for new subjects`);
  }
  if (grade === null) {
    return refuse('grade_unknown', `${name}'s grade is not recorded — an admin records it on the student's page before they can register`);
  }
  if (grade < FIRST_GRADE) {
    const starts = academicYearShortLabel(student.cohortYear!);
    return refuse('not_started', `${name} starts grade 10 in ${starts}: the ${seriesName} series comes before that`);
  }
  // `grade12Year` is the academic year of their grade 12.
  const grade12Year = academicYearShortLabel(student.cohortYear! + (LAST_GRADE - FIRST_GRADE));
  if (grade > LAST_GRADE + 1) {
    return refuse('graduated', `${name} finished grade 12 in ${grade12Year}: a graduate may reserve only in the academic year right after it`);
  }
  const graduate = grade === LAST_GRADE + 1;
  // Payment and the clean-ups: the list does not enter (changing it never strands a line).
  if (ctx.allowedGrades === null) return { ...base, allowed: true, code: 'ok', reason: null, grade, graduateRetake: graduate };
  const listed = graduate ? ctx.allowedGrades.includes('graduates') : ctx.allowedGrades.includes(String(grade));
  if (listed) return { ...base, allowed: true, code: 'ok', reason: null, grade, graduateRetake: graduate };
  if (grade === FIRST_GRADE) {
    if (ctx.grade10ExceptionId) return { ...base, allowed: true, code: 'ok', reason: null, grade, grade10ExceptionId: ctx.grade10ExceptionId };
    return refuse(
      'grade10_june_only',
      `${name} is in grade 10 in ${academicYearShortLabel(academicYearStart)}, and this session takes ${gradesInWords(ctx.allowedGrades)}. A coordinator can grant an exception.`,
    );
  }
  return refuse('grade_not_listed', graduate
    ? `${name} finished grade 12 in ${grade12Year}, and this session takes ${gradesInWords(ctx.allowedGrades)}`
    : `${name} is in grade ${grade} in ${academicYearShortLabel(academicYearStart)}, and this session takes ${gradesInWords(ctx.allowedGrades)}`);
}

async function loadStudent(studentId: string, executor: Executor): Promise<EligibilityStudent | null> {
  const [row] = await executor
    .select({
      id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, leftOn: user.leftOn, leftKind: user.leftKind,
    })
    .from(user)
    .where(eq(user.id, studentId));
  return row ?? null;
}

async function loadSeries(sessionId: string, executor: Executor): Promise<EligibilitySeries | null> {
  const [row] = await executor
    .select({ id: registrationSession.id, sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear, allowedGrades: registrationSession.allowedGrades })
    .from(registrationSession)
    .where(eq(registrationSession.id, sessionId));
  return row ?? null;
}

/**
 * An active grade-10 exception for this series (or for every series: no
 * session on it). Read here rather than through exception.services, which
 * asks this module when an exception is revoked.
 */
async function grade10Exception(studentId: string, sessionId: string, executor: Executor): Promise<string | null> {
  // The policy registry (RESERVATIONS_REWORK.md §3.7): eligibility.grade10OtherSeries, held by
  // the student or by their family (a parent with an approved link), for this series or for every
  // series of their grade-10 year (no session scope).
  const [row] = await executor
    .select({ id: exception.id })
    .from(exception)
    .where(and(
      or(
        eq(exception.studentId, studentId),
        sql`${exception.familyId} in (select l.parent_id from parent_student_link l where l.student_id = ${studentId} and l.status = 'approved')`,
      ),
      eq(exception.policyKey, 'eligibility.grade10OtherSeries'),
      eq(exception.status, 'active'),
      or(isNull(exception.sessionId), eq(exception.sessionId, sessionId)),
      or(isNull(exception.validUntil), gt(exception.validUntil, new Date())),
    ))
    .orderBy(exception.createdAt, exception.id)
    .limit(1);
  return row?.id ?? null;
}

/**
 * May this student register for this session's series? The one answer every path asks. A new reservation
 * (the default) is judged against the session's grade list; a payment, a payment closing and a re-check of
 * lines already made pass `forNewReservation: false` (§9.2: the list never strands a line).
 */
export async function mayRegisterFor(studentId: string, sessionId: string, executor: Executor = db, opts: { forNewReservation?: boolean } = {}): Promise<Eligibility> {
  const [student, series] = await Promise.all([loadStudent(studentId, executor), loadSeries(sessionId, executor)]);
  if (!series) throw new Error('Session not found');
  if (!student) throw new Error('Student not found');
  const forNew = opts.forNewReservation ?? true;
  const academicYearStart = seriesAcademicYearStart(series.sessionType, series.seriesYear);
  const grade = gradeInAcademicYear(student.cohortYear, academicYearStart);
  const exceptionId = forNew && grade === FIRST_GRADE && !series.allowedGrades.includes('10') ? await grade10Exception(studentId, sessionId, executor) : null;
  return judgeEligibility(student, series, { allowedGrades: forNew ? series.allowedGrades : null, grade10ExceptionId: exceptionId });
}

/** Refuse with the rule's own sentence unless the student may register for the series. */
export async function assertMayRegisterFor(studentId: string, sessionId: string, executor: Executor = db, opts: { forNewReservation?: boolean } = {}): Promise<Eligibility> {
  const e = await mayRegisterFor(studentId, sessionId, executor, opts);
  if (!e.allowed) throw new Error(e.reason!);
  return e;
}

/**
 * The same judgement inside the transaction that creates a registration,
 * with what it rests on held — a read-then-write guard takes a lock
 * (CLAUDE.md; MONEY_AUDIT.md MA-06). The student's row and the window's
 * row (its grade list with it) are held FOR SHARE, and so is the grade-10
 * exception a verdict relies on. Every eligibility change takes the same row
 * FOR UPDATE (the student: withdrawal, transfer, cohort correction; the
 * window: series correction, its grade list; the exception: its revocation)
 * before its clean-up reads registrations, so either it commits first and
 * this re-reads it, or it waits for this registration and then expires it.
 * Lock order: student, window, then exception — callers run this first in
 * their transaction.
 */
export async function assertMayRegisterForInTx(tx: Tx, studentId: string, sessionId: string): Promise<Eligibility> {
  const e = await mayRegisterForInTx(tx, studentId, sessionId);
  if (!e.allowed) throw new Error(e.reason!);
  return e;
}

/** The locked judgement without the throw (a preregistration's capture holds a refused row instead). */
export async function mayRegisterForInTx(tx: Tx, studentId: string, sessionId: string): Promise<Eligibility> {
  // The student FOR NO KEY UPDATE (the rework, §6): a student's own reservations are serialised —
  // what gate.sameEntryOnce and gate.exclusiveItems need, since no index can express them across
  // sessions; NO KEY so inserts referencing the student are not blocked.
  await tx.select({ id: user.id }).from(user).where(eq(user.id, studentId)).for('no key update');
  await tx.select({ id: registrationSession.id }).from(registrationSession).where(eq(registrationSession.id, sessionId)).for('share');
  let e = await mayRegisterFor(studentId, sessionId, tx);
  if (e.grade10ExceptionId) {
    await tx.select({ id: exception.id }).from(exception).where(eq(exception.id, e.grade10ExceptionId)).for('share');
    e = await mayRegisterFor(studentId, sessionId, tx);
  }
  return e;
}

// ─── Today's standing ────────────────────────────────────────────────────────

/** Where a student stands today: the Students screen's statuses (@repo/validations). */
export type StudentStanding = StudentStatus;

/** Where a student stands today (Cairo time): what every screen shows next to their name. */
export function standingToday(s: { cohortYear: number | null; leftKind: string | null; leftOn: string | null }, now: Date = new Date()) {
  const academicYearStart = academicYearStartOf(now);
  const grade = gradeInAcademicYear(s.cohortYear, academicYearStart);
  let standing: StudentStanding;
  if (s.leftOn) standing = s.leftKind === 'transferred' ? 'transferred' : 'withdrawn';
  else if (grade === null) standing = 'unknown';
  else if (grade < FIRST_GRADE) standing = 'upcoming';
  else if (grade > LAST_GRADE) standing = 'graduated';
  else standing = 'in_school';
  return { grade, standing, academicYearStart, academicYear: academicYearLabel(academicYearStart) };
}

// ─── When eligibility changes after a registration exists ────────────────────

export type EligibilityCause =
  | 'withdrawn'
  | 'transferred'
  | 'cohort_corrected'
  | 'series_corrected'
  | 'exception_revoked'
  | 'exception_lapsed';

/**
 * Expire every waiting registration (awaiting approval or payment) in the
 * scope that its student may no longer sit, in the caller's transaction,
 * with one REGISTRATION_EXPIRED row each (reason `ineligible`, and the
 * cause), and reject the pending change requests on them. A registration
 * held by a transfer being checked, or by an InstaPay checkout inside its
 * grace, is kept, as a close keeps it: the family may already have paid.
 *
 * Returns the registrations expired, for closing their open checkouts after
 * the commit (closePaymentsOfExpiredRegistrations).
 */
export async function expireIneligibleRegistrations(
  tx: Tx,
  scope: { studentIds?: string[]; sessionIds?: string[] },
  cause: EligibilityCause,
  now: Date = new Date(),
): Promise<{ id: string; studentId: string; subjectId: string }[]> {
  if (!scope.studentIds?.length && !scope.sessionIds?.length) return [];
  const conditions = [inArray(registration.status, ['pending_approval', 'pending_payment'])];
  if (scope.studentIds?.length) conditions.push(inArray(registration.studentId, scope.studentIds));
  if (scope.sessionIds?.length) conditions.push(inArray(registration.sessionId, scope.sessionIds));
  const waiting = await tx
    .select({ id: registration.id, studentId: registration.studentId, sessionId: registration.sessionId })
    .from(registration)
    .where(and(...conditions));
  if (waiting.length === 0) return [];

  const studentIds = [...new Set(waiting.map((w) => w.studentId))];
  const sessionIds = [...new Set(waiting.map((w) => w.sessionId))];
  const [students, sessions] = await Promise.all([
    tx.select({ id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, leftOn: user.leftOn, leftKind: user.leftKind })
      .from(user).where(inArray(user.id, studentIds)),
    tx.select({ id: registrationSession.id, sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear, allowedGrades: registrationSession.allowedGrades })
      .from(registrationSession).where(inArray(registrationSession.id, sessionIds)),
  ]);
  const studentById = new Map(students.map((s) => [s.id, s]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const ineligible: string[] = [];
  const judged = new Map<string, boolean>();
  for (const w of waiting) {
    const key = `${w.studentId}|${w.sessionId}`;
    if (!judged.has(key)) {
      const st = studentById.get(w.studentId)!;
      const se = sessionById.get(w.sessionId)!;
      // Lines already made: the grade list does not enter (changing it never strands a line) — only what makes a
      // student no longer able to sit the series (left, a corrected cohort or series).
      judged.set(key, judgeEligibility(st, se, { allowedGrades: null, grade10ExceptionId: null }).allowed);
    }
    if (!judged.get(key)) ineligible.push(w.id);
  }
  if (ineligible.length === 0) return [];

  const expired = await expireWaitingRegistrations(tx,
    and(
      inArray(registration.id, ineligible),
      sql`not exists (
        select 1 from ${paymentRegistration} pr join ${payment} p on p.id = pr.payment_id
        where pr.registration_id = ${registration.id}
          and (p.status = 'pending_verification' or (p.status = 'pending' and p.reference_due_at > ${now}))
      )`,
      // A plan line whose last instalment's transfer is being checked is spared too (§3.6).
      sql`not ${lastInstalmentBeingCheckedSql(registration.id, now)}`,
    ),
    'ineligible' satisfies ExpiryReason, now, cause);

  // A pending drop or swap on a registration the student may no longer sit
  // is rejected, as a close and graduation did (a parent can still drop a
  // paid subject directly).
  const rejected = await tx
    .update(changeRequest)
    .set({ status: 'rejected', comments: `[SYSTEM] Automatically rejected — ${CAUSE_SENTENCE[cause]}`, processedAt: now, updatedAt: now })
    .where(and(inArray(changeRequest.registrationId, ineligible), eq(changeRequest.status, 'pending_approval')))
    .returning({ id: changeRequest.id });
  await logActions(rejected.map((r) => ({
    userId: null, action: 'CHANGE_REQUEST_REJECTED' as const, entityType: 'change_request' as const, entityId: r.id,
    previousData: { status: 'pending_approval' }, newData: { status: 'rejected', reason: 'ineligible', cause },
  })), tx);

  return expired;
}

export const CAUSE_SENTENCE: Record<EligibilityCause, string> = {
  withdrawn: 'the student was withdrawn from the school',
  transferred: 'the student transferred to another school',
  cohort_corrected: "the student's grade was corrected",
  series_corrected: "the window's exam series was corrected",
  exception_revoked: 'the grade-10 exception was revoked',
  exception_lapsed: 'the grade-10 exception ran out',
};
