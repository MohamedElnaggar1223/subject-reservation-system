-- The coordinator rework, P1b (COORDINATOR_REWORK.md §6, C10): reserving and paying are two checks, and an unpaid
-- line expires at its cut-off, not at the close.
--
--   1. line_cut_off: the earlier of the line's due date + its session's unpaid-cancel days and its effective board
--      deadline (line_effective_deadline, reference dates). Read by the cut-off sweep, mayPay, the checkout and the
--      statement; NULL only when the line has no due date (never: due_at is NOT NULL).
--   2. G4's later reserve date: the exception key deadline.window becomes deadline.reserve ("may still reserve until",
--      never past a board deadline). Payment no longer depends on the session being open, so the old "reserve and pay"
--      extension is a reserve date only; a later pay date is deadline.payment, as before.
--
-- Idempotent. No BEGIN or COMMIT: the migrator runs pending migrations in one transaction.

CREATE OR REPLACE FUNCTION line_cut_off(p_due timestamptz, p_session text, p_attempt text, p_prior text, p_series text, p_declaration_rejected boolean)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT least(
    p_due + make_interval(days => coalesce((SELECT unpaid_cancel_days FROM registration_session WHERE id = p_session), 3)),
    line_effective_deadline(p_attempt, p_prior, p_series, p_declaration_rejected))
$$;
--> statement-breakpoint

-- A V3-shaped row (type deadline_extension or late_registration) is filled with the new key from now on.
CREATE OR REPLACE FUNCTION exception_policy_from_legacy(p_type text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'discount_percent' THEN 'price.discountPercent'
    WHEN 'discount_fixed' THEN 'price.discountFixed'
    WHEN 'custom_price' THEN 'price.custom'
    WHEN 'fee_waiver' THEN 'gate.schoolFee'
    WHEN 'deadline_extension' THEN 'deadline.reserve'
    WHEN 'late_registration' THEN 'deadline.reserve'
    WHEN 'custom_refund_percent' THEN 'refund.percent'
    WHEN 'grade10_other_series' THEN 'eligibility.grade10OtherSeries'
  END
$$;
--> statement-breakpoint

UPDATE exception SET policy_key = 'deadline.reserve' WHERE policy_key = 'deadline.window';
