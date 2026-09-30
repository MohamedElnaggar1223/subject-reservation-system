import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import {
  admin, staff, onboard, refused, one, sql, notified, notificationsFor, holdRowLock, lockWaiters, schoolToday, makeTodayASchoolDay,
  type Client,
} from './helpers';

/**
 * F2 — what two people (or two scheduler instances) do to one leave at the
 * same moment (FEATURES_PLAN.md §5: "anything two people can act on at once
 * has a race test"; scheduled jobs act once under two instances):
 *
 * - approve and cancel at the same moment, in both orders (forced with the
 *   leave's row lock held from the test), and unforced;
 * - check-out and cancel at the same moment, in both orders;
 * - two gate staff checking one student out; two approvers approving one request;
 * - a no-show flagged once, and a late return flagged once, by two scheduler
 *   instances at the same tick; a later tick does nothing; the family is told once.
 *
 * Requests awaiting a decision are made for a date outside every academic
 * year the suites create (27 years ahead), so no calendar refuses them.
 */

const FAR = `${academicYearStartOf() + 27}-10-06`;
const TODAY = schoolToday();

type Family = { parent: Client; student: Client; studentId: string };

describe('F2: races and the scheduler', () => {
  let adm: Client, coordinator: Client, coordinator2: Client, gate1: Client, gate2: Client;
  let flag: (now: Date) => Promise<{ noShows: number; lateReturns: number }>;
  let cairo: (date: string, hhmm: string) => Date;
  const fams: Record<string, Family> = {};

  const status = async (id: string) => (await one<{ status: string }>(`select status from leave_request where id = $1`, [id])).status;
  // A request approved as it is made writes both rows in one transaction, with one time (now() is the
  // transaction's): within a time, the steps' own order.
  const actions = async (id: string) => (await sql<{ action: string }>(
    `select action from audit_log where entity_id = $1
     order by created_at, case action when 'LEAVE_REQUESTED' then 0 when 'LEAVE_APPROVED' then 1 else 2 end`, [id])).map((r) => r.action);
  const pending = async (f: Family, date = FAR, leaveTime = '09:00') => (await apiResponse(f.parent.api.v1.leave.requests.$post({ json: {
    studentId: f.studentId, date, leaveTime, returning: false, reasonCategory: 'family', collector: { kind: 'parent', parentId: f.parent.id },
  } }))).leaves[0]!.id;
  const approvedToday = async (f: Family, leaveTime = '08:00', returnTime?: string) => (await apiResponse(coordinator.api.v1.leave.requests.$post({ json: {
    studentId: f.studentId, date: TODAY, leaveTime, returning: !!returnTime, returnTime: returnTime ?? null, reasonCategory: 'family',
    collector: { kind: 'parent', parentId: f.parent.id }, approveNow: true,
  } }))).leaves[0]!.id;
  const approve = (who: Client, id: string) => who.api.v1.leave.requests[':id'].approve.$post({ param: { id }, json: {} });
  const cancel = (f: Family, id: string) => f.parent.api.v1.leave.requests[':id'].cancel.$post({ param: { id }, json: { reason: 'Plans changed' } });
  const checkOut = (g: Client, f: Family, id: string) =>
    g.api.v1.leave.gate[':id']['check-out'].$post({ param: { id }, json: { collectedBy: { kind: 'parent', parentId: f.parent.id }, idChecked: true, via: 'lookup' } });

  /** Fire `first` then `second` while the leave's row is locked, so they reach the lock in that order; then let them run. */
  async function inOrder<A, B>(id: string, first: () => Promise<A>, second: () => Promise<B>): Promise<[A, B]> {
    const release = await holdRowLock('leave_request', id);
    const a = first();
    await lockWaiters(1);
    const b = second();
    await lockWaiters(2);
    await release();
    return Promise.all([a, b]);
  }

  beforeAll(async () => {
    adm = await admin('lvr');
    coordinator = await staff(adm, 'coordinator', 'lvr');
    coordinator2 = await staff(adm, 'coordinator', 'lvr2');
    gate1 = await staff(adm, 'gate', 'lvr1');
    gate2 = await staff(adm, 'gate', 'lvr2');
    const officer = await staff(adm, 'finance_officer', 'lvr');
    for (const k of ['a1', 'a2', 'sw', 'c1', 'c2', 'g2', 'ap', 'ns', 'lr']) fams[k] = await onboard(officer, `lvr-${k}`, 11);
    await makeTodayASchoolDay(coordinator);
    ({ flagLeaveExceptions: flag } = await import('../src/services/leave-jobs.services'));
    ({ cairoInstant: cairo } = await import('../src/services/scheduling-shared.services'));
  }, 120_000);

  afterAll(async () => {
    await sql(`delete from school_setting where key like 'leave.%'`);
  });

  it('approve and cancel at the same moment, approve first: both succeed, the leave ends cancelled, and every step is recorded in order', async () => {
    const f = fams.a1!;
    const id = await pending(f);
    const [a, c] = await inOrder(id, () => approve(coordinator, id), () => cancel(f, id));
    expect([a.status, c.status]).toEqual([200, 200]);
    expect(await status(id)).toBe('cancelled');
    expect(await actions(id)).toEqual(['LEAVE_REQUESTED', 'LEAVE_APPROVED', 'LEAVE_CANCELLED']);
    expect((await notified(f.student.email, 'LEAVE_APPROVED', 1))).toHaveLength(1);
    expect((await notified(f.student.email, 'LEAVE_CANCELLED', 1))).toHaveLength(1);
    // No pass for it now.
    expect((await refused(f.parent.api.v1.leave.requests[':id'].pass.$get({ param: { id } }))).status).toBe(409);
  });

  it('approve and cancel at the same moment, cancel first: the approval is refused with why, nothing approved', async () => {
    const f = fams.a2!;
    const id = await pending(f);
    const [c, a] = await inOrder(id, () => cancel(f, id), () => approve(coordinator, id));
    expect(c.status).toBe(200);
    expect(a.status).toBe(409);
    expect(((await a.json()) as { error: string }).error).toMatch(/^This request was cancelled at \d\d:\d\d by Parent lvr-a2$/);
    expect(await status(id)).toBe('cancelled');
    expect(await actions(id)).toEqual(['LEAVE_REQUESTED', 'LEAVE_CANCELLED']);
    expect(await notificationsFor(f.student.email, 'LEAVE_APPROVED')).toEqual([]);
  });

  it('approve and cancel fired together, unforced, ten times: always cancelled, and the audit says exactly what each response said', async () => {
    const f = fams.sw!;
    for (let i = 0; i < 10; i++) {
      const id = await pending(f);
      const [a, c] = await Promise.all([approve(coordinator, id), cancel(f, id)]);
      expect(c.status).toBe(200);
      expect([200, 409]).toContain(a.status);
      expect(await status(id)).toBe('cancelled');
      // audit_log.created_at is each transaction's start, so two racing transactions' rows can read out of
      // commit order; what the cancellation found is the order: an approved leave if the approval won.
      expect((await actions(id)).sort()).toEqual(a.status === 200 ? ['LEAVE_APPROVED', 'LEAVE_CANCELLED', 'LEAVE_REQUESTED'] : ['LEAVE_CANCELLED', 'LEAVE_REQUESTED']);
      expect(await one(`select previous_data->>'status' as was from audit_log where entity_id = $1 and action = 'LEAVE_CANCELLED'`, [id]))
        .toEqual({ was: a.status === 200 ? 'approved' : 'pending' });
    }
  });

  it('check-out and cancel at the same moment, check-out first: the student left; the cancellation is refused', async () => {
    const f = fams.c1!;
    const id = await approvedToday(f);
    const [o, c] = await inOrder(id, () => checkOut(gate1, f, id), () => cancel(f, id));
    expect(o.status).toBe(200);
    expect(c.status).toBe(409);
    expect(((await c.json()) as { error: string }).error).toMatch(/^The student already left school at \d\d:\d\d — it can no longer be cancelled$/);
    expect(await status(id)).toBe('checked_out');
    expect(await actions(id)).toEqual(['LEAVE_REQUESTED', 'LEAVE_APPROVED', 'LEAVE_CHECKED_OUT']);
  });

  it('check-out and cancel at the same moment, cancel first: the gate is told not to release the student', async () => {
    const f = fams.c2!;
    const id = await approvedToday(f);
    const [c, o] = await inOrder(id, () => cancel(f, id), () => checkOut(gate1, f, id));
    expect(c.status).toBe(200);
    expect(o.status).toBe(409);
    expect(((await o.json()) as { error: string }).error).toMatch(/^Student lvr-c2's leave was cancelled at \d\d:\d\d — do not release them$/);
    expect(await status(id)).toBe('cancelled');
    expect(await actions(id)).toEqual(['LEAVE_REQUESTED', 'LEAVE_APPROVED', 'LEAVE_CANCELLED']);
  });

  it('two gate staff check one student out at once: one check-out, one family notice', async () => {
    const f = fams.g2!;
    const id = await approvedToday(f);
    const [x, y] = await inOrder(id, () => checkOut(gate1, f, id), () => checkOut(gate2, f, id));
    expect([x.status, y.status]).toEqual([200, 409]);
    expect(((await y.json()) as { error: string }).error).toMatch(/^Student lvr-g2 already left at \d\d:\d\d with Parent lvr-g2$/);
    expect((await actions(id)).filter((a) => a === 'LEAVE_CHECKED_OUT')).toHaveLength(1);
    expect(await one(`select checked_out_by from leave_request where id = $1`, [id])).toEqual({ checked_out_by: gate1.id });
    expect(await notified(f.parent.email, 'LEAVE_CHECKED_OUT', 1)).toHaveLength(1);
  });

  it('two approvers approve one request at once: one approval, the other told it is already approved', async () => {
    const f = fams.ap!;
    const id = await pending(f);
    const [x, y] = await inOrder(id, () => approve(coordinator, id), () => approve(coordinator2, id));
    expect([x.status, y.status]).toEqual([200, 409]);
    expect(((await y.json()) as { error: string }).error).toBe('This request is already approved');
    expect((await actions(id)).filter((a) => a === 'LEAVE_APPROVED')).toHaveLength(1);
    expect(await notified(f.parent.email, 'LEAVE_APPROVED', 1)).toHaveLength(1);
  });

  it('a no-show flagged once: two scheduler instances at the same tick flag it once and tell the family once; a later tick does nothing; a late family still checks out', async () => {
    const f = fams.ns!;
    const id = await approvedToday(f, '08:00');
    // Not yet: the grace (30 minutes by default) has not passed.
    const early = cairo(TODAY, '08:29');
    await flag(early);
    expect(await one(`select no_show_at from leave_request where id = $1`, [id])).toEqual({ no_show_at: null });
    // Two instances at 08:31, both reaching the leave while its row is held.
    const tick = cairo(TODAY, '08:31');
    const [a, b] = await inOrder(id, () => flag(tick), () => flag(tick));
    const flaggedForThis = (await sql(`select id from audit_log where action = 'LEAVE_NO_SHOW_FLAGGED' and entity_id = $1`, [id])).length;
    expect(flaggedForThis).toBe(1);
    expect(a.noShows + b.noShows).toBeGreaterThanOrEqual(1);
    expect((await notified(f.parent.email, 'LEAVE_NO_SHOW', 1))[0]!.body)
      .toBe('The leave today at 08:00 was approved, but nobody has checked Student lvr-ns out at the gate. Student lvr-ns is still at school; cancel the leave if plans changed.');
    expect((await notificationsFor('coordinator.lvr@test.local', 'LEAVE_NO_SHOW')).filter((n) => n.title === 'Not collected: Student lvr-ns')).toHaveLength(1);
    // A later tick claims nothing more for it.
    await flag(cairo(TODAY, '09:30'));
    expect((await sql(`select id from audit_log where action = 'LEAVE_NO_SHOW_FLAGGED' and entity_id = $1`, [id])).length).toBe(1);
    expect(await notificationsFor(f.parent.email, 'LEAVE_NO_SHOW')).toHaveLength(1);
    // The gate shows it; the family arriving late still collects.
    expect((await apiResponse(gate1.api.v1.leave.gate.today.$get())).leaves.find((l) => l.id === id)).toMatchObject({ noShow: true, status: 'approved' });
    expect((await checkOut(gate1, f, id)).status).toBe(200);
    expect(await status(id)).toBe('checked_out');
  });

  it('a late return flagged once by two scheduler instances; the return still recorded; F3 sees the late part', async () => {
    const f = fams.lr!;
    const id = await approvedToday(f, '08:00', '08:30');
    expect((await checkOut(gate2, f, id)).status).toBe(200);
    await flag(cairo(TODAY, '08:44'));
    expect(await one(`select late_return_at from leave_request where id = $1`, [id])).toEqual({ late_return_at: null });
    const tick = cairo(TODAY, '08:46');
    await inOrder(id, () => flag(tick), () => flag(tick));
    expect((await sql(`select id from audit_log where action = 'LEAVE_LATE_RETURN_FLAGGED' and entity_id = $1`, [id])).length).toBe(1);
    expect((await notified(f.parent.email, 'LEAVE_LATE_RETURN', 1))[0]!.body)
      .toBe('Student lvr-lr was expected back at school by 08:30 and has not been recorded back. Please contact the school.');
    await flag(cairo(TODAY, '10:00'));
    expect(await notificationsFor(f.parent.email, 'LEAVE_LATE_RETURN')).toHaveLength(1);
    const back = await apiResponse(gate2.api.v1.leave.gate[':id'].return.$post({ param: { id }, json: {} }));
    expect(back).toMatchObject({ status: 'returned', lateReturn: true });
    const { getLeaveCoverage } = await import('../src/services/leave.services');
    expect((await getLeaveCoverage(f.studentId, TODAY)).ranges[0]).toMatchObject({ kind: 'left', excusedTo: '08:30', returned: true, lateReturn: true });
  });
});
