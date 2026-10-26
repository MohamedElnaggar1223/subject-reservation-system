-- The P1b review, L1: a line's cut-off adds the session's unpaid-cancel days in Cairo local time, not as 24-hour
-- days in UTC. Across Egypt's clock change (the last Thursday of October, and back in spring) a day is 23 or 25
-- hours long, so "due + 3 days" counted in UTC landed an hour off the end of the Cairo day the family was told.
-- The due date is read as a Cairo wall-clock time, the days added there, and the result read back as an instant.
--
-- Idempotent. No BEGIN or COMMIT: the migrator runs pending migrations in one transaction.

CREATE OR REPLACE FUNCTION line_cut_off(p_due timestamptz, p_session text, p_attempt text, p_prior text, p_series text, p_declaration_rejected boolean)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT least(
    ((p_due AT TIME ZONE 'Africa/Cairo')
      + make_interval(days => coalesce((SELECT unpaid_cancel_days FROM registration_session WHERE id = p_session), 3))) AT TIME ZONE 'Africa/Cairo',
    line_effective_deadline(p_attempt, p_prior, p_series, p_declaration_rejected))
$$;
