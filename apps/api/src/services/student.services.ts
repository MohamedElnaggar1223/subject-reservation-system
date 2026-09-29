/**
 * The student record (FEATURES_PLAN.md F0a): the cohort and the grade it
 * gives, the section, and whether the student is still at the school.
 *
 * - A cohort correction (a repeated year, a wrong entry) is the admin's,
 *   with a reason, audited in its transaction. Registrations the student may
 *   no longer sit expire in the same transaction (eligibility.services.ts);
 *   their open checkouts close after it, escrow back, family told.
 * - A student who leaves (withdrawn or transferred, with the day and the
 *   reason) is refused new registrations; their open section membership
 *   ends that day; the same clean-up runs. Everything they did stays.
 *   Readmission clears it, audited; what expired stays expired.
 */

import { db, user, auditLog, registrationSession, academicYear, section, sectionMembership, eq, and, or, ilike, inArray, sql, gradeTodaySql } from '@repo/db';
import {
  academicYearStartOf, academicYearShortLabel, academicYearLabel, cohortFromGrade, gradeInAcademicYear, gradeLabel,
  schoolDateString, FIRST_GRADE, LAST_GRADE,
  type CorrectCohortType, type RecordLeavingType, type ListStudentsQueryType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { expireIneligibleRegistrations, mayRegisterFor, standingToday, type EligibilityCause } from './eligibility.services';
import { closePaymentsOfExpiredRegistrations } from './payment.services';
import { notifyGradeChanged } from './notification.services';
import { endOpenMemberships, sectionOf, sectionHistoryOf } from './academic.services';

export class StudentError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

/** Today's standing in SQL, for lists that filter on it. */
const standingSql = sql<string>`CASE
  WHEN ${user.leftOn} IS NOT NULL THEN ${user.leftKind}
  WHEN ${user.cohortYear} IS NULL THEN 'unknown'
  WHEN ${gradeTodaySql(user.cohortYear)} < ${FIRST_GRADE} THEN 'upcoming'
  WHEN ${gradeTodaySql(user.cohortYear)} > ${LAST_GRADE} THEN 'graduated'
  ELSE 'in_school' END`;

/**
 * The students list for staff: today's grade and standing, this year's
 * section, searchable and filterable. The coordinator's way in (they have
 * no Student 360, which carries money).
 */
/** The backfill inferred this student's graduation (a row per inference, for staff to review). */
const inferredSql = sql`EXISTS (SELECT 1 FROM ${auditLog} a WHERE a.action = 'STUDENT_COHORT_INFERRED' AND a.entity_id = ${user.id})`;

export async function listStudents(q: ListStudentsQueryType) {
  const current = academicYearStartOf();
  const conditions = [eq(user.role, 'student')];
  if (q.search) {
    const term = `%${q.search}%`;
    conditions.push(or(ilike(user.name, term), ilike(user.email, term), ilike(user.studentId, term))!);
  }
  if (q.grade !== undefined) conditions.push(sql`${gradeTodaySql(user.cohortYear)} = ${q.grade}`);
  if (q.status) conditions.push(sql`${standingSql} = ${q.status}`);

  const sectionJoin = sql`LEFT JOIN LATERAL (
      SELECT s.id, s.name FROM ${sectionMembership} m
      JOIN ${section} s ON s.id = m.section_id
      JOIN ${academicYear} y ON y.id = m.academic_year_id
      WHERE m.student_id = ${user.id} AND m.ended_on IS NULL AND y.start_year = ${current}
      LIMIT 1) cur ON true`;
  const where = and(
    ...conditions,
    q.sectionId ? sql`cur.id = ${q.sectionId}` : undefined,
    q.withoutSection === 'true' ? sql`cur.id IS NULL` : undefined,
    q.inferred === 'true' ? sql`${inferredSql}` : undefined,
  );
  const rows = await db.execute(sql`
    SELECT ${user.id} AS id, ${user.name} AS name, ${user.email} AS email, ${user.studentId} AS "studentId",
      ${user.cohortYear} AS "cohortYear", ${gradeTodaySql(user.cohortYear)} AS grade, ${standingSql} AS standing,
      ${user.leftOn} AS "leftOn", cur.id AS "sectionId", cur.name AS "sectionName",
      ${inferredSql} AS "cohortInferred",
      count(*) OVER () AS total
    FROM ${user} ${sectionJoin}
    WHERE ${where}
    ORDER BY ${user.name}
    LIMIT ${q.limit} OFFSET ${q.offset}`);
  const list = (rows.rows as {
    id: string; name: string; email: string; studentId: string | null; cohortYear: number | null; grade: number | null;
    standing: string; leftOn: string | null; sectionId: string | null; sectionName: string | null; cohortInferred: boolean; total: string;
  }[]).map(({ total: _t, ...r }) => ({ ...r, gradeLabel: gradeLabel(r.grade) }));
  return {
    academicYear: academicYearLabel(current),
    total: Number((rows.rows[0] as { total?: string } | undefined)?.total ?? 0),
    students: list,
  };
}

/**
 * One student's academic record: grade today and in each of their three
 * years, cohort, section (and its history), status, the series open now
 * and whether they may register for each, and the record's changes.
 */
export async function getStudentRecord(studentId: string) {
  const s = await db.query.user.findFirst({
    where: (u, { eq: eqOp }) => eqOp(u.id, studentId),
    columns: {
      id: true, name: true, email: true, phone: true, studentId: true, role: true, createdAt: true,
      cohortYear: true, leftOn: true, leftKind: true, leftReason: true, leftRecordedAt: true,
    },
  });
  if (!s || s.role !== 'student') throw new StudentError('Student not found', 404);

  const today = standingToday(s);
  const [currentSection, sections, openSeries, changes] = await Promise.all([
    sectionOf(studentId),
    sectionHistoryOf(studentId),
    db.select({ id: registrationSession.id, name: registrationSession.name, status: registrationSession.status })
      .from(registrationSession)
      .where(inArray(registrationSession.status, ['active', 'draft'])),
    db.query.auditLog.findMany({
      where: (a, { and: andOp, eq: eqOp, inArray: inArr }) => andOp(
        eqOp(a.entityType, 'user'), eqOp(a.entityId, studentId),
        inArr(a.action, ['STUDENT_COHORT_CORRECTED', 'STUDENT_COHORT_INFERRED', 'STUDENT_COHORT_RECORDED', 'STUDENT_COHORT_UNRECORDED', 'STUDENT_LEFT', 'STUDENT_READMITTED', 'USER_GRADE_CHANGED']),
      ),
      with: { user: { columns: { id: true, name: true } } },
      orderBy: (a, { desc }) => [desc(a.createdAt)],
    }),
  ]);
  const series = await Promise.all(openSeries.map(async (sess) => {
    const e = await mayRegisterFor(studentId, sess.id);
    return {
      sessionId: sess.id, name: sess.name, status: sess.status, series: e.series.label, academicYear: e.academicYear, grade: e.grade,
      allowed: e.allowed, code: e.code, reason: e.reason, graduateRetake: e.graduateRetake, grade10ExceptionId: e.grade10ExceptionId,
    };
  }));

  return {
    student: s,
    grade: today.grade,
    gradeLabel: gradeLabel(today.grade),
    standing: today.standing,
    academicYear: today.academicYear,
    cohort: s.cohortYear === null ? null : {
      year: s.cohortYear,
      label: academicYearShortLabel(s.cohortYear),
      // Grades 10–12 and the academic year of each.
      years: [0, 1, 2].map((i) => ({ grade: FIRST_GRADE + i, academicYear: academicYearShortLabel(s.cohortYear! + i) })),
    },
    section: currentSection,
    // A section of this year whose grade is no longer theirs (after a correction).
    sectionMismatch: !!currentSection && today.grade !== currentSection.grade,
    sectionHistory: sections,
    series,
    changes: changes.map((c) => ({ id: c.id, action: c.action, at: c.createdAt, by: c.user?.name ?? null, before: c.previousData, after: c.newData })),
  };
}

async function studentForUpdate(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], studentId: string) {
  const [s] = await tx
    .select({ id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, leftOn: user.leftOn, leftKind: user.leftKind, leftReason: user.leftReason })
    .from(user)
    .where(eq(user.id, studentId))
    .for('update');
  if (!s || s.role !== 'student') throw new StudentError('Student not found', 404);
  return s;
}

async function afterEligibilityChange(expired: { id: string }[], cause: EligibilityCause) {
  if (expired.length === 0) return 0;
  // After the commit: a failure here leaves the checkout to the recovery sweep.
  return closePaymentsOfExpiredRegistrations(expired.map((r) => r.id), cause).catch((err) => {
    console.error(`[student] Closing checkouts after ${cause} failed; the recovery sweep will retry:`, err);
    return 0;
  });
}

/** The admin corrects a student's cohort: either the cohort, or the grade they are in this year. */
export async function correctCohort(studentId: string, data: CorrectCohortType, actorId: string, ctx?: AuditContext) {
  const now = new Date();
  const currentYear = academicYearStartOf(now);
  const cohortYear = data.cohortYear ?? cohortFromGrade(data.gradeNow!, currentYear);
  const result = await db.transaction(async (tx) => {
    const s = await studentForUpdate(tx, studentId);
    if (s.cohortYear === cohortYear) {
      throw new StudentError(`${s.name} already started grade 10 in ${academicYearShortLabel(cohortYear)}`, 409);
    }
    await tx.update(user).set({ cohortYear, updatedAt: now }).where(eq(user.id, studentId));
    const before = { cohortYear: s.cohortYear, grade: gradeInAcademicYear(s.cohortYear, currentYear) };
    const after = { cohortYear, grade: gradeInAcademicYear(cohortYear, currentYear) };
    await logAction(actorId, 'STUDENT_COHORT_CORRECTED', 'user', studentId, before, { ...after, reason: data.reason }, ctx, tx);
    const expired = await expireIneligibleRegistrations(tx, { studentIds: [studentId] }, 'cohort_corrected', now);
    return { name: s.name, before, after, expired };
  });
  const paymentsClosed = await afterEligibilityChange(result.expired, 'cohort_corrected');
  notifyGradeChanged({
    studentId,
    studentName: result.name,
    previousGrade: result.before.grade,
    newGrade: result.after.grade,
    reason: `Corrected by the school: ${data.reason}`,
  }).catch((err) => console.error('[student] Grade notice failed:', err));
  return { cohortYear, grade: result.after.grade, registrationsExpired: result.expired.length, paymentsClosed };
}

/** The student left the school (withdrawn or transferred). */
export async function recordLeaving(studentId: string, data: RecordLeavingType, actorId: string, ctx?: AuditContext) {
  const now = new Date();
  if (data.leftOn > schoolDateString(now)) throw new StudentError('The day the student left cannot be in the future');
  const result = await db.transaction(async (tx) => {
    const s = await studentForUpdate(tx, studentId);
    if (s.leftOn) throw new StudentError(`${s.name} is already recorded as ${s.leftKind} (${s.leftOn})`, 409);
    await tx.update(user).set({
      leftOn: data.leftOn, leftKind: data.kind, leftReason: data.reason, leftRecordedBy: actorId, leftRecordedAt: now, updatedAt: now,
    }).where(eq(user.id, studentId));
    const sectionsEnded = await endOpenMemberships(tx, studentId, data.leftOn, `Left the school (${data.kind})`, actorId);
    await logAction(actorId, 'STUDENT_LEFT', 'user', studentId, { leftOn: null },
      { leftOn: data.leftOn, kind: data.kind, reason: data.reason, sectionsEnded }, ctx, tx);
    const expired = await expireIneligibleRegistrations(tx, { studentIds: [studentId] }, data.kind, now);
    return { expired, sectionsEnded };
  });
  const paymentsClosed = await afterEligibilityChange(result.expired, data.kind);
  return { registrationsExpired: result.expired.length, paymentsClosed, sectionsEnded: result.sectionsEnded };
}

/** A student who left comes back. What expired when they left stays expired. */
export async function readmit(studentId: string, reason: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const s = await studentForUpdate(tx, studentId);
    if (!s.leftOn) throw new StudentError(`${s.name} has not left the school`, 409);
    await tx.update(user).set({
      leftOn: null, leftKind: null, leftReason: null, leftRecordedBy: null, leftRecordedAt: null, updatedAt: new Date(),
    }).where(eq(user.id, studentId));
    await logAction(actorId, 'STUDENT_READMITTED', 'user', studentId,
      { leftOn: s.leftOn, kind: s.leftKind, reason: s.leftReason }, { leftOn: null, reason }, ctx, tx);
    return { readmitted: true };
  });
}

/** Students in grades 10–12 today, still at the school, with no section this year (the Sections screen's to-do). */
export async function unplacedStudentCount() {
  const current = academicYearStartOf();
  const [r] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM ${user} u
    WHERE u.role = 'student' AND u.left_on IS NULL
      AND school_grade(u.cohort_year, ${current}::integer) BETWEEN ${FIRST_GRADE} AND ${LAST_GRADE}
      AND NOT EXISTS (
        SELECT 1 FROM ${sectionMembership} m JOIN ${academicYear} y ON y.id = m.academic_year_id
        WHERE m.student_id = u.id AND m.ended_on IS NULL AND y.start_year = ${current})`)).rows as { n: number }[];
  return r?.n ?? 0;
}

