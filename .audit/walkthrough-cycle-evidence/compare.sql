-- The June 2027 set-up, without ids or times, to compare the screens' run with the demo script's.
\pset pager off
\pset footer off
\a
\t
select 'setting', key, value::text from school_setting where key in ('school.name', 'reminders.enabled') order by key;
select 'staff', role, count(*) from "user" where role in ('admin', 'coordinator', 'finance_officer', 'teacher') group by role order by role;
select 'teacher', kind, count(*) from teacher group by kind order by kind;
select 'subject', code, name, council, qualification_level, is_active, coalesce((select code from qualification q where q.id = s.qualification_id), '-') as award,
  coalesce((select string_agg(u.code, ' ' order by u.code) from subject_unit su join exam_unit u on u.id = su.unit_id where su.subject_id = s.id), '-') as units
from subject s order by code;
select 'award', board_code, code, level, entry_method, title,
  coalesce((select string_agg(u.code || ':' || qu.requirement, ' ' order by u.code) from qualification_unit qu join exam_unit u on u.id = qu.unit_id where qu.qualification_id = q.id), '-'),
  coalesce((select string_agg(o.code || '=' || o.label || case when o.carry_forward then '(cf)' else '' end, ' ' order by o.code) from qualification_option o where o.qualification_id = q.id), '-')
from qualification q order by board_code, code, level;
select 'unit', board_code, code, short_code, unit_level, kind from exam_unit order by board_code, code;
select 'session', name, session_type, series_year, status, course_starts_on from registration_session order by name;
select 'offer', s.code, o.availability, o.course_fee,
  coalesce((select string_agg(t.name || '/' || ot.mode, ', ' order by ot.sort_order, t.name) from session_offer_teacher ot join teacher t on t.id = ot.teacher_id where ot.offer_id = o.id), '-')
from session_offer o join subject s on s.id = o.subject_id order by s.code;
select 'item', s.code, i.kind, i.label, i.availability, coalesce(i.course_fee::text, '-'), i.needs_prior_series, coalesce(i.exclusive_group, '-'),
  coalesce((select string_agg(t.name || '/' || it.mode, ', ' order by it.sort_order, t.name) from session_offer_item_teacher it join teacher t on t.id = it.teacher_id where it.item_id = i.id), '-'),
  coalesce((select b.board_code || ' ' || b.month || ' ' || b.year from board_series b where b.id = i.board_series_id), '-')
from session_offer_item i join session_offer o on o.id = i.offer_id join subject s on s.id = o.subject_id order by s.code, i.kind, i.label;
select 'fee', b.board_code, b.month, b.year, f.key_kind,
  coalesce((select code from exam_unit where id = f.unit_id), (select q.code || ' ' || o.code from qualification_option o join qualification q on q.id = o.qualification_id where o.id = f.qualification_option_id), (select code || ' ' || level from qualification where id = f.qualification_id), (select code from subject where id = f.subject_id)) as key,
  f.amount, f.provisional
from board_fee f join board_series b on b.id = f.board_series_id order by b.board_code, key;
select 'series', board_code, month, year, label, entry_deadline, retake_deadline from board_series where year = 2027 order by board_code;
