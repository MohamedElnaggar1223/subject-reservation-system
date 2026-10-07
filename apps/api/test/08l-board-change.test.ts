import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, audited, futureWindow, sessionName, subjectFeeIn, type Client,
} from './helpers';

/**
 * F0b — a subject's board changed while it has entries (decision 3; the
 * review of 682907a, flags 1 and 2).
 *
 * The coordinator's answer to "which board is it entered with?" moves the
 * subject's items, with their live lines, to the new board's series of the
 * same month and label (the reservations rework: a session's series are its
 * items'; catalogue.services.ts boardChangeTarget). MO-10 holds across it,
 * per line: nothing moves into a series past the line's deadline, or into one
 * with another deadline than the line's own. The item moves with the subject,
 * so a family is still offered it and can reserve it.
 *
 * Every session here is a draft (families preregister).
 */

const days = (n: number) => n * 24 * 60 * 60 * 1000;
const seriesOf = async (id: string) =>
  (await one<{ s: string | null }>(`select board_series_id as s from registration where id = $1`, [id])).s;
const councilOf = async (id: string) => (await one<{ c: string }>(`select council as c from subject where id = $1`, [id])).c;

describe('F0b: a board change and the entry deadline', () => {
  let adm: Client, coordinator: Client, officer: Client;
  const subj: Record<string, string> = {};
  let fam: { parent: Client; student: Client; studentId: string };

  /** A draft winter IGCSE session; returns its id, series year, end and (derived) name. */
  const window = async (tag: string) => {
    const id = await session(adm, `November (IGCSE, board change ${tag})`, 'november', 'igcse', futureWindow());
    const w = await one<{ year: number; end: string }>(`select series_year as year, end_date as "end" from registration_session where id = $1`, [id]);
    return { id, year: w.year, end: new Date(w.end), name: await sessionName(id) };
  };
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** A November series of a board (exams in a year's time, so it takes reservations before any deadline is set). */
  const series = async (board: 'cambridge' | 'pearson_edexcel', year: number, label: string) =>
    (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: board, month: 'november', year, label, examsStart: `${year + 1}-12-31` } }))).id;
  /** The subject's item in the session placed in a series (the Session screen's series column). */
  const place = async (sessionId: string, subjectId: string, boardSeriesId: string) => {
    await subjectFeeIn(adm, boardSeriesId, subjectId);
    const it = await one<{ id: string; offer_id: string }>(
      `select i.id, i.offer_id from session_offer_item i join session_offer o on o.id = i.offer_id where i.session_id = $1 and o.subject_id = $2`, [sessionId, subjectId]);
    await apiResponse(adm.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({
      param: { id: sessionId, offerId: it.offer_id, itemId: it.id }, json: { boardSeriesId, reason: 'board change: the series it is entered in' },
    }));
    return it.id;
  };
  const itemSeries = async (itemId: string) => (await one<{ s: string }>(`select board_series_id as s from session_offer_item where id = $1`, [itemId])).s;
  const deadline = (id: string, entryDeadline: Date) =>
    apiResponse(adm.api.v1['board-series'][':id'].$put({ param: { id }, json: { entryDeadline, reason: 'board key dates published' } }));
  const prereg = async (sessionId: string, subjectId: string) =>
    (await apiResponse(fam.parent.api.v1.registrations.preregister.$post({ json: { sessionId, subjectIds: [subjectId], studentId: fam.studentId } })))[0]!.id;
  const toPearson = (subjectId: string) =>
    adm.api.v1.subjects[':id'].$put({ param: { id: subjectId }, json: { council: 'pearson_edexcel' } });

  beforeAll(async () => {
    adm = await admin('bc');
    coordinator = await staff(adm, 'coordinator', 'bc');
    officer = await staff(adm, 'finance_officer', 'bc');
    for (const tag of ['PAS', 'DIF', 'SAM', 'RTE', 'RTD', 'RTN']) {
      subj[tag] = await subject(adm, `BC-${tag}`, `Board change ${tag}`, { course: 1000, registration: 400 });
    }
    fam = await onboard(officer, 'bc', 11);
  });

  it("refused when the new board's series is past its entry deadline: nothing moves (MO-10)", async () => {
    const w = await window('passed');
    const cam = await series('cambridge', w.year, 'BC passed');
    const pea = await series('pearson_edexcel', w.year, 'BC passed');
    await place(w.id, subj.PAS!, cam);
    const reg = await prereg(w.id, subj.PAS!);
    expect(await seriesOf(reg)).toBe(cam);
    // The window closed long ago; Cambridge's deadline is ahead, Pearson's has passed.
    await sql(`update registration_session set start_date = now() - interval '3 days', end_date = now() - interval '2 days' where id = $1`, [w.id]);
    await sql(`update board_series set entry_deadline = now() + interval '5 days' where id = $1`, [cam]);
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [pea]);
    const r = await refused(toPearson(subj.PAS!));
    expect(r.status).toBe(400);
    expect(r.error).toMatch(new RegExp(`^Pearson Edexcel November \\d{4} \\(BC passed\\) is past its entry deadline \\(.+\\): Board change PAS cannot be moved into it in ${esc(w.name)}$`));
    expect(await councilOf(subj.PAS!)).toBe('cambridge');
    expect(await seriesOf(reg)).toBe(cam);
  });

  it('refused when the new board\'s series has another entry deadline: a board change keeps the deadline', async () => {
    const w = await window('differs');
    const cam = await series('cambridge', w.year, 'BC differs');
    const pea = await series('pearson_edexcel', w.year, 'BC differs');
    await place(w.id, subj.DIF!, cam);
    await deadline(cam, new Date(w.end.getTime() + days(10)));
    await deadline(pea, new Date(w.end.getTime() + days(20)));
    const reg = await prereg(w.id, subj.DIF!);
    const r = await refused(toPearson(subj.DIF!));
    expect(r.status).toBe(400);
    expect(r.error).toMatch(new RegExp(`^In ${esc(w.name)}, Board change DIF is entered in Cambridge International November \\d{4} \\(BC differs\\) \\(entry deadline .+\\) and would move to Pearson Edexcel November \\d{4} \\(BC differs\\) \\(entry deadline .+\\): a board change keeps the entry deadline — give the two series the same deadline first$`));
    expect(await councilOf(subj.DIF!)).toBe('cambridge');
    expect(await seriesOf(reg)).toBe(cam);
  });

  it('with the same deadline the registration follows the subject, audited', async () => {
    const w = await window('same');
    const cam = await series('cambridge', w.year, 'BC same');
    const pea = await series('pearson_edexcel', w.year, 'BC same');
    const item = await place(w.id, subj.SAM!, cam);
    const at = new Date(w.end.getTime() + days(10));
    await deadline(cam, at);
    await deadline(pea, at);
    const reg = await prereg(w.id, subj.SAM!);
    await apiResponse(toPearson(subj.SAM!));
    expect(await councilOf(subj.SAM!)).toBe('pearson_edexcel');
    expect(await seriesOf(reg)).toBe(pea);
    await audited([reg], ['REGISTRATION_SERIES_MOVED']);
    // Its item went with it (the line is always where its item is).
    expect(await itemSeries(item)).toBe(pea);
    await audited([item], ['OFFER_ITEM_SERIES_CHANGED']);
  });

  it("what the migration inferred is listed for staff to check, until they mark it checked (flag 5)", async () => {
    // Migration 0038 writes these rows when a subject's board does not sit a
    // window's month; the suite's database starts empty, so the rows are
    // written here as the migration writes them (the one reach past the API):
    // a re-boarded subject with a registration, a re-boarded subject only
    // offered, and a registered subject kept on its board and not offered.
    const w = await window('inferred');
    const pea = await series('pearson_edexcel', w.year, 'BC inferred');
    const sub = await subject(adm, 'BC-INF', 'Board change inferred', { course: 1000, registration: 400 }, { council: 'pearson_edexcel' });
    await place(w.id, sub, pea);
    const offered = await subject(adm, 'BC-OFF', 'Board change offered only', { course: 1000, registration: 400 }, { council: 'pearson_edexcel' });
    const kept = await subject(adm, 'BC-KEPT', 'Board change kept', { course: 1000, registration: 400 }, { council: 'oxford' });
    const reg = await prereg(w.id, sub);
    await sql(`insert into audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
      values (gen_random_uuid()::text, null, 'SUBJECT_BOARD_INFERRED', 'subject', $1, '{"council":"cambridge"}', '{"council":"pearson_edexcel","windows":["October 2026 AS"],"registered":true}', now()),
             (gen_random_uuid()::text, null, 'REGISTRATION_SERIES_INFERRED', 'registration', $2, '{"council":"cambridge"}', '{"council":"pearson_edexcel"}', now()),
             (gen_random_uuid()::text, null, 'SUBJECT_BOARD_INFERRED', 'subject', $3, '{"council":"cambridge"}', '{"council":"pearson_edexcel","windows":["January 2027 AS"],"registered":false}', now()),
             (gen_random_uuid()::text, null, 'SUBJECT_NOT_OFFERED_INFERRED', 'subject', $4, null, '{"council":"oxford","windows":["October 2026 AS"]}', now())`,
      [sub, reg, offered, kept]);
    const listed = await apiResponse(coordinator.api.v1['board-series'].inferred.$get());
    expect(listed.registrations.find((r) => r.registrationId === reg)).toMatchObject({
      subjectName: 'Board change inferred', previousBoardName: 'Cambridge International', boardName: 'Pearson Edexcel', series: expect.stringMatching(/^Pearson Edexcel November \d{4} \(BC inferred\)$/),
    });
    const bySubject = new Map(listed.subjects.map((x) => [x.subjectId, x]));
    expect(bySubject.get(offered)).toMatchObject({ kind: 'reboarded', previousBoardName: 'Cambridge International', boardName: 'Pearson Edexcel', windows: ['January 2027 AS'], registered: false });
    expect(bySubject.get(sub)).toMatchObject({ kind: 'reboarded', windows: ['October 2026 AS'], registered: true });
    expect(bySubject.get(kept)).toMatchObject({ kind: 'not_offered', boardName: 'OxfordAQA', windows: ['October 2026 AS'] });
    await apiResponse(coordinator.api.v1['board-series'].inferred.checked.$post({ json: { registrationIds: [reg], subjectIds: [sub, offered, kept] } }));
    await audited([reg], ['REGISTRATION_SERIES_INFERENCE_CHECKED']);
    await audited([offered], ['SUBJECT_BOARD_INFERENCE_CHECKED']);
    const after = await apiResponse(coordinator.api.v1['board-series'].inferred.$get());
    expect(after.registrations.some((r) => r.registrationId === reg)).toBe(false);
    expect(after.subjects.some((x) => [sub, offered, kept].includes(x.subjectId))).toBe(false);
    expect(await refused(coordinator.api.v1['board-series'].inferred.checked.$post({ json: { registrationIds: [reg] } }))).toEqual({
      status: 404, error: 'One or more of these are not waiting to be checked',
    });
  });

  it("a board chosen on the Subjects form takes a re-boarded subject off 'Check these'; another change does not", async () => {
    const chosen = await subject(adm, 'BC-SFC', 'Board change Subjects form chosen', { course: 1000, registration: 400 }, { council: 'pearson_edexcel' });
    const other = await subject(adm, 'BC-SFO', 'Board change Subjects form other', { course: 1000, registration: 400 }, { council: 'pearson_edexcel' });
    // As migration 0038 writes them (see the test above).
    await sql(`insert into audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
      values (gen_random_uuid()::text, null, 'SUBJECT_BOARD_INFERRED', 'subject', $1, '{"council":"cambridge"}', '{"council":"pearson_edexcel","windows":["January 2027 AS"],"registered":false}', now()),
             (gen_random_uuid()::text, null, 'SUBJECT_BOARD_INFERRED', 'subject', $2, '{"council":"cambridge"}', '{"council":"pearson_edexcel","windows":["January 2027 AS"],"registered":false}', now())`,
      [chosen, other]);
    const listedIds = async () => (await apiResponse(coordinator.api.v1['board-series'].inferred.$get())).subjects.map((x) => x.subjectId);
    expect(await listedIds()).toEqual(expect.arrayContaining([chosen, other]));

    // A change that is not the board leaves it to check.
    await apiResponse(adm.api.v1.subjects[':id'].$put({ param: { id: other }, json: { name: 'Board change Subjects form other (renamed)' } }));
    // The board chosen on the Subjects form: the admin has answered the question.
    await apiResponse(adm.api.v1.subjects[':id'].$put({ param: { id: chosen }, json: { council: 'cambridge' } }));
    expect(await councilOf(chosen)).toBe('cambridge');
    await audited([chosen], ['SUBJECT_BOARD_INFERRED', 'SUBJECT_BOARD_CHANGED']);
    expect(await one<{ was: string; now: string }>(
      `select previous_data->>'council' as was, new_data->>'council' as now from audit_log where action = 'SUBJECT_BOARD_CHANGED' and entity_id = $1`, [chosen],
    )).toEqual({ was: 'pearson_edexcel', now: 'cambridge' });

    const after = await listedIds();
    expect(after).not.toContain(chosen);
    expect(after).toContain(other);
  });

  // Changed by the reservations rework (trail row "assertion"; not money): F0b's per-window routes
  // are items placed in a series (§3.3). The flag-2 outcome stands — after a board change the
  // subject is still offered, and reserved in a series of its new board — but an item with no
  // lines moves freely (no checkout or refund was judged against its date), and a session never
  // "feeds no series" of the new board: the series is created when the item lands in it.
  describe("a subject's item moves with it (flag 2)", () => {
    it("an item in a labelled series moves to the new board's series of that label: the subject is offered and reserved there", async () => {
      const w = await window('route');
      const camRouted = await series('cambridge', w.year, 'BC route (routed)');
      const peaRouted = await series('pearson_edexcel', w.year, 'BC route (routed)');
      const item = await place(w.id, subj.RTE!, camRouted);
      await apiResponse(toPearson(subj.RTE!));
      expect(await itemSeries(item)).toBe(peaRouted);
      await audited([item], ['OFFER_ITEM_SERIES_CHANGED']);
      const offers = await apiResponse(adm.api.v1.sessions[':id'].offers.$get({ param: { id: w.id } }));
      const offered = offers.offers.find((o) => o.subjectId === subj.RTE);
      expect(offered?.items.map((i) => i.boardSeriesId)).toEqual([peaRouted]);
      // The family reserves it: entered in Pearson's series, no board mismatch.
      const reg = await prereg(w.id, subj.RTE!);
      expect(await seriesOf(reg)).toBe(peaRouted);
    });

    it("refused when a line would move to another deadline; an item with no lines moves to a series made for the new board", async () => {
      const w = await window('route rules');
      const camRouted = await series('cambridge', w.year, 'BC rules (routed)');
      const peaRouted = await series('pearson_edexcel', w.year, 'BC rules (routed)');
      const item = await place(w.id, subj.RTD!, camRouted);
      await deadline(camRouted, new Date(w.end.getTime() + days(10)));
      await deadline(peaRouted, new Date(w.end.getTime() + days(30)));
      await prereg(w.id, subj.RTD!);
      const differs = await refused(toPearson(subj.RTD!));
      expect(differs.error).toMatch(new RegExp(`^In ${esc(w.name)}, Board change RTD is entered in Cambridge International November \\d{4} \\(BC rules \\(routed\\)\\) \\(entry deadline .+\\) and would move to Pearson Edexcel November \\d{4} \\(BC rules \\(routed\\)\\) \\(entry deadline .+\\): a board change keeps the entry deadline — give the two series the same deadline first$`));
      expect(await itemSeries(item)).toBe(camRouted);
      expect(await councilOf(subj.RTD!)).toBe('cambridge');

      const v = await window('route none');
      const cam2Routed = await series('cambridge', v.year, 'BC none (routed)');
      const item2 = await place(v.id, subj.RTN!, cam2Routed);
      await apiResponse(toPearson(subj.RTN!));
      expect(await councilOf(subj.RTN!)).toBe('pearson_edexcel');
      // No Pearson series of that label: the board's own November series (made when not on record).
      expect(await one(`select bs.board_code, bs.month, bs.year, bs.label from session_offer_item i join board_series bs on bs.id = i.board_series_id where i.id = $1`, [item2]))
        .toEqual({ board_code: 'pearson_edexcel', month: 'november', year: v.year, label: '' });
    });
  });
});
