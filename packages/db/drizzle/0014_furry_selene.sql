ALTER TABLE "withdrawal_request" RENAME COLUMN "fulfilled_at" TO "resolved_at";--> statement-breakpoint
ALTER TABLE "withdrawal_request" RENAME COLUMN "fulfilled_by" TO "resolved_by";--> statement-breakpoint
ALTER TABLE "escrow" DROP CONSTRAINT "escrow_student_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "escrow_transaction" DROP CONSTRAINT "escrow_transaction_escrow_id_escrow_id_fk";
--> statement-breakpoint
ALTER TABLE "registration" DROP CONSTRAINT "registration_student_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "withdrawal_request" DROP CONSTRAINT "withdrawal_request_fulfilled_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "withdrawal_request" DROP CONSTRAINT "withdrawal_request_escrow_id_escrow_id_fk";
--> statement-breakpoint
ALTER TABLE "change_request" ALTER COLUMN "price_at_request" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "change_request" ALTER COLUMN "price_difference" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "escrow" ALTER COLUMN "balance" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "escrow_transaction" ALTER COLUMN "amount" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "file" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "file" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "file_variant" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file_variant" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "parent_student_link" ALTER COLUMN "requested_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parent_student_link" ALTER COLUMN "requested_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "parent_student_link" ALTER COLUMN "responded_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parent_student_link" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parent_student_link" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "parent_student_link" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parent_student_link" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "amount" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "escrow_amount_applied" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "registration" ALTER COLUMN "price_at_registration" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "subject" ALTER COLUMN "price_in_school" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "subject" ALTER COLUMN "custom_price" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "subject" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subject" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "subject" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subject" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "todo" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "todo" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "todo" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "todo" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "withdrawal_request" ALTER COLUMN "requested_amount" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "withdrawal_request" ALTER COLUMN "released_amount" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "registration_session" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "escrow" ADD CONSTRAINT "escrow_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_transaction" ADD CONSTRAINT "escrow_transaction_escrow_id_escrow_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrow"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_escrow_id_escrow_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrow"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow" ADD CONSTRAINT "escrow_balance_non_negative" CHECK (balance >= 0);--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_amount_positive" CHECK (amount > 0);--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_escrow_applied_non_negative" CHECK (escrow_amount_applied >= 0);--> statement-breakpoint
ALTER TABLE "escrow_transaction" ADD CONSTRAINT "escrow_tx_amount_positive" CHECK (amount > 0);--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_req_amount_positive" CHECK (requested_amount > 0);