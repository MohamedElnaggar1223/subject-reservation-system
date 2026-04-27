ALTER TABLE "change_request" ADD CONSTRAINT "change_request_price_at_request_nonneg" CHECK ("change_request"."price_at_request" >= 0);--> statement-breakpoint
ALTER TABLE "escrow" ADD CONSTRAINT "escrow_balance_nonneg" CHECK ("escrow"."balance" >= 0);--> statement-breakpoint
ALTER TABLE "escrow_transaction" ADD CONSTRAINT "escrowTx_amount_positive" CHECK ("escrow_transaction"."amount" > 0);--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_amount_nonneg" CHECK ("payment"."amount" >= 0);--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_escrow_applied_nonneg" CHECK ("payment"."escrow_amount_applied" >= 0);--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_price_at_registration_nonneg" CHECK ("registration"."price_at_registration" >= 0);--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_price_in_school_nonneg" CHECK ("subject"."price_in_school" >= 0);--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_custom_price_nonneg" CHECK ("subject"."custom_price" IS NULL OR "subject"."custom_price" >= 0);--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_requested_positive" CHECK ("withdrawal_request"."requested_amount" > 0);--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_released_nonneg" CHECK ("withdrawal_request"."released_amount" IS NULL OR "withdrawal_request"."released_amount" >= 0);--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_released_le_requested" CHECK ("withdrawal_request"."released_amount" IS NULL OR "withdrawal_request"."released_amount" <= "withdrawal_request"."requested_amount");