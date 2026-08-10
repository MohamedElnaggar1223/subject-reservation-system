'use client';

/**
 * Admin -- Bulk Announcement Composer Page (NOT-011)
 *
 * Allows admins to compose and send bulk in-app + email announcements
 * to selected recipient groups.
 *
 * Features:
 * - Title + body form with character counts
 * - Recipient group selector (all, students, parents, grade 10/11/12)
 * - Toggle: send email alongside in-app notification
 * - Preview pane
 * - Submission with loading + success/error feedback
 * - Announcement history (last sent, based on audit log)
 *
 * Calls: POST /v1/notifications/admin/announce
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ANNOUNCEMENT_RECIPIENT_GROUPS, ANNOUNCEMENT_RECIPIENT_LABELS, type AnnouncementRecipientGroup } from '@repo/validations';
import { Button } from '~/components/ui/button';

const MAX_TITLE = 150;
const MAX_BODY = 2000;

// L-6: Row shape returned by GET /notifications/admin/scheduled.
type ScheduledRow = {
  id: string;
  title: string;
  body: string;
  recipients: string;
  sendEmail: boolean;
  scheduledAt: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  sentAt: string | null;
  notificationCount: number | null;
  errorMessage: string | null;
  createdByUser: { name: string; email: string } | null;
};

export default function AdminNotificationsPage() {
  const qc = useQueryClient();
  const [title, setTitle]       = useState('');
  const [body, setBody]         = useState('');
  const [recipients, setRecipients] = useState<AnnouncementRecipientGroup>('all');
  const [sendEmail, setSendEmail]   = useState(true);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [preview, setPreview]   = useState(false);
  const [result, setResult]     = useState<{ notificationCount: number; scheduled?: boolean; scheduledAt?: string } | null>(null);

  // L-6: Fetch the scheduled-announcement queue (polls every 30s so newly
  // scheduled items show up and status transitions stay fresh).
  const { data: scheduled } = useQuery({
    queryKey: ['admin', 'scheduled-announcements'],
    queryFn: () =>
      apiResponse(api.v1.notifications.admin.scheduled.$get()) as Promise<ScheduledRow[]>,
    refetchInterval: 30_000,
  });

  const cancel = useMutation({
    mutationFn: (id: string) =>
      apiResponse(
        api.v1.notifications.admin.scheduled[':id'].$delete({ param: { id } })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'scheduled-announcements'] });
    },
  });

  const send = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.notifications.admin.announce.$post({
          json: {
            title,
            body,
            recipients,
            sendEmail,
            ...(scheduleEnabled && scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
          },
        })
      ),
    onSuccess: (data) => {
      setResult(data as { notificationCount: number; scheduled?: boolean; scheduledAt?: string });
      setTitle('');
      setBody('');
      setRecipients('all');
      setSendEmail(true);
      setScheduleEnabled(false);
      setScheduledAt('');
      setPreview(false);
      // Refresh the scheduled queue in case this added a pending row.
      qc.invalidateQueries({ queryKey: ['admin', 'scheduled-announcements'] });
    },
  });

  const canSubmit = title.trim().length >= 3 && body.trim().length >= 10;

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto animate-fade-up">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">
          Bulk Announcements
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send in-app notifications (and optionally email) to a group of users. (NOT-011)
        </p>
      </div>

      {/* Success banner */}
      {result && (
        <div className="mb-6 flex items-start gap-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3">
          <span className="text-emerald-500 mt-0.5">&#x2713;</span>
          <div>
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
              {result.scheduled
                ? `Announcement scheduled for ${result.scheduledAt ? new Date(result.scheduledAt).toLocaleString() : 'the selected time'}`
                : `Announcement sent to ${result.notificationCount} recipient${result.notificationCount !== 1 ? 's' : ''}`}
            </p>
            <button
              onClick={() => setResult(null)}
              className="text-xs text-emerald-600 dark:text-emerald-400 underline mt-0.5"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {send.isError && (
        <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400">
          Failed to send announcement. Please try again.
        </div>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-5">

        {/* Recipient group */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Recipients
          </label>
          <div className="flex flex-wrap gap-2">
            {ANNOUNCEMENT_RECIPIENT_GROUPS.map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => setRecipients(group)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  recipients === group
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-card-foreground border-border hover:border-primary/50'
                }`}
              >
                {ANNOUNCEMENT_RECIPIENT_LABELS[group]}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-foreground">
              Title
            </label>
            <span className={`text-xs ${title.length > MAX_TITLE * 0.9 ? 'text-amber-500' : 'text-muted-foreground'}`}>
              {title.length}/{MAX_TITLE}
            </span>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
            placeholder="Announcement title..."
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Body */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-foreground">
              Message
            </label>
            <span className={`text-xs ${body.length > MAX_BODY * 0.9 ? 'text-amber-500' : 'text-muted-foreground'}`}>
              {body.length}/{MAX_BODY}
            </span>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
            placeholder="Write your announcement here..."
            rows={5}
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </div>

        {/* Email toggle */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={sendEmail}
            onClick={() => setSendEmail((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${sendEmail ? 'bg-primary' : 'bg-muted'}`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform ${sendEmail ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
          <span className="text-sm text-foreground">
            Also send via email
          </span>
        </div>

        {/* Schedule toggle */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={scheduleEnabled}
              onClick={() => setScheduleEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${scheduleEnabled ? 'bg-primary' : 'bg-muted'}`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform ${scheduleEnabled ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
            <span className="text-sm text-foreground">
              Schedule for later
            </span>
          </div>

          {scheduleEnabled && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Send at
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                className="w-full sm:w-auto rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {scheduledAt && new Date(scheduledAt) <= new Date() && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  This time is in the past. The announcement will be sent immediately.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Preview toggle */}
        {(title || body) && (
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            className="text-sm text-primary hover:underline"
          >
            {preview ? 'Hide preview' : 'Show preview'}
          </button>
        )}

        {/* Preview pane */}
        {preview && (title || body) && (
          <div className="rounded-xl border border-border bg-muted p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Preview</p>
            <p className="font-semibold text-foreground text-sm">{title || '(no title)'}</p>
            <p className="text-muted-foreground text-sm mt-1 whitespace-pre-wrap">{body || '(no body)'}</p>
            <p className="text-xs text-muted-foreground mt-2">
              To: <span className="font-medium">{ANNOUNCEMENT_RECIPIENT_LABELS[recipients]}</span>
              {sendEmail && ' · Email will also be sent'}
              {scheduleEnabled && scheduledAt && (
                <span> · Scheduled: {new Date(scheduledAt).toLocaleString()}</span>
              )}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => { setTitle(''); setBody(''); setPreview(false); setResult(null); }}
          >
            Clear
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending
              ? (scheduleEnabled && scheduledAt && new Date(scheduledAt) > new Date() ? 'Scheduling...' : 'Sending...')
              : (scheduleEnabled && scheduledAt && new Date(scheduledAt) > new Date() ? 'Schedule announcement' : 'Send announcement')}
          </Button>
        </div>
      </div>

      {/* L-6: Scheduled announcement queue */}
      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground font-display">
              Scheduled Announcements
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Auto-refreshes every 30 seconds. Pending announcements can be cancelled before their scheduled time.
            </p>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          {!scheduled || scheduled.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No scheduled announcements.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Title</th>
                    <th className="px-4 py-2 text-left font-medium">Recipients</th>
                    <th className="px-4 py-2 text-left font-medium">Scheduled</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-left font-medium">Created by</th>
                    <th className="px-4 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduled.map((row) => {
                    const label =
                      (ANNOUNCEMENT_RECIPIENT_LABELS as Record<string, string>)[row.recipients] ?? row.recipients;
                    const statusStyle: Record<string, string> = {
                      pending:   'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
                      sent:      'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
                      failed:    'bg-destructive/10 text-destructive',
                      cancelled: 'bg-muted text-muted-foreground',
                    };
                    return (
                      <tr key={row.id} className="border-t border-border align-top">
                        <td className="px-4 py-2 text-foreground">
                          <div className="font-medium">{row.title}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[22rem]">
                            {row.body}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {label}
                          {row.sendEmail && (
                            <span className="ml-1 text-[10px] uppercase bg-muted px-1.5 py-0.5 rounded">
                              + email
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {new Date(row.scheduledAt).toLocaleString('en-GB', {
                            day: '2-digit', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusStyle[row.status] ?? 'bg-muted text-muted-foreground'}`}>
                            {row.status}
                          </span>
                          {row.status === 'failed' && row.errorMessage && (
                            <p className="text-[11px] text-destructive mt-1 max-w-[20rem] truncate" title={row.errorMessage}>
                              {row.errorMessage}
                            </p>
                          )}
                          {row.status === 'sent' && typeof row.notificationCount === 'number' && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              Delivered to {row.notificationCount} recipients
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {row.createdByUser?.name ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {row.status === 'pending' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (confirm('Cancel this scheduled announcement? It will not be sent.')) {
                                  cancel.mutate(row.id);
                                }
                              }}
                              disabled={cancel.isPending}
                              className="text-destructive border-destructive/30 hover:bg-destructive/5"
                            >
                              {cancel.isPending ? '...' : 'Cancel'}
                            </Button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
