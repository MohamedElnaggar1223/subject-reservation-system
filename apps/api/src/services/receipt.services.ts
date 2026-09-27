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

import { db, receipt, registration, eq, and, inArray } from '@repo/db';
import { randomUUID } from 'crypto';
import { creditEscrow, getEscrowBalance } from './escrow.services';
import { notifyEscrowBalanceChanged } from './notification.services';

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

/**
 * Complete a parked drop after the paper came back (returned) or was
 * written off (lost/void). Credits the parked refund exactly once —
 * the status guard on the receipt update serializes double-clicks.
 */
async function completeParkedDrop(
  rec: {
    id: string;
    registrationId: string;
    refundAmountOnReturn: number | null;
    refundReason: string | null;
    refundInitiatedBy: string | null;
  },
  staffId: string
) {
  await db.transaction(async (tx) => {
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
  });

  // NOT-008 (fire-and-forget): parent sees the credit land
  if (rec.refundAmountOnReturn && rec.refundAmountOnReturn > 0) {
    const reg = await db.query.registration.findFirst({
      where: (r, { eq }) => eq(r.id, rec.registrationId),
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

export async function markIssued(receiptId: string, staffId: string) {
  const [updated] = await db
    .update(receipt)
    .set({ status: 'issued', issuedBy: staffId, issuedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(receipt.id, receiptId), eq(receipt.status, 'pending_issue')))
    .returning();
  if (!updated) throw new Error('Receipt is not awaiting hand-over');
  return updated;
}

export async function markReturned(receiptId: string, staffId: string, notes?: string) {
  const [updated] = await db
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
  if (!updated) throw new Error('Receipt is not out with a parent');

  await completeParkedDrop(updated, staffId);
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
  reason: string
) {
  const [updated] = await db
    .update(receipt)
    .set({ status, notes: reason, updatedAt: new Date() })
    .where(
      and(
        eq(receipt.id, receiptId),
        inArray(receipt.status, ['pending_issue', 'issued', 'return_required'])
      )
    )
    .returning();
  if (!updated) throw new Error('Receipt cannot be written off from its current status');

  await completeParkedDrop(updated, staffId);
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
          student: { columns: { id: true, name: true, email: true, grade: true } },
          subject: { columns: { id: true, name: true, code: true } },
          session: { columns: { id: true, name: true } },
        },
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
    },
  });
}
