CREATE TABLE "exception" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"student_id" text NOT NULL,
	"session_id" text,
	"subject_id" text,
	"value" numeric(12, 2),
	"reason" text NOT NULL,
	"valid_until" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"granted_by" text NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exception_value_nonneg" CHECK ("exception"."value" IS NULL OR "exception"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_session_id_registration_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."registration_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exception_studentId_idx" ON "exception" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "exception_type_idx" ON "exception" USING btree ("type");--> statement-breakpoint
CREATE INDEX "exception_status_idx" ON "exception" USING btree ("status");