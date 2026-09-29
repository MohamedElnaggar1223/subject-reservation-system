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

import { db, payment, paymentRegistration, registration, parentStudentLink, user as userTable, eq, and, inArray, gradeTodayExtras } from '@repo/db';
import { randomUUID } from 'crypto';
import type { DeskOnboardFamilyType, DeskRegistrationType, DeskCollectType } from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { auth } from '../lib/auth';
import {
  prepareRegistrationInputs,
  validateCoreSubjectRequirements,
} from './registration.services';
import { sessionWindow, entryDeadlineMessage } from './window.services';
import { setStudentFields } from './user.services';
import { getEscrowBalance, debitEscrow } from './escrow.services';
import { confirmPayment, failPayment } from './payment.services';
import {
  academicYearForDate,
  getSchoolFeeStanding,
  studentGradeInYear,
} from './school-fee.services';
import { assertMayRegisterFor, assertMayRegisterForInTx, mayRegisterFor, standingToday } from './eligibility.services';
import { sectionOf } from './academic.services';
import { academicYearShortLabel, academicYearStartOf, gradeInAcademicYear, gradeLabel, academicYearStartFromLabel } from '@repo/validations';

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

  // The live link (pending or approved — the database allows one per pair).
  // Any link, rejected ones included, used to be picked and flipped, so a
  // family with a rejected request and a pending one could not be enrolled
  // (state audit ST-10). A rejected request stays as history.
  const liveLink = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and, inArray }) =>
      and(eq(l.parentId, parent.id), eq(l.studentId, student.id), inArray(l.status, ['pending', 'approved'])),
  });

  if (liveLink?.status === 'approved') return { parent, student, linkStatus: 'already_linked' };
  if (liveLink) {
    // Staff vouch in person — approve the pending request, if it is still pending.
    await db
      .update(parentStudentLink)
      .set({ status: 'approved', respondedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(parentStudentLink.id, liveLink.id), eq(parentStudentLink.status, 'pending')));
  } else {
    await db.insert(parentStudentLink).values({
      id: randomUUID(),
      parentId: parent.id,
      studentId: student.id,
      status: 'approved',
    }).onConflictDoNothing();
  }
  const [now] = await db
    .select({ status: parentStudentLink.status })
    .from(parentStudentLink)
    .where(and(eq(parentStudentLink.parentId, parent.id), eq(parentStudentLink.studentId, student.id), inArray(parentStudentLink.status, ['pending', 'approved'])));
  if (now?.status !== 'approved') throw new Error('The link changed while enrolling the family — please try again');

  return { parent, student, linkStatus: 'approved' };
}

// ─── Desk registration + payment (G1) ────────────────────────────────────────

/**
 * Register subjects for a student and (optionally) record the money the
 * officer just took — one action, receipts born immediately.
 */
export async function executeDeskRegistration(staffId: string, data: DeskRegistrationType, auditCtx?: AuditContext) {
  // F0a: call site 5 of mayRegisterFor — the desk registers only for a
  // series the student may sit.
  const eligibility = await assertMayRegisterFor(data.studentId, data.sessionId);

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  const w = await sessionWindow(data.studentId, sess.id);
  if (!w.open) {
    throw new Error(
      w.entryDeadlinePassed
        ? entryDeadlineMessage(w.entryDeadline!)
        : 'Registration window is not open — a finance admin can grant this student a deadline extension'
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
    data.subjectOptions,
    eligibility
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
    const created = await db.transaction(async (tx) => {
      // Asked again with the student and window held (F0a; see assertMayRegisterForInTx).
      await assertMayRegisterForInTx(tx, data.studentId, data.sessionId);
      const inserted = await tx.insert(registration).values(records).returning();
      await logAction(staffId, 'DESK_REGISTRATION', 'registration', data.studentId, null,
        { subjects: inserted.length, registrationIds: inserted.map((r) => r.id), collected: 0 }, auditCtx, tx);
      return inserted;
    });
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
  // Only money needs a payer of record; register-only desk actions (family
  // pays later) can proceed for a student who is not linked yet.
  const payerParentId = data.collectNow ? await resolvePayerParent(data.studentId) : staffId;

  const created = await db.transaction(async (tx) => {
    // Asked again with the student and window held (F0a; see assertMayRegisterForInTx).
    await assertMayRegisterForInTx(tx, data.studentId, data.sessionId);
    const inserted = await tx.insert(registration).values(records).returning();

    await tx.insert(payment).values({
      id: paymentId,
      studentId: data.studentId,
      // Payer of record is the family, not the officer (RF-03): confirmations
      // go to whoever is here; the staff member stays in confirmedBy/metadata.
      parentId: payerParentId,
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

    // The registrations, the escrow debit and their audit row commit together
    // (MO-1); the confirmation that follows writes its own rows.
    await logAction(staffId, 'DESK_REGISTRATION', 'registration', data.studentId, null,
      { subjects: inserted.length, registrationIds: inserted.map((r) => r.id), paymentId,
        toCollect: Math.max(0, totalCost - escrowToApply), escrowApplied: escrowToApply }, auditCtx, tx);

    return inserted;
  });

  // Money is in hand — confirm through the shared path so registrations
  // flip to confirmed, receipts are created, and NOT-005 fires.
  await confirmDeskPayment(
    paymentId,
    staffId,
    data.collectNow.notes ?? 'Collected at the finance desk',
    data.collectNow.instrumentUsed,
    auditCtx
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
 * Confirm a payment the desk has just created. The payment is created in one
 * transaction and confirmed in the next, so between them the close or a
 * parent could fail it: confirmPayment then returns undefined, and the desk
 * must not answer "collected". If confirmation throws, the desk's own
 * payment is failed so its escrow comes back and a retry is not refused as
 * "in progress" (money audit review, second round).
 */
async function confirmDeskPayment(
  paymentId: string,
  staffId: string,
  notes: string,
  instrumentUsed: string,
  auditCtx?: AuditContext
) {
  let confirmed;
  try {
    confirmed = await confirmPayment(paymentId, staffId, undefined, notes, instrumentUsed, auditCtx);
  } catch (err) {
    await failPayment(paymentId, { from: ['pending'], reason: 'Desk collection could not be confirmed' })
      .catch((e) => console.error(`[desk] could not release payment ${paymentId}:`, e));
    throw err;
  }
  if (!confirmed) {
    throw new Error('The payment was closed before it could be confirmed — nothing was collected; please try again');
  }
}

/**
 * Take the money at the desk for subjects already registered and waiting for
 * payment (money audit MA-18). Families are sent to the desk after a
 * reversal, a rejected transfer or a cancelled checkout, and a register-only
 * desk visit leaves subjects in the same state; the desk could only register
 * new subjects, so it had no way to take that money.
 *
 * Same shape as a desk registration's collect step: one in-school payment
 * with the family as payer of record, escrow applied if asked, confirmed at
 * once through confirmPayment (receipts, notifications, audit rows).
 */
export async function collectAtDesk(staffId: string, data: DeskCollectType, auditCtx?: AuditContext) {
  const regs = await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.id, data.registrationIds),
    columns: { id: true, studentId: true, sessionId: true, status: true, priceAtRegistration: true },
  });
  if (regs.length !== data.registrationIds.length || regs.some((r) => r.studentId !== data.studentId)) {
    throw new Error('One or more subjects do not belong to this student');
  }
  if (regs.some((r) => r.status !== 'pending_payment')) {
    throw new Error('One or more subjects are not waiting for payment');
  }
  for (const sessionId of new Set(regs.map((r) => r.sessionId))) {
    // F0a: call site 6 of mayRegisterFor — no money for a subject the
    // student may no longer sit (SO-7).
    await assertMayRegisterFor(data.studentId, sessionId);
    const w = await sessionWindow(data.studentId, sessionId);
    if (!w.open) {
      throw new Error(
        w.entryDeadlinePassed
          ? entryDeadlineMessage(w.entryDeadline!)
          : 'Registration window is not open — a finance admin can grant this student a deadline extension'
      );
    }
  }

  const totalCost = Math.round(regs.reduce((s, r) => s + r.priceAtRegistration, 0) * 100) / 100;
  const escrowToApply = data.escrowAmountToApply ?? 0;
  if (escrowToApply > totalCost) throw new Error('Escrow amount cannot exceed the total cost');
  const payerParentId = await resolvePayerParent(data.studentId);
  const paymentId = randomUUID();

  await db.transaction(async (tx) => {
    // Same guard as an app checkout (MA-06): lock the subjects, then make sure
    // nothing else is already paying for them.
    const locked = await tx
      .select({ id: registration.id, status: registration.status })
      .from(registration)
      .where(inArray(registration.id, data.registrationIds))
      .orderBy(registration.id)
      .for('update');
    if (locked.some((r) => r.status !== 'pending_payment')) {
      throw new Error('One or more subjects are not waiting for payment');
    }
    const open = await tx
      .select({ ref: payment.externalReference, method: payment.paymentMethod })
      .from(paymentRegistration)
      .innerJoin(payment, eq(payment.id, paymentRegistration.paymentId))
      .where(and(inArray(paymentRegistration.registrationId, data.registrationIds), inArray(payment.status, ['pending', 'pending_verification'])));
    if (open.length > 0) {
      throw new Error(
        `These subjects already have a ${open[0]!.method === 'instapay' ? 'transfer' : 'checkout'} in progress — confirm it or reject it in the Finance Workbench first`
      );
    }

    await tx.insert(payment).values({
      id: paymentId,
      studentId: data.studentId,
      parentId: payerParentId,
      amount: Math.max(0, Math.round((totalCost - escrowToApply) * 100) / 100),
      escrowAmountApplied: escrowToApply,
      paymentMethod: 'in_school',
      purpose: 'registration',
      status: 'pending',
      externalReference: `DESK-${paymentId.slice(0, 8).toUpperCase()}`,
      metadata: { desk: true, staffId },
    });
    if (escrowToApply > 0) {
      await debitEscrow(
        { studentId: data.studentId, amount: escrowToApply, reason: 'payment', initiatedBy: staffId, relatedPaymentId: paymentId },
        tx
      );
    }
    await tx.insert(paymentRegistration).values(
      data.registrationIds.map((registrationId) => ({ id: randomUUID(), paymentId, registrationId }))
    );
    await logAction(staffId, 'PAYMENT_INITIATED', 'payment', paymentId, null,
      { desk: true, registrationIds: data.registrationIds, amount: totalCost - escrowToApply, escrowApplied: escrowToApply }, auditCtx, tx);
  });

  await confirmDeskPayment(paymentId, staffId, data.notes ?? 'Collected at the finance desk', data.instrumentUsed, auditCtx);

  // Only receipts ready to hand over; a void one is never offered (MA-20).
  const receipts = await db.query.receipt.findMany({
    where: (r, { inArray: inArr, and: andOp, eq: eqOp }) =>
      andOp(inArr(r.registrationId, data.registrationIds), eqOp(r.status, 'pending_issue')),
    columns: { id: true, registrationId: true, receiptNumber: true, status: true },
  });
  return {
    paymentId,
    collected: Math.max(0, Math.round((totalCost - escrowToApply) * 100) / 100),
    escrowApplied: escrowToApply,
    receipts,
  };
}

/**
 * Collect the annual school fee at the desk — gate unlocks immediately.
 */
const SCHOOL_FEE_IN_PROGRESS = 'A school-fee payment is already in progress for this student — confirm or reject it instead';

export async function collectSchoolFeeAtDesk(
  staffId: string,
  studentId: string,
  instrumentUsed: string,
  notes?: string,
  requestedAcademicYear?: string,
  auditCtx?: AuditContext
) {
  const student = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: { id: true },
  });
  if (!student) throw new Error('Student not found');

  // The caller may name the year explicitly — around the 1 July
  // rollover the year the registration gate demands is not the year
  // today falls in, which left officers unable to pay the year that was
  // actually blocking the registration in front of them.
  const academicYear = requestedAcademicYear ?? academicYearForDate(new Date());
  // Same source of truth as every screen (RF-10): a waived family must not
  // be charged at the desk any more than shown a "due" badge. The fee is the
  // one for the student's grade in that year (F0a).
  const standing = await getSchoolFeeStanding(studentId, await studentGradeInYear(studentId, academicYear), academicYear);
  const fee = standing.fee;
  if (!fee) throw new Error('No school fee is currently open for this student');
  if (standing.waived) {
    throw new Error(`The ${academicYear} school fee is waived for this student — nothing to collect`);
  }
  if (standing.paid) {
    throw new Error(`The ${academicYear} school fee is already paid`);
  }
  // A family's own checkout for it (a transfer being checked, or pay-at-school)
  // is confirmed or rejected from the workbench, not collected again here.
  const open = await db.query.payment.findFirst({
    where: (p, { eq: eqOp, and: andOp, inArray: inArr }) =>
      andOp(eqOp(p.studentId, studentId), eqOp(p.purpose, 'school_fee'), eqOp(p.academicYear, academicYear), inArr(p.status, ['pending', 'pending_verification'])),
    columns: { id: true },
  });
  if (open) throw new Error(SCHOOL_FEE_IN_PROGRESS);

  const paymentId = randomUUID();
  const payerParentId = await resolvePayerParent(studentId);
  await db.transaction(async (tx) => {
    // The unique index (one open or paid school fee per student and year) is
    // what stops two collections at the same moment (state audit ST-02).
    await tx.insert(payment).values({
      id: paymentId,
      studentId,
      parentId: payerParentId, // the family, not the officer (RF-03)
      amount: fee.amount,
      escrowAmountApplied: 0,
      paymentMethod: 'in_school',
      purpose: 'school_fee',
      academicYear,
      status: 'pending',
      externalReference: `DESK-${paymentId.slice(0, 8).toUpperCase()}`,
      metadata: { desk: true, staffId },
    }).catch((err) => {
      if ((err as { cause?: { code?: string } } | null)?.cause?.code === '23505') throw new Error(SCHOOL_FEE_IN_PROGRESS);
      throw err;
    });
    // Written with the payment it describes (MO-1); the confirmation writes its own row.
    await logAction(staffId, 'DESK_SCHOOL_FEE_COLLECTED', 'payment', paymentId, null,
      { paymentId, academicYear, amount: fee.amount, instrumentUsed }, auditCtx, tx);
  });

  await confirmDeskPayment(paymentId, staffId, notes ?? 'School fee collected at desk', instrumentUsed, auditCtx);

  return { paymentId, academicYear, amount: fee.amount };
}

/**
 * The family member of record for money taken at the desk (RF-03). Desk
 * money belongs to the family, not to the officer taking it: the earliest
 * approved linked parent becomes payment.parentId so payment confirmations
 * reach them. With several linked parents the earliest link wins, which is
 * an arbitrary tie-break; the other parents are NOT notified today (NOT-010,
 * "every linked parent hears about their child", is deferred to the
 * notification audit).
 *
 * A student with no approved parent link cannot pay at the desk: there would
 * be nobody to notify and nobody accountable for the money. The officer
 * onboards the parent first (one form, see onboardFamily) and tries again.
 */
async function resolvePayerParent(studentId: string): Promise<string> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) => and(eq(l.studentId, studentId), eq(l.status, 'approved')),
    orderBy: (l, { asc }) => [asc(l.createdAt)],
    columns: { parentId: true },
  });
  if (!link) {
    throw new Error(
      'This student has no linked parent — use New Family (Onboard) to add the parent before taking money'
    );
  }
  return link.parentId;
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
      cohortYear: true, studentId: true, createdAt: true, role: true,
      leftOn: true, leftKind: true, leftReason: true,
    },
    extras: gradeTodayExtras,
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
          // For "Transfer found" on a failed InstaPay payment (recordLateTransfer).
          verificationReference: true, lateTransferAt: true,
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

  // School-fee status. Check the year containing today AND the academic
  // year of every open series — a November window opening in June belongs
  // to the next year, and reporting only "today's" year told officers the
  // fee was paid while registration kept refusing for the series' year. The
  // fee is the one for the student's grade in each year (F0a).
  const academicYear = academicYearForDate(new Date());
  const openSessionRows = await db.query.registrationSession.findMany({
    where: (sn, { eq }) => eq(sn.status, 'active'),
    columns: { id: true },
  });
  const openEligibility = await Promise.all(openSessionRows.map((sn) => mayRegisterFor(studentId, sn.id)));
  const candidateYears = [
    ...new Set([academicYear, ...openEligibility.filter((e) => e.allowed && !e.graduateRetake).map((e) => e.academicYear)]),
  ];

  // One source of truth for the fee (RF-10): this screen used to tell the
  // officer to collect a fee the finance admin had waived.
  const schoolFeesDue: { academicYear: string; amount: number }[] = [];
  for (const year of candidateYears) {
    const standing = await getSchoolFeeStanding(studentId, gradeInAcademicYear(student.cohortYear, academicYearStartFromLabel(year)!), year);
    if (!standing.fee || standing.settled) continue;
    schoolFeesDue.push({ academicYear: year, amount: standing.fee.amount });
  }

  const currentStanding = await getSchoolFeeStanding(studentId, student.grade, academicYear);
  const fee = currentStanding.fee;

  // What does the family owe right now?
  const owing = registrations
    .filter((r) => r.status === 'pending_payment')
    .reduce((sum, r) => sum + r.priceAtRegistration, 0);

  // The academic record (F0a): grade, cohort, section, status.
  const today = standingToday(student);
  const currentSection = await sectionOf(studentId);

  return {
    student,
    academic: {
      grade: today.grade,
      gradeLabel: gradeLabel(today.grade),
      standing: today.standing,
      academicYear: today.academicYear,
      cohortLabel: student.cohortYear === null ? null : academicYearShortLabel(student.cohortYear),
      section: currentSection ? { id: currentSection.sectionId, name: currentSection.name, grade: currentSection.grade } : null,
      currentAcademicYearStart: academicYearStartOf(),
    },
    parents: links.map((l) => ({ ...l.parent, linkStatus: l.status })),
    escrow: {
      freeBalance: escrowAccount?.balance ?? 0,
      heldBalance: escrowAccount?.heldBalance ?? 0,
    },
    schoolFee: {
      academicYear,
      required: currentStanding.required,
      waived: currentStanding.waived,
      amount: fee?.amount ?? null,
      paid: currentStanding.paid,
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
