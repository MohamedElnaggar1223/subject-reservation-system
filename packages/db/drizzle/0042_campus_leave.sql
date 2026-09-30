CREATE TABLE "leave_collector" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"relation" text NOT NULL,
	"phone" text NOT NULL,
	"id_number" text NOT NULL,
	"photo_file_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"withdrawn_by" text,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_reason" text,
	CONSTRAINT "leave_collector_status_valid" CHECK ("leave_collector"."status" IN ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "leave_collector_decided" CHECK ("leave_collector"."status" NOT IN ('approved', 'rejected') OR ("leave_collector"."decided_at" IS NOT NULL)),
	CONSTRAINT "leave_collector_rejected_reason" CHECK ("leave_collector"."status" <> 'rejected' OR "leave_collector"."decision_reason" IS NOT NULL),
	CONSTRAINT "leave_collector_withdrawn" CHECK ("leave_collector"."status" <> 'withdrawn' OR "leave_collector"."withdrawn_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "leave_collector_student" (
	"collector_id" text NOT NULL,
	"student_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_collector_student_collector_id_student_id_pk" PRIMARY KEY("collector_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "leave_custody_restriction" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"person_name" text NOT NULL,
	"relation" text,
	"id_number" text,
	"restricted_user_id" text,
	"photo_file_id" text,
	"document_file_id" text,
	"note" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"end_reason" text,
	CONSTRAINT "leave_custody_restriction_ended" CHECK (("leave_custody_restriction"."ended_at" IS NULL) = ("leave_custody_restriction"."end_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "leave_request" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"series_id" text,
	"date" date NOT NULL,
	"leave_time" text NOT NULL,
	"returning" boolean DEFAULT false NOT NULL,
	"return_time" text,
	"reason_category" text NOT NULL,
	"reason_label" text NOT NULL,
	"note" text,
	"document_file_id" text,
	"collector_kind" text NOT NULL,
	"collector_parent_id" text,
	"collector_id" text,
	"origin" text NOT NULL,
	"on_behalf_of" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"pass_version" integer DEFAULT 1 NOT NULL,
	"checked_out_at" timestamp with time zone,
	"checked_out_by" text,
	"collected_by_kind" text,
	"collected_by_parent_id" text,
	"collected_by_collector_id" text,
	"collected_by_name" text,
	"id_checked" boolean,
	"checked_out_via" text,
	"checkout_note" text,
	"returned_at" timestamp with time zone,
	"return_recorded_by" text,
	"no_show_at" timestamp with time zone,
	"late_return_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_request_status_valid" CHECK ("leave_request"."status" IN ('pending', 'approved', 'rejected', 'cancelled', 'checked_out', 'returned')),
	CONSTRAINT "leave_request_origin_valid" CHECK ("leave_request"."origin" IN ('parent', 'desk', 'school')),
	CONSTRAINT "leave_request_times" CHECK ("leave_request"."leave_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ("leave_request"."return_time" IS NULL OR "leave_request"."return_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')),
	CONSTRAINT "leave_request_return" CHECK (("leave_request"."returning" AND "leave_request"."return_time" IS NOT NULL AND "leave_request"."return_time" > "leave_request"."leave_time") OR (NOT "leave_request"."returning" AND "leave_request"."return_time" IS NULL)),
	CONSTRAINT "leave_request_collector_kind" CHECK ("leave_request"."collector_kind" IN ('parent', 'collector', 'alone')),
	CONSTRAINT "leave_request_collector_whole" CHECK (("leave_request"."collector_kind" = 'parent' OR "leave_request"."collector_parent_id" IS NULL) AND ("leave_request"."collector_kind" = 'collector' OR "leave_request"."collector_id" IS NULL)),
	CONSTRAINT "leave_request_decided" CHECK ("leave_request"."status" NOT IN ('approved', 'rejected', 'checked_out', 'returned') OR "leave_request"."decided_at" IS NOT NULL),
	CONSTRAINT "leave_request_rejected_reason" CHECK ("leave_request"."status" <> 'rejected' OR "leave_request"."decision_note" IS NOT NULL),
	CONSTRAINT "leave_request_cancelled" CHECK (("leave_request"."status" = 'cancelled') = ("leave_request"."cancelled_at" IS NOT NULL)),
	CONSTRAINT "leave_request_checked_out" CHECK (("leave_request"."status" IN ('checked_out', 'returned')) = ("leave_request"."checked_out_at" IS NOT NULL AND "leave_request"."collected_by_kind" IS NOT NULL)),
	CONSTRAINT "leave_request_collected_kind" CHECK ("leave_request"."collected_by_kind" IS NULL OR "leave_request"."collected_by_kind" IN ('parent', 'collector', 'alone')),
	CONSTRAINT "leave_request_returned" CHECK (("leave_request"."status" = 'returned') = ("leave_request"."returned_at" IS NOT NULL) AND ("leave_request"."status" <> 'returned' OR "leave_request"."returning")),
	CONSTRAINT "leave_request_via" CHECK ("leave_request"."checked_out_via" IS NULL OR "leave_request"."checked_out_via" IN ('pass', 'lookup')),
	CONSTRAINT "leave_request_late_return_flag" CHECK ("leave_request"."late_return_at" IS NULL OR ("leave_request"."returning" AND "leave_request"."checked_out_at" IS NOT NULL)),
	CONSTRAINT "leave_request_pass_version" CHECK ("leave_request"."pass_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "leave_series" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"weekdays" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_series_dates_ordered" CHECK ("leave_series"."starts_on" <= "leave_series"."ends_on")
);
--> statement-breakpoint
ALTER TABLE "leave_collector" ADD CONSTRAINT "leave_collector_photo_file_id_file_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_collector" ADD CONSTRAINT "leave_collector_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_collector" ADD CONSTRAINT "leave_collector_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_collector" ADD CONSTRAINT "leave_collector_withdrawn_by_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_collector_student" ADD CONSTRAINT "leave_collector_student_collector_id_leave_collector_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."leave_collector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_collector_student" ADD CONSTRAINT "leave_collector_student_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_custody_restriction" ADD CONSTRAINT "leave_custody_restriction_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_custody_restriction" ADD CONSTRAINT "leave_custody_restriction_restricted_user_id_user_id_fk" FOREIGN KEY ("restricted_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_custody_restriction" ADD CONSTRAINT "leave_custody_restriction_photo_file_id_file_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_custody_restriction" ADD CONSTRAINT "leave_custody_restriction_document_file_id_file_id_fk" FOREIGN KEY ("document_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_custody_restriction" ADD CONSTRAINT "leave_custody_restriction_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_custody_restriction" ADD CONSTRAINT "leave_custody_restriction_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_series_id_leave_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."leave_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_document_file_id_file_id_fk" FOREIGN KEY ("document_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_collector_parent_id_user_id_fk" FOREIGN KEY ("collector_parent_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_collector_id_leave_collector_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."leave_collector"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_on_behalf_of_user_id_fk" FOREIGN KEY ("on_behalf_of") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_checked_out_by_user_id_fk" FOREIGN KEY ("checked_out_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_collected_by_parent_id_user_id_fk" FOREIGN KEY ("collected_by_parent_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_collected_by_collector_id_leave_collector_id_fk" FOREIGN KEY ("collected_by_collector_id") REFERENCES "public"."leave_collector"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_return_recorded_by_user_id_fk" FOREIGN KEY ("return_recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_series" ADD CONSTRAINT "leave_series_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_series" ADD CONSTRAINT "leave_series_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leaveCollector_status_idx" ON "leave_collector" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leaveCollectorStudent_studentId_idx" ON "leave_collector_student" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "leaveCustodyRestriction_studentId_idx" ON "leave_custody_restriction" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "leaveRequest_student_date_idx" ON "leave_request" USING btree ("student_id","date");--> statement-breakpoint
CREATE INDEX "leaveRequest_date_status_idx" ON "leave_request" USING btree ("date","status");--> statement-breakpoint
CREATE INDEX "leaveRequest_seriesId_idx" ON "leave_request" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "leaveRequest_status_idx" ON "leave_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leaveSeries_studentId_idx" ON "leave_series" USING btree ("student_id");