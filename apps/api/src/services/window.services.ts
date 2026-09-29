/**
 * Registration windows: whether a series is open for a student to register
 * and pay, answered one way for every path.
 *
 * A window is open for a student while the session is active, or while the
 * student holds a deadline extension for it (MA-13) — and never once the
 * exam board's entry deadline has passed, since the board then accepts no
 * more entries (owner decision MO-10). New registrations (request, direct,
 * admin override, desk), checkout, confirmation, the expiry after a
 * rejection or cancellation, and desk collection ask here. A parent's
 * approval or rejection of a request, and drops and swaps, still check only
 * that the session is active: an active session's window cannot reach past
 * its deadline (the session routes refuse it), but those paths do not honour
 * deadline extensions either (MONEY_AUDIT.md MO-20).
 */

import { db, registrationSession, eq } from '@repo/db';
import { hasDeadlineExtension } from './exception.services';
import { seriesDeadline, windowDeadlines } from './series.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SessionWindow = {
  /** The student may register and pay now. */
  open: boolean;
  entryDeadlinePassed: boolean;
  entryDeadline: Date | null;
  status: string | null;
};

/**
 * F0b: the entry deadline is a board series' (MO-10 per series). Asked for a
 * registration, pass its `boardSeriesId`: its series' deadline decides. Asked
 * for the window as a whole (before a subject is chosen), the window is past
 * its deadline only once every series it feeds is — until then each subject
 * is checked against its own series when it is registered
 * (series.services.ts assertRoutesOpen). A window that feeds no series has
 * no deadline, as a window with none set had before.
 */
export async function sessionWindow(
  studentId: string,
  sessionId: string,
  executor: typeof db | Tx = db,
  now: Date = new Date(),
  boardSeriesId?: string | null,
): Promise<SessionWindow> {
  const [sess] = await executor
    .select({ status: registrationSession.status })
    .from(registrationSession)
    .where(eq(registrationSession.id, sessionId));
  const entryDeadline = boardSeriesId
    ? await seriesDeadline(boardSeriesId, executor)
    : (await windowDeadlines(sessionId, executor)).latest;
  const entryDeadlinePassed = !!entryDeadline && entryDeadline <= now;
  if (!sess || entryDeadlinePassed) {
    return { open: false, entryDeadlinePassed, entryDeadline, status: sess?.status ?? null };
  }
  const open = sess.status === 'active' || (await hasDeadlineExtension(studentId, sessionId, executor));
  return { open, entryDeadlinePassed: false, entryDeadline, status: sess.status };
}

export async function sessionOpenFor(
  studentId: string, sessionId: string, executor: typeof db | Tx = db, boardSeriesId?: string | null,
): Promise<boolean> {
  return (await sessionWindow(studentId, sessionId, executor, new Date(), boardSeriesId)).open;
}

/** A date as the school reads it, in Cairo time. */
export function schoolDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });
}

/** A date and time as the school reads it, in Cairo time. */
export function schoolDateTime(d: Date): string {
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo',
  });
}

/** The sentence a refused action gives once the board's entry deadline has passed. */
export function entryDeadlineMessage(entryDeadline: Date): string {
  return `The registration window is not open: the exam board's entry deadline for this series (${schoolDate(entryDeadline)}) has passed`;
}
