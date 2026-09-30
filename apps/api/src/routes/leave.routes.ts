/**
 * Campus leave (FEATURES_PLAN.md F2; docs/features/CAMPUS_LEAVE.md), mounted
 * at /v1/leave.
 *
 * - /family, /requests, /requests/:id, /requests/:id/pass — the family's
 *   screen, lists and details (role-aware), the pass;
 * - POST /requests — a parent, the desk for a family, or the coordinator or
 *   admin (a family's request or the school's own decision);
 * - /requests/:id/approve|reject — the approvers (the leave.approverRoles
 *   setting; the admin always); /requests/:id/cancel — a parent or staff;
 * - /queue — what waits for a decision, with what the approver needs;
 * - /collectors — a family's authorised collectors; /restrictions — custody
 *   (the coordinator's and the admin's);
 * - /gate/* — today's list, a pass scanned, a check-out, a return (the gate,
 *   and the coordinator or admin standing in);
 * - /students/:studentId — a student's leave record (staff);
 * - /reports, /reports/csv — history and reports (staff);
 * - /teaching — the students leaving during the signed-in teacher's lessons.
 *
 * Every role gate is recorded in apps/api/test/authz-policy.tsv; the handler
 * then decides whose records (another family's leave answers "not found").
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  IdParam, CreateLeaveRequest, ApproveLeave, RejectLeave, CancelLeave, LeaveListQuery, StudentParam, CreateCollector,
  CollectorsQuery, RejectCollector, WithdrawCollector, CreateRestriction, RestrictionsQuery, EndRestriction, ScanPass,
  CheckOut, RecordReturn, LeaveReportQuery, LeaveTeachingQuery, ROLES,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole, requireStaff } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as leave from '../services/leave.services';
import * as collectors from '../services/leave-collector.services';
import * as gate from '../services/leave-gate.services';
import { LeaveError, schoolNow } from '../services/leave-shared.services';
import { FileError } from '../services/file.services';

const fail = (err: unknown, fallback: string) => ({
  message: clientMessage(err, fallback),
  status: err instanceof LeaveError || err instanceof FileError ? (err.status === 503 ? 400 : err.status) : 400,
});

const { PARENT, STUDENT, FINANCE_OFFICER, FINANCE_ADMIN, COORDINATOR, ADMIN, GATE } = ROLES;
const FAMILY = [PARENT, STUDENT] as const;
const DESK_AND_ACADEMIC = [FINANCE_OFFICER, FINANCE_ADMIN, COORDINATOR, ADMIN] as const;
const ACADEMIC = [COORDINATOR, ADMIN] as const;
const AT_GATE = [GATE, COORDINATOR, ADMIN] as const;

const viewerOf = (c: { get: (k: 'user') => { id: string; role?: string | null; name?: string | null } | null }) => {
  const u = c.get('user')!;
  return { id: u.id, role: u.role ?? null, name: u.name ?? null };
};

export const leaveRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  // ── The family ──
  .get('/family', requireRole(...FAMILY), async (c) => {
    try {
      return success(c, await leave.familyLeaveView(viewerOf(c)));
    } catch (err) {
      const f = fail(err, 'Failed to load campus leave');
      return error(c, f.message, f.status);
    }
  })

  // ── Requests ──
  .get('/requests', requireRole(...FAMILY, ...DESK_AND_ACADEMIC), zValidator('query', LeaveListQuery), async (c) => {
    try {
      return success(c, await leave.listLeaves(c.req.valid('query'), viewerOf(c)));
    } catch (err) {
      const f = fail(err, 'Failed to load the leave requests');
      return error(c, f.message, f.status);
    }
  })
  .post('/requests', requireRole(PARENT, ...DESK_AND_ACADEMIC), zValidator('json', CreateLeaveRequest), async (c) => {
    try {
      return success(c, await leave.createLeave(c.req.valid('json'), viewerOf(c), extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to send the request');
      return error(c, f.message, f.status);
    }
  })
  .get('/requests/:id', requireRole(...FAMILY, ...DESK_AND_ACADEMIC), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await leave.getLeave(c.req.valid('param').id, viewerOf(c)));
    } catch (err) {
      const f = fail(err, 'Failed to load the request');
      return error(c, f.message, f.status);
    }
  })
  .post('/requests/:id/approve', requireRole(...ACADEMIC), zValidator('param', IdParam), zValidator('json', ApproveLeave), async (c) => {
    try {
      return success(c, await leave.approveLeave(c.req.valid('param').id, c.req.valid('json'), viewerOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to approve the request');
      return error(c, f.message, f.status);
    }
  })
  .post('/requests/:id/reject', requireRole(...ACADEMIC), zValidator('param', IdParam), zValidator('json', RejectLeave), async (c) => {
    try {
      return success(c, await leave.rejectLeave(c.req.valid('param').id, c.req.valid('json'), viewerOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to refuse the request');
      return error(c, f.message, f.status);
    }
  })
  .post('/requests/:id/cancel', requireRole(PARENT, ...DESK_AND_ACADEMIC), zValidator('param', IdParam), zValidator('json', CancelLeave), async (c) => {
    try {
      return success(c, await leave.cancelLeave(c.req.valid('param').id, c.req.valid('json'), viewerOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to cancel the leave');
      return error(c, f.message, f.status);
    }
  })
  /** GET /requests/:id/pass — the signed pass the family shows at the gate. */
  .get('/requests/:id/pass', requireRole(...FAMILY), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await leave.passFor(c.req.valid('param').id, viewerOf(c)));
    } catch (err) {
      const f = fail(err, 'Failed to load the pass');
      return error(c, f.message, f.status);
    }
  })
  /** POST /requests/:id/pass — a new pass; the old one stops working. */
  .post('/requests/:id/pass', requireRole(PARENT), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await leave.reissuePass(c.req.valid('param').id, viewerOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to replace the pass');
      return error(c, f.message, f.status);
    }
  })

  // ── Approval ──
  .get('/queue', requireRole(...ACADEMIC), async (c) => {
    try {
      return success(c, await leave.approvalQueue(viewerOf(c)));
    } catch (err) {
      const f = fail(err, 'Failed to load the requests to approve');
      return error(c, f.message, f.status);
    }
  })

  // ── Collectors ──
  .get('/collectors', requireRole(...FAMILY, ...DESK_AND_ACADEMIC), zValidator('query', CollectorsQuery), async (c) => {
    try {
      return success(c, await collectors.listCollectors(c.req.valid('query'), viewerOf(c)));
    } catch (err) {
      const f = fail(err, 'Failed to load the collectors');
      return error(c, f.message, f.status);
    }
  })
  .post('/collectors', requireRole(PARENT, ...DESK_AND_ACADEMIC), zValidator('json', CreateCollector), async (c) => {
    try {
      return success(c, await collectors.createCollector(c.req.valid('json'), viewerOf(c), extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to add the collector');
      return error(c, f.message, f.status);
    }
  })
  .post('/collectors/:id/approve', requireRole(...ACADEMIC), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await collectors.approveCollector(c.req.valid('param').id, viewerOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to approve the collector');
      return error(c, f.message, f.status);
    }
  })
  .post('/collectors/:id/reject', requireRole(...ACADEMIC), zValidator('param', IdParam), zValidator('json', RejectCollector), async (c) => {
    try {
      return success(c, await collectors.rejectCollector(c.req.valid('param').id, c.req.valid('json').reason, viewerOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to refuse the collector');
      return error(c, f.message, f.status);
    }
  })
  .post('/collectors/:id/withdraw', requireRole(PARENT, ...DESK_AND_ACADEMIC), zValidator('param', IdParam), zValidator('json', WithdrawCollector), async (c) => {
    try {
      return success(c, await collectors.withdrawCollector(c.req.valid('param').id, c.req.valid('json').reason, viewerOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to withdraw the collector');
      return error(c, f.message, f.status);
    }
  })

  // ── Custody restrictions ──
  .get('/restrictions', requireRole(...ACADEMIC), zValidator('query', RestrictionsQuery), async (c) => {
    try {
      return success(c, await collectors.listRestrictions(c.req.valid('query').studentId, viewerOf(c)));
    } catch (err) {
      const f = fail(err, 'Failed to load the custody restrictions');
      return error(c, f.message, f.status);
    }
  })
  .post('/restrictions', requireRole(...ACADEMIC), zValidator('json', CreateRestriction), async (c) => {
    try {
      return success(c, await collectors.createRestriction(c.req.valid('json'), viewerOf(c), extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to record the restriction');
      return error(c, f.message, f.status);
    }
  })
  .post('/restrictions/:id/end', requireRole(...ACADEMIC), zValidator('param', IdParam), zValidator('json', EndRestriction), async (c) => {
    try {
      return success(c, await collectors.endRestriction(c.req.valid('param').id, c.req.valid('json').reason, viewerOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to end the restriction');
      return error(c, f.message, f.status);
    }
  })

  // ── The gate: today only ──
  .get('/gate/today', requireRole(...AT_GATE), async (c) => {
    try {
      return success(c, await gate.gateToday());
    } catch (err) {
      const f = fail(err, "Failed to load today's leave");
      return error(c, f.message, f.status);
    }
  })
  .post('/gate/scan', requireRole(...AT_GATE), zValidator('json', ScanPass), async (c) => {
    try {
      return success(c, await gate.scanPass(c.req.valid('json').token, viewerOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to read the pass');
      return error(c, f.message, f.status);
    }
  })
  .post('/gate/:id/check-out', requireRole(...AT_GATE), zValidator('param', IdParam), zValidator('json', CheckOut), async (c) => {
    try {
      return success(c, await gate.checkOut(c.req.valid('param').id, c.req.valid('json'), viewerOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to check the student out');
      return error(c, f.message, f.status);
    }
  })
  .post('/gate/:id/return', requireRole(...AT_GATE), zValidator('param', IdParam), zValidator('json', RecordReturn), async (c) => {
    try {
      return success(c, await gate.recordReturn(c.req.valid('param').id, c.req.valid('json').note, viewerOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to record the return');
      return error(c, f.message, f.status);
    }
  })

  // ── A student's record, history and reports (staff) ──
  .get('/students/:studentId', requireRole(...DESK_AND_ACADEMIC), zValidator('param', StudentParam), async (c) => {
    try {
      return success(c, await leave.studentLeaveRecord(c.req.valid('param').studentId, viewerOf(c)));
    } catch (err) {
      const f = fail(err, "Failed to load the student's leave");
      return error(c, f.message, f.status);
    }
  })
  .get('/reports', requireRole(...DESK_AND_ACADEMIC), zValidator('query', LeaveReportQuery), async (c) => {
    const q = c.req.valid('query');
    try {
      return success(c, await leave.leaveReport(q.from, q.to));
    } catch (err) {
      const f = fail(err, 'Failed to build the report');
      return error(c, f.message, f.status);
    }
  })
  /** GET /reports/csv — every leave in the range, one row each. */
  .get('/reports/csv', requireRole(...DESK_AND_ACADEMIC), zValidator('query', LeaveReportQuery), async (c) => {
    const q = c.req.valid('query');
    try {
      return new Response(await leave.leaveReportCsv(q.from, q.to), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="campus-leave-${q.from}-${q.to}.csv"` },
      });
    } catch (err) {
      const f = fail(err, 'Failed to build the report');
      return error(c, f.message, f.status);
    }
  })

  // ── A teacher's lessons ──
  .get('/teaching', requireStaff(), zValidator('query', LeaveTeachingQuery), async (c) => {
    try {
      return success(c, await leave.leaveInMyLessons(viewerOf(c), c.req.valid('query').date ?? schoolNow().date));
    } catch (err) {
      const f = fail(err, 'Failed to load the leave in your lessons');
      return error(c, f.message, f.status);
    }
  });

export type LeaveApi = typeof leaveRoutes;
