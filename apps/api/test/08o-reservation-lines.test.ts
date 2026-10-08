import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf, PRICE_POLICY_KEYS } from '@repo/validations';
import { admin, staff, onboard, subject, refused, one, sql, audited, money, notified, runPaymentDeadlines, CONSENT, type Client } from './helpers';

/**
 * The reservations rework, step B (RESERVATIONS_REWORK.md §3.5, §4.3–§4.5, §8;
 * docs/features/RESERVATIONS_LINES.md): reservation lines, consent, declared sittings and their
 * verification, the teacher on a line, the desk's and the family's flows, the statement.
 *
 * Every request goes through the typed client, as the Reserve pages make it: `lines` (one per
 * item, the form's entry choice as attempt and mode, the teacher, the sitting a retake follows)
 * and `consent` (the refund policy and the declaration). Outcomes are read back from the
 * database and the ledger.
 */

void PRICE_POLICY_KEYS;
const days = (n: number) => n * 86_400_000;
const RUN = Math.random().toString(36).slice(2, 6);
const Y = academicYearStartOf();
const cairoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
const at = (n: number) => new Date(Date.now() + days(n));

type Month = 'january' | 'june' | 'october' | 'november';
type Line = {
  offerItemId: string; attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study'; teacherId?: string | null;
  priorSittingSeriesId?: string | null; priorSitting?: { month: Month; year: number }; expectedPrice?: number;
};
const first = (offerItemId: string, extra: Partial<Line> = {}): Line => ({ offerItemId, attempt: 'first', mode: 'in_school', ...extra });
const retake = (offerItemId: string, extra: Partial<Line> = {}): Line => ({ offerItemId, attempt: 'retake', mode: 'in_school', ...extra });

const lineOf = (id: string) => one<{
  status: string; attempt: string; mode: string; teacher_id: string | null; prior_sitting_series_id: string | null; prior_sitting_source: string | null;
  outcome: string | null; declaration_rejected: boolean; price: string; course: string; board: string; taken_outside_school: boolean;
  snapshot: { kind: string; steps?: unknown } | null; prior_centre: string | null; prior_candidate_number: string | null;
}>(`select status, attempt, mode, teacher_id, prior_sitting_series_id, prior_sitting_source, prior_sitting_verified_outcome as outcome, declaration_rejected,
      price_at_registration as price, course_fee_at_registration as course, registration_fee_at_registration as board, taken_outside_school,
      refund_policy_snapshot as snapshot, prior_centre, prior_candidate_number
    from registration where id = $1`, [id]);
const consentsOf = (id: string) => sql<{ kind: string; channel: string; confirmed_by: string | null; text_version: string }>(
  `select kind, channel, confirmed_by, text_version from registration_consent where registration_id = $1 order by kind, channel`, [id]);
const expiryOf = async (id: string) => (await one<{ d: Record<string, unknown> }>(`select new_data as d from audit_log where entity_id = $1 and action = 'REGISTRATION_EXPIRED'`, [id])).d;
const escrowOf = async (studentId: string) => {
  const [e] = await sql<{ balance: string; held: string }>(`select balance, held_balance as held from escrow where student_id = $1`, [studentId]);
  return { free: money(e?.balance ?? 0), held: money(e?.held ?? 0) };
};

describe('08o: reservation lines (step B)', () => {
  let adm: Client, officer: Client, finadmin: Client, coordinator: Client;
  let teacherA: string, teacherB: string;
  let june: string, lateS: string, holdS: string, winterS: string;
  let camJ: string, peaJ: string, peaP: string, camL: string, camH: string, camN: string;
  let bio: string, mat: string, prv: string, core: string, cf: string;
  let bioItem: string, matItem: string, prvItem: string, coreItem: string, cfItem: string;
  let bioLate: string, bioHold: string, bioWinter: string;
  let prvFee: string;

  const mkSeries = async (boardCode: 'cambridge' | 'pearson_edexcel', month: Month, year: number, label: string, dates: { entryDeadline?: Date; retakeDeadline?: Date } = {}) =>
    (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode, month, year, label, ...dates } })))!.id;
  const fee = (seriesId: string, keyId: string, amount: number, provisional = false) =>
    apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId }, json: { rows: [{ keyKind: 'subject', keyId, amount, provisional }] } }));
  const mkSession = async (type: 'june' | 'winter', year: number, label: string) => (await apiResponse(adm.api.v1.sessions.$post({
    json: {
      type, year, label, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: at(60).toISOString(),
      courseStartsOn: cairoDate(new Date()), paymentDueAt: at(30).toISOString(),
    },
  })))!.id;
  const offerOne = async (sessionId: string, subjectId: string, courseFee: number, seriesId: string, teachers: string[], extra: { grade10Core?: boolean; item?: Record<string, unknown> } = {}) =>
    (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: sessionId },
      json: {
        subjectId, courseFee, grade10Core: extra.grade10Core ?? false, teachers: teachers.map((teacherId) => ({ teacherId, mode: 'in_school' as const })),
        items: [{ label: 'Whole subject', kind: 'whole' as const, enters: { kind: 'subject' as const }, boardSeriesId: seriesId, availability: 'open' as const, requiredInSeries: false, ...extra.item }],
      },
    })))!.items[0]!;
  const halfBack = (sessionId: string) => apiResponse(finadmin.api.v1.receipts['refund-windows'].$post({
    json: { sessionId, startsAt: new Date(Date.now() - days(1)).toISOString(), endsAt: at(90).toISOString(), percentage: 50, label: 'step B: half back' },
  }));
  const verify = (who: Client, id: string, json: Parameters<Client['api']['v1']['registrations'][':id']['verify-prior']['$post']>[0]['json']) =>
    who.api.v1.registrations[':id']['verify-prior'].$post({ param: { id }, json });
  const toVerify = async (sessionId: string, show: 'awaiting' | 'decided' = 'awaiting') =>
    (await apiResponse(coordinator.api.v1.sessions[':id']['to-verify'].$get({ param: { id: sessionId }, query: { show } }))).lines;
  const deskCollect = (studentId: string, sessionId: string, lines: Line[]) =>
    officer.api.v1.registrations.desk.$post({ json: { studentId, sessionId, lines, consent: CONSENT, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } } });

  beforeAll(async () => {
    adm = await admin('o08');
    officer = await staff(adm, 'finance_officer', 'o08');
    finadmin = await staff(adm, 'finance_admin', 'o08');
    coordinator = await staff(adm, 'coordinator', 'o08');
    teacherA = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher A (08o ${RUN})` } })))!.id;
    teacherB = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher B (08o ${RUN})` } })))!.id;
    // The academic year the June session's lines are taught in (the enrolment follows a line's teacher).
    const years = await apiResponse(coordinator.api.v1.academic.years.$get());
    if (!years.some((y) => y.startYear === Y)) {
      await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }));
    }

    bio = await subject(adm, `RWO-BIO-${RUN}`, `Biology (08o ${RUN})`, { course: 14000, registration: 9200 });
    mat = await subject(adm, `RWO-MAT-${RUN}`, `Mathematics (08o ${RUN})`, { course: 10000, registration: 4600 }, { council: 'pearson_edexcel' });
    prv = await subject(adm, `RWO-PRV-${RUN}`, `Statistics (08o ${RUN})`, { course: 1000, registration: 9000 }, { council: 'pearson_edexcel' });
    core = await subject(adm, `RWO-COR-${RUN}`, `Core (08o ${RUN})`, { course: 5000, registration: 3000 });
    cf = await subject(adm, `RWO-CF-${RUN}`, `Physics A Level (08o ${RUN})`, { course: 16000, registration: 8000 }, { qualificationLevel: 'a_level' });

    // June: Cambridge (entry deadline in 50 days, retakes of the previous sitting in 55), Pearson (40), and a Pearson series whose fee is not published.
    camJ = await mkSeries('cambridge', 'june', Y + 1, `o08-${RUN}`, { entryDeadline: at(50), retakeDeadline: at(55) });
    peaJ = await mkSeries('pearson_edexcel', 'june', Y + 1, `o08-${RUN}`, { entryDeadline: at(40) });
    peaP = await mkSeries('pearson_edexcel', 'june', Y + 1, `o08p-${RUN}`, { entryDeadline: at(42) });
    await fee(camJ, bio, 9200);
    await fee(camJ, core, 3000);
    await fee(camJ, cf, 8000);
    await fee(peaJ, mat, 4600);
    await fee(peaP, prv, 9000, true);
    prvFee = (await one<{ id: string }>(`select id from board_fee where board_series_id = $1 and key_id = $2`, [peaP, prv])).id;
    june = await mkSession('june', Y + 1, `o08-${RUN}`);
    bioItem = await offerOne(june, bio, 14000, camJ, [teacherA, teacherB], { item: { exclusiveGroup: 'entry' } });
    matItem = await offerOne(june, mat, 10000, peaJ, [teacherA]);
    prvItem = await offerOne(june, prv, 1000, peaP, [teacherA]);
    coreItem = await offerOne(june, core, 5000, camJ, [teacherA], { grade10Core: true });
    cfItem = await offerOne(june, cf, 16000, camJ, [teacherA], { item: { label: 'A.2., carry forward', kind: 'route', needsPriorSeries: true } });
    await halfBack(june);

    // Sessions whose deadlines the scenarios move: a rejection after the first-entry deadline, and hold.
    camL = await mkSeries('cambridge', 'june', Y + 1, `o08l-${RUN}`, { entryDeadline: at(30), retakeDeadline: at(35) });
    await fee(camL, bio, 9200);
    lateS = await mkSession('june', Y + 1, `o08l-${RUN}`);
    bioLate = await offerOne(lateS, bio, 14000, camL, [teacherA]);
    await halfBack(lateS);
    camH = await mkSeries('cambridge', 'june', Y + 1, `o08h-${RUN}`, { entryDeadline: at(30), retakeDeadline: at(35) });
    await fee(camH, bio, 9200);
    holdS = await mkSession('june', Y + 1, `o08h-${RUN}`);
    bioHold = await offerOne(holdS, bio, 14000, camH, [teacherA]);
    await halfBack(holdS);
    // The winter session before June: a sitting there becomes a known one.
    camN = await mkSeries('cambridge', 'november', Y, `o08w-${RUN}`, { entryDeadline: at(20) });
    await fee(camN, bio, 9000);
    winterS = await mkSession('winter', Y, `o08w-${RUN}`);
    bioWinter = await offerOne(winterS, bio, 12000, camN, [teacherA]);
  });

  afterAll(async () => {
    await sql(`delete from school_setting where key = 'verification.unverifiedAtDeadline'`);
  });

  // ─── The family's own reservation (§4.4) ──────────────────────────────────

  it('a family reserves in the app: one line per item with the entry chosen, both consents required and recorded, the refund steps frozen', async () => {
    const f = await onboard(officer, `o08-app-${RUN}`, 11);
    const lines = [first(bioItem, { teacherId: teacherB }), first(matItem)];
    // No consent, or the declaration not ticked: refused, nothing made.
    expect((await refused(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines } as never }))).status).toBe(400);
    const noDecl = await refused(f.parent.api.v1.registrations.direct.$post({
      json: { sessionId: june, studentId: f.studentId, lines, consent: { refundPolicy: true, declaration: false } } as never,
    }));
    expect(noDecl).toEqual({ status: 400, error: expect.stringContaining('the information given is true, complete and accurate') });
    expect(await sql(`select 1 from registration where student_id = $1`, [f.studentId])).toEqual([]);

    const made = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines, consent: CONSENT } }));
    expect(made).toHaveLength(2);
    const b = made.find((r) => r.offerItemId === bioItem)!;
    const m = made.find((r) => r.offerItemId === matItem)!;
    expect(await lineOf(b.id)).toMatchObject({ status: 'pending_payment', attempt: 'first', mode: 'in_school', teacher_id: teacherB, price: '23200.00' });
    // The offer's only teacher, when the page named none.
    expect((await lineOf(m.id)).teacher_id).toBe(teacherA);
    // Both consents, on the app channel, given by the parent, with the texts' versions.
    for (const id of [b.id, m.id]) {
      expect(await consentsOf(id)).toEqual([
        { kind: 'declaration', channel: 'app', confirmed_by: f.parent.id, text_version: 'declaration-v1' },
        { kind: 'refund_policy', channel: 'app', confirmed_by: f.parent.id, text_version: 'refund-policy-v1' },
      ]);
    }
    // The refund steps the family read, frozen on the line (the session's June policy, in weeks).
    const policy = (await one<{ p: unknown }>(`select refund_policy as p from registration_session where id = $1`, [june])).p;
    expect((await lineOf(b.id)).snapshot).toEqual({ kind: 'weeks', steps: (policy as { steps: unknown }).steps });
    // The same item again: refused under the student lock, with a sentence.
    expect(await refused(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines: [first(bioItem)], consent: CONSENT } })))
      .toEqual({ status: 409, error: `Already reserved for this student in this session: Biology (08o ${RUN})` });
    // "No preference" where the offer has several teachers.
    const g = await onboard(officer, `o08-nopref-${RUN}`, 11);
    const [np] = await apiResponse(g.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: g.studentId, lines: [first(bioItem, { teacherId: null })], consent: CONSENT } }));
    expect((await lineOf(np!.id)).teacher_id).toBeNull();
  });

  it('the price the page showed is the price charged: a line priced otherwise in between is refused, nothing made', async () => {
    const f = await onboard(officer, `o08-price-${RUN}`, 11);
    const read = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: june, studentId: f.studentId } }));
    const shown = read.offers.find((o) => o.subject.id === bio)!.items[0]!.prices.find((p) => p.attempt === 'first' && p.mode === 'in_school')!.total!;
    expect(shown).toBe(23200);
    expect(await refused(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines: [first(bioItem, { expectedPrice: shown - 1 })], consent: CONSENT } })))
      .toEqual({ status: 409, error: expect.stringContaining('changed while this was open') });
    expect(await sql(`select 1 from registration where student_id = $1`, [f.studentId])).toEqual([]);
    expect(await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines: [first(bioItem, { expectedPrice: shown })], consent: CONSENT } })))
      .toHaveLength(1);
  });

  // ─── Declared sittings (§3.5) ─────────────────────────────────────────────

  it('a family declares a retake with its sitting: created when not on record, priced as a retake, listed to verify; a first entry names none', async () => {
    const f = await onboard(officer, `o08-decl-${RUN}`, 11);
    const [line] = await apiResponse(f.parent.api.v1.registrations.direct.$post({
      json: { sessionId: june, studentId: f.studentId, lines: [retake(bioItem, { mode: 'self_study', priorSitting: { month: 'november', year: Y - 1 } })], consent: CONSENT },
    }));
    const r = await lineOf(line!.id);
    expect(r).toMatchObject({ attempt: 'retake', mode: 'self_study', teacher_id: null, prior_sitting_source: 'declared_by_family', course: '7000.00', board: '9200.00', price: '16200.00' });
    // The sitting named, on record now with no dates: Cambridge's November of the year before.
    expect(await one(`select board_code, month, year, label, entry_deadline from board_series where id = $1`, [r.prior_sitting_series_id]))
      .toEqual({ board_code: 'cambridge', month: 'november', year: Y - 1, label: '', entry_deadline: null });
    // On the session's To verify tab, for the coordinator: declared by the family, not paid.
    const listed = (await toVerify(june)).find((l) => l.id === line!.id)!;
    expect(listed).toMatchObject({ paid: false, declaredBy: { channel: 'family' }, sitting: { name: `Cambridge International November ${Y - 1}` }, line: { subject: `Biology (08o ${RUN})` } });
    // A first entry follows no earlier sitting; a sitting of another board is refused.
    const g = await onboard(officer, `o08-decl-g-${RUN}`, 11);
    expect(await refused(g.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: g.studentId, lines: [first(bioItem, { priorSitting: { month: 'june', year: Y } })], consent: CONSENT } })))
      .toEqual({ status: 400, error: `A first entry of Biology (08o ${RUN}) follows no earlier sitting: choose "retake" to name one` });
    expect(await refused(g.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: g.studentId, lines: [retake(bioItem, { priorSittingSeriesId: peaJ })], consent: CONSENT } })))
      .toMatchObject({ status: 400, error: expect.stringContaining("the sitting named is another board's") });
    // A retake with no sitting named and none known: the rule refuses it.
    expect(await refused(g.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: g.studentId, lines: [retake(bioItem)], consent: CONSENT } })))
      .toEqual({ status: 400, error: `A retake of Biology (08o ${RUN}) names the sitting it follows` });
    // A student's own request declares it the same way; their consent is theirs.
    const [asked] = await apiResponse(g.student.api.v1.registrations.request.$post({
      json: { sessionId: june, lines: [retake(matItem, { mode: 'self_study', priorSitting: { month: 'january', year: Y } })], consent: CONSENT },
    }));
    expect(await lineOf(asked!.id)).toMatchObject({ status: 'pending_approval', prior_sitting_source: 'declared_by_family', mode: 'self_study' });
    expect((await consentsOf(asked!.id)).map((c) => c.confirmed_by)).toEqual([g.student.id, g.student.id]);
  });

  it('a sitting the system knows is filled in and not listed to verify; its retake runs to the retake deadline', async () => {
    const f = await onboard(officer, `o08-known-${RUN}`, 11);
    // Sat in the winter session (paid at the desk).
    await apiResponse(deskCollect(f.studentId, winterS, [first(bioWinter)]));
    // In June, a retake in school with no sitting named: the known one, November's.
    const [line] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines: [retake(bioItem, { teacherId: teacherA })], consent: CONSENT } }));
    expect(await lineOf(line!.id)).toMatchObject({ prior_sitting_series_id: camN, prior_sitting_source: 'known', price: '23200.00' });
    expect((await toVerify(june)).some((l) => l.id === line!.id)).toBe(false);
    // November is Cambridge's latest sitting before June: the line runs to June's retake deadline.
    // (The suite's sql helper binds placeholders in the order they appear.)
    const d = await one<{ d: string; retake: string }>(`select line_effective_deadline(attempt, prior_sitting_series_id, board_series_id) as d, (select retake_deadline from board_series where id = $1) as retake from registration where id = $2`, [camJ, line!.id]);
    expect(new Date(d.d).getTime()).toBe(new Date(d.retake).getTime());
  });

  it('the coordinator verifies: the line stands; a carry-forward from another centre records the previous centre and candidate number; answered once', async () => {
    const f = await onboard(officer, `o08-cf-${RUN}`, 12);
    // The desk names the AS sitting the A2 carries forward: declared by the desk, consent on the desk channel.
    const desk = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId: june, lines: [first(cfItem, { priorSitting: { month: 'june', year: Y } })], consent: CONSENT },
    }));
    const id = desk.registrations[0]!.id;
    expect(await lineOf(id)).toMatchObject({ prior_sitting_source: 'declared_by_desk', status: 'pending_payment' });
    expect((await consentsOf(id)).map((c) => [c.channel, c.confirmed_by])).toEqual([['desk', officer.id], ['desk', officer.id]]);
    expect((await toVerify(june)).find((l) => l.id === id)).toMatchObject({ declaredBy: { channel: 'desk' } });

    // Who may answer: not a family; the finance desk with the board's statement in hand.
    expect((await refused(verify(f.parent, id, { outcome: 'verified', reason: 'parent tries to verify' }))).status).toBe(403);
    expect(await refused(verify(officer, id, { outcome: 'verified', reason: 'saw something' })))
      .toEqual({ status: 400, error: "The finance desk verifies a sitting with the board's statement in hand: say what was seen" });
    expect((await lineOf(id)).outcome).toBeNull();
    const ok = await apiResponse(verify(coordinator, id, { outcome: 'verified', reason: 'the board statement of results, June', prevCentre: 'EG-CENTRE-1', prevCandidateNumber: '0042' }));
    expect(ok).toMatchObject({ outcome: 'verified', registrationId: id });
    expect(await lineOf(id)).toMatchObject({ outcome: 'verified', status: 'pending_payment', prior_centre: 'EG-CENTRE-1', prior_candidate_number: '0042' });
    // Audited in its transaction; the centre and number are recorded, never listed in the row.
    const row = await one<{ n: Record<string, unknown> }>(`select new_data as n from audit_log where entity_id = $1 and action = 'PRIOR_SITTING_VERIFIED'`, [id]);
    expect(row.n).toMatchObject({ outcome: 'verified', reason: 'the board statement of results, June', previousCentreRecorded: true });
    expect(JSON.stringify(row.n)).not.toContain('EG-CENTRE-1');
    expect(await refused(verify(coordinator, id, { outcome: 'rejected', reason: 'second answer' }))).toEqual({ status: 409, error: 'This declared sitting was already verified' });
    expect((await toVerify(june)).some((l) => l.id === id)).toBe(false);
    expect((await toVerify(june, 'decided')).find((l) => l.id === id)).toMatchObject({ outcome: 'verified', decidedBy: `coordinator o08` });
    // The finance desk, with the evidence seen, may verify too.
    const g = await onboard(officer, `o08-cf-g-${RUN}`, 12);
    const [gl] = await apiResponse(g.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: g.studentId, lines: [first(cfItem, { priorSitting: { month: 'june', year: Y } })], consent: CONSENT } }));
    expect(await apiResponse(verify(officer, gl!.id, { outcome: 'verified', reason: 'checked at the desk', evidence: 'board statement of entry, June' })))
      .toMatchObject({ outcome: 'verified' });
  });

  it('rejected on an unpaid line: refused while a checkout is open; then it expires (declaration_rejected), the family is told, and may reserve a first entry', async () => {
    const f = await onboard(officer, `o08-rej-${RUN}`, 11);
    const [line] = await apiResponse(f.parent.api.v1.registrations.direct.$post({
      json: { sessionId: june, studentId: f.studentId, lines: [retake(bioItem, { mode: 'self_study', priorSitting: { month: 'june', year: Y } })], consent: CONSENT },
    }));
    const pay = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    expect(await refused(verify(coordinator, line!.id, { outcome: 'rejected', reason: 'no such sitting on the board record' })))
      .toEqual({ status: 409, error: 'A payment for this line is in progress: confirm or reject it in the Finance Workbench first' });
    expect(await lineOf(line!.id)).toMatchObject({ status: 'pending_payment', outcome: null });
    await apiResponse(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: pay.id! } }));

    expect(await apiResponse(verify(coordinator, line!.id, { outcome: 'rejected', reason: 'no such sitting on the board record' })))
      .toMatchObject({ outcome: 'rejected', effect: 'expired' });
    expect(await lineOf(line!.id)).toMatchObject({ status: 'expired', outcome: 'rejected', declaration_rejected: false });
    expect(await expiryOf(line!.id)).toEqual({ status: 'expired', reason: 'declaration_rejected' });
    await audited([line!.id], ['REGISTRATION_EXPIRED', 'PRIOR_SITTING_REJECTED']);
    const [toStudent] = await notified(f.student.email, 'DECLARATION_REVIEWED', 1);
    expect(toStudent!.body).toContain('You may reserve it again as a first entry');
    await notified(f.parent.email, 'DECLARATION_REVIEWED', 1);
    // A first entry in school, now.
    expect(await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines: [first(bioItem, { teacherId: teacherA })], consent: CONSENT } })))
      .toHaveLength(1);
  });

  it('rejected on a paid line before the first-entry deadline: the line stands as paid with declaration_rejected (a first entry for F4), the family is told', async () => {
    const f = await onboard(officer, `o08-rejp-${RUN}`, 11);
    const desk = await apiResponse(deskCollect(f.studentId, june, [retake(bioItem, { mode: 'self_study', priorSitting: { month: 'november', year: Y - 1 } })]));
    const id = desk.registrations[0]!.id;
    expect(await lineOf(id)).toMatchObject({ status: 'confirmed', prior_sitting_source: 'declared_by_desk' });
    expect(await apiResponse(verify(coordinator, id, { outcome: 'rejected', reason: 'the board has no result for this candidate' })))
      .toMatchObject({ outcome: 'rejected', effect: 'stands' });
    expect(await lineOf(id)).toMatchObject({ status: 'confirmed', outcome: 'rejected', declaration_rejected: true, price: '16200.00', mode: 'self_study' });
    const [n] = await notified(f.parent.email, 'DECLARATION_REVIEWED', 1);
    expect(n!.body).toContain('entered with the board as a first entry');
  });

  it("rejected on a paid line after the first-entry deadline: dropped through the receipt-gated drop with today's refund", async () => {
    const f = await onboard(officer, `o08-rejl-${RUN}`, 11);
    // A retake of November (Cambridge's latest sitting before June) runs to the retake deadline.
    const desk = await apiResponse(deskCollect(f.studentId, lateS, [retake(bioLate, { mode: 'self_study', priorSitting: { month: 'november', year: Y } })]));
    const id = desk.registrations[0]!.id;
    const rc = desk.receipts.find((r) => r.registrationId === id)!;
    await apiResponse(officer.api.v1.receipts[':id'].issue.$post({ param: { id: rc.id } }));
    // The first-entry deadline passes; the line is still live to its retake deadline.
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [camL]);
    const before = await escrowOf(f.studentId);
    const r = await apiResponse(verify(coordinator, id, { outcome: 'rejected', reason: 'the sitting was another candidate' }));
    // The paper is out: the refund (the session's window, 50% of 16,200) waits for it to come back.
    expect(r).toMatchObject({ outcome: 'rejected', effect: 'dropped', gated: true, refundAmount: 8100, refundPercentage: 50 });
    expect(await lineOf(id)).toMatchObject({ status: 'dropped_pending_receipt', outcome: 'rejected', declaration_rejected: false });
    expect(await one(`select status, refund_amount_on_return as amount from receipt where id = $1`, [rc.id])).toEqual({ status: 'return_required', amount: '8100.00' });
    // Its own deadline (the retake deadline) has not passed: the board fee is not sent yet, which
    // C's refundFor reads (today's computation takes the window's percentage of the whole price).
    expect(await one(`select new_data->>'boardSent' as sent from audit_log where action = 'PRIOR_SITTING_REJECTED' and entity_id = $1`, [id])).toEqual({ sent: 'false' });
    expect(await escrowOf(f.studentId)).toEqual(before);
    await apiResponse(officer.api.v1.receipts[':id'].return.$post({ param: { id: rc.id }, json: {} }));
    expect(await lineOf(id)).toMatchObject({ status: 'dropped' });
    expect(await escrowOf(f.studentId)).toEqual({ free: money(before.free + 8100), held: before.held });
    const [n] = await notified(f.parent.email, 'DECLARATION_REVIEWED', 1);
    expect(n!.body).toContain("the board's first-entry deadline has passed");
  });

  it('unverified at the deadline: entered as declared by default; under hold the sweep expires a waiting line and drops a paid one, once', async () => {
    const paidDefault = await onboard(officer, `o08-hold-d-${RUN}`, 11);
    const paid = await onboard(officer, `o08-hold-p-${RUN}`, 11);
    const waiting = await onboard(officer, `o08-hold-w-${RUN}`, 11);
    const plain = await onboard(officer, `o08-hold-f-${RUN}`, 11);
    const declared = retake(bioHold, { mode: 'self_study', priorSitting: { month: 'november', year: Y } });
    const pd = (await apiResponse(deskCollect(paidDefault.studentId, holdS, [declared]))).registrations[0]!.id;

    // enter_as_declared (the default): the deadline passes and nothing happens to the paid line.
    await sql(`update board_series set entry_deadline = now() - interval '2 minutes', retake_deadline = now() - interval '1 minute' where id = $1`, [camH]);
    await runPaymentDeadlines();
    expect((await lineOf(pd)).status).toBe('confirmed');
    // Hold turned on now does not reach a deadline that passed before it: that line was entered as declared.
    await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'verification.unverifiedAtDeadline' }, json: { value: 'hold', reason: 'the school holds unverified sittings (Q-22)' } }));
    expect(await runPaymentDeadlines()).toMatchObject({ unverifiedExpired: 0, unverifiedDropped: 0 });
    expect((await lineOf(pd)).status).toBe('confirmed');

    // New lines, their deadlines passing while hold is on (the line entered as declared answered
    // first, so that moving its series' dates back for this scenario does not reach it).
    await apiResponse(verify(coordinator, pd, { outcome: 'verified', reason: 'the board statement, seen late' }));
    await sql(`update board_series set entry_deadline = now() + interval '30 days', retake_deadline = now() + interval '35 days' where id = $1`, [camH]);
    const p = (await apiResponse(deskCollect(paid.studentId, holdS, [declared]))).registrations[0]!.id;
    const [w] = await apiResponse(waiting.parent.api.v1.registrations.direct.$post({ json: { sessionId: holdS, studentId: waiting.studentId, lines: [declared], consent: CONSENT } }));
    const [pl] = await apiResponse(plain.parent.api.v1.registrations.direct.$post({ json: { sessionId: holdS, studentId: plain.studentId, lines: [first(bioHold)], consent: CONSENT } }));
    const before = await escrowOf(paid.studentId);
    // Hold has been on since before these deadlines passed (45 seconds ago; the retake deadline, 30).
    await sql(`update board_series set entry_deadline = now() - interval '2 minutes', retake_deadline = now() - interval '30 seconds' where id = $1`, [camH]);
    await sql(`update school_setting set updated_at = now() - interval '45 seconds' where key = 'verification.unverifiedAtDeadline'`);
    const run = await runPaymentDeadlines();
    expect(run).toMatchObject({ unverifiedExpired: 1, unverifiedDropped: 1 });
    // The waiting declared line: hold_unverified; the paid one: dropped (the receipt never left the desk), half back.
    expect(await lineOf(w!.id)).toMatchObject({ status: 'expired', outcome: null });
    expect(await expiryOf(w!.id)).toEqual({ status: 'expired', reason: 'hold_unverified' });
    expect(await lineOf(p)).toMatchObject({ status: 'dropped' });
    expect(await escrowOf(paid.studentId)).toEqual({ free: money(before.free + 8100), held: before.held });
    expect((await one<{ n: Record<string, unknown> }>(`select new_data as n from audit_log where entity_id = $1 and action = 'LINE_DROPPED_UNVERIFIED'`, [p])).n)
      .toMatchObject({ status: 'dropped', refundAmount: 8100, refundPercentage: 50, gated: false, setting: 'hold' });
    // A first entry waiting at the deadline: the deadline's own expiry, as always.
    expect(await expiryOf(pl!.id)).toEqual({ status: 'expired', reason: 'entry_deadline' });
    await notified(paid.parent.email, 'DECLARATION_REVIEWED', 1);
    await notified(waiting.parent.email, 'DECLARATION_REVIEWED', 1);
    // Once: the next tick finds nothing (and the line entered as declared earlier is untouched).
    expect(await runPaymentDeadlines()).toMatchObject({ unverifiedExpired: 0, unverifiedDropped: 0 });
    expect(Number((await one<{ n: string }>(`select count(*) as n from escrow_transaction t join escrow e on e.id = t.escrow_id where e.student_id = $1 and t.reason = 'drop'`, [paid.studentId])).n)).toBe(1);
    expect((await lineOf(pd)).status).toBe('confirmed');
    await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'verification.unverifiedAtDeadline' }, json: { value: 'enter_as_declared', reason: 'back to the default (08o)' } }));
  });

  // ─── Consent (§3.5, G-20) ──────────────────────────────────────────────────

  it("the school's grade-10 lines carry the school's consent; the family gives its own at checkout; a line without consent is never paid or confirmed", async () => {
    const g10 = await onboard(officer, `o08-g10-${RUN}`, 10);
    const done = await apiResponse(adm.api.v1.sessions[':id'].grade10.commit.$post({ param: { id: june }, json: { studentIds: [g10.studentId] } }));
    expect(done.lines).toBe(1);
    const [line] = await sql<{ id: string }>(`select id from registration where student_id = $1 and session_id = $2`, [g10.studentId, june]);
    expect((await consentsOf(line!.id)).map((c) => c.channel)).toEqual(['school', 'school']);
    // The family's checkout asks for its own pair first.
    expect(await refused(g10.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } })))
      .toEqual({ status: 400, error: 'The school reserved these subjects for the family: tick the refund policy and the declaration before paying' });
    const pay = await apiResponse(g10.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!.id], paymentMethod: 'in_school', escrowAmountToApply: 0, consent: CONSENT } }));
    expect((await consentsOf(line!.id)).map((c) => [c.kind, c.channel])).toEqual([['declaration', 'app'], ['declaration', 'school'], ['refund_policy', 'app'], ['refund_policy', 'school']]);
    expect((await lineOf(line!.id)).snapshot?.kind).toBe('weeks');
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id! }, json: { instrumentUsed: 'cash' } }));
    expect((await lineOf(line!.id)).status).toBe('confirmed');

    // A line whose consent rows are gone (none is ever made so): the desk refuses to collect it,
    // the confirmation refuses it, and the database refuses to confirm it.
    const f = await onboard(officer, `o08-nocon-${RUN}`, 11);
    const [l] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines: [first(matItem)], consent: CONSENT } }));
    const p2 = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [l!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    await sql(`delete from registration_consent where registration_id = $1`, [l!.id]);
    expect(await refused(officer.api.v1.payments[':id'].confirm.$post({ param: { id: p2.id! }, json: { instrumentUsed: 'cash' } })))
      .toMatchObject({ error: expect.stringContaining("without the family's consent") });
    expect((await lineOf(l!.id)).status).toBe('pending_payment');
    await apiResponse(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: p2.id! } }));
    expect(await refused(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: [l!.id], instrumentUsed: 'cash', escrowAmountToApply: 0 } })))
      .toMatchObject({ error: expect.stringContaining("without the family's consent") });
    await expect(sql(`update registration set status = 'confirmed' where id = $1`, [l!.id])).rejects.toThrow();
    expect((await lineOf(l!.id)).status).toBe('pending_payment');
  });

  it("a swap's new line inherits the dropped line's consent and refund steps", async () => {
    const f = await onboard(officer, `o08-swap-${RUN}`, 11);
    const desk = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId: june, lines: [first(bioItem, { teacherId: teacherA })], consent: CONSENT, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    const old = desk.registrations[0]!.id;
    const swapped = await apiResponse(f.parent.api.v1.registrations[':id'].swap.$post({ param: { id: old }, json: { line: first(matItem), reason: 'timetable clash with Biology' } }));
    const next = swapped.newRegistrationId!;
    const strip = (rows: Awaited<ReturnType<typeof consentsOf>>) => rows.map((c) => [c.kind, c.channel, c.confirmed_by, c.text_version]);
    expect(strip(await consentsOf(next))).toEqual(strip(await consentsOf(old)));
    expect((await consentsOf(next)).map((c) => c.channel)).toEqual(['desk', 'desk']);
    expect((await lineOf(next)).snapshot).toEqual((await lineOf(old)).snapshot);
    // A student's swap request names its line too; approval makes exactly that line.
    const g = await onboard(officer, `o08-swapr-${RUN}`, 11);
    const gd = await apiResponse(deskCollect(g.studentId, june, [first(matItem)]));
    const cr = await apiResponse(g.student.api.v1.registrations[':id']['request-swap'].$post({
      param: { id: gd.registrations[0]!.id }, json: { line: first(bioItem, { teacherId: teacherB }), reason: 'prefers Biology this year' },
    }));
    const approved = await apiResponse(g.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: cr.id }, json: {} }));
    const made = (await one<{ n: Record<string, string> }>(`select new_data as n from audit_log where entity_id = $1 and action = 'CHANGE_REQUEST_APPROVED'`, [cr.id])).n;
    expect(approved).toMatchObject({ success: true, type: 'swap' });
    expect(await lineOf(made.newRegistrationId!)).toMatchObject({ teacher_id: teacherB, attempt: 'first', status: 'pending_payment' });
    expect((await consentsOf(made.newRegistrationId!)).map((c) => c.channel)).toEqual(['desk', 'desk']);
  });

  // ─── The teacher on a line (§3.5, point 10) ───────────────────────────────

  it('the teacher on a line: "no preference" assigned later; changed on a paid line the enrolment follows and the price does not; self-study is not re-priced', async () => {
    const f = await onboard(officer, `o08-teach-${RUN}`, 11);
    const [line] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines: [first(bioItem, { teacherId: null })], consent: CONSENT } }));
    const id = line!.id;
    const put = (who: Client, json: { teacherId: string | null; mode?: 'in_school' | 'self_study'; reason: string }) =>
      who.api.v1.registrations[':id'].teacher.$put({ param: { id }, json });
    expect((await refused(put(f.parent, { teacherId: teacherA, reason: 'parent asks for A' }))).status).toBe(403);
    // The coordinator assigns "no preference" to A: the enrolment is made from the line.
    expect(await apiResponse(put(coordinator, { teacherId: teacherA, reason: 'assigned to the morning group' })))
      .toMatchObject({ teacherId: teacherA, mode: 'in_school', repriced: false, enrolmentsCreated: 1 });
    const year = (await one<{ id: string }>(`select id from academic_year where start_year = $1`, [Y])).id;
    const enrolment = () => one<{ teacher_id: string | null; mode: string; source: string }>(
      `select teacher_id, mode, source from course_enrolment where student_id = $1 and subject_id = $2 and academic_year_id = $3 and ended_on is null`, [f.studentId, bio, year]);
    expect(await enrolment()).toEqual({ teacher_id: teacherA, mode: 'in_school', source: 'registrations' });
    // Paid, then moved to B by the finance desk: the enrolment follows, the price stays.
    const pay = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id! }, json: { instrumentUsed: 'cash' } }));
    const priceBefore = await lineOf(id);
    expect(await apiResponse(put(officer, { teacherId: teacherB, reason: 'the family asked at the desk' }))).toMatchObject({ teacherId: teacherB, enrolmentsUpdated: 1 });
    expect(await lineOf(id)).toMatchObject({ teacher_id: teacherB, price: priceBefore.price, course: priceBefore.course, board: priceBefore.board, status: 'confirmed' });
    expect(await enrolment()).toMatchObject({ teacher_id: teacherB, mode: 'in_school' });
    await audited([id], ['LINE_TEACHER_CHANGED', 'LINE_TEACHER_CHANGED']);
    // Back to "no preference" (two teachers); a teacher not of the offer refused; nothing to change refused.
    expect(await refused(put(coordinator, { teacherId: (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher C (08o ${RUN})` } })))!.id, reason: 'try another' })))
      .toEqual({ status: 400, error: `That teacher does not teach Biology (08o ${RUN}) this cycle: choose one of the subject's teachers on the session` });
    expect(await refused(put(coordinator, { teacherId: teacherB, reason: 'same again please' }))).toEqual({ status: 409, error: 'Nothing to change: the line already has this teacher' });
    // To self-study on a paid line: not taught, no teacher, the price unchanged (a refund is finance's own act).
    expect(await apiResponse(put(adm, { teacherId: null, mode: 'self_study', reason: 'studies alone from now' }))).toMatchObject({ mode: 'self_study', teacherId: null, repriced: false });
    expect(await lineOf(id)).toMatchObject({ mode: 'self_study', taken_outside_school: true, teacher_id: null, price: priceBefore.price });
    expect(await enrolment()).toMatchObject({ teacher_id: null, mode: 'self_study' });
    // And not back to taught: it was priced as self-study.
    expect(await refused(put(coordinator, { teacherId: teacherA, reason: 'wants lessons again' })))
      .toEqual({ status: 409, error: `Biology (08o ${RUN}) is reserved as self-study and priced so: to be taught, drop it and reserve it in school` });
    // "No preference" is for a subject with several teachers.
    const g = await onboard(officer, `o08-teach-g-${RUN}`, 11);
    const [m] = await apiResponse(g.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: g.studentId, lines: [first(matItem)], consent: CONSENT } }));
    expect(await refused(g.parent.api.v1.registrations[':id'].teacher.$put({ param: { id: m!.id }, json: { teacherId: null, reason: 'no preference please' } }))).toMatchObject({ status: 403 });
    expect(await refused(coordinator.api.v1.registrations[':id'].teacher.$put({ param: { id: m!.id }, json: { teacherId: null, reason: 'no preference please' } })))
      .toEqual({ status: 409, error: `Mathematics (08o ${RUN}) has one teacher this cycle: "no preference" is for a subject with several` });
  });

  // ─── The desk (§4.3) ───────────────────────────────────────────────────────

  it("the desk: reserve only; reserve and collect takes one payment per entry deadline, a provisional line reserved and collected once its fee is confirmed", async () => {
    const f = await onboard(officer, `o08-desk-${RUN}`, 11);
    // Reserve only: waiting for payment, the desk's consent on every line.
    const only = await apiResponse(officer.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId: june, lines: [first(coreItem)], consent: CONSENT } }));
    expect(only).toMatchObject({ collected: 0, payments: [], reservedNotCollected: [] });
    expect((await lineOf(only.registrations[0]!.id)).status).toBe('pending_payment');
    // Reserve and collect: Biology (Cambridge, 50 days) and Mathematics (Pearson, 40 days) paid, one payment each; Statistics provisional, reserved.
    const before = await sql<{ id: string }>(`select id from payment where student_id = $1`, [f.studentId]);
    const res = await apiResponse(deskCollect(f.studentId, june, [first(bioItem, { teacherId: teacherA }), first(matItem), first(prvItem)]));
    expect(res.registrations).toHaveLength(3);
    expect(res.collected).toBe(23200 + 14600);
    expect(res.payments).toHaveLength(2);
    const prvLine = res.registrations.find((r) => r.offerItemId === prvItem)!;
    expect(res.reservedNotCollected).toEqual([{ registrationId: prvLine.id, price: 10000 }]);
    expect(await lineOf(prvLine.id)).toMatchObject({ status: 'pending_payment' });
    expect((await sql(`select id from payment where student_id = $1`, [f.studentId])).length).toBe(before.length + 2);
    for (const p of res.payments) {
      const ds = await sql<{ d: string }>(`select distinct line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id) as d
        from payment_registration pr join registration r on r.id = pr.registration_id where pr.payment_id = $1`, [p.id]);
      expect(ds).toHaveLength(1);
    }
    // Not owed now while provisional: the desk's "owes now" and the family's home leave it out,
    // so neither offers to collect what the checkout would refuse.
    const deskView = await apiResponse(officer.api.v1.users[':id'].summary.$get({ param: { id: f.studentId } }));
    const onlyId = only.registrations[0]!.id;
    expect(deskView.owing).toBe(8000); // the reserve-only line, not the provisional one
    expect(deskView.registrations.find((r) => r.id === prvLine.id)).toMatchObject({ status: 'pending_payment', payableNow: false });
    const homeView = await apiResponse(f.parent.api.v1.users.me['home-summary'].$get());
    expect(homeView.children[0]).toMatchObject({ owing: 8000, owingRegistrationIds: [onlyId] });
    // Not collectable while provisional; collected once the fee is confirmed.
    expect((await refused(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: [prvLine.id], instrumentUsed: 'cash', escrowAmountToApply: 0 } }))).error)
      .toContain('Board fee provisional');
    await apiResponse(finadmin.api.v1['board-fees'][':seriesId'].confirm.$post({ param: { seriesId: peaP }, json: { rows: [{ feeId: prvFee }] } }));
    expect((await apiResponse(officer.api.v1.users[':id'].summary.$get({ param: { id: f.studentId } }))).owing).toBe(18000);
    const owed = (await apiResponse(f.parent.api.v1.users.me['home-summary'].$get())).children[0]!;
    expect(owed.owing).toBe(18000);
    expect([...owed.owingRegistrationIds].sort()).toEqual([onlyId, prvLine.id].sort());
    const later = await apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: [prvLine.id], instrumentUsed: 'cash', escrowAmountToApply: 0 } }));
    expect(later.collected).toBe(10000);
    expect((await lineOf(prvLine.id)).status).toBe('confirmed');
    // Everything on a provisional fee: reserved, nothing collected (a fresh provisional fee).
    const g = await onboard(officer, `o08-desk-g-${RUN}`, 11);
    await sql(`update board_fee set provisional = true, confirmed_at = null, confirmed_by = null where id = $1`, [prvFee]);
    const allProv = await apiResponse(deskCollect(g.studentId, june, [first(prvItem)]));
    expect(allProv).toMatchObject({ collected: 0, payments: [], reservedNotCollected: [{ price: 10000 }] });
  });

  // ─── The family's flow, end to end, and the statement (§4.4, §4.5) ─────────

  it("the family's flow: a student asks, a parent approves and pays by series; the statement's numbers are the ledger's, one payment per entry deadline", async () => {
    const f = await onboard(officer, `o08-stmt-${RUN}`, 11);
    const asked = await apiResponse(f.student.api.v1.registrations.request.$post({
      json: { sessionId: june, lines: [first(bioItem, { teacherId: teacherA }), retake(matItem, { mode: 'self_study', priorSitting: { month: 'january', year: Y } })], consent: CONSENT },
    }));
    await apiResponse(f.parent.api.v1.registrations.approve.$put({ json: { registrationIds: asked.map((r) => r.id) } }));
    const b = asked.find((r) => r.offerItemId === bioItem)!;
    const m = asked.find((r) => r.offerItemId === matItem)!;
    // Two series, two deadlines: one checkout each.
    expect(await refused(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [b.id, m.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } })))
      .toMatchObject({ status: 422, error: expect.stringContaining('each series is paid for on its own') });
    const pay = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [b.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id! }, json: { instrumentUsed: 'cash' } }));

    const st = await apiResponse(f.parent.api.v1.statement.$get({ query: { studentId: f.studentId } }));
    expect(st.students).toHaveLength(1);
    const s = st.students[0]!;
    const lines = s.sessions.find((x) => x.id === june)!.lines;
    const sb = lines.find((l) => l.id === b.id)!;
    const sm = lines.find((l) => l.id === m.id)!;
    expect(sb).toMatchObject({ price: 23200, paid: 23200, outstanding: 0, dueAt: null, basisText: 'course 14,000 × 100% + board 9,200 × 100%', teacher: `Teacher A (08o ${RUN})` });
    expect(sb.receipt?.number).toMatch(/^RCP-/);
    expect(sm).toMatchObject({ price: 9600, paid: 0, outstanding: 9600, basisText: 'course 10,000 × 50% + board 4,600 × 100%', priorSitting: { source: 'declared_by_family', outcome: null } });
    expect(new Date(sm.dueAt!).getTime()).toBe(new Date((await one<{ d: string }>(`select due_at as d from registration where id = $1`, [m.id])).d).getTime());
    // From the ledger: what the completed payments covered, the escrow's own balance.
    const ledgerPaid = money((await one<{ s: string }>(`select coalesce(sum(r.price_at_registration), 0) as s from registration r
      where r.student_id = $1 and exists (select 1 from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = r.id and p.status = 'completed')`, [f.studentId])).s);
    expect(s.totals.paid).toBe(ledgerPaid);
    expect(s.totals).toMatchObject({ price: 23200 + 9600, paid: 23200, outstanding: 9600 });
    expect(s.escrow.free).toBe((await escrowOf(f.studentId)).free);
    // One payment per entry deadline: the statement's registration payment covers one deadline.
    const regPayments = s.payments.filter((p) => p.purpose === 'registration');
    expect(regPayments).toHaveLength(1);
    expect(regPayments[0]).toMatchObject({ total: 23200, status: 'completed', covers: [{ registrationId: b.id, label: `Biology (08o ${RUN})` }] });
    expect(new Date(regPayments[0]!.deadline!).getTime()).toBe(new Date((await one<{ d: string }>(`select line_effective_deadline(attempt, prior_sitting_series_id, board_series_id) as d from registration where id = $1`, [b.id])).d).getTime());
    // The family statement: the parent's own (no query) and staff's by familyId; a student reads their own.
    const fam = await apiResponse(f.parent.api.v1.statement.$get({ query: {} }));
    expect(fam.family).toMatchObject({ id: f.parent.id });
    expect(fam.students.map((x) => x.student.id)).toEqual([f.studentId]);
    expect((await apiResponse(officer.api.v1.statement.$get({ query: { familyId: f.parent.id } }))).totals).toMatchObject({ price: 32800, paid: 23200, outstanding: 9600 });
    expect((await apiResponse(f.student.api.v1.statement.$get({ query: {} }))).students[0]!.student.id).toBe(f.studentId);
    expect((await refused(officer.api.v1.statement.$get({ query: {} }))).status).toBe(400);
    expect(s.charges).toEqual([]);
  });

  it('GET /registrations/available is gone: the Reserve pages read /registrations/offers', async () => {
    const f = await onboard(officer, `o08-gone-${RUN}`, 11);
    const res = await f.parent.api.v1.registrations[':id'].$get({ param: { id: 'available' } });
    expect(res.status).toBe(404);
  });
});
