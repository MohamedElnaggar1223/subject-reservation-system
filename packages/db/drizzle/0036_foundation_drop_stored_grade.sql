ALTER TABLE "grade_progression_run" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "grade_progression_run" CASCADE;--> statement-breakpoint
ALTER TABLE "registration_session" ALTER COLUMN "series_year" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "reg_session_series_idx" ON "registration_session" USING btree ("session_type","series_year");--> statement-breakpoint
ALTER TABLE "registration_session" DROP COLUMN "grade_progression_completed_at";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "grade";--> statement-breakpoint
ALTER TABLE "registration_session" ADD CONSTRAINT "session_series_year_range" CHECK ("registration_session"."series_year" BETWEEN 2000 AND 2100);