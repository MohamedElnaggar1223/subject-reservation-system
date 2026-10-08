/**
 * Bulk expiry of waiting registrations by the system (a close, an entry
 * deadline, a student no longer eligible for the series, an overdue line), in
 * the caller's transaction. The rows are locked and read first, so each
 * REGISTRATION_EXPIRED row records the status that row had (awaiting approval
 * or awaiting payment); Postgres 17 cannot return a row's old values from an
 * UPDATE (SO-1).
 *
 * The reservations rework (§3.6): a line that ends under a live instalment
 * plan has its deposits settled here, in the same transaction, whatever the
 * cause — the school keeps what a paid drop that day would have kept (capped
 * at the deposits) and the rest goes to free escrow (plan.services).
 */

import { db, registration, and, inArray } from '@repo/db';
import { logActions, expiryEntries, type ExpiryReason } from './audit.services';
import { settlePlansOfExpiredLines } from './plan.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Condition = Parameters<typeof and>[number];

const WAITING = ['pending_approval', 'pending_payment'] as const;

export async function expireWaitingRegistrations(tx: Tx, where: Condition, reason: ExpiryReason, now = new Date(), detail?: string) {
  const waiting = await tx
    .select({ id: registration.id, status: registration.status })
    .from(registration)
    .where(and(where, inArray(registration.status, [...WAITING])))
    // In id order, as every path that locks several registrations does, so an
    // expiry and a checkout on the same rows wait instead of deadlocking.
    .orderBy(registration.id)
    .for('update');
  if (waiting.length === 0) return [];
  const from = new Map(waiting.map((w) => [w.id, w.status]));
  const rows = await tx
    .update(registration)
    .set({ status: 'expired', updatedAt: now })
    .where(and(inArray(registration.id, [...from.keys()]), inArray(registration.status, [...WAITING])))
    .returning({ id: registration.id, studentId: registration.studentId, subjectId: registration.subjectId, sessionId: registration.sessionId });
  await logActions(expiryEntries(rows.map((r) => ({ id: r.id, from: from.get(r.id)! })), reason, detail), tx);
  // A plan line ending, for any reason: its deposits settled as a drop that day (§3.6).
  await settlePlansOfExpiredLines(tx, rows.map((r) => r.id), now, detail ? `${reason}: ${detail}` : reason);
  return rows;
}
