/**
 * Authorised collectors and custody restrictions (FEATURES_PLAN.md F2).
 *
 * A collector is someone a family authorises to collect its children (name,
 * relation, phone, ID number, photo). A parent adds one for their own
 * children and it waits for an approver; the desk may add one for a family
 * (it waits too); the coordinator or the admin adding one vouches for it and
 * it is approved at once. A parent may withdraw a collector from their own
 * children at any time; staff withdraw it altogether.
 *
 * A custody restriction names a person who may not collect a student —
 * possibly a parent linked to the child. The coordinator and the admin record
 * and end them; the gate sees them for the day's list; a family never does.
 * A collector matching a restriction (same account, same ID number, or the
 * same name where an ID is missing) is refused at approval and at the gate.
 */

import {
  db, user, leaveCollector, leaveCollectorStudent, leaveCustodyRestriction, leaveRequest,
  eq, and, inArray, isNull, gte, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  hasRole, ROLES,
  type CreateCollectorType, type CreateRestrictionType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { getReadableFile } from './file.services';
import {
  LeaveError, readLeavePolicy, isApprover, approverIds, familyStudentIds, familyParentsOf, activeRestrictions,
  matchingRestrictions, normalizeIdNumber, notifyUsers, isFamily, isLeaveStaff, schoolNow, spokenDate,
  CUSTODY_ROLES, type Viewer, type Tx,
} from './leave-shared.services';
import { collectorsOfStudents, shapeRestrictions } from './leave.services';

async function studentsNamed(ids: string[]) {
  const rows = ids.length ? await db.select({ id: user.id, name: user.name, role: user.role }).from(user).where(inArray(user.id, ids)) : [];
  if (rows.length !== new Set(ids).size || rows.some((r) => r.role !== 'student')) throw new LeaveError('Student not found', 404);
  return rows;
}

/** The parents to tell about a collector: every family parent of its children. */
async function familiesOf(studentIds: string[], tx?: Tx) {
  const out = new Set<string>();
  for (const s of studentIds) for (const p of await familyParentsOf(s, tx)) out.add(p.id);
  return [...out];
}

// ─── Collectors ──────────────────────────────────────────────────────────────

export async function listCollectors(q: { studentId?: string; status?: string }, viewer: Viewer) {
  if (isFamily(viewer)) {
    const mine = await familyStudentIds(viewer);
    if (q.studentId && !mine.includes(q.studentId)) throw new LeaveError('Student not found', 404);
    return collectorsOfStudents(q.studentId ? [q.studentId] : mine, viewer, { includeClosed: q.status === 'withdrawn' });
  }
  if (!isLeaveStaff(viewer)) throw new LeaveError('Your account cannot list collectors', 403);
  if (q.studentId) {
    await studentsNamed([q.studentId]);
    const all = await collectorsOfStudents([q.studentId], viewer, { includeClosed: true });
    return q.status ? all.filter((c) => c.status === q.status) : all;
  }
  const rows = await db.select({ id: leaveCollectorStudent.studentId }).from(leaveCollectorStudent)
    .innerJoin(leaveCollector, eq(leaveCollector.id, leaveCollectorStudent.collectorId))
    .where(eq(leaveCollector.status, q.status ?? 'pending'));
  const all = await collectorsOfStudents([...new Set(rows.map((r) => r.id))], viewer, { includeClosed: true });
  return all.filter((c) => c.status === (q.status ?? 'pending'));
}

export async function createCollector(input: CreateCollectorType, viewer: Viewer, ctx?: AuditContext) {
  const policy = await readLeavePolicy();
  const studentIds = [...new Set(input.studentIds)];
  if (viewer.role === ROLES.PARENT) {
    const mine = await familyStudentIds(viewer);
    if (studentIds.some((s) => !mine.includes(s))) throw new LeaveError('Student not found', 404);
  } else if (!hasRole(viewer.role, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.COORDINATOR, ROLES.ADMIN)) {
    throw new LeaveError('Your account cannot add collectors', 403);
  }
  const students = await studentsNamed(studentIds);
  if (input.photoFileId) {
    const f = await getReadableFile(input.photoFileId, { id: viewer.id, role: viewer.role });
    if (!f || f.purpose !== 'collector_photo' || !f.studentId || !studentIds.includes(f.studentId)) throw new LeaveError("Attach a collector's photo uploaded for one of these children", 400);
  }
  const vouched = isApprover(viewer.role, policy);
  const id = randomUUID();
  const now = new Date();
  const idNorm = normalizeIdNumber(input.idNumber);
  if (idNorm.length < 4) throw new LeaveError('Give the national ID or passport number', 400);

  await db.transaction(async (tx) => {
    for (const s of [...studentIds].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`leave:collectors:${s}`}))`);
    // One live record per person per child.
    const live = await tx.select({ c: leaveCollector, studentId: leaveCollectorStudent.studentId }).from(leaveCollector)
      .innerJoin(leaveCollectorStudent, eq(leaveCollectorStudent.collectorId, leaveCollector.id))
      .where(and(inArray(leaveCollectorStudent.studentId, studentIds), inArray(leaveCollector.status, ['pending', 'approved'])));
    const dupe = live.find((x) => normalizeIdNumber(x.c.idNumber) === idNorm);
    if (dupe) {
      const who = students.find((s) => s.id === dupe.studentId)!.name;
      throw new LeaveError(`${dupe.c.name} is already ${dupe.c.status === 'approved' ? 'an authorised collector' : 'waiting for approval'} for ${who}`, 409);
    }
    const restrictions = await activeRestrictions(studentIds, tx);
    const hit = matchingRestrictions({ name: input.name, idNumber: input.idNumber }, restrictions);
    if (hit.length) {
      const who = students.find((s) => s.id === hit[0]!.studentId)!.name;
      throw new LeaveError(isFamily(viewer)
        ? `${input.name} cannot be added for ${who} — please contact the school`
        : `${input.name} matches a custody restriction for ${who} (${hit[0]!.personName}) — they may not collect`, 409);
    }
    await tx.insert(leaveCollector).values({
      id, name: input.name.trim(), relation: input.relation.trim(), phone: input.phone.trim(), idNumber: input.idNumber.trim(),
      photoFileId: input.photoFileId ?? null, note: input.note?.trim() || null, addedBy: viewer.id, createdAt: now,
      status: vouched ? 'approved' : 'pending', decidedBy: vouched ? viewer.id : null, decidedAt: vouched ? now : null,
    });
    await tx.insert(leaveCollectorStudent).values(studentIds.map((s) => ({ collectorId: id, studentId: s })));
    await logAction(viewer.id, 'LEAVE_COLLECTOR_ADDED', 'leave_collector', id, null, { name: input.name, relation: input.relation, studentIds, photo: !!input.photoFileId }, ctx, tx);
    const names = students.map((s) => s.name).join(' and ');
    if (vouched) {
      await logAction(viewer.id, 'LEAVE_COLLECTOR_APPROVED', 'leave_collector', id, { status: 'pending' }, { status: 'approved', vouchedBy: 'staff' }, ctx, tx);
      await notifyUsers(await familiesOf(studentIds, tx), 'LEAVE_COLLECTOR_DECIDED', `Collector approved: ${input.name}`,
        `The school recorded ${input.name} (${input.relation}) as authorised to collect ${names}.`, { collectorId: id, link: '/leave' }, tx);
    } else {
      await notifyUsers((await approverIds(policy)).filter((x) => x !== viewer.id), 'LEAVE_COLLECTOR_REQUESTED', `Collector to approve: ${input.name}`,
        `${input.name} (${input.relation}) is proposed to collect ${names}. Check the ID and the photo, then approve or refuse.`, { collectorId: id, link: '/leave/manage?tab=collectors' }, tx);
    }
  });
  return (await collectorsOfStudents(studentIds, viewer, { includeClosed: true })).find((c) => c.id === id)!;
}

async function collectorForUpdate(tx: Tx, id: string) {
  const [c] = await tx.select().from(leaveCollector).where(eq(leaveCollector.id, id)).for('update');
  if (!c) throw new LeaveError('Collector not found', 404);
  const kids = await tx.select({ studentId: leaveCollectorStudent.studentId }).from(leaveCollectorStudent).where(eq(leaveCollectorStudent.collectorId, id));
  return { c, studentIds: kids.map((k) => k.studentId) };
}

const statusWords = (s: string) => (s === 'approved' ? 'already approved' : s === 'rejected' ? 'already refused' : s === 'withdrawn' ? 'withdrawn' : 'waiting');

export async function approveCollector(id: string, viewer: Viewer, ctx?: AuditContext) {
  const policy = await readLeavePolicy();
  if (!isApprover(viewer.role, policy)) throw new LeaveError('Only an approver of leave approves collectors', 403);
  const now = new Date();
  const studentIds = await db.transaction(async (tx) => {
    const { c, studentIds } = await collectorForUpdate(tx, id);
    if (c.status !== 'pending') throw new LeaveError(`This collector is ${statusWords(c.status)}`, 409);
    const hit = matchingRestrictions({ name: c.name, idNumber: c.idNumber }, await activeRestrictions(studentIds, tx));
    if (hit.length) throw new LeaveError(`${c.name} matches a custody restriction (${hit[0]!.personName}) — refuse this collector`, 409);
    const [u] = await tx.update(leaveCollector).set({ status: 'approved', decidedBy: viewer.id, decidedAt: now })
      .where(and(eq(leaveCollector.id, id), eq(leaveCollector.status, 'pending'))).returning();
    if (!u) throw new LeaveError('This collector is no longer waiting', 409);
    await logAction(viewer.id, 'LEAVE_COLLECTOR_APPROVED', 'leave_collector', id, { status: 'pending' }, { status: 'approved' }, ctx, tx);
    await notifyUsers(await familiesOf(studentIds, tx), 'LEAVE_COLLECTOR_DECIDED', `Collector approved: ${c.name}`,
      `The school approved ${c.name} (${c.relation}) to collect your child. The gate checks their ID.`, { collectorId: id, link: '/leave' }, tx);
    return studentIds;
  });
  return (await collectorsOfStudents(studentIds, viewer, { includeClosed: true })).find((x) => x.id === id)!;
}

export async function rejectCollector(id: string, reason: string, viewer: Viewer, ctx?: AuditContext) {
  const policy = await readLeavePolicy();
  if (!isApprover(viewer.role, policy)) throw new LeaveError('Only an approver of leave refuses collectors', 403);
  const now = new Date();
  await db.transaction(async (tx) => {
    const { c, studentIds } = await collectorForUpdate(tx, id);
    if (c.status !== 'pending') throw new LeaveError(`This collector is ${statusWords(c.status)}`, 409);
    await tx.update(leaveCollector).set({ status: 'rejected', decidedBy: viewer.id, decidedAt: now, decisionReason: reason.trim() })
      .where(and(eq(leaveCollector.id, id), eq(leaveCollector.status, 'pending')));
    await logAction(viewer.id, 'LEAVE_COLLECTOR_REJECTED', 'leave_collector', id, { status: 'pending' }, { status: 'rejected', reason: reason.trim() }, ctx, tx);
    await notifyUsers(await familiesOf(studentIds, tx), 'LEAVE_COLLECTOR_DECIDED', `Collector not approved: ${c.name}`,
      `The school did not approve ${c.name} to collect your child: ${reason.trim()}`, { collectorId: id, link: '/leave' }, tx);
    await tellOpenLeaves(tx, id, c.name, studentIds);
  });
  return { id, status: 'rejected' as const };
}

/**
 * Withdraw a collector: a parent from their own children (the collector
 * stays for any other family's child), staff altogether.
 */
export async function withdrawCollector(id: string, reason: string | null | undefined, viewer: Viewer, ctx?: AuditContext) {
  const now = new Date();
  const mine = isFamily(viewer) ? await familyStudentIds(viewer) : null;
  if (viewer.role === ROLES.STUDENT) throw new LeaveError('A parent or the school withdraws a collector', 403);
  if (!mine && !isLeaveStaff(viewer)) throw new LeaveError('Your account cannot withdraw collectors', 403);
  const result = await db.transaction(async (tx) => {
    const { c, studentIds } = await collectorForUpdate(tx, id);
    const removing = mine ? studentIds.filter((s) => mine.includes(s)) : studentIds;
    if (removing.length === 0) throw new LeaveError('Collector not found', 404);
    if (c.status === 'withdrawn' || c.status === 'rejected') throw new LeaveError(`This collector is ${statusWords(c.status)}`, 409);
    const remaining = studentIds.filter((s) => !removing.includes(s));
    if (remaining.length) {
      await tx.delete(leaveCollectorStudent).where(and(eq(leaveCollectorStudent.collectorId, id), inArray(leaveCollectorStudent.studentId, removing)));
    } else {
      await tx.update(leaveCollector).set({ status: 'withdrawn', withdrawnBy: viewer.id, withdrawnAt: now, withdrawnReason: reason?.trim() || null })
        .where(eq(leaveCollector.id, id));
    }
    await logAction(viewer.id, 'LEAVE_COLLECTOR_WITHDRAWN', 'leave_collector', id, { status: c.status, studentIds },
      { status: remaining.length ? c.status : 'withdrawn', removedFor: removing, reason: reason?.trim() || null }, ctx, tx);
    await notifyUsers((await familiesOf(removing, tx)).filter((x) => x !== viewer.id), 'LEAVE_COLLECTOR_DECIDED', `Collector withdrawn: ${c.name}`,
      `${c.name} may no longer collect your child${reason?.trim() ? `: ${reason.trim()}` : '.'}`, { collectorId: id, link: '/leave' }, tx);
    await tellOpenLeaves(tx, id, c.name, removing);
    return { id, status: remaining.length ? c.status : 'withdrawn', removedFor: removing };
  });
  return result;
}

/** Leaves still to come that name a collector who may no longer collect: the family is asked to choose someone else. */
async function tellOpenLeaves(tx: Tx, collectorId: string, name: string, studentIds: string[]) {
  const open = await tx.select({ id: leaveRequest.id, studentId: leaveRequest.studentId, date: leaveRequest.date, leaveTime: leaveRequest.leaveTime }).from(leaveRequest).where(and(
    eq(leaveRequest.collectorId, collectorId), inArray(leaveRequest.studentId, studentIds), inArray(leaveRequest.status, ['pending', 'approved']),
    gte(leaveRequest.date, schoolNow().date),
  ));
  for (const l of open) {
    await notifyUsers(await familiesOf([l.studentId], tx), 'LEAVE_COLLECTOR_DECIDED', `Choose who collects`,
      `The leave on ${spokenDate(l.date)} at ${l.leaveTime} names ${name}, who may no longer collect: a parent or another approved collector must come instead.`,
      { leaveId: l.id, link: '/leave' }, tx);
  }
}

// ─── Custody restrictions ────────────────────────────────────────────────────

function requireCustodyRole(viewer: Viewer) {
  if (!hasRole(viewer.role, ...CUSTODY_ROLES)) throw new LeaveError('Only the coordinator or the admin reads and records custody restrictions', 403);
}

export async function listRestrictions(studentId: string, viewer: Viewer) {
  requireCustodyRole(viewer);
  await studentsNamed([studentId]);
  const rows = await db.select().from(leaveCustodyRestriction).where(eq(leaveCustodyRestriction.studentId, studentId)).orderBy(asc(leaveCustodyRestriction.createdAt));
  return shapeRestrictions(rows);
}

export async function createRestriction(input: CreateRestrictionType, viewer: Viewer, ctx?: AuditContext) {
  requireCustodyRole(viewer);
  const [student] = await studentsNamed([input.studentId]);
  if (input.restrictedUserId) {
    const [u] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, input.restrictedUserId));
    if (!u || u.role !== ROLES.PARENT) throw new LeaveError('The account named must be a parent', 400);
  }
  for (const [fileId, purpose] of [[input.photoFileId, 'custody_photo'], [input.documentFileId, 'custody_document']] as const) {
    if (!fileId) continue;
    const f = await getReadableFile(fileId, { id: viewer.id, role: viewer.role });
    if (!f || f.purpose !== purpose || f.studentId !== input.studentId) throw new LeaveError(`Attach a ${purpose === 'custody_photo' ? 'photo' : 'document'} uploaded for this student's custody note`, 400);
  }
  const id = randomUUID();
  const out = await db.transaction(async (tx) => {
    await tx.insert(leaveCustodyRestriction).values({
      id, studentId: input.studentId, personName: input.personName.trim(), relation: input.relation?.trim() || null,
      idNumber: input.idNumber?.trim() || null, restrictedUserId: input.restrictedUserId ?? null,
      photoFileId: input.photoFileId ?? null, documentFileId: input.documentFileId ?? null, note: input.note.trim(), createdBy: viewer.id,
    });
    await logAction(viewer.id, 'CUSTODY_RESTRICTION_RECORDED', 'custody_restriction', id, null,
      { studentId: input.studentId, personName: input.personName, restrictedUserId: input.restrictedUserId ?? null, idNumber: !!input.idNumber }, ctx, tx);
    // What the new restriction now stops: collectors of the student it matches, and leaves still to come naming them or the parent.
    const [r] = await tx.select().from(leaveCustodyRestriction).where(eq(leaveCustodyRestriction.id, id));
    const collectors = await tx.select({ c: leaveCollector }).from(leaveCollector)
      .innerJoin(leaveCollectorStudent, and(eq(leaveCollectorStudent.collectorId, leaveCollector.id), eq(leaveCollectorStudent.studentId, input.studentId)))
      .where(inArray(leaveCollector.status, ['pending', 'approved']));
    const matching = collectors.filter((x) => matchingRestrictions({ name: x.c.name, idNumber: x.c.idNumber }, [r!]).length > 0).map((x) => x.c);
    const leaves = await tx.select().from(leaveRequest).where(and(
      eq(leaveRequest.studentId, input.studentId), inArray(leaveRequest.status, ['pending', 'approved']), gte(leaveRequest.date, schoolNow().date),
    ));
    const affected = leaves.filter((l) => (l.collectorKind === 'parent' && l.collectorParentId && l.collectorParentId === input.restrictedUserId)
      || (l.collectorKind === 'collector' && matching.some((m) => m.id === l.collectorId)));
    return { matching, affected };
  });
  return {
    restriction: (await listRestrictions(input.studentId, viewer)).find((x) => x.id === id)!,
    studentName: student!.name,
    // The collectors it matches (the gate already refuses them; withdraw them here) and the leaves to come that name them.
    matchingCollectors: out.matching.map((c) => ({ id: c.id, name: c.name, relation: c.relation, status: c.status })),
    affectedLeaves: out.affected.map((l) => ({ id: l.id, date: l.date, leaveTime: l.leaveTime, status: l.status })),
  };
}

export async function endRestriction(id: string, reason: string, viewer: Viewer, ctx?: AuditContext) {
  requireCustodyRole(viewer);
  const now = new Date();
  const studentId = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(leaveCustodyRestriction).where(eq(leaveCustodyRestriction.id, id)).for('update');
    if (!r) throw new LeaveError('Restriction not found', 404);
    const [u] = await tx.update(leaveCustodyRestriction).set({ endedAt: now, endedBy: viewer.id, endReason: reason.trim() })
      .where(and(eq(leaveCustodyRestriction.id, id), isNull(leaveCustodyRestriction.endedAt))).returning();
    if (!u) throw new LeaveError('This restriction has already ended', 409);
    await logAction(viewer.id, 'CUSTODY_RESTRICTION_ENDED', 'custody_restriction', id, { ended: false }, { ended: true, reason: reason.trim() }, ctx, tx);
    return r.studentId;
  });
  return (await listRestrictions(studentId, viewer)).find((x) => x.id === id)!;
}
