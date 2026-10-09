CREATE TABLE "import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"file_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"commit_started_by" text,
	"commit_started_at" timestamp with time zone,
	"committed_by" text,
	"committed_at" timestamp with time zone,
	"discarded_by" text,
	"discarded_at" timestamp with time zone,
	CONSTRAINT "import_batch_kind_valid" CHECK ("import_batch"."kind" IN ('school_sheet', 'scl_roster', 'money_record')),
	CONSTRAINT "import_batch_status_valid" CHECK ("import_batch"."status" IN ('staged', 'committing', 'committed', 'partial', 'discarded'))
);
--> statement-breakpoint
CREATE TABLE "import_person" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"role" text NOT NULL,
	"key" text NOT NULL,
	"edits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merged_into" text,
	"distinct" boolean DEFAULT false NOT NULL,
	"one_child" boolean DEFAULT false NOT NULL,
	"decision" text DEFAULT 'import' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"error" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_person_role_valid" CHECK ("import_person"."role" IN ('student', 'parent')),
	CONSTRAINT "import_person_decision_valid" CHECK ("import_person"."decision" IN ('import', 'skip'))
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"tab" text NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"edits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision" text,
	"decision_note" text,
	"decided_by" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" jsonb,
	"error" text,
	"committed_at" timestamp with time zone,
	CONSTRAINT "import_row_decision_valid" CHECK ("import_row"."decision" IS NULL OR "import_row"."decision" IN ('import', 'skip')),
	CONSTRAINT "import_row_status_valid" CHECK ("import_row"."status" IN ('pending', 'committed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "money_history" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"kind" text NOT NULL,
	"direction" text,
	"amount" numeric(12, 2),
	"percent" numeric(5, 2),
	"happened_on" date,
	"method" text,
	"receipt_number" text,
	"series_label" text,
	"subject_label" text,
	"note" text,
	"fingerprint" text NOT NULL,
	"import_batch_id" text,
	"import_row_id" text,
	"source_ref" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_history_kind_valid" CHECK ("money_history"."kind" IN ('payment', 'refund', 'drop', 'self_study_rate', 'external_rate', 'carried_forward', 'other')),
	CONSTRAINT "money_history_direction_valid" CHECK ("money_history"."direction" IS NULL OR "money_history"."direction" IN ('in', 'out')),
	CONSTRAINT "money_history_amount_nonneg" CHECK ("money_history"."amount" IS NULL OR "money_history"."amount" >= 0),
	CONSTRAINT "money_history_percent_range" CHECK ("money_history"."percent" IS NULL OR ("money_history"."percent" >= 0 AND "money_history"."percent" <= 100))
);
--> statement-breakpoint
CREATE TABLE "registration_history" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"subject_id" text,
	"subject_label" text NOT NULL,
	"level_code" text,
	"session_type" text NOT NULL,
	"series_year" integer NOT NULL,
	"mode" text NOT NULL,
	"teacher_id" text,
	"teacher_name" text,
	"outcome" text NOT NULL,
	"carried_forward" jsonb,
	"note" text,
	"fingerprint" text NOT NULL,
	"import_batch_id" text,
	"import_row_id" text,
	"source_ref" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_history_mode_valid" CHECK ("registration_history"."mode" IN ('in_school', 'self_study')),
	CONSTRAINT "registration_history_outcome_valid" CHECK ("registration_history"."outcome" IN ('registered', 'dropped', 'drop_intended')),
	CONSTRAINT "registration_history_series_valid" CHECK ("registration_history"."session_type" IN ('january', 'june', 'october', 'november') AND "registration_history"."series_year" BETWEEN 2000 AND 2100)
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_commit_started_by_user_id_fk" FOREIGN KEY ("commit_started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_committed_by_user_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_discarded_by_user_id_fk" FOREIGN KEY ("discarded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_person" ADD CONSTRAINT "import_person_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_person" ADD CONSTRAINT "import_person_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_person" ADD CONSTRAINT "import_person_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_history" ADD CONSTRAINT "money_history_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_history" ADD CONSTRAINT "money_history_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_history" ADD CONSTRAINT "money_history_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_history" ADD CONSTRAINT "registration_history_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_history" ADD CONSTRAINT "registration_history_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_history" ADD CONSTRAINT "registration_history_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_history" ADD CONSTRAINT "registration_history_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_history" ADD CONSTRAINT "registration_history_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "importBatch_status_idx" ON "import_batch" USING btree ("status");--> statement-breakpoint
CREATE INDEX "importBatch_fileHash_idx" ON "import_batch" USING btree ("file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "importPerson_key_idx" ON "import_person" USING btree ("batch_id","role","key");--> statement-breakpoint
CREATE INDEX "importRow_batchId_idx" ON "import_row" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "importRow_line_idx" ON "import_row" USING btree ("batch_id","tab","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "moneyHistory_fingerprint_idx" ON "money_history" USING btree ("student_id","fingerprint");--> statement-breakpoint
CREATE INDEX "moneyHistory_studentId_idx" ON "money_history" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrationHistory_fingerprint_idx" ON "registration_history" USING btree ("student_id","fingerprint");--> statement-breakpoint
CREATE INDEX "registrationHistory_studentId_idx" ON "registration_history" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "registrationHistory_subjectId_idx" ON "registration_history" USING btree ("subject_id");