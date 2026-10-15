// F6 dev data, part 3: Computer Science (0478) gets its papers on the Catalogue (Paper 1, Paper 2,
// required), for the measurement of a subject added with a one-paper retake. Through the API as a coordinator.
const API = 'http://localhost:3071';
const ORIGIN = 'http://localhost:3070';
async function signIn(email, password) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text).data;
  };
}
const coord = await signIn('coordinator.ui@igcse.local', 'TestPass1');
const cat = await coord('GET', '/v1/catalogue');
const q = cat.qualifications.find((x) => x.boardCode === 'cambridge' && x.code === '0478');
const unit = async (code, shortCode, title) => cat.units.find((u) => u.boardCode === 'cambridge' && u.code === code)?.id
  ?? (await coord('POST', '/v1/catalogue/units', { boardCode: 'cambridge', code, shortCode, title, unitLevel: 'igcse', kind: 'component' })).id;
const p1 = await unit('0478/11', 'Paper 1', 'Computer Systems');
const p2 = await unit('0478/21', 'Paper 2', 'Algorithms, Programming and Logic');
await coord('PUT', `/v1/catalogue/qualifications/${q.id}/units`, { units: [{ unitId: p1, requirement: 'required' }, { unitId: p2, requirement: 'required' }] });
console.log('0478 papers', p1, p2);
