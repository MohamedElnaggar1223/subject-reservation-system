// The June 2027 cycle as the school's 25 forms describe it (SCHOOL_FORMS.md §2.2, §2.3), with
// placeholder people only. One source for the walkthrough's drive and the demo script.
// Course fees and some board fees are placeholders: the school's course fees are in no artefact
// (SCHOOL_FORMS.md Q-14), and the boards' June 2027 fees were not published when the forms were made.

export const PASSWORD = 'TestPass1'; // every demo account but the admin (local demo only)
export const ADMIN = { email: 'admin@igcse.local', password: 'AdminPass1' };
export const SCHOOL_NAME = 'Demo International School';

export const STAFF = [
  { name: 'Coordinator One', email: 'coordinator@igcse.local', role: 'coordinator' },
  { name: 'Finance Officer One', email: 'finance@igcse.local', role: 'finance_officer' },
];
export const EXTERNAL = 'External Team';
export const teacherEmail = (n) => `teacher${n}@igcse.local`;
export const T = (n) => `Teacher ${n}`;
export const TEACHER_COUNT = 33;

// The Subjects page's "Import CSV" (name, code, council, level, course fee). The seed's Environmental
// Management (0680) is the form's own subject and is kept; the seed's other samples are not on the forms.
export const SUBJECTS_CSV = [
  // O.L. (17 forms)
  ['Arabic', '3180', 'Cambridge', 'IGCSE', 12000],
  ['Biology', '0970', 'Cambridge', 'IGCSE', 12000],
  ['Business Studies', '0986', 'Cambridge', 'IGCSE', 12000],
  ['Chemistry', '0971', 'Cambridge', 'IGCSE', 12000],
  ['Combined Science', '0653', 'Cambridge', 'IGCSE', 12000],
  ['Computer Science', '0984', 'Cambridge', 'IGCSE', 12000],
  ['English as a Second Language', 'ESL-OXFORD', 'Oxford', 'IGCSE', 12000],
  ['French', '7156', 'Cambridge', 'IGCSE', 12000],
  ['German', '7159', 'Cambridge', 'IGCSE', 12000],
  ['Global Perspectives', '0457', 'Cambridge', 'IGCSE', 12000],
  ['Global Citizenship', 'GLOBAL-CIT', 'Cambridge', 'IGCSE', 12000],
  ['Human Biology', '4HB1', 'Pearson Edexcel', 'IGCSE', 12000],
  ['ICT', '0983', 'Cambridge', 'IGCSE', 12000],
  ['Mathematics', '4MA1', 'Pearson Edexcel', 'IGCSE', 12000],
  ['Physics', '0972', 'Cambridge', 'IGCSE', 12000],
  ['Psychology', 'PSY-OXFORD', 'Oxford', 'IGCSE', 12000],
  // A.S./A.L. (8 forms)
  ['Arabic A.L.', 'ARABIC-AL', 'Pearson Edexcel', 'A Level', 12000],
  ['Biology A.S./A.L.', 'IAL-BIOLOGY', 'Pearson Edexcel', 'A Level', 4000],
  ['Chemistry A.S.', 'CHEM-AS', 'Cambridge', 'AS Level', 15000],
  ['Computer Science A.S./A.L.', 'CS-ASAL', 'Cambridge', 'AS Level', 15000],
  ['French A.S./A.L.', 'FRENCH-ASAL', 'Cambridge', 'AS Level', 15000],
  ['Mathematics A.S./A.L.', 'IAL-MATHS', 'Pearson Edexcel', 'A Level', 4000],
  ['Physics A.S./A.L.', 'PHYS-ASAL', 'Cambridge', 'AS Level', 15000],
  ['Psychology A.L.', 'PSY-AL', 'Cambridge', 'A Level', 15000],
];
export const CENTRES = { 'Cambridge International': 'EG999' }; // a placeholder centre number
export const SEED_KEPT = ['0680']; // Environmental Management, the seed's, on the forms
export const SEED_SAMPLES_RETIRED = ['0400', '0413', '0417', '0450', '0452', '0455', '0460', '0470', '0478', '0500', '0520', '0544', '0580', '0610', '0620', '0625'];

// Catalogue: the papers (components) the one-paper retakes need, on the Units tab.
export const UNITS = [
  { board: 'cambridge', code: '3180/01', short: 'Paper 1', title: 'Arabic Paper 1', level: 'igcse', kind: 'component' },
  { board: 'cambridge', code: '3180/02', short: 'Paper 2', title: 'Arabic Paper 2', level: 'igcse', kind: 'component' },
  { board: 'cambridge', code: '0970/41', short: 'Paper 41/42', title: 'Biology Theory (Extended)', level: 'igcse', kind: 'component' },
  { board: 'cambridge', code: '0971/41', short: 'Paper 41/42', title: 'Chemistry Theory (Extended)', level: 'igcse', kind: 'component' },
  { board: 'cambridge', code: '0653/41', short: 'Paper 41/42', title: 'Combined Science Theory (Extended)', level: 'igcse', kind: 'component' },
  { board: 'cambridge', code: '0972/41', short: 'Paper 41/42', title: 'Physics Theory (Extended)', level: 'igcse', kind: 'component' },
  { board: 'cambridge', code: '0983/01', short: 'Theory Paper', title: 'ICT Theory', level: 'igcse', kind: 'component' },
  { board: 'pearson_edexcel', code: '4MA1/1H', short: '1H', title: 'Mathematics Paper 1H (Higher)', level: 'igcse', kind: 'component' },
  { board: 'pearson_edexcel', code: '4MA1/2H', short: '2H', title: 'Mathematics Paper 2H (Higher)', level: 'igcse', kind: 'component' },
];

// Catalogue: the awards (Qualifications tab), each with the papers it requires and its option codes.
const CAM_IG = { board: 'cambridge', level: 'igcse', suite: 'Cambridge IGCSE', method: 'syllabus_option' };
const CAM_AS = { board: 'cambridge', level: 'as_level', suite: 'Cambridge International AS & A Level', method: 'syllabus_option' };
const CAM_AL = { board: 'cambridge', level: 'a_level', suite: 'Cambridge International AS & A Level', method: 'syllabus_option' };
export const AWARDS = [
  { ...CAM_IG, code: '3180', title: 'Arabic', area: 'Arabic', units: ['3180/01', '3180/02'], options: [{ code: 'A', label: 'All papers', cf: false }] },
  { ...CAM_IG, code: '0970', title: 'Biology', area: 'Biology', units: ['0970/41'], options: [{ code: 'CX', label: 'All papers', cf: false }] },
  { ...CAM_IG, code: '0986', title: 'Business Studies', area: 'Business Studies', options: [{ code: 'AX', label: 'All papers', cf: false }] },
  { ...CAM_IG, code: '0971', title: 'Chemistry', area: 'Chemistry', units: ['0971/41'], options: [{ code: 'CX', label: 'All papers', cf: false }] },
  { ...CAM_IG, code: '0653', title: 'Combined Science', area: 'Combined Science', units: ['0653/41'], options: [{ code: 'CX', label: 'All papers', cf: false }] },
  { ...CAM_IG, code: '0984', title: 'Computer Science', area: 'Computer Science', options: [{ code: 'AX', label: 'All papers', cf: false }] },
  { board: 'oxford', level: 'igcse', suite: 'OxfordAQA International GCSE', method: 'qualification', code: 'ESL-OXFORD', title: 'English as a Second Language', area: 'English as a Second Language' },
  { ...CAM_IG, code: '0680', title: 'Environmental Management', area: 'Environmental Management' },
  { ...CAM_IG, code: '7156', title: 'French', area: 'French', options: [{ code: 'X', label: 'All papers', cf: false }] },
  { ...CAM_IG, code: '7159', title: 'German', area: 'German', options: [{ code: 'Y', label: 'All papers', cf: false }] },
  { ...CAM_IG, code: '0457', title: 'Global Perspectives', area: 'Global Perspectives' },
  { ...CAM_IG, code: 'GLOBAL-CIT', title: 'Global Citizenship', area: 'Global Citizenship' },
  { board: 'pearson_edexcel', level: 'igcse', suite: 'International GCSE', method: 'qualification', code: '4HB1', title: 'Human Biology', area: 'Human Biology' },
  { ...CAM_IG, code: '0983', title: 'ICT', area: 'ICT', units: ['0983/01'], options: [{ code: 'DY', label: 'All papers', cf: false }] },
  { board: 'pearson_edexcel', level: 'igcse', suite: 'International GCSE', method: 'qualification', code: '4MA1', title: 'Mathematics A', area: 'Mathematics', units: ['4MA1/1H', '4MA1/2H'] },
  { ...CAM_IG, code: '0972', title: 'Physics', area: 'Physics', units: ['0972/41'], options: [{ code: 'CX', label: 'All papers', cf: false }] },
  { board: 'oxford', level: 'igcse', suite: 'OxfordAQA International GCSE', method: 'qualification', code: 'PSY-OXFORD', title: 'Psychology', area: 'Psychology' },
  // A.S./A.L.
  { board: 'pearson_edexcel', level: 'a_level', suite: 'International A Level', method: 'units_cash_in', code: 'YAA01', title: 'Arabic (International A Level)', area: 'Arabic' },
  { board: 'pearson_edexcel', level: 'a_level', suite: '', method: 'qualification', code: '9AA0', title: 'Arabic (GCE A Level)', area: 'Arabic' },
  { ...CAM_AS, code: '9701', title: 'Chemistry (AS Level)', area: 'Chemistry', options: [{ code: 'S1', label: 'A.S.', cf: false }] },
  { ...CAM_AL, code: '9701', title: 'Chemistry (A Level)', area: 'Chemistry', options: [{ code: 'BY', label: 'A.2. (Carry forward)', cf: true }, { code: 'AX', label: 'A.L.', cf: false }] },
  { ...CAM_AS, code: '9618', title: 'Computer Science (AS Level)', area: 'Computer Science', options: [{ code: 'SY', label: 'A.S.', cf: false }] },
  { ...CAM_AL, code: '9618', title: 'Computer Science (A Level)', area: 'Computer Science', options: [{ code: 'BY', label: 'A.2. (Carry forward)', cf: true }, { code: 'AY', label: 'A.L.', cf: false }] },
  { ...CAM_AS, code: '9898', title: 'French (AS Level)', area: 'French', options: [{ code: 'S1', label: 'A.S.', cf: false }] },
  { ...CAM_AL, code: '9898', title: 'French (A Level)', area: 'French', options: [{ code: 'AX', label: 'A.L.', cf: false }] },
  { ...CAM_AS, code: '9702', title: 'Physics (AS Level)', area: 'Physics', options: [{ code: 'S1', label: 'A.S.', cf: false }] },
  { ...CAM_AL, code: '9702', title: 'Physics (A Level)', area: 'Physics', options: [{ code: 'BX', label: 'A.2. (Carry forward)', cf: true }, { code: 'AX', label: 'A.L.', cf: false }] },
  { ...CAM_AL, code: '9990', title: 'Psychology (A Level)', area: 'Psychology' },
];
export const STARTER_SETS = ['Pearson IAL Mathematics', 'Pearson IAL Biology'];

// "Map it": what each subject enters (an award by code and level, or units by code).
export const MAPS = [
  ['3180', { award: '3180' }], ['0970', { award: '0970' }], ['0986', { award: '0986' }], ['0971', { award: '0971' }],
  ['0653', { award: '0653' }], ['0984', { award: '0984' }], ['ESL-OXFORD', { award: 'ESL-OXFORD' }], ['0680', { award: '0680' }],
  ['7156', { award: '7156' }], ['7159', { award: '7159' }], ['0457', { award: '0457' }], ['GLOBAL-CIT', { award: 'GLOBAL-CIT' }],
  ['4HB1', { award: '4HB1' }], ['0983', { award: '0983' }], ['4MA1', { award: '4MA1' }], ['0972', { award: '0972' }],
  ['PSY-OXFORD', { award: 'PSY-OXFORD' }],
  ['ARABIC-AL', { award: 'YAA01' }],
  ['IAL-BIOLOGY', { units: ['WBI11', 'WBI12', 'WBI13', 'WBI14', 'WBI15', 'WBI16'] }],
  ['CHEM-AS', { award: '9701' }], ['CS-ASAL', { award: '9618' }], ['FRENCH-ASAL', { award: '9898' }],
  ['IAL-MATHS', { units: ['WMA11', 'WMA12', 'WMA13', 'WMA14', 'WME01', 'WST01'] }],
  ['PHYS-ASAL', { award: '9702' }], ['PSY-AL', { award: '9990' }],
];

// The links sheet: each form's subject with its own options, in the forms' words.
// offered: open | retake_only | self_study_only; papers/routes/units: availability per item.
export const SHEET = [
  { code: '3180', form: 'Arabic O.L. (Cambridge)', teachers: [T(1), T(2), T(3)], offered: 'open', fee: 12000,
    papers: { 'Paper 1': ['retake_only', 4000], 'Paper 2': ['retake_only', 4000] },
    quote: ['Teacher: T1, T2, T3, "Self study (Only for 2nd entry ONLY)"', '"First Entry in School 100% fees (All Papers)" · "Retake in School 100% fees (All Papers)" · "Retake Self Study 50% fees (All Papers)" · "Retake in School 100% fees (One paper ONLY) From June 2026" · "Retake Self Study 50% fees (One paper ONLY) From June 2026"'] },
  { code: '0970', form: 'Biology O.L. (Cambridge)', teachers: [T(4), T(5), T(6)], offered: 'open', fee: 12000,
    papers: { 'Paper 41/42': ['self_study_only', 4000] },
    quote: ['Teacher: T1, T2, T3, "Self Study 50% (Second entry ONLY)"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None'] },
  { code: '0986', form: 'Business O.L. (Cambridge)', teachers: [T(7)], offered: 'open', fee: 12000,
    quote: ['One teacher, named in the description', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'] },
  { code: '0971', form: 'Chemistry O.L. (Cambridge)', teachers: [T(8), T(9), T(10)], offered: 'open', fee: 12000,
    papers: { 'Paper 41/42': ['self_study_only', 4000] },
    quote: ['Teacher: T1, T2, T3, "Self Study 50%"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None'] },
  { code: '0653', form: 'Combined Science O.L. (Cambridge)', teachers: [T(11)], offered: 'open', fee: 12000,
    papers: { 'Paper 41/42': ['self_study_only', 4000] },
    quote: ['One teacher (description)', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None'] },
  { code: '0984', form: 'Computer Science O.L. (Cambridge; an external team)', external: true, offered: 'open', fee: 12000,
    quote: ['One teacher (description): the external team', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Paper 41/42" with "From June 2025 / From November 2025" — last year\'s options left in the form'] },
  { code: 'ESL-OXFORD', form: 'English As a Second Language (Oxford)', teachers: [T(12), T(13)], offered: 'open', fee: 12000,
    quote: ['Teacher: T1 (Oxford), T2 (Oxford), "Self Study 50% (ONLY 2nd entry)"', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'] },
  { code: '0680', form: 'Environmental Management O.L. (Cambridge)', teachers: [T(14)], offered: 'open', fee: 12000,
    quote: ['One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'] },
  { code: '7156', form: 'French O.L. (Cambridge)', teachers: [T(15)], offered: 'open', fee: 12000,
    quote: ['One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'] },
  { code: '7159', form: 'German O.L. (Cambridge)', teachers: [T(16)], offered: 'open', fee: 12000,
    quote: ['One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'] },
  { code: '0457', form: 'Global Perspectives O.L. (Cambridge)', teachers: [T(17)], online: [T(17)], offered: 'open', fee: 12000,
    quote: ['One teacher (description), "(ONLINE ONLY)"', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'] },
  { code: 'GLOBAL-CIT', form: 'Global Citizenship O.L. (Cambridge)', teachers: [T(18)], offered: 'open', fee: 12000,
    quote: ['One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'] },
  { code: '4HB1', form: 'Human Biology O.L. (Edexcel GCSE)', teachers: [T(19)], offered: 'open', fee: 12000,
    quote: ['One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'] },
  { code: '0983', form: 'ICT O.L. (Cambridge; an external team)', external: true, offered: 'open', fee: 12000,
    papers: { 'Theory Paper': ['self_study_only', 4000] },
    quote: ['One teacher (description): the external team', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Theory Paper ONLY)": From June 2026 / From November 2026 / None'] },
  { code: '4MA1', form: 'Mathematics O.L. (Edexcel GCSE)', teachers: [T(20), T(21), T(22)], offered: 'open', fee: 12000,
    papers: { '1H': ['self_study_only', 4000], '2H': ['self_study_only', 4000] },
    quote: ['Teacher: T1, T2, T3, "Self Study 50% (ONLY 2nd entry)"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (One Paper ONLY)": 1H / 2H / None'] },
  { code: '0972', form: 'Physics O.L. (Cambridge)', teachers: [T(23)], offered: 'open', fee: 12000,
    papers: { 'Paper 41/42': ['self_study_only', 4000] },
    quote: ['Teacher: T1, "Self Study 50%"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None'] },
  { code: 'PSY-OXFORD', form: 'Psychology O.L. (Oxford)', teachers: [T(24)], offered: 'open', fee: 12000,
    quote: ['One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'] },
  // A.S./A.L.
  { code: 'ARABIC-AL', form: 'Arabic A.L. (Edexcel)', teachers: [T(25)], offered: 'open', fee: 12000,
    second: { award: '9AA0', teacher: T(26) },
    quote: ['Teacher: T1 "(Edexcel YAA01)", T2 "(Edexcel 9AA01)", "Self Study 50% (second entry only)"', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'] },
  { code: 'IAL-BIOLOGY', form: 'Biology A.S./A.L. (Edexcel IAL)', teachers: [T(27)], offered: 'open', fee: 4000,
    units: { WBI11: ['self_study_only'], WBI12: ['self_study_only'], WBI13: ['self_study_only'], WBI14: ['self_study_only'], WBI15: ['open', [T(27)]], WBI16: ['open', [T(27)]] },
    quote: ['One teacher (description)', 'A.2. Paper 5 (WBI15/01) First entry 100% June 2027 · A.2. Paper 6 (WBI16/01) First entry 100% June 2027', 'A.S. Paper 1 (WBI11/01) Self Study 50% 2nd entry ONLY · A.S. Paper 2 (WBI12/01) · A.S. Paper 3 (WBI13/01) · A.2. Paper 4 (WBI14/01) · A.2. Paper 5 (WBI15/01) · A.2. Paper 6 (WBI16/01)'] },
  { code: 'CHEM-AS', form: 'Chemistry A.S. (Cambridge)', teachers: [T(28)], offered: 'open', fee: 15000,
    routes: { 'A.S.': 'open', 'A.2.': 'closed', 'A.L.': 'open' },
    quote: ['One teacher (description)', '"Kindly specify the Components": Chemistry A.S. / Chemistry A.L.', '"Self Study (ONLY 2nd entry)" Yes / No'] },
  { code: 'CS-ASAL', form: 'Computer Science A.S./A.L. (Cambridge)', external: true, offered: 'open', fee: 15000,
    routes: { 'A.S.': 'open', 'A.2.': 'open', 'A.L.': 'open' },
    quote: ['No teacher listed (the November links sheet says "External")', 'Components: Computer Science A.S. · A.2. (Carry forward on June) · A.2. (Carry forward on November) · A.L.', '"Self Study (ONLY 2nd entry)" Yes / No'] },
  { code: 'FRENCH-ASAL', form: 'French A.S./A.L. (Cambridge)', teachers: [T(29)], offered: 'open', fee: 15000,
    routes: { 'A.S.': 'open', 'A.L.': 'open' },
    quote: ['One teacher (description)', 'Components: French A.S. / French A.L.', '"Self Study (ONLY 2nd entry)" Yes / No'] },
  { code: 'IAL-MATHS', form: 'Mathematics A.S./A.L. (Edexcel IAL)', teachers: [T(30), T(31)], offered: 'open', fee: 4000,
    units: { WMA11: ['open', [T(30)], [T(30)]], WMA12: ['open', [T(30)], [T(30)]], WMA13: ['open', [T(30)]], WMA14: ['open', [T(30)]], WME01: ['open', [T(31), T(30)]], WST01: ['open', [T(31), T(30)]] },
    quote: ['One optional question per unit: P1: T1 (ONLINE ONLY) / Self Study 50% School fees (2nd entry ONLY) · P2: the same · P3: T1 / SS · P4: T1 / SS · M1: T2 / T1 / SS · S1: T2 / T1 / SS', '"Self Study (ONLY 2nd entry)" Yes / No'] },
  { code: 'PHYS-ASAL', form: 'Physics A.S./A.L. (Cambridge)', teachers: [T(32)], offered: 'open', fee: 15000,
    routes: { 'A.S.': 'open', 'A.2.': 'self_study_only', 'A.L.': 'closed' },
    quote: ['T1 inside the AS option', 'Components: Physics A.S. in School 100% fees (T1) · Physics A.2. (Self Study 50% fees in June 2027) · A.2. Self Study 50% (Carry forward on June 2026) · A.2. Self Study 50% (Carry forward on November 2025)', '"Self Study (ONLY 2nd entry)" Yes / No'] },
  { code: 'PSY-AL', form: 'Psychology A.L. (Cambridge)', teachers: [T(33)], offered: 'open', fee: 15000,
    quote: ['One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'] },
];

// The boards' fee lists (SCHOOL_FORMS.md §3), pasted per sitting on the Fees tab. Rows the lists do not
// have are typed in the grid, marked "not published yet" (provisional).
export const FEES_PASTE = {
  cambridge: [
    // The list's rows, syllabus and option first, as the board writes them.
    '3180 A 9,850', '0970 CX 10,850', '0986 AX 9,850', '0971 CX 10,850', '0653 CX 10,850', '0984 AX 9,850',
    '7156 X 12,550', '7159 Y 12,550', '0983 DY 12,950', '0972 CX 10,850',
    // A one-paper retake reads the syllabus's own fee (Q-13): the syllabus once more, on its own.
    '3180 9,850', '0970 10,850', '0971 10,850', '0653 10,850', '0983 12,950', '0972 10,850',
    '9701 S1 14,100', '9701 BY 11,400', '9701 AX 18,600', '9702 S1 14,100', '9702 BX 11,400', '9702 AX 18,600',
    '9618 SY 11,400', '9618 BY 12,450', '9618 AY 16,950',
  ],
  pearson_edexcel: [
    'WMA11 4,800', 'WMA12 4,800', 'WMA13 4,800', 'WMA14 4,800', 'WME01 4,450', 'WST01 4,450',
    'WBI15 4,450', 'WBI16 4,450', '4MA1 9,200', 'YAA01 18,300',
  ],
};
// Typed by hand, provisional (no list has them): code → amount.
export const FEES_TYPED = {
  cambridge: { '0680': 9850, '0457': 9850, 'GLOBAL-CIT': 9850, '9898 S1': 14100, '9898 AX': 18600, '9990': 18600 },
  pearson_edexcel: { WBI11: 4790, WBI12: 4790, WBI13: 4550, WBI14: 4550, '4HB1': 9840, '9AA0': 18300 },
  oxford: { 'ESL-OXFORD': 9500, 'PSY-OXFORD': 9500 },
};

// The boards' dates for June 2027 (the demo's placeholders: type the board's published key dates).
export const DEADLINES = {
  'Cambridge International': { entry: '2027-02-21', retake: '2027-03-21', examsStart: '2027-04-26', examsEnd: '2027-06-15' },
  'Pearson Edexcel': { entry: '2027-02-13', retake: null, examsStart: '2027-05-10', examsEnd: '2027-06-18' },
  OxfordAQA: { entry: '2027-02-21', retake: null, examsStart: '2027-05-10', examsEnd: '2027-06-18' },
};

// The session: June 2027 (the forms were made in September 2026; reservations open now).
export const SESSION = { type: 'june', year: 2027, from: '2026-11-01T08:00', to: '2027-02-15T23:00', courseStarts: '2026-11-01', due: '2026-11-30T23:00' };

// The families (placeholders).
export const FAMILIES = {
  desk: { parent: { name: 'Parent Two', email: 'parent2@igcse.local' }, student: { name: 'Student Two', email: 'student2@igcse.local', grade: 11 } },
  app: { parent: { name: 'Parent One', email: 'parent1@igcse.local' }, student: { name: 'Student One', email: 'student1@igcse.local', grade: 11 } },
};
