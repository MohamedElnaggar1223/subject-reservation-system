CREATE TABLE "price_list" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"board_code" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_row" (
	"id" text PRIMARY KEY NOT NULL,
	"price_list_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"code" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"matched_key" text,
	"matched_item_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_row_amount_nonneg" CHECK ("price_list_row"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reference_row" (
	"id" text PRIMARY KEY NOT NULL,
	"reference_subject_id" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"price_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"short" text,
	"label_en" text NOT NULL,
	"label_ar" text NOT NULL,
	"sum_of_units" text[] DEFAULT '{}'::text[] NOT NULL,
	"winter_sitting" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reference_row_winter_valid" CHECK ("reference_row"."winter_sitting" IS NULL OR "reference_row"."winter_sitting" IN ('november', 'january', 'none')),
	CONSTRAINT "reference_row_kind_valid" CHECK ("reference_row"."kind" IN ('all_papers', 'paper', 'unit', 'as', 'a2', 'al', 'qualification'))
);
--> statement-breakpoint
CREATE TABLE "reference_subject" (
	"id" text PRIMARY KEY NOT NULL,
	"board_code" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"group" text NOT NULL,
	"level" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"note" text,
	"winter_sitting" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_subject_group_valid" CHECK ("reference_subject"."group" IN ('O.L.', 'A.S./A.L.')),
	CONSTRAINT "reference_subject_level_valid" CHECK ("reference_subject"."level" IN ('igcse', 'as_al')),
	CONSTRAINT "reference_subject_winter_valid" CHECK ("reference_subject"."winter_sitting" IS NULL OR "reference_subject"."winter_sitting" IN ('november', 'january'))
);
--> statement-breakpoint
CREATE TABLE "registration_answer" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"student_id" text NOT NULL,
	"session_id" text NOT NULL,
	"value" text NOT NULL,
	"answered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_question" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"offering_id" text,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"choices" text[] DEFAULT '{}'::text[] NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_question_kind_valid" CHECK ("session_question"."kind" IN ('yes_no', 'text', 'choice')),
	CONSTRAINT "session_question_choices" CHECK (("session_question"."kind" = 'choice') = (cardinality("session_question"."choices") > 0))
);
--> statement-breakpoint
ALTER TABLE "session_subject_series" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "session_subject_series" CASCADE;--> statement-breakpoint
ALTER TABLE "session_offer" DROP CONSTRAINT "session_offer_course_fee_nonneg";--> statement-breakpoint
ALTER TABLE "session_offer_item" DROP CONSTRAINT "session_offer_item_kind_valid";--> statement-breakpoint
ALTER TABLE "registration_session" ALTER COLUMN "start_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_session" ALTER COLUMN "end_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session_offer" ALTER COLUMN "course_fee" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "session_offer" ALTER COLUMN "course_fee" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session_offer_item" ALTER COLUMN "kind" SET DEFAULT 'all_papers';--> statement-breakpoint
ALTER TABLE "board_series" ADD COLUMN "dates_source" text;--> statement-breakpoint
ALTER TABLE "board_series" ADD COLUMN "dates_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "board_series" ADD COLUMN "levels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_board" ADD COLUMN "one_paper_asks_sitting" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_board" ADD COLUMN "reference_aliases" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_session" ADD COLUMN "self_study_percent" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_session" ADD COLUMN "prices_final" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_session" ADD COLUMN "prices_final_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registration_session" ADD COLUMN "allowed_grades" text[] DEFAULT '{11,12,graduates}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_session" ADD COLUMN "unpaid_cancel_days" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_session" ADD COLUMN "copied_from_session_id" text;--> statement-breakpoint
ALTER TABLE "session_offer" ADD COLUMN "reference_code" text;--> statement-breakpoint
ALTER TABLE "session_offer" ADD COLUMN "teacher_choice" text DEFAULT 'families' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_offer" ADD COLUMN "teacher_tbc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session_offer" ADD COLUMN "accepting" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "session_offer" ADD COLUMN "closes_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "first_in_school" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "retake_in_school" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "retake_self_study" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "first_self_study" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "exam_fee" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "exam_fee_source" text;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "price_list_row_id" text;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "self_study_fee" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "reference_key" text;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "reference_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "allowed_prior_series_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "closes_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD COLUMN "pay_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_session_id_registration_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."registration_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_board_code_exam_board_code_fk" FOREIGN KEY ("board_code") REFERENCES "public"."exam_board"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_row" ADD CONSTRAINT "price_list_row_price_list_id_price_list_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_row" ADD CONSTRAINT "price_list_row_matched_item_id_session_offer_item_id_fk" FOREIGN KEY ("matched_item_id") REFERENCES "public"."session_offer_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_row" ADD CONSTRAINT "reference_row_reference_subject_id_reference_subject_id_fk" FOREIGN KEY ("reference_subject_id") REFERENCES "public"."reference_subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_subject" ADD CONSTRAINT "reference_subject_board_code_exam_board_code_fk" FOREIGN KEY ("board_code") REFERENCES "public"."exam_board"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_answer" ADD CONSTRAINT "registration_answer_question_id_session_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."session_question"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_answer" ADD CONSTRAINT "registration_answer_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_answer" ADD CONSTRAINT "registration_answer_session_id_registration_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."registration_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_answer" ADD CONSTRAINT "registration_answer_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_question" ADD CONSTRAINT "session_question_session_id_registration_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."registration_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_question" ADD CONSTRAINT "session_question_offering_id_session_offer_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."session_offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_question" ADD CONSTRAINT "session_question_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "priceList_session_board_name_idx" ON "price_list" USING btree ("session_id","board_code","name");--> statement-breakpoint
CREATE INDEX "priceListRow_list_idx" ON "price_list_row" USING btree ("price_list_id");--> statement-breakpoint
CREATE INDEX "priceListRow_item_idx" ON "price_list_row" USING btree ("matched_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referenceRow_subject_key_idx" ON "reference_row" USING btree ("reference_subject_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "referenceSubject_board_code_idx" ON "reference_subject" USING btree ("board_code","code");--> statement-breakpoint
CREATE UNIQUE INDEX "registrationAnswer_question_student_idx" ON "registration_answer" USING btree ("question_id","student_id");--> statement-breakpoint
CREATE INDEX "registrationAnswer_session_idx" ON "registration_answer" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sessionQuestion_session_idx" ON "session_question" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sessionQuestion_offering_idx" ON "session_question" USING btree ("offering_id");--> statement-breakpoint
ALTER TABLE "registration_session" ADD CONSTRAINT "registration_session_copied_from_session_id_registration_session_id_fk" FOREIGN KEY ("copied_from_session_id") REFERENCES "public"."registration_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD CONSTRAINT "session_offer_item_price_list_row_id_price_list_row_id_fk" FOREIGN KEY ("price_list_row_id") REFERENCES "public"."price_list_row"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_session" ADD CONSTRAINT "session_self_study_percent_range" CHECK ("registration_session"."self_study_percent" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "registration_session" ADD CONSTRAINT "session_unpaid_cancel_days_range" CHECK ("registration_session"."unpaid_cancel_days" BETWEEN 0 AND 60);--> statement-breakpoint
ALTER TABLE "registration_session" ADD CONSTRAINT "session_allowed_grades_valid" CHECK ("registration_session"."allowed_grades" <@ ARRAY['10', '11', '12', 'graduates']::text[]);--> statement-breakpoint
ALTER TABLE "registration_session" ADD CONSTRAINT "session_prices_final_at" CHECK (NOT "registration_session"."prices_final" OR "registration_session"."prices_final_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "session_offer" ADD CONSTRAINT "session_offer_teacher_choice_valid" CHECK ("session_offer"."teacher_choice" IN ('families', 'school'));--> statement-breakpoint
ALTER TABLE "session_offer" ADD CONSTRAINT "session_offer_course_fee_nonneg" CHECK ("session_offer"."course_fee" IS NULL OR "session_offer"."course_fee" >= 0);--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD CONSTRAINT "session_offer_item_exam_fee_nonneg" CHECK ("session_offer_item"."exam_fee" IS NULL OR "session_offer_item"."exam_fee" >= 0);--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD CONSTRAINT "session_offer_item_self_study_fee_nonneg" CHECK ("session_offer_item"."self_study_fee" IS NULL OR "session_offer_item"."self_study_fee" >= 0);--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD CONSTRAINT "session_offer_item_exam_fee_source_valid" CHECK ("session_offer_item"."exam_fee_source" IS NULL OR "session_offer_item"."exam_fee_source" IN ('list', 'typed', 'units_sum', 'board_rule'));--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD CONSTRAINT "session_offer_item_exam_fee_has_source" CHECK (("session_offer_item"."exam_fee" IS NULL) = ("session_offer_item"."exam_fee_source" IS NULL));--> statement-breakpoint
ALTER TABLE "session_offer_item" ADD CONSTRAINT "session_offer_item_paper_no_first" CHECK ("session_offer_item"."kind" <> 'paper' OR NOT ("session_offer_item"."first_in_school" OR "session_offer_item"."first_self_study"));
