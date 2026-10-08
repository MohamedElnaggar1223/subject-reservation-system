/**
 * Exceptions that run out (F0a; the lead's decision on the foundation review, flag 4; the
 * reservations rework §3.6).
 *
 * An exception with a `validUntil` stops applying when that moment passes (every hook reads the
 * registry, which skips it). Two policies have something resting on them, so a scheduler step
 * records their end — status `lapsed`, one EXCEPTION_LAPSED row — and does what follows:
 * - a grade-10 exception (eligibility.grade10OtherSeries): its waiting registrations get the same
 *   clean-up as a revocation — they expire with their REGISTRATION_EXPIRED rows (reason
 *   `ineligible`, cause `exception_lapsed`) in the transaction that marks it lapsed, and their open
 *   checkouts close afterwards, escrow back, the family told. A paid registration made under it
 *   stands. (lapseGrade10Exceptions)
 * - a plan (plan.instalments): its line expires (`plan_lapsed`) and its deposits are settled as a
 *   drop that day (plan.services), in the same transaction; an open instalment payment of it is
 *   failed by the deadline sweep afterwards (a payment is locked before a line). (lapsePlans)
 *
 * Run by the scheduler every tick. Each exception is claimed on its own by a status-guarded update
 * (active → lapsed), so a second scheduler instance, or a revocation at the same moment, finds
 * nothing to claim; a failure leaves the exception active for the next tick (STATE_AUDIT ST-06,
 * ST-12). A plan's line is locked before its exception is claimed (the order of §6).
 */

import { db, exception, registration, parentStudentLink, eq, and, lte, isNotNull } from '@repo/db';
import { logAction } from './audit.services';
import { expireIneligibleRegistrations } from './eligibility.services';
import { expireWaitingRegistrations } from './expiry.services';
import { settlePlanInTx } from './plan.services';
import { closePaymentsOfExpiredRegistrations } from './payment.services';

export async function lapseGrade10Exceptions(now: Date = new Date()) {
  const due = await db
    .select({ id: exception.id })
    .from(exception)
    .where(and(
      eq(exception.policyKey, 'eligibility.grade10OtherSeries'),
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
          { status: 'lapsed', type: row.type, policyKey: row.policyKey, studentId: row.studentId, familyId: row.familyId, sessionId: row.sessionId }, undefined, tx);
        // A family's exception covers every linked child.
        const students = row.studentId
          ? [row.studentId]
          : (await tx.select({ id: parentStudentLink.studentId }).from(parentStudentLink)
            .where(and(eq(parentStudentLink.parentId, row.familyId!), eq(parentStudentLink.status, 'approved')))).map((k) => k.id);
        return expireIneligibleRegistrations(
          tx,
          { studentIds: students, ...(row.sessionId ? { sessionIds: [row.sessionId] } : {}) },
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

/** A plan whose `validUntil` has passed: its line expires (`plan_lapsed`) and its deposits are settled. */
export async function lapsePlans(now: Date = new Date()) {
  const due = await db
    .select({ id: exception.id, registrationId: exception.registrationId })
    .from(exception)
    .where(and(
      eq(exception.policyKey, 'plan.instalments'),
      eq(exception.status, 'active'),
      isNotNull(exception.validUntil),
      lte(exception.validUntil, now),
    ));
  let lapsed = 0;
  for (const d of due) {
    try {
      const done = await db.transaction(async (tx) => {
        // Its line first (§6), then the claim.
        if (d.registrationId) await tx.select({ id: registration.id }).from(registration).where(eq(registration.id, d.registrationId)).for('update');
        const [row] = await tx
          .update(exception)
          .set({ status: 'lapsed', updatedAt: now })
          .where(and(eq(exception.id, d.id), eq(exception.status, 'active'), lte(exception.validUntil, now)))
          .returning();
        if (!row) return false;
        await logAction(null, 'EXCEPTION_LAPSED', 'exception', row.id,
          { status: 'active', validUntil: row.validUntil?.toISOString() ?? null },
          { status: 'lapsed', policyKey: row.policyKey, studentId: row.studentId, registrationId: row.registrationId }, undefined, tx);
        if (row.registrationId) {
          await expireWaitingRegistrations(tx, eq(registration.id, row.registrationId), 'plan_lapsed', now);
          await settlePlanInTx(tx, { lineId: row.registrationId, planId: row.id, cause: 'lapsed', at: now, actorId: null, detail: 'the plan ran out' });
        }
        return true;
      });
      if (done) lapsed++;
    } catch (err) {
      console.error(`[exceptions] Lapsing plan ${d.id} failed; the next tick retries:`, err);
    }
  }
  return { lapsed };
}
