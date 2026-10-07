/**
 * Grade 10 registered by the school (RESERVATIONS_REWORK.md §4.2 Grade 10 tab; A-15, Q-10's
 * default): no form has a grade-10 class, so the school enters each grade-10 student's core
 * offers for June itself. "Register grade 10" previews every grade-10 student's lines (each
 * core offer's whole item, in school, the offer's teacher when it has only one, else none) and
 * commits them once: lines pending payment, consent on the `school` channel (the family's own
 * pair comes at checkout, step B). A second commit changes nothing (a line already live is
 * skipped). Each student is committed in a transaction of their own, with their lock first
 * (§6), so one refusal does not stop the rest. The school-fee gate applies as on every path
 * that creates lines; a student it holds is listed with its sentence.
 */

import { db, user, registration, registrationConsent, sessionOffer, sessionOfferTeacher, subject, and, eq, inArray, sql } from '@repo/db';
import { randomUUID } from 'crypto';
import { seriesAcademicYearStart, type LineInputType } from '@repo/validations';
import { mayRegisterFor, assertMayRegisterForInTx } from './eligibility.services';
import { schoolFeeGateReason } from './school-fee.services';
import { resolveItem, availabilityConstraints } from './offer.services';
import { priceLine } from './pricing.services';
import { insertLines } from './line.services';
import { logAction, type AuditContext } from './audit.services';

export class Grade10Error extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

export const SCHOOL_CONSENT_VERSION = 'grade10-school-v1';

type Planned = {
  studentId: string;
  name: string;
  lines: (LineInputType & { subjectName: string; price: number | null; provisional: boolean })[];
  skipped: { subjectName: string; reason: string }[];
  refused: string | null;
};

async function plan(sessionId: string, studentIds?: string[]): Promise<{ session: { id: string; name: string }; students: Planned[] }> {
  const [session] = await db.execute(sql`select id, name, session_type, series_year, status from registration_session where id = ${sessionId}`)
    .then((r) => r.rows as { id: string; name: string; session_type: string; series_year: number; status: string }[]);
  if (!session) throw new Grade10Error('Session not found', 404);
  if (session.session_type !== 'june') throw new Grade10Error('Grade 10 sits June only: register grade 10 in a June session');
  if (session.status === 'closed') throw new Grade10Error('This session is closed');
  const ay = seriesAcademicYearStart(session.session_type, session.series_year);
  const core = await db.select({ offer: sessionOffer, subjectName: subject.name }).from(sessionOffer)
    .innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .where(and(eq(sessionOffer.sessionId, sessionId), eq(sessionOffer.grade10Core, true), sql`${sessionOffer.availability} <> 'closed'`))
    .orderBy(subject.name);
  if (!core.length) throw new Grade10Error('No subject of this session is marked grade-10 core: tick them on the Grade 10 tab first');
  // Grade 10 in the session's academic year: the cohort that starts grade 10 that year.
  const students = await db.select({ id: user.id, name: user.name }).from(user)
    .where(and(eq(user.role, 'student'), eq(user.cohortYear, ay), sql`${user.leftOn} is null`, ...(studentIds?.length ? [inArray(user.id, studentIds)] : [])))
    .orderBy(user.name);
  const out: Planned[] = [];
  for (const s of students) {
    const p: Planned = { studentId: s.id, name: s.name, lines: [], skipped: [], refused: null };
    const eligibility = await mayRegisterFor(s.id, sessionId);
    if (!eligibility.allowed) { p.refused = eligibility.reason; out.push(p); continue; }
    const gate = await schoolFeeGateReason(s.id, eligibility);
    if (gate) { p.refused = gate; out.push(p); continue; }
    const live = await db.select({ subjectId: registration.subjectId }).from(registration)
      .where(and(eq(registration.studentId, s.id), eq(registration.sessionId, sessionId), sql`${registration.status} not in ('rejected', 'expired', 'dropped')`));
    for (const c of core) {
      if (live.some((l) => l.subjectId === c.offer.subjectId)) continue; // already reserved: nothing to do
      try {
        const r = await resolveItem(db, sessionId, c.offer.subjectId);
        const k = availabilityConstraints(c.offer.availability, r.item.availability);
        const mode = k.selfStudyOnly ? 'self_study' as const : 'in_school' as const;
        const teachers = await db.select({ id: sessionOfferTeacher.teacherId }).from(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, c.offer.id));
        let price: number | null = null;
        let provisional = false;
        try {
          const pr = await priceLine(db, { item: { id: r.item.id }, attempt: 'first', mode, studentId: s.id, sessionId });
          price = pr.total;
          provisional = pr.provisional;
        } catch (err) {
          p.skipped.push({ subjectName: c.subjectName, reason: err instanceof Error ? err.message : 'Not priced' });
          continue;
        }
        p.lines.push({
          offerItemId: r.item.id, attempt: 'first', mode, teacherId: mode === 'in_school' && teachers.length === 1 ? teachers[0]!.id : null,
          priorSittingSeriesId: null, priorSittingSource: null, subjectName: c.subjectName, price, provisional,
        });
      } catch (err) {
        p.skipped.push({ subjectName: c.subjectName, reason: err instanceof Error ? err.message : 'Not offered' });
      }
    }
    out.push(p);
  }
  return { session: { id: session.id, name: session.name }, students: out };
}

/** What a commit would create, per student (nothing is written). */
export async function previewGrade10(sessionId: string, studentIds?: string[]) {
  const { session, students } = await plan(sessionId, studentIds);
  return {
    session,
    students,
    totals: {
      students: students.length,
      toRegister: students.filter((s) => !s.refused && s.lines.length).length,
      lines: students.reduce((a, s) => a + (s.refused ? 0 : s.lines.length), 0),
      refused: students.filter((s) => s.refused).length,
      alreadyDone: students.filter((s) => !s.refused && !s.lines.length && !s.skipped.length).length,
    },
  };
}

/** Create the previewed lines, once: per student its own transaction, its consent on the school channel. */
export async function commitGrade10(sessionId: string, studentIds: string[] | undefined, actorId: string, ctx?: AuditContext) {
  const { session, students } = await plan(sessionId, studentIds);
  const made: { studentId: string; registrationIds: string[] }[] = [];
  const failed: { studentId: string; name: string; reason: string }[] = [];
  for (const s of students) {
    if (s.refused || !s.lines.length) continue;
    try {
      const ids = await db.transaction(async (tx) => {
        const eligibility = await assertMayRegisterForInTx(tx, s.studentId, sessionId);
        const now = new Date();
        const inserted = await insertLines(tx, {
          studentId: s.studentId, sessionId, status: 'pending_payment', requestedBy: actorId, approvedBy: actorId, approvedAt: now,
          approvalComments: '[GRADE 10] Registered by the school', eligibility,
          lines: s.lines.map(({ subjectName: _n, price: _p, provisional: _v, ...l }) => l),
        });
        await tx.insert(registrationConsent).values(inserted.flatMap((r) => (['refund_policy', 'declaration'] as const).map((kind) => ({
          id: randomUUID(), registrationId: r.id, kind, textVersion: SCHOOL_CONSENT_VERSION, confirmedBy: actorId, channel: 'school' as const, at: now,
        }))));
        await logAction(actorId, 'GRADE10_BULK_COMMITTED', 'registration', s.studentId, null,
          { sessionId, registrationIds: inserted.map((r) => r.id), lines: inserted.length }, ctx, tx);
        return inserted.map((r) => r.id);
      });
      made.push({ studentId: s.studentId, registrationIds: ids });
    } catch (err) {
      failed.push({ studentId: s.studentId, name: s.name, reason: err instanceof Error ? err.message : 'Failed' });
    }
  }
  return {
    session,
    students: made.length,
    lines: made.reduce((a, m) => a + m.registrationIds.length, 0),
    refused: students.filter((s) => s.refused).map((s) => ({ studentId: s.studentId, name: s.name, reason: s.refused! })),
    failed,
  };
}
