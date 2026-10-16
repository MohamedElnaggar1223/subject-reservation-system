-- The lead's decision of 16 Oct 2026 (FEATURES_PLAN.md §6, 16; docs/features/CYCLE_DECISIONS.md): Entry Lists'
-- rule source names the boards' documents alone, not the research file. 0057 seeded the notes with "From
-- DISCOVERY_RESEARCH.md §2 (…)"; 0057 stays as it was applied, and this migration changes the seeded text on every
-- database, the template, the owner's and a fresh install alike. Only a row still holding 0057's text changes (a
-- note an admin edited through "Change the rules" is left alone), so it is idempotent; each change writes its audit
-- row in the same statement. One statement: drizzle runs the pending migrations in one transaction.
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
INSERT INTO "audit_log" ("id", "user_id", "action", "entity_type", "entity_id", "previous_data", "new_data")
SELECT gen_random_uuid()::text, NULL, 'EXAM_BOARD_RULE_UPDATED', 'exam_board_rule', board_code,
       jsonb_build_object('notes', old_notes),
       jsonb_build_object('notes', new_notes, 'reason', 'The rule source names the board''s documents alone (the lead''s decision of 16 Oct 2026, 16; migration 0061)')
FROM changed;