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

export type SettingGroup = 'eligibility' | 'school_fee' | 'calendar' | 'catalogue';

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
  /** How the screen offers it. */
  input: 'boolean' | 'choice' | 'weekdays';
  choices?: readonly { value: string; label: string }[];
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
