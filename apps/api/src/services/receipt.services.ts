/**
 * Receipt Service (V3 §6.5, D-D/D-I/D-J)
 *
 * Physical receipt lifecycle:
 *   pending_issue → issued → return_required → returned
 *                        ↘ lost | void   (finance admin only)
 *
 * Receipts are created when the covering payment completes. The receipt
 * gates drop completion: while the paper is out, a drop parks at
 * 'dropped_pending_receipt' with the refund parked on the receipt; when
 * finance marks it returned (or lost/void), the escrow credit fires and
 * the registration becomes 'dropped'.
 */

import { db, receipt, registration, charge, eq, and, inArray, gradeTodayExtras } from '@repo/db';
import { randomUUID } from 'crypto';
import { creditEscrow, getEscrowBalance } from './escrow.services';
import { notifyEscrowBalanceChanged } from './notification.services';
import { logAction, type AuditContext } from './audit.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Deterministic per-registration number so retries can't mint duplicates */
function receiptNumberFor(registrationId: string): string {
  return `RCP-${registrationId.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

/**
 * Create pending_issue receipts for registrations (called when a
 * registration-purpose payment completes — D-J). Idempotent: the unique
 * registrationId constraint plus onConflictDoNothing makes double
 * confirmation safe.
 */
export async function createReceiptsForRegistrations(
  registrationIds: string[],
  executor: DbOrTx = db
) {
  if (registrationIds.length === 0) return;

  // A registration paid again after its payment was reversed already has a
  // receipt, voided by the reversal. Skipping it (the insert below does
  // nothing on conflict) left the new payment with no receipt to hand over,
  // and the desk offered the void one (money audit MA-20). Reissue it under a
  // new number, so the voided paper can never pass for the new one.
  const existing = await executor
    .select({ id: receipt.id, registrationId: receipt.registrationId, status: receipt.status, receiptNumber: receipt.receiptNumber })
    .from(receipt)
    .where(inArray(receipt.registrationId, registrationIds));
  for (const rc of existing.filter((r) => r.status === 'void')) {
    const n = Number(/-R(\d+)$/.exec(rc.receiptNumber)?.[1] ?? '1') + 1;
    await executor
      .update(receipt)
      .set({
        status: 'pending_issue',
        receiptNumber: `${receiptNumberFor(rc.registrationId!)}-R${n}`,
        issuedBy: null, issuedAt: null, returnedTo: null, returnedAt: null,
        refundAmountOnReturn: null, refundReason: null, refundInitiatedBy: null,
        notes: `Reissued — ${rc.receiptNumber} was voided when an earlier payment was reversed`,
        updatedAt: new Date(),
      })
      .where(and(eq(receipt.id, rc.id), eq(receipt.status, 'void')));
  }

  await executor
    .insert(receipt)
    .values(
      registrationIds.map((regId) => ({
        id: randomUUID(),
        registrationId: regId,
        receiptNumber: receiptNumberFor(regId),
        status: 'pending_issue' as const,
      }))
    )
    .onConflictDoNothing();
}

/**
 * The reservations rework (§3.10 item 2): a charge's receipt, born when its payment completes —
 * one per charge (receipt.charge_id, exactly one of the two subjects), never for an instalment
 * (its deposit slip is on the payment; the line's own receipt comes at the plan's capture).
 * Paying again after a reversal reissues the voided paper under a new number (MA-20).
 */
export async function createReceiptsForCharges(chargeIds: string[], executor: DbOrTx = db) {
  if (chargeIds.length === 0) return;
  const existing = await executor
    .select({ id: receipt.id, chargeId: receipt.chargeId, status: receipt.status, receiptNumber: receipt.receiptNumber })
    .from(receipt)
    .where(inArray(receipt.chargeId, chargeIds));
  for (const rc of existing.filter((r) => r.status === 'void')) {
    const n = Number(/-R(\d+)$/.exec(rc.receiptNumber)?.[1] ?? '1') + 1;
    await executor
      .update(receipt)
      .set({
        status: 'pending_issue',
        receiptNumber: `${chargeReceiptNumberFor(rc.chargeId!)}-R${n}`,
        issuedBy: null, issuedAt: null, returnedTo: null, returnedAt: null,
        refundAmountOnReturn: null, refundReason: null, refundInitiatedBy: null,
        notes: `Reissued — ${rc.receiptNumber} was voided when an earlier payment was reversed`,
        updatedAt: new Date(),
      })
      .where(and(eq(receipt.id, rc.id), eq(receipt.status, 'void')));
  }
  await executor
    .insert(receipt)
    .values(chargeIds.map((chargeId) => ({
      id: randomUUID(),
      chargeId,
      receiptNumber: chargeReceiptNumberFor(chargeId),
      status: 'pending_issue' as const,
    })))
    .onConflictDoNothing();
}

/** A charge's receipt number: RCP-C + the charge id's first characters (deterministic, retries mint none). */
function chargeReceiptNumberFor(chargeId: string): string {
  return `RCP-C${chargeId.replace(/-/g, '').slice(0, 9).toUpperCase()}`;
}

/**
 * Inside a drop transaction: transition the registration + park or pay
 * the refund depending on whether the paper is physically out (D-D).
 *
 * Returns what happened so callers can phrase notifications correctly.
 * The registration row must already be status-guarded by the caller
 * (confirmed → target status update is done HERE with the guard).
 */
export async function executeReceiptGatedDrop(
  tx: Tx,
  args: {
    registrationId: string;
    studentId: string;
    refundAmount: number;
    refundReason: 'drop' | 'swap_refund';
    initiatedBy: string;
    /** Status the registration must be in (default 'confirmed'; prereg cancellation passes 'preregistered') */
    fromStatus?: 'confirmed' | 'preregistered';
  }
): Promise<{ gated: boolean; refundAmount: number }> {
  // Lock the receipt before deciding. Read without a lock, an officer could
  // mark the paper handed over between this read and the void below: the drop
  // then refunded at once and overwrote 'issued' with 'void' while the family
  // held the paper (money audit MA-16). Receipt before registration is also
  // the order reversePayment locks them in, so the two cannot deadlock.
  const [rec] = await tx
    .select({ id: receipt.id, status: receipt.status })
    .from(receipt)
    .where(eq(receipt.registrationId, args.registrationId))
    .for('update');

  const now = new Date();
  const gated = !!rec && rec.status === 'issued';

  // Status-guarded transition — only confirmed rows may drop
  const [updated] = await tx
    .update(registration)
    .set({
      status: gated ? 'dropped_pending_receipt' : 'dropped',
      droppedAt: now,
      updatedAt: now,
    })
    .where(and(eq(registration.id, args.registrationId), eq(registration.status, args.fromStatus ?? 'confirmed')))
    .returning({ id: registration.id });

  if (!updated) {
    throw new Error('Registration already processed.');
  }

  if (gated && rec) {
    // Park the refund on the receipt; credit fires on return (D-D)
    await tx
      .update(receipt)
      .set({
        status: 'return_required',
        refundAmountOnReturn: args.refundAmount,
        refundReason: args.refundReason,
        refundInitiatedBy: args.initiatedBy,
        updatedAt: now,
      })
      .where(eq(receipt.id, rec.id));
    return { gated: true, refundAmount: args.refundAmount };
  }

  // Paper never left the desk (or no receipt row): complete immediately
  if (rec && rec.status === 'pending_issue') {
    await tx
      .update(receipt)
      .set({ status: 'void', notes: 'Voided — registration dropped before hand-over', updatedAt: now })
      .where(and(eq(receipt.id, rec.id), eq(receipt.status, 'pending_issue')));
  }

  if (args.refundAmount > 0) {
    await creditEscrow(
      {
        studentId: args.studentId,
        amount: args.refundAmount,
        reason: args.refundReason,
        initiatedBy: args.initiatedBy,
        relatedRegistrationId: args.registrationId,
      },
      tx
    );
  }

  return { gated: false, refundAmount: args.refundAmount };
}

type ParkedReceipt = {
  id: string;
  // A charge's receipt has none (and never a parked drop).
  registrationId: string | null;
  refundAmountOnReturn: number | null;
  refundReason: string | null;
  refundInitiatedBy: string | null;
};

/**
 * Complete a parked drop after the paper came back (returned) or was
 * written off (lost/void), in the same transaction as the receipt's own
 * change. Credits the parked refund exactly once — the status guard on the
 * receipt update serializes double-clicks. It used to run in a transaction of
 * its own after the receipt had committed, so a failure left the receipt
 * returned and the refund never credited, with nothing to retry it (state
 * audit ST-05).
 */
async function completeParkedDrop(tx: Tx, rec: ParkedReceipt, staffId: string) {
  if (!rec.registrationId) return;
  {
    const [reg] = await tx
      .update(registration)
      .set({ status: 'dropped', updatedAt: new Date() })
      .where(
        and(
          eq(registration.id, rec.registrationId),
          eq(registration.status, 'dropped_pending_receipt')
        )
      )
      .returning({ id: registration.id, studentId: registration.studentId });

    if (reg && rec.refundAmountOnReturn && rec.refundAmountOnReturn > 0) {
      await creditEscrow(
        {
          studentId: reg.studentId,
          amount: round2(rec.refundAmountOnReturn),
          reason: (rec.refundReason as 'drop' | 'swap_refund') ?? 'drop',
          initiatedBy: rec.refundInitiatedBy ?? staffId,
          relatedRegistrationId: rec.registrationId,
        },
        tx
      );
    }
  }
}

/** NOT-008 (fire-and-forget, after the commit): the parent sees the credit land. */
async function notifyParkedRefund(rec: ParkedReceipt) {
  const registrationId = rec.registrationId;
  if (registrationId && rec.refundAmountOnReturn && rec.refundAmountOnReturn > 0) {
    const reg = await db.query.registration.findFirst({
      where: (r, { eq }) => eq(r.id, registrationId),
      columns: { studentId: true },
      with: { student: { columns: { name: true } } },
    });
    if (reg) {
      const newBalance = await getEscrowBalance(reg.studentId);
      notifyEscrowBalanceChanged({
        studentId: reg.studentId,
        studentName: reg.student?.name ?? 'Student',
        previousBalance: newBalance - rec.refundAmountOnReturn,
        newBalance,
        changeAmount: rec.refundAmountOnReturn,
        reason: 'Receipt returned — drop refund released to escrow',
      }).catch((err) => console.error('[notification] NOT-008 (receipt return) failed:', err));
    }
  }
}

// ─── Finance desk actions ────────────────────────────────────────────────────

// Each hand-over, return and write-off writes its audit row in its own
// transaction, so paper custody and its trail commit together (MO-1).

export async function markIssued(receiptId: string, staffId: string, auditCtx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(receipt)
      .set({ status: 'issued', issuedBy: staffId, issuedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(receipt.id, receiptId), eq(receipt.status, 'pending_issue')))
      .returning();
    if (!updated) throw new Error('Receipt is not awaiting hand-over');
    await logAction(staffId, 'RECEIPT_ISSUED', 'receipt', receiptId, { status: 'pending_issue' },
      updated as Record<string, unknown>, auditCtx, tx);
    return updated;
  });
}

export async function markReturned(receiptId: string, staffId: string, notes?: string, auditCtx?: AuditContext) {
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(receipt)
      .set({
        status: 'returned',
        returnedTo: staffId,
        returnedAt: new Date(),
        notes: notes ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(receipt.id, receiptId), inArray(receipt.status, ['return_required', 'issued'])))
      .returning();
    if (!row) throw new Error('Receipt is not out with a parent');
    await completeParkedDrop(tx, row, staffId);
    await logAction(staffId, 'RECEIPT_RETURNED', 'receipt', receiptId, null, row as Record<string, unknown>, auditCtx, tx);
    return row;
  });
  await notifyParkedRefund(updated);
  return updated;
}

/**
 * Finance-admin escape hatch (D-D): lost/void unblock the same
 * transitions as a physical return.
 */
export async function markLostOrVoid(
  receiptId: string,
  staffId: string,
  status: 'lost' | 'void',
  reason: string,
  auditCtx?: AuditContext
) {
  const updated = await db.transaction(async (tx) => {
    if (status === 'void') {
      // A paid subject's receipt is the family's proof of payment and is never
      // void (MA-20): voided, the desk would never offer it again and nothing
      // reissues it. Void is for the paper of a dropped subject. Receipt first,
      // then its registration — the order a drop, a return and a reversal lock
      // them in, so a void racing one of them waits instead of deadlocking —
      // and judged under both locks, so a drop committing meanwhile is seen (ST-14).
      const [rc] = await tx.select({ registrationId: receipt.registrationId, chargeId: receipt.chargeId }).from(receipt).where(eq(receipt.id, receiptId)).for('update');
      // A charge's receipt: the same rule — never void while the charge is paid (§3.10 item 2).
      if (rc?.chargeId) {
        const [c] = await tx.select({ status: charge.status }).from(charge).where(eq(charge.id, rc.chargeId)).for('update');
        if (c?.status === 'paid') {
          throw new Error('This charge is still paid for, so its receipt stays valid and cannot be voided — void is for the receipt of a refunded or reversed charge');
        }
      }
      if (rc?.registrationId) {
        const [reg] = await tx
          .select({ status: registration.status })
          .from(registration)
          .where(eq(registration.id, rc.registrationId))
          .for('update');
        if (reg && (reg.status === 'confirmed' || reg.status === 'preregistered')) {
          throw new Error('This subject is still paid for, so its receipt stays valid and cannot be voided — void is for the receipt of a dropped subject');
        }
      }
    }
    const [row] = await tx
      .update(receipt)
      .set({ status, notes: reason, updatedAt: new Date() })
      .where(
        and(
          eq(receipt.id, receiptId),
          inArray(receipt.status, ['pending_issue', 'issued', 'return_required'])
        )
      )
      .returning();
    if (!row) throw new Error('Receipt cannot be written off from its current status');
    await completeParkedDrop(tx, row, staffId);
    await logAction(staffId, status === 'lost' ? 'RECEIPT_LOST' : 'RECEIPT_VOIDED', 'receipt', receiptId, null,
      row as Record<string, unknown>, auditCtx, tx);
    return row;
  });
  await notifyParkedRefund(updated);
  return updated;
}

/**
 * Workbench queue: receipts needing desk action — to hand over or to
 * take back — with student + subject context, oldest first.
 */
export async function getReceiptsQueue() {
  return db.query.receipt.findMany({
    where: (r, { inArray }) => inArray(r.status, ['pending_issue', 'return_required']),
    with: {
      registration: {
        columns: { id: true, studentId: true, priceAtRegistration: true, status: true },
        with: {
          student: { columns: { id: true, name: true, email: true, cohortYear: true }, extras: gradeTodayExtras },
          subject: { columns: { id: true, name: true, code: true } },
          session: { columns: { id: true, name: true } },
        },
      },
      // The reservations rework (§3.10 item 2): a charge's receipt.
      charge: {
        columns: { id: true, studentId: true, kind: true, description: true, amount: true, status: true },
        with: { student: { columns: { id: true, name: true, email: true, cohortYear: true }, extras: gradeTodayExtras } },
      },
    },
    orderBy: (r, { asc }) => [asc(r.updatedAt)],
  });
}

/** Receipt lookup by number — first-class Workbench entry point (§6.5) */
export async function findByNumber(receiptNumber: string) {
  return db.query.receipt.findFirst({
    where: (r, { eq }) => eq(r.receiptNumber, receiptNumber.trim().toUpperCase()),
    with: {
      registration: {
        with: {
          student: { columns: { id: true, name: true } },
          subject: { columns: { id: true, name: true, code: true } },
        },
      },
      charge: { columns: { id: true, description: true, amount: true, status: true }, with: { student: { columns: { id: true, name: true } } } },
    },
  });
}
