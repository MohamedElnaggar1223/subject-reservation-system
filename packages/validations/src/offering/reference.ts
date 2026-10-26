/**
 * Reference data (COORDINATOR_REWORK.md §7, §7.1): the boards, their sittings and rules, and the
 * subjects the school offers with the rows each can be entered as. Kept in the repository as data
 * (`packages/db/reference/*.json`), maintained by us, read-only to staff; the June 2027 pre-load
 * (`packages/db/seeds/june-2027.json`, §8) is validated here too. P1a's loader reads every file
 * through these schemas; `pnpm --filter @repo/db reference:check` runs them over the files.
 *
 * Additions to §7.1's shape (each optional or derivable, so nothing in §7.1 changes meaning):
 * - a sitting's `levels`: the levels the board sits in that month. Pearson sits International A
 *   Levels in October and January and International GCSEs in November; the school's lists call
 *   the IAL October sitting "November" (FEATURES_PLAN.md §6, 2), so a winter row's "november"
 *   resolves to the board's autumn sitting whose levels include the subject's level.
 * - a sitting's `note`, a board's `note`, a row's `note`, an alias's `note`: why, in plain words.
 * - a row's `winterSitting`: the row's own default where the school splits a subject across
 *   November and January (IAL Biology units 1–2 November, 3–4 January); absent, the subject's.
 */

import { z } from 'zod';
import { CouncilSchema } from '../subject/subject.validations';
import { DateOnlySchema } from '../academic/structure.validations';
import { RefundPolicySchema, SessionTypeSchema } from '../session/session.validations';

// ─── Shared pieces ───────────────────────────────────────────────────────────

export const REFERENCE_BOARD_CODES = CouncilSchema.options;
export const ReferenceBoardCodeSchema = CouncilSchema;
export type ReferenceBoardCode = z.infer<typeof ReferenceBoardCodeSchema>;

/** The month a board sits: January, June, October (Pearson IAL), November. */
export const SittingMonthSchema = z.union([z.literal(1), z.literal(6), z.literal(10), z.literal(11)]);
export type SittingMonth = z.infer<typeof SittingMonthSchema>;

export const SittingYearSchema = z.number().int().min(2020).max(2100);

/** A sitting named by its month and year: { month: 6, year: 2026 } is June 2026. */
export const SittingRefSchema = z.object({ month: SittingMonthSchema, year: SittingYearSchema });
export type SittingRef = z.infer<typeof SittingRefSchema>;

/** The school's two tiers: O.L. (IGCSE, International GCSE, O Level) and A.S./A.L. */
export const REFERENCE_LEVELS = ['igcse', 'as_al'] as const;
export const ReferenceLevelSchema = z.enum(REFERENCE_LEVELS);
export type ReferenceLevel = z.infer<typeof ReferenceLevelSchema>;

export const REFERENCE_GROUPS = ['O.L.', 'A.S./A.L.'] as const;
export const ReferenceGroupSchema = z.enum(REFERENCE_GROUPS);
export type ReferenceGroup = z.infer<typeof ReferenceGroupSchema>;

/** The sitting a winter session's row sits in, in the school's words (D12). */
export const WinterSittingSchema = z.enum(['november', 'january']);
export type WinterSitting = z.infer<typeof WinterSittingSchema>;

/** What a row enters (D2). `custom` exists only on a session (her own row), never in reference data. */
export const REFERENCE_ROW_KINDS = ['all_papers', 'paper', 'unit', 'as', 'a2', 'al', 'qualification'] as const;
export const ReferenceRowKindSchema = z.enum(REFERENCE_ROW_KINDS);
export type ReferenceRowKind = z.infer<typeof ReferenceRowKindSchema>;

/** A stable key: lower-case letters, digits and hyphens ("all-papers", "paper-41-42", "wbi15"). */
export const ReferenceKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lower-case letters, digits and hyphens');

const nonEmpty = z.string().trim().min(1);

function addIssue(ctx: z.RefinementCtx, path: (string | number)[], message: string) {
  ctx.addIssue({ code: 'custom', message, path });
}

// ─── Boards (packages/db/reference/boards.json) ───────────────────────────────

/**
 * A board's sitting. `confirmed` means the entry deadline (and Cambridge's November retake
 * deadline) was read in the board's own published key dates, named in `source`; a date nobody
 * has published is null. Every date given comes from `source`, which may name several
 * documents separated by " ; ". A sitting a session uses needs its entry deadline before the
 * session opens (C6, §14): a null one blocks opening until the admin enters it once.
 */
export const BoardSittingSchema = z.object({
  month: SittingMonthSchema,
  year: SittingYearSchema,
  levels: z.array(ReferenceLevelSchema).min(1),
  entryDeadline: DateOnlySchema.nullable(),
  retakeDeadline: DateOnlySchema.nullable(),
  examsStart: DateOnlySchema.nullable(),
  source: nonEmpty,
  confirmed: z.boolean(),
  note: nonEmpty.optional(),
}).superRefine((s, ctx) => {
  if (s.confirmed && s.entryDeadline === null) addIssue(ctx, ['entryDeadline'], 'A confirmed sitting has its entry deadline');
  if (s.confirmed && !/https:\/\//.test(s.source)) addIssue(ctx, ['source'], 'A confirmed sitting names the board document it was read in');
  if (new Set(s.levels).size !== s.levels.length) addIssue(ctx, ['levels'], 'A level is listed once');
  if (s.entryDeadline && s.retakeDeadline && s.retakeDeadline < s.entryDeadline) addIssue(ctx, ['retakeDeadline'], 'The retake deadline is not before the entry deadline');
  if (s.entryDeadline && s.examsStart && s.examsStart <= s.entryDeadline) addIssue(ctx, ['examsStart'], 'Exams start after the entry deadline');
});
export type BoardSitting = z.infer<typeof BoardSittingSchema>;

/** A code a printed list or form uses that differs from the reference's (an old syllabus, a misprint). */
export const BoardAliasSchema = z.object({
  printed: nonEmpty,
  subject: nonEmpty,
  row: ReferenceKeySchema,
  note: nonEmpty.optional(),
});
export type BoardAlias = z.infer<typeof BoardAliasSchema>;

export const ReferenceBoardSchema = z.object({
  code: ReferenceBoardCodeSchema,
  name: nonEmpty,
  /** The exam fee of a one-paper row (E5): the syllabus's fee (Cambridge) or the paper's own list row (Edexcel). */
  onePaperFee: z.enum(['syllabus', 'paper']),
  /** Whether a one-paper retake names the earlier exam it carries from (D6). An A.2. always does. */
  onePaperAsksSitting: z.boolean(),
  /** How old a carried-from exam may be before the subject screen warns (D6); null when the board sets no limit. */
  carryForwardMonths: z.number().int().positive().nullable(),
  note: nonEmpty.optional(),
  sittings: z.array(BoardSittingSchema),
  aliases: z.array(BoardAliasSchema),
}).superRefine((b, ctx) => {
  const seen = new Set<string>();
  b.sittings.forEach((s, i) => {
    const k = `${s.year}-${s.month}`;
    if (seen.has(k)) addIssue(ctx, ['sittings', i], `${b.code} lists ${k} twice`);
    seen.add(k);
  });
  const printed = new Set<string>();
  b.aliases.forEach((a, i) => {
    const k = normalizePrintedCode(a.printed);
    if (printed.has(k)) addIssue(ctx, ['aliases', i], `${a.printed} is aliased twice`);
    printed.add(k);
  });
});
export type ReferenceBoard = z.infer<typeof ReferenceBoardSchema>;

export const BoardsFileSchema = z.array(ReferenceBoardSchema).superRefine((boards, ctx) => {
  const codes = new Set<string>();
  boards.forEach((b, i) => {
    if (codes.has(b.code)) addIssue(ctx, [i, 'code'], `${b.code} is listed twice`);
    codes.add(b.code);
  });
});
export type BoardsFile = z.infer<typeof BoardsFileSchema>;

// ─── Subjects (packages/db/reference/subjects/<board>.json) ───────────────────

export const ReferenceRowSchema = z.object({
  /** Stable across years: what a copied row and a price-list match refer to. */
  key: ReferenceKeySchema,
  kind: ReferenceRowKindSchema,
  /** The board codes the row enters ("0970", "0970/41", "WBI15", "YAA01"). */
  codes: z.array(nonEmpty).min(1),
  /** The codes a printed price list uses for the row ("0970 CX", "9700 S1", "WMA11", "4MA1H"). */
  priceCodes: z.array(nonEmpty),
  /** The row's own name for paper, unit and qualification rows ("Paper 41/42", "Unit 5", "P1", "International A Level"). */
  short: nonEmpty.optional(),
  /** The phrase families read for the row, as labels.ts generates it (the check holds them equal). */
  label: z.object({ en: nonEmpty, ar: nonEmpty }),
  /** Keys of the rows whose exam fees add up to this row's (§6: YAA01 = WAA01 + WAA02; 4MA1 = 1H + 2H). */
  sumOfUnits: z.array(ReferenceKeySchema).min(2).optional(),
  /** The row's default winter sitting where it differs from the subject's; null: not sat in winter. */
  winterSitting: WinterSittingSchema.nullable().optional(),
  note: nonEmpty.optional(),
}).superRefine((r, ctx) => {
  if ((r.kind === 'paper' || r.kind === 'unit' || r.kind === 'qualification') && !r.short) {
    addIssue(ctx, ['short'], `A ${r.kind} row has its own name (short)`);
  }
});
export type ReferenceRow = z.infer<typeof ReferenceRowSchema>;

export const ReferenceSubjectSchema = z.object({
  /** The board's code (an IAL subject: its International A Level award code), or X-<board>-<slug> when none is known. */
  code: nonEmpty,
  name: nonEmpty,
  group: ReferenceGroupSchema,
  level: ReferenceLevelSchema,
  /** The code is printed on one of the school's own artefacts (a fee list, a form, a links sheet); otherwise `note` says what is known. */
  confirmed: z.boolean(),
  note: nonEmpty.optional(),
  winterSitting: WinterSittingSchema.nullable(),
  rows: z.array(ReferenceRowSchema).min(1),
}).superRefine((s, ctx) => {
  if (!s.confirmed && !s.note) addIssue(ctx, ['note'], 'An unconfirmed subject says why in a note');
  if ((s.group === 'O.L.') !== (s.level === 'igcse')) addIssue(ctx, ['group'], 'O.L. goes with level igcse, A.S./A.L. with as_al');
  const byKey = new Map<string, ReferenceRow>();
  s.rows.forEach((r, i) => {
    if (byKey.has(r.key)) addIssue(ctx, ['rows', i, 'key'], `${s.code} has two rows keyed ${r.key}`);
    byKey.set(r.key, r);
  });
  s.rows.forEach((r, i) => {
    for (const k of r.sumOfUnits ?? []) {
      const part = byKey.get(k);
      if (!part) addIssue(ctx, ['rows', i, 'sumOfUnits'], `${s.code}/${r.key} sums ${k}, which is not a row of the subject`);
      else if (part.sumOfUnits) addIssue(ctx, ['rows', i, 'sumOfUnits'], `${s.code}/${r.key} sums ${k}, itself a sum`);
    }
  });
  if (s.rows.filter((r) => r.kind === 'all_papers').length > 1) addIssue(ctx, ['rows'], 'One all-papers row at most');
});
export type ReferenceSubject = z.infer<typeof ReferenceSubjectSchema>;

export const SubjectsFileSchema = z.array(ReferenceSubjectSchema).superRefine((subjects, ctx) => {
  const codes = new Set<string>();
  subjects.forEach((s, i) => {
    if (codes.has(s.code)) addIssue(ctx, [i, 'code'], `${s.code} is listed twice`);
    codes.add(s.code);
  });
});
export type SubjectsFile = z.infer<typeof SubjectsFileSchema>;

// ─── Printed codes: how a pasted list row finds its reference row (E2) ────────

/** "9700  s1 / s2" → "9700 S1/S2": upper case, single spaces, no space around a slash. */
export function normalizePrintedCode(printed: string): string {
  return printed.toUpperCase().replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/').trim();
}

/**
 * The forms of a printed code to look up: itself, and for a Cambridge option pair ("9700 S1 / S2")
 * each option on its own ("9700 S1", "9700 S2").
 */
export function printedCodeCandidates(printed: string): string[] {
  const n = normalizePrintedCode(printed);
  const out = [n];
  const m = /^(\S+) (\S+(?:\/\S+)+)$/.exec(n);
  if (m) for (const opt of m[2]!.split('/')) out.push(`${m[1]} ${opt}`);
  return out;
}

export type PrintedCodeMatch = { subject: string; row: string; via: 'priceCode' | 'alias' };

/**
 * Every reference row a printed code reaches through the rows' priceCodes and the board's aliases.
 * A well-formed reference gives exactly one; the check holds every row of the school's fee lists to it.
 */
export function matchPrintedCode(printed: string, board: Pick<ReferenceBoard, 'aliases'>, subjects: SubjectsFile): PrintedCodeMatch[] {
  const wanted = new Set(printedCodeCandidates(printed));
  const found = new Map<string, PrintedCodeMatch>();
  for (const s of subjects) {
    for (const r of s.rows) {
      if (r.priceCodes.some((c) => wanted.has(normalizePrintedCode(c)))) found.set(`${s.code}/${r.key}`, { subject: s.code, row: r.key, via: 'priceCode' });
    }
  }
  for (const a of board.aliases) {
    if (wanted.has(normalizePrintedCode(a.printed)) && !found.has(`${a.subject}/${a.row}`)) {
      found.set(`${a.subject}/${a.row}`, { subject: a.subject, row: a.row, via: 'alias' });
    }
  }
  return [...found.values()];
}

// ─── The June 2027 pre-load (packages/db/seeds/june-2027.json) ────────────────

/** A placeholder for a teacher's name; the names live in the git-ignored local file. */
export const TeacherKeySchema = z.string().regex(/^T-[A-Z0-9]+(?:-[A-Z0-9]+)*$/, 'A teacher placeholder looks like T-ARABIC-OL-1');

export const SeedTeacherSchema = z.object({
  key: TeacherKeySchema,
  online: z.boolean(),
  external: z.boolean(),
});
export type SeedTeacher = z.infer<typeof SeedTeacherSchema>;

/** The four columns of D3: first entry in school, retake in school, retake self study, first entry self study. */
export const CELL_NAMES = ['firstInSchool', 'retakeInSchool', 'retakeSelfStudy', 'firstSelfStudy'] as const;
export const CellNameSchema = z.enum(CELL_NAMES);
export type CellName = z.infer<typeof CellNameSchema>;

export const SeedCellsSchema = z.object({
  firstInSchool: z.boolean(),
  retakeInSchool: z.boolean(),
  retakeSelfStudy: z.boolean(),
  firstSelfStudy: z.boolean(),
});
export type SeedCells = z.infer<typeof SeedCellsSchema>;

/** Where an exam fee comes from (§9.1 `exam_fee_source`). */
export const ExamFeeSourceSchema = z.enum(['list', 'typed', 'units_sum', 'board_rule']);
export type ExamFeeSource = z.infer<typeof ExamFeeSourceSchema>;

export const SeedRowSchema = z.object({
  key: ReferenceKeySchema,
  cells: SeedCellsSchema,
  /** Cells ticked by a §3 default rather than read on the form (Q10's RI*). */
  cellsByDefault: z.array(CellNameSchema),
  /** EGP; null: not set (distinct from 0, E1). */
  examFee: z.number().int().nonnegative().nullable(),
  examFeeSource: ExamFeeSourceSchema.nullable(),
  /** The school's fee list the figure was read on ("Cambridge June 2026"), with the board rule or the sum applied. */
  examFeeList: nonEmpty.nullable(),
  /** The row's own course fee (E3), EGP; null: the offering's. Not set in the June 2027 pre-load (Q1). */
  courseFee: z.number().int().nonnegative().nullable(),
  /** The earlier exams a retake carries from (D6), when the row asks; null when it does not. */
  allowedPriorSittings: z.array(SittingRefSchema).nullable(),
  /** A row's own teachers (IAL Mathematics units, Arabic A.L. qualifications); absent: the offering's. */
  teachers: z.array(SeedTeacherSchema).optional(),
}).superRefine((r, ctx) => {
  if (!Object.values(r.cells).some(Boolean)) addIssue(ctx, ['cells'], 'A row offers at least one column');
  for (const c of r.cellsByDefault) if (!r.cells[c]) addIssue(ctx, ['cellsByDefault'], `${c} is a default to tick, so it is ticked`);
  if ((r.examFee === null) !== (r.examFeeSource === null)) addIssue(ctx, ['examFeeSource'], 'A fee has a source; no fee, no source');
  if ((r.examFee === null) !== (r.examFeeList === null)) addIssue(ctx, ['examFeeList'], 'A fee names its list; no fee, no list');
});
export type SeedRow = z.infer<typeof SeedRowSchema>;

export const SeedOfferingSchema = z.object({
  /** §8's number: the order families and the coordinator see (D10). */
  order: z.number().int().positive(),
  board: ReferenceBoardCodeSchema,
  subject: nonEmpty,
  teachers: z.array(SeedTeacherSchema),
  /** "Teacher to be confirmed" (D4): families read "teacher to be announced". */
  teacherTbc: z.boolean(),
  teacherChoice: z.enum(['families', 'school']),
  /** The optional family note per subject (D9); no form carries one. */
  note: nonEmpty.nullable(),
  /** The subject's course fee (E3), EGP; null: not set (distinct from 0). Not set in the June 2027 pre-load (Q1). */
  courseFee: z.number().int().nonnegative().nullable(),
  rows: z.array(SeedRowSchema).min(1),
  /** §8's flags for the check list; names appear only as {T-…} placeholders. */
  flags: z.array(nonEmpty),
}).superRefine((o, ctx) => {
  const keys = new Set<string>();
  o.rows.forEach((r, i) => {
    if (keys.has(r.key)) addIssue(ctx, ['rows', i, 'key'], `${o.subject} lists row ${r.key} twice`);
    keys.add(r.key);
  });
  const own = new Set(o.teachers.map((t) => t.key));
  if (own.size !== o.teachers.length) addIssue(ctx, ['teachers'], 'A teacher is listed once');
  o.rows.forEach((r, i) => (r.teachers ?? []).forEach((t, j) => {
    if (!own.has(t.key)) addIssue(ctx, ['rows', i, 'teachers', j], `${t.key} teaches a row but is not one of the subject's teachers`);
  }));
  if (o.teacherTbc && o.teachers.length > 0) addIssue(ctx, ['teacherTbc'], 'A teacher to be confirmed means none is named yet');
});
export type SeedOffering = z.infer<typeof SeedOfferingSchema>;

export const SeedSessionSchema = z.object({
  type: SessionTypeSchema,
  year: SittingYearSchema,
  refundPolicy: RefundPolicySchema,
  /** The session's self-study share of the course fee (E4), in percent. */
  selfStudyPercent: z.number().int().min(0).max(100),
  /** C5's dates; none is on a form, so the June 2027 pre-load leaves all three to the coordinator (§8). */
  closesAt: DateOnlySchema.nullable(),
  paymentDueAt: DateOnlySchema.nullable(),
  courseStartsOn: DateOnlySchema.nullable(),
});
export type SeedSession = z.infer<typeof SeedSessionSchema>;

export const SessionSeedFileSchema = z.object({
  session: SeedSessionSchema,
  offerings: z.array(SeedOfferingSchema).min(1),
}).superRefine((f, ctx) => {
  f.offerings.forEach((o, i) => {
    if (o.order !== i + 1) addIssue(ctx, ['offerings', i, 'order'], `Offering ${i + 1} is numbered ${o.order}`);
  });
  const subjects = new Set<string>();
  f.offerings.forEach((o, i) => {
    const k = `${o.board}/${o.subject}`;
    if (subjects.has(k)) addIssue(ctx, ['offerings', i, 'subject'], `${k} is offered twice`);
    subjects.add(k);
  });
});
export type SessionSeedFile = z.infer<typeof SessionSeedFileSchema>;

/** `packages/db/seeds/local/<session>.teachers.json`: placeholder key → the name on the form (git-ignored). */
export const LocalTeachersFileSchema = z.record(TeacherKeySchema, nonEmpty);
export type LocalTeachersFile = z.infer<typeof LocalTeachersFileSchema>;
