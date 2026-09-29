import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, academicYearShortLabel } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, audited, notified, notificationsFor, waitFor, money,
  openWindow, runPaymentDeadlines, type Client,
} from './helpers';

/**
 * F0b — board series and the windows that feed them (FEATURES_PLAN.md F0b;
 * DISCOVERY_RESEARCH.md §5 note 1; IMPORT_SPIKE.md IS-05, IS-14).
 *
 * One window feeds two Pearson series with different entry deadlines — IAL
 * October and IAL January of the same academic year — and each deadline is
 * enforced on its own series (MO-10 per board series): the grace after the
 * close is capped by each checkout's own series, confirmation, references
 * and new registrations are refused per series, and the scheduler's sweep
 * closes each series at its own time with the money outcome asserted.
 *
 * Window pair: january / as_level (08, 08b and 08c close theirs); it is closed
 * in this file.
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
    apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: windowId, subjectIds, studentId: f.studentId } }));
  const checkout = (f: Family, ids: string[], method: 'instapay' | 'in_school', escrow = 0) =>
    apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: ids, paymentMethod: method, escrowAmountToApply: escrow } }));
  const series = (json: { month: 'january' | 'june' | 'october' | 'november'; year: number }) =>
    apiResponse(coordinator.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', label: 'series', ...json } }));
  const setWindow = (json: { series: { boardSeriesId: string; isDefault: boolean }[]; routes: { subjectId: string; boardSeriesId: string }[] }) =>
    adm.api.v1.sessions[':id']['board-series'].$put({ param: { id: windowId }, json });

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
  });

  describe('a window feeds series of its own academic year and kind', () => {
    it("refuses a June series and a series of another academic year, each with the rule's sentence", async () => {
      expect(await refused(setWindow({ series: [{ boardSeriesId: june, isDefault: true }], routes: [] }))).toEqual({
        status: 400, error: `This window is for January ${Y + 1}: it feeds October, November or January series, not Pearson Edexcel June ${Y + 1} (series)`,
      });
      expect(await refused(setWindow({ series: [{ boardSeriesId: nextOct, isDefault: true }], routes: [] }))).toEqual({
        status: 400,
        error: `Pearson Edexcel October ${Y + 1} (series) is in ${academicYearShortLabel(Y + 1)}; this window is for January ${Y + 1}, in ${academicYearShortLabel(Y)}. Every series a window feeds is in the window's academic year`,
      });
      expect(await refused(setWindow({ series: [{ boardSeriesId: oct, isDefault: true }, { boardSeriesId: jan, isDefault: true }], routes: [] }))).toEqual({
        status: 400, error: 'Choose which Pearson Edexcel series is the default for this window',
      });
      // And the database refuses what gets past the service.
      await expect(sql(
        `insert into session_board_series (id, session_id, board_series_id, board_code, is_default) values (gen_random_uuid()::text, $1, $2, 'pearson_edexcel', false)`,
        [windowId, june],
      )).rejects.toThrow();
    });

    it('feeds IAL October (the Pearson default) and IAL January, with Biology routed to January', async () => {
      const r = await apiResponse(setWindow({
        series: [{ boardSeriesId: oct, isDefault: true }, { boardSeriesId: jan, isDefault: false }],
        routes: [{ subjectId: subj.BI4!, boardSeriesId: jan }, { subjectId: subj.BI5!, boardSeriesId: jan }],
      }));
      expect(r).toEqual({ sessionId: windowId, series: 2, routes: 2, registrationsRouted: 0 });
      await audited([windowId], ['SESSION_BOARD_SERIES_SET']);
      const view = await apiResponse(coordinator.api.v1.sessions[':id']['board-series'].$get({ param: { id: windowId } }));
      expect(view.session).toMatchObject({ academicYearStart: Y, series: `January ${Y + 1}` });
      expect(view.series.map((s) => [s.name, s.isDefault])).toEqual([
        [`Pearson Edexcel October ${Y} (series)`, true], [`Pearson Edexcel January ${Y + 1} (series)`, false],
      ]);
      const entersIn = Object.fromEntries(view.subjects.map((s) => [s.code, s.entersIn]));
      expect(entersIn).toMatchObject({ 'BS-MA3': oct, 'BS-MA4': oct, 'BS-BI4': jan, 'BS-BI5': jan, 'BS-GEO': null });
      // The window's series was implied by its type and year (F0a); a correction
      // that would leave its board series in another academic year is refused.
      const move = await refused(adm.api.v1.sessions[':id'].series.$put({ param: { id: windowId }, json: { sessionType: 'january', seriesYear: Y + 2, reason: 'wrong year typed' } }));
      expect(move.status).toBe(400);
      expect(move.error).toMatch(/^This window feeds Pearson Edexcel (October|January) .+, which would no longer fit: .+ — change the window's series on its board series panel first$/);
    });
  });

  describe('each registration is entered in its window\'s series of its board', () => {
    let a: Family;
    it('Mathematics goes to October, Biology to January; a subject of a board the window feeds no series of is refused and not offered', async () => {
      a = await family('route');
      const regs = await direct(a, [subj.MA3!, subj.BI4!]);
      const bySubject = Object.fromEntries(regs.map((r) => [r.subjectId, r.id]));
      expect(await seriesOfRegistration(bySubject[subj.MA3!]!)).toBe(oct);
      expect(await seriesOfRegistration(bySubject[subj.BI4!]!)).toBe(jan);

      const available = (await apiResponse(a.parent.api.v1.registrations.available.$get({ query: { sessionId: windowId, studentId: a.studentId } })))
        .filter((s) => s.code.startsWith('BS-'));
      // Not the two already registered, not Geography (no Cambridge series here).
      expect(available.map((s) => s.code).sort()).toEqual(['BS-BI5', 'BS-MA4']);
      expect(available.find((s) => s.code === 'BS-BI5')!.boardSeries).toMatchObject({ id: jan, name: `Pearson Edexcel January ${Y + 1} (series)` });
      expect(await refused(a.parent.api.v1.registrations.direct.$post({ json: { sessionId: windowId, subjectIds: [subj.GEO!], studentId: a.studentId } }))).toEqual({
        status: 400,
        error: 'Geography (series) is entered with Cambridge International, and this window feeds no Cambridge International series — ask the admin to add one to the window',
      });
      // The database routes a registration no path named a series for, and refuses another board's series.
      await expect(sql(
        `insert into registration (id, student_id, session_id, subject_id, price_at_registration, status, requested_by, board_series_id)
         values (gen_random_uuid()::text, $1, $2, $3, 0, 'pending_payment', $1, $4)`,
        [a.studentId, windowId, subj.GEO!, oct],
      )).rejects.toThrow();
    });

    it('the admin moves a registration to the other series of its board, with a reason; history stays', async () => {
      const [ma3] = await sql<{ id: string }>(`select id from registration where student_id = $1 and subject_id = $2`, [a.studentId, subj.MA3!]);
      const moved = await apiResponse(adm.api.v1.sessions[':id']['board-series'].move.$post({
        param: { id: windowId }, json: { registrationIds: [ma3!.id], boardSeriesId: jan, reason: 'sits P3 in January instead' },
      }));
      expect(moved).toMatchObject({ moved: 1, alreadyThere: 0, boardSeriesId: jan });
      expect(await seriesOfRegistration(ma3!.id)).toBe(jan);
      await audited([ma3!.id], ['REGISTRATION_SERIES_MOVED']);
      // …and back, so the deadlines below read as designed.
      await apiResponse(adm.api.v1.sessions[':id']['board-series'].move.$post({
        param: { id: windowId }, json: { registrationIds: [ma3!.id], boardSeriesId: oct, reason: 'back to October after all' },
      }));
      // A series with registrations cannot leave the window.
      expect(await refused(setWindow({ series: [{ boardSeriesId: jan, isDefault: true }], routes: [] }))).toEqual({
        status: 409, error: `Pearson Edexcel October ${Y} (series) has 1 registration in this window — move them to another series first; its entries stay on record`,
      });
    });

    it("the coordinator's answer moves a subject to another board: its live registrations follow to that board's series, or nothing changes", async () => {
      const che = await subject(adm, 'BS-CHE', 'Chemistry (series)', { course: 1000, registration: 400 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
      const z = await family('board');
      const reg = (await direct(z, [che]))[0]!.id;
      expect(await seriesOfRegistration(reg)).toBe(oct);
      const oxfordAward = await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
        json: { boardCode: 'oxford', code: '9621', title: 'Chemistry (AS)', level: 'as_level', suite: 'OxfordAQA International AS', subjectArea: 'Chemistry', entryMethod: 'qualification' },
      }));
      const toOxford = () => coordinator.api.v1.catalogue.registrable[':subjectId'].$put({
        param: { subjectId: che }, json: { boardCode: 'oxford', qualificationId: oxfordAward.id, unitIds: [], reason: 'coordinator: Chemistry is OxfordAQA' },
      });
      // The window feeds no OxfordAQA series yet: refused, nothing moved.
      expect(await refused(toOxford())).toEqual({
        status: 409, error: 'January (AS, series) has 1 registration for Chemistry (series) and feeds no OxfordAQA series — add one to the window first',
      });
      expect((await one<{ council: string }>(`select council from subject where id = $1`, [che])).council).toBe('pearson_edexcel');
      expect(await seriesOfRegistration(reg)).toBe(oct);
      // With OxfordAQA's January series on the window, the registration follows the subject.
      const oxJan = (await apiResponse(coordinator.api.v1['board-series'].$post({ json: { boardCode: 'oxford', month: 'january', year: Y + 1, label: 'series' } }))).id;
      await apiResponse(setWindow({
        series: [{ boardSeriesId: oct, isDefault: true }, { boardSeriesId: jan, isDefault: false }, { boardSeriesId: oxJan, isDefault: true }],
        routes: [{ subjectId: subj.BI4!, boardSeriesId: jan }, { subjectId: subj.BI5!, boardSeriesId: jan }],
      }));
      expect(await apiResponse(toOxford())).toMatchObject({ boardCode: 'oxford', registrationsMoved: 1 });
      expect(await seriesOfRegistration(reg)).toBe(oxJan);
      await audited([reg], ['REGISTRATION_SERIES_MOVED']);
      expect((await one<{ council: string }>(`select council from subject where id = $1`, [che])).council).toBe('oxford');
    });
  });

  describe('a window feeding two board series with different deadlines, each enforced (MO-10 per series)', () => {
    let b: Family, d: Family, e: Family, f: Family, x: Family;
    let bPay: string, dPay: string, ePay: string, fPay: string, bReg: string, dReg: string, eReg: string, fReg: string;
    let octDeadline: Date, janDeadline: Date;

    it('only the admin sets an entry deadline, after the window closes and in the future; the late-fee dates are information', async () => {
      // Families with money in flight in each series before the close.
      b = await family('b'); d = await family('d'); e = await family('e'); f = await family('f'); x = await family('x');
      // B pays for Mathematics (October) by InstaPay, with 200 from escrow, and sends the reference.
      const fundB = await apiResponse(officer.api.v1.registrations.desk.$post({
        json: { studentId: b.studentId, sessionId: windowId, subjectIds: [subj.MA4!], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
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

      // The window will close in a minute; the board calendars come in.
      await sql(`update registration_session set end_date = now() + interval '1 minute' where id = $1`, [windowId]);
      const now = Date.now();
      octDeadline = new Date(now + 2 * 60 * 60 * 1000);
      janDeadline = new Date(now + 3 * 24 * 60 * 60 * 1000);
      const setDeadline = (by: Client, id: string, entryDeadline: Date, reason = 'board key dates published') =>
        by.api.v1['board-series'][':id'].$put({ param: { id }, json: { entryDeadline, reason } });
      expect(await refused(setDeadline(coordinator, oct, octDeadline))).toEqual({
        status: 403, error: "Only an admin sets the exam board's entry deadline: past it the school closes every unconfirmed payment on the series (MO-10)",
      });
      expect(await refused(setDeadline(adm, oct, new Date(now - 60 * 1000)))).toEqual({ status: 400, error: "The board's entry deadline must be after the registration window closes" });
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
      // The window cannot now close on or after the earlier deadline (MO-10).
      const moved = await refused(adm.api.v1.sessions[':id'].$put({
        param: { id: windowId },
        // @ts-expect-error — the route reads its body by session status, without zValidator (as the web does)
        json: { endDate: new Date(octDeadline.getTime() + 60 * 1000), reason: 'extend past the October deadline' },
      }));
      expect(moved.status).toBe(400);
      expect(moved.error).toMatch(/^The window cannot close on or after the exam board's entry deadline \(.+\) — move the board deadline first$/);
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
      const lateOct = await refused(x.parent.api.v1.registrations.direct.$post({ json: { sessionId: windowId, subjectIds: [subj.MA4!], studentId: x.studentId } }));
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
      expect(notEntered.body).toMatch(new RegExp(`^The exam board's entry deadline for Pearson Edexcel January ${Y + 1} \\(series\\) \\(.+\\) has passed, so these subjects registered in January \\(AS, series\\) were not entered: Biology Unit 5 \\(series\\)\\.$`));
      // An entry in a series past its deadline cannot be moved.
      expect(await refused(adm.api.v1.sessions[':id']['board-series'].move.$post({
        param: { id: windowId }, json: { registrationIds: [dReg], boardSeriesId: oct, reason: 'too late to move' },
      }))).toMatchObject({ status: 400 });
    });
  });
});
