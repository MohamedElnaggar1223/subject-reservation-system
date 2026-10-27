-- P1c (COORDINATOR_REWORK.md §9.2: entry_deadline reminders go): the staff's board-entry-deadline reminder kind is
-- retired. Since P1b it found nothing to remind of (board deadlines are reference data and act through each line's
-- cut-off, whose reminders are the payment ones).
--
--   1. A rule of the kind that never sent anything (no claim, no message) is deleted, audited.
--   2. One that sent reminders stays, switched off, for its messages (message_reminder_has_rule keeps a reminder's
--      rule); the checks admit the kind only in that retired form, and the API never reads it again.
--   3. Its seeded template ('entry_deadline') is switched off: its words ({series}, {count}) fit no other message.
--
-- Idempotent. No BEGIN or COMMIT: the migrator runs pending migrations in one transaction.
WITH gone AS (
  DELETE FROM reminder_rule r
  WHERE r.kind = 'entry_deadline'
    AND NOT EXISTS (SELECT 1 FROM reminder_sent s WHERE s.rule_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM message m WHERE m.reminder_rule_id = r.id)
  RETURNING r.id, r.session_id, r.active
)
INSERT INTO "audit_log" ("id", "user_id", "action", "entity_type", "entity_id", "previous_data", "new_data")
SELECT gen_random_uuid()::text, NULL, 'REMINDER_RULE_SET', 'reminder_rule', g.id,
       jsonb_build_object('kind', 'entry_deadline', 'sessionId', g.session_id, 'active', g.active),
       jsonb_build_object('deleted', true, 'reason', 'P1c: the staff''s board-deadline reminder kind is retired (migration 0071)')
FROM gone g;
--> statement-breakpoint
WITH kept AS (
  UPDATE reminder_rule SET active = false, updated_at = now()
  WHERE kind = 'entry_deadline' AND active
  RETURNING id
)
INSERT INTO "audit_log" ("id", "user_id", "action", "entity_type", "entity_id", "previous_data", "new_data")
SELECT gen_random_uuid()::text, NULL, 'REMINDER_RULE_SET', 'reminder_rule', k.id,
       jsonb_build_object('active', true),
       jsonb_build_object('active', false, 'reason', 'P1c: the staff''s board-deadline reminder kind is retired; kept switched off for the reminders it sent (migration 0071)')
FROM kept k;
--> statement-breakpoint
UPDATE message_template SET active = false, updated_at = now() WHERE key = 'entry_deadline' AND active;
--> statement-breakpoint
ALTER TABLE "reminder_rule" DROP CONSTRAINT "reminder_rule_kind_valid";--> statement-breakpoint
ALTER TABLE "reminder_rule" DROP CONSTRAINT "reminder_rule_until_valid";--> statement-breakpoint
ALTER TABLE "reminder_rule" ADD CONSTRAINT "reminder_rule_kind_valid" CHECK ("reminder_rule"."kind" IN ('payment_due', 'session_closing', 'school_fee_due', 'declared_retakes_to_verify') OR ("reminder_rule"."kind" = 'entry_deadline' AND NOT "reminder_rule"."active"));--> statement-breakpoint
ALTER TABLE "reminder_rule" ADD CONSTRAINT "reminder_rule_until_valid" CHECK ("reminder_rule"."until" IN ('paid', 'closed', 'verified') OR ("reminder_rule"."kind" = 'entry_deadline' AND "reminder_rule"."until" = 'deadline'));