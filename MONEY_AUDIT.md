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
corrupting rows, and the screens were driven in a real browser against the dev servers. Two
independent reviews on Opus 5.5 followed: the first found four more defects on paths the first
pass had read and several claims worded beyond the evidence; the second, of the fixes, found a
blocker in them (MA-20) and more races on the same paths. A third, of the owner's two
decisions as built, stopped the merge on how the board-deadline cut-off treats real transfers;
a fourth, of that response, found a double count in the new "Transfer found", a lost notice at
the close, and a draft series that could still open past its deadline. All are acted on below
(§4).
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

**Twenty-one findings: one high, sixteen medium, four low.** The high one: when a registration
window closed, the system failed every open payment, including InstaPay transfers the family
had already sent and referenced. The registration expired, the escrow came back, and nothing
could confirm the transfer afterwards. Among the medium ones: a takings report whose "net in
drawer" counted every reversal twice and included bank transfers; reversals and cash refunds
that rewrote or vanished from days already reconciled; races that recorded less cash than was
handed out or created refund money; a reversal that paid a family twice; preregistration money
stranded in the held wallet; a drop that refunded at once while the family held the paper
receipt; a second-approver check on cash refunds that could be bypassed; a desk that could not
take money for a subject already registered; and a subject paid again after a reversal left
with only its voided receipt; and a parent's escrow page that showed a balance of 0.00 (MA-21).
All twenty-one are fixed. Eighteen have a test that fails without the fix; MA-12, and the
deadlock half of MA-16, rest on reasoning; MA-21 is a screen defect, shown in the browser before
and after (the web app has no test runner).

Two questions were the owner's (§6, MO-10 and MO-11): how long a family has to submit an
InstaPay reference after the close, and whether reversing a cash payment means cash was handed
back. The owner took both recommendations on 27 September; they are built and tested (§6a),
with one addition the review asked for: a transfer that turns up on the bank statement after the
cut-off closed its payment is recorded by finance and credited to the family's escrow.

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
| Receipts | `09` | Every paid registration has its receipt, never a void one; a parked drop has a receipt out waiting to return, refunding no more than the price |
| Held wallet | `09`, with a paid preregistration still waiting at the end of the suite | Held balance equals the prices of paid preregistrations still waiting for their session |
| Drops | `09` | No drop refunds more than the registration cost |
| Cash refunds | `09` | Cash handed over adds up to what each request says was released, never more than requested; an approval covers every hand-over made before it |
| Audit rows | `09` | Every completed, reversed or failed payment carries exactly its transition's audit rows |
| Refund windows | `08` | 50% window refunds 750 of 1500; a custom refund exception (90%) overrides it; a gap between configured windows refunds 0; with none configured, 100% |
| Exception stacking | `08` | 20% and 10% multiply (1500 → 1080, split 720 + 360); a fixed 100 comes off the course fee (980); a fixed discount larger than the price makes it 0, never negative |
| Concurrency | `08` | Four simultaneous checkouts of one subject: one payment, escrow taken once. Three officers confirming one transfer: one confirmation, one receipt, one audit row, the others 409. Confirm against reject, and cancel against confirm: one wins, escrow matches the winner. Two officers paying out one refund: one recorded. A partial hand-over racing a rejection: no money created. A drop racing its receipt's hand-over, swept across the drop's transaction: never a refund for paper the family holds. A drop racing a reversal: one wins with a clean refusal |
| Screens | headless Chrome on the dev servers | Parent cancels a checkout and the escrow returns; a returning parent sees the checkout they started, with its subjects; the officer rejects a reference with a reason, warned when none was submitted yet; the family is notified; the desk takes the money for unpaid subjects in one click and is told when a transfer is in progress; the finance admin approves a hand-over again after a later one, and a declined request offers only Approve; takings show drawer, money in and money out; refusals read as sentences; a checkout lapsed after the close offers a finance admin (not an officer) "Transfer found", which asks for the statement's reference and amount, names the family's own reference, credits what arrived to escrow, and appears under "Transfers found later" in the day's takings (with the amount that was due) and in the family's escrow history; the parent's escrow page shows the selected child's balance, in English and Arabic |

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
| MA-15 | Medium | A preregistration paid after its session opened credited the whole payment to the held wallet although capture had already moved the subject on; nothing ever took it out, so the family's money was stranded. The same path had three more ways in: a cancel while a transfer was being checked dropped the row with nothing refunded; capture decided "paid?" without a lock, so a confirmation in between reached the same outcome; and a paid preregistration could be paid again, holding its price twice. | Held is credited only for rows still preregistered; cancel is refused while a payment is open and decides under a row lock; capture locks the row and decides inside its transaction; checkout refuses a subject already paid for. | `08` "a preregistration paid after its session opened" (one payment for two preregistrations, one session opens), "cancelling … while its transfer is being checked", "already paid for cannot be paid again"; `09` held rule. The capture race is fixed by reasoning |
| MA-16 | Medium | A drop read the receipt without a lock and voided it unguarded: an officer handing the paper over in between left the family with the paper and an immediate refund. A drop also locked registration then receipt, the reverse of a reversal's order. | The drop locks the receipt first (the reversal's order) and voids only a receipt still at the desk. | `08` "a drop racing the hand-over" (swept; failed without the fix). The deadlock was not reproduced (0 of 3 swept runs with the old order); the order change rests on reasoning |
| MA-17 | Medium | The second approver's check on cash refunds could be bypassed: an approval given after one partial hand-over stayed on the request, so the rest was paid out unapproved; a request rejected after a partial hand-over left the queue unapproved; and a finance admin could approve cash they had handed over themselves. | A new hand-over clears the approval; a rejected request with cash out stays in the queue until approved; approving cash you handed over is refused (403); the approval and its audit row commit together; the screen says whether the request is closed. | `08` "every hand-over needs the second signature", "cannot approve cash they handed over themselves"; `09` approval rule |
| MA-18 | Medium | The desk could not take money for a subject already registered and unpaid — the state after a reversal ("settle again at the finance desk"), a rejection, a cancelled checkout or a register-only visit. | `POST /v1/registrations/desk/collect` and a one-click "waiting for payment" bar on the desk, refused with a sentence while a checkout is in progress or the window is closed for the student. The desk (here, and for desk registration and school fees) now checks its confirmation happened: if the payment was failed in between it says nothing was collected, and if confirmation throws, its own payment is failed so the escrow comes back. | `08` "the desk takes the money for a subject already registered" (incl. another student's subject, and the closed window). The confirmation guard is fixed by reasoning |
| MA-19 | Low | Every refusal on every screen was shown as the raw response body (`{"success":false,"error":"…"}`) since the initial commit, the money sentences included. | `apiResponse` throws the API's sentence, or the validation messages. | `08` asserts the thrown sentence for a refusal and a validation failure |
| MA-20 | Medium | A subject paid again after its payment was reversed kept only the receipt the reversal had voided: receipt creation skips a registration that already has one, so the new payment had no receipt to hand over, and the desk listed the void one as "ready to hand over" and could print it. Handing that paper over re-opened MA-16. Found by the second review, in this audit's own MA-18 screenshot. | Paying again reissues the void receipt under a new number (`…-R2`), so the voided paper can never pass for it; the desk lists only receipts ready to hand over. | `08` "a subject paid again after a reversal gets its receipt back under a new number"; `09` "never a void one" |
| MA-21 | Medium | The page translator (`apps/web/lib/i18n.tsx`) kept each text node's first value and took a new one only if it contained letters, so every number React re-rendered went back to its first value — in English too. A parent who picked a child on the escrow page read "Balance: 0.00 EGP" while the child's card and the API said 2210. Any figure that loads after first paint could be stale the same way. Found while checking the late-transfer screens. | A text node that is neither its recorded source nor that source's translation was written by React and becomes the new source, whatever it holds. The escrow history also labels every ledger reason it writes (five showed as raw keys), in English and Arabic. | Headless Chrome, `ui-check-9`: header 2210.00 in English and Arabic and across a live language toggle (0.00 before). No web test runner |

**O-7 (handed on by the security audit).** Payment confirmation, reversal, failure,
cancellation and rejection, desk collection (its payment and escrow debit, then its
confirmation), and cash-refund hand-over, rejection and approval write their audit rows inside
the money transaction. The other money actions still write after the commit (MO-1).

**Also tightened:** money inputs (escrow applied, transfers, withdrawals, hand-overs) accept at
most two decimals, and refund totals are rounded to the piastre, so a request's hand-overs
always add up to its total.

---

## 4. What the reviews changed

The first Opus 5.5 review (trail, "review" rows) found no regression in the first commit and
four defects the first pass missed on paths it had read: MA-15, MA-16, MA-17 and MA-18 above
(MA-19 was found while driving the screens for MA-18). The second review, of those fixes,
found a blocker in them — MA-20, visible in this audit's own screenshot of the desk collection,
whose trail row had said "all flows work" — and, on the same paths, the preregistration races
now under MA-15, self-approval under MA-17, the unchecked desk confirmation under MA-18, a desk
test comment that claimed an ownership case it did not run, a held-wallet rule that checked
almost nothing (no paid preregistration was left waiting at the end of the suite), and a claim
that desk collection wrote all its audit rows inside the transaction. All are fixed. The first
review also corrected these claims:

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

The third review, of the owner's decisions as built (de673a8, 2fcae35), said "don't merge yet"
and raised eleven points. What each changed:

1. **The deadline cut-off closed real transfers with no way back.** A transfer finance had not
   verified was failed at the board deadline, sent as "Payment Not Received", and the money in
   the bank had no record. Now the sweep fails it as the system (`PAYMENT_FAILED`, notice
   "Payment Not Completed" saying how to get the money back), and finance has **Transfer found**
   (§6a), which records the transfer and credits the family's escrow. The owner's hard
   cut-off stands.
2. **A returned non-cash reversal had lost its only test** when `02` became "never received":
   a returned InstaPay reversal with escrow applied now asserts its takings (money out, never
   drawer out).
3. **Refusals after the deadline were untested and the docs claimed otherwise.** Confirm,
   late reference, checkout, desk collection, the `referenceDueAt` cap and "must be in the
   future" now have tests. Undone one by one, confirm, reference, the cap and "in the future"
   each failed; desk collection is refused twice over (the desk's own check, and confirmation
   inside it), so undoing the desk's check left the deadline refusal standing and failed the
   closed-window test instead; checkout goes through the same window check as registration.
4. **Preregistrations ignored the deadline.** Preregistering, checking out, sending a reference
   and confirming are all refused past the series' deadline (each undone: red).
5. **An escrow figure moved with nothing explaining it.** A "never received" reversal now
   reports its escrow as `correctedEscrow`, shown on the Corrections row.
6. **The close's grace could announce a time already past** for a payment spanning two
   sessions, and step 4 failed payments without expiring their registrations. The keep-or-fail
   test now reads the stored due time, and every failure at the close expires what it held.
   Fixed by reasoning; the timing is narrow. That change lost the close's per-student
   "not completed" notice for the subjects a failed checkout expired itself — found by the
   fourth review, below.
7. **The window/deadline order was a route check on an unlocked read.** The database now
   enforces it (`session_entry_deadline_after_end`, migration 0030; undone: red).
8. **Notices.** Registrations expired at the deadline now tell the family which subjects were
   not entered ("Not entered for …", tested); a payment closed at one series' deadline says
   its subjects *in that series* were not entered; a reversal past the deadline no longer says
   "settle again".
9. **UI.** The takings page says "this day" instead of "today" when showing another date.
   Times on the checkout card and the workbench are the browser's local time (MO-22).
10. **A "never received" reversal changes a reconciled day, however old.** The reversal dialog
    now says so in the "No" answer's hint. Whether to limit how far back is the owner's (MO-11
    row below).
11. **Approve, reject and swap check session status only** (MO-20); the comment in
    `window.services.ts` that said every path asks it was corrected.

The fourth review, of that response (fc1a101), again said "don't merge yet", on four points:

1. **"Transfer found" could count one bank transfer twice.** It stored the family's reference
   when there was one — often the very reference finance had rejected for not being on the
   statement — so the real reference never met the unique index. Now it always takes the
   statement's reference and stores that; a different family reference is kept in the
   payment's metadata. A reference already confirmed on another payment is refused (undone:
   recorded, 200).
2. **A mistaken "Transfer found" could not be undone**, officers could make one, and the
   credit was always the amount due. It is now the finance admin's alone, as a reversal is
   (undone: an officer got 200), and credits the amount on the statement, stored in
   `late_transfer_amount` (migration 0031, with a check that a recorded transfer has an amount);
   takings, the `09` rule and the notice use it (undone: escrow 2700 not 2300, and the `09`
   rule listed the payment). There is still no undo (MO-24). Its confirmation added two
   guards against slips: the amount is typed from the statement and cannot exceed what the
   payment was for, and the family's set-aside reference cannot be submitted again.
3. **The close lost its "not completed" notice** for subjects a failed checkout expired itself
   (third review item 6) — a pay-at-school checkout nobody came to pay told the student
   nothing. The failed checkout's registrations now join the notice (undone: no notice).
4. **A draft series could still open past its deadline**: the scheduler opened any draft
   whose start had come, and opening captures paid preregistrations' held money. The scheduler
   no longer opens a draft whose window has ended (the deadline is always after the end), and
   opening one by hand past its deadline is refused (each undone: the series opened).

---

## 5. How the result stays true

- **`09-money-invariants.test.ts` runs last** and checks fourteen rules over every row the
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
| MO-10 | **InstaPay at the close.** A family who transfers just before the close but submits the reference just after loses the subject (the checkout is `pending` at the close and fails). In the other direction, a submitted reference — not proof of payment — holds its registration past the close until finance acts, with no cut-off. Recommendation: a grace period (for example 24 hours) during which an unreferenced InstaPay checkout survives the close, and a hard cut-off (the board's entry deadline) after which anything unconfirmed is rejected automatically. | **Decided 27 Sep: as recommended — §6a** |
| MO-11 | **What a cash reversal means.** Takings count a reversal as money out on its day, the bookkeeper's correcting entry: right if cash was handed back, and right over the pair of days if the confirmation was a mistake and no cash came (the confirmation day showed cash that was never there). Recommendation: the reversal asks "was cash handed back?"; if not, it is shown as a correction to its original date and the day's drawer does not move. | **Decided 27 Sep: as recommended — §6a.** The limit, decided 28 Sep: a correction reaches back only within its own month; a month already closed stays as printed and the correction posts on the day of the reversal (§6b) |
| MO-12 | A deadline extension with no session applies to every session (the exception model's rule). Checkouts and registrations made under an extension after the close are now swept at the series' board entry deadline (§6a) — but only once the admin has set one. | Owner decision |
| MO-13 | A swap does not record retake status on the new registration (price is unaffected: retake matters only for outside-school pricing, which swaps do not offer). | Engineering health |
| MO-14 | The desk's collection bar applies no escrow; the endpoint accepts it. | Feature work |
| MO-15 | A parent can cancel a pay-at-school checkout after handing cash over; the officer's confirm then says so and points to desk collection. | Accepted |
| MO-16 | A finance admin approving just after an officer hands more cash over approves that hand-over too, before their screen has shown it (the queue refreshes every 30 seconds). | Accepted, low |
| MO-17 | A validation refusal now reads as its message alone; a generic message (none in the money forms) would not say which field failed. | Engineering health |
| MO-18 | Cancelling a preregistration at the very instant capture runs for it can deadlock; Postgres aborts one of the two and no money moves. | Accepted, low |
| MO-19 | Dev data only: the dev database has one registration confirmed with a void receipt, made before MA-20 was fixed. No production data exists. | Accepted |
| MO-20 | Approving or rejecting a registration request, and swaps, check the session's status only: they ignore deadline extensions (a student with one cannot have a request approved after the close) and the board deadline (safe while a window must close before its deadline). | State-and-time audit |
| MO-21 | A series still in draft when its window ends is no longer opened by the scheduler, nor by hand once its board deadline has passed (so no held money is captured for entries the board refuses). Its preregistrations could only be cancelled, at the refund window's percentage, although the school never ran the window. | **Decided 28 Sep: refunded in full at the deadline — §6b.** Only once the admin has set the series' deadline (as MO-12): a draft that never opens and has none keeps its preregistrations held |
| MO-22 | The checkout card, the workbench and the takings times are shown in the browser's local time; the API's sentences use Cairo time. Identical while staff and families are in Egypt. | Accepted |
| MO-23 | The escrow page's transaction rows and the desk's student summary are hand-typed instead of derived from their fetchers (CLAUDE.md, Hono RPC); this work added fields to the desk's. | Engineering health |
| MO-24 | A "Transfer found" had no undo. It is the finance admin's alone, asks for the statement's reference and an amount typed from the statement (never more than the payment was for), and a family reference it sets aside cannot be submitted again; a record whose money never arrived had no correction inside the system. | **Decided 28 Sep: a same-day undo while its escrow is unspent — §6b.** Later than that it still needs a database fix |

---

## 6a. The owner's decisions, as built (27 September 2026)

**MO-10 — money after the close.**
- At the close, an InstaPay checkout still waiting for its transfer reference is kept, with
  its subjects, until `referenceDueAt` = the close plus `INSTAPAY_REFERENCE_GRACE_HOURS`
  (default 24), never later than the series' board entry deadline. The family gets a notice
  and an email with the time; the checkout page and the finance workbench show it. A
  reference sent in time is verified and confirmed like any other; after the time it is
  refused. A pay-at-school checkout still fails at the close: no money is in flight.
- When the time passes with no reference, the scheduler's sweep (every minute) cancels the
  checkout, returns any escrow, releases the subjects and tells the family.
- Each series can carry the **exam board's entry deadline** (admin, from the board's
  calendar; after the window's close and in the future; any status; audited with a reason).
  When it passes, the sweep closes every payment still open on the series — a transfer
  finance never verified included — as a system failure, not a rejection (nobody judged the
  transfer), returns escrow, and tells the family ("Payment Not Completed": if you did
  transfer, bring the bank receipt to the finance desk). It expires every registration still
  waiting on the series and tells each student which subjects were not entered. From then on
  nothing new can be registered, preregistered, paid, confirmed, referenced or collected on
  the series, deadline extension or not; each refusal names the deadline. The workbench shows
  the deadline on every payment from a closed series.
- **A transfer found later.** When a transfer turns up on the bank statement after its
  payment was closed — it lapsed without a reference, the deadline closed it, or finance had
  rejected it — a finance admin uses **Transfer found** on the desk. It asks for the reference
  and the amount on the statement (the family's reference is shown, never used): the amount
  that arrived is credited to the student's escrow (ledger reason `late_transfer`), to use on
  a later payment or take back as a cash refund; the subjects stay as they are, since the
  window or the board has closed. It is money in on the day it is recorded, listed under
  "Transfers found later" in the takings with the amount that was due. A reference already
  recorded against any other payment is refused; it is recorded once per payment, audited in
  the same transaction, cannot be undone (MO-24), and the family is told the escrow changed.
- The admin must enter each series' deadline: with none set there is no automatic cut-off
  (DISCOVERY.md A-08). A window cannot be moved to close on or after its deadline (draft
  edit or extension; the database refuses it too), so the sweep never runs inside an open
  window.

**MO-11 — a reversal says whether the money went back.** The reversal dialog asks "Was the
money returned to the family?" and will not confirm without an answer.
- **Yes:** the reversal is money out on its own day, as before.
- **No — never received:** the confirmation was a mistake. The confirmation's day leaves the
  payment out of money in and lists it under Corrections (who confirmed it, who reversed it
  and when); the day of the reversal lists it too, and none of its figures move. The family's
  notice says which it was.
- Reversals made before the question existed are read as "money returned" (migration 0029),
  which is how they were reported.

**Tests** (`08`): the grace survives the close and notifies; a reference sent inside it is
confirmed; without one it lapses, returns escrow and notifies, and a late reference is
refused; at the close the grace never runs past the deadline; setting the deadline is
validated (after the close, in the future; the database's check too) and audited; past the
deadline, before the sweep, confirm, reference and desk collection are refused with the
deadline's sentence and checkout as a closed window; the sweep closes a transfer awaiting
verification and a checkout without a reference, expires an unpaid subject, and notifies; a
late registration is refused; at the close the student is told which subjects a failed
checkout left uncompleted; a transfer found later is the finance admin's, takes the
statement's reference and amount (keeping the family's), is credited once, is in the day's
takings, and refuses a reference already counted on another payment; past a draft series'
deadline a preregistration can be neither made, paid, referenced nor confirmed, and the series
is opened neither by hand nor by the scheduler; the four cash reversal cases plus a returned
InstaPay reversal with escrow applied; `02` reverses as "never received". `09` requires every
reversal to record the answer, and a transfer found later to be credited exactly once, for the
amount found, with its audit row. Undone, each fix failed its test (trail), with two exceptions
named in §4: desk collection is refused twice over, and checkout shares the registration's
window check.

## 6b. The owner's decisions of 28 September 2026

**MO-21 — a series that never opened refunds in full.** When the board's entry deadline
passes on a series still in draft, the deadline sweep drops each paid preregistration with a
100% refund to the family's escrow (the held money is released, not captured), on the same
receipt-gated path as a cancellation: a paper receipt already handed over must come back
first. Unpaid preregistrations expire. Each refund writes `PREREG_REFUNDED_AT_DEADLINE` in its
transaction, and each family is told which subjects will not be entered and what came back.
The refund windows do not apply: they are for a family's own drop — and a parent who cancels
after the deadline, before the sweep has run, also gets the full price. It happens only for a
series whose deadline the admin has set (as MO-12): a draft with none keeps its preregistrations
held until they are cancelled.

**MO-24 — undoing a "Transfer found".** A finance admin can undo one on the day it was
recorded (the server's day, as the takings), while the family's free escrow still covers it
(escrow is one balance, so this is what "unspent" can mean); the reason
is audited (`PAYMENT_LATE_TRANSFER_UNDONE`, in the transaction) and the family told. The escrow
is debited back (ledger reason `late_transfer_undone`), the payment returns to failed with
the reference it had before, it leaves that day's takings — so no earlier day changes, though
that day's own report changes if it was printed earlier the same day — and it can be recorded
again correctly. A family reference a record set aside cannot be recorded as another
payment's statement reference, so an undo can put it back (a record committing at the same
instant could still slip past that unlocked check; the undo then refuses with a sentence and
nothing moves). After that day, or once the escrow is spent, it is escrow
like any other, and a record whose money never arrived needs a database fix.

**MO-11 — how far back a "never received" reversal reaches.** Only within its own calendar
month. Reversed in the month of its confirmation, it corrects the confirmation's day as
before. Reversed in a later month, the confirmation's month stays as printed (the payment is
still money in on its day) and the correction is posted on the day of the reversal: listed
under Corrections, it reduces that day's net by the amount (`closedMonthCorrectionTotal`),
is not money out, and does not move that day's drawer. The reversal dialog says which will
happen. The month boundary assumes the school closes its books with the bank monthly
(DISCOVERY.md A-09).

**Tests** (`08`): June's deadline passing unopened refunds its paid preregistration in full
(1500 back, held released) despite a 50% refund window on June, expires the unpaid ones,
notifies, runs once, and leaves a November series whose deadline is ahead untouched; a parent
cancelling after the deadline, before the sweep, gets 100%; an undo is the finance admin's,
refused while the escrow is spent and on a later day, takes the escrow back, leaves the day's
takings, restores the reference the payment had, and lets the payment be recorded again; a
set-aside family reference cannot be recorded on another payment; a same-month "never received" reversal corrects its
confirmation day and not its own, and a closed-month one leaves its month as printed and posts
on the reversal's day. These use fixed days in last month, so they do not depend on today's
date. `09` checks that credits less undo debits equal what is recorded now, and counts the
refunds and undos. Undone, each failed its test (trail).

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
