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
  eq,
  and,
  inArray,
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
import { logAction } from './audit.services';
import { notifyPaymentConfirmed, notifyEscrowBalanceChanged } from './notification.services';
import { createReceiptsForRegistrations } from './receipt.services';
import { creditHeld } from './escrow.services';

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
    columns: { id: true, status: true, name: true },
  });
  const requiredStatus = isPrereg ? 'draft' : 'active';
  const wrongState = sessions.filter((s) => s.status !== requiredStatus);
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
    // Re-check for existing pending payments INSIDE the transaction to prevent
    // concurrent double-debit (EDGE-3). Two concurrent requests both passing the
    // outer check will be serialized here; the second one will see the first's payment.
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
 */
export async function confirmPayment(
  paymentId: string,
  confirmedBy?: string,
  externalRef?: string,
  adminNotes?: string,
  instrumentUsed?: string,
) {
  const pay = await db.query.payment.findFirst({
    where: (p, { eq }) => eq(p.id, paymentId),
  });

  if (!pay) throw new Error('Payment not found');
  if (!(OPEN_PAYMENT_STATUSES as readonly string[]).includes(pay.status)) {
    throw new Error(`Payment is already in '${pay.status}' status`);
  }

  // M-12: Reject confirmations whose registrations or sessions have
  // already been finalized. In normal operation, finalizePendingRecords
  // fails pending payments as soon as a session closes — but a late
  // webhook callback (or a slow gateway) could still land here after
  // the registrations have been expired. We stop the confirmation and
  // let the scheduler's expiry sweep call failPayment so escrow is
  // refunded and the student isn't silently confirmed into a closed
  // session.
  const linkedRegs = await db.query.paymentRegistration.findMany({
    where: (pr, { eq }) => eq(pr.paymentId, paymentId),
    with: {
      registration: {
        columns: { id: true, status: true },
        with: { session: { columns: { status: true } } },
      },
    },
  });
  const isPreregPayment = pay.purpose === 'preregistration';
  const stale = linkedRegs.some((l) =>
    isPreregPayment
      ? // Prereg: rows must still be preregistered in a draft session.
        // (If the session opened before the money was confirmed, capture
        // has already moved rows to pending_payment — confirm normally.)
        l.registration.status !== 'preregistered' && l.registration.status !== 'pending_payment'
      : l.registration.status !== 'pending_payment' ||
        l.registration.session.status !== 'active'
  );
  if (stale) {
    throw new Error(
      'Payment cannot be confirmed — at least one registration is no longer payable (session closed or already expired).'
    );
  }

  const now = new Date();

  // Atomic transaction: update payment status + confirm all linked registrations
  const { updated, registrationIds } = await db.transaction(async (tx) => {
    // Update payment status — include status guard to prevent concurrent double-confirm
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

    // Idempotent: if 0 rows updated, another webhook already confirmed this payment
    if (!paymentUpdate) {
      return { updated: undefined, registrationIds: [] as string[] };
    }

    // Move all linked registrations to 'confirmed'
    const links = await db.query.paymentRegistration.findMany({
      where: (pr, { eq }) => eq(pr.paymentId, paymentId),
      columns: { registrationId: true },
    });

    const regIds = links.map((l) => l.registrationId);
    if (regIds.length > 0) {
      if (pay.purpose === 'preregistration') {
        // V3 §6.8: prereg money lands in the HELD wallet; registrations
        // stay preregistered until the session activates and the
        // scheduler captures them. Rows already moved to pending_payment
        // (session opened early) confirm normally below.
        await creditHeld(
          {
            studentId: pay.studentId,
            amount: pay.amount,
            reason: 'prereg_hold',
            initiatedBy: pay.parentId,
            relatedPaymentId: paymentId,
          },
          tx
        );
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

    return { updated: paymentUpdate, registrationIds: regIds };
  });

  // Idempotent: payment was already processed by a concurrent webhook
  if (!updated) {
    return undefined;
  }

  for (const regId of registrationIds) {
    logAction(null, 'REGISTRATION_CONFIRMED', 'registration', regId, null, { paymentId })
      .catch((err) => console.error('[audit] REGISTRATION_CONFIRMED failed:', err));
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

/**
 * Mark a payment as failed.
 *
 * Called when:
 * - Fawry code expires without payment
 * - Card transaction declines
 * - Wallet payment rejected
 * - Session closes with pending payments (finalizePendingRecords)
 *
 * Idempotent: two concurrent callers (e.g. webhook retry + scheduler
 * expiry sweep) will only transition the payment and refund escrow once.
 * A second call on an already-failed payment returns undefined without
 * error and without side effects.
 *
 * If escrow was applied at checkout, the full escrowAmountApplied is
 * credited back to the student exactly once — but only when THIS call
 * is the one that actually flipped the status from 'pending' to 'failed'.
 */
export async function failPayment(paymentId: string) {
  const pay = await db.query.payment.findFirst({
    where: (p, { eq }) => eq(p.id, paymentId),
  });

  if (!pay) throw new Error('Payment not found');

  // Non-throwing idempotency for non-open states so callers
  // (finalizePendingRecords, scheduler Fawry sweep, webhook retries)
  // can call freely without error handling.
  if (!(OPEN_PAYMENT_STATUSES as readonly string[]).includes(pay.status)) return undefined;

  // Atomic transaction: fail payment + refund escrow if applied.
  // The UPDATE carries a status='pending' guard so only one concurrent
  // call transitions the row; the refund branch is inside that guard.
  const updated = await db.transaction(async (tx) => {
    const [paymentUpdate] = await tx
      .update(payment)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(and(eq(payment.id, paymentId), inArray(payment.status, [...OPEN_PAYMENT_STATUSES])))
      .returning();

    // Idempotent: if 0 rows updated, another caller already failed this payment.
    if (!paymentUpdate) {
      return undefined;
    }

    if (pay.escrowAmountApplied > 0) {
      await creditEscrow({
        studentId: pay.studentId,
        amount: pay.escrowAmountApplied,
        reason: 'payment_refund',
        initiatedBy: pay.parentId,
        relatedPaymentId: paymentId,
      }, tx);
    }

    return paymentUpdate;
  });

  if (!updated) return undefined;

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
      reason: 'Escrow refund — payment failed',
    }).catch((err) => console.error('[notification] NOT-008 (payment refund) failed:', err));
  }

  return updated;
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
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
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

  return {
    registrations: regs,
    totalCost,
    escrowBalance,
    student: regs[0]!.student,
  };
}
