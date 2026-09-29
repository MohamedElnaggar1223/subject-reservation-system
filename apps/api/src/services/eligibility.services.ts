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
 *   - grade 10: the June series only, unless a coordinator or admin granted
 *     a `grade10_other_series` exception (owner decision 28 Sep 2026)
 *   - grades 11 and 12: any series
 *   - past grade 12 (graduated): the October, November and January series of
 *     the academic year right after grade 12, while the school allows it
 *     (setting eligibility.graduateRetakes, A-12); nothing else
 *
 * When eligibility changes after a registration exists — a student leaves,
 * an admin corrects a cohort or a window's series, the school turns A-12
 * off, a grade-10 exception is revoked — `expireIneligibleRegistrations`
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
  academicYearStartOf, GRADUATE_RETAKE_SESSION_TYPES, LAST_GRADE, FIRST_GRADE,
} from '@repo/validations';
import { getSetting, lockSetting, onSettingChanged } from './settings.services';
import { logActions, type ExpiryReason } from './audit.services';
import { expireWaitingRegistrations } from './expiry.services';

/** A calendar date as the school reads it ("12 March 2027"). */
function readableDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type EligibilityCode =
  | 'ok'
  | 'not_a_student'
  | 'left'
  | 'grade_unknown'
  | 'not_started'
  | 'grade10_june_only'
  | 'graduate_retakes_off'
  | 'graduated';

export type Eligibility = {
  allowed: boolean;
  code: EligibilityCode;
  /** The sentence a refused path answers with; null when allowed. */
  reason: string | null;
  /** The student's grade in the series' academic year (past 12: graduated). */
  grade: number | null;
  academicYearStart: number;
  academicYear: string;
  series: { sessionType: string; seriesYear: number; label: string };
  /** Allowed as a graduate retaking (A-12): owes no school fee under A-13. */
  graduateRetake: boolean;
  /** The grade-10 exception that allowed a series other than June. */
  grade10ExceptionId: string | null;
};

export type EligibilityStudent = {
  id: string;
  name: string;
  role: string | null;
  cohortYear: number | null;
  leftOn: string | null;
  leftKind: string | null;
};

export type EligibilitySeries = { id: string; sessionType: string; seriesYear: number };

/**
 * The rule itself, with everything it reads passed in: used for one student
 * and one series at a time, and in bulk by the clean-up below.
 */
export function judgeEligibility(
  student: EligibilityStudent,
  series: EligibilitySeries,
  ctx: { graduateRetakes: boolean; grade10ExceptionId: string | null },
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
  if (grade === FIRST_GRADE && series.sessionType !== 'june') {
    if (ctx.grade10ExceptionId) return { ...base, allowed: true, code: 'ok', reason: null, grade, grade10ExceptionId: ctx.grade10ExceptionId };
    return refuse(
      'grade10_june_only',
      `Grade 10 sits the June series only: ${name} is in grade 10 in ${academicYearShortLabel(academicYearStart)}, so the ${seriesName} series is not open to them. A coordinator can grant an exception.`,
    );
  }
  if (grade <= LAST_GRADE) return { ...base, allowed: true, code: 'ok', reason: null, grade };

  // Past grade 12. `grade12Year` is the academic year of their grade 12.
  const grade12Year = academicYearShortLabel(student.cohortYear! + (LAST_GRADE - FIRST_GRADE));
  const retakeSeries = (GRADUATE_RETAKE_SESSION_TYPES as readonly string[]).includes(series.sessionType);
  if (grade === LAST_GRADE + 1 && retakeSeries) {
    if (ctx.graduateRetakes) return { ...base, allowed: true, code: 'ok', reason: null, grade, graduateRetake: true };
    return refuse('graduate_retakes_off', `${name} finished grade 12 in ${grade12Year}, and the school does not register graduates for later series`);
  }
  return refuse(
    'graduated',
    `${name} finished grade 12 in ${grade12Year}: a graduate may register only for the October, November and January series of the academic year right after it`,
  );
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
    .select({ id: registrationSession.id, sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear })
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
  const [row] = await executor
    .select({ id: exception.id })
    .from(exception)
    .where(and(
      eq(exception.studentId, studentId),
      eq(exception.type, 'grade10_other_series'),
      eq(exception.status, 'active'),
      or(isNull(exception.sessionId), eq(exception.sessionId, sessionId)),
      or(isNull(exception.validUntil), gt(exception.validUntil, new Date())),
    ))
    .limit(1);
  return row?.id ?? null;
}

/** May this student register for this session's series? The one answer every path asks. */
export async function mayRegisterFor(studentId: string, sessionId: string, executor: Executor = db): Promise<Eligibility> {
  const [student, series] = await Promise.all([loadStudent(studentId, executor), loadSeries(sessionId, executor)]);
  if (!series) throw new Error('Session not found');
  if (!student) throw new Error('Student not found');
  const academicYearStart = seriesAcademicYearStart(series.sessionType, series.seriesYear);
  const grade = gradeInAcademicYear(student.cohortYear, academicYearStart);
  const [graduateRetakes, exceptionId] = await Promise.all([
    getSetting('eligibility.graduateRetakes', executor),
    grade === FIRST_GRADE && series.sessionType !== 'june' ? grade10Exception(studentId, sessionId, executor) : Promise.resolve(null),
  ]);
  return judgeEligibility(student, series, { graduateRetakes, grade10ExceptionId: exceptionId });
}

/** Refuse with the rule's own sentence unless the student may register for the series. */
export async function assertMayRegisterFor(studentId: string, sessionId: string, executor: Executor = db): Promise<Eligibility> {
  const e = await mayRegisterFor(studentId, sessionId, executor);
  if (!e.allowed) throw new Error(e.reason!);
  return e;
}

/**
 * The same judgement inside the transaction that creates a registration,
 * with what it rests on held — a read-then-write guard takes a lock
 * (CLAUDE.md; MONEY_AUDIT.md MA-06). The student's row and the window's
 * row are held FOR SHARE, and so is the grade-10 exception or the A-12
 * setting a verdict relies on. Every eligibility change takes the same row
 * FOR UPDATE (the student: withdrawal, transfer, cohort correction; the
 * window: series correction; the exception: its revocation; the setting:
 * A-12 turned off) before its clean-up reads registrations, so either it
 * commits first and this re-reads it, or it waits for this registration
 * and then expires it. Lock order: student, window, then exception or
 * setting — callers run this first in their transaction.
 */
export async function assertMayRegisterForInTx(tx: Tx, studentId: string, sessionId: string): Promise<Eligibility> {
  await tx.select({ id: user.id }).from(user).where(eq(user.id, studentId)).for('share');
  await tx.select({ id: registrationSession.id }).from(registrationSession).where(eq(registrationSession.id, sessionId)).for('share');
  let e = await mayRegisterFor(studentId, sessionId, tx);
  if (e.grade10ExceptionId) {
    await tx.select({ id: exception.id }).from(exception).where(eq(exception.id, e.grade10ExceptionId)).for('share');
    e = await mayRegisterFor(studentId, sessionId, tx);
  }
  if (e.graduateRetake || e.code === 'graduate_retakes_off') {
    await lockSetting(tx, 'eligibility.graduateRetakes', 'shared');
    e = await mayRegisterFor(studentId, sessionId, tx);
  }
  if (!e.allowed) throw new Error(e.reason!);
  return e;
}

// ─── Today's standing ────────────────────────────────────────────────────────

export type StudentStanding = 'in_school' | 'upcoming' | 'graduated' | 'withdrawn' | 'transferred' | 'unknown';

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
  | 'graduate_retakes_off'
  | 'series_corrected'
  | 'exception_revoked';

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
  const [students, sessions, graduateRetakes] = await Promise.all([
    tx.select({ id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, leftOn: user.leftOn, leftKind: user.leftKind })
      .from(user).where(inArray(user.id, studentIds)),
    tx.select({ id: registrationSession.id, sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear })
      .from(registrationSession).where(inArray(registrationSession.id, sessionIds)),
    getSetting('eligibility.graduateRetakes', tx),
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
      const academicYearStart = seriesAcademicYearStart(se.sessionType, se.seriesYear);
      const needsException = gradeInAcademicYear(st.cohortYear, academicYearStart) === FIRST_GRADE && se.sessionType !== 'june';
      const exceptionId = needsException ? await grade10Exception(st.id, se.id, tx) : null;
      judged.set(key, judgeEligibility(st, se, { graduateRetakes, grade10ExceptionId: exceptionId }).allowed);
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
  graduate_retakes_off: 'the school no longer registers graduates for later series',
  series_corrected: "the window's exam series was corrected",
  exception_revoked: 'the grade-10 exception was revoked',
};

// A-12 turned off: graduates' waiting registrations for the series it
// covered expire in the transaction that turns it off; their open checkouts
// close after it commits. Turning it on moves nothing.
onSettingChanged('eligibility.graduateRetakes', {
  async inTransaction(tx, before, after) {
    if (!(before === true && after === false)) return [];
    // Graduates are students past grade 12 in some series' year: judge every
    // waiting registration of a student past grade 12 today or in the series'
    // year. Past grade 12 in the series' year is what matters; students who
    // are graduates today but were not in that series' year are unaffected by
    // the rule and the judge leaves them alone.
    const candidates = await tx
      .selectDistinct({ id: registration.studentId })
      .from(registration)
      .innerJoin(user, eq(user.id, registration.studentId))
      .innerJoin(registrationSession, eq(registrationSession.id, registration.sessionId))
      .where(and(
        inArray(registration.status, ['pending_approval', 'pending_payment']),
        sql`school_grade(${user.cohortYear}, school_series_academic_year_start(${registrationSession.sessionType}, ${registrationSession.seriesYear})) > ${LAST_GRADE}`,
      ));
    if (candidates.length === 0) return [];
    return expireIneligibleRegistrations(tx, { studentIds: candidates.map((c) => c.id) }, 'graduate_retakes_off');
  },
  async afterCommit(result) {
    const expired = result as { id: string }[];
    const { closePaymentsOfExpiredRegistrations } = await import('./payment.services');
    await closePaymentsOfExpiredRegistrations(expired.map((r) => r.id), 'graduate_retakes_off')
      .catch((err) => console.error('[eligibility] Closing checkouts after A-12 was turned off failed; the recovery sweep will retry:', err));
  },
});
