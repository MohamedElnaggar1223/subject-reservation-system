-- What a fresh database holds after the migrations (F8 set-up proof).
\pset pager off
select count(*) as migrations_applied from drizzle.__drizzle_migrations;
select 'user' as t, count(*) from "user"
union all select 'exam_board', count(*) from exam_board
union all select 'qualification', count(*) from qualification
union all select 'exam_unit', count(*) from exam_unit
union all select 'subject', count(*) from subject
union all select 'registration_session', count(*) from registration_session
union all select 'board_series', count(*) from board_series
union all select 'board_service', count(*) from board_service
union all select 'exam_board_rule', count(*) from exam_board_rule
union all select 'teacher', count(*) from teacher
union all select 'school_setting', count(*) from school_setting
union all select 'reminder_rule', count(*) from reminder_rule
union all select 'message_template', count(*) from message_template
union all select 'academic_year', count(*) from academic_year;
select code, name, series_months from exam_board order by code;
select board_code, kind, code, label from board_service order by 1, sort_order;
select kind, offsets_days, repeat_every_days, until, channels, active from reminder_rule order by kind;
select name from message_template order by name;
