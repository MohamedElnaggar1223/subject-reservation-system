ALTER TABLE "payment" DROP CONSTRAINT "payment_verification_file_id_file_id_fk";
--> statement-breakpoint
ALTER TABLE "remark_request" DROP CONSTRAINT "remark_request_consent_file_id_file_id_fk";
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_verification_file_id_file_id_fk" FOREIGN KEY ("verification_file_id") REFERENCES "public"."file"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remark_request" ADD CONSTRAINT "remark_request_consent_file_id_file_id_fk" FOREIGN KEY ("consent_file_id") REFERENCES "public"."file"("id") ON DELETE restrict ON UPDATE no action;