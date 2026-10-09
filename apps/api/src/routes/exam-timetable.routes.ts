/**
 * F4 — the exam timetable and exam days, mounted at /v1/exams
 * (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §6).
 *
 * The coordinator and the admin keep the timetable, rooms, seats and
 * invigilators. A teacher sees their own invigilation duties and keeps the
 * register of the room they invigilate (the handler checks). A family reads
 * its own child's statement of entry, timetable, results and sittings; the
 * staff who keep student records read any student's.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

import {
  IdParam, BoardSeriesQuery, CreatePaper, UpdatePaper, ImportPapers, NoteClash, PublishTimetable, CandidateStudentParam, StudentSeriesQuery,
  StudentExamsQuery, SittingKey, SittingsQuery, SetSittingRooms, AutoSeat, AssignSeat, SetInvigilators, RegisterQuery, MarkRegister,
  CreateSpecialConsideration, UpdateSpecialConsideration,
} from '@repo/validations';
import { success, error } from '../lib/response';
import { requireAuth, requireAcademic, requireStaff } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import { assertMayReadStudent, isFamily } from '../services/exam-shared';
import * as timetable from '../services/exam-timetable.services';
import * as days from '../services/exam-day.services';
import * as results from '../services/exam-result.services';
import { fail } from './exam-entry.routes';

export const examTimetableRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  // ─── Papers ─────────────────────────────────────────────────────────────────

  .get('/papers', requireAcademic(), zValidator('query', BoardSeriesQuery), async (c) => {
    try {
      return success(c, await timetable.listPapers(c.req.valid('query').boardSeriesId));
    } catch (err) {
      const f = fail(err, 'Failed to load the timetable');
      return error(c, f.message, f.status);
    }
  })

  /** POST /exams/papers/import — a board's timetable pasted as a table; preview unless commit. */
  .post('/papers/import', requireAcademic(), zValidator('json', ImportPapers), async (c) => {
    try {
      return success(c, await timetable.importPapers(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to read the timetable');
      return error(c, f.message, f.status);
    }
  })

  .post('/papers', requireAcademic(), zValidator('json', CreatePaper), async (c) => {
    try {
      return success(c, await timetable.createPaper(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to add the paper');
      return error(c, f.message, f.status);
    }
  })

  .put('/papers/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdatePaper), async (c) => {
    try {
      return success(c, await timetable.updatePaper(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to change the paper');
      return error(c, f.message, f.status);
    }
  })

  .delete('/papers/:id', requireAcademic(), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await timetable.deletePaper(c.req.valid('param').id, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to remove the paper');
      return error(c, f.message, f.status);
    }
  })

  /** GET /exams/clashes?boardSeriesId= — candidates with two papers at once (extra time counted). */
  .get('/clashes', requireAcademic(), zValidator('query', BoardSeriesQuery), async (c) => {
    try {
      return success(c, await timetable.listClashes(c.req.valid('query').boardSeriesId));
    } catch (err) {
      const f = fail(err, 'Failed to find the clashes');
      return error(c, f.message, f.status);
    }
  })

  .put('/clashes', requireAcademic(), zValidator('json', NoteClash), async (c) => {
    try {
      return success(c, await timetable.noteClash(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to note the clash');
      return error(c, f.message, f.status);
    }
  })

  /** POST /exams/timetable/publish — families see their statement and timetable, and are told. */
  .post('/timetable/publish', requireAcademic(), zValidator('json', PublishTimetable), async (c) => {
    try {
      return success(c, await timetable.publishTimetable(c.req.valid('json').boardSeriesId, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to publish the timetable');
      return error(c, f.message, f.status);
    }
  })

  // ─── One student's exams (the family, and staff with student records) ───────

  .get('/students/:studentId/series', zValidator('param', CandidateStudentParam), async (c) => {
    const user = c.get('user')!;
    const { studentId } = c.req.valid('param');
    try {
      await assertMayReadStudent(user, studentId);
      return success(c, await timetable.seriesOfStudent(studentId, isFamily(user.role)));
    } catch (err) {
      const f = fail(err, 'Failed to load the series');
      return error(c, f.message, f.status);
    }
  })

  .get('/students/:studentId/timetable', zValidator('param', CandidateStudentParam), zValidator('query', StudentSeriesQuery), async (c) => {
    const user = c.get('user')!;
    const { studentId } = c.req.valid('param');
    try {
      await assertMayReadStudent(user, studentId);
      return success(c, await timetable.candidateTimetable(studentId, c.req.valid('query').boardSeriesId, isFamily(user.role)));
    } catch (err) {
      const f = fail(err, 'Failed to load the exam timetable');
      return error(c, f.message, f.status);
    }
  })

  .get('/students/:studentId/statement', zValidator('param', CandidateStudentParam), zValidator('query', BoardSeriesQuery), async (c) => {
    const user = c.get('user')!;
    const { studentId } = c.req.valid('param');
    try {
      await assertMayReadStudent(user, studentId);
      return success(c, await timetable.getStatement(studentId, c.req.valid('query').boardSeriesId, isFamily(user.role)));
    } catch (err) {
      const f = fail(err, 'Failed to load the statement of entry');
      return error(c, f.message, f.status);
    }
  })

  /** GET /exams/students/:studentId/exams?date= — the papers a student sits that day (F2 and F3's contract, as an endpoint). */
  .get('/students/:studentId/exams', zValidator('param', CandidateStudentParam), zValidator('query', StudentExamsQuery), async (c) => {
    const user = c.get('user')!;
    const { studentId } = c.req.valid('param');
    try {
      await assertMayReadStudent(user, studentId);
      return success(c, await timetable.getExamsFor(studentId, c.req.valid('query').date, isFamily(user.role)));
    } catch (err) {
      const f = fail(err, 'Failed to load the day\'s exams');
      return error(c, f.message, f.status);
    }
  })

  .get('/students/:studentId/results', zValidator('param', CandidateStudentParam), async (c) => {
    const user = c.get('user')!;
    const { studentId } = c.req.valid('param');
    try {
      await assertMayReadStudent(user, studentId);
      return success(c, await results.listResults({ studentId }, isFamily(user.role)));
    } catch (err) {
      const f = fail(err, 'Failed to load the results');
      return error(c, f.message, f.status);
    }
  })

  /** GET /exams/students/:studentId/sittings — F5's contract, as an endpoint. */
  .get('/students/:studentId/sittings', zValidator('param', CandidateStudentParam), async (c) => {
    const user = c.get('user')!;
    const { studentId } = c.req.valid('param');
    try {
      await assertMayReadStudent(user, studentId);
      return success(c, await results.getSittings(studentId, isFamily(user.role)));
    } catch (err) {
      const f = fail(err, 'Failed to load the sittings');
      return error(c, f.message, f.status);
    }
  })

  // ─── Exam days ──────────────────────────────────────────────────────────────

  .get('/sittings', requireAcademic(), zValidator('query', SittingsQuery), async (c) => {
    try {
      return success(c, await days.listSittings(c.req.valid('query')));
    } catch (err) {
      const f = fail(err, 'Failed to load the sittings');
      return error(c, f.message, f.status);
    }
  })

  .get('/sittings/plan', requireAcademic(), zValidator('query', SittingKey), async (c) => {
    try {
      return success(c, await days.getSittingPlan(c.req.valid('query')));
    } catch (err) {
      const f = fail(err, 'Failed to load the seating plan');
      return error(c, f.message, f.status);
    }
  })

  .put('/sittings/rooms', requireAcademic(), zValidator('json', SetSittingRooms), async (c) => {
    try {
      return success(c, await days.setSittingRooms(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to set the rooms');
      return error(c, f.message, f.status);
    }
  })

  /** POST /exams/sittings/seat — seat everyone of a sitting without a seat; preview unless commit. */
  .post('/sittings/seat', requireAcademic(), zValidator('json', AutoSeat), async (c) => {
    const { commit, ...key } = c.req.valid('json');
    try {
      return success(c, await days.autoSeat(key, commit, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to seat the candidates');
      return error(c, f.message, f.status);
    }
  })

  .put('/seats', requireAcademic(), zValidator('json', AssignSeat), async (c) => {
    try {
      return success(c, await days.assignSeat(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to seat the candidate');
      return error(c, f.message, f.status);
    }
  })

  .put('/invigilation', requireAcademic(), zValidator('json', SetInvigilators), async (c) => {
    try {
      return success(c, await days.setInvigilators(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to set the invigilators');
      return error(c, f.message, f.status);
    }
  })

  /** GET /exams/invigilation/mine — the signed-in teacher's own duties. */
  .get('/invigilation/mine', requireStaff(), async (c) => {
    try {
      return success(c, await days.myInvigilation(c.get('user')!));
    } catch (err) {
      const f = fail(err, 'Failed to load your duties');
      return error(c, f.message, f.status);
    }
  })

  /** GET /exams/registers?paperId=&roomId= — the board's attendance register; a teacher only for the room they invigilate. */
  .get('/registers', requireStaff(), zValidator('query', RegisterQuery), async (c) => {
    const { paperId, roomId } = c.req.valid('query');
    try {
      return success(c, await days.getRegister(paperId, c.get('user')!, roomId));
    } catch (err) {
      const f = fail(err, 'Failed to load the register');
      return error(c, f.message, f.status);
    }
  })

  .put('/registers', requireStaff(), zValidator('json', MarkRegister), async (c) => {
    try {
      return success(c, await days.markRegister(c.req.valid('json'), c.get('user')!, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to mark the register');
      return error(c, f.message, f.status);
    }
  })

  .get('/special-consideration', requireAcademic(), zValidator('query', BoardSeriesQuery), async (c) => {
    try {
      return success(c, await days.listSpecialConsiderations(c.req.valid('query').boardSeriesId));
    } catch (err) {
      const f = fail(err, 'Failed to load special consideration');
      return error(c, f.message, f.status);
    }
  })

  .post('/special-consideration', requireAcademic(), zValidator('json', CreateSpecialConsideration), async (c) => {
    try {
      return success(c, await days.createSpecialConsideration(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to open special consideration');
      return error(c, f.message, f.status);
    }
  })

  .put('/special-consideration/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateSpecialConsideration), async (c) => {
    try {
      return success(c, await days.updateSpecialConsideration(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to update special consideration');
      return error(c, f.message, f.status);
    }
  });

export type ExamTimetableApi = typeof examTimetableRoutes;
