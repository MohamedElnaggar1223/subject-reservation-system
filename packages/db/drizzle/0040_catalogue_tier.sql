ALTER TABLE "exam_unit" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "qualification" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "exam_unit" ADD CONSTRAINT "exam_unit_tier_valid" CHECK ("exam_unit"."tier" IS NULL OR "exam_unit"."tier" IN ('core', 'extended', 'foundation', 'higher'));--> statement-breakpoint
ALTER TABLE "qualification" ADD CONSTRAINT "qualification_tier_valid" CHECK ("qualification"."tier" IS NULL OR "qualification"."tier" IN ('core', 'extended', 'foundation', 'higher'));