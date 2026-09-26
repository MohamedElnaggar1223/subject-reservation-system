# Reviews to run on Opus 5.5

The session of 26 Sep 2026 could not spawn Opus 5.5 (the reviewer definition was created
mid-session and Claude Code only loads a new `agents` directory at start-up). Two earlier
reviews were done by other models and the owner asked for them to be redone on Opus 5.5;
a third (the harness) was never completed. In a fresh session, spawn each prompt below with
`subagent_type: "opus-55-reviewer"` and no `model` argument, in the background, and act on
the flags. Each reviewer must end with a line naming its model; if it is not Opus 5.5, stop.

Transcript for all three (grep it, never read it whole):
`~/.claude/projects/-Users-mohamedelnaggar-Coding-subject-reservation-system--claude-worktrees-project-understanding-report-ffa09b/57ec7ec2-59d9-44ce-a8b0-bf00b50e33e0.jsonl`

## 1. Foundation trail (first done by Opus 5)

Review `.audit/foundation-audit.tsv` (56 rows; 1–41 the run, 42–56 answers to the first
review) against `FOUNDATION_AUDIT.md` §1–8 and §10 and the transcript (run spans ~16:11–16:32
UTC in row timestamps; grep hex ids, `RCP-`, `/v1/registrations/desk`, `SESSION_AUTO_CLOSED`).
Judge: rows whose evidence does not prove the decision; "green" checkpoints without a command
and output; RF-01..RF-10 severities; whether rows 42–56 resolve or merely acknowledge the first
review (especially rows 53 and 55); forks or abandoned approaches in the transcript missing
from the trail; report claims the trail does not support.

## 2. Spine fixes (first done by Opus 4.6)

Review commits `2444a0f` and `25b51ef` with `.audit/spine-fixes.tsv` and rows 42–56 of the
foundation trail; findings in `FOUNDATION_AUDIT.md` §4, fixes and corrections in §9. Grep the
transcript for `RF-07`, `resolvePayerParent`, `getSchoolFeeStanding`, `PAYMENT_REVERSED`,
`clientMessage`, `SEED_REGISTRATION_FEE`, `14e987ec`, `igcse_seed_check`,
`collectSchoolFeeAtDesk`, `onError`. Judge: edge cases (several linked parents; none;
`clientMessage` hiding a legitimate message; the seed CASE expression; `voidedReceiptNumbers`
computed before the voiding transaction; an unscoped `fee_waiver` settling every year);
whether each "verified" row is backed by a command and output; whether RF-07 is complete after
the second commit and whether the global `onError` can leak; anything changed that neither
trail nor §9 records.

## 3. Test harness and response typing (never completed)

Review commit `99d4f66` in full and the parts of `25b51ef` touching
`apps/api/src/lib/response.ts`, `apps/api/src/lib/auth.ts`,
`apps/api/src/services/swap.services.ts` and `apps/web/**`, with `.audit/test-harness.tsv`,
`FOUNDATION_AUDIT.md` §9 (RH-01, RH-02, "Tests") and `apps/api/test/README.md`. Grep the
transcript for `RH-02`, `JSONParsed`, `SuccessResponse`, `nextCookies`, `next/headers`,
`fetchParentChangeRequests`, `heldBalance`, `ByNameSequencer`, `igcse_test`, `19 passed`,
`WEB_EXIT=0`, `CT_EXIT=0`. Judge: whether `SuccessResponse`/`ErrorResponse` (asserted with
`as unknown as`) let a handler claim a type it does not return, whether role-dependent routes
type honestly, whether the status generic is sound; whether fetcher-derived types or the escrow
union narrowing changed runtime behaviour or hide a mismatch, and whether the 38 remaining
manual `useQuery<>` generics are a risk; harness isolation (shared database and day, one active
session per type/level), `DROP DATABASE` in global setup, whether tests assert literal outcomes,
whether "green" claims post-date the last edit; whether anything in `apps/web` relied on
`nextCookies()`; anything unrecorded.
