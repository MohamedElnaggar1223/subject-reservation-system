// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// A placeholder family through the desk's onboarding (API 3111): onboard.mjs <tag> [grade]
const API = 'http://localhost:3111';
const ORIGIN = 'http://localhost:3110';
const tag = process.argv[2];
const grade = Number(process.argv[3] ?? 11);
const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email: 'officer.mona@igcse.local', password: process.env.DEV_PASSWORD }) });
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const res = await fetch(`${API}/v1/links/desk-onboard`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
  body: JSON.stringify({
    parent: { email: `parent.${tag}@igcse.local`, name: `Parent ${tag}`, password: process.env.DEV_PASSWORD, phone: '01000000003' },
    student: { email: `student.${tag}@igcse.local`, name: `Student ${tag}`, password: process.env.DEV_PASSWORD, phone: '01111111113', grade },
  }),
});
console.log(res.status, JSON.stringify(await res.json()).slice(0, 200));
