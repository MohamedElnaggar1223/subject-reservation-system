/**
 * F4 — candidates, entries, forecasts, board rules and entry lists, mounted
 * at /v1/exams (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §6).
 *
 * The coordinator and the admin run exam entries. A teacher gives the
 * forecast grades of the candidates they teach (the handler checks F0b's
 * teacherOf). The national ID is read only by the coordinator and the admin,
 * one candidate at a time, each read audited.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  IdParam, CandidateStudentParam, ListCandidatesQuery, UpdateCandidate, SetCandidateIdentity, AssignCandidateNumbers, SetCandidateNumber,
  UpdateBoardRule, ListEntriesQuery, DeriveEntries, CreateEntry, UpdateEntry, SubmitEntries, WithdrawEntry, SetForecast, ForecastsQuery,
  SubmitForecasts, BoardSeriesQuery, BoardCodeSchema,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireAcademic, requireStaff } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import { ExamError } from '../services/exam-shared';
import * as candidates from '../services/exam-candidate.services';
import * as entries from '../services/exam-entry.services';

export const fail = (err: unknown, fallback: string) => ({
  message: clientMessage(err, fallback),
  status: err instanceof ExamError ? err.status : 400,
});

export const examEntryRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  // ─── Candidates ─────────────────────────────────────────────────────────────

  /** GET /exams/candidates?search=&boardSeriesId=&missing= — never the national ID, only whether one is recorded. */
  .get('/candidates', requireAcademic(), zValidator('query', ListCandidatesQuery), async (c) => {
    try {
      return success(c, await candidates.listCandidates(c.req.valid('query')));
    } catch (err) {
      const f = fail(err, 'Failed to load the candidates');
      return error(c, f.message, f.status);
    }
  })

  .get('/candidates/:studentId', requireAcademic(), zValidator('param', CandidateStudentParam), async (c) => {
    try {
      return success(c, await candidates.getCandidate(c.req.valid('param').studentId));
    } catch (err) {
      const f = fail(err, 'Failed to load the candidate');
      return error(c, f.message, f.status);
    }
  })

  .put('/candidates/:studentId', requireAcademic(), zValidator('param', CandidateStudentParam), zValidator('json', UpdateCandidate), async (c) => {
    try {
      return success(c, await candidates.updateCandidate(c.req.valid('param').studentId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to save the candidate');
      return error(c, f.message, f.status);
    }
  })

  /** GET /exams/candidates/:studentId/identity — the national ID or passport; each read is audited. */
  .get('/candidates/:studentId/identity', requireAcademic(), zValidator('param', CandidateStudentParam), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await candidates.getIdentity(c.req.valid('param').studentId, user, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to load the ID document');
      return error(c, f.message, f.status);
    }
  })

  .put('/candidates/:studentId/identity', requireAcademic(), zValidator('param', CandidateStudentParam), zValidator('json', SetCandidateIdentity), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await candidates.setIdentity(c.req.valid('param').studentId, c.req.valid('json'), user.id, user.role, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'The ID document could not be saved');
      return error(c, f.message, f.status);
    }
  })

  /** POST /exams/candidate-numbers/assign — every candidate of a series without a number gets one (preview unless commit). */
  .post('/candidate-numbers/assign', requireAcademic(), zValidator('json', AssignCandidateNumbers), async (c) => {
    const { boardSeriesId, commit } = c.req.valid('json');
    try {
      return success(c, await candidates.assignCandidateNumbers(boardSeriesId, commit, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to assign candidate numbers');
      return error(c, f.message, f.status);
    }
  })

  .put('/candidate-numbers', requireAcademic(), zValidator('json', SetCandidateNumber), async (c) => {
    try {
      return success(c, await candidates.setCandidateNumber(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to set the candidate number');
      return error(c, f.message, f.status);
    }
  })

  // ─── Board rules ────────────────────────────────────────────────────────────

  .get('/board-rules', requireAcademic(), async (c) => success(c, await entries.listBoardRules()))

  .put('/board-rules/:boardCode', requireAcademic(), zValidator('param', z.object({ boardCode: BoardCodeSchema })), zValidator('json', UpdateBoardRule), async (c) => {
    try {
      return success(c, await entries.updateBoardRule(c.req.valid('param').boardCode, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to save the board\'s rules');
      return error(c, f.message, f.status);
    }
  })

  // ─── Entries ────────────────────────────────────────────────────────────────

  .get('/entries', requireAcademic(), zValidator('query', ListEntriesQuery), async (c) => {
    try {
      return success(c, await entries.listEntries(c.req.valid('query')));
    } catch (err) {
      const f = fail(err, 'Failed to load the entries');
      return error(c, f.message, f.status);
    }
  })

  /** POST /exams/entries/derive — the entries of a series (or a student) from confirmed registrations; preview unless commit. */
  .post('/entries/derive', requireAcademic(), zValidator('json', DeriveEntries), async (c) => {
    try {
      return success(c, await entries.deriveEntries(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to derive the entries');
      return error(c, f.message, f.status);
    }
  })

  .post('/entries/submit', requireAcademic(), zValidator('json', SubmitEntries), async (c) => {
    try {
      return success(c, await entries.submitEntries(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to record the entries as sent');
      return error(c, f.message, f.status);
    }
  })

  .post('/entries', requireAcademic(), zValidator('json', CreateEntry), async (c) => {
    try {
      return success(c, await entries.createEntry(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to add the entry');
      return error(c, f.message, f.status);
    }
  })

  .put('/entries/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateEntry), async (c) => {
    try {
      return success(c, await entries.updateEntry(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to change the entry');
      return error(c, f.message, f.status);
    }
  })

  /** POST /exams/entries/:id/withdraw — allowed before and after the deadline; says what the board does with its fee. */
  .post('/entries/:id/withdraw', requireAcademic(), zValidator('param', IdParam), zValidator('json', WithdrawEntry), async (c) => {
    try {
      return success(c, await entries.withdrawEntry(c.req.valid('param').id, c.req.valid('json').reason, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to withdraw the entry');
      return error(c, f.message, f.status);
    }
  })

  /** PUT /exams/entries/:id/forecast — the candidate's teacher for the subject (F0b's teacherOf), or the coordinator. */
  .put('/entries/:id/forecast', requireStaff(), zValidator('param', IdParam), zValidator('json', SetForecast), async (c) => {
    try {
      return success(c, await entries.setForecast(c.req.valid('param').id, c.req.valid('json').grade, c.get('user')!, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to save the forecast grade');
      return error(c, f.message, f.status);
    }
  })

  /** GET /exams/forecasts?boardSeriesId= — a teacher's own candidates; every entry for the coordinator. */
  .get('/forecasts', requireStaff(), zValidator('query', ForecastsQuery), async (c) => {
    try {
      return success(c, await entries.listForecasts(c.get('user')!, c.req.valid('query').boardSeriesId));
    } catch (err) {
      const f = fail(err, 'Failed to load the forecast grades');
      return error(c, f.message, f.status);
    }
  })

  .post('/forecasts/submit', requireAcademic(), zValidator('json', SubmitForecasts), async (c) => {
    try {
      return success(c, await entries.submitForecasts(c.req.valid('json').boardSeriesId, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to record the forecasts as sent');
      return error(c, f.message, f.status);
    }
  })

  /** GET /exams/entry-lists?boardSeriesId= — the board portal's fields per entry, and what each is missing. */
  .get('/entry-lists', requireAcademic(), zValidator('query', BoardSeriesQuery), async (c) => {
    try {
      return success(c, await entries.getEntryList(c.req.valid('query').boardSeriesId));
    } catch (err) {
      const f = fail(err, 'Failed to build the entry list');
      return error(c, f.message, f.status);
    }
  });

export type ExamEntryApi = typeof examEntryRoutes;
