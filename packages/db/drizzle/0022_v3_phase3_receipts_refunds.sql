CREATE TABLE "receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"registration_id" text NOT NULL,
	"receipt_number" text NOT NULL,
	"status" text DEFAULT 'pending_issue' NOT NULL,
	"issued_by" text,
	"issued_at" timestamp with time zone,
	"returned_to" text,
	"returned_at" timestamp with time zone,
	"refund_amount_on_return" numeric(12, 2),
	"refund_reason" text,
	"refund_initiated_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_registration_id_unique" UNIQUE("registration_id"),
	CONSTRAINT "receipt_receipt_number_unique" UNIQUE("receipt_number"),
	CONSTRAINT "receipt_refund_nonneg" CHECK ("receipt"."refund_amount_on_return" IS NULL OR "receipt"."refund_amount_on_return" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refund_window" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"academic_year" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"percentage" numeric(5, 2) NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refundWindow_pct_range" CHECK ("refund_window"."percentage" >= 0 AND "refund_window"."percentage" <= 100),
	CONSTRAINT "refundWindow_one_scope" CHECK (("refund_window"."session_id" IS NOT NULL AND "refund_window"."academic_year" IS NULL) OR ("refund_window"."session_id" IS NULL AND "refund_window"."academic_year" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_returned_to_user_id_fk" FOREIGN KEY ("returned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_refund_initiated_by_user_id_fk" FOREIGN KEY ("refund_initiated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_window" ADD CONSTRAINT "refund_window_session_id_registration_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."registration_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_status_idx" ON "receipt" USING btree ("status");--> statement-breakpoint
CREATE INDEX "receipt_number_idx" ON "receipt" USING btree ("receipt_number");--> statement-breakpoint
CREATE INDEX "refundWindow_sessionId_idx" ON "refund_window" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "refundWindow_academicYear_idx" ON "refund_window" USING btree ("academic_year");--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- D-I backfill: existing confirmed registrations get receipts assumed issued
-- (parents already hold the paper); finance fixes stragglers inline.
INSERT INTO "receipt" ("id", "registration_id", "receipt_number", "status", "issued_at")
SELECT
  md5(random()::text || r."id"),
  r."id",
  'RCP-' || upper(substr(replace(r."id", '-', ''), 1, 10)),
  'issued',
  now()
FROM "registration" r
WHERE r."status" = 'confirmed'
ON CONFLICT DO NOTHING;
