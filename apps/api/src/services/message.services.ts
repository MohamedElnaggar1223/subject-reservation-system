/**
 * Messages (RESERVATIONS_REWORK.md §3.8, §4.8; docs/features/RESERVATIONS_MESSAGES.md §3).
 *
 * A message is sent in one transaction: its audience (a copy, never edited after), the message
 * row, a `notification` row for each in-app recipient (the notification centre families keep —
 * they mark read, nobody deletes), one `message_delivery` row per recipient and channel, and its
 * audit row (`logAction(..., tx)`). An email delivery is written `queued` there and sent after the
 * commit by `dispatchQueuedEmails`, which claims each one first (`queued` → `sending`, a
 * status-guarded update), so a second sender never sends it twice and a failure on one recipient
 * is recorded on its delivery and does not stop the rest. A scheduled message is sent by the
 * scheduler's tick at its time, claimed by its row lock (`FOR UPDATE SKIP LOCKED`, its status read
 * again under the lock), never before.
 */

import { randomUUID } from 'crypto';
import {
  db, sql, message, messageAudience, messageDelivery, messageTemplate, notification, user, reminderRule,
  eq, and, lte, inArray, desc, asc,
} from '@repo/db';
import {
  AudienceDefinition, MONEY_LISTS, ROLES, CHARGE_KINDS, CHARGE_KIND_LABELS, variablesIn, renderMessage, messageDate, messageAmount, messageList,
  MESSAGE_VARIABLE_LABELS, REMINDER_KIND_LABELS, academicYearStartOf,
  type AudienceDefinitionType, type CreateMessageType, type MessageTexts, type MessageVars, type MessageVariable, type MessageLanguage,
  type MessageLanguageChoice, type NotificationType, type SaveTemplateType, type BatchList, type ReminderKind,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { sendMessageEmail } from '../integrations/email';
import { clientMessage } from '../lib/response';
import {
  resolveAudience, assertMayUseAudience, mayUseAudience, audienceLabel, AudienceError,
  type AudienceMember, type ResolvedAudience, type Viewer,
} from './message-audience.services';
import { getTeachingDemand } from './enrolment.services';
import { payableAcademicYears } from './school-fee.services';
import { logger } from '../lib/logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class MessageError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409 = 400) {
    super(message);
    this.name = 'MessageError';
  }
}

/** Errors a route turns into a response with their sentence. */
export const isMessageError = (e: unknown): e is MessageError | AudienceError => e instanceof MessageError || e instanceof AudienceError;

// ─── Rendering ───────────────────────────────────────────────────────────────

/** Extra values a reminder adds for one recipient ({series}, {count}, a deadline as {closes}). */
export type ExtraVars = { en: MessageVars; ar: MessageVars };

/** One recipient's variables in one language. */
export function varsFor(m: AudienceMember, resolved: Pick<ResolvedAudience, 'session'>, lang: MessageLanguage): MessageVars {
  const v: MessageVars = {
    guardian: m.role === 'parent' ? m.name : messageList(m.guardians, lang),
    student: messageList(m.studentNames, lang),
  };
  const sessionName = resolved.session?.name ?? m.owed?.sessionName ?? null;
  if (sessionName) v.session = sessionName;
  if (resolved.session) v.closes = messageDate(resolved.session.endDate, lang);
  if (m.owed) {
    v.amount = messageAmount(m.owed.amount, lang);
    v.due = messageDate(m.owed.dueAt, lang);
    v.items = messageList(m.owed.items, lang);
  }
  return v;
}

/** The variables a text uses that this audience cannot give every recipient: refused before anything is sent. */
export function assertFillable(texts: MessageTexts, fills: MessageVariable[]) {
  const missing = variablesIn(texts.titleEn, texts.bodyEn, texts.titleAr, texts.bodyAr).filter((v) => !fills.includes(v));
  if (missing.length) {
    throw new MessageError(`This audience cannot fill ${missing.map((v) => `{${v}}` + ` (${MESSAGE_VARIABLE_LABELS[v]})`).join(', ')}: choose a list that has it, name a session, or take it out of the text`);
  }
}

async function textsOf(executor: Executor, m: { templateId: string | null; title: string | null; body: string | null; titleAr: string | null; bodyAr: string | null }): Promise<MessageTexts> {
  if (m.templateId) {
    const [t] = await executor.select().from(messageTemplate).where(eq(messageTemplate.id, m.templateId));
    if (!t) throw new MessageError('Template not found', 404);
    return { titleEn: t.titleEn, bodyEn: t.bodyEn, titleAr: t.titleAr, bodyAr: t.bodyAr };
  }
  return { titleEn: m.title ?? '', bodyEn: m.body ?? '', titleAr: m.titleAr, bodyAr: m.bodyAr };
}

// ─── Delivering, in the sender's transaction ─────────────────────────────────

export type DeliveryTarget = { member: AudienceMember; extra?: ExtraVars };

/**
 * Write one message's notifications and deliveries in the caller's transaction: per recipient
 * (and child, for a list about each child), the text rendered with its variables; an in-app
 * delivery is `sent` with its notification row, an email delivery `queued` for the sender after
 * the commit. Returns how many people and deliveries.
 */
export async function deliverInTx(
  tx: Tx,
  msg: { id: string; channels: string[]; notificationType: string; language: string },
  texts: MessageTexts,
  resolved: Pick<ResolvedAudience, 'session'>,
  targets: DeliveryTarget[],
  now: Date,
) {
  const seen = new Set<string>();
  const notifications: (typeof notification.$inferInsert)[] = [];
  const deliveries: (typeof messageDelivery.$inferInsert)[] = [];
  for (const { member: m, extra } of targets) {
    const key = `${m.recipientId}|${m.about ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const vars = { en: { ...varsFor(m, resolved, 'en'), ...extra?.en }, ar: { ...varsFor(m, resolved, 'ar'), ...extra?.ar } };
    const r = renderMessage(texts, msg.language as MessageLanguageChoice, vars);
    for (const channel of msg.channels) {
      if (channel === 'in_app') {
        const notificationId = randomUUID();
        notifications.push({
          id: notificationId, userId: m.recipientId, type: msg.notificationType, title: r.title, body: r.body,
          data: { messageId: msg.id, ...(m.about ? { studentId: m.about } : {}) },
        });
        deliveries.push({ id: randomUUID(), messageId: msg.id, recipientId: m.recipientId, studentId: m.about, channel, status: 'sent', title: r.title, body: r.body, notificationId, attempts: 1, sentAt: new Date() });
      } else if (channel === 'email') {
        deliveries.push({ id: randomUUID(), messageId: msg.id, recipientId: m.recipientId, studentId: m.about, channel, status: 'queued', title: r.title, body: r.body, address: m.email });
      }
    }
  }
  for (let i = 0; i < notifications.length; i += 500) await tx.insert(notification).values(notifications.slice(i, i + 500));
  for (let i = 0; i < deliveries.length; i += 500) await tx.insert(messageDelivery).values(deliveries.slice(i, i + 500));
  return { people: new Set(targets.map((t) => t.member.recipientId)).size, deliveries: deliveries.length, inApp: notifications.length };
}

/** The notification type a staff message's in-app rows carry: a broadcast as before, a money list as a reminder, else a message. */
function notificationTypeOf(def: AudienceDefinitionType): NotificationType {
  if (def.kind === 'broadcast') return 'BULK_ANNOUNCEMENT';
  if (def.kind === 'batch' && MONEY_LISTS.includes(def.list as BatchList)) return 'PAYMENT_REMINDER';
  return 'SCHOOL_MESSAGE';
}

// ─── Sending ─────────────────────────────────────────────────────────────────

async function audienceOf(executor: Executor, input: CreateMessageType['audience']): Promise<{ def: AudienceDefinitionType; savedId: string | null }> {
  if ('savedId' in input) {
    const [a] = await executor.select().from(messageAudience).where(and(eq(messageAudience.id, input.savedId), eq(messageAudience.saved, true)));
    if (!a) throw new MessageError('Saved audience not found', 404);
    const parsed = AudienceDefinition.safeParse(a.definition);
    if (!parsed.success) throw new MessageError('This saved audience can no longer be resolved', 409);
    return { def: parsed.data, savedId: a.id };
  }
  return { def: input.definition, savedId: null };
}

async function templateTexts(executor: Executor, input: CreateMessageType) {
  if (!input.templateId) return { titleEn: input.title!, bodyEn: input.body!, titleAr: input.titleAr ?? null, bodyAr: input.bodyAr ?? null };
  const [t] = await executor.select().from(messageTemplate).where(eq(messageTemplate.id, input.templateId));
  if (!t) throw new MessageError('Template not found', 404);
  if (!t.active) throw new MessageError(`The template "${t.name}" is switched off: switch it on in Templates, or write the text`, 409);
  return { titleEn: t.titleEn, bodyEn: t.bodyEn, titleAr: t.titleAr, bodyAr: t.bodyAr };
}

/**
 * Send a message now, or schedule it (POST /v1/messages). The audience is resolved now — for the
 * count and to check that every variable the text uses can be given to every recipient — and,
 * when scheduled, again at its time.
 */
export async function createMessage(input: CreateMessageType, viewer: Viewer, ctx?: AuditContext) {
  const { def, savedId } = await audienceOf(db, input.audience);
  assertMayUseAudience(viewer, def);
  const texts = await templateTexts(db, input);
  const now = new Date();
  const scheduled = !!input.scheduledAt && input.scheduledAt > now;
  const context = { sessionId: input.context?.sessionId ?? null };
  const resolved = await resolveAudience(def, context, db, now);
  assertFillable(texts, resolved.fills);
  if (!scheduled && resolved.members.length === 0) throw new MessageError('Nobody is in this audience now: there is nothing to send', 409);
  const notificationType = notificationTypeOf(def);
  const out = await db.transaction(async (tx) => {
    const audienceId = randomUUID();
    await tx.insert(messageAudience).values({
      id: audienceId, kind: def.kind, definition: def as unknown as Record<string, unknown>, resolvedCount: new Set(resolved.members.map((m) => m.recipientId)).size,
      resolvedAt: now, createdBy: viewer.id, legacy: savedId ? { fromSaved: savedId } : null,
    });
    if (input.saveAudienceAs) {
      const savedNew = randomUUID();
      const clash = await tx.execute(sql`select 1 from message_audience where saved and lower(name) = lower(${input.saveAudienceAs}) for update`);
      if (clash.rows.length) throw new MessageError(`A saved audience is already called "${input.saveAudienceAs}"`, 409);
      await tx.insert(messageAudience).values({ id: savedNew, kind: def.kind, definition: def as unknown as Record<string, unknown>, name: input.saveAudienceAs, saved: true, createdBy: viewer.id });
      await logAction(viewer.id, 'MESSAGE_AUDIENCE_SAVED', 'message_audience', savedNew, null, { name: input.saveAudienceAs, definition: def }, ctx, tx);
    }
    const id = randomUUID();
    const row = {
      id, audienceId, templateId: input.templateId ?? null,
      title: input.templateId ? null : input.title ?? null, body: input.templateId ? null : input.body ?? null,
      titleAr: input.templateId ? null : input.titleAr ?? null, bodyAr: input.templateId ? null : input.bodyAr ?? null,
      language: input.language, channels: input.channels, context, notificationType, source: 'staff',
      status: scheduled ? 'scheduled' : 'sent', scheduledAt: scheduled ? input.scheduledAt! : null, sentAt: scheduled ? null : now,
      createdBy: viewer.id,
    } as const;
    await tx.insert(message).values(row);
    const label = resolved.label;
    if (scheduled) {
      await logAction(viewer.id, 'MESSAGE_SCHEDULED', 'message', id, null, { audience: label, scheduledAt: input.scheduledAt!.toISOString(), channels: input.channels, recipientsNow: resolved.members.length }, ctx, tx);
      return { id, status: 'scheduled' as const, scheduledAt: input.scheduledAt!, people: new Set(resolved.members.map((m) => m.recipientId)).size, deliveries: 0 };
    }
    const d = await deliverInTx(tx, row, texts, resolved, resolved.members.map((member) => ({ member })), now);
    await tx.update(message).set({ recipientCount: d.people }).where(eq(message.id, id));
    await logAction(viewer.id, 'MESSAGE_SENT', 'message', id, null, { audience: label, channels: input.channels, people: d.people, deliveries: d.deliveries }, ctx, tx);
    return { id, status: 'sent' as const, scheduledAt: null, people: d.people, deliveries: d.deliveries };
  });
  if (out.status === 'sent' && input.channels.includes('email')) {
    void dispatchQueuedEmails({ messageId: out.id }).catch((err) => logger.error('[messages] email dispatch failed:', err));
  }
  return out;
}

/** Cancel a scheduled message before its time (the row locked; a message already sent says so). */
export async function cancelMessage(id: string, viewer: Viewer, reason: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(message).where(eq(message.id, id)).for('update');
    if (!m) throw new MessageError('Message not found', 404);
    const [a] = await tx.select().from(messageAudience).where(eq(messageAudience.id, m.audienceId));
    const def = AudienceDefinition.safeParse(a?.definition);
    if (!def.success || !mayUseAudience(viewer, def.data)) throw new MessageError('Only the admin may cancel this message', 403);
    if (m.status !== 'scheduled') throw new MessageError(`This message was already ${m.status}: only a scheduled message can be cancelled`, 409);
    const now = new Date();
    await tx.update(message).set({ status: 'cancelled', cancelledAt: now, cancelledBy: viewer.id, cancelReason: reason }).where(eq(message.id, id));
    await logAction(viewer.id, 'MESSAGE_CANCELLED', 'message', id, { status: 'scheduled', scheduledAt: m.scheduledAt?.toISOString() ?? null }, { status: 'cancelled', reason }, ctx, tx);
    return { id, status: 'cancelled' as const };
  });
}

/**
 * The scheduler's step: every scheduled message whose time has come, each claimed by its row lock
 * (`FOR UPDATE SKIP LOCKED`; its status read again under it) and sent in that transaction — a
 * second scheduler finds it locked or sent. One that cannot be sent is marked failed, with why.
 */
export async function dispatchScheduledMessages(now: Date = new Date()) {
  const due = await db.select({ id: message.id }).from(message)
    .where(and(eq(message.status, 'scheduled'), lte(message.scheduledAt, now))).orderBy(asc(message.scheduledAt));
  let sent = 0;
  for (const { id } of due) {
    try {
      const done = await db.transaction(async (tx) => {
        const [m] = await tx.select().from(message).where(and(eq(message.id, id), eq(message.status, 'scheduled'))).for('update', { skipLocked: true });
        if (!m || !m.scheduledAt || m.scheduledAt > now) return false;
        const [a] = await tx.select().from(messageAudience).where(eq(messageAudience.id, m.audienceId));
        const def = AudienceDefinition.parse(a!.definition);
        const texts = await textsOf(tx, m);
        const ctxSession = (m.context as { sessionId?: string | null } | null)?.sessionId ?? null;
        const resolved = await resolveAudience(def, { sessionId: ctxSession }, tx, now);
        assertFillable(texts, resolved.fills);
        const d = await deliverInTx(tx, m, texts, resolved, resolved.members.map((member) => ({ member })), now);
        await tx.update(message).set({ status: 'sent', sentAt: new Date(), recipientCount: d.people }).where(eq(message.id, id));
        await tx.update(messageAudience).set({ resolvedCount: d.people, resolvedAt: new Date() }).where(eq(messageAudience.id, m.audienceId));
        await logAction(null, 'MESSAGE_SENT', 'message', id, { status: 'scheduled', scheduledAt: m.scheduledAt.toISOString() },
          { status: 'sent', audience: resolved.label, people: d.people, deliveries: d.deliveries, dispatchedBy: 'scheduler' }, undefined, tx);
        return true;
      });
      if (done) sent++;
    } catch (err) {
      logger.error(`[messages] scheduled message ${id} could not be sent:`, err);
      const why = isMessageError(err) ? err.message : clientMessage(err, 'The message could not be sent');
      await db.transaction(async (tx) => {
        const [m] = await tx.update(message).set({ status: 'failed', error: why.slice(0, 500) })
          .where(and(eq(message.id, id), eq(message.status, 'scheduled'))).returning({ id: message.id });
        if (m) await logAction(null, 'MESSAGE_FAILED', 'message', id, { status: 'scheduled' }, { status: 'failed', error: why }, undefined, tx);
      }).catch((e) => logger.error(`[messages] could not mark ${id} failed:`, e));
    }
  }
  return { sent };
}

// ─── Email ───────────────────────────────────────────────────────────────────

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const NO_VALID_ADDRESS = 'The email address on file is not a valid address';
const INTERRUPTED = 'Interrupted while sending: it may or may not have reached the person, and it is not sent again';

/**
 * Send the email deliveries waiting (of one message, or every one): each claimed first
 * (`queued` → `sending`, status-guarded), then sent, then recorded `sent` or `failed` with the
 * reason — one recipient's failure never stops the rest. A sent email marks its in-app twin's
 * notification `email_sent_at`, as the notification centre has always recorded it.
 */
export async function dispatchQueuedEmails(opts: { messageId?: string; limit?: number } = {}) {
  const rows = await db.select({ id: messageDelivery.id }).from(messageDelivery)
    .where(and(eq(messageDelivery.channel, 'email'), eq(messageDelivery.status, 'queued'), opts.messageId ? eq(messageDelivery.messageId, opts.messageId) : undefined))
    .orderBy(asc(messageDelivery.createdAt)).limit(opts.limit ?? 500);
  let sent = 0;
  let failed = 0;
  for (const { id } of rows) {
    const [d] = await db.update(messageDelivery).set({ status: 'sending', attempts: sql`${messageDelivery.attempts} + 1`, updatedAt: new Date() })
      .where(and(eq(messageDelivery.id, id), eq(messageDelivery.status, 'queued'))).returning();
    if (!d) continue;
    let ok = false;
    let why: string | null = null;
    try {
      if (!d.address || !EMAIL_SHAPE.test(d.address)) why = NO_VALID_ADDRESS;
      else {
        const r = await sendMessageEmail(d.address, { title: d.title, body: d.body });
        ok = r.success;
        if (!ok) why = r.error ? `The email service refused it: ${r.error}`.slice(0, 500) : 'The email service refused it';
      }
    } catch (err) {
      why = clientMessage(err, 'The email could not be sent');
    }
    const at = new Date();
    await db.update(messageDelivery).set(ok ? { status: 'sent', sentAt: at, error: null, updatedAt: at } : { status: 'failed', error: why ?? 'The email could not be sent', updatedAt: at })
      .where(and(eq(messageDelivery.id, d.id), eq(messageDelivery.status, 'sending')));
    if (ok) {
      sent++;
      await db.execute(sql`update notification set email_sent_at = ${at} where id = (
        select notification_id from message_delivery where message_id = ${d.messageId} and recipient_id = ${d.recipientId} and channel = 'in_app'
          and coalesce(student_id, '') = coalesce(${d.studentId}, '') limit 1)`);
    } else failed++;
  }
  return { sent, failed };
}

/** An email claimed by a sender that stopped before it finished: failed, never sent again (ST-12). */
export async function recoverInterruptedEmails(now: Date = new Date()) {
  const r = await db.update(messageDelivery).set({ status: 'failed', error: INTERRUPTED, updatedAt: now })
    .where(and(eq(messageDelivery.status, 'sending'), lte(messageDelivery.updatedAt, new Date(now.getTime() - 15 * 60_000))))
    .returning({ id: messageDelivery.id });
  return r.length;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const PAYMENT_REMINDERS: ReminderKind[] = ['payment_due', 'school_fee_due'];

/** A message's audience as the log reads it, and whether the viewer may see the message. */
async function describeAudience(executor: Executor, a: { kind: string; definition: unknown; name: string | null }, viewer: Viewer, reminderKind: string | null) {
  if (reminderKind) {
    const def = a.definition as { offsets?: number[] };
    const days = (def.offsets ?? []).map((o) => (o === 0 ? 'the day' : o < 0 ? `${-o} days before` : `${o} days after`)).join(', ');
    return {
      label: `Reminder: ${REMINDER_KIND_LABELS[reminderKind as ReminderKind] ?? reminderKind}${days ? ` (${days})` : ''}`,
      visible: viewer.role === ROLES.ADMIN || (viewer.role !== null && PAYMENT_REMINDERS.includes(reminderKind as ReminderKind)),
    };
  }
  const parsed = AudienceDefinition.safeParse(a.definition);
  if (!parsed.success) return { label: a.name ?? 'An audience', visible: viewer.role === ROLES.ADMIN };
  return { label: await audienceLabel(executor, parsed.data), visible: mayUseAudience(viewer, parsed.data) };
}

/** The log (GET /v1/messages): the latest messages with their audience and their deliveries by channel and outcome. */
export async function listMessages(viewer: Viewer, q: { status?: string; source?: string; limit: number }) {
  const rows = await db.select({
    id: message.id, status: message.status, source: message.source, title: message.title, templateId: message.templateId, templateName: messageTemplate.name,
    templateTitle: messageTemplate.titleEn, channels: message.channels, scheduledAt: message.scheduledAt, sentAt: message.sentAt, createdAt: message.createdAt,
    recipientCount: message.recipientCount, error: message.error, cancelReason: message.cancelReason, language: message.language,
    audienceKind: messageAudience.kind, audienceDefinition: messageAudience.definition, audienceName: messageAudience.name, resolvedCount: messageAudience.resolvedCount,
    createdByName: user.name, reminderKind: reminderRule.kind,
  })
    .from(message)
    .innerJoin(messageAudience, eq(messageAudience.id, message.audienceId))
    .leftJoin(messageTemplate, eq(messageTemplate.id, message.templateId))
    .leftJoin(user, eq(user.id, message.createdBy))
    .leftJoin(reminderRule, eq(reminderRule.id, message.reminderRuleId))
    .where(and(q.status ? eq(message.status, q.status) : undefined, q.source ? eq(message.source, q.source) : undefined))
    .orderBy(desc(sql`coalesce(${message.sentAt}, ${message.scheduledAt}, ${message.createdAt})`))
    .limit(viewer.role === ROLES.ADMIN ? q.limit : q.limit * 4);
  const counts = rows.length ? await db.select({ messageId: messageDelivery.messageId, channel: messageDelivery.channel, status: messageDelivery.status, n: sql<number>`count(*)::int` })
    .from(messageDelivery).where(inArray(messageDelivery.messageId, rows.map((r) => r.id)))
    .groupBy(messageDelivery.messageId, messageDelivery.channel, messageDelivery.status) : [];
  const out = [];
  for (const r of rows) {
    const aud = await describeAudience(db, { kind: r.audienceKind, definition: r.audienceDefinition, name: r.audienceName }, viewer, r.reminderKind);
    if (!aud.visible) continue;
    const mine = counts.filter((c) => c.messageId === r.id);
    const of = (channel: string) => ({
      sent: mine.find((c) => c.channel === channel && c.status === 'sent')?.n ?? 0,
      failed: mine.find((c) => c.channel === channel && c.status === 'failed')?.n ?? 0,
      waiting: mine.filter((c) => c.channel === channel && (c.status === 'queued' || c.status === 'sending')).reduce((s, c) => s + c.n, 0),
    });
    out.push({
      id: r.id, status: r.status, source: r.source, title: r.title ?? r.templateName ?? r.templateTitle ?? '', templateName: r.templateName ?? null, channels: r.channels,
      scheduledAt: r.scheduledAt, sentAt: r.sentAt, createdAt: r.createdAt, people: r.recipientCount ?? r.resolvedCount ?? null, error: r.error, cancelReason: r.cancelReason,
      audience: { kind: r.audienceKind, label: aud.label }, createdBy: r.createdByName ?? null, reminderKind: r.reminderKind ?? null,
      deliveries: { in_app: of('in_app'), email: of('email') },
    });
    if (out.length >= q.limit) break;
  }
  return out;
}

/** One message's deliveries, per recipient and channel (GET /v1/messages/deliveries). */
export async function listDeliveries(viewer: Viewer, q: { messageId: string; status?: string; channel?: string; limit: number }) {
  const [m] = await db.select({ id: message.id, audienceId: message.audienceId, reminderKind: reminderRule.kind })
    .from(message).leftJoin(reminderRule, eq(reminderRule.id, message.reminderRuleId)).where(eq(message.id, q.messageId));
  if (!m) throw new MessageError('Message not found', 404);
  const [a] = await db.select().from(messageAudience).where(eq(messageAudience.id, m.audienceId));
  const aud = await describeAudience(db, a!, viewer, m.reminderKind);
  if (!aud.visible) throw new MessageError("Finance reads the deliveries of money lists and payment reminders only", 403);
  const rows = await db.execute(sql`
    select d.id, d.channel, d.status, d.error, d.sent_at as "sentAt", d.title, d.body, d.address, d.attempts,
      r.id as "recipientId", r.name as "recipientName", r.role as "recipientRole",
      s.id as "studentId", s.name as "studentName", n.read_at as "readAt"
    from message_delivery d
    join "user" r on r.id = d.recipient_id
    left join "user" s on s.id = d.student_id
    left join notification n on n.id = d.notification_id
    where d.message_id = ${q.messageId}
      ${q.status ? sql`and d.status = ${q.status}` : sql``}
      ${q.channel ? sql`and d.channel = ${q.channel}` : sql``}
    order by r.name, s.name, d.channel
    limit ${q.limit}`);
  return {
    message: { id: m.id, audience: aud.label },
    deliveries: (rows.rows as Record<string, unknown>[]).map((d) => ({
      id: d.id as string, channel: d.channel as string, status: d.status as string, error: (d.error as string | null) ?? null,
      sentAt: d.sentAt ? new Date(d.sentAt as string) : null, readAt: d.readAt ? new Date(d.readAt as string) : null,
      title: d.title as string, body: d.body as string, address: (d.address as string | null) ?? null, attempts: Number(d.attempts),
      recipient: { id: d.recipientId as string, name: d.recipientName as string, role: (d.recipientRole as string | null) ?? null },
      student: d.studentId ? { id: d.studentId as string, name: d.studentName as string } : null,
    })),
  };
}

/** The saved audiences the viewer may send to (GET /v1/messages/audiences), with their words. */
export async function listSavedAudiences(viewer: Viewer) {
  const rows = await db.select().from(messageAudience).where(eq(messageAudience.saved, true)).orderBy(asc(messageAudience.createdAt));
  const out = [];
  for (const r of rows) {
    const def = AudienceDefinition.safeParse(r.definition);
    if (!def.success || !mayUseAudience(viewer, def.data)) continue;
    out.push({ id: r.id, name: r.name!, kind: r.kind, definition: def.data, label: await audienceLabel(db, def.data) });
  }
  return out;
}

/** Resolve an audience for the screen before sending (POST /v1/messages/audiences/resolve): how many, who, and what it can fill. */
export async function previewAudience(viewer: Viewer, input: CreateMessageType['audience'], context: { sessionId?: string | null } = {}) {
  const { def } = await audienceOf(db, input);
  assertMayUseAudience(viewer, def);
  const resolved = await resolveAudience(def, context, db);
  const people = new Set(resolved.members.map((m) => m.recipientId)).size;
  const families = new Set(resolved.members.map((m) => m.about).filter(Boolean)).size;
  return {
    label: resolved.label,
    people,
    messages: resolved.members.length,
    families,
    fills: resolved.fills,
    session: resolved.session ? { id: resolved.session.id, name: resolved.session.name, endDate: resolved.session.endDate } : null,
    sample: resolved.members.slice(0, 12).map((m) => ({
      name: m.name, role: m.role, student: m.about && m.role !== 'student' ? m.studentNames[0] ?? null : m.role === 'parent' ? messageList(m.studentNames, 'en') || null : null,
      amount: m.owed?.amount ?? null, dueAt: m.owed?.dueAt ?? null, items: m.owed?.items ?? [],
      vars: { en: varsFor(m, resolved, 'en'), ar: varsFor(m, resolved, 'ar') },
    })),
    // The students the list found (the Money tab's "Remind" ticks them).
    students: [...new Map(resolved.members.filter((m) => m.about).map((m) => [m.about!, { id: m.about!, name: m.studentNames[0] ?? '', amount: m.owed?.amount ?? null, dueAt: m.owed?.dueAt ?? null }])).values()],
  };
}

/** What each batch list can be built from (GET /v1/messages/lists): the screen's pickers. */
export async function listOptions(viewer: Viewer, q: { sessionId?: string }) {
  const admin = viewer.role === ROLES.ADMIN;
  const sessions = (await db.execute(sql`select id, name, status from registration_session order by start_date desc limit 40`)).rows as { id: string; name: string; status: string }[];
  const chargeKinds = CHARGE_KINDS.map((k) => ({ value: k, label: CHARGE_KIND_LABELS[k] }));
  const schoolFeeYears = payableAcademicYears();
  if (!admin) return { sessions, chargeKinds, schoolFeeYears, sections: [], offers: [], teachingGroups: [] };
  const start = academicYearStartOf(new Date());
  const sections = (await db.execute(sql`
    select s.id, s.name, s.grade, (select count(*)::int from section_membership m where m.section_id = s.id and m.ended_on is null) as students
    from section s join academic_year y on y.id = s.academic_year_id where y.start_year = ${start} order by s.grade, s.name`)).rows as { id: string; name: string; grade: number; students: number }[];
  const offers = q.sessionId ? (await db.execute(sql`
    select o.id, sub.name as subject, sub.code from session_offer o join subject sub on sub.id = o.subject_id where o.session_id = ${q.sessionId} order by sub.name`)).rows as { id: string; subject: string; code: string }[] : [];
  const [year] = (await db.execute(sql`select id from academic_year where start_year = ${start}`)).rows as { id: string }[];
  const teachingGroups = year ? (await getTeachingDemand(year.id)).map((g) => ({
    academicYearId: year.id, subjectId: g.subjectId, unitId: g.unitId, teacherId: g.teacherId,
    label: `${g.subjectName}${g.unitCode ? ` ${g.unitCode}` : ''} — ${g.teacherName ?? 'no teacher yet'}`, students: g.students.length,
  })) : [];
  return { sessions, chargeKinds, schoolFeeYears, sections, offers, teachingGroups };
}

// ─── Templates ───────────────────────────────────────────────────────────────

export async function listTemplates() {
  return db.select().from(messageTemplate).orderBy(asc(sql`${messageTemplate.key} is null`), asc(messageTemplate.name));
}

export async function createTemplate(input: SaveTemplateType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const clash = await tx.execute(sql`select 1 from message_template where lower(name) = lower(${input.name})`);
    if (clash.rows.length) throw new MessageError(`A template is already called "${input.name}"`, 409);
    const id = randomUUID();
    const { reason, ...fields } = input;
    const [row] = await tx.insert(messageTemplate).values({ id, ...fields, createdBy: actorId, updatedBy: actorId }).returning();
    await logAction(actorId, 'MESSAGE_TEMPLATE_SAVED', 'message_template', id, null, { ...fields, reason }, ctx, tx);
    return row!;
  });
}

export async function updateTemplate(id: string, input: SaveTemplateType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(messageTemplate).where(eq(messageTemplate.id, id)).for('update');
    if (!before) throw new MessageError('Template not found', 404);
    const clash = await tx.execute(sql`select 1 from message_template where lower(name) = lower(${input.name}) and id <> ${id}`);
    if (clash.rows.length) throw new MessageError(`A template is already called "${input.name}"`, 409);
    if (!input.active && before.key) {
      const used = await tx.execute(sql`select kind from reminder_rule where (template_id = ${id} or overdue_template_id = ${id}) and active and inherits_at is null limit 1`);
      if (used.rows.length) throw new MessageError('A reminder rule sends this template: change the rule before switching it off', 409);
    }
    const { reason, ...fields } = input;
    const [row] = await tx.update(messageTemplate).set({ ...fields, updatedBy: actorId }).where(eq(messageTemplate.id, id)).returning();
    await logAction(actorId, 'MESSAGE_TEMPLATE_SAVED', 'message_template', id,
      { name: before.name, titleEn: before.titleEn, bodyEn: before.bodyEn, titleAr: before.titleAr, bodyAr: before.bodyAr, active: before.active },
      { ...fields, reason }, ctx, tx);
    return row!;
  });
}
