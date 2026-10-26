/**
 * Registration sessions (RESERVATIONS_REWORK.md §3.1; docs/features/RESERVATIONS.md §1.1).
 *
 * A session is one registration cycle of the school: its type and year make it, its name is
 * derived, and its offers (the links sheet: subjects, teachers, items, fees) are its content.
 *
 * - `june` feeds the June series of every board; `winter` feeds the boards' October and
 *   November of its year and January of the next. The series year is the June year, or the
 *   winter's November year, so a session's academic year is its series' (F0a).
 * - When families may reserve is the session's start and end; the cut-off for what can be
 *   entered is per item, at its series' deadline (§3.3).
 * - A converted window keeps a label (its old type and level); new sessions have none.
 */

import { z } from 'zod';
import { SeriesYearSchema } from '../academic/academic-year';
import { DateOnlySchema } from '../academic/structure.validations';

export const SESSION_TYPES = {
  JUNE: 'june',
  WINTER: 'winter',
} as const;

export const SessionTypeSchema = z.enum([SESSION_TYPES.JUNE, SESSION_TYPES.WINTER]);
export type SessionType = z.infer<typeof SessionTypeSchema>;

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  june: 'June',
  winter: 'Winter (November – January)',
};

/** The months a board sits a series in (a board series' month). */
export const SERIES_MONTHS = ['january', 'june', 'october', 'november'] as const;
export const SeriesMonthSchema = z.enum(SERIES_MONTHS);
export type SeriesMonth = z.infer<typeof SeriesMonthSchema>;

export const SERIES_MONTH_LABELS: Record<SeriesMonth, string> = {
  january: 'January',
  june: 'June',
  october: 'October',
  november: 'November',
};

/** The months a session of a type feeds, with their years. */
export function sessionSeriesMonths(type: string, year: number): { month: SeriesMonth; year: number }[] {
  if (type === 'winter') {
    return [{ month: 'october', year }, { month: 'november', year }, { month: 'january', year: year + 1 }];
  }
  return [{ month: 'june', year }];
}

/**
 * IGCSE sits neither October nor January (F0b's rule; Pearson's last January International GCSE
 * series was 2023, DISCOVERY_RESEARCH.md): checked per item, so one winter session holds IGCSE
 * November items and IAL October and January items.
 */
export const IGCSE_NEVER_MONTHS: readonly SeriesMonth[] = ['october', 'january'];
export const IGCSE_NEVER_MESSAGE = 'IGCSE sits neither October nor January: an IGCSE item is entered in a June or November series';

/**
 * The months a board sits a unit of a units-cash-in award (a Pearson International A Level's units, which
 * the family's form lists one by one): October, January and June — the lead's decision of 16 Oct 2026
 * (FEATURES_PLAN.md §6, 2; the school's forms say "November" loosely). A winter session's form offers such
 * a unit October and January; an IGCSE subject keeps every month its board sits.
 */
export const IAL_UNIT_MONTHS: readonly SeriesMonth[] = ['october', 'january', 'june'];

const LEVEL_WORDS: Record<string, string> = { igcse: 'IGCSE', as_level: 'AS', a_level: 'A Level' };

/** How a session's label reads: "IGCSE" for a converted June IGCSE window, "October AS" for an October AS one. */
export function sessionLabelText(type: string, label: string): string {
  if (!label) return '';
  const m = /^(june|october|november|january)-(igcse|as_level|a_level)$/.exec(label);
  if (!m) return label;
  const [, oldType, level] = m as unknown as [string, string, string];
  const typeWord = oldType === type ? null : oldType.charAt(0).toUpperCase() + oldType.slice(1);
  return [typeWord, LEVEL_WORDS[level]].filter(Boolean).join(' ');
}

/**
 * A session's name, from its type, year and label: "June 2027", "November 2026 – January 2027",
 * "June 2027 — IGCSE". The database says the same (school_session_name, migration 0042).
 */
export function deriveSessionName(type: string, year: number, label = ''): string {
  const base = type === 'winter' ? `November ${year} – January ${year + 1}` : `June ${year}`;
  return label ? `${base} — ${sessionLabelText(type, label)}` : base;
}

// ─── Refund policy (§3.1) ────────────────────────────────────────────────────

/**
 * Steps in weeks from the course start: "100% within 2 weeks, 50% in week 3, 0% from week 4" is
 * `[{ throughWeek: 2, percent: 100 }, { throughWeek: 3, percent: 50 }, { throughWeek: null, percent: 0 }]`.
 * The last step has no end. The percentage applies to the course fee (Q-19; C's refundFor).
 */
export const RefundPolicyStepSchema = z.object({
  throughWeek: z.number().int().min(1).max(104).nullable(),
  percent: z.number().min(0).max(100),
});
export const RefundPolicySchema = z.object({
  steps: z.array(RefundPolicyStepSchema).min(1).max(10),
}).superRefine((p, ctx) => {
  const last = p.steps[p.steps.length - 1];
  if (!last || last.throughWeek !== null) ctx.addIssue({ code: 'custom', message: 'The last step runs to the end (no week)', path: ['steps'] });
  let prev = 0;
  for (const [i, s] of p.steps.entries()) {
    if (i < p.steps.length - 1) {
      if (s.throughWeek === null) ctx.addIssue({ code: 'custom', message: 'Only the last step runs to the end', path: ['steps', i] });
      else if (s.throughWeek <= prev) ctx.addIssue({ code: 'custom', message: 'Each step ends after the one before it', path: ['steps', i] });
      else prev = s.throughWeek;
    }
  }
});
export type RefundPolicy = z.infer<typeof RefundPolicySchema>;

/** The forms' policies (SCHOOL_FORMS.md §2.1): the defaults of the settings refund.defaultPolicy.*. */
export const DEFAULT_REFUND_POLICIES: Record<SessionType, RefundPolicy> = {
  june: { steps: [{ throughWeek: 2, percent: 100 }, { throughWeek: 3, percent: 50 }, { throughWeek: null, percent: 0 }] },
  winter: { steps: [{ throughWeek: 2, percent: 100 }, { throughWeek: 6, percent: 50 }, { throughWeek: null, percent: 0 }] },
};

/** "100% to week 2 · 50% in week 3 · 0% from week 4". */
export function refundPolicySentence(p: RefundPolicy): string {
  let from = 1;
  return p.steps.map((s) => {
    const part = s.throughWeek === null
      ? `${s.percent}% from week ${from}`
      : s.throughWeek === from ? `${s.percent}% in week ${from}` : from === 1 ? `${s.percent}% to week ${s.throughWeek}` : `${s.percent}% in weeks ${from}–${s.throughWeek}`;
    if (s.throughWeek !== null) from = s.throughWeek + 1;
    return part;
  }).join(' · ');
}

/**
 * The refund steps a line's snapshot freezes at consent (B writes it): weeks for a session with a
 * policy; the absolute windows of a converted session with none.
 */
export type RefundPolicySnapshot =
  | { kind: 'weeks'; steps: RefundPolicy['steps'] }
  | { kind: 'dates'; windows: { startsAt: string; endsAt: string; percent: number }[] };

// ─── Statuses ────────────────────────────────────────────────────────────────

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

export const SessionId = z.object({
  id: z.string().min(1, 'Session ID is required'),
});
export type SessionIdType = z.infer<typeof SessionId>;

// ─── Create and change ──────────────────────────────────────────────────────

/**
 * A new session (the coordinator rework, COORDINATOR_REWORK.md C1–C3, Appendix A): a type, a year,
 * and where it starts from — `copyFromSessionId` copies that session whole with its years moved
 * forward (C3), else it starts empty. The name is derived and never typed; it is born a draft.
 *
 * Deprecated, until P2 replaces the old screen and P1b adapts the suites: the legacy contract — a
 * `startDate` (with `endDate`, `courseStartsOn`, `paymentDueAt`) makes the session the old way
 * (open at once when its start has passed; `copyFromSessionId` then copies the offers only, with
 * their board fees provisional). `label` (a second cycle of one type and year; a converted
 * window's) is kept for both.
 */
export const CreateSession = z
  .object({
    type: SessionTypeSchema,
    // The June year, or the winter's November year.
    year: SeriesYearSchema,
    copyFromSessionId: z.string().min(1).optional(),
    // Rare: a second cycle of the same type and year. The screen does not ask.
    label: z.string().trim().max(40).default(''),
    /** @deprecated the legacy contract (see above). */
    startDate: z.coerce.date().optional(),
    /** @deprecated the legacy contract: the automatic close. */
    endDate: z.coerce.date().optional(),
    /** @deprecated the legacy contract: the cycle's first lesson (the refund anchor). */
    courseStartsOn: DateOnlySchema.optional(),
    /** @deprecated the legacy contract: when every line is due unless an exception says otherwise. */
    paymentDueAt: z.coerce.date().optional(),
  })
  .refine((d) => !d.startDate || (!!d.endDate && !!d.courseStartsOn && !!d.paymentDueAt), {
    message: 'The legacy contract names its end, course start and payment due date with its start', path: ['startDate'],
  })
  .refine((d) => !(d.startDate && d.endDate) || d.endDate > d.startDate, { message: 'End date must be after start date', path: ['endDate'] });

export type CreateSessionType = z.infer<typeof CreateSession>;

/**
 * The session's header and what families agree to (the coordinator rework, C4–C7, D11, D13, E4;
 * Appendix A): the optional close date, the payment due date, the first lesson, the self-study
 * share, the grades that may reserve, the unpaid-cancel days, the refund policy (until the first
 * family consents to it) and the session's extra questions. A share change answers its impact first
 * (`expected`). Only what is sent changes.
 *
 * Deprecated, the legacy contract: `startDate` (a draft's), `endDate` (an open session's end changes
 * with a reason) — `closesAt` is the new field for the same column.
 */
export const UpdateSession = z
  .object({
    closesAt: z.coerce.date().nullable().optional(),
    courseStartsOn: DateOnlySchema.optional(),
    paymentDueAt: z.coerce.date().optional(),
    selfStudyPercent: z.number().int().min(0).max(100).optional(),
    allowedGrades: z.array(z.enum(['10', '11', '12', 'graduates'])).min(1).max(4).optional(),
    unpaidCancelDays: z.number().int().min(0).max(60).optional(),
    refundPolicy: RefundPolicySchema.optional(),
    questions: z.array(z.object({
      id: z.string().min(1).optional(),
      kind: z.enum(['yes_no', 'text', 'choice']),
      prompt: z.string().trim().min(2).max(300),
      choices: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
      required: z.boolean().default(false),
    }).refine((q) => (q.kind === 'choice') === (q.choices.length > 0), { message: 'A choice question lists its choices; the others list none', path: ['choices'] })).max(20).optional(),
    expected: z.object({
      repriced: z.number().int().min(0), listedForFinance: z.number().int().min(0),
      linesAffected: z.number().int().min(0), dueDatesMoved: z.number().int().min(0),
    }).optional(),
    /** @deprecated the legacy contract. */
    startDate: z.coerce.date().optional(),
    /** @deprecated the legacy contract (`closesAt` is the new field). */
    endDate: z.coerce.date().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((d) => !(d.startDate && d.endDate) || d.endDate > d.startDate, { message: 'End date must be after start date', path: ['endDate'] });
export type UpdateSessionType = z.infer<typeof UpdateSession>;

/** Copy the offers of an earlier session into this one (offers already here are kept). */
export const CopySessionFrom = z.object({
  fromSessionId: z.string().min(1),
});
export type CopySessionFromType = z.infer<typeof CopySessionFrom>;

/**
 * Correct a session's exam series (type and year) — F0a. Admin-only, in any status, with a
 * reason: the series decides the academic year every line is judged by.
 */
export const CorrectSessionSeries = z.object({
  sessionType: SessionTypeSchema,
  seriesYear: SeriesYearSchema,
  reason: z.string().trim().min(5, 'Please provide a reason (min 5 characters)').max(500, 'Reason too long'),
});
export type CorrectSessionSeriesType = z.infer<typeof CorrectSessionSeries>;

/** Close a session early. */
/** Delete a draft session nobody has reserved in (F8-01): the admin says why; the reason is kept in the audit row. */
export const DeleteSession = z.object({
  reason: z.string().trim().min(5, 'Say why the session is deleted (at least 5 characters)').max(500, 'Reason too long'),
});
export type DeleteSessionType = z.infer<typeof DeleteSession>;

export const CloseSession = z.object({
  reason: z
    .string()
    .min(5, 'Please provide a reason for closing early')
    .max(500, 'Reason too long')
    .optional(),
});
export type CloseSessionType = z.infer<typeof CloseSession>;

export const ListSessionsQuery = z.object({
  status: SessionStatusSchema.optional(),
  sessionType: SessionTypeSchema.optional(),
});
export type ListSessionsQueryType = z.infer<typeof ListSessionsQuery>;
