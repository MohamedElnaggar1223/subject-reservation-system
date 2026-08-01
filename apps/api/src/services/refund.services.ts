/**
 * Refund Window Service (V3 §6.12, D-L)
 *
 * Money going back out is time-scaled: finance-admin-defined windows
 * carry percentages; a drop inside a window refunds that percentage of
 * the registration's snapshot price.
 *
 * Scope resolution:
 * 1. Windows scoped to the registration's SESSION win.
 * 2. Otherwise windows scoped to the session's ACADEMIC YEAR apply.
 * 3. If the resolved scope has windows configured, gaps between/after
 *    them are 0%.
 * 4. If NO windows exist for either scope, refunds stay 100% —
 *    pre-V3 behavior until finance configures schedules.
 *
 * The percentage locks at drop-APPROVAL time (never at receipt-return
 * time — paperwork delay must not cost the parent money).
 */

import { db, refundWindow, eq } from '@repo/db';
import { randomUUID } from 'crypto';
import type { CreateRefundWindowType } from '@repo/validations';
import { academicYearForDate } from './school-fee.services';
import { customRefundPercent } from './exception.services';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The refund percentage applying to a drop of the given session's
 * registration at `date`. Returns 0–100.
 */
export async function refundPercentage(
  date: Date,
  sessionId: string,
  studentId?: string
): Promise<number> {
  // Hook 4 (§6.3): a custom_refund_percent exception overrides windows
  if (studentId) {
    const override = await customRefundPercent(studentId, sessionId);
    if (override !== null) return override;
  }

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, sessionId),
    columns: { startDate: true },
  });

  const sessionWindows = await db.query.refundWindow.findMany({
    where: (w, { eq }) => eq(w.sessionId, sessionId),
  });

  let windows = sessionWindows;
  if (windows.length === 0 && sess) {
    const year = academicYearForDate(sess.startDate);
    windows = await db.query.refundWindow.findMany({
      where: (w, { eq }) => eq(w.academicYear, year),
    });
  }

  if (windows.length === 0) return 100; // nothing configured → gate off

  const match = windows.find((w) => w.startsAt <= date && date <= w.endsAt);
  return match ? match.percentage : 0;
}

/**
 * Preview for the parent-facing confirm dialogs: "You will receive
 * X% = EGP Y back" before committing to a drop/swap (§6.12).
 */
export async function previewRefund(registrationId: string) {
  const reg = await db.query.registration.findFirst({
    where: (r, { eq }) => eq(r.id, registrationId),
    columns: { id: true, sessionId: true, studentId: true, priceAtRegistration: true, status: true },
  });
  if (!reg) throw new Error('Registration not found');

  const percentage = await refundPercentage(new Date(), reg.sessionId, reg.studentId);
  return {
    registrationId: reg.id,
    percentage,
    amount: round2((reg.priceAtRegistration * percentage) / 100),
    fullPrice: reg.priceAtRegistration,
  };
}

// ─── Window management (finance admin) ───────────────────────────────────────

export async function createWindow(data: CreateRefundWindowType) {
  const [created] = await db
    .insert(refundWindow)
    .values({
      id: randomUUID(),
      sessionId: data.sessionId ?? null,
      academicYear: data.academicYear ?? null,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      percentage: data.percentage,
      label: data.label ?? null,
    })
    .returning();
  return created;
}

export async function deleteWindow(id: string) {
  const [deleted] = await db.delete(refundWindow).where(eq(refundWindow.id, id)).returning();
  return deleted;
}

export async function getWindows() {
  return db.query.refundWindow.findMany({
    with: { },
    orderBy: (w, { asc }) => [asc(w.startsAt)],
  });
}
