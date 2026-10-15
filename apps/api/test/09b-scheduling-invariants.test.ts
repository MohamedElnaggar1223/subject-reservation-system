import { describe, it, expect } from 'vitest';
import { sql } from './helpers';

/**
 * F1 — rules over every scheduling row the suite leaves behind (it runs after
 * every scenario and race). Read straight from the tables, not through the
 * engine, so a path that wrote around the engine is caught.
 */

const OVERLAP = `a.timetable_id = b.timetable_id and a.id < b.id and a.weekday = b.weekday
  and a.period <= b.period + b.length - 1 and b.period <= a.period + a.length - 1`;

/** Each group's teacher from a day to a day (dated rows; a group never dated: its teacher throughout). */
const TAUGHT = `taught as (
  select x.group_id, x.teacher_id, x.started_on as f, coalesce(x.ended_on, 'infinity'::date) as t
    from teaching_group_teacher x where x.teacher_id is not null and (x.ended_on is null or x.ended_on >= x.started_on)
  union all
  select g.id, g.teacher_id, '-infinity'::date, 'infinity'::date from teaching_group g
   where g.teacher_id is not null and not exists (select 1 from teaching_group_teacher x where x.group_id = g.id)
)`;

describe('F1: scheduling invariants over the whole database', () => {
  it('no published timetable puts a teacher in two lessons at once, on any day they teach both groups — unless the coordinator went ahead with it (recorded)', async () => {
    expect(await sql(`
      with taught as (
        select x.group_id, x.teacher_id, x.started_on as f, coalesce(x.ended_on, 'infinity'::date) as t
          from teaching_group_teacher x where x.teacher_id is not null and (x.ended_on is null or x.ended_on >= x.started_on)
        union all
        select g.id, g.teacher_id, '-infinity'::date, 'infinity'::date from teaching_group g
         where g.teacher_id is not null and not exists (select 1 from teaching_group_teacher x where x.group_id = g.id)
      )
      select t.name, ga.name as a, gb.name as b, ta.teacher_id from timetable_lesson a join timetable_lesson b on ${OVERLAP}
      join timetable t on t.id = a.timetable_id and t.status = 'published'
      join academic_term term on term.id = t.term_id
      join teaching_group ga on ga.id = a.group_id join teaching_group gb on gb.id = b.group_id
      join taught ta on ta.group_id = a.group_id join taught tb on tb.group_id = b.group_id and tb.teacher_id = ta.teacher_id
      where greatest(ta.f, tb.f, t.effective_from) <= least(ta.t, tb.t, term.ends_on,
              coalesce(ga.archived_on - 1, 'infinity'::date), coalesce(gb.archived_on - 1, 'infinity'::date))
        and not exists (select 1 from published_clash pc where pc.timetable_id = t.id and pc.teacher_id = ta.teacher_id
           and ((pc.lesson_a_id = a.id and pc.lesson_b_id = b.id) or (pc.lesson_a_id = b.id and pc.lesson_b_id = a.id)))`)).toEqual([]);
  });

  it('no published timetable puts a room to two lessons at once', async () => {
    expect(await sql(`
      select t.name from timetable_lesson a join timetable_lesson b on ${OVERLAP}
      join timetable t on t.id = a.timetable_id and t.status = 'published'
      where a.room_id is not null and a.room_id = b.room_id`)).toEqual([]);
  });

  it('no published timetable puts a student in two lessons at once, on any day of its term they are in both groups — unless the coordinator went ahead with it (recorded)', async () => {
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
         and greatest(ma.f, mb.f, t.effective_from) <= least(ma.t, mb.t, term.ends_on)
         and not exists (select 1 from published_clash pc where pc.timetable_id = t.id and pc.student_id = ma.student_id
           and ((pc.lesson_a_id = a.id and pc.lesson_b_id = b.id) or (pc.lesson_a_id = b.id and pc.lesson_b_id = a.id)))`)).toEqual([]);
  });

  it('a published timetable takes effect inside its term; every placed lesson has a whole slot; a locked lesson is placed', async () => {
    expect(await sql(`select t.id from timetable t join academic_term term on term.id = t.term_id
      where t.status = 'published' and (t.effective_from < term.starts_on or t.effective_from > term.ends_on)`)).toEqual([]);
    expect(await sql(`select id from timetable_lesson where (weekday is null) <> (period is null) or (locked and weekday is null)`)).toEqual([]);
  });

  it("a draft's lesson cards match its groups' weekly periods and doubles — none for a group a provider teaches", async () => {
    expect(await sql(`
      select t.name as timetable, g.name as group_name, g.weekly_periods, g.double_periods,
             coalesce(sum(l.length), 0) as periods, count(l.id) filter (where l.length = 2) as doubles
        from timetable t join academic_term term on term.id = t.term_id
        join teaching_group g on g.academic_year_id = t.academic_year_id
          and (g.archived_on is null or g.archived_on > greatest(term.starts_on, (now() at time zone 'Africa/Cairo')::date))
        left join teacher tg on tg.id = g.teacher_id
        left join timetable_lesson l on l.timetable_id = t.id and l.group_id = g.id
       where t.status = 'draft'
       group by t.name, g.name, g.weekly_periods, g.double_periods, tg.kind
      having coalesce(sum(l.length), 0) <> (case when tg.kind = 'provider' then 0 else g.weekly_periods end)
          or count(l.id) filter (where l.length = 2) <> (case when tg.kind = 'provider' then 0 else g.double_periods end)`)).toEqual([]);
    expect(await sql(`
      select t.name, g.name from timetable_lesson l join timetable t on t.id = l.timetable_id and t.status = 'draft'
      join academic_term term on term.id = t.term_id join teaching_group g on g.id = l.group_id
      where g.archived_on is not null and g.archived_on <= greatest(term.starts_on, (now() at time zone 'Africa/Cairo')::date)`)).toEqual([]);
  });

  it("a member's subject and unit are its group's; nobody is in a group after leaving the school; one open group per unit, or per subject with no unit", async () => {
    expect(await sql(`select m.id from teaching_group_member m join teaching_group g on g.id = m.group_id
      where m.subject_id is distinct from g.subject_id or m.unit_id is distinct from g.unit_id`)).toEqual([]);
    expect(await sql(`select student_id, unit_id from teaching_group_member where ended_on is null and unit_id is not null
      group by student_id, unit_id, academic_year_id having count(*) > 1`)).toEqual([]);
    expect(await sql(`select m.id from teaching_group_member m join "user" u on u.id = m.student_id
      where u.left_on is not null and (m.ended_on is null or m.ended_on > greatest(u.left_on, m.started_on - 1))`)).toEqual([]);
    expect(await sql(`select student_id, subject_id from teaching_group_member where ended_on is null and subject_id is not null and unit_id is null
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
    // A live arrangement's lesson is the one held that date: of the version in force then, on that weekday.
    expect(await sql(`
      select c.id, c.date from cover_assignment c
        join timetable_lesson l on l.id = c.lesson_id join timetable t on t.id = c.timetable_id
       where c.status <> 'removed' and (
         l.timetable_id <> c.timetable_id
         or extract(dow from c.date) <> l.weekday
         or c.timetable_id <> (select v.id from timetable v where v.term_id = t.term_id and v.status = 'published' and v.effective_from <= c.date
                                order by v.effective_from desc, v.published_at desc limit 1))`)).toEqual([]);
    // A removed arrangement says why; a live one does not.
    expect(await sql(`select id from cover_assignment where (status = 'removed') <> (removal is not null)
      or removal not in ('by_hand', 'absence_withdrawn', 'cover_teacher_away', 'timetable_changed', 'no_longer_holds')`)).toEqual([]);
    // Round two, flag 2: a live cover never sits against a lesson of the cover teacher's own that day
    // (the version in force then, their teaching on that date: a group's teacher is dated).
    expect(await sql(`
      with ${TAUGHT}
      select c.id, c.date from cover_assignment c join timetable_lesson l on l.id = c.lesson_id
        join timetable_lesson o on o.timetable_id = c.timetable_id and o.id <> l.id and o.weekday = l.weekday
          and o.period <= l.period + l.length - 1 and l.period <= o.period + o.length - 1
        join teaching_group og on og.id = o.group_id and (og.archived_on is null or og.archived_on > c.date)
        join taught ta on ta.group_id = o.group_id and ta.teacher_id = c.cover_teacher_id and c.date between ta.f and ta.t
       where c.status = 'assigned'`)).toEqual([]);
    // Nobody gives cover on a day they are recorded away (at the lesson's periods).
    expect(await sql(`
      select c.id from cover_assignment c join timetable_lesson l on l.id = c.lesson_id
        join teacher_absence a on a.teacher_id = c.cover_teacher_id and a.cancelled_at is null and c.date between a.starts_on and a.ends_on
       where c.status = 'assigned'
         and (a.periods is null or exists (select 1 from jsonb_array_elements_text(a.periods) p where p::int between l.period and l.period + l.length - 1))`)).toEqual([]);
  });

  it("a group's teachers follow one another (one open row, the group's teacher is the latest); a clash went ahead with names a person and its version's lessons", async () => {
    expect(await sql(`
      select g.id from teaching_group g
       where exists (select 1 from teaching_group_teacher x where x.group_id = g.id)
         and g.teacher_id is distinct from (select x.teacher_id from teaching_group_teacher x where x.group_id = g.id order by x.started_on desc, x.created_at desc limit 1)`)).toEqual([]);
    expect(await sql(`
      select a.id from teaching_group_teacher a join teaching_group_teacher b on a.group_id = b.group_id and a.id <> b.id
       where a.started_on <= coalesce(b.ended_on, 'infinity'::date) and b.started_on <= coalesce(a.ended_on, 'infinity'::date)
         and a.ended_on is distinct from a.started_on - 1 and b.ended_on is distinct from b.started_on - 1`)).toEqual([]);
    expect(await sql(`select pc.id from published_clash pc join timetable t on t.id = pc.timetable_id
       join timetable_lesson a on a.id = pc.lesson_a_id join timetable_lesson b on b.id = pc.lesson_b_id
      where t.status <> 'published' or a.timetable_id <> pc.timetable_id or b.timetable_id <> pc.timetable_id`)).toEqual([]);
  });

  it("the rework's model (RESERVATIONS_REWORK.md §10): a provider teaches outside the timetable — no published lesson of a group on a day a provider teaches it; an online group's draft lessons take no room", async () => {
    expect(await sql(`
      with ${TAUGHT}
      select t.name, g.name as group_name from timetable_lesson l join timetable t on t.id = l.timetable_id and t.status = 'published'
        join academic_term term on term.id = t.term_id join teaching_group g on g.id = l.group_id
        join taught ta on ta.group_id = l.group_id join teacher p on p.id = ta.teacher_id and p.kind = 'provider'
       where l.weekday is not null and greatest(ta.f, t.effective_from) <= least(ta.t, term.ends_on)`)).toEqual([]);
    expect(await sql(`
      select l.id from timetable_lesson l join timetable t on t.id = l.timetable_id and t.status = 'draft'
        join teaching_group g on g.id = l.group_id where g.delivery = 'online' and l.room_id is not null`)).toEqual([]);
  });

  it('every leaving is kept: a student away now has an open leaving that matches it, and nobody has two', async () => {
    expect(await sql(`select u.id from "user" u where u.left_on is not null
      and not exists (select 1 from student_leaving s where s.student_id = u.id and s.readmitted_on is null and s.left_on = u.left_on)`)).toEqual([]);
    expect(await sql(`select s.student_id from student_leaving s join "user" u on u.id = s.student_id where s.readmitted_on is null and u.left_on is null`)).toEqual([]);
  });

  it('a calendar feed has at most one live link per account', async () => {
    expect(await sql(`select user_id from calendar_feed_token where revoked_at is null group by user_id having count(*) > 1`)).toEqual([]);
  });
});
