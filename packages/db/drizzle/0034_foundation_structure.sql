CREATE TABLE "academic_term" (
	"id" text PRIMARY KEY NOT NULL,
	"academic_year_id" text NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_term_dates_ordered" CHECK ("academic_term"."starts_on" <= "academic_term"."ends_on")
);
--> statement-breakpoint
CREATE TABLE "academic_year" (
	"id" text PRIMARY KEY NOT NULL,
	"start_year" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_year_dates_ordered" CHECK ("academic_year"."starts_on" <= "academic_year"."ends_on"),
	CONSTRAINT "academic_year_dates_inside" CHECK ("academic_year"."starts_on" >= make_date("academic_year"."start_year", 7, 1) AND "academic_year"."ends_on" <= make_date("academic_year"."start_year" + 1, 6, 30))
);
--> statement-breakpoint
CREATE TABLE "bell_period" (
	"id" text PRIMARY KEY NOT NULL,
	"bell_schedule_id" text NOT NULL,
	"weekday" integer,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	CONSTRAINT "bell_period_weekday_range" CHECK ("bell_period"."weekday" IS NULL OR "bell_period"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "bell_period_times" CHECK ("bell_period"."starts_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "bell_period"."ends_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "bell_period"."ends_at" > "bell_period"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "bell_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"academic_year_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"academic_year_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"bell_schedule_id" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_entry_dates_ordered" CHECK ("calendar_entry"."starts_on" <= "calendar_entry"."ends_on"),
	CONSTRAINT "calendar_entry_kind_valid" CHECK ("calendar_entry"."kind" IN ('holiday', 'early_dismissal', 'exam_only', 'school_day'))
);
--> statement-breakpoint
CREATE TABLE "room" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	"type" text DEFAULT 'classroom' NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_capacity_positive" CHECK ("room"."capacity" IS NULL OR "room"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "school_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "section" (
	"id" text PRIMARY KEY NOT NULL,
	"academic_year_id" text NOT NULL,
	"grade" integer NOT NULL,
	"name" text NOT NULL,
	"homeroom_teacher_id" text,
	"room_id" text,
	"capacity" integer,
	"rolled_from_section_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_grade_range" CHECK ("section"."grade" BETWEEN 10 AND 12),
	CONSTRAINT "section_capacity_positive" CHECK ("section"."capacity" IS NULL OR "section"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "section_membership" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"student_id" text NOT NULL,
	"academic_year_id" text NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"end_reason" text,
	"added_by" text,
	"ended_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_membership_dates_ordered" CHECK ("section_membership"."ended_on" IS NULL OR "section_membership"."ended_on" >= "section_membership"."started_on")
);
--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "purpose" text DEFAULT 'document' NOT NULL;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "student_id" text;--> statement-breakpoint
ALTER TABLE "registration_session" ADD COLUMN "series_year" integer;--> statement-breakpoint
ALTER TABLE "teacher" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "cohort_year" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "left_on" date;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "left_kind" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "left_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "left_recorded_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "left_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "academic_term" ADD CONSTRAINT "academic_term_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bell_period" ADD CONSTRAINT "bell_period_bell_schedule_id_bell_schedule_id_fk" FOREIGN KEY ("bell_schedule_id") REFERENCES "public"."bell_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bell_schedule" ADD CONSTRAINT "bell_schedule_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entry" ADD CONSTRAINT "calendar_entry_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entry" ADD CONSTRAINT "calendar_entry_bell_schedule_id_bell_schedule_id_fk" FOREIGN KEY ("bell_schedule_id") REFERENCES "public"."bell_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entry" ADD CONSTRAINT "calendar_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_setting" ADD CONSTRAINT "school_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_homeroom_teacher_id_teacher_id_fk" FOREIGN KEY ("homeroom_teacher_id") REFERENCES "public"."teacher"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_rolled_from_section_id_section_id_fk" FOREIGN KEY ("rolled_from_section_id") REFERENCES "public"."section"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_membership" ADD CONSTRAINT "section_membership_section_id_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_membership" ADD CONSTRAINT "section_membership_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_membership" ADD CONSTRAINT "section_membership_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_membership" ADD CONSTRAINT "section_membership_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_membership" ADD CONSTRAINT "section_membership_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academicTerm_yearId_idx" ON "academic_term" USING btree ("academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "academicYear_startYear_idx" ON "academic_year" USING btree ("start_year");--> statement-breakpoint
CREATE INDEX "bellPeriod_scheduleId_idx" ON "bell_period" USING btree ("bell_schedule_id");--> statement-breakpoint
CREATE INDEX "bellSchedule_yearId_idx" ON "bell_schedule" USING btree ("academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bellSchedule_one_default_idx" ON "bell_schedule" USING btree ("academic_year_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "calendarEntry_yearId_idx" ON "calendar_entry" USING btree ("academic_year_id");--> statement-breakpoint
CREATE INDEX "calendarEntry_dates_idx" ON "calendar_entry" USING btree ("starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "room_name_unique_idx" ON "room" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "section_yearId_idx" ON "section" USING btree ("academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "section_year_name_idx" ON "section" USING btree ("academic_year_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "section_rolled_from_idx" ON "section" USING btree ("rolled_from_section_id");--> statement-breakpoint
CREATE INDEX "sectionMembership_sectionId_idx" ON "section_membership" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "sectionMembership_studentId_idx" ON "section_membership" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sectionMembership_one_open_per_year_idx" ON "section_membership" USING btree ("student_id","academic_year_id") WHERE ended_on IS NULL;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher" ADD CONSTRAINT "teacher_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_left_recorded_by_user_id_fk" FOREIGN KEY ("left_recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_studentId_idx" ON "file" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "file_purpose_idx" ON "file" USING btree ("purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_userId_unique_idx" ON "teacher" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_cohortYear_idx" ON "user" USING btree ("cohort_year");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_left_kind_valid" CHECK ("user"."left_kind" IS NULL OR "user"."left_kind" IN ('withdrawn', 'transferred'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_left_whole" CHECK (("user"."left_on" IS NULL) = ("user"."left_kind" IS NULL));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_cohort_year_range" CHECK ("user"."cohort_year" IS NULL OR "user"."cohort_year" BETWEEN 2000 AND 2100);