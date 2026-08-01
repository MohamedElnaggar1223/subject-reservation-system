/**
 * Receipt + Refund Window API Routes (V3 §6.5, §6.12)
 *
 * GET  /receipts/queue           - Receipts needing desk action (finance)
 * GET  /receipts/by-number       - Receipt lookup by printed number (finance)
 * POST /receipts/:id/issue       - Mark handed to parent (finance)
 * POST /receipts/:id/return      - Mark returned; releases parked drop refund (finance)
 * POST /receipts/:id/lost        - Write off as lost (finance admin)
 * POST /receipts/:id/void        - Void (finance admin)
 *
 * GET    /receipts/refund-windows          - List refund windows (finance)
 * POST   /receipts/refund-windows          - Create window (finance admin)
 * DELETE /receipts/refund-windows/:id      - Delete window (finance admin)
 * GET    /receipts/refund-preview          - Parent/student preview: % + amount for a drop
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  ReceiptId,
  MarkReceiptReturned,
  MarkReceiptLostOrVoid,
  CreateRefundWindow,
  RefundWindowId,
  RefundPreviewQuery,
} from '@repo/validations';
import { success, error } from '../lib/response';
import {
  requireAuth,
  requireFinance,
  requireFinanceAdmin,
} from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as receiptService from '../services/receipt.services';
import * as refundService from '../services/refund.services';
import { logAction, extractAuditContext } from '../services/audit.services';

export const receipts = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/queue', requireFinance(), async (c) => {
    return success(c, await receiptService.getReceiptsQueue());
  })

  .get('/by-number', requireFinance(), zValidator('query', z.object({ number: z.string().min(3) })), async (c) => {
    const { number } = c.req.valid('query');
    const found = await receiptService.findByNumber(number);
    if (!found) return error(c, 'No receipt with that number', 404);
    return success(c, found);
  })

  // ─── Refund windows (must precede /:id routes) ────────────────────────────

  .get('/refund-windows', requireFinance(), async (c) => {
    return success(c, await refundService.getWindows());
  })

  .post('/refund-windows', requireFinanceAdmin(), zValidator('json', CreateRefundWindow), async (c) => {
    const user = c.get('user')!;
    const data = c.req.valid('json');
    const created = await refundService.createWindow(data);
    logAction(user.id, 'REFUND_WINDOW_CREATED', 'refund_window', created!.id, null, created as Record<string, unknown>, extractAuditContext(c))
      .catch((err) => console.error('[audit] REFUND_WINDOW_CREATED failed:', err));
    return success(c, created, 201);
  })

  .delete('/refund-windows/:id', requireFinanceAdmin(), zValidator('param', RefundWindowId), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const deleted = await refundService.deleteWindow(id);
    if (!deleted) return error(c, 'Refund window not found', 404);
    logAction(user.id, 'REFUND_WINDOW_DELETED', 'refund_window', id, deleted as Record<string, unknown>, null, extractAuditContext(c))
      .catch((err) => console.error('[audit] REFUND_WINDOW_DELETED failed:', err));
    return success(c, deleted);
  })

  /**
   * Transparency rule (§6.12): every drop/swap dialog shows "You will
   * receive X% = EGP Y back" BEFORE the user commits.
   */
  .get('/refund-preview', zValidator('query', RefundPreviewQuery), async (c) => {
    const { registrationId } = c.req.valid('query');
    try {
      return success(c, await refundService.previewRefund(registrationId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to preview refund';
      return error(c, message, message.includes('not found') ? 404 : 400);
    }
  })

  // ─── Desk actions ─────────────────────────────────────────────────────────

  .post('/:id/issue', requireFinance(), zValidator('param', ReceiptId), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    try {
      const updated = await receiptService.markIssued(id, user.id);
      logAction(user.id, 'RECEIPT_ISSUED', 'receipt', id, null, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] RECEIPT_ISSUED failed:', err));
      return success(c, updated);
    } catch (err) {
      return error(c, err instanceof Error ? err.message : 'Failed to issue receipt', 409);
    }
  })

  .post('/:id/return', requireFinance(), zValidator('param', ReceiptId), zValidator('json', MarkReceiptReturned), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { notes } = c.req.valid('json');
    try {
      const updated = await receiptService.markReturned(id, user.id, notes);
      logAction(user.id, 'RECEIPT_RETURNED', 'receipt', id, null, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] RECEIPT_RETURNED failed:', err));
      return success(c, updated);
    } catch (err) {
      return error(c, err instanceof Error ? err.message : 'Failed to mark returned', 409);
    }
  })

  .post('/:id/lost', requireFinanceAdmin(), zValidator('param', ReceiptId), zValidator('json', MarkReceiptLostOrVoid), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    try {
      const updated = await receiptService.markLostOrVoid(id, user.id, 'lost', reason);
      logAction(user.id, 'RECEIPT_LOST', 'receipt', id, null, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] RECEIPT_LOST failed:', err));
      return success(c, updated);
    } catch (err) {
      return error(c, err instanceof Error ? err.message : 'Failed to mark lost', 409);
    }
  })

  .post('/:id/void', requireFinanceAdmin(), zValidator('param', ReceiptId), zValidator('json', MarkReceiptLostOrVoid), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    try {
      const updated = await receiptService.markLostOrVoid(id, user.id, 'void', reason);
      logAction(user.id, 'RECEIPT_VOIDED', 'receipt', id, null, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] RECEIPT_VOIDED failed:', err));
      return success(c, updated);
    } catch (err) {
      return error(c, err instanceof Error ? err.message : 'Failed to void receipt', 409);
    }
  });

export type ReceiptsApi = typeof receipts;
