import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import { refused, one, sql, audited, notified, type Client } from './helpers';
import { examWorld, dayFromNow, xlsxOf, type ExamWorld } from './exam-helpers';

/**
 * F4 — the exam timetable, exam days, results and certificates
 * (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md).
 *
 * A board's timetable pasted with a column mapping becomes each candidate's
 * own; a clash (two papers at once, extra time counted) is flagged across
 * boards; families see their statement of entry once it is published. Rooms
 * are seated with no seat double-booked; invigilators keep the register of
 * their own room. Results files are read through a mapping and keep every
 * attempt; publication shows them to families and gives a registration the
 * board's grade. Certificates are received, collected once, and unclaimed
 * ones kept for the retention period.
 */

const toDmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

describe('F4: exam days, results and certificates', () => {
  let w: ExamWorld;
  let coord: Client;
  let a: string, b: string, c: string;
  const d1 = dayFromNow(30);
  const d2 = dayFromNow(31);
  let hall: string, room2: string;
  const paperId = async (code: string) => (await one<{ id: string }>(`select id from exam_paper where code = $1`, [code])).id;

  beforeAll(async () => {
    // No centre numbers recorded yet (08x1 records them; this suite starts without).
    await sql(`delete from school_setting where key = 'exams.centres'`);
    w = await examWorld('xd');
    coord = w.coordinator;
    [a, b, c] = [w.families.a.studentId, w.families.b.studentId, w.families.c.studentId];
    const cand = (studentId: string, json: Record<string, unknown>) => apiResponse(coord.api.v1.exams.candidates[':studentId'].$put({ param: { studentId }, json }));
    await cand(a, { legalForenames: 'Amira', legalSurname: 'Mostafa', dateOfBirth: '2008-03-14', gender: 'female', uci: '91234B260101A', accessArrangements: ['extra_time_25'], accessArrangementsRef: 'AA-2026-17' });
    await cand(b, { legalForenames: 'Omar', legalSurname: 'Farouk', dateOfBirth: '2008-05-02', gender: 'male', uci: '91234B260102B' });
    await cand(c, { legalForenames: 'Laila', legalSurname: 'Nabil', dateOfBirth: '2008-07-09', gender: 'female', uci: '91234B260103C' });
    for (const s of [w.series.cambridgeNov, w.series.pearsonJan]) {
      await apiResponse(coord.api.v1.exams['candidate-numbers'].assign.$post({ json: { boardSeriesId: s, commit: true } }));
      await apiResponse(coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId: s, commit: true } }));
    }
    const cam = await sql<{ id: string }>(`select id from exam_entry where board_series_id = $1`, [w.series.cambridgeNov]);
    for (const e of cam) await apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: e.id }, json: { optionCode: w.catalogue.optAll } }));
    const all = await sql<{ id: string }>(`select id from exam_entry where board_series_id in ($1, $2)`, [w.series.cambridgeNov, w.series.pearsonJan]);
    await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: all.map((e) => e.id) } }));
    hall = (await apiResponse(coord.api.v1.academic.rooms.$post({ json: { name: 'XD Hall', capacity: 60, type: 'hall', features: [] } }))).id;
    room2 = (await apiResponse(coord.api.v1.academic.rooms.$post({ json: { name: 'XD Room 2', capacity: 20, type: 'classroom', features: [] } }))).id;
  }, 120_000);

  afterAll(async () => {
    await w.close();
  });

  describe('the exam timetable', () => {
    const cambridgeText = () => [
      'Component\tSubject\tDate\tSession\tStart\tDuration',
      `XD97/12\tBiology Paper 1\t${toDmy(d1)}\tAM\t09:00\t1h 15m`,
      `XD97/22\tBiology Paper 2\t${toDmy(d1)}\tPM\t1:30 pm\t1:30`,
      `XD97/33\tBiology Paper 3\t${toDmy(d2)}\tAM\t09:00\t120`,
    ].join('\n');

    it("a board's timetable pasted as a table: the columns are read from the headings, each line previewed, then kept", async () => {
      const preview = await apiResponse(coord.api.v1.exams.papers.import.$post({ json: { boardSeriesId: w.series.cambridgeNov, text: cambridgeText(), commit: false } }));
      expect(preview.mapping).toEqual({ code: 'Component', title: 'Subject', date: 'Date', session: 'Session', startTime: 'Start', duration: 'Duration' });
      expect(preview.lines.map((l) => [l.code, l.examDate, l.session, l.startTime, l.durationMinutes, l.outcome, l.linked])).toEqual([
        ['XD97/12', d1, 'am', '09:00', 75, 'new', true],
        ['XD97/22', d1, 'pm', '13:30', 90, 'new', true],
        ['XD97/33', d2, 'am', '09:00', 120, 'new', true],
      ]);
      expect(await sql(`select 1 from exam_paper where board_series_id = $1`, [w.series.cambridgeNov])).toHaveLength(0);
      await apiResponse(coord.api.v1.exams.papers.import.$post({ json: { boardSeriesId: w.series.cambridgeNov, text: cambridgeText(), commit: true } }));
      // The same paste again changes nothing; a line that moved is a change.
      expect((await apiResponse(coord.api.v1.exams.papers.import.$post({ json: { boardSeriesId: w.series.cambridgeNov, text: cambridgeText(), commit: false } }))).summary)
        .toMatchObject({ new: 0, changed: 0, unchanged: 3, errors: 0 });
      const bad = await apiResponse(coord.api.v1.exams.papers.import.$post({ json: { boardSeriesId: w.series.cambridgeNov, text: `${cambridgeText()}\nXD97/41\tBiology Paper 4\tnext week\tAM\t9\t??`, commit: false } }));
      expect(bad.lines[3]).toMatchObject({ outcome: 'error', problems: ['"next week" is not a date', '"??" is not a duration'] });
      expect((await refused(coord.api.v1.exams.papers.import.$post({ json: { boardSeriesId: w.series.cambridgeNov, text: `${cambridgeText()}\nXD97/41\tBiology Paper 4\tnext week\tAM\t9\t??`, commit: true } }))).status).toBe(400);
      // Pearson's papers, entered one by one.
      for (const [code, title, examDate, session, startTime, durationMinutes] of [
        ['XDWMA11/01', 'Pure Mathematics P1', d1, 'am', '09:00', 90],
        ['XDWMA12/01', 'Pure Mathematics P2', d2, 'pm', '13:00', 90],
      ] as const) {
        await apiResponse(coord.api.v1.exams.papers.$post({ json: { boardSeriesId: w.series.pearsonJan, code, title, examDate, session, startTime, durationMinutes } }));
      }
      const pj = await apiResponse(coord.api.v1.exams.papers.$get({ query: { boardSeriesId: w.series.pearsonJan } }));
      // Linked to its unit by the code the board prints (WMA11/01 is unit WMA11); A, B and C sit P1.
      expect(pj.papers.map((p) => [p.code, p.unitCode, p.candidates])).toEqual([['XDWMA11/01', 'XDWMA11', 3], ['XDWMA12/01', 'XDWMA12', 1]]);
      await audited([w.series.cambridgeNov], ['EXAM_PAPERS_IMPORTED']);
    });

    it("each candidate's own timetable, extra time counted; a clash across boards flagged, and how it is handled noted", async () => {
      const tt = await apiResponse(coord.api.v1.exams.students[':studentId'].timetable.$get({ param: { studentId: a }, query: {} }));
      expect(tt.papers.map((p) => [p.code, p.examDate, p.startTime, p.endTime, p.extraMinutes])).toEqual([
        ['XD97/12', d1, '09:00', '10:34', 19],
        ['XDWMA11/01', d1, '09:00', '10:53', 23],
        ['XD97/22', d1, '13:30', '15:23', 23],
        ['XD97/33', d2, '09:00', '11:30', 30],
      ]);
      expect(tt.clashes).toHaveLength(1);
      expect(tt.clashes[0]!.papers.map((p) => p.code).sort()).toEqual(['XD97/12', 'XDWMA11/01']);

      const clashes = await apiResponse(coord.api.v1.exams.clashes.$get({ query: { boardSeriesId: w.series.cambridgeNov } }));
      expect(clashes.map((x) => x.studentId).sort()).toEqual([a, b].sort());
      const aClash = clashes.find((x) => x.studentId === a)!;
      expect(aClash.note).toBeNull();
      await apiResponse(coord.api.v1.exams.clashes.$put({ json: { studentId: a, paperIds: [aClash.papers[1]!.paperId, aClash.papers[0]!.paperId], resolution: 'Cambridge first, supervised, then Pearson at 10:45' } }));
      expect((await apiResponse(coord.api.v1.exams.clashes.$get({ query: { boardSeriesId: w.series.cambridgeNov } }))).find((x) => x.studentId === a)!.note)
        .toBe('Cambridge first, supervised, then Pearson at 10:45');
      // Two papers that do not clash cannot be noted as a clash.
      expect(await refused(coord.api.v1.exams.clashes.$put({ json: { studentId: a, paperIds: [await paperId('XD97/12'), await paperId('XD97/33')], resolution: 'none' } })))
        .toEqual({ status: 400, error: 'These papers do not clash for this candidate' });
    });

    it('families see the statement of entry and the timetable once published, and are told; F2/F3 read the day', async () => {
      expect(await refused(w.families.a.parent.api.v1.exams.students[':studentId'].statement.$get({ param: { studentId: a }, query: { boardSeriesId: w.series.cambridgeNov } })))
        .toEqual({ status: 404, error: `The statement of entry for Cambridge International November ${w.Y} (exams xd) is not ready yet` });
      expect((await apiResponse(w.families.a.parent.api.v1.exams.students[':studentId'].timetable.$get({ param: { studentId: a }, query: {} }))).papers).toEqual([]);
      const pub = await apiResponse(coord.api.v1.exams.timetable.publish.$post({ json: { boardSeriesId: w.series.cambridgeNov } }));
      expect(pub).toMatchObject({ version: 1, candidatesTold: 2 });
      const told = await notified('parent.x-xd-a@test.local', 'EXAM_TIMETABLE_PUBLISHED', 1);
      expect(told[0]!.title).toBe(`Your Cambridge International November ${w.Y} (exams xd) exam timetable`);
      await notified('student.x-xd-a@test.local', 'EXAM_TIMETABLE_PUBLISHED', 1);

      const st = await apiResponse(w.families.a.parent.api.v1.exams.students[':studentId'].statement.$get({ param: { studentId: a }, query: { boardSeriesId: w.series.cambridgeNov } }));
      expect(st.centre).toEqual({ centreNumber: null, route: 'direct' });
      expect(st.candidate).toMatchObject({ legalSurname: 'Mostafa', uci: '91234B260101A', candidateNumber: '0002', accessArrangements: ['extra_time_25'] });
      expect(st.entries.map((e) => [e.entryCode, e.optionCode, e.status])).toEqual([['XD97', 'A1', 'submitted']]);
      expect(st.papers.map((p) => p.code)).toEqual(['XD97/12', 'XD97/22', 'XD97/33']);
      // A family sees only the published series (Pearson's is not published yet).
      const famTt = await apiResponse(w.families.a.student.api.v1.exams.students[':studentId'].timetable.$get({ param: { studentId: a }, query: {} }));
      expect(famTt.papers.map((p) => p.code)).toEqual(['XD97/12', 'XD97/22', 'XD97/33']);
      // F2 and F3's contract: the papers of a day, with the candidate's own end time.
      const day = await apiResponse(coord.api.v1.exams.students[':studentId'].exams.$get({ param: { studentId: a }, query: { date: d1 } }));
      expect(day.map((x) => [x.code, x.startTime, x.endTime, x.session])).toEqual([
        ['XD97/12', '09:00', '10:34', 'am'], ['XDWMA11/01', '09:00', '10:53', 'am'], ['XD97/22', '13:30', '15:23', 'pm'],
      ]);
      expect(await apiResponse(coord.api.v1.exams.students[':studentId'].exams.$get({ param: { studentId: a }, query: { date: dayFromNow(40) } }))).toEqual([]);
      // A paper moved after publication: its candidates' families are told.
      const moved = await apiResponse(coord.api.v1.exams.papers[':id'].$put({ param: { id: await paperId('XD97/33') }, json: { startTime: '10:00', reason: 'the board moved it' } }));
      expect(moved.familiesTold).toBe(2);
      await notified('parent.x-xd-b@test.local', 'EXAM_TIMETABLE_CHANGED', 1);
    });
  });

  describe('rooms and seats', () => {
    const am = () => ({ examDate: d1, session: 'am' as const });

    it('a sitting is seated room by room, candidates of a paper together; no seat holds two candidates', async () => {
      await apiResponse(coord.api.v1.exams.sittings.rooms.$put({ json: { ...am(), rooms: [{ roomId: hall, seatRows: 2, seatColumns: 2 }, { roomId: room2, seatRows: 1, seatColumns: 2 }] } }));
      const preview = await apiResponse(coord.api.v1.exams.sittings.seat.$post({ json: { ...am(), commit: false } }));
      expect(preview.assigned.map((s) => [s.studentId, s.roomName, s.seatLabel])).toEqual([[b, 'XD Hall', 'A1'], [a, 'XD Hall', 'A2'], [c, 'XD Hall', 'B1']]);
      await apiResponse(coord.api.v1.exams.sittings.seat.$post({ json: { ...am(), commit: true } }));
      expect((await apiResponse(coord.api.v1.exams.sittings.seat.$post({ json: { ...am(), commit: true } }))).assigned).toEqual([]);

      // A seat already taken is refused, naming who sits there.
      expect(await refused(coord.api.v1.exams.seats.$put({ json: { ...am(), studentId: c, roomId: hall, seatLabel: 'A1' } })))
        .toEqual({ status: 409, error: 'Seat A1 in XD Hall is already Student x-xd-b\'s' });
      expect(await refused(coord.api.v1.exams.seats.$put({ json: { ...am(), studentId: c, roomId: hall, seatLabel: 'C3' } })))
        .toEqual({ status: 400, error: 'XD Hall has rows A–B and seats 1–2' });
      // Moving a candidate frees their seat.
      await apiResponse(coord.api.v1.exams.seats.$put({ json: { ...am(), studentId: c, roomId: room2, seatLabel: 'A1' } }));
      const plan = await apiResponse(coord.api.v1.exams.sittings.plan.$get({ query: am() }));
      expect(plan.rooms.map((r) => [r.name, r.seats.map((s) => `${s.seatLabel}:${s.studentId}`)])).toEqual([
        ['XD Hall', [`A1:${b}`, `A2:${a}`]],
        ['XD Room 2', [`A1:${c}`]],
      ]);
      expect(plan.unseated).toEqual([]);
      // The database refuses a double-booked seat whatever the application does.
      await expect(sql(`insert into exam_seat (id, exam_date, session, room_id, seat_label, student_id) values (gen_random_uuid()::text, $1, 'am', $2, 'A1', $3)`, [d1, hall, a])).rejects.toThrow();
      // A room holding candidates cannot leave the sitting, nor shrink under them.
      expect((await refused(coord.api.v1.exams.sittings.rooms.$put({ json: { ...am(), rooms: [{ roomId: hall, seatRows: 2, seatColumns: 2 }] } }))).status).toBe(409);
      expect(await refused(coord.api.v1.exams.sittings.rooms.$put({ json: { ...am(), rooms: [{ roomId: hall, seatRows: 1, seatColumns: 1 }, { roomId: room2, seatRows: 1, seatColumns: 2 }] } })))
        .toEqual({ status: 409, error: "XD Hall's smaller grid would leave 1 candidate(s) without a seat: move them first" });
    });

    it('invigilators: one room each per sitting; a teacher keeps only the register of their own room', async () => {
      await apiResponse(coord.api.v1.exams.invigilation.$put({ json: { ...am(), roomId: hall, teacherIds: [w.teacherId], leadTeacherId: w.teacherId } }));
      expect(await refused(coord.api.v1.exams.invigilation.$put({ json: { ...am(), roomId: room2, teacherIds: [w.teacherId] } })))
        .toEqual({ status: 409, error: 'teacher x-xd already invigilates XD Hall in this sitting' });
      await apiResponse(coord.api.v1.exams.invigilation.$put({ json: { ...am(), roomId: room2, teacherIds: [w.teacher2Id] } }));
      const sittings = await apiResponse(coord.api.v1.exams.sittings.$get({ query: { boardSeriesId: w.series.cambridgeNov } }));
      const s1 = sittings.sittings.find((s) => s.examDate === d1 && s.session === 'am')!;
      expect(s1).toMatchObject({ candidates: 3, seated: 3 });
      expect(s1.rooms.map((r) => [r.name, r.seated, r.invigilators, r.invigilatorsNeeded])).toEqual([['XD Hall', 2, 1, 1], ['XD Room 2', 1, 1, 1]]);

      const duties = await apiResponse(w.teacher.api.v1.exams.invigilation.mine.$get());
      expect(duties.duties.map((d) => [d.examDate, d.session, d.roomName, d.isLead, d.candidates, d.papers.map((p) => p.code).sort()])).toEqual([
        [d1, 'am', 'XD Hall', true, 2, ['XD97/12', 'XDWMA11/01']],
      ]);
      const p1 = await paperId('XD97/12');
      const reg = await apiResponse(w.teacher.api.v1.exams.registers.$get({ query: { paperId: p1 } }));
      expect(reg.rows.map((r) => [r.candidateNumber, r.studentId, r.seatLabel])).toEqual([['0001', b, 'A1'], ['0002', a, 'A2']]);
      expect(reg.centreNumber).toBeNull();
      // Another room's register, or another teacher's, is refused.
      expect((await refused(w.teacher.api.v1.exams.registers.$get({ query: { paperId: p1, roomId: room2 } }))).status).toBe(403);
      expect((await refused(w.teacher2.api.v1.exams.registers.$get({ query: { paperId: p1, roomId: hall } }))).status).toBe(403);
      await apiResponse(w.teacher.api.v1.exams.registers.$put({ json: { paperId: p1, marks: [{ studentId: a, status: 'present' }, { studentId: b, status: 'late', minutesLate: 10 }] } }));
      expect((await refused(w.teacher.api.v1.exams.registers.$put({ json: { paperId: p1, marks: [{ studentId: c, status: 'absent' }] } }))).status).toBe(400);
      const pw = await paperId('XDWMA11/01');
      expect((await refused(w.teacher.api.v1.exams.registers.$put({ json: { paperId: pw, marks: [{ studentId: c, status: 'absent' }] } }))).status).toBe(403);
      const full = await apiResponse(coord.api.v1.exams.registers.$get({ query: { paperId: p1 } }));
      expect(full.rows.map((r) => [r.studentId, r.mark?.status, r.mark?.minutesLate])).toEqual([[b, 'late', 10], [a, 'present', null]]);
      // A paper with attendance recorded stays on the timetable.
      expect(await refused(coord.api.v1.exams.papers[':id'].$delete({ param: { id: p1 } }))).toEqual({ status: 409, error: 'XD97/12 has attendance recorded: it stays on the timetable' });
    });

    it('special consideration is opened with evidence, sent to the board, and its outcome recorded', async () => {
      const pdf = new File([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], 'note.pdf', { type: 'application/pdf' });
      const evidence = (await apiResponse(coord.api.v1.files.upload.$post({ form: { file: pdf, purpose: 'supporting_document', studentId: a } }))).id;
      const sc = await apiResponse(coord.api.v1.exams['special-consideration'].$post({ json: {
        studentId: a, boardSeriesId: w.series.cambridgeNov, paperId: await paperId('XD97/12'), category: 'illness', description: 'Fever on the morning of Paper 1', evidenceFileId: evidence,
      } }));
      expect(sc.status).toBe('draft');
      // Another student's document is not this candidate's evidence.
      const other = (await apiResponse(coord.api.v1.files.upload.$post({ form: { file: pdf, purpose: 'supporting_document', studentId: b } }))).id;
      expect((await refused(coord.api.v1.exams['special-consideration'][':id'].$put({ param: { id: sc.id }, json: { evidenceFileId: other } }))).status).toBe(400);
      await apiResponse(coord.api.v1.exams['special-consideration'][':id'].$put({ param: { id: sc.id }, json: { status: 'submitted', boardReference: 'SC-778' } }));
      const done = await apiResponse(coord.api.v1.exams['special-consideration'][':id'].$put({ param: { id: sc.id }, json: { status: 'outcome_received', outcome: '2% added to Paper 1' } }));
      expect(done).toMatchObject({ status: 'outcome_received', boardReference: 'SC-778', outcome: '2% added to Paper 1' });
      expect(done.submittedAt).not.toBeNull();
      await audited([sc.id], ['SPECIAL_CONSIDERATION_CREATED', 'SPECIAL_CONSIDERATION_UPDATED', 'SPECIAL_CONSIDERATION_UPDATED']);
    });
  });

  describe('results', () => {
    let juneSeries: string;
    const pearsonFile = (grades: Record<string, string>) => [
      'UCI,Candidate Name,Unit Code,Grade,UMS',
      `91234B260101A,MOSTAFA Amira,XDWMA11,${grades.aP1 ?? 'A'},92`,
      '91234B260102B,FAROUK Omar,XDWMA11,B,81',
      '91234B260102B,FAROUK Omar,XDWMA12,C,70',
      '91234B260102B,FAROUK Omar,XDXMA01,B,',
      '91234B260103C,NABIL Laila,XDWMA11,E,45',
      '99999B269999Z,SOMEONE Else,XDWMA11,A,90',
      '91234B260103C,NABIL Laila,ZZZ99,U,10',
    ].join('\n');

    it("a results file read through a mapping; every attempt kept — an earlier series' and a board's revised report beside the first", async () => {
      // An earlier attempt at P1 in June, reported for A (not entered here: another centre's sitting).
      juneSeries = (await apiResponse(w.adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month: 'june', year: w.Y, label: 'exams xd earlier' } }))).id;
      await apiResponse(coord.api.v1.exams.results.import.$post({ json: {
        boardSeriesId: juneSeries, commit: true, source: { text: 'UCI,Unit Code,Grade,UMS\n91234B260101A,XDWMA11,C,62', name: 'June results' },
      } }));

      // January's file, uploaded, read with the guessed mapping first.
      const upload = new File([new TextEncoder().encode(pearsonFile({}))], 'pearson-jan.csv', { type: 'text/csv' });
      const fileId = (await apiResponse(coord.api.v1.files.upload.$post({ form: { file: upload, purpose: 'import_file' } }))).id;
      const preview = await apiResponse(coord.api.v1.exams.results.import.$post({ json: { boardSeriesId: w.series.pearsonJan, source: { fileId }, commit: false } }));
      expect(preview.mapping).toMatchObject({ shape: 'long', candidateColumn: 'UCI', candidateKey: 'uci', codeColumn: 'Unit Code', gradeColumn: 'Grade', markColumn: 'UMS' });
      expect(preview.summary).toEqual({ lines: 7, new: 5, revised: 0, unchanged: 0, unknownCandidates: 1, unknownCodes: 1, candidates: 3 });
      expect(preview.lines.find((l) => l.outcome === 'unknown_candidate')!.note).toBe(`No candidate with UCI 99999B269999Z in Pearson Edexcel January ${w.Y + 1} (exams xd)`);
      expect(preview.lines.find((l) => l.outcome === 'unknown_code')!.note).toBe('ZZZ99 is not a Pearson Edexcel unit or award in the catalogue');

      const done = await apiResponse(coord.api.v1.exams.results.import.$post({ json: { boardSeriesId: w.series.pearsonJan, source: { fileId }, mapping: preview.mapping, saveMappingAs: 'Pearson results file', commit: true } }));
      expect(done.summary.new).toBe(5);
      await audited([w.series.pearsonJan], ['EXAM_RESULTS_IMPORTED']);
      // The same file again adds nothing; the saved mapping is used without being asked for.
      const again = await apiResponse(coord.api.v1.exams.results.import.$post({ json: { boardSeriesId: w.series.pearsonJan, source: { fileId }, commit: true } }));
      expect(again).toMatchObject({ mappingFrom: 'saved: Pearson results file', summary: { new: 0, unchanged: 5 } });
      // The board's revised report (after a review): a new row beside the first, nothing overwritten.
      const revised = await apiResponse(coord.api.v1.exams.results.import.$post({ json: { boardSeriesId: w.series.pearsonJan, source: { text: pearsonFile({ aP1: 'A*' }), name: 'revised' }, commit: true } }));
      expect(revised.summary).toMatchObject({ new: 0, revised: 1, unchanged: 4 });
      const rows = await sql<{ series: string; grade: string; mark: string | null }>(
        `select board_series_id as series, grade, mark from exam_result where student_id = $1 and code = 'XDWMA11' order by created_at`, [a]);
      expect(rows.map((r) => [r.series === juneSeries ? 'june' : 'january', r.grade, Number(r.mark)])).toEqual([['june', 'C', 62], ['january', 'A', 92], ['january', 'A*', 92]]);

      // F5's contract: both attempts, every report, and no grade of record decided (RF-09).
      const sittings = await apiResponse(coord.api.v1.exams.students[':studentId'].sittings.$get({ param: { studentId: a } }));
      const p1 = sittings.filter((s) => s.code === 'XDWMA11');
      expect(p1.map((s) => [s.series.sitting, s.grade, s.reports.map((r) => r.grade), s.gradeOfRecord, s.level, s.subjectArea])).toEqual([
        [`June ${w.Y}`, 'C', ['C'], null, 'as', `Mathematics XD`],
        [`January ${w.Y + 1}`, 'A*', ['A*', 'A'], null, 'as', `Mathematics XD`],
      ]);
      expect(p1[1]).toMatchObject({ kind: 'unit', boardName: 'Pearson Edexcel', entryStatus: 'submitted' });
    });

    it("Cambridge's broadsheet (Excel, a column per syllabus, a title above the headings) through the same mapping step", async () => {
      const sheet = xlsxOf([
        ['Cambridge International — provisional results'],
        [`Centre EG123 — November ${w.Y}`],
        ['Candidate No', 'Candidate Name', 'XD97 Biology'],
        ['0001', 'FAROUK Omar', 'c (61)'],
        ['0002', 'MOSTAFA Amira', 'b'],
      ]);
      const fileId = (await apiResponse(coord.api.v1.files.upload.$post({ form: { file: new File([new Uint8Array(sheet)], 'broadsheet.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), purpose: 'import_file' } }))).id;
      const preview = await apiResponse(coord.api.v1.exams.results.import.$post({ json: { boardSeriesId: w.series.cambridgeNov, source: { fileId }, commit: false } }));
      expect(preview.mapping).toMatchObject({ shape: 'wide', headerRow: 3, candidateColumn: 'Candidate No', candidateKey: 'candidate_number', resultColumns: ['XD97 Biology'] });
      expect(preview.lines.map((l) => [l.studentId, l.code, l.grade, l.mark, l.kind, !!l.entryId])).toEqual([
        [b, 'XD97', 'c', 61, 'award', true], [a, 'XD97', 'b', null, 'award', true],
      ]);
      await apiResponse(coord.api.v1.exams.results.import.$post({ json: { boardSeriesId: w.series.cambridgeNov, source: { fileId }, commit: true } }));
    });

    it("publication shows results to families and gives each registration the board's grade, keeping one already recorded", async () => {
      // Families see nothing before publication.
      expect((await apiResponse(w.families.a.parent.api.v1.exams.students[':studentId'].results.$get({ param: { studentId: a } }))).results).toEqual([]);
      // C's P1 grade was typed on the results screen before the file came.
      await apiResponse(w.officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: w.regs.c[w.subjects.sp1]!, grade: 'D' }] } }));
      const pub = await apiResponse(coord.api.v1.exams.results.publish.$post({ json: { boardSeriesId: w.series.pearsonJan } }));
      expect(pub).toMatchObject({ published: 6, candidates: 3, gradesRecorded: 2 });
      expect(pub.gradesKept).toEqual([{ id: w.regs.c[w.subjects.sp1], grade: 'E', gradeReceived: 'D', status: 'confirmed' }]);
      const grade = async (id: string) => (await one<{ g: string | null }>(`select grade_received as g from registration where id = $1`, [id])).g;
      expect(await grade(w.regs.a[w.subjects.sp1]!)).toBe('A*'); // its one unit, the latest report
      expect(await grade(w.regs.b[w.subjects.spx]!)).toBe('B'); // the award (cash-in)
      expect(await grade(w.regs.c[w.subjects.sp1]!)).toBe('D'); // kept
      await notified('parent.x-xd-a@test.local', 'EXAM_RESULTS_PUBLISHED', 1);
      const fam = await apiResponse(w.families.a.parent.api.v1.exams.students[':studentId'].results.$get({ param: { studentId: a } }));
      expect(fam.results.map((r) => [r.code, r.grade])).toEqual([['XDWMA11', 'A*'], ['XDWMA11', 'A']]); // June's were never published
      // The existing remark flow reads the grade: a remark can now be asked for.
      await apiResponse(w.finadmin.api.v1.remarks.fees.$put({ json: { council: 'pearson_edexcel', serviceType: 'review_of_marking', amountPerPaper: 500 } }));
      const remark = await apiResponse(w.families.a.parent.api.v1.remarks.$post({ json: { registrationId: w.regs.a[w.subjects.sp1]!, serviceType: 'review_of_marking', papers: [{ paperCode: 'XDWMA11' }] } }));
      expect(remark.status).toBe('pending_consent');
      await apiResponse(coord.api.v1.exams.results.publish.$post({ json: { boardSeriesId: w.series.cambridgeNov } }));
    });
  });

  describe('certificates', () => {
    let certA: string, certB: string;

    it('received for the candidates with published results; the families are told to collect', async () => {
      const preview = await apiResponse(coord.api.v1.exams.certificates.receive.$post({ json: { boardSeriesId: w.series.cambridgeNov, receivedOn: dayFromNow(0), commit: false } }));
      expect(preview.toReceive.map((x) => x.studentId).sort()).toEqual([a, b].sort());
      expect(preview.toReceive[0]!.description).toBe(`Cambridge International November ${w.Y} (exams xd): XD97 Biology XD`);
      const done = await apiResponse(coord.api.v1.exams.certificates.receive.$post({ json: { boardSeriesId: w.series.cambridgeNov, receivedOn: dayFromNow(0), commit: true } }));
      expect(done.created).toBe(2);
      expect((await apiResponse(coord.api.v1.exams.certificates.receive.$post({ json: { boardSeriesId: w.series.cambridgeNov, receivedOn: dayFromNow(0), commit: true } }))).created).toBe(0);
      await notified('parent.x-xd-b@test.local', 'EXAM_CERTIFICATE_READY', 1);
      const list = await apiResponse(w.officer.api.v1.exams.certificates.$get({ query: { boardSeriesId: w.series.cambridgeNov } }));
      certA = list.certificates.find((x) => x.studentId === a)!.id;
      certB = list.certificates.find((x) => x.studentId === b)!.id;
    });

    it('collected once at the desk, with the collector and a slip to sign; a second hand-over is told who took it', async () => {
      const got = await apiResponse(w.officer.api.v1.exams.certificates[':id'].collect.$post({ param: { id: certA }, json: { collectorName: 'Amira Mostafa', collectorRelation: 'candidate', collectorIdChecked: 'national ID card' } }));
      expect(got).toMatchObject({ status: 'collected', collectorName: 'Amira Mostafa', collectedBy: w.officer.id });
      const again = await refused(w.finadmin.api.v1.exams.certificates[':id'].collect.$post({ param: { id: certA }, json: { collectorName: 'Someone', collectorRelation: 'parent' } }));
      expect(again.status).toBe(409);
      expect(again.error).toMatch(/^This certificate was already collected by Amira Mostafa on \d{4}-\d{2}-\d{2}$/);
      const slip = await apiResponse(w.officer.api.v1.exams.certificates[':id'].slip.$get({ param: { id: certA } }));
      expect(slip).toMatchObject({ candidate: { legalName: 'MOSTAFA, Amira' }, collectorRelationLabel: 'The candidate', handedOverBy: 'finance_officer x-xd' });
      await audited([certA], ['EXAM_CERTIFICATE_COLLECTED']);
    });

    it('an unclaimed certificate is kept for the retention period, then may be destroyed with a reason', async () => {
      expect((await refused(coord.api.v1.exams.certificates[':id'].dispose.$post({ param: { id: certB }, json: { action: 'destroyed', reason: 'never collected' } }))).error)
        .toMatch(/^Keep this certificate until \d{4}-\d{2}-\d{2} \(12 months after it arrived\) before destroying it$/);
      expect((await apiResponse(coord.api.v1.exams.certificates.$get({ query: { unclaimedOnly: 'true', boardSeriesId: w.series.cambridgeNov } }))).certificates).toEqual([]);
      await sql(`update exam_certificate set received_on = received_on - interval '13 months' where id = $1`, [certB]);
      const unclaimed = await apiResponse(coord.api.v1.exams.certificates.$get({ query: { unclaimedOnly: 'true', boardSeriesId: w.series.cambridgeNov } }));
      expect(unclaimed.certificates.map((x) => x.id)).toEqual([certB]);
      const gone = await apiResponse(coord.api.v1.exams.certificates[':id'].dispose.$post({ param: { id: certB }, json: { action: 'destroyed', reason: 'unclaimed after 12 months' } }));
      expect(gone).toMatchObject({ status: 'destroyed', disposalReason: 'unclaimed after 12 months' });
      expect((await refused(w.officer.api.v1.exams.certificates[':id'].collect.$post({ param: { id: certB }, json: { collectorName: 'Omar', collectorRelation: 'candidate' } }))))
        .toEqual({ status: 409, error: 'This certificate is no longer here to collect' });
    });
  });

  describe('the deadlines dashboard', () => {
    it('every board date across series in date order, with what is still to do; reminders go once', async () => {
      const board = await apiResponse(coord.api.v1.exams.deadlines.$get({ query: {} }));
      const mine = board.items.filter((i) => i.boardSeriesId === w.series.pearsonJan || i.boardSeriesId === w.series.cambridgeNov);
      const pj = mine.find((i) => i.boardSeriesId === w.series.pearsonJan && i.field === 'entryDeadline')!;
      expect(pj).toMatchObject({ hardStop: true, passed: false, daysLeft: 6 });
      expect(pj.outstanding).toEqual([]);
      expect(mine.map((i) => i.date)).toEqual([...mine.map((i) => i.date)].sort());
      // The scheduler's step: reminders for the dates the school acts by, once.
      const { sendDeadlineReminders } = await import('../src/services/exam-deadline.services');
      await sendDeadlineReminders();
      const sent = await sql<{ field: string; days_before: number }>(`select date_field as field, days_before from exam_deadline_reminder where board_series_id in ($1, $2) order by date_field, board_series_id`, [w.series.cambridgeNov, w.series.pearsonJan]);
      expect(sent.map((s) => [s.field, s.days_before])).toEqual([['entryDeadline', 14], ['entryDeadline', 14]]);
      await sendDeadlineReminders();
      const notes = await sql<{ n: number }>(`select count(*)::int as n from notification where user_id = $1 and type = 'EXAM_DEADLINE_REMINDER' and data->>'boardSeriesId' in ($2, $3)`, [coord.id, w.series.cambridgeNov, w.series.pearsonJan]);
      expect(notes[0]!.n).toBe(2);
    });
  });
});
