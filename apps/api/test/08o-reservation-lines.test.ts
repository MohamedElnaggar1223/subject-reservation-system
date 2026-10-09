import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
  // Half back on a drop today. Since step C a line's refund is refundFor's (refund.services, §3.9):
  // the policy the family consented to, in weeks from the course's start — V3's refund windows
  // count only for converted lines. The session's course started 15 days ago: week 3 of June's
  // policy (100% to week 2, 50% in week 3), so 50% of the course part, as the windows gave.
  const halfBack = (sessionId: string) => apiResponse(adm.api.v1.sessions[':id'].$put({
    param: { id: sessionId }, json: { courseStartsOn: cairoDate(new Date(Date.now() - days(15))), reason: 'step B: half back (week 3 of the policy)' },
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

  it("a converted session with no refund policy freezes its refund windows as dates: the session's own, else its academic year's", async () => {
    const { academicYearForDate } = await import('../src/services/school-fee.services');
    const windowsOf = async (where: string, arg: string) => (await sql<{ s: Date; e: Date; p: string }>(
      `select starts_at as s, ends_at as e, percentage as p from refund_window where ${where} = $1 order by starts_at`, [arg]))
      .map((w) => ({ startsAt: new Date(w.s).toISOString(), endsAt: new Date(w.e).toISOString(), percent: Number(w.p) }));
    const snapshotOf = async (id: string) => (await one<{ s: unknown }>(`select refund_policy_snapshot as s from registration where id = $1`, [id])).s;

    // The session's own windows.
    const sA = await mkSession('june', Y + 1, `o08c1-${RUN}`);
    await sql(`update registration_session set refund_policy = null where id = $1`, [sA]);
    const itemA = await offerOne(sA, mat, 10000, peaJ, [teacherA]);
    await apiResponse(finadmin.api.v1.receipts['refund-windows'].$post({ json: { sessionId: sA, startsAt: at(-1), endsAt: at(20), percentage: 70, label: 'step B: a converted session' } }));
    const fa = await onboard(officer, `o08-conv-a-${RUN}`, 11);
    const [la] = await apiResponse(fa.parent.api.v1.registrations.direct.$post({ json: { sessionId: sA, studentId: fa.studentId, lines: [first(itemA)], consent: CONSENT } }));
    const own = await windowsOf('session_id', sA);
    expect(own.map((w) => w.percent)).toEqual([70]);
    expect(await snapshotOf(la!.id)).toEqual({ kind: 'dates', windows: own });
    // The family read the same terms before it ticked.
    expect((await apiResponse(fa.parent.api.v1.sessions[':id']['refund-terms'].$get({ param: { id: sA } }))).terms).toEqual({ kind: 'dates', windows: own });

    // None of its own: its academic year's.
    const sB = await mkSession('june', Y + 1, `o08c2-${RUN}`);
    await sql(`update registration_session set refund_policy = null where id = $1`, [sB]);
    const itemB = await offerOne(sB, mat, 10000, peaJ, [teacherA]);
    const { start } = await one<{ start: Date }>(`select start_date as start from registration_session where id = $1`, [sB]);
    const year = academicYearForDate(new Date(start));
    const made = await apiResponse(finadmin.api.v1.receipts['refund-windows'].$post({ json: { academicYear: year, startsAt: at(-1), endsAt: at(20), percentage: 30, label: 'step B: the academic year' } }));
    try {
      const fb = await onboard(officer, `o08-conv-b-${RUN}`, 11);
      const [lb] = await apiResponse(fb.parent.api.v1.registrations.direct.$post({ json: { sessionId: sB, studentId: fb.studentId, lines: [first(itemB)], consent: CONSENT } }));
      const yearly = await windowsOf('academic_year', year);
      expect(yearly.some((w) => w.percent === 30)).toBe(true);
      expect(await snapshotOf(lb!.id)).toEqual({ kind: 'dates', windows: yearly });
      expect((await apiResponse(fb.student.api.v1.sessions[':id']['refund-terms'].$get({ param: { id: sB } }))).terms).toEqual({ kind: 'dates', windows: yearly });
    } finally {
      // An academic year's window reaches every session of the year without its own: removed for the suites after.
      await apiResponse(finadmin.api.v1.receipts['refund-windows'][':id'].$delete({ param: { id: (made as { id: string }).id } }));
    }
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
    // Its creation says why: a family's declaration, not an item placed in a session.
    expect(await one(`select new_data->>'reason' as reason from audit_log where action = 'BOARD_SERIES_CREATED' and entity_id = $1`, [r.prior_sitting_series_id]))
      .toEqual({ reason: 'Created when a family declared a sitting not on record (no dates yet)' });
    // On the session's To verify tab, for the coordinator: declared by the family, not paid.
    const listed = (await toVerify(june)).find((l) => l.id === line!.id)!;
    expect(listed).toMatchObject({ paid: false, declaredBy: { channel: 'family' }, sitting: { name: `Cambridge International November ${Y - 1}` }, line: { subject: `Biology (08o ${RUN})` } });
    // A first entry follows no earlier sitting; a sitting of another board is refused.
    const g = await onboard(officer, `o08-decl-g-${RUN}`, 11);
    expect(await refused(g.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: g.studentId, lines: [first(bioItem, { priorSitting: { month: 'june', year: Y } })], consent: CONSENT } })))
      .toEqual({ status: 400, error: `A first entry of Biology (08o ${RUN}) follows no earlier sitting: choose "retake" to name one` });
    expect(await refused(g.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: g.studentId, lines: [retake(bioItem, { priorSittingSeriesId: peaJ })], consent: CONSENT } })))
      .toMatchObject({ status: 400, error: expect.stringContaining("the sitting named is another board's") });
    // A family declares a sitting of the board's last two years (§3.5); an older one is the desk's.
    expect(await refused(g.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: g.studentId, lines: [retake(bioItem, { priorSitting: { month: 'november', year: Y - 2 } })], consent: CONSENT } })))
      .toEqual({ status: 400, error: `A sitting of Biology (08o ${RUN}) more than two years before this series is declared at the finance desk, with the board's statement` });
    const o = await onboard(officer, `o08-decl-o-${RUN}`, 11);
    const older = await apiResponse(officer.api.v1.registrations.desk.$post({ json: {
      studentId: o.studentId, sessionId: june, lines: [retake(bioItem, { teacherId: teacherA, priorSitting: { month: 'november', year: Y - 2 } })], consent: CONSENT,
    } }));
    expect(await lineOf(older.registrations[0]!.id)).toMatchObject({ prior_sitting_source: 'declared_by_desk' });
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

  it('a dropped line is not a known sitting (it was never sat): a retake naming nothing is refused, naming it declares it and lists it to verify', async () => {
    const f = await onboard(officer, `o08-dropk-${RUN}`, 11);
    const sat = await apiResponse(deskCollect(f.studentId, winterS, [first(bioWinter)]));
    await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: sat.registrations[0]!.id }, json: { reason: 'did not sit it after all' } }));
    expect((await lineOf(sat.registrations[0]!.id)).status).toBe('dropped');
    const refusal = await refused(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines: [retake(bioItem, { teacherId: teacherA })], consent: CONSENT } }));
    expect(refusal).toMatchObject({ status: 400, error: expect.stringMatching(/^A retake of Biology \(08o .+\) names the sitting it follows/) });
    const [line] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: {
      sessionId: june, studentId: f.studentId, lines: [retake(bioItem, { teacherId: teacherA, priorSittingSeriesId: camN })], consent: CONSENT,
    } }));
    expect(await lineOf(line!.id)).toMatchObject({ prior_sitting_series_id: camN, prior_sitting_source: 'declared_by_family' });
    expect((await toVerify(june)).some((l) => l.id === line!.id)).toBe(true);
  });

  it("F4's results and sent entries are known sittings: the retake is pre-set with its series, priced as a retake and cut off at the retake deadline; a withdrawn entry is not", async () => {
    // A Cambridge IGCSE syllabus mapped to a subject; November's series sets a retake deadline after its entry deadline.
    const cat = coordinator.api.v1.catalogue;
    const award = await apiResponse(cat.qualifications.$post({ json: {
      boardCode: 'cambridge', code: `F4${RUN}`.toUpperCase().slice(0, 8), title: `Chemistry (08o ${RUN})`, level: 'igcse', suite: 'Cambridge IGCSE',
      subjectArea: `Chemistry (08o ${RUN})`, entryMethod: 'syllabus_option',
    } }));
    const chem = await subject(adm, `RWO-CHE-${RUN}`, `Chemistry (08o ${RUN})`, { course: 12000, registration: 9000 });
    await apiResponse(cat.registrable[':subjectId'].$put({ param: { subjectId: chem }, json: { boardCode: 'cambridge', qualificationId: award.id, unitIds: [] } }));
    const june = await mkSeries('cambridge', 'june', Y, `o08f4j-${RUN}`);
    const nov = await mkSeries('cambridge', 'november', Y, `o08f4n-${RUN}`, { entryDeadline: at(20), retakeDeadline: at(25) });
    await apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId: nov }, json: { rows: [{ keyKind: 'qualification', keyId: award.id, amount: 9000, provisional: false }] } }));
    const winter = await mkSession('winter', Y, `o08f4-${RUN}`);
    const item = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({ param: { id: winter }, json: {
      subjectId: chem, courseFee: 12000, teachers: [{ teacherId: teacherA, mode: 'in_school' }],
      items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'award', qualificationId: award.id }, boardSeriesId: nov, availability: 'open', requiredInSeries: false }],
    } })))!.items[0]!;

    // F4's records of June (what its results import and entry submission leave; the tables are F4's).
    const fR = await onboard(officer, `o08-f4r-${RUN}`, 11);
    const fE = await onboard(officer, `o08-f4e-${RUN}`, 11);
    const fW = await onboard(officer, `o08-f4w-${RUN}`, 11);
    const fD = await onboard(officer, `o08-f4d-${RUN}`, 11);
    await sql(`insert into exam_result (id, student_id, board_series_id, board_code, kind, code, qualification_id, grade, source, status)
      values (gen_random_uuid(), $1, $2, 'cambridge', 'award', $3, $4, 'B', 'manual', 'provisional')`, [fR.studentId, june, award.code, award.id]);
    // Sent to the board (submitted); one withdrawn after it was sent (F4's withdraw, with its audit
    // row: 09's rule); one a draft, never sent. fE is entered for November itself too, which is no
    // earlier sitting of a November item.
    const entry = async (studentId: string, status: 'submitted' | 'draft', series = june) => (await sql<{ id: string }>(`insert into exam_entry (id, student_id, board_series_id, board_code, kind, qualification_id, entry_code, title, status, submitted_at)
      values (gen_random_uuid(), $1, $2, 'cambridge', 'award', $3, $4, 'Chemistry', $5, $6) returning id`,
      [studentId, series, award.id, award.code, status, status === 'draft' ? null : new Date()]))[0]!.id;
    await entry(fE.studentId, 'submitted');
    await entry(fE.studentId, 'submitted', nov);
    await apiResponse(coordinator.api.v1.exams.entries[':id'].withdraw.$post({ param: { id: await entry(fW.studentId, 'submitted') }, json: { reason: 'the candidate withdrew' } }));
    await entry(fD.studentId, 'draft');

    const offered = async (studentId: string) => (await apiResponse(officer.api.v1.registrations.offers.$get({ query: { sessionId: winter, studentId } })))
      .offers.flatMap((o) => o.items).find((i) => i.id === item)!;
    const dates = await one<{ retake: string }>(`select retake_deadline as retake from board_series where id = $1`, [nov]);
    for (const [f, source, grade] of [[fR, 'result', 'B'], [fE, 'entry', null]] as const) {
      // The page knows the sitting: the retake is pre-set with its series and where it is known from.
      const read = await offered(f.studentId);
      expect(read.knownSittings).toEqual([expect.objectContaining({ seriesId: june, source, grade, registrationId: null, month: 'june', year: Y })]);
      // Reserved as a retake naming nothing: the known sitting filled in, not declared, not listed to verify.
      const [line] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: winter, studentId: f.studentId, lines: [retake(item, { teacherId: teacherA })], consent: CONSENT } }));
      const l = await one<{ prior: string; source: string; attempt: string; price: string; basis: { attempt: string; coursePercent: number; boardPercent: number }; deadline: string }>(
        `select prior_sitting_series_id as prior, prior_sitting_source as source, attempt, price_at_registration as price, pricing_basis as basis,
           line_effective_deadline(attempt, prior_sitting_series_id, board_series_id, declaration_rejected) as deadline
         from registration where id = $1`, [line!.id]);
      expect(l).toMatchObject({ prior: june, source: 'known', attempt: 'retake', price: '21000.00' });
      expect(l.basis).toMatchObject({ attempt: 'retake', coursePercent: 100, boardPercent: 100 });
      // A retake of the board's previous sitting (June before November): the retake deadline.
      expect(new Date(l.deadline).getTime()).toBe(new Date(dates.retake).getTime());
      expect((await toVerify(winter)).some((x) => x.id === line!.id)).toBe(false);
    }
    // A withdrawn entry was taken back from the board, a draft never went: no known sitting, the retake must be declared.
    expect((await offered(fW.studentId)).knownSittings).toEqual([]);
    expect((await offered(fD.studentId)).knownSittings).toEqual([]);
    expect(await refused(fW.parent.api.v1.registrations.direct.$post({ json: { sessionId: winter, studentId: fW.studentId, lines: [retake(item, { teacherId: teacherA })], consent: CONSENT } })))
      .toMatchObject({ status: 400, error: expect.stringMatching(/^A retake of Chemistry \(08o .+\) names the sitting it follows/) });
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

  it('a rejected declaration is a first entry: its deadline becomes the entry deadline, not the retake one', async () => {
    const f = await onboard(officer, `o08-rejd-${RUN}`, 11);
    // Declared, a retake of November (Cambridge's sitting before June) runs to June's retake deadline.
    const desk = await apiResponse(deskCollect(f.studentId, june, [retake(bioItem, { mode: 'self_study', priorSitting: { month: 'november', year: Y } })]));
    const id = desk.registrations[0]!.id;
    const dates = await one<{ entry: string; retake: string }>(`select entry_deadline as entry, retake_deadline as retake from board_series where id = $1`, [camJ]);
    const entry = new Date(dates.entry).getTime();
    const retakeAt = new Date(dates.retake).getTime();
    expect(retakeAt).toBeGreaterThan(entry);
    const statementDeadline = async () => {
      const st = (await apiResponse(officer.api.v1.statement.$get({ query: { studentId: f.studentId } }))).students[0]!;
      return new Date(st.sessions.find((x) => x.id === june)!.lines.find((l) => l.id === id)!.deadline!).getTime();
    };
    const { effectiveDeadlinesOf } = await import('../src/services/deadline.services');
    const { db } = await import('@repo/db');
    expect(await statementDeadline()).toBe(retakeAt);
    expect((await effectiveDeadlinesOf(db, [id])).get(id)?.kind).toBe('retake');
    // Rejected while paid, before the first-entry deadline: it stands, and the board takes it as a first entry.
    await apiResponse(verify(coordinator, id, { outcome: 'rejected', reason: 'no November result for this candidate' }));
    expect(await lineOf(id)).toMatchObject({ status: 'confirmed', declaration_rejected: true });
    expect(await statementDeadline()).toBe(entry);
    const own = (await effectiveDeadlinesOf(db, [id])).get(id)!;
    expect([own.at?.getTime(), own.kind]).toEqual([entry, 'entry']);
    // The SQL rule every sweep and grouping reads (lineDeadlineSql) gives the same.
    const { lineDeadlineSql } = await import('../src/services/deadline.services');
    const { sql: dsql } = await import('@repo/db');
    const [row] = (await db.execute(dsql`select ${lineDeadlineSql('r')} as d from registration r where r.id = ${id}`)).rows as { d: string }[];
    expect(new Date(row!.d).getTime()).toBe(entry);
  });

  it('a paid preregistration whose declaration was rejected, captured between the entry and retake deadlines: refunded in full, not confirmed (MO-21)', async () => {
    // A session not open yet, its own Cambridge June series (entry deadline, then a later retake deadline).
    const camP = await mkSeries('cambridge', 'june', Y + 1, `o08pr-${RUN}`, { entryDeadline: at(100), retakeDeadline: at(110) });
    await fee(camP, bio, 9200);
    const draft = (await apiResponse(adm.api.v1.sessions.$post({ json: {
      type: 'june', year: Y + 1, label: `o08pr-${RUN}`, startDate: at(30).toISOString(), endDate: at(120).toISOString(),
      courseStartsOn: cairoDate(at(30)), paymentDueAt: at(90).toISOString(),
    } })))!.id;
    const bioDraft = await offerOne(draft, bio, 14000, camP, [teacherA]);
    const f = await onboard(officer, `o08-prerej-${RUN}`, 11);
    // A declared retake of November (Cambridge's sitting before June): it runs to the retake deadline.
    const [pre] = await apiResponse(f.parent.api.v1.registrations.preregister.$post({ json: {
      sessionId: draft, studentId: f.studentId, lines: [retake(bioDraft, { mode: 'self_study', priorSitting: { month: 'november', year: Y } })], consent: CONSENT,
    } }));
    const id = pre!.id;
    const pay = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id! }, json: { instrumentUsed: 'cash' } }));
    const price = Number((await lineOf(id)).price);
    expect(await escrowOf(f.studentId)).toMatchObject({ held: price });
    // Rejected while paid and held: it stands as a first entry.
    expect(await apiResponse(verify(coordinator, id, { outcome: 'rejected', reason: 'no November result for this candidate' })))
      .toMatchObject({ outcome: 'rejected', effect: 'stands' });
    // The entry deadline passes, the retake deadline is still ahead; the session opens and capture runs.
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [camP]);
    await sql(`update registration_session set status = 'active', start_date = now() - interval '1 day' where id = $1`, [draft]);
    const { capturePreregistrationsForSession } = await import('../src/services/prereg.services');
    const run = await capturePreregistrationsForSession(draft);
    // A first entry past its deadline is never entered: the held money goes back in full.
    expect(run).toMatchObject({ captured: 0, refundedAtDeadline: 1 });
    expect((await lineOf(id)).status).toBe('dropped');
    expect(await escrowOf(f.studentId)).toMatchObject({ held: 0 });
    expect(money((await one<{ s: string }>(`select coalesce(sum(amount), 0) as s from escrow_transaction where related_registration_id = $1 and type = 'credit'`, [id])).s)).toBe(price);
  });

  it("the deadline sweeps read a rejected declaration as a first entry: a reverted waiting line expires, a held preregistration is refunded, at the entry deadline", async () => {
    // Its own series: an entry deadline, then a later retake deadline.
    const camS = await mkSeries('cambridge', 'june', Y + 1, `o08sw-${RUN}`, { entryDeadline: at(30), retakeDeadline: at(35) });
    await fee(camS, bio, 9200);
    const open = await mkSession('june', Y + 1, `o08sw-${RUN}`);
    const bioOpen = await offerOne(open, bio, 14000, camS, [teacherA]);
    const declared = retake(bioOpen, { mode: 'self_study', priorSitting: { month: 'november', year: Y } });
    // A waiting line with the flag: paid at the desk, rejected (it stands), then its payment reversed.
    const f = await onboard(officer, `o08-swp-${RUN}`, 11);
    const desk = await apiResponse(deskCollect(f.studentId, open, [declared]));
    const id = desk.registrations[0]!.id;
    await apiResponse(verify(coordinator, id, { outcome: 'rejected', reason: 'no November result for this candidate' }));
    await apiResponse(finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: desk.payments[0]!.id }, json: { reason: 'confirmed by mistake', moneyReturned: true } }));
    expect(await lineOf(id)).toMatchObject({ status: 'pending_payment', declaration_rejected: true });
    // A held preregistration with the flag, in a session not open yet, in the same series.
    const draft = (await apiResponse(adm.api.v1.sessions.$post({ json: {
      type: 'june', year: Y + 1, label: `o08swd-${RUN}`, startDate: at(60).toISOString(), endDate: at(120).toISOString(),
      courseStartsOn: cairoDate(at(60)), paymentDueAt: at(90).toISOString(),
    } })))!.id;
    const bioDraft = await offerOne(draft, bio, 14000, camS, [teacherA]);
    const g = await onboard(officer, `o08-swh-${RUN}`, 11);
    const [pre] = await apiResponse(g.parent.api.v1.registrations.preregister.$post({ json: { sessionId: draft, studentId: g.studentId, lines: [retake(bioDraft, { mode: 'self_study', priorSitting: { month: 'november', year: Y } })], consent: CONSENT } }));
    const prePay = await apiResponse(g.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [pre!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: prePay.id! }, json: { instrumentUsed: 'cash' } }));
    await apiResponse(verify(coordinator, pre!.id, { outcome: 'rejected', reason: 'no November result for this candidate' }));
    expect(await lineOf(pre!.id)).toMatchObject({ status: 'preregistered', declaration_rejected: true });
    const prePrice = Number((await lineOf(pre!.id)).price);
    // The entry deadline passes; the retake deadline is still ahead.
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [camS]);
    await runPaymentDeadlines();
    expect(await lineOf(id)).toMatchObject({ status: 'expired' });
    expect(await expiryOf(id)).toEqual({ status: 'expired', reason: 'entry_deadline' });
    const { refundPreregistrationsAtDeadline } = await import('../src/services/prereg.services');
    await refundPreregistrationsAtDeadline(draft, camS);
    expect((await lineOf(pre!.id)).status).toBe('dropped');
    expect(await escrowOf(g.studentId)).toMatchObject({ held: 0 });
    expect(money((await one<{ s: string }>(`select coalesce(sum(amount), 0) as s from escrow_transaction where related_registration_id = $1 and type = 'credit'`, [pre!.id])).s)).toBe(prePrice);
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
    // The paper is out: the refund waits for it to come back — the window's 50% of the course part
    // (16,200 − 9,200 = 7,000: 3,500) and the board fee in full, not sent (9,200): 12,700.
    expect(r).toMatchObject({ outcome: 'rejected', effect: 'dropped', gated: true, refundAmount: 12700, refundPercentage: 50 });
    expect(await lineOf(id)).toMatchObject({ status: 'dropped_pending_receipt', outcome: 'rejected', declaration_rejected: false });
    expect(await one(`select status, refund_amount_on_return as amount from receipt where id = $1`, [rc.id])).toEqual({ status: 'return_required', amount: '12700.00' });
    // Its own deadline (the retake deadline) has not passed: the board fee is not sent yet, so the
    // refund is the window's percentage of the course part plus the unsent board fee in full
    // (3,500 + 9,200 = 12,700); nothing is kept (the case below keeps a sent board fee).
    expect(await one(`select new_data->>'boardSent' as sent, new_data->>'boardFeeKept' as kept from audit_log where action = 'PRIOR_SITTING_REJECTED' and entity_id = $1`, [id]))
      .toEqual({ sent: 'false', kept: '0' });
    expect(await escrowOf(f.studentId)).toEqual(before);
    await apiResponse(officer.api.v1.receipts[':id'].return.$post({ param: { id: rc.id }, json: {} }));
    expect(await lineOf(id)).toMatchObject({ status: 'dropped' });
    expect(await escrowOf(f.studentId)).toEqual({ free: money(before.free + 12700), held: before.held });
    const [n] = await notified(f.parent.email, 'DECLARATION_REVIEWED', 1);
    expect(n!.body).toContain("the board's first-entry deadline has passed");
  });

  it('rejected on a paid line after its own deadline: the board fee the school has paid is kept, the rest refunded by the window', async () => {
    const camS = await mkSeries('cambridge', 'june', Y + 1, `o08s-${RUN}`, { entryDeadline: at(30), retakeDeadline: at(35) });
    await fee(camS, bio, 9200);
    const sentS = await mkSession('june', Y + 1, `o08s-${RUN}`);
    const bioSent = await offerOne(sentS, bio, 14000, camS, [teacherA]);
    await halfBack(sentS);
    const f = await onboard(officer, `o08-rejs-${RUN}`, 11);
    // A retake of June a year earlier — not Cambridge's previous sitting — runs to the entry deadline.
    const desk = await apiResponse(deskCollect(f.studentId, sentS, [retake(bioSent, { mode: 'self_study', priorSitting: { month: 'june', year: Y } })]));
    const id = desk.registrations[0]!.id;
    expect(await one(`select price_at_registration::float as price, registration_fee_at_registration::float as board from registration where id = $1`, [id]))
      .toEqual({ price: 16200, board: 9200 });
    // Its deadline passes: the entry is the board's and its fee paid (sent).
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [camS]);
    const before = await escrowOf(f.studentId);
    const r = await apiResponse(verify(coordinator, id, { outcome: 'rejected', reason: 'no such result on the board record' }));
    // 50% of (16,200 − the 9,200 board fee) = 3,500; the receipt was at the desk, so it is credited now.
    expect(r).toMatchObject({ outcome: 'rejected', effect: 'dropped', gated: false, refundAmount: 3500, refundPercentage: 50 });
    expect(await lineOf(id)).toMatchObject({ status: 'dropped', outcome: 'rejected' });
    expect(await one(`select new_data->>'boardSent' as sent, new_data->>'boardFeeKept' as kept from audit_log where action = 'PRIOR_SITTING_REJECTED' and entity_id = $1`, [id]))
      .toEqual({ sent: 'true', kept: '9200' });
    expect(await escrowOf(f.studentId)).toEqual({ free: money(before.free + 3500), held: before.held });
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
    await sql(`update audit_log set created_at = now() - interval '45 seconds' where id = (select id from audit_log where action = 'SETTING_CHANGED' and entity_id = 'verification.unverifiedAtDeadline' order by created_at desc limit 1)`);
    // The setting row touched since (not a change of its value): hold still counts from when it became hold.
    await sql(`update school_setting set updated_at = now() where key = 'verification.unverifiedAtDeadline'`);
    const run = await runPaymentDeadlines();
    expect(run).toMatchObject({ unverifiedExpired: 1, unverifiedDropped: 1 });
    // The waiting declared line: hold_unverified; the paid one: dropped (the receipt never left the desk), half back.
    expect(await lineOf(w!.id)).toMatchObject({ status: 'expired', outcome: null });
    expect(await expiryOf(w!.id)).toEqual({ status: 'expired', reason: 'hold_unverified' });
    expect(await lineOf(p)).toMatchObject({ status: 'dropped' });
    // Held, never entered: 50% of the course part (3,500) and the board fee in full (9,200).
    expect(await escrowOf(paid.studentId)).toEqual({ free: money(before.free + 12700), held: before.held });
    expect((await one<{ n: Record<string, unknown> }>(`select new_data as n from audit_log where entity_id = $1 and action = 'LINE_DROPPED_UNVERIFIED'`, [p])).n)
      .toMatchObject({ status: 'dropped', refundAmount: 12700, refundPercentage: 50, gated: false, setting: 'hold' });
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
    // The family's checkout asks for its own pair first, showing the terms its tick will freeze.
    const summary = await apiResponse(g10.parent.api.v1.payments['checkout-summary'].$get({ query: { registrationIds: line!.id } }));
    const policy = (await one<{ p: { steps: unknown[] } }>(`select refund_policy as p from registration_session where id = $1`, [june])).p;
    expect(summary).toMatchObject({ familyConsentNeeded: [line!.id], familyConsentTerms: [{ sessionId: june, terms: { kind: 'weeks', steps: policy.steps } }] });
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
    // The parent approves the price the request showed: priced otherwise by then, the approval is
    // refused and nothing moves (the request stays, the old line stays paid).
    const h = await onboard(officer, `o08-swapp-${RUN}`, 11);
    const hd = await apiResponse(deskCollect(h.studentId, june, [first(matItem)]));
    const hcr = await apiResponse(h.student.api.v1.registrations[':id']['request-swap'].$post({
      param: { id: hd.registrations[0]!.id }, json: { line: first(bioItem, { teacherId: teacherB }), reason: 'prefers Biology this year' },
    }));
    expect(Number(hcr.priceAtRequest)).toBe(23200);
    // A request from before step B (no new_line: it priced the subject, not a line) approved at the
    // same moment: made at today's price, as approval always did.
    const k = await onboard(officer, `o08-swapo-${RUN}`, 11);
    const kd = await apiResponse(deskCollect(k.studentId, june, [first(matItem)]));
    const kcr = await apiResponse(k.student.api.v1.registrations[':id']['request-swap'].$post({
      param: { id: kd.registrations[0]!.id }, json: { line: first(bioItem, { teacherId: teacherB }), reason: 'prefers Biology this year' },
    }));
    await sql(`update change_request set new_line = null where id = $1`, [kcr.id]);
    await sql(`update board_fee set amount = amount + 100 where board_series_id = $1 and key_id = $2`, [camJ, bio]);
    try {
      const { SWAP_PRICE_CHANGED } = await import('../src/services/swap.services');
      expect(await refused(h.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: hcr.id }, json: {} })))
        .toMatchObject({ error: SWAP_PRICE_CHANGED });
      expect(await one(`select status from change_request where id = $1`, [hcr.id])).toEqual({ status: 'pending_approval' });
      expect((await lineOf(hd.registrations[0]!.id)).status).toBe('confirmed');
      expect(await sql(`select 1 from registration where student_id = $1 and offer_item_id = $2`, [h.studentId, bioItem])).toEqual([]);
      // The old request is approved, its line made at today's price (23,300).
      expect(await apiResponse(k.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: kcr.id }, json: {} }))).toMatchObject({ success: true, type: 'swap' });
      const [kl] = await sql<{ price: string }>(`select price_at_registration as price from registration where student_id = $1 and offer_item_id = $2`, [k.studentId, bioItem]);
      expect(money(kl!.price)).toBe(23300);
    } finally {
      await sql(`update board_fee set amount = amount - 100 where board_series_id = $1 and key_id = $2`, [camJ, bio]);
    }
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
    // A first entry of a subject the school teaches stays taught: a staff change is not the
    // self-study exception (gate.selfStudyFirstEntry, which the student does not hold).
    expect(await refused(put(adm, { teacherId: null, mode: 'self_study', reason: 'studies alone from now' })))
      .toEqual({ status: 409, error: `Biology (08o ${RUN}) is a first entry the school teaches: it is taken in school unless the student holds the self-study exception` });
    expect(await lineOf(id)).toMatchObject({ mode: 'in_school', teacher_id: teacherB, price: priceBefore.price });
    // A retake may go to self-study on a paid line: not taught, no teacher, the price unchanged
    // (a refund is finance's own act).
    const h = await onboard(officer, `o08-teach-h-${RUN}`, 11);
    const [rl] = await apiResponse(h.parent.api.v1.registrations.direct.$post({ json: {
      sessionId: june, studentId: h.studentId, lines: [retake(bioItem, { teacherId: teacherA, priorSitting: { month: 'november', year: Y - 1 } })], consent: CONSENT,
    } }));
    const rid = rl!.id;
    const rpay = await apiResponse(h.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [rid], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: rpay.id! }, json: { instrumentUsed: 'cash' } }));
    const retakeBefore = await lineOf(rid);
    const putRetake = (who: Client, json: { teacherId: string | null; mode?: 'in_school' | 'self_study'; reason: string }) =>
      who.api.v1.registrations[':id'].teacher.$put({ param: { id: rid }, json });
    expect(await apiResponse(putRetake(adm, { teacherId: null, mode: 'self_study', reason: 'studies alone from now' }))).toMatchObject({ mode: 'self_study', teacherId: null, repriced: false });
    expect(await lineOf(rid)).toMatchObject({ mode: 'self_study', taken_outside_school: true, teacher_id: null, price: retakeBefore.price });
    const retakeEnrolment = await one<{ teacher_id: string | null; mode: string }>(
      `select teacher_id, mode from course_enrolment where student_id = $1 and subject_id = $2 and academic_year_id = $3 and ended_on is null`, [h.studentId, bio, year]);
    expect(retakeEnrolment).toMatchObject({ teacher_id: null, mode: 'self_study' });
    // And not back to taught: it was priced as self-study.
    expect(await refused(putRetake(coordinator, { teacherId: teacherA, reason: 'wants lessons again' })))
      .toEqual({ status: 409, error: `Biology (08o ${RUN}) is reserved as self-study and priced so: to be taught, drop it and reserve it in school` });
    // "No preference" is for a subject with several teachers.
    const g = await onboard(officer, `o08-teach-g-${RUN}`, 11);
    const [m] = await apiResponse(g.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: g.studentId, lines: [first(matItem)], consent: CONSENT } }));
    expect(await refused(g.parent.api.v1.registrations[':id'].teacher.$put({ param: { id: m!.id }, json: { teacherId: null, reason: 'no preference please' } }))).toMatchObject({ status: 403 });
    expect(await refused(coordinator.api.v1.registrations[':id'].teacher.$put({ param: { id: m!.id }, json: { teacherId: null, reason: 'no preference please' } })))
      .toEqual({ status: 409, error: `Mathematics (08o ${RUN}) has one teacher this cycle: "no preference" is for a subject with several` });
  });

  it("the teacher change asks the self-study gate as the line rules do: a rejected declaration is a first entry; a one-shot exception is locked and used once", async () => {
    const { lineExceptions } = await import('../src/services/line-exceptions');
    // A retake whose declaration was rejected while paid stands as a first entry: not moved to self-study by staff.
    const f = await onboard(officer, `o08-tgate-${RUN}`, 11);
    const desk = await apiResponse(deskCollect(f.studentId, june, [retake(bioItem, { teacherId: teacherA, priorSitting: { month: 'november', year: Y - 1 } })]));
    const id = desk.registrations[0]!.id;
    await apiResponse(verify(coordinator, id, { outcome: 'rejected', reason: 'no result for this candidate' }));
    expect(await lineOf(id)).toMatchObject({ status: 'confirmed', declaration_rejected: true, mode: 'in_school' });
    const toSelfStudy = (lineId: string) => coordinator.api.v1.registrations[':id'].teacher.$put({ param: { id: lineId }, json: { teacherId: null, mode: 'self_study', reason: 'studies alone from now' } });
    expect(await refused(toSelfStudy(id)))
      .toEqual({ status: 409, error: `Biology (08o ${RUN}) is a first entry the school teaches: it is taken in school unless the student holds the self-study exception` });
    // With a one-shot gate exception (the registry is C's; the adapter is stood in for here): it is
    // asked FOR UPDATE, the change goes through, and the exception is marked used — once.
    const grant = { id: `test-gate-${f.studentId}`, policyKey: 'gate.selfStudyFirstEntry' as const, value: null, valueDate: null, oneShot: true, scope: {} };
    const used: string[] = [];
    const original = lineExceptions.active;
    const asked: (string | undefined)[] = [];
    const active = vi.spyOn(lineExceptions, 'active').mockImplementation(async (executor, studentId, keys, scope, opts) => {
      const own = await original.call(lineExceptions, executor, studentId, keys, scope, opts);
      if (studentId !== f.studentId || !keys.includes('gate.selfStudyFirstEntry')) return own;
      asked.push(opts?.lock);
      return used.includes(grant.id) ? own : [grant, ...own];
    });
    const markUsed = vi.spyOn(lineExceptions, 'markUsed').mockImplementation(async (_tx, ids) => { used.push(...ids); });
    try {
      expect(await apiResponse(toSelfStudy(id))).toMatchObject({ mode: 'self_study', teacherId: null, repriced: false });
      expect(asked).toEqual(['update']);
      expect(used).toEqual([grant.id]);
      expect(markUsed).toHaveBeenCalledTimes(1);
    } finally {
      active.mockRestore();
      markUsed.mockRestore();
    }
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

  it("the statement's outstanding is the Money tab's unpaid: a line awaiting the parent is not owed, an unfunded preregistration is", async () => {
    const f = await onboard(officer, `o08-owed-${RUN}`, 11);
    // A session not open yet: a parent's reservation there is a preregistration, nothing paid.
    const draft = (await apiResponse(adm.api.v1.sessions.$post({ json: {
      type: 'june', year: Y + 1, label: `o08d-${RUN}`, startDate: at(10).toISOString(), endDate: at(60).toISOString(),
      courseStartsOn: cairoDate(at(10)), paymentDueAt: at(40).toISOString(),
    } })))!.id;
    const matDraft = await offerOne(draft, mat, 10000, peaJ, [teacherA]);
    const [pre] = await apiResponse(f.parent.api.v1.registrations.preregister.$post({ json: { sessionId: draft, studentId: f.studentId, lines: [first(matDraft)], consent: CONSENT } }));
    expect((await lineOf(pre!.id)).status).toBe('preregistered');
    // The student asks for Biology in June: waiting for the parent.
    const [asked] = await apiResponse(f.student.api.v1.registrations.request.$post({ json: { sessionId: june, lines: [first(bioItem, { teacherId: teacherA })], consent: CONSENT } }));
    const st = (await apiResponse(f.parent.api.v1.statement.$get({ query: { studentId: f.studentId } }))).students[0]!;
    const lineIn = (sessionId: string, id: string) => st.sessions.find((x) => x.id === sessionId)!.lines.find((l) => l.id === id)!;
    expect(lineIn(june, asked!.id)).toMatchObject({ status: 'pending_approval', price: 23200, paid: 0, outstanding: 0 });
    expect(lineIn(draft, pre!.id)).toMatchObject({ status: 'preregistered', price: 14600, paid: 0, outstanding: 14600 });
    expect(st.totals).toMatchObject({ paid: 0, outstanding: 14600 });
    // The Money tab says the same of each session.
    const juneMoney = await apiResponse(finadmin.api.v1.sessions[':id'].money.$get({ param: { id: june }, query: { filter: 'unpaid' } }));
    expect(juneMoney.lines.some((l) => l.id === asked!.id)).toBe(false);
    const draftMoney = await apiResponse(finadmin.api.v1.sessions[':id'].money.$get({ param: { id: draft }, query: { filter: 'unpaid' } }));
    expect(draftMoney.lines.filter((l) => l.id === pre!.id).map((l) => l.price)).toEqual([14600]);
  });

  it('GET /registrations/available is gone: the Reserve pages read /registrations/offers', async () => {
    const f = await onboard(officer, `o08-gone-${RUN}`, 11);
    const res = await f.parent.api.v1.registrations[':id'].$get({ param: { id: 'available' } });
    expect(res.status).toBe(404);
  });
});
