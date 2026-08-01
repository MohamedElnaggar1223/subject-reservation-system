/**
 * Registration Session Validation Schemas
 *
 * Validates data for all registration window operations:
 * - Creating and managing sessions (admin)
 * - Browsing active sessions (all authenticated users)
 * - Activating and closing sessions (admin)
 */

import { z } from 'zod';
import { QualificationLevelSchema } from '../subject/subject.validations';

/**
 * IGCSE exam session types.
 * Each represents a distinct exam sitting period in the school year.
 *
 * V3 (§5.5): sessions also carry a qualificationLevel. January series
 * are A-Level-only in Egypt — no January IGCSE exists (Edexcel
 * discontinued it in 2023; Cambridge/OxfordAQA never ran one).
 */
export const SESSION_TYPES = {
  JUNE: 'june',
  NOVEMBER: 'november',
  JANUARY: 'january',
} as const;

export const SessionTypeSchema = z.enum([
  SESSION_TYPES.JUNE,
  SESSION_TYPES.NOVEMBER,
  SESSION_TYPES.JANUARY,
]);

export type SessionType = z.infer<typeof SessionTypeSchema>;

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  june: 'June',
  november: 'November',
  january: 'January',
};

/**
 * Session status values
 */
export const SESSION_STATUSES = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  CLOSED: 'closed',
} as const;

export const SessionStatusSchema = z.enum([
  SESSION_STATUSES.DRAFT,
  SESSION_STATUSES.ACTIVE,
  SESSION_STATUSES.CLOSED,
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * Session ID param validation
 */
export const SessionId = z.object({
  id: z.string().min(1, 'Session ID is required'),
});
export type SessionIdType = z.infer<typeof SessionId>;

/**
 * Create Session
 *
 * Admin-only. Creates a new registration window in draft status
 * (or immediately active if startDate is now or in the past).
 * endDate must be after startDate.
 */
export const CreateSession = z
  .object({
    name: z
      .string()
      .min(1, 'Session name is required')
      .max(100, 'Session name too long'),
    sessionType: SessionTypeSchema,
    qualificationLevel: QualificationLevelSchema.default('igcse'),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'End date must be after start date',
    path: ['endDate'],
  })
  .refine(
    (data) => !(data.sessionType === 'january' && data.qualificationLevel === 'igcse'),
    {
      message: 'January series are A-Level only — no January IGCSE exists in Egypt',
      path: ['qualificationLevel'],
    }
  );

export type CreateSessionType = z.infer<typeof CreateSession>;

/**
 * Update Draft Session
 *
 * Admin-only. While session is in draft, any field may be changed.
 * `reason` is optional on draft edits (the session isn't yet visible to
 * users) but is captured in the audit log when provided so reviewers can
 * tell WHY dates or the session type were changed before activation.
 */
export const UpdateDraftSession = z
  .object({
    name: z
      .string()
      .min(1, 'Session name is required')
      .max(100, 'Session name too long')
      .optional(),
    sessionType: SessionTypeSchema.optional(),
    qualificationLevel: QualificationLevelSchema.optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    reason: z.string().max(500, 'Reason too long').optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.endDate > data.startDate;
      }
      return true;
    },
    {
      message: 'End date must be after start date',
      path: ['endDate'],
    }
  );

export type UpdateDraftSessionType = z.infer<typeof UpdateDraftSession>;

/**
 * Update Active Session
 *
 * Admin-only. When session is active, only the endDate (deadline)
 * can be extended. A reason is required for the audit log.
 */
export const UpdateActiveSession = z.object({
  endDate: z.coerce.date(),
  reason: z
    .string()
    .min(5, 'Please provide a reason for the deadline change')
    .max(500, 'Reason too long'),
});

export type UpdateActiveSessionType = z.infer<typeof UpdateActiveSession>;

/**
 * Combined Update Session schema
 *
 * Used by the route — the service determines which fields
 * are allowed based on the session's current status.
 */
export const UpdateSession = z.union([UpdateDraftSession, UpdateActiveSession]);
export type UpdateSessionType = z.infer<typeof UpdateSession>;

/**
 * Close Session
 *
 * Admin-only. Manually closes an active session before its endDate.
 */
export const CloseSession = z.object({
  reason: z
    .string()
    .min(5, 'Please provide a reason for closing early')
    .max(500, 'Reason too long')
    .optional(),
});
export type CloseSessionType = z.infer<typeof CloseSession>;

/**
 * List Sessions Query
 *
 * Admin only. Optional status and type filters.
 */
export const ListSessionsQuery = z.object({
  status: SessionStatusSchema.optional(),
  sessionType: SessionTypeSchema.optional(),
});
export type ListSessionsQueryType = z.infer<typeof ListSessionsQuery>;
