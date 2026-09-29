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
                 where reason = 'payment' and type = 'debit' group by related_payment_id) d on d.related_payment_id = p.id
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

  it('the held wallet holds exactly the price of paid preregistrations still waiting for their session (MA-15)', async () => {
    const broken = await sql(`
      select e.student_id, e.held_balance, coalesce(h.total, 0) as funded
      from escrow e
      left join (
        select r.student_id, sum(r.price_at_registration) as total
        from registration r
        where r.status = 'preregistered' and exists (
          select 1 from payment_registration pr join payment p on p.id = pr.payment_id
          where pr.registration_id = r.id and p.purpose = 'preregistration' and p.status = 'completed')
        group by r.student_id
      ) h on h.student_id = e.student_id
      where ${cents('e.held_balance')} <> ${cents('coalesce(h.total, 0)')}
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
        and a.action in ('PAYMENT_INITIATED', 'SCHOOL_FEE_PAYMENT_INITIATED', 'DESK_SCHOOL_FEE_COLLECTED', 'REMARK_PAYMENT_INITIATED', 'DESK_REGISTRATION')
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
          or coalesce(new_data->>'reason', '') not in ('session_closed', 'entry_deadline', 'graduated', 'payment_closed', 'preregistration_unfunded_at_deadline', 'ineligible')
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
});
