/**
 * Parent-Student Link Service
 * 
 * Manages parent-student linking operations:
 * - Creating link requests (parent initiates)
 * - Responding to link requests (student approves/rejects)
 * - Querying linked relationships
 * 
 * Business Rules:
 * - Only parents can create link requests
 * - Only students can respond to link requests
 * - A parent-student pair can only have one active (pending/approved) link
 * - Admins can remove any link
 */

import { db, parentStudentLink, user, eq, and, or } from '@repo/db';
import { randomUUID } from 'crypto';
import type { CreateLinkRequestType, RespondToLinkType } from '@repo/validations';

/**
 * Create a link request from parent to student
 * 
 * @param parentId - The parent's user ID
 * @param identifier - Student's email or studentId
 * @returns The created link request
 * @throws Error if student not found or link already exists
 */
export async function createLinkRequest(
  parentId: string,
  identifier: { studentEmail?: string; studentIdentifier?: string }
) {
  // Find the student by email or studentId
  const student = await db.query.user.findFirst({
    where: (users, { or, eq, and }) => and(
      eq(users.role, 'student'),
      or(
        identifier.studentEmail ? eq(users.email, identifier.studentEmail) : undefined,
        identifier.studentIdentifier ? eq(users.studentId, identifier.studentIdentifier) : undefined
      )
    ),
  });

  if (!student) {
    throw new Error('Student not found');
  }

  // Check if a link already exists (pending or approved)
  const existingLink = await db.query.parentStudentLink.findFirst({
    where: (links, { and, eq, or }) => and(
      eq(links.parentId, parentId),
      eq(links.studentId, student.id),
      or(
        eq(links.status, 'pending'),
        eq(links.status, 'approved')
      )
    ),
  });

  if (existingLink) {
    if (existingLink.status === 'approved') {
      throw new Error('Already linked to this student');
    }
    throw new Error('Link request already pending');
  }

  // Create the link request
  const id = randomUUID();
  const now = new Date();

  const [created] = await db
    .insert(parentStudentLink)
    .values({
      id,
      parentId,
      studentId: student.id,
      status: 'pending',
      requestedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return created;
}

/**
 * Get pending link requests for a student
 * 
 * @param studentId - The student's user ID
 * @returns Array of pending link requests with parent info
 */
export async function getPendingLinksForStudent(studentId: string) {
  return db.query.parentStudentLink.findMany({
    where: (links, { and, eq }) => and(
      eq(links.studentId, studentId),
      eq(links.status, 'pending')
    ),
    with: {
      parent: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: (links, { desc }) => [desc(links.requestedAt)],
  });
}

/**
 * Get pending link requests created by a parent
 * 
 * @param parentId - The parent's user ID
 * @returns Array of pending link requests with student info
 */
export async function getPendingLinksForParent(parentId: string) {
  return db.query.parentStudentLink.findMany({
    where: (links, { and, eq }) => and(
      eq(links.parentId, parentId),
      eq(links.status, 'pending')
    ),
    with: {
      student: {
        columns: {
          id: true,
          name: true,
          email: true,
          grade: true,
          studentId: true,
        },
      },
    },
    orderBy: (links, { desc }) => [desc(links.requestedAt)],
  });
}

/**
 * Respond to a link request (approve or reject)
 * 
 * @param linkId - The link request ID
 * @param studentId - The student's user ID (must match the link's studentId)
 * @param response - The response: 'approved' or 'rejected'
 * @returns The updated link request
 * @throws Error if link not found or student doesn't match
 */
export async function respondToLinkRequest(
  linkId: string,
  studentId: string,
  response: RespondToLinkType
) {
  // Verify the link exists and belongs to this student
  const link = await db.query.parentStudentLink.findFirst({
    where: (links, { and, eq }) => and(
      eq(links.id, linkId),
      eq(links.studentId, studentId),
      eq(links.status, 'pending')
    ),
  });

  if (!link) {
    throw new Error('Link request not found or already processed');
  }

  // Update the link status
  const [updated] = await db
    .update(parentStudentLink)
    .set({
      status: response.status,
      respondedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(parentStudentLink.id, linkId))
    .returning();

  return updated;
}

/**
 * Get all linked children for a parent
 * 
 * @param parentId - The parent's user ID
 * @returns Array of approved links with student info
 */
export async function getLinkedChildren(parentId: string) {
  return db.query.parentStudentLink.findMany({
    where: (links, { and, eq }) => and(
      eq(links.parentId, parentId),
      eq(links.status, 'approved')
    ),
    with: {
      student: {
        columns: {
          id: true,
          name: true,
          email: true,
          grade: true,
          studentId: true,
          phone: true,
        },
      },
    },
    orderBy: (links, { asc }) => [asc(links.createdAt)],
  });
}

/**
 * Get all linked parents for a student
 * 
 * @param studentId - The student's user ID
 * @returns Array of approved links with parent info
 */
export async function getLinkedParents(studentId: string) {
  return db.query.parentStudentLink.findMany({
    where: (links, { and, eq }) => and(
      eq(links.studentId, studentId),
      eq(links.status, 'approved')
    ),
    with: {
      parent: {
        columns: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    },
    orderBy: (links, { asc }) => [asc(links.createdAt)],
  });
}

/**
 * Check if a parent is linked to a specific student
 * 
 * @param parentId - The parent's user ID
 * @param studentId - The student's user ID
 * @returns true if the parent is linked (approved) to the student
 */
export async function isParentLinkedToStudent(
  parentId: string,
  studentId: string
): Promise<boolean> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (links, { and, eq }) => and(
      eq(links.parentId, parentId),
      eq(links.studentId, studentId),
      eq(links.status, 'approved')
    ),
  });

  return !!link;
}

/**
 * Get a link by ID
 * 
 * @param linkId - The link request ID
 * @returns The link request or undefined
 */
export async function getLinkById(linkId: string) {
  return db.query.parentStudentLink.findFirst({
    where: (links, { eq }) => eq(links.id, linkId),
    with: {
      parent: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
      student: {
        columns: {
          id: true,
          name: true,
          email: true,
          grade: true,
          studentId: true,
        },
      },
    },
  });
}

/**
 * Delete a link (admin only)
 * 
 * @param linkId - The link request ID
 */
export async function deleteLink(linkId: string) {
  await db.delete(parentStudentLink).where(eq(parentStudentLink.id, linkId));
}

/**
 * Get all links (admin only)
 * 
 * @param status - Optional status filter
 * @returns Array of all links
 */
export async function getAllLinks(status?: string) {
  return db.query.parentStudentLink.findMany({
    where: status ? (links, { eq }) => eq(links.status, status) : undefined,
    with: {
      parent: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
      student: {
        columns: {
          id: true,
          name: true,
          email: true,
          grade: true,
          studentId: true,
        },
      },
    },
    orderBy: (links, { desc }) => [desc(links.createdAt)],
  });
}
