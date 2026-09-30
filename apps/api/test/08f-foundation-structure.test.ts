import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf, academicYearLabel } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, openWindow, audited, schoolToday, clientFor,
  type Client,
} from './helpers';

/**
 * F0a — the settings store, uploads, the academic structure, sections and
 * their roll-over, and the teacher capability (FEATURES_PLAN.md F0a).
 */

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const file = (bytes: Uint8Array, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type });

/** The first date on or after `from` (YYYY-MM-DD) that falls on `weekday` (0 = Sunday). */
function nextWeekday(from: string, weekday: number): string {
  const d = new Date(`${from}T12:00:00Z`);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe('F0a: settings, uploads, academic structure, sections, teaching', () => {
  let adm: Client, officer: Client, finadmin: Client, coordinator: Client, teacher: Client, gate: Client;
  type Family = { parent: Client; student: Client; studentId: string };
  const family = (tag: string, grade: 10 | 11 | 12 = 11): Promise<Family> => onboard(officer, `f0s-${tag}`, grade);
  const Y = academicYearStartOf();

  afterAll(async () => {
    await sql(`delete from school_setting where key in ('calendar.schoolWeekdays', 'schoolFee.graduatesExempt')`);
  });

  beforeAll(async () => {
    adm = await admin('f0s');
    officer = await staff(adm, 'finance_officer', 'f0s');
    finadmin = await staff(adm, 'finance_admin', 'f0s');
    // A coordinator who also teaches: linked to a teacher record made on the Team page.
    coordinator = await staff(adm, 'coordinator', 'f0s', { teacherRecord: true });
    teacher = await staff(adm, 'teacher', 'f0s');
    gate = await staff(adm, 'gate', 'f0s');
  });

  // ─── Settings ──────────────────────────────────────────────────────────────

  describe('the settings store', () => {
    const put = (who: Client, key: string, value: unknown) =>
      who.api.v1.settings[':key'].$put({ param: { key }, json: { value, reason: 'F0a settings scenario' } });

    it('every reader sees every key, its default, and whether they may change it', async () => {
      const list = await apiResponse(officer.api.v1.settings.$get());
      const byKey = Object.fromEntries(list.map((s) => [s.key, s]));
      expect(byKey['eligibility.graduateRetakes']).toMatchObject({ value: true, isDefault: true, canEdit: false, source: 'A-12' });
      expect(byKey['calendar.schoolWeekdays']).toMatchObject({ value: [0, 1, 2, 3, 4], canEdit: false });
      const mine = Object.fromEntries((await apiResponse(coordinator.api.v1.settings.$get())).map((s) => [s.key, s.canEdit]));
      expect(mine).toEqual({
        'eligibility.graduateRetakes': false,
        'schoolFee.graduatesExempt': false,
        'schoolFee.newYearWithoutSchedule': false,
        'calendar.schoolWeekdays': true,
        // F0b: what "A.S./A.2." marks is the coordinator's answer (IS-01).
        'catalogue.levelCodeReading': true,
        // F2: the leave policy is the coordinator's, except who approves (the admin's).
        'leave.sameDayCutoff': true,
        'leave.noticeMinutes': true,
        'leave.aloneGrades': true,
        'leave.reasonCategories': true,
        'leave.limitPerTerm': true,
        'leave.familyRules': true,
        'leave.approverRoles': false,
        'leave.autoApprove': true,
        'leave.noShowGraceMinutes': true,
        'leave.lateReturnGraceMinutes': true,
      });
    });

    it('a change is refused to any role the key does not name, and nothing is written', async () => {
      for (const [who, key, value] of [
        [coordinator, 'eligibility.graduateRetakes', false],
        [coordinator, 'schoolFee.graduatesExempt', false],
        [finadmin, 'eligibility.graduateRetakes', false],
        [finadmin, 'calendar.schoolWeekdays', [0, 1, 2, 3]],
      ] as const) {
        const r = await refused(put(who, key, value));
        expect(r.status, `${key}`).toBe(403);
        expect(r.error).toContain('may change');
      }
      for (const who of [officer, teacher, gate]) expect((await refused(put(who, 'calendar.schoolWeekdays', [0]))).status).toBe(403);
      const tried = [coordinator.id, finadmin.id, officer.id, teacher.id, gate.id];
      expect(await sql(`select 1 from school_setting where updated_by in ($1, $2, $3, $4, $5)`, tried)).toEqual([]);
      expect(await sql(`select 1 from audit_log where action = 'SETTING_CHANGED' and user_id in ($1, $2, $3, $4, $5)`, tried)).toEqual([]);
    });

    it('a permitted change is validated against the key, audited with before, after and reason, and read back', async () => {
      expect((await refused(put(coordinator, 'calendar.schoolWeekdays', ['monday']))).status).toBe(400);
      expect((await refused(put(coordinator, 'calendar.schoolWeekdays', [0, 0]))).status).toBe(400);
      expect((await refused(put(coordinator, 'no.such.key', true))).status).toBe(404);
      const changed = await apiResponse(put(coordinator, 'calendar.schoolWeekdays', [0, 1, 2, 3, 4, 6]));
      expect(changed).toMatchObject({ value: [0, 1, 2, 3, 4, 6], isDefault: false, updatedBy: `coordinator f0s` });
      expect(await one(`select user_id, previous_data, new_data from audit_log where action = 'SETTING_CHANGED' and entity_id = 'calendar.schoolWeekdays'`))
        .toEqual({ user_id: coordinator.id, previous_data: { value: [0, 1, 2, 3, 4] }, new_data: { value: [0, 1, 2, 3, 4, 6], reason: 'F0a settings scenario' } });
      expect((await refused(put(coordinator, 'calendar.schoolWeekdays', [0, 1, 2, 3, 4, 6]))).status).toBe(409);
      await apiResponse(put(adm, 'calendar.schoolWeekdays', [0, 1, 2, 3, 4]));
      await apiResponse(put(finadmin, 'schoolFee.graduatesExempt', false));
      await apiResponse(put(finadmin, 'schoolFee.graduatesExempt', true));
      expect(Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'SETTING_CHANGED' and user_id in ($1, $2, $3)`, [coordinator.id, adm.id, finadmin.id])).n)).toBe(4);
    });
  });

  // ─── Uploads ───────────────────────────────────────────────────────────────

  describe('uploads by purpose', () => {
    let a: Family, b: Family;
    const upload = (who: Client, purpose: string, f: File, studentId?: string) =>
      who.api.v1.files.upload.$post({ form: { file: f, purpose: purpose as 'supporting_document', ...(studentId ? { studentId } : {}) } });
    const content = (who: Pick<Client, 'api'>, id: string) => who.api.v1.files[':id'].content.$get({ param: { id }, query: {} });

    beforeAll(async () => {
      a = await family('up-a');
      b = await family('up-b');
    });

    it("a parent's InstaPay screenshot: finance reads it, the family's own parent reads it, nobody else", async () => {
      const up = await apiResponse(upload(a.parent, 'payment_evidence', file(PNG, 'transfer.png', 'image/png'), a.studentId));
      expect(up).toMatchObject({ purpose: 'payment_evidence', studentId: a.studentId, mimeType: 'image/png' });
      await audited([up.id], ['FILE_UPLOADED']);
      const mine = await content(a.parent, up.id);
      expect(mine.status).toBe(200);
      expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PNG);
      expect((await content(officer, up.id)).status).toBe(200);
      expect((await content(finadmin, up.id)).status).toBe(200);
      for (const who of [b.parent, b.student, a.student, coordinator, teacher, gate]) {
        expect((await content(who, up.id)).status).toBe(404);
        expect((await who.api.v1.files[':id'].$get({ param: { id: up.id } })).status).toBe(404);
      }
    });

    it('a supporting document reads for the family and the staff who handle it, not another family or the gate', async () => {
      const up = await apiResponse(upload(a.parent, 'supporting_document', file(PDF, 'letter.pdf', 'application/pdf'), a.studentId));
      for (const who of [a.parent, a.student, coordinator, officer, adm]) expect((await content(who, up.id)).status, who.email).toBe(200);
      for (const who of [b.parent, b.student, teacher, gate]) expect((await content(who, up.id)).status, who.email).toBe(404);
    });

    it('refused to the wrong role and the wrong family', async () => {
      expect((await refused(upload(a.student, 'payment_evidence', file(PNG, 'x.png', 'image/png'), a.studentId))).status).toBe(403);
      expect((await refused(upload(teacher, 'import_file', file(new TextEncoder().encode('a,b\n1,2\n'), 'x.csv', 'text/csv')))).status).toBe(403);
      expect((await refused(upload(b.parent, 'supporting_document', file(PDF, 'x.pdf', 'application/pdf'), a.studentId))).status).toBe(403);
      expect((await refused(upload(b.student, 'excuse_note', file(PDF, 'x.pdf', 'application/pdf'), a.studentId))).status).toBe(403);
      // Staff may upload for any student; the coordinator imports.
      expect((await upload(coordinator, 'supporting_document', file(PDF, 'x.pdf', 'application/pdf'), b.studentId)).status).toBe(201);
      expect((await upload(coordinator, 'import_file', file(new TextEncoder().encode('name,grade\nA,11\n'), 'sheet.csv', 'text/csv'))).status).toBe(201);
      expect(await sql(`select 1 from file where user_id in ($1, $2, $3) and purpose <> 'payment_evidence' and purpose <> 'supporting_document'`, [a.student.id, teacher.id, b.student.id])).toEqual([]);
    });

    it('type and size are the purpose\'s, judged by the bytes', async () => {
      // A PDF named and declared as a photo.
      expect((await refused(upload(a.parent, 'collector_photo', file(PDF, 'photo.png', 'image/png'), a.studentId))).error).toContain('cannot be uploaded here');
      // Bytes that are not any allowed type.
      expect((await refused(upload(a.parent, 'supporting_document', file(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), 'x.pdf', 'application/pdf'), a.studentId))).status).toBe(400);
      // Over the purpose's limit (collector photos: 5 MB).
      const big = new Uint8Array(6 * 1024 * 1024);
      big.set(PNG);
      expect((await refused(upload(a.parent, 'collector_photo', file(big, 'big.png', 'image/png'), a.studentId))).error).toContain('5MB');
      // A purpose that concerns a student needs one.
      expect((await refused(upload(a.parent, 'supporting_document', file(PDF, 'x.pdf', 'application/pdf')))).status).toBe(400);
      // The stored name's extension is the detected type's, never the uploader's.
      const named = await apiResponse(upload(a.parent, 'supporting_document', file(PDF, 'letter.exe', 'application/pdf'), a.studentId));
      const stored = await one<{ storage_key: string; mime_type: string }>(`select storage_key, mime_type from file where id = $1`, [named.id]);
      expect(stored.mime_type).toBe('application/pdf');
      expect(stored.storage_key.endsWith('.pdf')).toBe(true);
    });

    it("only the parent's own evidence for this child attaches to a payment; finance then reads a legacy document so attached (O-5)", async () => {
      const oct = await session(adm, 'October (AS, F0a uploads)', 'october', 'a_level', { ...openWindow(), activate: true });
      const sub = await subject(adm, 'F0S-AL', 'Chemistry (A2, F0a uploads)', { course: 900, registration: 100 }, { qualificationLevel: 'a_level' });
      const reg = (await apiResponse(a.parent.api.v1.registrations.direct.$post({ json: { sessionId: oct, subjectIds: [sub], studentId: a.studentId } })))[0]!.id;
      const pay = (await apiResponse(a.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [reg], paymentMethod: 'instapay', escrowAmountToApply: 0 } }))).id!;
      const note = await apiResponse(upload(a.parent, 'supporting_document', file(PDF, 'n.pdf', 'application/pdf'), a.studentId));
      const other = await family('up-c');
      await sql(`insert into parent_student_link (id, parent_id, student_id, status) values (gen_random_uuid()::text, $1, $2, 'approved')`, [a.parent.id, other.studentId]);
      const otherChild = await apiResponse(upload(a.parent, 'payment_evidence', file(PNG, 'o.png', 'image/png'), other.studentId));
      for (const id of [note.id, otherChild.id]) {
        expect((await refused(a.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay }, json: { reference: `FT-F0S-${id.slice(0, 6)}`, screenshotFileId: id } }))).error)
          .toBe('You are not authorized to attach that file');
      }
      const legacy = await apiResponse(a.parent.api.v1.files.document.$post({ form: { file: file(PNG, 'receipt.png', 'image/png') } }));
      expect((await content(officer, legacy.id)).status).toBe(404);
      await apiResponse(a.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay }, json: { reference: 'FT-F0S-LEGACY', screenshotFileId: legacy.id } }));
      expect((await content(officer, legacy.id)).status).toBe(200);
      // Attached evidence is never deleted.
      expect((await refused(a.parent.api.v1.files[':id'].$delete({ param: { id: legacy.id } }))).error).toContain('cannot be deleted');
    });

    it('anonymous callers get nothing', async () => {
      const anon = await clientFor();
      const up = await apiResponse(upload(a.parent, 'supporting_document', file(PDF, 'z.pdf', 'application/pdf'), a.studentId));
      expect((await content({ api: anon }, up.id)).status).toBe(401);
    });
  });

  // ─── Academic years, terms, the calendar, bell schedules, rooms ────────────

  describe('the academic structure', () => {
    let yearId: string, shortDay: string, defaultBells: string;

    it('academic years: inside 1 July – 30 June, once each; terms inside the year and never overlapping', async () => {
      expect((await refused(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-06-20`, endsOn: `${Y + 1}-06-20` } }))).error).toContain('1 July');
      const year = await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }));
      yearId = year.id;
      expect((await refused(adm.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-01`, endsOn: `${Y + 1}-06-20` } }))).status).toBe(409);
      await apiResponse(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: yearId, name: 'Term 1', startsOn: `${Y}-09-06`, endsOn: `${Y}-12-20` } }));
      const t2 = await apiResponse(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: yearId, name: 'Term 2', startsOn: `${Y + 1}-01-10`, endsOn: `${Y + 1}-06-25` } }));
      expect((await refused(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: yearId, name: 'Overlap', startsOn: `${Y}-12-01`, endsOn: `${Y + 1}-01-20` } }))).status).toBe(409);
      expect((await refused(coordinator.api.v1.academic.terms[':id'].$put({ param: { id: t2.id }, json: { endsOn: `${Y + 1}-06-29` } }))).error).toContain('inside the school year');
      const years = await apiResponse(teacher.api.v1.academic.years.$get());
      expect(years.find((x) => x.id === yearId)).toMatchObject({ label: academicYearLabel(Y), isCurrent: true, terms: [{ name: 'Term 1' }, { name: 'Term 2' }] });
      await audited([yearId], ['ACADEMIC_YEAR_CREATED']);
    });

    it('bell schedules: a default day and a short day; periods of a day never overlap', async () => {
      const regular = await apiResponse(coordinator.api.v1.academic['bell-schedules'].$post({ json: { academicYearId: yearId, name: 'Regular', isDefault: true } }));
      defaultBells = regular.id;
      const short = await apiResponse(coordinator.api.v1.academic['bell-schedules'].$post({ json: { academicYearId: yearId, name: 'Short day', isDefault: false } }));
      shortDay = short.id;
      const clash = await refused(coordinator.api.v1.academic['bell-schedules'][':id'].periods.$put({
        param: { id: regular.id },
        json: { periods: [
          { weekday: null, label: 'P1', kind: 'lesson', startsAt: '08:00', endsAt: '08:45' },
          { weekday: null, label: 'P2', kind: 'lesson', startsAt: '08:40', endsAt: '09:25' },
        ] },
      }));
      expect(clash.error).toContain('overlap');
      await apiResponse(coordinator.api.v1.academic['bell-schedules'][':id'].periods.$put({
        param: { id: regular.id },
        json: { periods: [
          { weekday: null, label: 'Registration', kind: 'registration', startsAt: '07:45', endsAt: '08:00' },
          { weekday: null, label: 'P1', kind: 'lesson', startsAt: '08:00', endsAt: '08:45' },
          { weekday: null, label: 'Break', kind: 'break', startsAt: '08:45', endsAt: '09:05' },
          { weekday: null, label: 'P2', kind: 'lesson', startsAt: '09:05', endsAt: '09:50' },
          { weekday: 4, label: 'P1', kind: 'lesson', startsAt: '08:00', endsAt: '08:40' },
        ] },
      }));
      await apiResponse(coordinator.api.v1.academic['bell-schedules'][':id'].periods.$put({
        param: { id: short.id }, json: { periods: [{ weekday: null, label: 'P1', kind: 'lesson', startsAt: '08:00', endsAt: '08:30' }] },
      }));
      // A second default replaces the first.
      const list = await apiResponse(gate.api.v1.academic['bell-schedules'].$get({ query: { academicYearId: yearId } }));
      expect(list.filter((s) => s.isDefault).map((s) => s.name)).toEqual(['Regular']);
    });

    it('the calendar: what a day is — a school day with its bells, the weekend, a holiday, an early dismissal, an extra school day, between terms', async () => {
      const sunday = nextWeekday(`${Y}-10-04`, 0);
      const thursday = nextWeekday(`${Y}-10-04`, 4);
      const friday = nextWeekday(`${Y}-10-04`, 5);
      const holiday = nextWeekday(`${Y}-11-01`, 1);
      const early = nextWeekday(`${Y}-11-01`, 2);
      const saturday = nextWeekday(`${Y}-11-01`, 6);
      expect((await refused(coordinator.api.v1.academic.calendar.$post({ json: { academicYearId: yearId, kind: 'early_dismissal', name: 'Early', startsOn: early, endsOn: early } }))).status).toBe(400);
      await apiResponse(coordinator.api.v1.academic.calendar.$post({ json: { academicYearId: yearId, kind: 'holiday', name: 'National holiday', startsOn: holiday, endsOn: holiday } }));
      await apiResponse(coordinator.api.v1.academic.calendar.$post({ json: { academicYearId: yearId, kind: 'early_dismissal', name: 'Parents evening', startsOn: early, endsOn: early, bellScheduleId: shortDay } }));
      await apiResponse(coordinator.api.v1.academic.calendar.$post({ json: { academicYearId: yearId, kind: 'school_day', name: 'Make-up day', startsOn: saturday, endsOn: saturday } }));
      expect((await refused(coordinator.api.v1.academic.calendar.$post({ json: { academicYearId: yearId, kind: 'exam_only', name: 'Clash', startsOn: holiday, endsOn: holiday } }))).status).toBe(409);
      const day = (date: string) => apiResponse(teacher.api.v1.academic.calendar.day.$get({ query: { date } }));
      expect(await day(sunday)).toMatchObject({ kind: 'school_day', isSchoolDay: true, term: { name: 'Term 1' }, bellSchedule: { name: 'Regular' } });
      expect((await day(sunday)).periods.map((p) => p.label)).toEqual(['Registration', 'P1', 'Break', 'P2']);
      expect((await day(thursday)).periods.map((p) => `${p.label} ${p.startsAt}`)).toEqual(['P1 08:00']);
      expect(await day(friday)).toMatchObject({ kind: 'weekend', isSchoolDay: false, periods: [] });
      expect(await day(holiday)).toMatchObject({ kind: 'holiday', isSchoolDay: false, entry: { name: 'National holiday' } });
      expect(await day(early)).toMatchObject({ kind: 'early_dismissal', isSchoolDay: true, bellSchedule: { name: 'Short day' } });
      expect(await day(saturday)).toMatchObject({ kind: 'extra_school_day', isSchoolDay: true });
      expect(await day(`${Y}-12-28`)).toMatchObject({ kind: 'out_of_term', isSchoolDay: false });
      expect(await day(`${Y}-08-15`)).toMatchObject({ kind: 'no_academic_year' });
    });

    it('rooms: one name each; a room out of use is refused to a section', async () => {
      const r = await apiResponse(coordinator.api.v1.academic.rooms.$post({ json: { name: 'Lab 1', capacity: 24, type: 'science_lab', features: ['fume_cupboard', 'projector'] } }));
      expect((await refused(coordinator.api.v1.academic.rooms.$post({ json: { name: 'lab 1' } }))).status).toBe(409);
      await apiResponse(coordinator.api.v1.academic.rooms[':id'].$put({ param: { id: r.id }, json: { isActive: false } }));
      expect((await refused(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 11, name: '11Z', roomId: r.id } }))).error).toBe('That room is not in use');
    });
  });

  // ─── Sections, their history, the roll-over, and the teacher who leads one ──

  describe('sections and the roll-over', () => {
    let yearId: string, nextYearId: string, s11a: string, s11b: string, s12a: string, room: string;
    let x: Family, y: Family, z: Family, ten: Family, senior: Family, leaver: Family, repeater: Family;
    let coordinatorTeacherId: string;

    beforeAll(async () => {
      yearId = (await apiResponse(coordinator.api.v1.academic.years.$get())).find((v) => v.startYear === Y)!.id;
      nextYearId = (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y + 1, startsOn: `${Y + 1}-09-05`, endsOn: `${Y + 2}-06-24` } }))).id;
      room = (await apiResponse(coordinator.api.v1.academic.rooms.$post({ json: { name: 'Room 11A', capacity: 25 } }))).id;
      coordinatorTeacherId = (await one<{ id: string }>(`select id from teacher where user_id = $1`, [coordinator.id])).id;
      [x, y, z, ten, senior, leaver, repeater] = await Promise.all([
        family('sec-x'), family('sec-y'), family('sec-z'), family('sec-ten', 10), family('sec-senior', 12), family('sec-leaver'), family('sec-repeat'),
      ]);
    });

    it('a section per year and grade with its homeroom teacher and room; members must be in its grade; capacity holds', async () => {
      s11a = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 11, name: '11A', homeroomTeacherId: coordinatorTeacherId, roomId: room, capacity: 4 } }))).id;
      s11b = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 11, name: '11B' } }))).id;
      s12a = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 12, name: '12A' } }))).id;
      expect((await refused(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 11, name: '11a' } }))).status).toBe(409);

      const wrong = await refused(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11a }, json: { studentIds: [x.studentId, ten.studentId] } }));
      expect(wrong.error).toContain('is in grade 10');
      expect(await sql(`select 1 from section_membership where section_id = $1`, [s11a])).toEqual([]);

      expect(await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11a }, json: { studentIds: [x.studentId, y.studentId, leaver.studentId, repeater.studentId] } })))
        .toEqual({ added: 4, moved: 0, alreadyIn: 0 });
      expect((await refused(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11a }, json: { studentIds: [z.studentId] } }))).status).toBe(409);
      await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s12a }, json: { studentIds: [senior.studentId] } }));
      // Adding again changes nothing.
      expect(await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11a }, json: { studentIds: [x.studentId] } })))
        .toEqual({ added: 0, moved: 0, alreadyIn: 1 });
    });

    it('graduations the backfill inferred are listed for staff to review, and the record says so', async () => {
      const g = await family('inferred', 12);
      // What migration 0035 writes for a graduate it inferred from a graduation row.
      await sql(`insert into audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data)
                 values (gen_random_uuid()::text, null, 'STUDENT_COHORT_INFERRED', 'user', $1, '{"grade": null}', $2)`,
        [g.studentId, JSON.stringify({ cohortYear: Y - 2, basis: 'graduation_row', graduatedAt: `${Y}-05-20T10:00:00Z` })]);
      const list = await apiResponse(coordinator.api.v1.students.$get({ query: { inferred: 'true', limit: '500' } }));
      expect(list.students.find((s) => s.id === g.studentId)).toMatchObject({ cohortInferred: true });
      expect(list.students.every((s) => s.cohortInferred)).toBe(true);
      const record = await apiResponse(coordinator.api.v1.students[':id'].$get({ param: { id: g.studentId } }));
      expect(record.changes.map((c) => c.action)).toContain('STUDENT_COHORT_INFERRED');
      // Reviewed: once staff correct the cohort, the student leaves the filter (the record keeps both rows).
      await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: g.studentId }, json: { cohortYear: Y - 3, reason: 'graduated a year earlier than inferred' } }));
      const after = await apiResponse(coordinator.api.v1.students.$get({ query: { inferred: 'true', limit: '500' } }));
      expect(after.students.some((s) => s.id === g.studentId)).toBe(false);
      expect((await apiResponse(coordinator.api.v1.students.$get({ query: { search: g.student.email } }))).students[0]).toMatchObject({ cohortInferred: false });
    });

    it('a move dated before the student joined their current section is refused: the new section never starts before the old one', async () => {
      const current = await one<{ started_on: string }>(
        `select to_char(m.started_on, 'YYYY-MM-DD') as started_on from section_membership m where m.student_id = $1 and m.ended_on is null`, [y.studentId]);
      const dayBefore = new Date(`${current.started_on}T12:00:00Z`);
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
      const r = await refused(coordinator.api.v1.academic.sections[':id'].members.$post({
        param: { id: s11b }, json: { studentIds: [y.studentId], startsOn: dayBefore.toISOString().slice(0, 10) },
      }));
      expect(r.status).toBe(409);
      expect(r.error).toContain('A move must start on or after the day the student joined their current section');
      expect(await sql(`select 1 from section_membership m join section s on s.id = m.section_id where m.student_id = $1 and s.id = $2`, [y.studentId, s11b])).toEqual([]);
    });

    it('moving a student keeps the history; the student record and the desk show the section', async () => {
      const moved = await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11b }, json: { studentIds: [y.studentId], startsOn: schoolToday() } }));
      expect(moved).toMatchObject({ added: 1, moved: 1 });
      const hist = await sql<{ name: string; ended: boolean }>(
        `select s.name, (m.ended_on is not null) as ended from section_membership m join section s on s.id = m.section_id where m.student_id = $1 order by m.created_at`, [y.studentId]);
      expect(hist).toEqual([{ name: '11A', ended: true }, { name: '11B', ended: false }]);
      const record = await apiResponse(coordinator.api.v1.students[':id'].$get({ param: { id: y.studentId } }));
      expect(record).toMatchObject({ section: { name: '11B' }, standing: 'in_school', sectionMismatch: false });
      expect(record.sectionHistory.map((h) => h.name)).toEqual(['11B', '11A']);
      const desk = await apiResponse(officer.api.v1.users[':id'].summary.$get({ param: { id: y.studentId } }));
      expect(desk.academic).toMatchObject({ grade: 11, section: { name: '11B' }, standing: 'in_school' });
      // The coordinator's list, by section.
      const list = await apiResponse(coordinator.api.v1.students.$get({ query: { sectionId: s11a } }));
      expect(list.students.map((s) => s.name).sort()).toEqual([`Student f0s-sec-leaver`, `Student f0s-sec-repeat`, `Student f0s-sec-x`]);
      // A section with members' history cannot be deleted.
      expect((await refused(coordinator.api.v1.academic.sections[':id'].$delete({ param: { id: s11a } }))).status).toBe(409);
    });

    it('a teacher record linked to a coordinator account: the coordinator gets the teacher screens for their homeroom', async () => {
      const mine = await apiResponse(coordinator.api.v1.teaching.me.$get());
      expect(mine.teacher.name).toBe('coordinator f0s');
      expect(mine.homeroomSections.map((s) => s.name)).toEqual(['11A']);
      expect(mine.homeroomSections[0]!.students.map((s) => s.name).sort()).toEqual([`Student f0s-sec-leaver`, `Student f0s-sec-repeat`, `Student f0s-sec-x`]);
      // A teacher account is linked from the start; an unlinked account is told so.
      expect((await apiResponse(teacher.api.v1.teaching.me.$get())).teacher.name).toBe('teacher f0s');
      expect((await refused(gate.api.v1.teaching.me.$get())).status).toBe(404);
      // The admin links an existing record to their own account; a family account never teaches.
      const record = await apiResponse(adm.api.v1.teachers.$post({ json: { name: 'Admin who teaches' } }));
      await apiResponse(adm.api.v1.teachers[':id'].account.$put({ param: { id: record.id }, json: { userId: adm.id } }));
      expect((await apiResponse(adm.api.v1.teaching.me.$get())).teacher.name).toBe('Admin who teaches');
      const another = await apiResponse(adm.api.v1.teachers.$post({ json: { name: 'Second record' } }));
      expect((await refused(adm.api.v1.teachers[':id'].account.$put({ param: { id: another.id }, json: { userId: adm.id } }))).status).toBe(409);
      expect((await refused(adm.api.v1.teachers[':id'].account.$put({ param: { id: another.id }, json: { userId: x.parent.id } }))).error).toContain('only staff accounts teach');
      // A teacher account keeps its record until its role changes.
      const teacherRecord = await one<{ id: string }>(`select id from teacher where user_id = $1`, [teacher.id]);
      expect((await refused(adm.api.v1.teachers[':id'].account.$put({ param: { id: teacherRecord.id }, json: { userId: null } }))).status).toBe(409);
      await audited([record.id], ['TEACHER_ACCOUNT_LINKED']);
    });

    it('the Team page: a teacher account needs a record; an account becomes a teacher only once linked', async () => {
      expect((await refused(adm.api.v1.users.$post({ json: { name: 'No Record', email: 'f0s.norecord@test.local', password: 'TestPass1', role: 'teacher' } }))).status).toBe(400);
      const gateTwo = await staff(adm, 'gate', 'f0s-two');
      expect((await refused(adm.api.v1.users[':id'].$put({ param: { id: gateTwo.id }, json: { role: 'teacher' } }))).error).toContain('Link');
      const rec = await apiResponse(adm.api.v1.teachers.$post({ json: { name: 'Gate who teaches' } }));
      await apiResponse(adm.api.v1.teachers[':id'].account.$put({ param: { id: rec.id }, json: { userId: gateTwo.id } }));
      expect((await apiResponse(adm.api.v1.users[':id'].$put({ param: { id: gateTwo.id }, json: { role: 'teacher' } }))).role).toBe('teacher');
    });

    it('the roll-over: previewed, then committed; 11A becomes 12A of next year with those still in grade 12 then; grade 12 graduates; running it again changes nothing', async () => {
      // A student who repeats grade 11 and one who left stay behind for the coordinator.
      await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: repeater.studentId }, json: { gradeNow: 10, reason: 'repeats the year' } }));
      await apiResponse(coordinator.api.v1.students[':id'].leave.$post({ param: { id: leaver.studentId }, json: { kind: 'transferred', leftOn: schoolToday(), reason: 'another school' } }));
      expect((await apiResponse(coordinator.api.v1.students[':id'].$get({ param: { id: repeater.studentId } }))).sectionMismatch).toBe(true);

      const preview = await apiResponse(coordinator.api.v1.academic.sections['roll-over'].$post({ json: { fromAcademicYearId: yearId, toAcademicYearId: nextYearId, commit: false } }));
      const a = preview.sections.find((p) => p.from.name === '11A')!;
      expect(a).toMatchObject({ to: { name: '12A', grade: 12, exists: false } });
      expect(a.moving.map((m) => m.name)).toEqual([`Student f0s-sec-x`]);
      expect(a.staying.map((m) => [m.name, m.why])).toEqual([[`Student f0s-sec-repeat`, `grade 11 in ${Y + 1}/${String((Y + 2) % 100).padStart(2, '0')}`]]);
      expect(preview.graduating.map((g) => g.name)).toEqual([`Student f0s-sec-senior`]);
      expect(await sql(`select 1 from section where academic_year_id = $1`, [nextYearId])).toEqual([]);

      const done = await apiResponse(coordinator.api.v1.academic.sections['roll-over'].$post({ json: { fromAcademicYearId: yearId, toAcademicYearId: nextYearId, commit: true } }));
      expect(done).toMatchObject({ sectionsCreated: 2, studentsMoved: 2 });
      const next = await sql<{ name: string; grade: number; homeroom: string | null; room: string | null; members: string }>(
        `select s.name, s.grade, s.homeroom_teacher_id as homeroom, s.room_id as room,
                (select count(*) from section_membership m where m.section_id = s.id and m.ended_on is null) as members
         from section s where s.academic_year_id = $1 order by s.name`, [nextYearId]);
      expect(next).toEqual([
        { name: '12A', grade: 12, homeroom: coordinatorTeacherId, room, members: '1' },
        { name: '12B', grade: 12, homeroom: null, room: null, members: '1' },
      ]);
      const again = await apiResponse(coordinator.api.v1.academic.sections['roll-over'].$post({ json: { fromAcademicYearId: yearId, toAcademicYearId: nextYearId, commit: true } }));
      expect(again).toMatchObject({ sectionsCreated: 0, studentsMoved: 0 });
      expect(Number((await one<{ n: string }>(`select count(*) as n from section where academic_year_id = $1`, [nextYearId])).n)).toBe(2);
      expect(Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'SECTIONS_ROLLED_OVER' and entity_id = $1`, [nextYearId])).n)).toBe(1);
      // Only into the year right after.
      expect((await refused(coordinator.api.v1.academic.sections['roll-over'].$post({ json: { fromAcademicYearId: nextYearId, toAcademicYearId: yearId, commit: false } }))).status).toBe(400);
    });
  });
});
