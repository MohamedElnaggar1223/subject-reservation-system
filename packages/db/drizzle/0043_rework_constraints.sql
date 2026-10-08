DROP INDEX "registration_unique_active_idx";--> statement-breakpoint
ALTER TABLE "registration" ALTER COLUMN "offer_item_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "registration" ALTER COLUMN "due_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_session" ALTER COLUMN "course_starts_on" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_session" ALTER COLUMN "payment_due_at" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "registration_unique_live_item_idx" ON "registration" USING btree ("student_id","session_id","offer_item_id") WHERE status NOT IN ('dropped', 'rejected', 'expired');--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_session_per_cycle_idx" ON "registration_session" USING btree ("session_type","series_year","label") WHERE status = 'active';--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_retake_is_attempt" CHECK ("registration"."is_retake" = ("registration"."attempt" = 'retake'));--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_outside_is_mode" CHECK ("registration"."taken_outside_school" = ("registration"."mode" = 'self_study'));--> statement-breakpoint
ALTER TABLE "registration_session" ADD CONSTRAINT "session_type_valid" CHECK ("registration_session"."session_type" IN ('june', 'winter'));