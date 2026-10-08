/**
 * Home Summary Service (UX_AUDIT — app-first destination)
 *
 * Answers "what do we owe, and what needs us next?" in ONE call, so the
 * parent/student dashboard can lead with actions instead of a grid of
 * links. This is the self-serve mirror of the staff Student 360.
 *
 * Everything here is derived from existing tables — no new state.
 */

import { db } from '@repo/db';
import { getSetting } from './settings.services';
import { academicYearForDate, getSchoolFeeStanding } from './school-fee.services';
import { standingToday, type StudentStanding } from './eligibility.services';
import { sectionOf } from './academic.services';

export type ChildSummary = {
  // Today's grade from the cohort, where the student stands, and this
  // year's section (F0a).
  student: { id: string; name: string; grade: number | null; standing: StudentStanding; section: string | null };
  owing: number;
  owingRegistrationIds: string[];
  escrow: { freeBalance: number; heldBalance: number };
  schoolFee: { academicYear: string; required: boolean; waived: boolean; paid: boolean; amount: number | null };
  pendingApprovalCount: number;
  pendingChangeRequestCount: number;
  receiptsToReturn: number;
  preregisteredUnpaid: number;
};

export type HomeSummary = {
  role: 'parent' | 'student';
  children: ChildSummary[];
  totals: { owing: number; actionsNeeded: number };
  openSessions: { id: string; name: string; endDate: Date; qualificationLevel: string | null }[];
};

async function summariseStudent(studentId: string): Promise<ChildSummary> {
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: { id: true, name: true, cohortYear: true, leftOn: true, leftKind: true },
  });
  if (!student) throw new Error('Student not found');
  const today = standingToday(student);
  const section = await sectionOf(studentId);

  const [registrations, escrowAccount, changeRequests] = await Promise.all([
    db.query.registration.findMany({
      where: (r, { eq, and, inArray }) =>
        and(
          eq(r.studentId, studentId),
          inArray(r.status, [
            'pending_approval',
            'pending_payment',
            'preregistered',
            'confirmed',
            'dropped_pending_receipt',
          ])
        ),
      columns: { id: true, status: true, priceAtRegistration: true, priceProvisional: true },
    }),
    db.query.escrow.findFirst({
      where: (e, { eq }) => eq(e.studentId, studentId),
      columns: { balance: true, heldBalance: true },
    }),
    db.query.changeRequest.findMany({
      where: (c, { eq }) => eq(c.status, 'pending_approval'),
      columns: { id: true, registrationId: true },
      with: { registration: { columns: { studentId: true } } },
    }),
  ]);

  // A line on a provisional board fee is reserved, not payable, until the fee is confirmed
  // (§3.4) — unless the school takes payment at that price; the checkout refuses it otherwise.
  const payOnProvisional = await getSetting('pricing.payOnProvisionalFee');
  const payable = registrations.filter((r) => r.status === 'pending_payment' && (!r.priceProvisional || payOnProvisional));
  const owing = payable.reduce((sum, r) => sum + r.priceAtRegistration, 0);

  // Receipts the family must physically bring back before a drop completes
  const gatedRegIds = registrations
    .filter((r) => r.status === 'dropped_pending_receipt')
    .map((r) => r.id);
  const receiptsToReturn = gatedRegIds.length;

  const academicYear = academicYearForDate(new Date());
  // One source of truth for the fee (RF-10) — this used to report a
  // waived, never-paid fee as paid:true.
  const standing = await getSchoolFeeStanding(studentId, today.grade, academicYear);
  const fee = standing.fee;

  return {
    student: { id: student.id, name: student.name, grade: today.grade, standing: today.standing, section: section?.name ?? null },
    owing: Math.round(owing * 100) / 100,
    owingRegistrationIds: payable.map((r) => r.id),
    escrow: {
      freeBalance: escrowAccount?.balance ?? 0,
      heldBalance: escrowAccount?.heldBalance ?? 0,
    },
    schoolFee: {
      academicYear,
      required: standing.required,
      waived: standing.waived,
      paid: standing.paid,
      amount: fee?.amount ?? null,
    },
    pendingApprovalCount: registrations.filter((r) => r.status === 'pending_approval').length,
    pendingChangeRequestCount: changeRequests.filter(
      (c) => c.registration?.studentId === studentId
    ).length,
    receiptsToReturn,
    preregisteredUnpaid: registrations.filter((r) => r.status === 'preregistered').length,
  };
}

export async function getHomeSummary(
  userId: string,
  role: 'parent' | 'student'
): Promise<HomeSummary> {
  let studentIds: string[];
  if (role === 'student') {
    studentIds = [userId];
  } else {
    const links = await db.query.parentStudentLink.findMany({
      where: (l, { eq, and }) => and(eq(l.parentId, userId), eq(l.status, 'approved')),
      columns: { studentId: true },
    });
    studentIds = links.map((l) => l.studentId);
  }

  const children = await Promise.all(studentIds.map((id) => summariseStudent(id)));

  const openSessions = await db.query.registrationSession.findMany({
    where: (s, { eq }) => eq(s.status, 'active'),
    columns: { id: true, name: true, endDate: true, qualificationLevel: true },
    orderBy: (s, { asc }) => [asc(s.endDate)],
  });

  const owing = children.reduce((sum, c) => sum + c.owing, 0);
  const actionsNeeded = children.reduce(
    (sum, c) =>
      sum +
      // A parent must act on approvals; a student is waiting on theirs
      (role === 'parent' ? c.pendingApprovalCount + c.pendingChangeRequestCount : 0) +
      c.receiptsToReturn +
      (c.schoolFee.required && !c.schoolFee.paid ? 1 : 0) +
      (c.owing > 0 ? 1 : 0),
    0
  );

  return {
    role,
    children,
    totals: { owing: Math.round(owing * 100) / 100, actionsNeeded },
    openSessions,
  };
}
