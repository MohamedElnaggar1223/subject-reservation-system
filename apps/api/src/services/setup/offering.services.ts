/**
 * A session's offerings as the coordinator builds them (COORDINATOR_REWORK.md §4, D1–D13, E3–E4;
 * Appendix A `POST/GET/PUT/DELETE /sessions/:id/offerings`).
 *
 * An offering is one subject of the session (a `session_offer`): picked from the reference list (its
 * suggested rows come with it, no cell ticked — she ticks what the school offers), "not on the list"
 * (a subject row made on first use, flagged for us), or copied from another offering. Its rows (a
 * `session_offer_item` each) say what can be entered (D2), how it is studied (the four cells, D3),
 * the sitting (C1, D12), the exam fee and course fee (E1–E4), the sittings a retake may carry from
 * (D6) and the row's own teachers (D4).
 *
 * The system derives the rest (A3): the label (D9), the exclusive group (D8), whether the sitting
 * carried from is asked (D6, the board rule), the row's board series (created when not on record and
 * linked to the session), and — until P1b drops them — today's columns kept in step: the offer's and
 * the row's availability from the switch and the cells, so the reservation path P1b has not replaced
 * yet offers what the cells allow.
 *
 * Locks (§9.2): the session FOR SHARE, the offering FOR UPDATE, its rows FOR UPDATE in id order, then
 * (planReprice) the lines FOR UPDATE and their payment history. A price change answers its impact
 * first (reprice.services.ts).
 */

import {
  db, subject, teacher, subjectTeacher, registrationSession, registration, examBoard, boardSeries, sessionOffer, sessionOfferTeacher,
  sessionOfferItem, sessionOfferItemTeacher, sessionQuestion, registrationAnswer, referenceSubject, referenceRow,
  and, eq, inArray, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type {
  AddOfferingType, UpdateOfferingType, OfferingRowInputType, OfferingTeacherInputType, QuestionInputType, Sitting,
} from '@repo/validations';
import { logAction, type AuditContext } from '../audit.services';
import { findOrCreateSeries, attachSeries, detachUnusedSeries, OfferError } from '../offer.services';
import { seriesRuleSentence } from '../series.services';
import { teacherDuplicates, duplicateTeacherRefusal } from './teacher-names';
import { findReferenceSubject } from './reference.services';
import { rowLabel, labelRowOf } from './labels';
import { WHOLE_ITEM_LABEL } from '@repo/validations';
import {
  availabilityOf, exclusiveGroupFor, needsPriorFor, seriesOfSitting, sittingOfSeries, defaultSitting, KIND_ORDER,
  NO_CELLS, type Cells,
} from './model';
import {
  planReprice, applyReprice, impactOfPlan, settleImpact, addImpact, tellRepriced, ImpactPending, NO_IMPACT, type Impact, type RepricedLine,
} from './reprice.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class SetupError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const LIVE = ['pending_approval', 'pending_payment', 'preregistered', 'confirmed', 'dropped_pending_receipt'];
type SessionRow = typeof registrationSession.$inferSelect;
type OfferRow = typeof sessionOffer.$inferSelect;
type ItemRow = typeof sessionOfferItem.$inferSelect;
type SubjectRow = typeof subject.$inferSelect;

/** A database rule refusing a change, as its sentence (IGCSE in January, a series of another board…). */
export function setupRethrow(err: unknown): never {
  if (err instanceof SetupError) throw err;
  if (err instanceof OfferError) throw new SetupError(err.message, err.status);
  const sentence = seriesRuleSentence(err);
  if (sentence) throw new SetupError(sentence, 409);
  throw err;
}

// ─── Locks and reads ─────────────────────────────────────────────────────────

export async function sessionForSetup(tx: Tx, sessionId: string, lock: 'share' | 'update' = 'share') {
  const [s] = await tx.select().from(registrationSession).where(eq(registrationSession.id, sessionId)).for(lock);
  if (!s) throw new SetupError('Session not found', 404);
  if (s.status === 'closed') throw new SetupError(`${s.name} is closed: reopen it to change it`, 409);
  return s;
}

async function offeringForSetup(tx: Tx, sessionId: string, offeringId: string) {
  const [o] = await tx.select().from(sessionOffer).where(and(eq(sessionOffer.id, offeringId), eq(sessionOffer.sessionId, sessionId))).for('update');
  if (!o) throw new SetupError('That subject is not in this session', 404);
  const [s] = await tx.select().from(subject).where(eq(subject.id, o.subjectId));
  return { offer: o, subjectRow: s! };
}

async function boardRules(executor: Executor, boardCode: string) {
  const [b] = await executor.select({ code: examBoard.code, name: examBoard.name, onePaperAsksSitting: examBoard.onePaperAsksSitting, onePaperFeeKey: examBoard.onePaperFeeKey, carryForwardMonths: examBoard.carryForwardMonths })
    .from(examBoard).where(eq(examBoard.code, boardCode));
  if (!b) throw new SetupError('Board not found', 404);
  return b;
}

/** The group of the school a subject is in (D1, D10): O.L. for an IGCSE subject, else A.S./A.L. */
export const groupOfLevel = (level: string) => (level === 'igcse' ? 'O.L.' : 'A.S./A.L.') as 'O.L.' | 'A.S./A.L.';

const cellsOf = (i: Pick<ItemRow, 'firstInSchool' | 'retakeInSchool' | 'retakeSelfStudy' | 'firstSelfStudy'>): Cells => ({
  firstInSchool: i.firstInSchool, retakeInSchool: i.retakeInSchool, retakeSelfStudy: i.retakeSelfStudy, firstSelfStudy: i.firstSelfStudy,
});
const CELL_OPTION: Record<keyof Cells, { attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study'; words: string }> = {
  firstInSchool: { attempt: 'first', mode: 'in_school', words: 'first entry in school' },
  retakeInSchool: { attempt: 'retake', mode: 'in_school', words: 'retake in school' },
  retakeSelfStudy: { attempt: 'retake', mode: 'self_study', words: 'retake in self study' },
  firstSelfStudy: { attempt: 'first', mode: 'self_study', words: 'first entry in self study' },
};

/** The offer's availability kept in step with its switch and close date (today's line rules read it until P1b). */
const offerAvailability = (accepting: boolean, closesAt: Date | null, now = new Date()) =>
  accepting && !(closesAt && closesAt <= now) ? 'open' : 'closed';

/** A row's availability kept in step with its cells and close date. */
const rowAvailability = (cells: Cells, closesAt: Date | null, now = new Date()) =>
  closesAt && closesAt <= now ? 'closed' : availabilityOf(cells);

// ─── Teachers (D4) ───────────────────────────────────────────────────────────

/**
 * The teachers an offering or a row names: one from the school's list (active), or a new name —
 * refused when it looks like a teacher already on the list until it is confirmed new (the duplicate
 * check), then made (an external team as a provider). Each joins the subject's pool.
 */
async function resolveTeachers(tx: Tx, subjectId: string, inputs: OfferingTeacherInputType[], actorId: string) {
  const out: { teacherId: string; mode: 'in_school' | 'online' }[] = [];
  for (const t of inputs) {
    let teacherId: string;
    if ('teacherId' in t) {
      const [row] = await tx.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(teacher).where(eq(teacher.id, t.teacherId));
      if (!row) throw new SetupError('Teacher not found', 404);
      if (!row.isActive) throw new SetupError(`${row.name} is inactive`);
      teacherId = row.id;
    } else {
      const dups = await teacherDuplicates(tx, t.newName);
      if (dups.length && !t.confirmNew) throw new SetupError(duplicateTeacherRefusal(t.newName, dups), 409);
      teacherId = randomUUID();
      const kind = t.external ? 'provider' : 'person';
      await tx.insert(teacher).values({ id: teacherId, name: t.newName, kind, isActive: true });
      await logAction(actorId, 'TEACHER_CREATED', 'teacher', teacherId, null, { name: t.newName, kind, via: 'the subject editor', confirmedNew: dups.length > 0 }, undefined, tx);
    }
    if (out.some((o) => o.teacherId === teacherId)) continue;
    await tx.insert(subjectTeacher).values({ id: randomUUID(), subjectId, teacherId }).onConflictDoNothing();
    out.push({ teacherId, mode: t.online ? 'online' : 'in_school' });
  }
  return out;
}

const sameTeachers = (a: { teacherId: string; mode: string }[], b: { teacherId: string; mode: string }[]) =>
  a.length === b.length && a.every((t, i) => t.teacherId === b[i]!.teacherId && t.mode === b[i]!.mode);

/** The teachers a body names, read without writing (null: a new name, so a change). */
function namedTeachers(inputs: OfferingTeacherInputType[]): { teacherId: string; mode: string }[] | null {
  const out: { teacherId: string; mode: string }[] = [];
  for (const t of inputs) {
    if (!('teacherId' in t)) return null;
    if (!out.some((o) => o.teacherId === t.teacherId)) out.push({ teacherId: t.teacherId, mode: t.online ? 'online' : 'in_school' });
  }
  return out;
}

// ─── Questions (D13) ─────────────────────────────────────────────────────────

/**
 * Replace the questions of a session (offeringId null) or of one subject: each kept, changed, added or
 * removed — a question with answers is never removed (it is history). Returns whether anything changed.
 */
export async function writeQuestions(tx: Tx, sessionId: string, offeringId: string | null, inputs: QuestionInputType[], actorId: string) {
  const current = await tx.select().from(sessionQuestion)
    .where(and(eq(sessionQuestion.sessionId, sessionId), offeringId ? eq(sessionQuestion.offeringId, offeringId) : sql`${sessionQuestion.offeringId} is null`))
    .orderBy(asc(sessionQuestion.sortOrder)).for('update');
  let changed = false;
  const kept = new Set<string>();
  for (const [i, q] of inputs.entries()) {
    if (q.id) {
      const cur = current.find((c) => c.id === q.id);
      if (!cur) throw new SetupError('That question is not here', 404);
      kept.add(cur.id);
      const same = cur.kind === q.kind && cur.prompt === q.prompt && JSON.stringify(cur.choices) === JSON.stringify(q.choices) && cur.required === q.required && cur.sortOrder === i;
      if (same) continue;
      await tx.update(sessionQuestion).set({ kind: q.kind, prompt: q.prompt, choices: q.choices, required: q.required, sortOrder: i, updatedAt: new Date() })
        .where(eq(sessionQuestion.id, cur.id));
      changed = true;
    } else {
      await tx.insert(sessionQuestion).values({ id: randomUUID(), sessionId, offeringId, kind: q.kind, prompt: q.prompt, choices: q.choices, required: q.required, sortOrder: i, createdBy: actorId });
      changed = true;
    }
  }
  for (const c of current.filter((x) => !kept.has(x.id))) {
    const [answered] = await tx.select({ id: registrationAnswer.id }).from(registrationAnswer).where(eq(registrationAnswer.questionId, c.id)).limit(1);
    if (answered) throw new SetupError(`"${c.prompt}" has answers: it is kept with them (change its words instead)`, 409);
    await tx.delete(sessionQuestion).where(eq(sessionQuestion.id, c.id));
    changed = true;
  }
  return changed;
}

// ─── Rows ────────────────────────────────────────────────────────────────────

type RowContext = { session: SessionRow; offer: OfferRow; subjectRow: SubjectRow; board: Awaited<ReturnType<typeof boardRules>>; actorId: string };

/** The reference row a row comes from (the offering's reference subject, by its stable key). */
async function referenceRowOf(executor: Executor, offer: Pick<OfferRow, 'referenceCode'>, boardCode: string, key: string | null | undefined) {
  if (!key || !offer.referenceCode) return null;
  const [r] = await executor.select().from(referenceRow).where(eq(referenceRow.id, `${boardCode}:${offer.referenceCode}:${key}`));
  return r ?? null;
}

/** The school's level of an offering's subject (the reference's, else from the subject row): 'igcse' or 'as_al'. */
async function referenceLevelOf(executor: Executor, offer: Pick<OfferRow, 'referenceCode'>, subjectRow: SubjectRow): Promise<'igcse' | 'as_al'> {
  if (offer.referenceCode) {
    const [r] = await executor.select({ level: referenceSubject.level }).from(referenceSubject).where(eq(referenceSubject.id, `${subjectRow.council}:${offer.referenceCode}`));
    if (r) return r.level as 'igcse' | 'as_al';
  }
  return subjectRow.qualificationLevel === 'igcse' ? 'igcse' : 'as_al';
}

/**
 * A row's board series for its sitting in this session (created with no dates when not on record; linked).
 * A winter row's "November" is the board's autumn sitting of its subject's level in the reference data
 * (Pearson sits International A Levels in October, International GCSEs in November: the school calls
 * both "November"); with none on record, November.
 */
async function seriesForSitting(tx: Tx, c: RowContext, sitting: Sitting) {
  const at = seriesOfSitting(c.session.sessionType, c.session.seriesYear, sitting);
  if (!at) {
    throw new SetupError(c.session.sessionType === 'june'
      ? 'A June session\'s rows sit in June'
      : 'A winter session\'s rows sit in November or January');
  }
  if (sitting === 'november') {
    const level = await referenceLevelOf(tx, c.offer, c.subjectRow);
    const [autumn] = await tx.select({ month: boardSeries.month }).from(boardSeries)
      .where(and(eq(boardSeries.boardCode, c.subjectRow.council), eq(boardSeries.label, ''), eq(boardSeries.year, at.year),
        inArray(boardSeries.month, ['october', 'november']), sql`${level} = any(${boardSeries.levels})`))
      .orderBy(sql`${boardSeries.month} = 'november' desc`);
    if (autumn) at.month = autumn.month as 'october' | 'november';
  }
  // The session's label names its own sittings (a converted window's, a second cycle's); '' for every new session.
  const s = await findOrCreateSeries(tx, c.subjectRow.council, at.month, at.year, c.session.label, c.actorId,
    'Created when a row of a session was placed in this sitting (no dates yet: the reference data, or the admin from the check list, gives them)');
  await attachSeries(tx, c.session.id, s.id, c.actorId);
  return s.id;
}

/** D6: the sittings a row may carry from, as the board's series (created with no dates when not on record). */
async function priorSittings(tx: Tx, c: RowContext, list: { month: string; year: number }[] | undefined, rowSeriesId: string) {
  if (!list) return undefined;
  const [here] = await tx.select({ month: boardSeries.month, year: boardSeries.year }).from(boardSeries).where(eq(boardSeries.id, rowSeriesId));
  const order = (m: string, y: number) => y * 12 + ({ january: 1, june: 6, october: 10, november: 11 }[m] ?? 0);
  const ids: string[] = [];
  for (const p of list) {
    if (here && order(p.month, p.year) >= order(here.month, here.year)) {
      throw new SetupError(`${p.month.charAt(0).toUpperCase()}${p.month.slice(1)} ${p.year} is not before the row's own sitting: a retake carries from an earlier one`);
    }
    const s = await findOrCreateSeries(tx, c.subjectRow.council, p.month as 'january' | 'june' | 'october' | 'november', p.year, '', c.actorId,
      'Created when a row named it as a sitting a retake may carry from (no dates: an earlier sitting)');
    if (!ids.includes(s.id)) ids.push(s.id);
  }
  return ids;
}

/**
 * D6's default list: the board's two sittings before the row's own (June 2027 on Cambridge → November 2026
 * and June 2026), worked out from the months the board sits (IGCSE sits neither October nor January).
 */
async function defaultPriorSittings(tx: Tx, c: RowContext, rowSeriesId: string) {
  const [here] = await tx.select({ month: boardSeries.month, year: boardSeries.year }).from(boardSeries).where(eq(boardSeries.id, rowSeriesId));
  const [b] = await tx.select({ months: examBoard.seriesMonths }).from(examBoard).where(eq(examBoard.code, c.subjectRow.council));
  if (!here || !b) return [];
  const igcse = c.subjectRow.qualificationLevel === 'igcse';
  const months = (['november', 'october', 'june', 'january'] as const).filter((m) => b.months.includes(m) && !(igcse && (m === 'october' || m === 'january')));
  const index: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };
  const out: { month: (typeof months)[number]; year: number }[] = [];
  for (let y = here.year; y >= here.year - 3 && out.length < 2; y--) {
    for (const m of months) {
      if (y === here.year && index[m]! >= index[here.month]!) continue;
      out.push({ month: m, year: y });
      if (out.length === 2) break;
    }
  }
  return out;
}

async function writeRowTeachers(tx: Tx, itemId: string, teachers: { teacherId: string; mode: string }[]) {
  await tx.delete(sessionOfferItemTeacher).where(eq(sessionOfferItemTeacher.itemId, itemId));
  if (teachers.length) await tx.insert(sessionOfferItemTeacher).values(teachers.map((t, i) => ({ id: randomUUID(), itemId, teacherId: t.teacherId, mode: t.mode, sortOrder: i })));
}

/** The live lines of a row per option (attempt, mode), and every line of it (history included). */
async function linesOfRows(executor: Executor, itemIds: string[]) {
  if (!itemIds.length) return [] as { itemId: string; attempt: string; mode: string; status: string; n: number }[];
  return executor.select({ itemId: registration.offerItemId, attempt: registration.attempt, mode: registration.mode, status: registration.status, n: sql<number>`count(*)::int` })
    .from(registration).where(inArray(registration.offerItemId, itemIds))
    .groupBy(registration.offerItemId, registration.attempt, registration.mode, registration.status);
}

type RowWrite = { id: string; created: boolean; priceChanged: boolean; changed: boolean; closedNow: boolean };

/**
 * Create or change one row in the caller's transaction (the offering and its rows held). Only what
 * differs is written; a change that unticks a cell lines use is refused (close the row instead); a
 * sitting changes only while no line uses the row (§6). Returns what changed, for the impact.
 */
async function writeRow(tx: Tx, c: RowContext, input: OfferingRowInputType, existing: ItemRow | null, sortOrder: number, lines: Awaited<ReturnType<typeof linesOfRows>>): Promise<RowWrite> {
  const now = new Date();
  const kind = input.kind;
  if (existing && existing.kind !== kind) throw new SetupError(`${existing.label}: a row keeps its kind — add another row instead`, 409);
  if (kind === 'paper' && (input.cells.firstInSchool || input.cells.firstSelfStudy)) {
    throw new SetupError('A one-paper row is always a retake: it takes no first entry');
  }
  if (kind === 'custom' && !input.name && !existing) throw new SetupError('A custom row has a name');
  const ref = await referenceRowOf(tx, c.offer, c.subjectRow.council, input.referenceKey ?? existing?.referenceKey);
  if (input.referenceKey && !ref && c.offer.referenceCode) throw new SetupError(`${input.referenceKey} is not one of this subject's rows on the reference list`, 404);
  const codes = input.referenceCodes ?? (existing ? existing.referenceCodes : ref?.codes ?? []);
  // The stored label (D9): generated from the kind, the reference row's short name and the codes; an all-papers
  // row keeps the label every row of its kind has had ("Whole subject" — screens and families read "All papers");
  // a custom row her name.
  const label = kind === 'custom'
    ? (input.name ?? existing!.label)
    : kind === 'all_papers' ? WHOLE_ITEM_LABEL
      : ref ? rowLabel(labelRowOf({ kind, label: '', short: ref.short, referenceCodes: codes }), 'en')
        // A row from no reference row: her name for it with its code ("GCE A Level (9AA0)"), else the generated words.
        : input.name ? (codes[0] && !input.name.includes(codes[0]) ? `${input.name} (${codes[0]})` : input.name)
          : existing && !input.referenceCodes ? existing.label : rowLabel(labelRowOf({ kind, label: '', short: null, referenceCodes: codes }), 'en');
  const currentSitting = existing?.boardSeriesId
    ? sittingOfSeries(c.session.sessionType, (await tx.select({ month: boardSeries.month }).from(boardSeries).where(eq(boardSeries.id, existing.boardSeriesId)))[0]?.month ?? null)
    : null;
  const [refSubject] = c.offer.referenceCode
    ? await tx.select({ winterSitting: referenceSubject.winterSitting }).from(referenceSubject).where(eq(referenceSubject.id, `${c.subjectRow.council}:${c.offer.referenceCode}`))
    : [];
  const rowWinter = ref?.winterSitting && ref.winterSitting !== 'none' ? ref.winterSitting : null;
  const sitting = input.sitting ?? currentSitting ?? defaultSitting(c.session.sessionType, rowWinter ?? refSubject?.winterSitting);
  const mine = lines.filter((l) => existing && l.itemId === existing.id);
  const live = mine.filter((l) => LIVE.includes(l.status));
  let seriesId = existing?.boardSeriesId ?? null;
  if (!existing || sitting !== currentSitting) {
    if (existing && mine.length) throw new SetupError(`${label} has reservations in its sitting: a row's sitting does not change while reservations use it — close the row and add another`, 409);
    seriesId = await seriesForSitting(tx, c, sitting);
  }
  // A cell unticked while lines use it is refused (§6: refused if lines use it; closing the row is offered instead).
  if (existing) {
    for (const [cell, opt] of Object.entries(CELL_OPTION) as [keyof Cells, (typeof CELL_OPTION)[keyof Cells]][]) {
      if (existing[cell] && !input.cells[cell]) {
        const using = live.filter((l) => l.attempt === opt.attempt && l.mode === opt.mode).reduce((a, l) => a + l.n, 0);
        if (using) throw new SetupError(`${label}: ${using} reservation${using === 1 ? '' : 's'} use the ${opt.words} option — it stays ticked; close the row to stop new ones`, 409);
      }
    }
  }
  // D6: a new row that asks the sitting it carries from starts with the board's two previous sittings.
  const needsPrior = needsPriorFor(kind, c.board.onePaperAsksSitting);
  const priorList = input.allowedPriorSittings ?? (!existing && needsPrior ? await defaultPriorSittings(tx, c, seriesId!) : undefined);
  const priors = await priorSittings(tx, c, priorList, seriesId!);
  const closesAt = input.closesAt !== undefined ? input.closesAt : existing?.closesAt ?? null;
  const payBy = input.payBy !== undefined ? input.payBy : existing?.payBy ?? null;
  // The exam fee: typed, or the board rule / sum of units filled in (price-list.services fills those).
  let examFee = existing?.examFee ?? null;
  let examFeeSource = existing?.examFeeSource ?? null;
  let priceListRowId = existing?.priceListRowId ?? null;
  if (input.examFee !== undefined && input.examFee !== examFee) {
    examFee = input.examFee;
    examFeeSource = input.examFee === null ? null : input.examFeeSource && input.examFeeSource !== 'list' ? input.examFeeSource : 'typed';
    priceListRowId = null;
  }
  const courseFee = input.courseFee !== undefined ? input.courseFee : existing?.courseFee ?? null;
  const selfStudyFee = input.selfStudyFee !== undefined ? input.selfStudyFee : existing?.selfStudyFee ?? null;
  const cells: Cells = { ...NO_CELLS, ...input.cells };
  const values = {
    label, kind, referenceKey: ref?.key ?? (input.referenceKey === null ? null : existing?.referenceKey ?? null), referenceCodes: codes,
    boardSeriesId: seriesId, closesAt, payBy, examFee, examFeeSource, priceListRowId, courseFee, selfStudyFee,
    ...cells,
    availability: rowAvailability(cells, closesAt, now),
    needsPriorSeries: needsPrior,
    exclusiveGroup: exclusiveGroupFor(kind),
    allowedPriorSeriesIds: priors ?? existing?.allowedPriorSeriesIds ?? [],
    sortOrder,
    // Saved by her, the row is reviewed: cells a default ticked (§3) are now hers.
    cellsByDefault: [] as string[],
  };
  // The row's own teachers (null or empty: the offering's).
  const own = input.teachers === undefined ? undefined : await resolveTeachers(tx, c.offer.subjectId, input.teachers ?? [], c.actorId);
  if (!existing) {
    const id = randomUUID();
    await tx.insert(sessionOfferItem).values({
      id, offerId: c.offer.id, sessionId: c.session.id, entersKind: 'subject', qualificationId: null, qualificationOptionId: null,
      requiredInSeries: false, createdBy: c.actorId, ...values,
    });
    if (own?.length) await writeRowTeachers(tx, id, own);
    await logAction(c.actorId, 'OFFER_ITEM_CREATED', 'offer_item', id, null, { offerId: c.offer.id, ...values, teachers: own ?? [], via: 'the subject editor' }, undefined, tx);
    return { id, created: true, priceChanged: false, changed: true, closedNow: false };
  }
  const before = {
    label: existing.label, kind: existing.kind, referenceKey: existing.referenceKey, referenceCodes: existing.referenceCodes, boardSeriesId: existing.boardSeriesId,
    closesAt: existing.closesAt, payBy: existing.payBy, examFee: existing.examFee, examFeeSource: existing.examFeeSource, priceListRowId: existing.priceListRowId,
    courseFee: existing.courseFee, selfStudyFee: existing.selfStudyFee, ...cellsOf(existing), availability: existing.availability,
    needsPriorSeries: existing.needsPriorSeries, exclusiveGroup: existing.exclusiveGroup, allowedPriorSeriesIds: existing.allowedPriorSeriesIds, sortOrder: existing.sortOrder,
    cellsByDefault: existing.cellsByDefault,
  };
  const diff = Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((before as Record<string, unknown>)[k])));
  const currentTeachers = (await tx.select().from(sessionOfferItemTeacher).where(eq(sessionOfferItemTeacher.itemId, existing.id)).orderBy(asc(sessionOfferItemTeacher.sortOrder)))
    .map((t) => ({ teacherId: t.teacherId, mode: t.mode }));
  const teachersChange = own !== undefined && !sameTeachers(own, currentTeachers);
  if (!Object.keys(diff).length && !teachersChange) return { id: existing.id, created: false, priceChanged: false, changed: false, closedNow: false };
  if (Object.keys(diff).length) await tx.update(sessionOfferItem).set({ ...diff, updatedAt: now }).where(eq(sessionOfferItem.id, existing.id));
  if (teachersChange) await writeRowTeachers(tx, existing.id, own!);
  await logAction(c.actorId, 'OFFER_ITEM_UPDATED', 'offer_item', existing.id,
    Object.fromEntries(Object.keys(diff).map((k) => [k, (before as Record<string, unknown>)[k] ?? null])),
    { ...diff, ...(teachersChange ? { teachers: own } : {}), via: 'the subject editor' }, undefined, tx);
  const priceChanged = 'examFee' in diff || 'courseFee' in diff || 'selfStudyFee' in diff;
  const closedNow = !!(closesAt && closesAt <= now) && !(existing.closesAt && existing.closesAt <= now);
  return { id: existing.id, created: false, priceChanged, changed: true, closedNow };
}

/** A row left out of the set: removed when nothing ever used it, closed (kept for its history) when only history does; refused with live lines. */
async function removeRow(tx: Tx, c: RowContext, row: ItemRow, lines: Awaited<ReturnType<typeof linesOfRows>>) {
  const mine = lines.filter((l) => l.itemId === row.id);
  const live = mine.filter((l) => LIVE.includes(l.status)).reduce((a, l) => a + l.n, 0);
  if (live) throw new SetupError(`${row.label} has ${live} reservation${live === 1 ? '' : 's'}: a row with reservations is not removed — close it instead (they stand)`, 409);
  if (mine.length) {
    await tx.update(sessionOfferItem).set({ ...NO_CELLS, availability: 'closed', closesAt: row.closesAt ?? new Date(), updatedAt: new Date() }).where(eq(sessionOfferItem.id, row.id));
    await logAction(c.actorId, 'OFFER_ITEM_UPDATED', 'offer_item', row.id, { ...cellsOf(row), availability: row.availability }, { ...NO_CELLS, availability: 'closed', reason: 'Removed from the subject: kept closed for its history' }, undefined, tx);
    return;
  }
  await tx.delete(sessionOfferItem).where(eq(sessionOfferItem.id, row.id));
  await logAction(c.actorId, 'OFFER_ITEM_DELETED', 'offer_item', row.id, { offerId: row.offerId, label: row.label, kind: row.kind, boardSeriesId: row.boardSeriesId }, null, undefined, tx);
}

// ─── Adding a subject (D1) ───────────────────────────────────────────────────

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'subject';
const levelOfReference = (level: string) => (level === 'igcse' ? 'igcse' : 'a_level');

/** A reference or custom subject as a `subject` row, made on first use (§9.1: code = the reference code, or X-<board>-<slug>). */
async function subjectRowFor(tx: Tx, a: { board: string; name: string; code: string | null; level: 'igcse' | 'as_al' }, actorId: string) {
  const code = a.code ?? `X-${a.board}-${slug(a.name)}`;
  const [found] = await tx.select().from(subject).where(eq(subject.code, code)).for('share');
  if (found) {
    if (found.council !== a.board) throw new SetupError(`The code ${code} is ${found.name}'s, entered with another board`, 409);
    if (!found.isActive) throw new SetupError(`${found.name} is inactive`, 409);
    return found;
  }
  const id = randomUUID();
  const [made] = await tx.insert(subject).values({
    id, name: a.name, code, council: a.board, qualificationLevel: levelOfReference(a.level), courseFee: 0, registrationFee: 0, priceInSchool: 0,
    isOfferedAtSchool: true, isActive: true, isCore: false,
  }).returning();
  await logAction(actorId, 'SUBJECT_CREATED', 'subject', id, null, { name: a.name, code, council: a.board, via: a.code ? 'the reference list' : 'not on the list' }, undefined, tx);
  return made!;
}

/** POST /sessions/:id/offerings — a subject from the reference list, not on the list, or a copy of another offering. */
export async function addOffering(sessionId: string, input: AddOfferingType, actorId: string, ctx?: AuditContext) {
  let offeringId: string;
  try {
    offeringId = await db.transaction(async (tx) => {
      const session = await sessionForSetup(tx, sessionId);
      if ('copyFromOfferingId' in input) {
        const [src] = await tx.select().from(sessionOffer).where(eq(sessionOffer.id, input.copyFromOfferingId));
        if (!src) throw new SetupError('The subject to copy from was not found', 404);
        const [srcSession] = await tx.select().from(registrationSession).where(eq(registrationSession.id, src.sessionId));
        return copyOfferingInto(tx, session, src, srcSession!, actorId, ctx);
      }
      let subjectRow: SubjectRow;
      let referenceCode: string | null = null;
      let refRows: (typeof referenceRow.$inferSelect)[] = [];
      let winter: string | null = null;
      if ('referenceCode' in input) {
        const found = await findReferenceSubject(tx, input.referenceCode, input.board);
        if (found.ambiguous) throw new SetupError(`Two boards list ${input.referenceCode}: say which board`, 400);
        if (!found.subject) throw new SetupError(`${input.referenceCode} is not on the reference list: add it as a subject not on the list`, 404);
        subjectRow = await subjectRowFor(tx, { board: found.subject.boardCode, name: found.subject.name, code: found.subject.code, level: found.subject.level as 'igcse' | 'as_al' }, actorId);
        referenceCode = found.subject.code;
        refRows = found.rows!;
        winter = found.subject.winterSitting;
      } else {
        subjectRow = await subjectRowFor(tx, { board: input.custom.board, name: input.custom.name, code: input.custom.code ?? null, level: input.custom.level }, actorId);
      }
      const [dup] = await tx.select({ id: sessionOffer.id }).from(sessionOffer).where(and(eq(sessionOffer.sessionId, sessionId), eq(sessionOffer.subjectId, subjectRow.id)));
      if (dup) throw new SetupError(`${subjectRow.name} is already in this session`, 409);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(sessionOffer).where(eq(sessionOffer.sessionId, sessionId)) as [{ n: number }];
      const id = randomUUID();
      const [offer] = await tx.insert(sessionOffer).values({
        id, sessionId, subjectId: subjectRow.id, availability: 'open', courseFee: null, referenceCode, teacherChoice: 'families', teacherTbc: false,
        accepting: true, closesAt: null, sortOrder: n, createdBy: actorId,
      }).returning();
      // The reference's suggested rows (D2), no cell ticked: she ticks what the school offers.
      const board = await boardRules(tx, subjectRow.council);
      const c: RowContext = { session, offer: offer!, subjectRow, board, actorId };
      // A row the reference says is not sat in winter is not suggested in a winter session; each row sits
      // in its own winter sitting where the reference gives one, else the subject's (D12). In D10's order, as
      // every save orders them (all papers, one-paper rows, units, A.S., A.2., A.L., then the rest).
      const suggested = refRows.filter((r) => !(session.sessionType === 'winter' && r.winterSitting === 'none'))
        .map((r, i) => ({ r, i })).sort((a, b) => (KIND_ORDER[a.r.kind] ?? 9) - (KIND_ORDER[b.r.kind] ?? 9) || a.i - b.i).map((x) => x.r);
      for (const [i, r] of suggested.entries()) {
        const sitting = defaultSitting(session.sessionType, r.winterSitting && r.winterSitting !== 'none' ? r.winterSitting : winter);
        await writeRow(tx, c, { kind: r.kind as OfferingRowInputType['kind'], referenceKey: r.key, sitting, cells: { ...NO_CELLS } }, null, i, []);
      }
      await logAction(actorId, 'SESSION_OFFER_CREATED', 'session_offer', id, null,
        { sessionId, subjectId: subjectRow.id, referenceCode, notOnTheList: !referenceCode, suggestedRows: refRows.filter((r) => !(session.sessionType === 'winter' && r.winterSitting === 'none')).length }, ctx, tx);
      return id;
    });
  } catch (err) {
    setupRethrow(err);
  }
  return getOffering(sessionId, offeringId);
}

/**
 * Copy one offering into a session (an offering of another session, or the whole session's copy, C3):
 * its rows, cells, teachers, note, questions and fees, each row in the same sitting of this session and
 * its carried-from list moved by the years between the two sessions, its dates likewise; prices copied as
 * they were (the session's prices are not final until she says so).
 */
export async function copyOfferingInto(tx: Tx, session: SessionRow, src: OfferRow, srcSession: SessionRow, actorId: string, ctx?: AuditContext) {
  const years = session.seriesYear - srcSession.seriesYear;
  const [s] = await tx.select().from(subject).where(eq(subject.id, src.subjectId));
  if (!s || !s.isActive) throw new SetupError('The subject to copy is inactive', 409);
  const [dup] = await tx.select({ id: sessionOffer.id }).from(sessionOffer).where(and(eq(sessionOffer.sessionId, session.id), eq(sessionOffer.subjectId, s.id)));
  if (dup) throw new SetupError(`${s.name} is already in this session`, 409);
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(sessionOffer).where(eq(sessionOffer.sessionId, session.id)) as [{ n: number }];
  const roll = (d: Date | null) => {
    if (!d) return null;
    const out = new Date(d.getTime());
    out.setUTCFullYear(out.getUTCFullYear() + years);
    return out;
  };
  const id = randomUUID();
  const [offer] = await tx.insert(sessionOffer).values({
    id, sessionId: session.id, subjectId: s.id, availability: 'open', courseFee: src.courseFee, courseStartsOn: null, grade10Core: false, notes: src.notes,
    referenceCode: src.referenceCode, teacherChoice: src.teacherChoice, teacherTbc: src.teacherTbc, accepting: true, closesAt: roll(src.closesAt),
    sortOrder: src.sortOrder ?? n, createdBy: actorId,
  }).returning();
  const teachers = await tx.select({ teacherId: sessionOfferTeacher.teacherId, mode: sessionOfferTeacher.mode, sortOrder: sessionOfferTeacher.sortOrder })
    .from(sessionOfferTeacher).innerJoin(teacher, eq(teacher.id, sessionOfferTeacher.teacherId))
    .where(and(eq(sessionOfferTeacher.offerId, src.id), eq(teacher.isActive, true))).orderBy(asc(sessionOfferTeacher.sortOrder));
  if (teachers.length) await tx.insert(sessionOfferTeacher).values(teachers.map((t) => ({ id: randomUUID(), offerId: id, teacherId: t.teacherId, mode: t.mode, sortOrder: t.sortOrder })));
  const board = await boardRules(tx, s.council);
  const c: RowContext = { session, offer: offer!, subjectRow: s, board, actorId };
  const rows = await tx.select().from(sessionOfferItem).where(eq(sessionOfferItem.offerId, src.id)).orderBy(asc(sessionOfferItem.sortOrder), asc(sessionOfferItem.id));
  let copied = 0;
  for (const r of rows) {
    // A row closed for its history (no cell) stays behind.
    if (!(r.firstInSchool || r.retakeInSchool || r.retakeSelfStudy || r.firstSelfStudy)) continue;
    const [here] = r.boardSeriesId ? await tx.select({ month: boardSeries.month }).from(boardSeries).where(eq(boardSeries.id, r.boardSeriesId)) : [];
    const sitting = sittingOfSeries(srcSession.sessionType, here?.month ?? null) ?? defaultSitting(session.sessionType, null);
    // Her list in her order (the database returns a set).
    const priors = (r.allowedPriorSeriesIds.length
      ? await tx.select({ id: boardSeries.id, month: boardSeries.month, year: boardSeries.year }).from(boardSeries).where(inArray(boardSeries.id, r.allowedPriorSeriesIds))
      : []).sort((a, b) => r.allowedPriorSeriesIds.indexOf(a.id) - r.allowedPriorSeriesIds.indexOf(b.id));
    const ownTeachers = await tx.select({ teacherId: sessionOfferItemTeacher.teacherId, mode: sessionOfferItemTeacher.mode })
      .from(sessionOfferItemTeacher).innerJoin(teacher, eq(teacher.id, sessionOfferItemTeacher.teacherId))
      .where(and(eq(sessionOfferItemTeacher.itemId, r.id), eq(teacher.isActive, true))).orderBy(asc(sessionOfferItemTeacher.sortOrder));
    const written = await writeRow(tx, c, {
      kind: r.kind as OfferingRowInputType['kind'], referenceKey: r.referenceKey, referenceCodes: r.referenceCodes, name: r.kind === 'custom' ? r.label : undefined,
      sitting, closesAt: roll(r.closesAt), payBy: roll(r.payBy), courseFee: r.courseFee, selfStudyFee: r.selfStudyFee, cells: cellsOf(r),
      allowedPriorSittings: priors.map((p) => ({ month: p.month as 'june', year: p.year + years })),
      teachers: ownTeachers.length ? ownTeachers.map((t) => ({ teacherId: t.teacherId, online: t.mode === 'online', external: false })) : null,
    }, null, r.sortOrder, []);
    // Last cycle's exam fee and where it came from (a list's row stays with its own session).
    if (r.examFee !== null) {
      await tx.update(sessionOfferItem).set({ examFee: r.examFee, examFeeSource: r.examFeeSource ?? 'typed' }).where(eq(sessionOfferItem.id, written.id));
    }
    copied++;
  }
  const qs = await tx.select().from(sessionQuestion).where(eq(sessionQuestion.offeringId, src.id)).orderBy(asc(sessionQuestion.sortOrder));
  if (qs.length) {
    await tx.insert(sessionQuestion).values(qs.map((q) => ({
      id: randomUUID(), sessionId: session.id, offeringId: id, kind: q.kind, prompt: q.prompt, choices: q.choices, required: q.required, sortOrder: q.sortOrder, createdBy: actorId,
    })));
  }
  await logAction(actorId, 'SESSION_OFFER_CREATED', 'session_offer', id, null,
    { sessionId: session.id, subjectId: s.id, copiedFrom: src.id, fromSession: srcSession.name, rows: copied, yearsMoved: years }, ctx, tx);
  return id;
}

// ─── The subject editor (PUT) ────────────────────────────────────────────────

export type OfferingSave = { saved: boolean; impact: Impact; repriced: RepricedLine[] };

/**
 * PUT /sessions/:id/offerings/:offeringId — the subject editor saved: its switch and close date, the
 * course fee, who chooses the teacher, the teachers, the rows (the whole set when sent) and the
 * subject's questions. Only what differs is written, each change with its audit row; the same body
 * twice writes nothing. A price change (the course fee, a row's exam fee, course fee or self-study
 * amount) re-prices the unpaid lines it reaches and lists the rest for finance; closing the subject or
 * a row counts the reservations that stand. Answered first when it affects families (`expected`).
 */
export async function updateOffering(sessionId: string, offeringId: string, data: UpdateOfferingType, actorId: string, ctx?: AuditContext): Promise<OfferingSave> {
  try {
    const out = await db.transaction(async (tx) => {
      const session = await sessionForSetup(tx, sessionId);
      const { offer, subjectRow } = await offeringForSetup(tx, sessionId, offeringId);
      const rows = await tx.select().from(sessionOfferItem).where(eq(sessionOfferItem.offerId, offeringId)).orderBy(asc(sessionOfferItem.id)).for('update');
      const lines = await linesOfRows(tx, rows.map((r) => r.id));
      const board = await boardRules(tx, subjectRow.council);
      const c: RowContext = { session, offer, subjectRow, board, actorId };
      const now = new Date();
      let changed = false;
      let linesAffected = 0;

      // The offering's own answers, only those that differ.
      const next: Partial<typeof sessionOffer.$inferInsert> = {};
      if (data.note !== undefined && (data.note?.trim() || null) !== (offer.notes ?? null)) next.notes = data.note?.trim() || null;
      if (data.teacherChoice !== undefined && data.teacherChoice !== offer.teacherChoice) next.teacherChoice = data.teacherChoice;
      if (data.teacherTbc !== undefined && data.teacherTbc !== offer.teacherTbc) next.teacherTbc = data.teacherTbc;
      if (data.accepting !== undefined && data.accepting !== offer.accepting) next.accepting = data.accepting;
      if (data.closesAt !== undefined && (data.closesAt?.getTime() ?? null) !== (offer.closesAt?.getTime() ?? null)) next.closesAt = data.closesAt;
      if (data.courseFee !== undefined && data.courseFee !== offer.courseFee) next.courseFee = data.courseFee;
      const accepting = next.accepting ?? offer.accepting;
      const closesAt = next.closesAt !== undefined ? next.closesAt : offer.closesAt;
      const availability = offerAvailability(accepting, closesAt ?? null, now);
      if (availability !== offer.availability) next.availability = availability;
      // Saved by her, the subject is reviewed: the pre-load's notes leave its check list.
      if (offer.checkNotes.length) next.checkNotes = [];
      const live = (ids: string[]) => lines.filter((l) => ids.includes(l.itemId) && LIVE.includes(l.status)).reduce((a, l) => a + l.n, 0);
      // Closing the subject (its switch off, or a close date reached): the reservations that stand are counted.
      if (offer.availability !== 'closed' && availability === 'closed') linesAffected += live(rows.map((r) => r.id));
      if (Object.keys(next).length) {
        await tx.update(sessionOffer).set({ ...next, updatedAt: now }).where(eq(sessionOffer.id, offeringId));
        await logAction(actorId, 'SESSION_OFFER_UPDATED', 'session_offer', offeringId,
          Object.fromEntries(Object.keys(next).map((k) => [k, (offer as Record<string, unknown>)[k] ?? null])), { ...next, via: 'the subject editor' }, ctx, tx);
        changed = true;
      }
      if (data.teachers) {
        const current = (await tx.select().from(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, offeringId)).orderBy(asc(sessionOfferTeacher.sortOrder)))
          .map((t) => ({ teacherId: t.teacherId, mode: t.mode }));
        const named = namedTeachers(data.teachers);
        if (!named || !sameTeachers(named, current)) {
          const resolved = await resolveTeachers(tx, offer.subjectId, data.teachers, actorId);
          await tx.delete(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, offeringId));
          if (resolved.length) await tx.insert(sessionOfferTeacher).values(resolved.map((t, i) => ({ id: randomUUID(), offerId: offeringId, teacherId: t.teacherId, mode: t.mode, sortOrder: i })));
          await logAction(actorId, 'SESSION_OFFER_UPDATED', 'session_offer', offeringId, { teachers: current }, { teachers: resolved, via: 'the subject editor' }, ctx, tx);
          changed = true;
        }
      }

      // The rows: each sent changed or made; each left out removed or closed.
      const priceRows = new Set<string>();
      if (data.rows) {
        const ids = data.rows.map((r) => r.id).filter((x): x is string => !!x);
        if (new Set(ids).size !== ids.length) throw new SetupError('A row is sent twice');
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const id of ids) if (!byId.has(id)) throw new SetupError('That row is not under this subject', 404);
        // A new row like one the subject has (the same reference row, the same codes, the same name): one the
        // body leaves out is that row, kept (a save sent twice — a double click — changes nothing the second
        // time); one the body keeps, or a second new one, is refused.
        const identity = (r: { kind: string; referenceKey?: string | null; referenceCodes?: string[]; name?: string | null }) =>
          r.referenceKey ? `ref:${r.referenceKey}` : r.referenceCodes?.length ? `codes:${r.kind}:${[...r.referenceCodes].sort().join('|')}` : `name:${r.kind}:${(r.name ?? '').trim().toLowerCase()}`;
        // Named as screens name it (an all-papers row stores "Whole subject" and reads "All papers").
        const shown = (r: ItemRow) => (r.kind === 'all_papers' ? 'All papers' : r.label);
        const kept = new Map(rows.filter((r) => ids.includes(r.id)).map((r) => [identity({ ...r, name: r.label }), shown(r)]));
        const omitted = new Map(rows.filter((r) => !ids.includes(r.id)).map((r) => [identity({ ...r, name: r.label }), r]));
        const sent = data.rows.map((r) => {
          if (r.id) return r;
          const key = identity(r);
          const twin = kept.get(key);
          if (twin) throw new SetupError(`${twin} is already under ${subjectRow.name}: a row is added once`, 409);
          const same = omitted.get(key);
          kept.set(key, same ? shown(same) : r.name ?? r.referenceKey ?? r.kind);
          if (same) {
            omitted.delete(key);
            ids.push(same.id);
            return { ...r, id: same.id };
          }
          return r;
        });
        const ordered = sent.map((r, i) => ({ r, i })).sort((a, b) => (KIND_ORDER[a.r.kind] ?? 9) - (KIND_ORDER[b.r.kind] ?? 9) || a.i - b.i);
        for (const [pos, { r }] of ordered.entries()) {
          const w = await writeRow(tx, c, r, r.id ? byId.get(r.id)! : null, pos, lines);
          if (w.changed) changed = true;
          if (w.priceChanged) priceRows.add(w.id);
          if (w.closedNow) linesAffected += live([w.id]);
        }
        for (const r of rows.filter((x) => !ids.includes(x.id))) {
          await removeRow(tx, c, r, lines);
          changed = true;
        }
        await detachUnusedSeries(tx, sessionId);
      }
      // A course fee change reaches every row priced from it (no course fee of its own).
      if ('courseFee' in next) {
        const now2 = await tx.select({ id: sessionOfferItem.id, courseFee: sessionOfferItem.courseFee }).from(sessionOfferItem).where(eq(sessionOfferItem.offerId, offeringId));
        for (const r of now2) if (r.courseFee === null) priceRows.add(r.id);
      }
      if (data.questions && await writeQuestions(tx, sessionId, offeringId, data.questions, actorId)) {
        await logAction(actorId, 'SESSION_OFFER_UPDATED', 'session_offer', offeringId, null, { questions: data.questions.map((q) => q.prompt), via: 'the subject editor' }, ctx, tx);
        changed = true;
      }

      const plan = await planReprice(tx, { rowIds: [...priceRows] });
      const impact = addImpact(impactOfPlan(plan), { linesAffected });
      settleImpact(impact, data.expected);
      const repriced = await applyReprice(tx, plan, { actorId, reason: `${subjectRow.name}: its price changed in ${session.name}`, entity: { type: 'session_offer', id: offeringId }, ctx });
      return { saved: true, impact: changed || plan.repriced.length ? impact : NO_IMPACT, repriced, subjectName: subjectRow.name, sessionName: session.name };
    });
    await tellRepriced(out.repriced, `${out.subjectName}'s price changed in ${out.sessionName}`);
    return { saved: true, impact: out.impact, repriced: out.repriced };
  } catch (err) {
    if (err instanceof ImpactPending) return { saved: false, impact: err.impact, repriced: [] };
    setupRethrow(err);
  }
}

/** DELETE /sessions/:id/offerings/:offeringId — refused while any line exists (close it instead). */
export async function deleteOffering(sessionId: string, offeringId: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    await sessionForSetup(tx, sessionId);
    const { offer, subjectRow } = await offeringForSetup(tx, sessionId, offeringId);
    const [line] = await tx.select({ id: registration.id }).from(registration)
      .innerJoin(sessionOfferItem, eq(sessionOfferItem.id, registration.offerItemId))
      .where(eq(sessionOfferItem.offerId, offeringId)).limit(1);
    if (line) throw new SetupError(`${subjectRow.name} has reservations in this session: close it instead (they stand)`, 409);
    await tx.delete(sessionOffer).where(eq(sessionOffer.id, offeringId));
    await detachUnusedSeries(tx, sessionId);
    await logAction(actorId, 'SESSION_OFFER_DELETED', 'session_offer', offeringId, { sessionId, subjectId: offer.subjectId, referenceCode: offer.referenceCode }, null, ctx, tx);
    return { deleted: offeringId };
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * GET /sessions/:id/offerings/:offeringId — the subject editor's read: the offering, its rows (cells,
 * fees, sitting, carried-from list, own teachers, the reservations each holds), its teachers and questions.
 */
export async function getOffering(sessionId: string, offeringId: string, executor: Executor = db) {
  const [o] = await executor.select({ offer: sessionOffer, subject: subject, sessionType: registrationSession.sessionType, sessionLabel: registrationSession.label })
    .from(sessionOffer).innerJoin(subject, eq(subject.id, sessionOffer.subjectId)).innerJoin(registrationSession, eq(registrationSession.id, sessionOffer.sessionId))
    .where(and(eq(sessionOffer.id, offeringId), eq(sessionOffer.sessionId, sessionId)));
  if (!o) throw new SetupError('That subject is not in this session', 404);
  const list = await offeringsView(executor, sessionId, [offeringId]);
  return list[0]!;
}

/** The offerings of a session as the editor and the session screen read them (all, or some). */
export async function offeringsView(executor: Executor, sessionId: string, offeringIds?: string[]) {
  const [session] = await executor.select().from(registrationSession).where(eq(registrationSession.id, sessionId));
  if (!session) throw new SetupError('Session not found', 404);
  const offers = await executor.select({ offer: sessionOffer, subject: subject, boardName: examBoard.name, onePaperFeeKey: examBoard.onePaperFeeKey, carryForwardMonths: examBoard.carryForwardMonths })
    .from(sessionOffer).innerJoin(subject, eq(subject.id, sessionOffer.subjectId)).innerJoin(examBoard, eq(examBoard.code, subject.council))
    .where(offeringIds ? and(eq(sessionOffer.sessionId, sessionId), inArray(sessionOffer.id, offeringIds)) : eq(sessionOffer.sessionId, sessionId))
    .orderBy(asc(sessionOffer.sortOrder), asc(subject.name));
  const ids = offers.map((o) => o.offer.id);
  if (!ids.length) return [];
  const [teachers, rows, questions] = await Promise.all([
    executor.select({ offerId: sessionOfferTeacher.offerId, teacherId: teacher.id, name: teacher.name, kind: teacher.kind, mode: sessionOfferTeacher.mode })
      .from(sessionOfferTeacher).innerJoin(teacher, eq(teacher.id, sessionOfferTeacher.teacherId)).where(inArray(sessionOfferTeacher.offerId, ids)).orderBy(asc(sessionOfferTeacher.sortOrder)),
    executor.select().from(sessionOfferItem).where(inArray(sessionOfferItem.offerId, ids)).orderBy(asc(sessionOfferItem.sortOrder), asc(sessionOfferItem.id)),
    executor.select().from(sessionQuestion).where(and(eq(sessionQuestion.sessionId, sessionId), inArray(sessionQuestion.offeringId, ids))).orderBy(asc(sessionQuestion.sortOrder)),
  ]);
  const rowIds = rows.map((r) => r.id);
  const seriesIds = [...new Set(rows.flatMap((r) => [r.boardSeriesId, ...r.allowedPriorSeriesIds]).filter((x): x is string => !!x))];
  const [rowTeachers, series, lineCounts, refRows] = await Promise.all([
    rowIds.length ? executor.select({ itemId: sessionOfferItemTeacher.itemId, teacherId: teacher.id, name: teacher.name, kind: teacher.kind, mode: sessionOfferItemTeacher.mode })
      .from(sessionOfferItemTeacher).innerJoin(teacher, eq(teacher.id, sessionOfferItemTeacher.teacherId)).where(inArray(sessionOfferItemTeacher.itemId, rowIds)).orderBy(asc(sessionOfferItemTeacher.sortOrder)) : [],
    seriesIds.length ? executor.select().from(boardSeries).where(inArray(boardSeries.id, seriesIds)) : [],
    linesOfRows(executor, rowIds),
    executor.select().from(referenceRow).where(inArray(referenceRow.id, rows.filter((r) => r.referenceKey).map((r) => {
      const o = offers.find((x) => x.offer.id === r.offerId)!;
      return `${o.subject.council}:${o.offer.referenceCode}:${r.referenceKey}`;
    }).concat('__none__'))),
  ]);
  const seriesById = new Map(series.map((s) => [s.id, s]));
  const order = (m: string, y: number) => y * 12 + ({ january: 1, june: 6, october: 10, november: 11 }[m] ?? 0);
  return offers.map(({ offer, subject: s, boardName, onePaperFeeKey, carryForwardMonths }) => {
    const mine = rows.filter((r) => r.offerId === offer.id);
    const view = mine.map((r) => {
      const here = r.boardSeriesId ? seriesById.get(r.boardSeriesId) : undefined;
      const counts = lineCounts.filter((l) => l.itemId === r.id);
      const ref = refRows.find((x) => x.id === `${s.council}:${offer.referenceCode}:${r.referenceKey}`);
      const priors = r.allowedPriorSeriesIds.map((id) => seriesById.get(id)).filter((x): x is NonNullable<typeof x> => !!x)
        .map((p) => ({
          id: p.id, month: p.month, year: p.year,
          // D6: older than the board's carry-forward period is a warning, not a refusal.
          beyondCarryForward: !!(here && carryForwardMonths && order(here.month, here.year) - order(p.month, p.year) > carryForwardMonths),
        }));
      return {
        // As screens show it (D9): "All papers", "Paper 41/42 only"; in Arabic too.
        id: r.id, kind: r.kind, label: rowLabel(labelRowOf({ ...r, short: ref?.short ?? null, fromReference: !!ref }), 'en'),
        labelAr: rowLabel(labelRowOf({ ...r, short: ref?.short ?? null, fromReference: !!ref }), 'ar'),
        short: ref?.short ?? null, fromReference: !!ref, referenceKey: r.referenceKey, referenceCodes: r.referenceCodes,
        sitting: sittingOfSeries(session.sessionType, here?.month ?? null),
        // C6, §14: a sitting a session uses needs its entry deadline before the session opens.
        series: here ? { id: here.id, month: here.month, year: here.year, label: here.label, entryDeadline: here.entryDeadline, examsStart: here.examsStart, hasBoardDate: !!here.entryDeadline } : null,
        closesAt: r.closesAt, payBy: r.payBy,
        examFee: r.examFee, examFeeSource: r.examFeeSource, priceListRowId: r.priceListRowId,
        courseFee: r.courseFee, selfStudyFee: r.selfStudyFee,
        cells: cellsOf(r),
        allowedPriorSittings: priors,
        needsCarriedFrom: r.needsPriorSeries,
        exclusiveGroup: r.exclusiveGroup,
        teachers: rowTeachers.filter((t) => t.itemId === r.id).map(({ teacherId, name, kind, mode }) => ({ teacherId, name, external: kind === 'provider', online: mode === 'online' })),
        sortOrder: r.sortOrder,
        cellsByDefault: r.cellsByDefault,
        // A row made by the deprecated routes keeps its fee keys until P1b (priced from the fee grid).
        legacyFeeKeys: r.examFee === null && r.entersKind !== 'subject',
        lines: {
          live: counts.filter((x) => LIVE.includes(x.status)).reduce((a, x) => a + x.n, 0),
          all: counts.reduce((a, x) => a + x.n, 0),
          confirmed: counts.filter((x) => x.status === 'confirmed').reduce((a, x) => a + x.n, 0),
        },
      };
    });
    const ticked = view.filter((r) => r.cells.firstInSchool || r.cells.retakeInSchool || r.cells.retakeSelfStudy || r.cells.firstSelfStudy);
    const priceNotSet = ticked.filter((r) => r.examFee === null || (r.courseFee ?? offer.courseFee) === null).map((r) => r.id);
    return {
      id: offer.id, sessionId, subject: { id: s.id, name: s.name, code: s.code }, referenceCode: offer.referenceCode,
      notOnTheList: !offer.referenceCode,
      board: { code: s.council, name: boardName, onePaperFee: onePaperFeeKey === 'unit' ? 'paper' as const : 'syllabus' as const },
      group: groupOfLevel(s.qualificationLevel),
      note: offer.notes, teacherChoice: offer.teacherChoice, teacherTbc: offer.teacherTbc, accepting: offer.accepting, closesAt: offer.closesAt,
      checkNotes: offer.checkNotes,
      courseFee: offer.courseFee,
      teachers: teachers.filter((t) => t.offerId === offer.id).map(({ teacherId, name, kind, mode }) => ({ teacherId, name, external: kind === 'provider', online: mode === 'online' })),
      rows: view,
      questions: questions.filter((q) => q.offeringId === offer.id).map(({ id, kind, prompt, choices, required }) => ({ id, kind, prompt, choices, required })),
      // E6: a subject with any price not set is not offered to families.
      priceNotSet,
      offeredToFamilies: offer.accepting && ticked.length > 0 && priceNotSet.length === 0,
      lines: view.reduce((a, r) => a + r.lines.live, 0),
    };
  });
}
