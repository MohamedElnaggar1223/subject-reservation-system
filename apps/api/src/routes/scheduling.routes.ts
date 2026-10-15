/**
 * Teaching groups and the year's timetable rules (FEATURES_PLAN.md F1),
 * mounted at /v1/scheduling. The coordinator's and the admin's; every change
 * is audited.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  IdParam, YearQuery, FormGroups, CreateSectionGroups, CreateGroup, UpdateGroup, AddGroupMembers, EndGroupMembers, SplitGroup, MergeGroups,
  ArchiveGroup, PutTeacherConstraints, PutRoomConstraints, CreateDayRule, AssignGroupTeacher,
} from '@repo/validations';
import { z } from 'zod';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireAcademic } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as groups from '../services/group.services';
import * as rules from '../services/schedule-rules.services';
import { SchedulingError } from '../services/scheduling-shared.services';

export const fail = (err: unknown, fallback: string) => ({
  message: clientMessage(err, fallback),
  status: err instanceof SchedulingError ? err.status : 400,
});

export const schedulingRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .use('*', requireAcademic())

  // ── Teaching groups ──
  .get('/groups', zValidator('query', YearQuery), async (c) => {
    try {
      return success(c, await groups.listGroups(c.req.valid('query').academicYearId));
    } catch (err) {
      const f = fail(err, 'Failed to load the teaching groups');
      return error(c, f.message, f.status);
    }
  })
  /**
   * GET /groups/waiting — who is not in the group their enrolment says (with the group a Move would
   * take them to), groups whose every member is enrolled with another teacher, and the students with
   * no teacher yet per subject or unit with the teachers their lines may take (RESERVATIONS_REWORK.md §10).
   */
  .get('/groups/waiting', zValidator('query', YearQuery), async (c) => {
    try {
      return success(c, await groups.groupsWaiting(c.req.valid('query').academicYearId));
    } catch (err) {
      const f = fail(err, 'Failed to load who waits for a group');
      return error(c, f.message, f.status);
    }
  })
  /** POST /groups/assign-teacher — "no preference" assigned: the students' lines take the teacher, their enrolments and groups follow. */
  .post('/groups/assign-teacher', zValidator('json', AssignGroupTeacher), async (c) => {
    try {
      return success(c, await groups.assignGroupTeacher(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to assign the teacher');
      return error(c, f.message, f.status);
    }
  })
  .get('/groups/:id', zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await groups.getGroup(c.req.valid('param').id));
    } catch (err) {
      const f = fail(err, 'Failed to load the group');
      return error(c, f.message, f.status);
    }
  })
  /** POST /groups/form — the year's groups from its course enrolment: preview (commit false), then commit. */
  .post('/groups/form', zValidator('json', FormGroups), async (c) => {
    try {
      return success(c, await groups.formGroups(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to form the groups');
      return error(c, f.message, f.status);
    }
  })
  .post('/groups/sections', zValidator('json', CreateSectionGroups), async (c) => {
    try {
      return success(c, await groups.createSectionGroups(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to create the section groups');
      return error(c, f.message, f.status);
    }
  })
  .post('/groups/merge', zValidator('json', MergeGroups), async (c) => {
    try {
      return success(c, await groups.mergeGroups(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to merge the groups');
      return error(c, f.message, f.status);
    }
  })
  .post('/groups', zValidator('json', CreateGroup), async (c) => {
    try {
      return success(c, await groups.createGroup(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to create the group');
      return error(c, f.message, f.status);
    }
  })
  .put('/groups/:id', zValidator('param', IdParam), zValidator('json', UpdateGroup), async (c) => {
    try {
      return success(c, await groups.updateGroup(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to change the group');
      return error(c, f.message, f.status);
    }
  })
  .post('/groups/:id/members', zValidator('param', IdParam), zValidator('json', AddGroupMembers), async (c) => {
    try {
      return success(c, await groups.addGroupMembers(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to add the students');
      return error(c, f.message, f.status);
    }
  })
  .post('/groups/:id/members/end', zValidator('param', IdParam), zValidator('json', EndGroupMembers), async (c) => {
    try {
      return success(c, await groups.endGroupMembers(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to take the students out');
      return error(c, f.message, f.status);
    }
  })
  .post('/groups/:id/split', zValidator('param', IdParam), zValidator('json', SplitGroup), async (c) => {
    try {
      return success(c, await groups.splitGroup(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to split the group');
      return error(c, f.message, f.status);
    }
  })
  .post('/groups/:id/archive', zValidator('param', IdParam), zValidator('json', ArchiveGroup), async (c) => {
    try {
      return success(c, await groups.archiveGroup(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to retire the group');
      return error(c, f.message, f.status);
    }
  })

  // ── The year's rules ──
  .get('/rules', zValidator('query', YearQuery), async (c) => {
    try {
      return success(c, await rules.getRules(c.req.valid('query').academicYearId));
    } catch (err) {
      const f = fail(err, 'Failed to load the rules');
      return error(c, f.message, f.status);
    }
  })
  .put('/rules/teachers/:teacherId', zValidator('param', z.object({ teacherId: z.string().min(1) })), zValidator('json', PutTeacherConstraints), async (c) => {
    try {
      return success(c, await rules.putTeacherRules(c.req.valid('param').teacherId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, "Failed to save the teacher's rules");
      return error(c, f.message, f.status);
    }
  })
  .put('/rules/rooms/:roomId', zValidator('param', z.object({ roomId: z.string().min(1) })), zValidator('json', PutRoomConstraints), async (c) => {
    try {
      return success(c, await rules.putRoomRules(c.req.valid('param').roomId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, "Failed to save the room's rules");
      return error(c, f.message, f.status);
    }
  })
  .post('/rules/day-rules', zValidator('json', CreateDayRule), async (c) => {
    try {
      return success(c, await rules.createDayRule(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to add the rule');
      return error(c, f.message, f.status);
    }
  })
  .delete('/rules/day-rules/:id', zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await rules.deleteDayRule(c.req.valid('param').id, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to remove the rule');
      return error(c, f.message, f.status);
    }
  });

export type SchedulingApi = typeof schedulingRoutes;
