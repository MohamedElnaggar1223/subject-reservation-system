/**
 * Charges (RESERVATIONS_REWORK.md §3.6, §3.10; docs/features/RESERVATIONS_MONEY.md §2).
 *
 * A charge is anything a family owes that is not a line, a remark fee or the school fee itself:
 * a board service on a line or a student (cash-in, late cash-in, certificate split — a family may
 * ask for one where the service allows: `requested` until staff accept it), a late entry fee
 * (only when Q-20 is answered yes: the setting exceptions.boardEntryDeadline), the school fee
 * pushed into the family's pending payments (school-fee.services), an instalment of a plan
 * (plan.services), a price adjustment (finance's explicit act after a fee change or a
 * verification) or a custom charge.
 *
 * `chargeRules(tx, charge)` is the hook asked at creation, acceptance and payment: the charge's
 * deadline (an instalment: its line's effective deadline; a board service: its series' service
 * deadline) and the price exceptions scoped to the charge (never a push's or an instalment's).
 *
 * Money: paid in a payment of purpose `charge` (payment.services); receipted per charge (an
 * instalment issues a deposit slip); reversible (MO-11); refundable to escrow (`charge_refund`, at
 * most its amount, finance with a reason, the paper receipt back first). The sweep closes an
 * unpaid service charge at its service deadline (payment.services).
 */

import {
  db, charge, boardService, boardServiceFee, boardServiceDeadline, boardSeries, registration, subject, payment, paymentCharge, receipt,
  remarkFeeSchedule, parentStudentLink, user, examBoard,
  and, eq, inArray, sql, asc, desc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  CHARGE_KIND_LABELS, SERVICE_CHARGE_KINDS, serviceLevelOf, seriesLabel,
  type CreateChargeType, type ListChargesQueryType, type RefundChargeType, type ServiceLevel,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { getSetting } from './settings.services';
import { dueDateFor, effectiveDeadlineFor } from './deadline.services';
import { activeExceptions, type RegistryScope } from './exception-registry.services';
import { creditEscrow } from './escrow.services';
import { tellFamily } from './plan.services';
import { schoolDate } from './window.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;
export type ChargeRow = typeof charge.$inferSelect;

export class ChargeError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const OPEN = ['pending', 'pending_verification'] as const;
const STAFF = ['admin', 'finance_officer', 'finance_admin'] as const;
const FINANCE_DECIDES = ['admin', 'finance_admin'] as const;

// ─── Deadlines and fees ──────────────────────────────────────────────────────

/** A charge's deadline (§3.10 items 1 and 4): an instalment's line's, a board service's series', else none. */
export async function chargeDeadline(executor: Executor, c: Pick<ChargeRow, 'kind' | 'registrationId' | 'boardSeriesId' | 'boardServiceId'>): Promise<Date | null> {
  if (c.kind === 'instalment' && c.registrationId) {
    const [l] = await executor.select({ boardSeriesId: registration.boardSeriesId, attempt: registration.attempt, priorSittingSeriesId: registration.priorSittingSeriesId })
      .from(registration).where(eq(registration.id, c.registrationId));
    return l ? (await effectiveDeadlineFor(executor, l)).at : null;
  }
  if (c.boardSeriesId && c.boardServiceId) {
    const [d] = await executor.select({ deadline: boardServiceDeadline.deadline }).from(boardServiceDeadline)
      .where(and(eq(boardServiceDeadline.boardSeriesId, c.boardSeriesId), eq(boardServiceDeadline.boardServiceId, c.boardServiceId)));
    return d?.deadline ?? null;
  }
  return null;
}

/** The SQL of a charge row's deadline (alias `c`), shared by the grouping, the sweep and 09. */
export const chargeDeadlineSql = (alias = 'c') =>
  sql.raw(`charge_effective_deadline(${alias}.kind, ${alias}.registration_id, ${alias}.board_series_id, ${alias}.board_service_id)`);

async function seriesName(executor: Executor, seriesId: string) {
  const [s] = await executor.select({ month: boardSeries.month, year: boardSeries.year, label: boardSeries.label, board: examBoard.name })
    .from(boardSeries).innerJoin(examBoard, eq(examBoard.code, boardSeries.boardCode)).where(eq(boardSeries.id, seriesId));
  return s ? `${s.board} ${seriesLabel(s.month, s.year)}${s.label ? ` (${s.label})` : ''}` : 'its series';
}

/**
 * A board service's fee in a series at a level (the series' grid). A series with none yet takes
 * the V3 defaults (remark_fee_schedule, per board and service type) — copied in as a provisional
 * row, audited — "the default a new series copies" (§3.6). None at all: refused with where to set it.
 */
export async function serviceFeeFor(tx: Tx, a: { seriesId: string; serviceId: string; level: ServiceLevel; actorId: string | null }) {
  const [svc] = await tx.select().from(boardService).where(eq(boardService.id, a.serviceId));
  if (!svc) throw new ChargeError('That board service was not found', 404);
  const rows = await tx.select().from(boardServiceFee)
    .where(and(eq(boardServiceFee.boardSeriesId, a.seriesId), eq(boardServiceFee.boardServiceId, a.serviceId)));
  const exact = rows.find((r) => r.level === a.level) ?? (svc.levelRates ? undefined : rows[0]);
  if (exact) return { service: svc, amount: exact.amount, provisional: exact.provisional, feeId: exact.id, level: exact.level as ServiceLevel };
  const [def] = svc.legacyServiceType
    ? await tx.select().from(remarkFeeSchedule).where(and(eq(remarkFeeSchedule.council, svc.boardCode), eq(remarkFeeSchedule.serviceType, svc.legacyServiceType)))
    : [];
  if (!def) throw new ChargeError(`${svc.label} has no fee in ${await seriesName(tx, a.seriesId)} yet — set it on the Board services page`);
  const id = randomUUID();
  const [made] = await tx.insert(boardServiceFee).values({
    id, boardSeriesId: a.seriesId, boardServiceId: a.serviceId, level: a.level, amount: def.amountPerPaper, provisional: true, copiedFromDefault: true, createdBy: a.actorId,
  }).onConflictDoNothing().returning();
  if (made) {
    await logAction(a.actorId, 'SERVICE_FEE_DEFAULT_COPIED', 'board_service', a.serviceId, null,
      { fee: id, boardSeriesId: a.seriesId, level: a.level, amount: def.amountPerPaper, provisional: true, from: 'remark_fee_schedule' }, undefined, tx);
    return { service: svc, amount: made.amount, provisional: true, feeId: made.id, level: a.level };
  }
  const [again] = await tx.select().from(boardServiceFee)
    .where(and(eq(boardServiceFee.boardSeriesId, a.seriesId), eq(boardServiceFee.boardServiceId, a.serviceId), eq(boardServiceFee.level, a.level)));
  return { service: svc, amount: again!.amount, provisional: again!.provisional, feeId: again!.id, level: a.level };
}

// ─── The hook ────────────────────────────────────────────────────────────────

type ChargeBasis = { base: number; exceptionIds: string[]; feeId?: string; provisional?: boolean; baseDueAt?: string };

/**
 * A charge's due date (dueDateFor, §6): its own date (the one it was added with), a later one when
 * it was added after it, a deadline.payment exception for it, capped by its deadline. Re-dated in
 * the caller's transaction when such an exception is granted or revoked.
 */
export async function chargeDueAt(executor: Executor, c: ChargeRow) {
  const basis = (c.pricingBasis as ChargeBasis | null) ?? { base: c.amount, exceptionIds: [] };
  const scope: RegistryScope = { chargeId: c.id, ...(c.registrationId ? { registrationId: c.registrationId } : {}) };
  return dueDateFor(executor, {
    kind: 'charge', studentId: c.studentId, baseDueAt: basis.baseDueAt ? new Date(basis.baseDueAt) : c.dueAt, reservedAt: c.createdAt,
    cap: await chargeDeadline(executor, c), scope,
  });
}

/** Re-date one open charge (locked here), audited when it moved. */
export async function redateChargeInTx(tx: Tx, chargeId: string, actorId: string | null) {
  const [c] = await tx.select().from(charge).where(eq(charge.id, chargeId)).for('update');
  if (!c || (c.status !== 'requested' && c.status !== 'pending_payment')) return 0;
  const due = await chargeDueAt(tx, c);
  if (due.getTime() === c.dueAt.getTime()) return 0;
  await tx.update(charge).set({ dueAt: due, updatedAt: new Date() }).where(eq(charge.id, chargeId));
  await logAction(actorId, 'LINE_DUE_MOVED', 'charge', chargeId, { dueAt: c.dueAt.toISOString() }, { dueAt: due.toISOString(), reason: 'a payment due-date exception' }, undefined, tx);
  return 1;
}

/**
 * chargeRules (§6): asked at a charge's creation, acceptance and payment, in that transaction.
 * Refuses past the charge's deadline; applies the price exceptions scoped to this charge, in V3's
 * order (a custom price, then percent discounts, then a fixed one), to its base amount — never to
 * a pushed school fee (its amount is the schedule's; the waiver is the exception) nor an
 * instalment (its amounts are the plan's). Returns the amount the charge costs now.
 */
export async function chargeRules(tx: Tx, c: ChargeRow, now: Date = new Date()) {
  const deadline = await chargeDeadline(tx, c);
  if (deadline && deadline <= now) {
    throw new ChargeError(c.kind === 'instalment'
      ? `The line's deadline (${schoolDate(deadline)}) has passed: this instalment can no longer be paid`
      : `The board's deadline for this service (${schoolDate(deadline)}) has passed`, 409);
  }
  if (c.kind === 'school_fee_push' || c.kind === 'instalment') return { amount: c.amount, deadline, exceptionIds: [] as string[] };
  const basis = (c.pricingBasis as ChargeBasis | null) ?? { base: c.amount, exceptionIds: [] };
  const exc = (await activeExceptions(tx, c.studentId, ['price.custom', 'price.discountPercent', 'price.discountFixed'], { chargeId: c.id }))
    .filter((e) => e.scope.chargeId === c.id && e.value != null);
  let amount = round2(basis.base);
  const custom = exc.find((e) => e.policyKey === 'price.custom');
  if (custom) amount = round2(custom.value!);
  for (const e of exc.filter((x) => x.policyKey === 'price.discountPercent')) amount = round2(amount * (1 - e.value! / 100));
  for (const e of exc.filter((x) => x.policyKey === 'price.discountFixed')) amount = round2(Math.max(0, amount - e.value!));
  return { amount, deadline, exceptionIds: exc.map((e) => e.id), base: basis.base };
}

/** Apply chargeRules' amount to an open charge (locked by the caller), audited when it changed. */
export async function repriceChargeInTx(tx: Tx, c: ChargeRow, actorId: string | null, ctx?: AuditContext) {
  const r = await chargeRules(tx, c);
  if (Math.abs(r.amount - c.amount) < 0.001) return c;
  const basis = { ...((c.pricingBasis as ChargeBasis | null) ?? { base: c.amount }), exceptionIds: r.exceptionIds };
  const [next] = await tx.update(charge).set({ amount: r.amount, pricingBasis: basis, updatedAt: new Date() }).where(eq(charge.id, c.id)).returning();
  await logAction(actorId, 'CHARGE_REPRICED', 'charge', c.id, { amount: c.amount }, { amount: r.amount, exceptionIds: r.exceptionIds }, ctx, tx);
  return next!;
}

// ─── Who may act ─────────────────────────────────────────────────────────────

async function linked(executor: Executor, parentId: string, studentId: string) {
  const [l] = await executor.select({ id: parentStudentLink.id }).from(parentStudentLink)
    .where(and(eq(parentStudentLink.parentId, parentId), eq(parentStudentLink.studentId, studentId), eq(parentStudentLink.status, 'approved')));
  return !!l;
}

/** The students a viewer may see the charges of (staff: any). */
export async function chargeStudentsFor(viewer: { id: string; role: string | null | undefined }, studentId?: string): Promise<string[] | 'any'> {
  if ((STAFF as readonly string[]).includes(viewer.role ?? '')) return studentId ? [studentId] : 'any';
  if (viewer.role === 'student') {
    if (studentId && studentId !== viewer.id) throw new ChargeError('You can only see your own charges', 403);
    return [viewer.id];
  }
  if (viewer.role === 'parent') {
    const kids = (await db.select({ id: parentStudentLink.studentId }).from(parentStudentLink)
      .where(and(eq(parentStudentLink.parentId, viewer.id), eq(parentStudentLink.status, 'approved')))).map((k) => k.id);
    if (studentId && !kids.includes(studentId)) throw new ChargeError('You are not linked to this student', 403);
    return studentId ? [studentId] : kids;
  }
  throw new ChargeError('Forbidden', 403);
}

// ─── Create, accept, cancel ──────────────────────────────────────────────────

/**
 * Add a charge. Staff (the desk, finance, admin) add any kind but an instalment or a pushed fee;
 * a price adjustment or a custom charge is finance's decision (finance admin, admin), with its
 * amount and a reason. A family (the student, a linked parent) asks for a board service the board
 * lets families request: it waits as `requested` until staff accept it. A board service's amount
 * is its series' fee at the line's level.
 */
export async function createCharge(data: CreateChargeType, actor: { id: string; role: string | null | undefined }, ctx?: AuditContext) {
  const isStaff = (STAFF as readonly string[]).includes(actor.role ?? '');
  const isFamily = actor.role === 'parent' || actor.role === 'student';
  if (!isStaff && !isFamily) throw new ChargeError('Forbidden', 403);
  if (isFamily) {
    if (!(SERVICE_CHARGE_KINDS as readonly string[]).includes(data.kind)) throw new ChargeError('A family may ask for a board service only', 403);
    if (actor.role === 'student' && data.studentId !== actor.id) throw new ChargeError('You can only ask for your own', 403);
    if (actor.role === 'parent' && !(await linked(db, actor.id, data.studentId))) throw new ChargeError('You are not linked to this student', 403);
  }
  if ((data.kind === 'price_adjustment' || data.kind === 'custom') && !(FINANCE_DECIDES as readonly string[]).includes(actor.role ?? '')) {
    throw new ChargeError(`Only a finance admin or an admin may add a ${CHARGE_KIND_LABELS[data.kind].toLowerCase()}`, 403);
  }
  if (data.kind === 'late_entry_fee' && !(await getSetting('exceptions.boardEntryDeadline'))) {
    throw new ChargeError('Late entries are off: the board\'s entry deadline is a hard stop (owner question Q-20)', 409);
  }
  const [student] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, data.studentId));
  if (!student || student.role !== 'student') throw new ChargeError('Student not found', 404);
  const now = new Date();

  return db.transaction(async (tx) => {
    // The student first (the reservation's own lock, §6), then the line it concerns.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, data.studentId)).for('no key update');
    let line: typeof registration.$inferSelect | null = null;
    if (data.registrationId) {
      const [l] = await tx.select().from(registration).where(eq(registration.id, data.registrationId)).for('share');
      if (!l || l.studentId !== data.studentId) throw new ChargeError('That line is not this student\'s', 404);
      line = l;
    }
    if (data.kind === 'price_adjustment' && !line) throw new ChargeError('A price adjustment names the line it adjusts');

    let amount = data.amount ?? null;
    let level: ServiceLevel | null = null;
    let seriesId: string | null = data.boardSeriesId ?? line?.boardSeriesId ?? null;
    let serviceId: string | null = null;
    let feeId: string | undefined;
    let provisional = false;
    let description = data.description?.trim() || '';
    if ((SERVICE_CHARGE_KINDS as readonly string[]).includes(data.kind)) {
      if (!data.boardServiceId) throw new ChargeError('Choose the board service');
      if (!seriesId) throw new ChargeError('Choose the board series it is for');
      const [svc] = await tx.select().from(boardService).where(eq(boardService.id, data.boardServiceId));
      if (!svc || !svc.isActive) throw new ChargeError('That board service is not offered', 404);
      if (svc.kind !== data.kind) throw new ChargeError(`${svc.label} is not a ${CHARGE_KIND_LABELS[data.kind].toLowerCase()}`);
      if (isFamily && !svc.requestableByFamily) throw new ChargeError(`${svc.label} is asked for at the finance desk`, 403);
      const [s] = await tx.select({ boardCode: boardSeries.boardCode }).from(boardSeries).where(eq(boardSeries.id, seriesId));
      if (!s) throw new ChargeError('Board series not found', 404);
      if (s.boardCode !== svc.boardCode) throw new ChargeError(`${svc.label} is a service of another board than this series'`);
      const subjectLevel = line
        ? (await tx.select({ level: subject.qualificationLevel }).from(subject).where(eq(subject.id, line.subjectId)))[0]?.level ?? null
        : null;
      level = data.level ?? (line ? serviceLevelOf(subjectLevel) : 'as_a_level');
      const fee = await serviceFeeFor(tx, { seriesId, serviceId: svc.id, level, actorId: actor.id });
      amount = fee.amount;
      feeId = fee.feeId;
      provisional = fee.provisional;
      serviceId = svc.id;
      if (!description) description = `${svc.label} — ${await seriesName(tx, seriesId)}`;
    } else {
      if (amount === null) throw new ChargeError('Say how much it is');
      if (!description) description = CHARGE_KIND_LABELS[data.kind];
    }
    if (!isFamily && (data.kind === 'price_adjustment' || data.kind === 'custom') && !data.reason) {
      throw new ChargeError('A reason is required');
    }

    const id = randomUUID();
    const draft: ChargeRow = {
      id, studentId: data.studentId, kind: data.kind, registrationId: line?.id ?? null, boardSeriesId: seriesId, boardServiceId: serviceId,
      level, academicYear: null, description, amount: amount!, dueAt: now, status: isFamily ? 'requested' : 'pending_payment',
      planExceptionId: null, instalmentNo: null, refundAmount: null, refundedAt: null, refundedBy: null, refundReason: null,
      settledByPaymentId: null, requestedBy: isFamily ? actor.id : null, acceptedBy: isFamily ? null : actor.id, acceptedAt: isFamily ? null : now,
      cancelledBy: null, cancelledAt: null, cancelReason: null,
      pricingBasis: { base: amount!, exceptionIds: [], ...(feeId ? { feeId, provisional } : {}), ...(data.dueAt ? { baseDueAt: data.dueAt.toISOString() } : {}) },
      createdBy: actor.id, reason: data.reason ?? null, createdAt: now, updatedAt: now,
    };
    const rules = await chargeRules(tx, draft, now);
    const graceDays = await getSetting('payment.graceDays', tx);
    const base = data.dueAt ?? new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);
    draft.pricingBasis = { ...(draft.pricingBasis as ChargeBasis), baseDueAt: base.toISOString() };
    const scope: RegistryScope = { chargeId: id, ...(line ? { registrationId: line.id } : {}) };
    const dueAt = await dueDateFor(tx, { kind: 'charge', studentId: data.studentId, baseDueAt: base, reservedAt: now, cap: rules.deadline, scope });
    const [made] = await tx.insert(charge).values({ ...draft, dueAt }).returning();
    await logAction(actor.id, isFamily ? 'CHARGE_REQUESTED' : 'CHARGE_CREATED', 'charge', id, null,
      { kind: made!.kind, studentId: made!.studentId, registrationId: made!.registrationId, boardSeriesId: seriesId, boardServiceId: serviceId, level, amount: made!.amount, dueAt: dueAt.toISOString(), status: made!.status, reason: data.reason ?? null }, ctx, tx);
    if (!isFamily) {
      await tellFamily(tx, data.studentId, 'CHARGE_ADDED', `${description}: EGP ${made!.amount.toFixed(2)}`,
        `The school added ${description} (EGP ${made!.amount.toFixed(2)}), due by ${schoolDate(dueAt)}. Pay it in the app or at the finance desk.`, { chargeId: id });
    }
    return made!;
  });
}

/** Staff accept a family's request: it becomes payable at its fee, before the service's deadline. */
export async function acceptCharge(id: string, actor: { id: string }, reason: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(charge).where(eq(charge.id, id)).for('update');
    if (!c) throw new ChargeError('Charge not found', 404);
    if (c.status !== 'requested') throw new ChargeError(`This charge is ${c.status.replace('_', ' ')}, not a request awaiting the school`, 409);
    await chargeRules(tx, c);
    const [next] = await tx.update(charge).set({ status: 'pending_payment', acceptedBy: actor.id, acceptedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(charge.id, id), eq(charge.status, 'requested'))).returning();
    await logAction(actor.id, 'CHARGE_ACCEPTED', 'charge', id, { status: 'requested' }, { status: 'pending_payment', reason }, ctx, tx);
    const priced = await repriceChargeInTx(tx, next!, actor.id, ctx);
    await tellFamily(tx, c.studentId, 'CHARGE_ADDED', `${c.description}: accepted`,
      `The school accepted your request for ${c.description}: EGP ${priced.amount.toFixed(2)}, due by ${schoolDate(priced.dueAt)}.`, { chargeId: id });
    return priced;
  });
}

/**
 * Staff cancel a charge nothing has paid: a request, or one awaiting payment with no checkout in
 * progress. An instalment ends with its plan (revoke the plan); a paid charge is refunded instead.
 */
export async function cancelCharge(id: string, actor: { id: string }, reason: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(charge).where(eq(charge.id, id)).for('update');
    if (!c) throw new ChargeError('Charge not found', 404);
    if (c.kind === 'instalment') throw new ChargeError('An instalment ends with its plan: revoke the plan on the Exceptions page', 409);
    if (c.status !== 'requested' && c.status !== 'pending_payment') throw new ChargeError(`This charge is ${c.status.replace('_', ' ')}: a paid charge is refunded, not cancelled`, 409);
    const open = await tx.select({ id: payment.id }).from(paymentCharge).innerJoin(payment, eq(payment.id, paymentCharge.paymentId))
      .where(and(eq(paymentCharge.chargeId, id), inArray(payment.status, [...OPEN])));
    if (open.length) throw new ChargeError('A payment for this charge is in progress: confirm or reject it first', 409);
    const now = new Date();
    const [next] = await tx.update(charge).set({ status: 'cancelled', cancelledBy: actor.id, cancelledAt: now, cancelReason: reason, updatedAt: now })
      .where(and(eq(charge.id, id), inArray(charge.status, ['requested', 'pending_payment']))).returning();
    await logAction(actor.id, 'CHARGE_CANCELLED', 'charge', id, { status: c.status }, { status: 'cancelled', reason }, ctx, tx);
    await tellFamily(tx, c.studentId, 'CHARGE_UPDATED', `${c.description}: cancelled`, `The school cancelled ${c.description}: nothing is owed for it.`, { chargeId: id });
    return next!;
  });
}

/**
 * Finance refunds a paid charge to the family's escrow (a cash-in withdrawn before the board's
 * date, a price adjustment): at most what it cost, with a reason, audited in the transaction. The
 * paper receipt must be back first (a receipt with the family is refused; one still at the desk is
 * voided), as a reversal asks. Cash leaves the drawer only through a refund request afterwards.
 */
export async function refundCharge(id: string, actor: { id: string }, data: RefundChargeType, ctx?: AuditContext) {
  const out = await db.transaction(async (tx) => {
    // The receipt before its charge: the order a drop and a reversal lock receipt and line in (MA-16).
    const [rc] = await tx.select().from(receipt).where(eq(receipt.chargeId, id)).for('update');
    const [c] = await tx.select().from(charge).where(eq(charge.id, id)).for('update');
    if (!c) throw new ChargeError('Charge not found', 404);
    if (c.kind === 'instalment') throw new ChargeError('An instalment is held for its line: a plan is settled, or an instalment reversed, never refunded', 409);
    if (c.kind === 'school_fee_push') throw new ChargeError('A pushed school fee is paid and refunded through the school-fee payment', 409);
    if (c.status !== 'paid') throw new ChargeError(`Only a paid charge is refunded (this one is ${c.status.replace('_', ' ')})`, 409);
    if (data.amount > c.amount + 0.001) throw new ChargeError(`At most what it cost: EGP ${c.amount.toFixed(2)}`);
    if (rc && (rc.status === 'issued' || rc.status === 'return_required')) {
      throw new ChargeError(`Receipt ${rc.receiptNumber} is with the family — take it back (mark it returned) before refunding`, 409);
    }
    const [paid] = await tx.select({ id: payment.id }).from(paymentCharge).innerJoin(payment, eq(payment.id, paymentCharge.paymentId))
      .where(and(eq(paymentCharge.chargeId, id), eq(payment.status, 'completed')));
    const now = new Date();
    if (rc && rc.status === 'pending_issue') {
      await tx.update(receipt).set({ status: 'void', notes: `Voided — charge refunded: ${data.reason}`, updatedAt: now }).where(eq(receipt.id, rc.id));
    }
    const [next] = await tx.update(charge).set({ status: 'refunded', refundAmount: data.amount, refundedAt: now, refundedBy: actor.id, refundReason: data.reason, updatedAt: now })
      .where(and(eq(charge.id, id), eq(charge.status, 'paid'))).returning();
    await creditEscrow({ studentId: c.studentId, amount: data.amount, reason: 'charge_refund', initiatedBy: actor.id, relatedChargeId: id, ...(paid ? { relatedPaymentId: paid.id } : {}) }, tx);
    await logAction(actor.id, 'CHARGE_REFUNDED', 'charge', id, { status: 'paid' }, { status: 'refunded', refundAmount: data.amount, reason: data.reason, paymentId: paid?.id ?? null }, ctx, tx);
    await tellFamily(tx, c.studentId, 'CHARGE_UPDATED', `${c.description}: refunded`,
      `EGP ${data.amount.toFixed(2)} for ${c.description} is back in the escrow balance (${data.reason}). Use it for a later payment or ask for it at the finance desk.`, { chargeId: id });
    return next!;
  });
  return out;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const chargeColumns = {
  id: true, studentId: true, kind: true, registrationId: true, boardSeriesId: true, boardServiceId: true, level: true, academicYear: true,
  description: true, amount: true, dueAt: true, status: true, planExceptionId: true, instalmentNo: true, refundAmount: true, refundedAt: true,
  refundReason: true, settledByPaymentId: true, requestedBy: true, acceptedAt: true, cancelledAt: true, cancelReason: true, reason: true, createdAt: true,
} as const;

/** Charges a viewer may see (staff: any student's; a parent: their children's; a student: their own). */
export async function listCharges(filters: ListChargesQueryType, viewer: { id: string; role: string | null | undefined }) {
  const students = await chargeStudentsFor(viewer, filters.studentId);
  if (students !== 'any' && students.length === 0) return [];
  const rows = await db.query.charge.findMany({
    where: (c, { and: a, eq: e, inArray: inArr }) => {
      const conds = [];
      if (students !== 'any') conds.push(inArr(c.studentId, students));
      if (filters.status) conds.push(e(c.status, filters.status));
      if (filters.kind) conds.push(e(c.kind, filters.kind));
      // A session's charges: its lines' and the services asked in the series its items sit in.
      if (filters.sessionId) {
        conds.push(sql`(${c.registrationId} in (select r.id from registration r where r.session_id = ${filters.sessionId})
          or ${c.boardSeriesId} in (select i.board_series_id from session_offer_item i where i.session_id = ${filters.sessionId} and i.board_series_id is not null))`);
      }
      return conds.length ? a(...conds) : undefined;
    },
    columns: chargeColumns,
    with: {
      // The family (the approved parents): the desk and the Charges screen group by it.
      student: {
        columns: { id: true, name: true },
        with: { linkRequestsAsStudent: { where: (l, { eq: e }) => e(l.status, 'approved'), columns: { id: true }, with: { parent: { columns: { id: true, name: true } } } } },
      },
      registration: { columns: { id: true }, with: { subject: { columns: { name: true } }, session: { columns: { id: true, name: true } } } },
      boardService: { columns: { id: true, label: true, kind: true } },
      receipt: { columns: { id: true, receiptNumber: true, status: true } },
      paymentCharges: { with: { payment: { columns: { id: true, status: true, amount: true, escrowAmountApplied: true, paymentMethod: true, instrumentUsed: true, confirmedAt: true, metadata: true } } } },
    },
    orderBy: (c, { desc: d }) => [d(c.createdAt)],
  });
  return rows.map((c) => {
    const { linkRequestsAsStudent, ...student } = c.student;
    return { ...withPaymentState(c), student, family: linkRequestsAsStudent.map((l) => l.parent) };
  });
}

/** What a charge's payments say: paid when and how, a payment still open, the deposit slip, what is owed. */
function withPaymentState<T extends {
  status: string; amount: number;
  paymentCharges: { payment: { id: string; status: string; confirmedAt: Date | null; paymentMethod: string; instrumentUsed?: string | null; metadata: unknown } }[];
}>(c: T) {
  const paid = c.paymentCharges.map((pc) => pc.payment).find((p) => p.status === 'completed') ?? null;
  const open = c.paymentCharges.map((pc) => pc.payment).find((p) => p.status === 'pending' || p.status === 'pending_verification') ?? null;
  const slip = (paid?.metadata as { depositSlip?: string } | null)?.depositSlip ?? null;
  const outstanding = c.status === 'pending_payment' || c.status === 'requested' ? c.amount : 0;
  return {
    ...c,
    paidAt: paid?.confirmedAt ?? null,
    paidBy: paid?.instrumentUsed ?? paid?.paymentMethod ?? null,
    paymentId: paid?.id ?? null,
    openPaymentId: open?.id ?? null,
    depositSlip: slip,
    outstanding,
  };
}

export async function listChargesFor(studentId: string) {
  const rows = await db.query.charge.findMany({
    where: (c, { eq: e }) => e(c.studentId, studentId),
    columns: chargeColumns,
    with: {
      receipt: { columns: { receiptNumber: true, status: true } },
      paymentCharges: { with: { payment: { columns: { id: true, status: true, confirmedAt: true, paymentMethod: true, instrumentUsed: true, metadata: true } } } },
    },
    orderBy: (c, { asc: a }) => [a(c.dueAt), a(c.createdAt)],
  });
  return rows.map(withPaymentState);
}

/** The charges a payment covers, for the checkout and the workbench. */
export async function chargesOfPayment(paymentId: string) {
  return db.select({ id: charge.id, kind: charge.kind, description: charge.description, amount: charge.amount, status: charge.status })
    .from(paymentCharge).innerJoin(charge, eq(charge.id, paymentCharge.chargeId)).where(eq(paymentCharge.paymentId, paymentId)).orderBy(asc(charge.createdAt));
}

/** A charge with its student, for the routes' checks. */
export async function getCharge(id: string) {
  const [c] = await db.select().from(charge).where(eq(charge.id, id));
  return c ?? null;
}
