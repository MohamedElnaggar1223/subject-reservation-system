ALTER TABLE "board_series" ADD COLUMN "admin_deadlines" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "board_series" ADD CONSTRAINT "board_series_admin_deadlines_valid" CHECK ("board_series"."admin_deadlines" <@ ARRAY['entry', 'retake']::text[]);--> statement-breakpoint
-- P1b fix 3: which deadlines of a sitting the admin entered from the check list (C6). Her entry deadline is
-- always hers (the board-date route requires it); her retake deadline only when her entry recorded one where the
-- sitting had none (BOARD_SERIES_DEADLINE_SET's previous and new data) — a retake deadline the loader filled
-- from the file afterwards is the file's. Idempotent: rows already marked are left alone.
UPDATE "board_series" bs SET "admin_deadlines" = array_remove(ARRAY[
    CASE WHEN bs."entry_deadline" IS NOT NULL THEN 'entry' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM "audit_log" a
      WHERE a."entity_id" = bs."id" AND a."action" = 'BOARD_SERIES_DEADLINE_SET' AND a."new_data"->>'datesSource' = 'admin'
        AND a."previous_data"->>'retakeDeadline' IS NULL AND a."new_data"->>'retakeDeadline' IS NOT NULL
    ) THEN 'retake' END
  ]::text[], NULL)
WHERE bs."dates_source" = 'admin' AND bs."admin_deadlines" = '{}'::text[];
