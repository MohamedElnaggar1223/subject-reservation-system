CREATE TABLE "subject" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"council" text NOT NULL,
	"price_in_school" double precision NOT NULL,
	"is_offered_at_school" boolean DEFAULT true NOT NULL,
	"custom_price" double precision,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subject_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX "subject_code_idx" ON "subject" USING btree ("code");--> statement-breakpoint
CREATE INDEX "subject_council_idx" ON "subject" USING btree ("council");--> statement-breakpoint
CREATE INDEX "subject_isActive_idx" ON "subject" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "subject_isCore_idx" ON "subject" USING btree ("is_core");