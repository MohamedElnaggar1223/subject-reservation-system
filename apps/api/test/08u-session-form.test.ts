import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import { admin, staff, onboard, refused, one, sql, refuseAudit, money, lockWaiters, CONSENT, type Client, cairoDateIn } from './helpers';
import { referenceFixture } from './reference-fixture';

/**
 * 08u — the school's forms in the subject editor (COORDINATOR_REWORK.md D2–D10, §6; rewritten for P1a from
 * F6a's one-form-per-subject route, `PUT /sessions/:id/offers/:offerId/form`, which is deprecated).
 *
 * The shapes the school's forms have (SCHOOL_FORMS.md §2), each saved whole through
 * `PUT /sessions/:id/offerings/:offeringId` and read back as the family page reads it (the preview):
 *
 * - an O.L. subject with its teachers (one online) and its one-paper retake opened in school and in self
 *   study at its own course fee — one save, each change audited once;
 * - a paper the reference list does not suggest, added by her with its code: one choice with all papers,
 *   a retake only; the same save sent twice makes nothing twice;
 * - an International A Level by unit: a teacher per unit (one online), a unit in self study only at its own
 *   course fee, the qualification not this cycle; units combine freely;
 * - decision 2 in her words: a winter row sits in November or January, and an International A Level's
 *   November is the board's October sitting; a June session's rows sit in June;
 * - a row's sitting does not move while reservations use it (§6), nothing moved;
 * - a Cambridge A level's three routes (A.S., A.2. carried forward in self study, A.L. not this cycle);
 * - "Retake (Self Study ONLY)" at a course fee of 0 (a price set: the exam fee alone); a subject taught in
 *   school with no teacher named is on the check list, not refused;
 * - a form saved again as it stands changes nothing and writes no audit row; a save whose audit row cannot
 *   be written changes nothing;
 * - "One paper ONLY" is always a retake, at the reservation too;
 * - the preview: the family page with no student's data in it, for set-up's readers; refused to families.
 *
 * Moved elsewhere: a one-paper retake's exam fee by its board's rule (F8-05) is 08za's; "not offered this
 * cycle" while reservations stand (a cell they use stays ticked; close the subject instead) is 08y's.
 * Retired: F8-04's second qualification on a subject's form — a second board's award is its own
 * offering, added from the reference list by its code.
 */

const RUN = Math.random().toString(36).slice(2, 6);
/** This academic year's June (Y) and winter (W = Y − 1: November W, January W + 1). */
const Y = academicYearStartOf() + 1;
const W = Y - 1;
const day = 86_400_000;
const cells = (first: boolean, retakeInSchool: boolean, retakeSelfStudy: boolean, firstSelfStudy = false) => ({ firstInSchool: first, retakeInSchool, retakeSelfStudy, firstSelfStudy });
const NONE = cells(false, false, false);

describe("08u: the school's forms in the subject editor", () => {
  let adm: Client, coordinator: Client, officer: Client, finadmin: Client;
  let teacherA: string, teacherB: string;
  let june: string, winter: string, winterFar: string;
  const offering: Record<string, string> = {};

  type Body = Parameters<Client['api']['v1']['sessions'][':id']['offerings'][':offeringId']['$put']>[0]['json'];
  const put = (who: Client, sessionId: string, offeringId: string, json: Body) =>
    who.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: sessionId, offeringId }, json });
  const view = (sessionId: string, offeringId: string) =>
    apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$get({ param: { id: sessionId, offeringId } }));
  const add = (sessionId: string, json: Parameters<Client['api']['v1']['sessions'][':id']['offerings']['$post']>[0]['json']) =>
    apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: sessionId }, json }));
  const preview = (who: Client, sessionId: string, offeringId?: string) =>
    who.api.v1.sessions[':id'].preview.$get({ param: { id: sessionId }, query: { as: 'first_timer', ...(offeringId ? { offeringId } : {}) } });
  const familyRows = async (sessionId: string, offeringId: string) =>
    (await apiResponse(preview(coordinator, sessionId, offeringId))).offerings.find((o) => o.id === offeringId)?.rows ?? [];
  const options = (rows: Awaited<ReturnType<typeof familyRows>>) =>
    rows.map((r) => [r.label.en, r.options.map((o) => `${o.attempt} ${o.mode} ${o.price?.total ?? 'not set'}`)]);
  const auditCount = async (ids: string[]) => Number((await one<{ n: string }>(`select count(*) as n from audit_log where entity_id in $1`, [ids])).n);
  const rowOf = <R extends { referenceKey: string | null }>(o: { rows: R[] }, key: string) => o.rows.find((r) => r.referenceKey === key)!;
  const reserve = (f: { parent: Client; studentId: string }, sessionId: string, lines: { offerItemId: string; attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study'; teacherId?: string; priorSittingSeriesId?: string }[]) =>
    f.parent.api.v1.registrations.direct.$post({ json: { sessionId, studentId: f.studentId, lines, consent: CONSENT } });

  /** C6's exception, then the switch: every sitting the session uses gets its board date from the admin; she opens it. */
  async function open(sessionId: string) {
    const s = await apiResponse(coordinator.api.v1.sessions[':id'].$get({ param: { id: sessionId } }));
    for (const c of s.checkList.filter((x) => x.code === 'sitting_no_board_date')) {
      await apiResponse(adm.api.v1.reference.sittings[':id']['board-date'].$put({ param: { id: c.seriesId! }, json: { entryDeadline: cairoDateIn(60) } }));
    }
    expect((await apiResponse(coordinator.api.v1.sessions[':id'].open.$post({ param: { id: sessionId } }))).status).toBe('active');
  }

  beforeAll(async () => {
    adm = await admin(`u08-${RUN}`);
    coordinator = await staff(adm, 'coordinator', `u08-${RUN}`);
    officer = await staff(adm, 'finance_officer', `u08-${RUN}`);
    finadmin = await staff(adm, 'finance_admin', `u08-${RUN}`);
    // The reference list as the seed loads it (idempotent; 08y proves the load itself).
    const { db, loadReference } = await import('@repo/db');
    await loadReference(db, referenceFixture());
    // Invented names (no teacher's name is committed), confirmed new: the duplicate check is 08y's to prove, and
    // another file's teacher may share a first name.
    teacherA = (await apiResponse(coordinator.api.v1.teachers.$post({ json: { name: `Amal Saber ${RUN}`, kind: 'person', confirmed: true } })))!.id;
    teacherB = (await apiResponse(coordinator.api.v1.teachers.$post({ json: { name: `Karim Nabil ${RUN}`, kind: 'person', confirmed: true } })))!.id;
    const mk = async (type: 'june' | 'winter', year: number, label: string) => (await apiResponse(coordinator.api.v1.sessions.$post({ json: { type, year, label } }))).id;
    june = await mk('june', Y, `u08-j-${RUN}`);
    winter = await mk('winter', W, `u08-w-${RUN}`);
    // A winter of the reference fixture's years, whose sittings carry the boards' levels.
    winterFar = await mk('winter', Y + 6, `u08-wf-${RUN}`);
    for (const id of [june, winter]) {
      await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id }, json: { paymentDueAt: new Date(Date.now() + 40 * day), closesAt: new Date(Date.now() + 200 * day) } }));
    }
  });

  it('an O.L. subject: its teachers this cycle (one online), all papers open, its Paper 41/42 retake opened in school and in self study at its own course fee — one save, each change audited once; the family page reads it so', async () => {
    const bio = await add(june, { referenceCode: '0970' });
    offering.bio = bio.id;
    const all = rowOf(bio, 'all-papers');
    const paper = rowOf(bio, 'paper-41-42');
    const actions = () => sql<{ e: string; action: string }>(`select entity_id as e, action from audit_log where entity_id in $1 order by created_at, action`, [[bio.id, all.id, paper.id]]);
    const before = (await actions()).length;
    const saved = await apiResponse(put(coordinator, june, bio.id, {
      courseFee: 12000,
      teachers: [{ teacherId: teacherA, online: false, external: false }, { teacherId: teacherB, online: true, external: false }],
      rows: [
        { id: all.id, kind: 'all_papers', examFee: 9850, cells: cells(true, true, true) },
        { id: paper.id, kind: 'paper', courseFee: 3000, cells: cells(false, true, true) },
      ],
    }));
    expect(saved).toMatchObject({ saved: true, impact: { repriced: 0, listedForFinance: 0, linesAffected: 0, dueDatesMoved: 0 } });
    // The save's rows: the subject's answers (its course fee), its teachers, each row changed, and the paper's exam fee
    // the board rule filled from all papers in the same save (Cambridge charges the syllabus's: E5) — nothing else.
    expect((await actions()).slice(before).sort((a, b) => a.e.localeCompare(b.e) || a.action.localeCompare(b.action))).toEqual([
      { e: bio.id, action: 'SESSION_OFFER_UPDATED' }, { e: bio.id, action: 'SESSION_OFFER_UPDATED' },
      { e: all.id, action: 'OFFER_ITEM_UPDATED' }, { e: paper.id, action: 'OFFER_ITEM_UPDATED' }, { e: paper.id, action: 'OFFER_ITEM_UPDATED' },
    ].sort((a, b) => a.e.localeCompare(b.e) || a.action.localeCompare(b.action)));
    const o = await view(june, bio.id);
    expect(o.teachers.map((t) => [t.teacherId, t.online])).toEqual([[teacherA, false], [teacherB, true]]);
    expect(o.rows.map((r) => [r.kind, r.label, r.cells, r.examFee, r.examFeeSource, r.courseFee, r.exclusiveGroup])).toEqual([
      ['all_papers', 'All papers', cells(true, true, true), 9850, 'typed', null, 'entry'],
      ['paper', 'Paper 41/42 only', cells(false, true, true), 9850, 'board_rule', 3000, 'entry'],
    ]);

    // The family page: all papers as a first entry or a retake; the paper as a retake only, at its own course fee.
    const rows = await familyRows(june, bio.id);
    expect(options(rows)).toEqual([
      ['All papers', ['first in_school 21850', 'retake in_school 21850', 'retake self_study 15850']],
      ['Paper 41/42 only', ['retake in_school 12850', 'retake self_study 11350']],
    ]);
    expect(rows[1]!.options.map((x) => x.label.en)).toEqual(['Retake · in school · Paper 41/42 only', 'Retake · self study 50% · Paper 41/42 only']);
    expect(rows[0]!.options[0]!.teachers.map((t) => [t.id, t.online])).toEqual([[teacherA, false], [teacherB, true]]);
    // A self-study option names no teacher.
    expect(rows[0]!.options[2]!.teachers).toEqual([]);
  });

  it('a paper the reference list does not suggest: added with its name and code, one choice with all papers (D8), a retake only; the same save sent twice makes nothing twice', async () => {
    const maths = await add(june, { referenceCode: '4MA1' });
    offering.maths = maths.id;
    const keep = maths.rows.map((r) => ({ id: r.id, kind: r.kind as 'all_papers', cells: NONE }));
    const body: Body = {
      courseFee: 10000, teachers: [{ teacherId: teacherA, online: false, external: false }],
      rows: [...keep, { kind: 'paper', name: 'Paper 3H only', referenceCodes: ['4MA1/3H'], examFee: 4600, courseFee: 2500, cells: cells(false, false, true) }],
    };
    const first = await apiResponse(put(coordinator, june, maths.id, body));
    expect(first.saved).toBe(true);
    const o = await view(june, maths.id);
    const h3 = o.rows.find((r) => r.referenceCodes.includes('4MA1/3H'))!;
    expect([h3.kind, h3.label, h3.fromReference, h3.exclusiveGroup, h3.cells, h3.examFee, h3.courseFee]).toEqual(['paper', 'Paper 3H only (4MA1/3H)', false, 'entry', cells(false, false, true), 4600, 2500]);
    expect(await one(`select action, new_data->>'via' as via from audit_log where entity_id = $1`, [h3.id])).toEqual({ action: 'OFFER_ITEM_CREATED', via: 'the subject editor' });
    // The save sent again as it was (a double click): the paper it names is the one made, nothing more made or audited.
    const before = await auditCount([maths.id, ...o.rows.map((r) => r.id)]);
    expect(await apiResponse(put(coordinator, june, maths.id, body))).toMatchObject({ saved: true });
    expect((await view(june, maths.id)).rows.map((r) => r.id)).toEqual(o.rows.map((r) => r.id));
    expect(await auditCount([maths.id, ...o.rows.map((r) => r.id)])).toBe(before);
    // The paper added again beside the one kept: refused in her words, nothing made.
    expect(await refused(put(coordinator, june, maths.id, { ...body, rows: [...keep, { id: h3.id, kind: 'paper', cells: cells(false, false, true) }, body.rows![body.rows!.length - 1]!] })))
      .toEqual({ status: 409, error: `Paper 3H only (4MA1/3H) is already under Mathematics: a row is added once` });
    expect((await view(june, maths.id)).rows).toHaveLength(4);
    expect(await auditCount([maths.id, ...o.rows.map((r) => r.id)])).toBe(before);
    // One paper ONLY is a retake: a first entry on it is refused by the editor.
    expect(await refused(put(coordinator, june, maths.id, { rows: [...keep, { id: h3.id, kind: 'paper', cells: cells(true, false, true) }] })))
      .toEqual({ status: 400, error: 'A one-paper row is always a retake: it takes no first entry' });
    // The family page: the paper in self study only, at its own course fee's share.
    expect(options(await familyRows(june, maths.id))).toEqual([['Paper 3H only (4MA1/3H)', ['retake self_study 5850']]]);
  });

  it('an International A Level by unit: Unit 1 with its own teacher online, Unit 2 in self study only at its own course fee, the qualification not this cycle — units combine freely; the family page lists the two units', async () => {
    const ar = await add(june, { referenceCode: 'YAA01' });
    offering.arabic = ar.id;
    const [q, u1, u2] = [rowOf(ar, 'yaa01'), rowOf(ar, 'waa01'), rowOf(ar, 'waa02')];
    await apiResponse(put(coordinator, june, ar.id, {
      courseFee: 4000, teachers: [{ teacherId: teacherA, online: false, external: false }],
      rows: [
        { id: u1.id, kind: 'unit', examFee: 4790, cells: cells(true, true, true), teachers: [{ teacherId: teacherB, online: true, external: false }] },
        { id: u2.id, kind: 'unit', examFee: 4790, courseFee: 2000, cells: cells(false, false, true) },
        { id: q.id, kind: 'qualification', cells: NONE },
      ],
    }));
    const o = await view(june, ar.id);
    expect(o.rows.map((r) => [r.referenceKey, r.kind, r.exclusiveGroup, r.cells, r.courseFee, r.teachers.map((t) => [t.teacherId, t.online])])).toEqual([
      ['waa01', 'unit', null, cells(true, true, true), null, [[teacherB, true]]],
      ['waa02', 'unit', null, cells(false, false, true), 2000, []],
      ['yaa01', 'qualification', 'qualification', NONE, null, []],
    ]);
    // The units keep their codes.
    expect(o.rows.map((r) => r.referenceCodes)).toEqual([['WAA01'], ['WAA02'], ['YAA01']]);
    const rows = await familyRows(june, ar.id);
    expect(options(rows)).toEqual([
      [o.rows[0]!.label, ['first in_school 8790', 'retake in_school 8790', 'retake self_study 6790']],
      [o.rows[1]!.label, ['retake self_study 5790']],
    ]);
    // Unit 1's in-school options name its own teacher, online; the subject's teacher is not read there.
    expect(rows[0]!.options[0]!.teachers.map((t) => [t.id, t.online])).toEqual([[teacherB, true]]);
    expect(rows.every((r) => r.exclusiveGroup === null)).toBe(true);
  });

  it("decision 2 in her words: a winter row sits in November or January — an International A Level's November is the board's October sitting, an International GCSE's November; a June session's rows sit in June", async () => {
    const ar = await add(winterFar, { referenceCode: 'YAA01' });
    const maths = await add(winterFar, { referenceCode: '4MA1' });
    // Arabic's reference sits it in January; Unit 2 is not sat in winter (its row is not suggested).
    expect(ar.rows.map((r) => [r.referenceKey, r.sitting, r.series?.month, r.series?.year])).toEqual([
      ['waa01', 'january', 'january', Y + 7], ['yaa01', 'january', 'january', Y + 7],
    ]);
    expect(maths.rows.every((r) => r.sitting === 'november' && r.series?.month === 'november' && r.series?.year === Y + 6)).toBe(true);
    const u1 = rowOf(ar, 'waa01');
    const saved = await apiResponse(put(coordinator, winterFar, ar.id, { rows: ar.rows.map((r) => ({ id: r.id, kind: r.kind as 'unit', cells: NONE, ...(r.id === u1.id ? { sitting: 'november' as const } : {}) })) }));
    expect(saved.saved).toBe(true);
    const moved = rowOf(await view(winterFar, ar.id), 'waa01');
    expect([moved.sitting, moved.series?.month, moved.series?.year]).toEqual(['november', 'october', Y + 6]);
    // A June session's rows sit in June: refused, nothing changed.
    const bio = await view(june, offering.bio!);
    expect(await refused(put(coordinator, june, offering.bio!, { rows: bio.rows.map((r) => ({ id: r.id, kind: r.kind as 'all_papers', cells: r.cells, sitting: r.kind === 'paper' ? 'november' as const : 'june' as const })) })))
      .toEqual({ status: 400, error: "A June session's rows sit in June" });
    expect((await view(june, offering.bio!)).rows.map((r) => r.sitting)).toEqual(['june', 'june']);
  });

  it("a row's sitting does not move while reservations use it (§6): refused in her words, nothing moved, no audit row; a row nobody reserved moves", async () => {
    const ar = await add(winter, { referenceCode: 'YAA01' });
    const [u1, q] = [rowOf(ar, 'waa01'), rowOf(ar, 'yaa01')];
    await apiResponse(put(coordinator, winter, ar.id, {
      courseFee: 4000, teachers: [{ teacherId: teacherA, online: false, external: false }],
      rows: [{ id: u1.id, kind: 'unit', examFee: 4790, cells: cells(true, true, true) }, { id: q.id, kind: 'qualification', cells: NONE }],
    }));
    await open(winter);
    const f = await onboard(officer, `u08-mv-${RUN}`, 11);
    const [line] = await apiResponse(reserve(f, winter, [{ offerItemId: u1.id, attempt: 'first', mode: 'in_school', teacherId: teacherA }]));
    const seriesBefore = (await one<{ s: string }>(`select board_series_id as s from registration where id = $1`, [line!.id])).s;
    const before = await auditCount([ar.id, u1.id, q.id, line!.id]);
    const label = (await view(winter, ar.id)).rows.find((r) => r.id === u1.id)!.label;
    expect(await refused(put(coordinator, winter, ar.id, { rows: [{ id: u1.id, kind: 'unit', sitting: 'november', cells: cells(true, true, true) }, { id: q.id, kind: 'qualification', cells: NONE }] })))
      .toEqual({ status: 409, error: `${label} has reservations in its sitting: a row's sitting does not change while reservations use it — close the row and add another` });
    expect(await one(`select board_series_id as s from registration where id = $1`, [line!.id])).toEqual({ s: seriesBefore });
    expect(rowOf(await view(winter, ar.id), 'waa01').sitting).toBe('january');
    expect(await auditCount([ar.id, u1.id, q.id, line!.id])).toBe(before);
    // The qualification, which nobody reserved, moves.
    await apiResponse(put(coordinator, winter, ar.id, { rows: [{ id: u1.id, kind: 'unit', cells: cells(true, true, true) }, { id: q.id, kind: 'qualification', sitting: 'november', cells: NONE }] }));
    expect(rowOf(await view(winter, ar.id), 'yaa01').sitting).toBe('november');
    offering.arWinter = ar.id;
  });

  it("a save that leaves a sitting unused, while a reservation of the same subject is taking its locks: the save takes the session's sitting links first, as the reservation does, so it waits and both go through (no deadlock)", async () => {
    const ar = await view(winter, offering.arWinter!);
    const [u1, q] = [rowOf(ar, 'waa01'), rowOf(ar, 'yaa01')];
    const lonely = q.series!.id;
    // The reservation held after it took the links (FOR SHARE), before the offering: at its row's sitting, held here.
    const { default: pg } = await import('pg');
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    await holder.query('begin');
    await holder.query('select id from board_series where id = $1 for update', [u1.series!.id]);
    const f = await onboard(officer, `u08-lk-${RUN}`, 11);
    let reserving: ReturnType<typeof reserve> | undefined;
    let saving: ReturnType<typeof put> | undefined;
    try {
      reserving = reserve(f, winter, [{ offerItemId: u1.id, attempt: 'first', mode: 'in_school', teacherId: teacherA }]);
      await lockWaiters(1);
      // The qualification left out: removed (nothing ever used it), its November sitting no longer used by the session.
      saving = put(coordinator, winter, ar.id, { rows: [{ id: u1.id, kind: 'unit', cells: cells(true, true, true) }] });
      await lockWaiters(2);
    } finally {
      await holder.query('commit');
      await holder.end();
    }
    const [r, sv] = await Promise.all([reserving!, saving!]);
    expect(r.status).toBe(201);
    expect(sv.status).toBe(200);
    expect(await sql(`select id from session_offer_item where id = $1`, [q.id])).toEqual([]);
    expect(await sql(`select 1 as one from session_board_series where session_id = $1 and board_series_id = $2`, [winter, lonely])).toEqual([]);
  });

  it("a Cambridge A level's three routes: A.S. offered at its fee, A.2. carried forward in self study (its own first entry after the A.S., and a retake) asking its earlier sitting, A.L. not this cycle — one choice", async () => {
    const cs = await add(june, { referenceCode: '9618', board: 'cambridge' });
    offering.cs = cs.id;
    const [as, a2, al] = [rowOf(cs, 'as'), rowOf(cs, 'a2'), rowOf(cs, 'al')];
    await apiResponse(put(coordinator, june, cs.id, {
      courseFee: 14000, teachers: [{ teacherId: teacherA, online: false, external: false }],
      rows: [
        { id: as.id, kind: 'as', examFee: 14100, cells: cells(true, true, true) },
        { id: a2.id, kind: 'a2', examFee: 11400, cells: cells(false, false, true, true) },
        { id: al.id, kind: 'al', cells: NONE },
      ],
    }));
    const o = await view(june, cs.id);
    expect(o.rows.map((r) => [r.kind, r.label, r.exclusiveGroup, r.needsCarriedFrom])).toEqual([
      ['as', 'A.S.', 'route', false], ['a2', 'A.2. (carry forward)', 'route', true], ['al', 'A.L.', 'route', false],
    ]);
    const rows = await familyRows(june, cs.id);
    expect(options(rows)).toEqual([
      ['A.S.', ['first in_school 28100', 'retake in_school 28100', 'retake self_study 21100']],
      ['A.2. (carry forward)', ['retake self_study 18400', 'first self_study 18400']],
    ]);
    // The A.2. names the sitting it carries from, the board's two before June Y.
    expect(rows[1]!.options.map((x) => [x.needsCarriedFrom, x.allowedSittings.map((s) => s.label.en)])).toEqual([
      [true, [`November ${Y - 1}`, `June ${Y - 1}`]], [true, [`November ${Y - 1}`, `June ${Y - 1}`]],
    ]);
    expect(rows.every((r) => r.exclusiveGroup === 'route')).toBe(true);
  });

  it('"Retake (Self Study ONLY)" at a course fee of 0 is a price set: offered at the exam fee alone; taught in school with no teacher named is on the check list, not refused', async () => {
    const env = await add(june, { custom: { board: 'cambridge', name: `Environmental Management ${RUN}`, level: 'igcse', group: 'O.L.' } });
    offering.env = env.id;
    const saved = await apiResponse(put(coordinator, june, env.id, {
      courseFee: 0, teachers: [],
      rows: [{ kind: 'all_papers', referenceCodes: ['0680'], examFee: 9850, cells: cells(false, false, true) }],
    }));
    expect(saved.saved).toBe(true);
    const o = await view(june, env.id);
    expect([o.courseFee, o.offeredToFamilies, o.priceNotSet]).toEqual([0, true, []]);
    expect((await familyRows(june, env.id)).map((r) => r.options.map((x) => [x.attempt, x.mode, x.price]))).toEqual([
      [['retake', 'self_study', { total: 9850, examFee: 9850, courseFee: 0 }]],
    ]);
    const checks = async () => (await apiResponse(coordinator.api.v1.sessions[':id'].$get({ param: { id: june } }))).checkList.filter((c) => c.offeringId === env.id).map((c) => c.code);
    expect(await checks()).not.toContain('no_teacher');
    // Ticked for a first entry in school with nobody named: saved, and the check list asks who teaches it.
    await apiResponse(put(coordinator, june, env.id, { rows: [{ id: o.rows[0]!.id, kind: 'all_papers', cells: cells(true, false, true) }] }));
    expect(await checks()).toContain('no_teacher');
    // Not on the reference list: flagged for us to add.
    expect(await checks()).toContain('not_on_the_list');
  });

  it('a full form as the screen sends it, saved again as it stands, changes nothing and writes no audit row; a save whose audit row cannot be written changes nothing (the rows commit with the change)', async () => {
    for (const id of [offering.bio!, offering.arabic!, offering.cs!]) {
      const o = await view(june, id);
      const ids = [id, ...o.rows.map((r) => r.id)];
      const before = await auditCount(ids);
      const body: Body = {
        note: o.note, teacherChoice: o.teacherChoice as 'families', teacherTbc: o.teacherTbc, accepting: o.accepting, closesAt: o.closesAt, courseFee: o.courseFee,
        teachers: o.teachers.map((t) => ({ teacherId: t.teacherId, online: t.online, external: t.external })),
        rows: o.rows.map((r) => ({
          id: r.id, kind: r.kind as 'all_papers', sitting: r.sitting as 'june', closesAt: r.closesAt, payBy: r.payBy,
          examFee: r.examFee, courseFee: r.courseFee, selfStudyFee: r.selfStudyFee, cells: r.cells,
          allowedPriorSittings: r.allowedPriorSittings.map((p) => ({ month: p.month as 'june', year: p.year })),
          teachers: r.teachers.map((t) => ({ teacherId: t.teacherId, online: t.online, external: t.external })),
        })),
      };
      expect(await apiResponse(put(coordinator, june, id, body))).toMatchObject({ saved: true, impact: { repriced: 0, listedForFinance: 0, linesAffected: 0, dueDatesMoved: 0 } });
      expect(await auditCount(ids)).toBe(before);
      expect(await view(june, id)).toEqual(o);
    }
    // A row's audit row refused: the subject's change, written first, is undone with it.
    const o = await view(june, offering.bio!);
    const snapshot = () => one(`select o.course_fee::float as fee, o.notes, (select json_agg(i.course_fee order by i.sort_order) from session_offer_item i where i.offer_id = o.id) as rows from session_offer o where o.id = $1`, [offering.bio!]);
    const was = await snapshot();
    const before = await auditCount([offering.bio!, ...o.rows.map((r) => r.id)]);
    const release = await refuseAudit('OFFER_ITEM_UPDATED');
    try {
      const r = await refused(put(coordinator, june, offering.bio!, { note: 'a note that does not land', rows: [
        { id: o.rows[0]!.id, kind: 'all_papers', courseFee: 12500, cells: o.rows[0]!.cells }, { id: o.rows[1]!.id, kind: 'paper', cells: o.rows[1]!.cells },
      ] }));
      expect(r.status).toBeGreaterThanOrEqual(400);
    } finally {
      await release();
    }
    expect(await snapshot()).toEqual(was);
    expect(await auditCount([offering.bio!, ...o.rows.map((r) => r.id)])).toBe(before);
  });

  it('"One paper ONLY" is always a retake: the family page offers none, and a first entry on it is refused at the reservation; a retake is taken', async () => {
    await open(june);
    const f = await onboard(officer, `u08-op-${RUN}`, 11);
    const paper = rowOf(await view(june, offering.bio!), 'paper-41-42');
    const fam = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: june, studentId: f.studentId } }));
    expect(fam.offerings.find((o) => o.id === offering.bio)!.rows.find((r) => r.id === paper.id)!.options.map((x) => x.attempt)).toEqual(['retake', 'retake']);
    expect((await refused(reserve(f, june, [{ offerItemId: paper.id, attempt: 'first', mode: 'in_school', teacherId: teacherA }]))).status).toBe(400);
    expect(await sql(`select id from registration where student_id = $1`, [f.studentId])).toEqual([]);
    const nov = (await one<{ id: string }>(`select id from board_series where board_code = 'cambridge' and month = 'november' and year = $1 and label = ''`, [Y - 1])).id;
    const [line] = await apiResponse(reserve(f, june, [{ offerItemId: paper.id, attempt: 'retake', mode: 'in_school', teacherId: teacherA, priorSittingSeriesId: nov }]));
    expect(money((await one<{ p: string }>(`select price_at_registration as p from registration where id = $1`, [line!.id])).p)).toBe(12850);
  });

  it("the preview: the family page with no student's data in it — for the coordinator, the admin and finance (set-up's readers); refused to families", async () => {
    // A family with a discount and a reservation in this very subject.
    const f = await onboard(officer, `u08-pv-${RUN}`, 11);
    await apiResponse(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'price.discountPercent', studentId: f.studentId, scope: { sessionId: june }, value: 50, reason: '08u: siblings' } }));
    const all = rowOf(await view(june, offering.bio!), 'all-papers');
    const [line] = await apiResponse(reserve(f, june, [{ offerItemId: all.id, attempt: 'first', mode: 'in_school', teacherId: teacherA }]));
    expect(money((await one<{ p: string }>(`select price_at_registration as p from registration where id = $1`, [line!.id])).p)).toBe(10925);
    // The family's own page: its discounted price.
    const fam = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: june, studentId: f.studentId } }));
    expect(fam.offerings.find((o) => o.id === offering.bio)!.rows[0]!.options[0]!.price?.total).toBe(10925);
    for (const who of [adm, coordinator, officer]) {
      const res = await preview(who, june);
      expect(res.status).toBe(200);
      const text = await res.clone().text();
      for (const s of [f.studentId, `u08-pv-${RUN}`, f.parent.id, line!.id]) expect(text).not.toContain(s);
      const body = await apiResponse(Promise.resolve(res));
      // The school's prices, no family's exception.
      expect(body.offerings.find((o) => o.id === offering.bio)!.rows[0]!.options.map((x) => [x.attempt, x.mode, x.price?.total])).toEqual([
        ['first', 'in_school', 21850], ['retake', 'in_school', 21850], ['retake', 'self_study', 15850],
      ]);
      expect(body.offerings.every((o) => o.rows.every((r) => r.knownSitting === null))).toBe(true);
    }
    for (const who of [f.parent, f.student]) expect((await refused(preview(who, june))).status).toBe(403);
    expect((await refused(preview(coordinator, 'no-such-session'))).status).toBe(404);
  });
});
