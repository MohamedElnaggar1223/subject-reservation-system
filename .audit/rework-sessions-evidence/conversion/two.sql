-- A window with lines in two series (the conversion must give the subject two items).
\set ON_ERROR_STOP 1
insert into session_subject_series (session_id, subject_id, board_series_id)
  select id, 'subj_0417', 'bs_two' from registration_session where name = 'November 2026';
-- One live line of 0417 in the second series; one dropped line of 0400 in it too (history pins a series).
update registration set board_series_id = 'bs_two' where id in ('9b710920-756a-4fdb-81d4-2ae926979254', '47ea908c-adec-4474-9442-90e023c154ee');
select id, subject_id, status, board_series_id from registration where board_series_id = 'bs_two';
