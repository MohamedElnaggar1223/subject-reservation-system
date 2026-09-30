import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, audited, futureWindow, feedSeries, type Client,
} from './helpers';

/**
 * F0b — the exam catalogue (FEATURES_PLAN.md F0b; DISCOVERY_RESEARCH.md §5
 * notes 2–4; IMPORT_SPIKE.md IS-01, IS-14).
 *
 * Boards, qualifications (Pearson X/Y cash-ins, Cambridge syllabuses), units
 * and components with their own level, the unit-to-award map, Cambridge
 * option codes, and what each registrable row enters. The school's level
 * code ("A.S./A.2.") is derived from the unit's own level, the awards it
 * counts toward and the student's year — never stored.
 *
 * Windows here are drafts (families preregister), so no (type, level) pair
 * is held open for the suites after this one.
 */

const getCatalogue = (c: Client) => apiResponse(c.api.v1.catalogue.$get());
type Catalogue = Awaited<ReturnType<typeof getCatalogue>>;

describe('F0b: the exam catalogue', () => {
  let adm: Client, coordinator: Client, officer: Client, teacher: Client, finadmin: Client;
  const fetchCatalogue = () => getCatalogue(coordinator);

  afterAll(async () => {
    await sql(`delete from school_setting where key = 'catalogue.levelCodeReading'`);
  });

  beforeAll(async () => {
    adm = await admin('cat');
    coordinator = await staff(adm, 'coordinator', 'cat');
    officer = await staff(adm, 'finance_officer', 'cat');
    finadmin = await staff(adm, 'finance_admin', 'cat');
    teacher = await staff(adm, 'teacher', 'cat');
  });

  describe('boards', () => {
    it('the three boards are there with the months each sits, and the coordinator keeps them', async () => {
      const cat = await fetchCatalogue();
      const board = (code: string) => cat.boards.find((b) => b.code === code)!;
      expect(board('pearson_edexcel')).toMatchObject({ name: 'Pearson Edexcel', seriesMonths: ['january', 'june', 'october', 'november'] });
      expect(board('cambridge')).toMatchObject({ name: 'Cambridge International', seriesMonths: ['june', 'november'] });
      expect(board('oxford')).toMatchObject({ name: 'OxfordAQA', seriesMonths: ['january', 'june', 'november'] });
      // Teachers and the desk read it; the gate does not (04 covers every role).
      expect((await getCatalogue(teacher)).boards.length).toBe(cat.boards.length);
      expect((await getCatalogue(officer)).boards.length).toBe(cat.boards.length);

      await apiResponse(coordinator.api.v1.catalogue.boards[':code'].$put({ param: { code: 'cambridge' }, json: { entryPortal: 'Cambridge Direct (school account)' } }));
      await audited(['cambridge'], ['BOARD_UPDATED']);
      expect((await fetchCatalogue()).boards.find((b) => b.code === 'cambridge')!.entryPortal).toBe('Cambridge Direct (school account)');
      // The desk reads, but does not change, the catalogue.
      expect((await refused(finadmin.api.v1.catalogue.boards[':code'].$put({ param: { code: 'cambridge' }, json: { notes: 'x' } }))).status).toBe(403);
    });

    it('a series cannot be added in a month the board does not sit; the board\'s months are data', async () => {
      const r = await refused(coordinator.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'january', year: 2031, label: 'catalogue' } }));
      expect(r).toEqual({ status: 400, error: 'Cambridge International sits June and November series — change the board\'s months on the Catalogue screen if it now sits in January' });
    });
  });

  describe('a unit counting toward AS and A Level (IS-01)', () => {
    let m1Subject: string, p1Subject: string, p3Subject: string, asWindow: string, alWindow: string;
    let g11: { parent: Client; studentId: string }, g12: { parent: Client; studentId: string };
    const unit = (cat: Catalogue, code: string) => cat.units.find((u) => u.code === code)!;
    const award = (cat: Catalogue, code: string) => cat.qualifications.find((q) => q.code === code)!;

    it('the Pearson IAL Mathematics starter set: units with their own level, awards with their units (idempotent)', async () => {
      expect(await apiResponse(coordinator.api.v1.catalogue.starter.$post({ json: { set: 'pearson_ial_mathematics' } })))
        .toEqual({ set: 'pearson_ial_mathematics', unitsAdded: 9, awardsAdded: 2 });
      expect(await apiResponse(coordinator.api.v1.catalogue.starter.$post({ json: { set: 'pearson_ial_mathematics' } })))
        .toEqual({ set: 'pearson_ial_mathematics', unitsAdded: 0, awardsAdded: 0 });

      const cat = await fetchCatalogue();
      // M1's own level is AS; it counts toward the AS award and the A Level award.
      expect(unit(cat, 'WME01')).toMatchObject({ shortCode: 'M1', title: 'Mechanics 1', unitLevel: 'as', kind: 'unit', boardCode: 'pearson_edexcel' });
      expect(unit(cat, 'WME01').countsToward.map((a) => [a.code, a.level, a.requirement]).sort())
        .toEqual([['XMA01', 'as_level', 'optional'], ['YMA01', 'a_level', 'optional']]);
      // P3 is an A2 unit: it counts toward the A Level only.
      expect(unit(cat, 'WMA13')).toMatchObject({ shortCode: 'P3', unitLevel: 'a2' });
      expect(unit(cat, 'WMA13').countsToward.map((a) => a.code)).toEqual(['YMA01']);
      // AS Mathematics = P1 + P2 + one of M1, S1, D1 (Pearson's aggregation rules).
      const xma = award(cat, 'XMA01');
      expect(xma).toMatchObject({ level: 'as_level', subjectArea: 'Mathematics', entryMethod: 'units_cash_in', suite: 'International A Level' });
      expect(xma.units.map((u) => [u.code, u.requirement, u.choiceGroup])).toEqual([
        ['WMA11', 'required', null],
        ['WMA12', 'required', null],
        ['WME01', 'optional', 'Applied: one of M1, S1, D1'],
        ['WST01', 'optional', 'Applied: one of M1, S1, D1'],
        ['WDM11', 'optional', 'Applied: one of M1, S1, D1'],
      ]);
      expect(award(cat, 'YMA01').units.filter((u) => u.requirement === 'required').map((u) => u.shortCode)).toEqual(['P1', 'P2', 'P3', 'P4']);
      await audited(['pearson_edexcel'], ['CATALOGUE_STARTER_LOADED']);
    });

    it('the map keeps a unit\'s own level: an A2 unit never counts toward an AS award, a unit never toward another board\'s award', async () => {
      const cat = await fetchCatalogue();
      const xma = award(cat, 'XMA01');
      const keep = xma.units.map((u) => ({ unitId: u.unitId, requirement: u.requirement as 'required' | 'optional', choiceGroup: u.choiceGroup }));
      const a2 = await refused(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({
        param: { id: xma.id }, json: { units: [...keep, { unitId: unit(cat, 'WMA13').id, requirement: 'optional' as const }] },
      }));
      expect(a2).toEqual({ status: 400, error: 'WMA13 are A2 units: they count toward an A Level, not an AS' });
      const camb = await apiResponse(coordinator.api.v1.catalogue.units.$post({
        json: { boardCode: 'cambridge', code: '9709/41', shortCode: 'Paper 4', title: 'Mechanics', unitLevel: 'as', kind: 'component' },
      }));
      const foreign = await refused(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({
        param: { id: xma.id }, json: { units: [...keep, { unitId: camb.id, requirement: 'optional' as const }] },
      }));
      expect(foreign).toEqual({ status: 400, error: '9709/41 belong to another board than XMA01' });
    });

    it('registrable rows are units: M1, P1 and P3 map to their units, and a row\'s level must fit what it enters', async () => {
      const cat = await fetchCatalogue();
      m1Subject = await subject(adm, 'CAT-M1', 'Mechanics 1 (catalogue)', { course: 800, registration: 400 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
      p1Subject = await subject(adm, 'CAT-P1', 'Pure Mathematics 1 (catalogue)', { course: 800, registration: 400 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
      p3Subject = await subject(adm, 'CAT-P3', 'Pure Mathematics 3 (catalogue)', { course: 800, registration: 400 }, { qualificationLevel: 'a_level', council: 'pearson_edexcel' });
      const map = (subjectId: string, unitCode: string) => coordinator.api.v1.catalogue.registrable[':subjectId'].$put({
        param: { subjectId }, json: { boardCode: 'pearson_edexcel', qualificationId: null, unitIds: [unit(cat, unitCode).id] },
      });
      // An AS row cannot enter an A2 unit, nor enter the A Level award.
      expect(await refused(map(m1Subject, 'WMA13'))).toEqual({
        status: 400, error: 'WMA13 are A2 units: Mechanics 1 (catalogue) is registered at AS Level, which enters AS units only',
      });
      expect((await refused(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({
        param: { subjectId: m1Subject }, json: { boardCode: 'pearson_edexcel', qualificationId: award(cat, 'YMA01').id, unitIds: [] },
      })))).toEqual({ status: 400, error: 'Mechanics 1 (catalogue) is registered at AS Level; YMA01 is A Level' });
      await apiResponse(map(m1Subject, 'WME01'));
      await apiResponse(map(p1Subject, 'WMA11'));
      await apiResponse(map(p3Subject, 'WMA13'));
      await audited([m1Subject], ['SUBJECT_CATALOGUE_MAPPED']);

      const rows = (await fetchCatalogue()).registrable;
      const m1 = rows.find((r) => r.id === m1Subject)!;
      expect(m1).toMatchObject({ mapped: true, qualification: null, council: 'pearson_edexcel' });
      expect(m1.units.map((u) => [u.code, u.unitLevel])).toEqual([['WME01', 'as']]);
      expect(m1.countsToward.map((a) => a.code).sort()).toEqual(['XMA01', 'YMA01']);
      expect(rows.find((r) => r.id === p3Subject)!.units.map((u) => [u.code, u.unitLevel])).toEqual([['WMA13', 'a2']]);
    });

    it('"A.S./A.2." is derived per registration from the unit\'s level, the awards and the student\'s year — and nothing stored moves when the reading changes', async () => {
      // An AS window and an A Level window feed one Pearson January series.
      asWindow = await session(adm, 'January (AS, catalogue)', 'january', 'as_level', futureWindow());
      alWindow = await session(adm, 'January (A-Level, catalogue)', 'january', 'a_level', futureWindow());
      const seriesId = await feedSeries(adm, asWindow, { label: 'catalogue' });
      await apiResponse(adm.api.v1.sessions[':id']['board-series'].$put({ param: { id: alWindow }, json: { series: [{ boardSeriesId: seriesId, isDefault: true }], routes: [] } }));

      g11 = await onboard(officer, 'cat-g11', 11);
      g12 = await onboard(officer, 'cat-g12', 12);
      const prereg = (f: { parent: Client; studentId: string }, sessionId: string, subjectIds: string[]) =>
        apiResponse(f.parent.api.v1.registrations.preregister.$post({ json: { sessionId, subjectIds, studentId: f.studentId } }));
      // Grade 11 sits P1 and M1 (AS units only); grade 12 sits M1 with P3 (an A2 unit) in the same series.
      const [g11p1, g11m1] = await prereg(g11, asWindow, [p1Subject, m1Subject]).then((r) => [r.find((x) => x.subjectId === p1Subject)!.id, r.find((x) => x.subjectId === m1Subject)!.id]);
      const g12m1 = (await prereg(g12, asWindow, [m1Subject]))[0]!.id;
      const g12p3 = (await prereg(g12, alWindow, [p3Subject]))[0]!.id;
      const ids = [g11p1!, g11m1!, g12m1, g12p3];

      const codes = async () => {
        const items = [
          ...await apiResponse(coordinator.api.v1.catalogue.entries.$get({ query: { sessionId: asWindow } })),
          ...await apiResponse(coordinator.api.v1.catalogue.entries.$get({ query: { sessionId: alWindow } })),
        ];
        return Object.fromEntries(ids.map((id) => [id, items.find((i) => i.registrationId === id)!.levelCode]));
      };
      const stored = () => sql(`select * from registration where id in ($1, $2, $3, $4) order by id`, ids);
      const before = await stored();

      // The default reading is the owner's words: "A.S./A.2." for a student sitting both in one series.
      const items = await apiResponse(coordinator.api.v1.catalogue.entries.$get({ query: { sessionId: asWindow } }));
      const g12M1Item = items.find((i) => i.registrationId === g12m1)!;
      expect(g12M1Item).toMatchObject({
        boardCode: 'pearson_edexcel', gradeInSeriesYear: 12,
        boardSeries: { id: seriesId, month: 'january' },
        units: [{ code: 'WME01', unitLevel: 'as' }],
      });
      expect(g12M1Item.countsToward.map((a) => a.code).sort()).toEqual(['XMA01', 'YMA01']);
      expect(await codes()).toEqual({ [g11p1!]: 'A.S.', [g11m1!]: 'A.S.', [g12m1]: 'A.S./A.2.', [g12p3]: 'A.2.' });

      const read = async (value: string) => {
        await apiResponse(coordinator.api.v1.settings[':key'].$put({ param: { key: 'catalogue.levelCodeReading' }, json: { value, reason: 'coordinator answered IS-01 (scenario)' } }));
        return codes();
      };
      // What the unit counts toward: every AS Mathematics unit also counts toward the A Level.
      expect(await read('awards')).toEqual({ [g11p1!]: 'A.S./A.2.', [g11m1!]: 'A.S./A.2.', [g12m1]: 'A.S./A.2.', [g12p3]: 'A.2.' });
      // The student's year: an AS unit sat in grade 12.
      expect(await read('student_year')).toEqual({ [g11p1!]: 'A.S.', [g11m1!]: 'A.S.', [g12m1]: 'A.S./A.2.', [g12p3]: 'A.2.' });
      // Only an entry that mixes AS and A2 units.
      expect(await read('units')).toEqual({ [g11p1!]: 'A.S.', [g11m1!]: 'A.S.', [g12m1]: 'A.S.', [g12p3]: 'A.2.' });
      await audited(['catalogue.levelCodeReading'], ['SETTING_CHANGED', 'SETTING_CHANGED', 'SETTING_CHANGED']);
      // Derived, never stored: the registrations are exactly as they were.
      expect(await stored()).toEqual(before);
    });

    it('a paper set mixing AS and A2 papers reads "A.S./A.2." under every reading (Biology Paper 3 & 4)', async () => {
      expect(await apiResponse(coordinator.api.v1.catalogue.starter.$post({ json: { set: 'pearson_ial_biology' } })))
        .toEqual({ set: 'pearson_ial_biology', unitsAdded: 6, awardsAdded: 2 });
      const cat = await fetchCatalogue();
      const bio34 = await subject(adm, 'CAT-BIO34', 'Biology (Paper 3 & Paper 4) (catalogue)', { course: 900, registration: 450 }, { qualificationLevel: 'a_level', council: 'pearson_edexcel' });
      await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({
        param: { subjectId: bio34 }, json: { boardCode: 'pearson_edexcel', qualificationId: award(cat, 'YBI11').id, unitIds: [unit(cat, 'WBI13').id, unit(cat, 'WBI14').id] },
      }));
      const row = (await fetchCatalogue()).registrable.find((r) => r.id === bio34)!;
      expect(row).toMatchObject({ qualification: { code: 'YBI11', level: 'a_level' }, levelCode: { grade11: 'A.S./A.2.', grade12WithA2: 'A.S./A.2.' } });
      expect(row.units.map((u) => [u.shortCode, u.unitLevel])).toEqual([['Unit 3', 'as'], ['Unit 4', 'a2']]);
      // A unit that does not count toward the award named is refused.
      const off = await refused(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({
        param: { subjectId: bio34 }, json: { boardCode: 'pearson_edexcel', qualificationId: award(cat, 'XBI11').id, unitIds: [unit(cat, 'WBI13').id] },
      }));
      expect(off).toEqual({ status: 400, error: 'Biology (Paper 3 & Paper 4) (catalogue) is registered at A Level; XBI11 is AS Level' });
    });
  });

  describe('Cambridge: a syllabus, its components and option codes', () => {
    it('9700 leads to an AS and an A Level award under one code; option codes name the components each enters', async () => {
      const q = (level: 'as_level' | 'a_level', title: string) => apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
        json: { boardCode: 'cambridge', code: '9700', title, level, suite: 'Cambridge International AS & A Level', subjectArea: 'Biology', entryMethod: 'syllabus_option' },
      }));
      const asAward = await q('as_level', 'Biology (AS Level)');
      const alAward = await q('a_level', 'Biology (A Level)');
      expect((await refused(coordinator.api.v1.catalogue.qualifications.$post({
        json: { boardCode: 'cambridge', code: '9700', title: 'again', level: 'a_level', subjectArea: 'Biology', entryMethod: 'syllabus_option', suite: '' },
      })))).toEqual({ status: 409, error: 'The board already has a A Level qualification with the code 9700' });
      const comp = async (n: number, level: 'as' | 'a2') => (await apiResponse(coordinator.api.v1.catalogue.units.$post({
        json: { boardCode: 'cambridge', code: `9700/${n}`, shortCode: `Paper ${n}`, title: `Paper ${n}`, unitLevel: level, kind: 'component' },
      }))).id;
      const [p1, p2, p3, p4, p5] = [await comp(1, 'as'), await comp(2, 'as'), await comp(3, 'as'), await comp(4, 'a2'), await comp(5, 'a2')];
      await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({
        param: { id: asAward.id }, json: { units: [p1, p2, p3].map((unitId) => ({ unitId: unitId!, requirement: 'required' as const })) },
      }));
      await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({
        param: { id: alAward.id }, json: { units: [p1, p2, p3, p4, p5].map((unitId) => ({ unitId: unitId!, requirement: 'required' as const })) },
      }));
      // The A Level option that carries forward AS marks enters papers 4 and 5 only.
      const cf = await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].options.$post({
        param: { id: alAward.id }, json: { code: 'bz', label: 'A Level, AS carried forward: Papers 4 and 5', unitIds: [p4!, p5!], carryForward: true },
      }));
      expect(cf).toMatchObject({ code: 'BZ', carryForward: true });
      // An option enters only its own syllabus's components (on this award).
      const other = (await apiResponse(coordinator.api.v1.catalogue.units.$post({ json: { boardCode: 'cambridge', code: '0610/42', title: 'IGCSE Biology Paper 4', unitLevel: 'igcse', kind: 'component' } }))).id;
      expect(await refused(coordinator.api.v1.catalogue.qualifications[':id'].options.$post({
        param: { id: asAward.id }, json: { code: 'AX', label: 'wrong', unitIds: [p1!, other], carryForward: false },
      }))).toEqual({ status: 400, error: 'An option enters components of its own syllabus: add them to the qualification first' });
      // A component an option enters stays on its award.
      expect(await refused(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({
        param: { id: alAward.id }, json: { units: [p1, p2, p3].map((unitId) => ({ unitId: unitId!, requirement: 'required' as const })) },
      }))).toEqual({ status: 409, error: 'Option BZ enters a component you are removing — change the option first' });

      const cat = await fetchCatalogue();
      const al = cat.qualifications.find((x) => x.id === alAward.id)!;
      expect(al.options.map((o) => [o.code, o.carryForward, o.units.map((u) => u.code)])).toEqual([['BZ', true, ['9700/4', '9700/5']]]);
      expect(cat.units.find((u) => u.code === '9700/1')!.countsToward.map((a) => a.level).sort()).toEqual(['a_level', 'as_level']);
      await audited([cf.id], ['QUALIFICATION_OPTION_CREATED']);
    });
  });

  describe('the tier where the syllabus fixes it (review flag 6)', () => {
    it('an IGCSE component or award carries Core or Extended (Foundation or Higher); an AS or A2 unit has none; F5 and F4 read it', async () => {
      const award = await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
        json: { boardCode: 'cambridge', code: '0580', title: 'Mathematics (IGCSE)', level: 'igcse', suite: 'Cambridge IGCSE', subjectArea: 'Mathematics', entryMethod: 'syllabus_option' },
      }));
      const paper = async (n: number, tier: 'core' | 'extended') => (await apiResponse(coordinator.api.v1.catalogue.units.$post({
        json: { boardCode: 'cambridge', code: `0580/${n}`, shortCode: `Paper ${n}`, title: `Paper ${n}`, unitLevel: 'igcse', kind: 'component', tier },
      }))).id;
      const core = await paper(1, 'core');
      const extended = await paper(2, 'extended');
      await apiResponse(coordinator.api.v1.catalogue.qualifications[':id'].units.$put({
        param: { id: award.id }, json: { units: [core, extended].map((unitId) => ({ unitId: unitId!, requirement: 'optional' as const, choiceGroup: 'One tier' })) },
      }));
      const cat = await fetchCatalogue();
      expect(cat.qualifications.find((x) => x.id === award.id)!.units.map((u) => [u.code, u.tier])).toEqual([['0580/1', 'core'], ['0580/2', 'extended']]);
      // An award the syllabus fixes to one tier carries it.
      const higher = await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
        json: { boardCode: 'pearson_edexcel', code: '4MA1H', title: 'Mathematics A (Higher)', level: 'igcse', suite: 'International GCSE', subjectArea: 'Mathematics', entryMethod: 'qualification', tier: 'higher' },
      }));
      expect(higher.tier).toBe('higher');
      // AS and A2 have no tier.
      expect(await refused(coordinator.api.v1.catalogue.units.$post({
        json: { boardCode: 'pearson_edexcel', code: 'WTX01', title: 'No tier here', unitLevel: 'as', kind: 'unit', tier: 'extended' },
      }))).toEqual({ status: 400, error: 'Only IGCSE awards and components have a tier (Core or Extended, Foundation or Higher)' });
    });
  });

  describe('existing subjects (the migration) and the board a subject is entered with (decision 3)', () => {
    it('a new IGCSE subject is unmapped until the coordinator maps it; its board can change while nothing is entered', async () => {
      const s = await subject(adm, 'CAT-GEO', 'Geography (catalogue)', { course: 1000, registration: 500 });
      let row = (await fetchCatalogue()).registrable.find((r) => r.id === s)!;
      expect(row).toMatchObject({ mapped: false, council: 'cambridge', levelCode: { grade11: 'O.L.' } });
      const q = await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
        json: { boardCode: 'pearson_edexcel', code: '4GE1', title: 'Geography', level: 'igcse', suite: 'International GCSE', subjectArea: 'Geography', entryMethod: 'qualification' },
      }));
      // The coordinator's answer: Geography is entered with Pearson, as International GCSE 4GE1.
      const r = await apiResponse(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({
        param: { subjectId: s }, json: { boardCode: 'pearson_edexcel', qualificationId: q.id, unitIds: [], reason: 'coordinator: Geography is Pearson' },
      }));
      expect(r).toMatchObject({ boardCode: 'pearson_edexcel', qualificationId: q.id, registrationsMoved: 0 });
      row = (await fetchCatalogue()).registrable.find((x) => x.id === s)!;
      expect(row).toMatchObject({ mapped: true, council: 'pearson_edexcel', qualification: { code: '4GE1' } });
      expect((await one<{ council: string }>(`select council from subject where id = $1`, [s])).council).toBe('pearson_edexcel');
      // A qualification of another board than the one named is refused.
      expect(await refused(coordinator.api.v1.catalogue.registrable[':subjectId'].$put({
        param: { subjectId: s }, json: { boardCode: 'cambridge', qualificationId: q.id, unitIds: [] },
      }))).toEqual({ status: 400, error: '4GE1 is a Pearson Edexcel qualification, not Cambridge International' });
    });
  });
});
