/**
 * School settings (FEATURES_PLAN.md F0a, "Settings store").
 *
 * Every setting the school can change without a code change is declared
 * here: its key, the schema its value must satisfy, its default, and the
 * roles that may change it. The API stores the values in one table
 * (`school_setting`), refuses a change from any other role, validates the
 * value against the key's schema, and writes the change and its audit row
 * (SETTING_CHANGED, before and after, with the reason) in one transaction.
 * A key never set reads as its default.
 *
 * Adding a setting (F2's leave policies, F3's thresholds, F4's centre
 * numbers): add an entry below with `defineSetting`, choose `editableBy`,
 * rebuild this package, and read it in the API with
 * `getSetting('your.key')`. Nothing else is needed: the Settings screen
 * lists every key the signed-in role may read.
 */

import { z } from 'zod';
import { ROLES, type Role } from '../roles';
import { LevelCodeReadingSchema, LEVEL_CODE_READINGS, LEVEL_CODE_READING_LABELS } from '../catalogue/level-code';

export type SettingGroup = 'eligibility' | 'school_fee' | 'calendar' | 'catalogue' | 'exams';

export type SettingDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  schema: S;
  default: z.infer<S>;
  group: SettingGroup;
  label: string;
  description: string;
  /** Roles that may change the value. */
  editableBy: readonly Role[];
  /** The register entry the setting answers, when it stands in for an owner decision. */
  source?: string;
  /** How the screen offers it ('centres': a centre number and entry route per exam board). */
  input: 'boolean' | 'choice' | 'weekdays' | 'number' | 'centres';
  choices?: readonly { value: string; label: string }[];
  /** For 'number': the bounds and unit the screen shows. */
  min?: number;
  max?: number;
  unit?: string;
};

/**
 * F4: the school's centre number with each board and how it enters (DISCOVERY.md
 * Q-05): directly, or through the British Council. Keyed by board code.
 */
export const ENTRY_ROUTES = ['direct', 'british_council'] as const;
export const ENTRY_ROUTE_LABELS: Record<(typeof ENTRY_ROUTES)[number], string> = {
  direct: 'Directly with the board',
  british_council: 'Through the British Council',
};
export const CentreNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{5}$/, 'A centre number is five letters or digits (Cambridge EG123, Pearson 91234)');
export const ExamCentresSchema = z.record(
  z.string().regex(/^[a-z_]{2,40}$/),
  z.object({ centreNumber: CentreNumberSchema.nullable(), route: z.enum(ENTRY_ROUTES) }),
);
export type ExamCentres = z.infer<typeof ExamCentresSchema>;

function defineSetting<S extends z.ZodTypeAny>(d: SettingDefinition<S>): SettingDefinition<S> {
  return d;
}

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const SETTINGS = {
  'eligibility.graduateRetakes': defineSetting({
    schema: z.boolean(),
    default: true,
    group: 'eligibility',
    label: 'Graduates may retake after grade 12',
    description:
      'A student who has finished grade 12 may still register for the October, November and January series of the academic year right after it (retakes to improve grades), never the June after it. Turning this off expires the waiting registrations graduates already made for those series.',
    editableBy: [ROLES.ADMIN],
    source: 'A-12',
    input: 'boolean',
  }),
  'schoolFee.graduatesExempt': defineSetting({
    schema: z.boolean(),
    default: true,
    group: 'school_fee',
    label: 'Graduates retaking owe no school fee',
    description:
      'A graduate registering under the rule above owes no school fee: the fee is for enrolled grades. Off: a graduate pays the uniform fee of that academic year, if one is set (per-grade fees have no row for graduates).',
    editableBy: [ROLES.ADMIN, ROLES.FINANCE_ADMIN],
    source: 'A-13',
    input: 'boolean',
  }),
  'schoolFee.newYearWithoutSchedule': defineSetting({
    schema: z.enum(['proceed', 'hold']),
    default: 'proceed' as const,
    group: 'school_fee',
    label: 'A series in next year before its school fee opens',
    description:
      "A November window can open in June, in the academic year before the series. When that year's school fee has not been opened yet: proceed without it (the fee gate is off without a schedule), or hold the registration until the fee opens.",
    editableBy: [ROLES.ADMIN, ROLES.FINANCE_ADMIN],
    source: 'A-14',
    input: 'choice',
    choices: [
      { value: 'proceed', label: 'Register without the fee' },
      { value: 'hold', label: 'Hold until the fee opens' },
    ],
  }),
  'calendar.schoolWeekdays': defineSetting({
    schema: z.array(z.number().int().min(0).max(6)).min(1).max(7)
      .refine((days) => new Set(days).size === days.length, 'Each weekday once'),
    default: [0, 1, 2, 3, 4] as number[],
    group: 'calendar',
    label: 'School days of the week',
    description:
      'The weekdays the school is open during term. The calendar marks holidays, early dismissals, exam-only days and extra school days on top of these.',
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'weekdays',
  }),
  // F0b: what the school's "A.S./A.2." marks on a single AS unit — the
  // coordinator's question (IMPORT_SPIKE.md §3 question 1). The code is
  // derived, never stored, so an answer changes this setting and every
  // screen reads it the new way.
  'catalogue.levelCodeReading': defineSetting({
    schema: LevelCodeReadingSchema,
    default: 'student_series' as const,
    group: 'catalogue',
    label: 'What "A.S./A.2." marks on a single AS unit',
    description:
      'The school writes "A.S./A.2." on some single AS units such as M1 and S1. An entry that mixes AS and A2 units (Biology Paper 3 & 4) is always "A.S./A.2."; for an AS unit alone, choose what the code means. Nothing stored changes: every screen derives the code from the unit\'s own level, the awards it counts toward and the student\'s year.',
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    source: 'IS-01',
    input: 'choice',
    choices: LEVEL_CODE_READINGS.map((r) => ({ value: r, label: LEVEL_CODE_READING_LABELS[r] })),
  }),
  // F4: the school as an exam centre.
  'exams.centres': defineSetting({
    schema: ExamCentresSchema,
    default: {} as ExamCentres,
    group: 'exams',
    label: 'Centre numbers and entry route',
    description:
      "The school's centre number with each exam board, printed on every entry list, statement of entry and candidate number, and whether the school enters directly or through the British Council. An entry list flags every row while its board's centre number is missing.",
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    source: 'Q-05',
    input: 'centres',
  }),
  'exams.carryForward': defineSetting({
    schema: z.enum(['suggest', 'manual']),
    default: 'suggest' as const,
    group: 'exams',
    label: 'Carry forward on A Level entries',
    description:
      "When a candidate's A Level entry follows their AS entry of the same syllabus within the board's carry-forward period (Cambridge: 13 months), suggest carrying the AS result forward and fill in the previous series, centre and candidate number for the coordinator to confirm. Manual: never suggested; staff fill the reference in themselves.",
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    source: 'Q-02',
    input: 'choice',
    choices: [
      { value: 'suggest', label: 'Suggest it, the coordinator confirms' },
      { value: 'manual', label: 'Staff enter it by hand' },
    ],
  }),
  'exams.selfStudyForecast': defineSetting({
    schema: z.enum(['coordinator', 'not_required']),
    default: 'coordinator' as const,
    group: 'exams',
    label: 'Forecast grades for self-study candidates',
    description:
      'A self-study candidate has no teacher to give the forecast grade the board asks for. The coordinator gives it, or it is not asked for (the entry list does not flag it).',
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    source: 'IS-03',
    input: 'choice',
    choices: [
      { value: 'coordinator', label: 'The coordinator gives it' },
      { value: 'not_required', label: 'Not asked for' },
    ],
  }),
  'exams.certificateRetentionMonths': defineSetting({
    schema: z.number().int().min(1).max(120),
    default: 12,
    group: 'exams',
    label: 'How long unclaimed certificates are kept',
    description:
      "Certificates not collected this many months after they arrived are listed as unclaimed, to return to the board or destroy with a reason. Cambridge asks centres to keep them at least 12 months.",
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'number',
    min: 1,
    max: 120,
    unit: 'months',
  }),
  'exams.candidatesPerInvigilator': defineSetting({
    schema: z.number().int().min(5).max(100),
    default: 30,
    group: 'exams',
    label: 'Candidates per invigilator',
    description:
      'An exam room needs one invigilator for every this many candidates (the boards\' guidance is one to 30 for written papers); a room with fewer is flagged on the seating screen.',
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'number',
    min: 5,
    max: 100,
    unit: 'candidates',
  }),
  'exams.reminderDaysBefore': defineSetting({
    schema: z.number().int().min(1).max(60),
    default: 14,
    group: 'exams',
    label: 'Remind staff of exam deadlines',
    description:
      "The coordinator and the admin are told this many days before each board date that needs the school (entry deadline, forecast grades, access arrangements, coursework marks), and again the day before, with what is still outstanding.",
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'number',
    min: 1,
    max: 60,
    unit: 'days before',
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

/** Roles that may read the settings screen. Each key still names who may change it. */
export const SETTINGS_READ_ROLES = [
  ROLES.ADMIN,
  ROLES.FINANCE_ADMIN,
  ROLES.FINANCE_OFFICER,
  ROLES.COORDINATOR,
] as const;

export const SettingKeyParam = z.object({ key: z.string().min(1).max(100) });

export const UpdateSetting = z.object({
  // Checked against the key's own schema by the API.
  value: z.unknown(),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
});
export type UpdateSettingType = z.infer<typeof UpdateSetting>;
