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
        (select count(*) from registration where status = 'dropped_pending_receipt' or status = 'dropped') as drops
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

  it('every reversal records when and by whom, so its day in the takings is known', async () => {
    const broken = await sql(`select id from payment where status = 'refunded' and (reversed_at is null or reversed_by is null)`);
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
});
