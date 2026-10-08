/**
 * The overdue expiry (RESERVATIONS_REWORK.md §3.1, §3.10 item 8): a scheduler step.
 *
 * A line's due date drives reminders, the Money tab's "overdue" and the statement; it expires
 * nothing by itself — unless the school turns on `payment.expireOverdueAfterDays` (default 0:
 * off). Then a line still awaiting payment that many days after its due date expires with reason
 * `overdue`, its REGISTRATION_EXPIRED row and the family told, in one transaction; a line under an
 * instalment plan is settled as a drop that day (expiry.services). A line with a payment in
 * progress (a checkout, or an instalment) is left for that payment.
 *
 * Claimed before acting and safe with two scheduler instances (ST-06, ST-12): each line is expired
 * by expireWaitingRegistrations, which locks the row and moves it only from a waiting status, so a
 * second instance finds nothing; a failure leaves the line for the next tick.
 */

import { db, registration, subject, eq, and, lte, sql } from '@repo/db';
import { getSetting } from './settings.services';
import { expireWaitingRegistrations } from './expiry.services';
import { tellFamily } from './plan.services';
import { schoolDate } from './window.services';

const DAY = 24 * 60 * 60 * 1000;

const noPaymentInProgress = sql`not exists (
    select 1 from payment_registration pr join payment p on p.id = pr.payment_id
    where pr.registration_id = ${registration.id} and p.status in ('pending', 'pending_verification'))
  and not exists (
    select 1 from payment_charge pc join payment p on p.id = pc.payment_id join charge c on c.id = pc.charge_id
    where c.registration_id = ${registration.id} and c.kind = 'instalment' and p.status in ('pending', 'pending_verification'))`;

export async function expireOverdueLines(now: Date = new Date()) {
  const days = await getSetting('payment.expireOverdueAfterDays');
  if (!days || days <= 0) return { expired: 0 };
  const cutoff = new Date(now.getTime() - days * DAY);
  const due = await db.select({ id: registration.id }).from(registration)
    .where(and(eq(registration.status, 'pending_payment'), lte(registration.dueAt, cutoff), noPaymentInProgress))
    .orderBy(registration.id);
  let expired = 0;
  for (const { id } of due) {
    try {
      const rows = await db.transaction(async (tx) => {
        const ended = await expireWaitingRegistrations(tx,
          and(eq(registration.id, id), eq(registration.status, 'pending_payment'), lte(registration.dueAt, cutoff), noPaymentInProgress),
          'overdue', now, `unpaid ${days} days after its due date`);
        for (const r of ended) {
          const [s] = await tx.select({ name: subject.name }).from(subject).where(eq(subject.id, r.subjectId));
          await tellFamily(tx, r.studentId, 'PAYMENT_EXPIRED', `${s?.name ?? 'A subject'} was not paid in time`,
            `${s?.name ?? 'A subject'} was still unpaid ${days} days after it was due (by ${schoolDate(cutoff)} at the latest), so its reservation has expired. Reserve it again while the session is open.`,
            { registrationId: r.id, reason: 'overdue' });
        }
        return ended;
      });
      expired += rows.length;
    } catch (err) {
      console.error(`[overdue] Could not expire line ${id}; the next tick retries:`, err);
    }
  }
  return { expired };
}

