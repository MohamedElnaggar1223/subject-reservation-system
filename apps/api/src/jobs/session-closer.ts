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

import { db, user, eq } from '@repo/db';
import { autoManageSessions } from '../services/session.services';
import { notifySessionOpened } from '../services/notification.services';
import { progressGrades } from '../services/grade.services';
import { logger } from '../lib/logger';

const INTERVAL_MS = 60_000; // 1 minute

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the session management scheduler.
 *
 * Runs immediately on first call, then every 60 seconds.
 * Safe to call multiple times — will not create duplicate intervals.
 */
export function startSessionScheduler(): void {
  if (intervalHandle !== null) return;

  async function tick() {
    try {
      const { closed, closedSessions, activated, activatedSessions } = await autoManageSessions();

      if (closed > 0) {
        logger.info(`[session-closer] Auto-closed ${closed} expired session(s).`);

        // GRADE-001: Progress student grades for each unique session type that just closed.
        // Deduplicate session types so we don't run progressGrades twice for the same type.
        const closedTypes = [...new Set(closedSessions.map((s) => s.sessionType))];

        for (const sessionType of closedTypes) {
          try {
            const progressions = await progressGrades(sessionType);
            if (progressions.length > 0) {
              logger.info(
                `[session-closer] GRADE-001: Progressed ${progressions.length} student(s) after ${sessionType} session close.`
              );
            }
          } catch (gradeErr) {
            logger.error(
              `[session-closer] GRADE-001 progression failed for sessionType "${sessionType}":`,
              gradeErr
            );
          }
        }
      }

      if (activated > 0) {
        logger.info(`[session-closer] Auto-activated ${activated} session(s).`);

        // NOT-001: Notify all students and parents when a session window opens
        for (const sess of activatedSessions) {
          try {
            const [allStudents, allParents] = await Promise.all([
              db.select({ id: user.id }).from(user).where(eq(user.role, 'student')),
              db.select({ id: user.id }).from(user).where(eq(user.role, 'parent')),
            ]);

            await notifySessionOpened({
              sessionId:   sess.id,
              sessionName: sess.name,
              sessionType: sess.sessionType,
              deadline:    sess.endDate,
              studentIds:  allStudents.map((u) => u.id),
              parentIds:   allParents.map((u) => u.id),
            });

            logger.info(
              `[session-closer] NOT-001 sent for session "${sess.name}" to ${allStudents.length + allParents.length} users.`
            );
          } catch (notifErr) {
            logger.error(
              `[session-closer] NOT-001 notification failed for session ${sess.id}:`,
              notifErr
            );
          }
        }
      }
    } catch (err) {
      logger.error('[session-closer] Error during session management tick:', err);
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
