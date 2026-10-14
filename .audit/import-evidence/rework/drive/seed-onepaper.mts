/**
 * The review of 2ca07a4, items 1 and 2, on the dev system: Demo Physics in the drive's winter session
 * gains a "Paper 4 only (retake)" item; a synthetic sheet (placeholder family n) has the forms' one-paper
 * retake of it; and a catalogue row the session does not offer yet, for the Add subject dialog at 0.
 * Usage: tsx seed-onepaper.mts <student number> <out.xlsx>
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { hc } from 'hono/client';
import type { AppType } from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/agent-acf43230a4e06e8b4/apps/api/src/app';
import { apiResponse } from '@repo/validations';
import { workbook, type Cell } from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/agent-acf43230a4e06e8b4/apps/api/test/import-fixtures';

const API = 'http://localhost:3091';
const ORIGIN = 'http://localhost:3090';
const seed = JSON.parse(readFileSync('/tmp/f7/drive/seed.json', 'utf8'));
const n = Number(process.argv[2] ?? 51);
const outPath = process.argv[3] ?? '/tmp/f7/drive/onepaper-sheet.xlsx';
const signIn = async (email: string, password: string) => {
  const res = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`sign-in ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return hc<AppType>(API, { headers: { Origin: ORIGIN, Cookie: cookie } });
};
const adm = await signIn('admin@igcse.local', process.env.DEMO_ADMIN_PASSWORD ?? '');
const { offers } = await apiResponse(adm.v1.sessions[':id'].offers.$get({ param: { id: seed.sessionId } }));
const phy = offers.find((o) => o.subject.id === seed.subjects.phy)!;
if (!phy.items.some((i) => i.kind === 'one_paper')) {
  await apiResponse(adm.v1.sessions[':id'].offers[':offerId'].items.$post({ param: { id: seed.sessionId, offerId: phy.id }, json: {
    label: 'Paper 4 only (retake)', kind: 'one_paper', enters: { kind: 'subject' }, boardSeriesId: seed.cambridge, availability: 'retake_only', requiredInSeries: false,
  } }));
}
// A catalogue row with no fee (as the import adds them); a second run finds it there (409).
const made = await adm.v1.subjects.$post({ json: { name: 'Demo Astronomy', code: 'DEMO-ASTRO', council: 'cambridge', qualificationLevel: 'igcse', courseFee: 0, registrationFee: 0, isOfferedAtSchool: false, isCore: false } });
console.log('Demo Astronomy:', made.status);
const C = 'I confirm my registration';
const header: Cell[] = ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', '', ''];
writeFileSync(outPath, workbook([{ name: 'Nov 2026', rows: [['Nov. 2026 Session'], header,
  [`Demo Student ${n}`, '11A', 'O.L.', 'Demo Physics', 'Teacher Demo A', `010100000${n}`, `demo.student${n}@example.test`, `Demo Parent ${n}`, `demo.parent${n}@example.test`, `010200000${n}`, C, 'No',
    'Retake in School 100% fees (One paper ONLY) From June 2026'],
] }]));
console.log('one-paper item on Demo Physics; sheet', outPath);
