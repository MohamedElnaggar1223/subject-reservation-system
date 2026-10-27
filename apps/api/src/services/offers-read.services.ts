/**
 * What a student can reserve in a session — the family's and the desk's read (`GET /v1/registrations/offers`,
 * COORDINATOR_REWORK.md F1–F3, Appendix A), and the coordinator's live preview of it (`GET /sessions/:id/preview`).
 *
 * The family payload: the session's terms, the student's eligibility for new reservations, and one entry per subject
 * the session offers families, each row's options from its ticked cells with the price beside each (see
 * familyOfferings). The version-1 read it stood beside — per offer its availability and items, per item its series
 * and deadlines, the boards' declarable sittings — and staff's v1 preview of the family's form
 * (`GET /registrations/offers/preview`, F6a) left with P1c. Nothing here writes.
 */

import { db, registrationSession, sessionQuestion, boardSeries, examBoard, subject, and, eq, isNull, inArray, asc } from '@repo/db';
import { sessionSeriesMonths, IGCSE_NEVER_MONTHS, IAL_UNIT_MONTHS, type SeriesMonth } from '@repo/validations';
import { mayRegisterFor } from './eligibility.services';
import { priceLine, PricingError } from './pricing.services';
import { effectiveDeadlineFor } from './deadline.services';
import { studentRecordOf, knownSittingOf } from './known-sittings.services';
import { getSetting } from './settings.services';
import { lineExceptions, coversScope } from './line-exceptions';
import { offeringsView } from './setup/offering.services';
import { refundSentenceOf } from './setup/session-setup.services';
import { optionLabel, rowLabel, sittingLabel, labelRowOf, both } from './setup/labels';

const MONTH_ORDER: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };

/**
 * What a student can reserve in a session — the family's and the desk's read (`GET /registrations/offers`): the
 * session's terms, the student's eligibility for new reservations, and the family payload (`offerings → rows →
 * options`, below). Its version-1 part (`offers`, `availability`, `grade10Core`, `declarableSittings`) left with P1c:
 * no screen read it after the exceptions grant form moved to the offerings.
 */
export async function offersForStudent(studentId: string, sessionId: string) {
  const read = await familyOfferings(sessionId, { studentId });
  if (!read) return null;
  return { session: read.session, eligibility: await mayRegisterFor(studentId, sessionId), offerings: read.offerings };
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
    // C8: the school-wide declaration (the admin's setting), snapshotted on each consent.
    refundSentence: refundSentenceOf(s), declaration: await getSetting('reservation.declarationText'), selfStudyShare: s.selfStudyPercent,
    questions: sessionQs.map(({ id, kind, prompt, choices, required }) => ({ id, kind, prompt, choices, required })),
  };
  // C4: a draft is invisible to families.
  if (!preview && s.status === 'draft') return { session, offerings: [] };
  const all = await offeringsView(db, sessionId, preview && viewer.offeringId ? [viewer.offeringId] : undefined);
  const now = new Date();
  // F2: what the student is known to have sat — the one rule the line rules refuse by (known-sittings.services).
  const record = studentId ? await studentRecordOf(db, studentId, sessionId) : null;
  const priorIds = [...new Set(all.flatMap((o) => o.rows.flatMap((r) => r.allowedPriorSittings.map((p) => p.id))))];
  const priors = new Map((priorIds.length ? await db.select().from(boardSeries).where(inArray(boardSeries.id, priorIds)) : []).map((p) => [p.id, p]));
  const order = (m: string, y: number) => y * 12 + (MONTH_ORDER[m] ?? 0);
  // A retake on a row that carries nothing forward still names the exam it follows (the line rules keep "a retake
  // names the sitting it follows", RETAKE_SITTING_REQUIRED): a student with none on record picks one of the board's
  // exams of the two years before the row's (what a family may declare, resolveReservationLines), sent by its id
  // when on record, else by its month and year. An O.L. subject never sat October or January (IGCSE_NEVER_MONTHS); a
  // Pearson A.S./A.L. subject (IAL) sits October, January and June, never November (IAL_UNIT_MONTHS).
  const boardCodes = [...new Set(all.map((o) => o.board.code))];
  const boardMonths = new Map((boardCodes.length
    ? await db.select({ code: examBoard.code, months: examBoard.seriesMonths }).from(examBoard).where(inArray(examBoard.code, boardCodes)) : [])
    .map((b) => [b.code, b.months]));
  const declarable = boardCodes.length
    ? await db.select({ id: boardSeries.id, boardCode: boardSeries.boardCode, month: boardSeries.month, year: boardSeries.year })
      .from(boardSeries).where(and(inArray(boardSeries.boardCode, boardCodes), eq(boardSeries.label, ''))) : [];
  const sessionFirst = sessionSeriesMonths(s.sessionType, s.seriesYear)[0]!;
  const retakeFromOf = (boardCode: string, group: string, here: { month: string; year: number } | null) => {
    const at = here ?? sessionFirst;
    const until = order(at.month, at.year);
    const out: { id: string | null; month: SeriesMonth; year: number; label: { en: string; ar: string } }[] = [];
    for (let y = at.year - 2; y <= at.year; y++) {
      for (const m of boardMonths.get(boardCode) ?? []) {
        if (boardCode === 'pearson_edexcel' && group !== 'O.L.' && !(IAL_UNIT_MONTHS as readonly string[]).includes(m)) continue;
        const when = order(m, y);
        if (when >= until || until - when > 24) continue;
        if (group === 'O.L.' && (IGCSE_NEVER_MONTHS as readonly string[]).includes(m)) continue;
        out.push({ id: declarable.find((d) => d.boardCode === boardCode && d.month === m && d.year === y)?.id ?? null, month: m as SeriesMonth, year: y, label: sittingLabel(m, y) });
      }
    }
    return out.sort((a, b) => order(b.month, b.year) - order(a.month, a.year));
  };
  // Decision 1's exception (gate.selfStudyFirstEntry, the line rules' only way to a first entry in self study the row
  // does not tick): the student's, read once (without locking: a GET marks nothing used; the reservation asks again).
  const firstEntryGates = studentId ? await lineExceptions.held(db, studentId, ['gate.selfStudyFirstEntry']) : [];
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
      // A student holding decision 1's exception for the row is offered the first entry in self study it does not tick
      // (a one-paper row is a retake only): what the version-1 read offered, kept when P1c removed it (08p).
      const excepted = !!studentId && r.kind !== 'paper' && !r.cells.firstSelfStudy && firstEntryGates.some((e) => coversScope(e, {
        sessionId, subjectId: o.subject.id, offerId: o.id, offerItemId: r.id, ...(r.series?.id ? { boardSeriesId: r.series.id } : {}),
      }));
      const cellsOffered: (keyof typeof r.cells)[] = !excepted ? ticked
        : ticked.includes('firstInSchool') ? ['firstInSchool', 'firstSelfStudy', ...ticked.filter((k) => k !== 'firstInSchool')] : ['firstSelfStudy', ...ticked];
      // F2: the latest sitting on record of the subject before this row's, by the row's codes where both name them.
      const known = record
        ? knownSittingOf(record, { subjectId: o.subject.id, subjectQualificationId: subj?.qualificationId ?? null, referenceCodes: r.referenceCodes, month: r.series?.month ?? null, year: r.series?.year ?? null })
        : viewer && 'preview' in viewer && viewer.preview === 'retaker'
          ? (() => { const p = r.allowedPriorSittings[0]; return p ? { id: p.id, month: p.month, year: p.year } : { id: null, month: 'june', year: (r.series?.year ?? s.seriesYear) - 1 }; })()
          : null;
      const allowedSittings = r.allowedPriorSittings.map((p) => priors.get(p.id)).filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ id: p.id, label: sittingLabel(p.month, p.year) }));
      const rowTeachers = (r.teachers.length ? r.teachers : o.teachers).map((t) => ({ id: t.teacherId, name: t.name, online: t.online }));
      const options = [];
      // Options past their board deadline (C6: nothing lifts it): a row whose every option is past reads closed, so a
      // family cannot keep picking it and keep being refused (BOARD_DEADLINE_PASSED).
      let pastBoard = 0;
      for (const cell of cellsOffered) {
        const attempt = cell === 'firstInSchool' || cell === 'firstSelfStudy' ? 'first' as const : 'retake' as const;
        const mode = cell === 'firstInSchool' || cell === 'retakeInSchool' ? 'in_school' as const : 'self_study' as const;
        // F2: a student known to have sat it sees the retake options only (a row that carries an earlier exam
        // forward, the A.2., is its own entry: the line rules take its first entry too).
        if (known && attempt === 'first' && !r.needsCarriedFrom) continue;
        let price: { total: number; examFee: number; courseFee: number } | null = null;
        try {
          const p = studentId
            ? await priceLine(db, { item: { id: r.id }, attempt, mode, studentId, sessionId })
            : await priceLine(db, { item: { id: r.id }, attempt, mode, studentId: '', sessionId }, { exceptionIds: [] });
          price = { total: p.total, examFee: p.registrationFee, courseFee: p.courseFee };
        } catch (err) {
          // A price not set reads as "no price yet"; any other failure is a failure, not a missing price.
          if (!(err instanceof PricingError)) throw err;
          price = null;
        }
        if (r.series?.id) {
          const d = await effectiveDeadlineFor(db, { boardSeriesId: r.series.id, attempt, priorSittingSeriesId: null, declarationRejected: false });
          if (d.at && d.at <= now) pastBoard++;
        }
        // D6 with an emptied list: the coordinator saved no earlier exam to carry from, and the line rules then take any
        // earlier exam of the board (line-rules.services, "row with no list"): the family picks among the board's.
        const carriesFromAny = r.needsCarriedFrom && (attempt === 'retake' || r.kind === 'a2') && !allowedSittings.length;
        options.push({
          attempt, mode,
          label: both((lang) => optionLabel(labelRowOf({ kind: r.kind, label: r.label, short: r.short, referenceCodes: r.referenceCodes, fromReference: r.fromReference }), { attempt, mode }, { selfStudyShare: r.selfStudyFee !== null ? null : s.selfStudyPercent, lang })),
          price,
          // D6: an A.2. and a one-paper retake (where the board asks) name the sitting they carry from.
          needsCarriedFrom: r.needsCarriedFrom && (attempt === 'retake' || r.kind === 'a2'),
          allowedSittings: r.needsCarriedFrom ? allowedSittings : [],
          // A retake of a row that carries nothing forward: the exams it may follow, latest first (none filled in).
          // An emptied carried-from list: the board's earlier exams, the same window.
          retakeFrom: (attempt === 'retake' && !r.needsCarriedFrom) || carriesFromAny ? retakeFromOf(o.board.code, o.group, r.series) : [],
          teachers: mode === 'in_school' && !o.teacherTbc ? rowTeachers : [],
        });
      }
      if (!options.length) continue;
      rows.push({
        id: r.id, label: both((lang) => rowLabel(labelRowOf({ kind: r.kind, label: r.label, short: r.short, referenceCodes: r.referenceCodes, fromReference: r.fromReference }), lang)), kind: r.kind, sitting: r.sitting,
        closed: closedOffering || !!(r.closesAt && r.closesAt <= now) || pastBoard === options.length, payBy: r.payBy, exclusiveGroup: r.exclusiveGroup,
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
