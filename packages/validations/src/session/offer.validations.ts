/**
 * A session's offers, their teachers and items, and the series' fee grids
 * (RESERVATIONS_REWORK.md §3.2–§3.4; docs/features/RESERVATIONS.md §1.2–§1.5).
 */

import { z } from 'zod';
import { DateOnlySchema } from '../academic/structure.validations';

export const AVAILABILITIES = ['open', 'retake_only', 'self_study_only', 'closed'] as const;
export const AvailabilitySchema = z.enum(AVAILABILITIES);
export type Availability = z.infer<typeof AvailabilitySchema>;
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  open: 'Open: first entries and retakes',
  retake_only: 'Retakes only',
  self_study_only: 'Self-study only',
  closed: 'Closed',
};
export const TEACHING_MODES = ['in_school', 'online'] as const;
export const TeachingModeSchema = z.enum(TEACHING_MODES);
export type TeachingMode = z.infer<typeof TeachingModeSchema>;

export const ITEM_KINDS = ['whole', 'one_paper', 'unit', 'route', 'qualification'] as const;
export const ItemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof ItemKindSchema>;
export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  whole: 'Whole subject',
  one_paper: 'One paper (retake)',
  unit: 'Unit',
  route: 'Route',
  qualification: 'Qualification',
};

export const FEE_KEY_KINDS = ['unit', 'option', 'qualification', 'subject'] as const;
export const FeeKeyKindSchema = z.enum(FEE_KEY_KINDS);
export type FeeKeyKind = z.infer<typeof FeeKeyKindSchema>;

/** A teacher of an offer or an item: one from the pool, or a new external team (a provider). */
export const OfferTeacherInput = z.union([
  z.object({ teacherId: z.string().min(1), mode: TeachingModeSchema.default('in_school') }),
  z.object({ providerName: z.string().trim().min(2).max(120), mode: TeachingModeSchema.default('in_school') }),
]);
export type OfferTeacherInputType = z.infer<typeof OfferTeacherInput>;

export const FeeKeyInput = z.object({ kind: FeeKeyKindSchema, id: z.string().min(1) });
export type FeeKeyInputType = z.infer<typeof FeeKeyInput>;

/** What an item enters with the board. */
export const EntersInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('award'), qualificationId: z.string().min(1) }),
  z.object({ kind: z.literal('option'), optionId: z.string().min(1) }),
  z.object({ kind: z.literal('units'), unitIds: z.array(z.string().min(1)).min(1).max(12) }),
  z.object({ kind: z.literal('subject') }),
]);
export type EntersInputType = z.infer<typeof EntersInput>;

/** Why a self-study-only offer's course fee is 0 (MO-9; as a board fee of 0 says why). */
const ZeroFeeReason = z.string().trim().min(5, 'Say why the course fee is 0 (at least 5 characters)').max(500);

export const OfferItemInput = z.object({
  label: z.string().trim().min(1).max(120),
  kind: ItemKindSchema,
  enters: EntersInput,
  // Null or absent: the default series for the session's type (§3.3).
  boardSeriesId: z.string().min(1).nullable().optional(),
  availability: AvailabilitySchema.default('open'),
  // Null: the offer's course fee.
  courseFee: z.number().min(0).max(10_000_000).nullable().optional(),
  // Absent: what it enters.
  feeKeys: z.array(FeeKeyInput).min(1).max(12).optional(),
  // Absent: the catalogue's (a carry-forward option needs one).
  needsPriorSeries: z.boolean().optional(),
  requiredInSeries: z.boolean().default(false),
  exclusiveGroup: z.string().trim().min(1).max(40).nullable().optional(),
  // Absent or empty: the offer's teachers.
  teachers: z.array(OfferTeacherInput).max(10).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type OfferItemInputType = z.infer<typeof OfferItemInput>;

/**
 * A subject added to a session: three inputs for an IGCSE subject (the subject, its teachers,
 * the course fee); the items come from the catalogue unless given.
 */
export const CreateOffer = z.object({
  subjectId: z.string().min(1),
  availability: AvailabilitySchema.default('open'),
  courseFee: z.number().min(0).max(10_000_000),
  courseStartsOn: DateOnlySchema.nullable().optional(),
  grade10Core: z.boolean().default(false),
  notes: z.string().trim().max(1000).nullable().optional(),
  teachers: z.array(OfferTeacherInput).max(10).default([]),
  // MO-9: why a self-study-only offer carries a course fee of 0 (its lines priced at the board fee alone);
  // an open or retakes-only offer is refused at 0.
  zeroFeeReason: ZeroFeeReason.optional(),
  // Absent: generated from the catalogue (§3.2's table).
  items: z.array(OfferItemInput).min(1).max(30).optional(),
});
export type CreateOfferType = z.infer<typeof CreateOffer>;

export const UpdateOffer = z.object({
  availability: AvailabilitySchema.optional(),
  courseFee: z.number().min(0).max(10_000_000).optional(),
  courseStartsOn: DateOnlySchema.nullable().optional(),
  grade10Core: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  // The whole set, replacing what was there; a teacher removed keeps the lines that name them
  // (use "Replace teacher" to move them).
  teachers: z.array(OfferTeacherInput).max(10).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  reason: z.string().trim().max(500).optional(),
  // MO-9: as on CreateOffer, when the change makes it self-study only at 0.
  zeroFeeReason: ZeroFeeReason.optional(),
});
export type UpdateOfferType = z.infer<typeof UpdateOffer>;

export const UpdateOfferItem = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  // A change moves the item's live lines with it (F0b's guards; audited per line).
  boardSeriesId: z.string().min(1).optional(),
  availability: AvailabilitySchema.optional(),
  courseFee: z.number().min(0).max(10_000_000).nullable().optional(),
  feeKeys: z.array(FeeKeyInput).min(1).max(12).optional(),
  needsPriorSeries: z.boolean().optional(),
  requiredInSeries: z.boolean().optional(),
  exclusiveGroup: z.string().trim().min(1).max(40).nullable().optional(),
  // Null or empty: the offer's teachers.
  teachers: z.array(OfferTeacherInput).max(10).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  reason: z.string().trim().max(500).optional(),
});
export type UpdateOfferItemType = z.infer<typeof UpdateOfferItem>;

export const ReplaceOfferTeacher = z.object({
  fromTeacherId: z.string().min(1),
  toTeacherId: z.string().min(1),
  reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(500),
});
export type ReplaceOfferTeacherType = z.infer<typeof ReplaceOfferTeacher>;

export const OfferParam = z.object({ id: z.string().min(1), offerId: z.string().min(1) });
export const OfferItemParam = z.object({ id: z.string().min(1), offerId: z.string().min(1), itemId: z.string().min(1) });

// ─── Fee grids (§3.4) ────────────────────────────────────────────────────────

export const BoardFeesQuery = z.object({ seriesId: z.string().min(1) });
export const BoardFeeSeriesParam = z.object({ seriesId: z.string().min(1) });

export const BoardFeeRowInput = z.object({
  keyKind: FeeKeyKindSchema,
  keyId: z.string().min(1),
  amount: z.number().min(0).max(10_000_000),
  // A row typed before the board publishes is provisional; one typed from the published list is not.
  provisional: z.boolean().default(false),
  // An amount of 0 says why.
  zeroReason: z.string().trim().min(5).max(300).nullable().optional(),
});
export type BoardFeeRowInputType = z.infer<typeof BoardFeeRowInput>;

/** Set rows of a series' grid (new rows are added, existing ones changed). */
export const PutBoardFees = z.object({
  rows: z.array(BoardFeeRowInput).min(1).max(500),
  reason: z.string().trim().max(500).optional(),
});
export type PutBoardFeesType = z.infer<typeof PutBoardFees>;

/** Confirm provisional rows, at their amount or another (the board published). */
export const ConfirmBoardFees = z.object({
  rows: z.array(z.object({ feeId: z.string().min(1), amount: z.number().min(0).max(10_000_000).optional() })).min(1).max(500),
  reason: z.string().trim().max(500).optional(),
});
export type ConfirmBoardFeesType = z.infer<typeof ConfirmBoardFees>;

/** Re-price the board part of the unpaid lines read from these rows (one audited batch). */
export const RepriceBoardFees = z.object({
  feeIds: z.array(z.string().min(1)).min(1).max(500),
  reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(500),
});
export type RepriceBoardFeesType = z.infer<typeof RepriceBoardFees>;

/** Copy a grid from an earlier series of the board: every row provisional. */
export const CopyBoardFees = z.object({ fromSeriesId: z.string().min(1) });
export type CopyBoardFeesType = z.infer<typeof CopyBoardFees>;

/** Rows pasted from a fee list (code and amount per line), matched to the board's catalogue. */
export const ParseBoardFees = z.object({ text: z.string().max(20_000) });
export type ParseBoardFeesType = z.infer<typeof ParseBoardFees>;

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
