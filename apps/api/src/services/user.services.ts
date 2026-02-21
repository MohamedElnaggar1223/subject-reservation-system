/**
 * User Service
 * 
 * Manages user profile operations:
 * - Viewing user profiles
 * - Updating user profiles
 * - Generating unique student IDs
 * - Admin user management
 */

import { db, user, eq, ilike, or, and } from '@repo/db';
import { randomUUID } from 'crypto';
import type { UpdateProfileType, AdminUpdateUserType, UserQueryFiltersType } from '@repo/validations';

/**
 * Get user profile by ID
 * 
 * @param userId - The user's ID
 * @returns User profile with relevant fields (excludes password/tokens)
 */
export async function getUserProfile(userId: string) {
  return db.query.user.findFirst({
    where: (users, { eq }) => eq(users.id, userId),
    columns: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      image: true,
      role: true,
      grade: true,
      studentId: true,
      phone: true,
      createdAt: true,
      updatedAt: true,
      banned: true,
      banReason: true,
    },
  });
}

/**
 * Get user by email
 * 
 * @param email - The user's email
 * @returns User profile or undefined
 */
export async function getUserByEmail(email: string) {
  return db.query.user.findFirst({
    where: (users, { eq }) => eq(users.email, email),
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      grade: true,
      studentId: true,
    },
  });
}

/**
 * Get user by studentId
 * 
 * @param studentId - The student's unique identifier
 * @returns User profile or undefined
 */
export async function getUserByStudentId(studentId: string) {
  return db.query.user.findFirst({
    where: (users, { eq }) => eq(users.studentId, studentId),
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      grade: true,
      studentId: true,
    },
  });
}

/**
 * Update user profile
 * 
 * @param userId - The user's ID
 * @param data - Fields to update (name, phone)
 * @returns The updated user profile
 */
export async function updateUserProfile(userId: string, data: UpdateProfileType) {
  const [updated] = await db
    .update(user)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      role: user.role,
      grade: user.grade,
      studentId: user.studentId,
      phone: user.phone,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });

  return updated;
}

/**
 * Admin update user
 * 
 * @param userId - The user's ID
 * @param data - Fields to update (includes admin-only fields)
 * @returns The updated user profile
 */
export async function adminUpdateUser(userId: string, data: AdminUpdateUserType) {
  const [updated] = await db
    .update(user)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      role: user.role,
      grade: user.grade,
      studentId: user.studentId,
      phone: user.phone,
      banned: user.banned,
      banReason: user.banReason,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });

  return updated;
}

/**
 * Generate a unique student ID
 * 
 * Format: STU-YYYYMMDD-XXXXX (where X is random alphanumeric)
 * Example: STU-20260128-A7B3C
 * 
 * @returns A unique student ID string
 */
export async function generateUniqueStudentId(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  
  // Try up to 10 times to generate a unique ID
  for (let attempt = 0; attempt < 10; attempt++) {
    const randomPart = randomUUID().slice(0, 5).toUpperCase();
    const studentId = `STU-${dateStr}-${randomPart}`;
    
    // Check if this ID already exists
    const existing = await db.query.user.findFirst({
      where: (users, { eq }) => eq(users.studentId, studentId),
    });
    
    if (!existing) {
      return studentId;
    }
  }
  
  // Fallback: use full UUID suffix
  const fallbackId = `STU-${dateStr}-${randomUUID().slice(0, 8).toUpperCase()}`;
  return fallbackId;
}

/**
 * Set student-specific fields
 * 
 * Used after sign-up to set grade and studentId for students
 * 
 * @param userId - The user's ID
 * @param grade - The student's grade (10, 11, or 12)
 * @returns The updated user
 */
export async function setStudentFields(userId: string, grade: number) {
  const studentId = await generateUniqueStudentId();
  
  const [updated] = await db
    .update(user)
    .set({
      grade,
      studentId,
      role: 'student',
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning();

  return updated;
}

/**
 * Set user role
 * 
 * @param userId - The user's ID
 * @param role - The new role
 * @returns The updated user
 */
export async function setUserRole(userId: string, role: string) {
  const [updated] = await db
    .update(user)
    .set({
      role,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning();

  return updated;
}

/**
 * Get all users (admin only)
 * 
 * @param filters - Optional filters (role, grade, search)
 * @returns Array of users
 */
export async function getAllUsers(filters?: UserQueryFiltersType) {
  return db.query.user.findMany({
    where: (users, { eq, and, or, ilike }) => {
      const conditions = [];
      
      if (filters?.role) {
        conditions.push(eq(users.role, filters.role));
      }
      
      if (filters?.grade) {
        conditions.push(eq(users.grade, filters.grade));
      }
      
      if (filters?.search) {
        conditions.push(
          or(
            ilike(users.name, `%${filters.search}%`),
            ilike(users.email, `%${filters.search}%`),
            ilike(users.studentId, `%${filters.search}%`)
          )
        );
      }
      
      return conditions.length > 0 ? and(...conditions) : undefined;
    },
    columns: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      role: true,
      grade: true,
      studentId: true,
      phone: true,
      banned: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: (users, { desc }) => [desc(users.createdAt)],
  });
}

/**
 * Check if user exists
 * 
 * @param userId - The user's ID
 * @returns true if user exists
 */
export async function userExists(userId: string): Promise<boolean> {
  const existing = await db.query.user.findFirst({
    where: (users, { eq }) => eq(users.id, userId),
    columns: { id: true },
  });
  
  return !!existing;
}
