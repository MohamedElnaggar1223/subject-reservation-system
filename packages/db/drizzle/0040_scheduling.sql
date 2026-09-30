CREATE TABLE "calendar_feed_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "calendar_feed_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "cover_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"absence_id" text,
	"date" date NOT NULL,
	"timetable_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"group_id" text NOT NULL,
	"original_teacher_id" text,
	"cover_teacher_id" text,
	"status" text NOT NULL,
	"note" text,
	"assigned_by" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_by" text,
	"removed_at" timestamp with time zone,
	CONSTRAINT "cover_assignment_status_valid" CHECK ("cover_assignment"."status" IN ('assigned', 'cancelled', 'removed')),
	CONSTRAINT "cover_assignment_teacher" CHECK ("cover_assignment"."status" <> 'assigned' OR "cover_assignment"."cover_teacher_id" IS NOT NULL),
	CONSTRAINT "cover_assignment_cancelled_no_teacher" CHECK ("cover_assignment"."status" <> 'cancelled' OR "cover_assignment"."cover_teacher_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "group_day_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"academic_year_id" text NOT NULL,
	"group_a_id" text NOT NULL,
	"group_b_id" text NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_day_rule_ordered" CHECK ("group_day_rule"."group_a_id" <= "group_day_rule"."group_b_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_unavailability" (
	"id" text PRIMARY KEY NOT NULL,
	"academic_year_id" text NOT NULL,
	"teacher_id" text,
	"room_id" text,
	"weekday" integer NOT NULL,
	"period" integer,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_unavailability_one_resource" CHECK (("schedule_unavailability"."teacher_id" IS NULL) <> ("schedule_unavailability"."room_id" IS NULL)),
	CONSTRAINT "schedule_unavailability_weekday" CHECK ("schedule_unavailability"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "schedule_unavailability_period" CHECK ("schedule_unavailability"."period" IS NULL OR "schedule_unavailability"."period" >= 1)
);
--> statement-breakpoint
CREATE TABLE "teacher_absence" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"periods" jsonb,
	"reason" text NOT NULL,
	"note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	CONSTRAINT "teacher_absence_dates_ordered" CHECK ("teacher_absence"."starts_on" <= "teacher_absence"."ends_on"),
	CONSTRAINT "teacher_absence_periods_one_day" CHECK ("teacher_absence"."periods" IS NULL OR "teacher_absence"."starts_on" = "teacher_absence"."ends_on"),
	CONSTRAINT "teacher_absence_reason_valid" CHECK ("teacher_absence"."reason" IN ('sick', 'personal', 'training', 'school_business', 'other'))
);
--> statement-breakpoint
CREATE TABLE "teacher_load_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"academic_year_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"max_per_day" integer,
	"max_per_week" integer,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_load_limit_positive" CHECK (("teacher_load_limit"."max_per_day" IS NULL OR "teacher_load_limit"."max_per_day" >= 1) AND ("teacher_load_limit"."max_per_week" IS NULL OR "teacher_load_limit"."max_per_week" >= 1))
);
--> statement-breakpoint
CREATE TABLE "teaching_group" (
	"id" text PRIMARY KEY NOT NULL,
	"academic_year_id" text NOT NULL,
	"name" text NOT NULL,
	"subject_id" text,
	"teacher_id" text,
	"kind" text NOT NULL,
	"section_id" text,
	"weekly_periods" integer DEFAULT 4 NOT NULL,
	"double_periods" integer DEFAULT 0 NOT NULL,
	"room_type" text,
	"room_features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"room_id" text,
	"split_from_group_id" text,
	"archived_on" date,
	"archived_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teaching_group_kind_valid" CHECK ("teaching_group"."kind" IN ('enrolment', 'section', 'manual')),
	CONSTRAINT "teaching_group_section_kind" CHECK (("teaching_group"."kind" = 'section') = ("teaching_group"."section_id" IS NOT NULL)),
	CONSTRAINT "teaching_group_periods" CHECK ("teaching_group"."weekly_periods" BETWEEN 0 AND 30 AND "teaching_group"."double_periods" >= 0 AND "teaching_group"."double_periods" * 2 <= "teaching_group"."weekly_periods")
);
--> statement-breakpoint
CREATE TABLE "teaching_group_member" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"student_id" text NOT NULL,
	"academic_year_id" text NOT NULL,
	"subject_id" text,
	"enrolment_id" text,
	"started_on" date NOT NULL,
	"ended_on" date,
	"end_reason" text,
	"added_by" text,
	"ended_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teaching_group_member_dates_ordered" CHECK ("teaching_group_member"."ended_on" IS NULL OR "teaching_group_member"."ended_on" >= "teaching_group_member"."started_on")
);
--> statement-breakpoint
CREATE TABLE "timetable" (
	"id" text PRIMARY KEY NOT NULL,
	"term_id" text NOT NULL,
	"academic_year_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date,
	"based_on_id" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone,
	"publish_note" text,
	CONSTRAINT "timetable_status_valid" CHECK ("timetable"."status" IN ('draft', 'published')),
	CONSTRAINT "timetable_published_whole" CHECK (("timetable"."status" = 'published') = ("timetable"."effective_from" IS NOT NULL AND "timetable"."published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "timetable_generation_run" (
	"id" text PRIMARY KEY NOT NULL,
	"timetable_id" text NOT NULL,
	"started_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer NOT NULL,
	"outcome" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"seed" text NOT NULL,
	"iterations" integer NOT NULL,
	"lessons" integer NOT NULL,
	"placed" integer NOT NULL,
	"unplaced" integer NOT NULL,
	"locked" integer NOT NULL,
	"measures" jsonb NOT NULL,
	"explanations" jsonb NOT NULL,
	CONSTRAINT "timetable_generation_run_outcome" CHECK ("timetable_generation_run"."outcome" IN ('applied', 'stale'))
);
--> statement-breakpoint
CREATE TABLE "timetable_lesson" (
	"id" text PRIMARY KEY NOT NULL,
	"timetable_id" text NOT NULL,
	"group_id" text NOT NULL,
	"seq" integer NOT NULL,
	"length" integer DEFAULT 1 NOT NULL,
	"weekday" integer,
	"period" integer,
	"room_id" text,
	"locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_lesson_length" CHECK ("timetable_lesson"."length" IN (1, 2)),
	CONSTRAINT "timetable_lesson_slot_whole" CHECK (("timetable_lesson"."weekday" IS NULL) = ("timetable_lesson"."period" IS NULL)),
	CONSTRAINT "timetable_lesson_slot_range" CHECK (("timetable_lesson"."weekday" IS NULL OR "timetable_lesson"."weekday" BETWEEN 0 AND 6) AND ("timetable_lesson"."period" IS NULL OR "timetable_lesson"."period" >= 1)),
	CONSTRAINT "timetable_lesson_locked_placed" CHECK (NOT "timetable_lesson"."locked" OR "timetable_lesson"."weekday" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "calendar_feed_token" ADD CONSTRAINT "calendar_feed_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_assignment" ADD CONSTRAINT "cover_assignment_absence_id_teacher_absence_id_fk" FOREIGN KEY ("absence_id") REFERENCES "public"."teacher_absence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_assignment" ADD CONSTRAINT "cover_assignment_timetable_id_timetable_id_fk" FOREIGN KEY ("timetable_id") REFERENCES "public"."timetable"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_assignment" ADD CONSTRAINT "cover_assignment_lesson_id_timetable_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."timetable_lesson"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_assignment" ADD CONSTRAINT "cover_assignment_group_id_teaching_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."teaching_group"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_assignment" ADD CONSTRAINT "cover_assignment_original_teacher_id_teacher_id_fk" FOREIGN KEY ("original_teacher_id") REFERENCES "public"."teacher"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_assignment" ADD CONSTRAINT "cover_assignment_cover_teacher_id_teacher_id_fk" FOREIGN KEY ("cover_teacher_id") REFERENCES "public"."teacher"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_assignment" ADD CONSTRAINT "cover_assignment_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_assignment" ADD CONSTRAINT "cover_assignment_removed_by_user_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_day_rule" ADD CONSTRAINT "group_day_rule_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_day_rule" ADD CONSTRAINT "group_day_rule_group_a_id_teaching_group_id_fk" FOREIGN KEY ("group_a_id") REFERENCES "public"."teaching_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_day_rule" ADD CONSTRAINT "group_day_rule_group_b_id_teaching_group_id_fk" FOREIGN KEY ("group_b_id") REFERENCES "public"."teaching_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_day_rule" ADD CONSTRAINT "group_day_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_unavailability" ADD CONSTRAINT "schedule_unavailability_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_unavailability" ADD CONSTRAINT "schedule_unavailability_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_unavailability" ADD CONSTRAINT "schedule_unavailability_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_unavailability" ADD CONSTRAINT "schedule_unavailability_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_absence" ADD CONSTRAINT "teacher_absence_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_absence" ADD CONSTRAINT "teacher_absence_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_absence" ADD CONSTRAINT "teacher_absence_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_load_limit" ADD CONSTRAINT "teacher_load_limit_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_load_limit" ADD CONSTRAINT "teacher_load_limit_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_load_limit" ADD CONSTRAINT "teacher_load_limit_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_section_id_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_split_from_group_id_teaching_group_id_fk" FOREIGN KEY ("split_from_group_id") REFERENCES "public"."teaching_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group_member" ADD CONSTRAINT "teaching_group_member_group_id_teaching_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."teaching_group"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group_member" ADD CONSTRAINT "teaching_group_member_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group_member" ADD CONSTRAINT "teaching_group_member_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group_member" ADD CONSTRAINT "teaching_group_member_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group_member" ADD CONSTRAINT "teaching_group_member_enrolment_id_course_enrolment_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."course_enrolment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group_member" ADD CONSTRAINT "teaching_group_member_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group_member" ADD CONSTRAINT "teaching_group_member_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable" ADD CONSTRAINT "timetable_term_id_academic_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_term"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable" ADD CONSTRAINT "timetable_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable" ADD CONSTRAINT "timetable_based_on_id_timetable_id_fk" FOREIGN KEY ("based_on_id") REFERENCES "public"."timetable"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable" ADD CONSTRAINT "timetable_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable" ADD CONSTRAINT "timetable_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_generation_run" ADD CONSTRAINT "timetable_generation_run_timetable_id_timetable_id_fk" FOREIGN KEY ("timetable_id") REFERENCES "public"."timetable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_generation_run" ADD CONSTRAINT "timetable_generation_run_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_lesson" ADD CONSTRAINT "timetable_lesson_timetable_id_timetable_id_fk" FOREIGN KEY ("timetable_id") REFERENCES "public"."timetable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_lesson" ADD CONSTRAINT "timetable_lesson_group_id_teaching_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."teaching_group"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_lesson" ADD CONSTRAINT "timetable_lesson_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendarFeedToken_one_live_idx" ON "calendar_feed_token" USING btree ("user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "coverAssignment_date_idx" ON "cover_assignment" USING btree ("date");--> statement-breakpoint
CREATE INDEX "coverAssignment_coverTeacherId_idx" ON "cover_assignment" USING btree ("cover_teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coverAssignment_one_live_idx" ON "cover_assignment" USING btree ("lesson_id","date") WHERE status <> 'removed';--> statement-breakpoint
CREATE UNIQUE INDEX "groupDayRule_pair_idx" ON "group_day_rule" USING btree ("group_a_id","group_b_id");--> statement-breakpoint
CREATE INDEX "scheduleUnavailability_yearId_idx" ON "schedule_unavailability" USING btree ("academic_year_id");--> statement-breakpoint
CREATE INDEX "teacherAbsence_teacherId_idx" ON "teacher_absence" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "teacherAbsence_dates_idx" ON "teacher_absence" USING btree ("starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "teacherLoadLimit_year_teacher_idx" ON "teacher_load_limit" USING btree ("academic_year_id","teacher_id");--> statement-breakpoint
CREATE INDEX "teachingGroup_yearId_idx" ON "teaching_group" USING btree ("academic_year_id");--> statement-breakpoint
CREATE INDEX "teachingGroup_subjectId_idx" ON "teaching_group" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "teachingGroup_teacherId_idx" ON "teaching_group" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "teachingGroup_sectionId_idx" ON "teaching_group" USING btree ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teachingGroup_year_name_idx" ON "teaching_group" USING btree ("academic_year_id",lower("name")) WHERE archived_on IS NULL;--> statement-breakpoint
CREATE INDEX "teachingGroupMember_groupId_idx" ON "teaching_group_member" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "teachingGroupMember_studentId_idx" ON "teaching_group_member" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teachingGroupMember_one_open_idx" ON "teaching_group_member" USING btree ("group_id","student_id") WHERE ended_on IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "teachingGroupMember_one_subject_idx" ON "teaching_group_member" USING btree ("student_id","subject_id","academic_year_id") WHERE ended_on IS NULL AND subject_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "timetable_termId_idx" ON "timetable" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "timetableGenerationRun_timetableId_idx" ON "timetable_generation_run" USING btree ("timetable_id");--> statement-breakpoint
CREATE INDEX "timetableLesson_timetableId_idx" ON "timetable_lesson" USING btree ("timetable_id");--> statement-breakpoint
CREATE INDEX "timetableLesson_groupId_idx" ON "timetable_lesson" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetableLesson_group_seq_idx" ON "timetable_lesson" USING btree ("timetable_id","group_id","seq");