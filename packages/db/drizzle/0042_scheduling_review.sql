CREATE TABLE "published_clash" (
	"id" text PRIMARY KEY NOT NULL,
	"timetable_id" text NOT NULL,
	"kind" text NOT NULL,
	"student_id" text,
	"teacher_id" text,
	"lesson_a_id" text NOT NULL,
	"lesson_b_id" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"message" text NOT NULL,
	"cause" text NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "published_clash_kind_valid" CHECK ("published_clash"."kind" IN ('students_busy', 'teacher_busy')),
	CONSTRAINT "published_clash_one_person" CHECK (("published_clash"."student_id" IS NULL) <> ("published_clash"."teacher_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "student_leaving" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"left_on" date NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"readmitted_on" date,
	"readmitted_by" text,
	"readmitted_at" timestamp with time zone,
	"readmit_reason" text,
	CONSTRAINT "student_leaving_kind_valid" CHECK ("student_leaving"."kind" IN ('withdrawn', 'transferred')),
	CONSTRAINT "student_leaving_dates_ordered" CHECK ("student_leaving"."readmitted_on" IS NULL OR "student_leaving"."readmitted_on" >= "student_leaving"."left_on")
);
--> statement-breakpoint
CREATE TABLE "teaching_group_teacher" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"teacher_id" text,
	"started_on" date NOT NULL,
	"ended_on" date,
	"reason" text,
	"set_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teaching_group_teacher_dates_ordered" CHECK ("teaching_group_teacher"."ended_on" IS NULL OR "teaching_group_teacher"."ended_on" >= "teaching_group_teacher"."started_on" - 1)
);
--> statement-breakpoint
ALTER TABLE "cover_assignment" ADD COLUMN "removal" text;--> statement-breakpoint
ALTER TABLE "cover_assignment" ADD COLUMN "remove_reason" text;--> statement-breakpoint
ALTER TABLE "published_clash" ADD CONSTRAINT "published_clash_timetable_id_timetable_id_fk" FOREIGN KEY ("timetable_id") REFERENCES "public"."timetable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_clash" ADD CONSTRAINT "published_clash_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_clash" ADD CONSTRAINT "published_clash_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_clash" ADD CONSTRAINT "published_clash_lesson_a_id_timetable_lesson_id_fk" FOREIGN KEY ("lesson_a_id") REFERENCES "public"."timetable_lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_clash" ADD CONSTRAINT "published_clash_lesson_b_id_timetable_lesson_id_fk" FOREIGN KEY ("lesson_b_id") REFERENCES "public"."timetable_lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_clash" ADD CONSTRAINT "published_clash_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leaving" ADD CONSTRAINT "student_leaving_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leaving" ADD CONSTRAINT "student_leaving_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leaving" ADD CONSTRAINT "student_leaving_readmitted_by_user_id_fk" FOREIGN KEY ("readmitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group_teacher" ADD CONSTRAINT "teaching_group_teacher_group_id_teaching_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."teaching_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group_teacher" ADD CONSTRAINT "teaching_group_teacher_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group_teacher" ADD CONSTRAINT "teaching_group_teacher_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publishedClash_timetableId_idx" ON "published_clash" USING btree ("timetable_id");--> statement-breakpoint
CREATE INDEX "studentLeaving_studentId_idx" ON "student_leaving" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "studentLeaving_one_open_idx" ON "student_leaving" USING btree ("student_id") WHERE readmitted_on IS NULL;--> statement-breakpoint
CREATE INDEX "teachingGroupTeacher_groupId_idx" ON "teaching_group_teacher" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "teachingGroupTeacher_teacherId_idx" ON "teaching_group_teacher" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teachingGroupTeacher_one_open_idx" ON "teaching_group_teacher" USING btree ("group_id") WHERE ended_on IS NULL;