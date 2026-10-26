import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, audited, futureWindow, sessionName, subjectFeeIn, type Client,
  reservationOf,
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
 *
 * The coordinator rework (P1a): a subject set up through the subject editor is priced by its board's rows, and
 * its board change is refused with nothing moved (08y), so the scenarios that moved one are retired (see below);
 * what the 0038 migration inferred, listed for staff to check, stays.
 */


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
  const prereg = async (sessionId: string, subjectId: string) =>
    (await apiResponse(fam.parent.api.v1.registrations.preregister.$post({ json: { sessionId, ...(await reservationOf(sessionId, [subjectId])), studentId: fam.studentId } })))[0]!.id;

  beforeAll(async () => {
    adm = await admin('bc');
    coordinator = await staff(adm, 'coordinator', 'bc');
    officer = await staff(adm, 'finance_officer', 'bc');
    for (const tag of ['PAS', 'DIF', 'SAM', 'RTE', 'RTD', 'RTN']) {
      subj[tag] = await subject(adm, `BC-${tag}`, `Board change ${tag}`, { course: 1000, registration: 400 });
    }
    fam = await onboard(officer, 'bc', 11);
  });

  // Retired with the coordinator rework (P1a; .audit/coordinator-p1a.tsv): a subject set up through the subject editor is
  // priced by its board's rows, and a board change of it is refused (08y 'reservations are protected'), so the scenarios
  // that moved such a subject's rows and lines across boards — MO-10 on the way (past the entry deadline, another
  // deadline, the same deadline), the Subjects form's board choice, an item moving with its subject (flag 2) — have
  // nothing to move. MO-10 holds: nothing moves at all. P1b removes the board-change machinery with the per-series code.

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
});
