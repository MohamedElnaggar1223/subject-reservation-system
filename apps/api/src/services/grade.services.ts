/**
 * Grade Progression Service
 *
 * Implements GRADE-001 (automatic progression) and GRADE-002 (manual admin adjustment).
 *
 * Progression rules (URD GRADE-001 / DEVELOPMENT_PLAN §Step 4.4):
 *   Grade 10 → 11  after November session closes
 *   Grade 11 → 12  after June session closes
 *   Grade 12 → null (Graduated) after November session closes
 *
 * Graduation semantics (GRADE-003):
 *   A student with role='student' and grade=null is considered graduated.
 *   Graduated students cannot initiate new registrations or change requests.
 *   Parents retain escrow withdrawal rights for graduated students.
 *
 * Both automatic and manual grade changes:
 *   - Fire `notifyGradeChanged` for the student and all linked parents (NOT-010)
 *   - Fire a `USER_GRADE_CHANGED` audit log entry
 *   - The audit log entry is awaited for compliance; notification is fire-and-forget
 */

import { db, user, eq, and, isNotNull } from '@repo/db';
import { notifyGradeChanged } from './notification.services';
import { logAction } from './audit.services';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determine the next grade for a student given the closing session type.
 * Returns null to indicate graduation (Grade 12 after November).
 * Returns currentGrade unchanged if no progression applies.
 */
function getNextGrade(currentGrade: number, sessionType: string): number | null {
  if (currentGrade === 10 && sessionType === 'november') return 11;
  if (currentGrade === 11 && sessionType === 'june')     return 12;
  if (currentGrade === 12 && sessionType === 'november') return null; // graduated
  return currentGrade; // no change
}

// ─── Automatic Progression ────────────────────────────────────────────────────

/**
 * Automatically progress all eligible students after a session closes (GRADE-001).
 *
 * Called from the session scheduler after a session is auto-closed (or from
 * session.routes.ts when an admin manually closes a session).
 *
 * Only students whose current grade would change under `getNextGrade` are affected.
 * Each affected student receives a `USER_GRADE_CHANGED` audit entry and a
 * `GRADE_CHANGED` in-app + email notification.
 *
 * Returns the list of progressions applied.
 */
export async function progressGrades(sessionType: string): Promise<Array<{
  studentId: string;
  name: string;
  previousGrade: number;
  newGrade: number | null;
}>> {
  // Only grade 10, 11, 12 students are eligible (not parents/admins, not already graduated)
  const students = await db.query.user.findMany({
    where: (u, { eq, and, isNotNull }) =>
      and(eq(u.role, 'student'), isNotNull(u.grade)),
    columns: { id: true, name: true, grade: true },
  });

  const progressions: Array<{
    studentId: string;
    name: string;
    previousGrade: number;
    newGrade: number | null;
  }> = [];

  for (const student of students) {
    const currentGrade = student.grade!;
    const nextGrade = getNextGrade(currentGrade, sessionType);

    // Skip if no progression applies for this sessionType
    if (nextGrade === currentGrade) continue;

    // Apply the grade change
    await db
      .update(user)
      .set({ grade: nextGrade })
      .where(eq(user.id, student.id));

    progressions.push({
      studentId: student.id,
      name:      student.name,
      previousGrade: currentGrade,
      newGrade,
    });

    const reason = nextGrade === null
      ? `Automatic graduation after ${sessionType} session.`
      : `Automatic grade progression after ${sessionType} session.`;

    // Audit (awaited — compliance record)
    await logAction(
      null,
      'USER_GRADE_CHANGED',
      'user',
      student.id,
      { grade: currentGrade },
      { grade: nextGrade },
    ).catch((err) => console.error(`[grade] Audit log failed for ${student.id}:`, err));

    // Notification (fire-and-forget — must not block progression loop)
    notifyGradeChanged({
      studentId:     student.id,
      studentName:   student.name,
      previousGrade: currentGrade,
      newGrade,
      reason,
    }).catch((err) => console.error(`[grade] Notification failed for ${student.id}:`, err));
  }

  return progressions;
}

// ─── Manual Grade Adjustment ──────────────────────────────────────────────────

/**
 * Admin manually adjusts a student's grade (GRADE-002).
 *
 * Validates that:
 * - The target user exists and has role='student'
 * - The newGrade is 10, 11, 12, or null (graduation)
 * - The grade is actually changing (no-op guard)
 *
 * Logs a `USER_GRADE_CHANGED` audit entry (awaited) and fires a notification.
 *
 * Returns the updated user record.
 */
export async function manualGradeAdjustment(
  studentId: string,
  newGrade: number | null,
  reason: string,
  adminId: string
) {
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: { id: true, name: true, grade: true, role: true },
  });

  if (!student) {
    throw new Error('Student not found');
  }

  if (student.role !== 'student') {
    throw new Error('User is not a student');
  }

  if (student.grade === newGrade) {
    throw new Error(`Student is already at ${newGrade === null ? 'Graduated' : `Grade ${newGrade}`}`);
  }

  const [updated] = await db
    .update(user)
    .set({ grade: newGrade })
    .where(eq(user.id, studentId))
    .returning();

  // Audit (awaited — admin action must always be logged)
  await logAction(
    adminId,
    'USER_GRADE_CHANGED',
    'user',
    studentId,
    { grade: student.grade },
    { grade: newGrade, reason },
  ).catch((err) => console.error('[grade] Audit log failed for manual adjustment:', err));

  // Notification (fire-and-forget)
  notifyGradeChanged({
    studentId:     student.id,
    studentName:   student.name,
    previousGrade: student.grade,
    newGrade,
    reason,
  }).catch((err) => console.error('[grade] Notification failed for manual adjustment:', err));

  return updated;
}

// ─── Graduated Students ───────────────────────────────────────────────────────

/**
 * Get all graduated students (role='student', grade=null).
 *
 * Used in admin reports and to inform access-restriction logic (GRADE-003).
 * Returns basic profile info only — no sensitive financial data.
 */
export async function getGraduatedStudents() {
  return db.query.user.findMany({
    where: (u, { eq, and, isNull }) =>
      and(eq(u.role, 'student'), isNull(u.grade)),
    columns: {
      id:       true,
      name:     true,
      email:    true,
      studentId: true,
      createdAt: true,
    },
    orderBy: (u, { asc }) => [asc(u.name)],
  });
}

/**
 * Check if a student is graduated (role='student', grade=null).
 * Used as a lightweight guard in other services.
 */
export async function isGraduated(studentId: string): Promise<boolean> {
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: { role: true, grade: true },
  });

  return student?.role === 'student' && student.grade === null;
}
