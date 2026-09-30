/**
 * Exam entries (FEATURES_PLAN.md F4, "Entries" and "Entry lists";
 * DISCOVERY_RESEARCH.md §5 notes 2 and 4).
 *
 * An entry is one unit or award a candidate is entered for with a board in
 * one board series. Entries are derived from confirmed registrations through
 * F0b's `entryItemsFor`: a Cambridge syllabus is entered as the award with
 * the option code that enters its components; Pearson units are entered unit
 * by unit (a whole Pearson award as its required units and the cash-in); an
 * International GCSE as its award. The coordinator can add an entry by hand
 * (a cash-in with no unit sat this series).
 *
 * The school's hard stop (MO-10, A-08) holds for entries: no entry is made,
 * and none is marked as sent to the board, after the series' entry deadline.
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
  db, examEntry, examBoardRule, examSeriesState, registration, qualification, qualificationOption,
  qualificationOptionUnit, qualificationUnit, examUnit, boardSeries, user, teacher,
  eq, and, inArray, sql, asc, isNull,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  ACADEMIC_ROLES, ACCESS_ARRANGEMENT_LABELS, ENTRY_LIST_COLUMNS, GENERIC_ENTRY_LIST_COLUMNS, ENTRY_PROBLEMS, hasRole,
  feeTierOn, schoolDateString, seriesLabel, seriesAcademicYearStart,
  type AccessArrangement, type CreateEntryType, type DeriveEntriesType, type EntryProblem, type ListEntriesQueryType,
  type SubmitEntriesType, type UpdateBoardRuleType, type UpdateEntryType,
} from '@repo/validations';
import { entryItemsFor } from './catalogue.services';
import { teacherOf } from './enrolment.services';
import { getSetting } from './settings.services';
import { logAction, type AuditContext } from './audit.services';
import { createBulkNotifications } from './notification.services';
import { candidatesOf, numbersIn } from './exam-candidate.services';
import {
  ExamError, advisoryLock, amendmentCharge, boardNameMap, boardRulesFor, boardRulesMap, centreFor, familyOf, hardStopSentence,
  pastEntryDeadline, seriesOrThrow, withdrawalCharge, isUniqueViolation,
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

export async function updateBoardRule(boardCode: string, data: UpdateBoardRuleType, actorId: string, ctx?: AuditContext) {
  const names = await boardNameMap();
  if (!names.has(boardCode)) throw new ExamError('Board not found', 404);
  const { reason, ...fields } = data;
  const values = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (!Object.keys(values).length) throw new ExamError('Nothing to change', 400);
  return db.transaction(async (tx) => {
    const before = await boardRulesFor(boardCode, tx);
    const [row] = await tx.insert(examBoardRule)
      .values({ boardCode, ...values, updatedBy: actorId })
      .onConflictDoUpdate({ target: examBoardRule.boardCode, set: { ...values, updatedBy: actorId, updatedAt: new Date() } })
      .returning();
    const pick = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(values).map((k) => [k, o[k] ?? null]));
    await logAction(actorId, 'EXAM_BOARD_RULE_UPDATED', 'exam_board_rule', boardCode, pick(before), { ...pick(values), reason }, ctx, tx);
    return row!;
  });
}

// ─── Deriving entries from registrations ─────────────────────────────────────

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
  carryForward: 'none' | 'suggested';
  cfFromMonth: string | null;
  cfFromYear: number | null;
  cfCentreNumber: string | null;
  cfCandidateNumber: string | null;
  cfOption: string | null;
};

type DeriveRow = {
  registrationId: string;
  studentId: string;
  studentName: string;
  subject: { id: string; name: string; code: string };
  levelCode: string;
  outcome: 'ready' | 'entered' | 'not_mapped';
  note: string | null;
  entries: (PlannedEntry & { state: 'new' | 'exists' | 'elsewhere'; existingEntryId: string | null })[];
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

/** The tier the units of an option share, if they share one. */
function sharedTier(tiers: (string | null)[]): string | null {
  const t = [...new Set(tiers.filter(Boolean))];
  return t.length === 1 && tiers.every(Boolean) ? t[0]! : null;
}

/**
 * Plan the entries for the confirmed registrations of a series (or one
 * student's), against what is already entered. Pure reading: the commit
 * re-plans inside its transaction.
 */
async function planDerivation(series: SeriesRow, studentId: string | undefined, executor: Executor) {
  const regs = await executor.select({ id: registration.id, studentId: registration.studentId, isRetake: registration.isRetake })
    .from(registration)
    .where(and(eq(registration.boardSeriesId, series.id), eq(registration.status, 'confirmed'), studentId ? eq(registration.studentId, studentId) : undefined));
  if (!regs.length) return [] as DeriveRow[];
  const items = await entryItemsFor(regs.map((r) => r.id));
  const studentIds = [...new Set(regs.map((r) => r.studentId))];
  const [students, existing, cat, history, numbers, cfSetting] = await Promise.all([
    executor.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, studentIds)),
    executor.select().from(examEntry).where(and(eq(examEntry.boardSeriesId, series.id), inArray(examEntry.studentId, studentIds), sql`${examEntry.status} <> 'withdrawn'`)),
    catalogueFor(items.map((i) => i.qualification?.id).filter((x): x is string => !!x), executor),
    // Every earlier entry and result of these students (retakes; an AS entry to carry forward).
    executor.execute(sql`
      select e.student_id as "studentId", e.unit_id as "unitId", e.qualification_id as "qualificationId", e.entry_code as "code",
        e.board_code as "boardCode", s.month, s.year, s.id as "seriesId", q.level as "qualLevel"
      from exam_entry e join board_series s on s.id = e.board_series_id left join qualification q on q.id = e.qualification_id
      where e.student_id in (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)}) and e.status <> 'withdrawn' and e.board_series_id <> ${series.id}
      union all
      select r.student_id, r.unit_id, r.qualification_id, r.code, r.board_code, s.month, s.year, s.id, q.level
      from exam_result r join board_series s on s.id = r.board_series_id left join qualification q on q.id = r.qualification_id
      where r.student_id in (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)}) and r.board_series_id <> ${series.id}
    `).then((r) => r.rows as { studentId: string; unitId: string | null; qualificationId: string | null; code: string; boardCode: string; month: string; year: number; seriesId: string; qualLevel: string | null }[]),
    executor.execute(sql`
      select n.student_id as "studentId", n.board_series_id as "seriesId", n.number, n.centre_number as "centreNumber"
      from exam_candidate_number n where n.student_id in (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})
    `).then((r) => r.rows as { studentId: string; seriesId: string; number: string; centreNumber: string | null }[]),
    getSetting('exams.carryForward', executor),
  ]);
  const rules = await boardRulesFor(series.boardCode, executor);
  const centre = await centreFor(series.boardCode);
  const nameOf = new Map(students.map((s) => [s.id, s.name]));
  const here = monthIndex(series.month, series.year);
  const retakeFrom = new Map(regs.map((r) => [r.id, r.isRetake]));

  const unitEntry = (studentId: string, u: { id: string; code: string; title: string; tier: string | null }): PlannedEntry => {
    const earlier = history.some((h) => h.studentId === studentId && (h.unitId === u.id || (h.code === u.code && h.boardCode === series.boardCode)) && monthIndex(h.month, h.year) < here);
    return {
      kind: 'unit', unitId: u.id, qualificationId: null, entryCode: u.code, title: u.title, optionCode: null, tier: u.tier,
      isRetake: earlier, retakeSource: earlier ? 'history' : null,
      carryForward: 'none', cfFromMonth: null, cfFromYear: null, cfCentreNumber: null, cfCandidateNumber: null, cfOption: null,
    };
  };
  const awardEntry = (studentId: string, q: { id: string; code: string; title: string; level: string; tier: string | null }, optionCode: string | null, tier: string | null): PlannedEntry => {
    const earlier = history.some((h) => h.studentId === studentId && (h.qualificationId === q.id || (h.code === q.code && h.boardCode === series.boardCode && h.qualLevel === q.level)) && monthIndex(h.month, h.year) < here);
    const planned: PlannedEntry = {
      kind: 'award', unitId: null, qualificationId: q.id, entryCode: q.code, title: q.title, optionCode, tier: q.tier ?? tier,
      isRetake: earlier, retakeSource: earlier ? 'history' : null,
      carryForward: 'none', cfFromMonth: null, cfFromYear: null, cfCentreNumber: null, cfCandidateNumber: null, cfOption: null,
    };
    // An A Level after the candidate's AS of the same syllabus within the board's period (Cambridge: 13 months).
    if (cfSetting === 'suggest' && rules.carryForwardMonths && q.level === 'a_level') {
      const as = history
        .filter((h) => h.studentId === studentId && h.code === q.code && h.boardCode === series.boardCode && h.qualLevel === 'as_level')
        .filter((h) => { const gap = here - monthIndex(h.month, h.year); return gap > 0 && gap <= rules.carryForwardMonths!; })
        .sort((a, b) => monthIndex(b.month, b.year) - monthIndex(a.month, a.year))[0];
      if (as) {
        const n = numbers.find((x) => x.studentId === studentId && x.seriesId === as.seriesId);
        const cfOption = cat.options.filter((o) => o.qualificationId === q.id && o.carryForward);
        Object.assign(planned, {
          carryForward: 'suggested', cfFromMonth: as.month, cfFromYear: as.year,
          cfCentreNumber: n?.centreNumber ?? centre.centreNumber, cfCandidateNumber: n?.number ?? null,
          cfOption: `${as.month}_carry_forward`,
          optionCode: planned.optionCode ?? (cfOption.length === 1 ? cfOption[0]!.code : null),
        });
      }
    }
    return planned;
  };

  const rows: DeriveRow[] = [];
  for (const item of items) {
    const reg = regs.find((r) => r.id === item.registrationId)!;
    const q = item.qualification;
    let planned: PlannedEntry[] | null = null;
    let note: string | null = null;
    if (item.units.length && q?.entryMethod === 'syllabus_option') {
      // Cambridge: the syllabus, with the option entering exactly these components.
      const want = new Set(item.units.map((u) => u.id));
      const opt = cat.options.find((o) => {
        if (o.qualificationId !== q.id) return false;
        const units = cat.optionUnits.filter((ou) => ou.optionId === o.id).map((ou) => ou.unitId);
        return units.length === want.size && units.every((u) => want.has(u));
      });
      if (!opt) note = 'No option code of the syllabus enters exactly these components — choose it on the entry';
      planned = [awardEntry(reg.studentId, q, opt?.code ?? null, sharedTier(item.units.map((u) => u.tier)))];
    } else if (item.units.length) {
      planned = item.units.map((u) => unitEntry(reg.studentId, u));
    } else if (q) {
      if (q.entryMethod === 'units_cash_in') {
        const units = cat.qualUnits.filter((u) => u.qualificationId === q.id);
        const required = units.filter((u) => u.requirement === 'required' && !u.choiceGroup);
        const groups = [...new Set(units.filter((u) => u.choiceGroup).map((u) => u.choiceGroup!))];
        if (groups.length) {
          note = `Choose the unit for ${groups.map((g) => `"${g}" (${units.filter((u) => u.choiceGroup === g).map((u) => u.shortCode ?? u.code).join(', ')})`).join(', ')} and add it on the entry list`;
        }
        planned = [...required.map((u) => unitEntry(reg.studentId, { id: u.unitId, code: u.code, title: u.title, tier: u.tier })), awardEntry(reg.studentId, q, null, null)];
      } else {
        const opts = cat.options.filter((o) => o.qualificationId === q.id && !o.carryForward);
        const opt = opts.length === 1 ? opts[0]! : null;
        const optTier = opt ? sharedTier(cat.optionUnits.filter((ou) => ou.optionId === opt.id).map((ou) => cat.qualUnits.find((u) => u.unitId === ou.unitId)?.tier ?? null)) : null;
        planned = [awardEntry(reg.studentId, q, opt?.code ?? null, optTier)];
      }
    }
    if (planned && retakeFrom.get(reg.id)) {
      for (const p of planned) if (!p.isRetake) Object.assign(p, { isRetake: true, retakeSource: 'registration' });
    }
    const entries = (planned ?? []).map((p) => {
      const found = existing.find((e) => e.studentId === reg.studentId && (p.kind === 'unit' ? e.unitId === p.unitId : e.qualificationId === p.qualificationId));
      return { ...p, state: !found ? 'new' as const : found.registrationId === reg.id || !found.registrationId ? 'exists' as const : 'elsewhere' as const, existingEntryId: found?.id ?? null };
    });
    rows.push({
      registrationId: reg.id,
      studentId: reg.studentId,
      studentName: nameOf.get(reg.studentId) ?? '',
      subject: { id: item.subject.id, name: item.subject.name, code: item.subject.code },
      levelCode: item.levelCode,
      outcome: !planned ? 'not_mapped' : entries.every((e) => e.state !== 'new') ? 'entered' : 'ready',
      note: !planned ? `${item.subject.name} is not mapped on the Catalogue: say what it enters with ${series.boardName} first` : note,
      entries,
    });
  }
  return rows.sort((a, b) => a.studentName.localeCompare(b.studentName) || a.subject.name.localeCompare(b.subject.name));
}

/**
 * Derive the entries of a series (or one student's) from its confirmed
 * registrations: a preview, then a commit that makes each new entry once.
 * Two coordinators committing at once run one after the other (an advisory
 * lock per series), and the unique indexes keep one live entry per unit or
 * award. Refused after the series' entry deadline (MO-10).
 */
export async function deriveEntries(data: DeriveEntriesType, actorId: string, ctx?: AuditContext) {
  const series = await seriesOrThrow(data.boardSeriesId);
  const summarize = (rows: DeriveRow[]) => ({
    registrations: rows.length,
    newEntries: rows.reduce((n, r) => n + r.entries.filter((e) => e.state === 'new').length, 0),
    notMapped: rows.filter((r) => r.outcome === 'not_mapped').length,
  });
  if (!data.commit) {
    const rows = await planDerivation(series, data.studentId, db);
    return {
      series: { id: series.id, name: series.name, entryDeadline: series.entryDeadline },
      pastDeadline: pastEntryDeadline(series), refusal: pastEntryDeadline(series) ? hardStopSentence(series) : null,
      committed: false, created: 0, rows, summary: summarize(rows),
    };
  }
  return db.transaction(async (tx) => {
    // The series FOR SHARE: a deadline change (FOR UPDATE) waits for this, or this for it.
    const locked = await seriesOrThrow(series.id, tx, 'share');
    if (pastEntryDeadline(locked)) throw new ExamError(hardStopSentence(locked), 409);
    await advisoryLock(tx, `exam:derive:${series.id}`);
    const rows = await planDerivation(locked, data.studentId, tx);
    const values = rows.flatMap((r) => r.entries.filter((e) => e.state === 'new').map((e) => ({
      id: randomUUID(), studentId: r.studentId, boardSeriesId: locked.id, boardCode: locked.boardCode, registrationId: r.registrationId,
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
    return {
      series: { id: locked.id, name: locked.name, entryDeadline: locked.entryDeadline },
      pastDeadline: false, refusal: null, committed: true, created: created.length, rows, summary: summarize(rows),
    };
  });
}

/**
 * Add an entry by hand: an award the candidate cashes in with no unit sat
 * this series, a unit a derivation could not choose (a choice group), or an
 * entry for a registration that enters something the catalogue cannot say.
 */
export async function createEntry(data: CreateEntryType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const series = await seriesOrThrow(data.boardSeriesId, tx, 'share');
    if (pastEntryDeadline(series)) throw new ExamError(hardStopSentence(series), 409);
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
    if (data.registrationId) {
      const [r] = await tx.select({ studentId: registration.studentId, boardSeriesId: registration.boardSeriesId }).from(registration).where(eq(registration.id, data.registrationId));
      if (!r || r.studentId !== data.studentId || r.boardSeriesId !== series.id) throw new ExamError('That registration is not this candidate\'s in this series', 400);
    }
    try {
      const [row] = await tx.insert(examEntry).values({
        id: randomUUID(), studentId: data.studentId, boardSeriesId: series.id, boardCode: series.boardCode, registrationId: data.registrationId ?? null,
        kind: data.unitId ? 'unit' : 'award', unitId: data.unitId ?? null, qualificationId: data.qualificationId ?? null,
        entryCode: target.entryCode, title: target.title, optionCode: data.optionCode ?? null, tier: data.tier ?? target.tier,
        notes: data.notes ?? null, createdBy: actorId,
      }).returning();
      await logAction(actorId, 'EXAM_ENTRY_CREATED', 'exam_entry', row!.id, null,
        { studentId: data.studentId, boardSeriesId: series.id, entryCode: target.entryCode, optionCode: data.optionCode ?? null }, ctx, tx);
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ExamError(`The candidate is already entered for ${target.entryCode} in ${series.name}`, 409);
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
 * Record that entries went to the board. Only drafts move; each keeps the
 * board's fee tier on the day it was sent (information only). A time after a
 * series' entry deadline is refused (MO-10): the school sends no late entries.
 */
export async function submitEntries(data: SubmitEntriesType, actorId: string, ctx?: AuditContext) {
  const at = data.submittedAt ?? new Date();
  if (at.getTime() > Date.now() + 5 * 60_000) throw new ExamError('The time the entries went to the board cannot be in the future', 400);
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(examEntry).where(inArray(examEntry.id, data.entryIds)).for('update');
    if (rows.length !== new Set(data.entryIds).size) throw new ExamError('Entry not found', 404);
    const seriesIds = [...new Set(rows.map((r) => r.boardSeriesId))];
    const seriesById = new Map<string, SeriesRow>();
    for (const sid of seriesIds) seriesById.set(sid, await seriesOrThrow(sid, tx, 'share'));
    const late = [...seriesById.values()].filter((s) => pastEntryDeadline(s, at));
    if (late.length) throw new ExamError(hardStopSentence(late[0]!), 409);
    const drafts = rows.filter((r) => r.status === 'draft');
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
  if (out.wasSent) {
    const family = (await familyOf([out.entry.studentId])).get(out.entry.studentId) ?? [];
    await createBulkNotifications(family, 'EXAM_ENTRY_WITHDRAWN', 'Exam entry withdrawn',
      `${out.entry.entryCode} ${out.entry.title} was withdrawn from ${out.series.name}: ${reason}`,
      { entryId: out.entry.id, boardSeriesId: out.entry.boardSeriesId, url: '/exams/my' });
  }
  return { entry: out.entry, charge: out.charge };
}

// ─── Forecast grades ─────────────────────────────────────────────────────────

/** The subject an entry's forecast is about (its registration's), and the academic year of its series. */
async function forecastContext(e: EntryRow, executor: Executor = db) {
  const [row] = await executor.select({ subjectId: registration.subjectId, takenOutsideSchool: registration.takenOutsideSchool, month: boardSeries.month, year: boardSeries.year })
    .from(examEntry)
    .innerJoin(boardSeries, eq(boardSeries.id, examEntry.boardSeriesId))
    .leftJoin(registration, eq(registration.id, examEntry.registrationId))
    .where(eq(examEntry.id, e.id));
  return { subjectId: row?.subjectId ?? null, takenOutsideSchool: row?.takenOutsideSchool ?? false, academicYearStart: seriesAcademicYearStart(row!.month, row!.year) };
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
      const t = fc.subjectId ? await teacherOf(e.studentId, fc.subjectId, fc.academicYearStart) : null;
      if (!t || t.userId !== actor.id) throw new ExamError('Only the candidate\'s teacher for this subject, or the coordinator, gives this forecast', 403);
    }
    if (e.status === 'withdrawn') throw new ExamError('This entry was withdrawn', 409);
    const rules = await boardRulesFor(e.boardCode, tx);
    if (e.forecastLockedAt && rules.forecastLockedOnSubmit) {
      throw new ExamError('This forecast grade has gone to the board, which does not accept a change to it', 409);
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
  const rows = (await db.execute(sql`
    select e.id as "entryId", e.student_id as "studentId", u.name as "studentName", e.entry_code as "entryCode", e.title,
      e.forecast_grade as "forecastGrade", e.forecast_locked_at as "forecastLockedAt", e.status, e.board_code as "boardCode",
      s.id as "boardSeriesId", s.month, s.year, s.label, s.forecast_grades_due::text as "forecastGradesDue",
      sub.id as "subjectId", sub.name as "subjectName", ce.mode, ce.teacher_id as "teacherId", tt.name as "teacherName",
      coalesce(r.taken_outside_school, false) as "takenOutsideSchool"
    from exam_entry e
    join board_series s on s.id = e.board_series_id
    join "user" u on u.id = e.student_id
    left join registration r on r.id = e.registration_id
    left join subject sub on sub.id = r.subject_id
    left join academic_year ay on ay.start_year = school_series_academic_year_start(s.month, s.year)
    left join course_enrolment ce on ce.student_id = e.student_id and ce.subject_id = r.subject_id and ce.academic_year_id = ay.id and ce.ended_on is null
    left join teacher tt on tt.id = ce.teacher_id
    left join exam_board_rule br on br.board_code = e.board_code
    where e.status <> 'withdrawn' and coalesce(br.forecast_required, false)
      ${boardSeriesId ? sql`and e.board_series_id = ${boardSeriesId}` : sql`and (s.exams_end is null or s.exams_end >= current_date)`}
      ${academic ? sql`` : sql`and ce.teacher_id = ${t!.id} and ce.mode = 'in_school'`}
    order by s.year, s.month, sub.name, u.name
  `)).rows as {
    entryId: string; studentId: string; studentName: string; entryCode: string; title: string; forecastGrade: string | null;
    forecastLockedAt: string | null; status: string; boardCode: string; boardSeriesId: string; month: string; year: number; label: string;
    forecastGradesDue: string | null; subjectId: string | null; subjectName: string | null; mode: string | null; teacherId: string | null;
    teacherName: string | null; takenOutsideSchool: boolean;
  }[];
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
  const regIds = entries.map((e) => e.registrationId).filter((x): x is string => !!x);
  const regs = regIds.length
    ? (await db.execute(sql`
        select r.id, r.status, r.subject_id as "subjectId", r.taken_outside_school as "takenOutsideSchool", sub.name as "subjectName",
          s.month, s.year, ce.mode, tt.name as "teacherName", tt.user_id as "teacherUserId"
        from registration r join subject sub on sub.id = r.subject_id
        left join board_series s on s.id = r.board_series_id
        left join academic_year ay on ay.start_year = school_series_academic_year_start(s.month, s.year)
        left join course_enrolment ce on ce.student_id = r.student_id and ce.subject_id = r.subject_id and ce.academic_year_id = ay.id and ce.ended_on is null
        left join teacher tt on tt.id = ce.teacher_id
        where r.id in (${sql.join(regIds.map((id) => sql`${id}`), sql`, `)})`)).rows as {
          id: string; status: string; subjectId: string; takenOutsideSchool: boolean; subjectName: string; mode: string | null; teacherName: string | null; teacherUserId: string | null;
        }[]
    : [];
  const regById = new Map(regs.map((r) => [r.id, r]));
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
    const reg = e.registrationId ? regById.get(e.registrationId) : undefined;
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
    if (reg && reg.status !== 'confirmed') out.push('registration_not_confirmed');
    const aa = (e.accessArrangements ?? c?.accessArrangements ?? []) as string[];
    if (aa.length && (!c?.accessArrangementsRef || (c.accessArrangementsUntil && c.accessArrangementsUntil < today))) out.push('access_arrangements_unapproved');
    return out;
  };
  return { series, rules, candidates, numbers, regById, centres, problemsOf };
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
    const reg = e.registrationId ? a.regById.get(e.registrationId) : undefined;
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
    return {
      entryId: e.id, studentId: e.studentId, studentName, status: e.status, kind: e.kind, title: e.title,
      values: Object.fromEntries(columns.map((col) => [col.key, values[col.key] ?? ''])),
      problems: a.problemsOf(e),
    };
  }).sort((x, y) => (x.values.candidateNumber || 'z').localeCompare(y.values.candidateNumber || 'z') || x.studentName.localeCompare(y.studentName) || x.values.entryCode!.localeCompare(y.values.entryCode!));
  // Confirmed registrations of the series with no live entry: derive them, or map the subject first.
  const unentered = (await db.execute(sql`
    select r.id as "registrationId", r.student_id as "studentId", u.name as "studentName", sub.name as "subjectName", sub.code as "subjectCode",
      (sub.qualification_id is not null or exists (select 1 from subject_unit su where su.subject_id = sub.id)) as mapped
    from registration r join "user" u on u.id = r.student_id join subject sub on sub.id = r.subject_id
    where r.board_series_id = ${series.id} and r.status = 'confirmed'
      and not exists (select 1 from exam_entry e where e.registration_id = r.id and e.status <> 'withdrawn')
    order by u.name, sub.name`)).rows as { registrationId: string; studentId: string; studentName: string; subjectName: string; subjectCode: string; mapped: boolean }[];
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
    unentered,
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
