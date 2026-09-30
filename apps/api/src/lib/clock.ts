/**
 * The school's "today" for the rules that depend on it (F1 review, flag 5):
 * a timetable takes effect today or later, a group change made now starts
 * today, a group retired by today holds no cards, the version in force today,
 * F0a's "the day the student left cannot be in the future" and readmission.
 *
 * The suite's academic years lie twenty years and more ahead, so no scenario
 * could stand on a day inside one of its terms. A test run (vitest) may move
 * the clock to such a day; nothing reachable over HTTP can, and outside a test
 * run the setter refuses. The clock keeps running from the day it is moved to,
 * so timestamps taken one after another still come in order.
 */
import { schoolDateString } from '@repo/validations';

let offsetMs = 0;

/** Now, as the rules see it. */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

/** Today's date at the school (Africa/Cairo), as the rules see it. */
export function todayAtSchool(): string {
  return schoolDateString(now());
}

/** Tests only: put the school on `at` (the clock runs on from there); null puts it back. */
export function setClockForTests(at: Date | null): void {
  if (!process.env.VITEST) throw new Error('The clock can only be moved in a test run');
  offsetMs = at ? at.getTime() - Date.now() : 0;
}
