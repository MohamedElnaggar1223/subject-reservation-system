/**
 * The exception registry (RESERVATIONS_REWORK.md §3.7; docs/features/RESERVATIONS_MONEY.md §3).
 *
 * One way to read exceptions, for every hook: an active, unexpired exception of a policy key,
 * held by the student or by their family (a parent account with an approved link), whose scope
 * covers what the hook asks about — every scope column the exception sets must equal the hook's
 * (a null column is the policy's null scope: any). A migrated exception waiting under "Check
 * these" (check_reason, not yet confirmed) covers nothing until a finance admin confirms it.
 *
 * Locks (docs/features/RESERVATIONS.md §2.1 step 6): readers take the rows FOR SHARE, a one-shot
 * gate FOR UPDATE (it is marked used in the same transaction). Under READ COMMITTED a row locked
 * FOR UPDATE that another transaction marked used meanwhile is re-read and no longer matches
 * `status = 'active'`, so two reservations never use one gate.
 */

import { db, exception, parentStudentLink, and, eq, inArray, or, sql, asc } from '@repo/db';
import { POLICIES, isRegistryPolicyKey, type PolicyKey } from '@repo/validations';
import { logActions } from './audit.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type RegistryScope = {
  sessionId?: string;
  subjectId?: string;
  offerId?: string;
  offerItemId?: string;
  registrationId?: string;
  chargeId?: string;
  boardSeriesId?: string;
  academicYear?: string;
};

export type RegistryException = {
  id: string;
  policyKey: PolicyKey;
  value: number | null;
  valueDate: Date | null;
  valueJson: unknown;
  oneShot: boolean;
  scope: RegistryScope;
  studentId: string | null;
  familyId: string | null;
  validUntil: Date | null;
  createdAt: Date;
};

type Row = typeof exception.$inferSelect;

const SCOPE_COLUMNS: { key: keyof RegistryScope; col: keyof Row }[] = [
  { key: 'sessionId', col: 'sessionId' },
  { key: 'subjectId', col: 'subjectId' },
  { key: 'offerId', col: 'offerId' },
  { key: 'offerItemId', col: 'offerItemId' },
  { key: 'registrationId', col: 'registrationId' },
  { key: 'chargeId', col: 'chargeId' },
  { key: 'boardSeriesId', col: 'boardSeriesId' },
  { key: 'academicYear', col: 'academicYear' },
];

export function scopeOfRow(r: Row): RegistryScope {
  const out: RegistryScope = {};
  for (const { key, col } of SCOPE_COLUMNS) {
    const v = r[col];
    if (typeof v === 'string' && v) out[key] = v;
  }
  return out;
}

export function toRegistryException(r: Row): RegistryException {
  const def = isRegistryPolicyKey(r.policyKey) ? POLICIES[r.policyKey] : null;
  return {
    id: r.id,
    policyKey: r.policyKey as PolicyKey,
    value: r.valueNumber ?? null,
    valueDate: r.valueDate ?? null,
    valueJson: r.valueJson ?? null,
    oneShot: def?.oneShot ?? false,
    scope: scopeOfRow(r),
    studentId: r.studentId,
    familyId: r.familyId,
    validUntil: r.validUntil,
    createdAt: r.createdAt,
  };
}

/** Does an exception's scope cover what a hook asks about? Every column it sets must match. */
export function covers(r: Pick<Row, 'sessionId' | 'subjectId' | 'offerId' | 'offerItemId' | 'registrationId' | 'chargeId' | 'boardSeriesId' | 'academicYear'>, scope: RegistryScope): boolean {
  for (const { key, col } of SCOPE_COLUMNS) {
    const v = r[col as keyof typeof r];
    if (v && v !== scope[key]) return false;
  }
  return true;
}

/** The family accounts (parents with an approved link) whose exceptions a student holds. */
export async function familiesOf(executor: Executor, studentId: string): Promise<string[]> {
  const rows = await executor
    .select({ parentId: parentStudentLink.parentId })
    .from(parentStudentLink)
    .where(and(eq(parentStudentLink.studentId, studentId), eq(parentStudentLink.status, 'approved')));
  return [...new Set(rows.map((r) => r.parentId))].sort();
}

/**
 * Active, unexpired exceptions of these keys covering the scope, held by the student or their
 * family, oldest first (the order the V3 pricing hook read them in, made explicit). `lock`: FOR
 * SHARE (a reader) or FOR UPDATE (a one-shot gate about to be used, a plan about to be settled).
 */
export async function activeExceptions(
  executor: Executor,
  studentId: string,
  keys: readonly PolicyKey[],
  scope: RegistryScope,
  opts: { lock?: 'share' | 'update'; now?: Date } = {},
): Promise<RegistryException[]> {
  if (!keys.length) return [];
  const families = await familiesOf(executor, studentId);
  const holder = families.length
    ? or(eq(exception.studentId, studentId), inArray(exception.familyId, families))
    : eq(exception.studentId, studentId);
  const q = executor
    .select()
    .from(exception)
    .where(and(
      holder,
      eq(exception.status, 'active'),
      inArray(exception.policyKey, [...keys]),
      // "Check these": a migrated exception whose meaning changed applies once confirmed.
      sql`(${exception.checkReason} IS NULL OR ${exception.confirmedAt} IS NOT NULL)`,
    ))
    .orderBy(asc(exception.createdAt), asc(exception.id));
  const rows = opts.lock ? await q.for(opts.lock) : await q;
  const now = opts.now ?? new Date();
  return rows.filter((r) => (!r.validUntil || r.validUntil > now) && covers(r, scope)).map(toRegistryException);
}

/** Exactly these exceptions, whatever their status now (a re-price applies the ids its basis recorded). */
export async function exceptionsByIds(executor: Executor, ids: readonly string[]): Promise<RegistryException[]> {
  if (!ids.length) return [];
  const rows = await executor.select().from(exception).where(inArray(exception.id, [...ids])).orderBy(asc(exception.createdAt), asc(exception.id));
  return rows.map(toRegistryException);
}

/**
 * Mark one-shot gates used by the lines they let through, in the caller's transaction (which
 * holds them FOR UPDATE since the gate read them). One EXCEPTION_USED row each.
 */
export async function markExceptionsUsed(tx: Tx, ids: readonly string[], ctx: { registrationIds: string[]; actorId: string | null }) {
  if (!ids.length) return;
  const now = new Date();
  const used = await tx
    .update(exception)
    .set({ status: 'used', usedAt: now, usedFor: { registrationIds: ctx.registrationIds }, updatedAt: now })
    .where(and(inArray(exception.id, [...ids]), eq(exception.status, 'active')))
    .returning({ id: exception.id, policyKey: exception.policyKey });
  if (used.length !== new Set(ids).size) throw new Error('An exception this reservation relied on was used or revoked meanwhile — try again');
  await logActions(used.map((u) => ({
    userId: ctx.actorId, action: 'EXCEPTION_USED' as const, entityType: 'exception' as const, entityId: u.id,
    previousData: { status: 'active' }, newData: { status: 'used', policyKey: u.policyKey, registrationIds: ctx.registrationIds },
  })), tx);
}

// ─── The hooks that read one policy (each replaces a V3 reader of the old types) ─────────────

/**
 * deadline.window (V3 deadline_extension / late_registration; MA-13): the session stays open for
 * this student until the exception's date. A null session scope is every session (MO-12).
 */
export async function windowExtended(executor: Executor, studentId: string, sessionId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await activeExceptions(executor, studentId, ['deadline.window'], { sessionId }, { now });
  return rows.some((r) => !r.valueDate || r.valueDate > now);
}

/** gate.schoolFee (V3 fee_waiver): a waiver for that academic year, or for every year (no year scope). */
export async function schoolFeeWaived(executor: Executor, studentId: string, academicYear: string | null): Promise<boolean> {
  const rows = await activeExceptions(executor, studentId, ['gate.schoolFee'], academicYear ? { academicYear } : {});
  return rows.length > 0;
}
