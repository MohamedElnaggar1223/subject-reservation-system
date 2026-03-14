CREATE TABLE "escrow" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"balance" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escrow_student_id_unique" UNIQUE("student_id")
);
--> statement-breakpoint
CREATE TABLE "escrow_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" double precision NOT NULL,
	"reason" text NOT NULL,
	"related_registration_id" text,
	"related_payment_id" text,
	"initiated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"parent_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"escrow_amount_applied" double precision DEFAULT 0 NOT NULL,
	"payment_method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_reference" text,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_registration" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"registration_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_request" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_id" text NOT NULL,
	"requested_amount" double precision NOT NULL,
	"released_amount" double precision,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"fulfilled_at" timestamp with time zone,
	"fulfilled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "escrow" ADD CONSTRAINT "escrow_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_transaction" ADD CONSTRAINT "escrow_transaction_escrow_id_escrow_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_transaction" ADD CONSTRAINT "escrow_transaction_related_registration_id_registration_id_fk" FOREIGN KEY ("related_registration_id") REFERENCES "public"."registration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_transaction" ADD CONSTRAINT "escrow_transaction_related_payment_id_payment_id_fk" FOREIGN KEY ("related_payment_id") REFERENCES "public"."payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_transaction" ADD CONSTRAINT "escrow_transaction_initiated_by_user_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_parent_id_user_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_registration" ADD CONSTRAINT "payment_registration_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_registration" ADD CONSTRAINT "payment_registration_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_escrow_id_escrow_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_fulfilled_by_user_id_fk" FOREIGN KEY ("fulfilled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "escrow_studentId_idx" ON "escrow" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "escrowTx_escrowId_idx" ON "escrow_transaction" USING btree ("escrow_id");--> statement-breakpoint
CREATE INDEX "escrowTx_type_idx" ON "escrow_transaction" USING btree ("type");--> statement-breakpoint
CREATE INDEX "escrowTx_reason_idx" ON "escrow_transaction" USING btree ("reason");--> statement-breakpoint
CREATE INDEX "payment_studentId_idx" ON "payment" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "payment_parentId_idx" ON "payment" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "payment_status_idx" ON "payment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_method_idx" ON "payment" USING btree ("payment_method");--> statement-breakpoint
CREATE INDEX "paymentReg_paymentId_idx" ON "payment_registration" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "paymentReg_registrationId_idx" ON "payment_registration" USING btree ("registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paymentReg_unique_idx" ON "payment_registration" USING btree ("payment_id","registration_id");--> statement-breakpoint
CREATE INDEX "withdrawalReq_escrowId_idx" ON "withdrawal_request" USING btree ("escrow_id");--> statement-breakpoint
CREATE INDEX "withdrawalReq_status_idx" ON "withdrawal_request" USING btree ("status");