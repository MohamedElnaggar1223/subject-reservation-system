/**
 * Which exceptions touched each line (RESERVATIONS_REWORK.md §4.7: "each line shows the
 * exceptions applied to it"): those its price applied (its pricing basis' ids), those scoped to
 * the line itself (a price, a due date, a refund's start, a plan), and the one-shot gates it used.
 * The Student 360 (GET /users/:id/summary) returns them per line; step B's Statement and Reserve
 * pages read the same through `exceptionsOfLines`.
 */

import { db, sql } from '@repo/db';
import { POLICIES, isRegistryPolicyKey } from '@repo/validations';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type LineException = { id: string; policyKey: string; label: string; status: string; how: 'priced' | 'scoped' | 'used' };

export async function exceptionsOfLines(executor: Executor, lines: { id: string; pricingBasis: unknown }[]): Promise<Map<string, LineException[]>> {
  const out = new Map<string, LineException[]>(lines.map((l) => [l.id, []]));
  if (!lines.length) return out;
  const priced = new Map<string, string[]>();
  for (const l of lines) {
    const ids = (l.pricingBasis as { exceptionIds?: string[] } | null)?.exceptionIds ?? [];
    for (const id of ids) priced.set(id, [...(priced.get(id) ?? []), l.id]);
  }
  const lineIds = sql.join(lines.map((l) => sql`${l.id}`), sql`, `);
  const pricedIds = [...priced.keys()];
  const rows = await executor.execute(sql`
    select e.id, e.policy_key, e.status, e.registration_id, e.used_for
    from exception e
    where e.registration_id in (${lineIds})
       or exists (select 1 from jsonb_array_elements_text(coalesce(e.used_for->'registrationIds', '[]'::jsonb)) u(id) where u.id in (${lineIds}))
       ${pricedIds.length ? sql`or e.id in (${sql.join(pricedIds.map((id) => sql`${id}`), sql`, `)})` : sql``}`);
  for (const r of rows.rows as { id: string; policy_key: string; status: string; registration_id: string | null; used_for: { registrationIds?: string[] } | null }[]) {
    const label = isRegistryPolicyKey(r.policy_key) ? POLICIES[r.policy_key].label : r.policy_key;
    const add = (lineId: string, how: LineException['how']) => {
      const list = out.get(lineId);
      if (list && !list.some((x) => x.id === r.id)) list.push({ id: r.id, policyKey: r.policy_key, label, status: r.status, how });
    };
    for (const lineId of priced.get(r.id) ?? []) add(lineId, 'priced');
    if (r.registration_id) add(r.registration_id, 'scoped');
    for (const lineId of r.used_for?.registrationIds ?? []) add(lineId, 'used');
  }
  return out;
}
