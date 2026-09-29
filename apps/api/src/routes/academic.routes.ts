/**
 * Academic structure routes (FEATURES_PLAN.md F0a), mounted at /v1/academic.
 *
 * Read (every member of staff): academic years with their terms, the
 * calendar and what a day is, bell schedules, rooms.
 * Read (the desk, the coordinator, admin): sections and their members.
 * Change (the coordinator and admin): everything, audited.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  IdParam, DateOnlySchema,
  CreateAcademicYear, UpdateAcademicYear, CreateTerm, UpdateTerm,
  CreateCalendarEntry, CalendarQuery,
  CreateBellSchedule, UpdateBellSchedule, ReplaceBellPeriods,
  CreateRoom, UpdateRoom,
  CreateSection, UpdateSection, ListSectionsQuery, AddSectionMembers, EndSectionMembership, SectionMemberParam, RollOverSections,
} from '@repo/validations';
import { z } from 'zod';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireStaff, requireAcademic, requireStudentRecords } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as academic from '../services/academic.services';

const fail = (err: unknown, fallback: string) => ({
  message: clientMessage(err, fallback),
  status: err instanceof academic.AcademicError ? err.status : 400,
});

export const academicRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  // ── Academic years and terms ───────────────────────────────────────────
  .get('/years', requireStaff(), async (c) => success(c, await academic.listAcademicYears()))

  .post('/years', requireAcademic(), zValidator('json', CreateAcademicYear), async (c) => {
    try {
      return success(c, await academic.createAcademicYear(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to create the academic year');
      return error(c, f.message, f.status);
    }
  })

  .put('/years/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateAcademicYear), async (c) => {
    try {
      return success(c, await academic.updateAcademicYear(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to update the academic year');
      return error(c, f.message, f.status);
    }
  })

  .post('/terms', requireAcademic(), zValidator('json', CreateTerm), async (c) => {
    try {
      return success(c, await academic.createTerm(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to create the term');
      return error(c, f.message, f.status);
    }
  })

  .put('/terms/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateTerm), async (c) => {
    try {
      return success(c, await academic.updateTerm(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to update the term');
      return error(c, f.message, f.status);
    }
  })

  .delete('/terms/:id', requireAcademic(), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await academic.deleteTerm(c.req.valid('param').id, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to delete the term');
      return error(c, f.message, f.status);
    }
  })

  // ── The calendar ───────────────────────────────────────────────────────
  .get('/calendar', requireStaff(), zValidator('query', CalendarQuery), async (c) =>
    success(c, await academic.listCalendar(c.req.valid('query'))))

  /** GET /academic/calendar/day?date=YYYY-MM-DD — what that day is (default: today, Cairo time). */
  .get('/calendar/day', requireStaff(), zValidator('query', z.object({ date: DateOnlySchema.optional() })), async (c) => {
    const { date } = c.req.valid('query');
    return success(c, date ? await academic.getSchoolDay(date) : await academic.getSchoolToday());
  })

  .post('/calendar', requireAcademic(), zValidator('json', CreateCalendarEntry), async (c) => {
    try {
      return success(c, await academic.createCalendarEntry(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to add the day');
      return error(c, f.message, f.status);
    }
  })

  .delete('/calendar/:id', requireAcademic(), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await academic.deleteCalendarEntry(c.req.valid('param').id, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to remove the day');
      return error(c, f.message, f.status);
    }
  })

  // ── Bell schedules ─────────────────────────────────────────────────────
  .get('/bell-schedules', requireStaff(), zValidator('query', z.object({ academicYearId: z.string().min(1).optional() })), async (c) =>
    success(c, await academic.listBellSchedules(c.req.valid('query').academicYearId)))

  .post('/bell-schedules', requireAcademic(), zValidator('json', CreateBellSchedule), async (c) => {
    try {
      return success(c, await academic.createBellSchedule(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to create the bell schedule');
      return error(c, f.message, f.status);
    }
  })

  .put('/bell-schedules/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateBellSchedule), async (c) => {
    try {
      return success(c, await academic.updateBellSchedule(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to update the bell schedule');
      return error(c, f.message, f.status);
    }
  })

  .put('/bell-schedules/:id/periods', requireAcademic(), zValidator('param', IdParam), zValidator('json', ReplaceBellPeriods), async (c) => {
    try {
      return success(c, await academic.replaceBellPeriods(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to save the periods');
      return error(c, f.message, f.status);
    }
  })

  .delete('/bell-schedules/:id', requireAcademic(), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await academic.deleteBellSchedule(c.req.valid('param').id, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to delete the bell schedule');
      return error(c, f.message, f.status);
    }
  })

  // ── Rooms ──────────────────────────────────────────────────────────────
  .get('/rooms', requireStaff(), async (c) => success(c, await academic.listRooms()))

  .post('/rooms', requireAcademic(), zValidator('json', CreateRoom), async (c) => {
    try {
      return success(c, await academic.createRoom(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to create the room');
      return error(c, f.message, f.status);
    }
  })

  .put('/rooms/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateRoom), async (c) => {
    try {
      return success(c, await academic.updateRoom(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to update the room');
      return error(c, f.message, f.status);
    }
  })

  // ── Sections ───────────────────────────────────────────────────────────
  .get('/sections', requireStudentRecords(), zValidator('query', ListSectionsQuery), async (c) =>
    success(c, await academic.listSections(c.req.valid('query').academicYearId)))

  .post('/sections/roll-over', requireAcademic(), zValidator('json', RollOverSections), async (c) => {
    try {
      return success(c, await academic.rollOverSections(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to roll the sections over');
      return error(c, f.message, f.status);
    }
  })

  .get('/sections/:id', requireStudentRecords(), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await academic.getSection(c.req.valid('param').id));
    } catch (err) {
      const f = fail(err, 'Failed to load the section');
      return error(c, f.message, f.status);
    }
  })

  .post('/sections', requireAcademic(), zValidator('json', CreateSection), async (c) => {
    try {
      return success(c, await academic.createSection(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to create the section');
      return error(c, f.message, f.status);
    }
  })

  .put('/sections/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateSection), async (c) => {
    try {
      return success(c, await academic.updateSection(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to update the section');
      return error(c, f.message, f.status);
    }
  })

  .delete('/sections/:id', requireAcademic(), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await academic.deleteSection(c.req.valid('param').id, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to delete the section');
      return error(c, f.message, f.status);
    }
  })

  .post('/sections/:id/members', requireAcademic(), zValidator('param', IdParam), zValidator('json', AddSectionMembers), async (c) => {
    try {
      return success(c, await academic.addSectionMembers(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to add the students');
      return error(c, f.message, f.status);
    }
  })

  .post('/sections/:id/members/:membershipId/end', requireAcademic(), zValidator('param', SectionMemberParam), zValidator('json', EndSectionMembership), async (c) => {
    const { id, membershipId } = c.req.valid('param');
    try {
      return success(c, await academic.endSectionMembership(id, membershipId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to end the membership');
      return error(c, f.message, f.status);
    }
  });

export type AcademicApi = typeof academicRoutes;
