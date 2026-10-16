\pset pager off
select email, role from "user";
select code, name, council, qualification_level, qualification_id is not null as mapped, course_fee, registration_fee, is_active from subject order by code;
select id, name, session_type, series_year, status, start_date, end_date from registration_session;
select count(*) as qualifications from qualification;
select count(*) as board_series from board_series;
