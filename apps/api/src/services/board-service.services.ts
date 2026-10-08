/**
 * The boards' services (RESERVATIONS_REWORK.md §3.6): what each board offers around an entry —
 * its enquiry-about-results services, cash-in, late cash-in, certificate splitting — with each
 * service's fee per series and level and its deadline per series.
 *
 * - A service's label, refund rule (what a family gets back when a remark changes the grade:
 *   `full`, `less_fixed` with a deduction per paper, or `none`; Q-21's default `full`) and whether a
 *   family may ask for it: the admin and the coordinator, with a reason, audited.
 * - A series' service deadlines (board_service_deadline, replacing remark_deadline per window):
 *   the admin and the coordinator, in the future when set, audited; a charge for the service is
 *   closed unpaid when its deadline passes (the sweep).
 * - A series' service fees (board_service_fee): finance (admin, finance admin), audited;
 *   provisional until confirmed, as a board fee is.
 */

import { db, boardService, boardServiceFee, boardServiceDeadline, boardSeries, examBoard, and, eq, inArray, asc } from '@repo/db';
import { randomUUID } from 'crypto';
import type { BoardServicesQueryType, PutServiceDeadlinesType, PutServiceFeesType, UpdateBoardServiceType, ServiceRefundRuleType } from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { repriceChargesOfFee } from './charge.services';

export class BoardServiceError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

/** Every service (of a board), with its fees and deadline in a series when one is named. */
export async function listBoardServices(q: BoardServicesQueryType = {}) {
  let boardCode = q.boardCode;
  if (q.boardSeriesId) {
    const [s] = await db.select({ boardCode: boardSeries.boardCode }).from(boardSeries).where(eq(boardSeries.id, q.boardSeriesId));
    if (!s) throw new BoardServiceError('Board series not found', 404);
    boardCode = s.boardCode;
  }
  const services = await db.select({ service: boardService, boardName: examBoard.name }).from(boardService)
    .innerJoin(examBoard, eq(examBoard.code, boardService.boardCode))
    .where(boardCode ? eq(boardService.boardCode, boardCode) : undefined)
    .orderBy(asc(examBoard.sortOrder), asc(boardService.sortOrder), asc(boardService.code));
  const ids = services.map((s) => s.service.id);
  const fees = q.boardSeriesId && ids.length
    ? await db.select().from(boardServiceFee).where(and(eq(boardServiceFee.boardSeriesId, q.boardSeriesId), inArray(boardServiceFee.boardServiceId, ids)))
    : [];
  const deadlines = q.boardSeriesId && ids.length
    ? await db.select().from(boardServiceDeadline).where(and(eq(boardServiceDeadline.boardSeriesId, q.boardSeriesId), inArray(boardServiceDeadline.boardServiceId, ids)))
    : [];
  return services.map(({ service, boardName }) => ({
    ...service,
    boardName,
    fees: fees.filter((f) => f.boardServiceId === service.id).map((f) => ({ id: f.id, level: f.level, amount: f.amount, provisional: f.provisional, copiedFromDefault: f.copiedFromDefault })),
    deadline: deadlines.find((d) => d.boardServiceId === service.id)?.deadline ?? null,
  }));
}

export async function updateBoardService(id: string, data: UpdateBoardServiceType | ServiceRefundRuleType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(boardService).where(eq(boardService.id, id)).for('update');
    if (!cur) throw new BoardServiceError('Board service not found', 404);
    const next: Partial<typeof boardService.$inferInsert> = {};
    if ('label' in data && data.label !== undefined && data.label !== cur.label) next.label = data.label;
    // The refund rule (a money rule) comes only through PUT /:id/refund-rule (finance admin, admin).
    if ('refundRule' in data) {
      if (data.refundRule !== cur.refundRule) next.refundRule = data.refundRule;
      next.refundDeduction = data.refundRule === 'less_fixed' ? (data.refundDeduction ?? cur.refundDeduction) : null;
      if (data.refundRule === 'less_fixed' && !next.refundDeduction) throw new BoardServiceError('A fixed deduction needs its amount');
    }
    if ('requestableByFamily' in data && data.requestableByFamily !== undefined && data.requestableByFamily !== cur.requestableByFamily) next.requestableByFamily = data.requestableByFamily;
    if ('isActive' in data && data.isActive !== undefined && data.isActive !== cur.isActive) next.isActive = data.isActive;
    if (!Object.keys(next).length || Object.entries(next).every(([k, v]) => (cur as Record<string, unknown>)[k] === v)) throw new BoardServiceError('Nothing to change', 409);
    const [updated] = await tx.update(boardService).set({ ...next, updatedAt: new Date() }).where(eq(boardService.id, id)).returning();
    await logAction(actorId, 'BOARD_SERVICE_UPDATED', 'board_service', id,
      Object.fromEntries(Object.keys(next).map((k) => [k, (cur as Record<string, unknown>)[k] ?? null])), { ...next, reason: data.reason }, ctx, tx);
    return updated!;
  });
}

/** A series' service deadlines: set (in the future) or cleared, per service of the series' board. */
export async function putServiceDeadlines(data: PutServiceDeadlinesType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(boardSeries).where(eq(boardSeries.id, data.boardSeriesId)).for('share');
    if (!s) throw new BoardServiceError('Board series not found', 404);
    const services = await tx.select().from(boardService).where(inArray(boardService.id, data.rows.map((r) => r.boardServiceId)));
    const changed: Record<string, unknown>[] = [];
    const now = new Date();
    for (const r of data.rows) {
      const svc = services.find((x) => x.id === r.boardServiceId);
      if (!svc) throw new BoardServiceError('Board service not found', 404);
      if (svc.boardCode !== s.boardCode) throw new BoardServiceError(`${svc.label} is a service of another board`);
      const [cur] = await tx.select().from(boardServiceDeadline)
        .where(and(eq(boardServiceDeadline.boardSeriesId, s.id), eq(boardServiceDeadline.boardServiceId, svc.id))).for('update');
      if (r.deadline === null) {
        if (cur) {
          await tx.delete(boardServiceDeadline).where(eq(boardServiceDeadline.id, cur.id));
          changed.push({ boardServiceId: svc.id, from: cur.deadline.toISOString(), to: null });
        }
        continue;
      }
      if (r.deadline <= now) throw new BoardServiceError(`${svc.label}: the deadline must be in the future`);
      if (cur && cur.deadline.getTime() === r.deadline.getTime()) continue;
      if (cur) await tx.update(boardServiceDeadline).set({ deadline: r.deadline, setBy: actorId, updatedAt: now }).where(eq(boardServiceDeadline.id, cur.id));
      else await tx.insert(boardServiceDeadline).values({ id: randomUUID(), boardSeriesId: s.id, boardServiceId: svc.id, deadline: r.deadline, setBy: actorId });
      changed.push({ boardServiceId: svc.id, from: cur?.deadline.toISOString() ?? null, to: r.deadline.toISOString() });
    }
    if (!changed.length) throw new BoardServiceError('Nothing to change', 409);
    await logAction(actorId, 'SERVICE_DEADLINES_SET', 'board_series', s.id, null, { rows: changed, reason: data.reason }, ctx, tx);
    return { changed: changed.length };
  });
}

/** A series' service fees, per service and level, as the board's list gives them. */
export async function putServiceFees(data: PutServiceFeesType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    let chargesRepriced = 0;
    const [s] = await tx.select().from(boardSeries).where(eq(boardSeries.id, data.boardSeriesId)).for('share');
    if (!s) throw new BoardServiceError('Board series not found', 404);
    const services = await tx.select().from(boardService).where(inArray(boardService.id, data.rows.map((r) => r.boardServiceId)));
    const changed: Record<string, unknown>[] = [];
    const now = new Date();
    for (const r of data.rows) {
      const svc = services.find((x) => x.id === r.boardServiceId);
      if (!svc) throw new BoardServiceError('Board service not found', 404);
      if (svc.boardCode !== s.boardCode) throw new BoardServiceError(`${svc.label} is a service of another board`);
      const [cur] = await tx.select().from(boardServiceFee)
        .where(and(eq(boardServiceFee.boardSeriesId, s.id), eq(boardServiceFee.boardServiceId, svc.id), eq(boardServiceFee.level, r.level))).for('update');
      const confirm = !r.provisional;
      if (cur) {
        if (cur.amount === r.amount && cur.provisional === r.provisional) continue;
        await tx.update(boardServiceFee).set({
          amount: r.amount, provisional: r.provisional, confirmedAt: confirm ? now : null, confirmedBy: confirm ? actorId : null, copiedFromDefault: false, updatedAt: now,
        }).where(eq(boardServiceFee.id, cur.id));
        // The open charges priced from this fee follow it.
        chargesRepriced += await repriceChargesOfFee(tx, { feeId: cur.id, amount: r.amount, provisional: r.provisional, actorId, ctx });
      } else {
        await tx.insert(boardServiceFee).values({
          id: randomUUID(), boardSeriesId: s.id, boardServiceId: svc.id, level: r.level, amount: r.amount, provisional: r.provisional,
          confirmedAt: confirm ? now : null, confirmedBy: confirm ? actorId : null, createdBy: actorId,
        });
      }
      changed.push({ boardServiceId: svc.id, level: r.level, from: cur?.amount ?? null, to: r.amount, provisional: r.provisional });
    }
    if (!changed.length) throw new BoardServiceError('Nothing to change', 409);
    await logAction(actorId, 'SERVICE_FEES_SET', 'board_series', s.id, null, { rows: changed, reason: data.reason ?? null, chargesRepriced }, ctx, tx);
    return { changed: changed.length, chargesRepriced };
  });
}
