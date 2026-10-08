// A uniform school fee for the current academic year on B's dev copy (the fee "Also collect now" offers).
const API = 'http://localhost:3111';
const ORIGIN = 'http://localhost:3110';
const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email: 'admin@igcse.local', password: process.env.DEV_ADMIN_PASSWORD }) });
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const y = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const res = await fetch(`${API}/v1/school-fees/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
  body: JSON.stringify({ academicYear: `${y}-${y + 1}`, amount: 5000, opensAt: new Date(Date.now() - 86_400_000).toISOString() }) });
console.log(res.status, JSON.stringify(await res.json()).slice(0, 200));
