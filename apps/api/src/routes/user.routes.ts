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
  AdminCreateUser,
  UserId,
  UserQueryFilters,
  StudentRegistrationData,
  ROLES,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { auth } from '../lib/auth';
import { getStudentSummary } from '../services/desk.services';
import { getHomeSummary } from '../services/home.services';
import { requireAuth, requireAdmin, requireFinance } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { logAction, extractAuditContext } from '../services/audit.services';
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
      
      await logAction(currentUser.id, 'USER_UPDATED', 'user', currentUser.id, null, result as Record<string, unknown>, extractAuditContext(c))
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

        await logAction(
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
        const message = clientMessage(err, 'Failed to initiate email change');
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
      const currentUserWithProfile = currentUser as typeof currentUser & { grade?: number | null };

      // Already configured as student — fix grade if missing, otherwise idempotent.
      // M-2: Keep the return shape identical to the first-time success branch
      // (includes grade + studentId) so clients merging state don't see those
      // fields disappear on a re-call.
      if (currentUser.role === 'student') {
        if (currentUserWithProfile.grade === null || currentUserWithProfile.grade === undefined) {
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
  /**
   * CREATE USER (Admin — team management, G7)
   * POST /users
   *
   * One form creates any account: staff (finance roles), students
   * (grade required, student ID auto-generated), or parents.
   */
  .post('/',
    requireAdmin(),
    zValidator('json', AdminCreateUser),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const result = await auth.api.createUser({
          body: {
            email: data.email,
            password: data.password,
            name: data.name,
            role: data.role as 'admin',
          },
          headers: c.req.raw.headers,
        });

        if (data.role === 'student' && data.grade !== undefined) {
          await userService.setStudentFields(result.user.id, data.grade);
        }
        // Staff vouch for the person in front of them, as at the desk (RF-22).
        await userService.markEmailVerified(result.user.id);

        await logAction(user.id, 'STAFF_USER_CREATED', 'user', result.user.id, null, { email: data.email, role: data.role }, extractAuditContext(c))
          .catch((err) => console.error('[audit] STAFF_USER_CREATED failed:', err));

        return success(c, result.user, 201);
      } catch (err) {
        const message = clientMessage(err, 'Failed to create user');
        const status = /exists|taken|duplicate/i.test(message) ? 409 : 400;
        return error(c, message, status);
      }
    }
  )

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
  /**
   * PEOPLE SEARCH (UX_AUDIT staff-C1)
   * GET /users/search?search=&role=
   *
   * Finance staff need to find the family at the desk. GET /users is
   * admin-only, so without this the Desk's search returned 403 and an
   * empty dropdown — every downstream desk action needs a studentId.
   * Field-limited, and students/parents only.
   */
  .get('/search',
    requireFinance(),
    zValidator('query', z.object({
      search: z.string().max(100).optional(),
      role: z.enum(['student', 'parent']).optional(),
    })),
    async (c) => {
      const { search, role } = c.req.valid('query');
      return success(c, await userService.searchPeople({ search, role }));
    }
  )

  /**
   * HOME SUMMARY (UX_AUDIT — app-first destination)
   * GET /users/me/home-summary
   *
   * "What do we owe, and what needs us next?" in one call, for the
   * parent/student dashboard. Parents get every linked child; students
   * get themselves.
   */
  .get('/me/home-summary', async (c) => {
    const user = c.get('user')!;
    if (user.role !== ROLES.PARENT && user.role !== ROLES.STUDENT) {
      return error(c, 'Only parents and students have a home summary', 403);
    }
    try {
      return success(c, await getHomeSummary(user.id, user.role as 'parent' | 'student'));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to load your summary'), 400);
    }
  })

  /**
   * STUDENT 360 (UX_AUDIT G2)
   * GET /users/:id/summary
   *
   * Everything about one student on one screen — registrations with
   * receipt states, payments, escrow (free+held), school fee, active
   * exceptions, remarks, linked parents, and what the family owes.
   * Finance roles + admin.
   */
  .get('/:id/summary',
    requireFinance(),
    zValidator('param', UserId),
    async (c) => {
      const { id } = c.req.valid('param');
      try {
        return success(c, await getStudentSummary(id));
      } catch (err) {
        const message = clientMessage(err, 'Failed to load summary');
        return error(c, message, message.includes('not found') ? 404 : 400);
      }
    }
  )

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

      // Verify user exists, keeping the before-values for the audit row
      const before = await userService.getUserProfile(id);
      if (!before) {
        return error(c, 'User not found', 404);
      }

      const updated = await userService.adminUpdateUser(id, data);

      if (!updated) {
        return error(c, 'Failed to update user', 500);
      }

      // RF-23: a ban takes effect now, not when the account's sessions expire,
      // and no leftover expiry can quietly void it.
      if (data.banned !== undefined) {
        await userService.settleBan(id, data.banned);
      }
      if (data.banned === true) {
        await userService.revokeAllSessions(id);
      }

      // RF-14: an admin changing someone's account (role, ban, grade) left no
      // audit row. Record exactly the fields the request changed.
      const previous = Object.fromEntries(
        Object.keys(data).map((k) => [k, (before as Record<string, unknown>)[k] ?? null])
      );
      await logAction(c.get('user')!.id, 'USER_UPDATED_BY_ADMIN', 'user', id, previous, data as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] USER_UPDATED_BY_ADMIN failed:', err));
      return success(c, updated);
    }
  );

export type UsersApi = typeof users;
