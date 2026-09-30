# F7 — Day-one import (as built)

Branch `feature/import`, started from `origin/main` e5da650 (F0a and F0b merged). The plan is
FEATURES_PLAN.md §1 "F7 — Day-one import" and §5's rules; the evidence behind it is
IMPORT_SPIKE.md (IS-01 to IS-14), DISCOVERY.md (A-02, A-03, Q-02, Q-05, Q-09, F-01) and
DISCOVERY_RESEARCH.md §1. The trail is `.audit/import.tsv`; evidence (suite logs, control logs,
the real-sheet run's counts, screenshots of synthetic data) is `.audit/import-evidence/`
(git-ignored). The progress log is the last section.

**The school's real sheet never enters the repository, a test, a screenshot or a log.** It is
cited by row numbers and counts only; tests build synthetic sheets with the same shapes.

This document is written as the feature is built; sections marked *(in progress)* are not
final.

---

## Progress log

- 2026-09-30 02:47Z — started on `feature/import` from origin/main e5da650; baseline suite green
  on `igcse_import_test` (22 files, 308 passed, 1 todo).
- 03:14Z — schema (0041), validations, reader, staging, review, commit, routes (86a524b).
- 03:24Z — 08n: the three named scenarios and the race (82a2e35).
- 03:30Z — registrations in a window, SCL roster, money record, authz rows, 05, 09; suite green
  in local time (23 files, 343 passed) (ea1f744).
- 03:45Z — the screens: /imports and /imports/:id (7f154bf); driven once end to end in headless
  Chrome on synthetic data as the coordinator (upload, fixes, split, merge, skip, commit).
- After a spend-limit stop — Arabic dictionary, compact summary, editor focus (2b25624).
- Next: tall and Arabic screenshots, a 400+ row check, controls, the real-sheet run, this
  document in full, gates in local time and UTC, push.
