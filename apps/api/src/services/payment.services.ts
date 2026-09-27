/**
 * Payment Service
 *
 * Business logic for the full payment lifecycle (PAY-001 to PAY-007):
 * - Parent initiates payment for pending_payment registrations
 * - Escrow balance applied at checkout (PAY-005)
 * - Automated confirmation via Fawry / Paymob webhooks
 * - Manual confirmation for bank transfers by admin (PAY-007)
 * - Failed payments trigger automatic escrow refund if escrow was applied
 *
 * Payment flow:
 * 1. Parent calls initiatePayment → payment created (pending), escrow debited if applied
 * 2. Provider-specific reference/URL returned to client
 * 3. On success: confirmPayment → registrations → 'confirmed', payment → 'completed'
 * 4. On failure: failPayment → escrow refunded, payment → 'failed'
 *
 * Key invariants:
 * - One payment covers registrations for exactly ONE student
 * - Only parents can initiate payments; parent must be linked to the student
 * - Escrow is debited at initiation, refunded if payment fails (OI-010 enforced)
 *
 * All database imports come from @repo/db — never from drizzle-orm directly.
 * Escrow primitives are imported from escrow.services.ts (single source of truth).
 */

import {
  db,
  payment,
  paymentRegistration,
  registration,
  registrationSession,
  receipt,
  eq,
  and,
  inArray,
  lte,
  isNotNull,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type {
  InitiatePaymentType,
  ListPaymentsQueryType,
  SubmitInstapayReferenceType,
} from '@repo/validations';
// V3 (§6.11): legacy provider integrations are disabled — only in-school and
// InstaPay (manual verification) are active. Kept for when a PSP ships a real
// InstaPay API (Paymob lists it "Coming Soon").
// import { generateFawryPayment } from '../integrations/fawry';
// import { createPaymobOrder } from '../integrations/paymob';
// import { initiateWalletPayment, type WalletProvider } from '../integrations/wallet';
import { env } from '../env';
import {
  getOrCreateEscrow,
  getEscrowBalance,
  creditEscrow,
  debitEscrow,
} from './escrow.services';
import { logAction, type AuditContext } from './audit.services';
import { sessionOpenFor, sessionWindow, entryDeadlineMessage, schoolDateTime } from './window.services';
import {
  notifyPaymentConfirmed,
  notifyPaymentReversed,
  notifyPaymentRejected,
  notifyPaymentExpired,
  notifyPaymentClosedAtEntryDeadline,
  notifyRegistrationsExpiredAtEntryDeadline,
  notifyEscrowBalanceChanged,
} from './notification.services';
import { createReceiptsForRegistrations } from './receipt.services';
import { creditHeld } from './escrow.services';
import { onRemarkPaymentCompleted } from './remark.services';
import { isOwnDocument } from './file.services';

// ─── School Receiving Account (InstaPay destination) ─────────────────────────
//
// InstaPay has no merchant API and the app is individuals-only, so the school
// publishes its corporate account; parents transfer to it via InstaPay and
// submit the transaction reference for finance verification (V3_PLAN §2.3).
// Statuses that mean "money may still arrive for this payment" — used by the
// double-payment guards and the manual-confirmation queue.
const OPEN_PAYMENT_STATUSES = ['pending', 'pending_verification'] as const;

function getSchoolAccountDetails() {
  return {
    bankName:      env.SCHOOL_BANK_NAME ?? 'National Bank of Egypt',
    accountName:   env.SCHOOL_ACCOUNT_NAME ?? 'IGCSE School',
    accountNumber: env.SCHOOL_ACCOUNT_NUMBER ?? '0012345678901234',
    iban:          env.SCHOOL_IBAN ?? null,
  };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}


/**
 * Verify that a parent has an approved link to a specific student.
 */
async function validateParentStudentLink(
  parentId: string,
  studentId: string
): Promise<boolean> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) =>
      and(
        eq(l.parentId, parentId),
        eq(l.studentId, studentId),
        eq(l.status, 'approved')
      ),
    columns: { id: true },
  });
  return !!link;
}

// ─── Public Service Functions ─────────────────────────────────────────────────

/**
 * Initiate a payment for one or more registrations in 'pending_payment' status.
 *
 * Rules enforced:
 * - All registrations must belong to the same student
 * - Parent must be linked (approved) to that student
 * - All registrations must be in 'pending_payment' status
 * - escrowAmountToApply must not exceed the student's available balance
 * - amount charged to payment method = total cost − escrow applied
 * - Escrow is debited immediately at initiation; refunded on payment failure
 *
 * Returns the payment record with provider-specific metadata.
 */
export async function initiatePayment(
  parentId: string,
  data: InitiatePaymentType
) {
  // Load registrations
  const regs = await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.id, data.registrationIds),
    with: { student: { columns: { id: true, name: true, email: true } } },
  });

  if (regs.length === 0) throw new Error('No registrations found');
  if (regs.length !== data.registrationIds.length) {
    throw new Error('One or more registrations not found');
  }

  // All registrations must be for the same student
  const studentIds = [...new Set(regs.map((r) => r.studentId))];
  if (studentIds.length > 1) {
    throw new Error('All registrations must belong to the same student');
  }
  const studentId = studentIds[0]!;

  // Validate parent-child link
  const linked = await validateParentStudentLink(parentId, studentId);
  if (!linked) throw new Error('You are not linked to this student');

  // All must be in pending_payment, OR (V3 §6.8) all preregistered —
  // a prereg payment funds the held wallet for a future session.
  const isPrereg = regs.every((r) => r.status === 'preregistered');
  if (!isPrereg) {
    const notReady = regs.filter((r) => r.status !== 'pending_payment');
    if (notReady.length > 0) {
      throw new Error('One or more registrations are not ready for payment');
    }
  }

  // Session-state gate: open registrations need ACTIVE sessions
  // (REG-005/SES-006 — otherwise a parent could be charged for rows the
  // scheduler is about to expire); preregistrations need DRAFT sessions.
  const sessionIds = [...new Set(regs.map((r) => r.sessionId))];
  const sessions = await db.query.registrationSession.findMany({
    where: (s, { inArray }) => inArray(s.id, sessionIds),
    columns: { id: true, status: true, name: true, entryDeadline: true },
  });
  const wrongState: typeof sessions = [];
  for (const s of sessions) {
    // A preregistration past its series' board deadline can never be entered (MO-10).
    if (isPrereg && s.entryDeadline && s.entryDeadline <= new Date()) throw new Error(entryDeadlineMessage(s.entryDeadline));
    const ok = isPrereg ? s.status === 'draft' : await sessionOpenFor(studentId, s.id);
    if (!ok) wrongState.push(s);
  }
  if (wrongState.length > 0) {
    const names = wrongState.map((s) => s.name).join(', ');
    throw new Error(
      isPrereg
        ? `These sessions have already opened — pay through the normal flow: ${names}`
        : `Registration window is closed for: ${names}`
    );
  }

  // Held-wallet funding is provider money only — no escrow application
  if (isPrereg && (data.escrowAmountToApply ?? 0) > 0) {
    throw new Error('Escrow cannot be applied to preregistration payments');
  }

  // Check for existing pending payments on any of these registrations
  const existingPaymentLinks = await db.query.paymentRegistration.findMany({
    where: (pr, { inArray }) => inArray(pr.registrationId, data.registrationIds),
    with: {
      payment: { columns: { id: true, status: true } },
    },
  });
  const hasPendingPayment = existingPaymentLinks.some(
    (pl) => (OPEN_PAYMENT_STATUSES as readonly string[]).includes(pl.payment.status)
  );
  if (hasPendingPayment) {
    throw new Error(
      'One or more registrations already have a pending payment. Complete or wait for it to expire first.'
    );
  }

  // Calculate total registration cost
  const totalCost = regs.reduce((sum, r) => sum + r.priceAtRegistration, 0);

  // Validate escrow application
  const escrowToApply = data.escrowAmountToApply ?? 0;
  if (escrowToApply > 0) {
    const balance = await getEscrowBalance(studentId);
    if (escrowToApply > balance) {
      throw new Error(
        `Escrow balance insufficient. Available: ${balance.toFixed(2)} EGP, Requested: ${escrowToApply.toFixed(2)} EGP`
      );
    }
    if (escrowToApply > totalCost) {
      throw new Error('Escrow amount cannot exceed the total registration cost');
    }
  }

  const paymentMethodAmount = Math.max(0, totalCost - escrowToApply);
  const paymentId = randomUUID();
  const student = regs[0]!.student;

  // When escrow fully covers the cost, skip the provider entirely —
  // there is nothing to charge. We still create a payment record so the
  // transaction has an auditable receipt, then confirm it immediately
  // after the initiation transaction commits so registrations advance to
  // 'confirmed' and NOT-005 fires through the same path as a real webhook.
  const fullyEscrowFunded = paymentMethodAmount === 0 && escrowToApply > 0;

  // Build method-specific metadata (skipped when escrow covers the whole cost).
  // V3: both active methods are manual — no provider call happens here.
  let metadata: Record<string, unknown> = {};
  let externalReference: string | undefined;

  if (!fullyEscrowFunded) {
    if (data.paymentMethod === 'in_school') {
      // Parent pays at the finance desk; a payment reference makes the
      // desk lookup instant (searchable in the Finance Workbench).
      const referenceNumber = `SCH-${paymentId.slice(0, 8).toUpperCase()}`;
      externalReference = referenceNumber;
      metadata = {
        inSchool: { referenceNumber },
        instructions: 'Pay at the school finance desk. Quote this reference or the student name.',
      };
    } else if (data.paymentMethod === 'instapay') {
      // Parent transfers to the school's corporate account via InstaPay,
      // then submits the transaction reference for finance verification.
      metadata = {
        instapay: {
          account: getSchoolAccountDetails(),
          amountDue: paymentMethodAmount,
        },
        instructions:
          'Transfer the exact amount via InstaPay to the school account, then submit your transaction reference.',
      };
    }
    // Legacy providers (fawry/card/mobile_wallet/bank_transfer) are disabled
    // in V3 — InitiatePayment validation no longer accepts them.
  } else {
    metadata = { fullyEscrowFunded: true };
  }

  // Atomic transaction: create payment + debit escrow + link registrations.
  // Order matters: the escrow_transaction row created by debitEscrow carries
  // a FK to payment.id, so the payment row MUST exist first. Running the
  // three operations in the same transaction still preserves all-or-nothing
  // semantics — if the debit or linking fails, the payment insert rolls back.
  const created = await db.transaction(async (tx) => {
    // Lock the registrations first, then re-check for an open payment (EDGE-3).
    // Without the lock the re-check proved nothing: under READ COMMITTED two
    // concurrent checkouts each read "no open payment" before either commits,
    // so both created a payment and both debited escrow (money audit MA-06).
    // With it, the second checkout waits here and then sees the first's link.
    const locked = await tx
      .select({ id: registration.id, status: registration.status })
      .from(registration)
      .where(inArray(registration.id, data.registrationIds))
      .for('update');
    const expected = isPrereg ? 'preregistered' : 'pending_payment';
    if (locked.length !== data.registrationIds.length || locked.some((r) => r.status !== expected)) {
      throw new Error('One or more registrations are not ready for payment');
    }

    const existingPaymentLinksInTx = await tx.query.paymentRegistration.findMany({
      where: (pr, { inArray: inArr }) => inArr(pr.registrationId, data.registrationIds),
      with: {
        payment: { columns: { id: true, status: true } },
      },
    });
    const hasPendingPaymentInTx = existingPaymentLinksInTx.some(
      (pl) => (OPEN_PAYMENT_STATUSES as readonly string[]).includes(pl.payment.status)
    );
    if (hasPendingPaymentInTx) {
      throw new Error(
        'One or more registrations already have a pending payment. Complete or wait for it to expire first.'
      );
    }
    // A paid preregistration is still 'preregistered', so its status alone
    // let it be paid again and its price held twice (money audit review).
    if (existingPaymentLinksInTx.some((pl) => pl.payment.status === 'completed')) {
      throw new Error('One or more of these subjects is already paid for.');
    }

    // 1. Create payment record FIRST so the escrow_transaction FK can resolve.
    const [paymentRecord] = await tx
      .insert(payment)
      .values({
        id: paymentId,
        studentId,
        parentId,
        amount: paymentMethodAmount,
        escrowAmountApplied: escrowToApply,
        paymentMethod: data.paymentMethod,
        purpose: isPrereg ? 'preregistration' : 'registration',
        status: 'pending',
        externalReference: externalReference ?? null,
        metadata,
      })
      .returning();

    // 2. Debit escrow now that the payment row exists to be referenced.
    if (escrowToApply > 0) {
      await debitEscrow({
        studentId,
        amount: escrowToApply,
        reason: 'payment',
        initiatedBy: parentId,
        relatedPaymentId: paymentId,
      }, tx);
    }

    // 3. Link registrations to payment.
    const paymentRegRecords = data.registrationIds.map((regId) => ({
      id: randomUUID(),
      paymentId,
      registrationId: regId,
    }));
    await tx.insert(paymentRegistration).values(paymentRegRecords);

    return paymentRecord;
  });

  // NOT-008: Notify parents of escrow debit from payment initiation (fire-and-forget)
  if (escrowToApply > 0) {
    const newBalance = await getEscrowBalance(studentId);
    notifyEscrowBalanceChanged({
      studentId,
      studentName: student.name,
      previousBalance: newBalance + escrowToApply,
      newBalance,
      changeAmount: -escrowToApply,
      reason: `Escrow applied to payment for ${regs.length} subject(s)`,
    }).catch((err) => console.error('[notification] NOT-008 (payment debit) failed:', err));
  }

  // Fully escrow-funded: auto-confirm now. Re-uses confirmPayment so the
  // registration transitions, REGISTRATION_CONFIRMED audit rows, and NOT-005
  // receipt email fire through the same code path as a real webhook.
  // confirmPayment is idempotent (status-guarded UPDATE), so it is safe here.
  if (fullyEscrowFunded) {
    const confirmed = await confirmPayment(
      paymentId,
      parentId,
      undefined,
      'Auto-confirmed: fully paid from escrow'
    );
    if (confirmed) {
      return { ...confirmed, metadata: { ...metadata, fullyEscrowFunded: true } };
    }
  }

  return { ...created, metadata };
}

/**
 * Confirm a payment as completed.
 *
 * Called by:
 * - Fawry/Paymob/wallet webhooks when payment is verified
 * - Admin manually confirming a bank transfer (PAY-007)
 *
 * Moves payment to 'completed' and all linked registrations to 'confirmed'.
 * Returns undefined when another caller confirmed it first.
 *
 * The PAYMENT_CONFIRMED and REGISTRATION_CONFIRMED audit rows are written
 * inside the same transaction, so a confirmation and its audit rows commit
 * together, and a caller who lost the race writes none (money audit MA-07, O-7).
 */
export async function confirmPayment(
  paymentId: string,
  confirmedBy?: string,
  externalRef?: string,
  adminNotes?: string,
  instrumentUsed?: string,
  auditCtx?: AuditContext,
) {
  const pay = await db.query.payment.findFirst({
    where: (p, { eq }) => eq(p.id, paymentId),
  });

  if (!pay) throw new Error('Payment not found');
  if (!(OPEN_PAYMENT_STATUSES as readonly string[]).includes(pay.status)) {
    // The desk's likeliest surprise: the family cancelled a pay-at-school
    // checkout in the app before handing the money over.
    if ((pay.metadata as Record<string, unknown> | null)?.cancellation) {
      throw new Error(`Payment is already in 'failed' status — the parent cancelled this checkout in the app. Take the payment through the desk instead.`);
    }
    throw new Error(`Payment is already in '${pay.status}' status`);
  }

  const now = new Date();
  const isPreregPayment = pay.purpose === 'preregistration';

  // Atomic transaction: update payment status + confirm all linked registrations
  const { updated } = await db.transaction(async (tx) => {
    // Lock the payment, then its registrations, and judge them under the lock.
    // This check used to run before the transaction, so a session could close
    // (expiring the registrations) between the check and the confirmation,
    // leaving a completed payment on expired registrations (money audit MA-12).
    const [current] = await tx
      .select({ status: payment.status })
      .from(payment)
      .where(eq(payment.id, paymentId))
      .for('update');
    if (!current || !(OPEN_PAYMENT_STATUSES as readonly string[]).includes(current.status)) {
      return { updated: undefined, registrationIds: [] as string[] };
    }

    const regIds = (
      await tx
        .select({ registrationId: paymentRegistration.registrationId })
        .from(paymentRegistration)
        .where(eq(paymentRegistration.paymentId, paymentId))
    ).map((l) => l.registrationId);
    const regs = regIds.length
      ? await tx
          .select({
            id: registration.id,
            status: registration.status,
            sessionId: registration.sessionId,
            price: registration.priceAtRegistration,
          })
          .from(registration)
          .where(inArray(registration.id, regIds))
          .for('update')
      : [];

    // M-12: registrations must still be payable. A prereg payment's rows are
    // preregistered (or pending_payment if the session opened first). Anything
    // else needs a window that is open for this student — or a transfer
    // awaiting verification: a registration it held past the close stays
    // confirmable after it (money audit MA-01), until the exam board's entry
    // deadline, after which nothing more can be entered (MO-10).
    for (const r of regs) {
      if (isPreregPayment) {
        if (r.status === 'preregistered' || r.status === 'pending_payment') {
          // A preregistration is for a later series; past that series' board
          // deadline it cannot be entered either (MO-10).
          const w = await sessionWindow(pay.studentId, r.sessionId, tx);
          if (w.entryDeadlinePassed) throw new Error(entryDeadlineMessage(w.entryDeadline!));
          continue;
        }
      } else if (r.status === 'pending_payment') {
        const w = await sessionWindow(pay.studentId, r.sessionId, tx);
        if (w.open || (current.status === 'pending_verification' && !w.entryDeadlinePassed)) continue;
        if (w.entryDeadlinePassed) throw new Error(entryDeadlineMessage(w.entryDeadline!));
      }
      throw new Error(
        'Payment cannot be confirmed — at least one registration is no longer payable (session closed or already expired).'
      );
    }

    const [paymentUpdate] = await tx
      .update(payment)
      .set({
        status: 'completed',
        confirmedAt: now,
        confirmedBy: confirmedBy ?? null,
        externalReference: externalRef ?? pay.externalReference,
        instrumentUsed: instrumentUsed ?? null,
        metadata: adminNotes
          ? { ...(pay.metadata as Record<string, unknown> ?? {}), adminNotes }
          : pay.metadata,
        updatedAt: now,
      })
      .where(and(eq(payment.id, paymentId), inArray(payment.status, [...OPEN_PAYMENT_STATUSES])))
      .returning();

    // The row is locked and open, so the guarded update cannot miss.
    if (!paymentUpdate) throw new Error('Payment was concurrently processed');

    // Move all linked registrations to 'confirmed'
    if (regIds.length > 0) {
      if (pay.purpose === 'preregistration') {
        // V3 §6.8: prereg money lands in the HELD wallet for rows still
        // preregistered; they wait there until the session activates and the
        // scheduler captures them. Rows capture already moved to
        // pending_payment (the session opened before this confirmation)
        // confirm normally below and hold nothing: crediting their price to
        // held left it there for good, since nothing captures a confirmed row
        // (money audit MA-15).
        const heldAmount = round2(regs.filter((r) => r.status === 'preregistered').reduce((s, r) => s + r.price, 0));
        if (heldAmount > 0) {
          await creditHeld(
            {
              studentId: pay.studentId,
              amount: heldAmount,
              reason: 'prereg_hold',
              initiatedBy: pay.parentId,
              relatedPaymentId: paymentId,
            },
            tx
          );
        }
        await tx
          .update(registration)
          .set({ status: 'confirmed', updatedAt: now })
          .where(
            and(
              inArray(registration.id, regIds),
              eq(registration.status, 'pending_payment')
            )
          );
      } else {
        await tx
          .update(registration)
          .set({ status: 'confirmed', updatedAt: now })
          .where(
            and(
              inArray(registration.id, regIds),
              eq(registration.status, 'pending_payment')
            )
          );
      }

      // V3 §6.5 (D-J): physical receipts are born when the money is paid —
      // one pending_issue receipt per registration. Idempotent.
      await createReceiptsForRegistrations(regIds, tx);
    }

    await logAction(confirmedBy ?? null, 'PAYMENT_CONFIRMED', 'payment', paymentId,
      { status: current.status }, { status: 'completed', instrumentUsed: instrumentUsed ?? null, notes: adminNotes ?? null }, auditCtx, tx);
    for (const regId of regIds) {
      await logAction(confirmedBy ?? null, 'REGISTRATION_CONFIRMED', 'registration', regId, null, { paymentId }, auditCtx, tx);
    }

    return { updated: paymentUpdate, registrationIds: regIds };
  });

  // Idempotent: payment was already processed by a concurrent webhook
  if (!updated) {
    return undefined;
  }

  // V3 §6.10: a completed remark-fee payment advances its request to
  // awaiting_submission (idempotent status-guarded update).
  if (pay.purpose === 'remark') {
    const remarkId = (pay.metadata as Record<string, unknown> | null)?.remarkRequestId;
    if (typeof remarkId === 'string') {
      await onRemarkPaymentCompleted(remarkId).catch((err) =>
        console.error('[payment] remark completion hook failed:', err)
      );
    }
  }

  // NOT-005: Notify parent of payment receipt (fire-and-forget)
  {
    const enriched = await db.query.payment.findFirst({
      where: (p, { eq: eqOp }) => eqOp(p.id, paymentId),
      with: {
        paymentRegistrations: {
          with: {
            registration: {
              with: {
                subject: { columns: { name: true } },
                session: { columns: { name: true } },
              },
            },
          },
        },
      },
    });

    if (enriched) {
      const subjectNames = enriched.paymentRegistrations.map(
        (pr) => pr.registration.subject.name
      );
      const sessionName =
        enriched.paymentRegistrations[0]?.registration.session.name ?? 'the session';
      // Total includes both the payment method charge and any escrow applied
      const totalAmount = enriched.amount + enriched.escrowAmountApplied;

      // Generate the PDF receipt so the email can carry it as an attachment
      // (URD PAY-006 + NOT-005). Failure to generate is non-fatal — the
      // email still goes out, and the /receipt endpoint remains available
      // as a fallback.
      let receiptPdf: Buffer | undefined;
      try {
        receiptPdf = await generatePaymentReceipt(paymentId);
      } catch (err) {
        console.error('[notification] NOT-005 PDF generation failed — sending without attachment:', err);
      }

      notifyPaymentConfirmed({
        studentId:   enriched.studentId,
        parentId:    enriched.parentId,
        sessionName,
        amount:      totalAmount,
        method:      enriched.paymentMethod,
        paymentId:   enriched.id,
        subjects:    subjectNames,
        receiptPdf,
      }).catch((err) => console.error('[notification] NOT-005 failed:', err));
    }
  }

  return updated;
}

type OpenStatus = (typeof OPEN_PAYMENT_STATUSES)[number];

/**
 * Move an open payment to 'failed', exactly once: lock the row, check it is
 * still in one of `from`, fail it, give back any escrow applied at checkout,
 * and write the audit row, all in one transaction (O-7). Returns undefined
 * when the payment was no longer in `from` (another caller got there first).
 *
 * `expireIfClosed`: linked registrations still pending_payment in a window
 * that is no longer open for the student expire with the payment — a transfer
 * held them open past the close, and without it nothing can pay them now.
 */
async function failOpenPayment(
  paymentId: string,
  opts: {
    from: readonly OpenStatus[];
    actorId: string | null;
    action: 'PAYMENT_FAILED' | 'PAYMENT_CANCELLED' | 'PAYMENT_REJECTED';
    reason: string;
    expireIfClosed?: boolean;
    auditCtx?: AuditContext;
  }
) {
  const result = await db.transaction(async (tx) => {
    const [pay] = await tx.select().from(payment).where(eq(payment.id, paymentId)).for('update');
    if (!pay) throw new Error('Payment not found');
    if (!(opts.from as readonly string[]).includes(pay.status)) return undefined;

    const key = { PAYMENT_FAILED: 'failure', PAYMENT_CANCELLED: 'cancellation', PAYMENT_REJECTED: 'rejection' }[opts.action];
    const [failed] = await tx
      .update(payment)
      .set({
        status: 'failed',
        metadata: {
          ...((pay.metadata as Record<string, unknown>) ?? {}),
          [key]: { by: opts.actorId, reason: opts.reason, at: new Date().toISOString() },
        },
        updatedAt: new Date(),
      })
      .where(eq(payment.id, paymentId))
      .returning();

    if (pay.escrowAmountApplied > 0) {
      await creditEscrow({
        studentId: pay.studentId,
        amount: pay.escrowAmountApplied,
        reason: 'payment_refund',
        initiatedBy: opts.actorId ?? pay.parentId,
        relatedPaymentId: paymentId,
      }, tx);
    }

    let registrationsExpired = 0;
    if (opts.expireIfClosed) {
      const regs = await tx
        .select({ id: registration.id, sessionId: registration.sessionId })
        .from(paymentRegistration)
        .innerJoin(registration, eq(registration.id, paymentRegistration.registrationId))
        .where(and(eq(paymentRegistration.paymentId, paymentId), eq(registration.status, 'pending_payment')));
      for (const r of regs) {
        if (await sessionOpenFor(pay.studentId, r.sessionId, tx)) continue;
        const expired = await tx
          .update(registration)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(and(eq(registration.id, r.id), eq(registration.status, 'pending_payment')))
          .returning({ id: registration.id });
        registrationsExpired += expired.length;
      }
    }

    await logAction(opts.actorId, opts.action, 'payment', paymentId, { status: pay.status },
      { status: 'failed', reason: opts.reason, escrowReturned: pay.escrowAmountApplied, registrationsExpired }, opts.auditCtx, tx);

    return { pay, failed: failed!, registrationsExpired };
  });

  if (!result) return undefined;
  const { pay } = result;

  // NOT-008: Notify parents of escrow refund from failed payment (fire-and-forget).
  // Only fired on the call that actually transitioned the status.
  if (pay.escrowAmountApplied > 0) {
    const newBalance = await getEscrowBalance(pay.studentId);
    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, pay.studentId),
      columns: { name: true },
    });
    notifyEscrowBalanceChanged({
      studentId: pay.studentId,
      studentName: studentUser?.name ?? 'Student',
      previousBalance: newBalance - pay.escrowAmountApplied,
      newBalance,
      changeAmount: pay.escrowAmountApplied,
      reason: `Escrow refund — ${opts.action === 'PAYMENT_CANCELLED' ? 'payment cancelled' : opts.action === 'PAYMENT_REJECTED' ? 'payment not received' : 'payment failed'}`,
    }).catch((err) => console.error('[notification] NOT-008 (payment refund) failed:', err));
  }

  return result;
}

/**
 * Mark a payment as failed (system).
 *
 * Called when:
 * - a legacy Fawry code expires without payment (scheduler sweep)
 * - the registration window closes on an unpaid checkout
 *   (finalizePendingRecords, which passes from: ['pending'] so a transfer the
 *   family already sent is never failed by the clock — money audit MA-01)
 *
 * Idempotent: a second call on a payment no longer open returns undefined
 * without side effects, and escrow is given back only by the call that
 * actually moved the payment.
 */
export async function failPayment(
  paymentId: string,
  // expireIfClosed: a payment spanning two sessions also releases its
  // registrations in any other session whose window is already closed, so
  // none is left pending_payment with nothing to pay it.
  opts: { from?: readonly OpenStatus[]; reason?: string; expireIfClosed?: boolean } = {}
) {
  const result = await failOpenPayment(paymentId, {
    from: opts.from ?? OPEN_PAYMENT_STATUSES,
    actorId: null,
    action: 'PAYMENT_FAILED',
    reason: opts.reason ?? 'Payment failed',
    expireIfClosed: opts.expireIfClosed,
  });
  return result?.failed;
}

/**
 * A parent cancels a checkout they have not paid ('pending'): escrow applied
 * at checkout comes back and the registrations are payable again, by any
 * method (money audit MA-02). Once a transfer reference is in, the money may
 * have been sent, so only finance can resolve it (rejectPayment).
 * Any parent linked to the student may cancel, as either may pay.
 */
export async function cancelPayment(paymentId: string, parentId: string, auditCtx?: AuditContext) {
  const pay = await db.query.payment.findFirst({
    where: (p, { eq }) => eq(p.id, paymentId),
    columns: { id: true, studentId: true, status: true },
  });
  if (!pay) throw new Error('Payment not found');
  if (!(await validateParentStudentLink(parentId, pay.studentId))) {
    throw new Error('You are not authorized to cancel this payment');
  }
  if (pay.status === 'pending_verification') {
    throw new Error('The transfer reference has been submitted; the finance office will verify or reject it.');
  }

  const result = await failOpenPayment(paymentId, {
    from: ['pending'],
    actorId: parentId,
    action: 'PAYMENT_CANCELLED',
    reason: 'Cancelled by the parent before paying',
    expireIfClosed: true,
    auditCtx,
  });
  if (!result) {
    const now = await db.query.payment.findFirst({ where: (p, { eq }) => eq(p.id, paymentId), columns: { status: true } });
    throw new Error(
      now?.status === 'pending_verification'
        ? 'The transfer reference has been submitted; the finance office will verify or reject it.'
        : `Payment is already in '${now?.status ?? pay.status}' status`
    );
  }
  return {
    id: result.failed.id,
    status: result.failed.status,
    escrowReturned: result.pay.escrowAmountApplied,
    registrationsExpired: result.registrationsExpired,
  };
}

/**
 * Finance rejects an open manual payment with a reason the family will read:
 * an InstaPay reference that is not on the bank statement, or a checkout the
 * family abandoned (money audit MA-03). Escrow applied at checkout comes back.
 * Registrations return to payable while the window is open for the student;
 * after the close they expire, since the transfer was all that held them.
 */
export async function rejectPayment(paymentId: string, staffId: string, reason: string, auditCtx?: AuditContext) {
  const pay = await db.query.payment.findFirst({
    where: (p, { eq }) => eq(p.id, paymentId),
    columns: { id: true, status: true, paymentMethod: true, studentId: true, amount: true, escrowAmountApplied: true },
  });
  if (!pay) throw new Error('Payment not found');
  if (!['in_school', 'instapay', 'bank_transfer'].includes(pay.paymentMethod)) {
    throw new Error('Only in-school, InstaPay, and bank transfer payments are rejected manually');
  }
  if (!(OPEN_PAYMENT_STATUSES as readonly string[]).includes(pay.status)) {
    throw new Error(`Payment is already in '${pay.status}' status`);
  }

  const result = await failOpenPayment(paymentId, {
    from: OPEN_PAYMENT_STATUSES,
    actorId: staffId,
    action: 'PAYMENT_REJECTED',
    reason,
    expireIfClosed: true,
    auditCtx,
  });
  if (!result) throw new Error('Payment was concurrently processed');

  notifyPaymentRejected({
    studentId: pay.studentId,
    paymentId,
    amount: pay.amount,
    escrowReturned: pay.escrowAmountApplied,
    reason,
    registrationsExpired: result.registrationsExpired,
  }).catch((err) => console.error('[notification] PAYMENT_REJECTED failed:', err));

  return {
    id: result.failed.id,
    status: result.failed.status,
    escrowReturned: pay.escrowAmountApplied,
    registrationsExpired: result.registrationsExpired,
  };
}

/**
 * Finance records an InstaPay transfer found on the bank statement after its
 * payment had failed — it lapsed after the close, was closed at the board's
 * entry deadline, or was rejected before the transfer showed up. Without this
 * the money sat in the school's bank with no record and no way back to the
 * family (money audit review of MO-10). The transferred amount is credited to
 * the family's escrow, to spend on a later payment or take back as cash; the
 * registrations stay as they are. Money in on the day it is recorded.
 *
 * A checkout that lapsed without a reference takes the one finance found;
 * the unique reference index stops one transfer being recorded twice.
 */
export async function recordLateTransfer(
  paymentId: string,
  staffId: string,
  data: { notes: string; reference?: string },
  auditCtx?: AuditContext
) {
  const pay = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payment).where(eq(payment.id, paymentId)).for('update');
    if (!p) throw new Error('Payment not found');
    if (p.paymentMethod !== 'instapay') throw new Error('Only an InstaPay payment can be recorded as a transfer found later');
    if (p.status !== 'failed') {
      throw new Error(`Payment is already in '${p.status}' status — an open transfer is confirmed from the Finance Workbench instead`);
    }
    if (p.lateTransferAt) throw new Error('This transfer has already been recorded');
    if (p.amount <= 0) throw new Error('Nothing was transferred for this payment');
    const reference = p.verificationReference ?? data.reference?.trim();
    if (!reference) throw new Error('Enter the transfer reference from the bank statement');

    const now = new Date();
    await tx
      .update(payment)
      .set({
        lateTransferAt: now,
        lateTransferBy: staffId,
        verificationReference: reference,
        metadata: {
          ...((p.metadata as Record<string, unknown>) ?? {}),
          lateTransfer: { by: staffId, at: now.toISOString(), notes: data.notes },
        },
        updatedAt: now,
      })
      .where(eq(payment.id, paymentId));
    await creditEscrow(
      { studentId: p.studentId, amount: p.amount, reason: 'late_transfer', initiatedBy: staffId, relatedPaymentId: paymentId },
      tx
    );
    await logAction(staffId, 'PAYMENT_LATE_TRANSFER_RECORDED', 'payment', paymentId, { status: 'failed' },
      { creditedToEscrow: p.amount, reference, notes: data.notes }, auditCtx, tx);
    return { ...p, verificationReference: reference };
  }).catch((err) => {
    const cause = (err as { cause?: { code?: string } } | null)?.cause;
    if (cause?.code === '23505') {
      throw new Error('This transfer reference is already recorded against another payment');
    }
    throw err;
  });

  const newBalance = await getEscrowBalance(pay.studentId);
  const studentUser = await db.query.user.findFirst({ where: (u, { eq: eqOp }) => eqOp(u.id, pay.studentId), columns: { name: true } });
  notifyEscrowBalanceChanged({
    studentId: pay.studentId,
    studentName: studentUser?.name ?? 'Student',
    previousBalance: newBalance - pay.amount,
    newBalance,
    changeAmount: pay.amount,
    reason: `Your InstaPay transfer (${pay.verificationReference}) was found on the bank statement after the payment had closed, so it was added to the escrow balance — use it for a later payment or ask for it back at the finance desk`,
  }).catch((err) => console.error('[notification] late transfer credit failed:', err));

  return { id: pay.id, creditedToEscrow: pay.amount, reference: pay.verificationReference };
}

/**
 * The two payment deadlines that follow a close (owner decision MO-10). Run
 * by the scheduler on every tick; idempotent, so a missed tick costs nothing.
 *
 * 1. An InstaPay checkout the close kept open for its reference, whose
 *    referenceDueAt has passed with no reference: it lapses — escrow back,
 *    its subjects released — and the family is told.
 * 2. A series whose exam-board entry deadline has passed: every payment still
 *    open on it is closed (a transfer finance never verified included; the
 *    board accepts no more entries), escrow back, family told; and every
 *    registration still waiting on it expires.
 */
export async function enforcePaymentDeadlines(now: Date = new Date()) {
  let referencesLapsed = 0;
  let paymentsClosedAtDeadline = 0;
  let registrationsExpiredAtDeadline = 0;

  const lapsed = await db
    .select({ id: payment.id })
    .from(payment)
    .where(and(eq(payment.status, 'pending'), lte(payment.referenceDueAt, now)));
  for (const { id } of lapsed) {
    try {
      const r = await failOpenPayment(id, {
        from: ['pending'],
        actorId: null,
        action: 'PAYMENT_FAILED',
        reason: 'No transfer reference was submitted in the time allowed after the registration window closed',
        expireIfClosed: true,
      });
      if (!r) continue;
      referencesLapsed++;
      await notifyPaymentExpired(id, r.pay.escrowAmountApplied)
        .catch((err) => console.error(`[deadlines] Lapse notice for ${id} failed:`, err));
    } catch (err) {
      console.error(`[deadlines] Could not lapse payment ${id}:`, err);
    }
  }

  const pastDeadline = await db
    .select({ id: registrationSession.id, entryDeadline: registrationSession.entryDeadline })
    .from(registrationSession)
    .where(and(isNotNull(registrationSession.entryDeadline), lte(registrationSession.entryDeadline, now)));
  for (const s of pastDeadline) {
    const open = await db
      .selectDistinct({ id: payment.id })
      .from(payment)
      .innerJoin(paymentRegistration, eq(paymentRegistration.paymentId, payment.id))
      .innerJoin(registration, eq(registration.id, paymentRegistration.registrationId))
      .where(and(eq(registration.sessionId, s.id), inArray(payment.status, [...OPEN_PAYMENT_STATUSES])));
    for (const { id } of open) {
      try {
        // Failed by the system, not rejected: nobody judged the transfer. If it
        // turns up on the statement later, finance records it and the money
        // goes to escrow (recordLateTransfer).
        const r = await failOpenPayment(id, {
          from: OPEN_PAYMENT_STATUSES,
          actorId: null,
          action: 'PAYMENT_FAILED',
          reason: "The exam board's entry deadline passed before this payment was confirmed",
          expireIfClosed: true,
        });
        if (!r) continue;
        paymentsClosedAtDeadline++;
        await notifyPaymentClosedAtEntryDeadline(id, s.entryDeadline!, r.pay.escrowAmountApplied)
          .catch((err) => console.error(`[deadlines] Deadline notice for ${id} failed:`, err));
      } catch (err) {
        console.error(`[deadlines] Could not close payment ${id} at the entry deadline:`, err);
      }
    }

    // Anything else still waiting on this series can never be entered now;
    // each student is told which subjects, as at the close.
    const expired = await db
      .update(registration)
      .set({ status: 'expired', updatedAt: now })
      .where(and(eq(registration.sessionId, s.id), inArray(registration.status, ['pending_approval', 'pending_payment'])))
      .returning({ id: registration.id, studentId: registration.studentId, subjectId: registration.subjectId });
    registrationsExpiredAtDeadline += expired.length;
    if (expired.length > 0) {
      await notifyRegistrationsExpiredAtEntryDeadline(s.id, s.entryDeadline!, expired)
        .catch((err) => console.error(`[deadlines] Expiry notices for session ${s.id} failed:`, err));
    }
  }

  return { referencesLapsed, paymentsClosedAtDeadline, registrationsExpiredAtDeadline };
}

/**
 * Get a payment by ID with its linked registrations.
 */
export async function getPaymentById(id: string) {
  return db.query.payment.findFirst({
    where: (p, { eq }) => eq(p.id, id),
    with: {
      paymentRegistrations: {
        with: {
          registration: {
            with: { subject: true, session: true },
          },
        },
      },
    },
  });
}

/**
 * Get payments with optional filters.
 * Returns payments with their linked registration details.
 */
export async function getPayments(filters: ListPaymentsQueryType & {
  parentId?: string;
  studentIds?: string[];
}) {
  return db.query.payment.findMany({
    where: (p, { eq, and, inArray }) => {
      const conditions = [];
      if (filters.studentId) conditions.push(eq(p.studentId, filters.studentId));
      else if (filters.studentIds?.length) conditions.push(inArray(p.studentId, filters.studentIds));
      if (filters.parentId) conditions.push(eq(p.parentId, filters.parentId));
      if (filters.status)   conditions.push(eq(p.status, filters.status));
      if (filters.method)   conditions.push(eq(p.paymentMethod, filters.method));
      return conditions.length > 0 ? and(...conditions) : undefined;
    },
    with: {
      paymentRegistrations: {
        with: {
          registration: {
            with: { subject: { columns: { id: true, name: true, code: true } } },
          },
        },
      },
    },
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });
}

/**
 * Parent submits the InstaPay transaction reference after transferring
 * to the school account. Moves the payment to 'pending_verification'.
 *
 * Rules:
 * - Payment must belong to the calling parent and use the instapay method
 * - Allowed while 'pending' or 'pending_verification' (re-submission
 *   corrects a typo before finance verifies — the audit log keeps both)
 * - The reference is unique across all payments: the same transfer can
 *   never be claimed twice. Uniqueness is enforced by the DB index; the
 *   violation is translated to a friendly error here.
 *
 * The reference is an opaque string (no published InstaPay format) and
 * its presence is NOT proof of payment — finance verifies against the
 * bank statement before confirming (V3_PLAN §2.3).
 */
export async function submitInstapayReference(
  paymentId: string,
  parentId: string,
  data: SubmitInstapayReferenceType
) {
  const pay = await db.query.payment.findFirst({
    where: (p, { eq }) => eq(p.id, paymentId),
  });

  if (!pay) throw new Error('Payment not found');
  if (pay.parentId !== parentId) throw new Error('You are not authorized to update this payment');
  if (pay.paymentMethod !== 'instapay') {
    throw new Error('Only InstaPay payments accept a transfer reference');
  }
  if (!(OPEN_PAYMENT_STATUSES as readonly string[]).includes(pay.status)) {
    throw new Error(`Payment is already in '${pay.status}' status`);
  }
  // RF-13: a screenshot must be one this parent uploaded. The id used to be
  // stored as given, so any family could attach another family's document.
  if (data.screenshotFileId && !(await isOwnDocument(data.screenshotFileId, parentId))) {
    throw new Error('You are not authorized to attach that file');
  }
  // A checkout whose registrations already expired with the window can take
  // no reference: nothing could ever be confirmed against it.
  // A checkout the close left waiting for its reference has until
  // referenceDueAt to get one (owner decision MO-10).
  if (pay.referenceDueAt && pay.referenceDueAt <= new Date()) {
    throw new Error(
      `The time to submit a transfer reference after the registration window closed ended on ${schoolDateTime(pay.referenceDueAt)}. If you did transfer, contact the finance desk with your bank receipt.`
    );
  }
  const links = await db.query.paymentRegistration.findMany({
    where: (pr, { eq }) => eq(pr.paymentId, paymentId),
    with: { registration: { columns: { status: true }, with: { session: { columns: { entryDeadline: true } } } } },
  });
  if (pay.purpose === 'registration' && links.some((l) => l.registration.status !== 'pending_payment')) {
    throw new Error('The registration window has closed for this payment; it can no longer take a transfer reference.');
  }
  // Registration or preregistration: past the series' board deadline nothing
  // more can be entered, so no transfer can be taken for it (MO-10).
  const passed = links.find((l) => l.registration.session.entryDeadline && l.registration.session.entryDeadline <= new Date());
  if (passed) throw new Error(entryDeadlineMessage(passed.registration.session.entryDeadline!));

  try {
    const [updated] = await db
      .update(payment)
      .set({
        verificationReference: data.reference,
        verificationFileId: data.screenshotFileId ?? null,
        status: 'pending_verification',
        updatedAt: new Date(),
      })
      .where(and(eq(payment.id, paymentId), inArray(payment.status, [...OPEN_PAYMENT_STATUSES])))
      .returning();

    if (!updated) {
      throw new Error('Payment was concurrently processed. Please refresh and try again.');
    }
    return updated;
  } catch (err) {
    // Drizzle wraps the pg error: the outer message is the SQL text, the
    // unique-violation code and detail live on `cause` (RF-07).
    const cause = (err as { cause?: { code?: string; message?: string } } | null)?.cause;
    const code = cause?.code ?? (err as { code?: string } | null)?.code;
    const text = `${cause?.message ?? ''} ${err instanceof Error ? err.message : ''}`;
    if (code === '23505' || /unique|duplicate/i.test(text)) {
      throw new Error(
        'This transaction reference has already been submitted for another payment. Double-check your InstaPay receipt.'
      );
    }
    throw err;
  }
}

/**
 * Finance Workbench queue: all payments awaiting manual action —
 * in-school payments waiting for the desk, InstaPay payments (with or
 * without a submitted reference), and any legacy pending bank transfers.
 * Ordered oldest-first so the longest-waiting parents are served first.
 */
export async function getPendingManualPayments() {
  return db.query.payment.findMany({
    where: (p, { and, inArray }) =>
      and(
        inArray(p.status, [...OPEN_PAYMENT_STATUSES]),
        inArray(p.paymentMethod, ['in_school', 'instapay', 'bank_transfer'])
      ),
    with: {
      paymentRegistrations: {
        with: {
          registration: {
            with: {
              subject: { columns: { id: true, name: true, code: true } },
              // The workbench shows what is due: the board deadline of a closed series (MO-10).
              session: { columns: { id: true, name: true, status: true, entryDeadline: true } },
            },
          },
        },
      },
      student: { columns: { id: true, name: true, email: true, grade: true, studentId: true } },
      parent: { columns: { id: true, name: true, email: true } },
    },
    orderBy: (p, { asc }) => [asc(p.createdAt)],
  });
}

/**
 * Reverse a mistaken confirmation (UX_AUDIT G6) — Excel's "fix the cell"
 * with an audit trail. Finance admin only (enforced at the route).
 *
 * Only while the paper hasn't left the desk: every linked receipt must
 * still be pending_issue (they are voided). Effects: payment →
 * 'refunded', escrow re-credited if applied, registrations → back to
 * pending_payment, receipts voided. School-fee reversals re-lock the
 * registration gate automatically (the gate checks completed payments).
 */
export async function reversePayment(
  paymentId: string,
  financeAdminId: string,
  reason: string,
  // Was the money given back to the family? (owner decision MO-11) Yes: money
  // out on today's takings. No — confirmed by mistake, nothing was received:
  // the confirmation day's money in is corrected, and today does not move.
  moneyReturned: boolean,
  auditCtx?: AuditContext
) {
  const pay = await db.query.payment.findFirst({
    where: (p, { eq }) => eq(p.id, paymentId),
    with: { paymentRegistrations: { columns: { registrationId: true } } },
  });
  if (!pay) throw new Error('Payment not found');
  if (pay.status !== 'completed') throw new Error('Only completed payments can be reversed');
  if (pay.purpose === 'remark' || pay.purpose === 'preregistration') {
    throw new Error('Remark and preregistration payments cannot be auto-reversed — contact support flow');
  }

  const regIds = pay.paymentRegistrations.map((l) => l.registrationId);
  // Receipts still at the desk get voided inside the transaction below, under
  // a row lock, and the family is told which numbers stop being valid (RF-08).
  // Checking them here, before the transaction, left a window in which an
  // officer could hand a receipt over between the check and the void.
  let voidedReceiptNumbers: string[] = [];
  let registrationsReverted = 0;
  const reversedAt = new Date();

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(payment)
      .set({
        status: 'refunded',
        // The day's takings count the reversal on this date (MA-05).
        reversedAt,
        reversedBy: financeAdminId,
        reversalMoneyReturned: moneyReturned,
        metadata: {
          ...((pay.metadata as Record<string, unknown>) ?? {}),
          reversal: { by: financeAdminId, reason, at: reversedAt.toISOString(), moneyReturned },
        },
        updatedAt: reversedAt,
      })
      .where(and(eq(payment.id, paymentId), eq(payment.status, 'completed')))
      .returning();
    if (!updated) throw new Error('Payment was concurrently processed');

    if (regIds.length > 0) {
      // Lock the receipts for the duration of the transaction so a concurrent
      // hand-over cannot slip between the check and the void.
      const receipts = await tx
        .select({ status: receipt.status, receiptNumber: receipt.receiptNumber })
        .from(receipt)
        .where(inArray(receipt.registrationId, regIds))
        .for('update');
      const outOfDesk = receipts.filter((r) => r.status !== 'pending_issue' && r.status !== 'void');
      if (outOfDesk.length > 0) {
        throw new Error(
          `Receipts already handed out (${outOfDesk.map((r) => r.receiptNumber).join(', ')}) — take them back before reversing`
        );
      }

      // A reversal undoes a confirmation nothing has built on yet. A dropped or
      // swapped registration already paid its refund into escrow; reversing its
      // payment as well handed the family that refund for money now recorded
      // as never received (money audit MA-14).
      const regs = await tx
        .select({ id: registration.id, status: registration.status })
        .from(registration)
        .where(inArray(registration.id, regIds))
        .for('update');
      if (regs.some((r) => r.status !== 'confirmed')) {
        throw new Error(
          'A subject on this payment has already been dropped or changed — undo that first, or settle the difference as a refund'
        );
      }

      const reverted = await tx
        .update(registration)
        .set({ status: 'pending_payment', updatedAt: new Date() })
        .where(and(inArray(registration.id, regIds), eq(registration.status, 'confirmed')))
        .returning({ id: registration.id });
      registrationsReverted = reverted.length;

      const voided = await tx
        .update(receipt)
        .set({ status: 'void', notes: `Voided — payment reversed: ${reason}`, updatedAt: new Date() })
        .where(and(inArray(receipt.registrationId, regIds), eq(receipt.status, 'pending_issue')))
        .returning({ receiptNumber: receipt.receiptNumber });
      voidedReceiptNumbers = voided.map((v) => v.receiptNumber);
    }

    if (pay.escrowAmountApplied > 0) {
      await creditEscrow(
        {
          studentId: pay.studentId,
          amount: pay.escrowAmountApplied,
          reason: 'payment_refund',
          initiatedBy: financeAdminId,
          relatedPaymentId: paymentId,
        },
        tx
      );
    }

    await logAction(financeAdminId, 'PAYMENT_REVERSED', 'payment', paymentId, { status: 'completed' },
      { status: 'refunded', reason, moneyReturned, registrationsReverted, voidedReceiptNumbers }, auditCtx, tx);
  });

  // Past the series' board deadline the reverted registrations cannot be paid
  // again (the next sweep expires them), so the notice must not say "settle again".
  const pastEntryDeadline = regIds.length > 0 && (
    await db
      .select({ entryDeadline: registrationSession.entryDeadline })
      .from(registration)
      .innerJoin(registrationSession, eq(registrationSession.id, registration.sessionId))
      .where(inArray(registration.id, regIds))
  ).some((r) => r.entryDeadline && r.entryDeadline <= new Date());

  // RF-08: every other money movement tells the family; this one used to
  // void their paper receipt in silence. Fire-and-forget like the rest.
  notifyPaymentReversed({
    pastEntryDeadline,
    studentId: pay.studentId,
    paymentId,
    amount: pay.amount + pay.escrowAmountApplied,
    reason,
    moneyReturned,
    voidedReceiptNumbers,
    registrationsReverted,
  }).catch((err) => console.error('[notification] PAYMENT_REVERSED failed:', err));

  return { reversed: true, registrationsReverted };
}

/**
 * Daily takings (UX_AUDIT G4): the money that moved on one calendar day —
 * the officer reconciles the drawer against it at closing time, and a
 * printed day must stay true afterwards (money audit MA-04, MA-05, MA-09).
 *
 * - Money in: every payment confirmed that day — including one reversed
 *   later with the money handed back, since that money did come in.
 * - Money out: reversals made that day that handed money back, plus each
 *   hand-over of refund cash made that day (withdrawal_disbursement, one
 *   row per hand-over).
 * - Corrections (owner decision MO-11): a reversal that says no money had
 *   come in — a confirmation made by mistake — is not money out on its day.
 *   It corrects the day of the confirmation: that day's money in leaves it
 *   out and lists it under `corrected`, and the reversal's own day lists it
 *   under `correctionsRecorded` without moving any total.
 * - Drawer: the cash instrument only. InstaPay lands in the bank and card
 *   in the terminal, so neither belongs in the drawer count.
 */
export async function getDailyTakings(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const columns = {
    id: true, amount: true, escrowAmountApplied: true, paymentMethod: true, purpose: true, status: true,
    instrumentUsed: true, externalReference: true, confirmedAt: true, reversedAt: true, reversalMoneyReturned: true,
  } as const;
  const people = {
    student: { columns: { id: true, name: true } },
    confirmedByUser: { columns: { id: true, name: true } },
    reversedByUser: { columns: { id: true, name: true } },
  } as const;
  const neverReceived = (r: { status: string; reversalMoneyReturned: boolean | null }) =>
    r.status === 'refunded' && r.reversalMoneyReturned === false;

  const confirmedThatDay = await db.query.payment.findMany({
    where: (p, { and, inArray, gte, lt }) =>
      and(inArray(p.status, ['completed', 'refunded']), gte(p.confirmedAt, start), lt(p.confirmedAt, end)),
    columns,
    with: people,
    orderBy: (p, { asc }) => [asc(p.confirmedAt)],
  });
  const confirmed = confirmedThatDay.filter((r) => !neverReceived(r));
  const corrected = confirmedThatDay.filter(neverReceived);

  const reversedThatDay = await db.query.payment.findMany({
    where: (p, { and, eq, gte, lt }) =>
      and(eq(p.status, 'refunded'), gte(p.reversedAt, start), lt(p.reversedAt, end)),
    columns,
    with: people,
    orderBy: (p, { asc }) => [asc(p.reversedAt)],
  });
  const reversed = reversedThatDay.filter((r) => !neverReceived(r));
  const correctionsRecorded = reversedThatDay.filter(neverReceived);

  // Transfers found on the statement after their payment had failed, recorded
  // that day and credited to escrow (recordLateTransfer): money into the bank.
  const lateTransfers = await db.query.payment.findMany({
    where: (p, { and, eq, gte, lt }) =>
      and(eq(p.status, 'failed'), gte(p.lateTransferAt, start), lt(p.lateTransferAt, end)),
    columns: { id: true, amount: true, paymentMethod: true, purpose: true, verificationReference: true, lateTransferAt: true },
    with: { student: { columns: { id: true, name: true } }, lateTransferByUser: { columns: { id: true, name: true } } },
    orderBy: (p, { asc }) => [asc(p.lateTransferAt)],
  });

  const handOvers = await db.query.withdrawalDisbursement.findMany({
    where: (d, { and, gte, lt }) => and(gte(d.disbursedAt, start), lt(d.disbursedAt, end)),
    with: {
      withdrawalRequest: { columns: { id: true }, with: { escrow: { with: { student: { columns: { id: true, name: true } } } } } },
      disbursedByUser: { columns: { id: true, name: true } },
    },
    orderBy: (d, { asc }) => [asc(d.disbursedAt)],
  });

  const instrumentOf = (r: { instrumentUsed: string | null; paymentMethod: string }) => r.instrumentUsed ?? r.paymentMethod;
  const sum = <T>(rows: T[], f: (r: T) => number) => round2(rows.reduce((s, r) => s + f(r), 0));

  const byInstrument: Record<string, number> = {};
  for (const r of confirmed) byInstrument[instrumentOf(r)] = round2((byInstrument[instrumentOf(r)] ?? 0) + r.amount);
  for (const r of lateTransfers) byInstrument[r.paymentMethod] = round2((byInstrument[r.paymentMethod] ?? 0) + r.amount);

  const lateTransferTotal = sum(lateTransfers, (r) => r.amount);
  const moneyIn = round2(sum(confirmed, (r) => r.amount) + lateTransferTotal);
  const escrowApplied = sum(confirmed, (r) => r.escrowAmountApplied);
  const reversedTotal = sum(reversed, (r) => r.amount);
  const cashRefunded = sum(handOvers, (d) => d.amount);
  const moneyOut = round2(reversedTotal + cashRefunded);
  const drawerIn = sum(confirmed.filter((r) => instrumentOf(r) === 'cash'), (r) => r.amount);
  const drawerOut = round2(sum(reversed.filter((r) => instrumentOf(r) === 'cash'), (r) => r.amount) + cashRefunded);
  const correctedTotal = sum(corrected, (r) => r.amount);
  const correctedEscrow = sum(corrected, (r) => r.escrowAmountApplied);
  const drawerCorrected = sum(corrected.filter((r) => instrumentOf(r) === 'cash'), (r) => r.amount);

  return {
    date: dateStr,
    rows: confirmed,
    reversed,
    corrected,
    correctionsRecorded,
    lateTransfers,
    cashRefunds: handOvers.map((d) => ({
      id: d.id,
      withdrawalRequestId: d.withdrawalRequestId,
      amount: d.amount,
      disbursedAt: d.disbursedAt,
      student: d.withdrawalRequest.escrow?.student ?? null,
      disbursedByUser: d.disbursedByUser ?? null,
    })),
    totals: {
      moneyIn,
      escrowApplied,
      byInstrument,
      reversedTotal,
      cashRefunded,
      moneyOut,
      net: round2(moneyIn - moneyOut),
      // Money this day's confirmations claimed but never received (MO-11);
      // already left out of moneyIn above, and their escrow out of escrowApplied.
      correctedTotal,
      correctedEscrow,
      // Transfers found later and credited to escrow; part of moneyIn.
      lateTransferTotal,
      drawer: { cashIn: drawerIn, cashOut: drawerOut, net: round2(drawerIn - drawerOut), corrected: drawerCorrected },
    },
  };
}

/**
 * Get all pending bank transfer payments for admin review.
 * Returns payments ordered oldest-first so longest-waiting transfers are prioritized.
 */
export async function getPendingBankTransfers() {
  return db.query.payment.findMany({
    where: (p, { eq, and }) =>
      and(eq(p.status, 'pending'), eq(p.paymentMethod, 'bank_transfer')),
    with: {
      paymentRegistrations: {
        with: {
          registration: {
            with: { subject: { columns: { id: true, name: true, code: true } } },
          },
        },
      },
      student: { columns: { id: true, name: true, email: true, grade: true, studentId: true } },
      parent: { columns: { id: true, name: true, email: true } },
    },
    orderBy: (p, { asc }) => [asc(p.createdAt)],
  });
}

/**
 * Generate a PDF receipt for a completed payment.
 *
 * The receipt includes:
 * - System header with school/organization name
 * - Student and parent details
 * - Session information
 * - Subject breakdown with prices
 * - Payment totals (escrow applied, amount paid, total)
 * - Payment method, confirmation date, and reference number
 * - Unique confirmation number (payment ID)
 *
 * Implementation note:
 * Uses a text-based PDF generator to avoid external library dependencies.
 * TODO: Install pdfkit (`npm install pdfkit @types/pdfkit`) for richer PDF output
 * with logos, styled tables, and proper typography. The function signature
 * remains the same — just swap the internal implementation.
 */
export async function generatePaymentReceipt(paymentId: string): Promise<Buffer> {
  const pay = await db.query.payment.findFirst({
    where: (p, { eq }) => eq(p.id, paymentId),
    with: {
      student: { columns: { id: true, name: true, email: true, grade: true, studentId: true } },
      parent: { columns: { id: true, name: true, email: true } },
      paymentRegistrations: {
        with: {
          registration: {
            with: {
              subject: { columns: { id: true, name: true, code: true, council: true } },
              session: { columns: { id: true, name: true, sessionType: true } },
            },
          },
        },
      },
    },
  });

  if (!pay) throw new Error('Payment not found');
  if (pay.status !== 'completed') throw new Error('Receipt only available for completed payments');

  const totalAmount = pay.amount + pay.escrowAmountApplied;
  const sessionName = pay.paymentRegistrations[0]?.registration.session.name ?? 'N/A';
  const confirmDate = pay.confirmedAt
    ? new Date(pay.confirmedAt).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : new Date(pay.updatedAt).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });

  // Build a simple text-based PDF using raw PDF syntax
  // This avoids needing any external dependency while producing a valid PDF
  const subjects = pay.paymentRegistrations.map((pr) => ({
    name: pr.registration.subject.name,
    code: pr.registration.subject.code,
    council: pr.registration.subject.council,
    price: pr.registration.priceAtRegistration,
  }));

  const PAYMENT_METHOD_DISPLAY: Record<string, string> = {
    in_school: 'Paid at School',
    instapay: 'InstaPay',
    fawry: 'Fawry',
    card: 'Credit/Debit Card',
    mobile_wallet: 'Mobile Wallet',
    bank_transfer: 'Bank Transfer',
  };

  // Build receipt text content
  const lines: string[] = [];
  const hr = '='.repeat(60);
  const thin = '-'.repeat(60);

  lines.push(hr);
  lines.push('          IGCSE SUBJECT RESERVATION SYSTEM');
  lines.push('                 PAYMENT RECEIPT');
  lines.push(hr);
  lines.push('');
  lines.push(`Confirmation #:  ${pay.id}`);
  lines.push(`Date:            ${confirmDate}`);
  lines.push('');
  lines.push(thin);
  lines.push('STUDENT INFORMATION');
  lines.push(thin);
  lines.push(`Name:            ${pay.student.name}`);
  lines.push(`Student ID:      ${pay.student.studentId ?? 'N/A'}`);
  lines.push(`Grade:           ${pay.student.grade ? `Grade ${pay.student.grade}` : 'N/A'}`);
  lines.push(`Email:           ${pay.student.email}`);
  lines.push('');
  lines.push(thin);
  lines.push('PARENT / PAYER INFORMATION');
  lines.push(thin);
  lines.push(`Name:            ${pay.parent.name}`);
  lines.push(`Email:           ${pay.parent.email}`);
  lines.push('');
  lines.push(thin);
  lines.push('SESSION');
  lines.push(thin);
  lines.push(`Session:         ${sessionName}`);
  lines.push('');
  lines.push(thin);
  lines.push('REGISTERED SUBJECTS');
  lines.push(thin);

  for (const subj of subjects) {
    const councilLabel =
      subj.council === 'pearson_edexcel' ? 'Pearson Edexcel' :
      subj.council === 'cambridge' ? 'Cambridge' :
      subj.council === 'oxford' ? 'Oxford' : subj.council;
    lines.push(`  ${subj.name} (${subj.code})`);
    lines.push(`    Council: ${councilLabel}`);
    lines.push(`    Price:   EGP ${subj.price.toFixed(2)}`);
    lines.push('');
  }

  lines.push(thin);
  lines.push('PAYMENT SUMMARY');
  lines.push(thin);
  lines.push(`Subtotal:                 EGP ${totalAmount.toFixed(2)}`);
  if (pay.escrowAmountApplied > 0) {
    lines.push(`Escrow Applied:          -EGP ${pay.escrowAmountApplied.toFixed(2)}`);
  }
  lines.push(`Amount Charged:           EGP ${pay.amount.toFixed(2)}`);
  lines.push(`Payment Method:           ${PAYMENT_METHOD_DISPLAY[pay.paymentMethod] ?? pay.paymentMethod}`);
  if (pay.externalReference) {
    lines.push(`Provider Reference:       ${pay.externalReference}`);
  }
  lines.push(`Status:                   COMPLETED`);
  lines.push('');
  lines.push(hr);
  lines.push('');
  lines.push('This is a system-generated receipt. No signature is required.');
  lines.push(`Generated on: ${new Date().toISOString()}`);
  lines.push('');

  const textContent = lines.join('\n');

  // Generate a minimal valid PDF with the text content
  // This uses raw PDF operators for a zero-dependency solution
  const textLines = textContent.split('\n');
  const fontSize = 10;
  const lineHeight = 14;
  const margin = 50;
  const pageWidth = 595; // A4 width in points
  const pageHeight = 842; // A4 height in points
  const usableHeight = pageHeight - 2 * margin;
  const linesPerPage = Math.floor(usableHeight / lineHeight);

  // Split into pages
  const pages: string[][] = [];
  for (let i = 0; i < textLines.length; i += linesPerPage) {
    pages.push(textLines.slice(i, i + linesPerPage));
  }

  // Build PDF
  const objects: string[] = [];
  let objectCount = 0;

  function addObject(content: string): number {
    objectCount++;
    objects.push(content);
    return objectCount;
  }

  // Object 1: Catalog
  addObject('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');

  // Object 2: Pages (placeholder - will be filled after page objects are created)
  const pagesObjIndex = 1; // index in objects array
  addObject(''); // placeholder

  // Object 3: Font
  addObject('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj');

  // Create page objects
  const pageObjIds: number[] = [];
  for (const pageLines of pages) {
    // Content stream
    let stream = `BT\n/F1 ${fontSize} Tf\n`;
    let y = pageHeight - margin;
    for (const line of pageLines) {
      // Escape special PDF characters in text
      const escaped = line
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
      stream += `${margin} ${y} Td\n(${escaped}) Tj\n`;
      y -= lineHeight;
      // Reset position for next line (Td is relative, so we need absolute positioning)
      stream = stream.replace(
        /(\d+) (\d+) Td\n\(([^)]*)\) Tj\n$/,
        `${margin} ${y + lineHeight} Td\n(${escaped}) Tj\n`
      );
    }
    // Rebuild stream with absolute positioning
    stream = `BT\n/F1 ${fontSize} Tf\n`;
    y = pageHeight - margin;
    for (const line of pageLines) {
      const escaped = line
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
      stream += `1 0 0 1 ${margin} ${y} Tm\n(${escaped}) Tj\n`;
      y -= lineHeight;
    }
    stream += 'ET';

    const streamBytes = Buffer.from(stream, 'utf-8');
    const contentObjId = addObject(
      `${objectCount + 1} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream\nendobj`
    );

    // Page object
    const pageObjId = addObject(
      `${objectCount + 1} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj`
    );
    pageObjIds.push(pageObjId);
  }

  // Update Pages object
  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  objects[pagesObjIndex] = `2 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjIds.length} >>\nendobj`;

  // Build final PDF
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf-8'));
    pdf += obj + '\n';
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf-8');
  pdf += 'xref\n';
  pdf += `0 ${objectCount + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += 'trailer\n';
  pdf += `<< /Size ${objectCount + 1} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${xrefOffset}\n`;
  pdf += '%%EOF';

  return Buffer.from(pdf, 'utf-8');
}

/**
 * Get checkout summary for a set of registration IDs.
 * Used by the checkout page to display the payment summary
 * including the available escrow balance.
 */
export async function getCheckoutSummary(
  registrationIds: string[],
  parentId: string
) {
  const regs = await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.id, registrationIds),
    with: {
      subject: true,
      session: { columns: { id: true, name: true, sessionType: true } },
      student: { columns: { id: true, name: true, grade: true } },
    },
  });

  if (regs.length === 0) return null;

  const studentIds = [...new Set(regs.map((r) => r.studentId))];
  if (studentIds.length > 1) return null; // mixed students not supported

  const studentId = studentIds[0]!;

  // Validate parent link
  const linked = await validateParentStudentLink(parentId, studentId);
  if (!linked) return null;

  const totalCost = regs.reduce((sum, r) => sum + r.priceAtRegistration, 0);
  const escrowBalance = await getEscrowBalance(studentId);

  // A checkout already started on these subjects: a parent who comes back
  // sees it (to finish or cancel it) instead of a refusal to pay again (MA-02).
  const links = await db.query.paymentRegistration.findMany({
    where: (pr, { inArray: inArr }) => inArr(pr.registrationId, registrationIds),
    with: {
      payment: {
        columns: {
          id: true, status: true, paymentMethod: true, amount: true, escrowAmountApplied: true,
          externalReference: true, verificationReference: true, metadata: true, createdAt: true,
          referenceDueAt: true,
        },
        with: {
          paymentRegistrations: {
            columns: { registrationId: true },
            with: { registration: { columns: { id: true }, with: { subject: { columns: { name: true, code: true } } } } },
          },
        },
      },
    },
  });
  const openPayment =
    links.map((l) => l.payment).find((p) => (OPEN_PAYMENT_STATUSES as readonly string[]).includes(p.status)) ?? null;

  return {
    registrations: regs,
    totalCost,
    escrowBalance,
    student: regs[0]!.student,
    openPayment,
  };
}
