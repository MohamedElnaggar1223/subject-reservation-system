/**
 * Parent-Student Link API Routes
 * 
 * Manages parent-student linking operations:
 * - POST /links           - Parent creates link request
 * - GET /links/pending    - Get pending requests (role-aware)
 * - PUT /links/:id        - Student approves/rejects request
 * - GET /links/children   - Parent gets linked children
 * - GET /links/parents    - Student gets linked parents
 * - DELETE /links/:id     - Admin removes link
 * 
 * Authorization:
 * - POST /links: Parent only
 * - GET /links/pending: Student sees incoming, Parent sees outgoing
 * - PUT /links/:id: Student only (must be the target student)
 * - GET /links/children: Parent only
 * - GET /links/parents: Student only
 * - DELETE /links/:id: Admin only
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { 
  CreateLinkRequest, 
  RespondToLink, 
  LinkId, 
  ROLES 
} from '@repo/validations';
import { success, error } from '../lib/response';
import { 
  requireAuth, 
  requireParent, 
  requireStudent, 
  requireAdmin 
} from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as linkService from '../services/link.services';

export const links = new Hono<HonoEnv>()
  // All routes require authentication
  .use('*', requireAuth())

  /**
   * CREATE LINK REQUEST
   * POST /links
   * Body: { studentEmail?: string, studentIdentifier?: string }
   * 
   * Parent initiates a link request to a student.
   * The student must approve before the link is active.
   */
  .post('/',
    requireParent(),
    zValidator('json', CreateLinkRequest),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const link = await linkService.createLinkRequest(user.id, {
          studentEmail: data.studentEmail,
          studentIdentifier: data.studentIdentifier,
        });

        return success(c, link, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create link request';
        return error(c, message, 400);
      }
    }
  )

  /**
   * GET PENDING LINK REQUESTS
   * GET /links/pending
   * 
   * Role-aware endpoint:
   * - Students see incoming link requests (from parents)
   * - Parents see outgoing link requests (to students)
   */
  .get('/pending', async (c) => {
    const user = c.get('user')!;

    if (user.role === ROLES.STUDENT) {
      const pending = await linkService.getPendingLinksForStudent(user.id);
      return success(c, pending);
    }

    if (user.role === ROLES.PARENT) {
      const pending = await linkService.getPendingLinksForParent(user.id);
      return success(c, pending);
    }

    // Admins can see all pending
    if (user.role === ROLES.ADMIN) {
      const all = await linkService.getAllLinks('pending');
      return success(c, all);
    }

    return error(c, 'Invalid role', 403);
  })

  /**
   * GET LINKED CHILDREN
   * GET /links/children
   * 
   * Returns all students linked to the current parent.
   * Parent only.
   */
  .get('/children',
    requireParent(),
    async (c) => {
      const user = c.get('user')!;
      const children = await linkService.getLinkedChildren(user.id);
      return success(c, children);
    }
  )

  /**
   * GET LINKED PARENTS
   * GET /links/parents
   * 
   * Returns all parents linked to the current student.
   * Student only.
   */
  .get('/parents',
    requireStudent(),
    async (c) => {
      const user = c.get('user')!;
      const parents = await linkService.getLinkedParents(user.id);
      return success(c, parents);
    }
  )

  /**
   * RESPOND TO LINK REQUEST
   * PUT /links/:id
   * Body: { status: 'approved' | 'rejected' }
   * 
   * Student approves or rejects a pending link request.
   */
  .put('/:id',
    requireStudent(),
    zValidator('param', LinkId),
    zValidator('json', RespondToLink),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const response = c.req.valid('json');

      try {
        const updated = await linkService.respondToLinkRequest(id, user.id, response);
        return success(c, updated);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to respond to link request';
        return error(c, message, 400);
      }
    }
  )

  /**
   * DELETE LINK
   * DELETE /links/:id
   * 
   * Admin removes any link (pending or approved).
   */
  .delete('/:id',
    requireAdmin(),
    zValidator('param', LinkId),
    async (c) => {
      const { id } = c.req.valid('param');

      // Verify link exists
      const link = await linkService.getLinkById(id);
      if (!link) {
        return error(c, 'Link not found', 404);
      }

      await linkService.deleteLink(id);
      return success(c, { deleted: true });
    }
  )

  /**
   * GET LINK BY ID
   * GET /links/:id
   * 
   * Get details of a specific link.
   * Users can only view links they're part of (or admin).
   */
  .get('/:id',
    zValidator('param', LinkId),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');

      const link = await linkService.getLinkById(id);
      if (!link) {
        return error(c, 'Link not found', 404);
      }

      // Check authorization: user must be parent, student, or admin
      const isParent = link.parentId === user.id;
      const isStudent = link.studentId === user.id;
      const isAdmin = user.role === ROLES.ADMIN;

      if (!isParent && !isStudent && !isAdmin) {
        return error(c, 'Access denied', 403);
      }

      return success(c, link);
    }
  );

export type LinksApi = typeof links;
