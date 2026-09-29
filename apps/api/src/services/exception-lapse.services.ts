/**
 * A grade-10 exception that runs out (F0a; the lead's decision on the
 * foundation review, flag 4).
 *
 * A `grade10_other_series` exception with a `validUntil` stops allowing new
 * registrations when that moment passes (mayRegisterFor reads it). Its
 * waiting registrations — awaiting approval or payment — get the same
 * clean-up as a revocation: they expire with their REGISTRATION_EXPIRED rows
 * (reason `ineligible`, cause `exception_lapsed`) in the transaction that
 * marks the exception lapsed, and their open checkouts close afterwards,
 * escrow back, the family told. A paid registration made under it stands.
 *
 * Run by the scheduler every tick. Each exception is claimed on its own by a
 * status-guarded update (active → lapsed), so a second scheduler instance, or
 * a revocation at the same moment, finds nothing to claim; a failure leaves
 * the exception active for the next tick (STATE_AUDIT ST-06, ST-12).
 */

import { db, exception, eq, and, lte, isNotNull } from '@repo/db';
import { logAction } from './audit.services';
import { expireIneligibleRegistrations } from './eligibility.services';
import { closePaymentsOfExpiredRegistrations } from './payment.services';

export async function lapseGrade10Exceptions(now: Date = new Date()) {
  const due = await db
    .select({ id: exception.id })
    .from(exception)
    .where(and(
      eq(exception.type, 'grade10_other_series'),
      eq(exception.status, 'active'),
      isNotNull(exception.validUntil),
      lte(exception.validUntil, now),
    ));

  let lapsed = 0;
  const expiredIds: string[] = [];
  for (const d of due) {
    try {
      const expired = await db.transaction(async (tx) => {
        // The claim: only one caller moves it from active.
        const [row] = await tx
          .update(exception)
          .set({ status: 'lapsed', updatedAt: now })
          .where(and(eq(exception.id, d.id), eq(exception.status, 'active'), lte(exception.validUntil, now)))
          .returning();
        if (!row) return null;
        await logAction(null, 'EXCEPTION_LAPSED', 'exception', row.id,
          { status: 'active', validUntil: row.validUntil?.toISOString() ?? null },
          { status: 'lapsed', type: row.type, studentId: row.studentId, sessionId: row.sessionId }, undefined, tx);
        return expireIneligibleRegistrations(
          tx,
          { studentIds: [row.studentId], ...(row.sessionId ? { sessionIds: [row.sessionId] } : {}) },
          'exception_lapsed',
          now,
        );
      });
      if (expired) {
        lapsed++;
        expiredIds.push(...expired.map((r) => r.id));
      }
    } catch (err) {
      console.error(`[exceptions] Lapsing grade-10 exception ${d.id} failed; the next tick retries:`, err);
    }
  }

  const paymentsClosed = expiredIds.length
    ? await closePaymentsOfExpiredRegistrations(expiredIds, 'exception_lapsed').catch((err) => {
        console.error('[exceptions] Closing checkouts after a lapse failed; the recovery sweep will retry:', err);
        return 0;
      })
    : 0;
  return { lapsed, registrationsExpired: expiredIds.length, paymentsClosed };
}
