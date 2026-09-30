/**
 * The exam deadlines dashboard (FEATURES_PLAN.md F4, "A deadlines dashboard
 * across all series") and the reminders the scheduler sends before them.
 *
 * Every date every board set for every series from a month ago on, in date
 * order, each with what the school still has to do for it: registrations not
 * yet entered and drafts not sent before the entry deadline (the hard stop),
 * forecasts missing before the forecast date, arrangements without approval,
 * the timetable, seats, results and certificates.
 *
 * Reminders (STATE_AUDIT.md ST-06, ST-12): each (series, date, the date's
 * value, tier) is claimed by inserting its row, in the same transaction as the
 * notices it sends — a second scheduler instance on the same tick claims
 * nothing, and a failed tick rolls the claim back for the next one.
 */

import { db, boardSeries, examDeadlineReminder, notification, user, eq, and, inArray, or, isNull, sql } from '@repo/db';
import { randomUUID } from 'crypto';
import { BOARD_SERIES_DATE_LABELS, schoolDateString, type BoardSeriesDateField } from '@repo/validations';
import { getSetting } from './settings.services';
import { logAction } from './audit.services';
import { boardNameMap } from './exam-shared';
import { boardSeriesName } from './series.services';

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

type Field = 'entryDeadline' | BoardSeriesDateField;
const LABEL: Record<Field, string> = { entryDeadline: 'Entry deadline (the school\'s hard stop)', ...BOARD_SERIES_DATE_LABELS };

/** Per series, the counts each date's line reads. */
async function seriesStats(seriesIds: string[]) {
  if (!seriesIds.length) return new Map<string, Record<string, number | boolean>>();
  const ids = sql.join(seriesIds.map((id) => sql`${id}`), sql`, `);
  const rows = (await db.execute(sql`
    select s.id,
      (select count(*)::int from registration r where r.board_series_id = s.id and r.status = 'confirmed'
        and not exists (select 1 from exam_entry e where e.registration_id = r.id and e.status <> 'withdrawn')) as "unentered",
      (select count(*)::int from registration r where r.board_series_id = s.id and r.status in ('pending_approval', 'pending_payment', 'preregistered')) as "waiting",
      (select count(*)::int from exam_entry e where e.board_series_id = s.id and e.status = 'draft') as "drafts",
      (select count(*)::int from exam_entry e where e.board_series_id = s.id and e.status in ('submitted', 'amended')) as "sent",
      (select count(*)::int from exam_entry e join exam_board_rule br on br.board_code = e.board_code
        where e.board_series_id = s.id and e.status <> 'withdrawn' and br.forecast_required and e.forecast_grade is null) as "forecastsMissing",
      (select count(*)::int from exam_entry e where e.board_series_id = s.id and e.status <> 'withdrawn' and e.is_retake and e.status = 'draft') as "retakeDrafts",
      (select count(distinct e.student_id)::int from exam_entry e join exam_candidate c on c.student_id = e.student_id
        where e.board_series_id = s.id and e.status <> 'withdrawn' and jsonb_array_length(c.access_arrangements) > 0 and c.access_arrangements_ref is null) as "arrangementsUnapproved",
      (select count(*)::int from exam_paper p where p.board_series_id = s.id) as "papers",
      (select st.timetable_published_at is not null from exam_series_state st where st.board_series_id = s.id) as "published",
      (select count(*)::int from exam_result r where r.board_series_id = s.id) as "results",
      (select st.results_published_at is not null from exam_series_state st where st.board_series_id = s.id) as "resultsPublished",
      (select count(*)::int from exam_certificate c where c.board_series_id = s.id) as "certificates",
      (select count(*)::int from exam_certificate c where c.board_series_id = s.id and c.status = 'received') as "certificatesWaiting"
    from board_series s where s.id in (${ids})`)).rows as ({ id: string } & Record<string, number | boolean | null>)[];
  return new Map(rows.map(({ id, ...r }) => [id, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? 0])) as Record<string, number | boolean>]));
}

/** What still needs doing for a date, as short sentences (empty: nothing outstanding). */
function outstanding(field: Field, st: Record<string, number | boolean>): string[] {
  const n = (k: string) => Number(st[k] ?? 0);
  const out: string[] = [];
  switch (field) {
    case 'entryDeadline':
      if (n('unentered')) out.push(`${n('unentered')} confirmed registrations have no entry yet`);
      if (n('drafts')) out.push(`${n('drafts')} draft entries not sent to the board`);
      if (n('waiting')) out.push(`${n('waiting')} registrations still waiting for approval or payment`);
      break;
    case 'estimatedEntriesDue':
      if (n('unentered')) out.push(`${n('unentered')} confirmed registrations have no entry yet`);
      break;
    case 'retakeDeadline':
      if (n('retakeDrafts')) out.push(`${n('retakeDrafts')} retake entries not sent`);
      break;
    case 'forecastGradesDue':
      if (n('forecastsMissing')) out.push(`${n('forecastsMissing')} forecast grades missing`);
      break;
    case 'accessArrangementsDue':
      if (n('arrangementsUnapproved')) out.push(`${n('arrangementsUnapproved')} candidates' access arrangements have no board approval`);
      break;
    case 'examsStart':
      if (!n('papers')) out.push('No timetable imported yet');
      else if (!st.published) out.push('The timetable is not published to families yet');
      break;
    case 'resultsOn':
      if (!n('results')) out.push('No results imported yet');
      else if (!st.resultsPublished) out.push('Results not published to families yet');
      break;
    case 'certificatesOn':
      if (!n('certificates')) out.push('No certificates received yet');
      else if (n('certificatesWaiting')) out.push(`${n('certificatesWaiting')} certificates waiting to be collected`);
      break;
    default:
      break;
  }
  return out;
}

/** Every board date from `pastDays` ago on, across all series, in date order, with what is outstanding. */
export async function getDeadlines(pastDays = 30) {
  const today = schoolDateString(new Date());
  const since = schoolDateString(new Date(Date.now() - pastDays * DAY));
  const series = await db.select().from(boardSeries);
  const names = await boardNameMap();
  const stats = await seriesStats(series.map((s) => s.id));
  const items: {
    boardSeriesId: string; seriesName: string; boardCode: string; boardName: string; field: Field; label: string;
    date: string; at: Date | null; daysLeft: number; passed: boolean; outstanding: string[]; hardStop: boolean;
  }[] = [];
  for (const s of series) {
    const dates: [Field, string | null, Date | null][] = [
      ['entryDeadline', s.entryDeadline ? schoolDateString(s.entryDeadline) : null, s.entryDeadline],
      ...(Object.keys(BOARD_SERIES_DATE_LABELS) as BoardSeriesDateField[]).map((f) => [f, s[f] as string | null, null] as [Field, string | null, Date | null]),
    ];
    for (const [field, date, at] of dates) {
      if (!date || date < since) continue;
      const passed = at ? at.getTime() <= Date.now() : date < today;
      items.push({
        boardSeriesId: s.id, seriesName: boardSeriesName(names, s), boardCode: s.boardCode, boardName: names.get(s.boardCode) ?? s.boardCode,
        field, label: LABEL[field], date, at, daysLeft: daysBetween(today, date), passed,
        outstanding: passed && field !== 'certificatesOn' && field !== 'resultsOn' ? [] : outstanding(field, stats.get(s.id) ?? {}),
        hardStop: field === 'entryDeadline',
      });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0) || a.seriesName.localeCompare(b.seriesName));
  const noDeadline = series.filter((s) => !s.entryDeadline).map((s) => ({ id: s.id, name: boardSeriesName(names, s) }));
  return { today, items, seriesWithoutDeadline: noDeadline };
}

/** The dates a reminder goes out for: the ones the school has to act by. */
const REMINDED: Field[] = ['entryDeadline', 'estimatedEntriesDue', 'retakeDeadline', 'forecastGradesDue', 'accessArrangementsDue', 'neaDue'];

/**
 * The scheduler's step: for each date the school acts by, a reminder `N`
 * days before (the setting) and one the day before, to every coordinator and
 * admin, saying what is outstanding. Claimed and sent in one transaction per
 * reminder, so a second instance sends nothing and a failure is retried.
 */
export async function sendDeadlineReminders(now: Date = new Date()) {
  const days = await getSetting('exams.reminderDaysBefore');
  const today = schoolDateString(now);
  const tiers = [...new Set([days, 1])].sort((a, b) => a - b);
  const series = await db.select().from(boardSeries);
  const names = await boardNameMap();
  const stats = await seriesStats(series.map((s) => s.id));
  const staff = (await db.select({ id: user.id }).from(user)
    .where(and(inArray(user.role, ['coordinator', 'admin']), or(eq(user.banned, false), isNull(user.banned))))).map((u) => u.id);
  let sent = 0;
  for (const s of series) {
    for (const field of REMINDED) {
      const date = field === 'entryDeadline' ? (s.entryDeadline ? schoolDateString(s.entryDeadline) : null) : (s[field] as string | null);
      if (!date) continue;
      const left = daysBetween(today, date);
      if (left < 1) continue;
      const tier = tiers.find((t) => left <= t);
      if (tier === undefined) continue;
      const name = boardSeriesName(names, s);
      const todo = outstanding(field, stats.get(s.id) ?? {});
      const title = `${LABEL[field]}: ${name} in ${left} day${left === 1 ? '' : 's'}`;
      const body = `${LABEL[field]} for ${name} is on ${date}. ${todo.length ? `Still to do: ${todo.join('; ')}.` : 'Nothing is outstanding.'}`;
      const claimed = await db.transaction(async (tx) => {
        const [row] = await tx.insert(examDeadlineReminder).values({ boardSeriesId: s.id, dateField: field, dueOn: date, daysBefore: tier, recipients: staff.length })
          .onConflictDoNothing().returning({ id: examDeadlineReminder.boardSeriesId });
        if (!row) return false;
        if (staff.length) {
          await tx.insert(notification).values(staff.map((userId) => ({
            id: randomUUID(), userId, type: 'EXAM_DEADLINE_REMINDER', title, body, data: { boardSeriesId: s.id, field, date, url: '/exams/deadlines' },
          })));
        }
        await logAction(null, 'EXAM_DEADLINE_REMINDED', 'board_series', s.id, null, { field, date, daysBefore: tier, recipients: staff.length, outstanding: todo }, undefined, tx);
        return true;
      });
      if (claimed) sent++;
    }
  }
  return { sent };
}


