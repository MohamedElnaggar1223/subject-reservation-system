/**
 * School Fee API Routes (V3 §6.2)
 *
 * GET    /school-fees/schedules     - List fee schedules (finance-admin/admin)
 * POST   /school-fees/schedules     - Create schedule row
 * PUT    /school-fees/schedules/:id - Update schedule row
 * DELETE /school-fees/schedules/:id - Delete schedule row
 * GET    /school-fees/status        - Fee status for a student (student/parent)
 * POST   /school-fees/pay           - Parent initiates school-fee payment
 *
 * Payments flow through the shared pipeline (purpose='school_fee') and
 * are confirmed by finance in the Workbench like any other payment.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  CreateSchoolFeeSchedule,
  UpdateSchoolFeeSchedule,
  SchoolFeeScheduleId,
  SchoolFeeStatusQuery,
  PaySchoolFee,
  ROLES,
} from '@repo/validations';
import { db } from '@repo/db';
import { success, error, clientMessage } from '../lib/response';
import {
  requireAuth,
  requireParent,
  requireFinanceAdmin,
} from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as schoolFeeService from '../services/school-fee.services';
import { collectSchoolFeeAtDesk } from '../services/desk.services';
import { DeskSchoolFeePayment } from '@repo/validations';
import { requireFinance } from '../middleware/access-control.middleware';
import { env } from '../env';
import { logAction, extractAuditContext } from '../services/audit.services';

function schoolAccountDetails() {
  return {
    bankName: env.SCHOOL_BANK_NAME ?? 'National Bank of Egypt',
    accountName: env.SCHOOL_ACCOUNT_NAME ?? 'IGCSE School',
    accountNumber: env.SCHOOL_ACCOUNT_NUMBER ?? '0012345678901234',
    iban: env.SCHOOL_IBAN ?? null,
  };
}

export const schoolFees = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/schedules', requireFinanceAdmin(), async (c) => {
    return success(c, await schoolFeeService.getSchedules());
  })

  .post('/schedules', requireFinanceAdmin(), zValidator('json', CreateSchoolFeeSchedule), async (c) => {
    const user = c.get('user')!;
    const data = c.req.valid('json');
    try {
      const created = await schoolFeeService.createSchedule(data);
      logAction(user.id, 'SCHOOL_FEE_SCHEDULE_CREATED', 'school_fee_schedule', created!.id, null, created as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] SCHOOL_FEE_SCHEDULE_CREATED failed:', err));
      return success(c, created, 201);
    } catch (err) {
      // The service maps the unique violation to an 'already exists' sentence.
      const message = clientMessage(err, 'Failed to create schedule');
      return error(c, message, /already exists/i.test(message) ? 409 : 400);
    }
  })

  .put('/schedules/:id', requireFinanceAdmin(), zValidator('param', SchoolFeeScheduleId), zValidator('json', UpdateSchoolFeeSchedule), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const updated = await schoolFeeService.updateSchedule(id, data);
    if (!updated) return error(c, 'Schedule not found', 404);
    logAction(user.id, 'SCHOOL_FEE_SCHEDULE_UPDATED', 'school_fee_schedule', id, null, data as Record<string, unknown>, extractAuditContext(c))
      .catch((err) => console.error('[audit] SCHOOL_FEE_SCHEDULE_UPDATED failed:', err));
    return success(c, updated);
  })

  .delete('/schedules/:id', requireFinanceAdmin(), zValidator('param', SchoolFeeScheduleId), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const deleted = await schoolFeeService.deleteSchedule(id);
    if (!deleted) return error(c, 'Schedule not found', 404);
    logAction(user.id, 'SCHOOL_FEE_SCHEDULE_DELETED', 'school_fee_schedule', id, deleted as Record<string, unknown>, null, extractAuditContext(c))
      .catch((err) => console.error('[audit] SCHOOL_FEE_SCHEDULE_DELETED failed:', err));
    return success(c, deleted);
  })

  /**
   * GET /school-fees/status?studentId=
   * Students see their own status; parents pass a linked child's ID.
   */
  .get('/status', zValidator('query', SchoolFeeStatusQuery), async (c) => {
    const user = c.get('user')!;
    const { studentId } = c.req.valid('query');

    const targetStudentId = studentId ?? user.id;
    if (targetStudentId !== user.id) {
      if (user.role !== ROLES.PARENT && user.role !== ROLES.ADMIN) {
        return error(c, 'Forbidden', 403);
      }
      if (user.role === ROLES.PARENT) {
        const link = await db.query.parentStudentLink.findFirst({
          where: (l, { eq, and }) =>
            and(eq(l.parentId, user.id), eq(l.studentId, targetStudentId), eq(l.status, 'approved')),
          columns: { id: true },
        });
        if (!link) return error(c, 'You are not linked to this student', 403);
      }
    }

    try {
      return success(c, await schoolFeeService.getSchoolFeeStatus(targetStudentId));
    } catch (err) {
      const message = clientMessage(err, 'Failed to load status');
      return error(c, message, message.includes('not found') ? 404 : 400);
    }
  })

  /**
   * POST /school-fees/desk-pay  (UX_AUDIT G1)
   *
   * Officer collects the school fee at the desk — recorded and
   * confirmed in one action; the registration gate unlocks immediately.
   * Finance roles + admin.
   */
  .post('/desk-pay', requireFinance(), zValidator('json', DeskSchoolFeePayment), async (c) => {
    const user = c.get('user')!;
    const data = c.req.valid('json');
    try {
      const result = await collectSchoolFeeAtDesk(user.id, data.studentId, data.instrumentUsed, data.notes, data.academicYear);
      logAction(user.id, 'DESK_SCHOOL_FEE_COLLECTED', 'payment', result.paymentId, null, result as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] DESK_SCHOOL_FEE_COLLECTED failed:', err));
      return success(c, result, 201);
    } catch (err) {
      const message = clientMessage(err, 'Failed to collect school fee');
      const status = message.includes('already paid') ? 409 : 400;
      return error(c, message, status);
    }
  })

  /**
   * POST /school-fees/pay
   * Parent-only. Amount comes from the schedule server-side.
   */
  .post('/pay', requireParent(), zValidator('json', PaySchoolFee), async (c) => {
    const user = c.get('user')!;
    const data = c.req.valid('json');

    try {
      const created = await schoolFeeService.initiateSchoolFeePayment(
        user.id,
        data.studentId,
        data.paymentMethod,
        schoolAccountDetails()
      );
      logAction(user.id, 'SCHOOL_FEE_PAYMENT_INITIATED', 'payment', created!.id, null, created as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] SCHOOL_FEE_PAYMENT_INITIATED failed:', err));
      return success(c, created, 201);
    } catch (err) {
      const message = clientMessage(err, 'Failed to initiate payment');
      const status =
        message.includes('not linked') ? 403 :
        message.includes('already') ? 409 : 400;
      return error(c, message, status);
    }
  });

export type SchoolFeesApi = typeof schoolFees;
