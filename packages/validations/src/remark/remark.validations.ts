/**
 * Remark (Enquiries About Results) Validation Schemas (V3 §6.10)
 *
 * All three councils operate at PAPER level; requests are a header with
 * per-paper line items. Consent is mandatory and blocking — grades can
 * go down as well as up at every board.
 */

import { z } from 'zod';

export const REMARK_SERVICE_TYPES = [
  'clerical_check',
  'review_of_marking',
  'priority_review',
  'script_copy',
] as const;

export const RemarkServiceTypeSchema = z.enum(REMARK_SERVICE_TYPES);
export type RemarkServiceType = z.infer<typeof RemarkServiceTypeSchema>;

export const REMARK_SERVICE_LABELS: Record<typeof REMARK_SERVICE_TYPES[number], string> = {
  clerical_check:    'Clerical Re-check',
  review_of_marking: 'Review of Marking',
  priority_review:   'Priority Review of Marking',
  script_copy:       'Copy of Marked Script',
};

export const REMARK_STATUSES = [
  'pending_approval',
  'pending_consent',
  'pending_payment',
  'awaiting_submission',
  'submitted',
  'outcome_recorded',
  'rejected',
  'cancelled',
] as const;

export const RemarkStatusSchema = z.enum(REMARK_STATUSES);
export type RemarkStatus = z.infer<typeof RemarkStatusSchema>;

export const REMARK_STATUS_LABELS: Record<typeof REMARK_STATUSES[number], string> = {
  pending_approval:    'Pending Parent Approval',
  pending_consent:     'Awaiting Consent',
  pending_payment:     'Pending Payment',
  awaiting_submission: 'Awaiting Submission to Board',
  submitted:           'Submitted to Board',
  outcome_recorded:    'Outcome Recorded',
  rejected:            'Rejected',
  cancelled:           'Cancelled',
};

export const REMARK_OUTCOMES = ['pending', 'mark_up', 'mark_down', 'unchanged'] as const;
export const RemarkOutcomeSchema = z.enum(REMARK_OUTCOMES);

export const RemarkId = z.object({
  id: z.string().min(1, 'Invalid remark request ID'),
});
export type RemarkIdType = z.infer<typeof RemarkId>;

/**
 * Bundling matters: Edexcel and OxfordAQA only waive fees on a grade
 * change for papers submitted TOGETHER — the UI nudges toward one
 * request with every paper in it.
 */
export const CreateRemarkRequest = z.object({
  registrationId: z.string().min(1, 'Invalid registration ID'),
  // The service as V3 named it; the reservations rework (§3.6) maps it onto a board service of the
  // line's board — or the caller names that board service (boardServiceId) directly.
  serviceType: RemarkServiceTypeSchema.optional(),
  boardServiceId: z.string().min(1).optional(),
  papers: z
    .array(
      z.object({
        paperCode: z.string().min(1, 'Paper code is required').max(50),
        paperName: z.string().max(200).optional().nullable(),
      })
    )
    .min(1, 'Add at least one paper')
    .max(10, 'Too many papers'),
  // NOTE: no client-supplied studentId — the student is always derived
  // server-side from the registration row (prevents any spoofing).
}).refine((d) => !!d.serviceType || !!d.boardServiceId, { message: 'Choose the service', path: ['serviceType'] });
export type CreateRemarkRequestType = z.infer<typeof CreateRemarkRequest>;

export const DecideRemark = z.object({
  comments: z.string().max(500).optional(),
});
export type DecideRemarkType = z.infer<typeof DecideRemark>;

/**
 * Blocking consent: the parent must attest the candidate understands
 * marks can go DOWN. Optional upload of the signed form (the school
 * retains the paper — OxfordAQA treats a missing consent as centre
 * malpractice).
 */
export const ConfirmRemarkConsent = z.object({
  attest: z.literal(true, {
    message: 'You must confirm the candidate consents and understands grades can go down',
  }),
  consentFileId: z.string().min(1).optional().nullable(),
});
export type ConfirmRemarkConsentType = z.infer<typeof ConfirmRemarkConsent>;

export const PayRemark = z.object({
  paymentMethod: z.enum(['in_school', 'instapay']),
});
export type PayRemarkType = z.infer<typeof PayRemark>;

export const MarkRemarkSubmitted = z.object({
  boardReference: z.string().min(1, 'Enter the board reference').max(100),
});
export type MarkRemarkSubmittedType = z.infer<typeof MarkRemarkSubmitted>;

export const RecordRemarkOutcome = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        outcome: z.enum(['mark_up', 'mark_down', 'unchanged']),
        gradeAfter: z.string().max(10).optional().nullable(),
      })
    )
    .min(1),
  /** Did the SUBJECT grade change? Drives the council fee-refund rule. */
  gradeChanged: z.boolean(),
  comments: z.string().max(500).optional(),
});
export type RecordRemarkOutcomeType = z.infer<typeof RecordRemarkOutcome>;

export const UpsertRemarkFee = z.object({
  council: z.enum(['pearson_edexcel', 'cambridge', 'oxford']),
  serviceType: RemarkServiceTypeSchema,
  amountPerPaper: z.number().min(0).max(1_000_000),
});
export type UpsertRemarkFeeType = z.infer<typeof UpsertRemarkFee>;

export const UpsertRemarkDeadline = z.object({
  council: z.enum(['pearson_edexcel', 'cambridge', 'oxford']),
  sessionId: z.string().min(1),
  serviceType: RemarkServiceTypeSchema,
  deadline: z.coerce.date(),
});
export type UpsertRemarkDeadlineType = z.infer<typeof UpsertRemarkDeadline>;

// ─── Results entry (V3 §5.4) ─────────────────────────────────────────────────

export const RecordResults = z.object({
  results: z
    .array(
      z.object({
        registrationId: z.string().min(1),
        grade: z.string().min(1, 'Grade required').max(10),
      })
    )
    .min(1)
    .max(500),
});
export type RecordResultsType = z.infer<typeof RecordResults>;

export const ResultsPendingQuery = z.object({
  sessionId: z.string().min(1, 'Session is required'),
});
export type ResultsPendingQueryType = z.infer<typeof ResultsPendingQuery>;
