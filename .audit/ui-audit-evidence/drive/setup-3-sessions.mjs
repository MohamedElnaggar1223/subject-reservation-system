// F6 dev data, part 2: an open June 2027 session with the six shapes on its sheet, set up the way
// the old drawer (main 1b6a216) would, plus an upcoming winter session (point 5) and an empty June
// 2028 (the empty state). Through the API as the admin. Re-runnable.
const API = 'http://localhost:3071';
const ORIGIN = 'http://localhost:3070';
const out = (...a) => console.log(...a);
async function signIn(email, password) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  if (r.status !== 200) throw new Error(`sign-in ${email}: ${r.status}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
    return json?.data ?? json;
  };
}
const admin = await signIn('admin@igcse.local', 'AdminPass1');
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const sessions = await admin('GET', '/v1/sessions');
const mk = async (type, year, start, end, due, courseStartsOn) => sessions.find((s) => s.sessionType === type && s.seriesYear === year && s.label === '')?.id
  ?? (await admin('POST', '/v1/sessions', { type, year, startDate: start, endDate: end, courseStartsOn, paymentDueAt: due })).id;
const june = await mk('june', 2027, days(-1), days(120), days(60), '2026-10-15');
const winter = await mk('winter', 2026, days(20), days(90), days(70), '2026-11-15');
const june28 = await mk('june', 2028, days(200), days(320), days(300), '2027-09-20');
out('sessions', june, winter, june28);

const teachers = await admin('GET', '/v1/teachers');
const tid = (n) => teachers.find((t) => t.name === n).id;
const subjects = await admin('GET', '/v1/subjects');
const list = Array.isArray(subjects) ? subjects : subjects.subjects ?? [];
const sid = (code) => list.find((s) => s.code === code).id;
const offers = await admin('GET', `/v1/sessions/${june}/offers`);
const has = (subjectId) => offers.offers.find((o) => o.subjectId === subjectId);
const add = async (code, body) => has(sid(code)) ?? admin('POST', `/v1/sessions/${june}/offers`, { subjectId: sid(code), ...body });

// O.L.: Arabic (three teachers), Biology (two, one online; its papers from the Catalogue), Chemistry
// (Retake (Self Study ONLY) later), Physics (one), Computer Science (external team later).
await add('0544', { courseFee: 12000, teachers: [{ teacherId: tid('Teacher A'), mode: 'in_school' }, { teacherId: tid('Teacher B'), mode: 'in_school' }, { teacherId: tid('Teacher C'), mode: 'in_school' }] });
await add('0610', { courseFee: 14000, teachers: [{ teacherId: tid('Teacher A'), mode: 'in_school' }, { teacherId: tid('Teacher B'), mode: 'online' }] });
await add('0625', { courseFee: 14000, teachers: [{ teacherId: tid('Teacher C'), mode: 'in_school' }] });
await add('0620', { courseFee: 14000, teachers: [{ teacherId: tid('Teacher B'), mode: 'in_school' }] });
// A.S./A.L.: the IAL per-unit subject, the Cambridge A level, the Arabic A level with two qualifications.
await add('IAL-MATHS', { courseFee: 4000, teachers: [{ teacherId: tid('Teacher A'), mode: 'in_school' }] });
await add('9702', { courseFee: 14000, teachers: [{ teacherId: tid('Teacher C'), mode: 'in_school' }] });
const ar = await add('ARABIC-AL', { courseFee: 9000, teachers: [{ teacherId: tid('Teacher A'), mode: 'in_school' }, { teacherId: tid('Teacher B'), mode: 'in_school' }] });
// The second qualification (GCE 9AA0) under Arabic A.L., in one group with the IAL: the item endpoint (no screen adds one yet).
const list2 = await admin('GET', `/v1/sessions/${june}/offers`);
const arOffer = list2.offers.find((o) => o.subjectId === sid('ARABIC-AL'));
const cat = await admin('GET', '/v1/catalogue');
const gce = cat.qualifications.find((q) => q.boardCode === 'pearson_edexcel' && q.code === '9AA0');
const ial = cat.qualifications.find((q) => q.boardCode === 'pearson_edexcel' && q.code === 'YAA01');
if (!arOffer.items.some((i) => i.kind === 'qualification')) {
  const whole = arOffer.items.find((i) => i.kind === 'whole');
  await admin('PUT', `/v1/sessions/${june}/offers/${arOffer.id}/items/${whole.id}`, { label: 'Arabic IAL (YAA01)', exclusiveGroup: 'qualification', teachers: [{ teacherId: tid('Teacher A'), mode: 'in_school' }] });
  await admin('POST', `/v1/sessions/${june}/offers/${arOffer.id}/items`, {
    label: 'Arabic GCE (9AA0)', kind: 'qualification', enters: { kind: 'award', qualificationId: gce.id }, availability: 'open', requiredInSeries: false,
    exclusiveGroup: 'qualification', teachers: [{ teacherId: tid('Teacher B'), mode: 'in_school' }],
  });
}
// Board fees for June 2027 (finance's Fees tab; one provisional, as a copy brings them).
const list3 = await admin('GET', `/v1/sessions/${june}/offers`);
const camJune = list3.offers.find((o) => o.subject.council === 'cambridge').items[0].boardSeriesId;
const peaJune = list3.offers.find((o) => o.subject.council === 'pearson_edexcel').items[0].boardSeriesId;
const keys = (council) => [...new Map(list3.offers.filter((o) => o.subject.council === council).flatMap((o) => o.items).flatMap((i) => (i.units.length && i.kind !== 'one_paper' ? i.units.map((u) => ['unit', u.unitId]) : [[i.entersKind === 'subject' ? 'subject' : i.kind === 'one_paper' ? 'qualification' : i.entersKind === 'option' ? 'option' : 'qualification', i.entersKind === 'option' ? i.qualificationOptionId : i.entersKind === 'subject' ? null : i.qualificationId]])).filter(([, id]) => id).map((k) => [k.join('|'), k])).values()];
const rows = (council, provisionalFirst) => keys(council).map(([keyKind, keyId], n) => ({ keyKind, keyId, amount: council === 'cambridge' ? 10850 : 4800, provisional: provisionalFirst && n === 0 }));
await admin('PUT', `/v1/board-fees?seriesId=${camJune}`, { rows: rows('cambridge', true), reason: 'F6 dev: the June list' }).catch((e) => out('cambridge fees', e.message));
await admin('PUT', `/v1/board-fees?seriesId=${peaJune}`, { rows: rows('pearson_edexcel', false), reason: 'F6 dev: the June list' }).catch((e) => out('pearson fees', e.message));
out('offers', list3.offers.map((o) => `${o.subject.name}: ${o.items.map((i) => `${i.label}/${i.kind}/${i.availability}`).join(', ')}`).join('\n'));
out(JSON.stringify({ june, winter, june28 }));
