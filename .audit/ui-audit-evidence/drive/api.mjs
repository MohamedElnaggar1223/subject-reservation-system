// F6 dev data helper: sign in through better-auth and call the API as that account (what the screens do).
export const API = process.env.API ?? 'http://localhost:3071';
export const ORIGIN = process.env.WEB ?? 'http://localhost:3070';
export const out = (...a) => console.log(...a);

export async function signIn(email, password = 'TestPass1') {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  if (r.status !== 200) throw new Error(`sign-in ${email}: ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const call = async (method, path, body, { raw = false } = {}) => {
    const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (raw) return { status: res.status, json };
    if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 600)}`);
    return json?.data ?? json;
  };
  call.email = email;
  return call;
}

export const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
export const ymd = (n) => days(n).slice(0, 10);
export const listOf = (x) => (Array.isArray(x) ? x : x?.items ?? x?.users ?? x?.subjects ?? x?.rows ?? []);
