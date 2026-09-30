import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, academicYearShortLabel, seriesYearInAcademicYear } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, feedSeries, refused, one, sql, audited, openWindow, holdRowLock, lockWaiters, type Client,
} from './helpers';
import { schoolSheet, sclRoster, moneyRecord, workbook, serial, years, D, type Cell } from './import-fixtures';

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
      expect(codes(r)).toEqual(['fee_note', 'self_study_on_taught', 'teacher_missing']);
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
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.error).toMatch(/^Admin imp2? is committing this import now — wait for it to finish, then look again$/);
      expect(Number((await one<{ n: string }>(`select count(*) as n from "user" where email like 'race%'`)).n)).toBe(8);
      expect(await sql(`select 1 from audit_log where action = 'IMPORT_FAMILY_COMMITTED' and entity_id = $1`, [id])).toHaveLength(4);
      expect(await sql(`select 1 from audit_log where action = 'IMPORT_COMMITTED' and entity_id = $1`, [id])).toHaveLength(1);
      expect(await sql(`select 1 from course_enrolment e join "user" u on u.id = e.student_id where u.email like 'race%'`)).toHaveLength(4);
      expect((await one<{ status: string; started: string | null }>(`select status, commit_started_by as started from import_batch where id = $1`, [id]))).toEqual({ status: 'committed', started: null });
    });
  });
});
