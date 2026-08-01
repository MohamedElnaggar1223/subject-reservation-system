ALTER TABLE "payment" ADD COLUMN "purpose" text DEFAULT 'registration' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "verification_reference" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "verification_file_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "instrument_used" text;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_verification_file_id_file_id_fk" FOREIGN KEY ("verification_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_purpose_idx" ON "payment" USING btree ("purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_verification_reference_idx" ON "payment" USING btree ("verification_reference");