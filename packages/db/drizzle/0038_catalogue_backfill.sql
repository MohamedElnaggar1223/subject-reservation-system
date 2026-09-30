-- F0b — exam catalogue, board series and course enrolment (FEATURES_PLAN.md F0b).
-- Hand-written between the additive migration (0037) and the one that moves
-- the entry deadline off the window and ties subjects to boards (0039).
-- The rules below also live in TypeScript (apps/api/src/services/
-- catalogue.services.ts, series.services.ts); the database holds them too so
-- no path — a route, the scheduler, raw SQL, the day-one import — can break
-- them.

-- 1. The boards. Their codes are the subject table's council values; names,
--    portals and the months each sits are data the coordinator edits
--    (DISCOVERY_RESEARCH.md §2: Pearson IAL October, January, June and
--    International GCSE November, June; Cambridge June and November; OxfordAQA
--    January, June and November).
INSERT INTO exam_board (code, name, short_name, entry_portal, series_months, sort_order) VALUES
  ('pearson_edexcel', 'Pearson Edexcel', 'Pearson', 'Edexcel Online', '["january", "june", "october", "november"]'::jsonb, 1),
  ('cambridge', 'Cambridge International', 'Cambridge', 'Cambridge Direct', '["june", "november"]'::jsonb, 2),
  ('oxford', 'OxfordAQA', 'OxfordAQA', 'Centre Services', '["january", "june", "november"]'::jsonb, 3)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO exam_board (code, name, short_name, series_months, sort_order)
SELECT DISTINCT s.council, initcap(replace(s.council, '_', ' ')), initcap(replace(s.council, '_', ' ')), '["june", "november"]'::jsonb, 9
FROM subject s
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- 2. Existing registrable rows. An IGCSE row is a whole qualification (one row
--    per subject per level, as the old model meant): it gets a qualification
--    in the catalogue with its code, title and board, and is linked to it.
--    An AS or A Level row may be a whole qualification, a unit ("Pure
--    Mathematics 1") or a paper set ("Biology (Paper 1 & Paper 2)") —
--    IMPORT_SPIKE.md IS-01 — and nothing in the row says which, so it is left
--    unmapped: the Catalogue screen lists it for the coordinator to map once.
--    Registrations keep working either way.
INSERT INTO qualification (id, board_code, code, title, level, suite, subject_area, entry_method, is_active, notes)
SELECT
  'q_' || s.id,
  s.council,
  s.code,
  s.name,
  s.qualification_level,
  CASE s.council
    WHEN 'pearson_edexcel' THEN 'International GCSE'
    WHEN 'cambridge' THEN 'Cambridge IGCSE'
    WHEN 'oxford' THEN 'OxfordAQA International GCSE'
    ELSE ''
  END,
  s.name,
  CASE s.council WHEN 'cambridge' THEN 'syllabus_option' ELSE 'qualification' END,
  s.is_active,
  'Made from the registrable row when the catalogue was introduced (migration 0038).'
FROM subject s
WHERE s.qualification_level = 'igcse'
ON CONFLICT (board_code, code, level) DO NOTHING;
--> statement-breakpoint
UPDATE subject s
SET qualification_id = q.id
FROM qualification q
WHERE s.qualification_level = 'igcse' AND s.qualification_id IS NULL
  AND q.board_code = s.council AND q.code = s.code AND q.level = s.qualification_level;
--> statement-breakpoint

-- 3. Existing windows feed board series. A window's series was implied by its
--    type and year (F0a) and its entry deadline was the window's own
--    (MO-10). Three passes, then a check:
--
--    a. A board never gets a series in a month it does not sit. A subject
--       registered in a window whose month its board does not sit (the
--       school's January and October rows, all "cambridge" until now:
--       Cambridge sits no January or October series) is entered with the
--       board that does — the first board, in the catalogue's order, that
--       sits every month the subject is registered in (Pearson Edexcel for
--       AS and A Level January and October: IS-14, DISCOVERY_RESEARCH.md §1).
--       Each such subject gets a SUBJECT_BOARD_INFERRED row, and each of its
--       registrations a REGISTRATION_SERIES_INFERRED row (after pass c), for
--       staff to check on the Board series screen. Its old board's award and
--       units are cleared (the Catalogue lists it to map again).
--    b. Each window feeds, for every board of the subjects it registered or
--       offers (active subjects at its level), that board's series of the
--       window's month and year — or, for a board that does not sit that
--       month, the series of the board that does — as the board's default,
--       carrying the window's deadline. Windows of one board series with the
--       same deadline share it; a window whose deadline differs gets a series
--       of its own, labelled with the window's name, so no deadline moves.
--    c. Every registration is routed to its window's default series of its
--       subject's board.
--    d. A window deadline no series carries fails the migration, naming the
--       window: the deadline is never dropped silently (0039 removes the
--       window's column).
DO $$
DECLARE
  s record;
  newb text;
  months text[];
BEGIN
  FOR s IN
    SELECT sub.id, sub.name, sub.council,
           array_agg(DISTINCT w.session_type) AS months,
           array_agg(DISTINCT w.name) AS windows
    FROM subject sub
    JOIN registration r ON r.subject_id = sub.id
    JOIN registration_session w ON w.id = r.session_id
    GROUP BY sub.id, sub.name, sub.council
    HAVING bool_or(NOT EXISTS (
      SELECT 1 FROM exam_board b WHERE b.code = sub.council AND b.series_months ? w.session_type))
  LOOP
    months := s.months;
    SELECT b.code INTO newb FROM exam_board b
     WHERE (SELECT bool_and(b.series_months ? m) FROM unnest(months) m)
     ORDER BY b.sort_order, b.code LIMIT 1;
    IF newb IS NULL THEN
      RAISE EXCEPTION 'F0b backfill: subject "%" (%) is registered in % series and no board sits all of them — enter its board by hand before migrating',
        s.name, s.id, array_to_string(months, ', ');
    END IF;
    UPDATE subject SET council = newb, qualification_id = NULL, updated_at = now() WHERE id = s.id;
    DELETE FROM subject_unit WHERE subject_id = s.id;
    INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
    VALUES (gen_random_uuid()::text, NULL, 'SUBJECT_BOARD_INFERRED', 'subject', s.id,
      jsonb_build_object('council', s.council),
      jsonb_build_object('council', newb, 'windows', to_jsonb(s.windows), 'months', to_jsonb(months),
        'reason', format('Registered in a %s series, which %s does not sit: entered with the board that sits it (F0b backfill) — check it', array_to_string(months, ' and '), s.council)),
      now());
    newb := NULL;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  w record;
  b text;
  eff text;
  sid text;
  lbl text;
BEGIN
  FOR w IN SELECT * FROM registration_session ORDER BY created_at, id LOOP
    FOR b IN
      SELECT DISTINCT s.council FROM registration r JOIN subject s ON s.id = r.subject_id WHERE r.session_id = w.id
      UNION
      SELECT DISTINCT s.council FROM subject s WHERE s.is_active AND s.qualification_level = w.qualification_level
    LOOP
      -- A board that does not sit the window's month is represented by the one that does.
      SELECT CASE WHEN EXISTS (SELECT 1 FROM exam_board x WHERE x.code = b AND x.series_months ? w.session_type) THEN b
                  ELSE (SELECT x.code FROM exam_board x WHERE x.series_months ? w.session_type ORDER BY x.sort_order, x.code LIMIT 1) END
        INTO eff;
      IF eff IS NULL THEN
        RAISE EXCEPTION 'F0b backfill: no board sits a % series (window "%", %)', w.session_type, w.name, w.id;
      END IF;
      SELECT bs.id INTO sid FROM board_series bs
       WHERE bs.board_code = eff AND bs.month = w.session_type AND bs.year = w.series_year
         AND bs.entry_deadline IS NOT DISTINCT FROM w.entry_deadline
       ORDER BY bs.label LIMIT 1;
      IF sid IS NULL THEN
        lbl := '';
        IF EXISTS (SELECT 1 FROM board_series bs WHERE bs.board_code = eff AND bs.month = w.session_type AND bs.year = w.series_year AND bs.label = '') THEN
          lbl := left(w.name, 48) || ' (' || left(w.id, 8) || ')';
        END IF;
        sid := 'bs_' || md5(eff || '|' || w.session_type || '|' || w.series_year || '|' || lbl);
        INSERT INTO board_series (id, board_code, month, year, label, entry_deadline, notes)
        VALUES (sid, eff, w.session_type, w.series_year, lbl, w.entry_deadline,
                'Made from the window "' || w.name || '" when board series were introduced (migration 0038).');
      END IF;
      INSERT INTO session_board_series (id, session_id, board_series_id, board_code, is_default)
      VALUES ('sbs_' || md5(w.id || '|' || sid), w.id, sid, eff, true)
      ON CONFLICT DO NOTHING;
      sid := NULL;
      eff := NULL;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint
UPDATE registration r
SET board_series_id = l.board_series_id
FROM subject s, session_board_series l
WHERE s.id = r.subject_id AND l.session_id = r.session_id AND l.board_code = s.council AND l.is_default
  AND r.board_series_id IS NULL;
--> statement-breakpoint
-- The registrations of every subject whose board pass a inferred, for staff to check.
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
SELECT gen_random_uuid()::text, NULL, 'REGISTRATION_SERIES_INFERRED', 'registration', r.id,
  jsonb_build_object('council', a.previous_data->>'council'),
  jsonb_build_object('boardSeriesId', r.board_series_id, 'council', s.council, 'sessionId', r.session_id,
    'reason', 'Its subject''s board does not sit the window''s series: entered with the board that does (F0b backfill) — check it'),
  now()
FROM registration r
JOIN subject s ON s.id = r.subject_id
JOIN audit_log a ON a.entity_id = s.id AND a.action = 'SUBJECT_BOARD_INFERRED';
--> statement-breakpoint
DO $$
DECLARE
  w record;
BEGIN
  FOR w IN
    SELECT rs.id, rs.name, rs.entry_deadline FROM registration_session rs
    WHERE rs.entry_deadline IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM session_board_series l WHERE l.session_id = rs.id)
    ORDER BY rs.created_at, rs.id
  LOOP
    RAISE EXCEPTION 'F0b backfill: the window "%" (%) has an entry deadline (%) and no board series to carry it — it offers no subject at its level and has no registrations; give it a subject or clear its deadline, then migrate again',
      w.name, w.id, w.entry_deadline;
  END LOOP;
END $$;
--> statement-breakpoint

-- 4. The rules the database keeps from here on.
--
-- A window and a series it feeds agree: the series is in the window's
-- academic year and, like the window, a June series or not — so a student's
-- eligibility (F0a's mayRegisterFor, which reads the window's series) has one
-- answer for the whole window — and the window closes before the series'
-- entry deadline, so the deadline sweep never runs inside an open window
-- (MO-10; this replaces the window's own session_entry_deadline_after_end).
CREATE OR REPLACE FUNCTION catalogue_window_series_check(
  w_type text, w_year integer, w_end timestamptz, s_month text, s_year integer, s_deadline timestamptz
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF school_series_academic_year_start(s_month, s_year) <> school_series_academic_year_start(w_type, w_year) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'window_series_same_academic_year',
      MESSAGE = format('A %s %s series is not in the academic year of a %s %s window', s_month, s_year, w_type, w_year);
  END IF;
  IF (s_month = 'june') <> (w_type = 'june') THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'window_series_same_kind',
      MESSAGE = format('A %s series cannot be fed by a %s window: June and the other series are judged differently', s_month, w_type);
  END IF;
  IF s_deadline IS NOT NULL AND w_end >= s_deadline THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'window_closes_before_series_deadline',
      MESSAGE = 'A window must close before the entry deadline of every board series it feeds';
  END IF;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION catalogue_link_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w record; s record;
BEGIN
  SELECT session_type, series_year, end_date INTO w FROM registration_session WHERE id = NEW.session_id FOR SHARE;
  SELECT board_code, month, year, entry_deadline INTO s FROM board_series WHERE id = NEW.board_series_id FOR SHARE;
  NEW.board_code := s.board_code;
  PERFORM catalogue_window_series_check(w.session_type, w.series_year, w.end_date, s.month, s.year, s.entry_deadline);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER session_board_series_check BEFORE INSERT OR UPDATE ON session_board_series
FOR EACH ROW EXECUTE FUNCTION catalogue_link_check();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION catalogue_window_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record;
BEGIN
  FOR s IN
    SELECT bs.month, bs.year, bs.entry_deadline FROM session_board_series l JOIN board_series bs ON bs.id = l.board_series_id
    WHERE l.session_id = NEW.id ORDER BY bs.id FOR SHARE OF bs
  LOOP
    PERFORM catalogue_window_series_check(NEW.session_type, NEW.series_year, NEW.end_date, s.month, s.year, s.entry_deadline);
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER registration_session_series_check BEFORE UPDATE OF end_date, session_type, series_year ON registration_session
FOR EACH ROW EXECUTE FUNCTION catalogue_window_check();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION catalogue_series_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w record;
BEGIN
  IF NEW.board_code <> OLD.board_code AND EXISTS (SELECT 1 FROM session_board_series WHERE board_series_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'board_series_board_fixed',
      MESSAGE = 'A series fed by a window keeps its board';
  END IF;
  FOR w IN
    SELECT rs.session_type, rs.series_year, rs.end_date FROM session_board_series l JOIN registration_session rs ON rs.id = l.session_id
    WHERE l.board_series_id = NEW.id ORDER BY rs.id FOR SHARE OF rs
  LOOP
    PERFORM catalogue_window_series_check(w.session_type, w.series_year, w.end_date, NEW.month, NEW.year, NEW.entry_deadline);
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER board_series_window_check BEFORE UPDATE OF entry_deadline, month, year, board_code ON board_series
FOR EACH ROW EXECUTE FUNCTION catalogue_series_check();
--> statement-breakpoint

-- Every registration in a window that feeds board series is entered in one
-- of them, of its subject's board: the one the window routes the subject to,
-- else the window's default series for that board. A path that names the
-- series (every path in the API does, after checking its deadline) must name
-- one of the subject's board; the composite key (0037) keeps it one the
-- window feeds. A window that feeds no series takes registrations without
-- one, as before F0b.
CREATE OR REPLACE FUNCTION catalogue_route_registration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v text; council text; s_board text;
BEGIN
  SELECT s.council INTO council FROM subject s WHERE s.id = NEW.subject_id;
  IF NEW.board_series_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM session_board_series WHERE session_id = NEW.session_id) THEN
      RETURN NEW;
    END IF;
    SELECT board_series_id INTO v FROM session_subject_series WHERE session_id = NEW.session_id AND subject_id = NEW.subject_id;
    IF v IS NULL THEN
      SELECT board_series_id INTO v FROM session_board_series
      WHERE session_id = NEW.session_id AND board_code = council AND is_default;
    END IF;
    IF v IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_board_series_routed',
        MESSAGE = 'This window feeds no board series for the subject''s board';
    END IF;
    NEW.board_series_id := v;
  END IF;
  SELECT board_code INTO s_board FROM board_series WHERE id = NEW.board_series_id;
  IF s_board IS DISTINCT FROM council THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_board_series_board',
      MESSAGE = 'A registration is entered in a series of its subject''s board';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER registration_route_board_series BEFORE INSERT ON registration
FOR EACH ROW EXECUTE FUNCTION catalogue_route_registration();
--> statement-breakpoint
CREATE TRIGGER registration_move_board_series BEFORE UPDATE OF board_series_id ON registration
FOR EACH ROW WHEN (NEW.board_series_id IS NOT NULL AND NEW.board_series_id IS DISTINCT FROM OLD.board_series_id)
EXECUTE FUNCTION catalogue_route_registration();
