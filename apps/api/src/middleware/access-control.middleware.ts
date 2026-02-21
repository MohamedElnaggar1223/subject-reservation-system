/**
 * Access Control Middleware
 *
 * Provides middleware functions for route-level authorization.
 *
 * Available Middleware:
 * - requireAuth() - Requires any authenticated user
 * - requireRole(...roles) - Requires specific role(s)
 * - requireAdmin() - Shortcut for admin-only routes
 * - requireCoach() - Shortcut for coach-only routes
 * - requireStudent() - Shortcut for student-only routes
 *
 * Usage Examples:
 *
 * // Any authenticated user
 * app.get('/profile', requireAuth(), handler)
 *
 * // Specific role
 * app.get('/admin', requireRole(ROLES.ADMIN), handler)
 *
 * // Multiple roles
 * app.get('/dashboard', requireRole(ROLES.ADMIN, ROLES.COACH), handler)
 *
 * // Convenience shortcuts
 * app.delete('/user/:id', requireAdmin(), handler)
 */

import { createMiddleware } from 'hono/factory';
import { HonoEnv } from '../lib/types';
import { ROLES, hasRole, type Role } from '@repo/validations';

/**
 * Require Authentication
 *
 * Checks if user is authenticated (has valid session).
 * Does not check roles - accepts any authenticated user.
 *
 * Returns 401 if not authenticated.
 */
export const requireAuth = () => {
  return createMiddleware<HonoEnv>(async (c, next) => {
    const session = c.get('session');
    const user = c.get('user');

    if (!session || !user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  });
};

/**
 * Require Specific Role(s)
 *
 * Generic role-based access control middleware factory.
 * Checks if authenticated user has one of the allowed roles.
 *
 * Returns:
 * - 401 if not authenticated
 * - 403 if authenticated but wrong role
 *
 * @param allowedRoles - Role(s) that are allowed to access
 * @returns Middleware function
 *
 * Example:
 * requireRole(ROLES.ADMIN, ROLES.COACH)
 */
export const requireRole = (...allowedRoles: Role[]) => {
    return createMiddleware<HonoEnv>(async (c, next) => {
        const user = c.get('user');
        const session = c.get('session');

        if (!session || !user) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

        if (!hasRole(user.role, ...allowedRoles)) {
            return c.json({ 
                error: 'Forbidden',
                requiredRoles: allowedRoles 
            }, 403);
    }

    return next();
});
};

/**
 * Convenience Shortcuts for Common Role Checks
 *
 * These are shortcuts for frequently used role combinations.
 * Use these instead of requireRole() for cleaner code.
 */
export const requireAdmin = () => requireRole(ROLES.ADMIN);
export const requireStudent = () => requireRole(ROLES.STUDENT);
export const requireParent = () => requireRole(ROLES.PARENT);
export const requireStudentOrParent = () => requireRole(ROLES.STUDENT, ROLES.PARENT);
export const requireAdminOrParent = () => requireRole(ROLES.ADMIN, ROLES.PARENT);

/**
 * Alias for backwards compatibility
 * @deprecated Use requireAuth() instead
 */
export const requireAuthenticated = requireAuth;