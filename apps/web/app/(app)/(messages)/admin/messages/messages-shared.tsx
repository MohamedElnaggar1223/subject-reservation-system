'use client';

/**
 * Shared by the Messages screen and the session's Money tab ("Remind"): the fetchers — typed by
 * the API, never by hand (PATTERNS.md) — and the small pieces they show. Text that carries a
 * number, a name or a date is split into its own nodes so the page translator (lib/i18n.tsx,
 * lib/i18n-messages.ts) finds the words.
 */

import { api } from '~/lib/hono';
import {
  apiResponse, type AudienceInputType, type MessageChannel,
} from '@repo/validations';
import { Badge, type Tone } from '~/components/ui/tone';

// ─── Fetchers ────────────────────────────────────────────────────────────────

export const fetchMessages = (query: { source?: 'staff' | 'reminder' | 'legacy_announcement'; status?: 'scheduled' | 'sent' | 'cancelled' | 'failed' } = {}) =>
  apiResponse(api.v1.messages.$get({ query: { limit: '100', ...query } }));
export type MessageRow = Awaited<ReturnType<typeof fetchMessages>>[number];

export const fetchDeliveries = (messageId: string) => apiResponse(api.v1.messages.deliveries.$get({ query: { messageId } }));
export type DeliveriesData = Awaited<ReturnType<typeof fetchDeliveries>>;
export type DeliveryRow = DeliveriesData['deliveries'][number];

export const fetchTemplates = () => apiResponse(api.v1.messages.templates.$get());
export type TemplateRow = Awaited<ReturnType<typeof fetchTemplates>>[number];

export const fetchSavedAudiences = () => apiResponse(api.v1.messages.audiences.$get());
export type SavedAudience = Awaited<ReturnType<typeof fetchSavedAudiences>>[number];

export const fetchLists = (sessionId?: string) => apiResponse(api.v1.messages.lists.$get({ query: sessionId ? { sessionId } : {} }));
export type ListOptions = Awaited<ReturnType<typeof fetchLists>>;

export const resolveAudience = (audience: AudienceInputType, sessionId?: string | null) =>
  apiResponse(api.v1.messages.audiences.resolve.$post({ json: { audience, ...(sessionId ? { context: { sessionId } } : {}) } }));
export type Resolved = Awaited<ReturnType<typeof resolveAudience>>;

export const fetchRules = () => apiResponse(api.v1.reminders.rules.$get());
export type RulesData = Awaited<ReturnType<typeof fetchRules>>;
export type RuleRow = RulesData['rules'][number];

export const fetchSent = (query: { kind?: RuleRow['kind'] & string } = {}) => apiResponse(api.v1.reminders.sent.$get({ query: { limit: '50', ...(query.kind ? { kind: query.kind as never } : {}) } }));
export type SentRow = Awaited<ReturnType<typeof fetchSent>>[number];

export const fetchPeople = (search: string) => apiResponse(api.v1.users.$get({ query: { search } }));

export const MESSAGES_KEY = ['messages'] as const;
export const TEMPLATES_KEY = ['messages', 'templates'] as const;
export const RULES_KEY = ['reminders', 'rules'] as const;

// ─── Words ───────────────────────────────────────────────────────────────────

export const CHANNEL_WORD: Record<MessageChannel, string> = { in_app: 'In the app', email: 'Email', whatsapp: 'WhatsApp' };
export const MESSAGE_STATUS_TONE: Record<string, Tone> = { scheduled: 'info', sent: 'success', cancelled: 'neutral', failed: 'danger' };
export const MESSAGE_STATUS_WORD: Record<string, string> = { scheduled: 'Scheduled', sent: 'Sent', cancelled: 'Cancelled', failed: 'Not sent' };
export const DELIVERY_TONE: Record<string, Tone> = { queued: 'warning', sending: 'warning', sent: 'success', failed: 'danger' };
export const DELIVERY_WORD: Record<string, string> = { queued: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Failed' };
export const ROLE_WORD: Record<string, string> = {
  parent: 'Parent', student: 'Student', admin: 'Admin', finance_officer: 'Finance officer', finance_admin: 'Finance admin',
  coordinator: 'Coordinator', teacher: 'Teacher', gate: 'Gate',
};

/** "7 days before, 3 days before, the day, 3 days after". */
export function daysWords(offsets: number[]): string[] {
  return [...offsets].sort((a, b) => a - b).map((o) => (o === 0 ? 'the day' : o < 0 ? (o === -1 ? '1 day before' : `${-o} days before`) : (o === 1 ? '1 day after' : `${o} days after`)));
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={MESSAGE_STATUS_TONE[status] ?? 'neutral'}>{MESSAGE_STATUS_WORD[status] ?? status}</Badge>;
}

/** One channel's outcome: sent, failed, waiting — each in its own node. */
export function ChannelCounts({ c }: { c: { sent: number; failed: number; waiting: number } }) {
  if (!c.sent && !c.failed && !c.waiting) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {c.sent > 0 && <Badge tone="success"><span>{c.sent}</span>&nbsp;<span>sent</span></Badge>}
      {c.failed > 0 && <Badge tone="danger"><span>{c.failed}</span>&nbsp;<span>failed</span></Badge>}
      {c.waiting > 0 && <Badge tone="warning"><span>{c.waiting}</span>&nbsp;<span>waiting</span></Badge>}
    </span>
  );
}

/**
 * A Cairo wall time (from a date-time field) as an instant: the school's clock, whatever zone the
 * browser is in. Cairo is UTC+2 or +3; the one that reads back as the same wall time is right.
 */
export function cairoInstant(wall: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  for (const off of [2, 3]) {
    const t = new Date(Date.UTC(y, mo - 1, d, h - off, mi));
    const back = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
    if (back.replace(',', '') === `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`) return t;
  }
  return null;
}

/** Tomorrow at 09:00, Cairo time. */
export function tomorrowAtNine(): Date {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return cairoInstant(`${tomorrow}T09:00`)!;
}
