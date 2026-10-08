import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import { onboard, refused, one, sql, audited, notified, money, CONSENT, type Client } from './helpers';
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
    });

    it('the same line with none sent: the board fee comes back in full', async () => {
      const was = money((await sql<{ b: string }>(`select balance as b from escrow where student_id = $1`, [fam.r2!.studentId]))[0]?.b ?? 0);
      const p = await preview(fam.r2!, lines.r2!);
      expect(p).toMatchObject({ coursePart: 500, boardPart: 1000, amount: 1500, boardSent: false });
      const drop = await apiResponse(fam.r2!.parent.api.v1.registrations[':id'].drop.$post({ param: { id: lines.r2! }, json: { reason: 'refund check: none sent' } }));
      expect(drop).toMatchObject({ refundAmount: 1500 });
      expect(money((await one<{ b: string }>(`select balance as b from escrow where student_id = $1`, [fam.r2!.studentId])).b)).toBe(was + 1500);
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
      expect((await one<{ d: { byDeskDrop: string } }>(`select new_data as d from audit_log where entity_id = $1 and action = 'EXAM_ENTRY_WITHDRAWN'`, [e.id])).d.byDeskDrop).toBe(j1);
      const told = await notified(`parent.x-xw-j1@test.local`, 'EXAM_ENTRY_WITHDRAWN', 1);
      expect(told[0]!.body).toBe(`${T}97 Biology ${T} was withdrawn from Cambridge International June ${Y + 1} (exams xw june): the family moved abroad`);
      expect((await notified(`parent.x-xw-j1@test.local`, 'DROP_SWAP_PROCESSED', 1))[0]!.body).toContain(`The board fee stays with the board: the school sent ${T}97`);
    });
  });
});
