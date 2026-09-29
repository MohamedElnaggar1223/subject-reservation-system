/**
 * User Service
 *
 * Manages user profile operations:
 * - Viewing user profiles
 * - Updating user profiles
 * - Generating unique student IDs
 * - Admin user management
 */

import { db, user, session, teacher, eq, ilike, or, and, sql, gradeTodaySql, gradeTodayExtras } from '@repo/db';
import { randomUUID } from 'crypto';
import { academicYearStartOf, cohortFromGrade, type UpdateProfileType, type AdminUpdateUserType, type UserQueryFiltersType } from '@repo/validations';

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
      cohortYear: true,
      leftOn: true,
      leftKind: true,
      studentId: true,
      phone: true,
      createdAt: true,
      updatedAt: true,
      banned: true,
      banReason: true,
    },
    // Today's grade (F0a): derived from the cohort, never stored.
    extras: gradeTodayExtras,
    with: {
      // Teaching is a capability (F0a): the teacher record this account
      // teaches as, if any.
      teachingAs: { columns: { id: true, name: true, isActive: true } },
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
      cohortYear: true,
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
      cohortYear: true,
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
      cohortYear: user.cohortYear,
      grade: gradeTodaySql(user.cohortYear),
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
      cohortYear: user.cohortYear,
      grade: gradeTodaySql(user.cohortYear),
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
 * An account created by staff (the admin's team form) is vouched for in
 * person, like one created at the desk, so it can sign in at once. Without
 * this, the production default of required email verification (RF-22)
 * would lock every staff-created account out: nothing sends them a
 * verification email.
 */
export async function markEmailVerified(userId: string) {
  await db.update(user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(user.id, userId));
}

/**
 * End every session a user has (RF-23). Banning an account used to leave
 * its sessions alive, so a banned finance officer kept confirm and reverse
 * authority until the session expired.
 */
export async function revokeAllSessions(userId: string) {
  await db.delete(session).where(eq(session.userId, userId));
}

/**
 * Make a ban set through the admin form mean what it says (RF-23). A ban is
 * open-ended, so any expiry left from an earlier timed ban is cleared — an
 * expired date would otherwise make the new ban void, and better-auth would
 * lift it at the next sign-in. Lifting a ban clears its reason and expiry.
 */
export async function settleBan(userId: string, banned: boolean) {
  await db
    .update(user)
    .set(banned ? { banExpires: null, updatedAt: new Date() } : { banReason: null, banExpires: null, updatedAt: new Date() })
    .where(eq(user.id, userId));
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
 * Used after sign-up (and by the desk and the admin's team form) to make an
 * account a student: the grade they are in this academic year becomes the
 * cohort that is stored (F0a), and a student ID is minted.
 *
 * @param userId - The user's ID
 * @param gradeNow - The student's grade this academic year (9–12)
 * @returns The updated user
 */
export async function setStudentFields(userId: string, gradeNow: number) {
  const studentId = await generateUniqueStudentId();

  const [updated] = await db
    .update(user)
    .set({
      cohortYear: cohortFromGrade(gradeNow, academicYearStartOf()),
      studentId,
      role: 'student',
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning();

  return updated && { ...updated, grade: gradeNow };
}

/**
 * Record the cohort of a student whose grade was never recorded (the setup
 * page, called again). Changing a cohort that exists is an audited
 * correction (student.services.ts), never this.
 */
export async function recordMissingCohort(userId: string, gradeNow: number) {
  const [updated] = await db
    .update(user)
    .set({
      cohortYear: cohortFromGrade(gradeNow, academicYearStartOf()),
      updatedAt: new Date(),
    })
    .where(and(eq(user.id, userId), sql`${user.cohortYear} IS NULL`))
    .returning();

  return updated && { ...updated, grade: gradeNow };
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
        // Today's grade, from the cohort (F0a)
        conditions.push(sql`${gradeTodaySql(users.cohortYear)} = ${filters.grade}`);
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
      cohortYear: true,
      leftOn: true,
      leftKind: true,
      studentId: true,
      phone: true,
      banned: true,
      createdAt: true,
      updatedAt: true,
    },
    extras: gradeTodayExtras,
    with: {
      teachingAs: { columns: { id: true, name: true } },
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


/**
 * People search for staff desks (UX_AUDIT staff-C1).
 *
 * The Desk and the exceptions picker need to find a family, but
 * GET /users is admin-only — finance staff were getting a silent 403
 * and an empty dropdown, which made the whole Desk inoperable. This is
 * a narrow, field-limited alternative: students and parents only, never
 * staff or admin accounts.
 */
export async function searchPeople(params: { search?: string; role?: 'student' | 'parent' }) {
  const term = params.search?.trim();
  return db.query.user.findMany({
    where: (u, { and, or, ilike, inArray, eq }) => {
      const scope = params.role
        ? eq(u.role, params.role)
        : inArray(u.role, ['student', 'parent']);
      if (!term) return scope;
      return and(
        scope,
        or(
          ilike(u.name, `%${term}%`),
          ilike(u.email, `%${term}%`),
          ilike(u.studentId, `%${term}%`)
        )
      );
    },
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      cohortYear: true,
      studentId: true,
      // Shown as such everywhere (F0a): the desk sees a student who left.
      leftOn: true,
      leftKind: true,
    },
    extras: gradeTodayExtras,
    orderBy: (u, { asc }) => [asc(u.name)],
    limit: 25,
  });
}

/** The teacher record an account teaches as (F0a), if any. */
export async function teacherIdForUser(userId: string): Promise<string | null> {
  const [row] = await db.select({ id: teacher.id }).from(teacher).where(eq(teacher.userId, userId));
  return row?.id ?? null;
}
