/**
 * Reminder rules (RESERVATIONS_REWORK.md §3.8, §4.8, §5; docs/features/RESERVATIONS_MESSAGES.md §3)
 *
 * GET /reminders/rules  - The rule of each kind for every session, the sessions' own, the two settings
 * PUT /reminders/rules  - Set a rule (for every session, or a session's own; `inherit` drops a session's own)
 * GET /reminders/sent   - What went out: one row per reminder message, with what it was about and how it was delivered
 *
 * The admin and the finance admin. The scheduler sends the rules (jobs/session-closer.ts, runReminders).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { PutReminderRule, RemindersSentQuery } from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireFinanceAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as reminderService from '../services/reminder.services';
import { isMessageError } from '../services/message.services';
import { extractAuditContext } from '../services/audit.services';

const statusOf = (err: unknown) => (isMessageError(err) ? err.status : 400);

export const reminderRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/rules', requireFinanceAdmin(), async (c) => success(c, await reminderService.listRules()))

  .put('/rules', requireFinanceAdmin(), zValidator('json', PutReminderRule), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await reminderService.putRule(c.req.valid('json'), user.id, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to set the reminder'), statusOf(err));
    }
  })

  .get('/sent', requireFinanceAdmin(), zValidator('query', RemindersSentQuery), async (c) =>
    success(c, await reminderService.listSent(c.req.valid('query'))));

export type RemindersApi = typeof reminderRoutes;
