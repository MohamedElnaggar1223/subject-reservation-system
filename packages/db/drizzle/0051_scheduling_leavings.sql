-- F1 (docs/features/SCHEDULING.md §2, §12): every leaving is kept in student_leaving, so a day away stays a
-- day away after readmission. A student away when this runs keeps their leaving as history; a leaving already
-- undone by a readmission before it is in the audit log only. Idempotent: a student who already has an open
-- leaving row is left alone.
--
-- 0050 creates F1's tables empty, so nothing else needs a backfill: no teaching group, member, teacher row or
-- cover exists before it (the branch's earlier 0043 rebuilt group teachers from TEACHING_GROUP_UPDATED for
-- databases that had F1's first migration; no such database is kept — F1 never shipped).
INSERT INTO "student_leaving" ("id", "student_id", "left_on", "kind", "reason", "recorded_by", "recorded_at")
SELECT gen_random_uuid()::text, u."id", u."left_on", u."left_kind", u."left_reason", u."left_recorded_by", coalesce(u."left_recorded_at", now())
FROM "user" u
WHERE u."left_on" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "student_leaving" s WHERE s."student_id" = u."id" AND s."readmitted_on" IS NULL);
