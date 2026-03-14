/**
 * Registration API Routes
 *
 * Handles the full subject registration lifecycle:
 *
 * GET  /registrations/available     - Subjects available for registration in a session (student/parent)
 * GET  /registrations/pending       - Pending approval requests for a parent's children (parent/admin)
 * GET  /registrations/history       - Full registration history across all sessions (own or child)
 * GET  /registrations               - Registrations with optional filters (role-aware)
 * POST /registrations/request       - Student submits a registration request (pending_approval)
 * POST /registrations/direct        - Parent directly registers for a linked child (pending_payment)
 * PUT  /registrations/approve       - Parent approves pending registration requests
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
  ApproveRegistrations,
  RejectRegistrations,
  AdminOverrideApproval,
  ListRegistrationsQuery,
  AvailableSubjectsQuery,
  RegistrationId,
  ROLES,
} from '@repo/validations';
import { success, error } from '../lib/response';
import {
  requireAuth,
  requireParent,
  requireStudent,
  requireAdmin,
  requireStudentOrParent,
  requireAdminOrParent,
} from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as registrationService from '../services/registration.services';
import * as linkService from '../services/link.services';
import { logAction, extractAuditContext } from '../services/audit.services';

export const registrations = new Hono<HonoEnv>()
  .use('*', requireAuth())

  /**
   * GET /registrations/available
   *
   * Returns active subjects not yet registered for the given session.
   * - Students: uses own ID automatically
   * - Parents: must provide studentId (must be a linked child)
   * - Admins: studentId is required
   */
  .get('/available',
    zValidator('query', AvailableSubjectsQuery),
    async (c) => {
      const user = c.get('user')!;
      const { sessionId, studentId: requestedStudentId } = c.req.valid('query');

      let targetStudentId: string;

      if (user.role === ROLES.STUDENT) {
        targetStudentId = user.id;
      } else if (user.role === ROLES.PARENT) {
        if (!requestedStudentId) {
          return error(c, 'studentId is required for parents', 400);
        }
        // Verify parent-child link
        const children = await linkService.getLinkedChildren(user.id);
        const isLinked = children.some((child) => child.id === requestedStudentId);
        if (!isLinked) {
          return error(c, 'You are not linked to this student', 403);
        }
        targetStudentId = requestedStudentId;
      } else if (user.role === ROLES.ADMIN) {
        if (!requestedStudentId) {
          return error(c, 'studentId is required', 400);
        }
        targetStudentId = requestedStudentId;
      } else {
        return error(c, 'Forbidden', 403);
      }

      const available = await registrationService.getAvailableSubjects(
        targetStudentId,
        sessionId
      );
      return success(c, available);
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
        const isLinked = children.some((child) => child.id === studentId);
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
          const isLinked = children.some((child) => child.id === filters.studentId);
          if (!isLinked) return error(c, 'You are not linked to this student', 403);
          const data = await registrationService.getRegistrations(filters);
          return success(c, data);
        }

        // No specific student: return all children's registrations
        const children = await linkService.getLinkedChildren(user.id);
        const studentIds = children.map((c) => c.id);
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
        return success(c, created, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create registration request';
        const status = message.includes('window is not open') ||
                       message.includes('already registered') ||
                       message.includes('core subjects') ? 422 : 400;
        return error(c, message, status);
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
        return success(c, created, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create registration';
        const status = message.includes('not linked') ? 403 :
                       message.includes('window is not open') ||
                       message.includes('already registered') ||
                       message.includes('core subjects') ? 422 : 400;
        return error(c, message, status);
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
        return success(c, updated);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to approve registrations';
        const status = message.includes('not authorized') ? 403 : 400;
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
        return success(c, updated);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reject registrations';
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
          logAction(user.id, 'REGISTRATION_ADMIN_OVERRIDE', 'registration', reg.id, null, reg as Record<string, unknown>, ctx)
            .catch((err) => console.error('[audit] REGISTRATION_ADMIN_OVERRIDE failed:', err));
        }

        return success(c, created, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to override approval';
        const status = message.includes('window is not open') ||
                       message.includes('already registered') ? 422 : 400;
        return error(c, message, status);
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
        const isLinked = children.some((child) => child.id === reg.studentId);
        if (!isLinked) return error(c, 'Access denied', 403);
      }

      return success(c, reg);
    }
  );

export type RegistrationsApi = typeof registrations;
