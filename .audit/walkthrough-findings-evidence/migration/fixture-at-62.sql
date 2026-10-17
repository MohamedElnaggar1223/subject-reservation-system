-- The migration proof's fixture (docs/features/WALKTHROUGH_FINDINGS.md §1): on a fresh copy of igcse_template_dev
-- migrated with main's 62 migrations, the rows main's code makes for one-paper retakes (offer.services.ts withOnePaper
-- on main: every one-paper item keyed on its qualification), written by hand because the template holds none.
-- Placeholders only; ids prefixed mig_.
BEGIN;
INSERT INTO board_series (id, board_code, month, year, label) VALUES ('mig_bs_p', 'pearson_edexcel', 'november', 2026, 'mig-proof');
INSERT INTO session_board_series (id, session_id, board_series_id, board_code, is_default) VALUES ('mig_sbs_p', 'sess_november-2026', 'mig_bs_p', 'pearson_edexcel', false);
INSERT INTO exam_unit (id, board_code, code, short_code, title, unit_level, kind) VALUES
  ('mig_u_1h', 'pearson_edexcel', 'MIG-1H', 'Paper 1H', 'Paper 1H', 'igcse', 'component'),
  ('mig_u_2h', 'pearson_edexcel', 'MIG-2H', 'Paper 2H', 'Paper 2H', 'igcse', 'component'),
  ('mig_u_p4', 'cambridge', 'MIG-P4', 'Paper 4', 'Paper 4', 'igcse', 'component');
INSERT INTO qualification (id, board_code, code, title, level, subject_area, entry_method, suite) VALUES
  ('mig_q_ma', 'pearson_edexcel', 'MIG-4MA1', 'Mathematics A (migration proof)', 'igcse', 'Mathematics', 'qualification', 'Pearson Edexcel International GCSE'),
  ('mig_q_cam', 'cambridge', 'MIG-0580', 'Mathematics (migration proof)', 'igcse', 'Mathematics', 'qualification', 'Cambridge IGCSE');
INSERT INTO subject (id, name, code, council, qualification_level, course_fee, registration_fee, price_in_school, qualification_id, is_active, is_offered_at_school)
  VALUES ('mig_s_ma', 'Mathematics O.L. (migration proof)', 'MIG-MA', 'pearson_edexcel', 'igcse', 1000, 0, 1000, 'mig_q_ma', true, true);
INSERT INTO session_offer (id, session_id, subject_id, availability, course_fee) VALUES ('mig_o_ma', 'sess_november-2026', 'mig_s_ma', 'open', 1000);
INSERT INTO session_offer_item (id, offer_id, session_id, label, kind, enters_kind, qualification_id, board_series_id, availability, exclusive_group, sort_order) VALUES
  ('mig_i_whole', 'mig_o_ma', 'sess_november-2026', 'Whole subject', 'whole', 'award', 'mig_q_ma', 'mig_bs_p', 'open', 'entry', 0),
  ('mig_i_1h', 'mig_o_ma', 'sess_november-2026', 'Paper 1H only (retake)', 'one_paper', 'units', 'mig_q_ma', 'mig_bs_p', 'retake_only', 'entry', 10),
  ('mig_i_both', 'mig_o_ma', 'sess_november-2026', 'Papers 1H and 2H (retake)', 'one_paper', 'units', 'mig_q_ma', 'mig_bs_p', 'closed', 'entry', 11);
INSERT INTO session_offer_item_unit (item_id, unit_id) VALUES ('mig_i_1h', 'mig_u_1h'), ('mig_i_both', 'mig_u_1h'), ('mig_i_both', 'mig_u_2h');
INSERT INTO session_offer_item_fee_key (id, item_id, key_kind, qualification_id) VALUES
  ('mig_k_whole', 'mig_i_whole', 'qualification', 'mig_q_ma'),
  ('mig_k_1h', 'mig_i_1h', 'qualification', 'mig_q_ma'),
  ('mig_k_both', 'mig_i_both', 'qualification', 'mig_q_ma');
-- A Cambridge one-paper item under an existing Cambridge offer of the same session: Cambridge keeps the qualification.
INSERT INTO session_offer_item (id, offer_id, session_id, label, kind, enters_kind, qualification_id, board_series_id, availability, sort_order)
  VALUES ('mig_i_cam', 'e9e15fa6-79de-a125-5fb3-c8ce999bd40a', 'sess_november-2026', 'Paper 4 only (retake)', 'one_paper', 'units', 'mig_q_cam', 'bs_58852816d51a4d06f90429e9178d598a', 'closed', 10);
INSERT INTO session_offer_item_unit (item_id, unit_id) VALUES ('mig_i_cam', 'mig_u_p4');
INSERT INTO session_offer_item_fee_key (id, item_id, key_kind, qualification_id) VALUES ('mig_k_cam', 'mig_i_cam', 'qualification', 'mig_q_cam');
COMMIT;
