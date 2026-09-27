# Money-Correctness Audit — Phase 1.2

**Date:** 27 September 2026
**Scope:** STRATEGY.md Phase 1.2: ledger invariants over the whole database, refund windows
with real percentages, exception stacking (including a fixed discount larger than the price),
the escrow held at InstaPay initiation with no release path, the takings semantics (bank
transfers in the drawer figure, reversals rewriting a closed day), and the concurrency of
checkout, confirmation, reversal, drops and cash refunds. Plus O-7 from the security audit:
audit rows inside the money transaction.
**Method:** every money path was read end to end, then each suspected defect was reproduced
as a failing scenario through the API before it was fixed. Two new test files hold the result:
`08-money-rules.test.ts` (one scenario per rule, with concurrency fired as simultaneous
requests on separate connections) and `09-money-invariants.test.ts` (rules that must hold over
every row the whole suite leaves behind). Fixes were checked by undoing them, invariants by
corrupting rows, and the screens were driven in a real browser against the dev servers. An
independent review on Opus 5.5 then found four more defects on paths the first pass had read,
and several claims worded more strongly than the evidence; all are acted on below (§4).
Every decision and its evidence is in `.audit/money-audit.tsv`; the scripts, screenshots and
logs it cites are kept locally in `.audit/money-audit-evidence/` (git-ignored: they hold dev
test accounts).

---

## 1. Headline

**The ledger primitives are sound; the flows around them were not.** Every escrow movement
already went through an atomic, guarded debit or credit with its ledger row, and no scenario
could make a balance disagree with its ledger or go negative. The defects were in what the
flows decided to do with money, in the report the desk reconciles against, and in checks that
read a row and then wrote it without a lock.

**Nineteen findings: one high, fourteen medium, four low.** The high one: when a registration
window closed, the system failed every open payment, including InstaPay transfers the family
had already sent and referenced. The registration expired, the escrow came back, and nothing
could confirm the transfer afterwards. Among the medium ones: a takings report whose "net in
drawer" counted every reversal twice and included bank transfers; reversals and cash refunds
that rewrote or vanished from days already reconciled; races that recorded less cash than was
handed out or created refund money; a reversal that paid a family twice; preregistration money
stranded in the held wallet; a drop that refunded at once while the family held the paper
receipt; a second-approver check on cash refunds that could be bypassed; and a desk that could
not take money for a subject already registered. All nineteen are fixed, each with a test.

Two questions are the owner's (§5, MO-10 and MO-11): how long a family has to submit an
InstaPay reference after the close, and whether reversing a cash payment means cash was handed
back.

---

## 2. What was proven

| Area | How | Result |
|---|---|---|
| Ledger = balance | `09`, over every escrow the suite creates | Free and held balances equal their ledger sums; none negative |
| Escrow applied to a payment | `09` | Debited exactly once; given back exactly once when, and only when, the payment failed or was reversed |
| Payment = what it covers | `09` | Amount plus escrow applied equals the sum of the registration prices, for every registration payment |
| Price = fee split | `09` | Every registration price equals course fee plus registration fee |
| Paid once | `09` | No registration is covered by two completed payments; every confirmed one by exactly one |
| No money for nothing | `09` | A completed payment never covers a waiting, expired or rejected registration |
| Receipts | `09` | Every paid registration has its receipt; a parked drop has a receipt out waiting to return, refunding no more than the price |
| Held wallet | `09` | Held balance equals the prices of paid preregistrations still waiting for their session |
| Drops | `09` | No drop refunds more than the registration cost |
| Cash refunds | `09` | Cash handed over adds up to what each request says was released, never more than requested; an approval covers every hand-over made before it |
| Audit rows | `09` | Every completed, reversed or failed payment carries exactly its transition's audit rows |
| Refund windows | `08` | 50% window refunds 750 of 1500; a custom refund exception (90%) overrides it; a gap between configured windows refunds 0; with none configured, 100% |
| Exception stacking | `08` | 20% and 10% multiply (1500 → 1080, split 720 + 360); a fixed 100 comes off the course fee (980); a fixed discount larger than the price makes it 0, never negative |
| Concurrency | `08` | Four simultaneous checkouts of one subject: one payment, escrow taken once. Three officers confirming one transfer: one confirmation, one receipt, one audit row, the others 409. Confirm against reject, and cancel against confirm: one wins, escrow matches the winner. Two officers paying out one refund: one recorded. A partial hand-over racing a rejection: no money created. A drop racing its receipt's hand-over, swept across the drop's transaction: never a refund for paper the family holds. A drop racing a reversal: one wins with a clean refusal |
| Screens | headless Chrome on the dev servers | Parent cancels a checkout and the escrow returns; a returning parent sees the checkout they started, with its subjects; the officer rejects a reference with a reason, warned when none was submitted yet; the family is notified; the desk takes the money for unpaid subjects in one click and is told when a transfer is in progress; the finance admin approves a hand-over again after a later one, and a declined request offers only Approve; takings show drawer, money in and money out; refusals read as sentences |

---

## 3. Findings

Severity is by impact on the school and its families. The trail's "control" rows record which
fixes were undone and what failed; exceptions are named in the Test column.

| ID | Sev | Finding | Fix | Test |
|---|---|---|---|---|
| **MA-01** | **High** | At window close, `finalizePendingRecords` failed every open payment, `pending_verification` included — transfers the family had already sent and referenced. The registration expired and escrow came back; `confirmPayment` then refused anything in a closed session. | The close fails only unpaid checkouts (`pending`) and leaves a registration held by a transfer awaiting verification. Finance confirms it after the close, or rejects it (MA-03), which then expires the registration. | `08` "window closes with money in flight" |
| MA-02 | Medium | A parent could not cancel an unpaid checkout: escrow applied stayed debited and the subjects could not be paid another way until the close. | `POST /v1/payments/:id/cancel` for a linked parent while `pending`; escrow back, subjects payable again; refused once a reference is in. The checkout page shows a started checkout and what it covers, to finish or cancel. | `08` "the parent cancels"; `05` cross-family case |
| MA-03 | Medium | Finance could not reject a reference that is not on the bank statement; the payment could only wait for the close. | `POST /v1/payments/:id/reject` (finance roles) with a reason the family receives by notification and email; escrow back; subjects payable while the window is open for the student, expired after it. Reject in the workbench, with a warning when no reference was submitted yet. | `08` "finance rejects" |
| MA-04 | Medium | Takings counted a reversed payment twice (out of money in, and again as money out: the 02 scenario's drawer moved +500, the report said −500, and no test read the net). "Net in drawer" included InstaPay and card. | Money in is everything confirmed that day, reversed or not; reversals are money out; the drawer counts the cash instrument only. | `08` "same-day reversal", "InstaPay … never cash in the drawer"; `01`, `02` assert net and drawer |
| MA-05 | Medium | A reversal was reported on the confirmation's day, rewriting that day after it was reconciled. | `payment.reversed_at` / `reversed_by` (migration 0028, backfilled); a reversal counts on its own day. | `08` "reversing yesterday's payment" |
| MA-06 | Medium | Two simultaneous checkouts of one registration both succeeded (2 of 4), each debiting escrow: the in-transaction re-check had no lock. | The checkout locks the registrations before the re-check. | `08` "four checkouts … at once" |
| MA-07 | Low | Every officer who clicked confirm on the same payment wrote a PAYMENT_CONFIRMED row, so the trail named three confirmers for one confirmation. | Confirmation writes its audit rows in its own transaction, only when it confirms; every losing click answers 409. | `08` "three officers confirm" (one row, statuses 200/409/409) |
| MA-08 | Medium | Refund hand-overs and rejections read the request without a lock: two officers paying out 600 each of 1000 were recorded as 600; a rejection racing a partial hand-over returned the whole request on top of the cash paid (200 EGP created). | Both lock the request row. | `08` "two officers hand over", "partial hand-over and a rejection race" |
| MA-09 | Medium | Takings read cash refunds from the request row (running total, latest resolution): a refund paid on two days moved to the second; one rejected after a partial hand-over vanished from every day. | One `withdrawal_disbursement` row per hand-over (migration 0028, backfilled); takings sum the day's hand-overs. | `08` "two parts on two days"; `09` |
| MA-10 | Medium | A subject swapped in skipped the family's discounts (1500 instead of 1080) and stored the whole price as course fee. | Swaps price the new subject as a fresh in-school registration with the family's exceptions, keeping the fee split. (Retake status is not recorded on a swap: MO-13.) | `08` "a subject swapped in" |
| MA-11 | Low | Refund windows in one scope could overlap, so the refund depended on row order. | Overlapping windows are refused (409), naming the clash. | `08` "refuses a window that overlaps" |
| MA-12 | Low | `confirmPayment` judged the registrations before its transaction, so a close in between could leave a completed payment on expired registrations. Not reproduced; fixed by reasoning. | Payment and registrations are locked and judged inside the transaction. | None for the race itself. `09` would catch the outcome only if a suite path produced it |
| MA-13 | Medium | Deadline extensions let a student register after the close, but payment ignored them: the desk created a payment it then could not confirm; the parent could not pay at all. | One check — active session or an extension — used by checkout, confirmation, rejection and desk collection. | `08` "a student with a deadline extension" |
| MA-14 | Medium | A payment could be reversed after one of its subjects was dropped and refunded: the family kept the refund for money recorded as never received. | A reversal requires every registration to still be confirmed. | `08` "reversing a confirmation … is refused" |
| MA-15 | Medium | A preregistration paid after its session opened credited the whole payment to the held wallet although capture had already moved the subject on; nothing ever took it out, so the family's money was stranded. | Held is credited only for rows still preregistered. | `08` "a preregistration paid after its session opened"; `09` held rule |
| MA-16 | Medium | A drop read the receipt without a lock and voided it unguarded: an officer handing the paper over in between left the family with the paper and an immediate refund. A drop also locked registration then receipt, the reverse of a reversal's order. | The drop locks the receipt first (the reversal's order) and voids only a receipt still at the desk. | `08` "a drop racing the hand-over" (swept; failed without the fix). The deadlock was not reproduced (0 of 3 swept runs with the old order); the order change rests on reasoning |
| MA-17 | Medium | The second approver's check on cash refunds could be bypassed: an approval given after one partial hand-over stayed on the request, so the rest was paid out unapproved; a request rejected after a partial hand-over left the queue unapproved. | A new hand-over clears the approval; a rejected request with cash out stays in the queue until approved; the screen says whether the request is closed. | `08` "every hand-over needs the second signature"; `09` approval rule |
| MA-18 | Medium | The desk could not take money for a subject already registered and unpaid — the state after a reversal ("settle again at the finance desk"), a rejection, a cancelled checkout or a register-only visit. | `POST /v1/registrations/desk/collect` and a one-click "waiting for payment" bar on the desk, refused with a sentence while a checkout is in progress. | `08` "the desk takes the money for a subject already registered" |
| MA-19 | Low | Every refusal on every screen was shown as the raw response body (`{"success":false,"error":"…"}`) since the initial commit, the money sentences included. | `apiResponse` throws the API's sentence, or the validation messages. | `08` asserts the thrown sentence for a refusal and a validation failure |

**O-7 (handed on by the security audit).** Payment confirmation, reversal, failure,
cancellation and rejection, desk collection, and cash-refund hand-over and rejection write their
audit rows inside the money transaction. The other money actions still write after the commit
(MO-1).

**Also tightened:** money inputs (escrow applied, transfers, withdrawals, hand-overs) accept at
most two decimals, and refund totals are rounded to the piastre, so a request's hand-overs
always add up to its total.

---

## 4. What the review changed

The Opus 5.5 review (trail, "review" rows) found no regression in the first commit and four
defects the first pass missed on paths it had read: MA-15, MA-16, MA-17 and MA-18 above
(MA-19 was found while driving the screens for MA-18). It also corrected these claims:

- **"Each lock was shown necessary by removing it"** was not true. Now shown by removal:
  the checkout's registration lock (MA-06), the refund hand-over and rejection locks (MA-08),
  the receipt lock on drops (MA-16), and the lock in the shared fail path (without it, a cancel
  and a confirmation both succeeded, 3 of 3 runs). Confirmation's own payment lock, when
  removed, left the money correct (the guarded update still admits one confirmation) and only
  turned the losers' 409 into 400. Not shown: the reversal's registration lock (the receipt
  lock already serializes a drop and a reversal) and the drop/reversal deadlock (not
  reproduced).
- **MA-12 "guarded by an invariant"** overstated it; the race is fixed by reasoning only.
- **"Fourteen red for the right reason"** was loose: MA-01, 06, 08, 10 and 11 failed for their
  own reason; MA-02, 03 and 09 failed because the endpoint or table did not exist; the takings
  tests failed on the response shape; MA-07 failed only by cascade on the first run and got its
  own failing control later.
- **The invariant controls** had not broken every branch; a second round broke the four that
  were missed, and each failed.
- **The migration backfill** had never run on real rows. It was run, verbatim, against the rows
  the suite leaves, after rewinding them to their pre-0028 shape: times match what the code
  writes, a legacy reversal without metadata takes `updated_at`, a deleted actor becomes null,
  and every request's backfilled total equals its released amount. A refund paid in several
  hand-overs becomes one row dated at its last resolution, so past days' takings for such
  refunds move to that date; harmless before launch, stated here.

---

## 5. How the result stays true

- **`09-money-invariants.test.ts` runs last** and checks thirteen rules over every row the
  whole suite leaves behind, after first asserting that each kind of money movement exists, so
  an empty check cannot pass by default. Every rule was shown to fail, by a corrupted row or by
  undoing its fix; the two clauses the database's own check constraints already forbid (a
  negative balance, more released than requested) could not be corrupted and were not.
- **A new money table or movement gets a rule in `09`** as well as a scenario, and a guard that
  reads then writes takes a row lock (CLAUDE.md).
- **Concurrency is tested as concurrency**, and where a race needs a precise interleaving the
  test sweeps the timing.
- **Takings are asserted in full**: `01`, `02` and `08` check net and drawer.
- All of it runs in CI on every pushed branch.

---

## 6. Observations handed on

| ID | Observation | Owner |
|---|---|---|
| MO-1 | O-7 remainder: payment initiation (the checkout's escrow debit) and school-fee initiation, drops, swaps, receipt returns and write-offs, escrow transfers, withdrawal requests and approvals, preregistration cancel and capture, remark refunds and desk registration still write their audit rows after the commit (awaited, so the gap is a crash or a failed insert between the two). | State-and-time audit |
| MO-2 | A swap's drop leg follows the refund window (V3 §6.12): in a 50% window, swapping costs the family half the first subject. Correct to the plan; worth confirming for swaps as opposed to drops. | Owner decision |
| MO-3 | The takings day is the API server's local day: production must run with `TZ=Africa/Cairo` (added to the production checklist in SECURITY_AUDIT.md §6). | Deployment checklist |
| MO-4 | Cash refunds are assumed to leave the drawer as cash; a hand-over has no instrument. | Desk question |
| MO-5 | At close, a student's pending registrations expire even with an active deadline extension; the extension lets them register again. | Owner decision |
| MO-6 | A swap request shows a price at request time; the registration is priced again at approval. | Owner decision |
| MO-7 | Two refund windows created at the same instant could both pass the overlap check. One finance admin maintains them. | Accepted |
| MO-8 | ESCROW_TRANSFER audit rows have an empty entity id. | Engineering health |
| MO-9 | A subject priced at 0 by a full discount still needs a 0 EGP payment to confirm (one click at the desk), and expires at the close if nobody confirms it. | Feature work |
| **MO-10** | **InstaPay at the close.** A family who transfers just before the close but submits the reference just after loses the subject (the checkout is `pending` at the close and fails). In the other direction, a submitted reference — not proof of payment — holds its registration past the close until finance acts, with no cut-off. Recommendation: a grace period (for example 24 hours) during which an unreferenced InstaPay checkout survives the close, and a hard cut-off (the board's entry deadline) after which anything unconfirmed is rejected automatically. | **Owner decision** |
| **MO-11** | **What a cash reversal means.** Takings count a reversal as money out on its day, the bookkeeper's correcting entry: right if cash was handed back, and right over the pair of days if the confirmation was a mistake and no cash came (the confirmation day showed cash that was never there). Recommendation: the reversal asks "was cash handed back?"; if not, it is shown as a correction to its original date and the day's drawer does not move. | **Owner decision** |
| MO-12 | A deadline extension with no session applies to every session (the exception model's rule), and checkouts made under an extension after the close are never swept. | Owner decision |
| MO-13 | A swap does not record retake status on the new registration (price is unaffected: retake matters only for outside-school pricing, which swaps do not offer). | Engineering health |
| MO-14 | The desk's collection bar applies no escrow; the endpoint accepts it. | Feature work |
| MO-15 | A parent can cancel a pay-at-school checkout after handing cash over; the officer's confirm then says so and points to desk collection. | Accepted |
| MO-16 | A finance admin approving at the instant an officer hands more cash over approves that hand-over too, unseen. | Accepted, low |

---

## 7. Not covered

The remaining state machines and time paths (Phase 1.3: transition tables, the 1 July
rollover, scheduler expiry); performance of the takings and invariant queries at school scale;
the legacy Fawry sweep (disabled with its provider); and the Expo app.

## 8. Reproduce

```bash
pnpm --filter @repo/api test        # 08 and 09 included; needs the Postgres from apps/api/test/README.md
TZ=UTC pnpm --filter @repo/api test # as CI runs it
```

Browser checks: `.audit/money-audit-evidence/ui-check*.mjs` against the dev servers, with the
data from `.audit/money-audit-evidence/lead-env-setup*.sh`; the backfill check is
`.audit/money-audit-evidence/money-backfill-check.sql`.
