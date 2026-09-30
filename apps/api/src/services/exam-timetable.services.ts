/**
 * The exam timetable (FEATURES_PLAN.md F4, "Exam timetables and exam days"):
 * each board series' papers — pasted from the board's timetable with a
 * column mapping, or entered — each candidate's own timetable from their
 * entries, clashes (two papers at once, extra time counted), publication to
 * families, and the statement of entry.
 *
 * Contract for F2 and F3: `getExamsFor(studentId, date)` — the papers a
 * student sits on a school date, with start and end (their extra time
 * included), room and seat (docs/features/EXAM_ENTRIES.md, "Contracts").
 */

import {
  db, examPaper, examEntry, examClashNote, examSeriesState, examSeat, examUnit, qualification, qualificationOption, qualificationOptionUnit,
  qualificationUnit, room, user, boardSeries,
  eq, and, inArray, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  EXAM_SESSION_LABELS, extraTimeShare, seriesLabel, TIMETABLE_FIELDS, schoolDateString,
  type CreatePaperType, type ExamSession, type ImportPapersType, type NoteClashType, type TimetableField, type UpdatePaperType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { createBulkNotifications } from './notification.services';
import { candidatesOf, numbersIn } from './exam-candidate.services';
import { liveEntriesOf } from './exam-entry.services';
import {
  ExamError, boardNameMap, centreFor, familyOf, isUniqueViolation, seriesOrThrow, studentOrThrow,
  type Executor,
} from './exam-shared';
import { boardSeriesName } from './series.services';
import { parseDelimited, tableFrom, excelSerialDate } from '../lib/tabular';

type PaperRow = typeof examPaper.$inferSelect;
type EntryRow = typeof examEntry.$inferSelect;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ─── Which papers an entry sits ──────────────────────────────────────────────

/**
 * For a set of entries: the papers each sits. A unit entry sits its unit's
 * papers; an award entry sits the components its option code enters (else
 * the award's required components of its tier), or the award's own papers
 * when the board lists the syllabus only; a Pearson cash-in sits nothing.
 */
async function paperContext(entries: EntryRow[], executor: Executor = db) {
  const seriesIds = [...new Set(entries.map((e) => e.boardSeriesId))];
  const qualIds = [...new Set(entries.map((e) => e.qualificationId).filter((x): x is string => !!x))];
  const [papers, quals, opts, qunits] = await Promise.all([
    seriesIds.length ? executor.select().from(examPaper).where(inArray(examPaper.boardSeriesId, seriesIds)).orderBy(asc(examPaper.examDate), asc(examPaper.startTime)) : [],
    qualIds.length ? executor.select({ id: qualification.id, entryMethod: qualification.entryMethod }).from(qualification).where(inArray(qualification.id, qualIds)) : [],
    qualIds.length
      ? executor.select({ qualificationId: qualificationOption.qualificationId, code: qualificationOption.code, unitId: qualificationOptionUnit.unitId })
          .from(qualificationOption).innerJoin(qualificationOptionUnit, eq(qualificationOptionUnit.optionId, qualificationOption.id))
          .where(inArray(qualificationOption.qualificationId, qualIds))
      : [],
    qualIds.length
      ? executor.select({ qualificationId: qualificationUnit.qualificationId, unitId: qualificationUnit.unitId, requirement: qualificationUnit.requirement, tier: examUnit.tier })
          .from(qualificationUnit).innerJoin(examUnit, eq(examUnit.id, qualificationUnit.unitId)).where(inArray(qualificationUnit.qualificationId, qualIds))
      : [],
  ]);
  const method = new Map(quals.map((q) => [q.id, q.entryMethod]));
  const papersOf = (e: EntryRow): PaperRow[] => {
    const inSeries = papers.filter((p) => p.boardSeriesId === e.boardSeriesId);
    if (e.kind === 'unit') return inSeries.filter((p) => p.unitId === e.unitId);
    if (method.get(e.qualificationId!) === 'units_cash_in') return [];
    let units = e.optionCode ? opts.filter((o) => o.qualificationId === e.qualificationId && o.code === e.optionCode).map((o) => o.unitId) : [];
    if (!units.length) {
      units = qunits.filter((u) => u.qualificationId === e.qualificationId && u.requirement === 'required' && (!e.tier || !u.tier || u.tier === e.tier)).map((u) => u.unitId);
    }
    return inSeries.filter((p) => (p.unitId && units.includes(p.unitId)) || (!p.unitId && p.qualificationId === e.qualificationId && (!p.tier || !e.tier || p.tier === e.tier)));
  };
  return { papers, papersOf };
}

type Sitting = {
  paperId: string; code: string; title: string; boardSeriesId: string; entryId: string; entryCode: string;
  examDate: string; session: ExamSession; startTime: string; endTime: string; durationMinutes: number; extraMinutes: number;
};

/** A student's papers from their entries, each with its end time counting the candidate's extra time. */
async function sittingsOf(studentId: string, entries: EntryRow[], executor: Executor = db): Promise<Sitting[]> {
  if (!entries.length) return [];
  const [{ papersOf }, cands] = await Promise.all([paperContext(entries, executor), candidatesOf([studentId], executor)]);
  const cand = cands.get(studentId);
  const out: Sitting[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const share = extraTimeShare(e.accessArrangements ?? cand?.accessArrangements ?? []);
    for (const p of papersOf(e)) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const extra = Math.round(p.durationMinutes * share);
      out.push({
        paperId: p.id, code: p.code, title: p.title, boardSeriesId: p.boardSeriesId, entryId: e.id, entryCode: e.entryCode,
        examDate: p.examDate, session: p.session as ExamSession, startTime: p.startTime,
        endTime: hhmm(minutes(p.startTime) + p.durationMinutes + extra), durationMinutes: p.durationMinutes, extraMinutes: extra,
      });
    }
  }
  return out.sort((a, b) => a.examDate.localeCompare(b.examDate) || a.startTime.localeCompare(b.startTime) || a.code.localeCompare(b.code));
}

/** Pairs of a candidate's papers that overlap (same day, times crossing). */
function clashesIn(sittings: Sitting[]) {
  const out: [Sitting, Sitting][] = [];
  for (let i = 0; i < sittings.length; i++) {
    for (let j = i + 1; j < sittings.length; j++) {
      const a = sittings[i]!, b = sittings[j]!;
      if (a.examDate !== b.examDate) continue;
      if (minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime)) out.push([a, b]);
    }
  }
  return out;
}

// ─── Papers ──────────────────────────────────────────────────────────────────

/** A series' papers, with how many live entries sit each. */
export async function listPapers(boardSeriesId: string) {
  const series = await seriesOrThrow(boardSeriesId);
  const papers = await db.select({ p: examPaper, unitCode: examUnit.code, unitShortCode: examUnit.shortCode, qualCode: qualification.code })
    .from(examPaper).leftJoin(examUnit, eq(examUnit.id, examPaper.unitId)).leftJoin(qualification, eq(qualification.id, examPaper.qualificationId))
    .where(eq(examPaper.boardSeriesId, series.id)).orderBy(asc(examPaper.examDate), asc(examPaper.startTime), asc(examPaper.code));
  const entries = await db.select().from(examEntry).where(and(eq(examEntry.boardSeriesId, series.id), sql`${examEntry.status} <> 'withdrawn'`));
  const { papersOf } = await paperContext(entries);
  const count = new Map<string, number>();
  for (const e of entries) for (const p of papersOf(e)) count.set(p.id, (count.get(p.id) ?? 0) + 1);
  const [state] = await db.select().from(examSeriesState).where(eq(examSeriesState.boardSeriesId, series.id));
  return {
    series: { id: series.id, name: series.name, boardCode: series.boardCode, boardName: series.boardName, examsStart: series.examsStart, examsEnd: series.examsEnd },
    published: state?.timetablePublishedAt ? { at: state.timetablePublishedAt, version: state.timetableVersion } : null,
    papers: papers.map(({ p, unitCode, unitShortCode, qualCode }) => ({
      ...p, unitCode, unitShortCode, qualificationCode: qualCode, candidates: count.get(p.id) ?? 0,
      endTime: hhmm(minutes(p.startTime) + p.durationMinutes),
    })),
    unlinked: papers.filter(({ p }) => !p.unitId && !p.qualificationId).length,
  };
}

/** Link a paper code to the catalogue: a unit of the board by its code (0610/42, WMA11), else an award by the code before the slash. */
async function matchCatalogue(boardCode: string, code: string, executor: Executor = db) {
  const clean = code.trim().toUpperCase();
  const bare = clean.replace(/\/0?1$/, ''); // Pearson prints WMA11/01 for the one paper of unit WMA11
  const [u] = await executor.select({ id: examUnit.id, tier: examUnit.tier, title: examUnit.title }).from(examUnit)
    .where(and(eq(examUnit.boardCode, boardCode), sql`upper(${examUnit.code}) in (${clean}, ${bare})`));
  if (u) return { unitId: u.id, qualificationId: null as string | null, tier: u.tier, title: u.title };
  const syllabus = clean.split('/')[0]!;
  const [q] = await executor.select({ id: qualification.id, tier: qualification.tier, title: qualification.title }).from(qualification)
    .where(and(eq(qualification.boardCode, boardCode), sql`upper(${qualification.code}) = ${syllabus}`)).limit(1);
  if (q) return { unitId: null as string | null, qualificationId: q.id, tier: q.tier, title: q.title };
  return null;
}

async function notifyTimetableChanged(paperIds: string[], boardSeriesId: string, what: string) {
  const [state] = await db.select().from(examSeriesState).where(eq(examSeriesState.boardSeriesId, boardSeriesId));
  if (!state?.timetablePublishedAt) return 0;
  const entries = await db.select().from(examEntry).where(and(eq(examEntry.boardSeriesId, boardSeriesId), inArray(examEntry.status, ['submitted', 'amended'])));
  const { papersOf } = await paperContext(entries);
  const students = [...new Set(entries.filter((e) => papersOf(e).some((p) => paperIds.includes(p.id))).map((e) => e.studentId))];
  const families = await familyOf(students);
  const recipients = [...new Set([...families.values()].flat())];
  await createBulkNotifications(recipients, 'EXAM_TIMETABLE_CHANGED', 'Exam timetable changed', what, { boardSeriesId, url: '/exams/my' });
  return students.length;
}

export async function createPaper(data: CreatePaperType, actorId: string, ctx?: AuditContext) {
  const series = await seriesOrThrow(data.boardSeriesId);
  const match = data.unitId || data.qualificationId ? null : await matchCatalogue(series.boardCode, data.code);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(examPaper).values({
        id: randomUUID(), boardSeriesId: series.id, boardCode: series.boardCode, code: data.code.trim().toUpperCase(), title: data.title,
        unitId: data.unitId ?? match?.unitId ?? null, qualificationId: data.qualificationId ?? match?.qualificationId ?? null,
        tier: data.tier ?? match?.tier ?? null, examDate: data.examDate, session: data.session, startTime: data.startTime,
        durationMinutes: data.durationMinutes, notes: data.notes ?? null, createdBy: actorId,
      }).returning();
      await logAction(actorId, 'EXAM_PAPER_CREATED', 'exam_paper', row!.id, null, { ...data }, ctx, tx);
      return row!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ExamError(`${series.name} already has paper ${data.code}`, 409);
    throw err;
  }
}

/** Change a paper; families whose published timetable it is in are told. */
export async function updatePaper(id: string, data: UpdatePaperType, actorId: string, ctx?: AuditContext) {
  const out = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(examPaper).where(eq(examPaper.id, id)).for('update');
    if (!before) throw new ExamError('Paper not found', 404);
    const { reason, ...fields } = data;
    const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<PaperRow>;
    if (set.code) set.code = set.code.trim().toUpperCase();
    try {
      const [row] = await tx.update(examPaper).set({ ...set, updatedAt: new Date() }).where(eq(examPaper.id, id)).returning();
      const changed = Object.keys(set).filter((k) => JSON.stringify((before as Record<string, unknown>)[k] ?? null) !== JSON.stringify((set as Record<string, unknown>)[k] ?? null));
      if (changed.length) {
        await logAction(actorId, 'EXAM_PAPER_UPDATED', 'exam_paper', id,
          Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k] ?? null])),
          { ...Object.fromEntries(changed.map((k) => [k, (set as Record<string, unknown>)[k] ?? null])), ...(reason ? { reason } : {}) }, ctx, tx);
      }
      return { before, row: row!, timeChanged: changed.some((k) => ['examDate', 'session', 'startTime', 'durationMinutes'].includes(k)) };
    } catch (err) {
      if (isUniqueViolation(err)) throw new ExamError(`This series already has paper ${set.code}`, 409);
      throw err;
    }
  });
  let candidatesTold = 0;
  if (out.timeChanged) {
    const r = out.row;
    candidatesTold = await notifyTimetableChanged([r.id], r.boardSeriesId,
      `${r.code} ${r.title} is now on ${r.examDate}, ${EXAM_SESSION_LABELS[r.session as ExamSession].toLowerCase()}, from ${r.startTime} (${r.durationMinutes} minutes).`);
  }
  // The candidates whose families (the candidate and linked parents) were told.
  return { paper: out.row, candidatesTold };
}

export async function deletePaper(id: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(examPaper).where(eq(examPaper.id, id)).for('update');
    if (!p) throw new ExamError('Paper not found', 404);
    const [marked] = await tx.execute(sql`select 1 from exam_attendance where paper_id = ${id} limit 1`).then((r) => r.rows);
    if (marked) throw new ExamError(`${p.code} has attendance recorded: it stays on the timetable`, 409);
    await tx.delete(examPaper).where(eq(examPaper.id, id));
    await logAction(actorId, 'EXAM_PAPER_DELETED', 'exam_paper', id, { code: p.code, examDate: p.examDate, session: p.session }, null, ctx, tx);
    return { deleted: true };
  });
}

// ─── Importing a board's timetable ───────────────────────────────────────────

const HEADER_GUESSES: Record<TimetableField, RegExp> = {
  code: /(paper|component|unit|syllabus|code|entry)/i,
  title: /(title|subject|description|name)/i,
  date: /date|day/i,
  session: /session|am\s*\/\s*pm|time of day/i,
  startTime: /start|time/i,
  duration: /duration|length|hours|mins|minutes/i,
};

/** Which column is which: the staff's choice, else a guess from the headers (each column used once). */
function mappingFor(header: string[], chosen: Partial<Record<TimetableField, string>> | undefined) {
  const used = new Set(Object.values(chosen ?? {}));
  const out: Partial<Record<TimetableField, string>> = { ...(chosen ?? {}) };
  // Specific fields first, so "Start time" is not taken as the session or "Paper code" as the title.
  for (const f of ['duration', 'date', 'session', 'startTime', 'code', 'title'] as TimetableField[]) {
    // Chosen, or chosen as "not in the paste" (an empty heading): never guessed over.
    if (out[f] !== undefined) continue;
    const h = header.find((x) => !used.has(x) && HEADER_GUESSES[f].test(x));
    if (h) { out[f] = h; used.add(h); }
  }
  return out;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** 2026-10-12, 12/10/2026, 12-10-2026, 12 October 2026, Monday 12 Oct 2026, or an Excel date number. */
export function parseExamDate(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})/.exec(s);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m![2]!.toLowerCase().slice(0, 3)));
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialDate(Number(s));
  return null;
}

/** 09:00, 9.00, 9:00 am, 1:30 pm, or an Excel time fraction. */
export function parseClock(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (/^0?\.\d+$/.test(s)) return hhmm(Math.round(Number(s) * 24 * 60));
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]?.startsWith('p') && h < 12) h += 12;
  if (m[3]?.startsWith('a') && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return hhmm(h * 60 + min);
}

/** 90, 1:30, 1h 30m, 1 hour 30 minutes, 2 hours, 45m. */
export function parseDuration(v: string): number | null {
  const s = v.trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/.exec(s);
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0);
  return null;
}

function parseSession(v: string | undefined, start: string | null): ExamSession | null {
  const s = (v ?? '').trim().toLowerCase();
  if (/^(am|morning|a\.m\.)/.test(s)) return 'am';
  if (/^(pm|afternoon|p\.m\.)/.test(s)) return 'pm';
  if (/^(ev|evening)/.test(s)) return 'ev';
  if (start) return minutes(start) < 12 * 60 ? 'am' : minutes(start) < 17 * 60 ? 'pm' : 'ev';
  return null;
}

/**
 * A board's timetable pasted as a table: preview each line (new, changed,
 * unchanged, or what is wrong with it, and which catalogue unit or award it
 * belongs to), then commit — lines keyed by paper code, so a second paste of
 * the same timetable changes nothing and a corrected one updates only what
 * moved (and tells the families of a published timetable).
 */
export async function importPapers(data: ImportPapersType, actorId: string, ctx?: AuditContext) {
  const series = await seriesOrThrow(data.boardSeriesId);
  const { header, records } = tableFrom(parseDelimited(data.text));
  if (!header.length) throw new ExamError('The first line should hold the column headings', 400);
  const mapping = mappingFor(header, data.mapping);
  const missing = TIMETABLE_FIELDS.filter((f) => f !== 'title' && f !== 'session' && !mapping[f]);
  const existing = await db.select().from(examPaper).where(eq(examPaper.boardSeriesId, series.id));
  type ImportLine = {
    line: number; code: string; title: string; examDate: string | null; session: ExamSession | null; startTime: string | null;
    durationMinutes: number | null; unitId: string | null; qualificationId: string | null; tier: string | null; linked: boolean;
    outcome: 'error' | 'new' | 'unchanged' | 'changed'; paperId: string | null; problems: string[];
  };
  const lines: ImportLine[] = [];
  for (const r of records) {
    const get = (f: TimetableField) => (mapping[f] ? r.values[mapping[f]!] ?? '' : '');
    const code = get('code').toUpperCase().replace(/\s+/g, '');
    const date = parseExamDate(get('date'));
    const start = parseClock(get('startTime'));
    const duration = parseDuration(get('duration'));
    const session = parseSession(get('session'), start);
    const problems: string[] = [];
    if (!code) problems.push('no paper code');
    if (!date) problems.push(`"${get('date')}" is not a date`);
    if (!start) problems.push(`"${get('startTime')}" is not a time`);
    if (!duration || duration < 5 || duration > 480) problems.push(`"${get('duration')}" is not a duration`);
    if (!session) problems.push('no session');
    if (date && (series.examsStart && date < series.examsStart || series.examsEnd && date > series.examsEnd)) {
      problems.push(`outside the series' exam dates`);
    }
    const match = code ? await matchCatalogue(series.boardCode, code) : null;
    const before = existing.find((p) => p.code === code);
    const title = get('title') || match?.title || code;
    const same = before && before.examDate === date && before.session === session && before.startTime === start && before.durationMinutes === duration && before.title === title;
    lines.push({
      line: r.line, code, title, examDate: date, session, startTime: start, durationMinutes: duration,
      unitId: match?.unitId ?? null, qualificationId: match?.qualificationId ?? null, tier: match?.tier ?? null, linked: !!match,
      outcome: problems.length ? 'error' as const : !before ? 'new' as const : same ? 'unchanged' as const : 'changed' as const,
      paperId: before?.id ?? null, problems,
    });
  }
  const dupes = lines.filter((l, i) => l.code && lines.findIndex((x) => x.code === l.code) !== i);
  for (const d of dupes) { d.outcome = 'error'; d.problems.push('the same paper code appears twice'); }
  const summary = {
    new: lines.filter((l) => l.outcome === 'new').length, changed: lines.filter((l) => l.outcome === 'changed').length,
    unchanged: lines.filter((l) => l.outcome === 'unchanged').length, errors: lines.filter((l) => l.outcome === 'error').length,
    unlinked: lines.filter((l) => l.outcome !== 'error' && !l.linked).length,
  };
  const result = { header, mapping, missingColumns: missing, lines, summary, committed: false };
  if (!data.commit) return result;
  if (missing.length) throw new ExamError(`Say which column holds: ${missing.join(', ')}`, 400);
  if (summary.errors) throw new ExamError(`${summary.errors} line(s) cannot be read — fix or remove them first`, 400);
  const changedIds = await db.transaction(async (tx) => {
    const ids: string[] = [];
    for (const l of lines) {
      if (l.outcome === 'new') {
        await tx.insert(examPaper).values({
          id: randomUUID(), boardSeriesId: series.id, boardCode: series.boardCode, code: l.code, title: l.title, unitId: l.unitId,
          qualificationId: l.qualificationId, tier: l.tier, examDate: l.examDate!, session: l.session!, startTime: l.startTime!,
          durationMinutes: l.durationMinutes!, createdBy: actorId,
        });
      } else if (l.outcome === 'changed') {
        await tx.update(examPaper).set({
          title: l.title, examDate: l.examDate!, session: l.session!, startTime: l.startTime!, durationMinutes: l.durationMinutes!, updatedAt: new Date(),
        }).where(eq(examPaper.id, l.paperId!));
        ids.push(l.paperId!);
      }
    }
    if (summary.new || summary.changed) {
      await logAction(actorId, 'EXAM_PAPERS_IMPORTED', 'board_series', series.id, null, { ...summary, mapping }, ctx, tx);
    }
    return ids;
  });
  if (changedIds.length) await notifyTimetableChanged(changedIds, series.id, `Some of your papers in ${series.name} moved — see your exam timetable.`);
  return { ...result, committed: true };
}

// ─── Candidates' timetables, clashes, publication ────────────────────────────

/** Seats of one student in the sittings on the given dates. */
async function seatsOf(studentId: string, dates: string[]) {
  if (!dates.length) return [];
  return db.select({ examDate: examSeat.examDate, session: examSeat.session, seatLabel: examSeat.seatLabel, roomName: room.name, roomId: room.id })
    .from(examSeat).innerJoin(room, eq(room.id, examSeat.roomId))
    .where(and(eq(examSeat.studentId, studentId), inArray(examSeat.examDate, [...new Set(dates)])));
}

/**
 * One candidate's exam timetable (a series, or every series): each paper with
 * its date, session, start and end (extra time counted), room and seat, and
 * the clashes among them with how each is handled. A family sees only
 * entries that have gone to the board, and only once the timetable is
 * published.
 */
export async function candidateTimetable(studentId: string, boardSeriesId: string | undefined, familyView: boolean) {
  await studentOrThrow(studentId);
  let entries = await liveEntriesOf(studentId, boardSeriesId, familyView);
  if (familyView) {
    const published = new Set((await db.select({ id: examSeriesState.boardSeriesId }).from(examSeriesState)
      .where(sql`${examSeriesState.timetablePublishedAt} is not null`)).map((r) => r.id));
    entries = entries.filter((e) => published.has(e.boardSeriesId));
  }
  const sittings = await sittingsOf(studentId, entries);
  const seats = await seatsOf(studentId, sittings.map((s) => s.examDate));
  const names = await boardNameMap();
  const seriesRows = entries.length ? await db.select().from(boardSeries).where(inArray(boardSeries.id, [...new Set(entries.map((e) => e.boardSeriesId))])) : [];
  const seriesName = new Map(seriesRows.map((s) => [s.id, boardSeriesName(names, s)]));
  const notes = await db.select().from(examClashNote).where(eq(examClashNote.studentId, studentId));
  return {
    papers: sittings.map((s) => {
      const seat = seats.find((x) => x.examDate === s.examDate && x.session === s.session);
      return { ...s, seriesName: seriesName.get(s.boardSeriesId) ?? '', room: seat?.roomName ?? null, seat: seat?.seatLabel ?? null };
    }),
    clashes: clashesIn(sittings).map(([a, b]) => {
      const [x, y] = a.paperId < b.paperId ? [a, b] : [b, a];
      return { papers: [x, y], note: notes.find((n) => n.paperAId === x.paperId && n.paperBId === y.paperId)?.resolution ?? null };
    }),
  };
}

/**
 * Every clash in a series: candidates with two papers at once (either in
 * this series, or one here and one in another series the same day), with
 * extra time counted and how each is handled if noted.
 */
export async function listClashes(boardSeriesId: string) {
  const series = await seriesOrThrow(boardSeriesId);
  const entries = await db.select().from(examEntry).where(and(sql`${examEntry.status} <> 'withdrawn'`,
    inArray(examEntry.studentId, db.select({ id: examEntry.studentId }).from(examEntry).where(and(eq(examEntry.boardSeriesId, series.id), sql`${examEntry.status} <> 'withdrawn'`)))));
  const byStudent = new Map<string, EntryRow[]>();
  for (const e of entries) byStudent.set(e.studentId, [...(byStudent.get(e.studentId) ?? []), e]);
  const names = new Map((byStudent.size ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...byStudent.keys()])) : []).map((u) => [u.id, u.name]));
  const notes = byStudent.size ? await db.select().from(examClashNote).where(inArray(examClashNote.studentId, [...byStudent.keys()])) : [];
  const numbers = await numbersIn(series.id, [...byStudent.keys()]);
  const out = [];
  for (const [studentId, es] of byStudent) {
    const sittings = await sittingsOf(studentId, es);
    for (const [a, b] of clashesIn(sittings)) {
      if (a.boardSeriesId !== series.id && b.boardSeriesId !== series.id) continue;
      const [x, y] = a.paperId < b.paperId ? [a, b] : [b, a];
      out.push({
        studentId, studentName: names.get(studentId) ?? '', candidateNumber: numbers.get(studentId) ?? null,
        papers: [x, y], note: notes.find((n) => n.studentId === studentId && n.paperAId === x.paperId && n.paperBId === y.paperId)?.resolution ?? null,
      });
    }
  }
  return out.sort((a, b) => a.papers[0]!.examDate.localeCompare(b.papers[0]!.examDate) || a.studentName.localeCompare(b.studentName));
}

/** Note how a clash is handled (sat one after the other under supervision, moved by the board…). */
export async function noteClash(data: NoteClashType, actorId: string, ctx?: AuditContext) {
  const [a, b] = [...data.paperIds].sort() as [string, string];
  if (a === b) throw new ExamError('A clash is between two papers', 400);
  const entries = await liveEntriesOf(data.studentId);
  const sittings = await sittingsOf(data.studentId, entries);
  const clash = clashesIn(sittings).some(([x, y]) => [x.paperId, y.paperId].sort().join() === [a, b].join());
  if (!clash) throw new ExamError('These papers do not clash for this candidate', 400);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(examClashNote).values({ id: randomUUID(), studentId: data.studentId, paperAId: a, paperBId: b, resolution: data.resolution, notedBy: actorId })
      .onConflictDoUpdate({ target: [examClashNote.studentId, examClashNote.paperAId, examClashNote.paperBId], set: { resolution: data.resolution, notedBy: actorId, notedAt: new Date() } })
      .returning();
    await logAction(actorId, 'EXAM_CLASH_NOTED', 'exam_candidate', data.studentId, null, { paperIds: [a, b], resolution: data.resolution }, ctx, tx);
    return row!;
  });
}

/**
 * Publish a series' timetable to families: every candidate with an entry
 * gone to the board (and their parents) is told their statement of entry and
 * timetable are ready — the first time "ready", after that "changed".
 */
export async function publishTimetable(boardSeriesId: string, actorId: string, ctx?: AuditContext) {
  const series = await seriesOrThrow(boardSeriesId);
  const [papers] = await db.select({ n: sql<number>`count(*)::int` }).from(examPaper).where(eq(examPaper.boardSeriesId, series.id));
  if (!papers?.n) throw new ExamError(`${series.name} has no papers yet: import or enter its timetable first`, 409);
  const { version, first } = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(examSeriesState).where(eq(examSeriesState.boardSeriesId, series.id)).for('update');
    const v = (before?.timetableVersion ?? 0) + 1;
    await tx.insert(examSeriesState).values({ boardSeriesId: series.id, timetablePublishedAt: new Date(), timetablePublishedBy: actorId, timetableVersion: v })
      .onConflictDoUpdate({ target: examSeriesState.boardSeriesId, set: { timetablePublishedAt: new Date(), timetablePublishedBy: actorId, timetableVersion: v } });
    await logAction(actorId, 'EXAM_TIMETABLE_PUBLISHED', 'board_series', series.id, before ? { version: before.timetableVersion } : null, { version: v }, ctx, tx);
    return { version: v, first: !before?.timetablePublishedAt };
  });
  const students = (await db.selectDistinct({ id: examEntry.studentId }).from(examEntry)
    .where(and(eq(examEntry.boardSeriesId, series.id), inArray(examEntry.status, ['submitted', 'amended'])))).map((r) => r.id);
  const families = await familyOf(students);
  const recipients = [...new Set([...families.values()].flat())];
  await createBulkNotifications(recipients, first ? 'EXAM_TIMETABLE_PUBLISHED' : 'EXAM_TIMETABLE_CHANGED',
    first ? `Your ${series.name} exam timetable` : `Your ${series.name} exam timetable changed`,
    first
      ? `Your statement of entry and exam timetable for ${series.name} are ready. Check your name, entries and papers, and tell the school at once if anything is wrong.`
      : `The exam timetable for ${series.name} was updated. Check your papers again.`,
    { boardSeriesId: series.id, url: '/exams/my' });
  return { version, candidatesTold: students.length, notices: recipients.length };
}

// ─── The contract for F2 and F3, and the statement of entry ──────────────────

/**
 * F2 and F3's contract: the papers a student sits on a school date (YYYY-MM-DD,
 * Cairo), across every board and series — paper, series, session, start and
 * end with the candidate's extra time, room and seat. Entries withdrawn are
 * left out; F3 excuses the lessons these overlap, F2 warns a leave request.
 */
export async function getExamsFor(studentId: string, date: string, familyView = false) {
  const entries = await liveEntriesOf(studentId, undefined, familyView);
  const sittings = (await sittingsOf(studentId, entries)).filter((s) => s.examDate === date);
  const seats = await seatsOf(studentId, [date]);
  const names = await boardNameMap();
  const seriesRows = sittings.length ? await db.select().from(boardSeries).where(inArray(boardSeries.id, [...new Set(sittings.map((s) => s.boardSeriesId))])) : [];
  return sittings.map((s) => {
    const seat = seats.find((x) => x.session === s.session);
    const sr = seriesRows.find((x) => x.id === s.boardSeriesId);
    return {
      paperId: s.paperId, code: s.code, title: s.title, entryId: s.entryId, boardSeriesId: s.boardSeriesId,
      seriesName: sr ? boardSeriesName(names, sr) : '', date: s.examDate, session: s.session, startTime: s.startTime, endTime: s.endTime,
      durationMinutes: s.durationMinutes, extraMinutes: s.extraMinutes, room: seat?.roomName ?? null, seat: seat?.seatLabel ?? null,
    };
  });
}

/**
 * A statement of entry for one series, as the school prints it for the
 * candidate to check: the centre, the candidate's name as on their ID,
 * number and UCI, each entry with its option and tier, the papers with
 * dates, times, room and seat, and the access arrangements. A family sees it
 * once entries have gone to the board and the timetable is published.
 */
export async function getStatement(studentId: string, boardSeriesId: string, familyView: boolean) {
  const student = await studentOrThrow(studentId);
  const series = await seriesOrThrow(boardSeriesId);
  const [state] = await db.select().from(examSeriesState).where(eq(examSeriesState.boardSeriesId, series.id));
  if (familyView && !state?.timetablePublishedAt) throw new ExamError(`The statement of entry for ${series.name} is not ready yet`, 404);
  const entries = await liveEntriesOf(studentId, series.id, familyView);
  const [cands, numbers, centre, timetable] = await Promise.all([
    candidatesOf([studentId]), numbersIn(series.id, [studentId]), centreFor(series.boardCode), candidateTimetable(studentId, series.id, false),
  ]);
  const cand = cands.get(studentId);
  return {
    generatedOn: schoolDateString(new Date()),
    series: { id: series.id, name: series.name, boardName: series.boardName, label: seriesLabel(series.month, series.year), resultsOn: series.resultsOn },
    centre,
    candidate: {
      studentId, name: student.name, legalForenames: cand?.legalForenames ?? null, legalSurname: cand?.legalSurname ?? null,
      dateOfBirth: cand?.dateOfBirth ?? null, uci: cand?.uci ?? null, candidateNumber: numbers.get(studentId) ?? null,
      accessArrangements: cand?.accessArrangements ?? [],
    },
    entries: entries.map((e) => ({ id: e.id, kind: e.kind, entryCode: e.entryCode, title: e.title, optionCode: e.optionCode, tier: e.tier, status: e.status, isRetake: e.isRetake })),
    papers: timetable.papers.filter((p) => entries.some((e) => e.id === p.entryId)),
    clashes: timetable.clashes,
    published: state?.timetablePublishedAt ?? null,
  };
}

/** The series a student has entries in (the family's series picker). */
export async function seriesOfStudent(studentId: string, familyView: boolean) {
  const rows = await db.execute(sql`
    select s.id, s.board_code as "boardCode", s.month, s.year, s.label, s.exams_start::text as "examsStart", s.results_on::text as "resultsOn",
      st.timetable_published_at as "timetablePublishedAt", count(e.id)::int as entries
    from exam_entry e join board_series s on s.id = e.board_series_id left join exam_series_state st on st.board_series_id = s.id
    where e.student_id = ${studentId} and ${familyView ? sql`e.status in ('submitted', 'amended')` : sql`e.status <> 'withdrawn'`}
    group by s.id, st.timetable_published_at
    order by s.year desc, s.month`);
  const names = await boardNameMap();
  return (rows.rows as { id: string; boardCode: string; month: string; year: number; label: string; examsStart: string | null; resultsOn: string | null; timetablePublishedAt: string | null; entries: number }[])
    .filter((r) => !familyView || r.timetablePublishedAt)
    .map((r) => ({ ...r, name: boardSeriesName(names, r) }));
}

export { sittingsOf, paperContext, clashesIn };
