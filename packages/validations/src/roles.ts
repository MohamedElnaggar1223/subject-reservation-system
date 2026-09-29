import { z } from 'zod';

/**
 * All available roles in the system
 *
 * IGCSE Subject Reservation System roles:
 * - ADMIN: Full system access, manage subjects, sessions, reports
 * - STUDENT: Register subjects, manage own account, escrow
 * - PARENT: Manage linked children, register on behalf, transfer escrow
 * - FINANCE_OFFICER: Confirms in-school/InstaPay payments, issues and
 *   takes back physical receipts, disburses cash refunds
 * - FINANCE_ADMIN: Everything an officer does, plus approving refunds,
 *   granting exceptions, and managing fee schedules
 * - COORDINATOR: The academic lead: calendar, sections, timetable,
 *   attendance oversight, leave approvals, exam entries, pathway overview
 *   (FEATURES_PLAN.md F0a). Each feature grants its endpoints.
 * - TEACHER: A member of staff whose account exists to teach: their own
 *   timetable, attendance for their own lessons, notices for their classes.
 *   Teaching itself is a capability — a teacher record linked to any staff
 *   account (teacher.userId) — so a coordinator or admin who teaches gets
 *   the same screens for their own lessons.
 * - GATE: Reception and security: the day's leave list, check-out, late
 *   arrivals.
 *
 * A user has one role. The three roles added by F0a are denied every
 * endpoint that existed before them except self-service (profile,
 * notifications, own session) until a feature grants one, and never hold
 * better-auth's admin `user` permissions (apps/api/src/lib/permissions.ts).
 */
export const ROLES = {
  ADMIN: 'admin',
  STUDENT: 'student',
  PARENT: 'parent',
  FINANCE_OFFICER: 'finance_officer',
  FINANCE_ADMIN: 'finance_admin',
  COORDINATOR: 'coordinator',
  TEACHER: 'teacher',
  GATE: 'gate',
} as const;

/**
 * Zod schema for role validation
 */
export const RoleSchema = z.enum([
  ROLES.ADMIN,
  ROLES.STUDENT,
  ROLES.PARENT,
  ROLES.FINANCE_OFFICER,
  ROLES.FINANCE_ADMIN,
  ROLES.COORDINATOR,
  ROLES.TEACHER,
  ROLES.GATE,
]);

/** Every role that is a member of staff (not a family). */
export const STAFF_ROLES = [
  ROLES.ADMIN,
  ROLES.FINANCE_OFFICER,
  ROLES.FINANCE_ADMIN,
  ROLES.COORDINATOR,
  ROLES.TEACHER,
  ROLES.GATE,
] as const;

/**
 * The academic lead's powers (calendar, sections, rooms, bell schedules,
 * the grade-10 exception). Admin is a superset.
 */
export const ACADEMIC_ROLES = [ROLES.COORDINATOR, ROLES.ADMIN] as const;

/**
 * Staff who look students up and read their academic standing (grade,
 * cohort, section, status): the desk, the academic lead and admin. Teachers
 * and the gate get what their own features need.
 */
export const STUDENT_RECORD_ROLES = [
  ROLES.FINANCE_OFFICER,
  ROLES.FINANCE_ADMIN,
  ROLES.COORDINATOR,
  ROLES.ADMIN,
] as const;

export function isStaffRole(role: string | null | undefined): boolean {
  return hasRole(role, ...STAFF_ROLES);
}

/**
 * Roles allowed to perform finance-desk operations (payment
 * verification, receipts, refund disbursement). Admin is included as
 * a superset everywhere.
 */
export const FINANCE_ROLES = [
  ROLES.FINANCE_OFFICER,
  ROLES.FINANCE_ADMIN,
  ROLES.ADMIN,
] as const;

/** Roles allowed to approve refunds, grant exceptions, manage fee schedules */
export const FINANCE_ADMIN_ROLES = [
  ROLES.FINANCE_ADMIN,
  ROLES.ADMIN,
] as const;

export function isFinanceRole(role: string | null | undefined): boolean {
  return hasRole(role, ...FINANCE_ROLES);
}

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
export const { ADMIN, STUDENT, PARENT, FINANCE_OFFICER, FINANCE_ADMIN, COORDINATOR, TEACHER, GATE } = ROLES;

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  finance_admin: 'Finance Admin',
  finance_officer: 'Finance Officer',
  coordinator: 'Coordinator',
  teacher: 'Teacher',
  gate: 'Gate',
  parent: 'Parent',
  student: 'Student',
};

