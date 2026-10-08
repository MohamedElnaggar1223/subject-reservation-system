/**
 * Which lines have a payment history, so their price no longer changes on its own (§3.4, §3.6;
 * docs/features/RESERVATIONS.md §2.12).
 *
 * A line's price is what its payment charges: once money has been taken or is being taken for it,
 * a re-price would leave a payment for a price the line no longer has. Money for a line comes on
 * three paths, and each counts:
 * - a payment of the line itself (`payment_registration`, any status: open, failed or paid);
 * - a live instalment plan on the line: its deposits sit in the held wallet, earmarked for the
 *   line, and the capture pays exactly the line's price from them — a re-price would leave the
 *   deposits short of it and the capture refused for ever;
 * - a charge against the line (an instalment, a price adjustment, a service for the line) that is
 *   paid, refunded, or has a payment open.
 *
 * Every path that re-prices a waiting line asks this first and lists the line instead of
 * re-pricing it: the board fee's re-price (`repriceLines`), a series move (`repriceMovedLines`),
 * and a price exception on one line granted or revoked (exception.services).
 */

import { db, sql } from '@repo/db';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type PaymentHistory = 'payment' | 'plan' | 'charge';

/** Why each line keeps its price (the first that applies: its own payment, a live plan, a charge). */
export const PAYMENT_HISTORY_REASON: Record<PaymentHistory, string> = {
  payment: 'has a payment (open, failed or paid)',
  plan: 'is paid by its instalment plan',
  charge: 'has a charge against it paid or being paid',
};

export async function paymentHistoryOf(executor: Executor, lineIds: readonly string[]): Promise<Map<string, PaymentHistory>> {
  const out = new Map<string, PaymentHistory>();
  if (!lineIds.length) return out;
  const ids = sql.join(lineIds.map((id) => sql`${id}`), sql`, `);
  const rows = await executor.execute(sql`
    select pr.registration_id as id, 1 as rank, 'payment' as kind from payment_registration pr where pr.registration_id in (${ids})
    union all
    select e.registration_id, 2, 'plan' from exception e
      where e.policy_key = 'plan.instalments' and e.status = 'active' and e.registration_id in (${ids})
    union all
    select c.registration_id, 3, 'charge' from charge c
      where c.registration_id in (${ids})
        and (c.status in ('paid', 'refunded') or exists (
          select 1 from payment_charge pc join payment p on p.id = pc.payment_id
          where pc.charge_id = c.id and p.status in ('pending', 'pending_verification', 'completed')))
    order by 2`);
  for (const r of rows.rows as { id: string; kind: PaymentHistory }[]) if (!out.has(r.id)) out.set(r.id, r.kind);
  return out;
}

export async function lineIdsWithPaymentHistory(executor: Executor, lineIds: readonly string[]): Promise<Set<string>> {
  return new Set((await paymentHistoryOf(executor, lineIds)).keys());
}

/** The live instalment plan on a line, if any (for a refusal that names it). */
export async function livePlanOf(executor: Executor, lineId: string) {
  const rows = await executor.execute(sql`
    select e.id, e.created_at, jsonb_array_length(coalesce(e.value_json, '[]'::jsonb)) as instalments
    from exception e
    where e.policy_key = 'plan.instalments' and e.status = 'active' and e.registration_id = ${lineId}
    limit 1`);
  return (rows.rows as { id: string; created_at: string; instalments: number }[])[0] ?? null;
}
