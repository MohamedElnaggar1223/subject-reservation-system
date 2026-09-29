-- F0a — core foundation: the grade becomes a cohort (FEATURES_PLAN.md F0a).
-- Hand-written backfill between the additive migration (0034) and the one
-- that drops what it replaces (0036). The same rules live in TypeScript in
-- @repo/validations (academic/academic-year.ts); the suite checks both agree.

-- The academic year (its start year) an instant falls in: 1 July, Cairo time.
CREATE OR REPLACE FUNCTION school_academic_year_start(ts timestamptz) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN extract(month FROM (ts AT TIME ZONE 'Africa/Cairo')) >= 7
      THEN extract(year FROM (ts AT TIME ZONE 'Africa/Cairo'))::integer
    ELSE extract(year FROM (ts AT TIME ZONE 'Africa/Cairo'))::integer - 1
  END
$$;
--> statement-breakpoint

-- A student's grade in an academic year: 10 + (year - cohort); null when the
-- cohort is unknown. Past 12 is graduated, below 10 not yet started.
CREATE OR REPLACE FUNCTION school_grade(cohort integer, academic_year_start integer) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN cohort IS NULL THEN NULL ELSE 10 + (academic_year_start - cohort) END
$$;
--> statement-breakpoint

-- The academic year a series belongs to: June and January of Y to Y-1/Y,
-- October and November of Y to Y/Y+1.
CREATE OR REPLACE FUNCTION school_series_academic_year_start(session_type text, series_year integer) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN session_type IN ('june', 'january') THEN series_year - 1 ELSE series_year END
$$;
--> statement-breakpoint

-- 1. Students with a recorded grade are in that grade in the academic year
--    this migration runs in.
UPDATE "user"
SET cohort_year = school_academic_year_start(now()) - ("grade" - 10)
WHERE role = 'student' AND "grade" IS NOT NULL;
--> statement-breakpoint

-- 2. Graduated students. Graduation was stored as a student with no grade
--    (grade.services.ts, GRADE-003), which a student who never finished
--    sign-up also looks like. A graduate is told apart by evidence that they
--    once had a grade: the audit row that set it to null (a window close or
--    an admin), or a registration (every registration path required a
--    grade). The row's date, in Cairo, says which year was their grade 12:
--    - July to December: they had just finished grade 12, the academic year
--      before the row's: cohort = the row's academic year - 3;
--    - January to June: they were graduated during their grade-12 year:
--      cohort = the row's academic year - 2.
--    With only a registration, they are graduated as of this migration:
--    cohort = this academic year - 3.
--    Each inferred cohort writes a STUDENT_COHORT_INFERRED audit row (the
--    basis and the date it read), so staff can review every inference: the
--    Students screen filters on it, and an admin corrects a wrong one with
--    the audited cohort correction.
WITH g AS (
  SELECT s.id,
    (SELECT max(a.created_at) FROM audit_log a
      WHERE a.action = 'USER_GRADE_CHANGED' AND a.entity_type = 'user' AND a.entity_id = s.id
        AND a.new_data ? 'grade' AND a.new_data->'grade' = 'null'::jsonb) AS graduated_at,
    EXISTS (SELECT 1 FROM registration r WHERE r.student_id = s.id) AS registered
  FROM "user" s
  WHERE s.role = 'student' AND s."grade" IS NULL
), inferred AS (
  UPDATE "user" u
  SET cohort_year = CASE
    WHEN g.graduated_at IS NULL THEN school_academic_year_start(now()) - 3
    WHEN extract(month FROM (g.graduated_at AT TIME ZONE 'Africa/Cairo')) >= 7 THEN school_academic_year_start(g.graduated_at) - 3
    ELSE school_academic_year_start(g.graduated_at) - 2
  END
  FROM g
  WHERE u.id = g.id AND (g.graduated_at IS NOT NULL OR g.registered)
  RETURNING u.id, u.cohort_year, g.graduated_at
)
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
SELECT gen_random_uuid()::text, NULL, 'STUDENT_COHORT_INFERRED', 'user', i.id,
  jsonb_build_object('grade', NULL),
  jsonb_build_object(
    'cohortYear', i.cohort_year,
    'basis', CASE WHEN i.graduated_at IS NULL THEN 'registration' ELSE 'graduation_row' END,
    'graduatedAt', i.graduated_at,
    'reason', 'Inferred by the F0a backfill: a graduate (no stored grade)'),
  now()
FROM inferred i;
--> statement-breakpoint

-- 3. Everyone else with the student role and no grade keeps a null cohort:
--    "grade not recorded". They are refused registration (as a null grade
--    was) until an admin records it, and the Students screen lists them.
--    A STUDENT_COHORT_UNRECORDED row marks each: the student may not record
--    it themselves at the setup page (that is only for a cohort never set by
--    anyone, at the student's own first setup); staff correct it.
INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
SELECT gen_random_uuid()::text, NULL, 'STUDENT_COHORT_UNRECORDED', 'user', u.id, NULL,
  jsonb_build_object('cohortYear', NULL, 'reason', 'No grade recorded at the F0a migration: staff record it'), now()
FROM "user" u
WHERE u.role = 'student' AND u."grade" IS NULL AND u.cohort_year IS NULL;
--> statement-breakpoint

-- 4. Every registration window gets its series year: the year in its name
--    ("November 2026") when there is one, otherwise the first time the
--    series month comes on or after the window closes (Cairo time).
UPDATE registration_session
SET series_year = coalesce(
  substring(name FROM '(20[0-9]{2})')::integer,
  CASE
    WHEN extract(month FROM (end_date AT TIME ZONE 'Africa/Cairo')) <=
      CASE session_type WHEN 'january' THEN 1 WHEN 'june' THEN 6 WHEN 'october' THEN 10 ELSE 11 END
      THEN extract(year FROM (end_date AT TIME ZONE 'Africa/Cairo'))::integer
    ELSE extract(year FROM (end_date AT TIME ZONE 'Africa/Cairo'))::integer + 1
  END
)
WHERE series_year IS NULL;
--> statement-breakpoint

-- 5. Every stored file gets the purpose of the route that made it.
UPDATE file SET purpose = CASE file_type WHEN 'avatar' THEN 'avatar' ELSE 'document' END;
