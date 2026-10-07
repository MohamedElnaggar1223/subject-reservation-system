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
import { RefundPolicySchema, DEFAULT_REFUND_POLICIES } from '../session/session.validations';

export type SettingGroup = 'eligibility' | 'school_fee' | 'calendar' | 'catalogue' | 'pricing' | 'payment' | 'refund' | 'exceptions';

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
  input: 'boolean' | 'choice' | 'weekdays' | 'number' | 'refundPolicy';
  choices?: readonly { value: string; label: string }[];
  /** For a number: its bounds and unit as the screen shows them. */
  min?: number;
  max?: number;
  unit?: 'percent' | 'days';
};

const percentSetting = (label: string, description: string, def: number, source?: string) =>
  defineSetting({
    schema: z.number().min(0).max(100),
    default: def,
    group: 'pricing',
    label,
    description,
    editableBy: [ROLES.ADMIN, ROLES.FINANCE_ADMIN],
    ...(source ? { source } : {}),
    input: 'number',
    min: 0,
    max: 100,
    unit: 'percent',
  });

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
  // Reservations rework (RESERVATIONS_REWORK.md §3.4): the pricing policies priceLine reads.
  // Each can be lifted for one family by an exception (C's registry).
  'pricing.selfStudyCoursePercent': percentSetting(
    'Self-study: share of the course fee',
    'A self-study line pays this share of the school\'s course fee ("Self Study 50% School fees" on every form).',
    50, 'A-16',
  ),
  'pricing.selfStudyBoardPercent': percentSetting(
    'Self-study: share of the board fee',
    'A self-study line pays this share of the board\'s fee. The forms halve the "School fees" only, so the board fee is paid in full by default (A-16, question Q-12 to the admin).',
    100, 'Q-12',
  ),
  'pricing.retakeTaughtCoursePercent': percentSetting(
    'Retake in school: share of the course fee',
    'A retake taught again in school pays this share of the course fee ("Retake in School 100%").',
    100,
  ),
  'pricing.onePaperCoursePercent': percentSetting(
    'One-paper retake: share of its own course fee',
    'Scales the course fee the school sets for a one-paper retake item (Paper 4 only, 1H only…).',
    100, 'Q-13',
  ),
  'pricing.payOnProvisionalFee': defineSetting({
    schema: z.boolean(),
    default: false,
    group: 'pricing',
    label: 'Take payment while a board fee is provisional',
    description:
      'Off: a line whose board fee is still provisional (copied from an earlier series, or typed before the board publishes) can be reserved but not paid; the checkout and the desk say "board fee provisional, confirmed before payment". On: it can be paid at the provisional price, and a later difference is a price adjustment by finance.',
    editableBy: [ROLES.ADMIN, ROLES.FINANCE_ADMIN],
    input: 'boolean',
  }),
  'payment.graceDays': defineSetting({
    schema: z.number().int().min(0).max(60),
    default: 7,
    group: 'payment',
    label: 'Days to pay a line reserved late',
    description:
      'A line reserved after its session\'s payment due date is due this many days after it is reserved; a line whose board fee is provisional, this many days after the fee is confirmed. Never later than its series\' deadline.',
    editableBy: [ROLES.ADMIN, ROLES.FINANCE_ADMIN],
    input: 'number',
    min: 0,
    max: 60,
    unit: 'days',
  }),
  // Reservations rework, step C (RESERVATIONS_REWORK.md §3.1, §3.7).
  'payment.expireOverdueAfterDays': defineSetting({
    schema: z.number().int().min(0).max(365),
    default: 0,
    group: 'payment',
    label: 'Expire an unpaid line this many days after it was due',
    description:
      'A line still unpaid this many days after its due date expires (reason "overdue"), and an instalment plan on it is settled as a drop that day. 0: never — a due date then drives reminders and the "overdue" list only, and the line waits for its board\'s deadline or the session\'s close.',
    editableBy: [ROLES.ADMIN, ROLES.FINANCE_ADMIN],
    input: 'number',
    min: 0,
    max: 365,
    unit: 'days',
  }),
  'exceptions.boardEntryDeadline': defineSetting({
    schema: z.boolean(),
    default: false,
    group: 'exceptions',
    label: 'Allow late board entries by exception',
    description:
      'Off: the board\'s entry deadline is a hard stop (owner decision MO-10) and the "Late board entry" exception cannot be granted. On: the admin may grant one student a late entry in one series, with the board\'s late fee charged to the family (question Q-20 to the owner).',
    editableBy: [ROLES.ADMIN],
    source: 'Q-20',
    input: 'boolean',
  }),
  'refund.defaultPolicy.june': defineSetting({
    schema: RefundPolicySchema,
    default: DEFAULT_REFUND_POLICIES.june,
    group: 'refund',
    label: 'Refund policy of a new June session',
    description:
      'Copied into each new June session, in weeks from the first lesson: the share of the course fee a family gets back on a drop. The session can change it until the first family consents to it (SCHOOL_FORMS.md §2.1).',
    editableBy: [ROLES.ADMIN, ROLES.FINANCE_ADMIN],
    source: 'Q-11',
    input: 'refundPolicy',
  }),
  'refund.defaultPolicy.winter': defineSetting({
    schema: RefundPolicySchema,
    default: DEFAULT_REFUND_POLICIES.winter,
    group: 'refund',
    label: 'Refund policy of a new winter session',
    description:
      'Copied into each new November – January session, in weeks from the first lesson (the November forms: 100% within 2 weeks, 50% in weeks 3 to 6, nothing after).',
    editableBy: [ROLES.ADMIN, ROLES.FINANCE_ADMIN],
    source: 'Q-11',
    input: 'refundPolicy',
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
