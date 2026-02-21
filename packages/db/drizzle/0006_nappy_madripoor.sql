CREATE TABLE "parent_student_link" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text NOT NULL,
	"student_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parent_student_link" ADD CONSTRAINT "parent_student_link_parent_id_user_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_student_link" ADD CONSTRAINT "parent_student_link_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parentStudentLink_parentId_idx" ON "parent_student_link" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "parentStudentLink_studentId_idx" ON "parent_student_link" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "parentStudentLink_status_idx" ON "parent_student_link" USING btree ("status");