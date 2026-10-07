/**
 * The teacher on a line (RESERVATIONS_REWORK.md §3.5, the admin's point 10; docs/features/RESERVATIONS_LINES.md §4).
 *
 * The admin, the coordinator and the finance desk (the family asks there) change a line's
 * teacher with a reason, audited: a teacher of the item (or the offer), "no preference" (null)
 * where there are several — the coordinator assigns later — or self-study (no teacher). The
 * price never changes here: a change to self-study on a paid line is not re-priced, a difference
 * is finance's explicit act (a price adjustment or a refund). The enrolment follows (§10): the
 * student's open enrolment in the subject — per unit for an item entering units — takes the new
 * teacher and mode, or is made through F0b's `upsertEnrolments(source: 'registrations')`; the
 * teaching group follows the enrolment when F1 is live. A whole offer's teacher who leaves is
 * A's `POST …/offers/:offerId/replace-teacher`, not this.
 */

import {
  db, registration, courseEnrolment, sessionOfferTeacher, sessionOfferItemTeacher, teacher, user,
  and, eq, isNull, sql, asc,
} from '@repo/db';
import type { ChangeLineTeacherType } from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { upsertEnrolments } from './enrolment.services';

export class LineTeacherError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

const CHANGEABLE = ['pending_approval', 'pending_payment', 'preregistered', 'confirmed'];

export async function changeLineTeacher(registrationId: string, input: ChangeLineTeacherType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [found] = await tx.select({ studentId: registration.studentId }).from(registration).where(eq(registration.id, registrationId));
    if (!found) throw new LineTeacherError('Registration not found', 404);
    // The student first (the enrolment reads it, as a withdrawal holds it), then the line.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, found.studentId)).for('share');
    const [line] = await tx.select().from(registration).where(eq(registration.id, registrationId)).for('update');
    if (!line) throw new LineTeacherError('Registration not found', 404);
    if (!CHANGEABLE.includes(line.status)) throw new LineTeacherError('This line is no longer reserved: its teacher cannot be changed', 409);
    const [facts] = await tx.execute(sql`
      select i.id as "itemId", i.offer_id as "offerId", i.enters_kind as "entersKind", s.name as "subjectName", i.label, i.kind,
        rs.session_type as "sessionType", rs.series_year as "seriesYear",
        coalesce((select array_agg(u.unit_id order by u.unit_id) from session_offer_item_unit u where u.item_id = i.id), '{}') as units
      from session_offer_item i join session_offer o on o.id = i.offer_id join subject s on s.id = o.subject_id
      join registration_session rs on rs.id = i.session_id where i.id = ${line.offerItemId}`).then((r) => r.rows as {
        itemId: string; offerId: string; entersKind: string; subjectName: string; label: string; kind: string; sessionType: string; seriesYear: number; units: string[];
      }[]);
    if (!facts) throw new LineTeacherError('Registration not found', 404);
    const name = facts.kind === 'whole' ? facts.subjectName : `${facts.subjectName} — ${facts.label}`;

    const mode = input.mode ?? (input.teacherId ? 'in_school' : line.mode as 'in_school' | 'self_study');
    if (line.mode === 'self_study' && mode === 'in_school') {
      throw new LineTeacherError(`${name} is reserved as self-study and priced so: to be taught, drop it and reserve it in school`, 409);
    }
    let teacherId: string | null = null;
    if (mode === 'in_school') {
      const own = await tx.select({ id: sessionOfferItemTeacher.teacherId }).from(sessionOfferItemTeacher).where(eq(sessionOfferItemTeacher.itemId, facts.itemId)).orderBy(asc(sessionOfferItemTeacher.sortOrder));
      const pool = own.length ? own.map((t) => t.id)
        : (await tx.select({ id: sessionOfferTeacher.teacherId }).from(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, facts.offerId)).orderBy(asc(sessionOfferTeacher.sortOrder))).map((t) => t.id);
      if (input.teacherId) {
        if (!pool.includes(input.teacherId)) throw new LineTeacherError(`That teacher does not teach ${name} this cycle: choose one of the subject's teachers on the session`);
        const [t] = await tx.select({ isActive: teacher.isActive, name: teacher.name }).from(teacher).where(eq(teacher.id, input.teacherId));
        if (!t?.isActive) throw new LineTeacherError(`${t?.name ?? 'That teacher'} is inactive`);
        teacherId = input.teacherId;
      } else if (pool.length === 1) {
        throw new LineTeacherError(`${name} has one teacher this cycle: "no preference" is for a subject with several`, 409);
      } else if (pool.length === 0) {
        throw new LineTeacherError(`Nobody teaches ${name} this cycle: it can only be self-study`, 409);
      }
    }
    if (teacherId === line.teacherId && mode === line.mode) throw new LineTeacherError('Nothing to change: the line already has this teacher', 409);

    const now = new Date();
    await tx.update(registration).set({ teacherId, mode, takenOutsideSchool: mode === 'self_study', updatedAt: now }).where(eq(registration.id, registrationId));
    await logAction(actorId, 'LINE_TEACHER_CHANGED', 'registration', registrationId, { teacherId: line.teacherId, mode: line.mode },
      { teacherId, mode, reason: input.reason, price: line.priceAtRegistration, repriced: false }, ctx, tx);

    // The enrolment follows (§10): this academic year's open enrolment of the student in what the
    // line enters — one per unit for an item entering units — updated, or made from the line.
    const [year] = await tx.execute(sql`select id from academic_year where start_year = school_series_academic_year_start(${facts.sessionType}, ${facts.seriesYear})`)
      .then((r) => r.rows as { id: string }[]);
    let enrolmentsUpdated = 0;
    let enrolmentsCreated = 0;
    if (year) {
      const units = facts.entersKind === 'units' && facts.units.length ? facts.units : [null];
      for (const unitId of units) {
        const [open] = await tx.select().from(courseEnrolment).where(and(
          eq(courseEnrolment.academicYearId, year.id), eq(courseEnrolment.studentId, line.studentId), isNull(courseEnrolment.endedOn),
          unitId ? eq(courseEnrolment.unitId, unitId) : and(eq(courseEnrolment.subjectId, line.subjectId), isNull(courseEnrolment.unitId)),
        )).for('update');
        if (open) {
          if (open.teacherId === teacherId && open.mode === mode) continue;
          await tx.update(courseEnrolment).set({ teacherId, mode, updatedAt: now }).where(eq(courseEnrolment.id, open.id));
          await logAction(actorId, 'ENROLMENT_UPDATED', 'enrolment', open.id, { mode: open.mode, teacherId: open.teacherId },
            { mode, teacherId, reason: input.reason, registrationId }, ctx, tx);
          enrolmentsUpdated++;
        } else {
          const r = await upsertEnrolments(tx, year.id, [{ studentId: line.studentId, subjectId: line.subjectId, unitId, teacherId, mode, sourceRef: `registration:${registrationId}` }],
            actorId, { source: 'registrations', commit: true, ctx });
          enrolmentsCreated += r.created;
        }
      }
    }
    return { registrationId, teacherId, mode, price: line.priceAtRegistration, repriced: false, enrolmentsUpdated, enrolmentsCreated };
  });
}
