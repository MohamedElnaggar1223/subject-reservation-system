-- The coordinator rework, P1a (COORDINATOR_REWORK.md §9.1, §11): existing offers and items converted
-- to the model of a session set up the way the coordinator works, so older dev data and the parked
-- features' fixtures keep working while the old columns stay in step until P1b drops them.
--
--   1. Item kinds in her words: whole → all_papers, one_paper → paper, route → as / a2 / al (an A.2. is the
--      route that carries a sitting forward; an A.S. the AS award's or a label that says A.S.; else A.L.).
--   2. The four cells (D3) from today's availability, the offer's and the item's together: closed → none;
--      retakes only → retake in school and in self study; self-study only → retake in self study (and a
--      first entry in self study where the item carries a sitting forward, the A.2.); open → first entry
--      in school, retake in school and in self study. A one-paper row never takes a first entry (F6a).
--   3. The subject's Accepting switch from its availability.
--   4. The exam fee (E1) from the fee grid: the sum of the rows an item's fee keys read in its series, when
--      every key has a row and every row read is confirmed (source 'typed': finance typed it on the grid).
--      An item missing a row, or reading a provisional one, stays "not set" and keeps the deprecated grid's
--      pricing (its provisional mark and finance's Confirm) until P1b.
--   5. Prices final (E6) on a session that has at least one open item with an exam fee, whose open items
--      all have an exam fee read from confirmed rows and whose waiting lines are none of them provisional;
--      else not final (an empty session is not final: its coordinator switches it).
--   6. The reference codes of an item from what it enters (its units' codes, or its award's code).
--   7. The board rule "a one-paper retake asks its sitting" as the code decided it until now (Cambridge
--      only; offer.services.ts withOnePaper); the reference loader writes each board's own from then on.
--   8. The kind check, once every row has a new kind.
--
-- Each item whose exam fee was set and each session made prices-final writes its audit row in the same
-- statement. Idempotent: a converted kind is not converted again, a set fee is not set again, a session
-- already final is left alone, the check is added once. No BEGIN or COMMIT: the migrator runs pending
-- migrations in one transaction.

-- 1. Kinds.
UPDATE session_offer_item SET kind = 'all_papers' WHERE kind = 'whole';
--> statement-breakpoint
UPDATE session_offer_item SET kind = 'paper' WHERE kind = 'one_paper';
--> statement-breakpoint
UPDATE session_offer_item i SET kind = CASE
    WHEN i.needs_prior_series THEN 'a2'
    WHEN i.label ~* '\ma\.?\s?2' THEN 'a2'
    WHEN coalesce((SELECT q.level FROM qualification q WHERE q.id = i.qualification_id), '') = 'as_level' THEN 'as'
    WHEN i.label ~* '\ma\.?\s?s\M' THEN 'as'
    ELSE 'al'
  END
WHERE i.kind = 'route';
--> statement-breakpoint

-- 2. The four cells, from the offer's and the item's availability together.
UPDATE session_offer_item i SET
  first_in_school = NOT c.closed AND NOT c.retake_only AND NOT c.self_study_only AND i.kind <> 'paper',
  retake_in_school = NOT c.closed AND NOT c.self_study_only,
  retake_self_study = NOT c.closed,
  first_self_study = NOT c.closed AND NOT c.retake_only AND c.self_study_only AND i.needs_prior_series AND i.kind <> 'paper'
FROM (
  SELECT x.id,
    (o.availability = 'closed' OR x.availability = 'closed') AS closed,
    (o.availability = 'retake_only' OR x.availability = 'retake_only') AS retake_only,
    (o.availability = 'self_study_only' OR x.availability = 'self_study_only') AS self_study_only
  FROM session_offer_item x JOIN session_offer o ON o.id = x.offer_id
) c
WHERE c.id = i.id
  AND NOT (i.first_in_school OR i.retake_in_school OR i.retake_self_study OR i.first_self_study);
--> statement-breakpoint

-- 3. The subject's Accepting switch.
UPDATE session_offer SET accepting = (availability <> 'closed');
--> statement-breakpoint

-- 4. The exam fee from the fee grid (every key read has a confirmed row in the item's series), audited per item.
WITH k AS (
  SELECT i.id AS item_id, count(fk.id) AS keys, count(f.id) AS rows, sum(f.amount) AS total,
         coalesce(bool_and(NOT f.provisional), false) AS confirmed
  FROM session_offer_item i
  JOIN session_offer_item_fee_key fk ON fk.item_id = i.id
  LEFT JOIN board_fee f ON f.board_series_id = i.board_series_id AND f.key_kind = fk.key_kind AND f.key_id = fk.key_id
  WHERE i.exam_fee IS NULL AND i.board_series_id IS NOT NULL
  GROUP BY i.id
),
set_fee AS (
  UPDATE session_offer_item i SET exam_fee = k.total, exam_fee_source = 'typed'
  FROM k WHERE k.item_id = i.id AND k.keys > 0 AND k.keys = k.rows AND k.confirmed
  RETURNING i.id, i.exam_fee
)
INSERT INTO "audit_log" ("id", "user_id", "action", "entity_type", "entity_id", "previous_data", "new_data")
SELECT gen_random_uuid()::text, NULL, 'OFFER_ITEM_UPDATED', 'offer_item', s.id,
       jsonb_build_object('examFee', NULL),
       jsonb_build_object('examFee', s.exam_fee, 'examFeeSource', 'typed',
                          'reason', 'The coordinator rework: the exam fee read from the fee grid rows its fee keys read in its series (migration 0066)')
FROM set_fee s;
--> statement-breakpoint

-- 5. Prices final where nothing read is provisional or missing, audited per session.
WITH final AS (
  UPDATE registration_session s SET prices_final = true, prices_final_at = now()
  WHERE NOT s.prices_final
    AND EXISTS (
      SELECT 1 FROM session_offer_item i JOIN session_offer o ON o.id = i.offer_id
      WHERE i.session_id = s.id AND i.availability <> 'closed' AND o.availability <> 'closed' AND i.exam_fee IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM session_offer_item i
      JOIN session_offer o ON o.id = i.offer_id
      LEFT JOIN session_offer_item_fee_key fk ON fk.item_id = i.id
      LEFT JOIN board_fee f ON f.board_series_id = i.board_series_id AND f.key_kind = fk.key_kind AND f.key_id = fk.key_id
      WHERE i.session_id = s.id AND i.availability <> 'closed' AND o.availability <> 'closed'
        AND (i.exam_fee IS NULL OR coalesce(f.provisional, false)))
    AND NOT EXISTS (
      SELECT 1 FROM registration r
      WHERE r.session_id = s.id AND r.price_provisional AND r.status IN ('pending_approval', 'pending_payment', 'preregistered'))
  RETURNING s.id
)
INSERT INTO "audit_log" ("id", "user_id", "action", "entity_type", "entity_id", "previous_data", "new_data")
SELECT gen_random_uuid()::text, NULL, 'SESSION_UPDATED', 'session', f.id,
       jsonb_build_object('pricesFinal', false),
       jsonb_build_object('pricesFinal', true,
                          'reason', 'The coordinator rework: every open item has an exam fee read from confirmed fee rows and no waiting line is provisional (migration 0066)')
FROM final f;
--> statement-breakpoint

-- 6. The reference codes of an item from what it enters.
UPDATE session_offer_item i SET reference_codes = u.codes
FROM (
  SELECT iu.item_id, array_agg(eu.code ORDER BY eu.code) AS codes
  FROM session_offer_item_unit iu JOIN exam_unit eu ON eu.id = iu.unit_id
  GROUP BY iu.item_id
) u
WHERE u.item_id = i.id AND i.enters_kind = 'units' AND cardinality(i.reference_codes) = 0;
--> statement-breakpoint
UPDATE session_offer_item i SET reference_codes = ARRAY[q.code]
FROM qualification q
WHERE q.id = i.qualification_id AND i.enters_kind IN ('award', 'option') AND cardinality(i.reference_codes) = 0;
--> statement-breakpoint

-- 7. The board rule, as the code decided it until now.
UPDATE exam_board SET one_paper_asks_sitting = (code = 'cambridge');
--> statement-breakpoint

-- 8. The kind check, once every row has a new kind (added once: a re-run finds it).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_offer_item_kind_valid' AND conrelid = 'session_offer_item'::regclass) THEN
    ALTER TABLE "session_offer_item" ADD CONSTRAINT "session_offer_item_kind_valid" CHECK ("session_offer_item"."kind" IN ('all_papers', 'paper', 'unit', 'as', 'a2', 'al', 'qualification', 'custom'));
  END IF;
END $$;
