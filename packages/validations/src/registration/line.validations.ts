/**
 * Reservation lines (RESERVATIONS_REWORK.md §3.5; docs/features/RESERVATIONS.md §1.6, §2).
 *
 * A line is what the board sees: one item of an offer, a first entry or a retake, taught in
 * school or self-study, priced on its own and entered in its item's series. Step A (this
 * branch) creates the columns, `priceLine`, the rules and the deadlines; step B builds the
 * reservation inputs (`lines`, consent, declared sittings) on them.
 */

import { z } from 'zod';

export const ATTEMPTS = ['first', 'retake'] as const;
export const AttemptSchema = z.enum(ATTEMPTS);
export type Attempt = z.infer<typeof AttemptSchema>;

export const LINE_MODES = ['in_school', 'self_study'] as const;
export const LineModeSchema = z.enum(LINE_MODES);
export type LineMode = z.infer<typeof LineModeSchema>;

export const PRIOR_SITTING_SOURCES = ['known', 'declared_by_desk', 'declared_by_family', 'legacy'] as const;
export const PriorSittingSourceSchema = z.enum(PRIOR_SITTING_SOURCES);
export type PriorSittingSource = z.infer<typeof PriorSittingSourceSchema>;

export const CONSENT_KINDS = ['refund_policy', 'declaration'] as const;
export const CONSENT_CHANNELS = ['app', 'desk', 'school', 'imported'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

/** One line of a reservation (B's inputs use it; A's old paths build it with resolveItem). */
export const LineInput = z.object({
  offerItemId: z.string().min(1),
  attempt: AttemptSchema,
  mode: LineModeSchema,
  // Null: "no preference yet" (the coordinator assigns later); always null in self-study.
  teacherId: z.string().min(1).nullable().optional(),
  priorSittingSeriesId: z.string().min(1).nullable().optional(),
  priorSittingSource: PriorSittingSourceSchema.nullable().optional(),
});
export type LineInputType = z.infer<typeof LineInput>;

/**
 * Why a line's price is what it is (priceLine), snapshotted on the line so the receipt and the
 * statement can say it ("course 14,000 × 50% + board 9,200 × 100%").
 */
export type PricingBasis = {
  v: 1;
  attempt: Attempt;
  mode: LineMode;
  itemKind: string;
  courseFeeBase: number;
  coursePercent: number;
  onePaperPercent: number;
  boardFeeBase: number;
  boardPercent: number;
  feeRows: { id: string; keyKind: string; keyId: string; amount: number; provisional: boolean }[];
  exceptionIds: string[];
  customPrice: boolean;
  courseFee: number;
  registrationFee: number;
  total: number;
};

/**
 * The policies a line is checked against (§3.5's table), each exception-able through the
 * exception adapter (C's registry replaces today's).
 */
export const LINE_POLICY_KEYS = [
  'gate.availability',
  'gate.selfStudyFirstEntry',
  'gate.retakeDeclared',
  'gate.exclusiveItems',
  'gate.sameEntryOnce',
  'gate.requiredItems',
  'gate.priorSeries',
  'gate.grade10Core',
] as const;
export const PRICE_POLICY_KEYS = [
  'price.custom',
  'price.discountPercent',
  'price.discountFixed',
  'pricing.selfStudyCoursePercent',
  'pricing.selfStudyBoardPercent',
  'pricing.retakeTaughtCoursePercent',
  'pricing.onePaperCoursePercent',
] as const;
export const DUE_POLICY_KEYS = ['deadline.payment'] as const;
export type LinePolicyKey = (typeof LINE_POLICY_KEYS)[number] | (typeof PRICE_POLICY_KEYS)[number] | (typeof DUE_POLICY_KEYS)[number];

/** The family's (and staff's) read of what a student can reserve in a session. */
export const OffersQuery = z.object({
  sessionId: z.string().min(1),
  studentId: z.string().min(1).optional(),
});
export type OffersQueryType = z.infer<typeof OffersQuery>;
