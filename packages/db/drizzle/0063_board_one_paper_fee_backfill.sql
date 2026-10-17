-- F8-05 (docs/features/WALKTHROUGH_FINDINGS.md §1): a one-paper retake's board fee follows its board. 0062 added
-- exam_board.one_paper_fee_key with every board on 'qualification' (the syllabus's fee: Cambridge's rule, Q-13).
-- Pearson Edexcel's list prices per paper or unit ("4MA1 1H 4,600", SCHOOL_FORMS.md §3.2), so its one-paper items
-- read the paper's own fee: this migration sets the board to 'unit' and re-keys the one-paper items already made
-- for it, on every database, new or existing. OxfordAQA stays on 'qualification': no list of its fees is in hand
-- (F8-07). Lines are untouched: a reserved line keeps the price it was given (its pricing basis names the fee row
-- it was priced from). Idempotent: only a board still on 'qualification', and only an item that enters one unit
-- and still reads one qualification key, change; each change writes its audit row in the same statement. No
-- BEGIN or COMMIT: the migrator runs pending migrations in one transaction, so the second statement sees the first.
WITH changed AS (
  UPDATE exam_board SET one_paper_fee_key = 'unit', updated_at = now()
  WHERE code = 'pearson_edexcel' AND one_paper_fee_key = 'qualification'
  RETURNING code
)
INSERT INTO "audit_log" ("id", "user_id", "action", "entity_type", "entity_id", "previous_data", "new_data")
SELECT gen_random_uuid()::text, NULL, 'BOARD_UPDATED', 'board', code,
       jsonb_build_object('onePaperFeeKey', 'qualification'),
       jsonb_build_object('onePaperFeeKey', 'unit', 'reason', 'Pearson Edexcel prices a one-paper retake per paper (F8-05; migration 0063)')
FROM changed;
--> statement-breakpoint
WITH target AS (
  SELECT i.id AS item_id, k.id AS fee_key_row, k.qualification_id, u.unit_id
  FROM session_offer_item i
  JOIN session_offer o ON o.id = i.offer_id
  JOIN subject s ON s.id = o.subject_id
  JOIN exam_board b ON b.code = s.council
  JOIN session_offer_item_fee_key k ON k.item_id = i.id AND k.key_kind = 'qualification'
  JOIN session_offer_item_unit u ON u.item_id = i.id
  WHERE i.kind = 'one_paper' AND b.one_paper_fee_key = 'unit'
    AND (SELECT count(*) FROM session_offer_item_unit x WHERE x.item_id = i.id) = 1
    AND (SELECT count(*) FROM session_offer_item_fee_key y WHERE y.item_id = i.id) = 1
),
removed AS (
  DELETE FROM session_offer_item_fee_key k USING target t WHERE k.id = t.fee_key_row RETURNING k.id
),
added AS (
  INSERT INTO session_offer_item_fee_key ("id", "item_id", "key_kind", "unit_id")
  SELECT gen_random_uuid()::text, item_id, 'unit', unit_id FROM target
  RETURNING item_id
)
INSERT INTO "audit_log" ("id", "user_id", "action", "entity_type", "entity_id", "previous_data", "new_data")
SELECT gen_random_uuid()::text, NULL, 'OFFER_ITEM_UPDATED', 'offer_item', t.item_id,
       jsonb_build_object('feeKeys', jsonb_build_array(jsonb_build_object('kind', 'qualification', 'id', t.qualification_id))),
       jsonb_build_object('feeKeys', jsonb_build_array(jsonb_build_object('kind', 'unit', 'id', t.unit_id)),
                          'reason', 'A one-paper retake of a board that prices per paper reads the paper''s own fee; its lines keep their prices (F8-05; migration 0063)')
FROM target t;
