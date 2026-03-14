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
import * as notificationService from '../services/notification.services';

const notificationRoutes = new Hono<HonoEnv>();

// ─── GET /notifications ────────────────────────────────────────────────────────
// Returns paginated notifications for the authenticated user (newest first).
// Query: unreadOnly=true, limit, offset
notificationRoutes.get(
  '/',
  requireAuth,
  zValidator('query', GetNotificationsQuery),
  async (c) => {
    const user = c.get('user')!;
    const { unreadOnly, limit, offset } = c.req.valid('query');

    const notifications = await notificationService.getUserNotifications(user.id, {
      unreadOnly,
      limit,
      offset,
    });

    return c.json(success(notifications));
  }
);

// ─── GET /notifications/unread-count ──────────────────────────────────────────
// Returns the count of unread notifications for the badge indicator.
// Must be defined before /:id routes to avoid route conflicts.
notificationRoutes.get('/unread-count', requireAuth, async (c) => {
  const user = c.get('user')!;
  const count = await notificationService.getUnreadCount(user.id);
  return c.json(success({ count }));
});

// ─── PUT /notifications/read-all ──────────────────────────────────────────────
// Marks all unread notifications for the authenticated user as read.
// Defined before /:id to avoid pattern conflicts.
notificationRoutes.put('/read-all', requireAuth, async (c) => {
  const user = c.get('user')!;
  await notificationService.markAllAsRead(user.id);
  return c.json(success({ message: 'All notifications marked as read' }));
});

// ─── PUT /notifications/:id/read ──────────────────────────────────────────────
// Marks a single notification as read.
// Returns 404 if the notification does not exist or does not belong to the user.
notificationRoutes.put(
  '/:id/read',
  requireAuth,
  zValidator('param', NotificationId),
  async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');

    const updated = await notificationService.markAsRead(id, user.id);
    if (!updated) {
      return c.json(error('Notification not found or already read', 404), 404);
    }

    return c.json(success(updated));
  }
);

// ─── POST /notifications/admin/announce ───────────────────────────────────────
// Admin composes and sends a bulk announcement to a recipient group (NOT-011).
// Creates in-app notifications for all matching users and optionally sends email.
notificationRoutes.post(
  '/admin/announce',
  requireAdmin,
  zValidator('json', BulkAnnouncement),
  async (c) => {
    const payload = c.req.valid('json');

    const result = await notificationService.sendAdminAnnouncement(payload);

    return c.json(
      success({
        message: `Announcement sent to ${result.notificationCount} user(s)`,
        notificationCount: result.notificationCount,
        emailSent: result.emailResult.success,
        emailStubbed: result.emailResult.stubbed ?? false,
      })
    );
  }
);

export { notificationRoutes };
