import { z } from 'zod';

/**
 * All available roles in the system
 */
export const ROLES = {
  ADMIN: 'admin',
  COACH: 'coach',
  STUDENT: 'student',
  USER: 'user',
} as const;

/**
 * Zod schema for role validation
 */
export const RoleSchema = z.enum([
  ROLES.ADMIN,
  ROLES.COACH,
  ROLES.STUDENT,
  ROLES.USER,
]);

/**
 * TypeScript type for Role
 */
export type Role = z.infer<typeof RoleSchema>;

/**
 * Type guard to check if a value is a valid role
 */
export function isRole(value: unknown): value is Role {
  return RoleSchema.safeParse(value).success;
}

/**
 * Helper to check if user has any of the allowed roles
 * @param userRole - The user's current role (can be null/undefined)
 * @param allowedRoles - Array of roles that are allowed
 * @returns true if user has one of the allowed roles
 */
export function hasRole(
  userRole: string | null | undefined,
  ...allowedRoles: Role[]
): boolean {
  if (!userRole) return false;
  return allowedRoles.includes(userRole as Role);
}

/**
 * Export individual roles for convenience
 */
export const { ADMIN, COACH, STUDENT, USER } = ROLES;

