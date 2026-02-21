/**
 * Parent-Student Link Validation Schemas
 * 
 * Validates data for parent-student linking operations:
 * - Creating link requests (parent initiates)
 * - Responding to link requests (student approves/rejects)
 * - Querying link status
 */

import { z } from 'zod';

/**
 * Link status enum
 */
export const LinkStatus = z.enum(['pending', 'approved', 'rejected']);
export type LinkStatusType = z.infer<typeof LinkStatus>;

/**
 * Link ID validation (UUID format)
 */
export const LinkId = z.object({
  id: z.string().uuid('Invalid link ID format'),
});
export type LinkIdType = z.infer<typeof LinkId>;

/**
 * Create Link Request
 * Parent uses either email or studentId to identify the student
 */
export const CreateLinkRequest = z.object({
  // Either email or studentId must be provided
  studentEmail: z.string().email('Invalid email format').optional(),
  studentIdentifier: z.string().min(1, 'Student identifier is required').optional(),
}).refine(
  (data) => data.studentEmail || data.studentIdentifier,
  { message: 'Either student email or student ID must be provided' }
);
export type CreateLinkRequestType = z.infer<typeof CreateLinkRequest>;

/**
 * Respond to Link Request
 * Student approves or rejects the link request
 */
export const RespondToLink = z.object({
  status: z.enum(['approved', 'rejected'], {
    message: 'Status must be either "approved" or "rejected"',
  }),
});
export type RespondToLinkType = z.infer<typeof RespondToLink>;

/**
 * Link query filters
 */
export const LinkQueryFilters = z.object({
  status: LinkStatus.optional(),
});
export type LinkQueryFiltersType = z.infer<typeof LinkQueryFilters>;
