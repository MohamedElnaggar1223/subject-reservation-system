# F6b — The reservation cycle only: hide what is outside it

**Spec:** FEATURES_PLAN.md §1 "F6b" (the lead's copy, 14 Oct 2026). **Branch:** `feature/reservation-focus`
(worktree `.claude/worktrees/reservation-focus`), from main b6857cb. **Databases:** `igcse_focus_dev`
(from `igcse_template_dev`), `igcse_focus_test`. **Ports:** API 3161, web 3160. **Agent:** one Opus 5.5
agent end to end (the owner's instruction); the lead reads the diff, runs the gates, drives every role
and merges after F6a.

(Being written; the sections below fill in as the work lands. The progress log at the end is kept
current so the work can resume after an interruption.)

## Progress log (UTC)

- 2026-10-14 20:28Z — setup: worktree installed and built, `igcse_focus_dev` created and migrated (59
  migrations), env files copied with ports 3161/3160, dev servers started (API pid 84853, web pid 84878).
  Placeholder coordinator, teacher and gate accounts made through `POST /v1/users` as admin on the dev
  database only (`coordinator.focus@`, `teacher.focus@`, `gate.focus@igcse.local`, `TestPass1`).
- 2026-10-14 20:33Z — the "before" drive: every role signed in through the real sign-in page, English
  and Arabic (`.audit/reservation-focus-evidence/before/`). Counts: admin 41, coordinator 26, finance
  admin 16, finance officer 12, teacher 6, gate 3, parent 14, student 12.
- 2026-10-14 ~21:00Z — design settled; building `apps/web/lib/reservation-focus.ts` (the constant, the
  per-role list, the cycle's order, the landing per role), the sidebar, the landings, the links.
