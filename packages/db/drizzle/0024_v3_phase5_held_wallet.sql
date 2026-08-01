ALTER TABLE "escrow" ADD COLUMN "held_balance" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "escrow_transaction" ADD COLUMN "balance_type" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "escrow" ADD CONSTRAINT "escrow_held_balance_nonneg" CHECK ("escrow"."held_balance" >= 0);