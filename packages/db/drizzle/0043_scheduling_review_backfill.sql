-- F1 review (docs/features/SCHEDULING.md §12, §16): the history the new tables keep, for rows made before them.
-- Each statement is idempotent: run twice, it adds nothing the second time (a group or student that already
-- has rows is left alone).

-- A group's teachers, rebuilt from the audit log. Before teachers were dated, a change of teacher took effect
-- the day it was made (TEACHING_GROUP_UPDATED, previous and new teacherId). So for each group with such
-- changes: the teacher it changed from taught it from its academic year's first day until the day before the
-- first change; each change's new teacher from the day of the change (in Cairo) until the day before the next
-- change; the last one, open, is the teacher the group has now. Assumed: the teacher before the first change
-- taught from the year's first day (the log does not say when a group first had a teacher).
WITH changes AS (
  SELECT a.entity_id AS group_id,
         (a.created_at AT TIME ZONE 'Africa/Cairo')::date AS on_day,
         a.previous_data ->> 'teacherId' AS before_id,
         a.new_data ->> 'teacherId' AS after_id,
         a.created_at, a.id
  FROM "audit_log" a
  JOIN "teaching_group" g ON g."id" = a.entity_id
  WHERE a.action = 'TEACHING_GROUP_UPDATED'
    AND a.new_data ? 'teacherId'
    AND (a.previous_data ->> 'teacherId') IS DISTINCT FROM (a.new_data ->> 'teacherId')
    AND NOT EXISTS (SELECT 1 FROM "teaching_group_teacher" t WHERE t."group_id" = a.entity_id)
),
ordered AS (
  SELECT c.*, row_number() OVER (PARTITION BY c.group_id ORDER BY c.created_at, c.id) AS n,
         lead(c.on_day) OVER (PARTITION BY c.group_id ORDER BY c.created_at, c.id) AS next_day
  FROM changes c
),
segments AS (
  -- Before the first change: the teacher it changed from, from the year's first day.
  SELECT o.group_id, o.before_id AS teacher_id, y."starts_on" AS started_on, o.on_day AS until_day, FALSE AS last,
         'The teacher before the first recorded change (assumed from the year''s first day)' AS reason
  FROM ordered o
  JOIN "teaching_group" g ON g."id" = o.group_id
  JOIN "academic_year" y ON y."id" = g."academic_year_id"
  WHERE o.n = 1
  UNION ALL
  -- Each change: its new teacher from the day it was made (the last one: the group's teacher now).
  SELECT o.group_id, CASE WHEN o.next_day IS NULL THEN g."teacher_id" ELSE o.after_id END, o.on_day, o.next_day, o.next_day IS NULL,
         'Changed (rebuilt from the audit log)'
  FROM ordered o
  JOIN "teaching_group" g ON g."id" = o.group_id
)
INSERT INTO "teaching_group_teacher" ("id", "group_id", "teacher_id", "started_on", "ended_on", "reason")
SELECT gen_random_uuid()::text, s.group_id,
       CASE WHEN EXISTS (SELECT 1 FROM "teacher" t WHERE t."id" = s.teacher_id) THEN s.teacher_id END,
       s.started_on,
       CASE WHEN s.last THEN NULL ELSE greatest(s.until_day - 1, s.started_on - 1) END,
       s.reason
FROM segments s;
--> statement-breakpoint

-- A group with a teacher and no recorded change: that teacher, assumed from its academic year's first day.
INSERT INTO "teaching_group_teacher" ("id", "group_id", "teacher_id", "started_on", "reason")
SELECT gen_random_uuid()::text, g."id", g."teacher_id", y."starts_on", 'The teacher when teachers were first dated (assumed from the year''s first day)'
FROM "teaching_group" g
JOIN "academic_year" y ON y."id" = g."academic_year_id"
WHERE g."teacher_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "teaching_group_teacher" t WHERE t."group_id" = g."id");
--> statement-breakpoint

-- A student away now keeps their leaving as history (earlier leavings already undone are in the audit log only).
INSERT INTO "student_leaving" ("id", "student_id", "left_on", "kind", "reason", "recorded_by", "recorded_at")
SELECT gen_random_uuid()::text, u."id", u."left_on", u."left_kind", u."left_reason", u."left_recorded_by", coalesce(u."left_recorded_at", now())
FROM "user" u
WHERE u."left_on" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "student_leaving" s WHERE s."student_id" = u."id" AND s."readmitted_on" IS NULL);
--> statement-breakpoint

-- Arrangements removed before the reason was kept were removed by hand.
UPDATE "cover_assignment" SET "removal" = 'by_hand' WHERE "status" = 'removed' AND "removal" IS NULL;
