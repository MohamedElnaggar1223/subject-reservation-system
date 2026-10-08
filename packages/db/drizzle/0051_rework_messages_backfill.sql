-- Reservations rework, step D — messages and reminders (RESERVATIONS_REWORK.md §3.8, §7;
-- docs/features/RESERVATIONS_MESSAGES.md §1). Hand-written, after the additive structure (0050).
-- Idempotent: every insert is keyed on a stable id and skips what exists, so a second run inserts
-- nothing. Nothing is dropped: scheduled_announcement and its rows stay one release (§7 step 3).
--
--   the school's texts   → message_template rows (English and Arabic), one per reminder kind and
--                          the overdue wording of the two payment kinds;
--   the reminder rules   → one rule per kind for every session, with the prototype's defaults;
--   the recipient groups → saved broadcast audiences named as the old form named them, plus
--                          "Parents of grade 10/11/12";
--   announcements        → messages with a broadcast audience: every scheduled_announcement row
--                          (pending → scheduled, sent, failed, cancelled), and every announcement
--                          sent at once (its BULK_ANNOUNCEMENT notifications, one insert each); a
--                          sent one's deliveries are its existing notification rows (in-app) and,
--                          where it was emailed, an email delivery per row — nothing a family has
--                          received is touched.
-- Each moved announcement is audited once (REWORK_BACKFILL_MESSAGE).

-- 1. The school's texts.
INSERT INTO message_template (id, key, name, title_en, body_en, title_ar, body_ar) VALUES
  ('tpl-payment-due', 'payment_due', 'Payment due',
   'Payment due — {session}',
   'Dear {guardian}, {amount} for {student} ({items}) is due on {due}. You can pay in the app or at the school''s finance desk.',
   'موعد الدفع — {session}',
   'عزيزي ولي الأمر {guardian}، مبلغ {amount} الخاص بـ {student} ({items}) مستحق في {due}. يمكنكم الدفع من التطبيق أو في مكتب الشؤون المالية بالمدرسة.'),
  ('tpl-payment-overdue', 'payment_overdue', 'Payment overdue',
   'Payment overdue — {session}',
   'Dear {guardian}, {amount} for {student} ({items}) was due on {due} and is still unpaid. Please pay in the app or at the school''s finance desk.',
   'دفعة متأخرة — {session}',
   'عزيزي ولي الأمر {guardian}، كان مبلغ {amount} الخاص بـ {student} ({items}) مستحقًا في {due} ولم يُسدَّد بعد. يرجى الدفع من التطبيق أو في مكتب الشؤون المالية بالمدرسة.'),
  ('tpl-session-closing', 'session_closing', 'Reservations closing',
   '{session}: reservations close on {closes}',
   'Reservations for {session} close on {closes}. Make sure every subject you want is reserved: after the board''s entry deadline nothing more can be entered.',
   '{session}: ينتهي الحجز في {closes}',
   'ينتهي الحجز لـ {session} في {closes}. تأكدوا من حجز كل المواد المطلوبة: بعد الموعد النهائي لقيد المجلس لا يمكن قيد أي شيء.'),
  ('tpl-entry-deadline', 'entry_deadline', 'Board entry deadline (staff)',
   '{series}: the board''s entry deadline is {closes}',
   'The board''s entry deadline for {series} is {closes}. {count} lines in it are still unpaid; at the deadline they expire.',
   '{series}: الموعد النهائي لقيد المجلس {closes}',
   'الموعد النهائي لقيد المجلس لـ {series} هو {closes}. ما زال {count} من الأسطر فيها غير مدفوع، وتنتهي عند الموعد.'),
  ('tpl-school-fee-due', 'school_fee_due', 'School fee due',
   'School fee due — {student}',
   'Dear {guardian}, the school fee for {student}, {amount}, is due on {due}. It is paid on the School fee page or at the finance desk.',
   'موعد الرسوم المدرسية — {student}',
   'عزيزي ولي الأمر {guardian}، الرسوم المدرسية الخاصة بـ {student}، {amount}، مستحقة في {due}. تُدفع من صفحة الرسوم المدرسية أو في مكتب الشؤون المالية.'),
  ('tpl-school-fee-overdue', 'school_fee_overdue', 'School fee overdue',
   'School fee overdue — {student}',
   'Dear {guardian}, the school fee for {student}, {amount}, was due on {due} and is still unpaid. It is paid on the School fee page or at the finance desk.',
   'رسوم مدرسية متأخرة — {student}',
   'عزيزي ولي الأمر {guardian}، كانت الرسوم المدرسية الخاصة بـ {student}، {amount}، مستحقة في {due} ولم تُسدَّد بعد. تُدفع من صفحة الرسوم المدرسية أو في مكتب الشؤون المالية.'),
  ('tpl-declared-retakes', 'declared_retakes_to_verify', 'Declared retakes to verify (coordinator)',
   '{session}: {count} declared sittings to verify',
   '{count} declared sittings in {session} await verification on the session''s To verify tab. The first of their deadlines is {closes}.',
   '{session}: {count} من الجلسات المعلنة للتحقق',
   'تنتظر {count} من الجلسات المعلنة في {session} التحقق في تبويب «للتحقق» بالجلسة. وأول مواعيدها النهائية {closes}.')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- 2. One rule per kind for every session (the prototype's defaults, RESERVATIONS_REWORK.md §13).
INSERT INTO reminder_rule (id, kind, session_id, offsets_days, repeat_every_days, until, channels, template_id, overdue_template_id, active) VALUES
  ('rule-payment-due', 'payment_due', NULL, ARRAY[-7, -3, 0, 3], 3, 'paid', ARRAY['in_app', 'email'], 'tpl-payment-due', 'tpl-payment-overdue', true),
  ('rule-session-closing', 'session_closing', NULL, ARRAY[-14, -7, -1], NULL, 'closed', ARRAY['in_app', 'email'], 'tpl-session-closing', NULL, true),
  ('rule-entry-deadline', 'entry_deadline', NULL, ARRAY[-14, -1], NULL, 'deadline', ARRAY['in_app'], 'tpl-entry-deadline', NULL, true),
  ('rule-school-fee-due', 'school_fee_due', NULL, ARRAY[-14, -7, 0], 7, 'paid', ARRAY['in_app', 'email'], 'tpl-school-fee-due', 'tpl-school-fee-overdue', true),
  ('rule-declared-retakes', 'declared_retakes_to_verify', NULL, ARRAY[-14, -7, -3, -1], NULL, 'verified', ARRAY['in_app'], 'tpl-declared-retakes', NULL, true)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- 3. The old form's recipient groups as saved audiences (their members resolved when sent), and
--    the parents of each grade, which the old form could not reach.
INSERT INTO message_audience (id, kind, definition, name, saved, legacy) VALUES
  ('aud-all', 'broadcast', '{"kind":"broadcast","group":"everyone"}', 'All Users', true, '{"recipients":"all"}'),
  ('aud-students', 'broadcast', '{"kind":"broadcast","group":"students"}', 'All Students', true, '{"recipients":"students"}'),
  ('aud-parents', 'broadcast', '{"kind":"broadcast","group":"parents"}', 'All Parents', true, '{"recipients":"parents"}'),
  ('aud-grade-10', 'broadcast', '{"kind":"broadcast","group":"students","grade":10}', 'Grade 10 Students', true, '{"recipients":"grade_10"}'),
  ('aud-grade-11', 'broadcast', '{"kind":"broadcast","group":"students","grade":11}', 'Grade 11 Students', true, '{"recipients":"grade_11"}'),
  ('aud-grade-12', 'broadcast', '{"kind":"broadcast","group":"students","grade":12}', 'Grade 12 Students', true, '{"recipients":"grade_12"}'),
  ('aud-parents-grade-10', 'broadcast', '{"kind":"broadcast","group":"parents","grade":10}', 'Parents of grade 10', true, NULL),
  ('aud-parents-grade-11', 'broadcast', '{"kind":"broadcast","group":"parents","grade":11}', 'Parents of grade 11', true, NULL),
  ('aud-parents-grade-12', 'broadcast', '{"kind":"broadcast","group":"parents","grade":12}', 'Parents of grade 12', true, NULL)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- 4. A recipient group as an audience definition.
CREATE OR REPLACE FUNCTION rework_audience_of_recipients(recipients text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN recipients = 'all' THEN '{"kind":"broadcast","group":"everyone"}'::jsonb
    WHEN recipients = 'students' THEN '{"kind":"broadcast","group":"students"}'::jsonb
    WHEN recipients = 'parents' THEN '{"kind":"broadcast","group":"parents"}'::jsonb
    WHEN recipients ~ '^grade_1[0-2]$' THEN jsonb_build_object('kind', 'broadcast', 'group', 'students', 'grade', substring(recipients from 7)::int)
    ELSE '{"kind":"broadcast","group":"everyone"}'::jsonb
  END
$$;
--> statement-breakpoint

-- 5. Every scheduled announcement becomes a message with a broadcast audience of its own.
INSERT INTO message_audience (id, kind, definition, saved, resolved_count, resolved_at, legacy, created_by, created_at)
SELECT 'aud-ann-' || a.id, 'broadcast', rework_audience_of_recipients(a.recipients), false, a.notification_count, a.sent_at,
       jsonb_build_object('recipients', a.recipients, 'scheduledAnnouncementId', a.id), a.created_by, a.created_at
FROM scheduled_announcement a
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

INSERT INTO message (id, audience_id, title, body, language, channels, notification_type, source, status, scheduled_at, sent_at,
                     recipient_count, error, cancelled_at, cancel_reason, legacy_announcement_id, created_by, created_at, updated_at)
SELECT 'msg-ann-' || a.id, 'aud-ann-' || a.id, a.title, a.body, 'en',
       CASE WHEN a.send_email THEN ARRAY['in_app', 'email'] ELSE ARRAY['in_app'] END,
       'BULK_ANNOUNCEMENT', 'legacy_announcement',
       CASE a.status WHEN 'pending' THEN 'scheduled' WHEN 'sent' THEN 'sent' WHEN 'cancelled' THEN 'cancelled' ELSE 'failed' END,
       a.scheduled_at,
       CASE WHEN a.status = 'sent' THEN coalesce(a.sent_at, a.updated_at) END,
       a.notification_count,
       CASE WHEN a.status NOT IN ('pending', 'sent', 'cancelled') THEN coalesce(a.error_message, 'The announcement could not be sent') END,
       CASE WHEN a.status = 'cancelled' THEN a.updated_at END,
       CASE WHEN a.status = 'cancelled' THEN 'Cancelled before step D (an announcement in the old queue)' END,
       a.id, a.created_by, a.created_at, a.updated_at
FROM scheduled_announcement a
WHERE NOT EXISTS (SELECT 1 FROM message m WHERE m.legacy_announcement_id = a.id);
--> statement-breakpoint

-- 6. A sent scheduled announcement's deliveries: its notifications (the same title and text, written
--    in one insert right after it was claimed), in-app, and its emails where it was emailed.
INSERT INTO message_delivery (id, message_id, recipient_id, student_id, channel, status, title, body, notification_id, sent_at, attempts, created_at, updated_at)
SELECT 'dlv-' || n.id || '-in_app', 'msg-ann-' || a.id, n.user_id, CASE WHEN u.role = 'student' THEN u.id END, 'in_app', 'sent', n.title, n.body, n.id,
       n.created_at, 1, n.created_at, n.created_at
FROM scheduled_announcement a
JOIN notification n ON n.type = 'BULK_ANNOUNCEMENT' AND n.title = a.title AND n.body = a.body
  AND n.created_at BETWEEN coalesce(a.sent_at, a.updated_at) - interval '1 minute' AND coalesce(a.sent_at, a.updated_at) + interval '30 minutes'
JOIN "user" u ON u.id = n.user_id
WHERE a.status = 'sent'
  AND NOT EXISTS (SELECT 1 FROM message_delivery d WHERE d.notification_id = n.id)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO message_delivery (id, message_id, recipient_id, student_id, channel, status, title, body, address, error, sent_at, attempts, created_at, updated_at)
SELECT 'dlv-' || n.id || '-email', d.message_id, n.user_id, d.student_id, 'email',
       CASE WHEN n.email_sent_at IS NOT NULL THEN 'sent' ELSE 'failed' END, n.title, n.body, u.email,
       CASE WHEN n.email_sent_at IS NULL THEN 'No email was recorded as sent for this announcement (before messages)' END,
       n.email_sent_at, 1, n.created_at, coalesce(n.email_sent_at, n.created_at)
FROM message_delivery d
JOIN message m ON m.id = d.message_id AND m.source = 'legacy_announcement' AND 'email' = ANY (m.channels)
JOIN notification n ON n.id = d.notification_id
JOIN "user" u ON u.id = n.user_id
WHERE d.channel = 'in_app'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 7. Announcements sent at once never had a queue row: each is the notifications one insert wrote
--    (the same title, text and instant). Its recipient group is read from its ADMIN_ANNOUNCEMENT
--    audit row (written right after, with the count) when one matches; else it is recorded unknown.
CREATE TEMP TABLE rework_bulk ON COMMIT DROP AS
WITH g AS (
  SELECT 'msg-bulk-' || md5(n.title || chr(31) || n.body || chr(31) || extract(epoch from n.created_at)::text) AS message_id,
         n.title, n.body, n.created_at, count(*)::int AS n, bool_or(n.email_sent_at IS NOT NULL) AS emailed
  FROM notification n
  WHERE n.type = 'BULK_ANNOUNCEMENT'
    AND NOT EXISTS (SELECT 1 FROM message_delivery d WHERE d.notification_id = n.id)
  GROUP BY n.title, n.body, n.created_at
)
SELECT g.*, al.new_data->>'recipients' AS recipients, al.user_id AS created_by
FROM g
LEFT JOIN LATERAL (
  SELECT a.new_data, a.user_id FROM audit_log a
  WHERE a.action = 'ADMIN_ANNOUNCEMENT' AND a.entity_id = '' AND (a.new_data->>'notificationCount')::int = g.n
    AND a.created_at BETWEEN g.created_at AND g.created_at + interval '10 minutes'
  ORDER BY a.created_at LIMIT 1
) al ON true;
--> statement-breakpoint

INSERT INTO message_audience (id, kind, definition, saved, resolved_count, resolved_at, legacy, created_by, created_at)
SELECT 'aud-' || b.message_id, 'broadcast', rework_audience_of_recipients(coalesce(b.recipients, 'all')), false, b.n, b.created_at,
       jsonb_build_object('recipients', b.recipients, 'sentAtOnce', true, 'recipientsKnown', b.recipients IS NOT NULL), b.created_by, b.created_at
FROM rework_bulk b
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

INSERT INTO message (id, audience_id, title, body, language, channels, notification_type, source, status, sent_at, recipient_count, created_by, created_at, updated_at)
SELECT b.message_id, 'aud-' || b.message_id, b.title, b.body, 'en',
       CASE WHEN b.emailed THEN ARRAY['in_app', 'email'] ELSE ARRAY['in_app'] END,
       'BULK_ANNOUNCEMENT', 'legacy_announcement', 'sent', b.created_at, b.n, b.created_by, b.created_at, b.created_at
FROM rework_bulk b
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

INSERT INTO message_delivery (id, message_id, recipient_id, student_id, channel, status, title, body, notification_id, sent_at, attempts, created_at, updated_at)
SELECT 'dlv-' || n.id || '-in_app', b.message_id, n.user_id, CASE WHEN u.role = 'student' THEN u.id END, 'in_app', 'sent', n.title, n.body, n.id,
       n.created_at, 1, n.created_at, n.created_at
FROM rework_bulk b
JOIN notification n ON n.type = 'BULK_ANNOUNCEMENT' AND n.title = b.title AND n.body = b.body AND n.created_at = b.created_at
JOIN "user" u ON u.id = n.user_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO message_delivery (id, message_id, recipient_id, student_id, channel, status, title, body, address, error, sent_at, attempts, created_at, updated_at)
SELECT 'dlv-' || n.id || '-email', d.message_id, n.user_id, d.student_id, 'email',
       CASE WHEN n.email_sent_at IS NOT NULL THEN 'sent' ELSE 'failed' END, n.title, n.body, u.email,
       CASE WHEN n.email_sent_at IS NULL THEN 'No email was recorded as sent for this announcement (before messages)' END,
       n.email_sent_at, 1, n.created_at, coalesce(n.email_sent_at, n.created_at)
FROM rework_bulk b
JOIN message m ON m.id = b.message_id AND 'email' = ANY (m.channels)
JOIN message_delivery d ON d.message_id = m.id AND d.channel = 'in_app'
JOIN notification n ON n.id = d.notification_id
JOIN "user" u ON u.id = n.user_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 8. One audit row per moved announcement.
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data)
SELECT gen_random_uuid()::text, NULL, 'REWORK_BACKFILL_MESSAGE', 'message', m.id,
       CASE WHEN m.legacy_announcement_id IS NOT NULL
         THEN jsonb_build_object('scheduledAnnouncementId', m.legacy_announcement_id)
         ELSE jsonb_build_object('announcementSentAt', m.sent_at) END,
       jsonb_build_object('status', m.status, 'audience', (SELECT a.definition FROM message_audience a WHERE a.id = m.audience_id),
         'inAppDeliveries', (SELECT count(*) FROM message_delivery d WHERE d.message_id = m.id AND d.channel = 'in_app'),
         'emailDeliveries', (SELECT count(*) FROM message_delivery d WHERE d.message_id = m.id AND d.channel = 'email'))
FROM message m
WHERE m.source = 'legacy_announcement'
  AND NOT EXISTS (SELECT 1 FROM audit_log al WHERE al.action = 'REWORK_BACKFILL_MESSAGE' AND al.entity_id = m.id);
