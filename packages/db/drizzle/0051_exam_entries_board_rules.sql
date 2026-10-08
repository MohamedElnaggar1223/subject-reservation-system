-- F4 (exam-entry management; regenerated on the reservations rework's journal
-- after 0049 — it was 0042 on the frozen branch): each board's rules for entries, seeded from the
-- research (DISCOVERY_RESEARCH.md §2) and editable by the coordinator and the
-- admin on the Entries screen (owner decision 3: answers change data, not code).
-- A board added later has no row: the API reads the lenient defaults and says
-- so. Rows are added only for boards that exist (0038 seeds the three).

-- Cambridge International: forecast grades are mandatory and cannot be changed
-- once submitted; entries are syllabus + option code; every change after the
-- entry deadline has its own late fee; results are keyed on centre + candidate
-- number. (An AS result is carried forward within 13 months: that period is the
-- board's own column, exam_board.carry_forward_months, seeded by the reservations
-- rework's 0042 and read by its line rules and by F4.) The withdrawal
-- refund rule is not in the research: assumed "no refund after the deadline".
INSERT INTO "exam_board_rule" (
  "board_code", "forecast_required", "forecast_locked_on_submit", "option_code_required", "uci_required",
  "candidate_number_fixed", "amendment_after_deadline", "amendment_fee_from", "amendment_fee_note",
  "withdrawal_refund_until", "withdrawal_fee_note", "results_key", "notes"
)
SELECT 'cambridge', true, true, true, false,
  true, 'allowed_with_fee', 'entry_deadline',
  'Cambridge charges a late fee for every change made after the entry deadline.',
  'entry_deadline',
  'Assumed (not in the research): after the entry deadline Cambridge keeps the entry fee for a withdrawn entry — check the Cambridge Handbook.',
  'candidate_number',
  'From DISCOVERY_RESEARCH.md §2 (Cambridge Handbook 2026). Check each rule against the current handbook.'
WHERE EXISTS (SELECT 1 FROM "exam_board" WHERE "code" = 'cambridge')
ON CONFLICT ("board_code") DO NOTHING;
--> statement-breakpoint

-- Pearson Edexcel: the UCI is mandatory in its entry files; entries are W
-- units, X/Y cash-ins and International GCSE codes; entries are refunded
-- automatically up to the high-late date; an option change after the
-- high-late date costs an amendment fee; results are keyed on the UCI. Forecast
-- grades are not required by the research.
INSERT INTO "exam_board_rule" (
  "board_code", "forecast_required", "forecast_locked_on_submit", "option_code_required", "uci_required",
  "candidate_number_fixed", "amendment_after_deadline", "amendment_fee_from", "amendment_fee_note",
  "withdrawal_refund_until", "withdrawal_fee_note", "results_key", "notes"
)
SELECT 'pearson_edexcel', false, false, false, true,
  true, 'allowed_with_fee', 'high_late_fee_from',
  'Pearson charges an amendment fee for an option change after the high-late fee date.',
  'high_late_fee_from',
  'Pearson refunds an entry automatically up to the high-late fee date; after it the entry fee is kept.',
  'uci',
  'From DISCOVERY_RESEARCH.md §2 (Pearson key dates 2026/27, IAL information manual). IAL unit results are banked under the UCI.'
WHERE EXISTS (SELECT 1 FROM "exam_board" WHERE "code" = 'pearson_edexcel')
ON CONFLICT ("board_code") DO NOTHING;
--> statement-breakpoint

-- OxfordAQA: not researched beyond its series and entry routes; lenient
-- defaults, said so in the notes.
INSERT INTO "exam_board_rule" (
  "board_code", "forecast_required", "forecast_locked_on_submit", "option_code_required", "uci_required",
  "candidate_number_fixed", "amendment_after_deadline", "amendment_fee_from", "amendment_fee_note",
  "withdrawal_refund_until", "withdrawal_fee_note", "results_key", "notes"
)
SELECT 'oxford', false, false, false, false,
  true, 'allowed_with_fee', 'entry_deadline',
  'Not researched: assumed that a change after the entry deadline costs a fee — check with OxfordAQA.',
  'entry_deadline',
  'Not researched: assumed that the entry fee is kept after the entry deadline — check with OxfordAQA.',
  'candidate_number',
  'OxfordAQA''s entry rules were not researched (DISCOVERY_RESEARCH.md §2 lists only its series and entry routes).'
WHERE EXISTS (SELECT 1 FROM "exam_board" WHERE "code" = 'oxford')
ON CONFLICT ("board_code") DO NOTHING;
