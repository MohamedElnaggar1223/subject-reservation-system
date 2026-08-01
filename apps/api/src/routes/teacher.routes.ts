/**
 * Teacher API Routes (V3 §6.7)
 *
 * GET    /teachers      - List teachers (any authenticated user; pickers)
 * POST   /teachers      - Create teacher (admin)
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
} from '@repo/validations';
import { success, error } from '../lib/response';
import { requireAuth, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as teacherService from '../services/teacher.services';
import { logAction, extractAuditContext } from '../services/audit.services';

export const teachers = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/', zValidator('query', ListTeachersQuery), async (c) => {
    const user = c.get('user')!;
    const filters = c.req.valid('query');
    // Non-admins only ever see active teachers (for registration pickers)
    if (user.role !== 'admin') filters.isActive = true;
    return success(c, await teacherService.getTeachers(filters));
  })

  .post('/', requireAdmin(), zValidator('json', CreateTeacher), async (c) => {
    const user = c.get('user')!;
    const data = c.req.valid('json');
    const created = await teacherService.createTeacher(data);
    logAction(user.id, 'TEACHER_CREATED', 'teacher', created!.id, null, created as Record<string, unknown>, extractAuditContext(c))
      .catch((err) => console.error('[audit] TEACHER_CREATED failed:', err));
    return success(c, created, 201);
  })

  .get('/:id', zValidator('param', TeacherId), async (c) => {
    const { id } = c.req.valid('param');
    const found = await teacherService.getTeacherById(id);
    if (!found) return error(c, 'Teacher not found', 404);
    return success(c, found);
  })

  .put('/:id', requireAdmin(), zValidator('param', TeacherId), zValidator('json', UpdateTeacher), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const updated = await teacherService.updateTeacher(id, data);
    if (!updated) return error(c, 'Teacher not found', 404);
    logAction(user.id, 'TEACHER_UPDATED', 'teacher', id, null, data as Record<string, unknown>, extractAuditContext(c))
      .catch((err) => console.error('[audit] TEACHER_UPDATED failed:', err));
    return success(c, updated);
  })

  .delete('/:id', requireAdmin(), zValidator('param', TeacherId), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const updated = await teacherService.deactivateTeacher(id);
    if (!updated) return error(c, 'Teacher not found', 404);
    logAction(user.id, 'TEACHER_DEACTIVATED', 'teacher', id, null, null, extractAuditContext(c))
      .catch((err) => console.error('[audit] TEACHER_DEACTIVATED failed:', err));
    return success(c, updated);
  });

export type TeachersApi = typeof teachers;
