# Desk-First UX Audit

**Date:** 1 August 2026
**Trigger:** The staff's core requirement — "minimum skills, minimum thinking; if it's
harder than Excel, what's the point" — was written into V3_PLAN §1 but not genuinely
applied. This audit re-examines the whole system against that goal, persona by persona,
scenario by scenario, and derives a corrective program.

---

## 1. The structural finding: the system is app-first; the school is desk-first

Every V3 flow assumes the **parent self-serves online**: parents sign up, link children,
register, initiate payments, submit InstaPay references. Staff only *react* (confirm,
verify, hand receipts).

That is backwards for this school. The staff's Excel sheet works because **the desk is
the system**: a parent walks in, talks to a person, and that person does everything —
enrolls the family, registers the subjects, takes the money, writes the receipt, fixes
mistakes. In an Egyptian school context a large share of parents will *never* open the
web app; the app-only assumption makes the system unusable for exactly the people the
staff deal with daily.

**Corrective principle: everything a parent can do in the app, staff must be able to do
on the family's behalf, from one screen, in fewer steps than Excel.** The app remains
the self-serve channel for parents who want it; the desk is the primary channel.

Concrete proof-points of the gap (verified in code):

- Registration endpoints accept only the student/parent (admin-override exists but is
  labeled exceptional and buried). **Staff cannot register a walk-in family.**
- Staff cannot create accounts at all (until the team page lands, not even staff
  accounts). **Walk-in onboarding is impossible** — parent+student account creation and
  linking are entirely self-serve (link even needs the *student* to approve from their
  own login — unusable at a desk with a parent standing there).
- The Finance Workbench shows only *pending* items. Ask "what is Ahmed registered in,
  what has he paid, what does he owe?" and **no staff screen answers it.** Staff would
  open five pages (registrations? payments? escrow? receipts? school fee?) — Excel
  answers it with one ctrl-F.
- The system *tracks* physical receipts but **cannot print one.** Staff must hand-write
  the paper the whole receipt feature revolves around.
- **No end-of-day view.** An officer closing the cash drawer cannot see "today's
  confirmed payments by instrument" to reconcile against the cash box — the single most
  routine finance task there is.
- Fees/config errors surface to the wrong person: a parent hitting "remark fee not
  configured — ask the school" is the school finding out about its own missing setup
  from an angry parent. **No setup checklist tells the admin what's unconfigured.**

## 2. Persona walk-throughs and the gaps they expose

### Finance officer (the desk, all day)
| Real scenario | Today | Gap |
|---|---|---|
| Parent walks in to register + pay for subjects | Impossible unless parent pre-initiated in app | **G1 — Desk registration:** pick student → subjects (same pricing pipeline) → registrations created *and* in-school payment recorded in one action |
| "What does my child owe / have?" | No single view | **G2 — Student 360:** one search-first page: registrations w/ receipt status, payments, escrow (free+held), school fee, exceptions, remarks — with desk actions inline |
| Hand the parent the paper receipt | Hand-written | **G3 — Printable receipt:** per-subject printable/PDF receipt carrying the tracked receiptNumber |
| Close the cash drawer | Nothing | **G4 — Daily takings:** today's confirmed payments by instrument + officer, printable |
| New family enrolls at the desk | Impossible | **G5 — Desk onboarding:** staff create parent+student accounts and an *approved* link in one form (no student-login approval loop when staff vouch in person) |
| Made a mistake confirming | Irreversible | **G6 — Corrections:** finance-admin payment reversal (audited), matching Excel's "just fix the cell" flexibility |

### Finance admin
- **G7 — Team management:** create staff accounts, assign roles, in the UI. (User's example.)
- Approvals (withdrawals) live in the workbench ✓; exceptions/fees pages exist ✓ but are
  admin-nav only — finance-admin nav should surface school fees, refund windows,
  exceptions too (**G8 — role-appropriate nav**).

### School admin
- **G9 — Setup checklist** on the dashboard: sessions, subjects+fees, teachers linked,
  school-fee schedule, refund windows, remark fees — with "not configured" warnings
  *before* parents hit them.
- **G10 — Excel bridges:** subjects CSV import (the price list already exists as a
  spreadsheet), teachers bulk add, results paste-from-Excel, CSV export on admin grids.
- **G11 — People admin:** no UI lists users or manages parent-student links (endpoints
  exist). Folds into G2/G5/G7.

### Parent (self-serve channel)
- **G12 — Register→pay in one flow:** direct registration success should flow straight
  into checkout with those registrations selected — today the parent must navigate to
  Registrations, re-find the rows, tick them, and click pay.
- **G13 — Arabic coverage:** all new V3 screens are English-first; the i18n dictionary
  needs the new staff/parent strings (the DOM-translator only covers known phrases).

### Student
- Read-mostly; no material gaps beyond G13.

## 3. The corrective program (build order)

**Tier 1 — the desk (the structural fix):**
1. G7 Team management (staff accounts + roles) — unlocks everything else
2. G5 Desk onboarding (parent+student+approved link in one form)
3. G1 Desk registration + immediate in-school payment
4. G2 Student 360 page (search-first; the desk's home)
5. G3 Printable subject receipts

**Tier 2 — daily operations:**
6. G4 Daily takings report
7. G8 Finance-admin nav (fees/windows/exceptions surfaced)
8. G9 Admin setup checklist
9. G12 Register→pay handoff

**Tier 3 — Excel bridges & polish:**
10. G10 CSV import/export (subjects, teachers, results paste)
11. G13 Arabic strings for new screens
12. G6 Audited payment reversal (finance admin)

## 4. Standing test for all future work

Before shipping any staff-facing feature, answer: *"Describe the Excel/paper version of
this task. Is our flow fewer steps, with less to remember, for a first-day employee?"*
If not, it isn't done. This file is the reference for that bar.
