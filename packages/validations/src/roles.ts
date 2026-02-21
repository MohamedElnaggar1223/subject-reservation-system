import { z } from 'zod';

/**
 * All available roles in the system
 * 
 * IGCSE Subject Reservation System roles:
 * - ADMIN: Full system access, manage subjects, sessions, reports
 * - STUDENT: Register subjects, manage own account, escrow
 * - PARENT: Manage linked children, register on behalf, transfer escrow
 */
export const ROLES = {
  ADMIN: 'admin',
  STUDENT: 'student',
  PARENT: 'parent',
} as const;

/**
 * Zod schema for role validation
 */
export const RoleSchema = z.enum([
  ROLES.ADMIN,
  ROLES.STUDENT,
  ROLES.PARENT,
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
 * Student grade levels
 */
export const GRADES = {
  GRADE_10: 10,
  GRADE_11: 11,
  GRADE_12: 12,
} as const;

export const GradeSchema = z.union([
  z.literal(GRADES.GRADE_10),
  z.literal(GRADES.GRADE_11),
  z.literal(GRADES.GRADE_12),
]);

export type Grade = z.infer<typeof GradeSchema>;

/**
 * Export individual roles for convenience
 */
export const { ADMIN, STUDENT, PARENT } = ROLES;

