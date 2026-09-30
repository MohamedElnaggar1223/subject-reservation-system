/**
 * Campus leave requests (FEATURES_PLAN.md F2; docs/features/CAMPUS_LEAVE.md):
 * a request made by a parent, by the desk for a family, or by the school
 * itself (a student sent home ill), once or on repeat; the policy warnings
 * the approver sees; approval and refusal; cancellation before the student
 * has left; the family's pass; the lists, the approval queue, a student's and
 * a family's history, the reports; and the contract F3 reads,
 * `getLeaveCoverage(studentId, date)`.
 *
 * Every change writes its audit row and its notifications in its own
 * transaction. A request, a decision and a cancellation each lock the rows
 * they rely on: a student's requests are serialized on an advisory lock (the
 * overlap check and the limit per term are then sound), and a decision or a
 * cancellation takes the request's row FOR UPDATE and updates it guarded by
 * the status it read (MONEY_AUDIT.md MA-06, MA-08 — the same discipline).
 */

import {
  db, user, leaveRequest, leaveSeries, leaveCollector, leaveCollectorStudent, leaveCustodyRestriction, academicTerm, teacher, file,
  eq, and, inArray, sql, desc, asc, gte, lte,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  hasRole, ROLES, gradeLabel, maskIdNumber, LEAVE_STATUS_LABELS, LEAVE_ORIGIN_LABELS, WEEKDAY_NAMES,
  type CreateLeaveRequestType, type ApproveLeaveType, type RejectLeaveType, type CancelLeaveType, type LeaveListQueryType,
  type LeaveWarningCode, type LeaveStatus, type LeaveOrigin, type DaySchedule, type LessonOnDay,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { getSchoolDays } from './academic.services';
import { getScheduleFor, getScheduleRange } from './schedule.services';
import { addDays, csvCell, groupMembersBetween } from './scheduling-shared.services';
import { getReadableFile } from './file.services';
import { examsFor, type ExamOnDate } from './leave-exams.services';
import { signLeavePass } from './leave-pass.services';
import {
  LeaveError, schoolNow, leaveInstant, endOfSchoolDay, gradeOn, minutesBetween, readLeavePolicy, isApprover, approverIds,
  familyParentsOf, familyStudentIds, activeRestrictions, matchingRestrictions, notifyUsers, spokenDate, whenSpoken,
  isFamily, isLeaveStaff, seesIdNumbers, familyOfStudent, parentsOf, schoolTimeOf,
  type Tx, type Executor, type Viewer, type LeavePolicy,
} from './leave-shared.services';

type LeaveRow = typeof leaveRequest.$inferSelect;

/** How long a recurring request may run, and how many school days it may cover. */
const MAX_SERIES_DAYS = 120;
const MAX_SERIES_DATES = 60;

// ─── Reading ─────────────────────────────────────────────────────────────────

async function loadStudent(studentId: string, executor: Executor = db) {
  const [s] = await executor.select({
    id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, leftOn: user.leftOn, code: user.studentId,
  }).from(user).where(eq(user.id, studentId));
  if (!s || s.role !== 'student') throw new LeaveError('Student not found', 404);
  return s;
}

async function namesOf(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (list.length === 0) return new Map();
  const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function collectorsById(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (list.length === 0) return new Map<string, typeof leaveCollector.$inferSelect>();
  const rows = await db.select().from(leaveCollector).where(inArray(leaveCollector.id, list));
  return new Map(rows.map((r) => [r.id, r]));
}

/** The section a student was in on a date (their academic year's membership covering it). */
export async function sectionsOn(pairs: { studentId: string; date: string }[]): Promise<Map<string, string>> {
  if (pairs.length === 0) return new Map();
  const ids = [...new Set(pairs.map((p) => p.studentId))];
  const members = await db.execute(sql`
    select m.student_id as "studentId", m.started_on::text as "startedOn", m.ended_on::text as "endedOn", s.name
    from section_membership m join section s on s.id = m.section_id
    where m.student_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) order by m.started_on, m.created_at`);
  const byStudent = new Map<string, { startedOn: string; endedOn: string | null; name: string }[]>();
  for (const r of members.rows as { studentId: string; startedOn: string; endedOn: string | null; name: string }[]) {
    if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []);
    byStudent.get(r.studentId)!.push(r);
  }
  const out = new Map<string, string>();
  for (const p of pairs) {
    // The later membership wins a day two cover (STATE_AUDIT ST-16, as F1 reads it).
    const hit = (byStudent.get(p.studentId) ?? []).filter((m) => m.startedOn <= p.date && (m.endedOn === null || m.endedOn >= p.date)).pop();
    if (hit) out.set(`${p.studentId}|${p.date}`, hit.name);
  }
  return out;
}

// ─── What a leave touches ────────────────────────────────────────────────────

/** The lessons a leave from `from` until `to` (null: the rest of the day) takes the student out of. */
export function lessonsTouched(day: Pick<DaySchedule, 'lessons'>, from: string, to: string | null): LessonOnDay[] {
  return day.lessons.filter((l) => l.status !== 'cancelled' && l.endsAt > from && (to === null || l.startsAt < to));
}

/** The teachers (with their accounts) of the lessons a leave touches. */
async function teachersOf(lessons: LessonOnDay[]) {
  const ids = [...new Set(lessons.map((l) => l.teacher?.id).filter((x): x is string => !!x))];
  if (ids.length === 0) return [];
  const rows = await db.select({ id: teacher.id, name: teacher.name, userId: teacher.userId }).from(teacher).where(inArray(teacher.id, ids));
  return rows.map((t) => ({ ...t, lessons: lessons.filter((l) => l.teacher?.id === t.id) }));
}

/** "Physics 11 (P4, 10:30–11:15)". */
const lessonWords = (l: LessonOnDay) => `${l.subject?.name ?? l.groupName} (${l.label}, ${l.startsAt}–${l.endsAt})`;

// ─── Warnings ────────────────────────────────────────────────────────────────

export type LeaveWarning = { code: LeaveWarningCode; message: string };

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** The term a date falls in, if the calendar has one. */
async function termOf(date: string, executor: Executor = db) {
  const [t] = await executor.select().from(academicTerm).where(and(lte(academicTerm.startsOn, date), gte(academicTerm.endsOn, date)));
  return t ?? null;
}

/** A family's requests for a student in a term that still stand (the school's own do not count). */
async function familyRequestsInTerm(studentId: string, term: { startsOn: string; endsOn: string }, executor: Executor, exceptIds: string[] = []) {
  const rows = await executor.select({ id: leaveRequest.id, date: leaveRequest.date, createdAt: leaveRequest.createdAt }).from(leaveRequest).where(and(
    eq(leaveRequest.studentId, studentId),
    inArray(leaveRequest.origin, ['parent', 'desk']),
    sql`${leaveRequest.status} not in ('rejected', 'cancelled')`,
    gte(leaveRequest.date, term.startsOn), lte(leaveRequest.date, term.endsOn),
  ));
  return rows.filter((r) => !exceptIds.includes(r.id));
}

type WarningInput = {
  id?: string;
  studentId: string;
  date: string;
  leaveTime: string;
  origin: LeaveOrigin;
  createdAt: Date;
  collectorKind: string;
  collectorId: string | null;
  cohortYear: number | null;
  leftOn: string | null;
};

/**
 * The policy warnings on a request. `forFamily` leaves out what a family is
 * never told (a custody restriction on file).
 */
export async function warningsFor(
  x: WarningInput,
  policy: LeavePolicy,
  opts: { executor?: Executor; forFamily?: boolean; dayKind?: string | null; exams?: ExamOnDate[]; extraInTerm?: number } = {},
): Promise<LeaveWarning[]> {
  const executor = opts.executor ?? db;
  const out: LeaveWarning[] = [];
  const family = x.origin !== 'school';
  const sent = schoolNow(x.createdAt);
  if (family && policy.cutoff && sent.date === x.date && sent.time > policy.cutoff) {
    out.push({ code: 'after_cutoff', message: `Sent at ${sent.time}, after the same-day cut-off (${policy.cutoff})` });
  }
  const notice = minutesBetween(x.createdAt, leaveInstant(x.date, x.leaveTime));
  if (family && policy.noticeMinutes > 0 && notice < policy.noticeMinutes) {
    out.push({ code: 'short_notice', message: `Sent ${Math.max(notice, 0)} minutes before the leave (the school asks for ${policy.noticeMinutes})` });
  }
  if (family && policy.limitPerTerm !== null) {
    const term = await termOf(x.date, executor);
    if (term) {
      const standing = await familyRequestsInTerm(x.studentId, term, executor, x.id ? [x.id] : []);
      // This request's place among the term's: those made before it, plus itself.
      const before = x.id ? standing.filter((r) => r.createdAt <= x.createdAt).length : standing.length;
      const n = before + 1 + (opts.extraInTerm ?? 0);
      if (n > policy.limitPerTerm) {
        out.push({ code: 'over_term_limit', message: `The ${ordinal(n)} family request for this student in ${term.name} (the limit is ${policy.limitPerTerm})` });
      }
    }
  }
  const exams = opts.exams ?? (await examsFor(x.studentId, x.date));
  for (const e of exams) {
    out.push({ code: 'exam_that_day', message: `Exam that day: ${e.title}${e.startsAt ? ` at ${e.startsAt}` : ''}` });
  }
  const kind = opts.dayKind === undefined ? (await getSchoolDays(x.date, x.date))[0]?.kind : opts.dayKind;
  if (kind === 'exam_only') out.push({ code: 'exam_only_day', message: 'The calendar marks this day exam-only' });
  if (!opts.forFamily && (await activeRestrictions([x.studentId], executor)).length > 0) {
    out.push({ code: 'custody_on_file', message: 'A custody restriction is on file for this student: the gate checks who collects' });
  }
  if (x.collectorKind === 'collector' && x.collectorId) {
    const [c] = await executor.select({ name: leaveCollector.name, status: leaveCollector.status }).from(leaveCollector).where(eq(leaveCollector.id, x.collectorId));
    if (c && c.status !== 'approved') {
      out.push({ code: 'collector_pending', message: c.status === 'pending' ? `The collector ${c.name} is waiting for approval` : `The collector ${c.name} is no longer approved` });
    }
  }
  if (x.collectorKind === 'alone') {
    const g = gradeOn(x.cohortYear, x.date);
    if (g === null || !policy.aloneGrades.includes(g)) {
      out.push({ code: 'alone_not_allowed', message: `${gradeLabel(g)} students may not leave alone under the current policy` });
    }
  }
  if (x.leftOn && x.leftOn <= x.date) {
    out.push({ code: 'student_left', message: `The student left the school on ${spokenDate(x.leftOn)}` });
  }
  return out;
}

/** The warnings a family's request is refused for, when the school refuses rather than warns. */
const REFUSABLE: LeaveWarningCode[] = ['after_cutoff', 'short_notice', 'over_term_limit'];

// ─── Access ──────────────────────────────────────────────────────────────────

/** A leave the viewer may see, or 404 (another family's leave is not found). */
async function leaveForViewer(id: string, viewer: Viewer, executor: Executor = db): Promise<LeaveRow> {
  const [row] = await executor.select().from(leaveRequest).where(eq(leaveRequest.id, id));
  if (!row) throw new LeaveError('Leave request not found', 404);
  if (isLeaveStaff(viewer)) return row;
  if (isFamily(viewer) && (await familyStudentIds(viewer, executor)).includes(row.studentId)) return row;
  throw new LeaveError('Leave request not found', 404);
}

// ─── Shaping ─────────────────────────────────────────────────────────────────

type Shaped = Awaited<ReturnType<typeof shapeLeaves>>[number];

/** Leaves as the viewer reads them (a family and the desk never see an ID number whole). */
export async function shapeLeaves(rows: LeaveRow[], viewer: Viewer) {
  const names = await namesOf(rows.flatMap((r) => [r.studentId, r.collectorParentId, r.createdBy, r.decidedBy, r.cancelledBy, r.checkedOutBy, r.collectedByParentId, r.onBehalfOf, r.returnRecordedBy]));
  const collectors = await collectorsById(rows.flatMap((r) => [r.collectorId, r.collectedByCollectorId]));
  const docs = rows.map((r) => r.documentFileId).filter((x): x is string => !!x);
  const docNames = docs.length ? new Map((await db.select({ id: file.id, name: file.name }).from(file).where(inArray(file.id, docs))).map((f) => [f.id, f.name])) : new Map<string, string>();
  const today = schoolNow().date;
  const whole = seesIdNumbers(viewer);
  return rows.map((r) => {
    const c = r.collectorId ? collectors.get(r.collectorId) : undefined;
    const collector = r.collectorKind === 'parent'
      ? { kind: 'parent' as const, id: r.collectorParentId, name: r.collectorParentId ? (names.get(r.collectorParentId) ?? null) : null, relation: 'Parent', status: 'approved', photoFileId: null, idNumber: null }
      : r.collectorKind === 'collector'
        ? { kind: 'collector' as const, id: r.collectorId, name: c?.name ?? null, relation: c?.relation ?? null, status: c?.status ?? 'withdrawn', photoFileId: c?.photoFileId ?? null, idNumber: c ? (whole ? c.idNumber : maskIdNumber(c.idNumber)) : null }
        : { kind: 'alone' as const, id: null, name: null, relation: null, status: 'approved', photoFileId: null, idNumber: null };
    const open = r.status === 'pending' || r.status === 'approved';
    return {
      id: r.id,
      seriesId: r.seriesId,
      student: { id: r.studentId, name: names.get(r.studentId) ?? '' },
      date: r.date,
      leaveTime: r.leaveTime,
      returning: r.returning,
      returnTime: r.returnTime,
      reason: { key: r.reasonCategory, label: r.reasonLabel },
      note: r.note,
      document: r.documentFileId ? { id: r.documentFileId, name: docNames.get(r.documentFileId) ?? '' } : null,
      collector,
      origin: r.origin as LeaveOrigin,
      originLabel: LEAVE_ORIGIN_LABELS[r.origin as LeaveOrigin] ?? r.origin,
      onBehalfOf: r.onBehalfOf ? (names.get(r.onBehalfOf) ?? null) : null,
      createdBy: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
      createdAt: r.createdAt,
      status: r.status as LeaveStatus,
      statusLabel: LEAVE_STATUS_LABELS[r.status as LeaveStatus] ?? r.status,
      decidedBy: r.decidedBy ? (names.get(r.decidedBy) ?? null) : (r.decidedAt && r.status !== 'pending' ? 'Approved automatically' : null),
      decidedAt: r.decidedAt,
      decisionNote: r.decisionNote,
      cancelledBy: r.cancelledBy ? (names.get(r.cancelledBy) ?? null) : null,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      checkout: r.checkedOutAt ? {
        at: r.checkedOutAt,
        time: schoolTimeOf(r.checkedOutAt),
        by: r.checkedOutBy ? (names.get(r.checkedOutBy) ?? null) : null,
        kind: r.collectedByKind,
        name: r.collectedByName,
        via: r.checkedOutVia,
        idChecked: r.idChecked,
        note: r.checkoutNote,
      } : null,
      returnedAt: r.returnedAt,
      returnedTime: r.returnedAt ? schoolTimeOf(r.returnedAt) : null,
      noShowAt: r.noShowAt,
      lateReturnAt: r.lateReturnAt,
      // What the viewer may do now.
      canCancel: open && r.date >= today && (hasRole(viewer.role, ROLES.PARENT) || isLeaveStaff(viewer)),
      hasPass: r.status === 'approved' && r.date >= today,
    };
  });
}

// ─── Creating ────────────────────────────────────────────────────────────────

type Created = { leaves: Shaped[]; warnings: LeaveWarning[]; skipped: { date: string; why: string }[]; approved: number };

/** The dates a request covers: the one date, or a repeat's school days. */
async function datesOf(input: CreateLeaveRequestType, today: string) {
  const until = input.repeat ? input.repeat.until : input.date;
  if (addDays(input.date, MAX_SERIES_DAYS) < until) throw new LeaveError(`A recurring request runs for at most ${MAX_SERIES_DAYS} days`);
  const days = await getSchoolDays(input.date, until);
  const skipped: { date: string; why: string }[] = [];
  const dates: { date: string; kind: string; dayEnd: string | null }[] = [];
  for (const d of days) {
    if (input.repeat && !input.repeat.weekdays.includes(d.weekday)) continue;
    const dayEnd = d.periods.length ? d.periods[d.periods.length - 1]!.endsAt : null;
    const closed = d.kind === 'holiday' || d.kind === 'weekend' || d.kind === 'out_of_term';
    const why = closed ? `the school is closed (${d.kind === 'holiday' ? (d.entry?.name ?? 'a holiday') : d.kind === 'weekend' ? 'not a school day' : 'between terms'})`
      : dayEnd && input.leaveTime >= dayEnd ? `the school day ends at ${dayEnd}` : null;
    if (why) { skipped.push({ date: d.date, why }); continue; }
    dates.push({ date: d.date, kind: d.kind, dayEnd });
  }
  if (!input.repeat && dates.length === 0) {
    const s = skipped[0];
    throw new LeaveError(s ? `No leave on ${spokenDate(s.date)}: ${s.why}` : 'No school day on that date', 409);
  }
  if (input.repeat && dates.length === 0) throw new LeaveError('That repeat has no school days on the chosen weekdays', 409);
  if (dates.length > MAX_SERIES_DATES) throw new LeaveError(`A recurring request covers at most ${MAX_SERIES_DATES} school days`);
  void today;
  return { dates, skipped };
}

/**
 * Make a request (or a recurring one). A parent asks for a linked child; the
 * desk asks for a family; the coordinator or the admin records a family's
 * request or the school's own decision, approving it at once if they wish.
 */
export async function createLeave(input: CreateLeaveRequestType, viewer: Viewer, ctx?: AuditContext): Promise<Created> {
  const policy = await readLeavePolicy();
  const approver = isApprover(viewer.role, policy);
  const now = new Date();
  const today = schoolNow(now);

  // Who is asking, and in what capacity.
  let origin: LeaveOrigin;
  if (viewer.role === ROLES.PARENT) {
    if (!(await familyStudentIds(viewer)).includes(input.studentId)) throw new LeaveError('Student not found', 404);
    origin = 'parent';
  } else if (hasRole(viewer.role, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN)) {
    if (input.origin === 'school') throw new LeaveError("Only the coordinator or the admin records the school's own decision to send a student home", 403);
    origin = 'desk';
  } else if (hasRole(viewer.role, ROLES.COORDINATOR, ROLES.ADMIN)) {
    origin = input.origin === 'school' ? 'school' : 'desk';
  } else {
    throw new LeaveError('Your account cannot request leave', 403);
  }
  const student = await loadStudent(input.studentId);
  if (student.leftOn && student.leftOn <= input.date) throw new LeaveError(`${student.name} left the school on ${spokenDate(student.leftOn)}`, 409);

  // When.
  if (input.date < today.date) throw new LeaveError('A leave is for today or a later day', 400);
  // A family asks ahead; staff may record a leave from a time already passed
  // today (a parent phoning from the gate, a student sent home at 9:00).
  if (origin === 'parent' && input.date === today.date && input.leaveTime <= today.time) {
    throw new LeaveError(`${input.leaveTime} has already passed today — choose a later time`, 400);
  }
  const { dates, skipped } = await datesOf(input, today.date);

  // Why.
  const reason = policy.reasons.find((r) => r.key === input.reasonCategory);
  if (!reason) throw new LeaveError("Choose one of the school's reasons for leave", 400);

  // Who collects.
  const familyParents = await familyParentsOf(student.id);
  let collectorId: string | null = null;
  let collectorParentId: string | null = null;
  if (input.collector.kind === 'parent') {
    if (!familyParents.some((p) => p.id === (input.collector as { parentId: string }).parentId)) {
      throw new LeaveError(`Choose a parent linked to ${student.name}`, 409);
    }
    collectorParentId = input.collector.parentId;
  } else if (input.collector.kind === 'collector') {
    const cid = input.collector.collectorId;
    const [c] = await db.select({ c: leaveCollector }).from(leaveCollector)
      .innerJoin(leaveCollectorStudent, and(eq(leaveCollectorStudent.collectorId, leaveCollector.id), eq(leaveCollectorStudent.studentId, student.id)))
      .where(eq(leaveCollector.id, cid));
    if (!c || (c.c.status !== 'approved' && c.c.status !== 'pending')) throw new LeaveError(`Choose one of ${student.name}'s authorised collectors`, 409);
    if (matchingRestrictions({ name: c.c.name, idNumber: c.c.idNumber }, await activeRestrictions([student.id])).length > 0) {
      throw new LeaveError(`${c.c.name} cannot be named to collect ${student.name} — please contact the school`, 409);
    }
    collectorId = cid;
  } else {
    for (const d of dates) {
      const g = gradeOn(student.cohortYear, d.date);
      if (g === null || !policy.aloneGrades.includes(g)) {
        throw new LeaveError(`${gradeLabel(g)} students may not leave alone — choose who collects ${student.name}`, 409);
      }
    }
  }

  // Staff extras.
  let onBehalfOf: string | null = null;
  if (input.onBehalfOf && origin !== 'parent') {
    if (!familyParents.some((p) => p.id === input.onBehalfOf)) throw new LeaveError(`Choose a parent linked to ${student.name}`, 409);
    onBehalfOf = input.onBehalfOf;
  }
  if (input.documentFileId) {
    const f = await getReadableFile(input.documentFileId, { id: viewer.id, role: viewer.role });
    if (!f || f.purpose !== 'supporting_document' || f.studentId !== student.id) throw new LeaveError('Attach a supporting document uploaded for this student', 400);
  }
  const approveNow = approver && (input.approveNow ?? origin === 'school');

  // The lessons each date touches, read before the transaction (a timetable read).
  const first = dates[0]!.date;
  const last = dates[dates.length - 1]!.date;
  const schedules = new Map((await getScheduleRange({ studentId: student.id }, first, last)).map((d) => [d.date, d]));
  const exams = new Map(await Promise.all(dates.map(async (d) => [d.date, await examsFor(student.id, d.date)] as const)));

  const created = await db.transaction(async (tx) => {
    // One student's requests one at a time: the overlap and limit checks read what the last one wrote.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`leave:student:${student.id}`}))`);
    const seriesId = input.repeat ? randomUUID() : null;
    if (seriesId) {
      await tx.insert(leaveSeries).values({ id: seriesId, studentId: student.id, startsOn: input.date, endsOn: input.repeat!.until, weekdays: [...input.repeat!.weekdays].sort(), createdBy: viewer.id });
      await logAction(viewer.id, 'LEAVE_REQUESTED', 'leave_series', seriesId, null, { studentId: student.id, from: input.date, until: input.repeat!.until, weekdays: input.repeat!.weekdays }, ctx, tx);
    }
    const rows: LeaveRow[] = [];
    const warnings: LeaveWarning[] = [];
    const clash: { date: string; why: string }[] = [];
    let inTerm = 0;
    for (const d of dates) {
      const until = input.returning ? input.returnTime! : '24:00';
      const overlapping = await tx.select().from(leaveRequest).where(and(
        eq(leaveRequest.studentId, student.id), eq(leaveRequest.date, d.date),
        inArray(leaveRequest.status, ['pending', 'approved', 'checked_out', 'returned']),
      ));
      const hit = overlapping.find((o) => o.leaveTime < until && (o.returning ? o.returnTime! : '24:00') > input.leaveTime);
      if (hit) {
        const why = `${student.name} already has a leave that day from ${hit.leaveTime} (${LEAVE_STATUS_LABELS[hit.status as LeaveStatus].toLowerCase()})`;
        if (!input.repeat) throw new LeaveError(why, 409);
        clash.push({ date: d.date, why });
        continue;
      }
      const w = await warningsFor({
        studentId: student.id, date: d.date, leaveTime: input.leaveTime, origin, createdAt: now,
        collectorKind: input.collector.kind, collectorId, cohortYear: student.cohortYear, leftOn: student.leftOn,
      }, policy, { executor: tx, dayKind: d.kind, exams: exams.get(d.date) ?? [], extraInTerm: inTerm });
      if (origin === 'parent' && policy.familyRules === 'refuse') {
        const broken = w.find((x) => REFUSABLE.includes(x.code));
        if (broken) throw new LeaveError(`The school does not accept this request: ${broken.message.charAt(0).toLowerCase()}${broken.message.slice(1)}. Please phone the school.`, 409);
      }
      if (origin !== 'school') inTerm++;
      const id = randomUUID();
      const auto = !approveNow && policy.autoApprove && origin !== 'school' && w.length === 0;
      const approveIt = (approveNow && !w.some((x) => x.code === 'collector_pending')) || auto;
      const [row] = await tx.insert(leaveRequest).values({
        id, studentId: student.id, seriesId, date: d.date, leaveTime: input.leaveTime, returning: input.returning,
        returnTime: input.returning ? input.returnTime! : null, reasonCategory: reason.key, reasonLabel: reason.label,
        note: input.note?.trim() || null, documentFileId: input.documentFileId ?? null,
        collectorKind: input.collector.kind, collectorParentId, collectorId, origin, onBehalfOf, createdBy: viewer.id, createdAt: now,
        status: approveIt ? 'approved' : 'pending',
        decidedBy: approveIt && !auto ? viewer.id : null, decidedAt: approveIt ? now : null,
        decisionNote: auto ? 'Approved automatically: no rule broken' : null,
      }).returning();
      rows.push(row!);
      warnings.push(...w.filter((x) => !warnings.some((y) => y.code === x.code)));
      await logAction(viewer.id, 'LEAVE_REQUESTED', 'leave_request', id, null, {
        studentId: student.id, date: d.date, leaveTime: input.leaveTime, returnTime: row!.returnTime, reason: reason.key, origin,
        collectorKind: input.collector.kind, seriesId, warnings: w.map((x) => x.code),
      }, ctx, tx);
      if (approveIt) {
        await logAction(auto ? null : viewer.id, 'LEAVE_APPROVED', 'leave_request', id, { status: 'pending' }, { status: 'approved', automatically: auto }, ctx, tx);
      }
    }
    if (rows.length === 0) throw new LeaveError(clash[0]?.why ?? 'Nothing to request', 409);
    await announceCreated(tx, rows, student, origin, viewer, policy, schedules);
    return { rows, warnings, clash };
  });

  const shaped = await shapeLeaves(created.rows, viewer);
  const forFamily = isFamily(viewer);
  return {
    leaves: shaped,
    warnings: created.warnings.filter((w) => !(forFamily && w.code === 'custody_on_file')),
    skipped: [...skipped, ...created.clash],
    approved: created.rows.filter((r) => r.status === 'approved').length,
  };
}

/** The notices a new request sends, in its transaction. */
async function announceCreated(
  tx: Tx, rows: LeaveRow[], student: { id: string; name: string }, origin: LeaveOrigin, viewer: Viewer,
  policy: LeavePolicy, schedules: Map<string, DaySchedule>,
) {
  const first = rows[0]!;
  const many = rows.length > 1;
  const when = many ? `on ${rows.length} days from ${spokenDate(first.date)}` : whenSpoken(first.date);
  const at = `at ${first.leaveTime}${first.returning ? ` (back by ${first.returnTime})` : ''}`;
  const data = { leaveId: first.id, seriesId: first.seriesId, studentId: student.id, date: first.date };
  const pending = rows.filter((r) => r.status === 'pending');
  const approved = rows.filter((r) => r.status === 'approved');
  const family = (await familyParentsOf(student.id, tx)).map((p) => p.id).concat(student.id).filter((id) => id !== viewer.id);
  if (pending.length) {
    await notifyUsers((await approverIds(policy)).filter((id) => id !== viewer.id), 'LEAVE_REQUESTED', `Leave to approve: ${student.name}`,
      `${student.name} asks to leave ${many ? `on ${pending.length} days from ${spokenDate(pending[0]!.date)}` : whenSpoken(pending[0]!.date)} ${at} — ${first.reasonLabel}.`,
      { ...data, link: '/leave/manage' }, tx);
    if (origin !== 'parent') {
      await notifyUsers(family, 'LEAVE_REQUESTED', `Leave requested for ${student.name}`,
        `The school recorded a request for ${student.name} to leave ${when} ${at}. It waits for approval.`, { ...data, link: '/leave' }, tx);
    }
  }
  if (approved.length) {
    await notifyUsers(family, 'LEAVE_APPROVED', `Leave approved for ${student.name}`,
      origin === 'school'
        ? `The school is sending ${student.name} home ${when} ${at}: ${first.reasonLabel}. Collect them at the gate.`
        : `${student.name} may leave ${approved.length > 1 ? `on ${approved.length} days from ${spokenDate(approved[0]!.date)}` : whenSpoken(approved[0]!.date)} ${at}. Show the pass at the gate.`,
      { ...data, link: '/leave' }, tx);
    for (const r of approved) await tellTeachers(tx, r, student, schedules.get(r.date), 'approved');
  }
}

/** Tell the teachers of the lessons a leave touches (cover applied) that the student leaves — or no longer does. */
async function tellTeachers(tx: Tx, r: LeaveRow, student: { id: string; name: string }, day: DaySchedule | undefined, what: 'approved' | 'cancelled') {
  const schedule = day ?? (await getScheduleFor({ studentId: student.id }, r.date));
  const touched = lessonsTouched(schedule, r.leaveTime, r.returning ? r.returnTime : null);
  for (const t of await teachersOf(touched)) {
    if (!t.userId) continue;
    const list = t.lessons.map(lessonWords).join(', ');
    await notifyUsers([t.userId], what === 'approved' ? 'LEAVE_LESSON_MISSED' : 'LEAVE_CANCELLED',
      what === 'approved' ? `${student.name} leaves during your lesson` : `${student.name} no longer leaves`,
      what === 'approved'
        ? `${student.name} leaves ${whenSpoken(r.date)} at ${r.leaveTime}${r.returning ? ` and is back by ${r.returnTime}` : ''}: misses ${list}.`
        : `The leave ${whenSpoken(r.date)} at ${r.leaveTime} was cancelled: ${student.name} is expected in ${list}.`,
      { leaveId: r.id, studentId: student.id, date: r.date, link: '/today' }, tx);
  }
}

// ─── Deciding ────────────────────────────────────────────────────────────────

/** The sentence for a request that is no longer waiting. */
function notWaiting(r: LeaveRow, names?: Map<string, string>): string {
  switch (r.status) {
    case 'approved': return 'This request is already approved';
    case 'rejected': return 'This request was already refused';
    case 'cancelled': return `This request was cancelled${r.cancelledAt ? ` at ${schoolTimeOf(r.cancelledAt)}` : ''}${r.cancelledBy && names?.get(r.cancelledBy) ? ` by ${names.get(r.cancelledBy)}` : ''}`;
    case 'checked_out': return `The student already left school${r.checkedOutAt ? ` at ${schoolTimeOf(r.checkedOutAt)}` : ''}`;
    case 'returned': return 'The student already left and came back';
    default: return 'This request is not waiting for a decision';
  }
}

async function requireApprover(viewer: Viewer) {
  const policy = await readLeavePolicy();
  if (!isApprover(viewer.role, policy)) {
    throw new LeaveError(`Leave is approved by ${policy.approverRoles.map((r) => (r === 'admin' ? 'the admin' : 'the coordinator')).join(' or ')}`, 403);
  }
  return policy;
}

/** The requests a decision applies to: this one, or every one of its series still waiting from today on. */
async function targetsOf(tx: Tx, r: LeaveRow, series: boolean | undefined, statuses: LeaveStatus[]): Promise<LeaveRow[]> {
  if (!series || !r.seriesId) return [r];
  const today = schoolNow().date;
  return tx.select().from(leaveRequest)
    .where(and(eq(leaveRequest.seriesId, r.seriesId), inArray(leaveRequest.status, statuses), gte(leaveRequest.date, today)))
    .orderBy(asc(leaveRequest.date), asc(leaveRequest.id))
    .for('update');
}

export async function approveLeave(id: string, input: ApproveLeaveType, viewer: Viewer, ctx?: AuditContext) {
  const policy = await requireApprover(viewer);
  await leaveForViewer(id, viewer);
  const now = new Date();
  const today = schoolNow(now).date;
  const done = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(leaveRequest).where(eq(leaveRequest.id, id)).for('update');
    if (!r) throw new LeaveError('Leave request not found', 404);
    if (r.status !== 'pending') throw new LeaveError(notWaiting(r, await namesOf([r.cancelledBy])), 409);
    const targets = await targetsOf(tx, r, input.series, ['pending']);
    const student = await loadStudent(r.studentId, tx);
    const approved: LeaveRow[] = [];
    for (const t of targets) {
      if (t.date < today) throw new LeaveError(`The request for ${spokenDate(t.date)} is in the past — refuse it instead`, 409);
      if (student.leftOn && student.leftOn <= t.date) throw new LeaveError(`${student.name} left the school on ${spokenDate(student.leftOn)}`, 409);
      if (t.collectorKind === 'collector' && t.collectorId) {
        const [c] = await tx.select().from(leaveCollector).where(eq(leaveCollector.id, t.collectorId)).for('share');
        if (!c || c.status !== 'approved') throw new LeaveError(`Approve the collector ${c?.name ?? ''} first`.replace('  ', ' '), 409);
      }
      if (t.collectorKind === 'alone') {
        const g = gradeOn(student.cohortYear, t.date);
        if (g === null || !policy.aloneGrades.includes(g)) throw new LeaveError(`${gradeLabel(g)} students may not leave alone under the current policy — refuse it, or ask the family who collects`, 409);
      }
      if (t.collectorKind === 'parent' && t.collectorParentId && !(await familyParentsOf(student.id, tx)).some((p) => p.id === t.collectorParentId)) {
        throw new LeaveError('The parent named to collect may no longer collect this student — refuse it, or ask the family who collects', 409);
      }
      const [u] = await tx.update(leaveRequest)
        .set({ status: 'approved', decidedBy: viewer.id, decidedAt: now, decisionNote: input.note?.trim() || null })
        .where(and(eq(leaveRequest.id, t.id), eq(leaveRequest.status, 'pending')))
        .returning();
      if (!u) throw new LeaveError(notWaiting(t), 409);
      await logAction(viewer.id, 'LEAVE_APPROVED', 'leave_request', t.id, { status: 'pending' }, { status: 'approved', note: u.decisionNote, series: !!input.series }, ctx, tx);
      approved.push(u);
    }
    const family = (await familyParentsOf(student.id, tx)).map((p) => p.id).concat(student.id);
    const first = approved[0]!;
    await notifyUsers(family, 'LEAVE_APPROVED', `Leave approved for ${student.name}`,
      `${student.name} may leave ${approved.length > 1 ? `on ${approved.length} days from ${spokenDate(first.date)}` : whenSpoken(first.date)} at ${first.leaveTime}${first.returning ? ` (back by ${first.returnTime})` : ''}. Show the pass at the gate.${first.decisionNote ? ` Note: ${first.decisionNote}` : ''}`,
      { leaveId: first.id, seriesId: first.seriesId, studentId: student.id, date: first.date, link: '/leave' }, tx);
    for (const a of approved) await tellTeachers(tx, a, student, undefined, 'approved');
    return approved;
  });
  return { approved: done.length, leaves: await shapeLeaves(done, viewer) };
}

export async function rejectLeave(id: string, input: RejectLeaveType, viewer: Viewer, ctx?: AuditContext) {
  await requireApprover(viewer);
  await leaveForViewer(id, viewer);
  const now = new Date();
  const done = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(leaveRequest).where(eq(leaveRequest.id, id)).for('update');
    if (!r) throw new LeaveError('Leave request not found', 404);
    if (r.status !== 'pending') throw new LeaveError(notWaiting(r, await namesOf([r.cancelledBy])), 409);
    const targets = await targetsOf(tx, r, input.series, ['pending']);
    const out: LeaveRow[] = [];
    for (const t of targets) {
      const [u] = await tx.update(leaveRequest)
        .set({ status: 'rejected', decidedBy: viewer.id, decidedAt: now, decisionNote: input.reason.trim() })
        .where(and(eq(leaveRequest.id, t.id), eq(leaveRequest.status, 'pending')))
        .returning();
      if (!u) throw new LeaveError(notWaiting(t), 409);
      await logAction(viewer.id, 'LEAVE_REJECTED', 'leave_request', t.id, { status: 'pending' }, { status: 'rejected', reason: u.decisionNote, series: !!input.series }, ctx, tx);
      out.push(u);
    }
    const student = await loadStudent(r.studentId, tx);
    const family = (await familyParentsOf(student.id, tx)).map((p) => p.id).concat(student.id);
    await notifyUsers(family, 'LEAVE_REJECTED', `Leave not approved for ${student.name}`,
      `The request for ${student.name} to leave ${out.length > 1 ? `on ${out.length} days from ${spokenDate(out[0]!.date)}` : whenSpoken(out[0]!.date)} at ${out[0]!.leaveTime} was not approved: ${input.reason.trim()}`,
      { leaveId: r.id, studentId: student.id, date: r.date, link: '/leave' }, tx);
    return out;
  });
  return { rejected: done.length, leaves: await shapeLeaves(done, viewer) };
}

/**
 * Cancel before the student has left: a parent of the student (a reason is
 * optional), or staff (the desk, the coordinator, the admin — a reason is
 * required). Approved leaves' teachers are told the student stays.
 */
export async function cancelLeave(id: string, input: CancelLeaveType, viewer: Viewer, ctx?: AuditContext) {
  const r0 = await leaveForViewer(id, viewer);
  if (viewer.role === ROLES.STUDENT) throw new LeaveError('A parent or the school cancels a leave', 403);
  const staff = isLeaveStaff(viewer);
  if (staff && (!input.reason || input.reason.trim().length < 3)) throw new LeaveError('Give a reason: the family is told it', 400);
  const now = new Date();
  const today = schoolNow(now).date;
  const done = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(leaveRequest).where(eq(leaveRequest.id, r0.id)).for('update');
    if (!r) throw new LeaveError('Leave request not found', 404);
    if (r.status !== 'pending' && r.status !== 'approved') {
      if (r.status === 'checked_out' || r.status === 'returned') throw new LeaveError(`${notWaiting(r)} — it can no longer be cancelled`, 409);
      throw new LeaveError(notWaiting(r, await namesOf([r.cancelledBy])), 409);
    }
    if (r.date < today) throw new LeaveError('This leave was for a day that has passed', 409);
    const targets = await targetsOf(tx, r, input.series, ['pending', 'approved']);
    const out: { before: LeaveRow; after: LeaveRow }[] = [];
    for (const t of targets) {
      const [u] = await tx.update(leaveRequest)
        .set({ status: 'cancelled', cancelledBy: viewer.id, cancelledAt: now, cancelReason: input.reason?.trim() || null })
        .where(and(eq(leaveRequest.id, t.id), inArray(leaveRequest.status, ['pending', 'approved'])))
        .returning();
      if (!u) throw new LeaveError(notWaiting(t), 409);
      await logAction(viewer.id, 'LEAVE_CANCELLED', 'leave_request', t.id, { status: t.status }, { status: 'cancelled', reason: u.cancelReason, series: !!input.series }, ctx, tx);
      out.push({ before: t, after: u });
    }
    const student = await loadStudent(r.studentId, tx);
    const family = (await familyParentsOf(student.id, tx)).map((p) => p.id).concat(student.id).filter((x) => x !== viewer.id);
    const first = out[0]!.after;
    const by = staff ? 'The school cancelled' : `${viewer.name ?? 'A parent'} cancelled`;
    await notifyUsers(family, 'LEAVE_CANCELLED', `Leave cancelled for ${student.name}`,
      `${by} the leave ${out.length > 1 ? `on ${out.length} days from ${spokenDate(first.date)}` : whenSpoken(first.date)} at ${first.leaveTime}${first.cancelReason ? `: ${first.cancelReason}` : ''}. ${student.name} stays at school.`,
      { leaveId: first.id, studentId: student.id, date: first.date, link: '/leave' }, tx);
    const policy = await readLeavePolicy(tx);
    if (out.some((o) => o.before.status === 'pending')) {
      await notifyUsers((await approverIds(policy)).filter((x) => x !== viewer.id), 'LEAVE_CANCELLED', `Request withdrawn: ${student.name}`,
        `${by} the request for ${student.name} to leave ${whenSpoken(first.date)} at ${first.leaveTime}. Nothing to approve.`, { leaveId: first.id, studentId: student.id, link: '/leave/manage' }, tx);
    }
    for (const o of out) if (o.before.status === 'approved') await tellTeachers(tx, o.after, student, undefined, 'cancelled');
    return out.map((o) => o.after);
  });
  return { cancelled: done.length, leaves: await shapeLeaves(done, viewer) };
}

// ─── The pass ────────────────────────────────────────────────────────────────

/** The family's pass for an approved leave (a parent's or the student's own screen). */
export async function passFor(id: string, viewer: Viewer) {
  if (!isFamily(viewer)) throw new LeaveError('Leave request not found', 404);
  const r = await leaveForViewer(id, viewer);
  const [shaped] = await shapeLeaves([r], viewer);
  const today = schoolNow().date;
  if (r.status === 'checked_out' || r.status === 'returned') {
    return { token: null, expiresAt: null, leave: shaped!, message: `${shaped!.student.name} left school at ${shaped!.checkout?.time ?? ''}` };
  }
  if (r.status !== 'approved') throw new LeaveError(r.status === 'pending' ? 'The pass appears once the school approves the leave' : `There is no pass: ${notWaiting(r).charAt(0).toLowerCase()}${notWaiting(r).slice(1)}`, 409);
  if (r.date < today) throw new LeaveError('This leave was for a day that has passed', 409);
  const pass = signLeavePass(r.id, r.passVersion, endOfSchoolDay(r.date));
  return { token: pass.token, expiresAt: pass.expiresAt, leave: shaped!, message: null };
}

/** A new pass: the old one stops working at the gate (a screenshot shared too widely). */
export async function reissuePass(id: string, viewer: Viewer, ctx?: AuditContext) {
  if (viewer.role !== ROLES.PARENT) throw new LeaveError('Leave request not found', 404);
  const r0 = await leaveForViewer(id, viewer);
  await db.transaction(async (tx) => {
    const [u] = await tx.update(leaveRequest).set({ passVersion: sql`${leaveRequest.passVersion} + 1` })
      .where(and(eq(leaveRequest.id, r0.id), eq(leaveRequest.status, 'approved'), gte(leaveRequest.date, schoolNow().date)))
      .returning();
    if (!u) throw new LeaveError('Only an approved leave for today or later has a pass', 409);
    await logAction(viewer.id, 'LEAVE_PASS_REISSUED', 'leave_request', u.id, { passVersion: r0.passVersion }, { passVersion: u.passVersion }, ctx, tx);
  });
  return passFor(id, viewer);
}

// ─── Lists ───────────────────────────────────────────────────────────────────

/**
 * Leaves as the viewer may list them: a family its own children's (by
 * default from 60 days back on), staff by student, family, date or range
 * (by default today).
 */
export async function listLeaves(q: LeaveListQueryType, viewer: Viewer) {
  const today = schoolNow().date;
  const conds = [];
  if (isFamily(viewer)) {
    const mine = await familyStudentIds(viewer);
    if (q.studentId && !mine.includes(q.studentId)) throw new LeaveError('Student not found', 404);
    const ids = q.studentId ? [q.studentId] : mine;
    if (ids.length === 0) return [];
    conds.push(inArray(leaveRequest.studentId, ids));
    if (!q.date && !q.from && !q.to) conds.push(gte(leaveRequest.date, addDays(today, -60)));
  } else if (isLeaveStaff(viewer)) {
    if (q.studentId) {
      await loadStudent(q.studentId);
      conds.push(inArray(leaveRequest.studentId, q.family === 'true' ? await familyOfStudent(q.studentId) : [q.studentId]));
    } else if (!q.date && !q.from && !q.to) {
      conds.push(eq(leaveRequest.date, today));
    }
  } else {
    throw new LeaveError('Your account cannot list leave', 403);
  }
  if (q.date) conds.push(eq(leaveRequest.date, q.date));
  if (q.from) conds.push(gte(leaveRequest.date, q.from));
  if (q.to) conds.push(lte(leaveRequest.date, q.to));
  if (q.status) conds.push(eq(leaveRequest.status, q.status));
  const rows = await db.select().from(leaveRequest).where(and(...conds))
    .orderBy(desc(leaveRequest.date), asc(leaveRequest.leaveTime), asc(leaveRequest.createdAt)).limit(1000);
  return shapeLeaves(rows, viewer);
}

export async function getLeave(id: string, viewer: Viewer) {
  const r = await leaveForViewer(id, viewer);
  const [shaped] = await shapeLeaves([r], viewer);
  const policy = await readLeavePolicy();
  const student = await loadStudent(r.studentId);
  const warnings = r.status === 'pending' || r.status === 'approved'
    ? await warningsFor({ id: r.id, studentId: r.studentId, date: r.date, leaveTime: r.leaveTime, origin: r.origin as LeaveOrigin, createdAt: r.createdAt, collectorKind: r.collectorKind, collectorId: r.collectorId, cohortYear: student.cohortYear, leftOn: student.leftOn }, policy, { forFamily: isFamily(viewer) })
    : [];
  const series = r.seriesId
    ? await db.select({ id: leaveRequest.id, date: leaveRequest.date, status: leaveRequest.status }).from(leaveRequest).where(eq(leaveRequest.seriesId, r.seriesId)).orderBy(asc(leaveRequest.date))
    : [];
  const history = isLeaveStaff(viewer) ? await db.execute(sql`
    select a.action, a.created_at as "at", u.name as "by", a.new_data as "data" from audit_log a left join "user" u on u.id = a.user_id
    where a.entity_type = 'leave_request' and a.entity_id = ${r.id} order by a.created_at, a.id`) : { rows: [] };
  return { ...shaped!, warnings, series, history: history.rows as { action: string; at: string; by: string | null; data: unknown }[] };
}

// ─── The approval queue ──────────────────────────────────────────────────────

/**
 * What waits for a decision, by date then leave time, each with what the
 * approver needs: the student's grade and section, the collector (with the
 * photo and the ID number whole), the warnings, the lessons and teachers the
 * leave touches, exams that day, the student's leave this term and lately,
 * and the collectors waiting for approval.
 */
export async function approvalQueue(viewer: Viewer) {
  const policy = await readLeavePolicy();
  const today = schoolNow().date;
  const rows = await db.select().from(leaveRequest).where(eq(leaveRequest.status, 'pending'))
    .orderBy(asc(leaveRequest.date), asc(leaveRequest.leaveTime), asc(leaveRequest.createdAt)).limit(300);
  // A series waits as one item: its first date stands for the rest.
  const firstOfSeries = new Map<string, LeaveRow[]>();
  const items: LeaveRow[] = [];
  for (const r of rows) {
    if (r.seriesId) {
      if (!firstOfSeries.has(r.seriesId)) { firstOfSeries.set(r.seriesId, []); items.push(r); }
      firstOfSeries.get(r.seriesId)!.push(r);
    } else items.push(r);
  }
  const shaped = await shapeLeaves(items, viewer);
  const studentIds = [...new Set(items.map((r) => r.studentId))];
  const students = studentIds.length ? await db.select({ id: user.id, cohortYear: user.cohortYear, leftOn: user.leftOn, code: user.studentId }).from(user).where(inArray(user.id, studentIds)) : [];
  const byStudent = new Map(students.map((s) => [s.id, s]));
  const sections = await sectionsOn(items.map((r) => ({ studentId: r.studentId, date: r.date })));
  const collectors = await collectorsById(items.map((r) => r.collectorId));
  const restrictions = await activeRestrictions(studentIds);

  const out = [];
  for (let i = 0; i < items.length; i++) {
    const r = items[i]!;
    const s = byStudent.get(r.studentId)!;
    const [schedule, exams, history] = await Promise.all([
      getScheduleFor({ studentId: r.studentId }, r.date),
      examsFor(r.studentId, r.date),
      studentHistorySummary(r.studentId, r.date, r.id),
    ]);
    const touched = lessonsTouched(schedule, r.leaveTime, r.returning ? r.returnTime : null);
    const warnings = await warningsFor({ id: r.id, studentId: r.studentId, date: r.date, leaveTime: r.leaveTime, origin: r.origin as LeaveOrigin, createdAt: r.createdAt, collectorKind: r.collectorKind, collectorId: r.collectorId, cohortYear: s.cohortYear, leftOn: s.leftOn }, policy, { exams, dayKind: undefined });
    const c = r.collectorId ? collectors.get(r.collectorId) : undefined;
    const grade = gradeOn(s.cohortYear, r.date);
    const seriesRows = r.seriesId ? firstOfSeries.get(r.seriesId)! : [];
    out.push({
      ...shaped[i]!,
      studentCode: s.code,
      grade, gradeLabel: gradeLabel(grade),
      section: sections.get(`${r.studentId}|${r.date}`) ?? null,
      past: r.date < today,
      warnings,
      lessons: touched.map((l) => ({ lessonId: l.lessonId, label: l.label, startsAt: l.startsAt, endsAt: l.endsAt, subject: l.subject?.name ?? l.groupName, group: l.groupName, teacher: l.teacher?.name ?? null, status: l.status })),
      dayNote: schedule.note,
      exams,
      history,
      collectorDetail: c ? { id: c.id, name: c.name, relation: c.relation, phone: c.phone, idNumber: c.idNumber, photoFileId: c.photoFileId, status: c.status } : null,
      custody: restrictions.filter((x) => x.studentId === r.studentId).map((x) => ({ id: x.id, personName: x.personName, relation: x.relation })),
      seriesDates: seriesRows.map((x) => ({ id: x.id, date: x.date })),
    });
  }
  const pendingCollectors = await pendingCollectorsForQueue();
  return { canDecide: isApprover(viewer.role, policy), requests: out, collectors: pendingCollectors };
}

async function pendingCollectorsForQueue() {
  const rows = await db.select().from(leaveCollector).where(eq(leaveCollector.status, 'pending')).orderBy(asc(leaveCollector.createdAt)).limit(200);
  if (rows.length === 0) return [];
  const links = await db.select({ collectorId: leaveCollectorStudent.collectorId, studentId: leaveCollectorStudent.studentId, name: user.name })
    .from(leaveCollectorStudent).innerJoin(user, eq(user.id, leaveCollectorStudent.studentId))
    .where(inArray(leaveCollectorStudent.collectorId, rows.map((r) => r.id)));
  const names = await namesOf(rows.map((r) => r.addedBy));
  const restrictions = await activeRestrictions([...new Set(links.map((l) => l.studentId))]);
  return rows.map((c) => {
    const kids = links.filter((l) => l.collectorId === c.id);
    return {
      id: c.id, name: c.name, relation: c.relation, phone: c.phone, idNumber: c.idNumber, photoFileId: c.photoFileId, note: c.note,
      addedBy: c.addedBy ? (names.get(c.addedBy) ?? null) : null, createdAt: c.createdAt,
      students: kids.map((k) => ({ id: k.studentId, name: k.name })),
      matchesRestriction: matchingRestrictions({ name: c.name, idNumber: c.idNumber }, restrictions.filter((x) => kids.some((k) => k.studentId === x.studentId))).length > 0,
    };
  });
}

/** A student's leave this term (counted by reason) and their latest leaves. */
async function studentHistorySummary(studentId: string, date: string, exceptId?: string) {
  const term = await termOf(date);
  const all = await db.select().from(leaveRequest).where(eq(leaveRequest.studentId, studentId)).orderBy(desc(leaveRequest.date), desc(leaveRequest.createdAt)).limit(200);
  const others = all.filter((r) => r.id !== exceptId);
  const inTerm = term ? others.filter((r) => r.date >= term.startsOn && r.date <= term.endsOn && r.status !== 'rejected' && r.status !== 'cancelled') : [];
  const byReason = new Map<string, number>();
  for (const r of inTerm) byReason.set(r.reasonLabel, (byReason.get(r.reasonLabel) ?? 0) + 1);
  return {
    term: term ? { name: term.name, startsOn: term.startsOn, endsOn: term.endsOn } : null,
    thisTerm: inTerm.length,
    familyThisTerm: inTerm.filter((r) => r.origin !== 'school').length,
    byReason: [...byReason].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    noShows: others.filter((r) => r.noShowAt).length,
    lateReturns: others.filter((r) => r.lateReturnAt).length,
    recent: others.slice(0, 5).map((r) => ({ id: r.id, date: r.date, leaveTime: r.leaveTime, reason: r.reasonLabel, status: r.status, statusLabel: LEAVE_STATUS_LABELS[r.status as LeaveStatus] ?? r.status })),
  };
}

// ─── A student's leave record (staff) ────────────────────────────────────────

/**
 * Everything the desk, the coordinator and the admin read about one
 * student's leave: the student, their family's other children, every leave
 * (with the family's on request), the counts, the collectors, and — for the
 * coordinator and the admin only — the custody restrictions (the desk sees
 * that one is on file).
 */
export async function studentLeaveRecord(studentId: string, viewer: Viewer) {
  if (!isLeaveStaff(viewer)) throw new LeaveError('Student not found', 404);
  const s = await loadStudent(studentId);
  const today = schoolNow().date;
  const familyIds = await familyOfStudent(studentId);
  const siblings = familyIds.filter((x) => x !== studentId);
  const [rows, parents, allRestrictions, collectors, summary, siblingNames] = await Promise.all([
    db.select().from(leaveRequest).where(eq(leaveRequest.studentId, studentId)).orderBy(desc(leaveRequest.date), desc(leaveRequest.createdAt)).limit(500),
    parentsOf(studentId),
    db.select().from(leaveCustodyRestriction).where(eq(leaveCustodyRestriction.studentId, studentId)).orderBy(asc(leaveCustodyRestriction.createdAt)),
    collectorsOfStudents([studentId], viewer),
    studentHistorySummary(studentId, today),
    namesOf(siblings),
  ]);
  const policy = await readLeavePolicy();
  const grade = gradeOn(s.cohortYear, today);
  const custody = seesIdNumbers(viewer);
  const restrictions = allRestrictions.filter((r) => r.endedAt === null);
  const [section] = [...(await sectionsOn([{ studentId, date: today }])).values()];
  return {
    student: { id: s.id, name: s.name, code: s.code, grade, gradeLabel: gradeLabel(grade), section: section ?? null, leftOn: s.leftOn },
    mayLeaveAlone: grade !== null && policy.aloneGrades.includes(grade),
    parents: (await familyParentsOf(studentId)).map((p) => ({ id: p.id, name: p.name, phone: p.phone })),
    restrictedParents: custody ? parents.filter((p) => restrictions.some((r) => r.restrictedUserId === p.id)).map((p) => ({ id: p.id, name: p.name })) : [],
    siblings: siblings.map((id) => ({ id, name: siblingNames.get(id) ?? '' })),
    summary,
    leaves: await shapeLeaves(rows, viewer),
    collectors,
    custodyOnFile: restrictions.length,
    // Every restriction, ended ones included (the record keeps them), for the coordinator and the admin.
    restrictions: custody ? await shapeRestrictions(allRestrictions) : [],
    canDecide: isApprover(viewer.role, policy),
    // What a staff request form needs.
    policy: { reasons: policy.reasons, aloneGrades: policy.aloneGrades, cutoff: policy.cutoff, noticeMinutes: policy.noticeMinutes },
    today,
  };
}

export async function shapeRestrictions(rows: (typeof leaveCustodyRestriction.$inferSelect)[]) {
  const names = await namesOf(rows.flatMap((r) => [r.createdBy, r.endedBy, r.restrictedUserId]));
  return rows.map((r) => ({
    id: r.id, studentId: r.studentId, personName: r.personName, relation: r.relation, idNumber: r.idNumber,
    restrictedUser: r.restrictedUserId ? { id: r.restrictedUserId, name: names.get(r.restrictedUserId) ?? '' } : null,
    photoFileId: r.photoFileId, documentFileId: r.documentFileId, note: r.note,
    createdBy: r.createdBy ? (names.get(r.createdBy) ?? null) : null, createdAt: r.createdAt,
    endedAt: r.endedAt, endedBy: r.endedBy ? (names.get(r.endedBy) ?? null) : null, endReason: r.endReason,
  }));
}

/** The collectors of some students, as the viewer may see them (ID numbers masked for a family and the desk). */
export async function collectorsOfStudents(studentIds: string[], viewer: Viewer, opts: { includeClosed?: boolean } = {}) {
  if (studentIds.length === 0) return [];
  const links = await db.select({ collectorId: leaveCollectorStudent.collectorId, studentId: leaveCollectorStudent.studentId })
    .from(leaveCollectorStudent).where(inArray(leaveCollectorStudent.studentId, studentIds));
  const ids = [...new Set(links.map((l) => l.collectorId))];
  if (ids.length === 0) return [];
  const rows = await db.select().from(leaveCollector).where(and(
    inArray(leaveCollector.id, ids),
    opts.includeClosed ? sql`true` : inArray(leaveCollector.status, ['pending', 'approved', 'rejected']),
  )).orderBy(asc(leaveCollector.name));
  const allLinks = await db.select({ collectorId: leaveCollectorStudent.collectorId, studentId: leaveCollectorStudent.studentId, name: user.name })
    .from(leaveCollectorStudent).innerJoin(user, eq(user.id, leaveCollectorStudent.studentId)).where(inArray(leaveCollectorStudent.collectorId, ids));
  const names = await namesOf(rows.flatMap((r) => [r.addedBy, r.decidedBy]));
  const whole = seesIdNumbers(viewer);
  const visible = isFamily(viewer) ? new Set(studentIds) : null;
  return rows.map((c) => ({
    id: c.id, name: c.name, relation: c.relation, phone: c.phone,
    idNumber: whole ? c.idNumber : maskIdNumber(c.idNumber),
    photoFileId: c.photoFileId, status: c.status, note: c.note,
    addedBy: c.addedBy ? (names.get(c.addedBy) ?? null) : null, createdAt: c.createdAt,
    decidedBy: c.decidedBy ? (names.get(c.decidedBy) ?? null) : null, decidedAt: c.decidedAt, decisionReason: c.decisionReason,
    // A family sees only its own children among the ones a collector may collect.
    students: allLinks.filter((l) => l.collectorId === c.id && (!visible || visible.has(l.studentId))).map((l) => ({ id: l.studentId, name: l.name })),
  }));
}

// ─── The family's screen ─────────────────────────────────────────────────────

/**
 * What a parent's (or a student's) leave screen needs in one read: the
 * children (grade, section, may they leave alone, who may collect them), the
 * policy the family is told, and their leaves from 60 days back on.
 */
export async function familyLeaveView(viewer: Viewer) {
  if (!isFamily(viewer)) throw new LeaveError('Campus leave here is for families', 403);
  const ids = await familyStudentIds(viewer);
  const policy = await readLeavePolicy();
  const today = schoolNow().date;
  const students = ids.length ? await db.select({ id: user.id, name: user.name, cohortYear: user.cohortYear, leftOn: user.leftOn }).from(user).where(inArray(user.id, ids)) : [];
  const sections = await sectionsOn(ids.map((id) => ({ studentId: id, date: today })));
  const collectors = await collectorsOfStudents(ids, viewer);
  const children = await Promise.all(students.sort((a, b) => a.name.localeCompare(b.name)).map(async (s) => {
    const grade = gradeOn(s.cohortYear, today);
    return {
      id: s.id, name: s.name, grade, gradeLabel: gradeLabel(grade), section: sections.get(`${s.id}|${today}`) ?? null, leftOn: s.leftOn,
      mayLeaveAlone: grade !== null && policy.aloneGrades.includes(grade),
      parents: (await familyParentsOf(s.id)).map((p) => ({ id: p.id, name: p.name, isMe: p.id === viewer.id })),
      collectors: collectors.filter((c) => c.students.some((x) => x.id === s.id)).map((c) => ({ id: c.id, name: c.name, relation: c.relation, status: c.status })),
    };
  }));
  return {
    today,
    now: schoolNow().time,
    children,
    collectors,
    policy: {
      cutoff: policy.cutoff, noticeMinutes: policy.noticeMinutes, limitPerTerm: policy.limitPerTerm, familyRules: policy.familyRules,
      reasons: policy.reasons, aloneGrades: policy.aloneGrades,
    },
    leaves: await listLeaves({}, viewer),
  };
}

// ─── Reports ─────────────────────────────────────────────────────────────────

type ReportRow = {
  id: string; date: string; leave_time: string; return_time: string | null; returning: boolean; status: string; origin: string;
  reason_category: string; reason_label: string; student_id: string; student_name: string; student_code: string | null; cohort_year: number | null;
  checked_out_at: Date | null; returned_at: Date | null; no_show_at: Date | null; late_return_at: Date | null; created_at: Date;
  collected_by_kind: string | null; collected_by_name: string | null; decided_by_name: string | null; created_by_name: string | null; cancel_reason: string | null; decision_note: string | null;
};

async function reportRows(from: string, to: string): Promise<(ReportRow & { grade: number | null; section: string | null })[]> {
  const res = await db.execute(sql`
    select r.id, r.date::text as date, r.leave_time, r.return_time, r.returning, r.status, r.origin, r.reason_category, r.reason_label,
      r.student_id, s.name as student_name, s.student_id as student_code, s.cohort_year, r.checked_out_at, r.returned_at, r.no_show_at, r.late_return_at,
      r.created_at, r.collected_by_kind, r.collected_by_name, d.name as decided_by_name, c.name as created_by_name, r.cancel_reason, r.decision_note
    from leave_request r join "user" s on s.id = r.student_id
    left join "user" d on d.id = r.decided_by left join "user" c on c.id = r.created_by
    where r.date between ${from} and ${to}
    order by r.date, r.leave_time, s.name`);
  // A raw query's timestamps come back as text: made instants here, once.
  const at = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
  const rows = (res.rows as ReportRow[]).map((r) => ({
    ...r, checked_out_at: at(r.checked_out_at), returned_at: at(r.returned_at), no_show_at: at(r.no_show_at),
    late_return_at: at(r.late_return_at), created_at: at(r.created_at)!,
  }));
  const sections = await sectionsOn(rows.map((r) => ({ studentId: r.student_id, date: r.date })));
  return rows.map((r) => ({ ...r, grade: gradeOn(r.cohort_year, r.date), section: sections.get(`${r.student_id}|${r.date}`) ?? null }));
}

/** Leave between two dates: totals, and counts by reason, grade, section, month and origin; the students with most. */
export async function leaveReport(from: string, to: string) {
  if (addDays(from, 800) < to) throw new LeaveError('A report covers at most two years', 400);
  const rows = await reportRows(from, to);
  const taken = rows.filter((r) => r.status === 'checked_out' || r.status === 'returned');
  const standing = rows.filter((r) => r.status !== 'rejected' && r.status !== 'cancelled');
  const count = <K extends string>(list: typeof rows, key: (r: (typeof rows)[number]) => K | null) => {
    const m = new Map<string, { key: string; requests: number; taken: number; noShows: number }>();
    for (const r of list) {
      const k = key(r) ?? '—';
      if (!m.has(k)) m.set(k, { key: k, requests: 0, taken: 0, noShows: 0 });
      const e = m.get(k)!;
      e.requests++;
      if (r.status === 'checked_out' || r.status === 'returned') e.taken++;
      if (r.no_show_at && !r.checked_out_at) e.noShows++;
    }
    return [...m.values()];
  };
  const perStudent = new Map<string, { studentId: string; name: string; gradeLabel: string; section: string | null; count: number }>();
  for (const r of standing) {
    const e = perStudent.get(r.student_id) ?? { studentId: r.student_id, name: r.student_name, gradeLabel: gradeLabel(r.grade), section: r.section, count: 0 };
    e.count++;
    perStudent.set(r.student_id, e);
  }
  const minutesOut = taken.filter((r) => r.checked_out_at && r.returned_at).map((r) => minutesBetween(r.checked_out_at!, r.returned_at!));
  return {
    from, to,
    totals: {
      requests: rows.length,
      approved: rows.filter((r) => ['approved', 'checked_out', 'returned'].includes(r.status)).length,
      pending: rows.filter((r) => r.status === 'pending').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      cancelled: rows.filter((r) => r.status === 'cancelled').length,
      taken: taken.length,
      returned: rows.filter((r) => r.status === 'returned').length,
      noShows: rows.filter((r) => r.no_show_at && !r.checked_out_at).length,
      lateReturns: rows.filter((r) => r.late_return_at).length,
      school: rows.filter((r) => r.origin === 'school').length,
      averageMinutesOut: minutesOut.length ? Math.round(minutesOut.reduce((a, b) => a + b, 0) / minutesOut.length) : null,
    },
    byReason: count(standing, (r) => r.reason_label).sort((a, b) => b.requests - a.requests),
    byGrade: count(standing, (r) => gradeLabel(r.grade)).sort((a, b) => a.key.localeCompare(b.key)),
    bySection: count(standing, (r) => r.section).sort((a, b) => a.key.localeCompare(b.key)),
    byMonth: count(standing, (r) => r.date.slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key)),
    byOrigin: count(rows, (r) => LEAVE_ORIGIN_LABELS[r.origin as LeaveOrigin] ?? r.origin),
    byWeekday: count(standing, (r) => WEEKDAY_NAMES[new Date(`${r.date}T12:00:00Z`).getUTCDay()]!),
    topStudents: [...perStudent.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 15),
  };
}

/** Every leave between two dates, one row each, for a spreadsheet. */
export async function leaveReportCsv(from: string, to: string): Promise<string> {
  const rows = await reportRows(from, to);
  const header = ['Date', 'Student', 'Student ID', 'Grade', 'Section', 'Reason', 'Requested by', 'Origin', 'Requested at', 'Status', 'Decided by', 'Decision note',
    'Leave time', 'Back by', 'Checked out', 'Collected by', 'Returned', 'No-show', 'Late back', 'Cancel reason'];
  const t = (d: Date | null) => (d ? `${schoolNow(d).date} ${schoolTimeOf(d)}` : '');
  const lines = rows.map((r) => [
    r.date, r.student_name, r.student_code, gradeLabel(r.grade), r.section, r.reason_label, r.created_by_name, LEAVE_ORIGIN_LABELS[r.origin as LeaveOrigin] ?? r.origin,
    t(r.created_at), LEAVE_STATUS_LABELS[r.status as LeaveStatus] ?? r.status, r.decided_by_name, r.decision_note,
    r.leave_time, r.returning ? r.return_time : 'Not returning', r.checked_out_at ? schoolTimeOf(r.checked_out_at) : '',
    r.collected_by_kind === 'alone' ? 'Left alone' : r.collected_by_name, r.returned_at ? schoolTimeOf(r.returned_at) : '',
    r.no_show_at && !r.checked_out_at ? 'Yes' : '', r.late_return_at ? 'Yes' : '', r.cancel_reason,
  ].map(csvCell).join(','));
  return [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}

// ─── A teacher's day ─────────────────────────────────────────────────────────

/**
 * The students leaving during the signed-in teacher's lessons on a date (an
 * account linked to a teacher record, whatever its role): each of their
 * lessons that day with who leaves or is out during it.
 */
export async function leaveInMyLessons(viewer: Viewer, date: string) {
  const [t] = await db.select({ id: teacher.id }).from(teacher).where(eq(teacher.userId, viewer.id));
  if (!t) throw new LeaveError('Your account is not linked to a teacher record — ask the admin to link it on the Team page', 404);
  const day = await getScheduleFor({ teacherId: t.id }, date);
  const leaves = await db.select().from(leaveRequest).where(and(eq(leaveRequest.date, date), inArray(leaveRequest.status, ['approved', 'checked_out', 'returned'])));
  if (day.lessons.length === 0 || leaves.length === 0) return { date, lessons: [] };
  const members = await groupMembersBetween([...new Set(day.lessons.map((l) => l.groupId))], date, date);
  const names = await namesOf(leaves.map((l) => l.studentId));
  const lessons = day.lessons.filter((l) => l.status !== 'cancelled' && l.status !== 'covered_by_other').map((l) => {
    const inGroup = new Set(members.filter((m) => m.groupId === l.groupId).map((m) => m.studentId));
    const leaving = leaves.filter((r) => inGroup.has(r.studentId) && l.endsAt > r.leaveTime && (!r.returning || l.startsAt < r.returnTime!));
    return {
      lessonId: l.lessonId, label: l.label, startsAt: l.startsAt, endsAt: l.endsAt, group: l.groupName, subject: l.subject?.name ?? null,
      students: leaving.map((r) => ({
        leaveId: r.id, studentId: r.studentId, name: names.get(r.studentId) ?? '', leaveTime: r.leaveTime, returnTime: r.returning ? r.returnTime : null,
        status: r.status, statusLabel: LEAVE_STATUS_LABELS[r.status as LeaveStatus] ?? r.status,
        leftAt: r.checkedOutAt ? schoolTimeOf(r.checkedOutAt) : null, backAt: r.returnedAt ? schoolTimeOf(r.returnedAt) : null,
      })),
    };
  }).filter((l) => l.students.length > 0);
  return { date, lessons };
}

// ─── The F3 contract ─────────────────────────────────────────────────────────

export type LeaveCoverageRange = {
  leaveId: string;
  /** 'left': checked out at the gate (the times are the gate's); 'planned': approved, not checked out yet. */
  kind: 'left' | 'planned';
  /** HH:MM (Cairo): the check-out time, or the approved leave time. */
  from: string;
  /** HH:MM: the return recorded, else the approved return time, else null (the rest of the day). */
  to: string | null;
  /** Where the excused part ends: the approved return time, or null (the rest of the day). Time out past it (a late return) is not excused. */
  excusedTo: string | null;
  returned: boolean;
  lateReturn: boolean;
  reason: { key: string; label: string };
  origin: LeaveOrigin;
};

/**
 * getLeaveCoverage(studentId, date) — FEATURES_PLAN.md §2, for F3
 * (attendance): the time ranges on a date the student was out of school on
 * approved leave. A lesson overlapping [from, excusedTo ?? end of day) of a
 * 'left' range is "left early — excused"; the part past `excusedTo` up to
 * `to` (a late return) is not excused; a 'planned' range is not yet a
 * leave (the student has not gone): F3 shows it as expected to leave.
 * Pending, refused and cancelled requests give no range. A student checked
 * out after the approved leave time is out from the check-out time.
 */
export async function getLeaveCoverage(studentId: string, date: string): Promise<{ studentId: string; date: string; ranges: LeaveCoverageRange[] }> {
  const rows = await db.select().from(leaveRequest).where(and(
    eq(leaveRequest.studentId, studentId), eq(leaveRequest.date, date), inArray(leaveRequest.status, ['approved', 'checked_out', 'returned']),
  )).orderBy(asc(leaveRequest.leaveTime));
  return {
    studentId, date,
    ranges: rows.map((r) => {
      const left = !!r.checkedOutAt;
      const back = r.returnedAt ? schoolTimeOf(r.returnedAt) : null;
      const expected = r.returning ? r.returnTime : null;
      return {
        leaveId: r.id,
        kind: left ? 'left' as const : 'planned' as const,
        from: left ? schoolTimeOf(r.checkedOutAt!) : r.leaveTime,
        to: back ?? expected,
        excusedTo: expected,
        returned: !!r.returnedAt,
        lateReturn: !!r.lateReturnAt || (!!back && !!expected && back > expected),
        reason: { key: r.reasonCategory, label: r.reasonLabel },
        origin: r.origin as LeaveOrigin,
      };
    }),
  };
}

// Re-exports the routes use.
export { isApprover, readLeavePolicy };
export type { LeaveRow };
