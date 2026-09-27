/**
 * Notification API Routes
 *
 * All-user routes (student, parent, admin):
 * GET  /notifications                   - Paginated notification list (unreadOnly filter)
 * GET  /notifications/unread-count      - Count of unread notifications (for badge)
 * PUT  /notifications/:id/read          - Mark a single notification as read
 * PUT  /notifications/read-all          - Mark all notifications as read
 *
 * Admin routes (NOT-011):
 * POST /notifications/admin/announce    - Compose and send bulk announcement to a recipient group
 *
 * Authorization:
 * - All routes require authentication
 * - Read/mark-read routes: any authenticated user can only access their own notifications
 * - Announce route: admin only
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  GetNotificationsQuery,
  NotificationId,
  BulkAnnouncement,
} from '@repo/validations';
import { success, error } from '../lib/response';
import { requireAuth, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { logAction, extractAuditContext } from '../services/audit.services';
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
  )

  .post(
    '/admin/announce',
    requireAdmin(),
    zValidator('json', BulkAnnouncement),
    async (c) => {
      const user = c.get('user')!;
      const payload = c.req.valid('json');

      const result = await notificationService.sendAdminAnnouncement(payload, user.id);

      if (result.scheduled) {
        await logAction(user.id, 'ADMIN_ANNOUNCEMENT', 'notification', '', null, {
          recipients: payload.recipients,
          scheduled: true,
          scheduledAt: result.scheduledAt?.toISOString(),
        }, extractAuditContext(c))
          .catch(err => console.error('[audit] ADMIN_ANNOUNCEMENT (scheduled) failed:', err));

        return success(c, {
          message: `Announcement scheduled for ${result.scheduledAt?.toLocaleString()}`,
          scheduled: true,
          scheduledAt: result.scheduledAt,
          notificationCount: 0,
          emailSent: false,
          emailStubbed: false,
        });
      }

      await logAction(user.id, 'ADMIN_ANNOUNCEMENT', 'notification', '', null, { recipients: payload.recipients, notificationCount: result.notificationCount }, extractAuditContext(c))
        .catch(err => console.error('[audit] ADMIN_ANNOUNCEMENT failed:', err));
      return success(c, {
        message: `Announcement sent to ${result.notificationCount} user(s)`,
        notificationCount: result.notificationCount,
        emailSent: result.emailResult.success,
        emailStubbed: result.emailResult.stubbed ?? false,
      });
    }
  )

  /**
   * L-6: Admin list of all scheduled announcements (pending + sent + failed).
   * Sorted newest-scheduled-first so the queue view is stable.
   */
  .get(
    '/admin/scheduled',
    requireAdmin(),
    async (c) => {
      const rows = await notificationService.getScheduledAnnouncements();
      return success(c, rows);
    }
  )

  /**
   * L-6: Admin cancels a still-pending scheduled announcement.
   * Returns 404 if the row isn't found or has already been sent/failed.
   */
  .delete(
    '/admin/scheduled/:id',
    requireAdmin(),
    zValidator('param', NotificationId),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const cancelled = await notificationService.cancelScheduledAnnouncement(id);
      if (!cancelled) {
        return error(c, 'Scheduled announcement not found or already dispatched', 404);
      }
      await logAction(
        user.id,
        'ADMIN_ANNOUNCEMENT',
        'notification',
        id,
        { status: 'pending' } as Record<string, unknown>,
        { status: 'cancelled', cancelledBy: user.id },
        extractAuditContext(c),
      ).catch(err => console.error('[audit] ADMIN_ANNOUNCEMENT cancel failed:', err));
      return success(c, cancelled);
    }
  );
