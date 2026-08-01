CREATE TABLE "remark_deadline" (
	"id" text PRIMARY KEY NOT NULL,
	"council" text NOT NULL,
	"session_id" text NOT NULL,
	"service_type" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remark_fee_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"council" text NOT NULL,
	"service_type" text NOT NULL,
	"amount_per_paper" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remarkFee_amount_nonneg" CHECK ("remark_fee_schedule"."amount_per_paper" >= 0)
);
--> statement-breakpoint
CREATE TABLE "remark_request" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"registration_id" text NOT NULL,
	"service_type" text NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"consent_file_id" text,
	"consent_confirmed_by" text,
	"consent_confirmed_at" timestamp with time zone,
	"board_reference" text,
	"fee_charged" numeric(12, 2) DEFAULT 0 NOT NULL,
	"fee_refunded" boolean DEFAULT false NOT NULL,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remark_fee_nonneg" CHECK ("remark_request"."fee_charged" >= 0)
);
--> statement-breakpoint
CREATE TABLE "remark_request_item" (
	"id" text PRIMARY KEY NOT NULL,
	"remark_request_id" text NOT NULL,
	"paper_code" text NOT NULL,
	"paper_name" text,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"grade_after" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "grade_received" text;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "result_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "result_recorded_by" text;--> statement-breakpoint
ALTER TABLE "remark_deadline" ADD CONSTRAINT "remark_deadline_session_id_registration_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."registration_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remark_request" ADD CONSTRAINT "remark_request_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remark_request" ADD CONSTRAINT "remark_request_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remark_request" ADD CONSTRAINT "remark_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remark_request" ADD CONSTRAINT "remark_request_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remark_request" ADD CONSTRAINT "remark_request_consent_file_id_file_id_fk" FOREIGN KEY ("consent_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remark_request" ADD CONSTRAINT "remark_request_consent_confirmed_by_user_id_fk" FOREIGN KEY ("consent_confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remark_request_item" ADD CONSTRAINT "remark_request_item_remark_request_id_remark_request_id_fk" FOREIGN KEY ("remark_request_id") REFERENCES "public"."remark_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "remarkDeadline_unique_idx" ON "remark_deadline" USING btree ("council","session_id","service_type");--> statement-breakpoint
CREATE UNIQUE INDEX "remarkFee_council_service_idx" ON "remark_fee_schedule" USING btree ("council","service_type");--> statement-breakpoint
CREATE INDEX "remark_studentId_idx" ON "remark_request" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "remark_registrationId_idx" ON "remark_request" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "remark_status_idx" ON "remark_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "remarkItem_requestId_idx" ON "remark_request_item" USING btree ("remark_request_id");--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_result_recorded_by_user_id_fk" FOREIGN KEY ("result_recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;