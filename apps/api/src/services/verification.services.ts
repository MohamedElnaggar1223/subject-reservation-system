/**
 * Declared sittings and their verification (RESERVATIONS_REWORK.md §3.5; docs/features/RESERVATIONS_LINES.md §3).
 *
 * A family (or the desk) may declare the sitting a retake or a carry-forward follows when the
 * system does not know it — the form trusts the family. The coordinator verifies it (the admin
 * too, and the finance desk with the board's statement in hand), from the session's To verify
 * tab. Every outcome of §3.5, exactly:
 *
 * - verified: the line stands; on a carry-forward from another centre the previous centre and
 *   candidate number are recorded for the entry (F4);
 * - rejected on an unpaid line: it expires (`declaration_rejected`) and the family is told — it
 *   may reserve a first entry where the item takes one;
 * - rejected on a paid line before the first-entry deadline: the line stands as paid with
 *   `declaration_rejected` (F4 enters it as a first entry), the family is told, and finance
 *   decides explicitly whether a price adjustment is owed;
 * - rejected on a paid line after the first-entry deadline: it cannot be entered as a first
 *   entry (MO-10), so the system drops it through the receipt-gated drop, its board fee by the
 *   per-line "sent" rule (reservation.services `refundForSystemDrop`);
 * - still unverified at the line's effective deadline: under `verification.unverifiedAtDeadline`
 *   = `enter_as_declared` (the default) nothing happens (F4 lists it as declared, unverified);
 *   under `hold` the deadline sweep expires a waiting line (`hold_unverified`) and drops a paid
 *   one through the receipt-gated drop with that day's refund, the board fee counted not sent.
 *
 * Locks: the line's receipt first (when it has one), then the line — MA-16's order, the one a
 * payment reversal, a receipt's void (ST-14) and return, the receipt-gated drop and a parent's
 * approval of a change request all take (the lead's decision of 8 Oct: receipt first
 * everywhere) — then the line's payments are read. A checkout locks the line too, so a rejection
 * and a checkout of one line run one after the other; so do a rejection and a parent's approval,
 * and a rejection and a reversal (08t, both orders each).
 */

import {
  db, registration, receipt, paymentRegistration, payment, parentStudentLink, schoolSetting,
  and, eq, inArray, sql,
} from '@repo/db';
import { hasRole, ROLES, FINANCE_ROLES, type VerifyPriorSittingType } from '@repo/validations';
import { logAction, logActions, expiryEntries, type AuditContext } from './audit.services';
import { effectiveDeadlineFor, effectiveDeadlinesOf } from './deadline.services';
import { executeReceiptGatedDrop } from './receipt.services';
import { getSetting } from './settings.services';
import { createNotification } from './notification.services';
import { refundForSystemDrop } from './reservation.services';
import { schoolDate } from './window.services';
import { formatSeriesName } from './statement.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class VerificationError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const DECLARED = ['declared_by_family', 'declared_by_desk'] as const;
export const PAID_MEANWHILE = 'This line was paid while the answer was being given: open it again and answer again';
const WAITING = ['pending_approval', 'pending_payment', 'preregistered'] as const;
const OPEN = ['pending', 'pending_verification'] as const;

// ─── The To verify tab ───────────────────────────────────────────────────────

/**
 * The session's declared sittings awaiting the coordinator (or, with `decided`, those already
 * answered): the student, the line, the sitting declared and by whom, whether it is paid, and the
 * deadline it must be answered by — most urgent first.
 */
export async function listToVerify(sessionId: string, show: 'awaiting' | 'decided' = 'awaiting') {
  const [session] = await db.execute(sql`select id, name, status from registration_session where id = ${sessionId}`)
    .then((r) => r.rows as { id: string; name: string; status: string }[]);
  if (!session) return null;
  const decided = show === 'decided';
  const rows = await db.execute(sql`
    select r.id, r.status, r.attempt, r.mode, r.price_at_registration as price, r.prior_sitting_source as source, r.created_at as "declaredAt",
      r.prior_sitting_verified_outcome as outcome, r.prior_sitting_verified_at as "decidedAt", r.declaration_rejected as "declarationRejected",
      vu.name as "decidedBy",
      u.id as "studentId", u.name as "studentName", u.student_id as "studentNumber",
      s.name as "subjectName", i.label as "itemLabel", i.kind as "itemKind", i.needs_prior_series as "carriesForward",
      ps.id as "priorSeriesId", ps.board_code as "priorBoard", ps.month as "priorMonth", ps.year as "priorYear", ps.label as "priorLabel", pb.name as "priorBoardName",
      ru.name as "declaredBy", ru.role as "declaredByRole",
      line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) as deadline,
      r.board_series_id as "boardSeriesId", r.prior_sitting_series_id as "priorSittingSeriesId",
      exists (select 1 from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = r.id and p.status = 'completed') as paid,
      exists (select 1 from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = r.id and p.status in ('pending', 'pending_verification')) as "paymentOpen",
      (select sec.name from section_membership m join section sec on sec.id = m.section_id
        where m.student_id = u.id and m.ended_on is null order by m.started_on desc limit 1) as section
    from registration r
    join "user" u on u.id = r.student_id
    join session_offer_item i on i.id = r.offer_item_id
    join session_offer o on o.id = i.offer_id
    join subject s on s.id = o.subject_id
    join "user" ru on ru.id = r.requested_by
    left join "user" vu on vu.id = r.prior_sitting_verified_by
    left join board_series ps on ps.id = r.prior_sitting_series_id
    left join exam_board pb on pb.code = ps.board_code
    where r.session_id = ${sessionId}
      and r.prior_sitting_source in ('declared_by_family', 'declared_by_desk')
      and ${decided ? sql`r.prior_sitting_verified_outcome is not null` : sql`r.prior_sitting_verified_outcome is null and r.status in ('pending_approval', 'pending_payment', 'preregistered', 'confirmed')`}
    order by ${decided ? sql`r.prior_sitting_verified_at desc` : sql`deadline asc nulls last`}, u.name, s.name`)
    .then((r) => r.rows as Record<string, unknown>[]);
  const now = Date.now();
  // Each line's deadlines as effectiveDeadlineFor gives them for its student — a late board entry
  // granted while the setting is on (Q-20) counts, as it does when the line is answered.
  // The lines' own deadlines in one query (effectiveDeadlinesOf reads the flag and the late
  // entry); a first entry's deadline once per series and student.
  const ownOf = await effectiveDeadlinesOf(db, rows.map((r) => r.id as string));
  const firstOf = new Map<string, Date | null>();
  for (const r of rows) {
    const key = `${(r.boardSeriesId as string | null) ?? ''}|${r.studentId as string}`;
    if (firstOf.has(key)) continue;
    const d = await effectiveDeadlineFor(db, { boardSeriesId: (r.boardSeriesId as string | null) ?? null, attempt: 'first', priorSittingSeriesId: null, declarationRejected: false, studentId: r.studentId as string });
    firstOf.set(key, d.at);
  }
  const deadlines = rows.map((r) => ({
    own: ownOf.get(r.id as string)?.at ?? null,
    first: firstOf.get(`${(r.boardSeriesId as string | null) ?? ''}|${r.studentId as string}`) ?? null,
  }));
  const lines = rows.map((r, i) => {
      const deadline = deadlines[i]!.own;
      return {
        id: r.id as string,
        status: r.status as string,
        attempt: r.attempt as string,
        mode: r.mode as string,
        price: Number(r.price),
        paid: Boolean(r.paid),
        paymentOpen: Boolean(r.paymentOpen),
        student: { id: r.studentId as string, name: r.studentName as string, number: (r.studentNumber as string | null) ?? null, section: (r.section as string | null) ?? null },
        line: { subject: r.subjectName as string, item: r.itemLabel as string, kind: r.itemKind as string, carriesForward: Boolean(r.carriesForward) },
        sitting: r.priorSeriesId ? {
          id: r.priorSeriesId as string,
          name: formatSeriesName({ boardName: (r.priorBoardName as string | null) ?? (r.priorBoard as string), month: r.priorMonth as string, year: Number(r.priorYear), label: (r.priorLabel as string | null) ?? '' }),
        } : null,
        declaredBy: { channel: r.source === 'declared_by_family' ? 'family' as const : 'desk' as const, name: r.declaredBy as string, role: r.declaredByRole as string },
        declaredAt: new Date(r.declaredAt as string),
        deadline,
        daysLeft: deadline ? Math.ceil((deadline.getTime() - now) / 86_400_000) : null,
        // Which answer applies to a paid line: before it the line stands as a first entry, after it is dropped.
        firstEntryDeadlinePassed: !!deadlines[i]!.first && deadlines[i]!.first!.getTime() <= now,
        outcome: (r.outcome as 'verified' | 'rejected' | null) ?? null,
        decidedAt: r.decidedAt ? new Date(r.decidedAt as string) : null,
        decidedBy: (r.decidedBy as string | null) ?? null,
        declarationRejected: Boolean(r.declarationRejected),
      };
    });
  // Most urgent first, by the deadline as computed (awaiting); the latest answers first (decided: the query's order).
  if (!decided) lines.sort((a, b) => (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity));
  return { session, show, lines };
}

// ─── Telling the family ──────────────────────────────────────────────────────

async function tellFamily(studentId: string, title: string, body: string, data: Record<string, unknown>) {
  await createNotification(studentId, 'DECLARATION_REVIEWED', title, body, data);
  const parents = await db.select({ parentId: parentStudentLink.parentId }).from(parentStudentLink)
    .where(and(eq(parentStudentLink.studentId, studentId), eq(parentStudentLink.status, 'approved')));
  for (const p of parents) await createNotification(p.parentId, 'DECLARATION_REVIEWED', title, body, { ...data, studentId });
}

type LineRow = {
  id: string; studentId: string; sessionId: string; status: string; attempt: string; mode: string;
  boardSeriesId: string | null; priorSittingSeriesId: string | null; priorSittingSource: string | null;
  outcome: string | null; declarationRejected: boolean; priceAtRegistration: number; registrationFeeAtRegistration: number; name: string; sitting: string | null;
};

async function loadLine(executor: typeof db | Tx, id: string): Promise<LineRow | null> {
  const [r] = await executor.execute(sql`
    select r.id, r.student_id as "studentId", r.session_id as "sessionId", r.status, r.attempt, r.mode, r.board_series_id as "boardSeriesId",
      r.prior_sitting_series_id as "priorSittingSeriesId", r.prior_sitting_source as "priorSittingSource",
      r.prior_sitting_verified_outcome as outcome, r.declaration_rejected as "declarationRejected", r.price_at_registration as "priceAtRegistration",
      r.registration_fee_at_registration as "registrationFeeAtRegistration",
      case when i.kind = 'whole' then s.name else s.name || ' — ' || i.label end as name,
      pb.name as "priorBoardName", ps.month as "priorMonth", ps.year as "priorYear", ps.label as "priorLabel"
    from registration r join session_offer_item i on i.id = r.offer_item_id join session_offer o on o.id = i.offer_id join subject s on s.id = o.subject_id
    left join board_series ps on ps.id = r.prior_sitting_series_id left join exam_board pb on pb.code = ps.board_code
    where r.id = ${id}`).then((x) => x.rows as Record<string, unknown>[]);
  if (!r) return null;
  return {
    id: r.id as string, studentId: r.studentId as string, sessionId: r.sessionId as string, status: r.status as string,
    attempt: r.attempt as string, mode: r.mode as string, boardSeriesId: (r.boardSeriesId as string | null) ?? null,
    priorSittingSeriesId: (r.priorSittingSeriesId as string | null) ?? null, priorSittingSource: (r.priorSittingSource as string | null) ?? null,
    outcome: (r.outcome as string | null) ?? null, declarationRejected: Boolean(r.declarationRejected), priceAtRegistration: Number(r.priceAtRegistration),
    registrationFeeAtRegistration: Number(r.registrationFeeAtRegistration ?? 0), name: r.name as string,
    sitting: r.priorMonth ? formatSeriesName({ boardName: r.priorBoardName as string, month: r.priorMonth as string, year: Number(r.priorYear), label: (r.priorLabel as string | null) ?? '' }) : null,
  };
}

/** The receipt first (when the line has one), then the line — MA-16's order; returns the line as it is now. */
async function lockLine(tx: Tx, id: string) {
  await tx.select({ id: receipt.id }).from(receipt).where(eq(receipt.registrationId, id)).for('update');
  await tx.select({ id: registration.id }).from(registration).where(eq(registration.id, id)).for('update');
  return loadLine(tx, id);
}

async function paymentState(tx: Tx, registrationId: string) {
  const rows = await tx.select({ status: payment.status }).from(paymentRegistration)
    .innerJoin(payment, eq(payment.id, paymentRegistration.paymentId))
    .where(eq(paymentRegistration.registrationId, registrationId));
  return { funded: rows.some((r) => r.status === 'completed'), open: rows.some((r) => (OPEN as readonly string[]).includes(r.status)) };
}

// ─── Verify or reject ────────────────────────────────────────────────────────

export type VerifyOutcome =
  | { outcome: 'verified' }
  | { outcome: 'rejected'; effect: 'expired' }
  | { outcome: 'rejected'; effect: 'stands' }
  | { outcome: 'rejected'; effect: 'dropped'; refundAmount: number; refundPercentage: number; gated: boolean };

/**
 * The coordinator's (the admin's, or the finance desk's with evidence) answer to one declared
 * sitting, with every outcome of §3.5; the audit row in the same transaction; the family told
 * after the commit when it was rejected.
 */
export async function verifyPriorSitting(
  registrationId: string,
  input: VerifyPriorSittingType,
  actor: { id: string; role: string },
  ctx?: AuditContext,
  now: Date = new Date(),
): Promise<VerifyOutcome & { registrationId: string }> {
  if (hasRole(actor.role, ...FINANCE_ROLES) && actor.role !== ROLES.ADMIN && !input.evidence) {
    throw new VerificationError('The finance desk verifies a sitting with the board\'s statement in hand: say what was seen');
  }
  const before = await loadLine(db, registrationId);
  if (!before) throw new VerificationError('Registration not found', 404);

  const result = await db.transaction(async (tx): Promise<VerifyOutcome> => {
    const line = await lockLine(tx, registrationId);
    if (!line) throw new VerificationError('Registration not found', 404);
    if (!line.priorSittingSource || !(DECLARED as readonly string[]).includes(line.priorSittingSource)) {
      throw new VerificationError('This line follows no declared sitting: there is nothing to verify', 409);
    }
    if (line.outcome) throw new VerificationError(`This declared sitting was already ${line.outcome}`, 409);
    if (!['pending_approval', 'pending_payment', 'preregistered', 'confirmed'].includes(line.status)) {
      throw new VerificationError('This line is no longer reserved: there is nothing to verify', 409);
    }
    const decided = { priorSittingVerifiedOutcome: input.outcome, priorSittingVerifiedAt: now, priorSittingVerifiedBy: actor.id, updatedAt: now };
    const why = { reason: input.reason, ...(input.evidence ? { evidence: input.evidence } : {}) };

    if (input.outcome === 'verified') {
      await tx.update(registration).set({
        ...decided,
        ...(input.prevCentre ? { priorCentre: input.prevCentre } : {}),
        ...(input.prevCandidateNumber ? { priorCandidateNumber: input.prevCandidateNumber } : {}),
      }).where(eq(registration.id, registrationId));
      // The previous centre and candidate number are recorded, never listed (§3.5): the row says only that they were.
      await logAction(actor.id, 'PRIOR_SITTING_VERIFIED', 'registration', registrationId, { priorSittingSource: line.priorSittingSource },
        { outcome: 'verified', priorSittingSeriesId: line.priorSittingSeriesId, ...why, previousCentreRecorded: !!input.prevCentre }, ctx, tx);
      return { outcome: 'verified' };
    }

    const { funded, open } = await paymentState(tx, registrationId);
    const paid = line.status === 'confirmed' || (line.status === 'preregistered' && funded);
    if (!paid) {
      if (open) throw new VerificationError('A payment for this line is in progress: confirm or reject it in the Finance Workbench first', 409);
      const [expired] = await tx.update(registration).set({ ...decided, status: 'expired' })
        .where(and(eq(registration.id, registrationId), inArray(registration.status, [...WAITING]))).returning({ id: registration.id });
      if (!expired) throw new VerificationError('The line changed while this was open: try again', 409);
      await logActions(expiryEntries([{ id: registrationId, from: line.status }], 'declaration_rejected'), tx);
      await logAction(actor.id, 'PRIOR_SITTING_REJECTED', 'registration', registrationId, { status: line.status },
        { outcome: 'rejected', effect: 'expired', priorSittingSeriesId: line.priorSittingSeriesId, ...why }, ctx, tx);
      return { outcome: 'rejected', effect: 'expired' };
    }

    // Paid: before the first-entry deadline the line stands (entered as a first entry); after it,
    // it cannot be entered at all (MO-10) and is dropped with the "sent" rule's refund. A paid
    // preregistration stands either way: its series' opening or its deadline's MO-21 refund settles it.
    // A first entry's deadline for this student: a late board entry granted to them counts while
    // the setting is on (Q-20), as it does for the line's own deadline below.
    const first = await effectiveDeadlineFor(tx, { boardSeriesId: line.boardSeriesId, attempt: 'first', priorSittingSeriesId: null, declarationRejected: false, studentId: line.studentId });
    const pastFirstEntry = !!first.at && first.at <= now;
    if (!pastFirstEntry || line.status === 'preregistered') {
      await tx.update(registration).set({ ...decided, declarationRejected: true }).where(eq(registration.id, registrationId));
      await logAction(actor.id, 'PRIOR_SITTING_REJECTED', 'registration', registrationId, { status: line.status },
        { outcome: 'rejected', effect: 'stands', declarationRejected: true, priorSittingSeriesId: line.priorSittingSeriesId, ...why }, ctx, tx);
      return { outcome: 'rejected', effect: 'stands' };
    }
    // Paid while this answer waited for the line: its receipt was made after lockLine looked for
    // one, so the drop below would take it after the line — against MA-16's order (a reversal of
    // that payment takes the receipt first). Refused; asked again, the receipt is taken first.
    if (before.status !== 'confirmed') throw new VerificationError(PAID_MEANWHILE, 409);
    // The board fee follows the per-line "sent" rule (§3.5, §3.9): sent once the line's own
    // effective deadline has passed (F4's mark will say so too). A declared retake of the board's
    // previous sitting runs to the retake deadline, so between the two deadlines it is not sent.
    const own = await effectiveDeadlineFor(tx, { ...line, studentId: line.studentId });
    const boardSent = !!own.at && own.at <= now;
    const refund = await refundForSystemDrop(line, now, { boardSent });
    const drop = await executeReceiptGatedDrop(tx, {
      registrationId, studentId: line.studentId, refundAmount: refund.amount, refundReason: 'drop', initiatedBy: actor.id,
    });
    await tx.update(registration).set(decided).where(eq(registration.id, registrationId));
    await logAction(actor.id, 'PRIOR_SITTING_REJECTED', 'registration', registrationId, { status: 'confirmed' },
      { outcome: 'rejected', effect: 'dropped', status: drop.gated ? 'dropped_pending_receipt' : 'dropped', refundAmount: drop.refundAmount,
        refundPercentage: refund.percentage, boardSent, boardFeeKept: refund.boardFeeKept, gated: drop.gated, firstEntryDeadline: first.at!.toISOString(), priorSittingSeriesId: line.priorSittingSeriesId, ...why }, ctx, tx);
    return { outcome: 'rejected', effect: 'dropped', refundAmount: drop.refundAmount, refundPercentage: refund.percentage, gated: drop.gated };
  });

  if (result.outcome === 'rejected') {
    const sitting = before.sitting ?? 'the sitting declared';
    const body = result.effect === 'expired'
      ? `The school could not confirm ${sitting} for ${before.name}, so the retake reservation has ended. You may reserve it again as a first entry where the school offers one.`
      : result.effect === 'stands'
        ? `The school could not confirm ${sitting} for ${before.name}. The subject stays reserved and paid; it will be entered with the board as a first entry. The finance office will tell you if anything is owed.`
        : `The school could not confirm ${sitting} for ${before.name}, and the board's first-entry deadline has passed, so it cannot be entered. It has been dropped: ${result.gated ? `bring the paper receipt back to the finance desk to release EGP ${result.refundAmount.toFixed(2)} to your escrow` : `EGP ${result.refundAmount.toFixed(2)} was returned to your escrow`}.`;
    await tellFamily(before.studentId, 'Declared sitting not confirmed', body, { registrationId, effect: result.effect })
      .catch((err) => console.error('[verification] Could not tell the family:', err));
  }
  return { ...result, registrationId };
}

// ─── Unverified at the deadline: `hold` (the sweep step) ─────────────────────

/**
 * Under `verification.unverifiedAtDeadline = hold`, every declared sitting still unverified at
 * its line's effective deadline ends the line: a waiting line expires (`hold_unverified`); a paid
 * one is dropped through the receipt-gated drop with that day's refund, the board fee counted not
 * sent (a held line was never entered). A waiting line with a payment still open is left to the
 * deadline sweep that follows on the same tick (it fails the payment and expires the line, as at
 * any deadline). Only a deadline that passed while `hold` was in force counts (the setting's own
 * time): a line whose deadline passed under `enter_as_declared` was entered then. Claim before acting (ST-06, ST-12): each line is locked and read again in its
 * own transaction, and acted on only while it is still unverified and in the status it was
 * found in — a second scheduler instance finds it done and skips it; a failure is retried next
 * tick. Under `enter_as_declared` nothing happens: F4 lists the line as declared, unverified.
 */
export async function holdUnverifiedAtDeadline(now: Date = new Date()) {
  if ((await getSetting('verification.unverifiedAtDeadline')) !== 'hold') return { expired: 0, dropped: 0 };
  // Only a deadline that passed while `hold` was in force: a line whose deadline passed under
  // `enter_as_declared` was entered as declared then, and turning `hold` on later does not undo it.
  // Hold counts from the moment the value became `hold` — its SETTING_CHANGED row — not from the
  // setting row's own time, which other writes may move. A row set to `hold` with no change on
  // record (seeded) counts from its own time.
  const [changed] = await db.execute(sql`
    select created_at as at from audit_log
    where action = 'SETTING_CHANGED' and entity_id = 'verification.unverifiedAtDeadline' and new_data->>'value' = 'hold'
    order by created_at desc limit 1`).then((r) => r.rows as { at: unknown }[]);
  const [row] = changed ? [] : await db.select({ at: schoolSetting.updatedAt }).from(schoolSetting).where(eq(schoolSetting.key, 'verification.unverifiedAtDeadline'));
  const sinceAt = changed ? new Date(String(changed.at)) : row?.at ?? null;
  if (!sinceAt) return { expired: 0, dropped: 0 };
  const since = { at: sinceAt };
  const due = await db.execute(sql`
    select r.id, r.status from registration r
    where r.prior_sitting_source in ('declared_by_family', 'declared_by_desk') and r.prior_sitting_verified_outcome is null
      and r.status in ('pending_approval', 'pending_payment', 'confirmed')
      and line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) <= ${now}
      and line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) > ${since.at}
    order by r.id`).then((x) => x.rows as { id: string; status: string }[]);
  let expired = 0;
  let dropped = 0;
  for (const { id, status: found } of due) {
    try {
      const done = await db.transaction(async (tx) => {
        const line = await lockLine(tx, id);
        if (!line || line.outcome || !(DECLARED as readonly string[]).includes(line.priorSittingSource ?? '')) return null;
        const d = await effectiveDeadlineFor(tx, { ...line, studentId: line.studentId });
        if (!d.at || d.at > now || d.at <= since.at) return null;
        if (line.status === 'pending_approval' || line.status === 'pending_payment') {
          if ((await paymentState(tx, id)).open) return null;
          const [row] = await tx.update(registration).set({ status: 'expired', updatedAt: now })
            .where(and(eq(registration.id, id), eq(registration.status, line.status))).returning({ id: registration.id });
          if (!row) return null;
          await logActions(expiryEntries([{ id, from: line.status }], 'hold_unverified'), tx);
          return { line, effect: 'expired' as const, deadline: d.at };
        }
        if (line.status !== 'confirmed') return null;
        // Paid since this tick found it waiting: its receipt was made after lockLine looked for one
        // (MA-16's order); left to the next tick, which takes the receipt first.
        if (found !== 'confirmed') return null;
        const refund = await refundForSystemDrop(line, now, { boardSent: false });
        const drop = await executeReceiptGatedDrop(tx, { registrationId: id, studentId: line.studentId, refundAmount: refund.amount, refundReason: 'drop', initiatedBy: line.studentId });
        await logAction(null, 'LINE_DROPPED_UNVERIFIED', 'registration', id, { status: 'confirmed' },
          { status: drop.gated ? 'dropped_pending_receipt' : 'dropped', refundAmount: drop.refundAmount, refundPercentage: refund.percentage, gated: drop.gated,
            deadline: d.at.toISOString(), setting: 'hold', priorSittingSeriesId: line.priorSittingSeriesId }, undefined, tx);
        return { line, effect: 'dropped' as const, deadline: d.at, drop };
      });
      if (!done) continue;
      if (done.effect === 'expired') expired++;
      else dropped++;
      const sitting = done.line.sitting ?? 'the sitting declared';
      const body = done.effect === 'expired'
        ? `${sitting} for ${done.line.name} was not confirmed by the board's deadline (${schoolDate(done.deadline)}), so the reservation has ended.`
        : `${sitting} for ${done.line.name} was not confirmed by the board's deadline (${schoolDate(done.deadline)}), so it was not entered and has been dropped: ${done.drop.gated ? `bring the paper receipt back to the finance desk to release EGP ${done.drop.refundAmount.toFixed(2)} to your escrow` : `EGP ${done.drop.refundAmount.toFixed(2)} was returned to your escrow`}.`;
      await tellFamily(done.line.studentId, 'Declared sitting not confirmed in time', body, { registrationId: id, effect: done.effect })
        .catch((err) => console.error('[verification] Could not tell the family:', err));
    } catch (err) {
      console.error(`[verification] Could not hold line ${id} at its deadline:`, err);
    }
  }
  return { expired, dropped };
}
