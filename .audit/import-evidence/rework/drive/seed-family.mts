/**
 * The review of 8 Oct, item 4: a June 2027 session (label "Family check") on the dev system offering
 * Demo Biology with its fee row, for the family's Reserve page in Arabic; the drive closes it while the
 * page is open. Writes its id to /tmp/f7/drive/family.json. Placeholder data only.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { hc } from 'hono/client';
import type { AppType } from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/agent-acf43230a4e06e8b4/apps/api/src/app';
import { apiResponse } from '@repo/validations';

const API = 'http://localhost:3091';
const ORIGIN = 'http://localhost:3090';
const seed = JSON.parse(readFileSync('/tmp/f7/drive/seed.json', 'utf8'));
const signIn = async (email: string, password: string) => {
  const res = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`sign-in ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return hc<AppType>(API, { headers: { Origin: ORIGIN, Cookie: cookie } });
};
const adm = await signIn('admin@igcse.local', process.env.DEMO_ADMIN_PASSWORD ?? '');
const deadline = new Date(Date.now() + 60 * 86_400_000).toISOString();
const series = await apiResponse(adm.v1['board-series'].$get({ query: {} }));
let cam = series.find((s) => s.boardCode === 'cambridge' && s.month === 'june' && s.year === 2027 && s.label === '');
if (cam) await apiResponse(adm.v1['board-series'][':id'].$put({ param: { id: cam.id }, json: { entryDeadline: deadline, reason: 'the board published its June 2027 deadline (demo)' } }));
else cam = await apiResponse(adm.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: 2027, entryDeadline: deadline } }));
const day = 86_400_000;
const session = await apiResponse(adm.v1.sessions.$post({ json: {
  type: 'june', year: 2027, label: process.env.FAMILY_LABEL ?? 'Family check', startDate: new Date(Date.now() - day).toISOString(), endDate: new Date(Date.now() + 30 * day).toISOString(),
  courseStartsOn: new Date().toISOString().slice(0, 10), paymentDueAt: new Date(Date.now() + 30 * day).toISOString(),
} }));
if (session.status === 'draft') await apiResponse(adm.v1.sessions[':id'].activate.$post({ param: { id: session.id } }));
await apiResponse(adm.v1.sessions[':id'].offers.$post({ param: { id: session.id }, json: {
  subjectId: seed.subjects.bio, availability: 'open', courseFee: 12000, grade10Core: false, teachers: [{ teacherId: seed.teacher, mode: 'in_school' }],
  items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: cam!.id, availability: 'open', requiredInSeries: false }],
} }));
await apiResponse(adm.v1['board-fees'].$put({ query: { seriesId: cam!.id }, json: { rows: [{ keyKind: 'subject', keyId: seed.subjects.bio, amount: 10850, provisional: false }] } }));
// A placeholder family at the desk (the officer's onboarding), whose parent reserves on the page.
const officer = await signIn('officer.mona@igcse.local', process.env.FAMILY_PASSWORD ?? '');
const tag = process.env.FAMILY_TAG ?? 'f1';
const fam = await apiResponse(officer.v1.links['desk-onboard'].$post({ json: {
  parent: { email: `demo.family.parent.${tag}@example.test`, name: 'Demo Family Parent', password: process.env.FAMILY_PASSWORD ?? '', phone: '01030000001' },
  student: { email: `demo.family.student.${tag}@example.test`, name: 'Demo Family Student', password: process.env.FAMILY_PASSWORD ?? '', phone: '01030000002', grade: 11 },
} }));
writeFileSync('/tmp/f7/drive/family.json', JSON.stringify({ sessionId: session.id, sessionName: session.name, parentEmail: `demo.family.parent.${tag}@example.test`, studentId: fam.student.id }, null, 1));
console.log('seeded', session.name);
