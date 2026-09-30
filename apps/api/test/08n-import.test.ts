import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf, academicYearShortLabel, seriesYearInAcademicYear, seriesOrder } from '@repo/validations';
import {
  app, admin, staff, onboard, subject, session, feedSeries, refused, one, sql, audited, openWindow, holdRowLock, lockWaiters, waitFor, type Client,
} from './helpers';
import { schoolSheet, sclRoster, moneyRecord, workbook, zip, serial, years, D, type Cell } from './import-fixtures';

/**
 * F7 — the day-one import (FEATURES_PLAN.md F7; IMPORT_SPIKE.md).
 *
 * The school's sheet never enters a test: import-fixtures.ts builds synthetic
 * workbooks with its shapes. Driven through the RPC client as the admin and
 * the coordinator: upload (purpose import_file) → stage → review (fix, merge,
 * skip, the mapping) → commit, one family per transaction → read back.
 *
 * The plan's scenarios: a sheet with the spike's known problems staged with
 * every problem flagged; a commit creating exactly the reviewed rows; a
 * re-run changing nothing; two staff committing the same staged file at once.
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const Y = academicYearStartOf();

type Api = Client['api'];
const fetchView = (who: Client, id: string) => apiResponse(who.api.v1.imports[':id'].$get({ param: { id } }));
type View = Awaited<ReturnType<typeof fetchView>>;
type RowView = View['rows'][number];

async function stage(who: Client, bytes: Uint8Array | string, name: string, kind: 'school_sheet' | 'scl_roster' | 'money_record') {
  const body = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  const f = await apiResponse(who.api.v1.files.upload.$post({ form: { file: new File([body], name, { type: typeof bytes === 'string' ? 'text/csv' : XLSX }), purpose: 'import_file' } }));
  return (await apiResponse(who.api.v1.imports.$post({ json: { fileId: f.id, kind } }))).id;
}
const rowAt = (v: View, tab: string, n: number) => {
  const r = v.rows.find((x) => x.tab === tab && x.rowNumber === n);
  if (!r) throw new Error(`no row ${tab}!${n}`);
  return r;
};
/** A row's or person's problems, sorted; a restored phone (IS-09, on nearly every line) is left out unless asked for. */
const codes = (r: { problems: { code: string }[] }, all = false) => r.problems.map((p) => p.code).filter((c) => all || c !== 'phone_restored').sort();
const person = (v: View, role: 'student' | 'parent', key: string) => {
  const p = v.people.find((x) => x.role === role && x.key === key);
  if (!p) throw new Error(`no ${role} ${key}`);
  return p;
};
const putRows = (who: Client, id: string, json: Parameters<Api['v1']['imports'][':id']['rows']['$put']>[0]['json']) =>
  apiResponse(who.api.v1.imports[':id'].rows.$put({ param: { id }, json }));
const putPerson = (who: Client, id: string, json: Parameters<Api['v1']['imports'][':id']['people']['$put']>[0]['json']) =>
  apiResponse(who.api.v1.imports[':id'].people.$put({ param: { id }, json }));
const putSettings = (who: Client, id: string, json: Parameters<Api['v1']['imports'][':id']['settings']['$put']>[0]['json']) =>
  who.api.v1.imports[':id'].settings.$put({ param: { id }, json });

/** What the domain holds for this suite's families: the import must add exactly what the review says, and a re-run nothing. */
async function snapshot() {
  const count = async (q: string) => Number((await one<{ n: string }>(q, [`%${D}`])).n);
  return {
    users: await count(`select count(*) as n from "user" where email like $1`),
    links: await count(`select count(*) as n from parent_student_link l join "user" u on u.id = l.student_id where u.email like $1`),
    memberships: await count(`select count(*) as n from section_membership m join "user" u on u.id = m.student_id where u.email like $1`),
    enrolments: await count(`select count(*) as n from course_enrolment e join "user" u on u.id = e.student_id where u.email like $1`),
    history: await count(`select count(*) as n from registration_history h join "user" u on u.id = h.student_id where u.email like $1`),
    registrations: await count(`select count(*) as n from registration r join "user" u on u.id = r.student_id where u.email like $1`),
    money: await count(`select count(*) as n from money_history m join "user" u on u.id = m.student_id where u.email like $1`),
    teachers: Number((await one<{ n: string }>(`select count(*) as n from teacher where name in ('Ms Salma', 'Mr Karim', 'Mr Wael', 'Ms Mona', 'Mr Live')`)).n),
    sections: Number((await one<{ n: string }>(`select count(*) as n from section where name in ('11F', '11G', '11H', '11J', '11K', '12F', '10A', '10B')`)).n),
    payments: Number((await one<{ n: string }>(`select count(*) as n from payment`)).n),
    escrowMoves: Number((await one<{ n: string }>(`select count(*) as n from escrow_transaction`)).n),
    receipts: Number((await one<{ n: string }>(`select count(*) as n from receipt`)).n),
  };
}

describe('F7: the day-one import', () => {
  let adm: Client, adm2: Client, coordinator: Client, officer: Client;
  let yearId: string;
  const subj: Record<string, string> = {};
  let firstBatch: string;

  beforeAll(async () => {
    adm = await admin('imp');
    adm2 = await admin('imp2');
    coordinator = await staff(adm, 'coordinator', 'imp');
    officer = await staff(adm, 'finance_officer', 'imp');
    // A staff account whose email a sheet row gives as a parent's (IS-06: "belongs to another kind of account").
    await apiResponse(adm.api.v1.users.$post({ json: { name: 'Ezz Staff', email: `ezz${D}`, password: 'TestPass1', role: 'gate' } }));
    const yrs = await apiResponse(coordinator.api.v1.academic.years.$get());
    yearId = yrs.find((y) => y.startYear === Y)?.id
      ?? (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    if (!yrs.some((y) => y.startYear === Y + 1)) {
      await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y + 1, startsOn: `${Y + 1}-09-06`, endsOn: `${Y + 2}-06-25` } }));
    }
    // The catalogue the sheet maps to. IGCSE subjects with Cambridge; the IAL units with Pearson (DISCOVERY_RESEARCH.md §1).
    subj.CSCI = await subject(adm, 'IMP-CSCI', 'Combined Science', { course: 1000, registration: 400 }, {});
    subj.CS = await subject(adm, 'IMP-CS', 'Computer Science', { course: 1000, registration: 400 }, {});
    subj.ENV = await subject(adm, 'IMP-ENV', 'Environmental Management', { course: 1000, registration: 400 }, {});
    subj.P1 = await subject(adm, 'IMP-P1', 'Pure Mathematics 1 (P1)', { course: 800, registration: 400 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    subj.M1 = await subject(adm, 'IMP-M1', 'Mechanics 1 (M1)', { course: 800, registration: 400 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    subj.BIO12 = await subject(adm, 'IMP-BIO12', 'Biology (Paper 1 & Paper 2)', { course: 900, registration: 450 }, { qualificationLevel: 'as_level', council: 'cambridge' });
    subj.BIO34 = await subject(adm, 'IMP-BIO34', 'Biology (Paper 3 & Paper 4)', { course: 900, registration: 450 }, { qualificationLevel: 'a_level', council: 'pearson_edexcel' });
    subj.SOC = await subject(adm, 'IMP-SOC', 'Sociology', { course: 900, registration: 450 }, { qualificationLevel: 'a_level' });
    subj.MAR = await subject(adm, 'IMP-MAR', 'Marine Science', { course: 900, registration: 450 }, { qualificationLevel: 'a_level' });
    for (const set of ['pearson_ial_mathematics', 'pearson_ial_biology'] as const) await apiResponse(coordinator.api.v1.catalogue.starter.$post({ json: { set } }));
    const cat = await apiResponse(coordinator.api.v1.catalogue.$get());
    const unit = (code: string) => cat.units.find((u) => u.code === code)!.id;
    const map = (subjectId: string, unitCodes: string[], qualificationCode?: string) => apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({
      param: { subjectId }, json: { boardCode: 'pearson_edexcel', qualificationId: qualificationCode ? cat.qualifications.find((q) => q.code === qualificationCode)!.id : null, unitIds: unitCodes.map(unit) },
    }));
    await map(subj.P1, ['WMA11']);
    await map(subj.M1, ['WME01']);
    await map(subj.BIO34, ['WBI13', 'WBI14'], 'YBI11');
    // A family already in the system: Bassem and his first parent, onboarded at the desk before go-live.
    await apiResponse(officer.api.v1.links['desk-onboard'].$post({
      json: {
        parent: { email: `rania${D}`, name: 'Rania Nour', password: 'TestPass1', phone: '01044444444' },
        student: { email: `bassem${D}`, name: 'Bassem Nour', password: 'TestPass1', phone: '01033333333', grade: 11 },
      },
    }));
  });

  describe("a sheet with the spike's known problems, staged with every problem flagged", () => {
    let v: View;
    let before: Awaited<ReturnType<typeof snapshot>>;

    beforeAll(async () => {
      before = await snapshot();
      firstBatch = await stage(coordinator, schoolSheet(), 'Nov registration.xlsx', 'school_sheet');
      v = await fetchView(coordinator, firstBatch);
    });

    it('reads the tabs by their headers: the two session tabs, and the per-unit roster left alone', async () => {
      expect(v.mapping.tabs.map((t) => [t.name, t.kind, t.lines, t.mainSeries])).toEqual([
        ['2024', 'session', 19, `November ${Y}`],
        ['Sheet1', 'session', 5, `June ${years().historyJune}`],
        ['S1', 'roster', 0, null],
      ]);
      // The classes of the live tab are this year's; the June tab's are the year of its series.
      expect(v.mapping.tabs[0]).toMatchObject({ classYear: Y, yearSetUp: true });
      expect(v.mapping.tabs[1]).toMatchObject({ classYear: years().historyClassYear, yearSetUp: false });
      expect(v.notes.map((n) => [n.code, n.detail])).toEqual([
        ['no_money', null],
        ['two_series_one_tab', `2024: November ${Y}, January ${Y + 1}`],
        ['year_not_set_up', academicYearShortLabel(years().historyClassYear)],
        ['roster_tab_ignored', 'S1'],
      ]);
      // Every line keeps where it came from.
      const r = rowAt(v, '2024', 8);
      expect(r.raw).toContainEqual(['Subject', 'Pure Mathematics 1 (P1)']);
      expect(r.raw).toContainEqual(['(column F)', String(serial(Y, 11))]);
    });

    it('IS-01 units and level codes: per-paper rows, "A.S./A.2." on a single unit, June\'s "A.L."', () => {
      expect(codes(rowAt(v, '2024', 8))).toEqual(['unit_row']);
      expect(codes(rowAt(v, '2024', 9))).toEqual(['level_code_combined_on_unit', 'level_code_differs', 'unit_row']);
      expect(rowAt(v, '2024', 9).problems.find((p) => p.code === 'level_code_differs')!.detail).toBe('the sheet says A.S./A.2., the catalogue A.S.');
      expect(codes(rowAt(v, 'Sheet1', 4))).toEqual(['level_code_al', 'signature']);
      expect(codes(person(v, 'student', `rami${D}`))).toEqual(['graduated']);
      // June's M1 row: Rami sits no A2 unit in that series, so the catalogue reads it "A.S." under today's reading.
      expect(codes(rowAt(v, 'Sheet1', 7))).toEqual(['level_code_combined_on_unit', 'level_code_differs', 'unit_row']);
      // Which reading of "A.S./A.2." agrees with the sheet: the coordinator's question, answered with counts.
      expect(v.mapping.levelCodes.current).toBe('student_series');
      expect(v.mapping.levelCodes.byReading.student_year.combinedAgree).toBeGreaterThan(v.mapping.levelCodes.byReading.student_series.combinedAgree);
    });

    it('IS-02 carry forward, IS-12 the Signature column', () => {
      const r = rowAt(v, 'Sheet1', 3);
      expect(codes(r)).toEqual(['carry_forward']);
      expect(r.data).toMatchObject({ carryForwardFrom: `June ${years().historyJune - 1}` });
      expect(codes(rowAt(v, 'Sheet1', 4))).toContain('signature');
    });

    it('IS-03 self-study on a subject the school teaches: a first attempt, kept as history until a window is chosen', () => {
      const r = rowAt(v, '2024', 12);
      expect(codes(r)).toEqual(['fee_note', 'self_study_on_taught']);
      expect(r.problems.find((p) => p.code === 'self_study_on_taught')).toMatchObject({ severity: 'info', detail: 'kept as history' });
      expect(r.mode).toBe('self_study');
    });

    it('IS-04 classes: sections to make this year, and a class that cannot be read', () => {
      expect(codes(rowAt(v, '2024', 20))).toEqual(['class_unreadable', 'email_taken']);
      // Nader's class cannot be read; the rest are this year's sections, none made yet.
      expect(v.mapping.sections.filter((s) => s.yearSetUp).map((s) => [s.name, s.exists, s.students])).toEqual([
        ['11F', false, 2], ['11G', false, 1], ['11H', false, 2], ['11J', false, 3], ['11K', false, 1], ['12F', false, 1],
      ]);
    });

    it('IS-05 January rows in a November tab go to their own series', () => {
      expect(codes(rowAt(v, '2024', 11))).toEqual(['series_other_than_tab', 'unit_row']);
      expect(v.mapping.series.map((s) => [s.key, s.rows, s.mode])).toEqual(expect.arrayContaining([
        [`november-${Y}-igcse`, 14, 'history'],
        [`november-${Y}-as_level`, 3, 'history'],
        [`january-${Y + 1}-a_level`, 1, 'history'],
      ]));
    });

    it('IS-06 identity: a missing email, two children under one email, a duplicate family, one email for student and parent, a child with two parents, a staff email', () => {
      expect(codes(rowAt(v, '2024', 13))).toEqual(['email_student_missing']);
      expect(codes(rowAt(v, '2024', 14))).toEqual(['student_email_shared']);
      expect(codes(rowAt(v, '2024', 15))).toEqual(['student_email_shared']);
      expect(codes(person(v, 'student', `mostafa.kids${D}`))).toEqual(['name_variants', 'student_email_shared']);
      expect(codes(person(v, 'student', `karim.lotfy${D}`))).toEqual(['duplicate_student']);
      expect(person(v, 'student', `karim.l${D}`).problems[0]!.detail).toBe(`also karim.lotfy${D} (same parent)`);
      expect(codes(rowAt(v, '2024', 18))).toEqual(['email_student_is_parent']);
      expect(codes(person(v, 'student', `bassem${D}`))).toEqual(['student_two_parents']);
      expect(person(v, 'student', `bassem${D}`).matched).toMatchObject({ role: 'student' });
      expect(codes(person(v, 'parent', `ezz${D}`))).toEqual(['email_taken']);
      // A family with an error is held back; the rest are ready.
      const held = v.families.filter((f) => f.status === 'held').map((f) => f.students).flat().sort();
      expect(held).toEqual([`mostafa.kids${D}`, `nader${D}`, `row:${rowAt(v, '2024', 13).id}`, `said.family${D}`]);
    });

    it('IS-07 no money, IS-08 fee notes, drops and "I will drop the course"', () => {
      expect(codes(rowAt(v, 'Sheet1', 6))).toEqual(['dropped']);
      expect(rowAt(v, 'Sheet1', 6).data).toMatchObject({ feeKind: 'drop', feePercent: 20 });
      expect(codes(rowAt(v, '2024', 21))).toEqual(['drop_intent']);
      expect(rowAt(v, '2024', 21).plan).toMatchObject({ registration: 'history', enrolment: 'none' });
    });

    it('IS-09 phones stored as numbers and an unusable one, IS-10 names with non-breaking and doubled spaces', () => {
      expect(codes(rowAt(v, '2024', 3), true)).toEqual(['name_cleaned', 'phone_restored']);
      expect(rowAt(v, '2024', 3).problems.find((p) => p.code === 'phone_restored')!.detail).toBe('student and parent');
      expect(v.rows.filter((r) => r.problems.some((p) => p.code === 'phone_restored'))).toHaveLength(23);
      expect(rowAt(v, '2024', 3).data).toMatchObject({ studentName: 'Amir Fahmy', studentPhone: '01011111111', parentPhone: '01022222222' });
      expect(codes(rowAt(v, '2024', 19))).toEqual(['phone_unusable', 'subject_unmapped', 'teacher_missing']);
      expect(rowAt(v, '2024', 19).data).toMatchObject({ studentPhone: null });
    });

    it('IS-11 drifted columns are read by what they say', () => {
      const r = rowAt(v, 'Sheet1', 5);
      expect(codes(r)).toEqual(['column_drift', 'fee_note', 'self_study_on_taught']);
      expect(r.data).toMatchObject({ confirm: 'confirm', selfStudy: true, feeNote: 'Self Study 50% School fees' });
    });

    it('IS-13 a duplicate row is left out by default; IS-14 two boards in one series', () => {
      const dup = rowAt(v, '2024', 5);
      expect(dup).toMatchObject({ decision: 'skip', decisionSource: 'default', skipReason: 'The same subject is on an earlier row' });
      expect(codes(dup)).toEqual(['duplicate_row']);
      const nov = v.mapping.series.find((s) => s.key === `november-${Y}-as_level`)!;
      expect(nov.boards.sort()).toEqual(['cambridge', 'pearson_edexcel']);
      expect(codes(nov)).toEqual(['boards_in_series']);
    });

    it('the mapping suggests the catalogue rows and teachers; what a commit would do is counted', () => {
      expect(v.mapping.subjects.map((s) => [s.subject, s.levelCode, s.subjectId])).toEqual(expect.arrayContaining([
        ['Pure Mathematics 1 (P1)', 'A.S.', subj.P1], ['Mechanics 1 (M1)', 'A.S./A.2.', subj.M1], ['Biology (Paper 3 & Paper 4)', 'A.S./A.2.', subj.BIO34],
        ['Mechanics 1 (M1)', 'A.S./A.L.', subj.M1], ['French', 'O.L.', null],
      ]));
      expect(v.mapping.teachers.map((t) => [t.name, t.teacherId, t.create])).toEqual([
        ['Mr Karim', null, true], ['Mr Wael', null, true], ['Ms Mona', null, true], ['Ms Salma', null, true],
      ]);
      expect(v.summary).toMatchObject({ rows: 24, importing: 23, skipped: 1, families: 12, heldFamilies: 4, readyFamilies: 8 });
    });

    it('staging changes nothing in the school: no account, link, section, enrolment, history, registration or money', async () => {
      expect(await snapshot()).toEqual(before);
      await audited([firstBatch], ['IMPORT_STAGED']);
    });
  });

  describe('the review, then a commit creating exactly the reviewed rows', () => {
    let v: View;
    let before: Awaited<ReturnType<typeof snapshot>>;

    it('fix: a missing email typed in, a shared email split, a parent given their own email, a class read', async () => {
      v = await fetchView(coordinator, firstBatch);
      await putRows(coordinator, firstBatch, { rowIds: [rowAt(v, '2024', 13).id], edits: { studentEmail: `farid${D}` } });
      await putRows(coordinator, firstBatch, { rowIds: [rowAt(v, '2024', 15).id], edits: { studentEmail: `omar.mostafa${D}` } });
      await putRows(coordinator, firstBatch, { rowIds: [rowAt(v, '2024', 18).id], edits: { parentEmail: `said${D}` } });
      await putRows(coordinator, firstBatch, { rowIds: [rowAt(v, '2024', 20).id], edits: { classGrade: '11F', parentEmail: `ezz.nader${D}` } });
      v = await fetchView(coordinator, firstBatch);
      expect(codes(rowAt(v, '2024', 13))).toEqual([]);
      expect(rowAt(v, '2024', 13).data).toMatchObject({ studentEmail: `farid${D}`, studentEmailOk: true });
      expect(codes(person(v, 'student', `mostafa.kids${D}`))).toEqual([]);
      expect(person(v, 'student', `omar.mostafa${D}`).parentKeys).toEqual([`mostafa${D}`]);
      expect(codes(rowAt(v, '2024', 18))).toEqual([]);
      expect(codes(rowAt(v, '2024', 20))).toEqual([]);
      // Every fix is audited with the lines it touched.
      const rows = await sql<{ n: string }>(`select count(*) as n from audit_log where action = 'IMPORT_REVIEWED' and entity_id = $1`, [firstBatch]);
      expect(Number(rows[0]!.n)).toBe(4);
    });

    it('merge: the duplicate family becomes one child; skip: a row the school does not offer', async () => {
      await putPerson(coordinator, firstBatch, { role: 'student', key: `karim.l${D}`, mergedInto: `karim.lotfy${D}` });
      await putRows(coordinator, firstBatch, { rowIds: [rowAt(v, '2024', 19).id], decision: 'skip', note: 'French is not offered' });
      v = await fetchView(coordinator, firstBatch);
      expect(person(v, 'student', `karim.l${D}`).mergedInto).toBe(`karim.lotfy${D}`);
      expect(person(v, 'student', `karim.lotfy${D}`).rowIds).toHaveLength(2);
      expect(codes(person(v, 'student', `karim.lotfy${D}`))).toEqual([]);
      expect(rowAt(v, '2024', 19)).toMatchObject({ decision: 'skip', decisionSource: 'staff', skipReason: 'French is not offered' });
      expect(v.people.some((p) => p.key === `mona${D}`)).toBe(false);
      // A person cannot be merged into someone who is merged: no chain turns back on itself.
      expect((await refused(coordinator.api.v1.imports[':id'].people.$put({ param: { id: firstBatch }, json: { role: 'student', key: `karim.lotfy${D}`, mergedInto: `karim.l${D}` } }))).status).toBe(404);
    });

    it("the coordinator's pending answers are mapping settings: carry forward read as an AS result", async () => {
      expect((await putSettings(coordinator, firstBatch, { carryForward: 'result' })).status).toBe(200);
      // Registering families in a window is the admin's.
      const nov = v.mapping.series.find((s) => s.key === `november-${Y}-igcse`)!;
      expect(await refused(putSettings(coordinator, firstBatch, { series: { [nov.key]: { mode: 'window', sessionId: 'x' } } }))).toEqual({
        status: 403, error: 'Registering families in an open window is the admin’s: map the series to "History only", or ask the admin',
      });
      v = await fetchView(coordinator, firstBatch);
      expect(v.settings).toMatchObject({ carryForward: 'result', selfStudyOnTaught: 'retake_only', createSections: true, enrol: true });
      expect(v.summary).toMatchObject({ heldFamilies: 0, families: 11, readyFamilies: 11 });
      expect(v.summary.plan).toMatchObject({
        students: { create: 11, match: 1 }, parents: { create: 11, match: 1 }, links: 12, sectionPlacements: 10, newSections: 6,
        enrolments: 16, history: 22, registrations: 0, money: 3, newTeachers: 4,
      });
    });

    it('commit: every family in its own transaction, exactly what the review showed', async () => {
      before = await snapshot();
      const out = await apiResponse(coordinator.api.v1.imports[':id'].commit.$post({ param: { id: firstBatch } }));
      expect(out).toMatchObject({
        status: 'committed',
        result: {
          families: { committed: 11, failed: 0 },
          created: { students: 11, parents: 11, links: 12, sectionPlaces: 10, enrolments: 16, history: 22, registrations: 0, money: 3 },
          teachersCreated: ['Mr Karim', 'Mr Wael', 'Ms Mona', 'Ms Salma'], sectionsCreated: ['11F', '11G', '11H', '11J', '11K', '12F'],
        },
      });
      const after = await snapshot();
      expect(after).toEqual({
        ...before, users: before.users + 22, links: before.links + 12, memberships: before.memberships + 10, enrolments: before.enrolments + 16,
        history: before.history + 22, money: before.money + 3, teachers: before.teachers + 4, sections: before.sections + 6,
      });
    });

    it('the accounts: exactly the reviewed people, with their cohort, phones normalised, no password (they set one), linked', async () => {
      const users = await sql<{ email: string; role: string; name: string; phone: string | null; cohort_year: number | null; accounts: string }>(
        `select u.email, u.role, u.name, u.phone, u.cohort_year, (select count(*) from account a where a.user_id = u.id) as accounts
         from "user" u where u.email like $1 and u.email <> $2 order by u.email`, [`%${D}`, `ezz${D}`]);
      expect(users.map((u) => u.email)).toEqual([
        'amir', 'bassem', 'dina', 'eman', 'ezz.nader', 'farid', 'fikry', 'gaber', 'hany', 'hosny', 'kamal', 'karim.lotfy', 'lotfy',
        'mostafa', 'mostafa.kids', 'nader', 'omar.mostafa', 'rami', 'rania', 'said.family', 'said', 'samir', 'sara', 'tarek',
      ].map((e) => `${e}${D}`));
      const by = Object.fromEntries(users.map((u) => [u.email.replace(D, ''), u]));
      expect(by.amir).toMatchObject({ role: 'student', name: 'Amir Fahmy', phone: '01011111111', cohort_year: Y - 1, accounts: '0' });
      expect(by.dina).toMatchObject({ role: 'student', cohort_year: Y - 2 });
      expect(by.rami).toMatchObject({ role: 'student', cohort_year: years().historyClassYear - 2 });
      expect(by.hany).toMatchObject({ role: 'parent', name: 'Hany Fahmy', phone: '01022222222', accounts: '0' });
      expect(by['mostafa.kids']).toMatchObject({ name: 'Hala Mostafa' });
      // Bassem and Rania were there already: matched, never recreated or renamed; their passwords stay.
      expect(by.bassem).toMatchObject({ accounts: '1' });
      expect(by.rania).toMatchObject({ accounts: '1' });
      // Mona's only row was skipped: no account for her or her parent.
      expect(users.some((u) => u.email === `mona${D}` || u.email === `adly${D}`)).toBe(false);
      const links = await sql<{ pair: string; status: string }>(
        `select p.email || ' > ' || s.email as pair, l.status from parent_student_link l join "user" p on p.id = l.parent_id join "user" s on s.id = l.student_id
         where s.email like $1 order by pair`, [`%${D}`]);
      expect(links.map((l) => `${l.pair.replaceAll(D, '')} ${l.status}`)).toEqual([
        'ezz.nader > nader approved', 'fikry > sara approved', 'gaber > farid approved', 'hany > amir approved', 'hosny > eman approved',
        'kamal > rami approved', 'lotfy > karim.lotfy approved', 'mostafa > mostafa.kids approved', 'mostafa > omar.mostafa approved',
        'rania > bassem approved', 'said > said.family approved', 'samir > dina approved', 'tarek > bassem approved',
      ]);
      const created = await sql<{ n: string }>(`select count(*) as n from audit_log where action = 'IMPORT_ACCOUNT_CREATED' and new_data->>'batchId' = $1`, [firstBatch]);
      expect(Number(created[0]!.n)).toBe(22);
    });

    it('an imported parent signs in once they set a password through "Forgot password" (the link goes to their email)', async () => {
      // better-auth's own endpoints, as the web's sign-in and reset pages call them through better-auth's client.
      const a = await app();
      const post = (path: string, json: Record<string, unknown>) =>
        a.request(path, { method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
      expect((await post('/api/auth/sign-in/email', { email: `hany${D}`, password: 'TestPass1' })).status).toBe(401);
      expect((await post('/api/auth/request-password-reset', { email: `hany${D}`, redirectTo: 'http://localhost:3000/reset-password' })).status).toBe(200);
      const { identifier } = await one<{ identifier: string }>(
        `select identifier from verification where identifier like 'reset-password:%' and value = (select id from "user" where email = $1)`, [`hany${D}`]);
      expect((await post('/api/auth/reset-password', { token: identifier.slice('reset-password:'.length), newPassword: 'Imported1' })).status).toBe(200);
      expect((await post('/api/auth/sign-in/email', { email: `hany${D}`, password: 'Imported1' })).status).toBe(200);
      expect((await one<{ n: string }>(`select count(*) as n from account where user_id = (select id from "user" where email = $1)`, [`hany${D}`])).n).toBe('1');
    });

    it('sections, enrolments, history and money history: each traceable to its line', async () => {
      const members = await sql<{ email: string; section: string }>(
        `select u.email, s.name as section from section_membership m join section s on s.id = m.section_id join "user" u on u.id = m.student_id
         where u.email like $1 and m.academic_year_id = $2 order by u.email`, [`%${D}`, yearId]);
      expect(members.map((m) => `${m.email.replace(D, '')} ${m.section}`)).toEqual([
        'amir 11F', 'bassem 11G', 'dina 12F', 'eman 11H', 'farid 11H', 'karim.lotfy 11J', 'mostafa.kids 11J', 'nader 11F', 'omar.mostafa 11K', 'said.family 11K',
      ]);
      const enrolments = await sql<{ email: string; subject: string; mode: string; teacher: string | null; source: string; ref: string }>(
        `select u.email, s.code as subject, e.mode, t.name as teacher, e.source, e.source_ref as ref from course_enrolment e
         join "user" u on u.id = e.student_id join subject s on s.id = e.subject_id left join teacher t on t.id = e.teacher_id
         where u.email like $1 order by u.email, s.code`, [`%${D}`]);
      expect(enrolments.map((e) => `${e.email.replace(D, '')} ${e.subject} ${e.mode} ${e.teacher ?? '-'}`)).toEqual([
        'amir IMP-CS in_school Mr Karim', 'amir IMP-CSCI in_school Ms Salma',
        'bassem IMP-CSCI in_school Ms Salma', 'bassem IMP-ENV in_school Mr Karim',
        'dina IMP-BIO12 in_school Ms Mona', 'dina IMP-BIO34 in_school Ms Mona', 'dina IMP-M1 in_school Mr Wael', 'dina IMP-P1 in_school Mr Wael',
        'eman IMP-ENV self_study -',
        'farid IMP-CS in_school Mr Karim',
        'karim.lotfy IMP-CS in_school Mr Karim', 'karim.lotfy IMP-ENV in_school Mr Karim',
        'mostafa.kids IMP-CS in_school Mr Karim',
        'nader IMP-CS in_school Mr Karim',
        'omar.mostafa IMP-ENV in_school Mr Karim',
        'said.family IMP-CS in_school Mr Karim',
      ]);
      expect(enrolments.every((e) => e.source === 'import' && e.ref.startsWith(`import:${firstBatch}:2024!`))).toBe(true);
      const history = await sql<{ email: string; label: string; code: string | null; series: string; mode: string; outcome: string; cf: { reading: string; from: string } | null; ref: string; row: string | null }>(
        `select u.email, h.subject_label as label, h.level_code as code, h.session_type || ' ' || h.series_year as series, h.mode, h.outcome,
                h.carried_forward as cf, h.source_ref as ref, h.import_row_id as row
         from registration_history h join "user" u on u.id = h.student_id where u.email like $1`, [`%${D}`]);
      expect(history).toHaveLength(22);
      const rami = history.filter((h) => h.email === `rami${D}`).map((h) => [h.label, h.code, h.outcome, h.cf?.reading ?? null, h.cf?.from ?? null]);
      expect(rami.sort()).toEqual([
        ['Marine Science', 'A.L.', 'registered', null, null],
        ['Mechanics 1 (M1)', 'A.S./A.L.', 'registered', null, null],
        ['Sociology', 'A.2.', 'registered', 'result', `June ${years().historyJune - 1}`],
      ]);
      expect(history.find((h) => h.email === `amir${D}` && h.label === 'Environmental Management')).toMatchObject({ outcome: 'drop_intended' });
      expect(history.find((h) => h.email === `sara${D}` && h.label === 'Computer Science')).toMatchObject({ outcome: 'dropped' });
      expect(history.find((h) => h.email === `eman${D}`)).toMatchObject({ mode: 'self_study' });
      expect(history.find((h) => h.email === `dina${D}` && h.label.includes('Paper 3'))).toMatchObject({ series: `january ${Y + 1}` });
      expect(history.every((h) => h.ref.startsWith('Nov registration.xlsx — ') && h.row)).toBe(true);
      const money = await sql<{ email: string; kind: string; percent: number | null; amount: number | null; note: string }>(
        `select u.email, m.kind, m.percent, m.amount, m.note from money_history m join "user" u on u.id = m.student_id where u.email like $1 order by u.email, m.note`, [`%${D}`]);
      expect(money.map((m) => [m.email.replace(D, ''), m.kind, Number(m.percent), m.amount])).toEqual([
        ['eman', 'self_study_rate', 50, null], ['sara', 'drop', 20, null], ['sara', 'self_study_rate', 50, null],
      ]);
      // Every committed line says what it made.
      const rows = await sql<{ status: string; n: string }>(`select status, count(*) as n from import_row where batch_id = $1 group by status order by status`, [firstBatch]);
      expect(rows).toEqual([{ status: 'committed', n: '22' }, { status: 'pending', n: '2' }]);
      const r3 = await one<{ outcome: Record<string, unknown> }>(`select outcome from import_row where batch_id = $1 and tab = '2024' and row_number = 3`, [firstBatch]);
      expect(r3.outcome).toMatchObject({ link: 'created', section: 'added', enrolment: 'created', plan: { student: 'create', registration: 'history' } });
      expect(await sql(`select 1 from audit_log where action = 'IMPORT_FAMILY_COMMITTED' and entity_id = $1`, [firstBatch])).toHaveLength(11);
    });

    it('the import is committed: nothing more changes it', async () => {
      expect((await one<{ status: string }>(`select status from import_batch where id = $1`, [firstBatch])).status).toBe('committed');
      expect(await refused(coordinator.api.v1.imports[':id'].commit.$post({ param: { id: firstBatch } }))).toEqual({ status: 409, error: 'This import is already committed' });
      expect(await refused(coordinator.api.v1.imports[':id'].rows.$put({ param: { id: firstBatch }, json: { rowIds: [rowAt(v, '2024', 3).id], decision: 'skip' } })))
        .toEqual({ status: 409, error: 'This import is committed: what it made is in the system now' });
    });
  });

  describe('a re-run of the same file changes nothing', () => {
    it('staged again, it carries the review over and finds everything already there', async () => {
      const before = await snapshot();
      const again = await stage(coordinator, schoolSheet(), 'Nov registration (again).xlsx', 'school_sheet');
      const v = await fetchView(coordinator, again);
      // The fixes, the merge, the skip and the mapping of the first run are this run's too.
      expect(rowAt(v, '2024', 13).data).toMatchObject({ studentEmail: `farid${D}` });
      expect(person(v, 'student', `karim.l${D}`).mergedInto).toBe(`karim.lotfy${D}`);
      expect(rowAt(v, '2024', 19)).toMatchObject({ decision: 'skip', decisionSource: 'staff' });
      expect(v.settings.carryForward).toBe('result');
      expect(v.batch.sameFileBefore.map((b) => [b.id, b.status])).toEqual([[firstBatch, 'committed']]);
      // Every importing line: nothing new to make.
      const importing = v.rows.filter((r) => r.decision === 'import');
      expect(importing).toHaveLength(22);
      expect(importing.every((r) => codes(r).includes('already_imported'))).toBe(true);
      expect(v.summary.plan).toMatchObject({
        students: { create: 0, match: 12 }, parents: { create: 0, match: 12 }, links: 0, sectionPlacements: 0, newSections: 0,
        enrolments: 0, history: 0, registrations: 0, money: 0, newTeachers: 0,
        existing: { enrolments: 16, history: 22, registrations: 0, money: 3 },
      });
      const out = await apiResponse(coordinator.api.v1.imports[':id'].commit.$post({ param: { id: again } }));
      expect(out.result.created).toEqual({ students: 0, parents: 0, links: 0, sectionPlaces: 0, enrolments: 0, history: 0, registrations: 0, money: 0 });
      expect(out.result.teachersCreated).toEqual([]);
      expect(out.result.sectionsCreated).toEqual([]);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('registrations in an open window, routed to their board series (the admin\'s)', () => {
    let windowId: string, seriesId: string, liveBatch: string, finadmin: Client;
    let type: 'june' | 'november' | 'january' | 'october', level: 'igcse' | 'as_level' | 'a_level', seriesYear: number;
    const L: Record<string, string> = {};
    const code = () => (level === 'igcse' ? 'O.L.' : level === 'as_level' ? 'A.S.' : 'A.2.');
    const liveSheet = () => {
      const header: Cell[] = ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', ''];
      const C = 'I confirm my registration';
      const one = (subject: string, teacher: string, self: 'Yes' | 'No'): Cell[] => ['Live One', '11K', code(), subject, teacher, '01040404040', `live.one${D}`, 'Live Parent One', `live.parent.one${D}`, '01041414141', C, self];
      const two = (cls: string, subject: string, self: 'Yes' | 'No', spec = code()): Cell[] => ['Live Two', cls, spec, subject, self === 'Yes' ? '' : 'Mr Live', '01042424242', `live.two${D}`, 'Live Parent Two', `live.parent.two${D}`, '01043434343', C, self];
      const month = type[0]!.toUpperCase() + type.slice(1);
      return workbook([
        { name: 'Live', rows: [[`${month} ${seriesYear} Session`], header, one('Live Subject A', 'Mr Live', 'No'), one('Live Subject B', '', 'Yes'), one('Live Subject Self', '', 'Yes'), one('Live Subject Free', 'Mr Live', 'No'), two('11K', 'Live Subject B', 'Yes')] },
        // What Live Two sat before the system: last June, in grade 10.
        { name: 'Past', rows: [[`June ${Y} Session`], header, two('10A', 'Live Subject B', 'No'), two('10A', 'Live Subject C', 'No')] },
      ]);
    };

    beforeAll(async () => {
      finadmin = await staff(adm, 'finance_admin', 'imp');
      // A type and level no earlier suite holds open (one active window per type and level).
      const combos = [['june', 'igcse'], ['november', 'igcse'], ['june', 'as_level'], ['november', 'as_level'], ['january', 'as_level'], ['october', 'as_level'],
        ['june', 'a_level'], ['november', 'a_level'], ['january', 'a_level'], ['october', 'a_level']] as const;
      const taken = new Set((await sql<{ k: string }>(`select session_type || '/' || qualification_level as k from registration_session where status = 'active'`)).map((r) => r.k));
      const free = combos.find(([t, l]) => !taken.has(`${t}/${l}`));
      if (!free) throw new Error('08n needs one type and level with no open window');
      [type, level] = free;
      seriesYear = seriesYearInAcademicYear(type, Y);
      for (const [k, name, offered, fee] of [['A', 'Live Subject A', true, 1000], ['B', 'Live Subject B', true, 1000], ['C', 'Live Subject C', true, 1000], ['S', 'Live Subject Self', false, 1000], ['F', 'Live Subject Free', true, 0]] as const) {
        L[k] = await subject(adm, `IMP-LIVE-${k}`, name, { course: fee, registration: fee / 2 }, { qualificationLevel: level, council: 'pearson_edexcel', isOfferedAtSchool: offered });
      }
      windowId = await session(adm, `Live window (import)`, type, level, { ...openWindow(), activate: true, seriesYear });
      seriesId = await feedSeries(adm, windowId, { boardCode: 'pearson_edexcel', label: 'import live', entryDeadline: new Date(Date.now() + 330 * 86_400_000) });
      liveBatch = await stage(adm, liveSheet(), 'live.xlsx', 'school_sheet');
    });
    afterAll(async () => {
      await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: windowId }, json: { reason: 'import scenario done: free the pair' } }));
    });

    it('the series is offered its open window; mapped there by the admin, each row is checked as the desk would check it', async () => {
      let v = await fetchView(adm, liveBatch);
      const g = v.mapping.series.find((s) => s.key === `${type}-${seriesYear}-${level}`)!;
      expect(g).toMatchObject({ mode: 'history', suggestedWindowId: windowId, rows: 5 });
      expect((await putSettings(adm, liveBatch, { series: { [g.key]: { mode: 'window', sessionId: windowId } }, enrol: false, createSections: false })).status).toBe(200);
      v = await fetchView(adm, liveBatch);
      expect(rowAt(v, 'Live', 3).plan.registration).toBe('live');
      expect(codes(rowAt(v, 'Live', 3))).toEqual([]);
      // A first attempt at self-study on a taught subject: today's rule refuses it (IS-03).
      expect(rowAt(v, 'Live', 4).problems.find((p) => p.code === 'self_study_on_taught')).toMatchObject({ severity: 'error', detail: 'a first attempt' });
      expect(codes(rowAt(v, 'Live', 5))).toEqual(['self_study_not_taught']);
      expect(rowAt(v, 'Live', 6).problems.find((p) => p.code === 'registration_refused')!.detail).toBe('Live Subject Free has no price yet — set its fees on Subjects first');
      // Live Two sat Subject B last June (the Past tab): a retake, so self-study is allowed.
      expect(codes(rowAt(v, 'Live', 7))).toEqual(['self_study_retake']);
      expect(rowAt(v, 'Past', 3).plan.registration).toBe('history');
    });

    it('the school-fee gate is the window\'s own: a new family owes the year\'s fee first', async () => {
      const schedule = await apiResponse(finadmin.api.v1['school-fees'].schedules.$post({
        json: { academicYear: `${Y}-${Y + 1}`, amount: 2500, opensAt: new Date(Date.now() - 86_400_000).toISOString() },
      }));
      try {
        const v = await fetchView(adm, liveBatch);
        expect(rowAt(v, 'Live', 3).problems.find((p) => p.code === 'registration_refused')!.detail)
          .toBe(`The ${Y}-${Y + 1} school fee (2500.00 EGP) must be paid before registering subjects`);
      } finally {
        await apiResponse(finadmin.api.v1['school-fees'].schedules[':id'].$delete({ param: { id: schedule.id } }));
      }
      expect(codes(rowAt(await fetchView(adm, liveBatch), 'Live', 3))).toEqual([]);
    });

    it('the row-level answer to self-study; a row left out; the coordinator may not commit registrations', async () => {
      let v = await fetchView(adm, liveBatch);
      await putRows(adm, liveBatch, { rowIds: [rowAt(v, 'Live', 4).id], edits: { selfStudyChoice: 'in_school' } });
      await putRows(adm, liveBatch, { rowIds: [rowAt(v, 'Live', 6).id], decision: 'skip', note: 'no price yet' });
      v = await fetchView(adm, liveBatch);
      expect(rowAt(v, 'Live', 4)).toMatchObject({ mode: 'in_school', plan: { registration: 'live' } });
      expect(v.summary).toMatchObject({ heldFamilies: 0, plan: { registrations: 4, history: 2 } });
      expect(await refused(coordinator.api.v1.imports[':id'].commit.$post({ param: { id: liveBatch } }))).toEqual({
        status: 403, error: 'Registering families in an open window is the admin’s: ask the admin to commit this import, or set those series to "History only"',
      });
      expect((await one<{ status: string }>(`select status from import_batch where id = $1`, [liveBatch])).status).toBe('staged');
    });

    it('the admin commits: registrations await payment in the window, each entered in its board series, never paid', async () => {
      const payments = Number((await one<{ n: string }>(`select count(*) as n from payment`)).n);
      const out = await apiResponse(adm.api.v1.imports[':id'].commit.$post({ param: { id: liveBatch } }));
      expect(out.result.created).toMatchObject({ students: 2, parents: 2, registrations: 4, history: 2 });
      const regs = await sql<{ email: string; subject: string; status: string; price: string; outside: boolean; retake: boolean; series: string | null; teacher: string | null; comments: string }>(
        `select u.email, s.name as subject, r.status, r.price_at_registration as price, r.taken_outside_school as outside, r.is_retake as retake,
                r.board_series_id as series, t.name as teacher, r.approval_comments as comments
         from registration r join "user" u on u.id = r.student_id join subject s on s.id = r.subject_id left join teacher t on t.id = r.teacher_id
         where r.session_id = $1 order by u.email, s.name`, [windowId]);
      expect(regs.map((r) => [r.email.replace(D, ''), r.subject, r.status, Number(r.price), r.outside, r.retake, r.series === seriesId, r.teacher])).toEqual([
        ['live.one', 'Live Subject A', 'pending_payment', 1500, false, false, true, 'Mr Live'],
        ['live.one', 'Live Subject B', 'pending_payment', 1500, false, false, true, null],
        ['live.one', 'Live Subject Self', 'pending_payment', 750, true, false, true, null],
        // A retake of what the student sat before the system, outside school at the outside rate (V3 §6.9).
        ['live.two', 'Live Subject B', 'pending_payment', 750, true, true, true, null],
      ]);
      expect(regs.every((r) => r.comments.startsWith('[IMPORT] live.xlsx — Live row '))).toBe(true);
      expect(Number((await one<{ n: string }>(`select count(*) as n from payment`)).n)).toBe(payments);
      expect(await sql(`select 1 from audit_log where action = 'IMPORT_REGISTRATION' and new_data->>'batchId' = $1`, [liveBatch])).toHaveLength(2);
    });

    it('history before the system counts as a sitting everywhere: the desk registers a retake of it outside school', async () => {
      const two = await one<{ id: string }>(`select id from "user" where email = $1`, [`live.two${D}`]);
      const one1 = await one<{ id: string }>(`select id from "user" where email = $1`, [`live.one${D}`]);
      const desk = (studentId: string) => officer.api.v1.registrations.desk.$post({
        json: { studentId, sessionId: windowId, subjectIds: [L.C!], subjectOptions: { [L.C!]: { takeOutsideSchool: true } } },
      });
      // Live One never sat Subject C: outside school is refused, as before.
      expect(await refused(desk(one1.id))).toEqual({ status: 400, error: 'Subjects can only be taken outside school when retaking or when the school does not offer them' });
      const made = await apiResponse(desk(two.id));
      expect(made.registrations.map((r) => [Number(r.priceAtRegistration), r.isRetake, r.takenOutsideSchool])).toEqual([[750, true, true]]);
    });

    it('history of the window\'s own series, or of a later one, is not a sitting before it: no retake at the desk or in the review', async () => {
      const month = type[0]!.toUpperCase() + type.slice(1);
      const header: Cell[] = ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', ''];
      const three = (cls: string, subject: string, self: 'Yes' | 'No'): Cell[] =>
        ['Live Three', cls, code(), subject, self === 'Yes' ? '' : 'Mr Live', '01046464646', `live.three${D}`, 'Live Parent Three', `live.parent.three${D}`, '01047474747', 'I confirm my registration', self];
      // Recorded before the system, as history (the coordinator's default): Subject C in this window's own
      // series, Subject A in the same month a year later.
      const past = await stage(coordinator, workbook([
        { name: 'Same', rows: [[`${month} ${seriesYear} Session`], header, three('11K', 'Live Subject C', 'No')] },
        { name: 'Later', rows: [[`${month} ${seriesYear + 1} Session`], header, three('12K', 'Live Subject A', 'No')] },
      ]), 'three.xlsx', 'school_sheet');
      expect((await putSettings(coordinator, past, { enrol: false, createSections: false })).status).toBe(200);
      const out = await apiResponse(coordinator.api.v1.imports[':id'].commit.$post({ param: { id: past } }));
      expect(out.result.created).toMatchObject({ students: 1, parents: 1, history: 2, registrations: 0 });
      // The desk: neither subject was sat before this window's series, so outside school is refused.
      const st = await one<{ id: string }>(`select id from "user" where email = $1`, [`live.three${D}`]);
      for (const s of [L.C!, L.A!]) {
        expect(await refused(officer.api.v1.registrations.desk.$post({
          json: { studentId: st.id, sessionId: windowId, subjectIds: [s], subjectOptions: { [s]: { takeOutsideSchool: true } } },
        }))).toEqual({ status: 400, error: 'Subjects can only be taken outside school when retaking or when the school does not offer them' });
      }
      // The review agrees, so the commit is not refused where the review said yes: self-study in this window
      // on C or A (their history is this series or later) and on B (the file's only other row of it is a
      // later series) is a first attempt.
      const again = await stage(adm, workbook([
        { name: 'Again', rows: [[`${month} ${seriesYear} Session`], header, three('11K', 'Live Subject C', 'Yes'), three('11K', 'Live Subject A', 'Yes'), three('11K', 'Live Subject B', 'Yes')] },
        { name: 'Later', rows: [[`${month} ${seriesYear + 1} Session`], header, three('12K', 'Live Subject B', 'No')] },
      ]), 'three-again.xlsx', 'school_sheet');
      expect((await putSettings(adm, again, { series: { [`${type}-${seriesYear}-${level}`]: { mode: 'window', sessionId: windowId } } })).status).toBe(200);
      const v = await fetchView(adm, again);
      for (const n of [3, 4, 5]) {
        expect(rowAt(v, 'Again', n).problems.find((p) => p.code.startsWith('self_study'))).toMatchObject({ code: 'self_study_on_taught', severity: 'error', detail: 'a first attempt' });
      }
      await apiResponse(adm.api.v1.imports[':id'].discard.$post({ param: { id: again } }));
    });
  });

  describe('the interim retake rule: imported history is a sitting only if its series had ended when it was committed', () => {
    let juneWindow: string, subjectN: string, level: 'igcse' | 'as_level' | 'a_level';
    const code = () => (level === 'igcse' ? 'O.L.' : level === 'as_level' ? 'A.S.' : 'A.2.');
    const header: Cell[] = ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', ''];
    const row = (self: 'Yes' | 'No'): Cell[] => ['Nov Hist', '11K', code(), 'Interim Subject N', self === 'Yes' ? '' : 'Mr Live', '01048484848', `nov.hist${D}`, 'Nov Hist Parent', `nov.hist.parent${D}`, '01049494949', 'I confirm my registration', self];

    beforeAll(async () => {
      // A June window of the academic year Y (the June Y+1 series), at a level no earlier suite holds open.
      const taken = new Set((await sql<{ k: string }>(`select qualification_level as k from registration_session where status = 'active' and session_type = 'june'`)).map((r) => r.k));
      const free = (['igcse', 'as_level', 'a_level'] as const).find((l) => !taken.has(l));
      if (!free) throw new Error('08n needs one level with no open June window');
      level = free;
      subjectN = await subject(adm, 'IMP-INT-N', 'Interim Subject N', { course: 1000, registration: 500 }, { qualificationLevel: level });
      juneWindow = await session(adm, 'June window (interim rule)', 'june', level, { ...openWindow(), activate: true, seriesYear: Y + 1 });
      // November Y, imported as history by the coordinator.
      const id = await stage(coordinator, workbook([{ name: 'Nov', rows: [[`Nov. ${Y} Session`], header, row('No')] }]), 'nov-history.xlsx', 'school_sheet');
      expect((await putSettings(coordinator, id, { enrol: false, createSections: false })).status).toBe(200);
      expect((await apiResponse(coordinator.api.v1.imports[':id'].commit.$post({ param: { id } }))).result.created).toMatchObject({ students: 1, history: 1 });
    });
    afterAll(async () => {
      await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: juneWindow }, json: { reason: 'interim rule scenario done: free the pair' } }));
    });

    /** When the file was committed: the history row's own time. */
    const committedOn = (at: string) => sql(`update registration_history set created_at = $1 where student_id = (select id from "user" where email = $2)`, [at, `nov.hist${D}`]);
    const deskOutside = async () => {
      const st = await one<{ id: string }>(`select id from "user" where email = $1`, [`nov.hist${D}`]);
      return officer.api.v1.registrations.desk.$post({ json: { studentId: st.id, sessionId: juneWindow, subjectIds: [subjectN], subjectOptions: { [subjectN]: { takeOutsideSchool: true } } } });
    };
    const reviewSays = async () => {
      const id = await stage(adm, workbook([{ name: 'June', rows: [[`June ${Y + 1} Session`], header, row('Yes')] }]), 'june-self.xlsx', 'school_sheet');
      expect((await putSettings(adm, id, { series: { [`june-${Y + 1}-${level}`]: { mode: 'window', sessionId: juneWindow } }, enrol: false, createSections: false })).status).toBe(200);
      const code = rowAt(await fetchView(adm, id), 'June', 3).problems.find((p) => p.code.startsWith('self_study'))!.code;
      await apiResponse(adm.api.v1.imports[':id'].discard.$post({ param: { id } }));
      return code;
    };

    it('committed while November was still running: not a sitting before June, at the desk or in the review', async () => {
      await committedOn(`${Y}-11-15T10:00:00Z`);
      expect(await refused(deskOutside())).toEqual({ status: 400, error: 'Subjects can only be taken outside school when retaking or when the school does not offer them' });
      expect(await reviewSays()).toBe('self_study_on_taught');
    });

    it('committed after November had ended: a past sitting, so June is a retake outside school at the outside rate', async () => {
      await committedOn(`${Y}-12-01T10:00:00Z`);
      expect(await reviewSays()).toBe('self_study_retake');
      const made = await apiResponse(deskOutside());
      expect(made.registrations.map((r) => [Number(r.priceAtRegistration), r.isRetake, r.takenOutsideSchool])).toEqual([[750, true, true]]);
    });
  });

  describe("SCL's grade-9 roster at the 9→10 boundary (the CSV template)", () => {
    it('a CSV without the template\'s columns is refused with what is missing', async () => {
      const f = await apiResponse(coordinator.api.v1.files.upload.$post({ form: { file: new File([new TextEncoder().encode('name,grade\nA,9\n')], 'wrong.csv', { type: 'text/csv' }), purpose: 'import_file' } }));
      expect(await refused(coordinator.api.v1.imports.$post({ json: { fileId: f.id, kind: 'scl_roster' } }))).toEqual({
        status: 400, error: "This file does not have the template's columns: student_name, student_email, parent_email are missing. Download the template and fill it in.",
      });
    });

    it('each student with the cohort that starts grade 10 next year, up to two parents, and the grade-10 section', async () => {
      const id = await stage(coordinator, sclRoster(), 'scl-roster.csv', 'scl_roster');
      let v = await fetchView(coordinator, id);
      expect(v.rows.map((r) => [r.rowNumber, codes(r)])).toEqual([[2, []], [3, []], [4, ['email_student_missing']]]);
      const yara = person(v, 'student', `yara${D}`);
      expect(yara).toMatchObject({ cohortYear: Y + 1, gradeToday: 9, section: '10A', sclIds: ['SCL-9001'] });
      expect(yara.parentKeys.sort()).toEqual([`heba${D}`, `nabil${D}`]);
      expect(v.mapping.sections.map((s) => [s.name, s.year, s.yearSetUp, s.exists])).toEqual([['10A', Y + 1, true, false], ['10B', Y + 1, true, false]]);
      await putRows(coordinator, id, { rowIds: [v.rows[2]!.id], edits: { studentEmail: `wael.junior${D}` } });
      v = await fetchView(coordinator, id);
      expect(v.summary).toMatchObject({ heldFamilies: 0, plan: { students: { create: 3 }, parents: { create: 4 }, links: 4, sectionPlacements: 3, newSections: 2, enrolments: 0, history: 0 } });
      const out = await apiResponse(coordinator.api.v1.imports[':id'].commit.$post({ param: { id } }));
      expect(out.result.created).toMatchObject({ students: 3, parents: 4, links: 4, sectionPlaces: 3 });
      const made = await sql<{ email: string; cohort: number; section: string; name: string }>(
        `select u.email, u.cohort_year as cohort, s.name as section, u.name from "user" u
         join section_membership m on m.student_id = u.id join section s on s.id = m.section_id join academic_year y on y.id = s.academic_year_id
         where u.email in ($1, $2, $3) and y.start_year = $4 order by u.email`, [`wael.junior${D}`, `yara${D}`, `ziad${D}`, Y + 1]);
      expect(made).toEqual([
        { email: `wael.junior${D}`, cohort: Y + 1, section: '10A', name: 'Wael, Junior' },
        { email: `yara${D}`, cohort: Y + 1, section: '10A', name: 'Yara Nabil' },
        { email: `ziad${D}`, cohort: Y + 1, section: '10B', name: 'Ziad Farouk' },
      ]);
      const acc = await one<{ ids: string[] }>(`select new_data->'sclIds' as ids from audit_log where action = 'IMPORT_ACCOUNT_CREATED' and entity_id = (select id from "user" where email = $1)`, [`yara${D}`]);
      expect(acc.ids).toEqual(['SCL-9001']);
    });
  });

  describe('the money record (F-01): history only, never a payment', () => {
    it('recorded on the students as history; no payment, receipt or balance moves; the same file again adds nothing', async () => {
      const before = await snapshot();
      const id = await stage(coordinator, moneyRecord(), 'money-record.csv', 'money_record');
      let v = await fetchView(coordinator, id);
      expect(v.notes.map((n) => n.code)).toEqual(['money_history_only']);
      expect(v.rows.map((r) => [r.rowNumber, codes(r)])).toEqual([[2, []], [3, []], [4, ['student_not_found']]]);
      expect(v.rows[0]!.data).toMatchObject({ happenedOn: `${Y}-10-05`, amount: 4500, direction: 'in', moneyKind: 'payment', receiptNumber: 'R-0001' });
      await putRows(coordinator, id, { rowIds: [v.rows[2]!.id], decision: 'skip', note: 'not our student' });
      const out = await apiResponse(coordinator.api.v1.imports[':id'].commit.$post({ param: { id } }));
      expect(out.result.created).toMatchObject({ money: 2 });
      const rows = await sql<{ kind: string; direction: string | null; amount: number | null; percent: number | null; on: string | null; ref: string }>(
        `select m.kind, m.direction, m.amount, m.percent, m.happened_on::text as on, m.source_ref as ref from money_history m join "user" u on u.id = m.student_id
         where u.email = $1 and m.import_batch_id = $2 order by m.kind desc`, [`amir${D}`, id]);
      expect(rows.map((r) => [r.kind, r.direction, r.amount === null ? null : Number(r.amount), r.percent === null ? null : Number(r.percent), r.on])).toEqual([
        ['payment', 'in', 4500, null, `${Y}-10-05`], ['drop', 'out', null, 20, `${Y}-10-20`],
      ]);
      expect(rows.every((r) => r.ref.startsWith('money-record.csv — money-record row '))).toBe(true);
      expect(await snapshot()).toEqual({ ...before, money: before.money + 2 });
      // Again: the same lines are found, nothing new.
      const again = await stage(coordinator, moneyRecord(), 'money-record.csv', 'money_record');
      v = await fetchView(coordinator, again);
      expect(v.rows.filter((r) => r.decision === 'import').every((r) => codes(r).includes('already_imported'))).toBe(true);
      await apiResponse(coordinator.api.v1.imports[':id'].commit.$post({ param: { id: again } }));
      expect(await snapshot()).toEqual({ ...before, money: before.money + 2 });
    });

    it('the import cannot make a payment: the code that commits it touches no payment, escrow or receipt table', async () => {
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const money = /\b(payment|paymentRegistration|escrow|escrowTransaction|receipt|withdrawalRequest|withdrawalDisbursement)\b/;
      for (const f of ['../src/services/import/commit.ts', '../src/services/import.services.ts']) {
        const text = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
        const fromDb = [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@repo\/db'/g)].map((m) => m[1]!).join(',');
        expect(fromDb.split(',').map((x) => x.trim()).filter((x) => money.test(x)), f).toEqual([]);
        expect(/\b(insert|update)\s+(into\s+)?"?(payment|escrow|escrow_transaction|receipt)\b/i.test(text), f).toBe(false);
      }
    });
  });

  describe('files that must not be read whole, and the order of exam series', () => {
    const stageRefused = async (bytes: Buffer, name: string) => {
      const f = await apiResponse(coordinator.api.v1.files.upload.$post({ form: { file: new File([new Uint8Array(bytes)], name, { type: XLSX }), purpose: 'import_file' } }));
      return refused(coordinator.api.v1.imports.$post({ json: { fileId: f.id, kind: 'school_sheet' } }));
    };

    it('a workbook with too many parts, or parts that inflate too far together, is refused before it is read', async () => {
      // Workbooks as the upload recognises them (the content types part first), then the parts that hurt.
      const types = { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>') };
      const book = { name: 'xl/workbook.xml', data: Buffer.from('<workbook><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>') };
      const tiny = Buffer.from('<x/>');
      const many = zip([types, book, ...Array.from({ length: 2000 }, (_, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: tiny }))]);
      expect(await stageRefused(many, 'many-parts.xlsx')).toEqual({ status: 400, error: 'This workbook has too many parts to read' });
      // Three parts of 50 MB each: each under the per-part cap, together over the workbook's.
      const zeros = Buffer.alloc(50 * 1024 * 1024);
      const bomb = zip([types, book, ...[1, 2, 3].map((i) => ({ name: `xl/worksheets/sheet${i}.xml`, data: zeros }))]);
      expect(bomb.length).toBeLessThan(1024 * 1024);
      expect(await stageRefused(bomb, 'bomb.xlsx')).toEqual({ status: 400, error: 'This workbook is too large to read' });
    });

    it('seriesOrder: October before November of the same year; the same month of another board is the same sitting', () => {
      expect(seriesOrder('october', Y)).toBeLessThan(seriesOrder('november', Y));
      expect(seriesOrder('november', Y)).toBeLessThan(seriesOrder('january', Y + 1));
      expect(seriesOrder('january', Y + 1)).toBeLessThan(seriesOrder('june', Y + 1));
      expect(seriesOrder('june', Y + 1)).toBeLessThan(seriesOrder('october', Y + 1));
      // A Pearson June and a Cambridge June are one sitting: neither is before the other.
      expect(seriesOrder('june', Y)).toBe(seriesOrder('june', Y));
    });
  });

  describe('the catalogue from the review, and a file put aside', () => {
    it('the admin adds the sheet\'s missing subjects in one step (they carry prices; one with no price is added inactive); the coordinator may not', async () => {
      const sheet = workbook([{ name: 'Extra', rows: [
        [`Nov. ${Y} Session`],
        ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Student Email', '', 'Parent Email'],
        ['Extra Child', '11G', 'O.L.', 'Astronomy', `extra${D}`, 'Extra Parent', `extra.parent${D}`],
        ['Extra Child', '11G', 'O.L.', 'Cosmology', `extra${D}`, 'Extra Parent', `extra.parent${D}`],
      ] }]);
      const id = await stage(adm, sheet, 'extra.xlsx', 'school_sheet');
      let v = await fetchView(adm, id);
      const s = v.mapping.subjects.find((x) => x.subject === 'Astronomy')!;
      const c = v.mapping.subjects.find((x) => x.subject === 'Cosmology')!;
      expect(s).toMatchObject({ subject: 'Astronomy', levelCode: 'O.L.', subjectId: null, levelSuggested: 'igcse', taughtInSchool: true });
      const body = { subjects: [
        { key: s.key, name: 'Astronomy', code: 'imp-ast', qualificationLevel: 'igcse' as const, council: 'cambridge' as const, isOfferedAtSchool: true, courseFee: 900, registrationFee: 300 },
        { key: c.key, name: 'Cosmology', code: 'imp-cos', qualificationLevel: 'igcse' as const, council: 'cambridge' as const, isOfferedAtSchool: true, courseFee: 0, registrationFee: 0 },
      ] };
      expect((await refused(coordinator.api.v1.imports[':id'].subjects.$post({ param: { id }, json: body }))).status).toBe(403);
      await apiResponse(adm.api.v1.imports[':id'].subjects.$post({ param: { id }, json: body }));
      v = await fetchView(adm, id);
      const made = await one<{ id: string; code: string; price: string; active: boolean }>(`select id, code, price_in_school as price, is_active as active from subject where code = 'IMP-AST'`);
      const unpriced = await one<{ id: string; price: string; active: boolean }>(`select id, price_in_school as price, is_active as active from subject where code = 'IMP-COS'`);
      expect(v.mapping.subjects.find((x) => x.subject === 'Astronomy')!.subjectId).toBe(made.id);
      expect(v.mapping.subjects.find((x) => x.subject === 'Cosmology')!.subjectId).toBe(unpriced.id);
      expect([Number(made.price), made.active]).toEqual([1200, true]);
      // No price: added inactive. Its row keeps it as history; no enrolment is made for it, and the review says why.
      expect([Number(unpriced.price), unpriced.active]).toEqual([0, false]);
      expect(rowAt(v, 'Extra', 3).plan.enrolment).toBe('create');
      expect(rowAt(v, 'Extra', 4).plan.enrolment).toBe('none');
      expect(rowAt(v, 'Extra', 4).problems.find((p) => p.code === 'subject_inactive')).toMatchObject({ severity: 'warning', detail: 'Cosmology: no enrolment until its fees are set and it is turned on' });
      await audited([made.id], ['SUBJECT_CREATED']);
      await audited([unpriced.id], ['SUBJECT_CREATED']);
      expect(await refused(adm.api.v1.imports[':id'].subjects.$post({ param: { id }, json: body }))).toEqual({
        status: 409, error: 'A subject with the code IMP-AST exists already — map "Astronomy" to it, or choose another code',
      });

      // Put aside: nothing it would make is made, and it takes no more changes.
      expect(await apiResponse(coordinator.api.v1.imports[':id'].discard.$post({ param: { id } }))).toEqual({ id, status: 'discarded' });
      expect((await refused(coordinator.api.v1.imports[':id'].commit.$post({ param: { id } }))).error).toBe('This import was discarded');
      expect((await refused(putSettings(coordinator, id, { enrol: false }))).status).toBe(409);
      expect(await sql(`select 1 from "user" where email = $1`, [`extra${D}`])).toEqual([]);
      await audited([id], ['IMPORT_STAGED', 'IMPORT_DISCARDED']);
    });

    it('the list of imports: every file, its state and its counts', async () => {
      const list = await apiResponse(coordinator.api.v1.imports.$get());
      const first = list.find((b) => b.id === firstBatch)!;
      expect(first).toMatchObject({ kind: 'school_sheet', fileName: 'Nov registration.xlsx', status: 'committed', rows: 24, committedFamilies: 11 });
      expect(list.some((b) => b.status === 'discarded')).toBe(true);
    });
  });

  describe('two staff committing the same staged file at the same moment', () => {
    const raceSheet = () => workbook([{
      name: 'Race', rows: [
        [`Nov. ${Y} Session`],
        ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', '', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', ''],
        ...[1, 2, 3, 4].map((i): Cell[] => [`Race Child ${i}`, '11G', 'O.L.', 'Computer Science', 'Mr Karim', serial(Y, 11), `010000000${i}0`, `race${i}${D}`, `Race Parent ${i}`, `race.parent${i}${D}`, `011000000${i}0`, 'I confirm my registration', 'No']),
      ],
    }]);

    it('one commit runs, the other is refused while it does; each family is made once', async () => {
      const id = await stage(adm, raceSheet(), 'race.xlsx', 'school_sheet');
      const release = await holdRowLock('import_batch', id);
      const first = adm.api.v1.imports[':id'].commit.$post({ param: { id } });
      const second = adm2.api.v1.imports[':id'].commit.$post({ param: { id } });
      await lockWaiters(2);
      await release();
      const results = await Promise.all([first, second].map((p) => refused(p)));
      // Each family made once — checked before who was refused, so a control that lets both commits run
      // fails here if a family is made twice, and only on the answers if the families still hold.
      expect(Number((await one<{ n: string }>(`select count(*) as n from "user" where email like 'race%'`)).n)).toBe(8);
      expect(await sql(`select 1 from audit_log where action = 'IMPORT_FAMILY_COMMITTED' and entity_id = $1`, [id])).toHaveLength(4);
      expect(await sql(`select 1 from course_enrolment e join "user" u on u.id = e.student_id where u.email like 'race%'`)).toHaveLength(4);
      expect(await sql(`select 1 from audit_log where action = 'IMPORT_COMMITTED' and entity_id = $1`, [id])).toHaveLength(1);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.error).toMatch(/^Admin imp2? is committing this import now — wait for it to finish, then look again$/);
      expect((await one<{ status: string; started: string | null }>(`select status, commit_started_by as started from import_batch where id = $1`, [id]))).toEqual({ status: 'committed', started: null });
    });
  });

  describe('a commit left behind is taken over after 15 minutes, and the one taken over never undoes the new holder', () => {
    const sheet = (tag: string, teacher: string) => workbook([{
      name: 'Stale', rows: [
        [`Nov. ${Y} Session`],
        ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', '', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', ''],
        ...[1, 2].map((i): Cell[] => [`${tag} Child ${i}`, '11G', 'O.L.', 'Computer Science', teacher, serial(Y, 11), `010000001${i}0`, `${tag}${i}${D}`, `${tag} Parent ${i}`, `${tag}.parent${i}${D}`, `011000001${i}0`, 'I confirm my registration', 'No']),
      ],
    }]);
    const batch = (id: string) => one<{ status: string; by: string | null; committed_by: string | null }>(
      `select status, commit_started_by as by, committed_by from import_batch where id = $1`, [id]);

    it('a claim under 15 minutes old is refused, naming who holds it; an older one is taken over and the commit runs', async () => {
      const id = await stage(adm, sheet('stale', 'Mr Karim'), 'stale.xlsx', 'school_sheet');
      // A commit that stopped part-way (its process gone): the batch still says it is being committed.
      await sql(`update import_batch set status = 'committing', commit_started_by = $1, commit_started_at = now() - interval '14 minutes' where id = $2`, [coordinator.id, id]);
      expect(await refused(adm.api.v1.imports[':id'].commit.$post({ param: { id } }))).toEqual({
        status: 409, error: 'coordinator imp is committing this import now — wait for it to finish, then look again',
      });
      await sql(`update import_batch set commit_started_at = now() - interval '16 minutes' where id = $1`, [id]);
      const out = await apiResponse(adm.api.v1.imports[':id'].commit.$post({ param: { id } }));
      expect(out.result.created).toMatchObject({ students: 2, parents: 2 });
      expect(await batch(id)).toEqual({ status: 'committed', by: null, committed_by: adm.id });
      expect(await sql(`select 1 from audit_log where action = 'IMPORT_COMMITTED' and entity_id = $1`, [id])).toHaveLength(1);
    });

    it('a commit still running when its claim is taken over stops without resetting the new holder\'s claim', async () => {
      const id = await stage(adm, sheet('overtaken', 'Ms Overtaken'), 'overtaken.xlsx', 'school_sheet');
      // Hold the lock the commit takes to make reference data (a new teacher), so each commit waits there.
      const { default: pg } = await import('pg');
      const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      await holder.query(`select pg_advisory_lock(hashtext('import:reference'))`);
      let released = false;
      const release = async () => { if (!released) { released = true; await holder.query(`select pg_advisory_unlock(hashtext('import:reference'))`); await holder.end(); } };
      try {
        const first = coordinator.api.v1.imports[':id'].commit.$post({ param: { id } });
        await lockWaiters(1);
        expect(await batch(id)).toMatchObject({ status: 'committing', by: coordinator.id });
        // Fifteen minutes on, the first commit looks stopped: the admin takes the claim over.
        await sql(`update import_batch set commit_started_at = now() - interval '16 minutes' where id = $1`, [id]);
        const second = adm.api.v1.imports[':id'].commit.$post({ param: { id } });
        await lockWaiters(2);
        expect(await batch(id)).toMatchObject({ status: 'committing', by: adm.id });
        // The first commit was not stopped after all: it fails now, while the second holds the claim.
        const [waiting] = await sql<{ pid: number }>(
          `select pid from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%pg_advisory_xact_lock%' order by query_start limit 1`);
        await sql(`select pg_cancel_backend($1)`, [waiting!.pid]);
        expect(await refused(first)).toEqual({ status: 400, error: 'Failed to commit the import' });
        expect(await batch(id)).toMatchObject({ status: 'committing', by: adm.id });
        await release();
        const out = await apiResponse(second);
        expect(out.result.created).toMatchObject({ students: 2, parents: 2 });
        expect(await batch(id)).toEqual({ status: 'committed', by: null, committed_by: adm.id });
        expect(await sql(`select 1 from audit_log where action = 'IMPORT_COMMITTED' and entity_id = $1`, [id])).toHaveLength(1);
        expect(await sql(`select 1 from teacher where name = 'Ms Overtaken'`)).toHaveLength(1);
      } finally {
        await release();
      }
    });

    it('a commit taken over that runs on to the end leaves the batch to the new holder: its families once, one IMPORT_COMMITTED', async () => {
      const id = await stage(adm, sheet('runon', 'Ms Runon'), 'runon.xlsx', 'school_sheet');
      const { default: pg } = await import('pg');
      const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      await holder.query(`select pg_advisory_lock(hashtext('import:reference'))`);
      let released = false;
      const release = async () => { if (!released) { released = true; await holder.query(`select pg_advisory_unlock(hashtext('import:reference'))`); await holder.end(); } };
      try {
        const first = coordinator.api.v1.imports[':id'].commit.$post({ param: { id } });
        await lockWaiters(1);
        await sql(`update import_batch set commit_started_at = now() - interval '16 minutes' where id = $1`, [id]);
        const second = adm.api.v1.imports[':id'].commit.$post({ param: { id } });
        await lockWaiters(2);
        // Both run on: the first (queued first) makes the teacher and the families; the second finds them made.
        await release();
        const [a, b] = await Promise.all([refused(first), refused(second)]);
        expect(Number((await one<{ n: string }>(`select count(*) as n from "user" where email like 'runon%'`)).n)).toBe(4);
        expect(await sql(`select 1 from audit_log where action = 'IMPORT_FAMILY_COMMITTED' and entity_id = $1`, [id])).toHaveLength(2);
        expect(await sql(`select 1 from audit_log where action = 'IMPORT_COMMITTED' and entity_id = $1`, [id])).toHaveLength(1);
        expect(a).toEqual({ status: 409, error: 'Another commit took this import over while this one was running: look at the import again to see what each made' });
        expect(b.status).toBe(200);
        expect(await batch(id)).toEqual({ status: 'committed', by: null, committed_by: adm.id });
      } finally {
        await release();
      }
    });

    it('the re-read under the lock: a family the other commit made while this one waited for its rows is not made again', async () => {
      // A family already in the system (Amir and his father, from the first file) with one new line: nothing
      // in it is a new account, so only the family's own re-read can tell that the other commit made it.
      const id = await stage(adm, workbook([{ name: 'Reread', rows: [
        [`Nov. ${Y} Session`],
        ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', '', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', ''],
        ['Amir Fahmy', '11F', 'O.L.', 'Geology', 'Ms Reread', serial(Y, 11), 1011111111, `amir${D}`, 'Hany Fahmy', `hany${D}`, 1022222222, 'I confirm my registration', 'No'],
      ] }]), 'reread.xlsx', 'school_sheet');
      const [line] = await sql<{ id: string }>(`select id from import_row where batch_id = $1`, [id]);
      const { default: pg } = await import('pg');
      const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      await holder.query(`select pg_advisory_lock(hashtext('import:reference'))`);
      let refReleased = false;
      const releaseRef = async () => { if (!refReleased) { refReleased = true; await holder.query(`select pg_advisory_unlock(hashtext('import:reference'))`); await holder.end(); } };
      let releaseRow: (() => Promise<void>) | null = null;
      const rowWaiters = (n: number) => waitFor(async () => Number((await one<{ n: string }>(
        `select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%from "import_row"%for update%'`)).n) >= n || null);
      try {
        const first = coordinator.api.v1.imports[':id'].commit.$post({ param: { id } });
        await lockWaiters(1);
        await sql(`update import_batch set commit_started_at = now() - interval '16 minutes' where id = $1`, [id]);
        const second = adm.api.v1.imports[':id'].commit.$post({ param: { id } });
        await lockWaiters(2);
        // Hold the family's line, then let both through the reference step: each works the family out
        // (ready, nothing made yet) and waits for its line.
        releaseRow = await holdRowLock('import_row', line!.id);
        await releaseRef();
        await rowWaiters(2);
        await releaseRow();
        releaseRow = null;
        const [a, b] = await Promise.all([refused(first), refused(second)]);
        expect(await sql(`select 1 from audit_log where action = 'IMPORT_FAMILY_COMMITTED' and entity_id = $1`, [id])).toHaveLength(1);
        // The line still says what the first commit made for it (the history row), not "exists" written over it.
        const made = await sql<{ id: string }>(`select id from registration_history where subject_label = 'Geology' and student_id = (select id from "user" where email = $1)`, [`amir${D}`]);
        expect(made).toHaveLength(1);
        expect(await one(`select status, outcome->>'history' as history from import_row where id = $1`, [line!.id])).toEqual({ status: 'committed', history: made[0]!.id });
        expect(a).toEqual({ status: 409, error: 'Another commit took this import over while this one was running: look at the import again to see what each made' });
        expect(b.status).toBe(200);
      } finally {
        if (releaseRow) await releaseRow();
        await releaseRef();
      }
    });
  });
});
