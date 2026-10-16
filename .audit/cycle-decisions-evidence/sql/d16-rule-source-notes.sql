-- Decision 16 (the lead, 16 Oct 2026; FEATURES_PLAN.md §6, 16): Entry Lists' rule source names the boards'
-- documents alone, not the research file. Migration 0057 seeds the new text for new installs; this one-off
-- update is for a database that ran 0057 before (igcse_template_dev, the owner's). Only a row that still holds
-- the text 0057 seeded changes (a note an admin edited is left alone); each change has its audit row in the
-- same transaction. Run once with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f d16-rule-source-notes.sql
-- Run again, it changes nothing (no row holds the old text).
BEGIN;
WITH changed AS (
  UPDATE exam_board_rule r SET notes = v.new_notes, updated_at = now()
  FROM (VALUES
    ('cambridge',
     'From DISCOVERY_RESEARCH.md §2 (Cambridge Handbook 2026). Check each rule against the current handbook.',
     'Cambridge Handbook 2026. Check each rule against the current handbook.'),
    ('pearson_edexcel',
     'From DISCOVERY_RESEARCH.md §2 (Pearson key dates 2026/27, IAL information manual). IAL unit results are banked under the UCI.',
     'Pearson key dates 2026/27, IAL information manual. IAL unit results are banked under the UCI.'),
    ('oxford',
     'OxfordAQA''s entry rules were not researched (DISCOVERY_RESEARCH.md §2 lists only its series and entry routes).',
     'OxfordAQA''s entry rules were not researched: only its series and entry routes are known.')
  ) AS v(board_code, old_notes, new_notes)
  WHERE r.board_code = v.board_code AND r.notes = v.old_notes
  RETURNING r.board_code, v.old_notes, v.new_notes
)
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data)
SELECT gen_random_uuid()::text, NULL, 'EXAM_BOARD_RULE_UPDATED', 'exam_board_rule', board_code,
       jsonb_build_object('notes', old_notes),
       jsonb_build_object('notes', new_notes, 'reason', 'The rule source names the board''s documents alone (the lead''s decision of 16 Oct 2026, 16)')
FROM changed;
COMMIT;
