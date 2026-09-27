CREATE TABLE "withdrawal_disbursement" (
	"id" text PRIMARY KEY NOT NULL,
	"withdrawal_request_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"disbursed_by" text,
	"disbursed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "withdrawal_disbursement_amount_positive" CHECK ("withdrawal_disbursement"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "reversed_by" text;--> statement-breakpoint
ALTER TABLE "withdrawal_disbursement" ADD CONSTRAINT "withdrawal_disbursement_withdrawal_request_id_withdrawal_request_id_fk" FOREIGN KEY ("withdrawal_request_id") REFERENCES "public"."withdrawal_request"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_disbursement" ADD CONSTRAINT "withdrawal_disbursement_disbursed_by_user_id_fk" FOREIGN KEY ("disbursed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawalDisb_requestId_idx" ON "withdrawal_disbursement" USING btree ("withdrawal_request_id");--> statement-breakpoint
CREATE INDEX "withdrawalDisb_disbursedAt_idx" ON "withdrawal_disbursement" USING btree ("disbursed_at");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_reversed_by_user_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_confirmedAt_idx" ON "payment" USING btree ("confirmed_at");--> statement-breakpoint
CREATE INDEX "payment_reversedAt_idx" ON "payment" USING btree ("reversed_at");--> statement-breakpoint
-- Backfill (money audit MA-05): reversals so far kept their time and actor only
-- in metadata.reversal; a refunded payment without one falls back to updated_at.
UPDATE "payment" p
SET "reversed_at" = COALESCE((p."metadata"->'reversal'->>'at')::timestamptz, p."updated_at"),
    "reversed_by" = (SELECT u."id" FROM "user" u WHERE u."id" = p."metadata"->'reversal'->>'by')
WHERE p."status" = 'refunded';--> statement-breakpoint
-- Backfill (money audit MA-09): one disbursement per request that released
-- money, dated at its last resolution. Earlier partial hand-overs were never
-- recorded separately, so they are merged into this one row.
INSERT INTO "withdrawal_disbursement" ("id", "withdrawal_request_id", "amount", "disbursed_by", "disbursed_at", "notes")
SELECT gen_random_uuid()::text, w."id", w."released_amount", w."resolved_by", COALESCE(w."resolved_at", w."updated_at"),
       'Backfilled by migration 0028 from the request total'
FROM "withdrawal_request" w
WHERE w."released_amount" IS NOT NULL AND w."released_amount" > 0;