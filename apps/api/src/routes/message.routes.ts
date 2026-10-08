/**
 * Messages (RESERVATIONS_REWORK.md §3.8, §4.8, §5; docs/features/RESERVATIONS_MESSAGES.md §3)
 *
 * GET  /messages                    - The log: messages with their audience and deliveries by channel and outcome
 * POST /messages                    - Send a message now, or schedule it
 * POST /messages/:id/cancel         - Cancel a scheduled message before its time
 * POST /messages/audiences/resolve  - An audience resolved now: how many, who, what it can fill
 * GET  /messages/audiences          - The saved audiences (the picker's chips)
 * GET  /messages/lists              - What each batch list is built from (sessions, sections, offers, groups, charge kinds)
 * GET  /messages/templates          - The school's texts in English and Arabic
 * POST /messages/templates          - Add a text (admin)
 * PUT  /messages/templates/:id      - Change a text (admin)
 * GET  /messages/deliveries         - One message's deliveries per recipient and channel
 *
 * The admin sends to any audience. Finance (the officer and the finance admin) sends to the money
 * lists only — a session's unpaid families, the holders of a charge — and reads only those messages
 * and the payment reminders ("finance for payment batches", §5); the services refuse the rest.
 * Families never reach these routes: they read their notifications at /notifications.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  CreateMessage, ResolveAudience, ListMessagesQuery, DeliveriesQuery, CancelMessage, MessageId, SaveTemplate, TemplateId, ROLES,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as messageService from '../services/message.services';
import { extractAuditContext } from '../services/audit.services';

const statusOf = (err: unknown) => (messageService.isMessageError(err) ? err.status : 400);
const SENDERS = [ROLES.ADMIN, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN] as const;

export const messageRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/', requireRole(...SENDERS), zValidator('query', ListMessagesQuery), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await messageService.listMessages({ id: user.id, role: user.role }, c.req.valid('query')));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to list the messages'), statusOf(err));
    }
  })

  .post('/', requireRole(...SENDERS), zValidator('json', CreateMessage), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await messageService.createMessage(c.req.valid('json'), { id: user.id, role: user.role }, extractAuditContext(c)), 201);
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to send the message'), statusOf(err));
    }
  })

  .post('/audiences/resolve', requireRole(...SENDERS), zValidator('json', ResolveAudience), async (c) => {
    const user = c.get('user')!;
    const body = c.req.valid('json');
    try {
      return success(c, await messageService.previewAudience({ id: user.id, role: user.role }, body.audience, body.context ?? {}));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to resolve the audience'), statusOf(err));
    }
  })

  .get('/audiences', requireRole(...SENDERS), async (c) => {
    const user = c.get('user')!;
    return success(c, await messageService.listSavedAudiences({ id: user.id, role: user.role }));
  })

  .get('/lists', requireRole(...SENDERS), zValidator('query', z.object({ sessionId: z.string().min(1).optional() })), async (c) => {
    const user = c.get('user')!;
    return success(c, await messageService.listOptions({ id: user.id, role: user.role }, c.req.valid('query')));
  })

  .get('/templates', requireRole(...SENDERS), async (c) => success(c, await messageService.listTemplates()))

  .post('/templates', requireAdmin(), zValidator('json', SaveTemplate), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await messageService.createTemplate(c.req.valid('json'), user.id, extractAuditContext(c)), 201);
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to save the template'), statusOf(err));
    }
  })

  .put('/templates/:id', requireAdmin(), zValidator('param', TemplateId), zValidator('json', SaveTemplate), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await messageService.updateTemplate(c.req.valid('param').id, c.req.valid('json'), user.id, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to save the template'), statusOf(err));
    }
  })

  .get('/deliveries', requireRole(...SENDERS), zValidator('query', DeliveriesQuery), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await messageService.listDeliveries({ id: user.id, role: user.role }, c.req.valid('query')));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to list the deliveries'), statusOf(err));
    }
  })

  .post('/:id/cancel', requireRole(...SENDERS), zValidator('param', MessageId), zValidator('json', CancelMessage), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await messageService.cancelMessage(c.req.valid('param').id, { id: user.id, role: user.role }, c.req.valid('json').reason, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to cancel the message'), statusOf(err));
    }
  });

export type MessagesApi = typeof messageRoutes;
