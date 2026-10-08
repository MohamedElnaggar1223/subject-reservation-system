/**
 * Registration windows: whether a line is open for a student to register and pay, answered
 * one way for every path.
 *
 * A session is open for a student while it is active, or while the student holds a deadline
 * extension for it (MA-13) — and a line never once its own effective deadline has passed
 * (RESERVATIONS_REWORK.md §3.3): the series' entry deadline (MO-10's hard stop), or its retake
 * deadline for a retake of the board's previous sitting, or its exams' start for a series with
 * no entry deadline (deadline.services.ts). Checkout, confirmation, approval, a payment that
 * fails or is cancelled (whether its lines stay payable) and desk collection ask here.
 */

import { db, registrationSession, eq } from '@repo/db';
import { hasDeadlineExtension } from './exception.services';
import { effectiveDeadlineFor, deadlinePassedSentence, type LineDeadlineKey, type DeadlineKind } from './deadline.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SessionWindow = {
  /** The student may register and pay now. */
  open: boolean;
  entryDeadlinePassed: boolean;
  /** The line's effective deadline (null: none, or the session as a whole). */
  entryDeadline: Date | null;
  deadlineKind: DeadlineKind | null;
  status: string | null;
};

/**
 * `line` is required, so no caller leaves it out by accident:
 * - a line (its series, attempt and prior sitting): that line's effective deadline decides;
 * - `null`, the session as a whole (a new reservation, before its lines exist): no deadline
 *   applies here — each new line's own deadline is checked when it is made (line.services.ts
 *   insertLines), so a January item is still taken after October's deadline in a session that
 *   feeds both, and an October one is refused.
 */
/** A line as the window reads it: its deadline key, and its subject (a subject-scoped extension). */
export type WindowLine = LineDeadlineKey & { subjectId?: string | null };

export async function sessionWindow(
  studentId: string,
  sessionId: string,
  line: WindowLine | null,
  executor: typeof db | Tx = db,
  now: Date = new Date(),
  /** A new reservation's subjects: with the session closed, each must be covered by an extension. */
  subjectIds?: readonly string[],
): Promise<SessionWindow> {
  const [sess] = await executor
    .select({ status: registrationSession.status })
    .from(registrationSession)
    .where(eq(registrationSession.id, sessionId));
  const d = line ? await effectiveDeadlineFor(executor, { ...line, studentId }) : { at: null, kind: null };
  const entryDeadlinePassed = !!d.at && d.at <= now;
  if (!sess || entryDeadlinePassed) {
    return { open: false, entryDeadlinePassed, entryDeadline: d.at, deadlineKind: d.kind, status: sess?.status ?? null };
  }
  let open = sess.status === 'active';
  if (!open) {
    // A deadline extension (deadline.window): the session's covers every subject; a subject's
    // own covers that subject only (the review of step C, item 4).
    const subjects = line?.subjectId ? [line.subjectId] : [...(subjectIds ?? [])];
    if (!subjects.length) open = await hasDeadlineExtension(studentId, sessionId, executor);
    else {
      open = true;
      for (const s of subjects) if (!(await hasDeadlineExtension(studentId, sessionId, executor, s))) { open = false; break; }
    }
  }
  return { open, entryDeadlinePassed: false, entryDeadline: d.at, deadlineKind: d.kind, status: sess.status };
}

export async function sessionOpenFor(
  studentId: string, sessionId: string, line: WindowLine | null, executor: typeof db | Tx = db,
): Promise<boolean> {
  return (await sessionWindow(studentId, sessionId, line, executor)).open;
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
export function entryDeadlineMessage(entryDeadline: Date, kind: DeadlineKind | null = 'entry'): string {
  return deadlinePassedSentence({ at: entryDeadline, kind }, schoolDate);
}

/** The refusal for a closed window, from what sessionWindow answered. */
export function windowRefusal(w: SessionWindow, fallback = 'Registration window is not open'): string {
  return w.entryDeadlinePassed && w.entryDeadline ? entryDeadlineMessage(w.entryDeadline, w.deadlineKind) : fallback;
}
