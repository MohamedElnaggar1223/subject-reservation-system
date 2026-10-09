import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import {
  onboard, refused, one, sql, audited, notified, notificationsFor, money, pauseAtAudits, lockWaiters, refuseAudit, runPaymentDeadlines, waitFor, CONSENT, type Client,
} from './helpers';
import { examWorld, type ExamWorld, type Family, type Line } from './exam-helpers';

/**
 * F4 on the reservations rework's model (RESERVATIONS_REWORK.md §9's F4 list, §10's F4 row;
 * docs/features/EXAM_ENTRIES.md §2a): entries derive from what each line's item enters
 * (`lineItemsFor`), a retake from the line's attempt, carry forward from the line's verified prior
 * sitting with its previous centre and candidate number, a cash-in from its paid charge
 * (`exam_entry.charge_id`), the forecast's teacher per unit (`teacherOf` with the unit), the
 * carry-forward period on the board (`exam_board.carry_forward_months`); a declared sitting not
 * verified is listed by the entry check and entered or held by `verification.unverifiedAtDeadline`;
 * the board's results verify a declared sitting (step B's answer); "mark as sent" is what makes a
 * line's board fee sent for its refund (step C's `refundFor`); the desk's drop past the deadline
 * withdraws the line's entries. Each line is cut off at its own deadline (MO-10, the retake
 * deadline for a retake of the board's previous sitting).
 *
 * Every request goes through the typed client; outcomes are read back from the database.
 */

const DAY = 86_400_000;
const Y = academicYearStartOf();
const cairoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
const dayWords = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const retake = (offerItemId: string, prior: { month: 'january' | 'june' | 'october' | 'november'; year: number }, extra: Partial<Line> = {}): Line =>
  ({ offerItemId, attempt: 'retake', mode: 'in_school', priorSitting: prior, ...extra });
const carry = (offerItemId: string, prior: { month: 'january' | 'june' | 'october' | 'november'; year: number }): Line =>
  ({ offerItemId, attempt: 'first', mode: 'in_school', priorSitting: prior });

describe('F4 on the reservations rework', () => {
  let w: ExamWorld;
  let coord: Client;
  let T: string;
  const fam: Record<string, Family> = {};
  const lines: Record<string, string> = {};
  const entriesOf = (seriesId: string, studentId: string) =>
    sql<{ id: string; kind: string; entry_code: string; status: string; option_code: string | null; registration_id: string | null; charge_id: string | null;
      is_retake: boolean; retake_source: string | null; carry_forward: string; cf_from_month: string | null; cf_from_year: number | null;
      cf_centre_number: string | null; cf_candidate_number: string | null; submitted_at: string | null; created_at: string }>(
      `select id, kind, entry_code, status, option_code, registration_id, charge_id, is_retake, retake_source, carry_forward, cf_from_month, cf_from_year,
         cf_centre_number, cf_candidate_number, submitted_at, created_at
       from exam_entry where board_series_id = $1 and student_id = $2 and status <> 'withdrawn' order by entry_code, kind`,
      [seriesId, studentId],
    );
  const derive = (boardSeriesId: string, studentId?: string, commit = true) =>
    apiResponse(coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId, ...(studentId ? { studentId } : {}), commit } }));
  const entryList = (boardSeriesId: string) => apiResponse(coord.api.v1.exams['entry-lists'].$get({ query: { boardSeriesId } }));
  const lineOf = (id: string) => one<{ status: string; outcome: string | null; prior_centre: string | null; prior_candidate_number: string | null; declaration_rejected: boolean }>(
    `select status, prior_sitting_verified_outcome as outcome, prior_centre, prior_candidate_number, declaration_rejected from registration where id = $1`, [id]);
  const offer = async (sessionId: string, subjectId: string, courseFee: number, teachers: string[], items: Record<string, unknown>[]) =>
    (await apiResponse(w.adm.api.v1.sessions[':id'].offers.$post({
      param: { id: sessionId },
      json: { subjectId, courseFee, teachers: teachers.map((teacherId) => ({ teacherId, mode: 'in_school' as const })), items: items as never },
    })))!.items;
  const subject = async (code: string, name: string, council: 'cambridge' | 'pearson_edexcel', level: 'as_level' | 'a_level') =>
    (await apiResponse(w.adm.api.v1.subjects.$post({ json: {
      name: `${name} ${T}`, code: `${T}-${code}`, council, courseFee: 1000, registrationFee: 500, isOfferedAtSchool: true, isCore: false, qualificationLevel: level,
    } })))!.id;
  const fee = (seriesId: string, keyKind: 'qualification' | 'unit' | 'option', keyId: string, amount = 500) =>
    apiResponse(w.adm.api.v1['board-fees'].$put({ query: { seriesId }, json: { rows: [{ keyKind, keyId, amount, provisional: false }] } }));
  const reserve = async (f: Family, ls: Line[], sessionId?: string) => (await w.reserve(f, ls, true, sessionId)).map((r) => r.id);
  const refundPreview = (f: Family, registrationId: string) => apiResponse(f.parent.api.v1.receipts['refund-preview'].$get({ query: { registrationId } }));
  /** What the line's refunds credited to the family's escrow. */
  const credited = async (registrationId: string) =>
    money((await one<{ s: string }>(`select coalesce(sum(amount), 0) as s from escrow_transaction where related_registration_id = $1 and type = 'credit'`, [registrationId])).s);
  const entriesOfLine = (lineId: string) => sql<{ id: string; entry_code: string; status: string; withdrawn_with_line: boolean; withdrawal_reason: string | null; submitted_at: string | null }>(
    `select id, entry_code, status, withdrawn_with_line, withdrawal_reason, submitted_at from exam_entry where registration_id = $1 order by created_at, entry_code`, [lineId]);
  /** Every entry of the line withdrawn with it for this reason (made again if it is paid again), each audited (the review of 093dbd1, item 1). */
  const withdrawnWithLine = async (lineId: string, reason: string) => {
    const rows = await entriesOfLine(lineId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => [r.status, r.withdrawn_with_line, r.withdrawal_reason])).toEqual(rows.map(() => ['withdrawn', true, reason]));
    await audited(rows.map((r) => r.id), rows.map(() => 'EXAM_ENTRY_WITHDRAWN'));
    return rows;
  };

  // The catalogue and offers this file adds to the world's session.
  let pMaths: string, itemP1: string, itemP2: string;      // one subject, an item per unit, each with its own teacher
  let alSyllabus: string, optAX: string, optBY: string, itemAL: string, itemCF: string, itemWholeAL: string;
  let asSyllabus: string;

  beforeAll(async () => {
    w = await examWorld('xw');
    coord = w.coordinator;
    T = w.T;
    await apiResponse(w.adm.api.v1.settings[':key'].$put({
      param: { key: 'exams.centres' },
      json: { value: { cambridge: { centreNumber: 'EG123', route: 'direct' }, pearson_edexcel: { centreNumber: '91234', route: 'direct' } }, reason: 'the centre numbers (scenario)' },
    }));
    for (const k of ['d', 'e', 'f', 'g', 'cf1', 'cf2', 'al', 'rt', 'rj', 'ci']) fam[k] = await onboard(w.officer, `x-xw-${k}`, 12);

    // Mathematics as the rework shapes it: one subject, P1 and P2 each an item with its own teacher.
    pMaths = await subject('MU', 'Mathematics units', 'pearson_edexcel', 'as_level');
    await apiResponse(coord.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: pMaths }, json: { boardCode: 'pearson_edexcel', qualificationId: w.catalogue.pAward, unitIds: [] } }));
    await fee(w.series.pearsonJan, 'unit', w.catalogue.pu2);
    [itemP1, itemP2] = await offer(w.sessionId, pMaths, 1000, [w.teacherId, w.teacher2Id], [
      { label: 'P1', kind: 'unit', enters: { kind: 'units', unitIds: [w.catalogue.pu1] }, boardSeriesId: w.series.pearsonJan, availability: 'open', requiredInSeries: false, teachers: [{ teacherId: w.teacherId, mode: 'in_school' }] },
      { label: 'P2', kind: 'unit', enters: { kind: 'units', unitIds: [w.catalogue.pu2] }, boardSeriesId: w.series.pearsonJan, availability: 'open', requiredInSeries: false, teachers: [{ teacherId: w.teacher2Id, mode: 'in_school' }] },
    ]) as [string, string];

    // A Cambridge A Level syllabus: AS components 1-2, A2 components 4-5; A Level (AX) and A2 carried forward (BY).
    const cat = coord.api.v1.catalogue;
    const comp = async (n: string, unitLevel: 'as' | 'a2') => (await apiResponse(cat.units.$post({ json: { boardCode: 'cambridge', code: `${T}9700/${n}`, shortCode: `Paper ${n}`, title: `Paper ${n}`, unitLevel, kind: 'component' } }))).id;
    const [c1, c2, c4, c5] = [await comp('12', 'as'), await comp('22', 'as'), await comp('42', 'a2'), await comp('52', 'a2')];
    alSyllabus = (await apiResponse(cat.qualifications.$post({ json: { boardCode: 'cambridge', code: `${T}9700`, title: `Biology ${T} (A Level)`, level: 'a_level', suite: 'Cambridge International AS & A Level', subjectArea: `Biology ${T}`, entryMethod: 'syllabus_option' } }))).id;
    await apiResponse(cat.qualifications[':id'].units.$put({ param: { id: alSyllabus }, json: { units: [c1, c2, c4, c5].map((unitId) => ({ unitId, requirement: 'required' as const })) } }));
    optAX = (await apiResponse(cat.qualifications[':id'].options.$post({ param: { id: alSyllabus }, json: { code: 'AX', label: 'A Level in one series', unitIds: [c1, c2, c4, c5] } }))).id;
    optBY = (await apiResponse(cat.qualifications[':id'].options.$post({ param: { id: alSyllabus }, json: { code: 'BY', label: 'A2, AS carried forward', unitIds: [c4, c5], carryForward: true } }))).id;
    asSyllabus = (await apiResponse(cat.qualifications.$post({ json: { boardCode: 'cambridge', code: `${T}9700`, title: `Biology ${T} (AS)`, level: 'as_level', suite: 'Cambridge International AS & A Level', subjectArea: `Biology ${T}`, entryMethod: 'syllabus_option' } }))).id;
    const al = await subject('BIOAL', 'Biology A Level', 'cambridge', 'a_level');
    await apiResponse(cat.registrable[':subjectId'].$put({ param: { subjectId: al }, json: { boardCode: 'cambridge', qualificationId: alSyllabus, unitIds: [] } }));
    await fee(w.series.cambridgeNov, 'option', optAX, 900);
    await fee(w.series.cambridgeNov, 'option', optBY, 600);
    await fee(w.series.cambridgeNov, 'qualification', alSyllabus, 900);
    [itemAL, itemCF] = await offer(w.sessionId, al, 1000, [w.teacherId], [
      { label: 'A Level', kind: 'route', enters: { kind: 'option', optionId: optAX }, boardSeriesId: w.series.cambridgeNov, availability: 'open', requiredInSeries: false, exclusiveGroup: 'route' },
      { label: 'A2, carry forward', kind: 'route', enters: { kind: 'option', optionId: optBY }, boardSeriesId: w.series.cambridgeNov, availability: 'open', requiredInSeries: false, exclusiveGroup: 'route' },
    ]) as [string, string];
    const wholeAl = await subject('BIOALW', 'Biology A Level (whole)', 'cambridge', 'a_level');
    [itemWholeAL] = await offer(w.sessionId, wholeAl, 1000, [w.teacherId], [
      { label: 'Whole subject', kind: 'whole', enters: { kind: 'award', qualificationId: alSyllabus }, boardSeriesId: w.series.cambridgeNov, availability: 'open', requiredInSeries: false },
    ]) as [string];
  }, 180_000);

  afterAll(async () => {
    await apiResponse(w.adm.api.v1.settings[':key'].$put({ param: { key: 'verification.unverifiedAtDeadline' }, json: { value: 'enter_as_declared', reason: 'F4 scenario done' } })).catch(() => undefined);
    await w.close();
  });

  describe("what a line's item enters (lineItemsFor)", () => {
    it('two items of one subject are two lines, each entered as its own unit with its own line', async () => {
      const [p1, p2] = await reserve(fam.d!, [{ offerItemId: itemP1, attempt: 'first', mode: 'in_school', teacherId: w.teacherId }, { offerItemId: itemP2, attempt: 'first', mode: 'in_school', teacherId: w.teacher2Id }]);
      lines.dP1 = p1!; lines.dP2 = p2!;
      const preview = await derive(w.series.pearsonJan, fam.d!.studentId, false);
      expect(preview.rows.map((r) => [r.registrationId, r.item?.label, r.entries.map((e) => `${e.kind}:${e.entryCode}`)])).toEqual([
        [p1, 'P1', [`unit:${T}WMA11`]],
        [p2, 'P2', [`unit:${T}WMA12`]],
      ]);
      await derive(w.series.pearsonJan, fam.d!.studentId);
      expect((await entriesOf(w.series.pearsonJan, fam.d!.studentId)).map((e) => [e.entry_code, e.registration_id])).toEqual([[`${T}WMA11`, p1], [`${T}WMA12`, p2]]);
    });

    it("the forecast's teacher is the one who teaches that unit (teacherOf with the unit): the P1 teacher gives P1's, not P2's", async () => {
      // Enrolment from the lines: one per unit, each with its line's teacher.
      await apiResponse(coord.api.v1.enrolments.bulk.$post({ json: { academicYearId: w.yearId!, source: 'registrations', studentIds: [fam.d!.studentId], commit: true } }));
      const units = await sql<{ unit: string; teacher: string }>(`select u.code as unit, t.id as teacher from course_enrolment ce join exam_unit u on u.id = ce.unit_id join teacher t on t.id = ce.teacher_id
        where ce.student_id = $1 and ce.ended_on is null order by u.code`, [fam.d!.studentId]);
      expect(units).toEqual([{ unit: `${T}WMA11`, teacher: w.teacherId }, { unit: `${T}WMA12`, teacher: w.teacher2Id }]);
      const [e1, e2] = await entriesOf(w.series.pearsonJan, fam.d!.studentId);
      expect(await apiResponse(w.teacher.api.v1.exams.entries[':id'].forecast.$put({ param: { id: e1!.id }, json: { grade: 'b' } }))).toMatchObject({ forecastGrade: 'b' });
      expect(await refused(w.teacher.api.v1.exams.entries[':id'].forecast.$put({ param: { id: e2!.id }, json: { grade: 'c' } })))
        .toEqual({ status: 403, error: "Only the candidate's teacher for this subject, or the coordinator, gives this forecast" });
      expect(await apiResponse(w.teacher2.api.v1.exams.entries[':id'].forecast.$put({ param: { id: e2!.id }, json: { grade: 'c' } }))).toMatchObject({ forecastGrade: 'c' });
      // Each teacher's own list holds only their unit (Pearson asks for forecasts here for the scenario).
      await apiResponse(coord.api.v1.exams['board-rules'][':boardCode'].$put({ param: { boardCode: 'pearson_edexcel' }, json: { forecastRequired: true, reason: 'scenario: forecasts per unit' } }));
      try {
        const mine = await apiResponse(w.teacher.api.v1.exams.forecasts.$get({ query: { boardSeriesId: w.series.pearsonJan } }));
        expect(mine.filter((m) => m.studentId === fam.d!.studentId).map((m) => m.entryCode)).toEqual([`${T}WMA11`]);
        const theirs = await apiResponse(w.teacher2.api.v1.exams.forecasts.$get({ query: { boardSeriesId: w.series.pearsonJan } }));
        expect(theirs.filter((m) => m.studentId === fam.d!.studentId).map((m) => m.entryCode)).toEqual([`${T}WMA12`]);
      } finally {
        await apiResponse(coord.api.v1.exams['board-rules'][':boardCode'].$put({ param: { boardCode: 'pearson_edexcel' }, json: { forecastRequired: false, reason: 'scenario done' } }));
      }
    });

    it("a retake comes from the line's attempt; a rejected declaration is entered as a first entry", async () => {
      const [rt] = await reserve(fam.rt!, [retake(w.items.sc, { month: 'june', year: Y }, { teacherId: w.teacherId })]);
      const [rj] = await reserve(fam.rj!, [retake(w.items.sc, { month: 'june', year: Y }, { teacherId: w.teacherId })]);
      // The coordinator could not confirm the second family's sitting: the paid line stands, entered as a first entry (§3.5).
      expect(await apiResponse(coord.api.v1.registrations[':id']['verify-prior'].$post({ param: { id: rj! }, json: { outcome: 'rejected', reason: 'no such sitting on the board statement' } })))
        .toMatchObject({ outcome: 'rejected', effect: 'stands' });
      expect((await lineOf(rj!)).declaration_rejected).toBe(true);
      await derive(w.series.cambridgeNov, fam.rt!.studentId);
      await derive(w.series.cambridgeNov, fam.rj!.studentId);
      expect((await entriesOf(w.series.cambridgeNov, fam.rt!.studentId)).map((e) => [e.entry_code, e.is_retake, e.retake_source, e.registration_id]))
        .toEqual([[`${T}97`, true, 'registration', rt]]);
      expect((await entriesOf(w.series.cambridgeNov, fam.rj!.studentId)).map((e) => [e.entry_code, e.is_retake, e.retake_source, e.registration_id]))
        .toEqual([[`${T}97`, false, null, rj]]);
      const list = await entryList(w.series.cambridgeNov);
      expect(list.rows.find((r) => r.studentId === fam.rt!.studentId)!.values).toMatchObject({ retake: 'Y' });
      expect(list.rows.find((r) => r.studentId === fam.rj!.studentId)!.values).toMatchObject({ retake: 'N' });
    });
  });

  describe('carry forward from the line\'s verified prior sitting', () => {
    it('the carry-forward period is the board\'s own column (exam_board), edited on the board rules and read by the line rules', async () => {
      await apiResponse(coord.api.v1.exams['board-rules'][':boardCode'].$put({ param: { boardCode: 'cambridge' }, json: { carryForwardMonths: 4, reason: 'scenario: a shorter period' } }));
      expect((await one<{ m: number }>(`select carry_forward_months as m from exam_board where code = 'cambridge'`)).m).toBe(4);
      const rules = await apiResponse(coord.api.v1.exams['board-rules'].$get());
      expect(rules.find((r) => r.boardCode === 'cambridge')).toMatchObject({ carryForwardMonths: 4 });
      // June to November is five months: outside a four-month period, so the line rules refuse it.
      const r = await refused(w.officer.api.v1.registrations.desk.$post({ json: { studentId: fam.cf1!.studentId, sessionId: w.sessionId, lines: [carry(itemCF, { month: 'june', year: Y })], consent: CONSENT } }));
      expect(r.status).toBe(400);
      expect(r.error).toContain("carry-forward period (4 months)");
      await apiResponse(coord.api.v1.exams['board-rules'][':boardCode'].$put({ param: { boardCode: 'cambridge' }, json: { carryForwardMonths: 13, reason: 'scenario done: back to 13' } }));
      expect((await one<{ m: number }>(`select carry_forward_months as m from exam_board where code = 'cambridge'`)).m).toBe(13);
      const audit = await one<{ p: Record<string, unknown>; n: Record<string, unknown> }>(
        `select previous_data as p, new_data as n from audit_log where entity_id = 'cambridge' and action = 'EXAM_BOARD_RULE_UPDATED' order by created_at desc limit 1`);
      expect(audit).toMatchObject({ p: { carryForwardMonths: 4 }, n: { carryForwardMonths: 13 } });
    });

    it('a sitting at another centre, verified with its centre and candidate number, is carried forward with them', async () => {
      const [l] = await reserve(fam.cf1!, [carry(itemCF, { month: 'june', year: Y })]);
      lines.cf1 = l!;
      await apiResponse(coord.api.v1.registrations[':id']['verify-prior'].$post({ param: { id: l! }, json: { outcome: 'verified', prevCentre: 'EG999', prevCandidateNumber: '0452', reason: "seen on the other centre's statement" } }));
      await derive(w.series.cambridgeNov, fam.cf1!.studentId);
      expect((await entriesOf(w.series.cambridgeNov, fam.cf1!.studentId)).map((e) => [e.entry_code, e.option_code, e.carry_forward, e.cf_from_month, e.cf_from_year, e.cf_centre_number, e.cf_candidate_number]))
        .toEqual([[`${T}9700`, 'BY', 'confirmed', 'june', Y, 'EG999', '0452']]);
      const row = (await entryList(w.series.cambridgeNov)).rows.find((r) => r.studentId === fam.cf1!.studentId)!;
      expect(row.values).toMatchObject({ syllabusCode: `${T}9700`, optionCode: 'BY', previousCentre: 'EG999', previousCandidate: '0452', carryForwardFrom: `June ${Y}` });
      expect(row.problems).not.toContain('carry_forward_to_confirm');
      expect(row.problems).not.toContain('prior_sitting_unverified');
    });

    it("a sitting here, verified without another centre, is carried forward with the school's centre and the candidate's number then", async () => {
      const [l] = await reserve(fam.cf2!, [carry(itemCF, { month: 'june', year: Y })]);
      const june = (await one<{ s: string }>(`select prior_sitting_series_id as s from registration where id = $1`, [l!])).s;
      await apiResponse(coord.api.v1.exams['candidate-numbers'].$put({ json: { studentId: fam.cf2!.studentId, boardSeriesId: june, number: '0777', reason: 'the number of that sitting (scenario)' } }));
      await apiResponse(coord.api.v1.registrations[':id']['verify-prior'].$post({ param: { id: l! }, json: { outcome: 'verified', reason: 'our own June results' } }));
      await derive(w.series.cambridgeNov, fam.cf2!.studentId);
      expect((await entriesOf(w.series.cambridgeNov, fam.cf2!.studentId)).map((e) => [e.carry_forward, e.cf_centre_number, e.cf_candidate_number]))
        .toEqual([['confirmed', 'EG123', '0777']]);
    });

    it('a line with no prior sitting of its own keeps the suggest-and-confirm flow (exams.carryForward): an A Level after the AS here', async () => {
      // The candidate's AS entry here in June (the declared June series has no dates: nothing cuts it off).
      const june = (await one<{ s: string }>(`select prior_sitting_series_id as s from registration where id = $1`, [lines.cf1!])).s;
      await apiResponse(coord.api.v1.exams.entries.$post({ json: { studentId: fam.al!.studentId, boardSeriesId: june, qualificationId: asSyllabus } }));
      await apiResponse(coord.api.v1.exams['candidate-numbers'].$put({ json: { studentId: fam.al!.studentId, boardSeriesId: june, number: '0778', reason: 'the number of that sitting (scenario)' } }));
      await reserve(fam.al!, [{ offerItemId: itemWholeAL, attempt: 'first', mode: 'in_school' }]);
      await derive(w.series.cambridgeNov, fam.al!.studentId);
      expect((await entriesOf(w.series.cambridgeNov, fam.al!.studentId)).map((e) => [e.entry_code, e.carry_forward, e.cf_from_month, e.cf_from_year, e.cf_centre_number, e.cf_candidate_number]))
        .toEqual([[`${T}9700`, 'suggested', 'june', Y, 'EG123', '0778']]);
      expect((await entryList(w.series.cambridgeNov)).rows.find((r) => r.studentId === fam.al!.studentId)!.problems).toContain('carry_forward_to_confirm');
      // The setting is the coordinator's answer (Q-02): manual, and nothing is suggested.
      await apiResponse(w.adm.api.v1.settings[':key'].$put({ param: { key: 'exams.carryForward' }, json: { value: 'manual', reason: 'scenario: staff enter it' } }));
      try {
        const again = await derive(w.series.cambridgeNov, fam.al!.studentId, false);
        expect(again.rows[0]!.entries.map((e) => e.carryForward)).toEqual(['none']);
      } finally {
        await apiResponse(w.adm.api.v1.settings[':key'].$put({ param: { key: 'exams.carryForward' }, json: { value: 'suggest', reason: 'scenario done' } }));
      }
    });
  });

  describe('a declared sitting not verified: listed by the entry check, entered as declared or held', () => {
    it('entered as declared (the default): the check lists it as declared, unverified', async () => {
      const [e] = await reserve(fam.e!, [retake(w.items.sp1, { month: 'june', year: Y })]);
      const [f] = await reserve(fam.f!, [retake(itemP2, { month: 'june', year: Y }, { teacherId: w.teacher2Id })]);
      lines.e = e!; lines.f = f!;
      await derive(w.series.pearsonJan, fam.e!.studentId);
      await derive(w.series.pearsonJan, fam.f!.studentId);
      const list = await entryList(w.series.pearsonJan);
      expect(list.rows.find((r) => r.studentId === fam.e!.studentId)!.problems).toContain('prior_sitting_unverified');
      expect(list.rows.find((r) => r.studentId === fam.f!.studentId)!.problems).toContain('prior_sitting_unverified');
      expect(list.summary.prior_sitting_unverified).toBe(2);
      expect(list.rows.find((r) => r.studentId === fam.f!.studentId)!.sessionId).toBe(w.sessionId);
    });

    it('held when the school holds unverified sittings: not derived, not sent; verified, it goes', async () => {
      await apiResponse(w.adm.api.v1.settings[':key'].$put({ param: { key: 'verification.unverifiedAtDeadline' }, json: { value: 'hold', reason: 'scenario: the school holds unverified sittings (Q-22)' } }));
      try {
        const list = await entryList(w.series.pearsonJan);
        const fRow = list.rows.find((r) => r.studentId === fam.f!.studentId)!;
        expect(fRow.problems).toContain('prior_sitting_held');
        expect(fRow.problems).not.toContain('prior_sitting_unverified');
        const preview = await derive(w.series.pearsonJan, fam.f!.studentId, false);
        expect(preview.rows.map((r) => [r.outcome, r.note])).toEqual([['held', `Pearson Edexcel June ${Y} was declared and is not verified yet: the school holds such lines until they are (the To verify tab)`]]);
        const [fe] = await entriesOf(w.series.pearsonJan, fam.f!.studentId);
        expect(await refused(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [fe!.id] } })))
          .toEqual({ status: 409, error: `${T}WMA12 follows a declared earlier sitting the school has not verified: it is held until it is (the To verify tab), and not sent` });
        expect((await one<{ status: string }>(`select status from exam_entry where id = $1`, [fe!.id])).status).toBe('draft');
        // The coordinator verifies it: it goes.
        await apiResponse(coord.api.v1.registrations[':id']['verify-prior'].$post({ param: { id: lines.f! }, json: { outcome: 'verified', reason: 'the board statement shows it' } }));
        expect(await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [fe!.id] } }))).toEqual({ submitted: 1, skipped: 0 });
      } finally {
        await apiResponse(w.adm.api.v1.settings[':key'].$put({ param: { key: 'verification.unverifiedAtDeadline' }, json: { value: 'enter_as_declared', reason: 'scenario done' } }));
      }
    });

    it("the board's results verify a declared sitting (step B's answer, by the importer); a sitting with no result is left to the coordinator", async () => {
      const june = (await one<{ s: string }>(`select prior_sitting_series_id as s from registration where id = $1`, [lines.e!])).s;
      // Another declared sitting there with no result: family g's P1, declared June too.
      await apiResponse(coord.api.v1.exams.candidates[':studentId'].$put({ param: { studentId: fam.e!.studentId }, json: { uci: '91234B260555E' } }));
      const [gLine] = await reserve(fam.g!, [retake(w.items.sp1, { month: 'june', year: Y })]);
      const done = await apiResponse(coord.api.v1.exams.results.import.$post({ json: {
        boardSeriesId: june, commit: true, source: { text: `UCI,Unit Code,Grade,UMS\n91234B260555E,${T}WMA11,D,48`, name: 'June results' },
      } }));
      expect(done.sittingsVerified).toEqual([{ registrationId: lines.e, studentId: fam.e!.studentId, code: `${T}WMA11`, grade: 'D' }]);
      expect((await lineOf(lines.e!)).outcome).toBe('verified');
      expect((await lineOf(gLine!)).outcome).toBeNull();
      const row = await one<{ user_id: string; new_data: { outcome: string; reason: string; evidence: string } }>(
        `select user_id, new_data from audit_log where entity_id = $1 and action = 'PRIOR_SITTING_VERIFIED'`, [lines.e!]);
      expect(row.user_id).toBe(coord.id);
      expect(row.new_data).toMatchObject({ outcome: 'verified', evidence: `The board's results for Pearson Edexcel June ${Y}: ${T}WMA11 graded D` });
      // The To verify tab no longer lists it; the entry check no longer flags it.
      const toVerify = await apiResponse(coord.api.v1.sessions[':id']['to-verify'].$get({ param: { id: w.sessionId }, query: { show: 'awaiting' } }));
      expect(toVerify.lines.map((l) => l.id)).not.toContain(lines.e);
      expect(toVerify.lines.map((l) => l.id)).toContain(gLine);
      expect((await entryList(w.series.pearsonJan)).rows.find((r) => r.studentId === fam.e!.studentId)!.problems).not.toContain('prior_sitting_unverified');
      // The same file again verifies nothing more and changes nothing.
      const again = await apiResponse(coord.api.v1.exams.results.import.$post({ json: {
        boardSeriesId: june, commit: true, source: { text: `UCI,Unit Code,Grade,UMS\n91234B260555E,${T}WMA11,D,48`, name: 'June results again' },
      } }));
      expect(again.sittingsVerified).toEqual([]);
    });
  });

  describe('a cash-in becomes its award entry, carrying its charge', () => {
    let lineCharge: string, studentCharge: string;
    beforeAll(async () => {
      await apiResponse(w.finadmin.api.v1['board-services'].fees.$put({ json: {
        boardSeriesId: w.series.pearsonJan, rows: [{ boardServiceId: 'svc-pearson-ci', level: 'as_a_level', amount: 700, provisional: false }], reason: 'the cash-in fee (scenario)',
      } }));
    });

    it('accepted but not paid: listed as "cash-in awaiting payment", not entered', async () => {
      // On family A's P1 line: the line's item says the award (the Mathematics IAL award).
      const c = await apiResponse(w.officer.api.v1.charges.$post({ json: { studentId: w.families.a.studentId, kind: 'cash_in', boardServiceId: 'svc-pearson-ci', registrationId: w.regs.a[w.subjects.sp1]! } }));
      lineCharge = c.id;
      expect(c).toMatchObject({ status: 'pending_payment', amount: 700 });
      const preview = await derive(w.series.pearsonJan, w.families.a.studentId, false);
      const row = preview.rows.find((r) => r.chargeId === c.id)!;
      expect(row).toMatchObject({ outcome: 'awaiting_payment', entries: [], note: `Cash-in awaiting payment: Cash-in (claim the award) — Pearson Edexcel January ${Y + 1} (exams xw) (EGP 700.00) — entered once it is paid` });
      await derive(w.series.pearsonJan, w.families.a.studentId);
      expect(await sql(`select 1 from exam_entry where charge_id = $1`, [c.id])).toHaveLength(0);
      // By hand too: refused until it is paid.
      expect(await refused(coord.api.v1.exams.entries.$post({ json: { studentId: w.families.a.studentId, boardSeriesId: w.series.pearsonJan, qualificationId: w.catalogue.pAward, chargeId: c.id } })))
        .toEqual({ status: 409, error: `Cash-in awaiting payment: ${c.description} is entered once it is paid` });
    });

    it('paid: derived as the award its line\'s item enters, with exam_entry.charge_id', async () => {
      await apiResponse(w.officer.api.v1.registrations.desk.collect.$post({ json: { studentId: w.families.a.studentId, chargeIds: [lineCharge], instrumentUsed: 'cash' } }));
      const done = await derive(w.series.pearsonJan, w.families.a.studentId);
      expect(done.rows.find((r) => r.chargeId === lineCharge)).toMatchObject({ outcome: 'ready', registrationId: null });
      const award = (await entriesOf(w.series.pearsonJan, w.families.a.studentId)).filter((e) => e.kind === 'award');
      expect(award.map((e) => [e.entry_code, e.charge_id, e.registration_id])).toEqual([[`${T}XMA01`, lineCharge, null]]);
      const list = await entryList(w.series.pearsonJan);
      const row = list.rows.find((r) => r.entryId === award[0]!.id)!;
      expect(row).toMatchObject({ chargeId: lineCharge, kind: 'award', values: { entryCode: `${T}XMA01` } });
      expect(row.problems).not.toContain('cash_in_not_paid');
      // A second derivation makes nothing; the charge's entry is one (the index), by hand too.
      expect((await derive(w.series.pearsonJan, w.families.a.studentId)).created).toBe(0);
      expect(await refused(coord.api.v1.exams.entries.$post({ json: { studentId: w.families.a.studentId, boardSeriesId: w.series.pearsonJan, qualificationId: w.catalogue.pAward, chargeId: lineCharge } })))
        .toMatchObject({ status: 409 });
    });

    it('a cash-in that names no line: the coordinator adds its award by hand, with the charge', async () => {
      const c = await apiResponse(w.officer.api.v1.charges.$post({ json: { studentId: fam.ci!.studentId, kind: 'cash_in', boardServiceId: 'svc-pearson-ci', boardSeriesId: w.series.pearsonJan, level: 'as_a_level' } }));
      studentCharge = c.id;
      await apiResponse(w.officer.api.v1.registrations.desk.collect.$post({ json: { studentId: fam.ci!.studentId, chargeIds: [c.id], instrumentUsed: 'cash' } }));
      const preview = await derive(w.series.pearsonJan, fam.ci!.studentId, false);
      expect(preview.rows.map((r) => [r.chargeId, r.outcome, r.note])).toEqual([[c.id, 'choose_award', `${c.description}: its line does not say which award it cashes in — add the award entry by hand with this cash-in`]]);
      const list = await entryList(w.series.pearsonJan);
      expect(list.cashInsToEnter.map((x) => x.chargeId)).toContain(c.id);
      const e = await apiResponse(coord.api.v1.exams.entries.$post({ json: { studentId: fam.ci!.studentId, boardSeriesId: w.series.pearsonJan, qualificationId: w.catalogue.pAward, chargeId: c.id } }));
      expect(e).toMatchObject({ kind: 'award', chargeId: c.id, entryCode: `${T}XMA01` });
      await audited([e.id], ['EXAM_ENTRY_CREATED']);
      expect((await entryList(w.series.pearsonJan)).cashInsToEnter.map((x) => x.chargeId)).not.toContain(c.id);
      // One cash-in is one award entry: the same charge on another award is refused (the database's index).
      const other = await apiResponse(coord.api.v1.catalogue.qualifications.$post({ json: {
        boardCode: 'pearson_edexcel', code: `${T}YMA01`, title: `Mathematics ${T} (A Level)`, level: 'a_level', suite: 'International Advanced Level', subjectArea: `Mathematics ${T}`, entryMethod: 'units_cash_in',
      } }));
      expect(await refused(coord.api.v1.exams.entries.$post({ json: { studentId: fam.ci!.studentId, boardSeriesId: w.series.pearsonJan, qualificationId: other.id, chargeId: c.id } })))
        .toEqual({ status: 409, error: 'This cash-in is already entered' });
      // Another student's cash-in is refused on this candidate.
      expect((await refused(coord.api.v1.exams.entries.$post({ json: { studentId: fam.ci!.studentId, boardSeriesId: w.series.pearsonJan, qualificationId: w.catalogue.pAward, chargeId: lineCharge } }))).status).toBe(400);
    });

    it('a cash-in whose payment is reversed is flagged on its entry (cash_in_not_paid)', async () => {
      const pay = (await one<{ id: string }>(`select p.id from payment p join payment_charge pc on pc.payment_id = p.id where pc.charge_id = $1 and p.status = 'completed'`, [studentCharge])).id;
      await apiResponse(w.finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: pay }, json: { reason: 'collected twice by mistake', moneyReturned: true } }));
      const row = (await entryList(w.series.pearsonJan)).rows.find((r) => r.chargeId === studentCharge)!;
      expect(row.problems).toContain('cash_in_not_paid');
    });

    const paymentOf = async (chargeId: string) =>
      (await one<{ id: string }>(`select p.id from payment p join payment_charge pc on pc.payment_id = p.id where pc.charge_id = $1 and p.status = 'completed'`, [chargeId])).id;

    it("a paid cash-in whose award a whole-award line already entered is linked to that entry, no longer listed to enter; reversed, it is flagged and not sent (the review of 093dbd1, items 6 and 1)", async () => {
      const b = w.families.b;
      const line = w.regs.b[w.subjects.spx]!;
      await derive(w.series.pearsonJan, b.studentId);
      const award = (await entriesOf(w.series.pearsonJan, b.studentId)).find((e) => e.kind === 'award')!;
      expect([award.entry_code, award.registration_id, award.charge_id]).toEqual([`${T}XMA01`, line, null]);
      const c = await apiResponse(w.officer.api.v1.charges.$post({ json: { studentId: b.studentId, kind: 'cash_in', boardServiceId: 'svc-pearson-ci', registrationId: line } }));
      await apiResponse(w.officer.api.v1.registrations.desk.collect.$post({ json: { studentId: b.studentId, chargeIds: [c.id], instrumentUsed: 'cash' } }));
      expect((await entryList(w.series.pearsonJan)).cashInsToEnter.find((x) => x.chargeId === c.id)).toMatchObject({ awardEntered: true });
      const preview = await derive(w.series.pearsonJan, b.studentId, false);
      const row = preview.rows.find((r) => r.chargeId === c.id)!;
      expect(row).toMatchObject({ outcome: 'ready', note: 'The award is already entered: this cash-in is linked to it' });
      expect(row.entries.map((e) => [e.state, e.existingEntryId])).toEqual([['link', award.id]]);
      expect(preview.summary).toMatchObject({ newEntries: 0, updates: 1 });
      expect(await derive(w.series.pearsonJan, b.studentId)).toMatchObject({ created: 0, updated: 1 });
      expect((await one<{ c: string | null }>(`select charge_id as c from exam_entry where id = $1`, [award.id])).c).toBe(c.id);
      expect((await entryList(w.series.pearsonJan)).cashInsToEnter.map((x) => x.chargeId)).not.toContain(c.id);
      expect((await one<{ n: Record<string, unknown> }>(`select new_data as n from audit_log where entity_id = $1 and action = 'EXAM_ENTRY_UPDATED'`, [award.id])).n)
        .toMatchObject({ chargeId: c.id, reason: 'linked to the paid cash-in of its award' });
      // Its payment reversed: the award entry is flagged, and "mark as sent" refuses it, naming it.
      await apiResponse(w.finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: await paymentOf(c.id) }, json: { reason: 'collected twice by mistake', moneyReturned: true } }));
      expect((await entryList(w.series.pearsonJan)).rows.find((r) => r.entryId === award.id)!.problems).toContain('cash_in_not_paid');
      expect(await refused(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [award.id] } })))
        .toEqual({ status: 409, error: `${T}XMA01 Mathematics ${T} for Student x-xw-b is not sent: its cash-in is not paid — withdraw the entry` });
      expect((await one<{ status: string }>(`select status from exam_entry where id = $1`, [award.id])).status).toBe('draft');
    });

    it('a paid cash-in that names no line, whose award was entered by hand without it, is linked to that entry', async () => {
      const ch = await onboard(w.officer, 'x-xw-ch', 12);
      const e = await apiResponse(coord.api.v1.exams.entries.$post({ json: { studentId: ch.studentId, boardSeriesId: w.series.pearsonJan, qualificationId: w.catalogue.pAward } }));
      expect(e.chargeId).toBeNull();
      const c = await apiResponse(w.officer.api.v1.charges.$post({ json: { studentId: ch.studentId, kind: 'cash_in', boardServiceId: 'svc-pearson-ci', boardSeriesId: w.series.pearsonJan, level: 'as_a_level' } }));
      await apiResponse(w.officer.api.v1.registrations.desk.collect.$post({ json: { studentId: ch.studentId, chargeIds: [c.id], instrumentUsed: 'cash' } }));
      const preview = await derive(w.series.pearsonJan, ch.studentId, false);
      expect(preview.rows.map((r) => [r.chargeId, r.outcome, r.entries.map((x) => [x.state, x.existingEntryId])])).toEqual([[c.id, 'ready', [['link', e.id]]]]);
      expect(await derive(w.series.pearsonJan, ch.studentId)).toMatchObject({ created: 0, updated: 1 });
      expect((await one<{ c: string | null }>(`select charge_id as c from exam_entry where id = $1`, [e.id])).c).toBe(c.id);
      expect((await entryList(w.series.pearsonJan)).cashInsToEnter.map((x) => x.chargeId)).not.toContain(c.id);
    });
  });

  describe('"mark as sent" is what makes a line\'s board fee sent for its refund (step C\'s refundFor)', () => {
    let refunds: string, itemPair: string;
    beforeAll(async () => {
      // A session of its own whose course started 15 days ago: week 3 of the winter policy (50% of the course fee).
      refunds = (await apiResponse(w.adm.api.v1.sessions.$post({ json: {
        type: 'winter', year: Y, label: 'exams xw refunds', startDate: new Date(Date.now() - DAY).toISOString(), endDate: new Date(Date.now() + 3 * DAY).toISOString(),
        courseStartsOn: cairoDate(new Date(Date.now() - 15 * DAY)), paymentDueAt: new Date(Date.now() + 3 * DAY).toISOString(),
      } })))!.id;
      const pair = await subject('PAIR', 'Pure units', 'pearson_edexcel', 'as_level');
      [itemPair] = await offer(refunds, pair, 1000, [w.teacherId], [
        { label: 'P1 and P2', kind: 'unit', enters: { kind: 'units', unitIds: [w.catalogue.pu1, w.catalogue.pu2] }, boardSeriesId: w.series.pearsonJan, availability: 'open', requiredInSeries: false },
      ]) as [string];
      fam.r1 = await onboard(w.officer, 'x-xw-r1', 12);
      fam.r2 = await onboard(w.officer, 'x-xw-r2', 12);
      lines.r1 = (await reserve(fam.r1, [{ offerItemId: itemPair, attempt: 'first', mode: 'in_school' }], refunds))[0]!;
      lines.r2 = (await reserve(fam.r2, [{ offerItemId: itemPair, attempt: 'first', mode: 'in_school' }], refunds))[0]!;
      await derive(w.series.pearsonJan, fam.r1.studentId);
      await derive(w.series.pearsonJan, fam.r2.studentId);
    });
    const preview = (f: Family, registrationId: string) => apiResponse(f.parent.api.v1.receipts['refund-preview'].$get({ query: { registrationId } }));

    it('a two-unit line with one unit sent: the board fee stays, the course part by the policy; the preview names what was sent and when', async () => {
      const before = await preview(fam.r1!, lines.r1!);
      expect(before).toMatchObject({ fullPrice: 2000, percentage: 50, coursePart: 500, boardPart: 1000, amount: 1500, boardSent: false, sentEntries: [] });
      expect(before.boardNote).toBe('The board fee comes back: the entry has not been sent to the board.');
      const [u1] = await entriesOf(w.series.pearsonJan, fam.r1!.studentId);
      await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [u1!.id] } }));
      const sentAt = new Date((await one<{ at: string }>(`select submitted_at as at from exam_entry where id = $1`, [u1!.id])).at);
      const after = await preview(fam.r1!, lines.r1!);
      expect(after).toMatchObject({ percentage: 50, coursePart: 500, boardPart: 0, amount: 500, boardSent: true });
      expect(after.sentEntries.map((e) => e.entryCode)).toEqual([`${T}WMA11`]);
      expect(after.boardNote).toBe(`The board fee stays with the board: the school sent ${T}WMA11 Pure Mathematics 1 on ${dayWords(sentAt)} (${T}WMA12 not sent yet).`);
      // The family's drop refunds exactly that.
      const wallet = async () => money((await sql<{ b: string }>(`select balance as b from escrow where student_id = $1`, [fam.r1!.studentId]))[0]?.b ?? 0);
      const was = await wallet();
      const drop = await apiResponse(fam.r1!.parent.api.v1.registrations[':id'].drop.$post({ param: { id: lines.r1! }, json: { reason: 'refund check: one unit sent' } }));
      expect(drop).toMatchObject({ refundPercentage: 50, refundAmount: 500 });
      expect(await wallet()).toBe(was + 500);
      // Both units' entries are withdrawn with the line (the review of 093dbd1, item 1); the family
      // is told of the one that had gone to the board.
      expect((await withdrawnWithLine(lines.r1!, 'the family dropped the subject')).map((e) => [e.entry_code, !!e.submitted_at]))
        .toEqual([[`${T}WMA11`, true], [`${T}WMA12`, false]]);
      expect((await notified('parent.x-xw-r1@test.local', 'EXAM_ENTRY_WITHDRAWN', 1))[0]!.body)
        .toBe(`${T}WMA11 Pure Mathematics 1 was withdrawn from Pearson Edexcel January ${Y + 1} (exams xw): the family dropped the subject`);
    });

    it('the same line with none sent: the board fee comes back in full', async () => {
      const was = money((await sql<{ b: string }>(`select balance as b from escrow where student_id = $1`, [fam.r2!.studentId]))[0]?.b ?? 0);
      const p = await preview(fam.r2!, lines.r2!);
      expect(p).toMatchObject({ coursePart: 500, boardPart: 1000, amount: 1500, boardSent: false });
      const drop = await apiResponse(fam.r2!.parent.api.v1.registrations[':id'].drop.$post({ param: { id: lines.r2! }, json: { reason: 'refund check: none sent' } }));
      expect(drop).toMatchObject({ refundAmount: 1500 });
      expect(money((await one<{ b: string }>(`select balance as b from escrow where student_id = $1`, [fam.r2!.studentId])).b)).toBe(was + 1500);
      // Its drafts withdrawn with it: the family refunded 1,500 has nothing left to be sent (item 1).
      expect((await withdrawnWithLine(lines.r2!, 'the family dropped the subject')).map((e) => e.entry_code)).toEqual([`${T}WMA11`, `${T}WMA12`]);
      expect(await entriesOf(w.series.pearsonJan, fam.r2!.studentId)).toEqual([]);
      expect(await notificationsFor('parent.x-xw-r2@test.local', 'EXAM_ENTRY_WITHDRAWN')).toEqual([]);
    });
  });

  describe('every other path that ends a paid line withdraws its entries, in its own transaction (the review of 093dbd1, item 1)', () => {
    const pf: Record<string, Family> = {};
    const pl: Record<string, string> = {};
    beforeAll(async () => {
      for (const k of ['dq', 'sq', 'ds', 'rv', 'nl']) {
        pf[k] = await onboard(w.officer, `x-xw-${k}`, 12);
        pl[k] = (await reserve(pf[k]!, [w.first(w.items.sc, w.teacherId)]))[0]!;
        await derive(w.series.cambridgeNov, pf[k]!.studentId);
      }
      // Three of them sent to the board: those families are told when the entries are withdrawn.
      for (const k of ['dq', 'ds', 'rv']) {
        const [e] = await entriesOf(w.series.cambridgeNov, pf[k]!.studentId);
        await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [e!.id] } }));
      }
    });
    const cambridgeNov = `Cambridge International November ${Y} (exams xw)`;

    it("a drop request the parent approves: the line's entry is withdrawn with it, the family told", async () => {
      const cr = await apiResponse(pf.dq!.student.api.v1.registrations[':id']['request-drop'].$post({ param: { id: pl.dq! }, json: { reason: 'too much this term' } }));
      await apiResponse(pf.dq!.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: cr.id }, json: {} }));
      expect((await lineOf(pl.dq!)).status).toBe('dropped');
      const [e] = await withdrawnWithLine(pl.dq!, 'the family dropped the subject');
      expect(e!.submitted_at).not.toBeNull();
      expect((await notified('parent.x-xw-dq@test.local', 'EXAM_ENTRY_WITHDRAWN', 1))[0]!.body)
        .toBe(`${T}97 Biology ${T} was withdrawn from ${cambridgeNov}: the family dropped the subject`);
    });

    it("a swap request the parent approves: the old line's draft is withdrawn with it; the new line is the one to enter", async () => {
      const cr = await apiResponse(pf.sq!.student.api.v1.registrations[':id']['request-swap'].$post({
        param: { id: pl.sq! }, json: { line: w.first(w.items.spx), reason: 'prefers mathematics' },
      }));
      await apiResponse(pf.sq!.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: cr.id }, json: {} }));
      expect((await lineOf(pl.sq!)).status).toBe('dropped');
      await withdrawnWithLine(pl.sq!, 'the family swapped the subject');
      // A draft never went to the board: nobody is told of it.
      expect(await notificationsFor('parent.x-xw-sq@test.local', 'EXAM_ENTRY_WITHDRAWN')).toEqual([]);
      expect(await entriesOf(w.series.cambridgeNov, pf.sq!.studentId)).toEqual([]);
    });

    it("the family's direct swap: the old line's sent entry is withdrawn with it, the family told", async () => {
      await apiResponse(pf.ds!.parent.api.v1.registrations[':id'].swap.$post({ param: { id: pl.ds! }, json: { line: w.first(w.items.spx), reason: 'timetable clash' } }));
      expect((await lineOf(pl.ds!)).status).toBe('dropped');
      await withdrawnWithLine(pl.ds!, 'the family swapped the subject');
      expect((await notified('parent.x-xw-ds@test.local', 'EXAM_ENTRY_WITHDRAWN', 1))[0]!.body)
        .toBe(`${T}97 Biology ${T} was withdrawn from ${cambridgeNov}: the family swapped the subject`);
    });

    it('a payment reversal: the entry is withdrawn with the line; paid again, the next derivation makes it again', async () => {
      const pay = (await one<{ id: string }>(`select p.id from payment p join payment_registration pr on pr.payment_id = p.id where pr.registration_id = $1 and p.status = 'completed'`, [pl.rv!])).id;
      const r = await apiResponse(w.finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: pay }, json: { reason: 'bounced transfer', moneyReturned: true } }));
      expect(r).toEqual({ reversed: true, registrationsReverted: 1 });
      expect((await lineOf(pl.rv!)).status).toBe('pending_payment');
      const [old] = await withdrawnWithLine(pl.rv!, 'the payment was reversed: bounced transfer');
      expect((await notified('parent.x-xw-rv@test.local', 'EXAM_ENTRY_WITHDRAWN', 1))[0]!.body)
        .toBe(`${T}97 Biology ${T} was withdrawn from ${cambridgeNov}: the payment was reversed: bounced transfer`);
      // Unpaid, it is not derived; paid again, it is entered again (withdrawn with its line, not by the coordinator).
      expect((await derive(w.series.cambridgeNov, pf.rv!.studentId, false)).rows).toEqual([]);
      const again = await apiResponse(pf.rv!.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [pl.rv!], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
      await apiResponse(w.officer.api.v1.payments[':id'].confirm.$post({ param: { id: again.id! }, json: { instrumentUsed: 'cash' } }));
      expect((await lineOf(pl.rv!)).status).toBe('confirmed');
      expect(await derive(w.series.cambridgeNov, pf.rv!.studentId)).toMatchObject({ created: 1 });
      const live = await entriesOf(w.series.cambridgeNov, pf.rv!.studentId);
      expect(live.map((e) => [e.entry_code, e.status, e.registration_id])).toEqual([[`${T}97`, 'draft', pl.rv]]);
      expect(live[0]!.id).not.toBe(old!.id);
    });

    it("what staff set on an entry withdrawn with its line is carried to the entry made again after a second payment (the review of 54c225f, item 3)", async () => {
      const sr = await onboard(w.officer, 'x-xw-sr', 12);
      const [line] = await reserve(sr, [w.first(w.items.sc, w.teacherId)]) as [string];
      await derive(w.series.cambridgeNov, sr.studentId);
      const [e] = await entriesOf(w.series.cambridgeNov, sr.studentId);
      expect(e!.option_code).toBeNull();
      await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: e!.id }, json: { optionCode: 'B2' } }));
      const pay = (await one<{ id: string }>(`select p.id from payment p join payment_registration pr on pr.payment_id = p.id where pr.registration_id = $1 and p.status = 'completed'`, [line])).id;
      await apiResponse(w.finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: pay }, json: { reason: 'confirmed by mistake', moneyReturned: true } }));
      const again = await apiResponse(sr.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
      await apiResponse(w.officer.api.v1.payments[':id'].confirm.$post({ param: { id: again.id! }, json: { instrumentUsed: 'cash' } }));
      expect(await derive(w.series.cambridgeNov, sr.studentId)).toMatchObject({ created: 1 });
      const made = await one<{ id: string; option_code: string | null; staff_set: string[] }>(
        `select id, option_code, staff_set from exam_entry where registration_id = $1 and status = 'draft'`, [line]);
      expect(made).toMatchObject({ option_code: 'B2', staff_set: ['option'] });
      expect(made.id).not.toBe(e!.id);
    });

    it('an option chosen on an entry added by hand is staff\'s (the review of 54c225f, item 3)', async () => {
      const sh = await onboard(w.officer, 'x-xw-sh', 12);
      const e = await apiResponse(coord.api.v1.exams.entries.$post({ json: { studentId: sh.studentId, boardSeriesId: w.series.cambridgeNov, qualificationId: w.catalogue.cSyllabus, optionCode: 'A1' } }));
      expect((await one<{ s: string[] }>(`select staff_set as s from exam_entry where id = $1`, [e.id])).s).toEqual(['option']);
    });

    it('"mark as sent" refuses an entry whose line is no longer confirmed, naming it (the backstop should a path end a line and leave its entries)', async () => {
      const [e] = await entriesOf(w.series.cambridgeNov, pf.nl!.studentId);
      // No path leaves this state now (each withdraws the entries in its own transaction); it is
      // made by hand, as a path that forgot to would leave it, and put back after.
      await sql(`update registration set status = 'dropped' where id = $1`, [pl.nl!]);
      try {
        expect(await refused(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [e!.id] } })))
          .toEqual({ status: 409, error: `${T}97 Biology ${T} for Student x-xw-nl is not sent: its reservation is dropped — withdraw the entry` });
        expect((await one<{ status: string }>(`select status from exam_entry where id = $1`, [e!.id])).status).toBe('draft');
      } finally {
        await sql(`update registration set status = 'confirmed' where id = $1`, [pl.nl!]);
      }
      expect(await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [e!.id] } }))).toEqual({ submitted: 1, skipped: 0 });
    });
  });

  describe('a refund is priced after the line is locked: "mark as sent" landing meanwhile keeps the board fee (the review of 093dbd1, item 4)', () => {
    const qf: Record<string, Family> = {};
    const ql: Record<string, string> = {};
    beforeAll(async () => {
      for (const k of ['qd', 'qa', 'qs']) {
        qf[k] = await onboard(w.officer, `x-xw-${k}`, 12);
        ql[k] = (await reserve(qf[k]!, [w.first(w.items.sc, w.teacherId)]))[0]!;
        await derive(w.series.cambridgeNov, qf[k]!.studentId);
      }
    });
    /**
     * "Mark as sent" held at its audit row — inside its transaction, the line held FOR SHARE — while
     * `end` runs: the path that ends the line waits for the line, then prices its refund.
     */
    const sendDuring = async (f: Family, lineId: string, end: () => Promise<unknown>) => {
      const before = await refundPreview(f, lineId);
      expect(before).toMatchObject({ boardPart: 500, boardSent: false });
      const [e] = await entriesOf(w.series.cambridgeNov, f.studentId);
      const p = await pauseAtAudits(['EXAM_ENTRIES_SUBMITTED']);
      let sent: unknown;
      try {
        const sending = apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [e!.id] } }));
        await p.paused('EXAM_ENTRIES_SUBMITTED');
        const ending = end();
        await lockWaiters(2);
        await p.release('EXAM_ENTRIES_SUBMITTED');
        sent = await sending;
        await ending;
      } finally {
        await p.releaseAll();
      }
      expect(sent).toEqual({ submitted: 1, skipped: 0 });
      // The board fee stays with the board: the course part alone comes back.
      expect(await credited(lineId)).toBe(before.coursePart);
      const [w1] = await entriesOfLine(lineId);
      expect(w1).toMatchObject({ status: 'withdrawn', withdrawn_with_line: true });
      expect(w1!.submitted_at).not.toBeNull();
      expect(await sql<{ n: Record<string, unknown> }>(`select new_data as n from audit_log where entity_id = $1 and action = 'EXAM_ENTRY_WITHDRAWN'`, [w1!.id])).toHaveLength(1);
    };

    it("the family's direct drop", async () => {
      await sendDuring(qf.qd!, ql.qd!, () => apiResponse(qf.qd!.parent.api.v1.registrations[':id'].drop.$post({ param: { id: ql.qd! }, json: { reason: 'race: sent meanwhile' } })));
      await notified('parent.x-xw-qd@test.local', 'EXAM_ENTRY_WITHDRAWN', 1);
    });

    it("a drop request's approval", async () => {
      const cr = await apiResponse(qf.qa!.student.api.v1.registrations[':id']['request-drop'].$post({ param: { id: ql.qa! }, json: { reason: 'race: sent meanwhile' } }));
      await sendDuring(qf.qa!, ql.qa!, () => apiResponse(qf.qa!.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: cr.id }, json: {} })));
      await notified('parent.x-xw-qa@test.local', 'EXAM_ENTRY_WITHDRAWN', 1);
    });

    it("the family's direct swap", async () => {
      await sendDuring(qf.qs!, ql.qs!, () => apiResponse(qf.qs!.parent.api.v1.registrations[':id'].swap.$post({ param: { id: ql.qs! }, json: { line: w.first(w.items.spx), reason: 'race: sent meanwhile' } })));
      await notified('parent.x-xw-qs@test.local', 'EXAM_ENTRY_WITHDRAWN', 1);
    });
  });

  describe("an entry follows its line's answer given after it was made (the review of 093dbd1, item 2)", () => {
    const af: Record<string, Family> = {};
    const al: Record<string, string> = {};
    beforeAll(async () => {
      for (const k of ['ra', 'rb', 'rc', 'ca', 'cc', 'cd', 'ce', 'cs']) af[k] = await onboard(w.officer, `x-xw-${k}`, 12);
      for (const k of ['ra', 'rb', 'rc']) al[k] = (await reserve(af[k]!, [retake(w.items.sc, { month: 'june', year: Y }, { teacherId: w.teacherId })]))[0]!;
      for (const k of ['ca', 'cc', 'cd', 'ce', 'cs']) al[k] = (await reserve(af[k]!, [carry(itemCF, { month: 'june', year: Y })]))[0]!;
    });
    const nov = () => w.series.cambridgeNov;
    const verify = (id: string, json: { outcome: 'verified' | 'rejected'; reason: string; prevCentre?: string; prevCandidateNumber?: string }) =>
      apiResponse(coord.api.v1.registrations[':id']['verify-prior'].$post({ param: { id }, json }));
    const only = async (k: string) => (await entriesOf(nov(), af[k]!.studentId))[0]!;
    const rowOf = async (entryId: string) => (await entryList(nov())).rows.find((r) => r.entryId === entryId)!;
    const send = (id: string) => apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [id] } }));
    const updatedRow = (id: string) => one<{ p: Record<string, unknown>; n: Record<string, unknown> }>(
      `select previous_data as p, new_data as n from audit_log where entity_id = $1 and action = 'EXAM_ENTRY_UPDATED' order by created_at desc limit 1`, [id]);

    it('a retake rejected after its entry was sent: the entry still says retake, and the check asks the coordinator to amend it', async () => {
      await derive(nov(), af.ra!.studentId);
      const e = await only('ra');
      expect([e.is_retake, e.retake_source]).toEqual([true, 'registration']);
      await send(e.id);
      expect(await verify(al.ra!, { outcome: 'rejected', reason: 'no such sitting on the board statement' })).toMatchObject({ outcome: 'rejected', effect: 'stands' });
      const row = await rowOf(e.id);
      expect(row.values).toMatchObject({ retake: 'Y' });
      expect(row.problems).toContain('retake_differs_from_line');
      // A derivation leaves a sent entry alone: the coordinator amends it with the board.
      expect(await derive(nov(), af.ra!.studentId)).toMatchObject({ created: 0, updated: 0 });
      expect((await only('ra')).is_retake).toBe(true);
    });

    it("a retake rejected after its draft was made: the next derivation brings the draft up to date as a first entry, audited", async () => {
      await derive(nov(), af.rb!.studentId);
      const e = await only('rb');
      expect(e.is_retake).toBe(true);
      await verify(al.rb!, { outcome: 'rejected', reason: 'no such sitting on the board statement' });
      expect((await rowOf(e.id)).problems).toContain('retake_differs_from_line');
      const preview = await derive(nov(), af.rb!.studentId, false);
      expect(preview.summary).toMatchObject({ newEntries: 0, updates: 1 });
      expect(preview.rows.map((r) => [r.outcome, r.entries.map((x) => x.state)])).toEqual([['ready', ['refresh']]]);
      expect(await derive(nov(), af.rb!.studentId)).toMatchObject({ created: 0, updated: 1 });
      expect(await only('rb')).toMatchObject({ id: e.id, status: 'draft', is_retake: false, retake_source: null });
      const row = await rowOf(e.id);
      expect(row.values).toMatchObject({ retake: 'N' });
      expect(row.problems).not.toContain('retake_differs_from_line');
      expect(await updatedRow(e.id)).toMatchObject({
        p: { isRetake: true, retakeSource: 'registration' }, n: { isRetake: false, retakeSource: null, reason: "brought up to date with the reservation's answered sitting" },
      });
      // Up to date: nothing more to change.
      expect((await derive(nov(), af.rb!.studentId, false)).summary).toMatchObject({ newEntries: 0, updates: 0 });
    });

    it('a retake verified after derivation: nothing changes and nothing is flagged', async () => {
      await derive(nov(), af.rc!.studentId);
      const e = await only('rc');
      await verify(al.rc!, { outcome: 'verified', reason: 'the board statement shows it' });
      expect((await rowOf(e.id)).problems).not.toContain('retake_differs_from_line');
      expect(await derive(nov(), af.rc!.studentId)).toMatchObject({ created: 0, updated: 0 });
      expect((await only('rc')).is_retake).toBe(true);
    });

    it('a carry forward declared and not verified is derived as suggested, not confirmed', async () => {
      await derive(nov(), af.ca!.studentId);
      const e = await only('ca');
      expect([e.option_code, e.carry_forward, e.cf_from_month, e.cf_from_year, e.cf_centre_number]).toEqual(['BY', 'suggested', 'june', Y, 'EG123']);
      const row = await rowOf(e.id);
      expect(row.problems).toContain('carry_forward_to_confirm');
      expect(row.problems).not.toContain('carry_forward_differs_from_line');
    });

    it('verified at another centre after derivation: flagged, then the draft is brought up to date with that centre and candidate number', async () => {
      const e = await only('ca');
      await verify(al.ca!, { outcome: 'verified', prevCentre: 'EG998', prevCandidateNumber: '0453', reason: "seen on the other centre's statement" });
      expect((await rowOf(e.id)).problems).toContain('carry_forward_differs_from_line');
      expect(await derive(nov(), af.ca!.studentId)).toMatchObject({ created: 0, updated: 1 });
      expect(await only('ca')).toMatchObject({ id: e.id, option_code: 'BY', carry_forward: 'confirmed', cf_from_month: 'june', cf_from_year: Y, cf_centre_number: 'EG998', cf_candidate_number: '0453' });
      const row = await rowOf(e.id);
      expect(row.problems).not.toContain('carry_forward_differs_from_line');
      expect(row.problems).not.toContain('carry_forward_to_confirm');
      expect(row.values).toMatchObject({ previousCentre: 'EG998', previousCandidate: '0453' });
    });

    it("verified here after derivation: the next derivation confirms the suggested carry forward", async () => {
      await derive(nov(), af.cc!.studentId);
      const e = await only('cc');
      expect(e.carry_forward).toBe('suggested');
      await verify(al.cc!, { outcome: 'verified', reason: 'our own June results' });
      const row = await rowOf(e.id);
      expect(row.problems).toContain('carry_forward_to_confirm');
      expect(row.problems).not.toContain('carry_forward_differs_from_line');
      expect(await derive(nov(), af.cc!.studentId)).toMatchObject({ updated: 1 });
      expect(await only('cc')).toMatchObject({ carry_forward: 'confirmed', cf_centre_number: 'EG123' });
      expect((await rowOf(e.id)).problems).not.toContain('carry_forward_to_confirm');
    });

    it('rejected before derivation: entered as a first entry with no carry forward, the option left to choose', async () => {
      await verify(al.cd!, { outcome: 'rejected', reason: 'no June result for this candidate' });
      const done = await derive(nov(), af.cd!.studentId);
      expect(done.rows.map((r) => r.note)).toEqual([`The declared sitting was not confirmed: Biology A Level ${T} is entered as a first entry — choose the option that enters every component`]);
      expect(await only('cd')).toMatchObject({ option_code: null, carry_forward: 'none', cf_from_month: null });
    });

    it('rejected after derivation: the draft loses the carry forward and its option; a sent entry keeps them and is flagged', async () => {
      await derive(nov(), af.ce!.studentId);
      await derive(nov(), af.cs!.studentId);
      const draft = await only('ce');
      const sent = await only('cs');
      expect([draft.option_code, draft.carry_forward, sent.option_code, sent.carry_forward]).toEqual(['BY', 'suggested', 'BY', 'suggested']);
      await send(sent.id);
      for (const k of ['ce', 'cs']) expect(await verify(al[k]!, { outcome: 'rejected', reason: 'no June result for this candidate' })).toMatchObject({ effect: 'stands' });
      expect((await rowOf(draft.id)).problems).toContain('carry_forward_differs_from_line');
      expect((await rowOf(sent.id)).problems).toContain('carry_forward_differs_from_line');
      expect(await derive(nov(), af.ce!.studentId)).toMatchObject({ updated: 1 });
      expect(await only('ce')).toMatchObject({ id: draft.id, option_code: null, carry_forward: 'none', cf_from_month: null, cf_from_year: null, cf_centre_number: null, cf_candidate_number: null });
      expect((await rowOf(draft.id)).problems).not.toContain('carry_forward_differs_from_line');
      expect(await derive(nov(), af.cs!.studentId)).toMatchObject({ updated: 0 });
      expect(await only('cs')).toMatchObject({ id: sent.id, option_code: 'BY', carry_forward: 'suggested', status: 'submitted' });
    });

    it("a retake the candidate's history here shows stays one after the declaration is rejected: the history is its source (the review of 426d565, item 3)", async () => {
      const hr = await onboard(w.officer, 'x-xw-hr', 12);
      const [line] = await reserve(hr, [retake(w.items.sc, { month: 'june', year: Y }, { teacherId: w.teacherId })]) as [string];
      const june = (await one<{ s: string }>(`select prior_sitting_series_id as s from registration where id = $1`, [line])).s;
      // The school's own record of the June sitting: the candidate's entry here then.
      await apiResponse(coord.api.v1.exams.entries.$post({ json: { studentId: hr.studentId, boardSeriesId: june, qualificationId: w.catalogue.cSyllabus } }));
      await derive(nov(), hr.studentId);
      const [e] = await entriesOf(nov(), hr.studentId);
      expect([e!.is_retake, e!.retake_source]).toEqual([true, 'history']);
      expect(await verify(line, { outcome: 'rejected', reason: 'not the sitting the family named' })).toMatchObject({ effect: 'stands' });
      expect((await rowOf(e!.id)).problems).not.toContain('retake_differs_from_line');
      expect(await derive(nov(), hr.studentId)).toMatchObject({ created: 0, updated: 0 });
      expect((await entriesOf(nov(), hr.studentId)).map((x) => [x.id, x.is_retake, x.retake_source])).toEqual([[e!.id, true, 'history']]);
    });

    it("a coordinator's untick on a draft stays: the next derivation does not tick it again, and the check does not flag it", async () => {
      const hu = await onboard(w.officer, 'x-xw-hu', 12);
      await reserve(hu, [retake(w.items.sc, { month: 'june', year: Y }, { teacherId: w.teacherId })]);
      await derive(nov(), hu.studentId);
      const [e] = await entriesOf(nov(), hu.studentId);
      expect(e!.is_retake).toBe(true);
      await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: e!.id }, json: { isRetake: false } }));
      expect((await one<{ s: string[] }>(`select staff_set as s from exam_entry where id = $1`, [e!.id])).s).toEqual(['retake']);
      expect(await derive(nov(), hu.studentId)).toMatchObject({ created: 0, updated: 0 });
      expect((await entriesOf(nov(), hu.studentId))[0]).toMatchObject({ id: e!.id, is_retake: false });
      expect((await rowOf(e!.id)).problems).not.toContain('retake_differs_from_line');
    });

    it("another centre's candidate number typed by hand on a draft stays: the next derivation does not overwrite it", async () => {
      const ht = await onboard(w.officer, 'x-xw-ht', 12);
      const [line] = await reserve(ht, [carry(itemCF, { month: 'june', year: Y })]) as [string];
      await verify(line, { outcome: 'verified', prevCentre: 'EG997', prevCandidateNumber: '0454', reason: "seen on the other centre's statement" });
      await derive(nov(), ht.studentId);
      const [e] = await entriesOf(nov(), ht.studentId);
      expect([e!.carry_forward, e!.cf_centre_number, e!.cf_candidate_number]).toEqual(['confirmed', 'EG997', '0454']);
      // The statement had it wrong: the coordinator types the number the other centre confirms.
      await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: e!.id }, json: { cfCandidateNumber: '0455' } }));
      expect(await derive(nov(), ht.studentId)).toMatchObject({ created: 0, updated: 0 });
      expect((await entriesOf(nov(), ht.studentId))[0]).toMatchObject({ carry_forward: 'confirmed', cf_centre_number: 'EG997', cf_candidate_number: '0455' });
      expect((await rowOf(e!.id)).problems).not.toContain('carry_forward_differs_from_line');
    });
  });

  describe("a sitting the school's results show: verified at declaration, only by a real grade, the importer answering (the review of 093dbd1, items 3, 7, 9)", () => {
    const kf: Record<string, Family> = {};
    const uci: Record<string, string> = {};
    let june: string;
    beforeAll(async () => {
      for (const k of ['kz', 'kr', 'ka', 'vi', 'vp', 'vf', 'ku', 'kv', 'kp']) kf[k] = await onboard(w.officer, `x-xw-${k}`, 12);
      // Pearson's June series, as a declaration names it (made by the first one to, if none has yet).
      const [z] = await reserve(kf.kz!, [retake(w.items.sp1, { month: 'june', year: Y })]);
      june = (await one<{ s: string }>(`select prior_sitting_series_id as s from registration where id = $1`, [z!])).s;
      let n = 611;
      for (const k of ['kr', 'ka', 'vi', 'vp', 'vf', 'ku', 'kv', 'kp']) {
        uci[k] = `91234B26${String(n++).padStart(4, '0')}E`;
        await apiResponse(coord.api.v1.exams.candidates[':studentId'].$put({ param: { studentId: kf[k]!.studentId }, json: { uci: uci[k] } }));
      }
    });
    const declare = async (k: string) => (await reserve(kf[k]!, [retake(w.items.sp1, { month: 'june', year: Y })]))[0]!;
    const answer = (id: string) => one<{ user_id: string; n: { reason: string; evidence: string } }>(
      `select user_id, new_data as n from audit_log where entity_id = $1 and action = 'PRIOR_SITTING_VERIFIED'`, [id]);
    const verifiedBy = async (id: string) => (await one<{ by: string | null }>(`select prior_sitting_verified_by as by from registration where id = $1`, [id])).by;

    it("an import verifies the declared sittings it shows with a real grade, as the one who imported them; absent and pending verify nothing", async () => {
      const vi = await declare('vi');
      const vp = await declare('vp');
      const done = await apiResponse(w.adm.api.v1.exams.results.import.$post({ json: {
        boardSeriesId: june, commit: true,
        source: { text: `UCI,Unit Code,Grade,UMS\n${uci.kr},${T}WMA11,C,60\n${uci.ka},${T}WMA11,X,\n${uci.vi},${T}WMA11,A,80\n${uci.vp},${T}WMA11,PENDING,`, name: 'June results (admin)' },
      } }));
      expect(done).toMatchObject({ committed: true, verificationFailed: 0, verificationNote: null });
      expect(done.sittingsVerified.map((v) => v.registrationId)).toEqual([vi]);
      expect((await lineOf(vi)).outcome).toBe('verified');
      expect((await lineOf(vp)).outcome).toBeNull();
      expect(await verifiedBy(vi)).toBe(w.adm.id);
      expect((await answer(vi)).user_id).toBe(w.adm.id);
    });

    it('a retake declared after its sitting is on record is verified at once, by the one declaring it, the reason naming the result and its importer; a sitting graded absent waits for the coordinator', async () => {
      const kr = await declare('kr');
      const ka = await declare('ka');
      expect((await lineOf(kr)).outcome).toBe('verified');
      // The desk declared it (the review of 426d565, item 7): the admin who imported the result was not acting then.
      expect(await verifiedBy(kr)).toBe(w.officer.id);
      const a = await answer(kr);
      expect(a.user_id).toBe(w.officer.id);
      const importedAt = new Date((await one<{ at: string }>(`select created_at as at from exam_result where student_id = $1 and board_series_id = $2`, [kf.kr!.studentId, june])).at);
      expect(a.n).toMatchObject({
        reason: `Pearson Edexcel June ${Y}'s results on record list ${T}WMA11 for the candidate, imported by Admin x-xw on ${dayWords(importedAt)} (verified at declaration)`,
        evidence: `The board's results for Pearson Edexcel June ${Y}: ${T}WMA11 graded C`,
      });
      expect((await lineOf(ka)).outcome).toBeNull();
      const toVerify = await apiResponse(coord.api.v1.sessions[':id']['to-verify'].$get({ param: { id: w.sessionId }, query: { show: 'awaiting' } }));
      expect(toVerify.lines.map((l) => l.id)).toContain(ka);
      expect(toVerify.lines.map((l) => l.id)).not.toContain(kr);
      // The line says retake and so does the history (June's result): the history stays the source
      // (the review of 426d565, item 3), so a rejected declaration could never untick it.
      await derive(w.series.pearsonJan, kf.kr!.studentId);
      expect((await entriesOf(w.series.pearsonJan, kf.kr!.studentId)).map((e) => [e.entry_code, e.is_retake, e.retake_source, e.registration_id]))
        .toEqual([[`${T}WMA11`, true, 'history', kr]]);
    });

    it("a family's own declaration the results on record show is verified with no person as its answerer, the reason naming the result and its importer (the review of 54c225f, item 2)", async () => {
      await apiResponse(w.adm.api.v1.exams.results.import.$post({ json: {
        boardSeriesId: june, commit: true, source: { text: `UCI,Unit Code,Grade,UMS\n${uci.kp},${T}WMA11,B,70`, name: 'June results, one more page' },
      } }));
      const importedAt = new Date((await one<{ at: string }>(`select created_at as at from exam_result where student_id = $1 and board_series_id = $2`, [kf.kp!.studentId, june])).at);
      // The parent reserves the retake in the app and declares the June sitting.
      const [line] = await apiResponse(kf.kp!.parent.api.v1.registrations.direct.$post({ json: {
        sessionId: w.sessionId, studentId: kf.kp!.studentId, lines: [retake(w.items.sp1, { month: 'june', year: Y })], consent: CONSENT,
      } }));
      expect((await lineOf(line!.id)).outcome).toBe('verified');
      expect(await verifiedBy(line!.id)).toBeNull();
      const a = await one<{ user_id: string | null; n: Record<string, unknown> }>(
        `select user_id, new_data as n from audit_log where entity_id = $1 and action = 'PRIOR_SITTING_VERIFIED'`, [line!.id]);
      expect(a.user_id).toBeNull();
      expect(a.n).toMatchObject({
        answeredFrom: 'results_on_record',
        reason: `Pearson Edexcel June ${Y}'s results on record list ${T}WMA11 for the candidate, imported by Admin x-xw on ${dayWords(importedAt)} (verified at declaration)`,
      });
      // The To verify tab names no person: the results on record.
      const decided = await apiResponse(coord.api.v1.sessions[':id']['to-verify'].$get({ param: { id: w.sessionId }, query: { show: 'decided' } }));
      expect(decided.lines.find((l) => l.id === line!.id)).toMatchObject({ decidedBy: null, decidedFrom: 'results_on_record' });
    });

    it("an award's result verifies a line that enters the award, never a unit line of an award cashed in by units (the review of 426d565, item 1)", async () => {
      // P1's line follows a declared June: the IAL award graded in June says nothing of when P1 was sat.
      const ku = await declare('ku');
      const [kv] = await reserve(kf.kv!, [retake(w.items.spx, { month: 'june', year: Y })]) as [string];
      const done = await apiResponse(w.adm.api.v1.exams.results.import.$post({ json: {
        boardSeriesId: june, commit: true, source: { text: `UCI,Unit Code,Grade,UMS\n${uci.ku},${T}XMA01,B,\n${uci.kv},${T}XMA01,A,`, name: 'June awards' },
      } }));
      expect(done.sittingsVerified.map((v) => v.registrationId)).toEqual([kv]);
      expect((await lineOf(ku)).outcome).toBeNull();
      expect((await lineOf(kv)).outcome).toBe('verified');
    });

    it("a verification failing after the import commits reads as results saved; the To verify tab's check answers it later, as the coordinator", async () => {
      const vf = await declare('vf');
      const importing = () => apiResponse(coord.api.v1.exams.results.import.$post({ json: {
        boardSeriesId: june, commit: true, source: { text: `UCI,Unit Code,Grade,UMS\n${uci.vf},${T}WMA11,B,70`, name: 'June results, a late page' },
      } }));
      const release = await refuseAudit('PRIOR_SITTING_VERIFIED');
      let done = null as Awaited<ReturnType<typeof importing>> | null;
      try {
        done = await importing();
      } finally {
        await release();
      }
      expect(done).toMatchObject({
        committed: true, sittingsVerified: [], verificationFailed: 1,
        verificationNote: "Results saved; the verification of 1 declared sitting failed — answer it on the session's To verify tab",
      });
      expect(await sql(`select grade from exam_result where student_id = $1 and board_series_id = $2`, [kf.vf!.studentId, june])).toEqual([{ grade: 'B' }]);
      expect((await lineOf(vf)).outcome).toBeNull();
      const checked = await apiResponse(coord.api.v1.exams.results['verify-declared'].$post({ json: { sessionId: w.sessionId } }));
      expect(checked.verified.map((v) => v.registrationId)).toEqual([vf]);
      expect(checked.failed).toBe(0);
      expect(checked.awaiting).toBeGreaterThan(1);
      const a = await answer(vf);
      expect(a.user_id).toBe(coord.id);
      expect(a.n.reason).toBe(`Pearson Edexcel June ${Y}'s results list ${T}WMA11 for the candidate (results on record, from the To verify tab)`);
      // Asked again: nothing more to answer.
      expect((await apiResponse(coord.api.v1.exams.results['verify-declared'].$post({ json: { sessionId: w.sessionId } }))).verified).toEqual([]);
    });
  });


  describe('each line cut off at its own deadline; the desk\'s drop past it withdraws the entries', () => {
    let june: string, juneSeries: string, j1: string, j2: string, j3: string, j4: string;
    const jf: Record<string, Family> = {};
    beforeAll(async () => {
      juneSeries = (await apiResponse(w.adm.api.v1['board-series'].$post({ json: {
        boardCode: 'cambridge', month: 'june', year: Y + 1, label: 'exams xw june', entryDeadline: new Date(Date.now() + 5 * DAY), retakeDeadline: new Date(Date.now() + 10 * DAY),
      } }))).id;
      await fee(juneSeries, 'qualification', w.catalogue.cSyllabus);
      june = (await apiResponse(w.adm.api.v1.sessions.$post({ json: {
        type: 'june', year: Y + 1, label: 'exams xw june', startDate: new Date(Date.now() - DAY).toISOString(), endDate: new Date(Date.now() + 3 * DAY).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + 3 * DAY).toISOString(),
      } })))!.id;
      const bio = await subject('BIOJ', 'Biology June', 'cambridge', 'as_level');
      const [item] = await offer(june, bio, 1000, [w.teacherId], [
        { label: 'Whole subject', kind: 'whole', enters: { kind: 'award', qualificationId: w.catalogue.cSyllabus }, boardSeriesId: juneSeries, availability: 'open', requiredInSeries: false },
      ]) as [string];
      for (const k of ['j1', 'j2', 'j3', 'j4']) jf[k] = await onboard(w.officer, `x-xw-${k}`, 12);
      [j1] = await reserve(jf.j1!, [{ offerItemId: item, attempt: 'first', mode: 'in_school' }], june) as [string];
      // A retake of the board's previous sitting (November): its cut-off is the retake deadline.
      [j2] = await reserve(jf.j2!, [retake(item, { month: 'november', year: Y })], june) as [string];
      [j3] = await reserve(jf.j3!, [{ offerItemId: item, attempt: 'first', mode: 'in_school' }], june) as [string];
      // J4's first entry is paid but never derived before the deadline.
      [j4] = await reserve(jf.j4!, [{ offerItemId: item, attempt: 'first', mode: 'in_school' }], june) as [string];
      // J1's entry made and sent, J3's made and left a draft, before the entry deadline.
      await derive(juneSeries, jf.j1!.studentId);
      await derive(juneSeries, jf.j3!.studentId);
      const [e1] = await entriesOf(juneSeries, jf.j1!.studentId);
      await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [e1!.id] } }));
      // The entry deadline passes (as 08i moves them) just after the last of those; the retake deadline is ahead.
      await sql(`update board_series set entry_deadline = (select max(greatest(created_at, coalesce(submitted_at, created_at))) + interval '1 millisecond' from exam_entry where board_series_id = $1) where id = $2`, [juneSeries, juneSeries]);
    });

    it("past the entry deadline a retake of the board's previous sitting is still entered and sent, until the retake deadline; a first entry is not sent", async () => {
      const preview = await derive(juneSeries, undefined, false);
      expect(preview).toMatchObject({ pastDeadline: true, refusal: null });
      expect(Object.fromEntries(preview.rows.map((r) => [r.registrationId, r.outcome]))).toEqual({ [j1]: 'entered', [j2]: 'ready', [j3]: 'entered', [j4]: 'past_deadline' });
      expect(preview.rows.find((r) => r.registrationId === j2)!.deadline.kind).toBe('retake');
      expect(preview.rows.find((r) => r.registrationId === j4)!.note)
        .toMatch(/^The entry deadline for Cambridge International June \d{4} \(exams xw june\) \(.+\) has passed: the school makes no new entries after it/);
      const done = await derive(juneSeries);
      expect(done.created).toBe(1);
      expect(await entriesOf(juneSeries, jf.j4!.studentId)).toEqual([]);
      const [e2] = await entriesOf(juneSeries, jf.j2!.studentId);
      expect(e2).toMatchObject({ is_retake: true, retake_source: 'registration' });
      const deadline = new Date((await one<{ d: string }>(`select entry_deadline as d from board_series where id = $1`, [juneSeries])).d);
      expect(new Date(e2!.created_at).getTime()).toBeGreaterThan(deadline.getTime());
      expect(await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [e2!.id] } }))).toEqual({ submitted: 1, skipped: 0 });
      // J3's draft is a first entry: sending it now is a late entry.
      const [e3] = await entriesOf(juneSeries, jf.j3!.studentId);
      const r = await refused(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [e3!.id] } }));
      expect(r.status).toBe(409);
      expect(r.error).toMatch(/^The entry deadline for Cambridge International June \d{4} \(exams xw june\) \(.+\) has passed: the school makes no new entries after it — the board's late entries are not taken \(MO-10\)$/);
    });

    it("the desk drops a paid line past its deadline: its entries are withdrawn with it, the board fee kept (sent), the notice naming what was sent", async () => {
      const done = await apiResponse(w.officer.api.v1.registrations[':id']['desk-drop'].$post({ param: { id: j1 }, json: { reason: 'the family moved abroad' } }));
      const [sentAt] = await sql<{ at: string }>(`select submitted_at as at from exam_entry where registration_id = $1`, [j1]);
      expect(done).toMatchObject({ boardSent: true, refundBoardPart: 0, refundAmount: 1000 });
      expect(done.boardNote).toBe(`The board fee stays with the board: the school sent ${T}97 Biology ${T} on ${dayWords(new Date(sentAt!.at))}.`);
      expect(done.entriesWithdrawn.map((x) => [x.entryCode, x.wasSent])).toEqual([[`${T}97`, true]]);
      const e = await one<{ id: string; status: string; withdrawal_reason: string }>(`select id, status, withdrawal_reason from exam_entry where registration_id = $1`, [j1]);
      expect(e).toMatchObject({ status: 'withdrawn', withdrawal_reason: 'the family moved abroad' });
      await audited([e.id], ['EXAM_ENTRY_WITHDRAWN']);
      expect((await one<{ d: { withLine: string } }>(`select new_data as d from audit_log where entity_id = $1 and action = 'EXAM_ENTRY_WITHDRAWN'`, [e.id])).d.withLine).toBe(j1);
      const told = await notified(`parent.x-xw-j1@test.local`, 'EXAM_ENTRY_WITHDRAWN', 1);
      expect(told[0]!.body).toBe(`${T}97 Biology ${T} was withdrawn from Cambridge International June ${Y + 1} (exams xw june): the family moved abroad`);
      expect((await notified(`parent.x-xw-j1@test.local`, 'DROP_SWAP_PROCESSED', 1))[0]!.body).toContain(`The board fee stays with the board: the school sent ${T}97`);
    });

    it("a declared retake rejected past the first-entry deadline is dropped: its sent entry withdrawn with it, the board fee kept (the review of 093dbd1, item 1)", async () => {
      const before = await refundPreview(jf.j2!, j2);
      expect(before).toMatchObject({ boardSent: true, boardPart: 0 });
      const r = await apiResponse(coord.api.v1.registrations[':id']['verify-prior'].$post({ param: { id: j2 }, json: { outcome: 'rejected', reason: 'no November result for this candidate' } }));
      expect(r).toMatchObject({ outcome: 'rejected', effect: 'dropped', refundAmount: before.amount });
      expect((await lineOf(j2)).status).toBe('dropped');
      expect(await credited(j2)).toBe(before.amount);
      const [e] = await withdrawnWithLine(j2, 'the declared sitting was not confirmed after the first-entry deadline');
      expect(e!.submitted_at).not.toBeNull();
      expect((await notified('parent.x-xw-j2@test.local', 'EXAM_ENTRY_WITHDRAWN', 1))[0]!.body)
        .toBe(`${T}97 Biology ${T} was withdrawn from Cambridge International June ${Y + 1} (exams xw june): the declared sitting was not confirmed after the first-entry deadline`);
    });
  });

  describe('a line moved to another series takes its drafts with it, and a sent entry refuses the move (the review of 426d565, item 2)', () => {
    const at = (n: number) => new Date(Date.now() + n * DAY);
    const mkSeries = async (boardCode: 'cambridge' | 'pearson_edexcel', year: number, label: string, entryDeadline: Date) =>
      (await apiResponse(w.adm.api.v1['board-series'].$post({ json: { boardCode, month: 'june', year, label, entryDeadline } }))).id;
    const mkSession = async (label: string) => (await apiResponse(w.adm.api.v1.sessions.$post({ json: {
      type: 'june', year: Y + 1, label, startDate: new Date(Date.now() - DAY).toISOString(), endDate: at(3).toISOString(),
      courseStartsOn: cairoDate(new Date()), paymentDueAt: at(3).toISOString(),
    } })))!.id;
    const whole = (boardSeriesId: string, label = 'Whole subject') =>
      ({ label, kind: 'whole', enters: { kind: 'award', qualificationId: w.catalogue.cSyllabus }, boardSeriesId, availability: 'open', requiredInSeries: false });
    const draftIn = async (seriesId: string, f: Family) => { await derive(seriesId, f.studentId); return (await entriesOf(seriesId, f.studentId))[0]!; };
    const sentIn = async (seriesId: string, f: Family) => {
      const e = await draftIn(seriesId, f);
      await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [e.id] } }));
      return e;
    };
    const seriesOfLine = async (id: string) => (await one<{ s: string }>(`select board_series_id as s from registration where id = $1`, [id])).s;
    const statusOf = async (id: string) => (await one<{ s: string }>(`select status as s from exam_entry where id = $1`, [id])).s;
    const byHand = (id: string) => apiResponse(coord.api.v1.exams.entries[':id'].withdraw.$post({ param: { id }, json: { reason: 'withdrawn with the board before the move (scenario)' } }));
    /** Two families on an item in `from`: the first's entry a draft, the second's sent. */
    const pair = async (tag: string, sessionId: string, itemId: string, from: string, grade: 11 | 12 = 12) => {
      const [fd, fs] = [await onboard(w.officer, `x-xw-${tag}d`, grade), await onboard(w.officer, `x-xw-${tag}s`, grade)];
      const [ld] = await reserve(fd, [w.first(itemId)], sessionId) as [string];
      const [ls] = await reserve(fs, [w.first(itemId)], sessionId) as [string];
      return { fd, fs, ld, ls, draft: await draftIn(from, fd), sent: await sentIn(from, fs) };
    };
    const refusal = (tag: string, seriesName: string) =>
      `${T}97 Biology ${T} for Student x-xw-${tag}s has already gone to the board in ${seriesName}: withdraw its entries first`;

    it("the admin's move: a sent entry refuses it, naming the entry; a draft is withdrawn with its line and made again where the line goes", async () => {
      const deadline = at(20);
      const from = await mkSeries('cambridge', Y + 1, 'exams xw move a', deadline);
      const to = await mkSeries('cambridge', Y + 1, 'exams xw move b', deadline);
      for (const s of [from, to]) await fee(s, 'qualification', w.catalogue.cSyllabus);
      const sess = await mkSession('exams xw moves');
      const bio = await subject('BIOMV', 'Biology moves', 'cambridge', 'as_level');
      const [item] = await offer(sess, bio, 1000, [w.teacherId], [whole(from), whole(to, 'Whole subject, the other series')]) as [string, string];
      const p = await pair('mv', sess, item, from);
      const move = (id: string) => w.adm.api.v1.sessions[':id']['board-series'].move.$post({
        param: { id: sess }, json: { registrationIds: [id], boardSeriesId: to, reason: 'sat in the other series (scenario)' },
      });
      expect(await refused(move(p.ls))).toEqual({ status: 409, error: refusal('mv', `Cambridge International June ${Y + 1} (exams xw move a)`) });
      expect([await seriesOfLine(p.ls), await statusOf(p.sent.id)]).toEqual([from, 'submitted']);
      await apiResponse(move(p.ld));
      expect(await seriesOfLine(p.ld)).toBe(to);
      await withdrawnWithLine(p.ld, 'the line moved to another series');
      expect(await entriesOf(from, p.fd.studentId)).toEqual([]);
      expect(await derive(to, p.fd.studentId)).toMatchObject({ created: 1 });
      expect((await entriesOf(to, p.fd.studentId)).map((e) => [e.entry_code, e.status, e.registration_id])).toEqual([[`${T}97`, 'draft', p.ld]]);
    });

    it("an item's series change: refused while a line of it has a sent entry; once that is withdrawn, the lines move and the drafts go with them", async () => {
      const deadline = at(20);
      const from = await mkSeries('cambridge', Y + 1, 'exams xw item a', deadline);
      const to = await mkSeries('cambridge', Y + 1, 'exams xw item b', deadline);
      for (const s of [from, to]) await fee(s, 'qualification', w.catalogue.cSyllabus);
      const sess = await mkSession('exams xw items');
      const bio = await subject('BIOIT', 'Biology item moves', 'cambridge', 'as_level');
      const [item] = await offer(sess, bio, 1000, [w.teacherId], [whole(from)]) as [string];
      const offerId = (await one<{ o: string }>(`select offer_id as o from session_offer_item where id = $1`, [item])).o;
      const p = await pair('it', sess, item, from);
      const change = () => w.adm.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({
        param: { id: sess, offerId, itemId: item }, json: { boardSeriesId: to, reason: 'sat in the other series (scenario)' },
      });
      expect(await refused(change())).toEqual({ status: 409, error: refusal('it', `Cambridge International June ${Y + 1} (exams xw item a)`) });
      expect([await seriesOfLine(p.ld), await seriesOfLine(p.ls), await statusOf(p.draft.id)]).toEqual([from, from, 'draft']);
      await byHand(p.sent.id);
      await apiResponse(change());
      expect([await seriesOfLine(p.ld), await seriesOfLine(p.ls)]).toEqual([to, to]);
      await withdrawnWithLine(p.ld, "the line's item moved to another series");
      expect(await derive(to, p.fd.studentId)).toMatchObject({ created: 1 });
    });

    it("a subject's board change: refused while a line has a sent entry; once that is withdrawn, the lines move to the new board's series and the drafts are withdrawn", async () => {
      const deadline = at(20);
      const from = await mkSeries('cambridge', Y + 1, 'exams xw board', deadline);
      // The new board's series of the same month, year and label, with the same deadline (MO-10).
      const to = await mkSeries('pearson_edexcel', Y + 1, 'exams xw board', deadline);
      await fee(from, 'qualification', w.catalogue.cSyllabus);
      const sess = await mkSession('exams xw board');
      const bio = await subject('BIOBC', 'Biology board change', 'cambridge', 'as_level');
      const [item] = await offer(sess, bio, 1000, [w.teacherId], [whole(from)]) as [string];
      const p = await pair('bc', sess, item, from);
      const change = () => w.adm.api.v1.subjects[':id'].$put({ param: { id: bio }, json: { council: 'pearson_edexcel' } });
      // The subject form's route answers each of its refusals 400 (the Catalogue's mapping, the same change, 409).
      expect(await refused(change())).toEqual({ status: 400, error: refusal('bc', `Cambridge International June ${Y + 1} (exams xw board)`) });
      expect(await seriesOfLine(p.ld)).toBe(from);
      await byHand(p.sent.id);
      await apiResponse(change());
      expect([await seriesOfLine(p.ld), await seriesOfLine(p.ls)]).toEqual([to, to]);
      await withdrawnWithLine(p.ld, "the subject's board changed");
    });

    it("a session's series correction: refused while a line has a sent entry; once that is withdrawn, the lines go to the corrected series and the drafts are withdrawn", async () => {
      const from = await mkSeries('cambridge', Y + 1, 'exams xw corr', at(20));
      // The corresponding series of the corrected year: the same board, month and label.
      const to = await mkSeries('cambridge', Y + 2, 'exams xw corr', at(380));
      for (const s of [from, to]) await fee(s, 'qualification', w.catalogue.cSyllabus);
      const sess = await mkSession('exams xw corr');
      const bio = await subject('BIOCR', 'Biology correction', 'cambridge', 'as_level');
      const [item] = await offer(sess, bio, 1000, [w.teacherId], [whole(from)]) as [string];
      // Grade 11: the corrected June is their grade-12 year.
      const p = await pair('cr', sess, item, from, 11);
      const correct = () => w.adm.api.v1.sessions[':id'].series.$put({
        param: { id: sess }, json: { sessionType: 'june', seriesYear: Y + 2, reason: 'the session is for the next June (scenario)' },
      });
      expect(await refused(correct())).toEqual({ status: 409, error: refusal('cr', `Cambridge International June ${Y + 1} (exams xw corr)`) });
      expect(await seriesOfLine(p.ld)).toBe(from);
      await byHand(p.sent.id);
      await apiResponse(correct());
      expect([await seriesOfLine(p.ld), await seriesOfLine(p.ls)]).toEqual([to, to]);
      await withdrawnWithLine(p.ld, "the session's series was corrected");
    });
  });

  describe('after a move (the review of 54c225f, items 1 and 3)', () => {
    const at = (n: number) => new Date(Date.now() + n * DAY);
    let from: string, to: string, sess: string, item: string;
    beforeAll(async () => {
      const deadline = at(20);
      const mk = async (label: string) => (await apiResponse(w.adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label, entryDeadline: deadline } }))).id;
      from = await mk('exams xw after a');
      to = await mk('exams xw after b');
      for (const s of [from, to]) await fee(s, 'qualification', w.catalogue.cSyllabus);
      sess = (await apiResponse(w.adm.api.v1.sessions.$post({ json: {
        type: 'june', year: Y + 1, label: 'exams xw after', startDate: new Date(Date.now() - DAY).toISOString(), endDate: at(3).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: at(3).toISOString(),
      } })))!.id;
      const bio = await subject('BIOAF', 'Biology after moves', 'cambridge', 'as_level');
      const whole = (boardSeriesId: string, label: string) =>
        ({ label, kind: 'whole', enters: { kind: 'award', qualificationId: w.catalogue.cSyllabus }, boardSeriesId, availability: 'open', requiredInSeries: false });
      [item] = await offer(sess, bio, 1000, [w.teacherId], [whole(from, 'Whole subject'), whole(to, 'Whole subject, the other series')]) as [string, string];
    });
    const move = (id: string) => apiResponse(w.adm.api.v1.sessions[':id']['board-series'].move.$post({
      param: { id: sess }, json: { registrationIds: [id], boardSeriesId: to, reason: 'sat in the other series (scenario)' },
    }));

    it("a sent entry withdrawn so its line could move: dropped in the new series before anything is sent there, the board fee comes back (item 1)", async () => {
      const f = await onboard(w.officer, 'x-xw-sn', 12);
      const [line] = await reserve(f, [w.first(item)], sess) as [string];
      await derive(from, f.studentId);
      const [e] = await entriesOf(from, f.studentId);
      await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [e!.id] } }));
      await apiResponse(coord.api.v1.exams.entries[':id'].withdraw.$post({ param: { id: e!.id }, json: { reason: 'withdrawn with the board so the line can move (scenario)' } }));
      await move(line);
      const before = await refundPreview(f, line);
      // The send in the series it left is not this series' (the lead: "withdrawn included" is the line's own series).
      expect(before).toMatchObject({ boardSent: false, boardPart: 500, sentEntries: [] });
      const drop = await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: line }, json: { reason: 'the family moved away (scenario)' } }));
      expect(drop).toMatchObject({ refundAmount: before.amount });
      expect(before.amount).toBe(before.coursePart + 500);
      expect(await credited(line)).toBe(before.amount);
    });

    it("what staff set on a draft withdrawn by the move is carried to the entry made in the new series (item 3)", async () => {
      const f = await onboard(w.officer, 'x-xw-so', 12);
      const [line] = await reserve(f, [w.first(item)], sess) as [string];
      await derive(from, f.studentId);
      const [e] = await entriesOf(from, f.studentId);
      await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: e!.id }, json: { optionCode: 'A1' } }));
      await move(line);
      expect(await derive(to, f.studentId)).toMatchObject({ created: 1 });
      expect(await one<{ option_code: string | null; staff_set: string[] }>(
        `select option_code, staff_set from exam_entry where registration_id = $1 and status = 'draft'`, [line])).toEqual({ option_code: 'A1', staff_set: ['option'] });
    });
  });

  describe('a line not paid is never entered (the review of 426d565, item 4)', () => {
    it('an entry by hand on a line not paid is refused', async () => {
      const np = await onboard(w.officer, 'x-xw-np', 12);
      const [line] = (await w.reserve(np, [w.first(w.items.sc, w.teacherId)], false)).map((r) => r.id);
      expect((await lineOf(line!)).status).toBe('pending_payment');
      expect(await refused(coord.api.v1.exams.entries.$post({ json: { studentId: np.studentId, boardSeriesId: w.series.cambridgeNov, qualificationId: w.catalogue.cSyllabus, registrationId: line! } })))
        .toEqual({ status: 409, error: 'That reservation is pending payment: an entry is made only from a paid reservation' });
      expect(await sql(`select id from exam_entry where registration_id = $1`, [line!])).toEqual([]);
    });

    it("a derivation racing the family's drop of the line: it waits for the line and enters nothing on the dropped line", async () => {
      const dr = await onboard(w.officer, 'x-xw-dr', 12);
      const [line] = await reserve(dr, [w.first(w.items.sc, w.teacherId)]) as [string];
      const p = await pauseAtAudits(['DIRECT_DROP_EXECUTED']);
      let derived: Awaited<ReturnType<typeof derive>> | null = null;
      try {
        const dropping = apiResponse(dr.parent.api.v1.registrations[':id'].drop.$post({ param: { id: line }, json: { reason: 'race: dropped while the series is derived' } }));
        await p.paused('DIRECT_DROP_EXECUTED');
        const deriving = derive(w.series.cambridgeNov, dr.studentId);
        await lockWaiters(2);
        await p.release('DIRECT_DROP_EXECUTED');
        await dropping;
        derived = await deriving;
      } finally {
        await p.releaseAll();
      }
      expect(derived).toMatchObject({ created: 0 });
      expect((await lineOf(line)).status).toBe('dropped');
      expect(await sql(`select id from exam_entry where registration_id = $1`, [line])).toEqual([]);
    });
  });

  describe("step B's hold at the deadline drops a paid line and withdraws its entries; a sent one keeps its board fee (the review of 093dbd1, items 1 and 5)", () => {
    let holdSeries: string, holdSession: string, h1: string, h2: string;
    const hf: Record<string, Family> = {};
    beforeAll(async () => {
      holdSeries = (await apiResponse(w.adm.api.v1['board-series'].$post({ json: {
        boardCode: 'cambridge', month: 'june', year: Y + 1, label: 'exams xw hold', entryDeadline: new Date(Date.now() + 5 * DAY), retakeDeadline: new Date(Date.now() + 10 * DAY),
      } }))).id;
      await fee(holdSeries, 'qualification', w.catalogue.cSyllabus);
      holdSession = (await apiResponse(w.adm.api.v1.sessions.$post({ json: {
        type: 'june', year: Y + 1, label: 'exams xw hold', startDate: new Date(Date.now() - DAY).toISOString(), endDate: new Date(Date.now() + 3 * DAY).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + 3 * DAY).toISOString(),
      } })))!.id;
      const bio = await subject('BIOH', 'Biology hold', 'cambridge', 'as_level');
      const [item] = await offer(holdSession, bio, 1000, [w.teacherId], [
        { label: 'Whole subject', kind: 'whole', enters: { kind: 'award', qualificationId: w.catalogue.cSyllabus }, boardSeriesId: holdSeries, availability: 'open', requiredInSeries: false },
      ]) as [string];
      for (const k of ['h1', 'h2']) hf[k] = await onboard(w.officer, `x-xw-${k}`, 12);
      // Retakes of the board's previous sitting (November), declared at the desk and not verified: entered as declared.
      [h1] = await reserve(hf.h1!, [retake(item, { month: 'november', year: Y })], holdSession) as [string];
      [h2] = await reserve(hf.h2!, [retake(item, { month: 'november', year: Y })], holdSession) as [string];
      await derive(holdSeries, hf.h1!.studentId);
      await derive(holdSeries, hf.h2!.studentId);
      // H1's entry goes to the board under "enter as declared"; H2's stays a draft.
      const [e1] = await entriesOf(holdSeries, hf.h1!.studentId);
      await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [e1!.id] } }));
    });

    it('the school turns hold on, the deadline passes: the sent line keeps its board fee and its entry is withdrawn; the unsent one gets it back', async () => {
      const p1 = await refundPreview(hf.h1!, h1);
      const p2 = await refundPreview(hf.h2!, h2);
      expect(p1).toMatchObject({ boardSent: true, boardPart: 0 });
      expect(p2).toMatchObject({ boardSent: false, boardPart: 500 });
      await apiResponse(w.adm.api.v1.settings[':key'].$put({ param: { key: 'verification.unverifiedAtDeadline' }, json: { value: 'hold', reason: 'scenario: the school holds unverified sittings (Q-22)' } }));
      try {
        // Hold in force (its SETTING_CHANGED row: after the entries were made and sent) before the
        // retake deadline passed, a millisecond later; the sweep runs once that moment is behind it.
        const [on] = await sql<{ id: string }>(`select id from audit_log where action = 'SETTING_CHANGED' and entity_id = 'verification.unverifiedAtDeadline' order by created_at desc limit 1`);
        await sql(`update board_series set entry_deadline = now() - interval '2 minutes',
          retake_deadline = (select created_at + interval '1 millisecond' from audit_log where id = $1) where id = $2`, [on!.id, holdSeries]);
        const passes = new Date((await one<{ d: string }>(`select retake_deadline as d from board_series where id = $1`, [holdSeries])).d).getTime();
        await waitFor(async () => (Date.now() > passes + 50 && (await one<{ ok: boolean }>(`select now() > $1::timestamptz + interval '50 milliseconds' as ok`, [new Date(passes).toISOString()])).ok) || null);
        const run = await runPaymentDeadlines();
        expect(run.unverifiedDropped).toBeGreaterThanOrEqual(2);
        for (const id of [h1, h2]) expect((await lineOf(id)).status).toBe('dropped');
        // The board fee stays with the board for the line whose entry was sent; the other gets it back.
        expect(await credited(h1)).toBe(p1.amount);
        expect(await credited(h2)).toBe(p2.amount);
        expect(p2.amount - p1.amount).toBe(500);
        const reason = 'the declared sitting was not verified by its deadline (the school holds such lines)';
        const [s1] = await withdrawnWithLine(h1, reason);
        const [s2] = await withdrawnWithLine(h2, reason);
        expect([!!s1!.submitted_at, !!s2!.submitted_at]).toEqual([true, false]);
        const dropped = async (id: string) => (await one<{ n: Record<string, unknown> }>(`select new_data as n from audit_log where entity_id = $1 and action = 'LINE_DROPPED_UNVERIFIED'`, [id])).n;
        expect(await dropped(h1)).toMatchObject({ status: 'dropped', boardSent: true, entriesWithdrawn: 1, setting: 'hold' });
        expect(await dropped(h2)).toMatchObject({ status: 'dropped', boardSent: false, entriesWithdrawn: 1, setting: 'hold' });
        expect((await notified('parent.x-xw-h1@test.local', 'EXAM_ENTRY_WITHDRAWN', 1))[0]!.body)
          .toBe(`${T}97 Biology ${T} was withdrawn from Cambridge International June ${Y + 1} (exams xw hold): the declared sitting was not verified by its deadline`);
        expect(await notificationsFor('parent.x-xw-h2@test.local', 'EXAM_ENTRY_WITHDRAWN')).toEqual([]);
        const told = async (email: string) => (await notified(email, 'DECLARATION_REVIEWED', 1))[0]!.body;
        expect(await told('parent.x-xw-h1@test.local')).toContain('so its entry was withdrawn and it has been dropped');
        expect(await told('parent.x-xw-h1@test.local')).toContain('(the board fee stays with the board: the entry had been sent)');
        expect(await told('parent.x-xw-h2@test.local')).toContain('so it was not entered and has been dropped');
      } finally {
        await apiResponse(w.adm.api.v1.settings[':key'].$put({ param: { key: 'verification.unverifiedAtDeadline' }, json: { value: 'enter_as_declared', reason: 'scenario done' } }));
      }
    });
  });
});
