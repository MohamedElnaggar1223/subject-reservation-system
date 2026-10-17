-- The lead's answer 2 on the review of 744e553 (docs/features/WALKTHROUGH_FINDINGS.md §1, F8-05): on a board whose
-- one-paper retake is charged the syllabus's fee (exam_board.one_paper_fee_key = 'qualification': Cambridge, Q-13;
-- OxfordAQA), a one-paper item reads the same fee row as the subject's whole item, so the fee list names a syllabus
-- once: the option's row when the whole item enters an option ("0970 CX 10,850"), the qualification's otherwise. The
-- code makes new items so (offer.services.ts onePaperFeeKeys); this re-keys the one-paper items already made, on every
-- database, new or existing: an item that enters units, reads exactly one key, its offer's qualification, and whose
-- offer has exactly one whole item entering an option of that qualification, now reads that option. Lines are
-- untouched: a reserved line keeps the price it was given (its pricing basis names the fee row it was priced from).
-- Idempotent: a re-keyed item no longer reads a qualification key; each change writes its audit row in the same
-- statement. No BEGIN or COMMIT: the migrator runs pending migrations in one transaction.
WITH target AS (
  SELECT i.id AS item_id, k.id AS fee_key_row, k.qualification_id, w.qualification_option_id AS option_id
  FROM session_offer_item i
  JOIN session_offer o ON o.id = i.offer_id
  JOIN subject s ON s.id = o.subject_id
  JOIN exam_board b ON b.code = s.council
  JOIN session_offer_item_fee_key k ON k.item_id = i.id AND k.key_kind = 'qualification'
  JOIN session_offer_item w ON w.offer_id = i.offer_id AND w.kind = 'whole' AND w.enters_kind = 'option'
  JOIN qualification_option qo ON qo.id = w.qualification_option_id AND qo.qualification_id = k.qualification_id
  WHERE i.kind = 'one_paper' AND i.enters_kind = 'units' AND b.one_paper_fee_key = 'qualification'
    AND (SELECT count(*) FROM session_offer_item_fee_key y WHERE y.item_id = i.id) = 1
    AND (SELECT count(*) FROM session_offer_item x WHERE x.offer_id = i.offer_id AND x.kind = 'whole' AND x.enters_kind = 'option') = 1
),
removed AS (
  DELETE FROM session_offer_item_fee_key k USING target t WHERE k.id = t.fee_key_row RETURNING k.id
),
added AS (
  INSERT INTO session_offer_item_fee_key ("id", "item_id", "key_kind", "qualification_option_id")
  SELECT gen_random_uuid()::text, item_id, 'option', option_id FROM target
  RETURNING item_id
)
INSERT INTO "audit_log" ("id", "user_id", "action", "entity_type", "entity_id", "previous_data", "new_data")
SELECT gen_random_uuid()::text, NULL, 'OFFER_ITEM_UPDATED', 'offer_item', t.item_id,
       jsonb_build_object('feeKeys', jsonb_build_array(jsonb_build_object('kind', 'qualification', 'id', t.qualification_id))),
       jsonb_build_object('feeKeys', jsonb_build_array(jsonb_build_object('kind', 'option', 'id', t.option_id)),
                          'reason', 'A one-paper retake charged the syllabus''s fee reads the same row as its whole subject, the option''s; its lines keep their prices (F8-05, answer 2; migration 0064)')
FROM target t;
