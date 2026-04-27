ALTER TABLE "registration" ADD COLUMN "was_core_at_registration" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: historical registrations inherit the current isCore flag of
-- their subject. From this point forward the value is a true snapshot set
-- at registration-time insert, but existing rows need a one-time copy so
-- that CORE-002 enforcement is stable for the current cohort.
UPDATE "registration" AS r
SET "was_core_at_registration" = s."is_core"
FROM "subject" AS s
WHERE r."subject_id" = s."id";