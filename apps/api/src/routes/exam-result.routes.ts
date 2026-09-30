/**
 * F4 — results, certificates and the deadlines dashboard, mounted at
 * /v1/exams (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §6).
 *
 * The coordinator and the admin import and publish results, receive
 * certificates and read the deadlines. The desk (and the coordinator and
 * admin) hands certificates over and prints the collection slip.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  IdParam, ImportResults, ResultsQuery, PublishResults, ListCertificatesQuery, ReceiveCertificates, CollectCertificate, DisposeCertificate,
  DeadlinesQuery, BoardCodeSchema, AttachCertificateSlip,
} from '@repo/validations';
import { z } from 'zod';
import { success, error } from '../lib/response';
import { requireAuth, requireAcademic, requireStudentRecords } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as results from '../services/exam-result.services';
import * as certificates from '../services/exam-certificate.services';
import * as deadlines from '../services/exam-deadline.services';
import { fail } from './exam-entry.routes';

export const examResultRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  // ─── Results ────────────────────────────────────────────────────────────────

  /** POST /exams/results/import — a board's results file through a mapping; preview unless commit. */
  .post('/results/import', requireAcademic(), zValidator('json', ImportResults), async (c) => {
    try {
      return success(c, await results.importResults(c.req.valid('json'), c.get('user')!, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to read the results');
      return error(c, f.message, f.status);
    }
  })

  .get('/results/mappings', requireAcademic(), zValidator('query', z.object({ boardCode: BoardCodeSchema.optional() })), async (c) =>
    success(c, await results.listMappings(c.req.valid('query').boardCode)))

  .post('/results/publish', requireAcademic(), zValidator('json', PublishResults), async (c) => {
    try {
      return success(c, await results.publishResults(c.req.valid('json').boardSeriesId, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to publish the results');
      return error(c, f.message, f.status);
    }
  })

  .get('/results', requireAcademic(), zValidator('query', ResultsQuery), async (c) => {
    try {
      return success(c, await results.listResults(c.req.valid('query')));
    } catch (err) {
      const f = fail(err, 'Failed to load the results');
      return error(c, f.message, f.status);
    }
  })

  // ─── Certificates ───────────────────────────────────────────────────────────

  .get('/certificates', requireStudentRecords(), zValidator('query', ListCertificatesQuery), async (c) => {
    try {
      return success(c, await certificates.listCertificates(c.req.valid('query')));
    } catch (err) {
      const f = fail(err, 'Failed to load the certificates');
      return error(c, f.message, f.status);
    }
  })

  .post('/certificates/receive', requireAcademic(), zValidator('json', ReceiveCertificates), async (c) => {
    try {
      return success(c, await certificates.receiveCertificates(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to record the certificates');
      return error(c, f.message, f.status);
    }
  })

  /** POST /exams/certificates/:id/collect — handed over once; a second hand-over is told who took it. */
  .post('/certificates/:id/collect', requireStudentRecords(), zValidator('param', IdParam), zValidator('json', CollectCertificate), async (c) => {
    try {
      return success(c, await certificates.collectCertificate(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to record the collection');
      return error(c, f.message, f.status);
    }
  })

  /** POST /exams/certificates/:id/slip — the scan of the signed slip, after the hand-over; never replaced. */
  .post('/certificates/:id/slip', requireStudentRecords(), zValidator('param', IdParam), zValidator('json', AttachCertificateSlip), async (c) => {
    try {
      return success(c, await certificates.attachCertificateSlip(c.req.valid('param').id, c.req.valid('json').signatureFileId, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to attach the slip');
      return error(c, f.message, f.status);
    }
  })

  .post('/certificates/:id/dispose', requireAcademic(), zValidator('param', IdParam), zValidator('json', DisposeCertificate), async (c) => {
    try {
      return success(c, await certificates.disposeCertificate(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to record it');
      return error(c, f.message, f.status);
    }
  })

  .get('/certificates/:id/slip', requireStudentRecords(), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await certificates.certificateSlip(c.req.valid('param').id));
    } catch (err) {
      const f = fail(err, 'Failed to load the slip');
      return error(c, f.message, f.status);
    }
  })

  // ─── Deadlines ──────────────────────────────────────────────────────────────

  .get('/deadlines', requireAcademic(), zValidator('query', DeadlinesQuery), async (c) =>
    success(c, await deadlines.getDeadlines(c.req.valid('query').pastDays ?? 30)));

export type ExamResultApi = typeof examResultRoutes;
