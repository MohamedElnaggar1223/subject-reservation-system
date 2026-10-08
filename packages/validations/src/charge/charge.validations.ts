/**
 * Charges, board services and the school-fee push (RESERVATIONS_REWORK.md §3.6, §3.10).
 *
 * A charge is anything a family owes that is not a reservation line, a remark fee or the school
 * fee itself: a board service (cash-in, late cash-in, certificate split), a late entry fee (only
 * when Q-20 is answered yes), the school fee pushed into a family's pending payments, an
 * instalment of a plan, a price adjustment, or a custom charge. It is paid in a payment of its own
 * purpose (`charge`), never mixed with lines; a pushed school fee is paid through the school-fee
 * path and settled by that payment.
 */

import { z } from 'zod';
import { isWholePiastres, PIASTRES_MESSAGE } from '../common.validations';

export const CHARGE_KINDS = [
  'cash_in', 'late_cash_in', 'certificate_split', 'late_entry_fee', 'school_fee_push', 'instalment', 'price_adjustment', 'custom',
] as const;
export const ChargeKindSchema = z.enum(CHARGE_KINDS);
export type ChargeKind = z.infer<typeof ChargeKindSchema>;

export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  cash_in: 'Cash-in',
  late_cash_in: 'Late cash-in',
  certificate_split: 'Certificate split',
  late_entry_fee: 'Late entry fee',
  school_fee_push: 'School fee',
  instalment: 'Instalment',
  price_adjustment: 'Price adjustment',
  custom: 'Other charge',
};

/** The board services a charge of each kind is for (remarks keep their own path). */
export const SERVICE_CHARGE_KINDS = ['cash_in', 'late_cash_in', 'certificate_split'] as const;

/** Kinds staff create on POST /v1/charges (an instalment comes from a plan, a push from the School fees screen). */
export const CREATABLE_CHARGE_KINDS = ['cash_in', 'late_cash_in', 'certificate_split', 'late_entry_fee', 'price_adjustment', 'custom'] as const;

export const CHARGE_STATUSES = ['requested', 'pending_payment', 'paid', 'cancelled', 'refunded'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];
export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  requested: 'Requested — awaiting the school',
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

// ─── Board services ──────────────────────────────────────────────────────────

export const BOARD_SERVICE_KINDS = ['remark', 'cash_in', 'late_cash_in', 'certificate_split'] as const;
export type BoardServiceKind = (typeof BOARD_SERVICE_KINDS)[number];
export const REFUND_RULES = ['none', 'full', 'less_fixed'] as const;
export type RefundRule = (typeof REFUND_RULES)[number];
/** A service's two rates (the Cambridge EAR sheet: IGCSE and AS/A Level). */
export const SERVICE_LEVELS = ['igcse', 'as_a_level'] as const;
export type ServiceLevel = (typeof SERVICE_LEVELS)[number];
export const SERVICE_LEVEL_LABELS: Record<ServiceLevel, string> = { igcse: 'IGCSE / O Level', as_a_level: 'AS / A Level' };

/** The service level of a subject row's qualification level. */
export function serviceLevelOf(qualificationLevel: string | null | undefined): ServiceLevel {
  return qualificationLevel === 'as_level' || qualificationLevel === 'a_level' ? 'as_a_level' : 'igcse';
}

export const BoardServiceId = z.object({ id: z.string().min(1) });

/** Change a board service in the catalogue: its label, whether a family may ask for it, whether it is offered (admin, coordinator). */
export const UpdateBoardService = z.object({
  label: z.string().trim().min(2).max(120).optional(),
  requestableByFamily: z.boolean().optional(),
  isActive: z.boolean().optional(),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
});
export type UpdateBoardServiceType = z.infer<typeof UpdateBoardService>;

/** A board service's refund rule on a changed grade (Q-21; a money rule: finance admin, admin). */
export const ServiceRefundRule = z.object({
  refundRule: z.enum(REFUND_RULES),
  refundDeduction: z.number().min(0).max(100_000).refine(isWholePiastres, PIASTRES_MESSAGE).optional().nullable(),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
}).refine((d) => d.refundRule !== 'less_fixed' || (d.refundDeduction ?? 0) > 0, { message: 'A fixed deduction needs its amount', path: ['refundDeduction'] });
export type ServiceRefundRuleType = z.infer<typeof ServiceRefundRule>;

/** A series' service deadlines (one instant per service; null clears it). */
export const PutServiceDeadlines = z.object({
  boardSeriesId: z.string().min(1),
  rows: z.array(z.object({ boardServiceId: z.string().min(1), deadline: z.coerce.date().nullable() })).min(1).max(40),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
});
export type PutServiceDeadlinesType = z.infer<typeof PutServiceDeadlines>;

/** A series' service fees (per service and level), as the board's fee list gives them. */
export const PutServiceFees = z.object({
  boardSeriesId: z.string().min(1),
  rows: z.array(z.object({
    boardServiceId: z.string().min(1),
    level: z.enum(SERVICE_LEVELS),
    amount: z.number().min(0).max(1_000_000).refine(isWholePiastres, PIASTRES_MESSAGE),
    provisional: z.boolean().default(false),
  })).min(1).max(80),
  reason: z.string().trim().max(500).optional(),
});
export type PutServiceFeesType = z.infer<typeof PutServiceFees>;

export const BoardServicesQuery = z.object({
  boardCode: z.string().min(1).optional(),
  boardSeriesId: z.string().min(1).optional(),
});
export type BoardServicesQueryType = z.infer<typeof BoardServicesQuery>;

// ─── Charges ─────────────────────────────────────────────────────────────────

export const ChargeId = z.object({ id: z.string().min(1) });

/**
 * A charge staff add (or a family asks for: a requestable board service only, which waits as
 * `requested` until staff accept it). A service charge's amount is the series' fee for the
 * service; a price adjustment or a custom charge names its amount.
 */
export const CreateCharge = z.object({
  studentId: z.string().min(1, 'Pick a student'),
  kind: z.enum(CREATABLE_CHARGE_KINDS),
  registrationId: z.string().min(1).optional(),
  boardSeriesId: z.string().min(1).optional(),
  boardServiceId: z.string().min(1).optional(),
  level: z.enum(SERVICE_LEVELS).optional(),
  description: z.string().trim().max(300).optional(),
  amount: z.number().min(0).max(1_000_000).refine(isWholePiastres, PIASTRES_MESSAGE).optional(),
  dueAt: z.coerce.date().optional(),
  reason: z.string().trim().max(500).optional(),
});
export type CreateChargeType = z.infer<typeof CreateCharge>;

export const ChargeDecision = z.object({ reason: z.string().trim().min(3, 'A reason is required').max(500) });
export type ChargeDecisionType = z.infer<typeof ChargeDecision>;

/** A refund of a paid charge to escrow (finance, with a reason; at most what it cost). */
export const RefundCharge = z.object({
  amount: z.number().positive('A refund is more than 0').max(1_000_000).refine(isWholePiastres, PIASTRES_MESSAGE),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
});
export type RefundChargeType = z.infer<typeof RefundCharge>;

export const ListChargesQuery = z.object({
  studentId: z.string().min(1).optional(),
  // A session's charges: those of its lines (instalments, adjustments, a line's service) and the
  // services asked in the series its items sit in.
  sessionId: z.string().min(1).optional(),
  status: z.enum(CHARGE_STATUSES).optional(),
  kind: ChargeKindSchema.optional(),
});
export type ListChargesQueryType = z.infer<typeof ListChargesQuery>;

// ─── The school fee pushed to families ───────────────────────────────────────

/**
 * Push the school fee of a year into families' pending payments (§3.6, point 8): a grade, a
 * section or a list of students, with the date it is due. Paid, waived, A-13-exempt students and
 * those with an open push are skipped and listed.
 */
export const PushSchoolFees = z.object({
  academicYear: z.string().regex(/^\d{4}-\d{4}$/, 'Academic year must look like 2026-2027'),
  grade: z.number().int().min(9).max(13).optional(),
  sectionId: z.string().min(1).optional(),
  studentIds: z.array(z.string().min(1)).min(1).max(2000).optional(),
  dueAt: z.coerce.date(),
}).refine((d) => d.grade !== undefined || !!d.sectionId || !!d.studentIds?.length, { message: 'Choose a grade, a section or the students', path: ['grade'] });
export type PushSchoolFeesType = z.infer<typeof PushSchoolFees>;

// ─── The desk's drop past a deadline ─────────────────────────────────────────

/** The desk drops a line whose effective deadline has passed (§3.3): a reason, the receipt gate, the "sent" refund. */
export const DeskDrop = z.object({
  reason: z.string().trim().min(5, 'Say why the line is dropped (min 5 characters)').max(500),
});
export type DeskDropType = z.infer<typeof DeskDrop>;
