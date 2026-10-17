-- The migration proof's second fixture (answer 2, migration 0064): on the same template copy migrated with main's 62,
-- after fixture-at-62.sql, a Cambridge IGCSE syllabus entered through one option code (as 0970 CX) and the one-paper
-- items main's code makes for it (offer.services.ts withOnePaper on main: keyed on the qualification), written by
-- hand because the template holds none. fixture-at-62.sql's mig_i_cam sits under a Cambridge offer whose whole item
-- enters the award, not an option: it keeps the qualification. Placeholders only; ids prefixed mig_.
BEGIN;
INSERT INTO exam_unit (id, board_code, code, short_code, title, unit_level, kind) VALUES
  ('mig_u_b2', 'cambridge', 'MIG-B2', 'Paper 2', 'Paper 2', 'igcse', 'component'),
  ('mig_u_b4', 'cambridge', 'MIG-B4', 'Paper 4', 'Paper 4', 'igcse', 'component');
INSERT INTO qualification (id, board_code, code, title, level, subject_area, entry_method, suite) VALUES
  ('mig_q_bio', 'cambridge', 'MIG-0970', 'Biology (migration proof)', 'igcse', 'Biology', 'syllabus_option', 'Cambridge IGCSE');
INSERT INTO qualification_option (id, qualification_id, code, label) VALUES ('mig_qo_cx', 'mig_q_bio', 'CX', 'Extended, Papers 2 and 4');
INSERT INTO qualification_option_unit (option_id, unit_id) VALUES ('mig_qo_cx', 'mig_u_b2'), ('mig_qo_cx', 'mig_u_b4');
INSERT INTO subject (id, name, code, council, qualification_level, course_fee, registration_fee, price_in_school, qualification_id, is_active, is_offered_at_school)
  VALUES ('mig_s_bio', 'Biology O.L. (migration proof)', 'MIG-BIO', 'cambridge', 'igcse', 1000, 0, 1000, 'mig_q_bio', true, true);
INSERT INTO session_offer (id, session_id, subject_id, availability, course_fee) VALUES ('mig_o_bio', 'sess_november-2026', 'mig_s_bio', 'open', 1000);
INSERT INTO session_offer_item (id, offer_id, session_id, label, kind, enters_kind, qualification_id, qualification_option_id, board_series_id, availability, exclusive_group, sort_order) VALUES
  ('mig_i_bwhole', 'mig_o_bio', 'sess_november-2026', 'Whole subject', 'whole', 'option', 'mig_q_bio', 'mig_qo_cx', 'bs_58852816d51a4d06f90429e9178d598a', 'open', 'entry', 0),
  ('mig_i_b2', 'mig_o_bio', 'sess_november-2026', 'Paper 2 only (retake)', 'one_paper', 'units', 'mig_q_bio', NULL, 'bs_58852816d51a4d06f90429e9178d598a', 'closed', 'entry', 10),
  ('mig_i_b4', 'mig_o_bio', 'sess_november-2026', 'Paper 4 only (retake)', 'one_paper', 'units', 'mig_q_bio', NULL, 'bs_58852816d51a4d06f90429e9178d598a', 'retake_only', 'entry', 11);
INSERT INTO session_offer_item_unit (item_id, unit_id) VALUES ('mig_i_b2', 'mig_u_b2'), ('mig_i_b4', 'mig_u_b4');
INSERT INTO session_offer_item_fee_key (id, item_id, key_kind, qualification_option_id, qualification_id) VALUES
  ('mig_k_bwhole', 'mig_i_bwhole', 'option', 'mig_qo_cx', NULL),
  ('mig_k_b2', 'mig_i_b2', 'qualification', NULL, 'mig_q_bio'),
  ('mig_k_b4', 'mig_i_b4', 'qualification', NULL, 'mig_q_bio');
COMMIT;
