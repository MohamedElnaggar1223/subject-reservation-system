ALTER TABLE "registration_session" ADD COLUMN "finalized_at" timestamp with time zone;--> statement-breakpoint
-- Sessions closed before this column existed were finalised when they closed;
-- running finalisation again would expire registrations made since under a
-- deadline extension, so they are marked finalised as of their close.
UPDATE "registration_session" SET "finalized_at" = COALESCE("closed_at", "updated_at") WHERE "status" = 'closed';
