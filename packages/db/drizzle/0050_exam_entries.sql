CREATE TABLE "exam_attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"student_id" text NOT NULL,
	"status" text NOT NULL,
	"minutes_late" integer,
	"note" text,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_attendance_status_valid" CHECK ("exam_attendance"."status" IN ('present', 'absent', 'late')),
	CONSTRAINT "exam_attendance_late_minutes" CHECK ("exam_attendance"."status" <> 'late' OR "exam_attendance"."minutes_late" > 0)
);
--> statement-breakpoint
CREATE TABLE "exam_board_rule" (
	"board_code" text PRIMARY KEY NOT NULL,
	"forecast_required" boolean DEFAULT false NOT NULL,
	"forecast_locked_on_submit" boolean DEFAULT false NOT NULL,
	"option_code_required" boolean DEFAULT false NOT NULL,
	"uci_required" boolean DEFAULT false NOT NULL,
	"candidate_number_fixed" boolean DEFAULT true NOT NULL,
	"amendment_after_deadline" text DEFAULT 'allowed_with_fee' NOT NULL,
	"amendment_fee_from" text DEFAULT 'entry_deadline' NOT NULL,
	"amendment_fee_note" text,
	"withdrawal_refund_until" text DEFAULT 'entry_deadline' NOT NULL,
	"withdrawal_fee_note" text,
	"carry_forward_months" integer,
	"results_key" text DEFAULT 'candidate_number' NOT NULL,
	"notes" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_board_rule_amendment_valid" CHECK ("exam_board_rule"."amendment_after_deadline" IN ('allowed_with_fee', 'refused')),
	CONSTRAINT "exam_board_rule_amendment_from_valid" CHECK ("exam_board_rule"."amendment_fee_from" IN ('entry_deadline', 'late_fee_from', 'high_late_fee_from')),
	CONSTRAINT "exam_board_rule_refund_valid" CHECK ("exam_board_rule"."withdrawal_refund_until" IN ('entry_deadline', 'late_fee_from', 'high_late_fee_from', 'never')),
	CONSTRAINT "exam_board_rule_results_key_valid" CHECK ("exam_board_rule"."results_key" IN ('candidate_number', 'uci')),
	CONSTRAINT "exam_board_rule_cf_months" CHECK ("exam_board_rule"."carry_forward_months" IS NULL OR "exam_board_rule"."carry_forward_months" BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "exam_candidate" (
	"student_id" text PRIMARY KEY NOT NULL,
	"legal_forenames" text,
	"legal_surname" text,
	"date_of_birth" date,
	"gender" text,
	"uci" text,
	"access_arrangements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_arrangements_ref" text,
	"access_arrangements_until" date,
	"notes" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_candidate_gender_valid" CHECK ("exam_candidate"."gender" IS NULL OR "exam_candidate"."gender" IN ('female', 'male')),
	CONSTRAINT "exam_candidate_uci_shape" CHECK ("exam_candidate"."uci" IS NULL OR "exam_candidate"."uci" ~ '^[0-9]{5}[0-9A-Z][0-9]{6}[0-9A-Z]$')
);
--> statement-breakpoint
CREATE TABLE "exam_candidate_identity" (
	"student_id" text PRIMARY KEY NOT NULL,
	"document_type" text NOT NULL,
	"document_number" text NOT NULL,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_candidate_identity_type_valid" CHECK ("exam_candidate_identity"."document_type" IN ('national_id', 'passport'))
);
--> statement-breakpoint
CREATE TABLE "exam_candidate_number" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"board_series_id" text NOT NULL,
	"board_code" text NOT NULL,
	"number" text NOT NULL,
	"centre_number" text,
	"source" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_candidate_number_shape" CHECK ("exam_candidate_number"."number" ~ '^[0-9]{4}$'),
	CONSTRAINT "exam_candidate_number_source_valid" CHECK ("exam_candidate_number"."source" IN ('assigned', 'manual', 'import'))
);
--> statement-breakpoint
CREATE TABLE "exam_certificate" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"board_series_id" text NOT NULL,
	"board_code" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"received_on" date NOT NULL,
	"received_by" text,
	"collected_at" timestamp with time zone,
	"collected_by" text,
	"collector_name" text,
	"collector_relation" text,
	"collector_id_checked" text,
	"signature_file_id" text,
	"disposed_at" timestamp with time zone,
	"disposed_by" text,
	"disposal_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_certificate_status_valid" CHECK ("exam_certificate"."status" IN ('received', 'collected', 'returned_to_board', 'destroyed')),
	CONSTRAINT "exam_certificate_collected_whole" CHECK (("exam_certificate"."status" = 'collected') = ("exam_certificate"."collected_at" IS NOT NULL AND "exam_certificate"."collector_name" IS NOT NULL)),
	CONSTRAINT "exam_certificate_relation_valid" CHECK ("exam_certificate"."collector_relation" IS NULL OR "exam_certificate"."collector_relation" IN ('candidate', 'parent', 'other')),
	CONSTRAINT "exam_certificate_disposed_whole" CHECK (("exam_certificate"."status" IN ('returned_to_board', 'destroyed')) = ("exam_certificate"."disposed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "exam_clash_note" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"paper_a_id" text NOT NULL,
	"paper_b_id" text NOT NULL,
	"resolution" text NOT NULL,
	"noted_by" text,
	"noted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_clash_note_ordered" CHECK ("exam_clash_note"."paper_a_id" < "exam_clash_note"."paper_b_id")
);
--> statement-breakpoint
CREATE TABLE "exam_deadline_reminder" (
	"board_series_id" text NOT NULL,
	"date_field" text NOT NULL,
	"due_on" date NOT NULL,
	"days_before" integer NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_deadline_reminder_board_series_id_date_field_due_on_days_before_pk" PRIMARY KEY("board_series_id","date_field","due_on","days_before")
);
--> statement-breakpoint
CREATE TABLE "exam_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"board_series_id" text NOT NULL,
	"board_code" text NOT NULL,
	"registration_id" text,
	"kind" text NOT NULL,
	"unit_id" text,
	"qualification_id" text,
	"entry_code" text NOT NULL,
	"title" text NOT NULL,
	"option_code" text,
	"tier" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_retake" boolean DEFAULT false NOT NULL,
	"retake_source" text,
	"carry_forward" text DEFAULT 'none' NOT NULL,
	"cf_from_month" text,
	"cf_from_year" integer,
	"cf_centre_number" text,
	"cf_candidate_number" text,
	"cf_option" text,
	"forecast_grade" text,
	"forecast_by" text,
	"forecast_at" timestamp with time zone,
	"forecast_locked_at" timestamp with time zone,
	"access_arrangements" jsonb,
	"fee_tier_at_submission" text,
	"submitted_at" timestamp with time zone,
	"submitted_by" text,
	"amended_at" timestamp with time zone,
	"amended_by" text,
	"amendment_count" integer DEFAULT 0 NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	"withdrawal_reason" text,
	"withdrawal_charge" text,
	"withdrawal_refunded" boolean,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_entry_kind_valid" CHECK ("exam_entry"."kind" IN ('unit', 'award')),
	CONSTRAINT "exam_entry_kind_target" CHECK (("exam_entry"."kind" = 'unit' AND "exam_entry"."unit_id" IS NOT NULL AND "exam_entry"."qualification_id" IS NULL) OR ("exam_entry"."kind" = 'award' AND "exam_entry"."qualification_id" IS NOT NULL AND "exam_entry"."unit_id" IS NULL)),
	CONSTRAINT "exam_entry_status_valid" CHECK ("exam_entry"."status" IN ('draft', 'submitted', 'amended', 'withdrawn')),
	CONSTRAINT "exam_entry_tier_valid" CHECK ("exam_entry"."tier" IS NULL OR "exam_entry"."tier" IN ('core', 'extended', 'foundation', 'higher')),
	CONSTRAINT "exam_entry_cf_valid" CHECK ("exam_entry"."carry_forward" IN ('none', 'suggested', 'confirmed')),
	CONSTRAINT "exam_entry_submitted_whole" CHECK ("exam_entry"."status" NOT IN ('submitted', 'amended') OR "exam_entry"."submitted_at" IS NOT NULL),
	CONSTRAINT "exam_entry_withdrawn_whole" CHECK (("exam_entry"."status" = 'withdrawn') = ("exam_entry"."withdrawn_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "exam_invigilation" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_date" date NOT NULL,
	"session" text NOT NULL,
	"room_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	"assigned_by" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_invigilation_session_valid" CHECK ("exam_invigilation"."session" IN ('am', 'pm', 'ev'))
);
--> statement-breakpoint
CREATE TABLE "exam_paper" (
	"id" text PRIMARY KEY NOT NULL,
	"board_series_id" text NOT NULL,
	"board_code" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"unit_id" text,
	"qualification_id" text,
	"tier" text,
	"exam_date" date NOT NULL,
	"session" text NOT NULL,
	"start_time" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_paper_session_valid" CHECK ("exam_paper"."session" IN ('am', 'pm', 'ev')),
	CONSTRAINT "exam_paper_start_time" CHECK ("exam_paper"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "exam_paper_duration" CHECK ("exam_paper"."duration_minutes" BETWEEN 5 AND 480),
	CONSTRAINT "exam_paper_tier_valid" CHECK ("exam_paper"."tier" IS NULL OR "exam_paper"."tier" IN ('core', 'extended', 'foundation', 'higher'))
);
--> statement-breakpoint
CREATE TABLE "exam_result" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"board_series_id" text NOT NULL,
	"board_code" text NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"unit_id" text,
	"qualification_id" text,
	"entry_id" text,
	"grade" text NOT NULL,
	"mark" numeric(7, 2),
	"max_mark" numeric(7, 2),
	"source" text NOT NULL,
	"import_id" text,
	"status" text DEFAULT 'provisional' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_result_kind_valid" CHECK ("exam_result"."kind" IN ('unit', 'award')),
	CONSTRAINT "exam_result_source_valid" CHECK ("exam_result"."source" IN ('import', 'manual')),
	CONSTRAINT "exam_result_status_valid" CHECK ("exam_result"."status" IN ('provisional', 'published')),
	CONSTRAINT "exam_result_published_whole" CHECK (("exam_result"."status" = 'published') = ("exam_result"."published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "exam_result_import" (
	"id" text PRIMARY KEY NOT NULL,
	"board_series_id" text NOT NULL,
	"board_code" text NOT NULL,
	"file_id" text,
	"source_name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"result_count" integer NOT NULL,
	"unmatched_count" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_result_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"board_code" text NOT NULL,
	"name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_room_sitting" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_date" date NOT NULL,
	"session" text NOT NULL,
	"room_id" text NOT NULL,
	"seat_rows" integer NOT NULL,
	"seat_columns" integer NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_room_sitting_session_valid" CHECK ("exam_room_sitting"."session" IN ('am', 'pm', 'ev')),
	CONSTRAINT "exam_room_sitting_grid" CHECK ("exam_room_sitting"."seat_rows" BETWEEN 1 AND 26 AND "exam_room_sitting"."seat_columns" BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE TABLE "exam_seat" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_date" date NOT NULL,
	"session" text NOT NULL,
	"room_id" text NOT NULL,
	"seat_label" text NOT NULL,
	"student_id" text NOT NULL,
	"assigned_by" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_seat_session_valid" CHECK ("exam_seat"."session" IN ('am', 'pm', 'ev')),
	CONSTRAINT "exam_seat_label_shape" CHECK ("exam_seat"."seat_label" ~ '^[A-Z][0-9]{1,2}$')
);
--> statement-breakpoint
CREATE TABLE "exam_series_state" (
	"board_series_id" text PRIMARY KEY NOT NULL,
	"timetable_published_at" timestamp with time zone,
	"timetable_published_by" text,
	"timetable_version" integer DEFAULT 0 NOT NULL,
	"forecasts_submitted_at" timestamp with time zone,
	"forecasts_submitted_by" text,
	"results_published_at" timestamp with time zone,
	"results_published_by" text
);
--> statement-breakpoint
CREATE TABLE "exam_special_consideration" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"board_series_id" text NOT NULL,
	"paper_id" text,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"evidence_file_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"board_reference" text,
	"outcome" text,
	"submitted_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_special_consideration_category_valid" CHECK ("exam_special_consideration"."category" IN ('illness', 'bereavement', 'accident', 'disturbance', 'other')),
	CONSTRAINT "exam_special_consideration_status_valid" CHECK ("exam_special_consideration"."status" IN ('draft', 'submitted', 'outcome_received'))
);
--> statement-breakpoint
ALTER TABLE "exam_attendance" ADD CONSTRAINT "exam_attendance_paper_id_exam_paper_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."exam_paper"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attendance" ADD CONSTRAINT "exam_attendance_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attendance" ADD CONSTRAINT "exam_attendance_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_board_rule" ADD CONSTRAINT "exam_board_rule_board_code_exam_board_code_fk" FOREIGN KEY ("board_code") REFERENCES "public"."exam_board"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_board_rule" ADD CONSTRAINT "exam_board_rule_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_candidate" ADD CONSTRAINT "exam_candidate_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_candidate" ADD CONSTRAINT "exam_candidate_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_candidate_identity" ADD CONSTRAINT "exam_candidate_identity_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_candidate_identity" ADD CONSTRAINT "exam_candidate_identity_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_candidate_number" ADD CONSTRAINT "exam_candidate_number_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_candidate_number" ADD CONSTRAINT "exam_candidate_number_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_candidate_number" ADD CONSTRAINT "exam_candidate_number_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_certificate" ADD CONSTRAINT "exam_certificate_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_certificate" ADD CONSTRAINT "exam_certificate_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_certificate" ADD CONSTRAINT "exam_certificate_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_certificate" ADD CONSTRAINT "exam_certificate_collected_by_user_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_certificate" ADD CONSTRAINT "exam_certificate_signature_file_id_file_id_fk" FOREIGN KEY ("signature_file_id") REFERENCES "public"."file"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_certificate" ADD CONSTRAINT "exam_certificate_disposed_by_user_id_fk" FOREIGN KEY ("disposed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_clash_note" ADD CONSTRAINT "exam_clash_note_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_clash_note" ADD CONSTRAINT "exam_clash_note_paper_a_id_exam_paper_id_fk" FOREIGN KEY ("paper_a_id") REFERENCES "public"."exam_paper"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_clash_note" ADD CONSTRAINT "exam_clash_note_paper_b_id_exam_paper_id_fk" FOREIGN KEY ("paper_b_id") REFERENCES "public"."exam_paper"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_clash_note" ADD CONSTRAINT "exam_clash_note_noted_by_user_id_fk" FOREIGN KEY ("noted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_deadline_reminder" ADD CONSTRAINT "exam_deadline_reminder_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_entry" ADD CONSTRAINT "exam_entry_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_entry" ADD CONSTRAINT "exam_entry_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_entry" ADD CONSTRAINT "exam_entry_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_entry" ADD CONSTRAINT "exam_entry_unit_id_exam_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."exam_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_entry" ADD CONSTRAINT "exam_entry_qualification_id_qualification_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "public"."qualification"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_entry" ADD CONSTRAINT "exam_entry_forecast_by_user_id_fk" FOREIGN KEY ("forecast_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_entry" ADD CONSTRAINT "exam_entry_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_entry" ADD CONSTRAINT "exam_entry_amended_by_user_id_fk" FOREIGN KEY ("amended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_entry" ADD CONSTRAINT "exam_entry_withdrawn_by_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_entry" ADD CONSTRAINT "exam_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_invigilation" ADD CONSTRAINT "exam_invigilation_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_invigilation" ADD CONSTRAINT "exam_invigilation_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_invigilation" ADD CONSTRAINT "exam_invigilation_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_paper" ADD CONSTRAINT "exam_paper_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_paper" ADD CONSTRAINT "exam_paper_unit_id_exam_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."exam_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_paper" ADD CONSTRAINT "exam_paper_qualification_id_qualification_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "public"."qualification"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_paper" ADD CONSTRAINT "exam_paper_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_unit_id_exam_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."exam_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_qualification_id_qualification_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "public"."qualification"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_entry_id_exam_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."exam_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_import_id_exam_result_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."exam_result_import"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result_import" ADD CONSTRAINT "exam_result_import_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result_import" ADD CONSTRAINT "exam_result_import_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result_import" ADD CONSTRAINT "exam_result_import_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result_mapping" ADD CONSTRAINT "exam_result_mapping_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_room_sitting" ADD CONSTRAINT "exam_room_sitting_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_room_sitting" ADD CONSTRAINT "exam_room_sitting_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_seat" ADD CONSTRAINT "exam_seat_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_seat" ADD CONSTRAINT "exam_seat_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_seat" ADD CONSTRAINT "exam_seat_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_series_state" ADD CONSTRAINT "exam_series_state_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_series_state" ADD CONSTRAINT "exam_series_state_timetable_published_by_user_id_fk" FOREIGN KEY ("timetable_published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_series_state" ADD CONSTRAINT "exam_series_state_forecasts_submitted_by_user_id_fk" FOREIGN KEY ("forecasts_submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_series_state" ADD CONSTRAINT "exam_series_state_results_published_by_user_id_fk" FOREIGN KEY ("results_published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_special_consideration" ADD CONSTRAINT "exam_special_consideration_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_special_consideration" ADD CONSTRAINT "exam_special_consideration_board_series_id_board_series_id_fk" FOREIGN KEY ("board_series_id") REFERENCES "public"."board_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_special_consideration" ADD CONSTRAINT "exam_special_consideration_paper_id_exam_paper_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."exam_paper"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_special_consideration" ADD CONSTRAINT "exam_special_consideration_evidence_file_id_file_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."file"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_special_consideration" ADD CONSTRAINT "exam_special_consideration_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "examAttendance_unique_idx" ON "exam_attendance" USING btree ("paper_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "examCandidate_uci_idx" ON "exam_candidate" USING btree ("uci");--> statement-breakpoint
CREATE UNIQUE INDEX "examCandidateIdentity_document_idx" ON "exam_candidate_identity" USING btree ("document_type","document_number");--> statement-breakpoint
CREATE UNIQUE INDEX "examCandidateNumber_student_series_idx" ON "exam_candidate_number" USING btree ("student_id","board_series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "examCandidateNumber_series_number_idx" ON "exam_candidate_number" USING btree ("board_series_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "examCertificate_student_series_idx" ON "exam_certificate" USING btree ("student_id","board_series_id");--> statement-breakpoint
CREATE INDEX "examCertificate_status_idx" ON "exam_certificate" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "examClashNote_unique_idx" ON "exam_clash_note" USING btree ("student_id","paper_a_id","paper_b_id");--> statement-breakpoint
CREATE INDEX "examEntry_studentId_idx" ON "exam_entry" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "examEntry_boardSeriesId_idx" ON "exam_entry" USING btree ("board_series_id");--> statement-breakpoint
CREATE INDEX "examEntry_registrationId_idx" ON "exam_entry" USING btree ("registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "examEntry_one_live_unit_idx" ON "exam_entry" USING btree ("student_id","board_series_id","unit_id") WHERE status <> 'withdrawn' AND unit_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "examEntry_one_live_award_idx" ON "exam_entry" USING btree ("student_id","board_series_id","qualification_id") WHERE status <> 'withdrawn' AND qualification_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "examInvigilation_teacher_idx" ON "exam_invigilation" USING btree ("exam_date","session","teacher_id");--> statement-breakpoint
CREATE INDEX "examInvigilation_room_idx" ON "exam_invigilation" USING btree ("exam_date","session","room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "examPaper_series_code_idx" ON "exam_paper" USING btree ("board_series_id","code");--> statement-breakpoint
CREATE INDEX "examPaper_date_idx" ON "exam_paper" USING btree ("exam_date","session");--> statement-breakpoint
CREATE INDEX "examPaper_unitId_idx" ON "exam_paper" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "examResult_student_idx" ON "exam_result" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "examResult_series_idx" ON "exam_result" USING btree ("board_series_id");--> statement-breakpoint
CREATE INDEX "examResult_key_idx" ON "exam_result" USING btree ("student_id","board_series_id","kind","code");--> statement-breakpoint
CREATE INDEX "examResultImport_series_idx" ON "exam_result_import" USING btree ("board_series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "examResultMapping_name_idx" ON "exam_result_mapping" USING btree ("board_code","name");--> statement-breakpoint
CREATE UNIQUE INDEX "examRoomSitting_unique_idx" ON "exam_room_sitting" USING btree ("exam_date","session","room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "examSeat_seat_idx" ON "exam_seat" USING btree ("exam_date","session","room_id","seat_label");--> statement-breakpoint
CREATE UNIQUE INDEX "examSeat_student_idx" ON "exam_seat" USING btree ("exam_date","session","student_id");--> statement-breakpoint
CREATE INDEX "examSpecialConsideration_student_idx" ON "exam_special_consideration" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "examSpecialConsideration_series_idx" ON "exam_special_consideration" USING btree ("board_series_id");