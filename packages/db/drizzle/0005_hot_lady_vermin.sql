ALTER TABLE "user" ADD COLUMN "grade" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "student_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_student_id_unique" UNIQUE("student_id");