/**
 * The exception adapter (docs/features/RESERVATIONS.md §2.8).
 *
 * `priceLine`, `assertLineRules` and `dueDateFor` read the student's exceptions only through
 * `lineExceptions`. Today it reads the existing `exception` table, whose types map onto the
 * registry's policy keys (`custom_price` → `price.custom`, `discount_percent` →
 * `price.discountPercent`, `discount_fixed` → `price.discountFixed`), with the session and
 * subject scope applied exactly as `getActiveExceptions` applied it. No gate or due-date key
 * exists in today's table, so those return none. Step C replaces the implementation with the
 * policy registry (RESERVATIONS_REWORK.md §3.7), keeping this interface.
 */

import { db, exception, and, eq, inArray, asc } from '@repo/db';
import type { LinePolicyKey } from '@repo/validations';

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

const TYPE_TO_KEY: Record<string, LinePolicyKey> = {
  custom_price: 'price.custom',
  discount_percent: 'price.discountPercent',
  discount_fixed: 'price.discountFixed',
};

function toPolicy(row: typeof exception.$inferSelect): PolicyException {
  return {
    id: row.id,
    policyKey: TYPE_TO_KEY[row.type]!,
    value: row.value,
    valueDate: null,
    oneShot: false,
    scope: { ...(row.sessionId ? { sessionId: row.sessionId } : {}), ...(row.subjectId ? { subjectId: row.subjectId } : {}) },
  };
}

export const lineExceptions: LineExceptionSource = {
  async active(executor, studentId, keys, scope, opts) {
    const types = Object.entries(TYPE_TO_KEY).filter(([, k]) => keys.includes(k)).map(([t]) => t);
    if (!types.length) return [];
    const q = executor
      .select()
      .from(exception)
      .where(and(eq(exception.studentId, studentId), eq(exception.status, 'active'), inArray(exception.type, types)))
      // The order the old pricing hook read them in, made explicit.
      .orderBy(asc(exception.createdAt), asc(exception.id));
    const rows = opts?.lock ? await q.for(opts.lock) : await q;
    const now = new Date();
    return rows
      .filter((e) => {
        if (e.validUntil && e.validUntil < now) return false;
        // A null scope on the exception means "applies to all" (today's rule).
        if (e.sessionId && e.sessionId !== scope.sessionId) return false;
        if (e.subjectId && e.subjectId !== scope.subjectId) return false;
        return true;
      })
      .map(toPolicy);
  },
  async byIds(executor, ids) {
    if (!ids.length) return [];
    const rows = await executor.select().from(exception).where(inArray(exception.id, ids)).orderBy(asc(exception.createdAt), asc(exception.id));
    return rows.filter((r) => TYPE_TO_KEY[r.type]).map(toPolicy);
  },
  async markUsed() {
    // Today's table has no one-shot gates; the registry (step C) marks them used.
  },
};
