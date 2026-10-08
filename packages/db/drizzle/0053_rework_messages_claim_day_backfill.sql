-- Reservations rework, step D — the day each reminder claim was sent on (the review of 5c2f2bf,
-- item 5). Hand-written, between 0052 (the column, nullable, and the one-a-day unique index) and
-- 0054 (NOT NULL). Idempotent: it fills only the claims without a day.
--
-- A claim's day is the school's day (Cairo) of the scheduler's minute that sent it, which the
-- reminder message keeps in its context (`dueAt`); a claim written before that was kept takes the
-- day of its own sent_at.
UPDATE reminder_sent rs
SET sent_on = (coalesce((m.context->>'dueAt')::timestamptz, rs.sent_at) AT TIME ZONE 'Africa/Cairo')::date
FROM message m
WHERE m.id = rs.message_id AND rs.sent_on IS NULL;
