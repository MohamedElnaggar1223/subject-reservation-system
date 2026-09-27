ALTER TABLE "payment" ADD COLUMN "reversal_money_returned" boolean;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "reference_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registration_session" ADD COLUMN "entry_deadline" timestamp with time zone;--> statement-breakpoint
-- Backfill (owner decision MO-11): reversals made before the question existed
-- were reported as money out on their own day; keep that reading for them.
UPDATE "payment" SET "reversal_money_returned" = true WHERE "status" = 'refunded';