-- F1 review (docs/features/SCHEDULING.md): the history the new tables keep, for rows made before them.
-- Each statement is idempotent: run twice, it adds nothing the second time.

-- A group's teacher is dated: every group with a teacher had them from the first day of its year.
INSERT INTO "teaching_group_teacher" ("id", "group_id", "teacher_id", "started_on", "reason")
SELECT gen_random_uuid()::text, g."id", g."teacher_id", y."starts_on", 'The teacher when teachers were first dated'
FROM "teaching_group" g
JOIN "academic_year" y ON y."id" = g."academic_year_id"
WHERE g."teacher_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "teaching_group_teacher" t WHERE t."group_id" = g."id");
--> statement-breakpoint

-- A student away now keeps their leaving as history (earlier leavings already undone are not recoverable here).
INSERT INTO "student_leaving" ("id", "student_id", "left_on", "kind", "reason", "recorded_by", "recorded_at")
SELECT gen_random_uuid()::text, u."id", u."left_on", u."left_kind", u."left_reason", u."left_recorded_by", coalesce(u."left_recorded_at", now())
FROM "user" u
WHERE u."left_on" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "student_leaving" s WHERE s."student_id" = u."id" AND s."readmitted_on" IS NULL);
--> statement-breakpoint

-- Arrangements removed before the reason was kept were removed by hand.
UPDATE "cover_assignment" SET "removal" = 'by_hand' WHERE "status" = 'removed' AND "removal" IS NULL;
