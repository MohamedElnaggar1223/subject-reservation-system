/**
 * Exceptions that run out (F0a; the lead's decision on the foundation review, flag 4; the
 * reservations rework §3.6, §3.7).
 *
 * An exception with a `validUntil` stops applying when that moment passes (every hook reads the
 * registry, which skips it). This scheduler step records it — status `lapsed`, one
 * EXCEPTION_LAPSED row — and does what rested on it:
 * - a grade-10 exception (eligibility.grade10OtherSeries): its waiting registrations get the same
 *   clean-up as a revocation — they expire with their REGISTRATION_EXPIRED rows (reason
 *   `ineligible`, cause `exception_lapsed`) in the transaction that marks it lapsed, and their open
 *   checkouts close afterwards, escrow back, the family told. A paid registration made under it
 *   stands.
 * - a plan (plan.instalments): its line expires (`plan_lapsed`) and its deposits are settled as a
 *   drop that day (plan.services), in the same transaction; an open instalment payment of it is
 *   failed by the deadline sweep afterwards (a payment is locked before a line).
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
    .select({ id: exception.id, policyKey: exception.policyKey, registrationId: exception.registrationId })
    .from(exception)
    .where(and(
      eq(exception.status, 'active'),
      isNotNull(exception.validUntil),
      lte(exception.validUntil, now),
    ));

  let lapsed = 0;
  let plansSettled = 0;
  const expiredIds: string[] = [];
  for (const d of due) {
    try {
      const expired = await db.transaction(async (tx) => {
        // A plan: its line first (§6), then the claim.
        if (d.policyKey === 'plan.instalments' && d.registrationId) {
          await tx.select({ id: registration.id }).from(registration).where(eq(registration.id, d.registrationId)).for('update');
        }
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
        if (row.policyKey === 'plan.instalments' && row.registrationId) {
          const ended = await expireWaitingRegistrations(tx, eq(registration.id, row.registrationId), 'plan_lapsed', now);
          const s = await settlePlanInTx(tx, { lineId: row.registrationId, planId: row.id, cause: 'lapsed', at: now, actorId: null, detail: 'the plan ran out' });
          if (s) plansSettled++;
          return ended;
        }
        if (row.policyKey !== 'eligibility.grade10OtherSeries') return [];
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
        if (d.policyKey === 'eligibility.grade10OtherSeries') expiredIds.push(...expired.map((r) => r.id));
      }
    } catch (err) {
      console.error(`[exceptions] Lapsing exception ${d.id} failed; the next tick retries:`, err);
    }
  }

  const paymentsClosed = expiredIds.length
    ? await closePaymentsOfExpiredRegistrations(expiredIds, 'exception_lapsed').catch((err) => {
        console.error('[exceptions] Closing checkouts after a lapse failed; the recovery sweep will retry:', err);
        return 0;
      })
    : 0;
  return { lapsed, registrationsExpired: expiredIds.length, paymentsClosed, plansSettled };
}
