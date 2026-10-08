-- Reservations rework, step C — the policy registry, board services and charges
-- (RESERVATIONS_REWORK.md §3.6, §3.7, §7 step 2; docs/features/RESERVATIONS_MONEY.md §1).
-- Hand-written, between the additive structure (0047) and the constraints that need the
-- backfilled values (0049). Idempotent: every step converts only rows not yet converted. Nothing
-- is dropped: exception.type and exception.value, remark_fee_schedule and remark_deadline are kept
-- one release (§7 step 3).
--
--   exceptions → the registry: the eight V3 types mapped exactly as §3.7 says (discount_percent →
--                price.discountPercent, discount_fixed → price.discountFixed, custom_price →
--                price.custom, fee_waiver → gate.schoolFee, deadline_extension and
--                late_registration → deadline.window with value_date = their valid_until,
--                custom_refund_percent → refund.percent, grade10_other_series →
--                eligibility.grade10OtherSeries); value → value_number; the scope kept. Two meanings
--                change and are listed: a custom refund percent applies to the course fee (§3.9),
--                and a subject-scoped deadline or refund exception — which V3 never applied
--                (exception.services 177) — waits under "Check these" (check_reason) until a
--                finance admin confirms or revokes it. A trigger fills the same way any row a
--                V3-shaped writer still inserts, for this release.
--   board services → seeded per board (Cambridge enquiry services 1, 1S, 2, 2S and certificate
--                split; Pearson's review of marking, clerical re-check, access to scripts, priority
--                review, cash-in, late cash-in, certificate split; OxfordAQA's three), each remark
--                service mapped from V3's service types (clerical_check → Cambridge 1 / Pearson and
--                OxfordAQA clerical re-check; review_of_marking → 2 / review of marking; script_copy
--                → 1S for Cambridge / access to scripts; priority_review → Pearson's priority
--                review), refund rule `full` (Q-21: today's behaviour).
--   remark fees → for every series still open or ahead (no end of exams on record, or not past),
--                a provisional service fee at both levels from remark_fee_schedule (the old row had
--                no level); the schedule stays as the defaults a new series copies.
--   remark deadlines → each remark_deadline row (per board and window) onto each series of that
--                board the window's items or lines sit in.
-- Each converted exception is audited once (REWORK_BACKFILL_EXCEPTION), each service fee and
-- deadline made from the old tables once (REWORK_BACKFILL_SERVICE).

-- 1. The V3 types onto the registry: the mapping, shared by the backfill and the trigger.
CREATE OR REPLACE FUNCTION exception_policy_from_legacy(p_type text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'discount_percent' THEN 'price.discountPercent'
    WHEN 'discount_fixed' THEN 'price.discountFixed'
    WHEN 'custom_price' THEN 'price.custom'
    WHEN 'fee_waiver' THEN 'gate.schoolFee'
    WHEN 'deadline_extension' THEN 'deadline.window'
    WHEN 'late_registration' THEN 'deadline.window'
    WHEN 'custom_refund_percent' THEN 'refund.percent'
    WHEN 'grade10_other_series' THEN 'eligibility.grade10OtherSeries'
  END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION exception_legacy_fill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.policy_key IS NULL AND NEW.type IS NOT NULL THEN
    NEW.policy_key := exception_policy_from_legacy(NEW.type);
    IF NEW.type IN ('discount_percent', 'discount_fixed', 'custom_price', 'custom_refund_percent') AND NEW.value_number IS NULL THEN
      NEW.value_number := NEW.value;
    END IF;
    IF NEW.type IN ('deadline_extension', 'late_registration') AND NEW.value_date IS NULL THEN
      NEW.value_date := NEW.valid_until;
    END IF;
    IF NEW.subject_id IS NOT NULL AND NEW.type IN ('deadline_extension', 'late_registration', 'custom_refund_percent') AND NEW.check_reason IS NULL THEN
      NEW.check_reason := CASE WHEN NEW.type = 'custom_refund_percent'
        THEN 'A refund percent scoped to one subject, which the old system never applied: confirm it to apply it to that subject''s lines from now on (on the course fee), or revoke it'
        ELSE 'A deadline extension scoped to one subject, which the old system never applied: confirm it to let this student reserve and pay that subject after the close, or revoke it'
      END;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS exception_legacy_fill ON exception;
--> statement-breakpoint
CREATE TRIGGER exception_legacy_fill BEFORE INSERT OR UPDATE ON exception
  FOR EACH ROW EXECUTE FUNCTION exception_legacy_fill();
--> statement-breakpoint

-- The update fires the trigger, which fills each row; RETURNING sees the filled row.
WITH converted AS (
  UPDATE exception e SET updated_at = e.updated_at
  WHERE e.policy_key IS NULL AND e.type IS NOT NULL
  RETURNING e.id, e.type, e.value, e.valid_until, e.session_id, e.subject_id, e.policy_key, e.value_number, e.value_date, e.check_reason
)
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
SELECT gen_random_uuid()::text, NULL, 'REWORK_BACKFILL_EXCEPTION', 'exception', c.id,
  jsonb_build_object('type', c.type, 'value', c.value, 'validUntil', c.valid_until, 'sessionId', c.session_id, 'subjectId', c.subject_id),
  jsonb_build_object('policyKey', c.policy_key, 'valueNumber', c.value_number, 'valueDate', c.value_date, 'checkReason', c.check_reason),
  now()
FROM converted c;
--> statement-breakpoint

-- A V3 type with no key would leave policy_key empty; 0049's NOT NULL would then refuse. Say which.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT type, ', ') INTO bad FROM exception WHERE policy_key IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'rework money backfill: exception types with no policy key: %', bad;
  END IF;
END $$;
--> statement-breakpoint

-- 2. A charge's deadline (§3.10 items 1 and 4): an instalment follows its line's effective
--    deadline (with step B's declaration_rejected: a rejected declared retake is a first entry);
--    a board service's charge its series' service deadline; anything else none.
CREATE OR REPLACE FUNCTION charge_effective_deadline(p_kind text, p_registration text, p_series text, p_service text) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_kind = 'instalment' THEN (SELECT line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) FROM registration r WHERE r.id = p_registration)
    WHEN p_series IS NOT NULL AND p_service IS NOT NULL THEN (SELECT d.deadline FROM board_service_deadline d WHERE d.board_series_id = p_series AND d.board_service_id = p_service)
    ELSE NULL
  END
$$;
--> statement-breakpoint

-- 3. The boards' services (§3.6, Q-17, Q-18, Q-21). Ids are stable so a re-run adds nothing.
INSERT INTO board_service (id, board_code, code, label, kind, per_component, level_rates, refund_rule, requestable_by_family, legacy_service_type, sort_order)
SELECT v.id, v.board_code, v.code, v.label, v.kind, v.per_component, v.level_rates, 'full', v.requestable, v.legacy, v.sort_order
FROM (VALUES
  ('svc-cambridge-1',  'cambridge', '1',  'Service 1 — clerical re-check', 'remark', true, true, true, 'clerical_check', 1),
  ('svc-cambridge-1s', 'cambridge', '1S', 'Service 1S — clerical re-check with a copy of the script', 'remark', true, true, true, 'script_copy', 2),
  ('svc-cambridge-2',  'cambridge', '2',  'Service 2 — review of marking', 'remark', true, true, true, 'review_of_marking', 3),
  ('svc-cambridge-2s', 'cambridge', '2S', 'Service 2S — review of marking with a copy of the script', 'remark', true, true, true, NULL, 4),
  ('svc-cambridge-cs', 'cambridge', 'certificate_split', 'Certificate split', 'certificate_split', false, false, true, NULL, 9),
  ('svc-pearson-rom',  'pearson_edexcel', 'review_of_marking', 'Review of marking', 'remark', true, true, true, 'review_of_marking', 1),
  ('svc-pearson-crc',  'pearson_edexcel', 'clerical_recheck', 'Clerical re-check', 'remark', true, true, true, 'clerical_check', 2),
  ('svc-pearson-ats',  'pearson_edexcel', 'access_to_scripts', 'Access to scripts', 'remark', true, true, true, 'script_copy', 3),
  ('svc-pearson-prm',  'pearson_edexcel', 'priority_review', 'Priority review of marking', 'remark', true, true, true, 'priority_review', 4),
  ('svc-pearson-ci',   'pearson_edexcel', 'cash_in', 'Cash-in (claim the award)', 'cash_in', false, false, true, NULL, 6),
  ('svc-pearson-lci',  'pearson_edexcel', 'late_cash_in', 'Late cash-in', 'late_cash_in', false, false, true, NULL, 7),
  ('svc-pearson-cs',   'pearson_edexcel', 'certificate_split', 'Certificate split', 'certificate_split', false, false, true, NULL, 9),
  ('svc-oxford-crc',   'oxford', 'clerical_recheck', 'Clerical re-check', 'remark', true, true, true, 'clerical_check', 1),
  ('svc-oxford-rom',   'oxford', 'review_of_marking', 'Review of marking', 'remark', true, true, true, 'review_of_marking', 2),
  ('svc-oxford-ats',   'oxford', 'access_to_scripts', 'Access to scripts', 'remark', true, true, true, 'script_copy', 3)
) AS v(id, board_code, code, label, kind, per_component, level_rates, requestable, legacy, sort_order)
WHERE EXISTS (SELECT 1 FROM exam_board b WHERE b.code = v.board_code)
ON CONFLICT (board_code, code) DO NOTHING;
--> statement-breakpoint

-- 4. Remark fees: each V3 schedule row (per board and service type, no level) becomes a
--    provisional fee at both levels in every series of that board still open or ahead.
WITH made AS (
  INSERT INTO board_service_fee (id, board_series_id, board_service_id, level, amount, provisional, copied_from_default)
  SELECT gen_random_uuid()::text, bs.id, svc.id, lv.level, f.amount_per_paper, true, true
  FROM remark_fee_schedule f
  JOIN board_service svc ON svc.board_code = f.council AND svc.legacy_service_type = f.service_type
  JOIN board_series bs ON bs.board_code = f.council AND (bs.exams_end IS NULL OR bs.exams_end >= (now() AT TIME ZONE 'Africa/Cairo')::date)
  CROSS JOIN (VALUES ('igcse'), ('as_a_level')) AS lv(level)
  ON CONFLICT (board_series_id, board_service_id, level) DO NOTHING
  RETURNING id, board_series_id, board_service_id, level, amount
)
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
SELECT gen_random_uuid()::text, NULL, 'REWORK_BACKFILL_SERVICE', 'board_service', m.board_service_id, NULL,
  jsonb_build_object('fee', m.id, 'boardSeriesId', m.board_series_id, 'level', m.level, 'amount', m.amount, 'provisional', true, 'from', 'remark_fee_schedule'),
  now()
FROM made m;
--> statement-breakpoint

-- 5. Remark deadlines: per (board, window, service type) onto each series of that board the
--    window's items or lines sit in (two windows feeding one series: the earlier date holds).
WITH targets AS (
  SELECT DISTINCT bs.id AS board_series_id, svc.id AS board_service_id, d.deadline
  FROM remark_deadline d
  JOIN board_service svc ON svc.board_code = d.council AND svc.legacy_service_type = d.service_type
  JOIN session_board_series l ON l.session_id = d.session_id
  JOIN board_series bs ON bs.id = l.board_series_id AND bs.board_code = d.council
), earliest AS (
  SELECT board_series_id, board_service_id, min(deadline) AS deadline FROM targets GROUP BY board_series_id, board_service_id
), made AS (
  INSERT INTO board_service_deadline (id, board_series_id, board_service_id, deadline)
  SELECT gen_random_uuid()::text, e.board_series_id, e.board_service_id, e.deadline FROM earliest e
  ON CONFLICT (board_series_id, board_service_id) DO NOTHING
  RETURNING id, board_series_id, board_service_id, deadline
)
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
SELECT gen_random_uuid()::text, NULL, 'REWORK_BACKFILL_SERVICE', 'board_service', m.board_service_id, NULL,
  jsonb_build_object('deadline', m.id, 'boardSeriesId', m.board_series_id, 'at', m.deadline, 'from', 'remark_deadline'),
  now()
FROM made m;
