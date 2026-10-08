/**
 * Creating reservation lines (docs/features/RESERVATIONS.md §2.2).
 *
 * `insertLines` is the one way a line is made: inside the caller's transaction, after
 * `assertMayRegisterForInTx` (the student lock), it takes the rework's locks in the one order
 * of RESERVATIONS_REWORK.md §6 (each subject's board, the session's series links, the series,
 * the offers, the items, the fee rows), refuses a line whose series is past its effective
 * deadline or has no dates at all, runs `assertLineRules`, prices each line with `priceLine`,
 * sets its due date, checks its teacher and inserts it; the routing trigger enters it in its
 * item's series. It writes no consent rows: the caller does (step B).
 *
 * Since step B every reservation path (request, direct, desk, override, preregistration, swap)
 * takes `lines` and `consent` and reaches here through reservation.services `reserveLines`, which
 * resolves the sitting a retake follows and writes the consent rows (the bridge
 * `legacyLinesFor`, which built a subject's whole item from `subjectIds`, is gone).
 *
 * `lineItemsFor(registrationIds)` (at the end) is F4's contract of RESERVATIONS_REWORK.md §10:
 * what each line enters, read from its item (added by F4 on resuming, docs/features/EXAM_ENTRIES.md §7).
 */

import {
  db, registration, registrationSession, subject, boardSeries, sessionBoardSeries, sessionOffer, sessionOfferItem,
  sessionOfferTeacher, sessionOfferItemTeacher, sessionOfferItemFeeKey, boardFee, teacher,
  examBoard, examUnit, qualification, qualificationOption, qualificationOptionUnit, qualificationUnit,
  and, eq, or, inArray, sql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  deriveLevelCode, gradeInAcademicYear, seriesAcademicYearStart,
  type Eligibility, type LineInputType, type Attempt, type LineMode, type LevelCodeReading, type UnitLevel,
} from '@repo/validations';
import { boardSeriesName } from './series.services';
import { lockFeeGrids } from '../lib/fee-grid-lock';
import { assertLineRules } from './line-rules.services';
import { priceLine } from './pricing.services';
import { computeDueAt, effectiveDeadlineFor, deadlinePassedSentence } from './deadline.services';
import { lineExceptions } from './line-exceptions';
import { getSetting } from './settings.services';
import { resolveItem, availabilityConstraints, OfferError } from './offer.services';
import { schoolDate } from './window.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class LineError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

export type InsertLinesInput = {
  studentId: string;
  sessionId: string;
  lines: LineInputType[];
  status: 'pending_approval' | 'pending_payment' | 'preregistered';
  requestedBy: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  approvalComments?: string | null;
  /** The path's mayRegisterFor answer (the grade-10 core rule reads it). The school-fee gate stays with the caller. */
  eligibility: Eligibility;
  now?: Date;
};

/**
 * Lock what a line rests on, in the order of §6 (after the student): each subject's board, the
 * session's series links, the series the lines go to, the offers, the items, the fee rows.
 */
async function lockForLines(tx: Tx, sessionId: string, itemIds: string[]) {
  const items = await tx.select({ id: sessionOfferItem.id, offerId: sessionOfferItem.offerId, seriesId: sessionOfferItem.boardSeriesId, subjectId: sessionOffer.subjectId })
    .from(sessionOfferItem).innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId))
    .where(inArray(sessionOfferItem.id, itemIds));
  const subjectIds = [...new Set(items.map((i) => i.subjectId))].sort();
  if (subjectIds.length) await tx.select({ id: subject.id }).from(subject).where(inArray(subject.id, subjectIds)).orderBy(subject.id).for('share');
  await tx.select({ id: sessionBoardSeries.id }).from(sessionBoardSeries).where(eq(sessionBoardSeries.sessionId, sessionId)).orderBy(sessionBoardSeries.id).for('share');
  const seriesIds = [...new Set(items.map((i) => i.seriesId).filter((s): s is string => !!s))].sort();
  if (seriesIds.length) await tx.select({ id: boardSeries.id }).from(boardSeries).where(inArray(boardSeries.id, seriesIds)).orderBy(boardSeries.id).for('share');
  const offerIds = [...new Set(items.map((i) => i.offerId))].sort();
  if (offerIds.length) await tx.select({ id: sessionOffer.id }).from(sessionOffer).where(inArray(sessionOffer.id, offerIds)).orderBy(sessionOffer.id).for('share');
  const held = itemIds.length
    ? await tx.select({ id: sessionOfferItem.id, seriesId: sessionOfferItem.boardSeriesId }).from(sessionOfferItem)
      .where(inArray(sessionOfferItem.id, [...itemIds].sort())).orderBy(sessionOfferItem.id).for('share')
    : [];
  // An item's series read before its lock may have moved while this waited (a series change or a
  // board change commits first): the series it is in now, held too. Only a deadline's writer
  // takes a series FOR UPDATE, and it holds no item, so this later share lock waits on no cycle.
  const moved = [...new Set(held.map((i) => i.seriesId).filter((x): x is string => !!x && !seriesIds.includes(x)))].sort();
  if (moved.length) await tx.select({ id: boardSeries.id }).from(boardSeries).where(inArray(boardSeries.id, moved)).orderBy(boardSeries.id).for('share');
  // The series' fee grids, shared, before the rows (§2.1; lib/fee-grid-lock.ts): a fee write or a
  // Confirm of this series waits for the line, or the line for it.
  await lockFeeGrids(tx, held.map((i) => i.seriesId), 'shared');
  const keys = itemIds.length ? await tx.select().from(sessionOfferItemFeeKey).where(inArray(sessionOfferItemFeeKey.itemId, itemIds)) : [];
  const feeConds = keys.flatMap((k) => {
    const it = held.find((i) => i.id === k.itemId);
    return it?.seriesId ? [and(eq(boardFee.boardSeriesId, it.seriesId), eq(boardFee.keyKind, k.keyKind), eq(boardFee.keyId, k.keyId))] : [];
  });
  if (feeConds.length) await tx.select({ id: boardFee.id }).from(boardFee).where(or(...feeConds)).orderBy(boardFee.id).for('share');
}

/**
 * For a path that holds a line before it makes new ones (a swap drops the old line — its receipt,
 * then the line — and then makes the new one): what making the new lines will lock, taken first,
 * in §2.1's order — the subjects, the session's series links, the series, the offers, the items,
 * the fee grids (shared) and the fee rows, then the student's price exceptions (FOR SHARE, as
 * `priceLine` takes them). A Confirm or a grid save holds its fee rows and then wants the lines
 * priced from them, the old line among them; taken after the old line, the new line's rows closed
 * that cycle (the review of B, on the swap approval). insertLines takes the same locks again,
 * already held. Call after the student lock (`assertMayRegisterForInTx`).
 */
export async function holdNewLines(tx: Tx, a: { studentId: string; sessionId: string; lines: { offerItemId: string; attempt: Attempt; mode: LineMode }[] }) {
  const itemIds = [...new Set(a.lines.map((l) => l.offerItemId))];
  if (!itemIds.length) return;
  await lockForLines(tx, a.sessionId, itemIds);
  for (const l of a.lines) {
    await priceLine(tx, { item: { id: l.offerItemId }, attempt: l.attempt, mode: l.mode, studentId: a.studentId, sessionId: a.sessionId }, { lock: true });
  }
}

/** The teachers who may be named on a line of an item: the item's own, else the offer's. */
async function teachersOf(executor: Executor, itemId: string, offerId: string) {
  const own = await executor.select({ teacherId: sessionOfferItemTeacher.teacherId }).from(sessionOfferItemTeacher).where(eq(sessionOfferItemTeacher.itemId, itemId));
  if (own.length) return own.map((t) => t.teacherId);
  return (await executor.select({ teacherId: sessionOfferTeacher.teacherId }).from(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, offerId))).map((t) => t.teacherId);
}

export async function insertLines(tx: Tx, input: InsertLinesInput) {
  const now = input.now ?? new Date();
  if (!input.lines.length) throw new LineError('Choose at least one item');
  // A prior sitting says where it is known from (B passes it: the student's record, the desk's or the
  // family's declaration); it is never assumed known (the review of 977848d).
  const unsourced = input.lines.find((l) => l.priorSittingSeriesId && !l.priorSittingSource);
  if (unsourced) throw new LineError('Say where the earlier sitting is known from: the record, the desk or the family');
  const itemIds = [...new Set(input.lines.map((l) => l.offerItemId))];
  if (itemIds.length !== input.lines.length) throw new LineError('Each item once');
  await lockForLines(tx, input.sessionId, itemIds);

  const [session] = await tx.select().from(registrationSession).where(eq(registrationSession.id, input.sessionId));
  if (!session) throw new LineError('Session not found', 404);
  const items = await tx.select({ item: sessionOfferItem, offer: sessionOffer, subjectName: subject.name })
    .from(sessionOfferItem).innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId)).innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .where(inArray(sessionOfferItem.id, itemIds));
  const byId = new Map(items.map((i) => [i.item.id, i]));

  // Each line's own cut-off: its series' effective deadline (§3.3). A series with no date at all takes no line.
  const deadlines = new Map<string, Date | null>();
  for (const l of input.lines) {
    const it = byId.get(l.offerItemId);
    if (!it || it.item.sessionId !== input.sessionId) throw new LineError('That item is not on offer in this session', 404);
    if (!it.item.boardSeriesId) throw new LineError(`${it.subjectName} is entered in no board series: it cannot be reserved`);
    // A line being made has no answer to a declaration yet (declarationRejected false).
    const d = await effectiveDeadlineFor(tx, { boardSeriesId: it.item.boardSeriesId, attempt: l.attempt, priorSittingSeriesId: l.priorSittingSeriesId ?? null, declarationRejected: false, studentId: input.studentId });
    if (!d.at) {
      throw new LineError(`${it.subjectName} is entered in a board series with no entry deadline and no exam dates yet: it opens for reservations once they are set`);
    }
    if (d.at <= now) throw new LineError(deadlinePassedSentence(d, schoolDate));
    deadlines.set(l.offerItemId, d.at);
  }

  const { usedExceptionIds } = await assertLineRules(tx, { studentId: input.studentId, sessionId: input.sessionId, eligibility: input.eligibility }, input.lines.map((l) => ({
    offerItemId: l.offerItemId, attempt: l.attempt, mode: l.mode, priorSittingSeriesId: l.priorSittingSeriesId ?? null, priorSittingSource: l.priorSittingSource ?? null,
  })));

  const graceDays = await getSetting('payment.graceDays', tx);
  const records: (typeof registration.$inferInsert)[] = [];
  for (const l of input.lines) {
    const it = byId.get(l.offerItemId)!;
    const price = await priceLine(tx, { item: { id: it.item.id }, attempt: l.attempt, mode: l.mode, studentId: input.studentId, sessionId: input.sessionId }, { lock: true });
    // The teacher: one of the item's (or the offer's); none in self-study; "no preference" allowed.
    let teacherId: string | null = null;
    if (l.mode === 'in_school' && l.teacherId) {
      const allowed = await teachersOf(tx, it.item.id, it.offer.id);
      if (!allowed.includes(l.teacherId)) {
        const [t] = await tx.select({ name: teacher.name }).from(teacher).where(eq(teacher.id, l.teacherId));
        throw new LineError(t ? `The chosen teacher is not linked to ${it.subjectName}` : 'Teacher not found');
      }
      teacherId = l.teacherId;
    }
    const exc = await lineExceptions.active(tx, input.studentId, ['deadline.payment'], { sessionId: input.sessionId, subjectId: it.offer.subjectId, offerItemId: it.item.id });
    const dueAt = computeDueAt({
      basis: session.paymentDueAt, reservedAt: now, graceDays, provisional: price.provisional, feeConfirmedAt: null,
      exceptionDate: exc.find((e) => e.valueDate)?.valueDate ?? null, cap: deadlines.get(l.offerItemId) ?? null,
    });
    records.push({
      id: randomUUID(),
      studentId: input.studentId,
      sessionId: input.sessionId,
      subjectId: it.offer.subjectId,
      offerItemId: it.item.id,
      boardSeriesId: it.item.boardSeriesId,
      attempt: l.attempt,
      mode: l.mode,
      isRetake: l.attempt === 'retake',
      takenOutsideSchool: l.mode === 'self_study',
      priorSittingSeriesId: l.priorSittingSeriesId ?? null,
      priorSittingSource: l.priorSittingSource ?? null,
      priceAtRegistration: price.total,
      courseFeeAtRegistration: price.courseFee,
      registrationFeeAtRegistration: price.registrationFee,
      priceProvisional: price.provisional,
      pricingBasis: price.basis as unknown as Record<string, unknown>,
      dueAt,
      teacherId,
      wasCoreAtRegistration: it.offer.grade10Core,
      status: input.status,
      requestedBy: input.requestedBy,
      approvedBy: input.approvedBy ?? null,
      approvedAt: input.approvedAt ?? null,
      approvalComments: input.approvalComments ?? null,
    });
  }
  const inserted = await tx.insert(registration).values(records).returning();
  if (usedExceptionIds.length) await lineExceptions.markUsed(tx, usedExceptionIds, { registrationIds: inserted.map((r) => r.id), actorId: input.requestedBy });
  return inserted;
}

// ─── What a line enters (F4's contract, RESERVATIONS_REWORK.md §9, §10) ──────

const MONTH_ORDER: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };
const sqlIds = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/**
 * F4's contract (RESERVATIONS_REWORK.md §10, the F4 row; docs/features/EXAM_ENTRIES.md §7): per
 * line, what it enters with the board, read from the line's **item** — not the subject row, which
 * since the rework is the offer's subject (the parent of IAL units, the syllabus of a one-paper
 * retake): the item and what it enters (`award` its qualification; `option` the option's code and
 * components, under its qualification; `units` the units, under the item's qualification or, for
 * Cambridge components, the syllabus they belong to; `subject` — a converted or unmapped item —
 * the subject row's own catalogue mapping, as F0b's entryItemsFor read it); the series with its
 * deadlines; the attempt as F4 enters it (`first` when the school rejected the declared sitting,
 * §3.5) beside the attempt reserved; the mode; the prior sitting with its source, its answer and,
 * from a verified carry-forward at another centre, the previous centre and candidate number; the
 * student's grade in the series' academic year and the school's level code.
 *
 * The previous centre and candidate number are the entry's (the board asks for them); they are
 * never shown in a list of lines.
 */
export async function lineItemsFor(registrationIds: string[], executor: Executor = db, readingOverride?: LevelCodeReading) {
  const ids = [...new Set(registrationIds)];
  if (!ids.length) return [];
  const rows = (await executor.execute(sql`
    select r.id, r.student_id as "studentId", r.session_id as "sessionId", r.status, r.board_series_id as "boardSeriesId",
      r.attempt, r.mode, r.teacher_id as "teacherId", r.prior_sitting_series_id as "priorSittingSeriesId",
      r.prior_sitting_source as "priorSittingSource", r.prior_sitting_verified_outcome as "verifiedOutcome",
      r.prior_sitting_verified_at as "verifiedAt", r.declaration_rejected as "declarationRejected",
      r.prior_centre as "priorCentre", r.prior_candidate_number as "priorCandidateNumber",
      i.id as "itemId", i.label as "itemLabel", i.kind as "itemKind", i.enters_kind as "entersKind",
      i.qualification_id as "itemQualificationId", i.qualification_option_id as "optionId", i.needs_prior_series as "needsPriorSeries",
      s.id as "subjectId", s.name as "subjectName", s.code as "subjectCode", s.council,
      s.qualification_level as "qualificationLevel", s.qualification_id as "subjectQualificationId",
      st.cohort_year as "cohortYear", sess.session_type as "sessionType", sess.series_year as "seriesYear",
      coalesce((select array_agg(iu.unit_id order by iu.unit_id) from session_offer_item_unit iu where iu.item_id = i.id), '{}') as "itemUnitIds",
      coalesce((select array_agg(su.unit_id order by su.unit_id) from subject_unit su where su.subject_id = s.id), '{}') as "subjectUnitIds"
    from registration r
    join session_offer_item i on i.id = r.offer_item_id
    join subject s on s.id = r.subject_id
    join "user" st on st.id = r.student_id
    join registration_session sess on sess.id = r.session_id
    where r.id in (${sqlIds(ids)})`)).rows as {
      id: string; studentId: string; sessionId: string; status: string; boardSeriesId: string | null; attempt: Attempt; mode: LineMode;
      teacherId: string | null; priorSittingSeriesId: string | null; priorSittingSource: string | null; verifiedOutcome: 'verified' | 'rejected' | null;
      verifiedAt: Date | string | null; declarationRejected: boolean; priorCentre: string | null; priorCandidateNumber: string | null;
      itemId: string; itemLabel: string; itemKind: string; entersKind: 'award' | 'option' | 'units' | 'subject'; itemQualificationId: string | null;
      optionId: string | null; needsPriorSeries: boolean; subjectId: string; subjectName: string; subjectCode: string; council: string;
      qualificationLevel: string; subjectQualificationId: string | null; cohortYear: number | null; sessionType: string; seriesYear: number;
      itemUnitIds: string[]; subjectUnitIds: string[];
    }[];
  if (!rows.length) return [];

  // The options the items enter, and their components.
  const optionIds = [...new Set(rows.map((r) => r.optionId).filter((x): x is string => !!x))];
  const options = optionIds.length ? await executor.select().from(qualificationOption).where(inArray(qualificationOption.id, optionIds)) : [];
  const optionUnits = optionIds.length ? await executor.select().from(qualificationOptionUnit).where(inArray(qualificationOptionUnit.optionId, optionIds)) : [];
  const unitIdsOf = (r: (typeof rows)[number]) =>
    r.entersKind === 'units' ? r.itemUnitIds
      : r.entersKind === 'option' ? optionUnits.filter((u) => u.optionId === r.optionId).map((u) => u.unitId)
        : r.entersKind === 'subject' ? r.subjectUnitIds : [];
  const allUnitIds = [...new Set(rows.flatMap(unitIdsOf))];
  const units = allUnitIds.length
    ? await executor.select({ id: examUnit.id, code: examUnit.code, shortCode: examUnit.shortCode, title: examUnit.title, unitLevel: examUnit.unitLevel, tier: examUnit.tier, kind: examUnit.kind, boardCode: examUnit.boardCode })
      .from(examUnit).where(inArray(examUnit.id, allUnitIds))
    : [];
  // The awards those units count toward (the level code; a Cambridge component's syllabus).
  const awardsOf = allUnitIds.length
    ? await executor.select({ unitId: qualificationUnit.unitId, id: qualification.id, code: qualification.code, title: qualification.title, level: qualification.level, entryMethod: qualification.entryMethod })
      .from(qualificationUnit).innerJoin(qualification, eq(qualification.id, qualificationUnit.qualificationId))
      .where(inArray(qualificationUnit.unitId, allUnitIds))
    : [];
  const qualificationOf = (r: (typeof rows)[number]): string | null => {
    if (r.entersKind === 'award') return r.itemQualificationId;
    if (r.entersKind === 'option') return options.find((o) => o.id === r.optionId)?.qualificationId ?? r.itemQualificationId;
    if (r.entersKind === 'subject') return r.subjectQualificationId;
    if (r.itemQualificationId) return r.itemQualificationId;
    // Components with no award named: the one syllabus every one of them belongs to.
    const mine = unitIdsOf(r);
    const syllabi = [...new Set(awardsOf.filter((a) => mine.includes(a.unitId) && a.entryMethod === 'syllabus_option').map((a) => a.id))];
    return syllabi.length === 1 && mine.every((u) => awardsOf.some((a) => a.unitId === u && a.id === syllabi[0])) ? syllabi[0]! : null;
  };
  const qualIds = [...new Set(rows.map(qualificationOf).filter((x): x is string => !!x))];
  const quals = qualIds.length
    ? await executor.select({ id: qualification.id, code: qualification.code, title: qualification.title, level: qualification.level, entryMethod: qualification.entryMethod, tier: qualification.tier, boardCode: qualification.boardCode })
      .from(qualification).where(inArray(qualification.id, qualIds))
    : [];

  // The series and the earlier sittings named.
  const seriesIds = [...new Set(rows.flatMap((r) => [r.boardSeriesId, r.priorSittingSeriesId]).filter((x): x is string => !!x))];
  const series = seriesIds.length ? await executor.select().from(boardSeries).where(inArray(boardSeries.id, seriesIds)) : [];
  const boards = await executor.select({ code: examBoard.code, name: examBoard.name, carryForwardMonths: examBoard.carryForwardMonths }).from(examBoard);
  const names = new Map(boards.map((b) => [b.code, b.name]));

  // Whether each student sits any A2 unit in the same series (the default reading of the level code).
  const studentIds = [...new Set(rows.map((r) => r.studentId))];
  const a2 = (await executor.execute(sql`
    select distinct r.student_id as "studentId", r.board_series_id as "seriesId"
    from registration r
    join session_offer_item i on i.id = r.offer_item_id
    join exam_unit u on u.id in (
      select iu.unit_id from session_offer_item_unit iu where iu.item_id = i.id
      union select ou.unit_id from qualification_option_unit ou where ou.option_id = i.qualification_option_id
      union select su.unit_id from subject_unit su where su.subject_id = r.subject_id and i.enters_kind = 'subject')
    where r.student_id in (${sqlIds(studentIds)}) and u.unit_level = 'a2'
      and r.status not in ('rejected', 'expired', 'dropped')`)).rows as { studentId: string; seriesId: string | null }[];
  const sitsA2 = new Set(a2.map((x) => `${x.studentId}|${x.seriesId ?? ''}`));
  const reading = readingOverride ?? (await getSetting('catalogue.levelCodeReading', executor));

  return rows.map((r) => {
    const s = series.find((x) => x.id === r.boardSeriesId) ?? null;
    const prior = series.find((x) => x.id === r.priorSittingSeriesId) ?? null;
    const myUnits = unitIdsOf(r).map((id) => units.find((u) => u.id === id)!).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code));
    const qId = qualificationOf(r);
    const q = quals.find((x) => x.id === qId) ?? null;
    const option = r.optionId ? options.find((o) => o.id === r.optionId) ?? null : null;
    const ay = s ? seriesAcademicYearStart(s.month, s.year) : seriesAcademicYearStart(r.sessionType, r.seriesYear);
    const grade = gradeInAcademicYear(r.cohortYear, ay);
    const counts = awardsOf.filter((a) => myUnits.some((u) => u.id === a.unitId));
    const levelCode = deriveLevelCode({
      qualificationLevel: q?.level ?? r.qualificationLevel,
      unitLevels: myUnits.map((u) => u.unitLevel as UnitLevel),
      awardLevels: [...new Set([...counts.map((a) => a.level), ...(q ? [q.level] : [])])],
      gradeInSeriesYear: grade,
      studentSitsA2InSeries: sitsA2.has(`${r.studentId}|${r.boardSeriesId ?? ''}`),
    }, reading);
    const mapped = r.entersKind !== 'subject' || !!r.subjectQualificationId || r.subjectUnitIds.length > 0;
    return {
      registrationId: r.id,
      studentId: r.studentId,
      sessionId: r.sessionId,
      status: r.status,
      boardCode: s?.boardCode ?? r.council,
      boardName: names.get(s?.boardCode ?? r.council) ?? r.council,
      boardSeries: s ? {
        id: s.id, boardCode: s.boardCode, month: s.month, year: s.year, label: s.label,
        entryDeadline: s.entryDeadline, retakeDeadline: s.retakeDeadline, name: boardSeriesName(names, s),
      } : null,
      subject: { id: r.subjectId, name: r.subjectName, code: r.subjectCode, qualificationLevel: r.qualificationLevel },
      item: { id: r.itemId, label: r.itemLabel, kind: r.itemKind, entersKind: r.entersKind, needsPriorSeries: r.needsPriorSeries },
      /** What the line enters: read from the item, or the subject row's mapping for a `subject` item ('subject' source); unmapped: nothing. */
      enters: {
        source: r.entersKind === 'subject' ? ('subject' as const) : ('item' as const),
        mapped,
        qualification: q,
        option: option ? { id: option.id, code: option.code, carryForward: option.carryForward, unitIds: optionUnits.filter((u) => u.optionId === option.id).map((u) => u.unitId) } : null,
        units: myUnits,
      },
      countsToward: [...new Map(counts.map((a) => [a.id, { id: a.id, code: a.code, title: a.title, level: a.level }])).values()],
      /** The attempt F4 enters: a retake whose declared sitting the school rejected is a first entry (§3.5). */
      attempt: (r.declarationRejected ? 'first' : r.attempt) as Attempt,
      attemptReserved: r.attempt,
      mode: r.mode,
      teacherId: r.teacherId,
      priorSitting: prior ? {
        seriesId: prior.id, boardCode: prior.boardCode, month: prior.month, year: prior.year, label: prior.label,
        name: boardSeriesName(names, prior), monthIndex: prior.year * 12 + (MONTH_ORDER[prior.month] ?? 0),
        source: r.priorSittingSource as 'known' | 'declared_by_desk' | 'declared_by_family' | 'legacy' | null,
        declared: r.priorSittingSource === 'declared_by_family' || r.priorSittingSource === 'declared_by_desk',
        outcome: r.verifiedOutcome,
        verifiedAt: r.verifiedAt ? new Date(r.verifiedAt) : null,
        previousCentre: r.priorCentre,
        previousCandidateNumber: r.priorCandidateNumber,
      } : null,
      declarationRejected: r.declarationRejected,
      carryForwardMonths: boards.find((b) => b.code === (s?.boardCode ?? r.council))?.carryForwardMonths ?? null,
      gradeInSeriesYear: grade,
      levelCode,
    };
  });
}

export type LineItem = Awaited<ReturnType<typeof lineItemsFor>>[number];
