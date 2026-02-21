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
      
      const updated = await userService.updateUserProfile(currentUser.id, data);
      
      if (!updated) {
        return error(c, 'Failed to update profile', 500);
      }
      
      return success(c, updated);
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
      const currentUser = c.get('user')!;
      const { grade } = c.req.valid('json');
      
      // Check if user already has a role set (prevent duplicate setup)
      if (currentUser.role) {
        return error(c, 'Account already configured', 400);
      }
      
      try {
        const updated = await userService.setStudentFields(currentUser.id, grade);
        
        if (!updated) {
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
        console.error('Student setup error:', err);
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
      
      // Check if user already has a role set (prevent duplicate setup)
      if (currentUser.role) {
        return error(c, 'Account already configured', 400);
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
