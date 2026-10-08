'use client';

/**
 * Reminders (RESERVATIONS_REWORK.md §3.8, §4.8): the rule of each kind for every session — the
 * days around its date it goes out on, how often after the last of them until its target is done,
 * its channels and texts — set once; a session's own rule where it differs (off, or other days),
 * dropped to follow the school's again; and what went out, each with its deliveries. The two
 * school-wide settings (on or off, the hour) are on the Settings page.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse, REMINDER_KIND_LABELS, REMINDER_UNTIL_LABELS, SESSION_REMINDER_KINDS, OVERDUE_REMINDER_KINDS, type ReminderKind,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { INPUT_CLASS } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { InstantText } from '~/app/(app)/exams/exams-shared';
import {
  fetchRules, fetchSent, fetchTemplates, fetchLists, RULES_KEY, TEMPLATES_KEY, MESSAGES_KEY, daysWords, ChannelCounts, type RuleRow, type TemplateRow,
} from './messages-shared';
import { Deliveries } from './log.client';

const KINDS: ReminderKind[] = ['payment_due', 'school_fee_due', 'session_closing', 'entry_deadline', 'declared_retakes_to_verify'];

/** "−7, −3, 0, +3" → [-7, -3, 0, 3]; null when a part is not a whole number. */
function parseDays(text: string): number[] | null {
  const parts = text.replace(/[−–]/g, '-').split(/[,\s]+/).filter(Boolean);
  if (!parts.length) return null;
  const out = parts.map((p) => (/^[+-]?\d+$/.test(p) ? Number(p) : NaN));
  return out.some(Number.isNaN) ? null : out;
}
const showDays = (offsets: number[]) => [...offsets].sort((a, b) => a - b).map((o) => (o > 0 ? `+${o}` : String(o))).join(', ');

export function Reminders(): React.JSX.Element {
  const rules = useQuery({ queryKey: RULES_KEY, queryFn: fetchRules });
  const templates = useQuery({ queryKey: TEMPLATES_KEY, queryFn: fetchTemplates });
  const [open, setOpen] = useState<string | null>(null);
  if (rules.isLoading || templates.isLoading) return <LoadingState />;
  if (rules.isError || !rules.data) return <ErrorState onRetry={() => rules.refetch()} />;
  const { settings } = rules.data;
  return (
    <div className="space-y-6">
      <Notice tone={settings.enabled ? 'info' : 'warning'}>
        {settings.enabled
          ? <><span>Reminders go out on their day at</span> <span dir="ltr">{`${String(settings.sendAtHour).padStart(2, '0')}:00`}</span> <span>Cairo time</span>.</>
          : <span>Reminders are switched off: nothing goes out until they are switched on again.</span>}
        {' '}<Link href="/settings" className="underline">Settings</Link>
      </Notice>
      {KINDS.map((kind) => (
        <KindCard key={kind} kind={kind} rules={rules.data!.rules.filter((r) => r.kind === kind)} templates={templates.data ?? []} />
      ))}
      <WentOut openId={open} onOpen={setOpen} />
    </div>
  );
}

function KindCard({ kind, rules, templates }: { kind: ReminderKind; rules: RuleRow[]; templates: TemplateRow[] }) {
  const global = rules.find((r) => r.sessionId === null);
  const own = rules.filter((r) => r.sessionId !== null);
  const [adding, setAdding] = useState(false);
  return (
    <section aria-labelledby={`kind-${kind}`} className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <h2 id={`kind-${kind}`} className="font-display text-base font-semibold text-foreground">{REMINDER_KIND_LABELS[kind]}</h2>
      </div>
      <div className="divide-y divide-border">
        {global && <RuleEditor rule={global} templates={templates} title={SESSION_REMINDER_KINDS.includes(kind) ? 'Every session' : 'The whole school'} />}
        {own.map((r) => <RuleEditor key={r.id} rule={r} templates={templates} title={r.sessionName ?? ''} />)}
      </div>
      {SESSION_REMINDER_KINDS.includes(kind) && global && (
        <div className="border-t border-border px-5 py-3">
          {adding
            ? <NewOverride kind={kind} from={global} taken={own.map((r) => r.sessionId!)} templates={templates} onDone={() => setAdding(false)} />
            : <Button size="sm" variant="outline" onClick={() => setAdding(true)}>A session's own rule</Button>}
        </div>
      )}
    </section>
  );
}

type Draft = { days: string; repeat: string; email: boolean; templateId: string; overdueTemplateId: string; active: boolean; reason: string };
const draftOf = (r: Pick<RuleRow, 'offsetsDays' | 'repeatEveryDays' | 'channels' | 'templateId' | 'overdueTemplateId' | 'active'>): Draft => ({
  days: showDays(r.offsetsDays), repeat: r.repeatEveryDays ? String(r.repeatEveryDays) : '', email: r.channels.includes('email'),
  templateId: r.templateId, overdueTemplateId: r.overdueTemplateId ?? '', active: r.active, reason: '',
});

function useSaveRule(onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (json: Parameters<typeof api.v1.reminders.rules.$put>[0]['json']) => apiResponse(api.v1.reminders.rules.$put({ json })),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: RULES_KEY }); onDone?.(); },
  });
}

function RuleEditor({ rule, templates, title }: { rule: RuleRow; templates: TemplateRow[]; title: string }) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<Draft>(draftOf(rule));
  const save = useSaveRule(() => setEditing(false));
  const kind = rule.kind as ReminderKind;
  const nameOf = (id: string | null) => templates.find((t) => t.id === id)?.name ?? '—';
  const payload = (extra: { inherit?: boolean } = {}) => {
    const days = parseDays(d.days) ?? rule.offsetsDays;
    return {
      kind, sessionId: rule.sessionId, offsetsDays: days, repeatEveryDays: d.repeat ? Number(d.repeat) : null,
      channels: d.email ? ['in_app', 'email'] as ('in_app' | 'email')[] : ['in_app'] as ('in_app' | 'email')[],
      templateId: d.templateId, overdueTemplateId: d.overdueTemplateId || null, active: d.active, reason: d.reason, ...extra,
    };
  };
  if (!editing) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 text-sm">
        <div className="space-y-1">
          <p className="font-medium text-foreground" data-i18n-skip={rule.sessionId ? 'true' : undefined}>{title}</p>
          <p className="text-foreground">{daysWords(rule.offsetsDays).map((w, i) => <span key={i}>{i > 0 && ', '}<span>{w}</span></span>)}</p>
          {rule.repeatEveryDays && <p className="text-muted-foreground"><span>then every</span> <span>{rule.repeatEveryDays}</span> <span>days</span> <span>{REMINDER_UNTIL_LABELS[rule.until as keyof typeof REMINDER_UNTIL_LABELS]}</span></p>}
          <p className="text-xs text-muted-foreground">
            <span>{rule.channels.includes('email') ? 'In the app and by email' : 'In the app'}</span> · <span>{nameOf(rule.templateId)}</span>
            {rule.overdueTemplateId && <> · <span>after the date:</span> <span>{nameOf(rule.overdueTemplateId)}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={rule.active ? 'success' : 'neutral'}>{rule.active ? 'On' : 'Off'}</Badge>
          <Button size="sm" variant="outline" onClick={() => { setD(draftOf(rule)); setEditing(true); }}>Change</Button>
          {rule.sessionId && (
            <Button size="sm" variant="ghost" disabled={save.isPending}
              onClick={() => save.mutate({ ...payload({ inherit: true }), reason: 'follow the rule for every session again' })}>Follow every session's rule</Button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="px-5 py-4">
      <RuleForm kind={kind} d={d} setD={setD} templates={templates} />
      {save.isError && <Notice tone="danger" className="mt-3">{(save.error as Error).message}</Notice>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={save.isPending || d.reason.trim().length < 3 || !parseDays(d.days)} onClick={() => save.mutate(payload())}>Save</Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Back</Button>
      </div>
    </div>
  );
}

function RuleForm({ kind, d, setD, templates }: { kind: ReminderKind; d: Draft; setD: (d: Draft) => void; templates: TemplateRow[] }) {
  const after = OVERDUE_REMINDER_KINDS.includes(kind);
  const days = parseDays(d.days);
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <label className="space-y-1">
        <span className="font-medium text-foreground">Days (− before the date, + after)</span>
        <input className={INPUT_CLASS} value={d.days} onChange={(e) => setD({ ...d, days: e.target.value })} dir="ltr" aria-invalid={!days} />
        {days && <span className="block text-xs text-muted-foreground">{daysWords(days).map((w, i) => <span key={i}>{i > 0 && ', '}<span>{w}</span></span>)}</span>}
      </label>
      {after && (
        <label className="space-y-1">
          <span className="font-medium text-foreground">Then every … days until paid (empty: no repeat)</span>
          <input className={INPUT_CLASS} type="number" min={1} max={60} value={d.repeat} onChange={(e) => setD({ ...d, repeat: e.target.value })} />
        </label>
      )}
      <label className="space-y-1">
        <span className="font-medium text-foreground">Text</span>
        <select className={INPUT_CLASS} value={d.templateId} onChange={(e) => setD({ ...d, templateId: e.target.value })}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {after && (
        <label className="space-y-1">
          <span className="font-medium text-foreground">Text after the date</span>
          <select className={INPUT_CLASS} value={d.overdueTemplateId} onChange={(e) => setD({ ...d, overdueTemplateId: e.target.value })}>
            <option value="">The same text</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked disabled /> <span>In the app</span></label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={d.email} onChange={(e) => setD({ ...d, email: e.target.checked })} /> <span>Email</span></label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> <span>On</span></label>
      </div>
      <label className="space-y-1">
        <span className="font-medium text-foreground">Reason</span>
        <input className={INPUT_CLASS} value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} placeholder="Why it changes (kept in the audit log)" />
      </label>
    </div>
  );
}

function NewOverride({ kind, from, taken, templates, onDone }: { kind: ReminderKind; from: RuleRow; taken: string[]; templates: TemplateRow[]; onDone: () => void }) {
  const lists = useQuery({ queryKey: [...MESSAGES_KEY, 'lists', ''], queryFn: () => fetchLists() });
  const [sessionId, setSessionId] = useState('');
  const [d, setD] = useState<Draft>(draftOf(from));
  const save = useSaveRule(onDone);
  const sessions = (lists.data?.sessions ?? []).filter((s) => s.status !== 'closed' && !taken.includes(s.id));
  return (
    <div className="space-y-3">
      <label className="block max-w-sm space-y-1 text-sm">
        <span className="font-medium text-foreground">Session</span>
        <select className={INPUT_CLASS} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          <option value="">Choose a session</option>
          {sessions.map((s) => <option key={s.id} value={s.id} data-i18n-skip="true">{s.name}</option>)}
        </select>
      </label>
      <RuleForm kind={kind} d={d} setD={setD} templates={templates} />
      {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      <div className="flex gap-2">
        <Button size="sm" disabled={!sessionId || save.isPending || d.reason.trim().length < 3 || !parseDays(d.days)}
          onClick={() => save.mutate({
            kind, sessionId, offsetsDays: parseDays(d.days)!, repeatEveryDays: d.repeat ? Number(d.repeat) : null,
            channels: d.email ? ['in_app', 'email'] : ['in_app'], templateId: d.templateId, overdueTemplateId: d.overdueTemplateId || null, active: d.active, reason: d.reason,
          })}>Save the session's rule</Button>
        <Button size="sm" variant="outline" onClick={onDone}>Back</Button>
      </div>
    </div>
  );
}

function WentOut({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const sent = useQuery({ queryKey: [...RULES_KEY, 'sent'], queryFn: () => fetchSent(), refetchInterval: 60_000 });
  return (
    <section aria-labelledby="went-out" className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <h2 id="went-out" className="font-display text-base font-semibold text-foreground">What went out</h2>
        <p className="mt-1 text-sm text-muted-foreground">Each reminder is sent once on its day; a paid line or a verified sitting stops its own.</p>
      </div>
      {sent.isLoading ? <LoadingState /> : sent.isError ? <ErrorState onRetry={() => sent.refetch()} /> : !sent.data?.length ? <div className="p-5"><EmptyState title="No reminder has gone out yet" /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-medium">When</th>
                <th className="px-4 py-2 text-start font-medium">Reminder</th>
                <th className="px-4 py-2 text-start font-medium">Days</th>
                <th className="px-4 py-2 text-start font-medium">About</th>
                <th className="px-4 py-2 text-start font-medium">In the app</th>
                <th className="px-4 py-2 text-start font-medium">Email</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {sent.data.map((s) => (
                <tr key={s.messageId} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-2 text-xs text-muted-foreground"><InstantText iso={String(s.sentAt)} /></td>
                  <td className="px-4 py-2">
                    <span>{REMINDER_KIND_LABELS[s.kind]}</span>
                    {s.rule.sessionName && <div className="text-xs text-muted-foreground"><span>the session's own rule:</span> <bdi data-i18n-skip="true">{s.rule.sessionName}</bdi></div>}
                  </td>
                  <td className="px-4 py-2 text-xs">{daysWords(s.offsets).map((w, i) => <span key={i}>{i > 0 && ', '}<span>{w}</span></span>)}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {s.students > 0 ? <><span>{s.students}</span> <span>{s.students === 1 ? 'student' : 'students'}</span></> : <><span>{s.targets}</span> <span>{s.targets === 1 ? 'item' : 'items'}</span></>}
                    {s.people !== null && <> · <span>{s.people}</span> <span>{s.people === 1 ? 'person' : 'people'}</span></>}
                  </td>
                  <td className="px-4 py-2"><ChannelCounts c={s.deliveries.in_app} /></td>
                  <td className="px-4 py-2"><ChannelCounts c={s.deliveries.email} /></td>
                  <td className="px-4 py-2 text-end"><Button size="sm" variant="outline" onClick={() => onOpen(openId === s.messageId ? null : s.messageId)}>{openId === s.messageId ? 'Close' : 'Deliveries'}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && <Deliveries messageId={openId} />}
    </section>
  );
}
