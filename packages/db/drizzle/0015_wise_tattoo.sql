CREATE TABLE "scheduled_announcement" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"recipients" text NOT NULL,
	"send_email" boolean DEFAULT true NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"notification_count" integer,
	"error_message" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "registration_unique_active_idx";--> statement-breakpoint
ALTER TABLE "registration_session" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_announcement" ADD CONSTRAINT "scheduled_announcement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedAnn_status_idx" ON "scheduled_announcement" USING btree ("status");--> statement-breakpoint
CREATE INDEX "schedAnn_scheduledAt_idx" ON "scheduled_announcement" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "parentStudentLink_unique_pair_idx" ON "parent_student_link" USING btree ("parent_id","student_id") WHERE status IN ('pending', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX "registration_unique_active_idx" ON "registration" USING btree ("student_id","session_id","subject_id") WHERE status NOT IN ('dropped', 'rejected', 'expired');