/**
 * The settings store (FEATURES_PLAN.md F0a).
 *
 * Keys, schemas, defaults and the roles that may change each key are declared
 * in @repo/validations (SETTINGS). Values live in `school_setting`, one row
 * per key the school has changed; a key never set reads as its default.
 *
 * A change is refused to any role the key does not name, validated against
 * the key's schema, and written with its SETTING_CHANGED audit row (before,
 * after, reason) in one transaction. The row is locked for the read, so two
 * changes at once are applied one after the other and each records the
 * value it replaced.
 *
 * A key whose change moves something else declares it in AFTER_CHANGE below
 * (A-12 turned off expires graduates' waiting registrations).
 */

import { db, schoolSetting, eq, sql } from '@repo/db';
import { SETTINGS, SETTING_KEYS, isSettingKey, hasRole, type SettingKey, type SettingValue, type Role } from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** The value of a setting, or its default when the school has not set it. */
export async function getSetting<K extends SettingKey>(key: K, executor: Executor = db): Promise<SettingValue<K>> {
  const [row] = await executor.select({ value: schoolSetting.value }).from(schoolSetting).where(eq(schoolSetting.key, key));
  if (!row) return SETTINGS[key].default as SettingValue<K>;
  // A stored value that no longer fits the schema (a key's schema tightened)
  // reads as the default rather than breaking every caller.
  const parsed = SETTINGS[key].schema.safeParse(row.value);
  return (parsed.success ? parsed.data : SETTINGS[key].default) as SettingValue<K>;
}

/** Every setting the caller may read, with its value and whether they may change it. */
export async function listSettings(role: string | null | undefined) {
  const rows = await db.query.schoolSetting.findMany();
  const stored = new Map(rows.map((r) => [r.key, r]));
  const users = rows.map((r) => r.updatedBy).filter((u): u is string => !!u);
  const names = users.length
    ? new Map((await db.query.user.findMany({ where: (u, { inArray }) => inArray(u.id, users), columns: { id: true, name: true } })).map((u) => [u.id, u.name]))
    : new Map<string, string>();
  return SETTING_KEYS.map((key) => {
    const def = SETTINGS[key];
    const row = stored.get(key);
    const parsed = row ? def.schema.safeParse(row.value) : null;
    return {
      key,
      label: def.label,
      description: def.description,
      group: def.group,
      source: def.source ?? null,
      input: def.input,
      choices: 'choices' in def ? (def.choices as readonly { value: string; label: string }[]) : [],
      // F4: a number's bounds and unit, for the screen.
      min: 'min' in def ? (def.min as number) : null,
      max: 'max' in def ? (def.max as number) : null,
      unit: 'unit' in def ? (def.unit as string) : null,
      editableBy: [...def.editableBy] as string[],
      canEdit: hasRole(role, ...def.editableBy),
      value: (parsed?.success ? parsed.data : def.default) as unknown,
      defaultValue: def.default as unknown,
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ? (names.get(row.updatedBy) ?? null) : null,
    };
  });
}

export class SettingError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409) {
    super(message);
  }
}

/**
 * What a key's change sets off. `inTransaction` runs in the transaction that
 * writes the new value (its moves and their audit rows commit with it, or
 * nothing does); `afterCommit` gets its result once committed.
 */
type ChangeHook = {
  inTransaction: (tx: Tx, before: unknown, after: unknown, actorId: string) => Promise<unknown>;
  afterCommit?: (result: unknown) => Promise<void>;
};
const ON_CHANGE: Partial<Record<SettingKey, ChangeHook>> = {};

/**
 * Hold a key while a transaction relies on (shared) or changes (exclusive)
 * its value. A transaction-scoped advisory lock rather than a row lock: a
 * key never set has no row, and its first change must still wait for, and
 * be waited on by, the registrations that read its default.
 */
export async function lockSetting(tx: Tx, key: SettingKey, mode: 'shared' | 'exclusive') {
  await tx.execute(mode === 'shared'
    ? sql`select pg_advisory_xact_lock_shared(hashtext(${`school_setting:${key}`}))`
    : sql`select pg_advisory_xact_lock(hashtext(${`school_setting:${key}`}))`);
}

/** Register what a key's change sets off (called once, by the service that owns the consequence). */
export function onSettingChanged(key: SettingKey, hook: ChangeHook) {
  ON_CHANGE[key] = hook;
}

/**
 * Change a setting. Refused (403) unless the caller's role is one the key
 * names; the value must satisfy the key's schema (400). Returns the new list
 * entry.
 */
export async function updateSetting(
  key: string,
  rawValue: unknown,
  reason: string,
  actor: { id: string; role: string | null | undefined },
  auditCtx?: AuditContext,
) {
  if (!isSettingKey(key)) throw new SettingError('There is no such setting', 404);
  const def = SETTINGS[key];
  if (!hasRole(actor.role, ...(def.editableBy as readonly Role[]))) {
    throw new SettingError(`Only ${def.editableBy.join(', ').replace(/_/g, ' ')} may change "${def.label}"`, 403);
  }
  const parsed = def.schema.safeParse(rawValue);
  if (!parsed.success) {
    throw new SettingError(`Not a valid value for "${def.label}": ${parsed.error.issues.map((i) => i.message).join('; ')}`, 400);
  }
  const value = parsed.data as unknown;

  const hook = ON_CHANGE[key];
  const { changed, result } = await db.transaction(async (tx) => {
    await lockSetting(tx, key, 'exclusive');
    const [row] = await tx.select().from(schoolSetting).where(eq(schoolSetting.key, key)).for('update');
    const beforeValue = row ? row.value : def.default;
    if (JSON.stringify(beforeValue) === JSON.stringify(value)) {
      return { changed: false, result: undefined };
    }
    const now = new Date();
    await tx
      .insert(schoolSetting)
      .values({ key, value, updatedAt: now, updatedBy: actor.id })
      .onConflictDoUpdate({ target: schoolSetting.key, set: { value, updatedAt: now, updatedBy: actor.id } });
    await logAction(actor.id, 'SETTING_CHANGED', 'setting', key, { value: beforeValue as never }, { value: value as never, reason }, auditCtx, tx);
    const moved = hook ? await hook.inTransaction(tx, beforeValue, value, actor.id) : undefined;
    return { changed: true, result: moved };
  });
  if (!changed) throw new SettingError(`"${def.label}" already has that value`, 409);
  if (hook?.afterCommit) await hook.afterCommit(result);

  return (await listSettings(actor.role)).find((s) => s.key === key)!;
}
