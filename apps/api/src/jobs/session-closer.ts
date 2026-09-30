/**
 * Session Auto-Management Job
 *
 * Runs on a 60-second interval from the moment the API server starts.
 *
 * On each tick it:
 * 1. Closes any ACTIVE sessions whose endDate has passed.
 * 2. Activates any DRAFT sessions whose startDate has arrived,
 *    provided no conflicting active session of the same type exists.
 *
 * This is an MVP implementation using Node.js setInterval.
 * Replace with BullMQ or an external scheduler (Render Cron, Vercel Cron)
 * when moving to a multi-instance deployment.
 */

import { db, payment, registrationSession, eq, and, lte, gte, isNull } from '@repo/db';
import { autoManageSessions, finalizePendingRecords, recoverSessionTransitions } from '../services/session.services';
import { failPayment, enforcePaymentDeadlines } from '../services/payment.services';
import { notifySessionOpened, notifySessionClosingSoon, notifySessionClosed, processScheduledAnnouncements, getStudentAndParentBroadcastIds } from '../services/notification.services';
import { capturePreregistrationsForSession } from '../services/prereg.services';
import { lapseGrade10Exceptions } from '../services/exception-lapse.services';
import { sendDeadlineReminders } from '../services/exam-deadline.services';
import { logAction } from '../services/audit.services';
import { logger } from '../lib/logger';

const INTERVAL_MS = 60_000; // 1 minute
// Fallback Fawry code lifetime when metadata.fawryExpiresAt is missing
// (the stubbed integration sets it, but real providers or restored
// backups may not). PAY-001 specifies "valid for limited time (e.g., 24 hours)".
const FAWRY_FALLBACK_LIFETIME_MS = 24 * 60 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
// Re-entry guard: if a tick takes longer than INTERVAL_MS (slow DB, many
// emails, many stale Fawry rows) setInterval will queue up another tick
// on top. That causes duplicate NOT-002 reminder sends, double work on
// scheduled announcements, and races on reminderSentAt. This flag ensures
// only one tick body runs at a time per process. Multi-instance deployments
// still need an external distributed lock (e.g. Postgres advisory lock)
// or a centralized scheduler (BullMQ, Render Cron).
let tickInFlight = false;

/**
 * Start the session management scheduler.
 *
 * Runs immediately on first call, then every 60 seconds.
 * Safe to call multiple times — will not create duplicate intervals.
 */
export function startSessionScheduler(): void {
  if (intervalHandle !== null) return;

  async function tick() {
    if (tickInFlight) {
      logger.warn('[session-closer] Previous tick still running — skipping this interval.');
      return;
    }
    tickInFlight = true;
    try {
      const { closed, closedSessions, activated, activatedSessions } = await autoManageSessions();

      if (closed > 0) {
        logger.info(`[session-closer] Auto-closed ${closed} expired session(s).`);

        // Finalize pending records (expire registrations, reject change requests) for each closed session
        for (const sess of closedSessions) {
          try {
            const finalized = await finalizePendingRecords(sess.id);
            if (finalized.expiredRegistrations > 0 || finalized.rejectedChangeRequests > 0) {
              logger.info(
                `[session-closer] Finalized ${finalized.expiredRegistrations} registration(s) and ${finalized.rejectedChangeRequests} change request(s) for session "${sess.name}".`
              );
            }
          } catch (finalizeErr) {
            logger.error(`[session-closer] finalizePendingRecords failed for session ${sess.id}:`, finalizeErr);
          }
        }

        // Audit: log each auto-closed session
        for (const sess of closedSessions) {
          await logAction(null, 'SESSION_AUTO_CLOSED', 'session', sess.id, { status: 'active' }, { status: 'closed', name: sess.name, sessionType: sess.sessionType })
            .catch((err) => logger.error(`[session-closer] Audit SESSION_AUTO_CLOSED failed for ${sess.id}:`, err));
        }

        // No grade moves at a close (F0a): grades are derived from each
        // student's cohort and the series' academic year, so window-driven
        // progression, its once-per-series claim and its retry sweep are gone
        // (STATE_AUDIT.md ST-13, FEATURES_PLAN.md F0a).
      }

      // Send closure notifications for auto-closed sessions
      if (closed > 0) {
        for (const sess of closedSessions) {
          try {
            const { studentIds, parentIds } = await getStudentAndParentBroadcastIds();
            await notifySessionClosed({
              sessionId: sess.id,
              sessionName: sess.name,
              studentIds,
              parentIds,
            });
          } catch (err) {
            logger.error(`[session-closer] Closure notification failed for ${sess.id}:`, err);
          }
        }
      }

      // NOT-002: 24-hour closing reminder for active sessions (DB-tracked via reminderSentAt)
      try {
        const now = new Date();
        const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const closingSoon = await db.select().from(registrationSession).where(
          and(
            eq(registrationSession.status, 'active'),
            lte(registrationSession.endDate, in24h),
            gte(registrationSession.endDate, now),
            isNull(registrationSession.reminderSentAt),
          )
        );

        for (const sess of closingSoon) {
          const { studentIds, parentIds } = await getStudentAndParentBroadcastIds();

          await notifySessionClosingSoon({
            sessionId: sess.id,
            sessionName: sess.name,
            deadline: sess.endDate,
            studentIds,
            parentIds,
          });

          // Mark reminder as sent in DB so it persists across restarts
          await db
            .update(registrationSession)
            .set({ reminderSentAt: new Date() })
            .where(eq(registrationSession.id, sess.id));

          logger.info(`[session-closer] NOT-002: 24h reminder sent for "${sess.name}".`);
        }
      } catch (err) {
        logger.error('[session-closer] NOT-002 reminder check failed:', err);
      }

      if (activated > 0) {
        logger.info(`[session-closer] Auto-activated ${activated} session(s).`);

        // Audit: log each auto-activated session
        for (const sess of activatedSessions) {
          await logAction(null, 'SESSION_AUTO_ACTIVATED', 'session', sess.id, { status: 'draft' }, { status: 'active', name: sess.name, sessionType: sess.sessionType })
            .catch((err) => logger.error(`[session-closer] Audit SESSION_AUTO_ACTIVATED failed for ${sess.id}:`, err));
        }

        // V3 §6.8: capture preregistrations for each newly opened session —
        // funded rows confirm (held debited), unfunded fall back to
        // pending_payment. Idempotent; a failure retries next tick since
        // rows stay preregistered.
        for (const sess of activatedSessions) {
          try {
            const { captured, movedToPendingPayment } = await capturePreregistrationsForSession(sess.id);
            if (captured + movedToPendingPayment > 0) {
              logger.info(
                `[session-closer] Prereg capture for "${sess.name}": ${captured} confirmed, ${movedToPendingPayment} to pending_payment.`
              );
            }
          } catch (err) {
            logger.error(`[session-closer] Prereg capture failed for ${sess.id}:`, err);
          }
        }

        // NOT-001: Notify all active students and parents when a session window opens
        for (const sess of activatedSessions) {
          try {
            const { studentIds, parentIds } = await getStudentAndParentBroadcastIds();

            await notifySessionOpened({
              sessionId:   sess.id,
              sessionName: sess.name,
              sessionType: sess.sessionType,
              deadline:    sess.endDate,
              studentIds,
              parentIds,
            });

            logger.info(
              `[session-closer] NOT-001 sent for session "${sess.name}" to ${studentIds.length + parentIds.length} users.`
            );
          } catch (notifErr) {
            logger.error(
              `[session-closer] NOT-001 notification failed for session ${sess.id}:`,
              notifErr
            );
          }
        }
      }
      // F4: remind the coordinator and admin before each board date the school
      // acts by. Each reminder is claimed with the notices it sends, in one
      // transaction: a second instance sends nothing, a failure retries.
      try {
        const { sent } = await sendDeadlineReminders();
        if (sent > 0) logger.info(`[session-closer] Sent ${sent} exam deadline reminder(s).`);
      } catch (err) {
        logger.error('[session-closer] Exam deadline reminders failed:', err);
      }
      // State audit ST-06: finish a close whose finalisation never completed,
      // and capture preregistrations still waiting in an open session.
      try {
        const r = await recoverSessionTransitions();
        if (r.finalized + r.captured + r.strandedClosed > 0) {
          logger.info(`[session-closer] Recovery: finalised ${r.finalized} closed session(s), captured ${r.captured} preregistration(s), closed ${r.strandedClosed} stranded payment(s).`);
        }
      } catch (err) {
        logger.error('[session-closer] Recovery sweep failed:', err);
      }

      // F0a: a grade-10 exception whose validUntil has passed stops covering
      // the waiting registrations it allowed — the same clean-up as a
      // revocation, claimed per exception (status-guarded), idempotent.
      try {
        const l = await lapseGrade10Exceptions();
        if (l.lapsed > 0) {
          logger.info(`[session-closer] ${l.lapsed} grade-10 exception(s) ran out; ${l.registrationsExpired} registration(s) expired, ${l.paymentsClosed} checkout(s) closed.`);
        }
      } catch (err) {
        logger.error('[session-closer] Grade-10 exception lapse failed:', err);
      }

      // Process scheduled announcements whose time has arrived
      try {
        const dispatched = await processScheduledAnnouncements();
        if (dispatched > 0) {
          logger.info(`[session-closer] Dispatched ${dispatched} scheduled announcement(s).`);
        }
      } catch (err) {
        logger.error('[session-closer] Scheduled announcement processing failed:', err);
      }

      // Owner decision MO-10: InstaPay checkouts whose reference never came in
      // the grace period after a close lapse; at a series' exam-board entry
      // deadline, everything still unconfirmed on it is closed.
      try {
        const d = await enforcePaymentDeadlines();
        if (d.referencesLapsed + d.paymentsClosedAtDeadline + d.registrationsExpiredAtDeadline > 0) {
          logger.info(
            `[session-closer] Deadlines: ${d.referencesLapsed} InstaPay checkout(s) lapsed, ${d.paymentsClosedAtDeadline} payment(s) and ${d.registrationsExpiredAtDeadline} registration(s) closed at entry deadlines.`
          );
        }
      } catch (err) {
        logger.error('[session-closer] Payment deadline enforcement failed:', err);
      }

      // Expire stale Fawry payments whose codes have passed their deadline.
      // If metadata.fawryExpiresAt is missing (legacy row, backup restore, or
      // a provider that didn't echo back the field), fall back to
      // createdAt + 24h so the row can still be reaped — otherwise the
      // payment would sit 'pending' forever and keep escrow held.
      try {
        const now = new Date();
        const staleFawry = await db.select({
            id: payment.id,
            metadata: payment.metadata,
            createdAt: payment.createdAt,
          })
          .from(payment)
          .where(and(eq(payment.status, 'pending'), eq(payment.paymentMethod, 'fawry')));

        for (const p of staleFawry) {
          const meta = p.metadata as Record<string, unknown> | null;
          const expiresAtRaw = meta?.fawryExpiresAt as string | undefined;
          const expiresAt = expiresAtRaw
            ? new Date(expiresAtRaw)
            : new Date(p.createdAt.getTime() + FAWRY_FALLBACK_LIFETIME_MS);
          if (expiresAt > now) continue;

          try {
            await failPayment(p.id);
            logger.info(
              `[session-closer] Expired Fawry payment ${p.id} (${expiresAtRaw ? 'metadata' : 'fallback-24h'})`
            );
          } catch (err) {
            logger.error(`[session-closer] Failed to expire Fawry payment ${p.id}:`, err);
          }
        }
      } catch (err) {
        logger.error('[session-closer] Fawry expiry check failed:', err);
      }
    } catch (err) {
      logger.error('[session-closer] Error during session management tick:', err);
    } finally {
      tickInFlight = false;
    }
  }

  // Run immediately on startup to catch any sessions that expired
  // while the server was offline.
  void tick();

  intervalHandle = setInterval(tick, INTERVAL_MS);

  logger.info('[session-closer] Session scheduler started (60s interval).');
}

/**
 * Stop the scheduler (primarily used in tests).
 */
export function stopSessionScheduler(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('[session-closer] Session scheduler stopped.');
  }
}
