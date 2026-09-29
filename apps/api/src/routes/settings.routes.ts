/**
 * The settings store (FEATURES_PLAN.md F0a), mounted at /v1/settings.
 *
 * GET /settings       every key, its value and default, and whether the
 *                     caller may change it (admin, finance, coordinator)
 * PUT /settings/:key  change one key: refused unless the key names the
 *                     caller's role; audited with the reason
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { SettingKeyParam, UpdateSetting, SETTINGS_READ_ROLES, ROLES } from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import { listSettings, updateSetting, SettingError } from '../services/settings.services';

export const settingsRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/', requireRole(...SETTINGS_READ_ROLES), async (c) => success(c, await listSettings(c.get('user')!.role)))

  // Any role that may change at least one key reaches the handler, which
  // checks the key's own list.
  .put('/:key', requireRole(ROLES.ADMIN, ROLES.FINANCE_ADMIN, ROLES.COORDINATOR),
    zValidator('param', SettingKeyParam), zValidator('json', UpdateSetting), async (c) => {
      const user = c.get('user')!;
      const { value, reason } = c.req.valid('json');
      try {
        return success(c, await updateSetting(c.req.valid('param').key, value, reason, { id: user.id, role: user.role }, extractAuditContext(c)));
      } catch (err) {
        return error(c, clientMessage(err, 'Failed to change the setting'), err instanceof SettingError ? err.status : 400);
      }
    });

export type SettingsApi = typeof settingsRoutes;
