/**
 * The scheduler's messages step (step D, RESERVATIONS_REWORK.md §3.8), run every minute by
 * jobs/session-closer.ts and by the suite at a chosen time (as runPaymentDeadlines is): scheduled
 * messages whose time has come, the reminders due now, the emails waiting, and an email a stopped
 * sender left half-sent marked failed. Each part logs its own failure and the next part still runs.
 */

import { dispatchScheduledMessages, dispatchQueuedEmails, recoverInterruptedEmails } from './message.services';
import { runReminders } from './reminder.services';
import { logger } from '../lib/logger';

export async function runMessagesStep(now: Date = new Date()) {
  const out = { scheduledSent: 0, remindersClaimed: 0, reminderMessages: 0, emailsSent: 0, emailsFailed: 0, interrupted: 0 };
  try {
    out.scheduledSent = (await dispatchScheduledMessages(now)).sent;
  } catch (err) {
    logger.error('[messages] scheduled messages failed:', err);
  }
  try {
    const r = await runReminders(now);
    out.remindersClaimed = r.claimed;
    out.reminderMessages = r.messages;
  } catch (err) {
    logger.error('[messages] reminders failed:', err);
  }
  try {
    const e = await dispatchQueuedEmails();
    out.emailsSent = e.sent;
    out.emailsFailed = e.failed;
  } catch (err) {
    logger.error('[messages] emails failed:', err);
  }
  try {
    out.interrupted = await recoverInterruptedEmails(now);
  } catch (err) {
    logger.error('[messages] interrupted emails check failed:', err);
  }
  if (out.scheduledSent + out.remindersClaimed + out.emailsSent + out.emailsFailed + out.interrupted > 0) {
    logger.info(`[messages] ${out.scheduledSent} scheduled message(s) sent; ${out.remindersClaimed} reminder(s) in ${out.reminderMessages} message(s); emails ${out.emailsSent} sent, ${out.emailsFailed} failed; ${out.interrupted} interrupted.`);
  }
  return out;
}
