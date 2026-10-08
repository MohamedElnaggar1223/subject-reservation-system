/**
 * The policy registry (RESERVATIONS_REWORK.md §3.7): every rule, deadline and percentage an
 * exception can lift, with what the screen and the API need to grant one — its label, the sentence
 * that says what the exception does, the value it takes and its bounds, the scopes it accepts and
 * what a null scope means, whether it is used up by one reservation (one-shot), who may grant it,
 * and the hook that applies it.
 *
 * An exception lifts one policy for one student or one family (a parent account: every linked
 * child), optionally narrowed to a scope. The API refuses a value, a scope or a grantor the
 * registry does not allow; the hooks read exceptions only through the registry
 * (apps/api/src/services/exception-registry.services.ts).
 */

import { z } from 'zod';
import { ROLES, type Role } from '../roles';
import type { LinePolicyKey } from '../registration/line.validations';

/** The dimensions an exception can be narrowed to (each a column of `exception`). */
export const POLICY_SCOPES = ['session', 'subject', 'offer', 'item', 'line', 'charge', 'boardSeries', 'academicYear'] as const;
export type PolicyScope = (typeof POLICY_SCOPES)[number];

export const POLICY_SCOPE_LABELS: Record<PolicyScope, string> = {
  session: 'Session',
  subject: 'Subject (any session)',
  offer: 'Subject in a session',
  item: 'Item (paper, unit or route)',
  line: 'One reservation line',
  charge: 'One charge',
  boardSeries: 'Board series',
  academicYear: 'Academic year',
};

export const POLICY_GROUPS = ['price', 'refund', 'deadline', 'gate', 'eligibility', 'plan'] as const;
export type PolicyGroup = (typeof POLICY_GROUPS)[number];

export const POLICY_GROUP_LABELS: Record<PolicyGroup, string> = {
  price: 'Prices',
  refund: 'Refunds',
  deadline: 'Deadlines',
  gate: 'Gates',
  eligibility: 'Eligibility',
  plan: 'Payment plans',
};

/** The value an exception of a policy carries: none, a percent, an amount (EGP), a date, a schedule. */
export type PolicyValueType = 'none' | 'percent' | 'amount' | 'date' | 'schedule';

export type PolicyDefinition = {
  group: PolicyGroup;
  label: string;
  /**
   * What an exception of the policy does, with {who} (the student or family), {value} and
   * {scope} (the narrowed scope in words, or what a null scope means).
   */
  sentence: string;
  valueType: PolicyValueType;
  min?: number;
  max?: number;
  /** The scopes it accepts (any subset may be set; each narrows it further). */
  scopes: readonly PolicyScope[];
  /** What no scope means; null when a scope is required. */
  nullScope: string | null;
  /** Used up by the one reservation it lets through (marked `used` in that transaction). */
  oneShot: boolean;
  grantRoles: readonly Role[];
  /** Where it is applied. */
  hook: string;
  /**
   * `live`: applied. `gated`: off until a setting turns it on (deadline.boardEntry: Q-20).
   * `pending`: registered but not yet read by its hook — refused at grant (see
   * docs/features/RESERVATIONS_MONEY.md "For the lead").
   */
  status: 'live' | 'gated' | 'pending';
};

const FINANCE = [ROLES.FINANCE_ADMIN, ROLES.ADMIN] as const;
const ACADEMIC = [ROLES.ADMIN, ROLES.COORDINATOR] as const;

const percentPolicy = (label: string, sentence: string): PolicyDefinition => ({
  group: 'price', label, sentence, valueType: 'percent', min: 0, max: 100,
  // A student's or a family's share (the design's pricing.* keys), narrowed to a session, a
  // subject, an offer or an item — never one line: priceLine reads them when a line is priced
  // and passes no line id, and a grant re-prices a line only for price.* (the review of step C, item 3).
  scopes: ['session', 'subject', 'offer', 'item'], nullScope: 'every session',
  // priceLine (step A, on main since b438976) reads them through the adapter in place of the
  // settings' percents and records the ones it applied in the line's pricing basis.
  oneShot: false, grantRoles: FINANCE, hook: 'priceLine', status: 'live',
});

export const POLICIES = {
  'pricing.selfStudyCoursePercent': percentPolicy('Self-study share of the course fee', '{who} pays {value}% of the course fee on a self-study line, {scope}'),
  'pricing.selfStudyBoardPercent': percentPolicy('Self-study share of the board fee', '{who} pays {value}% of the board fee on a self-study line, {scope}'),
  'pricing.retakeTaughtCoursePercent': percentPolicy('Retake in school: share of the course fee', '{who} pays {value}% of the course fee on a retake taught in school, {scope}'),
  'pricing.onePaperCoursePercent': percentPolicy('One-paper retake: share of its course fee', '{who} pays {value}% of a one-paper item\'s course fee, {scope}'),
  'price.discountPercent': {
    group: 'price', label: 'Discount (%)', sentence: '{who} pays {value}% less on {scope}',
    valueType: 'percent', min: 0, max: 100, scopes: ['session', 'subject', 'offer', 'item', 'line', 'charge'], nullScope: 'every line reserved from now on',
    oneShot: false, grantRoles: FINANCE, hook: 'priceLine; chargeRules (charge scope)', status: 'live',
  },
  'price.discountFixed': {
    group: 'price', label: 'Discount (EGP)', sentence: '{who} pays EGP {value} less on {scope}',
    valueType: 'amount', min: 0, max: 1_000_000, scopes: ['session', 'subject', 'offer', 'item', 'line', 'charge'], nullScope: 'every line reserved from now on',
    oneShot: false, grantRoles: FINANCE, hook: 'priceLine; chargeRules (charge scope)', status: 'live',
  },
  'price.custom': {
    group: 'price', label: 'Custom price', sentence: '{who} pays EGP {value} in all (board fee included) for {scope}',
    valueType: 'amount', min: 0, max: 1_000_000, scopes: ['session', 'subject', 'offer', 'item', 'line', 'charge'], nullScope: 'every line reserved from now on',
    oneShot: false, grantRoles: FINANCE, hook: 'priceLine; chargeRules (charge scope)', status: 'live',
  },
  'refund.percent': {
    group: 'refund', label: 'Refund percent', sentence: 'On a drop, {who} gets {value}% of the course fee back (the board fee by its own rule), {scope}',
    valueType: 'percent', min: 0, max: 100, scopes: ['session', 'subject', 'offer', 'line'], nullScope: 'every session',
    oneShot: false, grantRoles: FINANCE, hook: 'refundFor', status: 'live',
  },
  'refund.courseStart': {
    group: 'refund', label: 'Course start for refunds', sentence: 'For {who}, the refund weeks count from {value}, {scope}',
    valueType: 'date', scopes: ['offer', 'line'], nullScope: null,
    oneShot: false, grantRoles: FINANCE, hook: 'refundFor (the anchor)', status: 'live',
  },
  'deadline.window': {
    group: 'deadline', label: 'Session window extension', sentence: '{who} may still reserve and pay until {value}, {scope} (never past a board\'s entry deadline)',
    valueType: 'date', scopes: ['session'], nullScope: 'every session',
    oneShot: false, grantRoles: FINANCE, hook: 'sessionWindow', status: 'live',
  },
  'deadline.payment': {
    group: 'deadline', label: 'Payment due date', sentence: '{who} owes {scope} by {value} (never past its deadline)',
    valueType: 'date', scopes: ['session', 'line', 'charge'], nullScope: null,
    oneShot: false, grantRoles: FINANCE, hook: 'dueDateFor', status: 'live',
  },
  'deadline.boardEntry': {
    group: 'deadline', label: 'Late board entry', sentence: '{who} may still be entered in {scope} until {value}, the board\'s late fee charged',
    valueType: 'date', scopes: ['boardSeries'], nullScope: null,
    oneShot: false, grantRoles: [ROLES.ADMIN], hook: 'the entry deadline (off until the setting exceptions.boardEntryDeadline is on, Q-20)', status: 'gated',
  },
  'gate.schoolFee': {
    group: 'gate', label: 'School fee waiver', sentence: '{who} may reserve without paying the school fee, {scope}',
    valueType: 'none', scopes: ['academicYear'], nullScope: 'every academic year',
    oneShot: false, grantRoles: FINANCE, hook: 'schoolFeeGateReason', status: 'live',
  },
  'gate.selfStudyFirstEntry': {
    group: 'gate', label: 'Self-study on a first entry', sentence: '{who} may reserve {scope} as a first entry in self-study (once)',
    valueType: 'none', scopes: ['offer', 'item'], nullScope: 'any subject',
    oneShot: true, grantRoles: FINANCE, hook: 'assertLineRules', status: 'live',
  },
  'gate.availability': {
    group: 'gate', label: 'An item not open to them', sentence: '{who} may reserve {scope} although it is not open to them (once)',
    valueType: 'none', scopes: ['item'], nullScope: null,
    oneShot: true, grantRoles: ACADEMIC, hook: 'assertLineRules', status: 'live',
  },
  'gate.requiredItems': {
    group: 'gate', label: 'First entry without a required item', sentence: '{who} may make a first entry of {scope} without its required items (once)',
    valueType: 'none', scopes: ['offer'], nullScope: null,
    oneShot: true, grantRoles: ACADEMIC, hook: 'assertLineRules', status: 'live',
  },
  'gate.priorSeries': {
    group: 'gate', label: 'No prior sitting, or outside the carry-forward period', sentence: '{who} may reserve {scope} without a prior sitting in the carry-forward period (once)',
    valueType: 'none', scopes: ['item'], nullScope: null,
    oneShot: true, grantRoles: ACADEMIC, hook: 'assertLineRules', status: 'live',
  },
  'gate.exclusiveItems': {
    group: 'gate', label: 'Two items of one exclusive group', sentence: '{who} may reserve two items of one group of {scope} together (once)',
    valueType: 'none', scopes: ['offer'], nullScope: null,
    oneShot: true, grantRoles: ACADEMIC, hook: 'assertLineRules', status: 'live',
  },
  'gate.sameEntryOnce': {
    group: 'gate', label: 'A second line on one entry in a series', sentence: '{who} may hold a second live line on the same unit or award in {scope} (once)',
    valueType: 'none', scopes: ['boardSeries'], nullScope: null,
    oneShot: true, grantRoles: ACADEMIC, hook: 'assertLineRules', status: 'live',
  },
  'gate.grade10Core': {
    group: 'gate', label: 'Grade 10 without a core subject', sentence: '{who} may reserve {scope} in grade 10 without every core subject',
    valueType: 'none', scopes: ['session'], nullScope: null,
    oneShot: false, grantRoles: ACADEMIC, hook: 'assertLineRules', status: 'live',
  },
  'eligibility.grade10OtherSeries': {
    group: 'eligibility', label: 'Grade 10: sit a series other than June', sentence: '{who} may sit {scope} in grade 10',
    valueType: 'none', scopes: ['session'], nullScope: 'every series of their grade-10 year',
    oneShot: false, grantRoles: [ROLES.COORDINATOR, ROLES.ADMIN], hook: 'mayRegisterFor', status: 'live',
  },
  'plan.instalments': {
    group: 'plan', label: 'Instalment plan', sentence: '{who} pays {scope} in {value}, each into the held wallet; the line is paid from them at the last',
    valueType: 'schedule', scopes: ['line'], nullScope: null,
    oneShot: false, grantRoles: FINANCE, hook: 'instalment charges, the held wallet and the capture', status: 'live',
  },
} as const satisfies Record<string, PolicyDefinition>;

export type RegistryPolicyKey = keyof typeof POLICIES;
/** Every key an exception may be asked for: the registry's, and the line rules' keys of A's adapter. */
export type PolicyKey = RegistryPolicyKey | LinePolicyKey;
export const POLICY_KEYS = Object.keys(POLICIES) as RegistryPolicyKey[];
export const PolicyKeySchema = z.enum(POLICY_KEYS as [RegistryPolicyKey, ...RegistryPolicyKey[]]);

export function isRegistryPolicyKey(key: string): key is RegistryPolicyKey {
  return Object.prototype.hasOwnProperty.call(POLICIES, key);
}

export function policyOf(key: string): PolicyDefinition | null {
  return isRegistryPolicyKey(key) ? POLICIES[key] : null;
}

/** The roles that may grant (and revoke) at least one policy. */
export const POLICY_GRANT_ROLES = [ROLES.FINANCE_ADMIN, ROLES.COORDINATOR, ROLES.ADMIN] as const;

export function policiesGrantableBy(role: string | null | undefined): RegistryPolicyKey[] {
  return POLICY_KEYS.filter((k) => (POLICIES[k].grantRoles as readonly string[]).includes(role ?? ''));
}

/**
 * The eight legacy types (V3 §6.3) and the keys the migration gives them (§3.7). A legacy-shaped
 * grant ({ type, … }) is mapped the same way, so every reader goes through one registry.
 */
export const LEGACY_TYPE_TO_POLICY = {
  discount_percent: 'price.discountPercent',
  discount_fixed: 'price.discountFixed',
  custom_price: 'price.custom',
  fee_waiver: 'gate.schoolFee',
  deadline_extension: 'deadline.window',
  late_registration: 'deadline.window',
  custom_refund_percent: 'refund.percent',
  grade10_other_series: 'eligibility.grade10OtherSeries',
} as const satisfies Record<string, RegistryPolicyKey>;

/** One instalment of a plan: when it is due and how much (EGP). */
export const InstalmentRow = z.object({
  dueAt: z.coerce.date(),
  amount: z.number().positive('Each instalment is more than 0').max(1_000_000),
});
export type InstalmentRowType = z.infer<typeof InstalmentRow>;

/** The scope an exception is narrowed to; every field optional (none: the policy's null scope). */
export const PolicyScopeInput = z.object({
  sessionId: z.string().min(1).optional(),
  subjectId: z.string().min(1).optional(),
  offerId: z.string().min(1).optional(),
  offerItemId: z.string().min(1).optional(),
  registrationId: z.string().min(1).optional(),
  chargeId: z.string().min(1).optional(),
  boardSeriesId: z.string().min(1).optional(),
  academicYear: z.string().regex(/^\d{4}-\d{4}$/, 'Academic year must look like 2026-2027').optional(),
});
export type PolicyScopeInputType = z.infer<typeof PolicyScopeInput>;

/** Which scope field each scope dimension is. */
export const SCOPE_FIELD: Record<PolicyScope, keyof PolicyScopeInputType> = {
  session: 'sessionId',
  subject: 'subjectId',
  offer: 'offerId',
  item: 'offerItemId',
  line: 'registrationId',
  charge: 'chargeId',
  boardSeries: 'boardSeriesId',
  academicYear: 'academicYear',
};

/**
 * Grant an exception of a policy (the Exceptions screen, §4.7): the student or the family, the
 * policy, the scope it narrows to, the value its policy takes, an optional end and a reason.
 * The registry's bounds, scopes and grantors are checked by the API.
 */
export const CreatePolicyException = z
  .object({
    policyKey: PolicyKeySchema,
    studentId: z.string().min(1).optional(),
    familyId: z.string().min(1).optional(),
    scope: PolicyScopeInput.default({}),
    // A percent or an amount (number), a date (an ISO string), or a schedule of instalments.
    value: z.union([z.number().min(0).max(1_000_000), z.string().min(1), z.array(InstalmentRow).min(1).max(24)]).optional().nullable(),
    validUntil: z.coerce.date().optional().nullable(),
    reason: z.string().trim().min(3, 'A reason is required').max(500),
  })
  .refine((d) => !!d.studentId !== !!d.familyId, { message: 'Grant it to one student or to one family', path: ['studentId'] });
export type CreatePolicyExceptionType = z.infer<typeof CreatePolicyException>;

/** Revoking a plan may release every deposit and keep the line payable, instead of settling it as a drop (§3.6). */
export const RevokeException = z.object({
  reason: z.string().trim().max(500).optional(),
  releaseInFull: z.boolean().optional(),
});
export type RevokeExceptionType = z.infer<typeof RevokeException>;

/** The screen's revocation: the same, with the reason it is audited with (POST /exceptions/:id/revocation). */
export const RevokeWithReason = z.object({
  reason: z.string().trim().min(3, 'A reason is required').max(500),
});
export type RevokeWithReasonType = z.infer<typeof RevokeWithReason>;

/** Confirm a migrated exception listed under "Check these" (§3.7): from now on it applies with its scope. */
export const ConfirmCheckedException = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ConfirmCheckedExceptionType = z.infer<typeof ConfirmCheckedException>;

export const EXCEPTION_STATUSES = ['active', 'revoked', 'lapsed', 'used'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

/** The policy's sentence with its value and scope filled in. */
export function policySentence(key: RegistryPolicyKey, parts: { who: string; value?: string | null; scope?: string | null }): string {
  const p: PolicyDefinition = POLICIES[key];
  return p.sentence
    .replace('{who}', parts.who)
    .replace('{value}', parts.value ?? '…')
    .replace('{scope}', parts.scope ?? p.nullScope ?? '…');
}
