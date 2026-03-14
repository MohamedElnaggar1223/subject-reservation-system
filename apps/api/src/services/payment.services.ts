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
import type { InitiatePaymentType, ListPaymentsQueryType } from '@repo/validations';
import { generateFawryPayment } from '../integrations/fawry';
import { createPaymobOrder } from '../integrations/paymob';
import { initiateWalletPayment, type WalletProvider } from '../integrations/wallet';
import {
  getOrCreateEscrow,
  getEscrowBalance,
  creditEscrow,
  debitEscrow,
} from './escrow.services';
import { notifyPaymentConfirmed } from './notification.services';

// ─── Bank Transfer Static Config ─────────────────────────────────────────────

const BANK_DETAILS = {
  bankName:      'National Bank of Egypt',
  accountName:   'IGCSE School',
  accountNumber: '0012345678901234',
  swiftCode:     'NBEGEGCXXXX',
  branch:        'Main Branch',
};

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

  // All must be in pending_payment
  const notReady = regs.filter((r) => r.status !== 'pending_payment');
  if (notReady.length > 0) {
    throw new Error('One or more registrations are not ready for payment');
  }

  // Check for existing pending payments on any of these registrations
  const existingPaymentLinks = await db.query.paymentRegistration.findMany({
    where: (pr, { inArray }) => inArray(pr.registrationId, data.registrationIds),
    with: {
      payment: { columns: { id: true, status: true } },
    },
  });
  const hasPendingPayment = existingPaymentLinks.some(
    (pl) => pl.payment.status === 'pending'
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

  // Generate provider-specific reference / URL
  let metadata: Record<string, unknown> = {};
  let externalReference: string | undefined;

  if (data.paymentMethod === 'fawry') {
    const result = await generateFawryPayment({
      amount: paymentMethodAmount,
      merchantRefNum: paymentId,
      customerName: student.name,
      customerEmail: student.email,
      description: `IGCSE Subject Registration — ${regs.length} subject(s)`,
    });
    externalReference = result.referenceNumber;
    metadata = {
      fawryReferenceNumber: result.referenceNumber,
      fawryExpiresAt: result.expiresAt,
      merchantRefNum: paymentId,
    };
  } else if (data.paymentMethod === 'card') {
    const result = await createPaymobOrder({
      amountCents: Math.round(paymentMethodAmount * 100),
      merchantOrderId: paymentId,
      customerEmail: student.email,
      customerName: student.name,
    });
    externalReference = result.orderId;
    metadata = {
      paymentUrl: result.paymentUrl,
      paymobOrderId: result.orderId,
    };
  } else if (data.paymentMethod === 'mobile_wallet') {
    const result = await initiateWalletPayment({
      amountCents: Math.round(paymentMethodAmount * 100),
      merchantOrderId: paymentId,
      walletProvider: data.walletProvider as WalletProvider,
      customerEmail: student.email,
      customerName: student.name,
    });
    externalReference = result.referenceCode;
    metadata = {
      redirectUrl: result.redirectUrl,
      referenceCode: result.referenceCode,
      walletProvider: data.walletProvider,
    };
  } else if (data.paymentMethod === 'bank_transfer') {
    const referenceNumber = `IGCSE-${Date.now().toString(36).toUpperCase()}-${paymentId.slice(0, 6).toUpperCase()}`;
    externalReference = referenceNumber;
    metadata = {
      bankDetails: { ...BANK_DETAILS, referenceNumber },
    };
  }

  // Debit escrow before creating payment record (escrow is committed at initiation)
  if (escrowToApply > 0) {
    await debitEscrow({
      studentId,
      amount: escrowToApply,
      reason: 'payment',
      initiatedBy: parentId,
      relatedPaymentId: paymentId,
    });
  }

  // Create payment record
  const [created] = await db
    .insert(payment)
    .values({
      id: paymentId,
      studentId,
      parentId,
      amount: paymentMethodAmount,
      escrowAmountApplied: escrowToApply,
      paymentMethod: data.paymentMethod,
      status: 'pending',
      externalReference: externalReference ?? null,
      metadata,
    })
    .returning();

  // Link registrations to payment
  const paymentRegRecords = data.registrationIds.map((regId) => ({
    id: randomUUID(),
    paymentId,
    registrationId: regId,
  }));
  await db.insert(paymentRegistration).values(paymentRegRecords);

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
  externalRef?: string
) {
  const pay = await db.query.payment.findFirst({
    where: (p, { eq }) => eq(p.id, paymentId),
  });

  if (!pay) throw new Error('Payment not found');
  if (pay.status !== 'pending') {
    throw new Error(`Payment is already in '${pay.status}' status`);
  }

  const now = new Date();

  // Update payment status
  const [updated] = await db
    .update(payment)
    .set({
      status: 'completed',
      confirmedAt: now,
      confirmedBy: confirmedBy ?? null,
      externalReference: externalRef ?? pay.externalReference,
      updatedAt: now,
    })
    .where(eq(payment.id, paymentId))
    .returning();

  // Move all linked registrations to 'confirmed'
  const links = await db.query.paymentRegistration.findMany({
    where: (pr, { eq }) => eq(pr.paymentId, paymentId),
    columns: { registrationId: true },
  });

  const registrationIds = links.map((l) => l.registrationId);
  if (registrationIds.length > 0) {
    await db
      .update(registration)
      .set({ status: 'confirmed', updatedAt: now })
      .where(
        and(
          inArray(registration.id, registrationIds),
          eq(registration.status, 'pending_payment')
        )
      );
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

      notifyPaymentConfirmed({
        studentId:   enriched.studentId,
        parentId:    enriched.parentId,
        sessionName,
        amount:      totalAmount,
        method:      enriched.paymentMethod,
        paymentId:   enriched.id,
        subjects:    subjectNames,
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
 *
 * If escrow was applied, it is refunded immediately.
 */
export async function failPayment(paymentId: string) {
  const pay = await db.query.payment.findFirst({
    where: (p, { eq }) => eq(p.id, paymentId),
  });

  if (!pay) throw new Error('Payment not found');
  if (pay.status !== 'pending') {
    throw new Error(`Payment is already in '${pay.status}' status`);
  }

  const [updated] = await db
    .update(payment)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(eq(payment.id, paymentId))
    .returning();

  // Refund escrow if it was applied at checkout
  if (pay.escrowAmountApplied > 0) {
    await creditEscrow({
      studentId: pay.studentId,
      amount: pay.escrowAmountApplied,
      reason: 'payment_refund',
      initiatedBy: pay.parentId, // parent initiated the original debit
      relatedPaymentId: paymentId,
    });
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
