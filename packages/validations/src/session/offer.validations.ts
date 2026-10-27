/**
 * What remains of a session's offers' schemas after the coordinator rework's clean-up (P1c): the label every
 * all-papers row stores, grade 10's bulk registration (parked) and the session's money read.
 *
 * The links sheet's schemas (offers, items, their availability and fee keys, the subject's form, replace
 * teacher) and the series' fee grids' (board fees) left with their routes (COORDINATOR_REWORK.md §9): the
 * coordinator's set-up schemas are in setup.validations.ts.
 */

import { z } from 'zod';

/**
 * The label an all-papers row stores. It stays stored (F7's findItem matches labels, and the suites read it);
 * every screen shows the forms' words instead ("All papers", SCHOOL_FORMS.md §2.5).
 */
export const WHOLE_ITEM_LABEL = 'Whole subject';

// ─── Grade 10 (A-15, Q-10) ───────────────────────────────────────────────────

/** Register grade 10's core offers for June in bulk; the preview lists, the commit creates once. */
export const Grade10Bulk = z.object({
  // Absent: every grade-10 student of the session's academic year.
  studentIds: z.array(z.string().min(1)).max(1000).optional(),
});
export type Grade10BulkType = z.infer<typeof Grade10Bulk>;

// ─── The session's money (§4.6, lines only) ─────────────────────────────────

export const SessionMoneyQuery = z.object({
  filter: z.enum(['all', 'unpaid', 'overdue', 'provisional', 'paid']).default('all'),
  offerId: z.string().min(1).optional(),
  sectionId: z.string().min(1).optional(),
});
export type SessionMoneyQueryType = z.infer<typeof SessionMoneyQuery>;
