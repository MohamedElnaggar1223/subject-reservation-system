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
import { db, gradeTodayExtras } from '@repo/db';
import {
  ReceiptId,
  MarkReceiptReturned,
  MarkReceiptLostOrVoid,
  CreateRefundWindow,
  RefundWindowId,
  RefundPreviewQuery,
  ROLES,
  FINANCE_ROLES,
  hasRole,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
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
    let created;
    try {
      created = await refundService.createWindow(data);
    } catch (err) {
      const message = clientMessage(err, 'Failed to create refund window');
      return error(c, message, message.includes('overlaps') ? 409 : 400);
    }
    await logAction(user.id, 'REFUND_WINDOW_CREATED', 'refund_window', created!.id, null, created as Record<string, unknown>, extractAuditContext(c))
      .catch((err) => console.error('[audit] REFUND_WINDOW_CREATED failed:', err));
    return success(c, created, 201);
  })

  .delete('/refund-windows/:id', requireFinanceAdmin(), zValidator('param', RefundWindowId), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const deleted = await refundService.deleteWindow(id);
    if (!deleted) return error(c, 'Refund window not found', 404);
    await logAction(user.id, 'REFUND_WINDOW_DELETED', 'refund_window', id, deleted as Record<string, unknown>, null, extractAuditContext(c))
      .catch((err) => console.error('[audit] REFUND_WINDOW_DELETED failed:', err));
    return success(c, deleted);
  })

  /**
   * Transparency rule (§6.12): every drop/swap dialog shows "You will
   * receive X% = EGP Y back" BEFORE the user commits.
   */
  .get('/refund-preview', zValidator('query', RefundPreviewQuery), async (c) => {
    const user = c.get('user')!;
    const { registrationId } = c.req.valid('query');

    // IDOR guard: only the registration's student, a linked parent, or
    // finance/admin staff may preview it — otherwise any authenticated
    // user could probe other students' prices and refund amounts.
    const reg = await db.query.registration.findFirst({
      where: (r, { eq }) => eq(r.id, registrationId),
      columns: { studentId: true },
    });
    if (!reg) return error(c, 'Registration not found', 404);

    const isStaff = hasRole(user.role, ...FINANCE_ROLES);
    const isOwnStudent = user.role === ROLES.STUDENT && reg.studentId === user.id;
    let isLinkedParent = false;
    if (!isStaff && !isOwnStudent && user.role === ROLES.PARENT) {
      const link = await db.query.parentStudentLink.findFirst({
        where: (l, { eq, and }) =>
          and(eq(l.parentId, user.id), eq(l.studentId, reg.studentId), eq(l.status, 'approved')),
        columns: { id: true },
      });
      isLinkedParent = !!link;
    }
    if (!isStaff && !isOwnStudent && !isLinkedParent) {
      return error(c, 'Forbidden', 403);
    }

    try {
      return success(c, await refundService.previewRefund(registrationId));
    } catch (err) {
      const message = clientMessage(err, 'Failed to preview refund');
      return error(c, message, message.includes('not found') ? 404 : 400);
    }
  })

  // ─── Desk actions ─────────────────────────────────────────────────────────

  .post('/:id/issue', requireFinance(), zValidator('param', ReceiptId), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    try {
      const updated = await receiptService.markIssued(id, user.id, extractAuditContext(c));
      return success(c, updated);
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to issue receipt'), 409);
    }
  })

  .post('/:id/return', requireFinance(), zValidator('param', ReceiptId), zValidator('json', MarkReceiptReturned), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { notes } = c.req.valid('json');
    try {
      const updated = await receiptService.markReturned(id, user.id, notes, extractAuditContext(c));
      return success(c, updated);
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to mark returned'), 409);
    }
  })

  .post('/:id/lost', requireFinanceAdmin(), zValidator('param', ReceiptId), zValidator('json', MarkReceiptLostOrVoid), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    try {
      const updated = await receiptService.markLostOrVoid(id, user.id, 'lost', reason, extractAuditContext(c));
      return success(c, updated);
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to mark lost'), 409);
    }
  })

  .post('/:id/void', requireFinanceAdmin(), zValidator('param', ReceiptId), zValidator('json', MarkReceiptLostOrVoid), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    try {
      const updated = await receiptService.markLostOrVoid(id, user.id, 'void', reason, extractAuditContext(c));
      return success(c, updated);
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to void receipt'), 409);
    }
  })

  /**
   * GET /receipts/:id  (UX_AUDIT G3)
   *
   * Full receipt detail for the printable view — the paper the parent
   * actually holds. Finance roles + admin.
   */
  .get('/:id', zValidator('param', ReceiptId), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const found = await db.query.receipt.findFirst({
      where: (r, { eq }) => eq(r.id, id),
      with: {
        registration: {
          with: {
            student: { columns: { id: true, name: true, studentId: true, cohortYear: true }, extras: gradeTodayExtras },
            subject: { columns: { id: true, name: true, code: true, council: true } },
            session: { columns: { id: true, name: true } },
          },
        },
        // The reservations rework (§3.10 item 2): a charge's receipt prints its charge.
        charge: {
          columns: { id: true, studentId: true, kind: true, description: true, amount: true, status: true },
          with: { student: { columns: { id: true, name: true, studentId: true, cohortYear: true }, extras: gradeTodayExtras } },
        },
      },
    });
    if (!found) return error(c, 'Receipt not found', 404);

    // The family's refund depends on this paper, so they must be able
    // to see and print it — scoped to their own receipts.
    const isStaff = hasRole(user.role, ...FINANCE_ROLES);
    const ownerStudentId = found.registration?.studentId ?? found.charge?.studentId ?? '';
    let allowed = isStaff || (user.role === ROLES.STUDENT && ownerStudentId === user.id);
    if (!allowed && user.role === ROLES.PARENT) {
      const link = await db.query.parentStudentLink.findFirst({
        where: (l, { eq, and }) =>
          and(eq(l.parentId, user.id), eq(l.studentId, ownerStudentId), eq(l.status, 'approved')),
        columns: { id: true },
      });
      allowed = !!link;
    }
    if (!allowed) return error(c, 'Forbidden', 403);

    return success(c, found);
  });

export type ReceiptsApi = typeof receipts;
