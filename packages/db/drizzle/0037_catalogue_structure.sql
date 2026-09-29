CREATE TABLE "board_series" (
	"id" text PRIMARY KEY NOT NULL,
	"board_code" text NOT NULL,
	"month" text NOT NULL,
	"year" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"entry_deadline" timestamp with time zone,
	"estimated_entries_due" date,
	"late_fee_from" date,
	"high_late_fee_from" date,
	"late_entries_close" date,
	"retake_deadline" date,
	"forecast_grades_due" date,
	"nea_due" date,
	"access_arrangements_due" date,
	"exams_start" date,
	"exams_end" date,
	"results_on" date,
	"certificates_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_series_month_valid" CHECK ("board_series"."month" IN ('january', 'june', 'october', 'november')),
	CONSTRAINT "board_series_year_range" CHECK ("board_series"."year" BETWEEN 2000 AND 2100),
	CONSTRAINT "board_series_exams_ordered" CHECK ("board_series"."exams_start" IS NULL OR "board_series"."exams_end" IS NULL OR "board_series"."exams_end" >= "board_series"."exams_start")
);
--> statement-breakpoint
CREATE TABLE "course_enrolment" (
	"id" text PRIMARY KEY NOT NULL,
	"academic_year_id" text NOT NULL,
	"student_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"teacher_id" text,
	"mode" text DEFAULT 'in_school' NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"started_on" date NOT NULL,
	"ended_on" date,
	"end_reason" text,
	"created_by" text,
	"ended_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_enrolment_mode_valid" CHECK ("course_enrolment"."mode" IN ('in_school', 'self_study')),
	CONSTRAINT "course_enrolment_source_valid" CHECK ("course_enrolment"."source" IN ('manual', 'carried_forward', 'registrations', 'section', 'import')),
	CONSTRAINT "course_enrolment_self_study_untaught" CHECK ("course_enrolment"."mode" <> 'self_study' OR "course_enrolment"."teacher_id" IS NULL),
	CONSTRAINT "course_enrolment_dates_ordered" CHECK ("course_enrolment"."ended_on" IS NULL OR "course_enrolment"."ended_on" >= "course_enrolment"."started_on")
);
--> statement-breakpoint
CREATE TABLE "exam_board" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"entry_portal" text,
	"series_months" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_unit" (
	"id" text PRIMARY KEY NOT NULL,
	"board_code" text NOT NULL,
	"code" text NOT NULL,
	"short_code" text,
	"title" text NOT NULL,
	"unit_level" text NOT NULL,
	"kind" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_unit_level_valid" CHECK ("exam_unit"."unit_level" IN ('igcse', 'as', 'a2')),
	CONSTRAINT "exam_unit_kind_valid" CHECK ("exam_unit"."kind" IN ('unit', 'component'))
);
--> statement-breakpoint
CREATE TABLE "qualification" (
	"id" text PRIMARY KEY NOT NULL,
	"board_code" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"level" text NOT NULL,
	"suite" text DEFAULT '' NOT NULL,
	"subject_area" text NOT NULL,
	"entry_method" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qualification_level_valid" CHECK ("qualification"."level" IN ('igcse', 'as_level', 'a_level')),
	CONSTRAINT "qualification_entry_method_valid" CHECK ("qualification"."entry_method" IN ('qualification', 'units_cash_in', 'syllabus_option'))
);
--> statement-breakpoint
CREATE TABLE "qualification_option" (
	"id" text PRIMARY KEY NOT NULL,
	"qualification_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"carry_forward" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_option_unit" (
	"option_id" text NOT NULL,
	"unit_id" text NOT NULL,
	CONSTRAINT "qualification_option_unit_option_id_unit_id_pk" PRIMARY KEY("option_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "qualification_unit" (
	"id" text PRIMARY KEY NOT NULL,
	"qualification_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"requirement" text NOT NULL,
	"choice_group" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qualification_unit_requirement_valid" CHECK ("qualification_unit"."requirement" IN ('required', 'optional'))
);
--> statement-breakpoint
CREATE TABLE "session_board_series" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"board_series_id" text NOT NULL,
	"board_code" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessionBoardSeries_pair_key" UNIQUE("session_id","board_series_id")
);
--> statement-breakpoint
CREATE TABLE "session_subject_series" (
	"session_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"board_series_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_subject_series_session_id_subject_id_pk" PRIMARY KEY("session_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "subject_unit" (
	"subject_id" text NOT NULL,
	"unit_id" text NOT NULL,
	CONSTRAINT "subject_unit_subject_id_unit_id_pk" PRIMARY KEY("subject_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "board_series_id" text;--> statement-breakpoint
ALTER TABLE "subject" ADD COLUMN "qualification_id" text;--> statement-breakpoint
ALTER TABLE "board_series" ADD CONSTRAINT "board_series_board_code_exam_board_code_fk" FOREIGN KEY ("board_code") REFERENCES "public"."exam_board"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrolment" ADD CONSTRAINT "course_enrolment_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrolment" ADD CONSTRAINT "course_enrolment_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrolment" ADD CONSTRAINT "course_enrolment_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrolment" ADD CONSTRAINT "course_enrolment_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrolment" ADD CONSTRAINT "course_enrolment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrolment" ADD CONSTRAINT "course_enrolment_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_unit" ADD CONSTRAINT "exam_unit_board_code_exam_board_code_fk" FOREIGN KEY ("board_code") REFERENCES "public"."exam_board"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification" ADD CONSTRAINT "qualification_board_code_exam_board_code_fk" FOREIGN KEY ("board_code") REFERENCES "public"."exam_board"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_option" ADD CONSTRAINT "qualification_option_qualification_id_qualification_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "public"."qualification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_option_unit" ADD CONSTRAINT "qualification_option_unit_option_id_qualification_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."qualification_option"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_option_unit" ADD CONSTRAINT "qualification_option_unit_unit_id_exam_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."exam_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_unit" ADD CONSTRAINT "qualification_unit_qualification_id_qualification_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "public"."qualification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_unit" ADD CONSTRAINT "qualification_unit_unit_id_exam_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."exam_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_board_series" ADD CONSTRAINT "session_board_series_session_id_registration_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."registration_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_board_series" ADD CONSTRAINT "session_board_series_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_board_series" ADD CONSTRAINT "session_board_series_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_subject_series" ADD CONSTRAINT "session_subject_series_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_subject_series" ADD CONSTRAINT "session_subject_series_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_subject_series" ADD CONSTRAINT "sessionSubjectSeries_link_fk" FOREIGN KEY ("session_id","board_series_id") REFERENCES "public"."session_board_series"("session_id","board_series_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_unit" ADD CONSTRAINT "subject_unit_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_unit" ADD CONSTRAINT "subject_unit_unit_id_exam_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."exam_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boardSeries_unique_idx" ON "board_series" USING btree ("board_code","month","year","label");--> statement-breakpoint
CREATE INDEX "boardSeries_entryDeadline_idx" ON "board_series" USING btree ("entry_deadline");--> statement-breakpoint
CREATE INDEX "courseEnrolment_year_idx" ON "course_enrolment" USING btree ("academic_year_id");--> statement-breakpoint
CREATE INDEX "courseEnrolment_studentId_idx" ON "course_enrolment" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "courseEnrolment_subjectId_idx" ON "course_enrolment" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "courseEnrolment_teacherId_idx" ON "course_enrolment" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courseEnrolment_one_open_idx" ON "course_enrolment" USING btree ("student_id","subject_id","academic_year_id") WHERE ended_on IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "examUnit_board_code_idx" ON "exam_unit" USING btree ("board_code","code");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_board_code_level_idx" ON "qualification" USING btree ("board_code","code","level");--> statement-breakpoint
CREATE UNIQUE INDEX "qualificationOption_code_idx" ON "qualification_option" USING btree ("qualification_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "qualificationUnit_unique_idx" ON "qualification_unit" USING btree ("qualification_id","unit_id");--> statement-breakpoint
CREATE INDEX "qualificationUnit_unitId_idx" ON "qualification_unit" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessionBoardSeries_one_default_idx" ON "session_board_series" USING btree ("session_id","board_code") WHERE is_default;--> statement-breakpoint
CREATE INDEX "sessionBoardSeries_seriesId_idx" ON "session_board_series" USING btree ("board_series_id");--> statement-breakpoint
CREATE INDEX "subjectUnit_unitId_idx" ON "subject_unit" USING btree ("unit_id");--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_board_series_link_fk" FOREIGN KEY ("session_id","board_series_id") REFERENCES "public"."session_board_series"("session_id","board_series_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_qualification_id_qualification_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "public"."qualification"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_boardSeriesId_idx" ON "registration" USING btree ("board_series_id");--> statement-breakpoint
CREATE INDEX "subject_qualificationId_idx" ON "subject" USING btree ("qualification_id");