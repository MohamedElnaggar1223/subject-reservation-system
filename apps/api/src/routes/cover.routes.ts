/**
 * Cover (FEATURES_PLAN.md F1), mounted at /v1/cover: absences, the lessons
 * they leave, suggestions, assignments (or cancelling a lesson), the log and
 * the report. The coordinator's and the admin's.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  IdParam, RangeQuery, CreateAbsence, CancelAbsence, CoverSuggestionsQuery, AssignCover, RemoveCover, CoverReportQuery,
} from '@repo/validations';
import { success, error } from '../lib/response';
import { requireAuth, requireAcademic } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as cover from '../services/cover.services';
import { addDays } from '../services/scheduling-shared.services';
import { fail } from './scheduling.routes';
import { todayAtSchool } from '../lib/clock';

export const coverRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .use('*', requireAcademic())

  .get('/absences', zValidator('query', RangeQuery), async (c) => {
    try {
      return success(c, await cover.listAbsences(c.req.valid('query')));
    } catch (err) {
      const f = fail(err, 'Failed to load the absences');
      return error(c, f.message, f.status);
    }
  })
  .post('/absences', zValidator('json', CreateAbsence), async (c) => {
    try {
      return success(c, await cover.recordAbsence(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to record the absence');
      return error(c, f.message, f.status);
    }
  })
  .get('/absences/:id', zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await cover.getAbsence(c.req.valid('param').id));
    } catch (err) {
      const f = fail(err, 'Failed to load the absence');
      return error(c, f.message, f.status);
    }
  })
  .post('/absences/:id/cancel', zValidator('param', IdParam), zValidator('json', CancelAbsence), async (c) => {
    try {
      return success(c, await cover.cancelAbsence(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to withdraw the absence');
      return error(c, f.message, f.status);
    }
  })
  .get('/suggestions', zValidator('query', CoverSuggestionsQuery), async (c) => {
    const { lessonId, date } = c.req.valid('query');
    try {
      return success(c, await cover.suggestCover(lessonId, date));
    } catch (err) {
      const f = fail(err, 'Failed to find cover');
      return error(c, f.message, f.status);
    }
  })
  .post('/assignments', zValidator('json', AssignCover), async (c) => {
    try {
      return success(c, await cover.assignCover(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to arrange the cover');
      return error(c, f.message, f.status);
    }
  })
  .post('/assignments/:id/remove', zValidator('param', IdParam), zValidator('json', RemoveCover), async (c) => {
    try {
      return success(c, await cover.removeCover(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to remove the cover');
      return error(c, f.message, f.status);
    }
  })
  .get('/log', zValidator('query', RangeQuery), async (c) => {
    const q = c.req.valid('query');
    const today = todayAtSchool();
    try {
      return success(c, await cover.coverLog(q.from ?? addDays(today, -30), q.to ?? addDays(today, 30)));
    } catch (err) {
      const f = fail(err, 'Failed to load the cover log');
      return error(c, f.message, f.status);
    }
  })
  .get('/report', zValidator('query', CoverReportQuery), async (c) => {
    const q = c.req.valid('query');
    try {
      return success(c, await cover.coverReport(q.from, q.to));
    } catch (err) {
      const f = fail(err, 'Failed to build the cover report');
      return error(c, f.message, f.status);
    }
  })
  /** GET /report/csv — the same report for a spreadsheet. */
  .get('/report/csv', zValidator('query', CoverReportQuery), async (c) => {
    const q = c.req.valid('query');
    try {
      const report = await cover.coverReport(q.from, q.to);
      return new Response(cover.coverReportCsv(report), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="cover-${q.from}-${q.to}.csv"` },
      });
    } catch (err) {
      const f = fail(err, 'Failed to build the cover report');
      return error(c, f.message, f.status);
    }
  });

export type CoverApi = typeof coverRoutes;
