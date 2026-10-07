# Reservations rework — step 2, agent B: reservation lines, consent, declared sittings, the Reserve pages, the statement

Branch `feature/rework-reservations` (worktree `.claude/worktrees/rework-reservations`), from
agent A's `feature/rework-sessions` (5367cf8, then 27e3233). The design is
`RESERVATIONS_REWORK.md` version 8 (accepted by the owner on 7 Oct 2026 with its §17
defaults); this is its §9 step 2, agent B, and §3.5, §4.3–§4.6. A's contract is
`docs/features/RESERVATIONS.md` §1, §2 and §2.11. The plan's rules are FEATURES_PLAN.md §3–§5.
Trail: `.audit/rework-reservations.tsv`; evidence (suite logs, controls, screenshots):
`.audit/rework-reservations-evidence/` (git-ignored). The progress log is the last section.

Resources (FEATURES_PLAN.md §7): test database `igcse_rwb_test`, dev database
`igcse_rwb_dev` (a copy of `igcse_template_dev`), API 3111, web 3110.

---

## 1. The data model this step adds

Migrations after A's 0043 (the lead regenerates the later-merging branch's on top of `main`'s
journal, FEATURES_PLAN.md §3):

### 1.1 `0044_rework_reservations` (generated)

| Table | Column / index | Rule |
|---|---|---|
| `registration` | `prior_sitting_verified_by` (user), `prior_sitting_verified_at`, `prior_sitting_verified_outcome` (`verified` \| `rejected`) | the coordinator's answer to a declared sitting; an outcome needs who and when and a sitting (check `registration_prior_sitting_outcome_valid`) |
| `registration` | `declaration_rejected` (bool, default false) | a paid line whose declaration was rejected before the first-entry deadline stands with it; F4 reads its attempt as `first` (check: only after a rejection) |
| `registration` | index `registration_to_verify_idx` | the To verify tab's rows (declared, unanswered), per session |
| `change_request` | `new_line` (jsonb) | the swap's new line as asked: attempt, mode, teacher, the sitting it follows, whether the family consented with the request |
| `registration_consent` | unique (line, kind, **channel**) | was (line, kind): a grade-10 line carries the school's pair (`school`) and the family's own (`app` or `desk`) beside it |

`prior_centre` and `prior_candidate_number` were added by A (0041); B fills them at
verification.

### 1.2 `0045_rework_reservations_consent_guard` (custom)

A deferred constraint trigger on `registration` (`AFTER INSERT OR UPDATE OF status`, `WHEN
status = 'confirmed'`): at the commit, a line that is confirmed and was not converted from before
the rework (`legacy ? 'converted'`) must have both consent kinds, else the transaction fails
(`check_violation`, constraint `registration_confirmed_has_consent`). The services refuse first
with a sentence (`CONSENT_MISSING_REFUSAL`); this is the structure behind the sentence, so no
later path can confirm a line nobody consented to.

### 1.3 The setting

`verification.unverifiedAtDeadline` (F0a's store, group `verification`, admin only, source Q-22):
`enter_as_declared` (default: the form trusts the family; F4 lists the line as declared,
unverified) or `hold`.

---

## 2. Contracts this step provides

| For | What |
|---|---|
| every reservation path | `reserveLines(tx, { …InsertLinesInput, lines: ReservationLineType[], declaredBy: 'family' \| 'desk', channel: 'app' \| 'desk' \| 'imported' \| null })` (`reservation.services.ts`), inside the caller's transaction after `assertMayRegisterForInTx` |
| C (charges at the checkout and the desk) | `consentStanding(executor, ids)` → `{ missing, schoolOnly }`; `writeConsents(tx, ids, { channel, confirmedBy })`; the sentences `CONSENT_MISSING_REFUSAL`, `FAMILY_CONSENT_NEEDED` |
| C (`refundFor`) | `refundForSystemDrop(line, at, { boardSent })` in `reservation.services.ts` is the one seam where a system drop on a declared sitting computes its refund: today's computation (the windows' percentage of the whole price) until C's `refundFor` lands; C replaces its body |
| C (the statement's charges) | `statementFor` returns `charges: []` per student — the extension point C fills (price, paid, outstanding, due); the totals already add it |
| D (reminders) | the To verify list (`listToVerify`) for the coordinator's `declared_retakes_to_verify` rule; the statement's `dueAt` / `overdueDays` per line |
| F4 | `registration.declaration_rejected` (enter as a first entry), `prior_sitting_verified_outcome`, `prior_centre`, `prior_candidate_number`; `prior_sitting_source` |
| F7 | `reserveLines(..., channel: 'imported')` writes the sheet's confirmation as consent rows |

---

## 3. Declared sittings and their verification (§3.5)

… (filled as built: see §8 progress log)

## 4. The teacher on a line

…

## 5. The statement

…

## 6. The screens

…

## 7. Tests

…

## 8. Decisions and why

…

## 9. Deferred, and why

…

## 10. For the lead (A's contract, C's scope)

…

## 11. Questions for the owner

…

## 12. Progress log

- 2026-10-07 22:12Z — worktree and branch from A's 5367cf8; git through plumbing from lead-env
  (trail); env files for API 3111, web 3110, `igcse_rwb_dev`.
- 22:27Z — fast-forwarded to A's 27e3233; 22:30Z baseline suite green there (25 files, 341
  passed, 1 todo).
- 22:38Z — migrations 0044 (generated) and 0045 (custom consent guard).
- 22:55Z — API: lines and consent on every path, verification, the teacher change, the statement,
  the hold step; `/registrations/available` removed.
- 23:02Z–23:10Z — the suites converted to lines and consent (`reservationOf`, `swapTo`); 04 rows,
  08f's setting, 09's reasons and B's 09 block. Run 1 (before 04/08f/09 edits): 23 of 25 files
  green; 04 and 08f green alone after.
- 23:1xZ — commit 918b82c (API milestone, not pushed: the web pages still send `subjectIds`).
- next: 08o, the 08t races, the 05 cases; then the web (desk, register, statement, Money and To
  verify tabs, the swap dialog).
