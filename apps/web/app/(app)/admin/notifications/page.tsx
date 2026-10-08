import { redirect } from 'next/navigation';

/**
 * The bulk announcement form (NOT-011) moved to Messages (step D, RESERVATIONS_REWORK.md §4.8): a
 * broadcast to all, parents, students, a grade or the parents of a grade, scheduled or now, with
 * its deliveries per recipient. Its scheduled announcements are messages since migration 0051.
 */
export default function AdminNotificationsPage(): never {
  redirect('/admin/messages');
}
