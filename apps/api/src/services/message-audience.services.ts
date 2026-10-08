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

import { db, sql, user, charge, parentStudentLink, registrationSession, eq, and, inArray, or, isNull, gradeTodaySql } from '@repo/db';
import {
  MONEY_LISTS, STAFF_ROLES, ROLES, broadcastLabel, BATCH_LIST_LABELS, WHO_LABELS, CHARGE_KIND_LABELS,
  type AudienceDefinitionType, type AudienceWho, type MessageVariable, type BatchList,
} from '@repo/validations';
import { getSessionMoney } from './session-money.services';
import { listCharges, chargeRules, ChargeError } from './charge.services';
import { getSetting } from './settings.services';

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

export const FINANCE_LISTS_ONLY = "Finance sends to a money list only: a session's unpaid families or the holders of a charge";

const FINANCE = [ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN] as string[];

/** Whether the viewer may send to (or read the messages of) this audience. Admin: any; finance: the money lists. */
export function mayUseAudience(viewer: Viewer, def: AudienceDefinitionType): boolean {
  if (viewer.role === ROLES.ADMIN) return true;
  if (FINANCE.includes(viewer.role ?? '')) return def.kind === 'batch' && MONEY_LISTS.includes(def.list as BatchList);
  return false;
}

export function assertMayUseAudience(viewer: Viewer, def: AudienceDefinitionType) {
  if (!mayUseAudience(viewer, def)) throw new AudienceError(FINANCE_LISTS_ONLY, 403);
}

const isMoneyList = (def: AudienceDefinitionType) => def.kind === 'batch' && MONEY_LISTS.includes(def.list as BatchList);

// ─── People ──────────────────────────────────────────────────────────────────

type Person = { id: string; name: string; email: string; role: string; banned: boolean | null };
const notBanned = or(eq(user.banned, false), isNull(user.banned));

async function people(executor: Executor, ids: string[]): Promise<Map<string, Person>> {
  if (!ids.length) return new Map();
  const rows = await executor.select({ id: user.id, name: user.name, email: user.email, role: user.role, banned: user.banned })
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
 * children in the set.
 */
async function families(executor: Executor, students: Map<string, Owed | null>, who: AudienceWho, perChild: boolean): Promise<AudienceMember[]> {
  const ids = [...students.keys()];
  const [studentRows, parents] = await Promise.all([people(executor, ids), parentsOf(executor, ids)]);
  const out: AudienceMember[] = [];
  const parentMembers = new Map<string, AudienceMember>();
  for (const sid of ids) {
    const s = studentRows.get(sid);
    if (!s || s.banned) continue;
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

function addOwed(map: Map<string, Owed | null>, studentId: string, add: { amount: number; dueAt: Date; item: string; sessionId: string | null; sessionName: string | null; lineId?: string; chargeId?: string }) {
  const o = map.get(studentId) ?? { amount: 0, dueAt: add.dueAt, items: [], sessionId: add.sessionId, sessionName: add.sessionName, lineIds: [], chargeIds: [] };
  o.amount = round2(o.amount + add.amount);
  if (add.dueAt < o.dueAt) o.dueAt = add.dueAt;
  if (!o.items.includes(add.item)) o.items.push(add.item);
  if (add.lineId) o.lineIds.push(add.lineId);
  if (add.chargeId) o.chargeIds.push(add.chargeId);
  map.set(studentId, o);
}

/**
 * Whether C's rules let a charge be paid now (`chargeRules` with `forPayment`: its deadline, a
 * service fee still provisional), read in the caller's transaction or a read-only one of its own.
 */
export async function chargePayableNow(executor: Executor, chargeId: string, now: Date): Promise<boolean> {
  const check = async (tx: Tx) => {
    const [c] = await tx.select().from(charge).where(eq(charge.id, chargeId));
    if (!c || c.status !== 'pending_payment') return false;
    await chargeRules(tx, c, now, { forPayment: true });
    return true;
  };
  try {
    return executor === db ? await db.transaction(check) : await check(executor as Tx);
  } catch (e) {
    if (e instanceof ChargeError) return false;
    throw e;
  }
}

/** The lines among these under a live instalment plan: their instalments are what is owed. */
async function planLines(executor: Executor, lineIds: string[]): Promise<Set<string>> {
  if (!lineIds.length) return new Set();
  const r = await executor.execute(sql`select registration_id as id from exception
    where policy_key = 'plan.instalments' and status = 'active' and registration_id in (${sql.join(lineIds.map((i) => sql`${i}`), sql`, `)})`);
  return new Set((r.rows as { id: string }[]).map((x) => x.id));
}

/**
 * A session's unpaid families, as the Money tab shows them (A's getSessionMoney with its filter,
 * subject and section) and the session's charges awaiting payment (C's listCharges): what each
 * student owes that can be paid now — a line on a provisional board fee (unless the school takes
 * payment on one), a line paid by its instalment plan and a charge C's rules refuse are left out.
 */
async function sessionUnpaid(executor: Executor, def: Extract<AudienceDefinitionType, { list: 'session_unpaid' }>, now: Date) {
  const owed = new Map<string, Owed | null>();
  const [session] = await executor.select({ id: registrationSession.id, name: registrationSession.name }).from(registrationSession).where(eq(registrationSession.id, def.sessionId));
  if (!session) throw new AudienceError('Session not found', 404);
  const only = def.studentIds?.length ? new Set(def.studentIds) : null;
  if (def.include !== 'charges') {
    const money = await getSessionMoney(def.sessionId, { filter: def.filter, ...(def.offerId ? { offerId: def.offerId } : {}), ...(def.sectionId ? { sectionId: def.sectionId } : {}) });
    const payOnProvisional = await getSetting('pricing.payOnProvisionalFee', executor);
    const lines = (money?.lines ?? []).filter((l) => l.unpaid && (!l.provisional || payOnProvisional) && (!only || only.has(l.student.id)));
    const planned = await planLines(executor, lines.map((l) => l.id));
    for (const l of lines) {
      if (planned.has(l.id)) continue;
      addOwed(owed, l.student.id, { amount: l.price, dueAt: new Date(l.dueAt), item: l.item.kind === 'whole' ? l.subject.name : `${l.subject.name} — ${l.item.label}`, sessionId: session.id, sessionName: session.name, lineId: l.id });
    }
  }
  if (def.include !== 'lines' && !def.offerId) {
    const charges = await listCharges({ sessionId: def.sessionId, status: 'pending_payment' }, { id: 'system', role: ROLES.ADMIN });
    for (const c of charges) {
      if (only && !only.has(c.studentId)) continue;
      if (def.filter === 'overdue' && new Date(c.dueAt) >= now) continue;
      if (c.kind === 'school_fee_push') continue;
      if (def.sectionId) {
        const inSection = await executor.execute(sql`select 1 from section_membership where student_id = ${c.studentId} and section_id = ${def.sectionId} and ended_on is null limit 1`);
        if (!inSection.rows.length) continue;
      }
      if (!(await chargePayableNow(executor, c.id, now))) continue;
      addOwed(owed, c.studentId, { amount: c.amount, dueAt: new Date(c.dueAt), item: c.description, sessionId: session.id, sessionName: session.name, chargeId: c.id });
    }
  }
  return owed;
}

async function chargeHolders(executor: Executor, def: Extract<AudienceDefinitionType, { list: 'charge_holders' }>, now: Date) {
  const owed = new Map<string, Owed | null>();
  const statuses = def.unpaidOnly ? ['pending_payment'] : ['pending_payment', 'paid'];
  const rows = await executor.execute(sql`
    select c.id, c.student_id as "studentId", c.amount, c.due_at as "dueAt", c.description, r.session_id as "sessionId", s.name as "sessionName"
    from charge c
    left join registration r on r.id = c.registration_id
    left join registration_session s on s.id = r.session_id
    where c.kind = ${def.chargeKind} and c.status in (${sql.join(statuses.map((x) => sql`${x}`), sql`, `)})
      ${def.academicYear ? sql`and c.academic_year = ${def.academicYear}` : sql``}
    order by c.student_id, c.due_at`);
  for (const c of rows.rows as { id: string; studentId: string; amount: string; dueAt: string; description: string; sessionId: string | null; sessionName: string | null }[]) {
    if (!def.unpaidOnly) { if (!owed.has(c.studentId)) owed.set(c.studentId, null); continue; }
    if (!(await chargePayableNow(executor, c.id, now))) continue;
    addOwed(owed, c.studentId, { amount: Number(c.amount), dueAt: new Date(c.dueAt), item: c.description, sessionId: c.sessionId, sessionName: c.sessionName, chargeId: c.id });
  }
  return owed;
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
      return `${def.filter === 'overdue' ? 'Overdue' : 'Unpaid'} in ${s?.name ?? 'a session'}${def.studentIds?.length ? ` (${def.studentIds.length} chosen)` : ''} — ${who}`;
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
  if (isMoneyList(def) && !(def.kind === 'batch' && def.list === 'charge_holders' && !def.unpaidOnly)) fills.push('amount', 'due', 'items');
  return { members, session, fills, label: await audienceLabel(executor, def) };
}


/** For the reminders (reminder.services.ts): the same expansions a list uses. */
export { families as familyMembers, broadcast as broadcastMembers };
