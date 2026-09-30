/**
 * Timetables (FEATURES_PLAN.md F1), mounted at /v1/timetables: versions per
 * term, the grid editor, the generator, publishing and exports (aSc XML, FET,
 * CSV). The coordinator's and the admin's.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  IdParam, TimetablesQuery, CreateTimetable, UpdateTimetable, LessonParam, MoveLesson, UnplaceLesson, LockLesson, GenerateTimetable,
  PublishTimetable, ExportCsvQuery,
} from '@repo/validations';
import { success, error } from '../lib/response';
import { requireAuth, requireAcademic } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as timetables from '../services/timetable.services';
import { fail } from './scheduling.routes';

const download = (body: string, filename: string, type: string) =>
  new Response(body, { headers: { 'Content-Type': `${type}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${filename}"` } });

export const timetableRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .use('*', requireAcademic())

  .get('/', zValidator('query', TimetablesQuery), async (c) => {
    try {
      return success(c, await timetables.listTimetables(c.req.valid('query')));
    } catch (err) {
      const f = fail(err, 'Failed to load the timetables');
      return error(c, f.message, f.status);
    }
  })
  /** POST / — a new draft for a term: blank, or a copy of another version of the year. */
  .post('/', zValidator('json', CreateTimetable), async (c) => {
    try {
      return success(c, await timetables.createTimetable(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to create the timetable');
      return error(c, f.message, f.status);
    }
  })
  /** GET /:id — the editor's picture: the week, groups, lessons, clashes, measures and the generator's runs. */
  .get('/:id', zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await timetables.getTimetable(c.req.valid('param').id));
    } catch (err) {
      const f = fail(err, 'Failed to load the timetable');
      return error(c, f.message, f.status);
    }
  })
  .put('/:id', zValidator('param', IdParam), zValidator('json', UpdateTimetable), async (c) => {
    try {
      return success(c, await timetables.updateTimetable(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to change the timetable');
      return error(c, f.message, f.status);
    }
  })
  .delete('/:id', zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await timetables.deleteTimetable(c.req.valid('param').id, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to delete the draft');
      return error(c, f.message, f.status);
    }
  })
  .post('/:id/lessons/:lessonId/move', zValidator('param', LessonParam), zValidator('json', MoveLesson), async (c) => {
    const { id, lessonId } = c.req.valid('param');
    try {
      return success(c, await timetables.moveLesson(id, lessonId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to move the lesson');
      return error(c, f.message, f.status);
    }
  })
  .post('/:id/lessons/:lessonId/unplace', zValidator('param', LessonParam), zValidator('json', UnplaceLesson), async (c) => {
    const { id, lessonId } = c.req.valid('param');
    try {
      return success(c, await timetables.unplaceLesson(id, lessonId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to take the lesson off the grid');
      return error(c, f.message, f.status);
    }
  })
  .post('/:id/lessons/:lessonId/lock', zValidator('param', LessonParam), zValidator('json', LockLesson), async (c) => {
    const { id, lessonId } = c.req.valid('param');
    try {
      return success(c, await timetables.lockLesson(id, lessonId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to lock the lesson');
      return error(c, f.message, f.status);
    }
  })
  /** POST /:id/generate — place every unlocked lesson (locked ones stay); the explanations for what could not be placed. */
  .post('/:id/generate', zValidator('param', IdParam), zValidator('json', GenerateTimetable), async (c) => {
    try {
      return success(c, await timetables.generateTimetable(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to generate the timetable');
      return error(c, f.message, f.status);
    }
  })
  /** POST /:id/publish — takes effect on a date (today or later, inside the term); clashes refused; the people concerned told. */
  .post('/:id/publish', zValidator('param', IdParam), zValidator('json', PublishTimetable), async (c) => {
    try {
      return success(c, await timetables.publishTimetable(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to publish the timetable');
      return error(c, f.message, f.status);
    }
  })
  .get('/:id/export/fet', zValidator('param', IdParam), async (c) => {
    try {
      const f = await timetables.exportFet(c.req.valid('param').id);
      return download(f.body, f.filename, 'application/xml');
    } catch (err) {
      const f = fail(err, 'Failed to export the timetable');
      return error(c, f.message, f.status);
    }
  })
  .get('/:id/export/asc', zValidator('param', IdParam), async (c) => {
    try {
      const f = await timetables.exportAsc(c.req.valid('param').id);
      return download(f.body, f.filename, 'application/xml');
    } catch (err) {
      const f = fail(err, 'Failed to export the timetable');
      return error(c, f.message, f.status);
    }
  })
  .get('/:id/export/csv', zValidator('param', IdParam), zValidator('query', ExportCsvQuery), async (c) => {
    try {
      const f = await timetables.exportCsv(c.req.valid('param').id, c.req.valid('query'));
      return download(f.body, f.filename, 'text/csv');
    } catch (err) {
      const f = fail(err, 'Failed to export the timetable');
      return error(c, f.message, f.status);
    }
  });

export type TimetableApi = typeof timetableRoutes;
