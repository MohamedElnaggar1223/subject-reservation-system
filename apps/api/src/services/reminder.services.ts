/**
 * Reminder rules and the scheduler's reminder step (RESERVATIONS_REWORK.md §3.8;
 * docs/features/RESERVATIONS_MESSAGES.md §3).
 *
 * Each rule says on which days around its anchor a reminder goes out (−7: seven days before),
 * how often after the last of them until its target is done, on which channels and with which
 * text. The anchors are the dates the system already keeps current: a line's `due_at` (A's
 * `dueDateFor`, re-dated by `redateLines`), a charge's `due_at` (C's `chargeDueAt`; an instalment's
 * is its date), a session's end, a series' entry and retake deadlines, a declared sitting's
 * effective deadline (A's `effectiveDeadlinesOf`, B's To verify list).
 *
 * The step, every minute: for each target, the latest day of its rule whose send hour (Cairo) has
 * come — never earlier, and once: a target already claimed for that day, or already reminded today
 * about that date, is left out before anything is locked; each reminder is **claimed** in
 * `reminder_sent`, whose unique indexes (kind × target × anchor day × offset, and kind × target ×
 * anchor day × the day it is sent) make a second scheduler's insert — or a second reminder the same
 * day after a rule changed — conflict and send nothing (ST-06, ST-12). The claim, the message, its
 * notifications and deliveries and the audit row commit together. In that transaction the group's
 * sessions are taken `FOR KEY SHARE` first (A's order, §2.1: the session before its lines — the
 * claim's session foreign key would otherwise take it after the lines, against an admin's session
 * change that holds the session and then its lines), then the targets `FOR SHARE`, then they are
 * read again, so a payment taken meanwhile is never followed by a reminder to pay it. What is owed
 * and payable now is payable-now.services.ts's: shared with the money lists of "Remind".
 */

import { randomUUID } from 'crypto';
import {
  db, sql, message, messageAudience, messageTemplate, reminderRule, reminderSent, registrationSession, user,
  eq, and, inArray, isNull, asc,
} from '@repo/db';
import {
  REMINDER_KIND_UNTIL, REMINDER_KINDS, ROLES, dueOffset, anchorDay, messageDate,
  type ReminderKind, type PutReminderRuleType, type MessageTexts, type NotificationType,
} from '@repo/validations';
import { getSetting } from './settings.services';
import { logAction, type AuditContext } from './audit.services';
import { deliverInTx, MessageError, type DeliveryTarget } from './message.services';
import { familyMembers, broadcastMembers, type Owed, type AudienceMember } from './message-audience.services';
import { linePayableNowSql, chargeOpenSql, chargePayableNow } from './payable-now.services';
import { effectiveDeadlinesOf } from './deadline.services';
import { formatSeriesName } from './statement.services';
import { logger } from '../lib/logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Rule = typeof reminderRule.$inferSelect;

type TargetKind = 'line' | 'charge' | 'session' | 'series_entry' | 'series_retake' | 'verification';
type Candidate = {
  targetKind: TargetKind; targetId: string; anchor: Date; since: Date;
  studentId: string | null; sessionId: string | null;
  /** Session closing: the old 24-hour reminder (NOT-002) already went (registration_session.reminder_sent_at). */
  legacyClosingSent?: boolean;
};
type Due = Candidate & { rule: Rule; offset: number; templateId: string };

const NOTIFICATION_TYPE: Record<ReminderKind, NotificationType> = {
  payment_due: 'PAYMENT_REMINDER',
  school_fee_due: 'PAYMENT_REMINDER',
  session_closing: 'SESSION_CLOSING_SOON',
  entry_deadline: 'STAFF_REMINDER',
  declared_retakes_to_verify: 'STAFF_REMINDER',
};

const WAITING_LINE = sql`(r.status in ('pending_approval', 'pending_payment') or (r.status = 'preregistered' and not exists (
  select 1 from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = r.id and p.status = 'completed')))`;
const DEADLINE = sql.raw('line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected)');
const ids = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

const asDate = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

// ─── Candidates: every target that may be reminded, with its anchor ──────────

async function candidates(kind: ReminderKind, now: Date, payOnProvisional: boolean): Promise<Candidate[]> {
  switch (kind) {
    case 'payment_due': {
      const lines = (await db.execute(sql`
        select r.id, r.student_id, r.session_id, r.due_at, r.created_at from registration r
        where ${linePayableNowSql(now, payOnProvisional)}
        order by r.id`)).rows as Record<string, unknown>[];
      const charges = (await db.execute(sql`
        select c.id, c.student_id, r.session_id, c.due_at, c.created_at from charge c left join registration r on r.id = c.registration_id
        where ${chargeOpenSql} and c.kind <> 'school_fee_push'
        order by c.id`)).rows as Record<string, unknown>[];
      return [
        ...lines.map((r) => ({ targetKind: 'line' as const, targetId: r.id as string, anchor: asDate(r.due_at), since: asDate(r.created_at), studentId: r.student_id as string, sessionId: r.session_id as string })),
        ...charges.map((c) => ({ targetKind: 'charge' as const, targetId: c.id as string, anchor: asDate(c.due_at), since: asDate(c.created_at), studentId: c.student_id as string, sessionId: (c.session_id as string | null) ?? null })),
      ];
    }
    case 'school_fee_due': {
      const rows = (await db.execute(sql`
        select c.id, c.student_id, c.due_at, c.created_at from charge c
        where c.kind = 'school_fee_push' and ${chargeOpenSql}
        order by c.id`)).rows as Record<string, unknown>[];
      return rows.map((c) => ({ targetKind: 'charge' as const, targetId: c.id as string, anchor: asDate(c.due_at), since: asDate(c.created_at), studentId: c.student_id as string, sessionId: null }));
    }
    case 'session_closing': {
      const rows = (await db.execute(sql`select id, end_date, created_at, reminder_sent_at from registration_session where status = 'active' and end_date > ${now} order by id`)).rows as Record<string, unknown>[];
      return rows.map((s) => ({ targetKind: 'session' as const, targetId: s.id as string, anchor: asDate(s.end_date), since: asDate(s.created_at), studentId: null, sessionId: s.id as string, legacyClosingSent: s.reminder_sent_at != null }));
    }
    case 'entry_deadline': {
      const rows = (await db.execute(sql`
        select bs.id, bs.entry_deadline, bs.retake_deadline, bs.created_at from board_series bs
        where (bs.entry_deadline > ${now} or bs.retake_deadline > ${now})
          and exists (select 1 from registration r where r.board_series_id = bs.id and ${WAITING_LINE})
        order by bs.id`)).rows as Record<string, unknown>[];
      const out: Candidate[] = [];
      for (const s of rows) {
        if (s.entry_deadline && asDate(s.entry_deadline) > now) out.push({ targetKind: 'series_entry', targetId: s.id as string, anchor: asDate(s.entry_deadline), since: asDate(s.created_at), studentId: null, sessionId: null });
        if (s.retake_deadline && asDate(s.retake_deadline) > now) out.push({ targetKind: 'series_retake', targetId: s.id as string, anchor: asDate(s.retake_deadline), since: asDate(s.created_at), studentId: null, sessionId: null });
      }
      return out;
    }
    case 'declared_retakes_to_verify': {
      const rows = (await db.execute(sql`
        select r.id, r.student_id, r.session_id, r.created_at from registration r
        where r.prior_sitting_source in ('declared_by_family', 'declared_by_desk') and r.prior_sitting_verified_outcome is null
          and r.status in ('pending_approval', 'pending_payment', 'preregistered', 'confirmed')
        order by r.id`)).rows as Record<string, unknown>[];
      // Each line's deadline as B's To verify list computes it (A's effectiveDeadlinesOf: a late board entry counts).
      const deadlines = await effectiveDeadlinesOf(db, rows.map((r) => r.id as string));
      return rows.flatMap((r) => {
        const at = deadlines.get(r.id as string)?.at;
        return at && at > now ? [{ targetKind: 'verification' as const, targetId: r.id as string, anchor: at, since: asDate(r.created_at), studentId: r.student_id as string, sessionId: r.session_id as string }] : [];
      });
    }
  }
}

// ─── Rules ───────────────────────────────────────────────────────────────────

/** The rule that applies to a target: its session's own (inactive: off there) unless dropped, else the one for every session. */
function ruleFor(rules: Rule[], kind: ReminderKind, sessionId: string | null): Rule | null {
  const own = sessionId ? rules.find((r) => r.kind === kind && r.sessionId === sessionId && !r.inheritsAt) : undefined;
  if (own) return own.active ? own : null;
  const all = rules.find((r) => r.kind === kind && r.sessionId === null);
  return all?.active ? all : null;
}

function groupKey(kind: ReminderKind, d: Due) {
  switch (kind) {
    case 'payment_due':
    case 'school_fee_due': return `${d.rule.id}|${d.templateId}`;
    case 'session_closing': return `${d.rule.id}|${d.targetId}|${d.offset}`;
    case 'entry_deadline': return `${d.rule.id}|${d.targetKind}|${d.targetId}|${d.offset}`;
    case 'declared_retakes_to_verify': return `${d.rule.id}|${d.sessionId}`;
  }
}

class NothingClaimed extends Error {}

/**
 * The scheduler's reminder step: every rule's reminders due now, each claimed once. `now` is the
 * scheduler's minute (the suite passes its own). Returns how many reminders were claimed and sent.
 */
export async function runReminders(now: Date = new Date()) {
  if (!(await getSetting('reminders.enabled'))) return { claimed: 0, messages: 0, off: true };
  const hour = await getSetting('reminders.sendAtHour');
  const payOnProvisional = await getSetting('pricing.payOnProvisionalFee');
  const rules = await db.select().from(reminderRule);
  let claimed = 0;
  let messages = 0;
  for (const kind of REMINDER_KINDS) {
    const due: Due[] = [];
    for (const c of await candidates(kind, now, payOnProvisional)) {
      const rule = ruleFor(rules, kind, c.sessionId);
      if (!rule) continue;
      const offset = dueOffset({ anchor: c.anchor, offsetsDays: rule.offsetsDays, repeatEveryDays: rule.repeatEveryDays, sendAtHour: hour, now, since: c.since });
      if (offset === null) continue;
      // The old 24-hour closing reminder (NOT-002) already went for this session: its day is not sent again.
      if (kind === 'session_closing' && c.legacyClosingSent && offset >= -1) continue;
      due.push({ ...c, rule, offset, templateId: offset > 0 && rule.overdueTemplateId ? rule.overdueTemplateId : rule.templateId });
    }
    const fresh = await notClaimed(kind, due, now);
    const groups = new Map<string, Due[]>();
    for (const d of fresh) groups.set(groupKey(kind, d), [...(groups.get(groupKey(kind, d)) ?? []), d]);
    for (const items of groups.values()) {
      try {
        const n = await sendGroup(kind, items, now, payOnProvisional);
        if (n > 0) { claimed += n; messages++; }
      } catch (err) {
        logger.error(`[reminders] ${kind} could not be sent:`, err);
      }
    }
  }
  return { claimed, messages, off: false };
}

/**
 * The due targets not yet reminded: a target whose claim for this day of its date exists, or which
 * was already reminded today about that date (a rule changed during the day), is left out before
 * anything is locked, so a reminder already sent costs nothing on the minutes after it (the review
 * of 5c2f2bf, items 4 and 5). The unique indexes on the claims stay the guard; this only spares the
 * work.
 */
async function notClaimed(kind: ReminderKind, due: Due[], now: Date): Promise<Due[]> {
  if (!due.length) return due;
  const today = anchorDay(now);
  const taken = new Set<string>();
  for (let i = 0; i < due.length; i += 1000) {
    const chunk = due.slice(i, i + 1000);
    const rows = (await db.execute(sql`
      select target_kind, target_id, anchor_on::text as anchor_on, offset_days, sent_on::text as sent_on from reminder_sent
      where kind = ${kind} and target_id in (${ids([...new Set(chunk.map((d) => d.targetId))])})`)).rows as { target_kind: string; target_id: string; anchor_on: string; offset_days: number; sent_on: string }[];
    for (const r of rows) {
      taken.add(`${r.target_kind}|${r.target_id}|${r.anchor_on}|o${r.offset_days}`);
      if (r.sent_on === today) taken.add(`${r.target_kind}|${r.target_id}|${r.anchor_on}|today`);
    }
  }
  return due.filter((d) => {
    const key = `${d.targetKind}|${d.targetId}|${anchorDay(d.anchor)}`;
    return !taken.has(`${key}|o${d.offset}`) && !taken.has(`${key}|today`);
  });
}

type Live = { item: Due; amount: number; label: string; dueAt: Date; sessionName: string | null };

/**
 * Lock the group's targets (`FOR SHARE`, in id order), then read them again in a statement of its
 * own — under READ COMMITTED each statement sees what committed before it began, so a payment or
 * an answer that held the row and committed while the lock waited is seen: only what is still owed
 * (no payment open on it), unverified or ahead is reminded. Returns what each live target
 * contributes.
 */
async function lockShare(tx: Tx, table: 'registration' | 'charge', ids: string[]) {
  if (!ids.length) return;
  await tx.execute(sql`select id from ${sql.raw(table)} where id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) order by id for share`);
}

async function lockAndRecheck(tx: Tx, kind: ReminderKind, items: Due[], now: Date, payOnProvisional: boolean): Promise<Live[]> {
  const ids = (k: TargetKind) => items.filter((i) => i.targetKind === k).map((i) => i.targetId).sort();
  const live: Live[] = [];
  const lineIds = ids('line');
  // The sessions first (A's order, RESERVATIONS.md §2.1: the session before its lines). The claims'
  // session foreign key takes FOR KEY SHARE on each session; taken here, before the lines, it never
  // waits behind an admin's session change (updateSession, correctSessionSeries: the session
  // FOR UPDATE, then its lines) while holding the lines that change wants — the deadlock of the
  // review of 5c2f2bf, item 3.
  const sessionIds = [...new Set(items.map((i) => i.sessionId).filter((x): x is string => !!x))].sort();
  if (sessionIds.length) {
    await tx.execute(sql`select id from registration_session where id in (${sql.join(sessionIds.map((x) => sql`${x}`), sql`, `)}) order by id for key share`);
  }
  await lockShare(tx, 'registration', [...new Set([...lineIds, ...ids('verification')])].sort());
  await lockShare(tx, 'charge', ids('charge'));
  if (lineIds.length) {
    const rows = (await tx.execute(sql`
      select r.id, r.price_at_registration as price, s.name as subject, i.label, i.kind as "itemKind", rs.name as "sessionName", r.due_at
      from registration r join subject s on s.id = r.subject_id join session_offer_item i on i.id = r.offer_item_id
      join registration_session rs on rs.id = r.session_id
      where r.id in (${sql.join(lineIds.map((x) => sql`${x}`), sql`, `)})
        and ${linePayableNowSql(now, payOnProvisional)}
      order by r.id`)).rows as Record<string, unknown>[];
    for (const r of rows) {
      const item = items.find((i) => i.targetKind === 'line' && i.targetId === r.id)!;
      // The due date it was found with: a line re-dated meanwhile is reminded on its new day, not now.
      if (asDate(r.due_at).getTime() !== item.anchor.getTime()) continue;
      live.push({ item, amount: Number(r.price), label: r.itemKind === 'whole' ? (r.subject as string) : `${r.subject as string} — ${r.label as string}`, dueAt: item.anchor, sessionName: r.sessionName as string });
    }
  }
  const chargeIds = ids('charge');
  if (chargeIds.length) {
    const rows = (await tx.execute(sql`
      select c.id, c.amount, c.description, c.due_at, rs.name as "sessionName" from charge c
      left join registration r on r.id = c.registration_id left join registration_session rs on rs.id = r.session_id
      where c.id in (${sql.join(chargeIds.map((x) => sql`${x}`), sql`, `)}) and ${chargeOpenSql}
      order by c.id`)).rows as Record<string, unknown>[];
    for (const c of rows) {
      const item = items.find((i) => i.targetKind === 'charge' && i.targetId === c.id)!;
      if (asDate(c.due_at).getTime() !== item.anchor.getTime()) continue;
      if (!(await chargePayableNow(tx, c.id as string, now))) continue;
      live.push({ item, amount: Number(c.amount), label: c.description as string, dueAt: item.anchor, sessionName: (c.sessionName as string | null) ?? null });
    }
  }
  const verifyIds = ids('verification');
  if (verifyIds.length) {
    const rows = (await tx.execute(sql`select r.id from registration r where r.id in (${sql.join(verifyIds.map((x) => sql`${x}`), sql`, `)})
      and r.prior_sitting_verified_outcome is null and r.status in ('pending_approval', 'pending_payment', 'preregistered', 'confirmed')
      order by r.id`)).rows as { id: string }[];
    for (const r of rows) {
      const item = items.find((i) => i.targetKind === 'verification' && i.targetId === r.id)!;
      live.push({ item, amount: 0, label: '', dueAt: item.anchor, sessionName: null });
    }
  }
  for (const item of items.filter((i) => i.targetKind === 'session')) {
    const [s] = (await tx.execute(sql`select status, end_date from registration_session where id = ${item.targetId}`)).rows as { status: string; end_date: unknown }[];
    if (s?.status === 'active' && asDate(s.end_date) > now) live.push({ item, amount: 0, label: '', dueAt: item.anchor, sessionName: null });
  }
  for (const item of items.filter((i) => i.targetKind === 'series_entry' || i.targetKind === 'series_retake')) {
    if (item.anchor > now) live.push({ item, amount: 0, label: '', dueAt: item.anchor, sessionName: null });
  }
  return live;
}

/** The people a staff reminder goes to. */
async function staff(tx: Tx, roles: string[]) {
  return (await broadcastMembers(tx, 'staff', null)).filter((m) => roles.includes(m.role));
}

/**
 * One reminder message for a group of due targets, in one transaction: the sessions, then the
 * targets locked and read again, the message, the claims (`ON CONFLICT DO NOTHING` on either unique
 * index: what another scheduler claimed first, or a target already reminded today about that date,
 * is skipped; nothing claimed → nothing written), the notifications and deliveries, the audit row.
 */
async function sendGroup(kind: ReminderKind, items: Due[], now: Date, payOnProvisional: boolean): Promise<number> {
  const rule = items[0]!.rule;
  const templateId = items[0]!.templateId;
  try {
    return await db.transaction(async (tx) => {
      const live = await lockAndRecheck(tx, kind, items, now, payOnProvisional);
      if (!live.length) throw new NothingClaimed();
      const [t] = await tx.select().from(messageTemplate).where(eq(messageTemplate.id, templateId));
      if (!t) throw new Error(`reminder template ${templateId} not found`);
      const texts: MessageTexts = { titleEn: t.titleEn, bodyEn: t.bodyEn, titleAr: t.titleAr, bodyAr: t.bodyAr };
      const offsets = [...new Set(live.map((l) => l.item.offset))].sort((a, b) => a - b);
      const audienceId = randomUUID();
      const messageId = randomUUID();
      await tx.insert(messageAudience).values({
        id: audienceId, kind: 'batch', definition: { kind: 'batch', list: 'reminder', reminderKind: kind, ruleId: rule.id, offsets, targets: live.length },
      });
      const msg = { id: messageId, channels: rule.channels, notificationType: NOTIFICATION_TYPE[kind], language: 'both' };
      await tx.insert(message).values({
        ...msg, audienceId, templateId, context: { reminderKind: kind, dueAt: now.toISOString() }, source: 'reminder', reminderRuleId: rule.id, status: 'sent', sentAt: new Date(),
      });
      const claims = await tx.insert(reminderSent).values(live.map((l) => ({
        id: randomUUID(), ruleId: rule.id, kind, targetKind: l.item.targetKind, targetId: l.item.targetId, anchorOn: anchorDay(l.item.anchor),
        offsetDays: l.item.offset, studentId: l.item.studentId, sessionId: l.item.sessionId, messageId, sentOn: anchorDay(now),
      // Either unique index: the same day of the date claimed, or a reminder about that date already today.
      }))).onConflictDoNothing()
        .returning({ targetKind: reminderSent.targetKind, targetId: reminderSent.targetId });
      if (!claims.length) throw new NothingClaimed();
      const won = live.filter((l) => claims.some((c) => c.targetKind === l.item.targetKind && c.targetId === l.item.targetId));
      const targets = await targetsOf(tx, kind, won);
      const d = await deliverInTx(tx, msg, texts, { session: null }, targets, now);
      await tx.update(message).set({ recipientCount: d.people }).where(eq(message.id, messageId));
      await tx.update(messageAudience).set({ resolvedCount: d.people, resolvedAt: new Date() }).where(eq(messageAudience.id, audienceId));
      await logAction(null, 'REMINDERS_SENT', 'message', messageId, null, {
        kind, ruleId: rule.id, sessionId: rule.sessionId, offsets, claimed: won.length,
        targets: won.map((w) => `${w.item.targetKind}:${w.item.targetId}:${w.item.offset}`), people: d.people, deliveries: d.deliveries,
      }, undefined, tx);
      return won.length;
    });
  } catch (err) {
    if (err instanceof NothingClaimed) return 0;
    throw err;
  }
}

/** Who each claimed reminder goes to, with the values its text needs. */
async function targetsOf(tx: Tx, kind: ReminderKind, won: Live[]): Promise<DeliveryTarget[]> {
  if (kind === 'payment_due' || kind === 'school_fee_due') {
    const owed = new Map<string, Owed | null>();
    for (const l of won) {
      const sid = l.item.studentId!;
      const o = owed.get(sid) ?? { amount: 0, dueAt: l.dueAt, items: [], sessionId: l.item.sessionId, sessionName: l.sessionName, lineIds: [], chargeIds: [] };
      o.amount = Math.round((o.amount + l.amount) * 100) / 100;
      if (l.dueAt < o.dueAt) o.dueAt = l.dueAt;
      if (!o.items.includes(l.label)) o.items.push(l.label);
      if (!o.sessionName && l.sessionName) o.sessionName = l.sessionName;
      owed.set(sid, o);
    }
    return (await familyMembers(tx, owed, 'families', true)).map((member) => ({ member }));
  }
  if (kind === 'session_closing') {
    const sessionId = won[0]!.item.targetId;
    const [s] = await tx.select({ name: registrationSession.name, endDate: registrationSession.endDate }).from(registrationSession).where(eq(registrationSession.id, sessionId));
    // Every active student and every parent, as the 24-hour reminder (NOT-002) reached them.
    const people = [...(await broadcastMembers(tx, 'students', null)), ...(await broadcastMembers(tx, 'parents', null))];
    const extra = { en: { session: s!.name, closes: messageDate(s!.endDate, 'en') }, ar: { session: s!.name, closes: messageDate(s!.endDate, 'ar') } };
    return people.map((member) => ({ member, extra }));
  }
  if (kind === 'entry_deadline') {
    const l = won[0]!;
    const [s] = (await tx.execute(sql`select bs.month, bs.year, bs.label, b.name as "boardName",
        (select count(*)::int from registration r where r.board_series_id = bs.id and ${WAITING_LINE} and ${DEADLINE} = ${l.item.anchor}) as waiting
      from board_series bs left join exam_board b on b.code = bs.board_code where bs.id = ${l.item.targetId}`)).rows as { month: string; year: number; label: string | null; boardName: string | null; waiting: number }[];
    const series = formatSeriesName({ boardName: s!.boardName, month: s!.month, year: Number(s!.year), label: s!.label });
    const count = String(s!.waiting);
    const extra = { en: { series, count, closes: messageDate(l.item.anchor, 'en') }, ar: { series, count, closes: messageDate(l.item.anchor, 'ar') } };
    return (await staff(tx, [ROLES.ADMIN, ROLES.COORDINATOR, ROLES.FINANCE_ADMIN, ROLES.FINANCE_OFFICER])).map((member) => ({ member, extra }));
  }
  // declared_retakes_to_verify: the coordinators (the admin when there is none), once per session.
  const sessionId = won[0]!.item.sessionId!;
  const [s] = await tx.select({ name: registrationSession.name }).from(registrationSession).where(eq(registrationSession.id, sessionId));
  const [counted] = (await tx.execute(sql`select count(*)::int as n from registration r where r.session_id = ${sessionId}
    and r.prior_sitting_source in ('declared_by_family', 'declared_by_desk') and r.prior_sitting_verified_outcome is null
    and r.status in ('pending_approval', 'pending_payment', 'preregistered', 'confirmed')`)).rows as { n: number }[];
  const n = counted?.n ?? won.length;
  const first = won.map((w) => w.item.anchor).sort((a, b) => a.getTime() - b.getTime())[0]!;
  const extra = { en: { session: s!.name, count: String(n), closes: messageDate(first, 'en') }, ar: { session: s!.name, count: String(n), closes: messageDate(first, 'ar') } };
  let people: AudienceMember[] = await staff(tx, [ROLES.COORDINATOR]);
  if (!people.length) people = await staff(tx, [ROLES.ADMIN]);
  return people.map((member) => ({ member, extra }));
}

// ─── The rules screen ────────────────────────────────────────────────────────

export async function listRules() {
  const rows = await db.select({
    id: reminderRule.id, kind: reminderRule.kind, sessionId: reminderRule.sessionId, sessionName: registrationSession.name, offsetsDays: reminderRule.offsetsDays,
    repeatEveryDays: reminderRule.repeatEveryDays, until: reminderRule.until, channels: reminderRule.channels, templateId: reminderRule.templateId,
    overdueTemplateId: reminderRule.overdueTemplateId, active: reminderRule.active, inheritsAt: reminderRule.inheritsAt, updatedAt: reminderRule.updatedAt,
    updatedByName: user.name,
  }).from(reminderRule)
    .leftJoin(registrationSession, eq(registrationSession.id, reminderRule.sessionId))
    .leftJoin(user, eq(user.id, reminderRule.updatedBy))
    .orderBy(asc(reminderRule.kind), asc(sql`${reminderRule.sessionId} is not null`), asc(registrationSession.name));
  const settings = { enabled: await getSetting('reminders.enabled'), sendAtHour: await getSetting('reminders.sendAtHour') };
  return { rules: rows.filter((r) => !r.inheritsAt), settings };
}

/**
 * Set a rule (PUT /v1/reminders/rules): the one for every session, or a session's own — created,
 * changed, or dropped (`inherit`) so the session follows the rule for every session again. The
 * rule row is locked before it is read, and the change audited in its transaction.
 */
export async function putRule(input: PutReminderRuleType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    // The texts FOR SHARE, so a text being switched off (updateTemplate, FOR UPDATE) and a rule set to send it serialise.
    const templates = await tx.select({ id: messageTemplate.id, active: messageTemplate.active, name: messageTemplate.name }).from(messageTemplate)
      .where(inArray(messageTemplate.id, [input.templateId, ...(input.overdueTemplateId ? [input.overdueTemplateId] : [])]))
      .orderBy(messageTemplate.id).for('share');
    for (const id of [input.templateId, input.overdueTemplateId].filter((x): x is string => !!x)) {
      const t = templates.find((x) => x.id === id);
      if (!t) throw new MessageError('Template not found', 404);
      if (!t.active && input.active) throw new MessageError(`The template "${t.name}" is switched off: switch it on in Templates first`, 409);
    }
    if (input.sessionId) {
      const [s] = await tx.select({ id: registrationSession.id }).from(registrationSession).where(eq(registrationSession.id, input.sessionId)).for('share');
      if (!s) throw new MessageError('Session not found', 404);
    }
    const [before] = await tx.select().from(reminderRule)
      .where(and(eq(reminderRule.kind, input.kind), input.sessionId ? eq(reminderRule.sessionId, input.sessionId) : isNull(reminderRule.sessionId))).for('update');
    const now = new Date();
    const fields = {
      offsetsDays: [...input.offsetsDays].sort((a, b) => a - b), repeatEveryDays: input.repeatEveryDays, until: REMINDER_KIND_UNTIL[input.kind],
      channels: input.channels, templateId: input.templateId, overdueTemplateId: input.overdueTemplateId ?? null, active: input.active, updatedBy: actorId,
    };
    const was = before ? {
      offsetsDays: before.offsetsDays, repeatEveryDays: before.repeatEveryDays, channels: before.channels, templateId: before.templateId,
      overdueTemplateId: before.overdueTemplateId, active: before.active, inherits: !!before.inheritsAt,
    } : null;
    if (input.inherit) {
      if (!before || before.inheritsAt) throw new MessageError('This session has no rule of its own for this reminder', 404);
      await tx.update(reminderRule).set({ inheritsAt: now, updatedBy: actorId }).where(eq(reminderRule.id, before.id));
      await logAction(actorId, 'REMINDER_RULE_SET', 'reminder_rule', before.id, was, { inherits: true, reason: input.reason }, ctx, tx);
      return { id: before.id, inherits: true };
    }
    let id: string;
    if (before) {
      id = before.id;
      await tx.update(reminderRule).set({ ...fields, inheritsAt: null }).where(eq(reminderRule.id, id));
    } else {
      id = randomUUID();
      try {
        await tx.insert(reminderRule).values({ id, kind: input.kind, sessionId: input.sessionId, ...fields, createdBy: actorId });
      } catch (err) {
        if ((err as { cause?: { code?: string } }).cause?.code === '23505' || (err as { code?: string }).code === '23505') {
          throw new MessageError('This rule was just set by someone else: open it again', 409);
        }
        throw err;
      }
    }
    await logAction(actorId, 'REMINDER_RULE_SET', 'reminder_rule', id, was, { kind: input.kind, sessionId: input.sessionId, ...fields, reason: input.reason }, ctx, tx);
    return { id, inherits: false };
  });
}

/** What went out (GET /v1/reminders/sent): one row per reminder message, with what it was about and how it was delivered. */
export async function listSent(q: { kind?: ReminderKind; sessionId?: string; limit: number }) {
  const rows = (await db.execute(sql`
    select rs.message_id as "messageId", rs.kind, min(rs.sent_at) as "sentAt", array_agg(distinct rs.offset_days order by rs.offset_days) as offsets,
      count(*)::int as targets, count(distinct rs.student_id)::int as students, m.recipient_count as people, rr.session_id as "ruleSessionId",
      s.name as "ruleSessionName", max(rs.session_id) filter (where rs.session_id is not null) as "aSessionId"
    from reminder_sent rs
    join message m on m.id = rs.message_id
    join reminder_rule rr on rr.id = rs.rule_id
    left join registration_session s on s.id = rr.session_id
    where true ${q.kind ? sql`and rs.kind = ${q.kind}` : sql``} ${q.sessionId ? sql`and rs.session_id = ${q.sessionId}` : sql``}
    group by rs.message_id, rs.kind, m.recipient_count, rr.session_id, s.name
    order by min(rs.sent_at) desc
    limit ${q.limit}`)).rows as Record<string, unknown>[];
  const ids = rows.map((r) => r.messageId as string);
  const counts = ids.length ? (await db.execute(sql`select message_id as "messageId", channel, status, count(*)::int as n from message_delivery
    where message_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) group by message_id, channel, status`)).rows as { messageId: string; channel: string; status: string; n: number }[] : [];
  return rows.map((r) => {
    const mine = counts.filter((c) => c.messageId === r.messageId);
    const of = (channel: string, status: string) => mine.filter((c) => c.channel === channel && (status === 'waiting' ? c.status === 'queued' || c.status === 'sending' : c.status === status)).reduce((s, c) => s + c.n, 0);
    return {
      messageId: r.messageId as string, kind: r.kind as ReminderKind, sentAt: asDate(r.sentAt), offsets: (r.offsets as number[]).map(Number),
      targets: Number(r.targets), students: Number(r.students), people: r.people == null ? null : Number(r.people),
      rule: { sessionId: (r.ruleSessionId as string | null) ?? null, sessionName: (r.ruleSessionName as string | null) ?? null },
      deliveries: {
        in_app: { sent: of('in_app', 'sent'), failed: of('in_app', 'failed'), waiting: of('in_app', 'waiting') },
        email: { sent: of('email', 'sent'), failed: of('email', 'failed'), waiting: of('email', 'waiting') },
      },
    };
  });
}
