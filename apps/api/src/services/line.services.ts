/**
 * Creating reservation lines (docs/features/RESERVATIONS.md §2.2).
 *
 * `insertLines` is the one way a line is made: inside the caller's transaction, after
 * `assertMayRegisterForInTx` (the student lock), it takes the rework's locks in the one order
 * of RESERVATIONS_REWORK.md §6 (each subject's board, the session's series links, the series,
 * the offers, the items, the fee rows), refuses a line whose series is past its effective
 * deadline or has no dates at all, runs `assertLineRules`, prices each line with `priceLine`,
 * sets its due date, checks its teacher and inserts it; the routing trigger enters it in its
 * item's series. It writes no consent rows: the caller does (step B).
 *
 * Since step B every reservation path (request, direct, desk, override, preregistration, swap)
 * takes `lines` and `consent` and reaches here through reservation.services `reserveLines`, which
 * resolves the sitting a retake follows and writes the consent rows (the bridge
 * `legacyLinesFor`, which built a subject's whole item from `subjectIds`, is gone).
 */

import {
  db, registration, registrationSession, subject, boardSeries, sessionBoardSeries, sessionOffer, sessionOfferItem,
  sessionOfferTeacher, sessionOfferItemTeacher, sessionOfferItemFeeKey, boardFee, teacher,
  and, eq, or, inArray, sql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type { Eligibility, LineInputType, Attempt, LineMode } from '@repo/validations';
import { lockFeeGrids } from '../lib/fee-grid-lock';
import { assertLineRules } from './line-rules.services';
import { priceLine } from './pricing.services';
import { computeDueAt, effectiveDeadlineFor, deadlinePassedSentence } from './deadline.services';
import { lineExceptions } from './line-exceptions';
import { getSetting } from './settings.services';
import { resolveItem, availabilityConstraints, OfferError } from './offer.services';
import { schoolDate } from './window.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class LineError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

export type InsertLinesInput = {
  studentId: string;
  sessionId: string;
  lines: LineInputType[];
  status: 'pending_approval' | 'pending_payment' | 'preregistered';
  requestedBy: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  approvalComments?: string | null;
  /** The path's mayRegisterFor answer (the grade-10 core rule reads it). The school-fee gate stays with the caller. */
  eligibility: Eligibility;
  now?: Date;
};

/**
 * Lock what a line rests on, in the order of §6 (after the student): each subject's board, the
 * session's series links, the series the lines go to, the offers, the items, the fee rows.
 */
async function lockForLines(tx: Tx, sessionId: string, itemIds: string[]) {
  const items = await tx.select({ id: sessionOfferItem.id, offerId: sessionOfferItem.offerId, seriesId: sessionOfferItem.boardSeriesId, subjectId: sessionOffer.subjectId })
    .from(sessionOfferItem).innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId))
    .where(inArray(sessionOfferItem.id, itemIds));
  const subjectIds = [...new Set(items.map((i) => i.subjectId))].sort();
  if (subjectIds.length) await tx.select({ id: subject.id }).from(subject).where(inArray(subject.id, subjectIds)).orderBy(subject.id).for('share');
  await tx.select({ id: sessionBoardSeries.id }).from(sessionBoardSeries).where(eq(sessionBoardSeries.sessionId, sessionId)).orderBy(sessionBoardSeries.id).for('share');
  const seriesIds = [...new Set(items.map((i) => i.seriesId).filter((s): s is string => !!s))].sort();
  if (seriesIds.length) await tx.select({ id: boardSeries.id }).from(boardSeries).where(inArray(boardSeries.id, seriesIds)).orderBy(boardSeries.id).for('share');
  const offerIds = [...new Set(items.map((i) => i.offerId))].sort();
  if (offerIds.length) await tx.select({ id: sessionOffer.id }).from(sessionOffer).where(inArray(sessionOffer.id, offerIds)).orderBy(sessionOffer.id).for('share');
  const held = itemIds.length
    ? await tx.select({ id: sessionOfferItem.id, seriesId: sessionOfferItem.boardSeriesId }).from(sessionOfferItem)
      .where(inArray(sessionOfferItem.id, [...itemIds].sort())).orderBy(sessionOfferItem.id).for('share')
    : [];
  // An item's series read before its lock may have moved while this waited (a series change or a
  // board change commits first): the series it is in now, held too. Only a deadline's writer
  // takes a series FOR UPDATE, and it holds no item, so this later share lock waits on no cycle.
  const moved = [...new Set(held.map((i) => i.seriesId).filter((x): x is string => !!x && !seriesIds.includes(x)))].sort();
  if (moved.length) await tx.select({ id: boardSeries.id }).from(boardSeries).where(inArray(boardSeries.id, moved)).orderBy(boardSeries.id).for('share');
  // The series' fee grids, shared, before the rows (§2.1; lib/fee-grid-lock.ts): a fee write or a
  // Confirm of this series waits for the line, or the line for it.
  await lockFeeGrids(tx, held.map((i) => i.seriesId), 'shared');
  const keys = itemIds.length ? await tx.select().from(sessionOfferItemFeeKey).where(inArray(sessionOfferItemFeeKey.itemId, itemIds)) : [];
  const feeConds = keys.flatMap((k) => {
    const it = held.find((i) => i.id === k.itemId);
    return it?.seriesId ? [and(eq(boardFee.boardSeriesId, it.seriesId), eq(boardFee.keyKind, k.keyKind), eq(boardFee.keyId, k.keyId))] : [];
  });
  if (feeConds.length) await tx.select({ id: boardFee.id }).from(boardFee).where(or(...feeConds)).orderBy(boardFee.id).for('share');
}

/**
 * For a path that holds a line before it makes new ones (a swap drops the old line — its receipt,
 * then the line — and then makes the new one): what making the new lines will lock, taken first,
 * in §2.1's order — the subjects, the session's series links, the series, the offers, the items,
 * the fee grids (shared) and the fee rows, then the student's price exceptions (FOR SHARE, as
 * `priceLine` takes them). A Confirm or a grid save holds its fee rows and then wants the lines
 * priced from them, the old line among them; taken after the old line, the new line's rows closed
 * that cycle (the review of B, on the swap approval). insertLines takes the same locks again,
 * already held. Call after the student lock (`assertMayRegisterForInTx`).
 */
export async function holdNewLines(tx: Tx, a: { studentId: string; sessionId: string; lines: { offerItemId: string; attempt: Attempt; mode: LineMode }[] }) {
  const itemIds = [...new Set(a.lines.map((l) => l.offerItemId))];
  if (!itemIds.length) return;
  await lockForLines(tx, a.sessionId, itemIds);
  for (const l of a.lines) {
    await priceLine(tx, { item: { id: l.offerItemId }, attempt: l.attempt, mode: l.mode, studentId: a.studentId, sessionId: a.sessionId }, { lock: true });
  }
}

/** The teachers who may be named on a line of an item: the item's own, else the offer's. */
async function teachersOf(executor: Executor, itemId: string, offerId: string) {
  const own = await executor.select({ teacherId: sessionOfferItemTeacher.teacherId }).from(sessionOfferItemTeacher).where(eq(sessionOfferItemTeacher.itemId, itemId));
  if (own.length) return own.map((t) => t.teacherId);
  return (await executor.select({ teacherId: sessionOfferTeacher.teacherId }).from(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, offerId))).map((t) => t.teacherId);
}

export async function insertLines(tx: Tx, input: InsertLinesInput) {
  const now = input.now ?? new Date();
  if (!input.lines.length) throw new LineError('Choose at least one item');
  // A prior sitting says where it is known from (B passes it: the student's record, the desk's or the
  // family's declaration); it is never assumed known (the review of 977848d).
  const unsourced = input.lines.find((l) => l.priorSittingSeriesId && !l.priorSittingSource);
  if (unsourced) throw new LineError('Say where the earlier sitting is known from: the record, the desk or the family');
  const itemIds = [...new Set(input.lines.map((l) => l.offerItemId))];
  if (itemIds.length !== input.lines.length) throw new LineError('Each item once');
  await lockForLines(tx, input.sessionId, itemIds);

  const [session] = await tx.select().from(registrationSession).where(eq(registrationSession.id, input.sessionId));
  if (!session) throw new LineError('Session not found', 404);
  const items = await tx.select({ item: sessionOfferItem, offer: sessionOffer, subjectName: subject.name })
    .from(sessionOfferItem).innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId)).innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .where(inArray(sessionOfferItem.id, itemIds));
  const byId = new Map(items.map((i) => [i.item.id, i]));

  // Each line's own cut-off: its series' effective deadline (§3.3). A series with no date at all takes no line.
  const deadlines = new Map<string, Date | null>();
  for (const l of input.lines) {
    const it = byId.get(l.offerItemId);
    if (!it || it.item.sessionId !== input.sessionId) throw new LineError('That item is not on offer in this session', 404);
    if (!it.item.boardSeriesId) throw new LineError(`${it.subjectName} is entered in no board series: it cannot be reserved`);
    // A line being made has no answer to a declaration yet (declarationRejected false).
    const d = await effectiveDeadlineFor(tx, { boardSeriesId: it.item.boardSeriesId, attempt: l.attempt, priorSittingSeriesId: l.priorSittingSeriesId ?? null, declarationRejected: false, studentId: input.studentId });
    if (!d.at) {
      throw new LineError(`${it.subjectName} is entered in a board series with no entry deadline and no exam dates yet: it opens for reservations once they are set`);
    }
    if (d.at <= now) throw new LineError(deadlinePassedSentence(d, schoolDate));
    deadlines.set(l.offerItemId, d.at);
  }

  const { usedExceptionIds } = await assertLineRules(tx, { studentId: input.studentId, sessionId: input.sessionId, eligibility: input.eligibility }, input.lines.map((l) => ({
    offerItemId: l.offerItemId, attempt: l.attempt, mode: l.mode, priorSittingSeriesId: l.priorSittingSeriesId ?? null, priorSittingSource: l.priorSittingSource ?? null,
  })));

  const graceDays = await getSetting('payment.graceDays', tx);
  const records: (typeof registration.$inferInsert)[] = [];
  for (const l of input.lines) {
    const it = byId.get(l.offerItemId)!;
    const price = await priceLine(tx, { item: { id: it.item.id }, attempt: l.attempt, mode: l.mode, studentId: input.studentId, sessionId: input.sessionId }, { lock: true });
    // The teacher: one of the item's (or the offer's); none in self-study; "no preference" allowed.
    let teacherId: string | null = null;
    if (l.mode === 'in_school' && l.teacherId) {
      const allowed = await teachersOf(tx, it.item.id, it.offer.id);
      if (!allowed.includes(l.teacherId)) {
        const [t] = await tx.select({ name: teacher.name }).from(teacher).where(eq(teacher.id, l.teacherId));
        throw new LineError(t ? `The chosen teacher is not linked to ${it.subjectName}` : 'Teacher not found');
      }
      teacherId = l.teacherId;
    }
    const exc = await lineExceptions.active(tx, input.studentId, ['deadline.payment'], { sessionId: input.sessionId, subjectId: it.offer.subjectId, offerItemId: it.item.id });
    const dueAt = computeDueAt({
      basis: session.paymentDueAt, reservedAt: now, graceDays, provisional: price.provisional, feeConfirmedAt: null,
      exceptionDate: exc.find((e) => e.valueDate)?.valueDate ?? null, cap: deadlines.get(l.offerItemId) ?? null,
    });
    records.push({
      id: randomUUID(),
      studentId: input.studentId,
      sessionId: input.sessionId,
      subjectId: it.offer.subjectId,
      offerItemId: it.item.id,
      boardSeriesId: it.item.boardSeriesId,
      attempt: l.attempt,
      mode: l.mode,
      isRetake: l.attempt === 'retake',
      takenOutsideSchool: l.mode === 'self_study',
      priorSittingSeriesId: l.priorSittingSeriesId ?? null,
      priorSittingSource: l.priorSittingSource ?? null,
      priceAtRegistration: price.total,
      courseFeeAtRegistration: price.courseFee,
      registrationFeeAtRegistration: price.registrationFee,
      priceProvisional: price.provisional,
      pricingBasis: price.basis as unknown as Record<string, unknown>,
      dueAt,
      teacherId,
      wasCoreAtRegistration: it.offer.grade10Core,
      status: input.status,
      requestedBy: input.requestedBy,
      approvedBy: input.approvedBy ?? null,
      approvedAt: input.approvedAt ?? null,
      approvalComments: input.approvalComments ?? null,
    });
  }
  const inserted = await tx.insert(registration).values(records).returning();
  if (usedExceptionIds.length) await lineExceptions.markUsed(tx, usedExceptionIds, { registrationIds: inserted.map((r) => r.id), actorId: input.requestedBy });
  return inserted;
}
