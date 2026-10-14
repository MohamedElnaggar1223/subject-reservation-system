/**
 * Candidates (FEATURES_PLAN.md F4, "Candidates"; DISCOVERY_RESEARCH.md §2, §5
 * note 5; DISCOVERY.md Q-05): what the boards ask of each student — the name
 * as on their ID, date of birth, gender, Pearson's UCI (permanent), a
 * candidate number per board series with its history, the access
 * arrangements the boards approved — and the national ID or passport.
 *
 * The national ID is sensitive: it lives in its own table, one function
 * reads it (for the coordinator and the admin, each read audited), and it is
 * never in a list, a response other than that one, a log line or an audit
 * row. Writing it catches the driver's error itself, because a failed query's
 * message carries its parameters and would otherwise reach the console.
 */

import {
  db, user, examCandidate, examCandidateIdentity, examCandidateNumber, examEntry, boardSeries,
  eq, and, inArray, sql, asc, gradeTodaySql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  ACADEMIC_ROLES, hasRole, gradeToday,
  type UpdateCandidateType, type SetCandidateIdentityType, type ListCandidatesQueryType, type SetCandidateNumberType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { boardSeriesName } from './series.services';
import {
  ExamError, advisoryLock, boardNameMap, boardRulesFor, centreFor, isUniqueViolation, seriesOrThrow, studentOrThrow, violatedConstraint,
  type Executor,
} from './exam-shared';

/** A national ID or passport shown to staff who may not read it: its type and last four characters. */
function masked(n: string) {
  return `${'•'.repeat(Math.max(0, n.length - 4))}${n.slice(-4)}`;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * The candidates staff work on: every student in grades 10–12 today (and a
 * graduate retaking) or with an entry — or, for a series, those entered or
 * with a confirmed registration in it, with their number there. Each row says
 * what the boards still need. Never the national ID: only whether one is
 * recorded.
 */
export async function listCandidates(q: ListCandidatesQueryType) {
  const series = q.boardSeriesId ? await seriesOrThrow(q.boardSeriesId) : null;
  const search = q.search?.trim();
  const inSeries = series
    ? sql`(exists (select 1 from exam_entry e where e.student_id = u.id and e.board_series_id = ${series.id} and e.status <> 'withdrawn')
          or exists (select 1 from registration r where r.student_id = u.id and r.board_series_id = ${series.id} and r.status = 'confirmed'))`
    : sql`((u.left_on is null and ${gradeTodaySql(sql`u.cohort_year`)} between 10 and 13)
          or exists (select 1 from exam_entry e where e.student_id = u.id and e.status <> 'withdrawn'))`;
  const rows = (await db.execute(sql`
    select u.id as "studentId", u.name, u.student_id as "studentCode", u.cohort_year as "cohortYear", u.left_on as "leftOn",
      c.legal_forenames as "legalForenames", c.legal_surname as "legalSurname", c.date_of_birth::text as "dateOfBirth",
      c.gender, c.uci, coalesce(c.access_arrangements, '[]'::jsonb) as "accessArrangements",
      c.access_arrangements_ref as "accessArrangementsRef", c.access_arrangements_until::text as "accessArrangementsUntil",
      (i.student_id is not null) as "hasIdDocument", i.document_type as "idDocumentType",
      ${series ? sql`(select n.number from exam_candidate_number n where n.student_id = u.id and n.board_series_id = ${series.id})` : sql`null::text`} as "candidateNumber",
      ${series ? sql`(select count(*)::int from exam_entry e where e.student_id = u.id and e.board_series_id = ${series.id} and e.status <> 'withdrawn')` : sql`(select count(*)::int from exam_entry e where e.student_id = u.id and e.status <> 'withdrawn')`} as "entryCount",
      (select coalesce(bool_or(r.uci_required), false) from exam_entry e join exam_board_rule r on r.board_code = e.board_code
        where e.student_id = u.id and e.status <> 'withdrawn' ${series ? sql`and e.board_series_id = ${series.id}` : sql``}) as "uciNeeded"
    from "user" u
    left join exam_candidate c on c.student_id = u.id
    left join exam_candidate_identity i on i.student_id = u.id
    where u.role = 'student' and ${inSeries}
      ${search ? sql`and (u.name ilike ${'%' + search + '%'} or u.email ilike ${'%' + search + '%'} or u.student_id ilike ${'%' + search + '%'}
                  or c.uci ilike ${'%' + search + '%'} or c.legal_surname ilike ${'%' + search + '%'} or c.legal_forenames ilike ${'%' + search + '%'})` : sql``}
    order by coalesce(c.legal_surname, u.name), u.name
    limit 1000
  `)).rows as {
    studentId: string; name: string; studentCode: string | null; cohortYear: number | null; leftOn: string | null;
    legalForenames: string | null; legalSurname: string | null; dateOfBirth: string | null; gender: string | null; uci: string | null;
    accessArrangements: string[]; accessArrangementsRef: string | null; accessArrangementsUntil: string | null;
    hasIdDocument: boolean; idDocumentType: string | null; candidateNumber: string | null; entryCount: number; uciNeeded: boolean;
  }[];
  // In a series the board's own rule says whether a UCI is needed, entered yet or not.
  const seriesNeedsUci = series ? (await boardRulesFor(series.boardCode)).uciRequired : false;
  const out = rows.map((r) => {
    const missing: string[] = [];
    if (!r.legalForenames || !r.legalSurname) missing.push('legal_name');
    if (!r.dateOfBirth) missing.push('date_of_birth');
    if (!r.gender) missing.push('gender');
    if (!r.uci && (r.uciNeeded || seriesNeedsUci)) missing.push('uci');
    if (series && !r.candidateNumber) missing.push('candidate_number');
    if (!r.hasIdDocument) missing.push('national_id');
    return { ...r, grade: gradeToday(r.cohortYear), missing };
  });
  return {
    series: series ? { id: series.id, name: series.name, boardCode: series.boardCode, boardName: series.boardName } : null,
    candidates: q.missing ? out.filter((c) => c.missing.includes(q.missing!)) : out,
  };
}

/**
 * One candidate: their details, whether an ID document is recorded (its type
 * and last four characters — the number itself only through getIdentity),
 * their candidate numbers in every series, and their entries per series.
 */
export async function getCandidate(studentId: string) {
  const student = await studentOrThrow(studentId);
  const [[c], [ident], numbers, entries] = await Promise.all([
    db.select().from(examCandidate).where(eq(examCandidate.studentId, studentId)),
    db.select().from(examCandidateIdentity).where(eq(examCandidateIdentity.studentId, studentId)),
    db.select({
      id: examCandidateNumber.id, boardSeriesId: examCandidateNumber.boardSeriesId, boardCode: examCandidateNumber.boardCode,
      number: examCandidateNumber.number, centreNumber: examCandidateNumber.centreNumber, source: examCandidateNumber.source,
      createdAt: examCandidateNumber.createdAt, month: boardSeries.month, year: boardSeries.year, label: boardSeries.label,
    }).from(examCandidateNumber).innerJoin(boardSeries, eq(boardSeries.id, examCandidateNumber.boardSeriesId))
      .where(eq(examCandidateNumber.studentId, studentId))
      .orderBy(asc(boardSeries.year), asc(examCandidateNumber.createdAt)),
    db.select({ boardSeriesId: examEntry.boardSeriesId, status: examEntry.status, n: sql<number>`count(*)::int` })
      .from(examEntry).where(eq(examEntry.studentId, studentId)).groupBy(examEntry.boardSeriesId, examEntry.status),
  ]);
  const names = await boardNameMap();
  return {
    student: { ...student, grade: gradeToday(student.cohortYear) },
    candidate: c ?? null,
    idDocument: ident ? { documentType: ident.documentType, masked: masked(ident.documentNumber), recordedAt: ident.recordedAt } : null,
    numbers: numbers.map((n) => ({ ...n, seriesName: boardSeriesName(names, { boardCode: n.boardCode, month: n.month, year: n.year, label: n.label }) })),
    entriesBySeries: entries,
  };
}

// ─── Changing ────────────────────────────────────────────────────────────────

/**
 * Record or change a candidate's details. A UCI is permanent: once recorded,
 * changing it needs a reason and is audited as a correction; one UCI belongs
 * to one candidate (the database's unique index says which).
 */
export async function updateCandidate(studentId: string, data: UpdateCandidateType, actorId: string, ctx?: AuditContext) {
  await studentOrThrow(studentId);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(examCandidate).where(eq(examCandidate.studentId, studentId)).for('update');
    const uciChanges = data.uci !== undefined && (before?.uci ?? null) !== (data.uci ?? null);
    if (uciChanges && before?.uci && !data.uciCorrectionReason) {
      throw new ExamError(`The UCI ${before.uci} is permanent: say why it is being corrected`, 409);
    }
    const { uciCorrectionReason, ...fields } = data;
    const values = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<typeof examCandidate.$inferInsert>;
    let row;
    try {
      [row] = await tx.insert(examCandidate)
        .values({ studentId, ...values, updatedBy: actorId })
        .onConflictDoUpdate({ target: examCandidate.studentId, set: { ...values, updatedBy: actorId, updatedAt: new Date() } })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err) && violatedConstraint(err) === 'examCandidate_uci_idx') {
        const [other] = await db.select({ name: user.name }).from(examCandidate).innerJoin(user, eq(user.id, examCandidate.studentId))
          .where(eq(examCandidate.uci, data.uci!));
        throw new ExamError(`The UCI ${data.uci} is already recorded for ${other?.name ?? 'another candidate'}`, 409);
      }
      throw err;
    }
    const changed = Object.keys(values).filter((k) => JSON.stringify((before as Record<string, unknown> | undefined)?.[k] ?? null) !== JSON.stringify((values as Record<string, unknown>)[k] ?? null));
    if (changed.length) {
      const pick = (o: Record<string, unknown> | undefined) => Object.fromEntries(changed.map((k) => [k, o?.[k] ?? null]));
      await logAction(actorId, uciChanges && before?.uci ? 'CANDIDATE_UCI_CORRECTED' : 'CANDIDATE_UPDATED', 'exam_candidate', studentId,
        pick(before as Record<string, unknown> | undefined), { ...pick(values as Record<string, unknown>), ...(uciCorrectionReason ? { reason: uciCorrectionReason } : {}) }, ctx, tx);
    }
    return row!;
  });
}

/**
 * The national ID or passport, for the coordinator and the admin only. Each
 * read writes an audit row saying who looked — never the number.
 */
export async function getIdentity(studentId: string, viewer: { id: string; role?: string | null }, ctx?: AuditContext) {
  if (!hasRole(viewer.role, ...ACADEMIC_ROLES)) throw new ExamError('Forbidden', 403);
  await studentOrThrow(studentId);
  const [ident] = await db.select({
    documentType: examCandidateIdentity.documentType, documentNumber: examCandidateIdentity.documentNumber,
    recordedAt: examCandidateIdentity.recordedAt, recordedByName: user.name,
  }).from(examCandidateIdentity).leftJoin(user, eq(user.id, examCandidateIdentity.recordedBy))
    .where(eq(examCandidateIdentity.studentId, studentId));
  if (!ident) throw new ExamError('No ID document is recorded for this candidate', 404);
  await logAction(viewer.id, 'CANDIDATE_IDENTITY_VIEWED', 'exam_candidate', studentId, null, { documentType: ident.documentType }, ctx);
  return ident;
}

/** Record the national ID or passport. The audit row says it changed, never what it is. */
export async function setIdentity(studentId: string, data: SetCandidateIdentityType, actorId: string, actorRole: string | null | undefined, ctx?: AuditContext) {
  if (!hasRole(actorRole, ...ACADEMIC_ROLES)) throw new ExamError('Forbidden', 403);
  await studentOrThrow(studentId);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select({ documentType: examCandidateIdentity.documentType, documentNumber: examCandidateIdentity.documentNumber })
        .from(examCandidateIdentity).where(eq(examCandidateIdentity.studentId, studentId)).for('update');
      if (before && before.documentType === data.documentType && before.documentNumber === data.documentNumber) {
        return { documentType: data.documentType, masked: masked(data.documentNumber), changed: false };
      }
      await tx.insert(examCandidateIdentity)
        .values({ studentId, documentType: data.documentType, documentNumber: data.documentNumber, recordedBy: actorId })
        .onConflictDoUpdate({
          target: examCandidateIdentity.studentId,
          set: { documentType: data.documentType, documentNumber: data.documentNumber, recordedBy: actorId, recordedAt: new Date() },
        });
      await logAction(actorId, 'CANDIDATE_IDENTITY_RECORDED', 'exam_candidate', studentId,
        before ? { documentType: before.documentType, recorded: true } : { recorded: false },
        { documentType: data.documentType, recorded: true }, ctx, tx);
      return { documentType: data.documentType, masked: masked(data.documentNumber), changed: true };
    });
  } catch (err) {
    // Never let the driver's error (its message carries the parameters) reach a log.
    if (err instanceof ExamError) throw err;
    if (isUniqueViolation(err)) throw new ExamError('This document number is already recorded for another candidate — check it against the document', 409);
    throw new ExamError('The ID document could not be saved', 400);
  }
}

// ─── Candidate numbers ───────────────────────────────────────────────────────

/** Students a series' numbers are for: entered in it, or with a confirmed registration in it. */
async function seriesCandidates(seriesId: string, executor: Executor = db) {
  return (await executor.execute(sql`
    select u.id as "studentId", u.name, c.legal_surname as "legalSurname", c.legal_forenames as "legalForenames"
    from "user" u left join exam_candidate c on c.student_id = u.id
    where u.role = 'student' and (
      exists (select 1 from exam_entry e where e.student_id = u.id and e.board_series_id = ${seriesId} and e.status <> 'withdrawn')
      or exists (select 1 from registration r where r.student_id = u.id and r.board_series_id = ${seriesId} and r.status = 'confirmed'))
    order by coalesce(c.legal_surname, u.name), coalesce(c.legal_forenames, ''), u.name, u.id
  `)).rows as { studentId: string; name: string; legalSurname: string | null; legalForenames: string | null }[];
}

/**
 * Give every candidate of a series without a number one: the number they had
 * in the board's last series when it is free here (centres keep a
 * candidate's number where they can), otherwise the lowest free one, in
 * name order. Preview first; the commit is idempotent and one at a time (an
 * advisory lock per series), and the unique indexes keep a number to one
 * candidate and a candidate to one number.
 */
export async function assignCandidateNumbers(seriesId: string, commit: boolean, actorId: string, ctx?: AuditContext) {
  const series = await seriesOrThrow(seriesId);
  const centre = await centreFor(series.boardCode);
  const plan = async (executor: Executor) => {
    const [candidates, existing, previous] = await Promise.all([
      seriesCandidates(series.id, executor),
      executor.select({ studentId: examCandidateNumber.studentId, number: examCandidateNumber.number })
        .from(examCandidateNumber).where(eq(examCandidateNumber.boardSeriesId, series.id)),
      executor.execute(sql`
        select distinct on (n.student_id) n.student_id as "studentId", n.number
        from exam_candidate_number n join board_series s on s.id = n.board_series_id
        where n.board_code = ${series.boardCode} and n.board_series_id <> ${series.id}
        order by n.student_id, s.year desc, n.created_at desc`).then((r) => r.rows as { studentId: string; number: string }[]),
    ]);
    const has = new Map(existing.map((e) => [e.studentId, e.number]));
    const used = new Set(existing.map((e) => e.number));
    const prev = new Map(previous.map((p) => [p.studentId, p.number]));
    const wanted = candidates.filter((c) => !has.has(c.studentId));
    const out: { studentId: string; name: string; number: string; keptFromLastSeries: boolean }[] = [];
    // First those whose last number is free (so a later candidate's lowest free number cannot take it).
    for (const c of wanted) {
      const p = prev.get(c.studentId);
      if (p && !used.has(p)) {
        used.add(p);
        out.push({ studentId: c.studentId, name: c.name, number: p, keptFromLastSeries: true });
      }
    }
    let next = 1;
    for (const c of wanted) {
      if (out.some((o) => o.studentId === c.studentId)) continue;
      while (used.has(String(next).padStart(4, '0'))) next++;
      if (next > 9999) throw new ExamError('No candidate numbers are left in this series', 409);
      const n = String(next).padStart(4, '0');
      used.add(n);
      out.push({ studentId: c.studentId, name: c.name, number: n, keptFromLastSeries: false });
    }
    out.sort((a, b) => a.number.localeCompare(b.number));
    return { alreadyNumbered: existing.length, toAssign: out };
  };
  if (!commit) return { series: { id: series.id, name: series.name }, centreNumber: centre.centreNumber, committed: false, ...(await plan(db)) };
  return db.transaction(async (tx) => {
    await advisoryLock(tx, `exam:numbers:${series.id}`);
    const p = await plan(tx);
    if (p.toAssign.length) {
      await tx.insert(examCandidateNumber).values(p.toAssign.map((a) => ({
        id: randomUUID(), studentId: a.studentId, boardSeriesId: series.id, boardCode: series.boardCode, number: a.number,
        centreNumber: centre.centreNumber, source: 'assigned', createdBy: actorId,
      })));
      await logAction(actorId, 'CANDIDATE_NUMBERS_ASSIGNED', 'board_series', series.id, null,
        { count: p.toAssign.length, numbers: p.toAssign.map((a) => ({ studentId: a.studentId, number: a.number })) }, ctx, tx);
    }
    return { series: { id: series.id, name: series.name }, centreNumber: centre.centreNumber, committed: true, ...p };
  });
}

/**
 * Set one candidate's number by hand (a number the board issued, or one
 * carried from another centre). Refused once the candidate has an entry in
 * the series submitted to a board that fixes numbers.
 */
export async function setCandidateNumber(data: SetCandidateNumberType, actorId: string, ctx?: AuditContext) {
  const series = await seriesOrThrow(data.boardSeriesId);
  const student = await studentOrThrow(data.studentId);
  const rules = await boardRulesFor(series.boardCode);
  const centre = await centreFor(series.boardCode);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(examCandidateNumber)
        .where(and(eq(examCandidateNumber.studentId, student.id), eq(examCandidateNumber.boardSeriesId, series.id))).for('update');
      if (before?.number === data.number) return before;
      if (before && rules.candidateNumberFixed) {
        const [submitted] = await tx.select({ id: examEntry.id }).from(examEntry)
          .where(and(eq(examEntry.studentId, student.id), eq(examEntry.boardSeriesId, series.id), inArray(examEntry.status, ['submitted', 'amended'])))
          .limit(1);
        if (submitted) {
          throw new ExamError(`${student.name}'s candidate number in ${series.name} is fixed: entries with it have gone to ${series.boardName}`, 409);
        }
        if (!data.reason) throw new ExamError('Say why the candidate number changes', 400);
      }
      const [row] = before
        ? await tx.update(examCandidateNumber).set({ number: data.number, source: 'manual', updatedAt: new Date() })
            .where(eq(examCandidateNumber.id, before.id)).returning()
        : await tx.insert(examCandidateNumber).values({
            id: randomUUID(), studentId: student.id, boardSeriesId: series.id, boardCode: series.boardCode, number: data.number,
            centreNumber: centre.centreNumber, source: 'manual', createdBy: actorId,
          }).returning();
      await logAction(actorId, 'CANDIDATE_NUMBER_SET', 'exam_candidate', student.id,
        before ? { boardSeriesId: series.id, number: before.number } : null,
        { boardSeriesId: series.id, number: data.number, ...(data.reason ? { reason: data.reason } : {}) }, ctx, tx);
      return row!;
    });
  } catch (err) {
    if (isUniqueViolation(err) && violatedConstraint(err) === 'examCandidateNumber_series_number_idx') {
      const [holder] = await db.select({ name: user.name }).from(examCandidateNumber).innerJoin(user, eq(user.id, examCandidateNumber.studentId))
        .where(and(eq(examCandidateNumber.boardSeriesId, series.id), eq(examCandidateNumber.number, data.number)));
      throw new ExamError(`Candidate number ${data.number} is already ${holder?.name ?? 'another candidate'}'s in ${series.name}`, 409);
    }
    throw err;
  }
}

/** Candidate numbers per student in a series (for the entry list and the registers). */
export async function numbersIn(seriesId: string, studentIds: string[], executor: Executor = db) {
  if (!studentIds.length) return new Map<string, string>();
  const rows = await executor.select({ studentId: examCandidateNumber.studentId, number: examCandidateNumber.number })
    .from(examCandidateNumber)
    .where(and(eq(examCandidateNumber.boardSeriesId, seriesId), inArray(examCandidateNumber.studentId, [...new Set(studentIds)])));
  return new Map(rows.map((r) => [r.studentId, r.number]));
}

/** Candidate details per student (for the entry list, statements and registers). */
export async function candidatesOf(studentIds: string[], executor: Executor = db) {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return new Map<string, typeof examCandidate.$inferSelect>();
  const rows = await executor.select().from(examCandidate).where(inArray(examCandidate.studentId, ids));
  return new Map(rows.map((r) => [r.studentId, r]));
}
