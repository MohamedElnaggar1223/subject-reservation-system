/**
 * Grade Management API Routes
 *
 * Implements GRADE-001 (automatic progression — triggered by session scheduler),
 * GRADE-002 (manual admin adjustment), and GRADE-003 (graduated student access).
 *
 * Admin only:
 * - PUT  /grade/:studentId  — Manual grade adjustment (GRADE-002)
 * - GET  /grade/graduated   — List all graduated students (role=student, grade=null)
 *
 * Automatic progression (GRADE-001) is handled by the session scheduler
 * (session-closer.ts) and does not require an API endpoint.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  UserId,
  ManualGradeAdjustment,
} from '@repo/validations';
import { success, error } from '../lib/response';
import { requireAuth, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import {
  manualGradeAdjustment,
  getGraduatedStudents,
} from '../services/grade.services';

export const grade = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .use('*', requireAdmin())

  /**
   * GET /grade/graduated
   *
   * Returns a list of all graduated students (role='student', grade=null).
   * Useful for admin reporting and verifying progression results.
   */
  .get('/graduated', async (c) => {
    const students = await getGraduatedStudents();
    return success(c, students);
  })

  /**
   * PUT /grade/:studentId
   * Body: { newGrade: 10 | 11 | 12 | null, reason: string }
   *
   * Admin manually adjusts a student's grade (GRADE-002).
   * Setting newGrade to null marks the student as graduated (GRADE-003).
   * Reason is required — stored in the audit log (USER_GRADE_CHANGED).
   * Student and all linked parents receive a GRADE_CHANGED notification.
   */
  .put('/:id',
    zValidator('param', UserId),
    zValidator('json', ManualGradeAdjustment),
    async (c) => {
      const admin = c.get('user')!;
      const { id: studentId } = c.req.valid('param');
      const { newGrade, reason } = c.req.valid('json');

      try {
        const updated = await manualGradeAdjustment(studentId, newGrade, reason, admin.id);

        if (!updated) {
          return error(c, 'Failed to update grade', 500);
        }

        return success(c, updated);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update grade';
        const status =
          message.includes('not found') ? 404 :
          message.includes('not a student') ? 400 :
          message.includes('already at') ? 409 : 400;
        return error(c, message, status);
      }
    }
  );

export type GradeApi = typeof grade;
