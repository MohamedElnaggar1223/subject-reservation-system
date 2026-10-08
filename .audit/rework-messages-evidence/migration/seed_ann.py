#!/usr/bin/env python3
"""Seed a dev copy, through main's own API (before step D changes it), with placeholder families
and the announcements main's code makes: immediate ones, a scheduled one the tick sends, a pending
one, a cancelled one (and one marked failed by SQL as the failure path writes it).

Usage: seed_ann.py <api base> <tag>   (tag keeps the placeholder emails unique per database)
"""
import json, sys, time, urllib.request, http.cookiejar, datetime

BASE = sys.argv[1]
TAG = sys.argv[2]
ORIGIN = 'http://localhost:3130'


def client():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(op, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json', 'Origin': ORIGIN})
    try:
        with op.open(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def sign_in(email, password):
    op = client()
    s, b = call(op, 'POST', '/api/auth/sign-in/email', {'email': email, 'password': password})
    assert s == 200, (s, b)
    return op


adm = sign_in('admin@igcse.local', 'AdminPass1')
off = sign_in('officer.mona@igcse.local', 'TestPass1')

families = [('1', 11), ('2', 10), ('3', 11), ('4', 12)]
for n, grade in families:
    s, b = call(off, 'POST', '/v1/links/desk-onboard', {
        'parent': {'email': f'parent.d{n}.{TAG}@rwd.local', 'name': f'Parent D{n}', 'password': 'TestPass1', 'phone': '01000000000'},
        'student': {'email': f'student.d{n}.{TAG}@rwd.local', 'name': f'Student D{n}', 'password': 'TestPass1', 'phone': '01111111111', 'grade': grade},
    })
    print('onboard', n, s, b.get('error'))

now = datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: d.strftime('%Y-%m-%dT%H:%M:%S.000Z')
anns = [
    ('immediate parents', {'title': 'School reopens on Sunday', 'body': 'The school reopens on Sunday at 8:00. Placeholder text for the migration proof.', 'recipients': 'parents', 'sendEmail': True}),
    ('immediate grade 11', {'title': 'Grade 11 timetable', 'body': 'The grade 11 timetable is on the board. Placeholder text for the migration proof.', 'recipients': 'grade_11', 'sendEmail': False}),
    ('scheduled soon, all', {'title': 'Reservations open soon', 'body': 'Reservations for the next session open soon. Placeholder text for the migration proof.', 'recipients': 'all', 'sendEmail': True, 'scheduledAt': iso(now + datetime.timedelta(seconds=75))}),
    ('pending parents', {'title': 'Parents evening', 'body': 'Parents evening next month. Placeholder text for the migration proof.', 'recipients': 'parents', 'sendEmail': True, 'scheduledAt': iso(now + datetime.timedelta(days=30))}),
    ('to cancel', {'title': 'Cancelled notice', 'body': 'This notice was cancelled. Placeholder text for the migration proof.', 'recipients': 'students', 'sendEmail': False, 'scheduledAt': iso(now + datetime.timedelta(days=10))}),
    ('to fail', {'title': 'Grade 12 briefing', 'body': 'Grade 12 briefing. Placeholder text for the migration proof.', 'recipients': 'grade_12', 'sendEmail': True, 'scheduledAt': iso(now + datetime.timedelta(days=20))}),
]
for label, body in anns:
    s, b = call(adm, 'POST', '/v1/notifications/admin/announce', body)
    print('announce', label, s, (b.get('data') or {}).get('message'), b.get('error'))

s, b = call(adm, 'GET', '/v1/notifications/admin/scheduled')
rows = b['data']
cancel = next(r for r in rows if r['title'] == 'Cancelled notice')
s, b2 = call(adm, 'DELETE', f"/v1/notifications/admin/scheduled/{cancel['id']}")
print('cancel', s)

deadline = time.time() + 200
while time.time() < deadline:
    s, b = call(adm, 'GET', '/v1/notifications/admin/scheduled')
    soon = next(r for r in b['data'] if r['title'] == 'Reservations open soon')
    if soon['status'] != 'pending':
        print('scheduled soon:', soon['status'], soon['notificationCount'])
        break
    time.sleep(5)
else:
    print('scheduled soon: still pending after 200 s')
fail = next(r for r in b['data'] if r['title'] == 'Grade 12 briefing')
print('to fail id', fail['id'])
