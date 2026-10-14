// F6a review round, dev data: Physics 0625 (on June 2027's sheet since it was added, with no papers)
// gains its papers on the Catalogue — Paper 2 and Paper 4, required — so the form offers them later
// (the review's finding 1: the whole item had no group). Through the API as the coordinator.
const API = 'http://localhost:3151';
const ORIGIN = 'http://localhost:3150';
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
const coord = await signIn('coordinator.words@igcse.local', 'TestPass1');
const cat = await coord('GET', '/v1/catalogue');
const q = cat.qualifications.find((x) => x.boardCode === 'cambridge' && x.code === '0625');
const unit = async (code, shortCode, title) => cat.units.find((u) => u.boardCode === 'cambridge' && u.code === code)?.id
  ?? (await coord('POST', '/v1/catalogue/units', { boardCode: 'cambridge', code, shortCode, title, unitLevel: 'igcse', kind: 'component' })).id;
const p2 = await unit('0625/21', 'Paper 2', 'Multiple Choice (Extended)');
const p4 = await unit('0625/41', 'Paper 4', 'Theory (Extended)');
await coord('PUT', `/v1/catalogue/qualifications/${q.id}/units`, { units: [{ unitId: p2, requirement: 'required' }, { unitId: p4, requirement: 'required' }] });
console.log('0625 papers', p2, p4);
