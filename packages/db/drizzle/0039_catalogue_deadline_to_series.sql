ALTER TABLE "registration_session" DROP CONSTRAINT "session_entry_deadline_after_end";--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_council_exam_board_code_fk" FOREIGN KEY ("council") REFERENCES "public"."exam_board"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_session" DROP COLUMN "entry_deadline";