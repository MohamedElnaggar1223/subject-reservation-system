/**
 * What a student can reserve in a session — the family's and the desk's read
 * (`GET /v1/registrations/offers`, RESERVATIONS_REWORK.md §5; docs/features/RESERVATIONS.md §2.9).
 *
 * Per offer: the subject, its board, availability and teachers; per item: what it enters, its
 * series with the deadline a first entry and a qualifying retake would have, the student's known
 * sittings of what it enters, whether the student already holds a live line on it, and the price
 * of each allowed (attempt, mode), provisional or not. Plus the board's sittings of the last two
 * years for a declared retake. Step B's Reserve pages read it; nothing here writes.
 */

import { db, sql } from '@repo/db';
import { sessionSeriesMonths, SERIES_MONTH_LABELS, type SeriesMonth } from '@repo/validations';
import { mayRegisterFor } from './eligibility.services';
import { availabilityConstraints } from './offer.services';
import { priceLine } from './pricing.services';
import { effectiveDeadlineFor } from './deadline.services';

const MONTH_ORDER: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };

export async function offersForStudent(studentId: string, sessionId: string) {
  const [session] = await db.execute(sql`
    select id, name, session_type as "sessionType", series_year as "seriesYear", status, start_date as "startDate", end_date as "endDate",
      payment_due_at as "paymentDueAt", refund_policy as "refundPolicy", course_starts_on as "courseStartsOn"
    from registration_session where id = ${sessionId}`).then((r) => r.rows as {
      id: string; name: string; sessionType: string; seriesYear: number; status: string; startDate: Date; endDate: Date;
      paymentDueAt: Date; refundPolicy: unknown; courseStartsOn: string;
    }[]);
  if (!session) return null;
  const eligibility = await mayRegisterFor(studentId, sessionId);
  const offers = await db.execute(sql`
    select o.id, o.availability, o.grade10_core as "grade10Core", o.course_fee as "courseFee", o.notes,
      s.id as "subjectId", s.name as "subjectName", s.code as "subjectCode", s.council as "boardCode", b.name as "boardName",
      s.qualification_level as "level"
    from session_offer o join subject s on s.id = o.subject_id join exam_board b on b.code = s.council
    where o.session_id = ${sessionId} and o.availability <> 'closed' and s.is_active
    order by o.sort_order, s.name`).then((r) => r.rows as {
      id: string; availability: string; grade10Core: boolean; courseFee: string; notes: string | null; subjectId: string; subjectName: string;
      subjectCode: string; boardCode: string; boardName: string; level: string;
    }[]);
  const offerIds = offers.map((o) => o.id);
  const items = offerIds.length ? await db.execute(sql`
    select i.id, i.offer_id as "offerId", i.label, i.kind, i.enters_kind as "entersKind", i.qualification_id as "qualificationId",
      i.qualification_option_id as "optionId", i.board_series_id as "seriesId", i.availability, i.exclusive_group as "exclusiveGroup",
      i.required_in_series as "requiredInSeries", i.needs_prior_series as "needsPriorSeries", i.sort_order as "sortOrder",
      bs.month, bs.year, bs.label as "seriesLabel", bs.entry_deadline as "entryDeadline", bs.retake_deadline as "retakeDeadline", bs.exams_start as "examsStart",
      coalesce((select array_agg(u.unit_id order by u.unit_id) from session_offer_item_unit u where u.item_id = i.id), '{}') as units,
      coalesce((select json_agg(json_build_object('code', eu.code, 'shortCode', eu.short_code, 'level', eu.unit_level) order by eu.code)
        from session_offer_item_unit u join exam_unit eu on eu.id = u.unit_id where u.item_id = i.id), '[]') as "unitCodes"
    from session_offer_item i left join board_series bs on bs.id = i.board_series_id
    where i.offer_id in (${sql.join(offerIds.map((id) => sql`${id}`), sql`, `)}) and i.availability <> 'closed'
    order by i.sort_order, i.label`).then((r) => r.rows as Record<string, unknown>[]) : [];
  const teachers = offerIds.length ? await db.execute(sql`
    select ot.offer_id as "offerId", null as "itemId", t.id, t.name, t.kind, ot.mode, ot.sort_order as "sortOrder" from session_offer_teacher ot join teacher t on t.id = ot.teacher_id
    where ot.offer_id in (${sql.join(offerIds.map((id) => sql`${id}`), sql`, `)}) and t.is_active
    union all
    select null, it.item_id, t.id, t.name, t.kind, it.mode, it.sort_order from session_offer_item_teacher it join teacher t on t.id = it.teacher_id
    join session_offer_item i on i.id = it.item_id
    where i.offer_id in (${sql.join(offerIds.map((id) => sql`${id}`), sql`, `)}) and t.is_active`).then((r) => r.rows as { offerId: string | null; itemId: string | null; id: string; name: string; kind: string; mode: string; sortOrder: number }[]) : [];
  // The student's lines, every session: what they hold here and what they sat before.
  const history = await db.execute(sql`
    select r.id, r.session_id as "sessionId", r.offer_item_id as "itemId", r.status, r.board_series_id as "seriesId", r.subject_id as "subjectId",
      i.enters_kind as "entersKind", i.qualification_id as "qualificationId", rs.name as "sessionName",
      coalesce((select array_agg(u.unit_id) from session_offer_item_unit u where u.item_id = i.id), '{}') as units,
      bs.month, bs.year, b.name as "boardName"
    from registration r join session_offer_item i on i.id = r.offer_item_id join registration_session rs on rs.id = r.session_id
    left join board_series bs on bs.id = r.board_series_id left join exam_board b on b.code = bs.board_code
    where r.student_id = ${studentId}`).then((r) => r.rows as {
      id: string; sessionId: string; itemId: string; status: string; seriesId: string | null; subjectId: string; entersKind: string;
      qualificationId: string | null; sessionName: string; units: string[]; month: string | null; year: number | null; boardName: string | null;
    }[]);
  const keysOf = (x: { entersKind: string; qualificationId: string | null; subjectId: string; units: string[] }) =>
    x.entersKind === 'award' || x.entersKind === 'option'
      ? (x.qualificationId ? [`q:${x.qualificationId}`] : [`s:${x.subjectId}`])
      : x.entersKind === 'units' ? x.units.map((u) => `u:${u}`) : [`s:${x.subjectId}`];
  const now = new Date();
  const outOffers = [];
  for (const o of offers) {
    const its = [];
    for (const i of items.filter((x) => x.offerId === o.id)) {
      const c = availabilityConstraints(o.availability, i.availability as string);
      const seriesId = i.seriesId as string | null;
      const keys = keysOf({ entersKind: i.entersKind as string, qualificationId: i.qualificationId as string | null, subjectId: o.subjectId, units: i.units as string[] });
      const known = history
        .filter((h) => h.sessionId !== sessionId && ['confirmed', 'dropped'].includes(h.status) && h.seriesId)
        .filter((h) => keysOf(h).some((k) => keys.includes(k)) || h.subjectId === o.subjectId)
        .map((h) => ({ registrationId: h.id, sessionName: h.sessionName, seriesId: h.seriesId!, series: `${h.boardName} ${SERIES_MONTH_LABELS[h.month as SeriesMonth] ?? h.month} ${h.year}`, status: h.status }));
      const held = history.find((h) => h.itemId === i.id && h.sessionId === sessionId && !['rejected', 'expired', 'dropped'].includes(h.status));
      const combos: { attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study' }[] = [];
      if (!c.closed) {
        if (!c.retakeOnly && !c.selfStudyOnly) combos.push({ attempt: 'first', mode: 'in_school' });
        if (!c.retakeOnly && c.selfStudyOnly) combos.push({ attempt: 'first', mode: 'self_study' });
        if (!c.selfStudyOnly) combos.push({ attempt: 'retake', mode: 'in_school' });
        combos.push({ attempt: 'retake', mode: 'self_study' });
      }
      const prices = [];
      for (const k of combos) {
        try {
          const p = await priceLine(db, { item: { id: i.id as string }, attempt: k.attempt, mode: k.mode, studentId, sessionId });
          prices.push({ ...k, total: p.total, courseFee: p.courseFee, registrationFee: p.registrationFee, provisional: p.provisional, noFee: false });
        } catch {
          prices.push({ ...k, total: null, courseFee: null, registrationFee: null, provisional: false, noFee: true });
        }
      }
      const firstDeadline = seriesId ? await effectiveDeadlineFor(db, { boardSeriesId: seriesId, attempt: 'first', priorSittingSeriesId: null }) : { at: null, kind: null };
      const ownTeachers = teachers.filter((t) => t.itemId === i.id);
      its.push({
        id: i.id as string,
        label: i.label as string,
        kind: i.kind as string,
        enters: { kind: i.entersKind as string, units: i.unitCodes as { code: string; shortCode: string | null; level: string }[] },
        series: seriesId ? {
          id: seriesId, month: i.month as string, year: i.year as number, label: i.seriesLabel as string,
          entryDeadline: i.entryDeadline as Date | null, retakeDeadline: i.retakeDeadline as Date | null, examsStart: i.examsStart as string | null,
        } : null,
        // A first entry's cut-off; a retake of the board's previous sitting runs to the retake deadline where set.
        firstEntryDeadline: firstDeadline.at,
        open: !!firstDeadline.at && firstDeadline.at > now || (!!i.retakeDeadline && new Date(i.retakeDeadline as string) > now),
        availability: i.availability as string,
        constraints: c,
        exclusiveGroup: i.exclusiveGroup as string | null,
        requiredInSeries: i.requiredInSeries as boolean,
        needsPriorSeries: i.needsPriorSeries as boolean,
        teachers: (ownTeachers.length ? ownTeachers : teachers.filter((t) => t.offerId === o.id)).sort((a, b) => a.sortOrder - b.sortOrder).map(({ id, name, kind, mode }) => ({ id, name, kind, mode })),
        knownSittings: known,
        held: held ? { registrationId: held.id, status: held.status } : null,
        prices,
      });
    }
    outOffers.push({
      id: o.id, availability: o.availability, grade10Core: o.grade10Core, notes: o.notes,
      subject: { id: o.subjectId, name: o.subjectName, code: o.subjectCode, boardCode: o.boardCode, boardName: o.boardName, level: o.level },
      items: its,
    });
  }
  // The boards' sittings of the last two years, for a declared retake (step B creates a series
  // row with no dates when the family names one not on record).
  const boards = [...new Set(offers.map((o) => o.boardCode))];
  const boardRows = boards.length ? await db.execute(sql`select code, name, series_months from exam_board where code in (${sql.join(boards.map((b) => sql`${b}`), sql`, `)})`)
    .then((r) => r.rows as { code: string; name: string; series_months: string[] }[]) : [];
  const first = sessionSeriesMonths(session.sessionType, session.seriesYear)[0]!;
  const here = first.year * 12 + MONTH_ORDER[first.month]!;
  const onRecord = boards.length ? await db.execute(sql`select id, board_code, month, year from board_series where label = '' and board_code in (${sql.join(boards.map((b) => sql`${b}`), sql`, `)})`)
    .then((r) => r.rows as { id: string; board_code: string; month: string; year: number }[]) : [];
  const declarable = boardRows.flatMap((b) => {
    const out: { boardCode: string; boardName: string; month: string; year: number; seriesId: string | null }[] = [];
    for (let y = first.year - 2; y <= first.year; y++) {
      for (const m of b.series_months) {
        const at = y * 12 + (MONTH_ORDER[m] ?? 0);
        if (at >= here || here - at > 24) continue;
        out.push({ boardCode: b.code, boardName: b.name, month: m, year: y, seriesId: onRecord.find((s) => s.board_code === b.code && s.month === m && s.year === y)?.id ?? null });
      }
    }
    return out.sort((x, y) => (y.year * 12 + MONTH_ORDER[y.month]!) - (x.year * 12 + MONTH_ORDER[x.month]!));
  });
  return { session, eligibility, offers: outOffers, declarableSittings: declarable };
}
