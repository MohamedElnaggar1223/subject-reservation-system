/**
 * The timetable as people read it (FEATURES_PLAN.md F1, "Views and output"),
 * mounted at /v1/schedule:
 * - GET /day, /week — a student's (the student, a linked parent, the desk,
 *   the coordinator, admin), a teacher's (that teacher, the coordinator,
 *   admin), a room's or a section's (the coordinator, admin). Anyone else is
 *   told it does not exist.
 * - GET /me/day, /me/week — the signed-in account's own (a student's, or the
 *   teaching of an account linked to a teacher record, whatever its role).
 * - GET /lesson — a lesson's students on a date: its teacher, the cover
 *   teacher on that date only, the coordinator and admin.
 * - GET/POST/DELETE /feed — the account's calendar feed link.
 * The feed itself is /v1/ical/:token (anonymous; the token is the key).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ScheduleDayQuery, ScheduleWeekQuery, MyScheduleQuery, LessonOnDateQuery, FeedTokenParam, schoolDateString } from '@repo/validations';
import { success, error } from '../lib/response';
import { requireAuth, requireStaff } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as schedule from '../services/schedule.services';
import { fail } from './scheduling.routes';

const today = () => schoolDateString(new Date());

export const scheduleRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/day', zValidator('query', ScheduleDayQuery), async (c) => {
    const q = c.req.valid('query');
    const target = q.studentId ? { studentId: q.studentId } : { teacherId: q.teacherId! };
    try {
      await schedule.assertMayRead(c.get('user')!, target);
      return success(c, await schedule.getScheduleFor(target, q.date ?? today()));
    } catch (err) {
      const f = fail(err, 'Failed to load the timetable');
      return error(c, f.message, f.status);
    }
  })
  .get('/week', zValidator('query', ScheduleWeekQuery), async (c) => {
    const q = c.req.valid('query');
    const target = q.studentId ? { studentId: q.studentId } : q.teacherId ? { teacherId: q.teacherId } : q.roomId ? { roomId: q.roomId } : { sectionId: q.sectionId! };
    try {
      await schedule.assertMayRead(c.get('user')!, target);
      return success(c, await schedule.getWeek(target, q.date ?? today()));
    } catch (err) {
      const f = fail(err, 'Failed to load the timetable');
      return error(c, f.message, f.status);
    }
  })
  .get('/me/day', zValidator('query', MyScheduleQuery), async (c) => {
    try {
      const target = await schedule.ownTarget(c.get('user')!);
      return success(c, { target, ...(await schedule.getScheduleFor(target, c.req.valid('query').date ?? today())) });
    } catch (err) {
      const f = fail(err, 'Failed to load your timetable');
      return error(c, f.message, f.status);
    }
  })
  .get('/me/week', zValidator('query', MyScheduleQuery), async (c) => {
    try {
      const target = await schedule.ownTarget(c.get('user')!);
      return success(c, await schedule.getWeek(target, c.req.valid('query').date ?? today()));
    } catch (err) {
      const f = fail(err, 'Failed to load your timetable');
      return error(c, f.message, f.status);
    }
  })
  .get('/lesson', requireStaff(), zValidator('query', LessonOnDateQuery), async (c) => {
    const { lessonId, date } = c.req.valid('query');
    try {
      return success(c, await schedule.classListFor(c.get('user')!, lessonId, date));
    } catch (err) {
      const f = fail(err, 'Failed to load the class');
      return error(c, f.message, f.status);
    }
  })
  .get('/feed', async (c) => {
    try {
      return success(c, await schedule.feedStatus(c.get('user')!.id));
    } catch (err) {
      const f = fail(err, 'Failed to load the calendar feed');
      return error(c, f.message, f.status);
    }
  })
  /** POST /feed — a new link (the old one stops working); shown once. */
  .post('/feed', async (c) => {
    try {
      return success(c, await schedule.createFeedToken(c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to make the calendar link');
      return error(c, f.message, f.status);
    }
  })
  .delete('/feed', async (c) => {
    try {
      return success(c, await schedule.revokeFeedToken(c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to revoke the calendar link');
      return error(c, f.message, f.status);
    }
  });

/**
 * GET /v1/ical/:token — the calendar feed. No session: the token is the key.
 * A token that is unknown or revoked gets a bare 404 and nothing else.
 */
export const icalRoutes = new Hono<HonoEnv>()
  .get('/:token', zValidator('param', FeedTokenParam), async (c) => {
    try {
      const body = await schedule.calendarFeed(c.req.valid('param').token);
      if (body === null) return error(c, 'Not found', 404);
      return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' } });
    } catch (err) {
      const f = fail(err, 'Failed to build the calendar');
      return error(c, f.message, f.status);
    }
  });

export type ScheduleApi = typeof scheduleRoutes;
