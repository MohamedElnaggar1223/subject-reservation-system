import { describe, it, expect } from 'vitest';
import { sql } from './helpers';

/**
 * Money invariants over the whole database (money audit, MONEY_AUDIT.md §3).
 *
 * This file runs last. By then every earlier suite has moved money through the
 * API — desk cash, InstaPay with escrow, drops, swaps, receipts parked and
 * returned, withdrawals paid in parts, reversals, rejections, sessions closed
 * with money in flight — so these checks hold over every path the suite takes,
 * not over data built to pass them. Each query returns the rows that break
 * its rule; the rule holds when the list is empty.
 *
 * A check that finds nothing only means something if there is data to check,
 * so the first test asserts that each kind of money movement exists.
 */

/** An amount in whole cents, so comparisons never hinge on float rounding. */
const cents = (expr: string) => `round((${expr}) * 100)::bigint`;

describe('money invariants over the whole database', () => {
  it('there is money to check: every kind of movement happened in the suites above', async () => {
    const [counts] = await sql<Record<string, string>>(`
      select
        (select count(*) from payment where status = 'completed')                         as completed,
        (select count(*) from payment where status = 'refunded')                          as reversed,
        (select count(*) from payment where status = 'failed' and escrow_amount_applied > 0) as failed_with_escrow,
        (select count(*) from escrow_transaction where balance_type = 'held')             as held_moves,
        (select count(*) from escrow_transaction where reason in ('drop', 'swap_refund')) as drop_refunds,
        (select count(*) from withdrawal_disbursement)                                    as hand_overs,
        (select count(*) from withdrawal_request where status = 'rejected')              as rejected_withdrawals,
        (select count(*) from withdrawal_request where approved_by is not null)          as approved_withdrawals,
        (select count(*) from registration r where r.status = 'preregistered' and exists (
           select 1 from payment_registration pr join payment p on p.id = pr.payment_id
           where pr.registration_id = r.id and p.status = 'completed'))                  as paid_waiting_preregistrations,
        (select count(*) from receipt where receipt_number like '%-R%')                  as reissued_receipts,
        (select count(*) from payment where reversal_money_returned = true)              as reversals_money_returned,
        (select count(*) from payment where reversal_money_returned = false)             as reversals_never_received,
        (select count(*) from payment where reference_due_at is not null)                as checkouts_held_after_close,
        (select count(*) from payment where late_transfer_at is not null)                as late_transfers_recorded,
        (select count(*) from payment where purpose = 'remark' and status = 'completed')  as remark_fees_confirmed,
        (select count(*) from escrow_transaction where reason = 'late_transfer_undone')   as late_transfers_undone,
        (select count(*) from audit_log where action = 'PREREG_REFUNDED_AT_DEADLINE')     as prereg_refunded_at_deadline,
        (select count(*) from registration where status = 'dropped_pending_receipt' or status = 'dropped') as drops,
        (select count(*) from registration where status = 'expired')                     as expired_registrations,
        (select count(*) from escrow_transaction where reason = 'prereg_capture')        as held_captures,
        (select count(*) from escrow_transaction where reason = 'transfer_out')          as escrow_transfers,
        (select count(*) from receipt where status = 'lost')                             as receipts_lost
    `);
    for (const [kind, n] of Object.entries(counts!)) expect(Number(n), kind).toBeGreaterThan(0);
  });

  it('every escrow balance equals the sum of its ledger, free and held, and none is negative', async () => {
    const broken = await sql(`
      select e.student_id, e.balance, e.held_balance, l.free, l.held
      from escrow e
      left join (
        select escrow_id,
          sum(case when balance_type = 'free' then (case when type = 'credit' then amount else -amount end) else 0 end) as free,
          sum(case when balance_type = 'held' then (case when type = 'credit' then amount else -amount end) else 0 end) as held
        from escrow_transaction group by escrow_id
      ) l on l.escrow_id = e.id
      where ${cents('e.balance')} <> ${cents('coalesce(l.free, 0)')}
         or ${cents('e.held_balance')} <> ${cents('coalesce(l.held, 0)')}
         or e.balance < 0 or e.held_balance < 0
    `);
    expect(broken).toEqual([]);
  });

  it('escrow applied to a payment is debited once, and given back once exactly when the payment failed or was reversed', async () => {
    const broken = await sql(`
      select p.id, p.status, p.escrow_amount_applied, coalesce(d.total, 0) as debited, coalesce(r.total, 0) as returned
      from payment p
      left join (select related_payment_id, sum(amount) as total from escrow_transaction
                 -- The reservations rework (§3.10 item 6): a plan's capture applies the line's held
                 -- deposits, debited once with the capture payment's id (plan_capture).
                 where reason in ('payment', 'plan_capture') and type = 'debit' group by related_payment_id) d on d.related_payment_id = p.id
      left join (select related_payment_id, sum(amount) as total from escrow_transaction
                 where reason = 'payment_refund' and type = 'credit' and related_payment_id is not null group by related_payment_id) r on r.related_payment_id = p.id
      where ${cents('coalesce(d.total, 0)')} <> ${cents('p.escrow_amount_applied')}
         or ${cents('coalesce(r.total, 0)')} <> case when p.status in ('failed', 'refunded') then ${cents('p.escrow_amount_applied')} else 0 end
    `);
    expect(broken).toEqual([]);
  });

  it('a registration payment charges exactly the price of what it covers', async () => {
    const broken = await sql(`
      select p.id, p.amount, p.escrow_amount_applied, sum(r.price_at_registration) as prices
      from payment p
      join payment_registration pr on pr.payment_id = p.id
      join registration r on r.id = pr.registration_id
      where p.purpose in ('registration', 'preregistration')
      group by p.id
      having ${cents('p.amount + p.escrow_amount_applied')} <> ${cents('sum(r.price_at_registration)')}
    `);
    expect(broken).toEqual([]);
  });

  it('every registration price is its course fee plus its registration fee', async () => {
    const broken = await sql(`
      select id, price_at_registration, course_fee_at_registration, registration_fee_at_registration
      from registration
      where ${cents('price_at_registration')} <> ${cents('course_fee_at_registration + registration_fee_at_registration')}
    `);
    expect(broken).toEqual([]);
  });

  it('no registration is paid for twice, and every confirmed one is paid for once', async () => {
    const twice = await sql(`
      select pr.registration_id, count(*) as payments
      from payment_registration pr join payment p on p.id = pr.payment_id
      where p.status = 'completed' group by pr.registration_id having count(*) > 1
    `);
    expect(twice).toEqual([]);
    const unpaid = await sql(`
      select r.id from registration r
      where r.status = 'confirmed' and not exists (
        select 1 from payment_registration pr join payment p on p.id = pr.payment_id
        where pr.registration_id = r.id and p.status = 'completed')
    `);
    expect(unpaid).toEqual([]);
  });

  it('a completed payment never covers a registration that is waiting, expired or rejected', async () => {
    const broken = await sql(`
      select p.id as payment_id, p.purpose, r.id as registration_id, r.status
      from payment p
      join payment_registration pr on pr.payment_id = p.id
      join registration r on r.id = pr.registration_id
      where p.status = 'completed'
        and r.status not in ('confirmed', 'dropped', 'dropped_pending_receipt')
        and not (p.purpose = 'preregistration' and r.status = 'preregistered')
    `);
    expect(broken).toEqual([]);
  });

  it('every paid registration has its paper receipt, and a parked drop has a receipt out waiting to come back', async () => {
    const noReceipt = await sql(`
      select r.id, r.status from registration r
      where r.status in ('confirmed', 'dropped_pending_receipt')
        and not exists (select 1 from receipt rc where rc.registration_id = r.id)
    `);
    expect(noReceipt).toEqual([]);
    // A paid subject's receipt is one the desk can hand over or has handed over, never a void one (MA-20).
    const voidForPaid = await sql(`
      select r.id, rc.receipt_number from registration r join receipt rc on rc.registration_id = r.id
      where r.status = 'confirmed' and rc.status = 'void'
    `);
    expect(voidForPaid).toEqual([]);
    const parked = await sql(`
      select r.id, rc.status, rc.refund_amount_on_return, r.price_at_registration
      from registration r join receipt rc on rc.registration_id = r.id
      where r.status = 'dropped_pending_receipt'
        and (rc.status <> 'return_required' or rc.refund_amount_on_return > r.price_at_registration)
    `);
    expect(parked).toEqual([]);
  });

  it('a drop never refunds more than the registration cost', async () => {
    const broken = await sql(`
      select r.id, r.price_at_registration, sum(t.amount) as refunded
      from escrow_transaction t join registration r on r.id = t.related_registration_id
      where t.reason in ('drop', 'swap_refund') and t.type = 'credit'
      group by r.id having ${cents('sum(t.amount)')} > ${cents('r.price_at_registration')}
    `);
    expect(broken).toEqual([]);
  });

  it('cash handed over against a refund request adds up to what the request says was released', async () => {
    const broken = await sql(`
      select w.id, w.status, w.requested_amount, w.released_amount, coalesce(d.total, 0) as handed_over
      from withdrawal_request w
      left join (select withdrawal_request_id, sum(amount) as total from withdrawal_disbursement group by withdrawal_request_id) d
        on d.withdrawal_request_id = w.id
      where ${cents('coalesce(d.total, 0)')} <> ${cents('coalesce(w.released_amount, 0)')}
         or coalesce(w.released_amount, 0) > w.requested_amount
    `);
    expect(broken).toEqual([]);
  });

  it('every reversal records its day and whether the money went back, so the takings know where it belongs (MO-11)', async () => {
    // reversed_by may legitimately be empty: it is set null if that user is later deleted.
    const broken = await sql(`
      select id from payment
      where (status = 'refunded' and (reversed_at is null or reversal_money_returned is null))
         or (status <> 'refunded' and reversal_money_returned is not null)
    `);
    expect(broken).toEqual([]);
  });

  it('a transfer found after its payment closed is credited to escrow once, for exactly the amount found, and an undo takes back exactly that (MO-10, MO-24)', async () => {
    // Credits less undo debits is what is recorded now (the amount found, or
    // nothing), and there is one more "recorded" audit row than "undone".
    const broken = await sql(`
      select p.id, p.status, p.payment_method, p.late_transfer_amount, p.verification_reference,
             coalesce(c.total, 0) as credited, coalesce(c.n, 0) as credits, coalesce(u.total, 0) as undone, coalesce(u.n, 0) as undos,
             coalesce(a.n, 0) as recorded_audits, coalesce(ua.n, 0) as undone_audits
      from payment p
      left join (select related_payment_id, sum(amount) as total, count(*) as n from escrow_transaction
                 where reason = 'late_transfer' and type = 'credit' and balance_type = 'free' group by related_payment_id) c on c.related_payment_id = p.id
      left join (select related_payment_id, sum(amount) as total, count(*) as n from escrow_transaction
                 where reason = 'late_transfer_undone' and type = 'debit' and balance_type = 'free' group by related_payment_id) u on u.related_payment_id = p.id
      left join (select entity_id, count(*) as n from audit_log where action = 'PAYMENT_LATE_TRANSFER_RECORDED' group by entity_id) a on a.entity_id = p.id
      left join (select entity_id, count(*) as n from audit_log where action = 'PAYMENT_LATE_TRANSFER_UNDONE' group by entity_id) ua on ua.entity_id = p.id
      where (p.late_transfer_at is not null and (
               p.status <> 'failed' or p.payment_method <> 'instapay' or p.verification_reference is null
               or coalesce(c.n, 0) <> coalesce(u.n, 0) + 1
               or ${cents('coalesce(c.total, 0) - coalesce(u.total, 0)')} <> ${cents('p.late_transfer_amount')}
               or coalesce(a.n, 0) <> coalesce(ua.n, 0) + 1))
         or (p.late_transfer_at is null and (
               coalesce(c.n, 0) <> coalesce(u.n, 0)
               or ${cents('coalesce(c.total, 0) - coalesce(u.total, 0)')} <> 0
               or coalesce(a.n, 0) <> coalesce(ua.n, 0)))
    `);
    expect(broken).toEqual([]);
    const stray = await sql(`
      select id from escrow_transaction
      where (reason = 'late_transfer' and (related_payment_id is null or type <> 'credit'))
         or (reason = 'late_transfer_undone' and (related_payment_id is null or type <> 'debit'))
    `);
    expect(stray).toEqual([]);
  });

  it('an open payment never covers a request awaiting approval, nor only registrations that have expired (ST-03, ST-04, ST-06)', async () => {
    // Awaiting approval: a revert raced a checkout (ST-03). Only expired: the
    // payment can never be confirmed and only holds its escrow (ST-04; the
    // recovery sweep closes any such payment, ST-06).
    const onApproval = await sql(`
      select p.id, r.id as registration_id from payment p
      join payment_registration pr on pr.payment_id = p.id join registration r on r.id = pr.registration_id
      where p.status in ('pending', 'pending_verification') and r.status = 'pending_approval'
    `);
    expect(onApproval).toEqual([]);
    const onlyExpired = await sql(`
      select p.id from payment p
      where p.status in ('pending', 'pending_verification')
        and exists (select 1 from payment_registration pr where pr.payment_id = p.id)
        and not exists (
          select 1 from payment_registration pr join registration r on r.id = pr.registration_id
          where pr.payment_id = p.id and r.status <> 'expired')
    `);
    expect(onlyExpired).toEqual([]);
  });

  it('a confirmed remark fee has moved its request on: never left awaiting payment, and never on a cancelled request (ST-01)', async () => {
    const broken = await sql(`
      select p.id, rr.id as remark_id, rr.status from payment p
      join remark_request rr on rr.id = p.metadata ->> 'remarkRequestId'
      where p.purpose = 'remark' and p.status = 'completed'
        and rr.status in ('pending_approval', 'pending_consent', 'pending_payment', 'cancelled', 'rejected')
    `);
    expect(broken).toEqual([]);
  });

  it('the held wallet holds exactly the price of paid preregistrations still waiting for their session, and the deposits of live plans (MA-15, extended by the reservations rework §3.10 item 6)', async () => {
    const broken = await sql(`
      select e.student_id, e.held_balance, coalesce(h.total, 0) as funded, coalesce(d.total, 0) as deposits
      from escrow e
      left join (
        select r.student_id, sum(r.price_at_registration) as total
        from registration r
        where r.status = 'preregistered' and exists (
          select 1 from payment_registration pr join payment p on p.id = pr.payment_id
          where pr.registration_id = r.id and p.purpose = 'preregistration' and p.status = 'completed')
        group by r.student_id
      ) h on h.student_id = e.student_id
      -- A live plan's instalments, held for its line: credited, less any reversed.
      left join (
        select x.student_id, sum(case when t.type = 'credit' then t.amount else -t.amount end) as total
        from escrow_transaction t
        join escrow x on x.id = t.escrow_id
        join exception pl on pl.registration_id = t.related_registration_id and pl.policy_key = 'plan.instalments' and pl.status = 'active'
        join registration r on r.id = t.related_registration_id and r.status = 'pending_payment'
        where t.balance_type = 'held' and t.reason in ('instalment', 'instalment_reversed')
        group by x.student_id
      ) d on d.student_id = e.student_id
      where ${cents('e.held_balance')} <> ${cents('coalesce(h.total, 0) + coalesce(d.total, 0)')}
    `);
    expect(broken).toEqual([]);
  });

  it('an approved refund request has no hand-over after its approval (MA-17)', async () => {
    const broken = await sql(`
      select w.id, w.approved_at, max(d.disbursed_at) as last_hand_over
      from withdrawal_request w join withdrawal_disbursement d on d.withdrawal_request_id = w.id
      where w.approved_by is not null
      group by w.id having max(d.disbursed_at) > w.approved_at
    `);
    expect(broken).toEqual([]);
  });

  it('every payment has exactly one audit row for its creation, whichever path made it (SO-1)', async () => {
    // The desk's registration names its payment in the row's data; every other
    // path writes the row against the payment itself.
    const broken = await sql(`
      select p.id, p.purpose, p.metadata->>'desk' as desk, count(a.id) as rows
      from payment p
      left join audit_log a on (a.entity_id = p.id or a.new_data->>'paymentId' = p.id)
        and a.action in ('PAYMENT_INITIATED', 'SCHOOL_FEE_PAYMENT_INITIATED', 'DESK_SCHOOL_FEE_COLLECTED', 'REMARK_PAYMENT_INITIATED', 'DESK_REGISTRATION',
          -- The reservations rework (§3.10 items 1, 6, 8): a charge payment's creation, a plan's capture.
          'CHARGE_PAYMENT_INITIATED', 'PLAN_CAPTURED')
      group by p.id having count(a.id) <> 1
    `);
    expect(broken).toEqual([]);
  });

  it('every expired registration has exactly one audit row saying why (SO-1)', async () => {
    const broken = await sql(`
      select r.id, count(a.id) as rows
      from registration r
      left join audit_log a on a.entity_id = r.id and a.action = 'REGISTRATION_EXPIRED'
      where r.status = 'expired'
      group by r.id having count(a.id) <> 1
    `);
    expect(broken).toEqual([]);
    // And each says what the registration was waiting for, and why it expired.
    const vague = await sql(`
      select entity_id, previous_data, new_data from audit_log
      where action = 'REGISTRATION_EXPIRED'
        and (coalesce(previous_data->>'status', '') not in ('pending_approval', 'pending_payment', 'preregistered')
          or coalesce(new_data->>'reason', '') not in ('session_closed', 'entry_deadline', 'graduated', 'payment_closed', 'preregistration_unfunded_at_deadline', 'ineligible',
            -- The reservations rework (§3.1, §3.10 item 8): the six new reasons.
            'overdue', 'declaration_rejected', 'hold_unverified', 'plan_revoked', 'plan_lapsed', 'plan_ended')
          -- F0a: a student no longer eligible for the series says what changed.
          or (new_data->>'reason' = 'ineligible' and coalesce(new_data->>'detail', '') not in
            ('withdrawn', 'transferred', 'cohort_corrected', 'graduate_retakes_off', 'series_corrected', 'exception_revoked', 'exception_lapsed')))
    `);
    expect(vague).toEqual([]);
  });

  it('every capture of held money, escrow transfer and refund request has its audit row, for the same amount (SO-1)', async () => {
    const captures = await sql(`
      select t.related_registration_id, t.amount
      from escrow_transaction t
      where t.reason = 'prereg_capture' and not exists (
        select 1 from audit_log a where a.action = 'PREREG_CAPTURED' and a.entity_id = t.related_registration_id
          and ${cents(`(a.new_data->>'heldCaptured')::numeric`)} = ${cents('t.amount')})
    `);
    expect(captures).toEqual([]);
    // The reservations rework (§3.10 item 6): a plan's capture of held money has its PLAN_CAPTURED row,
    // against the capture payment, for the same amount.
    const planCaptures = await sql(`
      select t.related_payment_id, t.amount from escrow_transaction t
      where t.reason = 'plan_capture' and not exists (
        select 1 from audit_log a where a.action = 'PLAN_CAPTURED' and a.entity_id = t.related_payment_id
          and ${cents(`(a.new_data->>'heldCaptured')::numeric`)} = ${cents('t.amount')})
    `);
    expect(planCaptures).toEqual([]);
    // Every capture row, funded or not, agrees with the ledger: held money taken exactly when it says so.
    const captureRows = await sql(`
      select a.entity_id, a.new_data from audit_log a
      where a.action = 'PREREG_CAPTURED'
        and (coalesce((a.new_data->>'heldCaptured')::numeric, 0) > 0) <> exists (
          select 1 from escrow_transaction t where t.reason = 'prereg_capture' and t.related_registration_id = a.entity_id)
    `);
    expect(captureRows).toEqual([]);
    // A transfer writes two ledger rows and one audit row, against the source.
    const transfers = await sql(`
      with ledger as (
        select e.student_id, count(*) as n, ${cents('sum(t.amount)')} as total
        from escrow_transaction t join escrow e on e.id = t.escrow_id
        where t.reason = 'transfer_out' group by e.student_id
      ), audited as (
        select entity_id as student_id, count(*) as n, ${cents(`sum((new_data->>'amount')::numeric)`)} as total
        from audit_log where action = 'ESCROW_TRANSFER' group by entity_id
      )
      select coalesce(l.student_id, a.student_id) as student_id, l.n as ledger_rows, a.n as audit_rows, l.total as ledger_cents, a.total as audit_cents
      from ledger l full join audited a on a.student_id = l.student_id
      where l.n is distinct from a.n or l.total is distinct from a.total
    `);
    expect(transfers).toEqual([]);
    const requests = await sql(`
      select w.id, count(a.id) as rows
      from withdrawal_request w
      left join audit_log a on a.entity_id = w.id and a.action = 'WITHDRAWAL_REQUESTED'
      group by w.id having count(a.id) <> 1
    `);
    expect(requests).toEqual([]);
  });

  it('every paper receipt handed over, brought back or written off as lost has exactly one audit row for it (SO-1)', async () => {
    // Void is left out: a reversal voids receipts and records them in its own row.
    const broken = await sql(`
      select r.id, r.status,
             (select count(*) from audit_log a where a.entity_id = r.id and a.action = 'RECEIPT_ISSUED') as issued,
             (select count(*) from audit_log a where a.entity_id = r.id and a.action = 'RECEIPT_RETURNED') as returned,
             (select count(*) from audit_log a where a.entity_id = r.id and a.action = 'RECEIPT_LOST') as lost
      from receipt r
      where (r.issued_at is not null) <> ((select count(*) from audit_log a where a.entity_id = r.id and a.action = 'RECEIPT_ISSUED') = 1)
         or (r.status = 'returned') <> ((select count(*) from audit_log a where a.entity_id = r.id and a.action = 'RECEIPT_RETURNED') = 1)
         or (r.status = 'lost') <> ((select count(*) from audit_log a where a.entity_id = r.id and a.action = 'RECEIPT_LOST') = 1)
    `);
    expect(broken).toEqual([]);
  });

  // ─── F0b: the entry deadline is a board series' (MO-10 per series) ────────

  it('there are board series to check: windows feeding several, entries in them, entries closed at a deadline', async () => {
    const [counts] = await sql<Record<string, string>>(`
      select
        (select count(*) from (select session_id from session_board_series group by session_id having count(*) > 1) w) as windows_feeding_several_series,
        (select count(*) from registration where board_series_id is not null)                                     as entries_in_a_series,
        (select count(*) from audit_log a join registration r on r.id = a.entity_id
          where a.action = 'REGISTRATION_EXPIRED' and a.new_data->>'reason' = 'entry_deadline' and r.board_series_id is not null) as expired_at_a_series_deadline,
        (select count(*) from payment p where p.status = 'failed' and p.metadata->'failure'->>'reason' = 'The exam board''s entry deadline passed before this payment was confirmed') as payments_closed_at_a_deadline
    `);
    for (const [kind, n] of Object.entries(counts!)) expect(Number(n), kind).toBeGreaterThan(0);
  });

  it('every live registration in a window that feeds board series is entered in one of them, of its subject\'s board (F0b)', async () => {
    // The reservations rework (§8, 09 adds): and every live line has an item of its own offer —
    // the session's, of its subject — and is in its item's series; only a converted line the old
    // routing never entered (legacy.no_series) has none.
    const broken = await sql(`
      select r.id, r.status, r.board_series_id, s.council, b.board_code, i.board_series_id as item_series
      from registration r
      join subject s on s.id = r.subject_id
      join session_offer_item i on i.id = r.offer_item_id
      join session_offer o on o.id = i.offer_id
      left join board_series b on b.id = r.board_series_id
      where r.status not in ('rejected', 'expired', 'dropped')
        and (
          (r.board_series_id is null and not coalesce((r.legacy->>'no_series')::boolean, false))
          or (r.board_series_id is not null and not exists (
                select 1 from session_board_series l where l.session_id = r.session_id and l.board_series_id = r.board_series_id))
          or (b.board_code is not null and b.board_code <> s.council)
          or i.session_id <> r.session_id or o.subject_id <> r.subject_id
          or r.board_series_id is distinct from i.board_series_id
        )
    `);
    expect(broken).toEqual([]);
    // And the session's series are exactly its items' and its lines' (the links are derived).
    const strayLinks = await sql(`
      select l.session_id, l.board_series_id from session_board_series l
      where not exists (select 1 from session_offer_item i where i.session_id = l.session_id and i.board_series_id = l.board_series_id)
        and not exists (select 1 from registration r where r.session_id = l.session_id and r.board_series_id = l.board_series_id)
    `);
    expect(strayLinks).toEqual([]);
  });

  it("every line priced since the reservations rework has the price its basis says (§8: 'every line with a basis has its price equal to it')", async () => {
    const broken = await sql(`
      select id, price_at_registration, course_fee_at_registration, registration_fee_at_registration, pricing_basis->>'total' as total
      from registration
      where pricing_basis is not null
        and (${cents('price_at_registration')} <> ${cents("(pricing_basis->>'total')::numeric")}
          or ${cents('course_fee_at_registration')} <> ${cents("(pricing_basis->>'courseFee')::numeric")}
          or ${cents('registration_fee_at_registration')} <> ${cents("(pricing_basis->>'registrationFee')::numeric")})
    `);
    expect(broken).toEqual([]);
    expect(Number((await sql<{ n: string }>(`select count(*) as n from registration where pricing_basis is not null`))[0]?.n)).toBeGreaterThan(0);
  });

  it('no waiting line is still provisional when every fee row it was priced from is confirmed at the amount it recorded (a Confirm reaches every line read from its rows)', async () => {
    // Confirm clears a line whose basis rows are all confirmed at the amounts it recorded; a row
    // confirmed at another amount leaves the line to the Re-price, so it is not counted here. A
    // move racing a Confirm left the moved line provisional on a confirmed row until a second
    // Confirm (the review of 40c1447): the move now holds the new series' rows before its lines.
    const stuck = await sql(`
      select r.id, r.status, r.pricing_basis->'feeRows' as rows from registration r
      where r.price_provisional and r.status in ('pending_approval', 'pending_payment', 'preregistered')
        and jsonb_array_length(coalesce(r.pricing_basis->'feeRows', '[]'::jsonb)) > 0
        and not exists (
          select 1 from jsonb_array_elements(r.pricing_basis->'feeRows') fr
          left join board_fee f on f.id = fr->>'id'
          where f.id is null or f.provisional or ${cents('f.amount')} <> ${cents("(fr->>'amount')::numeric")})
    `);
    expect(stuck).toEqual([]);
    // There is something to check: Confirms that made waiting lines payable, and lines still waiting on a provisional row.
    expect(Number((await sql<{ n: string }>(`select count(*) as n from audit_log where action = 'BOARD_FEES_CONFIRMED' and (new_data->>'linesNoLongerProvisional')::int > 0`))[0]?.n)).toBeGreaterThan(0);
    expect(Number((await sql<{ n: string }>(`select count(*) as n from registration where price_provisional and status in ('pending_approval', 'pending_payment', 'preregistered')`))[0]?.n)).toBeGreaterThan(0);
  });

  it('one live line per student, unit or award and series, across sessions (§3.5 gate.sameEntryOnce)', async () => {
    // A line's entry keys: its award (an award or option item), each of its units, or its subject
    // row (an item entering the subject as a whole). Two live lines of a student in one series
    // never share one.
    const broken = await sql(`
      with keys as (
        select r.id, r.student_id, r.board_series_id, 'q:' || i.qualification_id as k
          from registration r join session_offer_item i on i.id = r.offer_item_id
          where i.enters_kind in ('award', 'option') and i.qualification_id is not null
        union all
        select r.id, r.student_id, r.board_series_id, 'u:' || u.unit_id
          from registration r join session_offer_item_unit u on u.item_id = r.offer_item_id
        union all
        select r.id, r.student_id, r.board_series_id, 's:' || r.subject_id
          from registration r join session_offer_item i on i.id = r.offer_item_id
          where i.enters_kind = 'subject'
      )
      select k.student_id, k.board_series_id, k.k, count(distinct k.id) as lines
      from keys k join registration r on r.id = k.id
      where r.status not in ('rejected', 'expired', 'dropped') and k.board_series_id is not null
      group by k.student_id, k.board_series_id, k.k having count(distinct k.id) > 1
    `);
    expect(broken).toEqual([]);
  });

  it("a registration expired at an entry deadline was past its own effective deadline (MO-10 per line: the retake deadline, the entry deadline or the exams' start)", async () => {
    // The reservations rework (§3.3): which date a line is cut off at is its effective deadline.
    const broken = await sql(`
      select r.id, r.board_series_id, line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) as deadline, a.created_at
      from audit_log a
      join registration r on r.id = a.entity_id
      where a.action = 'REGISTRATION_EXPIRED' and a.new_data->>'reason' in ('entry_deadline', 'preregistration_unfunded_at_deadline')
        and r.board_series_id is not null
        and coalesce(line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) > a.created_at, true)
    `);
    expect(broken).toEqual([]);
  });

  // Changed by the review of 977848d (flag 3; trail row "assertion"): F0b's rule "a registration
  // expired at an entry deadline was in a series whose entry deadline had passed" is replaced by the
  // rule above — the line's effective deadline (a retake's retake deadline, a series with no entry
  // deadline its exams' start) — which it contradicted for a series with no entry deadline.

  it("every open payment's registrations share one entry deadline (F0b: the sweep closes a payment at its series' deadline)", async () => {
    // Changed by the reservations rework (pre-authorised; trail row "assertion"): the deadline is
    // each line's effective one (a retake's retake deadline, a series with no entry deadline its
    // exams' start), which is what the sweep closes a payment at (§3.3).
    const deadline = `coalesce(line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected)::text, 'none')`;
    const broken = await sql(`
      select p.id, count(distinct ${deadline}) as deadlines
      from payment p
      join payment_registration pr on pr.payment_id = p.id
      join registration r on r.id = pr.registration_id
      where p.status in ('pending', 'pending_verification')
      group by p.id having count(distinct ${deadline}) > 1
    `);
    expect(broken).toEqual([]);
  });

  it('every series a session is entered in is in its academic year and kind, of its board (F0b)', async () => {
    // Changed by the reservations rework (pre-authorised; trail row "assertion"): the clause "a
    // window closes before the entry deadline of every series it feeds" is gone — a deadline may
    // fall inside an open session, the cut-off is per item (§3.3). The year, kind and board
    // clauses stay.
    const broken = await sql(`
      select l.session_id, l.board_series_id, w.end_date, b.entry_deadline, w.session_type, w.series_year, b.month, b.year
      from session_board_series l
      join registration_session w on w.id = l.session_id
      join board_series b on b.id = l.board_series_id
      where school_series_academic_year_start(b.month, b.year) <> school_series_academic_year_start(w.session_type, w.series_year)
         or (b.month = 'june') <> (w.session_type = 'june')
         or l.board_code <> b.board_code
    `);
    expect(broken).toEqual([]);
  });

  it('every money transition left exactly one audit row (O-7)', async () => {
    const broken = await sql(`
      select p.id, p.status, a.actions
      from payment p
      left join (
        select entity_id, string_agg(action, ',' order by action) as actions
        from audit_log
        where action in ('PAYMENT_CONFIRMED', 'PAYMENT_REVERSED', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAYMENT_REJECTED')
        group by entity_id
      ) a on a.entity_id = p.id
      where case p.status
        when 'completed' then coalesce(a.actions, '') <> 'PAYMENT_CONFIRMED'
        when 'refunded'  then coalesce(a.actions, '') <> 'PAYMENT_CONFIRMED,PAYMENT_REVERSED'
        when 'failed'    then coalesce(a.actions, '') not in ('PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAYMENT_REJECTED')
        else coalesce(a.actions, '') <> ''
      end
    `);
    expect(broken).toEqual([]);
  });

  it('F0a: nothing waits for, and nothing was captured into, a series its student may not sit', async () => {
    const { mayRegisterFor } = await import('../src/services/eligibility.services');
    const verdicts = new Map<string, boolean>();
    const allowed = async (studentId: string, sessionId: string) => {
      const key = `${studentId}|${sessionId}`;
      if (!verdicts.has(key)) verdicts.set(key, (await mayRegisterFor(studentId, sessionId)).allowed);
      return verdicts.get(key)!;
    };

    // A waiting registration of a student refused for its series, unless a
    // checkout holds it on the clean-up's own terms (eligibility.services
    // expireIneligibleRegistrations): a transfer being checked, or an
    // InstaPay checkout still inside its grace — the family may already have
    // paid, and the payment's own close releases it. Any other open checkout
    // (in school, a lapsed grace) holds nothing.
    const waiting = await sql<{ id: string; student_id: string; session_id: string; held: boolean }>(`
      select r.id, r.student_id, r.session_id,
        exists (select 1 from payment_registration pr join payment p on p.id = pr.payment_id
                where pr.registration_id = r.id
                  and (p.status = 'pending_verification' or (p.status = 'pending' and p.reference_due_at > now()))) as held
      from registration r
      where r.status in ('pending_approval', 'pending_payment')
    `);
    const stranded: string[] = [];
    for (const w of waiting) if (!w.held && !(await allowed(w.student_id, w.session_id))) stranded.push(w.id);
    expect(stranded).toEqual([]);

    // A preregistration captured (confirmed, or moved to payment) while its
    // student was already refused: refused now, and no eligibility change
    // came after the capture.
    const captured = await sql<{ id: string; student_id: string; session_id: string; at: string }>(`
      select r.id, r.student_id, r.session_id, a.created_at as at
      from audit_log a join registration r on r.id = a.entity_id
      where a.action = 'PREREG_CAPTURED'
    `);
    const capturedWhileRefused: string[] = [];
    for (const c of captured) {
      if (await allowed(c.student_id, c.session_id)) continue;
      const later = await sql(`
        select 1 from audit_log a
        where a.created_at > $1 and (
          (a.action in ('STUDENT_LEFT', 'STUDENT_COHORT_CORRECTED') and a.entity_id = $2)
          or (a.action = 'SESSION_SERIES_CORRECTED' and a.entity_id = $3)
          or (a.action = 'SETTING_CHANGED' and a.entity_id = 'eligibility.graduateRetakes')
          or (a.action in ('EXCEPTION_REVOKED', 'EXCEPTION_LAPSED') and exists (select 1 from exception e where e.id = a.entity_id and e.student_id = $4)))
        limit 1
      `, [c.at, c.student_id, c.session_id, c.student_id]);
      if (later.length === 0) capturedWhileRefused.push(c.id);
    }
    expect(capturedWhileRefused).toEqual([]);
    // There was something to check: 08e holds preregistrations of a student who left.
    expect(Number((await sql<{ n: string }>(`select count(*) as n from audit_log where action = 'PREREG_HELD_INELIGIBLE'`))[0]?.n)).toBeGreaterThan(0);
  });

  it('F7: money from before the system is history only — traced to a committed import line, and never written with a payment, a ledger entry or a receipt', async () => {
    // There is money history to check: 08n imports the sheet's fee notes and a money record.
    expect(Number((await sql<{ n: string }>(`select count(*) as n from money_history`))[0]?.n)).toBeGreaterThan(0);
    // Every row points to the line it came from, and that line was committed.
    const untraced = await sql(`
      select m.id from money_history m left join import_row r on r.id = m.import_row_id
      where r.id is null or r.status <> 'committed' or r.batch_id <> m.import_batch_id or m.source_ref = ''
    `);
    expect(untraced).toEqual([]);
    // No transaction that wrote money history also wrote a payment, a payment's registrations,
    // an escrow ledger entry or a receipt (rows a transaction inserts carry its id in xmin; the
    // ledger and the payment links are never updated, so theirs is always the inserting one).
    const moved = await sql(`
      select m.id from money_history m
      where exists (select 1 from escrow_transaction t where t.xmin = m.xmin)
         or exists (select 1 from payment_registration pr where pr.xmin = m.xmin)
         or exists (select 1 from payment p where p.xmin = m.xmin)
         or exists (select 1 from receipt rc where rc.xmin = m.xmin)
    `);
    expect(moved).toEqual([]);
  });

  // ─── The reservations rework, step C: charges, plans, the registry (RESERVATIONS_MONEY.md §6) ───

  it('there are charges, plans and exceptions to check: every kind happened in the suites above', async () => {
    const [counts] = await sql<Record<string, string>>(`
      select
        (select count(*) from payment where purpose = 'charge' and status = 'completed')                  as charge_payments_completed,
        (select count(*) from payment where purpose = 'charge' and status = 'refunded')                   as charge_payments_reversed,
        (select count(*) from payment where purpose = 'charge' and status = 'failed')                     as charge_payments_failed,
        (select count(*) from charge where status = 'refunded')                                           as charges_refunded,
        (select count(*) from charge where kind = 'school_fee_push' and status = 'paid')                  as pushes_settled,
        (select count(*) from charge where kind = 'school_fee_push' and status = 'cancelled')             as pushes_waived,
        (select count(*) from audit_log where action = 'CHARGE_CLOSED_AT_DEADLINE')                       as charges_closed_at_deadline,
        (select count(*) from escrow_transaction where reason = 'instalment')                            as instalments_held,
        (select count(*) from escrow_transaction where reason = 'instalment_reversed')                   as instalments_reversed,
        (select count(*) from escrow_transaction where reason = 'plan_capture')                          as plans_captured,
        (select count(*) from escrow_transaction where reason = 'plan_forfeit')                          as plans_forfeited,
        (select count(*) from escrow_transaction where reason = 'plan_release')                          as plans_released,
        (select count(*) from exception where policy_key = 'plan.instalments' and status = 'active')     as plans_live,
        (select count(*) from exception where status = 'used')                                           as one_shot_used,
        (select count(*) from exception where family_id is not null)                                     as family_exceptions,
        (select count(*) from audit_log where action = 'DESK_DROP_EXECUTED')                              as desk_drops,
        (select count(*) from receipt where charge_id is not null)                                       as charge_receipts
    `);
    for (const [kind, n] of Object.entries(counts!)) expect(Number(n), kind).toBeGreaterThan(0);
  });

  it('a charge payment charges exactly the sum of its charges (§3.10 item 1)', async () => {
    const broken = await sql(`
      select p.id, p.amount, p.escrow_amount_applied, sum(c.amount) as charges
      from payment p join payment_charge pc on pc.payment_id = p.id join charge c on c.id = pc.charge_id
      where p.purpose = 'charge'
      group by p.id
      having ${cents('p.amount + p.escrow_amount_applied')} <> ${cents('sum(c.amount)')}
    `);
    expect(broken).toEqual([]);
    // One purpose per payment: a charge payment covers charges only, and nothing else covers a charge.
    const mixed = await sql(`
      select p.id, p.purpose from payment p
      where (p.purpose = 'charge' and (exists (select 1 from payment_registration pr where pr.payment_id = p.id)
                                     or not exists (select 1 from payment_charge pc where pc.payment_id = p.id)))
         or (p.purpose <> 'charge' and exists (select 1 from payment_charge pc where pc.payment_id = p.id))
    `);
    expect(mixed).toEqual([]);
  });

  it("an open charge payment's charges share one deadline; an instalment payment covers one plan's line (§3.10 item 1)", async () => {
    const deadline = `coalesce(charge_effective_deadline(c.kind, c.registration_id, c.board_series_id, c.board_service_id)::text, 'none')`;
    const broken = await sql(`
      select p.id, count(distinct ${deadline}) as deadlines,
             count(distinct case when c.kind = 'instalment' then c.registration_id end) as plan_lines,
             bool_or(c.kind = 'instalment') and bool_or(c.kind <> 'instalment') as mixed
      from payment p join payment_charge pc on pc.payment_id = p.id join charge c on c.id = pc.charge_id
      where p.status in ('pending', 'pending_verification')
      group by p.id
      having count(distinct ${deadline}) > 1 or count(distinct case when c.kind = 'instalment' then c.registration_id end) > 1
         or (bool_or(c.kind = 'instalment') and bool_or(c.kind <> 'instalment'))
    `);
    expect(broken).toEqual([]);
  });

  it('no charge is paid twice and every paid charge once; a pushed school fee by its settling school-fee payment, never as a charge (§3.10 item 1)', async () => {
    const twice = await sql(`
      select pc.charge_id, count(*) as payments from payment_charge pc join payment p on p.id = pc.payment_id
      where p.status = 'completed' group by pc.charge_id having count(*) > 1
    `);
    expect(twice).toEqual([]);
    const paidUnpaid = await sql(`
      select c.id, c.kind, c.status,
        (select count(*) from payment_charge pc join payment p on p.id = pc.payment_id where pc.charge_id = c.id and p.status = 'completed') as completed
      from charge c
      where c.kind <> 'school_fee_push'
        and ((c.status in ('paid', 'refunded')) <> exists (
          select 1 from payment_charge pc join payment p on p.id = pc.payment_id where pc.charge_id = c.id and p.status = 'completed'))
    `);
    expect(paidUnpaid).toEqual([]);
    const pushes = await sql(`
      select c.id, c.status, c.settled_by_payment_id, p.status as payment_status, p.purpose, p.academic_year, p.student_id = c.student_id as same_student
      from charge c left join payment p on p.id = c.settled_by_payment_id
      where c.kind = 'school_fee_push'
        and ((c.status = 'paid') <> (p.id is not null and p.status = 'completed' and p.purpose = 'school_fee' and p.academic_year = c.academic_year and p.student_id = c.student_id)
          or (c.status <> 'paid' and c.settled_by_payment_id is not null)
          or exists (select 1 from payment_charge pc where pc.charge_id = c.id))
    `);
    expect(pushes).toEqual([]);
    // An open push is never left on a year whose fee is already paid (the confirmation settles it under the student's lock).
    const stale = await sql(`
      select c.id from charge c
      where c.kind = 'school_fee_push' and c.status = 'pending_payment' and exists (
        select 1 from payment p where p.student_id = c.student_id and p.purpose = 'school_fee' and p.academic_year = c.academic_year and p.status = 'completed')
    `);
    expect(stale).toEqual([]);
  });

  it("a charge's refund never exceeds it, and escrow was credited exactly the refund (§3.10 item 3)", async () => {
    const broken = await sql(`
      select c.id, c.amount, c.refund_amount, coalesce(t.total, 0) as credited
      from charge c
      left join (select related_charge_id, sum(amount) as total from escrow_transaction where reason = 'charge_refund' and type = 'credit' group by related_charge_id) t
        on t.related_charge_id = c.id
      where (c.refund_amount is not null and c.refund_amount > c.amount)
         or ${cents('coalesce(t.total, 0)')} <> ${cents('coalesce(c.refund_amount, 0)')}
    `);
    expect(broken).toEqual([]);
    const stray = await sql(`select id from escrow_transaction where reason = 'charge_refund' and (related_charge_id is null or type <> 'credit')`);
    expect(stray).toEqual([]);
  });

  it('every paid charge has its paper receipt, never a void one — an instalment its deposit slip instead (§3.10 item 2)', async () => {
    const broken = await sql(`
      select c.id, c.kind, c.status, r.status as receipt_status
      from charge c left join receipt r on r.charge_id = c.id
      where (c.kind not in ('instalment', 'school_fee_push') and c.status = 'paid' and (r.id is null or r.status = 'void'))
         or (c.kind in ('instalment', 'school_fee_push') and r.id is not null)
    `);
    expect(broken).toEqual([]);
    const slips = await sql(`
      select p.id from payment p
      where p.purpose = 'charge' and p.status in ('completed', 'refunded')
        and exists (select 1 from payment_charge pc join charge c on c.id = pc.charge_id where pc.payment_id = p.id and c.kind = 'instalment')
        and coalesce(p.metadata->>'depositSlip', '') = ''
    `);
    expect(slips).toEqual([]);
  });

  it("an instalment's payment credited the held wallet for exactly its amount, earmarked for its line, and its reversal took exactly that back (§3.6, §3.10 item 6)", async () => {
    const broken = await sql(`
      select p.id, p.status, p.amount, p.escrow_amount_applied, line.id as line, coalesce(cr.total, 0) as credited, coalesce(db.total, 0) as reversed
      from payment p
      join lateral (select c.registration_id as id from payment_charge pc join charge c on c.id = pc.charge_id
                    where pc.payment_id = p.id and c.kind = 'instalment' limit 1) line on true
      left join (select related_payment_id, related_registration_id, sum(amount) as total from escrow_transaction
                 where reason = 'instalment' and type = 'credit' and balance_type = 'held' group by related_payment_id, related_registration_id) cr
        on cr.related_payment_id = p.id
      left join (select related_payment_id, sum(amount) as total from escrow_transaction
                 where reason = 'instalment_reversed' and type = 'debit' and balance_type = 'held' group by related_payment_id) db
        on db.related_payment_id = p.id
      where p.escrow_amount_applied <> 0
         or ${cents('coalesce(cr.total, 0)')} <> case when p.status in ('completed', 'refunded') then ${cents('p.amount')} else 0 end
         or (cr.related_registration_id is not null and cr.related_registration_id <> line.id)
         or ${cents('coalesce(db.total, 0)')} <> case when p.status = 'refunded' then ${cents('p.amount')} else 0 end
    `);
    expect(broken).toEqual([]);
  });

  it("a line under a plan is confirmed only by one payment capturing its held deposits, equal to its price (§3.10 item 6)", async () => {
    const broken = await sql(`
      select r.id, r.status, r.price_at_registration, count(p.id) as payments,
             bool_and(p.payment_method = 'held_deposits') as by_capture, sum(p.escrow_amount_applied) as applied, sum(p.amount) as cash
      from exception pl
      join registration r on r.id = pl.registration_id
      left join payment_registration pr on pr.registration_id = r.id
      left join payment p on p.id = pr.payment_id and p.status = 'completed'
      where pl.policy_key = 'plan.instalments' and pl.status = 'used'
      group by r.id
      having count(p.id) <> 1 or not bool_and(p.payment_method = 'held_deposits')
         or ${cents('sum(p.escrow_amount_applied)')} <> ${cents('r.price_at_registration')} or ${cents('sum(p.amount)')} <> 0
    `);
    expect(broken).toEqual([]);
    // And a capture payment is a plan's: its line had a used plan, its debit is plan_capture.
    const stray = await sql(`
      select p.id from payment p
      where p.payment_method = 'held_deposits' and (p.purpose <> 'registration' or p.status <> 'completed' or not exists (
        select 1 from payment_registration pr join exception pl on pl.registration_id = pr.registration_id
        where pr.payment_id = p.id and pl.policy_key = 'plan.instalments' and pl.status = 'used'))
    `);
    expect(stray).toEqual([]);
  });

  it("a plan's deposits end as exactly one capture, or at most one release and one forfeit summing to them; a live plan's are all still held (§3.10 item 6)", async () => {
    const broken = await sql(`
      with ledger as (
        select t.related_registration_id as line,
          sum(case when t.reason = 'instalment' then t.amount when t.reason = 'instalment_reversed' then -t.amount else 0 end) as deposits,
          sum(case when t.reason = 'plan_capture' then t.amount else 0 end) as captured, count(*) filter (where t.reason = 'plan_capture') as captures,
          sum(case when t.reason = 'plan_forfeit' then t.amount else 0 end) as forfeited, count(*) filter (where t.reason = 'plan_forfeit') as forfeits,
          sum(case when t.reason = 'plan_release' then t.amount else 0 end) as released, count(*) filter (where t.reason = 'plan_release') as releases
        from escrow_transaction t
        where t.balance_type = 'held' and t.related_registration_id is not null
          and t.reason in ('instalment', 'instalment_reversed', 'plan_capture', 'plan_forfeit', 'plan_release')
        group by t.related_registration_id
      )
      select pl.id, pl.status, l.*
      from exception pl join ledger l on l.line = pl.registration_id
      where pl.policy_key = 'plan.instalments'
        and case
          when pl.status = 'used' then l.captures <> 1 or ${cents('l.captured')} <> ${cents('l.deposits')} or l.forfeits + l.releases > 0
          when pl.status = 'active' then l.captures + l.forfeits + l.releases > 0
          else l.captures > 0 or l.forfeits > 1 or l.releases > 1 or ${cents('l.forfeited + l.released')} <> ${cents('l.deposits')}
        end
    `);
    expect(broken).toEqual([]);
    // A release to free escrow is a held debit and a free credit of the same amount, both for the line.
    const releases = await sql(`
      select h.related_registration_id, h.amount as held, f.amount as free
      from escrow_transaction h
      left join escrow_transaction f on f.related_registration_id = h.related_registration_id and f.reason = 'plan_release' and f.balance_type = 'free' and f.type = 'credit'
      where h.reason = 'plan_release' and h.balance_type = 'held'
        and (f.id is null or ${cents('f.amount')} <> ${cents('h.amount')})
    `);
    expect(releases).toEqual([]);
    // PLAN_SETTLED says what the ledger did: kept is the forfeit, released the release.
    const settled = await sql(`
      select a.entity_id, a.new_data from audit_log a
      where a.action = 'PLAN_SETTLED' and (
        ${cents(`coalesce((a.new_data->>'kept')::numeric, 0)`)} <> ${cents(`coalesce((select sum(t.amount) from escrow_transaction t where t.reason = 'plan_forfeit' and t.related_registration_id = a.entity_id), 0)`)}
        or ${cents(`coalesce((a.new_data->>'released')::numeric, 0)`)} <> ${cents(`coalesce((select sum(t.amount) from escrow_transaction t where t.reason = 'plan_release' and t.balance_type = 'held' and t.related_registration_id = a.entity_id), 0)`)})
    `);
    expect(settled).toEqual([]);
    // Every plan that ended was settled once (its PLAN_SETTLED row), every live or used one never.
    const settlements = await sql(`
      select pl.id, pl.status, (select count(*) from audit_log a where a.action = 'PLAN_SETTLED' and a.new_data->>'planId' = pl.id) as rows
      from exception pl where pl.policy_key = 'plan.instalments'
        and (select count(*) from audit_log a where a.action = 'PLAN_SETTLED' and a.new_data->>'planId' = pl.id) <> case when pl.status in ('revoked', 'lapsed') then 1 else 0 end
    `);
    expect(settlements).toEqual([]);
  });

  it('a plan settled keeps at most its deposits and at most the line\'s price (§3.6)', async () => {
    // What a paid drop that day would keep is computed by refundFor at the settlement (08q's worked example proves it);
    // this rule checks the two bounds every settlement must hold over every row.
    const broken = await sql(`
      select a.entity_id, a.new_data from audit_log a
      where a.action = 'PLAN_SETTLED'
        and ((a.new_data->>'kept')::numeric > (a.new_data->>'deposits')::numeric or (a.new_data->>'kept')::numeric > (a.new_data->>'price')::numeric)
    `);
    expect(broken).toEqual([]);
  });

  it('every one-shot gate exception is used at most once, by the reservation it let through (§8)', async () => {
    const broken = await sql(`
      select e.id, e.policy_key, e.status, e.used_at, (select count(*) from audit_log a where a.action = 'EXCEPTION_USED' and a.entity_id = e.id) as rows
      from exception e
      where (e.status = 'used' and e.policy_key <> 'plan.instalments'
              and (e.used_at is null or jsonb_array_length(coalesce(e.used_for->'registrationIds', '[]'::jsonb)) = 0
                or (select count(*) from audit_log a where a.action = 'EXCEPTION_USED' and a.entity_id = e.id) <> 1))
         or (e.status <> 'used' and (select count(*) from audit_log a where a.action = 'EXCEPTION_USED' and a.entity_id = e.id) <> 0)
    `);
    expect(broken).toEqual([]);
    // And only a one-shot gate (or a captured plan) is ever used.
    const notOneShot = await sql(`
      select id, policy_key from exception where status = 'used'
        and policy_key not in ('gate.selfStudyFirstEntry', 'gate.availability', 'gate.requiredItems', 'gate.priorSeries', 'gate.exclusiveItems', 'gate.sameEntryOnce', 'plan.instalments')
    `);
    expect(notOneShot).toEqual([]);
  });

  it("every exception carries a policy of the registry, its value in its policy's own column, and the scope the policy accepts (§3.7)", async () => {
    const { POLICIES, SCOPE_FIELD } = await import('@repo/validations');
    const column: Record<string, string> = {
      sessionId: 'session_id', subjectId: 'subject_id', offerId: 'offer_id', offerItemId: 'offer_item_id', registrationId: 'registration_id',
      chargeId: 'charge_id', boardSeriesId: 'board_series_id', academicYear: 'academic_year',
    };
    const rows = await sql<Record<string, string | null>>(`select * from exception`);
    const problems: string[] = [];
    for (const r of rows) {
      const p = (POLICIES as Record<string, { valueType: string; scopes: readonly string[] }>)[r.policy_key!];
      if (!p) { problems.push(`${r.id}: unknown policy ${r.policy_key}`); continue; }
      const has = { number: r.value_number !== null, date: r.value_date !== null, json: r.value_json !== null };
      const ok = p.valueType === 'none' ? !has.number && !has.date && !has.json
        : p.valueType === 'percent' || p.valueType === 'amount' ? has.number && !has.date && !has.json
          : p.valueType === 'date' ? has.date && !has.number && !has.json
            : has.json && !has.number && !has.date;
      if (!ok) problems.push(`${r.id}: ${r.policy_key} value columns ${JSON.stringify(has)}`);
      const allowed = new Set(p.scopes.map((sc) => column[(SCOPE_FIELD as Record<string, string>)[sc]!]));
      // A migrated exception whose scope the registry no longer reads the same way waits under
      // "Check these" (check_reason) with the scope it had (§3.7): not an error.
      if (r.check_reason) continue;
      for (const col of Object.values(column)) if (r[col] && !allowed.has(col)) problems.push(`${r.id}: ${r.policy_key} narrowed by ${col}`);
    }
    expect(problems).toEqual([]);
  });

  it('every charge has one creation row; every desk drop was past its line\'s deadline (§3.3, §3.6)', async () => {
    const broken = await sql(`
      select c.id, count(a.id) as rows from charge c
      left join audit_log a on a.entity_id = c.id and a.action in ('CHARGE_CREATED', 'CHARGE_REQUESTED')
      group by c.id having count(a.id) <> 1
    `);
    expect(broken).toEqual([]);
    const early = await sql(`
      select a.entity_id from audit_log a join registration r on r.id = a.entity_id
      where a.action = 'DESK_DROP_EXECUTED'
        and coalesce(line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) > a.created_at, true)
    `);
    expect(early).toEqual([]);
  });

  // ─── The reservations rework, step B (docs/features/RESERVATIONS_LINES.md §7) ──────────────

  it('every line confirmed since the rework has its two consents, the refund policy and the declaration (§3.5, §8)', async () => {
    // A line that is or was confirmed (paid, or captured from a preregistration); a line converted
    // from before the rework was consented to on the school's paper form.
    const broken = await sql(`
      select r.id, r.status from registration r
      where not (r.legacy is not null and r.legacy ? 'converted')
        and (r.status in ('confirmed', 'dropped_pending_receipt')
          or exists (select 1 from audit_log a where a.entity_id = r.id and a.action in ('REGISTRATION_CONFIRMED', 'PREREG_CAPTURED')))
        and (select count(distinct c.kind) from registration_consent c where c.registration_id = r.id) < 2
    `);
    expect(broken).toEqual([]);
    // There was something to check: lines confirmed with their consents, on the app and the desk channel.
    const [n] = await sql<{ app: string; desk: string }>(`
      select count(distinct c.registration_id) filter (where c.channel = 'app') as app, count(distinct c.registration_id) filter (where c.channel = 'desk') as desk
      from registration_consent c join registration r on r.id = c.registration_id where r.status = 'confirmed'`);
    expect(Number(n?.app)).toBeGreaterThan(0);
    expect(Number(n?.desk)).toBeGreaterThan(0);
  });

  it('a line the family or the desk consented to has its refund steps frozen, as weeks or as dates (§3.1, §2.6)', async () => {
    const broken = await sql(`
      select r.id, r.refund_policy_snapshot from registration r
      where exists (select 1 from registration_consent c where c.registration_id = r.id and c.channel in ('app', 'desk', 'imported'))
        and (r.refund_policy_snapshot is null or coalesce(r.refund_policy_snapshot->>'kind', '') not in ('weeks', 'dates'))
    `);
    expect(broken).toEqual([]);
  });

  it('a declared sitting is answered once, by someone, and only a paid line stands with its declaration rejected (§3.5)', async () => {
    // Answered: who and when; a declared one only (the database checks the outcome's who and when).
    const answered = await sql(`
      select r.id from registration r
      where r.prior_sitting_verified_outcome is not null
        and (r.prior_sitting_verified_by is null or r.prior_sitting_source not in ('declared_by_family', 'declared_by_desk'))
    `);
    expect(answered).toEqual([]);
    // One answer each: one PRIOR_SITTING_VERIFIED or PRIOR_SITTING_REJECTED row per answered line.
    const rows = await sql(`
      select r.id, count(a.id) as n from registration r
      left join audit_log a on a.entity_id = r.id and a.action in ('PRIOR_SITTING_VERIFIED', 'PRIOR_SITTING_REJECTED')
      where r.prior_sitting_verified_outcome is not null
      group by r.id having count(a.id) <> 1
    `);
    expect(rows).toEqual([]);
    // Standing rejected: paid (confirmed, a paid preregistration), since dropped through the receipt
    // gate, or paid when rejected (a payment confirmed before the answer) and that payment reversed
    // after it — a reversal undoes the payment, not the answer (08t's reversal race) — the line then
    // waiting for payment again, or expired at its deadline since.
    const standing = await sql(`
      select r.id, r.status from registration r
      where r.declaration_rejected
        and not (r.status in ('confirmed', 'dropped', 'dropped_pending_receipt')
          or (r.status = 'preregistered' and exists (select 1 from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = r.id and p.status = 'completed'))
          or (r.status in ('pending_payment', 'expired')
              and exists (select 1 from payment_registration pr join payment p on p.id = pr.payment_id
                          where pr.registration_id = r.id and p.status = 'refunded'
                            and p.confirmed_at is not null and p.confirmed_at <= r.prior_sitting_verified_at
                            and p.reversed_at is not null and p.reversed_at >= r.prior_sitting_verified_at)))
    `);
    expect(standing).toEqual([]);
    // An expiry or a system drop on a declared sitting followed from it: rejected, or unverified under hold.
    const ends = await sql(`
      select a.entity_id, a.action, a.new_data->>'reason' as reason from audit_log a join registration r on r.id = a.entity_id
      where ((a.action = 'REGISTRATION_EXPIRED' and a.new_data->>'reason' = 'declaration_rejected') and r.prior_sitting_verified_outcome is distinct from 'rejected')
         or ((a.action = 'LINE_DROPPED_UNVERIFIED' or (a.action = 'REGISTRATION_EXPIRED' and a.new_data->>'reason' = 'hold_unverified'))
           and (r.prior_sitting_verified_outcome is not null or r.prior_sitting_source not in ('declared_by_family', 'declared_by_desk')))
    `);
    expect(ends).toEqual([]);
    // A line the system dropped on a declared sitting (rejected after the first-entry deadline, or
    // unverified under hold) was refunded at most its price: the escrow credits for its drop plus a
    // refund still parked on its receipt.
    const overRefunded = await sql(`
      select r.id, r.price_at_registration as price,
        coalesce((select sum(e.amount) from escrow_transaction e where e.related_registration_id = r.id and e.reason = 'drop'), 0)
          + coalesce((select rc.refund_amount_on_return from receipt rc where rc.registration_id = r.id and rc.status = 'return_required'), 0) as refunded
      from registration r
      where exists (select 1 from audit_log a where a.entity_id = r.id
                    and (a.action = 'LINE_DROPPED_UNVERIFIED' or (a.action = 'PRIOR_SITTING_REJECTED' and a.new_data->>'effect' = 'dropped')))
        and coalesce((select sum(e.amount) from escrow_transaction e where e.related_registration_id = r.id and e.reason = 'drop'), 0)
          + coalesce((select rc.refund_amount_on_return from receipt rc where rc.registration_id = r.id and rc.status = 'return_required'), 0) > r.price_at_registration
    `);
    expect(overRefunded).toEqual([]);
    // There was something to check: answers and system drops on declared sittings.
    expect(Number((await sql<{ n: string }>(`select count(*) as n from audit_log where action in ('PRIOR_SITTING_VERIFIED', 'PRIOR_SITTING_REJECTED')`))[0]?.n)).toBeGreaterThan(0);
    expect(Number((await sql<{ n: string }>(`select count(*) as n from audit_log where action = 'LINE_DROPPED_UNVERIFIED' or (action = 'PRIOR_SITTING_REJECTED' and new_data->>'effect' = 'dropped')`))[0]?.n)).toBeGreaterThan(0);
  });
});
