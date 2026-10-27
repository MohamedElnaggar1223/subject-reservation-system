import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiResponse, BoardsFileSchema, SubjectsFileSchema, REFERENCE_BOARD_CODES, academicYearStartOf } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, one, sql, refused, refusedWithCode, openWindow, confirmed, lockWaiters, CONSENT, type Client, type Impact,
} from './helpers';

/**
 * 08ze — P1c's follow-ups to the coordinator rework (the lead's decision of 26 Oct; .audit/coordinator-p1c.tsv):
 *
 * - 6. A winter row's Pay by change re-dates that row's waiting lines and answers its impact (dueDatesMoved,
 *   IMPACT_CHANGED), as the session's payment due date does (§6: a line's due date is its row's pay-by if set).
 * - 7. The checkout and the desk's collection pay the price the family was shown: a re-price that lands between
 *   the page's read and the click is refused (PRICE_CHANGED), never charged.
 * - 8. The board's list (the reference data, §7) is loaded by the API's start from the repository's files; the board's
 *   rules it owns are no longer edited on the parked screens (8b, the fix round's S3).
 * - 9. One lock order in the session's header save: the waiting lines are locked once, in id order.
 * - 10. P2's API limits (L9): an older earlier exam she kept is not asked again after a copy; a printed code in doubt on
 *   a paper row (4MA1H, 4MA2H at 9,840 on the November 2026 list) offers its second reading, the whole qualification.
 *
 * Money and dates are read back from the database.
 */

const RUN = Math.random().toString(36).slice(2, 6);
const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, '../../../packages/db');
const DAY = 86_400_000;

describe('08ze: P1c follow-ups', () => {
  let adm: Client, coordinator: Client, officer: Client;
  let geo: string, june: string, winter: string;

  const rowOf = async (sessionId: string, subjectId: string) =>
    (await one<{ id: string }>(`select i.id from session_offer_item i join session_offer o on o.id = i.offer_id where o.session_id = $1 and o.subject_id = $2`, [sessionId, subjectId])).id;
  const offeringOf = async (sessionId: string, subjectId: string) =>
    (await one<{ id: string }>(`select id from session_offer where session_id = $1 and subject_id = $2`, [sessionId, subjectId])).id;
  const reserve = async (f: { parent: Client; studentId: string }, sessionId: string, rowId: string, price: number) =>
    (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: {
      sessionId, studentId: f.studentId, consent: CONSENT, lines: [{ offerItemId: rowId, attempt: 'first', mode: 'in_school', expectedPrice: price }],
    } })))[0]!.id;
  const line = (id: string) => one<{ status: string; price: number; due: string }>(
    `select status, price_at_registration::float as price, due_at as due from registration where id = $1`, [id]);

  beforeAll(async () => {
    adm = await admin(`ze08-${RUN}`);
    coordinator = await staff(adm, 'coordinator', `ze08-${RUN}`);
    officer = await staff(adm, 'finance_officer', `ze08-${RUN}`);
    geo = await subject(adm, `ZE08G${RUN}`, `Geography (08ze ${RUN})`, { course: 1000, registration: 500 });
    june = await session(adm, 'June (08ze)', 'june', 'igcse', { ...openWindow(), activate: true });
    winter = await session(adm, 'November (08ze)', 'november', 'igcse', { ...openWindow(), activate: true });
  });

  it('6. a winter row\'s Pay by moved: its waiting lines are re-dated, counted first (dueDatesMoved), a stale count refused (IMPACT_CHANGED); new lines take it too', async () => {
    const row = await rowOf(winter, geo);
    const offeringId = await offeringOf(winter, geo);
    const f = await onboard(officer, `ze08-payby-${RUN}`, 11);
    const waiting = await reserve(f, winter, row, 1500);
    const before = await line(waiting);
    const s = await one<{ due: string }>(`select payment_due_at as due from registration_session where id = $1`, [winter]);
    expect(new Date(before.due).getTime()).toBe(new Date(s.due).getTime());

    const payBy = new Date(Date.now() + 10 * DAY);
    const view = await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$get({ param: { id: winter, offeringId } }));
    const r = view.rows.find((x) => x.id === row)!;
    const put = (expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({
      param: { id: winter, offeringId },
      json: { rows: [{ id: row, kind: r.kind as 'all_papers', cells: r.cells, payBy }], ...(expected ? { expected } : {}) },
    }));
    // Asked first: nothing written, the waiting line's due date counted.
    const shown = await put();
    expect(shown).toMatchObject({ saved: false, impact: { dueDatesMoved: 1, repriced: 0, linesAffected: 0 } });
    expect(new Date((await line(waiting)).due).getTime()).toBe(new Date(before.due).getTime());
    expect(await one(`select pay_by from session_offer_item where id = $1`, [row])).toEqual({ pay_by: null });
    // A count that is no longer what the change does is refused.
    const stale = await refusedWithCode(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({
      param: { id: winter, offeringId }, json: { rows: [{ id: row, kind: r.kind as 'all_papers', cells: r.cells, payBy }], expected: { ...shown.impact, dueDatesMoved: 0 } },
    }));
    expect([stale.status, stale.code]).toEqual([409, 'IMPACT_CHANGED']);
    // Confirmed: the row and its waiting line carry the new date, audited.
    expect(await put(shown.impact)).toMatchObject({ saved: true, impact: { dueDatesMoved: 1 } });
    expect(new Date((await line(waiting)).due).getTime()).toBe(payBy.getTime());
    expect(new Date((await one<{ pay_by: string }>(`select pay_by from session_offer_item where id = $1`, [row])).pay_by).getTime()).toBe(payBy.getTime());
    expect(await one(`select new_data->>'reason' as why from audit_log where action = 'LINE_DUE_MOVED' and entity_id = $1`, [waiting]))
      .toEqual({ why: expect.stringContaining('pay-by date of a row') });
    // A line reserved now takes the row's date too (the same date for every waiting line of the row).
    const g = await onboard(officer, `ze08-payby2-${RUN}`, 11);
    const later = await reserve(g, winter, row, 1500);
    expect(new Date((await line(later)).due).getTime()).toBe(payBy.getTime());
    // The same body again changes nothing.
    expect(await put()).toMatchObject({ saved: true, impact: { dueDatesMoved: 0 } });
  });

  it('6b. a row\'s Pay by moved into the past (the fix round\'s S2): the unpaid lines\' last day to pay brought forward is counted, and one already past (it would expire at the next sweep), as the session\'s due date counts them; a stale count is refused', async () => {
    const row = await rowOf(winter, geo);
    const offeringId = await offeringOf(winter, geo);
    const f = await onboard(officer, `ze08-payby3-${RUN}`, 11);
    const old = await reserve(f, winter, row, 1500);
    // Reserved twenty days ago, the session's prices final for a month (the review's case: reserved 1 Nov, Pay by 20 Nov,
    // moved on 15 Nov to 10 Nov) — so no prices-final grace moves its date.
    await sql(`update registration set created_at = now() - interval '20 days' where id = $1`, [old]);
    await sql(`update registration_session set prices_final_at = now() - interval '30 days' where id = $1`, [winter]);
    const view = await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$get({ param: { id: winter, offeringId } }));
    const r = view.rows.find((x) => x.id === row)!;
    // The row's unpaid lines: this one, and those test 6 reserved today (when it ran).
    const waiting = (await sql<{ id: string }>(`select id from registration where offer_item_id = $1 and status = 'pending_payment'`, [row])).length;
    // Ten days ago: the old line is due then and its last day to pay (+ the session's 3 days) has passed; lines reserved
    // today are due a week after reserving (payment.graceDays), earlier than the row's old date + 3.
    const payBy = new Date(Date.now() - 10 * DAY);
    const send = (expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({
      param: { id: winter, offeringId }, json: { rows: [{ id: row, kind: r.kind as 'all_papers', cells: r.cells, payBy }], ...(expected ? { expected } : {}) },
    }));
    const shown = await send();
    expect(shown).toMatchObject({ saved: false, impact: { dueDatesMoved: waiting, cutOffsEarlier: waiting, cutOffsPassed: 1 } });
    // A count that predates the cut-offs (the dialog of a client that showed only the due dates) is refused.
    const stale = await refusedWithCode(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({
      param: { id: winter, offeringId }, json: { rows: [{ id: row, kind: r.kind as 'all_papers', cells: r.cells, payBy }], expected: { ...shown.impact, cutOffsEarlier: 0, cutOffsPassed: 0 } },
    }));
    expect([stale.status, stale.code]).toEqual([409, 'IMPACT_CHANGED']);
    expect(await send(shown.impact)).toMatchObject({ saved: true });
    const cut = await one<{ cut: string }>(`select line_cut_off(due_at, session_id, attempt, prior_sitting_series_id, board_series_id, declaration_rejected) as cut from registration where id = $1`, [old]);
    expect(new Date(cut.cut).getTime()).toBeLessThan(Date.now());
  });

  it('7. the checkout pays the price the family saw: a re-price landing between the page\'s read and the click is refused (PRICE_CHANGED) and nothing is charged; the new price is then paid', async () => {
    const row = await rowOf(june, geo);
    const f = await onboard(officer, `ze08-co-${RUN}`, 11);
    const id = await reserve(f, june, row, 1500);
    // The checkout page reads the price.
    const page = await apiResponse(f.parent.api.v1.payments['checkout-summary'].$get({ query: { registrationIds: id } }));
    const shown = page.registrations.find((r) => r.id === id)!.priceAtRegistration;
    expect(shown).toBe(1500);
    // Meanwhile the coordinator raises the exam fee: the unpaid line is re-priced (E7).
    await confirmed((expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: june, rowId: row }, json: { amount: 700, ...(expected ? { expected } : {}) } })));
    expect((await line(id)).price).toBe(1700);
    // The click: refused at the price it showed, nothing charged.
    const refusedPay = await refusedWithCode(f.parent.api.v1.payments.initiate.$post({ json: {
      registrationIds: [id], paymentMethod: 'in_school', escrowAmountToApply: 0, expectedPrices: [{ registrationId: id, price: shown }],
    } }));
    expect(refusedPay.code).toBe('PRICE_CHANGED');
    expect(await sql(`select pr.payment_id from payment_registration pr where pr.registration_id = $1`, [id])).toEqual([]);
    // Read again, the new price is paid.
    const made = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: {
      registrationIds: [id], paymentMethod: 'in_school', escrowAmountToApply: 0, expectedPrices: [{ registrationId: id, price: 1700 }],
    } }));
    expect(await one(`select amount::float as amount, status from payment where id = $1`, [made.id])).toEqual({ amount: 1700, status: 'pending' });
    // Put the row's fee back for the next case.
    await confirmed((expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: june, rowId: row }, json: { amount: 500, ...(expected ? { expected } : {}) } })));
  });

  it('7. the desk collects the price its screen showed: a re-price landing meanwhile is refused (PRICE_CHANGED), nothing collected; the new price is then collected', async () => {
    const row = await rowOf(june, geo);
    const f = await onboard(officer, `ze08-desk-${RUN}`, 11);
    const id = await reserve(f, june, row, 1500);
    const screen = await apiResponse(officer.api.v1.users[':id'].summary.$get({ param: { id: f.studentId } }));
    const shown = screen.registrations.find((r) => r.id === id)!.priceAtRegistration;
    expect(shown).toBe(1500);
    await confirmed((expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: june, rowId: row }, json: { amount: 800, ...(expected ? { expected } : {}) } })));
    expect((await line(id)).price).toBe(1800);
    const refusedCollect = await refusedWithCode(officer.api.v1.registrations.desk.collect.$post({ json: {
      studentId: f.studentId, registrationIds: [id], instrumentUsed: 'cash', expectedPrices: [{ registrationId: id, price: shown }],
    } }));
    expect(refusedCollect.code).toBe('PRICE_CHANGED');
    expect(await sql(`select pr.payment_id from payment_registration pr where pr.registration_id = $1`, [id])).toEqual([]);
    expect((await line(id)).status).toBe('pending_payment');
    const collected = await apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: {
      studentId: f.studentId, registrationIds: [id], instrumentUsed: 'cash', expectedPrices: [{ registrationId: id, price: 1800 }],
    } }));
    expect(collected.collected).toBe(1800);
    expect(await line(id)).toMatchObject({ status: 'confirmed', price: 1800 });
    await confirmed((expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: june, rowId: row }, json: { amount: 500, ...(expected ? { expected } : {}) } })));
  });

  it('8. the API\'s start loads the board\'s list from the repository\'s files: a database whose list is empty holds every subject and row of the files after it', async () => {
    const { db, sql: s } = await import('@repo/db');
    const { loadReferenceFromFiles } = await import('../src/services/setup/reference.services');
    const files = {
      boards: BoardsFileSchema.parse(JSON.parse(readFileSync(path.join(dbDir, 'reference', 'boards.json'), 'utf8'))),
      subjects: REFERENCE_BOARD_CODES.map((b) => [b, SubjectsFileSchema.parse(JSON.parse(readFileSync(path.join(dbDir, 'reference', 'subjects', `${b}.json`), 'utf8')))] as const),
    };
    const wanted = files.subjects.flatMap(([b, list]) => list.map((x) => `${b}:${x.code}`)).sort();
    const rows = files.subjects.reduce((a, [, list]) => a + list.reduce((n, x) => n + x.rows.length, 0), 0);
    // In a transaction rolled back at the end: the list emptied (a database copied from an older one), then the start's load.
    class Rollback extends Error {}
    let seen: { before: number; after: string[]; rows: number; loaded: { subjects: number; rows: number } } | null = null;
    await db.transaction(async (tx) => {
      await tx.execute(s`delete from reference_row`);
      await tx.execute(s`delete from reference_subject`);
      const before = Number((await tx.execute(s`select count(*) as n from reference_subject`)).rows[0]!.n);
      const loaded = await loadReferenceFromFiles(tx);
      const after = (await tx.execute(s`select id from reference_subject order by id`)).rows.map((x) => String(x.id));
      const n = Number((await tx.execute(s`select count(*) as n from reference_row`)).rows[0]!.n);
      seen = { before, after, rows: n, loaded: { subjects: loaded.subjects, rows: loaded.rows } };
      throw new Rollback();
    }).catch((err) => { if (!(err instanceof Rollback)) throw err; });
    expect(seen).toEqual({ before: 0, after: wanted, rows, loaded: { subjects: wanted.length, rows } });
    // The start's call (apps/api/src/index.ts) is the one this exercises.
    expect(readFileSync(path.resolve(here, '../src/index.ts'), 'utf8')).toMatch(/await loadReferenceFromFiles\(\)/);
  });

  it('8b. the board\'s rules are the reference data\'s (the fix round\'s S3): the start\'s load puts the file\'s back, so the catalogue refuses a one-paper fee rule change and the board rules a carry-forward change; nothing changes', async () => {
    const { REFERENCE_RULE_REFUSAL } = await import('../src/services/setup/reference.services');
    const before = await one<{ fee: string; months: number | null; asks: boolean }>(
      `select one_paper_fee_key as fee, carry_forward_months as months, one_paper_asks_sitting as asks from exam_board where code = 'cambridge'`);
    expect(await refused(adm.api.v1.catalogue.boards[':code'].$put({ param: { code: 'cambridge' }, json: { onePaperFeeKey: 'unit', reason: 'the board now prices each paper' } })))
      .toEqual({ status: 409, error: REFERENCE_RULE_REFUSAL("The board's one-paper fee rule") });
    expect(await refused(coordinator.api.v1.exams['board-rules'][':boardCode'].$put({ param: { boardCode: 'cambridge' }, json: { carryForwardMonths: 4, reason: 'a shorter period' } })))
      .toEqual({ status: 409, error: REFERENCE_RULE_REFUSAL('The carry-forward period') });
    expect(await one(`select one_paper_fee_key as fee, carry_forward_months as months, one_paper_asks_sitting as asks from exam_board where code = 'cambridge'`)).toEqual(before);
    // Why: an edit made anyway (here by SQL, as the edits allowed before did) is put back by the next start's load (in a
    // transaction rolled back at the end).
    const { db, sql: s } = await import('@repo/db');
    const { loadReferenceFromFiles } = await import('../src/services/setup/reference.services');
    const file = BoardsFileSchema.parse(JSON.parse(readFileSync(path.join(dbDir, 'reference', 'boards.json'), 'utf8'))).find((b) => b.code === 'cambridge')!;
    class Rollback extends Error {}
    let afterLoad: unknown = null;
    await db.transaction(async (tx) => {
      await tx.execute(s`update exam_board set one_paper_fee_key = 'unit', carry_forward_months = 4, one_paper_asks_sitting = false where code = 'cambridge'`);
      await loadReferenceFromFiles(tx);
      afterLoad = (await tx.execute(s`select one_paper_fee_key as fee, carry_forward_months as months, one_paper_asks_sitting as asks from exam_board where code = 'cambridge'`)).rows[0];
      throw new Rollback();
    }).catch((err) => { if (!(err instanceof Rollback)) throw err; });
    expect(afterLoad).toEqual({ fee: file.onePaperFee === 'syllabus' ? 'qualification' : 'unit', months: file.carryForwardMonths, asks: file.onePaperAsksSitting });
  });

  it('9. the session\'s header save locks its waiting lines once, in id order: waiting behind a line, it holds no later line meanwhile', async () => {
    const row = await rowOf(june, geo);
    // Requests awaiting the parent (pending_approval), and a waiting-for-payment line after the first of them in id order
    // (ids are random: the earliest of four requests, and lines made until one sorts after it).
    const requests: string[] = [];
    for (let i = 0; i < 4; i++) {
      const asker = await onboard(officer, `ze08-ask${i}-${RUN}`, 11);
      const [made] = await apiResponse(asker.student.api.v1.registrations.request.$post({ json: {
        sessionId: june, consent: CONSENT, lines: [{ offerItemId: row, attempt: 'first', mode: 'in_school', expectedPrice: 1500 }],
      } }));
      expect(made!.status).toBe('pending_approval');
      requests.push(made!.id);
    }
    const request = { id: [...requests].sort()[0]! };
    let later: string | null = null;
    for (let i = 0; i < 12 && !later; i++) {
      const f = await onboard(officer, `ze08-lock${i}-${RUN}`, 11);
      const id = await reserve(f, june, row, 1500);
      if (id > request.id) later = id;
    }
    expect(later).not.toBeNull();
    // Another transaction holds the request's line (as one locking an interleaved set in id order would).
    const { default: pg } = await import('pg');
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    await other.query('BEGIN');
    await other.query(`SELECT id FROM registration WHERE id = $1 FOR UPDATE`, [request.id]);
    // The coordinator moves the payment due date: the save locks the waiting lines (it re-dates them, and counts the
    // unpaid ones' cut-offs) and waits on the request's.
    const due = await one<{ due: string }>(`select payment_due_at as due from registration_session where id = $1`, [june]);
    const save = apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: june }, json: { paymentDueAt: new Date(new Date(due.due).getTime() - 20 * DAY) } }));
    await lockWaiters(1);
    // The other transaction can still take the later line: the save took no line after the one it waits on.
    let tookLater: boolean;
    try {
      await other.query(`SELECT id FROM registration WHERE id = $1 FOR UPDATE NOWAIT`, [later]);
      tookLater = true;
    } catch {
      tookLater = false;
    }
    await other.query('ROLLBACK');
    await other.end();
    expect(tookLater).toBe(true);
    // Released, the save answers its impact (nothing written until confirmed).
    expect(await save).toMatchObject({ saved: false });
    expect(new Date((await one<{ due: string }>(`select payment_due_at as due from registration_session where id = $1`, [june])).due).getTime()).toBe(new Date(due.due).getTime());
  });

  describe('10. P2\'s API limits (L9), on the reference files\' boards and subjects', () => {
    const Y = academicYearStartOf() + 1;
    const label = `ze08-l9-${RUN}`;
    const file = <T,>(rel: string) => JSON.parse(readFileSync(path.join(dbDir, 'reference', rel), 'utf8')) as T;

    beforeAll(async () => {
      // The files' subjects and Pearson's rules and aliases (4MA1H and 4MA2H to check); no sitting of the files is loaded,
      // so no board date another scenario's series holds moves (as 08zb).
      const { db, loadReference } = await import('@repo/db');
      const boards = BoardsFileSchema.parse(file('boards.json')).filter((b) => b.code === 'pearson_edexcel').map((b) => ({ ...b, sittings: [] }));
      await loadReference(db, {
        boards,
        subjects: { cambridge: SubjectsFileSchema.parse(file('subjects/cambridge.json')), pearson_edexcel: SubjectsFileSchema.parse(file('subjects/pearson_edexcel.json')) },
      });
    });

    const view = (sessionId: string, offeringId: string) =>
      apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$get({ param: { id: sessionId, offeringId } }));
    const tooOld = async (sessionId: string) =>
      (await apiResponse(coordinator.api.v1.sessions[':id'].$get({ param: { id: sessionId } }))).checkList.filter((c) => c.code === 'carried_from_too_old').map((c) => c.message);

    it('an earlier exam older than the board carries forward, kept on purpose ("Keep it"), leaves the check list and is not asked again after a copy; one added later is asked', async () => {
      const a = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y, label } }));
      const bio = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: a.id }, json: { referenceCode: '0970' } }));
      const paper = bio.rows.find((r) => r.kind === 'paper')!;
      expect(paper.needsCarriedFrom).toBe(true);
      // Her list: June of last year and November two years back (19 months before June: older than Cambridge's 13).
      const rows = (extra: Record<string, unknown> = {}) => bio.rows.map((r) => ({
        id: r.id, kind: r.kind as 'all_papers', cells: r.cells,
        ...(r.id === paper.id ? { allowedPriorSittings: [{ month: 'june' as const, year: Y - 1 }, { month: 'november' as const, year: Y - 2 }], ...extra } : {}),
      }));
      await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: a.id, offeringId: bio.id }, json: { rows: rows() } }));
      const listed = (await view(a.id, bio.id)).rows.find((r) => r.id === paper.id)!.allowedPriorSittings;
      expect(listed.map((p) => [p.month, p.year, p.beyondCarryForward, p.kept])).toEqual([['june', Y - 1, false, false], ['november', Y - 2, true, false]]);
      expect(await tooOld(a.id)).toEqual([expect.stringContaining(`November ${Y - 2} is older than the board carries a result forward`)]);
      // "Keep it": kept, audited; the check list no longer asks; the editor's read still marks it older.
      expect(await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: a.id, offeringId: bio.id }, json: { olderSittingsKept: true } })))
        .toMatchObject({ saved: true });
      const kept = (await view(a.id, bio.id)).rows.find((r) => r.id === paper.id)!.allowedPriorSittings;
      expect(kept.map((p) => [p.month, p.year, p.beyondCarryForward, p.kept])).toEqual([['june', Y - 1, false, false], ['november', Y - 2, true, true]]);
      expect(await tooOld(a.id)).toEqual([]);
      expect(await one(`select new_data->>'via' as via from audit_log where action = 'OFFER_ITEM_UPDATED' and entity_id = $1 and new_data ? 'keptPriorSeriesIds'`, [paper.id]))
        .toEqual({ via: 'the check list (keep it)' });

      // Next year's session copied from it: the list moved a year, the kept exam kept — not asked again.
      const b = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y + 1, label, copyFromSessionId: a.id } }));
      const copied = (await apiResponse(coordinator.api.v1.sessions[':id'].$get({ param: { id: b.id } }))).offerings.find((o) => o.referenceCode === '0970')!;
      const moved = copied.rows.find((r) => r.kind === 'paper')!;
      expect(moved.allowedPriorSittings.map((p) => [p.month, p.year, p.beyondCarryForward, p.kept])).toEqual([['june', Y, false, false], ['november', Y - 1, true, true]]);
      expect(await tooOld(b.id)).toEqual([]);

      // An older one she adds later is a new question: asked until she keeps it too.
      await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: b.id, offeringId: copied.id }, json: {
        rows: copied.rows.map((r) => ({ id: r.id, kind: r.kind as 'all_papers', cells: r.cells,
          ...(r.id === moved.id ? { allowedPriorSittings: [{ month: 'june' as const, year: Y }, { month: 'november' as const, year: Y - 1 }, { month: 'june' as const, year: Y - 1 }] } : {}) })),
      } }));
      expect(await tooOld(b.id)).toEqual([expect.stringContaining(`June ${Y - 1} is older than the board carries a result forward`)]);
    });

    it('a printed code in doubt on a paper row (4MA1H, 4MA2H at 9,840) is offered both readings; read as the whole qualification it prices all papers and the papers keep their fees', async () => {
      const s = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y, label: `${label}-ma` } }));
      const ma = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: s.id }, json: { referenceCode: '4MA1' } }));
      const key = (k: string) => ma.rows.find((r) => r.referenceKey === k)!.id;
      // June's list: 4,600 a paper, so all papers 9,200 (the sum of its papers).
      for (const k of ['paper-1h', 'paper-2h']) {
        await apiResponse(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: s.id, rowId: key(k) }, json: { amount: 4600 } }));
      }
      const fees = async () => Object.fromEntries((await apiResponse(coordinator.api.v1.sessions[':id'].prices.$get({ param: { id: s.id } }))).rows
        .filter((r) => r.offeringId === ma.id).map((r) => [ma.rows.find((x) => x.id === r.rowId)!.referenceKey, [r.examFee, r.examFeeSource]]));
      expect(await fees()).toEqual({ 'all-papers': [9200, 'units_sum'], 'paper-1h': [4600, 'typed'], 'paper-2h': [4600, 'typed'] });

      const text = '4MA1H    Mathematics A Paper 1H     9,840\n4MA2H    Mathematics A Paper 2H     9,840';
      const parsed = await apiResponse(coordinator.api.v1.sessions[':id']['price-lists'].parse.$post({ param: { id: s.id }, json: { board: 'pearson_edexcel', text } }));
      expect(parsed.rows.map((r) => [r.code, r.amount, r.matches.map((m) => [m.matchedKey, m.toCheck, m.readings?.map((x) => [x.reading, x.matchedKey, x.rowIds])])])).toEqual([
        ['4MA1H', 9840, [['4MA1:paper-1h', true, [['paper', '4MA1:paper-1h', [key('paper-1h')]], ['whole', '4MA1:all-papers', [key('all-papers')]]]]]],
        ['4MA2H', 9840, [['4MA1:paper-2h', true, [['paper', '4MA1:paper-2h', [key('paper-2h')]], ['whole', '4MA1:all-papers', [key('all-papers')]]]]]],
      ]);
      const lines = parsed.rows.map((r) => ({ lineNo: r.lineNo, code: r.code, name: r.name, amount: r.amount }));
      // Not read yet: shown with both readings, nothing applied.
      const unread = await apiResponse(coordinator.api.v1.sessions[':id']['price-lists'].$post({ param: { id: s.id }, json: { board: 'pearson_edexcel', name: `Edexcel November 2026 ${RUN}`, rows: lines } }));
      expect(unread.toConfirm.map((t) => [t.code, t.readings?.map((x) => x.reading)])).toEqual([['4MA1H', ['paper', 'whole']], ['4MA2H', ['paper', 'whole']]]);
      expect(await fees()).toEqual({ 'all-papers': [9200, 'units_sum'], 'paper-1h': [4600, 'typed'], 'paper-2h': [4600, 'typed'] });
      // Read as the whole qualification: all papers 9,840 from the list; the papers keep June's fees.
      const whole = await apiResponse(coordinator.api.v1.sessions[':id']['price-lists'].$post({ param: { id: s.id }, json: {
        board: 'pearson_edexcel', name: `Edexcel November 2026 ${RUN}`, rows: lines.map((l) => ({ ...l, reading: 'whole' as const })),
      } }));
      expect(whole).toMatchObject({ saved: true, matched: 2, toConfirm: [] });
      expect(await fees()).toEqual({ 'all-papers': [9840, 'list'], 'paper-1h': [4600, 'typed'], 'paper-2h': [4600, 'typed'] });
      // Read per paper instead (her other choice): each paper 9,840; all papers, now hers from the list, stays.
      await apiResponse(coordinator.api.v1.sessions[':id']['price-lists'].$post({ param: { id: s.id }, json: {
        board: 'pearson_edexcel', name: `Edexcel November 2026 per paper ${RUN}`, rows: lines.map((l) => ({ ...l, reading: 'paper' as const })),
      } }));
      expect(await fees()).toEqual({ 'all-papers': [9840, 'list'], 'paper-1h': [9840, 'list'], 'paper-2h': [9840, 'list'] });
    });
  });
});
