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
import { DEFAULT_LEAVE_REASONS } from '../leave/leave.validations';

export type SettingGroup = 'eligibility' | 'school_fee' | 'calendar' | 'catalogue' | 'leave';

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
  /**
   * How the screen offers it. F2 added: 'time' (HH:MM), 'minutes' and 'count'
   * (a whole number), 'grades' (some of 10, 11, 12), 'roles' (some of the
   * choices), 'categories' (a list of named reasons).
   */
  input: 'boolean' | 'choice' | 'weekdays' | 'time' | 'minutes' | 'count' | 'grades' | 'roles' | 'categories';
  choices?: readonly { value: string; label: string }[];
  /** The value may be empty (null): "no cut-off", "no limit". */
  nullable?: boolean;
  /** Words for the empty value. */
  noneLabel?: string;
};

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
  // F2: campus leave. The coordinator and the admin set the school's leave
  // policy; each rule is shown to the approver as a warning on a request that
  // breaks it, and to families before they send one.
  'leave.sameDayCutoff': defineSetting({
    schema: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 10:00').nullable(),
    default: '10:00' as string | null,
    group: 'leave',
    label: 'Same-day requests by',
    description:
      'A request for leave today made after this time is flagged to the approver ("after the cut-off"). Families see the time before they send a request. None: no cut-off.',
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'time',
    nullable: true,
    noneLabel: 'No cut-off',
  }),
  'leave.noticeMinutes': defineSetting({
    schema: z.number().int().min(0).max(24 * 60),
    default: 60,
    group: 'leave',
    label: 'Notice required',
    description:
      'The least time, in minutes, between sending a request and the leave itself. A request with less notice is flagged to the approver ("short notice"). 0: no notice needed.',
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'minutes',
  }),
  'leave.aloneGrades': defineSetting({
    schema: z.array(z.number().int().min(10).max(12)).max(3)
      .refine((g) => new Set(g).size === g.length, 'Each grade once'),
    default: [] as number[],
    group: 'leave',
    label: 'Grades that may leave alone',
    description:
      "Students in these grades (their grade on the day of the leave) may leave without anyone collecting them, when their family's request says so. Everyone else is collected by a parent or an approved collector.",
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'grades',
  }),
  'leave.reasonCategories': defineSetting({
    schema: z.array(z.object({
      key: z.string().trim().regex(/^[a-z0-9_]{1,40}$/, 'A key is lower-case letters, digits and _'),
      label: z.string().trim().min(2).max(60),
    })).min(1, 'Keep at least one reason').max(20)
      .refine((cs) => new Set(cs.map((c) => c.key)).size === cs.length, 'Each reason once'),
    default: DEFAULT_LEAVE_REASONS.map((r) => ({ ...r })) as { key: string; label: string }[],
    group: 'leave',
    label: 'Reasons for leave',
    description:
      'The reasons a family or staff choose from; reports count leave by them. A reason taken off the list stays on the requests that used it.',
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'categories',
  }),
  'leave.limitPerTerm': defineSetting({
    schema: z.number().int().min(1).max(200).nullable(),
    default: null as number | null,
    group: 'leave',
    label: 'Family requests per student per term',
    description:
      "A family's requests for one student in a term beyond this number are flagged to the approver (the school's own leaves, such as a student sent home ill, do not count). None: no limit.",
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'count',
    nullable: true,
    noneLabel: 'No limit',
  }),
  'leave.familyRules': defineSetting({
    schema: z.enum(['warn', 'refuse']),
    default: 'warn' as const,
    group: 'leave',
    label: 'A family request that breaks a rule',
    description:
      'What happens to a request sent in the app after the cut-off, with too little notice, or beyond the limit per term: sent to the approver with a warning, or refused with the reason (the family can still phone the school). Staff requests are never refused for these.',
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'choice',
    choices: [
      { value: 'warn', label: 'Send it with a warning' },
      { value: 'refuse', label: 'Refuse it with the reason' },
    ],
  }),
  'leave.approverRoles': defineSetting({
    schema: z.array(z.enum([ROLES.COORDINATOR, ROLES.ADMIN])).min(1).max(2)
      .refine((r) => r.includes(ROLES.ADMIN), 'The admin always approves')
      .refine((r) => new Set(r).size === r.length, 'Each role once'),
    default: [ROLES.COORDINATOR, ROLES.ADMIN] as ('coordinator' | 'admin')[],
    group: 'leave',
    label: 'Who approves leave',
    description:
      'The roles that approve or refuse requests and authorised collectors, and are told when one arrives. The admin always can.',
    editableBy: [ROLES.ADMIN],
    input: 'roles',
    choices: [
      { value: ROLES.COORDINATOR, label: 'Coordinator' },
      { value: ROLES.ADMIN, label: 'Admin' },
    ],
  }),
  'leave.autoApprove': defineSetting({
    schema: z.boolean(),
    default: false,
    group: 'leave',
    label: 'Approve requests that break no rule',
    description:
      'On: a family request with no warning (inside the cut-off, the notice and the limit, no exam that day, no custody note, collected by a parent or an approved collector) is approved at once; the approver still sees it in the day. Off: every request waits for a person.',
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'boolean',
  }),
  'leave.noShowGraceMinutes': defineSetting({
    schema: z.number().int().min(0).max(240),
    default: 30,
    group: 'leave',
    label: 'No-show after',
    description:
      'Minutes after the leave time with nobody checked out at the gate before the leave is flagged as a no-show and the family and the approvers are told.',
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'minutes',
  }),
  'leave.lateReturnGraceMinutes': defineSetting({
    schema: z.number().int().min(0).max(240),
    default: 15,
    group: 'leave',
    label: 'Late back after',
    description:
      'Minutes after the expected return time before a student who is not back is flagged as late and the family and the approvers are told.',
    editableBy: [ROLES.ADMIN, ROLES.COORDINATOR],
    input: 'minutes',
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
