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
 * The paths that still name subjects (request, direct, desk, override, preregistration, swap)
 * build their lines with `legacyLinesFor`: the subject's whole item (`resolveItem`), a retake
 * when the student sat or dropped the subject in another session, self-study when asked or when
 * the item is self-study only — until step B gives them `lines` and `consent`.
 */

import {
  db, registration, registrationSession, subject, boardSeries, sessionBoardSeries, sessionOffer, sessionOfferItem,
  sessionOfferTeacher, sessionOfferItemTeacher, sessionOfferItemFeeKey, boardFee, teacher,
  and, eq, or, inArray, sql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type { Eligibility, LineInputType, SubjectRegistrationOptionsType } from '@repo/validations';
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
  if (itemIds.length) await tx.select({ id: sessionOfferItem.id }).from(sessionOfferItem).where(inArray(sessionOfferItem.id, [...itemIds].sort())).orderBy(sessionOfferItem.id).for('share');
  const keys = itemIds.length ? await tx.select().from(sessionOfferItemFeeKey).where(inArray(sessionOfferItemFeeKey.itemId, itemIds)) : [];
  const feeConds = keys.flatMap((k) => {
    const it = items.find((i) => i.id === k.itemId);
    return it?.seriesId ? [and(eq(boardFee.boardSeriesId, it.seriesId), eq(boardFee.keyKind, k.keyKind), eq(boardFee.keyId, k.keyId))] : [];
  });
  if (feeConds.length) await tx.select({ id: boardFee.id }).from(boardFee).where(or(...feeConds)).orderBy(boardFee.id).for('share');
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
    const d = await effectiveDeadlineFor(tx, { boardSeriesId: it.item.boardSeriesId, attempt: l.attempt, priorSittingSeriesId: l.priorSittingSeriesId ?? null });
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
    const price = await priceLine(tx, { item: { id: it.item.id }, attempt: l.attempt, mode: l.mode, studentId: input.studentId, sessionId: input.sessionId });
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
      priorSittingSource: l.priorSittingSource ?? (l.priorSittingSeriesId ? 'known' : null),
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

/**
 * The subjects a path names, as lines (until step B gives the paths `lines`): each subject's whole
 * item; a retake when the student sat (confirmed) or dropped the subject in another session —
 * its prior sitting the latest such line's series ('known'), or unknown ('legacy') when that line
 * had none; self-study when asked, or when the item is self-study only; the teacher asked for.
 */
export async function legacyLinesFor(
  executor: Executor, studentId: string, sessionId: string, subjectIds: string[],
  options: Record<string, SubjectRegistrationOptionsType> | undefined,
): Promise<LineInputType[]> {
  const out: LineInputType[] = [];
  for (const subjectId of subjectIds) {
    let resolved;
    try {
      resolved = await resolveItem(executor, sessionId, subjectId);
    } catch (err) {
      if (err instanceof OfferError) throw new LineError(err.message, err.status === 404 ? 404 : 400);
      throw err;
    }
    const prior = await executor.select({ boardSeriesId: registration.boardSeriesId }).from(registration)
      .where(and(eq(registration.studentId, studentId), eq(registration.subjectId, subjectId), sql`${registration.sessionId} <> ${sessionId}`,
        inArray(registration.status, ['confirmed', 'dropped'])))
      .orderBy(sql`${registration.createdAt} desc`, sql`${registration.id} desc`);
    const isRetake = prior.length > 0;
    const known = prior.find((p) => p.boardSeriesId)?.boardSeriesId ?? null;
    const c = availabilityConstraints(resolved.offer.availability, resolved.item.availability);
    const opts = options?.[subjectId] ?? {};
    const mode = c.selfStudyOnly || opts.takeOutsideSchool ? 'self_study' : 'in_school';
    out.push({
      offerItemId: resolved.item.id,
      attempt: isRetake ? 'retake' : 'first',
      mode,
      teacherId: mode === 'in_school' ? opts.teacherId ?? null : null,
      priorSittingSeriesId: isRetake ? known : null,
      priorSittingSource: isRetake ? (known ? 'known' : 'legacy') : null,
    });
  }
  return out;
}
