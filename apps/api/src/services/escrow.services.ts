/**
 * Escrow Service
 *
 * Single source of truth for all escrow operations (ESC-001 to ESC-007).
 * This service owns the core escrow primitives that are also used by the
 * payment service (checkout debit/refund) and the swap service (drop credits).
 *
 * Access control rules enforced at the route level:
 * - Students: read-only (ESC-001) — balance + transactions only (OI-010 resolved)
 * - Parents: full transactional control (ESC-002 to ESC-004, ESC-007)
 * - Admins: withdrawal fulfillment + rejection (ESC-005, ESC-006)
 *
 * Escrow primitives (`getOrCreateEscrow`, `creditEscrow`, `debitEscrow`)
 * are exported for use by payment.services.ts and swap.services.ts.
 * These callers must never import from drizzle-orm directly.
 */

import {
  db,
  escrow,
  escrowTransaction,
  withdrawalRequest,
  withdrawalDisbursement,
  parentStudentLink,
  user,
  eq,
  and,
  inArray,
  isNull,
  sql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type {
  TransferEscrowType,
  RequestWithdrawalType,
  FulfillWithdrawalType,
  RejectWithdrawalType,
} from '@repo/validations';
import {
  notifyEscrowBalanceChanged,
  notifyWithdrawalFulfilled,
  notifyWithdrawalRequested,
  notifyWithdrawalRejected,
  createNotification,
} from './notification.services';
import { logAction, type AuditContext } from './audit.services';

// ─── Core Escrow Primitives ───────────────────────────────────────────────────
// These are also imported by payment.services.ts and (future) swap.services.ts

/**
 * Get or create the single escrow account for a student.
 * Enforced at DB level by a unique constraint on studentId.
 */
export async function getOrCreateEscrow(studentId: string, tx?: DbConn) {
  const conn = tx ?? db;
  const existing = await conn.query.escrow.findFirst({
    where: (e, { eq }) => eq(e.studentId, studentId),
  });

  if (existing) return existing;

  const [created] = await conn
    .insert(escrow)
    .values({ id: randomUUID(), studentId, balance: 0 })
    .returning();

  return created!;
}

/**
 * Return a student's current escrow balance.
 * Returns 0 if no account exists yet (lazy-created on first credit/debit).
 */
export async function getEscrowBalance(studentId: string): Promise<number> {
  const account = await db.query.escrow.findFirst({
    where: (e, { eq }) => eq(e.studentId, studentId),
    columns: { balance: true },
  });
  return account?.balance ?? 0;
}

type EscrowMutationParams = {
  studentId: string;
  amount: number;
  reason: string;
  initiatedBy: string;
  relatedRegistrationId?: string;
  relatedPaymentId?: string;
};

type DbConn = Pick<typeof db, 'update' | 'insert' | 'query'>;

/**
 * Credit a student's escrow account.
 * Uses a single atomic SQL UPDATE … SET balance = balance + amount … RETURNING balance
 * to prevent lost updates under concurrency.
 * Accepts an optional transaction handle for use within broader transactions.
 */
export async function creditEscrow(params: EscrowMutationParams, tx?: DbConn): Promise<number> {
  const conn = tx ?? db;
  const account = await getOrCreateEscrow(params.studentId, conn);

  const [updated] = await conn
    .update(escrow)
    .set({
      balance: sql`${escrow.balance} + ${params.amount}`,
      updatedAt: new Date(),
    })
    .where(eq(escrow.id, account.id))
    .returning({ balance: escrow.balance });

  if (!updated) {
    throw new Error('Failed to credit escrow — account not found during update');
  }

  await conn.insert(escrowTransaction).values({
    id: randomUUID(),
    escrowId: account.id,
    type: 'credit',
    amount: params.amount,
    reason: params.reason,
    initiatedBy: params.initiatedBy,
    // Defensively treat empty string as null so an accidental `''` from a
    // caller never reaches the FK columns. `??` only coalesces nullish
    // values, but a truthy-falsy `||` catches `''` too — safe here because
    // valid IDs are never the empty string.
    relatedRegistrationId: params.relatedRegistrationId || null,
    relatedPaymentId: params.relatedPaymentId || null,
  });

  return updated.balance;
}

/**
 * Debit a student's escrow account.
 * Uses a single atomic SQL UPDATE … SET balance = balance - amount WHERE balance >= amount
 * to prevent both lost updates and negative balances under concurrency.
 * The balance check is in the WHERE clause, eliminating the TOCTOU race condition.
 * Accepts an optional transaction handle for use within broader transactions.
 */
export async function debitEscrow(params: EscrowMutationParams, tx?: DbConn): Promise<number> {
  const conn = tx ?? db;
  const account = await getOrCreateEscrow(params.studentId, conn);

  // Atomic debit: the WHERE clause `balance >= amount` guarantees the balance
  // never goes negative, even under concurrent requests.
  const [updated] = await conn
    .update(escrow)
    .set({
      balance: sql`${escrow.balance} - ${params.amount}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(escrow.id, account.id),
        sql`${escrow.balance} >= ${params.amount}`
      )
    )
    .returning({ balance: escrow.balance });

  // If no row was updated, the balance was insufficient at the DB level
  if (!updated) {
    throw new Error(
      `Insufficient escrow balance. Requested: ${params.amount.toFixed(2)} EGP`
    );
  }

  await conn.insert(escrowTransaction).values({
    id: randomUUID(),
    escrowId: account.id,
    type: 'debit',
    amount: params.amount,
    reason: params.reason,
    initiatedBy: params.initiatedBy,
    // Same defensive coercion as creditEscrow (see comment above).
    relatedRegistrationId: params.relatedRegistrationId || null,
    relatedPaymentId: params.relatedPaymentId || null,
  });

  return updated.balance;
}

/**
 * V3 §6.8 — held-balance primitives. Same atomic-update discipline as
 * the free balance; a separate ledger dimension (balanceType='held').
 * Held funds exist only to fund their earmarked preregistrations.
 */
export async function creditHeld(params: EscrowMutationParams, tx?: DbConn): Promise<number> {
  const conn = tx ?? db;
  const account = await getOrCreateEscrow(params.studentId, conn);

  const [updated] = await conn
    .update(escrow)
    .set({
      heldBalance: sql`${escrow.heldBalance} + ${params.amount}`,
      updatedAt: new Date(),
    })
    .where(eq(escrow.id, account.id))
    .returning({ heldBalance: escrow.heldBalance });

  if (!updated) {
    throw new Error('Failed to credit held balance — account not found during update');
  }

  await conn.insert(escrowTransaction).values({
    id: randomUUID(),
    escrowId: account.id,
    type: 'credit',
    balanceType: 'held',
    amount: params.amount,
    reason: params.reason,
    initiatedBy: params.initiatedBy,
    relatedRegistrationId: params.relatedRegistrationId || null,
    relatedPaymentId: params.relatedPaymentId || null,
  });

  return updated.heldBalance;
}

export async function debitHeld(params: EscrowMutationParams, tx?: DbConn): Promise<number> {
  const conn = tx ?? db;
  const account = await getOrCreateEscrow(params.studentId, conn);

  const [updated] = await conn
    .update(escrow)
    .set({
      heldBalance: sql`${escrow.heldBalance} - ${params.amount}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(escrow.id, account.id),
        sql`${escrow.heldBalance} >= ${params.amount}`
      )
    )
    .returning({ heldBalance: escrow.heldBalance });

  if (!updated) {
    throw new Error(
      `Insufficient held balance. Requested: ${params.amount.toFixed(2)} EGP`
    );
  }

  await conn.insert(escrowTransaction).values({
    id: randomUUID(),
    escrowId: account.id,
    type: 'debit',
    balanceType: 'held',
    amount: params.amount,
    reason: params.reason,
    initiatedBy: params.initiatedBy,
    relatedRegistrationId: params.relatedRegistrationId || null,
    relatedPaymentId: params.relatedPaymentId || null,
  });

  return updated.heldBalance;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function validateParentStudentLink(
  parentId: string,
  studentId: string
): Promise<boolean> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) =>
      and(eq(l.parentId, parentId), eq(l.studentId, studentId), eq(l.status, 'approved')),
    columns: { id: true },
  });
  return !!link;
}

// ─── Read Operations ──────────────────────────────────────────────────────────

/**
 * Get a student's escrow account with current balance.
 * Returns null if no account exists yet (balance is effectively 0).
 */
export async function getEscrowForStudent(studentId: string) {
  return db.query.escrow.findFirst({
    where: (e, { eq }) => eq(e.studentId, studentId),
  });
}

/**
 * Get the full transaction history for a student's escrow account.
 * Returns the most recent transactions first.
 */
export async function getEscrowTransactions(studentId: string) {
  const account = await db.query.escrow.findFirst({
    where: (e, { eq }) => eq(e.studentId, studentId),
    columns: { id: true },
  });

  if (!account) return [];

  return db.query.escrowTransaction.findMany({
    where: (t, { eq }) => eq(t.escrowId, account.id),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

/**
 * Get escrow balances for all students linked to a parent.
 * Used by the parent's children overview page (ESC-002).
 */
export async function getChildrenEscrowBalances(parentId: string) {
  const links = await db.query.parentStudentLink.findMany({
    where: (l, { eq, and }) =>
      and(eq(l.parentId, parentId), eq(l.status, 'approved')),
    with: {
      student: {
        columns: { id: true, name: true, email: true, grade: true, studentId: true },
      },
    },
  });

  const children = links.map((l) => l.student);
  if (children.length === 0) return [];

  const escrowAccounts = await db.query.escrow.findMany({
    where: (e, { inArray }) =>
      inArray(e.studentId, children.map((c) => c.id)),
    columns: { studentId: true, balance: true, heldBalance: true, id: true },
  });

  const byStudentId = Object.fromEntries(
    escrowAccounts.map((e) => [e.studentId, e])
  );

  return children.map((child) => ({
    ...child,
    escrowBalance: byStudentId[child.id]?.balance ?? 0,
    // Without this a parent who preregistered saw 0.00 next to their
    // child and reasonably concluded the money had disappeared.
    heldBalance: byStudentId[child.id]?.heldBalance ?? 0,
  }));
}

// ─── Transactional Operations (Parent-Only) ───────────────────────────────────

/**
 * Transfer escrow funds from one linked child to another (ESC-003).
 *
 * Rules:
 * - Parent must be linked (approved) to both fromStudent and toStudent
 * - fromStudent and toStudent must be different
 * - amount must not exceed fromStudent's current balance
 * - Two ledger entries created: 'transfer_out' on source, 'transfer_in' on destination
 */
export async function transferEscrow(
  data: TransferEscrowType,
  parentId: string
) {
  const [fromLinked, toLinked] = await Promise.all([
    validateParentStudentLink(parentId, data.fromStudentId),
    validateParentStudentLink(parentId, data.toStudentId),
  ]);

  if (!fromLinked) throw new Error('You are not linked to the source student');
  if (!toLinked)   throw new Error('You are not linked to the destination student');

  const fromBalance = await getEscrowBalance(data.fromStudentId);
  if (fromBalance < data.amount) {
    throw new Error(
      `Insufficient balance. Available: ${fromBalance.toFixed(2)} EGP, Requested: ${data.amount.toFixed(2)} EGP`
    );
  }

  const { newFromBalance, newToBalance } = await db.transaction(async (tx) => {
    const from = await debitEscrow({
      studentId:   data.fromStudentId,
      amount:      data.amount,
      reason:      'transfer_out',
      initiatedBy: parentId,
    }, tx);

    const to = await creditEscrow({
      studentId:   data.toStudentId,
      amount:      data.amount,
      reason:      'transfer_in',
      initiatedBy: parentId,
    }, tx);

    return { newFromBalance: from, newToBalance: to };
  });

  // NOT-008: Notify parents of both students about the balance change (fire-and-forget)
  {
    const [fromUser, toUser] = await Promise.all([
      db.query.user.findFirst({
        where: (u, { eq: eqOp }) => eqOp(u.id, data.fromStudentId),
        columns: { name: true },
      }),
      db.query.user.findFirst({
        where: (u, { eq: eqOp }) => eqOp(u.id, data.toStudentId),
        columns: { name: true },
      }),
    ]);

    notifyEscrowBalanceChanged({
      studentId:       data.fromStudentId,
      studentName:     fromUser?.name ?? 'Student',
      previousBalance: fromBalance,
      newBalance:      newFromBalance,
      changeAmount:    -data.amount,
      reason:          `Transfer to ${toUser?.name ?? 'another student'}`,
    }).catch((err) => console.error('[notification] NOT-008 (transfer-out) failed:', err));

    notifyEscrowBalanceChanged({
      studentId:       data.toStudentId,
      studentName:     toUser?.name ?? 'Student',
      previousBalance: newToBalance - data.amount,
      newBalance:      newToBalance,
      changeAmount:    data.amount,
      reason:          `Transfer from ${fromUser?.name ?? 'another student'}`,
    }).catch((err) => console.error('[notification] NOT-008 (transfer-in) failed:', err));
  }

  return { fromBalance: newFromBalance, toBalance: newToBalance };
}

/**
 * Parent requests a cash withdrawal from a linked child's escrow (ESC-004).
 *
 * Rules:
 * - Parent must be linked (approved) to the student
 * - amount must not exceed the student's current balance
 * - A pending withdrawal_request record is created; admin processes it
 * - Multiple open requests are allowed (admin manages them individually)
 */
export async function createWithdrawalRequest(
  data: RequestWithdrawalType,
  parentId: string
) {
  const linked = await validateParentStudentLink(parentId, data.studentId);
  if (!linked) throw new Error('You are not linked to this student');

  const account = await getOrCreateEscrow(data.studentId);

  // Atomic: debit escrow to hold funds + create withdrawal request
  // If insufficient balance, debitEscrow will throw and no request is created.
  const request = await db.transaction(async (tx) => {
    await debitEscrow({
      studentId: data.studentId,
      amount: data.amount,
      reason: 'withdrawal_hold',
      initiatedBy: parentId,
    }, tx);

    const [req] = await tx
      .insert(withdrawalRequest)
      .values({
        id: randomUUID(),
        escrowId: account.id,
        requestedAmount: data.amount,
        status: 'pending',
      })
      .returning();

    return req!;
  });

  const studentUser = await db.query.user.findFirst({
    where: (u, { eq: eqOp }) => eqOp(u.id, data.studentId),
    columns: { name: true },
  });
  const parentUser = await db.query.user.findFirst({
    where: (u, { eq: eqOp }) => eqOp(u.id, parentId),
    columns: { name: true },
  });
  notifyWithdrawalRequested({
    studentId: data.studentId,
    studentName: studentUser?.name ?? 'Student',
    amount: data.amount,
    parentName: parentUser?.name ?? 'Parent',
  }).catch((err) => console.error('[notification] withdrawal-requested failed:', err));

  // Confirm to the parent that their withdrawal request was submitted
  createNotification(
    parentId,
    'ESCROW_BALANCE_CHANGED',
    `Withdrawal request submitted for ${studentUser?.name ?? 'your child'}`,
    `Your withdrawal request of EGP ${data.amount.toFixed(2)} from ${studentUser?.name ?? 'your child'}'s escrow has been submitted and is pending admin processing.`,
    { withdrawalRequested: true, amount: data.amount, studentId: data.studentId },
  ).catch((err) => console.error('[notification] withdrawal-request parent confirm failed:', err));

  return request;
}

// ─── Admin Operations ─────────────────────────────────────────────────────────

/**
 * Get all pending and partially-fulfilled withdrawal requests for admin review.
 * Includes student info and (first) linked parent info for each request.
 * Ordered oldest-first so highest-priority requests appear first (ESC-005).
 */
export async function getPendingWithdrawalRequests() {
  const requests = await db.query.withdrawalRequest.findMany({
    // V3 D-C maker-checker: fulfilled rows stay in the queue until a
    // finance admin approves them (isNull(approvedBy)).
    where: (wr, { inArray, and, or, eq, isNull }) =>
      or(
        inArray(wr.status, ['pending', 'partially_fulfilled']),
        and(eq(wr.status, 'fulfilled'), isNull(wr.approvedBy))
      ),
    with: {
      escrow: {
        with: {
          student: {
            columns: { id: true, name: true, email: true, grade: true, studentId: true },
          },
        },
      },
    },
    orderBy: (wr, { asc }) => [asc(wr.createdAt)],
  });

  if (requests.length === 0) return [];

  // Batch-fetch parent links for all students in one query
  const studentIds = [...new Set(requests.map((r) => r.escrow.studentId))];

  const parentLinks = await db.query.parentStudentLink.findMany({
    where: (l, { and, inArray, eq }) =>
      and(inArray(l.studentId, studentIds), eq(l.status, 'approved')),
    with: {
      parent: { columns: { id: true, name: true, email: true } },
    },
  });

  // Map studentId → first linked parent (most students have one parent)
  const parentByStudentId: Record<string, { id: string; name: string; email: string } | null> = {};
  for (const link of parentLinks) {
    if (!parentByStudentId[link.studentId]) {
      parentByStudentId[link.studentId] = link.parent;
    }
  }

  return requests.map((r) => ({
    ...r,
    parent: parentByStudentId[r.escrow.studentId] ?? null,
  }));
}

/**
 * Admin fulfills a withdrawal request (ESC-006).
 *
 * Funds were already held (debited from escrow) when the withdrawal was created.
 * Fulfillment only updates the request status — no additional escrow debit needed.
 *
 * The request row is locked for the whole transaction. Re-reading it inside
 * the transaction without a lock did not serialize anything: two officers
 * paying out parts of one request each read the same running total and each
 * wrote "total + mine", so the record kept one hand-over and lost the other
 * (money audit MA-08). Each hand-over is also written to
 * withdrawal_disbursement, which the day's takings read (MA-09), and its audit
 * row commits with it (O-7).
 *
 * Status progression:
 * - pending → fulfilled (full release)
 * - pending → partially_fulfilled (partial release, though funds were fully held)
 * - partially_fulfilled → fulfilled (remaining release)
 */
export async function fulfillWithdrawalRequest(
  requestId: string,
  data: FulfillWithdrawalType,
  adminId: string,
  auditCtx?: AuditContext
) {
  const now = new Date();

  const { updated, studentId, requestedAmount } = await db.transaction(async (tx) => {
    await tx.select({ id: withdrawalRequest.id }).from(withdrawalRequest)
      .where(eq(withdrawalRequest.id, requestId)).for('update');
    const req = await tx.query.withdrawalRequest.findFirst({
      where: (wr, { eq: eqOp }) => eqOp(wr.id, requestId),
      with: {
        escrow: { columns: { studentId: true, balance: true, id: true } },
      },
    });

    if (!req) throw new Error('Withdrawal request not found');

    if (req.status === 'fulfilled') {
      throw new Error('This withdrawal request has already been fully fulfilled');
    }
    if (req.status === 'rejected') {
      throw new Error('This withdrawal request has been rejected');
    }

    const currentReleased = req.releasedAmount ?? 0;
    const newTotalReleased = currentReleased + data.releasedAmount;

    if (newTotalReleased > req.requestedAmount) {
      throw new Error(
        `Cannot release more than the requested amount. Remaining: ${(req.requestedAmount - currentReleased).toFixed(2)} EGP`
      );
    }

    // No escrow debit needed — funds were already held at creation time.
    const newStatus = newTotalReleased >= req.requestedAmount ? 'fulfilled' : 'partially_fulfilled';

    const [upd] = await tx
      .update(withdrawalRequest)
      .set({
        releasedAmount: newTotalReleased,
        status:         newStatus,
        adminNotes:     data.notes ?? req.adminNotes,
        resolvedAt:     now,
        resolvedBy:     adminId,
        updatedAt:      now,
      })
      .where(and(
        eq(withdrawalRequest.id, requestId),
        inArray(withdrawalRequest.status, ['pending', 'partially_fulfilled']),
      ))
      .returning();

    if (!upd) throw new Error('Withdrawal request already processed by another admin');

    await tx.insert(withdrawalDisbursement).values({
      id: randomUUID(),
      withdrawalRequestId: requestId,
      amount: data.releasedAmount,
      disbursedBy: adminId,
      disbursedAt: now,
      notes: data.notes ?? null,
    });

    await logAction(adminId, 'WITHDRAWAL_FULFILLED', 'escrow', requestId,
      { status: req.status, releasedAmount: currentReleased },
      { status: newStatus, releasedAmount: newTotalReleased, handedOver: data.releasedAmount }, auditCtx, tx);

    return {
      updated: upd,
      studentId: req.escrow.studentId,
      requestedAmount: req.requestedAmount,
    };
  });

  // NOT-009: Notify all linked parents of this student about the withdrawal (fire-and-forget)
  {
    const remainingBalance = await getEscrowBalance(studentId);

    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, studentId),
      columns: { name: true },
    });

    const parentLinks = await db.query.parentStudentLink.findMany({
      where: (l, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(l.studentId, studentId), eqOp(l.status, 'approved')),
      columns: { parentId: true },
    });

    for (const { parentId: pid } of parentLinks) {
      notifyWithdrawalFulfilled({
        parentId:         pid,
        studentId,
        studentName:      studentUser?.name ?? 'Student',
        amountRequested:  requestedAmount,
        amountReleased:   data.releasedAmount,
        remainingBalance,
        adminNotes:       data.notes,
      }).catch((err) => console.error('[notification] NOT-009 failed:', err));
    }
  }

  return updated;
}

/**
 * Admin rejects a withdrawal request.
 *
 * Funds were held (debited) at request creation time. On rejection we must
 * credit the held-but-unreleased portion back to the student's escrow.
 * Supports rejection from either:
 *   - 'pending' — no partial fulfillments yet; refund the full requestedAmount.
 *   - 'partially_fulfilled' — some amount has already been released out;
 *     refund only (requestedAmount - releasedAmount) which represents the
 *     remainder that is still being held reserved.
 * Operations run atomically in a single transaction.
 */
export async function rejectWithdrawalRequest(
  requestId: string,
  data: RejectWithdrawalType,
  adminId: string,
  auditCtx?: AuditContext
) {
  const now = new Date();

  // Atomic: lock + read + reject request + restore held funds to escrow.
  // The lock makes a racing hand-over finish first, so the refund below is
  // computed from the amount actually released (money audit MA-08).
  const { updated, req, refundedAmount } = await db.transaction(async (tx) => {
    await tx.select({ id: withdrawalRequest.id }).from(withdrawalRequest)
      .where(eq(withdrawalRequest.id, requestId)).for('update');
    const wr = await tx.query.withdrawalRequest.findFirst({
      where: (w, { eq: eqOp }) => eqOp(w.id, requestId),
      columns: { id: true, status: true, requestedAmount: true, releasedAmount: true },
      with: { escrow: { columns: { studentId: true } } },
    });

    if (!wr) throw new Error('Withdrawal request not found');
    if (wr.status !== 'pending' && wr.status !== 'partially_fulfilled') {
      throw new Error(`Cannot reject a request in '${wr.status}' status`);
    }

    const alreadyReleased = wr.releasedAmount ?? 0;
    const refund = wr.requestedAmount - alreadyReleased;

    // Credit back the unreleased remainder. For status='pending', refund
    // equals requestedAmount (nothing released). For 'partially_fulfilled',
    // refund is strictly less than requestedAmount.
    if (refund > 0) {
      await creditEscrow({
        studentId: wr.escrow.studentId,
        amount: refund,
        reason: 'withdrawal_rejected',
        initiatedBy: adminId,
      }, tx);
    }

    const [upd] = await tx
      .update(withdrawalRequest)
      .set({
        status:      'rejected',
        adminNotes:  data.notes,
        resolvedAt:  now,
        resolvedBy:  adminId,
        updatedAt:   now,
      })
      .where(
        and(
          eq(withdrawalRequest.id, requestId),
          inArray(withdrawalRequest.status, ['pending', 'partially_fulfilled'])
        )
      )
      .returning();

    if (!upd) throw new Error('Withdrawal request already processed by another admin');

    await logAction(adminId, 'WITHDRAWAL_REJECTED', 'escrow', requestId,
      { status: wr.status, releasedAmount: alreadyReleased },
      { status: 'rejected', returnedToEscrow: refund, notes: data.notes }, auditCtx, tx);

    return { updated: upd, req: wr, refundedAmount: refund };
  });

  const studentUser = await db.query.user.findFirst({
    where: (u, { eq: eqOp }) => eqOp(u.id, req.escrow.studentId),
    columns: { name: true },
  });
  const parentLinks = await db.query.parentStudentLink.findMany({
    where: (l, { and: a, eq: e }) => a(e(l.studentId, req.escrow.studentId), e(l.status, 'approved')),
    columns: { parentId: true },
  });
  for (const { parentId } of parentLinks) {
    notifyWithdrawalRejected({
      parentId,
      studentId: req.escrow.studentId,
      studentName: studentUser?.name ?? 'Student',
      // Refund amount reflects the remainder credited back — equals
      // requestedAmount when rejected from 'pending', and the unreleased
      // portion when rejected from 'partially_fulfilled'.
      amount: refundedAmount,
      reason: data.notes,
    }).catch((err) => console.error('[notification] withdrawal-rejected failed:', err));
  }

  return updated!;
}

// ─── Parent: Withdrawal History ───────────────────────────────────────────────

/**
 * Get all withdrawal requests for a parent's linked children (ESC-007).
 * Includes student info, ordered newest-first.
 */
export async function getWithdrawalRequestsForParent(
  parentId: string,
  filters?: { studentId?: string; status?: string }
) {
  const links = await db.query.parentStudentLink.findMany({
    where: (l, { eq, and }) =>
      and(eq(l.parentId, parentId), eq(l.status, 'approved')),
    columns: { studentId: true },
  });

  const studentIds = links.map((l) => l.studentId);
  if (studentIds.length === 0) return [];

  // If a specific child is requested, validate they're linked
  if (filters?.studentId && !studentIds.includes(filters.studentId)) {
    throw new Error('You are not linked to this student');
  }

  const escrowAccounts = await db.query.escrow.findMany({
    where: (e, { inArray }) =>
      inArray(e.studentId, filters?.studentId ? [filters.studentId] : studentIds),
    columns: { id: true, studentId: true },
  });

  if (escrowAccounts.length === 0) return [];

  const escrowIds = escrowAccounts.map((e) => e.id);

  const requests = await db.query.withdrawalRequest.findMany({
    where: (wr, { and, inArray, eq: eqOp }) => {
      const conditions = [inArray(wr.escrowId, escrowIds)];
      if (filters?.status) conditions.push(eqOp(wr.status, filters.status));
      return and(...conditions);
    },
    with: {
      escrow: {
        with: {
          student: {
            columns: { id: true, name: true, grade: true },
          },
        },
      },
    },
    orderBy: (wr, { desc }) => [desc(wr.createdAt)],
  });

  return requests;
}


/**
 * Finance admin approves a fulfilled withdrawal (V3 D-C maker-checker).
 * The officer's cash disbursement was never blocked on this; approval
 * closes the record. Only fulfilled/partially_fulfilled rows qualify.
 */
export async function approveWithdrawalRequest(id: string, financeAdminId: string) {
  const [updated] = await db
    .update(withdrawalRequest)
    .set({ approvedBy: financeAdminId, approvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(withdrawalRequest.id, id),
        inArray(withdrawalRequest.status, ['fulfilled', 'partially_fulfilled']),
        isNull(withdrawalRequest.approvedBy),
      )
    )
    .returning();
  if (!updated) throw new Error('Withdrawal is not awaiting approval');
  return updated;
}
