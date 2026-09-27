/**
 * Registration windows: whether a series is open for a student to register
 * and pay, answered one way for every path.
 *
 * A window is open for a student while the session is active, or while the
 * student holds a deadline extension for it (MA-13) — and never once the
 * exam board's entry deadline has passed, since the board then accepts no
 * more entries (owner decision MO-10). Registration, checkout, confirmation,
 * rejection and desk collection all ask here.
 */

import { db, registrationSession, eq } from '@repo/db';
import { hasDeadlineExtension } from './exception.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SessionWindow = {
  /** The student may register and pay now. */
  open: boolean;
  entryDeadlinePassed: boolean;
  entryDeadline: Date | null;
  status: string | null;
};

export async function sessionWindow(
  studentId: string,
  sessionId: string,
  executor: typeof db | Tx = db,
  now: Date = new Date()
): Promise<SessionWindow> {
  const [sess] = await executor
    .select({ status: registrationSession.status, entryDeadline: registrationSession.entryDeadline })
    .from(registrationSession)
    .where(eq(registrationSession.id, sessionId));
  const entryDeadline = sess?.entryDeadline ?? null;
  const entryDeadlinePassed = !!entryDeadline && entryDeadline <= now;
  if (!sess || entryDeadlinePassed) {
    return { open: false, entryDeadlinePassed, entryDeadline, status: sess?.status ?? null };
  }
  const open = sess.status === 'active' || (await hasDeadlineExtension(studentId, sessionId, executor));
  return { open, entryDeadlinePassed: false, entryDeadline, status: sess.status };
}

export async function sessionOpenFor(studentId: string, sessionId: string, executor: typeof db | Tx = db): Promise<boolean> {
  return (await sessionWindow(studentId, sessionId, executor)).open;
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
