/**
 * User API Routes
 * 
 * Manages user profile operations:
 * - GET /users/me        - Get own profile
 * - PUT /users/me        - Update own profile
 * - GET /users/:id       - Get user by ID (admin)
 * - PUT /users/:id       - Update user (admin)
 * - GET /users           - List all users (admin)
 * 
 * Authorization:
 * - /users/me: Any authenticated user
 * - /users/:id, /users: Admin only
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  UpdateProfile,
  AdminUpdateUser,
  UserId,
  UserQueryFilters,
  StudentRegistrationData,
} from '@repo/validations';
import { success, error } from '../lib/response';
import { requireAuth, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { logAction, extractAuditContext } from '../services/audit.services';
import { auth } from '../lib/auth';
import * as userService from '../services/user.services';

export const users = new Hono<HonoEnv>()
  // All routes require authentication
  .use('*', requireAuth())

  /**
   * GET OWN PROFILE
   * GET /users/me
   * 
   * Returns the authenticated user's profile.
   */
  .get('/me', async (c) => {
    const currentUser = c.get('user')!;
    
    const profile = await userService.getUserProfile(currentUser.id);
    
    if (!profile) {
      return error(c, 'User not found', 404);
    }
    
    return success(c, profile);
  })

  /**
   * UPDATE OWN PROFILE
   * PUT /users/me
   * Body: { name?: string, phone?: string }
   * 
   * Updates the authenticated user's profile.
   */
  .put('/me',
    zValidator('json', UpdateProfile),
    async (c) => {
      const currentUser = c.get('user')!;
      const data = c.req.valid('json');
      
      const result = await userService.updateUserProfile(currentUser.id, data);
      
      if (!result) {
        return error(c, 'Failed to update profile', 500);
      }
      
      logAction(currentUser.id, 'USER_UPDATED', 'user', currentUser.id, null, result as Record<string, unknown>, extractAuditContext(c))
        .catch(err => console.error('[audit] USER_UPDATED failed:', err));
      return success(c, result);
    }
  )

  /**
   * CHANGE EMAIL ADDRESS
   * POST /users/me/change-email
   * Body: { newEmail: string }
   *
   * Initiates an email change for the authenticated user.
   * Uses better-auth's changeEmail flow which:
   * 1. Sends a verification email to the NEW email address
   * 2. Only switches the email once the new address is verified
   *
   * The user's emailVerified flag is set to false until re-verification completes.
   */
  .post('/me/change-email',
    zValidator('json', z.object({
      newEmail: z.string().email('Invalid email address').transform((e) => e.toLowerCase().trim()),
    })),
    async (c) => {
      const currentUser = c.get('user')!;
      const { newEmail } = c.req.valid('json');

      // Prevent changing to the same email
      if (newEmail === currentUser.email) {
        return error(c, 'New email must be different from your current email', 400);
      }

      // Check if the new email is already in use
      const existingUser = await userService.getUserByEmail(newEmail);
      if (existingUser && existingUser.id !== currentUser.id) {
        return error(c, 'This email address is already in use', 409);
      }

      try {
        // Use better-auth's changeEmail API which handles verification
        await auth.api.changeEmail({
          body: { newEmail },
          headers: c.req.raw.headers,
        });

        logAction(
          currentUser.id,
          'USER_UPDATED',
          'user',
          currentUser.id,
          { email: currentUser.email },
          { emailChangeRequested: newEmail },
          extractAuditContext(c)
        ).catch((err) => console.error('[audit] EMAIL_CHANGE_REQUESTED failed:', err));

        return success(c, {
          message: 'Verification email sent to your new address. Please check your inbox and click the verification link to complete the email change.',
          newEmail,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to initiate email change';
        return error(c, message, 400);
      }
    }
  )

  /**
   * COMPLETE STUDENT SETUP
   * POST /users/me/student-setup
   * Body: { grade: 10 | 11 | 12 }
   *
   * Sets student-specific fields after sign-up.
   * Can only be called once (when role is not set yet).
   */
  .post('/me/student-setup',
    zValidator('json', StudentRegistrationData),
    async (c) => {
      const currentUser = c.get('user');

      if (!currentUser) {
        console.error('[student-setup] No user in context — requireAuth may have failed');
        return error(c, 'Unauthorized', 401);
      }

      const { grade } = c.req.valid('json');

      // Already configured as student — fix grade if missing, otherwise idempotent.
      // M-2: Keep the return shape identical to the first-time success branch
      // (includes grade + studentId) so clients merging state don't see those
      // fields disappear on a re-call.
      if (currentUser.role === 'student') {
        if (currentUser.grade === null || currentUser.grade === undefined) {
          try {
            const fixed = await userService.updateStudentGrade(currentUser.id, grade);
            if (fixed) {
              return success(c, {
                id: fixed.id,
                name: fixed.name,
                email: fixed.email,
                role: fixed.role,
                grade: fixed.grade,
                studentId: fixed.studentId,
              });
            }
          } catch (err) {
            console.error('[student-setup] Failed to fix missing grade:', err);
          }
        }
        // Fetch the canonical row so grade + studentId are included even
        // when they're not on the session user type (Better-auth doesn't
        // project them onto c.get('user')).
        const current = await userService.getUserProfile(currentUser.id);
        return success(c, {
          id: currentUser.id,
          name: currentUser.name,
          email: currentUser.email,
          role: currentUser.role,
          grade: current?.grade ?? null,
          studentId: current?.studentId ?? null,
        });
      }
      // Configured as a non-default role — cannot change
      if (currentUser.role && currentUser.role !== 'user') {
        return error(c, 'Account already configured with a different role', 400);
      }

      try {
        const updated = await userService.setStudentFields(currentUser.id, grade);

        if (!updated) {
          console.error('[student-setup] setStudentFields returned null for userId:', currentUser.id);
          return error(c, 'Failed to complete student setup', 500);
        }

        return success(c, {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          role: updated.role,
          grade: updated.grade,
          studentId: updated.studentId,
        }, 201);
      } catch (err) {
        console.error('[student-setup] Error:', err);
        return error(c, 'Failed to complete student setup', 500);
      }
    }
  )

  /**
   * COMPLETE PARENT SETUP
   * POST /users/me/parent-setup
   * 
   * Sets parent role after sign-up.
   * Can only be called once (when role is not set yet).
   */
  .post('/me/parent-setup',
    async (c) => {
      const currentUser = c.get('user')!;
      
      // Already configured as parent — return success (idempotent)
      if (currentUser.role === 'parent') {
        return success(c, {
          id: currentUser.id,
          name: currentUser.name,
          email: currentUser.email,
          role: currentUser.role,
        });
      }
      // Configured as a non-default role — cannot change
      if (currentUser.role && currentUser.role !== 'user') {
        return error(c, 'Account already configured with a different role', 400);
      }

      try {
        const updated = await userService.setUserRole(currentUser.id, 'parent');

        if (!updated) {
          return error(c, 'Failed to complete parent setup', 500);
        }

        return success(c, {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          role: updated.role,
        }, 201);
      } catch (err) {
        console.error('Parent setup error:', err);
        return error(c, 'Failed to complete parent setup', 500);
      }
    }
  )

  /**
   * LIST ALL USERS (Admin)
   * GET /users
   * Query: { role?: string, grade?: number, search?: string }
   * 
   * Returns all users with optional filtering.
   */
  .get('/',
    requireAdmin(),
    zValidator('query', UserQueryFilters),
    async (c) => {
      const filters = c.req.valid('query');
      
      const allUsers = await userService.getAllUsers(filters);
      
      return success(c, allUsers);
    }
  )

  /**
   * GET USER BY ID (Admin)
   * GET /users/:id
   * 
   * Returns a specific user's profile.
   */
  .get('/:id',
    requireAdmin(),
    zValidator('param', UserId),
    async (c) => {
      const { id } = c.req.valid('param');
      
      const profile = await userService.getUserProfile(id);
      
      if (!profile) {
        return error(c, 'User not found', 404);
      }
      
      return success(c, profile);
    }
  )

  /**
   * UPDATE USER (Admin)
   * PUT /users/:id
   * Body: { name?: string, phone?: string, grade?: number, banned?: boolean }
   * 
   * Admin updates any user's profile including admin-only fields.
   */
  .put('/:id',
    requireAdmin(),
    zValidator('param', UserId),
    zValidator('json', AdminUpdateUser),
    async (c) => {
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');
      
      // Verify user exists
      const exists = await userService.userExists(id);
      if (!exists) {
        return error(c, 'User not found', 404);
      }
      
      const updated = await userService.adminUpdateUser(id, data);
      
      if (!updated) {
        return error(c, 'Failed to update user', 500);
      }
      
      return success(c, updated);
    }
  );

export type UsersApi = typeof users;
