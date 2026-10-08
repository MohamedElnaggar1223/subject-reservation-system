/**
 * Reservations (RESERVATIONS_REWORK.md §3.5, §4.3–§4.5; docs/features/RESERVATIONS_LINES.md).
 *
 * The inputs every reservation path takes since step B — the request, the direct reservation,
 * the desk, the admin's override, preregistration and swaps: `lines` (one per item the family
 * ticks, with the form's entry choice as attempt and mode, the teacher and the sitting a retake
 * or a carry-forward follows) and `consent` (the refund policy and the declaration). Plus the
 * declared sittings' verification, the teacher change on a line and the statement's query.
 */

import { z } from 'zod';
import { AttemptSchema, LineModeSchema } from './line.validations';
import { SeriesMonthSchema } from '../session/session.validations';
import type { RefundPolicySnapshot } from '../session/session.validations';
import { refundPolicySentence } from '../session/session.validations';

// ─── One line of a reservation ───────────────────────────────────────────────

/**
 * A line as a page sends it. The sitting a retake or a carry-forward follows is named by its
 * series (`priorSittingSeriesId`: a sitting the offers read listed, known or on record) or, for a
 * sitting of the item's board not on record yet, by its month and year (`priorSitting`): the
 * series row is created with no dates (§3.5, "the family's sitting picker"). How the sitting is
 * known (`known`, `declared_by_family`, `declared_by_desk`) is the server's to decide, never the
 * page's. `expectedPrice` is the price the page showed: a re-price committing in between is
 * refused rather than charged (docs/features/RESERVATIONS.md §2.11, PRICE_CHANGED_REFUSAL).
 */
export const ReservationLine = z
  .object({
    offerItemId: z.string().min(1, 'Choose an item'),
    attempt: AttemptSchema,
    mode: LineModeSchema,
    // Undefined: the offer's only teacher, or none. Null: "no preference yet".
    teacherId: z.string().min(1).nullable().optional(),
    priorSittingSeriesId: z.string().min(1).nullable().optional(),
    priorSitting: z.object({ month: SeriesMonthSchema, year: z.number().int().min(2000).max(2100) }).optional(),
    expectedPrice: z.number().min(0).max(10_000_000).optional(),
  })
  .refine((l) => !(l.priorSittingSeriesId && l.priorSitting), {
    message: 'Name the earlier sitting once: from the list, or by its month and year',
    path: ['priorSitting'],
  })
  .refine((l) => !(l.mode === 'self_study' && l.teacherId), {
    message: 'A self-study line has no teacher',
    path: ['teacherId'],
  });
export type ReservationLineType = z.infer<typeof ReservationLine>;

export const ReservationLines = z
  .array(ReservationLine)
  .min(1, 'Choose at least one item')
  .max(30, 'Cannot reserve more than 30 items at once')
  .refine((ls) => new Set(ls.map((l) => l.offerItemId)).size === ls.length, { message: 'Each item once' });

// ─── Consent (§3.5, G-20) ────────────────────────────────────────────────────

/**
 * The two things every form asks the family to confirm. A family's own reservation sends both
 * ticked; the desk's single "read and signed by the parent" tick sends both (one row per line
 * and kind, channel `desk`).
 */
export const ReservationConsent = z.object({
  refundPolicy: z.literal(true, { message: 'Tick that you have read the refund policy' }),
  declaration: z.literal(true, { message: 'Tick the declaration: the information given is true, complete and accurate' }),
});
export type ReservationConsentType = z.infer<typeof ReservationConsent>;

/** The versions of the texts a consent row records (`registration_consent.text_version`). */
export const CONSENT_TEXT_VERSIONS = {
  refund_policy: 'refund-policy-v1',
  declaration: 'declaration-v1',
} as const;

/** The forms' declaration (SCHOOL_FORMS.md §2.1, question n). */
export const DECLARATION_TEXT = 'I confirm that the information given is true, complete and accurate.';

/** The desk's one tick for the whole reservation (§4.3). */
export const DESK_CONSENT_TEXT = 'Refund policy and declaration read and signed by the parent';

/** The refund-policy acknowledgement as the family reads it, from the steps a line snapshots. */
export function refundConsentText(snapshot: RefundPolicySnapshot | null | undefined): string {
  if (!snapshot) return 'I confirm that I have read the refund policy.';
  if (snapshot.kind === 'weeks') {
    return `I confirm that I have read the refund policy: of the course fee, ${refundPolicySentence({ steps: snapshot.steps })}, counted from the first lesson.`;
  }
  if (!snapshot.windows.length) return 'I confirm that I have read the refund policy: a drop is refunded in full.';
  const day = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' });
  return `I confirm that I have read the refund policy: ${snapshot.windows.map((w) => `${w.percent}% from ${day(w.startsAt)} to ${day(w.endsAt)}`).join(' · ')}; nothing outside these dates.`;
}

// ─── Declared sittings: verification (§3.5) ──────────────────────────────────

export const PRIOR_SITTING_OUTCOMES = ['verified', 'rejected'] as const;
export const PriorSittingOutcomeSchema = z.enum(PRIOR_SITTING_OUTCOMES);
export type PriorSittingOutcome = z.infer<typeof PriorSittingOutcomeSchema>;

/**
 * The coordinator's (or the admin's, or the finance desk's with the board's statement in hand)
 * answer to a declared sitting. The previous centre and candidate number are asked on a
 * carry-forward from another centre (F4 needs them for the entry).
 */
export const VerifyPriorSitting = z
  .object({
    outcome: PriorSittingOutcomeSchema,
    prevCentre: z.string().trim().min(1).max(100).optional(),
    prevCandidateNumber: z.string().trim().min(1).max(50).optional(),
    reason: z.string().trim().min(5, 'Say what was checked (at least 5 characters)').max(500),
    // The finance desk verifies with the evidence the family shows: what was seen.
    evidence: z.string().trim().min(3).max(300).optional(),
  })
  .refine((v) => v.outcome === 'verified' || (!v.prevCentre && !v.prevCandidateNumber), {
    message: 'A previous centre and candidate number are recorded on a verified sitting only',
    path: ['prevCentre'],
  });
export type VerifyPriorSittingType = z.infer<typeof VerifyPriorSitting>;

/** The session's To verify tab: the sittings awaiting an answer, or those answered. */
export const ToVerifyQuery = z.object({
  show: z.enum(['awaiting', 'decided']).default('awaiting'),
});
export type ToVerifyQueryType = z.infer<typeof ToVerifyQuery>;

/** What happens to a line whose declaration is unverified at its deadline (§3.5, Q-22). */
export const UNVERIFIED_AT_DEADLINE = ['enter_as_declared', 'hold'] as const;
export type UnverifiedAtDeadline = (typeof UNVERIFIED_AT_DEADLINE)[number];

// ─── The teacher on a line (§3.5, point 10) ──────────────────────────────────

/**
 * Change a line's teacher (the admin, the coordinator, the finance desk; the family asks there):
 * a teacher of the item or offer, `null` for "no preference" where the offer has several, or
 * `mode: 'self_study'` (no teacher). The price never changes here: a difference is finance's
 * explicit act.
 */
export const ChangeLineTeacher = z
  .object({
    teacherId: z.string().min(1).nullable(),
    mode: LineModeSchema.optional(),
    reason: z.string().trim().min(5, 'A reason is required (at least 5 characters)').max(500),
  })
  .refine((v) => !(v.mode === 'self_study' && v.teacherId), { message: 'A self-study line has no teacher', path: ['teacherId'] });
export type ChangeLineTeacherType = z.infer<typeof ChangeLineTeacher>;

// ─── The statement (§4.5) ────────────────────────────────────────────────────

/** One child (`studentId`) or a whole family (`familyId`: the parent's account). A student reads their own. */
export const StatementQuery = z
  .object({
    studentId: z.string().min(1).optional(),
    familyId: z.string().min(1).optional(),
  })
  .refine((q) => !(q.studentId && q.familyId), { message: 'Ask for one student or one family, not both' });
export type StatementQueryType = z.infer<typeof StatementQuery>;
