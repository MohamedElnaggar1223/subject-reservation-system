/**
 * Exam entries (FEATURES_PLAN.md F4, "Entries" and "Entry lists";
 * DISCOVERY_RESEARCH.md §5 notes 2 and 4).
 *
 * An entry is one unit or award a candidate is entered for with a board in
 * one board series. Since the reservations rework (RESERVATIONS_REWORK.md §9,
 * §10) entries are derived from confirmed lines through `lineItemsFor` — what
 * each line's item enters — and from paid cash-in charges (`chargesOfKind`,
 * `exam_entry.charge_id`): a Cambridge syllabus is entered as the award with
 * the option code that enters its components; Pearson units are entered unit
 * by unit (a whole Pearson award as its required units and the cash-in); an
 * International GCSE as its award. A retake comes from the line's attempt and
 * history; carry forward from the line's verified prior sitting. The
 * coordinator can add an entry by hand (a cash-in whose award its line does
 * not say, a unit of a choice group).
 *
 * The school's hard stop (MO-10, A-08) holds for entries, per line since the
 * rework: no entry is made, and none is marked as sent to the board, after its
 * own deadline (its line's effective deadline: the retake deadline for a retake
 * of the board's previous sitting; a cash-in's service deadline; else the
 * series' entry deadline).
 * A withdrawal after it is recorded with what the board does with its fee,
 * and an amendment follows the board's rules (`exam_board_rule`, data the
 * coordinator keeps). Fees are shown, never charged: nothing here takes or
 * moves family money.
 *
 * Forecast grades come from the teacher who teaches the candidate the subject
 * that year (F0b's `teacherOf`), or the coordinator; Cambridge fixes them once
 * sent. The entry list maps one to one to each board portal's fields (the
 * files are unconfirmed, so every column is marked assumed) and flags every
 * entry missing something the board needs.
 */

import {
  db, examEntry, examBoard, examBoardRule, examSeriesState, registration, qualification, qualificationOption,
  qualificationOptionUnit, qualificationUnit, examUnit, boardSeries, user, teacher, charge,
  eq, and, inArray, sql, asc, isNull,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  ACADEMIC_ROLES, ACCESS_ARRANGEMENT_LABELS, ENTRY_LIST_COLUMNS, GENERIC_ENTRY_LIST_COLUMNS, ENTRY_PROBLEMS, hasRole,
  feeTierOn, forecastGradeProblem, schoolDateString, seriesLabel, seriesAcademicYearStart,
  type AccessArrangement, type CreateEntryType, type DeriveEntriesType, type EntryProblem, type ListEntriesQueryType,
  type SubmitEntriesType, type UpdateBoardRuleType, type UpdateEntryType,
} from '@repo/validations';
import { lineItemsFor, type LineItem } from './line.services';
import { effectiveDeadlinesOf } from './deadline.services';
import { chargesOfKind, chargeDeadline } from './charge.services';
import { teacherOf, pickEnrolment } from './enrolment.services';
import { getSetting } from './settings.services';
import { logAction, type AuditContext } from './audit.services';
import { createBulkNotifications } from './notification.services';
import { candidatesOf, numbersIn } from './exam-candidate.services';
import { schoolDateTime } from './window.services';
import {
  ExamError, advisoryLock, amendmentCharge, boardNameMap, boardRulesFor, boardRulesMap, centreFor, familyOf, hardStopSentence,
  pastEntryDeadline, seriesOrThrow, withdrawalCharge, isUniqueViolation, violatedConstraint,
  type Executor, type SeriesRow, type Tx,
} from './exam-shared';
import { boardSeriesName } from './series.services';

type EntryRow = typeof examEntry.$inferSelect;

const MONTH_NUMBER: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };
const monthIndex = (month: string, year: number) => year * 12 + (MONTH_NUMBER[month] ?? 0);

// ─── Board rules ─────────────────────────────────────────────────────────────

/** Every board with its entry rules (a board with none recorded shows the defaults, marked so). */
export async function listBoardRules() {
  const names = await boardNameMap();
  const rules = await boardRulesMap([...names.keys()]);
  return [...names.entries()].map(([code, name]) => ({ ...rules.get(code)!, boardName: name }));
}

/**
 * Change a board's entry rules (the coordinator's answers: data, not code). The carry-forward
 * period is written to the board's own column (`exam_board.carry_forward_months`, the reservations
 * rework's step A), which the line rules' gate.priorSeries reads too; the rest to F4's rules row.
 * One audit row in the transaction.
 */
export async function updateBoardRule(boardCode: string, data: UpdateBoardRuleType, actorId: string, ctx?: AuditContext) {
  const names = await boardNameMap();
  if (!names.has(boardCode)) throw new ExamError('Board not found', 404);
  const { reason, carryForwardMonths, ...fields } = data;
  const values = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (!Object.keys(values).length && carryForwardMonths === undefined) throw new ExamError('Nothing to change', 400);
  return db.transaction(async (tx) => {
    // The board row first (a rules change and a line's gate.priorSeries read it), then the rules row.
    await tx.select({ code: examBoard.code }).from(examBoard).where(eq(examBoard.code, boardCode)).for('update');
    const before = await boardRulesFor(boardCode, tx);
    if (carryForwardMonths !== undefined) {
      await tx.update(examBoard).set({ carryForwardMonths, updatedAt: new Date() }).where(eq(examBoard.code, boardCode));
    }
    await tx.insert(examBoardRule)
      .values({ boardCode, ...values, updatedBy: actorId })
      .onConflictDoUpdate({ target: examBoardRule.boardCode, set: { ...values, updatedBy: actorId, updatedAt: new Date() } });
    const changed = { ...values, ...(carryForwardMonths !== undefined ? { carryForwardMonths } : {}) };
    const pick = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(changed).map((k) => [k, o[k] ?? null]));
    await logAction(actorId, 'EXAM_BOARD_RULE_UPDATED', 'exam_board_rule', boardCode, pick(before), { ...pick(changed), reason }, ctx, tx);
    return boardRulesFor(boardCode, tx);
  });
}

// ─── Deriving entries from lines and cash-ins ────────────────────────────────

type PlannedEntry = {
  kind: 'unit' | 'award';
  unitId: string | null;
  qualificationId: string | null;
  entryCode: string;
  title: string;
  optionCode: string | null;
  tier: string | null;
  isRetake: boolean;
  retakeSource: 'registration' | 'history' | null;
  carryForward: 'none' | 'suggested' | 'confirmed';
  cfFromMonth: string | null;
  cfFromYear: number | null;
  cfCentreNumber: string | null;
  cfCandidateNumber: string | null;
  cfOption: string | null;
};

/**
 * What a line says now about the fields its reservation governs on an entry (the review of 093dbd1,
 * item 2): whether it is a retake (the attempt as F4 reads it: a rejected declaration is a first
 * entry), the sitting it carries forward from (suggested while declared and not verified, confirmed
 * once known or verified, with the other centre's numbers when verified there), and — a rejected
 * declaration — the sitting no entry may carry from, with the award's carry-forward option codes.
 */
export type LineExpect = {
  retake: boolean;
  carry: { state: 'confirmed' | 'suggested'; month: string; year: number; otherCentre: boolean; centre: string | null; number: string | null } | null;
  rejectedFrom: { month: string; year: number; optionCodes: string[] } | null;
};

type GovernedFields = Pick<EntryRow, 'kind' | 'isRetake' | 'retakeSource' | 'carryForward' | 'cfFromMonth' | 'cfFromYear' | 'cfCentreNumber' | 'cfCandidateNumber' | 'cfOption' | 'optionCode'>;

/**
 * How an entry differs from what its line says now: `retake` and `carry` are what the board sees
 * (the check flags them; a draft is brought up to date by the next derivation, a sent entry is
 * amended by the coordinator); `confirm` is a suggested carry forward whose sitting has since been
 * verified (a draft is confirmed by the next derivation; `carry_forward_to_confirm` flags it).
 * `patch` is what the derivation writes on a draft. Fields the line does not govern (a retake from
 * history or set by staff, a carry forward suggested from history) are never compared.
 */
export function lineDiff(e: GovernedFields, x: LineExpect) {
  const retake = (x.retake && !e.isRetake) || (!x.retake && e.isRetake && e.retakeSource === 'registration');
  let carry = false;
  let confirm = false;
  if (e.kind === 'award' && x.carry) {
    if (e.carryForward === 'none' || e.cfFromMonth !== x.carry.month || e.cfFromYear !== x.carry.year) carry = true;
    else if (x.carry.otherCentre && (e.cfCentreNumber !== x.carry.centre || e.cfCandidateNumber !== x.carry.number)) carry = true;
    else if (x.carry.state === 'confirmed' && e.carryForward === 'suggested') confirm = true;
  }
  const carriesRejected = !!x.rejectedFrom && e.carryForward !== 'none' && e.cfFromMonth === x.rejectedFrom.month && e.cfFromYear === x.rejectedFrom.year;
  const rejectedOption = !!x.rejectedFrom && !!e.optionCode && x.rejectedFrom.optionCodes.includes(e.optionCode);
  if (e.kind === 'award' && (carriesRejected || rejectedOption)) carry = true;
  const patch: Partial<EntryRow> = {};
  if (retake) Object.assign(patch, { isRetake: x.retake, retakeSource: x.retake ? 'registration' : null });
  if ((carry || confirm) && x.carry) {
    Object.assign(patch, {
      carryForward: x.carry.state, cfFromMonth: x.carry.month, cfFromYear: x.carry.year, cfOption: `${x.carry.month}_carry_forward`,
      cfCentreNumber: x.carry.otherCentre ? x.carry.centre : (x.carry.centre ?? e.cfCentreNumber),
      cfCandidateNumber: x.carry.otherCentre ? x.carry.number : (x.carry.number ?? e.cfCandidateNumber),
    });
  }
  if (carry && x.rejectedFrom) {
    if (carriesRejected) Object.assign(patch, { carryForward: 'none', cfFromMonth: null, cfFromYear: null, cfCentreNumber: null, cfCandidateNumber: null, cfOption: null });
    if (rejectedOption) Object.assign(patch, { optionCode: null });
  }
  return { retake, carry, confirm, any: retake || carry || confirm, patch };
}

/**
 * One row of a derivation: a line (`registrationId`) or a cash-in charge (`chargeId`).
 * - 'ready': something new to enter; 'entered': all of it is; 'withdrawn': the coordinator withdrew
 *   it and the line still stands — a derivation never makes it again (adding it back is a
 *   deliberate entry by hand);
 * - 'not_mapped': the item enters a subject row the Catalogue has not mapped;
 * - 'past_deadline': the line's (or charge's) own deadline has passed (MO-10, per line since the
 *   rework: a retake of the board's previous sitting runs to the retake deadline);
 * - 'held': a declared earlier sitting still unverified while the school holds such lines
 *   (`verification.unverifiedAtDeadline = hold`);
 * - 'awaiting_payment': an accepted cash-in not paid yet — entered once paid;
 * - 'choose_award': a paid cash-in whose award the line's item does not say — added by hand.
 * An entry's state: 'new'; 'exists'; 'elsewhere' (entered from another line or cash-in);
 * 'withdrawn' (by the coordinator: not made again); 'refresh' (a draft brought up to date with what
 * its line says now); 'link' (a paid cash-in's award already entered without it: linked to it).
 */
type DeriveRow = {
  registrationId: string | null;
  chargeId: string | null;
  studentId: string;
  studentName: string;
  subject: { id: string; name: string; code: string };
  item: { label: string; kind: string } | null;
  levelCode: string;
  outcome: 'ready' | 'entered' | 'withdrawn' | 'not_mapped' | 'past_deadline' | 'held' | 'awaiting_payment' | 'choose_award';
  note: string | null;
  deadline: { at: Date | null; kind: string | null };
  priorSitting: { name: string; source: string | null; outcome: string | null; declared: boolean } | null;
  /** What the line says now (null for a cash-in): the check compares sent entries with it. */
  expect: LineExpect | null;
  entries: (PlannedEntry & {
    state: 'new' | 'exists' | 'elsewhere' | 'withdrawn' | 'refresh' | 'link';
    existingEntryId: string | null;
    /** 'refresh': what changes on the draft. */
    patch?: Partial<EntryRow>;
  })[];
};

/** The catalogue pieces derivation reads: each award's options (with components) and unit map. */
async function catalogueFor(qualificationIds: string[], executor: Executor) {
  const ids = [...new Set(qualificationIds)];
  if (!ids.length) return { options: [], optionUnits: [], qualUnits: [] };
  const [options, qualUnits] = await Promise.all([
    executor.select().from(qualificationOption).where(and(inArray(qualificationOption.qualificationId, ids), eq(qualificationOption.isActive, true))),
    executor.select({
      qualificationId: qualificationUnit.qualificationId, unitId: qualificationUnit.unitId, requirement: qualificationUnit.requirement,
      choiceGroup: qualificationUnit.choiceGroup, code: examUnit.code, title: examUnit.title, tier: examUnit.tier, shortCode: examUnit.shortCode,
    }).from(qualificationUnit).innerJoin(examUnit, eq(examUnit.id, qualificationUnit.unitId))
      .where(inArray(qualificationUnit.qualificationId, ids)).orderBy(asc(qualificationUnit.sortOrder)),
  ]);
  const optionUnits = options.length
    ? await executor.select().from(qualificationOptionUnit).where(inArray(qualificationOptionUnit.optionId, options.map((o) => o.id)))
    : [];
  return { options, optionUnits, qualUnits };
}

/**
 * The tier an option's tiered components share, if they share one: Cambridge
 * 0610's Extended option enters Papers 2 and 4 (Extended) and Paper 6 (no
 * tier), and is Extended.
 */
function sharedTier(tiers: (string | null)[]): string | null {
  const t = [...new Set(tiers.filter(Boolean))];
  return t.length === 1 ? t[0]! : null;
}

/** A per-line (or per-charge) deadline, as derivation and sending read it. */
type EntryDeadline = { at: Date | null; kind: 'entry' | 'retake' | 'exams_start' | 'cash_in' | null };

/** The refusal once an entry's own deadline has passed (MO-10, A-08; per line since the rework). */
export function entryStopSentence(seriesName: string, d: EntryDeadline): string {
  const when = d.at ? schoolDateTime(d.at) : '';
  if (d.kind === 'retake') return `The retake deadline for ${seriesName} (${when}) has passed: the school makes no new retake entries after it — the board's late entries are not taken (MO-10)`;
  if (d.kind === 'cash_in') return `The board's cash-in deadline for ${seriesName} (${when}) has passed: the school makes no new cash-in entries after it (MO-10)`;
  if (d.kind === 'exams_start') return `${seriesName} has no entry deadline and its exams have started (${when}): the school makes no new entries after it (MO-10)`;
  return `The entry deadline for ${seriesName} (${when}) has passed: the school makes no new entries after it — the board's late entries are not taken (MO-10)`;
}

/** A cash-in's deadline: its service's in the series, else the series' entry deadline. */
function chargeEntryDeadline(c: { deadline: Date | null }, series: { entryDeadline: Date | null }): EntryDeadline {
  if (c.deadline) return { at: c.deadline, kind: 'cash_in' };
  return { at: series.entryDeadline, kind: series.entryDeadline ? 'entry' : null };
}

/**
 * The deadline each entry is sent by: its line's effective deadline (A's `effectiveDeadlinesOf`:
 * the retake deadline for a retake of the board's previous sitting, a late board entry while
 * Q-20's setting is on), its cash-in's service deadline, else the series' entry deadline.
 */
async function deadlinesOfEntries(executor: Executor, entries: Pick<EntryRow, 'id' | 'registrationId' | 'chargeId' | 'boardSeriesId'>[], seriesById: Map<string, { entryDeadline: Date | null }>) {
  const lines = await effectiveDeadlinesOf(executor, [...new Set(entries.map((e) => e.registrationId).filter((x): x is string => !!x))]);
  const chargeIds = [...new Set(entries.map((e) => e.chargeId).filter((x): x is string => !!x))];
  const charges = chargeIds.length ? await executor.select().from(charge).where(inArray(charge.id, chargeIds)) : [];
  const out = new Map<string, EntryDeadline>();
  for (const e of entries) {
    const s = seriesById.get(e.boardSeriesId)!;
    const line = e.registrationId ? lines.get(e.registrationId) : undefined;
    const c = e.chargeId ? charges.find((x) => x.id === e.chargeId) : undefined;
    if (line) out.set(e.id, { at: line.at, kind: line.kind });
    else if (c) out.set(e.id, chargeEntryDeadline({ deadline: await chargeDeadline(executor, c) }, s));
    else out.set(e.id, { at: s.entryDeadline, kind: s.entryDeadline ? 'entry' : null });
  }
  return out;
}

const passed = (d: EntryDeadline, at: Date = new Date()) => !!d.at && d.at.getTime() <= at.getTime();

/**
 * Plan the entries of a series (or one student's) from its confirmed lines and its paid cash-ins,
 * against what is already entered. Pure reading: the commit plans again inside its transaction.
 *
 * Per line, from `lineItemsFor` (what its item enters, RESERVATIONS_REWORK.md §10):
 * - a Cambridge syllabus (an award item, an option item, or components of it) is entered as the
 *   award with the option code that enters exactly those components (an award item: the one
 *   option there is, else the coordinator chooses);
 * - Pearson units one by one; a whole Pearson award as its required units and the cash-in;
 *   an International GCSE as its award;
 * - a retake from the line's attempt (a rejected declaration reads as a first entry), else from
 *   history (an earlier entry or result here);
 * - carry forward from the line's prior sitting where its item carries one forward
 *   (`needs_prior_series`, a carry-forward option): from that series, with the previous centre
 *   and candidate number verified at another centre, or the school's own in that series; a
 *   declared sitting still unverified is entered as declared (listed by the check) or held,
 *   as `verification.unverifiedAtDeadline` says. Without a prior sitting on the line, an A Level
 *   after the candidate's AS here within the board's period is suggested (`exams.carryForward`).
 * Per paid cash-in (C's `chargesOfKind`): the award the line's item enters; else the coordinator
 * adds it by hand with the charge.
 */
async function planDerivation(series: SeriesRow, studentId: string | undefined, executor: Executor) {
  const regs = await executor.select({ id: registration.id, studentId: registration.studentId })
    .from(registration)
    .where(and(eq(registration.boardSeriesId, series.id), eq(registration.status, 'confirmed'), studentId ? eq(registration.studentId, studentId) : undefined));
  const cashIns = [...(await chargesOfKind('cash_in', series.id, executor)), ...(await chargesOfKind('late_cash_in', series.id, executor))]
    .filter((c) => !studentId || c.studentId === studentId);
  if (!regs.length && !cashIns.length) return [] as DeriveRow[];
  const items = await lineItemsFor([...regs.map((r) => r.id), ...cashIns.map((c) => c.registrationId).filter((x): x is string => !!x)], executor);
  const studentIds = [...new Set([...regs.map((r) => r.studentId), ...cashIns.map((c) => c.studentId)])];
  const ids = sql.join(studentIds.map((id) => sql`${id}`), sql`, `);
  const [students, inSeries, cat, history, numbers, cfSetting, verification, lineDeadlines] = await Promise.all([
    executor.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, studentIds)),
    executor.select().from(examEntry).where(and(eq(examEntry.boardSeriesId, series.id), inArray(examEntry.studentId, studentIds))),
    catalogueFor(items.map((i) => i.enters.qualification?.id).filter((x): x is string => !!x), executor),
    // Every earlier entry and result of these students (retakes; an AS entry to carry forward).
    executor.execute(sql`
      select e.student_id as "studentId", e.unit_id as "unitId", e.qualification_id as "qualificationId", e.entry_code as "code",
        e.board_code as "boardCode", s.month, s.year, s.id as "seriesId", q.level as "qualLevel"
      from exam_entry e join board_series s on s.id = e.board_series_id left join qualification q on q.id = e.qualification_id
      where e.student_id in (${ids}) and e.status <> 'withdrawn' and e.board_series_id <> ${series.id}
      union all
      select r.student_id, r.unit_id, r.qualification_id, r.code, r.board_code, s.month, s.year, s.id, q.level
      from exam_result r join board_series s on s.id = r.board_series_id left join qualification q on q.id = r.qualification_id
      where r.student_id in (${ids}) and r.board_series_id <> ${series.id}
    `).then((r) => r.rows as { studentId: string; unitId: string | null; qualificationId: string | null; code: string; boardCode: string; month: string; year: number; seriesId: string; qualLevel: string | null }[]),
    executor.execute(sql`
      select n.student_id as "studentId", n.board_series_id as "seriesId", n.number, n.centre_number as "centreNumber"
      from exam_candidate_number n where n.student_id in (${ids})
    `).then((r) => r.rows as { studentId: string; seriesId: string; number: string; centreNumber: string | null }[]),
    getSetting('exams.carryForward', executor),
    getSetting('verification.unverifiedAtDeadline', executor),
    effectiveDeadlinesOf(executor, regs.map((r) => r.id)),
  ]);
  const existing = inSeries.filter((e) => e.status !== 'withdrawn');
  // Withdrawn by the coordinator: never made again. Withdrawn with its line (a drop, a reversal): made
  // again if the line is paid again (the review of 093dbd1, item 1).
  const withdrawn = inSeries.filter((e) => e.status === 'withdrawn' && !e.withdrawnWithLine);
  const awardIdsHere = [...new Set(existing.filter((e) => e.kind === 'award' && e.qualificationId).map((e) => e.qualificationId!))];
  const awardsHere = awardIdsHere.length
    ? await executor.select({ id: qualification.id, code: qualification.code, title: qualification.title, level: qualification.level, entryMethod: qualification.entryMethod, tier: qualification.tier })
      .from(qualification).where(inArray(qualification.id, awardIdsHere))
    : [];
  const rules = await boardRulesFor(series.boardCode, executor);
  const centre = await centreFor(series.boardCode);
  const nameOf = new Map(students.map((s) => [s.id, s.name]));
  const here = monthIndex(series.month, series.year);
  const itemOf = new Map(items.map((i) => [i.registrationId, i]));

  const fresh = (p: Omit<PlannedEntry, 'isRetake' | 'retakeSource' | 'carryForward' | 'cfFromMonth' | 'cfFromYear' | 'cfCentreNumber' | 'cfCandidateNumber' | 'cfOption'>): PlannedEntry => ({
    ...p, isRetake: false, retakeSource: null, carryForward: 'none', cfFromMonth: null, cfFromYear: null, cfCentreNumber: null, cfCandidateNumber: null, cfOption: null,
  });
  const earlierUnit = (sid: string, u: { id: string; code: string }) =>
    history.some((h) => h.studentId === sid && (h.unitId === u.id || (h.code === u.code && h.boardCode === series.boardCode)) && monthIndex(h.month, h.year) < here);
  const earlierAward = (sid: string, q: { id: string; code: string; level: string }) =>
    history.some((h) => h.studentId === sid && (h.qualificationId === q.id || (h.code === q.code && h.boardCode === series.boardCode && h.qualLevel === q.level)) && monthIndex(h.month, h.year) < here);
  const unitEntry = (sid: string, u: { id: string; code: string; title: string; tier: string | null }): PlannedEntry => {
    const p = fresh({ kind: 'unit', unitId: u.id, qualificationId: null, entryCode: u.code, title: u.title, optionCode: null, tier: u.tier });
    if (earlierUnit(sid, u)) Object.assign(p, { isRetake: true, retakeSource: 'history' });
    return p;
  };
  const awardEntry = (sid: string, q: { id: string; code: string; title: string; level: string; tier: string | null }, optionCode: string | null, tier: string | null): PlannedEntry => {
    const p = fresh({ kind: 'award', unitId: null, qualificationId: q.id, entryCode: q.code, title: q.title, optionCode, tier: q.tier ?? tier });
    if (earlierAward(sid, q)) Object.assign(p, { isRetake: true, retakeSource: 'history' });
    return p;
  };
  /** The suggest-and-confirm flow (Q-02), for a line with no prior sitting of its own: an A Level after the candidate's AS here. */
  const suggestCarryForward = (sid: string, q: { id: string; code: string; level: string }, planned: PlannedEntry) => {
    const months = rules.carryForwardMonths;
    if (cfSetting !== 'suggest' || !months || q.level !== 'a_level') return;
    const as = history
      .filter((h) => h.studentId === sid && h.code === q.code && h.boardCode === series.boardCode && h.qualLevel === 'as_level')
      .filter((h) => { const gap = here - monthIndex(h.month, h.year); return gap > 0 && gap <= months; })
      .sort((a, b) => monthIndex(b.month, b.year) - monthIndex(a.month, a.year))[0];
    if (!as) return;
    const n = numbers.find((x) => x.studentId === sid && x.seriesId === as.seriesId);
    const cfOption = cat.options.filter((o) => o.qualificationId === q.id && o.carryForward);
    Object.assign(planned, {
      carryForward: 'suggested', cfFromMonth: as.month, cfFromYear: as.year,
      cfCentreNumber: n?.centreNumber ?? centre.centreNumber, cfCandidateNumber: n?.number ?? null,
      cfOption: `${as.month}_carry_forward`,
      optionCode: planned.optionCode ?? (cfOption.length === 1 ? cfOption[0]!.code : null),
    });
  };

  /** What a line's item enters, as entries (null: the subject row is not mapped). */
  const plan = (it: LineItem): { planned: PlannedEntry[] | null; note: string | null } => {
    const q = it.enters.qualification;
    const unitsIn = it.enters.units;
    if (!it.enters.mapped) return { planned: null, note: null };
    if (q && q.entryMethod === 'syllabus_option') {
      // Cambridge: the syllabus, with the option entering exactly these components (an option item: its own).
      if (it.enters.option) {
        const tiers = it.enters.option.unitIds.map((u) => cat.qualUnits.find((x) => x.unitId === u)?.tier ?? null);
        return { planned: [awardEntry(it.studentId, q, it.enters.option.code, sharedTier(tiers))], note: null };
      }
      if (unitsIn.length) {
        const want = new Set(unitsIn.map((u) => u.id));
        const opt = cat.options.find((o) => {
          if (o.qualificationId !== q.id) return false;
          const us = cat.optionUnits.filter((ou) => ou.optionId === o.id).map((ou) => ou.unitId);
          return us.length === want.size && us.every((u) => want.has(u));
        });
        return {
          planned: [awardEntry(it.studentId, q, opt?.code ?? null, sharedTier(unitsIn.map((u) => u.tier)))],
          note: opt ? null : 'No option code of the syllabus enters exactly these components — choose it on the entry',
        };
      }
      const opts = cat.options.filter((o) => o.qualificationId === q.id && !o.carryForward);
      const opt = opts.length === 1 ? opts[0]! : null;
      const optTier = opt ? sharedTier(cat.optionUnits.filter((ou) => ou.optionId === opt.id).map((ou) => cat.qualUnits.find((u) => u.unitId === ou.unitId)?.tier ?? null)) : null;
      return { planned: [awardEntry(it.studentId, q, opt?.code ?? null, optTier)], note: null };
    }
    if (unitsIn.length) return { planned: unitsIn.map((u) => unitEntry(it.studentId, u)), note: null };
    if (q && q.entryMethod === 'units_cash_in') {
      const us = cat.qualUnits.filter((u) => u.qualificationId === q.id);
      const required = us.filter((u) => u.requirement === 'required' && !u.choiceGroup);
      const groups = [...new Set(us.filter((u) => u.choiceGroup).map((u) => u.choiceGroup!))];
      const note = groups.length
        ? `Choose the unit for ${groups.map((g) => `"${g}" (${us.filter((u) => u.choiceGroup === g).map((u) => u.shortCode ?? u.code).join(', ')})`).join(', ')} and add it on the entry list`
        : null;
      return { planned: [...required.map((u) => unitEntry(it.studentId, { id: u.unitId, code: u.code, title: u.title, tier: u.tier })), awardEntry(it.studentId, q, null, null)], note };
    }
    if (q) {
      const opt = it.enters.option ?? (() => { const opts = cat.options.filter((o) => o.qualificationId === q.id && !o.carryForward); return opts.length === 1 ? opts[0]! : null; })();
      const optUnits = opt ? cat.optionUnits.filter((ou) => ou.optionId === opt.id).map((ou) => ou.unitId) : [];
      const optTier = sharedTier(optUnits.map((u) => cat.qualUnits.find((x) => x.unitId === u)?.tier ?? null));
      return { planned: [awardEntry(it.studentId, q, opt?.code ?? null, optTier)], note: null };
    }
    return { planned: null, note: null };
  };

  const stateOf = (sid: string, p: PlannedEntry, owner: { registrationId?: string | null; chargeId?: string | null }, expect: LineExpect | null = null) => {
    const same = (e: (typeof inSeries)[number]) => e.studentId === sid && (p.kind === 'unit' ? e.unitId === p.unitId : e.qualificationId === p.qualificationId);
    const found = existing.find(same);
    const mine = (e: (typeof inSeries)[number]) => (owner.registrationId ? e.registrationId === owner.registrationId : e.chargeId === owner.chargeId);
    const gone = !found ? withdrawn.find((e) => same(e) && mine(e)) : undefined;
    let state: DeriveRow['entries'][number]['state'] = found
      ? (mine(found) || (!found.registrationId && !found.chargeId && !!owner.registrationId) ? 'exists' : 'elsewhere')
      : gone ? 'withdrawn' : 'new';
    let patch: Partial<EntryRow> | undefined;
    // A paid cash-in whose award is already entered without one (from a whole-award line, or by
    // hand): linked to it (the review of 093dbd1, item 6).
    if (owner.chargeId && found && !found.chargeId) state = 'link';
    // A draft made from this line, which the line's answer has changed since: brought up to date.
    if (state === 'exists' && found && mine(found) && found.status === 'draft' && expect && owner.registrationId) {
      const d = lineDiff(found, expect);
      if (d.any) { state = 'refresh'; patch = d.patch; }
    }
    return { ...p, state, existingEntryId: found?.id ?? gone?.id ?? null, ...(patch ? { patch } : {}) };
  };
  const outcomeOf = (entries: DeriveRow['entries']): DeriveRow['outcome'] =>
    entries.some((e) => e.state === 'new' || e.state === 'refresh' || e.state === 'link') ? 'ready' : entries.some((e) => e.state === 'withdrawn') ? 'withdrawn' : 'entered';

  const rows: DeriveRow[] = [];
  for (const reg of regs) {
    const it = itemOf.get(reg.id)!;
    const d = lineDeadlines.get(reg.id) ?? { at: series.entryDeadline, kind: 'entry' as const };
    const prior = it.priorSitting;
    const base = {
      registrationId: reg.id, chargeId: null, studentId: reg.studentId, studentName: nameOf.get(reg.studentId) ?? '',
      subject: { id: it.subject.id, name: it.subject.name, code: it.subject.code },
      item: { label: it.item.label, kind: it.item.kind }, levelCode: it.levelCode, deadline: { at: d.at, kind: d.kind },
      priorSitting: prior ? { name: prior.name, source: prior.source, outcome: prior.outcome, declared: prior.declared } : null,
      expect: null as LineExpect | null,
    };
    const { planned, note } = plan(it);
    if (!planned) {
      rows.push({ ...base, outcome: 'not_mapped', note: `${it.subject.name} is not mapped on the Catalogue: say what it enters with ${series.boardName} first`, entries: [] });
      continue;
    }
    // The line says it is a retake (a rejected declaration reads as a first entry, §3.5): the line's
    // word is the source even when history says so too (the review of 093dbd1, item 9).
    if (it.attempt === 'retake') for (const p of planned) Object.assign(p, { isRetake: true, retakeSource: 'registration' });
    // Carry forward from the line's own prior sitting, where the item carries one forward: suggested
    // while the sitting is declared and not verified, confirmed once known or verified (item 2).
    const carries = !!prior && (it.item.needsPriorSeries || !!it.enters.option?.carryForward) && !it.declarationRejected;
    const here2 = prior ? numbers.find((x) => x.studentId === reg.studentId && x.seriesId === prior.seriesId) : undefined;
    const expect: LineExpect = {
      retake: it.attempt === 'retake',
      carry: carries && prior ? {
        state: prior.declared && prior.outcome !== 'verified' ? 'suggested' : 'confirmed', month: prior.month, year: prior.year,
        otherCentre: !!prior.previousCentre,
        centre: prior.previousCentre ? prior.previousCentre : here2?.centreNumber ?? centre.centreNumber,
        number: prior.previousCentre ? prior.previousCandidateNumber : here2?.number ?? null,
      } : null,
      rejectedFrom: it.declarationRejected && prior && it.enters.qualification ? {
        month: prior.month, year: prior.year,
        optionCodes: cat.options.filter((o) => o.qualificationId === it.enters.qualification!.id && o.carryForward).map((o) => o.code),
      } : null,
    };
    base.expect = expect;
    let lineNote = note;
    for (const p of planned.filter((x) => x.kind === 'award')) {
      if (expect.carry) {
        Object.assign(p, {
          carryForward: expect.carry.state, cfFromMonth: expect.carry.month, cfFromYear: expect.carry.year,
          cfCentreNumber: expect.carry.centre, cfCandidateNumber: expect.carry.number, cfOption: `${expect.carry.month}_carry_forward`,
        });
      } else if (!prior && p.qualificationId && !it.enters.option) {
        // No prior sitting on the line, and the item fixes no route: the suggest-and-confirm flow (Q-02).
        suggestCarryForward(reg.studentId, it.enters.qualification!, p);
      }
    }
    if (it.declarationRejected && it.enters.option?.carryForward) {
      lineNote = `The declared sitting was not confirmed: ${it.subject.name} is entered as a first entry — choose the option that enters every component`;
      for (const p of planned) if (p.kind === 'award') p.optionCode = null;
    }
    const entries = planned.map((p) => stateOf(reg.studentId, p, { registrationId: reg.id }, expect));
    if (passed(d)) {
      rows.push({ ...base, outcome: entries.every((e) => e.state === 'exists') ? 'entered' : 'past_deadline', note: entryStopSentence(series.name, d), entries });
      continue;
    }
    if (prior?.declared && !prior.outcome && verification === 'hold') {
      rows.push({ ...base, outcome: 'held', note: `${prior.name} was declared and is not verified yet: the school holds such lines until they are (the To verify tab)`, entries });
      continue;
    }
    rows.push({ ...base, outcome: outcomeOf(entries), note: lineNote, entries });
  }

  // Paid cash-ins become their award's entry; an accepted one awaiting payment is listed, not entered.
  for (const c of cashIns) {
    const it = c.registrationId ? itemOf.get(c.registrationId) : undefined;
    // The award: the one the line's item enters; else, when the candidate already has exactly one
    // award cashed in by units entered here with no cash-in on it, that one (item 6).
    const unlinked = awardsHere.filter((a) => a.entryMethod === 'units_cash_in'
      && existing.some((e) => e.studentId === c.studentId && e.kind === 'award' && e.qualificationId === a.id && !e.chargeId));
    const q = it?.enters.qualification && it.enters.qualification.entryMethod === 'units_cash_in' ? it.enters.qualification
      : !it && unlinked.length === 1 ? unlinked[0]! : null;
    const d = chargeEntryDeadline(c, series);
    const base = {
      registrationId: null, chargeId: c.id, studentId: c.studentId, studentName: nameOf.get(c.studentId) ?? '',
      subject: it ? { id: it.subject.id, name: it.subject.name, code: it.subject.code } : { id: '', name: c.description, code: '' },
      item: it ? { label: it.item.label, kind: it.item.kind } : null, levelCode: it?.levelCode ?? '', deadline: { at: d.at, kind: d.kind },
      priorSitting: null, expect: null,
    };
    if (c.status !== 'paid') {
      rows.push({ ...base, outcome: 'awaiting_payment', note: `Cash-in awaiting payment: ${c.description} (EGP ${c.amount.toFixed(2)}) — entered once it is paid`, entries: [] });
      continue;
    }
    if (!q) {
      rows.push({ ...base, outcome: 'choose_award', note: `${c.description}: its line does not say which award it cashes in — add the award entry by hand with this cash-in`, entries: [] });
      continue;
    }
    const p = awardEntry(c.studentId, q, null, null);
    const entries = [stateOf(c.studentId, p, { chargeId: c.id })];
    // Linking a cash-in to the award already entered is not a new entry: no deadline stops it.
    if (passed(d) && entries[0]!.state !== 'link') {
      rows.push({ ...base, outcome: entries[0]!.state === 'exists' ? 'entered' : 'past_deadline', note: entryStopSentence(series.name, d), entries });
      continue;
    }
    rows.push({ ...base, outcome: outcomeOf(entries), note: entries[0]!.state === 'link' ? 'The award is already entered: this cash-in is linked to it' : null, entries });
  }
  return rows.sort((a, b) => a.studentName.localeCompare(b.studentName) || a.subject.name.localeCompare(b.subject.name)
    || (a.chargeId ? 1 : 0) - (b.chargeId ? 1 : 0) || (a.item?.label ?? '').localeCompare(b.item?.label ?? ''));
}

/**
 * Derive the entries of a series (or one student's) from its confirmed lines and paid cash-ins:
 * a preview, then a commit that makes each new entry once. Two coordinators committing at once
 * run one after the other (an advisory lock per series), and the unique indexes keep one live
 * entry per unit, award and cash-in. Each line is cut off at its own deadline (MO-10); the commit
 * is refused once the series' entry deadline has passed and no line is still open (a retake of
 * the board's previous sitting may be, until the retake deadline).
 */
export async function deriveEntries(data: DeriveEntriesType, actorId: string, ctx?: AuditContext) {
  const series = await seriesOrThrow(data.boardSeriesId);
  const summarize = (rows: DeriveRow[]) => ({
    registrations: rows.filter((r) => r.registrationId).length,
    newEntries: rows.filter((r) => r.outcome === 'ready').reduce((n, r) => n + r.entries.filter((e) => e.state === 'new').length, 0),
    notMapped: rows.filter((r) => r.outcome === 'not_mapped').length,
    // Drafts brought up to date with their line's answer, and paid cash-ins linked to their award (the review of 093dbd1).
    updates: rows.filter((r) => r.outcome === 'ready').reduce((n, r) => n + r.entries.filter((e) => e.state === 'refresh' || e.state === 'link').length, 0),
  });
  const refusalOf = (s: SeriesRow, rows: DeriveRow[]) =>
    pastEntryDeadline(s) && !rows.some((r) => r.outcome === 'ready') ? hardStopSentence(s) : null;
  if (!data.commit) {
    const rows = await planDerivation(series, data.studentId, db);
    return {
      series: { id: series.id, name: series.name, entryDeadline: series.entryDeadline, retakeDeadline: series.retakeDeadline },
      pastDeadline: pastEntryDeadline(series), refusal: refusalOf(series, rows),
      committed: false, created: 0, updated: 0, rows, summary: summarize(rows),
    };
  }
  return db.transaction(async (tx) => {
    // The series FOR SHARE: a deadline change (FOR UPDATE) waits for this, or this for it.
    const locked = await seriesOrThrow(series.id, tx, 'share');
    await advisoryLock(tx, `exam:derive:${series.id}`);
    const rows = await planDerivation(locked, data.studentId, tx);
    const refusal = refusalOf(locked, rows);
    if (refusal) throw new ExamError(refusal, 409);
    const values = rows.filter((r) => r.outcome === 'ready').flatMap((r) => r.entries.filter((e) => e.state === 'new').map((e) => ({
      id: randomUUID(), studentId: r.studentId, boardSeriesId: locked.id, boardCode: locked.boardCode, registrationId: r.registrationId, chargeId: r.chargeId,
      kind: e.kind, unitId: e.unitId, qualificationId: e.qualificationId, entryCode: e.entryCode, title: e.title,
      optionCode: e.optionCode, tier: e.tier, isRetake: e.isRetake, retakeSource: e.retakeSource,
      carryForward: e.carryForward, cfFromMonth: e.cfFromMonth, cfFromYear: e.cfFromYear, cfCentreNumber: e.cfCentreNumber,
      cfCandidateNumber: e.cfCandidateNumber, cfOption: e.cfOption, createdBy: actorId,
    })));
    const created = values.length
      ? await tx.insert(examEntry).values(values).onConflictDoNothing().returning({ id: examEntry.id })
      : [];
    if (created.length) {
      await logAction(actorId, 'EXAM_ENTRIES_DERIVED', 'board_series', locked.id, null,
        { count: created.length, entryIds: created.map((c) => c.id), studentId: data.studentId ?? null }, ctx, tx);
    }
    // A draft brought up to date with what its line says now (a sitting answered after the entry
    // was made), and a paid cash-in linked to its award already entered — each guarded on the
    // state it was planned from, each audited.
    let updated = 0;
    for (const r of rows.filter((x) => x.outcome === 'ready')) {
      for (const e of r.entries) {
        if (e.state === 'refresh' && e.existingEntryId && e.patch) {
          const [before] = await tx.select().from(examEntry).where(and(eq(examEntry.id, e.existingEntryId), eq(examEntry.status, 'draft'))).for('update');
          if (!before) continue;
          const [row] = await tx.update(examEntry).set({ ...e.patch, updatedAt: new Date() }).where(and(eq(examEntry.id, before.id), eq(examEntry.status, 'draft'))).returning();
          if (!row) continue;
          const keys = Object.keys(e.patch);
          await logAction(actorId, 'EXAM_ENTRY_UPDATED', 'exam_entry', before.id,
            Object.fromEntries(keys.map((k) => [k, (before as Record<string, unknown>)[k] ?? null])),
            { ...e.patch, reason: "brought up to date with the reservation's answered sitting" }, ctx, tx);
          updated++;
        }
        if (e.state === 'link' && e.existingEntryId && r.chargeId) {
          const [row] = await tx.update(examEntry).set({ chargeId: r.chargeId, updatedAt: new Date() })
            .where(and(eq(examEntry.id, e.existingEntryId), isNull(examEntry.chargeId), sql`${examEntry.status} <> 'withdrawn'`)).returning({ id: examEntry.id });
          if (!row) continue;
          await logAction(actorId, 'EXAM_ENTRY_UPDATED', 'exam_entry', row.id, { chargeId: null },
            { chargeId: r.chargeId, reason: 'linked to the paid cash-in of its award' }, ctx, tx);
          updated++;
        }
      }
    }
    return {
      series: { id: locked.id, name: locked.name, entryDeadline: locked.entryDeadline, retakeDeadline: locked.retakeDeadline },
      pastDeadline: pastEntryDeadline(locked), refusal: null, committed: true, created: created.length, updated, rows, summary: summarize(rows),
    };
  });
}

/**
 * Add an entry by hand: an award the candidate cashes in (with the paid cash-in charge it comes
 * from, when its line did not say which award), a unit a derivation could not choose (a choice
 * group), or an entry for a line that enters something the catalogue cannot say. Cut off at its
 * own deadline: the line's, the cash-in's, else the series' entry deadline (MO-10).
 */
export async function createEntry(data: CreateEntryType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const series = await seriesOrThrow(data.boardSeriesId, tx, 'share');
    const [student] = await tx.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, data.studentId));
    if (!student || student.role !== 'student') throw new ExamError('Student not found', 404);
    let target: { entryCode: string; title: string; tier: string | null; boardCode: string };
    if (data.unitId) {
      const [u] = await tx.select().from(examUnit).where(eq(examUnit.id, data.unitId));
      if (!u) throw new ExamError('Unit not found', 404);
      target = { entryCode: u.code, title: u.title, tier: u.tier, boardCode: u.boardCode };
    } else {
      const [q] = await tx.select().from(qualification).where(eq(qualification.id, data.qualificationId!));
      if (!q) throw new ExamError('Qualification not found', 404);
      target = { entryCode: q.code, title: q.title, tier: q.tier, boardCode: q.boardCode };
    }
    if (target.boardCode !== series.boardCode) throw new ExamError(`${target.entryCode} is not a ${series.boardName} code`, 400);
    let deadline: EntryDeadline = { at: series.entryDeadline, kind: series.entryDeadline ? 'entry' : null };
    if (data.registrationId) {
      const [r] = await tx.select({ studentId: registration.studentId, boardSeriesId: registration.boardSeriesId }).from(registration).where(eq(registration.id, data.registrationId));
      if (!r || r.studentId !== data.studentId || r.boardSeriesId !== series.id) throw new ExamError('That registration is not this candidate\'s in this series', 400);
      const d = (await effectiveDeadlinesOf(tx, [data.registrationId])).get(data.registrationId);
      if (d) deadline = { at: d.at, kind: d.kind };
    }
    if (data.chargeId) {
      // The cash-in's row, shared: a reversal or a refund of it (FOR UPDATE) waits, or this for it.
      const [c] = await tx.select().from(charge).where(eq(charge.id, data.chargeId)).for('share');
      if (!c || c.studentId !== data.studentId || c.boardSeriesId !== series.id || (c.kind !== 'cash_in' && c.kind !== 'late_cash_in')) {
        throw new ExamError('That cash-in is not this candidate\'s in this series', 400);
      }
      if (!data.qualificationId) throw new ExamError('A cash-in enters an award: choose the award it cashes in', 400);
      if (c.status !== 'paid') throw new ExamError(`Cash-in awaiting payment: ${c.description} is entered once it is paid`, 409);
      deadline = chargeEntryDeadline({ deadline: await chargeDeadline(tx, c) }, series);
    }
    if (passed(deadline)) throw new ExamError(entryStopSentence(series.name, deadline), 409);
    try {
      const [row] = await tx.insert(examEntry).values({
        id: randomUUID(), studentId: data.studentId, boardSeriesId: series.id, boardCode: series.boardCode, registrationId: data.registrationId ?? null,
        chargeId: data.chargeId ?? null,
        kind: data.unitId ? 'unit' : 'award', unitId: data.unitId ?? null, qualificationId: data.qualificationId ?? null,
        entryCode: target.entryCode, title: target.title, optionCode: data.optionCode ?? null, tier: data.tier ?? target.tier,
        notes: data.notes ?? null, createdBy: actorId,
      }).returning();
      await logAction(actorId, 'EXAM_ENTRY_CREATED', 'exam_entry', row!.id, null,
        { studentId: data.studentId, boardSeriesId: series.id, entryCode: target.entryCode, optionCode: data.optionCode ?? null, chargeId: data.chargeId ?? null }, ctx, tx);
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ExamError(violatedConstraint(err) === 'examEntry_one_live_charge_idx'
          ? 'This cash-in is already entered'
          : `The candidate is already entered for ${target.entryCode} in ${series.name}`, 409);
      }
      throw err;
    }
  });
}

// ─── Changing, sending, withdrawing ──────────────────────────────────────────

/** Fields a board sees: changing one on a submitted entry is an amendment. */
const BOARD_FIELDS = ['optionCode', 'tier', 'isRetake', 'carryForward', 'cfFromMonth', 'cfFromYear', 'cfCentreNumber', 'cfCandidateNumber', 'cfOption'] as const;

async function lockEntry(tx: Tx, id: string) {
  const [e] = await tx.select().from(examEntry).where(eq(examEntry.id, id)).for('update');
  if (!e) throw new ExamError('Entry not found', 404);
  return e;
}

/**
 * Change an entry. A draft changes freely. On a submitted entry a change to
 * what the board sees is an amendment: it needs a reason, the board's rules
 * decide whether it is taken after the deadline and what it costs (shown,
 * never charged), and the entry becomes "amended".
 */
export async function updateEntry(id: string, data: UpdateEntryType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const e = await lockEntry(tx, id);
    if (e.status === 'withdrawn') throw new ExamError('This entry was withdrawn: add a new one instead', 409);
    const series = await seriesOrThrow(e.boardSeriesId, tx);
    const rules = await boardRulesFor(e.boardCode, tx);
    const { reason, ...fields } = data;
    const set: Partial<EntryRow> = {};
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) (set as Record<string, unknown>)[k] = v;
    // An option that enters components of one tier gives the entry that tier.
    if (set.optionCode && fields.tier === undefined && e.qualificationId) {
      const [opt] = await tx.select({ id: qualificationOption.id }).from(qualificationOption)
        .where(and(eq(qualificationOption.qualificationId, e.qualificationId), eq(qualificationOption.code, set.optionCode)));
      if (!opt) throw new ExamError(`${set.optionCode} is not an option code of ${e.entryCode}`, 400);
      const tiers = await tx.select({ tier: examUnit.tier }).from(qualificationOptionUnit).innerJoin(examUnit, eq(examUnit.id, qualificationOptionUnit.unitId))
        .where(eq(qualificationOptionUnit.optionId, opt.id));
      const t = sharedTier(tiers.map((x) => x.tier));
      if (t) set.tier = t;
    }
    if (fields.isRetake !== undefined) set.retakeSource = fields.isRetake ? 'staff' : null;
    const changed = Object.keys(set).filter((k) => JSON.stringify((e as Record<string, unknown>)[k] ?? null) !== JSON.stringify((set as Record<string, unknown>)[k] ?? null));
    if (!changed.length) return { entry: e, amendment: null };
    const boardChange = changed.some((k) => (BOARD_FIELDS as readonly string[]).includes(k));
    let amendment: { feeDue: boolean; sentence: string } | null = null;
    if (e.status !== 'draft' && boardChange) {
      if (!reason) throw new ExamError(`This entry has gone to ${series.boardName}: say why it is amended`, 400);
      if (pastEntryDeadline(series) && rules.amendmentAfterDeadline === 'refused') {
        throw new ExamError(`${series.boardName} takes no amendments after the entry deadline for ${series.name}: withdraw the entry instead`, 409);
      }
      amendment = amendmentCharge(rules, series);
      Object.assign(set, { status: 'amended', amendedAt: new Date(), amendedBy: actorId, amendmentCount: e.amendmentCount + 1 });
    }
    const [row] = await tx.update(examEntry).set({ ...set, updatedAt: new Date() }).where(eq(examEntry.id, id)).returning();
    const pick = (o: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, o[k] ?? null]));
    await logAction(actorId, amendment ? 'EXAM_ENTRY_AMENDED' : 'EXAM_ENTRY_UPDATED', 'exam_entry', id,
      pick(e as Record<string, unknown>), { ...pick(set as Record<string, unknown>), ...(reason ? { reason } : {}), ...(amendment ? { charge: amendment.sentence } : {}) }, ctx, tx);
    return { entry: row!, amendment };
  });
}

/**
 * Record that entries went to the board ("mark as sent"). Only drafts move; each keeps the
 * board's fee tier on the day it was sent (information only). Each is cut off at its own deadline
 * (MO-10: its line's effective deadline, its cash-in's, else the series' entry deadline): a time
 * after it is refused — the school sends no late entries. An entry whose line follows a declared
 * sitting still unverified is not sent while the school holds such lines
 * (`verification.unverifiedAtDeadline = hold`). Sending is what makes a line's board fee "sent"
 * for its refund (step C's `refundFor` reads `sentEntriesOf`).
 */
export async function submitEntries(data: SubmitEntriesType, actorId: string, ctx?: AuditContext) {
  const at = data.submittedAt ?? new Date();
  if (at.getTime() > Date.now() + 5 * 60_000) throw new ExamError('The time the entries went to the board cannot be in the future', 400);
  return db.transaction(async (tx) => {
    // What the entries were made from (an entry's line and cash-in never change), then those lines
    // FOR SHARE in id order and the cash-ins FOR SHARE, before the entries (§2.1: a line before what
    // is made from it). A drop, a swap or a reversal that ends a line holds it FOR UPDATE and
    // withdraws its entries in its transaction: the two run one after the other (the review of
    // 093dbd1, item 1).
    const refs = await tx.select({ id: examEntry.id, registrationId: examEntry.registrationId, chargeId: examEntry.chargeId })
      .from(examEntry).where(inArray(examEntry.id, data.entryIds));
    if (refs.length !== new Set(data.entryIds).size) throw new ExamError('Entry not found', 404);
    const lineIds = [...new Set(refs.map((r) => r.registrationId).filter((x): x is string => !!x))].sort();
    const chargeIds = [...new Set(refs.map((r) => r.chargeId).filter((x): x is string => !!x))].sort();
    const lineStatus = new Map((lineIds.length
      ? await tx.select({ id: registration.id, status: registration.status }).from(registration).where(inArray(registration.id, lineIds)).orderBy(asc(registration.id)).for('share')
      : []).map((l) => [l.id, l.status]));
    const chargeStatus = new Map((chargeIds.length
      ? await tx.select({ id: charge.id, status: charge.status }).from(charge).where(inArray(charge.id, chargeIds)).orderBy(asc(charge.id)).for('share')
      : []).map((c) => [c.id, c.status]));
    const rows = await tx.select().from(examEntry).where(inArray(examEntry.id, data.entryIds)).orderBy(asc(examEntry.id)).for('update');
    const seriesIds = [...new Set(rows.map((r) => r.boardSeriesId))].sort();
    const seriesById = new Map<string, SeriesRow>();
    for (const sid of seriesIds) seriesById.set(sid, await seriesOrThrow(sid, tx, 'share'));
    const drafts = rows.filter((r) => r.status === 'draft');
    // A draft whose line is no longer paid, or whose cash-in is not paid, is not sent: the board
    // would be paid for an entry the family is no longer paying for.
    const unpaid = drafts.find((d) => (d.registrationId && lineStatus.get(d.registrationId) !== 'confirmed') || (d.chargeId && chargeStatus.get(d.chargeId) !== 'paid'));
    if (unpaid) {
      const [who] = await tx.select({ name: user.name }).from(user).where(eq(user.id, unpaid.studentId));
      const why = unpaid.registrationId && lineStatus.get(unpaid.registrationId) !== 'confirmed'
        ? `its reservation is ${(lineStatus.get(unpaid.registrationId) ?? 'gone').replace(/_/g, ' ')}`
        : 'its cash-in is not paid';
      throw new ExamError(`${unpaid.entryCode} ${unpaid.title} for ${who?.name ?? 'the candidate'} is not sent: ${why} — withdraw the entry`, 409);
    }
    const deadlines = await deadlinesOfEntries(tx, drafts, seriesById);
    const late = drafts.find((d) => passed(deadlines.get(d.id)!, at));
    if (late) throw new ExamError(entryStopSentence(seriesById.get(late.boardSeriesId)!.name, deadlines.get(late.id)!), 409);
    if ((await getSetting('verification.unverifiedAtDeadline', tx)) === 'hold') {
      const lineIds = [...new Set(drafts.map((d) => d.registrationId).filter((x): x is string => !!x))];
      const held = lineIds.length ? (await tx.execute(sql`
        select r.id from registration r where r.id in (${sql.join(lineIds.map((id) => sql`${id}`), sql`, `)})
          and r.prior_sitting_source in ('declared_by_family', 'declared_by_desk') and r.prior_sitting_verified_outcome is null`)).rows as { id: string }[] : [];
      if (held.length) {
        const e = drafts.find((d) => d.registrationId === held[0]!.id)!;
        throw new ExamError(`${e.entryCode} follows a declared earlier sitting the school has not verified: it is held until it is (the To verify tab), and not sent`, 409);
      }
    }
    for (const sid of seriesIds) {
      const s = seriesById.get(sid)!;
      const ids = drafts.filter((d) => d.boardSeriesId === sid).map((d) => d.id);
      if (!ids.length) continue;
      await tx.update(examEntry).set({
        status: 'submitted', submittedAt: at, submittedBy: actorId,
        feeTierAtSubmission: feeTierOn(s, schoolDateString(at)), updatedAt: new Date(),
      }).where(and(inArray(examEntry.id, ids), eq(examEntry.status, 'draft')));
      await logAction(actorId, 'EXAM_ENTRIES_SUBMITTED', 'board_series', sid, null, { count: ids.length, entryIds: ids, submittedAt: at.toISOString() }, ctx, tx);
    }
    return { submitted: drafts.length, skipped: rows.length - drafts.length };
  });
}

/**
 * Withdraw an entry — allowed before and after the deadline. The answer and
 * the entry say what the board does with its fee (refunded or kept, by the
 * board's rules and the series' dates); nothing here moves family money. A
 * family whose entry had gone to the board is told.
 */
export async function withdrawEntry(id: string, reason: string, actorId: string, ctx?: AuditContext) {
  const out = await db.transaction(async (tx) => {
    const e = await lockEntry(tx, id);
    if (e.status === 'withdrawn') throw new ExamError('This entry is already withdrawn', 409);
    const series = await seriesOrThrow(e.boardSeriesId, tx);
    const rules = await boardRulesFor(e.boardCode, tx);
    const charge = withdrawalCharge(rules, series, e.status);
    const [row] = await tx.update(examEntry).set({
      status: 'withdrawn', withdrawnAt: new Date(), withdrawnBy: actorId, withdrawalReason: reason,
      withdrawalCharge: charge.sentence, withdrawalRefunded: charge.refunded, updatedAt: new Date(),
    }).where(and(eq(examEntry.id, id), sql`${examEntry.status} <> 'withdrawn'`)).returning();
    await logAction(actorId, 'EXAM_ENTRY_WITHDRAWN', 'exam_entry', id, { status: e.status },
      { status: 'withdrawn', reason, charge: charge.sentence, refunded: charge.refunded, pastDeadline: pastEntryDeadline(series) }, ctx, tx);
    return { entry: row!, charge, series, wasSent: e.status !== 'draft' };
  });
  await tellWithdrawn([out], reason);
  return { entry: out.entry, charge: out.charge };
}

/**
 * Every path that ends a paid line withdraws the live entries made from it, in its own
 * transaction (the review of 093dbd1, item 1): the desk's drop (step C's `deskDrop`, its seam
 * `withdrawEntry`), the family's drop and swap and a change request's approval (swap.services),
 * a payment's reversal (payment.services) and step B's two system drops — a rejection after the
 * first-entry deadline and `hold` at the deadline (verification.services). Each entry is locked
 * after the line (the path holds the receipt, then the line; "mark as sent" takes the line FOR
 * SHARE before its entries), withdrawn with what the board does with its fee as the sentence and
 * marked `withdrawn_with_line` (a derivation makes it again if the line is paid again), with its
 * own audit row. Returns them for the family's notice after the commit (`tellWithdrawn`). Nothing
 * here moves money: the line's refund is its path's (`refundFor`, the board fee by the "sent" rule).
 */
export async function withdrawEntriesOfLineInTx(tx: Tx, lineId: string, reason: string, actorId: string | null, ctx?: AuditContext) {
  const live = await tx.select().from(examEntry)
    .where(and(eq(examEntry.registrationId, lineId), sql`${examEntry.status} <> 'withdrawn'`)).orderBy(asc(examEntry.id)).for('update');
  const out: { entry: EntryRow; charge: { refunded: boolean | null; sentence: string }; series: SeriesRow; wasSent: boolean }[] = [];
  for (const e of live) {
    const series = await seriesOrThrow(e.boardSeriesId, tx);
    const rules = await boardRulesFor(e.boardCode, tx);
    const charge = withdrawalCharge(rules, series, e.status);
    const [row] = await tx.update(examEntry).set({
      status: 'withdrawn', withdrawnAt: new Date(), withdrawnBy: actorId, withdrawalReason: reason,
      withdrawalCharge: charge.sentence, withdrawalRefunded: charge.refunded, withdrawnWithLine: true, updatedAt: new Date(),
    }).where(and(eq(examEntry.id, e.id), sql`${examEntry.status} <> 'withdrawn'`)).returning();
    if (!row) continue;
    await logAction(actorId, 'EXAM_ENTRY_WITHDRAWN', 'exam_entry', e.id, { status: e.status },
      { status: 'withdrawn', reason, charge: charge.sentence, refunded: charge.refunded, pastDeadline: pastEntryDeadline(series), withLine: lineId }, ctx, tx);
    out.push({ entry: row, charge, series, wasSent: e.status !== 'draft' });
  }
  return out;
}

/** After a withdrawal commits: a family whose entry had gone to the board is told. */
export async function tellWithdrawn(withdrawn: { entry: EntryRow; series: SeriesRow; wasSent: boolean }[], reason: string) {
  for (const w of withdrawn.filter((x) => x.wasSent)) {
    const family = (await familyOf([w.entry.studentId])).get(w.entry.studentId) ?? [];
    await createBulkNotifications(family, 'EXAM_ENTRY_WITHDRAWN', 'Exam entry withdrawn',
      `${w.entry.entryCode} ${w.entry.title} was withdrawn from ${w.series.name}: ${reason}`,
      { entryId: w.entry.id, boardSeriesId: w.entry.boardSeriesId, url: '/exams/my' });
  }
}

// ─── Forecast grades ─────────────────────────────────────────────────────────

/** The subject an entry's forecast is about (its registration's), and the academic year of its series. */
async function forecastContext(e: EntryRow, executor: Executor = db) {
  // An entry's line: its own, or the line its cash-in names.
  const [row] = (await executor.execute(sql`
    select r.subject_id as "subjectId", coalesce(r.mode = 'self_study', false) as "selfStudy", s.month, s.year
    from exam_entry e join board_series s on s.id = e.board_series_id
    left join charge c on c.id = e.charge_id
    left join registration r on r.id = coalesce(e.registration_id, c.registration_id)
    where e.id = ${e.id}`)).rows as { subjectId: string | null; selfStudy: boolean; month: string; year: number }[];
  return { subjectId: row?.subjectId ?? null, takenOutsideSchool: row?.selfStudy ?? false, academicYearStart: seriesAcademicYearStart(row!.month, row!.year) };
}

/**
 * The open course enrolments of these students in these subjects, per academic year, so each
 * entry finds its teacher as `teacherOf` does (`pickEnrolment`: the unit's own enrolment, else the
 * subject's, else the one teacher of all its units).
 */
async function enrolmentsOf(executor: Executor, keys: { studentId: string; subjectId: string | null; yearStart: number }[]) {
  const want = keys.filter((k): k is { studentId: string; subjectId: string; yearStart: number } => !!k.subjectId);
  if (!want.length) return () => null;
  const rows = (await executor.execute(sql`
    select ce.student_id as "studentId", ce.subject_id as "subjectId", ce.unit_id as "unitId", ay.start_year as "yearStart",
      ce.mode, ce.teacher_id as "teacherId", t.name as "teacherName", t.user_id as "teacherUserId"
    from course_enrolment ce join academic_year ay on ay.id = ce.academic_year_id left join teacher t on t.id = ce.teacher_id
    where ce.ended_on is null
      and ce.student_id in (${sql.join([...new Set(want.map((k) => k.studentId))].map((id) => sql`${id}`), sql`, `)})
      and ce.subject_id in (${sql.join([...new Set(want.map((k) => k.subjectId))].map((id) => sql`${id}`), sql`, `)})`)).rows as {
    studentId: string; subjectId: string; unitId: string | null; yearStart: number; mode: string; teacherId: string | null; teacherName: string | null; teacherUserId: string | null;
  }[];
  return (k: { studentId: string; subjectId: string | null; yearStart: number; unitId: string | null }) =>
    k.subjectId ? pickEnrolment(rows.filter((r) => r.studentId === k.studentId && r.subjectId === k.subjectId && r.yearStart === k.yearStart), k.unitId) : null;
}

/**
 * Set an entry's forecast grade: the coordinator or admin, or the teacher who
 * teaches the candidate the subject that year (F0b's `teacherOf`). Another
 * teacher is refused. Cambridge fixes a forecast once it has been sent.
 */
export async function setForecast(entryId: string, grade: string | null, actor: { id: string; role?: string | null }, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const e = await lockEntry(tx, entryId);
    if (!hasRole(actor.role, ...ACADEMIC_ROLES)) {
      const fc = await forecastContext(e, tx);
      const t = fc.subjectId ? await teacherOf(e.studentId, fc.subjectId, fc.academicYearStart, e.unitId) : null;
      if (!t || t.userId !== actor.id) throw new ExamError('Only the candidate\'s teacher for this subject, or the coordinator, gives this forecast', 403);
    }
    if (e.status === 'withdrawn') throw new ExamError('This entry was withdrawn', 409);
    const rules = await boardRulesFor(e.boardCode, tx);
    if (e.forecastLockedAt && rules.forecastLockedOnSubmit) {
      throw new ExamError('This forecast grade has gone to the board, which does not accept a change to it', 409);
    }
    if (grade) {
      // The grade must fit what is entered (an IGCSE takes no lower-case AS grade).
      const [lv] = e.kind === 'award'
        ? await tx.select({ level: qualification.level }).from(qualification).where(eq(qualification.id, e.qualificationId!))
        : await tx.select({ level: examUnit.unitLevel }).from(examUnit).where(eq(examUnit.id, e.unitId!));
      const level = !lv ? null : lv.level === 'igcse' ? 'igcse' : lv.level === 'as' || lv.level === 'as_level' ? 'as' : 'a_level';
      const problem = forecastGradeProblem(level, grade);
      if (problem) throw new ExamError(problem, 400);
    }
    if ((e.forecastGrade ?? null) === grade) return e;
    const [row] = await tx.update(examEntry).set({ forecastGrade: grade, forecastBy: actor.id, forecastAt: new Date(), updatedAt: new Date() })
      .where(eq(examEntry.id, entryId)).returning();
    await logAction(actor.id, 'FORECAST_GRADE_SET', 'exam_entry', entryId, { forecastGrade: e.forecastGrade }, { forecastGrade: grade }, ctx, tx);
    return row!;
  });
}

/**
 * The forecasts to give: for the coordinator and admin, every live entry of
 * the series whose board asks for one; for a teacher, only the candidates
 * they teach that subject that year (course enrolment). Each row says whether
 * it is given, fixed, and when the board wants them.
 */
export async function listForecasts(actor: { id: string; role?: string | null }, boardSeriesId?: string) {
  const academic = hasRole(actor.role, ...ACADEMIC_ROLES);
  const [t] = await db.select({ id: teacher.id }).from(teacher).where(eq(teacher.userId, actor.id));
  if (!academic && !t) throw new ExamError('Your account is not linked to a teacher record — ask the admin to link it on the Team page', 404);
  const found = (await db.execute(sql`
    select e.id as "entryId", e.student_id as "studentId", u.name as "studentName", e.entry_code as "entryCode", e.title, e.unit_id as "unitId",
      e.forecast_grade as "forecastGrade", e.forecast_locked_at as "forecastLockedAt", e.status, e.board_code as "boardCode",
      fb.name as "forecastByName", e.forecast_at as "forecastAt",
      s.id as "boardSeriesId", s.month, s.year, s.label, s.forecast_grades_due::text as "forecastGradesDue",
      school_series_academic_year_start(s.month, s.year) as "yearStart",
      sub.id as "subjectId", sub.name as "subjectName", coalesce(r.mode = 'self_study', false) as "takenOutsideSchool"
    from exam_entry e
    join board_series s on s.id = e.board_series_id
    join "user" u on u.id = e.student_id
    left join charge c on c.id = e.charge_id
    left join registration r on r.id = coalesce(e.registration_id, c.registration_id)
    left join subject sub on sub.id = r.subject_id
    left join exam_board_rule br on br.board_code = e.board_code
    left join "user" fb on fb.id = e.forecast_by
    where e.status <> 'withdrawn' and coalesce(br.forecast_required, false)
      ${boardSeriesId ? sql`and e.board_series_id = ${boardSeriesId}` : sql`and (s.exams_end is null or s.exams_end >= current_date)`}
    order by s.year, s.month, sub.name, u.name
  `)).rows as {
    entryId: string; studentId: string; studentName: string; entryCode: string; title: string; unitId: string | null; forecastGrade: string | null;
    forecastLockedAt: string | null; status: string; boardCode: string; boardSeriesId: string; month: string; year: number; label: string;
    forecastGradesDue: string | null; forecastByName: string | null; forecastAt: string | null; yearStart: number; subjectId: string | null; subjectName: string | null;
    takenOutsideSchool: boolean;
  }[];
  // Each entry's teacher as teacherOf finds it (the unit's enrolment since the rework); a teacher sees only their own.
  const enrolmentFor = await enrolmentsOf(db, found.map((r) => ({ studentId: r.studentId, subjectId: r.subjectId, yearStart: Number(r.yearStart) })));
  const rows = found
    .map(({ yearStart, unitId, ...r }) => {
      const ce = enrolmentFor({ studentId: r.studentId, subjectId: r.subjectId, yearStart: Number(yearStart), unitId });
      return { ...r, mode: ce?.mode ?? null, teacherId: ce?.teacherId ?? null, teacherName: ce?.teacherName ?? null };
    })
    .filter((r) => academic || (r.teacherId === t!.id && r.mode === 'in_school'));
  const names = await boardNameMap();
  const selfStudy = await getSetting('exams.selfStudyForecast');
  return rows
    .map((r) => {
      const isSelfStudy = r.mode === 'self_study' || r.takenOutsideSchool;
      return {
        ...r,
        seriesName: boardSeriesName(names, { boardCode: r.boardCode, month: r.month, year: r.year, label: r.label }),
        selfStudy: isSelfStudy,
        required: !(isSelfStudy && selfStudy === 'not_required'),
        locked: !!r.forecastLockedAt,
        mine: !!t && r.teacherId === t.id,
      };
    });
}

/**
 * Record that a series' forecasts went to the board: each given forecast is
 * fixed from then on where the board says so (Cambridge). Those still missing
 * stay flagged.
 */
export async function submitForecasts(boardSeriesId: string, actorId: string, ctx?: AuditContext) {
  const series = await seriesOrThrow(boardSeriesId);
  return db.transaction(async (tx) => {
    const locked = await tx.update(examEntry).set({ forecastLockedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(examEntry.boardSeriesId, series.id), sql`${examEntry.status} <> 'withdrawn'`, sql`${examEntry.forecastGrade} is not null`, isNull(examEntry.forecastLockedAt)))
      .returning({ id: examEntry.id });
    await tx.insert(examSeriesState).values({ boardSeriesId: series.id, forecastsSubmittedAt: new Date(), forecastsSubmittedBy: actorId })
      .onConflictDoUpdate({ target: examSeriesState.boardSeriesId, set: { forecastsSubmittedAt: new Date(), forecastsSubmittedBy: actorId } });
    const [missing] = await tx.select({ n: sql<number>`count(*)::int` }).from(examEntry)
      .where(and(eq(examEntry.boardSeriesId, series.id), sql`${examEntry.status} <> 'withdrawn'`, isNull(examEntry.forecastGrade)));
    await logAction(actorId, 'FORECASTS_SUBMITTED', 'board_series', series.id, null, { locked: locked.length, missing: missing?.n ?? 0 }, ctx, tx);
    return { locked: locked.length, missing: missing?.n ?? 0 };
  });
}

// ─── Reading entries, with what each still needs ─────────────────────────────

/**
 * Everything the check reads for a set of entries: each candidate's details
 * and number in the series, the series and its board's rules, the centre,
 * each entry's registration and the candidate's enrolment (teacher, self-study),
 * and whether its award is tiered.
 */
async function assess(entries: EntryRow[]) {
  const seriesIds = [...new Set(entries.map((e) => e.boardSeriesId))];
  const studentIds = [...new Set(entries.map((e) => e.studentId))];
  const seriesRows = seriesIds.length ? await db.select().from(boardSeries).where(inArray(boardSeries.id, seriesIds)) : [];
  const names = await boardNameMap();
  const series = new Map(seriesRows.map((s) => [s.id, { ...s, name: boardSeriesName(names, s), boardName: names.get(s.boardCode) ?? s.boardCode }]));
  const [rules, candidates, centres, selfStudySetting] = await Promise.all([
    boardRulesMap(seriesRows.map((s) => s.boardCode)),
    candidatesOf(studentIds),
    getSetting('exams.centres'),
    getSetting('exams.selfStudyForecast'),
  ]);
  const numbers = new Map<string, Map<string, string>>();
  for (const sid of seriesIds) numbers.set(sid, await numbersIn(sid, entries.filter((e) => e.boardSeriesId === sid).map((e) => e.studentId)));
  // What each entry's line says now (the review of 093dbd1, item 2): the derivation's own plan per
  // series (one student's when the entries are one student's), so the check compares an entry with
  // its line by the same rule that made it — a sitting answered after the entry was made shows.
  const expectOf = new Map<string, LineExpect>();
  for (const sid of seriesIds.filter((x) => entries.some((e) => e.boardSeriesId === x && e.registrationId && e.status !== 'withdrawn'))) {
    const its = [...new Set(entries.filter((e) => e.boardSeriesId === sid).map((e) => e.studentId))];
    const planned = await planDerivation(await seriesOrThrow(sid), its.length === 1 ? its[0] : undefined, db);
    for (const r of planned) if (r.registrationId && r.expect) expectOf.set(r.registrationId, r.expect);
  }
  // Each entry's line: its own, or the line its cash-in names; and each cash-in's state.
  const chargeIds = [...new Set(entries.map((e) => e.chargeId).filter((x): x is string => !!x))];
  const charges = chargeIds.length
    ? await db.select({ id: charge.id, status: charge.status, registrationId: charge.registrationId }).from(charge).where(inArray(charge.id, chargeIds))
    : [];
  const chargeById = new Map(charges.map((c) => [c.id, c]));
  const lineOf = (e: EntryRow) => e.registrationId ?? (e.chargeId ? chargeById.get(e.chargeId)?.registrationId ?? null : null);
  const regIds = [...new Set(entries.map(lineOf).filter((x): x is string => !!x))];
  const regs = regIds.length
    ? (await db.execute(sql`
        select r.id, r.status, r.student_id as "studentId", r.session_id as "sessionId", r.subject_id as "subjectId", r.mode = 'self_study' as "takenOutsideSchool", sub.name as "subjectName",
          (r.prior_sitting_source in ('declared_by_family', 'declared_by_desk') and r.prior_sitting_verified_outcome is null) as "declaredUnverified",
          school_series_academic_year_start(s.month, s.year) as "yearStart"
        from registration r join subject sub on sub.id = r.subject_id
        left join board_series s on s.id = r.board_series_id
        where r.id in (${sql.join(regIds.map((id) => sql`${id}`), sql`, `)})`)).rows as {
          id: string; status: string; studentId: string; sessionId: string; subjectId: string; takenOutsideSchool: boolean; subjectName: string; declaredUnverified: boolean; yearStart: number | null;
        }[]
    : [];
  const enrolmentFor = await enrolmentsOf(db, regs.map((r) => ({ studentId: r.studentId, subjectId: r.subjectId, yearStart: Number(r.yearStart) })));
  const verification = await getSetting('verification.unverifiedAtDeadline');
  const regById = new Map(regs.map((r) => [r.id, r]));
  /** The line an entry was made from (its own, or its cash-in's) with the enrolment that teaches it. */
  const lineFacts = (e: EntryRow) => {
    const id = lineOf(e);
    const reg = id ? regById.get(id) : undefined;
    if (!reg) return undefined;
    const ce = enrolmentFor({ studentId: reg.studentId, subjectId: reg.subjectId, yearStart: Number(reg.yearStart), unitId: e.unitId });
    return { ...reg, mode: ce?.mode ?? null, teacherName: ce?.teacherName ?? null, teacherUserId: ce?.teacherUserId ?? null };
  };
  const qualIds = [...new Set(entries.map((e) => e.qualificationId).filter((x): x is string => !!x))];
  const tiered = qualIds.length
    ? new Set((await db.execute(sql`
        select distinct q.id from qualification q join qualification_unit qu on qu.qualification_id = q.id join exam_unit u on u.id = qu.unit_id
        where q.id in (${sql.join(qualIds.map((id) => sql`${id}`), sql`, `)}) and u.tier is not null and q.tier is null`)).rows.map((r) => (r as { id: string }).id))
    : new Set<string>();
  const today = schoolDateString(new Date());

  const problemsOf = (e: EntryRow): EntryProblem[] => {
    if (e.status === 'withdrawn') return [];
    const s = series.get(e.boardSeriesId)!;
    const r = rules.get(s.boardCode)!;
    const c = candidates.get(e.studentId);
    const reg = lineFacts(e);
    const selfStudy = !!reg && (reg.mode === 'self_study' || reg.takenOutsideSchool);
    const out: EntryProblem[] = [];
    if (!centres[s.boardCode]?.centreNumber) out.push('missing_centre_number');
    if (!numbers.get(s.id)!.get(e.studentId)) out.push('missing_candidate_number');
    if (!c?.legalForenames || !c?.legalSurname) out.push('missing_legal_name');
    if (!c?.dateOfBirth) out.push('missing_date_of_birth');
    if (!c?.gender) out.push('missing_gender');
    if (r.uciRequired && !c?.uci) out.push('missing_uci');
    if (r.optionCodeRequired && e.kind === 'award' && !e.optionCode) out.push('missing_option_code');
    if (e.kind === 'award' && e.qualificationId && tiered.has(e.qualificationId) && !e.tier) out.push('missing_tier');
    if (r.forecastRequired && !e.forecastGrade && !(selfStudy && selfStudySetting === 'not_required')) out.push('missing_forecast');
    if (e.carryForward !== 'none' && (!e.cfCentreNumber || !e.cfCandidateNumber || !e.cfFromYear)) out.push('carry_forward_incomplete');
    if (e.carryForward === 'suggested') out.push('carry_forward_to_confirm');
    if (e.registrationId && reg && reg.status !== 'confirmed') out.push('registration_not_confirmed');
    if (e.chargeId && chargeById.get(e.chargeId)?.status !== 'paid') out.push('cash_in_not_paid');
    // A declared earlier sitting not verified yet: entered as declared, or held (Q-22's setting).
    if (e.registrationId && reg?.declaredUnverified) out.push(verification === 'hold' ? 'prior_sitting_held' : 'prior_sitting_unverified');
    // Its line's answer changed what the board should see (retake, carry forward, the previous
    // centre and number) after the entry was made: the coordinator amends it (a draft is brought up
    // to date by the next derivation).
    const x = e.registrationId ? expectOf.get(e.registrationId) : undefined;
    if (x) {
      const d = lineDiff(e, x);
      if (d.retake) out.push('retake_differs_from_line');
      if (d.carry) out.push('carry_forward_differs_from_line');
    }
    const aa = (e.accessArrangements ?? c?.accessArrangements ?? []) as string[];
    if (aa.length && (!c?.accessArrangementsRef || (c.accessArrangementsUntil && c.accessArrangementsUntil < today))) out.push('access_arrangements_unapproved');
    return out;
  };
  return { series, rules, candidates, numbers, lineFacts, centres, problemsOf };
}

/** Entries of a series or a student, each with what it still needs and what withdrawing it now would cost. */
export async function listEntries(q: ListEntriesQueryType) {
  if (!q.boardSeriesId && !q.studentId) throw new ExamError('Choose a series or a student', 400);
  const rows = await db.select({ e: examEntry, studentName: user.name })
    .from(examEntry).innerJoin(user, eq(user.id, examEntry.studentId))
    .where(and(
      q.boardSeriesId ? eq(examEntry.boardSeriesId, q.boardSeriesId) : undefined,
      q.studentId ? eq(examEntry.studentId, q.studentId) : undefined,
      q.status ? eq(examEntry.status, q.status) : undefined,
      q.includeWithdrawn === 'true' || q.status === 'withdrawn' ? undefined : sql`${examEntry.status} <> 'withdrawn'`,
    ))
    .orderBy(asc(user.name), asc(examEntry.entryCode));
  const a = await assess(rows.map((r) => r.e));
  const forecastBy = [...new Set(rows.map((r) => r.e.forecastBy).filter((x): x is string => !!x))];
  const forecasters = forecastBy.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, forecastBy)) : [];
  return rows.map(({ e, studentName }) => {
    const s = a.series.get(e.boardSeriesId)!;
    const reg = a.lineFacts(e);
    return {
      ...e,
      studentName,
      seriesName: s.name,
      boardName: s.boardName,
      entryDeadline: s.entryDeadline,
      pastDeadline: pastEntryDeadline(s),
      candidateNumber: a.numbers.get(s.id)!.get(e.studentId) ?? null,
      registrationStatus: reg?.status ?? null,
      subjectName: reg?.subjectName ?? null,
      teacherName: reg?.teacherName ?? null,
      selfStudy: !!reg && (reg.mode === 'self_study' || reg.takenOutsideSchool),
      forecastByName: forecasters.find((f) => f.id === e.forecastBy)?.name ?? null,
      forecastRequired: a.rules.get(s.boardCode)!.forecastRequired,
      feeTierToday: feeTierOn(s, schoolDateString(new Date())),
      ifWithdrawnNow: e.status === 'withdrawn' ? null : withdrawalCharge(a.rules.get(s.boardCode)!, s, e.status).sentence,
      problems: a.problemsOf(e),
    };
  });
}

/**
 * A board series' entry list: one row per live entry with the board portal's
 * fields in its own order (ENTRY_LIST_COLUMNS, all assumed until checked
 * against the board's template), what each row is missing, and the confirmed
 * registrations that have no entry yet.
 */
export async function getEntryList(boardSeriesId: string) {
  const series = await seriesOrThrow(boardSeriesId);
  const rules = await boardRulesFor(series.boardCode);
  const centre = await centreFor(series.boardCode);
  const entries = await db.select({ e: examEntry, studentName: user.name })
    .from(examEntry).innerJoin(user, eq(user.id, examEntry.studentId))
    .where(and(eq(examEntry.boardSeriesId, series.id), sql`${examEntry.status} <> 'withdrawn'`));
  const a = await assess(entries.map((r) => r.e));
  const numbers = a.numbers.get(series.id) ?? new Map<string, string>();
  const dmy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
  const tierLetter = (t: string | null) => (t ? ({ core: 'C', extended: 'E', foundation: 'F', higher: 'H' } as Record<string, string>)[t] ?? '' : '');
  const columns = ENTRY_LIST_COLUMNS[series.boardCode] ?? GENERIC_ENTRY_LIST_COLUMNS;
  const rows = entries.map(({ e, studentName }) => {
    const c = a.candidates.get(e.studentId);
    const aa = ((e.accessArrangements ?? c?.accessArrangements ?? []) as AccessArrangement[]).map((x) => ACCESS_ARRANGEMENT_LABELS[x] ?? x).join('; ');
    const values: Record<string, string> = {
      centreNumber: centre.centreNumber ?? '',
      candidateNumber: numbers.get(e.studentId) ?? '',
      candidateName: c?.legalSurname && c?.legalForenames ? `${c.legalSurname.toUpperCase()}, ${c.legalForenames}` : '',
      surname: c?.legalSurname?.toUpperCase() ?? '',
      forenames: c?.legalForenames ?? '',
      dateOfBirth: dmy(c?.dateOfBirth),
      gender: c?.gender === 'female' ? 'F' : c?.gender === 'male' ? 'M' : '',
      uci: c?.uci ?? '',
      syllabusCode: e.entryCode,
      entryCode: e.entryCode,
      optionCode: e.optionCode ?? '',
      tier: tierLetter(e.tier),
      retake: e.isRetake ? 'Y' : 'N',
      resit: e.isRetake ? 'Y' : 'N',
      previousCentre: e.carryForward !== 'none' ? e.cfCentreNumber ?? '' : '',
      previousCandidate: e.carryForward !== 'none' ? e.cfCandidateNumber ?? '' : '',
      carryForwardFrom: e.carryForward !== 'none' && e.cfFromMonth && e.cfFromYear ? seriesLabel(e.cfFromMonth, e.cfFromYear) : '',
      series: seriesLabel(series.month, series.year),
      forecastGrade: e.forecastGrade ?? '',
      accessArrangements: aa,
    };
    const line = a.lineFacts(e);
    return {
      entryId: e.id, studentId: e.studentId, studentName, status: e.status, kind: e.kind, entryCode: e.entryCode, title: e.title,
      registrationId: e.registrationId, chargeId: e.chargeId, sessionId: line?.sessionId ?? null,
      values: Object.fromEntries(columns.map((col) => [col.key, values[col.key] ?? ''])),
      problems: a.problemsOf(e),
    };
  }).sort((x, y) => (x.values.candidateNumber || 'z').localeCompare(y.values.candidateNumber || 'z') || x.studentName.localeCompare(y.studentName) || x.entryCode.localeCompare(y.entryCode));
  // Confirmed lines of the series with no live entry: derive them, or map the subject first. A line
  // that follows a declared sitting not verified yet says so (entered as declared, or held, Q-22).
  const unentered = (await db.execute(sql`
    select r.id as "registrationId", r.student_id as "studentId", u.name as "studentName", sub.name as "subjectName", sub.code as "subjectCode",
      i.label as "itemLabel", i.kind as "itemKind",
      (i.enters_kind <> 'subject' or sub.qualification_id is not null or exists (select 1 from subject_unit su where su.subject_id = sub.id)) as mapped,
      (r.prior_sitting_source in ('declared_by_family', 'declared_by_desk') and r.prior_sitting_verified_outcome is null) as "declaredUnverified",
      (select max(e.withdrawn_at) from exam_entry e where e.registration_id = r.id and e.status = 'withdrawn') as "withdrawnAt"
    from registration r join "user" u on u.id = r.student_id join subject sub on sub.id = r.subject_id
    join session_offer_item i on i.id = r.offer_item_id
    where r.board_series_id = ${series.id} and r.status = 'confirmed'
      and not exists (select 1 from exam_entry e where e.registration_id = r.id and e.status <> 'withdrawn')
    order by u.name, sub.name`)).rows as {
      registrationId: string; studentId: string; studentName: string; subjectName: string; subjectCode: string; itemLabel: string; itemKind: string;
      mapped: boolean; declaredUnverified: boolean; withdrawnAt: string | null;
    }[];
  const verification = await getSetting('verification.unverifiedAtDeadline');
  // Paid cash-ins of the series with no live entry: derived when their line says the award, else added by hand.
  const paidCashIns = [...(await chargesOfKind('cash_in', series.id)), ...(await chargesOfKind('late_cash_in', series.id))].filter((c) => c.status === 'paid');
  const enteredCharges = paidCashIns.length
    ? new Set((await db.select({ chargeId: examEntry.chargeId }).from(examEntry)
      .where(and(inArray(examEntry.chargeId, paidCashIns.map((c) => c.id)), sql`${examEntry.status} <> 'withdrawn'`))).map((x) => x.chargeId))
    : new Set<string | null>();
  const cashInStudents = paidCashIns.length
    ? new Map((await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(paidCashIns.map((c) => c.studentId))]))).map((x) => [x.id, x.name]))
    : new Map<string, string>();
  // A cash-in whose award is already entered without one is linked by the next derivation (the
  // review of 093dbd1, item 6): it says so, and leaves the list once linked.
  const unlinkedAwards = paidCashIns.length
    ? await db.select({ studentId: examEntry.studentId }).from(examEntry).innerJoin(qualification, eq(qualification.id, examEntry.qualificationId))
      .where(and(eq(examEntry.boardSeriesId, series.id), eq(examEntry.kind, 'award'), isNull(examEntry.chargeId), sql`${examEntry.status} <> 'withdrawn'`, eq(qualification.entryMethod, 'units_cash_in')))
    : [];
  const cashInsToEnter = paidCashIns.filter((c) => !enteredCharges.has(c.id)).map((c) => ({
    chargeId: c.id, studentId: c.studentId, studentName: cashInStudents.get(c.studentId) ?? '', description: c.description, kind: c.kind,
    registrationId: c.registrationId, deadline: c.deadline,
    awardEntered: unlinkedAwards.some((u) => u.studentId === c.studentId),
  }));
  const summary = Object.fromEntries(ENTRY_PROBLEMS.map((p) => [p, rows.filter((r) => r.problems.includes(p)).length])) as Record<EntryProblem, number>;
  return {
    series: {
      id: series.id, name: series.name, boardCode: series.boardCode, boardName: series.boardName, month: series.month, year: series.year,
      entryDeadline: series.entryDeadline, pastDeadline: pastEntryDeadline(series), forecastGradesDue: series.forecastGradesDue,
      feeTierToday: feeTierOn(series, schoolDateString(new Date())),
    },
    centre,
    rules,
    columns,
    rows,
    ready: rows.filter((r) => !r.problems.length).length,
    summary,
    unentered: unentered.map((u) => ({ ...u, held: u.declaredUnverified && verification === 'hold' })),
    cashInsToEnter,
  };
}

/** The entries of a student that a board list, statement or timetable reads (live ones). */
export async function liveEntriesOf(studentId: string, boardSeriesId?: string, familyView = false) {
  return db.select().from(examEntry).where(and(
    eq(examEntry.studentId, studentId),
    boardSeriesId ? eq(examEntry.boardSeriesId, boardSeriesId) : undefined,
    familyView ? inArray(examEntry.status, ['submitted', 'amended']) : sql`${examEntry.status} <> 'withdrawn'`,
  ));
}
