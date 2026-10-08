#!/usr/bin/env python3
"""The migration proof (RESERVATIONS_REWORK.md §7, step D): what a dev copy holds before and after
migrations 0050-0051. Usage: proof.py <db> <before|after> <out.json>

Before and after: every notification row's digest (nothing a family has received may change), the
scheduled announcements, the BULK_ANNOUNCEMENT notifications. After: the messages the announcements
became, their audiences and deliveries, the seeded rules, texts and saved audiences, the audit rows.
"""
import json, os, subprocess, sys

db, phase, out = sys.argv[1], sys.argv[2], sys.argv[3]
env = dict(os.environ, PGPASSWORD='auditpass')


def q(sql):
    r = subprocess.run(['psql', '-h', '127.0.0.1', '-p', '5433', '-U', 'audit', '-d', db, '-At', '-F', '\t', '-c', sql],
                       env=env, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr)
    return [line.split('\t') for line in r.stdout.strip().splitlines() if line]


res = {'database': db, 'phase': phase}
res['migrations'] = q("select count(*), max(created_at) from drizzle.__drizzle_migrations")[0]
res['notifications'] = q("""select count(*), md5(coalesce(string_agg(id || '|' || user_id || '|' || type || '|' || title || '|' || body || '|' ||
  coalesce(read_at::text, '') || '|' || coalesce(email_sent_at::text, '') || '|' || created_at::text, chr(10) order by id), '')) from notification""")[0]
res['bulk_announcement_notifications'] = q("select count(*), count(email_sent_at) from notification where type = 'BULK_ANNOUNCEMENT'")[0]
res['scheduled_announcements'] = q("select id, status, recipients, send_email, coalesce(notification_count::text, '') from scheduled_announcement order by created_at")
if phase == 'after':
    res['messages'] = q("""select m.id, m.source, m.status, array_to_string(m.channels, ','), coalesce(m.recipient_count::text, ''), coalesce(m.legacy_announcement_id, ''),
        a.kind, a.definition::text,
        (select count(*) from message_delivery d where d.message_id = m.id and d.channel = 'in_app'),
        (select count(*) from message_delivery d where d.message_id = m.id and d.channel = 'email' and d.status = 'sent'),
        (select count(*) from message_delivery d where d.message_id = m.id and d.channel = 'email' and d.status = 'failed')
      from message m join message_audience a on a.id = m.audience_id order by m.created_at""")
    res['every_bulk_notification_has_one_delivery'] = q("""select count(*) filter (where n_d = 1), count(*) filter (where n_d <> 1) from (
        select n.id, (select count(*) from message_delivery d where d.notification_id = n.id) as n_d from notification n where n.type = 'BULK_ANNOUNCEMENT') x""")[0]
    res['every_announcement_has_its_message'] = q("""select count(*) filter (where m.id is not null), count(*) filter (where m.id is null)
        from scheduled_announcement a left join message m on m.legacy_announcement_id = a.id""")[0]
    res['status_map'] = q("""select a.status, m.status, count(*) from scheduled_announcement a join message m on m.legacy_announcement_id = a.id group by 1, 2 order by 1""")
    res['templates'] = q("select id, key from message_template order by id")
    res['rules'] = q("select id, kind, coalesce(session_id, ''), array_to_string(offsets_days, ','), coalesce(repeat_every_days::text, ''), array_to_string(channels, ',') from reminder_rule order by id")
    res['saved_audiences'] = q("select id, name, definition::text from message_audience where saved order by id")
    res['audit_backfill_rows'] = q("select count(*), count(distinct entity_id) from audit_log where action = 'REWORK_BACKFILL_MESSAGE'")[0]
    res['claims'] = q("select count(*) from reminder_sent")[0]
json.dump(res, open(out, 'w'), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in res.items() if k in ('migrations', 'notifications', 'bulk_announcement_notifications', 'every_bulk_notification_has_one_delivery', 'every_announcement_has_its_message', 'status_map', 'audit_backfill_rows')}, ensure_ascii=False))
