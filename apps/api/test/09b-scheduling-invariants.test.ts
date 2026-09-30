import { describe, it, expect } from 'vitest';
import { sql } from './helpers';

/**
 * F1 — rules over every scheduling row the suite leaves behind (it runs after
 * every scenario and race). Read straight from the tables, not through the
 * engine, so a path that wrote around the engine is caught.
 */

const OVERLAP = `a.timetable_id = b.timetable_id and a.id < b.id and a.weekday = b.weekday
  and a.period <= b.period + b.length - 1 and b.period <= a.period + a.length - 1`;

describe('F1: scheduling invariants over the whole database', () => {
  it('no published timetable puts a teacher in two lessons at once', async () => {
    expect(await sql(`
      select t.name, ga.name as a, gb.name as b from timetable_lesson a join timetable_lesson b on ${OVERLAP}
      join timetable t on t.id = a.timetable_id and t.status = 'published'
      join teaching_group ga on ga.id = a.group_id join teaching_group gb on gb.id = b.group_id
      where ga.teacher_id is not null and ga.teacher_id = gb.teacher_id`)).toEqual([]);
  });

  it('no published timetable puts a room to two lessons at once', async () => {
    expect(await sql(`
      select t.name from timetable_lesson a join timetable_lesson b on ${OVERLAP}
      join timetable t on t.id = a.timetable_id and t.status = 'published'
      where a.room_id is not null and a.room_id = b.room_id`)).toEqual([]);
  });

  it('no published timetable puts a student in two lessons at once, on any day of its term they are in both groups', async () => {
    expect(await sql(`
      with members as (
        select m.group_id, m.student_id, m.started_on as f, coalesce(m.ended_on, 'infinity'::date) as t
          from teaching_group_member m where m.ended_on is null or m.ended_on >= m.started_on
        union all
        select g.id, sm.student_id, sm.started_on, coalesce(sm.ended_on, 'infinity'::date)
          from teaching_group g join section_membership sm on sm.section_id = g.section_id where g.kind = 'section'
      ),
      clipped as (
        select m.group_id, m.student_id, m.f, least(m.t, coalesce(u.left_on, 'infinity'::date)) as t
          from members m join "user" u on u.id = m.student_id
      )
      select t.name, ga.name as a, gb.name as b, ma.student_id
        from timetable_lesson a join timetable_lesson b on ${OVERLAP}
        join timetable t on t.id = a.timetable_id and t.status = 'published'
        join academic_term term on term.id = t.term_id
        join teaching_group ga on ga.id = a.group_id join teaching_group gb on gb.id = b.group_id
        join clipped ma on ma.group_id = a.group_id
        join clipped mb on mb.group_id = b.group_id and mb.student_id = ma.student_id
       where a.group_id <> b.group_id
         and greatest(ma.f, mb.f, t.effective_from) <= least(ma.t, mb.t, term.ends_on)`)).toEqual([]);
  });

  it('a published timetable takes effect inside its term; every placed lesson has a whole slot; a locked lesson is placed', async () => {
    expect(await sql(`select t.id from timetable t join academic_term term on term.id = t.term_id
      where t.status = 'published' and (t.effective_from < term.starts_on or t.effective_from > term.ends_on)`)).toEqual([]);
    expect(await sql(`select id from timetable_lesson where (weekday is null) <> (period is null) or (locked and weekday is null)`)).toEqual([]);
  });

  it("a draft's lesson cards match its groups' weekly periods and doubles", async () => {
    expect(await sql(`
      select t.name as timetable, g.name as group_name, g.weekly_periods, g.double_periods,
             coalesce(sum(l.length), 0) as periods, count(l.id) filter (where l.length = 2) as doubles
        from timetable t join academic_term term on term.id = t.term_id
        join teaching_group g on g.academic_year_id = t.academic_year_id
          and (g.archived_on is null or g.archived_on > greatest(term.starts_on, (now() at time zone 'Africa/Cairo')::date))
        left join timetable_lesson l on l.timetable_id = t.id and l.group_id = g.id
       where t.status = 'draft'
       group by t.name, g.name, g.weekly_periods, g.double_periods
      having coalesce(sum(l.length), 0) <> g.weekly_periods or count(l.id) filter (where l.length = 2) <> g.double_periods`)).toEqual([]);
    expect(await sql(`
      select t.name, g.name from timetable_lesson l join timetable t on t.id = l.timetable_id and t.status = 'draft'
      join academic_term term on term.id = t.term_id join teaching_group g on g.id = l.group_id
      where g.archived_on is not null and g.archived_on <= greatest(term.starts_on, (now() at time zone 'Africa/Cairo')::date)`)).toEqual([]);
  });

  it("a member's subject is its group's; nobody is in a group after leaving the school; one open group per subject", async () => {
    expect(await sql(`select m.id from teaching_group_member m join teaching_group g on g.id = m.group_id where m.subject_id is distinct from g.subject_id`)).toEqual([]);
    expect(await sql(`select m.id from teaching_group_member m join "user" u on u.id = m.student_id
      where u.left_on is not null and (m.ended_on is null or m.ended_on > greatest(u.left_on, m.started_on - 1))`)).toEqual([]);
    expect(await sql(`select student_id, subject_id from teaching_group_member where ended_on is null and subject_id is not null
      group by student_id, subject_id, academic_year_id having count(*) > 1`)).toEqual([]);
    expect(await sql(`select m.id from teaching_group_member m join teaching_group g on g.id = m.group_id where g.kind = 'section'`)).toEqual([]);
  });

  it('cover: one live cover per lesson and date; a cover teacher is never in two covers at once nor covers their own lesson; each cover rests on an absence of the lesson’s teacher', async () => {
    expect(await sql(`select lesson_id, date from cover_assignment where status <> 'removed' group by lesson_id, date having count(*) > 1`)).toEqual([]);
    expect(await sql(`
      select a.id from cover_assignment a join cover_assignment b on a.id < b.id and a.date = b.date and a.cover_teacher_id = b.cover_teacher_id
        join timetable_lesson la on la.id = a.lesson_id join timetable_lesson lb on lb.id = b.lesson_id
       where a.status = 'assigned' and b.status = 'assigned'
         and la.period <= lb.period + lb.length - 1 and lb.period <= la.period + la.length - 1`)).toEqual([]);
    expect(await sql(`select id from cover_assignment where status = 'assigned' and cover_teacher_id = original_teacher_id`)).toEqual([]);
    expect(await sql(`
      select c.id from cover_assignment c left join teacher_absence a on a.id = c.absence_id
       where c.status <> 'removed' and c.original_teacher_id is not null
         and (a.id is null or a.cancelled_at is not null or c.date < a.starts_on or c.date > a.ends_on or a.teacher_id <> c.original_teacher_id)`)).toEqual([]);
    // A cover sits on a lesson of a published timetable.
    expect(await sql(`select c.id from cover_assignment c join timetable t on t.id = c.timetable_id where t.status <> 'published'`)).toEqual([]);
  });

  it('a calendar feed has at most one live link per account', async () => {
    expect(await sql(`select user_id from calendar_feed_token where revoked_at is null group by user_id having count(*) > 1`)).toEqual([]);
  });
});
