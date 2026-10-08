import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import { admin, staff, onboard, subject, session, refused, one, sql, audited, notified, notificationsFor, waitFor, money, sessionName, openWindow, runPaymentDeadlines, type Client, reservationOf } from './helpers';

/**
 * F0b — board series (FEATURES_PLAN.md F0b; DISCOVERY_RESEARCH.md §5 note 1; IMPORT_SPIKE.md
 * IS-05, IS-14), on the reservations rework's model (RESERVATIONS_REWORK.md §3.3): a session's
 * items are each entered in one series, attached when the item is placed in it; the window's
 * series panel is gone.
 *
 * One session's Pearson items sit in two series with different entry deadlines — IAL October
 * (Mathematics) and IAL January (Biology) of the same academic year — and each deadline is
 * enforced on its own series (MO-10 per board series): the grace after the close is capped by
 * each checkout's own series, confirmation, references and new registrations are refused per
 * series, and the scheduler's sweep closes each series at its own time with the money outcome
 * asserted.
 *
 * Changed by the reservations rework (trail rows "assertion"): a series is placed per item
 * (refused per item when it is not of the session's year and kind); a subject not offered is
 * refused as such; the admin's move goes to a sibling item; a board change follows the item to
 * the new board's default series; a deadline may fall before the session's end (pre-authorised:
 * 08i's window-end-versus-deadline scenarios), with every money outcome per series kept.
 */

const escrowOf = async (studentId: string) =>
  money((await one<{ balance: string }>(`select balance from escrow where student_id = $1`, [studentId])).balance);
const statusOf = async (table: 'payment' | 'registration', id: string) =>
  (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;
const seriesOfRegistration = async (id: string) =>
  (await one<{ s: string | null }>(`select board_series_id as s from registration where id = $1`, [id])).s;

describe('F0b: board series', () => {
  let adm: Client, coordinator: Client, officer: Client, finadmin: Client;
  let windowId: string, oct: string, jan: string, june: string, nextOct: string;
  const subj: Record<string, string> = {};
  const Y = academicYearStartOf();
  const deadlineSentence = /^The registration window is not open: the exam board's entry deadline for this series \(.+\) has passed$/;

  type Family = { parent: Client; student: Client; studentId: string };
  const family = (tag: string): Promise<Family> => onboard(officer, `bs-${tag}`, 12);
  const direct = async (f: Family, subjectIds: string[]) =>
    apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: windowId, ...(await reservationOf(windowId, subjectIds)), studentId: f.studentId } }));
  const checkout = (f: Family, ids: string[], method: 'instapay' | 'in_school', escrow = 0) =>
    apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: ids, paymentMethod: method, escrowAmountToApply: escrow } }));
  // A series with neither an entry deadline nor an exam start takes no line (§3.3): the exams' start is on record.
  const series = (json: { month: 'january' | 'june' | 'october' | 'november'; year: number }) =>
    apiResponse(coordinator.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', label: 'series', examsStart: `${json.year + 1}-12-31`, ...json } }));
  /** The whole item of a subject in the session, and its offer. */
  const itemOf = (subjectId: string) => one<{ id: string; offer_id: string }>(
    `select i.id, i.offer_id from session_offer_item i join session_offer o on o.id = i.offer_id
     where i.session_id = $1 and o.subject_id = $2 and i.availability <> 'closed' order by i.id limit 1`, [windowId, subjectId]);
  /** Place a subject's item in a series (the coordinator's per-item choice, §3.3). */
  const place = async (subjectId: string, boardSeriesId: string) => {
    const it = await itemOf(subjectId);
    return coordinator.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({
      param: { id: windowId, offerId: it.offer_id, itemId: it.id }, json: { boardSeriesId, reason: 'where the board sits it' },
    });
  };
  /** The subject's board fee in a series (its registration fee, confirmed). */
  const fee = (seriesId: string, subjectId: string) => apiResponse(finadmin.api.v1['board-fees'].$put({
    query: { seriesId }, json: { rows: [{ keyKind: 'subject', keyId: subjectId, amount: 400, provisional: false }] },
  }));

  beforeAll(async () => {
    adm = await admin('bs');
    coordinator = await staff(adm, 'coordinator', 'bs');
    officer = await staff(adm, 'finance_officer', 'bs');
    finadmin = await staff(adm, 'finance_admin', 'bs');
    for (const [code, name, council] of [
      ['MA3', 'Pure Mathematics 3', 'pearson_edexcel'], ['MA4', 'Pure Mathematics 4', 'pearson_edexcel'],
      ['BI4', 'Biology Unit 4', 'pearson_edexcel'], ['BI5', 'Biology Unit 5', 'pearson_edexcel'],
      ['GEO', 'Geography', 'cambridge'],
    ] as const) {
      subj[code] = await subject(adm, `BS-${code}`, `${name} (series)`, { course: 1000, registration: 400 }, { qualificationLevel: 'as_level', council });
    }
    windowId = await session(adm, 'January (AS, series)', 'january', 'as_level', { ...openWindow(), activate: true });
    // IAL October and IAL January of this academic year, June of it, and October of the next.
    oct = (await series({ month: 'october', year: Y })).id;
    jan = (await series({ month: 'january', year: Y + 1 })).id;
    june = (await series({ month: 'june', year: Y + 1 })).id;
    nextOct = (await series({ month: 'october', year: Y + 1 })).id;
    for (const id of [subj.MA3!, subj.MA4!, subj.BI4!, subj.BI5!]) { await fee(oct, id); await fee(jan, id); }
  });

  describe("a session's items are entered in series of its own academic year and kind", () => {
    it("refuses a June series and a series of another academic year for an item, each with the rule's sentence", async () => {
      expect(await refused(place(subj.MA3!, june))).toEqual({
        status: 400, error: `Pearson Edexcel June ${Y + 1} (series) is not a series of this session (October or November ${Y}, or January ${Y + 1})`,
      });
      expect(await refused(place(subj.MA3!, nextOct))).toEqual({
        status: 400, error: `Pearson Edexcel October ${Y + 1} (series) is not a series of this session (October or November ${Y}, or January ${Y + 1})`,
      });
      // And the database refuses what gets past the service.
      await expect(sql(
        `insert into session_board_series (id, session_id, board_series_id, board_code, is_default) values (gen_random_uuid()::text, $1, $2, 'pearson_edexcel', false)`,
        [windowId, june],
      )).rejects.toThrow();
    });

    it('Mathematics is placed in IAL October and Biology in IAL January: each series attached by its items', async () => {
      for (const id of [subj.MA3!, subj.MA4!]) await apiResponse(place(id, oct));
      for (const id of [subj.BI4!, subj.BI5!]) await apiResponse(place(id, jan));
      const it = await itemOf(subj.MA3!);
      await audited([it.id], ['OFFER_ITEM_SERIES_CHANGED']);
      const view = await apiResponse(coordinator.api.v1.sessions[':id']['board-series'].$get({ param: { id: windowId } }));
      expect(view.session).toMatchObject({ academicYearStart: Y, sessionType: 'winter' });
      // The Pearson series are the two the items are in (the suite's own series, now unused, detached).
      expect(view.series.filter((s) => s.boardCode === 'pearson_edexcel').map((s) => [s.name, s.items.map((i) => i.subjectName).sort()])).toEqual([
        [`Pearson Edexcel January ${Y + 1} (series)`, ['Biology Unit 4 (series)', 'Biology Unit 5 (series)']],
        [`Pearson Edexcel October ${Y} (series)`, ['Pure Mathematics 3 (series)', 'Pure Mathematics 4 (series)']],
      ]);
    });
  });

  describe("each registration is entered in its item's series", () => {
    let a: Family;
    it('Mathematics goes to October, Biology to January; a subject the session does not offer is refused and not listed', async () => {
      // Geography is taken off the session (no line yet): not offered.
      const geo = await itemOf(subj.GEO!);
      await apiResponse(coordinator.api.v1.sessions[':id'].offers[':offerId'].$delete({ param: { id: windowId, offerId: geo.offer_id } }));
      a = await family('route');
      const regs = await direct(a, [subj.MA3!, subj.BI4!]);
      const bySubject = Object.fromEntries(regs.map((r) => [r.subjectId, r.id]));
      expect(await seriesOfRegistration(bySubject[subj.MA3!]!)).toBe(oct);
      expect(await seriesOfRegistration(bySubject[subj.BI4!]!)).toBe(jan);

      // Step B: the offers read (GET /registrations/available is gone) — the items not yet held.
      const read = await apiResponse(a.parent.api.v1.registrations.offers.$get({ query: { sessionId: windowId, studentId: a.studentId } }));
      const available = read.offers.filter((o) => o.subject.code.startsWith('BS-')).flatMap((o) => o.items.filter((i) => !i.held).map((i) => ({ code: o.subject.code, series: i.series })));
      // Not the two already registered, not Geography (not offered here).
      expect(available.map((s) => s.code).sort()).toEqual(['BS-BI5', 'BS-MA4']);
      expect(available.find((s) => s.code === 'BS-BI5')!.series).toMatchObject({ id: jan, month: 'january', year: Y + 1, label: 'series' });
      // A subject the session does not offer has no item to reserve: the line names one not on offer.
      expect(await refused(a.parent.api.v1.registrations.direct.$post({ json: { sessionId: windowId, ...(await reservationOf(windowId, [subj.GEO!])), studentId: a.studentId } }))).toEqual({
        status: 404, error: 'That item is not on offer in this session',
      });
      // The database enters a line in its item's series and refuses another.
      const ma4 = await itemOf(subj.MA4!);
      await expect(sql(
        `insert into registration (id, student_id, session_id, subject_id, price_at_registration, status, requested_by, board_series_id, offer_item_id, due_at)
         values (gen_random_uuid()::text, $1, $2, $3, 0, 'pending_payment', $1, $4, $5, now())`,
        [a.studentId, windowId, subj.MA4!, jan, ma4.id],
      )).rejects.toThrow();
    });

    it('the admin moves a registration to the other series of its board, with a reason; history stays', async () => {
      const [ma3] = await sql<{ id: string }>(`select id from registration where student_id = $1 and subject_id = $2`, [a.studentId, subj.MA3!]);
      // The admin's move goes to an item entering the same in the target series: none yet.
      expect(await refused(adm.api.v1.sessions[':id']['board-series'].move.$post({
        param: { id: windowId }, json: { registrationIds: [ma3!.id], boardSeriesId: jan, reason: 'sits P3 in January instead' },
      }))).toEqual({ status: 409, error: `Pure Mathematics 3 (series) has no item entering the same in Pearson Edexcel January ${Y + 1} (series) — add one to the subject (or move the item's series) first` });
      const it = await itemOf(subj.MA3!);
      const sibling = await apiResponse(coordinator.api.v1.sessions[':id'].offers[':offerId'].items.$post({
        param: { id: windowId, offerId: it.offer_id },
        json: { label: 'Whole subject (January)', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: jan, availability: 'open', requiredInSeries: false },
      }));
      const moved = await apiResponse(adm.api.v1.sessions[':id']['board-series'].move.$post({
        param: { id: windowId }, json: { registrationIds: [ma3!.id], boardSeriesId: jan, reason: 'sits P3 in January instead' },
      }));
      expect(moved).toMatchObject({ moved: 1, alreadyThere: 0, boardSeriesId: jan });
      expect(await seriesOfRegistration(ma3!.id)).toBe(jan);
      await audited([ma3!.id], ['REGISTRATION_SERIES_MOVED']);
      // …and back, so the deadlines below read as designed; the January item, with no line, is removed.
      await apiResponse(adm.api.v1.sessions[':id']['board-series'].move.$post({
        param: { id: windowId }, json: { registrationIds: [ma3!.id], boardSeriesId: oct, reason: 'back to October after all' },
      }));
      await apiResponse(coordinator.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$delete({ param: { id: windowId, offerId: it.offer_id, itemId: sibling.id } }));
      // An item with live lines cannot be unticked.
      expect(await refused(coordinator.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$delete({ param: { id: windowId, offerId: it.offer_id, itemId: it.id } }))).toEqual({
        status: 409, error: 'Whole subject has 1 live line: move or drop it first',
      });
    });

    it("the coordinator's answer moves a subject to another board: its item and live lines follow to that board's default series", async () => {
      const che = await subject(adm, 'BS-CHE', 'Chemistry (series)', { course: 1000, registration: 400 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
      await fee(oct, che);
      await apiResponse(place(che, oct));
      const z = await family('board');
      const reg = (await direct(z, [che]))[0]!.id;
      expect(await seriesOfRegistration(reg)).toBe(oct);
      const oxfordAward = await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
        json: { boardCode: 'oxford', code: '9621', title: 'Chemistry (AS)', level: 'as_level', suite: 'OxfordAQA International AS', subjectArea: 'Chemistry', entryMethod: 'qualification' },
      }));
      // MO-10 per line: the line's cut-off (October's exams' start: no entry deadline yet) is the
      // same where it goes, so OxfordAQA's November gets that date first.
      const octExams = (await one<{ d: string }>(`select exams_start::text as d from board_series where id = $1`, [oct])).d;
      const [oxRow] = await sql<{ id: string }>(`select id from board_series where board_code = 'oxford' and month = 'november' and year = $1 and label = ''`, [Y]);
      if (oxRow) await apiResponse(adm.api.v1['board-series'][':id'].$put({ param: { id: oxRow.id }, json: { examsStart: octExams } }));
      else await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'oxford', month: 'november', year: Y, examsStart: octExams } }));
      const r = await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({
        param: { subjectId: che }, json: { boardCode: 'oxford', qualificationId: oxfordAward.id, unitIds: [], reason: 'coordinator: Chemistry is OxfordAQA' },
      }));
      expect(r).toMatchObject({ boardCode: 'oxford', registrationsMoved: 1 });
      // OxfordAQA's November of the session (its AS default).
      const oxNov = await one<{ id: string }>(`select id from board_series where board_code = 'oxford' and month = 'november' and year = $1 and label = ''`, [Y]);
      expect(await seriesOfRegistration(reg)).toBe(oxNov.id);
      await audited([reg], ['REGISTRATION_SERIES_MOVED']);
      expect((await one<{ council: string }>(`select council from subject where id = $1`, [che])).council).toBe('oxford');
    });
  });

  describe('a session whose items sit in two board series with different deadlines, each enforced (MO-10 per series)', () => {
    let b: Family, d: Family, e: Family, f: Family, x: Family;
    let bPay: string, dPay: string, ePay: string, fPay: string, bReg: string, dReg: string, eReg: string, fReg: string;
    let octDeadline: Date, janDeadline: Date;

    it('only the admin sets an entry deadline, in the future; it may fall before the session closes; the late-fee dates are information', async () => {
      // Families with money in flight in each series before the close.
      b = await family('b'); d = await family('d'); e = await family('e'); f = await family('f'); x = await family('x');
      // B pays for Mathematics (October) by InstaPay, with 200 from escrow, and sends the reference.
      const fundB = await apiResponse(officer.api.v1.registrations.desk.$post({
        json: { studentId: b.studentId, sessionId: windowId, ...(await reservationOf(windowId, [subj.MA4!])), collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
      }));
      await apiResponse(b.parent.api.v1.registrations[':id'].drop.$post({ param: { id: fundB.registrations[0]!.id }, json: { reason: 'setup for escrow' } }));
      expect(await escrowOf(b.studentId)).toBe(1400);
      bReg = (await direct(b, [subj.MA3!]))[0]!.id;
      bPay = (await checkout(b, [bReg], 'instapay', 200)).id!;
      await apiResponse(b.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: bPay }, json: { reference: 'FT-BS-B' } }));
      // D pays for Biology (January) the same way.
      dReg = (await direct(d, [subj.BI4!]))[0]!.id;
      dPay = (await checkout(d, [dReg], 'instapay')).id!;
      await apiResponse(d.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: dPay }, json: { reference: 'FT-BS-D' } }));
      // E (October) and F (January) start InstaPay checkouts and have not sent a reference yet.
      eReg = (await direct(e, [subj.MA3!]))[0]!.id;
      ePay = (await checkout(e, [eReg], 'instapay')).id!;
      fReg = (await direct(f, [subj.BI4!]))[0]!.id;
      fPay = (await checkout(f, [fReg], 'instapay')).id!;

      // The session will close in a minute; the board calendars come in.
      await sql(`update registration_session set end_date = now() + interval '1 minute' where id = $1`, [windowId]);
      const now = Date.now();
      octDeadline = new Date(now + 2 * 60 * 60 * 1000);
      janDeadline = new Date(now + 3 * 24 * 60 * 60 * 1000);
      const setDeadline = (by: Client, id: string, entryDeadline: Date, reason = 'board key dates published') =>
        by.api.v1['board-series'][':id'].$put({ param: { id }, json: { entryDeadline, reason } });
      expect(await refused(setDeadline(coordinator, oct, octDeadline))).toEqual({
        status: 403, error: "Only an admin sets the exam board's entry deadline: past it the school closes every unconfirmed payment on the series (MO-10)",
      });
      // Changed (pre-authorised): a deadline in the past is refused as such — it used to be
      // refused as "before the window closes", a rule the rework retires (the cut-off is per item).
      expect(await refused(setDeadline(adm, oct, new Date(now - 60 * 1000)))).toEqual({ status: 400, error: "The board's entry deadline must be in the future" });
      expect(await refused(adm.api.v1['board-series'][':id'].$put({ param: { id: oct }, json: { entryDeadline: octDeadline } }))).toEqual({
        status: 400, error: 'Please provide a reason (min 5 characters)',
      });
      await apiResponse(setDeadline(adm, oct, octDeadline));
      await apiResponse(setDeadline(adm, jan, janDeadline));
      await audited([oct], ['BOARD_SERIES_DEADLINE_SET']);
      await audited([jan], ['BOARD_SERIES_DEADLINE_SET']);
      // The coordinator records the late-fee tiers; they are shown, never enforced.
      const late = await apiResponse(coordinator.api.v1['board-series'][':id'].$put({ param: { id: jan }, json: { lateFeeFrom: '2026-10-17', highLateFeeFrom: '2026-11-14', notes: 'fee doubles, then trebles' } }));
      expect(late).toMatchObject({ lateFeeFrom: '2026-10-17', highLateFeeFrom: '2026-11-14' });
      await audited([jan], ['BOARD_SERIES_UPDATED']);
      // Changed (pre-authorised): the session may now stay open past the earlier deadline — what
      // October's items can do ends at October's deadline (it was refused). Then back to a minute.
      const extended = await apiResponse(adm.api.v1.sessions[':id'].$put({
        param: { id: windowId }, json: { endDate: new Date(octDeadline.getTime() + 60 * 1000), reason: 'extend past the October deadline' },
      }));
      expect(new Date(extended.endDate).getTime()).toBe(octDeadline.getTime() + 60 * 1000);
      await sql(`update registration_session set end_date = now() + interval '1 minute' where id = $1`, [windowId]);
    });

    it('at the close, the time left to send a reference is capped by each checkout\'s own series (MO-10)', async () => {
      await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: windowId }, json: { reason: 'series: the window closes' } }));
      const due = async (id: string) => new Date((await one<{ due: string }>(`select reference_due_at as due from payment where id = $1`, [id])).due).getTime();
      // E's October checkout gets until October's deadline (2 hours); F's January one the full 24 hours.
      expect(Math.abs((await due(ePay)) - octDeadline.getTime())).toBeLessThan(1000);
      expect(Math.abs((await due(fPay)) - (Date.now() + 24 * 60 * 60 * 1000))).toBeLessThan(60 * 1000);
      expect([await statusOf('payment', bPay), await statusOf('payment', dPay)]).toEqual(['pending_verification', 'pending_verification']);
    });

    it("past October's deadline, before the sweep: October's entries are refused, January's go on", async () => {
      await sql(`update registration_session set end_date = now() - interval '1 day' where id = $1`, [windowId]);
      await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [oct]);

      const confirmB = await refused(officer.api.v1.payments[':id'].confirm.$post({ param: { id: bPay }, json: {} }));
      expect(confirmB.status).toBe(400);
      expect(confirmB.error).toMatch(deadlineSentence);
      const referenceE = await refused(e.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: ePay }, json: { reference: 'FT-BS-E' } }));
      expect(referenceE.error).toMatch(deadlineSentence);
      // D's January transfer is still confirmed after the close: its series is open.
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: dPay }, json: {} }));
      expect(await statusOf('registration', dReg)).toBe('confirmed');
      // F can still send the reference for January.
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: fPay }, json: { reference: 'FT-BS-F' } }));

      // A student with a deadline extension registers for January, never October.
      await apiResponse(finadmin.api.v1.exceptions.$post({
        json: { type: 'deadline_extension', studentId: x.studentId, sessionId: windowId, validUntil: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), reason: 'late family, approved by the head' },
      }));
      const lateOct = await refused(x.parent.api.v1.registrations.direct.$post({ json: { sessionId: windowId, ...(await reservationOf(windowId, [subj.MA4!])), studentId: x.studentId } }));
      expect(lateOct.status).toBe(422);
      expect(lateOct.error).toMatch(deadlineSentence);
      const xJan = (await direct(x, [subj.BI5!]))[0]!.id;
      expect(await seriesOfRegistration(xJan)).toBe(jan);
    });

    it("the sweep closes October only: its open payments fail with escrow back, its waiting entries expire, families told; January's stay", async () => {
      const swept = await runPaymentDeadlines();
      expect(swept.paymentsClosedAtDeadline).toBeGreaterThanOrEqual(2);
      expect([await statusOf('payment', bPay), await statusOf('payment', ePay)]).toEqual(['failed', 'failed']);
      expect([await statusOf('registration', bReg), await statusOf('registration', eReg)]).toEqual(['expired', 'expired']);
      expect(await escrowOf(b.studentId)).toBe(1400);
      await audited([bPay], ['PAYMENT_FAILED']);
      await audited([bReg], ['REGISTRATION_EXPIRED']);
      const notice = (await notified(b.parent.email, 'PAYMENT_EXPIRED', 1))[0]!;
      expect(notice.title).toBe('Payment closed at the exam board deadline');
      // January is untouched.
      expect(await statusOf('payment', fPay)).toBe('pending_verification');
      expect(await statusOf('registration', fReg)).toBe('pending_payment');
      expect(await statusOf('registration', dReg)).toBe('confirmed');
      // Running it again changes nothing.
      expect(await runPaymentDeadlines()).toMatchObject({ paymentsClosedAtDeadline: 0, registrationsExpiredAtDeadline: 0 });
    });

    it("January's deadline closes January at its own time; the expiry notice names the series", async () => {
      await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [jan]);
      const swept = await runPaymentDeadlines();
      expect(swept.paymentsClosedAtDeadline).toBeGreaterThanOrEqual(1);
      expect(await statusOf('payment', fPay)).toBe('failed');
      expect(await statusOf('registration', fReg)).toBe('expired');
      expect(await statusOf('registration', dReg)).toBe('confirmed');
      const notEntered = await waitFor(async () => (await notificationsFor(x.student.email, 'SESSION_CLOSED')).find((n) => n.title.startsWith('Not entered')) ?? null);
      const name = (await sessionName(windowId)).replace(/[()]/g, '\\$&');
      expect(notEntered.body).toMatch(new RegExp(`^The exam board's entry deadline for Pearson Edexcel January ${Y + 1} \\(series\\) \\(.+\\) has passed, so these subjects registered in ${name} were not entered: Biology Unit 5 \\(series\\)\\.$`));
      // An entry in a series past its deadline cannot be moved.
      expect(await refused(adm.api.v1.sessions[':id']['board-series'].move.$post({
        param: { id: windowId }, json: { registrationIds: [dReg], boardSeriesId: oct, reason: 'too late to move' },
      }))).toMatchObject({ status: 400 });
    });
  });
});
