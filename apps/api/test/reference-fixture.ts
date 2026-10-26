/**
 * Reference data for the set-up scenarios (08y, 08za), in the shape of packages/db/reference/*.json
 * (COORDINATOR_REWORK.md §7.1; P0's schema), loaded the way the seed loads the files (`loadReference`,
 * @repo/db) — the one place these suites reach past the API: reference data has no route that writes
 * it (staff read it, never edit it).
 *
 * The boards' rules are the ones the database already holds (Cambridge: the syllabus's fee for one
 * paper, a one-paper retake asks its sitting, 13 months' carry forward; Pearson Edexcel: the paper's
 * own fee, not asked; OxfordAQA: the syllabus's, not asked), so loading this changes nothing for the
 * files that ran before. Its sittings are years no other file uses (the session year + 6 and + 7), so no
 * series another scenario made is touched; the scenarios' own sessions carry labels, their sittings get
 * their board dates from the admin, once, from the check list (C6's exception).
 *
 * The subjects follow the school's (the plan's §8): Cambridge Biology O.L. (0970) with its all-papers row
 * and its Paper 41/42 retake, Computer Science A.S./A.L. (9618) with A.S., A.2. and A.L. and an old code
 * (9608 SY) aliased to its A.S., Pearson Edexcel Mathematics O.L. (4MA1) whose all papers sum its two
 * papers, and the IAL Arabic A Level (YAA01) whose qualification sums its two units.
 */
import { academicYearStartOf, BoardsFileSchema, SubjectsFileSchema } from '@repo/validations';

const Y = academicYearStartOf() + 1;
const far = (n: number) => Y + n;

const sitting = (month: 1 | 6 | 10 | 11, year: number, levels: ('igcse' | 'as_al')[]) => ({
  month, year, levels, entryDeadline: month === 1 ? `${year - 1}-10-20` : `${year}-${month === 6 ? '02' : '06'}-20`, retakeDeadline: null,
  examsStart: `${year}-${String(month).padStart(2, '0')}-01`, source: 'test fixture (08y)', confirmed: false,
});

/** The fixture, parsed through P0's schemas as the seed parses the files (a malformed fixture fails here). */
export function referenceFixture() {
  const raw = rawFixture();
  return {
    boards: BoardsFileSchema.parse(raw.boards),
    subjects: {
      cambridge: SubjectsFileSchema.parse(raw.subjects.cambridge),
      pearson_edexcel: SubjectsFileSchema.parse(raw.subjects.pearson_edexcel),
      oxford: SubjectsFileSchema.parse(raw.subjects.oxford),
    },
  };
}

function rawFixture() {
  return {
    boards: [
      {
        code: 'cambridge' as const, name: 'Cambridge International', onePaperFee: 'syllabus' as const, onePaperAsksSitting: true, carryForwardMonths: 13,
        sittings: [sitting(6, far(6), ['igcse', 'as_al']), sitting(11, far(6), ['igcse', 'as_al'])],
        aliases: [
          { printed: '9608 SY', subject: '9618', row: 'as', note: 'the previous syllabus code' },
          { printed: '9618 SX', subject: '9618', row: 'as', toCheck: true, note: 'printed once on a list; may be a misprint of 9618 S1' },
        ],
      },
      {
        code: 'pearson_edexcel' as const, name: 'Pearson Edexcel', onePaperFee: 'paper' as const, onePaperAsksSitting: false, carryForwardMonths: null,
        sittings: [sitting(6, far(6), ['igcse', 'as_al']), sitting(10, far(6), ['as_al']), sitting(11, far(6), ['igcse']), sitting(1, far(7), ['as_al'])],
        aliases: [],
      },
      {
        code: 'oxford' as const, name: 'OxfordAQA', onePaperFee: 'syllabus' as const, onePaperAsksSitting: false, carryForwardMonths: null,
        sittings: [sitting(6, far(6), ['igcse', 'as_al'])],
        aliases: [],
      },
    ],
    subjects: {
      cambridge: [
        {
          code: '0970', name: 'Biology', group: 'O.L.' as const, level: 'igcse' as const, confirmed: true, winterSitting: 'november' as const,
          rows: [
            { key: 'all-papers', kind: 'all_papers' as const, codes: ['0970'], priceCodes: ['0970 CX'], label: { en: 'all papers', ar: 'كل الأوراق' } },
            { key: 'paper-41-42', kind: 'paper' as const, codes: ['0970/41', '0970/42'], priceCodes: [], short: 'Paper 41/42', label: { en: 'Paper 41/42 only', ar: 'الورقة 41/42 فقط' } },
          ],
        },
        {
          code: '9618', name: 'Computer Science', group: 'A.S./A.L.' as const, level: 'as_al' as const, confirmed: true, winterSitting: 'november' as const,
          rows: [
            { key: 'as', kind: 'as' as const, codes: ['9618'], priceCodes: ['9618 S1', '9618 S2'], label: { en: 'A.S.', ar: 'A.S.' } },
            { key: 'a2', kind: 'a2' as const, codes: ['9618'], priceCodes: ['9618 BY', '9618 CT'], label: { en: 'A.2. (carry forward)', ar: 'A.2. (نقل نتيجة)' } },
            { key: 'al', kind: 'al' as const, codes: ['9618'], priceCodes: ['9618 AY'], label: { en: 'A.L.', ar: 'A.L.' } },
          ],
        },
      ],
      pearson_edexcel: [
        {
          code: '4MA1', name: 'Mathematics', group: 'O.L.' as const, level: 'igcse' as const, confirmed: true, winterSitting: 'november' as const,
          rows: [
            { key: 'all-papers', kind: 'all_papers' as const, codes: ['4MA1'], priceCodes: [], label: { en: 'all papers', ar: 'كل الأوراق' }, sumOfUnits: ['paper-1h', 'paper-2h'] },
            { key: 'paper-1h', kind: 'paper' as const, codes: ['4MA1/1H'], priceCodes: ['4MA1H', '4WM1H'], short: 'Paper 1H', label: { en: 'Paper 1H only', ar: 'الورقة 1H فقط' } },
            { key: 'paper-2h', kind: 'paper' as const, codes: ['4MA1/2H'], priceCodes: ['4MA2H', '4WM2H'], short: 'Paper 2H', label: { en: 'Paper 2H only', ar: 'الورقة 2H فقط' } },
          ],
        },
        {
          code: 'YAA01', name: 'Arabic', group: 'A.S./A.L.' as const, level: 'as_al' as const, confirmed: true, winterSitting: 'january' as const,
          rows: [
            { key: 'yaa01', kind: 'qualification' as const, codes: ['YAA01'], priceCodes: [], short: 'International A Level', label: { en: 'International A Level (YAA01)', ar: 'International A Level (YAA01)' }, sumOfUnits: ['waa01', 'waa02'] },
            { key: 'waa01', kind: 'unit' as const, codes: ['WAA01'], priceCodes: ['WAA01'], short: 'Unit 1', label: { en: 'Unit 1 (WAA01)', ar: 'الوحدة 1 (WAA01)' } },
            { key: 'waa02', kind: 'unit' as const, codes: ['WAA02'], priceCodes: ['WAA02'], short: 'Unit 2', label: { en: 'Unit 2 (WAA02)', ar: 'الوحدة 2 (WAA02)' }, winterSitting: null },
          ],
        },
      ],
      oxford: [],
    },
  };
}
