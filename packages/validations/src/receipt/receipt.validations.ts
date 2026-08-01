/**
 * Receipt Validation Schemas (V3 §6.5)
 *
 * Physical receipts — one per subject registration. Finance staff mark
 * transitions; parents just see the status. An unreturned receipt gates
 * drop completion (D-D).
 */

import { z } from 'zod';

export const RECEIPT_STATUSES = [
  'pending_issue',
  'issued',
  'return_required',
  'returned',
  'lost',
  'void',
] as const;

export const ReceiptStatusSchema = z.enum(RECEIPT_STATUSES);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;

export const RECEIPT_STATUS_LABELS: Record<typeof RECEIPT_STATUSES[number], string> = {
  pending_issue:   'Ready to Hand Over',
  issued:          'With Parent',
  return_required: 'Must Be Returned',
  returned:        'Returned to School',
  lost:            'Marked Lost',
  void:            'Voided',
};

export const ReceiptId = z.object({
  id: z.string().min(1, 'Invalid receipt ID'),
});
export type ReceiptIdType = z.infer<typeof ReceiptId>;

export const MarkReceiptReturned = z.object({
  notes: z.string().max(500).optional(),
});
export type MarkReceiptReturnedType = z.infer<typeof MarkReceiptReturned>;

/** Lost/void need a reason — they bypass the physical return (finance admin only) */
export const MarkReceiptLostOrVoid = z.object({
  reason: z.string().min(1, 'A reason is required').max(500),
});
export type MarkReceiptLostOrVoidType = z.infer<typeof MarkReceiptLostOrVoid>;

// ─── Refund Windows (V3 §6.12) ───────────────────────────────────────────────

export const CreateRefundWindow = z
  .object({
    sessionId: z.string().min(1).optional().nullable(),
    academicYear: z
      .string()
      .regex(/^\d{4}-\d{4}$/, 'Academic year must look like 2026-2027')
      .optional()
      .nullable(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    percentage: z.number().min(0).max(100),
    label: z.string().max(100).optional().nullable(),
  })
  .refine((d) => d.endsAt > d.startsAt, {
    message: 'End must be after start',
    path: ['endsAt'],
  })
  .refine((d) => !!d.sessionId !== !!d.academicYear, {
    message: 'Scope must be exactly one of session or academic year',
    path: ['sessionId'],
  });
export type CreateRefundWindowType = z.infer<typeof CreateRefundWindow>;

export const RefundWindowId = z.object({
  id: z.string().min(1, 'Invalid refund window ID'),
});
export type RefundWindowIdType = z.infer<typeof RefundWindowId>;

export const RefundPreviewQuery = z.object({
  registrationId: z.string().min(1, 'Invalid registration ID'),
});
export type RefundPreviewQueryType = z.infer<typeof RefundPreviewQuery>;
