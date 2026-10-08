/**
 * The exception adapter (docs/features/RESERVATIONS.md §2.8), over the policy registry.
 *
 * `priceLine`, `assertLineRules` and `dueDateFor` read the student's exceptions only through
 * `lineExceptions`. Step A's implementation read the V3 `exception` table by type; step C replaced
 * it with the registry (RESERVATIONS_REWORK.md §3.7, exception-registry.services.ts), keeping the
 * interface: active exceptions of the keys asked, held by the student or by their family, whose
 * scope covers the line; one-shot gates locked FOR UPDATE and marked used in the caller's
 * transaction; a re-price's exact ids whatever their status now.
 *
 * One addition behind the same interface: a line under a live instalment plan is due on its last
 * instalment's date (§3.6: "its due date = the last instalment's"). Asked for `deadline.payment`
 * with the line in scope, the adapter answers that date first, so every re-dating of the line
 * (dueDateFor, redateLines) keeps it.
 */

import { db } from '@repo/db';
import type { LinePolicyKey } from '@repo/validations';
import { activeExceptions, exceptionsByIds, markExceptionsUsed, type RegistryException } from './exception-registry.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type ExceptionScope = {
  sessionId?: string;
  subjectId?: string;
  offerId?: string;
  offerItemId?: string;
  registrationId?: string;
  boardSeriesId?: string;
  academicYear?: string;
};

export type PolicyException = {
  id: string;
  policyKey: LinePolicyKey;
  value: number | null;
  valueDate: Date | null;
  oneShot: boolean;
  scope: ExceptionScope;
};

export interface LineExceptionSource {
  /** Active, unexpired exceptions of these keys covering the scope, for the student or their family. */
  active(executor: Executor, studentId: string, keys: LinePolicyKey[], scope: ExceptionScope, opts?: { lock?: 'share' | 'update' }): Promise<PolicyException[]>;
  /** Exactly these (a re-price re-applies the ids its basis recorded, whatever their status now). */
  byIds(executor: Executor, ids: string[]): Promise<PolicyException[]>;
  /** Mark one-shot gates used, in the caller's transaction. */
  markUsed(tx: Tx, ids: string[], ctx: { registrationIds: string[]; actorId: string | null }): Promise<void>;
}

function toPolicy(r: RegistryException): PolicyException {
  return { id: r.id, policyKey: r.policyKey as LinePolicyKey, value: r.value, valueDate: r.valueDate, oneShot: r.oneShot, scope: r.scope };
}

/** A live plan's last instalment date, as the line's payment due date (§3.6). */
async function planDueDate(executor: Executor, studentId: string, registrationId: string): Promise<PolicyException[]> {
  const plans = await activeExceptions(executor, studentId, ['plan.instalments'], { registrationId });
  const plan = plans.find((p) => p.scope.registrationId === registrationId);
  const schedule = Array.isArray(plan?.valueJson) ? (plan!.valueJson as { dueAt: string }[]) : [];
  if (!plan || !schedule.length) return [];
  const last = new Date(Math.max(...schedule.map((s) => new Date(s.dueAt).getTime())));
  return [{ id: plan.id, policyKey: 'deadline.payment', value: null, valueDate: last, oneShot: false, scope: { registrationId } }];
}

export const lineExceptions: LineExceptionSource = {
  async active(executor, studentId, keys, scope, opts) {
    const rows = (await activeExceptions(executor, studentId, keys, scope, opts)).map(toPolicy);
    if (keys.includes('deadline.payment') && scope.registrationId) {
      return [...(await planDueDate(executor, studentId, scope.registrationId)), ...rows];
    }
    return rows;
  },
  async byIds(executor, ids) {
    return (await exceptionsByIds(executor, ids)).map(toPolicy);
  },
  async markUsed(tx, ids, ctx) {
    await markExceptionsUsed(tx, ids, ctx);
  },
};
