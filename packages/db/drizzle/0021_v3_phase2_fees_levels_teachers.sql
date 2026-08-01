CREATE TABLE "grade_progression_run" (
	"id" text PRIMARY KEY NOT NULL,
	"session_type" text NOT NULL,
	"series_year" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_fee_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"academic_year" text NOT NULL,
	"grade" integer,
	"amount" numeric(12, 2) NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schoolFee_amount_nonneg" CHECK ("school_fee_schedule"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subject_teacher" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "one_active_per_session_type_idx";--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "academic_year" text;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "course_fee_at_registration" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "registration_fee_at_registration" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "is_retake" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "taken_outside_school" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "teacher_id" text;--> statement-breakpoint
ALTER TABLE "registration_session" ADD COLUMN "qualification_level" text DEFAULT 'igcse' NOT NULL;--> statement-breakpoint
ALTER TABLE "subject" ADD COLUMN "course_fee" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subject" ADD COLUMN "registration_fee" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subject" ADD COLUMN "qualification_level" text DEFAULT 'igcse' NOT NULL;--> statement-breakpoint
ALTER TABLE "subject_teacher" ADD CONSTRAINT "subject_teacher_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_teacher" ADD CONSTRAINT "subject_teacher_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gradeProgressionRun_unique_idx" ON "grade_progression_run" USING btree ("session_type","series_year");--> statement-breakpoint
CREATE INDEX "schoolFee_academicYear_idx" ON "school_fee_schedule" USING btree ("academic_year");--> statement-breakpoint
CREATE UNIQUE INDEX "schoolFee_year_grade_idx" ON "school_fee_schedule" USING btree ("academic_year","grade") WHERE grade IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "schoolFee_year_uniform_idx" ON "school_fee_schedule" USING btree ("academic_year") WHERE grade IS NULL;--> statement-breakpoint
CREATE INDEX "subjectTeacher_subjectId_idx" ON "subject_teacher" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "subjectTeacher_teacherId_idx" ON "subject_teacher" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjectTeacher_unique_idx" ON "subject_teacher" USING btree ("subject_id","teacher_id");--> statement-breakpoint
CREATE INDEX "teacher_isActive_idx" ON "teacher" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subject_qualificationLevel_idx" ON "subject" USING btree ("qualification_level");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_per_session_type_idx" ON "registration_session" USING btree ("session_type","qualification_level") WHERE status = 'active';--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_course_fee_nonneg" CHECK ("subject"."course_fee" >= 0);--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_registration_fee_nonneg" CHECK ("subject"."registration_fee" >= 0);--> statement-breakpoint
-- V3 backfill (§7): existing subjects carry the old single price as course fee
UPDATE "subject" SET "course_fee" = "price_in_school" WHERE "course_fee" = 0;--> statement-breakpoint
-- Existing registrations: the total snapshot becomes the course-fee component
UPDATE "registration" SET "course_fee_at_registration" = "price_at_registration" WHERE "course_fee_at_registration" = 0;
