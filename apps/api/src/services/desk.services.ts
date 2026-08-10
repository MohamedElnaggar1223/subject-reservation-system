/**
 * Desk Service (UX_AUDIT G1/G2/G5)
 *
 * Staff acting on a family's behalf at the school desk — the Excel
 * replacement during the transition to app-first self-serve:
 *
 * - onboardFamily: find-or-create parent + student and link them
 *   APPROVED in one action (staff vouch for the family in person, so no
 *   student-login approval loop).
 * - executeDeskRegistration: register subjects AND record the money the
 *   officer just took, in one action — registrations confirm and
 *   receipts are born immediately.
 * - collectSchoolFeeAtDesk: take the school fee at the desk; the
 *   registration gate unlocks on the spot.
 * - getStudentSummary: the Student 360 — everything about one student
 *   on one screen.
 */

import { db, payment, paymentRegistration, registration, parentStudentLink, user as userTable, eq } from '@repo/db';
import { randomUUID } from 'crypto';
import type { DeskOnboardFamilyType, DeskRegistrationType } from '@repo/validations';
import { auth } from '../lib/auth';
import {
  prepareRegistrationInputs,
  validateCoreSubjectRequirements,
} from './registration.services';
import { hasDeadlineExtension } from './exception.services';
import { setStudentFields } from './user.services';
import { getEscrowBalance, debitEscrow } from './escrow.services';
import { confirmPayment } from './payment.services';
import {
  academicYearForDate,
  getApplicableFee,
  hasCompletedSchoolFeePayment,
} from './school-fee.services';
import { isGraduated } from './grade.services';

// ─── Desk onboarding (G5) ────────────────────────────────────────────────────

async function findOrCreatePerson(
  person: { email: string; name?: string; password?: string; phone?: string | null },
  role: 'parent' | 'student',
  grade?: number
): Promise<{ id: string; name: string; email: string; created: boolean }> {
  const existing = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, person.email.toLowerCase()),
    columns: { id: true, name: true, email: true, role: true },
  });

  if (existing) {
    if (existing.role !== role) {
      throw new Error(
        `${person.email} already exists with the role '${existing.role}' — expected ${role}`
      );
    }
    return { id: existing.id, name: existing.name, email: existing.email, created: false };
  }

  if (!person.name || !person.password) {
    throw new Error(
      `${person.email} has no account yet — provide a name and a temporary password to create one`
    );
  }
  if (role === 'student' && grade === undefined) {
    throw new Error('New student accounts need a grade');
  }

  // SECURITY: create through the PUBLIC sign-up API, not better-auth's
  // admin createUser. The admin endpoint would require staff to hold the
  // better-auth `user` resource, which also unlocks /api/auth/admin/*
  // (create-user honours a client-supplied role; set-user-password
  // targets anyone) — i.e. desk staff could mint or seize admin
  // accounts. Sign-up needs no elevated permission, and the role below
  // is a hard-coded server value that can never come from the request.
  const result = await auth.api.signUpEmail({
    body: {
      email: person.email,
      password: person.password,
      name: person.name,
    },
  });

  const userId = result.user.id;

  // Staff vouched for this family in person, so the account is usable
  // immediately — no verification email round-trip at the desk.
  await db
    .update(userTable)
    .set({
      role,
      emailVerified: true,
      ...(person.phone ? { phone: person.phone } : {}),
    })
    .where(eq(userTable.id, userId));

  if (role === 'student') {
    await setStudentFields(userId, grade!);
  }

  return { id: userId, name: result.user.name, email: result.user.email, created: true };
}

/**
 * One desk action: parent + student accounts exist (created if needed)
 * and are linked APPROVED. Idempotent for existing links.
 */
export async function onboardFamily(data: DeskOnboardFamilyType) {
  const parent = await findOrCreatePerson(data.parent, 'parent');
  const student = await findOrCreatePerson(
    data.student,
    'student',
    data.student.grade
  );

  const existingLink = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) =>
      and(eq(l.parentId, parent.id), eq(l.studentId, student.id)),
  });

  let linkStatus = 'approved';
  if (!existingLink) {
    await db.insert(parentStudentLink).values({
      id: randomUUID(),
      parentId: parent.id,
      studentId: student.id,
      status: 'approved',
    });
  } else if (existingLink.status !== 'approved') {
    // Staff vouch in person — approve the pending/rejected link
    await db
      .update(parentStudentLink)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(parentStudentLink.id, existingLink.id));
  } else {
    linkStatus = 'already_linked';
  }

  return { parent, student, linkStatus };
}

// ─── Desk registration + payment (G1) ────────────────────────────────────────

/**
 * Register subjects for a student and (optionally) record the money the
 * officer just took — one action, receipts born immediately.
 */
export async function executeDeskRegistration(staffId: string, data: DeskRegistrationType) {
  if (await isGraduated(data.studentId)) {
    throw new Error('Graduated students cannot be registered for new subjects');
  }

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  if (sess.status !== 'active' && !(await hasDeadlineExtension(data.studentId, sess.id))) {
    throw new Error(
      'Registration window is not open — a finance admin can grant this student a deadline extension'
    );
  }

  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, inArray }) =>
      and(eq(s.isActive, true), inArray(s.id, data.subjectIds)),
  });
  if (subjects.length !== data.subjectIds.length) {
    throw new Error('One or more subjects are invalid or inactive');
  }

  const already = await db.query.registration.findMany({
    where: (r, { eq, and, inArray, notInArray }) =>
      and(
        eq(r.studentId, data.studentId),
        eq(r.sessionId, data.sessionId),
        inArray(r.subjectId, data.subjectIds),
        notInArray(r.status, ['dropped', 'rejected', 'expired'])
      ),
    columns: { subjectId: true },
  });
  if (already.length > 0) {
    throw new Error('Some subjects are already registered for this session');
  }

  const coreCheck = await validateCoreSubjectRequirements(
    data.studentId,
    data.sessionId,
    data.subjectIds
  );
  if (!coreCheck.valid) {
    const names = coreCheck.missingCoreSubjects.map((s) => s.name).join(', ');
    throw new Error(`Grade 10 June session requires all core subjects. Missing: ${names}`);
  }

  // Full V3 pipeline: level match, school-fee gate, retakes, teachers,
  // pricing + exceptions
  const prepared = await prepareRegistrationInputs(
    data.studentId,
    sess,
    subjects,
    data.subjectOptions
  );

  const now = new Date();
  const records = subjects.map((sub) => {
    const p = prepared.get(sub.id)!;
    return {
      id: randomUUID(),
      studentId: data.studentId,
      sessionId: data.sessionId,
      subjectId: sub.id,
      priceAtRegistration: p.pricing.total,
      courseFeeAtRegistration: p.pricing.courseFee,
      registrationFeeAtRegistration: p.pricing.registrationFee,
      isRetake: p.isRetake,
      takenOutsideSchool: p.pricing.isOutsideSchool,
      teacherId: p.teacherId,
      wasCoreAtRegistration: sub.isCore,
      status: 'pending_payment' as const,
      requestedBy: staffId,
      approvedBy: staffId,
      approvedAt: now,
      approvalComments: '[DESK] Registered at the finance desk',
    };
  });

  const totalCost = records.reduce((sum, r) => sum + r.priceAtRegistration, 0);

  // No money taken → register only; the family pays later (app or desk)
  if (!data.collectNow) {
    const created = await db.insert(registration).values(records).returning();
    return { registrations: created, payment: null, totalCost, collected: 0 };
  }

  const escrowToApply = data.collectNow.escrowAmountToApply ?? 0;
  if (escrowToApply > 0) {
    const balance = await getEscrowBalance(data.studentId);
    if (escrowToApply > balance) {
      throw new Error(
        `Escrow balance insufficient. Available: ${balance.toFixed(2)} EGP`
      );
    }
    if (escrowToApply > totalCost) {
      throw new Error('Escrow amount cannot exceed the total cost');
    }
  }

  const paymentId = randomUUID();
  const created = await db.transaction(async (tx) => {
    const inserted = await tx.insert(registration).values(records).returning();

    await tx.insert(payment).values({
      id: paymentId,
      studentId: data.studentId,
      parentId: staffId, // payer of record: the staff member processing the desk
      amount: Math.max(0, totalCost - escrowToApply),
      escrowAmountApplied: escrowToApply,
      paymentMethod: 'in_school',
      purpose: 'registration',
      status: 'pending',
      externalReference: `DESK-${paymentId.slice(0, 8).toUpperCase()}`,
      metadata: { desk: true, staffId },
    });

    if (escrowToApply > 0) {
      await debitEscrow(
        {
          studentId: data.studentId,
          amount: escrowToApply,
          reason: 'payment',
          initiatedBy: staffId,
          relatedPaymentId: paymentId,
        },
        tx
      );
    }

    await tx.insert(paymentRegistration).values(
      inserted.map((r) => ({ id: randomUUID(), paymentId, registrationId: r.id }))
    );

    return inserted;
  });

  // Money is in hand — confirm through the shared path so registrations
  // flip to confirmed, receipts are created, and NOT-005 fires.
  await confirmPayment(
    paymentId,
    staffId,
    undefined,
    data.collectNow.notes ?? 'Collected at the finance desk',
    data.collectNow.instrumentUsed
  );

  const receipts = await db.query.receipt.findMany({
    where: (r, { inArray }) => inArray(r.registrationId, created.map((c) => c.id)),
    columns: { id: true, registrationId: true, receiptNumber: true, status: true },
  });

  return {
    registrations: created,
    payment: { id: paymentId, collected: Math.max(0, totalCost - escrowToApply), escrowApplied: escrowToApply },
    totalCost,
    collected: Math.max(0, totalCost - escrowToApply),
    receipts,
  };
}

/**
 * Collect the annual school fee at the desk — gate unlocks immediately.
 */
export async function collectSchoolFeeAtDesk(
  staffId: string,
  studentId: string,
  instrumentUsed: string,
  notes?: string,
  requestedAcademicYear?: string
) {
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: { id: true, grade: true },
  });
  if (!student) throw new Error('Student not found');

  // The caller may name the year explicitly — around the 1 July
  // rollover the year the registration gate demands is not the year
  // today falls in, which left officers unable to pay the year that was
  // actually blocking the registration in front of them.
  const academicYear = requestedAcademicYear ?? academicYearForDate(new Date());
  const fee = await getApplicableFee(academicYear, student.grade ?? null);
  if (!fee) throw new Error('No school fee is currently open for this student');
  if (await hasCompletedSchoolFeePayment(studentId, academicYear)) {
    throw new Error(`The ${academicYear} school fee is already paid`);
  }

  const paymentId = randomUUID();
  await db.insert(payment).values({
    id: paymentId,
    studentId,
    parentId: staffId,
    amount: fee.amount,
    escrowAmountApplied: 0,
    paymentMethod: 'in_school',
    purpose: 'school_fee',
    academicYear,
    status: 'pending',
    externalReference: `DESK-${paymentId.slice(0, 8).toUpperCase()}`,
    metadata: { desk: true, staffId },
  });

  await confirmPayment(paymentId, staffId, undefined, notes ?? 'School fee collected at desk', instrumentUsed);

  return { paymentId, academicYear, amount: fee.amount };
}

// ─── Student 360 (G2) ────────────────────────────────────────────────────────

/**
 * Everything about one student on one screen — the desk's answer to
 * "what is Ahmed registered in, what has he paid, what does he owe?"
 */
export async function getStudentSummary(studentId: string) {
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: {
      id: true, name: true, email: true, phone: true,
      grade: true, studentId: true, createdAt: true, role: true,
    },
  });
  if (!student) throw new Error('Student not found');
  // Scope strictly to students: without this the Student-360 endpoint
  // would profile staff and admin accounts (name, phone, family graph)
  // for any finance user who guessed an id.
  if (student.role !== 'student') throw new Error('Student not found');

  const [links, escrowAccount, registrations, payments, exceptions, remarks] =
    await Promise.all([
      db.query.parentStudentLink.findMany({
        where: (l, { eq }) => eq(l.studentId, studentId),
        with: { parent: { columns: { id: true, name: true, email: true, phone: true } } },
      }),
      db.query.escrow.findFirst({
        where: (e, { eq }) => eq(e.studentId, studentId),
        columns: { balance: true, heldBalance: true },
      }),
      db.query.registration.findMany({
        where: (r, { eq }) => eq(r.studentId, studentId),
        with: {
          subject: { columns: { id: true, name: true, code: true, council: true } },
          session: { columns: { id: true, name: true, status: true } },
          teacher: { columns: { id: true, name: true } },
        },
        orderBy: (r, { desc }) => [desc(r.createdAt)],
      }),
      db.query.payment.findMany({
        where: (p, { eq }) => eq(p.studentId, studentId),
        columns: {
          id: true, amount: true, escrowAmountApplied: true, paymentMethod: true,
          purpose: true, status: true, instrumentUsed: true, externalReference: true,
          createdAt: true, confirmedAt: true,
        },
        orderBy: (p, { desc }) => [desc(p.createdAt)],
        limit: 20,
      }),
      db.query.exception.findMany({
        where: (e, { eq, and }) => and(eq(e.studentId, studentId), eq(e.status, 'active')),
        columns: { id: true, type: true, value: true, reason: true, validUntil: true },
      }),
      db.query.remarkRequest.findMany({
        where: (r, { eq }) => eq(r.studentId, studentId),
        columns: { id: true, serviceType: true, status: true, feeCharged: true },
        with: {
          registration: {
            columns: { id: true },
            with: { subject: { columns: { name: true, code: true } } },
          },
        },
      }),
    ]);

  const receipts = await db.query.receipt.findMany({
    where: (r, { inArray }) =>
      inArray(r.registrationId, registrations.map((reg) => reg.id).concat('__none__')),
    columns: { id: true, registrationId: true, receiptNumber: true, status: true, refundAmountOnReturn: true },
  });
  const receiptByReg = new Map(receipts.map((r) => [r.registrationId, r]));

  // School-fee status. Check the year containing today AND the year of
  // every open session — near the 1 July rollover these differ, and
  // reporting only "today's" year told officers the fee was paid while
  // registration kept refusing for the session's year.
  const academicYear = academicYearForDate(new Date());
  const openSessionRows = await db.query.registrationSession.findMany({
    where: (sn, { eq }) => eq(sn.status, 'active'),
    columns: { startDate: true },
  });
  const candidateYears = [
    ...new Set([academicYear, ...openSessionRows.map((sn) => academicYearForDate(sn.startDate))]),
  ];

  const schoolFeesDue: { academicYear: string; amount: number }[] = [];
  for (const year of candidateYears) {
    const applicable = await getApplicableFee(year, student.grade ?? null);
    if (!applicable) continue;
    if (await hasCompletedSchoolFeePayment(studentId, year)) continue;
    schoolFeesDue.push({ academicYear: year, amount: applicable.amount });
  }

  const fee = await getApplicableFee(academicYear, student.grade ?? null);
  const schoolFeePaid = fee ? await hasCompletedSchoolFeePayment(studentId, academicYear) : true;

  // What does the family owe right now?
  const owing = registrations
    .filter((r) => r.status === 'pending_payment')
    .reduce((sum, r) => sum + r.priceAtRegistration, 0);

  return {
    student,
    parents: links.map((l) => ({ ...l.parent, linkStatus: l.status })),
    escrow: {
      freeBalance: escrowAccount?.balance ?? 0,
      heldBalance: escrowAccount?.heldBalance ?? 0,
    },
    schoolFee: {
      academicYear,
      required: !!fee,
      amount: fee?.amount ?? null,
      paid: schoolFeePaid,
    },
    // Every year still owed — may include a session year that is not
    // the year containing today
    schoolFeesDue,
    owing,
    registrations: registrations.map((r) => ({
      ...r,
      receipt: receiptByReg.get(r.id) ?? null,
    })),
    payments,
    exceptions,
    remarks,
  };
}
