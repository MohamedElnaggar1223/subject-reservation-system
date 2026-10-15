/**
 * Academic structure inputs (FEATURES_PLAN.md F0a, "Academic structure"):
 * academic years and terms, the school calendar, bell schedules, rooms, and
 * homeroom sections with their membership. Input types only (PATTERNS.md).
 */

import { z } from 'zod';
import { AcademicYearStartSchema } from './academic-year';

/** A calendar date, YYYY-MM-DD (the school's own day, no time or zone). */
export const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-13')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a real date');

/** A clock time, HH:MM in 24 hours. */
export const TimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 08:15');

export const IdParam = z.object({ id: z.string().min(1, 'Invalid id') });

const dateRange = <T extends { startsOn: string; endsOn: string }>(d: T) => d.endsOn >= d.startsOn;
const RANGE_MESSAGE = { message: 'The end date must be on or after the start date', path: ['endsOn'] };

// ─── Academic years ──────────────────────────────────────────────────────────

export const CreateAcademicYear = z
  .object({
    startYear: AcademicYearStartSchema,
    // The school's first and last day; inside 1 July – 30 June of that year.
    startsOn: DateOnlySchema,
    endsOn: DateOnlySchema,
  })
  .refine(dateRange, RANGE_MESSAGE);
export type CreateAcademicYearType = z.infer<typeof CreateAcademicYear>;

export const UpdateAcademicYear = z.object({
  startsOn: DateOnlySchema.optional(),
  endsOn: DateOnlySchema.optional(),
});
export type UpdateAcademicYearType = z.infer<typeof UpdateAcademicYear>;

// ─── Terms ───────────────────────────────────────────────────────────────────

export const CreateTerm = z
  .object({
    academicYearId: z.string().min(1),
    name: z.string().trim().min(1, 'A term needs a name').max(60),
    startsOn: DateOnlySchema,
    endsOn: DateOnlySchema,
  })
  .refine(dateRange, RANGE_MESSAGE);
export type CreateTermType = z.infer<typeof CreateTerm>;

export const UpdateTerm = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  startsOn: DateOnlySchema.optional(),
  endsOn: DateOnlySchema.optional(),
});
export type UpdateTermType = z.infer<typeof UpdateTerm>;

// ─── The school calendar ─────────────────────────────────────────────────────

/**
 * What a day is, on top of the school week (the `calendar.schoolWeekdays`
 * setting) and the terms:
 * - holiday          no school
 * - early_dismissal  school, on a shorter bell schedule
 * - exam_only        school for exams only: no lessons are expected
 * - school_day       an extra school day (a make-up day on a weekend)
 */
export const CALENDAR_ENTRY_KINDS = ['holiday', 'early_dismissal', 'exam_only', 'school_day'] as const;
export const CalendarEntryKindSchema = z.enum(CALENDAR_ENTRY_KINDS);
export type CalendarEntryKind = z.infer<typeof CalendarEntryKindSchema>;

export const CreateCalendarEntry = z
  .object({
    academicYearId: z.string().min(1),
    kind: CalendarEntryKindSchema,
    name: z.string().trim().min(1, 'Give the day a name').max(100),
    startsOn: DateOnlySchema,
    endsOn: DateOnlySchema,
    // The bells that day, when not the default schedule (a short day).
    bellScheduleId: z.string().min(1).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  })
  .refine(dateRange, RANGE_MESSAGE)
  .refine((d) => d.kind !== 'early_dismissal' || !!d.bellScheduleId, {
    message: 'An early-dismissal day needs the bell schedule it runs on',
    path: ['bellScheduleId'],
  });
export type CreateCalendarEntryType = z.infer<typeof CreateCalendarEntry>;

export const CalendarQuery = z.object({
  academicYearId: z.string().min(1).optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
});
export type CalendarQueryType = z.infer<typeof CalendarQuery>;

// ─── Bell schedules ──────────────────────────────────────────────────────────

export const BELL_PERIOD_KINDS = ['lesson', 'break', 'assembly', 'registration'] as const;
export const BellPeriodKindSchema = z.enum(BELL_PERIOD_KINDS);

export const CreateBellSchedule = z.object({
  academicYearId: z.string().min(1),
  name: z.string().trim().min(1, 'Name the schedule').max(60),
  // One schedule per year is the school's ordinary day; the others are
  // variants a calendar day can run on (a short day, exam week).
  isDefault: z.boolean().default(false),
});
export type CreateBellScheduleType = z.infer<typeof CreateBellSchedule>;

export const UpdateBellSchedule = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  isDefault: z.boolean().optional(),
});
export type UpdateBellScheduleType = z.infer<typeof UpdateBellSchedule>;

export const BellPeriodInput = z
  .object({
    // 0 = Sunday … 6 = Saturday; null = every school day.
    weekday: z.number().int().min(0).max(6).nullable(),
    label: z.string().trim().min(1, 'Name the period').max(30),
    kind: BellPeriodKindSchema,
    startsAt: TimeOfDaySchema,
    endsAt: TimeOfDaySchema,
  })
  .refine((p) => p.endsAt > p.startsAt, { message: 'A period ends after it starts', path: ['endsAt'] });

/** The whole day grid of a schedule, saved at once. */
export const ReplaceBellPeriods = z.object({
  periods: z.array(BellPeriodInput).max(200),
});
export type ReplaceBellPeriodsType = z.infer<typeof ReplaceBellPeriods>;

// ─── Rooms ───────────────────────────────────────────────────────────────────

export const ROOM_TYPES = ['classroom', 'science_lab', 'computer_lab', 'hall', 'library', 'art_room', 'sports', 'other'] as const;
export const RoomTypeSchema = z.enum(ROOM_TYPES);

export const ROOM_FEATURES = ['projector', 'smartboard', 'computers', 'lab_benches', 'fume_cupboard', 'air_conditioning', 'wheelchair_access'] as const;
export const RoomFeatureSchema = z.enum(ROOM_FEATURES);

export const CreateRoom = z.object({
  name: z.string().trim().min(1, 'Name the room').max(60),
  capacity: z.number().int().min(1).max(1000).optional().nullable(),
  type: RoomTypeSchema.default('classroom'),
  features: z.array(RoomFeatureSchema).max(ROOM_FEATURES.length).default([]),
  notes: z.string().max(500).optional().nullable(),
});
export type CreateRoomType = z.infer<typeof CreateRoom>;

export const UpdateRoom = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  capacity: z.number().int().min(1).max(1000).optional().nullable(),
  type: RoomTypeSchema.optional(),
  features: z.array(RoomFeatureSchema).max(ROOM_FEATURES.length).optional(),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});
export type UpdateRoomType = z.infer<typeof UpdateRoom>;

// ─── Sections ────────────────────────────────────────────────────────────────

export const SectionGradeSchema = z.union([z.literal(10), z.literal(11), z.literal(12)]);

export const CreateSection = z.object({
  academicYearId: z.string().min(1),
  grade: SectionGradeSchema,
  name: z.string().trim().min(1, 'Name the section, e.g. 11A').max(20),
  homeroomTeacherId: z.string().min(1).optional().nullable(),
  roomId: z.string().min(1).optional().nullable(),
  capacity: z.number().int().min(1).max(200).optional().nullable(),
});
export type CreateSectionType = z.infer<typeof CreateSection>;

export const UpdateSection = z.object({
  name: z.string().trim().min(1).max(20).optional(),
  homeroomTeacherId: z.string().min(1).optional().nullable(),
  roomId: z.string().min(1).optional().nullable(),
  capacity: z.number().int().min(1).max(200).optional().nullable(),
});
export type UpdateSectionType = z.infer<typeof UpdateSection>;

export const ListSectionsQuery = z.object({
  academicYearId: z.string().min(1).optional(),
});

export const AddSectionMembers = z.object({
  studentIds: z.array(z.string().min(1)).min(1, 'Pick at least one student').max(200),
  // A student already in another section of the same year is moved: that
  // membership ends the day before this one starts.
  startsOn: DateOnlySchema.optional(),
  // F1: go ahead although the move puts a student in two lessons at once in a
  // published timetable (their new section's lessons against their own); the
  // clash is recorded and listed on the Timetables screen.
  anyway: z.boolean().optional(),
  /** The confirmation code of the clashes shown (from the refusal): going ahead covers exactly those. */
  clashToken: z.string().max(32).nullable().optional(),
});
export type AddSectionMembersType = z.infer<typeof AddSectionMembers>;

export const EndSectionMembership = z.object({
  endedOn: DateOnlySchema.optional(),
  reason: z.string().trim().min(3, 'A reason is required').max(300),
});
export type EndSectionMembershipType = z.infer<typeof EndSectionMembership>;

export const SectionMemberParam = z.object({ id: z.string().min(1), membershipId: z.string().min(1) });

/**
 * Move sections into the next academic year: each grade-10 and grade-11
 * section of the source year becomes a section one grade up in the target
 * year (its name mapped, e.g. 10A → 11A), with the members who are in that
 * grade then. Grade-12 sections graduate. Previewed first (commit: false),
 * then committed; running it again changes nothing.
 */
export const RollOverSections = z.object({
  fromAcademicYearId: z.string().min(1),
  toAcademicYearId: z.string().min(1),
  commit: z.boolean().default(false),
  // Optional new names by source section id; default: the grade digits bumped.
  names: z.record(z.string(), z.string().trim().min(1).max(20)).optional(),
  // F1: go ahead although students rolled into an existing section of a year
  // with a published timetable would be in two lessons at once (recorded).
  anyway: z.boolean().optional(),
  /** The confirmation code of the clashes shown (from the refusal): going ahead covers exactly those. */
  clashToken: z.string().max(32).nullable().optional(),
});
export type RollOverSectionsType = z.infer<typeof RollOverSections>;
