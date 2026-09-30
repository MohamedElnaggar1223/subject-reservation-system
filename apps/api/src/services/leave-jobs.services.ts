/**
 * The scheduler's campus-leave step (FEATURES_PLAN.md F2 and §5, "Scheduled
 * jobs"; STATE_AUDIT.md ST-06, ST-12): no-shows and late returns.
 *
 * - A **no-show**: an approved leave nobody checked out by its leave time
 *   and the grace (`leave.noShowGraceMinutes`).
 * - A **late return**: a student checked out, coming back, and not back by
 *   the return time and the grace (`leave.lateReturnGraceMinutes`).
 *
 * Each flag is claimed on its own: a guarded update sets `no_show_at` (or
 * `late_return_at`) only while it is still empty and the leave still in the
 * state that earns it, and the audit row and the notices (to the family and
 * the approvers) are written in that same transaction. So a second scheduler
 * instance running the same tick finds nothing to claim and tells nobody
 * twice; a failure rolls the claim back and the next tick tries again. A flag
 * never changes the status: a family arriving late still checks out, and a
 * student back late is still recorded back.
 */

import { db, leaveRequest, user, eq, and, isNull, sql } from '@repo/db';
import { logAction } from './audit.services';
import {
  readLeavePolicy, approverIds, familyParentsOf, notifyUsers, leaveInstant, addMinutes, schoolNow, whenSpoken,
} from './leave-shared.services';

export async function flagLeaveExceptions(now: Date = new Date()) {
  const policy = await readLeavePolicy();
  const today = schoolNow(now).date;
  // Candidates: today's and earlier days' (a tick missed yesterday is caught up).
  const due = await db.select().from(leaveRequest).where(and(
    sql`${leaveRequest.date} <= ${today}`,
    sql`(
      (${leaveRequest.status} = 'approved' and ${leaveRequest.noShowAt} is null)
      or (${leaveRequest.status} = 'checked_out' and ${leaveRequest.returning} and ${leaveRequest.lateReturnAt} is null)
    )`,
  ));
  const approvers = await approverIds(policy);
  let noShows = 0;
  let lateReturns = 0;
  for (const r of due) {
    const noShow = r.status === 'approved' && addMinutes(leaveInstant(r.date, r.leaveTime), policy.noShowGrace) <= now;
    const late = r.status === 'checked_out' && r.returning && !!r.returnTime && addMinutes(leaveInstant(r.date, r.returnTime), policy.lateGrace) <= now;
    if (!noShow && !late) continue;
    try {
      const claimed = await db.transaction(async (tx) => {
        const [u] = noShow
          ? await tx.update(leaveRequest).set({ noShowAt: now })
            .where(and(eq(leaveRequest.id, r.id), eq(leaveRequest.status, 'approved'), isNull(leaveRequest.noShowAt))).returning()
          : await tx.update(leaveRequest).set({ lateReturnAt: now })
            .where(and(eq(leaveRequest.id, r.id), eq(leaveRequest.status, 'checked_out'), isNull(leaveRequest.lateReturnAt))).returning();
        if (!u) return false;
        const [s] = await tx.select({ name: user.name }).from(user).where(eq(user.id, r.studentId));
        const name = s?.name ?? 'A student';
        const family = (await familyParentsOf(r.studentId, tx)).map((p) => p.id);
        if (noShow) {
          await logAction(null, 'LEAVE_NO_SHOW_FLAGGED', 'leave_request', r.id, { noShowAt: null }, { noShowAt: now.toISOString(), leaveTime: r.leaveTime, graceMinutes: policy.noShowGrace }, undefined, tx);
          await notifyUsers(family, 'LEAVE_NO_SHOW', `${name} has not been collected`,
            `The leave ${whenSpoken(r.date, now)} at ${r.leaveTime} was approved, but nobody has checked ${name} out at the gate. ${name} is still at school; cancel the leave if plans changed.`,
            { leaveId: r.id, studentId: r.studentId, link: '/leave' }, tx);
          await notifyUsers(approvers, 'LEAVE_NO_SHOW', `Not collected: ${name}`,
            `${name}'s leave at ${r.leaveTime} (${r.date}) was approved but nobody checked them out by ${policy.noShowGrace} minutes after.`,
            { leaveId: r.id, studentId: r.studentId, link: '/leave/manage' }, tx);
        } else {
          await logAction(null, 'LEAVE_LATE_RETURN_FLAGGED', 'leave_request', r.id, { lateReturnAt: null }, { lateReturnAt: now.toISOString(), returnTime: r.returnTime, graceMinutes: policy.lateGrace }, undefined, tx);
          await notifyUsers(family, 'LEAVE_LATE_RETURN', `${name} is not back yet`,
            `${name} was expected back at school by ${r.returnTime} and has not been recorded back. Please contact the school.`,
            { leaveId: r.id, studentId: r.studentId, link: '/leave' }, tx);
          await notifyUsers(approvers, 'LEAVE_LATE_RETURN', `Not back: ${name}`,
            `${name} was expected back by ${r.returnTime} (${r.date}) and is not recorded back at the gate.`,
            { leaveId: r.id, studentId: r.studentId, link: '/gate' }, tx);
        }
        return true;
      });
      if (claimed) {
        if (noShow) noShows++;
        else lateReturns++;
      }
    } catch (err) {
      console.error(`[leave] Flagging leave ${r.id} failed; the next tick retries:`, err);
    }
  }
  return { noShows, lateReturns };
}

