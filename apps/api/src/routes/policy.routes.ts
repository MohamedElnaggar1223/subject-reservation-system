/**
 * The policy registry, read (RESERVATIONS_REWORK.md §3.7, §5): GET /v1/policies — every policy an
 * exception can lift, with its label, sentence, value type and bounds, scopes and what no scope
 * means, whether it is one-shot, who grants it, its hook, and whether the caller may grant it now
 * (a pending policy, or deadline.boardEntry while its setting is off, cannot be granted). Staff.
 */

import { Hono } from 'hono';
import { POLICIES, POLICY_KEYS, POLICY_GROUPS, POLICY_GROUP_LABELS, POLICY_SCOPE_LABELS, STAFF_ROLES, hasRole, type Role } from '@repo/validations';
import { success } from '../lib/response';
import { requireAuth, requireRole } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { getSetting } from '../services/settings.services';

export const policies = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .use('*', requireRole(...STAFF_ROLES))

  .get('/', async (c) => {
    const role = c.get('user')!.role;
    const lateEntriesOn = await getSetting('exceptions.boardEntryDeadline');
    return success(c, {
      groups: POLICY_GROUPS.map((g) => ({ id: g, label: POLICY_GROUP_LABELS[g] })),
      scopeLabels: POLICY_SCOPE_LABELS,
      policies: POLICY_KEYS.map((key) => {
        const p = POLICIES[key];
        const mayGrant = hasRole(role, ...(p.grantRoles as readonly Role[]));
        const live = p.status === 'live' || (p.status === 'gated' && lateEntriesOn);
        return {
          key,
          group: p.group,
          label: p.label,
          sentence: p.sentence,
          valueType: p.valueType,
          min: 'min' in p ? (p as { min?: number }).min ?? null : null,
          max: 'max' in p ? (p as { max?: number }).max ?? null : null,
          scopes: [...p.scopes],
          nullScope: p.nullScope,
          oneShot: p.oneShot,
          grantRoles: [...p.grantRoles],
          hook: p.hook,
          status: p.status,
          grantable: mayGrant && live,
          whyNot: !mayGrant ? 'not_your_role' : !live ? (p.status === 'gated' ? 'off_by_setting' : 'not_applied_yet') : null,
        };
      }),
    });
  });

export type PoliciesApi = typeof policies;
