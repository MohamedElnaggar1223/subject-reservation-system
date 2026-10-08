-- Reservations rework, step 1 — the conversion (RESERVATIONS_REWORK.md §7 step 2;
-- docs/features/RESERVATIONS.md §1). Hand-written, between the additive structure (0041) and
-- the constraints that need the backfilled values (0043). Idempotent: every step converts only
-- rows not yet converted. Nothing is dropped (§7 step 3 is a later release).
--
-- One rule per row kind:
--   windows   → sessions: june stays june; october and november become winter of their year,
--               january winter of the year before; each keeps a label (its old type and level),
--               its name is derived, the old name goes to edit_history; course start = the
--               window's start, payment due = its end, no refund policy (its absolute refund
--               windows stay and are read as today); the level column is left as it was.
--   subjects  → offers and items: an offer for every subject with a line in the window and every
--               active subject at its level; open, closed (a closed window, an inactive subject)
--               or self-study only (not taught at school); the subject's course fee and core flag;
--               its linked teachers; one "whole subject" item per (subject, series its lines sit
--               in), or the series the window's route or default gave a subject with no line; an
--               item with no series (the window fed none) is closed; its board fee is the
--               subject's registration fee in that series, confirmed (it was the price).
--   lines     → the item of their subject in their series; attempt and mode from is_retake and
--               taken_outside_school; a retake's prior sitting is the latest earlier confirmed
--               line's series ('known') or unknown ('legacy'); due at the window's end; no
--               pricing basis and no refund snapshot (converted lines refund as today).
--   swaps     → a pending swap names its new subject's whole item.
--   exceptions, refund windows, remark fees and deadlines, announcements: untouched here — the
--               exception registry and the board services are step C's, messages step D's.
-- Each converted session, offer, fee and line is audited once (REWORK_BACKFILL_*). A line left
-- without an item stops the migration, naming its window.

-- 1. Functions the rules below and the API share.

-- The month order of the boards' calendar.
CREATE OR REPLACE FUNCTION school_month_order(m text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE m WHEN 'january' THEN 1 WHEN 'june' THEN 6 WHEN 'october' THEN 10 WHEN 'november' THEN 11 END
$$;
--> statement-breakpoint

-- The board's sitting just before (month, year) in its own calendar (exam_board.series_months).
CREATE OR REPLACE FUNCTION board_previous_sitting(p_board text, p_month text, p_year integer, OUT month text, OUT year integer)
LANGUAGE sql STABLE AS $$
  SELECT c.m, c.y FROM (
    SELECT jsonb_array_elements_text(b.series_months) AS m, p_year AS y FROM exam_board b WHERE b.code = p_board
    UNION ALL
    SELECT jsonb_array_elements_text(b.series_months) AS m, p_year - 1 AS y FROM exam_board b WHERE b.code = p_board
  ) c
  WHERE c.y * 100 + school_month_order(c.m) < p_year * 100 + school_month_order(p_month)
  ORDER BY c.y * 100 + school_month_order(c.m) DESC
  LIMIT 1
$$;
--> statement-breakpoint

-- A line's effective deadline (§3.3): the series' retake deadline for a retake whose prior
-- sitting is the board's latest sitting before this series; else the entry deadline; else, for a
-- series with no entry deadline, the start of its exams_start day in Cairo; else null.
CREATE OR REPLACE FUNCTION line_effective_deadline(p_attempt text, p_prior text, p_series text) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
DECLARE s record; p record; prev record;
BEGIN
  IF p_series IS NULL THEN RETURN NULL; END IF;
  SELECT board_code, month, year, entry_deadline, retake_deadline, exams_start INTO s FROM board_series WHERE id = p_series;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_attempt = 'retake' AND s.retake_deadline IS NOT NULL AND p_prior IS NOT NULL THEN
    SELECT board_code, month, year INTO p FROM board_series WHERE id = p_prior;
    SELECT * INTO prev FROM board_previous_sitting(s.board_code, s.month, s.year);
    IF p.board_code = s.board_code AND p.month = prev.month AND p.year = prev.year THEN
      RETURN s.retake_deadline;
    END IF;
  END IF;
  IF s.entry_deadline IS NOT NULL THEN RETURN s.entry_deadline; END IF;
  IF s.exams_start IS NOT NULL THEN RETURN (s.exams_start::timestamp AT TIME ZONE 'Africa/Cairo'); END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- Which deadline that is: 'retake' | 'entry' | 'exams_start' | null.
CREATE OR REPLACE FUNCTION line_effective_deadline_kind(p_attempt text, p_prior text, p_series text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE s record; at timestamptz;
BEGIN
  IF p_series IS NULL THEN RETURN NULL; END IF;
  SELECT entry_deadline, retake_deadline, exams_start INTO s FROM board_series WHERE id = p_series;
  IF NOT FOUND THEN RETURN NULL; END IF;
  at := line_effective_deadline(p_attempt, p_prior, p_series);
  IF at IS NULL THEN RETURN NULL; END IF;
  IF s.retake_deadline IS NOT NULL AND at = s.retake_deadline AND (s.entry_deadline IS NULL OR s.retake_deadline <> s.entry_deadline) THEN RETURN 'retake'; END IF;
  IF s.entry_deadline IS NOT NULL THEN RETURN 'entry'; END IF;
  RETURN 'exams_start';
END $$;
--> statement-breakpoint

-- The session's name (deriveSessionName in @repo/validations says the same).
CREATE OR REPLACE FUNCTION school_session_label_text(p_type text, p_label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_label = '' THEN ''
    WHEN p_label ~ '^(june|october|november|january)-(igcse|as_level|a_level)$' THEN
      concat_ws(' ',
        CASE WHEN split_part(p_label, '-', 1) = p_type THEN NULL ELSE initcap(split_part(p_label, '-', 1)) END,
        CASE split_part(p_label, '-', 2) WHEN 'igcse' THEN 'IGCSE' WHEN 'as_level' THEN 'AS' ELSE 'A Level' END)
    ELSE p_label
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION school_session_name(p_type text, p_year integer, p_label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_type = 'winter' THEN format('November %s – January %s', p_year, p_year + 1) ELSE format('June %s', p_year) END
    || CASE WHEN p_label = '' THEN '' ELSE ' — ' || school_session_label_text(p_type, p_label) END
$$;
--> statement-breakpoint

-- 2. The window rule loses its deadline clause (§3.3: the cut-off is per item). The academic
--    year and kind clauses stay; the triggers that call it (0038) are unchanged.
CREATE OR REPLACE FUNCTION catalogue_window_series_check(
  w_type text, w_year integer, w_end timestamptz, s_month text, s_year integer, s_deadline timestamptz
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF school_series_academic_year_start(s_month, s_year) <> school_series_academic_year_start(w_type, w_year) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'window_series_same_academic_year',
      MESSAGE = format('A %s %s series is not in the academic year of a %s %s session', s_month, s_year, w_type, w_year);
  END IF;
  IF (s_month = 'june') <> (w_type = 'june') THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'window_series_same_kind',
      MESSAGE = format('A %s series cannot be fed by a %s session: June and the other series are judged differently', s_month, w_type);
  END IF;
END $$;
--> statement-breakpoint

-- 3. The board's carry-forward period (gate.priorSeries; F4 reads it): Cambridge carries an AS
--    result forward within 13 months (DISCOVERY_RESEARCH.md §1); none on record for the others.
UPDATE exam_board SET carry_forward_months = 13 WHERE code = 'cambridge' AND carry_forward_months IS NULL;
--> statement-breakpoint

-- 4. Windows → sessions (audited first, from the old values).
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
SELECT gen_random_uuid()::text, NULL, 'REWORK_BACKFILL_SESSION', 'session', w.id,
  jsonb_build_object('name', w.name, 'sessionType', w.session_type, 'seriesYear', w.series_year, 'qualificationLevel', w.qualification_level),
  jsonb_build_object(
    'name', school_session_name(CASE WHEN w.session_type = 'june' THEN 'june' ELSE 'winter' END,
      CASE WHEN w.session_type = 'january' THEN w.series_year - 1 ELSE w.series_year END,
      w.session_type || '-' || coalesce(w.qualification_level, 'igcse')),
    'sessionType', CASE WHEN w.session_type = 'june' THEN 'june' ELSE 'winter' END,
    'seriesYear', CASE WHEN w.session_type = 'january' THEN w.series_year - 1 ELSE w.series_year END,
    'label', w.session_type || '-' || coalesce(w.qualification_level, 'igcse'),
    'courseStartsOn', (w.start_date AT TIME ZONE 'Africa/Cairo')::date,
    'paymentDueAt', w.end_date,
    'reason', 'Reservations rework: a window becomes a session of its type and year, keeping a label (migration 0042)'),
  now()
FROM registration_session w
WHERE w.payment_due_at IS NULL AND w.label = '' AND w.session_type IN ('june', 'october', 'november', 'january');
--> statement-breakpoint
UPDATE registration_session w SET
  label = w.session_type || '-' || coalesce(w.qualification_level, 'igcse'),
  name = school_session_name(CASE WHEN w.session_type = 'june' THEN 'june' ELSE 'winter' END,
    CASE WHEN w.session_type = 'january' THEN w.series_year - 1 ELSE w.series_year END,
    w.session_type || '-' || coalesce(w.qualification_level, 'igcse')),
  edit_history = coalesce(w.edit_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'editedBy', 'system', 'editedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'field', 'name',
    'oldValue', w.name,
    'newValue', school_session_name(CASE WHEN w.session_type = 'june' THEN 'june' ELSE 'winter' END,
      CASE WHEN w.session_type = 'january' THEN w.series_year - 1 ELSE w.series_year END,
      w.session_type || '-' || coalesce(w.qualification_level, 'igcse')),
    'reason', 'Reservations rework: the name is derived from the type and year (migration 0042)')),
  session_type = CASE WHEN w.session_type = 'june' THEN 'june' ELSE 'winter' END,
  series_year = CASE WHEN w.session_type = 'january' THEN w.series_year - 1 ELSE w.series_year END,
  course_starts_on = (w.start_date AT TIME ZONE 'Africa/Cairo')::date,
  payment_due_at = w.end_date
WHERE w.payment_due_at IS NULL AND w.label = '' AND w.session_type IN ('june', 'october', 'november', 'january');
--> statement-breakpoint

-- 5. Subjects → offers. Every subject with a line in the window (any status) and every active
--    subject at the window's level.
INSERT INTO session_offer (id, session_id, subject_id, availability, course_fee, grade10_core, sort_order, legacy, created_at, updated_at)
SELECT md5('rework-offer:' || w.id || ':' || s.id)::uuid::text, w.id, s.id,
  CASE WHEN w.status = 'closed' OR NOT s.is_active THEN 'closed'
       WHEN NOT s.is_offered_at_school THEN 'self_study_only'
       ELSE 'open' END,
  s.course_fee, s.is_core, 0, '{"converted": true}'::jsonb, now(), now()
FROM registration_session w
JOIN subject s ON (s.is_active AND s.qualification_level = w.qualification_level)
  OR EXISTS (SELECT 1 FROM registration r WHERE r.session_id = w.id AND r.subject_id = s.id)
WHERE w.label <> '' AND w.label ~ '^(june|october|november|january)-'
ON CONFLICT (session_id, subject_id) DO NOTHING;
--> statement-breakpoint

-- Their teachers: the subject's linked teachers, in school.
INSERT INTO session_offer_teacher (id, offer_id, teacher_id, mode, sort_order, created_at)
SELECT md5('rework-offer-teacher:' || o.id || ':' || t.id)::uuid::text, o.id, t.id, 'in_school',
  (row_number() OVER (PARTITION BY o.id ORDER BY t.name, t.id))::integer, now()
FROM session_offer o
JOIN subject_teacher st ON st.subject_id = o.subject_id
JOIN teacher t ON t.id = st.teacher_id AND t.is_active
WHERE o.legacy->>'converted' = 'true'
ON CONFLICT (offer_id, teacher_id) DO NOTHING;
--> statement-breakpoint

-- 6. Items: one "whole subject" per (offer, series its lines sit in), and one in the series the
--    window's route or its board's default gives (where F0b entered a new registration). Only that
--    one takes new lines: an item that holds lines in another series (an admin's move, a route set
--    later) is closed for new lines — its lines stand — so a new reservation goes where F0b sent it.
--    No series at all → closed, no_series.
INSERT INTO session_offer_item (id, offer_id, session_id, label, kind, enters_kind, qualification_id, board_series_id, availability, sort_order, legacy, created_at, updated_at)
SELECT md5('rework-item:' || o.id || ':' || coalesce(p.board_series_id, 'none'))::uuid::text, o.id, o.session_id,
  'Whole subject', 'whole',
  CASE WHEN EXISTS (SELECT 1 FROM subject_unit su WHERE su.subject_id = o.subject_id) THEN 'units'
       WHEN s.qualification_id IS NOT NULL THEN 'award'
       ELSE 'subject' END,
  s.qualification_id,
  p.board_series_id,
  CASE WHEN p.board_series_id IS NULL THEN 'closed'
       WHEN p.board_series_id IS DISTINCT FROM rt.board_series_id THEN 'closed'
       ELSE o.availability END,
  0,
  CASE WHEN p.board_series_id IS NULL THEN '{"converted": true, "no_series": true}'::jsonb
       WHEN p.board_series_id IS DISTINCT FROM rt.board_series_id THEN '{"converted": true, "not_routed": true}'::jsonb
       ELSE '{"converted": true}'::jsonb END,
  now(), now()
FROM session_offer o
JOIN subject s ON s.id = o.subject_id
JOIN (
  SELECT DISTINCT r.session_id, r.subject_id, r.board_series_id FROM registration r
  UNION
  SELECT o2.session_id, o2.subject_id, coalesce(ss.board_series_id, l.board_series_id)
  FROM session_offer o2
  JOIN subject s2 ON s2.id = o2.subject_id
  LEFT JOIN session_subject_series ss ON ss.session_id = o2.session_id AND ss.subject_id = o2.subject_id
  LEFT JOIN session_board_series l ON l.session_id = o2.session_id AND l.board_code = s2.council AND l.is_default
  WHERE coalesce(ss.board_series_id, l.board_series_id) IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM registration r2 WHERE r2.session_id = o2.session_id AND r2.subject_id = o2.subject_id)
) p ON p.session_id = o.session_id AND p.subject_id = o.subject_id
-- Where F0b would enter a new registration of the subject in this window: its route, else the
-- default series of its board.
LEFT JOIN LATERAL (
  SELECT coalesce(
    (SELECT ss.board_series_id FROM session_subject_series ss WHERE ss.session_id = o.session_id AND ss.subject_id = o.subject_id),
    (SELECT l.board_series_id FROM session_board_series l WHERE l.session_id = o.session_id AND l.board_code = s.council AND l.is_default LIMIT 1)
  ) AS board_series_id
) rt ON true
WHERE o.legacy->>'converted' = 'true'
  -- Re-runnable: an offer that has its items (converted, or changed since) gets none again.
  AND NOT EXISTS (SELECT 1 FROM session_offer_item x WHERE x.offer_id = o.id)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO session_offer_item_unit (item_id, unit_id)
SELECT i.id, su.unit_id
FROM session_offer_item i
JOIN session_offer o ON o.id = i.offer_id
JOIN subject_unit su ON su.subject_id = o.subject_id
WHERE i.enters_kind = 'units' AND i.legacy->>'converted' = 'true'
  AND NOT EXISTS (SELECT 1 FROM session_offer_item_unit x WHERE x.item_id = i.id)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- A converted item's fee is the subject row's (its registration fee was the price).
INSERT INTO session_offer_item_fee_key (id, item_id, key_kind, subject_id)
SELECT md5('rework-fee-key:' || i.id)::uuid::text, i.id, 'subject', o.subject_id
FROM session_offer_item i
JOIN session_offer o ON o.id = i.offer_id
WHERE i.legacy->>'converted' = 'true'
  AND NOT EXISTS (SELECT 1 FROM session_offer_item_fee_key k WHERE k.item_id = i.id)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO board_fee (id, board_series_id, key_kind, subject_id, amount, provisional, confirmed_at, zero_reason, created_at, updated_at)
SELECT DISTINCT ON (i.board_series_id, o.subject_id)
  md5('rework-fee:' || i.board_series_id || ':' || o.subject_id)::uuid::text, i.board_series_id, 'subject', o.subject_id,
  s.registration_fee, false, now(),
  CASE WHEN s.registration_fee = 0 THEN 'Converted: the subject''s registration fee was 0 (migration 0042)' END,
  now(), now()
FROM session_offer_item i
JOIN session_offer o ON o.id = i.offer_id
JOIN subject s ON s.id = o.subject_id
WHERE i.board_series_id IS NOT NULL AND i.legacy->>'converted' = 'true'
  AND EXISTS (SELECT 1 FROM session_offer_item_fee_key k WHERE k.item_id = i.id AND k.key_kind = 'subject')
ORDER BY i.board_series_id, o.subject_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 7. Lines → their item; attempt, mode, prior sitting, due date, legacy flags (audited).
DROP TABLE IF EXISTS rework_line_map;
--> statement-breakpoint
CREATE TEMP TABLE rework_line_map AS
SELECT r.id, i.id AS item_id, w.end_date,
  CASE WHEN r.is_retake THEN (
    SELECT p.board_series_id FROM registration p
    WHERE p.student_id = r.student_id AND p.subject_id = r.subject_id AND p.id <> r.id AND p.session_id <> r.session_id
      AND p.status = 'confirmed' AND p.board_series_id IS NOT NULL AND p.created_at < r.created_at
    ORDER BY p.created_at DESC, p.id DESC LIMIT 1) END AS prior_series
FROM registration r
JOIN registration_session w ON w.id = r.session_id
JOIN session_offer o ON o.session_id = r.session_id AND o.subject_id = r.subject_id
JOIN session_offer_item i ON i.offer_id = o.id AND i.board_series_id IS NOT DISTINCT FROM r.board_series_id AND i.legacy->>'converted' = 'true'
WHERE r.offer_item_id IS NULL;
--> statement-breakpoint
UPDATE registration r SET
  offer_item_id = m.item_id,
  attempt = CASE WHEN r.is_retake THEN 'retake' ELSE 'first' END,
  mode = CASE WHEN r.taken_outside_school THEN 'self_study' ELSE 'in_school' END,
  prior_sitting_series_id = m.prior_series,
  prior_sitting_source = CASE WHEN NOT r.is_retake THEN NULL WHEN m.prior_series IS NOT NULL THEN 'known' ELSE 'legacy' END,
  due_at = m.end_date,
  legacy = jsonb_build_object('converted', true)
    || CASE WHEN r.board_series_id IS NULL THEN '{"no_series": true}'::jsonb ELSE '{}'::jsonb END
    || CASE WHEN r.is_retake AND m.prior_series IS NULL THEN '{"retake_history_unknown": true}'::jsonb ELSE '{}'::jsonb END
FROM rework_line_map m
WHERE r.id = m.id AND r.offer_item_id IS NULL;
--> statement-breakpoint
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
SELECT gen_random_uuid()::text, NULL, 'REWORK_BACKFILL_LINE', 'registration', r.id, NULL,
  jsonb_build_object('offerItemId', r.offer_item_id, 'attempt', r.attempt, 'mode', r.mode,
    'priorSittingSeriesId', r.prior_sitting_series_id, 'priorSittingSource', r.prior_sitting_source,
    'dueAt', r.due_at, 'legacy', r.legacy, 'reason', 'Reservations rework: the line enters its subject''s item (migration 0042)'),
  now()
FROM registration r JOIN rework_line_map m ON m.id = r.id;
--> statement-breakpoint
DROP TABLE rework_line_map;
--> statement-breakpoint

-- A window with a line and no item for it stops the migration, naming the window.
DO $$
DECLARE w record;
BEGIN
  SELECT rs.id, rs.name INTO w FROM registration r JOIN registration_session rs ON rs.id = r.session_id
  WHERE r.offer_item_id IS NULL LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Reservations rework backfill: the session "%" (%) has a line with no item for it — nothing was converted', w.name, w.id;
  END IF;
END $$;
--> statement-breakpoint

-- 8. A pending swap names its new subject's whole item (the one in the line's series first).
UPDATE change_request cr SET new_offer_item_id = (
  SELECT i.id FROM registration r
  JOIN session_offer o ON o.session_id = r.session_id AND o.subject_id = cr.new_subject_id
  JOIN session_offer_item i ON i.offer_id = o.id AND i.kind = 'whole'
  WHERE r.id = cr.registration_id
  ORDER BY (i.board_series_id IS NOT DISTINCT FROM r.board_series_id) DESC, (i.board_series_id IS NULL), i.id
  LIMIT 1)
WHERE cr.type = 'swap' AND cr.status = 'pending_approval' AND cr.new_offer_item_id IS NULL AND cr.new_subject_id IS NOT NULL;
--> statement-breakpoint

-- 9. Offers and fees audited once each.
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
SELECT gen_random_uuid()::text, NULL, 'REWORK_BACKFILL_OFFER', 'session_offer', o.id, NULL,
  jsonb_build_object('sessionId', o.session_id, 'subjectId', o.subject_id, 'availability', o.availability, 'courseFee', o.course_fee,
    'grade10Core', o.grade10_core,
    'teachers', coalesce((SELECT jsonb_agg(t.teacher_id ORDER BY t.sort_order) FROM session_offer_teacher t WHERE t.offer_id = o.id), '[]'::jsonb),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'boardSeriesId', i.board_series_id, 'availability', i.availability, 'entersKind', i.enters_kind) ORDER BY i.id)
      FROM session_offer_item i WHERE i.offer_id = o.id), '[]'::jsonb),
    'reason', 'Reservations rework: the window''s subject becomes an offer with its whole-subject items (migration 0042)'),
  now()
FROM session_offer o
WHERE o.legacy->>'converted' = 'true'
  AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.action = 'REWORK_BACKFILL_OFFER' AND a.entity_id = o.id);
--> statement-breakpoint
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
SELECT gen_random_uuid()::text, NULL, 'REWORK_BACKFILL_FEE', 'board_fee', f.id, NULL,
  jsonb_build_object('boardSeriesId', f.board_series_id, 'keyKind', f.key_kind, 'subjectId', f.subject_id, 'amount', f.amount, 'provisional', f.provisional,
    'reason', 'Reservations rework: the subject''s registration fee becomes its board fee in this series, confirmed (migration 0042)'),
  now()
FROM board_fee f
WHERE f.id = md5('rework-fee:' || f.board_series_id || ':' || coalesce(f.subject_id, ''))::uuid::text
  AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.action = 'REWORK_BACKFILL_FEE' AND a.entity_id = f.id);
--> statement-breakpoint

-- 10. Routes are replaced by the items' series (emptied, the table kept one release); a series
--     link nothing references any more is detached (links are derived from items and lines).
DELETE FROM session_subject_series;
--> statement-breakpoint
DELETE FROM session_board_series l
WHERE NOT EXISTS (SELECT 1 FROM session_offer_item i WHERE i.session_id = l.session_id AND i.board_series_id = l.board_series_id)
  AND NOT EXISTS (SELECT 1 FROM registration r WHERE r.session_id = l.session_id AND r.board_series_id = l.board_series_id);
--> statement-breakpoint

-- 11. The routing trigger reads the line's item (§3.3): a line is entered in its item's series,
--     of its subject's board, and its item is of its session's offer for its subject.
CREATE OR REPLACE FUNCTION catalogue_route_registration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE it record; council text; s_board text;
BEGIN
  IF NEW.offer_item_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_offer_item_required',
      MESSAGE = 'A line enters an item of its session''s offer';
  END IF;
  SELECT i.session_id, i.board_series_id, o.subject_id INTO it
  FROM session_offer_item i JOIN session_offer o ON o.id = i.offer_id
  WHERE i.id = NEW.offer_item_id;
  IF it.session_id IS DISTINCT FROM NEW.session_id OR it.subject_id IS DISTINCT FROM NEW.subject_id THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_item_of_session_subject',
      MESSAGE = 'A line''s item is an item of its session''s offer for its subject';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.board_series_id IS NULL THEN
    NEW.board_series_id := it.board_series_id;
  END IF;
  IF NEW.board_series_id IS DISTINCT FROM it.board_series_id THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_board_series_item',
      MESSAGE = 'A line is entered in its item''s series';
  END IF;
  IF NEW.board_series_id IS NOT NULL THEN
    SELECT s.council INTO council FROM subject s WHERE s.id = NEW.subject_id;
    SELECT board_code INTO s_board FROM board_series WHERE id = NEW.board_series_id;
    IF s_board IS DISTINCT FROM council THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_board_series_board',
        MESSAGE = 'A registration is entered in a series of its subject''s board';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS registration_move_board_series ON registration;
--> statement-breakpoint
CREATE TRIGGER registration_move_board_series BEFORE UPDATE OF board_series_id, offer_item_id ON registration
FOR EACH ROW WHEN (NEW.board_series_id IS DISTINCT FROM OLD.board_series_id OR NEW.offer_item_id IS DISTINCT FROM OLD.offer_item_id)
EXECUTE FUNCTION catalogue_route_registration();
--> statement-breakpoint

-- 12. An item is entered in a series of its subject's board, and IGCSE sits neither October nor
--     January (F0b's rule, per item since the rework).
CREATE OR REPLACE FUNCTION rework_offer_item_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sub record; s record; q_level text;
BEGIN
  IF NEW.board_series_id IS NULL THEN RETURN NEW; END IF;
  SELECT su.council, su.qualification_level INTO sub FROM session_offer o JOIN subject su ON su.id = o.subject_id WHERE o.id = NEW.offer_id;
  SELECT board_code, month INTO s FROM board_series WHERE id = NEW.board_series_id;
  IF s.board_code IS DISTINCT FROM sub.council THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'offer_item_series_board',
      MESSAGE = 'An item is entered in a series of its subject''s board';
  END IF;
  IF NEW.qualification_id IS NOT NULL THEN
    SELECT level INTO q_level FROM qualification WHERE id = NEW.qualification_id;
  END IF;
  IF s.month IN ('october', 'january') AND (sub.qualification_level = 'igcse' OR q_level = 'igcse') THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'offer_item_igcse_month',
      MESSAGE = 'IGCSE sits neither October nor January: an IGCSE item is entered in a June or November series';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS session_offer_item_series_check ON session_offer_item;
--> statement-breakpoint
CREATE TRIGGER session_offer_item_series_check BEFORE INSERT OR UPDATE OF board_series_id, qualification_id, offer_id ON session_offer_item
FOR EACH ROW EXECUTE FUNCTION rework_offer_item_check();
