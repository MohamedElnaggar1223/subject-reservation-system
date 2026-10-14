/**
 * F7: committing a reviewed import — one family per transaction.
 *
 * The commit is claimed first (a status-guarded update: a second commit of
 * the same file at the same moment is refused, not run twice). Teachers and
 * sections the file needs are made in one transaction of their own, then each
 * family that is ready (nothing in it is an error) is committed in its own:
 * its accounts, links, section places, course enrolments, registration
 * history, lines awaiting payment (when a series is mapped to its session: the
 * admin's — each on the offer and item the sheet's words name, its attempt and
 * mode from the note, priced from the series' fee grid by insertLines, the
 * sheet's confirmation recorded as its consent on the imported channel) and
 * money history — every row it makes pointing back to
 * its line, every account and link audited, one IMPORT_FAMILY_COMMITTED row
 * listing what it made. A family that fails rolls back whole, and its rows say
 * why; the others stand. Running it again changes nothing: what exists is
 * found, and the database's own unique keys stop a second copy of anything.
 *
 * Money: nothing here creates a payment, a receipt or an escrow movement —
 * this module does not import those tables. Money from before the system is
 * written to `money_history` only (09-money-invariants checks it).
 */
import {
  db, user, teacher, section, parentStudentLink, registrationHistory, moneyHistory, importBatch, importRow, importPerson,
  registration, registrationSession, academicYear, sessionOffer, sessionOfferItem, boardSeries,
  eq, and, inArray, notInArray, sql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import { academicYearStartOf, gradeInAcademicYear, type ImportSettingsType, type LineInputType } from '@repo/validations';
import { logAction, type AuditContext } from '../audit.services';
import { generateUniqueStudentId } from '../user.services';
import { addSectionMembersInTx } from '../academic.services';
import { upsertEnrolments, type EnrolmentRowInput } from '../enrolment.services';
import { assertMayRegisterForInTx } from '../eligibility.services';
import { sessionWindow, windowRefusal } from '../window.services';
import { assertSchoolFeeGate } from '../registration.services';
import { insertLines } from '../line.services';
import { writeConsents } from '../reservation.services';
import { findOrCreateSeries } from '../offer.services';
import { lockStudents } from '../../lib/student-locks';
import {
  computeView, historyFingerprint, feeFingerprint, carryFingerprint, moneyFingerprints, historyOutcome, lower,
  type ImportView, type ImportRowView,
} from './view';
import { seriesText, type SheetLine, type MoneyLine } from './normalise';

type SheetData = Omit<SheetLine, 'local'>;
type MoneyData = Omit<MoneyLine, 'local'>;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ImportError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string } | null)?.code === '23505' || (err as { cause?: { code?: string } } | null)?.cause?.code === '23505';

/** A claimed commit left behind by a process that stopped is claimable again after this long. */
const STALE_CLAIM_MINUTES = 15;

export type Actor = { id: string; role: string | null | undefined };

async function loadInput(batchId: string) {
  const [batch] = await db.select().from(importBatch).where(eq(importBatch.id, batchId));
  if (!batch) throw new ImportError('Import not found', 404);
  const [rows, people] = await Promise.all([
    db.select().from(importRow).where(eq(importRow.batchId, batchId)).orderBy(importRow.tab, importRow.rowNumber),
    db.select().from(importPerson).where(eq(importPerson.batchId, batchId)),
  ]);
  return { batch, rows, people };
}

/** Commit every family that is ready. */
export async function commitImport(batchId: string, actor: Actor, ctx?: AuditContext) {
  // The claim: one commit of a file at a time.
  const [claimed] = await db.update(importBatch)
    .set({ status: 'committing', commitStartedBy: actor.id, commitStartedAt: new Date() })
    .where(and(
      eq(importBatch.id, batchId),
      sql`(${importBatch.status} in ('staged', 'partial') or (${importBatch.status} = 'committing' and ${importBatch.commitStartedAt} < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})))`,
    ))
    .returning();
  if (!claimed) {
    const [b] = await db.select({ status: importBatch.status, by: user.name, at: importBatch.commitStartedAt })
      .from(importBatch).leftJoin(user, eq(user.id, importBatch.commitStartedBy)).where(eq(importBatch.id, batchId));
    if (!b) throw new ImportError('Import not found', 404);
    if (b.status === 'committing') throw new ImportError(`${b.by ?? 'Someone'} is committing this import now — wait for it to finish, then look again`, 409);
    if (b.status === 'committed') throw new ImportError('This import is already committed', 409);
    throw new ImportError('This import was discarded', 409);
  }
  const previous = (claimed.committedAt ? 'partial' : 'staged') as 'staged' | 'partial';
  // This commit's own claim. A claim older than STALE_CLAIM_MINUTES may be taken over by another commit
  // while this one is still running (a process that only looked stopped): from then on this one writes
  // nothing to the batch — neither its final status nor, on an error, a reset of the new holder's claim.
  const ours = and(
    eq(importBatch.id, batchId), eq(importBatch.status, 'committing'),
    eq(importBatch.commitStartedBy, actor.id), eq(importBatch.commitStartedAt, claimed.commitStartedAt!),
  );
  try {
    let input = await loadInput(batchId);
    let view = await computeView(input);
    const ready = view.families.filter((f) => f.status === 'ready' || f.status === 'failed' || f.status === 'partly_committed');
    const readyRows = new Set(ready.flatMap((f) => f.rowIds));
    // Reserving for families in a session is the admin's (lines wait for money).
    if (actor.role !== 'admin' && view.rows.some((r) => readyRows.has(r.id) && r.plan.registration === 'live')) {
      throw new ImportError('Reserving lines for families in a session is the admin’s: ask the admin to commit this import, or set those series to "History only"', 403);
    }
    if (!ready.length) throw new ImportError(view.summary.heldFamilies ? 'Nothing is ready to commit: every family left has a problem to fix first' : 'Nothing is left to commit', 409);

    // Teachers and sections the file needs, in one transaction of their own.
    const reference = await createReferenceData(input.batch, view, readyRows, actor, ctx);
    if (reference.changedSettings) {
      input = await loadInput(batchId);
      view = await computeView(input);
    }

    const results: { key: string; status: 'committed' | 'failed' | 'skipped'; error?: string; created: Created }[] = [];
    for (const f of view.families.filter((x) => x.status === 'ready' || x.status === 'failed' || x.status === 'partly_committed')) {
      results.push(await commitFamilyWithRetry(batchId, f.key, actor, ctx));
    }

    // The batch after the commit.
    const after = await loadInput(batchId);
    const finalView = await computeView(after);
    const left = finalView.rows.filter((r) => r.decision === 'import' && r.status !== 'committed').length;
    const created = sumCreated(results.map((r) => r.created));
    const result = {
      at: new Date().toISOString(), by: actor.id,
      families: { committed: results.filter((r) => r.status === 'committed').length, failed: results.filter((r) => r.status === 'failed').length },
      failed: results.filter((r) => r.status === 'failed').map((r) => ({ family: r.key, error: r.error })),
      created, teachersCreated: reference.teachers, sectionsCreated: reference.sections,
      // The sheet's lines that made several lines in a session (one per unit or paper they name).
      rowsSplit: after.rows
        .filter((r) => r.status === 'committed' && r.committedAt && r.committedAt >= claimed.commitStartedAt!
          && ((r.outcome as { registrations?: string[] } | null)?.registrations?.length ?? 0) > 1)
        .map((r) => ({ row: `${r.tab} row ${r.rowNumber}`, lines: (r.outcome as { registrations: string[] }).registrations.length })),
    };
    const status = left === 0 ? 'committed' : 'partial';
    const finished = await db.transaction(async (tx) => {
      const [mine] = await tx.update(importBatch).set({
        status, result, commitStartedBy: null, commitStartedAt: null, committedBy: actor.id, committedAt: new Date(),
        summary: finalView.summary as unknown as Record<string, unknown>,
      }).where(ours).returning({ id: importBatch.id });
      if (!mine) return false;
      await logAction(actor.id, 'IMPORT_COMMITTED', 'import', batchId, { status: previous }, { status, ...result }, ctx, tx);
      return true;
    });
    if (!finished) throw new ImportError('Another commit took this import over while this one was running: look at the import again to see what each made', 409);
    return { status, result, view: finalView };
  } catch (err) {
    await db.update(importBatch).set({ status: previous, commitStartedBy: null, commitStartedAt: null }).where(ours);
    throw err;
  }
}

// ─── Reference data: teachers and sections ───────────────────────────────────

async function createReferenceData(batch: typeof importBatch.$inferSelect, view: ImportView, readyRows: Set<string>, actor: Actor, ctx?: AuditContext) {
  const rows = view.rows.filter((r) => readyRows.has(r.id));
  const teacherKeys = new Set(rows.map((r) => (r.data as SheetData).teacher).filter((t): t is string => !!t).map((t) => lower(t)));
  const toCreate = view.mapping.teachers.filter((t) => !t.teacherId && t.create && teacherKeys.has(t.key)
    && rows.some((r) => (r.data as SheetData).teacher && lower((r.data as SheetData).teacher!) === t.key && r.mode === 'in_school'));
  // Sections: each student placed in one that is not there yet.
  const wanted = new Map<string, { name: string; yearStart: number; grade: number }>();
  for (const r of rows) {
    if (r.plan.section !== 'add' || !r.studentKey) continue;
    const p = view.people.find((x) => x.role === 'student' && x.key === r.studentKey);
    if (!p?.section) continue;
    const yearStart = view.kind === 'scl_roster' ? p.cohortYear : r.classYear;
    if (yearStart === null || yearStart === undefined) continue;
    const s = view.mapping.sections.find((x) => x.name.toLowerCase() === p.section!.toLowerCase() && x.year === yearStart);
    if (!s || s.exists || !s.yearSetUp) continue;
    const cohort = p.matched?.cohortYear ?? p.cohortYear;
    const grade = /^\d{2}/.test(p.section) ? Number(p.section.slice(0, 2)) : gradeInAcademicYear(cohort, yearStart);
    if (grade === null || grade < 10 || grade > 12) continue;
    wanted.set(`${yearStart}|${p.section.toLowerCase()}`, { name: p.section, yearStart, grade });
  }
  if (!toCreate.length && !wanted.size) return { teachers: [] as string[], sections: [] as string[], changedSettings: false };

  return db.transaction(async (tx) => {
    // One import makes reference data at a time: a teacher's name is looked for again under the lock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('import:reference'))`);
    const settings = { ...(batch.settings as ImportSettingsType) };
    const teachersMap = { ...(settings.teachers ?? {}) };
    const madeTeachers: string[] = [];
    for (const t of toCreate) {
      const [existing] = await tx.select({ id: teacher.id }).from(teacher).where(sql`lower(${teacher.name}) = ${t.key}`).limit(1);
      const id = existing?.id ?? randomUUID();
      if (!existing) {
        await tx.insert(teacher).values({ id, name: t.name, isActive: true });
        madeTeachers.push(t.name);
      }
      teachersMap[t.key] = { teacherId: id, create: false };
    }
    const madeSections: string[] = [];
    for (const s of wanted.values()) {
      const [y] = await tx.select({ id: academicYear.id }).from(academicYear).where(eq(academicYear.startYear, s.yearStart));
      if (!y) continue;
      const inserted = await tx.insert(section).values({ id: randomUUID(), academicYearId: y.id, grade: s.grade, name: s.name })
        .onConflictDoNothing().returning();
      if (inserted[0]) {
        madeSections.push(s.name);
        await logAction(actor.id, 'SECTION_CREATED', 'section', inserted[0].id, null, { ...inserted[0], via: 'import', batchId: batch.id }, ctx, tx);
      }
    }
    settings.teachers = teachersMap;
    await tx.update(importBatch).set({ settings: settings as Record<string, unknown> }).where(eq(importBatch.id, batch.id));
    if (madeTeachers.length || madeSections.length) {
      await logAction(actor.id, 'IMPORT_REFERENCE_DATA_CREATED', 'import', batch.id, null, { teachers: madeTeachers, sections: madeSections }, ctx, tx);
    }
    return { teachers: madeTeachers.sort(), sections: madeSections.sort(), changedSettings: true };
  });
}

// ─── One family ──────────────────────────────────────────────────────────────

type Created = { students: number; parents: number; links: number; sectionPlaces: number; enrolments: number; history: number; registrations: number; money: number };
const noneCreated = (): Created => ({ students: 0, parents: 0, links: 0, sectionPlaces: 0, enrolments: 0, history: 0, registrations: 0, money: 0 });
function sumCreated(xs: Created[]): Created {
  const out = noneCreated();
  for (const x of xs) for (const k of Object.keys(out) as (keyof Created)[]) out[k] += x[k];
  return out;
}

class RetryFamily extends Error {}

/**
 * A family, in one transaction. If an account it would create was made at
 * the same moment by someone else (the email is taken now), it is worked out
 * again and retried once: that account is then matched.
 */
async function commitFamilyWithRetry(batchId: string, familyKey: string, actor: Actor, ctx?: AuditContext) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const input = await loadInput(batchId);
    const view = await computeView(input);
    // A family is keyed by one of its members; the same member finds it again.
    const [role, ...rest] = familyKey.split('|');
    const member = rest.join('|');
    const family = view.families.find((f) => f.key === familyKey)
      ?? view.families.find((f) => (role === 'student' ? f.students : f.parents).includes(member));
    if (!family || family.status === 'committed') return { key: familyKey, status: 'skipped' as const, created: noneCreated() };
    if (family.status === 'held') return { key: familyKey, status: 'failed' as const, error: 'It has a problem to fix first', created: noneCreated() };
    try {
      const created = await db.transaction((tx) => commitFamily(tx, input.batch, view, family, actor, ctx));
      return { key: familyKey, status: 'committed' as const, created };
    } catch (err) {
      if ((isUniqueViolation(err) || err instanceof RetryFamily) && attempt === 0) continue;
      const message = err instanceof Error && !(err as { code?: unknown }).code && !/^Failed query/.test(err.message)
        ? err.message : 'The family could not be committed (the database refused it) — look at its rows and try again';
      if (!(err instanceof Error) || (err as { code?: unknown }).code || /^Failed query/.test(err.message)) {
        console.error(`[import] family ${familyKey} of ${batchId} failed:`, err);
      }
      await db.update(importRow).set({ status: 'failed', error: message })
        .where(and(inArray(importRow.id, family.rowIds), eq(importRow.status, 'pending')));
      await db.update(importRow).set({ error: message })
        .where(and(inArray(importRow.id, family.rowIds), eq(importRow.status, 'failed')));
      return { key: familyKey, status: 'failed' as const, error: message, created: noneCreated() };
    }
  }
  return { key: familyKey, status: 'failed' as const, error: 'The family changed while it was committed — try again', created: noneCreated() };
}

async function commitFamily(
  tx: Tx, batch: typeof importBatch.$inferSelect, view: ImportView, family: ImportView['families'][number], actor: Actor, ctx?: AuditContext,
): Promise<Created> {
  // The family's rows, held: a second commit of the same rows waits here, then finds them committed.
  const locked = await tx.select({ id: importRow.id, status: importRow.status }).from(importRow)
    .where(inArray(importRow.id, family.rowIds)).orderBy(importRow.id).for('update');
  const todo = new Set(locked.filter((r) => r.status !== 'committed').map((r) => r.id));
  if (!todo.size) return noneCreated();
  const rows = view.rows.filter((r) => todo.has(r.id));
  const created = noneCreated();
  const createdIds: Record<string, string[]> = { users: [], links: [], enrolments: [], history: [], registrations: [], money: [] };
  const outcome = new Map<string, Record<string, unknown>>(rows.map((r) => [r.id, {}]));
  const note = (rowId: string, k: string, v: unknown) => { outcome.get(rowId)![k] = v; };
  const sourceRef = (r: ImportRowView) => `${batch.fileName} — ${r.tab} row ${r.rowNumber}`;

  if (view.kind === 'money_record') {
    const keys = moneyFingerprints(view.rows.filter((x) => x.data.kind === 'money').map((x) => ({ id: x.id, studentId: x.studentId, d: x.data as MoneyData })));
    for (const r of rows) {
      const d = r.data as MoneyData;
      if (!r.studentId) throw new ImportError(`${r.tab} row ${r.rowNumber}: no student`);
      const made = await tx.insert(moneyHistory).values({
        id: randomUUID(), studentId: r.studentId, kind: d.moneyKind, direction: d.direction, amount: d.amount, percent: d.percent,
        happenedOn: d.happenedOn, method: d.method, receiptNumber: d.receiptNumber, seriesLabel: d.seriesLabel, subjectLabel: d.subject, note: d.note,
        fingerprint: keys.get(r.id)!, importBatchId: batch.id, importRowId: r.id, sourceRef: sourceRef(r), createdBy: actor.id,
      }).onConflictDoNothing().returning({ id: moneyHistory.id });
      if (made[0]) { created.money++; createdIds.money!.push(made[0].id); note(r.id, 'money', 'created'); } else note(r.id, 'money', 'exists');
      note(r.id, 'studentId', r.studentId);
    }
    await finishFamily(tx, batch.id, rows, outcome, [], created, createdIds, family, actor, ctx);
    return created;
  }

  // Sections first (lock order: section, then students — as the Sections screen takes them).
  const people = new Map(view.people.map((p) => [`${p.role}|${p.key}`, p]));
  const studentsHere = family.students.map((k) => people.get(`student|${k}`)!).filter(Boolean);
  const parentsHere = family.parents.map((k) => people.get(`parent|${k}`)!).filter(Boolean);
  const sectionTargets = new Map<string, { sectionId: string; studentKeys: Set<string> }>();
  for (const r of rows) {
    if (r.plan.section !== 'add' || !r.studentKey) continue;
    const p = people.get(`student|${r.studentKey}`);
    const yearStart = view.kind === 'scl_roster' ? p?.cohortYear : r.classYear;
    if (!p?.section || yearStart === null || yearStart === undefined) continue;
    const [s] = await tx.select({ id: section.id }).from(section).innerJoin(academicYear, eq(academicYear.id, section.academicYearId))
      .where(and(eq(academicYear.startYear, yearStart), sql`lower(${section.name}) = ${p.section.toLowerCase()}`));
    if (!s) continue;
    const t = sectionTargets.get(s.id) ?? { sectionId: s.id, studentKeys: new Set<string>() };
    t.studentKeys.add(r.studentKey);
    sectionTargets.set(s.id, t);
  }
  if (sectionTargets.size) {
    await tx.select({ id: section.id }).from(section).where(inArray(section.id, [...sectionTargets.keys()])).orderBy(section.id).for('update');
  }
  // Then the family's students already in the system, FOR NO KEY UPDATE in id order, before any row
  // that names a subject (history, enrolments, lines share-lock it): the student before the subject, as
  // RESERVATIONS.md §2.1 orders it and a subject's board change takes them (the review of 2ca07a4,
  // item 3). A student this commit makes is its own row, seen by nobody else until it commits.
  await lockStudents(tx, studentsHere.filter((p) => p.matched?.role === 'student').map((p) => p.matched!.id));

  // Accounts: matched, or made now (no password: the family sets one with "Forgot password").
  const userIdOf = new Map<string, string>();
  for (const p of [...parentsHere, ...studentsHere]) {
    if (p.matched) {
      if (p.matched.role !== p.role) throw new ImportError(`${p.email} belongs to another kind of account`);
      userIdOf.set(`${p.role}|${p.key}`, p.matched.id);
      continue;
    }
    if (!p.email) throw new ImportError(`A ${p.role} has no email`);
    const [taken] = await tx.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${p.email}`);
    if (taken) throw new RetryFamily('An account with this email was made meanwhile');
    const id = randomUUID();
    const now = new Date();
    const studentFields = p.role === 'student' ? { studentId: await generateUniqueStudentId(), cohortYear: p.cohortYear } : {};
    await tx.insert(user).values({
      id, name: p.name || p.email.split('@')[0]!, email: p.email, emailVerified: true, role: p.role, phone: p.phone ?? null,
      createdAt: now, updatedAt: now, ...studentFields,
    });
    userIdOf.set(`${p.role}|${p.key}`, id);
    createdIds.users!.push(id);
    if (p.role === 'student') created.students++; else created.parents++;
    const sourceRows = p.rowIds.filter((id2) => todo.has(id2)).map((id2) => view.rows.find((r) => r.id === id2)!).map((r) => `${r.tab} row ${r.rowNumber}`);
    await logAction(actor.id, 'IMPORT_ACCOUNT_CREATED', 'user', id, null, { role: p.role, batchId: batch.id, rows: sourceRows.slice(0, 50), sclIds: p.sclIds }, ctx, tx);
    if (p.role === 'student') {
      await logAction(actor.id, 'STUDENT_COHORT_RECORDED', 'user', id, { cohortYear: null },
        { cohortYear: p.cohortYear, gradeNow: gradeInAcademicYear(p.cohortYear, academicYearStartOf()), how: 'import', batchId: batch.id }, ctx, tx);
    }
  }
  const studentIdOf = (r: ImportRowView) => (r.studentKey ? userIdOf.get(`student|${r.studentKey}`) ?? null : null);

  // Links: parent and child, approved (staff vouch for the family, as at the desk).
  const pairs = new Map<string, { parentId: string; studentId: string; rowIds: string[]; confirmedBy: string[] }>();
  for (const r of rows) {
    const sid = studentIdOf(r);
    if (!sid) continue;
    for (const pk of r.parentKeys) {
      const pid = userIdOf.get(`parent|${pk}`);
      if (!pid) continue;
      const k = `${pid}|${sid}`;
      const pair = pairs.get(k) ?? { parentId: pid, studentId: sid, rowIds: [], confirmedBy: [] };
      pair.rowIds.push(r.id);
      // A link to an account already in the system was confirmed on its line (the review holds it until then).
      if ((r.edits as { confirmLink?: boolean } | null)?.confirmLink) pair.confirmedBy.push(`${r.tab}!${r.rowNumber}`);
      pairs.set(k, pair);
    }
  }
  for (const pair of pairs.values()) {
    const [live] = await tx.select({ id: parentStudentLink.id, status: parentStudentLink.status }).from(parentStudentLink)
      .where(and(eq(parentStudentLink.parentId, pair.parentId), eq(parentStudentLink.studentId, pair.studentId), inArray(parentStudentLink.status, ['pending', 'approved'])))
      .for('update');
    let linkId: string | null = null;
    if (!live) {
      const made = await tx.insert(parentStudentLink).values({ id: randomUUID(), parentId: pair.parentId, studentId: pair.studentId, status: 'approved', respondedAt: new Date() })
        .onConflictDoNothing().returning({ id: parentStudentLink.id });
      linkId = made[0]?.id ?? null;
    } else if (live.status === 'pending') {
      await tx.update(parentStudentLink).set({ status: 'approved', respondedAt: new Date(), updatedAt: new Date() }).where(eq(parentStudentLink.id, live.id));
      linkId = live.id;
    }
    if (linkId) {
      created.links++;
      createdIds.links!.push(linkId);
      await logAction(actor.id, 'LINK_APPROVED', 'link', linkId, live ? { status: 'pending' } : null,
        { status: 'approved', parentId: pair.parentId, studentId: pair.studentId, via: 'import', batchId: batch.id, ...(pair.confirmedBy.length ? { confirmedExistingAccountOn: pair.confirmedBy } : {}) }, ctx, tx);
    }
    for (const id of pair.rowIds) note(id, 'link', linkId ? 'created' : 'exists');
  }

  // Section places.
  for (const t of sectionTargets.values()) {
    const ids = [...t.studentKeys].map((k) => userIdOf.get(`student|${k}`)).filter((x): x is string => !!x);
    if (!ids.length) continue;
    const res = await addSectionMembersInTx(tx, t.sectionId, { studentIds: ids }, actor.id, ctx);
    created.sectionPlaces += res.added;
  }
  for (const r of rows) if (r.plan.section !== 'none') note(r.id, 'section', r.plan.section === 'add' ? 'added' : r.plan.section);

  if (view.kind === 'scl_roster') {
    await finishFamily(tx, batch.id, rows, outcome, studentsHere.concat(parentsHere), created, createdIds, family, actor, ctx, userIdOf);
    return created;
  }

  // Registration history: what the student sat before the system (or of a series kept as history).
  const settings = view.settings;
  const teacherIdOf = (r: ImportRowView) => {
    const d = r.data as SheetData;
    if (!d.teacher) return null;
    return settings.teachers[lower(d.teacher)]?.teacherId ?? null;
  };
  for (const r of rows) {
    const d = r.data as SheetData;
    const sid = studentIdOf(r);
    if (!sid) continue;
    note(r.id, 'studentId', sid);
    if (r.plan.registration !== 'history' && r.plan.registration !== 'history_exists') continue;
    const carried = d.carryForwardNote ? { reading: settings.carryForward, from: d.carryForwardFrom, note: d.carryForwardNote } : null;
    const made = await tx.insert(registrationHistory).values({
      id: randomUUID(), studentId: sid, subjectId: r.subjectId, subjectLabel: d.subject, levelCode: d.levelCode ?? (d.levelText || null),
      sessionType: d.series!.type, seriesYear: d.series!.year, mode: r.mode ?? (d.selfStudy ? 'self_study' : 'in_school'),
      teacherId: r.mode === 'in_school' ? teacherIdOf(r) : null, teacherName: d.teacher, outcome: historyOutcome(d),
      carriedForward: carried, fingerprint: historyFingerprint(d),
      importBatchId: batch.id, importRowId: r.id, sourceRef: sourceRef(r), createdBy: actor.id,
    }).onConflictDoNothing().returning({ id: registrationHistory.id });
    if (made[0]) { created.history++; createdIds.history!.push(made[0].id); note(r.id, 'history', made[0].id); } else note(r.id, 'history', 'exists');
  }

  // Course enrolment for the class year (F0b's entry point, source 'import').
  const byYear = new Map<number, (EnrolmentRowInput & { rowId: string })[]>();
  for (const r of rows) {
    if (r.plan.enrolment === 'none' || !r.subjectId || r.classYear === null) continue;
    const sid = studentIdOf(r);
    if (!sid) continue;
    const list = byYear.get(r.classYear) ?? [];
    list.push({ rowId: r.id, studentId: sid, subjectId: r.subjectId, teacherId: r.mode === 'in_school' ? teacherIdOf(r) : null, mode: r.mode ?? 'in_school', sourceRef: `import:${batch.id}:${r.tab}!${r.rowNumber}` });
    byYear.set(r.classYear, list);
  }
  for (const [yearStart, list] of byYear) {
    const [y] = await tx.select({ id: academicYear.id }).from(academicYear).where(eq(academicYear.startYear, yearStart));
    if (!y) continue;
    const res = await upsertEnrolments(tx, y.id, list, actor.id, { source: 'import', commit: true, ctx });
    const refused = res.rows.find((x) => x.outcome === 'refused');
    if (refused) throw new ImportError(`Course enrolment refused: ${refused.reason}`);
    created.enrolments += res.created;
    res.rows.forEach((x, i) => note(list[i]!.rowId, 'enrolment', x.outcome === 'created' ? 'created' : 'exists'));
  }

  // Lines awaiting payment in the session (the admin's) — every reservation path's own checks.
  const live = rows.filter((r) => r.plan.registration === 'live');
  const bySession = new Map<string, ImportRowView[]>();
  for (const r of live) {
    if (!r.plan.lines.length || !studentIdOf(r)) throw new ImportError(`${r.tab} row ${r.rowNumber}: no line in a session for it`);
    const k = `${studentIdOf(r)}|${r.plan.lines[0]!.sessionId}`;
    bySession.set(k, [...(bySession.get(k) ?? []), r]);
  }
  // Every student with lines held FOR NO KEY UPDATE, in id order, before the first line (RESERVATIONS.md
  // §2.1: the student first; the review of 8 Oct, item 5): no student's line, fee row or one-shot
  // exception is locked while another student of the family is still to be locked. The ones already
  // in the system are held since the section locks; this covers every student with lines whatever the
  // path that made them.
  await lockStudents(tx, [...bySession.keys()].map((k) => k.split('|')[0]!));
  for (const [k, list] of [...bySession].sort(([a], [b]) => a.localeCompare(b))) {
    const [studentId, sessionId] = k.split('|') as [string, string];
    const made = await reserveImportLines(tx, studentId, sessionId, list, actor, batch, ctx);
    created.registrations += made.length;
    createdIds.registrations!.push(...made.map((m) => m.id));
    for (const r of list) {
      const ids = made.filter((m) => m.rowId === r.id).map((m) => m.id);
      if (ids.length) note(r.id, 'registrations', ids);
    }
  }

  // Money history: the sheet's fee notes and, read that way, a carried-forward payment (IS-02, IS-08).
  for (const r of rows) {
    const d = r.data as SheetData;
    const sid = studentIdOf(r);
    if (!sid || r.plan.money === 'none' || !d.series) continue;
    const entries: (typeof moneyHistory.$inferInsert)[] = [];
    const base = { studentId: sid, seriesLabel: seriesText(d.series), subjectLabel: d.subject, importBatchId: batch.id, importRowId: r.id, sourceRef: sourceRef(r), createdBy: actor.id };
    if (d.feeNote) entries.push({ ...base, id: randomUUID(), kind: d.feeKind ?? 'other', percent: d.feePercent, note: d.feeNote, fingerprint: feeFingerprint(d) });
    if (d.carryForwardNote && settings.carryForward === 'payment') {
      entries.push({ ...base, id: randomUUID(), kind: 'carried_forward', note: d.carryForwardNote, fingerprint: carryFingerprint(d) });
    }
    for (const e of entries) {
      const made = await tx.insert(moneyHistory).values(e).onConflictDoNothing().returning({ id: moneyHistory.id });
      if (made[0]) { created.money++; createdIds.money!.push(made[0].id); note(r.id, 'money', made[0].id); }
    }
  }

  await finishFamily(tx, batch.id, rows, outcome, studentsHere.concat(parentsHere), created, createdIds, family, actor, ctx, userIdOf);
  return created;
}

/**
 * A family's lines in one session, in the family's transaction, the way every reservation path makes
 * them (RESERVATIONS_REWORK.md §6, §9's F7 list): the student held first (assertMayRegisterForInTx,
 * FOR NO KEY UPDATE), the session open for each line (its series' effective deadline), the school-fee
 * gate, then insertLines — the rework's locks in their order, assertLineRules, priceLine from the
 * series' fee grid (a missing row refused, naming the grid; a provisional one priced provisional,
 * never 0), the due date and the teacher — on the offer item the review found, with the attempt,
 * mode and sitting the sheet gives: a sitting from the student's legacy history ('legacy') or named
 * on the sheet or the line ('declared_by_desk', listed on To verify), made as a board series with no
 * dates when not on record. The sheet's confirmation is the family's consent on the imported
 * channel. Pending payment, never paid.
 */
async function reserveImportLines(
  tx: Tx, studentId: string, sessionId: string, rows: ImportRowView[], actor: Actor, batch: typeof importBatch.$inferSelect, ctx?: AuditContext,
) {
  const eligibility = await assertMayRegisterForInTx(tx, studentId, sessionId);
  const [sess] = await tx.select({ name: registrationSession.name }).from(registrationSession).where(eq(registrationSession.id, sessionId));
  if (!sess) throw new ImportError('Session not found', 404);
  // A line the student holds already (the same file committed before) is not made again.
  const wanted = rows.flatMap((r) => r.plan.lines.map((l) => ({ r, l })));
  const held = await tx.select({ itemId: registration.offerItemId }).from(registration)
    .where(and(eq(registration.studentId, studentId), eq(registration.sessionId, sessionId), inArray(registration.offerItemId, wanted.map((x) => x.l.offerItemId)),
      notInArray(registration.status, ['dropped', 'rejected', 'expired'])));
  const todo = wanted.filter((x) => !held.some((h) => h.itemId === x.l.offerItemId));
  if (!todo.length) return [];
  const now = new Date();
  const lines: LineInputType[] = [];
  for (const { r, l } of todo) {
    const [it] = await tx.select({ seriesId: sessionOfferItem.boardSeriesId, subjectId: sessionOffer.subjectId, boardCode: boardSeries.boardCode })
      .from(sessionOfferItem).innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId))
      .leftJoin(boardSeries, eq(boardSeries.id, sessionOfferItem.boardSeriesId)).where(eq(sessionOfferItem.id, l.offerItemId));
    if (!it) throw new ImportError(`${r.tab} row ${r.rowNumber}: the item is no longer offered`);
    let priorId: string | null = null;
    if (l.priorSitting) {
      if (!it.boardCode) throw new ImportError(`${r.tab} row ${r.rowNumber}: ${l.subjectName} has no board to name a sitting of`);
      priorId = (await findOrCreateSeries(tx, it.boardCode, l.priorSitting.month, l.priorSitting.year, '', actor.id,
        `Created when the day-one import named a sitting not on record (no dates yet): ${batch.fileName} — ${r.tab} row ${r.rowNumber}`)).id;
    }
    const w = await sessionWindow(studentId, sessionId, { boardSeriesId: it.seriesId, attempt: l.attempt, priorSittingSeriesId: priorId, declarationRejected: false, subjectId: it.subjectId }, tx, now);
    if (!w.open) throw new ImportError(`${r.tab} row ${r.rowNumber}: ${windowRefusal(w, `${sess.name} is not open for reservations`)}`);
    lines.push({
      offerItemId: l.offerItemId, attempt: l.attempt, mode: l.mode, teacherId: l.mode === 'in_school' ? l.teacherId : null,
      priorSittingSeriesId: priorId, priorSittingSource: priorId ? l.priorSitting!.source : null,
    });
  }
  await assertSchoolFeeGate(studentId, eligibility);
  const inserted = await insertLines(tx, {
    studentId, sessionId, lines, status: 'pending_payment', requestedBy: actor.id, approvedBy: actor.id, approvedAt: now,
    approvalComments: `[IMPORT] ${batch.fileName} — ${[...new Set(todo.map(({ r }) => `${r.tab} row ${r.rowNumber}`))].join(', ')}`, eligibility, now,
  });
  // The sheet's "I confirm my registration": the family's consent to the refund policy and the declaration, as the sheet recorded it.
  await writeConsents(tx, inserted.map((i) => i.id), { channel: 'imported', confirmedBy: actor.id, at: now });
  const lineOf = (itemId: string) => todo.find((x) => x.l.offerItemId === itemId)!;
  await logAction(actor.id, 'IMPORT_REGISTRATION', 'registration', studentId, null, {
    batchId: batch.id, sessionId, session: sess.name, registrationIds: inserted.map((i) => i.id),
    lines: inserted.map((i) => {
      const { r, l } = lineOf(i.offerItemId!);
      return {
        row: `${r.tab} row ${r.rowNumber}`, ...(l.code ? { code: l.code } : {}), registrationId: i.id, item: l.itemLabel, attempt: i.attempt, mode: i.mode,
        priorSittingSource: i.priorSittingSource, price: i.priceAtRegistration, provisional: i.priceProvisional,
      };
    }),
  }, ctx, tx);
  return inserted.map((i) => ({ id: i.id, rowId: lineOf(i.offerItemId!).r.id }));
}

/** The rows and people of a committed family, and its one audit row. */
async function finishFamily(
  tx: Tx, batchId: string, rows: ImportRowView[], outcome: Map<string, Record<string, unknown>>,
  people: ImportView['people'], created: Created, createdIds: Record<string, string[]>, family: ImportView['families'][number],
  actor: Actor, ctx?: AuditContext, userIdOf?: Map<string, string>,
) {
  const now = new Date();
  for (const r of rows) {
    await tx.update(importRow).set({ status: 'committed', outcome: { ...outcome.get(r.id), plan: r.plan }, error: null, committedAt: now }).where(eq(importRow.id, r.id));
  }
  for (const p of people) {
    const uid = userIdOf?.get(`${p.role}|${p.key}`) ?? null;
    await tx.insert(importPerson).values({ id: randomUUID(), batchId, role: p.role, key: p.key, status: 'committed', userId: uid, updatedBy: actor.id })
      .onConflictDoUpdate({ target: [importPerson.batchId, importPerson.role, importPerson.key], set: { status: 'committed', userId: uid, error: null, updatedAt: now } });
  }
  await logAction(actor.id, 'IMPORT_FAMILY_COMMITTED', 'import', batchId, null, {
    family: family.key, rows: rows.map((r) => `${r.tab} row ${r.rowNumber}`), created, ids: createdIds,
  }, ctx, tx);
}
