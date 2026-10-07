/**
 * Instalment plans (RESERVATIONS_REWORK.md §3.6, §3.10 item 6; Q-15's default, the owner's).
 *
 * A plan is a `plan.instalments` exception on one unpaid line (`registration_id`), its value the
 * schedule (dates and amounts summing to the line's price). Granting it creates one `instalment`
 * charge per row. Each instalment is paid as a charge payment — cash, card or InstaPay, never from
 * escrow — that credits the family's **held** wallet, earmarked for the line (ledger reason
 * `instalment`, related_registration_id = the line), so only that line's capture, settlement or
 * an instalment's own reversal ever debits it. The line stays `pending_payment`, due on the last
 * instalment's date.
 *
 * **Live** while the line is `pending_payment` and the exception `active`.
 *
 * **Capture** at the last instalment (in the confirming transaction): a new payment — purpose
 * `registration`, method and instrument `held_deposits`, amount 0, escrow applied = the line's
 * price debited from the line's deposits (`plan_capture`, with the payment's id) — created and
 * confirmed at once (PLAN_CAPTURED, then PAYMENT_CONFIRMED and REGISTRATION_CONFIRMED), its
 * payment_registration row, the line confirmed and its receipt born naming the deposit slips, the
 * plan `used`. Never past the line's effective deadline; never reversible.
 *
 * **Settlement** when the line ends under a live plan — any expiry (the deadline sweep, the
 * session's close, an overdue expiry, ineligibility, an instalment payment failed on a line no
 * longer payable), the plan lapsing, or finance revoking it — as a drop on that day before the
 * entry is sent: the school keeps `min(deposits, price − refundFor(line, at))` (`plan_forfeit`) and
 * the rest goes to free escrow (`plan_release`); nothing more is owed; the unpaid instalments are
 * cancelled; PLAN_SETTLED and the family told, all in the ending's own transaction. A line never
 * confirmed was never sent, so its board fee counts as not sent. "Release in full" (finance's
 * revocation that keeps the line payable) releases every deposit instead.
 *
 * Lock order (docs/features/RESERVATIONS_MONEY.md §4): [a payment] → the student → the line → the
 * plan exception → its charges → the wallet. An open instalment payment of a plan that ended is
 * never failed inside the ending (a payment is locked before a line everywhere): the deadline
 * sweep fails it afterwards (`failPayment`, reason plan_ended), and confirmation refuses it.
 */

import {
  db, exception, charge, registration, registrationSession, payment, paymentRegistration, notification, parentStudentLink, subject,
  and, eq, inArray, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type { InstalmentRowType, NotificationType } from '@repo/validations';
import { logAction, logActions, type AuditContext } from './audit.services';
import { getOrCreateEscrow, earmarkedHeld, debitHeld, creditEscrow, creditHeld } from './escrow.services';
import { refundFor } from './refund.services';
import { effectiveDeadlineFor, dueDateFor } from './deadline.services';
import { createReceiptsForRegistrations } from './receipt.services';
import { schoolDate } from './window.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class PlanError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const OPEN = ['pending', 'pending_verification'] as const;

/** The plan exception of a line (active), locked as asked. */
export async function planOfLine(executor: Executor, lineId: string, lock?: 'share' | 'update') {
  const q = executor.select().from(exception)
    .where(and(eq(exception.policyKey, 'plan.instalments'), eq(exception.registrationId, lineId), eq(exception.status, 'active')))
    .orderBy(asc(exception.createdAt));
  const [row] = lock ? await q.for(lock) : await q;
  return row ?? null;
}

/**
 * SQL: the line (a column or value) has its **last** instalment payment being checked — an
 * InstaPay transfer referenced and awaiting finance that covers every instalment of its plan still
 * unpaid. The session's close and the eligibility clean-up spare such a line, as they spare a line
 * whose checkout's transfer is being checked (§3.6): the family may already have paid in full.
 */
export const lastInstalmentBeingCheckedSql = (line: unknown) => sql`exists (
  select 1 from payment p
  join payment_charge pc on pc.payment_id = p.id
  join charge c on c.id = pc.charge_id
  where c.registration_id = ${line} and c.kind = 'instalment' and p.status = 'pending_verification'
    and not exists (
      select 1 from charge c2
      where c2.plan_exception_id = c.plan_exception_id and c2.status in ('requested', 'pending_payment')
        and not exists (select 1 from payment_charge pc2 where pc2.charge_id = c2.id and pc2.payment_id = p.id)))`;

/** A line's deposits still held (its plan's instalments, net of every plan debit). */
export async function depositsOfLine(executor: Executor, studentId: string, lineId: string) {
  const account = await getOrCreateEscrow(studentId, executor);
  return earmarkedHeld(executor, account.id, lineId);
}

/** In-app notices written in the money transaction, so the family hears of exactly what committed. */
async function tellFamily(tx: Tx, studentId: string, type: NotificationType, title: string, body: string, data: Record<string, unknown>) {
  const parents = await tx.select({ id: parentStudentLink.parentId }).from(parentStudentLink)
    .where(and(eq(parentStudentLink.studentId, studentId), eq(parentStudentLink.status, 'approved')));
  const ids = [...new Set([studentId, ...parents.map((p) => p.id)])];
  await tx.insert(notification).values(ids.map((userId) => ({ id: randomUUID(), userId, type, title, body, data })));
}
export { tellFamily };

async function subjectNameOf(executor: Executor, lineId: string) {
  const [r] = await executor.select({ name: subject.name }).from(registration).innerJoin(subject, eq(subject.id, registration.subjectId)).where(eq(registration.id, lineId));
  return r?.name ?? 'the subject';
}

// ─── Grant ───────────────────────────────────────────────────────────────────

/**
 * The plan's checks and its instalment charges, in the grant's transaction (exception.services),
 * after it has locked the student and the line and inserted the exception. Refused: a line not
 * awaiting payment, a provisional board fee, an open checkout, a plan already live, a schedule that
 * does not sum to the price, dates not increasing, the first in the past, the last after the
 * earlier of the session's end and the line's effective deadline.
 */
export async function grantPlanInTx(tx: Tx, a: { planId: string; lineId: string; schedule: InstalmentRowType[]; actorId: string; ctx?: AuditContext; now?: Date }) {
  const now = a.now ?? new Date();
  const [line] = await tx.select().from(registration).where(eq(registration.id, a.lineId));
  if (!line) throw new PlanError('That line was not found', 404);
  if (line.status !== 'pending_payment') throw new PlanError('A plan is for a line awaiting payment');
  if (line.priceProvisional) throw new PlanError('The board fee of this line is still provisional: a plan waits until it is confirmed (it would split a price that may change)');
  const open = await tx.select({ id: payment.id }).from(paymentRegistration).innerJoin(payment, eq(payment.id, paymentRegistration.paymentId))
    .where(and(eq(paymentRegistration.registrationId, a.lineId), inArray(payment.status, [...OPEN])));
  if (open.length) throw new PlanError('This line has a checkout in progress: confirm or cancel it before a plan', 409);
  const live = await tx.select({ id: exception.id }).from(exception)
    .where(and(eq(exception.policyKey, 'plan.instalments'), eq(exception.registrationId, a.lineId), eq(exception.status, 'active'), sql`${exception.id} <> ${a.planId}`));
  if (live.length) throw new PlanError('This line already has a plan', 409);

  const rows = [...a.schedule].map((r) => ({ dueAt: new Date(r.dueAt), amount: round2(r.amount) }));
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  if (Math.abs(total - line.priceAtRegistration) > 0.001) {
    throw new PlanError(`The instalments add up to EGP ${total.toFixed(2)}; the line costs EGP ${line.priceAtRegistration.toFixed(2)}`);
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.dueAt <= rows[i - 1]!.dueAt) throw new PlanError('Each instalment falls after the one before it');
  }
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (rows[0]!.dueAt < dayStart) throw new PlanError('The first instalment is not in the past');
  const [sess] = await tx.select({ endDate: registrationSession.endDate }).from(registrationSession).where(eq(registrationSession.id, line.sessionId));
  const deadline = await effectiveDeadlineFor(tx, line);
  const cap = deadline.at && sess && deadline.at < sess.endDate ? deadline.at : sess?.endDate ?? deadline.at;
  const last = rows[rows.length - 1]!.dueAt;
  if (cap && last > cap) {
    throw new PlanError(`The last instalment is due by ${schoolDate(cap)} at the latest (the earlier of the session's end and the line's deadline)`);
  }

  const name = await subjectNameOf(tx, a.lineId);
  const made = rows.map((r, i) => ({
    id: randomUUID(),
    studentId: line.studentId,
    kind: 'instalment',
    registrationId: line.id,
    boardSeriesId: line.boardSeriesId,
    description: `Instalment ${i + 1} of ${rows.length} — ${name}`,
    amount: r.amount,
    dueAt: r.dueAt,
    status: 'pending_payment',
    planExceptionId: a.planId,
    instalmentNo: i + 1,
    createdBy: a.actorId,
    reason: 'instalment plan',
  }));
  await tx.insert(charge).values(made);
  await logActions(made.map((c) => ({
    userId: a.actorId, action: 'CHARGE_CREATED' as const, entityType: 'charge' as const, entityId: c.id, previousData: null,
    newData: { kind: 'instalment', registrationId: c.registrationId, planId: a.planId, instalmentNo: c.instalmentNo, amount: c.amount, dueAt: c.dueAt.toISOString() },
  })), tx);

  // The line is due on the last instalment's date (the adapter answers it to dueDateFor).
  const due = await dueDateFor(tx, { kind: 'line', lineId: line.id });
  if (due.getTime() !== line.dueAt.getTime()) {
    await tx.update(registration).set({ dueAt: due, updatedAt: now }).where(eq(registration.id, line.id));
    await logAction(a.actorId, 'LINE_DUE_MOVED', 'registration', line.id, { dueAt: line.dueAt.toISOString() }, { dueAt: due.toISOString(), reason: 'instalment plan granted' }, a.ctx, tx);
  }
  await tellFamily(tx, line.studentId, 'PLAN_UPDATED', `${name}: payment in ${rows.length} instalments`,
    `The school agreed a plan for ${name}: ${rows.map((r, i) => `${i + 1}. EGP ${r.amount.toFixed(2)} by ${schoolDate(r.dueAt)}`).join('; ')}. Each instalment is held for this subject; it is paid from them at the last.`,
    { registrationId: line.id, planId: a.planId });
  return { charges: made.map((c) => ({ id: c.id, instalmentNo: c.instalmentNo, amount: c.amount, dueAt: c.dueAt })) };
}

// ─── Settlement ──────────────────────────────────────────────────────────────

export type PlanSettlement = {
  lineId: string; planId: string; deposits: number; kept: number; released: number; refundPercent: number | null; cancelledCharges: number;
};

/**
 * Settle a line's plan in the ending's transaction (the line already locked by the caller).
 * `cause`: the line expired (any reason), the plan lapsed, finance revoked it (the line expires
 * too), or finance released it in full (the line stays payable). The plan's own row is locked
 * here; `planId` names it when the caller has just changed its status (a revocation).
 */
export async function settlePlanInTx(
  tx: Tx,
  a: { lineId: string; cause: 'expired' | 'lapsed' | 'revoked' | 'released_in_full'; at: Date; actorId: string | null; planId?: string; detail?: string; ctx?: AuditContext },
): Promise<PlanSettlement | null> {
  const [plan] = await tx.select().from(exception)
    .where(a.planId
      ? eq(exception.id, a.planId)
      : and(eq(exception.policyKey, 'plan.instalments'), eq(exception.registrationId, a.lineId), eq(exception.status, 'active')))
    .for('update');
  if (!plan || plan.policyKey !== 'plan.instalments') return null;
  // Settled once. Found by its line, a plan is live (active); named by a caller that has just
  // revoked or lapsed it, it must not have been settled already.
  if (!a.planId && plan.status !== 'active') return null;
  if (a.planId) {
    const [done] = await tx.execute(sql`select 1 from audit_log where action = 'PLAN_SETTLED' and new_data->>'planId' = ${plan.id} limit 1`).then((r) => r.rows);
    if (done) return null;
  }
  const [line] = await tx.select().from(registration).where(eq(registration.id, a.lineId));
  if (!line) return null;

  const deposits = await depositsOfLine(tx, line.studentId, line.id);
  let kept = 0;
  let refundPercent: number | null = null;
  if (a.cause !== 'released_in_full' && deposits > 0) {
    // What a paid drop that day, before the entry is sent, would give back (§3.9): a line never
    // confirmed was never sent.
    const q = await refundFor(tx, line.id, a.at, { neverSent: true });
    refundPercent = q.percent;
    kept = round2(Math.max(0, Math.min(deposits, line.priceAtRegistration - q.amount)));
  }
  const released = round2(deposits - kept);
  if (kept > 0) {
    await debitHeld({ studentId: line.studentId, amount: kept, reason: 'plan_forfeit', initiatedBy: a.actorId ?? line.studentId, relatedRegistrationId: line.id }, tx);
  }
  if (released > 0) {
    await debitHeld({ studentId: line.studentId, amount: released, reason: 'plan_release', initiatedBy: a.actorId ?? line.studentId, relatedRegistrationId: line.id }, tx);
    await creditEscrow({ studentId: line.studentId, amount: released, reason: 'plan_release', initiatedBy: a.actorId ?? line.studentId, relatedRegistrationId: line.id }, tx);
  }
  const cancelled = await tx.update(charge)
    .set({ status: 'cancelled', cancelledAt: a.at, cancelledBy: a.actorId, cancelReason: 'The instalment plan ended', updatedAt: a.at })
    .where(and(eq(charge.planExceptionId, plan.id), inArray(charge.status, ['requested', 'pending_payment'])))
    .returning({ id: charge.id });
  // A plan found by its line ended with it (any expiry): it lapsed. A caller that named the plan
  // (a revocation, a release in full, the lapse step) has already set its status.
  if (!a.planId) {
    await tx.update(exception).set({ status: 'lapsed', updatedAt: a.at })
      .where(and(eq(exception.id, plan.id), eq(exception.status, 'active')));
  }
  const out: PlanSettlement = { lineId: line.id, planId: plan.id, deposits, kept, released, refundPercent, cancelledCharges: cancelled.length };
  await logAction(a.actorId, 'PLAN_SETTLED', 'registration', line.id, { planId: plan.id, deposits },
    { ...out, cause: a.cause, detail: a.detail ?? null, price: line.priceAtRegistration, at: a.at.toISOString(), cancelledChargeIds: cancelled.map((c) => c.id) }, a.ctx, tx);
  const name = await subjectNameOf(tx, line.id);
  await tellFamily(tx, line.studentId, 'PLAN_UPDATED', `${name}: the instalment plan ended`,
    a.cause === 'released_in_full'
      ? `The instalment plan for ${name} was ended by the school and every deposit (EGP ${released.toFixed(2)}) is back in the escrow balance. ${name} can still be paid in full.`
      : `The instalment plan for ${name} ended (${a.detail ?? a.cause}). Of the EGP ${deposits.toFixed(2)} paid in, EGP ${released.toFixed(2)} is back in the escrow balance and the school keeps EGP ${kept.toFixed(2)} — what a paid drop that day would have kept. Nothing more is owed.`,
    { registrationId: line.id, planId: plan.id, kept, released });
  return out;
}

/**
 * Lines a system expiry just ended: each one's live plan settled, in the expiry's transaction
 * (expiry.services calls it for every cause).
 */
export async function settlePlansOfExpiredLines(tx: Tx, lineIds: string[], at: Date, detail: string) {
  if (!lineIds.length) return [];
  const withPlans = await tx.select({ lineId: exception.registrationId }).from(exception)
    .where(and(eq(exception.policyKey, 'plan.instalments'), inArray(exception.registrationId, lineIds), eq(exception.status, 'active')))
    .orderBy(asc(exception.registrationId));
  const out: PlanSettlement[] = [];
  for (const { lineId } of withPlans) {
    const s = await settlePlanInTx(tx, { lineId: lineId!, cause: 'expired', at, actorId: null, detail });
    if (s) out.push(s);
  }
  return out;
}

// ─── Instalments confirmed, and the capture ──────────────────────────────────

/**
 * An instalment payment confirmed (confirmPayment's transaction, the payment, the line, the plan
 * and the charges locked in that order): its money goes to the held wallet earmarked for the line,
 * with a deposit slip; when every instalment is paid, the plan is captured into the line's payment.
 */
export async function instalmentsConfirmedInTx(
  tx: Tx,
  a: { payment: { id: string; studentId: string; parentId: string; amount: number }; lineId: string; planId: string; chargeIds: string[]; actorId: string | null; ctx?: AuditContext; now: Date },
) {
  const slip = `DEP-${a.payment.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  if (a.payment.amount > 0) {
    await creditHeld({ studentId: a.payment.studentId, amount: a.payment.amount, reason: 'instalment', initiatedBy: a.actorId ?? a.payment.parentId, relatedRegistrationId: a.lineId, relatedPaymentId: a.payment.id }, tx);
  }
  await tx.update(payment).set({ metadata: sql`coalesce(${payment.metadata}, '{}'::jsonb) || ${JSON.stringify({ depositSlip: slip, planId: a.planId, registrationId: a.lineId })}::jsonb` })
    .where(eq(payment.id, a.payment.id));
  const left = await tx.select({ id: charge.id }).from(charge)
    .where(and(eq(charge.planExceptionId, a.planId), inArray(charge.status, ['requested', 'pending_payment'])));
  if (left.length) return { slip, captured: null };
  const captured = await capturePlanInTx(tx, { lineId: a.lineId, planId: a.planId, payerParentId: a.payment.parentId, actorId: a.actorId, ctx: a.ctx, now: a.now });
  return { slip, captured };
}

/** The plan's capture (§3.6, §3.10 item 6): a new payment from the line's held deposits. */
export async function capturePlanInTx(
  tx: Tx,
  a: { lineId: string; planId: string; payerParentId: string; actorId: string | null; ctx?: AuditContext; now: Date },
) {
  const [line] = await tx.select().from(registration).where(eq(registration.id, a.lineId));
  if (!line || line.status !== 'pending_payment') throw new PlanError('This line is no longer awaiting payment: its plan cannot be captured', 409);
  const d = await effectiveDeadlineFor(tx, line);
  if (d.at && d.at <= a.now) throw new PlanError(`The line's deadline (${schoolDate(d.at)}) has passed: it cannot be paid now`, 409);
  const held = await depositsOfLine(tx, line.studentId, line.id);
  if (Math.abs(held - line.priceAtRegistration) > 0.001) {
    throw new PlanError(`The deposits held for this line (EGP ${held.toFixed(2)}) are not its price (EGP ${line.priceAtRegistration.toFixed(2)})`, 409);
  }
  const slips = (await tx.execute(sql`
    select distinct p.metadata->>'depositSlip' as slip from payment p
    join payment_charge pc on pc.payment_id = p.id join charge c on c.id = pc.charge_id
    where c.plan_exception_id = ${a.planId} and p.status = 'completed' and p.metadata ? 'depositSlip' order by 1`)).rows.map((r) => (r as { slip: string }).slip);

  const id = randomUUID();
  const [made] = await tx.insert(payment).values({
    id,
    studentId: line.studentId,
    parentId: a.payerParentId,
    amount: 0,
    escrowAmountApplied: line.priceAtRegistration,
    paymentMethod: 'held_deposits',
    instrumentUsed: 'held_deposits',
    purpose: 'registration',
    status: 'completed',
    confirmedAt: a.now,
    confirmedBy: a.actorId,
    externalReference: `PLAN-${id.slice(0, 8).toUpperCase()}`,
    metadata: { planCapture: { planId: a.planId, depositSlips: slips } },
  }).returning();
  await debitHeld({ studentId: line.studentId, amount: line.priceAtRegistration, reason: 'plan_capture', initiatedBy: a.actorId ?? line.studentId, relatedRegistrationId: line.id, relatedPaymentId: id }, tx);
  await tx.insert(paymentRegistration).values({ id: randomUUID(), paymentId: id, registrationId: line.id });
  const [confirmed] = await tx.update(registration).set({ status: 'confirmed', updatedAt: a.now })
    .where(and(eq(registration.id, line.id), eq(registration.status, 'pending_payment'))).returning({ id: registration.id });
  if (!confirmed) throw new PlanError('This line changed while its plan was being captured', 409);
  await createReceiptsForRegistrations([line.id], tx);
  await tx.execute(sql`update receipt set notes = ${`Paid from instalments: deposit slips ${slips.join(', ')}`} where registration_id = ${line.id} and status = 'pending_issue'`);
  await tx.update(exception).set({ status: 'used', usedAt: a.now, usedFor: { registrationIds: [line.id] }, updatedAt: a.now })
    .where(and(eq(exception.id, a.planId), eq(exception.status, 'active')));
  // The capture is the payment's creation; it is confirmed in the same breath (09 counts both).
  await logAction(a.actorId, 'PLAN_CAPTURED', 'payment', id, null,
    { registrationId: line.id, planId: a.planId, heldCaptured: line.priceAtRegistration, depositSlips: slips }, a.ctx, tx);
  await logAction(a.actorId, 'PAYMENT_CONFIRMED', 'payment', id, { status: 'pending' },
    { status: 'completed', instrumentUsed: 'held_deposits', notes: 'Paid from the plan\'s instalments' }, a.ctx, tx);
  await logAction(a.actorId, 'REGISTRATION_CONFIRMED', 'registration', line.id, null, { paymentId: id, planId: a.planId }, a.ctx, tx);
  const name = await subjectNameOf(tx, line.id);
  await tellFamily(tx, line.studentId, 'PLAN_UPDATED', `${name} is paid`,
    `The last instalment arrived: ${name} is paid in full from the instalments (EGP ${line.priceAtRegistration.toFixed(2)}). Its receipt is ready at the finance desk.`,
    { registrationId: line.id, paymentId: id });
  return { paymentId: made!.id, amount: line.priceAtRegistration, depositSlips: slips };
}
