CREATE TABLE "board_service" (
	"id" text PRIMARY KEY NOT NULL,
	"board_code" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"per_component" boolean DEFAULT false NOT NULL,
	"level_rates" boolean DEFAULT false NOT NULL,
	"refund_rule" text DEFAULT 'full' NOT NULL,
	"refund_deduction" numeric(12, 2),
	"requestable_by_family" boolean DEFAULT false NOT NULL,
	"legacy_service_type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_service_kind_valid" CHECK ("board_service"."kind" IN ('remark', 'cash_in', 'late_cash_in', 'certificate_split')),
	CONSTRAINT "board_service_refund_rule_valid" CHECK ("board_service"."refund_rule" IN ('none', 'full', 'less_fixed')),
	CONSTRAINT "board_service_deduction_whole" CHECK (("board_service"."refund_rule" = 'less_fixed') = ("board_service"."refund_deduction" IS NOT NULL AND "board_service"."refund_deduction" > 0))
);
--> statement-breakpoint
CREATE TABLE "board_service_deadline" (
	"id" text PRIMARY KEY NOT NULL,
	"board_series_id" text NOT NULL,
	"board_service_id" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"set_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_service_fee" (
	"id" text PRIMARY KEY NOT NULL,
	"board_series_id" text NOT NULL,
	"board_service_id" text NOT NULL,
	"level" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"copied_from_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_service_fee_level_valid" CHECK ("board_service_fee"."level" IN ('igcse', 'as_a_level')),
	CONSTRAINT "board_service_fee_amount_nonneg" CHECK ("board_service_fee"."amount" >= 0),
	CONSTRAINT "board_service_fee_confirmed_whole" CHECK (("board_service_fee"."provisional" AND "board_service_fee"."confirmed_at" IS NULL) OR (NOT "board_service_fee"."provisional" AND "board_service_fee"."confirmed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "charge" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"kind" text NOT NULL,
	"registration_id" text,
	"board_series_id" text,
	"board_service_id" text,
	"level" text,
	"academic_year" text,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"plan_exception_id" text,
	"instalment_no" integer,
	"refund_amount" numeric(12, 2),
	"refunded_at" timestamp with time zone,
	"refunded_by" text,
	"refund_reason" text,
	"settled_by_payment_id" text,
	"requested_by" text,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"pricing_basis" jsonb,
	"created_by" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_kind_valid" CHECK ("charge"."kind" IN ('cash_in', 'late_cash_in', 'certificate_split', 'late_entry_fee', 'school_fee_push', 'instalment', 'price_adjustment', 'custom')),
	CONSTRAINT "charge_status_valid" CHECK ("charge"."status" IN ('requested', 'pending_payment', 'paid', 'cancelled', 'refunded')),
	CONSTRAINT "charge_amount_nonneg" CHECK ("charge"."amount" >= 0),
	CONSTRAINT "charge_level_valid" CHECK ("charge"."level" IS NULL OR "charge"."level" IN ('igcse', 'as_a_level')),
	CONSTRAINT "charge_refund_within" CHECK ("charge"."refund_amount" IS NULL OR ("charge"."refund_amount" > 0 AND "charge"."refund_amount" <= "charge"."amount")),
	CONSTRAINT "charge_refunded_whole" CHECK (("charge"."status" = 'refunded') = ("charge"."refund_amount" IS NOT NULL)),
	CONSTRAINT "charge_push_shape" CHECK (("charge"."kind" = 'school_fee_push') = ("charge"."academic_year" IS NOT NULL)),
	CONSTRAINT "charge_settled_push_only" CHECK ("charge"."settled_by_payment_id" IS NULL OR "charge"."kind" = 'school_fee_push'),
	CONSTRAINT "charge_instalment_shape" CHECK (("charge"."kind" = 'instalment') = ("charge"."plan_exception_id" IS NOT NULL AND "charge"."instalment_no" IS NOT NULL AND "charge"."registration_id" IS NOT NULL)),
	CONSTRAINT "charge_service_shape" CHECK ("charge"."kind" NOT IN ('cash_in', 'late_cash_in', 'certificate_split') OR ("charge"."board_service_id" IS NOT NULL AND "charge"."board_series_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "payment_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"charge_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exception" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exception" ALTER COLUMN "student_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "receipt" ALTER COLUMN "registration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "escrow_transaction" ADD COLUMN "related_charge_id" text;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "policy_key" text;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "family_id" text;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "offer_id" text;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "offer_item_id" text;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "registration_id" text;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "charge_id" text;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "board_series_id" text;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "academic_year" text;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "value_number" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "value_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "value_json" jsonb;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "used_for" jsonb;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "check_reason" text;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exception" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "receipt" ADD COLUMN "charge_id" text;--> statement-breakpoint
ALTER TABLE "remark_request" ADD COLUMN "board_service_id" text;--> statement-breakpoint
ALTER TABLE "remark_request" ADD COLUMN "service_level" text;--> statement-breakpoint
ALTER TABLE "board_service" ADD CONSTRAINT "board_service_board_code_exam_board_code_fk" FOREIGN KEY ("board_code") REFERENCES "public"."exam_board"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_service_deadline" ADD CONSTRAINT "board_service_deadline_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_service_deadline" ADD CONSTRAINT "board_service_deadline_board_service_id_board_service_id_fk" FOREIGN KEY ("board_service_id") REFERENCES "public"."board_service"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_service_deadline" ADD CONSTRAINT "board_service_deadline_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_service_fee" ADD CONSTRAINT "board_service_fee_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_service_fee" ADD CONSTRAINT "board_service_fee_board_service_id_board_service_id_fk" FOREIGN KEY ("board_service_id") REFERENCES "public"."board_service"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_service_fee" ADD CONSTRAINT "board_service_fee_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_service_fee" ADD CONSTRAINT "board_service_fee_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_board_service_id_board_service_id_fk" FOREIGN KEY ("board_service_id") REFERENCES "public"."board_service"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_plan_exception_id_exception_id_fk" FOREIGN KEY ("plan_exception_id") REFERENCES "public"."exception"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_refunded_by_user_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_settled_by_payment_id_payment_id_fk" FOREIGN KEY ("settled_by_payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boardService_board_code_idx" ON "board_service" USING btree ("board_code","code");--> statement-breakpoint
CREATE UNIQUE INDEX "boardService_board_legacy_idx" ON "board_service" USING btree ("board_code","legacy_service_type") WHERE legacy_service_type IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "boardServiceDeadline_series_service_idx" ON "board_service_deadline" USING btree ("board_series_id","board_service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boardServiceFee_series_service_level_idx" ON "board_service_fee" USING btree ("board_series_id","board_service_id","level");--> statement-breakpoint
CREATE INDEX "charge_studentId_idx" ON "charge" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "charge_registrationId_idx" ON "charge" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "charge_status_idx" ON "charge" USING btree ("status");--> statement-breakpoint
CREATE INDEX "charge_kind_idx" ON "charge" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "charge_planExceptionId_idx" ON "charge" USING btree ("plan_exception_id");--> statement-breakpoint
CREATE INDEX "charge_series_service_idx" ON "charge" USING btree ("board_series_id","board_service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "charge_one_push_per_year_idx" ON "charge" USING btree ("student_id","academic_year") WHERE kind = 'school_fee_push' AND status IN ('pending_payment', 'paid');--> statement-breakpoint
CREATE UNIQUE INDEX "charge_one_instalment_idx" ON "charge" USING btree ("plan_exception_id","instalment_no") WHERE kind = 'instalment';--> statement-breakpoint
CREATE INDEX "paymentCharge_paymentId_idx" ON "payment_charge" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "paymentCharge_chargeId_idx" ON "payment_charge" USING btree ("charge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paymentCharge_unique_idx" ON "payment_charge" USING btree ("payment_id","charge_id");--> statement-breakpoint
ALTER TABLE "escrow_transaction" ADD CONSTRAINT "escrow_transaction_related_charge_id_charge_id_fk" FOREIGN KEY ("related_charge_id") REFERENCES "public"."charge"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_family_id_user_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_offer_id_session_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."session_offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_offer_item_id_session_offer_item_id_fk" FOREIGN KEY ("offer_item_id") REFERENCES "public"."session_offer_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remark_request" ADD CONSTRAINT "remark_request_board_service_id_board_service_id_fk" FOREIGN KEY ("board_service_id") REFERENCES "public"."board_service"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exception_familyId_idx" ON "exception" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "exception_policyKey_idx" ON "exception" USING btree ("policy_key");--> statement-breakpoint
CREATE INDEX "exception_registrationId_idx" ON "exception" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "exception_chargeId_idx" ON "exception" USING btree ("charge_id");--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_charge_id_unique" UNIQUE("charge_id");--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_value_number_nonneg" CHECK ("exception"."value_number" IS NULL OR "exception"."value_number" >= 0);--> statement-breakpoint
ALTER TABLE "exception" ADD CONSTRAINT "exception_status_valid" CHECK ("exception"."status" IN ('active', 'revoked', 'lapsed', 'used'));--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_one_subject" CHECK (num_nonnulls("receipt"."registration_id", "receipt"."charge_id") = 1);