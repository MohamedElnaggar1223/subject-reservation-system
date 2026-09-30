# F2 — Campus-leave permissions (as built)

Branch `feature/campus-leave`, started from `origin/feature/scheduling` 9569dd9 (F1, with main's
F0a and F0b merged into it). The plan is FEATURES_PLAN.md §1 "F2 — Campus-leave permissions", its
§2 row (`getLeaveCoverage(studentId, date)` for F3) and §5's rules. The trail is
`.audit/campus-leave.tsv`; evidence (suite logs, control logs, screenshots) is
`.audit/leave-evidence/` (git-ignored). The progress log is the last section.

*This document is written as the work goes; sections marked (to come) are filled as each part
lands.*

---

## Progress log

- 2026-09-30 03:20Z — started on `feature/campus-leave` from `origin/feature/scheduling` 9569dd9;
  baseline suite green (27 files, 348 passed, 1 todo).
- 03:40Z — backend first cut 0db5076: migration 0042_campus_leave, ten `leave.*` settings, services
  and 26 endpoints under `/v1/leave`, policy rows; the 04 matrix green.
- (interrupted by the account's spend limit; resumed with nothing lost: the working tree held the
  service fixes and the first scenario file.)
- 07:15Z — `08t1-campus-leave` green (12 scenarios): request paths, approval, recurring,
  warnings, collectors, custody at the gate, the gate and the pass, passes refused, cancelling,
  history and reports, `getLeaveCoverage`, a teacher's lessons. Fixes found by it: a series row
  written before its dates (FK), a setting's empty value stored as JSON null, a custody match
  checked before a duplicate collector, report timestamps parsed.
