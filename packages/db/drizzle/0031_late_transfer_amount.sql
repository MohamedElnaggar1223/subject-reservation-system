ALTER TABLE "payment" ADD COLUMN "late_transfer_amount" numeric(12, 2);--> statement-breakpoint
-- A transfer recorded before the amount was asked for credited the payment's amount.
UPDATE "payment" SET "late_transfer_amount" = "amount" WHERE "late_transfer_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_late_transfer_recorded_whole" CHECK (("payment"."late_transfer_at" IS NULL AND "payment"."late_transfer_amount" IS NULL) OR ("payment"."late_transfer_at" IS NOT NULL AND "payment"."late_transfer_amount" > 0));
