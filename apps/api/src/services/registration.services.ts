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
  paymentRegistration,
  subject,
  registrationSession,
  parentStudentLink,
  user,
  subjectTeacher,
  registrationHistory,
  eq,
  ne,
  and,
  inArray,
  notInArray,
  isNotNull,
  gradeTodayExtras,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type {
  RequestRegistrationType,
  DirectRegistrationType,
  ApproveRegistrationsType,
  RevertApprovedRegistrationsType,
  RejectRegistrationsType,
  AdminOverrideApprovalType,
  ListRegistrationsQueryType,
} from '@repo/validations';
import { seriesOrder } from '@repo/validations';
import {
  notifyRegistrationRequestReceived,
  notifyRegistrationDecision,
  notifyDirectRegistrationCreated,
} from './notification.services';
import { assertMayRegisterFor, assertMayRegisterForInTx, mayRegisterFor, type Eligibility } from './eligibility.services';
import { computeRegistrationPricing } from './pricing.services';
import { schoolFeeGateReason } from './school-fee.services';
import { applyPricingExceptions } from './exception.services';
import { sessionWindow, entryDeadlineMessage } from './window.services';
import { routeAndCheck, routeSubjects } from './series.services';
import type { SubjectRegistrationOptionsType } from '@repo/validations';

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Refuse unless the series is open for this student (window.services.ts):
 * for a registration, its own board series' deadline decides (F0b).
 */
async function assertWindowOpen(studentId: string, sessionId: string, boardSeriesId: string | null) {
  const w = await sessionWindow(studentId, sessionId, boardSeriesId);
  if (w.open) return;
  throw new Error(w.entryDeadlinePassed ? entryDeadlineMessage(w.entryDeadline!) : 'Registration window is not open');
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Insert new registrations, each entered in the board series its window
 * routes its subject to (F0b), refusing a subject the window enters in no
 * series or in one past its entry deadline (MO-10, per series). Runs in the
 * caller's transaction after assertMayRegisterForInTx, so the window row is
 * held and its routing cannot change under the insert. Every path that
 * creates a registration comes here.
 */
export async function insertRoutedRegistrations(
  tx: Tx,
  sessionId: string,
  subjects: { id: string; name: string; council: string }[],
  records: Omit<typeof registration.$inferInsert, 'boardSeriesId'>[],
) {
  const routes = await routeAndCheck(tx, sessionId, subjects, true);
  return tx
    .insert(registration)
    .values(records.map((r) => ({ ...r, boardSeriesId: routes.get(r.subjectId) ?? null })))
    .returning();
}

/**
 * Subject IDs the student has previously sat (confirmed) or dropped in
 * OTHER sessions — registering one of these again is a retake (V3 §6.9).
 * F7: a registration the school recorded before the system (the day-one
 * import's history, registered or dropped) counts the same way when its
 * series is earlier than this window's — the student sat the subject before,
 * whether or not the system saw it. History of the window's own series is
 * the same sitting, and a later series has not happened yet.
 */
async function getRetakeSubjectIds(
  studentId: string,
  excludeSessionId: string,
  executor: typeof db | Tx = db,
): Promise<Set<string>> {
  const [prior, history, [win]] = await Promise.all([
    executor.select({ subjectId: registration.subjectId }).from(registration).where(and(
      eq(registration.studentId, studentId),
      ne(registration.sessionId, excludeSessionId),
      inArray(registration.status, ['confirmed', 'dropped']),
    )),
    executor.select({ subjectId: registrationHistory.subjectId, sessionType: registrationHistory.sessionType, seriesYear: registrationHistory.seriesYear })
      .from(registrationHistory).where(and(
        eq(registrationHistory.studentId, studentId),
        inArray(registrationHistory.outcome, ['registered', 'dropped']),
        isNotNull(registrationHistory.subjectId),
      )),
    executor.select({ sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear })
      .from(registrationSession).where(eq(registrationSession.id, excludeSessionId)),
  ]);
  const windowOrder = win ? seriesOrder(win.sessionType, win.seriesYear) : -Infinity;
  const satBefore = history.filter((h) => seriesOrder(h.sessionType, h.seriesYear) < windowOrder);
  return new Set([...prior.map((r) => r.subjectId), ...satBefore.map((h) => h.subjectId!)]);
}

/**
 * Shared V3 pre-insert pipeline for both request and direct registration:
 * level match, teacher validation, retake detection, pricing engine, and
 * the school-fee gate. Returns per-subject computed values keyed by
 * subject ID.
 *
 * `eligibility` is the path's own mayRegisterFor answer (F0a): the fee gate
 * reads the series' academic year and the student's grade in it from it.
 */
export async function prepareRegistrationInputs(
  studentId: string,
  sess: { id: string; qualificationLevel: string },
  subjects: {
    id: string;
    qualificationLevel: string;
    courseFee: number;
    registrationFee: number;
    isOfferedAtSchool: boolean;
    name: string;
  }[],
  subjectOptions: Record<string, SubjectRegistrationOptionsType> | undefined,
  eligibility: Eligibility,
  // F7: the import reads inside its family's transaction (the teacher links
  // and the history it has just written); every other caller reads committed data.
  executor: typeof db | Tx = db,
) {
  // Level match: an IGCSE session only takes IGCSE subjects, etc.
  const wrongLevel = subjects.filter((s) => s.qualificationLevel !== sess.qualificationLevel);
  if (wrongLevel.length > 0) {
    throw new Error(
      `These subjects don't match the session's qualification level: ${wrongLevel.map((s) => s.name).join(', ')}`
    );
  }

  // School-fee gate (D-H): unpaid school fee blocks registration — the fee
  // of the series' academic year at the student's grade in it (F0a).
  const gate = await schoolFeeGateReason(studentId, eligibility);
  if (gate) throw new Error(gate);

  // Teacher validation: chosen teacher must be linked to that subject
  const requestedTeacherIds = Object.values(subjectOptions ?? {})
    .map((o) => o.teacherId)
    .filter((t): t is string => !!t);
  const teacherLinks = requestedTeacherIds.length
    ? await executor.select({ subjectId: subjectTeacher.subjectId, teacherId: subjectTeacher.teacherId })
        .from(subjectTeacher).where(inArray(subjectTeacher.teacherId, requestedTeacherIds))
    : [];

  const retakeSet = await getRetakeSubjectIds(studentId, sess.id, executor);

  const result = new Map<
    string,
    {
      pricing: ReturnType<typeof computeRegistrationPricing>;
      isRetake: boolean;
      teacherId: string | null;
    }
  >();

  for (const sub of subjects) {
    const opts = subjectOptions?.[sub.id] ?? {};
    const isRetake = retakeSet.has(sub.id);

    // Hook 1 (§6.3): per-student pricing exceptions apply after the 50% rule
    const pricing = await applyPricingExceptions(
      studentId,
      sess.id,
      sub.id,
      computeRegistrationPricing(sub, {
        isRetake,
        takeOutsideSchool: opts.takeOutsideSchool ?? false,
      })
    );

    let teacherId: string | null = null;
    if (opts.teacherId && !pricing.isOutsideSchool) {
      const linked = teacherLinks.some(
        (l) => l.subjectId === sub.id && l.teacherId === opts.teacherId
      );
      if (!linked) {
        throw new Error(`The chosen teacher is not linked to ${sub.name}`);
      }
      teacherId = opts.teacherId;
    }

    result.set(sub.id, { pricing, isRetake, teacherId });
  }

  return result;
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
async function getExistingRegistrationSubjectIds(
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

/**
 * Validate that a Grade 10 student's registration request includes all
 * mandatory core subjects for a June session.
 *
 * The grade is the student's grade in the series' academic year (F0a,
 * A-05), not today's: a student starting grade 10 in September is grade 10
 * for the June after it, whatever the date the window opens.
 *
 * Returns { valid: true } for non-Grade-10 students or non-June sessions.
 * Returns { valid: false, missingCoreSubjects } when core subjects are missing.
 */
export async function validateCoreSubjectRequirements(
  studentId: string,
  sessionId: string,
  subjectIds: string[]
): Promise<{
  valid: boolean;
  missingCoreSubjects: { id: string; name: string; code: string }[];
}> {
  // Fails closed: mayRegisterFor throws when the student or session is
  // missing, so the CORE-003 rule is never skipped silently.
  const eligibility = await mayRegisterFor(studentId, sessionId);

  // Core requirement only applies to Grade 10 in the June session
  if (eligibility.grade !== 10 || eligibility.series.sessionType !== 'june') {
    return { valid: true, missingCoreSubjects: [] };
  }

  const coreSubjects = await db.query.subject.findMany({
    where: (s, { eq, and }) => and(eq(s.isCore, true), eq(s.isActive, true)),
    columns: { id: true, name: true, code: true },
  });

  const missingCoreSubjects = coreSubjects.filter(
    (core) => !subjectIds.includes(core.id)
  );

  return {
    valid: missingCoreSubjects.length === 0,
    missingCoreSubjects,
  };
}

/**
 * Return all active subjects that a student has not yet registered for
 * in the given session. Used to populate the registration form.
 *
 * Subjects the student already has a non-terminal registration for
 * (pending_approval, pending_payment, confirmed) are excluded so the
 * list never contains duplicates of what the student has already acted
 * on. This includes core subjects — the frontend is responsible for
 * pre-selecting + locking any missing core subjects for Grade 10 June
 * (see register.client.tsx).
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

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, sessionId),
    columns: { id: true, qualificationLevel: true },
  });
  if (!sess) return [];

  const alreadyRegistered = await getExistingRegistrationSubjectIds(
    studentId,
    sessionId
  );

  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, notInArray }) => {
      const conditions = [
        eq(s.isActive, true),
        eq(s.qualificationLevel, sess.qualificationLevel),
      ];
      if (alreadyRegistered.length > 0) {
        conditions.push(notInArray(s.id, alreadyRegistered));
      }
      return and(...conditions);
    },
    with: {
      subjectTeachers: {
        with: { teacher: { columns: { id: true, name: true, isActive: true } } },
      },
    },
    orderBy: (s, { asc }) => [asc(s.name)],
  });

  // V3 enrichment: teachers to pick from, retake flag, and both price
  // variants so the UI can show exactly what each choice costs.
  const retakeSet = await getRetakeSubjectIds(studentId, sessionId);

  // F0b: the series each subject would be entered in. A subject the window
  // enters in no series, or in one past its entry deadline, is not offered.
  const routing = await routeSubjects(db, sessionId, subjects);
  const now = new Date();
  const offered = subjects.filter((s) => {
    if (!routing.feedsSeries) return true;
    const r = routing.routes.get(s.id);
    return !!r && !(r.entryDeadline && r.entryDeadline <= now);
  });

  return offered.map(({ subjectTeachers, ...sub }) => {
    const route = routing.routes.get(sub.id) ?? null;
    const isRetake = retakeSet.has(sub.id);
    const inSchoolPricing = computeRegistrationPricing(sub, {
      isRetake,
      takeOutsideSchool: false,
    });
    const outsidePricing =
      !sub.isOfferedAtSchool || isRetake
        ? computeRegistrationPricing(sub, { isRetake, takeOutsideSchool: true })
        : null;

    return {
      ...sub,
      teachers: subjectTeachers
        .map((st) => st.teacher)
        .filter((t) => t.isActive)
        .map((t) => ({ id: t.id, name: t.name })),
      isRetake,
      pricing: inSchoolPricing,
      outsidePricing,
      boardSeries: route ? { id: route.boardSeriesId, name: route.name, entryDeadline: route.entryDeadline } : null,
    };
  });
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
  // as open for this student — never past the board's entry deadline (MO-10)
  await assertWindowOpen(studentId, sess.id, null);

  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, inArray }) =>
      and(eq(s.isActive, true), inArray(s.id, data.subjectIds)),
  });
  if (subjects.length !== data.subjectIds.length) {
    throw new Error('One or more subjects are invalid or inactive');
  }

  const alreadyRegistered = await getExistingRegistrationSubjectIds(
    studentId,
    data.sessionId
  );
  const duplicates = data.subjectIds.filter((id) => alreadyRegistered.includes(id));
  if (duplicates.length > 0) {
    throw new Error('Some subjects are already registered for this session');
  }
  // F0b: each subject's board series is open (asked again in the transaction).
  await routeAndCheck(db, data.sessionId, subjects);

  const coreCheck = await validateCoreSubjectRequirements(
    studentId,
    data.sessionId,
    data.subjectIds
  );
  if (!coreCheck.valid) {
    const names = coreCheck.missingCoreSubjects.map((s) => s.name).join(', ');
    throw new Error(
      `Grade 10 June session requires all core subjects. Missing: ${names}`
    );
  }

  const prepared = await prepareRegistrationInputs(
    studentId,
    sess,
    subjects,
    data.subjectOptions,
    eligibility
  );

  const records = subjects.map((sub) => {
    const p = prepared.get(sub.id)!;
    return {
      id: randomUUID(),
      studentId,
      sessionId: data.sessionId,
      subjectId: sub.id,
      priceAtRegistration: p.pricing.total,
      courseFeeAtRegistration: p.pricing.courseFee,
      registrationFeeAtRegistration: p.pricing.registrationFee,
      isRetake: p.isRetake,
      takenOutsideSchool: p.pricing.isOutsideSchool,
      teacherId: p.teacherId,
      wasCoreAtRegistration: sub.isCore,
      status: 'pending_approval' as const,
      requestedBy,
    };
  });

  // Asked again with the student and window held, so a withdrawal or a
  // correction racing this request either lands first or expires it (F0a).
  const inserted = await db.transaction(async (tx) => {
    await assertMayRegisterForInTx(tx, studentId, data.sessionId);
    return insertRoutedRegistrations(tx, data.sessionId, subjects, records);
  });

  // NOT-003: Notify all linked parents of the new request (fire-and-forget)
  {
    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, studentId),
      columns: { name: true },
    });
    const totalCost = records.reduce((sum, r) => sum + r.priceAtRegistration, 0);

    notifyRegistrationRequestReceived({
      studentId,
      studentName: studentUser?.name ?? 'Student',
      sessionName: sess.name,
      subjects: subjects.map((sub) => ({
        name: sub.name,
        price: prepared.get(sub.id)!.pricing.total,
      })),
      totalCost,
    }).catch((err) => console.error('[notification] NOT-003 failed:', err));
  }

  return inserted;
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
  // as open for this student — never past the board's entry deadline (MO-10)
  await assertWindowOpen(data.studentId, sess.id, null);

  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, inArray }) =>
      and(eq(s.isActive, true), inArray(s.id, data.subjectIds)),
  });
  if (subjects.length !== data.subjectIds.length) {
    throw new Error('One or more subjects are invalid or inactive');
  }

  const alreadyRegistered = await getExistingRegistrationSubjectIds(
    data.studentId,
    data.sessionId
  );
  const duplicates = data.subjectIds.filter((id) => alreadyRegistered.includes(id));
  if (duplicates.length > 0) {
    throw new Error('Some subjects are already registered for this session');
  }
  // F0b: each subject's board series is open (asked again in the transaction).
  await routeAndCheck(db, data.sessionId, subjects);

  const coreCheck = await validateCoreSubjectRequirements(
    data.studentId,
    data.sessionId,
    data.subjectIds
  );
  if (!coreCheck.valid) {
    const names = coreCheck.missingCoreSubjects.map((s) => s.name).join(', ');
    throw new Error(
      `Grade 10 June session requires all core subjects. Missing: ${names}`
    );
  }

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
      requestedBy: parentId,
      approvedBy: parentId,
      approvedAt: now,
    };
  });

  // Asked again with the student and window held (F0a; see assertMayRegisterForInTx).
  const created = await db.transaction(async (tx) => {
    await assertMayRegisterForInTx(tx, data.studentId, data.sessionId);
    return insertRoutedRegistrations(tx, data.sessionId, subjects, records);
  });

  // REG-003: Notify student via in-app + email that their parent registered
  // subjects for them. Fire-and-forget so registration creation never fails
  // because of a notification/email hiccup.
  notifyDirectRegistrationCreated({
    studentId: data.studentId,
    parentId,
    sessionName: sess.name,
    subjects: subjects.map((sub) => ({
      name: sub.name,
      price: prepared.get(sub.id)!.pricing.total,
    })),
    totalCost: records.reduce((sum, r) => sum + r.priceAtRegistration, 0),
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
  for (const r of regs) await assertWindowOpen(r.studentId, r.sessionId, r.boardSeriesId);

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
  // as open for this student — never past the board's entry deadline (MO-10)
  await assertWindowOpen(data.studentId, sess.id, null);

  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, inArray }) =>
      and(eq(s.isActive, true), inArray(s.id, data.subjectIds)),
  });
  if (subjects.length !== data.subjectIds.length) {
    throw new Error('One or more subjects are invalid or inactive');
  }

  const alreadyRegistered = await getExistingRegistrationSubjectIds(
    data.studentId,
    data.sessionId
  );
  const duplicates = data.subjectIds.filter((id) => alreadyRegistered.includes(id));
  if (duplicates.length > 0) {
    throw new Error('Some subjects are already registered for this session');
  }
  // F0b: each subject's board series is open (asked again in the transaction).
  await routeAndCheck(db, data.sessionId, subjects);

  // CORE-003: Admin override bypasses parent approval (REG-007), NOT the
  // Grade 10 June core-subject curriculum rule. Core requirements must
  // still be satisfied — the admin provides the subject list that will
  // be registered, which for Grade 10 June must include the subject IDs
  // of every active core subject not already registered for this session.
  const coreCheck = await validateCoreSubjectRequirements(
    data.studentId,
    data.sessionId,
    [...data.subjectIds, ...alreadyRegistered]
  );
  if (!coreCheck.valid) {
    const names = coreCheck.missingCoreSubjects.map((s) => s.name).join(', ');
    throw new Error(
      `Grade 10 June session requires all core subjects. Missing: ${names}`
    );
  }

  // V3: same pricing/level/teacher pipeline as normal registrations.
  // (The school-fee gate applies to admin overrides too — an admin can
  // grant a fee_waiver exception when that's the intent.)
  const prepared = await prepareRegistrationInputs(
    data.studentId,
    sess,
    subjects,
    undefined,
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
      wasCoreAtRegistration: sub.isCore,
      status: 'pending_payment' as const,
      requestedBy: adminId,
      approvedBy: adminId,
      approvedAt: now,
      approvalComments: `[ADMIN OVERRIDE] ${data.reason}`,
    };
  });

  // Asked again with the student and window held (F0a; see assertMayRegisterForInTx).
  return db.transaction(async (tx) => {
    await assertMayRegisterForInTx(tx, data.studentId, data.sessionId);
    return insertRoutedRegistrations(tx, data.sessionId, subjects, records);
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
