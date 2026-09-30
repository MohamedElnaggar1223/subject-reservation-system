/**
 * The exam catalogue (FEATURES_PLAN.md F0b; DISCOVERY_RESEARCH.md §5 notes
 * 2–4; IMPORT_SPIKE.md IS-01).
 *
 * Four things the old model folded into one subject row, kept apart:
 *
 * - a **board** (Pearson Edexcel, Cambridge International, OxfordAQA) and the
 *   series months it sits;
 * - a **qualification** — the award a board issues: a Pearson cash-in code
 *   (XMA01 AS Mathematics, YMA01 A Level Mathematics), a Cambridge syllabus
 *   (9700 Biology, 0610 IGCSE Biology), an International GCSE (4BI1);
 * - a **unit or component** — what a candidate sits: a Pearson W unit
 *   (WMA11, "P1: Pure Mathematics 1") or a Cambridge component (9700 paper
 *   1), each with its **own level** (AS, A2, or IGCSE);
 * - the **unit-to-award map**: which units count toward which awards, and
 *   whether each is required or one of a choice (AS Mathematics = P1 + P2 +
 *   one of M1, S1, D1). Cambridge option codes name the component sets a
 *   syllabus can be entered with.
 *
 * A registrable row (the `subject` table: what families register and pay
 * for) enters either a whole qualification or a set of units — "P1",
 * "Biology (Paper 1 & Paper 2)". The school's level codes ("A.S./A.2.") are
 * never stored: they are derived from the unit's own level, the awards it
 * counts toward and the student's year (level-code.ts).
 *
 * Which board a subject or unit is entered with is the coordinator's answer
 * (IMPORT_SPIKE.md §3, owner decision 3: postponed), so it is data staff
 * edit here, not code. Input types only (PATTERNS.md).
 */

import { z } from 'zod';
import { CouncilSchema, QualificationLevelSchema } from '../subject/subject.validations';
import { SessionTypeSchema } from '../session/session.validations';

// ─── Boards ──────────────────────────────────────────────────────────────────

/**
 * The boards the school can enter with. Their codes are the subject table's
 * `council` values; the board rows (names, portals, the months each sits)
 * are data the coordinator edits.
 */
export const BOARD_CODES = CouncilSchema.options;
export const BoardCodeSchema = CouncilSchema;
export type BoardCode = z.infer<typeof BoardCodeSchema>;

export const BoardCodeParam = z.object({ code: BoardCodeSchema });

export const UpdateBoard = z.object({
  name: z.string().trim().min(1, 'A board needs a name').max(100).optional(),
  shortName: z.string().trim().min(1).max(40).optional(),
  entryPortal: z.string().trim().max(100).nullable().optional(),
  /** The months the board runs series in (research, DISCOVERY_RESEARCH.md §2). */
  seriesMonths: z.array(SessionTypeSchema).min(1, 'A board sits at least one series a year').max(4)
    .refine((m) => new Set(m).size === m.length, 'Each month once')
    .optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateBoardType = z.infer<typeof UpdateBoard>;

// ─── Qualifications (awards) ─────────────────────────────────────────────────

/**
 * How the board takes an entry for the qualification:
 * - `qualification`   the code itself (an IGCSE, an International GCSE)
 * - `units_cash_in`   units (W codes) plus a cash-in for the award (X/Y codes) — Pearson IAL
 * - `syllabus_option` the syllabus with an option code naming its components — Cambridge
 */
export const ENTRY_METHODS = ['qualification', 'units_cash_in', 'syllabus_option'] as const;
export const EntryMethodSchema = z.enum(ENTRY_METHODS);
export type EntryMethod = z.infer<typeof EntryMethodSchema>;

export const ENTRY_METHOD_LABELS: Record<EntryMethod, string> = {
  qualification: 'Entered by its code',
  units_cash_in: 'Units, then a cash-in for the award',
  syllabus_option: 'Syllabus with an option code',
};

/**
 * A tier where the syllabus fixes it: Cambridge IGCSE Core or Extended
 * (Paper 2 is Extended, Paper 1 Core), Pearson International GCSE Foundation
 * or Higher. Egypt's equivalency (Mo'adala) requires Extended, so F5 reads
 * it; F4 records the tier and the option code per entry. Null: the
 * candidate's components or option decide it.
 */
export const TIERS = ['core', 'extended', 'foundation', 'higher'] as const;
export const TierSchema = z.enum(TIERS);
export type Tier = z.infer<typeof TierSchema>;

export const TIER_LABELS: Record<Tier, string> = {
  core: 'Core',
  extended: 'Extended',
  foundation: 'Foundation',
  higher: 'Higher',
};

const code = (what: string) =>
  z.string().trim().min(1, `A ${what} needs a code`).max(20, 'Codes are short (at most 20 characters)')
    .transform((s) => s.toUpperCase());

export const CreateQualification = z.object({
  boardCode: BoardCodeSchema,
  code: code('qualification'),
  title: z.string().trim().min(1, 'A qualification needs a title').max(200),
  level: QualificationLevelSchema,
  /** "International A Level", "International GCSE", "Cambridge IGCSE", "O Level"… */
  suite: z.string().trim().max(100).default(''),
  /** The subject it is in ("Mathematics"): AS and A Level of one subject share it (F5 counts them once). */
  subjectArea: z.string().trim().min(1, 'Name the subject it is in').max(100),
  entryMethod: EntryMethodSchema,
  tier: TierSchema.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type CreateQualificationType = z.infer<typeof CreateQualification>;

export const UpdateQualification = z.object({
  code: code('qualification').optional(),
  title: z.string().trim().min(1).max(200).optional(),
  level: QualificationLevelSchema.optional(),
  suite: z.string().trim().max(100).optional(),
  subjectArea: z.string().trim().min(1).max(100).optional(),
  entryMethod: EntryMethodSchema.optional(),
  tier: TierSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateQualificationType = z.infer<typeof UpdateQualification>;

// ─── Units and components ────────────────────────────────────────────────────

/**
 * A unit's own level (IS-01): AS or A2 for an A-Level unit, IGCSE for an
 * IGCSE or O Level component. Never the student's year, never the awards it
 * counts toward — those are kept apart, and the school's "A.S./A.2." is
 * derived from the three.
 */
export const UNIT_LEVELS = ['igcse', 'as', 'a2'] as const;
export const UnitLevelSchema = z.enum(UNIT_LEVELS);
export type UnitLevel = z.infer<typeof UnitLevelSchema>;

export const UNIT_LEVEL_LABELS: Record<UnitLevel, string> = {
  igcse: 'IGCSE / O Level',
  as: 'AS',
  a2: 'A2',
};

/** A Pearson W unit, or a Cambridge component (a paper). */
export const UNIT_KINDS = ['unit', 'component'] as const;
export const UnitKindSchema = z.enum(UNIT_KINDS);
export type UnitKind = z.infer<typeof UnitKindSchema>;

export const CreateUnit = z.object({
  boardCode: BoardCodeSchema,
  code: code('unit'),
  /** What the school calls it: "P1", "M1", "Paper 3". */
  shortCode: z.string().trim().max(20).nullable().optional(),
  title: z.string().trim().min(1, 'A unit needs a title').max(200),
  unitLevel: UnitLevelSchema,
  kind: UnitKindSchema,
  tier: TierSchema.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type CreateUnitType = z.infer<typeof CreateUnit>;

export const UpdateUnit = z.object({
  code: code('unit').optional(),
  shortCode: z.string().trim().max(20).nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  unitLevel: UnitLevelSchema.optional(),
  kind: UnitKindSchema.optional(),
  tier: TierSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateUnitType = z.infer<typeof UpdateUnit>;

// ─── The unit-to-award map ───────────────────────────────────────────────────

export const UNIT_REQUIREMENTS = ['required', 'optional'] as const;
export const UnitRequirementSchema = z.enum(UNIT_REQUIREMENTS);
export type UnitRequirement = z.infer<typeof UnitRequirementSchema>;

/**
 * The whole set of units an award counts, replacing what was there: the
 * coordinator edits an award's units in one go (AS Mathematics: P1 and P2
 * required, one of M1, S1, D1 in the group "Applied").
 */
export const SetQualificationUnits = z.object({
  units: z
    .array(z.object({
      unitId: z.string().min(1),
      requirement: UnitRequirementSchema,
      /** Units one must choose from ("Applied: one of M1, S1, D1"); null for none. */
      choiceGroup: z.string().trim().max(100).nullable().optional(),
    }))
    .max(40, 'An award counts at most 40 units')
    .refine((u) => new Set(u.map((x) => x.unitId)).size === u.length, 'Each unit once'),
});
export type SetQualificationUnitsType = z.infer<typeof SetQualificationUnits>;

// ─── Cambridge option codes ──────────────────────────────────────────────────

export const CreateQualificationOption = z.object({
  code: z.string().trim().min(1, 'An option needs its code').max(10).transform((s) => s.toUpperCase()),
  label: z.string().trim().min(1, 'Say what the option enters').max(200),
  /** The components the option enters. */
  unitIds: z.array(z.string().min(1)).max(20).refine((u) => new Set(u).size === u.length, 'Each component once'),
  /** A carry-forward option: marks from an earlier series count (Cambridge; DISCOVERY.md Q-02). */
  carryForward: z.boolean().default(false),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type CreateQualificationOptionType = z.infer<typeof CreateQualificationOption>;

export const UpdateQualificationOption = z.object({
  code: z.string().trim().min(1).max(10).transform((s) => s.toUpperCase()).optional(),
  label: z.string().trim().min(1).max(200).optional(),
  unitIds: z.array(z.string().min(1)).max(20).refine((u) => new Set(u).size === u.length, 'Each component once').optional(),
  carryForward: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateQualificationOptionType = z.infer<typeof UpdateQualificationOption>;

// ─── Registrable rows ────────────────────────────────────────────────────────

/**
 * What a registrable row (a subject families register for) enters with the
 * board: a whole qualification, or a set of units (a unit or a paper set).
 * Setting the board here is how the coordinator's answer — which board each
 * subject and unit is entered with — is recorded. Changing the board of a
 * row with registrations moves them to the window's series of the new board
 * (or is refused, naming what stops it).
 */
export const MapRegistrable = z
  .object({
    boardCode: BoardCodeSchema,
    /** The award the row enters or counts toward; null when it is only units. */
    qualificationId: z.string().min(1).nullable(),
    /** The units it enters; empty for a whole-qualification entry. */
    unitIds: z.array(z.string().min(1)).max(12).refine((u) => new Set(u).size === u.length, 'Each unit once'),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.qualificationId !== null || d.unitIds.length > 0, {
    message: 'Choose the qualification it enters, or its units',
    path: ['unitIds'],
  });
export type MapRegistrableType = z.infer<typeof MapRegistrable>;

export const SubjectIdParam = z.object({ subjectId: z.string().min(1) });

// ─── Starter sets ────────────────────────────────────────────────────────────

/**
 * Reference data the research confirmed (DISCOVERY_RESEARCH.md §1–2; [P1],
 * [P4], [P6]): the Pearson IAL Mathematics and Biology units and awards the
 * school's sheet points to. Loading one adds what is missing and changes
 * nothing already there; staff check it against the board's current
 * specification.
 */
export const STARTER_SETS = ['pearson_ial_mathematics', 'pearson_ial_biology'] as const;
export const StarterSetSchema = z.enum(STARTER_SETS);
export type StarterSet = z.infer<typeof StarterSetSchema>;

export const LoadStarterSet = z.object({ set: StarterSetSchema });
export type LoadStarterSetType = z.infer<typeof LoadStarterSet>;

export const STARTER_SET_LABELS: Record<StarterSet, string> = {
  pearson_ial_mathematics: 'Pearson IAL Mathematics (P1–P4, M1, M2, S1, S2, D1; AS and A Level)',
  pearson_ial_biology: 'Pearson IAL Biology (Units 1–6; AS and A Level)',
};

type StarterUnit = { code: string; shortCode: string; title: string; unitLevel: UnitLevel };
type StarterAward = {
  code: string; title: string; level: 'as_level' | 'a_level'; subjectArea: string;
  units: { code: string; requirement: UnitRequirement; choiceGroup?: string }[];
};

export const STARTER_SET_DATA: Record<StarterSet, { boardCode: BoardCode; suite: string; units: StarterUnit[]; awards: StarterAward[] }> = {
  pearson_ial_mathematics: {
    boardCode: 'pearson_edexcel',
    suite: 'International A Level',
    units: [
      { code: 'WMA11', shortCode: 'P1', title: 'Pure Mathematics 1', unitLevel: 'as' },
      { code: 'WMA12', shortCode: 'P2', title: 'Pure Mathematics 2', unitLevel: 'as' },
      { code: 'WMA13', shortCode: 'P3', title: 'Pure Mathematics 3', unitLevel: 'a2' },
      { code: 'WMA14', shortCode: 'P4', title: 'Pure Mathematics 4', unitLevel: 'a2' },
      { code: 'WME01', shortCode: 'M1', title: 'Mechanics 1', unitLevel: 'as' },
      { code: 'WME02', shortCode: 'M2', title: 'Mechanics 2', unitLevel: 'a2' },
      { code: 'WST01', shortCode: 'S1', title: 'Statistics 1', unitLevel: 'as' },
      { code: 'WST02', shortCode: 'S2', title: 'Statistics 2', unitLevel: 'a2' },
      { code: 'WDM11', shortCode: 'D1', title: 'Decision Mathematics 1', unitLevel: 'as' },
    ],
    awards: [
      {
        code: 'XMA01', title: 'Mathematics (AS)', level: 'as_level', subjectArea: 'Mathematics',
        units: [
          { code: 'WMA11', requirement: 'required' },
          { code: 'WMA12', requirement: 'required' },
          { code: 'WME01', requirement: 'optional', choiceGroup: 'Applied: one of M1, S1, D1' },
          { code: 'WST01', requirement: 'optional', choiceGroup: 'Applied: one of M1, S1, D1' },
          { code: 'WDM11', requirement: 'optional', choiceGroup: 'Applied: one of M1, S1, D1' },
        ],
      },
      {
        code: 'YMA01', title: 'Mathematics (A Level)', level: 'a_level', subjectArea: 'Mathematics',
        units: [
          { code: 'WMA11', requirement: 'required' },
          { code: 'WMA12', requirement: 'required' },
          { code: 'WMA13', requirement: 'required' },
          { code: 'WMA14', requirement: 'required' },
          { code: 'WME01', requirement: 'optional', choiceGroup: 'Applied: a permitted pair' },
          { code: 'WME02', requirement: 'optional', choiceGroup: 'Applied: a permitted pair' },
          { code: 'WST01', requirement: 'optional', choiceGroup: 'Applied: a permitted pair' },
          { code: 'WST02', requirement: 'optional', choiceGroup: 'Applied: a permitted pair' },
          { code: 'WDM11', requirement: 'optional', choiceGroup: 'Applied: a permitted pair' },
        ],
      },
    ],
  },
  pearson_ial_biology: {
    boardCode: 'pearson_edexcel',
    suite: 'International A Level',
    units: [
      { code: 'WBI11', shortCode: 'Unit 1', title: 'Molecules, Diet, Transport and Health', unitLevel: 'as' },
      { code: 'WBI12', shortCode: 'Unit 2', title: 'Cells, Development, Biodiversity and Conservation', unitLevel: 'as' },
      { code: 'WBI13', shortCode: 'Unit 3', title: 'Practical Skills in Biology I', unitLevel: 'as' },
      { code: 'WBI14', shortCode: 'Unit 4', title: 'Energy, Environment, Microbiology and Immunity', unitLevel: 'a2' },
      { code: 'WBI15', shortCode: 'Unit 5', title: 'Respiration, Internal Environment, Coordination and Gene Technology', unitLevel: 'a2' },
      { code: 'WBI16', shortCode: 'Unit 6', title: 'Practical Skills in Biology II', unitLevel: 'a2' },
    ],
    awards: [
      {
        code: 'XBI11', title: 'Biology (AS)', level: 'as_level', subjectArea: 'Biology',
        units: ['WBI11', 'WBI12', 'WBI13'].map((c) => ({ code: c, requirement: 'required' as const })),
      },
      {
        code: 'YBI11', title: 'Biology (A Level)', level: 'a_level', subjectArea: 'Biology',
        units: ['WBI11', 'WBI12', 'WBI13', 'WBI14', 'WBI15', 'WBI16'].map((c) => ({ code: c, requirement: 'required' as const })),
      },
    ],
  },
};
