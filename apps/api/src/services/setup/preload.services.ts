/**
 * The June 2027 pre-load (COORDINATOR_REWORK.md §8, §11; P0's packages/db/seeds/june-2027.json): the
 * session she copies June 2028 from, loaded through the coordinator's own set-up services — so what it
 * makes is exactly what her screens would save (the derived labels, groups, sittings, the old columns
 * kept in step, the audit rows) — and only when asked (`pnpm --filter @repo/api seed:june-2027`).
 *
 * Each offering from the reference list by its code; its teachers by placeholder key (the git-ignored
 * local file names them; absent, the placeholder is the name), external teams as providers; its rows'
 * cells, exam fees as the seed gives them (a fee read on a list keeps the source 'list'), course fees,
 * carried-from sittings and own teachers. The seed's notes (§8's flags) and the cells a §3 default ticked
 * (`cellsByDefault`, Q10) go to the session's check list for her review.
 *
 * Idempotent: a session of the seed's type, year and label already there is left as it is.
 */

import { db, registrationSession, teacher, sessionOffer, sessionOfferItem, and, eq } from '@repo/db';
import { randomUUID } from 'crypto';
import type { SessionSeedFile, LocalTeachersFile } from '@repo/validations';
import { logAction } from '../audit.services';
import { createSetupSession, updateSetupSession } from './session-setup.services';
import { addOffering, updateOffering, SetupError } from './offering.services';
import { NO_CELLS } from './model';

const MONTH_NAME: Record<number, 'january' | 'june' | 'october' | 'november'> = { 1: 'january', 6: 'june', 10: 'october', 11: 'november' };

/** "{T-ESL-2}" placeholders in a note, named when the local file has them. */
const resolve = (text: string, names: LocalTeachersFile | null) => text.replace(/\{(T-[A-Z0-9-]+)\}/g, (_, key: string) => names?.[key] ?? key);

export async function loadSessionSeed(seed: SessionSeedFile, names: LocalTeachersFile | null, actorId: string, opts: { label?: string } = {}) {
  const label = opts.label ?? '';
  const [existing] = await db.select({ id: registrationSession.id }).from(registrationSession)
    .where(and(eq(registrationSession.sessionType, seed.session.type), eq(registrationSession.seriesYear, seed.session.year), eq(registrationSession.label, label)));
  if (existing) return { sessionId: existing.id, created: false, offerings: 0 };

  const session = (await createSetupSession({ type: seed.session.type, year: seed.session.year, label }, actorId))!;
  const cairoEnd = (d: string) => new Date(`${d}T20:59:00Z`);
  await updateSetupSession(session.id, {
    refundPolicy: seed.session.refundPolicy,
    selfStudyPercent: seed.session.selfStudyPercent,
    ...(seed.session.closesAt ? { closesAt: cairoEnd(seed.session.closesAt) } : {}),
    ...(seed.session.paymentDueAt ? { paymentDueAt: cairoEnd(seed.session.paymentDueAt) } : {}),
    ...(seed.session.courseStartsOn ? { courseStartsOn: seed.session.courseStartsOn } : {}),
  }, actorId).catch((err) => {
    // A session made with the type's defaults already holds the seed's policy and share.
    if (!(err instanceof Error && err.message === 'Nothing to change')) throw err;
  });

  // The teachers, once each, by placeholder key: the local file's name, else the key itself.
  const teacherIds = new Map<string, string>();
  const teacherOf = async (key: string, external: boolean) => {
    if (teacherIds.has(key)) return teacherIds.get(key)!;
    const name = names?.[key] ?? key;
    const [found] = await db.select({ id: teacher.id }).from(teacher).where(and(eq(teacher.name, name), eq(teacher.isActive, true)));
    let id = found?.id;
    if (!id) {
      id = randomUUID();
      await db.insert(teacher).values({ id, name, kind: external ? 'provider' : 'person', isActive: true });
      await logAction(actorId, 'TEACHER_CREATED', 'teacher', id, null, { name, kind: external ? 'provider' : 'person', via: 'the June 2027 pre-load', key }, undefined);
    }
    teacherIds.set(key, id);
    return id;
  };

  let made = 0;
  for (const o of seed.offerings) {
    const offering = await addOffering(session.id, { referenceCode: o.subject, board: o.board }, actorId);
    const byKey = new Map(offering.rows.map((r) => [r.referenceKey, r]));
    const rows = [];
    for (const r of o.rows) {
      const row = byKey.get(r.key);
      if (!row) throw new SetupError(`The pre-load's ${o.board} ${o.subject} names row ${r.key}, which the reference does not give it`, 400);
      rows.push({
        id: row.id, kind: row.kind as 'all_papers', cells: r.cells,
        examFee: r.examFee, examFeeSource: r.examFeeSource === 'list' ? null : r.examFeeSource,
        courseFee: r.courseFee,
        ...(r.allowedPriorSittings ? { allowedPriorSittings: r.allowedPriorSittings.map((p) => ({ month: MONTH_NAME[p.month]!, year: p.year })) } : {}),
        ...(r.teachers ? { teachers: await Promise.all(r.teachers.map(async (t) => ({ teacherId: await teacherOf(t.key, t.external), online: t.online, external: t.external }))) } : {}),
      });
    }
    // The reference's other suggested rows are not on the school's forms: unticked (the add's default ticks undone).
    for (const r of offering.rows.filter((x) => !o.rows.some((y) => y.key === x.referenceKey))) {
      rows.push({ id: r.id, kind: r.kind as 'all_papers', cells: { ...NO_CELLS } });
    }
    const saved = await updateOffering(session.id, offering.id, {
      note: o.note, teacherChoice: o.teacherChoice, teacherTbc: o.teacherTbc, courseFee: o.courseFee,
      teachers: await Promise.all(o.teachers.map(async (t) => ({ teacherId: await teacherOf(t.key, t.external), online: t.online, external: t.external }))),
      rows,
    }, actorId);
    if (!saved.saved) throw new SetupError(`The pre-load's ${o.subject} would affect families (${JSON.stringify(saved.impact)}): it loads only into an empty session`, 409);
    // What the editor's save cannot say: a fee read on a list keeps that source; the cells a default ticked;
    // the notes for her review.
    for (const r of o.rows) {
      const row = byKey.get(r.key)!;
      await db.update(sessionOfferItem).set({
        ...(r.examFeeSource === 'list' ? { examFeeSource: 'list' } : {}),
        cellsByDefault: r.cellsByDefault,
      }).where(eq(sessionOfferItem.id, row.id));
    }
    await db.update(sessionOffer).set({ checkNotes: o.flags.map((f) => resolve(f, names)), sortOrder: o.order - 1 }).where(eq(sessionOffer.id, offering.id));
    made++;
  }
  await logAction(actorId, 'SESSION_UPDATED', 'session', session.id, null,
    { reason: 'The June 2027 pre-load (COORDINATOR_REWORK.md §8), loaded from packages/db/seeds/june-2027.json', offerings: made, teachers: teacherIds.size }, undefined);
  return { sessionId: session.id, created: true, offerings: made };
}

