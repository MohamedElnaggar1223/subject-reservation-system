/**
 * Results (FEATURES_PLAN.md F4, "Results"; DISCOVERY_RESEARCH.md §5 note 6;
 * DISCOVERY.md F-07).
 *
 * A board's results file — Cambridge's broadsheet (one row per candidate, a
 * column per syllabus), Pearson's results file (one row per unit or award) —
 * is read through a column mapping the staff choose once and save, because
 * neither format is in hand. Each line is matched to a candidate (candidate
 * number in the series, or UCI) and to the catalogue and the candidate's
 * entry by code; the preview says what each line will do; the commit adds a
 * row per result reported. Every attempt is kept (a series each), and a
 * board's later report of the same attempt with another grade is a new row
 * beside the first: nothing is overwritten, and which grade is of record
 * after a remark stays the owner's question (FOUNDATION_AUDIT.md RF-09).
 *
 * Publication shows results to families, and records the board's grade on a
 * registration that has none yet, so the existing results screen and the
 * remark flow read it; a registration that already has a grade keeps it and
 * the answer says so.
 *
 * Contract for F5: `getSittings(studentId)` — every sitting with its series,
 * board, subject, level, tier and every grade reported, and any remark
 * outcomes, deciding nothing (docs/features/EXAM_ENTRIES.md, "Contracts").
 */

import {
  db, examResult, examResultImport, examResultMapping, examEntry, examCandidate, examCandidateNumber, examSeriesState, examUnit,
  qualification, qualificationUnit, registration, registrationSession, remarkRequest, boardSeries, user,
  eq, and, inArray, sql, asc, desc, isNull,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  seriesLabel, seriesAcademicYearStart, academicYearShortLabel, hasRole, STAFF_ROLES,
  type ImportResultsType, type ResultMappingType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { createBulkNotifications } from './notification.services';
import { getFileContent, FileError } from './file.services';
import {
  ExamError, advisoryLock, boardNameMap, boardRulesFor, familyOf, seriesOrThrow, studentOrThrow,
  type Executor, type SeriesRow, type Tx,
} from './exam-shared';
import { boardSeriesName } from './series.services';
import { schoolDate } from './window.services';
import { lineItemsFor } from './line.services';
import { verifyPriorSitting, recordVerifiedInTx, VerificationError } from './verification.services';
import { parseDelimited, readXlsx, tableFrom, TabularError } from '../lib/tabular';

type Actor = { id: string; role?: string | null };

// ─── Reading the file ────────────────────────────────────────────────────────

async function readSource(source: ImportResultsType['source'], actor: Actor): Promise<{ rows: string[][]; name: string; fileId: string | null }> {
  try {
    if ('text' in source) return { rows: parseDelimited(source.text), name: source.name, fileId: null };
    const f = await getFileContent(source.fileId, { id: actor.id, role: actor.role });
    const xlsx = f.mimeType.includes('spreadsheetml') || /\.xlsx$/i.test(f.name);
    return { rows: xlsx ? readXlsx(f.body) : parseDelimited(f.body.toString('utf8')), name: f.name, fileId: source.fileId };
  } catch (err) {
    if (err instanceof TabularError) throw new ExamError(err.message, 400);
    if (err instanceof FileError) throw new ExamError('That file is not one you can read — upload it again as an import file', 404);
    throw err;
  }
}

const CODE_TOKEN = /^([0-9A-Z]{3,6}(?:\/[0-9]{1,2})?)\b/;

/** The header row: the first of the first 25 rows that names a candidate column. */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    if ((rows[i] ?? []).some((c) => /(candidate|cand\.?\s*no|uci)/i.test(c))) return i + 1;
  }
  return 1;
}

/** A first guess at the mapping from the headers and the board's results key (the staff confirm or change it). */
function guessMapping(rows: string[][], resultsKey: 'candidate_number' | 'uci'): ResultMappingType {
  const headerRow = findHeaderRow(rows);
  const header = (rows[headerRow - 1] ?? []).map((h) => h.trim()).filter(Boolean);
  const uciCol = header.find((h) => /\buci\b/i.test(h));
  const numberCol = header.find((h) => /(candidate\s*(no|number|#)|cand\.?\s*no)/i.test(h)) ?? header.find((h) => /candidate/i.test(h) && !/name/i.test(h));
  const candidateColumn = (resultsKey === 'uci' ? uciCol ?? numberCol : numberCol ?? uciCol) ?? header[0] ?? '';
  const candidateKey = candidateColumn && candidateColumn === uciCol ? 'uci' : 'candidate_number';
  const codeColumn = header.find((h) => /(unit|syllabus|entry|subject)\s*code|^code$|^unit$|^syllabus$/i.test(h));
  const gradeColumn = header.find((h) => /grade|result/i.test(h));
  const markColumn = header.find((h) => /(ums|mark|score|pum)/i.test(h));
  if (codeColumn && gradeColumn) {
    return { shape: 'long', candidateColumn, candidateKey, codeColumn, gradeColumn, markColumn, headerRow };
  }
  const resultColumns = header.filter((h) => h !== candidateColumn && !/(name|dob|birth|sex|gender|uci|candidate)/i.test(h) && CODE_TOKEN.test(h.toUpperCase()));
  return { shape: 'wide', candidateColumn, candidateKey, resultColumns, headerRow };
}

/** "B", "a", "7", "A*", "B (78)" → grade and mark. */
function gradeAndMark(v: string): { grade: string; mark: number | null } | null {
  const s = v.trim();
  if (!s || s === '-' || s === '—') return null;
  const m = /^(\S+)\s*\((\d+(?:\.\d+)?)\)$/.exec(s);
  if (m) return { grade: m[1]!, mark: Number(m[2]) };
  return { grade: s, mark: null };
}

type Line = {
  line: number;
  candidate: string;
  studentId: string | null;
  studentName: string | null;
  code: string;
  grade: string;
  mark: number | null;
  kind: 'unit' | 'award' | null;
  unitId: string | null;
  qualificationId: string | null;
  entryId: string | null;
  outcome: 'new' | 'unchanged' | 'revised' | 'unknown_candidate' | 'unknown_code';
  previous: { grade: string; mark: number | null } | null;
  note: string | null;
};

/**
 * Read and match every line of a results file for a series. The latest
 * result already recorded for each candidate and code decides whether a line
 * is new, unchanged (a second import of the same file) or a revision.
 */
async function planImport(series: SeriesRow, rows: string[][], mapping: ResultMappingType, executor: Executor) {
  const { header, records } = tableFrom(rows, mapping.headerRow);
  if (!header.includes(mapping.candidateColumn)) throw new ExamError(`The file has no column "${mapping.candidateColumn}"`, 400);
  const raw: { line: number; candidate: string; code: string; grade: string; mark: number | null }[] = [];
  for (const r of records) {
    const candidate = (r.values[mapping.candidateColumn] ?? '').trim();
    if (!candidate) continue;
    if (mapping.shape === 'long') {
      if (!mapping.codeColumn || !mapping.gradeColumn) throw new ExamError('Say which columns hold the code and the grade', 400);
      const gm = gradeAndMark(r.values[mapping.gradeColumn] ?? '');
      if (!gm) continue;
      const markText = mapping.markColumn ? r.values[mapping.markColumn] ?? '' : '';
      const mark = markText && !Number.isNaN(Number(markText)) ? Number(markText) : gm.mark;
      raw.push({ line: r.line, candidate, code: (r.values[mapping.codeColumn] ?? '').trim().toUpperCase(), grade: gm.grade, mark });
    } else {
      for (const col of mapping.resultColumns ?? []) {
        const gm = gradeAndMark(r.values[col] ?? '');
        if (!gm) continue;
        const code = CODE_TOKEN.exec(col.trim().toUpperCase())?.[1] ?? col.trim().toUpperCase();
        raw.push({ line: r.line, candidate, code, grade: gm.grade, mark: gm.mark });
      }
    }
  }
  // Candidates: by number in this series, or by UCI.
  const keys = [...new Set(raw.map((l) => l.candidate))];
  const byKey = new Map<string, { studentId: string; name: string }>();
  if (keys.length) {
    const found = mapping.candidateKey === 'uci'
      ? await executor.select({ key: examCandidate.uci, studentId: user.id, name: user.name }).from(examCandidate).innerJoin(user, eq(user.id, examCandidate.studentId))
          .where(inArray(examCandidate.uci, keys.map((k) => k.toUpperCase())))
      : await executor.select({ key: examCandidateNumber.number, studentId: user.id, name: user.name }).from(examCandidateNumber).innerJoin(user, eq(user.id, examCandidateNumber.studentId))
          .where(and(eq(examCandidateNumber.boardSeriesId, series.id), inArray(examCandidateNumber.number, keys.map((k) => k.padStart(4, '0')))));
    for (const f of found) byKey.set(f.key!, { studentId: f.studentId, name: f.name });
  }
  const lookup = (k: string) => byKey.get(mapping.candidateKey === 'uci' ? k.toUpperCase() : k.padStart(4, '0'));
  const studentIds = [...new Set([...byKey.values()].map((v) => v.studentId))];
  const codes = [...new Set(raw.map((l) => l.code))];
  const [entries, units, quals, latest] = await Promise.all([
    studentIds.length ? executor.select().from(examEntry).where(and(eq(examEntry.boardSeriesId, series.id), inArray(examEntry.studentId, studentIds))) : [],
    codes.length ? executor.select({ id: examUnit.id, code: examUnit.code }).from(examUnit).where(and(eq(examUnit.boardCode, series.boardCode), inArray(sql`upper(${examUnit.code})`, codes))) : [],
    codes.length ? executor.select({ id: qualification.id, code: qualification.code, level: qualification.level }).from(qualification).where(and(eq(qualification.boardCode, series.boardCode), inArray(sql`upper(${qualification.code})`, codes))) : [],
    studentIds.length
      ? executor.execute(sql`
          select distinct on (student_id, kind, code) student_id as "studentId", kind, code, grade, mark::float as mark
          from exam_result where board_series_id = ${series.id} and student_id in (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})
          order by student_id, kind, code, created_at desc`).then((r) => r.rows as { studentId: string; kind: string; code: string; grade: string; mark: number | null }[])
      : [],
  ]);
  const lines: Line[] = raw.map((l) => {
    const who = lookup(l.candidate);
    const base = { line: l.line, candidate: l.candidate, code: l.code, grade: l.grade, mark: l.mark, previous: null, note: null };
    if (!who) {
      return { ...base, studentId: null, studentName: null, kind: null, unitId: null, qualificationId: null, entryId: null, outcome: 'unknown_candidate' as const,
        note: `No candidate ${mapping.candidateKey === 'uci' ? 'with UCI' : 'number'} ${l.candidate} in ${series.name}` };
    }
    // The candidate's own entry decides first (Cambridge 9700 is one code at AS and A Level).
    const entry = entries.find((e) => e.studentId === who.studentId && e.entryCode.toUpperCase() === l.code && e.status !== 'withdrawn')
      ?? entries.find((e) => e.studentId === who.studentId && e.entryCode.toUpperCase() === l.code);
    const unit = units.find((u) => u.code.toUpperCase() === l.code);
    const qual = entry?.qualificationId ? quals.find((q) => q.id === entry.qualificationId) : quals.find((q) => q.code.toUpperCase() === l.code);
    const kind = entry ? (entry.kind as 'unit' | 'award') : unit ? 'unit' : qual ? 'award' : null;
    if (!kind) {
      return { ...base, studentId: who.studentId, studentName: who.name, kind: null, unitId: null, qualificationId: null, entryId: null, outcome: 'unknown_code' as const,
        note: `${l.code} is not a ${series.boardName} unit or award in the catalogue` };
    }
    const prev = latest.find((x) => x.studentId === who.studentId && x.kind === kind && x.code === l.code);
    const same = prev && prev.grade === l.grade && (prev.mark ?? null) === (l.mark ?? null);
    return {
      ...base, studentId: who.studentId, studentName: who.name, kind,
      unitId: kind === 'unit' ? entry?.unitId ?? unit?.id ?? null : null,
      qualificationId: kind === 'award' ? entry?.qualificationId ?? qual?.id ?? null : null,
      entryId: entry?.id ?? null,
      outcome: !prev ? 'new' as const : same ? 'unchanged' as const : 'revised' as const,
      previous: prev ? { grade: prev.grade, mark: prev.mark } : null,
      note: entry ? null : 'No entry for it in this series (a result from another centre, or an entry not recorded here)',
    };
  });
  return { header, lines };
}

/**
 * Preview or commit a results file for a series. Without a mapping the saved
 * one for the board (or a guess) is used and returned for the staff to
 * confirm. The commit is one at a time per series and idempotent: a line
 * already recorded with the same grade adds nothing.
 */
export async function importResults(data: ImportResultsType, actor: Actor, ctx?: AuditContext) {
  const series = await seriesOrThrow(data.boardSeriesId);
  const rules = await boardRulesFor(series.boardCode);
  const source = await readSource(data.source, actor);
  const [saved] = data.mapping ? [] : await db.select().from(examResultMapping).where(eq(examResultMapping.boardCode, series.boardCode)).orderBy(desc(examResultMapping.updatedAt)).limit(1);
  const mapping: ResultMappingType = data.mapping ?? (saved?.mapping as ResultMappingType | undefined) ?? guessMapping(source.rows, rules.resultsKey as 'uci' | 'candidate_number');
  const summarize = (lines: Line[]) => ({
    lines: lines.length,
    new: lines.filter((l) => l.outcome === 'new').length,
    revised: lines.filter((l) => l.outcome === 'revised').length,
    unchanged: lines.filter((l) => l.outcome === 'unchanged').length,
    unknownCandidates: lines.filter((l) => l.outcome === 'unknown_candidate').length,
    unknownCodes: lines.filter((l) => l.outcome === 'unknown_code').length,
    candidates: new Set(lines.filter((l) => l.studentId).map((l) => l.studentId)).size,
  });
  const preview = (rows: string[][]) => rows.slice(0, Math.max(mapping.headerRow + 5, 8));
  const mappingFrom: 'yours' | 'saved' | 'guessed' = data.mapping ? 'yours' : saved ? 'saved' : 'guessed';
  const mappingName = !data.mapping && saved ? saved.name : null;
  if (!data.commit) {
    const { header, lines } = await planImport(series, source.rows, mapping, db);
    return {
      series: { id: series.id, name: series.name }, sourceName: source.name, mapping, mappingFrom, mappingName, header, sample: preview(source.rows),
      lines, summary: summarize(lines), committed: false, importId: null,
      sittingsVerified: [] as Awaited<ReturnType<typeof verifyDeclaredSittingsFromResults>>['verified'], verificationFailed: 0, verificationNote: null as string | null,
    };
  }
  const out = await db.transaction(async (tx) => {
    await advisoryLock(tx, `exam:results:${series.id}`);
    const { header, lines } = await planImport(series, source.rows, mapping, tx);
    const toAdd = lines.filter((l) => l.outcome === 'new' || l.outcome === 'revised');
    const importId = randomUUID();
    const summary = summarize(lines);
    await tx.insert(examResultImport).values({
      id: importId, boardSeriesId: series.id, boardCode: series.boardCode, fileId: source.fileId, sourceName: source.name,
      mapping, rowCount: lines.length, resultCount: toAdd.length, unmatchedCount: summary.unknownCandidates + summary.unknownCodes, createdBy: actor.id,
    });
    if (toAdd.length) {
      await tx.insert(examResult).values(toAdd.map((l) => ({
        id: randomUUID(), studentId: l.studentId!, boardSeriesId: series.id, boardCode: series.boardCode, kind: l.kind!, code: l.code,
        unitId: l.unitId, qualificationId: l.qualificationId, entryId: l.entryId, grade: l.grade, mark: l.mark, source: 'import', importId, createdBy: actor.id,
      })));
    }
    if (data.saveMappingAs) {
      await tx.insert(examResultMapping).values({ id: randomUUID(), boardCode: series.boardCode, name: data.saveMappingAs, mapping, updatedBy: actor.id })
        .onConflictDoUpdate({ target: [examResultMapping.boardCode, examResultMapping.name], set: { mapping, updatedBy: actor.id, updatedAt: new Date() } });
    }
    await logAction(actor.id, 'EXAM_RESULTS_IMPORTED', 'board_series', series.id, null, { importId, sourceName: source.name, ...summary }, ctx, tx);
    return { series: { id: series.id, name: series.name }, sourceName: source.name, mapping, mappingFrom, mappingName, header, sample: preview(source.rows), lines, summary, committed: true, importId };
  });
  // The board's results answer the sittings families declared in this series (§3.5): after the
  // commit, by the importer. A failure there never reads as a failed import: the results are saved
  // (the review of 093dbd1, item 7).
  const v = await verifyDeclaredSittingsFromResults(series, actor, ctx);
  return {
    ...out, sittingsVerified: v.verified, verificationFailed: v.failed,
    verificationNote: v.failed ? `Results saved; the verification of ${v.failed} declared sitting${v.failed === 1 ? '' : 's'} failed — answer ${v.failed === 1 ? 'it' : 'them'} on the session's To verify tab` : null,
  };
}

// ─── A declared sitting verified by the board's results (RESERVATIONS_REWORK.md §3.5, §9) ───

/**
 * A grade that is no evidence of a sitting: absent, pending, withheld, to be issued — the boards'
 * markers (Cambridge X, Q, Y; "ABS", "PENDING") — or nothing (the review of 093dbd1, item 7).
 */
const NOT_A_SITTING = new Set(['X', 'Q', 'Y', 'ABS', 'ABSENT', 'PENDING', 'WITHHELD', 'W', '-', '']);
export const isRealGrade = (grade: string | null | undefined) => !!grade && !NOT_A_SITTING.has(grade.trim().toUpperCase());

type SittingMatch = { registrationId: string; studentId: string; code: string; grade: string; seriesName: string; importedBy: string | null; importedAt: Date };

/**
 * For lines that follow a declared sitting not answered yet, the result on record in that sitting
 * for what each line's item enters (a unit it enters, or its award) with a real grade — the latest
 * report. Lines with none are not returned: a missing result rejects nothing (results files are
 * partial, F-07; the coordinator answers).
 */
async function sittingMatches(executor: Executor, lineIds: string[]): Promise<SittingMatch[]> {
  if (!lineIds.length) return [];
  const open = (await executor.execute(sql`
    select r.id from registration r
    where r.id in (${sql.join(lineIds.map((id) => sql`${id}`), sql`, `)})
      and r.prior_sitting_source in ('declared_by_family', 'declared_by_desk')
      and r.prior_sitting_verified_outcome is null and r.prior_sitting_series_id is not null
      and r.status in ('pending_approval', 'pending_payment', 'preregistered', 'confirmed')`)).rows as { id: string }[];
  if (!open.length) return [];
  const lines = await lineItemsFor(open.map((r) => r.id), executor);
  const seriesIds = [...new Set(lines.map((l) => l.priorSitting?.seriesId).filter((x): x is string => !!x))];
  const results = seriesIds.length
    ? await executor.select({
      studentId: examResult.studentId, boardSeriesId: examResult.boardSeriesId, unitId: examResult.unitId, qualificationId: examResult.qualificationId,
      code: examResult.code, grade: examResult.grade, createdBy: examResult.createdBy, createdAt: examResult.createdAt,
    }).from(examResult)
      .where(and(inArray(examResult.boardSeriesId, seriesIds), inArray(examResult.studentId, [...new Set(lines.map((l) => l.studentId))])))
      .orderBy(desc(examResult.createdAt))
    : [];
  const out: SittingMatch[] = [];
  for (const l of lines) {
    const p = l.priorSitting;
    if (!p) continue;
    const unitIds = new Set(l.enters.units.map((u) => u.id));
    // An award's result is evidence of a sitting of this line only when the line enters that award
    // itself, or the award is entered by syllabus option (Cambridge reports per syllabus per series);
    // a line of units of an award cashed in by units (Pearson's P1 under the IAL) needs its unit's
    // result — the award graded in June says nothing of when P1 was sat (the review of 426d565, item 1).
    const q = l.enters.qualification;
    const entersAward = l.item.entersKind === 'award' || l.item.entersKind === 'option' || (l.item.entersKind === 'subject' && !l.enters.units.length);
    const award = q && (entersAward || q.entryMethod === 'syllabus_option') ? q.id : null;
    // The latest report of what the line enters there; it verifies only when it is a real grade.
    const hit = results.find((x) => x.studentId === l.studentId && x.boardSeriesId === p.seriesId
      && ((x.unitId && unitIds.has(x.unitId)) || (award && x.qualificationId === award)));
    if (!hit || !isRealGrade(hit.grade)) continue;
    out.push({ registrationId: l.registrationId, studentId: l.studentId, code: hit.code, grade: hit.grade, seriesName: p.name, importedBy: hit.createdBy, importedAt: hit.createdAt });
  }
  return out;
}

const matchReason = (m: SittingMatch, how: string) => `${m.seriesName}'s results list ${m.code} for the candidate (${how})`;
const matchEvidence = (m: SittingMatch) => `The board's results for ${m.seriesName}: ${m.code} graded ${m.grade}`;

/**
 * Verify, through step B's own answer (`verifyPriorSitting`: the line stands, its receipt and line
 * locked in B's order, audited PRIOR_SITTING_VERIFIED), every one of these lines whose declared
 * sitting has a result on record — each in its own transaction, after the caller's commit. The one
 * who answers is the actor given (the importer, or the coordinator acting from the To verify tab),
 * with their own role; the result is the evidence. A line answered or changed meanwhile (B's 409)
 * is skipped; any other failure is counted, never thrown: the caller's work has committed.
 */
async function verifyMatches(lineIds: string[], actor: Actor, how: string, ctx?: AuditContext) {
  const role = actor.role ?? (await db.select({ role: user.role }).from(user).where(eq(user.id, actor.id)))[0]?.role ?? null;
  const verified: { registrationId: string; studentId: string; code: string; grade: string }[] = [];
  let failed = 0;
  let matches: SittingMatch[] = [];
  try {
    matches = await sittingMatches(db, lineIds);
  } catch (err) {
    console.error('[results] Could not match declared sittings:', err);
    return { verified, failed: lineIds.length };
  }
  for (const m of matches) {
    try {
      await verifyPriorSitting(m.registrationId, { outcome: 'verified', reason: matchReason(m, how), evidence: matchEvidence(m) }, { id: actor.id, role: role ?? '' }, ctx);
      verified.push({ registrationId: m.registrationId, studentId: m.studentId, code: m.code, grade: m.grade });
    } catch (err) {
      if (err instanceof VerificationError && err.status === 409) continue;
      failed++;
      console.error(`[results] Could not verify the declared sitting of line ${m.registrationId}:`, err);
    }
  }
  return { verified, failed };
}

/**
 * F4 verifies a declared sitting from the board's results (§3.5: "F4 verifies from the board's
 * results when they are imported"): after an import of a series commits, every line following a
 * sitting declared in that series and not answered yet, with a real grade on record there for what
 * its item enters, is verified by the importer. A sitting with no result for it is left to the
 * coordinator (a missing line is no rejection).
 */
export async function verifyDeclaredSittingsFromResults(series: SeriesRow, actor: Actor, ctx?: AuditContext) {
  const open = (await db.execute(sql`
    select r.id from registration r
    where r.prior_sitting_series_id = ${series.id}
      and r.prior_sitting_source in ('declared_by_family', 'declared_by_desk')
      and r.prior_sitting_verified_outcome is null
      and r.status in ('pending_approval', 'pending_payment', 'preregistered', 'confirmed')`)).rows as { id: string }[];
  return verifyMatches(open.map((r) => r.id), actor, 'results import', ctx);
}

/**
 * The same match from the session's To verify tab (the review of 093dbd1, item 3): every declared
 * sitting of the session still awaiting an answer, checked against the results on record, verified
 * by the coordinator (or admin) who asked.
 */
export async function verifyDeclaredOfSession(sessionId: string, actor: Actor, ctx?: AuditContext) {
  const [s] = await db.select({ id: registrationSession.id }).from(registrationSession).where(eq(registrationSession.id, sessionId));
  if (!s) throw new ExamError('Session not found', 404);
  const open = (await db.execute(sql`
    select r.id from registration r
    where r.session_id = ${sessionId}
      and r.prior_sitting_source in ('declared_by_family', 'declared_by_desk')
      and r.prior_sitting_verified_outcome is null
      and r.status in ('pending_approval', 'pending_payment', 'preregistered', 'confirmed')`)).rows as { id: string }[];
  const r = await verifyMatches(open.map((x) => x.id), actor, 'results on record, from the To verify tab', ctx);
  return { awaiting: open.length, verified: r.verified, failed: r.failed };
}

/**
 * At declaration (the review of 093dbd1, item 3; the owner: a result on record here is a known
 * sitting): inside the reservation's own transaction, a line just made that declares a sitting
 * with a real grade on record for what it enters is verified at once — step B's verified answer
 * (`recordVerifiedInTx`), the result as the evidence. The one answering is the one who declared when
 * they are staff (the desk: the review of 426d565, item 7); a family's own declaration names no
 * person — a parent or a student does not answer their own declaration — and is marked answered
 * from the results on record (the review of 54c225f, item 2). The reason names the result, who
 * imported it and when.
 */
export async function verifyDeclaredAtDeclarationInTx(tx: Tx, lineIds: string[], actorId: string, ctx?: AuditContext) {
  const matches = await sittingMatches(tx, lineIds);
  const verified: string[] = [];
  if (!matches.length) return verified;
  const [declarer] = await tx.select({ role: user.role }).from(user).where(eq(user.id, actorId));
  const staff = !!declarer && hasRole(declarer.role, ...STAFF_ROLES);
  const importers = new Map((await (matches.some((m) => m.importedBy)
    ? tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(matches.map((m) => m.importedBy).filter((x): x is string => !!x))]))
    : Promise.resolve([] as { id: string; name: string }[]))).map((u) => [u.id, u.name]));
  for (const m of matches) {
    const by = (m.importedBy && importers.get(m.importedBy)) || 'an account since removed';
    const done = await recordVerifiedInTx(tx, m.registrationId, {
      actorId: staff ? actorId : null, now: new Date(),
      reason: `${m.seriesName}'s results on record list ${m.code} for the candidate, imported by ${by} on ${schoolDate(m.importedAt)} (verified at declaration)`,
      evidence: matchEvidence(m), ...(staff ? {} : { answeredFrom: 'results_on_record' as const }),
    }, ctx);
    if (done) verified.push(m.registrationId);
  }
  return verified;
}


export async function listMappings(boardCode?: string) {
  return db.select().from(examResultMapping).where(boardCode ? eq(examResultMapping.boardCode, boardCode) : undefined).orderBy(asc(examResultMapping.boardCode), asc(examResultMapping.name));
}

// ─── Reading results ─────────────────────────────────────────────────────────

/** Results of a series or a student, every report of every attempt, newest first per key. */
export async function listResults(q: { boardSeriesId?: string; studentId?: string }, familyView = false) {
  if (!q.boardSeriesId && !q.studentId) throw new ExamError('Choose a series or a student', 400);
  const rows = await db.select({
    r: examResult, studentName: user.name, month: boardSeries.month, year: boardSeries.year, label: boardSeries.label,
    entryTitle: examEntry.title, importName: examResultImport.sourceName, unitTitle: examUnit.title, awardTitle: qualification.title,
  })
    .from(examResult).innerJoin(user, eq(user.id, examResult.studentId)).innerJoin(boardSeries, eq(boardSeries.id, examResult.boardSeriesId))
    .leftJoin(examEntry, eq(examEntry.id, examResult.entryId)).leftJoin(examResultImport, eq(examResultImport.id, examResult.importId))
    .leftJoin(examUnit, eq(examUnit.id, examResult.unitId)).leftJoin(qualification, eq(qualification.id, examResult.qualificationId))
    .where(and(
      q.boardSeriesId ? eq(examResult.boardSeriesId, q.boardSeriesId) : undefined,
      q.studentId ? eq(examResult.studentId, q.studentId) : undefined,
      familyView ? eq(examResult.status, 'published') : undefined,
    ))
    .orderBy(asc(user.name), asc(examResult.code), desc(examResult.createdAt));
  const names = await boardNameMap();
  // Earlier attempts at the same code (other series) for each student, so the screen can show them beside this one.
  const studentIds = [...new Set(rows.map((r) => r.r.studentId))];
  const attempts = studentIds.length
    ? (await db.execute(sql`
        select r.student_id as "studentId", r.code, count(distinct r.board_series_id)::int as n
        from exam_result r where r.student_id in (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)}) ${familyView ? sql`and r.status = 'published'` : sql``}
        group by r.student_id, r.code`)).rows as { studentId: string; code: string; n: number }[]
    : [];
  const [state] = q.boardSeriesId ? await db.select().from(examSeriesState).where(eq(examSeriesState.boardSeriesId, q.boardSeriesId)) : [];
  return {
    publishedAt: state?.resultsPublishedAt ?? null,
    results: rows.map(({ r, studentName, month, year, label, entryTitle, importName, unitTitle, awardTitle }, i) => ({
      ...r, studentName, entryTitle, importName,
      // What the unit or award is called: the entry's title, else the catalogue's (a result from another centre).
      title: entryTitle ?? unitTitle ?? awardTitle ?? r.code,
      seriesName: boardSeriesName(names, { boardCode: r.boardCode, month, year, label }),
      // The first row per candidate and code (in this order) is the board's latest report of it.
      latest: i === 0 || rows[i - 1]!.r.studentId !== r.studentId || rows[i - 1]!.r.code !== r.code || rows[i - 1]!.r.boardSeriesId !== r.boardSeriesId,
      attempts: attempts.find((a) => a.studentId === r.studentId && a.code === r.code)?.n ?? 1,
    })),
  };
}

/**
 * Publish a series' results to families: every provisional result becomes
 * visible, families are told, and a registration with no grade yet gets the
 * board's (its award's, or its only unit's), so the results screen and the
 * remark flow read it. A registration that already has a grade keeps it —
 * the answer lists them; nothing here decides which grade is of record.
 */
export async function publishResults(boardSeriesId: string, actorId: string, ctx?: AuditContext) {
  const series = await seriesOrThrow(boardSeriesId);
  const out = await db.transaction(async (tx) => {
    await advisoryLock(tx, `exam:results:${series.id}`);
    const published = await tx.update(examResult).set({ status: 'published', publishedAt: new Date(), publishedBy: actorId })
      .where(and(eq(examResult.boardSeriesId, series.id), eq(examResult.status, 'provisional'))).returning({ id: examResult.id, studentId: examResult.studentId });
    await tx.insert(examSeriesState).values({ boardSeriesId: series.id, resultsPublishedAt: new Date(), resultsPublishedBy: actorId })
      .onConflictDoUpdate({ target: examSeriesState.boardSeriesId, set: { resultsPublishedAt: new Date(), resultsPublishedBy: actorId } });
    // The board's grade per registration: its award entry's, else its only entry's; the latest report.
    const perReg = (await tx.execute(sql`
      with latest as (
        select distinct on (r.entry_id) r.entry_id, r.grade
        from exam_result r where r.board_series_id = ${series.id} and r.status = 'published' and r.entry_id is not null
        order by r.entry_id, r.created_at desc
      ), per_reg as (
        select e.registration_id as id,
          (array_agg(l.grade order by (e.kind = 'award') desc) filter (where l.grade is not null))[1] as grade,
          count(*) filter (where e.kind = 'award') as awards, count(*) as entries
        from exam_entry e left join latest l on l.entry_id = e.id
        where e.board_series_id = ${series.id} and e.registration_id is not null and e.status <> 'withdrawn'
        group by e.registration_id
      )
      select p.id, p.grade, reg.grade_received as "gradeReceived", reg.status
      from per_reg p join registration reg on reg.id = p.id
      where p.grade is not null and (p.awards = 1 or p.entries = 1)`)).rows as { id: string; grade: string; gradeReceived: string | null; status: string }[];
    const toSet = perReg.filter((r) => r.gradeReceived === null && r.status === 'confirmed');
    for (const r of toSet) {
      await tx.update(registration).set({ gradeReceived: r.grade, resultRecordedAt: new Date(), resultRecordedBy: actorId, updatedAt: new Date() })
        .where(and(eq(registration.id, r.id), isNull(registration.gradeReceived)));
    }
    const kept = perReg.filter((r) => r.gradeReceived !== null && r.gradeReceived !== r.grade);
    await logAction(actorId, 'EXAM_RESULTS_PUBLISHED', 'board_series', series.id, null,
      { published: published.length, gradesRecorded: toSet.length, gradesKept: kept.map((k) => ({ registrationId: k.id, recorded: k.gradeReceived, board: k.grade })) }, ctx, tx);
    return { published, gradesRecorded: toSet.length, kept };
  });
  const students = [...new Set(out.published.map((p) => p.studentId))];
  const families = await familyOf(students);
  await createBulkNotifications([...new Set([...families.values()].flat())], 'EXAM_RESULTS_PUBLISHED', `${series.name} results`,
    `Your results for ${series.name} are in. See them on your exam results page; the school will tell you when certificates arrive.`,
    { boardSeriesId: series.id, url: '/exams/my' });
  return { published: out.published.length, candidates: students.length, gradesRecorded: out.gradesRecorded, gradesKept: out.kept };
}

// ─── F5's contract ───────────────────────────────────────────────────────────

/**
 * Every sitting of a student recorded here: per series and unit or award, the
 * series (month, year, academic year), board, subject area, level (an
 * award's, or a unit's own), tier, the entry's status, every grade the board
 * reported (latest first, none overwritten), and the outcomes of any remark
 * on its registration. `gradeOfRecord` is always null: which grade counts
 * after a remark is the owner's open question (RF-09) — F5 decides nothing
 * either until it is answered. A family view has only what went to the
 * board and published results.
 */
export async function getSittings(studentId: string, familyView = false) {
  await studentOrThrow(studentId);
  const [entries, results] = await Promise.all([
    db.select().from(examEntry).where(and(eq(examEntry.studentId, studentId), familyView ? inArray(examEntry.status, ['submitted', 'amended']) : sql`${examEntry.status} <> 'withdrawn'`)),
    db.select().from(examResult).where(and(eq(examResult.studentId, studentId), familyView ? eq(examResult.status, 'published') : undefined)).orderBy(desc(examResult.createdAt)),
  ]);
  const seriesIds = [...new Set([...entries.map((e) => e.boardSeriesId), ...results.map((r) => r.boardSeriesId)])];
  const unitIds = [...new Set([...entries.map((e) => e.unitId), ...results.map((r) => r.unitId)].filter((x): x is string => !!x))];
  const qualIds = [...new Set([...entries.map((e) => e.qualificationId), ...results.map((r) => r.qualificationId)].filter((x): x is string => !!x))];
  const regIds = [...new Set(entries.map((e) => e.registrationId).filter((x): x is string => !!x))];
  const [seriesRows, units, quals, unitAwards, remarks] = await Promise.all([
    seriesIds.length ? db.select().from(boardSeries).where(inArray(boardSeries.id, seriesIds)) : [],
    unitIds.length ? db.select().from(examUnit).where(inArray(examUnit.id, unitIds)) : [],
    qualIds.length ? db.select().from(qualification).where(inArray(qualification.id, qualIds)) : [],
    unitIds.length
      ? db.select({ unitId: qualificationUnit.unitId, subjectArea: qualification.subjectArea }).from(qualificationUnit)
          .innerJoin(qualification, eq(qualification.id, qualificationUnit.qualificationId)).where(inArray(qualificationUnit.unitId, unitIds))
      : [],
    regIds.length
      ? db.query.remarkRequest.findMany({
          where: (r, { inArray: inArr }) => inArr(r.registrationId, regIds),
          with: { items: { columns: { paperCode: true, outcome: true, gradeAfter: true } } },
          columns: { id: true, registrationId: true, serviceType: true, status: true, updatedAt: true },
        })
      : [],
  ]);
  const names = await boardNameMap();
  type Key = string;
  const keyOf = (seriesId: string, kind: string, code: string): Key => `${seriesId}|${kind}|${code.toUpperCase()}`;
  const keys = new Map<Key, { seriesId: string; kind: string; code: string; entry: typeof entries[number] | null }>();
  for (const e of entries) keys.set(keyOf(e.boardSeriesId, e.kind, e.entryCode), { seriesId: e.boardSeriesId, kind: e.kind, code: e.entryCode, entry: e });
  for (const r of results) {
    const k = keyOf(r.boardSeriesId, r.kind, r.code);
    if (!keys.has(k)) keys.set(k, { seriesId: r.boardSeriesId, kind: r.kind, code: r.code, entry: null });
  }
  return [...keys.entries()].map(([k, v]) => {
    const s = seriesRows.find((x) => x.id === v.seriesId)!;
    const reports = results.filter((r) => keyOf(r.boardSeriesId, r.kind, r.code) === k);
    const unitId = v.entry?.unitId ?? reports[0]?.unitId ?? null;
    const qualId = v.entry?.qualificationId ?? reports[0]?.qualificationId ?? null;
    const unit = unitId ? units.find((u) => u.id === unitId) : undefined;
    const qual = qualId ? quals.find((q) => q.id === qualId) : undefined;
    const ay = seriesAcademicYearStart(s.month, s.year);
    return {
      boardSeriesId: s.id,
      series: { month: s.month, year: s.year, label: s.label, name: boardSeriesName(names, s), sitting: seriesLabel(s.month, s.year), academicYearStart: ay, academicYear: academicYearShortLabel(ay) },
      boardCode: s.boardCode,
      boardName: names.get(s.boardCode) ?? s.boardCode,
      kind: v.kind as 'unit' | 'award',
      code: v.code,
      title: v.entry?.title ?? unit?.title ?? qual?.title ?? v.code,
      subjectArea: qual?.subjectArea ?? unitAwards.find((a) => a.unitId === unitId)?.subjectArea ?? null,
      // An award's level ('igcse' | 'as_level' | 'a_level'), or a unit's own ('igcse' | 'as' | 'a2').
      level: qual?.level ?? unit?.unitLevel ?? null,
      tier: v.entry?.tier ?? qual?.tier ?? unit?.tier ?? null,
      entryId: v.entry?.id ?? null,
      entryStatus: v.entry?.status ?? null,
      isRetake: v.entry?.isRetake ?? false,
      grade: reports[0]?.grade ?? null,
      mark: reports[0]?.mark ?? null,
      reports: reports.map((r) => ({ grade: r.grade, mark: r.mark, status: r.status, source: r.source, reportedAt: r.createdAt })),
      remarks: v.entry?.registrationId
        ? remarks.filter((r) => r.registrationId === v.entry!.registrationId).map((r) => ({ id: r.id, serviceType: r.serviceType, status: r.status, items: r.items }))
        : [],
      gradeOfRecord: null as string | null,
    };
  }).sort((a, b) => a.series.year - b.series.year || a.series.month.localeCompare(b.series.month) || a.code.localeCompare(b.code));
}


