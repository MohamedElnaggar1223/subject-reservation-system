/**
 * The student record (FEATURES_PLAN.md F0a), mounted at /v1/students.
 *
 * GET  /students              list: today's grade, standing, section (desk, coordinator, admin)
 * GET  /students/:id          one record: grade, cohort, section, status, series (same)
 * PUT  /students/:id/cohort   the admin's audited cohort correction
 * POST /students/:id/leave    withdrawn or transferred (coordinator, admin)
 * POST /students/:id/readmit  back at the school (admin)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { UserId, ListStudentsQuery, CorrectCohort, RecordLeaving, Readmit, ROLES } from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole, requireAdmin, requireStudentRecords } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as students from '../services/student.services';

const statusOf = (err: unknown) => (err instanceof students.StudentError ? err.status : 400);

export const studentRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/', requireStudentRecords(), zValidator('query', ListStudentsQuery), async (c) =>
    success(c, await students.listStudents(c.req.valid('query'))))

  .get('/:id', requireStudentRecords(), zValidator('param', UserId), async (c) => {
    try {
      return success(c, await students.getStudentRecord(c.req.valid('param').id));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to load the student'), statusOf(err));
    }
  })

  .put('/:id/cohort', requireAdmin(), zValidator('param', UserId), zValidator('json', CorrectCohort), async (c) => {
    try {
      return success(c, await students.correctCohort(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to correct the cohort'), statusOf(err));
    }
  })

  .post('/:id/leave', requireRole(ROLES.COORDINATOR, ROLES.ADMIN), zValidator('param', UserId), zValidator('json', RecordLeaving), async (c) => {
    try {
      return success(c, await students.recordLeaving(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to record the leaving'), statusOf(err));
    }
  })

  .post('/:id/readmit', requireAdmin(), zValidator('param', UserId), zValidator('json', Readmit), async (c) => {
    try {
      return success(c, await students.readmit(c.req.valid('param').id, c.req.valid('json').reason, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to readmit the student'), statusOf(err));
    }
  });

export type StudentsApi = typeof studentRoutes;
