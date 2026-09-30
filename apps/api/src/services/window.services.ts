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
 * for the window as a whole (a new registration, before its subjects are
 * routed), the window's **earliest** series deadline decides: the window
 * closes before it (the strict order), so past it nothing new is registered
 * in the window, even by a student with a deadline extension, and each
 * existing registration goes on against its own series. A window that feeds
 * no series has no deadline, as a window with none set had before.
 *
 * Callers without a series id (all new registrations, each then routed and
 * checked per series by assertRoutesOpen): the request, direct and override
 * registrations and the desk's registration. Every caller acting on an
 * existing registration passes its series: payment, confirmation, reference,
 * desk collection, swaps, preregistration payment.
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
    : (await windowDeadlines(sessionId, executor)).earliest;
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
