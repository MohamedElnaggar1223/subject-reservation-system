/**
 * Registration sessions (RESERVATIONS_REWORK.md §3.1, §4.1; docs/features/RESERVATIONS.md §1.1).
 *
 * A session is one cycle of the school: its type (June, or winter: November with October and
 * the January after) and year make it, its name is derived, and its offers are its content
 * (offer.services.ts). Its own dates say when families may reserve; what each item can do ends
 * at its series' deadline (§3.3), so a session may stay open past one of them.
 *
 * - Lifecycle: draft → active → closed; one active session per (type, year, label).
 * - A draft's header may change freely; an active session's end (with a reason), course start,
 *   payment due date and — until the first line carries a consent — its refund policy.
 * - Closed sessions are history.
 */

import {
  db, registrationSession, registration, changeRequest, paymentRegistration, payment, user, examBoard, registrationConsent,
  sessionOffer, sessionOfferItem, subject, boardSeries, sessionBoardSeries,
  eq, and, lte, inArray, notInArray, isNull, sql,
} from '@repo/db';
import { capturePreregistrationsForSession } from './prereg.services';
import { notifySessionOpened, createNotification, notifyPaymentReferenceDue } from './notification.services';
import { failPayment, closeStrandedPayments } from './payment.services';
import { logAction, logActions, type AuditContext } from './audit.services';
import { expireWaitingRegistrations } from './expiry.services';
import { lastInstalmentBeingCheckedSql } from './plan.services';
import { expireIneligibleRegistrations } from './eligibility.services';
import { deriveSessionName, seriesLabel, sessionSeriesMonths, type CorrectSessionSeriesType, type CreateSessionType, type UpdateSessionType } from '@repo/validations';
import { env } from '../env';
import { randomUUID } from 'crypto';
import { seriesRuleSentence, windowChangeMisfit, boardSeriesName, openCheckoutsSpanningDeadlines } from './series.services';
import { findOrCreateSeries, defaultSeriesFor, attachSeries, copyOffersFrom } from './offer.services';
import { effectiveDeadlinesOf } from './deadline.services';
import { schoolDate } from './window.services';
import { getSetting } from './settings.services';
import { dueDateFor, redateLines } from './deadline.services';
import { lockStudents, assertStudentsLocked, withStudentsFirst } from '../lib/student-locks';
import { carryFeeRows, repriceMovedLines, tellPriceChanged, type RepricedLine } from './line-moves.services';
import { recheckLines, LineRuleError } from './line-rules.services';
import { PricingError } from './pricing.services';

/**
 * Determine the correct initial status when creating a session.
 * A session whose startDate is now or in the past opens immediately as 'active'.
 */
function resolveInitialStatus(startDate: Date): 'draft' | 'active' {
  return startDate <= new Date() ? 'active' : 'draft';
}

/** A refusal with the status the route answers. */
export class SessionError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

/**
 * Check whether a session exists by ID.
 */
export async function sessionExists(id: string): Promise<boolean> {
  const found = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, id),
    columns: { id: true },
  });
  return !!found;
}

/**
 * Get a single session by ID.
 */
export async function getSessionById(id: string) {
  return db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, id),
  });
}

/**
 * Get all sessions with optional status/type filters.
 *
 * Admin-only operation; returns all statuses by default.
 */
export async function getSessions(filters?: {
  status?: string;
  sessionType?: string;
}) {
  const rows = await db.query.registrationSession.findMany({
    where: (s, { eq, and }) => {
      const conditions = [];
      if (filters?.status) conditions.push(eq(s.status, filters.status));
      if (filters?.sessionType) conditions.push(eq(s.sessionType, filters.sessionType));
      return conditions.length > 0 ? and(...conditions) : undefined;
    },
    // The board series each session's items are entered in, with their deadlines.
    with: { boardSeriesLinks: { columns: { isDefault: true }, with: { boardSeries: { columns: { id: true, boardCode: true, month: true, year: true, label: true, entryDeadline: true, retakeDeadline: true, examsStart: true } } } } },
    orderBy: (s, { desc }) => [desc(s.startDate)],
  });
  const names = new Map((await db.select({ code: examBoard.code, name: examBoard.name }).from(examBoard)).map((b) => [b.code, b.name]));
  const ids = rows.map((r) => r.id);
  // The list's second and third lines (§4.1): subjects and boards; lines, paid, unpaid, outstanding.
  const [offerCounts, lineSums] = ids.length
    ? await Promise.all([
        db.execute(sql`
          select o.session_id as id, count(*)::int as offers, count(distinct s.council)::int as boards
          from session_offer o join subject s on s.id = o.subject_id
          where o.session_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) and o.availability <> 'closed'
          group by o.session_id`).then((r) => r.rows as { id: string; offers: number; boards: number }[]),
        db.execute(sql`
          select r.session_id as id,
            count(*) filter (where r.status not in ('rejected', 'expired', 'dropped'))::int as lines,
            count(*) filter (where r.status = 'confirmed')::int as paid,
            count(*) filter (where r.status in ('pending_approval', 'pending_payment'))::int as unpaid,
            coalesce(sum(r.price_at_registration) filter (where r.status = 'pending_payment'), 0)::numeric as outstanding,
            count(*) filter (where r.status = 'pending_payment' and r.due_at < now())::int as overdue
          from registration r
          where r.session_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
          group by r.session_id`).then((r) => r.rows as { id: string; lines: number; paid: number; unpaid: number; outstanding: string; overdue: number }[]),
      ])
    : [[], []];
  const now = new Date();
  return rows.map(({ boardSeriesLinks, ...s }) => {
    const o = offerCounts.find((x) => x.id === s.id);
    const l = lineSums.find((x) => x.id === s.id);
    return {
      ...s,
      boardSeries: boardSeriesLinks
        .map((link) => ({
          id: link.boardSeries.id, name: boardSeriesName(names, link.boardSeries), boardCode: link.boardSeries.boardCode,
          boardName: names.get(link.boardSeries.boardCode) ?? link.boardSeries.boardCode, month: link.boardSeries.month,
          year: link.boardSeries.year, label: link.boardSeries.label,
          entryDeadline: link.boardSeries.entryDeadline, retakeDeadline: link.boardSeries.retakeDeadline, examsStart: link.boardSeries.examsStart,
          entryDeadlinePassed: !!link.boardSeries.entryDeadline && link.boardSeries.entryDeadline <= now,
          isDefault: link.isDefault,
        }))
        .sort((a, b) => (a.entryDeadline?.getTime() ?? Infinity) - (b.entryDeadline?.getTime() ?? Infinity) || a.name.localeCompare(b.name)),
      summary: {
        offers: o?.offers ?? 0,
        boards: o?.boards ?? 0,
        lines: l?.lines ?? 0,
        paid: l?.paid ?? 0,
        unpaid: l?.unpaid ?? 0,
        overdue: l?.overdue ?? 0,
        outstanding: Number(l?.outstanding ?? 0),
      },
    };
  });
}

/**
 * Get all currently active sessions (one per sessionType, max three).
 *
 * Used on student/parent dashboards to show which registration
 * windows are currently open.
 */
export async function getActiveSessions() {
  return db.query.registrationSession.findMany({
    where: (s, { eq }) => eq(s.status, 'active'),
    orderBy: (s, { asc }) => [asc(s.sessionType)],
  });
}

/**
 * Get the active session for a specific session type.
 * Returns null if no active session of that type exists.
 */
export async function getActiveSession(sessionType: string) {
  const found = await db.query.registrationSession.findFirst({
    where: (s, { eq, and }) =>
      and(eq(s.status, 'active'), eq(s.sessionType, sessionType)),
  });
  return found ?? null;
}

/**
 * Check whether an active session of the given type already exists.
 * Used before activating a draft or creating an immediately-active session.
 */
export async function hasActiveSessionOfType(
  sessionType: string,
  seriesYear: number,
  label: string,
  excludeId?: string
): Promise<boolean> {
  const found = await db.query.registrationSession.findFirst({
    where: (s, { eq, and, ne }) => {
      const base = and(
        eq(s.status, 'active'),
        eq(s.sessionType, sessionType),
        eq(s.seriesYear, seriesYear),
        eq(s.label, label),
      );
      return excludeId ? and(base, ne(s.id, excludeId)) : base;
    },
    columns: { id: true },
  });
  return !!found;
}

const sameCycle = (s: { sessionType: string; seriesYear: number; label: string }) =>
  `An active ${deriveSessionName(s.sessionType, s.seriesYear, s.label)} session already exists. Close it before opening another.`;

/**
 * Create a new registration session.
 *
 * Admin-only operation.
 * If startDate is now or in the past the session opens as 'active' immediately,
 * provided no other active session of the same type exists.
 * Otherwise it starts as 'draft' and is opened by the auto-scheduler or
 * by an explicit activate call.
 *
 * Returns the created session.
 * Throws if the immediate-active path would violate the unique-per-type constraint.
 */
/**
 * Create a session (§4.1): six inputs — type, year, reserve from, reserve to, course starts,
 * payment due. The name is derived; the refund policy is the type's setting; with
 * `copyFromSessionId` the offers, teachers, items, availability and course fees come across and
 * the board fees come across provisional. A session whose start has come opens at once (one
 * active session per type, year and label). Created and audited in one transaction.
 */
export async function createSession(data: CreateSessionType, actorId: string, ctx?: AuditContext) {
  const initialStatus = resolveInitialStatus(data.startDate);
  const label = data.label ?? '';
  if (initialStatus === 'active' && (await hasActiveSessionOfType(data.type, data.year, label))) {
    throw new SessionError(sameCycle({ sessionType: data.type, seriesYear: data.year, label }), 409);
  }
  const id = randomUUID();
  const name = deriveSessionName(data.type, data.year, label);
  const refundPolicy = await getSetting(data.type === 'june' ? 'refund.defaultPolicy.june' : 'refund.defaultPolicy.winter');
  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(registrationSession)
        .values({
          id,
          name,
          sessionType: data.type,
          seriesYear: data.year,
          label,
          qualificationLevel: null,
          startDate: data.startDate,
          endDate: data.endDate,
          courseStartsOn: data.courseStartsOn,
          paymentDueAt: data.paymentDueAt,
          refundPolicy,
          status: initialStatus,
          editHistory: [],
        })
        .returning();
      const copied = data.copyFromSessionId ? await copyOffersFrom(tx, row!, data.copyFromSessionId, actorId) : null;
      await logAction(actorId, 'SESSION_CREATED', 'session', id, null, { ...(row as Record<string, unknown>), copied }, ctx, tx);
      return { ...row!, copied };
    });
    if (initialStatus === 'active') {
      const students = await db.query.user.findMany({ where: (u, { eq: eqOp }) => eqOp(u.role, 'student'), columns: { id: true } });
      const parents = await db.query.user.findMany({ where: (u, { eq: eqOp }) => eqOp(u.role, 'parent'), columns: { id: true } });
      notifySessionOpened({
        sessionId: id,
        sessionName: name,
        sessionType: data.type,
        deadline: data.endDate,
        studentIds: students.map((s) => s.id),
        parentIds: parents.map((p) => p.id),
      }).catch((err) => console.error('[notification] session-opened (immediate) failed:', err));
    }
    return created;
  } catch (err) {
    if ((err as { cause?: { code?: string } } | null)?.cause?.code === '23505') {
      throw new SessionError(sameCycle({ sessionType: data.type, seriesYear: data.year, label }), 409);
    }
    const sentence = seriesRuleSentence(err);
    if (sentence) throw new SessionError(sentence, 409);
    throw err;
  }
}

/** Copy an earlier session's offers into this one (an open or draft session). */
export async function copySessionFrom(id: string, fromSessionId: string, actorId: string) {
  try {
    return await db.transaction(async (tx) => {
      const [s] = await tx.select().from(registrationSession).where(eq(registrationSession.id, id)).for('share');
      if (!s) throw new SessionError('Session not found', 404);
      if (s.status === 'closed') throw new SessionError('This session is closed');
      return copyOffersFrom(tx, s, fromSessionId, actorId);
    });
  } catch (err) {
    const sentence = seriesRuleSentence(err);
    if (sentence) throw new SessionError(sentence, 409);
    throw err;
  }
}

/**
 * Change a session's header, audited in the same transaction (SESSION_UPDATED, before and
 * after, with the reason). A draft may change its dates, course start, payment due date and
 * refund policy; an active session its end (in the future, with a reason), course start and
 * payment due date, and its refund policy until the first line carries a consent (§3.1) —
 * after that, only an exception changes one student's. A closed session is history. The type and
 * year change only through "Correct series". A new payment due date moves the due dates of the
 * session's waiting lines (dueDateFor), each audited.
 */
export async function updateSession(id: string, data: UpdateSessionType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(registrationSession).where(eq(registrationSession.id, id)).for('update');
    if (!current) throw new SessionError('Session not found', 404);
    if (current.status === 'closed') throw new SessionError('Cannot update a closed session');
    const next: Partial<typeof registrationSession.$inferInsert> = {};
    if (current.status === 'active') {
      if (data.startDate && data.startDate.getTime() !== current.startDate.getTime()) {
        throw new SessionError('An open session keeps its start date');
      }
      if (data.endDate && data.endDate.getTime() !== current.endDate.getTime()) {
        if (data.endDate <= new Date()) throw new SessionError('New end date must be in the future (close the session to end it now)');
        if (!data.reason || data.reason.trim().length < 5) throw new SessionError('Please provide a reason for the deadline change');
        next.endDate = data.endDate;
        if (data.endDate.getTime() > Date.now() + 24 * 60 * 60 * 1000) next.reminderSentAt = null;
      }
    } else {
      if (data.startDate) next.startDate = data.startDate;
      if (data.endDate) next.endDate = data.endDate;
    }
    if ((next.endDate ?? current.endDate) <= (next.startDate ?? current.startDate)) throw new SessionError('End date must be after start date');
    if (data.courseStartsOn && data.courseStartsOn !== current.courseStartsOn) next.courseStartsOn = data.courseStartsOn;
    if (data.paymentDueAt && data.paymentDueAt.getTime() !== current.paymentDueAt.getTime()) next.paymentDueAt = data.paymentDueAt;
    if (data.refundPolicy && JSON.stringify(data.refundPolicy) !== JSON.stringify(current.refundPolicy)) {
      const [consented] = await tx.select({ id: registrationConsent.id }).from(registrationConsent)
        .innerJoin(registration, eq(registration.id, registrationConsent.registrationId))
        .where(and(eq(registration.sessionId, id), eq(registrationConsent.kind, 'refund_policy'))).limit(1);
      if (consented) throw new SessionError('A family has consented to this session\'s refund policy: it can no longer change (an exception changes one student\'s)', 409);
      next.refundPolicy = data.refundPolicy;
    }
    if (!Object.keys(next).length) throw new SessionError('Nothing to change');
    const history = Object.entries(next)
      .filter(([k]) => k !== 'reminderSentAt')
      .map(([field, v]) => ({
        editedBy: actorId, editedAt: new Date().toISOString(), field,
        oldValue: JSON.stringify((current as Record<string, unknown>)[field] ?? null), newValue: JSON.stringify(v ?? null), reason: data.reason ?? undefined,
      }));
    const [updated] = await tx.update(registrationSession).set({
      ...next,
      editHistory: sql`COALESCE(${registrationSession.editHistory}, '[]'::jsonb) || ${JSON.stringify(history)}::jsonb`,
      updatedAt: new Date(),
    }).where(eq(registrationSession.id, id)).returning();
    // The payment due date moved: the waiting lines' due dates follow.
    let dueMoved = 0;
    if (next.paymentDueAt) {
      const waiting = await tx.select({ id: registration.id }).from(registration)
        .where(and(eq(registration.sessionId, id), inArray(registration.status, ['pending_approval', 'pending_payment', 'preregistered'])))
        .orderBy(registration.id).for('update');
      dueMoved = await redateLines(tx, waiting.map((w) => w.id), actorId, 'the session\'s payment due date changed');
    }
    await logAction(actorId, 'SESSION_UPDATED', 'session', id,
      Object.fromEntries(Object.keys(next).map((k) => [k, (current as Record<string, unknown>)[k] ?? null])),
      { ...next, reason: data.reason ?? null, dueDatesMoved: dueMoved }, ctx, tx);
    return { ...updated!, dueDatesMoved: dueMoved };
  });
}

/**
 * The session's header for its screen (§4.2): the session, the series its items are entered in
 * (deadlines), and whether its refund policy can still change.
 */
export async function getSessionDetail(id: string) {
  const s = await getSessionById(id);
  if (!s) return undefined;
  const names = new Map((await db.select({ code: examBoard.code, name: examBoard.name }).from(examBoard)).map((b) => [b.code, b.name]));
  const links = await db.select({ series: boardSeries }).from(sessionBoardSeries).innerJoin(boardSeries, eq(boardSeries.id, sessionBoardSeries.boardSeriesId))
    .where(eq(sessionBoardSeries.sessionId, id));
  const [consented] = await db.select({ id: registrationConsent.id }).from(registrationConsent)
    .innerJoin(registration, eq(registration.id, registrationConsent.registrationId))
    .where(and(eq(registration.sessionId, id), eq(registrationConsent.kind, 'refund_policy'))).limit(1);
  const [offers] = await db.select({ n: sql<number>`count(*)::int` }).from(sessionOffer).where(eq(sessionOffer.sessionId, id));
  const now = new Date();
  return {
    ...s,
    months: sessionSeriesMonths(s.sessionType, s.seriesYear),
    refundPolicyLocked: !!consented,
    offers: offers?.n ?? 0,
    series: links.map(({ series: b }) => ({
      id: b.id, name: boardSeriesName(names, b), boardCode: b.boardCode, boardName: names.get(b.boardCode) ?? b.boardCode, month: b.month, year: b.year, label: b.label,
      entryDeadline: b.entryDeadline, retakeDeadline: b.retakeDeadline, examsStart: b.examsStart,
      entryDeadlinePassed: !!b.entryDeadline && b.entryDeadline <= now, reservable: !!(b.entryDeadline || b.examsStart),
    })).sort((a, b) => (a.entryDeadline?.getTime() ?? Infinity) - (b.entryDeadline?.getTime() ?? Infinity) || a.name.localeCompare(b.name)),
  };
}


/**
 * Correct a window's exam series (type and year), in any status, with a
 * reason (F0a). The series decides the academic year every registration in
 * the window is judged by, so the waiting registrations students may no
 * longer sit expire in the same transaction (with their audit rows); the
 * caller closes their open checkouts after it commits.
 */
export async function correctSessionSeries(id: string, data: CorrectSessionSeriesType, adminId: string, auditCtx?: AuditContext) {
  try {
    const out = await withStudentsFirst((extra) => db.transaction(async (tx) => {
      // The students with live lines first (§6: every path that puts a line into a series), then the session.
      const students = await tx.selectDistinct({ id: registration.studentId }).from(registration)
        .where(and(eq(registration.sessionId, id), notInArray(registration.status, ['rejected', 'expired', 'dropped'])));
      const locked = await lockStudents(tx, [...students.map((s) => s.id), ...extra]);
      const [sess] = await tx.select().from(registrationSession).where(eq(registrationSession.id, id)).for('update');
      if (!sess) throw new Error('Session not found');
      if (sess.sessionType === data.sessionType && sess.seriesYear === data.seriesYear) {
        throw new Error(`This session is already for the ${deriveSessionName(data.sessionType, data.seriesYear)} series`);
      }
      // Since the reservations rework the session's items carry it into the corrected series: each
      // item goes to the corresponding series of the new type and year (same board, month and
      // label; a June item of a winter correction to its default), with its live lines. Lines that
      // are history pin their series, which then no longer fits: refused, as F0b refused a window
      // whose fed series would not fit.
      const items = await tx.select({ id: sessionOfferItem.id, seriesId: sessionOfferItem.boardSeriesId, offerId: sessionOfferItem.offerId, subjectLevel: subject.qualificationLevel })
        .from(sessionOfferItem).innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId)).innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
        .where(eq(sessionOfferItem.sessionId, id)).orderBy(sessionOfferItem.id).for('update', { of: sessionOfferItem });
      const history = await tx.select({ n: sql<number>`count(*)::int` }).from(registration)
        .where(and(eq(registration.sessionId, id), inArray(registration.status, ['rejected', 'expired', 'dropped']), sql`${registration.boardSeriesId} is not null`));
      const months = sessionSeriesMonths(data.sessionType, data.seriesYear);
      const plan: { itemId: string; to: string | null }[] = [];
      for (const it of items) {
        if (!it.seriesId) { plan.push({ itemId: it.id, to: null }); continue; }
        const [s] = await tx.select().from(boardSeries).where(eq(boardSeries.id, it.seriesId));
        const same = months.find((m) => m.month === s!.month);
        const to = same
          ? (await findOrCreateSeries(tx, s!.boardCode, same.month, same.year, s!.label, adminId)).id
          : await defaultSeriesFor(tx, data, s!.boardCode, it.subjectLevel === 'igcse' ? 'igcse' : it.subjectLevel === 'as_level' ? 'as' : 'a_level', adminId);
        plan.push({ itemId: it.id, to });
      }
      const moving = plan.some((p, i) => p.to !== items[i]!.seriesId);
      if (moving && (history[0]?.n ?? 0) > 0) {
        const misfit = await windowChangeMisfit(tx, id, { sessionType: data.sessionType, seriesYear: data.seriesYear });
        if (misfit) throw new Error(`${misfit} (its lines that are history stay in the series they were in)`);
      }
      const live = await tx.select().from(registration)
        .where(and(eq(registration.sessionId, id), notInArray(registration.status, ['rejected', 'expired', 'dropped'])))
        .orderBy(registration.id).for('update');
      // A line committed while the correction waited for the session: its student was not locked first.
      assertStudentsLocked(locked, live.map((l) => l.studentId));
      const now = new Date();
      const passed = [...(await effectiveDeadlinesOf(tx, live.map((l) => l.id))).values()].find((d) => d.at && d.at <= now);
      if (passed) throw new Error(`A line of this session is past its deadline (${schoolDate(passed.at!)}): its entry is made, and the session's series can no longer be corrected`);
      // Out of the old series (items, then their live lines), the old links gone, the session corrected…
      for (const p of plan) await tx.update(sessionOfferItem).set({ boardSeriesId: null }).where(eq(sessionOfferItem.id, p.itemId));
      for (const l of live) await tx.update(registration).set({ boardSeriesId: null }).where(eq(registration.id, l.id));
      await tx.execute(sql`
        delete from session_board_series l where l.session_id = ${id}
          and not exists (select 1 from registration r where r.session_id = l.session_id and r.board_series_id = l.board_series_id)`);
      const [updated] = await tx
        .update(registrationSession)
        .set({ sessionType: data.sessionType, seriesYear: data.seriesYear, name: deriveSessionName(data.sessionType, data.seriesYear, sess.label), updatedAt: now })
        .where(eq(registrationSession.id, id))
        .returning();
      // …then into the corresponding series.
      for (const p of plan) {
        if (!p.to) continue;
        await attachSeries(tx, id, p.to, adminId);
        await tx.update(sessionOfferItem).set({ boardSeriesId: p.to, updatedAt: now }).where(eq(sessionOfferItem.id, p.itemId));
      }
      for (const l of live) {
        const to = plan.find((p) => p.itemId === l.offerItemId)?.to ?? null;
        await tx.update(registration).set({ boardSeriesId: to, updatedAt: now }).where(eq(registration.id, l.id));
      }
      const spanning = await openCheckoutsSpanningDeadlines(tx, { registrationIds: live.map((l) => l.id) });
      if (spanning > 0) throw new Error(`${spanning} checkout${spanning === 1 ? '' : 's'} still open would pay for two deadlines after the correction — confirm or cancel ${spanning === 1 ? 'it' : 'them'} first`);
      await logAction(adminId, 'SESSION_SERIES_CORRECTED', 'session', id,
        { sessionType: sess.sessionType, seriesYear: sess.seriesYear },
        { sessionType: data.sessionType, seriesYear: data.seriesYear, reason: data.reason, itemsMoved: plan.filter((p) => p.to).length, linesMoved: live.length }, auditCtx, tx);
      await logActions(live.map((l) => ({
        userId: adminId, action: 'LINE_SERIES_MOVED' as const, entityType: 'registration' as const, entityId: l.id,
        previousData: { boardSeriesId: l.boardSeriesId }, newData: { boardSeriesId: plan.find((p) => p.itemId === l.offerItemId)?.to ?? null, reason: data.reason },
      })), tx);
      // What the lines cost in the corrected series: its fee rows (carried provisional from the
      // series they came from where finance has none), each student's lines checked again there.
      let repriced: RepricedLine[] = [];
      try {
        for (const [n, p] of plan.entries()) if (p.to) await carryFeeRows(tx, p.itemId, items[n]!.seriesId, adminId, 'The session\'s series was corrected');
        await recheckLines(tx, live.map((l) => l.id));
        repriced = await repriceMovedLines(tx, live.map((l) => l.id), adminId, 'the session\'s series was corrected');
      } catch (err) {
        if (err instanceof LineRuleError || err instanceof PricingError) throw new SessionError(err.message, 409);
        throw err;
      }
      await redateLines(tx, live.map((l) => l.id), adminId, 'the session\'s series was corrected');
      const expired = await expireIneligibleRegistrations(tx, { sessionIds: [id] }, 'series_corrected');
      return { session: updated!, expired, repriced };
    }));
    await tellPriceChanged(out.repriced, "The session's exam series was corrected, and with it the board fee");
    return { session: out.session, expired: out.expired };
  } catch (err) {
    if ((err as { cause?: { code?: string } } | null)?.cause?.code === '23505') {
      throw new Error(`Another ${deriveSessionName(data.sessionType, data.seriesYear)} session is already open — close it first`);
    }
    const sentence = seriesRuleSentence(err);
    if (sentence) throw new Error(sentence);
    throw err;
  }
}

/**
 * Manually activate a draft session.
 *
 * Admin-only operation. Validates that no other active session of the
 * same type exists before activating.
 *
 * Returns the activated session, or undefined if session not found or not in draft.
 * Throws if a conflicting active session exists.
 */
export async function activateSession(id: string) {
  const session = await getSessionById(id);
  if (!session || session.status !== 'draft') return undefined;
  // Since the rework a session may open after one of its series' deadlines has passed: that
  // series' items are simply closed, and the capture refunds in full (MO-21) a paid
  // preregistration whose line's deadline has passed rather than confirming it (§3.3).
  const conflict = await hasActiveSessionOfType(session.sessionType, session.seriesYear, session.label, id);
  if (conflict) throw new Error(sameCycle(session));

  // The app-level conflict check above handles the common case, but a
  // race between two admins clicking "Activate" on draft sessions of the
  // same sessionType can still slip past it. The partial unique index
  // `one_active_per_session_type_idx` catches the loser at the DB level;
  // we convert the Postgres 23505 error into the same friendly message
  // so the route can map it cleanly to HTTP 409 instead of bubbling a
  // raw "duplicate key value violates unique constraint" 500.
  try {
    const [updated] = await db
      .update(registrationSession)
      .set({ status: 'active', updatedAt: new Date() })
      .where(
        and(
          eq(registrationSession.id, id),
          eq(registrationSession.status, 'draft')
        )
      )
      .returning();

    // V3 §6.8: capture preregistrations on manual activation too
    if (updated) {
      capturePreregistrationsForSession(id).catch((err) =>
        console.error(`[session] Prereg capture failed for ${id}:`, err)
      );
    }

    return updated;
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === '23505'
    ) {
      throw new Error(sameCycle(session));
    }
    throw err;
  }
}

// F0b: the exam board's entry deadline (MO-10) is set on each board series
// (series.services.ts updateBoardSeries), no longer on the window.

/**
 * Finalize all pending records when a session closes.
 *
 * Called from both manual close and auto-close paths.
 * 1. unpaid checkouts ('pending' payments) on this session → failed, escrow
 *    back — except InstaPay checkouts, which get INSTAPAY_REFERENCE_GRACE_HOURS
 *    (never past the board's entry deadline) to submit their reference: the
 *    family may have transferred just before the close (owner decision MO-10)
 * 2. pending_approval and pending_payment registrations → expired, except those
 *    held by a transfer awaiting verification ('pending_verification') or by an
 *    InstaPay checkout still in its grace period: the family may already have
 *    sent that money, so finance confirms or rejects it after the close
 *    (money audit MA-01)
 * 3. pending_approval change requests for registrations in this session → rejected with system comment
 * 4. any 'pending' payment left on an expired registration (a checkout started
 *    while the close ran) → failed, escrow back
 *
 * A grace period that ends with no reference, and the board's entry deadline,
 * are enforced afterwards by enforcePaymentDeadlines (payment.services.ts).
 *
 * Returns counts of affected records.
 */
export async function finalizePendingRecords(sessionId: string): Promise<{
  expiredRegistrations: number;
  rejectedChangeRequests: number;
}> {
  const now = new Date();
  // Only what existed when the window closed. A finalisation that runs late
  // (the recovery sweep, after a failure) must not expire what a student with
  // a deadline extension registered or checked out since the close (review of
  // the state audit, flag 3).
  // "Existed at the close" is judged in the database, against the stored
  // closed_at, by the database's own clock (ST-15). A row's created_at comes
  // from Postgres; compared with a time taken in the API (or read back into
  // JavaScript, which drops the microseconds), a drifting clock put a checkout
  // made just before the close after it, and the close then skipped or failed it.
  const closedAt = sql`coalesce((select ${registrationSession.closedAt} from ${registrationSession} where ${registrationSession.id} = ${sessionId}), now())`;
  const graceEnds = now.getTime() + env.INSTAPAY_REFERENCE_GRACE_HOURS * 60 * 60 * 1000;
  // Never past the checkout's deadline — the earliest effective deadline of the lines it
  // covers (a qualifying retake's is its series' retake deadline; §3.3).
  const referenceDueFor = async (paymentId: string) => {
    const [row] = await db.execute(sql`
      select min(line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id)) as deadline
      from payment_registration pr join registration r on r.id = pr.registration_id
      where pr.payment_id = ${paymentId}`).then((r) => r.rows as { deadline: string | Date | null }[]);
    const deadline = row?.deadline ? new Date(row.deadline).getTime() : Infinity;
    return new Date(Math.min(graceEnds, deadline));
  };

  // 1. Unpaid checkouts first. An InstaPay one keeps its registrations until
  //    referenceDueAt (kept even if it already had a due date from another
  //    session's close). Anything else fails; failPayment moves only 'pending'
  //    payments, so one whose reference arrives in the meantime is left alone,
  //    and step 2 then sees it and keeps its registrations.
  const unpaid = await db
    .selectDistinct({ id: payment.id, method: payment.paymentMethod })
    .from(payment)
    .innerJoin(paymentRegistration, eq(paymentRegistration.paymentId, payment.id))
    .innerJoin(registration, eq(registration.id, paymentRegistration.registrationId))
    .where(and(
      eq(registration.sessionId, sessionId), eq(registration.status, 'pending_payment'), eq(payment.status, 'pending'),
      lte(payment.createdAt, closedAt),
    ));
  const heldForReference: string[] = [];
  // Registrations a failed checkout expired itself (the window is closed), so
  // the per-student notice below still names them.
  const expiredWithPayment: { id: string; studentId: string; subjectId: string; sessionId: string }[] = [];
  for (const p of unpaid) {
    try {
      const referenceDueAt = await referenceDueFor(p.id);
      if (p.method === 'instapay' && referenceDueAt > now) {
        // Kept only while the time it is kept until lies ahead: a due time an
        // earlier close already set (a checkout spanning two sessions) stays,
        // and one that has already passed means it fails here instead of
        // telling the family to submit by a time already gone.
        const [kept] = await db
          .update(payment)
          .set({ referenceDueAt: sql`coalesce(${payment.referenceDueAt}, ${referenceDueAt})`, updatedAt: now })
          .where(and(
            eq(payment.id, p.id),
            eq(payment.status, 'pending'),
            sql`(${payment.referenceDueAt} is null or ${payment.referenceDueAt} > ${now})`,
          ))
          .returning({ id: payment.id });
        if (kept) {
          heldForReference.push(kept.id);
          continue;
        }
      }
      const r = await failPayment(p.id, { from: ['pending'], reason: 'Registration window closed before payment', expireIfClosed: true });
      expiredWithPayment.push(...(r?.expired ?? []));
    } catch (err) {
      console.error(`[session:finalize] Failed to settle payment ${p.id} at close:`, err);
    }
  }

  // 2. Expire pending_approval and pending_payment registrations for this session,
  // except those held by a transfer awaiting verification or by an InstaPay
  // checkout still inside its grace period.
  // Return enough data to notify each affected student individually afterward
  // (SES-004: "Students/parents notified of early closure" and H-16:
  // students whose swap-generated pending_payment expires must know their
  // new subject didn't go through — even though they still have the escrow
  // credit from the original drop).
  // Each expired row and its audit row commit together (SO-1).
  const expiredRegs = await db.transaction((tx) => expireWaitingRegistrations(tx,
    and(
      eq(registration.sessionId, sessionId),
      lte(registration.createdAt, closedAt),
      sql`not exists (
        select 1 from ${paymentRegistration} pr join ${payment} p on p.id = pr.payment_id
        where pr.registration_id = ${registration.id}
          and (p.status = 'pending_verification' or (p.status = 'pending' and p.reference_due_at > ${now}))
      )`,
      // A plan line whose last instalment's transfer is being checked is spared too (§3.6).
      sql`not ${lastInstalmentBeingCheckedSql(registration.id, now)}`,
    ),
    'session_closed', now));

  // 3. Reject all pending_approval change requests for registrations in this session
  // First, get all registration IDs belonging to this session
  const sessionRegs = await db.query.registration.findMany({
    where: (r, { eq: eqOp }) => eqOp(r.sessionId, sessionId),
    columns: { id: true },
  });
  const sessionRegIds = sessionRegs.map((r) => r.id);

  let rejectedCRs: { id: string }[] = [];
  if (sessionRegIds.length > 0) {
    rejectedCRs = await db.transaction(async (tx) => {
      const rows = await tx
        .update(changeRequest)
        .set({
          status: 'rejected',
          comments: '[SYSTEM] Automatically rejected — registration session closed.',
          processedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            inArray(changeRequest.registrationId, sessionRegIds),
            eq(changeRequest.status, 'pending_approval'),
          )
        )
        .returning({ id: changeRequest.id });
      await logActions(rows.map((r) => ({
        userId: null, action: 'CHANGE_REQUEST_REJECTED' as const, entityType: 'change_request' as const, entityId: r.id,
        previousData: { status: 'pending_approval' }, newData: { status: 'rejected', reason: 'session_closed' },
      })), tx);
      return rows;
    });
  }

  // 4. A checkout started while the close ran can still be 'pending' on a
  // now-expired registration; fail it so its escrow comes back.
  const expiredRegIds = expiredRegs.map((r) => r.id);
  if (expiredRegIds.length > 0) {
    const pendingPaymentLinks = await db.query.paymentRegistration.findMany({
      where: (pr, { inArray: inArr }) => inArr(pr.registrationId, expiredRegIds),
      with: {
        payment: { columns: { id: true, status: true } },
      },
    });

    const pendingPaymentIds = [
      ...new Set(pendingPaymentLinks.filter((pl) => pl.payment.status === 'pending').map((pl) => pl.payment.id)),
    ];

    for (const pid of pendingPaymentIds) {
      try {
        const r = await failPayment(pid, { from: ['pending'], reason: 'Registration window closed before payment', expireIfClosed: true });
        expiredWithPayment.push(...(r?.expired ?? []));
      } catch (err) {
        console.error(`[session:finalize] Failed to fail payment ${pid}:`, err);
      }
    }
  }

  // MO-10: a family whose InstaPay checkout survived the close is told how
  // long they have to submit the transfer reference.
  for (const paymentId of heldForReference) {
    await notifyPaymentReferenceDue(paymentId)
      .catch((err) => console.error(`[session:finalize] Reference-due notice for ${paymentId} failed:`, err));
  }

  // SES-004 / H-16: Per-student notification for each expired registration.
  // The existing session-closed blast tells everyone "the window closed";
  // this focused notification tells each affected student exactly WHICH of
  // THEIR registrations didn't go through, so a student who swapped then
  // never paid understands why the new subject is gone (the escrow credit
  // from the original drop remains on their account).
  // This session's only: another session's registration a two-session
  // checkout released is not "pending for" this one.
  const notifyExpired = [...expiredRegs, ...expiredWithPayment.filter((r) => r.sessionId === sessionId)];
  if (notifyExpired.length > 0) {
    try {
      const subjectIds = [...new Set(notifyExpired.map((r) => r.subjectId))];
      const subjects = await db.query.subject.findMany({
        where: (s, { inArray: inArr }) => inArr(s.id, subjectIds),
        columns: { id: true, name: true },
      });
      const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));

      const sessionRow = await db.query.registrationSession.findFirst({
        where: (s, { eq: eqOp }) => eqOp(s.id, sessionId),
        columns: { name: true },
      });
      const sessionName = sessionRow?.name ?? 'the session';

      // Group expired registrations per student so each student gets a
      // single notification rather than one per subject.
      const byStudent = new Map<string, string[]>();
      for (const r of notifyExpired) {
        const name = subjectNameById.get(r.subjectId) ?? 'a subject';
        const arr = byStudent.get(r.studentId) ?? [];
        arr.push(name);
        byStudent.set(r.studentId, arr);
      }

      for (const [studentId, subjectNames] of byStudent) {
        await createNotification(
          studentId,
          'SESSION_CLOSED',
          `Your pending registrations for ${sessionName} were not completed`,
          `The registration window for ${sessionName} has closed. The following pending registration(s) were not completed and have been expired: ${subjectNames.join(', ')}. Any escrow already credited to your account from earlier actions is unaffected.`,
          { sessionId, sessionName, subjectNames, reason: 'session_closed' }
        );
      }
    } catch (err) {
      console.error('[session:finalize] Per-student expiry notifications failed:', err);
    }
  }

  // Finished: the scheduler's recovery sweep leaves this session alone now.
  await db.update(registrationSession).set({ finalizedAt: new Date() }).where(eq(registrationSession.id, sessionId));

  return {
    expiredRegistrations: notifyExpired.length,
    rejectedChangeRequests: rejectedCRs.length,
  };
}

/**
 * Manually close an active session before its endDate.
 *
 * Admin-only operation. Records who closed it and when.
 * Returns the closed session, or undefined if not found or already closed.
 */
export async function closeSession(id: string, adminId: string, reason?: string) {
  const now = new Date();

  const [updated] = await db
    .update(registrationSession)
    .set({
      status: 'closed',
      // Stamped by the database's clock, the clock every created_at uses (ST-15).
      closedAt: sql`now()`,
      closedBy: adminId,
      closeReason: reason ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(registrationSession.id, id),
        eq(registrationSession.status, 'active')
      )
    )
    .returning();

  // Finalize pending records when a session is manually closed. If it fails
  // the session is closed all the same, and the scheduler's recovery sweep
  // finishes it (finalizedAt still empty; state audit ST-06).
  if (updated) {
    try {
      const finalized = await finalizePendingRecords(id);
      if (finalized.expiredRegistrations > 0 || finalized.rejectedChangeRequests > 0) {
        console.log(
          `[session:close] Finalized ${finalized.expiredRegistrations} registration(s) and ${finalized.rejectedChangeRequests} change request(s) for session ${id}.`
        );
      }
    } catch (err) {
      console.error(`[session:close] Finalisation of ${id} failed; the scheduler will finish it:`, err);
    }
  }

  return updated;
}

/**
 * The scheduler's recovery sweep (state audit ST-06), run on every tick and
 * idempotent:
 * - a closed session whose finalisation never completed (it threw, or the
 *   process stopped in between) is finalised now;
 * - an active session still holding preregistrations is captured now — its
 *   capture failed, or a preregistration was made while it opened. Capture
 *   used to run once, for sessions opened on that same tick.
 */
export async function recoverSessionTransitions() {
  let finalized = 0;
  let captured = 0;
  const unfinished = await db
    .select({ id: registrationSession.id })
    .from(registrationSession)
    .where(and(eq(registrationSession.status, 'closed'), isNull(registrationSession.finalizedAt)));
  for (const s of unfinished) {
    try {
      await finalizePendingRecords(s.id);
      finalized++;
    } catch (err) {
      console.error(`[session:recover] Finalisation of ${s.id} failed again:`, err);
    }
  }
  const waiting = await db
    .selectDistinct({ id: registrationSession.id })
    .from(registrationSession)
    .innerJoin(registration, eq(registration.sessionId, registrationSession.id))
    .where(and(eq(registrationSession.status, 'active'), eq(registration.status, 'preregistered')));
  for (const s of waiting) {
    try {
      const r = await capturePreregistrationsForSession(s.id);
      captured += r.captured + r.movedToPendingPayment;
    } catch (err) {
      console.error(`[session:recover] Capture for ${s.id} failed again:`, err);
    }
  }
  // A payment left open on registrations that have all expired (closing it
  // after an expiry failed) can only hold escrow: close it.
  const strandedClosed = await closeStrandedPayments().catch((err) => {
    console.error('[session:recover] Closing stranded payments failed:', err);
    return 0;
  });
  return { finalized, captured, strandedClosed };
}

/**
 * Auto-close all sessions whose endDate has passed.
 *
 * Called by the session-closer job every minute.
 * Also auto-activates draft sessions whose startDate has arrived,
 * as long as no other active session of the same type exists.
 *
 * Returns the number of sessions closed and activated, plus the
 * details of newly-activated sessions so the scheduler can fire
 * NOT-001 (session opened) notifications.
 */
export async function autoManageSessions(): Promise<{
  closed: number;
  closedSessions: { id: string; name: string; sessionType: string }[];
  activated: number;
  activatedSessions: { id: string; name: string; sessionType: string; endDate: Date }[];
}> {
  const now = new Date();

  // Close expired active sessions (no grade moves at a close since F0a: a grade is derived from
  // the cohort and the series' academic year).
  const closedResult = await db
    .update(registrationSession)
    .set({ status: 'closed', closedAt: sql`now()`, updatedAt: now })
    .where(
      and(
        eq(registrationSession.status, 'active'),
        lte(registrationSession.endDate, now)
      )
    )
    .returning({ id: registrationSession.id, name: registrationSession.name, sessionType: registrationSession.sessionType });

  // Activate draft sessions whose startDate has arrived — never one whose reserving has already
  // ended: opening it would close it on the next tick. A session whose series' deadline has passed
  // still opens (the reservations rework, §3.3: the cut-off is per item): capture asks each
  // preregistration its own deadline first, so nothing is captured for an entry the board no
  // longer takes (MO-21: a paid one is refunded in full, an unfunded one expires).
  // One at a time, for the one-active-session rule per (type, year, label).
  const draftsDue = await db.query.registrationSession.findMany({
    where: (s, { eq, lte, gt, and }) =>
      and(eq(s.status, 'draft'), lte(s.startDate, now), gt(s.endDate, now)),
    // name + endDate included so the scheduler can use them for NOT-001 notifications
    columns: { id: true, sessionType: true, seriesYear: true, label: true, name: true, endDate: true },
    orderBy: (s, { asc }) => [asc(s.startDate)],
  });

  let activatedCount = 0;
  const activatedSessions: { id: string; name: string; sessionType: string; endDate: Date }[] = [];

  for (const draft of draftsDue) {
    const conflict = await hasActiveSessionOfType(draft.sessionType, draft.seriesYear, draft.label);
    if (!conflict) {
      // Only a draft still in draft: an admin may have activated (or
      // activated and closed) it since the read. A clash with a session
      // opened meanwhile skips this draft rather than aborting the tick after
      // the closes above have committed (state audit ST-06).
      const [opened] = await db
        .update(registrationSession)
        .set({ status: 'active', updatedAt: now })
        .where(and(eq(registrationSession.id, draft.id), eq(registrationSession.status, 'draft')))
        .returning({ id: registrationSession.id })
        .catch((err) => {
          console.error(`[session] Could not open ${draft.id}:`, err);
          return [];
        });
      if (!opened) continue;
      activatedCount++;
      activatedSessions.push({
        id:          draft.id,
        name:        draft.name,
        sessionType: draft.sessionType,
        endDate:     draft.endDate,
      });
    }
  }

  return {
    closed: closedResult.length,
    closedSessions: closedResult,
    activated: activatedCount,
    activatedSessions,
  };
}
