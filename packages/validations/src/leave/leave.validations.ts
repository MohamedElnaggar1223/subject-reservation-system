/**
 * Campus leave inputs (FEATURES_PLAN.md F2; docs/features/CAMPUS_LEAVE.md):
 * requests (a parent's, the desk's for a family, the school's own), recurring
 * requests, approval, the family's collectors, custody restrictions, the gate
 * (a pass scanned, a check-out, a return), history and reports.
 *
 * Input types only (PATTERNS.md): every response is inferred from the routes.
 */

import { z } from 'zod';
import { DateOnlySchema, TimeOfDaySchema } from '../academic/structure.validations';

const Id = z.string().min(1, 'Invalid id');
const Reason = z.string().trim().min(3, 'Give a reason (a few words)').max(500);
const OptionalText = (max: number) => z.string().trim().max(max).nullable().optional();

// ─── Words ───────────────────────────────────────────────────────────────────

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'checked_out', 'returned'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
  checked_out: 'Left school',
  returned: 'Back at school',
};

/** Who started a request: a parent in the app, the desk for a family, or the school itself. */
export const LEAVE_ORIGINS = ['parent', 'desk', 'school'] as const;
export type LeaveOrigin = (typeof LEAVE_ORIGINS)[number];
export const LEAVE_ORIGIN_LABELS: Record<LeaveOrigin, string> = {
  parent: 'A parent, in the app',
  desk: 'Staff, for the family',
  school: "The school's own decision",
};

export const COLLECTOR_KINDS = ['parent', 'collector', 'alone'] as const;
export type CollectorKind = (typeof COLLECTOR_KINDS)[number];

export const COLLECTOR_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type CollectorStatus = (typeof COLLECTOR_STATUSES)[number];
export const COLLECTOR_STATUS_LABELS: Record<CollectorStatus, string> = {
  pending: 'Waiting for the school',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
};

/** Suggested relations for a collector (free text is accepted). */
export const COLLECTOR_RELATIONS = [
  'Grandparent', 'Uncle', 'Aunt', 'Adult sibling', 'Family driver', 'Family friend', 'Neighbour', 'Nanny',
] as const;

/** The reasons a school starts with; the leave.reasonCategories setting changes them. */
export const DEFAULT_LEAVE_REASONS = [
  { key: 'medical', label: 'Medical appointment' },
  { key: 'unwell', label: 'Feeling unwell' },
  { key: 'family', label: 'Family matter' },
  { key: 'official', label: 'Official appointment' },
  { key: 'exam_elsewhere', label: 'Exam or test elsewhere' },
  { key: 'religious', label: 'Religious occasion' },
  { key: 'other', label: 'Other' },
] as const;

/** The policy warnings an approver sees on a request (and a family before sending it). */
export const LEAVE_WARNING_CODES = [
  'after_cutoff', 'short_notice', 'over_term_limit', 'exam_that_day', 'exam_only_day', 'custody_on_file',
  'collector_pending', 'alone_not_allowed', 'student_left',
] as const;
export type LeaveWarningCode = (typeof LEAVE_WARNING_CODES)[number];

// ─── Requests ────────────────────────────────────────────────────────────────

/** Who the family says will collect: a linked parent, an approved collector, or nobody (leaving alone). */
export const CollectorChoice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('parent'), parentId: Id }),
  z.object({ kind: z.literal('collector'), collectorId: Id }),
  z.object({ kind: z.literal('alone') }),
]);
export type CollectorChoiceType = z.infer<typeof CollectorChoice>;

export const LeaveRepeat = z.object({
  /** The last date it repeats on (inclusive). */
  until: DateOnlySchema,
  /** The weekdays it repeats on (0 = Sunday). */
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Choose at least one day').max(7),
});

export const CreateLeaveRequest = z
  .object({
    studentId: Id,
    date: DateOnlySchema,
    leaveTime: TimeOfDaySchema,
    returning: z.boolean(),
    returnTime: TimeOfDaySchema.nullable().optional(),
    reasonCategory: z.string().trim().min(1, 'Choose a reason').max(40),
    note: OptionalText(500),
    documentFileId: Id.nullable().optional(),
    collector: CollectorChoice,
    /** Staff only: the family's request (the default) or the school's own decision (a student sent home). */
    origin: z.enum(['family', 'school']).optional(),
    /** Staff only: the parent who asked, when one did. */
    onBehalfOf: Id.nullable().optional(),
    /** An approver creating it approves it at once. */
    approveNow: z.boolean().optional(),
    /** A recurring request: the same time on these weekdays until a date (school days only). */
    repeat: LeaveRepeat.nullable().optional(),
  })
  .refine((d) => !d.returning || (!!d.returnTime && d.returnTime > d.leaveTime), {
    message: 'The return time must be after the leave time', path: ['returnTime'],
  })
  .refine((d) => d.returning || !d.returnTime, { message: 'A return time needs "coming back"', path: ['returnTime'] })
  .refine((d) => !d.repeat || d.repeat.until >= d.date, { message: 'The last date must be on or after the first', path: ['repeat'] });
export type CreateLeaveRequestType = z.infer<typeof CreateLeaveRequest>;

/** Apply a decision or a cancellation to this request alone, or to every open date of its series. */
const SeriesFlag = { series: z.boolean().optional() };

export const ApproveLeave = z.object({ note: OptionalText(500), ...SeriesFlag });
export type ApproveLeaveType = z.infer<typeof ApproveLeave>;

export const RejectLeave = z.object({ reason: Reason, ...SeriesFlag });
export type RejectLeaveType = z.infer<typeof RejectLeave>;

export const CancelLeave = z.object({ reason: OptionalText(500), ...SeriesFlag });
export type CancelLeaveType = z.infer<typeof CancelLeave>;

export const LeaveListQuery = z.object({
  studentId: Id.optional(),
  date: DateOnlySchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  status: z.enum(LEAVE_STATUSES).optional(),
  /** Staff: the student's whole family (every student sharing an approved parent). */
  family: z.enum(['true', 'false']).optional(),
});
export type LeaveListQueryType = z.infer<typeof LeaveListQuery>;

export const StudentParam = z.object({ studentId: Id });

// ─── Collectors and custody ──────────────────────────────────────────────────

export const CreateCollector = z.object({
  name: z.string().trim().min(2, 'Write the full name').max(120),
  relation: z.string().trim().min(2, 'Say how they are related').max(60),
  phone: z.string().trim().min(6, 'Give a phone number').max(30),
  idNumber: z.string().trim().min(4, 'Give the national ID or passport number').max(30),
  photoFileId: Id.nullable().optional(),
  studentIds: z.array(Id).min(1, 'Choose at least one child').max(10),
  note: OptionalText(300),
});
export type CreateCollectorType = z.infer<typeof CreateCollector>;

export const CollectorsQuery = z.object({
  studentId: Id.optional(),
  status: z.enum(COLLECTOR_STATUSES).optional(),
});

export const RejectCollector = z.object({ reason: Reason });
export const WithdrawCollector = z.object({ reason: OptionalText(300) });

export const CreateRestriction = z
  .object({
    studentId: Id,
    personName: z.string().trim().min(2, 'Write the full name').max(120),
    relation: OptionalText(60),
    idNumber: z.string().trim().min(4).max(30).nullable().optional(),
    /** A parent's account the restriction names. */
    restrictedUserId: Id.nullable().optional(),
    photoFileId: Id.nullable().optional(),
    documentFileId: Id.nullable().optional(),
    note: z.string().trim().min(3, 'Say what the restriction rests on (a court order, a written instruction)').max(1000),
  });
export type CreateRestrictionType = z.infer<typeof CreateRestriction>;

export const RestrictionsQuery = z.object({ studentId: Id });
export const EndRestriction = z.object({ reason: Reason });

// ─── The gate ────────────────────────────────────────────────────────────────

export const ScanPass = z.object({ token: z.string().trim().min(10, 'Not a pass').max(300) });

/** Who actually collected, as the gate records it; "someone else" is checked and refused. */
export const CollectedBy = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('parent'), parentId: Id }),
  z.object({ kind: z.literal('collector'), collectorId: Id }),
  z.object({ kind: z.literal('alone') }),
  z.object({ kind: z.literal('other'), name: z.string().trim().min(2, 'Write the name on their ID').max(120), idNumber: z.string().trim().max(30).nullable().optional() }),
]);

export const CheckOut = z.object({
  collectedBy: CollectedBy,
  /** The gate looked at the collector's ID card. */
  idChecked: z.boolean(),
  via: z.enum(['pass', 'lookup']),
  /** The scanned pass, when checked out by pass (checked again). */
  token: z.string().trim().max(300).nullable().optional(),
  note: OptionalText(300),
});
export type CheckOutType = z.infer<typeof CheckOut>;

export const RecordReturn = z.object({ note: OptionalText(300) });

// ─── Reports ─────────────────────────────────────────────────────────────────

export const LeaveReportQuery = z
  .object({ from: DateOnlySchema, to: DateOnlySchema })
  .refine((d) => d.to >= d.from, { message: 'The end date must be on or after the start date', path: ['to'] });

export const LeaveTeachingQuery = z.object({ date: DateOnlySchema.optional() });

// ─── Masking ─────────────────────────────────────────────────────────────────

/** An ID number as a family or the desk sees it: the last four characters. */
export function maskIdNumber(idNumber: string | null | undefined): string | null {
  if (!idNumber) return null;
  const s = idNumber.replace(/\s+/g, '');
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
}
