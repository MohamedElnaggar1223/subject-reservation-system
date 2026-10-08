/**
 * Exceptions — grant, revoke, list, "Check these" (RESERVATIONS_REWORK.md §3.7).
 *
 * An exception lifts one policy of the registry (POLICIES, @repo/validations) for one student or
 * one family, narrowed to the scopes the policy accepts, with the value its policy takes. The
 * registry says who may grant each policy; the grant and its audit row commit together, as do a
 * revocation and what rested on it:
 * - a grade-10 exception revoked: the waiting registrations it allowed expire (F0a);
 * - a plan revoked: its line expires (`plan_revoked`) and its deposits are settled as a drop that
 *   day; "release in full" keeps the line payable and gives every deposit back (§3.6);
 * - a school-fee waiver granted: an open pushed school fee it covers is cancelled (§3.6);
 * - a price exception on one unpaid line with no payment history: the line is re-priced with it.
 *
 * The V3 shape ({ type, studentId, sessionId?, subjectId?, value?, validUntil? }) is still
 * accepted and mapped onto its key exactly as the migration mapped the old rows.
 *
 * Every hook reads exceptions through exception-registry.services (and line-exceptions for
 * priceLine, assertLineRules and dueDateFor).
 */

import {
  db, exception, user, registration, registrationSession, subject, sessionOffer, sessionOfferItem, charge, boardSeries, parentStudentLink,
  paymentRegistration, paymentCharge, payment,
  eq, and, inArray, sql, gradeTodayExtras,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  POLICIES, LEGACY_TYPE_TO_POLICY, SCOPE_FIELD, isRegistryPolicyKey, policiesGrantableBy, hasRole,
  academicYearStartOf, gradeInAcademicYear, seriesAcademicYearStart, seriesLabel, InstalmentRow,
  type GrantExceptionType, type ListExceptionsQueryType, type RegistryPolicyKey, type PolicyScopeInputType, type Role, type InstalmentRowType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { expireIneligibleRegistrations } from './eligibility.services';
import { expireWaitingRegistrations } from './expiry.services';
import { windowExtended, schoolFeeWaived } from './exception-registry.services';
import { grantPlanInTx, settlePlanInTx, PlanError } from './plan.services';
import { cancelPushesForWaiverInTx } from './school-fee.services';
import { getSetting } from './settings.services';
import { priceLine } from './pricing.services';
import { cairoDayStart } from './refund.services';
import { dueDateFor, redateLines } from './deadline.services';
import { redateChargeInTx, repriceChargeInTx, ChargeError } from './charge.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ExceptionError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

function assertMayGrant(key: RegistryPolicyKey, role: string | null | undefined, verb: 'grant' | 'revoke' | 'confirm') {
  const roles = POLICIES[key].grantRoles;
  if (!hasRole(role, ...(roles as readonly Role[]))) {
    throw new ExceptionError(`Only ${roles.map((r) => r.replace(/_/g, ' ')).join(' or ')} may ${verb} "${POLICIES[key].label}"`, 403);
  }
}

/**
 * The grade-10 exception is for a student who is in grade 10 in the series it names (or, with no
 * series, in grade 10 this academic year or starting next): a series they may sit anyway needs no
 * exception.
 */
async function assertGrade10ExceptionFits(studentId: string, sessionId: string | null | undefined) {
  const [s] = await db.select({ name: user.name, cohortYear: user.cohortYear }).from(user).where(eq(user.id, studentId));
  if (!s) throw new ExceptionError('Student not found', 404);
  if (sessionId) {
    const [sess] = await db.select({ sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear })
      .from(registrationSession).where(eq(registrationSession.id, sessionId));
    if (!sess) throw new ExceptionError('Session not found', 404);
    if (sess.sessionType === 'june') throw new ExceptionError('Grade 10 already sits the June series: no exception is needed');
    const grade = gradeInAcademicYear(s.cohortYear, seriesAcademicYearStart(sess.sessionType, sess.seriesYear));
    if (grade !== 10) {
      throw new ExceptionError(`${s.name} is not in grade 10 for the ${seriesLabel(sess.sessionType, sess.seriesYear)} series: no exception is needed`);
    }
    return;
  }
  const now = academicYearStartOf();
  const grade = gradeInAcademicYear(s.cohortYear, now);
  if (grade !== 10 && grade !== 9) {
    throw new ExceptionError(`${s.name} is not in grade 10 this year or next: no exception is needed`);
  }
}

// ─── The grant, normalised ───────────────────────────────────────────────────

type Normalised = {
  policyKey: RegistryPolicyKey;
  legacyType: string | null;
  studentId: string | null;
  familyId: string | null;
  scope: PolicyScopeInputType;
  value: number | string | InstalmentRowType[] | null;
  validUntil: Date | null;
  reason: string;
};

function normalise(data: GrantExceptionType): Normalised {
  if ('type' in data) {
    // V3's shape, mapped as the migration maps the old rows.
    const key = LEGACY_TYPE_TO_POLICY[data.type];
    const deadline = data.type === 'deadline_extension' || data.type === 'late_registration';
    return {
      policyKey: key,
      legacyType: data.type,
      studentId: data.studentId,
      familyId: null,
      scope: { ...(data.sessionId ? { sessionId: data.sessionId } : {}), ...(data.subjectId ? { subjectId: data.subjectId } : {}) },
      value: deadline ? (data.validUntil ? data.validUntil.toISOString() : null) : (data.value ?? null),
      validUntil: data.validUntil ?? null,
      reason: data.reason,
    };
  }
  return {
    policyKey: data.policyKey,
    legacyType: null,
    studentId: data.studentId ?? null,
    familyId: data.familyId ?? null,
    scope: data.scope ?? {},
    value: data.value ?? null,
    validUntil: data.validUntil ?? null,
    reason: data.reason,
  };
}

/** A date value: a day ('2026-11-30') means the end of that school day for a deadline, the day itself for an anchor. */
function toDate(key: RegistryPolicyKey, v: unknown): Date {
  if (typeof v !== 'string') throw new ExceptionError(`${POLICIES[key].label} takes a date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    if (key === 'refund.courseStart') return new Date(`${v}T12:00:00Z`);
    const next = new Date(Date.parse(`${v}T12:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return new Date(cairoDayStart(next).getTime() - 1000);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ExceptionError(`${POLICIES[key].label} takes a date`);
  return d;
}

function typedValue(n: Normalised) {
  const p = POLICIES[n.policyKey];
  const out = { valueNumber: null as number | null, valueDate: null as Date | null, valueJson: null as unknown };
  switch (p.valueType) {
    case 'none':
      if (n.value !== null && n.value !== undefined && n.legacyType === null) throw new ExceptionError(`${p.label} takes no value`);
      return out;
    case 'percent':
    case 'amount': {
      if (typeof n.value !== 'number') throw new ExceptionError(`${p.label} needs a value`);
      const min = p.min ?? 0;
      const max = p.max ?? 1_000_000;
      if (n.value < min || n.value > max) throw new ExceptionError(p.valueType === 'percent' ? 'Percentage must be 0–100' : `The amount must be between ${min} and ${max}`);
      out.valueNumber = Math.round(n.value * 100) / 100;
      return out;
    }
    case 'date':
      if (n.value === null || n.value === undefined) {
        throw new ExceptionError(n.policyKey === 'deadline.window' ? 'Deadline extensions need an expiry date' : `${p.label} needs a date`);
      }
      out.valueDate = toDate(n.policyKey, n.value);
      return out;
    case 'schedule': {
      const rows = InstalmentRow.array().min(1).max(24).safeParse(n.value);
      if (!rows.success) throw new ExceptionError('A plan needs its instalments: a date and an amount each');
      out.valueJson = rows.data.map((r) => ({ dueAt: r.dueAt.toISOString(), amount: Math.round(r.amount * 100) / 100 }));
      return out;
    }
  }
}

/** Every scope field set is one the policy accepts, points at a row that exists, and is the holder's. */
async function checkScope(tx: Tx, n: Normalised, holderStudents: string[]) {
  const p = POLICIES[n.policyKey];
  const allowed = new Set(p.scopes.map((s) => SCOPE_FIELD[s]));
  const set = (Object.entries(n.scope) as [keyof PolicyScopeInputType, string | undefined][]).filter(([, v]) => !!v);
  for (const [field] of set) {
    if (!allowed.has(field)) throw new ExceptionError(`${p.label} cannot be narrowed by ${field.replace(/Id$/, '').replace(/([A-Z])/g, ' $1').toLowerCase()}`);
  }
  if (!set.length && p.nullScope === null) throw new ExceptionError(`${p.label} applies to something specific: choose what it is for`);
  const s = n.scope;
  if (s.sessionId && !(await tx.select({ id: registrationSession.id }).from(registrationSession).where(eq(registrationSession.id, s.sessionId))).length) throw new ExceptionError('Session not found', 404);
  if (s.subjectId && !(await tx.select({ id: subject.id }).from(subject).where(eq(subject.id, s.subjectId))).length) throw new ExceptionError('Subject not found', 404);
  if (s.offerId) {
    const [o] = await tx.select({ sessionId: sessionOffer.sessionId }).from(sessionOffer).where(eq(sessionOffer.id, s.offerId));
    if (!o) throw new ExceptionError('That subject is not offered in the session', 404);
    if (s.sessionId && o.sessionId !== s.sessionId) throw new ExceptionError('That subject is offered in another session');
  }
  if (s.offerItemId) {
    const [i] = await tx.select({ offerId: sessionOfferItem.offerId }).from(sessionOfferItem).where(eq(sessionOfferItem.id, s.offerItemId));
    if (!i) throw new ExceptionError('That item is not on offer', 404);
    if (s.offerId && i.offerId !== s.offerId) throw new ExceptionError('That item is of another subject');
  }
  if (s.boardSeriesId && !(await tx.select({ id: boardSeries.id }).from(boardSeries).where(eq(boardSeries.id, s.boardSeriesId))).length) throw new ExceptionError('Board series not found', 404);
  // A line or a charge is one family's: never another's (05).
  if (s.registrationId) {
    const [l] = await tx.select({ studentId: registration.studentId }).from(registration).where(eq(registration.id, s.registrationId));
    if (!l || !holderStudents.includes(l.studentId)) throw new ExceptionError('That line was not found for this student or family', 404);
  }
  if (s.chargeId) {
    const [c] = await tx.select({ studentId: charge.studentId, kind: charge.kind }).from(charge).where(eq(charge.id, s.chargeId));
    if (!c || !holderStudents.includes(c.studentId)) throw new ExceptionError('That charge was not found for this student or family', 404);
    // A pushed school fee's amount is the schedule's (the waiver is its exception); an instalment's is the plan's (§3.10 item 7).
    if (n.policyKey.startsWith('price.') && (c.kind === 'school_fee_push' || c.kind === 'instalment')) {
      throw new ExceptionError(c.kind === 'school_fee_push'
        ? 'A pushed school fee takes no price exception: its amount is the schedule\'s — waive it instead'
        : 'An instalment takes no price exception: change the plan instead', 409);
    }
  }
}

/** The students an exception covers: the student, or every child linked to the family. */
async function holderStudentsOf(executor: Tx | typeof db, n: { studentId: string | null; familyId: string | null }) {
  if (n.studentId) {
    const [st] = await executor.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, n.studentId));
    if (!st || st.role !== 'student') throw new ExceptionError('Exceptions can only be granted to students');
    return [st.id];
  }
  const [fam] = await executor.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, n.familyId!));
  if (!fam || fam.role !== 'parent') throw new ExceptionError('A family is a parent account');
  const kids = await executor.select({ id: parentStudentLink.studentId }).from(parentStudentLink)
    .where(and(eq(parentStudentLink.parentId, fam.id), eq(parentStudentLink.status, 'approved')));
  if (!kids.length) throw new ExceptionError('This parent has no linked child yet');
  return kids.map((k) => k.id).sort();
}

// ─── Management ──────────────────────────────────────────────────────────────

/**
 * Grant an exception (§3.7, §4.7). The registry decides who may grant the policy, the value it
 * takes and the scopes it accepts; the grant and its audit row commit together with what it sets
 * off (a plan's instalments; an open pushed fee a waiver covers, cancelled; an unpaid line's
 * price, re-priced by a line-scoped price exception).
 */
export async function grantException(data: GrantExceptionType, actor: { id: string; role: string | null | undefined }, ctx?: AuditContext) {
  const n = normalise(data);
  const p = POLICIES[n.policyKey];
  assertMayGrant(n.policyKey, actor.role, 'grant');
  if (p.status === 'pending') {
    throw new ExceptionError(`${p.label} is registered but not yet applied by pricing: it cannot be granted yet`, 409);
  }
  if (p.status === 'gated' && !(await getSetting('exceptions.boardEntryDeadline'))) {
    throw new ExceptionError('Late board entries are off: the board\'s entry deadline is a hard stop (owner question Q-20; the setting exceptions.boardEntryDeadline)', 409);
  }
  const holderStudents = await holderStudentsOf(db, n);
  if (n.policyKey === 'eligibility.grade10OtherSeries') {
    for (const s of holderStudents) await assertGrade10ExceptionFits(s, n.scope.sessionId);
  }
  const typed = typedValue(n);
  if (n.policyKey === 'plan.instalments' && !n.studentId) throw new ExceptionError('A plan is for one student\'s line');

  try {
    return await db.transaction(async (tx) => {
      // The students first (the reservation's lock, §6), then what the grant rests on.
      await tx.select({ id: user.id }).from(user).where(inArray(user.id, holderStudents)).orderBy(user.id).for('no key update');
      if (n.scope.registrationId) await tx.select({ id: registration.id }).from(registration).where(eq(registration.id, n.scope.registrationId)).for('update');
      if (n.scope.chargeId) await tx.select({ id: charge.id }).from(charge).where(eq(charge.id, n.scope.chargeId)).for('update');
      await checkScope(tx, n, holderStudents);
      const id = randomUUID();
      const [created] = await tx.insert(exception).values({
        id,
        type: n.legacyType,
        policyKey: n.policyKey,
        studentId: n.studentId,
        familyId: n.familyId,
        sessionId: n.scope.sessionId ?? null,
        subjectId: n.scope.subjectId ?? null,
        offerId: n.scope.offerId ?? null,
        offerItemId: n.scope.offerItemId ?? null,
        registrationId: n.scope.registrationId ?? null,
        chargeId: n.scope.chargeId ?? null,
        boardSeriesId: n.scope.boardSeriesId ?? null,
        academicYear: n.scope.academicYear ?? null,
        value: n.legacyType && typeof n.value === 'number' ? n.value : null,
        valueNumber: typed.valueNumber,
        valueDate: typed.valueDate,
        valueJson: typed.valueJson,
        reason: n.reason,
        validUntil: n.validUntil,
        status: 'active',
        grantedBy: actor.id,
      }).returning();
      await logAction(actor.id, 'EXCEPTION_GRANTED', 'exception', id, null, created as Record<string, unknown>, ctx, tx);

      let plan: Awaited<ReturnType<typeof grantPlanInTx>> | null = null;
      if (n.policyKey === 'plan.instalments') {
        plan = await grantPlanInTx(tx, { planId: id, lineId: n.scope.registrationId!, schedule: n.value as InstalmentRowType[], actorId: actor.id, ctx });
      }
      let pushesCancelled = 0;
      if (n.policyKey === 'gate.schoolFee') {
        pushesCancelled = await cancelPushesForWaiverInTx(tx, holderStudents, n.scope.academicYear ?? null, actor.id, ctx);
      }
      let repriced: { from: number; to: number } | null = null;
      if (n.policyKey.startsWith('price.') && n.scope.registrationId) {
        repriced = await repriceLineForException(tx, n.scope.registrationId, id, actor.id, ctx);
      }
      if (n.policyKey.startsWith('price.') && n.scope.chargeId) {
        repriced = await repriceChargeForException(tx, n.scope.chargeId, actor.id, ctx, 'grant');
      }
      // A payment due date granted: the waiting lines (and the charge) it covers are re-dated now.
      const dueDatesMoved = n.policyKey === 'deadline.payment' ? await redateForPaymentException(tx, holderStudents, n.scope, actor.id) : 0;
      return { ...created!, plan, pushesCancelled, repriced, dueDatesMoved };
    });
  } catch (err) {
    if (err instanceof PlanError) throw new ExceptionError(err.message, err.status);
    throw err;
  }
}

/**
 * A price exception on one line (§3.7: price.* × line): an unpaid line with no payment history is
 * re-priced with it, in the grant's transaction (its basis records it: 09's "price = basis"). A
 * line with any payment history keeps the price its checkout saw — a difference is a price
 * adjustment or a refund, finance's explicit act — so the grant is refused for it.
 */
async function repriceLineForException(tx: Tx, lineId: string, exceptionId: string, actorId: string, ctx?: AuditContext) {
  const [l] = await tx.select().from(registration).where(eq(registration.id, lineId));
  if (!l) throw new ExceptionError('That line was not found', 404);
  const history = await tx.select({ id: paymentRegistration.id }).from(paymentRegistration).where(eq(paymentRegistration.registrationId, lineId)).limit(1);
  if (!['pending_approval', 'pending_payment', 'preregistered'].includes(l.status) || history.length) {
    throw new ExceptionError('This line has been paid for or has a payment: its price stays — add a price adjustment or refund the difference instead', 409);
  }
  const basis = l.pricingBasis as { exceptionIds?: string[] } | null;
  if (!basis) throw new ExceptionError('A converted line keeps its price: add a price adjustment instead', 409);
  const price = await priceLine(tx, { item: { id: l.offerItemId }, attempt: l.attempt as 'first' | 'retake', mode: l.mode as 'in_school' | 'self_study', studentId: l.studentId, sessionId: l.sessionId },
    { exceptionIds: [...(basis.exceptionIds ?? []), exceptionId] });
  await tx.update(registration).set({
    priceAtRegistration: price.total, courseFeeAtRegistration: price.courseFee, registrationFeeAtRegistration: price.registrationFee,
    priceProvisional: price.provisional, pricingBasis: price.basis as unknown as Record<string, unknown>, updatedAt: new Date(),
  }).where(eq(registration.id, lineId));
  await logAction(actorId, 'LINE_REPRICED', 'registration', lineId, { priceAtRegistration: l.priceAtRegistration },
    { priceAtRegistration: price.total, reason: 'a price exception granted on this line', exceptionId }, ctx, tx);
  const due = await dueDateFor(tx, { kind: 'line', lineId });
  if (due.getTime() !== l.dueAt.getTime()) await tx.update(registration).set({ dueAt: due }).where(eq(registration.id, lineId));
  return { from: l.priceAtRegistration, to: price.total };
}

/**
 * A price exception on one line revoked: an unpaid line it re-priced gets its price without it (the
 * grant's re-price undone, LINE_REPRICED). A line with a payment keeps its price — finance adds a
 * price adjustment or refunds the difference, as for any paid line.
 */
async function repriceLineWithout(tx: Tx, lineId: string, exceptionId: string, actorId: string, ctx?: AuditContext) {
  const [l] = await tx.select().from(registration).where(eq(registration.id, lineId));
  const basis = l?.pricingBasis as { exceptionIds?: string[] } | null | undefined;
  if (!l || !basis?.exceptionIds?.includes(exceptionId)) return null;
  if (!['pending_approval', 'pending_payment', 'preregistered'].includes(l.status)) return null;
  const history = await tx.select({ id: paymentRegistration.id }).from(paymentRegistration).where(eq(paymentRegistration.registrationId, lineId)).limit(1);
  if (history.length) return null;
  const price = await priceLine(tx, { item: { id: l.offerItemId }, attempt: l.attempt as 'first' | 'retake', mode: l.mode as 'in_school' | 'self_study', studentId: l.studentId, sessionId: l.sessionId },
    { exceptionIds: basis.exceptionIds.filter((x) => x !== exceptionId) });
  await tx.update(registration).set({
    priceAtRegistration: price.total, courseFeeAtRegistration: price.courseFee, registrationFeeAtRegistration: price.registrationFee,
    priceProvisional: price.provisional, pricingBasis: price.basis as unknown as Record<string, unknown>, updatedAt: new Date(),
  }).where(eq(registration.id, lineId));
  await logAction(actorId, 'LINE_REPRICED', 'registration', lineId, { priceAtRegistration: l.priceAtRegistration },
    { priceAtRegistration: price.total, reason: 'a price exception on this line revoked', exceptionId }, ctx, tx);
  return { from: l.priceAtRegistration, to: price.total };
}

/**
 * A price exception on one charge granted or revoked: a charge still awaiting payment, with no
 * payment open or made, is priced again at once (CHARGE_REPRICED), as a line is. A charge with a
 * payment keeps its amount (a payment charges exactly what it covers); a grant on it is refused.
 */
async function repriceChargeForException(tx: Tx, chargeId: string, actorId: string, ctx: AuditContext | undefined, why: 'grant' | 'revoke') {
  const [c] = await tx.select().from(charge).where(eq(charge.id, chargeId));
  if (!c) throw new ExceptionError('That charge was not found', 404);
  const paid = await tx.select({ id: paymentCharge.id }).from(paymentCharge).innerJoin(payment, eq(payment.id, paymentCharge.paymentId))
    .where(and(eq(paymentCharge.chargeId, chargeId), inArray(payment.status, ['pending', 'pending_verification', 'completed']))).limit(1);
  if (!['requested', 'pending_payment'].includes(c.status) || paid.length) {
    if (why === 'revoke') return null;
    throw new ExceptionError('This charge has a payment: its amount stays — refund the difference instead', 409);
  }
  try {
    const next = await repriceChargeInTx(tx, c, actorId, ctx);
    return next.amount === c.amount ? null : { from: c.amount, to: next.amount };
  } catch (err) {
    // Past the charge's deadline it can no longer be paid: a grant is refused, a revocation leaves it.
    if (!(err instanceof ChargeError)) throw err;
    if (why === 'revoke') return null;
    throw new ExceptionError(err.message, err.status);
  }
}

/**
 * deadline.payment (§3.1, §6 dueDateFor): the waiting lines of the holder the exception covers — one
 * line, or a session's — are re-dated (LINE_DUE_MOVED), and a charge it names gets its due date
 * again, in the grant's (or the revocation's) transaction, the students already locked.
 */
async function redateForPaymentException(tx: Tx, students: string[], scope: PolicyScopeInputType, actorId: string) {
  let moved = 0;
  if (scope.registrationId || scope.sessionId) {
    const lines = await tx.select({ id: registration.id }).from(registration)
      .where(and(
        inArray(registration.studentId, students),
        inArray(registration.status, ['pending_approval', 'pending_payment', 'preregistered']),
        scope.registrationId ? eq(registration.id, scope.registrationId) : eq(registration.sessionId, scope.sessionId!),
      ))
      .orderBy(registration.id).for('update');
    moved += await redateLines(tx, lines.map((l) => l.id), actorId, 'a payment due-date exception');
  }
  if (scope.chargeId) moved += await redateChargeInTx(tx, scope.chargeId, actorId);
  return moved;
}

/**
 * Revoke an exception — by a role that may grant its policy. What rested on it follows in the
 * same transaction: a grade-10 exception's waiting registrations expire (F0a; the caller closes
 * their checkouts after); a plan's line expires (`plan_revoked`) and its deposits are settled as a
 * drop that day. A one-shot gate already used stays used (what it let through stands).
 */
export async function revokeException(id: string, actor: { id: string; role: string | null | undefined }, ctx?: AuditContext, opts: { reason?: string } = {}) {
  const [peek] = await db.select().from(exception).where(eq(exception.id, id));
  if (!peek || peek.status !== 'active') throw new ExceptionError('Exception not found or already revoked', 404);
  if (!isRegistryPolicyKey(peek.policyKey)) throw new ExceptionError('Exception not found or already revoked', 404);
  assertMayGrant(peek.policyKey, actor.role, 'revoke');
  // Who it covers now (a family whose children were all unlinked since covers no one).
  const holders = await holderStudentsOf(db, peek).catch(() => [] as string[]);
  return db.transaction(async (tx) => {
    // The order of §6 (RESERVATIONS.md §2.1): the students it covers first — so a reservation
    // reading it either commits before the revocation (and the revocation then re-dates or expires
    // its line with the others) or reads it revoked — then the line or charge it rests on, then it.
    if (holders.length) await tx.select({ id: user.id }).from(user).where(inArray(user.id, holders)).orderBy(user.id).for('no key update');
    if (peek.registrationId) await tx.select({ id: registration.id }).from(registration).where(eq(registration.id, peek.registrationId)).for('update');
    if (peek.chargeId) await tx.select({ id: charge.id }).from(charge).where(eq(charge.id, peek.chargeId)).for('update');
    const [row] = await tx.select().from(exception).where(eq(exception.id, id)).for('update');
    if (!row || row.status !== 'active') throw new ExceptionError('Exception not found or already revoked', 404);
    const now = new Date();
    const [updated] = await tx
      .update(exception)
      .set({ status: 'revoked', revokedBy: actor.id, revokedAt: now, revokeReason: opts.reason ?? null, updatedAt: now })
      .where(and(eq(exception.id, id), eq(exception.status, 'active')))
      .returning();
    await logAction(actor.id, 'EXCEPTION_REVOKED', 'exception', id, { status: 'active' }, updated as Record<string, unknown>, ctx, tx);
    let expired: { id: string; studentId: string; subjectId: string }[] = [];
    let repriced: { from: number; to: number } | null = null;
    if (row.policyKey.startsWith('price.') && row.registrationId) repriced = await repriceLineWithout(tx, row.registrationId, row.id, actor.id, ctx);
    if (row.policyKey.startsWith('price.') && row.chargeId) repriced = await repriceChargeForException(tx, row.chargeId, actor.id, ctx, 'revoke');
    if (row.policyKey === 'deadline.payment') {
      const students = holders;
      await redateForPaymentException(tx, students, {
        ...(row.registrationId ? { registrationId: row.registrationId } : {}), ...(row.sessionId ? { sessionId: row.sessionId } : {}), ...(row.chargeId ? { chargeId: row.chargeId } : {}),
      }, actor.id);
    }
    if (row.policyKey === 'eligibility.grade10OtherSeries') {
      const students = holders;
      expired = await expireIneligibleRegistrations(tx, { studentIds: students, ...(row.sessionId ? { sessionIds: [row.sessionId] } : {}) }, 'exception_revoked', now);
    }
    if (row.policyKey === 'plan.instalments' && row.registrationId) {
      // The line ends: expired as plan_revoked, the plan settled as a drop that day.
      expired = await expireWaitingRegistrations(tx, eq(registration.id, row.registrationId), 'plan_revoked', now, opts.reason);
      await settlePlanInTx(tx, { lineId: row.registrationId, planId: row.id, cause: 'revoked', at: now, actorId: actor.id, detail: opts.reason ?? 'the plan was revoked', ctx });
    }
    return { exception: updated!, expired, repriced };
  });
}

/**
 * Finance ends a plan and keeps the line payable (§3.6): every deposit released to free escrow, the
 * unpaid instalments cancelled, the line due by the session's date again. The line can then be
 * paid in full, escrow included.
 */
export async function releasePlanInFull(id: string, actor: { id: string; role: string | null | undefined }, reason: string, ctx?: AuditContext) {
  const [peek] = await db.select().from(exception).where(eq(exception.id, id));
  if (!peek || peek.status !== 'active' || peek.policyKey !== 'plan.instalments' || !peek.registrationId || !peek.studentId) {
    throw new ExceptionError('No live instalment plan with that id', 404);
  }
  assertMayGrant('plan.instalments', actor.role, 'revoke');
  return db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, peek.studentId!)).for('no key update');
    const [line] = await tx.select({ id: registration.id, status: registration.status }).from(registration).where(eq(registration.id, peek.registrationId!)).for('update');
    const [row] = await tx.select().from(exception).where(eq(exception.id, id)).for('update');
    if (!row || row.status !== 'active') throw new ExceptionError('No live instalment plan with that id', 404);
    if (line?.status !== 'pending_payment') throw new ExceptionError('The line is no longer awaiting payment', 409);
    const now = new Date();
    const [updated] = await tx.update(exception).set({ status: 'revoked', revokedBy: actor.id, revokedAt: now, revokeReason: reason, updatedAt: now })
      .where(and(eq(exception.id, id), eq(exception.status, 'active'))).returning();
    await logAction(actor.id, 'EXCEPTION_REVOKED', 'exception', id, { status: 'active' }, { ...updated, releaseInFull: true } as Record<string, unknown>, ctx, tx);
    const settlement = await settlePlanInTx(tx, { lineId: row.registrationId!, planId: row.id, cause: 'released_in_full', at: now, actorId: actor.id, detail: reason, ctx });
    // Due by the session's date again (the plan's last date no longer applies).
    const [cur] = await tx.select({ dueAt: registration.dueAt }).from(registration).where(eq(registration.id, row.registrationId!));
    const due = await dueDateFor(tx, { kind: 'line', lineId: row.registrationId! });
    if (cur && due.getTime() !== cur.dueAt.getTime()) {
      await tx.update(registration).set({ dueAt: due, updatedAt: now }).where(eq(registration.id, row.registrationId!));
      await logAction(actor.id, 'LINE_DUE_MOVED', 'registration', row.registrationId!, { dueAt: cur.dueAt.toISOString() }, { dueAt: due.toISOString(), reason: 'instalment plan released in full' }, ctx, tx);
    }
    return { exception: updated!, settlement };
  });
}

/** Exceptions of the policies the caller may grant (a coordinator sees the academic ones). */
export async function getExceptions(filters: ListExceptionsQueryType | undefined, role: string | null | undefined) {
  const keys = policiesGrantableBy(role);
  const legacyKey = filters?.type ? LEGACY_TYPE_TO_POLICY[filters.type] : null;
  return db.query.exception.findMany({
    where: (e, { eq: eqOp, and: andOp, inArray: inArr }) => {
      const conditions = [inArr(e.policyKey, keys.length ? keys : ['__none__'])];
      if (filters?.studentId) conditions.push(eqOp(e.studentId, filters.studentId));
      if (filters?.familyId) conditions.push(eqOp(e.familyId, filters.familyId));
      if (filters?.status) conditions.push(eqOp(e.status, filters.status));
      if (filters?.policyKey) conditions.push(eqOp(e.policyKey, filters.policyKey));
      if (legacyKey) conditions.push(eqOp(e.policyKey, legacyKey));
      return andOp(...conditions);
    },
    with: {
      student: { columns: { id: true, name: true, email: true, cohortYear: true }, extras: gradeTodayExtras },
      family: { columns: { id: true, name: true, email: true } },
      session: { columns: { id: true, name: true } },
      subject: { columns: { id: true, name: true, code: true } },
      offer: { columns: { id: true }, with: { subject: { columns: { id: true, name: true } } } },
      offerItem: { columns: { id: true, label: true } },
      registration: { columns: { id: true, status: true, priceAtRegistration: true }, with: { subject: { columns: { name: true } }, session: { columns: { name: true } } } },
      charge: { columns: { id: true, description: true, amount: true, status: true } },
      boardSeries: { columns: { id: true, boardCode: true, month: true, year: true, label: true } },
    },
    orderBy: (e, { desc }) => [desc(e.createdAt)],
  });
}

/**
 * "Check these" (§3.7): exceptions whose meaning the rework changed, for a finance admin to confirm
 * (apply as they are now scoped) or revoke —
 * - a migrated subject-scoped deadline or refund exception (V3 never applied one): until
 *   confirmed it covers nothing;
 * - a price exception scoped to an old unit row whose unit an item of another subject now enters
 *   (a parent row, §3.2): it still applies to that row's lines only, so a new reservation of the
 *   parent's item would not get it — re-scope it (revoke and grant it on the item) or confirm it.
 */
export async function getCheckThese(role: string | null | undefined) {
  const keys = policiesGrantableBy(role);
  if (!keys.length) return [];
  const listed = await db.query.exception.findMany({
    where: (e, { and: andOp, eq: eqOp, isNotNull: nn, isNull: nu, inArray: inArr }) =>
      andOp(eqOp(e.status, 'active'), nn(e.checkReason), nu(e.confirmedAt), inArr(e.policyKey, keys)),
    with: {
      student: { columns: { id: true, name: true } },
      family: { columns: { id: true, name: true } },
      session: { columns: { id: true, name: true } },
      subject: { columns: { id: true, name: true, code: true } },
    },
    orderBy: (e, { asc }) => [asc(e.createdAt)],
  });
  const priceKeys = keys.filter((k) => k.startsWith('price.'));
  const unitRows = priceKeys.length ? await db.execute(sql`
    select e.id from exception e
    where e.status = 'active' and e.confirmed_at is null and e.check_reason is null and e.subject_id is not null
      and e.policy_key in (${sql.join(priceKeys.map((k) => sql`${k}`), sql`, `)})
      and exists (
        select 1 from subject_unit su
        join session_offer_item_unit iu on iu.unit_id = su.unit_id
        join session_offer_item i on i.id = iu.item_id
        join session_offer o on o.id = i.offer_id
        join registration_session rs on rs.id = o.session_id
        where su.subject_id = e.subject_id and o.subject_id <> e.subject_id and rs.status <> 'closed')`).then((r) => (r.rows as { id: string }[]).map((x) => x.id)) : [];
  const parents = unitRows.length ? await db.query.exception.findMany({
    where: (e, { inArray: inArr }) => inArr(e.id, unitRows),
    with: {
      student: { columns: { id: true, name: true } },
      family: { columns: { id: true, name: true } },
      session: { columns: { id: true, name: true } },
      subject: { columns: { id: true, name: true, code: true } },
    },
  }) : [];
  return [
    ...listed.map((e) => ({ ...e, why: e.checkReason! })),
    ...parents.map((e) => ({ ...e, why: `A price exception on ${e.subject?.name ?? 'an old unit row'}, whose unit is now reserved under another subject: it applies only to that row's lines — re-scope it to the new item (revoke and grant again) or confirm it as it is` })),
  ];
}

/** Confirm an exception listed under "Check these": from now on it applies as it is scoped. */
export async function confirmCheckedException(id: string, actor: { id: string; role: string | null | undefined }, note: string | undefined, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(exception).where(eq(exception.id, id)).for('update');
    if (!row || row.status !== 'active' || !isRegistryPolicyKey(row.policyKey)) throw new ExceptionError('Exception not found', 404);
    assertMayGrant(row.policyKey, actor.role, 'confirm');
    if (row.confirmedAt) throw new ExceptionError('Already confirmed', 409);
    const now = new Date();
    const [updated] = await tx.update(exception).set({ confirmedAt: now, confirmedBy: actor.id, updatedAt: now }).where(eq(exception.id, id)).returning();
    await logAction(actor.id, 'EXCEPTION_CONFIRMED', 'exception', id, { checkReason: row.checkReason }, { confirmedAt: now.toISOString(), note: note ?? null }, ctx, tx);
    return updated!;
  });
}

// ─── Hooks the V3 services call by name ──────────────────────────────────────

/**
 * Hook 2 — window checks (MA-13): a closed (or not-yet-open) session is treated as open for this
 * student while a deadline.window exception covers it, until its date.
 */
export async function hasDeadlineExtension(
  studentId: string,
  sessionId: string,
  // A caller inside a transaction passes it, so the lookup does not take a
  // second pool connection while the transaction holds its locks.
  executor: Tx | typeof db = db
): Promise<boolean> {
  return windowExtended(executor, studentId, sessionId);
}

/** Hook 3 — the school-fee gate's waiver (gate.schoolFee): for that academic year, or every year. */
export async function hasFeeWaiver(studentId: string, academicYear: string | null = null): Promise<boolean> {
  return schoolFeeWaived(db, studentId, academicYear);
}
