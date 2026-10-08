CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"audience_id" text NOT NULL,
	"template_id" text,
	"title" text,
	"body" text,
	"title_ar" text,
	"body_ar" text,
	"language" text DEFAULT 'both' NOT NULL,
	"channels" text[] NOT NULL,
	"context" jsonb,
	"notification_type" text NOT NULL,
	"source" text DEFAULT 'staff' NOT NULL,
	"reminder_rule_id" text,
	"status" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipient_count" integer,
	"error" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"legacy_announcement_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_status_valid" CHECK ("message"."status" IN ('scheduled', 'sent', 'cancelled', 'failed')),
	CONSTRAINT "message_source_valid" CHECK ("message"."source" IN ('staff', 'reminder', 'legacy_announcement')),
	CONSTRAINT "message_language_valid" CHECK ("message"."language" IN ('en', 'ar', 'both')),
	CONSTRAINT "message_channels_valid" CHECK (cardinality("message"."channels") > 0 AND "message"."channels" <@ ARRAY['in_app', 'email', 'whatsapp']::text[]),
	CONSTRAINT "message_has_text" CHECK ("message"."template_id" IS NOT NULL OR ("message"."title" IS NOT NULL AND "message"."body" IS NOT NULL)),
	CONSTRAINT "message_scheduled_has_time" CHECK ("message"."status" <> 'scheduled' OR "message"."scheduled_at" IS NOT NULL),
	CONSTRAINT "message_sent_has_time" CHECK ("message"."status" <> 'sent' OR "message"."sent_at" IS NOT NULL),
	CONSTRAINT "message_reminder_has_rule" CHECK (("message"."source" = 'reminder') = ("message"."reminder_rule_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "message_audience" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"definition" jsonb NOT NULL,
	"name" text,
	"saved" boolean DEFAULT false NOT NULL,
	"resolved_count" integer,
	"resolved_at" timestamp with time zone,
	"legacy" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_audience_kind_valid" CHECK ("message_audience"."kind" IN ('broadcast', 'batch', 'direct')),
	CONSTRAINT "message_audience_saved_named" CHECK (NOT "message_audience"."saved" OR "message_audience"."name" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "message_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"student_id" text,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"address" text,
	"notification_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_delivery_channel_valid" CHECK ("message_delivery"."channel" IN ('in_app', 'email', 'whatsapp')),
	CONSTRAINT "message_delivery_status_valid" CHECK ("message_delivery"."status" IN ('queued', 'sending', 'sent', 'failed')),
	CONSTRAINT "message_delivery_failed_says_why" CHECK ("message_delivery"."status" <> 'failed' OR "message_delivery"."error" IS NOT NULL),
	CONSTRAINT "message_delivery_sent_has_time" CHECK ("message_delivery"."status" <> 'sent' OR "message_delivery"."sent_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "message_template" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"title_en" text NOT NULL,
	"body_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"body_ar" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"session_id" text,
	"offsets_days" integer[] NOT NULL,
	"repeat_every_days" integer,
	"until" text NOT NULL,
	"channels" text[] NOT NULL,
	"template_id" text NOT NULL,
	"overdue_template_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"inherits_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_rule_kind_valid" CHECK ("reminder_rule"."kind" IN ('payment_due', 'session_closing', 'entry_deadline', 'school_fee_due', 'declared_retakes_to_verify')),
	CONSTRAINT "reminder_rule_until_valid" CHECK ("reminder_rule"."until" IN ('paid', 'closed', 'deadline', 'verified')),
	CONSTRAINT "reminder_rule_offsets_valid" CHECK (cardinality("reminder_rule"."offsets_days") BETWEEN 1 AND 12),
	CONSTRAINT "reminder_rule_repeat_valid" CHECK ("reminder_rule"."repeat_every_days" IS NULL OR "reminder_rule"."repeat_every_days" BETWEEN 1 AND 60),
	CONSTRAINT "reminder_rule_channels_valid" CHECK (cardinality("reminder_rule"."channels") > 0 AND "reminder_rule"."channels" <@ ARRAY['in_app', 'email', 'whatsapp']::text[]),
	CONSTRAINT "reminder_rule_global_never_inherits" CHECK ("reminder_rule"."session_id" IS NOT NULL OR "reminder_rule"."inherits_at" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "reminder_sent" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"anchor_on" date NOT NULL,
	"offset_days" integer NOT NULL,
	"student_id" text,
	"session_id" text,
	"message_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_sent_target_kind_valid" CHECK ("reminder_sent"."target_kind" IN ('line', 'charge', 'session', 'series_entry', 'series_retake', 'verification'))
);
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_audience_id_message_audience_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."message_audience"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_template_id_message_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_reminder_rule_id_reminder_rule_id_fk" FOREIGN KEY ("reminder_rule_id") REFERENCES "public"."reminder_rule"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_audience" ADD CONSTRAINT "message_audience_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery" ADD CONSTRAINT "message_delivery_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery" ADD CONSTRAINT "message_delivery_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery" ADD CONSTRAINT "message_delivery_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery" ADD CONSTRAINT "message_delivery_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_rule" ADD CONSTRAINT "reminder_rule_session_id_registration_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."registration_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_rule" ADD CONSTRAINT "reminder_rule_template_id_message_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_rule" ADD CONSTRAINT "reminder_rule_overdue_template_id_message_template_id_fk" FOREIGN KEY ("overdue_template_id") REFERENCES "public"."message_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_rule" ADD CONSTRAINT "reminder_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_rule" ADD CONSTRAINT "reminder_rule_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sent" ADD CONSTRAINT "reminder_sent_rule_id_reminder_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."reminder_rule"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sent" ADD CONSTRAINT "reminder_sent_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sent" ADD CONSTRAINT "reminder_sent_session_id_registration_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."registration_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sent" ADD CONSTRAINT "reminder_sent_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_status_scheduled_idx" ON "message" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "message_createdAt_idx" ON "message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "message_reminderRuleId_idx" ON "message" USING btree ("reminder_rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_legacy_announcement_idx" ON "message" USING btree ("legacy_announcement_id") WHERE legacy_announcement_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messageAudience_saved_name_idx" ON "message_audience" USING btree (lower("name")) WHERE saved;--> statement-breakpoint
CREATE INDEX "messageDelivery_messageId_idx" ON "message_delivery" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "messageDelivery_recipientId_idx" ON "message_delivery" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "messageDelivery_status_idx" ON "message_delivery" USING btree ("status","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "messageDelivery_one_idx" ON "message_delivery" USING btree ("message_id","recipient_id","channel",coalesce("student_id", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "messageDelivery_notification_idx" ON "message_delivery" USING btree ("notification_id") WHERE notification_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messageTemplate_key_idx" ON "message_template" USING btree ("key") WHERE key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messageTemplate_name_idx" ON "message_template" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "reminderRule_global_idx" ON "reminder_rule" USING btree ("kind") WHERE session_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reminderRule_session_idx" ON "reminder_rule" USING btree ("kind","session_id") WHERE session_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reminderSent_claim_idx" ON "reminder_sent" USING btree ("kind","target_kind","target_id","anchor_on","offset_days");--> statement-breakpoint
CREATE INDEX "reminderSent_messageId_idx" ON "reminder_sent" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "reminderSent_studentId_idx" ON "reminder_sent" USING btree ("student_id");