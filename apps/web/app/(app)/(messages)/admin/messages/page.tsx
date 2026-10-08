/**
 * Messages and reminders (RESERVATIONS_REWORK.md §3.8, §4.8): a new message — the audience
 * (broadcast, a list in the system, or chosen people) with its resolved count, a template or
 * written text with variables and a preview, the channels, now or later; the log with the
 * deliveries per recipient; the reminder rules per kind with their days and repeats, the sessions'
 * own, and what went out; the school's texts.
 */

import { requireAuth } from '~/lib/auth/session';
import MessagesClient from './messages.client';

export const metadata = {
  title: 'Messages — IGCSE Admin',
};

export default async function MessagesPage(): Promise<React.JSX.Element> {
  const session = await requireAuth();
  return <MessagesClient viewerRole={session.user.role ?? null} />;
}
