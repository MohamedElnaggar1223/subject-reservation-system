/**
 * The day-one import (FEATURES_PLAN.md F7): a file staged, reviewed, then
 * committed one family per transaction. Admin and coordinator.
 *
 * - stageImport: an uploaded file (purpose `import_file`, F0a's uploads) is
 *   read into its tabs and lines; nothing else changes.
 * - getImportView: the review, worked out now (services/import/view.ts).
 * - updateImportSettings / updateImportRows / updateImportPerson: the
 *   staff's mapping, fixes, merges and skips — each audited.
 * - createImportSubjects: catalogue rows for the sheet's subjects (the
 *   admin's: they carry prices).
 * - commitImport (services/import/commit.ts), discardImport.
 */
import { createHash, randomUUID } from 'crypto';
import {
  db, importBatch, importRow, importPerson, subject, user, examBoard,
  eq, and, inArray, desc, sql,
} from '@repo/db';
import {
  ImportSettings,
  type CreateImportType, type ImportSettingsType, type UpdateImportRowsType, type UpdateImportPersonType, type CreateImportSubjectsType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { getFileContent, getReadableFile, FileError } from './file.services';
import { readSource, SourceError } from './import/source';
import { computeView } from './import/view';
import { commitImport as commit, ImportError, type Actor } from './import/commit';

export { ImportError };

async function loadBatch(batchId: string) {
  const [batch] = await db.select().from(importBatch).where(eq(importBatch.id, batchId));
  if (!batch) throw new ImportError('Import not found', 404);
  return batch;
}

async function loadInput(batchId: string) {
  const batch = await loadBatch(batchId);
  const [rows, people] = await Promise.all([
    db.select().from(importRow).where(eq(importRow.batchId, batchId)).orderBy(importRow.tab, importRow.rowNumber),
    db.select().from(importPerson).where(eq(importPerson.batchId, batchId)),
  ]);
  return { batch, rows, people };
}

/** The review may change only while the file waits: not while it is being committed, nor after. */
function assertEditable(batch: typeof importBatch.$inferSelect) {
  if (batch.status === 'committing') throw new ImportError('This import is being committed now — wait for it to finish', 409);
  if (batch.status === 'committed') throw new ImportError('This import is committed: what it made is in the system now', 409);
  if (batch.status === 'discarded') throw new ImportError('This import was discarded', 409);
}

// ─── The list ────────────────────────────────────────────────────────────────

export async function listImports() {
  const rows = await db
    .select({
      id: importBatch.id, kind: importBatch.kind, fileName: importBatch.fileName, status: importBatch.status, summary: importBatch.summary,
      createdAt: importBatch.createdAt, committedAt: importBatch.committedAt, createdByName: user.name, fileHash: importBatch.fileHash,
    })
    .from(importBatch)
    .leftJoin(user, eq(user.id, importBatch.createdBy))
    .orderBy(desc(importBatch.createdAt))
    .limit(200);
  return rows.map(({ summary, ...r }) => {
    const s = summary as { rows?: number; importing?: number; rowsWithErrors?: number; families?: number; readyFamilies?: number; heldFamilies?: number; committedFamilies?: number };
    return {
      ...r,
      rows: s.rows ?? 0, importing: s.importing ?? 0, rowsWithErrors: s.rowsWithErrors ?? 0,
      families: s.families ?? 0, readyFamilies: s.readyFamilies ?? 0, heldFamilies: s.heldFamilies ?? 0, committedFamilies: s.committedFamilies ?? 0,
    };
  });
}

// ─── Staging ─────────────────────────────────────────────────────────────────

/** Stage an uploaded file: its tabs and lines as read. Nothing else changes. */
export async function stageImport(data: CreateImportType, actor: Actor, ctx?: AuditContext) {
  const viewer = { id: actor.id, role: actor.role };
  const f = await getReadableFile(data.fileId, viewer);
  if (!f) throw new ImportError('File not found', 404);
  if (f.purpose !== 'import_file') throw new ImportError('Upload the file as an import file first (it was uploaded for something else)', 400);
  let content: Awaited<ReturnType<typeof getFileContent>>;
  try {
    content = await getFileContent(data.fileId, viewer);
  } catch (err) {
    if (err instanceof FileError) throw new ImportError(err.message, err.status === 503 ? 409 : (err.status as 400 | 404));
    throw err;
  }
  let source: ReturnType<typeof readSource>;
  try {
    source = readSource(data.kind, content.body, content.name, content.mimeType);
  } catch (err) {
    if (err instanceof SourceError) throw new ImportError(err.message, 400);
    throw err;
  }
  if (!source.lines.length) throw new ImportError('The file has no lines to import under its headers', 400);
  const fileHash = createHash('sha256').update(content.body).digest('hex');
  const id = randomUUID();
  await db.transaction(async (tx) => {
    // The same file staged before: its review is carried over (the mapping, the fixes, the merges
    // and skips), so running it again asks nothing new and makes nothing new.
    const [earlier] = await tx.select().from(importBatch)
      .where(and(eq(importBatch.fileHash, fileHash), eq(importBatch.kind, data.kind), sql`${importBatch.status} <> 'discarded'`))
      .orderBy(desc(importBatch.createdAt)).limit(1);
    const before = earlier ? await tx.select().from(importRow).where(eq(importRow.batchId, earlier.id)) : [];
    const beforeAt = new Map(before.map((r) => [`${r.tab}|${r.rowNumber}`, r]));
    await tx.insert(importBatch).values({
      id, kind: data.kind, fileId: data.fileId, fileName: content.name, fileHash, status: 'staged',
      source: { tabs: source.tabs } as Record<string, unknown>, settings: earlier?.settings ?? {}, createdBy: actor.id,
    });
    for (let i = 0; i < source.lines.length; i += 500) {
      await tx.insert(importRow).values(source.lines.slice(i, i + 500).map((l) => {
        const was = beforeAt.get(`${l.tab}|${l.rowNumber}`);
        return {
          id: randomUUID(), batchId: id, tab: l.tab, rowNumber: l.rowNumber, raw: l.raw,
          edits: was?.edits ?? {}, decision: was?.decision ?? null, decisionNote: was?.decisionNote ?? null, decidedBy: was?.decidedBy ?? null,
        };
      }));
    }
    if (earlier) {
      const people = await tx.select().from(importPerson).where(eq(importPerson.batchId, earlier.id));
      const decided = people.filter((p) => Object.keys(p.edits ?? {}).length || p.mergedInto || p.distinct || p.oneChild || p.decision === 'skip');
      if (decided.length) {
        await tx.insert(importPerson).values(decided.map((p) => ({
          id: randomUUID(), batchId: id, role: p.role, key: p.key, edits: p.edits, mergedInto: p.mergedInto, distinct: p.distinct,
          oneChild: p.oneChild, decision: p.decision, updatedBy: actor.id,
        })));
      }
    }
    await logAction(actor.id, 'IMPORT_STAGED', 'import', id, null, {
      kind: data.kind, fileId: data.fileId, fileName: content.name, lines: source.lines.length,
      tabs: source.tabs.map((t) => ({ name: t.name, kind: t.kind, lines: t.lines })), reviewCarriedFrom: earlier?.id ?? null,
    }, ctx, tx);
  });
  await refreshSummary(id);
  return { id };
}

/** The list's counts, from the review as it is now. */
async function refreshSummary(batchId: string) {
  const view = await computeView(await loadInput(batchId));
  await db.update(importBatch).set({ summary: view.summary as unknown as Record<string, unknown> }).where(eq(importBatch.id, batchId));
  return view;
}

// ─── The review ──────────────────────────────────────────────────────────────

export async function getImportView(batchId: string) {
  const input = await loadInput(batchId);
  const { batch } = input;
  const [view, names, sameFile] = await Promise.all([
    computeView(input),
    db.select({ id: user.id, name: user.name }).from(user)
      .where(inArray(user.id, [batch.createdBy, batch.committedBy, batch.commitStartedBy].filter((x): x is string => !!x).concat('__none__'))),
    db.select({ id: importBatch.id, status: importBatch.status, committedAt: importBatch.committedAt, createdAt: importBatch.createdAt })
      .from(importBatch).where(and(eq(importBatch.fileHash, batch.fileHash), sql`${importBatch.id} <> ${batch.id}`)).orderBy(desc(importBatch.createdAt)),
  ]);
  const nameOf = (id: string | null) => (id ? names.find((n) => n.id === id)?.name ?? null : null);
  return {
    batch: {
      id: batch.id, kind: batch.kind, fileId: batch.fileId, fileName: batch.fileName, status: batch.status,
      createdAt: batch.createdAt, createdByName: nameOf(batch.createdBy), committedAt: batch.committedAt, committedByName: nameOf(batch.committedBy),
      commitStartedAt: batch.commitStartedAt, commitStartedByName: nameOf(batch.commitStartedBy),
      result: batch.result, sameFileBefore: sameFile,
      storedSettings: batch.settings as ImportSettingsType,
    },
    ...view,
  };
}

/** The mapping settings: what is sent replaces those keys (a record key by key). */
export async function updateImportSettings(batchId: string, patch: ImportSettingsType, actor: Actor, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatch).where(eq(importBatch.id, batchId)).for('update');
    if (!batch) throw new ImportError('Import not found', 404);
    assertEditable(batch);
    // Registering families in a window is the admin's: a coordinator maps series to history or leaves them out.
    if (actor.role !== 'admin' && Object.values(patch.series ?? {}).some((s) => s.mode === 'window')) {
      throw new ImportError('Registering families in an open window is the admin’s: map the series to "History only", or ask the admin', 403);
    }
    const before = (batch.settings ?? {}) as ImportSettingsType;
    const next: ImportSettingsType = { ...before };
    for (const k of ['tabs', 'series', 'subjects', 'teachers'] as const) {
      if (patch[k]) (next as Record<string, unknown>)[k] = { ...(before[k] ?? {}), ...patch[k] };
    }
    for (const k of ['createSections', 'enrol', 'selfStudyOnTaught', 'carryForward', 'graduates', 'gradeYear'] as const) {
      if (patch[k] !== undefined) (next as Record<string, unknown>)[k] = patch[k];
    }
    const parsed = ImportSettings.parse(next);
    await tx.update(importBatch).set({ settings: parsed as Record<string, unknown> }).where(eq(importBatch.id, batchId));
    await logAction(actor.id, 'IMPORT_REVIEWED', 'import', batchId, null, { settings: patch }, ctx, tx);
  }).then(() => refreshSummary(batchId));
}

/** Fix, skip or include rows. A committed row is history: it does not change. */
export async function updateImportRows(batchId: string, data: UpdateImportRowsType, actor: Actor, ctx?: AuditContext) {
  await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatch).where(eq(importBatch.id, batchId)).for('update');
    if (!batch) throw new ImportError('Import not found', 404);
    assertEditable(batch);
    const rows = await tx.select().from(importRow).where(and(eq(importRow.batchId, batchId), inArray(importRow.id, data.rowIds)));
    if (rows.length !== new Set(data.rowIds).size) throw new ImportError('One or more rows are not in this import', 404);
    const committed = rows.filter((r) => r.status === 'committed');
    if (committed.length) throw new ImportError(`${committed.length === 1 ? 'That row is' : `${committed.length} rows are`} committed already: what they made is in the system now`, 409);
    for (const r of rows) {
      const edits = { ...(r.edits ?? {}) } as Record<string, unknown>;
      for (const k of data.clear ?? []) delete edits[k];
      for (const [k, v] of Object.entries(data.edits ?? {})) if (v !== undefined) edits[k] = v;
      await tx.update(importRow).set({
        edits,
        ...(data.decision ? { decision: data.decision, decisionNote: data.note ?? null, decidedBy: actor.id } : {}),
        ...(r.status === 'failed' ? { status: 'pending' as const, error: null } : {}),
      }).where(eq(importRow.id, r.id));
    }
    await logAction(actor.id, 'IMPORT_REVIEWED', 'import', batchId, null, {
      rows: rows.map((r) => `${r.tab} row ${r.rowNumber}`), edits: data.edits ? Object.keys(data.edits) : [], cleared: data.clear ?? [],
      decision: data.decision ?? null, note: data.note ?? null,
    }, ctx, tx);
  });
  return refreshSummary(batchId);
}

/** A person: the name or phone to use, a merge, "different people", "one child", skip. */
export async function updateImportPerson(batchId: string, data: UpdateImportPersonType, actor: Actor, ctx?: AuditContext) {
  const view = await computeView(await loadInput(batchId));
  const target = view.people.find((p) => p.role === data.role && p.key === data.key);
  if (!target) throw new ImportError('That person is not in this import', 404);
  if (target.status === 'committed') throw new ImportError('This person is committed already: change them on their record', 409);
  if (data.mergedInto) {
    if (data.mergedInto === data.key) throw new ImportError('A person cannot be merged into themself');
    const into = view.people.find((p) => p.role === data.role && p.key === data.mergedInto);
    // Only into someone who is not merged themself: no chain turns back on itself.
    if (!into || into.mergedInto) throw new ImportError('Merge into a person of this import who is not merged into someone else', 404);
  }
  await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatch).where(eq(importBatch.id, batchId)).for('update');
    if (!batch) throw new ImportError('Import not found', 404);
    assertEditable(batch);
    const [existing] = await tx.select().from(importPerson)
      .where(and(eq(importPerson.batchId, batchId), eq(importPerson.role, data.role), eq(importPerson.key, data.key)));
    const edits: Record<string, unknown> = { ...((existing?.edits ?? {}) as Record<string, unknown>), ...(data.edits ?? {}) };
    for (const [k, v] of Object.entries(edits)) if (v === '' || v === null) delete edits[k];
    const values = {
      edits,
      mergedInto: data.mergedInto !== undefined ? data.mergedInto : existing?.mergedInto ?? null,
      distinct: data.distinct ?? existing?.distinct ?? false,
      oneChild: data.oneChild ?? existing?.oneChild ?? false,
      decision: data.decision ?? existing?.decision ?? 'import',
      updatedBy: actor.id,
      updatedAt: new Date(),
    };
    if (existing) await tx.update(importPerson).set(values).where(eq(importPerson.id, existing.id));
    else await tx.insert(importPerson).values({ id: randomUUID(), batchId, role: data.role, key: data.key, ...values });
    await logAction(actor.id, 'IMPORT_REVIEWED', 'import', batchId, null, { person: { role: data.role, key: data.key }, change: data }, ctx, tx);
  });
  return refreshSummary(batchId);
}

/** Catalogue rows for the sheet's subjects, mapped at once (the admin's: a subject carries its prices). */
export async function createImportSubjects(batchId: string, data: CreateImportSubjectsType, actor: Actor, ctx?: AuditContext) {
  await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatch).where(eq(importBatch.id, batchId)).for('update');
    if (!batch) throw new ImportError('Import not found', 404);
    assertEditable(batch);
    const boards = new Set((await tx.select({ code: examBoard.code }).from(examBoard)).map((b) => b.code));
    const settings = { ...((batch.settings ?? {}) as ImportSettingsType) };
    const subjects = { ...(settings.subjects ?? {}) };
    for (const s of data.subjects) {
      if (!boards.has(s.council)) throw new ImportError(`No exam board ${s.council}`, 400);
      const code = s.code.trim().toUpperCase();
      const [clash] = await tx.select({ id: subject.id }).from(subject).where(sql`upper(${subject.code}) = ${code}`);
      if (clash) throw new ImportError(`A subject with the code ${code} exists already — map "${s.name}" to it, or choose another code`, 409);
      const id = randomUUID();
      const [made] = await tx.insert(subject).values({
        id, name: s.name.trim(), code, council: s.council, qualificationLevel: s.qualificationLevel,
        courseFee: s.courseFee, registrationFee: s.registrationFee, priceInSchool: s.courseFee + s.registrationFee,
        isOfferedAtSchool: s.isOfferedAtSchool, isCore: false, isActive: true,
      }).returning();
      await logAction(actor.id, 'SUBJECT_CREATED', 'subject', id, null, { ...made, via: 'import', batchId }, ctx, tx);
      subjects[s.key] = { subjectId: id };
    }
    settings.subjects = subjects;
    await tx.update(importBatch).set({ settings: settings as Record<string, unknown> }).where(eq(importBatch.id, batchId));
    await logAction(actor.id, 'IMPORT_REFERENCE_DATA_CREATED', 'import', batchId, null, { subjects: data.subjects.map((s) => ({ key: s.key, code: s.code.toUpperCase() })) }, ctx, tx);
  });
  return refreshSummary(batchId);
}

export async function commitImport(batchId: string, actor: Actor, ctx?: AuditContext) {
  const out = await commit(batchId, actor, ctx);
  return { status: out.status, result: out.result };
}

/** Put a staged file aside: nothing it would have made is made. What it already committed stays. */
export async function discardImport(batchId: string, actor: Actor, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatch).where(eq(importBatch.id, batchId)).for('update');
    if (!batch) throw new ImportError('Import not found', 404);
    if (batch.status === 'committing') throw new ImportError('This import is being committed now — wait for it to finish', 409);
    if (batch.status === 'committed' || batch.status === 'discarded') throw new ImportError(`This import is ${batch.status} already`, 409);
    await tx.update(importBatch).set({ status: 'discarded', discardedBy: actor.id, discardedAt: new Date() }).where(eq(importBatch.id, batchId));
    await logAction(actor.id, 'IMPORT_DISCARDED', 'import', batchId, { status: batch.status }, { status: 'discarded' }, ctx, tx);
    return { id: batchId, status: 'discarded' as const };
  });
}
