/**
 * What a student can reserve in a session — the family's and the desk's read
 * (`GET /v1/registrations/offers`, RESERVATIONS_REWORK.md §5; docs/features/RESERVATIONS.md §2.9).
 *
 * Per offer: the subject, its board, availability and teachers; per item: what it enters, its
 * series with the deadline a first entry and a qualifying retake would have, the student's known
 * sittings of what it enters, whether the student already holds a live line on it, and the price
 * of each allowed (attempt, mode), provisional or not. Plus the board's sittings of the last two
 * years for a declared retake. Step B's Reserve pages read it; nothing here writes.
 *
 * Staff's preview of the family's form (F6a, `GET /v1/registrations/offers/preview`, admin and
 * coordinator) is the same read with no student: no eligibility, no earlier sittings, no held line,
 * the deadlines of the series alone, and each price without any family's exception (a first entry
 * in school, a retake in school, a retake in self-study at the settings' shares). Nothing in it is a
 * student's.
 *
 * A one-paper item ("One paper ONLY" on the forms) is always a retake: it offers no first entry
 * (the lead's decision of 11 Oct 2026; assertLineRules refuses one too). Nor does a subject the links
 * sheet gives as "Retake (Self Study ONLY)", or a unit or route marked self study only: retakes in
 * self-study only, but for an item that carries an earlier sitting forward (the A.2. carry forward, its
 * own entry after the AS) — the lead's decisions of 16 Oct 2026, FEATURES_PLAN.md §6, 1; a first entry
 * in self-study elsewhere is the student's exception, asked by assertLineRules.
 */

import { db, sql, registrationSession, sessionQuestion, boardSeries, subject, and, eq, isNull, inArray, asc } from '@repo/db';
import { sessionSeriesMonths, SERIES_MONTH_LABELS, DECLARATION_TEXT, type SeriesMonth } from '@repo/validations';
import { mayRegisterFor } from './eligibility.services';
import { availabilityConstraints } from './offer.services';
import { priceLine } from './pricing.services';
import { effectiveDeadlineFor } from './deadline.services';
import { examSittingsOf, examKeysOf } from './reservation.services';
import { lineExceptions, coversScope } from './line-exceptions';
import { offeringsView } from './setup/offering.services';
import { refundSentenceOf } from './setup/session-setup.services';
import { optionLabel, rowLabel, sittingLabel, labelRowOf, both } from './setup/labels';

const MONTH_ORDER: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };

/** What a student can reserve in a session (the family's and the desk's read). */
export async function offersForStudent(studentId: string, sessionId: string) {
  const read = await readOffers(sessionId, studentId);
  if (!read) return null;
  const { preview: _p, ...rest } = read;
  return { ...rest, eligibility: read.eligibility! };
}

/** What a family sees in a session, with no student (staff's preview; F6a). */
export async function offersPreview(sessionId: string) {
  const read = await readOffers(sessionId, null);
  if (!read) return null;
  const { eligibility: _e, ...rest } = read;
  return rest;
}

async function readOffers(sessionId: string, studentId: string | null) {
  const [session] = await db.execute(sql`
    select id, name, session_type as "sessionType", series_year as "seriesYear", status, start_date as "startDate", end_date as "endDate",
      payment_due_at as "paymentDueAt", refund_policy as "refundPolicy", course_starts_on as "courseStartsOn"
    from registration_session where id = ${sessionId}`).then((r) => r.rows as {
      id: string; name: string; sessionType: string; seriesYear: number; status: string; startDate: Date; endDate: Date;
      paymentDueAt: Date; refundPolicy: unknown; courseStartsOn: string;
    }[]);
  if (!session) return null;
  const eligibility = studentId ? await mayRegisterFor(studentId, sessionId) : null;
  const offers = await db.execute(sql`
    select o.id, o.availability, o.grade10_core as "grade10Core", o.course_fee as "courseFee", o.notes,
      s.id as "subjectId", s.name as "subjectName", s.code as "subjectCode", s.council as "boardCode", b.name as "boardName",
      s.qualification_level as "level", s.qualification_id as "subjectQualificationId",
      coalesce((select array_agg(su.unit_id order by su.unit_id) from subject_unit su where su.subject_id = s.id), '{}') as "subjectUnits"
    from session_offer o join subject s on s.id = o.subject_id join exam_board b on b.code = s.council
    where o.session_id = ${sessionId} and o.availability <> 'closed' and s.is_active
    order by o.sort_order, s.name`).then((r) => r.rows as {
      id: string; availability: string; grade10Core: boolean; courseFee: string; notes: string | null; subjectId: string; subjectName: string;
      subjectCode: string; boardCode: string; boardName: string; level: string; subjectQualificationId: string | null; subjectUnits: string[];
    }[]);
  const offerIds = offers.map((o) => o.id);
  const items = offerIds.length ? await db.execute(sql`
    select i.id, i.offer_id as "offerId", i.label, i.kind, i.enters_kind as "entersKind", i.qualification_id as "qualificationId",
      i.qualification_option_id as "optionId", i.board_series_id as "seriesId", i.availability, i.exclusive_group as "exclusiveGroup",
      i.required_in_series as "requiredInSeries", i.needs_prior_series as "needsPriorSeries", i.sort_order as "sortOrder",
      bs.month, bs.year, bs.label as "seriesLabel", bs.entry_deadline as "entryDeadline", bs.retake_deadline as "retakeDeadline", bs.exams_start as "examsStart",
      coalesce((select array_agg(u.unit_id order by u.unit_id) from session_offer_item_unit u where u.item_id = i.id), '{}') as units,
      coalesce((select json_agg(json_build_object('code', eu.code, 'shortCode', eu.short_code, 'level', eu.unit_level) order by eu.code)
        from session_offer_item_unit u join exam_unit eu on eu.id = u.unit_id where u.item_id = i.id), '[]') as "unitCodes",
      q.code as "qualificationCode"
    from session_offer_item i left join board_series bs on bs.id = i.board_series_id left join qualification q on q.id = i.qualification_id
    where i.offer_id in (${sql.join(offerIds.map((id) => sql`${id}`), sql`, `)}) and i.availability <> 'closed'
    order by i.sort_order, i.label`).then((r) => r.rows as Record<string, unknown>[]) : [];
  const teachers = offerIds.length ? await db.execute(sql`
    select ot.offer_id as "offerId", null as "itemId", t.id, t.name, t.kind, ot.mode, ot.sort_order as "sortOrder" from session_offer_teacher ot join teacher t on t.id = ot.teacher_id
    where ot.offer_id in (${sql.join(offerIds.map((id) => sql`${id}`), sql`, `)}) and t.is_active
    union all
    select null, it.item_id, t.id, t.name, t.kind, it.mode, it.sort_order from session_offer_item_teacher it join teacher t on t.id = it.teacher_id
    join session_offer_item i on i.id = it.item_id
    where i.offer_id in (${sql.join(offerIds.map((id) => sql`${id}`), sql`, `)}) and t.is_active`).then((r) => r.rows as { offerId: string | null; itemId: string | null; id: string; name: string; kind: string; mode: string; sortOrder: number }[]) : [];
  // The student's lines, every session: what they hold here and what they sat before (none in a preview).
  const history = !studentId ? [] : await db.execute(sql`
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
  // F4's results and sent entries of this student (step B's known sittings, RESERVATIONS_LINES.md §3.1).
  const exams = studentId ? await examSittingsOf(studentId) : [];
  // The student's exceptions "self-study on a first entry", read once for the whole read and matched to each
  // item below (the decisions' review, low note 2: the check ran a query per item).
  const firstEntryGates = studentId ? await lineExceptions.held(db, studentId, ['gate.selfStudyFirstEntry']) : [];
  const now = new Date();
  const outOffers = [];
  for (const o of offers) {
    const its = [];
    for (const i of items.filter((x) => x.offerId === o.id)) {
      const c = availabilityConstraints(o.availability, i.availability as string);
      const seriesId = i.seriesId as string | null;
      const keys = keysOf({ entersKind: i.entersKind as string, qualificationId: i.qualificationId as string | null, subjectId: o.subjectId, units: i.units as string[] });
      // An earlier sitting the record knows: a confirmed line only. A dropped line was never sat (B's
      // review): the family may still declare it, and the school then verifies it.
      const fromLines = history
        .filter((h) => h.sessionId !== sessionId && h.status === 'confirmed' && h.seriesId)
        .filter((h) => keysOf(h).some((k) => keys.includes(k)) || h.subjectId === o.subjectId)
        .map((h) => ({
          registrationId: h.id as string | null, sessionName: h.sessionName as string | null, seriesId: h.seriesId!,
          series: `${h.boardName} ${SERIES_MONTH_LABELS[h.month as SeriesMonth] ?? h.month} ${h.year}`, status: h.status,
          source: 'line' as 'line' | 'result' | 'entry', month: h.month as string, year: Number(h.year), grade: null as string | null,
        }));
      // A result on record or an entry sent to the board for what the item enters (step B, from F4).
      const examKeys = examKeysOf({ entersKind: i.entersKind as string, qualificationId: i.qualificationId as string | null, units: i.units as string[], subjectQualificationId: o.subjectQualificationId, subjectUnits: o.subjectUnits });
      // Only those before this item's series: F4 holds entries of this series and later ones too.
      const here = i.year ? Number(i.year) * 12 + (MONTH_ORDER[i.month as string] ?? 0) : null;
      const fromExams = exams.filter((e) => examKeys.includes(e.key))
        .filter((e) => here === null || e.year * 12 + (MONTH_ORDER[e.month] ?? 0) < here).map((e) => ({
        registrationId: null as string | null, sessionName: null as string | null, seriesId: e.seriesId, series: e.series, status: e.source as string,
        source: e.source as 'line' | 'result' | 'entry', month: e.month as string, year: e.year, grade: e.grade,
      }));
      // Latest first.
      const known = [...fromLines, ...fromExams]
        .sort((a, b) => (b.year * 12 + (MONTH_ORDER[b.month] ?? 0)) - (a.year * 12 + (MONTH_ORDER[a.month] ?? 0)));
      const held = history.find((h) => h.itemId === i.id && h.sessionId === sessionId && !['rejected', 'expired', 'dropped'].includes(h.status));
      const combos: { attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study' }[] = [];
      // A one-paper item is a retake only (the forms' "One paper ONLY").
      const firstEntries = !c.retakeOnly && i.kind !== 'paper';
      if (!c.closed) {
        if (firstEntries && !c.selfStudyOnly) combos.push({ attempt: 'first', mode: 'in_school' });
        // Self study is a second entry ("Self Study 50% … ONLY 2nd entry", decision 1 of 16 Oct 2026): a first
        // entry in self-study only where the item carries an earlier sitting forward (the A.2. carry forward).
        if (firstEntries && c.selfStudyOnly && i.needsPriorSeries) combos.push({ attempt: 'first', mode: 'self_study' });
        if (!c.selfStudyOnly) combos.push({ attempt: 'retake', mode: 'in_school' });
        combos.push({ attempt: 'retake', mode: 'self_study' });
      }
      // The student's exception "self-study on a first entry" — decision 1's only way past the rule — offers the
      // choice where it covers the item, so a family or the desk can take it from the screen (the review of
      // dd68598, item 2). Read without locking (a GET marks nothing used); the reservation asks it again, under
      // its lock, through assertLineRules. A preview (no student) offers no family's exception.
      if (studentId && !c.closed && firstEntries && !combos.some((k) => k.attempt === 'first' && k.mode === 'self_study')) {
        const scope = { sessionId, subjectId: o.subjectId, offerId: o.id, offerItemId: i.id as string, ...(seriesId ? { boardSeriesId: seriesId } : {}) };
        if (firstEntryGates.some((e) => coversScope(e, scope))) combos.splice(combos.some((k) => k.attempt === 'first') ? 1 : 0, 0, { attempt: 'first', mode: 'self_study' });
      }
      // Open per attempt (the review of 977848d): a first entry until the entry deadline (or the
      // exams' start with none); a retake of the board's previous sitting until the retake deadline
      // where the board gives one. A retake of an older sitting is a first entry's date.
      const firstDeadline = seriesId
        ? await effectiveDeadlineFor(db, { boardSeriesId: seriesId, attempt: 'first', priorSittingSeriesId: null, declarationRejected: false, ...(studentId ? { studentId } : {}) })
        : { at: null, kind: null };
      // The later of the retake deadline and a first entry's (a late board entry, Q-20, can be later).
      const retakeDeadline = i.retakeDeadline ? new Date(i.retakeDeadline as string) : null;
      const retakeUntil = retakeDeadline && (!firstDeadline.at || retakeDeadline > firstDeadline.at) ? retakeDeadline : firstDeadline.at;
      const openFor = { first: !!firstDeadline.at && firstDeadline.at > now, retake: !!retakeUntil && retakeUntil > now };
      const prices = [];
      for (const k of combos) {
        try {
          // A preview prices for no family: no exception applies (exceptionIds: none).
          const p = studentId
            ? await priceLine(db, { item: { id: i.id as string }, attempt: k.attempt, mode: k.mode, studentId, sessionId })
            : await priceLine(db, { item: { id: i.id as string }, attempt: k.attempt, mode: k.mode, studentId: '', sessionId }, { exceptionIds: [] });
          prices.push({ ...k, open: openFor[k.attempt], total: p.total, courseFee: p.courseFee, registrationFee: p.registrationFee, provisional: p.provisional, noFee: false });
        } catch {
          prices.push({ ...k, open: openFor[k.attempt], total: null, courseFee: null, registrationFee: null, provisional: false, noFee: true });
        }
      }
      const ownTeachers = teachers.filter((t) => t.itemId === i.id);
      its.push({
        id: i.id as string,
        label: i.label as string,
        kind: i.kind as string,
        enters: { kind: i.entersKind as string, units: i.unitCodes as { code: string; shortCode: string | null; level: string }[] },
        // The award it enters, by the board's code (Arabic A Level's two: "YAA01", "9AA0"): the family's form names it
        // beside the teacher who teaches it (the lead's decision of 16 Oct 2026, FEATURES_PLAN.md §6, 3).
        qualification: i.qualificationCode ? { code: i.qualificationCode as string } : null,
        series: seriesId ? {
          id: seriesId, month: i.month as string, year: i.year as number, label: i.seriesLabel as string,
          entryDeadline: i.entryDeadline as Date | null, retakeDeadline: i.retakeDeadline as Date | null, examsStart: i.examsStart as string | null,
        } : null,
        // A first entry's cut-off, and a qualifying retake's; whether each is still open.
        firstEntryDeadline: firstDeadline.at,
        retakeDeadline: retakeUntil,
        open: openFor,
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
  // row with no dates when the family names one not on record). A preview lists them too: they are
  // the sitting choices the family's form shows, not the student's.
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
  return { session, eligibility, preview: !studentId, offers: outOffers, declarableSittings: declarable };
}

// ─── Version 2: the family payload (COORDINATOR_REWORK.md F1–F3, Appendix A) ─────────────────────

/**
 * What a family sees for one child in a session (Appendix A's `GET /registrations/offers` payload,
 * served beside today's read until P3 replaces the Reserve page): one entry per subject the session
 * offers families — accepting, every ticked row priced (E6) — with each row's options from its
 * ticked cells, the price beside each, the teachers of an in-school option and the sittings a retake
 * may carry from. No board jargon (F3): a row's sitting is "June", "November" or "January".
 *
 * Records decide what shows (F2): a student the system knows has sat the subject (a confirmed line of
 * it in an earlier session, or F4's result or sent entry) sees the retake options only, with that
 * sitting filled in; every other student sees first entry and retake.
 *
 * The coordinator's live preview (`GET /sessions/:id/preview`) is the same read for a first-timer or
 * a retaker, with no student: a draft is shown, prices carry no family's exception, a retaker's sitting
 * is the row's first allowed one. A draft is invisible to families (C4).
 */
export async function familyOfferings(
  sessionId: string,
  viewer: { studentId: string } | { preview: 'first_timer' | 'retaker'; offeringId?: string },
) {
  const [s] = await db.select().from(registrationSession).where(eq(registrationSession.id, sessionId));
  if (!s) return null;
  const preview = 'preview' in viewer;
  const studentId = preview ? null : viewer.studentId;
  const sessionQs = await db.select().from(sessionQuestion)
    .where(and(eq(sessionQuestion.sessionId, sessionId), isNull(sessionQuestion.offeringId))).orderBy(asc(sessionQuestion.sortOrder));
  const session = {
    id: s.id, name: s.name, status: s.status, closesAt: s.endDate, paymentDueAt: s.paymentDueAt, pricesFinal: s.pricesFinal,
    refundSentence: refundSentenceOf(s), declaration: DECLARATION_TEXT, selfStudyShare: s.selfStudyPercent,
    questions: sessionQs.map(({ id, kind, prompt, choices, required }) => ({ id, kind, prompt, choices, required })),
  };
  // C4: a draft is invisible to families.
  if (!preview && s.status === 'draft') return { session, offerings: [] };
  const all = await offeringsView(db, sessionId, preview && viewer.offeringId ? [viewer.offeringId] : undefined);
  const now = new Date();
  // F2: what the student is known to have sat — confirmed lines of the subject in other sessions, and F4's results and sent entries.
  const history = studentId ? await db.execute(sql`
    select r.subject_id as "subjectId", r.board_series_id as "seriesId", i.reference_codes as codes, bs.month, bs.year,
      s.qualification_id as "subjectQualificationId",
      coalesce((select array_agg(su.unit_id) from subject_unit su where su.subject_id = s.id), '{}') as "subjectUnits"
    from registration r join session_offer_item i on i.id = r.offer_item_id join subject s on s.id = r.subject_id
    left join board_series bs on bs.id = r.board_series_id
    where r.student_id = ${studentId} and r.session_id <> ${sessionId} and r.status = 'confirmed' and r.board_series_id is not null`)
    .then((x) => x.rows as { subjectId: string; seriesId: string; codes: string[]; month: string; year: number; subjectQualificationId: string | null; subjectUnits: string[] }[]) : [];
  const exams = studentId ? await examSittingsOf(studentId) : [];
  const priorIds = [...new Set(all.flatMap((o) => o.rows.flatMap((r) => r.allowedPriorSittings.map((p) => p.id))))];
  const priors = new Map((priorIds.length ? await db.select().from(boardSeries).where(inArray(boardSeries.id, priorIds)) : []).map((p) => [p.id, p]));
  const order = (m: string, y: number) => y * 12 + (MONTH_ORDER[m] ?? 0);
  const offerings = [];
  for (const o of all) {
    if (!preview && !o.offeredToFamilies) continue;
    const closedOffering = !o.accepting || !!(o.closesAt && o.closesAt <= now);
    const offerQs = o.questions;
    const [subj] = await db.select({ qualificationId: subject.qualificationId }).from(subject).where(eq(subject.id, o.subject.id));
    const rows = [];
    for (const r of o.rows) {
      const ticked = (Object.keys(r.cells) as (keyof typeof r.cells)[]).filter((k) => r.cells[k]);
      if (!ticked.length) continue;
      const here = r.series ? order(r.series.month, r.series.year) : Infinity;
      // F2: the latest sitting on record of the subject before this row's, by the row's codes where both name them.
      const known = studentId ? [
        ...history.filter((h) => h.subjectId === o.subject.id && order(h.month, h.year) < here
          && (!h.codes.length || !r.referenceCodes.length || h.codes.some((c) => r.referenceCodes.includes(c))))
          .map((h) => ({ id: h.seriesId, month: h.month, year: h.year })),
        ...exams.filter((e) => subj?.qualificationId && e.key === `q:${subj.qualificationId}` && order(e.month, e.year) < here)
          .map((e) => ({ id: e.seriesId, month: e.month, year: e.year })),
      ].sort((a, b) => order(b.month, b.year) - order(a.month, a.year))[0] ?? null
        : viewer && 'preview' in viewer && viewer.preview === 'retaker'
          ? (() => { const p = r.allowedPriorSittings[0]; return p ? { id: p.id, month: p.month, year: p.year } : { id: null, month: 'june', year: (r.series?.year ?? s.seriesYear) - 1 }; })()
          : null;
      const allowedSittings = r.allowedPriorSittings.map((p) => priors.get(p.id)).filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ id: p.id, label: sittingLabel(p.month, p.year) }));
      const rowTeachers = (r.teachers.length ? r.teachers : o.teachers).map((t) => ({ id: t.teacherId, name: t.name, online: t.online }));
      const options = [];
      for (const cell of ticked) {
        const attempt = cell === 'firstInSchool' || cell === 'firstSelfStudy' ? 'first' as const : 'retake' as const;
        const mode = cell === 'firstInSchool' || cell === 'retakeInSchool' ? 'in_school' as const : 'self_study' as const;
        // F2: a student known to have sat it sees the retake options only.
        if (known && attempt === 'first') continue;
        let price: { total: number; examFee: number; courseFee: number } | null = null;
        try {
          const p = studentId
            ? await priceLine(db, { item: { id: r.id }, attempt, mode, studentId, sessionId })
            : await priceLine(db, { item: { id: r.id }, attempt, mode, studentId: '', sessionId }, { exceptionIds: [] });
          price = { total: p.total, examFee: p.registrationFee, courseFee: p.courseFee };
        } catch {
          price = null;
        }
        options.push({
          attempt, mode,
          label: both((lang) => optionLabel(labelRowOf({ kind: r.kind, label: r.label, short: r.short, referenceCodes: r.referenceCodes, fromReference: r.fromReference }), { attempt, mode }, { selfStudyShare: s.selfStudyPercent, lang })),
          price,
          // D6: an A.2. and a one-paper retake (where the board asks) name the sitting they carry from.
          needsCarriedFrom: r.needsCarriedFrom && (attempt === 'retake' || r.kind === 'a2'),
          allowedSittings: r.needsCarriedFrom ? allowedSittings : [],
          teachers: mode === 'in_school' && !o.teacherTbc ? rowTeachers : [],
        });
      }
      if (!options.length) continue;
      rows.push({
        id: r.id, label: both((lang) => rowLabel(labelRowOf({ kind: r.kind, label: r.label, short: r.short, referenceCodes: r.referenceCodes, fromReference: r.fromReference }), lang)), kind: r.kind, sitting: r.sitting,
        closed: closedOffering || !!(r.closesAt && r.closesAt <= now), payBy: r.payBy, exclusiveGroup: r.exclusiveGroup,
        knownSitting: known ? { id: known.id, label: sittingLabel(known.month, known.year) } : null,
        options,
      });
    }
    if (!rows.length) continue;
    offerings.push({
      id: o.id, name: o.subject.name, board: o.board.name, group: o.group, note: o.note, teacherChoice: o.teacherChoice,
      teacherTbc: o.teacherTbc, accepting: !closedOffering,
      questions: offerQs,
      rows,
    });
  }
  // D10: O.L. subjects, then A.S. / A.L.
  offerings.sort((a, b) => (a.group === b.group ? 0 : a.group === 'O.L.' ? -1 : 1));
  return { session, offerings };
}
