/**
 * What every part of campus leave (F2) shares: its refusal type, the school's
 * clock, the leave policy read in one go, who belongs to a student's family
 * (and who a custody restriction keeps out of it), matching a person against
 * a restriction, and notifications written inside a transaction.
 *
 * docs/features/CAMPUS_LEAVE.md is the feature as built.
 */

import {
  db, user, parentStudentLink, leaveCustodyRestriction, notification, eq, and, inArray, isNull, sql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  schoolDateString, gradeInAcademicYear, academicYearStartOf, hasRole, ROLES,
  type NotificationType, type Role,
} from '@repo/validations';
import { getSetting } from './settings.services';
import { cairoInstant } from './scheduling-shared.services';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;
export type Viewer = { id: string; role?: string | null; name?: string | null };

/** A refusal with the status the route answers and a sentence for the screen. */
export class LeaveError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

// ─── The school's clock ──────────────────────────────────────────────────────

/** The school's date and time of day (Africa/Cairo) at an instant. */
export function schoolNow(now: Date = new Date()): { date: string; time: string } {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return { date: schoolDateString(now), time };
}

/** "11:05" in Cairo for an instant. */
export function schoolTimeOf(instant: Date): string {
  return schoolNow(instant).time;
}

/** The instant a school time on a date is. */
export const leaveInstant = (date: string, hhmm: string) => cairoInstant(date, hhmm);

/** The next day's midnight in Cairo: when a day's pass stops working. */
export function endOfSchoolDay(date: string): Date {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return cairoInstant(d.toISOString().slice(0, 10), '00:00');
}

/** A student's grade on a date (the academic year of that date, 1 July in Cairo). */
export function gradeOn(cohortYear: number | null | undefined, date: string): number | null {
  return gradeInAcademicYear(cohortYear, academicYearStartOf(cairoInstant(date, '12:00')));
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

export const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);

// ─── The policy ──────────────────────────────────────────────────────────────

/** Every leave setting, read together. */
export async function readLeavePolicy(executor: Executor = db) {
  const [cutoff, noticeMinutes, aloneGrades, reasons, limitPerTerm, familyRules, approverRoles, autoApprove, noShowGrace, lateGrace] = await Promise.all([
    getSetting('leave.sameDayCutoff', executor),
    getSetting('leave.noticeMinutes', executor),
    getSetting('leave.aloneGrades', executor),
    getSetting('leave.reasonCategories', executor),
    getSetting('leave.limitPerTerm', executor),
    getSetting('leave.familyRules', executor),
    getSetting('leave.approverRoles', executor),
    getSetting('leave.autoApprove', executor),
    getSetting('leave.noShowGraceMinutes', executor),
    getSetting('leave.lateReturnGraceMinutes', executor),
  ]);
  return { cutoff, noticeMinutes, aloneGrades, reasons, limitPerTerm, familyRules, approverRoles, autoApprove, noShowGrace, lateGrace };
}
export type LeavePolicy = Awaited<ReturnType<typeof readLeavePolicy>>;

/** May this account approve leave and collectors? The admin always may (the setting keeps it). */
export function isApprover(role: string | null | undefined, policy: Pick<LeavePolicy, 'approverRoles'>): boolean {
  if (role === ROLES.ADMIN) return true;
  return hasRole(role, ...(policy.approverRoles as Role[]));
}

/** Everyone who approves: notified of a new request or collector. */
export async function approverIds(policy: Pick<LeavePolicy, 'approverRoles'>): Promise<string[]> {
  const roles = [...new Set<string>([...policy.approverRoles, ROLES.ADMIN])];
  const rows = await db.select({ id: user.id }).from(user)
    .where(and(inArray(user.role, roles), sql`coalesce(${user.banned}, false) = false`));
  return rows.map((r) => r.id);
}

// ─── Families ────────────────────────────────────────────────────────────────

/** The approved linked parents of a student. */
export async function parentsOf(studentId: string, executor: Executor = db) {
  return executor.select({ id: user.id, name: user.name, phone: user.phone, email: user.email })
    .from(parentStudentLink)
    .innerJoin(user, eq(user.id, parentStudentLink.parentId))
    .where(and(eq(parentStudentLink.studentId, studentId), eq(parentStudentLink.status, 'approved')));
}

/** Active custody restrictions of students (the gate's and the approver's warning). */
export async function activeRestrictions(studentIds: string[], executor: Executor = db) {
  if (studentIds.length === 0) return [];
  return executor.select().from(leaveCustodyRestriction)
    .where(and(inArray(leaveCustodyRestriction.studentId, studentIds), isNull(leaveCustodyRestriction.endedAt)));
}

/**
 * A parent kept away from a child by an active custody restriction naming
 * their account: for campus leave they are not the child's family (they do
 * not request, see or collect the child's leave).
 */
export async function isRestrictedParent(parentId: string, studentId: string, executor: Executor = db): Promise<boolean> {
  const [r] = await executor.select({ id: leaveCustodyRestriction.id }).from(leaveCustodyRestriction)
    .where(and(eq(leaveCustodyRestriction.studentId, studentId), eq(leaveCustodyRestriction.restrictedUserId, parentId), isNull(leaveCustodyRestriction.endedAt)));
  return !!r;
}

/** The parents who may act for a student in campus leave: approved links, less a restricted one. */
export async function familyParentsOf(studentId: string, executor: Executor = db) {
  const [parents, restrictions] = await Promise.all([parentsOf(studentId, executor), activeRestrictions([studentId], executor)]);
  const kept = new Set(restrictions.map((r) => r.restrictedUserId).filter(Boolean));
  return parents.filter((p) => !kept.has(p.id));
}

/**
 * The students a family account may see in campus leave: a student
 * themself; a parent their approved children, except a child a custody
 * restriction keeps them from.
 */
export async function familyStudentIds(viewer: Viewer, executor: Executor = db): Promise<string[]> {
  if (viewer.role === ROLES.STUDENT) return [viewer.id];
  if (viewer.role !== ROLES.PARENT) return [];
  const links = await executor.select({ studentId: parentStudentLink.studentId }).from(parentStudentLink)
    .where(and(eq(parentStudentLink.parentId, viewer.id), eq(parentStudentLink.status, 'approved')));
  const ids = links.map((l) => l.studentId);
  if (ids.length === 0) return [];
  const restricted = await executor.select({ studentId: leaveCustodyRestriction.studentId }).from(leaveCustodyRestriction)
    .where(and(inArray(leaveCustodyRestriction.studentId, ids), eq(leaveCustodyRestriction.restrictedUserId, viewer.id), isNull(leaveCustodyRestriction.endedAt)));
  const out = new Set(restricted.map((r) => r.studentId));
  return ids.filter((id) => !out.has(id));
}

/** The students sharing an approved parent with a student (the student included). */
export async function familyOfStudent(studentId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    select distinct l2.student_id as id from parent_student_link l1
    join parent_student_link l2 on l2.parent_id = l1.parent_id and l2.status = 'approved'
    where l1.student_id = ${studentId} and l1.status = 'approved'`);
  const ids = new Set((rows.rows as { id: string }[]).map((r) => r.id));
  ids.add(studentId);
  return [...ids];
}

export const FAMILY_ROLES = [ROLES.PARENT, ROLES.STUDENT] as const;
export const DESK_ROLES = [ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN] as const;
/** Staff who read leave records (the desk, the coordinator, the admin). */
export const LEAVE_STAFF_ROLES = [ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.COORDINATOR, ROLES.ADMIN] as const;
/** Staff who record custody restrictions and see ID numbers whole. */
export const CUSTODY_ROLES = [ROLES.COORDINATOR, ROLES.ADMIN] as const;
/** Staff who work the gate (the coordinator and the admin can stand in). */
export const GATE_ROLES = [ROLES.GATE, ROLES.COORDINATOR, ROLES.ADMIN] as const;

export const isFamily = (v: Viewer) => v.role === ROLES.PARENT || v.role === ROLES.STUDENT;
export const isLeaveStaff = (v: Viewer) => hasRole(v.role, ...LEAVE_STAFF_ROLES);
export const seesIdNumbers = (v: Viewer) => hasRole(v.role, ...CUSTODY_ROLES);

// ─── Matching a person against a restriction ─────────────────────────────────

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/** An ID number as compared: Latin digits and letters only, upper case. */
export function normalizeIdNumber(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10))
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase();
}

/** A name as compared: case, spacing, Arabic diacritics and letter variants folded. */
export function normalizeName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')   // harakat, superscript alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type Restriction = typeof leaveCustodyRestriction.$inferSelect;

/**
 * The restrictions a person matches: the same account, the same ID number,
 * or the same name (folded as above) when either side has no ID number to
 * tell two people of one name apart. A name is enough then: the gate is told
 * to hold the student and call the coordinator.
 */
export function matchingRestrictions(
  person: { userId?: string | null; name?: string | null; idNumber?: string | null },
  restrictions: Restriction[],
): Restriction[] {
  const id = normalizeIdNumber(person.idNumber);
  const name = normalizeName(person.name);
  return restrictions.filter((r) => {
    const rid = normalizeIdNumber(r.idNumber);
    if (person.userId && r.restrictedUserId === person.userId) return true;
    if (id.length >= 4 && rid === id) return true;
    const oneIdMissing = id.length < 4 || rid.length < 4;
    return oneIdMissing && !!name && normalizeName(r.personName) === name;
  });
}

// ─── Notifications ───────────────────────────────────────────────────────────

/**
 * In-app notifications written by the caller's executor: inside a
 * transaction they commit with the change they announce, or not at all (the
 * scheduler's flags are told exactly once).
 */
export async function notifyUsers(
  userIds: (string | null | undefined)[],
  type: NotificationType,
  title: string,
  body: string,
  data: Record<string, unknown>,
  executor: Executor = db,
) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u))];
  if (ids.length === 0) return;
  await executor.insert(notification).values(ids.map((userId) => ({ id: randomUUID(), userId, type, title, body, data })));
}

/** "Sunday 4 October" — the date as notifications write it. */
export function spokenDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** Today, tomorrow, or the date. */
export function whenSpoken(date: string, now: Date = new Date()): string {
  const today = schoolNow(now).date;
  if (date === today) return 'today';
  const t = new Date(`${today}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  if (t.toISOString().slice(0, 10) === date) return 'tomorrow';
  return `on ${spokenDate(date)}`;
}
