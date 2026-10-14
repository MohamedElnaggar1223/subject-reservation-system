import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { apiResponse, schoolDateString } from '@repo/validations';
import { refused, one, sql, audited, notified, type Client } from './helpers';
import { examWorld, type ExamWorld } from './exam-helpers';

/**
 * F4 — exam entries (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md).
 *
 * Candidates carry what the boards ask for (the name as on the ID, date of
 * birth, gender, Pearson's permanent UCI, a candidate number per series with
 * its history) and a national ID only the coordinator and admin can read.
 * Entries are derived from confirmed registrations per component: a
 * Cambridge syllabus as the award with its option code, Pearson units one by
 * one (a whole Pearson award as its units and the cash-in). The entry list
 * maps to each board portal's fields and flags what the board would refuse.
 * MO-10's hard stop holds for entries: no new entry after the deadline, while
 * a withdrawal after it is allowed and says what the board does with its fee.
 */

describe('F4: candidates and entries', () => {
  let w: ExamWorld;
  let coord: Client;
  let a: string, b: string, c: string;
  const entriesOf = (seriesId: string, studentId: string) =>
    sql<{ id: string; kind: string; entry_code: string; status: string; option_code: string | null; registration_id: string | null }>(
      `select id, kind, entry_code, status, option_code, registration_id from exam_entry where board_series_id = $1 and student_id = $2 and status <> 'withdrawn' order by entry_code`,
      [seriesId, studentId],
    );

  beforeAll(async () => {
    w = await examWorld('xe');
    coord = w.coordinator;
    [a, b, c] = [w.families.a.studentId, w.families.b.studentId, w.families.c.studentId];
    // The school's centre numbers: data, not code (Q-05).
    await apiResponse(w.adm.api.v1.settings[':key'].$put({
      param: { key: 'exams.centres' },
      json: { value: { cambridge: { centreNumber: 'EG123', route: 'direct' }, pearson_edexcel: { centreNumber: '91234', route: 'british_council' } }, reason: 'the centre numbers the boards issued (scenario)' },
    }));
  }, 120_000);

  afterAll(async () => {
    await w.close();
  });

  describe('candidates', () => {
    it('the name as on the ID, date of birth and gender are recorded and audited', async () => {
      const saved = await apiResponse(coord.api.v1.exams.candidates[':studentId'].$put({
        param: { studentId: a }, json: { legalForenames: 'Amira Hassan', legalSurname: 'Mostafa', dateOfBirth: '2008-03-14', gender: 'female' },
      }));
      expect(saved).toMatchObject({ legalForenames: 'Amira Hassan', legalSurname: 'Mostafa', dateOfBirth: '2008-03-14', gender: 'female' });
      await audited([a], ['CANDIDATE_UPDATED']);
      for (const [id, fore, sur] of [[b, 'Omar', 'Farouk'], [c, 'Laila', 'Nabil']] as const) {
        await apiResponse(coord.api.v1.exams.candidates[':studentId'].$put({ param: { studentId: id }, json: { legalForenames: fore, legalSurname: sur, dateOfBirth: '2008-06-01', gender: fore === 'Laila' ? 'female' : 'male' } }));
      }
    });

    it("a UCI is Pearson's 13 characters, belongs to one candidate, and is permanent: a correction needs a reason", async () => {
      expect((await refused(coord.api.v1.exams.candidates[':studentId'].$put({ param: { studentId: a }, json: { uci: '1234' } }))).status).toBe(400);
      await apiResponse(coord.api.v1.exams.candidates[':studentId'].$put({ param: { studentId: a }, json: { uci: '91234b260001k' } }));
      expect((await one<{ uci: string }>(`select uci from exam_candidate where student_id = $1`, [a])).uci).toBe('91234B260001K');
      expect(await refused(coord.api.v1.exams.candidates[':studentId'].$put({ param: { studentId: b }, json: { uci: '91234B260001K' } })))
        .toEqual({ status: 409, error: `The UCI 91234B260001K is already recorded for Student x-xe-a` });
      expect(await refused(coord.api.v1.exams.candidates[':studentId'].$put({ param: { studentId: a }, json: { uci: '91234B260009K' } })))
        .toEqual({ status: 409, error: 'The UCI 91234B260001K is permanent: say why it is being corrected' });
      await apiResponse(coord.api.v1.exams.candidates[':studentId'].$put({ param: { studentId: a }, json: { uci: '91234B260009K', uciCorrectionReason: 'a digit was typed wrong' } }));
      await audited([a], ['CANDIDATE_UPDATED', 'CANDIDATE_UPDATED', 'CANDIDATE_UCI_CORRECTED']);
      const row = await one<{ previous_data: { uci: string }; new_data: { uci: string; reason: string } }>(
        `select previous_data, new_data from audit_log where entity_id = $1 and action = 'CANDIDATE_UCI_CORRECTED'`, [a]);
      expect(row).toMatchObject({ previous_data: { uci: '91234B260001K' }, new_data: { uci: '91234B260009K', reason: 'a digit was typed wrong' } });
    });

    it('candidate numbers: one per candidate per series, kept from the last series where free, history kept', async () => {
      const preview = await apiResponse(coord.api.v1.exams['candidate-numbers'].assign.$post({ json: { boardSeriesId: w.series.pearsonJan, commit: false } }));
      expect(preview.committed).toBe(false);
      expect(preview.toAssign.map((x) => x.number)).toEqual(['0001', '0002', '0003']);
      expect(await sql(`select 1 from exam_candidate_number where board_series_id = $1`, [w.series.pearsonJan])).toHaveLength(0);
      const done = await apiResponse(coord.api.v1.exams['candidate-numbers'].assign.$post({ json: { boardSeriesId: w.series.pearsonJan, commit: true } }));
      expect(done.toAssign).toHaveLength(3);
      // Name order as on the ID: Farouk (b), Mostafa (a), Nabil (c).
      const nums = await sql<{ student_id: string; number: string; centre_number: string }>(
        `select student_id, number, centre_number from exam_candidate_number where board_series_id = $1 order by number`, [w.series.pearsonJan]);
      expect(nums.map((n) => [n.student_id, n.number, n.centre_number])).toEqual([[b, '0001', '91234'], [a, '0002', '91234'], [c, '0003', '91234']]);
      // Again: nothing new.
      expect((await apiResponse(coord.api.v1.exams['candidate-numbers'].assign.$post({ json: { boardSeriesId: w.series.pearsonJan, commit: true } }))).toAssign).toEqual([]);
      await apiResponse(coord.api.v1.exams['candidate-numbers'].assign.$post({ json: { boardSeriesId: w.series.cambridgeNov, commit: true } }));
      // A number taken by another candidate is refused, naming them.
      expect(await refused(coord.api.v1.exams['candidate-numbers'].$put({ json: { studentId: c, boardSeriesId: w.series.pearsonJan, number: '0001', reason: 'swap' } })))
        .toEqual({ status: 409, error: `Candidate number 0001 is already Student x-xe-b's in Pearson Edexcel January ${w.Y + 1} (exams xe)` });
      const detail = await apiResponse(coord.api.v1.exams.candidates[':studentId'].$get({ param: { studentId: a } }));
      expect(detail.numbers.map((n) => [n.boardCode, n.number]).sort()).toEqual([['cambridge', '0002'], ['pearson_edexcel', '0002']]);
    });
  });

  describe('entries derived from confirmed registrations per component', () => {
    it('a preview says what each registration enters; the commit makes each entry once', async () => {
      const preview = await apiResponse(coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId: w.series.pearsonJan, commit: false } }));
      expect(preview.summary).toEqual({ registrations: 3, newEntries: 5, notMapped: 0, updates: 0 });
      const byStudent = (id: string) => preview.rows.filter((r) => r.studentId === id).flatMap((r) => r.entries.map((e) => `${e.kind}:${e.entryCode}`)).sort();
      expect(byStudent(a)).toEqual([`unit:${w.T}WMA11`]);
      // A whole Pearson award: its required units and the cash-in.
      expect(byStudent(b)).toEqual([`award:${w.T}XMA01`, `unit:${w.T}WMA11`, `unit:${w.T}WMA12`]);
      expect(byStudent(c)).toEqual([`unit:${w.T}WMA11`]);
      expect(await sql(`select 1 from exam_entry where board_series_id = $1`, [w.series.pearsonJan])).toHaveLength(0);

      const done = await apiResponse(coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId: w.series.pearsonJan, commit: true } }));
      expect(done.created).toBe(5);
      expect((await entriesOf(w.series.pearsonJan, b)).map((e) => [e.kind, e.entry_code, e.status, e.registration_id])).toEqual([
        ['unit', `${w.T}WMA11`, 'draft', w.regs.b[w.subjects.spx]],
        ['unit', `${w.T}WMA12`, 'draft', w.regs.b[w.subjects.spx]],
        ['award', `${w.T}XMA01`, 'draft', w.regs.b[w.subjects.spx]],
      ].sort((x, y) => (x[1]! > y[1]! ? 1 : -1)));
      await audited([w.series.pearsonJan], ['EXAM_ENTRIES_DERIVED']);
      // A second commit makes nothing.
      expect((await apiResponse(coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId: w.series.pearsonJan, commit: true } }))).created).toBe(0);
    });

    it('a Cambridge syllabus is entered as the award; with two option codes the coordinator chooses one', async () => {
      const done = await apiResponse(coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId: w.series.cambridgeNov, commit: true } }));
      expect(done.created).toBe(2);
      for (const id of [a, b]) {
        expect((await entriesOf(w.series.cambridgeNov, id)).map((e) => [e.kind, e.entry_code, e.option_code])).toEqual([['award', `${w.T}97`, null]]);
      }
      const [ea] = await entriesOf(w.series.cambridgeNov, a);
      // An option code that is not the syllabus's is refused; one that is is set.
      expect((await refused(coord.api.v1.exams.entries[':id'].$put({ param: { id: ea!.id }, json: { optionCode: 'ZZ' } }))).status).toBe(400);
      const r = await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: ea!.id }, json: { optionCode: w.catalogue.optAll } }));
      expect(r.amendment).toBeNull();
      expect(r.entry).toMatchObject({ optionCode: 'A1', status: 'draft' });
      await audited([ea!.id], ['EXAM_ENTRY_UPDATED']);
    });

    it("a student's entries across series read in one place", async () => {
      const list = await apiResponse(coord.api.v1.exams.entries.$get({ query: { studentId: a } }));
      expect(list.map((e) => [e.seriesName, e.entryCode]).sort()).toEqual([
        [`Cambridge International November ${w.Y} (exams xe)`, `${w.T}97`],
        [`Pearson Edexcel January ${w.Y + 1} (exams xe)`, `${w.T}WMA11`],
      ]);
      expect(list.find((e) => e.entryCode === `${w.T}97`)).toMatchObject({ candidateNumber: '0002', teacherName: 'teacher x-xe', subjectName: `Biology ${w.T}` });
    });
  });

  describe('the entry list and its check', () => {
    it('flags a missing forecast grade (Cambridge requires one) and every other gap; the teacher of the subject fills it', async () => {
      const before = await apiResponse(coord.api.v1.exams['entry-lists'].$get({ query: { boardSeriesId: w.series.cambridgeNov } }));
      expect(before.columns.every((col) => col.assumed)).toBe(true);
      const rowA = before.rows.find((r) => r.studentId === a)!;
      const rowB = before.rows.find((r) => r.studentId === b)!;
      expect(rowA.problems).toEqual(['missing_forecast']);
      expect(rowB.problems).toEqual(['missing_option_code', 'missing_forecast']);
      expect(before.summary).toMatchObject({ missing_forecast: 2, missing_option_code: 1, missing_uci: 0, missing_centre_number: 0 });
      expect(rowA.values).toMatchObject({
        centreNumber: 'EG123', candidateNumber: '0002', candidateName: 'MOSTAFA, Amira Hassan', dateOfBirth: '14/03/2008', gender: 'F',
        syllabusCode: `${w.T}97`, optionCode: 'A1', retake: 'N', forecastGrade: '',
      });

      const [ea] = await entriesOf(w.series.cambridgeNov, a);
      const [eb] = await entriesOf(w.series.cambridgeNov, b);
      // A's teacher gives A's forecast; B is another teacher's candidate.
      expect(await apiResponse(w.teacher.api.v1.exams.entries[':id'].forecast.$put({ param: { id: ea!.id }, json: { grade: 'b' } }))).toMatchObject({ forecastGrade: 'b' });
      expect(await refused(w.teacher.api.v1.exams.entries[':id'].forecast.$put({ param: { id: eb!.id }, json: { grade: 'A' } })))
        .toEqual({ status: 403, error: "Only the candidate's teacher for this subject, or the coordinator, gives this forecast" });
      expect((await refused(w.teacher.api.v1.exams.entries[':id'].forecast.$put({ param: { id: ea!.id }, json: { grade: 'Z' } }))).status).toBe(400);
      // The teacher's own list holds only their candidates.
      const mine = await apiResponse(w.teacher.api.v1.exams.forecasts.$get({ query: { boardSeriesId: w.series.cambridgeNov } }));
      expect(mine.map((m) => [m.studentId, m.forecastGrade, m.forecastByName])).toEqual([[a, 'b', 'teacher x-xe']]);
      await apiResponse(w.teacher2.api.v1.exams.entries[':id'].forecast.$put({ param: { id: eb!.id }, json: { grade: 'C' } }));
      await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: eb!.id }, json: { optionCode: w.catalogue.optTwo } }));
      await audited([ea!.id], ['FORECAST_GRADE_SET']);

      const after = await apiResponse(coord.api.v1.exams['entry-lists'].$get({ query: { boardSeriesId: w.series.cambridgeNov } }));
      expect(after.rows.map((r) => r.problems)).toEqual([[], []]);
      expect(after.ready).toBe(2);
      expect(after.rows.find((r) => r.studentId === b)!.values).toMatchObject({ optionCode: 'B2', forecastGrade: 'C' });
    });

    it("Pearson's list asks for the UCI, not a forecast; the board's rules are data the coordinator changes", async () => {
      const list = await apiResponse(coord.api.v1.exams['entry-lists'].$get({ query: { boardSeriesId: w.series.pearsonJan } }));
      expect(list.rows).toHaveLength(5);
      const problems = Object.fromEntries(list.rows.map((r) => [`${r.studentId === a ? 'a' : r.studentId === b ? 'b' : 'c'}:${r.values.entryCode}`, r.problems]));
      expect(problems[`a:${w.T}WMA11`]).toEqual([]);
      expect(problems[`b:${w.T}XMA01`]).toEqual(['missing_uci']);
      expect(problems[`c:${w.T}WMA11`]).toEqual(['missing_uci']);
      expect(list.rows.find((r) => r.studentId === a)!.values).toMatchObject({ uci: '91234B260009K', surname: 'MOSTAFA', forenames: 'Amira Hassan', centreNumber: '91234', series: `January ${w.Y + 1}`, resit: 'N' });
      // The coordinator records that Pearson wants forecasts too: every row flags it; put back, none does.
      await apiResponse(coord.api.v1.exams['board-rules'][':boardCode'].$put({ param: { boardCode: 'pearson_edexcel' }, json: { forecastRequired: true, reason: 'checking the rule (scenario)' } }));
      expect((await apiResponse(coord.api.v1.exams['entry-lists'].$get({ query: { boardSeriesId: w.series.pearsonJan } }))).summary.missing_forecast).toBe(5);
      await apiResponse(coord.api.v1.exams['board-rules'][':boardCode'].$put({ param: { boardCode: 'pearson_edexcel' }, json: { forecastRequired: false, reason: 'put back (scenario)' } }));
      expect((await apiResponse(coord.api.v1.exams['entry-lists'].$get({ query: { boardSeriesId: w.series.pearsonJan } }))).summary.missing_forecast).toBe(0);
      await audited(['pearson_edexcel'], ['EXAM_BOARD_RULE_UPDATED', 'EXAM_BOARD_RULE_UPDATED']);
    });

    it('carry forward: a reference without the previous centre and candidate number is flagged until complete', async () => {
      const [ea] = await entriesOf(w.series.cambridgeNov, a);
      await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: ea!.id }, json: { carryForward: 'confirmed', cfFromMonth: 'june', cfFromYear: w.Y } }));
      let row = (await apiResponse(coord.api.v1.exams['entry-lists'].$get({ query: { boardSeriesId: w.series.cambridgeNov } }))).rows.find((r) => r.studentId === a)!;
      expect(row.problems).toEqual(['carry_forward_incomplete']);
      await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: ea!.id }, json: { cfCentreNumber: 'EG777', cfCandidateNumber: '0452' } }));
      row = (await apiResponse(coord.api.v1.exams['entry-lists'].$get({ query: { boardSeriesId: w.series.cambridgeNov } }))).rows.find((r) => r.studentId === a)!;
      expect(row.problems).toEqual([]);
      expect(row.values).toMatchObject({ previousCentre: 'EG777', previousCandidate: '0452', carryForwardFrom: `June ${w.Y}` });
      await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: ea!.id }, json: { carryForward: 'none', cfFromMonth: null, cfFromYear: null, cfCentreNumber: null, cfCandidateNumber: null } }));
    });

    it("a candidate with two entries in a Cambridge series lists both, in code order (Cambridge's columns carry no entry code)", async () => {
      const extra = await apiResponse(coord.api.v1.exams.entries.$post({ json: { studentId: a, boardSeriesId: w.series.cambridgeNov, unitId: w.catalogue.cp1 } }));
      const list = await apiResponse(coord.api.v1.exams['entry-lists'].$get({ query: { boardSeriesId: w.series.cambridgeNov } }));
      expect(list.rows.filter((r) => r.studentId === a).map((r) => r.values.syllabusCode)).toEqual([`${w.T}97`, `${w.T}97/12`]);
      await apiResponse(coord.api.v1.exams.entries[':id'].withdraw.$post({ param: { id: extra.id }, json: { reason: 'added for the scenario' } }));
    });

    it("an option's tier is the one its tiered components share (an untiered paper does not stop it); a forecast must fit the level", async () => {
      const cat = coord.api.v1.catalogue;
      const ig = await apiResponse(cat.qualifications.$post({ json: { boardCode: 'cambridge', code: `${w.T}0610`, title: 'Biology (IGCSE)', level: 'igcse', suite: 'Cambridge IGCSE', subjectArea: `Biology ${w.T}`, entryMethod: 'syllabus_option' } }));
      const comp = async (n: string, tier: 'extended' | null) => (await apiResponse(cat.units.$post({ json: { boardCode: 'cambridge', code: `${w.T}0610/${n}`, shortCode: `Paper ${n}`, title: `Paper ${n}`, unitLevel: 'igcse', kind: 'component', tier } }))).id;
      const [p22, p62] = [await comp('22', 'extended'), await comp('62', null)];
      await apiResponse(cat.qualifications[':id'].units.$put({ param: { id: ig.id }, json: { units: [p22, p62].map((unitId) => ({ unitId, requirement: 'optional' as const })) } }));
      await apiResponse(cat.qualifications[':id'].options.$post({ param: { id: ig.id }, json: { code: 'BX', label: 'Extended: Papers 2 and 6', unitIds: [p22, p62] } }));
      const e = await apiResponse(coord.api.v1.exams.entries.$post({ json: { studentId: a, boardSeriesId: w.series.cambridgeNov, qualificationId: ig.id } }));
      const r = await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: e.id }, json: { optionCode: 'BX' } }));
      expect(r.entry).toMatchObject({ optionCode: 'BX', tier: 'extended' });
      // An IGCSE forecast is A*–G, U or 9–1: a lower-case AS grade is refused.
      expect(await refused(coord.api.v1.exams.entries[':id'].forecast.$put({ param: { id: e.id }, json: { grade: 'b' } })))
        .toEqual({ status: 400, error: 'An IGCSE forecast grade is A*–G or U, or 9–1' });
      expect(await apiResponse(coord.api.v1.exams.entries[':id'].forecast.$put({ param: { id: e.id }, json: { grade: '7' } }))).toMatchObject({ forecastGrade: '7' });
      await apiResponse(coord.api.v1.exams.entries[':id'].withdraw.$post({ param: { id: e.id }, json: { reason: 'added for the scenario' } }));
    });
  });

  describe("MO-10's hard stop, withdrawals and amendments", () => {
    let manualDraft: string;

    it('entries go to the board with the fee tier of the day (information only)', async () => {
      const ids = [...(await entriesOf(w.series.cambridgeNov, a)), ...(await entriesOf(w.series.cambridgeNov, b))].map((e) => e.id);
      expect(await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: ids } }))).toEqual({ submitted: 2, skipped: 0 });
      const rows = await sql<{ status: string; fee_tier_at_submission: string }>(`select status, fee_tier_at_submission from exam_entry where id in ($1, $2)`, ids);
      expect(rows).toEqual([{ status: 'submitted', fee_tier_at_submission: 'standard' }, { status: 'submitted', fee_tier_at_submission: 'standard' }]);
      // A draft for C made by hand before the deadline, never sent.
      manualDraft = (await apiResponse(coord.api.v1.exams.entries.$post({ json: { studentId: c, boardSeriesId: w.series.cambridgeNov, qualificationId: w.catalogue.cSyllabus } }))).id;
    });

    it('past the deadline a new entry is refused, and a draft cannot be sent; a withdrawal is allowed with the board\'s fee shown', async () => {
      // The window closed and the Cambridge deadline passed (as 08i moves them) — just
      // after the last entry was made and sent, as it would in time (09 checks it).
      await sql(`update registration_session set end_date = now() - interval '1 day' where id = $1`, [w.windowId]);
      await sql(`update board_series set entry_deadline = (select max(greatest(created_at, coalesce(submitted_at, created_at))) + interval '1 millisecond' from exam_entry where board_series_id = $1) where id = $2`, [w.series.cambridgeNov, w.series.cambridgeNov]);
      const deadline = await one<{ d: string }>(`select entry_deadline as d from board_series where id = $1`, [w.series.cambridgeNov]);
      const when = new Date(deadline.d).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });
      const stop = `The entry deadline for Cambridge International November ${w.Y} (exams xe) (${when}) has passed: the school makes no new entries after it — the board's late entries are not taken (MO-10)`;

      // A new entry, by hand or derived, is refused.
      await sql(`update exam_entry set status = 'withdrawn', withdrawn_at = now(), withdrawal_reason = 'set aside for the scenario' where id = $1`, [manualDraft]);
      expect(await refused(coord.api.v1.exams.entries.$post({ json: { studentId: c, boardSeriesId: w.series.cambridgeNov, qualificationId: w.catalogue.cSyllabus } })))
        .toEqual({ status: 409, error: stop });
      expect(await refused(coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId: w.series.cambridgeNov, commit: true } }))).toEqual({ status: 409, error: stop });
      const preview = await apiResponse(coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId: w.series.cambridgeNov, commit: false } }));
      expect(preview).toMatchObject({ pastDeadline: true, refusal: stop });
      // Sending a draft after the deadline is sending a late entry: refused.
      await sql(`update exam_entry set status = 'draft', withdrawn_at = null, withdrawal_reason = null where id = $1`, [manualDraft]);
      expect(await refused(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [manualDraft] } }))).toEqual({ status: 409, error: stop });
      // …unless it truly went before the deadline: the time it went is recorded.
      const before = new Date(new Date(deadline.d).getTime() - 1);
      expect(await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [manualDraft], submittedAt: before } }))).toEqual({ submitted: 1, skipped: 0 });

      // A withdrawal after the deadline is allowed, and says what Cambridge does with its fee.
      const [eb] = await entriesOf(w.series.cambridgeNov, b);
      const out = await apiResponse(coord.api.v1.exams.entries[':id'].withdraw.$post({ param: { id: eb!.id }, json: { reason: 'the family moved abroad' } }));
      const deadlineDay = new Date(deadline.d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });
      expect(out.charge).toEqual({
        refunded: false,
        sentence: `Withdrawn after ${deadlineDay}: Cambridge International keeps the entry fee. Assumed (not in the research): after the entry deadline Cambridge keeps the entry fee for a withdrawn entry — check the Cambridge Handbook.`,
      });
      expect(out.entry).toMatchObject({ status: 'withdrawn', withdrawalRefunded: false, withdrawalReason: 'the family moved abroad' });
      const audit = await one<{ new_data: { pastDeadline: boolean; refunded: boolean } }>(`select new_data from audit_log where entity_id = $1 and action = 'EXAM_ENTRY_WITHDRAWN'`, [eb!.id]);
      expect(audit.new_data).toMatchObject({ pastDeadline: true, refunded: false });
      // The family had been told of the entry: they are told of the withdrawal.
      const told = await notified(`parent.x-xe-b@test.local`, 'EXAM_ENTRY_WITHDRAWN', 1);
      expect(told[0]!.body).toBe(`${w.T}97 Biology ${w.T} was withdrawn from Cambridge International November ${w.Y} (exams xe): the family moved abroad`);
      // No money moved: the family's escrow and payments are as they were.
      expect(await sql(`select 1 from escrow_transaction et join escrow e on e.id = et.escrow_id where e.student_id = $1`, [b])).toHaveLength(0);
      expect((await refused(coord.api.v1.exams.entries[':id'].withdraw.$post({ param: { id: eb!.id }, json: { reason: 'again' } }))).status).toBe(409);
    });

    it('an amendment after the deadline follows the board\'s rules: Cambridge takes it with a fee, and it needs a reason', async () => {
      const [ea] = await entriesOf(w.series.cambridgeNov, a);
      expect(await refused(coord.api.v1.exams.entries[':id'].$put({ param: { id: ea!.id }, json: { optionCode: w.catalogue.optTwo } })))
        .toEqual({ status: 400, error: 'This entry has gone to Cambridge International: say why it is amended' });
      const r = await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: ea!.id }, json: { optionCode: w.catalogue.optTwo, reason: 'practical exemption confirmed' } }));
      expect(r.entry).toMatchObject({ status: 'amended', optionCode: 'B2', amendmentCount: 1 });
      expect(r.amendment!.feeDue).toBe(true);
      expect(r.amendment!.sentence).toMatch(/^Changed after .+: Cambridge International charges a fee for this change\. Cambridge charges a late fee for every change made after the entry deadline\.$/);
      // A board that refuses amendments after its deadline refuses it (the rule is data).
      await apiResponse(coord.api.v1.exams['board-rules'][':boardCode'].$put({ param: { boardCode: 'cambridge' }, json: { amendmentAfterDeadline: 'refused', reason: 'scenario' } }));
      expect(await refused(coord.api.v1.exams.entries[':id'].$put({ param: { id: ea!.id }, json: { optionCode: w.catalogue.optAll, reason: 'back' } })))
        .toEqual({ status: 409, error: `Cambridge International takes no amendments after the entry deadline for Cambridge International November ${w.Y} (exams xe): withdraw the entry instead` });
      await apiResponse(coord.api.v1.exams['board-rules'][':boardCode'].$put({ param: { boardCode: 'cambridge' }, json: { amendmentAfterDeadline: 'allowed_with_fee', reason: 'scenario done' } }));
    });

    it("Pearson refunds a withdrawn entry up to its high-late date; a draft was never sent and costs nothing", async () => {
      const high = schoolDateString(new Date(Date.now() + 20 * 86_400_000));
      await apiResponse(w.adm.api.v1['board-series'][':id'].$put({ param: { id: w.series.pearsonJan }, json: { highLateFeeFrom: high, lateFeeFrom: schoolDateString(new Date(Date.now() + 10 * 86_400_000)) } }));
      const cEntries = await entriesOf(w.series.pearsonJan, c);
      const draft = await apiResponse(coord.api.v1.exams.entries[':id'].withdraw.$post({ param: { id: cEntries[0]!.id }, json: { reason: 'dropping P1' } }));
      expect(draft.charge).toEqual({ refunded: null, sentence: 'Never submitted to the board: nothing to pay and nothing to refund.' });
      // C's registration is still confirmed: a derivation does not make the withdrawn entry again.
      const again = await apiResponse(coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId: w.series.pearsonJan, studentId: c, commit: true } }));
      expect(again.created).toBe(0);
      expect(again.rows.map((r) => [r.outcome, r.entries.map((e) => e.state)])).toEqual([['withdrawn', ['withdrawn']]]);
      const list = await apiResponse(coord.api.v1.exams['entry-lists'].$get({ query: { boardSeriesId: w.series.pearsonJan } }));
      expect(list.unentered.find((u) => u.studentId === c)?.withdrawnAt).toBeTruthy();
      const aEntries = await entriesOf(w.series.pearsonJan, a);
      await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: aEntries.map((e) => e.id) } }));
      const sent = await apiResponse(coord.api.v1.exams.entries[':id'].withdraw.$post({ param: { id: aEntries[0]!.id }, json: { reason: 'sitting it in June' } }));
      const highWords = new Date(`${high}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });
      expect(sent.charge).toEqual({
        refunded: true,
        sentence: `Withdrawn on or before ${highWords}: Pearson Edexcel refunds the entry fee. Pearson refunds an entry automatically up to the high-late fee date; after it the entry fee is kept.`,
      });
    });
  });

  describe('forecast grades go to the board once', () => {
    it("Cambridge fixes a forecast once sent: the teacher's change is refused after", async () => {
      const r = await apiResponse(coord.api.v1.exams.forecasts.submit.$post({ json: { boardSeriesId: w.series.cambridgeNov } }));
      expect(r.locked).toBe(1); // A's (B's entry was withdrawn)
      const [ea] = await entriesOf(w.series.cambridgeNov, a);
      expect(await refused(w.teacher.api.v1.exams.entries[':id'].forecast.$put({ param: { id: ea!.id }, json: { grade: 'a' } })))
        .toEqual({ status: 409, error: 'This forecast grade has gone to the board, which does not accept a change to it' });
    });
  });

  describe('national IDs', () => {
    const NID = '30803141234567';
    it('are read only by the coordinator and the admin, each read audited without the number; never in a list, a log or an audit row', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
      try {
        expect(await apiResponse(coord.api.v1.exams.candidates[':studentId'].identity.$put({ param: { studentId: a }, json: { documentType: 'national_id', documentNumber: NID } })))
          .toEqual({ documentType: 'national_id', masked: '••••••••••4567', changed: true });
        expect(await refused(coord.api.v1.exams.candidates[':studentId'].identity.$put({ param: { studentId: b }, json: { documentType: 'national_id', documentNumber: '1234' } })))
          .toMatchObject({ status: 400 });
        // The same number for another candidate: refused, and the driver's error (which carries it) reaches no log.
        expect(await refused(coord.api.v1.exams.candidates[':studentId'].identity.$put({ param: { studentId: b }, json: { documentType: 'national_id', documentNumber: NID } })))
          .toEqual({ status: 409, error: 'This document number is already recorded for another candidate — check it against the document' });

        const read = await apiResponse(coord.api.v1.exams.candidates[':studentId'].identity.$get({ param: { studentId: a } }));
        expect(read).toMatchObject({ documentType: 'national_id', documentNumber: NID });
        expect(await apiResponse(w.adm.api.v1.exams.candidates[':studentId'].identity.$get({ param: { studentId: a } }))).toMatchObject({ documentNumber: NID });
        await audited([a], ['CANDIDATE_IDENTITY_RECORDED', 'CANDIDATE_IDENTITY_VIEWED', 'CANDIDATE_IDENTITY_VIEWED']);

        // Everyone else is refused: the desk, a teacher, the gate, the family itself.
        for (const who of [w.officer, w.finadmin, w.teacher, w.gate, w.families.a.parent, w.families.a.student]) {
          expect((await refused(who.api.v1.exams.candidates[':studentId'].identity.$get({ param: { studentId: a } }))).status).toBe(403);
        }
        // Lists, the candidate's page and entry lists carry whether one is recorded, never the number.
        const list = await apiResponse(coord.api.v1.exams.candidates.$get({ query: {} }));
        expect(JSON.stringify(list)).not.toContain(NID);
        expect(list.candidates.find((x) => x.studentId === a)).toMatchObject({ hasIdDocument: true, idDocumentType: 'national_id' });
        const detail = await apiResponse(coord.api.v1.exams.candidates[':studentId'].$get({ param: { studentId: a } }));
        expect(JSON.stringify(detail)).not.toContain(NID);
        expect(detail.idDocument).toMatchObject({ documentType: 'national_id', masked: '••••••••••4567' });
        for (const s of [w.series.cambridgeNov, w.series.pearsonJan]) {
          expect(JSON.stringify(await apiResponse(coord.api.v1.exams['entry-lists'].$get({ query: { boardSeriesId: s } })))).not.toContain(NID);
        }
        expect(await sql(`select 1 from audit_log where coalesce(previous_data::text, '') || coalesce(new_data::text, '') like $1`, [`%${NID}%`])).toHaveLength(0);
        for (const spy of spies) {
          for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(NID);
        }
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });
  });
});
