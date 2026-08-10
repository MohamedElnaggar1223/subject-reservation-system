# Project Audit — August 2026

**Scope:** whole system, with the frontend flow / ease-of-use as the centrepiece.
**Method:** parallel independent auditors reading the real code (not the docs) —
parent+student journeys, staff journeys, cross-cutting UI, and API security. Each UX
auditor scored journeys against the standing test in `UX_AUDIT.md` §4: *describe the
Excel/paper version of this task — is our flow fewer steps, with less to remember, for
a first-day user?*

**Headline:** the system was feature-complete but **operationally broken in four places
where nobody could complete their job at all**, and it carried two critical privilege
escalations. Journey scores before this pass: **Parent 4/10, Student 5/10**, staff Desk
unusable.

---

## 1. Critical — features that could not be used

| # | What was broken | Consequence | Status |
|---|---|---|---|
| C1 | Finance officers could not search students — `/desk` called admin-only `GET /users` and got a silent 403 with an **empty dropdown, no error** | The entire Desk (Student 360, register+collect, fee collection, receipts, printing) was unreachable for its primary persona. The same 403 emptied the exceptions student picker, so a finance_admin could not grant **any** exception — including the waivers other error messages tell them to use | ✅ Fixed — new field-limited `GET /users/search` for finance roles; failures and "no match" now surfaced |
| C2 | A child's drop/swap request was **invisible to the parent forever** — the approvals page early-returns when there are no pending *registrations*, and that branch omitted `ChangeRequestsSection`, under a banner reading "All Caught Up" | Refunds could never move; the copy asserted the opposite of the truth | ✅ Fixed |
| C3 | **Nothing printed correctly.** Receipts and takings render inside the app shell (full-height flex + `overflow-hidden`) and there was no print stylesheet | Receipts printed with the sidebar and clipped at one viewport; the takings sheet silently lost rows — in a system whose whole refund model is built on paper receipts | ✅ Fixed — `@media print` rules |
| C4 | Academic-year rollover (1 July): the desk chip, the registration gate, and the collect button each computed the year differently | Hard dead-end with no workaround — chip says "paid", registration demands a different year, the only button pays the year already settled | ✅ Fixed — explicit year on desk payment; summary reports every year actually owed |
| C5 | **Finance staff could mint admin accounts.** Finance roles held better-auth's `user` resource, and `/api/auth/admin/create-user` applies a *client-supplied role* verbatim | Total privilege escalation from desk staff to system admin | ✅ Fixed |
| C6 | **finance_admin could seize the admin account** via `/api/auth/admin/set-user-password` (no ownership check, no admin-target protection) — with `list-users` supplying the target id | One-request takeover of the highest-privilege account | ✅ Fixed |

## 2. High — wrong behaviour or significant pain

- **The desk overcharged.** `DeskRegisterCard` never sent `subjectOptions`, where the 50%
  outside-school rule and teacher choice live — so every desk registration charged **full
  price** for outside-school retakes and recorded no teacher. The desk was strictly weaker
  than the app it replaces. ✅ Fixed (per-subject outside-school + teacher controls).
- **The cash drawer could not be reconciled.** Daily takings showed money *in* only:
  reversed payments vanished from the report entirely (status flips to `refunded`) and cash
  refunds handed over at the same desk live in another table and never appeared. ✅ Fixed —
  money in / out / net with reversal and refund lines.
- **Families could not see the receipt their refund depends on** (finance-only route), while
  the drop dialog told them the refund arrives "once the receipt is returned". ✅ Fixed —
  scoped to the owning family, with the receipt number and an explicit instruction on the
  registration card.
- **`/school-fee` was in no role's navigation** despite gating all registration — the only
  way in was to *fail* at registering. ✅ Fixed.
- **Students were told to click a link that 403s them** ("share the approvals link"). ✅ Fixed.
- **Setup checklist called a DRAFT session "configured"** — clean checklist while nobody
  could register. ✅ Fixed.
- **CSV import silently corrupted prices.** Splitting on comma as well as tab shattered
  Excel's `15,000` into two cells and shifted every later column: the subject imported at
  **15 EGP**, no error. First symptom would be a parent paying 15 EGP. ✅ Fixed (tab-first
  splitting, thousands separators stripped, column-count validation, per-row reporting).
- **Results paste required an ID the school's spreadsheet doesn't have** (system-generated
  `STU-…`). ✅ Fixed — matches on name or ID, with an "Export Grid" to produce a matching sheet.
- **Auth had no rate limiting at all** (the limiter was built but commented out) — unlimited
  credential brute-force and reset-email spam. ✅ Fixed; API limiting also widened from 4
  route groups to all of v1.
- **Finance could dump the entire user table** (staff PII included) via `list-users`. ✅ Fixed.

## 3. Medium — friction and robustness

Fixed in this pass:
- 23 pages could not distinguish "failed to load" from "nothing here" — on finance screens
  an officer could conclude the drawer balances when data never loaded. Shared
  `LoadingState / ErrorState / EmptyState`; wired into the money screens first.
- Tables were **clipped** (`overflow-hidden`) rather than scrollable — the Amount and Grade
  columns were literally unreachable on narrow screens.
- The two audited-reason prompts used `window.prompt`: unstyled, untranslatable, unvalidated,
  and silently suppressed in kiosk browsers (returning `null` → the action no-ops).
  Replaced with a validating `ReasonModal`.
- Held escrow was invisible in the parent's children list — a parent who preregistered saw
  `0.00` and reasonably concluded the money had vanished.
- `[object Object]` rendered on the Add Child form (raw `fetch` bypassing the typed client).
- RTL: the sidebar collapse toggle used inline `left`, detaching it in Arabic.
- Admin had no personal account section; their "Notifications" pointed at the broadcast composer.
- Money grids were `grid-cols-3` unconditionally — three figures crushed into ~110px on a phone.
- Client CSV export lacked the formula-injection guard and escaping the server already had.
- Raw pg/driver errors (SQL fragments, column and constraint names) were echoed to clients.
- **Arabic:** measured ~35% coverage on the newer screens — including the *entire* remark
  consent warning and InstaPay flow. Added 66 strings covering desk, finance, takings,
  remarks, school fee, team, results, and the new home summary.

## 4. Built in response: the app-first home summary

The audits independently confirmed the gap I had flagged: **"what do we owe / what's next"
was answered nowhere**. New `GET /v1/users/me/home-summary` + dashboard card leads with
actions rather than links — pay the school fee, pay N EGP for registered subjects, approve
N requests, return a receipt to release a refund, link a child — each one click, with the
family's total outstanding and wallet (free + held) in one place.

## 5. Known open items (not yet done)

- **Runtime verification.** Everything here is typecheck- and build-verified only. The dev
  server was deliberately not started (user was running other work), and migrations
  **0020–0025 are still unapplied** — run `cd packages/db && pnpm db:migrate`.
- The local Postgres connection string in `apps/api/.env` fails with `SASL: client password
  must be a string`, which will block any runtime testing until fixed.
- **Modal accessibility**: 20+ modals still lack `role="dialog"`, focus trapping, and focus
  restore (the new `ReasonModal` has dialog semantics and Escape).
- **Formatting consistency**: `lib/format.ts` is used by only ~10 of 35 screens; the rest use
  `toFixed(2)` + a manual "EGP", so the same registration reads `1234.00 EGP` at checkout and
  `EGP 1,234` on the receipt. `Intl.NumberFormat('en-EG')` also forces Latin digits in Arabic.
- **Divergent status colours**: 8 separate `STATUS_STYLES` maps; `approved` is blue on one
  page and green on the adjacent one.
- **Orphan routes**: `/documents` and `/todos` are reachable by URL but in no nav — ship or delete.
- Remaining `window.confirm` sites (13 files) are translated by the i18n layer but still
  blocked in kiosk browsers.
- The rest of the original audit fleet (money-path correctness, state machines, data layer,
  frontend type drift, docs/config) was lost to API overload and has **not** been re-run.

## 6. Standing test

Unchanged, from `UX_AUDIT.md` §4 — before shipping any staff-facing feature: *describe the
Excel/paper version of this task. Is our flow fewer steps, with less to remember, for a
first-day employee?* If not, it isn't done.
