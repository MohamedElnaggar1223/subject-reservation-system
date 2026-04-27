ALTER TABLE "registration_session" ADD COLUMN "grade_progression_completed_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: mark already-closed sessions as "progression complete" so the
-- retry sweep doesn't re-run progressGrades on sessions that closed before
-- this column existed. Admins can manually clear this column if a specific
-- historical session still needs progression.
UPDATE "registration_session"
SET "grade_progression_completed_at" = COALESCE("closed_at", "updated_at")
WHERE "status" = 'closed';