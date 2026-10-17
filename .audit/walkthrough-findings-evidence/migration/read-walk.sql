\pset footer off
SELECT count(*) AS migrations FROM drizzle.__drizzle_migrations;
SELECT s.name AS subject, s.council AS board, i.label, k.key_kind, coalesce(q.code, u.code) AS key_code
  FROM session_offer_item i JOIN session_offer o ON o.id = i.offer_id JOIN subject s ON s.id = o.subject_id
  JOIN session_offer_item_fee_key k ON k.item_id = i.id LEFT JOIN qualification q ON q.id = k.qualification_id LEFT JOIN exam_unit u ON u.id = k.unit_id
 WHERE i.kind = 'one_paper' ORDER BY s.council, s.name, i.label;
SELECT action, entity_type, count(*) AS rows FROM audit_log WHERE (action = 'BOARD_UPDATED' AND new_data ? 'onePaperFeeKey') OR (action = 'OFFER_ITEM_UPDATED' AND new_data->>'reason' LIKE '%migration 0063%') GROUP BY 1, 2 ORDER BY 1;
SELECT count(*) AS lines, sum(price_at_registration) AS total_price, md5(string_agg(id || ':' || status || ':' || price_at_registration || ':' || coalesce(pricing_basis::text, ''), ',' ORDER BY id)) AS lines_digest FROM registration;
SELECT count(*) AS payments, sum(amount) AS paid, md5(string_agg(id || ':' || status || ':' || amount, ',' ORDER BY id)) AS payments_digest FROM payment;
