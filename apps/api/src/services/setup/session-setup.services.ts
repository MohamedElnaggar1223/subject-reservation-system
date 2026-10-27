/**
 * A session set up the way the coordinator works (COORDINATOR_REWORK.md C1–C10, E4, E6, D11, D13;
 * Appendix A `/sessions`).
 *
 * - Create: a type and a year; the name derived. Empty, or a copy of an earlier session of the type
 *   with every year moved forward (C3): its offerings, rows, cells, teachers, notes, questions, refund
 *   policy, self-study share, grades and cancel days; sittings, carried-from lists and dates moved;
 *   last cycle's prices copied, prices final off. Born a draft (C4): invisible to families.
 * - The header and what families agree to: the optional close date, payment due, first lesson, the
 *   self-study share (its change answers its impact first: it re-prices the session's unpaid
 *   self-study lines), the grades that may reserve, the cancel days, the refund policy (until a family
 *   consents), the session's questions.
 * - The Accepting switch: open (refused while the check list has a blocking item), close, reopen
 *   (closed → open). No automatic opening: a session made here has no start date until it opens.
 * - Prices final (E6): one-way once any line exists; switching it on makes the waiting lines payable
 *   and re-dates them from that moment (§6), its impact counted first.
 * - The check list ("Check before you open", §5).
 *
 * The deprecated legacy contract (dates given at creation, the offers-only copy) stays in
 * session.services.ts for the old screen and the suites P1b adapts.
 */

import {
  db, registrationSession, registration, registrationConsent, sessionOffer, sessionOfferItem, sessionQuestion, teacher,
  sessionOfferTeacher, sessionOfferItemTeacher, subject, and, eq, inArray, isNotNull, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  deriveSessionName, refundPolicySentence, DEFAULT_ALLOWED_GRADES,
  type RefundPolicy, type UpdateSessionType, type PricesFinalType, type QuestionInputType,
} from '@repo/validations';
import { logAction, type AuditContext } from '../audit.services';
import { getSetting } from '../settings.services';
import { redateLines } from '../deadline.services';
import { cutOffsOf } from '../window.services';
import { coded } from '../../lib/refusal';
import { hasActiveSessionOfType, SessionError } from '../session.services';
import { capturePreregistrationsForSession } from '../prereg.services';
import { notifySessionOpened, getStudentAndParentBroadcastIds } from '../notification.services';
import { sameTeacherReason } from './teacher-names';
import { copyOfferingInto, offeringsView, writeQuestions, SetupError, setupRethrow } from './offering.services';
import { defaultSessionDates, rollDateOnly, rollYears, LIVE_LINE_STATUSES as LIVE } from './model';
import {
  planReprice, applyReprice, settleImpact, addImpact, tellRepriced, ImpactPending, NO_IMPACT, type Impact,
} from './reprice.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;
type SessionRow = typeof registrationSession.$inferSelect;

const WAITING = ['pending_approval', 'pending_payment', 'preregistered'];

const sameCycle = (s: { sessionType: string; seriesYear: number; label: string }) =>
  `An open ${deriveSessionName(s.sessionType, s.seriesYear, s.label)} session already exists: close it before opening another`;

// ─── Create (C1–C3) ──────────────────────────────────────────────────────────

/**
 * POST /sessions (the new contract): a draft of a type and year, empty or copied from an earlier
 * session of the type with its years moved forward.
 */
export async function createSetupSession(data: { type: 'june' | 'winter'; year: number; label: string; copyFromSessionId?: string }, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const src = data.copyFromSessionId
        ? (await tx.select().from(registrationSession).where(eq(registrationSession.id, data.copyFromSessionId)).for('share'))[0]
        : undefined;
      if (data.copyFromSessionId && !src) throw new SetupError('The session to copy from was not found', 404);
      if (src && src.sessionType !== data.type) throw new SetupError('Copy from a session of the same type (June from June, November / January from November / January)');
      const years = src ? data.year - src.seriesYear : 0;
      const defaults = defaultSessionDates(data.type, data.year);
      const now = new Date();
      const rolledClose = src ? rollYears(src.endDate, years) : null;
      const id = randomUUID();
      const policy = (src?.refundPolicy as RefundPolicy | null) ?? await getSetting(data.type === 'june' ? 'refund.defaultPolicy.june' : 'refund.defaultPolicy.winter', tx);
      const [row] = await tx.insert(registrationSession).values({
        id, name: deriveSessionName(data.type, data.year, data.label), sessionType: data.type, seriesYear: data.year, label: data.label,
        qualificationLevel: null, startDate: null,
        endDate: rolledClose && rolledClose > now ? rolledClose : null,
        courseStartsOn: src ? rollDateOnly(src.courseStartsOn, years) : defaults.courseStartsOn,
        paymentDueAt: src ? rollYears(src.paymentDueAt, years)! : defaults.paymentDueAt,
        refundPolicy: policy, status: 'draft', editHistory: [],
        selfStudyPercent: src?.selfStudyPercent ?? 50, pricesFinal: false, pricesFinalAt: null,
        allowedGrades: src?.allowedGrades ?? DEFAULT_ALLOWED_GRADES, unpaidCancelDays: src?.unpaidCancelDays ?? 3, copiedFromSessionId: src?.id ?? null,
      }).returning();
      await logAction(actorId, 'SESSION_CREATED', 'session', id, null, { ...(row as Record<string, unknown>), copiedFrom: src?.name ?? null }, ctx, tx);
      let copy: { from: string; offerings: number; questions: number; yearsMoved: number; skipped: string[] } | null = null;
      if (src) {
        const qs = await tx.select().from(sessionQuestion)
          .where(and(eq(sessionQuestion.sessionId, src.id), sql`${sessionQuestion.offeringId} is null`)).orderBy(asc(sessionQuestion.sortOrder));
        if (qs.length) {
          await tx.insert(sessionQuestion).values(qs.map((q) => ({
            id: randomUUID(), sessionId: id, offeringId: null, kind: q.kind, prompt: q.prompt, choices: q.choices, required: q.required, sortOrder: q.sortOrder, createdBy: actorId,
          })));
        }
        const offers = await tx.select({ offer: sessionOffer, active: subject.isActive, name: subject.name }).from(sessionOffer)
          .innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
          .where(eq(sessionOffer.sessionId, src.id)).orderBy(asc(sessionOffer.sortOrder), asc(sessionOffer.id));
        let copied = 0;
        const skipped: string[] = [];
        for (const o of offers) {
          if (!o.active) { skipped.push(o.name); continue; }
          await copyOfferingInto(tx, row!, o.offer, src, actorId, ctx);
          copied++;
        }
        copy = { from: src.name, offerings: copied, questions: qs.length, yearsMoved: years, skipped };
        await logAction(actorId, 'SESSION_COPIED', 'session', id, null, { fromSessionId: src.id, ...copy, pricesFinal: false }, ctx, tx);
      }
      return { ...row!, copied: null, copy };
    });
  } catch (err) {
    setupRethrow(err);
  }
}

// ─── The header and what families agree to ───────────────────────────────────

export type SessionSave = { saved: boolean; impact: Impact; dueDatesMoved: number };

/** A start date on a coordinator's draft: it would let the scheduler open it past its check list. */
export const START_DATE_REFUSAL = 'This draft opens with the Accepting switch once its check list is clear, not with a start date';

/**
 * PUT /sessions/:id — the header and what families agree to (both contracts; see the header). A share
 * change re-prices the session's unpaid self-study lines and lists the rest for finance; a payment due
 * date change re-dates the waiting lines; a cut of the unpaid-cancel days, or a due date moved, brings the
 * unpaid lines' cut-off forward (C10: line_cut_off reads the session's current days), counted as
 * cutOffsEarlier and, of those, cutOffsPassed (already past it: the next tick expires them). Each answers
 * its impact first (`expected`; IMPACT_CHANGED if the counts moved). The coordinator sets and clears the
 * close date (owner decision 26 Oct; C4): the scheduler closes the session at it, and that close, like the
 * switch's, stops new reservations only — a waiting line stays payable until its cut-off (C10, the sweep in
 * overdue.services.ts).
 */
export async function updateSetupSession(id: string, data: UpdateSessionType, actorId: string, ctx?: AuditContext): Promise<SessionSave> {
  try {
    const out = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(registrationSession).where(eq(registrationSession.id, id)).for('update');
      if (!current) throw new SessionError('Session not found', 404);
      if (current.status === 'closed') throw new SessionError('Cannot update a closed session');
      const now = new Date();
      const next: Partial<typeof registrationSession.$inferInsert> = {};
      // The deprecated legacy fields, with their old rules.
      if (current.status === 'active') {
        if (data.startDate && data.startDate.getTime() !== current.startDate?.getTime()) throw new SessionError('An open session keeps its start date');
        if (data.endDate && data.endDate.getTime() !== current.endDate?.getTime()) {
          if (data.endDate <= now) throw new SessionError('New end date must be in the future (close the session to end it now)');
          if (!data.reason || data.reason.trim().length < 5) throw new SessionError('Please provide a reason for the deadline change');
          next.endDate = data.endDate;
        }
      } else {
        // A draft made by the coordinator has no start date: it opens with the Accepting switch, after its
        // check list (C4, C6). A start date given here would let the scheduler open it past the check list.
        if (data.startDate && !current.startDate) throw new SessionError(START_DATE_REFUSAL, 409);
        if (data.startDate) next.startDate = data.startDate;
        if (data.endDate) next.endDate = data.endDate;
      }
      // C4: the optional automatic close, a date picker (no reason asked); cleared with null.
      if (data.closesAt !== undefined && (data.closesAt?.getTime() ?? null) !== (current.endDate?.getTime() ?? null)) {
        if (data.closesAt && data.closesAt <= now) throw new SessionError('The close date must be in the future (switch Accepting off to close it now)');
        next.endDate = data.closesAt;
      }
      if (next.endDate && next.endDate.getTime() > now.getTime() + 24 * 60 * 60 * 1000) next.reminderSentAt = null;
      const start = next.startDate ?? current.startDate;
      const end = next.endDate !== undefined ? next.endDate : current.endDate;
      if (start && end && end <= start) throw new SessionError('End date must be after start date');
      if (data.courseStartsOn && data.courseStartsOn !== current.courseStartsOn) next.courseStartsOn = data.courseStartsOn;
      if (data.paymentDueAt && data.paymentDueAt.getTime() !== current.paymentDueAt.getTime()) next.paymentDueAt = data.paymentDueAt;
      if (data.selfStudyPercent !== undefined && data.selfStudyPercent !== current.selfStudyPercent) next.selfStudyPercent = data.selfStudyPercent;
      if (data.allowedGrades && JSON.stringify([...data.allowedGrades].sort()) !== JSON.stringify([...current.allowedGrades].sort())) next.allowedGrades = [...new Set(data.allowedGrades)];
      if (data.unpaidCancelDays !== undefined && data.unpaidCancelDays !== current.unpaidCancelDays) next.unpaidCancelDays = data.unpaidCancelDays;
      if (data.refundPolicy && JSON.stringify(data.refundPolicy) !== JSON.stringify(current.refundPolicy)) {
        const [consented] = await tx.select({ id: registrationConsent.id }).from(registrationConsent)
          .innerJoin(registration, eq(registration.id, registrationConsent.registrationId))
          .where(and(eq(registration.sessionId, id), eq(registrationConsent.kind, 'refund_policy'))).limit(1);
        if (consented) throw new SessionError('A family has consented to this session\'s refund policy: it can no longer change (an exception changes one student\'s)', 409);
        next.refundPolicy = data.refundPolicy;
      }
      const questionsChanged = data.questions ? await writeQuestions(tx, id, null, data.questions as QuestionInputType[], actorId) : false;
      // C5: the two dates kept as they stand, said so (recorded in the edit history the check list reads).
      const datesConfirmed = !!data.datesConfirmed && datesToCheck(current) && !('paymentDueAt' in next) && !('courseStartsOn' in next);
      if (!Object.keys(next).length && !questionsChanged && !datesConfirmed) {
        // The dates said kept again (a second click): already so — nothing to write, nothing to refuse.
        if (data.datesConfirmed) return { impact: NO_IMPACT, repriced: [], dueMoved: 0, name: current.name };
        throw new SessionError('Nothing to change');
      }
      const history = Object.entries(next)
        .filter(([k]) => k !== 'reminderSentAt')
        .map(([field, v]) => ({
          editedBy: actorId, editedAt: now.toISOString(), field,
          oldValue: JSON.stringify((current as Record<string, unknown>)[field] ?? null), newValue: JSON.stringify(v ?? null), reason: data.reason ?? undefined,
        }));
      if (datesConfirmed) {
        history.push({
          editedBy: actorId, editedAt: now.toISOString(), field: 'datesConfirmed',
          oldValue: JSON.stringify({ paymentDueAt: current.paymentDueAt, courseStartsOn: current.courseStartsOn }), newValue: 'true', reason: data.reason ?? undefined,
        });
      }
      // The waiting lines, locked once in id order after the session: the unpaid ones among them have their
      // cut-offs counted (D1 of the P1b review: the days and the due date move them), and every one is re-dated
      // below when the due date moves. One pass over the superset (P1c): locking the unpaid subset and then the
      // waiting superset could deadlock with a transaction locking an interleaved set in id order.
      const waitingLines = 'unpaidCancelDays' in next || 'paymentDueAt' in next
        ? await tx.select({ id: registration.id, status: registration.status }).from(registration)
          .where(and(eq(registration.sessionId, id), inArray(registration.status, WAITING))).orderBy(registration.id).for('update')
        : [];
      const unpaid = waitingLines.filter((l) => l.status === 'pending_payment').map((l) => l.id);
      const cutOffsBefore = await cutOffsOf(tx, unpaid);
      if (Object.keys(next).length || datesConfirmed) {
        await tx.update(registrationSession).set({
          ...next,
          editHistory: sql`COALESCE(${registrationSession.editHistory}, '[]'::jsonb) || ${JSON.stringify(history)}::jsonb`,
          updatedAt: now,
        }).where(eq(registrationSession.id, id));
      }
      // The share changed: the session's self-study lines priced again (its rows' FOR SHARE in insertLines
      // waits behind this session's FOR UPDATE, so no line is made at the old share meanwhile).
      const plan = 'selfStudyPercent' in next ? await planReprice(tx, { selfStudyOfSession: id }) : { repriced: [], listed: [] };
      const { told: repriced, impact: priced } = await applyReprice(tx, plan, { actorId, reason: `the self-study share of ${current.name} changed to ${next.selfStudyPercent}%`, entity: { type: 'session', id }, ctx });
      // The payment due date moved: the waiting lines' due dates follow — counted with the rest, answered first.
      let dueMoved = 0;
      if (next.paymentDueAt) {
        dueMoved = await redateLines(tx, waitingLines.map((w) => w.id), actorId, 'the session\'s payment due date changed');
      }
      // The cut-offs after it (line_cut_off reads the session as this transaction now has it).
      const cutOffsAfter = await cutOffsOf(tx, unpaid);
      let cutOffsEarlier = 0;
      let cutOffsPassed = 0;
      for (const lineId of unpaid) {
        const was = cutOffsBefore.get(lineId)?.cutOff;
        const is = cutOffsAfter.get(lineId)?.cutOff;
        if (!was || !is || is >= was) continue;
        cutOffsEarlier++;
        if (is <= now && was > now) cutOffsPassed++;
      }
      const impact = addImpact(priced, { dueDatesMoved: dueMoved, cutOffsEarlier, cutOffsPassed });
      settleImpact(impact, data.expected);
      await logAction(actorId, 'SESSION_UPDATED', 'session', id,
        Object.fromEntries(Object.keys(next).map((k) => [k, (current as Record<string, unknown>)[k] ?? null])),
        { ...next, ...(questionsChanged ? { questions: data.questions!.map((q) => q.prompt) } : {}), ...(datesConfirmed ? { datesConfirmed: true } : {}), reason: data.reason ?? null, dueDatesMoved: dueMoved, cutOffsEarlier, cutOffsPassed, repriced: repriced.length }, ctx, tx);
      return { impact, repriced, dueMoved, name: current.name };
    });
    await tellRepriced(out.repriced, `The self-study share of ${out.name} changed`);
    return { saved: true, impact: out.impact, dueDatesMoved: out.dueMoved };
  } catch (err) {
    if (err instanceof ImpactPending) return { saved: false, impact: err.impact, dueDatesMoved: 0 };
    if (err instanceof SessionError) throw err;
    setupRethrow(err);
  }
}

// ─── The Accepting switch (C4) ───────────────────────────────────────────────

/** POST /sessions/:id/open — a draft opens (refused while the check list blocks it); its start date is written. */
export async function openSetupSession(id: string, actorId: string, ctx?: AuditContext) {
  const updated = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(registrationSession).where(eq(registrationSession.id, id)).for('update');
    if (!s) throw new SessionError('Session not found', 404);
    if (s.status === 'active') throw new SessionError(`${s.name} is already open`, 409);
    if (s.status === 'closed') throw new SessionError(`${s.name} is closed: reopen it instead`, 409);
    const blocking = (await checkListOf(tx, s)).filter((c) => c.severity === 'blocks');
    if (blocking.length) throw new SessionError(`${s.name} cannot open yet: ${blocking.map((b) => b.message).join('; ')}`, 409);
    if (await hasActiveSessionOfType(s.sessionType, s.seriesYear, s.label, id)) throw new SessionError(sameCycle(s), 409);
    const now = new Date();
    const [row] = await tx.update(registrationSession).set({
      status: 'active', startDate: s.startDate ?? now, updatedAt: now,
      editHistory: sql`COALESCE(${registrationSession.editHistory}, '[]'::jsonb) || ${JSON.stringify([{ editedBy: actorId, editedAt: now.toISOString(), field: 'status', oldValue: '"draft"', newValue: '"active"' }])}::jsonb`,
    }).where(eq(registrationSession.id, id)).returning();
    await logAction(actorId, 'SESSION_ACTIVATED', 'session', id, { status: s.status }, { status: 'active', startDate: row!.startDate, via: 'the Accepting switch' }, ctx, tx);
    return row!;
  }).catch((err) => {
    if ((err as { cause?: { code?: string } } | null)?.cause?.code === '23505') throw new SessionError('Another session of this type and year is already open: close it first', 409);
    throw err;
  });
  capturePreregistrationsForSession(id).catch((err) => console.error(`[session] Prereg capture failed for ${id}:`, err));
  const { studentIds, parentIds } = await getStudentAndParentBroadcastIds();
  notifySessionOpened({ sessionId: id, sessionName: updated.name, sessionType: updated.sessionType, deadline: updated.endDate, studentIds, parentIds })
    .catch((err) => console.error('[notification] session opened failed:', err));
  return updated;
}

/**
 * POST /sessions/:id/reopen — a closed session opens again (§9.1: closed → active). Its close is
 * undone (a close date already passed is cleared, so the scheduler does not close it again at once);
 * nothing that expired at the close comes back.
 */
export async function reopenSetupSession(id: string, actorId: string, reason: string | undefined, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(registrationSession).where(eq(registrationSession.id, id)).for('update');
    if (!s) throw new SessionError('Session not found', 404);
    if (s.status !== 'closed') throw new SessionError(`${s.name} is ${s.status === 'active' ? 'open' : 'a draft'}: only a closed session reopens`, 409);
    if (await hasActiveSessionOfType(s.sessionType, s.seriesYear, s.label, id)) throw new SessionError(sameCycle(s), 409);
    const now = new Date();
    const endDate = s.endDate && s.endDate <= now ? null : s.endDate;
    const [row] = await tx.update(registrationSession).set({
      status: 'active', closedAt: null, closedBy: null, closeReason: null, finalizedAt: null, reminderSentAt: null, endDate, updatedAt: now,
      editHistory: sql`COALESCE(${registrationSession.editHistory}, '[]'::jsonb) || ${JSON.stringify([{ editedBy: actorId, editedAt: now.toISOString(), field: 'status', oldValue: '"closed"', newValue: '"active"', reason }])}::jsonb`,
    }).where(eq(registrationSession.id, id)).returning();
    await logAction(actorId, 'SESSION_REOPENED', 'session', id, { status: 'closed', closedAt: s.closedAt, endDate: s.endDate }, { status: 'active', endDate, reason: reason ?? null }, ctx, tx);
    return row!;
  }).catch((err) => {
    if ((err as { cause?: { code?: string } } | null)?.cause?.code === '23505') throw new SessionError('Another session of this type and year is already open: close it first', 409);
    throw err;
  });
}

// ─── Prices final (E6) ───────────────────────────────────────────────────────

/** PRICES_FINAL is one-way once a line exists (§6). */
export const PRICES_FINAL_ONE_WAY = 'Families have reserved in this session: its prices stay final (a price changed later re-prices the unpaid lines and lists the paid ones for finance)';

/** Prices final with waiting lines whose row has no exam fee (PRICE_NOT_SET): their fees are set first. */
export const PRICES_FINAL_UNPRICED_REFUSAL = (rows: string[], lines: number) =>
  `Set the exam fee of ${rows.join(', ')} first: ${lines} unpaid ${lines === 1 ? 'reservation was' : 'reservations were'} priced from a fee that is not confirmed, and could not be paid once the prices are final`;

/**
 * PUT /sessions/:id/prices-final — switched on (refused while a waiting line's row has no exam fee): every waiting line priced while they were not final
 * becomes payable and is re-dated from now (§6); its impact (the lines made payable, the due dates
 * moved) answered first. Switched off: only while no line exists.
 */
export async function setPricesFinal(id: string, data: PricesFinalType, actorId: string, ctx?: AuditContext): Promise<SessionSave> {
  try {
    return await db.transaction(async (tx) => {
      const [s] = await tx.select().from(registrationSession).where(eq(registrationSession.id, id)).for('update');
      if (!s) throw new SessionError('Session not found', 404);
      if (data.final === s.pricesFinal) return { saved: true, impact: NO_IMPACT, dueDatesMoved: 0 };
      const now = new Date();
      if (!data.final) {
        const [line] = await tx.select({ id: registration.id }).from(registration).where(eq(registration.sessionId, id)).limit(1);
        if (line) throw new SessionError(PRICES_FINAL_ONE_WAY, 409);
        await tx.update(registrationSession).set({ pricesFinal: false, pricesFinalAt: null, updatedAt: now }).where(eq(registrationSession.id, id));
        await logAction(actorId, 'SESSION_PRICES_FINAL', 'session', id, { pricesFinal: true }, { pricesFinal: false }, ctx, tx);
        return { saved: true, impact: NO_IMPACT, dueDatesMoved: 0 };
      }
      // A waiting line priced from a fee not confirmed, on a row with no exam fee of its own (a line priced from the
      // fee grid before P1c dropped it, on a row whose grid rows were missing): switching final would leave it unpayable
      // under a session that reads "prices final". Refused, its rows named, until their exam fees are set (L-lead of
      // the P1b review).
      const unpriced = await tx.select({ subject: subject.name, kind: sessionOfferItem.kind, label: sessionOfferItem.label, lines: sql<number>`count(*)::int` })
        .from(registration)
        .innerJoin(sessionOfferItem, eq(sessionOfferItem.id, registration.offerItemId))
        .innerJoin(subject, eq(subject.id, registration.subjectId))
        .where(and(eq(registration.sessionId, id), inArray(registration.status, WAITING), eq(registration.priceProvisional, true), sql`${sessionOfferItem.examFee} is null`))
        .groupBy(subject.name, sessionOfferItem.kind, sessionOfferItem.label, sessionOfferItem.sortOrder)
        .orderBy(asc(subject.name), asc(sessionOfferItem.sortOrder));
      if (unpriced.length) {
        const n = unpriced.reduce((a, u) => a + Number(u.lines), 0);
        throw coded(new SessionError(PRICES_FINAL_UNPRICED_REFUSAL(unpriced.map((u) => (u.kind === 'all_papers' ? u.subject : `${u.subject} — ${u.label}`)), n), 409), 'PRICE_NOT_SET');
      }
      await tx.update(registrationSession).set({ pricesFinal: true, pricesFinalAt: now, updatedAt: now }).where(eq(registrationSession.id, id));
      // The waiting provisional lines (every one has a row priced by its own exam fee, above; whatever the basis'
      // version: a converted line on a converted row too), locked in id order after the session.
      const waiting = await tx.select({ id: registration.id }).from(registration)
        .innerJoin(sessionOfferItem, eq(sessionOfferItem.id, registration.offerItemId))
        .where(and(eq(registration.sessionId, id), inArray(registration.status, WAITING), eq(registration.priceProvisional, true), isNotNull(sessionOfferItem.examFee)))
        .orderBy(registration.id).for('update', { of: registration });
      if (waiting.length) await tx.update(registration).set({ priceProvisional: false, updatedAt: now }).where(inArray(registration.id, waiting.map((w) => w.id)));
      const moved = await redateLines(tx, waiting.map((w) => w.id), actorId, 'the session\'s prices were made final');
      const impact: Impact = { ...NO_IMPACT, linesAffected: waiting.length, dueDatesMoved: moved };
      settleImpact(impact, data.expected);
      await logAction(actorId, 'SESSION_PRICES_FINAL', 'session', id, { pricesFinal: false }, { pricesFinal: true, pricesFinalAt: now.toISOString(), linesMadePayable: waiting.length, dueDatesMoved: moved }, ctx, tx);
      return { saved: true, impact, dueDatesMoved: moved };
    });
  } catch (err) {
    if (err instanceof ImpactPending) return { saved: false, impact: err.impact, dueDatesMoved: 0 };
    throw err;
  }
}

// ─── The check list (§5 "Check before you open") ─────────────────────────────

export type CheckItem = {
  code: 'price_not_set' | 'teacher_tbc' | 'no_teacher' | 'nothing_ticked' | 'not_on_the_list' | 'sitting_no_board_date' | 'date_after_board_deadline'
    | 'payment_date_passed' | 'teacher_name_doubt' | 'last_years_prices' | 'dates_to_check' | 'carried_from_too_old' | 'ticked_by_default' | 'review_note'
    | 'switched_off';
  severity: 'blocks' | 'look';
  message: string;
  offeringId?: string;
  rowId?: string;
  seriesId?: string;
};

const DAY = 24 * 60 * 60 * 1000;
const cairoDay = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' }).format(d);

/**
 * C5: a draft's payment due date and first lesson are still the ones it was made with (the defaults, or a
 * copy's dates a year on) — neither changed nor kept on purpose. Only a draft made by the coordinator's
 * contract (no start date until it opens): one made by the deprecated dated contract was given its dates,
 * and an open session is past its check list.
 */
function datesToCheck(s: Pick<SessionRow, 'editHistory' | 'startDate' | 'status'>): boolean {
  if (s.status !== 'draft' || s.startDate) return false;
  const edited = new Set((s.editHistory ?? []).map((h) => h.field));
  return !edited.has('paymentDueAt') && !edited.has('courseStartsOn') && !edited.has('datesConfirmed');
}

/** What blocks the session from opening, and what deserves a look (§5; C6's board dates; D6; Q15). */
export async function checkListOf(executor: Executor, s: SessionRow): Promise<CheckItem[]> {
  const items: CheckItem[] = [];
  const offerings = await offeringsView(executor, s.id);
  const now = new Date();
  const seen = new Set<string>();
  const cancelDate = new Date(s.paymentDueAt.getTime() + s.unpaidCancelDays * DAY);
  for (const o of offerings) {
    const name = o.subject.name;
    const ticked = o.rows.filter((r) => r.cells.firstInSchool || r.cells.retakeInSchool || r.cells.retakeSelfStudy || r.cells.firstSelfStudy);
    if (!ticked.length) items.push({ code: 'nothing_ticked', severity: 'look', message: `${name}: nothing ticked — not offered to families`, offeringId: o.id });
    // Added while the session takes reservations (it starts switched off), or switched off by her.
    if (!o.accepting) items.push({ code: 'switched_off', severity: 'look', message: `${name}: switched off — not offered to families until you switch it on`, offeringId: o.id });
    if (o.priceNotSet.length) {
      items.push({ code: 'price_not_set', severity: 'look', message: `${name}: ${o.priceNotSet.length === 1 ? 'a price' : `${o.priceNotSet.length} prices`} not set — not offered to families until set`, offeringId: o.id });
    }
    if (o.teacherTbc) items.push({ code: 'teacher_tbc', severity: 'look', message: `${name}: teacher to be confirmed (families read "teacher to be announced")`, offeringId: o.id });
    const inSchool = ticked.some((r) => r.cells.firstInSchool || r.cells.retakeInSchool);
    const taught = o.teachers.length > 0 || ticked.every((r) => !(r.cells.firstInSchool || r.cells.retakeInSchool) || r.teachers.length > 0);
    if (inSchool && !taught && !o.teacherTbc) items.push({ code: 'no_teacher', severity: 'look', message: `${name}: taught in school, but no teacher is named`, offeringId: o.id });
    if (o.notOnTheList) items.push({ code: 'not_on_the_list', severity: 'look', message: `${name}: not on the reference list — flagged for us to add`, offeringId: o.id });
    for (const note of o.checkNotes) items.push({ code: 'review_note', severity: 'look', message: `${name}: ${note}`, offeringId: o.id });
    for (const r of ticked) {
      if (r.cellsByDefault.length) {
        const words: Record<string, string> = { firstInSchool: 'first entry in school', retakeInSchool: 'retake in school', retakeSelfStudy: 'retake in self study', firstSelfStudy: 'first entry in self study' };
        items.push({ code: 'ticked_by_default', severity: 'look', offeringId: o.id, rowId: r.id, message: `${name} — ${r.label}: ${r.cellsByDefault.map((c) => words[c] ?? c).join(', ')} ticked by a default, not her form — confirm` });
      }
      const sr = r.series;
      if (sr && !sr.hasBoardDate && !seen.has(sr.id)) {
        seen.add(sr.id);
        items.push({
          code: 'sitting_no_board_date', severity: 'blocks', seriesId: sr.id,
          message: `${o.board.name} ${sr.month.charAt(0).toUpperCase()}${sr.month.slice(1)} ${sr.year}${sr.label ? ` (${sr.label})` : ''}: no board date yet (its entry deadline) — the admin enters it once`,
        });
      }
      const deadline = sr?.entryDeadline ?? null;
      if (deadline) {
        const late: string[] = [];
        if (s.endDate && s.endDate > deadline) late.push('the session closes');
        if (s.paymentDueAt > deadline && !r.payBy) late.push('payment is due');
        if (cancelDate > deadline && !r.payBy) late.push('unpaid reservations are cancelled');
        if (r.closesAt && r.closesAt > deadline) late.push('the row closes');
        if (r.payBy && r.payBy > deadline) late.push('the row is due');
        if (late.length) {
          items.push({
            code: 'date_after_board_deadline', severity: 'look', offeringId: o.id, rowId: r.id,
            message: `${name} — ${r.label}: ${late.join(', ')} after the board's deadline (${cairoDay(deadline)})`,
          });
        }
      }
      // One she kept on purpose ("Keep it", carried by a copy) is not asked again (P2's L9); the editor still warns.
      for (const p of r.allowedPriorSittings.filter((x) => x.beyondCarryForward && !x.kept)) {
        items.push({
          code: 'carried_from_too_old', severity: 'look', offeringId: o.id, rowId: r.id,
          message: `${name} — ${r.label}: ${p.month.charAt(0).toUpperCase()}${p.month.slice(1)} ${p.year} is older than the board carries a result forward (kept: her list)`,
        });
      }
    }
  }
  if (!s.pricesFinal && s.paymentDueAt <= now) {
    items.push({ code: 'payment_date_passed', severity: 'look', message: `Payment was due ${cairoDay(s.paymentDueAt)} and the prices are not final yet` });
  }
  if (s.copiedFromSessionId && !s.pricesFinal) {
    items.push({ code: 'last_years_prices', severity: 'look', message: 'The prices are last cycle\'s, copied: check them, then switch prices final' });
  }
  if (datesToCheck(s)) {
    // C5: families read these dates; she sets them or says the ones shown are right before the session opens.
    items.push({
      code: 'dates_to_check', severity: 'blocks',
      message: s.copiedFromSessionId
        ? `The dates were moved a year by the copy: check the payment due date (${cairoDay(s.paymentDueAt)}) and the first lesson (${s.courseStartsOn}) — change them, or keep them as they are`
        : `The dates are the defaults: set the payment due date (${cairoDay(s.paymentDueAt)}) and the first lesson (${s.courseStartsOn}) — or keep them as they are`,
    });
  }
  // Q15: the session's teachers whose names look like another teacher's on the school's list.
  const offerIds = offerings.map((o) => o.id);
  if (offerIds.length) {
    const named = await executor.selectDistinct({ id: teacher.id, name: teacher.name }).from(teacher)
      .where(sql`${teacher.id} in (select ${sessionOfferTeacher.teacherId} from ${sessionOfferTeacher} where ${inArray(sessionOfferTeacher.offerId, offerIds)}
        union select ${sessionOfferItemTeacher.teacherId} from ${sessionOfferItemTeacher} join ${sessionOfferItem} on ${sessionOfferItem.id} = ${sessionOfferItemTeacher.itemId}
        where ${inArray(sessionOfferItem.offerId, offerIds)})`);
    const others = await executor.select({ id: teacher.id, name: teacher.name }).from(teacher).where(eq(teacher.isActive, true));
    const told = new Set<string>();
    for (const t of named) {
      for (const o of others) {
        if (o.id === t.id) continue;
        const key = [t.id, o.id].sort().join('|');
        if (told.has(key)) continue;
        const why = sameTeacherReason(t.name, o.name);
        if (!why) continue;
        told.add(key);
        items.push({ code: 'teacher_name_doubt', severity: 'look', message: `"${t.name}" looks like "${o.name}" (${why}): one person or two?` });
      }
    }
  }
  return items;
}

/** The refund policy as families read it (C7: the sentence generated from the rows). */
export function refundSentenceOf(s: Pick<SessionRow, 'refundPolicy'>): string | null {
  const p = s.refundPolicy as RefundPolicy | null;
  return p?.steps?.length ? refundPolicySentence(p) : null;
}

/** GET /sessions/:id's additions: the settings families agree to, the check list, the counts and the subjects. */
export async function sessionSetupView(executor: Executor, s: SessionRow) {
  const [checkList, offerings, questions, counts] = await Promise.all([
    checkListOf(executor, s),
    offeringsView(executor, s.id),
    executor.select().from(sessionQuestion).where(and(eq(sessionQuestion.sessionId, s.id), sql`${sessionQuestion.offeringId} is null`)).orderBy(asc(sessionQuestion.sortOrder)),
    executor.execute(sql`
      select count(*) filter (where r.status in (${sql.join(LIVE.map((x) => sql`${x}`), sql`, `)}))::int as lines,
        count(*) filter (where r.status = 'confirmed')::int as paid,
        count(*) filter (where r.status in ('pending_approval', 'pending_payment'))::int as unpaid,
        count(distinct r.student_id) filter (where r.status in (${sql.join(LIVE.map((x) => sql`${x}`), sql`, `)}))::int as students
      from registration r where r.session_id = ${s.id}`).then((r) => r.rows[0] as { lines: number; paid: number; unpaid: number; students: number }),
  ]);
  const [copiedFrom] = s.copiedFromSessionId
    ? await executor.select({ id: registrationSession.id, name: registrationSession.name }).from(registrationSession).where(eq(registrationSession.id, s.copiedFromSessionId))
    : [];
  return {
    closesAt: s.endDate,
    refundSentence: refundSentenceOf(s),
    copiedFrom: copiedFrom ?? null,
    questions: questions.map(({ id, kind, prompt, choices, required }) => ({ id, kind, prompt, choices, required })),
    checkList,
    blocked: checkList.some((c) => c.severity === 'blocks'),
    counts: { offerings: offerings.length, offeredToFamilies: offerings.filter((o) => o.offeredToFamilies).length, ...counts },
    offerings,
  };
}

