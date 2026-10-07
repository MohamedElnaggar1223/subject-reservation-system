/**
 * Course enrolment per academic year (FEATURES_PLAN.md F0b).
 *
 * What each student is taught this year: each subject or unit (a registrable
 * row), by which teacher, in school or as self-study. Staff create it at the
 * start of the year in bulk — carried forward from last year's enrolment, or
 * from the year's exam registrations (with the teacher each registration
 * names), or a whole section at a time — and by hand per student. F7's
 * import fills it through `upsertEnrolments`, the entry point the Enrolment
 * screen's paste uses too.
 *
 * It is not a registration: a student is taught all year and registers for
 * the exam in a window. The two are checked against each other
 * (`checkEnrolments`): a registration without an enrolment, or an enrolment
 * never registered, is flagged — never blocked.
 *
 * Contracts (FEATURES_PLAN.md §2; docs/features/CATALOGUE.md §7):
 * - F1: `getTeachingDemand(academicYearId)` — per subject and teacher, the
 *   students taught in school. Self-study forms no group.
 * - F4: `teacherOf(studentId, subjectId, academicYearStart)` — the teacher who
 *   gives the forecast grade (null: self-study, or none recorded).
 * - F7: `upsertEnrolments(tx, academicYearId, rows, actorId, { source: 'import', commit })`
 *   (or `batchEnrol(..., 'import')` for rows that name students and subjects as a sheet does).
 */

import {
  db, courseEnrolment, academicYear, subject, teacher, subjectTeacher, user, section, sectionMembership, registration, registrationSession,
  sessionOfferItem, sessionOfferItemUnit, examUnit,
  eq, and, inArray, isNull, sql, asc, or,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  academicYearShortLabel, academicYearStartOf, gradeInAcademicYear, schoolDateString, seriesAcademicYearStart,
  type CreateEnrolmentType, type UpdateEnrolmentType, type EndEnrolmentType, type BulkEnrolType, type EnrolSectionType,
  type BatchEnrolRowType, type ListEnrolmentsQueryType, type EnrolmentMode, type EnrolmentSource,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** A refusal with the status the route answers. */
export class EnrolmentError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const LIVE_REGISTRATION = sql`${registration.status} not in ('rejected', 'expired', 'dropped')`;

async function yearOrThrow(id: string, executor: Executor = db) {
  const [y] = await executor.select().from(academicYear).where(eq(academicYear.id, id));
  if (!y) throw new EnrolmentError('Academic year not found — set the year up on the Academic year screen first', 404);
  return y;
}

/** The academic year row of today (Cairo), if the school has set it up. */
export async function currentAcademicYear() {
  const [y] = await db.select().from(academicYear).where(eq(academicYear.startYear, academicYearStartOf()));
  return y ?? null;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Enrolments of a year, narrowed by student, section, subject, teacher or mode. */
export async function listEnrolments(filters: ListEnrolmentsQueryType) {
  const y = await yearOrThrow(filters.academicYearId);
  let studentIds: string[] | undefined;
  if (filters.sectionId) {
    studentIds = (await db.select({ id: sectionMembership.studentId }).from(sectionMembership)
      .where(and(eq(sectionMembership.sectionId, filters.sectionId), isNull(sectionMembership.endedOn)))).map((r) => r.id);
    if (!studentIds.length) return [];
  }
  const rows = await db
    .select({
      id: courseEnrolment.id, studentId: courseEnrolment.studentId, subjectId: courseEnrolment.subjectId, teacherId: courseEnrolment.teacherId,
      mode: courseEnrolment.mode, source: courseEnrolment.source, sourceRef: courseEnrolment.sourceRef,
      startedOn: courseEnrolment.startedOn, endedOn: courseEnrolment.endedOn, endReason: courseEnrolment.endReason,
      studentName: user.name, studentCode: user.studentId, cohortYear: user.cohortYear,
      subjectName: subject.name, subjectCode: subject.code, subjectLevel: subject.qualificationLevel, council: subject.council,
      teacherName: teacher.name,
    })
    .from(courseEnrolment)
    .innerJoin(user, eq(user.id, courseEnrolment.studentId))
    .innerJoin(subject, eq(subject.id, courseEnrolment.subjectId))
    .leftJoin(teacher, eq(teacher.id, courseEnrolment.teacherId))
    .where(and(
      eq(courseEnrolment.academicYearId, y.id),
      filters.includeEnded ? undefined : isNull(courseEnrolment.endedOn),
      filters.studentId ? eq(courseEnrolment.studentId, filters.studentId) : undefined,
      studentIds ? inArray(courseEnrolment.studentId, studentIds) : undefined,
      filters.subjectId ? eq(courseEnrolment.subjectId, filters.subjectId) : undefined,
      filters.teacherId ? eq(courseEnrolment.teacherId, filters.teacherId) : undefined,
      filters.mode ? eq(courseEnrolment.mode, filters.mode) : undefined,
    ))
    .orderBy(asc(user.name), asc(subject.name));
  const sections = await sectionsOf(rows.map((r) => r.studentId), y.id);
  return rows.map((r) => ({
    ...r,
    gradeThatYear: gradeInAcademicYear(r.cohortYear, y.startYear),
    section: sections.get(r.studentId) ?? null,
  }));
}

async function sectionsOf(studentIds: string[], academicYearId: string, executor: Executor = db) {
  if (!studentIds.length) return new Map<string, { id: string; name: string }>();
  const rows = await executor.select({ studentId: sectionMembership.studentId, id: section.id, name: section.name })
    .from(sectionMembership).innerJoin(section, eq(section.id, sectionMembership.sectionId))
    .where(and(inArray(sectionMembership.studentId, [...new Set(studentIds)]), eq(sectionMembership.academicYearId, academicYearId), isNull(sectionMembership.endedOn)));
  return new Map(rows.map((r) => [r.studentId, { id: r.id, name: r.name }]));
}

/**
 * One student's year: their enrolments (history included) and the flags
 * against their registrations. What the per-student screen, the student's
 * record and the family's own view read.
 */
export async function getStudentEnrolments(studentId: string, academicYearId?: string) {
  const [student] = await db.select({ id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, studentCode: user.studentId, leftOn: user.leftOn })
    .from(user).where(eq(user.id, studentId));
  if (!student || student.role !== 'student') throw new EnrolmentError('Student not found', 404);
  const y = academicYearId ? await yearOrThrow(academicYearId) : await currentAcademicYear();
  if (!y) return { student: { ...student, grade: null }, academicYear: null, enrolments: [], flags: emptyFlags() };
  const enrolments = await listEnrolments({ academicYearId: y.id, studentId, includeEnded: true });
  const flags = await checkEnrolments(y.id, studentId);
  return {
    student: { id: student.id, name: student.name, studentCode: student.studentCode, leftOn: student.leftOn, grade: gradeInAcademicYear(student.cohortYear, y.startYear) },
    academicYear: { id: y.id, startYear: y.startYear, label: academicYearShortLabel(y.startYear) },
    enrolments,
    flags,
  };
}

// ─── Rules for one enrolment ─────────────────────────────────────────────────

type StudentRow = { id: string; name: string; role: string | null; cohortYear: number | null; leftOn: string | null };
type SubjectRow = { id: string; name: string; code: string; isActive: boolean; isOfferedAtSchool: boolean };

/** Why this student cannot be enrolled in this year, or null. */
function studentMisfit(st: StudentRow | undefined, startYear: number): string | null {
  if (!st || st.role !== 'student') return 'Not a student';
  if (st.leftOn) return `${st.name} has left the school`;
  const g = gradeInAcademicYear(st.cohortYear, startYear);
  if (g === null) return `${st.name}'s grade is not recorded`;
  if (g < 10) return `${st.name} starts grade 10 after ${academicYearShortLabel(startYear)}`;
  if (g > 12) return `${st.name} has finished grade 12 by ${academicYearShortLabel(startYear)}`;
  return null;
}

/** Why this subject cannot be taught this way, or null. */
function subjectMisfit(s: SubjectRow | undefined, mode: EnrolmentMode): string | null {
  if (!s) return 'Subject not found';
  if (!s.isActive) return `${s.name} is no longer offered`;
  if (mode === 'in_school' && !s.isOfferedAtSchool) return `The school does not teach ${s.name} — enrol it as self-study`;
  return null;
}

/**
 * A teacher is linked to the subjects they teach (subject_teacher): F1's
 * cover and the registration picker read the link. Assigning a teacher to an
 * enrolment of a subject records the link if it is missing.
 */
async function linkTeacher(tx: Tx, teacherId: string, subjectId: string) {
  const inserted = await tx.insert(subjectTeacher).values({ id: randomUUID(), subjectId, teacherId }).onConflictDoNothing().returning({ id: subjectTeacher.id });
  return inserted.length > 0;
}

async function teacherOrThrow(tx: Tx, teacherId: string) {
  const [t] = await tx.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(teacher).where(eq(teacher.id, teacherId));
  if (!t) throw new EnrolmentError('Teacher not found', 404);
  if (!t.isActive) throw new EnrolmentError(`${t.name} is inactive`);
  return t;
}

function clampStart(y: { startsOn: string; endsOn: string }, wanted?: string) {
  const today = schoolDateString(new Date());
  const start = wanted ?? (today < y.startsOn ? y.startsOn : today > y.endsOn ? y.endsOn : today);
  if (start < y.startsOn || start > y.endsOn) throw new EnrolmentError(`The start date falls inside the school year (${y.startsOn} – ${y.endsOn})`);
  return start;
}

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string } | null)?.code === '23505' || (err as { cause?: { code?: string } } | null)?.cause?.code === '23505';

// ─── One at a time ───────────────────────────────────────────────────────────

export async function createEnrolment(data: CreateEnrolmentType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const y = await yearOrThrow(data.academicYearId, tx);
      const [st] = await tx.select({ id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, leftOn: user.leftOn })
        .from(user).where(eq(user.id, data.studentId)).for('share');
      const sm = studentMisfit(st, y.startYear);
      if (sm) throw new EnrolmentError(sm, sm === 'Not a student' ? 404 : 400);
      const [s] = await tx.select({ id: subject.id, name: subject.name, code: subject.code, isActive: subject.isActive, isOfferedAtSchool: subject.isOfferedAtSchool })
        .from(subject).where(eq(subject.id, data.subjectId));
      const subm = subjectMisfit(s, data.mode);
      if (subm) throw new EnrolmentError(subm, subm === 'Subject not found' ? 404 : 400);
      const teacherId = data.mode === 'self_study' ? null : data.teacherId ?? null;
      let linked = false;
      if (teacherId) {
        await teacherOrThrow(tx, teacherId);
        linked = await linkTeacher(tx, teacherId, data.subjectId);
      }
      const [created] = await tx.insert(courseEnrolment).values({
        id: randomUUID(), academicYearId: y.id, studentId: data.studentId, subjectId: data.subjectId, teacherId,
        mode: data.mode, source: 'manual', startedOn: clampStart(y, data.startedOn), createdBy: actorId,
      }).returning();
      await logAction(actorId, 'ENROLMENT_CREATED', 'enrolment', created!.id, null, { ...created, teacherLinkedToSubject: linked }, ctx, tx);
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new EnrolmentError('This student is already enrolled in that subject this year', 409);
    throw err;
  }
}

/** Change an enrolment's teacher or mode (self-study has no teacher). */
export async function updateEnrolment(id: string, data: UpdateEnrolmentType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(courseEnrolment).where(eq(courseEnrolment.id, id)).for('update');
    if (!e) throw new EnrolmentError('Enrolment not found', 404);
    if (e.endedOn) throw new EnrolmentError('This enrolment has ended — enrol the student again instead', 409);
    const mode = data.mode ?? (e.mode as EnrolmentMode);
    const [s] = await tx.select({ id: subject.id, name: subject.name, code: subject.code, isActive: subject.isActive, isOfferedAtSchool: subject.isOfferedAtSchool })
      .from(subject).where(eq(subject.id, e.subjectId));
    if (mode === 'in_school' && s && !s.isOfferedAtSchool) throw new EnrolmentError(`The school does not teach ${s.name} — it stays self-study`);
    const teacherId = mode === 'self_study' ? null : data.teacherId !== undefined ? data.teacherId : e.teacherId;
    let linked = false;
    if (teacherId && teacherId !== e.teacherId) {
      await teacherOrThrow(tx, teacherId);
      linked = await linkTeacher(tx, teacherId, e.subjectId);
    }
    const [updated] = await tx.update(courseEnrolment).set({ mode, teacherId, updatedAt: new Date() }).where(eq(courseEnrolment.id, id)).returning();
    await logAction(actorId, 'ENROLMENT_UPDATED', 'enrolment', id, { mode: e.mode, teacherId: e.teacherId }, { mode, teacherId, teacherLinkedToSubject: linked }, ctx, tx);
    return updated!;
  });
}

/** End an enrolment (the student stopped the subject): history is kept. */
export async function endEnrolment(id: string, data: EndEnrolmentType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(courseEnrolment).where(eq(courseEnrolment.id, id)).for('update');
    if (!e) throw new EnrolmentError('Enrolment not found', 404);
    if (e.endedOn) throw new EnrolmentError('This enrolment already ended', 409);
    const endedOn = data.endedOn ?? schoolDateString(new Date());
    if (endedOn < e.startedOn) throw new EnrolmentError('An enrolment cannot end before it started');
    const [updated] = await tx.update(courseEnrolment).set({ endedOn, endReason: data.reason, endedBy: actorId, updatedAt: new Date() })
      .where(eq(courseEnrolment.id, id)).returning();
    await logAction(actorId, 'ENROLMENT_ENDED', 'enrolment', id, { endedOn: null }, { endedOn, reason: data.reason }, ctx, tx);
    return updated!;
  });
}

/** End a student's open enrolments when they leave the school (F0a's leaving), in its transaction. */
export async function endOpenEnrolments(tx: Tx, studentId: string, endedOn: string, reason: string, actorId: string) {
  const open = await tx.select({ id: courseEnrolment.id, startedOn: courseEnrolment.startedOn }).from(courseEnrolment)
    .where(and(eq(courseEnrolment.studentId, studentId), isNull(courseEnrolment.endedOn))).for('update');
  for (const e of open) {
    await tx.update(courseEnrolment)
      .set({ endedOn: endedOn < e.startedOn ? e.startedOn : endedOn, endReason: reason, endedBy: actorId, updatedAt: new Date() })
      .where(eq(courseEnrolment.id, e.id));
  }
  return open.length;
}

// ─── Many at once: the shared entry point (and F7's) ─────────────────────────

export type EnrolmentRowInput = {
  studentId: string;
  subjectId: string;
  /**
   * The unit, when the enrolment is per unit (the reservations rework, §3.2 and §10: a line of
   * an item entering units — a Pearson IAL paper — is taught per unit, its own teacher each).
   * One open enrolment per (student, unit, year) with one, per (student, subject, year) without.
   */
  unitId?: string | null;
  teacherId: string | null;
  mode: EnrolmentMode;
  sourceRef?: string | null;
};

/** What makes an enrolment one: its unit when it has one, else its subject (the two unique indexes). */
const enrolmentKey = (r: { studentId: string; subjectId: string; unitId?: string | null }) =>
  r.unitId ? `${r.studentId}|u:${r.unitId}` : `${r.studentId}|${r.subjectId}`;

export type EnrolmentRowOutcome = EnrolmentRowInput & {
  outcome: 'create' | 'created' | 'exists' | 'refused';
  reason: string | null;
};

/**
 * Create enrolments for many (student, subject) pairs in the caller's
 * transaction — the one entry point for the bulk steps, the section step,
 * the screen's paste and F7's import. Each row is judged on its own: a
 * student not in school that year, a subject not offered, an inactive
 * teacher refuse that row with its reason; a pair already enrolled is left as
 * it is ("exists"). With `commit` false nothing is written (the preview).
 * Idempotent: running the same rows again creates nothing new, and two runs
 * at the same moment create each enrolment once (the database's one open
 * enrolment per student, subject and year).
 */
export async function upsertEnrolments(
  tx: Tx,
  academicYearId: string,
  rows: EnrolmentRowInput[],
  actorId: string,
  opts: { source: EnrolmentSource; commit: boolean; ctx?: AuditContext },
): Promise<{ rows: EnrolmentRowOutcome[]; created: number; teacherLinks: number }> {
  const y = await yearOrThrow(academicYearId, tx);
  const startedOn = clampStart(y);
  const studentIds = [...new Set(rows.map((r) => r.studentId))];
  const subjectIds = [...new Set(rows.map((r) => r.subjectId))];
  const teacherIds = [...new Set(rows.map((r) => r.teacherId).filter((t): t is string => !!t))];
  // The students FOR SHARE, in id order, as a single enrolment reads its
  // student: a leaving (which holds the student FOR UPDATE while it ends every
  // open enrolment) and this run one after the other, so no enrolment is made
  // for a student whose leaving has just ended the others.
  const students = studentIds.length
    ? await tx.select({ id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, leftOn: user.leftOn })
        .from(user).where(inArray(user.id, studentIds)).orderBy(user.id).for('share')
    : [];
  const [subjects, teachers, existing] = await Promise.all([
    subjectIds.length ? tx.select({ id: subject.id, name: subject.name, code: subject.code, isActive: subject.isActive, isOfferedAtSchool: subject.isOfferedAtSchool }).from(subject).where(inArray(subject.id, subjectIds)) : [],
    teacherIds.length ? tx.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(teacher).where(inArray(teacher.id, teacherIds)) : [],
    studentIds.length
      ? tx.select({ studentId: courseEnrolment.studentId, subjectId: courseEnrolment.subjectId, unitId: courseEnrolment.unitId }).from(courseEnrolment)
          .where(and(eq(courseEnrolment.academicYearId, y.id), isNull(courseEnrolment.endedOn), inArray(courseEnrolment.studentId, studentIds)))
      : [],
  ]);
  const studentBy = new Map(students.map((s) => [s.id, s]));
  const subjectBy = new Map(subjects.map((s) => [s.id, s]));
  const teacherBy = new Map(teachers.map((t) => [t.id, t]));
  const enrolled = new Set(existing.map(enrolmentKey));
  const seen = new Set<string>();

  const out: EnrolmentRowOutcome[] = rows.map((r) => {
    const key = enrolmentKey(r);
    const teacherId = r.mode === 'self_study' ? null : r.teacherId;
    const base = { ...r, teacherId };
    const refuse = (reason: string): EnrolmentRowOutcome => ({ ...base, outcome: 'refused', reason });
    const sm = studentMisfit(studentBy.get(r.studentId), y.startYear);
    if (sm) return refuse(sm);
    const subm = subjectMisfit(subjectBy.get(r.subjectId), r.mode);
    if (subm) return refuse(subm);
    if (teacherId) {
      const t = teacherBy.get(teacherId);
      if (!t) return refuse('Teacher not found');
      if (!t.isActive) return refuse(`${t.name} is inactive`);
    }
    if (enrolled.has(key) || seen.has(key)) return { ...base, outcome: 'exists', reason: null };
    seen.add(key);
    return { ...base, outcome: 'create', reason: null };
  });

  if (!opts.commit) return { rows: out, created: 0, teacherLinks: 0 };

  const toCreate = out.filter((r) => r.outcome === 'create');
  let created = 0;
  let teacherLinks = 0;
  if (toCreate.length) {
    // One run at a time per year: a second waits, then finds these rows.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'enrolment:' + y.id}))`);
    const inserted = await tx.insert(courseEnrolment).values(toCreate.map((r) => ({
      id: randomUUID(), academicYearId: y.id, studentId: r.studentId, subjectId: r.subjectId, unitId: r.unitId ?? null, teacherId: r.teacherId,
      mode: r.mode, source: opts.source, sourceRef: r.sourceRef ?? null, startedOn, createdBy: actorId,
    }))).onConflictDoNothing().returning({ studentId: courseEnrolment.studentId, subjectId: courseEnrolment.subjectId, unitId: courseEnrolment.unitId });
    const made = new Set(inserted.map(enrolmentKey));
    for (const r of toCreate) r.outcome = made.has(enrolmentKey(r)) ? 'created' : 'exists';
    created = inserted.length;
    for (const pair of new Set(toCreate.filter((r) => r.teacherId && r.outcome === 'created').map((r) => `${r.teacherId}|${r.subjectId}`))) {
      const [t, s] = pair.split('|') as [string, string];
      if (await linkTeacher(tx, t, s)) teacherLinks++;
    }
    if (created) {
      await logAction(actorId, 'ENROLMENTS_BULK_CREATED', 'academic_year', y.id, null,
        { source: opts.source, created, teacherLinks, rows: toCreate.filter((r) => r.outcome === 'created').map((r) => ({ studentId: r.studentId, subjectId: r.subjectId, ...(r.unitId ? { unitId: r.unitId } : {}), teacherId: r.teacherId, mode: r.mode })) },
        opts.ctx, tx);
    }
  }
  return { rows: out, created, teacherLinks };
}

async function namesFor(rows: EnrolmentRowOutcome[]) {
  const studentIds = [...new Set(rows.map((r) => r.studentId))];
  const subjectIds = [...new Set(rows.map((r) => r.subjectId))];
  const teacherIds = [...new Set(rows.map((r) => r.teacherId).filter((t): t is string => !!t))];
  const [st, su, te] = await Promise.all([
    studentIds.length ? db.select({ id: user.id, name: user.name, code: user.studentId }).from(user).where(inArray(user.id, studentIds)) : [],
    subjectIds.length ? db.select({ id: subject.id, name: subject.name, code: subject.code }).from(subject).where(inArray(subject.id, subjectIds)) : [],
    teacherIds.length ? db.select({ id: teacher.id, name: teacher.name }).from(teacher).where(inArray(teacher.id, teacherIds)) : [],
  ]);
  const s = new Map(st.map((x) => [x.id, x]));
  const u = new Map(su.map((x) => [x.id, x]));
  const t = new Map(te.map((x) => [x.id, x]));
  return rows.map((r) => ({
    ...r,
    studentName: s.get(r.studentId)?.name ?? null,
    studentCode: s.get(r.studentId)?.code ?? null,
    subjectName: u.get(r.subjectId)?.name ?? null,
    subjectCode: u.get(r.subjectId)?.code ?? null,
    teacherName: r.teacherId ? t.get(r.teacherId)?.name ?? null : null,
  }));
}

function summarise(rows: EnrolmentRowOutcome[]) {
  return {
    toCreate: rows.filter((r) => r.outcome === 'create').length,
    created: rows.filter((r) => r.outcome === 'created').length,
    existing: rows.filter((r) => r.outcome === 'exists').length,
    refused: rows.filter((r) => r.outcome === 'refused').length,
  };
}

/** Students of the given sections (this year's open membership), or null for "everyone". */
async function studentsOfSections(sectionIds: string[] | undefined, academicYearId: string) {
  if (!sectionIds?.length) return null;
  const rows = await db.select({ id: sectionMembership.studentId }).from(sectionMembership)
    .where(and(inArray(sectionMembership.sectionId, sectionIds), eq(sectionMembership.academicYearId, academicYearId), isNull(sectionMembership.endedOn)));
  return new Set(rows.map((r) => r.id));
}

/**
 * The year's enrolments in bulk, preview then commit.
 * - previous_enrolment: last year's open enrolments (in school and
 *   self-study, with their teacher), for students still in school this year;
 *   `subjectMap` replaces a finished subject by the one that follows it
 *   ("AS units → A2 units"), or drops it (to: null).
 * - registrations: the live exam registrations of the series in the chosen
 *   academic year (default: this one), with the teacher each registration
 *   names (`registration.teacherId`), self-study where it was taken outside
 *   school.
 */
export async function bulkEnrol(data: BulkEnrolType, actorId: string, ctx?: AuditContext) {
  const y = await yearOrThrow(data.academicYearId);
  const inSections = await studentsOfSections(data.sectionIds, y.id);
  const onlyStudents = data.studentIds?.length ? new Set(data.studentIds) : null;
  const exclude = new Set(data.exclude);
  const subjectMap = new Map(data.subjectMap.map((m) => [m.from, m.to]));
  let candidates: EnrolmentRowInput[] = [];
  let sourceYearLabel: string;

  if (data.source === 'previous_enrolment') {
    const [prev] = await db.select().from(academicYear).where(eq(academicYear.startYear, y.startYear - 1));
    sourceYearLabel = academicYearShortLabel(y.startYear - 1);
    if (prev) {
      const rows = await db.select().from(courseEnrolment)
        .where(and(eq(courseEnrolment.academicYearId, prev.id), isNull(courseEnrolment.endedOn)))
        .orderBy(courseEnrolment.studentId, courseEnrolment.subjectId);
      candidates = rows.flatMap((r) => {
        const to = subjectMap.has(r.subjectId) ? subjectMap.get(r.subjectId)! : r.subjectId;
        if (!to) return [];
        // A unit's enrolment carries its unit while its subject carries on; mapped to another subject, it is the subject's.
        return [{ studentId: r.studentId, subjectId: to, unitId: to === r.subjectId ? r.unitId : null, teacherId: r.teacherId, mode: r.mode as EnrolmentMode, sourceRef: `enrolment:${r.id}` }];
      });
    }
  } else {
    const regYear = data.registrationYear ?? y.startYear;
    sourceYearLabel = academicYearShortLabel(regYear);
    const rows = await db
      .select({
        id: registration.id, studentId: registration.studentId, subjectId: registration.subjectId, teacherId: registration.teacherId,
        outside: registration.takenOutsideSchool, mode: registration.mode, itemId: registration.offerItemId, entersKind: sessionOfferItem.entersKind,
      })
      .from(registration)
      .innerJoin(registrationSession, eq(registrationSession.id, registration.sessionId))
      .innerJoin(sessionOfferItem, eq(sessionOfferItem.id, registration.offerItemId))
      .where(and(LIVE_REGISTRATION, sql`school_series_academic_year_start(${registrationSession.sessionType}, ${registrationSession.seriesYear}) = ${regYear}`))
      .orderBy(registration.studentId, registration.subjectId, registration.createdAt);
    // A line of an item entering units is taught per unit: one enrolment per unit, the line's teacher each.
    const unitItems = [...new Set(rows.filter((r) => r.entersKind === 'units').map((r) => r.itemId))];
    const unitsOf = new Map<string, string[]>();
    if (unitItems.length) {
      for (const u of await db.select().from(sessionOfferItemUnit).where(inArray(sessionOfferItemUnit.itemId, unitItems)).orderBy(sessionOfferItemUnit.unitId)) {
        unitsOf.set(u.itemId, [...(unitsOf.get(u.itemId) ?? []), u.unitId]);
      }
    }
    candidates = rows.flatMap((r): EnrolmentRowInput[] => {
      const to = subjectMap.has(r.subjectId) ? subjectMap.get(r.subjectId)! : r.subjectId;
      if (!to) return [];
      const selfStudy = r.outside || r.mode === 'self_study';
      const base = { studentId: r.studentId, subjectId: to, teacherId: selfStudy ? null : r.teacherId, mode: (selfStudy ? 'self_study' : 'in_school') as EnrolmentMode, sourceRef: `registration:${r.id}` };
      const units = to === r.subjectId ? unitsOf.get(r.itemId) ?? [] : [];
      return units.length ? units.map((unitId) => ({ ...base, unitId })) : [{ ...base, unitId: null }];
    });
  }
  // One row per (student, subject), or per (student, unit): the first source row wins.
  const byPair = new Map<string, EnrolmentRowInput>();
  for (const c of candidates) {
    if (inSections && !inSections.has(c.studentId)) continue;
    if (onlyStudents && !onlyStudents.has(c.studentId)) continue;
    const key = enrolmentKey(c);
    if (exclude.has(`${c.studentId}|${c.subjectId}`) || byPair.has(key)) continue;
    byPair.set(key, c);
  }
  const result = await db.transaction((tx) => upsertEnrolments(tx, y.id, [...byPair.values()], actorId, {
    source: data.source === 'previous_enrolment' ? 'carried_forward' : 'registrations', commit: data.commit, ctx,
  }));
  return {
    academicYear: { id: y.id, label: academicYearShortLabel(y.startYear) },
    source: data.source,
    from: sourceYearLabel,
    committed: data.commit,
    summary: summarise(result.rows),
    teacherLinks: result.teacherLinks,
    rows: await namesFor(result.rows),
  };
}

/** Enrol every current member of a section in subjects, one teacher each. */
export async function enrolSection(data: EnrolSectionType, actorId: string, ctx?: AuditContext) {
  const [s] = await db.select().from(section).where(eq(section.id, data.sectionId));
  if (!s) throw new EnrolmentError('Section not found', 404);
  const members = await db.select({ id: sectionMembership.studentId }).from(sectionMembership)
    .where(and(eq(sectionMembership.sectionId, s.id), isNull(sectionMembership.endedOn)));
  const skip = new Set(data.excludeStudentIds);
  const rows: EnrolmentRowInput[] = members
    .filter((m) => !skip.has(m.id))
    .flatMap((m) => data.subjects.map((sub) => ({
      studentId: m.id, subjectId: sub.subjectId, teacherId: sub.mode === 'self_study' ? null : sub.teacherId ?? null, mode: sub.mode, sourceRef: `section:${s.id}`,
    })));
  if (!rows.length) throw new EnrolmentError(`${s.name} has no students yet — add them on the Sections screen first`);
  const result = await db.transaction((tx) => upsertEnrolments(tx, s.academicYearId, rows, actorId, { source: 'section', commit: true, ctx }));
  return { section: { id: s.id, name: s.name }, summary: summarise(result.rows), teacherLinks: result.teacherLinks, rows: await namesFor(result.rows) };
}

/**
 * Rows from a sheet — the Enrolment screen's paste, and F7's import: each
 * names the student by the school's student ID, email or id; the subject by
 * its code, name or id; the teacher by name or id. Each row resolves or is
 * refused with its reason; preview first, then commit.
 */
export async function batchEnrol(academicYearId: string, input: BatchEnrolRowType[], commit: boolean, actorId: string, ctx?: AuditContext, source: EnrolmentSource = 'manual') {
  const y = await yearOrThrow(academicYearId);
  const terms = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase()))];
  const sTerms = terms(input.map((r) => r.student));
  const subTerms = terms(input.map((r) => r.subject));
  const tTerms = terms(input.map((r) => r.teacher ?? '').filter(Boolean));
  const [students, subjects, teachers] = await Promise.all([
    db.select({ id: user.id, email: user.email, code: user.studentId }).from(user)
      .where(and(eq(user.role, 'student'), or(inArray(sql`lower(${user.email})`, sTerms), inArray(sql`lower(${user.studentId})`, sTerms), inArray(user.id, input.map((r) => r.student.trim()))))),
    db.select({ id: subject.id, code: subject.code, name: subject.name }).from(subject)
      .where(or(inArray(sql`lower(${subject.code})`, subTerms), inArray(sql`lower(${subject.name})`, subTerms), inArray(subject.id, input.map((r) => r.subject.trim())))),
    tTerms.length
      ? db.select({ id: teacher.id, name: teacher.name }).from(teacher)
          .where(or(inArray(sql`lower(${teacher.name})`, tTerms), inArray(teacher.id, input.map((r) => (r.teacher ?? '').trim()))))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const findStudent = (t: string) => {
    const k = t.trim().toLowerCase();
    return students.filter((s) => s.id === t.trim() || s.email.toLowerCase() === k || (s.code ?? '').toLowerCase() === k);
  };
  const findSubject = (t: string) => {
    const k = t.trim().toLowerCase();
    return subjects.filter((s) => s.id === t.trim() || s.code.toLowerCase() === k || s.name.toLowerCase() === k);
  };
  const findTeacher = (t: string) => {
    const k = t.trim().toLowerCase();
    return teachers.filter((x) => x.id === t.trim() || x.name.toLowerCase() === k);
  };

  const unresolved: { line: number; row: BatchEnrolRowType; reason: string }[] = [];
  const resolved: (EnrolmentRowInput & { line: number })[] = [];
  input.forEach((row, i) => {
    const st = findStudent(row.student);
    const su = findSubject(row.subject);
    const te = row.teacher ? findTeacher(row.teacher) : [];
    const why =
      st.length === 0 ? `No student with the ID or email "${row.student}"` :
      st.length > 1 ? `"${row.student}" matches more than one student` :
      su.length === 0 ? `No subject with the code or name "${row.subject}"` :
      su.length > 1 ? `"${row.subject}" matches more than one subject — use its code` :
      row.teacher && te.length === 0 ? `No teacher named "${row.teacher}"` :
      row.teacher && te.length > 1 ? `"${row.teacher}" matches more than one teacher` : null;
    if (why) unresolved.push({ line: i + 1, row, reason: why });
    else resolved.push({ line: i + 1, studentId: st[0]!.id, subjectId: su[0]!.id, teacherId: te[0]?.id ?? null, mode: row.mode, sourceRef: row.ref ?? `line ${i + 1}` });
  });
  const result = await db.transaction((tx) => upsertEnrolments(tx, y.id, resolved, actorId, { source, commit, ctx }));
  const named = await namesFor(result.rows);
  return {
    academicYear: { id: y.id, label: academicYearShortLabel(y.startYear) },
    committed: commit,
    summary: { ...summarise(result.rows), unresolved: unresolved.length },
    rows: named.map((r, i) => ({ ...r, line: resolved[i]!.line })),
    unresolved,
  };
}

// ─── Registrations against enrolments ────────────────────────────────────────

function emptyFlags() {
  return { registeredNotEnrolled: [], enrolledNotRegistered: [], modeDiffers: [], teacherDiffers: [] } as {
    registeredNotEnrolled: FlagRow[]; enrolledNotRegistered: FlagRow[]; modeDiffers: FlagRow[]; teacherDiffers: FlagRow[];
  };
}

type FlagRow = {
  studentId: string; studentName: string; studentCode: string | null; section: string | null;
  subjectId: string; subjectName: string; subjectCode: string;
  registrationId: string | null; window: string | null; registrationStatus: string | null; takenOutsideSchool: boolean | null; registrationTeacher: string | null; registrationTeacherId: string | null;
  enrolmentId: string | null; mode: string | null; teacherName: string | null;
};

/**
 * Exam registrations of the year's series checked against the year's
 * enrolments — flagged, never blocked:
 * - registered, not enrolled: a live registration with no open enrolment in
 *   that subject that year;
 * - enrolled, not registered: an open enrolment with no live registration
 *   in any window of that year (yet — June's window opens in February);
 * - mode differs: self-study enrolment and an in-school registration, or the
 *   other way round;
 * - teacher differs: the registration names another teacher.
 */
export async function checkEnrolments(academicYearId: string, studentId?: string) {
  const y = await yearOrThrow(academicYearId);
  const regs = await db
    .select({
      id: registration.id, studentId: registration.studentId, subjectId: registration.subjectId, status: registration.status,
      outside: registration.takenOutsideSchool, teacherId: registration.teacherId, window: registrationSession.name,
    })
    .from(registration)
    .innerJoin(registrationSession, eq(registrationSession.id, registration.sessionId))
    .where(and(
      LIVE_REGISTRATION,
      sql`school_series_academic_year_start(${registrationSession.sessionType}, ${registrationSession.seriesYear}) = ${y.startYear}`,
      studentId ? eq(registration.studentId, studentId) : undefined,
    ));
  const enrols = await db.select().from(courseEnrolment)
    .where(and(eq(courseEnrolment.academicYearId, y.id), isNull(courseEnrolment.endedOn), studentId ? eq(courseEnrolment.studentId, studentId) : undefined));
  const studentIds = [...new Set([...regs.map((r) => r.studentId), ...enrols.map((e) => e.studentId)])];
  const subjectIds = [...new Set([...regs.map((r) => r.subjectId), ...enrols.map((e) => e.subjectId)])];
  const teacherIds = [...new Set([...regs.map((r) => r.teacherId), ...enrols.map((e) => e.teacherId)].filter((t): t is string => !!t))];
  const [students, subjects, teachers, sections] = await Promise.all([
    studentIds.length ? db.select({ id: user.id, name: user.name, code: user.studentId }).from(user).where(inArray(user.id, studentIds)) : [],
    subjectIds.length ? db.select({ id: subject.id, name: subject.name, code: subject.code }).from(subject).where(inArray(subject.id, subjectIds)) : [],
    teacherIds.length ? db.select({ id: teacher.id, name: teacher.name }).from(teacher).where(inArray(teacher.id, teacherIds)) : [],
    sectionsOf(studentIds, y.id),
  ]);
  const st = new Map(students.map((s) => [s.id, s]));
  const su = new Map(subjects.map((s) => [s.id, s]));
  const te = new Map(teachers.map((t) => [t.id, t.name]));
  const enrolBy = new Map(enrols.map((e) => [`${e.studentId}|${e.subjectId}`, e]));
  const regsBy = new Map<string, typeof regs>();
  for (const r of regs) regsBy.set(`${r.studentId}|${r.subjectId}`, [...(regsBy.get(`${r.studentId}|${r.subjectId}`) ?? []), r]);

  const row = (sid: string, subId: string, r: (typeof regs)[number] | null, e: (typeof enrols)[number] | null): FlagRow => ({
    studentId: sid, studentName: st.get(sid)?.name ?? '', studentCode: st.get(sid)?.code ?? null, section: sections.get(sid)?.name ?? null,
    subjectId: subId, subjectName: su.get(subId)?.name ?? '', subjectCode: su.get(subId)?.code ?? '',
    registrationId: r?.id ?? null, window: r?.window ?? null, registrationStatus: r?.status ?? null, takenOutsideSchool: r?.outside ?? null,
    registrationTeacher: r?.teacherId ? te.get(r.teacherId) ?? null : null, registrationTeacherId: r?.teacherId ?? null,
    enrolmentId: e?.id ?? null, mode: e?.mode ?? null, teacherName: e?.teacherId ? te.get(e.teacherId) ?? null : null,
  });
  const flags = emptyFlags();
  for (const r of regs) {
    const e = enrolBy.get(`${r.studentId}|${r.subjectId}`);
    if (!e) { flags.registeredNotEnrolled.push(row(r.studentId, r.subjectId, r, null)); continue; }
    if ((e.mode === 'self_study') !== r.outside) flags.modeDiffers.push(row(r.studentId, r.subjectId, r, e));
    if (r.teacherId && e.teacherId && r.teacherId !== e.teacherId) flags.teacherDiffers.push(row(r.studentId, r.subjectId, r, e));
  }
  for (const e of enrols) {
    if (!regsBy.has(`${e.studentId}|${e.subjectId}`)) flags.enrolledNotRegistered.push(row(e.studentId, e.subjectId, null, e));
  }
  const byName = (a: FlagRow, b: FlagRow) => a.studentName.localeCompare(b.studentName) || a.subjectName.localeCompare(b.subjectName);
  flags.registeredNotEnrolled.sort(byName);
  flags.enrolledNotRegistered.sort(byName);
  flags.modeDiffers.sort(byName);
  flags.teacherDiffers.sort(byName);
  return flags;
}

// ─── Contracts for F1 and F4, and the teacher's own classes ──────────────────

/**
 * F1's contract: per subject, unit (when the enrolments are per unit) and teacher, the students
 * taught in school this year (a teaching group's source). Self-study enrolments are not taught and
 * form no group; enrolments with no teacher yet form one group per subject
 * with `teacherId` null.
 */
export async function getTeachingDemand(academicYearId: string) {
  const y = await yearOrThrow(academicYearId);
  const rows = await db
    .select({
      subjectId: courseEnrolment.subjectId, unitId: courseEnrolment.unitId, unitCode: examUnit.code, teacherId: courseEnrolment.teacherId, studentId: courseEnrolment.studentId,
      subjectName: subject.name, subjectCode: subject.code, qualificationLevel: subject.qualificationLevel, teacherName: teacher.name, studentName: user.name,
    })
    .from(courseEnrolment)
    .innerJoin(subject, eq(subject.id, courseEnrolment.subjectId))
    .innerJoin(user, eq(user.id, courseEnrolment.studentId))
    .leftJoin(teacher, eq(teacher.id, courseEnrolment.teacherId))
    .leftJoin(examUnit, eq(examUnit.id, courseEnrolment.unitId))
    .where(and(eq(courseEnrolment.academicYearId, y.id), isNull(courseEnrolment.endedOn), eq(courseEnrolment.mode, 'in_school')))
    .orderBy(asc(subject.name), asc(teacher.name), asc(user.name));
  const sections = await sectionsOf(rows.map((r) => r.studentId), y.id);
  const groups = new Map<string, {
    subjectId: string; subjectName: string; subjectCode: string; qualificationLevel: string;
    /** The unit taught, when the enrolments are per unit (the reservations rework, §10); null for the subject. */
    unitId: string | null; unitCode: string | null;
    teacherId: string | null; teacherName: string | null;
    students: { studentId: string; name: string; sectionId: string | null; section: string | null }[];
  }>();
  for (const r of rows) {
    const key = `${r.subjectId}|${r.unitId ?? ''}|${r.teacherId ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        subjectId: r.subjectId, subjectName: r.subjectName, subjectCode: r.subjectCode, qualificationLevel: r.qualificationLevel,
        unitId: r.unitId, unitCode: r.unitCode, teacherId: r.teacherId, teacherName: r.teacherName, students: [],
      });
    }
    const sec = sections.get(r.studentId) ?? null;
    groups.get(key)!.students.push({ studentId: r.studentId, name: r.studentName, sectionId: sec?.id ?? null, section: sec?.name ?? null });
  }
  return [...groups.values()];
}

/**
 * F4's contract: the teacher who teaches this student this subject in the
 * academic year starting `academicYearStart` — whose forecast grade the board
 * gets. Null: self-study, no teacher recorded, or not enrolled (F4 then asks
 * the coordinator).
 */
export async function teacherOf(studentId: string, subjectId: string, academicYearStart: number) {
  const [row] = await db
    .select({ teacherId: courseEnrolment.teacherId, teacherName: teacher.name, userId: teacher.userId, mode: courseEnrolment.mode })
    .from(courseEnrolment)
    .innerJoin(academicYear, eq(academicYear.id, courseEnrolment.academicYearId))
    .leftJoin(teacher, eq(teacher.id, courseEnrolment.teacherId))
    .where(and(eq(courseEnrolment.studentId, studentId), eq(courseEnrolment.subjectId, subjectId), eq(academicYear.startYear, academicYearStart), isNull(courseEnrolment.endedOn)));
  if (!row || row.mode === 'self_study' || !row.teacherId) return null;
  return { teacherId: row.teacherId, name: row.teacherName!, userId: row.userId };
}

/** The academic year a registration's series belongs to, for teacherOf. */
export function seriesYearOf(sessionType: string, seriesYear: number) {
  return seriesAcademicYearStart(sessionType, seriesYear);
}

/**
 * A teacher's class list: the students they teach this subject in school
 * this year. Only their own: a subject they have no students in answers 404
 * (another class's list is not theirs to read).
 */
export async function getClassList(userId: string, subjectId: string, academicYearId?: string) {
  const [t] = await db.select({ id: teacher.id, name: teacher.name }).from(teacher).where(eq(teacher.userId, userId));
  if (!t) throw new EnrolmentError('Your account is not linked to a teacher record — ask the admin to link it on the Team page', 404);
  const y = academicYearId ? await yearOrThrow(academicYearId) : await currentAcademicYear();
  if (!y) throw new EnrolmentError('The academic year is not set up yet', 404);
  const rows = await db
    .select({ enrolmentId: courseEnrolment.id, studentId: user.id, name: user.name, studentCode: user.studentId, cohortYear: user.cohortYear, startedOn: courseEnrolment.startedOn })
    .from(courseEnrolment).innerJoin(user, eq(user.id, courseEnrolment.studentId))
    .where(and(eq(courseEnrolment.academicYearId, y.id), eq(courseEnrolment.subjectId, subjectId), eq(courseEnrolment.teacherId, t.id), eq(courseEnrolment.mode, 'in_school'), isNull(courseEnrolment.endedOn)))
    .orderBy(asc(user.name));
  if (!rows.length) throw new EnrolmentError('You teach no students in this subject this year', 404);
  const [s] = await db.select({ id: subject.id, name: subject.name, code: subject.code }).from(subject).where(eq(subject.id, subjectId));
  const sections = await sectionsOf(rows.map((r) => r.studentId), y.id);
  return {
    subject: s!,
    academicYear: academicYearShortLabel(y.startYear),
    students: rows.map((r) => ({ ...r, grade: gradeInAcademicYear(r.cohortYear, y.startYear), section: sections.get(r.studentId)?.name ?? null })),
  };
}

/** A teacher's classes this year (subject, count), for "My teaching". */
export async function classesOf(teacherId: string) {
  const y = await currentAcademicYear();
  if (!y) return [];
  return db
    .select({ subjectId: subject.id, name: subject.name, code: subject.code, students: sql<number>`count(*)::int` })
    .from(courseEnrolment).innerJoin(subject, eq(subject.id, courseEnrolment.subjectId))
    .where(and(eq(courseEnrolment.academicYearId, y.id), eq(courseEnrolment.teacherId, teacherId), eq(courseEnrolment.mode, 'in_school'), isNull(courseEnrolment.endedOn)))
    .groupBy(subject.id, subject.name, subject.code)
    .orderBy(asc(subject.name));
}

/** Staff pickers: the students one can enrol this year, with grade and section. */
export async function enrolableStudents(academicYearId: string, search?: string) {
  const y = await yearOrThrow(academicYearId);
  const rows = await db.query.user.findMany({
    where: (u, { eq: eqOp, and: andOp, isNull: isNullOp, or: orOp, ilike }) => andOp(
      eqOp(u.role, 'student'), isNullOp(u.leftOn),
      sql`school_grade(${u.cohortYear}, ${y.startYear}) between 10 and 12`,
      search ? orOp(ilike(u.name, `%${search}%`), ilike(u.email, `%${search}%`), ilike(u.studentId, `%${search}%`)) : undefined,
    ),
    columns: { id: true, name: true, email: true, studentId: true, cohortYear: true },
    orderBy: (u, { asc: a }) => [a(u.name)],
    limit: 50,
  });
  return rows.map((r) => ({ ...r, gradeThatYear: gradeInAcademicYear(r.cohortYear, y.startYear) }));
}
