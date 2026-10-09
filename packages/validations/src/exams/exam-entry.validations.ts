/**
 * F4 — exam-entry management (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md).
 *
 * The school is the boards' exam centre. A confirmed registration is entered
 * with its board per unit or award; the candidate carries the identifiers the
 * boards ask for; a series' timetable becomes each candidate's own; results
 * come back per unit and award keeping every attempt; certificates are
 * received and collected once. Nothing here takes or moves family money.
 *
 * Only input schemas and the pure rules both the API and the screens apply
 * live here (PATTERNS.md: responses are typed by the RPC client).
 */

import { z } from 'zod';
import { DateOnlySchema, TimeOfDaySchema } from '../academic/structure.validations';
import { BoardCodeSchema, TierSchema, type Tier } from '../catalogue/catalogue.validations';

// ─── Words ───────────────────────────────────────────────────────────────────

export const ENTRY_KINDS = ['unit', 'award'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const ENTRY_STATUSES = ['draft', 'submitted', 'amended', 'withdrawn'] as const;
export const EntryStatusSchema = z.enum(ENTRY_STATUSES);
export type EntryStatus = z.infer<typeof EntryStatusSchema>;
export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  amended: 'Amended',
  withdrawn: 'Withdrawn',
};

export const GENDERS = ['female', 'male'] as const;
export const GenderSchema = z.enum(GENDERS);
export const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = { female: 'Female', male: 'Male' };

export const ID_DOCUMENT_TYPES = ['national_id', 'passport'] as const;
export const IdDocumentTypeSchema = z.enum(ID_DOCUMENT_TYPES);
export type IdDocumentType = z.infer<typeof IdDocumentTypeSchema>;
export const ID_DOCUMENT_TYPE_LABELS: Record<IdDocumentType, string> = { national_id: 'National ID', passport: 'Passport' };

/**
 * Access arrangements the boards approve (JCQ-style names both boards use).
 * Extra time lengthens a candidate's papers, so it moves their end time and
 * can make a clash.
 */
export const ACCESS_ARRANGEMENTS = [
  'extra_time_25', 'extra_time_50', 'rest_breaks', 'reader', 'scribe', 'word_processor',
  'separate_room', 'modified_papers', 'prompter', 'coloured_overlays',
] as const;
export const AccessArrangementSchema = z.enum(ACCESS_ARRANGEMENTS);
export type AccessArrangement = z.infer<typeof AccessArrangementSchema>;
export const ACCESS_ARRANGEMENT_LABELS: Record<AccessArrangement, string> = {
  extra_time_25: '25% extra time',
  extra_time_50: '50% extra time',
  rest_breaks: 'Supervised rest breaks',
  reader: 'Reader',
  scribe: 'Scribe',
  word_processor: 'Word processor',
  separate_room: 'Separate room',
  modified_papers: 'Modified papers',
  prompter: 'Prompter',
  coloured_overlays: 'Coloured overlays',
};

/** The share of extra time a candidate's arrangements give (the larger one). */
export function extraTimeShare(arrangements: readonly string[] | null | undefined): number {
  const a = arrangements ?? [];
  if (a.includes('extra_time_50')) return 0.5;
  if (a.includes('extra_time_25')) return 0.25;
  return 0;
}

export const EXAM_SESSIONS = ['am', 'pm', 'ev'] as const;
export const ExamSessionSchema = z.enum(EXAM_SESSIONS);
export type ExamSession = z.infer<typeof ExamSessionSchema>;
export const EXAM_SESSION_LABELS: Record<ExamSession, string> = { am: 'Morning', pm: 'Afternoon', ev: 'Evening' };

export const CARRY_FORWARD_STATES = ['none', 'suggested', 'confirmed'] as const;
export const CarryForwardStateSchema = z.enum(CARRY_FORWARD_STATES);

/** The board's late-fee tier on a date — shown for information; the school's hard stop is the entry deadline (MO-10). */
export const FEE_TIERS = ['standard', 'late', 'high_late', 'late_entries_closed'] as const;
export type FeeTier = (typeof FEE_TIERS)[number];
export const FEE_TIER_LABELS: Record<FeeTier, string> = {
  standard: 'Standard fee',
  late: 'Late fee',
  high_late: 'High late fee',
  late_entries_closed: 'Board no longer takes entries',
};

/** A board series' dates the fee tier reads (calendar dates, Cairo). */
export type FeeTierDates = {
  lateFeeFrom: string | null;
  highLateFeeFrom: string | null;
  lateEntriesClose: string | null;
};

/** Which fee the board would charge on `date` (YYYY-MM-DD, the school's date). */
export function feeTierOn(dates: FeeTierDates, date: string): FeeTier {
  if (dates.lateEntriesClose && date > dates.lateEntriesClose) return 'late_entries_closed';
  if (dates.highLateFeeFrom && date >= dates.highLateFeeFrom) return 'high_late';
  if (dates.lateFeeFrom && date >= dates.lateFeeFrom) return 'late';
  return 'standard';
}

// ─── Board rules ─────────────────────────────────────────────────────────────

export const AMENDMENT_AFTER_DEADLINE = ['allowed_with_fee', 'refused'] as const;
export const AMENDMENT_FEE_FROM = ['entry_deadline', 'late_fee_from', 'high_late_fee_from'] as const;
export const WITHDRAWAL_REFUND_UNTIL = ['entry_deadline', 'late_fee_from', 'high_late_fee_from', 'never'] as const;
export const RESULTS_KEYS = ['candidate_number', 'uci'] as const;

export const RULE_DATE_LABELS: Record<'entry_deadline' | 'late_fee_from' | 'high_late_fee_from' | 'never', string> = {
  entry_deadline: 'the entry deadline',
  late_fee_from: 'the late fee date',
  high_late_fee_from: 'the high late fee date',
  never: 'never',
};

export const UpdateBoardRule = z.object({
  forecastRequired: z.boolean().optional(),
  forecastLockedOnSubmit: z.boolean().optional(),
  optionCodeRequired: z.boolean().optional(),
  uciRequired: z.boolean().optional(),
  candidateNumberFixed: z.boolean().optional(),
  amendmentAfterDeadline: z.enum(AMENDMENT_AFTER_DEADLINE).optional(),
  amendmentFeeFrom: z.enum(AMENDMENT_FEE_FROM).optional(),
  amendmentFeeNote: z.string().trim().max(500).nullable().optional(),
  withdrawalRefundUntil: z.enum(WITHDRAWAL_REFUND_UNTIL).optional(),
  withdrawalFeeNote: z.string().trim().max(500).nullable().optional(),
  carryForwardMonths: z.number().int().min(1).max(60).nullable().optional(),
  resultsKey: z.enum(RESULTS_KEYS).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
});
export type UpdateBoardRuleType = z.infer<typeof UpdateBoardRule>;

// ─── Candidates ──────────────────────────────────────────────────────────────

/**
 * Pearson's Unique Candidate Identifier: 13 characters — the five-digit
 * centre number that first registered the candidate, a letter or digit ("B"
 * for international centres), the two-digit year, a four-digit number and a
 * check character (DISCOVERY_RESEARCH.md §2, from Pearson's page; the check
 * character's rule is not in the research, so it is not computed).
 */
export const UCI_PATTERN = /^[0-9]{5}[0-9A-Z][0-9]{6}[0-9A-Z]$/;
export const UciSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/\s+/g, ''))
  .refine((v) => UCI_PATTERN.test(v), 'A UCI is 13 characters: the 5-digit centre number, a letter or digit, the 2-digit year, a 4-digit number and a check character');

/** An Egyptian national ID is 14 digits; a passport number 5–20 letters and digits. */
export function idDocumentNumberProblem(type: IdDocumentType, value: string): string | null {
  if (type === 'national_id') return /^[23][0-9]{13}$/.test(value) ? null : 'An Egyptian national ID is 14 digits, starting with 2 or 3';
  return /^[A-Z0-9]{5,20}$/.test(value) ? null : 'A passport number is 5 to 20 letters and digits';
}

const nameText = z.string().trim().min(1).max(100);

export const UpdateCandidate = z.object({
  legalForenames: nameText.nullable().optional(),
  legalSurname: nameText.nullable().optional(),
  dateOfBirth: DateOnlySchema.nullable().optional(),
  gender: GenderSchema.nullable().optional(),
  uci: UciSchema.nullable().optional(),
  // A UCI is permanent: changing one already recorded needs a reason (audited).
  uciCorrectionReason: z.string().trim().min(3).max(500).optional(),
  accessArrangements: z.array(AccessArrangementSchema).max(ACCESS_ARRANGEMENTS.length).optional(),
  accessArrangementsRef: z.string().trim().max(100).nullable().optional(),
  accessArrangementsUntil: DateOnlySchema.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateCandidateType = z.infer<typeof UpdateCandidate>;

export const SetCandidateIdentity = z
  .object({
    documentType: IdDocumentTypeSchema,
    documentNumber: z.string().trim().transform((v) => v.toUpperCase().replace(/[\s-]+/g, '')),
  })
  .superRefine((v, ctx) => {
    const problem = idDocumentNumberProblem(v.documentType, v.documentNumber);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['documentNumber'] });
  });
export type SetCandidateIdentityType = z.infer<typeof SetCandidateIdentity>;

export const CandidateStudentParam = z.object({ studentId: z.string().min(1) });

export const CANDIDATE_MISSING = ['legal_name', 'date_of_birth', 'gender', 'uci', 'candidate_number', 'national_id'] as const;
export const ListCandidatesQuery = z.object({
  search: z.string().trim().max(100).optional(),
  // Only candidates entered (or registered) in this series, with their number in it.
  boardSeriesId: z.string().min(1).optional(),
  missing: z.enum(CANDIDATE_MISSING).optional(),
});
export type ListCandidatesQueryType = z.infer<typeof ListCandidatesQuery>;

export const CandidateNumberSchema = z.string().trim().regex(/^[0-9]{4}$/, 'A candidate number is four digits');

export const AssignCandidateNumbers = z.object({
  boardSeriesId: z.string().min(1),
  commit: z.boolean().default(false),
});
export type AssignCandidateNumbersType = z.infer<typeof AssignCandidateNumbers>;

export const SetCandidateNumber = z.object({
  studentId: z.string().min(1),
  boardSeriesId: z.string().min(1),
  number: CandidateNumberSchema,
  reason: z.string().trim().min(3).max(500).optional(),
});
export type SetCandidateNumberType = z.infer<typeof SetCandidateNumber>;

// ─── Entries ─────────────────────────────────────────────────────────────────

/**
 * Forecast grades as the boards take them: A*–G and U (IGCSE, A Level), a–e
 * for a Cambridge AS Level, 9–1 for the numbered IGCSEs.
 */
export const FORECAST_GRADE_PATTERN = /^(A\*|[A-G]|U|[a-e]|[1-9])$/;
/** A single lower-case a–e stays lower-case (a Cambridge AS grade); anything else is upper-cased. */
export function normalizeForecastGrade(v: string): string {
  const t = v.trim();
  return /^[a-e]$/.test(t) ? t : t.toUpperCase();
}
/**
 * Whether a forecast grade fits what is entered: an IGCSE takes A*–G or U, or
 * 9–1; an AS a–e (Cambridge writes AS grades in lower case) or A–E, or U; an A
 * Level (or an A2 unit) A*–E or U. Null when it fits.
 */
export function forecastGradeProblem(level: 'igcse' | 'as' | 'a_level' | null, grade: string): string | null {
  if (!level) return null;
  if (level === 'igcse') return /^(A\*|[A-G]|U|[1-9])$/.test(grade) ? null : 'An IGCSE forecast grade is A*–G or U, or 9–1';
  if (level === 'as') return /^([a-e]|[A-E]|U)$/.test(grade) ? null : 'An AS forecast grade is a–e (or A–E) or U';
  return /^(A\*|[A-E]|U)$/.test(grade) ? null : 'An A Level forecast grade is A*–E or U';
}

export const ForecastGradeSchema = z
  .string()
  .transform(normalizeForecastGrade)
  .refine((v) => FORECAST_GRADE_PATTERN.test(v), 'A forecast grade is A*–G or U, a–e for an AS Level, or 9–1');

export const ListEntriesQuery = z.object({
  boardSeriesId: z.string().min(1).optional(),
  studentId: z.string().min(1).optional(),
  status: EntryStatusSchema.optional(),
  includeWithdrawn: z.enum(['true', 'false']).optional(),
});
export type ListEntriesQueryType = z.infer<typeof ListEntriesQuery>;

export const DeriveEntries = z.object({
  boardSeriesId: z.string().min(1),
  studentId: z.string().min(1).optional(),
  commit: z.boolean().default(false),
});
export type DeriveEntriesType = z.infer<typeof DeriveEntries>;

/**
 * An entry the coordinator adds by hand: a cash-in (award) with no unit sat — with the paid cash-in
 * charge it comes from (the reservations rework, §3.6) when its line did not say which award — or a unit.
 */
export const CreateEntry = z
  .object({
    studentId: z.string().min(1),
    boardSeriesId: z.string().min(1),
    unitId: z.string().min(1).optional(),
    qualificationId: z.string().min(1).optional(),
    registrationId: z.string().min(1).optional(),
    chargeId: z.string().min(1).optional(),
    optionCode: z.string().trim().max(20).nullable().optional(),
    tier: TierSchema.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => !!v.unitId !== !!v.qualificationId, 'An entry is for one unit or one award');
export type CreateEntryType = z.infer<typeof CreateEntry>;

const carryForwardFields = {
  carryForward: CarryForwardStateSchema.optional(),
  cfFromMonth: z.enum(['january', 'june', 'october', 'november']).nullable().optional(),
  cfFromYear: z.number().int().min(2000).max(2100).nullable().optional(),
  cfCentreNumber: z.string().trim().max(10).nullable().optional(),
  cfCandidateNumber: z.string().trim().max(10).nullable().optional(),
  cfOption: z.string().trim().max(40).nullable().optional(),
};

/**
 * A change to an entry. On a draft it simply changes; on a submitted entry it
 * is an amendment (the board's rules say whether it is allowed and what it
 * costs after the deadline) and needs a reason.
 */
export const UpdateEntry = z.object({
  optionCode: z.string().trim().max(20).nullable().optional(),
  tier: TierSchema.nullable().optional(),
  isRetake: z.boolean().optional(),
  ...carryForwardFields,
  accessArrangements: z.array(AccessArrangementSchema).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type UpdateEntryType = z.infer<typeof UpdateEntry>;

export const SubmitEntries = z.object({
  entryIds: z.array(z.string().min(1)).min(1).max(2000),
  // When the entries went to the board (default now). A time after the entry deadline is refused (MO-10).
  submittedAt: z.coerce.date().optional(),
});
export type SubmitEntriesType = z.infer<typeof SubmitEntries>;

export const WithdrawEntry = z.object({
  reason: z.string().trim().min(3, 'Say why the entry is withdrawn').max(500),
});
export type WithdrawEntryType = z.infer<typeof WithdrawEntry>;

export const SetForecast = z.object({ grade: ForecastGradeSchema.nullable() });
export type SetForecastType = z.infer<typeof SetForecast>;

export const ForecastsQuery = z.object({ boardSeriesId: z.string().min(1).optional() });

export const SubmitForecasts = z.object({ boardSeriesId: z.string().min(1) });

export const BoardSeriesQuery = z.object({ boardSeriesId: z.string().min(1) });

// ─── Entry lists ─────────────────────────────────────────────────────────────

/**
 * What the check flags on an entry: everything a board would refuse or ask
 * for. Each has a sentence and the screen that fixes it.
 */
export const ENTRY_PROBLEMS = [
  'missing_centre_number',
  'missing_candidate_number',
  'missing_legal_name',
  'missing_date_of_birth',
  'missing_gender',
  'missing_uci',
  'missing_option_code',
  'missing_tier',
  'missing_forecast',
  'carry_forward_incomplete',
  'carry_forward_to_confirm',
  'registration_not_confirmed',
  'access_arrangements_unapproved',
  // The reservations rework (§3.5, §3.6): a declared earlier sitting the school has not verified —
  // entered as declared, or held, as `verification.unverifiedAtDeadline` says; a cash-in no longer paid.
  'prior_sitting_unverified',
  'prior_sitting_held',
  'cash_in_not_paid',
  // The review of 093dbd1, item 2: its line was answered after the entry was made.
  'retake_differs_from_line',
  'carry_forward_differs_from_line',
] as const;
export type EntryProblem = (typeof ENTRY_PROBLEMS)[number];
export const ENTRY_PROBLEM_LABELS: Record<EntryProblem, string> = {
  missing_centre_number: 'No centre number for this board (Settings)',
  missing_candidate_number: 'No candidate number in this series',
  missing_legal_name: 'No legal name as on ID',
  missing_date_of_birth: 'No date of birth',
  missing_gender: 'No gender recorded',
  missing_uci: 'No UCI (the board requires it)',
  missing_option_code: 'No option code (the board requires it)',
  missing_tier: 'No tier chosen',
  missing_forecast: 'No forecast grade (the board requires it)',
  carry_forward_incomplete: 'Carry forward without the previous centre and candidate number',
  carry_forward_to_confirm: 'Carry forward suggested — confirm it',
  registration_not_confirmed: 'Its registration is no longer confirmed — withdraw the entry',
  access_arrangements_unapproved: 'Access arrangements without a board approval, or expired',
  prior_sitting_unverified: 'Declared earlier sitting not verified yet — entered as declared (the To verify tab)',
  prior_sitting_held: 'Declared earlier sitting not verified — held, not sent until it is (the To verify tab)',
  cash_in_not_paid: 'Its cash-in is no longer paid — collect it again or withdraw the entry',
  retake_differs_from_line: "Its reservation's retake answer changed after the entry was made — amend the entry's retake",
  carry_forward_differs_from_line: "Its reservation's earlier sitting was answered after the entry was made — amend the carry forward (series, centre, candidate number, option)",
};

/**
 * The columns of each board's entry list, one to one with its portal's
 * fields. The boards' own files are not in hand (DISCOVERY.md F-07), so every
 * column is marked assumed until the coordinator checks it against the
 * board's template; the Entry lists screen says so (the CSV itself holds only the portal's
 * columns, so it can be uploaded as it is).
 */
export type EntryListColumn = { key: string; label: string; assumed: boolean };
const col = (key: string, label: string): EntryListColumn => ({ key, label, assumed: true });
export const ENTRY_LIST_COLUMNS: Record<string, EntryListColumn[]> = {
  cambridge: [
    col('centreNumber', 'Centre number'),
    col('candidateNumber', 'Candidate number'),
    col('candidateName', 'Candidate name (as on ID)'),
    col('dateOfBirth', 'Date of birth (DD/MM/YYYY)'),
    col('gender', 'Gender (M/F)'),
    col('uci', 'UCI (optional)'),
    col('syllabusCode', 'Syllabus code'),
    col('optionCode', 'Option code'),
    col('tier', 'Tier'),
    col('retake', 'Retake (Y/N)'),
    col('previousCentre', 'Previous centre number'),
    col('previousCandidate', 'Previous candidate number'),
    col('carryForwardFrom', 'Carried forward from (series)'),
    col('forecastGrade', 'Forecast grade'),
    col('accessArrangements', 'Access arrangements'),
  ],
  pearson_edexcel: [
    col('centreNumber', 'Centre number'),
    col('candidateNumber', 'Candidate number'),
    col('uci', 'UCI'),
    col('surname', 'Surname'),
    col('forenames', 'Forenames'),
    col('dateOfBirth', 'Date of birth (DD/MM/YYYY)'),
    col('gender', 'Sex (M/F)'),
    col('entryCode', 'Entry code (unit, cash-in or qualification)'),
    col('optionCode', 'Option'),
    col('tier', 'Tier (F/H)'),
    col('resit', 'Resit (Y/N)'),
    col('series', 'Series'),
    col('forecastGrade', 'Estimated grade'),
    col('accessArrangements', 'Access arrangements'),
  ],
};
/** Any board without its own layout (OxfordAQA, a board added later). */
export const GENERIC_ENTRY_LIST_COLUMNS: EntryListColumn[] = ENTRY_LIST_COLUMNS.pearson_edexcel!;

// ─── Timetable ───────────────────────────────────────────────────────────────

export const CreatePaper = z.object({
  boardSeriesId: z.string().min(1),
  code: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(200),
  unitId: z.string().min(1).nullable().optional(),
  qualificationId: z.string().min(1).nullable().optional(),
  tier: TierSchema.nullable().optional(),
  examDate: DateOnlySchema,
  session: ExamSessionSchema,
  startTime: TimeOfDaySchema,
  durationMinutes: z.number().int().min(5).max(480),
  notes: z.string().trim().max(500).nullable().optional(),
});
export type CreatePaperType = z.infer<typeof CreatePaper>;

export const UpdatePaper = CreatePaper.omit({ boardSeriesId: true }).partial().extend({
  reason: z.string().trim().min(3).max(500).optional(),
});
export type UpdatePaperType = z.infer<typeof UpdatePaper>;

/** A pasted timetable (CSV or tab-separated, first line the headers) and which column is which. */
export const TIMETABLE_FIELDS = ['code', 'title', 'date', 'session', 'startTime', 'duration'] as const;
export type TimetableField = (typeof TIMETABLE_FIELDS)[number];
export const TIMETABLE_FIELD_LABELS: Record<TimetableField, string> = {
  code: 'Paper code',
  title: 'Title',
  date: 'Date',
  session: 'Session (AM/PM)',
  startTime: 'Start time',
  duration: 'Duration',
};
export const ImportPapers = z.object({
  boardSeriesId: z.string().min(1),
  text: z.string().min(1).max(200_000),
  // Header text per field; missing fields are guessed from the headers.
  mapping: z.partialRecord(z.enum(TIMETABLE_FIELDS), z.string().max(100)).optional(),
  commit: z.boolean().default(false),
});
export type ImportPapersType = z.infer<typeof ImportPapers>;

export const TimetableQuery = z.object({
  boardSeriesId: z.string().min(1).optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
});

export const NoteClash = z.object({
  studentId: z.string().min(1),
  paperIds: z.tuple([z.string().min(1), z.string().min(1)]),
  resolution: z.string().trim().min(3).max(500),
});
export type NoteClashType = z.infer<typeof NoteClash>;

export const PublishTimetable = z.object({ boardSeriesId: z.string().min(1) });

export const StudentExamsQuery = z.object({ date: DateOnlySchema });
export const StudentSeriesQuery = z.object({ boardSeriesId: z.string().min(1).optional() });

// ─── Exam days: rooms, seats, invigilators, registers ────────────────────────

export const SittingKey = z.object({ examDate: DateOnlySchema, session: ExamSessionSchema });
export type SittingKeyType = z.infer<typeof SittingKey>;

export const SittingsQuery = z.object({
  boardSeriesId: z.string().min(1).optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
});

export const SetSittingRooms = SittingKey.extend({
  rooms: z.array(z.object({
    roomId: z.string().min(1),
    seatRows: z.number().int().min(1).max(26),
    seatColumns: z.number().int().min(1).max(40),
  })).max(20),
});
export type SetSittingRoomsType = z.infer<typeof SetSittingRooms>;

export const AutoSeat = SittingKey.extend({ commit: z.boolean().default(false) });
export type AutoSeatType = z.infer<typeof AutoSeat>;

export const SEAT_LABEL_PATTERN = /^[A-Z][0-9]{1,2}$/;
/** "A1" for the first row and column. */
export function seatLabel(row: number, column: number): string {
  return `${String.fromCharCode(65 + row)}${column + 1}`;
}

export const AssignSeat = SittingKey.extend({
  studentId: z.string().min(1),
  roomId: z.string().min(1),
  seatLabel: z.string().trim().toUpperCase().regex(SEAT_LABEL_PATTERN, 'A seat is a row letter and a number, such as B4'),
});
export type AssignSeatType = z.infer<typeof AssignSeat>;

export const SetInvigilators = SittingKey.extend({
  roomId: z.string().min(1),
  teacherIds: z.array(z.string().min(1)).max(10),
  leadTeacherId: z.string().min(1).nullable().optional(),
});
export type SetInvigilatorsType = z.infer<typeof SetInvigilators>;

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late'] as const;
export const AttendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);
export const ATTENDANCE_STATUS_LABELS: Record<(typeof ATTENDANCE_STATUSES)[number], string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
};

export const RegisterQuery = z.object({ paperId: z.string().min(1), roomId: z.string().min(1).optional() });

export const MarkRegister = z.object({
  paperId: z.string().min(1),
  marks: z.array(z.object({
    studentId: z.string().min(1),
    status: AttendanceStatusSchema,
    minutesLate: z.number().int().min(1).max(240).nullable().optional(),
    note: z.string().trim().max(300).nullable().optional(),
  })).min(1).max(500),
});
export type MarkRegisterType = z.infer<typeof MarkRegister>;

export const SPECIAL_CONSIDERATION_CATEGORIES = ['illness', 'bereavement', 'accident', 'disturbance', 'other'] as const;
export const SPECIAL_CONSIDERATION_CATEGORY_LABELS: Record<(typeof SPECIAL_CONSIDERATION_CATEGORIES)[number], string> = {
  illness: 'Illness',
  bereavement: 'Bereavement',
  accident: 'Accident or injury',
  disturbance: 'Disturbance in the room',
  other: 'Other',
};
export const SPECIAL_CONSIDERATION_STATUSES = ['draft', 'submitted', 'outcome_received'] as const;

export const CreateSpecialConsideration = z.object({
  studentId: z.string().min(1),
  boardSeriesId: z.string().min(1),
  paperId: z.string().min(1).nullable().optional(),
  category: z.enum(SPECIAL_CONSIDERATION_CATEGORIES),
  description: z.string().trim().min(3).max(2000),
  evidenceFileId: z.string().min(1).nullable().optional(),
});
export type CreateSpecialConsiderationType = z.infer<typeof CreateSpecialConsideration>;

export const UpdateSpecialConsideration = z.object({
  status: z.enum(SPECIAL_CONSIDERATION_STATUSES).optional(),
  boardReference: z.string().trim().max(100).nullable().optional(),
  outcome: z.string().trim().max(2000).nullable().optional(),
  evidenceFileId: z.string().min(1).nullable().optional(),
  description: z.string().trim().min(3).max(2000).optional(),
});
export type UpdateSpecialConsiderationType = z.infer<typeof UpdateSpecialConsideration>;

// ─── Results ─────────────────────────────────────────────────────────────────

/**
 * How a results file is read. `long`: one row per result (Pearson's results
 * file) — a candidate column, a code column, a grade column, maybe a mark.
 * `wide`: one row per candidate (Cambridge's broadsheet) — a candidate column
 * and one column per syllabus or component, whose header holds the code and
 * whose cells hold the grade. The formats are unconfirmed (DISCOVERY.md
 * F-07), so the staff choose the columns once and save the mapping.
 */
export const RESULT_SHAPES = ['long', 'wide'] as const;
export const ResultMapping = z.object({
  shape: z.enum(RESULT_SHAPES),
  // The header of the column naming the candidate, and what it holds.
  candidateColumn: z.string().min(1).max(100),
  candidateKey: z.enum(RESULTS_KEYS),
  // long: the code, grade and optional mark columns.
  codeColumn: z.string().max(100).optional(),
  gradeColumn: z.string().max(100).optional(),
  markColumn: z.string().max(100).optional(),
  // wide: the columns holding results (their header starts with the code).
  resultColumns: z.array(z.string().max(100)).max(200).optional(),
  // How far into the file the header row is (broadsheets have a title block).
  headerRow: z.number().int().min(1).max(50).default(1),
});
export type ResultMappingType = z.infer<typeof ResultMapping>;

export const ResultSource = z.union([
  z.object({ fileId: z.string().min(1) }),
  z.object({ text: z.string().min(1).max(2_000_000), name: z.string().trim().max(200).default('pasted results') }),
]);

export const ImportResults = z.object({
  boardSeriesId: z.string().min(1),
  source: ResultSource,
  mapping: ResultMapping.optional(),
  commit: z.boolean().default(false),
  saveMappingAs: z.string().trim().min(1).max(60).optional(),
});
export type ImportResultsType = z.infer<typeof ImportResults>;

export const ResultsQuery = z.object({
  boardSeriesId: z.string().min(1).optional(),
  studentId: z.string().min(1).optional(),
});

export const PublishResults = z.object({ boardSeriesId: z.string().min(1) });

/** The To verify tab's check of a session's declared sittings against the results on record. */
export const VerifyDeclaredFromResults = z.object({ sessionId: z.string().min(1) });

// ─── Certificates ────────────────────────────────────────────────────────────

export const CERTIFICATE_STATUSES = ['received', 'collected', 'returned_to_board', 'destroyed'] as const;
export const CertificateStatusSchema = z.enum(CERTIFICATE_STATUSES);
export const CERTIFICATE_STATUS_LABELS: Record<(typeof CERTIFICATE_STATUSES)[number], string> = {
  received: 'Waiting to be collected',
  collected: 'Collected',
  returned_to_board: 'Returned to the board',
  destroyed: 'Destroyed',
};

export const ListCertificatesQuery = z.object({
  boardSeriesId: z.string().min(1).optional(),
  status: CertificateStatusSchema.optional(),
  unclaimedOnly: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
});

export const ReceiveCertificates = z.object({
  boardSeriesId: z.string().min(1),
  receivedOn: DateOnlySchema,
  // Default: every candidate with a published result in the series.
  studentIds: z.array(z.string().min(1)).max(2000).optional(),
  commit: z.boolean().default(false),
});
export type ReceiveCertificatesType = z.infer<typeof ReceiveCertificates>;

export const COLLECTOR_RELATIONS = ['candidate', 'parent', 'other'] as const;
export const COLLECTOR_RELATION_LABELS: Record<(typeof COLLECTOR_RELATIONS)[number], string> = {
  candidate: 'The candidate',
  parent: 'A parent',
  other: 'Someone else, with the candidate’s written consent',
};
/**
 * Which document the desk saw — a choice, never its number: a free-text box
 * here would invite a national ID number into a list field.
 */
export const COLLECTOR_ID_DOCUMENTS = ['national_id_card', 'passport', 'school_id', 'birth_certificate', 'other'] as const;
export const COLLECTOR_ID_DOCUMENT_LABELS: Record<(typeof COLLECTOR_ID_DOCUMENTS)[number], string> = {
  national_id_card: 'National ID card',
  passport: 'Passport',
  school_id: 'School ID card',
  birth_certificate: 'Birth certificate',
  other: 'Another document',
};
export const CollectCertificate = z.object({
  collectorName: z.string().trim().min(2).max(120),
  collectorRelation: z.enum(COLLECTOR_RELATIONS),
  collectorIdChecked: z.enum(COLLECTOR_ID_DOCUMENTS).nullable().optional(),
  signatureFileId: z.string().min(1).nullable().optional(),
});

/** The scan of the signed slip, attached after the hand-over (record, print, sign, scan). */
export const AttachCertificateSlip = z.object({ signatureFileId: z.string().min(1) });
export type CollectCertificateType = z.infer<typeof CollectCertificate>;

export const DisposeCertificate = z.object({
  action: z.enum(['returned_to_board', 'destroyed']),
  reason: z.string().trim().min(3).max(500),
});
export type DisposeCertificateType = z.infer<typeof DisposeCertificate>;

// ─── Deadlines ───────────────────────────────────────────────────────────────

export const DeadlinesQuery = z.object({
  // How many days back a passed date stays on the board (default 30).
  pastDays: z.coerce.number().int().min(0).max(365).optional(),
});

export const BoardCodeOnly = z.object({ boardCode: BoardCodeSchema });

export type { Tier };
