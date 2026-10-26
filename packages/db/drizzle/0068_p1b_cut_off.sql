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

UPDATE exception SET policy_key = 'deadline.reserve' WHERE policy_key = 'deadline.window';
