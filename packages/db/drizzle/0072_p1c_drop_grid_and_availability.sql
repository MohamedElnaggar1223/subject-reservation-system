-- P1c (COORDINATOR_REWORK.md §9.1, §11): the old model's pricing and availability leave the database — the series'
-- fee grid (board_fee), the items' fee keys (session_offer_item_fee_key) and the availability enum of offers and
-- items (the cells and the subject's switch replace it since 0065/0066). Every line keeps its stored price, course
-- fee and board fee: nothing here re-prices a line (step 2 adds one key to the bases of version-1 lines).
--
--   1. Refused, naming them: a line waiting (for its parent's approval or for payment) priced provisional from the
--      grid, on a row with no exam fee, in a session whose prices are final. Nothing could make it payable once the
--      grid is gone (prices final is one-way; the row's fee set at the line's own amount re-prices nothing). Set the
--      row's exam fee through the subject editor first (it re-prices the line), then migrate.
--   2. The grid's last word kept on every version-1 line no longer provisional, whatever its status (a paid line
--      may be reversed and re-dated later): its basis gains `feeConfirmedAt` — when its fee stopped being provisional,
--      as the due-date rule read it from the grid until now (the last confirmation of the rows it read; or the
--      prices-final switch's time for a line the old Confirm did not clear, P1b fix 1) — so a later re-date gives the
--      same due date (deadline.services dueDateFor). A provisional line gets none: it becomes payable only through
--      the prices-final switch from now on, and the rule then reads that switch's time.
--   3. A row priced from the grid with no exam fee of its own takes the sum of the grid rows its fee keys read in its
--      series as its exam fee (source 'typed': finance typed it on the grid), audited per row — §11's conversion, as
--      0066 did for confirmed rows — where every grid row it reads is confirmed, or where its session's prices are not
--      final yet (a provisional amount is then a price not final, as the session says; switching prices final makes a
--      line reserved at it payable at its own price, which is the row's). A row reading a provisional grid row in a
--      session whose prices are already final stays "not set" (her check list names it; prices final would otherwise
--      have made a provisional amount payable). So does a row whose keys miss a grid row.
--   4. The grid, the keys and the availability columns dropped.
--
-- No BEGIN or COMMIT: the migrator runs pending migrations in one transaction.
DO $$
DECLARE stuck text;
BEGIN
  SELECT string_agg(format('%s (%s, %s — %s)', r.id, s.name, sub.name, i.label), '; ' ORDER BY s.name, sub.name, r.id) INTO stuck
  FROM registration r
  JOIN session_offer_item i ON i.id = r.offer_item_id
  JOIN registration_session s ON s.id = r.session_id
  JOIN subject sub ON sub.id = r.subject_id
  WHERE r.status IN ('pending_approval', 'pending_payment', 'preregistered') AND r.price_provisional AND s.prices_final
    AND i.exam_fee IS NULL AND EXISTS (SELECT 1 FROM session_offer_item_fee_key k WHERE k.item_id = i.id);
  IF stuck IS NOT NULL THEN
    RAISE EXCEPTION 'P1c (0072): waiting lines priced provisional from the fee grid in sessions whose prices are final cannot be made payable once the grid is gone — set each row''s exam fee in the subject editor first (it re-prices them): %', stuck;
  END IF;
END $$;
--> statement-breakpoint
WITH v1 AS (
  SELECT r.id, r.pricing_basis AS basis, r.price_provisional AS provisional, i.exam_fee AS row_fee, s.prices_final_at,
         coalesce(r.pricing_basis->'feeRows', '[]'::jsonb) AS fee_rows
  FROM registration r
  JOIN session_offer_item i ON i.id = r.offer_item_id
  JOIN registration_session s ON s.id = r.session_id
  WHERE NOT r.price_provisional AND coalesce((r.pricing_basis->>'v')::int, 0) = 1
),
facts AS (
  SELECT v1.id,
    (SELECT max(f.confirmed_at) FROM jsonb_array_elements(v1.fee_rows) fr JOIN board_fee f ON f.id = fr->>'id') AS last_confirmed,
    EXISTS (SELECT 1 FROM jsonb_array_elements(v1.fee_rows) fr WHERE (fr->>'provisional')::boolean) AS priced_provisional,
    jsonb_array_length(v1.fee_rows) > 0 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v1.fee_rows) fr LEFT JOIN board_fee f ON f.id = fr->>'id'
      WHERE f.id IS NULL OR f.provisional OR f.amount <> (fr->>'amount')::numeric) AS confirmed_as_recorded,
    v1.row_fee, v1.prices_final_at
  FROM v1
)
UPDATE registration r SET pricing_basis = r.pricing_basis || jsonb_build_object('feeConfirmedAt',
  to_jsonb(CASE WHEN f.priced_provisional AND f.row_fee IS NOT NULL AND f.prices_final_at IS NOT NULL AND NOT f.confirmed_as_recorded
                THEN f.prices_final_at ELSE f.last_confirmed END))
FROM facts f
WHERE f.id = r.id AND NOT (r.pricing_basis ? 'feeConfirmedAt');
--> statement-breakpoint
WITH k AS (
  SELECT i.id AS item_id, count(fk.id) AS keys, count(f.id) AS rows, sum(f.amount) AS total, coalesce(bool_or(f.provisional), false) AS provisional,
         bool_or(s.prices_final) AS prices_final
  FROM session_offer_item i
  JOIN registration_session s ON s.id = i.session_id
  JOIN session_offer_item_fee_key fk ON fk.item_id = i.id
  LEFT JOIN board_fee f ON f.board_series_id = i.board_series_id AND f.key_kind = fk.key_kind AND f.key_id = fk.key_id
  WHERE i.exam_fee IS NULL AND i.board_series_id IS NOT NULL
  GROUP BY i.id
),
set_fee AS (
  UPDATE session_offer_item i SET exam_fee = k.total, exam_fee_source = 'typed', updated_at = now()
  FROM k WHERE k.item_id = i.id AND k.keys > 0 AND k.keys = k.rows AND NOT (k.provisional AND k.prices_final)
  RETURNING i.id, i.exam_fee, k.provisional
)
INSERT INTO "audit_log" ("id", "user_id", "action", "entity_type", "entity_id", "previous_data", "new_data")
SELECT gen_random_uuid()::text, NULL, 'OFFER_ITEM_UPDATED', 'offer_item', s.id,
       jsonb_build_object('examFee', NULL),
       jsonb_build_object('examFee', s.exam_fee, 'examFeeSource', 'typed', 'gridProvisional', s.provisional,
                          'reason', 'P1c: the fee grid leaves the database — the exam fee read from the grid rows its fee keys read in its series (migration 0072)')
FROM set_fee s;
--> statement-breakpoint
ALTER TABLE "board_fee" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_offer_item_fee_key" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "board_fee" CASCADE;--> statement-breakpoint
DROP TABLE "session_offer_item_fee_key" CASCADE;--> statement-breakpoint
ALTER TABLE "session_offer" DROP CONSTRAINT "session_offer_availability_valid";--> statement-breakpoint
ALTER TABLE "session_offer_item" DROP CONSTRAINT "session_offer_item_availability_valid";--> statement-breakpoint
ALTER TABLE "session_offer" DROP COLUMN "availability";--> statement-breakpoint
ALTER TABLE "session_offer_item" DROP COLUMN "availability";