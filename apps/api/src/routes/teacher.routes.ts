/**
 * Teacher API Routes (V3 §6.7)
 *
 * GET    /teachers      - List teachers (any authenticated user; pickers)
 * GET    /teachers/duplicates?name= - The school's teachers a new name may be (admin, coordinator; D4)
 * POST   /teachers      - Create teacher (admin, coordinator: the coordinator rework, B1); a body naming its
 *                         `kind` is refused when the name looks like a teacher on the list, until `confirmed`
 * GET    /teachers/:id  - Teacher detail with linked subjects
 * PUT    /teachers/:id  - Update teacher (admin)
 * DELETE /teachers/:id  - Deactivate teacher (admin, soft)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  CreateTeacher,
  UpdateTeacher,
  TeacherId,
  ListTeachersQuery,
  LinkTeacherAccount,
  TeacherDuplicatesQuery,
  ROLES,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireAdmin, requireRole } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as teacherService from '../services/teacher.services';
import { logAction, extractAuditContext } from '../services/audit.services';
import { teacherForViewer } from '../lib/teacher-view';
import { db } from '@repo/db';
import { teacherDuplicates, duplicateTeacherRefusal } from '../services/setup/teacher-names';

const forViewer = teacherForViewer;

export const teachers = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/', zValidator('query', ListTeachersQuery), async (c) => {
    const user = c.get('user')!;
    const filters = c.req.valid('query');
    // Non-admins only ever see active teachers (for registration pickers)
    if (user.role !== 'admin') filters.isActive = true;
    const rows = await teacherService.getTeachers(filters);
    return success(c, rows.map((t) => forViewer(t, user.role)));
  })

  /** The school's teachers a new name may be: spelling and initials ("Ms. Mai" against "May Magdy"; D4). */
  .get('/duplicates', requireRole(ROLES.ADMIN, ROLES.COORDINATOR), zValidator('query', TeacherDuplicatesQuery), async (c) =>
    success(c, { duplicates: await teacherDuplicates(db, c.req.valid('query').name) }))

  .post('/', requireRole(ROLES.ADMIN, ROLES.COORDINATOR), zValidator('json', CreateTeacher), async (c) => {
    const user = c.get('user')!;
    const data = c.req.valid('json');
    // The set-up contract (the body names its kind): one person is not entered twice under two spellings.
    if (data.kind && !data.confirmed) {
      const dups = await teacherDuplicates(db, data.name);
      if (dups.length) return error(c, duplicateTeacherRefusal(data.name, dups), 409);
    }
    const created = await teacherService.createTeacher(data);
    await logAction(user.id, 'TEACHER_CREATED', 'teacher', created!.id, null, created as Record<string, unknown>, extractAuditContext(c))
      .catch((err) => console.error('[audit] TEACHER_CREATED failed:', err));
    return success(c, created, 201);
  })

  .get('/:id', zValidator('param', TeacherId), async (c) => {
    const { id } = c.req.valid('param');
    const found = await teacherService.getTeacherById(id);
    if (!found) return error(c, 'Teacher not found', 404);
    return success(c, forViewer(found, c.get('user')!.role));
  })

  .put('/:id', requireAdmin(), zValidator('param', TeacherId), zValidator('json', UpdateTeacher), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const updated = await teacherService.updateTeacher(id, data);
    if (!updated) return error(c, 'Teacher not found', 404);
    await logAction(user.id, 'TEACHER_UPDATED', 'teacher', id, null, data as Record<string, unknown>, extractAuditContext(c))
      .catch((err) => console.error('[audit] TEACHER_UPDATED failed:', err));
    return success(c, updated);
  })

  /**
   * PUT /teachers/:id/account — link this teacher record to a staff account
   * (teaching is a capability, F0a), or unlink it with { userId: null }.
   */
  .put('/:id/account', requireAdmin(), zValidator('param', TeacherId), zValidator('json', LinkTeacherAccount), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { userId } = c.req.valid('json');
    try {
      return success(c, await teacherService.linkTeacherAccount(id, userId, user.id, extractAuditContext(c)));
    } catch (err) {
      const status = err instanceof teacherService.TeacherError ? err.status : 400;
      return error(c, clientMessage(err, 'Failed to link the account'), status);
    }
  })

  .delete('/:id', requireAdmin(), zValidator('param', TeacherId), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const updated = await teacherService.deactivateTeacher(id);
    if (!updated) return error(c, 'Teacher not found', 404);
    await logAction(user.id, 'TEACHER_DEACTIVATED', 'teacher', id, null, null, extractAuditContext(c))
      .catch((err) => console.error('[audit] TEACHER_DEACTIVATED failed:', err));
    return success(c, updated);
  });

export type TeachersApi = typeof teachers;
