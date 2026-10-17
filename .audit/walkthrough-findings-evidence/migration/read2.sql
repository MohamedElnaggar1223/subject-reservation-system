\pset footer off
SELECT count(*) AS migrations FROM drizzle.__drizzle_migrations;
SELECT code, one_paper_fee_key FROM exam_board ORDER BY code;
SELECT i.id AS item, i.label, k.key_kind, k.key_id FROM session_offer_item i JOIN session_offer_item_fee_key k ON k.item_id = i.id WHERE i.id LIKE 'mig_%' ORDER BY i.id, k.key_kind;
SELECT action, entity_type, entity_id, previous_data::text AS was, new_data::text AS now FROM audit_log
 WHERE (action = 'BOARD_UPDATED' AND entity_id = 'pearson_edexcel') OR (action = 'OFFER_ITEM_UPDATED' AND entity_id LIKE 'mig_%') ORDER BY created_at, entity_id;
SELECT count(*) AS lines, coalesce(sum(price_at_registration), 0) AS total_price, md5(coalesce(string_agg(id || ':' || price_at_registration || ':' || coalesce(pricing_basis::text, ''), ',' ORDER BY id), '')) AS lines_digest FROM registration;
