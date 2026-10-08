/**
 * Subject API Routes
 *
 * Public (authenticated):
 * - GET /subjects         — List subjects (active only; admin can filter by isActive)
 * - GET /subjects/:id     — Get single subject
 *
 * Admin only:
 * - POST   /subjects          — Create subject
 * - PUT    /subjects/:id      — Update subject fields
 * - DELETE /subjects/:id      — Deactivate subject (soft delete)
 * - PUT    /subjects/:id/core — Set isCore flag
 * - PUT    /subjects/:id/activate — Reactivate a deactivated subject
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  CreateSubject,
  UpdateSubject,
  SetSubjectCore,
  SetSubjectTeachers,
  SubjectId,
  ListSubjectsQuery,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as subjectService from '../services/subject.services';
import { logAction, extractAuditContext } from '../services/audit.services';
import { teacherForViewer } from '../lib/teacher-view';

export const subjects = new Hono<HonoEnv>()
  .use('*', requireAuth())

  /**
   * LIST SUBJECTS
   * GET /subjects
   * Query: { council?, search?, isActive?, isCore? }
   *
   * All authenticated users see active subjects only.
   * Admin can additionally pass isActive=false to see deactivated subjects.
   */
  .get('/',
    zValidator('query', ListSubjectsQuery),
    async (c) => {
      const currentUser = c.get('user')!;
      const query = c.req.valid('query');

      // Non-admin users always see active subjects only
      const isActiveFilter =
        currentUser.role === 'admin'
          ? query.isActive
          : true;

      const list = await subjectService.getSubjects({
        council: query.council,
        qualificationLevel: query.qualificationLevel,
        search: query.search,
        isActive: isActiveFilter,
        isCore: query.isCore,
      });

      return success(c, list);
    }
  )

  /**
   * GET SUBJECT BY ID
   * GET /subjects/:id
   *
   * Returns the subject regardless of active status.
   * The client can use isActive to show a warning if needed.
   */
  .get('/:id',
    zValidator('param', SubjectId),
    async (c) => {
      const { id } = c.req.valid('param');

      const found = await subjectService.getSubjectById(id);

      if (!found) {
        return error(c, 'Subject not found', 404);
      }

      return success(c, found);
    }
  )

  /**
   * CREATE SUBJECT
   * POST /subjects
   * Body: CreateSubjectType
   *
   * Admin only. Subject code must be unique.
   */
  .post('/',
    requireAdmin(),
    zValidator('json', CreateSubject),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      const codeAvailable = await subjectService.isCodeUnique(data.code);
      if (!codeAvailable) {
        return error(c, `Subject code "${data.code}" is already in use`, 409);
      }

      const created = await subjectService.createSubject(data);

      await logAction(user.id, 'SUBJECT_CREATED', 'subject', created!.id, null, created as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] SUBJECT_CREATED failed:', err));

      return success(c, created, 201);
    }
  )

  /**
   * UPDATE SUBJECT
   * PUT /subjects/:id
   * Body: UpdateSubjectType (partial)
   *
   * Admin only. Code must remain unique if changed.
   */
  .put('/:id',
    requireAdmin(),
    zValidator('param', SubjectId),
    zValidator('json', UpdateSubject),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');

      // Fetch before-state for audit diff
      const previous = await subjectService.getSubjectById(id);
      if (!previous) {
        return error(c, 'Subject not found', 404);
      }

      if (data.code) {
        const codeAvailable = await subjectService.isCodeUnique(data.code, id);
        if (!codeAvailable) {
          return error(c, `Subject code "${data.code}" is already in use`, 409);
        }
      }

      let updated;
      try {
        updated = await subjectService.updateSubject(id, data, user.id, extractAuditContext(c));
      } catch (err) {
        // Post-merge validation errors (e.g. removing customPrice from a non-school subject)
        if (err instanceof Error) {
          return error(c, clientMessage(err, 'Failed to update subject'), 400);
        }
        throw err;
      }

      if (!updated) {
        return error(c, 'Failed to update subject', 500);
      }

      await logAction(user.id, 'SUBJECT_UPDATED', 'subject', id, previous as Record<string, unknown>, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] SUBJECT_UPDATED failed:', err));

      return success(c, updated);
    }
  )

  /**
   * SET CORE FLAG
   * PUT /subjects/:id/core
   * Body: { isCore: boolean }
   *
   * Admin only. Marks/unmarks a subject as core for Grade 10 June session.
   */
  .put('/:id/core',
    requireAdmin(),
    zValidator('param', SubjectId),
    zValidator('json', SetSubjectCore),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const { isCore } = c.req.valid('json');

      const previous = await subjectService.getSubjectById(id);
      if (!previous) {
        return error(c, 'Subject not found', 404);
      }

      const updated = await subjectService.setSubjectCore(id, isCore);

      if (!updated) {
        return error(c, 'Failed to update subject', 500);
      }

      await logAction(user.id, 'SUBJECT_CORE_UPDATED', 'subject', id, previous as Record<string, unknown>, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] SUBJECT_CORE_UPDATED failed:', err));

      return success(c, updated);
    }
  )

  /**
   * DEACTIVATE SUBJECT
   * DELETE /subjects/:id
   *
   * Admin only. Soft delete — subject is hidden from new registrations
   * but existing registration data is preserved.
   */
  .delete('/:id',
    requireAdmin(),
    zValidator('param', SubjectId),
    async (c) => {
      const { id } = c.req.valid('param');

      const user = c.get('user')!;
      const existing = await subjectService.getSubjectById(id);
      if (!existing) {
        return error(c, 'Subject not found', 404);
      }

      if (!existing.isActive) {
        return error(c, 'Subject is already deactivated', 400);
      }

      // Prevent deactivating core subjects without removing the core designation first
      if (existing.isCore) {
        return error(c, 'Cannot deactivate a core subject. Remove the core designation first.', 409);
      }

      const updated = await subjectService.deactivateSubject(id);

      if (!updated) {
        return error(c, 'Failed to deactivate subject', 500);
      }

      await logAction(user.id, 'SUBJECT_DEACTIVATED', 'subject', id, existing as Record<string, unknown>, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] SUBJECT_DEACTIVATED failed:', err));

      return success(c, updated);
    }
  )

  /**
   * ACTIVATE SUBJECT
   * PUT /subjects/:id/activate
   *
   * Admin only. Reactivates a previously deactivated subject.
   */
  .put('/:id/activate',
    requireAdmin(),
    zValidator('param', SubjectId),
    async (c) => {
      const { id } = c.req.valid('param');

      const user = c.get('user')!;
      const existing = await subjectService.getSubjectById(id);
      if (!existing) {
        return error(c, 'Subject not found', 404);
      }

      if (existing.isActive) {
        return error(c, 'Subject is already active', 400);
      }

      const updated = await subjectService.activateSubject(id);

      if (!updated) {
        return error(c, 'Failed to activate subject', 500);
      }

      await logAction(user.id, 'SUBJECT_ACTIVATED', 'subject', id, existing as Record<string, unknown>, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] SUBJECT_ACTIVATED failed:', err));

      return success(c, updated);
    }
  )

  /**
   * GET SUBJECT TEACHERS (V3 §6.7)
   * GET /subjects/:id/teachers
   */
  .get('/:id/teachers',
    zValidator('param', SubjectId),
    async (c) => {
      const { id } = c.req.valid('param');
      if (!(await subjectService.subjectExists(id))) {
        return error(c, 'Subject not found', 404);
      }
      // RF-20: the same rule as /v1/teachers — names for everyone, contact details for the admin.
      const role = c.get('user')!.role;
      return success(c, (await subjectService.getSubjectTeachers(id)).map((t) => teacherForViewer(t, role)));
    }
  )

  /**
   * SET SUBJECT TEACHERS (V3 §6.7)
   * PUT /subjects/:id/teachers
   *
   * Admin only. Replaces the linked-teacher set.
   */
  .put('/:id/teachers',
    requireAdmin(),
    zValidator('param', SubjectId),
    zValidator('json', SetSubjectTeachers),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const { teacherIds } = c.req.valid('json');

      if (!(await subjectService.subjectExists(id))) {
        return error(c, 'Subject not found', 404);
      }

      try {
        const teachersList = await subjectService.setSubjectTeachers(id, teacherIds);
        await logAction(user.id, 'SUBJECT_UPDATED', 'subject', id, null, { teacherIds }, extractAuditContext(c))
          .catch((err) => console.error('[audit] SUBJECT_UPDATED (teachers) failed:', err));
        return success(c, teachersList);
      } catch (err) {
        const message = clientMessage(err, 'Failed to set teachers');
        return error(c, message, 400);
      }
    }
  );

export type SubjectsApi = typeof subjects;
