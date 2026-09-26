# Archive

Documents that no longer describe the system, kept for their history. They were moved here
with `git mv` on 27 Sep 2026, so `git log --follow` still shows how each one evolved. Nothing
here is current; the root of the repository holds what is. Some code comments still cite ids
from these plans (for example M-10, L-8, OI-010, or "DEVELOPMENT_PLAN §Step 4.4"); the files
below are where those ids are defined.

| File | What it was | Replaced by |
|---|---|---|
| `CONTEXT.md` | Knowledge transfer for the starter template this repo was built from (Dec 2025), with the template's own roadmap. | `CLAUDE.md` and `PATTERNS.md` for conventions. The template roadmap does not apply. |
| `DEVELOPMENT_PLAN.md` | The first plan to implement URD v2 (Jan 2026). | Built. `V3_PLAN.md`, then `STRATEGY.md`. |
| `FIX_AND_COMPLETION_PLAN.md` | Fix plan from a 64-finding code-reading audit (Apr 2026). | `IMPLEMENTATION_PLAN.md`, by its own header. |
| `IMPLEMENTATION_PLAN.md` | Plan v3.1 from a 77-story code-reading audit (8 Apr 2026). | `V3_PLAN.md`, and the runtime `FOUNDATION_AUDIT.md`. |
| `PROJECT_LOG.md` | Activity log (ACT-nnn entries) up to March 2026. | Git history and the `.audit/*.tsv` decision trails. |
| `TESTING_GUIDE.md` | Manual click-through test guide v2.0 (Mar 2026); predates V3. | The integration suite in `apps/api/test` and `FOUNDATION_AUDIT.md`. |
| `GETTING_STARTED.md` | The starter template's setup guide. | `README.md`. |
| `DEPLOYMENT.md` | The starter template's Vercel and Render deployment guide. | Nothing yet: there is no deployment. See `STRATEGY.md` §8. |

Deleted outright on the same day, still in git history:

- `render.yaml` — a Render blueprint copied from a different project. It held no secrets.
- `setup.sh` — the starter template's setup script, which pointed at the documents above.

`AI_CONTEXT.md` was never tracked (it is in `.gitignore`), so an old checkout may still hold a
stale copy at its root. Delete it; `CLAUDE.md` is the agent context now.
