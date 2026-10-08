'use client';

/**
 * The log (RESERVATIONS_REWORK.md §4.8): every message — the staff's, the reminders', the
 * announcements moved from before — with its audience as it was resolved, its channels and how
 * each channel went; a scheduled one can be cancelled until its minute. Opening one lists its
 * deliveries per recipient: who, about which child, on which channel, sent, failed (and why),
 * read.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { ReasonModal } from '~/components/ui/reason-modal';
import { InstantText } from '~/app/(app)/exams/exams-shared';
import {
  fetchMessages, fetchDeliveries, countWords, MESSAGES_KEY, StatusBadge, ChannelCounts, CHANNEL_WORD, DELIVERY_TONE, DELIVERY_WORD, ROLE_WORD, type MessageRow,
} from './messages-shared';

const SOURCES = ['all', 'staff', 'reminder', 'legacy_announcement'] as const;
const SOURCE_WORD: Record<(typeof SOURCES)[number], string> = { all: 'All', staff: 'Sent by staff', reminder: 'Reminders', legacy_announcement: 'Before messages' };

export function MessageLog({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<(typeof SOURCES)[number]>('all');
  const log = useQuery({ queryKey: [...MESSAGES_KEY, 'log', source], queryFn: () => fetchMessages(source === 'all' ? {} : { source }), refetchInterval: 30_000 });
  const [cancelling, setCancelling] = useState<MessageRow | null>(null);
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiResponse(api.v1.messages[':id'].cancel.$post({ param: { id }, json: { reason } })),
    onSuccess: () => { setCancelling(null); queryClient.invalidateQueries({ queryKey: MESSAGES_KEY }); },
  });
  return (
    <section aria-labelledby="log" className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 id="log" className="font-display text-base font-semibold text-foreground">Sent and scheduled</h2>
        <div className="flex rounded-lg border border-border bg-card p-0.5 text-sm" role="group" aria-label="Show">
          {SOURCES.map((s) => (
            <button key={s} type="button" aria-pressed={source === s} onClick={() => setSource(s)}
              className={`rounded-md px-3 py-1.5 ${source === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{SOURCE_WORD[s]}</button>
          ))}
        </div>
      </div>
      {log.isLoading ? <LoadingState /> : log.isError ? <ErrorState onRetry={() => log.refetch()} /> : !log.data?.length ? <div className="p-5"><EmptyState title="Nothing sent yet" /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-medium">When</th>
                <th className="px-4 py-2 text-start font-medium">To</th>
                <th className="px-4 py-2 text-start font-medium">Message</th>
                <th className="px-4 py-2 text-start font-medium">In the app</th>
                <th className="px-4 py-2 text-start font-medium">Email</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {log.data.map((m) => (
                <tr key={m.id} className={`border-b border-border align-top last:border-0 ${openId === m.id ? 'bg-accent/40' : ''}`}>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {m.sentAt ? <InstantText iso={String(m.sentAt)} /> : m.scheduledAt ? <InstantText iso={String(m.scheduledAt)} /> : <InstantText iso={String(m.createdAt)} />}
                    {m.createdBy && <div><bdi data-i18n-skip="true">{m.createdBy}</bdi></div>}
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-foreground"><bdi>{m.audience.label}</bdi></div>
                    {m.people !== null && <div className="text-xs text-muted-foreground"><span>{countWords(m.people, 'person')}</span></div>}
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-foreground" data-i18n-skip="true"><bdi>{m.title}</bdi></div>
                    {m.templateName && <div className="text-xs text-muted-foreground"><span>Template:</span> <span>{m.templateName}</span></div>}
                    {m.error && <div className="text-xs text-destructive">{m.error}</div>}
                  </td>
                  <td className="px-4 py-2"><ChannelCounts c={m.deliveries.in_app} /></td>
                  <td className="px-4 py-2">{m.channels.includes('email') ? <ChannelCounts c={m.deliveries.email} /> : <span className="text-xs text-muted-foreground">not sent by email</span>}</td>
                  <td className="px-4 py-2"><StatusBadge status={m.status} /></td>
                  <td className="px-4 py-2 text-end">
                    <div className="flex justify-end gap-2">
                      {m.status === 'scheduled' && <Button size="sm" variant="outline" onClick={() => setCancelling(m)}>Cancel</Button>}
                      {m.status === 'sent' && <Button size="sm" variant="outline" onClick={() => onOpen(openId === m.id ? null : m.id)}>{openId === m.id ? 'Close' : 'Deliveries'}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && <Deliveries messageId={openId} />}
      {cancelling && (
        <ReasonModal
          title="Cancel this scheduled message"
          description={`"${cancelling.title}" will not be sent. The log keeps it, cancelled.`}
          confirmLabel="Cancel the message"
          destructive
          isPending={cancel.isPending}
          error={cancel.error ? (cancel.error as Error).message : undefined}
          onConfirm={(reason) => cancel.mutate({ id: cancelling.id, reason })}
          onClose={() => setCancelling(null)}
        />
      )}
    </section>
  );
}

/** One message's deliveries, per recipient and channel. */
export function Deliveries({ messageId }: { messageId: string }) {
  const d = useQuery({ queryKey: [...MESSAGES_KEY, 'deliveries', messageId], queryFn: () => fetchDeliveries(messageId), refetchInterval: 10_000 });
  const [only, setOnly] = useState<'all' | 'failed'>('all');
  if (d.isLoading) return <LoadingState />;
  if (d.isError || !d.data) return <ErrorState message={(d.error as Error | null)?.message} onRetry={() => d.refetch()} />;
  const rows = d.data.deliveries.filter((x) => only === 'all' || x.status === 'failed');
  return (
    <div className="border-t border-border px-5 py-4" aria-label="Deliveries">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground"><span>Deliveries</span> — <bdi>{d.data.message.audience}</bdi></h3>
        <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs" role="group" aria-label="Deliveries shown">
          {(['all', 'failed'] as const).map((o) => (
            <button key={o} type="button" aria-pressed={only === o} onClick={() => setOnly(o)}
              className={`rounded-md px-2.5 py-1 ${only === o ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{o === 'all' ? 'Every delivery' : 'Failed only'}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <EmptyState title="None" /> : (
        <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Recipient</th>
                <th className="px-3 py-2 text-start font-medium">About</th>
                <th className="px-3 py-2 text-start font-medium">Channel</th>
                <th className="px-3 py-2 text-start font-medium">Outcome</th>
                <th className="px-3 py-2 text-start font-medium">Read</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-1.5">
                    <bdi data-i18n-skip="true">{x.recipient.name}</bdi>
                    <div className="text-xs text-muted-foreground">{ROLE_WORD[x.recipient.role ?? ''] ?? x.recipient.role}{x.channel === 'email' && x.address && <> · <bdi data-i18n-skip="true">{x.address}</bdi></>}</div>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{x.student ? <bdi data-i18n-skip="true">{x.student.name}</bdi> : '—'}</td>
                  <td className="px-3 py-1.5">{CHANNEL_WORD[x.channel as keyof typeof CHANNEL_WORD] ?? x.channel}</td>
                  <td className="px-3 py-1.5">
                    <Badge tone={DELIVERY_TONE[x.status] ?? 'neutral'}>{DELIVERY_WORD[x.status] ?? x.status}</Badge>
                    {x.error && <div className="mt-0.5 text-xs text-destructive">{x.error}</div>}
                    {x.sentAt && <div className="text-xs text-muted-foreground"><InstantText iso={String(x.sentAt)} /></div>}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{x.channel === 'in_app' ? (x.readAt ? <InstantText iso={String(x.readAt)} /> : 'Not yet') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
