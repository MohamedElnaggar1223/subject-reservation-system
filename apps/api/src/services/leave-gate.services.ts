/**
 * The gate (FEATURES_PLAN.md F2, "The gate").
 *
 * The gate sees today's leaves only — approved, out, back, and those
 * cancelled after approval (so it can say "do not release") — each with only
 * what a check-out needs: the student, the times, who the family named,
 * everyone authorised to collect (the linked parents, the approved
 * collectors with their photo and ID number), whether the student may leave
 * alone, and anyone a custody restriction keeps away. Never the reason, the
 * family's note or a document.
 *
 * A pass is scanned (or the leave looked up on the list); the check-out
 * records the time, who collected and whether their ID was seen, and is
 * refused for anyone not authorised — and for anyone a restriction names,
 * which also records the attempt and alerts the approvers at once. A return
 * is recorded for a student coming back.
 */

import {
  db, user, leaveRequest, leaveCollector, leaveCollectorStudent,
  eq, and, inArray, asc, isNotNull, or,
} from '@repo/db';
import { gradeLabel, type CheckOutType, type LeaveStatus, LEAVE_STATUS_LABELS } from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { readLeavePass } from './leave-pass.services';
import { sectionsOn } from './leave.services';
import {
  LeaveError, schoolNow, schoolTimeOf, gradeOn, readLeavePolicy, approverIds, familyParentsOf, parentsOf, activeRestrictions,
  matchingRestrictions, notifyUsers, type Viewer, type Tx, type Executor, type Restriction,
} from './leave-shared.services';

type LeaveRow = typeof leaveRequest.$inferSelect;

// ─── Today's list ────────────────────────────────────────────────────────────

async function gateRows(rows: LeaveRow[]) {
  if (rows.length === 0) return [];
  const today = schoolNow().date;
  const policy = await readLeavePolicy();
  const studentIds = [...new Set(rows.map((r) => r.studentId))];
  const students = await db.select({ id: user.id, name: user.name, code: user.studentId, cohortYear: user.cohortYear }).from(user).where(inArray(user.id, studentIds));
  const byId = new Map(students.map((s) => [s.id, s]));
  const links = await db.select({ collectorId: leaveCollectorStudent.collectorId, studentId: leaveCollectorStudent.studentId })
    .from(leaveCollectorStudent).where(inArray(leaveCollectorStudent.studentId, studentIds));
  const collectorIds = [...new Set([...links.map((l) => l.collectorId), ...rows.map((r) => r.collectorId).filter((x): x is string => !!x)])];
  const collectors = collectorIds.length ? await db.select().from(leaveCollector).where(inArray(leaveCollector.id, collectorIds)) : [];
  const restrictions = await activeRestrictions(studentIds);
  const parents = new Map(await Promise.all(studentIds.map(async (s) => [s, await familyParentsOf(s)] as const)));
  const names = new Map((await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, rows.flatMap((r) => [r.collectorParentId, r.checkedOutBy, r.cancelledBy]).filter((x): x is string => !!x).concat('__none__')))).map((u) => [u.id, u.name]));
  const sections = await sectionsOn(studentIds.map((id) => ({ studentId: id, date: today })));
  return rows.map((r) => {
    const s = byId.get(r.studentId)!;
    const grade = gradeOn(s.cohortYear, r.date);
    const named = r.collectorKind === 'collector' ? collectors.find((c) => c.id === r.collectorId) : undefined;
    const approvedCollectors = collectors.filter((c) => c.status === 'approved' && links.some((l) => l.collectorId === c.id && l.studentId === r.studentId));
    return {
      id: r.id,
      student: { id: s.id, name: s.name, code: s.code, gradeLabel: gradeLabel(grade), section: sections.get(`${s.id}|${today}`) ?? null },
      date: r.date,
      leaveTime: r.leaveTime,
      returning: r.returning,
      returnTime: r.returnTime,
      status: r.status as LeaveStatus,
      statusLabel: LEAVE_STATUS_LABELS[r.status as LeaveStatus] ?? r.status,
      named: r.collectorKind === 'parent'
        ? { kind: 'parent' as const, id: r.collectorParentId, name: r.collectorParentId ? (names.get(r.collectorParentId) ?? null) : null, relation: 'Parent', photoFileId: null }
        : r.collectorKind === 'collector'
          ? { kind: 'collector' as const, id: r.collectorId, name: named?.name ?? null, relation: named?.relation ?? null, photoFileId: named?.photoFileId ?? null, approved: named?.status === 'approved' }
          : { kind: 'alone' as const, id: null, name: null, relation: null, photoFileId: null },
      mayLeaveAlone: grade !== null && policy.aloneGrades.includes(grade),
      authorised: {
        parents: (parents.get(r.studentId) ?? []).map((p) => ({ id: p.id, name: p.name, phone: p.phone })),
        collectors: approvedCollectors.map((c) => ({ id: c.id, name: c.name, relation: c.relation, phone: c.phone, idNumber: c.idNumber, photoFileId: c.photoFileId })),
      },
      custody: restrictions.filter((x) => x.studentId === r.studentId).map((x) => ({ id: x.id, personName: x.personName, relation: x.relation, idNumber: x.idNumber, photoFileId: x.photoFileId })),
      checkout: r.checkedOutAt ? { time: schoolTimeOf(r.checkedOutAt), name: r.collectedByKind === 'alone' ? null : r.collectedByName, kind: r.collectedByKind, by: r.checkedOutBy ? (names.get(r.checkedOutBy) ?? null) : null } : null,
      returnedTime: r.returnedAt ? schoolTimeOf(r.returnedAt) : null,
      cancelledTime: r.cancelledAt ? schoolTimeOf(r.cancelledAt) : null,
      noShow: !!r.noShowAt && !r.checkedOutAt,
      lateReturn: !!r.lateReturnAt,
    };
  });
}

/** Today's leaves at the gate, by leave time. */
export async function gateToday() {
  const today = schoolNow().date;
  const rows = await db.select().from(leaveRequest).where(and(
    eq(leaveRequest.date, today),
    or(inArray(leaveRequest.status, ['approved', 'checked_out', 'returned']), and(eq(leaveRequest.status, 'cancelled'), isNotNull(leaveRequest.decidedAt))),
  )).orderBy(asc(leaveRequest.leaveTime), asc(leaveRequest.createdAt));
  const list = await gateRows(rows);
  return {
    date: today,
    now: schoolNow().time,
    counts: {
      toLeave: list.filter((l) => l.status === 'approved').length,
      out: list.filter((l) => l.status === 'checked_out').length,
      back: list.filter((l) => l.status === 'returned').length,
      noShows: list.filter((l) => l.noShow).length,
      lateReturns: list.filter((l) => l.lateReturn && l.status === 'checked_out').length,
    },
    leaves: list,
  };
}

/** Today's leave, locked: the gate acts on today's list only. */
async function todaysLeave(id: string, executor: Executor, lock: boolean): Promise<LeaveRow> {
  const [r] = lock
    ? await executor.select().from(leaveRequest).where(eq(leaveRequest.id, id)).for('update')
    : await executor.select().from(leaveRequest).where(eq(leaveRequest.id, id));
  if (!r || r.date !== schoolNow().date) throw new LeaveError("Not on today's leave list", 404);
  return r;
}

/** Why a leave cannot be released now, or null. */
function notReleasable(r: LeaveRow, name: string): string | null {
  switch (r.status) {
    case 'approved': return null;
    case 'pending': return `${name}'s leave is not approved yet — do not release them; the coordinator decides first`;
    case 'rejected': return `${name}'s leave was not approved — do not release them`;
    case 'cancelled': return `${name}'s leave was cancelled${r.cancelledAt ? ` at ${schoolTimeOf(r.cancelledAt)}` : ''} — do not release them`;
    case 'checked_out':
    case 'returned': return `${name} already left at ${r.checkedOutAt ? schoolTimeOf(r.checkedOutAt) : ''}${r.collectedByName ? ` with ${r.collectedByName}` : ''}`;
    default: return `${name} may not be released`;
  }
}

// ─── A pass scanned ──────────────────────────────────────────────────────────

const PASS_REFUSALS = {
  malformed: 'This is not a leave pass — look the student up on the list instead',
  forged: 'This pass is not genuine — do not release the student; call the coordinator',
  expired: 'This pass has expired: it was for an earlier day',
} as const;

async function refusePass(viewer: Viewer, leaveId: string | null, reason: string, sentence: string, ctx?: AuditContext): Promise<never> {
  await logAction(viewer.id, 'LEAVE_PASS_REFUSED', 'leave_request', leaveId ?? 'unknown', null, { reason }, ctx).catch(() => undefined);
  throw new LeaveError(sentence, 409);
}

/**
 * A scanned pass: its signature and expiry, then the leave it names — today,
 * this pass version, approved. Returns the leave as the gate's list shows it.
 * Every refusal is recorded (a forged or stale pass is worth knowing about).
 */
export async function scanPass(token: string, viewer: Viewer, ctx?: AuditContext) {
  const read = readLeavePass(token);
  if (!read.ok) return refusePass(viewer, read.leaveId, read.reason, PASS_REFUSALS[read.reason], ctx);
  const [r] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, read.leaveId));
  if (!r) return refusePass(viewer, null, 'unknown_leave', PASS_REFUSALS.forged, ctx);
  const [s] = await db.select({ name: user.name }).from(user).where(eq(user.id, r.studentId));
  const today = schoolNow().date;
  if (r.date !== today) return refusePass(viewer, r.id, 'not_today', `This pass is for ${new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}, not today`, ctx);
  if (read.version !== r.passVersion) return refusePass(viewer, r.id, 'replaced', 'This pass was replaced by a newer one — ask for the pass on the family’s phone now', ctx);
  const why = notReleasable(r, s?.name ?? 'The student');
  if (why) return refusePass(viewer, r.id, `status_${r.status}`, why, ctx);
  return { ...(await gateRows([r]))[0]!, passOk: true };
}

// ─── Check-out ───────────────────────────────────────────────────────────────

type Person = { kind: 'parent' | 'collector' | 'alone'; name: string | null; parentId: string | null; collectorId: string | null };

/**
 * Who is collecting, checked: a family parent of the student, an approved
 * collector of the student, the student alone where the policy allows their
 * grade — or refused. Anyone matching a custody restriction is refused with
 * `custody` set, so the caller records the attempt and alerts the approvers.
 */
async function resolvePerson(r: LeaveRow, input: CheckOutType, studentName: string, cohortYear: number | null, executor: Executor)
  : Promise<{ ok: true; person: Person } | { ok: false; message: string; custody: Restriction[]; attempted: string }> {
  const restrictions = await activeRestrictions([r.studentId], executor);
  const c = input.collectedBy;
  if (c.kind === 'parent') {
    const all = await parentsOf(r.studentId, executor);
    const p = all.find((x) => x.id === c.parentId);
    if (!p) return { ok: false, message: `That person is not a parent linked to ${studentName}`, custody: [], attempted: 'unknown parent' };
    const hit = matchingRestrictions({ userId: p.id, name: p.name }, restrictions);
    if (hit.length) return { ok: false, message: custodyMessage(p.name, studentName), custody: hit, attempted: p.name };
    return { ok: true, person: { kind: 'parent', name: p.name, parentId: p.id, collectorId: null } };
  }
  if (c.kind === 'collector') {
    const [row] = await executor.select({ c: leaveCollector }).from(leaveCollector)
      .innerJoin(leaveCollectorStudent, and(eq(leaveCollectorStudent.collectorId, leaveCollector.id), eq(leaveCollectorStudent.studentId, r.studentId)))
      .where(eq(leaveCollector.id, c.collectorId));
    if (!row) return { ok: false, message: `That person is not an authorised collector of ${studentName}`, custody: [], attempted: 'unknown collector' };
    const hit = matchingRestrictions({ name: row.c.name, idNumber: row.c.idNumber }, restrictions);
    if (hit.length) return { ok: false, message: custodyMessage(row.c.name, studentName), custody: hit, attempted: row.c.name };
    if (row.c.status !== 'approved') {
      return { ok: false, message: `${row.c.name} is ${row.c.status === 'pending' ? 'not approved yet' : 'no longer approved'} to collect ${studentName} — do not release them; the coordinator can approve a collector`, custody: [], attempted: row.c.name };
    }
    return { ok: true, person: { kind: 'collector', name: row.c.name, parentId: null, collectorId: row.c.id } };
  }
  if (c.kind === 'alone') {
    const policy = await readLeavePolicy(executor);
    const g = gradeOn(cohortYear, r.date);
    if (g === null || !policy.aloneGrades.includes(g)) {
      return { ok: false, message: `${studentName} may not leave alone (${gradeLabel(g).toLowerCase()}) — wait for a parent or an approved collector`, custody: [], attempted: 'alone' };
    }
    return { ok: true, person: { kind: 'alone', name: null, parentId: null, collectorId: null } };
  }
  // Someone else: never released; a restricted person is an alert.
  const hit = matchingRestrictions({ name: c.name, idNumber: c.idNumber ?? null }, restrictions);
  if (hit.length) return { ok: false, message: custodyMessage(c.name, studentName), custody: hit, attempted: c.name };
  return {
    ok: false,
    message: `${c.name} is not authorised to collect ${studentName}: only a linked parent or an approved collector may. Do not release them; the coordinator can approve a collector now`,
    custody: [], attempted: c.name,
  };
}

const custodyMessage = (who: string, student: string) =>
  `Custody restriction: ${who} may not collect ${student}. Do not release the student — the coordinator has been alerted`;

/** A refused check-out: recorded, and the approvers alerted when a restriction was matched. */
async function recordRefusal(r: LeaveRow, viewer: Viewer, studentName: string, attempted: string, message: string, custody: Restriction[], ctx?: AuditContext) {
  await db.transaction(async (tx: Tx) => {
    await logAction(viewer.id, 'LEAVE_CHECKOUT_REFUSED', 'leave_request', r.id, null,
      { attempted, custody: custody.map((x) => x.id), reason: custody.length ? 'custody' : 'not_authorised' }, ctx, tx);
    if (custody.length) {
      const policy = await readLeavePolicy(tx);
      await notifyUsers(await approverIds(policy), 'LEAVE_CUSTODY_ALERT', `Custody alert at the gate: ${studentName}`,
        `${attempted} tried to collect ${studentName} at ${schoolNow().time}. The gate refused: a custody restriction names them (${custody.map((x) => x.personName).join(', ')}).`,
        { leaveId: r.id, studentId: r.studentId, link: '/gate' }, tx);
    }
  });
  void message;
}

export async function checkOut(id: string, input: CheckOutType, viewer: Viewer, ctx?: AuditContext) {
  const r0 = await todaysLeave(id, db, false);
  const [s] = await db.select({ name: user.name, cohortYear: user.cohortYear }).from(user).where(eq(user.id, r0.studentId));
  const studentName = s?.name ?? 'The student';
  if (input.via === 'pass') {
    const read = input.token ? readLeavePass(input.token) : null;
    if (!read || !read.ok || read.leaveId !== r0.id || read.version !== r0.passVersion) {
      throw new LeaveError('The pass does not match this leave — scan it again, or look the student up on the list', 409);
    }
  }
  // Checked first outside the check-out, so a refusal is recorded even though nothing changes.
  const first = await resolvePerson(r0, input, studentName, s?.cohortYear ?? null, db);
  if (!first.ok) {
    await recordRefusal(r0, viewer, studentName, first.attempted, first.message, first.custody, ctx);
    throw new LeaveError(first.message, 409);
  }
  const now = new Date();
  const out = await db.transaction(async (tx) => {
    const r = await todaysLeave(id, tx, true);
    const why = notReleasable(r, studentName);
    if (why) throw new LeaveError(why, 409);
    // Again under the lock: a restriction or a withdrawal recorded a moment ago counts.
    const again = await resolvePerson(r, input, studentName, s?.cohortYear ?? null, tx);
    if (!again.ok) throw new LeaveError(again.message, 409);
    const p = again.person;
    const [u] = await tx.update(leaveRequest).set({
      status: 'checked_out', checkedOutAt: now, checkedOutBy: viewer.id, collectedByKind: p.kind,
      collectedByParentId: p.parentId, collectedByCollectorId: p.collectorId, collectedByName: p.name,
      idChecked: input.idChecked, checkedOutVia: input.via, checkoutNote: input.note?.trim() || null,
    }).where(and(eq(leaveRequest.id, r.id), eq(leaveRequest.status, 'approved'))).returning();
    if (!u) throw new LeaveError(`${studentName} is no longer waiting to leave`, 409);
    const namedSomeoneElse = (r.collectorKind === 'parent' && p.parentId !== r.collectorParentId)
      || (r.collectorKind === 'collector' && p.collectorId !== r.collectorId) || (r.collectorKind === 'alone' && p.kind !== 'alone');
    await logAction(viewer.id, 'LEAVE_CHECKED_OUT', 'leave_request', r.id, { status: 'approved' }, {
      status: 'checked_out', collectedBy: p, via: input.via, idChecked: input.idChecked, namedSomeoneElse, time: schoolTimeOf(now),
    }, ctx, tx);
    const family = (await familyParentsOf(r.studentId, tx)).map((x) => x.id).concat(r.studentId);
    const who = p.kind === 'alone' ? 'on their own' : `with ${p.name}`;
    await notifyUsers(family, 'LEAVE_CHECKED_OUT', `${studentName} left school`,
      `${studentName} left school at ${schoolTimeOf(now)} ${who}${namedSomeoneElse ? ' (not the person the request named)' : ''}.${r.returning ? ` Expected back by ${r.returnTime}.` : ''}`,
      { leaveId: r.id, studentId: r.studentId, link: '/leave' }, tx);
    return u;
  });
  return (await gateRows([out]))[0]!;
}

export async function recordReturn(id: string, note: string | null | undefined, viewer: Viewer, ctx?: AuditContext) {
  const now = new Date();
  const out = await db.transaction(async (tx) => {
    const r = await todaysLeave(id, tx, true);
    const [s] = await tx.select({ name: user.name }).from(user).where(eq(user.id, r.studentId));
    const name = s?.name ?? 'The student';
    if (r.status === 'returned') throw new LeaveError(`${name} is already back (${r.returnedAt ? schoolTimeOf(r.returnedAt) : ''})`, 409);
    if (r.status !== 'checked_out') throw new LeaveError(`${name} has not left school on this leave`, 409);
    if (!r.returning) throw new LeaveError(`This leave says ${name} does not come back today`, 409);
    const [u] = await tx.update(leaveRequest).set({ status: 'returned', returnedAt: now, returnRecordedBy: viewer.id })
      .where(and(eq(leaveRequest.id, r.id), eq(leaveRequest.status, 'checked_out'))).returning();
    if (!u) throw new LeaveError(`${name} is no longer out on this leave`, 409);
    const late = !!r.returnTime && schoolTimeOf(now) > r.returnTime;
    await logAction(viewer.id, 'LEAVE_RETURNED', 'leave_request', r.id, { status: 'checked_out' }, { status: 'returned', time: schoolTimeOf(now), late, note: note?.trim() || null }, ctx, tx);
    const family = (await familyParentsOf(r.studentId, tx)).map((x) => x.id);
    await notifyUsers(family, 'LEAVE_RETURNED', `${name} is back at school`,
      `${name} came back to school at ${schoolTimeOf(now)}${late ? ` (expected by ${r.returnTime})` : ''}.`, { leaveId: r.id, studentId: r.studentId, link: '/leave' }, tx);
    return u;
  });
  return (await gateRows([out]))[0]!;
}
