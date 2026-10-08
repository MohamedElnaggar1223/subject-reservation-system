-- Reservations rework, step 1 (agent A): the follow-ups to the review of 40c1447.
--
-- A line whose declared earlier sitting the school rejected (step B: registration.declaration_rejected)
-- is a first entry for the board (RESERVATIONS_REWORK.md §3.5): its deadline is the entry
-- deadline, never the later retake deadline. The rule takes the flag as a fourth argument; the
-- three-argument forms stay (they read as not rejected), so every caller written before keeps its
-- meaning and a caller that has the flag passes it. docs/features/RESERVATIONS.md §2.6, §2.12.
CREATE OR REPLACE FUNCTION line_effective_deadline(p_attempt text, p_prior text, p_series text, p_declaration_rejected boolean) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
DECLARE s record; p record; prev record;
BEGIN
  IF p_series IS NULL THEN RETURN NULL; END IF;
  SELECT board_code, month, year, entry_deadline, retake_deadline, exams_start INTO s FROM board_series WHERE id = p_series;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_attempt = 'retake' AND NOT coalesce(p_declaration_rejected, false) AND s.retake_deadline IS NOT NULL AND p_prior IS NOT NULL THEN
    SELECT board_code, month, year INTO p FROM board_series WHERE id = p_prior;
    SELECT * INTO prev FROM board_previous_sitting(s.board_code, s.month, s.year);
    IF p.board_code = s.board_code AND p.month = prev.month AND p.year = prev.year THEN
      RETURN s.retake_deadline;
    END IF;
  END IF;
  IF s.entry_deadline IS NOT NULL THEN RETURN s.entry_deadline; END IF;
  IF s.exams_start IS NOT NULL THEN RETURN (s.exams_start::timestamp AT TIME ZONE 'Africa/Cairo'); END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION line_effective_deadline(p_attempt text, p_prior text, p_series text) RETURNS timestamptz
LANGUAGE sql STABLE AS $$ SELECT line_effective_deadline(p_attempt, p_prior, p_series, false) $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION line_effective_deadline_kind(p_attempt text, p_prior text, p_series text, p_declaration_rejected boolean) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE s record; at timestamptz;
BEGIN
  IF p_series IS NULL THEN RETURN NULL; END IF;
  SELECT entry_deadline, retake_deadline, exams_start INTO s FROM board_series WHERE id = p_series;
  IF NOT FOUND THEN RETURN NULL; END IF;
  at := line_effective_deadline(p_attempt, p_prior, p_series, p_declaration_rejected);
  IF at IS NULL THEN RETURN NULL; END IF;
  IF s.retake_deadline IS NOT NULL AND at = s.retake_deadline AND (s.entry_deadline IS NULL OR s.retake_deadline <> s.entry_deadline) THEN RETURN 'retake'; END IF;
  IF s.entry_deadline IS NOT NULL THEN RETURN 'entry'; END IF;
  RETURN 'exams_start';
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION line_effective_deadline_kind(p_attempt text, p_prior text, p_series text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT line_effective_deadline_kind(p_attempt, p_prior, p_series, false) $$;
