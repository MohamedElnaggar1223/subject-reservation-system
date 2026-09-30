import { describe, it, expect } from 'vitest';
import { sql } from './helpers';

/**
 * F2 — campus-leave invariants over every row the suite leaves behind
 * (runs after every scenario, as 09 and 09b do). Each rule is a query that
 * must return nothing; a row it returns is named in the failure.
 *
 * - every leave's history is in the audit log, once per step: requested,
 *   decided, cancelled, checked out, back, flagged;
 * - no student has two leaves standing at once on one day;
 * - whoever collected a student was entitled to that day: a linked parent,
 *   or an approved collector of that student, never someone an active
 *   custody restriction named at the time;
 * - a series' dates are its student's, inside its range, on its weekdays;
 * - a pass's version counts its replacements;
 * - a collector approved has its approval on record and a child to collect.
 */

async function none(label: string, query: string) {
  const rows = await sql(query);
  expect(rows, `${label}: ${JSON.stringify(rows.slice(0, 3))}`).toEqual([]);
}

const count = (action: string) => `(select count(*) from audit_log a where a.entity_id = r.id and a.action = '${action}')`;

describe('campus-leave invariants over the whole database', () => {
  it('every leave was requested once, and each later step has exactly its audit row', async () => {
    await none('leave without exactly one LEAVE_REQUESTED', `select r.id from leave_request r where ${count('LEAVE_REQUESTED')} <> 1`);
    await none('approved (or taken) without exactly one LEAVE_APPROVED', `
      select r.id, r.status from leave_request r
      where (r.status in ('approved', 'checked_out', 'returned') or (r.status = 'cancelled' and r.decided_at is not null))
        and ${count('LEAVE_APPROVED')} <> 1`);
    await none('never approved but an approval on record', `select r.id from leave_request r where r.decided_at is null and ${count('LEAVE_APPROVED')} > 0`);
    await none('refused without exactly one LEAVE_REJECTED', `select r.id from leave_request r where (r.status = 'rejected') <> (${count('LEAVE_REJECTED')} = 1)`);
    await none('cancelled without exactly one LEAVE_CANCELLED', `select r.id from leave_request r where (r.status = 'cancelled') <> (${count('LEAVE_CANCELLED')} = 1)`);
    await none('out without exactly one LEAVE_CHECKED_OUT', `select r.id from leave_request r where (r.checked_out_at is not null) <> (${count('LEAVE_CHECKED_OUT')} = 1)`);
    await none('back without exactly one LEAVE_RETURNED', `select r.id from leave_request r where (r.status = 'returned') <> (${count('LEAVE_RETURNED')} = 1)`);
    await none('no-show flag without exactly one LEAVE_NO_SHOW_FLAGGED', `select r.id from leave_request r where (r.no_show_at is not null) <> (${count('LEAVE_NO_SHOW_FLAGGED')} = 1)`);
    await none('late flag without exactly one LEAVE_LATE_RETURN_FLAGGED', `select r.id from leave_request r where (r.late_return_at is not null) <> (${count('LEAVE_LATE_RETURN_FLAGGED')} = 1)`);
    await none("a pass's version not counting its replacements", `select r.id from leave_request r where r.pass_version - 1 <> ${count('LEAVE_PASS_REISSUED')}`);
  });

  it('the order of a leave: approved before it was taken, out before back, never cancelled once taken', async () => {
    await none('checked out before it was approved', `select id from leave_request where checked_out_at < decided_at`);
    await none('back before it left', `select id from leave_request where returned_at < checked_out_at`);
    // (The flags' own times are the scheduler tick's: the suite runs its ticks at chosen times, so they are
    // not compared with the gate's; the database refuses a late flag on a leave nobody checked out.)
    await none('cancelled after the student left', `select id from leave_request where cancelled_at is not null and checked_out_at is not null`);
  });

  it('no student has two leaves standing at once on one day', async () => {
    await none('overlapping standing leaves', `
      select a.id, b.id as other from leave_request a join leave_request b
        on a.student_id = b.student_id and a.date = b.date and a.id < b.id
      where a.status in ('pending', 'approved', 'checked_out', 'returned') and b.status in ('pending', 'approved', 'checked_out', 'returned')
        and a.leave_time < coalesce(b.return_time, '24:00') and b.leave_time < coalesce(a.return_time, '24:00')`);
  });

  it('whoever collected was entitled: a linked parent or an approved collector of that student, never a person a restriction named at the time', async () => {
    await none('collected by a parent not linked to the student', `
      select r.id from leave_request r where r.collected_by_kind = 'parent' and not exists (
        select 1 from parent_student_link l where l.parent_id = r.collected_by_parent_id and l.student_id = r.student_id and l.status = 'approved')`);
    await none("collected by someone not the student's approved collector then", `
      select r.id from leave_request r join leave_collector c on c.id = r.collected_by_collector_id
      where r.collected_by_kind = 'collector' and (
        c.decided_at is null or c.decided_at > r.checked_out_at or c.status = 'rejected'
        or (c.withdrawn_at is not null and c.withdrawn_at < r.checked_out_at)
        or not exists (select 1 from leave_collector_student s where s.collector_id = c.id and s.student_id = r.student_id))`);
    await none('collected by a person an active restriction named', `
      select r.id, x.id as restriction from leave_request r
      join leave_custody_restriction x on x.student_id = r.student_id and x.created_at < r.checked_out_at and (x.ended_at is null or x.ended_at > r.checked_out_at)
      left join leave_collector c on c.id = r.collected_by_collector_id
      where r.checked_out_at is not null and (
        (r.collected_by_kind = 'parent' and x.restricted_user_id = r.collected_by_parent_id)
        or (r.collected_by_kind = 'collector' and x.id_number is not null
            and upper(regexp_replace(x.id_number, '[^0-9A-Za-z]', '', 'g')) = upper(regexp_replace(c.id_number, '[^0-9A-Za-z]', '', 'g'))))`);
    await none('left alone without the kind recorded', `select id from leave_request where collected_by_kind = 'alone' and (collected_by_parent_id is not null or collected_by_collector_id is not null)`);
  });

  it("a series' dates are its own student's, inside its range, on its weekdays", async () => {
    await none('a date outside its series', `
      select r.id from leave_request r join leave_series s on s.id = r.series_id
      where r.student_id <> s.student_id or r.date < s.starts_on or r.date > s.ends_on
        or not (s.weekdays @> to_jsonb(extract(dow from r.date)::int))`);
    await none('a series with no dates', `select s.id from leave_series s where not exists (select 1 from leave_request r where r.series_id = s.id)`);
  });

  it('collectors: approved ones have their approval on record and a child to collect; restrictions end with a reason', async () => {
    await none('an approved collector without LEAVE_COLLECTOR_APPROVED', `
      select c.id from leave_collector c where c.decided_at is not null and c.status in ('approved', 'withdrawn') and c.decision_reason is null
        and not exists (select 1 from audit_log a where a.entity_id = c.id and a.action = 'LEAVE_COLLECTOR_APPROVED')`);
    await none('a live collector with no child', `
      select c.id from leave_collector c where c.status in ('pending', 'approved') and not exists (select 1 from leave_collector_student s where s.collector_id = c.id)`);
    await none('a restriction recorded without its audit row', `
      select x.id from leave_custody_restriction x where not exists (select 1 from audit_log a where a.entity_id = x.id and a.action = 'CUSTODY_RESTRICTION_RECORDED')`);
    await none('a restriction ended without its audit row', `
      select x.id from leave_custody_restriction x where x.ended_at is not null and not exists (select 1 from audit_log a where a.entity_id = x.id and a.action = 'CUSTODY_RESTRICTION_ENDED')`);
  });
});
