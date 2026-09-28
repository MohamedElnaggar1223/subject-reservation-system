/**
 * Remark + Results API Routes (V3 §6.10, §5.4)
 *
 * GET  /remarks                   - Role-aware list (own / children / all for staff)
 * POST /remarks                   - Create request (student → parent approval; parent direct)
 * PUT  /remarks/:id/approve       - Parent approves student request
 * PUT  /remarks/:id/reject        - Parent rejects student request
 * POST /remarks/:id/consent       - Parent attests candidate consent (blocking)
 * POST /remarks/:id/pay           - Parent pays the fee (shared pipeline, purpose='remark')
 * POST /remarks/:id/submit-board  - Staff records board submission (finance)
 * POST /remarks/:id/outcome       - Staff records outcome; grade change refunds fee (finance)
 * POST /remarks/:id/cancel        - Owner cancels (pre-payment/submission)
 * GET/PUT /remarks/fees           - Fee schedule per council+service (finance admin edits)
 * GET/PUT /remarks/deadlines      - Per-series service deadlines (finance admin edits)
 *
 * GET  /remarks/results/pending   - Confirmed registrations awaiting grades (finance)
 * POST /remarks/results           - Bulk-record grades (finance)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  CreateRemarkRequest,
  DecideRemark,
  ConfirmRemarkConsent,
  PayRemark,
  MarkRemarkSubmitted,
  RecordRemarkOutcome,
  RemarkId,
  UpsertRemarkFee,
  UpsertRemarkDeadline,
  RecordResults,
  ResultsPendingQuery,
  ROLES,
  FINANCE_ROLES,
  hasRole,
} from '@repo/validations';
import { db } from '@repo/db';
import { success, error, clientMessage } from '../lib/response';
import {
  requireAuth,
  requireParent,
  requireFinance,
  requireFinanceAdmin,
} from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as remarkService from '../services/remark.services';
import { env } from '../env';
import { logAction, extractAuditContext } from '../services/audit.services';

function schoolAccountDetails() {
  return {
    bankName: env.SCHOOL_BANK_NAME ?? 'National Bank of Egypt',
    accountName: env.SCHOOL_ACCOUNT_NAME ?? 'IGCSE School',
    accountNumber: env.SCHOOL_ACCOUNT_NUMBER ?? '0012345678901234',
    iban: env.SCHOOL_IBAN ?? null,
  };
}

function friendlyStatus(message: string): 400 | 403 | 404 | 409 {
  if (message.includes('not linked') || message.includes('not authorized') || message.includes('only request')) return 403;
  if (message.includes('not found')) return 404;
  if (message.includes('already') || message.includes('no longer') || message.includes('not awaiting') || message.includes('in progress') || message.includes('ONE enquiry') || message.includes('one review per paper')) return 409;
  return 400;
}

export const remarks = new Hono<HonoEnv>()
  .use('*', requireAuth())

  // ─── Config (literal paths precede /:id) ──────────────────────────────────

  .get('/fees', async (c) => success(c, await remarkService.getRemarkFees()))

  .put('/fees', requireFinanceAdmin(), zValidator('json', UpsertRemarkFee), async (c) => {
    const data = c.req.valid('json');
    const saved = await remarkService.upsertRemarkFee(data);
    // RF-14: what families are charged for a remark changed with no record.
    await logAction(c.get('user')!.id, 'REMARK_FEE_SET', 'remark_fee', `${data.council}:${data.serviceType}`, null, data as Record<string, unknown>, extractAuditContext(c))
      .catch((err) => console.error('[audit] REMARK_FEE_SET failed:', err));
    return success(c, saved);
  })

  .get('/deadlines', async (c) => success(c, await remarkService.getRemarkDeadlines()))

  .put('/deadlines', requireFinanceAdmin(), zValidator('json', UpsertRemarkDeadline), async (c) => {
    const data = c.req.valid('json');
    const saved = await remarkService.upsertRemarkDeadline(data);
    await logAction(c.get('user')!.id, 'REMARK_DEADLINE_SET', 'remark_deadline', `${data.council}:${data.sessionId}:${data.serviceType}`, null, data as Record<string, unknown>, extractAuditContext(c))
      .catch((err) => console.error('[audit] REMARK_DEADLINE_SET failed:', err));
    return success(c, saved);
  })

  // ─── Results entry (V3 §5.4) ──────────────────────────────────────────────

  .get('/results/pending', requireFinance(), zValidator('query', ResultsPendingQuery), async (c) => {
    const { sessionId } = c.req.valid('query');
    return success(c, await remarkService.getPendingResults(sessionId));
  })

  .post('/results', requireFinance(), zValidator('json', RecordResults), async (c) => {
    const user = c.get('user')!;
    const { results } = c.req.valid('json');
    const outcome = await remarkService.recordResults(user.id, results);
    await logAction(user.id, 'RESULTS_RECORDED', 'registration', 'bulk', null, { count: outcome.recorded }, extractAuditContext(c))
      .catch((err) => console.error('[audit] RESULTS_RECORDED failed:', err));
    return success(c, outcome);
  })

  // ─── Requests ─────────────────────────────────────────────────────────────

  .get('/', async (c) => {
    const user = c.get('user')!;

    if (hasRole(user.role, ...FINANCE_ROLES)) {
      return success(c, await remarkService.getRemarkRequests({ staff: true }));
    }
    if (user.role === ROLES.STUDENT) {
      return success(c, await remarkService.getRemarkRequests({ studentIds: [user.id] }));
    }
    if (user.role === ROLES.PARENT) {
      const links = await db.query.parentStudentLink.findMany({
        where: (l, { eq, and }) => and(eq(l.parentId, user.id), eq(l.status, 'approved')),
        columns: { studentId: true },
      });
      return success(
        c,
        await remarkService.getRemarkRequests({ studentIds: links.map((l) => l.studentId) })
      );
    }
    return error(c, 'Forbidden', 403);
  })

  .post('/', zValidator('json', CreateRemarkRequest), async (c) => {
    const user = c.get('user')!;
    const data = c.req.valid('json');
    try {
      const created = await remarkService.createRemarkRequest(user.id, user.role ?? '', data);
      await logAction(user.id, 'REMARK_REQUESTED', 'remark_request', created!.id, null, created as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] REMARK_REQUESTED failed:', err));
      return success(c, created, 201);
    } catch (err) {
      const message = clientMessage(err, 'Failed to create remark request');
      return error(c, message, friendlyStatus(message));
    }
  })

  .put('/:id/approve', requireParent(), zValidator('param', RemarkId), zValidator('json', DecideRemark), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { comments } = c.req.valid('json');
    try {
      const updated = await remarkService.decideRemarkRequest(id, user.id, true, comments);
      await logAction(user.id, 'REMARK_APPROVED', 'remark_request', id, null, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] REMARK_APPROVED failed:', err));
      return success(c, updated);
    } catch (err) {
      const message = clientMessage(err, 'Failed to approve');
      return error(c, message, friendlyStatus(message));
    }
  })

  .put('/:id/reject', requireParent(), zValidator('param', RemarkId), zValidator('json', DecideRemark), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { comments } = c.req.valid('json');
    try {
      const updated = await remarkService.decideRemarkRequest(id, user.id, false, comments);
      await logAction(user.id, 'REMARK_REJECTED', 'remark_request', id, null, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] REMARK_REJECTED failed:', err));
      return success(c, updated);
    } catch (err) {
      const message = clientMessage(err, 'Failed to reject');
      return error(c, message, friendlyStatus(message));
    }
  })

  .post('/:id/consent', requireParent(), zValidator('param', RemarkId), zValidator('json', ConfirmRemarkConsent), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    try {
      const updated = await remarkService.confirmConsent(id, user.id, data);
      await logAction(user.id, 'REMARK_CONSENT_CONFIRMED', 'remark_request', id, null, { consentFileId: data.consentFileId ?? null }, extractAuditContext(c))
        .catch((err) => console.error('[audit] REMARK_CONSENT_CONFIRMED failed:', err));
      return success(c, updated);
    } catch (err) {
      const message = clientMessage(err, 'Failed to confirm consent');
      return error(c, message, friendlyStatus(message));
    }
  })

  .post('/:id/pay', requireParent(), zValidator('param', RemarkId), zValidator('json', PayRemark), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { paymentMethod } = c.req.valid('json');
    try {
      const created = await remarkService.initiateRemarkPayment(id, user.id, paymentMethod, schoolAccountDetails());
      await logAction(user.id, 'REMARK_PAYMENT_INITIATED', 'remark_request', id, null, { paymentMethod }, extractAuditContext(c))
        .catch((err) => console.error('[audit] REMARK_PAYMENT_INITIATED failed:', err));
      return success(c, created, 201);
    } catch (err) {
      const message = clientMessage(err, 'Failed to initiate payment');
      return error(c, message, friendlyStatus(message));
    }
  })

  .post('/:id/submit-board', requireFinance(), zValidator('param', RemarkId), zValidator('json', MarkRemarkSubmitted), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { boardReference } = c.req.valid('json');
    try {
      const updated = await remarkService.markSubmittedToBoard(id, boardReference);
      await logAction(user.id, 'REMARK_SUBMITTED_TO_BOARD', 'remark_request', id, null, { boardReference }, extractAuditContext(c))
        .catch((err) => console.error('[audit] REMARK_SUBMITTED_TO_BOARD failed:', err));
      return success(c, updated);
    } catch (err) {
      const message = clientMessage(err, 'Failed to record submission');
      return error(c, message, friendlyStatus(message));
    }
  })

  .post('/:id/outcome', requireFinance(), zValidator('param', RemarkId), zValidator('json', RecordRemarkOutcome), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    try {
      const result = await remarkService.recordOutcome(id, user.id, data);
      await logAction(user.id, 'REMARK_OUTCOME_RECORDED', 'remark_request', id, null, { ...data, refunded: result.refunded } as unknown as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] REMARK_OUTCOME_RECORDED failed:', err));
      return success(c, result);
    } catch (err) {
      const message = clientMessage(err, 'Failed to record outcome');
      return error(c, message, friendlyStatus(message));
    }
  })

  .post('/:id/cancel', zValidator('param', RemarkId), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    try {
      const updated = await remarkService.cancelRemarkRequest(id, user.id, user.role ?? '');
      await logAction(user.id, 'REMARK_CANCELLED', 'remark_request', id, null, null, extractAuditContext(c))
        .catch((err) => console.error('[audit] REMARK_CANCELLED failed:', err));
      return success(c, updated);
    } catch (err) {
      const message = clientMessage(err, 'Failed to cancel');
      return error(c, message, friendlyStatus(message));
    }
  });

export type RemarksApi = typeof remarks;
