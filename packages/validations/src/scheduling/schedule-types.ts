/**
 * The shape of a day's schedule (FEATURES_PLAN.md F1, §2's contract
 * `getScheduleFor`), declared here rather than in the API service that builds
 * it so the web's inferred response types can name it (TS2742 — the reason
 * F0a moved the eligibility answer's type here too). The web still derives its
 * types from the RPC fetcher; nothing is typed by hand on the client.
 */

export type LessonStatus =
  | 'scheduled'        // taught by its own teacher
  | 'covered'          // its teacher is away; another teacher covers it
  | 'uncovered'        // its teacher is away and no cover is arranged yet
  | 'cancelled'        // it does not take place (the students were told)
  | 'covering'         // (a teacher's view) a lesson they cover for someone
  | 'covered_by_other'; // (a teacher's view) their lesson, covered by someone else

export type SchedulePerson = { id: string; name: string };

export type LessonOnDay = {
  lessonId: string;
  timetableId: string;
  groupId: string;
  groupName: string;
  subject: { id: string; name: string; code: string } | null;
  /** The lesson period it starts at, and every period it takes that day. */
  period: number;
  periods: number[];
  label: string;
  startsAt: string;
  endsAt: string;
  length: number;
  room: SchedulePerson | null;
  /** How the group is taught: an online lesson is held with no room (F1 on the rework). */
  delivery: 'in_school' | 'online';
  /** Who teaches it that day (cover applied), and who is timetabled. */
  teacher: SchedulePerson | null;
  scheduledTeacher: SchedulePerson | null;
  status: LessonStatus;
  cover: { assignmentId: string; status: 'assigned' | 'cancelled'; teacher: SchedulePerson | null } | null;
  /** Uncovered because the teacher given the cover is away themselves: it needs new cover. */
  needsNewCover?: boolean;
  /** How many of the section's students are in it (section view). */
  sectionStudents?: number;
};

export type NotHeld = { lessonId: string; groupName: string; period: number; reason: 'short_day' | 'exam_only' };

export type DaySchedule = {
  date: string;
  weekday: number;
  kind: string;
  isSchoolDay: boolean;
  term: { id: string; name: string } | null;
  entry: { kind: string; name: string } | null;
  bellSchedule: { id: string; name: string } | null;
  timetable: { id: string; name: string; effectiveFrom: string } | null;
  /** Why the day has no lessons, when it has none. */
  note: 'holiday' | 'weekend' | 'out_of_term' | 'no_academic_year' | 'exam_only' | 'no_timetable' | 'left'
    // An extra school day (a Saturday made a school day) on a weekday the weekly timetable has no lessons.
    | 'extra_day' | null;
  lessons: LessonOnDay[];
  notHeld: NotHeld[];
};
