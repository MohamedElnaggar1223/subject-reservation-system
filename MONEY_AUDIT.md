# Money-Correctness Audit — Phase 1.2

**Date:** 27 September 2026
**Scope:** STRATEGY.md Phase 1.2: ledger invariants over the whole database, refund windows
with real percentages, exception stacking (including a fixed discount larger than the price),
the escrow held at InstaPay initiation with no release path, the takings semantics (bank
transfers in the drawer figure, reversals rewriting a closed day), and the concurrency of
checkout, confirmation and cash refunds. Plus O-7 from the security audit: audit rows inside
the money transaction.
**Method:** every money path was read end to end, then each suspected defect was reproduced
as a failing scenario through the API before it was fixed. Two new test files hold the result:
`08-money-rules.test.ts` (one scenario per rule, including concurrency fired as simultaneous
requests on separate connections) and `09-money-invariants.test.ts` (rules that must hold over
every row the whole suite leaves behind). Each fix's test was shown to fail with the fix undone;
each invariant was shown to fail against a deliberately corrupted row. The new staff and parent
screens were driven in a real browser against the dev servers.
Every decision and its evidence is in `.audit/money-audit.tsv`.

---

## 1. Headline

**The ledger primitives are sound; the flows around them were not.** Every escrow movement
already went through an atomic, guarded debit or credit with its ledger row, and no scenario
could make a balance disagree with its ledger or go negative. The defects were in what the
flows decided to do with money, and in the report the desk reconciles against.

**Fourteen findings: one high, ten medium, three low.** The high one: when a registration window closed,
the system failed every open payment, including InstaPay transfers the family had already sent
and referenced. The registration expired, the escrow came back, and nothing could confirm the
transfer afterwards: a family who paid on the last day had sent the money, lost the subject,
and left no payable record. The medium ones include a takings report whose "net in drawer"
counted every reversal twice and included bank transfers, reversals that rewrote days already
reconciled, cash refunds that vanished from the report, two races that recorded less cash
than was handed out or created refund money, and a reversal that paid a family twice. All
fourteen are fixed, each with a test.

---

## 2. What was proven

| Area | How | Result |
|---|---|---|
| Ledger = balance | `09`, over every escrow the suite creates | Free and held balances equal their ledger sums; none negative |
| Escrow applied to a payment | `09` | Debited exactly once; given back exactly once when, and only when, the payment failed or was reversed |
| Payment = what it covers | `09` | Amount plus escrow applied equals the sum of the registration prices, for every registration payment |
| Price = fee split | `09` | Every registration price equals course fee plus registration fee (a check swaps used to pass by storing the whole price as course fee — see MA-10) |
| Paid once | `09` | No registration is covered by two completed payments; every confirmed one by exactly one |
| No money for nothing | `09` | A completed payment never covers a waiting, expired or rejected registration |
| Receipts | `09` | Every paid registration has its receipt; a parked drop has a receipt out waiting to return, refunding no more than the price |
| Drops | `09` | No drop refunds more than the registration cost |
| Cash refunds | `09` | Cash handed over adds up to what each request says was released, never more than requested |
| Audit rows | `09` | Every completed, reversed or failed payment carries exactly its transition's audit rows |
| Refund windows | `08` | 50% window refunds 750 of 1500; a custom refund exception (90%) overrides it; a gap between configured windows refunds 0; with none configured, 100% |
| Exception stacking | `08` | 20% and 10% multiply (1500 → 1080, split 720 + 360); a fixed 100 comes off the course fee (980); a fixed discount larger than the price makes it 0, never negative |
| Concurrency | `08` | Four simultaneous checkouts of one subject: one payment, escrow taken once. Two checkouts wanting most of the escrow: one refused. Three officers confirming one transfer: one confirmation, one receipt, one audit row. Two officers paying out one refund: one recorded. A partial hand-over racing a rejection: no money created |
| Screens | headless Chrome on the dev servers | Parent cancels a checkout and the escrow returns; a returning parent sees the checkout they started and submits the reference; the officer rejects it from the workbench with a reason; the family is notified; the subject is payable again; takings shows drawer, money in and money out as below |

---

## 3. Findings

Severity is by impact on the school and its families. Each fix has a test that fails when the
fix is undone (trail, "control" rows) except MA-12, which could not be reproduced on demand
and is guarded by an invariant.

| ID | Sev | Finding | Fix | Test |
|---|---|---|---|---|
| **MA-01** | **High** | At window close, `finalizePendingRecords` failed every open payment, `pending_verification` included — transfers the family had already sent and referenced. The registration expired and escrow came back; `confirmPayment` then refused anything in a closed session, so there was no way to honour the money. | The close fails only unpaid checkouts (`pending`) and leaves a registration held by a transfer awaiting verification alone. Finance can confirm such a transfer after the close, or reject it (MA-03), and a rejection after the close expires the registration. | `08` "window closes with money in flight" |
| MA-02 | Medium | A parent had no way to cancel an unpaid checkout. Escrow applied at checkout stayed debited, and the subjects could not be paid another way, until the window closed. | `POST /v1/payments/:id/cancel` for any linked parent while the payment is `pending`; escrow comes back and the subjects are payable again. Refused once a reference is in. The checkout page shows a started checkout (to finish or cancel) instead of refusing to pay again. | `08` "the parent cancels"; `05` cross-family case |
| MA-03 | Medium | Finance had no way to reject a transfer reference that is not on the bank statement; the payment could only wait for the window to close. | `POST /v1/payments/:id/reject` (finance roles) with a reason the family receives by notification and email; escrow comes back; subjects stay payable while the window is open for the student and expire after it. A Reject button in the workbench. | `08` "finance rejects" |
| MA-04 | Medium | The takings report counted a reversed payment twice: it dropped out of money in and was subtracted again as money out (the 02 scenario's real drawer movement was +500; the report said −500, and no test read the net). "Net in drawer" also included InstaPay and card, which never enter the drawer. | Money in is everything confirmed that day, reversed or not; reversals are money out; a separate drawer figure counts the cash instrument only. | `08` "same-day reversal", "InstaPay … never cash in the drawer"; `01`, `02` now assert net and drawer |
| MA-05 | Medium | A reversal was reported on the day the payment had been confirmed, so reversing Monday's payment on Tuesday rewrote Monday's report after it was reconciled, and Tuesday showed nothing. | `payment.reversed_at` / `reversed_by` (migration 0028, backfilled from the reversal metadata); a reversal counts on its own day. | `08` "reversing yesterday's payment" |
| MA-06 | Medium | Two simultaneous checkouts of one registration both succeeded (2 of 4 in the test), each debiting escrow. The re-check inside the transaction was meant to serialize them but, under READ COMMITTED with no lock, both read "no open payment". | The checkout locks the registration rows before the re-check. | `08` "four checkouts … at once" |
| MA-07 | Low | Every officer who clicked confirm on the same payment wrote a PAYMENT_CONFIRMED audit row, including the ones whose click did nothing, so the trail named three confirmers for one confirmation. | Confirmation writes its audit rows inside its own transaction, only when it actually confirms; a losing click answers 409. | `08` "three officers confirm" |
| MA-08 | Medium | Cash-refund hand-overs and rejections read the request without locking it. Two officers each paying out 600 of a 1000 request were recorded as 600 released in total; a rejection racing a partial hand-over returned the whole request to escrow on top of the cash paid out (200 EGP created in the test). | Both lock the request row for the whole transaction. | `08` "two officers hand over", "partial hand-over and a rejection race" |
| MA-09 | Medium | Takings read cash refunds from the request row, which keeps only the running total and the latest resolution. A refund paid in two parts on two days moved entirely to the second day; a request rejected after a partial hand-over vanished from every day's report, cash out included. | One `withdrawal_disbursement` row per hand-over (migration 0028, backfilled); takings sums the day's hand-overs. | `08` "a refund paid in two parts on two days"; `09` disbursement invariant |
| MA-10 | Medium | A subject swapped in was priced by the engine alone: the family's discounts were skipped (a family with 20% + 10% off paid 1500 instead of 1080) and the whole price was stored as course fee. | Swaps price the new subject exactly as a fresh registration, exceptions included, and keep the fee split — for direct swaps and approved swap requests. | `08` "a subject swapped in is priced like a fresh registration" |
| MA-11 | Low | Refund windows in one scope could overlap; the refund then depended on row order. | Creating an overlapping window is refused (409) with the window it clashes with. | `08` "refuses a window that overlaps" |
| MA-12 | Low | `confirmPayment` judged the registrations before its transaction, so a close landing in between could leave a completed payment on expired registrations, with receipts for them. Not reproduced on demand. | The payment and its registrations are locked and judged inside the transaction. | `09` "a completed payment never covers … expired" |
| MA-13 | Medium | Deadline extensions let a student register after the close, but payment ignored them: the desk registered, created the payment (debiting any escrow) and then failed to confirm it, leaving a pending payment behind with an error; the parent could not pay in the app at all. | One check — the window is open for this student if the session is active or the student holds an extension — used by checkout, confirmation and rejection. | `08` "a student with a deadline extension" |
| MA-14 | Medium | A payment could be reversed after one of its subjects had been dropped and refunded to escrow: the family kept the refund for money now recorded as never received. | A reversal requires every registration on the payment to still be confirmed; otherwise 409 with a sentence. | `08` "reversing a confirmation … is refused" |

**O-7 (handed on by the security audit).** Payment confirmation, reversal, failure,
cancellation and rejection, and cash-refund hand-over and rejection now write their audit rows
inside the money transaction: the movement and its row commit together or not at all. The other
money actions still write after the commit (MO-1).

---

## 4. How the result stays true

- **`09-money-invariants.test.ts` runs last** and checks eleven rules over every row the whole
  suite leaves behind. It first asserts that each kind of money movement exists, so an empty
  check cannot pass by default. Each rule was shown to fail against a corrupted row.
- **A new money table or movement gets an invariant in `09`** as well as a scenario (CLAUDE.md).
- **Concurrency is tested as concurrency**: `08` fires simultaneous requests on separate
  connections, and each lock was shown necessary by removing it.
- **Takings are asserted in full**: `01`, `02` and `08` check net and drawer, not just totals.
- The takings screen's type is derived from its fetcher (it was hand-typed).
- All of it runs in CI on every pushed branch.

---

## 5. Observations handed on

| ID | Observation | Owner |
|---|---|---|
| MO-1 | O-7 remainder: drops, swaps, receipt returns and write-offs, escrow transfers, withdrawal requests and approvals, preregistration cancel and capture, remark refunds and desk registration still write their audit rows after the commit (awaited, so the gap is a crash or a failed insert between the two). | State-and-time audit |
| MO-2 | A swap's drop leg follows the refund window (V3 §6.12): in a 50% window, swapping one subject for another costs the family half the first subject. Correct to the plan, but worth confirming it is what the school wants for swaps as opposed to drops. | Owner decision |
| MO-3 | The takings day is the API server's local day. Production must run with `TZ=Africa/Cairo`, or the report must take the school's zone explicitly. | Deployment checklist |
| MO-4 | Cash refunds are assumed to leave the drawer as cash; a hand-over has no instrument, so a refund paid by bank transfer would still be counted against the drawer. | Desk question |
| MO-5 | At close, a student's pending registrations expire even if the student holds a deadline extension; the extension lets them register again. | Owner decision |
| MO-6 | A swap request shows the parent a price at request time; the registration is priced again at approval, so a fee or exception change in between is charged at the new price. | Owner decision |
| MO-7 | Two refund windows created at the same instant could both pass the overlap check (no lock). One finance admin maintains them. | Accepted |
| MO-8 | ESCROW_TRANSFER audit rows have an empty entity id, so a transfer cannot be found by entity. | Engineering health |
| MO-9 | A subject priced at 0 by a full discount still needs a 0 EGP payment to confirm; at the desk this is one click, in the app it would ask for a 0 EGP transfer. | Feature work |

---

## 6. Not covered

The remaining state machines and time paths (Phase 1.3: transition tables, the 1 July
rollover, scheduler expiry); performance of the takings and invariant queries at school
scale; the legacy Fawry sweep (disabled with its provider); and the Expo app.

## 7. Reproduce

```bash
pnpm --filter @repo/api test        # 08 and 09 included; needs the Postgres from apps/api/test/README.md
TZ=UTC pnpm --filter @repo/api test # as CI runs it
```

The browser checks are scripts under `/tmp/lead-env-pw/` recorded in the trail's evidence
column, run against the dev servers with the data set up by `/tmp/lead-env-setup*.sh`.
