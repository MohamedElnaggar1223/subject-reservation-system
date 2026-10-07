/**
 * Registration Service
 *
 * Business logic for the full subject registration workflow:
 * - Student submits a registration request (pending parent approval)
 * - Parent approves or rejects pending requests
 * - Parent directly registers for a linked child (auto-approved)
 * - Admin overrides parent approval with mandatory audit reason
 * - Core subject validation for Grade 10 June sessions
 * - Available subject filtering (excludes already-registered subjects)
 *
 * Status flow:
 * Student-initiated:  pending_approval → (parent approves) → pending_payment → (payment) → confirmed
 * Parent-initiated:   pending_payment → (payment) → confirmed
 * Admin override:     pending_payment (directly, reason logged in approvalComments)
 * Rejected:           rejected (terminal)
 * Dropped:            dropped (via change request — Step 3.4)
 *
 * All database imports come from @repo/db — never from drizzle-orm directly.
 */

import {
  db,
  registration,
  sessionOffer,
  sessionOfferTeacher,
  sessionOfferItemTeacher,
  teacher,
  subject,
  sql,
  eq,
  and,
  inArray,
  gradeTodayExtras,
} from '@repo/db';
import type {
  RequestRegistrationType,
  DirectRegistrationType,
  ApproveRegistrationsType,
  RevertApprovedRegistrationsType,
  RejectRegistrationsType,
  AdminOverrideApprovalType,
  ListRegistrationsQueryType,
} from '@repo/validations';
import {
  notifyRegistrationRequestReceived,
  notifyRegistrationDecision,
  notifyDirectRegistrationCreated,
} from './notification.services';
import { assertMayRegisterFor, assertMayRegisterForInTx, mayRegisterFor, type Eligibility } from './eligibility.services';
import { priceLine } from './pricing.services';
import { schoolFeeGateReason } from './school-fee.services';
import { sessionWindow, windowRefusal } from './window.services';
import { insertLines, legacyLinesFor } from './line.services';
import { availabilityConstraints, resolveItem } from './offer.services';
import { effectiveDeadlineFor } from './deadline.services';
import type { SubjectRegistrationOptionsType, LineInputType } from '@repo/validations';

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Refuse unless the series is open for this student (window.services.ts):
 * for a line, its own effective deadline decides; for a new reservation (`null`), each new
 * line's deadline is checked when it is made.
 */
async function assertWindowOpen(studentId: string, sessionId: string, line: { boardSeriesId: string | null; attempt: string; priorSittingSeriesId: string | null } | null) {
  const w = await sessionWindow(studentId, sessionId, line);
  if (w.open) return;
  throw new Error(windowRefusal(w));
}

/**
 * The paths that still name subjects (request, direct, override, desk, preregistration): the
 * school-fee gate (D-H: the fee of the series' academic year at the student's grade in it,
 * F0a), then the subjects as lines — each subject's whole item, its attempt from history, its
 * mode from the option or the item (line.services.ts legacyLinesFor). Until step B gives these
 * paths `lines` and `consent`.
 */
export async function prepareLegacyLines(
  studentId: string,
  sessionId: string,
  subjectIds: string[],
  subjectOptions: Record<string, SubjectRegistrationOptionsType> | undefined,
  eligibility: Eligibility,
): Promise<LineInputType[]> {
  const gate = await schoolFeeGateReason(studentId, eligibility);
  if (gate) throw new Error(gate);
  return legacyLinesFor(db, studentId, sessionId, subjectIds, subjectOptions);
}

/**
 * Verify that a parent has an approved link to a specific student.
 */
async function validateParentStudentLink(
  parentId: string,
  studentId: string
): Promise<boolean> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) =>
      and(
        eq(l.parentId, parentId),
        eq(l.studentId, studentId),
        eq(l.status, 'approved')
      ),
    columns: { id: true },
  });
  return !!link;
}

/**
 * Return the IDs of all students linked (approved) to a parent.
 */
async function getLinkedStudentIds(parentId: string): Promise<string[]> {
  const links = await db.query.parentStudentLink.findMany({
    where: (l, { eq, and }) =>
      and(eq(l.parentId, parentId), eq(l.status, 'approved')),
    columns: { studentId: true },
  });
  return links.map((l) => l.studentId);
}

/**
 * Return true if a student has at least one approved parent link.
 *
 * Used to block student-initiated registration requests when nobody can
 * approve them — otherwise the requests would sit forever in
 * pending_approval until session close expires them (silent hang).
 */
async function studentHasApprovedParent(studentId: string): Promise<boolean> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) =>
      and(eq(l.studentId, studentId), eq(l.status, 'approved')),
    columns: { id: true },
  });
  return !!link;
}

/**
 * Return the subject IDs for which a student already has a non-dropped,
 * non-rejected registration in the given session.
 * Used to prevent duplicate registrations.
 */
export async function getExistingRegistrationSubjectIds(
  studentId: string,
  sessionId: string
): Promise<string[]> {
  const existing = await db.query.registration.findMany({
    where: (r, { eq, and, notInArray }) =>
      and(
        eq(r.studentId, studentId),
        eq(r.sessionId, sessionId),
        notInArray(r.status, ['dropped', 'rejected', 'expired'])
      ),
    columns: { subjectId: true },
  });
  return existing.map((r) => r.subjectId);
}

// ─── Public Service Functions ────────────────────────────────────────────────

// The grade-10 core rule (A-05) is a rule on the lines now: gate.grade10Core in
// assertLineRules (line-rules.services.ts) reads the session's core offers.

/**
 * The subjects a student can still reserve in a session, for the pages that still name
 * subjects (the family's Register page and the desk) until step B's Reserve pages replace them:
 * each open offer with a whole item whose series is reservable now, priced with priceLine.
 * Subjects with a live line are left out; the page pre-selects and locks a grade-10 student's
 * core offers (isCore).
 */
export type AvailableSubjectRow = {
  id: string;
  name: string;
  code: string;
  council: string;
  qualificationLevel: string;
  courseFee: number;
  registrationFee: number;
  priceInSchool: number;
  isOfferedAtSchool: boolean;
  customPrice: number | null;
  isActive: boolean;
  isCore: boolean;
  createdAt: Date;
  updatedAt: Date;
  teachers: { id: string; name: string }[];
  isRetake: boolean;
  pricing: { courseFee: number; registrationFee: number; total: number; isOutsideSchool: boolean };
  outsidePricing: { courseFee: number; registrationFee: number; total: number; isOutsideSchool: boolean } | null;
  /** F0b: the board series the subject would be entered in (null: the window feeds none). */
  boardSeries: { id: string; name: string; entryDeadline: Date | null } | null;
};

// Explicit return type: the drizzle relational inference chained through
// Hono RPC + JSONParsed exceeds TS instantiation depth in the web compile
// and silently degrades the client type — a concrete type short-circuits it.
export async function getAvailableSubjects(
  studentId: string,
  sessionId: string
): Promise<AvailableSubjectRow[]> {
  // F0a: nothing is available in a series the student may not register for
  if (!(await mayRegisterFor(studentId, sessionId)).allowed) return [];

  const alreadyRegistered = new Set(await getExistingRegistrationSubjectIds(studentId, sessionId));
  const offers = await db.select({ offer: sessionOffer, subject }).from(sessionOffer)
    .innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .where(and(eq(sessionOffer.sessionId, sessionId), eq(subject.isActive, true)))
    .orderBy(subject.name);
  const now = new Date();
  const out: AvailableSubjectRow[] = [];
  for (const { offer, subject: sub } of offers) {
    if (alreadyRegistered.has(sub.id) || offer.availability === 'closed') continue;
    let resolved;
    try {
      resolved = await resolveItem(db, sessionId, sub.id);
    } catch {
      continue; // offered by unit or route only: B's Reserve page
    }
    const c = availabilityConstraints(offer.availability, resolved.item.availability);
    if (c.closed || !resolved.item.boardSeriesId) continue;
    const [line] = await legacyLinesFor(db, studentId, sessionId, [sub.id], undefined);
    const isRetake = line!.attempt === 'retake';
    if (c.retakeOnly && !isRetake) continue;
    const d = await effectiveDeadlineFor(db, { boardSeriesId: resolved.item.boardSeriesId, attempt: line!.attempt, priorSittingSeriesId: line!.priorSittingSeriesId ?? null });
    if (!d.at || d.at <= now) continue;
    let pricing;
    let outside = null;
    try {
      const p = await priceLine(db, { item: { id: resolved.item.id }, attempt: line!.attempt, mode: c.selfStudyOnly ? 'self_study' : 'in_school', studentId, sessionId });
      pricing = { courseFee: p.courseFee, registrationFee: p.registrationFee, total: p.total, isOutsideSchool: c.selfStudyOnly };
      if (c.selfStudyOnly || isRetake) {
        const o = await priceLine(db, { item: { id: resolved.item.id }, attempt: line!.attempt, mode: 'self_study', studentId, sessionId });
        outside = { courseFee: o.courseFee, registrationFee: o.registrationFee, total: o.total, isOutsideSchool: true };
      }
    } catch {
      continue; // no board fee yet: not reservable until one is set
    }
    const own = await db.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(sessionOfferItemTeacher)
      .innerJoin(teacher, eq(teacher.id, sessionOfferItemTeacher.teacherId)).where(eq(sessionOfferItemTeacher.itemId, resolved.item.id));
    const pool = own.length ? own : await db.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(sessionOfferTeacher)
      .innerJoin(teacher, eq(teacher.id, sessionOfferTeacher.teacherId)).where(eq(sessionOfferTeacher.offerId, offer.id)).orderBy(sessionOfferTeacher.sortOrder);
    const teachers = pool.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name }));
    const [series] = await db.execute(sql`
      select bs.id, b.name || ' ' || initcap(bs.month) || ' ' || bs.year || case when bs.label <> '' then ' (' || bs.label || ')' else '' end as name, bs.entry_deadline as "entryDeadline"
      from board_series bs join exam_board b on b.code = bs.board_code where bs.id = ${resolved.item.boardSeriesId}`).then((r) => r.rows as { id: string; name: string; entryDeadline: string | Date | null }[]);
    out.push({
      ...sub,
      courseFee: offer.courseFee,
      registrationFee: pricing.registrationFee,
      isOfferedAtSchool: !c.selfStudyOnly,
      isCore: offer.grade10Core,
      teachers,
      isRetake,
      pricing,
      outsidePricing: outside,
      boardSeries: series ? { id: series.id, name: series.name, entryDeadline: series.entryDeadline ? new Date(series.entryDeadline) : null } : null,
    });
  }
  return out;
}

/**
 * Student submits a registration request for a set of subjects.
 *
 * - Session must be active.
 * - All subjects must be active.
 * - No duplicate registrations in the same session.
 * - Grade 10 June sessions must include all core subjects.
 * - Created with status 'pending_approval'; parent must approve before payment.
 */
export async function createRegistrationRequest(
  studentId: string,
  data: RequestRegistrationType,
  requestedBy: string
) {
  // F0a: the series decides who may register (grade 10 June only, A-12,
  // a student who left) — call site 1 of mayRegisterFor.
  const eligibility = await assertMayRegisterFor(studentId, data.sessionId);

  // AUTH-003/REG-001: A student request requires a parent to approve it.
  // Without an approved link, the request would sit in 'pending_approval'
  // until the session auto-expires it — a silent hang for orphaned students.
  // REG-007 covers exceptional cases via admin override.
  if (!(await studentHasApprovedParent(studentId))) {
    throw new Error(
      'You need an approved parent link before submitting a registration request. Ask a parent to link to your account (or contact the admin if you have no guardian).'
    );
  }

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  // Hook 2 (§6.3): a deadline-extension exception treats a closed window
  // as open for this student — never past a line's own deadline (MO-10)
  await assertWindowOpen(studentId, sess.id, null);
  await assertSubjectsNew(studentId, data.sessionId, data.subjectIds);
  const lines = await prepareLegacyLines(studentId, data.sessionId, data.subjectIds, data.subjectOptions, eligibility);

  // Asked again with the student and window held, so a withdrawal or a
  // correction racing this request either lands first or expires it (F0a);
  // each line is checked, priced and entered in its item's series (insertLines).
  const inserted = await db.transaction(async (tx) => {
    await assertMayRegisterForInTx(tx, studentId, data.sessionId);
    return insertLines(tx, { studentId, sessionId: data.sessionId, lines, status: 'pending_approval', requestedBy, eligibility });
  });

  // NOT-003: Notify all linked parents of the new request (fire-and-forget)
  {
    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, studentId),
      columns: { name: true },
    });
    const names = await subjectNames(inserted.map((r) => r.subjectId));
    notifyRegistrationRequestReceived({
      studentId,
      studentName: studentUser?.name ?? 'Student',
      sessionName: sess.name,
      subjects: inserted.map((r) => ({ name: names.get(r.subjectId) ?? 'Subject', price: r.priceAtRegistration })),
      totalCost: inserted.reduce((sum, r) => sum + r.priceAtRegistration, 0),
    }).catch((err) => console.error('[notification] NOT-003 failed:', err));
  }

  return inserted;
}

/** Subjects must be active, and none already live for the student in the session. */
async function assertSubjectsNew(studentId: string, sessionId: string, subjectIds: string[]) {
  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, inArray }) => and(eq(s.isActive, true), inArray(s.id, subjectIds)),
    columns: { id: true },
  });
  if (subjects.length !== new Set(subjectIds).size) {
    throw new Error('One or more subjects are invalid or inactive');
  }
  const alreadyRegistered = await getExistingRegistrationSubjectIds(studentId, sessionId);
  if (subjectIds.some((id) => alreadyRegistered.includes(id))) {
    throw new Error('Some subjects are already registered for this session');
  }
}

async function subjectNames(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: subject.id, name: subject.name }).from(subject).where(inArray(subject.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Parent directly registers subjects for one of their linked children.
 *
 * - Parent must have an approved link to the student.
 * - Session must be active.
 * - No duplicate registrations.
 * - Core subject validation applies for Grade 10 June.
 * - Created with status 'pending_payment' (auto-approved by parent).
 */
export async function createDirectRegistration(
  parentId: string,
  data: DirectRegistrationType
) {
  const linked = await validateParentStudentLink(parentId, data.studentId);
  if (!linked) throw new Error('You are not linked to this student');

  // F0a: call site 2 of mayRegisterFor (a parent's direct registration).
  const eligibility = await assertMayRegisterFor(data.studentId, data.sessionId);

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  // Hook 2 (§6.3): a deadline-extension exception treats a closed window
  // as open for this student — never past a line's own deadline (MO-10)
  await assertWindowOpen(data.studentId, sess.id, null);
  await assertSubjectsNew(data.studentId, data.sessionId, data.subjectIds);
  const lines = await prepareLegacyLines(data.studentId, data.sessionId, data.subjectIds, data.subjectOptions, eligibility);

  const now = new Date();
  // Asked again with the student and window held (F0a; see assertMayRegisterForInTx).
  const created = await db.transaction(async (tx) => {
    await assertMayRegisterForInTx(tx, data.studentId, data.sessionId);
    return insertLines(tx, {
      studentId: data.studentId, sessionId: data.sessionId, lines, status: 'pending_payment',
      requestedBy: parentId, approvedBy: parentId, approvedAt: now, eligibility,
    });
  });

  // REG-003: Notify student via in-app + email that their parent registered
  // subjects for them. Fire-and-forget so registration creation never fails
  // because of a notification/email hiccup.
  const names = await subjectNames(created.map((r) => r.subjectId));
  notifyDirectRegistrationCreated({
    studentId: data.studentId,
    parentId,
    sessionName: sess.name,
    subjects: created.map((r) => ({ name: names.get(r.subjectId) ?? 'Subject', price: r.priceAtRegistration })),
    totalCost: created.reduce((sum, r) => sum + r.priceAtRegistration, 0),
  }).catch((err) => console.error('[notification] REG-003 direct student notify failed:', err));

  return created;
}

/**
 * Parent approves one or more pending registration requests from their child.
 *
 * Strict all-or-nothing semantics:
 * - Every input ID must resolve to an existing registration
 *   (no silent phantom-ID drops).
 * - Every registration must be in 'pending_approval' status.
 * - Parent must be linked (approved) to every involved student.
 * - The guarded UPDATE is wrapped in a transaction; if any row is no
 *   longer in 'pending_approval' (concurrent approve/reject/expire),
 *   the whole operation aborts so the UI never navigates to checkout
 *   with IDs that weren't actually transitioned.
 */
export async function approveRegistrationRequest(
  data: ApproveRegistrationsType,
  parentId: string
) {
  const regs = await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.id, data.registrationIds),
  });

  if (regs.length === 0) throw new Error('No registrations found');
  if (regs.length !== data.registrationIds.length) {
    throw new Error('One or more registration IDs are invalid');
  }

  const notPending = regs.filter((r) => r.status !== 'pending_approval');
  if (notPending.length > 0) {
    throw new Error('One or more registrations are not awaiting approval');
  }

  // F0a: call site 3 of mayRegisterFor — a request made before the student
  // left, or before a correction, is not approved into a series they may no
  // longer sit.
  for (const key of new Set(regs.map((r) => `${r.studentId}|${r.sessionId}`))) {
    const [studentId, sessionId] = key.split('|') as [string, string];
    await assertMayRegisterFor(studentId, sessionId);
  }

  // The window must be open for the student — the same rule the request
  // passed (a deadline extension counts). Checked against the session's
  // status alone, a request made under an extension after the close could
  // never be approved (state audit ST-07, MO-20).
  for (const r of regs) await assertWindowOpen(r.studentId, r.sessionId, r);

  const studentIds = [...new Set(regs.map((r) => r.studentId))];
  for (const studentId of studentIds) {
    const linked = await validateParentStudentLink(parentId, studentId);
    if (!linked) {
      throw new Error(
        'You are not authorized to approve registrations for one or more students'
      );
    }
  }

  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(registration)
      .set({
        status: 'pending_payment',
        approvedBy: parentId,
        approvedAt: now,
        approvalComments: data.comments ?? null,
        updatedAt: now,
      })
      .where(
        and(
          inArray(registration.id, data.registrationIds),
          eq(registration.status, 'pending_approval'),
        )
      )
      .returning();

    if (rows.length !== data.registrationIds.length) {
      throw new Error(
        'One or more registrations were concurrently processed. Please refresh and try again.'
      );
    }
    return rows;
  });

  // NOT-004: Notify each affected student that their request was approved (fire-and-forget)
  {
    const sessionId = regs[0]?.sessionId;
    const sessionRecord = sessionId
      ? await db.query.registrationSession.findFirst({
          where: (s, { eq: eqOp }) => eqOp(s.id, sessionId),
          columns: { name: true },
        })
      : null;
    const sessionName = sessionRecord?.name ?? 'the registration session';

    for (const sId of studentIds) {
      notifyRegistrationDecision({
        studentId: sId,
        parentId,
        sessionName,
        approved: true,
        comments: data.comments,
      }).catch((err) => console.error('[notification] NOT-004 (approve) failed:', err));
    }
  }

  return updated;
}

/**
 * Parent reverts unpaid approvals back to pending approval.
 *
 * This is only allowed before checkout creates a payment link. Once a
 * registration is attached to any payment row, payment/escrow state may exist
 * elsewhere and the approval cannot be safely moved backward.
 */
export async function revertApprovedRegistrationRequest(
  data: RevertApprovedRegistrationsType,
  parentId: string
) {
  const regs = await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.id, data.registrationIds),
  });

  if (regs.length === 0) throw new Error('No registrations found');
  if (regs.length !== data.registrationIds.length) {
    throw new Error('One or more registration IDs are invalid');
  }

  const notPendingPayment = regs.filter((r) => r.status !== 'pending_payment');
  if (notPendingPayment.length > 0) {
    throw new Error('Only unpaid pending-payment registrations can be reverted');
  }

  const notOriginalStudentRequests = regs.filter((r) =>
    r.requestedBy !== r.studentId ||
    r.approvalComments?.startsWith('Swap from registration') ||
    r.approvalComments?.startsWith('Direct swap') ||
    r.approvalComments?.startsWith('[ADMIN OVERRIDE]')
  );
  if (notOriginalStudentRequests.length > 0) {
    throw new Error('Only normal student registration approvals can be reverted');
  }

  const linkedPayments = await db.query.paymentRegistration.findMany({
    where: (pr, { inArray }) => inArray(pr.registrationId, data.registrationIds),
    columns: { registrationId: true },
  });
  if (linkedPayments.length > 0) {
    throw new Error('One or more registrations already have a payment in progress and cannot be reverted');
  }

  const studentIds = [...new Set(regs.map((r) => r.studentId))];
  for (const studentId of studentIds) {
    const linked = await validateParentStudentLink(parentId, studentId);
    if (!linked) {
      throw new Error(
        'You are not authorized to revert approvals for one or more students'
      );
    }
  }

  const updated = await db.transaction(async (tx) => {
    // Lock the registrations before asking whether a checkout covers them —
    // the checkout takes the same locks (initiatePayment). Asked without them,
    // a checkout committing in between left an open payment on a request
    // sent back to "awaiting approval" (state audit ST-03).
    await tx.select({ id: registration.id }).from(registration).where(inArray(registration.id, data.registrationIds)).orderBy(registration.id).for('update');
    const paymentLinksInTx = await tx.query.paymentRegistration.findMany({
      where: (pr, { inArray }) => inArray(pr.registrationId, data.registrationIds),
      columns: { registrationId: true },
    });
    if (paymentLinksInTx.length > 0) {
      throw new Error('One or more registrations already have a payment in progress and cannot be reverted');
    }

    const rows = await tx
      .update(registration)
      .set({
        status: 'pending_approval',
        approvedBy: null,
        approvedAt: null,
        approvalComments: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(registration.id, data.registrationIds),
          eq(registration.status, 'pending_payment'),
        )
      )
      .returning();

    if (rows.length !== data.registrationIds.length) {
      throw new Error(
        'One or more registrations were concurrently processed. Please refresh and try again.'
      );
    }

    return rows;
  });

  return updated;
}

/**
 * Parent rejects one or more pending registration requests.
 *
 * - All registrations must be in 'pending_approval' status.
 * - Parent must be linked to the student.
 * - A comment is required (enforced by the schema) to explain the rejection.
 * - Registrations move to 'rejected' (terminal state).
 */
export async function rejectRegistrationRequest(
  data: RejectRegistrationsType,
  parentId: string
) {
  const regs = await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.id, data.registrationIds),
  });

  if (regs.length === 0) throw new Error('No registrations found');
  if (regs.length !== data.registrationIds.length) {
    throw new Error('One or more registration IDs are invalid');
  }

  const notPending = regs.filter((r) => r.status !== 'pending_approval');
  if (notPending.length > 0) {
    throw new Error('One or more registrations are not awaiting approval');
  }

  // A rejection ends a request whatever the window: nothing is entered or
  // paid. It used to need an active session, so a request made under a
  // deadline extension after the close could not be turned down either
  // (state audit ST-07).

  const studentIds = [...new Set(regs.map((r) => r.studentId))];
  for (const studentId of studentIds) {
    const linked = await validateParentStudentLink(parentId, studentId);
    if (!linked) {
      throw new Error(
        'You are not authorized to reject registrations for one or more students'
      );
    }
  }

  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(registration)
      .set({
        status: 'rejected',
        approvedBy: parentId,
        approvedAt: now,
        approvalComments: data.comments,
        updatedAt: now,
      })
      .where(
        and(
          inArray(registration.id, data.registrationIds),
          eq(registration.status, 'pending_approval'),
        )
      )
      .returning();

    if (rows.length !== data.registrationIds.length) {
      throw new Error(
        'One or more registrations were concurrently processed. Please refresh and try again.'
      );
    }
    return rows;
  });

  // NOT-004: Notify each affected student that their request was rejected (fire-and-forget)
  {
    const sessionId = regs[0]?.sessionId;
    const sessionRecord = sessionId
      ? await db.query.registrationSession.findFirst({
          where: (s, { eq: eqOp }) => eqOp(s.id, sessionId),
          columns: { name: true },
        })
      : null;
    const sessionName = sessionRecord?.name ?? 'the registration session';

    for (const sId of studentIds) {
      notifyRegistrationDecision({
        studentId: sId,
        parentId,
        sessionName,
        approved: false,
        comments: data.comments,
      }).catch((err) => console.error('[notification] NOT-004 (reject) failed:', err));
    }
  }

  return updated;
}

/**
 * Admin overrides the parent approval requirement (REG-007).
 *
 * Used for exceptional cases: orphaned students, legal guardianship, etc.
 * Registrations are created directly in 'pending_payment' status.
 * The admin's reason is stored in approvalComments with an [ADMIN OVERRIDE] prefix,
 * providing a clear audit trail without requiring a separate audit table.
 */
export async function adminOverrideApproval(
  data: AdminOverrideApprovalType,
  adminId: string
) {
  const student = await db.query.user.findFirst({
    where: (u, { eq: eqOp }) => eqOp(u.id, data.studentId),
    columns: { id: true, role: true },
  });
  if (!student) throw new Error('Student not found');
  // F0a: call site 4 of mayRegisterFor. The override bypasses the parent's
  // approval, never the series' eligibility (a coordinator's grade-10
  // exception is the sanctioned way past the grade-10 rule).
  const eligibility = await assertMayRegisterFor(data.studentId, data.sessionId);

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  // Hook 2 (§6.3): a deadline-extension exception treats a closed window
  // as open for this student — never past a line's own deadline (MO-10)
  await assertWindowOpen(data.studentId, sess.id, null);
  await assertSubjectsNew(data.studentId, data.sessionId, data.subjectIds);
  // CORE-003: the override bypasses parent approval (REG-007), not the grade-10 core rule:
  // assertLineRules counts the student's live lines with these (gate.grade10Core). The
  // school-fee gate applies too (a fee waiver is the sanctioned way past it).
  const lines = await prepareLegacyLines(data.studentId, data.sessionId, data.subjectIds, undefined, eligibility);

  const now = new Date();
  // Asked again with the student and window held (F0a; see assertMayRegisterForInTx).
  return db.transaction(async (tx) => {
    await assertMayRegisterForInTx(tx, data.studentId, data.sessionId);
    return insertLines(tx, {
      studentId: data.studentId, sessionId: data.sessionId, lines, status: 'pending_payment',
      requestedBy: adminId, approvedBy: adminId, approvedAt: now, approvalComments: `[ADMIN OVERRIDE] ${data.reason}`, eligibility,
    });
  });
}

/**
 * Get a single registration by ID, including subject and session details.
 */
export async function getRegistrationById(id: string) {
  return db.query.registration.findFirst({
    where: (r, { eq }) => eq(r.id, id),
    with: { subject: true, session: true },
  });
}

/**
 * Get registrations with optional filters.
 *
 * Includes subject and session details for each registration.
 * The caller (route handler) is responsible for scoping by studentId
 * based on the authenticated user's role.
 */
export async function getRegistrations(filters: ListRegistrationsQueryType & {
  studentIds?: string[]; // Used when a parent queries for multiple children
}) {
  const rows = await db.query.registration.findMany({
    where: (r, { eq, and, inArray }) => {
      const conditions = [];
      if (filters.studentId) {
        conditions.push(eq(r.studentId, filters.studentId));
      } else if (filters.studentIds && filters.studentIds.length > 0) {
        conditions.push(inArray(r.studentId, filters.studentIds));
      }
      if (filters.sessionId) conditions.push(eq(r.sessionId, filters.sessionId));
      if (filters.status)    conditions.push(eq(r.status, filters.status));
      return conditions.length > 0 ? and(...conditions) : undefined;
    },
    with: {
      subject: true,
      session: true,
      student: {
        columns: { id: true, name: true, email: true, cohortYear: true, studentId: true }, extras: gradeTodayExtras,
      },
    },
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });

  // M-18: Attach a `hasPendingChangeRequest` flag so the registrations UI
  // can correctly disable the Drop/Swap actions when an earlier request
  // is still waiting on parent approval. The DB-level partial unique
  // index already prevents a second pending change request from being
  // inserted, but the UI previously let users click through and hit an
  // error — this flag lets us grey out the buttons instead.
  if (rows.length === 0) {
    return rows.map((r) => ({ ...r, hasPendingChangeRequest: false, receipt: null as ReceiptBrief }));
  }

  const regIds = rows.map((r) => r.id);
  const pendingCRs = await db.query.changeRequest.findMany({
    where: (cr, { inArray: inArr, and: andOp, eq: eqOp }) =>
      andOp(inArr(cr.registrationId, regIds), eqOp(cr.status, 'pending_approval')),
    columns: { registrationId: true },
  });
  const pendingSet = new Set(pendingCRs.map((c) => c.registrationId));

  // The family's refund is gated on physically returning the paper
  // receipt, so they need to see its number and state — previously the
  // UI could only show an unexplained "return receipt" status.
  const receipts = await db.query.receipt.findMany({
    where: (rc, { inArray: inArr }) => inArr(rc.registrationId, regIds),
    columns: {
      id: true, registrationId: true, receiptNumber: true,
      status: true, refundAmountOnReturn: true,
    },
  });
  const receiptByReg = new Map(receipts.map((rc) => [rc.registrationId, rc]));

  return rows.map((r) => ({
    ...r,
    hasPendingChangeRequest: pendingSet.has(r.id),
    receipt: (receiptByReg.get(r.id) ?? null) as ReceiptBrief,
  }));
}

type ReceiptBrief = {
  id: string;
  registrationId: string;
  receiptNumber: string;
  status: string;
  refundAmountOnReturn: number | null;
} | null;

/**
 * Get all pending approval requests from all students linked to a parent.
 *
 * Returns registrations in 'pending_approval' status across all linked
 * children, ordered oldest-first so parents see the most urgent items first.
 */
export async function getPendingApprovalRequests(parentId: string) {
  const linkedStudentIds = await getLinkedStudentIds(parentId);
  if (linkedStudentIds.length === 0) return [];

  return db.query.registration.findMany({
    where: (r, { eq, and, inArray }) =>
      and(
        inArray(r.studentId, linkedStudentIds),
        eq(r.status, 'pending_approval')
      ),
    with: {
      subject: true,
      session: true,
      student: {
        columns: { id: true, name: true, email: true, cohortYear: true, studentId: true }, extras: gradeTodayExtras,
      },
    },
    orderBy: (r, { asc }) => [asc(r.createdAt)],
  });
}

/**
 * Get the full registration history for a student across all sessions.
 *
 * Returns a rich audit trail including:
 * - Full subject and session details
 * - Who requested and who approved/rejected (with name)
 * - All change requests (drop/swap) that were made against each registration
 * - Payment registrations to surface payment status context
 *
 * Used for the /registrations/history view.
 */
export async function getRegistrationHistory(studentId: string) {
  return db.query.registration.findMany({
    where: (r, { eq }) => eq(r.studentId, studentId),
    with: {
      subject: {
        columns: {
          id: true,
          name: true,
          code: true,
          council: true,
          isCore: true,
        },
      },
      session: {
        columns: {
          id: true,
          name: true,
          sessionType: true,
          status: true,
          startDate: true,
          endDate: true,
        },
      },
      requestedByUser: {
        columns: { id: true, name: true, role: true },
      },
      approvedByUser: {
        columns: { id: true, name: true, role: true },
      },
      changeRequests: {
        with: {
          newSubject: {
            columns: { id: true, name: true, code: true },
          },
          requestedByUser: {
            columns: { id: true, name: true },
          },
          approvedByUser: {
            columns: { id: true, name: true },
          },
        },
        orderBy: (cr, { asc }) => [asc(cr.createdAt)],
      },
    },
    orderBy: (r, { desc, asc }) => [
      desc(r.createdAt),
    ],
  });
}
