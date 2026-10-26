/**
 * A session's offers — the school's links sheet (RESERVATIONS_REWORK.md §3.2, §3.3, §4.2;
 * docs/features/RESERVATIONS.md §1.2–§1.4).
 *
 * An offer is one subject of the session: its availability, its course fee, who teaches it,
 * and the items a family can tick under it (the whole subject, a one-paper retake, an IAL
 * unit, a Cambridge route), each entered in one board series and priced from that series'
 * fee grid. A board series is attached to the session when an item is placed in it and
 * detached when nothing references it; the admin never assembles one by hand.
 *
 * Locks (§6): an offer's or item's change takes its row FOR UPDATE; an item's series change
 * takes the affected students first (FOR NO KEY UPDATE, as a reservation does), then the
 * series, the offer and the item, then the lines.
 */

import {
  db, user, subject, teacher, subjectTeacher, registrationSession, registration, boardSeries, boardFee, examBoard, examUnit,
  qualification, qualificationOption, sessionBoardSeries, sessionOffer, sessionOfferTeacher, sessionOfferItem,
  sessionOfferItemUnit, sessionOfferItemTeacher, sessionOfferItemFeeKey, courseEnrolment, subjectUnit, qualificationUnit, qualificationOptionUnit,
  and, eq, ne, inArray, isNull, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  IGCSE_NEVER_MONTHS, IGCSE_NEVER_MESSAGE, IAL_UNIT_MONTHS, SERIES_MONTH_LABELS, sessionSeriesMonths, itemDisplayLabel,
  type CreateOfferType, type UpdateOfferType, type OfferItemInputType, type UpdateOfferItemType, type ReplaceOfferTeacherType,
  type OfferTeacherInputType, type FeeKeyInputType, type Availability, type SeriesMonth, type OfferFormType,
} from '@repo/validations';
import { logAction, logActions, type AuditContext } from './audit.services';
import { entriesFollowMoveInTx } from './exam-entry.services';
import { boardSeriesName, seriesRuleSentence, openCheckoutsSpanningDeadlines } from './series.services';
import { effectiveDeadlineFor, effectiveDeadlinesOf, redateLines } from './deadline.services';
import { itemBoardFees } from './pricing.services';
import { schoolDate } from './window.services';
import { getSetting } from './settings.services';
import { lockStudents, assertStudentsLocked, withStudentsFirst } from '../lib/student-locks';
import { lockFeeGrids } from '../lib/fee-grid-lock';
import { lockMoveFeeRows, repriceMovedLines, tellPriceChanged, type RepricedLine } from './line-moves.services';
import { recheckLines, LineRuleError } from './line-rules.services';
import { PricingError } from './pricing.services';
import { upsertEnrolments, lineEnrolmentUnits, groupFollowNotices, type EnrolmentRowInput } from './enrolment.services';
import { cellsOfAvailability, kindOfLegacy, NO_CELLS } from './setup/model';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class OfferError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const LIVE = ['pending_approval', 'pending_payment', 'preregistered', 'confirmed', 'dropped_pending_receipt'] as const;
const DONE = ['rejected', 'expired', 'dropped'] as const;

/** A database rule refused the change: its sentence, or the error itself. */
function rethrow(err: unknown): never {
  const sentence = seriesRuleSentence(err);
  if (sentence) throw new OfferError(sentence, 409);
  throw err;
}

async function boardNames(executor: Executor) {
  const rows = await executor.select({ code: examBoard.code, name: examBoard.name, months: examBoard.seriesMonths }).from(examBoard);
  return { names: new Map(rows.map((r) => [r.code, r.name])), months: new Map(rows.map((r) => [r.code, r.months])) };
}

// ─── Availability ────────────────────────────────────────────────────────────

/** What an offer's and an item's availability allow together: both apply. */
export function availabilityConstraints(offer: string, item: string) {
  return {
    closed: offer === 'closed' || item === 'closed',
    retakeOnly: offer === 'retake_only' || item === 'retake_only',
    selfStudyOnly: offer === 'self_study_only' || item === 'self_study_only',
  };
}

// ─── Series attached by item (§3.3) ──────────────────────────────────────────

/** The board's series of (month, year, label), created with no dates when not on record. */
export async function findOrCreateSeries(
  tx: Tx, boardCode: string, month: SeriesMonth, year: number, label: string, actorId: string | null,
  reason = 'Created when an item of a session was placed in it (no dates yet)',
): Promise<{ id: string; created: boolean }> {
  const { names, months } = await boardNames(tx);
  if (!names.has(boardCode)) throw new OfferError('Board not found', 404);
  if (!(months.get(boardCode) ?? []).includes(month)) {
    throw new OfferError(`${names.get(boardCode)} sits no ${SERIES_MONTH_LABELS[month]} series — change the board's months on the Catalogue screen if it now does`);
  }
  const [found] = await tx.select({ id: boardSeries.id }).from(boardSeries)
    .where(and(eq(boardSeries.boardCode, boardCode), eq(boardSeries.month, month), eq(boardSeries.year, year), eq(boardSeries.label, label)));
  if (found) return { id: found.id, created: false };
  const id = randomUUID();
  const [made] = await tx.insert(boardSeries).values({ id, boardCode, month, year, label }).onConflictDoNothing().returning({ id: boardSeries.id });
  if (!made) {
    const [again] = await tx.select({ id: boardSeries.id }).from(boardSeries)
      .where(and(eq(boardSeries.boardCode, boardCode), eq(boardSeries.month, month), eq(boardSeries.year, year), eq(boardSeries.label, label)));
    return { id: again!.id, created: false };
  }
  await logAction(actorId, 'BOARD_SERIES_CREATED', 'board_series', id, null,
    { boardCode, month, year, label, reason }, undefined, tx);
  return { id, created: true };
}

/** Attach a series to a session (the derived link). The database checks its year and kind. */
export async function attachSeries(tx: Tx, sessionId: string, seriesId: string, actorId: string | null) {
  const [s] = await tx.select({ boardCode: boardSeries.boardCode }).from(boardSeries).where(eq(boardSeries.id, seriesId));
  if (!s) throw new OfferError('Board series not found', 404);
  await tx.insert(sessionBoardSeries).values({
    id: randomUUID(), sessionId, boardSeriesId: seriesId, boardCode: s.boardCode, isDefault: false, createdBy: actorId,
  }).onConflictDoNothing();
}

/** Detach the series nothing of the session references any more (no item, no line). */
export async function detachUnusedSeries(tx: Tx, sessionId: string) {
  await tx.execute(sql`
    delete from session_board_series l
    where l.session_id = ${sessionId}
      and not exists (select 1 from session_offer_item i where i.session_id = l.session_id and i.board_series_id = l.board_series_id)
      and not exists (select 1 from registration r where r.session_id = l.session_id and r.board_series_id = l.board_series_id)`);
}

/** An item's level for the series defaults and the IGCSE rule: 'igcse', 'as' or 'a_level'. */
async function levelOf(executor: Executor, subjectLevel: string, enters: { kind: string; qualificationId?: string | null; optionId?: string | null; unitIds?: string[] }) {
  if (enters.kind === 'award' && enters.qualificationId) {
    const [q] = await executor.select({ level: qualification.level }).from(qualification).where(eq(qualification.id, enters.qualificationId));
    if (q) return q.level === 'igcse' ? 'igcse' : q.level === 'as_level' ? 'as' : 'a_level';
  }
  if (enters.kind === 'option' && enters.optionId) {
    const [q] = await executor.select({ level: qualification.level }).from(qualificationOption)
      .innerJoin(qualification, eq(qualification.id, qualificationOption.qualificationId)).where(eq(qualificationOption.id, enters.optionId));
    if (q) return q.level === 'igcse' ? 'igcse' : q.level === 'as_level' ? 'as' : 'a_level';
  }
  if (enters.kind === 'units' && enters.unitIds?.length) {
    const units = await executor.select({ level: examUnit.unitLevel }).from(examUnit).where(inArray(examUnit.id, enters.unitIds));
    if (units.some((u) => u.level === 'igcse')) return 'igcse';
    if (units.some((u) => u.level === 'a2')) return 'a_level';
    if (units.length) return 'as';
  }
  return subjectLevel === 'igcse' ? 'igcse' : subjectLevel === 'as_level' ? 'as' : 'a_level';
}

/**
 * An item's default series (§3.3): June — the board's June of the year; winter — an IGCSE
 * item the board's November, an AS or A2 item Pearson's October and Cambridge's and Oxford's
 * November (January is selected by hand). The unlabelled series, created when not on record.
 */
export async function defaultSeriesFor(
  tx: Tx, session: { sessionType: string; seriesYear: number }, boardCode: string, level: string, actorId: string | null,
): Promise<string> {
  const { months } = await boardNames(tx);
  const sits = months.get(boardCode) ?? [];
  const options = sessionSeriesMonths(session.sessionType, session.seriesYear)
    .filter((m) => sits.includes(m.month))
    .filter((m) => !(level === 'igcse' && IGCSE_NEVER_MONTHS.includes(m.month)));
  if (!options.length) {
    throw new OfferError(level === 'igcse'
      ? `No series of this board fits an IGCSE item in this session (IGCSE sits June and November)`
      : `This board sits no series in this session's months`);
  }
  const preferred = session.sessionType === 'june'
    ? options[0]!
    : (level === 'igcse' ? options.find((m) => m.month === 'november')
      : boardCode === 'pearson_edexcel' ? options.find((m) => m.month === 'october') : options.find((m) => m.month === 'november')) ?? options[0]!;
  return (await findOrCreateSeries(tx, boardCode, preferred.month, preferred.year, '', actorId)).id;
}

/**
 * The unit items (kind 'unit') that enter a unit of a units-cash-in award — a Pearson IAL's units: they sit
 * in the board's IAL months alone (`IAL_UNIT_MONTHS`, the lead's decision of 16 Oct 2026). The subject's
 * form offers them those months and refuses another (saveOfferForm); the sheet's read says which they are.
 */
async function cashInUnitItems(executor: Executor, itemIds: string[]): Promise<Set<string>> {
  if (!itemIds.length) return new Set();
  const rows = await executor.selectDistinct({ itemId: sessionOfferItemUnit.itemId }).from(sessionOfferItemUnit)
    .innerJoin(sessionOfferItem, eq(sessionOfferItem.id, sessionOfferItemUnit.itemId))
    .innerJoin(qualificationUnit, eq(qualificationUnit.unitId, sessionOfferItemUnit.unitId))
    .innerJoin(qualification, eq(qualification.id, qualificationUnit.qualificationId))
    .where(and(inArray(sessionOfferItemUnit.itemId, itemIds), eq(sessionOfferItem.kind, 'unit'), eq(qualification.entryMethod, 'units_cash_in')));
  return new Set(rows.map((r) => r.itemId));
}

/** Refuse an item's series that breaks the per-item rules the service checks before the database. */
async function assertItemSeriesFits(
  tx: Tx, session: { id: string; sessionType: string; seriesYear: number }, subjectRow: { council: string; name: string }, level: string, seriesId: string,
) {
  const [s] = await tx.select().from(boardSeries).where(eq(boardSeries.id, seriesId));
  if (!s) throw new OfferError('Board series not found', 404);
  const { names } = await boardNames(tx);
  if (s.boardCode !== subjectRow.council) {
    throw new OfferError(`${subjectRow.name} is entered with ${names.get(subjectRow.council) ?? subjectRow.council}; ${boardSeriesName(names, s)} is another board's series`);
  }
  if (level === 'igcse' && IGCSE_NEVER_MONTHS.includes(s.month as SeriesMonth)) throw new OfferError(IGCSE_NEVER_MESSAGE);
  const fits = sessionSeriesMonths(session.sessionType, session.seriesYear).some((m) => m.month === s.month && m.year === s.year);
  if (!fits) {
    throw new OfferError(`${boardSeriesName(names, s)} is not a series of this session (${session.sessionType === 'june' ? `June ${session.seriesYear}` : `October or November ${session.seriesYear}, or January ${session.seriesYear + 1}`})`);
  }
  return s;
}

// ─── Teachers ────────────────────────────────────────────────────────────────

/** Teachers named for an offer or item: existing (active) ones or new providers; each joins the subject's pool. */
async function resolveTeachers(tx: Tx, subjectId: string, inputs: OfferTeacherInputType[], actorId: string | null) {
  const out: { teacherId: string; mode: 'in_school' | 'online' }[] = [];
  for (const t of inputs) {
    let teacherId: string;
    if ('teacherId' in t) {
      const [row] = await tx.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(teacher).where(eq(teacher.id, t.teacherId));
      if (!row) throw new OfferError('Teacher not found', 404);
      if (!row.isActive) throw new OfferError(`${row.name} is inactive`);
      teacherId = row.id;
    } else {
      const [existing] = await tx.select({ id: teacher.id }).from(teacher)
        .where(and(eq(teacher.kind, 'provider'), sql`lower(${teacher.name}) = lower(${t.providerName})`));
      if (existing) teacherId = existing.id;
      else {
        teacherId = randomUUID();
        await tx.insert(teacher).values({ id: teacherId, name: t.providerName, kind: 'provider', isActive: true });
        await logAction(actorId, 'TEACHER_CREATED', 'teacher', teacherId, null, { name: t.providerName, kind: 'provider' }, undefined, tx);
      }
    }
    if (out.some((o) => o.teacherId === teacherId)) continue;
    await tx.insert(subjectTeacher).values({ id: randomUUID(), subjectId, teacherId }).onConflictDoNothing();
    out.push({ teacherId, mode: t.mode });
  }
  return out;
}

// ─── Items from the catalogue (§3.2's table) ────────────────────────────────

type ItemDraft = {
  label: string;
  kind: 'whole' | 'one_paper' | 'unit' | 'route' | 'qualification';
  enters: { kind: 'award'; qualificationId: string } | { kind: 'option'; optionId: string } | { kind: 'units'; unitIds: string[] } | { kind: 'subject' };
  boardSeriesId?: string | null;
  availability: Availability;
  courseFee?: number | null;
  feeKeys?: FeeKeyInputType[];
  needsPriorSeries?: boolean;
  requiredInSeries: boolean;
  exclusiveGroup?: string | null;
  teachers?: OfferTeacherInputType[];
  sortOrder?: number;
};

/**
 * The items a subject gets when added without a list: an IAL row entering several units one item
 * per unit; a unit row one item; a Cambridge syllabus with options one route per option of its
 * AS and A Level awards (one exclusive group, carry-forward options needing a prior series) or,
 * with one option, the whole subject entering it; an award the whole subject; an unmapped row
 * the row itself. One-paper retakes are added by the school on the drawer.
 */
export async function generateItems(executor: Executor, subjectId: string): Promise<ItemDraft[]> {
  const [s] = await executor.select().from(subject).where(eq(subject.id, subjectId));
  if (!s) throw new OfferError('Subject not found', 404);
  const units = await executor.select({ id: examUnit.id, code: examUnit.code, shortCode: examUnit.shortCode, title: examUnit.title })
    .from(subjectUnit).innerJoin(examUnit, eq(examUnit.id, subjectUnit.unitId)).where(eq(subjectUnit.subjectId, subjectId)).orderBy(asc(examUnit.code));
  if (units.length === 1) {
    return [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'units', unitIds: [units[0]!.id] }, availability: 'open', requiredInSeries: false }];
  }
  if (units.length > 1) {
    return units.map((u, i) => ({
      label: u.shortCode ?? u.code, kind: 'unit' as const, enters: { kind: 'units' as const, unitIds: [u.id] }, availability: 'open' as const,
      requiredInSeries: false, sortOrder: i,
    }));
  }
  if (s.qualificationId) {
    const [q] = await executor.select().from(qualification).where(eq(qualification.id, s.qualificationId));
    if (q && q.entryMethod === 'syllabus_option') {
      // The syllabus at its other level too (Cambridge 9702 is an AS and an A Level award).
      const siblings = await executor.select({ id: qualification.id, level: qualification.level }).from(qualification)
        .where(and(eq(qualification.boardCode, q.boardCode), eq(qualification.code, q.code)));
      const options = await executor.select({ id: qualificationOption.id, code: qualificationOption.code, label: qualificationOption.label, carryForward: qualificationOption.carryForward, level: qualification.level })
        .from(qualificationOption).innerJoin(qualification, eq(qualification.id, qualificationOption.qualificationId))
        .where(and(inArray(qualificationOption.qualificationId, siblings.map((x) => x.id)), eq(qualificationOption.isActive, true)))
        .orderBy(asc(qualification.level), asc(qualificationOption.code));
      if (q.level === 'igcse' && options.length === 1) {
        return withOnePaper(executor, q, options[0]!.id,
          { label: 'Whole subject', kind: 'whole', enters: { kind: 'option', optionId: options[0]!.id }, availability: 'open', requiredInSeries: false });
      }
      if (q.level !== 'igcse' && options.length > 0) {
        return options.map((o, i) => ({
          label: o.label, kind: 'route' as const, enters: { kind: 'option' as const, optionId: o.id }, availability: 'open' as const,
          needsPriorSeries: o.carryForward, requiredInSeries: false, exclusiveGroup: 'route', sortOrder: i,
        }));
      }
    }
    const whole: ItemDraft = { label: 'Whole subject', kind: 'whole', enters: { kind: 'award', qualificationId: s.qualificationId }, availability: 'open', requiredInSeries: false };
    return q ? withOnePaper(executor, q, null, whole) : [whole];
  }
  return [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, availability: 'open', requiredInSeries: false }];
}

/**
 * What a one-paper item's board fee is read for (F8-05): the board's `one_paper_fee_key`. Cambridge's
 * 'qualification' — the syllabus's fee (the board charges the syllabus for a carry-forward re-entry,
 * Q-13), read from the same row as the subject's whole item, so the fee list names a syllabus once: the
 * option's row when the whole item enters an option ("0970 CX 10,850"), the qualification's otherwise
 * (the lead's answer 2 on the review of 744e553). Pearson Edexcel's 'unit' — the paper's own row, as its
 * list prices it ("4MA1 1H 4,600"). A row with no award falls back to its units.
 */
async function onePaperFeeKeys(
  executor: Executor, boardCode: string, qualificationId: string | null, unitIds: string[], wholeOptionId: string | null,
): Promise<FeeKeyInputType[]> {
  const [b] = await executor.select({ key: examBoard.onePaperFeeKey }).from(examBoard).where(eq(examBoard.code, boardCode));
  if (b?.key === 'qualification' && qualificationId) {
    return wholeOptionId ? [{ kind: 'option', id: wholeOptionId }] : [{ kind: 'qualification', id: qualificationId }];
  }
  return unitIds.map((id) => ({ kind: 'unit' as const, id }));
}

/**
 * The option the subject's whole item enters on this offer, when it enters one of this qualification's
 * options: the row a one-paper item made later reads on a syllabus-keyed board (onePaperFeeKeys).
 */
async function wholeItemOption(executor: Executor, offerId: string, qualificationId: string | null): Promise<string | null> {
  if (!qualificationId) return null;
  const wholes = await executor.select({ optionId: sessionOfferItem.qualificationOptionId }).from(sessionOfferItem)
    .innerJoin(qualificationOption, eq(qualificationOption.id, sessionOfferItem.qualificationOptionId))
    .where(and(eq(sessionOfferItem.offerId, offerId), eq(sessionOfferItem.kind, 'all_papers'), eq(sessionOfferItem.entersKind, 'option'),
      eq(qualificationOption.qualificationId, qualificationId)));
  return wholes.length === 1 ? wholes[0]!.optionId : null;
}

/**
 * An IGCSE award's one-paper retake items (§3.2's table: "Paper 4 only (retake)", "Paper 1H only"):
 * one per component the catalogue says the award requires (its own, or its option's), each
 * entering that component, retakes only, its board fee read as its board prices one paper
 * (`onePaperFeeKeys`: the whole item's row on Cambridge — its option's, or the syllabus's, Q-13; the
 * paper's own on Pearson Edexcel), in one
 * exclusive group with the whole subject, carrying the other components on a Cambridge syllabus.
 * They come **unticked** (closed): the school opens the ones it offers on the drawer, with their
 * course fee.
 */
async function withOnePaper(executor: Executor, q: typeof qualification.$inferSelect, optionId: string | null, whole: ItemDraft): Promise<ItemDraft[]> {
  if (q.level !== 'igcse') return [whole];
  const own = await executor.select({ id: examUnit.id, code: examUnit.code, shortCode: examUnit.shortCode })
    .from(qualificationUnit).innerJoin(examUnit, eq(examUnit.id, qualificationUnit.unitId))
    .where(and(eq(qualificationUnit.qualificationId, q.id), eq(qualificationUnit.requirement, 'required'), eq(examUnit.kind, 'component'), eq(examUnit.isActive, true)));
  const viaOption = optionId
    ? await executor.select({ id: examUnit.id, code: examUnit.code, shortCode: examUnit.shortCode })
        .from(qualificationOptionUnit).innerJoin(examUnit, eq(examUnit.id, qualificationOptionUnit.unitId))
        .where(and(eq(qualificationOptionUnit.optionId, optionId), eq(examUnit.kind, 'component'), eq(examUnit.isActive, true)))
    : [];
  const components = [...new Map([...own, ...viaOption].map((u) => [u.id, u])).values()].sort((a, b) => a.code.localeCompare(b.code));
  if (!components.length) return [whole];
  const drafts: ItemDraft[] = [{ ...whole, exclusiveGroup: 'entry' }];
  for (const [i, u] of components.entries()) {
    drafts.push({
      label: `${u.shortCode ?? u.code} only (retake)`, kind: 'one_paper', enters: { kind: 'units', unitIds: [u.id] },
      feeKeys: await onePaperFeeKeys(executor, q.boardCode, q.id, [u.id], whole.enters.kind === 'option' ? whole.enters.optionId : null),
      availability: 'closed', needsPriorSeries: q.boardCode === 'cambridge',
      requiredInSeries: false, exclusiveGroup: 'entry', sortOrder: 10 + i,
    });
  }
  return drafts;
}

/** What an item enters, checked against the subject's board; the default fee keys follow from it. */
async function checkEnters(tx: Tx, subjectRow: typeof subject.$inferSelect, enters: ItemDraft['enters']) {
  if (enters.kind === 'award') {
    const [q] = await tx.select({ id: qualification.id, boardCode: qualification.boardCode }).from(qualification).where(eq(qualification.id, enters.qualificationId));
    if (!q) throw new OfferError('Qualification not found', 404);
    if (q.boardCode !== subjectRow.council) throw new OfferError(`That award is another board's: ${subjectRow.name} is entered with its own board`);
    return { qualificationId: q.id, optionId: null, unitIds: [] as string[], feeKeys: [{ kind: 'qualification' as const, id: q.id }] };
  }
  if (enters.kind === 'option') {
    const [o] = await tx.select({ id: qualificationOption.id, qualificationId: qualificationOption.qualificationId, boardCode: qualification.boardCode })
      .from(qualificationOption).innerJoin(qualification, eq(qualification.id, qualificationOption.qualificationId)).where(eq(qualificationOption.id, enters.optionId));
    if (!o) throw new OfferError('Option code not found', 404);
    if (o.boardCode !== subjectRow.council) throw new OfferError(`That option is another board's: ${subjectRow.name} is entered with its own board`);
    return { qualificationId: o.qualificationId, optionId: o.id, unitIds: [] as string[], feeKeys: [{ kind: 'option' as const, id: o.id }] };
  }
  if (enters.kind === 'units') {
    const ids = [...new Set(enters.unitIds)];
    const units = await tx.select({ id: examUnit.id, boardCode: examUnit.boardCode }).from(examUnit).where(inArray(examUnit.id, ids));
    if (units.length !== ids.length) throw new OfferError('One or more units were not found', 404);
    if (units.some((u) => u.boardCode !== subjectRow.council)) throw new OfferError(`A unit of another board: ${subjectRow.name} is entered with its own board`);
    return { qualificationId: subjectRow.qualificationId, optionId: null, unitIds: ids, feeKeys: ids.map((id) => ({ kind: 'unit' as const, id })) };
  }
  return { qualificationId: null, optionId: null, unitIds: [] as string[], feeKeys: [{ kind: 'subject' as const, id: subjectRow.id }] };
}

async function writeFeeKeys(tx: Tx, itemId: string, keys: FeeKeyInputType[]) {
  await tx.delete(sessionOfferItemFeeKey).where(eq(sessionOfferItemFeeKey.itemId, itemId));
  const seen = new Set<string>();
  for (const k of keys) {
    const key = `${k.kind}|${k.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await tx.insert(sessionOfferItemFeeKey).values({
      id: randomUUID(), itemId, keyKind: k.kind,
      unitId: k.kind === 'unit' ? k.id : null,
      qualificationOptionId: k.kind === 'option' ? k.id : null,
      qualificationId: k.kind === 'qualification' ? k.id : null,
      subjectId: k.kind === 'subject' ? k.id : null,
    });
  }
}

async function writeItemTeachers(tx: Tx, itemId: string, teachers: { teacherId: string; mode: 'in_school' | 'online' }[]) {
  await tx.delete(sessionOfferItemTeacher).where(eq(sessionOfferItemTeacher.itemId, itemId));
  if (teachers.length) {
    await tx.insert(sessionOfferItemTeacher).values(teachers.map((t, i) => ({ id: randomUUID(), itemId, teacherId: t.teacherId, mode: t.mode, sortOrder: i })));
  }
}

type SessionRow = typeof registrationSession.$inferSelect;

/** Create one item of an offer, its series attached, in the caller's transaction. */
async function insertItem(
  tx: Tx, session: SessionRow, offer: { id: string; subjectId: string }, subjectRow: typeof subject.$inferSelect, d: ItemDraft, actorId: string | null,
) {
  const enters = await checkEnters(tx, subjectRow, d.enters);
  const level = await levelOf(tx, subjectRow.qualificationLevel, { kind: d.enters.kind, qualificationId: enters.qualificationId, optionId: enters.optionId, unitIds: enters.unitIds });
  const seriesId = d.boardSeriesId ?? (await defaultSeriesFor(tx, session, subjectRow.council, level, actorId));
  await assertItemSeriesFits(tx, session, subjectRow, level, seriesId);
  await attachSeries(tx, session.id, seriesId, actorId);
  let needsPrior = d.needsPriorSeries;
  if (needsPrior === undefined && enters.optionId) {
    const [o] = await tx.select({ cf: qualificationOption.carryForward }).from(qualificationOption).where(eq(qualificationOption.id, enters.optionId));
    needsPrior = !!o?.cf;
  }
  const id = randomUUID();
  // The coordinator rework: the deprecated route's kind in her words, and the four cells kept in step with
  // its availability (with the offer's) until P1b drops the old column (migration 0066's conversion).
  const [offerAvail] = await tx.select({ availability: sessionOffer.availability }).from(sessionOffer).where(eq(sessionOffer.id, offer.id));
  const [q] = enters.qualificationId ? await tx.select({ level: qualification.level }).from(qualification).where(eq(qualification.id, enters.qualificationId)) : [];
  const kind = kindOfLegacy(d.kind, { needsPriorSeries: !!needsPrior, label: d.label, qualificationLevel: q?.level ?? null });
  await tx.insert(sessionOfferItem).values({
    id, offerId: offer.id, sessionId: session.id, label: d.label, kind, entersKind: d.enters.kind,
    qualificationId: d.enters.kind === 'subject' ? null : enters.qualificationId, qualificationOptionId: enters.optionId,
    boardSeriesId: seriesId, availability: d.availability, courseFee: d.courseFee ?? null,
    needsPriorSeries: !!needsPrior, requiredInSeries: d.requiredInSeries, exclusiveGroup: d.exclusiveGroup ?? null,
    sortOrder: d.sortOrder ?? 0, createdBy: actorId,
    ...cellsOfAvailability(offerAvail?.availability ?? 'open', d.availability, kind, !!needsPrior),
  });
  if (enters.unitIds.length) await tx.insert(sessionOfferItemUnit).values(enters.unitIds.map((unitId) => ({ itemId: id, unitId })));
  // A one-paper item made without fee keys (the item endpoint) reads them as its board prices one paper (F8-05):
  // on a syllabus-keyed board, the row the offer's whole item reads (answer 2).
  const defaultKeys = d.kind === 'one_paper' && d.enters.kind === 'units'
    ? await onePaperFeeKeys(tx, subjectRow.council, enters.qualificationId, enters.unitIds, d.feeKeys ? null : await wholeItemOption(tx, offer.id, enters.qualificationId))
    : enters.feeKeys;
  await writeFeeKeys(tx, id, d.feeKeys ?? defaultKeys);
  if (d.teachers?.length) await writeItemTeachers(tx, id, await resolveTeachers(tx, offer.subjectId, d.teachers, actorId));
  return id;
}

// ─── Offers ──────────────────────────────────────────────────────────────────

async function sessionForChange(tx: Tx, sessionId: string, lock: 'share' | 'update' = 'share') {
  const [s] = await tx.select().from(registrationSession).where(eq(registrationSession.id, sessionId)).for(lock);
  if (!s) throw new OfferError('Session not found', 404);
  if (s.status === 'closed') throw new OfferError('This session is closed: its subjects are history');
  return s;
}

/**
 * MO-9: a line is never priced from a course fee nobody set. An open or retakes-only offer has a
 * course fee above 0 (F7's review of 8 Oct, item 6: a catalogue row the day-one import adds carries no
 * fee, and the Add subject dialog read it). A self-study-only offer may carry 0 with a reason, as a
 * board fee may: the school may price a subject it does not teach at the board fee alone (the lead's
 * call on F7's review of 2ca07a4, item 2). A closed offer may keep 0 until it opens. `wasZeroSelfStudy`:
 * the offer is already self-study only at 0, its reason given then.
 */
function assertCourseFeeFor(availability: string, courseFee: number, subjectName: string, zeroFeeReason?: string | null, wasZeroSelfStudy = false) {
  if (availability === 'closed' || courseFee > 0) return;
  if (availability === 'self_study_only') {
    if (!wasZeroSelfStudy && !zeroFeeReason?.trim()) {
      throw new OfferError(`${subjectName} is self-study only at a course fee of 0: say why (its lines are priced at the board fee alone)`);
    }
    return;
  }
  throw new OfferError(`${subjectName} has no course fee: set the school's course fee before it is open in this session (a line is never priced without one)`);
}

function assertTeachersFor(availability: string, teacherCount: number, subjectName: string) {
  if (availability === 'open' && teacherCount === 0) {
    throw new OfferError(`Who teaches ${subjectName}? An open subject names its teachers — or make it self-study only`);
  }
}

/**
 * Add a subject to a session (§4.2 "Add subject"): the subject, its teachers and course fee; the
 * items come from the catalogue unless given.
 */
export async function createOffer(sessionId: string, data: CreateOfferType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const session = await sessionForChange(tx, sessionId);
      const [s] = await tx.select().from(subject).where(eq(subject.id, data.subjectId)).for('share');
      if (!s) throw new OfferError('Subject not found', 404);
      if (!s.isActive) throw new OfferError(`${s.name} is inactive — reactivate it on the Subjects page first`);
      const [dup] = await tx.select({ id: sessionOffer.id }).from(sessionOffer).where(and(eq(sessionOffer.sessionId, sessionId), eq(sessionOffer.subjectId, s.id)));
      if (dup) throw new OfferError(`${s.name} is already in this session`, 409);
      const teachers = await resolveTeachers(tx, s.id, data.teachers, actorId);
      assertTeachersFor(data.availability, teachers.length, s.name);
      assertCourseFeeFor(data.availability, data.courseFee, s.name, data.zeroFeeReason);
      const offerId = randomUUID();
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(sessionOffer).where(eq(sessionOffer.sessionId, sessionId)) as [{ n: number }];
      await tx.insert(sessionOffer).values({
        id: offerId, sessionId, subjectId: s.id, availability: data.availability, accepting: data.availability !== 'closed', courseFee: data.courseFee,
        courseStartsOn: data.courseStartsOn ?? null, grade10Core: data.grade10Core, notes: data.notes ?? null, sortOrder: n, createdBy: actorId,
      });
      if (teachers.length) {
        await tx.insert(sessionOfferTeacher).values(teachers.map((t, i) => ({ id: randomUUID(), offerId, teacherId: t.teacherId, mode: t.mode, sortOrder: i })));
      }
      const drafts: ItemDraft[] = data.items ? data.items.map(toDraft) : await generateItems(tx, s.id);
      const itemIds: string[] = [];
      for (const d of drafts) itemIds.push(await insertItem(tx, session, { id: offerId, subjectId: s.id }, s, d, actorId));
      await logAction(actorId, 'SESSION_OFFER_CREATED', 'session_offer', offerId, null,
        { sessionId, subjectId: s.id, availability: data.availability, courseFee: data.courseFee, teachers, items: itemIds, grade10Core: data.grade10Core,
          ...(data.courseFee > 0 ? {} : { zeroFeeReason: data.zeroFeeReason ?? null }) }, ctx, tx);
      return { id: offerId, items: itemIds };
    });
  } catch (err) {
    if (err instanceof OfferError) throw err;
    rethrow(err);
  }
}

function toDraft(i: OfferItemInputType): ItemDraft {
  return {
    label: i.label, kind: i.kind, enters: i.enters, boardSeriesId: i.boardSeriesId ?? null, availability: i.availability,
    courseFee: i.courseFee ?? null, feeKeys: i.feeKeys, needsPriorSeries: i.needsPriorSeries, requiredInSeries: i.requiredInSeries,
    exclusiveGroup: i.exclusiveGroup ?? null, teachers: i.teachers, sortOrder: i.sortOrder,
  };
}

async function offerForChange(tx: Tx, sessionId: string, offerId: string) {
  const [o] = await tx.select().from(sessionOffer).where(and(eq(sessionOffer.id, offerId), eq(sessionOffer.sessionId, sessionId))).for('update');
  if (!o) throw new OfferError('That subject is not in this session', 404);
  const [s] = await tx.select().from(subject).where(eq(subject.id, o.subjectId));
  return { offer: o, subjectRow: s! };
}

/**
 * Change an offer: availability (closing stops new lines; its lines stand), course fee, course
 * start, the grade-10 core flag, notes, teachers (the whole set; lines naming a removed teacher
 * keep them — "Replace teacher" moves them).
 */
export async function updateOffer(sessionId: string, offerId: string, data: UpdateOfferType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    await sessionForChange(tx, sessionId);
    const { offer, subjectRow } = await offerForChange(tx, sessionId, offerId);
    return changeOfferInTx(tx, offer, subjectRow, data, actorId, ctx);
  });
}

/** updateOffer's change of an offer the caller holds FOR UPDATE (the offer endpoint and the form). */
async function changeOfferInTx(
  tx: Tx, offer: typeof sessionOffer.$inferSelect, subjectRow: typeof subject.$inferSelect, data: UpdateOfferType, actorId: string, ctx?: AuditContext,
) {
  const offerId = offer.id;
  const current = await tx.select().from(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, offerId));
  let teachers = current.map((t) => ({ teacherId: t.teacherId, mode: t.mode as 'in_school' | 'online' }));
  if (data.teachers) {
    teachers = await resolveTeachers(tx, offer.subjectId, data.teachers, actorId);
    await tx.delete(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, offerId));
    if (teachers.length) {
      await tx.insert(sessionOfferTeacher).values(teachers.map((t, i) => ({ id: randomUUID(), offerId, teacherId: t.teacherId, mode: t.mode, sortOrder: i })));
    }
  }
  const availability = data.availability ?? offer.availability;
  assertTeachersFor(availability, teachers.length, subjectRow.name);
  // Checked when the change sets the fee or opens the offer (an offer converted with 0 keeps its other edits).
  if (data.courseFee !== undefined || data.availability !== undefined) {
    assertCourseFeeFor(availability, data.courseFee ?? offer.courseFee ?? 0, subjectRow.name, data.zeroFeeReason,
      offer.availability === 'self_study_only' && !(Number(offer.courseFee) > 0));
  }
  const { reason, teachers: _t, zeroFeeReason, ...fields } = data;
  const [updated] = await tx.update(sessionOffer).set({ ...fields, ...(fields.availability !== undefined ? { accepting: fields.availability !== 'closed' } : {}), updatedAt: new Date() })
    .where(eq(sessionOffer.id, offerId)).returning();
  // The coordinator rework: the four cells of its items follow the offer's availability (with each item's own).
  if (fields.availability !== undefined && fields.availability !== offer.availability) {
    for (const it of await tx.select().from(sessionOfferItem).where(eq(sessionOfferItem.offerId, offerId))) {
      await tx.update(sessionOfferItem).set(cellsOfAvailability(fields.availability, it.availability, it.kind, it.needsPriorSeries)).where(eq(sessionOfferItem.id, it.id));
    }
  }
  await logAction(actorId, 'SESSION_OFFER_UPDATED', 'session_offer', offerId,
    { availability: offer.availability, courseFee: offer.courseFee, grade10Core: offer.grade10Core, teachers: current.map((t) => t.teacherId) },
    { ...fields, teachers: teachers.map((t) => t.teacherId), reason: reason ?? null, ...(zeroFeeReason ? { zeroFeeReason } : {}) }, ctx, tx);
  return updated!;
}

/** Remove a subject the session has no line for (any status); one with lines is closed instead. */
export async function deleteOffer(sessionId: string, offerId: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    await sessionForChange(tx, sessionId);
    const { offer, subjectRow } = await offerForChange(tx, sessionId, offerId);
    const [line] = await tx.select({ id: registration.id }).from(registration)
      .innerJoin(sessionOfferItem, eq(sessionOfferItem.id, registration.offerItemId))
      .where(eq(sessionOfferItem.offerId, offerId)).limit(1);
    if (line) throw new OfferError(`${subjectRow.name} has lines in this session: close it instead (its lines stand)`, 409);
    await tx.delete(sessionOffer).where(eq(sessionOffer.id, offerId));
    await detachUnusedSeries(tx, sessionId);
    await logAction(actorId, 'SESSION_OFFER_DELETED', 'session_offer', offerId, { sessionId, subjectId: offer.subjectId }, null, ctx, tx);
    return { deleted: offerId };
  });
}

// ─── Items ───────────────────────────────────────────────────────────────────

export async function createItem(sessionId: string, offerId: string, data: OfferItemInputType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const session = await sessionForChange(tx, sessionId);
      const { offer, subjectRow } = await offerForChange(tx, sessionId, offerId);
      return { id: await createItemInTx(tx, session, offer, subjectRow, toDraft(data), { offerId, ...data }, actorId, ctx) };
    });
  } catch (err) {
    if (err instanceof OfferError) throw err;
    rethrow(err);
  }
}

/** createItem's making of an item under an offer the caller holds FOR UPDATE, with its audit row. */
async function createItemInTx(
  tx: Tx, session: SessionRow, offer: { id: string; subjectId: string }, subjectRow: typeof subject.$inferSelect, draft: ItemDraft,
  audit: Record<string, unknown>, actorId: string, ctx?: AuditContext,
) {
  const id = await insertItem(tx, session, offer, subjectRow, draft, actorId);
  await logAction(actorId, 'OFFER_ITEM_CREATED', 'offer_item', id, null, audit, ctx, tx);
  return id;
}

async function itemForChange(tx: Tx, offerId: string, itemId: string) {
  const [i] = await tx.select().from(sessionOfferItem).where(and(eq(sessionOfferItem.id, itemId), eq(sessionOfferItem.offerId, offerId))).for('update');
  if (!i) throw new OfferError('That item is not under this subject', 404);
  return i;
}

/**
 * Change an item. A new series moves the item's live lines with it: refused once the series
 * they are in, or the one they would go to, is past a line's deadline (the entry is made, or
 * can no longer be), or when it would leave an open checkout paying for two deadlines (F0b's
 * guards); every line moved is audited.
 */
export async function updateItem(sessionId: string, offerId: string, itemId: string, data: UpdateOfferItemType, actorId: string, ctx?: AuditContext) {
  try {
    const out = await withStudentsFirst((extra) => db.transaction(async (tx) => {
      // A series change puts lines into a series: the students first (§6; lib/student-locks.ts).
      let locked = new Set<string>();
      if (data.boardSeriesId) {
        const students = await tx.selectDistinct({ id: registration.studentId }).from(registration)
          .where(and(eq(registration.offerItemId, itemId), inArray(registration.status, [...LIVE])));
        locked = await lockStudents(tx, [...students.map((s) => s.id), ...extra]);
      }
      const session = await sessionForChange(tx, sessionId);
      const { offer, subjectRow } = await offerForChange(tx, sessionId, offerId);
      const item = await itemForChange(tx, offerId, itemId);
      const { boardSeriesId } = data;
      const { lines: moved, repriced } = boardSeriesId && boardSeriesId !== item.boardSeriesId
        ? await changeItemSeries(tx, session, subjectRow, item, boardSeriesId, actorId, data.reason ?? null, locked, ctx)
        : { lines: [], repriced: [] as RepricedLine[] };
      const updated = await changeItemInTx(tx, offer, item, data, moved.length, actorId, ctx);
      return { item: { ...updated, linesMoved: moved.length, linesRepriced: repriced.length }, repriced };
    }));
    await tellPriceChanged(out.repriced, 'The subject is now entered in another exam series, with its own board fee');
    return out.item;
  } catch (err) {
    if (err instanceof OfferError) throw err;
    rethrow(err);
  }
}

/**
 * updateItem's change of an item the caller holds FOR UPDATE, after any series move (the item
 * endpoint and the form): its own teachers, fee keys and fields, with its audit row.
 */
async function changeItemInTx(
  tx: Tx, offer: { subjectId: string }, item: typeof sessionOfferItem.$inferSelect, data: UpdateOfferItemType, linesMoved: number,
  actorId: string, ctx?: AuditContext,
) {
  const itemId = item.id;
  const { reason, teachers, feeKeys, boardSeriesId, ...fields } = data;
  if (teachers !== undefined) await writeItemTeachers(tx, itemId, teachers?.length ? await resolveTeachers(tx, offer.subjectId, teachers, actorId) : []);
  if (feeKeys) await writeFeeKeys(tx, itemId, feeKeys);
  // The coordinator rework: the four cells follow the availability the deprecated route sets.
  const cells = fields.availability !== undefined || fields.needsPriorSeries !== undefined
    ? cellsOfAvailability((await tx.select({ a: sessionOffer.availability }).from(sessionOffer).where(eq(sessionOffer.id, item.offerId)))[0]?.a ?? 'open',
        fields.availability ?? item.availability, item.kind, fields.needsPriorSeries ?? item.needsPriorSeries)
    : {};
  const [updated] = await tx.update(sessionOfferItem).set({ ...fields, ...cells, updatedAt: new Date() }).where(eq(sessionOfferItem.id, itemId)).returning();
  await logAction(actorId, 'OFFER_ITEM_UPDATED', 'offer_item', itemId,
    { label: item.label, availability: item.availability, courseFee: item.courseFee, boardSeriesId: item.boardSeriesId, exclusiveGroup: item.exclusiveGroup, requiredInSeries: item.requiredInSeries },
    { ...fields, ...(boardSeriesId ? { boardSeriesId } : {}), ...(feeKeys ? { feeKeys } : {}), ...(teachers !== undefined ? { teachers } : {}), linesMoved, reason: reason ?? null }, ctx, tx);
  return updated!;
}

/** Move an item to another series of its board, with its live lines (in the caller's transaction). */
async function changeItemSeries(
  tx: Tx, session: SessionRow, subjectRow: typeof subject.$inferSelect, item: typeof sessionOfferItem.$inferSelect,
  targetId: string, actorId: string | null, reason: string | null, locked: Set<string>, ctx?: AuditContext,
) {
  return changeItemsSeries(tx, session, subjectRow, [{ item, targetId }], actorId, reason, locked, ctx);
}

type ItemMove = { item: typeof sessionOfferItem.$inferSelect; targetId: string };

/**
 * Move items of one subject to other series of its board, with their live lines, in the caller's
 * transaction — every move of one save at once (F6a's form; the item endpoint passes one), so the
 * order of RESERVATIONS.md §2.1 holds across them: the caller has taken the students, the session,
 * the offer and the items; then the series rows (FOR SHARE, id order), the fee grids of the target
 * series (shared) and the fee rows the items will read there (FOR SHARE, carried provisional where
 * finance has none) once for all moves, then every moving line in one statement (FOR UPDATE, id
 * order), then their entries (F4). Each item and each moved line keeps its own audit row.
 */
async function changeItemsSeries(
  tx: Tx, session: SessionRow, subjectRow: typeof subject.$inferSelect, moves: ItemMove[],
  actorId: string | null, reason: string | null, locked: Set<string>, ctx?: AuditContext,
) {
  if (!moves.length) return { lines: [] as (typeof registration.$inferSelect)[], repriced: [] as RepricedLine[] };
  const levels = new Map<string, string>();
  for (const m of moves) {
    levels.set(m.item.id, await levelOf(tx, subjectRow.qualificationLevel, {
      kind: m.item.entersKind, qualificationId: m.item.qualificationId, optionId: m.item.qualificationOptionId,
      unitIds: (await tx.select({ id: sessionOfferItemUnit.unitId }).from(sessionOfferItemUnit).where(eq(sessionOfferItemUnit.itemId, m.item.id))).map((u) => u.id),
    }));
  }
  const ids = [...new Set(moves.flatMap((m) => [m.targetId, ...(m.item.boardSeriesId ? [m.item.boardSeriesId] : [])]))].sort();
  await tx.select({ id: boardSeries.id }).from(boardSeries).where(inArray(boardSeries.id, ids)).orderBy(boardSeries.id).for('share');
  const targets = new Map<string, typeof boardSeries.$inferSelect>();
  for (const m of moves) targets.set(m.item.id, await assertItemSeriesFits(tx, session, subjectRow, levels.get(m.item.id)!, m.targetId));
  // The fee rows the items will read there (carried provisional from the series they are in where
  // finance has none), FOR SHARE before their lines — Confirm's order, so a Confirm of one either
  // lands first or waits for this move and then reaches the moved lines (the review of 40c1447).
  await lockMoveFeeRows(tx, moves.map((m) => ({ itemId: m.item.id, fromSeriesId: m.item.boardSeriesId, toSeriesId: m.targetId })), actorId, 'Its item moved to another series');
  const moveOf = new Map(moves.map((m) => [m.item.id, m]));
  const lines = await tx.select().from(registration)
    .where(and(inArray(registration.offerItemId, moves.map((m) => m.item.id)), inArray(registration.status, [...LIVE])))
    .orderBy(registration.id).for('update');
  // A line committed while this change waited for the item: its student was not locked first.
  assertStudentsLocked(locked, lines.map((l) => l.studentId));
  const now = new Date();
  const { names } = await boardNames(tx);
  // The entries already made stand: a line past its own deadline does not move.
  const current = await effectiveDeadlinesOf(tx, lines.map((l) => l.id));
  for (const l of lines) {
    const m = moveOf.get(l.offerItemId)!;
    const d = current.get(l.id)!;
    if (d.at && d.at <= now) {
      // In the form's words (the review of F6a, finding 4): reservations and sittings, not lines and series.
      throw new OfferError(`${itemDisplayLabel(m.item)} has reservations past their deadline in the sitting it is entered in (${schoolDate(d.at)}): their entries stand`, 409);
    }
    const there = await effectiveDeadlineFor(tx, { boardSeriesId: m.targetId, attempt: l.attempt, priorSittingSeriesId: l.priorSittingSeriesId, declarationRejected: l.declarationRejected });
    if (there.at && there.at <= now) {
      throw new OfferError(movePastDeadline(boardSeriesName(names, targets.get(m.item.id)!), there), 409);
    }
  }
  // F4's entries of the lines (after the lines, §2.1): a sent one refuses the change, the drafts are
  // withdrawn with it and made again in the target series (the review of 426d565, item 2).
  const sent = await entriesFollowMoveInTx(tx, lines.map((l) => l.id), "the line's item moved to another series", actorId, ctx);
  if (sent) throw new OfferError(sent, 409);
  for (const m of moves) {
    await attachSeries(tx, session.id, m.targetId, actorId);
    await tx.update(sessionOfferItem).set({ boardSeriesId: m.targetId, updatedAt: now }).where(eq(sessionOfferItem.id, m.item.id));
  }
  for (const l of lines) await tx.update(registration).set({ boardSeriesId: moveOf.get(l.offerItemId)!.targetId, updatedAt: now }).where(eq(registration.id, l.id));
  // Each student's lines checked again where they now are (§6): the same entry once in the target
  // series (any entry key, an unmapped row's too), its required items, the carry-forward period.
  await moveRules(() => recheckLines(tx, lines.map((l) => l.id)));
  // What they cost there: the new series' fee rows, held since before the lines.
  const repriced = await moveRules(() => repriceMovedLines(tx, lines.map((l) => l.id), actorId, 'its item moved to another series'));
  const spanning = await openCheckoutsSpanningDeadlines(tx, { registrationIds: lines.map((l) => l.id) });
  if (spanning > 0) {
    throw new OfferError(`${spanning} checkout${spanning === 1 ? '' : 's'} still open would pay for two deadlines after this move — confirm or cancel ${spanning === 1 ? 'it' : 'them'} first`, 409);
  }
  for (const m of moves) {
    await logAction(actorId, 'OFFER_ITEM_SERIES_CHANGED', 'offer_item', m.item.id, { boardSeriesId: m.item.boardSeriesId },
      { boardSeriesId: m.targetId, linesMoved: lines.filter((l) => l.offerItemId === m.item.id).length, reason }, undefined, tx);
  }
  await logActions(lines.map((l) => ({
    userId: actorId, action: 'LINE_SERIES_MOVED' as const, entityType: 'registration' as const, entityId: l.id,
    previousData: { boardSeriesId: l.boardSeriesId }, newData: { boardSeriesId: moveOf.get(l.offerItemId)!.targetId, offerItemId: l.offerItemId, reason },
  })), tx);
  await redateLines(tx, lines.map((l) => l.id), actorId, 'its item moved to another series');
  await detachUnusedSeries(tx, session.id);
  return { lines, repriced };
}

/** A reservation that cannot move to a sitting whose deadline for it has passed (the form's words). */
function movePastDeadline(sitting: string, d: { at: Date | null; kind: string | null }) {
  const when = d.at ? schoolDate(d.at) : '';
  if (d.kind === 'retake') return `A reservation cannot move to ${sitting}: the board's retake deadline there (${when}) has passed`;
  if (d.kind === 'exams_start') return `A reservation cannot move to ${sitting}: its exams start on ${when} and it has no entry deadline`;
  return `A reservation cannot move to ${sitting}: the board's entry deadline there (${when}) has passed`;
}

/** A rule or a missing fee refusing a move, as the screen's refusal (409). */
async function moveRules<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof LineRuleError || err instanceof PricingError) throw new OfferError(err.message, 409);
    throw err;
  }
}

/** How many of these lines (counted per status) are live: not rejected, expired or dropped. */
function liveOf(counts: { status: string; n: number }[]) {
  return counts.filter((c) => !(DONE as readonly string[]).includes(c.status)).reduce((a, c) => a + c.n, 0);
}

/** The live lines of each item (deleteItem's count; the form's "Its N reservations stand"). */
async function liveLinesByItem(tx: Tx, itemIds: string[]) {
  const out = new Map<string, number>();
  if (!itemIds.length) return out;
  const rows = await tx.select({ itemId: registration.offerItemId, status: registration.status, n: sql<number>`count(*)::int` }).from(registration)
    .where(inArray(registration.offerItemId, itemIds)).groupBy(registration.offerItemId, registration.status);
  for (const id of itemIds) out.set(id, liveOf(rows.filter((r) => r.itemId === id)));
  return out;
}

/**
 * Untick an item: refused while it has live lines; with only history it is closed (kept for the
 * history); with none it is removed.
 */
export async function deleteItem(sessionId: string, offerId: string, itemId: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    await sessionForChange(tx, sessionId);
    await offerForChange(tx, sessionId, offerId);
    const item = await itemForChange(tx, offerId, itemId);
    const counts = await tx.select({ status: registration.status, n: sql<number>`count(*)::int` }).from(registration)
      .where(eq(registration.offerItemId, itemId)).groupBy(registration.status);
    const live = liveOf(counts);
    if (live) throw new OfferError(`${item.label} has ${live} live line${live === 1 ? '' : 's'}: move or drop ${live === 1 ? 'it' : 'them'} first`, 409);
    if (counts.length) {
      await tx.update(sessionOfferItem).set({ availability: 'closed', ...NO_CELLS, updatedAt: new Date() }).where(eq(sessionOfferItem.id, itemId));
      await logAction(actorId, 'OFFER_ITEM_UPDATED', 'offer_item', itemId, { availability: item.availability }, { availability: 'closed', reason: 'Unticked: kept closed for its history' }, ctx, tx);
      return { closed: itemId };
    }
    await tx.delete(sessionOfferItem).where(eq(sessionOfferItem.id, itemId));
    await detachUnusedSeries(tx, sessionId);
    await logAction(actorId, 'OFFER_ITEM_DELETED', 'offer_item', itemId, { offerId, label: item.label, boardSeriesId: item.boardSeriesId }, null, ctx, tx);
    return { deleted: itemId };
  });
}

// ─── One subject's form (F6a, docs/features/SESSION_WORDS.md) ───────────────

/** A set of teachers as the form names it, each with its mode, in order: equal when every id and mode match. */
function sameTeachers(a: { teacherId: string; mode: string }[], b: { teacherId: string; mode: string }[]) {
  return a.length === b.length && a.every((t, i) => t.teacherId === b[i]!.teacherId && t.mode === b[i]!.mode);
}

/**
 * The teachers a form names, read without writing: an external team named for the first time has
 * no id yet (null: a change). Duplicates collapse as resolveTeachers collapses them.
 */
async function readTeachers(tx: Tx, inputs: OfferTeacherInputType[]): Promise<{ teacherId: string; mode: string }[] | null> {
  const out: { teacherId: string; mode: string }[] = [];
  for (const t of inputs) {
    let id: string | undefined;
    if ('teacherId' in t) id = t.teacherId;
    else {
      const [p] = await tx.select({ id: teacher.id }).from(teacher).where(and(eq(teacher.kind, 'provider'), sql`lower(${teacher.name}) = lower(${t.providerName})`));
      if (!p) return null;
      id = p.id;
    }
    if (!out.some((o) => o.teacherId === id)) out.push({ teacherId: id, mode: t.mode });
  }
  return out;
}

/** "Its N reservations stand": the refusal of a close that would stop a subject, paper or unit with reservations. */
export function linesStandRefusal(name: string, live: number) {
  return `${name} has ${live} reservation${live === 1 ? '' : 's'}: ${live === 1 ? 'it stands' : 'they stand'} when it is not offered this cycle, and no new one is taken. Tick "Its ${live === 1 ? 'reservation stands' : `${live} reservations stand`}" to save`;
}

/**
 * Save one subject's form (F6a; PUT /sessions/:id/offers/:offerId/form): the teachers, how it is
 * offered, the course fee, its papers, routes, units and qualifications (each offered or not, its
 * fee, its teachers, its sitting), the grade-10 core, the course start and the notes — in one
 * transaction, through the offer and item services' own logic (changeOfferInTx is updateOffer's,
 * changeItemInTx updateItem's, changeItemsSeries the series move's, createItemInTx createItem's, the
 * live count deleteItem's), refusing what they refuse, in RESERVATIONS.md §2.1's order:
 *
 *   1. the students of the lines a sitting change moves (FOR NO KEY UPDATE, id order), first;
 *   2. the session FOR SHARE; 3. the offer FOR UPDATE; 4. the subject's items FOR UPDATE, id order;
 *   5. a sitting change: the series rows FOR SHARE, the target fee grids shared and fee rows
 *      FOR SHARE, then the moving lines FOR UPDATE (changeItemsSeries).
 *
 * Only what differs is written, each change with its audit row in this transaction; a form that
 * changes nothing writes nothing (no audit row). Closing a subject, paper or unit that has
 * reservations is refused unless `linesStand` says they stand.
 */
export async function saveOfferForm(sessionId: string, offerId: string, form: OfferFormType, actorId: string, ctx?: AuditContext) {
  const ids = form.items.map((i) => i.itemId).filter((x): x is string => !!x);
  const paperUnitIds = form.items.map((i) => i.paperUnitId).filter((x): x is string => !!x);
  if (new Set(ids).size !== ids.length || new Set(paperUnitIds).size !== paperUnitIds.length) {
    throw new OfferError('A paper or unit is named twice in the form');
  }
  try {
    const out = await withStudentsFirst((extra) => db.transaction(async (tx) => {
      // 1. The students of the lines a sitting change would move, read before the locks and checked
      //    again under them (changeItemsSeries refuses a student it finds unlocked: run again).
      const [pre] = await tx.select({ sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear })
        .from(registrationSession).where(eq(registrationSession.id, sessionId));
      const sitting = (month: SeriesMonth) => (pre ? sessionSeriesMonths(pre.sessionType, pre.seriesYear).find((m) => m.month === month) ?? null : null);
      const preItems = ids.length
        ? await tx.select({ id: sessionOfferItem.id, month: boardSeries.month, year: boardSeries.year }).from(sessionOfferItem)
            .leftJoin(boardSeries, eq(boardSeries.id, sessionOfferItem.boardSeriesId))
            .where(and(eq(sessionOfferItem.offerId, offerId), inArray(sessionOfferItem.id, ids)))
        : [];
      const mayMove = form.items.filter((f) => {
        if (!f.itemId || !f.seriesMonth) return false;
        const it = preItems.find((x) => x.id === f.itemId);
        const want = sitting(f.seriesMonth);
        return !!it && !!want && !(it.month === want.month && it.year === want.year);
      }).map((f) => f.itemId!);
      const students = mayMove.length
        ? await tx.selectDistinct({ id: registration.studentId }).from(registration)
            .where(and(inArray(registration.offerItemId, mayMove), inArray(registration.status, [...LIVE])))
        : [];
      const locked = await lockStudents(tx, [...students.map((x) => x.id), ...extra]);
      // 2–4. The session, the offer, its items.
      const session = await sessionForChange(tx, sessionId);
      const { offer, subjectRow } = await offerForChange(tx, sessionId, offerId);
      const items = await tx.select().from(sessionOfferItem).where(eq(sessionOfferItem.offerId, offerId)).orderBy(sessionOfferItem.id).for('update');
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const id of ids) if (!byId.has(id)) throw new OfferError('That paper or unit is not under this subject', 404);
      const live = await liveLinesByItem(tx, items.map((i) => i.id));
      const ialUnits = await cashInUnitItems(tx, items.map((i) => i.id));
      const done = { offer: false, itemsChanged: 0, itemsCreated: 0, linesMoved: 0 };

      // (a)–(c), (f)–(h): the subject's own answers, only those that differ (updateOffer's logic).
      const change: UpdateOfferType = {};
      const currentTeachers = await tx.select().from(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, offerId)).orderBy(sessionOfferTeacher.sortOrder);
      const named = await readTeachers(tx, form.teachers);
      if (!named || !sameTeachers(named, currentTeachers)) change.teachers = form.teachers;
      if (form.availability !== offer.availability) change.availability = form.availability;
      if (form.courseFee !== Number(offer.courseFee)) change.courseFee = form.courseFee;
      if (form.grade10Core !== offer.grade10Core) change.grade10Core = form.grade10Core;
      if ((form.courseStartsOn ?? null) !== (offer.courseStartsOn ?? null)) change.courseStartsOn = form.courseStartsOn;
      const notes = form.notes?.trim() || null;
      if (notes !== (offer.notes ?? null)) change.notes = notes;
      if (Object.keys(change).length) {
        // "Not offered this cycle" while it has reservations: said, not silent.
        const reserved = [...live.values()].reduce((a, n) => a + n, 0);
        if (change.availability === 'closed' && reserved > 0 && !form.linesStand) throw new OfferError(linesStandRefusal(subjectRow.name, reserved), 409);
        if (form.zeroFeeReason) change.zeroFeeReason = form.zeroFeeReason;
        if (form.reason) change.reason = form.reason;
        await changeOfferInTx(tx, offer, subjectRow, change, actorId, ctx);
        done.offer = true;
      }

      // (d), (e): each paper, route, unit or qualification the form shows.
      const moves: ItemMove[] = [];
      const itemChanges: { item: typeof sessionOfferItem.$inferSelect; data: UpdateOfferItemType }[] = [];
      for (const f of form.items.filter((x) => x.itemId)) {
        const item = byId.get(f.itemId!)!;
        const data: UpdateOfferItemType = {};
        if (f.availability !== item.availability) data.availability = f.availability;
        if ((f.courseFee ?? null) !== (item.courseFee === null ? null : Number(item.courseFee))) data.courseFee = f.courseFee;
        if (f.teachers !== undefined) {
          const own = await tx.select().from(sessionOfferItemTeacher).where(eq(sessionOfferItemTeacher.itemId, item.id)).orderBy(sessionOfferItemTeacher.sortOrder);
          const want = await readTeachers(tx, f.teachers ?? []);
          if (!want || !sameTeachers(want, own)) data.teachers = f.teachers?.length ? f.teachers : null;
        }
        if (data.availability === 'closed' && (live.get(item.id) ?? 0) > 0 && !form.linesStand) {
          throw new OfferError(linesStandRefusal(`${subjectRow.name} — ${item.label}`, live.get(item.id)!), 409);
        }
        if (f.seriesMonth) {
          // The session as locked (a series correction may have committed since the read above).
          const want = sessionSeriesMonths(session.sessionType, session.seriesYear).find((m) => m.month === f.seriesMonth) ?? null;
          if (!want) throw new OfferError(`${SERIES_MONTH_LABELS[f.seriesMonth]} is not a sitting of this session`);
          const [now] = item.boardSeriesId ? await tx.select().from(boardSeries).where(eq(boardSeries.id, item.boardSeriesId)) : [];
          if (!now || now.month !== want.month || now.year !== want.year) {
            // An IAL unit sits in October, January or June (decision 2 of 16 Oct 2026): a move to another month is refused.
            if (ialUnits.has(item.id) && !IAL_UNIT_MONTHS.includes(want.month)) {
              throw new OfferError(`${subjectRow.name} — ${item.label}: an IAL unit sits in October, January or June, not ${SERIES_MONTH_LABELS[want.month]}`);
            }
            const target = await findOrCreateSeries(tx, subjectRow.council, want.month, want.year, '', actorId);
            moves.push({ item, targetId: target.id });
            data.boardSeriesId = target.id;
          }
        }
        if (Object.keys(data).length) itemChanges.push({ item, data: form.reason ? { ...data, reason: form.reason } : data });
      }
      // A sitting change moves the items with their reservations, every move at once (§2.1).
      const { lines: moved, repriced } = await changeItemsSeries(tx, session, subjectRow, moves, actorId, form.reason ?? null, locked, ctx);
      done.linesMoved = moved.length;
      for (const c of itemChanges) {
        await changeItemInTx(tx, offer, c.item, c.data, moved.filter((l) => l.offerItemId === c.item.id).length, actorId, ctx);
        done.itemsChanged++;
      }

      // (d) A paper the catalogue gives the subject that is not on the sheet yet: made when offered (createItem's logic).
      const papers = form.items.filter((x) => x.paperUnitId);
      if (papers.length) {
        const drafts = (await generateItems(tx, subjectRow.id)).filter((d) => d.kind === 'one_paper' && d.enters.kind === 'units');
        const units = await tx.select().from(sessionOfferItemUnit).where(inArray(sessionOfferItemUnit.itemId, items.map((i) => i.id).concat('__none__')));
        // "All papers" and "Paper N only" are one or the other (withOnePaper's group): a whole item made
        // before the Catalogue gave the subject papers has no group, so it joins the paper's — through
        // updateItem's logic, with its audit row — before the first paper is made.
        const wholes = items.filter((i) => i.kind === 'all_papers');
        const group = wholes.find((w) => w.exclusiveGroup)?.exclusiveGroup ?? 'entry';
        let grouped = false;
        for (const f of papers) {
          const draft = drafts.find((d) => d.enters.kind === 'units' && d.enters.unitIds.length === 1 && d.enters.unitIds[0] === f.paperUnitId);
          if (!draft) throw new OfferError("That paper is not one of this subject's papers on the Catalogue", 404);
          // Already on the sheet (the same form sent twice): nothing to make.
          const has = items.find((i) => i.kind === 'paper' && units.filter((u) => u.itemId === i.id).map((u) => u.unitId).join() === f.paperUnitId);
          if (has || f.availability === 'closed') continue;
          if (!grouped) {
            for (const w of wholes.filter((x) => !x.exclusiveGroup)) {
              await changeItemInTx(tx, offer, w, { exclusiveGroup: group, reason: 'A paper of the subject is offered on its own: all papers or that paper, not both' }, 0, actorId, ctx);
              done.itemsChanged++;
            }
            grouped = true;
          }
          await createItemInTx(tx, session, offer, subjectRow, { ...draft, exclusiveGroup: group, availability: f.availability, courseFee: f.courseFee },
            { offerId, label: draft.label, kind: draft.kind, enters: draft.enters, availability: f.availability, courseFee: f.courseFee, exclusiveGroup: group, via: 'form' }, actorId, ctx);
          done.itemsCreated++;
        }
      }
      return { done, repriced };
    }));
    await tellPriceChanged(out.repriced, 'The subject is now entered in another exam series, with its own board fee');
    return { ...out.done, changed: out.done.offer || out.done.itemsChanged > 0 || out.done.itemsCreated > 0 };
  } catch (err) {
    if (err instanceof OfferError) throw err;
    rethrow(err);
  }
}

// ─── Replace a teacher (§4.2) ────────────────────────────────────────────────

/**
 * A teacher who leaves: every item and offer naming them, every live in-school line of the offer
 * naming them, and this academic year's open enrolments of those students in the subject move to
 * the other teacher, audited.
 *
 * The students of those lines are locked first (RESERVATIONS.md §2.1; lib/student-locks.ts): the
 * enrolments and teaching groups that follow are the students' (a leaving, a cohort correction, a
 * move into a group hold the student first), so this change takes them before the session, the
 * offer and the lines. A line made for a new student while it waited runs it again with that
 * student locked first.
 */
export async function replaceTeacher(sessionId: string, offerId: string, data: ReplaceOfferTeacherType, actorId: string, ctx?: AuditContext) {
  return withStudentsFirst((extra) => db.transaction(async (tx) => {
    const seen = await tx.selectDistinct({ id: registration.studentId }).from(registration)
      .innerJoin(sessionOfferItem, eq(sessionOfferItem.id, registration.offerItemId))
      .where(and(eq(sessionOfferItem.offerId, offerId), eq(registration.teacherId, data.fromTeacherId), inArray(registration.status, [...LIVE])));
    const locked = await lockStudents(tx, [...seen.map((x) => x.id), ...extra]);
    const session = await sessionForChange(tx, sessionId);
    const { offer } = await offerForChange(tx, sessionId, offerId);
    if (data.fromTeacherId === data.toTeacherId) throw new OfferError('Choose another teacher to replace them with');
    const [to] = await tx.select().from(teacher).where(eq(teacher.id, data.toTeacherId));
    if (!to) throw new OfferError('Teacher not found', 404);
    if (!to.isActive) throw new OfferError(`${to.name} is inactive`);
    const items = await tx.select({ id: sessionOfferItem.id, entersKind: sessionOfferItem.entersKind }).from(sessionOfferItem).where(eq(sessionOfferItem.offerId, offerId));
    const itemIds = items.map((i) => i.id);
    const onOffer = await tx.select().from(sessionOfferTeacher).where(and(eq(sessionOfferTeacher.offerId, offerId), eq(sessionOfferTeacher.teacherId, data.fromTeacherId)));
    const onItems = itemIds.length
      ? await tx.select().from(sessionOfferItemTeacher).where(and(inArray(sessionOfferItemTeacher.itemId, itemIds), eq(sessionOfferItemTeacher.teacherId, data.fromTeacherId)))
      : [];
    const lines = itemIds.length
      ? await tx.select({ id: registration.id, studentId: registration.studentId, offerItemId: registration.offerItemId }).from(registration)
          .where(and(inArray(registration.offerItemId, itemIds), eq(registration.teacherId, data.fromTeacherId), inArray(registration.status, [...LIVE])))
          .orderBy(registration.id).for('update')
      : [];
    // A line committed while this change waited for the offer: its student was not locked first.
    assertStudentsLocked(locked, lines.map((l) => l.studentId));
    if (!onOffer.length && !onItems.length && !lines.length) throw new OfferError('That teacher does not teach this subject in this session', 404);
    await tx.insert(subjectTeacher).values({ id: randomUUID(), subjectId: offer.subjectId, teacherId: to.id }).onConflictDoNothing();
    for (const t of onOffer) {
      await tx.delete(sessionOfferTeacher).where(eq(sessionOfferTeacher.id, t.id));
      await tx.insert(sessionOfferTeacher).values({ id: randomUUID(), offerId, teacherId: to.id, mode: t.mode, sortOrder: t.sortOrder }).onConflictDoNothing();
    }
    for (const t of onItems) {
      await tx.delete(sessionOfferItemTeacher).where(eq(sessionOfferItemTeacher.id, t.id));
      await tx.insert(sessionOfferItemTeacher).values({ id: randomUUID(), itemId: t.itemId, teacherId: to.id, mode: t.mode, sortOrder: t.sortOrder }).onConflictDoNothing();
    }
    const now = new Date();
    if (lines.length) {
      await tx.update(registration).set({ teacherId: to.id, updatedAt: now }).where(inArray(registration.id, lines.map((l) => l.id)));
      await logActions(lines.map((l) => ({
        userId: actorId, action: 'LINE_TEACHER_REPLACED' as const, entityType: 'registration' as const, entityId: l.id,
        previousData: { teacherId: data.fromTeacherId }, newData: { teacherId: to.id, reason: data.reason },
      })), tx);
    }
    // The enrolment follows (§10), per what each replaced line is taught as (§2.11): this year's open
    // enrolment of the student in each unit its item enters, or in the subject for an item entering
    // no units — not the student's other units of the subject, taught through another session; for a
    // converted item entering all the subject's units over an enrolment from before the rework (no
    // unit), the subject's own row (`lineEnrolmentUnits`). Through F0b's upsertEnrolments with
    // `follow` (F1, RESERVATIONS_REWORK.md §10): each moved enrolment audited, and the teaching
    // groups follow in this transaction — a group whose every member moves takes the new teacher.
    const ay = await tx.execute(sql`select id from academic_year where start_year = school_series_academic_year_start(${session.sessionType}, ${session.seriesYear})`);
    const yearId = (ay.rows[0] as { id: string } | undefined)?.id;
    let enrolmentsMoved = 0;
    let groupsFollowed: Awaited<ReturnType<typeof upsertEnrolments>>['groupsFollowed'] = null;
    if (yearId && lines.length) {
      const unitItems = items.filter((i) => i.entersKind === 'units').map((i) => i.id);
      const unitsOf = new Map<string, string[]>();
      if (unitItems.length) {
        for (const u of await tx.select().from(sessionOfferItemUnit).where(inArray(sessionOfferItemUnit.itemId, unitItems))) {
          unitsOf.set(u.itemId, [...(unitsOf.get(u.itemId) ?? []), u.unitId]);
        }
      }
      const done = new Set<string>();
      const rows: EnrolmentRowInput[] = [];
      for (const l of lines) {
        const units = unitsOf.get(l.offerItemId) ?? [];
        const key = `${l.studentId}|${units.join(',')}`;
        if (done.has(key)) continue;
        done.add(key);
        const keys = await lineEnrolmentUnits(tx, yearId, l.studentId, offer.subjectId, units);
        const open = await tx.select().from(courseEnrolment).where(and(
          eq(courseEnrolment.academicYearId, yearId), eq(courseEnrolment.subjectId, offer.subjectId), eq(courseEnrolment.teacherId, data.fromTeacherId),
          isNull(courseEnrolment.endedOn), eq(courseEnrolment.studentId, l.studentId),
          keys.includes(null) ? isNull(courseEnrolment.unitId) : inArray(courseEnrolment.unitId, keys.filter((k): k is string => !!k)),
        ));
        for (const e of open) {
          rows.push({ studentId: e.studentId, subjectId: e.subjectId, unitId: e.unitId, teacherId: to.id, mode: e.mode as 'in_school' | 'self_study', sourceRef: `replace-teacher:${offerId}` });
        }
      }
      if (rows.length) {
        // The students are held already (taken first, above): upsertEnrolments' own lock on them is theirs again.
        const r = await upsertEnrolments(tx, yearId, rows, actorId, { source: 'registrations', commit: true, ctx, follow: true, reason: data.reason });
        enrolmentsMoved = r.updated;
        groupsFollowed = r.groupsFollowed;
      }
    }
    await logAction(actorId, 'SESSION_OFFER_TEACHER_REPLACED', 'session_offer', offerId, { teacherId: data.fromTeacherId },
      { teacherId: to.id, reason: data.reason, items: onItems.length, lines: lines.length, enrolments: enrolmentsMoved }, ctx, tx);
    return { lines: lines.length, items: onItems.length, enrolments: enrolmentsMoved, groupsFollowed };
  })).then(async (r) => {
    // After the commit: the cover a group's new teacher made no longer holding is told (F1).
    await groupFollowNotices(r.groupsFollowed);
    return r;
  });
}

// ─── Copy from an earlier session (§4.1) ─────────────────────────────────────

/** The series in this session that corresponds to an earlier session's series (same board, month, label). */
async function correspondingSeries(tx: Tx, session: SessionRow, fromSeries: typeof boardSeries.$inferSelect, actorId: string | null) {
  const months = sessionSeriesMonths(session.sessionType, session.seriesYear);
  const m = months.find((x) => x.month === fromSeries.month);
  if (!m) return null;
  return (await findOrCreateSeries(tx, fromSeries.boardCode, m.month, m.year, fromSeries.label, actorId)).id;
}

/**
 * Copy an earlier session's open offers into this one (those it has already are kept): their
 * teachers, items, availability and course fees; each item's series is the corresponding one of
 * this session, and the board fees come across provisional (§4.1).
 */
export async function copyOffersFrom(tx: Tx, session: SessionRow, fromSessionId: string, actorId: string | null) {
  const [from] = await tx.select().from(registrationSession).where(eq(registrationSession.id, fromSessionId));
  if (!from) throw new OfferError('The session to copy from was not found', 404);
  if (from.id === session.id) throw new OfferError('Choose another session to copy from');
  if (from.sessionType !== session.sessionType) throw new OfferError('Copy from a session of the same kind (June from June, winter from winter)');
  // A session converted while closed had its offers and items closed with it (migration 0042),
  // not by choice: they come across as their subject allows. An offer the school closed itself
  // stays behind.
  const closedByConversion = (row: { availability: string; legacy: unknown }) =>
    from.status === 'closed' && row.availability === 'closed' && (row.legacy as { converted?: boolean; no_series?: boolean } | null)?.converted === true
    && !(row.legacy as { no_series?: boolean; not_routed?: boolean }).no_series && !(row.legacy as { not_routed?: boolean }).not_routed;
  const offers = (await tx.select().from(sessionOffer).where(eq(sessionOffer.sessionId, from.id)).orderBy(sessionOffer.sortOrder, sessionOffer.id))
    .filter((o) => o.availability !== 'closed' || closedByConversion(o));
  const have = new Set((await tx.select({ subjectId: sessionOffer.subjectId }).from(sessionOffer).where(eq(sessionOffer.sessionId, session.id))).map((o) => o.subjectId));
  let copied = 0;
  let feesCopied = 0;
  const feesToCopy: { seriesId: string; src: typeof boardFee.$inferSelect }[] = [];
  let closedNoTeacher = 0;
  const closedNoFee: string[] = [];
  // Self-study only at a course fee of 0 comes across as it is, with the reason the rule asks for
  // recorded on the copy's audit row (the review of 2ca07a4's round, item 3): an offer converted while
  // closed never had one asked.
  const zeroFeeSelfStudy: { subject: string; reason: string }[] = [];
  for (const o of offers) {
    if (have.has(o.subjectId)) continue;
    const [s] = await tx.select().from(subject).where(eq(subject.id, o.subjectId));
    if (!s || !s.isActive) continue;
    const offerId = randomUUID();
    const ts = await tx.select().from(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, o.id));
    const activeTeachers = ts.length ? await tx.select({ id: teacher.id }).from(teacher).where(and(inArray(teacher.id, ts.map((t) => t.teacherId)), eq(teacher.isActive, true))) : [];
    const keep = ts.filter((t) => activeTeachers.some((a) => a.id === t.teacherId));
    const wanted = closedByConversion(o) ? (s.isOfferedAtSchool ? 'open' : 'self_study_only') : o.availability;
    // "Who teaches it?" (§3.2): an open subject with no active teacher comes across closed, to be
    // opened once it names one — never open with nobody to teach it.
    const taught = wanted === 'open' && keep.length === 0 ? 'closed' : wanted;
    if (taught !== wanted) closedNoTeacher++;
    // MO-9 (the lead's call on F7's review of 2ca07a4, item 2): an offer it would open at a course fee of
    // 0 that is not self-study only comes across closed, named in the summary, to be opened once the
    // school sets its fee.
    const availability = taught !== 'closed' && taught !== 'self_study_only' && !(Number(o.courseFee) > 0) ? 'closed' : taught;
    if (availability !== taught) closedNoFee.push(s.name);
    if (availability === 'self_study_only' && !(Number(o.courseFee) > 0)) {
      zeroFeeSelfStudy.push({ subject: s.name, reason: `${closedByConversion(o) ? 'converted' : 'copied'} from ${from.name}; priced at the board fee alone` });
    }
    await tx.insert(sessionOffer).values({
      id: offerId, sessionId: session.id, subjectId: o.subjectId, availability, accepting: availability !== 'closed', courseFee: o.courseFee,
      grade10Core: o.grade10Core, notes: o.notes, sortOrder: o.sortOrder, createdBy: actorId,
    });
    if (keep.length) await tx.insert(sessionOfferTeacher).values(keep.map((t) => ({ id: randomUUID(), offerId, teacherId: t.teacherId, mode: t.mode, sortOrder: t.sortOrder })));
    const items = (await tx.select().from(sessionOfferItem).where(eq(sessionOfferItem.offerId, o.id)).orderBy(sessionOfferItem.sortOrder, sessionOfferItem.id))
      .filter((it) => it.availability !== 'closed' || closedByConversion(it));
    for (const it of items) {
      if (!it.boardSeriesId) continue;
      const [fs] = await tx.select().from(boardSeries).where(eq(boardSeries.id, it.boardSeriesId));
      const seriesId = fs ? await correspondingSeries(tx, session, fs, actorId) : null;
      if (!seriesId) continue;
      await attachSeries(tx, session.id, seriesId, actorId);
      const id = randomUUID();
      const itemAvailability = closedByConversion(it) ? wanted : it.availability;
      await tx.insert(sessionOfferItem).values({
        id, offerId, sessionId: session.id, label: it.label, kind: it.kind, entersKind: it.entersKind, qualificationId: it.qualificationId,
        qualificationOptionId: it.qualificationOptionId, boardSeriesId: seriesId, availability: itemAvailability, courseFee: it.courseFee,
        needsPriorSeries: it.needsPriorSeries, requiredInSeries: it.requiredInSeries, exclusiveGroup: it.exclusiveGroup, sortOrder: it.sortOrder, createdBy: actorId,
        ...cellsOfAvailability(availability, itemAvailability, it.kind, it.needsPriorSeries),
      });
      const us = await tx.select().from(sessionOfferItemUnit).where(eq(sessionOfferItemUnit.itemId, it.id));
      if (us.length) await tx.insert(sessionOfferItemUnit).values(us.map((u) => ({ itemId: id, unitId: u.unitId })));
      const keys = await tx.select().from(sessionOfferItemFeeKey).where(eq(sessionOfferItemFeeKey.itemId, it.id));
      await writeFeeKeys(tx, id, keys.map((k) => ({ kind: k.keyKind as FeeKeyInputType['kind'], id: k.keyId })));
      const its = await tx.select().from(sessionOfferItemTeacher).where(eq(sessionOfferItemTeacher.itemId, it.id));
      const itsActive = its.length ? await tx.select({ id: teacher.id }).from(teacher).where(and(inArray(teacher.id, its.map((t) => t.teacherId)), eq(teacher.isActive, true))) : [];
      await writeItemTeachers(tx, id, its.filter((t) => itsActive.some((a) => a.id === t.teacherId)).map((t) => ({ teacherId: t.teacherId, mode: t.mode as 'in_school' | 'online' })));
      // The fee rows the item reads, copied provisional where this series has none yet (below).
      for (const k of keys) {
        const [src] = await tx.select().from(boardFee).where(and(eq(boardFee.boardSeriesId, it.boardSeriesId), eq(boardFee.keyKind, k.keyKind), eq(boardFee.keyId, k.keyId)));
        if (src) feesToCopy.push({ seriesId, src });
      }
    }
    copied++;
  }
  // The fees, once the series' fee grids are held exclusive in id order (§2.1: a fee row is
  // created in a series only while no move into it is under way).
  await lockFeeGrids(tx, feesToCopy.map((f) => f.seriesId), 'exclusive');
  for (const { seriesId, src } of feesToCopy) {
    const made = await tx.insert(boardFee).values({
      id: randomUUID(), boardSeriesId: seriesId, keyKind: src.keyKind, unitId: src.unitId, qualificationOptionId: src.qualificationOptionId,
      qualificationId: src.qualificationId, subjectId: src.subjectId, amount: src.amount, provisional: true, confirmedAt: null,
      zeroReason: src.zeroReason, copiedFromFeeId: src.id, createdBy: actorId,
    }).onConflictDoNothing().returning({ id: boardFee.id });
    feesCopied += made.length;
  }
  await logAction(actorId, 'SESSION_COPIED', 'session', session.id, null,
    { fromSessionId: from.id, from: from.name, offers: copied, feesCopiedProvisional: feesCopied, closedNoTeacher, closedNoFee, zeroFeeSelfStudy }, undefined, tx);
  return { offers: copied, feesCopied, closedNoTeacher, closedNoFee, zeroFeeSelfStudy };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * The item a path that still names subjects reserves (docs/features/RESERVATIONS.md §2.4): the
 * subject's whole item in the session — an open one first, then one whose series is set.
 */
export async function resolveItem(executor: Executor, sessionId: string, subjectId: string) {
  const [o] = await executor.select({ offer: sessionOffer, subjectName: subject.name }).from(sessionOffer)
    .innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .where(and(eq(sessionOffer.sessionId, sessionId), eq(sessionOffer.subjectId, subjectId)));
  if (!o) {
    const [s] = await executor.select({ name: subject.name }).from(subject).where(eq(subject.id, subjectId));
    throw new OfferError(s ? `${s.name} is not offered in this session` : 'One or more subjects are invalid or inactive');
  }
  const items = await executor.select().from(sessionOfferItem)
    .where(and(eq(sessionOfferItem.offerId, o.offer.id), eq(sessionOfferItem.kind, 'all_papers')))
    .orderBy(sql`${sessionOfferItem.availability} = 'closed'`, sql`${sessionOfferItem.boardSeriesId} is null`, sessionOfferItem.id);
  const item = items[0];
  if (!item) throw new OfferError(`${o.subjectName} is reserved by unit or route in this session: choose them on the reservation page`);
  return { item, offer: o.offer, subjectName: o.subjectName };
}

// ─── Finding what a sheet's words name (F7's contract, RESERVATIONS_REWORK.md §10) ───

const words = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
/** "Unit 3" and "Paper 3" are one name (the school writes Pearson's units as papers). */
const paperName = (n: string) => `paper ${n.toLowerCase()}`;
/**
 * The codes a sheet's words name, each once, in order: in brackets ("Pure Mathematics 1 (P1)",
 * "Biology (Paper 3 & Paper 4)") or on their own ("P1", "WMA11", "Paper 4", "Unit 3", "1H"); a paper
 * or a unit named by its number reads as "paper N".
 */
export function namedCodes(term: string): string[] {
  const t = words(term);
  const out: string[] = [];
  const add = (c: string) => {
    const m = /^(?:paper|unit)\s*(\d+[a-z]?)$/.exec(c);
    const code = m ? paperName(m[1]!) : c;
    if (code && !out.includes(code)) out.push(code);
  };
  for (const m of t.matchAll(/\(([^)]+)\)/g)) for (const part of m[1]!.split(/\s*(?:&|\band\b|,|\/|\+)\s*/)) if (part.trim()) add(part.trim());
  for (const m of t.matchAll(/\b((?:p|m|s|d|fp)\d|w[a-z]{2}\d{2}|\d[a-z]{1,3}\d[a-z]?)\b/g)) add(m[1]!);
  for (const m of t.matchAll(/\b(?:paper|unit)s?\s*(\d+[a-z]?)\b/g)) add(paperName(m[1]!));
  // "Papers 3 & 4", "Units 1, 2": the numbers after the word.
  for (const m of t.matchAll(/\b(?:papers|units)\s+((?:\d+[a-z]?\s*(?:&|\band\b|,|\+)\s*)+\d+[a-z]?)\b/g)) for (const n of m[1]!.split(/\s*(?:&|\band\b|,|\+)\s*/)) add(paperName(n));
  return out;
}
/** What a unit is called: its code, the school's short code, and "paper N" for a paper or unit numbered so. */
function unitNames(u: { code: string; shortCode: string | null }): string[] {
  const out = [u.code.toLowerCase()];
  const short = (u.shortCode ?? '').toLowerCase().trim();
  if (short) out.push(short);
  const numbered = /^(?:paper|unit)\s*(\d+[a-z]?)$/.exec(short);
  if (numbered) out.push(paperName(numbered[1]!));
  const component = /\/(\d+)$/.exec(u.code);
  if (component) out.push(paperName(component[1]!));
  return out;
}

/**
 * The session's offer a sheet's words name (F7, the day-one import): the offer of the catalogue
 * row the import's mapping chose; else the offer whose subject is named exactly (name or code),
 * or by its name without a bracket ("Biology (Paper 3 & Paper 4)" → Biology), at the line's level
 * (`levels`: the qualification levels its code reads as; more than one fitting is ambiguous, none
 * chosen); else the one offer with an item entering a unit the words name ("Pure Mathematics 1
 * (P1)" → the IAL Mathematics offer whose P1 item enters it) — every unit they name, else any of
 * them. Null when nothing, or more than one offer, fits: a name at another level is not a fit.
 */
export async function findOffer(executor: Executor, sessionId: string, term: string, opts: { subjectId?: string | null; levels?: string[] | null } = {}) {
  const offers = await executor.select({ id: sessionOffer.id, subjectId: sessionOffer.subjectId, availability: sessionOffer.availability, name: subject.name, code: subject.code, level: subject.qualificationLevel })
    .from(sessionOffer).innerJoin(subject, eq(subject.id, sessionOffer.subjectId)).where(eq(sessionOffer.sessionId, sessionId));
  const pick = (xs: typeof offers, how: 'subject' | 'name' | 'unit') => (xs.length === 1 ? { offer: xs[0]!, how } : null);
  if (opts.subjectId) {
    const hit = pick(offers.filter((o) => o.subjectId === opts.subjectId), 'subject');
    if (hit) return hit;
  }
  const t = words(term);
  const bare = words(term.replace(/\s*\([^)]*\)\s*$/, ''));
  const atLevel = (xs: typeof offers) => (opts.levels?.length ? xs.filter((o) => opts.levels!.includes(o.level)) : xs);
  const byName = pick(atLevel(offers.filter((o) => words(o.name) === t || words(o.code) === t)), 'name')
    ?? (bare !== t ? pick(atLevel(offers.filter((o) => words(o.name) === bare)), 'name') : null);
  if (byName) return byName;
  const codes = namedCodes(term);
  if (!codes.length || !offers.length) return null;
  const units = await executor.select({ offerId: sessionOfferItem.offerId, code: examUnit.code, shortCode: examUnit.shortCode })
    .from(sessionOfferItem).innerJoin(sessionOfferItemUnit, eq(sessionOfferItemUnit.itemId, sessionOfferItem.id)).innerJoin(examUnit, eq(examUnit.id, sessionOfferItemUnit.unitId))
    .where(eq(sessionOfferItem.sessionId, sessionId));
  // The offer whose items enter a unit of each code the words name ("Biology (Paper 3 & Paper 4)": units 3 and 4 of one subject);
  // when none enters them all, the one offer entering any of them ("Mathematics (P1 & P5)": the line is
  // split and the code no item enters is left for staff to choose, findItemsByCode).
  const covering = (all: boolean) => {
    const enters = (offerId: string, c: string) => units.some((u) => u.offerId === offerId && unitNames(u).includes(c));
    const ids = new Set(units.map((u) => u.offerId).filter((offerId) => (all ? codes.every((c) => enters(offerId, c)) : codes.some((c) => enters(offerId, c)))));
    const xs = offers.filter((o) => ids.has(o.id));
    return xs.length > 1 ? atLevel(xs) : xs;
  };
  const every = covering(true);
  return pick(every.length ? every : covering(false), 'unit');
}

/**
 * The item of an offer a sheet's words name (F7): the item labelled so; else the one item entering
 * exactly the units or paper the words name (P1, WMA11, "Paper 3" → the item entering unit 3,
 * "Paper 4" → "Paper 4 only (retake)"); else the whole subject, as resolveItem picks it; an offer of
 * one item, that item. Among several that fit, the one in the series of the sheet's month and year.
 * `candidates` lists them when none or more than one fit, for staff to choose on the line.
 */
export async function findItem(executor: Executor, offerId: string, label: string, opts: { month?: string | null; year?: number | null } = {}) {
  const items = await executor.select({ item: sessionOfferItem, month: boardSeries.month, year: boardSeries.year })
    .from(sessionOfferItem).leftJoin(boardSeries, eq(boardSeries.id, sessionOfferItem.boardSeriesId))
    .where(eq(sessionOfferItem.offerId, offerId))
    .orderBy(sql`${sessionOfferItem.availability} = 'closed'`, sql`${sessionOfferItem.boardSeriesId} is null`, sessionOfferItem.sortOrder, sessionOfferItem.label, sessionOfferItem.id);
  const units = items.length
    ? await executor.select({ itemId: sessionOfferItemUnit.itemId, code: examUnit.code, shortCode: examUnit.shortCode })
        .from(sessionOfferItemUnit).innerJoin(examUnit, eq(examUnit.id, sessionOfferItemUnit.unitId))
        .where(inArray(sessionOfferItemUnit.itemId, items.map((i) => i.item.id)))
    : [];
  const candidates = items.map((i) => ({ id: i.item.id, label: i.item.label, kind: i.item.kind }));
  const inSeries = (xs: typeof items) => {
    const here = xs.filter((x) => opts.month && x.month === opts.month && x.year === opts.year);
    return here.length ? here : xs;
  };
  const pick = (xs: typeof items, how: 'label' | 'unit' | 'paper' | 'whole' | 'only') => {
    const narrowed = inSeries(xs);
    // The same thing in two series (a converted window, or an item moved): the open one first, as ordered.
    const distinct = new Set(narrowed.map((x) => `${x.item.kind}|${words(x.item.label)}`));
    return narrowed.length && distinct.size === 1 ? { item: narrowed[0]!.item, how, candidates } : null;
  };
  if (items.length === 1) return { item: items[0]!.item, how: 'only' as const, candidates };
  const t = words(label);
  // The label as written, or the one code it names written another way ("Paper 3" for an item labelled "Unit 3").
  const one = namedCodes(label);
  const sameCode = (itemLabel: string) => one.length === 1 && namedCodes(itemLabel).length === 1 && namedCodes(itemLabel)[0] === one[0];
  const byLabel = pick(items.filter((i) => words(i.item.label) === t || sameCode(i.item.label)), 'label');
  if (byLabel) return byLabel;
  const codes = namedCodes(label);
  if (codes.length) {
    // An item fits when the units it enters are exactly the ones named (by code or by what the school calls them).
    const fits = items.filter((i) => {
      const own = units.filter((u) => u.itemId === i.item.id).map(unitNames);
      return own.length > 0 && own.every((u) => u.some((c) => codes.includes(c))) && codes.every((c) => own.some((u) => u.includes(c)));
    });
    const hit = pick(fits, 'unit');
    if (hit) return hit;
    // A paper named in the label of a one-paper retake ("Paper 4" → "Paper 4 only (retake)").
    const papers = codes.filter((c) => c.startsWith('paper ')).map((c) => c.slice(6));
    if (papers.length === 1) {
      const byPaper = pick(items.filter((i) => i.item.kind === 'paper' && new RegExp(`\\b(?:paper\\s*)?${papers[0]}\\b`).test(words(i.item.label))), 'paper');
      if (byPaper) return byPaper;
    }
    if (codes.length > 1 || fits.length) return { item: null, how: null, candidates };
  }
  const whole = pick(items.filter((i) => i.item.kind === 'all_papers'), 'whole');
  return whole ?? { item: null, how: null, candidates };
}

/**
 * A line naming several units or papers ("Mathematics (P1 & P2)", "Biology (Paper 3 & Paper 4)")
 * that no single item enters (F7, the review of 8 Oct, item 2): one item per code the words name —
 * staff's choice for a code first (`chosen`), else findItem on the code alone — or null for a code
 * no single item, or an item another code already took, fits. Null when the words name fewer than
 * two codes.
 */
export async function findItemsByCode(
  executor: Executor, offerId: string, label: string,
  opts: { month?: string | null; year?: number | null; chosen?: Record<string, string> | null } = {},
) {
  const codes = namedCodes(label);
  if (codes.length < 2) return null;
  const parts: { code: string; item: typeof sessionOfferItem.$inferSelect | null; candidates: { id: string; label: string; kind: string }[] }[] = [];
  for (const code of codes) {
    const chosenId = opts.chosen?.[code];
    if (chosenId) {
      const [it] = await executor.select().from(sessionOfferItem).where(and(eq(sessionOfferItem.id, chosenId), eq(sessionOfferItem.offerId, offerId)));
      const all = await findItem(executor, offerId, code, opts);
      parts.push({ code, item: it ?? null, candidates: all.candidates });
      continue;
    }
    const r = await findItem(executor, offerId, code, opts);
    // A code that falls back to the whole subject, or to the offer's only item, names no item of its own.
    const own = r.item && r.how !== 'whole' && r.how !== 'only' ? r.item : null;
    parts.push({ code, item: own, candidates: r.candidates });
  }
  // Two codes on one item: neither is that item's alone.
  for (const p of parts) if (p.item && parts.filter((q) => q.item?.id === p.item!.id).length > 1 && !opts.chosen?.[p.code]) p.item = null;
  return parts;
}

/**
 * The Subjects tab (§4.2): every offer with its board, teachers, items, their series, fees and lines.
 * For the links sheet's form (F6a): each item's qualification (code, title, level), each IGCSE
 * subject's papers on the Catalogue that are not on the sheet yet (`papersToAdd`, what withOnePaper
 * would give), and the shares the fees read (`shares`: the settings' percentages).
 */
export async function listOffers(sessionId: string) {
  const [session] = await db.select().from(registrationSession).where(eq(registrationSession.id, sessionId));
  if (!session) throw new OfferError('Session not found', 404);
  const { names } = await boardNames(db);
  const offers = await db.select({ offer: sessionOffer, subject: subject }).from(sessionOffer)
    .innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .where(eq(sessionOffer.sessionId, sessionId)).orderBy(sessionOffer.sortOrder, subject.name);
  const offerIds = offers.map((o) => o.offer.id);
  const [teachers, items] = offerIds.length
    ? await Promise.all([
        db.select({ offerId: sessionOfferTeacher.offerId, teacherId: teacher.id, name: teacher.name, kind: teacher.kind, mode: sessionOfferTeacher.mode, sortOrder: sessionOfferTeacher.sortOrder })
          .from(sessionOfferTeacher).innerJoin(teacher, eq(teacher.id, sessionOfferTeacher.teacherId))
          .where(inArray(sessionOfferTeacher.offerId, offerIds)).orderBy(sessionOfferTeacher.sortOrder),
        db.select().from(sessionOfferItem).where(inArray(sessionOfferItem.offerId, offerIds)).orderBy(sessionOfferItem.sortOrder, sessionOfferItem.label),
      ])
    : [[], []];
  const itemIds = items.map((i) => i.id);
  const qualificationIds = [...new Set(items.map((i) => i.qualificationId).filter((x): x is string => !!x))];
  const quals = qualificationIds.length
    ? await db.select({ id: qualification.id, code: qualification.code, title: qualification.title, level: qualification.level }).from(qualification).where(inArray(qualification.id, qualificationIds))
    : [];
  const [itemTeachers, itemUnits, seriesRows, lineCounts, fees] = itemIds.length
    ? await Promise.all([
        db.select({ itemId: sessionOfferItemTeacher.itemId, teacherId: teacher.id, name: teacher.name, kind: teacher.kind, mode: sessionOfferItemTeacher.mode })
          .from(sessionOfferItemTeacher).innerJoin(teacher, eq(teacher.id, sessionOfferItemTeacher.teacherId)).where(inArray(sessionOfferItemTeacher.itemId, itemIds))
          .orderBy(sessionOfferItemTeacher.sortOrder),
        db.select({ itemId: sessionOfferItemUnit.itemId, unitId: examUnit.id, code: examUnit.code, shortCode: examUnit.shortCode, level: examUnit.unitLevel })
          .from(sessionOfferItemUnit).innerJoin(examUnit, eq(examUnit.id, sessionOfferItemUnit.unitId)).where(inArray(sessionOfferItemUnit.itemId, itemIds)),
        db.select().from(boardSeries).where(inArray(boardSeries.id, [...new Set(items.map((i) => i.boardSeriesId).filter((x): x is string => !!x)), '__none__'])),
        db.select({ itemId: registration.offerItemId, status: registration.status, n: sql<number>`count(*)::int` }).from(registration)
          .where(inArray(registration.offerItemId, itemIds)).groupBy(registration.offerItemId, registration.status),
        itemBoardFees(db, itemIds),
      ])
    : [[], [], [], [], new Map()];
  const ialUnits = await cashInUnitItems(db, itemIds);
  const seriesById = new Map(seriesRows.map((s) => [s.id, s]));
  const now = new Date();
  const seriesView = (id: string | null) => {
    const s = id ? seriesById.get(id) : undefined;
    if (!s) return null;
    return {
      id: s.id, name: boardSeriesName(names, s), boardCode: s.boardCode, month: s.month, year: s.year, label: s.label,
      entryDeadline: s.entryDeadline, retakeDeadline: s.retakeDeadline, examsStart: s.examsStart,
      entryDeadlinePassed: !!s.entryDeadline && s.entryDeadline <= now,
      // A series with neither an entry deadline nor an exam start takes no new line (§3.3).
      reservable: !!(s.entryDeadline || s.examsStart),
    };
  };
  // The papers the Catalogue gives an IGCSE subject (withOnePaper's) that are not on the sheet yet.
  const papersToAdd = new Map<string, { unitId: string; label: string; code: string; shortCode: string | null }[]>();
  for (const { offer, subject: s } of offers.filter((o) => o.subject.qualificationLevel === 'igcse')) {
    const drafts = (await generateItems(db, s.id)).filter((d) => d.kind === 'one_paper' && d.enters.kind === 'units' && d.enters.unitIds.length === 1);
    const onSheet = new Set(itemUnits.filter((u) => items.some((i) => i.id === u.itemId && i.offerId === offer.id && i.kind === 'paper')).map((u) => u.unitId));
    const missing = drafts.filter((d) => d.enters.kind === 'units' && !onSheet.has(d.enters.unitIds[0]!));
    if (!missing.length) continue;
    const units = await db.select({ id: examUnit.id, code: examUnit.code, shortCode: examUnit.shortCode }).from(examUnit)
      .where(inArray(examUnit.id, missing.map((d) => (d.enters as { unitIds: string[] }).unitIds[0]!)));
    papersToAdd.set(offer.id, missing.map((d) => {
      const u = units.find((x) => x.id === (d.enters as { unitIds: string[] }).unitIds[0])!;
      return { unitId: u.id, label: d.label, code: u.code, shortCode: u.shortCode };
    }));
  }
  // F8-04: the other awards a subject may be entered for beside its own — its board's awards of the same subject
  // area and level in another suite (Arabic A.L.: the Edexcel GCE 9AA0 beside the IAL YAA01; the family chooses
  // through the teacher, decision 3) — that no item of the subject enters yet. Another syllabus of the same suite
  // (Cambridge's older 0610 beside 0970) is not offered: it is a replacement, not a second qualification.
  const ownQuals = [...new Set(offers.map((o) => o.subject.qualificationId).filter((x): x is string => !!x))];
  const own = ownQuals.length
    ? await db.select({ id: qualification.id, boardCode: qualification.boardCode, level: qualification.level, subjectArea: qualification.subjectArea, suite: qualification.suite })
      .from(qualification).where(inArray(qualification.id, ownQuals))
    : [];
  const siblings = own.length
    ? await db.select({ id: qualification.id, code: qualification.code, title: qualification.title, level: qualification.level, boardCode: qualification.boardCode, subjectArea: qualification.subjectArea, suite: qualification.suite })
      .from(qualification).where(and(eq(qualification.isActive, true), inArray(qualification.boardCode, [...new Set(own.map((q) => q.boardCode))])))
      .orderBy(qualification.code)
    : [];
  const qualificationsToAdd = (offerId: string, ownId: string | null) => {
    const q = own.find((x) => x.id === ownId);
    if (!q) return [];
    // Only beside a subject whose own entry is a single whole item: the new qualification joins that item's exclusive
    // group, one or the other. A subject entered by unit (one item per unit, no whole item), by paper or by route has
    // nothing the new one could be a choice against, and both could be reserved (the review of 744e553, item 5). The
    // qualifications added already beside the whole item are not the subject's own entry.
    const ownEntry = items.filter((i) => i.offerId === offerId && !(i.kind === 'qualification' && i.qualificationId !== ownId));
    if (ownEntry.length !== 1 || ownEntry[0]!.kind !== 'all_papers') return [];
    const entered = new Set(items.filter((i) => i.offerId === offerId && i.qualificationId).map((i) => i.qualificationId));
    return siblings
      .filter((x) => x.id !== q.id && x.boardCode === q.boardCode && x.level === q.level && x.subjectArea === q.subjectArea && (x.suite ?? '') !== (q.suite ?? '') && !entered.has(x.id))
      .map(({ id, code, title, level }) => ({ id, code, title, level }));
  };
  const rows = offers.map(({ offer, subject: s }) => {
    const its = items.filter((i) => i.offerId === offer.id).map((i) => {
      const f = fees.get(i.id);
      const counts = lineCounts.filter((c) => c.itemId === i.id);
      const live = counts.filter((c) => !(DONE as readonly string[]).includes(c.status)).reduce((a, c) => a + c.n, 0);
      return {
        ...i,
        qualification: quals.find((q) => q.id === i.qualificationId) ?? null,
        series: seriesView(i.boardSeriesId),
        teachers: itemTeachers.filter((t) => t.itemId === i.id),
        units: itemUnits.filter((u) => u.itemId === i.id),
        // A unit of a units-cash-in award (an IAL's): its form offers the board's IAL months alone (decision 2).
        ialUnit: ialUnits.has(i.id),
        boardFee: f ? { amount: f.amount, provisional: f.provisional, missing: f.missing } : { amount: null, provisional: false, missing: 1 },
        lines: { live, all: counts.reduce((a, c) => a + c.n, 0), confirmed: counts.find((c) => c.status === 'confirmed')?.n ?? 0 },
      };
    });
    const offerTeachers = teachers.filter((t) => t.offerId === offer.id);
    const warnings: string[] = [];
    if (offer.availability === 'open' && !offerTeachers.length) warnings.push('no_teacher');
    if (its.some((i) => i.availability !== 'closed' && i.boardFee.missing > 0)) warnings.push('no_fee');
    if (its.some((i) => i.availability !== 'closed' && i.series && !i.series.reservable)) warnings.push('series_without_dates');
    if (!s.qualificationId && its.some((i) => i.entersKind === 'subject')) warnings.push('unmapped');
    return {
      ...offer,
      subject: {
        id: s.id, name: s.name, code: s.code, council: s.council, boardName: names.get(s.council) ?? s.council, qualificationLevel: s.qualificationLevel,
        qualificationId: s.qualificationId, isActive: s.isActive,
      },
      teachers: offerTeachers,
      items: its,
      papersToAdd: papersToAdd.get(offer.id) ?? [],
      qualificationsToAdd: qualificationsToAdd(offer.id, s.qualificationId),
      lines: its.reduce((a, i) => a + i.lines.live, 0),
      warnings,
    };
  });
  const [selfStudyCoursePercent, retakeTaughtCoursePercent, onePaperCoursePercent] = await Promise.all([
    getSetting('pricing.selfStudyCoursePercent'), getSetting('pricing.retakeTaughtCoursePercent'), getSetting('pricing.onePaperCoursePercent'),
  ]);
  // The deadlines line under the header: every attached series with its dates (§4.2).
  const links = await db.select({ series: boardSeries }).from(sessionBoardSeries).innerJoin(boardSeries, eq(boardSeries.id, sessionBoardSeries.boardSeriesId))
    .where(eq(sessionBoardSeries.sessionId, sessionId));
  return {
    session,
    shares: { selfStudyCoursePercent, retakeTaughtCoursePercent, onePaperCoursePercent },
    offers: rows,
    series: links.map((l) => ({ ...seriesView(l.series.id) ?? { id: l.series.id, name: boardSeriesName(names, l.series), boardCode: l.series.boardCode, month: l.series.month, year: l.series.year, label: l.series.label, entryDeadline: l.series.entryDeadline, retakeDeadline: l.series.retakeDeadline, examsStart: l.series.examsStart, entryDeadlinePassed: !!l.series.entryDeadline && l.series.entryDeadline <= now, reservable: !!(l.series.entryDeadline || l.series.examsStart) } }))
      .sort((a, b) => (a.entryDeadline?.getTime() ?? Infinity) - (b.entryDeadline?.getTime() ?? Infinity) || a.name.localeCompare(b.name)),
  };
}

/** Subjects the session does not offer yet, for "Add subject" (an unmapped row flagged). */
export async function addableSubjects(sessionId: string) {
  const rows = await db.select({ id: subject.id, name: subject.name, code: subject.code, council: subject.council, qualificationLevel: subject.qualificationLevel,
    courseFee: subject.courseFee, mapped: sql<boolean>`${subject.qualificationId} is not null or exists (select 1 from subject_unit su where su.subject_id = ${subject.id})` })
    .from(subject)
    .where(and(eq(subject.isActive, true), sql`not exists (select 1 from session_offer o where o.session_id = ${sessionId} and o.subject_id = ${subject.id})`))
    .orderBy(subject.name);
  const pool = rows.length
    ? await db.select({ subjectId: subjectTeacher.subjectId, teacherId: teacher.id, name: teacher.name, kind: teacher.kind })
        .from(subjectTeacher).innerJoin(teacher, eq(teacher.id, subjectTeacher.teacherId))
        .where(and(inArray(subjectTeacher.subjectId, rows.map((r) => r.id)), eq(teacher.isActive, true)))
    : [];
  return rows.map((r) => ({ ...r, teachers: pool.filter((p) => p.subjectId === r.id).map(({ subjectId: _s, ...t }) => t) }));
}

export { LIVE as LIVE_LINE_STATUSES, DONE as DONE_LINE_STATUSES };
