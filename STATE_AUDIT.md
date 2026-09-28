# State-and-Time Audit — Phase 1.3

**Date:** 28 September 2026
**Scope:** STRATEGY.md Phase 1.3: a transition table for every state machine (registration,
payment, receipt, change request, remark, session, refund request, exception, parent–student
link, scheduled announcement); what the scheduler does on its own (open, close, finalise,
capture, grade progression, deadlines, announcements); the 1 July rollover; two people or
processes acting on one row at once. Inherited from the money audit: MO-20 (approve, reject
and swap check the session's status only) and MO-1 (audit rows written after the commit).
**Method:** every write of a `status` column was inventoried with its guard, its lock, its
transaction and where its audit row is written (70 transitions over 10 tables; produced
read-only on Opus 5.5 and checked in the code for every finding acted on — §2). Each suspected
defect was then reproduced as a failing scenario through the API before it was fixed, in
`apps/api/test/08b-state-and-time.test.ts`; races are fired at once on separate connections,
and a race that needs an exact interleaving is swept across it. Each fix was undone once
more to see its test fail (trail: "control" rows). Evidence and the red run are in the
git-ignored `.audit/state-audit-evidence/`; decisions in `.audit/state-audit.tsv`. An
independent review on Opus 5.5 found gaps in two of the new automatic behaviours and weak spots
in the tests; all are acted on (§4b).

---

## 1. Headline

**The state machines are guarded one row at a time; the defects are where two of them meet,
and where the scheduler was trusted to run once.** Most transitions are status-guarded
updates, and the money paths lock what they read (money audit). What broke was a transition
on one table that decided from another without a lock (a remark cancelled while its fee was
being checked; an approval reverted while its checkout committed), checks with nothing behind
them in the database (the school fee, Cambridge's one enquiry), and scheduler steps that ran
once and were never retried (a close's finalisation, a session's preregistration capture).

**Thirteen findings: three high, five medium, four low, one for the owner.** The high ones
move money wrongly: a family can pay a remark fee for a request that was cancelled (ST-01),
the school fee can be taken twice (ST-02), and a checkout can leave an open payment, with its
escrow, on a request sent back to "awaiting approval" (ST-03). Twelve are fixed. Ten have a test
that fails with the fix undone; nine of those were first reproduced failing before any fix (the
red run), and ST-06's recovery tests were written with the sweep, shown red by disabling it; the
two races that need an exact interleaving are ordered on purpose, so they fail every time without
their fix. ST-05, ST-12 and ST-06's guarded activation rest on reasoning. ST-13 — grades move when
a registration window closes, not with the school year — is the owner's decision (§6); automatic
progression is off until then.

A fourteenth, ST-14 (medium: a paid subject's receipt could be voided, leaving the family no
proof of payment), was found by the SO-1 follow-up and is fixed (§8).

---

## 2. The state machines

Guard: **SG** status-guarded update (the WHERE names the from-status) · **RL** row locked, then
judged · **—** unguarded before this audit. "Audit" is where the transition's audit row is
written. Only the transitions this audit changed or relies on are listed per row group; the full
inventory is in the session transcript (summarised in `.audit/state-audit.tsv`).

| Machine | States | Transitions (who) | Guards | Audit |
|---|---|---|---|---|
| Registration | pending_approval, pending_payment, preregistered, confirmed, dropped_pending_receipt, dropped, rejected, expired | request / direct / desk / override / swap / preregister create; approve, revert, reject (parent); confirm (finance); expire at close, at the entry deadline, at graduation, with a failed checkout; drop and parked drop; capture on opening; refund at a never-opened series' deadline | SG throughout; money paths RL; revert now RL (ST-03) | money paths in the transaction; the rest in the route after the commit (MO-1, §5) |
| Payment | pending, pending_verification, completed, failed, refunded | initiate (parent, desk, school fee, remark); reference; confirm; fail, cancel, reject; reverse; lapse and entry-deadline sweeps | RL + SG | in the transaction, except initiation (MO-1) |
| Receipt | pending_issue, issued, return_required, returned, lost, void | born at confirmation (reissued after a reversal); issue; parked by a drop; return, lost, void (finance); void at reversal | SG; return/lost/void now one transaction with the parked refund (ST-05) | route, after the commit (MO-1) |
| Change request | pending_approval, approved, rejected, cancelled | request drop or swap (student); approve, reject (parent); cancel (student); rejected at close and at graduation | SG; cancel now refuses a no-op (ST-11) | route, after |
| Remark request | pending_approval, pending_consent, pending_payment, awaiting_submission, submitted, outcome_recorded, rejected, cancelled | create (student or parent); decide; consent; pay; fee confirmed; submitted; outcome; cancel | SG; the fee's confirmation now moves it in the payment's transaction under a lock (ST-01); the one-enquiry rule is judged under the registration's lock (ST-08) | fee confirmation in the transaction; the rest in the route |
| Session | draft, active, closed | create; activate (admin, scheduler); extend; set the entry deadline; close (admin, scheduler) and finalise | SG; scheduled activation now SG (ST-06); finalisation recorded (`finalized_at`) and recovered | route or job, after |
| Refund request | pending, partially_fulfilled, fulfilled, rejected | request (parent); hand-over, reject, approve (finance) | RL + SG (money audit) | in the transaction |
| Exception | active, revoked | grant, revoke | SG | route, after |
| Parent–student link | pending, approved, rejected | request (parent); answer (student); desk onboarding | answer now SG (ST-09); onboarding now picks the live link (ST-10) | route, after |
| Scheduled announcement | pending, sent, failed, cancelled | schedule; cancel; dispatch | cancel SG; dispatch now claims first (ST-12) | dispatch after sending |

No status is unreachable. Terminal states: registration dropped/rejected/expired; payment
failed/refunded; receipt returned/lost; change request approved/rejected/cancelled; remark
outcome_recorded/rejected/cancelled; session closed; refund request fulfilled/rejected;
exception revoked; link approved (a rejected link stays as history); announcement
sent/failed/cancelled. A void receipt is reborn only as a reissue on a new payment (MA-20).

---

## 3. What happens on its own

The scheduler runs one tick a minute in the API process (`jobs/session-closer.ts`), one tick at
a time:

1. **Close** active sessions whose window has ended, then **finalise** each (expire what is
   left, reject pending change requests, fail unpaid checkouts, keep InstaPay checkouts inside
   their grace, tell each student), then **grade progression** once per series type and year.
2. **Recovery** (new, ST-06): finalise any closed session whose finalisation never completed;
   capture preregistrations still waiting in any open session.
3. **Open** drafts whose start has come and whose window has not ended; capture their
   preregistrations; announce them.
4. **Reminders** 24 hours before a close; **scheduled announcements**; **payment deadlines**
   (the InstaPay grace, the board's entry deadline, a never-opened series' refund); the legacy
   Fawry expiry.

Every step is idempotent, so a missed tick costs nothing, and every step that can fail on its
own row now retries on the next tick. The scheduler assumes **one API process**: a second
instance would run the same tick at the same time (documented in the job; multi-instance needs
an advisory lock — §5).

**The 1 July rollover.** The academic year runs 1 July to 30 June (`academicYearForDate`). It
decides which year's school fee a registration needs and which year the desk collects — the desk
can name the year, because around 1 July the year a registration needs is not the year today falls
in. Nothing else turns over on 1 July: **grades move when registration windows close** (ST-13).

---

## 4. Findings

| ID | Sev | Finding | Fix | Test |
|---|---|---|---|---|
| **ST-01** | **High** | A parent could cancel a remark request while its fee transfer was being checked; finance then confirmed the payment and the family had paid for a cancelled request, with nothing to show and no refund path (a remark payment cannot be reversed). The request's move to "awaiting submission" also ran after the payment's commit and swallowed errors, so a completed fee could leave its request awaiting payment — payable again. | Cancelling locks the request and refuses while a fee payment is open. Confirmation moves the request inside its own transaction, under the request's lock, and refuses a fee whose request no longer awaits payment ("reject the transfer instead"). Starting a payment re-checks the request under its lock. | `08b` "a remark request and its fee" (both scenarios) |
| **ST-02** | **High** | The school fee could be taken twice: two officers collecting at the same moment both succeeded, and the desk collected it while the family's own transfer for it was being checked. Nothing locked or constrained it. | A unique index: one open or paid school fee per student per academic year (migration 0032). The desk refuses, with a sentence, while the family's checkout for it is open; any conflict reads as a sentence, not SQL. | `08b` "the school fee" (two officers at once; the desk while a transfer is checked; the database refuses a second one) |
| **ST-03** | **High** | A parent reverting an approval while checking out the same subject could leave an open payment — with its escrow — on a registration back in "awaiting approval" (3 of 8 swept races before the fix). The revert re-read "no payment" without the lock the checkout takes. | The revert locks the registrations (in id order, as the checkout now does) before re-reading. | `08b` "a parent reverting an approval while checking out" (16 swept races) |
| ST-04 | Medium | A student who graduated with a checkout open had the registration expired and the payment left open, with the escrow it took, on a registration nothing could pay: finance could only reject it by hand. | Graduation expires only what a close would: a registration held by a transfer being checked, or by an InstaPay checkout inside its grace, is kept (a November close keeps them, and graduation runs on the same tick). After the graduation commits, every checkout left on a registration it did expire is failed by the system — escrow back, audited, the family told — and an error there never escapes into the grade change: the recovery sweep closes any payment left on registrations that have all expired. Both the scheduler's progression and the admin's manual graduation. | `08b` "a student who graduates with a checkout open" (closed, escrow back, family told; a checked transfer kept); `08b` stranded payment; `09` "an open payment never covers … only registrations that have expired" |
| ST-05 | Medium | A receipt's return, loss or write-off committed on its own, and the parked drop's refund was credited in a separate transaction afterwards: a failure there left the receipt returned, the registration waiting and the refund never credited, with nothing to retry it. | One transaction for the receipt and the parked refund; the family's notice after the commit. | By reasoning; the return and write-off paths are exercised by `01`, `08` and `09` |
| ST-06 | Medium | The scheduler trusted itself to run once. A close whose finalisation failed (or a process stopped in between) was never finished — its registrations stayed waiting in a closed session. Preregistration capture ran only for sessions opened on that same tick, so a failed capture (or a preregistration made while the session opened) stayed preregistered in an open session, its held money stranded. Scheduled activation was an unguarded update that could reopen a session an admin had just closed, and one clash aborted the tick after its closes had committed. A manual close whose finalisation threw returned an error without its audit row. | `finalized_at` on each session (migration 0033, backfilled for sessions already closed); a recovery sweep every tick finalises closed sessions without it, captures preregistrations waiting in open ones, and closes payments left on registrations that have all expired; finalisation touches only registrations and checkouts that existed when the window closed, so a late or repeated run never expires a registration a student with a deadline extension made since (a checkout started since on an older registration is still failed with it, as at an on-time close); activation is status-guarded, one draft at a time; a manual close logs and leaves a failed finalisation to the sweep. | `08b` "the scheduler finishes what a close or an opening left undone" (an interrupted close, finished once, sparing an extension student's later registration and checkout; an uncaptured opening; a stranded payment) |
| ST-07 | Medium | MO-20: a student with a deadline extension could request a subject after the close, and the parent could then neither approve nor reject it — both checked the session's status alone — so it sat until the entry deadline, or forever without one. | Approval asks the same window as the request (a deadline extension counts). A rejection is allowed whatever the window. | `08b` "after the close, a student with a deadline extension" (approved and rejected; a request left when the extension runs out can be rejected, not approved) |
| ST-08 | Medium | Cambridge's one-enquiry rule (and OxfordAQA's one review per paper) was checked before the insert without a lock: three remark requests at once for one result were all accepted. | The rules are judged inside the insert's transaction, under the registration's lock. | `08b` "two remark requests for one Cambridge result at once" |
| ST-09 | Low | A student answering a link request twice at once (approve and reject) had both accepted, the second overwriting the first after the parent had been told. | The answer is status-guarded; the second is told the request was already answered. | `08b` "a student answering one link request twice at once" |
| ST-10 | Low | Desk onboarding picked any link for the pair — a rejected one included — and flipped it, so a family with a rejected request and a pending one could not be enrolled (a unique-index error). | Onboarding takes the live link (pending or approved): approves a pending one, creates one when only rejected ones exist; a rejected request stays as history. | `08b` "the desk enrolls a family whose first link request was rejected" |
| ST-11 | Low | Cancelling a change request that was already cancelled or decided reported success (the update matched nothing, and the route still audited a cancellation). | A no-op is refused with a sentence. | `08b` "a change request cancelled twice at once" |
| ST-12 | Low | A scheduled announcement was sent before it was claimed: an admin's cancel in between was overwritten to "sent", a second scheduler instance would send it twice, and a failure after sending marked it failed. | The dispatch claims it first (pending → sent, status-guarded); a failed dispatch marks it failed only if it still holds the claim. | By reasoning |
| ST-14 | Medium | A finance admin could void the receipt of a subject still paid for (confirmed, or a paid preregistration), through the API; the Workbench offers only "lost". Nothing reissues it, and the desk never offers a void receipt (MA-20), so the family was left paid with no proof of payment. The design allows void only as the escape hatch for a dropped subject's paper. Found by SO-1's receipt scenario tripping `09`'s MA-20 rule. | Void is refused while the subject is paid for, judged under the registration's lock; a dropped subject's receipt can still be voided. | `08c` "a paid subject's receipt cannot be voided" |
| ST-13 | Owner | Grades move when a registration window closes — 10→11 at a November close, 11→12 at a June close, 12→graduated at a November close — once per series type and year, whichever level's window closes first. On the school's calendar a student advances twice in one academic year (10→11 around October, 11→12 before February) and is graduated at the next November close, in their real grade-11 year, after which every registration path refuses them; meanwhile the grade-10 core-subject mandate (A-05) never applies and the school fee is charged for the wrong grade. | **Stop-gap: automatic progression is off** (`AUTO_GRADE_PROGRESSION`, default false; admins adjust grades by hand) until the owner decides what a grade is (§6). The manual close now takes the same once-per-series claim as the scheduler (it called progression directly). | — |

**Also changed:** confirmation audits only the registrations it moves (a preregistration a
payment funds stays preregistered and was logged as confirmed); the paths that lock several
registrations or receipts by id — checkout, confirmation, revert, desk collection and reversal —
lock them in id order, so two of them cannot wait on each other (the bulk updates — expiry at a
close, at graduation and at an entry deadline, approve and reject — lock in scan order; a deadlock
there is detected and one side fails and is retried); a new audit action,
`REMARK_PAYMENT_CONFIRMED`, records the remark's move; refusals that are conflicts now answer 409
(a remark with a payment in progress, a school fee already in progress); an approval outside the
window now reads "Registration window is not open" (still 400). `09` gains two rules: an open
payment never covers a request awaiting approval or only expired registrations, and a confirmed
remark fee has always moved its request on.

## 4b. What the review changed

The Opus 5.5 review of the first commit (a58aa6f) said "don't merge yet":

1. **Graduation collided with the November close** (ST-04): it expired registrations the close
   had just kept for a family who may have paid, and the new code then failed their payments.
   Graduation now keeps what a close keeps; the family is told when a payment is closed.
2. **An error closing payments after graduation escaped after the grades had committed**,
   skipping the cohort's audit rows and notices, with nothing to retry it. It is now caught per
   payment and never escapes; the recovery sweep closes any payment left on expired registrations.
3. **A late finalisation hit students with deadline extensions** (ST-06): re-run by the sweep, it
   expired what they had registered since the close. Finalisation now touches only what existed at
   the close.
4. **ST-13 was understated** (a double advance in one year, graduation a year early), and "nothing
   depends on it" was wrong once graduation fails payments. Automatic progression is off until the
   owner decides.
5. **Tests weaker than the report read:** the revert race (ST-03) and the cancel-versus-pay race
   (ST-01, in both orders) are now ordered on purpose — a test connection holds the row's lock
   while the requests queue behind it, and the test waits until the database shows them waiting —
   so each fails every time without its fix; the school-fee check asserts a unique violation, not
   any error; the rejection has its own case and control.
6. **The lock-order sentence overclaimed:** desk collection and reversal now lock in id order too.
7. **No new invariants** — two added to `09`.
8. Migration 0032 was checked against the dev database (no duplicate school fees) before it ran;
   there is no production data.

The confirmation review (of f05f2d5) approved the merge and corrected one claim: cancel's own lock
on the remark request is not belt and braces. With the payment first, only that lock makes the
cancellation see the payment; the payment start's re-check covers the other order. Both orders now
have a test, each red with its lock or re-check removed. Its other notes are folded in above (the
ST-06 and lock-order wording, SO-2, SO-7), and `08b` asserts that nothing is stranded before its
first recovery sweep, so the sweep cannot hide an earlier suite's fault from `09`.

---

## 5. Handed on and accepted

| ID | Observation | Owner |
|---|---|---|
| SO-1 | **MO-1 remainder.** Payment and school-fee initiation, remark-payment initiation, drops, swaps, receipt hand-overs, returns and write-offs, escrow transfers and refund requests still write their audit rows in the route after the commit; system transitions (expiry at a close, at an entry deadline and at graduation, capture, change requests rejected at a close) write none. Moved into their transactions in a follow-up effort, after this audit merges. | **Done** (§8) |
| SO-2 | A registration created at the very moment its session closes (its window read before the close, its insert transaction starting after the close) stays waiting in the closed session until the entry-deadline sweep, or indefinitely without a deadline. Narrow; closing it needs a session lock on six creation paths. | Accepted, low |
| SO-3 | A change request created while its registration is being dropped fails at approval and waits until the close. | Accepted, low |
| SO-4 | A graduated student's preregistrations for a later series stay preregistered, their held money held; they can be cancelled at the refund window's rate. Like MO-21, the owner may want a full refund. | Owner decision |
| SO-5 | The scheduler assumes one API process; a second instance runs the same tick concurrently. Every step is status-guarded or claimed, but notifications could be sent twice. | Deployment checklist |
| SO-6 | Non-money transitions (links, exceptions, change requests, sessions) are audited in the route after the commit, and a failed audit insert is only logged. | Engineering health |
| SO-8 | A receipt printed wrong for a subject still paid for cannot be replaced: void is refused for it (ST-14), and nothing reissues a receipt except paying again after a reversal (MA-20's `…-R2`). The desk needs a "reissue" if misprints happen. | Owner decision (desk workflow) |
| SO-7 | After a manual graduation in an open window, a registration kept for a transfer being checked stays waiting if that transfer is then rejected, and can be paid again: the checkout path does not check graduation. Manual-only while automatic progression is off. | Accepted, low |

---

## 6. For the owner: what is a student's grade?

Today a grade is one number on the student, moved by registration windows closing: a
November close moves grade 10 to 11 and graduates grade 12; a June close moves 11 to 12
(URD GRADE-001). With one window per series and level, the first window of a series type to
close in a year moves everyone. Consequences, in the school's calendar (September–June):

- A student who starts grade 10 in September becomes grade 11 at the November close (about
  October) — before the June window where grade 10 registers with its core subjects locked
  (A-05). The core-subject rule then never applies to them.
- The school fee is per academic year and grade; a student recorded a grade ahead pays the
  wrong grade's fee.
- A grade-12 student graduates at the November close; "graduated" blocks new registrations,
  so the November sitting after graduation depends on the close's timing.

Worse, the first window of a series type to close advances everyone, so on the school's
calendar a student goes 10→11 around October and 11→12 before February — two grades in one
academic year — and is graduated at the next November close, in their real grade-11 year; every
registration path then refuses them.

**Stop-gap (reversible, in this audit):** automatic progression is off by default
(`AUTO_GRADE_PROGRESSION=false`); a close stamps its progression done without moving anyone, and
admins adjust grades by hand. Graduation's effects on payments (ST-04) therefore only follow a
manual graduation until the owner decides. Closes that happen while it is off stay stamped done:
turning it on later moves no one for them.

**Recommendation:** store the year a student entered grade 10 (or will graduate), and derive
the grade from the academic year of the session being registered for (1 July boundary, as the
school fee already does). No progression job, no double advance, and a registration for a
June series knows the student's grade that year. Graduation then means "past grade 12 for this
academic year", and the owner decides whether the November after it stays open to them. This
changes the student model and the grade screens, so it waits for the owner's answer.


---

## 8. Follow-up: SO-1, every money movement commits with its audit row

**Date:** 28 September 2026. Branch `so1-audit-in-tx`. Decisions in `.audit/state-audit.tsv`.

**What moved.** The seventeen money actions that wrote their audit row in the route after the
commit now write it in their service's transaction (`logAction(..., tx)`), and the route's
`.catch` that swallowed a failed insert is gone: payment initiation, a transfer reference, desk
registration, the school fee (the family's checkout and the desk's collection), the remark fee's
checkout and its refund with the outcome, direct drops and swaps, a change request's approval,
a preregistration cancelled, receipts handed over, brought back, lost and voided, escrow
transfers and refund requests. Four that had no transaction now have one (the reference, the
hand-over, the school fee's checkout and its desk payment). System transitions now write rows
too, in the same transaction as the move: a new action, `REGISTRATION_EXPIRED` (reason: the
close, the entry deadline, graduation, a failed checkout after its window, an unfunded
preregistration at the deadline), `CHANGE_REQUEST_REJECTED` for rejections at a close and at
graduation, and `PREREG_CAPTURED` at an opening. A bulk helper (`logActions`) writes a sweep's
rows in one insert.

**Proof.** `08c-audit-in-transaction` makes the database refuse one action's audit row (a
trigger, dropped afterwards), fires the real request, and checks that it failed and that nothing
moved — no escrow, no payment, no status — then allows the row and sees the same request succeed
with exactly one row. For the close and the opening, the step fails and the recovery sweep
finishes it once the row is allowed. With each row written outside the transaction and its
failure swallowed (the old route behaviour), each of the 17 audit scenarios fails for its own
reason (the eighteenth test is ST-14's guard; trail: "control" rows). `09` gains four rules over every row the suite leaves: each
payment has exactly one creation row, whichever path made it; each expired registration has
exactly one expiry row; each capture of held money, escrow transfer and refund request has its
row, for the same amount; each receipt handed over, brought back or lost has exactly one row.
Each was shown red with its write removed. Escrow transfers had no scenario at all before this;
`08c` adds one (both ledger rows and the audit row, or nothing).

**Found on the way: ST-14** (§4) — the receipt scenario voided a paid subject's receipt, which
`09`'s MA-20 rule caught; the service allowed it. SO-8 (§5) is the desk question it leaves.

**On the running system** (dev database, the API restarted on this code): a parent's refund
request, a desk registration with cash and its receipt's hand-over each wrote their row with
the actor and the connection address, now passed into the service; the admin Audit Log lists
them; a finance admin's void of that paid receipt was refused with its sentence and wrote
nothing. The dev database was two migrations behind (0032, 0033) and was migrated first. The
Audit Log's table keyed its inner row rather than the fragment around it (a React warning in
development); fixed.

**Still after the commit:** non-money transitions (SO-6: links, exceptions, change-request
creation, rejection and cancellation by a family, sessions opened and closed by hand, remark
requests and their approval, results); a failed insert there is logged, not fatal.

---

## 7. Reproduce

```bash
pnpm --filter @repo/api test                     # the whole suite; 08b is this audit
pnpm --filter @repo/api test -- test/08b-state-and-time.test.ts
```

The red run before the fixes is `.audit/state-audit-evidence/red-before-fixes.log`.
