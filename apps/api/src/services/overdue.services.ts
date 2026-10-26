/**
 * The cut-off sweep (COORDINATOR_REWORK.md §6, C10; §9.2's overdue row): a scheduler step, run inside
 * enforcePaymentDeadlines on every tick.
 *
 * A line's cut-off is the earlier of its due date + its session's unpaid-cancel days and its board deadline
 * (window.services `line_cut_off`). Closing the session or its subject expires nothing that is waiting for
 * payment; an unpaid line expires here, at its cut-off:
 *
 *   1. Checkouts first. A card or pay-at-school checkout still `pending` on a line past its cut-off — the
 *      earliest cut-off of the lines it covers has passed — fails (escrow back); its lines past their cut-off
 *      expire with it, the others stay payable. An InstaPay checkout with no reference yet is given its
 *      `reference_due_at` instead (that earliest cut-off + INSTAPAY_REFERENCE_GRACE_HOURS, never past the earliest
 *      board deadline among its lines) and protects its lines until then; enforcePaymentDeadlines lapses it at that
 *      time when no reference came.
 *   2. Then each unpaid line past its cut-off expires — reason `entry_deadline` when its board deadline is the
 *      earlier date, `cut_off` when the session's own date is (decided by the dates, not by which job runs first),
 *      its REGISTRATION_EXPIRED row and the family told in one transaction, a plan on it settled as a drop that day
 *      (expiry.services) — unless something protects it: a transfer under verification (until the earliest board
 *      deadline among its lines, where the per-series step fails it), an InstaPay checkout inside its grace, or
 *      any instalment payment in progress or under verification (unchanged). A line whose price is not final is
 *      skipped until its board deadline (the per-series step expires it there).
 *   3. A request awaiting a parent's approval (`pending_approval`) on a subject or a row that has closed expires
 *      (`subject_closed`) when approving it would be refused: approving needs mayReserve (§6), and a student's G4
 *      later reserve date (`deadline.reserve`) still lets it be approved, so such a request stays (D2 of the P1b
 *      review; ST-07, MO-20).
 *
 * Claimed before acting and safe with two scheduler instances (ST-06, ST-12): a checkout is failed once
 * (failOpenPayment is status-guarded), a reference time is set only where none is, and each line is expired in
 * its own transaction under its row lock, its protections read after the lock (a checkout that commits first is
 * seen); a failure leaves the line for the next tick.
 */

import { db, registration, subject, sessionOfferItem, payment, eq, and, inArray, sql } from '@repo/db';
import { env } from '../env';
import { expireWaitingRegistrations } from './expiry.services';
import { tellFamily } from './plan.services';
import { schoolDate, lineCutOffSql, cutOffsOf, mayReserveRow } from './window.services';
import { failPayment } from './payment.services';
import { notifyPaymentReferenceDue } from './notification.services';

const HOUR = 60 * 60 * 1000;

/** A payment that may still bring money for the line: a checkout or a transfer under verification. */
const openPaymentOn = (line: unknown) => sql`exists (
    select 1 from payment_registration pr join payment p on p.id = pr.payment_id
    where pr.registration_id = ${line} and p.status in ('pending', 'pending_verification'))`;
/** Today's instalment clause (unchanged): an instalment payment of the line in progress or under verification. */
const instalmentInProgress = (line: unknown) => sql`exists (
    select 1 from payment_charge pc join payment p on p.id = pc.payment_id join charge c on c.id = pc.charge_id
    where c.registration_id = ${line} and c.kind = 'instalment' and p.status in ('pending', 'pending_verification'))`;

export async function expireOverdueLines(now: Date = new Date()) {
  let expired = 0;
  let checkoutsEnded = 0;
  let referencesDue = 0;

  // The unpaid lines past their cut-off (a price not final is skipped until its board deadline).
  const pastCutOff = sql`${registration.status} = 'pending_payment' and not ${registration.priceProvisional}
    and line_cut_off(${registration.dueAt}, ${registration.sessionId}, ${registration.attempt}, ${registration.priorSittingSeriesId}, ${registration.boardSeriesId}, ${registration.declarationRejected}) <= ${now}`;

  // 1. Checkouts first.
  const checkouts = await db.execute(sql`
    select distinct p.id, p.payment_method as method, p.reference_due_at as "referenceDueAt" from payment p
    join payment_registration pr on pr.payment_id = p.id join registration r on r.id = pr.registration_id
    where p.status = 'pending' and r.status = 'pending_payment' and not r.price_provisional and ${lineCutOffSql('r')} <= ${now}`)
    .then((x) => x.rows as { id: string; method: string; referenceDueAt: Date | string | null }[]);
  for (const p of checkouts) {
    try {
      if (p.method === 'instapay') {
        if (p.referenceDueAt) continue; // given its time already: protected until then, lapsed by enforcePaymentDeadlines after
        const due = await referenceDueFor(p.id);
        if (due > now) {
          const [kept] = await db.update(payment).set({ referenceDueAt: due, updatedAt: now })
            .where(and(eq(payment.id, p.id), eq(payment.status, 'pending'), sql`${payment.referenceDueAt} is null`))
            .returning({ id: payment.id });
          if (kept) {
            referencesDue++;
            await notifyPaymentReferenceDue(kept.id).catch((err) => console.error(`[cut-off] Reference-due notice for ${kept.id} failed:`, err));
          }
          continue;
        }
        // Its time is already over (the board deadline passed meanwhile): it ends here like any checkout.
      }
      // Ended, escrow back; its lines stay as they are here and step 2 expires those past their cut-off, each told.
      const r = await failPayment(p.id, { from: ['pending'], reason: 'Not paid by the last day to pay (the cut-off)' });
      if (r) checkoutsEnded++;
    } catch (err) {
      console.error(`[cut-off] Could not end checkout ${p.id}; the next tick retries:`, err);
    }
  }

  // 2. The lines past their cut-off, each on its own.
  const due = await db.select({ id: registration.id }).from(registration)
    .where(and(pastCutOff, sql`not ${openPaymentOn(registration.id)}`, sql`not ${instalmentInProgress(registration.id)}`))
    .orderBy(registration.id);
  for (const { id } of due) {
    try {
      const rows = await db.transaction(async (tx) => {
        // The line first, then what protects it, read after the lock: a checkout that commits first is seen.
        const [l] = await tx.select({ id: registration.id }).from(registration).where(and(eq(registration.id, id), pastCutOff)).for('update');
        if (!l) return [];
        const [open] = await tx.select({ id: registration.id }).from(registration)
          .where(and(eq(registration.id, id), sql`(${openPaymentOn(registration.id)} or ${instalmentInProgress(registration.id)})`));
        if (open) return [];
        const cut = (await cutOffsOf(tx, [id])).get(id)!;
        const ended = await expireWaitingRegistrations(tx, eq(registration.id, id), cut.reason, now,
          cut.reason === 'entry_deadline' ? "the exam board's deadline passed before it was paid" : `unpaid at its last day to pay, ${cut.cutOff.toISOString()}`);
        for (const r of ended) {
          const [s] = await tx.select({ name: subject.name }).from(subject).where(eq(subject.id, r.subjectId));
          const name = s?.name ?? 'A subject';
          await tellFamily(tx, r.studentId, 'PAYMENT_EXPIRED', `${name} was not paid in time`,
            cut.reason === 'entry_deadline'
              ? `${name} was still unpaid at the exam board's deadline (${schoolDate(cut.cutOff)}), so its reservation has expired: the board takes no more entries for it.`
              : `${name} was still unpaid on ${schoolDate(cut.cutOff)}, its last day to pay, so its reservation has expired. Reserve it again while it is offered.`,
            { registrationId: r.id, reason: cut.reason });
        }
        return ended;
      });
      expired += rows.length;
    } catch (err) {
      console.error(`[cut-off] Could not expire line ${id}; the next tick retries:`, err);
    }
  }

  // 3. Requests awaiting a parent's approval on a subject or a row that has closed.
  const candidates = await db.execute(sql`
    select r.id, r.student_id as "studentId", r.offer_item_id as "offerItemId", r.attempt, r.prior_sitting_series_id as "priorSittingSeriesId"
    from registration r join session_offer_item i on i.id = r.offer_item_id join session_offer o on o.id = i.offer_id
    where r.status = 'pending_approval'
      and (not o.accepting or (o.closes_at is not null and o.closes_at <= ${now}) or (i.closes_at is not null and i.closes_at <= ${now}))
    order by r.id`).then((x) => x.rows as { id: string; studentId: string; offerItemId: string; attempt: string; priorSittingSeriesId: string | null }[]);
  // Only those approving would refuse now: a later reserve date covering the student keeps theirs approvable.
  const closedRequests: string[] = [];
  for (const c of candidates) {
    if (!(await mayReserveRow(db, c, now)).allowed) closedRequests.push(c.id);
  }
  let awaitingApprovalExpired = 0;
  if (closedRequests.length) {
    try {
      awaitingApprovalExpired = (await db.transaction((tx) => expireWaitingRegistrations(tx,
        and(inArray(registration.id, closedRequests), eq(registration.status, 'pending_approval'),
          sql`exists (select 1 from ${sessionOfferItem} i join session_offer o on o.id = i.offer_id where i.id = ${registration.offerItemId}
            and (not o.accepting or (o.closes_at is not null and o.closes_at <= ${now}) or (i.closes_at is not null and i.closes_at <= ${now})))`),
        'subject_closed', now, 'its subject stopped taking reservations before a parent approved it'))).length;
    } catch (err) {
      console.error('[cut-off] Could not expire the requests of closed subjects; the next tick retries:', err);
    }
  }
  return { expired, checkoutsEnded, referencesDue, awaitingApprovalExpired };
}

/**
 * An InstaPay checkout's time for its reference at the cut-off (§9.2): the earliest cut-off of the lines it
 * covers + INSTAPAY_REFERENCE_GRACE_HOURS, never past the earliest board deadline among them.
 */
async function referenceDueFor(paymentId: string): Promise<Date> {
  const [row] = await db.execute(sql`
    select min(${lineCutOffSql('r')}) as "cutOff",
      min(line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected)) as deadline
    from payment_registration pr join registration r on r.id = pr.registration_id
    where pr.payment_id = ${paymentId}`).then((r) => r.rows as { cutOff: string | Date | null; deadline: string | Date | null }[]);
  const graceEnds = (row?.cutOff ? new Date(row.cutOff).getTime() : Date.now()) + env.INSTAPAY_REFERENCE_GRACE_HOURS * HOUR;
  const deadline = row?.deadline ? new Date(row.deadline).getTime() : Infinity;
  return new Date(Math.min(graceEnds, deadline));
}
