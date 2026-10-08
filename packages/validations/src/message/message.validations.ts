/**
 * Messages and reminders (RESERVATIONS_REWORK.md §3.8, §4.8; docs/features/RESERVATIONS_MESSAGES.md).
 *
 * A message goes to an **audience** — a broadcast (everyone, families, parents, students, staff, a
 * grade or the parents of a grade), a batch (a list the system already holds: a session's unpaid
 * families, a section, a teaching group, the reservers of an offer, the holders of a charge kind)
 * or chosen people — on its channels (in-app and email; WhatsApp is reserved, with no sender until
 * the school has a business account). Each send writes the family's existing notification rows and
 * one delivery row per recipient and channel. Reminder rules send the school's reminders on their
 * own, from the due dates and deadlines the system already computes.
 *
 * Rendering lives here, not in the API, so the screen's preview is the text that goes out.
 */

import { z } from 'zod';
import { CHARGE_KINDS } from '../charge/charge.validations';
import { schoolDateParts } from '../academic/academic-year';

// ─── Channels ────────────────────────────────────────────────────────────────

export const MESSAGE_CHANNELS = ['in_app', 'email', 'whatsapp'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
/** The channels that have a sender. WhatsApp waits for the school's business account (DISCOVERY.md). */
export const LIVE_CHANNELS = ['in_app', 'email'] as const;
export const MessageChannelSchema = z.enum(MESSAGE_CHANNELS);
export const CHANNEL_LABELS: Record<MessageChannel, string> = { in_app: 'In the app', email: 'Email', whatsapp: 'WhatsApp' };
export const WHATSAPP_REFUSAL = 'WhatsApp is not connected yet: the school has no WhatsApp Business account, so nothing can be sent there';

const Channels = z.array(MessageChannelSchema).min(1, 'Choose at least one channel').max(3)
  .refine((c) => new Set(c).size === c.length, 'Each channel once')
  .refine((c) => !c.includes('whatsapp'), WHATSAPP_REFUSAL);

// ─── Audiences ───────────────────────────────────────────────────────────────

/** Who in a family a list reaches: the approved parents, the students, or both. */
export const AUDIENCE_WHO = ['parents', 'students', 'families'] as const;
export type AudienceWho = (typeof AUDIENCE_WHO)[number];
const Who = z.enum(AUDIENCE_WHO);

export const BROADCAST_GROUPS = ['everyone', 'families', 'parents', 'students', 'staff'] as const;
export type BroadcastGroup = (typeof BROADCAST_GROUPS)[number];

const id = z.string().min(1).max(100);

export const BroadcastDefinition = z.object({
  kind: z.literal('broadcast'),
  group: z.enum(BROADCAST_GROUPS),
  /** A grade (today's, from the cohort): only for families, parents or students. */
  grade: z.number().int().min(10).max(12).nullable().optional(),
});

export const BATCH_LISTS = ['session_unpaid', 'section', 'teaching_group', 'offer_reservers', 'charge_holders'] as const;
export type BatchList = (typeof BATCH_LISTS)[number];
/** The lists about money: finance may send to these (RESERVATIONS_REWORK.md §5: "finance for payment batches"). */
export const MONEY_LISTS: readonly BatchList[] = ['session_unpaid', 'charge_holders'];

export const SessionUnpaidList = z.object({
  kind: z.literal('batch'),
  list: z.literal('session_unpaid'),
  sessionId: id,
  /** What is owed: the session's lines, its charges, or both (the Money tab's two tables). */
  include: z.enum(['lines', 'charges', 'both']).default('both'),
  /** The Money tab's filter: everything owed, or what is past its due date. */
  filter: z.enum(['unpaid', 'overdue']).default('unpaid'),
  offerId: id.nullable().optional(),
  sectionId: id.nullable().optional(),
  /** The families ticked (by their students); none: every family the list finds. */
  studentIds: z.array(id).max(2000).nullable().optional(),
  who: Who.default('families'),
});
export const SectionList = z.object({ kind: z.literal('batch'), list: z.literal('section'), sectionId: id, who: Who.default('families') });
/**
 * A teaching group as F1's contract names it (docs/features/RESERVATIONS.md §10, getTeachingDemand):
 * the open in-school course enrolments of one subject (and unit) with one teacher in a year.
 */
export const TeachingGroupList = z.object({
  kind: z.literal('batch'), list: z.literal('teaching_group'),
  academicYearId: id, subjectId: id, unitId: id.nullable(), teacherId: id.nullable(), who: Who.default('families'),
});
export const OfferReserversList = z.object({
  kind: z.literal('batch'), list: z.literal('offer_reservers'), offerId: id,
  /** Live lines (waiting or paid), only the unpaid, or only the paid. */
  lines: z.enum(['live', 'unpaid', 'paid']).default('live'),
  who: Who.default('families'),
});
export const ChargeHoldersList = z.object({
  kind: z.literal('batch'), list: z.literal('charge_holders'),
  chargeKind: z.enum(CHARGE_KINDS),
  /** Only charges still awaiting payment (default), or every live one (awaiting or paid). */
  unpaidOnly: z.boolean().default(true),
  /** A pushed school fee's year ("2026-2027"). */
  academicYear: z.string().regex(/^\d{4}-\d{4}$/).nullable().optional(),
  who: Who.default('families'),
});
export const BatchDefinition = z.discriminatedUnion('list', [SessionUnpaidList, SectionList, TeachingGroupList, OfferReserversList, ChargeHoldersList]);
export const DirectDefinition = z.object({
  kind: z.literal('direct'),
  userIds: z.array(id).min(1, 'Choose at least one person').max(500).refine((u) => new Set(u).size === u.length, 'Each person once'),
});

export const AudienceDefinition = z.union([BroadcastDefinition, BatchDefinition, DirectDefinition])
  .refine((d) => d.kind !== 'broadcast' || d.grade == null || ['families', 'parents', 'students'].includes(d.group), 'A grade narrows parents, students or families only');
export type AudienceDefinitionType = z.infer<typeof AudienceDefinition>;
export type BroadcastDefinitionType = z.infer<typeof BroadcastDefinition>;
export type BatchDefinitionType = z.infer<typeof BatchDefinition>;

/** A saved audience (picked by id) or a definition. */
export const AudienceInput = z.union([
  z.object({ savedId: id }),
  z.object({ definition: AudienceDefinition }),
]);
export type AudienceInputType = z.infer<typeof AudienceInput>;

export const MessageContext = z.object({
  /** The session {session} and {closes} name, when the audience does not name one. */
  sessionId: id.nullable().optional(),
});

export const ResolveAudience = z.object({ audience: AudienceInput, context: MessageContext.optional() });
export type ResolveAudienceType = z.infer<typeof ResolveAudience>;

/** A broadcast's words, as the picker and the log say them. */
export function broadcastLabel(d: { group: BroadcastGroup; grade?: number | null }): string {
  const g = d.grade;
  switch (d.group) {
    case 'everyone': return 'Everyone';
    case 'staff': return 'All staff';
    case 'families': return g ? `Families of grade ${g}` : 'All families';
    case 'parents': return g ? `Parents of grade ${g}` : 'All parents';
    case 'students': return g ? `Grade ${g} students` : 'All students';
  }
}

export const BATCH_LIST_LABELS: Record<BatchList, string> = {
  session_unpaid: "A session's unpaid families",
  section: 'A section',
  teaching_group: 'A teaching group',
  offer_reservers: 'The reservers of a subject',
  charge_holders: 'The holders of a charge',
};
export const WHO_LABELS: Record<AudienceWho, string> = { parents: 'Parents', students: 'Students', families: 'Parents and students' };

// ─── Variables and rendering ─────────────────────────────────────────────────

export const MESSAGE_VARIABLES = ['guardian', 'student', 'session', 'amount', 'due', 'closes', 'items', 'series', 'count'] as const;
export type MessageVariable = (typeof MESSAGE_VARIABLES)[number];
export const MESSAGE_VARIABLE_LABELS: Record<MessageVariable, string> = {
  guardian: "the parent's name",
  student: "the student's name",
  session: 'the session',
  amount: 'the amount owed',
  due: 'the due date',
  closes: 'when reservations close, or the deadline',
  items: 'what is owed',
  series: 'the board series',
  count: 'how many',
};
export type MessageVars = Partial<Record<MessageVariable, string>>;
export type MessageLanguage = 'en' | 'ar';

const isVariable = (v: string): v is MessageVariable => (MESSAGE_VARIABLES as readonly string[]).includes(v);

/** The variables a text uses, in the order of first use. */
export function variablesIn(...texts: (string | null | undefined)[]): MessageVariable[] {
  const found: MessageVariable[] = [];
  for (const t of texts) {
    for (const m of (t ?? '').matchAll(/\{([a-z]+)\}/g)) {
      const v = m[1]!;
      if (isVariable(v) && !found.includes(v)) found.push(v);
    }
  }
  return found;
}

/** Names in braces that are not variables ("{name}"): refused, so a typo never goes out as written. */
export function unknownVariablesIn(...texts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const m of (t ?? '').matchAll(/\{([^{}]*)\}/g)) {
      const v = m[1]!;
      if (!isVariable(v) && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** What a variable reads when a recipient has no value for it. */
const FALLBACK: Record<MessageLanguage, MessageVars> = {
  en: { guardian: 'parent or guardian', student: 'your child' },
  ar: { guardian: 'ولي الأمر', student: 'ابنكم' },
};

export function renderText(text: string, vars: MessageVars, lang: MessageLanguage = 'en'): string {
  return text.replace(/\{([a-z]+)\}/g, (whole, name: string) => {
    if (!isVariable(name)) return whole;
    const v = vars[name];
    return v != null && v !== '' ? v : FALLBACK[lang][name] ?? '';
  });
}

export type MessageTexts = { titleEn: string; bodyEn: string; titleAr: string | null; bodyAr: string | null };
export type MessageLanguageChoice = 'en' | 'ar' | 'both';

/**
 * One recipient's title and body. "both" (the default for the school's bilingual templates) puts
 * the English first and the Arabic after it; a text with no Arabic sends its English; "ar" sends
 * the Arabic.
 */
export function renderMessage(t: MessageTexts, language: MessageLanguageChoice, vars: { en: MessageVars; ar: MessageVars }) {
  const en = { title: renderText(t.titleEn, vars.en, 'en'), body: renderText(t.bodyEn, vars.en, 'en') };
  const ar = t.titleAr && t.bodyAr ? { title: renderText(t.titleAr, vars.ar, 'ar'), body: renderText(t.bodyAr, vars.ar, 'ar') } : null;
  if (language === 'ar' && ar) return { title: ar.title, body: ar.body, en: null, ar };
  if (language === 'both' && ar) return { title: `${en.title} · ${ar.title}`, body: `${en.body}\n\n${ar.body}`, en, ar };
  return { title: en.title, body: en.body, en, ar: null };
}

const enDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', year: 'numeric' });
const arDate = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', year: 'numeric' });
const amountFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** A date as a message says it (the school's day, Cairo), in each language. */
export function messageDate(d: Date | string, lang: MessageLanguage): string {
  const v = typeof d === 'string' ? new Date(d) : d;
  return lang === 'ar' ? arDate.format(v) : enDate.format(v);
}
/** An amount as a message says it. */
export function messageAmount(n: number, lang: MessageLanguage): string {
  return lang === 'ar' ? `${amountFmt.format(n)} جنيه` : `EGP ${amountFmt.format(n)}`;
}
/** Names as a message lists them: "A, B and C" / "A، B وC". */
export function messageList(names: string[], lang: MessageLanguage): string {
  if (names.length <= 1) return names[0] ?? '';
  const head = names.slice(0, -1).join(lang === 'ar' ? '، ' : ', ');
  return lang === 'ar' ? `${head} و${names[names.length - 1]}` : `${head} and ${names[names.length - 1]}`;
}

// ─── Messages ────────────────────────────────────────────────────────────────

const Title = z.string().trim().min(3, 'The title needs at least 3 characters').max(150);
const Body = z.string().trim().min(10, 'The text needs at least 10 characters').max(4000);
const UNKNOWN_VARIABLE = `Unknown variable: use only ${MESSAGE_VARIABLES.map((v) => `{${v}}`).join(' ')}`;

export const CreateMessage = z.object({
  audience: AudienceInput,
  templateId: id.nullable().optional(),
  title: Title.nullable().optional(),
  body: Body.nullable().optional(),
  titleAr: Title.nullable().optional(),
  bodyAr: Body.nullable().optional(),
  language: z.enum(['en', 'ar', 'both']).default('both'),
  channels: Channels,
  /** Absent or past: now. */
  scheduledAt: z.coerce.date().nullable().optional(),
  context: MessageContext.optional(),
  /** Keep this audience in the picker under a name. */
  saveAudienceAs: z.string().trim().min(3).max(80).nullable().optional(),
}).refine((m) => !!m.templateId || (!!m.title && !!m.body), { message: 'Choose a template or write a title and a text', path: ['title'] })
  .refine((m) => !m.templateId || (!m.title && !m.body && !m.titleAr && !m.bodyAr), { message: 'A template brings its own text: send the template, or write the text', path: ['templateId'] })
  .refine((m) => !!m.titleAr === !!m.bodyAr, { message: 'The Arabic text needs both its title and its text', path: ['titleAr'] })
  .refine((m) => unknownVariablesIn(m.title, m.body, m.titleAr, m.bodyAr).length === 0, { message: UNKNOWN_VARIABLE, path: ['body'] });
export type CreateMessageType = z.infer<typeof CreateMessage>;

export const MESSAGE_STATUSES = ['scheduled', 'sent', 'cancelled', 'failed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const MESSAGE_SOURCES = ['staff', 'reminder', 'legacy_announcement'] as const;
export type MessageSource = (typeof MESSAGE_SOURCES)[number];
export const DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const MessageId = z.object({ id: id });
export const ListMessagesQuery = z.object({
  status: z.enum(MESSAGE_STATUSES).optional(),
  source: z.enum(MESSAGE_SOURCES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const DeliveriesQuery = z.object({
  messageId: id,
  status: z.enum(DELIVERY_STATUSES).optional(),
  channel: MessageChannelSchema.optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});
export const CancelMessage = z.object({ reason: z.string().trim().min(3, 'A reason is required').max(500) });

// ─── Templates ───────────────────────────────────────────────────────────────

export const SaveTemplate = z.object({
  name: z.string().trim().min(3).max(80),
  titleEn: Title,
  bodyEn: Body,
  titleAr: Title,
  bodyAr: Body,
  active: z.boolean().default(true),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
}).refine((t) => unknownVariablesIn(t.titleEn, t.bodyEn, t.titleAr, t.bodyAr).length === 0, { message: UNKNOWN_VARIABLE, path: ['bodyEn'] });
export type SaveTemplateType = z.infer<typeof SaveTemplate>;
export const TemplateId = z.object({ id: id });

// ─── Reminder rules ──────────────────────────────────────────────────────────

export const REMINDER_KINDS = ['payment_due', 'session_closing', 'entry_deadline', 'school_fee_due', 'declared_retakes_to_verify'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];
export const REMINDER_UNTIL = ['paid', 'closed', 'deadline', 'verified'] as const;
export type ReminderUntil = (typeof REMINDER_UNTIL)[number];
/** What stops each kind: its target paid, the session closed, the deadline passed, the sitting verified. */
export const REMINDER_KIND_UNTIL: Record<ReminderKind, ReminderUntil> = {
  payment_due: 'paid', session_closing: 'closed', entry_deadline: 'deadline', school_fee_due: 'paid', declared_retakes_to_verify: 'verified',
};
export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  payment_due: 'Payment due (lines, instalments, charges)',
  session_closing: 'Reservations closing',
  entry_deadline: 'Board entry deadline (staff)',
  school_fee_due: 'School fee due',
  declared_retakes_to_verify: 'Declared retakes to verify (coordinator)',
};
export const REMINDER_UNTIL_LABELS: Record<ReminderUntil, string> = {
  paid: 'until paid', closed: 'until the session closes', deadline: 'until the deadline', verified: 'until verified',
};
/** Kinds a session may override (the school fee and the series' deadlines are not a session's). */
export const SESSION_REMINDER_KINDS: readonly ReminderKind[] = ['payment_due', 'session_closing', 'declared_retakes_to_verify'];
/** Kinds that may run after their date (a debt still owed). */
export const OVERDUE_REMINDER_KINDS: readonly ReminderKind[] = ['payment_due', 'school_fee_due'];

export const PutReminderRule = z.object({
  kind: z.enum(REMINDER_KINDS),
  /** null: the rule for every session; a session's own rule overrides it there. */
  sessionId: id.nullable(),
  offsetsDays: z.array(z.number().int().min(-90).max(90)).min(1, 'At least one day').max(12)
    .refine((o) => new Set(o).size === o.length, 'Each day once'),
  repeatEveryDays: z.number().int().min(1).max(60).nullable(),
  channels: Channels,
  templateId: id,
  overdueTemplateId: id.nullable().optional(),
  active: z.boolean(),
  /** A session's override only: drop it, so the session follows the rule for every session again. */
  inherit: z.boolean().optional(),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
}).refine((r) => r.sessionId !== null || !r.inherit, { message: 'The rule for every session cannot inherit', path: ['inherit'] })
  .refine((r) => r.sessionId === null || SESSION_REMINDER_KINDS.includes(r.kind), { message: "This reminder is the school's, not a session's: it has no session override", path: ['sessionId'] })
  .refine((r) => OVERDUE_REMINDER_KINDS.includes(r.kind) || (r.offsetsDays.every((o) => o <= 0) && r.repeatEveryDays === null), {
    message: 'Only a payment is reminded after its date: this reminder runs up to its date', path: ['offsetsDays'],
  });
export type PutReminderRuleType = z.infer<typeof PutReminderRule>;

export const RemindersSentQuery = z.object({
  kind: z.enum(REMINDER_KINDS).optional(),
  sessionId: id.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Cairo's offset from UTC, in minutes, at an instant. */
function cairoOffsetMinutes(at: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((wall - at.getTime()) / 60_000);
}

/**
 * The moment an offset falls on: the anchor's day in Cairo moved by the offset, at the school's
 * send hour, Cairo time — the same instant whatever zone the server runs in, and never before
 * that day in Cairo.
 */
export function reminderMoment(anchor: Date, offsetDays: number, sendAtHour: number): Date {
  const { year, month, day } = schoolDateParts(anchor);
  const wall = Date.UTC(year, month - 1, day + offsetDays, sendAtHour, 0, 0);
  const guess = new Date(wall - 2 * 3_600_000);
  return new Date(wall - cairoOffsetMinutes(guess) * 60_000);
}

/** The anchor's day (Cairo) as YYYY-MM-DD: a claim is per day, so a moved date is a new reminder. */
export function anchorDay(anchor: Date): string {
  const { year, month, day } = schoolDateParts(anchor);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Which offset of a rule is due now for one target, if any: the latest offset — the repeats after
 * the last one included — whose moment has come, provided it came after the target existed.
 * Offsets passed over while nothing ran are not sent as a backlog; a day whose send hour has passed
 * goes out on the next tick (the claim row stops a second send).
 */
export function dueOffset(a: { anchor: Date; offsetsDays: number[]; repeatEveryDays: number | null; sendAtHour: number; now: Date; since: Date }): number | null {
  const offsets = [...a.offsetsDays].sort((x, y) => x - y);
  let due: number | null = null;
  for (const o of offsets) if (reminderMoment(a.anchor, o, a.sendAtHour) <= a.now) due = o;
  const last = offsets[offsets.length - 1]!;
  if (a.repeatEveryDays && due === last) {
    for (let k = 1; k <= 400; k++) {
      const o = last + k * a.repeatEveryDays;
      if (reminderMoment(a.anchor, o, a.sendAtHour) > a.now) break;
      due = o;
    }
  }
  if (due === null) return null;
  return reminderMoment(a.anchor, due, a.sendAtHour) >= a.since ? due : null;
}
