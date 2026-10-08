/**
 * Which lines have a payment history, so their price no longer changes on its own (§3.4, §3.6).
 *
 * A line's price is what its payment charges: once money has been taken or is being taken for it,
 * a re-price would leave a payment for a price the line no longer has. Money for a line comes on
 * three paths, and each counts:
 * - a payment of the line itself (`payment_registration`, any status: open, failed or paid — A's
 *   rule for the board fee's re-price);
 * - a live instalment plan on the line: its deposits sit in the held wallet, earmarked for the
 *   line, and the capture pays exactly the line's price from them — a re-price would leave the
 *   deposits short of it and the capture refused for ever;
 * - a charge against the line (an instalment, a price adjustment, a service for the line) that is
 *   paid, refunded, or has a payment open.
 *
 * Every path that re-prices a waiting line asks this first and lists the line instead of
 * re-pricing it: a price exception on one line granted or revoked (exception.services), and —
 * once A's step is on main — the board fee's re-price and the series move (RESERVATIONS.md §2.12).
 */

import { db, sql } from '@repo/db';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export async function lineIdsWithPaymentHistory(executor: Executor, lineIds: readonly string[]): Promise<Set<string>> {
  if (!lineIds.length) return new Set();
  const ids = sql.join(lineIds.map((id) => sql`${id}`), sql`, `);
  const rows = await executor.execute(sql`
    select pr.registration_id as id from payment_registration pr where pr.registration_id in (${ids})
    union
    select e.registration_id from exception e
      where e.policy_key = 'plan.instalments' and e.status = 'active' and e.registration_id in (${ids})
    union
    select c.registration_id from charge c
      where c.registration_id in (${ids})
        and (c.status in ('paid', 'refunded') or exists (
          select 1 from payment_charge pc join payment p on p.id = pc.payment_id
          where pc.charge_id = c.id and p.status in ('pending', 'pending_verification', 'completed')))`);
  return new Set((rows.rows as { id: string }[]).map((r) => r.id));
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
