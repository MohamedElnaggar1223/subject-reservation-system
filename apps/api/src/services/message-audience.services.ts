/**
 * Audiences (RESERVATIONS_REWORK.md §3.8): who a message reaches, resolved when it is sent — a
 * grade is today's, a session's unpaid families are those the Money tab shows now. Every list is
 * read from what the system already holds, through the owners' own readers where one exists: A's
 * Money tab (`getSessionMoney`), C's charges (`listCharges`, `chargeRules` for what can be paid),
 * F1's teaching demand as F0b keeps it (course enrolments per subject, unit and teacher).
 *
 * A list about money (a session's unpaid lines and charges, the holders of a charge) is resolved
 * per child: each delivery is about one student and carries what that student owes, so a parent of
 * two gets one message about each. Any other list is per person: a parent hears once, with their
 * children in the list named.
 */

import { db, sql, user, parentStudentLink, registrationSession, eq, and, inArray, or, isNull, gradeTodaySql } from '@repo/db';
import {
  STAFF_ROLES, ROLES, broadcastLabel, isPaymentList, anchorDay, BATCH_LIST_LABELS, WHO_LABELS, CHARGE_KIND_LABELS,
  type AudienceDefinitionType, type AudienceWho, type MessageVariable, type BatchList,
} from '@repo/validations';
import { getSessionMoney } from './session-money.services';
import { listCharges } from './charge.services';
import { getSetting } from './settings.services';
import { payableLines, payableCharges, chargeOpenSql, studentPresent } from './payable-now.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type Viewer = { id: string; role: string | null | undefined };

/** What one student owes in a money list: the total, the earliest due date, what it is for. */
export type Owed = { amount: number; dueAt: Date; items: string[]; sessionId: string | null; sessionName: string | null; lineIds: string[]; chargeIds: string[] };

export type AudienceMember = {
  recipientId: string;
  name: string;
  email: string;
  role: string;
  /** The student the delivery is about: the child of a parent recipient, or the student themself. */
  about: string | null;
  /** The student's name (about), or a parent's children in the list. */
  studentNames: string[];
  /** The approved parents of the student the delivery is about. */
  guardians: string[];
  owed: Owed | null;
};

export type ResolvedAudience = {
  members: AudienceMember[];
  /** The session {session} and {closes} read (the list's, else the message's context). */
  session: { id: string; name: string; endDate: Date } | null;
  /** The variables every recipient of this audience can be given. */
  fills: MessageVariable[];
  label: string;
};

export class AudienceError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 = 400) {
    super(message);
    this.name = 'AudienceError';
  }
}

export const FINANCE_LISTS_ONLY = "Finance sends to a payment list only: a session's unpaid families or the holders of an unpaid charge";

const FINANCE = [ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN] as string[];

/**
 * Whether the viewer may send to (or read the messages of) this audience. Admin: any; finance: the
 * payment lists only — a session's unpaid families, or the holders of a charge still unpaid — never
 * the holders of a paid charge (with the school fee that is nearly every family: the review of
 * 5c2f2bf, item 2).
 */
export function mayUseAudience(viewer: Viewer, def: AudienceDefinitionType): boolean {
  if (viewer.role === ROLES.ADMIN) return true;
  if (FINANCE.includes(viewer.role ?? '')) return isPaymentList(def);
  return false;
}

export function assertMayUseAudience(viewer: Viewer, def: AudienceDefinitionType) {
  if (!mayUseAudience(viewer, def)) throw new AudienceError(FINANCE_LISTS_ONLY, 403);
}


// ─── People ──────────────────────────────────────────────────────────────────

type Person = { id: string; name: string; email: string; role: string; banned: boolean | null; leftOn?: string | null };
const notBanned = or(eq(user.banned, false), isNull(user.banned));

async function people(executor: Executor, ids: string[]): Promise<Map<string, Person>> {
  if (!ids.length) return new Map();
  const rows = await executor.select({ id: user.id, name: user.name, email: user.email, role: user.role, banned: user.banned, leftOn: user.leftOn })
    .from(user).where(inArray(user.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, { ...r, role: r.role ?? '' }]));
}

/** The approved parents of each student (not banned), and each parent's children among them. */
async function parentsOf(executor: Executor, studentIds: string[]) {
  const byStudent = new Map<string, Person[]>();
  if (!studentIds.length) return byStudent;
  const rows = await executor.select({ studentId: parentStudentLink.studentId, id: user.id, name: user.name, email: user.email, role: user.role, banned: user.banned })
    .from(parentStudentLink).innerJoin(user, eq(user.id, parentStudentLink.parentId))
    .where(and(inArray(parentStudentLink.studentId, [...new Set(studentIds)]), eq(parentStudentLink.status, 'approved')))
    .orderBy(user.name);
  for (const r of rows) {
    if (r.banned) continue;
    byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), { id: r.id, name: r.name, email: r.email, role: r.role ?? 'parent', banned: r.banned }]);
  }
  return byStudent;
}

/**
 * A set of students as recipients: each student and/or their approved parents. Per child (a money
 * list), one member per (recipient, student); otherwise one per person, a parent naming their
 * children in the set. A student who has left the school (F0a's leaving) or is barred is in no list,
 * nor are their parents on their account (the review of 5c2f2bf, item 6).
 */
async function families(executor: Executor, students: Map<string, Owed | null>, who: AudienceWho, perChild: boolean): Promise<AudienceMember[]> {
  const ids = [...students.keys()];
  const [studentRows, parents] = await Promise.all([people(executor, ids), parentsOf(executor, ids)]);
  const out: AudienceMember[] = [];
  const parentMembers = new Map<string, AudienceMember>();
  for (const sid of ids) {
    const s = studentRows.get(sid);
    if (!s || s.banned || s.leftOn) continue;
    const owed = students.get(sid) ?? null;
    const guardians = (parents.get(sid) ?? []).map((p) => p.name);
    if (who !== 'parents') {
      out.push({ recipientId: s.id, name: s.name, email: s.email, role: s.role, about: s.id, studentNames: [s.name], guardians, owed });
    }
    if (who === 'students') continue;
    for (const p of parents.get(sid) ?? []) {
      if (perChild) {
        out.push({ recipientId: p.id, name: p.name, email: p.email, role: 'parent', about: s.id, studentNames: [s.name], guardians, owed });
      } else {
        const m = parentMembers.get(p.id);
        if (m) m.studentNames.push(s.name);
        else parentMembers.set(p.id, { recipientId: p.id, name: p.name, email: p.email, role: 'parent', about: null, studentNames: [s.name], guardians: [p.name], owed: null });
      }
    }
  }
  return [...out, ...parentMembers.values()];
}

/** People as themselves (a broadcast to staff, direct picks): a student is about themself, a parent names their children. */
async function asThemselves(executor: Executor, rows: Person[]): Promise<AudienceMember[]> {
  const parentIds = rows.filter((r) => r.role === 'parent').map((r) => r.id);
  const children = new Map<string, string[]>();
  if (parentIds.length) {
    const links = await executor.select({ parentId: parentStudentLink.parentId, name: user.name })
      .from(parentStudentLink).innerJoin(user, eq(user.id, parentStudentLink.studentId))
      .where(and(inArray(parentStudentLink.parentId, parentIds), eq(parentStudentLink.status, 'approved'), isNull(user.leftOn)))
      .orderBy(user.name);
    for (const l of links) children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.name]);
  }
  const studentIds = rows.filter((r) => r.role === 'student').map((r) => r.id);
  const guardians = await parentsOf(executor, studentIds);
  return rows.filter((r) => !r.banned).map((r) => ({
    recipientId: r.id, name: r.name, email: r.email, role: r.role,
    about: r.role === 'student' ? r.id : null,
    studentNames: r.role === 'student' ? [r.name] : children.get(r.id) ?? [],
    guardians: r.role === 'student' ? (guardians.get(r.id) ?? []).map((p) => p.name) : r.role === 'parent' ? [r.name] : [],
    owed: null,
  }));
}

// ─── Broadcasts ──────────────────────────────────────────────────────────────

async function broadcast(executor: Executor, group: string, grade: number | null): Promise<AudienceMember[]> {
  const inGrade = grade ? sql`${gradeTodaySql(user.cohortYear)} = ${grade}` : sql`true`;
  const studentsQ = () => executor.select({ id: user.id }).from(user)
    .where(and(eq(user.role, 'student'), notBanned, isNull(user.leftOn), inGrade));
  if (group === 'staff' || group === 'everyone') {
    const roles: string[] = group === 'staff' ? [...STAFF_ROLES] : [...STAFF_ROLES, 'student', 'parent'];
    const rows = await executor.select({ id: user.id, name: user.name, email: user.email, role: user.role, banned: user.banned }).from(user)
      .where(and(inArray(user.role, roles), notBanned, or(isNull(user.leftOn), sql`${user.role} <> 'student'`)))
      .orderBy(user.name);
    return asThemselves(executor, rows.map((r) => ({ ...r, role: r.role ?? '' })));
  }
  if (group === 'parents' && !grade) {
    // Every parent account (as the old "All Parents" did), linked or not.
    const rows = await executor.select({ id: user.id, name: user.name, email: user.email, role: user.role, banned: user.banned }).from(user)
      .where(and(eq(user.role, 'parent'), notBanned)).orderBy(user.name);
    return asThemselves(executor, rows.map((r) => ({ ...r, role: 'parent' })));
  }
  const students = await studentsQ();
  const who: AudienceWho = group === 'students' ? 'students' : group === 'parents' ? 'parents' : 'families';
  return families(executor, new Map(students.map((s) => [s.id, null])), who, false);
}

// ─── Batch lists ─────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
/** A line (alias r) a completed payment funded: a paid preregistration counts as paid. */
const FUNDED = sql`exists (select 1 from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = r.id and p.status = 'completed')`;

type OwedPart = { amount: number; dueAt: Date; item: string; sessionId: string | null; sessionName: string | null; lineId?: string; chargeId?: string };

/**
 * What one student owes, as a money list's text says it: the items due on the **first** day they
 * owe anything (the school's day, Cairo), their sum as {amount}, that day as {due} — never the whole
 * remainder under the earliest date (the review of 9e7a4d6, item 1: a plan's two instalments of 750,
 * due 20 and 27 October, read "EGP 1,500 … is due on 20 October"). The sentence "{amount} … is due
 * on {due}" stays literally true; what falls due later is reminded by the step on its own days, and
 * a second "Remind" after the first is paid names the next.
 */
function firstDayOwed(parts: Map<string, OwedPart[]>): Map<string, Owed | null> {
  const owed = new Map<string, Owed | null>();
  for (const [studentId, list] of parts) {
    if (!list.length) continue;
    const first = list.map((p) => anchorDay(p.dueAt)).sort()[0]!;
    const today = list.filter((p) => anchorDay(p.dueAt) === first);
    const o: Owed = {
      amount: 0, dueAt: today[0]!.dueAt, items: [], sessionId: today[0]!.sessionId, sessionName: today[0]!.sessionName, lineIds: [], chargeIds: [],
    };
    for (const p of today) {
      o.amount = round2(o.amount + p.amount);
      if (p.dueAt < o.dueAt) o.dueAt = p.dueAt;
      if (!o.items.includes(p.item)) o.items.push(p.item);
      if (p.lineId) o.lineIds.push(p.lineId);
      if (p.chargeId) o.chargeIds.push(p.chargeId);
    }
    owed.set(studentId, o);
  }
  return owed;
}

function addOwed(parts: Map<string, OwedPart[]>, studentId: string, add: OwedPart) {
  parts.set(studentId, [...(parts.get(studentId) ?? []), add]);
}

/**
 * Past its due instant: the overdue text applies from the moment the due date has passed (the review
 * of 9e7a4d6, item 5) — not after a whole day as the Money tab counts its "days overdue", which would
 * send "is due on" with a date already gone during the first 24 hours.
 */
const isOverdue = (due: Date, now: Date) => due.getTime() < now.getTime();

/**
 * A session's unpaid families, as the Money tab shows them (A's getSessionMoney with its subject
 * and section) and the session's charges awaiting payment (C's listCharges), narrowed by the same
 * predicates the reminder step reads (payable-now.services.ts): what each student owes and can pay
 * now — not a line on a provisional board fee (unless the school takes payment on one), one paid by
 * its instalment plan, one with a payment open or past its effective deadline, nor a charge being
 * paid or that C's rules refuse. `filter`: everything owed, only what is overdue (its due instant
 * passed), or only what is not yet (the Money tab's "Remind" sends the overdue text to the first,
 * the due text to the second). Per student, the items of the first day they owe anything
 * (firstDayOwed).
 */
async function sessionUnpaid(executor: Executor, def: Extract<AudienceDefinitionType, { list: 'session_unpaid' }>, now: Date) {
  const owed = new Map<string, OwedPart[]>();
  const [session] = await executor.select({ id: registrationSession.id, name: registrationSession.name }).from(registrationSession).where(eq(registrationSession.id, def.sessionId));
  if (!session) throw new AudienceError('Session not found', 404);
  const only = def.studentIds?.length ? new Set(def.studentIds) : null;
  const wanted = (due: Date) => def.filter === 'unpaid' || (def.filter === 'overdue') === isOverdue(due, now);
  if (def.include !== 'charges') {
    const money = await getSessionMoney(def.sessionId, { filter: 'unpaid', ...(def.offerId ? { offerId: def.offerId } : {}), ...(def.sectionId ? { sectionId: def.sectionId } : {}) });
    const payOnProvisional = await getSetting('pricing.payOnProvisionalFee', executor);
    const lines = (money?.lines ?? []).filter((l) => l.unpaid && (!only || only.has(l.student.id)) && wanted(new Date(l.dueAt)));
    const payable = await payableLines(executor, lines.map((l) => l.id), now, payOnProvisional);
    for (const l of lines) {
      if (!payable.has(l.id)) continue;
      addOwed(owed, l.student.id, { amount: l.price, dueAt: new Date(l.dueAt), item: l.item.kind === 'whole' ? l.subject.name : `${l.subject.name} — ${l.item.label}`, sessionId: session.id, sessionName: session.name, lineId: l.id });
    }
  }
  if (def.include !== 'lines' && !def.offerId) {
    const charges = (await listCharges({ sessionId: def.sessionId, status: 'pending_payment' }, { id: 'system', role: ROLES.ADMIN }))
      .filter((c) => c.kind !== 'school_fee_push' && (!only || only.has(c.studentId)) && wanted(new Date(c.dueAt)));
    const inSection = def.sectionId && charges.length
      ? new Set(((await executor.execute(sql`select student_id as id from section_membership where section_id = ${def.sectionId} and ended_on is null`)).rows as { id: string }[]).map((r) => r.id))
      : null;
    const payable = await payableCharges(executor, charges.filter((c) => !inSection || inSection.has(c.studentId)).map((c) => c.id), now);
    for (const c of charges) {
      if (!payable.has(c.id)) continue;
      addOwed(owed, c.studentId, { amount: c.amount, dueAt: new Date(c.dueAt), item: c.description, sessionId: session.id, sessionName: session.name, chargeId: c.id });
    }
  }
  return firstDayOwed(owed);
}

/**
 * The holders of a charge kind: of a charge still owed (the step's predicates, then C's rules), or —
 * the admin only — of any live one, awaiting payment or paid.
 */
async function chargeHolders(executor: Executor, def: Extract<AudienceDefinitionType, { list: 'charge_holders' }>, now: Date) {
  const owed = new Map<string, OwedPart[]>();
  const rows = await executor.execute(sql`
    select c.id, c.student_id as "studentId", c.amount, c.due_at as "dueAt", c.description, r.session_id as "sessionId", s.name as "sessionName"
    from charge c
    left join registration r on r.id = c.registration_id
    left join registration_session s on s.id = r.session_id
    where c.kind = ${def.chargeKind}
      and ${def.unpaidOnly ? chargeOpenSql : sql`c.status in ('pending_payment', 'paid') and ${studentPresent('c.student_id')}`}
      ${def.academicYear ? sql`and c.academic_year = ${def.academicYear}` : sql``}
    order by c.student_id, c.due_at`);
  const found = rows.rows as { id: string; studentId: string; amount: string; dueAt: string; description: string; sessionId: string | null; sessionName: string | null }[];
  if (!def.unpaidOnly) return new Map(found.map((c) => [c.studentId, null as Owed | null]));
  const payable = await payableCharges(executor, found.map((c) => c.id), now);
  for (const c of found) {
    if (!payable.has(c.id)) continue;
    addOwed(owed, c.studentId, { amount: Number(c.amount), dueAt: new Date(c.dueAt), item: c.description, sessionId: c.sessionId, sessionName: c.sessionName, chargeId: c.id });
  }
  return firstDayOwed(owed);
}

async function studentsOf(executor: Executor, query: ReturnType<typeof sql>) {
  const r = await executor.execute(query);
  return new Map((r.rows as { id: string }[]).map((x) => [x.id, null as Owed | null]));
}

// ─── Resolve ─────────────────────────────────────────────────────────────────

async function sessionInfo(executor: Executor, id: string | null | undefined) {
  if (!id) return null;
  const [s] = await executor.select({ id: registrationSession.id, name: registrationSession.name, endDate: registrationSession.endDate })
    .from(registrationSession).where(eq(registrationSession.id, id));
  if (!s) throw new AudienceError('Session not found', 404);
  return s;
}

/** The words a log row and the picker use for an audience. */
export async function audienceLabel(executor: Executor, def: AudienceDefinitionType): Promise<string> {
  if (def.kind === 'broadcast') return broadcastLabel({ group: def.group, grade: def.grade ?? null });
  if (def.kind === 'direct') return def.userIds.length === 1 ? 'One person' : `${def.userIds.length} people`;
  const who = WHO_LABELS[def.who];
  switch (def.list) {
    case 'session_unpaid': {
      const s = await sessionInfo(executor, def.sessionId).catch(() => null);
      return `${def.filter === 'overdue' ? 'Overdue' : def.filter === 'due' ? 'Not yet due' : 'Unpaid'} in ${s?.name ?? 'a session'}${def.studentIds?.length ? ` (${def.studentIds.length} chosen)` : ''} — ${who}`;
    }
    case 'section': {
      const r = await executor.execute(sql`select name from section where id = ${def.sectionId}`);
      return `Section ${(r.rows[0] as { name?: string } | undefined)?.name ?? ''} — ${who}`;
    }
    case 'teaching_group': {
      const r = await executor.execute(sql`select s.name as subject, u.code as unit, t.name as teacher from subject s
        left join exam_unit u on u.id = ${def.unitId} left join teacher t on t.id = ${def.teacherId} where s.id = ${def.subjectId}`);
      const g = r.rows[0] as { subject?: string; unit?: string | null; teacher?: string | null } | undefined;
      return `${g?.subject ?? 'A subject'}${g?.unit ? ` ${g.unit}` : ''} with ${g?.teacher ?? 'no teacher yet'} — ${who}`;
    }
    case 'offer_reservers': {
      const r = await executor.execute(sql`select sub.name as subject, s.name as session from session_offer o join subject sub on sub.id = o.subject_id join registration_session s on s.id = o.session_id where o.id = ${def.offerId}`);
      const o = r.rows[0] as { subject?: string; session?: string } | undefined;
      return `Reserved ${o?.subject ?? 'a subject'} in ${o?.session ?? 'a session'} — ${who}`;
    }
    case 'charge_holders':
      return `${def.unpaidOnly ? 'Unpaid' : 'Holders of'} ${CHARGE_KIND_LABELS[def.chargeKind]}${def.academicYear ? ` ${def.academicYear}` : ''} — ${who}`;
  }
  return BATCH_LIST_LABELS[(def as { list: BatchList }).list];
}

/**
 * Resolve an audience to its members now. `context.sessionId` names the session {session} and
 * {closes} read when the list does not name one.
 */
export async function resolveAudience(def: AudienceDefinitionType, context: { sessionId?: string | null } = {}, executor: Executor = db, now: Date = new Date()): Promise<ResolvedAudience> {
  let members: AudienceMember[];
  let sessionId: string | null = context.sessionId ?? null;
  if (def.kind === 'broadcast') {
    members = await broadcast(executor, def.group, def.grade ?? null);
  } else if (def.kind === 'direct') {
    const found = await people(executor, def.userIds);
    const missing = def.userIds.filter((i) => !found.has(i));
    if (missing.length) throw new AudienceError(missing.length === 1 ? 'One of the people chosen was not found' : `${missing.length} of the people chosen were not found`, 404);
    members = await asThemselves(executor, def.userIds.map((i) => found.get(i)!));
  } else {
    switch (def.list) {
      case 'session_unpaid':
        sessionId = def.sessionId;
        members = await families(executor, await sessionUnpaid(executor, def, now), def.who, true);
        break;
      case 'charge_holders':
        members = await families(executor, await chargeHolders(executor, def, now), def.who, true);
        break;
      case 'section':
        members = await families(executor, await studentsOf(executor, sql`select m.student_id as id from section_membership m join "user" u on u.id = m.student_id
          where m.section_id = ${def.sectionId} and m.ended_on is null order by u.name`), def.who, false);
        break;
      case 'teaching_group':
        members = await families(executor, await studentsOf(executor, sql`select e.student_id as id from course_enrolment e join "user" u on u.id = e.student_id
          where e.academic_year_id = ${def.academicYearId} and e.subject_id = ${def.subjectId} and e.ended_on is null and e.mode = 'in_school'
            and e.unit_id is not distinct from ${def.unitId} and e.teacher_id is not distinct from ${def.teacherId} order by u.name`), def.who, false);
        break;
      case 'offer_reservers': {
        const [o] = (await executor.execute(sql`select session_id from session_offer where id = ${def.offerId}`)).rows as { session_id: string }[];
        if (!o) throw new AudienceError('Subject offer not found', 404);
        sessionId = o.session_id;
        const statuses = def.lines === 'paid' ? sql`(r.status = 'confirmed' or (r.status = 'preregistered' and ${FUNDED}))`
          : def.lines === 'unpaid' ? sql`(r.status = 'pending_payment' or (r.status = 'preregistered' and not ${FUNDED}))`
            : sql`r.status in ('pending_approval', 'pending_payment', 'preregistered', 'confirmed')`;
        members = await families(executor, await studentsOf(executor, sql`select distinct r.student_id as id, u.name from registration r
          join session_offer_item i on i.id = r.offer_item_id join "user" u on u.id = r.student_id
          where i.offer_id = ${def.offerId} and ${statuses} order by u.name`), def.who, false);
        break;
      }
    }
  }
  const session = await sessionInfo(executor, sessionId);
  const fills: MessageVariable[] = [];
  const familyOnly = members.every((m) => m.role === 'student' || m.role === 'parent');
  if (familyOnly) fills.push('guardian', 'student');
  if (session) fills.push('session', 'closes');
  if (isPaymentList(def)) fills.push('amount', 'due', 'items');
  return { members, session, fills, label: await audienceLabel(executor, def) };
}


/** For the reminders (reminder.services.ts): the same expansions a list uses. */
export { families as familyMembers, broadcast as broadcastMembers };
