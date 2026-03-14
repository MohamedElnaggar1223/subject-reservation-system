CREATE TABLE "change_request" (
	"id" text PRIMARY KEY NOT NULL,
	"registration_id" text NOT NULL,
	"type" text NOT NULL,
	"requested_by" text NOT NULL,
	"reason" text NOT NULL,
	"new_subject_id" text,
	"price_at_request" double precision NOT NULL,
	"price_difference" double precision NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"approved_by" text,
	"comments" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_new_subject_id_subject_id_fk" FOREIGN KEY ("new_subject_id") REFERENCES "public"."subject"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changeReq_registrationId_idx" ON "change_request" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "changeReq_requestedBy_idx" ON "change_request" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "changeReq_status_idx" ON "change_request" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "changeReq_one_pending_per_registration_idx" ON "change_request" USING btree ("registration_id") WHERE status = 'pending_approval';