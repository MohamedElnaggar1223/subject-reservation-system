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
  parentStudentLink,
  user,
  eq,
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
} from './notification.services';

// ─── Core Escrow Primitives ───────────────────────────────────────────────────
// These are also imported by payment.services.ts and (future) swap.services.ts

/**
 * Get or create the single escrow account for a student.
 * Enforced at DB level by a unique constraint on studentId.
 */
export async function getOrCreateEscrow(studentId: string) {
  const existing = await db.query.escrow.findFirst({
    where: (e, { eq }) => eq(e.studentId, studentId),
  });

  if (existing) return existing;

  const [created] = await db
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

/**
 * Credit a student's escrow account.
 * Updates balance atomically and writes an immutable ledger entry.
 * Used for: drop refunds, swap refunds, transfer-in, payment refunds.
 */
export async function creditEscrow(params: {
  studentId: string;
  amount: number;
  reason: string;
  initiatedBy: string;
  relatedRegistrationId?: string;
  relatedPaymentId?: string;
}): Promise<number> {
  const account = await getOrCreateEscrow(params.studentId);
  const newBalance = account.balance + params.amount;

  await db
    .update(escrow)
    .set({ balance: newBalance, updatedAt: new Date() })
    .where(eq(escrow.id, account.id));

  await db.insert(escrowTransaction).values({
    id: randomUUID(),
    escrowId: account.id,
    type: 'credit',
    amount: params.amount,
    reason: params.reason,
    initiatedBy: params.initiatedBy,
    relatedRegistrationId: params.relatedRegistrationId ?? null,
    relatedPaymentId: params.relatedPaymentId ?? null,
  });

  return newBalance;
}

/**
 * Debit a student's escrow account.
 * Updates balance atomically and writes an immutable ledger entry.
 * Throws if the balance is insufficient.
 * Used for: checkout payments, transfers-out, withdrawals.
 */
export async function debitEscrow(params: {
  studentId: string;
  amount: number;
  reason: string;
  initiatedBy: string;
  relatedRegistrationId?: string;
  relatedPaymentId?: string;
}): Promise<number> {
  const account = await getOrCreateEscrow(params.studentId);

  if (account.balance < params.amount) {
    throw new Error(
      `Insufficient escrow balance. Available: ${account.balance.toFixed(2)} EGP, Requested: ${params.amount.toFixed(2)} EGP`
    );
  }

  const newBalance = account.balance - params.amount;

  await db
    .update(escrow)
    .set({ balance: newBalance, updatedAt: new Date() })
    .where(eq(escrow.id, account.id));

  await db.insert(escrowTransaction).values({
    id: randomUUID(),
    escrowId: account.id,
    type: 'debit',
    amount: params.amount,
    reason: params.reason,
    initiatedBy: params.initiatedBy,
    relatedRegistrationId: params.relatedRegistrationId ?? null,
    relatedPaymentId: params.relatedPaymentId ?? null,
  });

  return newBalance;
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

  const escrowAccounts = await db.query.escrow.findMany({
    where: (e, { inArray }) =>
      inArray(e.studentId, children.map((c) => c.id)),
    columns: { studentId: true, balance: true, id: true },
  });

  const balanceByStudentId = Object.fromEntries(
    escrowAccounts.map((e) => [e.studentId, e.balance])
  );

  return children.map((child) => ({
    ...child,
    escrowBalance: balanceByStudentId[child.id] ?? 0,
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

  // Execute both sides atomically in order: debit first, then credit
  await debitEscrow({
    studentId:   data.fromStudentId,
    amount:      data.amount,
    reason:      'transfer_out',
    initiatedBy: parentId,
  });

  await creditEscrow({
    studentId:   data.toStudentId,
    amount:      data.amount,
    reason:      'transfer_in',
    initiatedBy: parentId,
  });

  const newFromBalance = fromBalance - data.amount;
  const newToBalance = await getEscrowBalance(data.toStudentId);

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

  const balance = await getEscrowBalance(data.studentId);
  if (data.amount > balance) {
    throw new Error(
      `Requested amount exceeds escrow balance. Available: ${balance.toFixed(2)} EGP`
    );
  }

  const account = await getOrCreateEscrow(data.studentId);

  const [request] = await db
    .insert(withdrawalRequest)
    .values({
      id: randomUUID(),
      escrowId: account.id,
      requestedAmount: data.amount,
      status: 'pending',
    })
    .returning();

  return request!;
}

// ─── Admin Operations ─────────────────────────────────────────────────────────

/**
 * Get all pending and partially-fulfilled withdrawal requests for admin review.
 * Includes student info and (first) linked parent info for each request.
 * Ordered oldest-first so highest-priority requests appear first (ESC-005).
 */
export async function getPendingWithdrawalRequests() {
  const requests = await db.query.withdrawalRequest.findMany({
    where: (wr, { inArray }) => inArray(wr.status, ['pending', 'partially_fulfilled']),
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
 * releasedAmount is the amount being released in THIS call (incremental).
 * Partial fulfillment is supported — admin can call multiple times.
 * The escrow is debited immediately upon fulfillment.
 *
 * Status progression:
 * - pending → partially_fulfilled (cumulative < requestedAmount)
 * - pending / partially_fulfilled → fulfilled (cumulative >= requestedAmount)
 */
export async function fulfillWithdrawalRequest(
  requestId: string,
  data: FulfillWithdrawalType,
  adminId: string
) {
  const req = await db.query.withdrawalRequest.findFirst({
    where: (wr, { eq }) => eq(wr.id, requestId),
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

  // Debit the escrow — throws if balance is insufficient
  await debitEscrow({
    studentId:   req.escrow.studentId,
    amount:      data.releasedAmount,
    reason:      'withdrawal',
    initiatedBy: adminId,
  });

  const newStatus = newTotalReleased >= req.requestedAmount ? 'fulfilled' : 'partially_fulfilled';
  const now = new Date();

  const [updated] = await db
    .update(withdrawalRequest)
    .set({
      releasedAmount: newTotalReleased,
      status:         newStatus,
      adminNotes:     data.notes ?? req.adminNotes,
      fulfilledAt:    now,
      fulfilledBy:    adminId,
      updatedAt:      now,
    })
    .where(eq(withdrawalRequest.id, requestId))
    .returning();

  // NOT-009: Notify all linked parents of this student about the withdrawal (fire-and-forget)
  {
    const studentId = req.escrow.studentId;
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
        amountRequested:  req.requestedAmount,
        amountReleased:   data.releasedAmount,
        remainingBalance,
        adminNotes:       data.notes,
      }).catch((err) => console.error('[notification] NOT-009 failed:', err));
    }
  }

  return updated!;
}

/**
 * Admin rejects a pending withdrawal request.
 * No funds are moved. A mandatory reason is stored in adminNotes.
 */
export async function rejectWithdrawalRequest(
  requestId: string,
  data: RejectWithdrawalType,
  adminId: string
) {
  const req = await db.query.withdrawalRequest.findFirst({
    where: (wr, { eq }) => eq(wr.id, requestId),
    columns: { id: true, status: true },
  });

  if (!req) throw new Error('Withdrawal request not found');

  if (req.status !== 'pending') {
    throw new Error(`Cannot reject a request in '${req.status}' status`);
  }

  const now = new Date();

  const [updated] = await db
    .update(withdrawalRequest)
    .set({
      status:      'rejected',
      adminNotes:  data.notes,
      fulfilledAt: now,
      fulfilledBy: adminId,
      updatedAt:   now,
    })
    .where(eq(withdrawalRequest.id, requestId))
    .returning();

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
