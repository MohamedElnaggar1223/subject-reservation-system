DROP INDEX "registrationConsent_unique_idx";--> statement-breakpoint
ALTER TABLE "change_request" ADD COLUMN "new_line" jsonb;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "prior_sitting_verified_by" text;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "prior_sitting_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "prior_sitting_verified_outcome" text;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "declaration_rejected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_prior_sitting_verified_by_user_id_fk" FOREIGN KEY ("prior_sitting_verified_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_to_verify_idx" ON "registration" USING btree ("session_id") WHERE prior_sitting_source IN ('declared_by_family', 'declared_by_desk') AND prior_sitting_verified_outcome IS NULL;--> statement-breakpoint
CREATE INDEX "registrationConsent_registrationId_idx" ON "registration_consent" USING btree ("registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrationConsent_unique_idx" ON "registration_consent" USING btree ("registration_id","kind","channel");--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_prior_sitting_outcome_valid" CHECK ("registration"."prior_sitting_verified_outcome" IS NULL OR ("registration"."prior_sitting_verified_outcome" IN ('verified', 'rejected') AND "registration"."prior_sitting_verified_at" IS NOT NULL AND "registration"."prior_sitting_series_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_declaration_rejected_outcome" CHECK (NOT "registration"."declaration_rejected" OR "registration"."prior_sitting_verified_outcome" = 'rejected');