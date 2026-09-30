/**
 * Scheduling inputs (FEATURES_PLAN.md F1): teaching groups, the year's rules,
 * timetables and their lessons, the views, cover, and the calendar feed.
 * Input types only (PATTERNS.md); responses are inferred from the routes.
 */

import { z } from 'zod';
import { DateOnlySchema, RoomTypeSchema, RoomFeatureSchema } from '../academic/structure.validations';

const Id = z.string().min(1, 'Invalid id');
const Weekday = z.number().int().min(0).max(6);
const Period = z.number().int().min(1).max(20);
const Reason = z.string().trim().min(3, 'Give a reason (a few words)').max(500);
const GroupName = z.string().trim().min(1, 'Name the group').max(120);

// ─── Teaching groups ─────────────────────────────────────────────────────────

export const YearQuery = z.object({ academicYearId: Id });
export type YearQueryType = z.infer<typeof YearQuery>;

const RoomNeeds = {
  roomType: RoomTypeSchema.nullable().optional(),
  roomFeatures: z.array(RoomFeatureSchema).max(10).optional(),
  roomId: Id.nullable().optional(),
};

const PeriodsShape = z.object({
  weeklyPeriods: z.number().int().min(0).max(30),
  doublePeriods: z.number().int().min(0).max(15),
});

/** Form the year's groups from the course enrolment (preview, then commit). */
export const FormGroups = z.object({
  academicYearId: Id,
  commit: z.boolean(),
  /** The day new members start (default: the year's first day, or today once the year has begun). */
  startsOn: DateOnlySchema.optional(),
  /** Weekly periods for a group formed now (each can be changed afterwards). */
  weeklyPeriods: z.number().int().min(0).max(30).optional(),
});
export type FormGroupsType = z.infer<typeof FormGroups>;

/** One group per section for a subject the section is taught together. */
export const CreateSectionGroups = z
  .object({
    academicYearId: Id,
    sectionIds: z.array(Id).min(1, 'Choose at least one section').max(50),
    subjectId: Id.nullable().optional(),
    /** The course's name: each group is "<name> <section>". */
    name: GroupName,
    teacherId: Id.nullable().optional(),
    ...RoomNeeds,
  })
  .and(PeriodsShape)
  .refine((d) => d.doublePeriods * 2 <= d.weeklyPeriods, { message: 'Doubles take two periods each: they cannot exceed the weekly periods', path: ['doublePeriods'] });
export type CreateSectionGroupsType = z.infer<typeof CreateSectionGroups>;

export const CreateGroup = z
  .object({
    academicYearId: Id,
    name: GroupName,
    subjectId: Id.nullable().optional(),
    teacherId: Id.nullable().optional(),
    studentIds: z.array(Id).max(500).optional(),
    startsOn: DateOnlySchema.optional(),
    ...RoomNeeds,
  })
  .and(PeriodsShape)
  .refine((d) => d.doublePeriods * 2 <= d.weeklyPeriods, { message: 'Doubles take two periods each: they cannot exceed the weekly periods', path: ['doublePeriods'] });
export type CreateGroupType = z.infer<typeof CreateGroup>;

export const UpdateGroup = z.object({
  name: GroupName.optional(),
  teacherId: Id.nullable().optional(),
  weeklyPeriods: z.number().int().min(0).max(30).optional(),
  doublePeriods: z.number().int().min(0).max(15).optional(),
  ...RoomNeeds,
});
export type UpdateGroupType = z.infer<typeof UpdateGroup>;

export const AddGroupMembers = z.object({
  studentIds: z.array(Id).min(1, 'Choose at least one student').max(500),
  startsOn: DateOnlySchema.optional(),
});
export type AddGroupMembersType = z.infer<typeof AddGroupMembers>;

export const EndGroupMembers = z.object({
  studentIds: z.array(Id).min(1, 'Choose at least one student').max(500),
  endedOn: DateOnlySchema.optional(),
  reason: Reason,
});
export type EndGroupMembersType = z.infer<typeof EndGroupMembers>;

/** Move some of a group's students into new groups (the rest stay). */
export const SplitGroup = z.object({
  parts: z
    .array(z.object({ name: GroupName, teacherId: Id.nullable().optional(), studentIds: z.array(Id).min(1, 'Each new group needs students').max(500) }))
    .min(1, 'Name at least one new group')
    .max(10),
  startsOn: DateOnlySchema.optional(),
});
export type SplitGroupType = z.infer<typeof SplitGroup>;

/** Bring groups together into one: the others stop being taught from the day. */
export const MergeGroups = z.object({
  intoGroupId: Id,
  groupIds: z.array(Id).min(1, 'Choose the groups to merge in').max(20),
  startsOn: DateOnlySchema.optional(),
});
export type MergeGroupsType = z.infer<typeof MergeGroups>;

export const ArchiveGroup = z.object({ archivedOn: DateOnlySchema.optional(), reason: Reason });
export type ArchiveGroupType = z.infer<typeof ArchiveGroup>;

// ─── The year's rules ────────────────────────────────────────────────────────

const Unavailable = z.object({ weekday: Weekday, period: Period.nullable(), note: z.string().max(200).nullable().optional() });

export const PutTeacherConstraints = z.object({
  academicYearId: Id,
  maxPerDay: z.number().int().min(1).max(20).nullable(),
  maxPerWeek: z.number().int().min(1).max(100).nullable(),
  unavailable: z.array(Unavailable).max(200),
});
export type PutTeacherConstraintsType = z.infer<typeof PutTeacherConstraints>;

export const PutRoomConstraints = z.object({ academicYearId: Id, unavailable: z.array(Unavailable).max(200) });
export type PutRoomConstraintsType = z.infer<typeof PutRoomConstraints>;

export const CreateDayRule = z.object({ academicYearId: Id, groupAId: Id, groupBId: Id, note: z.string().max(200).nullable().optional() });
export type CreateDayRuleType = z.infer<typeof CreateDayRule>;

// ─── Timetables ──────────────────────────────────────────────────────────────

export const TimetablesQuery = z.object({ academicYearId: Id.optional(), termId: Id.optional() });
export type TimetablesQueryType = z.infer<typeof TimetablesQuery>;

export const CreateTimetable = z.object({
  termId: Id,
  name: z.string().trim().min(1, 'Name the timetable').max(120),
  /** Start as a copy of this version (its placements and locks); otherwise every lesson starts unplaced. */
  copyFromId: Id.nullable().optional(),
});
export type CreateTimetableType = z.infer<typeof CreateTimetable>;

export const UpdateTimetable = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateTimetableType = z.infer<typeof UpdateTimetable>;

export const LessonParam = z.object({ id: Id, lessonId: Id });

export const MoveLesson = z.object({
  weekday: Weekday,
  period: Period,
  /** The room (null: none; absent: the best free one that suits). */
  roomId: Id.nullable().optional(),
  /** Where the editor saw the lesson: refused if someone has moved it since. */
  from: z.object({ weekday: Weekday.nullable(), period: Period.nullable() }),
  /** Place it even though it clashes (the clash stays listed, and publishing waits for it). */
  allowClash: z.boolean().optional(),
});
export type MoveLessonType = z.infer<typeof MoveLesson>;

export const UnplaceLesson = z.object({ from: z.object({ weekday: Weekday.nullable(), period: Period.nullable() }) });
export type UnplaceLessonType = z.infer<typeof UnplaceLesson>;

export const LockLesson = z.object({ locked: z.boolean() });
export type LockLessonType = z.infer<typeof LockLesson>;

export const GenerateTimetable = z.object({
  /** Improvement steps; the default suits the school's size. */
  iterations: z.number().int().min(0).max(2_000_000).optional(),
});
export type GenerateTimetableType = z.infer<typeof GenerateTimetable>;

export const PublishTimetable = z.object({
  effectiveFrom: DateOnlySchema,
  note: z.string().max(500).nullable().optional(),
  /** Publish although some lessons are not on the grid (they are not taught until a later version places them). */
  acceptUnplaced: z.boolean().optional(),
});
export type PublishTimetableType = z.infer<typeof PublishTimetable>;

export const TIMETABLE_CSV_VIEWS = ['all', 'section', 'teacher', 'room', 'student'] as const;
export const ExportCsvQuery = z.object({ view: z.enum(TIMETABLE_CSV_VIEWS).optional(), id: Id.optional() });
export type ExportCsvQueryType = z.infer<typeof ExportCsvQuery>;

// ─── The views ───────────────────────────────────────────────────────────────

const exactlyOne = (keys: string[]) => (d: Record<string, unknown>) => keys.filter((k) => d[k] !== undefined).length === 1;

export const ScheduleDayQuery = z
  .object({ studentId: Id.optional(), teacherId: Id.optional(), date: DateOnlySchema.optional() })
  .refine(exactlyOne(['studentId', 'teacherId']), { message: 'Ask for one student or one teacher' });
export type ScheduleDayQueryType = z.infer<typeof ScheduleDayQuery>;

export const ScheduleWeekQuery = z
  .object({ studentId: Id.optional(), teacherId: Id.optional(), roomId: Id.optional(), sectionId: Id.optional(), date: DateOnlySchema.optional() })
  .refine(exactlyOne(['studentId', 'teacherId', 'roomId', 'sectionId']), { message: 'Ask for one student, teacher, room or section' });
export type ScheduleWeekQueryType = z.infer<typeof ScheduleWeekQuery>;

export const MyScheduleQuery = z.object({ date: DateOnlySchema.optional() });
export type MyScheduleQueryType = z.infer<typeof MyScheduleQuery>;

export const LessonOnDateQuery = z.object({ lessonId: Id, date: DateOnlySchema });
export type LessonOnDateQueryType = z.infer<typeof LessonOnDateQuery>;

// ─── Cover ───────────────────────────────────────────────────────────────────

export const ABSENCE_REASONS = ['sick', 'personal', 'training', 'school_business', 'other'] as const;
export const AbsenceReasonSchema = z.enum(ABSENCE_REASONS);
export type AbsenceReason = z.infer<typeof AbsenceReasonSchema>;

export const RangeQuery = z.object({ from: DateOnlySchema.optional(), to: DateOnlySchema.optional() });
export type RangeQueryType = z.infer<typeof RangeQuery>;

export const CoverReportQuery = z.object({ from: DateOnlySchema, to: DateOnlySchema });
export type CoverReportQueryType = z.infer<typeof CoverReportQuery>;

export const CreateAbsence = z
  .object({
    teacherId: Id,
    startsOn: DateOnlySchema,
    endsOn: DateOnlySchema,
    /** Only these lesson periods of a single day; absent or null = whole days. */
    periods: z.array(Period).min(1).max(20).nullable().optional(),
    reason: AbsenceReasonSchema,
    note: z.string().max(500).nullable().optional(),
  })
  .refine((d) => d.endsOn >= d.startsOn, { message: 'The last day must be on or after the first', path: ['endsOn'] })
  .refine((d) => !d.periods || d.startsOn === d.endsOn, { message: 'Periods can be given for a single day only', path: ['periods'] })
  .refine((d) => new Date(`${d.endsOn}T00:00:00Z`).getTime() - new Date(`${d.startsOn}T00:00:00Z`).getTime() <= 120 * 86_400_000, {
    message: 'An absence covers at most 120 days — record a longer one in parts',
    path: ['endsOn'],
  });
export type CreateAbsenceType = z.infer<typeof CreateAbsence>;

export const CancelAbsence = z.object({ reason: Reason });
export type CancelAbsenceType = z.infer<typeof CancelAbsence>;

export const CoverSuggestionsQuery = z.object({ lessonId: Id, date: DateOnlySchema });
export type CoverSuggestionsQueryType = z.infer<typeof CoverSuggestionsQuery>;

export const AssignCover = z
  .object({
    lessonId: Id,
    date: DateOnlySchema,
    coverTeacherId: Id.nullable().optional(),
    /** No cover: the lesson does not take place (the students are told). */
    cancel: z.boolean().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((d) => (d.cancel === true) !== !!d.coverTeacherId, { message: 'Choose a cover teacher, or cancel the lesson' });
export type AssignCoverType = z.infer<typeof AssignCover>;

export const RemoveCover = z.object({ reason: Reason });
export type RemoveCoverType = z.infer<typeof RemoveCover>;

// ─── The calendar feed ───────────────────────────────────────────────────────

export const FeedTokenParam = z.object({ token: z.string().min(1).max(200) });
