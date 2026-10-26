/**
 * Impact before saving, and the re-price of a row's lines (COORDINATOR_REWORK.md A3, E7, §6, §9.2, §10).
 *
 * A change that affects families answers its counts first — `{ repriced, listedForFinance,
 * linesAffected, dueDatesMoved }` — without writing; the client sends the same counts back as
 * `expected` and a mismatch is refused (IMPACT_CHANGED, today's PRICE_CHANGED pattern). A change
 * whose counts are all zero is saved at once (nothing to confirm).
 *
 * The change is made inside its transaction first and its effect counted there, under the locks the
 * re-price needs; when the counts must be confirmed, or no longer match, the transaction is rolled
 * back (`ImpactPending`, `ImpactChanged`), so "answer the impact without writing" and "save what was
 * confirmed" are one code path and cannot disagree.
 *
 * The re-price (E7; today's rule, keyed by row): a waiting line with no payment history is priced
 * again with the exceptions its basis recorded, audited per line (LINE_REPRICED) and its family told
 * after the commit; every other line whose price would change is listed for finance, untouched (a
 * charge or a refund is finance's act). Lock order (§9.2): the caller takes the session, the offering
 * and the rows FOR UPDATE (in that order, rows in id order) and writes the new prices; here the lines
 * are taken FOR UPDATE in id order, then their payment history is read — a checkout committing while
 * this waits is then seen (insertLines takes the session, the offering and the row FOR SHARE in the
 * same order, so a new line waits for the change or the change for it).
 */

import { db, registration, subject, sql, eq, inArray } from '@repo/db';
import { formatEgp, IMPACT_CHANGED_REFUSAL, type ImpactType, type PricingBasis } from '@repo/validations';
import { logAction, logActions, type AuditContext } from '../audit.services';
import { paymentHistoryOf, PAYMENT_HISTORY_REASON } from '../line-history.services';
import { priceLine, PricingError, round2 } from '../pricing.services';
import { dueDateFor } from '../deadline.services';
import { createNotification } from '../notification.services';
import { LIVE_LINE_STATUSES as LIVE, isLiveStatus } from './model';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Impact = ImpactType;
export const NO_IMPACT: Impact = { repriced: 0, listedForFinance: 0, linesAffected: 0, dueDatesMoved: 0 };

/** IMPACT_CHANGED (Appendix A): the counts the client confirmed are no longer what the change does (one sentence, shared with the screens). */
export { IMPACT_CHANGED_REFUSAL };

/** The change must be confirmed with these counts (the transaction is rolled back; nothing was written). */
export class ImpactPending extends Error {
  constructor(public readonly impact: Impact) {
    super('This change affects families: confirm its counts to save it');
  }
}

/** The confirmed counts no longer match (409 IMPACT_CHANGED; nothing was written). */
export class ImpactChanged extends Error {
  public readonly status = 409 as const;
  constructor(public readonly impact: Impact) {
    super(IMPACT_CHANGED_REFUSAL);
  }
}

export function addImpact(a: Impact, b: Partial<Impact>): Impact {
  return {
    repriced: a.repriced + (b.repriced ?? 0),
    listedForFinance: a.listedForFinance + (b.listedForFinance ?? 0),
    linesAffected: a.linesAffected + (b.linesAffected ?? 0),
    dueDatesMoved: a.dueDatesMoved + (b.dueDatesMoved ?? 0),
  };
}

const isZero = (i: Impact) => !i.repriced && !i.listedForFinance && !i.linesAffected && !i.dueDatesMoved;
const same = (a: Impact, b: Impact) =>
  a.repriced === b.repriced && a.listedForFinance === b.listedForFinance && a.linesAffected === b.linesAffected && a.dueDatesMoved === b.dueDatesMoved;

/**
 * The impact rule, inside the change's transaction once its effect is counted: with no `expected`, a
 * change that affects nobody goes ahead and one that does is answered (rolled back); with `expected`,
 * it goes ahead only when the counts are the same.
 */
export function settleImpact(impact: Impact, expected: Impact | undefined) {
  if (!expected) {
    if (!isZero(impact)) throw new ImpactPending(impact);
    return;
  }
  if (!same(impact, expected)) throw new ImpactChanged(impact);
}

const WAITING = ['pending_approval', 'pending_payment', 'preregistered'];

export type RepricedLine = { id: string; studentId: string; subjectId: string; from: number; to: number };
export type ListedLine = { id: string; studentId: string; status: string; price: number; newPrice: number | null; reason: string };
export type RepricePlan = {
  repriced: (RepricedLine & { next: Awaited<ReturnType<typeof priceLine>> })[];
  listed: ListedLine[];
};

/**
 * The lines of these rows (or of these sessions' self-study options) a price change reaches, after
 * the caller wrote the new prices: each live line locked FOR UPDATE in id order, then its payment
 * history read, then priced again as its row stands now with the exceptions its basis recorded.
 * Nothing is written here (applyReprice writes).
 */
export async function planReprice(tx: Tx, scope: { rowIds?: string[]; selfStudyOfSession?: string }): Promise<RepricePlan> {
  const conds = [];
  if (scope.rowIds?.length) conds.push(sql`r.offer_item_id in (${sql.join(scope.rowIds.map((id) => sql`${id}`), sql`, `)})`);
  if (scope.selfStudyOfSession) conds.push(sql`(r.session_id = ${scope.selfStudyOfSession} and r.mode = 'self_study')`);
  if (!conds.length) return { repriced: [], listed: [] };
  const ids = (await tx.execute(sql`
    select r.id from registration r
    where r.status in (${sql.join(LIVE.map((s) => sql`${s}`), sql`, `)}) and (${sql.join(conds, sql` or `)})
    order by r.id`)).rows.map((x) => (x as { id: string }).id);
  if (!ids.length) return { repriced: [], listed: [] };
  // The lines first, locked in id order; their payment history after (a checkout committing meanwhile is seen).
  const lines = await tx.select().from(registration).where(inArray(registration.id, ids)).orderBy(registration.id).for('update');
  const history = await paymentHistoryOf(tx, ids);
  const plan: RepricePlan = { repriced: [], listed: [] };
  for (const l of lines) {
    if (!isLiveStatus(l.status)) continue;
    const basis = l.pricingBasis as PricingBasis | null;
    let next: Awaited<ReturnType<typeof priceLine>>;
    try {
      next = await priceLine(tx, {
        item: { id: l.offerItemId }, attempt: l.attempt as 'first' | 'retake', mode: l.mode as 'in_school' | 'self_study',
        studentId: l.studentId, sessionId: l.sessionId,
      }, { exceptionIds: basis?.exceptionIds ?? [] });
    } catch (err) {
      // A price left not set on a row that lines use: the change is refused (close the row instead).
      if (err instanceof PricingError) throw new PricingError(`${err.message} — and it has reservations: set a price, or close it instead`, 409);
      throw err;
    }
    const priceChanges = round2(next.total) !== round2(l.priceAtRegistration);
    const markChanges = next.provisional !== l.priceProvisional;
    if (!priceChanges && !markChanges) continue;
    const mayReprice = !!basis && !history.has(l.id) && WAITING.includes(l.status);
    if (mayReprice) {
      // A waiting line with no payment history: priced again (a provisional mark alone changing too).
      plan.repriced.push({ id: l.id, studentId: l.studentId, subjectId: l.subjectId, from: l.priceAtRegistration, to: next.total, next });
    } else if (priceChanges) {
      // Every other line whose price would change is listed for finance, untouched (E7).
      plan.listed.push({
        id: l.id, studentId: l.studentId, status: l.status, price: l.priceAtRegistration, newPrice: next.total,
        reason: !basis ? 'converted line (no pricing basis)' : history.has(l.id) ? PAYMENT_HISTORY_REASON[history.get(l.id)!] : `is ${l.status}`,
      });
    }
  }
  return plan;
}

/**
 * Write a plan in the caller's transaction: each re-priced line's price, basis and due date, its
 * LINE_REPRICED row, and one ROWS_REPRICED row for the batch naming the lines listed for finance.
 * Returns the lines whose price changed (the families to tell after the commit) and the plan's impact,
 * counted from what was written: re-priced (the price changed), listed for finance, lines whose only
 * change is the provisional mark (linesAffected) and due dates moved. The caller settles the impact
 * after this (a change still to be confirmed rolls the transaction back, these writes with it).
 */
export async function applyReprice(
  tx: Tx, plan: RepricePlan, a: { actorId: string; reason: string; entity: { type: 'session' | 'session_offer' | 'offer_item' | 'price_list'; id: string }; ctx?: AuditContext },
): Promise<{ told: RepricedLine[]; impact: Impact }> {
  const now = new Date();
  let dueDatesMoved = 0;
  for (const r of plan.repriced) {
    const [before] = await tx.select({ dueAt: registration.dueAt }).from(registration).where(eq(registration.id, r.id));
    await tx.update(registration).set({
      priceAtRegistration: r.next.total, courseFeeAtRegistration: r.next.courseFee, registrationFeeAtRegistration: r.next.registrationFee,
      priceProvisional: r.next.provisional, pricingBasis: r.next.basis as unknown as Record<string, unknown>, updatedAt: now,
    }).where(eq(registration.id, r.id));
    const due = await dueDateFor(tx, { kind: 'line', lineId: r.id });
    if ((before?.dueAt?.getTime() ?? null) !== due.getTime()) {
      await tx.update(registration).set({ dueAt: due }).where(eq(registration.id, r.id));
      dueDatesMoved++;
    }
  }
  await logActions(plan.repriced.map((r) => ({
    userId: a.actorId, action: 'LINE_REPRICED' as const, entityType: 'registration' as const, entityId: r.id,
    previousData: { priceAtRegistration: r.from }, newData: { priceAtRegistration: r.to, reason: a.reason, provisional: r.next.provisional },
  })), tx);
  if (plan.repriced.length || plan.listed.length) {
    await logAction(a.actorId, 'ROWS_REPRICED', a.entity.type, a.entity.id, null, {
      reason: a.reason, repriced: plan.repriced.map((r) => ({ id: r.id, from: r.from, to: r.to })),
      listedForFinance: plan.listed.map((l) => ({ id: l.id, price: l.price, newPrice: l.newPrice, reason: l.reason })),
    }, a.ctx, tx);
  }
  const priced = plan.repriced.filter((r) => round2(r.from) !== round2(r.to));
  return {
    told: priced.map(({ next: _n, ...r }) => r),
    impact: { repriced: priced.length, listedForFinance: plan.listed.length, linesAffected: plan.repriced.length - priced.length, dueDatesMoved },
  };
}

/** After the commit: each family whose price changed is told the old and the new price (E7). */
export async function tellRepriced(lines: RepricedLine[], because: string) {
  if (!lines.length) return;
  const names = new Map((await db.select({ id: subject.id, name: subject.name }).from(subject)
    .where(inArray(subject.id, [...new Set(lines.map((l) => l.subjectId))]))).map((s) => [s.id, s.name]));
  for (const r of lines) {
    const subjectName = names.get(r.subjectId) ?? 'a subject';
    await createNotification(r.studentId, 'PRICE_CHANGED', `The price of ${subjectName} changed`,
      `${because}. ${subjectName} was ${formatEgp(r.from)} and is now ${formatEgp(r.to)}.`,
      { registrationId: r.id, from: r.from, to: r.to })
      .catch((err) => console.error('[setup] Price change notice failed:', err));
  }
}
