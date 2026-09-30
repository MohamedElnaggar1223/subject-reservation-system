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
import { seriesDeadline } from './series.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SessionWindow = {
  /** The student may register and pay now. */
  open: boolean;
  entryDeadlinePassed: boolean;
  entryDeadline: Date | null;
  status: string | null;
};

/**
 * F0b: the entry deadline is a board series' (MO-10: a hard stop per board
 * series, never per window). `boardSeriesId` is required, so no caller can
 * leave it out by accident:
 * - a registration's series: that series' deadline decides;
 * - `null`, the window as a whole (a new registration, before its subjects are
 *   routed): no deadline applies here. Every such caller then routes each
 *   subject and checks that subject's own series before and inside its
 *   transaction (series.services.ts routeAndCheck / assertRoutesOpen), so a
 *   January subject is still taken after October's deadline in a window that
 *   feeds both, and an October one is refused.
 *
 * Callers with `null`: the request, direct and override registrations and the
 * desk's registration. Callers with the registration's series: approving a
 * request, payment (checkout, preregistration payment), confirmation, a
 * payment that fails or is cancelled (whether its subjects stay payable), desk
 * collection. Not callers: swaps route the new subject with routeAndCheck,
 * which checks its series' deadline; the close's grace reads the deadlines of
 * the checkout's own series (session.services.ts, referenceDueFor), and the
 * transfer reference is judged by the time the close set (referenceDueAt).
 */
export async function sessionWindow(
  studentId: string,
  sessionId: string,
  boardSeriesId: string | null,
  executor: typeof db | Tx = db,
  now: Date = new Date(),
): Promise<SessionWindow> {
  const [sess] = await executor
    .select({ status: registrationSession.status })
    .from(registrationSession)
    .where(eq(registrationSession.id, sessionId));
  const entryDeadline = boardSeriesId ? await seriesDeadline(boardSeriesId, executor) : null;
  const entryDeadlinePassed = !!entryDeadline && entryDeadline <= now;
  if (!sess || entryDeadlinePassed) {
    return { open: false, entryDeadlinePassed, entryDeadline, status: sess?.status ?? null };
  }
  const open = sess.status === 'active' || (await hasDeadlineExtension(studentId, sessionId, executor));
  return { open, entryDeadlinePassed: false, entryDeadline, status: sess.status };
}

export async function sessionOpenFor(
  studentId: string, sessionId: string, boardSeriesId: string | null, executor: typeof db | Tx = db,
): Promise<boolean> {
  return (await sessionWindow(studentId, sessionId, boardSeriesId, executor)).open;
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
