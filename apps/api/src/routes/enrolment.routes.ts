/**
 * Course enrolment (FEATURES_PLAN.md F0b), mounted at /v1/enrolments.
 *
 * Read: the desk, the coordinator and admin read any student's enrolment
 * (the student record); a student reads their own and a parent a linked
 * child's (GET /student/:studentId); a teacher reads only the class lists of
 * the subjects they teach (GET /class).
 * Change (the coordinator and admin): one at a time, in bulk (carried
 * forward, from registrations), a whole section, or rows pasted from a sheet
 * — the same entry point F7's import fills. All audited.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  ROLES, STUDENT_RECORD_ROLES, hasRole, IdParam, ListEnrolmentsQuery, StudentEnrolmentParam, StudentEnrolmentQuery, CreateEnrolment,
  UpdateEnrolment, EndEnrolment, BulkEnrol, EnrolSection, BatchEnrol, EnrolmentCheckQuery, ClassListQuery,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireAcademic, requireStaff, requireStudentRecords } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as enrolment from '../services/enrolment.services';
import * as linkService from '../services/link.services';

const fail = (err: unknown, fallback: string) => ({
  message: clientMessage(err, fallback),
  status: err instanceof enrolment.EnrolmentError ? err.status : 400,
});

export const enrolmentRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/', requireStudentRecords(), zValidator('query', ListEnrolmentsQuery), async (c) => {
    try {
      return success(c, await enrolment.listEnrolments(c.req.valid('query')));
    } catch (err) {
      const f = fail(err, 'Failed to load the enrolments');
      return error(c, f.message, f.status);
    }
  })

  /** GET /enrolments/check?academicYearId= — registrations against enrolments: the four flags. */
  .get('/check', requireStudentRecords(), zValidator('query', EnrolmentCheckQuery), async (c) => {
    const { academicYearId, studentId } = c.req.valid('query');
    try {
      return success(c, await enrolment.checkEnrolments(academicYearId, studentId));
    } catch (err) {
      const f = fail(err, 'Failed to check the enrolments');
      return error(c, f.message, f.status);
    }
  })

  /** GET /enrolments/teaching-demand?academicYearId= — F1's source for teaching groups (self-study excluded). */
  .get('/teaching-demand', requireAcademic(), zValidator('query', z.object({ academicYearId: z.string().min(1) })), async (c) => {
    try {
      return success(c, await enrolment.getTeachingDemand(c.req.valid('query').academicYearId));
    } catch (err) {
      const f = fail(err, 'Failed to load the teaching groups');
      return error(c, f.message, f.status);
    }
  })

  /** GET /enrolments/students?academicYearId=&search= — who can be enrolled that year (the per-student picker). */
  .get('/students', requireAcademic(), zValidator('query', z.object({ academicYearId: z.string().min(1), search: z.string().max(100).optional() })), async (c) => {
    const { academicYearId, search } = c.req.valid('query');
    try {
      return success(c, await enrolment.enrolableStudents(academicYearId, search));
    } catch (err) {
      const f = fail(err, 'Failed to find students');
      return error(c, f.message, f.status);
    }
  })

  /**
   * GET /enrolments/class?subjectId= — a teacher's own class list. Any staff
   * account linked to a teacher record (teaching is a capability); another
   * class's list answers 404.
   */
  .get('/class', requireStaff(), zValidator('query', ClassListQuery), async (c) => {
    const { subjectId, academicYearId } = c.req.valid('query');
    try {
      return success(c, await enrolment.getClassList(c.get('user')!.id, subjectId, academicYearId));
    } catch (err) {
      const f = fail(err, 'Failed to load the class');
      return error(c, f.message, f.status);
    }
  })

  /**
   * GET /enrolments/student/:studentId?academicYearId= — one student's year:
   * their subjects, teachers and mode, and the flags. The student themself, a
   * linked parent, the desk, the coordinator and admin.
   */
  .get('/student/:studentId', zValidator('param', StudentEnrolmentParam), zValidator('query', StudentEnrolmentQuery), async (c) => {
    const user = c.get('user')!;
    const { studentId } = c.req.valid('param');
    // Another family's child is answered as not found: its existence is not theirs to learn.
    if (user.role === ROLES.STUDENT) {
      if (studentId !== user.id) return error(c, 'Student not found', 404);
    } else if (user.role === ROLES.PARENT) {
      const children = await linkService.getLinkedChildren(user.id);
      if (!children.some((child) => child.studentId === studentId)) return error(c, 'Student not found', 404);
    } else if (!hasRole(user.role, ...STUDENT_RECORD_ROLES)) {
      return error(c, 'Forbidden', 403);
    }
    try {
      return success(c, await enrolment.getStudentEnrolments(studentId, c.req.valid('query').academicYearId));
    } catch (err) {
      const f = fail(err, 'Failed to load the enrolment');
      return error(c, f.message, f.status);
    }
  })

  .post('/', requireAcademic(), zValidator('json', CreateEnrolment), async (c) => {
    try {
      return success(c, await enrolment.createEnrolment(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to enrol the student');
      return error(c, f.message, f.status);
    }
  })

  .put('/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateEnrolment), async (c) => {
    try {
      return success(c, await enrolment.updateEnrolment(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to change the enrolment');
      return error(c, f.message, f.status);
    }
  })

  .post('/:id/end', requireAcademic(), zValidator('param', IdParam), zValidator('json', EndEnrolment), async (c) => {
    try {
      return success(c, await enrolment.endEnrolment(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to end the enrolment');
      return error(c, f.message, f.status);
    }
  })

  /** POST /enrolments/bulk — carried forward or from registrations; preview unless commit. */
  .post('/bulk', requireAcademic(), zValidator('json', BulkEnrol), async (c) => {
    try {
      return success(c, await enrolment.bulkEnrol(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to enrol in bulk');
      return error(c, f.message, f.status);
    }
  })

  /** POST /enrolments/section — every current member of a section, in subjects with one teacher each. */
  .post('/section', requireAcademic(), zValidator('json', EnrolSection), async (c) => {
    try {
      return success(c, await enrolment.enrolSection(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to enrol the section');
      return error(c, f.message, f.status);
    }
  })

  /** POST /enrolments/batch — rows from a sheet (the screen's paste; F7's import uses the same entry point). */
  .post('/batch', requireAcademic(), zValidator('json', BatchEnrol), async (c) => {
    const data = c.req.valid('json');
    try {
      return success(c, await enrolment.batchEnrol(data.academicYearId, data.rows, data.commit, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to enrol the rows');
      return error(c, f.message, f.status);
    }
  });

export type EnrolmentApi = typeof enrolmentRoutes;
