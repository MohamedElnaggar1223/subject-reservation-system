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
--    an admin; its date is the academic year they were graduated in), or a
--    registration (every registration path required a grade). They become
--    past grade 12 in that year: cohort = that year - 3.
UPDATE "user" u
SET cohort_year = school_academic_year_start(coalesce(g.graduated_at, now())) - 3
FROM (
  SELECT s.id,
    (SELECT max(a.created_at) FROM audit_log a
      WHERE a.action = 'USER_GRADE_CHANGED' AND a.entity_type = 'user' AND a.entity_id = s.id
        AND a.new_data ? 'grade' AND a.new_data->'grade' = 'null'::jsonb) AS graduated_at,
    EXISTS (SELECT 1 FROM registration r WHERE r.student_id = s.id) AS registered
  FROM "user" s
  WHERE s.role = 'student' AND s."grade" IS NULL
) g
WHERE u.id = g.id AND (g.graduated_at IS NOT NULL OR g.registered);
--> statement-breakpoint

-- 3. Everyone else with the student role and no grade keeps a null cohort:
--    "grade not recorded". They are refused registration (as a null grade
--    was) until an admin records it, and the Students screen lists them.

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
