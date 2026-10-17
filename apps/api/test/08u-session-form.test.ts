import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, type LineInputType } from '@repo/validations';
import { admin, staff, onboard, subject, refused, one, sql, refuseAudit, money, type Client } from './helpers';

/**
 * F6a — the session in the school's words (FEATURES_PLAN.md §1 F6a; docs/features/SESSION_WORDS.md).
 *
 * `PUT /v1/sessions/:id/offers/:offerId/form` saves one subject's form whole, in one transaction,
 * through the offer and item services' own logic; `GET /v1/registrations/offers/preview` is the
 * family's form as staff see it, with no student. The forms' shapes (SCHOOL_FORMS.md §2):
 *
 * - an O.L. subject with its teachers (one online) and a one-paper retake opened in school and in
 *   self-study with its own fee — and a paper the Catalogue gained after the subject was added;
 * - an IAL subject per unit, a teacher per unit, one unit self-study only, one not this cycle, and
 *   two units moved to another sitting with their reservations in one save;
 * - a Cambridge A level's three routes (A.S., A.2. carry forward, A.L.);
 * - "Retake (Self Study ONLY)" at a course fee of 0, which says why;
 * - the refusals in the form's words: "Not offered this cycle" while reservations stand (unless
 *   the form says they stand), an open subject nobody teaches;
 * - the same form twice changes nothing and writes no audit row; the audit rows commit with the
 *   change or not at all;
 * - "One paper ONLY" is always a retake (the lead's decision of 11 Oct 2026): no first entry;
 * - the preview: the same read as the family's with no student, refused to families.
 */

const RUN = Math.random().toString(36).slice(2, 6);
const Y = academicYearStartOf();
const days = (n: number) => n * 86_400_000;
const cairoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
type Line = Pick<LineInputType, 'offerItemId' | 'attempt' | 'mode'> & Partial<LineInputType>;

/** Reserve lines as every reservation path does (the student locked first, then insertLines, then the consents). */
async function reserve(studentId: string, sessionId: string, lines: Line[]) {
  const { db } = await import('@repo/db');
  const { insertLines } = await import('../src/services/line.services');
  const { writeConsents } = await import('../src/services/reservation.services');
  const { assertMayRegisterForInTx } = await import('../src/services/eligibility.services');
  return db.transaction(async (tx) => {
    const eligibility = await assertMayRegisterForInTx(tx, studentId, sessionId);
    const made = await insertLines(tx, { studentId, sessionId, lines: lines as LineInputType[], status: 'pending_payment', requestedBy: studentId, eligibility });
    await writeConsents(tx, made.map((r) => r.id), { channel: 'app', confirmedBy: studentId });
    return made;
  });
}

describe('08u: the session in the school\'s words — one form per subject, the preview', () => {
  let adm: Client, coordinator: Client, finadmin: Client, officer: Client;
  let t1: string, t2: string;
  let june: string, winter: string;

  type FormJson = Parameters<Client['api']['v1']['sessions'][':id']['offers'][':offerId']['form']['$put']>[0]['json'];
  const save = (who: Client, sessionId: string, offerId: string, json: FormJson) =>
    who.api.v1.sessions[':id'].offers[':offerId'].form.$put({ param: { id: sessionId, offerId }, json });
  const list = async (sessionId: string) => apiResponse(coordinator.api.v1.sessions[':id'].offers.$get({ param: { id: sessionId } }));
  const offerRow = async (sessionId: string, offerId: string) => (await list(sessionId)).offers.find((o) => o.id === offerId)!;
  const preview = (who: Client, sessionId: string) => who.api.v1.registrations.offers.preview.$get({ query: { sessionId } });
  /** The form as it stands, before the change a test makes (what the screen sends when nothing is touched). */
  const asIs = (o: Awaited<ReturnType<typeof offerRow>>): FormJson => ({
    teachers: o.teachers.map((t) => ({ teacherId: t.teacherId, mode: t.mode as 'in_school' | 'online' })),
    availability: o.availability as FormJson['availability'],
    courseFee: o.courseFee,
    grade10Core: o.grade10Core,
    courseStartsOn: o.courseStartsOn,
    notes: o.notes,
    items: [],
  });
  const auditCount = async (ids: string[]) => Number((await one<{ n: string }>(`select count(*) as n from audit_log where entity_id in $1`, [ids])).n);
  const mkSeries = async (boardCode: 'cambridge' | 'pearson_edexcel', month: 'june' | 'october' | 'november' | 'january', year: number, label: string) =>
    (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode, month, year, label, entryDeadline: new Date(Date.now() + days(60)) } })))!.id;
  const fee = (seriesId: string, keyKind: 'subject' | 'unit' | 'qualification', keyId: string, amount: number) =>
    apiResponse(finadmin.api.v1['board-fees'].$put({ query: { seriesId }, json: { rows: [{ keyKind, keyId, amount, provisional: false }] } }));
  const unit = async (board: 'cambridge' | 'pearson_edexcel', code: string, shortCode: string, level: 'igcse' | 'as' | 'a2', kind: 'component' | 'unit') =>
    (await apiResponse(coordinator.api.v1.catalogue.units.$post({ json: { boardCode: board, code: `${code}-${RUN}`, shortCode, title: shortCode, unitLevel: level, kind } })))!.id;

  beforeAll(async () => {
    adm = await admin('u08');
    coordinator = await staff(adm, 'coordinator', 'u08');
    finadmin = await staff(adm, 'finance_admin', 'u08');
    officer = await staff(adm, 'finance_officer', 'u08');
    t1 = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher One (08u ${RUN})` } })))!.id;
    t2 = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher Two (08u ${RUN})` } })))!.id;
    const mk = async (type: 'june' | 'winter', year: number, label: string) => (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type, year, label, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
      },
    })))!.id;
    june = await mk('june', Y + 1, `u08-j-${RUN}`);
    winter = await mk('winter', Y, `u08-w-${RUN}`);
  });

  it('an O.L. subject: its teachers this cycle (one online), and its Paper 4 retake opened in school or self-study with its own fee — one Save, each change audited', async () => {
    const q = (await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
      json: { boardCode: 'cambridge', code: `U06B-${RUN}`, title: `Biology (08u ${RUN})`, level: 'igcse', suite: 'Cambridge IGCSE', subjectArea: 'Biology', entryMethod: 'qualification' },
    })))!.id;
    const [p2, p4] = [await unit('cambridge', 'U21', 'Paper 2', 'igcse', 'component'), await unit('cambridge', 'U41', 'Paper 4', 'igcse', 'component')];
    await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({ param: { id: q }, json: { units: [p2, p4].map((unitId) => ({ unitId, requirement: 'required' as const })) } }));
    const bio = await subject(adm, `U08-BIO-${RUN}`, `Biology O.L. (08u ${RUN})`, { course: 12000, registration: 9850 });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: bio }, json: { boardCode: 'cambridge', qualificationId: q, unitIds: [], reason: '08u: mapped' } }));
    // Added as the sheet has it: the subject, a teacher, the course fee (the papers come from the Catalogue, not offered yet).
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: june }, json: { subjectId: bio, courseFee: 12000, teachers: [{ teacherId: t1, mode: 'in_school' }] } })))!;
    let o = await offerRow(june, made.id);
    const paper4 = o.items.find((i) => i.kind === 'one_paper' && i.units.some((u) => u.unitId === p4))!;
    const paper2 = o.items.find((i) => i.kind === 'one_paper' && i.units.some((u) => u.unitId === p2))!;
    expect([paper2.availability, paper4.availability]).toEqual(['closed', 'closed']);
    await fee(o.items[0]!.boardSeriesId!, 'qualification', q, 9850);
    const before = await auditCount([made.id, ...o.items.map((i) => i.id)]);

    // The form: Teacher Two joins, online only; "Paper 4 only: retake in school or self study" at EGP 3,000.
    const r = await apiResponse(save(coordinator, june, made.id, {
      ...asIs(o),
      teachers: [{ teacherId: t1, mode: 'in_school' }, { teacherId: t2, mode: 'online' }],
      items: [{ itemId: paper4.id, availability: 'retake_only', courseFee: 3000 }, { itemId: paper2.id, availability: 'closed', courseFee: null }],
    }));
    expect(r).toMatchObject({ changed: true, offer: true, itemsChanged: 1, itemsCreated: 0, linesMoved: 0 });
    o = await offerRow(june, made.id);
    expect(o.teachers.map((t) => [t.teacherId, t.mode])).toEqual([[t1, 'in_school'], [t2, 'online']]);
    expect(o.items.map((i) => [i.kind, i.availability, i.courseFee])).toEqual([
      ['whole', 'open', null], ['one_paper', 'closed', null], ['one_paper', 'retake_only', 3000],
    ]);
    // Two audit rows, the subject's and Paper 4's, nothing for Paper 2 (unchanged).
    expect(await auditCount([made.id, ...o.items.map((i) => i.id)])).toBe(before + 2);
    expect(await one(`select action from audit_log where entity_id = $1 order by created_at desc limit 1`, [paper4.id])).toEqual({ action: 'OFFER_ITEM_UPDATED' });
    expect((await sql<{ teacher_id: string }>(`select teacher_id from subject_teacher where subject_id = $1`, [bio])).map((x) => x.teacher_id).sort()).toEqual([t1, t2].sort());

    // What the family's form then shows (the preview): all papers as a first entry or a retake; Paper 4 as a retake only.
    const pv = await apiResponse(preview(coordinator, june));
    const sub = pv.offers.find((x) => x.id === made.id)!;
    const prices = (itemId: string) => sub.items.find((i) => i.id === itemId)!.prices.map((p) => [p.attempt, p.mode, p.total]);
    expect(prices(o.items[0]!.id)).toEqual([['first', 'in_school', 21850], ['retake', 'in_school', 21850], ['retake', 'self_study', 15850]]);
    expect(prices(paper4.id)).toEqual([['retake', 'in_school', 12850], ['retake', 'self_study', 11350]]);
    expect(sub.items.map((i) => i.id)).not.toContain(paper2.id);
    expect(sub.items.find((i) => i.id === o.items[0]!.id)!.teachers.map((t) => [t.id, t.mode])).toEqual([[t1, 'in_school'], [t2, 'online']]);
  });

  it("a paper the Catalogue gains after the subject is on the sheet: the form lists it and makes it once it is offered; the same form again makes nothing", async () => {
    const q = (await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
      json: { boardCode: 'pearson_edexcel', code: `U4MA-${RUN}`, title: `Mathematics A (08u ${RUN})`, level: 'igcse', suite: 'Pearson Edexcel International GCSE', subjectArea: 'Mathematics', entryMethod: 'qualification' },
    })))!.id;
    const maths = await subject(adm, `U08-MA-${RUN}`, `Mathematics O.L. (08u ${RUN})`, { course: 10000, registration: 4600 }, { council: 'pearson_edexcel' });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: maths }, json: { boardCode: 'pearson_edexcel', qualificationId: q, unitIds: [], reason: '08u: mapped' } }));
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: june }, json: { subjectId: maths, courseFee: 10000, teachers: [{ teacherId: t1, mode: 'in_school' }] } })))!;
    let o = await offerRow(june, made.id);
    // No papers on the Catalogue yet: the form says to set them there.
    expect(o.items.map((i) => i.kind)).toEqual(['whole']);
    expect(o.papersToAdd).toEqual([]);
    const h1 = await unit('pearson_edexcel', 'U1H', 'Paper 1H', 'igcse', 'component');
    await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({ param: { id: q }, json: { units: [{ unitId: h1, requirement: 'required' }] } }));
    o = await offerRow(june, made.id);
    expect(o.papersToAdd).toEqual([{ unitId: h1, label: 'Paper 1H only (retake)', code: `U1H-${RUN}`.toUpperCase(), shortCode: 'Paper 1H' }]);
    // The same paper named twice in one request (the screen never sends it; the API may be called so): refused, nothing made.
    expect(await refused(save(coordinator, june, made.id, { ...asIs(o), items: [h1, h1].map((paperUnitId) => ({ paperUnitId, availability: 'retake_only' as const, courseFee: 2500 })) })))
      .toEqual({ status: 400, error: 'A paper or unit is named twice in the form' });
    expect((await offerRow(june, made.id)).items).toHaveLength(1);
    // "Retake self study only" at EGP 2,500: the paper is made, retakes in self-study only, read for the paper's own fee
    // (Edexcel prices per paper: F8-05, the board's one_paper_fee_key).
    const form = { ...asIs(o), items: [{ paperUnitId: h1, availability: 'self_study_only' as const, courseFee: 2500 }] };
    const madePaper = await apiResponse(save(coordinator, june, made.id, form));
    expect(madePaper).toMatchObject({ changed: true, offer: false, itemsCreated: 1 });
    o = await offerRow(june, made.id);
    const paper = o.items.find((i) => i.kind === 'one_paper')!;
    const whole = o.items.find((i) => i.kind === 'whole')!;
    expect([paper.label, paper.availability, paper.courseFee, paper.exclusiveGroup, paper.units.map((u) => u.unitId)]).toEqual(['Paper 1H only (retake)', 'self_study_only', 2500, 'entry', [h1]]);
    const prior = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month: 'november', year: Y, label: `u08-p2-${RUN}` } })))!.id;
    const f = await onboard(officer, `u08-p2-${RUN}`, 11);
    const { db } = await import('@repo/db');
    const { assertLineRules } = await import('../src/services/line-rules.services');
    const { assertMayRegisterForInTx } = await import('../src/services/eligibility.services');
    const allPapers = { offerItemId: whole.id, attempt: 'first' as const, mode: 'in_school' as const, priorSittingSeriesId: null };
    const onePaper = { offerItemId: paper.id, attempt: 'retake' as const, mode: 'self_study' as const, priorSittingSeriesId: prior, priorSittingSource: 'declared_by_desk' };
    const rules = (lines: (typeof allPapers | typeof onePaper)[]) => db.transaction(async (tx) => {
      const eligibility = await assertMayRegisterForInTx(tx, f.studentId, june);
      await assertLineRules(tx, { studentId: f.studentId, sessionId: june, eligibility }, lines);
      throw new Error('rolled back: the rules passed');
    });
    await expect(rules([allPapers])).rejects.toThrow('rolled back: the rules passed');
    await expect(rules([onePaper])).rejects.toThrow('rolled back: the rules passed');
    await expect(rules([allPapers, onePaper])).rejects.toThrow(`Mathematics O.L. (08u ${RUN}) — Paper 1H only (retake) and Mathematics O.L. (08u ${RUN}) cannot be reserved together`);
    // The review of F6a, finding 1: "All papers", made when the Catalogue had no papers, had no group; it
    // joins the paper's, with its audit row — so a family cannot reserve both for one sitting.
    expect(whole.exclusiveGroup).toBe('entry');
    expect(await one(`select new_data->>'exclusiveGroup' as g from audit_log where action = 'OFFER_ITEM_UPDATED' and entity_id = $1`, [whole.id])).toEqual({ g: 'entry' });
    expect(madePaper.itemsChanged).toBe(1);

    expect(await sql(`select key_kind, key_id from session_offer_item_fee_key where item_id = $1`, [paper.id])).toEqual([{ key_kind: 'unit', key_id: h1 }]);
    expect(await one(`select action, new_data->>'via' as via from audit_log where entity_id = $1`, [paper.id])).toEqual({ action: 'OFFER_ITEM_CREATED', via: 'form' });
    expect(o.papersToAdd).toEqual([]);
    // The screen sent twice (a double click): nothing more is made, nothing audited.
    const before = await auditCount([made.id, paper.id]);
    expect(await apiResponse(save(coordinator, june, made.id, form))).toMatchObject({ changed: false, itemsCreated: 0 });
    expect((await offerRow(june, made.id)).items).toHaveLength(2);
    expect(await auditCount([made.id, paper.id])).toBe(before);
  });

  it("F8-05: a one-paper retake's board fee follows its board — Edexcel 4MA1's Paper 1H at the paper's own fee, Cambridge's Paper 4 at the syllabus's; the Fees tab names the paper once", async () => {
    // The boards as the migrations leave them (0062, 0063): Pearson Edexcel prices one paper on its own; Cambridge and
    // OxfordAQA the syllabus.
    const boards = (await apiResponse(coordinator.api.v1.catalogue.$get())).boards;
    expect(Object.fromEntries(boards.map((b) => [b.code, b.onePaperFeeKey]))).toEqual({ cambridge: 'qualification', oxford: 'qualification', pearson_edexcel: 'unit' });

    // Edexcel International GCSE Mathematics A (4MA1): Paper 1H and Paper 2H, each priced on Pearson's list (4,600 a paper).
    const ma = (await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
      json: { boardCode: 'pearson_edexcel', code: `F4MA1-${RUN}`, title: `Mathematics A (08u F8-05 ${RUN})`, level: 'igcse', suite: 'Pearson Edexcel International GCSE', subjectArea: 'Mathematics', entryMethod: 'qualification' },
    })))!.id;
    const [h1, h2] = [await unit('pearson_edexcel', 'F1H', 'Paper 1H', 'igcse', 'component'), await unit('pearson_edexcel', 'F2H', 'Paper 2H', 'igcse', 'component')];
    await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({ param: { id: ma }, json: { units: [h1, h2].map((unitId) => ({ unitId, requirement: 'required' as const })) } }));
    const maths = await subject(adm, `F805-MA-${RUN}`, `Mathematics O.L. (08u F8-05 ${RUN})`, { course: 10000, registration: 0 }, { council: 'pearson_edexcel' });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: maths }, json: { boardCode: 'pearson_edexcel', qualificationId: ma, unitIds: [], reason: '08u F8-05: mapped' } }));

    // Cambridge IGCSE Biology (0970 CX): one option code entering Paper 2 and Paper 4; the syllabus priced 10,850.
    const bio = (await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
      json: { boardCode: 'cambridge', code: `F0970-${RUN}`, title: `Biology (08u F8-05 ${RUN})`, level: 'igcse', suite: 'Cambridge IGCSE', subjectArea: 'Biology', entryMethod: 'syllabus_option' },
    })))!.id;
    const [c2, c4] = [await unit('cambridge', 'F22', 'Paper 2', 'igcse', 'component'), await unit('cambridge', 'F42', 'Paper 4', 'igcse', 'component')];
    await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({ param: { id: bio }, json: { units: [c2, c4].map((unitId) => ({ unitId, requirement: 'required' as const })) } }));
    const cx = (await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].options.$post({ param: { id: bio }, json: { code: 'CX', label: 'Extended, Papers 2 and 4', unitIds: [c2, c4] } })))!.id;
    const biology = await subject(adm, `F805-BIO-${RUN}`, `Biology O.L. (08u F8-05 ${RUN})`, { course: 12000, registration: 0 });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: biology }, json: { boardCode: 'cambridge', qualificationId: bio, unitIds: [], reason: '08u F8-05: mapped' } }));

    // Added to the session as the sheet adds a subject: the papers come from the Catalogue, each keyed as its board prices it.
    const om = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: june }, json: { subjectId: maths, courseFee: 10000, teachers: [{ teacherId: t1, mode: 'in_school' }] } })))!;
    const ob = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: june }, json: { subjectId: biology, courseFee: 12000, teachers: [{ teacherId: t1, mode: 'in_school' }] } })))!;
    const mathsRow = await offerRow(june, om.id);
    const bioRow = await offerRow(june, ob.id);
    const paperOf = (o: typeof mathsRow, unitId: string) => o.items.find((i) => i.kind === 'one_paper' && i.units.some((u) => u.unitId === unitId))!;
    const [m1h, m2h, b4] = [paperOf(mathsRow, h1), paperOf(mathsRow, h2), paperOf(bioRow, c4)];
    const keysOf = (itemId: string) => sql<{ key_kind: string; key_id: string }>(`select key_kind, key_id from session_offer_item_fee_key where item_id = $1 order by key_kind`, [itemId]);
    expect(await keysOf(mathsRow.items.find((i) => i.kind === 'whole')!.id)).toEqual([{ key_kind: 'qualification', key_id: ma }]);
    expect(await keysOf(m1h.id)).toEqual([{ key_kind: 'unit', key_id: h1 }]);
    expect(await keysOf(m2h.id)).toEqual([{ key_kind: 'unit', key_id: h2 }]);
    expect(await keysOf(bioRow.items.find((i) => i.kind === 'whole')!.id)).toEqual([{ key_kind: 'option', key_id: cx }]);
    // Paper 4 reads the whole item's row, the option's (the lead's answer 2 on the review of 744e553): the list names
    // the syllabus once, "0970 CX 10,850".
    expect(await keysOf(b4.id)).toEqual([{ key_kind: 'option', key_id: cx }]);

    // Each subject's items into a June series of this file with an entry deadline (the unlabelled one has no dates, and
    // a series with neither takes no line): the item endpoint's move, nothing reserved yet.
    const pearsonJune = await mkSeries('pearson_edexcel', 'june', Y + 1, `f805-pj-${RUN}`);
    const cambridgeJune = await mkSeries('cambridge', 'june', Y + 1, `f805-cj-${RUN}`);
    for (const [o, seriesId] of [[mathsRow, pearsonJune], [bioRow, cambridgeJune]] as const) {
      for (const i of o.items) {
        await apiResponse(coordinator.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({ param: { id: june, offerId: o.id, itemId: i.id }, json: { boardSeriesId: seriesId, reason: '08u F8-05: a dated series' } }));
      }
    }
    // The fee lists as the boards publish them: Pearson the qualification (9,200) and each paper (4,600); Cambridge the
    // syllabus with its option once (10,850), which the carry-forward re-entry of one paper is charged too (Q-13).
    await apiResponse(finadmin.api.v1['board-fees'].$put({ query: { seriesId: pearsonJune }, json: { rows: [
      { keyKind: 'qualification', keyId: ma, amount: 9200, provisional: false },
      { keyKind: 'unit', keyId: h1, amount: 4600, provisional: false },
      { keyKind: 'unit', keyId: h2, amount: 4600, provisional: false },
    ] } }));
    // Cambridge's row from the Fees tab's paste, as its list writes it: one row, read by the whole subject and by each
    // paper's retake (Paper 2's is on the sheet unticked).
    const camParsed = await apiResponse(finadmin.api.v1['board-fees'][':seriesId'].parse.$post({ param: { seriesId: cambridgeJune }, json: { text: `F0970-${RUN} CX 10,850` } }));
    expect(camParsed.matched.map((m) => [m.keyKind, m.keyId, m.amount])).toEqual([['option', cx, 10850]]);
    await apiResponse(finadmin.api.v1['board-fees'].$put({ query: { seriesId: cambridgeJune }, json: { rows: camParsed.matched.map((m) => ({ keyKind: m.keyKind, keyId: m.keyId, amount: m.amount, provisional: false })) } }));
    const camGrid = await apiResponse(finadmin.api.v1['board-fees'].$get({ query: { seriesId: cambridgeJune } }));
    expect(camGrid.rows.find((r) => r.keyKind === 'option' && r.keyId === cx)!.items.map((i) => i.label).sort()).toEqual(['Paper 2 only (retake)', 'Paper 4 only (retake)', 'Whole subject']);
    expect(camGrid.rows.some((r) => r.keyKind === 'qualification' && r.keyId === bio)).toBe(false);
    // The school opens Paper 1H and Paper 4 at EGP 3,000 each (retakes only: "One paper ONLY").
    await apiResponse(save(coordinator, june, om.id, { ...asIs(mathsRow), items: [{ itemId: m1h.id, availability: 'retake_only', courseFee: 3000 }] }));
    await apiResponse(save(coordinator, june, ob.id, { ...asIs(bioRow), items: [{ itemId: b4.id, availability: 'retake_only', courseFee: 3000 }] }));

    // The family's form: Paper 1H costs its course fee and one paper's board fee; Paper 4 its course fee and the syllabus's.
    const pv = await apiResponse(preview(coordinator, june));
    const prices = (offerId: string, itemId: string) => pv.offers.find((x) => x.id === offerId)!.items.find((i) => i.id === itemId)!.prices.map((p) => [p.attempt, p.mode, p.total]);
    expect(prices(om.id, m1h.id)).toEqual([['retake', 'in_school', 7600], ['retake', 'self_study', 6100]]);
    expect(prices(ob.id, b4.id)).toEqual([['retake', 'in_school', 13850], ['retake', 'self_study', 12350]]);

    // A student's reservation of each: its price and the fee row its basis names.
    const priorP = await mkSeries('pearson_edexcel', 'november', Y, `f805-p-${RUN}`);
    const priorC = await mkSeries('cambridge', 'november', Y, `f805-c-${RUN}`);
    const f = await onboard(officer, `f805-${RUN}`, 11);
    const [l1h, l4] = await reserve(f.studentId, june, [
      { offerItemId: m1h.id, attempt: 'retake', mode: 'in_school', teacherId: t1, priorSittingSeriesId: priorP, priorSittingSource: 'declared_by_desk' },
      { offerItemId: b4.id, attempt: 'retake', mode: 'in_school', teacherId: t1, priorSittingSeriesId: priorC, priorSittingSource: 'declared_by_desk' },
    ]);
    const priced = (id: string) => one<{ price: number; rows: { keyKind: string; keyId: string; amount: number }[] }>(
      `select price_at_registration::float as price, pricing_basis->'feeRows' as rows from registration where id = $1`, [id]);
    expect(await priced(l1h!.id)).toMatchObject({ price: 7600, rows: [{ keyKind: 'unit', keyId: h1, amount: 4600 }] });
    expect(await priced(l4!.id)).toMatchObject({ price: 13850, rows: [{ keyKind: 'option', keyId: cx, amount: 10850 }] });

    // The Fees tab: Paper 1H's row names the paper and the item read from it; the qualification's row only the whole subject.
    const grid = await apiResponse(finadmin.api.v1['board-fees'].$get({ query: { seriesId: pearsonJune } }));
    const rowOf = (keyKind: string, keyId: string) => grid.rows.find((r) => r.keyKind === keyKind && r.keyId === keyId)!;
    expect([rowOf('unit', h1).code, rowOf('unit', h1).items.map((i) => i.label), rowOf('unit', h1).lines]).toEqual([`F1H-${RUN}`.toUpperCase(), ['Paper 1H only (retake)'], 1]);
    expect(rowOf('qualification', ma).items.map((i) => i.label)).toEqual(['Whole subject']);

    // Pasting the paper's row from Pearson's list reaches the paper, not the syllabus: a unit whose code holds the award's
    // ("4MA1/1H", or written "4MA1 1H") is read whole before its parts; the award's own row stays the award's.
    const h3 = (await apiResponse(coordinator.api.v1.catalogue.units.$post({
      json: { boardCode: 'pearson_edexcel', code: `F4MA1-${RUN}/3H`, shortCode: 'Paper 3H', title: 'Paper 3H', unitLevel: 'igcse', kind: 'component' },
    })))!.id;
    const parsed = await apiResponse(finadmin.api.v1['board-fees'][':seriesId'].parse.$post({
      param: { seriesId: pearsonJune }, json: { text: `F4MA1-${RUN}/3H 4,600\nF4MA1-${RUN} 3H 4,600\nF4MA1-${RUN} 9,200` },
    }));
    expect(parsed.matched.map((m) => [m.keyKind, m.keyId, m.amount])).toEqual([['unit', h3, 4600], ['unit', h3, 4600], ['qualification', ma, 9200]]);

    // The item endpoint's default (decision 4's API-only tool) follows the board too: a one-paper item made with no fee keys.
    const viaEndpoint = (offerId: string, unitId: string, label: string) => apiResponse(coordinator.api.v1.sessions[':id'].offers[':offerId'].items.$post({
      param: { id: june, offerId },
      json: { label, kind: 'one_paper', enters: { kind: 'units', unitIds: [unitId] }, availability: 'closed', requiredInSeries: false },
    }));
    const e2h = (await viaEndpoint(om.id, h2, 'Paper 2H only (endpoint)'))!.id;
    const e2 = (await viaEndpoint(ob.id, c2, 'Paper 2 only (endpoint)'))!.id;
    expect(await keysOf(e2h)).toEqual([{ key_kind: 'unit', key_id: h2 }]);
    expect(await keysOf(e2)).toEqual([{ key_kind: 'option', key_id: cx }]);

    // The rule is the board's, changed on the Catalogue's board card by the admin alone and with a reason kept in the
    // audit row (the review of 744e553, item 1; MO-10's deadline is the precedent): OxfordAQA, set and set back.
    const oxford = boards.find((b) => b.code === 'oxford')!;
    const putOxford = (who: Client, json: { onePaperFeeKey?: 'qualification' | 'unit'; reason?: string; notes?: string | null }) =>
      who.api.v1.catalogue.boards[':code'].$put({ param: { code: 'oxford' }, json });
    // The coordinator, who edits the rest of the board, is refused the rule; the admin is refused it without a reason.
    expect(await refused(putOxford(coordinator, { onePaperFeeKey: 'unit', reason: '08u F8-05: the coordinator tries' })))
      .toMatchObject({ status: 403, error: expect.stringContaining('Only an admin') });
    expect(await refused(putOxford(adm, { onePaperFeeKey: 'unit' }))).toMatchObject({ status: 400, error: expect.stringContaining('Say why') });
    expect((await apiResponse(coordinator.api.v1.catalogue.$get())).boards.find((b) => b.code === 'oxford')!.onePaperFeeKey).toBe('qualification');
    expect(await apiResponse(putOxford(coordinator, { notes: oxford.notes }))).toMatchObject({ code: 'oxford', onePaperFeeKey: 'qualification' });
    await apiResponse(putOxford(adm, { onePaperFeeKey: 'unit', reason: "08u F8-05: OxfordAQA's list prices a paper" }));
    expect(await one(`select previous_data->>'onePaperFeeKey' as was, new_data->>'onePaperFeeKey' as now, new_data->>'reason' as reason from audit_log where action = 'BOARD_UPDATED' and entity_id = 'oxford' order by created_at desc limit 1`))
      .toEqual({ was: 'qualification', now: 'unit', reason: "08u F8-05: OxfordAQA's list prices a paper" });
    await apiResponse(putOxford(adm, { onePaperFeeKey: oxford.onePaperFeeKey as 'qualification', reason: "08u F8-05: back to the syllabus's fee" }));
    expect((await apiResponse(coordinator.api.v1.catalogue.$get())).boards.find((b) => b.code === 'oxford')!.onePaperFeeKey).toBe('qualification');
  });

  it("the form's \"Paper N only\" reads the sheet's whole item's row, not the Catalogue's: a paper gained after the syllabus's option changed still reads the option this sheet enters (the reviewer's low note on answer 2)", async () => {
    // Cambridge 0972-like: one option code (CX) entering Paper 2 and Paper 4; the subject added while CX was the option.
    const syl = (await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
      json: { boardCode: 'cambridge', code: `N0972-${RUN}`, title: `Physics (08u note ${RUN})`, level: 'igcse', suite: 'Cambridge IGCSE', subjectArea: 'Physics', entryMethod: 'syllabus_option' },
    })))!.id;
    const [p2, p4, p6] = [await unit('cambridge', 'N22', 'Paper 2', 'igcse', 'component'), await unit('cambridge', 'N42', 'Paper 4', 'igcse', 'component'), await unit('cambridge', 'N62', 'Paper 6', 'igcse', 'component')];
    await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({ param: { id: syl }, json: { units: [p2, p4].map((unitId) => ({ unitId, requirement: 'required' as const })) } }));
    const cx = (await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].options.$post({ param: { id: syl }, json: { code: 'CX', label: 'Extended, Papers 2 and 4', unitIds: [p2, p4] } })))!.id;
    const physics = await subject(adm, `N972-PH-${RUN}`, `Physics O.L. (08u note ${RUN})`, { course: 12000, registration: 0 });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: physics }, json: { boardCode: 'cambridge', qualificationId: syl, unitIds: [], reason: '08u note: mapped' } }));
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: june }, json: { subjectId: physics, courseFee: 12000, teachers: [{ teacherId: t1, mode: 'in_school' }] } })))!;
    let o = await offerRow(june, made.id);
    const whole = o.items.find((i) => i.kind === 'whole')!;
    const keysOf = (itemId: string) => sql<{ key_kind: string; key_id: string }>(`select key_kind, key_id from session_offer_item_fee_key where item_id = $1 order by key_kind`, [itemId]);
    expect(await keysOf(whole.id)).toEqual([{ key_kind: 'option', key_id: cx }]);

    // The Catalogue then changes: CX retired for a new option CY that adds Paper 6, which the syllabus now requires.
    await apiResponse(coordinator.api.v1.catalogue.options[':id'].$put({ param: { id: cx }, json: { isActive: false } }));
    await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({ param: { id: syl }, json: { units: [p2, p4, p6].map((unitId) => ({ unitId, requirement: 'required' as const })) } }));
    const cy = (await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].options.$post({ param: { id: syl }, json: { code: 'CY', label: 'Extended, Papers 2, 4 and 6', unitIds: [p2, p4, p6] } })))!.id;
    o = await offerRow(june, made.id);
    expect(o.papersToAdd.map((p) => p.unitId)).toEqual([p6]);

    // "Paper 6 only" offered on the form: it reads the row this sheet's whole item reads (CX), as one made through the
    // item endpoint does — not CY, the option the Catalogue's whole item would enter now.
    expect(await apiResponse(save(coordinator, june, made.id, { ...asIs(o), items: [{ paperUnitId: p6, availability: 'retake_only' as const, courseFee: 3000 }] })))
      .toMatchObject({ itemsCreated: 1 });
    o = await offerRow(june, made.id);
    const paper6 = o.items.find((i) => i.kind === 'one_paper' && i.units.some((u) => u.unitId === p6))!;
    expect(await keysOf(paper6.id)).toEqual([{ key_kind: 'option', key_id: cx }]);
    expect(await keysOf(whole.id)).toEqual([{ key_kind: 'option', key_id: cx }]);
    expect(cy).not.toBe(cx);
  });

  it('an IAL subject per unit: a teacher per unit (P1 and P2 online), M1 with two, S1 self-study only, P4 not this cycle — the units keep their codes', async () => {
    await apiResponse(coordinator.api.v1.catalogue.starter.$post({ json: { set: 'pearson_ial_mathematics' } }));
    const units = await sql<{ id: string; code: string }>(`select id, code from exam_unit where board_code = 'pearson_edexcel' and code in $1`, [['WMA11', 'WMA12', 'WMA13', 'WMA14', 'WME01', 'WST01']]);
    const id = (code: string) => units.find((u) => u.code === code)!.id;
    const ial = await subject(adm, `U08-IAL-${RUN}`, `Mathematics A.S./A.L. (08u ${RUN})`, { course: 4000, registration: 4800 }, { council: 'pearson_edexcel', qualificationLevel: 'a_level' });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({
      param: { subjectId: ial }, json: { boardCode: 'pearson_edexcel', qualificationId: null, unitIds: ['WMA11', 'WMA12', 'WMA13', 'WMA14', 'WME01', 'WST01'].map(id), reason: '08u: the parent row' },
    }));
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: winter }, json: { subjectId: ial, courseFee: 4000, teachers: [{ teacherId: t1, mode: 'in_school' }] } })))!;
    let o = await offerRow(winter, made.id);
    const byCode = (code: string) => o.items.find((i) => i.units.some((u) => u.code === code))!;
    expect(o.items.map((i) => [i.label, i.kind, i.series?.month])).toEqual([
      ['P1', 'unit', 'october'], ['P2', 'unit', 'october'], ['P3', 'unit', 'october'], ['P4', 'unit', 'october'], ['M1', 'unit', 'october'], ['S1', 'unit', 'october'],
    ]);
    const r = await apiResponse(save(coordinator, winter, made.id, {
      ...asIs(o),
      items: [
        { itemId: byCode('WMA11').id, availability: 'open', courseFee: 4000, teachers: [{ teacherId: t1, mode: 'online' }] },
        { itemId: byCode('WMA12').id, availability: 'open', courseFee: 4000, teachers: [{ teacherId: t1, mode: 'online' }] },
        { itemId: byCode('WMA13').id, availability: 'open', courseFee: 4500, teachers: [] },
        { itemId: byCode('WMA14').id, availability: 'closed', courseFee: null },
        { itemId: byCode('WME01').id, availability: 'open', courseFee: null, teachers: [{ teacherId: t2, mode: 'in_school' }, { teacherId: t1, mode: 'in_school' }] },
        { itemId: byCode('WST01').id, availability: 'self_study_only', courseFee: 2000 },
      ],
    }));
    expect(r).toMatchObject({ changed: true, offer: false, itemsChanged: 6 });
    o = await offerRow(winter, made.id);
    expect(o.items.map((i) => [i.label, i.availability, i.courseFee, i.teachers.map((t) => `${t.teacherId === t1 ? 'T1' : 'T2'} ${t.mode}`)])).toEqual([
      ['P1', 'open', 4000, ['T1 online']], ['P2', 'open', 4000, ['T1 online']], ['P3', 'open', 4500, []], ['P4', 'closed', null, []],
      ['M1', 'open', null, ['T2 in_school', 'T1 in_school']], ['S1', 'self_study_only', 2000, []],
    ]);
    // The family's form: P1 taught online by Teacher One, P3 by the subject's teachers, S1 in self-study only, no P4.
    const sub = (await apiResponse(preview(adm, winter))).offers.find((x) => x.id === made.id)!;
    expect(sub.items.map((i) => [i.label, i.teachers.map((t) => t.mode), i.prices.map((p) => `${p.attempt} ${p.mode}`)])).toEqual([
      ['P1', ['online'], ['first in_school', 'retake in_school', 'retake self_study']],
      ['P2', ['online'], ['first in_school', 'retake in_school', 'retake self_study']],
      ['P3', ['in_school'], ['first in_school', 'retake in_school', 'retake self_study']],
      ['M1', ['in_school', 'in_school'], ['first in_school', 'retake in_school', 'retake self_study']],
      // A self-study entry names no teacher on the family's form (the row says "self-study"), whatever the read lists.
      // Self study is a second entry (the lead's decision of 16 Oct 2026, FEATURES_PLAN.md §6, 1): S1 takes no first entry.
      ['S1', ['in_school'], ['retake self_study']],
    ]);
  });

  it("decision 2 (16 Oct 2026): a unit of a units-cash-in award (an IAL's) sits in October, January or June — the form refuses November for it, nothing moved, and takes January; a unit that enters no cash-in award keeps every month its board sits", async () => {
    // The IAL subject of the scenario above, on the winter sheet: the sheet's read says its units are an IAL's.
    let o = (await list(winter)).offers.find((x) => x.subject.name === `Mathematics A.S./A.L. (08u ${RUN})`)!;
    expect(o.items.map((i) => [i.label, i.ialUnit, i.series?.month])).toEqual([
      ['P1', true, 'october'], ['P2', true, 'october'], ['P3', true, 'october'], ['P4', true, 'october'], ['M1', true, 'october'], ['S1', true, 'october'],
    ]);
    const p3 = o.items.find((i) => i.label === 'P3')!;
    const unitForm = (month: 'november' | 'january'): FormJson => ({ ...asIs(o), items: [{ itemId: p3.id, availability: 'open', courseFee: 4500, teachers: [], seriesMonth: month }] });
    const before = await auditCount([o.id, p3.id]);
    expect(await refused(save(coordinator, winter, o.id, unitForm('november'))))
      .toEqual({ status: 400, error: `Mathematics A.S./A.L. (08u ${RUN}) — P3: an IAL unit sits in October, January or June, not November` });
    expect((await offerRow(winter, o.id)).items.find((i) => i.id === p3.id)!.series?.month).toBe('october');
    expect(await auditCount([o.id, p3.id])).toBe(before);
    expect(await apiResponse(save(coordinator, winter, o.id, unitForm('january')))).toMatchObject({ changed: true, itemsChanged: 1 });
    o = await offerRow(winter, o.id);
    expect(o.items.find((i) => i.id === p3.id)!.series?.month).toBe('january');
    // Units the catalogue ties to no cash-in award: November, a month the board sits, is taken.
    const [n1, n2] = [await unit('pearson_edexcel', 'UNV1', 'Unit A', 'as', 'unit'), await unit('pearson_edexcel', 'UNV2', 'Unit B', 'as', 'unit')];
    const plain = await subject(adm, `U08-NV-${RUN}`, `Units with no cash-in (08u ${RUN})`, { course: 2000, registration: 4790 }, { council: 'pearson_edexcel', qualificationLevel: 'as_level' });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: plain }, json: { boardCode: 'pearson_edexcel', qualificationId: null, unitIds: [n1, n2], reason: '08u: units of no award' } }));
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: winter }, json: { subjectId: plain, courseFee: 2000, teachers: [{ teacherId: t1, mode: 'in_school' }] } })))!;
    const row = await offerRow(winter, made.id);
    expect(row.items.map((i) => [i.label, i.ialUnit, i.series?.month])).toEqual([['Unit A', false, 'october'], ['Unit B', false, 'october']]);
    expect(await apiResponse(save(coordinator, winter, made.id, { ...asIs(row), items: [{ itemId: row.items[0]!.id, availability: 'open', courseFee: null, teachers: [], seriesMonth: 'november' }] })))
      .toMatchObject({ changed: true, itemsChanged: 1 });
    expect((await offerRow(winter, made.id)).items[0]!.series?.month).toBe('november');
  });

  it('two units moved to another sitting in one save carry their reservations, each line with its own audit row (the series move, every move at once)', async () => {
    const oct = await mkSeries('pearson_edexcel', 'october', Y, `u08-${RUN}`);
    const [u1, u2] = [await unit('pearson_edexcel', 'UMV1', 'Unit 1', 'as', 'unit'), await unit('pearson_edexcel', 'UMV2', 'Unit 2', 'as', 'unit')];
    await fee(oct, 'unit', u1, 4790);
    await fee(oct, 'unit', u2, 4790);
    const bio = await subject(adm, `U08-BI-${RUN}`, `Biology A.S./A.L. (08u ${RUN})`, { course: 2000, registration: 4790 }, { council: 'pearson_edexcel', qualificationLevel: 'as_level' });
    const unitItem = (label: string, unitId: string) => ({ label, kind: 'unit' as const, enters: { kind: 'units' as const, unitIds: [unitId] }, boardSeriesId: oct, availability: 'open' as const, requiredInSeries: false });
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({
      param: { id: winter }, json: { subjectId: bio, courseFee: 2000, teachers: [{ teacherId: t1, mode: 'in_school' }], items: [unitItem('Unit 1', u1), unitItem('Unit 2', u2)] },
    })))!;
    const [i1, i2] = made.items as [string, string];
    const fa = await onboard(officer, `u08-mv-a-${RUN}`, 12);
    const fb = await onboard(officer, `u08-mv-b-${RUN}`, 12);
    await reserve(fa.studentId, winter, [{ offerItemId: i1, attempt: 'first', mode: 'in_school', teacherId: t1 }, { offerItemId: i2, attempt: 'first', mode: 'in_school', teacherId: t1 }]);
    await reserve(fb.studentId, winter, [{ offerItemId: i2, attempt: 'first', mode: 'in_school', teacherId: t1 }]);
    const lines = await sql<{ id: string; item: string }>(`select id, offer_item_id as item from registration where offer_item_id in $1 order by id`, [[i1, i2]]);
    expect(lines).toHaveLength(3);
    const o = await offerRow(winter, made.id);
    const r = await apiResponse(save(coordinator, winter, made.id, {
      ...asIs(o), reason: 'Units 1 and 2 are sat in January',
      items: [i1, i2].map((itemId) => ({ itemId, availability: 'open' as const, courseFee: null, seriesMonth: 'january' as const })),
    }));
    expect(r).toMatchObject({ changed: true, itemsChanged: 2, linesMoved: 3 });
    const jan = (await one<{ id: string }>(`select id from board_series where board_code = 'pearson_edexcel' and month = 'january' and year = $1 and label = ''`, [Y + 1])).id;
    expect(await sql(`select board_series_id as s from registration where id in $1`, [lines.map((l) => l.id)])).toEqual(lines.map(() => ({ s: jan })));
    expect((await sql<{ s: string }>(`select board_series_id as s from session_offer_item where id in $1`, [[i1, i2]])).map((x) => x.s)).toEqual([jan, jan]);
    // Every moved line has its own row, every item its own with the lines it moved.
    for (const l of lines) {
      expect(await one(`select new_data->>'boardSeriesId' as s, new_data->>'reason' as why from audit_log where action = 'LINE_SERIES_MOVED' and entity_id = $1`, [l.id]))
        .toEqual({ s: jan, why: 'Units 1 and 2 are sat in January' });
    }
    expect(await sql(`select entity_id as e, new_data->>'linesMoved' as n from audit_log where action = 'OFFER_ITEM_SERIES_CHANGED' and entity_id in $1 order by entity_id`, [[i1, i2]]))
      .toEqual([{ e: i1, n: '1' }, { e: i2, n: '2' }].sort((a, b) => a.e.localeCompare(b.e)));

    // The review of F6a, finding 4: a unit whose reservation is past its deadline where it is does not move —
    // refused in the form's words (reservations, the sitting), with its Arabic in i18n-sessions.ts.
    const u3 = await unit('pearson_edexcel', 'UMV3', 'Unit 3', 'as', 'unit');
    await fee(oct, 'unit', u3, 4790);
    const i3 = (await apiResponse(coordinator.api.v1.sessions[':id'].offers[':offerId'].items.$post({ param: { id: winter, offerId: made.id }, json: unitItem('Unit 3', u3) })))!.id;
    const [l3] = await reserve(fa.studentId, winter, [{ offerItemId: i3, attempt: 'first', mode: 'in_school', teacherId: t1 }]);
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [oct]);
    try {
      const o3 = await offerRow(winter, made.id);
      expect(await refused(save(coordinator, winter, made.id, { ...asIs(o3), items: [{ itemId: i3, availability: 'open', courseFee: null, seriesMonth: 'january' }] }))).toEqual({
        status: 409, error: expect.stringMatching(/^Unit 3 has reservations past their deadline in the sitting it is entered in \(.+\): their entries stand$/),
      });
    } finally {
      await sql(`update board_series set entry_deadline = now() + interval '60 days' where id = $1`, [oct]);
    }
    expect(await one(`select board_series_id as s from registration where id = $1`, [l3!.id])).toEqual({ s: oct });
  });

  it("a Cambridge A level's three routes: A.S. offered at its fee, A.2. carry forward self-study only, A.L. not this cycle", async () => {
    const code = `U9702-${RUN}`;
    const asQ = (await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({ json: { boardCode: 'cambridge', code, title: `Physics AS (08u ${RUN})`, level: 'as_level', suite: 'Cambridge International AS & A Level', subjectArea: 'Physics', entryMethod: 'syllabus_option' } })))!.id;
    const alQ = (await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({ json: { boardCode: 'cambridge', code, title: `Physics A Level (08u ${RUN})`, level: 'a_level', suite: 'Cambridge International AS & A Level', subjectArea: 'Physics', entryMethod: 'syllabus_option' } })))!.id;
    await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].options.$post({ param: { id: asQ }, json: { code: 'S1', label: 'A.S.', unitIds: [], carryForward: false } }));
    await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].options.$post({ param: { id: alQ }, json: { code: 'BX', label: 'A.2. (carry forward)', unitIds: [], carryForward: true } }));
    await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].options.$post({ param: { id: alQ }, json: { code: 'AX', label: 'A.L.', unitIds: [], carryForward: false } }));
    const phys = await subject(adm, `U08-PH-${RUN}`, `Physics A.S./A.L. (08u ${RUN})`, { course: 14000, registration: 14100 }, { qualificationLevel: 'as_level' });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: phys }, json: { boardCode: 'cambridge', qualificationId: asQ, unitIds: [], reason: '08u: mapped' } }));
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: june }, json: { subjectId: phys, courseFee: 14000, teachers: [{ teacherId: t1, mode: 'in_school' }] } })))!;
    let o = await offerRow(june, made.id);
    const route = (label: string) => o.items.find((i) => i.label === label)!;
    // The catalogue's order (generateItems: by level, then option code); the screen orders them A.S., A.2., A.L.
    expect(o.items.map((i) => [i.label, i.kind, i.qualification?.level, i.needsPriorSeries, i.exclusiveGroup])).toEqual([
      ['A.L.', 'route', 'a_level', false, 'route'], ['A.2. (carry forward)', 'route', 'a_level', true, 'route'], ['A.S.', 'route', 'as_level', false, 'route'],
    ]);
    await apiResponse(save(coordinator, june, made.id, {
      ...asIs(o),
      items: [
        { itemId: route('A.S.').id, availability: 'open', courseFee: 14000 },
        { itemId: route('A.2. (carry forward)').id, availability: 'self_study_only', courseFee: 11400 },
        { itemId: route('A.L.').id, availability: 'closed', courseFee: null },
      ],
    }));
    o = await offerRow(june, made.id);
    expect(o.items.map((i) => [i.label, i.availability, i.courseFee])).toEqual([
      ['A.L.', 'closed', null], ['A.2. (carry forward)', 'self_study_only', 11400], ['A.S.', 'open', 14000],
    ]);
    const sub = (await apiResponse(preview(coordinator, june))).offers.find((x) => x.id === made.id)!;
    expect(sub.items.map((i) => [i.label, i.needsPriorSeries, i.prices.map((p) => `${p.attempt} ${p.mode}`)])).toEqual([
      ['A.2. (carry forward)', true, ['first self_study', 'retake self_study']],
      ['A.S.', false, ['first in_school', 'retake in_school', 'retake self_study']],
    ]);
  });

  it('"Retake (Self Study ONLY)" at a course fee of 0 says why; an open subject nobody teaches is refused in the form\'s words; nothing is half-saved', async () => {
    const env = await subject(adm, `U08-EM-${RUN}`, `Environmental Management O.L. (08u ${RUN})`, { course: 9000, registration: 9850 });
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: june }, json: { subjectId: env, courseFee: 9000, teachers: [{ teacherId: t2, mode: 'in_school' }] } })))!;
    const o = await offerRow(june, made.id);
    const name = `Environmental Management O.L. (08u ${RUN})`;
    // Nobody teaches it and it is still offered for first entries: "Who teaches it?".
    expect(await refused(save(coordinator, june, made.id, { ...asIs(o), teachers: [], notes: 'no teacher this cycle' }))).toEqual({
      status: 400, error: `Who teaches ${name}? An open subject names its teachers — or make it self-study only`,
    });
    // Retake (Self Study ONLY) at 0, with no reason: refused, and the notes did not land either.
    expect(await refused(save(coordinator, june, made.id, { ...asIs(o), teachers: [], availability: 'self_study_only', courseFee: 0, notes: 'no teacher this cycle' }))).toEqual({
      status: 400, error: `${name} is self-study only at a course fee of 0: say why (its lines are priced at the board fee alone)`,
    });
    expect(await one(`select availability, course_fee::float as fee, notes, (select count(*) from session_offer_teacher t where t.offer_id = o.id)::int as teachers from session_offer o where id = $1`, [made.id]))
      .toEqual({ availability: 'open', fee: 9000, notes: null, teachers: 1 });
    // With the reason: saved, the reason on the audit row.
    await apiResponse(save(coordinator, june, made.id, { ...asIs(o), teachers: [], availability: 'self_study_only', courseFee: 0, zeroFeeReason: 'priced at the board fee alone this cycle', notes: 'no teacher this cycle' }));
    expect(await one(`select availability, course_fee::float as fee, notes from session_offer where id = $1`, [made.id])).toEqual({ availability: 'self_study_only', fee: 0, notes: 'no teacher this cycle' });
    expect(await one(`select new_data->>'zeroFeeReason' as why from audit_log where action = 'SESSION_OFFER_UPDATED' and entity_id = $1 order by created_at desc limit 1`, [made.id]))
      .toEqual({ why: 'priced at the board fee alone this cycle' });
  });

  it('"Not offered this cycle" while reservations stand is refused with its sentence — the subject and a paper alike — and saved once the form says they stand', async () => {
    const series = await mkSeries('cambridge', 'june', Y + 1, `u08-${RUN}`);
    const prior = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'november', year: Y, label: `u08-${RUN}` } })))!.id;
    const chem = await subject(adm, `U08-CH-${RUN}`, `Chemistry O.L. (08u ${RUN})`, { course: 12000, registration: 10850 });
    await fee(series, 'subject', chem, 10850);
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({
      param: { id: june }, json: {
        subjectId: chem, courseFee: 12000, teachers: [{ teacherId: t1, mode: 'in_school' }],
        items: [
          { label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: series, availability: 'open', requiredInSeries: false, exclusiveGroup: 'entry' },
          { label: 'Paper 4 only (retake)', kind: 'one_paper', enters: { kind: 'subject' }, boardSeriesId: series, availability: 'retake_only', courseFee: 3000, requiredInSeries: false, exclusiveGroup: 'entry' },
        ],
      },
    })))!;
    const [whole, paper] = made.items as [string, string];
    const fa = await onboard(officer, `u08-no-a-${RUN}`, 11);
    const fb = await onboard(officer, `u08-no-b-${RUN}`, 11);
    const [lw] = await reserve(fa.studentId, june, [{ offerItemId: whole, attempt: 'first', mode: 'in_school', teacherId: t1 }]);
    const [lp] = await reserve(fb.studentId, june, [{ offerItemId: paper, attempt: 'retake', mode: 'self_study', priorSittingSeriesId: prior, priorSittingSource: 'declared_by_desk' }]);
    const o = await offerRow(june, made.id);
    const name = `Chemistry O.L. (08u ${RUN})`;
    const before = await auditCount([made.id, whole, paper]);
    // The subject: two reservations.
    expect(await refused(save(coordinator, june, made.id, { ...asIs(o), availability: 'closed' }))).toEqual({
      status: 409, error: `${name} has 2 reservations: they stand when it is not offered this cycle, and no new one is taken. Tick "Its 2 reservations stand" to save`,
    });
    // The paper: one.
    expect(await refused(save(coordinator, june, made.id, { ...asIs(o), items: [{ itemId: paper, availability: 'closed', courseFee: 3000 }] }))).toEqual({
      status: 409, error: `${name} — Paper 4 only (retake) has 1 reservation: it stands when it is not offered this cycle, and no new one is taken. Tick "Its reservation stands" to save`,
    });
    expect(await auditCount([made.id, whole, paper])).toBe(before);
    expect(await one(`select availability from session_offer where id = $1`, [made.id])).toEqual({ availability: 'open' });
    // Said: the paper is not offered, then the subject; the reservations stand.
    await apiResponse(save(coordinator, june, made.id, { ...asIs(o), items: [{ itemId: paper, availability: 'closed', courseFee: 3000 }], linesStand: true }));
    expect(await one(`select availability from session_offer_item where id = $1`, [paper])).toEqual({ availability: 'closed' });
    await apiResponse(save(coordinator, june, made.id, { ...asIs(o), availability: 'closed', linesStand: true }));
    expect(await one(`select availability from session_offer where id = $1`, [made.id])).toEqual({ availability: 'closed' });
    expect(await sql(`select status from registration where id in $1`, [[lw!.id, lp!.id]])).toEqual([{ status: 'pending_payment' }, { status: 'pending_payment' }]);
  });

  it('a full form as the screen builds it — units with their teachers and sittings, two qualifications with theirs — saved again as it stands changes nothing and writes no audit row (the review of F6a, finding 7)', async () => {
    // What the screen sends on Save (subjects-tab.client.tsx body()): every paper, route, unit and qualification
    // row it shows, with its availability and fee; a unit's and a qualification's own teachers; here a unit's
    // sitting too, as it stands (the screen sends it only when changed: this is the stricter form).
    const screenForm = (o: Awaited<ReturnType<typeof offerRow>>): FormJson => {
      const withQualifications = o.items.some((i) => i.kind === 'qualification');
      return {
        ...asIs(o),
        items: o.items
          .filter((i) => ['one_paper', 'route', 'unit', 'qualification'].includes(i.kind) || (i.kind === 'whole' && withQualifications))
          .map((i) => ({
            itemId: i.id, availability: i.availability as FormJson['availability'], courseFee: i.courseFee,
            ...(i.kind === 'unit' || i.kind === 'qualification' || i.kind === 'whole' ? { teachers: i.teachers.map((t) => ({ teacherId: t.teacherId, mode: t.mode as 'in_school' | 'online' })) } : {}),
            ...(i.kind === 'unit' && i.series ? { seriesMonth: i.series.month as 'october' | 'november' | 'january' | 'june' } : {}),
          })),
      };
    };
    // An IAL subject of two units in the winter session: Unit 1 taught online by Teacher One, Unit 2 self-study only in January.
    const [f1, f2] = [await unit('pearson_edexcel', 'UFF1', 'Unit 1', 'as', 'unit'), await unit('pearson_edexcel', 'UFF2', 'Unit 2', 'as', 'unit')];
    const ial = await subject(adm, `U08-FF-${RUN}`, `Full form IAL (08u ${RUN})`, { course: 3000, registration: 4790 }, { council: 'pearson_edexcel', qualificationLevel: 'a_level' });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: ial }, json: { boardCode: 'pearson_edexcel', qualificationId: null, unitIds: [f1, f2], reason: '08u: the parent row' } }));
    const madeIal = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: winter }, json: { subjectId: ial, courseFee: 3000, teachers: [{ teacherId: t2, mode: 'in_school' }] } })))!;
    let o = await offerRow(winter, madeIal.id);
    const [it1, it2] = o.items as [typeof o.items[number], typeof o.items[number]];
    await apiResponse(save(coordinator, winter, madeIal.id, { ...asIs(o), items: [
      { itemId: it1.id, availability: 'open', courseFee: 3500, teachers: [{ teacherId: t1, mode: 'online' }], seriesMonth: 'october' },
      { itemId: it2.id, availability: 'self_study_only', courseFee: 1500, teachers: [], seriesMonth: 'january' },
    ] }));
    o = await offerRow(winter, madeIal.id);
    expect(o.items.map((i) => [i.label, i.availability, i.courseFee, i.teachers.map((t) => t.mode), i.series?.month])).toEqual([
      ['Unit 1', 'open', 3500, ['online'], 'october'], ['Unit 2', 'self_study_only', 1500, [], 'january'],
    ]);
    // Two qualifications under one subject (Arabic A Level, Edexcel), each with its teacher, made through the item endpoint.
    const qi = (await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({ json: { boardCode: 'pearson_edexcel', code: `UYA-${RUN}`, title: `Arabic IAL (08u ${RUN})`, level: 'a_level', suite: 'International A Level', subjectArea: 'Arabic', entryMethod: 'units_cash_in' } })))!.id;
    const qg = (await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({ json: { boardCode: 'pearson_edexcel', code: `UGA-${RUN}`, title: `Arabic GCE (08u ${RUN})`, level: 'a_level', suite: 'GCE A Level', subjectArea: 'Arabic', entryMethod: 'qualification' } })))!.id;
    const ar = await subject(adm, `U08-ARA-${RUN}`, `Arabic A.L. (08u ${RUN})`, { course: 9000, registration: 8950 }, { council: 'pearson_edexcel', qualificationLevel: 'a_level' });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: ar }, json: { boardCode: 'pearson_edexcel', qualificationId: qi, unitIds: [], reason: '08u: the IAL award' } }));
    const madeAr = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: winter }, json: { subjectId: ar, courseFee: 9000, teachers: [{ teacherId: t1, mode: 'in_school' }, { teacherId: t2, mode: 'in_school' }] } })))!;
    const wholeAr = madeAr.items[0]!;
    await apiResponse(coordinator.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({ param: { id: winter, offerId: madeAr.id, itemId: wholeAr }, json: { label: 'Arabic IAL', exclusiveGroup: 'qualification', teachers: [{ teacherId: t1, mode: 'in_school' }] } }));
    await apiResponse(coordinator.api.v1.sessions[':id'].offers[':offerId'].items.$post({ param: { id: winter, offerId: madeAr.id }, json: {
      label: 'Arabic GCE', kind: 'qualification', enters: { kind: 'award', qualificationId: qg }, availability: 'open', requiredInSeries: false,
      exclusiveGroup: 'qualification', teachers: [{ teacherId: t2, mode: 'in_school' }],
    } }));
    // Both forms sent as they stand: nothing changes, no audit row, for the subjects or any of their rows.
    for (const offerId of [madeIal.id, madeAr.id]) {
      const now = await offerRow(winter, offerId);
      const ids = [offerId, ...now.items.map((i) => i.id)];
      const before = await auditCount(ids);
      const form = screenForm(now);
      expect(form.items?.length).toBe(2);
      expect(await apiResponse(save(coordinator, winter, offerId, form))).toEqual({ offer: false, itemsChanged: 0, itemsCreated: 0, linesMoved: 0, changed: false });
      expect(await auditCount(ids)).toBe(before);
      expect(await offerRow(winter, offerId)).toEqual(now);
    }
  });

  it("F8-04: Arabic A.L.'s second qualification from the subject's form — the board's other award of the area and level in another suite is offered, made through the item endpoint with its own teacher, one choice with the subject's own", async () => {
    const award = async (code: string, title: string, suite: string, entryMethod: 'units_cash_in' | 'qualification') =>
      (await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({ json: { boardCode: 'pearson_edexcel', code: `${code}-${RUN}`, title: `${title} (08u ${RUN})`, level: 'a_level', suite, subjectArea: `Arabic F804 ${RUN}`, entryMethod } })))!.id;
    const ial = await award('FYA', 'Arabic IAL', 'International A Level', 'units_cash_in');
    const gce = await award('FGA', 'Arabic GCE', 'GCE A Level', 'qualification');
    // An older award of the same suite is a replacement, not a second qualification: not offered.
    const oldIal = await award('FYO', 'Arabic IAL, old specification', 'International A Level', 'units_cash_in');
    const ar = await subject(adm, `F804-AR-${RUN}`, `Arabic A.L. (08u F8-04 ${RUN})`, { course: 9000, registration: 0 }, { council: 'pearson_edexcel', qualificationLevel: 'a_level' });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: ar }, json: { boardCode: 'pearson_edexcel', qualificationId: ial, unitIds: [], reason: '08u F8-04: the IAL award' } }));
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: june }, json: { subjectId: ar, courseFee: 9000, teachers: [{ teacherId: t1, mode: 'in_school' }, { teacherId: t2, mode: 'in_school' }] } })))!;
    let o = await offerRow(june, made.id);
    expect(o.qualificationsToAdd.map((q) => [q.id, q.code])).toEqual([[gce, `FGA-${RUN}`.toUpperCase()]]);
    expect(o.qualificationsToAdd.map((q) => q.id)).not.toContain(oldIal);
    const whole = o.items.find((i) => i.kind === 'whole')!;
    expect(whole.exclusiveGroup).toBeNull();

    // What the form's "Add a qualification" sends (subjects-tab.client.tsx AddQualification): the subject's own item into one group, then the new one.
    const before = await auditCount([whole.id]);
    await apiResponse(coordinator.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({
      param: { id: june, offerId: made.id, itemId: whole.id }, json: { exclusiveGroup: 'qualification', reason: `Edexcel FGA-${RUN} is added beside it: one qualification or the other` },
    }));
    const second = (await apiResponse(coordinator.api.v1.sessions[':id'].offers[':offerId'].items.$post({
      param: { id: june, offerId: made.id },
      json: { label: `Edexcel FGA-${RUN}`.toUpperCase(), kind: 'qualification', enters: { kind: 'award', qualificationId: gce }, availability: 'open', requiredInSeries: false, exclusiveGroup: 'qualification', teachers: [{ teacherId: t2, mode: 'in_school' }], courseFee: null,
        sortOrder: Math.max(0, ...o.items.map((i) => i.sortOrder)) + 1 },
    })))!.id;
    expect(await auditCount([whole.id])).toBe(before + 1);
    expect(await one(`select action from audit_log where entity_id = $1`, [second])).toEqual({ action: 'OFFER_ITEM_CREATED' });

    o = await offerRow(june, made.id);
    expect(o.qualificationsToAdd).toEqual([]);
    expect(o.items.map((i) => [i.kind, i.entersKind, i.qualificationId, i.exclusiveGroup, i.teachers.map((t) => t.teacherId)])).toEqual([
      ['whole', 'award', ial, 'qualification', []],
      ['qualification', 'award', gce, 'qualification', [t2]],
    ]);
    // The family's form: the second qualification with its own teacher, named by its code beside the teacher (decision 3).
    const pv = await apiResponse(preview(coordinator, june));
    const row = pv.offers.find((x) => x.id === made.id)!;
    expect(row.items.map((i) => [i.kind, i.qualification?.code, i.exclusiveGroup, i.teachers.map((t) => t.id)])).toEqual([
      ['whole', `FYA-${RUN}`.toUpperCase(), 'qualification', [t1, t2]],
      ['qualification', `FGA-${RUN}`.toUpperCase(), 'qualification', [t2]],
    ]);
    // One qualification or the other: both together are refused.
    const f = await onboard(officer, `u08-f804-${RUN}`, 12);
    const { db } = await import('@repo/db');
    const { assertLineRules } = await import('../src/services/line-rules.services');
    const { assertMayRegisterForInTx } = await import('../src/services/eligibility.services');
    await expect(db.transaction(async (tx) => {
      const eligibility = await assertMayRegisterForInTx(tx, f.studentId, june);
      await assertLineRules(tx, { studentId: f.studentId, sessionId: june, eligibility }, [
        { offerItemId: whole.id, attempt: 'first', mode: 'in_school', priorSittingSeriesId: null },
        { offerItemId: second, attempt: 'first', mode: 'in_school', priorSittingSeriesId: null },
      ]);
    })).rejects.toThrow('cannot be reserved together');

    // A subject mapped to its award and the award's units (one item per unit, no whole item) is offered no other
    // qualification: nothing would make the new one a choice against the units, so both could be reserved (the review
    // of 744e553, item 5). Only a subject whose own entry is a single whole item is (Arabic A.L. above).
    const byUnit = await award('FYB', 'Arabic IAL by unit', 'International A Level', 'units_cash_in');
    const [y1, y2] = [await unit('pearson_edexcel', 'FYU1', 'Unit 1', 'as', 'unit'), await unit('pearson_edexcel', 'FYU2', 'Unit 2', 'a2', 'unit')];
    await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({ param: { id: byUnit }, json: { units: [y1, y2].map((unitId) => ({ unitId, requirement: 'required' as const })) } }));
    const arUnits = await subject(adm, `F804-ARU-${RUN}`, `Arabic A.S./A.L. by unit (08u F8-04 ${RUN})`, { course: 4000, registration: 0 }, { council: 'pearson_edexcel', qualificationLevel: 'a_level' });
    await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: arUnits }, json: { boardCode: 'pearson_edexcel', qualificationId: byUnit, unitIds: [y1, y2], reason: '08u F8-04: the award and its units' } }));
    const perUnit = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: june }, json: { subjectId: arUnits, courseFee: 4000, teachers: [{ teacherId: t1, mode: 'in_school' }] } })))!;
    const pu = await offerRow(june, perUnit.id);
    expect(pu.items.map((i) => i.kind).sort()).toEqual(['unit', 'unit']);
    expect(pu.qualificationsToAdd).toEqual([]);
  });

  it('the same form twice changes nothing and writes no audit row; a form whose audit row cannot be written changes nothing (the rows commit with the change)', async () => {
    const fr = await subject(adm, `U08-FR-${RUN}`, `French O.L. (08u ${RUN})`, { course: 9000, registration: 12550 });
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({ param: { id: june }, json: { subjectId: fr, courseFee: 9000, teachers: [{ teacherId: t1, mode: 'in_school' }] } })))!;
    const o = await offerRow(june, made.id);
    const form: FormJson = {
      ...asIs(o), teachers: [{ teacherId: t1, mode: 'in_school' }, { providerName: `External team (08u ${RUN})`, mode: 'online' }], courseFee: 9500,
      grade10Core: true, courseStartsOn: `${Y}-09-20`, notes: '  Taught online by the external team  ',
    };
    expect(await apiResponse(save(coordinator, june, made.id, form))).toMatchObject({ changed: true, offer: true });
    const snapshot = async () => one(`select o.availability, o.course_fee::float as fee, o.grade10_core as core, o.course_starts_on::text as starts, o.notes,
      (select json_agg(json_build_object('t', t.teacher_id, 'm', t.mode) order by t.sort_order) from session_offer_teacher t where t.offer_id = o.id) as teachers,
      (select count(*) from teacher where kind = 'provider' and name = $1)::int as providers from session_offer o where o.id = $2`, [`External team (08u ${RUN})`, made.id]);
    const first = await snapshot();
    expect(first).toMatchObject({ fee: 9500, core: true, starts: `${Y}-09-20`, notes: 'Taught online by the external team', providers: 1 });
    const before = await auditCount([made.id, ...o.items.map((i) => i.id)]);
    expect(await apiResponse(save(coordinator, june, made.id, form))).toEqual({ offer: false, itemsChanged: 0, itemsCreated: 0, linesMoved: 0, changed: false });
    expect(await snapshot()).toEqual(first);
    expect(await auditCount([made.id, ...o.items.map((i) => i.id)])).toBe(before);

    // The item's audit row refused: the subject's change, written first, is undone with it.
    const item = o.items[0]!.id;
    const release = await refuseAudit('OFFER_ITEM_UPDATED');
    try {
      const r = await refused(save(coordinator, june, made.id, { ...form, courseFee: 9900, items: [{ itemId: item, availability: 'open', courseFee: 9000 }] }));
      expect(r.status).toBeGreaterThanOrEqual(400);
    } finally {
      await release();
    }
    expect(await snapshot()).toEqual(first);
    expect(await one(`select course_fee from session_offer_item where id = $1`, [item])).toEqual({ course_fee: null });
    expect(await auditCount([made.id, ...o.items.map((i) => i.id)])).toBe(before);
  });

  it('"One paper ONLY" is always a retake: a first entry on a one-paper item is refused, and the family\'s form offers none', async () => {
    const series = await mkSeries('cambridge', 'june', Y + 1, `u08-op-${RUN}`);
    const ict = await subject(adm, `U08-ICT-${RUN}`, `ICT O.L. (08u ${RUN})`, { course: 11000, registration: 12950 });
    await fee(series, 'subject', ict, 12950);
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({
      param: { id: june }, json: {
        subjectId: ict, courseFee: 11000, teachers: [{ teacherId: t2, mode: 'in_school' }],
        // A paper opened as the old drawer allowed, "open": first entries included, in the model's words.
        items: [{ label: 'Theory paper only (retake)', kind: 'one_paper', enters: { kind: 'subject' }, boardSeriesId: series, availability: 'open', courseFee: 2500, requiredInSeries: false }],
      },
    })))!;
    const f = await onboard(officer, `u08-op-${RUN}`, 11);
    await expect(reserve(f.studentId, june, [{ offerItemId: made.items[0]!, attempt: 'first', mode: 'in_school', teacherId: t2 }]))
      .rejects.toThrow(`ICT O.L. (08u ${RUN}) — Theory paper only (retake) is a retake of one paper: it takes no first entry`);
    // The family's read lists the retakes only.
    const fam = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: june, studentId: f.studentId } }));
    expect(fam.offers.find((x) => x.id === made.id)!.items[0]!.prices.map((p) => `${p.attempt} ${p.mode}`)).toEqual(['retake in_school', 'retake self_study']);
    expect(await sql(`select id from registration where student_id = $1`, [f.studentId])).toEqual([]);
  });

  it("the preview: the family's form for admin and coordinator, with no student's data in it — refused to families and to finance", async () => {
    const series = await mkSeries('cambridge', 'june', Y + 1, `u08-pv-${RUN}`);
    const ar = await subject(adm, `U08-AR-${RUN}`, `Arabic O.L. (08u ${RUN})`, { course: 10000, registration: 9850 });
    await fee(series, 'subject', ar, 9850);
    const made = (await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({
      param: { id: june }, json: { subjectId: ar, courseFee: 10000, teachers: [{ teacherId: t1, mode: 'in_school' }, { teacherId: t2, mode: 'online' }], items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: series, availability: 'open', requiredInSeries: false }] },
    })))!;
    const item = made.items[0]!;
    // A family with a discount and a reservation in this very subject.
    const f = await onboard(officer, `u08-pv-${RUN}`, 11);
    await apiResponse(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'price.discountPercent', studentId: f.studentId, scope: { sessionId: june }, value: 50, reason: '08u: siblings' } }));
    const [line] = await reserve(f.studentId, june, [{ offerItemId: item, attempt: 'first', mode: 'in_school', teacherId: t1 }]);
    expect(money((await one<{ p: string }>(`select price_at_registration as p from registration where id = $1`, [line!.id])).p)).toBe(9925);
    // The family's own read: its eligibility, its held line, its discounted prices.
    const fam = (await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: june, studentId: f.studentId } }))).offers.find((x) => x.id === made.id)!.items[0]!;
    expect(fam.held).toEqual({ registrationId: line!.id, status: 'pending_payment' });
    expect(fam.prices.find((p) => p.attempt === 'first')!.total).toBe(9925);

    for (const who of [adm, coordinator]) {
      const res = await preview(who, june);
      expect(res.status).toBe(200);
      const text = await res.clone().text();
      // Nothing of a student: no id, no name, no eligibility.
      for (const s of [f.studentId, `Student u08-pv-${RUN}`, f.parent.id, line!.id]) expect(text).not.toContain(s);
      const body = await apiResponse(Promise.resolve(res));
      expect('eligibility' in body).toBe(false);
      expect(body.preview).toBe(true);
      const it = body.offers.find((x) => x.id === made.id)!.items[0]!;
      expect(it.held).toBeNull();
      expect(it.knownSittings).toEqual([]);
      // The school's prices, no family's exception: a first entry 10,000 + 9,850; a self-study retake at the 50% share.
      expect(it.prices.map((p) => [p.attempt, p.mode, p.total])).toEqual([['first', 'in_school', 19850], ['retake', 'in_school', 19850], ['retake', 'self_study', 14850]]);
      expect(it.teachers.map((t) => [t.id, t.mode])).toEqual([[t1, 'in_school'], [t2, 'online']]);
      expect(body.offers.every((x) => x.items.every((i) => i.held === null && i.knownSittings.length === 0))).toBe(true);
    }
    // Families and finance: refused at the role gate.
    for (const who of [f.parent, f.student, officer, finadmin]) expect((await refused(preview(who, june))).status).toBe(403);
    expect((await refused(preview(coordinator, 'no-such-session'))).status).toBe(404);
  });
});
