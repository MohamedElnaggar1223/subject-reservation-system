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
  sessionOfferItemUnit, sessionOfferItemTeacher, sessionOfferItemFeeKey, courseEnrolment, subjectUnit,
  and, eq, ne, inArray, isNull, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  IGCSE_NEVER_MONTHS, IGCSE_NEVER_MESSAGE, SERIES_MONTH_LABELS, sessionSeriesMonths,
  type CreateOfferType, type UpdateOfferType, type OfferItemInputType, type UpdateOfferItemType, type ReplaceOfferTeacherType,
  type OfferTeacherInputType, type FeeKeyInputType, type Availability, type SeriesMonth,
} from '@repo/validations';
import { logAction, logActions, type AuditContext } from './audit.services';
import { boardSeriesName, seriesRuleSentence, openCheckoutsSpanningDeadlines } from './series.services';
import { effectiveDeadlineFor, effectiveDeadlinesOf, deadlinePassedSentence, redateLines } from './deadline.services';
import { itemBoardFees } from './pricing.services';
import { schoolDate } from './window.services';
import { lockStudents, assertStudentsLocked, withStudentsFirst } from '../lib/student-locks';

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
    { boardCode, month, year, label, reason: 'Created when an item of a session was placed in it (no dates yet)' }, undefined, tx);
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
        return [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'option', optionId: options[0]!.id }, availability: 'open', requiredInSeries: false }];
      }
      if (q.level !== 'igcse' && options.length > 0) {
        return options.map((o, i) => ({
          label: o.label, kind: 'route' as const, enters: { kind: 'option' as const, optionId: o.id }, availability: 'open' as const,
          needsPriorSeries: o.carryForward, requiredInSeries: false, exclusiveGroup: 'route', sortOrder: i,
        }));
      }
    }
    return [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'award', qualificationId: s.qualificationId }, availability: 'open', requiredInSeries: false }];
  }
  return [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, availability: 'open', requiredInSeries: false }];
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
  await tx.insert(sessionOfferItem).values({
    id, offerId: offer.id, sessionId: session.id, label: d.label, kind: d.kind, entersKind: d.enters.kind,
    qualificationId: d.enters.kind === 'subject' ? null : enters.qualificationId, qualificationOptionId: enters.optionId,
    boardSeriesId: seriesId, availability: d.availability, courseFee: d.courseFee ?? null,
    needsPriorSeries: !!needsPrior, requiredInSeries: d.requiredInSeries, exclusiveGroup: d.exclusiveGroup ?? null,
    sortOrder: d.sortOrder ?? 0, createdBy: actorId,
  });
  if (enters.unitIds.length) await tx.insert(sessionOfferItemUnit).values(enters.unitIds.map((unitId) => ({ itemId: id, unitId })));
  await writeFeeKeys(tx, id, d.feeKeys ?? enters.feeKeys);
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
      const offerId = randomUUID();
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(sessionOffer).where(eq(sessionOffer.sessionId, sessionId)) as [{ n: number }];
      await tx.insert(sessionOffer).values({
        id: offerId, sessionId, subjectId: s.id, availability: data.availability, courseFee: data.courseFee,
        courseStartsOn: data.courseStartsOn ?? null, grade10Core: data.grade10Core, notes: data.notes ?? null, sortOrder: n, createdBy: actorId,
      });
      if (teachers.length) {
        await tx.insert(sessionOfferTeacher).values(teachers.map((t, i) => ({ id: randomUUID(), offerId, teacherId: t.teacherId, mode: t.mode, sortOrder: i })));
      }
      const drafts: ItemDraft[] = data.items ? data.items.map(toDraft) : await generateItems(tx, s.id);
      const itemIds: string[] = [];
      for (const d of drafts) itemIds.push(await insertItem(tx, session, { id: offerId, subjectId: s.id }, s, d, actorId));
      await logAction(actorId, 'SESSION_OFFER_CREATED', 'session_offer', offerId, null,
        { sessionId, subjectId: s.id, availability: data.availability, courseFee: data.courseFee, teachers, items: itemIds, grade10Core: data.grade10Core }, ctx, tx);
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
    const { reason, teachers: _t, ...fields } = data;
    const [updated] = await tx.update(sessionOffer).set({ ...fields, updatedAt: new Date() }).where(eq(sessionOffer.id, offerId)).returning();
    await logAction(actorId, 'SESSION_OFFER_UPDATED', 'session_offer', offerId,
      { availability: offer.availability, courseFee: offer.courseFee, grade10Core: offer.grade10Core, teachers: current.map((t) => t.teacherId) },
      { ...fields, teachers: teachers.map((t) => t.teacherId), reason: reason ?? null }, ctx, tx);
    return updated!;
  });
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
      const id = await insertItem(tx, session, offer, subjectRow, toDraft(data), actorId);
      await logAction(actorId, 'OFFER_ITEM_CREATED', 'offer_item', id, null, { offerId, ...data }, ctx, tx);
      return { id };
    });
  } catch (err) {
    if (err instanceof OfferError) throw err;
    rethrow(err);
  }
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
    return await withStudentsFirst((extra) => db.transaction(async (tx) => {
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
      const { reason, teachers, feeKeys, boardSeriesId, ...fields } = data;
      const moved = boardSeriesId && boardSeriesId !== item.boardSeriesId
        ? await changeItemSeries(tx, session, subjectRow, item, boardSeriesId, actorId, reason ?? null, locked)
        : [];
      if (teachers !== undefined) await writeItemTeachers(tx, itemId, teachers?.length ? await resolveTeachers(tx, offer.subjectId, teachers, actorId) : []);
      if (feeKeys) await writeFeeKeys(tx, itemId, feeKeys);
      const [updated] = await tx.update(sessionOfferItem).set({ ...fields, updatedAt: new Date() }).where(eq(sessionOfferItem.id, itemId)).returning();
      await logAction(actorId, 'OFFER_ITEM_UPDATED', 'offer_item', itemId,
        { label: item.label, availability: item.availability, courseFee: item.courseFee, boardSeriesId: item.boardSeriesId, exclusiveGroup: item.exclusiveGroup, requiredInSeries: item.requiredInSeries },
        { ...fields, ...(boardSeriesId ? { boardSeriesId } : {}), ...(feeKeys ? { feeKeys } : {}), ...(teachers !== undefined ? { teachers } : {}), linesMoved: moved.length, reason: reason ?? null }, ctx, tx);
      return { ...updated!, linesMoved: moved.length };
    }));
  } catch (err) {
    if (err instanceof OfferError) throw err;
    rethrow(err);
  }
}

/** Move an item to another series of its board, with its live lines (in the caller's transaction). */
async function changeItemSeries(
  tx: Tx, session: SessionRow, subjectRow: typeof subject.$inferSelect, item: typeof sessionOfferItem.$inferSelect,
  targetId: string, actorId: string | null, reason: string | null, locked: Set<string>,
) {
  const level = await levelOf(tx, subjectRow.qualificationLevel, {
    kind: item.entersKind, qualificationId: item.qualificationId, optionId: item.qualificationOptionId,
    unitIds: (await tx.select({ id: sessionOfferItemUnit.unitId }).from(sessionOfferItemUnit).where(eq(sessionOfferItemUnit.itemId, item.id))).map((u) => u.id),
  });
  const ids = [targetId, ...(item.boardSeriesId ? [item.boardSeriesId] : [])].sort();
  await tx.select({ id: boardSeries.id }).from(boardSeries).where(inArray(boardSeries.id, ids)).orderBy(boardSeries.id).for('share');
  const target = await assertItemSeriesFits(tx, session, subjectRow, level, targetId);
  const lines = await tx.select().from(registration)
    .where(and(eq(registration.offerItemId, item.id), inArray(registration.status, [...LIVE])))
    .orderBy(registration.id).for('update');
  // A line committed while this change waited for the item: its student was not locked first.
  assertStudentsLocked(locked, lines.map((l) => l.studentId));
  const now = new Date();
  const { names } = await boardNames(tx);
  // The entries already made stand: a line past its own deadline does not move.
  const current = await effectiveDeadlinesOf(tx, lines.map((l) => l.id));
  for (const l of lines) {
    const d = current.get(l.id)!;
    if (d.at && d.at <= now) {
      throw new OfferError(`${item.label} has lines past their deadline in the series it is entered in (${schoolDate(d.at)}): its entries stand`, 409);
    }
    const there = await effectiveDeadlineFor(tx, { boardSeriesId: targetId, attempt: l.attempt, priorSittingSeriesId: l.priorSittingSeriesId });
    if (there.at && there.at <= now) {
      throw new OfferError(`${boardSeriesName(names, target)} is past a line's deadline: ${deadlinePassedSentence(there, schoolDate)}`, 409);
    }
  }
  await attachSeries(tx, session.id, targetId, actorId);
  await tx.update(sessionOfferItem).set({ boardSeriesId: targetId, updatedAt: now }).where(eq(sessionOfferItem.id, item.id));
  for (const l of lines) await tx.update(registration).set({ boardSeriesId: targetId, updatedAt: now }).where(eq(registration.id, l.id));
  // The same unit or award once per student in the target series (gate.sameEntryOnce).
  if (lines.length) {
    const clash = await tx.execute(sql`
      select r.id, u.name from registration r join "user" u on u.id = r.student_id
      where r.board_series_id = ${targetId} and r.status not in ('rejected', 'expired', 'dropped')
        and r.offer_item_id <> ${item.id}
        and r.student_id in (${sql.join(lines.map((l) => sql`${l.studentId}`), sql`, `)})
        and exists (
          select 1 from session_offer_item i2 where i2.id = r.offer_item_id and (
            (i2.qualification_id is not null and i2.enters_kind in ('award', 'option') and i2.qualification_id = ${item.qualificationId} and ${item.entersKind} in ('award', 'option'))
            or exists (select 1 from session_offer_item_unit a join session_offer_item_unit b on a.unit_id = b.unit_id where a.item_id = i2.id and b.item_id = ${item.id})))
      limit 1`);
    const c = clash.rows[0] as { name: string } | undefined;
    if (c) throw new OfferError(`${c.name} already has a line entering the same in ${boardSeriesName(names, target)}: move or drop it first`, 409);
  }
  const spanning = await openCheckoutsSpanningDeadlines(tx, { registrationIds: lines.map((l) => l.id) });
  if (spanning > 0) {
    throw new OfferError(`${spanning} checkout${spanning === 1 ? '' : 's'} still open would pay for two deadlines after this move — confirm or cancel ${spanning === 1 ? 'it' : 'them'} first`, 409);
  }
  await logAction(actorId, 'OFFER_ITEM_SERIES_CHANGED', 'offer_item', item.id, { boardSeriesId: item.boardSeriesId },
    { boardSeriesId: targetId, linesMoved: lines.length, reason }, undefined, tx);
  await logActions(lines.map((l) => ({
    userId: actorId, action: 'LINE_SERIES_MOVED' as const, entityType: 'registration' as const, entityId: l.id,
    previousData: { boardSeriesId: l.boardSeriesId }, newData: { boardSeriesId: targetId, offerItemId: item.id, reason },
  })), tx);
  await redateLines(tx, lines.map((l) => l.id), actorId, 'its item moved to another series');
  await detachUnusedSeries(tx, session.id);
  return lines;
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
    const live = counts.filter((c) => !(DONE as readonly string[]).includes(c.status)).reduce((a, c) => a + c.n, 0);
    if (live) throw new OfferError(`${item.label} has ${live} live line${live === 1 ? '' : 's'}: move or drop ${live === 1 ? 'it' : 'them'} first`, 409);
    if (counts.length) {
      await tx.update(sessionOfferItem).set({ availability: 'closed', updatedAt: new Date() }).where(eq(sessionOfferItem.id, itemId));
      await logAction(actorId, 'OFFER_ITEM_UPDATED', 'offer_item', itemId, { availability: item.availability }, { availability: 'closed', reason: 'Unticked: kept closed for its history' }, ctx, tx);
      return { closed: itemId };
    }
    await tx.delete(sessionOfferItem).where(eq(sessionOfferItem.id, itemId));
    await detachUnusedSeries(tx, sessionId);
    await logAction(actorId, 'OFFER_ITEM_DELETED', 'offer_item', itemId, { offerId, label: item.label, boardSeriesId: item.boardSeriesId }, null, ctx, tx);
    return { deleted: itemId };
  });
}

// ─── Replace a teacher (§4.2) ────────────────────────────────────────────────

/**
 * A teacher who leaves: every item and offer naming them, every live in-school line of the offer
 * naming them, and this academic year's open enrolments of those students in the subject move to
 * the other teacher, audited.
 */
export async function replaceTeacher(sessionId: string, offerId: string, data: ReplaceOfferTeacherType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const session = await sessionForChange(tx, sessionId);
    const { offer } = await offerForChange(tx, sessionId, offerId);
    if (data.fromTeacherId === data.toTeacherId) throw new OfferError('Choose another teacher to replace them with');
    const [to] = await tx.select().from(teacher).where(eq(teacher.id, data.toTeacherId));
    if (!to) throw new OfferError('Teacher not found', 404);
    if (!to.isActive) throw new OfferError(`${to.name} is inactive`);
    const items = await tx.select({ id: sessionOfferItem.id }).from(sessionOfferItem).where(eq(sessionOfferItem.offerId, offerId));
    const itemIds = items.map((i) => i.id);
    const onOffer = await tx.select().from(sessionOfferTeacher).where(and(eq(sessionOfferTeacher.offerId, offerId), eq(sessionOfferTeacher.teacherId, data.fromTeacherId)));
    const onItems = itemIds.length
      ? await tx.select().from(sessionOfferItemTeacher).where(and(inArray(sessionOfferItemTeacher.itemId, itemIds), eq(sessionOfferItemTeacher.teacherId, data.fromTeacherId)))
      : [];
    const lines = itemIds.length
      ? await tx.select({ id: registration.id, studentId: registration.studentId }).from(registration)
          .where(and(inArray(registration.offerItemId, itemIds), eq(registration.teacherId, data.fromTeacherId), inArray(registration.status, [...LIVE])))
          .orderBy(registration.id).for('update')
      : [];
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
    // The enrolment follows (§10): this year's open in-school enrolments of those students in the subject.
    const ay = await tx.execute(sql`select id from academic_year where start_year = school_series_academic_year_start(${session.sessionType}, ${session.seriesYear})`);
    const yearId = (ay.rows[0] as { id: string } | undefined)?.id;
    let enrolmentsMoved = 0;
    if (yearId && lines.length) {
      const moved = await tx.update(courseEnrolment).set({ teacherId: to.id, updatedAt: now })
        .where(and(eq(courseEnrolment.academicYearId, yearId), eq(courseEnrolment.subjectId, offer.subjectId), eq(courseEnrolment.teacherId, data.fromTeacherId),
          isNull(courseEnrolment.endedOn), inArray(courseEnrolment.studentId, [...new Set(lines.map((l) => l.studentId))])))
        .returning({ id: courseEnrolment.id });
      enrolmentsMoved = moved.length;
    }
    await logAction(actorId, 'SESSION_OFFER_TEACHER_REPLACED', 'session_offer', offerId, { teacherId: data.fromTeacherId },
      { teacherId: to.id, reason: data.reason, items: onItems.length, lines: lines.length, enrolments: enrolmentsMoved }, ctx, tx);
    return { lines: lines.length, items: onItems.length, enrolments: enrolmentsMoved };
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
  const offers = await tx.select().from(sessionOffer).where(and(eq(sessionOffer.sessionId, from.id), ne(sessionOffer.availability, 'closed'))).orderBy(sessionOffer.sortOrder, sessionOffer.id);
  const have = new Set((await tx.select({ subjectId: sessionOffer.subjectId }).from(sessionOffer).where(eq(sessionOffer.sessionId, session.id))).map((o) => o.subjectId));
  let copied = 0;
  let feesCopied = 0;
  for (const o of offers) {
    if (have.has(o.subjectId)) continue;
    const [s] = await tx.select().from(subject).where(eq(subject.id, o.subjectId));
    if (!s || !s.isActive) continue;
    const offerId = randomUUID();
    await tx.insert(sessionOffer).values({
      id: offerId, sessionId: session.id, subjectId: o.subjectId, availability: o.availability, courseFee: o.courseFee,
      grade10Core: o.grade10Core, notes: o.notes, sortOrder: o.sortOrder, createdBy: actorId,
    });
    const ts = await tx.select().from(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, o.id));
    const activeTeachers = ts.length ? await tx.select({ id: teacher.id }).from(teacher).where(and(inArray(teacher.id, ts.map((t) => t.teacherId)), eq(teacher.isActive, true))) : [];
    const keep = ts.filter((t) => activeTeachers.some((a) => a.id === t.teacherId));
    if (keep.length) await tx.insert(sessionOfferTeacher).values(keep.map((t) => ({ id: randomUUID(), offerId, teacherId: t.teacherId, mode: t.mode, sortOrder: t.sortOrder })));
    const items = await tx.select().from(sessionOfferItem).where(and(eq(sessionOfferItem.offerId, o.id), ne(sessionOfferItem.availability, 'closed'))).orderBy(sessionOfferItem.sortOrder, sessionOfferItem.id);
    for (const it of items) {
      if (!it.boardSeriesId) continue;
      const [fs] = await tx.select().from(boardSeries).where(eq(boardSeries.id, it.boardSeriesId));
      const seriesId = fs ? await correspondingSeries(tx, session, fs, actorId) : null;
      if (!seriesId) continue;
      await attachSeries(tx, session.id, seriesId, actorId);
      const id = randomUUID();
      await tx.insert(sessionOfferItem).values({
        id, offerId, sessionId: session.id, label: it.label, kind: it.kind, entersKind: it.entersKind, qualificationId: it.qualificationId,
        qualificationOptionId: it.qualificationOptionId, boardSeriesId: seriesId, availability: it.availability, courseFee: it.courseFee,
        needsPriorSeries: it.needsPriorSeries, requiredInSeries: it.requiredInSeries, exclusiveGroup: it.exclusiveGroup, sortOrder: it.sortOrder, createdBy: actorId,
      });
      const us = await tx.select().from(sessionOfferItemUnit).where(eq(sessionOfferItemUnit.itemId, it.id));
      if (us.length) await tx.insert(sessionOfferItemUnit).values(us.map((u) => ({ itemId: id, unitId: u.unitId })));
      const keys = await tx.select().from(sessionOfferItemFeeKey).where(eq(sessionOfferItemFeeKey.itemId, it.id));
      await writeFeeKeys(tx, id, keys.map((k) => ({ kind: k.keyKind as FeeKeyInputType['kind'], id: k.keyId })));
      const its = await tx.select().from(sessionOfferItemTeacher).where(eq(sessionOfferItemTeacher.itemId, it.id));
      const itsActive = its.length ? await tx.select({ id: teacher.id }).from(teacher).where(and(inArray(teacher.id, its.map((t) => t.teacherId)), eq(teacher.isActive, true))) : [];
      await writeItemTeachers(tx, id, its.filter((t) => itsActive.some((a) => a.id === t.teacherId)).map((t) => ({ teacherId: t.teacherId, mode: t.mode as 'in_school' | 'online' })));
      // The fee rows the item reads, copied provisional where this series has none yet.
      for (const k of keys) {
        const [src] = await tx.select().from(boardFee).where(and(eq(boardFee.boardSeriesId, it.boardSeriesId), eq(boardFee.keyKind, k.keyKind), eq(boardFee.keyId, k.keyId)));
        if (!src) continue;
        const made = await tx.insert(boardFee).values({
          id: randomUUID(), boardSeriesId: seriesId, keyKind: src.keyKind, unitId: src.unitId, qualificationOptionId: src.qualificationOptionId,
          qualificationId: src.qualificationId, subjectId: src.subjectId, amount: src.amount, provisional: true, confirmedAt: null,
          zeroReason: src.zeroReason, copiedFromFeeId: src.id, createdBy: actorId,
        }).onConflictDoNothing().returning({ id: boardFee.id });
        feesCopied += made.length;
      }
    }
    copied++;
  }
  await logAction(actorId, 'SESSION_COPIED', 'session', session.id, null, { fromSessionId: from.id, from: from.name, offers: copied, feesCopiedProvisional: feesCopied }, undefined, tx);
  return { offers: copied, feesCopied };
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
    .where(and(eq(sessionOfferItem.offerId, o.offer.id), eq(sessionOfferItem.kind, 'whole')))
    .orderBy(sql`${sessionOfferItem.availability} = 'closed'`, sql`${sessionOfferItem.boardSeriesId} is null`, sessionOfferItem.id);
  const item = items[0];
  if (!item) throw new OfferError(`${o.subjectName} is reserved by unit or route in this session: choose them on the reservation page`);
  return { item, offer: o.offer, subjectName: o.subjectName };
}

/** The Subjects tab (§4.2): every offer with its board, teachers, items, their series, fees and lines. */
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
  const [itemTeachers, itemUnits, seriesRows, lineCounts, fees] = itemIds.length
    ? await Promise.all([
        db.select({ itemId: sessionOfferItemTeacher.itemId, teacherId: teacher.id, name: teacher.name, kind: teacher.kind, mode: sessionOfferItemTeacher.mode })
          .from(sessionOfferItemTeacher).innerJoin(teacher, eq(teacher.id, sessionOfferItemTeacher.teacherId)).where(inArray(sessionOfferItemTeacher.itemId, itemIds)),
        db.select({ itemId: sessionOfferItemUnit.itemId, unitId: examUnit.id, code: examUnit.code, shortCode: examUnit.shortCode, level: examUnit.unitLevel })
          .from(sessionOfferItemUnit).innerJoin(examUnit, eq(examUnit.id, sessionOfferItemUnit.unitId)).where(inArray(sessionOfferItemUnit.itemId, itemIds)),
        db.select().from(boardSeries).where(inArray(boardSeries.id, [...new Set(items.map((i) => i.boardSeriesId).filter((x): x is string => !!x)), '__none__'])),
        db.select({ itemId: registration.offerItemId, status: registration.status, n: sql<number>`count(*)::int` }).from(registration)
          .where(inArray(registration.offerItemId, itemIds)).groupBy(registration.offerItemId, registration.status),
        itemBoardFees(db, itemIds),
      ])
    : [[], [], [], [], new Map()];
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
  const rows = offers.map(({ offer, subject: s }) => {
    const its = items.filter((i) => i.offerId === offer.id).map((i) => {
      const f = fees.get(i.id);
      const counts = lineCounts.filter((c) => c.itemId === i.id);
      const live = counts.filter((c) => !(DONE as readonly string[]).includes(c.status)).reduce((a, c) => a + c.n, 0);
      return {
        ...i,
        series: seriesView(i.boardSeriesId),
        teachers: itemTeachers.filter((t) => t.itemId === i.id),
        units: itemUnits.filter((u) => u.itemId === i.id),
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
      subject: { id: s.id, name: s.name, code: s.code, council: s.council, boardName: names.get(s.council) ?? s.council, qualificationLevel: s.qualificationLevel, isActive: s.isActive },
      teachers: offerTeachers,
      items: its,
      lines: its.reduce((a, i) => a + i.lines.live, 0),
      warnings,
    };
  });
  // The deadlines line under the header: every attached series with its dates (§4.2).
  const links = await db.select({ series: boardSeries }).from(sessionBoardSeries).innerJoin(boardSeries, eq(boardSeries.id, sessionBoardSeries.boardSeriesId))
    .where(eq(sessionBoardSeries.sessionId, sessionId));
  return {
    session,
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
