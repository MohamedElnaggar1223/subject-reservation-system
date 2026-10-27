/**
 * What remains of a session's offers module after the coordinator rework's clean-up (P1c): the board series a
 * session's rows sit in (found or created, attached to the session, detached when unused, the default for a
 * parked path), the subject's all-papers row a path that still names subjects reserves (resolveItem), the day-one
 * import's finders (a sheet's words to a session's offer and row), and what a row's cells allow together.
 *
 * The links sheet's routes and services that lived here — offers, items, the subject's form, replace teacher, the
 * offers-only copy, and the item's fee keys read from a series' fee grid — left with P1c (COORDINATOR_REWORK.md §9.2):
 * the coordinator builds a session through setup/offering.services.ts.
 */

import {
  db, subject, boardSeries, examBoard, examUnit, sessionBoardSeries, sessionOffer, sessionOfferItem, sessionOfferItemUnit,
  and, eq, inArray, sql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import { IGCSE_NEVER_MONTHS, SERIES_MONTH_LABELS, sessionSeriesMonths, type SeriesMonth } from '@repo/validations';
import { logAction } from './audit.services';
import { LIVE_LINE_STATUSES as LIVE, type Cells } from './setup/model';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class OfferError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const DONE = ['rejected', 'expired', 'dropped'] as const;

async function boardNames(executor: Executor) {
  const rows = await executor.select({ code: examBoard.code, name: examBoard.name, months: examBoard.seriesMonths }).from(examBoard);
  return { names: new Map(rows.map((r) => [r.code, r.name])), months: new Map(rows.map((r) => [r.code, r.months])) };
}

// ─── What a row offers ───────────────────────────────────────────────────────

/**
 * What a row's cells allow (D3), with its subject's switch: closed — nothing ticked, or the subject switched off;
 * retakes only — no first entry; self study only — nothing in school. What the parked paths (grade 10 in bulk, the
 * day-one import, a swap's and a teacher's checks) asked of the availability columns P1c dropped.
 */
export function cellConstraints(cells: Cells, accepting = true) {
  return {
    closed: !accepting || !(cells.firstInSchool || cells.retakeInSchool || cells.retakeSelfStudy || cells.firstSelfStudy),
    retakeOnly: !(cells.firstInSchool || cells.firstSelfStudy),
    selfStudyOnly: !(cells.firstInSchool || cells.retakeInSchool),
  };
}

/** A row's cells as stored (the row's four columns). */
export const cellsOfRow = (i: Pick<typeof sessionOfferItem.$inferSelect, 'firstInSchool' | 'retakeInSchool' | 'retakeSelfStudy' | 'firstSelfStudy'>): Cells => ({
  firstInSchool: i.firstInSchool, retakeInSchool: i.retakeInSchool, retakeSelfStudy: i.retakeSelfStudy, firstSelfStudy: i.firstSelfStudy,
});

/** SQL: a row with no cell ticked (closed, or kept only for its history) sorts last. */
const UNTICKED = sql`not (${sessionOfferItem.firstInSchool} or ${sessionOfferItem.retakeInSchool} or ${sessionOfferItem.retakeSelfStudy} or ${sessionOfferItem.firstSelfStudy})`;

// ─── Series a session's rows sit in (§3.3) ───────────────────────────────────

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

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * The row a path that still names subjects reserves (docs/features/RESERVATIONS.md §2.4): the subject's all-papers
 * row in the session — one with a cell ticked first, then one whose series is set.
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
    .orderBy(UNTICKED, sql`${sessionOfferItem.boardSeriesId} is null`, sessionOfferItem.id);
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
  const offers = await executor.select({ id: sessionOffer.id, subjectId: sessionOffer.subjectId, name: subject.name, code: subject.code, level: subject.qualificationLevel })
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
    .orderBy(UNTICKED, sql`${sessionOfferItem.boardSeriesId} is null`, sessionOfferItem.sortOrder, sessionOfferItem.label, sessionOfferItem.id);
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

export { LIVE as LIVE_LINE_STATUSES, DONE as DONE_LINE_STATUSES };
