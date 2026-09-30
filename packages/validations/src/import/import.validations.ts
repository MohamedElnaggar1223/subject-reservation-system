/**
 * The day-one import (FEATURES_PLAN.md F7).
 *
 * A file is uploaded (purpose `import_file`), staged row by row, reviewed by
 * staff — fix, merge, skip, and the mapping settings the coordinator's
 * pending answers decide — and committed one family per transaction. Every
 * row keeps the line it came from. Running the same file again changes
 * nothing.
 *
 * Three sources:
 * - `school_sheet`: the school's registration workbook (a Google Form
 *   export, one row per student and subject; IMPORT_SPIKE.md).
 * - `scl_roster`: the grade 9→10 roster exported from SCL as CSV
 *   (DISCOVERY.md Q-09); the template is SCL_ROSTER_TEMPLATE below.
 * - `money_record`: the school's record of money before the system
 *   (DISCOVERY.md F-01, not yet seen), imported as history only — never as
 *   payments; the template is MONEY_RECORD_TEMPLATE below.
 *
 * Input types only (PATTERNS.md): the review's shapes come from the API.
 */

import { z } from 'zod';

export const IMPORT_KINDS = ['school_sheet', 'scl_roster', 'money_record'] as const;
export const ImportKindSchema = z.enum(IMPORT_KINDS);
export type ImportKind = z.infer<typeof ImportKindSchema>;

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  school_sheet: "The school's registration sheet",
  scl_roster: 'Grade 9 roster from SCL',
  money_record: 'Money record (history only)',
};

export const IMPORT_STATUSES = ['staged', 'committing', 'committed', 'partial', 'discarded'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

// ─── Mapping settings (the review step) ──────────────────────────────────────

/**
 * Self-study on a subject the school teaches (IMPORT_SPIKE.md IS-03, the
 * coordinator's pending answer, DISCOVERY.md A-02):
 * - `retake_only` (today's rule, V3 §6.9): outside school only on a retake —
 *   the student sat the subject before (their history) — at the outside rate;
 *   otherwise the row waits for staff.
 * - `in_school`: taken as taught in school.
 * - `enrol_only`: enrolled as self-study, no exam registration made.
 */
export const SELF_STUDY_RULES = ['retake_only', 'in_school', 'enrol_only'] as const;
export const SelfStudyRuleSchema = z.enum(SELF_STUDY_RULES);
export type SelfStudyRule = z.infer<typeof SelfStudyRuleSchema>;

export const SELF_STUDY_RULE_LABELS: Record<SelfStudyRule, string> = {
  retake_only: 'Only as a retake (today’s rule): a first attempt waits for staff',
  in_school: 'Taken as taught in school',
  enrol_only: 'Enrolled as self-study, no exam registration made',
};

/**
 * "Carry forward on June 2022" in the staff column (IS-02, Q-02, the
 * coordinator's pending answer):
 * - `note_only` (today's assumption: the spike imported such rows as new
 *   entries): kept as a note on the row's history, not read;
 * - `result`: an AS result carried forward into this entry, recorded with the
 *   series it came from;
 * - `payment`: a payment carried forward, recorded as money history.
 */
export const CARRY_FORWARD_READINGS = ['note_only', 'result', 'payment'] as const;
export const CarryForwardReadingSchema = z.enum(CARRY_FORWARD_READINGS);
export type CarryForwardReading = z.infer<typeof CarryForwardReadingSchema>;

export const CARRY_FORWARD_LABELS: Record<CarryForwardReading, string> = {
  note_only: 'Keep the note as written (today’s assumption)',
  result: 'An AS result carried into this entry',
  payment: 'A payment carried forward (money history)',
};

/** What a series and level in the file becomes. */
export const SERIES_MODES = ['history', 'window', 'skip'] as const;
export const SeriesModeSchema = z.enum(SERIES_MODES);
export type SeriesMode = z.infer<typeof SeriesModeSchema>;

export const SERIES_MODE_LABELS: Record<SeriesMode, string> = {
  history: 'History only (what the student sat before the system)',
  window: 'Registrations awaiting payment in an open window',
  skip: 'Leave out',
};

const KeySchema = z.string().min(1).max(300);

/** The review's settings, all optional: what is not set takes its default. */
export const ImportSettings = z.object({
  /** Per tab: take it or not, and the academic year (start) its classes and grades are in. */
  tabs: z.record(KeySchema, z.object({ include: z.boolean(), classYear: z.number().int().min(2000).max(2100) })).optional(),
  /** Per series and level ("november-2026-igcse"): history, a window, or leave out. */
  series: z.record(KeySchema, z.object({ mode: SeriesModeSchema, sessionId: z.string().min(1).nullable().optional() })).optional(),
  /** Per subject as the sheet writes it with its level code: the catalogue row, or none (history keeps the sheet's words). */
  subjects: z.record(KeySchema, z.object({ subjectId: z.string().min(1).nullable() })).optional(),
  /** Per teacher name in the sheet: an existing teacher record, or a new one, or none. */
  teachers: z.record(KeySchema, z.object({ teacherId: z.string().min(1).nullable(), create: z.boolean() })).optional(),
  /** Make the sections the sheet names when the year has none by that name. */
  createSections: z.boolean().optional(),
  /** Course enrolments for the class year (F0b's upsertEnrolments, source 'import'). */
  enrol: z.boolean().optional(),
  selfStudyOnTaught: SelfStudyRuleSchema.optional(),
  carryForward: CarryForwardReadingSchema.optional(),
  /** Students who have finished grade 12 by now: imported with their history, or left out. */
  graduates: z.enum(['import', 'skip']).optional(),
  /** SCL roster: the academic year (start) the file's grades are in. */
  gradeYear: z.number().int().min(2000).max(2100).optional(),
});
export type ImportSettingsType = z.infer<typeof ImportSettings>;

// ─── Problems (IMPORT_SPIKE.md's findings, flagged in the review) ────────────

export type ImportSeverity = 'error' | 'warning' | 'info';

export type ImportProblemDefinition = {
  severity: ImportSeverity;
  /** A short title for the problem list. */
  title: string;
  /** What it means and what staff can do. */
  meaning: string;
  /** The spike finding it answers (IS-nn), if any. */
  finding?: string;
};

/**
 * Every problem the review can flag. An error holds its family back from the
 * commit until it is fixed or the row skipped; a warning and a note do not.
 */
export const IMPORT_PROBLEMS = {
  // Units and level codes (IS-01)
  unit_row: { severity: 'info', finding: 'IS-01', title: 'A unit or paper set registered on its own', meaning: 'The sheet registers A-Level units and paper sets one by one (P1, M1, Biology Paper 3). The catalogue holds them as registrable rows entering units (F0b); nothing to do.' },
  level_code_combined_on_unit: { severity: 'info', finding: 'IS-01', title: '"A.S./A.2." on a single unit', meaning: 'A single AS unit cannot be two entries: the code marks something else. The system works the code out; what it means is the catalogue.levelCodeReading setting.' },
  level_code_differs: { severity: 'info', finding: 'IS-01', title: 'The school’s code differs from the one the system works out', meaning: 'Under the current reading of "A.S./A.2." the catalogue gives this row another code. The sheet’s code is kept on the history; the Level codes panel shows which reading agrees with most rows.' },
  level_code_al: { severity: 'info', finding: 'IS-01', title: '"A.L." (the June 2023 code)', meaning: 'Whether "A.L." is today’s "A.2." is a question for the coordinator; the row is mapped to the catalogue row staff choose.' },
  level_code_unknown: { severity: 'error', finding: 'IS-01', title: 'Level code not recognised', meaning: 'The Specification is not O.L., A.S., A.2., A.L. or a combined code. Fix it on the row.' },
  // Carry forward (IS-02)
  carry_forward: { severity: 'warning', finding: 'IS-02', title: '"Carry forward" noted by staff', meaning: 'A result or a payment carried from an earlier series (Q-02). How it is recorded is the Carry forward setting.' },
  // Self-study (IS-03)
  self_study_on_taught: { severity: 'error', finding: 'IS-03', title: 'Self-study on a subject the school teaches, first attempt', meaning: 'Today’s rule allows studying outside school only on a retake or a subject the school does not teach. Choose on the row: register in school, or enrol only; or change the Self-study setting when the coordinator answers.' },
  self_study_retake: { severity: 'info', finding: 'IS-03', title: 'Self-study on a retake', meaning: 'The student sat this subject before (their history): outside school at the outside rate, as today’s rule allows.' },
  self_study_not_taught: { severity: 'info', finding: 'IS-03', title: 'Self-study: the school does not teach it', meaning: 'Enrolled as self-study, registered outside school.' },
  // Series (IS-05, IS-14)
  series_other_than_tab: { severity: 'warning', finding: 'IS-05', title: 'A row for another series than its tab', meaning: 'The tab holds more than one exam series (January rows in a November tab): the row goes to its own series’ mapping.' },
  boards_in_series: { severity: 'info', finding: 'IS-14', title: 'Several boards in one series and level', meaning: 'The subjects of this series and level are entered with more than one board; each registration is routed to its board’s series (F0b).' },
  series_missing: { severity: 'error', title: 'No exam series', meaning: 'Neither the row nor its tab says which series it is for. Set it on the row.' },
  // Identity (IS-06)
  email_student_missing: { severity: 'error', finding: 'IS-06', title: 'Student email missing or not an email', meaning: 'Every account needs its own email. Type the student’s email on the row, or skip it.' },
  email_parent_missing: { severity: 'error', finding: 'IS-06', title: 'Parent email missing or not an email', meaning: 'Type the parent’s email on the row, or mark it "no parent on file".' },
  email_student_is_parent: { severity: 'error', finding: 'IS-06', title: 'The student and a parent give the same email', meaning: 'One account cannot be both. Give the student or the parent another email.' },
  student_email_shared: { severity: 'error', finding: 'IS-06', title: 'Two children under one email', meaning: 'The rows under this email name different children (or classes). Give one child’s rows their own email, or say they are one child.' },
  duplicate_student: { severity: 'warning', finding: 'IS-06', title: 'A duplicate family: the same child under two emails?', meaning: 'Two student emails carry the same name and share a parent. Merge them into one, or say they are different children.' },
  duplicate_parent: { severity: 'warning', finding: 'IS-06', title: 'The same parent under two emails?', meaning: 'Two parent emails share a phone number or a name and children. Merge them, or say they are different people.' },
  student_two_parents: { severity: 'info', finding: 'IS-06', title: 'A child with two parents', meaning: 'The child’s rows give two parent emails: both parents are linked to the child.' },
  name_variants: { severity: 'info', finding: 'IS-06', title: 'Several spellings of one name', meaning: 'The most used spelling is taken; choose another on the person.' },
  email_taken: { severity: 'error', finding: 'IS-06', title: 'The email belongs to another kind of account', meaning: 'An account with this email exists as staff, or as a parent where a student is expected (or the other way round). Use another email.' },
  // Money (IS-07, IS-08)
  fee_note: { severity: 'info', finding: 'IS-08', title: 'A fee note', meaning: 'Kept as money history (a percentage, never a payment).' },
  dropped: { severity: 'warning', finding: 'IS-08', title: 'Dropped (with a fee note)', meaning: 'A past drop: recorded as history with its percentage, never as a live registration.' },
  drop_intent: { severity: 'warning', finding: 'IS-08', title: '"I will drop the course"', meaning: 'The family meant to drop it: recorded as history ("meant to drop"), never as a live registration.' },
  // Phones and names (IS-09, IS-10)
  phone_restored: { severity: 'info', finding: 'IS-09', title: 'Phone stored as a number (leading 0 restored)', meaning: 'The sheet kept the phone as a number; the 0 is put back.' },
  phone_unusable: { severity: 'warning', finding: 'IS-09', title: 'Phone not usable', meaning: 'Not an Egyptian mobile after normalising: the account is made without it. Fix it on the row if you know it.' },
  name_cleaned: { severity: 'info', finding: 'IS-10', title: 'Name cleaned', meaning: 'Trailing, non-breaking or doubled spaces removed.' },
  // Shape (IS-11, IS-12, IS-13)
  column_drift: { severity: 'warning', finding: 'IS-11', title: 'A value in the wrong column', meaning: 'The confirmation, the fee note or the self-study answer sits in another one’s column; it is read by what it says. Check the row.' },
  signature: { severity: 'info', finding: 'IS-12', title: 'A staff name in the Signature column', meaning: 'Who signs and what it means is open (Q-03); not imported.' },
  duplicate_row: { severity: 'warning', finding: 'IS-13', title: 'The same subject twice for one student and series', meaning: 'The later row is left out; include it instead if it is the right one.' },
  // Classes and grades (IS-04)
  class_unreadable: { severity: 'error', finding: 'IS-04', title: 'Class & Grade not in the form "11A"', meaning: 'The grade and section cannot be read. Fix it on the row.' },
  grade_out_of_range: { severity: 'error', title: 'Grade outside 9–12', meaning: 'The school’s grades are 10–12 (9: starts grade 10 next year). Fix it on the row.' },
  // Mapping
  subject_unmapped: { severity: 'warning', title: 'Subject not in the catalogue', meaning: 'Map it to a catalogue row (or add it): until then history keeps the sheet’s words, and no enrolment or registration is made for it.' },
  teacher_missing: { severity: 'info', title: 'No teacher named', meaning: 'Enrolled with no teacher yet.' },
  teacher_on_self_study: { severity: 'info', title: 'A teacher named on a self-study row', meaning: 'Self-study is not taught: the teacher is not recorded on it.' },
  registration_refused: { severity: 'error', title: 'The registration would be refused', meaning: 'The window would refuse this registration (the reason is given). Import the series as history, skip the row, or fix what is refused.' },
  // Existing accounts
  cohort_differs: { severity: 'warning', title: 'The sheet’s grade differs from the student’s record', meaning: 'The system’s record is kept; correct it on the student’s page if the sheet is right.' },
  section_differs: { severity: 'warning', title: 'Already in another section this year', meaning: 'The student’s current section is kept; move them on the Sections screen if the sheet is right.' },
  graduated: { severity: 'info', title: 'Finished grade 12 by now', meaning: 'Imported with their history (or left out: the Graduates setting).' },
  left_school: { severity: 'warning', title: 'The student has left the school', meaning: 'Their record shows a withdrawal or transfer: history is imported, nothing live.' },
  already_imported: { severity: 'info', title: 'Already in the system', meaning: 'Everything this row would make exists already (the same file imported before): committing it changes nothing.' },
  // Money record (F-01)
  student_not_found: { severity: 'error', title: 'No student with this email or ID', meaning: 'Money history is recorded on students already in the system: import the families first, or fix the email or ID.' },
  amount_unreadable: { severity: 'error', title: 'Amount not a number', meaning: 'Fix the amount on the row.' },
  date_unreadable: { severity: 'warning', title: 'Date not readable', meaning: 'Recorded without a date. Fix it on the row if you know it.' },
} as const satisfies Record<string, ImportProblemDefinition>;

export type ImportProblemCode = keyof typeof IMPORT_PROBLEMS;
export const IMPORT_PROBLEM_CODES = Object.keys(IMPORT_PROBLEMS) as ImportProblemCode[];

/** File-wide notes, shown once (not per row). */
export const IMPORT_NOTES = {
  no_money: { finding: 'IS-07', title: 'No money in this file', meaning: 'No prices, payments or receipts: nothing is paid by this import. Registrations it makes wait for payment; money before the system comes from the money record, as history only.' },
  two_series_one_tab: { finding: 'IS-05', title: 'One tab holds several exam series', meaning: 'Each series and level is mapped on its own.' },
  roster_tab_ignored: { finding: 'A-04', title: 'Per-unit roster tabs are not imported', meaning: 'Tabs that list students by unit without emails (the hand-made rosters) are class lists, not registrations.' },
  year_not_set_up: { title: 'Academic year not set up', meaning: 'The year the classes are in is not on the Academic year screen: sections and course enrolments are not made for it (cohorts and history are).' },
  money_history_only: { finding: 'F-01', title: 'Money is imported as history only', meaning: 'Each row is kept as a record of what happened before the system. Nothing is paid, refunded or credited: no payment, receipt or balance changes.' },
} as const;
export type ImportNoteCode = keyof typeof IMPORT_NOTES;

// ─── Edits in the review ─────────────────────────────────────────────────────

const Text = (max = 200) => z.string().trim().max(max);

/** A staff fix on a row: the fields as the sheet would have had them right. */
export const ImportRowEdits = z.object({
  studentName: Text().optional(),
  studentEmail: Text(254).optional(),
  studentPhone: Text(40).optional(),
  parentName: Text().optional(),
  parentEmail: Text(254).optional(),
  parentPhone: Text(40).optional(),
  /** The row's family has no parent on file (no link is made). */
  noParent: z.boolean().optional(),
  classGrade: Text(20).optional(),
  levelCode: Text(20).optional(),
  subject: Text().optional(),
  teacher: Text().optional(),
  series: z.object({ type: z.enum(['january', 'june', 'october', 'november']), year: z.number().int().min(2000).max(2100) }).optional(),
  selfStudy: z.boolean().optional(),
  /** Self-study on a taught subject, first attempt: what this row does (IS-03). */
  selfStudyChoice: z.enum(['in_school', 'enrol_only']).nullable().optional(),
  // Money record rows
  studentRef: Text(254).optional(),
  amount: Text(40).optional(),
  date: Text(40).optional(),
});
export type ImportRowEditsType = z.infer<typeof ImportRowEdits>;

export const UpdateImportRows = z.object({
  rowIds: z.array(z.string().min(1)).min(1).max(2000),
  edits: ImportRowEdits.optional(),
  /** Undo a fix: the listed fields go back to what the sheet says. */
  clear: z.array(z.string().min(1).max(40)).max(40).optional(),
  decision: z.enum(['import', 'skip']).optional(),
  note: z.string().trim().max(300).optional(),
});
export type UpdateImportRowsType = z.infer<typeof UpdateImportRows>;

export const UpdateImportPerson = z.object({
  role: z.enum(['student', 'parent']),
  key: KeySchema,
  /** The name and phone to use (the rows keep what they say; an email is fixed on the rows). */
  edits: z.object({
    name: Text().optional(),
    phone: Text(40).optional(),
  }).optional(),
  /** Merge into another person of the same role (their key); null undoes it. */
  mergedInto: KeySchema.nullable().optional(),
  /** Staff say a "same child?" or "same parent?" pair are different people. */
  distinct: z.boolean().optional(),
  /** Staff say the rows under a shared email are one child after all. */
  oneChild: z.boolean().optional(),
  decision: z.enum(['import', 'skip']).optional(),
});
export type UpdateImportPersonType = z.infer<typeof UpdateImportPerson>;

export const CreateImport = z.object({
  fileId: z.string().min(1),
  kind: ImportKindSchema,
});
export type CreateImportType = z.infer<typeof CreateImport>;

/** Catalogue rows made from the sheet's subjects (the admin's: they carry prices). */
export const CreateImportSubjects = z.object({
  subjects: z.array(z.object({
    key: KeySchema,
    name: z.string().trim().min(1).max(200),
    code: z.string().trim().min(1).max(50),
    qualificationLevel: z.enum(['igcse', 'as_level', 'a_level']),
    council: z.enum(['pearson_edexcel', 'cambridge', 'oxford']),
    isOfferedAtSchool: z.boolean(),
    courseFee: z.number().min(0).max(1_000_000),
    registrationFee: z.number().min(0).max(1_000_000),
  })).min(1).max(200),
});
export type CreateImportSubjectsType = z.infer<typeof CreateImportSubjects>;

// ─── Templates (sources other than the school's own sheet) ───────────────────

/**
 * SCL's export at the grade 9→10 boundary (DISCOVERY.md Q-09: SCL claims CSV
 * export). One row per student; up to two parents. `grade` is the student's
 * grade in the academic year the file is from (the review's "grades are in"
 * setting): 9 means they start grade 10 the year after. `grade10_section` is
 * the section they join in grade 10, when the school has decided it.
 */
export const SCL_ROSTER_TEMPLATE = {
  fileName: 'scl-grade9-roster-template.csv',
  headers: [
    'student_name', 'student_email', 'student_phone', 'scl_student_id', 'grade', 'grade10_section',
    'parent_name', 'parent_email', 'parent_phone', 'second_parent_name', 'second_parent_email', 'second_parent_phone',
  ],
  required: ['student_name', 'student_email', 'grade', 'parent_email'],
  example: [
    ['Example Student', 'example.student@example.com', '01000000000', 'SCL-0001', '9', '10A', 'Example Parent', 'example.parent@example.com', '01100000000', '', '', ''],
  ],
} as const;

/**
 * The money record before the system (DISCOVERY.md F-01, not yet seen): what
 * the school's finance sheet will be mapped to. Imported as history only —
 * never as payments, receipts or balances.
 * - `student`: the student's email or school ID (the account must exist);
 * - `date`: YYYY-MM-DD or DD/MM/YYYY;
 * - `amount_egp`: a number (may be empty for a percentage-only note);
 * - `direction`: in (paid to the school) or out (paid back);
 * - `kind`: payment, refund, drop, other;
 * - `percent`: a percentage the school applied (a drop's refund, a rate).
 */
export const MONEY_RECORD_TEMPLATE = {
  fileName: 'money-record-template.csv',
  headers: ['student', 'date', 'amount_egp', 'direction', 'kind', 'percent', 'method', 'receipt_number', 'series', 'subject', 'note'],
  required: ['student', 'kind'],
  example: [
    ['example.student@example.com', '2026-10-05', '4500', 'in', 'payment', '', 'cash', 'R-0001', 'November 2026', 'Physics', ''],
    ['example.student@example.com', '2026-10-20', '', 'out', 'drop', '20', '', '', 'November 2026', 'Physics', 'Dropped 20% School fees'],
  ],
} as const;

export const MONEY_HISTORY_KINDS = ['payment', 'refund', 'drop', 'self_study_rate', 'external_rate', 'carried_forward', 'other'] as const;
export type MoneyHistoryKind = (typeof MONEY_HISTORY_KINDS)[number];

export const MONEY_HISTORY_KIND_LABELS: Record<MoneyHistoryKind, string> = {
  payment: 'Payment',
  refund: 'Refund',
  drop: 'Drop',
  self_study_rate: 'Self-study rate',
  external_rate: 'External rate',
  carried_forward: 'Carried forward',
  other: 'Other',
};

export const HISTORY_OUTCOMES = ['registered', 'dropped', 'drop_intended'] as const;
export type HistoryOutcome = (typeof HISTORY_OUTCOMES)[number];

export const HISTORY_OUTCOME_LABELS: Record<HistoryOutcome, string> = {
  registered: 'Registered',
  dropped: 'Dropped',
  drop_intended: 'Meant to drop',
};
