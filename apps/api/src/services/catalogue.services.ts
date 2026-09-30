/**
 * The exam catalogue (FEATURES_PLAN.md F0b): boards, qualifications (awards),
 * units and components, the unit-to-award map, Cambridge option codes, and
 * what each registrable row (a subject families register for) enters.
 *
 * The coordinator and admin edit it; every change is audited in its own
 * transaction. Which board a subject or unit is entered with is data here
 * (owner decision 3: the coordinator's answers change configuration, not
 * code). The school's level codes ("A.S./A.2.") are derived from a unit's
 * own level, the awards it counts toward and the student's year — never
 * stored (@repo/validations level-code.ts).
 *
 * Contracts (FEATURES_PLAN.md §2, docs/features/CATALOGUE.md §7):
 * - F4 reads `entryItemsFor(registrationIds)`: per registration, its board,
 *   board series, qualification, units with their own level, the awards
 *   they count toward, and the derived level code.
 * - F5 reads `getCatalogue()`: qualifications with their level, suite and
 *   subject area (AS and A Level of one subject share it), units and awards.
 * - F7 resolves the school's sheet against the catalogue with
 *   `findRegistrable` and maps rows with `mapRegistrable`.
 */

import {
  db, examBoard, qualification, examUnit, qualificationUnit, qualificationOption, qualificationOptionUnit,
  subject, subjectUnit, registration, boardSeries, sessionBoardSeries, sessionSubjectSeries, registrationSession, user,
  eq, and, inArray, notInArray, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  deriveLevelCode, seriesAcademicYearStart, gradeInAcademicYear, STARTER_SET_DATA, COUNCIL_LABELS,
  type UpdateBoardType, type CreateQualificationType, type UpdateQualificationType, type CreateUnitType,
  type UpdateUnitType, type SetQualificationUnitsType, type CreateQualificationOptionType,
  type UpdateQualificationOptionType, type MapRegistrableType, type StarterSet, type UnitLevel, type LevelCodeReading,
} from '@repo/validations';
import { logAction, logActions, type AuditContext } from './audit.services';
import { getSetting } from './settings.services';
import { boardSeriesName } from './series.services';
import { schoolDate } from './window.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** A refusal with the status the route answers. */
export class CatalogueError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string } | null)?.code === '23505' || (err as { cause?: { code?: string } } | null)?.cause?.code === '23505';

/** Terminal registration states: history, never moved or counted as live. */
export const DONE_REGISTRATION_STATUSES = ['rejected', 'expired', 'dropped'] as const;

async function boardOrThrow(code: string, executor: Executor = db) {
  const [b] = await executor.select().from(examBoard).where(eq(examBoard.code, code));
  if (!b) throw new CatalogueError('Board not found', 404);
  return b;
}

export async function boardNames(executor: Executor = db): Promise<Map<string, string>> {
  const rows = await executor.select({ code: examBoard.code, name: examBoard.name }).from(examBoard);
  return new Map(rows.map((r) => [r.code, r.name]));
}

function boardName(names: Map<string, string>, code: string): string {
  return names.get(code) ?? COUNCIL_LABELS[code as keyof typeof COUNCIL_LABELS] ?? code;
}

// ─── Reading the catalogue ───────────────────────────────────────────────────

/**
 * Everything the Catalogue screen shows, in one read (the catalogue is small:
 * a few boards, tens of qualifications, a hundred units): boards with their
 * counts; qualifications with the units counting toward them and their
 * option codes; units with the awards they count toward; and every
 * registrable row with what it enters and how the school's level code reads.
 */
export async function getCatalogue() {
  const [boards, quals, units, map, options, optionUnits, subjects, subjectUnits, reading] = await Promise.all([
    db.select().from(examBoard).orderBy(asc(examBoard.sortOrder), asc(examBoard.name)),
    db.select().from(qualification).orderBy(asc(qualification.boardCode), asc(qualification.subjectArea), asc(qualification.level), asc(qualification.code)),
    db.select().from(examUnit).orderBy(asc(examUnit.boardCode), asc(examUnit.code)),
    db.select().from(qualificationUnit).orderBy(asc(qualificationUnit.sortOrder)),
    db.select().from(qualificationOption).orderBy(asc(qualificationOption.code)),
    db.select().from(qualificationOptionUnit),
    db.select({
      id: subject.id, name: subject.name, code: subject.code, council: subject.council, qualificationLevel: subject.qualificationLevel,
      isActive: subject.isActive, isOfferedAtSchool: subject.isOfferedAtSchool, qualificationId: subject.qualificationId,
    }).from(subject).orderBy(asc(subject.qualificationLevel), asc(subject.name)),
    db.select().from(subjectUnit),
    getSetting('catalogue.levelCodeReading'),
  ]);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const qualById = new Map(quals.map((q) => [q.id, q]));
  const awardsOfUnit = (unitId: string) =>
    map.filter((m) => m.unitId === unitId).map((m) => qualById.get(m.qualificationId)!).filter(Boolean);

  const registrable = subjects.map((s) => {
    const unitIds = subjectUnits.filter((su) => su.subjectId === s.id).map((su) => su.unitId);
    const rowUnits = unitIds.map((id) => unitById.get(id)!).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code));
    const awardLevels = [...new Set(rowUnits.flatMap((u) => awardsOfUnit(u.id).map((q) => q.level)))];
    const q = s.qualificationId ? qualById.get(s.qualificationId) ?? null : null;
    const unitLevels = rowUnits.map((u) => u.unitLevel as UnitLevel);
    const code = (grade: number, sitsA2: boolean) => deriveLevelCode(
      { qualificationLevel: s.qualificationLevel, unitLevels, awardLevels, gradeInSeriesYear: grade, studentSitsA2InSeries: sitsA2 },
      reading,
    );
    return {
      ...s,
      mapped: !!q || rowUnits.length > 0,
      qualification: q ? { id: q.id, code: q.code, title: q.title, level: q.level, boardCode: q.boardCode } : null,
      units: rowUnits.map((u) => ({ id: u.id, code: u.code, shortCode: u.shortCode, title: u.title, unitLevel: u.unitLevel })),
      countsToward: [...new Map(rowUnits.flatMap((u) => awardsOfUnit(u.id)).map((a) => [a.id, { id: a.id, code: a.code, title: a.title, level: a.level }])).values()],
      // How the school's code reads for this row: a grade-11 student sitting
      // only AS units, and a grade-12 student who also sits A2 units.
      levelCode: { grade11: code(11, false), grade12WithA2: code(12, true) },
    };
  });

  return {
    reading,
    boards: boards.map((b) => ({
      ...b,
      qualificationCount: quals.filter((q) => q.boardCode === b.code).length,
      unitCount: units.filter((u) => u.boardCode === b.code).length,
      registrableCount: subjects.filter((s) => s.council === b.code).length,
    })),
    qualifications: quals.map((q) => ({
      ...q,
      units: map
        .filter((m) => m.qualificationId === q.id)
        .map((m) => {
          const u = unitById.get(m.unitId)!;
          return { unitId: u.id, code: u.code, shortCode: u.shortCode, title: u.title, unitLevel: u.unitLevel, requirement: m.requirement, choiceGroup: m.choiceGroup };
        }),
      options: options
        .filter((o) => o.qualificationId === q.id)
        .map((o) => ({
          ...o,
          units: optionUnits.filter((ou) => ou.optionId === o.id).map((ou) => {
            const u = unitById.get(ou.unitId)!;
            return { unitId: u.id, code: u.code, shortCode: u.shortCode };
          }),
        })),
      registrableCount: subjects.filter((s) => s.qualificationId === q.id).length,
    })),
    units: units.map((u) => ({
      ...u,
      countsToward: awardsOfUnit(u.id).map((q) => ({
        id: q.id, code: q.code, title: q.title, level: q.level,
        requirement: map.find((m) => m.unitId === u.id && m.qualificationId === q.id)!.requirement,
      })),
      registrableCount: subjectUnits.filter((su) => su.unitId === u.id).length,
    })),
    registrable,
    unmappedCount: registrable.filter((r) => !r.mapped).length,
  };
}

// ─── Boards ──────────────────────────────────────────────────────────────────

export async function updateBoard(code: string, data: UpdateBoardType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(examBoard).where(eq(examBoard.code, code)).for('update');
    if (!b) throw new CatalogueError('Board not found', 404);
    if (data.seriesMonths) {
      // A month a series of this board already runs in stays: those series exist.
      const used = await tx.selectDistinct({ month: boardSeries.month }).from(boardSeries).where(eq(boardSeries.boardCode, code));
      const dropped = used.map((u) => u.month).filter((m) => !data.seriesMonths!.includes(m as never));
      if (dropped.length) {
        throw new CatalogueError(`${b.name} already has ${dropped.join(' and ')} series on record — those months stay`, 409);
      }
    }
    const [updated] = await tx.update(examBoard).set({ ...data, updatedAt: new Date() }).where(eq(examBoard.code, code)).returning();
    await logAction(actorId, 'BOARD_UPDATED', 'board', code,
      { name: b.name, shortName: b.shortName, entryPortal: b.entryPortal, seriesMonths: b.seriesMonths, notes: b.notes },
      data as Record<string, unknown>, ctx, tx);
    return updated!;
  });
}

// ─── Qualifications ──────────────────────────────────────────────────────────

export async function createQualification(data: CreateQualificationType, actorId: string, ctx?: AuditContext) {
  await boardOrThrow(data.boardCode);
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(qualification).values({
        id: randomUUID(), boardCode: data.boardCode, code: data.code, title: data.title, level: data.level,
        suite: data.suite, subjectArea: data.subjectArea, entryMethod: data.entryMethod, notes: data.notes ?? null,
      }).returning();
      await logAction(actorId, 'QUALIFICATION_CREATED', 'qualification', created!.id, null, created as Record<string, unknown>, ctx, tx);
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CatalogueError(`The board already has a ${data.level ? levelWord(data.level) + " " : ""}qualification with the code ${data.code}`, 409);
    throw err;
  }
}

export async function updateQualification(id: string, data: UpdateQualificationType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const [q] = await tx.select().from(qualification).where(eq(qualification.id, id)).for('update');
      if (!q) throw new CatalogueError('Qualification not found', 404);
      if (data.level && data.level !== q.level) {
        const [linked] = await tx.select({ name: subject.name }).from(subject).where(eq(subject.qualificationId, id)).limit(1);
        if (linked) throw new CatalogueError(`${linked.name} enters this qualification at its level — change the subject first`, 409);
      }
      const [updated] = await tx.update(qualification).set({ ...data, updatedAt: new Date() }).where(eq(qualification.id, id)).returning();
      await logAction(actorId, 'QUALIFICATION_UPDATED', 'qualification', id, q as Record<string, unknown>, data as Record<string, unknown>, ctx, tx);
      return updated!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CatalogueError(`The board already has a ${data.level ? levelWord(data.level) + " " : ""}qualification with the code ${data.code}`, 409);
    throw err;
  }
}

/**
 * The units counting toward an award, replacing the set: each of the same
 * board, IGCSE components for an IGCSE award, AS and A2 units for AS and A
 * Level awards. A unit an option code enters stays on its award.
 */
export async function setQualificationUnits(id: string, data: SetQualificationUnitsType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(qualification).where(eq(qualification.id, id)).for('update');
    if (!q) throw new CatalogueError('Qualification not found', 404);
    const ids = data.units.map((u) => u.unitId);
    const units = ids.length ? await tx.select().from(examUnit).where(inArray(examUnit.id, ids)) : [];
    if (units.length !== ids.length) throw new CatalogueError('One or more units were not found', 404);
    const foreign = units.filter((u) => u.boardCode !== q.boardCode);
    if (foreign.length) throw new CatalogueError(`${foreign.map((u) => u.code).join(', ')} belong to another board than ${q.code}`);
    const wrongLevel = units.filter((u) => (q.level === 'igcse') !== (u.unitLevel === 'igcse'));
    if (wrongLevel.length) {
      throw new CatalogueError(`${wrongLevel.map((u) => u.code).join(', ')} ${q.level === 'igcse' ? 'are AS or A2 units, not IGCSE components' : 'are IGCSE components, not AS or A2 units'}`);
    }
    if (q.level === 'as_level') {
      const a2 = units.filter((u) => u.unitLevel === 'a2');
      if (a2.length) throw new CatalogueError(`${a2.map((u) => u.code).join(', ')} are A2 units: they count toward an A Level, not an AS`);
    }
    // Components an option code of this award enters must stay on it.
    const optionUnits = await tx
      .select({ unitId: qualificationOptionUnit.unitId, option: qualificationOption.code })
      .from(qualificationOptionUnit)
      .innerJoin(qualificationOption, eq(qualificationOption.id, qualificationOptionUnit.optionId))
      .where(eq(qualificationOption.qualificationId, id));
    const needed = optionUnits.filter((o) => !ids.includes(o.unitId));
    if (needed.length) {
      throw new CatalogueError(`Option ${needed[0]!.option} enters a component you are removing — change the option first`, 409);
    }
    const before = await tx.select().from(qualificationUnit).where(eq(qualificationUnit.qualificationId, id));
    await tx.delete(qualificationUnit).where(eq(qualificationUnit.qualificationId, id));
    if (data.units.length) {
      await tx.insert(qualificationUnit).values(data.units.map((u, i) => ({
        id: randomUUID(), qualificationId: id, unitId: u.unitId, requirement: u.requirement, choiceGroup: u.choiceGroup ?? null, sortOrder: i,
      })));
    }
    await logAction(actorId, 'QUALIFICATION_UNITS_SET', 'qualification', id,
      { units: before.map((b) => ({ unitId: b.unitId, requirement: b.requirement, choiceGroup: b.choiceGroup })) },
      { units: data.units }, ctx, tx);
    return { qualificationId: id, units: data.units.length };
  });
}

// ─── Units ───────────────────────────────────────────────────────────────────

export async function createUnit(data: CreateUnitType, actorId: string, ctx?: AuditContext) {
  await boardOrThrow(data.boardCode);
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(examUnit).values({
        id: randomUUID(), boardCode: data.boardCode, code: data.code, shortCode: data.shortCode ?? null, title: data.title,
        unitLevel: data.unitLevel, kind: data.kind, notes: data.notes ?? null,
      }).returning();
      await logAction(actorId, 'EXAM_UNIT_CREATED', 'exam_unit', created!.id, null, created as Record<string, unknown>, ctx, tx);
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CatalogueError(`The board already has a unit with the code ${data.code}`, 409);
    throw err;
  }
}

export async function updateUnit(id: string, data: UpdateUnitType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const [u] = await tx.select().from(examUnit).where(eq(examUnit.id, id)).for('update');
      if (!u) throw new CatalogueError('Unit not found', 404);
      if (data.unitLevel && data.unitLevel !== u.unitLevel) {
        // Its level decides which awards it may count toward.
        const awards = await tx.select({ code: qualification.code, level: qualification.level })
          .from(qualificationUnit).innerJoin(qualification, eq(qualification.id, qualificationUnit.qualificationId))
          .where(eq(qualificationUnit.unitId, id));
        const clash = awards.find((a) => (a.level === 'igcse') !== (data.unitLevel === 'igcse') || (a.level === 'as_level' && data.unitLevel === 'a2'));
        if (clash) throw new CatalogueError(`${u.code} counts toward ${clash.code}, which a ${data.unitLevel === 'a2' ? 'A2' : data.unitLevel === 'as' ? 'AS' : 'IGCSE'} unit cannot — change the award's units first`, 409);
      }
      const [updated] = await tx.update(examUnit).set({ ...data, updatedAt: new Date() }).where(eq(examUnit.id, id)).returning();
      await logAction(actorId, 'EXAM_UNIT_UPDATED', 'exam_unit', id, u as Record<string, unknown>, data as Record<string, unknown>, ctx, tx);
      return updated!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CatalogueError(`The board already has a unit with the code ${data.code}`, 409);
    throw err;
  }
}

// ─── Cambridge option codes ──────────────────────────────────────────────────

async function assertOptionUnits(tx: Tx, qualificationId: string, unitIds: string[]) {
  if (!unitIds.length) return;
  const onAward = await tx.select({ unitId: qualificationUnit.unitId }).from(qualificationUnit)
    .where(and(eq(qualificationUnit.qualificationId, qualificationId), inArray(qualificationUnit.unitId, unitIds)));
  if (onAward.length !== unitIds.length) {
    throw new CatalogueError('An option enters components of its own syllabus: add them to the qualification first');
  }
}

export async function createOption(qualificationId: string, data: CreateQualificationOptionType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const [q] = await tx.select().from(qualification).where(eq(qualification.id, qualificationId)).for('update');
      if (!q) throw new CatalogueError('Qualification not found', 404);
      await assertOptionUnits(tx, qualificationId, data.unitIds);
      const [created] = await tx.insert(qualificationOption).values({
        id: randomUUID(), qualificationId, code: data.code, label: data.label, carryForward: data.carryForward, notes: data.notes ?? null,
      }).returning();
      if (data.unitIds.length) {
        await tx.insert(qualificationOptionUnit).values(data.unitIds.map((unitId) => ({ optionId: created!.id, unitId })));
      }
      await logAction(actorId, 'QUALIFICATION_OPTION_CREATED', 'qualification_option', created!.id, null, { ...created, unitIds: data.unitIds }, ctx, tx);
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CatalogueError(`This syllabus already has option ${data.code}`, 409);
    throw err;
  }
}

export async function updateOption(id: string, data: UpdateQualificationOptionType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const [o] = await tx.select().from(qualificationOption).where(eq(qualificationOption.id, id)).for('update');
      if (!o) throw new CatalogueError('Option not found', 404);
      const { unitIds, ...fields } = data;
      if (unitIds) {
        await assertOptionUnits(tx, o.qualificationId, unitIds);
        await tx.delete(qualificationOptionUnit).where(eq(qualificationOptionUnit.optionId, id));
        if (unitIds.length) await tx.insert(qualificationOptionUnit).values(unitIds.map((unitId) => ({ optionId: id, unitId })));
      }
      const [updated] = await tx.update(qualificationOption).set({ ...fields, updatedAt: new Date() }).where(eq(qualificationOption.id, id)).returning();
      await logAction(actorId, 'QUALIFICATION_OPTION_UPDATED', 'qualification_option', id, o as Record<string, unknown>, data as Record<string, unknown>, ctx, tx);
      return updated!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CatalogueError(`This syllabus already has option ${data.code}`, 409);
    throw err;
  }
}

// ─── Registrable rows ────────────────────────────────────────────────────────

/**
 * Record what a registrable row enters with the board: its board, the award
 * it enters or counts toward, and its units (a unit "P1", a paper set
 * "Biology (Paper 1 & Paper 2)"). The award and units must be of that board
 * and at the row's level.
 *
 * Changing the board is the coordinator's answer to "which board is it
 * entered with?" (IS-14): see applyBoardChange. The row's live registrations
 * move to their window's default series of the new board, and a window's
 * route for the subject (to a series of the old board) is re-pointed to that
 * default, in the same transaction, audited. Refused, with nothing changed,
 * when a window has no series of the new board, when a registration's
 * series is past its entry deadline (its entry is made), or when the
 * registrations or the route would land in a series whose deadline has passed
 * or differs from the one they are in now (MO-10: a board change never moves
 * an entry across deadlines).
 */
export async function mapRegistrable(subjectId: string, data: MapRegistrableType, actorId: string, ctx?: AuditContext) {
  const names = await boardNames();
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(subject).where(eq(subject.id, subjectId)).for('update');
    if (!s) throw new CatalogueError('Subject not found', 404);
    await boardOrThrow(data.boardCode, tx);

    let q: typeof qualification.$inferSelect | undefined;
    if (data.qualificationId) {
      [q] = await tx.select().from(qualification).where(eq(qualification.id, data.qualificationId));
      if (!q) throw new CatalogueError('Qualification not found', 404);
      if (q.boardCode !== data.boardCode) throw new CatalogueError(`${q.code} is a ${boardName(names, q.boardCode)} qualification, not ${boardName(names, data.boardCode)}`);
      if (q.level !== s.qualificationLevel) {
        throw new CatalogueError(`${s.name} is registered at ${levelWord(s.qualificationLevel)}; ${q.code} is ${levelWord(q.level)}`);
      }
    }
    const units = data.unitIds.length ? await tx.select().from(examUnit).where(inArray(examUnit.id, data.unitIds)) : [];
    if (units.length !== data.unitIds.length) throw new CatalogueError('One or more units were not found', 404);
    const foreign = units.filter((u) => u.boardCode !== data.boardCode);
    if (foreign.length) throw new CatalogueError(`${foreign.map((u) => u.code).join(', ')} belong to another board than ${boardName(names, data.boardCode)}`);
    const wrongLevel = units.filter((u) => (s.qualificationLevel === 'igcse') !== (u.unitLevel === 'igcse'));
    if (wrongLevel.length) {
      throw new CatalogueError(`${wrongLevel.map((u) => u.code).join(', ')} ${s.qualificationLevel === 'igcse' ? 'are AS or A2 units' : 'are IGCSE components'}: ${s.name} is registered at ${levelWord(s.qualificationLevel)}`);
    }
    // An AS row enters AS units only; an A Level row may mix AS and A2 papers ("Paper 3 & Paper 4").
    const a2OnAs = s.qualificationLevel === 'as_level' ? units.filter((u) => u.unitLevel === 'a2') : [];
    if (a2OnAs.length) {
      throw new CatalogueError(`${a2OnAs.map((u) => u.code).join(', ')} are A2 units: ${s.name} is registered at AS Level, which enters AS units only`);
    }
    if (q && units.length) {
      const onAward = await tx.select({ unitId: qualificationUnit.unitId }).from(qualificationUnit)
        .where(and(eq(qualificationUnit.qualificationId, q.id), inArray(qualificationUnit.unitId, data.unitIds)));
      const off = units.filter((u) => !onAward.some((o) => o.unitId === u.id));
      if (off.length) throw new CatalogueError(`${off.map((u) => u.code).join(', ')} do not count toward ${q.code}`);
    }

    const before = await tx.select({ unitId: subjectUnit.unitId }).from(subjectUnit).where(eq(subjectUnit.subjectId, subjectId));
    // The board changes: its live registrations follow it (IS-14).
    const moved = s.council !== data.boardCode ? await applyBoardChange(tx, s, data.boardCode, actorId, names) : [];
    await tx.update(subject).set({ qualificationId: q?.id ?? null, updatedAt: new Date() }).where(eq(subject.id, subjectId));
    await tx.delete(subjectUnit).where(eq(subjectUnit.subjectId, subjectId));
    if (data.unitIds.length) await tx.insert(subjectUnit).values(data.unitIds.map((unitId) => ({ subjectId, unitId })));

    await logAction(actorId, 'SUBJECT_CATALOGUE_MAPPED', 'subject', subjectId,
      { council: s.council, qualificationId: s.qualificationId, unitIds: before.map((b) => b.unitId) },
      { council: data.boardCode, qualificationId: q?.id ?? null, unitIds: data.unitIds, registrationsMoved: moved.length, reason: data.reason ?? null },
      ctx, tx);
    return { subjectId, boardCode: data.boardCode, qualificationId: q?.id ?? null, unitIds: data.unitIds, registrationsMoved: moved.length };
  });
}

function levelWord(level: string): string {
  return level === 'igcse' ? 'IGCSE' : level === 'as_level' ? 'AS Level' : 'A Level';
}

/**
 * Change a subject's board in the caller's transaction (the subject row
 * locked FOR UPDATE by the caller): its live registrations move to their
 * windows' default series of the new board and the windows' routes for it are
 * re-pointed there, each audited; its catalogue links — the old board's award
 * and units — are cleared unless the caller sets new ones. Refused, with
 * nothing changed, by followBoardChange's rules. The subject screen's board
 * field and the Catalogue's mapping both come here.
 *
 * Locks, in order: the subject (caller), its live registrations (id order),
 * the windows' routes for it, the windows' series links, the series involved
 * (id order). A registration reads the subject FOR SHARE before routing, and
 * a change to a window's series reads its routed subjects FOR SHARE before
 * its links, so each waits for the other rather than crossing it.
 */
export async function applyBoardChange(
  tx: Tx, s: typeof subject.$inferSelect, newBoard: string, actorId: string | null, names?: Map<string, string>,
) {
  const boardNamesNow = names ?? (await boardNames(tx));
  await boardOrThrow(newBoard, tx);
  const { moved, routes } = await followBoardChange(tx, s, newBoard, boardNamesNow);
  await tx.update(subject).set({ council: newBoard, qualificationId: null, updatedAt: new Date() }).where(eq(subject.id, s.id));
  await tx.delete(subjectUnit).where(eq(subjectUnit.subjectId, s.id));
  const why = `The subject's board changed to ${boardName(boardNamesNow, newBoard)}`;
  if (moved.length) {
    for (const m of moved) {
      await tx.update(registration).set({ boardSeriesId: m.to, updatedAt: new Date() }).where(eq(registration.id, m.id));
    }
    await logActions(moved.map((m) => ({
      userId: actorId, action: 'REGISTRATION_SERIES_MOVED' as const, entityType: 'registration' as const, entityId: m.id,
      previousData: { boardSeriesId: m.from }, newData: { boardSeriesId: m.to, reason: why },
    })), tx);
  }
  // A route to the new board's default is no route at all: the default applies.
  for (const r of routes) {
    await tx.delete(sessionSubjectSeries).where(and(eq(sessionSubjectSeries.sessionId, r.sessionId), eq(sessionSubjectSeries.subjectId, s.id)));
  }
  if (routes.length) {
    await logActions(routes.map((r) => ({
      userId: actorId, action: 'SUBJECT_ROUTE_MOVED' as const, entityType: 'session' as const, entityId: r.sessionId,
      previousData: { subjectId: s.id, boardSeriesId: r.from }, newData: { subjectId: s.id, boardSeriesId: r.to, reason: why },
    })), tx);
  }
  return moved;
}

const sameDeadline = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
const deadlineText = (d: Date | null) => (d ? schoolDate(d) : 'none set');

/**
 * Where a subject's live registrations and its windows' routes go when its
 * board changes: each window's default series of the new board. Refuses,
 * naming the first obstacle:
 * - a registration's series is past its entry deadline (its entry is made);
 * - a window with a live registration or a route for the subject feeds no
 *   series of the new board;
 * - the series they would go to is past its entry deadline, or has another
 *   deadline than the one they are in (MO-10: as the admin's move refuses a
 *   passed target; a board change also keeps the deadline, so no checkout or
 *   refund is judged against a date the family was not given).
 */
async function followBoardChange(tx: Tx, s: typeof subject.$inferSelect, newBoard: string, names: Map<string, string>) {
  const live = await tx
    .select({ id: registration.id, sessionId: registration.sessionId, boardSeriesId: registration.boardSeriesId })
    .from(registration)
    .where(and(eq(registration.subjectId, s.id), notInArray(registration.status, [...DONE_REGISTRATION_STATUSES])))
    .orderBy(registration.id)
    .for('update');
  const routeRows = await tx.select().from(sessionSubjectSeries).where(eq(sessionSubjectSeries.subjectId, s.id))
    .orderBy(sessionSubjectSeries.sessionId).for('update');
  const sessionIds = [...new Set([...live.map((r) => r.sessionId), ...routeRows.map((r) => r.sessionId)])];
  if (!sessionIds.length) return { moved: [], routes: [] };

  const links = await tx
    .select({ sessionId: sessionBoardSeries.sessionId, boardSeriesId: sessionBoardSeries.boardSeriesId, isDefault: sessionBoardSeries.isDefault, boardCode: sessionBoardSeries.boardCode })
    .from(sessionBoardSeries).where(inArray(sessionBoardSeries.sessionId, sessionIds)).for('share');
  const targets = new Map(links.filter((l) => l.boardCode === newBoard && l.isDefault).map((l) => [l.sessionId, l.boardSeriesId]));
  // Every series involved, read FOR SHARE: a deadline changing at the same moment waits for this.
  const seriesIds = [...new Set([
    ...live.map((r) => r.boardSeriesId), ...routeRows.map((r) => r.boardSeriesId), ...targets.values(),
  ].filter((x): x is string => !!x))];
  const seriesRows = seriesIds.length
    ? await tx.select().from(boardSeries).where(inArray(boardSeries.id, seriesIds)).orderBy(boardSeries.id).for('share')
    : [];
  const seriesBy = new Map(seriesRows.map((r) => [r.id, r]));
  const windowNames = new Map((await tx.select({ id: registrationSession.id, name: registrationSession.name }).from(registrationSession)
    .where(inArray(registrationSession.id, sessionIds))).map((w) => [w.id, w.name]));
  const wName = (id: string) => windowNames.get(id) ?? 'A window';
  const sName = (id: string) => boardSeriesName(names, seriesBy.get(id)!);
  const now = new Date();

  const passed = live
    .map((r) => (r.boardSeriesId ? seriesBy.get(r.boardSeriesId) : undefined))
    .find((x) => x?.entryDeadline && x.entryDeadline <= now);
  if (passed) {
    throw new CatalogueError(
      `${s.name} is already entered with ${boardName(names, passed.boardCode)} in ${boardSeriesName(names, passed)}, whose entry deadline has passed — its board cannot change now. Make a new subject for the new board.`,
      409,
    );
  }

  const moved: { id: string; from: string | null; to: string }[] = [];
  const routes: { sessionId: string; from: string; to: string }[] = [];
  for (const sessionId of sessionIds) {
    if (!links.some((l) => l.sessionId === sessionId)) continue; // a window feeding no series routes nothing
    const regs = live.filter((r) => r.sessionId === sessionId);
    const route = routeRows.find((r) => r.sessionId === sessionId);
    const target = targets.get(sessionId);
    if (!target) {
      throw new CatalogueError(
        regs.length
          ? `${wName(sessionId)} has ${regs.length} registration${regs.length === 1 ? '' : 's'} for ${s.name} and feeds no ${boardName(names, newBoard)} series — add one to the window first`
          : `${wName(sessionId)} enters ${s.name} in ${sName(route!.boardSeriesId)} and feeds no ${boardName(names, newBoard)} series — add one to the window first`,
        409,
      );
    }
    const t = seriesBy.get(target)!;
    const sources = [...new Set([
      ...regs.map((r) => r.boardSeriesId).filter((x): x is string => !!x), ...(route ? [route.boardSeriesId] : []),
    ])].filter((id) => id !== target);
    if (sources.length) {
      if (t.entryDeadline && t.entryDeadline <= now) {
        throw new CatalogueError(
          `${sName(target)} is past its entry deadline (${schoolDate(t.entryDeadline)}): ${s.name} cannot be moved into it in ${wName(sessionId)}`,
          409,
        );
      }
      const differs = sources.find((id) => !sameDeadline(seriesBy.get(id)!.entryDeadline, t.entryDeadline));
      if (differs) {
        throw new CatalogueError(
          `In ${wName(sessionId)}, ${s.name} is entered in ${sName(differs)} (entry deadline ${deadlineText(seriesBy.get(differs)!.entryDeadline)}) and would move to ${sName(target)} (entry deadline ${deadlineText(t.entryDeadline)}): a board change keeps the entry deadline — give the two series the same deadline first`,
          409,
        );
      }
    }
    for (const r of regs) if (r.boardSeriesId !== target) moved.push({ id: r.id, from: r.boardSeriesId, to: target });
    if (route && route.boardSeriesId !== target) routes.push({ sessionId, from: route.boardSeriesId, to: target });
  }
  return { moved, routes };
}

/** A registrable row by the name the school's sheet uses, or its code (F7). */
export async function findRegistrable(term: string) {
  const t = term.trim();
  const rows = await db.select({ id: subject.id, name: subject.name, code: subject.code, council: subject.council, qualificationLevel: subject.qualificationLevel })
    .from(subject)
    .where(sql`lower(${subject.code}) = lower(${t}) or lower(${subject.name}) = lower(${t})`);
  return rows;
}

// ─── Starter sets ────────────────────────────────────────────────────────────

/**
 * Add a starter set the research confirmed (DISCOVERY_RESEARCH.md §1–2):
 * units and awards not yet in the catalogue are added with their map; what
 * is there already is left as it is. Loading it twice changes nothing.
 */
export async function loadStarterSet(set: StarterSet, actorId: string, ctx?: AuditContext) {
  const data = STARTER_SET_DATA[set];
  return db.transaction(async (tx) => {
    // One load at a time: the board row is the lock.
    await tx.select({ code: examBoard.code }).from(examBoard).where(eq(examBoard.code, data.boardCode)).for('update');
    const note = 'Starter set from the research (DISCOVERY_RESEARCH.md §2) — check it against the board\'s current specification.';
    const addedUnits = await tx.insert(examUnit).values(data.units.map((u) => ({
      id: randomUUID(), boardCode: data.boardCode, code: u.code, shortCode: u.shortCode, title: u.title, unitLevel: u.unitLevel, kind: 'unit', notes: note,
    }))).onConflictDoNothing().returning({ id: examUnit.id });
    const units = await tx.select({ id: examUnit.id, code: examUnit.code }).from(examUnit)
      .where(and(eq(examUnit.boardCode, data.boardCode), inArray(examUnit.code, data.units.map((u) => u.code))));
    const unitId = new Map(units.map((u) => [u.code, u.id]));
    let addedAwards = 0;
    for (const a of data.awards) {
      const [created] = await tx.insert(qualification).values({
        id: randomUUID(), boardCode: data.boardCode, code: a.code, title: a.title, level: a.level, suite: data.suite,
        subjectArea: a.subjectArea, entryMethod: 'units_cash_in', notes: note,
      }).onConflictDoNothing().returning({ id: qualification.id });
      if (!created) continue; // an award already there keeps its own map
      addedAwards++;
      await tx.insert(qualificationUnit).values(a.units.map((u, i) => ({
        id: randomUUID(), qualificationId: created.id, unitId: unitId.get(u.code)!, requirement: u.requirement, choiceGroup: u.choiceGroup ?? null, sortOrder: i,
      })));
    }
    if (addedUnits.length || addedAwards) {
      await logAction(actorId, 'CATALOGUE_STARTER_LOADED', 'board', data.boardCode, null,
        { set, unitsAdded: addedUnits.length, awardsAdded: addedAwards }, ctx, tx);
    }
    return { set, unitsAdded: addedUnits.length, awardsAdded: addedAwards };
  });
}

// ─── What a registration enters (F4's contract) ──────────────────────────────

/**
 * Per registration: what it enters with the board and how the school's code
 * reads for it — the board, the board series (with its entry deadline), the
 * qualification, the units with their own level, the awards those units
 * count toward, the student's grade in the series' academic year, and the
 * derived level code under the school's current reading. F4 derives its
 * entries per component from this; the screens show the code.
 */
export async function entryItemsFor(registrationIds: string[], readingOverride?: LevelCodeReading) {
  if (!registrationIds.length) return [];
  const regs = await db.query.registration.findMany({
    where: (r, { inArray: inArr }) => inArr(r.id, registrationIds),
    columns: { id: true, studentId: true, sessionId: true, subjectId: true, status: true, boardSeriesId: true },
    with: {
      student: { columns: { id: true, cohortYear: true } },
      session: { columns: { id: true, sessionType: true, seriesYear: true } },
      subject: {
        columns: { id: true, name: true, code: true, council: true, qualificationLevel: true },
        with: {
          qualification: { columns: { id: true, code: true, title: true, level: true, entryMethod: true } },
          units: { with: { unit: { columns: { id: true, code: true, shortCode: true, title: true, unitLevel: true } } } },
        },
      },
      boardSeries: { columns: { id: true, boardCode: true, month: true, year: true, label: true, entryDeadline: true } },
    },
  });
  const reading = readingOverride ?? (await getSetting('catalogue.levelCodeReading'));
  const unitIds = [...new Set(regs.flatMap((r) => r.subject.units.map((u) => u.unit.id)))];
  const awards = unitIds.length
    ? await db.select({ unitId: qualificationUnit.unitId, id: qualification.id, code: qualification.code, title: qualification.title, level: qualification.level })
        .from(qualificationUnit).innerJoin(qualification, eq(qualification.id, qualificationUnit.qualificationId))
        .where(inArray(qualificationUnit.unitId, unitIds))
    : [];
  // Whether each student sits any A2 unit in the same series (the default reading).
  const seriesIds = [...new Set(regs.map((r) => r.boardSeriesId ?? `session:${r.sessionId}`))];
  const studentIds = [...new Set(regs.map((r) => r.studentId))];
  const a2Rows = studentIds.length
    ? (await db.execute(sql`
        select distinct r.student_id, coalesce(r.board_series_id, 'session:' || r.session_id) as series
        from registration r
        join subject_unit su on su.subject_id = r.subject_id
        join exam_unit u on u.id = su.unit_id and u.unit_level = 'a2'
        where r.student_id in (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})
          and r.status not in ('rejected', 'expired', 'dropped')
      `)).rows as { student_id: string; series: string }[]
    : [];
  const sitsA2 = new Set(a2Rows.filter((r) => seriesIds.includes(r.series)).map((r) => `${r.student_id}|${r.series}`));
  const names = await boardNames();

  return regs.map((r) => {
    const seriesKey = r.boardSeriesId ?? `session:${r.sessionId}`;
    const ay = seriesAcademicYearStart(r.session.sessionType, r.session.seriesYear);
    const grade = gradeInAcademicYear(r.student.cohortYear, ay);
    const units = r.subject.units.map((u) => u.unit).sort((a, b) => a.code.localeCompare(b.code));
    const counts = awards.filter((a) => units.some((u) => u.id === a.unitId));
    const levelCode = deriveLevelCode({
      qualificationLevel: r.subject.qualificationLevel,
      unitLevels: units.map((u) => u.unitLevel as UnitLevel),
      awardLevels: [...new Set(counts.map((a) => a.level))],
      gradeInSeriesYear: grade,
      studentSitsA2InSeries: sitsA2.has(`${r.studentId}|${seriesKey}`),
    }, reading);
    return {
      registrationId: r.id,
      studentId: r.studentId,
      status: r.status,
      boardCode: r.subject.council,
      boardName: boardName(names, r.subject.council),
      boardSeries: r.boardSeries ? { ...r.boardSeries, name: boardSeriesName(names, r.boardSeries) } : null,
      subject: { id: r.subject.id, name: r.subject.name, code: r.subject.code, qualificationLevel: r.subject.qualificationLevel },
      qualification: r.subject.qualification,
      units,
      countsToward: [...new Map(counts.map((a) => [a.id, { id: a.id, code: a.code, title: a.title, level: a.level }])).values()],
      gradeInSeriesYear: grade,
      levelCode,
    };
  });
}

/** The live registrations of a window with what each enters (the window's series panel). */
export async function entryItemsForWindow(sessionId: string) {
  const regs = await db.select({ id: registration.id }).from(registration)
    .where(and(eq(registration.sessionId, sessionId), notInArray(registration.status, [...DONE_REGISTRATION_STATUSES])));
  const items = await entryItemsFor(regs.map((r) => r.id));
  const students = items.length
    ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(items.map((i) => i.studentId))]))
    : [];
  const nameOf = new Map(students.map((s) => [s.id, s.name]));
  return items
    .map((i) => ({ ...i, studentName: nameOf.get(i.studentId) ?? '' }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName) || a.subject.name.localeCompare(b.subject.name));
}
