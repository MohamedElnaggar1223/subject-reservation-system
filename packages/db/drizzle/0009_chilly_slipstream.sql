CREATE TABLE "registration" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"session_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"price_at_registration" double precision NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"approval_comments" text,
	"dropped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_session_id_registration_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."registration_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_studentId_idx" ON "registration" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "registration_sessionId_idx" ON "registration" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "registration_subjectId_idx" ON "registration" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "registration_status_idx" ON "registration" USING btree ("status");--> statement-breakpoint
CREATE INDEX "registration_requestedBy_idx" ON "registration" USING btree ("requested_by");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_unique_active_idx" ON "registration" USING btree ("student_id","session_id","subject_id") WHERE status NOT IN ('dropped', 'rejected');