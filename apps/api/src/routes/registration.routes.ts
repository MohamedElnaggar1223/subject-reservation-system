/**
 * Registration API Routes
 *
 * Handles the full subject registration lifecycle:
 *
 * GET  /registrations/offers        - What a student can reserve in a session (the Reserve pages, §4.3–§4.4)
 * GET  /registrations/pending       - Pending approval requests for a parent's children (parent/admin)
 * GET  /registrations/history       - Full registration history across all sessions (own or child)
 * GET  /registrations               - Registrations with optional filters (role-aware)
 * POST /registrations/request       - Student submits a registration request (pending_approval)
 * POST /registrations/direct        - Parent directly registers for a linked child (pending_payment)
 * PUT  /registrations/approve       - Parent approves pending registration requests
 * PUT  /registrations/revert-approval - Parent reverts unpaid approvals
 * PUT  /registrations/reject        - Parent rejects pending registration requests
 * POST /registrations/admin-override - Admin bypasses parent approval (audit-logged)
 * GET  /registrations/:id           - Get a single registration by ID
 *
 * Authorization:
 * - All routes require authentication
 * - Students access their own data only
 * - Parents access data for their linked children
 * - Admins have full access to all data
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  RequestRegistration,
  DirectRegistration,
  PreregisterRegistration,
  DeskRegistration,
  DeskCollect,
  ApproveRegistrations,
  RevertApprovedRegistrations,
  RejectRegistrations,
  AdminOverrideApproval,
  ListRegistrationsQuery,
  RegistrationId,
  ROLES,
  STUDENT_RECORD_ROLES,
  EligibilityQuery,
  OffersQuery,
  hasRole,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import {
  requireAuth,
  requireParent,
  requireStudent,
  requireAdmin,
  requireStudentOrParent,
  requireAdminOrParent,
  requireFinance,
} from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as registrationService from '../services/registration.services';
import * as preregService from '../services/prereg.services';
import * as deskService from '../services/desk.services';
import * as linkService from '../services/link.services';
import { mayRegisterFor } from '../services/eligibility.services';
import { offersForStudent } from '../services/offers-read.services';
import { logAction, extractAuditContext } from '../services/audit.services';

/**
 * A refusal's status: the sentence's own mapping where a route has one, else the status the
 * refusing service gave (a line's rules, its price, a reservation: 400, 404 or 409), else 400.
 */
function statusOf(err: unknown, mapped: number): 400 | 403 | 404 | 409 | 422 {
  if (mapped !== 400) return mapped as 403 | 409 | 422;
  const s = (err as { status?: unknown } | null)?.status;
  return s === 403 || s === 404 || s === 409 || s === 422 ? s : 400;
}

export const registrations = new Hono<HonoEnv>()
  .use('*', requireAuth())

  /**
   * GET /registrations/eligibility?studentId=&sessionId= (F0a)
   *
   * May this student register for this window's series, and why not? The
   * student's grade in the series' academic year, and whether a graduate is
   * retaking under A-12. Students ask about themselves, parents about a
   * linked child, the desk, the coordinator and admin about anyone.
   */
  .get('/eligibility',
    zValidator('query', EligibilityQuery),
    async (c) => {
      const user = c.get('user')!;
      const { studentId, sessionId } = c.req.valid('query');
      if (user.role === ROLES.STUDENT && studentId !== user.id) return error(c, 'Forbidden', 403);
      if (user.role === ROLES.PARENT) {
        const children = await linkService.getLinkedChildren(user.id);
        if (!children.some((child) => child.studentId === studentId)) return error(c, 'You are not linked to this student', 403);
      } else if (user.role !== ROLES.STUDENT && !hasRole(user.role, ...STUDENT_RECORD_ROLES)) {
        return error(c, 'Forbidden', 403);
      }
      try {
        return success(c, await mayRegisterFor(studentId, sessionId));
      } catch (err) {
        const message = clientMessage(err, 'Failed to check eligibility');
        return error(c, message, message.includes('not found') ? 404 : 400);
      }
    }
  )

  /**
   * GET /registrations/offers?sessionId=&studentId= (the reservations rework, §5)
   *
   * What a student can reserve in a session: the offers and items with the student's known
   * sittings, teachers, deadlines and the price of each allowed attempt and mode. The student
   * themself, a linked parent, staff with student records. The Reserve pages read it (it replaced
   * /available in step B).
   */
  .get('/offers',
    zValidator('query', OffersQuery),
    async (c) => {
      const user = c.get('user')!;
      const q = c.req.valid('query');
      const studentId = user.role === ROLES.STUDENT ? user.id : q.studentId;
      if (!studentId) return error(c, 'studentId is required', 400);
      if (user.role === ROLES.STUDENT && q.studentId && q.studentId !== user.id) return error(c, 'Forbidden', 403);
      if (user.role === ROLES.PARENT) {
        const children = await linkService.getLinkedChildren(user.id);
        if (!children.some((child) => child.studentId === studentId)) return error(c, 'You are not linked to this student', 403);
      } else if (user.role !== ROLES.STUDENT && !hasRole(user.role, ...STUDENT_RECORD_ROLES)) {
        return error(c, 'Forbidden', 403);
      }
      try {
        const offers = await offersForStudent(studentId, q.sessionId);
        if (!offers) return error(c, 'Session not found', 404);
        return success(c, offers);
      } catch (err) {
        const message = clientMessage(err, 'Failed to load the offers');
        return error(c, message, message.includes('not found') ? 404 : 400);
      }
    }
  )

  /**
   * GET /registrations/pending
   *
   * Returns all pending approval requests from linked children (parent view).
   * Admins see a query-param filtered view.
   */
  .get('/pending',
    requireAdminOrParent(),
    async (c) => {
      const user = c.get('user')!;

      if (user.role === ROLES.PARENT) {
        const pending = await registrationService.getPendingApprovalRequests(user.id);
        return success(c, pending);
      }

      // Admin: returns all pending_approval registrations (filtered by studentId if provided)
      const { studentId } = c.req.query();
      const pending = await registrationService.getRegistrations({
        status: 'pending_approval',
        studentId: studentId || undefined,
      });
      return success(c, pending);
    }
  )

  /**
   * GET /registrations/history
   *
   * Returns the full registration history across all sessions.
   * - Students: own history
   * - Parents: history for a specific linked child (studentId required)
   * - Admins: any student's history (studentId required)
   */
  .get('/history',
    async (c) => {
      const user = c.get('user')!;

      if (user.role === ROLES.STUDENT) {
        const history = await registrationService.getRegistrationHistory(user.id);
        return success(c, history);
      }

      if (user.role === ROLES.PARENT) {
        const { studentId } = c.req.query();
        if (!studentId) return error(c, 'studentId is required', 400);

        // Verify link before returning data
        const children = await linkService.getLinkedChildren(user.id);
        const isLinked = children.some((child) => child.studentId === studentId);
        if (!isLinked) return error(c, 'You are not linked to this student', 403);

        const history = await registrationService.getRegistrationHistory(studentId);
        return success(c, history);
      }

      if (user.role === ROLES.ADMIN) {
        const { studentId } = c.req.query();
        if (!studentId) return error(c, 'studentId is required', 400);
        const history = await registrationService.getRegistrationHistory(studentId);
        return success(c, history);
      }

      return error(c, 'Forbidden', 403);
    }
  )

  /**
   * GET /registrations
   *
   * Role-aware list of registrations with optional filters.
   * - Students: own registrations (studentId filter ignored)
   * - Parents: registrations for all linked children, or a specific child
   * - Admins: all registrations with full filter support
   */
  .get('/',
    zValidator('query', ListRegistrationsQuery),
    async (c) => {
      const user = c.get('user')!;
      const filters = c.req.valid('query');

      if (user.role === ROLES.STUDENT) {
        const data = await registrationService.getRegistrations({
          ...filters,
          studentId: user.id, // always scope to self
        });
        return success(c, data);
      }

      if (user.role === ROLES.PARENT) {
        if (filters.studentId) {
          // Validate parent-child link
          const children = await linkService.getLinkedChildren(user.id);
          const isLinked = children.some((child) => child.studentId === filters.studentId);
          if (!isLinked) return error(c, 'You are not linked to this student', 403);
          const data = await registrationService.getRegistrations(filters);
          return success(c, data);
        }

        // No specific student: return all children's registrations
        const children = await linkService.getLinkedChildren(user.id);
        const studentIds = children.map((c) => c.studentId);
        const data = await registrationService.getRegistrations({
          ...filters,
          studentIds,
        });
        return success(c, data);
      }

      if (user.role === ROLES.ADMIN) {
        const data = await registrationService.getRegistrations(filters);
        return success(c, data);
      }

      return error(c, 'Forbidden', 403);
    }
  )

  /**
   * POST /registrations/request
   *
   * Student submits a registration request for a set of subjects.
   * Creates registrations in 'pending_approval' status.
   * Parent must approve before payment can proceed.
   */
  .post('/request',
    requireStudent(),
    zValidator('json', RequestRegistration),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const created = await registrationService.createRegistrationRequest(
          user.id,
          data,
          user.id
        );
        await logAction(user.id, 'REGISTRATION_REQUESTED', 'registration', created[0]?.id ?? '', null, { registrations: created } as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] REGISTRATION_REQUESTED failed:', err));
        return success(c, created, 201);
      } catch (err) {
        const message = clientMessage(err, 'Failed to create registration request');
        // 409 — precondition not yet met (missing parent link)
        // 422 — semantic violation (closed window, duplicates, core rule)
        // 400 — generic bad request
        const status = message.includes('parent link') ? 409 :
                       message.includes('window is not open') ||
                       message.includes('already registered') ||
                       message.includes('core subjects') ? 422 : 400;
        return error(c, message, statusOf(err, status));
      }
    }
  )

  /**
   * POST /registrations/direct
   *
   * Parent directly registers subjects for one of their linked children.
   * Creates registrations in 'pending_payment' status (auto-approved).
   */
  .post('/direct',
    requireParent(),
    zValidator('json', DirectRegistration),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const created = await registrationService.createDirectRegistration(
          user.id,
          data
        );
        await logAction(user.id, 'REGISTRATION_DIRECT', 'registration', created[0]?.id ?? '', null, { registrations: created } as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] REGISTRATION_DIRECT failed:', err));
        return success(c, created, 201);
      } catch (err) {
        const message = clientMessage(err, 'Failed to create registration');
        const status = message.includes('not linked') ? 403 :
                       message.includes('window is not open') ||
                       message.includes('already registered') ||
                       message.includes('core subjects') ? 422 : 400;
        return error(c, message, statusOf(err, status));
      }
    }
  )

  /**
   * PUT /registrations/approve
   *
   * Parent approves one or more pending registration requests from their child.
   * Moves approved registrations from 'pending_approval' to 'pending_payment'.
   */
  .put('/approve',
    requireParent(),
    zValidator('json', ApproveRegistrations),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const updated = await registrationService.approveRegistrationRequest(
          data,
          user.id
        );
        const auditCtx = extractAuditContext(c);
        for (const regId of data.registrationIds) {
          await logAction(user.id, 'REGISTRATION_APPROVED', 'registration', regId, { status: 'pending_approval' }, { status: 'pending_payment' }, auditCtx)
            .catch((err) => console.error('[audit] REGISTRATION_APPROVED failed:', err));
        }
        return success(c, updated);
      } catch (err) {
        const message = clientMessage(err, 'Failed to approve registrations');
        const status = message.includes('not authorized') ? 403 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /registrations/desk  (UX_AUDIT G1)
   *
   * One desk action: staff register subjects for a student and record
   * the money just taken — registrations confirm and receipts are born
   * immediately. Omit collectNow to register only (family pays later).
   * Finance roles + admin.
   */
  .post('/desk',
    requireFinance(),
    zValidator('json', DeskRegistration),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');
      try {
        const result = await deskService.executeDeskRegistration(user.id, data, extractAuditContext(c));
        return success(c, result, 201);
      } catch (err) {
        const message = clientMessage(err, 'Failed to process desk registration');
        const status =
          message.includes('already') || message.includes('Already') ? 409 :
          message.includes('not open') || message.includes('insufficient') || message.includes('Insufficient') ? 422 : 400;
        return error(c, message, statusOf(err, status));
      }
    }
  )

  /**
   * POST /registrations/desk/collect  (money audit MA-18)
   *
   * Take the money at the desk for subjects already registered and waiting
   * for payment: they confirm and their receipts are born at once. The
   * PAYMENT_CONFIRMED and REGISTRATION_CONFIRMED audit rows are written
   * inside the confirmation. Finance roles + admin.
   */
  .post('/desk/collect',
    requireFinance(),
    zValidator('json', DeskCollect),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');
      try {
        return success(c, await deskService.collectAtDesk(user.id, data, extractAuditContext(c)), 201);
      } catch (err) {
        const message = clientMessage(err, 'Failed to collect payment');
        const status =
          message.includes('in progress') ? 409 :
          message.includes('not open') || message.includes('nsufficient') ? 422 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /registrations/preregister
   *
   * V3 §6.8: parent preregisters subjects for a DRAFT (future) session.
   * Price locks now; payment funds the held wallet; the scheduler
   * captures on activation. Parent only.
   */
  .post('/preregister',
    requireParent(),
    zValidator('json', PreregisterRegistration),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const created = await preregService.createPreregistration(user.id, data);
        const auditCtx = extractAuditContext(c);
        for (const reg of created) {
          await logAction(user.id, 'PREREG_CREATED', 'registration', reg.id, null, reg as Record<string, unknown>, auditCtx)
            .catch((err) => console.error('[audit] PREREG_CREATED failed:', err));
        }
        return success(c, created, 201);
      } catch (err) {
        const message = clientMessage(err, 'Failed to preregister');
        const status =
          message.includes('not linked') ? 403 :
          message.includes('already') || message.includes('Already') ? 409 : 400;
        return error(c, message, statusOf(err, status));
      }
    }
  )

  /**
   * POST /registrations/:id/cancel-prereg
   *
   * Parent cancels a preregistration before the session opens (D-J).
   * Held funds release; the refundable portion (per refund windows)
   * walks the receipt-gated path back to the free balance.
   */
  .post('/:id/cancel-prereg',
    requireParent(),
    zValidator('param', RegistrationId),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');

      try {
        const result = await preregService.cancelPreregistration(id, user.id, extractAuditContext(c));
        return success(c, result);
      } catch (err) {
        const message = clientMessage(err, 'Failed to cancel preregistration');
        const status =
          message.includes('not linked') ? 403 :
          message.includes('already opened') || message.includes('Only preregistered') ? 409 :
          message.includes('not found') ? 404 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * PUT /registrations/revert-approval
   *
   * Parent reverts unpaid pending-payment registrations back to parent approval.
   */
  .put('/revert-approval',
    requireParent(),
    zValidator('json', RevertApprovedRegistrations),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const updated = await registrationService.revertApprovedRegistrationRequest(
          data,
          user.id
        );
        const auditCtx = extractAuditContext(c);
        for (const regId of data.registrationIds) {
          await logAction(user.id, 'REGISTRATION_APPROVAL_REVERTED', 'registration', regId, { status: 'pending_payment' }, { status: 'pending_approval' }, auditCtx)
            .catch((err) => console.error('[audit] REGISTRATION_APPROVAL_REVERTED failed:', err));
        }
        return success(c, updated);
      } catch (err) {
        const message = clientMessage(err, 'Failed to revert approval');
        const status = message.includes('not authorized') ? 403 :
                       message.includes('payment in progress') ||
                       message.includes('cannot be reverted') ? 409 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * PUT /registrations/reject
   *
   * Parent rejects one or more pending registration requests.
   * Rejected registrations move to 'rejected' (terminal state).
   * A comment is required to explain the decision to the student.
   */
  .put('/reject',
    requireParent(),
    zValidator('json', RejectRegistrations),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const updated = await registrationService.rejectRegistrationRequest(
          data,
          user.id
        );
        const auditCtx = extractAuditContext(c);
        for (const regId of data.registrationIds) {
          await logAction(user.id, 'REGISTRATION_REJECTED', 'registration', regId, { status: 'pending_approval' }, { status: 'rejected', comments: data.comments }, auditCtx)
            .catch((err) => console.error('[audit] REGISTRATION_REJECTED failed:', err));
        }
        return success(c, updated);
      } catch (err) {
        const message = clientMessage(err, 'Failed to reject registrations');
        const status = message.includes('not authorized') ? 403 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /registrations/admin-override
   *
   * Admin bypasses the parent approval requirement for exceptional cases.
   * Creates registrations directly in 'pending_payment' status.
   * The reason is stored in approvalComments with an [ADMIN OVERRIDE] prefix.
   */
  .post('/admin-override',
    requireAdmin(),
    zValidator('json', AdminOverrideApproval),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const created = await registrationService.adminOverrideApproval(
          data,
          user.id
        );

        // Audit each registration created by the override
        const ctx = extractAuditContext(c);
        for (const reg of created) {
          await logAction(user.id, 'REGISTRATION_ADMIN_OVERRIDE', 'registration', reg.id, null, reg as Record<string, unknown>, ctx)
            .catch((err) => console.error('[audit] REGISTRATION_ADMIN_OVERRIDE failed:', err));
        }

        return success(c, created, 201);
      } catch (err) {
        const message = clientMessage(err, 'Failed to override approval');
        const status = message.includes('window is not open') ||
                       message.includes('already registered') ? 422 : 400;
        return error(c, message, statusOf(err, status));
      }
    }
  )

  /**
   * GET /registrations/:id
   *
   * Get a single registration by ID.
   * Students can only view their own registrations.
   * Parents can view registrations for their linked children.
   * Admins can view any registration.
   */
  .get('/:id',
    zValidator('param', RegistrationId),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');

      const reg = await registrationService.getRegistrationById(id);
      if (!reg) return error(c, 'Registration not found', 404);

      // Students can only see their own
      if (user.role === ROLES.STUDENT && reg.studentId !== user.id) {
        return error(c, 'Access denied', 403);
      }

      // Parents can only see their linked children's registrations
      if (user.role === ROLES.PARENT) {
        const children = await linkService.getLinkedChildren(user.id);
        const isLinked = children.some((child) => child.studentId === reg.studentId);
        if (!isLinked) return error(c, 'Access denied', 403);
      }

      return success(c, reg);
    }
  );

export type RegistrationsApi = typeof registrations;
