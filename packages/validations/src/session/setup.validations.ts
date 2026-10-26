/**
 * The coordinator's set-up contract (COORDINATOR_REWORK.md §4, Appendix A): a session, its
 * offerings (one per subject), their rows (what can be entered) with the four cells (how it is
 * studied), teachers, prices and extra questions; price lists; the impact of a change before it
 * is saved.
 *
 * Inputs only (PATTERNS.md): every response is inferred from the routes through the Hono RPC
 * client. The reference data's own schema (§7.1) is P0's (`offering/reference.ts`); the family
 * wording (D9) is P0's (`offering/labels.ts`).
 */

import { z } from 'zod';
import { SeriesMonthSchema } from './session.validations';
import { DateOnlySchema } from '../academic/structure.validations';

// ─── Closed lists (A3: pick rather than type) ────────────────────────────────

/** D2: what a row enters. */
export const ROW_KINDS = ['all_papers', 'paper', 'unit', 'as', 'a2', 'al', 'qualification', 'custom'] as const;
export const RowKindSchema = z.enum(ROW_KINDS);
export type RowKind = z.infer<typeof RowKindSchema>;

/** C1, D12: the sitting a row sits in — June in a June session; November or January in a winter one. */
export const SITTINGS = ['june', 'november', 'january'] as const;
export const SittingSchema = z.enum(SITTINGS);
export type Sitting = z.infer<typeof SittingSchema>;

/** E2–E5: where a row's exam fee came from (P0's ExamFeeSourceSchema says the same for the pre-load). */
export const ROW_FEE_SOURCES = ['list', 'typed', 'units_sum', 'board_rule'] as const;
export const RowFeeSourceSchema = z.enum(ROW_FEE_SOURCES);

/** D5: who chooses the teacher of an in-school option. */
export const TEACHER_CHOICES = ['families', 'school'] as const;
export const TeacherChoiceSchema = z.enum(TEACHER_CHOICES);
export type TeacherChoice = z.infer<typeof TeacherChoiceSchema>;

/** D11: the grades that may reserve. */
export const ALLOWED_GRADES = ['10', '11', '12', 'graduates'] as const;
export const AllowedGradeSchema = z.enum(ALLOWED_GRADES);
export type AllowedGrade = z.infer<typeof AllowedGradeSchema>;
export const DEFAULT_ALLOWED_GRADES: AllowedGrade[] = ['11', '12', 'graduates'];

/** D13: an extra question's kind. */
export const QUESTION_KINDS = ['yes_no', 'text', 'choice'] as const;
export const QuestionKindSchema = z.enum(QUESTION_KINDS);

/** D1: the school's two groups of subjects. */
export const SUBJECT_GROUPS = ['O.L.', 'A.S./A.L.'] as const;
export const SubjectGroupSchema = z.enum(SUBJECT_GROUPS);
/** The school's two tiers of a subject (P0's ReferenceLevelSchema). */
export const SubjectLevelSchema = z.enum(['igcse', 'as_al']);

export const BoardCodeInputSchema = z.enum(['cambridge', 'pearson_edexcel', 'oxford']);

const Money = z.number().min(0).max(10_000_000);

// ─── Impact before saving (A3, §6) ───────────────────────────────────────────

/**
 * What a change does to families, answered before it is saved; the client sends the same counts
 * back as `expected` and a mismatch is refused (IMPACT_CHANGED).
 */
export const ImpactSchema = z.object({
  repriced: z.number().int().min(0),
  listedForFinance: z.number().int().min(0),
  linesAffected: z.number().int().min(0),
  dueDatesMoved: z.number().int().min(0),
  /**
   * Unpaid reservations whose last day to pay (the cut-off) moves earlier — the unpaid-cancel days cut, or the
   * payment due date moved — and, of those, the ones it puts in the past (they expire at the next check).
   * Optional on input (a client that predates them sends none: 0).
   */
  cutOffsEarlier: z.number().int().min(0).default(0),
  cutOffsPassed: z.number().int().min(0).default(0),
});
export type ImpactType = z.infer<typeof ImpactSchema>;

/** IMPACT_CHANGED (409): the counts sent back as `expected` are no longer what the change does. */
export const IMPACT_CHANGED_REFUSAL = 'What this change does to families changed while you were looking: look at the new counts and save again';

/**
 * The impact in plain words, before she confirms it: "This re-prices 2 unpaid reservations and moves the due
 * date of 3 unpaid reservations."
 */
export function impactSentence(i: ImpactType): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts: string[] = [];
  if (i.repriced) parts.push(`re-prices ${n(i.repriced, 'unpaid reservation', 'unpaid reservations')} (the families are told)`);
  if (i.listedForFinance) parts.push(`lists ${n(i.listedForFinance, 'paid reservation', 'paid reservations')} for finance (their price stays)`);
  if (i.linesAffected) parts.push(`changes ${n(i.linesAffected, 'reservation', 'reservations')} (made payable, or closed to new ones)`);
  if (i.dueDatesMoved) parts.push(`moves the due date of ${n(i.dueDatesMoved, 'unpaid reservation', 'unpaid reservations')}`);
  if (i.cutOffsEarlier) {
    parts.push(`brings forward the last day to pay of ${n(i.cutOffsEarlier, 'unpaid reservation', 'unpaid reservations')}${i.cutOffsPassed
      ? ` (${i.cutOffsPassed} of them past it already: ${i.cutOffsPassed === 1 ? 'it expires' : 'they expire'} at once)` : ''}`);
  }
  if (!parts.length) return 'This changes nothing for families.';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `This ${list}.`;
}

// ─── Questions (D13) ─────────────────────────────────────────────────────────

export const QuestionInput = z.object({
  id: z.string().min(1).optional(),
  kind: QuestionKindSchema,
  prompt: z.string().trim().min(2).max(300),
  choices: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  required: z.boolean().default(false),
}).refine((q) => (q.kind === 'choice') === (q.choices.length > 0), { message: 'A choice question lists its choices; the others list none', path: ['choices'] });
export type QuestionInputType = z.infer<typeof QuestionInput>;

// ─── Sessions ────────────────────────────────────────────────────────────────

/** POST /sessions/:id/reopen, /close (a reason is optional and kept with the change). */
export const SessionReason = z.object({ reason: z.string().trim().max(500).optional() });

/** PUT /sessions/:id/prices-final: one-way once any line exists (E6). */
export const PricesFinal = z.object({
  final: z.boolean(),
  expected: ImpactSchema.optional(),
});
export type PricesFinalType = z.infer<typeof PricesFinal>;

/** GET /sessions/:id/preview — the family payload for a first-timer or a retaker (§5's live preview). */
export const SessionPreviewQuery = z.object({
  as: z.enum(['first_timer', 'retaker']).default('first_timer'),
  offeringId: z.string().min(1).optional(),
});
export type SessionPreviewQueryType = z.infer<typeof SessionPreviewQuery>;

/** GET /sessions/:id/reservations (+ ?format=csv). */
export const SessionReservationsQuery = z.object({ format: z.enum(['json', 'csv']).default('json') });

// ─── Offerings ───────────────────────────────────────────────────────────────

/** POST /sessions/:id/offerings: from the reference list, "not on the list", or a copy of another offering. */
export const AddOffering = z.union([
  z.object({ referenceCode: z.string().trim().min(1).max(40), board: BoardCodeInputSchema.optional() }),
  z.object({
    custom: z.object({
      board: BoardCodeInputSchema,
      name: z.string().trim().min(2).max(120),
      level: SubjectLevelSchema,
      group: SubjectGroupSchema,
      // Optional: a subject without a code is `X-<board>-<slug>`.
      code: z.string().trim().min(1).max(40).optional(),
    }),
  }),
  z.object({ copyFromOfferingId: z.string().min(1) }),
]);
export type AddOfferingType = z.infer<typeof AddOffering>;

/** D4: a teacher of an offering or a row — one from the school's list, or a new name (duplicate-checked). */
export const OfferingTeacherInput = z.union([
  z.object({ teacherId: z.string().min(1), online: z.boolean().default(false), external: z.boolean().default(false) }),
  z.object({
    newName: z.string().trim().min(2).max(120),
    online: z.boolean().default(false),
    external: z.boolean().default(false),
    // A name that looks like a teacher already on the list is refused until it is confirmed new.
    confirmNew: z.boolean().default(false),
  }),
]);
export type OfferingTeacherInputType = z.infer<typeof OfferingTeacherInput>;

/** D3: how a row is studied. */
export const CellsInput = z.object({
  firstInSchool: z.boolean(),
  retakeInSchool: z.boolean(),
  retakeSelfStudy: z.boolean(),
  firstSelfStudy: z.boolean().default(false),
});
export type CellsInputType = z.infer<typeof CellsInput>;

/** D6: a sitting a retake or an A.2. may carry from (the board's; created with no dates when not on record). */
export const PriorSittingInput = z.object({ month: SeriesMonthSchema, year: z.number().int().min(2000).max(2100) });

/** One row of an offering, as the subject editor saves it (the whole set: a row left out is removed or closed). */
export const OfferingRowInput = z.object({
  id: z.string().min(1).optional(),
  kind: RowKindSchema,
  // The reference row it comes from (its stable key); null for a custom row.
  referenceKey: z.string().trim().min(1).max(60).nullable().optional(),
  referenceCodes: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
  // A custom row's name (D2); every other row's label is generated.
  name: z.string().trim().min(1).max(120).optional(),
  sitting: SittingSchema.optional(),
  closesAt: z.coerce.date().nullable().optional(),
  payBy: z.coerce.date().nullable().optional(),
  examFee: Money.nullable().optional(),
  examFeeSource: RowFeeSourceSchema.nullable().optional(),
  // Null: the offering's course fee.
  courseFee: Money.nullable().optional(),
  // Null: the session's self-study share of the course fee.
  selfStudyFee: Money.nullable().optional(),
  cells: CellsInput,
  allowedPriorSittings: z.array(PriorSittingInput).max(12).optional(),
  // Null or empty: the offering's teachers.
  teachers: z.array(OfferingTeacherInput).max(10).nullable().optional(),
});
export type OfferingRowInputType = z.infer<typeof OfferingRowInput>;

/** PUT /sessions/:id/offerings/:offeringId — the subject editor (only what is sent changes). */
export const UpdateOffering = z.object({
  note: z.string().trim().max(1000).nullable().optional(),
  teacherChoice: TeacherChoiceSchema.optional(),
  teacherTbc: z.boolean().optional(),
  accepting: z.boolean().optional(),
  closesAt: z.coerce.date().nullable().optional(),
  courseFee: Money.nullable().optional(),
  teachers: z.array(OfferingTeacherInput).max(10).optional(),
  rows: z.array(OfferingRowInput).max(40).optional(),
  questions: z.array(QuestionInput).max(20).optional(),
  // Her "Looks right" on the check list: the pre-load's notes on the subject are reviewed (only then they leave it).
  notesReviewed: z.literal(true).optional(),
  // Her "Looks right" on the cells a default ticked: they are hers now (changing a row's cells does it for that row).
  defaultsReviewed: z.literal(true).optional(),
  expected: ImpactSchema.optional(),
});
export type UpdateOfferingType = z.infer<typeof UpdateOffering>;

export const OfferingParam = z.object({ id: z.string().min(1), offeringId: z.string().min(1) });
export const RowParam = z.object({ id: z.string().min(1), rowId: z.string().min(1) });

// ─── Teachers (D4) ───────────────────────────────────────────────────────────

/** GET /teachers/duplicates?name= — the school's teachers a new name may be (spelling and initials). */
export const TeacherDuplicatesQuery = z.object({ name: z.string().trim().min(2).max(120) });

// ─── Prices (E1–E7) ──────────────────────────────────────────────────────────

/** POST /sessions/:id/price-lists/parse — a board's list as printed (writes nothing). */
export const ParsePriceList = z.object({
  board: BoardCodeInputSchema,
  text: z.string().max(50_000),
});
export type ParsePriceListType = z.infer<typeof ParsePriceList>;

/** One printed line of a list, as parsed (the server matches it again). */
export const PriceListRowInput = z.object({
  lineNo: z.number().int().min(0).max(10_000).optional(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().max(200).default(''),
  amount: Money,
  // A line matched through an alias in doubt (the reference's toCheck) is applied only once she confirms it.
  confirmed: z.boolean().optional(),
});

/** POST /sessions/:id/price-lists — applied: matched rows take the amounts, unpaid lines re-priced. */
export const ApplyPriceList = z.object({
  board: BoardCodeInputSchema,
  name: z.string().trim().min(2).max(120),
  rows: z.array(PriceListRowInput).min(1).max(1000),
  expected: ImpactSchema.optional(),
});
export type ApplyPriceListType = z.infer<typeof ApplyPriceList>;

/** PUT /sessions/:id/rows/:rowId/exam-fee — typed, or filled by the board rule or the sum of its units. */
export const SetRowExamFee = z.union([
  z.object({ amount: Money, expected: ImpactSchema.optional() }),
  z.object({ source: z.enum(['units_sum', 'board_rule']), expected: ImpactSchema.optional() }),
]);
export type SetRowExamFeeType = z.infer<typeof SetRowExamFee>;

/**
 * PUT /reference/sittings/:id/board-date — C6's one exception: the admin enters, once, the board's entry
 * deadline of a sitting the reference data gives none (and its retake deadline, when the board has one).
 * Dates as the board prints them ('YYYY-MM-DD'): each is the end of that day in Cairo, as the reference
 * data's own dates are.
 */
export const EnterBoardDate = z.object({
  entryDeadline: DateOnlySchema,
  retakeDeadline: DateOnlySchema.nullable().optional(),
});
export type EnterBoardDateType = z.infer<typeof EnterBoardDate>;
export const SittingParam = z.object({ id: z.string().min(1) });

export const ReferenceSubjectsQuery = z.object({ board: BoardCodeInputSchema.optional() });

