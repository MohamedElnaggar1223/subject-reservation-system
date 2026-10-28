/**
 * Desk Service (UX_AUDIT G1/G2/G5)
 *
 * Staff acting on a family's behalf at the school desk — the Excel
 * replacement during the transition to app-first self-serve:
 *
 * - onboardFamily: find-or-create parent + student and link them
 *   APPROVED in one action (staff vouch for the family in person, so no
 *   student-login approval loop).
 * - executeDeskRegistration: register subjects AND record the money the
 *   officer just took, in one action — registrations confirm and
 *   receipts are born immediately.
 * - collectSchoolFeeAtDesk: take the school fee at the desk; the
 *   registration gate unlocks on the spot.
 * - getStudentSummary: the Student 360 — everything about one student
 *   on one screen.
 */

import { db, payment, paymentRegistration, paymentCharge, registration, parentStudentLink, charge, user as userTable, eq, and, inArray, notInArray, sql, gradeTodayExtras } from '@repo/db';
import { randomUUID } from 'crypto';
import type { DeskOnboardFamilyType, DeskRegistrationType, DeskCollectType } from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { auth } from '../lib/auth';
import { assertSchoolFeeGate } from './registration.services';
import { reserveLines, consentStanding, writeConsents, CONSENT_MISSING_REFUSAL, FAMILY_CONSENT_NEEDED } from './reservation.services';
import { exceptionsOfLines } from './line-exceptions-read.services';
import { lineDepositsSql } from './escrow.services';
import { mayReserveSession, subjectsOfItems, assertMayPay, cutOffsOf, reserveRefusal } from './window.services';
import { coded } from '../lib/refusal';
import { PRICE_CHANGED_REFUSAL, assertExpectedPrices } from './pricing.services';
import { setStudentFields } from './user.services';
import { getEscrowBalance, debitEscrow, InsufficientBalanceError } from './escrow.services';
import { confirmPayment, failPayment, assertNoLivePlan, createChargePaymentsInTx } from './payment.services';
import {
  academicYearForDate,
  getSchoolFeeStanding,
  studentGradeInYear,
} from './school-fee.services';
import { assertMayRegisterFor, assertMayRegisterForInTx, mayRegisterFor, standingToday } from './eligibility.services';
import { sectionOf } from './academic.services';
import { academicYearShortLabel, academicYearStartOf, gradeInAcademicYear, gradeLabel, academicYearStartFromLabel, formatEgp } from '@repo/validations';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Desk onboarding (G5) ────────────────────────────────────────────────────

async function findOrCreatePerson(
  person: { email: string; name?: string; password?: string; phone?: string | null },
  role: 'parent' | 'student',
  grade?: number,
  staffId: string | null = null,
): Promise<{ id: string; name: string; email: string; created: boolean }> {
  const existing = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, person.email.toLowerCase()),
    columns: { id: true, name: true, email: true, role: true },
  });

  if (existing) {
    if (existing.role !== role) {
      throw new Error(
        `${person.email} already exists with the role '${existing.role}' — expected ${role}`
      );
    }
    return { id: existing.id, name: existing.name, email: existing.email, created: false };
  }

  if (!person.name || !person.password) {
    throw new Error(
      `${person.email} has no account yet — provide a name and a temporary password to create one`
    );
  }
  if (role === 'student' && grade === undefined) {
    throw new Error('New student accounts need a grade');
  }

  // SECURITY: create through the PUBLIC sign-up API, not better-auth's
  // admin createUser. The admin endpoint would require staff to hold the
  // better-auth `user` resource, which also unlocks /api/auth/admin/*
  // (create-user honours a client-supplied role; set-user-password
  // targets anyone) — i.e. desk staff could mint or seize admin
  // accounts. Sign-up needs no elevated permission, and the role below
  // is a hard-coded server value that can never come from the request.
  const result = await auth.api.signUpEmail({
    body: {
      email: person.email,
      password: person.password,
      name: person.name,
    },
  });

  const userId = result.user.id;

  // Staff vouched for this family in person, so the account is usable
  // immediately — no verification email round-trip at the desk.
  await db
    .update(userTable)
    .set({
      role,
      emailVerified: true,
      ...(person.phone ? { phone: person.phone } : {}),
    })
    .where(eq(userTable.id, userId));

  if (role === 'student') {
    await setStudentFields(userId, grade!, { actorId: staffId, how: 'desk' });
  }

  return { id: userId, name: result.user.name, email: result.user.email, created: true };
}

/**
 * One desk action: parent + student accounts exist (created if needed)
 * and are linked APPROVED. Idempotent for existing links.
 */
export async function onboardFamily(data: DeskOnboardFamilyType, staffId: string | null = null) {
  const parent = await findOrCreatePerson(data.parent, 'parent');
  const student = await findOrCreatePerson(
    data.student,
    'student',
    data.student.grade,
    staffId,
  );

  // The live link (pending or approved — the database allows one per pair).
  // Any link, rejected ones included, used to be picked and flipped, so a
  // family with a rejected request and a pending one could not be enrolled
  // (state audit ST-10). A rejected request stays as history.
  const liveLink = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and, inArray }) =>
      and(eq(l.parentId, parent.id), eq(l.studentId, student.id), inArray(l.status, ['pending', 'approved'])),
  });

  if (liveLink?.status === 'approved') return { parent, student, linkStatus: 'already_linked' };
  if (liveLink) {
    // Staff vouch in person — approve the pending request, if it is still pending.
    await db
      .update(parentStudentLink)
      .set({ status: 'approved', respondedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(parentStudentLink.id, liveLink.id), eq(parentStudentLink.status, 'pending')));
  } else {
    await db.insert(parentStudentLink).values({
      id: randomUUID(),
      parentId: parent.id,
      studentId: student.id,
      status: 'approved',
    }).onConflictDoNothing();
  }
  const [now] = await db
    .select({ status: parentStudentLink.status })
    .from(parentStudentLink)
    .where(and(eq(parentStudentLink.parentId, parent.id), eq(parentStudentLink.studentId, student.id), inArray(parentStudentLink.status, ['pending', 'approved'])));
  if (now?.status !== 'approved') throw new Error('The link changed while enrolling the family — please try again');

  return { parent, student, linkStatus: 'approved' };
}

// ─── Desk registration + payment (G1) ────────────────────────────────────────

/**
 * Reserve lines for a student at the desk and (optionally) record the money the officer just
 * took — one action, receipts born immediately (RESERVATIONS_REWORK.md §4.3: "Reserve only",
 * "Reserve and collect"). The desk's one consent tick ("read and signed by the parent") is
 * recorded on every line on the desk channel; a sitting the officer names that the system does
 * not know is declared by the desk and listed to verify. A line reserved before its session's
 * prices are final is reserved and not collected — it is collected once they are (E6).
 */
export async function executeDeskRegistration(staffId: string, data: DeskRegistrationType, auditCtx?: AuditContext) {
  // F0a: call site 5 of mayRegisterFor — the desk registers only for a
  // series the student may sit.
  const eligibility = await assertMayRegisterFor(data.studentId, data.sessionId);

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  // May reserve (§6): the session open, or a G4 later reserve date (a subject's covers that subject alone). Each
  // line's subject, row and board deadline are asked when it is made.
  const w = await mayReserveSession(db, data.studentId, sess.id, new Date(), await subjectsOfItems(db, data.lines.map((l) => l.offerItemId)));
  if (!w.allowed) throw reserveRefusal(w);

  // The reservations rework (§3.10 item 1): the year's school fee collected in the same action,
  // first — the registration's gate asks for it — in a payment of its own.
  const schoolFee = data.collectNow?.schoolFeeYear
    ? await collectSchoolFeeAtDesk(staffId, data.studentId, data.collectNow.instrumentUsed, data.collectNow.notes, data.collectNow.schoolFeeYear, auditCtx)
    : null;
  try {
    const registered = await registerAtDeskAfterChecks(staffId, data, eligibility, auditCtx);
    // Then the student's charges, each group its own payment; what cannot be taken is listed.
    const chargeIds = data.collectNow?.chargeIds ?? [];
    let charges: Awaited<ReturnType<typeof collectLinesAndCharges>> | null = null;
    let chargesNotCollected: { paymentId: string; series: string[]; amount: number; reason: string }[] = [];
    if (data.collectNow && chargeIds.length) {
      try {
        charges = await collectLinesAndCharges(staffId, { studentId: data.studentId, registrationIds: [], chargeIds, instrumentUsed: data.collectNow.instrumentUsed, escrowAmountToApply: 0, notes: data.collectNow.notes }, auditCtx);
      } catch (err) {
        chargesNotCollected = [{ paymentId: '', series: ['The charges'], amount: await outstandingOf({ registrationIds: [], chargeIds }), reason: err instanceof Error ? err.message : 'Not collected' }];
      }
    }
    return {
      ...registered,
      payments: [...registered.payments, ...(charges?.payments ?? [])],
      notCollected: [...registered.notCollected, ...(charges?.notCollected ?? []), ...chargesNotCollected],
      collected: round2(registered.collected + (charges?.collected ?? 0) + (schoolFee?.amount ?? 0)),
      receipts: [...registered.receipts, ...(charges?.receipts ?? []).map((r) => ({ id: r.id, registrationId: r.registrationId, receiptNumber: r.receiptNumber, status: r.status }))],
      schoolFee,
    };
  } catch (err) {
    if (!schoolFee) throw err;
    throw new Error(`The ${schoolFee.academicYear} school fee (${formatEgp(schoolFee.amount)}) was collected; the subjects were not registered: ${err instanceof Error ? err.message : 'refused'}`);
  }
}

/** The desk's reservation once its inputs are checked (the school fee, if asked, already in). */
async function registerAtDeskAfterChecks(
  staffId: string, data: DeskRegistrationType, eligibility: Awaited<ReturnType<typeof assertMayRegisterFor>>, auditCtx?: AuditContext,
) {
  // The school-fee gate, then the lines: checked, priced and entered in their items' series by
  // insertLines, in the transaction (the grade-10 core rule included), with the desk's consent.
  await assertSchoolFeeGate(data.studentId, eligibility);
  const now = new Date();
  const lineInput = {
    studentId: data.studentId, sessionId: data.sessionId, lines: data.lines, status: 'pending_payment' as const,
    requestedBy: staffId, approvedBy: staffId, approvedAt: now, approvalComments: '[DESK] Registered at the finance desk', eligibility,
    declaredBy: 'desk' as const, channel: 'desk' as const, answers: data.answers,
  };

  // No money taken → reserve only; the family pays later (app or desk)
  if (!data.collectNow) {
    const created = await db.transaction(async (tx) => {
      // Asked again with the student and window held (F0a; see assertMayRegisterForInTx).
      await assertMayRegisterForInTx(tx, data.studentId, data.sessionId);
      const inserted = await reserveLines(tx, lineInput);
      await logAction(staffId, 'DESK_REGISTRATION', 'registration', data.studentId, null,
        { subjects: inserted.length, registrationIds: inserted.map((r) => r.id), collected: 0 }, auditCtx, tx);
      return inserted;
    });
    const totalCost = created.reduce((sum, r) => sum + r.priceAtRegistration, 0);
    return { registrations: created, payment: null, payments: [], notCollected: [], reservedNotCollected: [], totalCost, collected: 0, receipts: [] };
  }

  const escrowToApply = data.collectNow.escrowAmountToApply ?? 0;
  if (escrowToApply > 0) {
    const balance = await getEscrowBalance(data.studentId);
    if (escrowToApply > balance) {
      throw new InsufficientBalanceError(
        `Not enough in the balance: ${formatEgp(balance)} available`
      );
    }
  }

  // Only money needs a payer of record; register-only desk actions (family
  // pays later) can proceed for a student who is not linked yet.
  const payerParentId = await resolvePayerParent(data.studentId);

  const made = await db.transaction(async (tx) => {
    // Asked again with the student and window held (F0a; see assertMayRegisterForInTx).
    await assertMayRegisterForInTx(tx, data.studentId, data.sessionId);
    const inserted = await reserveLines(tx, lineInput);
    const totalCost = round2(inserted.reduce((sum, r) => sum + r.priceAtRegistration, 0));
    // A line whose prices are not final is reserved, not collected (E6): it is collected once they are.
    const payable = inserted.filter((r) => !r.priceProvisional);
    const held = inserted.filter((r) => !payable.includes(r));
    const payableCost = round2(payable.reduce((sum, r) => sum + r.priceAtRegistration, 0));
    if (escrowToApply > payableCost) {
      throw new Error(held.length
        ? `The amount from the balance cannot be more than what is collected now (${formatEgp(payableCost)}): the lines whose prices are not final yet are collected once they are`
        : 'The amount from the balance cannot be more than the total cost');
    }
    if (!payable.length) {
      // Everything waits for the prices to be final: reserved, nothing collected.
      await logAction(staffId, 'DESK_REGISTRATION', 'registration', data.studentId, null,
        { subjects: inserted.length, registrationIds: inserted.map((r) => r.id), collected: 0, provisional: held.map((r) => r.id) }, auditCtx, tx);
      return { inserted, payments: [] as DeskPayment[], totalCost, held };
    }
    // The coordinator rework (§10): one payment per collection, whatever the lines' sittings or cut-offs.
    const payments = [await createDeskPayment(tx, {
      studentId: data.studentId, payerParentId, staffId, escrowToApply,
      registrationIds: payable.map((r) => r.id), prices: new Map(payable.map((r) => [r.id, r.priceAtRegistration])),
    })];
    // The registrations, the escrow debit and their audit row commit together (MO-1); the confirmation that
    // follows writes its own rows. The desk's row is the payment's creation row.
    await logAction(staffId, 'DESK_REGISTRATION', 'registration', data.studentId, null,
      { subjects: inserted.length, registrationIds: inserted.map((r) => r.id), paymentId: payments[0]!.id,
        ...(held.length ? { provisional: held.map((r) => r.id) } : {}),
        toCollect: Math.max(0, payableCost - escrowToApply), escrowApplied: escrowToApply }, auditCtx, tx);
    return { inserted, payments, totalCost, held };
  });
  const created = made.inserted;
  const totalCost = made.totalCost;
  const reservedNotCollected = made.held.map((r) => ({ registrationId: r.id, price: r.priceAtRegistration }));
  if (!made.payments.length) {
    return { registrations: created, payment: null, payments: [], notCollected: [], reservedNotCollected, totalCost, collected: 0, receipts: [] };
  }

  // Money is in hand — confirm each through the shared path so registrations
  // flip to confirmed, receipts are created, and NOT-005 fires.
  const outcome = await confirmDeskPayments(made.payments, staffId, data.collectNow.notes ?? 'Collected at the finance desk', data.collectNow.instrumentUsed, auditCtx);

  const receipts = await db.query.receipt.findMany({
    where: (r, { inArray }) => inArray(r.registrationId, created.map((c) => c.id)),
    columns: { id: true, registrationId: true, receiptNumber: true, status: true },
  });

  const first = outcome.confirmed[0]!;
  return {
    registrations: created,
    payment: { id: first.id, collected: outcome.collected, escrowApplied: outcome.escrowApplied },
    payments: outcome.confirmed.map((p) => ({ id: p.id, series: p.series, collected: p.amount, escrowApplied: p.escrowApplied, registrationIds: p.registrationIds })),
    notCollected: outcome.notCollected,
    reservedNotCollected,
    totalCost,
    collected: outcome.collected,
    receipts,
  };
}

type DeskPayment = {
  id: string; amount: number; escrowApplied: number; registrationIds: string[];
  // A charge payment's description (its charges); empty for the lines' payment.
  series: string[];
  // The reservations rework (§3.10 item 1): a charge payment's charges.
  chargeIds?: string[];
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * The desk's payment for subjects just registered or waiting, in the caller's transaction: one payment for every
 * line of the collection (the coordinator rework, §10: no split per deadline), escrow applied as asked, linked to
 * its registrations and debited in its own name. The caller writes the creation audit row.
 */
async function createDeskPayment(
  tx: Tx,
  a: { studentId: string; payerParentId: string; staffId: string; escrowToApply: number; registrationIds: string[]; prices: Map<string, number> },
): Promise<DeskPayment> {
  const cost = round2(a.registrationIds.reduce((sum, id) => sum + (a.prices.get(id) ?? 0), 0));
  const escrowApplied = round2(Math.min(a.escrowToApply, cost));
  const id = randomUUID();
  await tx.insert(payment).values({
    id,
    studentId: a.studentId,
    // Payer of record is the family, not the officer (RF-03): confirmations
    // go to whoever is here; the staff member stays in confirmedBy/metadata.
    parentId: a.payerParentId,
    amount: round2(cost - escrowApplied),
    escrowAmountApplied: escrowApplied,
    paymentMethod: 'in_school',
    purpose: 'registration',
    status: 'pending',
    externalReference: `DESK-${id.slice(0, 8).toUpperCase()}`,
    metadata: { desk: true, staffId: a.staffId },
  });
  if (escrowApplied > 0) {
    await debitEscrow({ studentId: a.studentId, amount: escrowApplied, reason: 'payment', initiatedBy: a.staffId, relatedPaymentId: id }, tx);
  }
  await tx.insert(paymentRegistration).values(a.registrationIds.map((registrationId) => ({ id: randomUUID(), paymentId: id, registrationId })));
  return { id, amount: round2(cost - escrowApplied), escrowApplied, registrationIds: a.registrationIds, series: [] };
}

/**
 * Confirm the desk's payments one by one. Each is confirmed in its own
 * transaction; one closed in between (the close, a parent) is reported as not
 * collected — the officer hands that money back — while the others stand.
 * Nothing confirmed at all is the old single-payment refusal.
 */
async function confirmDeskPayments(payments: DeskPayment[], staffId: string, notes: string, instrumentUsed: string, auditCtx?: AuditContext) {
  const confirmed: DeskPayment[] = [];
  const notCollected: { paymentId: string; series: string[]; amount: number; reason: string }[] = [];
  let firstError: unknown = null;
  for (const p of payments) {
    try {
      await confirmDeskPayment(p.id, staffId, notes, instrumentUsed, auditCtx);
      confirmed.push(p);
    } catch (err) {
      firstError ??= err;
      // Closed in between (the close, a parent): say so in the officer's words.
      const [now] = await db.select({ status: payment.status }).from(payment).where(eq(payment.id, p.id));
      const closed = now && now.status !== 'pending' && now.status !== 'completed';
      notCollected.push({
        paymentId: p.id, series: p.series, amount: p.amount,
        reason: closed ? 'It was closed before it could be confirmed — nothing was collected for it' : err instanceof Error ? err.message : 'Not confirmed',
      });
    }
  }
  if (!confirmed.length) throw firstError;
  return {
    confirmed,
    notCollected,
    collected: round2(confirmed.reduce((sum, p) => sum + p.amount, 0)),
    escrowApplied: round2(confirmed.reduce((sum, p) => sum + p.escrowApplied, 0)),
  };
}

/**
 * Confirm a payment the desk has just created. The payment is created in one
 * transaction and confirmed in the next, so between them the close or a
 * parent could fail it: confirmPayment then returns undefined, and the desk
 * must not answer "collected". If confirmation throws, the desk's own
 * payment is failed so its escrow comes back and a retry is not refused as
 * "in progress" (money audit review, second round).
 */
async function confirmDeskPayment(
  paymentId: string,
  staffId: string,
  notes: string,
  instrumentUsed: string,
  auditCtx?: AuditContext
) {
  let confirmed;
  try {
    confirmed = await confirmPayment(paymentId, staffId, undefined, notes, instrumentUsed, auditCtx);
  } catch (err) {
    await failPayment(paymentId, { from: ['pending'], reason: 'Desk collection could not be confirmed' })
      .catch((e) => console.error(`[desk] could not release payment ${paymentId}:`, e));
    throw err;
  }
  if (!confirmed) {
    throw new Error('The payment was closed before it could be confirmed — nothing was collected; please try again');
  }
}

/**
 * Take the money at the desk for subjects already registered and waiting for
 * payment (money audit MA-18). Families are sent to the desk after a
 * reversal, a rejected transfer or a cancelled checkout, and a register-only
 * desk visit leaves subjects in the same state; the desk could only register
 * new subjects, so it had no way to take that money.
 *
 * Same shape as a desk registration's collect step: one in-school payment
 * with the family as payer of record, escrow applied if asked, confirmed at
 * once through confirmPayment (receipts, notifications, audit rows).
 */
export async function collectAtDesk(staffId: string, data: DeskCollectType, auditCtx?: AuditContext) {
  // The year's school fee first, in a payment of its own (the registration gate asks for it; a
  // pushed fee is settled by it).
  const schoolFee = data.schoolFeeYear
    ? await collectSchoolFeeAtDesk(staffId, data.studentId, data.instrumentUsed, data.notes, data.schoolFeeYear, auditCtx)
    : null;
  if (!data.registrationIds.length && !data.chargeIds.length) {
    return { paymentId: schoolFee!.paymentId, payments: [], notCollected: [], collected: schoolFee!.amount, escrowApplied: 0, receipts: [], schoolFee };
  }
  try {
    const rest = await collectLinesAndCharges(staffId, data, auditCtx);
    return { ...rest, collected: round2(rest.collected + (schoolFee?.amount ?? 0)), schoolFee };
  } catch (err) {
    if (!schoolFee) throw err;
    // The fee is in; the rest was not taken: say so in the officer's words.
    return {
      paymentId: schoolFee.paymentId, payments: [], escrowApplied: 0, receipts: [], schoolFee, collected: schoolFee.amount,
      notCollected: [{ paymentId: '', series: ['The subjects and charges'], amount: await outstandingOf(data), reason: err instanceof Error ? err.message : 'Not collected' }],
    };
  }
}

/** What the lines and charges asked for would have cost (for a "not collected" line). */
async function outstandingOf(data: { registrationIds: string[]; chargeIds: string[] }) {
  const lines = data.registrationIds.length
    ? await db.select({ p: registration.priceAtRegistration }).from(registration).where(inArray(registration.id, data.registrationIds)) : [];
  const charges = data.chargeIds.length ? await db.select({ a: charge.amount }).from(charge).where(inArray(charge.id, data.chargeIds)) : [];
  return round2(lines.reduce((s, l) => s + l.p, 0) + charges.reduce((s, c) => s + c.a, 0));
}

async function collectLinesAndCharges(staffId: string, data: DeskCollectType, auditCtx?: AuditContext) {
  const lineIds = data.registrationIds;
  const regs = lineIds.length ? await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.id, lineIds),
    columns: { id: true, studentId: true, sessionId: true, subjectId: true, status: true, priceAtRegistration: true, boardSeriesId: true, attempt: true, priorSittingSeriesId: true, declarationRejected: true, priceProvisional: true },
  }) : [];
  if (regs.length !== lineIds.length || regs.some((r) => r.studentId !== data.studentId)) {
    throw new Error('One or more subjects do not belong to this student');
  }
  if (regs.some((r) => r.status !== 'pending_payment')) {
    throw coded(new Error('One or more subjects are not waiting for payment'), 'NOT_WAITING');
  }
  // May pay (§6), per line: waiting, not past its cut-off, its prices final, the student still at the school (F0a,
  // SO-7; the session's grade list does not enter). The session's or the subject's close does not stop it.
  await assertMayPay(db, regs.map((r) => ({ id: r.id, studentId: r.studentId, sessionId: r.sessionId, status: r.status, priceProvisional: r.priceProvisional })));
  // Consent (§3.5): a line nobody consented to is never paid; one the school reserved (grade 10)
  // takes the family's own pair here, "read and signed by the parent".
  const consent = await consentStanding(db, lineIds);
  if (consent.missing.length) throw new Error(CONSENT_MISSING_REFUSAL);
  if (consent.schoolOnly.length && !data.consent) throw new Error(FAMILY_CONSENT_NEEDED);

  // The reservations rework (§3.10 item 1): the student's charges in the same action, each group its own payment
  // (charges per service deadline or per plan line); the lines in one payment (the coordinator rework, §10).
  const chargeRows = data.chargeIds.length
    ? await db.select({ id: charge.id, studentId: charge.studentId, amount: charge.amount, kind: charge.kind, registrationId: charge.registrationId }).from(charge).where(inArray(charge.id, data.chargeIds))
    : [];
  if (chargeRows.length !== data.chargeIds.length || chargeRows.some((c) => c.studentId !== data.studentId)) {
    throw new Error('One or more charges do not belong to this student');
  }

  const totalCost = Math.round(regs.reduce((s, r) => s + r.priceAtRegistration, 0) * 100) / 100;
  const escrowToApply = data.escrowAmountToApply ?? 0;
  const chargeTotal = Math.round(chargeRows.filter((c) => c.kind !== 'instalment').reduce((s, c) => s + c.amount, 0) * 100) / 100;
  if (escrowToApply > totalCost + chargeTotal + 0.001) throw new Error('The amount from the balance cannot be more than the total cost');
  const payerParentId = await resolvePayerParent(data.studentId);
  const prices = new Map(regs.map((r) => [r.id, r.priceAtRegistration]));

  const payments = await db.transaction(async (tx) => {
    const made: DeskPayment[] = [];
    let escrowLeft = escrowToApply;
    // Every line the collection touches — the lines it pays and the plan lines of the instalments
    // it takes — in one id-ordered pass (§2.1: the lines in id order), before the charges: a fee
    // re-price or a series move takes the same lines in the same order, so neither waits on the
    // other holding a line the other has (the review of step C, item 5; 08t).
    const planLineIds = chargeRows.filter((c) => c.kind === 'instalment' && c.registrationId).map((c) => c.registrationId!);
    const touched = [...new Set([...lineIds, ...planLineIds])].sort();
    const held = touched.length
      ? await tx
        .select({
          id: registration.id, status: registration.status, price: registration.priceAtRegistration,
          studentId: registration.studentId, sessionId: registration.sessionId, priceProvisional: registration.priceProvisional,
        })
        .from(registration)
        .where(inArray(registration.id, touched))
        .orderBy(registration.id)
        .for('update')
      : [];
    if (lineIds.length) {
      // Same guard as an app checkout (MA-06): the subjects locked (above), then make sure
      // nothing else is already paying for them.
      const locked = held.filter((r) => lineIds.includes(r.id));
      if (locked.length !== lineIds.length || locked.some((r) => r.status !== 'pending_payment')) {
        throw coded(new Error('One or more subjects are not waiting for payment'), 'NOT_WAITING');
      }
      // The prices the desk's screen showed (P1c) and the prices read before the lock still hold: a re-price may
      // have committed since the screen was read, or in between (§3.4).
      assertExpectedPrices(locked, data.expectedPrices);
      if (locked.some((l) => l.price !== prices.get(l.id))) throw coded(new Error(PRICE_CHANGED_REFUSAL), 'PRICE_CHANGED');
      // May pay, asked again under the lines' locks (L2 of the P1b review): the cut-off may have passed, or the
      // student left, since the check above.
      await assertMayPay(tx, locked);
      // A line under a live plan is paid by its instalments only (§3.10 item 7).
      await assertNoLivePlan(tx, lineIds);
      const open = await tx
        .select({ ref: payment.externalReference, method: payment.paymentMethod })
        .from(paymentRegistration)
        .innerJoin(payment, eq(payment.id, paymentRegistration.paymentId))
        .where(and(inArray(paymentRegistration.registrationId, lineIds), inArray(payment.status, ['pending', 'pending_verification'])));
      if (open.length > 0) {
        throw new Error(
          `These subjects already have a ${open[0]!.method === 'instapay' ? 'transfer' : 'checkout'} in progress — confirm it or reject it in the Finance Workbench first`
        );
      }
      if (consent.schoolOnly.length) await writeConsents(tx, consent.schoolOnly, { channel: 'desk', confirmedBy: staffId });
      // One payment for the lines (§10), with its creation audit row.
      const lineEscrow = Math.min(escrowLeft, totalCost);
      escrowLeft = Math.round((escrowLeft - lineEscrow) * 100) / 100;
      const p = await createDeskPayment(tx, { studentId: data.studentId, payerParentId, staffId, escrowToApply: lineEscrow, registrationIds: lineIds, prices });
      await logAction(staffId, 'PAYMENT_INITIATED', 'payment', p.id, null,
        { desk: true, registrationIds: p.registrationIds, amount: p.amount, escrowApplied: p.escrowApplied }, auditCtx, tx);
      made.push(p);
    }
    if (data.chargeIds.length) {
      const expected = new Map(chargeRows.map((c) => [c.id, c.amount]));
      const charges = await createChargePaymentsInTx(tx, {
        studentId: data.studentId, payerParentId, actorId: staffId, chargeIds: data.chargeIds, method: 'in_school', escrowToApply: escrowLeft, desk: true, expected, auditCtx,
        linesHeld: true,
      });
      made.push(...charges.map((c) => ({ id: c.id, amount: c.amount, escrowApplied: c.escrowApplied, registrationIds: [] as string[], chargeIds: c.chargeIds, series: [c.description] })));
    }
    return made;
  });

  const outcome = await confirmDeskPayments(payments, staffId, data.notes ?? 'Collected at the finance desk', data.instrumentUsed, auditCtx);

  // Only receipts ready to hand over; a void one is never offered (MA-20).
  const receipts = await db.query.receipt.findMany({
    where: (r, { inArray: inArr, and: andOp, eq: eqOp, or: orOp }) =>
      andOp(orOp(inArr(r.registrationId, [...lineIds, '__none__']), inArr(r.chargeId, [...data.chargeIds, '__none__'])), eqOp(r.status, 'pending_issue')),
    columns: { id: true, registrationId: true, chargeId: true, receiptNumber: true, status: true },
  });
  return {
    paymentId: outcome.confirmed[0]!.id,
    payments: outcome.confirmed.map((p) => ({ id: p.id, series: p.series, collected: p.amount, escrowApplied: p.escrowApplied, registrationIds: p.registrationIds, chargeIds: p.chargeIds ?? [] })),
    notCollected: outcome.notCollected,
    collected: outcome.collected,
    escrowApplied: outcome.escrowApplied,
    receipts,
  };
}

/**
 * Collect the annual school fee at the desk — gate unlocks immediately.
 */
const SCHOOL_FEE_IN_PROGRESS = 'A school-fee payment is already in progress for this student — confirm or reject it instead';

export async function collectSchoolFeeAtDesk(
  staffId: string,
  studentId: string,
  instrumentUsed: string,
  notes?: string,
  requestedAcademicYear?: string,
  auditCtx?: AuditContext
) {
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: { id: true },
  });
  if (!student) throw new Error('Student not found');

  // The caller may name the year explicitly — around the 1 July
  // rollover the year the registration gate demands is not the year
  // today falls in, which left officers unable to pay the year that was
  // actually blocking the registration in front of them.
  const academicYear = requestedAcademicYear ?? academicYearForDate(new Date());
  // Same source of truth as every screen (RF-10): a waived family must not
  // be charged at the desk any more than shown a "due" badge. The fee is the
  // one for the student's grade in that year (F0a).
  const standing = await getSchoolFeeStanding(studentId, await studentGradeInYear(studentId, academicYear), academicYear);
  const fee = standing.fee;
  if (!fee) throw new Error('No school fee is currently open for this student');
  if (standing.waived) {
    throw new Error(`The ${academicYear} school fee is waived for this student — nothing to collect`);
  }
  if (standing.paid) {
    throw new Error(`The ${academicYear} school fee is already paid`);
  }
  // A family's own checkout for it (a transfer being checked, or pay-at-school)
  // is confirmed or rejected from the workbench, not collected again here.
  const open = await db.query.payment.findFirst({
    where: (p, { eq: eqOp, and: andOp, inArray: inArr }) =>
      andOp(eqOp(p.studentId, studentId), eqOp(p.purpose, 'school_fee'), eqOp(p.academicYear, academicYear), inArr(p.status, ['pending', 'pending_verification'])),
    columns: { id: true },
  });
  if (open) throw new Error(SCHOOL_FEE_IN_PROGRESS);

  const paymentId = randomUUID();
  const payerParentId = await resolvePayerParent(studentId);
  await db.transaction(async (tx) => {
    // The unique index (one open or paid school fee per student and year) is
    // what stops two collections at the same moment (state audit ST-02).
    await tx.insert(payment).values({
      id: paymentId,
      studentId,
      parentId: payerParentId, // the family, not the officer (RF-03)
      amount: fee.amount,
      escrowAmountApplied: 0,
      paymentMethod: 'in_school',
      purpose: 'school_fee',
      academicYear,
      status: 'pending',
      externalReference: `DESK-${paymentId.slice(0, 8).toUpperCase()}`,
      metadata: { desk: true, staffId },
    }).catch((err) => {
      if ((err as { cause?: { code?: string } } | null)?.cause?.code === '23505') throw new Error(SCHOOL_FEE_IN_PROGRESS);
      throw err;
    });
    // Written with the payment it describes (MO-1); the confirmation writes its own row.
    await logAction(staffId, 'DESK_SCHOOL_FEE_COLLECTED', 'payment', paymentId, null,
      { paymentId, academicYear, amount: fee.amount, instrumentUsed }, auditCtx, tx);
  });

  await confirmDeskPayment(paymentId, staffId, notes ?? 'School fee collected at desk', instrumentUsed, auditCtx);

  return { paymentId, academicYear, amount: fee.amount };
}

/**
 * The family member of record for money taken at the desk (RF-03). Desk
 * money belongs to the family, not to the officer taking it: the earliest
 * approved linked parent becomes payment.parentId so payment confirmations
 * reach them. With several linked parents the earliest link wins, which is
 * an arbitrary tie-break; the other parents are NOT notified today (NOT-010,
 * "every linked parent hears about their child", is deferred to the
 * notification audit).
 *
 * A student with no approved parent link cannot pay at the desk: there would
 * be nobody to notify and nobody accountable for the money. The officer
 * onboards the parent first (one form, see onboardFamily) and tries again.
 */
async function resolvePayerParent(studentId: string): Promise<string> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) => and(eq(l.studentId, studentId), eq(l.status, 'approved')),
    orderBy: (l, { asc }) => [asc(l.createdAt)],
    columns: { parentId: true },
  });
  if (!link) {
    throw new Error(
      'This student has no linked parent — use New Family (Onboard) to add the parent before taking money'
    );
  }
  return link.parentId;
}

// ─── Student 360 (G2) ────────────────────────────────────────────────────────

/**
 * Everything about one student on one screen — the desk's answer to
 * "what is Ahmed registered in, what has he paid, what does he owe?"
 */
export async function getStudentSummary(studentId: string) {
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: {
      id: true, name: true, email: true, phone: true,
      cohortYear: true, studentId: true, createdAt: true, role: true,
      leftOn: true, leftKind: true, leftReason: true,
    },
    extras: gradeTodayExtras,
  });
  if (!student) throw new Error('Student not found');
  // Scope strictly to students: without this the Student-360 endpoint
  // would profile staff and admin accounts (name, phone, family graph)
  // for any finance user who guessed an id.
  if (student.role !== 'student') throw new Error('Student not found');

  const [links, escrowAccount, registrations, payments, exceptions, remarks] =
    await Promise.all([
      db.query.parentStudentLink.findMany({
        where: (l, { eq }) => eq(l.studentId, studentId),
        with: { parent: { columns: { id: true, name: true, email: true, phone: true } } },
      }),
      db.query.escrow.findFirst({
        where: (e, { eq }) => eq(e.studentId, studentId),
        columns: { balance: true, heldBalance: true },
      }),
      db.query.registration.findMany({
        where: (r, { eq }) => eq(r.studentId, studentId),
        with: {
          // Its level gives the subject's group, as every screen names it ("Biology O.L.", P4a fix round 5).
          subject: { columns: { id: true, name: true, code: true, council: true, qualificationLevel: true } },
          session: { columns: { id: true, name: true, status: true } },
          teacher: { columns: { id: true, name: true } },
        },
        orderBy: (r, { desc }) => [desc(r.createdAt)],
      }),
      db.query.payment.findMany({
        where: (p, { eq }) => eq(p.studentId, studentId),
        columns: {
          id: true, amount: true, escrowAmountApplied: true, paymentMethod: true,
          purpose: true, status: true, instrumentUsed: true, externalReference: true,
          createdAt: true, confirmedAt: true,
          // For "Transfer found" on a failed InstaPay payment (recordLateTransfer).
          verificationReference: true, lateTransferAt: true,
        },
        orderBy: (p, { desc }) => [desc(p.createdAt)],
        limit: 20,
      }),
      // The student's own and the family's (a parent account's exception covers every linked
      // child, RESERVATIONS_REWORK.md §3.7), on the registry's keys.
      db.query.exception.findMany({
        where: (e, { eq, and, or, inArray }) => and(
          or(
            eq(e.studentId, studentId),
            inArray(e.familyId, db.select({ id: parentStudentLink.parentId }).from(parentStudentLink)
              .where(and(eq(parentStudentLink.studentId, studentId), eq(parentStudentLink.status, 'approved')))),
          ),
          eq(e.status, 'active'),
        ),
        columns: {
          id: true, type: true, policyKey: true, value: true, valueNumber: true, valueDate: true, reason: true, validUntil: true,
          familyId: true, sessionId: true, subjectId: true, registrationId: true, chargeId: true,
        },
      }),
      db.query.remarkRequest.findMany({
        where: (r, { eq }) => eq(r.studentId, studentId),
        columns: { id: true, serviceType: true, status: true, feeCharged: true },
        with: {
          registration: {
            columns: { id: true },
            with: { subject: { columns: { name: true, code: true } } },
          },
        },
      }),
    ]);

  const lineExceptions = await exceptionsOfLines(db, registrations);
  const receipts = await db.query.receipt.findMany({
    where: (r, { inArray }) =>
      inArray(r.registrationId, registrations.map((reg) => reg.id).concat('__none__')),
    columns: { id: true, registrationId: true, receiptNumber: true, status: true, refundAmountOnReturn: true },
  });
  const receiptByReg = new Map(receipts.map((r) => [r.registrationId, r]));

  // School-fee status. Check the year containing today AND the academic
  // year of every open series — a November window opening in June belongs
  // to the next year, and reporting only "today's" year told officers the
  // fee was paid while registration kept refusing for the series' year. The
  // fee is the one for the student's grade in each year (F0a).
  const academicYear = academicYearForDate(new Date());
  const openSessionRows = await db.query.registrationSession.findMany({
    where: (sn, { eq }) => eq(sn.status, 'active'),
    columns: { id: true },
  });
  const openEligibility = await Promise.all(openSessionRows.map((sn) => mayRegisterFor(studentId, sn.id)));
  const candidateYears = [
    ...new Set([academicYear, ...openEligibility.filter((e) => e.allowed && !e.graduateRetake).map((e) => e.academicYear)]),
  ];

  // One source of truth for the fee (RF-10): this screen used to tell the
  // officer to collect a fee the finance admin had waived.
  const schoolFeesDue: { academicYear: string; amount: number }[] = [];
  for (const year of candidateYears) {
    const standing = await getSchoolFeeStanding(studentId, gradeInAcademicYear(student.cohortYear, academicYearStartFromLabel(year)!), year);
    if (!standing.fee || standing.settled) continue;
    schoolFeesDue.push({ academicYear: year, amount: standing.fee.amount });
  }

  const currentStanding = await getSchoolFeeStanding(studentId, student.grade, academicYear);
  const fee = currentStanding.fee;

  // A payment under way for a waiting line (F8-09): the family's InstaPay transfer waiting for finance's check,
  // or a checkout they started (pay at the desk, a transfer with no reference yet). Such a line is not collected
  // at the desk — the collection would be refused — until the Finance Workbench confirms or rejects it.
  const waitingLineIds = registrations.filter((r) => r.status === 'pending_payment').map((r) => r.id);
  // The payment's own amount, what the balance paid and its reference ride with it (P4a fix round 4): the desk shows the
  // figure recorded, not a sum of line prices, whatever the payment's age.
  const underWay = waitingLineIds.length
    ? await db.select({
      registrationId: paymentRegistration.registrationId, paymentId: payment.id, status: payment.status, method: payment.paymentMethod,
      amount: payment.amount, escrowApplied: payment.escrowAmountApplied, reference: payment.externalReference,
    })
      .from(paymentRegistration).innerJoin(payment, eq(payment.id, paymentRegistration.paymentId))
      .where(and(inArray(paymentRegistration.registrationId, waitingLineIds), inArray(payment.status, ['pending', 'pending_verification'])))
    : [];
  const inProgressOf = new Map(underWay.map((u) => [u.registrationId, {
    paymentId: u.paymentId, status: u.status as 'pending' | 'pending_verification', method: u.method,
    amount: u.amount, escrowApplied: u.escrowApplied, reference: u.reference,
  }]));

  // Every payment the family started and has not finished, whatever it pays for (P4a fix round 2): subjects, charges
  // (board services, instalments, adjustments), the school fee, a remark. A pay-at-school one is taken at the desk with
  // the instrument (the officer's confirm route); the others are named with what to do.
  const open = await db.select({
    id: payment.id, purpose: payment.purpose, status: payment.status, method: payment.paymentMethod, amount: payment.amount,
    escrowApplied: payment.escrowAmountApplied, reference: payment.externalReference, academicYear: payment.academicYear, createdAt: payment.createdAt,
  }).from(payment).where(and(eq(payment.studentId, studentId), inArray(payment.status, ['pending', 'pending_verification'])));
  const openIds = open.map((p) => p.id);
  const openCharges = openIds.length
    ? await db.select({ paymentId: paymentCharge.paymentId, chargeId: charge.id, description: charge.description, kind: charge.kind })
      .from(paymentCharge).innerJoin(charge, eq(charge.id, paymentCharge.chargeId)).where(inArray(paymentCharge.paymentId, openIds))
    : [];
  const openLines = openIds.length
    ? await db.select({ paymentId: paymentRegistration.paymentId, registrationId: paymentRegistration.registrationId })
      .from(paymentRegistration).where(inArray(paymentRegistration.paymentId, openIds))
    : [];
  const openPayments = open.map((p) => ({
    ...p,
    status: p.status as 'pending' | 'pending_verification',
    registrationIds: openLines.filter((l) => l.paymentId === p.id).map((l) => l.registrationId),
    charges: openCharges.filter((c) => c.paymentId === p.id).map((c) => ({ id: c.chargeId, description: c.description, kind: c.kind })),
  }));

  // What does the family owe right now (mayPay, §6)? A line whose prices are not final is reserved, not payable,
  // until they are (E6); a line past its cut-off is no longer payable (the sweep expires it). A line with a
  // payment under way is owed, not collectable now: it is counted apart (owingInProgress).
  const cutOffs = await cutOffsOf(db, waitingLineIds);
  const now = new Date();
  const owedNow = (r: (typeof registrations)[number]) =>
    r.status === 'pending_payment' && !r.priceProvisional && !((cutOffs.get(r.id)?.cutOff ?? Infinity) <= now);
  const payableNow = (r: (typeof registrations)[number]) => owedNow(r) && !inProgressOf.has(r.id);
  // A line under a live plan owes its price less the deposits held for it (its instalments still
  // to pay); the charges owed (not instalments — the line counts them — nor a pushed school fee,
  // which is the fee badge) are owed beside the lines (step C; the statement counts the same).
  const planLineIds = new Set(exceptions.filter((e) => e.policyKey === 'plan.instalments' && e.registrationId).map((e) => e.registrationId!));
  const depositRows = planLineIds.size
    ? await db.execute(sql`select r.id, ${lineDepositsSql('r')} as deposits from registration r where r.id in (${sql.join([...planLineIds].map((id) => sql`${id}`), sql`, `)})`)
      .then((x) => x.rows as { id: string; deposits: string }[])
    : [];
  const depositsOf = new Map(depositRows.map((d) => [d.id, Number(d.deposits)]));
  const owedCharges = await db.select({ amount: charge.amount }).from(charge)
    .where(and(eq(charge.studentId, studentId), eq(charge.status, 'pending_payment'), notInArray(charge.kind, ['instalment', 'school_fee_push'])));
  const owing = round2(registrations.filter(payableNow).reduce((sum, r) => sum + (planLineIds.has(r.id) ? Math.max(0, r.priceAtRegistration - (depositsOf.get(r.id) ?? 0)) : r.priceAtRegistration), 0)
    + owedCharges.reduce((sum, c) => sum + c.amount, 0));
  const owingInProgress = round2(registrations.filter((r) => owedNow(r) && inProgressOf.has(r.id)).reduce((sum, r) => sum + r.priceAtRegistration, 0));

  // Which waiting lines carry the school's consent only (grade 10, reserved by the school): the desk
  // asks the parent's own tick when it collects those, and only those (F6: the tick showed for lines
  // the family had reserved itself, consent given). The checkout reads the same (`consentStanding`).
  const familyConsentNeeded = new Set((await consentStanding(db, waitingLineIds)).schoolOnly);

  // The academic record (F0a): grade, cohort, section, status.
  const today = standingToday(student);
  const currentSection = await sectionOf(studentId);

  return {
    student,
    academic: {
      grade: today.grade,
      gradeLabel: gradeLabel(today.grade),
      standing: today.standing,
      academicYear: today.academicYear,
      cohortLabel: student.cohortYear === null ? null : academicYearShortLabel(student.cohortYear),
      section: currentSection ? { id: currentSection.sectionId, name: currentSection.name, grade: currentSection.grade } : null,
      currentAcademicYearStart: academicYearStartOf(),
    },
    parents: links.map((l) => ({ ...l.parent, linkStatus: l.status })),
    escrow: {
      freeBalance: escrowAccount?.balance ?? 0,
      heldBalance: escrowAccount?.heldBalance ?? 0,
    },
    schoolFee: {
      academicYear,
      required: currentStanding.required,
      waived: currentStanding.waived,
      amount: fee?.amount ?? null,
      paid: currentStanding.paid,
    },
    // Every year still owed — may include a session year that is not
    // the year containing today
    schoolFeesDue,
    owing,
    // Owed by lines whose payment is under way (the transfer's check, a started checkout): "Owes now" says it apart.
    owingInProgress,
    openPayments,
    registrations: registrations.map((r) => ({
      ...r,
      payableNow: payableNow(r),
      // The last moment it can be paid (§6: due date + the session's days, or the board deadline if earlier); null once paid.
      cutOff: cutOffs.get(r.id)?.cutOff ?? null,
      paymentInProgress: inProgressOf.get(r.id) ?? null,
      // Under a live instalment plan (§3.6): paid by its instalments, never collected as a line. A
      // plan released in full or ended is not live: the line is collected in full again.
      livePlan: exceptions.some((e) => e.policyKey === 'plan.instalments' && e.registrationId === r.id),
      // A grade-10 line the school reserved: the family's own consent goes with its collection.
      familyConsentNeeded: familyConsentNeeded.has(r.id),
      receipt: receiptByReg.get(r.id) ?? null,
      // The exceptions that touched the line: priced it, are scoped to it, or let it through (§4.7).
      exceptions: lineExceptions.get(r.id) ?? [],
    })),
    payments,
    exceptions,
    remarks,
  };
}
