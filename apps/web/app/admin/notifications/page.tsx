'use client';

/**
 * Admin — Bulk Announcement Composer Page (NOT-011)
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
import { useMutation } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ANNOUNCEMENT_RECIPIENT_GROUPS, ANNOUNCEMENT_RECIPIENT_LABELS, type AnnouncementRecipientGroup } from '@repo/validations';

export const metadata = {
  title: 'Announcements — Admin',
};

const MAX_TITLE = 150;
const MAX_BODY = 2000;

export default function AdminNotificationsPage() {
  const [title, setTitle]       = useState('');
  const [body, setBody]         = useState('');
  const [recipients, setRecipients] = useState<AnnouncementRecipientGroup>('all');
  const [sendEmail, setSendEmail]   = useState(true);
  const [preview, setPreview]   = useState(false);
  const [result, setResult]     = useState<{ notificationCount: number } | null>(null);

  const send = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.notifications.admin.announce.$post({
          json: { title, body, recipients, sendEmail },
        })
      ),
    onSuccess: (data) => {
      setResult(data as { notificationCount: number });
      setTitle('');
      setBody('');
      setRecipients('all');
      setSendEmail(true);
      setPreview(false);
    },
  });

  const canSubmit = title.trim().length >= 3 && body.trim().length >= 10;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
            Bulk Announcements
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Send in-app notifications (and optionally email) to a group of users. (NOT-011)
          </p>
        </div>

        {/* Success banner */}
        {result && (
          <div className="mb-6 flex items-start gap-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3">
            <span className="text-emerald-500 mt-0.5">✓</span>
            <div>
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                Announcement sent to {result.notificationCount} recipient{result.notificationCount !== 1 ? 's' : ''}
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

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6 space-y-5">

          {/* Recipient group */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
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
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-indigo-300'
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Title
              </label>
              <span className={`text-xs ${title.length > MAX_TITLE * 0.9 ? 'text-amber-500' : 'text-gray-400'}`}>
                {title.length}/{MAX_TITLE}
              </span>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
              placeholder="Announcement title…"
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Body */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Message
              </label>
              <span className={`text-xs ${body.length > MAX_BODY * 0.9 ? 'text-amber-500' : 'text-gray-400'}`}>
                {body.length}/{MAX_BODY}
              </span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
              placeholder="Write your announcement here…"
              rows={5}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          {/* Email toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={sendEmail}
              onClick={() => setSendEmail((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${sendEmail ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform ${sendEmail ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Also send via email
            </span>
          </div>

          {/* Preview toggle */}
          {(title || body) && (
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {preview ? 'Hide preview' : 'Show preview'}
            </button>
          )}

          {/* Preview pane */}
          {preview && (title || body) && (
            <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Preview</p>
              <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{title || '(no title)'}</p>
              <p className="text-gray-600 dark:text-gray-400 text-sm mt-1 whitespace-pre-wrap">{body || '(no body)'}</p>
              <p className="text-xs text-gray-400 mt-2">
                To: <span className="font-medium">{ANNOUNCEMENT_RECIPIENT_LABELS[recipients]}</span>
                {sendEmail && ' · Email will also be sent'}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={() => { setTitle(''); setBody(''); setPreview(false); setResult(null); }}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={!canSubmit || send.isPending}
              onClick={() => send.mutate()}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {send.isPending ? 'Sending…' : 'Send announcement'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
