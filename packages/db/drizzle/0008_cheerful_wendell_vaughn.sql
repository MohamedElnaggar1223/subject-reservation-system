CREATE TABLE "registration_session" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"session_type" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"edit_history" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registration_session" ADD CONSTRAINT "registration_session_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reg_session_status_idx" ON "registration_session" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reg_session_type_idx" ON "registration_session" USING btree ("session_type");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_per_session_type_idx" ON "registration_session" USING btree ("session_type") WHERE status = 'active';