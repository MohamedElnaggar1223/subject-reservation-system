import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, deriveSessionName } from '@repo/validations';
import {
  admin, staff, onboard, refused, one, sql, money, notified, confirmed, pauseAtAudit, lockWaiters, CONSENT, type Client, type Impact, cairoDateIn,
} from './helpers';
import { referenceFixture } from './reference-fixture';

/**
 * 08y — a session set up the way the coordinator works (COORDINATOR_REWORK.md P1a; Appendix A's
 * set-up routes, driven through the RPC client as her screen and the family page will drive them).
 *
 * The reference rows and the board rules (D1–D2, D6, E5), the subject editor's grid (D3) with D8's
 * groups and the generated wording in English and Arabic (D9), teachers with the duplicate check
 * (D4), the check list and C6's board date, prices final (E6) and a price changed after reservations
 * (E7) with the impact answered first and IMPACT_CHANGED, the self-study share (E4), a subject closed
 * and reopened (C4), refusals that protect reservations (§6), the live preview, the reservations
 * read, the copy with the year roll (C3), the session's switch, and her rights (B1–B3). Money is read
 * back from the database.
 *
 * The scenarios' sessions carry labels (each suite's own sittings); their sittings get their board
 * dates from the admin once, from the check list (C6's exception). Years: Y is this academic year's
 * June.
 */

const RUN = Math.random().toString(36).slice(2, 6);
const Y = academicYearStartOf() + 1;
const day = 86_400_000;

describe('08y: the coordinator sets up a session', () => {
  let adm: Client, coordinator: Client, officer: Client, finadmin: Client;
  let june: string;
  const label = `y08-${RUN}`;
  const offering: Record<string, string> = {};
  const row: Record<string, string> = {};
  let teacherA: string;
  let teacherB: string;

  const sessionOf = (who: Client, id: string) => apiResponse(who.api.v1.sessions[':id'].$get({ param: { id } }));
  const offeringOf = (who: Client, id: string) => apiResponse(who.api.v1.sessions[':id'].offerings[':offeringId'].$get({ param: { id: june, offeringId: id } }));
  const put = (who: Client, id: string, json: Parameters<Client['api']['v1']['sessions'][':id']['offerings'][':offeringId']['$put']>[0]['json']) =>
    who.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: june, offeringId: id }, json });
  const save = (id: string, json: Parameters<typeof put>[2]) => confirmed((expected?: Impact) => apiResponse(put(coordinator, id, { ...json, ...(expected ? { expected } : {}) })));
  const familyRead = (f: { parent: Client; studentId: string }, sessionId = june) =>
    apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId, studentId: f.studentId } }));
  const lineOf = (id: string) => one<{ status: string; price: number; course: number; exam: number; provisional: boolean; v: number }>(
    `select status, price_at_registration::float as price, course_fee_at_registration::float as course, registration_fee_at_registration::float as exam,
       price_provisional as provisional, (pricing_basis->>'v')::int as v from registration where id = $1`, [id]);
  const reserve = (f: { parent: Client; studentId: string }, lines: { offerItemId: string; attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study'; teacherId?: string; priorSittingSeriesId?: string }[]) =>
    f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines, consent: CONSENT } });

  beforeAll(async () => {
    adm = await admin(`y08-${RUN}`);
    coordinator = await staff(adm, 'coordinator', `y08-${RUN}`);
    officer = await staff(adm, 'finance_officer', `y08-${RUN}`);
    finadmin = await staff(adm, 'finance_admin', `y08-${RUN}`);
  });

  it('the reference data loads idempotently and reads back: the boards with their rules and sittings (levels, dates), the subjects with their suggested rows', async () => {
    const { db, loadReference } = await import('@repo/db');
    const data = referenceFixture();
    const first = await loadReference(db, data);
    expect(first).toMatchObject({ boards: 3, sittings: 7, subjects: 4, rows: 11, removedRows: 0 });
    const stamp = await sql<{ id: string; u: string }>(`select id, updated_at::text as u from board_series where dates_source = 'test fixture (08y)' order by id`);
    const second = await loadReference(db, data);
    expect(second).toEqual({ ...first, removedSubjects: 0, removedRows: 0 });
    expect(await sql(`select id, updated_at::text as u from board_series where dates_source = 'test fixture (08y)' order by id`)).toEqual(stamp);
    const boards = await apiResponse(coordinator.api.v1.reference.boards.$get());
    const cambridge = boards.find((b) => b.code === 'cambridge')!;
    expect(cambridge).toMatchObject({ onePaperFee: 'syllabus', onePaperAsksSitting: true, carryForwardMonths: 13 });
    expect(cambridge.aliases).toEqual([
      { printed: '9608 SY', subject: '9618', row: 'as', note: 'the previous syllabus code' },
      { printed: '9618 SX', subject: '9618', row: 'as', toCheck: true, note: 'printed once on a list; may be a misprint of 9618 S1' },
    ]);
    const pearson = boards.find((b) => b.code === 'pearson_edexcel')!;
    expect(pearson).toMatchObject({ onePaperFee: 'paper', onePaperAsksSitting: false });
    expect(pearson.sittings.find((s) => s.month === 'october' && s.year === Y + 6)).toMatchObject({ levels: ['as_al'], monthNumber: 10, confirmed: false });
    const subjects = await apiResponse(finadmin.api.v1.reference.subjects.$get({ query: { board: 'pearson_edexcel' } }));
    expect(subjects.map((s) => s.code)).toEqual(['4MA1', 'YAA01']);
    expect(subjects.find((s) => s.code === 'YAA01')!.rows.map((r) => [r.key, r.kind, r.winterSitting])).toEqual([['yaa01', 'qualification', null], ['waa01', 'unit', null], ['waa02', 'unit', 'none']]);
    // Families never read it.
    const f = await onboard(officer, `y08-ref-${RUN}`, 11);
    expect((await refused(f.parent.api.v1.reference.boards.$get())).status).toBe(403);
  });

  it('a June session from scratch: a type and a year, the name derived, born a draft (invisible to families), its default dates blocking the opening until she sets them or keeps them (C5)', async () => {
    const made = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y, label } }));
    june = made.id;
    expect(made).toMatchObject({ name: deriveSessionName('june', Y, label), status: 'draft', startDate: null, endDate: null, selfStudyPercent: 50, pricesFinal: false, unpaidCancelDays: 3, copy: null });
    expect(made.allowedGrades).toEqual(['11', '12', 'graduates']);
    expect(made.courseStartsOn).toBe(`${Y - 1}-10-01`);
    const s = await sessionOf(coordinator, june);
    expect(s.refundSentence).toBe('100% to week 2 · 50% in week 3 · 0% from week 4');
    expect(s.checkList.map((c) => [c.code, c.severity])).toEqual([['dates_to_check', 'blocks']]);
    expect(s.blocked).toBe(true);
    // Kept as they are, said so: the check list stops blocking on them (another session, so this one's dates are set below).
    const kept = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y, label: `${label}-kept` } }));
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: kept.id }, json: { datesConfirmed: true } }));
    expect(await sessionOf(coordinator, kept.id)).toMatchObject({ checkList: [], blocked: false, paymentDueAt: kept.paymentDueAt, courseStartsOn: kept.courseStartsOn });
    expect(await one(`select new_data->>'datesConfirmed' as kept from audit_log where action = 'SESSION_UPDATED' and entity_id = $1`, [kept.id])).toEqual({ kept: 'true' });
    // Said again (a second click): already so — saved quietly, nothing written.
    expect(await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: kept.id }, json: { datesConfirmed: true } }))).toMatchObject({ saved: true });
    expect(await sql(`select action from audit_log where entity_id = $1 and action = 'SESSION_UPDATED'`, [kept.id])).toHaveLength(1);
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: june }, json: { paymentDueAt: new Date(Date.now() + 40 * day), courseStartsOn: `${Y - 1}-10-04`, closesAt: new Date(Date.now() + 200 * day) } }));
    expect((await sessionOf(coordinator, june)).checkList).toEqual([]);
    // A session with its own start and end dates (the deprecated contract) is the admin's to make.
    const { LEGACY_CREATE_REFUSAL } = await import('../src/routes/session.routes');
    expect(await refused(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y, label: `${label}-dated`, startDate: new Date(Date.now() + day).toISOString(), endDate: new Date(Date.now() + 30 * day).toISOString(), courseStartsOn: `${Y - 1}-10-01`, paymentDueAt: new Date(Date.now() + 20 * day).toISOString() } })))
      .toEqual({ status: 403, error: LEGACY_CREATE_REFUSAL });
    expect(await sql(`select id from registration_session where label = $1`, [`${label}-dated`])).toEqual([]);
    // A start date (the deprecated contract) would let the scheduler open the draft past its check list: refused.
    expect(await refused(coordinator.api.v1.sessions[':id'].$put({ param: { id: june }, json: { startDate: new Date(Date.now() + day) } })))
      .toEqual({ status: 409, error: 'This draft opens with the Accepting switch once its check list is clear, not with a start date' });
    const f = await onboard(officer, `y08-draft-${RUN}`, 11);
    expect((await familyRead(f)).offerings).toEqual([]);
    expect(await sql(`select action from audit_log where entity_id = $1 order by created_at`, [june])).toEqual([{ action: 'SESSION_CREATED' }, { action: 'SESSION_UPDATED' }]);
  });

  it('subjects from the reference list come with their suggested rows, the usual offer ticked by default for her to confirm (D4): D8\'s groups, the board rule on a one-paper retake\'s earlier exam with D6\'s default list, the generated words; one not on the list; one twice is refused', async () => {
    const bio = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: june }, json: { referenceCode: '0970' } }));
    offering.bio = bio.id;
    expect(bio).toMatchObject({ subject: { name: 'Biology', code: '0970' }, referenceCode: '0970', board: { code: 'cambridge', onePaperFee: 'syllabus' }, group: 'O.L.', courseFee: null, offeredToFamilies: false });
    expect(bio.rows.map((r) => [r.kind, r.label, r.labelAr, r.exclusiveGroup, r.needsCarriedFrom, r.sitting])).toEqual([
      ['all_papers', 'All papers', 'كل الأوراق', 'entry', false, 'june'],
      ['paper', 'Paper 41/42 only', 'الورقة 41/42 فقط', 'entry', true, 'june'],
    ]);
    // D4: all papers first entry and both retakes, the one-paper retake both retakes — each tick a default, on her check list.
    expect(bio.rows.map((r) => [r.cells, r.cellsByDefault])).toEqual([
      [{ firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false }, ['firstInSchool', 'retakeInSchool', 'retakeSelfStudy']],
      [{ firstInSchool: false, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false }, ['retakeInSchool', 'retakeSelfStudy']],
    ]);
    expect((await sessionOf(coordinator, june)).checkList.filter((c) => c.offeringId === bio.id && c.code === 'ticked_by_default').map((c) => c.rowId)).toEqual(bio.rows.map((r) => r.id));
    // D6: the board's two sittings before this one (Cambridge sits June and November).
    expect(bio.rows[1]!.allowedPriorSittings.map((p) => [p.month, p.year, p.beyondCarryForward])).toEqual([['november', Y - 1, false], ['june', Y - 1, false]]);
    row.bioAll = bio.rows[0]!.id;
    row.bioPaper = bio.rows[1]!.id;

    const cs = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: june }, json: { referenceCode: '9618', board: 'cambridge' } }));
    offering.cs = cs.id;
    expect(cs.group).toBe('A.S./A.L.');
    expect(cs.rows.map((r) => [r.kind, r.label, r.exclusiveGroup, r.needsCarriedFrom])).toEqual([['as', 'A.S.', 'route', false], ['a2', 'A.2. (carry forward)', 'route', true], ['al', 'A.L.', 'route', false]]);
    // The A.2. (its own entry after the A.S., her call) starts unticked.
    expect(cs.rows.map((r) => r.cellsByDefault.length)).toEqual([3, 0, 3]);
    // E6: rows ticked with no price keep the subject from families.
    expect(cs).toMatchObject({ offeredToFamilies: false, priceNotSet: [cs.rows[0]!.id, cs.rows[2]!.id] });

    const maths = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: june }, json: { referenceCode: '4MA1' } }));
    offering.maths = maths.id;
    // Pearson Edexcel's International GCSE papers do not ask which exam they carry from (the board rule).
    expect(maths.rows.map((r) => [r.kind, r.label, r.needsCarriedFrom, r.allowedPriorSittings.length])).toEqual([
      ['all_papers', 'All papers', false, 0], ['paper', 'Paper 1H only', false, 0], ['paper', 'Paper 2H only', false, 0],
    ]);
    row.mathsAll = maths.rows[0]!.id;
    row.maths1h = maths.rows[1]!.id;
    row.maths2h = maths.rows[2]!.id;

    const gc = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: june }, json: { custom: { board: 'cambridge', name: `Global Citizenship ${RUN}`, level: 'igcse', group: 'O.L.' } } }));
    offering.gc = gc.id;
    expect(gc).toMatchObject({ notOnTheList: true, referenceCode: null, group: 'O.L.', rows: [] });
    expect(gc.subject.code).toBe(`X-cambridge-global-citizenship-${RUN}`);
    expect((await sessionOf(coordinator, june)).checkList.filter((c) => c.code === 'not_on_the_list').map((c) => c.offeringId)).toEqual([gc.id]);

    expect(await refused(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: june }, json: { referenceCode: '0970' } }))).toEqual({ status: 409, error: 'Biology is already in this session' });
    expect((await refused(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: june }, json: { referenceCode: '9999' } }))).status).toBe(404);
  });

  it('the subject editor: teachers (a name like one on the list refused until confirmed new), the cells, the fees and the note in one save; a one-paper row takes no first entry; the same body again writes nothing', async () => {
    teacherA = (await apiResponse(coordinator.api.v1.teachers.$post({ json: { name: `Huda Fawzy ${RUN}`, kind: 'person' } })))!.id;
    // D4: "Ms. Hoda …" against "Huda Fawzy …" — one person or two? Refused until she says so.
    const doubt = `Ms. Hoda Fawzy ${RUN}`;
    expect((await apiResponse(coordinator.api.v1.teachers.duplicates.$get({ query: { name: doubt } }))).duplicates.map((d) => [d.id, d.reason])).toEqual([[teacherA, 'spelling']]);
    expect(await refused(coordinator.api.v1.teachers.$post({ json: { name: doubt, kind: 'person' } }))).toMatchObject({ status: 409, error: expect.stringContaining('looks like') });
    const before = await sql(`select id from teacher where name = $1`, [doubt]);
    expect(before).toEqual([]);
    // The same doubt from the editor's new name, then confirmed new (an external team).
    const body = (confirmNew: boolean) => ({
      note: 'Practical work on Saturdays', courseFee: 3000,
      teachers: [{ teacherId: teacherA, online: true, external: false }, { newName: doubt, online: false, external: true, confirmNew }],
      rows: [
        { id: row.bioAll, kind: 'all_papers' as const, examFee: 10850, cells: { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false } },
        { id: row.bioPaper, kind: 'paper' as const, cells: { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: true, firstSelfStudy: false } },
      ],
    });
    expect(await refused(put(coordinator, offering.bio!, body(false)))).toMatchObject({ status: 409, error: expect.stringContaining(`"${doubt}" looks like`) });
    const saved = await apiResponse(put(coordinator, offering.bio!, body(true)));
    expect(saved).toMatchObject({ saved: true, impact: { repriced: 0, listedForFinance: 0, linesAffected: 0, dueDatesMoved: 0 } });
    teacherB = saved.offering.teachers.find((t) => t.name === doubt)!.teacherId;
    expect(saved.offering).toMatchObject({ note: 'Practical work on Saturdays', courseFee: 3000 });
    expect(saved.offering.teachers.map((t) => [t.name, t.online, t.external])).toEqual([[`Huda Fawzy ${RUN}`, true, false], [doubt, false, true]]);
    // E5: the one-paper retake's fee follows all papers by the board rule (Cambridge charges the syllabus's), in the same save.
    expect(saved.offering.rows.map((r) => [r.kind, r.cells, r.examFee, r.examFeeSource])).toEqual([
      ['all_papers', { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false }, 10850, 'typed'],
      ['paper', { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: true, firstSelfStudy: false }, 10850, 'board_rule'],
    ]);
    // Her change to the paper's cells makes them hers; all papers' default ticks, untouched, stay on the check list until she says they look right.
    expect(saved.offering.rows.map((r) => r.cellsByDefault.length)).toEqual([3, 0]);
    await apiResponse(put(coordinator, offering.bio!, { defaultsReviewed: true }));
    expect((await offeringOf(coordinator, offering.bio!)).rows.map((r) => r.cellsByDefault)).toEqual([[], []]);
    // The old columns kept in step for the reservation path P1b has not replaced yet.
    expect(await sql(`select kind, availability, exclusive_group as g from session_offer_item where offer_id = $1 order by sort_order`, [offering.bio!]))
      .toEqual([{ kind: 'all_papers', availability: 'open', g: 'entry' }, { kind: 'paper', availability: 'self_study_only', g: 'entry' }]);
    // Asked again, the board rule gives the same fee: nothing changes.
    expect(await apiResponse(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: june, rowId: row.bioPaper! }, json: { source: 'board_rule' } })))
      .toEqual({ saved: true, impact: { repriced: 0, listedForFinance: 0, linesAffected: 0, dueDatesMoved: 0 }, examFee: 10850, examFeeSource: 'board_rule' });
    expect((await offeringOf(coordinator, offering.bio!)).offeredToFamilies).toBe(true);
    // "One paper ONLY" is always a retake.
    expect(await refused(put(coordinator, offering.bio!, { rows: [
      { id: row.bioAll, kind: 'all_papers', cells: { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false } },
      { id: row.bioPaper, kind: 'paper', cells: { firstInSchool: true, retakeInSchool: false, retakeSelfStudy: true, firstSelfStudy: false } },
    ] }))).toEqual({ status: 400, error: 'A one-paper row is always a retake: it takes no first entry' });
    // The same body twice: nothing written, no audit row.
    const audits = async () => Number((await one<{ n: string }>(`select count(*) as n from audit_log where entity_id in ($1, $2, $3)`, [offering.bio!, row.bioAll!, row.bioPaper!])).n);
    const n = await audits();
    const again = await apiResponse(put(coordinator, offering.bio!, { ...body(true), teachers: [{ teacherId: teacherA, online: true, external: false }, { teacherId: teacherB, online: false, external: true }], rows: [
      { id: row.bioAll, kind: 'all_papers', examFee: 10850, cells: { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false } },
      { id: row.bioPaper, kind: 'paper', cells: { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: true, firstSelfStudy: false } },
    ] }));
    // Untick what the other subjects were ticked with by default: only Biology is offered in this scenario.
    for (const id of [offering.cs!, offering.maths!]) {
      const o = await offeringOf(coordinator, id);
      await apiResponse(put(coordinator, id, { rows: o.rows.map((r) => ({ id: r.id, kind: r.kind as 'all_papers', cells: { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: false, firstSelfStudy: false } })) }));
    }
    expect(again.saved).toBe(true);
    expect(await audits()).toBe(n);
  });

  it('the check list blocks opening on a sitting with no board date; the admin enters it once from the check list (C6) — only the admin, only a missing one, kept by the reference loader; she opens the session', async () => {
    const s = await sessionOf(coordinator, june);
    const blocking = s.checkList.filter((c) => c.severity === 'blocks');
    expect(blocking.map((c) => c.code)).toEqual(['sitting_no_board_date']);
    expect(s.blocked).toBe(true);
    const refusal = await refused(coordinator.api.v1.sessions[':id'].open.$post({ param: { id: june } }));
    expect(refusal).toMatchObject({ status: 409, error: expect.stringContaining('cannot open yet') });
    const enter = (who: Client, id: string, json: { entryDeadline: string; retakeDeadline?: string | null }) =>
      who.api.v1.reference.sittings[':id']['board-date'].$put({ param: { id }, json });
    const sittingId = blocking[0]!.seriesId!;
    // Dates as the board prints them; each stored as the end of that day in Cairo (20:59 UTC), as the reference data's are.
    const [entryDay, retakeDay] = [cairoDateIn(120), cairoDateIn(130)];
    expect((await refused(enter(coordinator, sittingId, { entryDeadline: entryDay }))).status).toBe(403);
    expect(await apiResponse(enter(adm, sittingId, { entryDeadline: entryDay, retakeDeadline: retakeDay })))
      .toMatchObject({ id: sittingId, entryDeadline: `${entryDay}T20:59:00.000Z`, retakeDeadline: `${retakeDay}T20:59:00.000Z`, datesSource: 'admin', linesRedated: 0 });
    expect(await one(`select to_char(entry_deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as entry, to_char(retake_deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as retake from board_series where id = $1`, [sittingId]))
      .toEqual({ entry: `${entryDay} 20:59`, retake: `${retakeDay} 20:59` });
    expect(await one(`select new_data->>'datesSource' as source, new_data->>'via' as via from audit_log where action = 'BOARD_SERIES_DEADLINE_SET' and entity_id = $1`, [sittingId]))
      .toEqual({ source: 'admin', via: 'the check list (C6: the admin enters a missing board date once)' });
    // Once: a sitting with its deadline is the reference data's.
    expect(await refused(enter(adm, sittingId, { entryDeadline: cairoDateIn(90) }))).toMatchObject({ status: 409, error: expect.stringContaining('has its board entry deadline') });
    // A date that is not a calendar day is refused.
    expect((await refused(enter(adm, sittingId, { entryDeadline: '2027-02-30' }))).status).toBe(400);
    expect((await sessionOf(coordinator, june)).blocked).toBe(false);

    // The reference loader keeps a deadline the admin entered — a sitting the file first gives none, entered by the
    // admin, then loaded again from a file that now gives another date — and says so (adminDatesKept).
    const { db, loadReference } = await import('@repo/db');
    const withSitting = (entryDeadline: string | null, retakeDeadline: string | null = null) => {
      const data = referenceFixture();
      data.boards = data.boards.map((b) => b.code !== 'oxford' ? b : { ...b, sittings: [...b.sittings, { ...b.sittings[0]!, month: 11 as const, levels: ['igcse' as const], entryDeadline, retakeDeadline }] });
      return data;
    };
    await loadReference(db, withSitting(null));
    const nov = (await one<{ id: string }>(`select id from board_series where board_code = 'oxford' and month = 'november' and year = $1 and label = ''`, [Y + 6])).id;
    const admins = cairoDateIn(100);
    await apiResponse(enter(adm, nov, { entryDeadline: admins }));
    // The file then gives both: her entry deadline is kept (and warned about, on its own); the retake deadline she left
    // empty is filled from the file.
    const reloaded = await loadReference(db, withSitting(`${Y + 6}-06-20`, `${Y + 6}-07-20`));
    expect(reloaded.adminDatesKept).toEqual([`oxford november ${Y + 6}: the file gives the entry deadline ${Y + 6}-06-20, the admin entered ${admins} — the admin's is kept; check which is right`]);
    expect(await one(`select to_char(entry_deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as entry, to_char(retake_deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as retake, dates_source as source from board_series where id = $1`, [nov]))
      .toEqual({ entry: `${admins} 20:59`, retake: `${Y + 6}-07-20 20:59`, source: 'admin' });
    // The retake deadline the file filled is the file's, not hers (P1b fix 3): a later file giving another one replaces it,
    // with no warning that she entered it; her entry deadline stays.
    expect(await one(`select admin_deadlines as mine from board_series where id = $1`, [nov])).toEqual({ mine: ['entry'] });
    const third = await loadReference(db, withSitting(`${Y + 6}-06-20`, `${Y + 6}-08-01`));
    expect(third.adminDatesKept).toEqual([`oxford november ${Y + 6}: the file gives the entry deadline ${Y + 6}-06-20, the admin entered ${admins} — the admin's is kept; check which is right`]);
    expect(await one(`select to_char(entry_deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as entry, to_char(retake_deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as retake from board_series where id = $1`, [nov]))
      .toEqual({ entry: `${admins} 20:59`, retake: `${Y + 6}-08-01 20:59` });
    // Her own retake deadline (entered with her entry deadline, on the session's sitting above) is hers: a file does not replace it.
    expect(await one(`select admin_deadlines as mine from board_series where id = $1`, [sittingId])).toEqual({ mine: ['entry', 'retake'] });
    const opened = await apiResponse(coordinator.api.v1.sessions[':id'].open.$post({ param: { id: june } }));
    expect(opened.status).toBe('active');
    expect(opened.startDate).not.toBeNull();
    expect(await sql(`select new_data->>'via' as via from audit_log where action = 'SESSION_ACTIVATED' and entity_id = $1`, [june])).toEqual([{ via: 'the Accepting switch' }]);
  });

  it("the board date re-dates the sitting's waiting lines, and the same dates sent again re-date them again (the way to retry a re-date); another date is refused", async () => {
    // A sitting with exams but no entry deadline yet (a line can be made there: its cut-off is the exams' start) in an
    // open session, opened by the admin's old switch, which does not read the check list.
    const s = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y, label: `${label}-bd` } }));
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { datesConfirmed: true } }));
    const o = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: s.id }, json: { custom: { board: 'cambridge', name: `Sociology ${RUN}`, level: 'igcse', group: 'O.L.' } } }));
    const saved = await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: s.id, offeringId: o.id }, json: {
      courseFee: 1000, teachers: [{ teacherId: teacherA, online: false, external: false }],
      rows: [{ kind: 'all_papers', referenceCodes: [`SOC-${RUN}`], examFee: 4000, cells: { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false } }],
    } }));
    const sittingId = saved.offering.rows[0]!.series!.id;
    await apiResponse(adm.api.v1['board-series'][':id'].$put({ param: { id: sittingId }, json: { examsStart: `${Y}-06-01` } }));
    await apiResponse(adm.api.v1.sessions[':id'].activate.$post({ param: { id: s.id } }));
    const f = await onboard(officer, `y08-bd-${RUN}`, 11);
    const [line] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: s.id, studentId: f.studentId, consent: CONSENT,
      lines: [{ offerItemId: saved.offering.rows[0]!.id, attempt: 'first', mode: 'in_school', teacherId: teacherA }] } }));
    const dueOf = async () => (await one<{ d: string }>(`select to_char(due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as d from registration where id = $1`, [line!.id])).d;
    const dueBefore = await dueOf();
    // The board's entry deadline, earlier than the line's due date: the line is now due by it.
    const day1 = cairoDateIn(20);
    const enter = (entryDeadline: string) => adm.api.v1.reference.sittings[':id']['board-date'].$put({ param: { id: sittingId }, json: { entryDeadline } });
    expect(await apiResponse(enter(day1))).toMatchObject({ datesSource: 'admin', linesRedated: 1 });
    expect(await dueOf()).toBe(`${day1} 20:59`);
    expect(dueBefore).not.toBe(`${day1} 20:59`);
    // As a failed re-date would have left it: the old due date, put back by hand. The same date sent again re-dates it.
    await sql(`update registration set due_at = $1::timestamptz where id = $2`, [`${dueBefore}Z`, line!.id]);
    expect(await dueOf()).toBe(dueBefore);
    expect(await apiResponse(enter(day1))).toMatchObject({ datesSource: 'admin', linesRedated: 1 });
    expect(await dueOf()).toBe(`${day1} 20:59`);
    expect(await sql(`select 1 as one from audit_log where action = 'BOARD_SERIES_DEADLINE_SET' and entity_id = $1`, [sittingId])).toHaveLength(1);
    // Another date: refused, nothing changed.
    expect(await refused(enter(cairoDateIn(25)))).toMatchObject({ status: 409, error: expect.stringContaining('has its board entry deadline') });
    expect(await dueOf()).toBe(`${day1} 20:59`);
  });

  it("a subject added while the session takes reservations starts switched off: its default ticks and the fees a rule fills reach no family until she has looked and switched it on", async () => {
    const ar = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: june }, json: { referenceCode: 'YAA01' } }));
    offering.arabic = ar.id;
    expect(ar).toMatchObject({ accepting: false, offeredToFamilies: false });
    expect(ar.rows.find((r) => r.kind === 'qualification')!.cellsByDefault.length).toBe(3);
    expect(await one(`select availability, accepting from session_offer where id = $1`, [ar.id])).toEqual({ availability: 'closed', accepting: false });
    expect((await sessionOf(coordinator, june)).checkList.filter((c) => c.offeringId === ar.id).map((c) => c.code)).toContain('switched_off');
    const f = await onboard(officer, `y08-off-${RUN}`, 11);
    expect((await familyRead(f)).offerings.map((o) => o.id)).not.toContain(ar.id);
    // Switched on (nothing reserved: nothing to count), the check list stops saying so; untick it again for this scenario.
    expect((await apiResponse(put(coordinator, ar.id, { accepting: true }))).offering.accepting).toBe(true);
    expect((await sessionOf(coordinator, june)).checkList.filter((c) => c.offeringId === ar.id).map((c) => c.code)).not.toContain('switched_off');
    await apiResponse(put(coordinator, ar.id, { rows: ar.rows.map((r) => ({ id: r.id, kind: r.kind as 'unit', cells: { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: false, firstSelfStudy: false } })) }));
  });

  it("the family page: one entry per subject offered, the options its cells allow with their prices and words in English and Arabic, an in-school option's teachers, a retake's earlier exams", async () => {
    const f = await onboard(officer, `y08-fam-${RUN}`, 11);
    const read = await familyRead(f);
    expect(read.session).toMatchObject({ pricesFinal: false, refundSentence: '100% to week 2 · 50% in week 3 · 0% from week 4', selfStudyShare: 50 });
    // Only Biology is offered: the others have nothing ticked or a price not set (E6).
    expect(read.offerings.map((o) => [o.name, o.group, o.board, o.note, o.teacherChoice])).toEqual([['Biology', 'O.L.', 'Cambridge International', 'Practical work on Saturdays', 'families']]);
    const [all, paper] = read.offerings[0]!.rows;
    expect(all!.label).toEqual({ en: 'All papers', ar: 'كل الأوراق' });
    expect(all!.options.map((o) => [o.label.en, o.price])).toEqual([
      ['First entry · in school · all papers', { total: 13850, examFee: 10850, courseFee: 3000 }],
      ['Retake · in school · all papers', { total: 13850, examFee: 10850, courseFee: 3000 }],
      ['Retake · self study 50% · all papers', { total: 12350, examFee: 10850, courseFee: 1500 }],
    ]);
    expect(all!.options[0]!.label.ar).toBe('قيد أول · في المدرسة · كل الأوراق');
    expect(all!.options[0]!.teachers.map((t) => [t.name, t.online])).toEqual([[`Huda Fawzy ${RUN}`, true], [`Ms. Hoda Fawzy ${RUN}`, false]]);
    expect(all!.options[2]!.teachers).toEqual([]);
    expect(paper!.options.map((o) => [o.label.en, o.price?.total, o.needsCarriedFrom, o.allowedSittings.map((s) => s.label.en)])).toEqual([
      ['Retake · self study 50% · Paper 41/42 only', 12350, true, [`November ${Y - 1}`, `June ${Y - 1}`]],
    ]);
    expect(paper!.knownSitting).toBeNull();
    // Today's read is still there for the Reserve page P3 replaces.
    expect(read.offers.length).toBeGreaterThan(0);
  });

  it('prices final (E6): a line reserved before is not payable; switched on, the counts first (lines made payable, due dates moved), then it is; one-way once a line exists', async () => {
    const f1 = await onboard(officer, `y08-pf-${RUN}`, 11);
    const [l1] = await apiResponse(reserve(f1, [{ offerItemId: row.bioAll!, attempt: 'first', mode: 'in_school', teacherId: teacherA }]));
    expect(await lineOf(l1!.id)).toEqual({ status: 'pending_payment', price: 13850, course: 3000, exam: 10850, provisional: true, v: 2 });
    expect((await refused(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f1.studentId, registrationIds: [l1!.id], instrumentUsed: 'cash' } })))).toMatchObject({ error: expect.stringContaining('provisional') });
    const final = (expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id']['prices-final'].$put({ param: { id: june }, json: { final: true, ...(expected ? { expected } : {}) } }));
    const { shown, saved } = await confirmed(final);
    expect(shown).toMatchObject({ saved: false, pricesFinal: false, impact: { repriced: 0, listedForFinance: 0, linesAffected: 1 } });
    expect(saved).toMatchObject({ saved: true, pricesFinal: true });
    expect((await lineOf(l1!.id)).provisional).toBe(false);
    const paid = await apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f1.studentId, registrationIds: [l1!.id], instrumentUsed: 'cash' } }));
    expect(paid.collected).toBe(13850);
    expect(await refused(coordinator.api.v1.sessions[':id']['prices-final'].$put({ param: { id: june }, json: { final: false } })))
      .toEqual({ status: 409, error: 'Families have reserved in this session: its prices stay final (a price changed later re-prices the unpaid lines and lists the paid ones for finance)' });
    expect(await sql(`select new_data->>'linesMadePayable' as n from audit_log where action = 'SESSION_PRICES_FINAL' and entity_id = $1`, [june])).toEqual([{ n: '1' }]);
  });

  describe('a price changed after reservations (E7)', () => {
    let paidLine: string, unpaidLine: string, selfStudyLine: string;
    let unpaidFamily: Awaited<ReturnType<typeof onboard>>;
    let selfStudyFamily: Awaited<ReturnType<typeof onboard>>;

    beforeAll(async () => {
      paidLine = (await sql<{ id: string }>(`select id from registration where session_id = $1 and status = 'confirmed'`, [june]))[0]!.id;
      unpaidFamily = await onboard(officer, `y08-e7a-${RUN}`, 11);
      unpaidLine = (await apiResponse(reserve(unpaidFamily, [{ offerItemId: row.bioAll!, attempt: 'first', mode: 'in_school', teacherId: teacherA }])))[0]!.id;
      selfStudyFamily = await onboard(officer, `y08-e7b-${RUN}`, 11);
      const nov = (await one<{ id: string }>(`select id from board_series where board_code = 'cambridge' and month = 'november' and year = $1 and label = ''`, [Y - 1])).id;
      selfStudyLine = (await apiResponse(reserve(selfStudyFamily, [{ offerItemId: row.bioPaper!, attempt: 'retake', mode: 'self_study', priorSittingSeriesId: nov }])))[0]!.id;
      expect(await lineOf(selfStudyLine)).toMatchObject({ price: 12350, course: 1500, exam: 10850 });
    });

    it("the course fee raised: the counts first; counts that moved are refused (IMPACT_CHANGED) and nothing changes; the same counts save it — unpaid lines re-priced, the paid line listed for finance, the families told", async () => {
      const send = (expected?: Impact) => put(coordinator, offering.bio!, { courseFee: 3500, ...(expected ? { expected } : {}) });
      const shown = await apiResponse(send());
      expect(shown).toMatchObject({ saved: false, impact: { repriced: 2, listedForFinance: 1, linesAffected: 0, dueDatesMoved: 0 } });
      expect((await offeringOf(coordinator, offering.bio!)).courseFee).toBe(3000);
      expect(await refused(send({ repriced: 1, listedForFinance: 1, linesAffected: 0, dueDatesMoved: 0 })))
        .toEqual({ status: 409, error: 'What this change does to families changed while you were looking: look at the new counts and save again' });
      expect((await offeringOf(coordinator, offering.bio!)).courseFee).toBe(3000);
      expect((await lineOf(unpaidLine)).price).toBe(13850);
      expect((await apiResponse(send(shown.impact))).saved).toBe(true);
      expect(await lineOf(unpaidLine)).toMatchObject({ price: 14350, course: 3500, exam: 10850 });
      expect(await lineOf(selfStudyLine)).toMatchObject({ price: 12600, course: 1750, exam: 10850 });
      expect(await lineOf(paidLine)).toMatchObject({ status: 'confirmed', price: 13850 });
      const batch = await one<{ listed: { id: string; reason: string; newPrice: number }[] }>(
        `select new_data->'listedForFinance' as listed from audit_log where action = 'ROWS_REPRICED' and entity_id = $1`, [offering.bio!]);
      expect(batch.listed).toEqual([{ id: paidLine, price: 13850, newPrice: 14350, reason: 'has a payment (open, failed or paid)' }]);
      const told = await notified(unpaidFamily.student.email, 'PRICE_CHANGED', 1);
      expect(told[0]!.body).toContain('EGP 14,350');
    });

    it('the self-study share changed on the session: its counts first, then the unpaid self-study lines re-priced at the new share', async () => {
      const send = (expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: june }, json: { selfStudyPercent: 40, ...(expected ? { expected } : {}) } }));
      const { shown, saved } = await confirmed(send);
      expect(shown).toMatchObject({ saved: false, selfStudyPercent: 50, impact: { repriced: 1, listedForFinance: 0 } });
      expect(saved).toMatchObject({ saved: true, selfStudyPercent: 40 });
      expect(await lineOf(selfStudyLine)).toMatchObject({ price: 12250, course: 1400, exam: 10850 });
      expect((await lineOf(unpaidLine)).price).toBe(14350);
    });

    it('reservations are protected: a cell they use stays ticked, a row they use is not removed, a subject they hold is not deleted (close it instead); the deprecated routes change neither its course fee nor whether it is open; its board does not change under it', async () => {
      const cells = (first: boolean) => ({ firstInSchool: first, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false });
      expect(await refused(put(coordinator, offering.bio!, { rows: [
        { id: row.bioAll, kind: 'all_papers', cells: cells(false) },
        { id: row.bioPaper, kind: 'paper', cells: { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: true, firstSelfStudy: false } },
      ] }))).toMatchObject({ status: 409, error: expect.stringContaining('use the first entry in school option') });
      expect(await refused(put(coordinator, offering.bio!, { rows: [{ id: row.bioAll, kind: 'all_papers', cells: cells(true) }] })))
        .toMatchObject({ status: 409, error: expect.stringContaining('is not removed — close it instead') });
      expect(await refused(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$delete({ param: { id: june, offeringId: offering.bio! } })))
        .toEqual({ status: 409, error: 'Biology has reservations in this session: close it instead (they stand)' });
      // The old Session screen's routes would re-price and count nothing: a subject priced by its rows refuses them.
      const { PRICED_BY_ROWS_REFUSAL } = await import('../src/services/offer.services');
      const linePrices = () => sql(`select id, price_at_registration::float as p from registration where session_id = $1 order by id`, [june]);
      const pricesBefore = await linePrices();
      const oldOffer = (json: { courseFee?: number; availability?: 'closed' | 'retake_only'; notes?: string; reason?: string }) =>
        coordinator.api.v1.sessions[':id'].offers[':offerId'].$put({ param: { id: june, offerId: offering.bio! }, json });
      expect(await refused(oldOffer({ courseFee: 4000, reason: 'the old screen' }))).toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'its course fee') });
      expect(await refused(oldOffer({ availability: 'closed', reason: 'the old screen' }))).toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'closing it') });
      expect(await refused(coordinator.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({ param: { id: june, offerId: offering.bio!, itemId: row.bioPaper! }, json: { courseFee: 500, reason: 'the old screen' } })))
        .toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'its course fee') });
      expect(await refused(coordinator.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({ param: { id: june, offerId: offering.bio!, itemId: row.bioPaper! }, json: { availability: 'closed', reason: 'the old screen' } })))
        .toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'closing it') });
      // Any availability write rewrites the rows' cells: refused whether it would untick an option reservations use
      // (first entry in school), re-tick one she unticked (the paper's first entry: open), or switch a switched-off
      // subject back on — on the offer and the item.
      expect(await refused(oldOffer({ availability: 'retake_only', reason: 'the old screen' }))).toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'what it offers') });
      expect(await refused(coordinator.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({ param: { id: june, offerId: offering.bio!, itemId: row.bioAll! }, json: { availability: 'self_study_only', reason: 'the old screen' } })))
        .toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'what it offers') });
      expect(await refused(coordinator.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({ param: { id: june, offerId: offering.bio!, itemId: row.bioPaper! }, json: { availability: 'open', reason: 'the old screen' } })))
        .toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'what it offers') });
      // Switched off by her (its reservations counted first), the old route does not switch it back on.
      const switchBio = (accepting: boolean) => confirmed((expected?: Impact) => apiResponse(put(coordinator, offering.bio!, { accepting, ...(expected ? { expected } : {}) })));
      await switchBio(false);
      expect(await refused(oldOffer({ availability: 'retake_only', reason: 'the old screen' }))).toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'what it offers') });
      expect(await refused(coordinator.api.v1.sessions[':id'].offers[':offerId'].$put({ param: { id: june, offerId: offering.bio! }, json: { availability: 'open', reason: 'the old screen' } })))
        .toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'what it offers') });
      expect(await one(`select accepting, availability from session_offer where id = $1`, [offering.bio!])).toEqual({ accepting: false, availability: 'closed' });
      await switchBio(true);
      // The item route's series change on a row with reservations (§6: the editor refuses it too).
      const otherJune = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y, label: `${label}-other` } }))).id;
      expect(await refused(coordinator.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({ param: { id: june, offerId: offering.bio!, itemId: row.bioAll! }, json: { boardSeriesId: otherJune, reason: 'the old screen' } })))
        .toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'the sitting of a row with reservations') });
      // The old one-form-per-subject route: its course fee and its "not offered this cycle" alike.
      const asForm = async () => {
        const o = await offeringOf(coordinator, offering.bio!);
        return {
          teachers: o.teachers.map((t) => ({ teacherId: t.teacherId, mode: t.online ? 'online' as const : 'in_school' as const })),
          availability: 'open' as 'open' | 'closed', courseFee: o.courseFee!, items: [], grade10Core: false, courseStartsOn: null, notes: o.note, reason: 'the old screen',
        };
      };
      const form = (json: Awaited<ReturnType<typeof asForm>> & { linesStand?: boolean }) =>
        coordinator.api.v1.sessions[':id'].offers[':offerId'].form.$put({ param: { id: june, offerId: offering.bio! }, json });
      expect(await refused(form({ ...(await asForm()), courseFee: 4000 }))).toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'its course fee') });
      expect(await refused(form({ ...(await asForm()), availability: 'closed', linesStand: true }))).toEqual({ status: 409, error: PRICED_BY_ROWS_REFUSAL('Biology', 'closing it') });
      expect(await offeringOf(coordinator, offering.bio!)).toMatchObject({ courseFee: 3500, accepting: true });
      expect((await offeringOf(coordinator, offering.bio!)).rows.map((r) => [r.id, r.cells.firstInSchool, r.series?.label])).toEqual([[row.bioAll, true, label], [row.bioPaper, false, label]]);
      expect(await linePrices()).toEqual(pricesBefore);
      // The Catalogue's board change cannot carry a subject set up with its board's rows: refused, nothing moved.
      const bioSubject = (await offeringOf(coordinator, offering.bio!)).subject.id;
      const series = () => sql(`select id, board_series_id as s from registration where session_id = $1 order by id`, [june]);
      const seriesBefore = await series();
      // (The subject screen's route answers its refusals 400.)
      expect(await refused(adm.api.v1.subjects[':id'].$put({ param: { id: bioSubject }, json: { council: 'pearson_edexcel' } })))
        .toMatchObject({ status: 400, error: expect.stringMatching(/^Biology is set up in .+ with its board's rows and fees: a board change does not move it — remove it from that session and add it again from the reference list under the other board$/) });
      expect(await one(`select council from subject where id = $1`, [bioSubject])).toEqual({ council: 'cambridge' });
      expect(await series()).toEqual(seriesBefore);
    });

    it('a subject closed (C4): its reservations stand and are counted first; no new one is taken and families no longer see it; reopened, it is offered again', async () => {
      const send = (accepting: boolean) => (expected?: Impact) => apiResponse(put(coordinator, offering.bio!, { accepting, ...(expected ? { expected } : {}) }));
      const { shown } = await confirmed(send(false));
      expect(shown.impact).toEqual({ repriced: 0, listedForFinance: 0, linesAffected: 3, dueDatesMoved: 0 });
      const f = await onboard(officer, `y08-closed-${RUN}`, 11);
      expect(await refused(reserve(f, [{ offerItemId: row.bioAll!, attempt: 'first', mode: 'in_school' }]))).toMatchObject({ error: expect.stringContaining('closed in this session') });
      expect((await familyRead(f)).offerings).toEqual([]);
      expect((await lineOf(unpaidLine)).status).toBe('pending_payment');
      await confirmed(send(true));
      expect((await familyRead(f)).offerings.map((o) => o.name)).toEqual(['Biology']);
    });
  });

  it("the coordinator's live preview: a first-timer sees first entry and retake, a retaker the retakes only with an earlier exam filled in; finance reads it, families do not", async () => {
    const first = await apiResponse(coordinator.api.v1.sessions[':id'].preview.$get({ param: { id: june }, query: { as: 'first_timer', offeringId: offering.bio! } }));
    expect(first.as).toBe('first_timer');
    expect(first.offerings[0]!.rows[0]!.options.map((o) => [o.attempt, o.mode, o.price?.total])).toEqual([['first', 'in_school', 14350], ['retake', 'in_school', 14350], ['retake', 'self_study', 12250]]);
    const retaker = await apiResponse(officer.api.v1.sessions[':id'].preview.$get({ param: { id: june }, query: { as: 'retaker' } }));
    const bio = retaker.offerings.find((o) => o.id === offering.bio)!;
    expect(bio.rows[0]!.options.map((o) => o.attempt)).toEqual(['retake', 'retake']);
    expect(bio.rows[1]!.knownSitting?.label.en).toBe(`November ${Y - 1}`);
    // A preview shows the subjects not offered yet too (nothing ticked: no rows to show).
    expect(retaker.offerings.map((o) => o.name)).toEqual(['Biology']);
    const f = await onboard(officer, `y08-prev-${RUN}`, 11);
    expect((await refused(f.parent.api.v1.sessions[':id'].preview.$get({ param: { id: june }, query: {} }))).status).toBe(403);
  });

  it('questions (D13) on the session and on a subject reach the family page, never its price; the reservations read lists who reserved what, paid or not, with a column per question, and its spreadsheet', async () => {
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: june }, json: { questions: [{ kind: 'yes_no', prompt: 'Will you join the revision camp?', choices: [], required: false }] } }));
    await apiResponse(put(coordinator, offering.bio!, { questions: [{ kind: 'choice', prompt: 'Lab group', choices: ['Saturday', 'Monday'], required: true }] }));
    const f = await onboard(officer, `y08-q-${RUN}`, 11);
    const read = await familyRead(f);
    expect(read.session.questions.map((q) => [q.kind, q.prompt])).toEqual([['yes_no', 'Will you join the revision camp?']]);
    expect(read.offerings[0]!.questions.map((q) => [q.kind, q.prompt, q.choices, q.required])).toEqual([['choice', 'Lab group', ['Saturday', 'Monday'], true]]);
    expect(read.offerings[0]!.rows[0]!.options[0]!.price?.total).toBe(14350);
    const r = await apiResponse(coordinator.api.v1.sessions[':id'].reservations.$get({ param: { id: june }, query: {} }));
    expect(r.totals).toEqual({ lines: 3, students: 3, paid: 1, unpaid: 2 });
    expect(r.lines.map((l) => [l.subject, l.option, l.paid, l.carriedFrom]).sort()).toEqual([
      ['Biology', 'First entry · in school · all papers', false, null],
      ['Biology', 'First entry · in school · all papers', true, null],
      ['Biology', 'Retake · self study 40% · Paper 41/42 only', false, `November ${Y - 1}`],
    ]);
    expect(r.questions.map((q) => q.prompt)).toEqual(['Will you join the revision camp?', 'Lab group']);
    const csv = await coordinator.api.v1.sessions[':id'].reservations.$get({ param: { id: june }, query: { format: 'csv' } });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect((await csv.text()).split('\r\n')[0]).toBe('Student,Subject,Option,Teacher,Carried from,Price (EGP),Paid,Status,Will you join the revision camp?,Lab group');
  });

  it("copy with the year roll (C3): next June from this one — offerings, rows, cells, teachers, notes, questions, refund policy and share; sittings, earlier exams and dates a year on; last year's prices, not final", async () => {
    const next = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y + 1, label, copyFromSessionId: june } }));
    expect(next).toMatchObject({ status: 'draft', pricesFinal: false, selfStudyPercent: 40, copiedFromSessionId: june, courseStartsOn: `${Y}-10-04` });
    expect(next.copy).toEqual({ from: deriveSessionName('june', Y, label), offerings: 5, questions: 1, yearsMoved: 1, skipped: [] });
    const s = await sessionOf(coordinator, next.id);
    expect(s.questions.map((q) => q.prompt)).toEqual(['Will you join the revision camp?']);
    const bio = s.offerings.find((o) => o.subject.code === '0970')!;
    expect(bio).toMatchObject({ note: 'Practical work on Saturdays', courseFee: 3500, accepting: true });
    expect(bio.teachers.map((t) => t.teacherId)).toEqual([teacherA, teacherB]);
    expect(bio.questions.map((q) => q.prompt)).toEqual(['Lab group']);
    expect(bio.rows.map((r) => [r.kind, r.cells.firstInSchool, r.cells.retakeSelfStudy, r.examFee, r.series?.year, r.series?.month])).toEqual([
      ['all_papers', true, true, 10850, Y + 1, 'june'], ['paper', false, true, 10850, Y + 1, 'june'],
    ]);
    expect(bio.rows[1]!.allowedPriorSittings.map((p) => [p.month, p.year])).toEqual([['november', Y], ['june', Y]]);
    expect(s.checkList.map((c) => c.code)).toEqual(expect.arrayContaining(['last_years_prices', 'dates_to_check', 'sitting_no_board_date']));
    expect(await sql(`select new_data->>'yearsMoved' as y, new_data->>'offerings' as n from audit_log where action = 'SESSION_COPIED' and entity_id = $1`, [next.id])).toEqual([{ y: '1', n: '5' }]);
    // A copy is of the same type.
    expect((await refused(coordinator.api.v1.sessions.$post({ json: { type: 'winter', year: Y, label: `${label}-w`, copyFromSessionId: june } }))).status).toBe(400);
  });

  it('the Accepting switch and the closing date are hers (owner decision 26 Oct; C4): an empty session opens, takes a closing date and has it cleared, closes, and reopens (closed → open); a second open session of its cycle is refused', async () => {
    const s = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'winter', year: Y, label: `${label}-sw` } }));
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { datesConfirmed: true } }));
    expect((await apiResponse(coordinator.api.v1.sessions[':id'].open.$post({ param: { id: s.id } }))).status).toBe('active');
    const closing = new Date(Date.now() + 30 * day);
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { closesAt: closing } }));
    expect((await sessionOf(coordinator, s.id)).closesAt).toBe(closing.toISOString());
    expect(await one(`select end_date = $1::timestamptz as set from registration_session where id = $2`, [closing.toISOString(), s.id])).toEqual({ set: true });
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { closesAt: null } }));
    expect((await sessionOf(coordinator, s.id)).closesAt).toBeNull();
    const closed = await apiResponse(coordinator.api.v1.sessions[':id'].close.$post({ param: { id: s.id }, json: {} }));
    expect(closed.status).toBe('closed');
    expect(await one(`select status, closed_by as by from registration_session where id = $1`, [s.id])).toEqual({ status: 'closed', by: coordinator.id });
    const twin = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'winter', year: Y, label: `${label}-sw` } }));
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: twin.id }, json: { datesConfirmed: true } }));
    expect((await apiResponse(coordinator.api.v1.sessions[':id'].open.$post({ param: { id: twin.id } }))).status).toBe('active');
    expect(await refused(coordinator.api.v1.sessions[':id'].reopen.$post({ param: { id: s.id }, json: {} }))).toMatchObject({ status: 409, error: expect.stringContaining('already exists') });
    await apiResponse(coordinator.api.v1.sessions[':id'].close.$post({ param: { id: twin.id }, json: {} }));
    const back = await apiResponse(coordinator.api.v1.sessions[':id'].reopen.$post({ param: { id: s.id }, json: { reason: 'one more week' } }));
    expect(back).toMatchObject({ status: 'active', closedAt: null, finalizedAt: null });
    expect(await sql(`select new_data->>'reason' as r from audit_log where action = 'SESSION_REOPENED' and entity_id = $1`, [s.id])).toEqual([{ r: 'one more week' }]);
    await apiResponse(coordinator.api.v1.sessions[':id'].close.$post({ param: { id: s.id }, json: {} }));
  });

  it("a subject set up with its board's rows only in a closed session keeps its board too: reopened, the session would hold a new-board subject with the old board's rows", async () => {
    const s = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'winter', year: Y, label: `${label}-closed` } }));
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { datesConfirmed: true } }));
    const o = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: s.id }, json: { custom: { board: 'cambridge', name: `Marine Science ${RUN}`, level: 'igcse', group: 'O.L.' } } }));
    await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: s.id, offeringId: o.id }, json: {
      courseFee: 1000, teacherTbc: true, rows: [{ kind: 'all_papers', referenceCodes: [`MS-${RUN}`], examFee: 5000, cells: { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false } }],
    } }));
    for (const c of (await sessionOf(coordinator, s.id)).checkList.filter((x) => x.code === 'sitting_no_board_date')) {
      await apiResponse(adm.api.v1.reference.sittings[':id']['board-date'].$put({ param: { id: c.seriesId! }, json: { entryDeadline: cairoDateIn(60) } }));
    }
    expect((await apiResponse(coordinator.api.v1.sessions[':id'].open.$post({ param: { id: s.id } }))).status).toBe('active');
    expect((await apiResponse(coordinator.api.v1.sessions[':id'].close.$post({ param: { id: s.id }, json: {} }))).status).toBe('closed');
    expect(await refused(adm.api.v1.subjects[':id'].$put({ param: { id: o.subject.id }, json: { council: 'pearson_edexcel' } })))
      .toMatchObject({ status: 400, error: expect.stringContaining(`Marine Science ${RUN} is set up in`) });
    expect(await one(`select council from subject where id = $1`, [o.subject.id])).toEqual({ council: 'cambridge' });
  });

  it('her rights (B1–B3): all of set-up is the coordinator\'s and the admin\'s, never money; finance reads set-up and changes none of it; families neither', async () => {
    const f = await onboard(officer, `y08-rights-${RUN}`, 11);
    const [line] = await apiResponse(reserve(f, [{ offerItemId: row.bioAll!, attempt: 'first', mode: 'in_school', teacherId: teacherA }]));
    expect((await refused(coordinator.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: [line!.id], instrumentUsed: 'cash' } }))).status).toBe(403);
    for (const who of [officer, finadmin]) {
      expect((await apiResponse(who.api.v1.sessions[':id'].prices.$get({ param: { id: june } }))).rows.length).toBeGreaterThan(0);
      expect((await offeringOf(who, offering.bio!)).id).toBe(offering.bio);
      expect((await refused(put(who, offering.bio!, { note: 'finance edit' }))).status).toBe(403);
      expect((await refused(who.api.v1.sessions.$post({ json: { type: 'june', year: Y + 2, label: `${label}-f` } }))).status).toBe(403);
    }
    expect((await refused(f.parent.api.v1.sessions[':id'].offerings[':offeringId'].$get({ param: { id: june, offeringId: offering.bio! } }))).status).toBe(403);
    expect((await refused(f.student.api.v1.sessions[':id'].reservations.$get({ param: { id: june }, query: {} }))).status).toBe(403);
    expect(money((await one<{ p: string }>(`select price_at_registration as p from registration where id = $1`, [line!.id])).p)).toBe(14350);
  });

  describe("races on the session (§9.2: insertLines takes the session FOR SHARE before the offering and the row; a share change and the prices-final switch take it FOR UPDATE)", () => {
    let race: string, raceRow: string, nov: string;
    const raceReserve = (f: { parent: Client; studentId: string }, mode: 'in_school' | 'self_study') =>
      f.parent.api.v1.registrations.direct.$post({ json: { sessionId: race, studentId: f.studentId, consent: CONSENT,
        lines: [mode === 'self_study' ? { offerItemId: raceRow, attempt: 'retake', mode, priorSittingSeriesId: nov } : { offerItemId: raceRow, attempt: 'first', mode, teacherId: teacherA }] } });
    const raceLine = (id: string) => one<{ price: number; course: number; provisional: boolean }>(
      `select price_at_registration::float as price, course_fee_at_registration::float as course, price_provisional as provisional from registration where id = $1`, [id]);
    const share = (percent: number, expected?: Impact) => coordinator.api.v1.sessions[':id'].$put({ param: { id: race }, json: { selfStudyPercent: percent, ...(expected ? { expected } : {}) } });
    const pricesFinal = (expected?: Impact) => coordinator.api.v1.sessions[':id']['prices-final'].$put({ param: { id: race }, json: { final: true, ...(expected ? { expected } : {}) } });
    /** A reservation held after it has taken the session, the offering and the row FOR SHARE (at the fee-grid lock it takes next). */
    async function holdingAReservation<T>(f: { parent: Client; studentId: string }, mode: 'in_school' | 'self_study', meanwhile: () => Promise<T>) {
      const { default: pg } = await import('pg');
      const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      const series = (await one<{ s: string }>(`select board_series_id as s from session_offer_item where id = $1`, [raceRow])).s;
      await holder.query(`select pg_advisory_lock(4041, hashtext($1))`, [series]);
      let reserving: ReturnType<typeof raceReserve> | undefined;
      let other: Promise<T> | undefined;
      try {
        reserving = raceReserve(f, mode);
        await lockWaiters(1);
        other = meanwhile();
        await lockWaiters(2);
      } finally {
        await holder.query(`select pg_advisory_unlock(4041, hashtext($1))`, [series]);
        await holder.end();
      }
      return Promise.all([reserving!, other!]);
    }

    beforeAll(async () => {
      race = (await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y, label: `${label}-race` } }))).id;
      await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: race }, json: { datesConfirmed: true } }));
      const bio = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: race }, json: { referenceCode: '0970' } }));
      raceRow = bio.rows[0]!.id;
      await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: race, offeringId: bio.id }, json: {
        courseFee: 4000, teachers: [{ teacherId: teacherA, online: false, external: false }], defaultsReviewed: true,
        rows: [{ id: raceRow, kind: 'all_papers', examFee: 10000, cells: { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false } }],
      } }));
      const s = await sessionOf(coordinator, race);
      for (const c of s.checkList.filter((x) => x.code === 'sitting_no_board_date')) {
        await apiResponse(adm.api.v1.reference.sittings[':id']['board-date'].$put({ param: { id: c.seriesId! }, json: { entryDeadline: cairoDateIn(120) } }));
      }
      expect((await apiResponse(coordinator.api.v1.sessions[':id'].open.$post({ param: { id: race } }))).status).toBe('active');
      nov = (await one<{ id: string }>(`select id from board_series where board_code = 'cambridge' and month = 'november' and year = $1 and label = ''`, [Y - 1])).id;
    });

    it('the self-study share changed while a reservation lands: the change first, the reservation waits and is priced at the new share; the reservation first, the change sent with the counts it had is refused (IMPACT_CHANGED) and nothing changes', async () => {
      const a = await onboard(officer, `y08-race-a-${RUN}`, 11);
      const [first] = await apiResponse(raceReserve(a, 'self_study'));
      expect(await raceLine(first!.id)).toMatchObject({ course: 2000, price: 12000 });
      // The change first: its counts, then sent with them and paused at its own audit row, holding the session.
      const shown = await apiResponse(share(40));
      expect(shown).toMatchObject({ saved: false, impact: { repriced: 1 } });
      const release = await pauseAtAudit('SESSION_UPDATED');
      const b = await onboard(officer, `y08-race-b-${RUN}`, 11);
      let changing: ReturnType<typeof share> | undefined;
      let reserving: ReturnType<typeof raceReserve> | undefined;
      try {
        changing = share(40, shown.impact);
        await lockWaiters(1);
        reserving = raceReserve(b, 'self_study');
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [c, r] = await Promise.all([changing!, reserving!]);
      expect(c.status).toBe(200);
      expect(r.status).toBe(201);
      const raced = (await apiResponse(Promise.resolve(r)))[0]!.id;
      expect(await raceLine(raced)).toMatchObject({ course: 1600, price: 11600 });
      expect(await raceLine(first!.id)).toMatchObject({ course: 1600, price: 11600 });

      // The reservation first: the change, sent with the counts it had before, finds a self-study line it did not count.
      const counts = (await apiResponse(share(30))).impact;
      expect(counts.repriced).toBe(2);
      const g = await onboard(officer, `y08-race-c-${RUN}`, 11);
      const [r2, c2] = await holdingAReservation(g, 'self_study', () => share(30, counts));
      expect(r2.status).toBe(201);
      expect(await refused(Promise.resolve(c2))).toEqual({ status: 409, error: 'What this change does to families changed while you were looking: look at the new counts and save again' });
      expect((await sessionOf(coordinator, race)).selfStudyPercent).toBe(40);
      expect(await raceLine(first!.id)).toMatchObject({ course: 1600 });
    });

    it('prices made final while a reservation lands: the reservation first, the switch sent with the counts it had is refused and the prices stay not final; the switch first, the reservation waits and its line is payable', async () => {
      const shownBefore = (await apiResponse(pricesFinal())).impact;
      const f = await onboard(officer, `y08-race-pf-a-${RUN}`, 11);
      const [r1, p1] = await holdingAReservation(f, 'in_school', () => pricesFinal(shownBefore));
      expect(r1.status).toBe(201);
      expect(await refused(Promise.resolve(p1))).toEqual({ status: 409, error: 'What this change does to families changed while you were looking: look at the new counts and save again' });
      expect((await sessionOf(coordinator, race)).pricesFinal).toBe(false);
      const pending = (await apiResponse(Promise.resolve(r1)))[0]!.id;
      expect((await raceLine(pending)).provisional).toBe(true);

      // The switch first: paused at its own audit row holding the session; the reservation waits for it.
      const shown = await apiResponse(pricesFinal());
      expect(shown.impact.linesAffected).toBe(shownBefore.linesAffected + 1);
      const release = await pauseAtAudit('SESSION_PRICES_FINAL');
      const g = await onboard(officer, `y08-race-pf-b-${RUN}`, 11);
      let switching: ReturnType<typeof pricesFinal> | undefined;
      let reserving: ReturnType<typeof raceReserve> | undefined;
      try {
        switching = pricesFinal(shown.impact);
        await lockWaiters(1);
        reserving = raceReserve(g, 'in_school');
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [p2, r2] = await Promise.all([switching!, reserving!]);
      expect(p2.status).toBe(200);
      expect(r2.status).toBe(201);
      const raced = (await apiResponse(Promise.resolve(r2)))[0]!.id;
      expect(await raceLine(raced)).toMatchObject({ provisional: false, price: 14000 });
      expect((await raceLine(pending)).provisional).toBe(false);
    });
  });
});
