/**
 * Notification API Routes
 *
 * All-user routes (student, parent, admin):
 * GET  /notifications                   - Paginated notification list (unreadOnly filter)
 * GET  /notifications/unread-count      - Count of unread notifications (for badge)
 * PUT  /notifications/:id/read          - Mark a single notification as read
 * PUT  /notifications/read-all          - Mark all notifications as read
 *
 * The admin's announcement form (NOT-011) and its scheduled queue moved to /v1/messages (step D).
 * Families mark read; nobody deletes a notification (there is no delete route).
 *
 * Authorization:
 * - All routes require authentication
 * - Read/mark-read routes: any authenticated user can only access their own notifications
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { GetNotificationsQuery, NotificationId } from '@repo/validations';
import { success, error } from '../lib/response';
import { requireAuth } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as notificationService from '../services/notification.services';

export const notificationRoutes = new Hono<HonoEnv>()

  .get(
    '/',
    requireAuth(),
    zValidator('query', GetNotificationsQuery),
    async (c) => {
      const user = c.get('user')!;
      const { unreadOnly, limit, offset } = c.req.valid('query');

      const notifications = await notificationService.getUserNotifications(user.id, {
        unreadOnly,
        limit,
        offset,
      });

      return success(c, notifications);
    }
  )

  .get('/unread-count', requireAuth(), async (c) => {
    const user = c.get('user')!;
    const count = await notificationService.getUnreadCount(user.id);
    return success(c, { count });
  })

  .put('/read-all', requireAuth(), async (c) => {
    const user = c.get('user')!;
    await notificationService.markAllAsRead(user.id);
    return success(c, { message: 'All notifications marked as read' });
  })

  .put(
    '/:id/read',
    requireAuth(),
    zValidator('param', NotificationId),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');

      const updated = await notificationService.markAsRead(id, user.id);
      if (!updated) {
        return error(c, 'Notification not found or already read', 404);
      }

      return success(c, updated);
    }
  );
