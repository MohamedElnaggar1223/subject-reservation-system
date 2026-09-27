import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import { app, admin, staff, onboard, signUp, signIn, subject, session, openWindow, one, sql, PASSWORD, type Client } from './helpers';
import { clientIp } from '../src/lib/client-ip';
import { emailVerificationRequired } from '../src/lib/auth-policy';

/**
 * The auth surface and the money-authority edges (security audit, Phase 1.1).
 *
 * The raw requests in this file are deliberate. They target better-auth's own
 * endpoints (sign-up, sign-in, update-user and the admin plugin), which sit
 * outside the app's typed surface; the question is what those endpoints let a
 * signed-in family member do to their own account. Everything else goes
 * through the typed client.
 */

const ORIGIN = 'http://localhost:3000';

async function raw(path: string, init: { method?: string; json?: unknown; cookie?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const a = await app();
  const headers: Record<string, string> = { Origin: init.origin ?? ORIGIN, ...(init.headers ?? {}) };
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  return a.request(path, {
    method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
}

const roleOf = async (id: string) => (await one<{ role: string | null }>(`select role from "user" where id = $1`, [id])).role;

describe('auth surface', () => {
  let adm: Client, officer: Client, finadmin: Client, parent: Client, student: Client, studentId: string;
  let econ: string, sessionId: string;

  beforeAll(async () => {
    adm = await admin('as');
    officer = await staff(adm, 'finance_officer', 'as');
    finadmin = await staff(adm, 'finance_admin', 'as');
    ({ parent, student, studentId } = await onboard(officer, 'as'));
    econ = await subject(adm, 'AS-ECO', 'Economics (AS, auth surface)', { course: 1200, registration: 300 }, { qualificationLevel: 'as_level' });
    sessionId = await session(adm, 'June (AS, auth surface)', 'june', 'as_level', { ...openWindow(), activate: true });
  });

  it('sign-up cannot choose a role, a grade, a student id or a verified email', async () => {
    const email = 'self.made.admin@test.local';
    const res = await raw('/api/auth/sign-up/email', {
      json: { name: 'Self Made', email, password: PASSWORD, role: 'admin', grade: 12, studentId: 'STU-FAKE-1', emailVerified: true, phone: '0100' },
    });
    expect(res.status).toBeLessThan(500);
    const rows = await sql<{ role: string | null; grade: number | null; student_id: string | null; email_verified: boolean }>(
      `select role, grade, student_id, email_verified from "user" where email = $1`, [email]
    );
    // Either better-auth refuses the request outright, or it creates a plain account.
    if (res.status >= 400) {
      expect(rows).toEqual([]);
    } else {
      expect(rows).toHaveLength(1);
      expect(rows[0]!.role === null || rows[0]!.role === 'user').toBe(true);
      expect(rows[0]).toMatchObject({ grade: null, student_id: null, email_verified: false });
    }
  });

  it('update-user cannot change a role, a grade or a student id', async () => {
    const res = await raw('/api/auth/update-user', {
      cookie: parent.cookie, json: { name: 'Renamed Parent', role: 'admin', grade: 10, studentId: 'STU-FAKE-2' },
    });
    expect(res.status).toBeLessThan(500);
    expect(await one(`select role, grade, student_id from "user" where id = $1`, [parent.id])).toEqual({ role: 'parent', grade: null, student_id: null });
    const s = await raw('/api/auth/update-user', { cookie: student.cookie, json: { role: 'finance_admin', grade: 10 } });
    expect(s.status).toBeLessThan(500);
    expect(await one<{ role: string; grade: number }>(`select role, grade from "user" where id = $1`, [studentId])).toEqual({ role: 'student', grade: 11 });
  });

  it("better-auth's admin endpoints refuse everyone but an admin", async () => {
    for (const who of [parent, student, officer, finadmin]) {
      for (const [path, json] of [
        ['/api/auth/admin/set-role', { userId: who.id, role: 'admin' }],
        ['/api/auth/admin/create-user', { email: `x.${who.id}@test.local`, password: PASSWORD, name: 'X', role: 'admin' }],
        ['/api/auth/admin/set-user-password', { userId: adm.id, newPassword: 'Hijacked1' }],
        ['/api/auth/admin/impersonate-user', { userId: adm.id }],
      ] as const) {
        const res = await raw(path, { cookie: who.cookie, json });
        expect(res.status, `${path} as ${who.email}`).toBe(403);
      }
      expect((await raw('/api/auth/admin/list-users', { cookie: who.cookie })).status).toBe(403);
    }
    expect(await roleOf(parent.id)).toBe('parent');
    expect(await roleOf(finadmin.id)).toBe('finance_admin');
    // The admin's password still works.
    await signIn(adm.email);
  });

  it('a profile update ignores privileged fields', async () => {
    const res = await parent.api.v1.users.me.$put({
      json: { name: 'Parent AS', role: 'admin', grade: 10, studentId: 'STU-FAKE-3', email: 'taken.over@test.local', emailVerified: false } as never,
    });
    expect(res.status).toBe(200);
    expect(await one(`select role, grade, student_id, email from "user" where id = $1`, [parent.id]))
      .toEqual({ role: 'parent', grade: null, student_id: null, email: parent.email });
  });

  it('account setup cannot switch a role that is already set', async () => {
    expect((await student.api.v1.users.me['parent-setup'].$post()).status).toBe(400);
    expect((await officer.api.v1.users.me['student-setup'].$post({ json: { grade: 11 } })).status).toBe(400);
    expect((await parent.api.v1.users.me['student-setup'].$post({ json: { grade: 11 } })).status).toBe(400);
    expect(await roleOf(studentId)).toBe('student');
    expect(await roleOf(officer.id)).toBe('finance_officer');
    expect(await roleOf(parent.id)).toBe('parent');
  });

  it('no endpoint hands the session token to page scripts', async () => {
    // The cookie is HttpOnly so a script cannot read it; a JSON body that
    // repeats the token would undo that.
    const token = decodeURIComponent(parent.cookie.split('session_token=')[1]!.split(';')[0]!).split('.')[0]!;
    const body = await apiResponse(parent.api.v1.session.$get());
    expect(body.user).toMatchObject({ id: parent.id, role: 'parent' });
    expect(body.session as Record<string, unknown>).not.toHaveProperty('token');
    expect(JSON.stringify(body)).not.toContain(token);

    const ba = await raw('/api/auth/get-session', { cookie: parent.cookie });
    expect(ba.status).toBe(200);
    const baBody = (await ba.json()) as { session: Record<string, unknown>; user: { id: string } };
    expect(baBody.user.id).toBe(parent.id);
    expect(baBody.session).not.toHaveProperty('token');
    expect(JSON.stringify(baBody)).not.toContain(token);

    // list-sessions returned the token of every active session.
    const list = await raw('/api/auth/list-sessions', { cookie: parent.cookie });
    expect(list.status).toBe(200);
    const sessions = (await list.json()) as Record<string, unknown>[];
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) expect(s).not.toHaveProperty('token');

    // Sign-in and sign-up returned it too; the cookie must still be set.
    const again = await raw('/api/auth/sign-in/email', { json: { email: parent.email, password: PASSWORD } });
    expect(again.status).toBe(200);
    expect((await again.json()) as Record<string, unknown>).not.toHaveProperty('token');
    expect(again.headers.get('set-cookie')).toContain('session_token');
    const fresh = await raw('/api/auth/sign-up/email', { json: { name: 'Fresh Parent', email: 'fresh.parent.as@test.local', password: PASSWORD } });
    expect(fresh.status).toBe(200);
    expect((await fresh.json()) as Record<string, unknown>).not.toHaveProperty('token');
  });

  it('a ban signs the account out at once and keeps it out (RF-23)', async () => {
    const victim = await staff(adm, 'finance_officer', 'as-ban');
    expect((await victim.api.v1.users.me.$get()).status).toBe(200);
    await apiResponse(adm.api.v1.users[':id'].$put({ param: { id: victim.id }, json: { banned: true } }));
    expect(await sql(`select 1 from session where user_id = $1`, [victim.id])).toEqual([]);
    expect((await victim.api.v1.users.me.$get()).status).toBe(401);
    expect((await victim.api.v1.payments['pending-manual'].$get()).status).toBe(401);
    expect((await raw('/api/auth/sign-in/email', { json: { email: victim.email, password: PASSWORD } })).status).toBe(403);
    await apiResponse(adm.api.v1.users[':id'].$put({ param: { id: victim.id }, json: { banned: false } }));
    await signIn(victim.email);

    // A ban applied some other way (better-auth's own admin endpoint, or the
    // database) leaves the session row in place; the request is still refused.
    const other = await staff(adm, 'finance_officer', 'as-ban2');
    await sql(`update "user" set banned = true where id = $1`, [other.id]);
    expect(await sql(`select 1 from session where user_id = $1`, [other.id])).toHaveLength(1);
    expect((await other.api.v1.users.me.$get()).status).toBe(401);
  });

  it('accounts staff create in person can sign in when verification is required; self-registered ones cannot skip it (RF-22)', async () => {
    const created = await apiResponse(adm.api.v1.users.$post({
      json: { name: 'Staff Made', email: 'staff.made.as@test.local', password: PASSWORD, role: 'student', grade: 11 },
    }));
    const verified = async (id: string) => (await one<{ email_verified: boolean }>(`select email_verified from "user" where id = $1`, [id])).email_verified;
    expect(await verified(created.id)).toBe(true);
    expect(await verified(studentId)).toBe(true); // onboarded at the desk
    expect(await verified(await signUp('Self Registered', 'self.registered.as@test.local'))).toBe(false);
  });

  it('the session cookie is HttpOnly and SameSite=Lax', async () => {
    const res = await raw('/api/auth/sign-in/email', { json: { email: parent.email, password: PASSWORD } });
    expect(res.status).toBe(200);
    const set = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie().find((c) => c.includes('session_token'));
    expect(set).toBeDefined();
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
  });

  it('a cross-site origin cannot use a signed-in cookie on the auth endpoints, nor pass a CORS preflight', async () => {
    // Signing in carries no cookie, so better-auth does not origin-check it; what
    // must hold is that a request riding the victim's cookie from another site is refused.
    const res = await raw('/api/auth/update-user', { origin: 'https://evil.example', cookie: parent.cookie, json: { name: 'Hijacked' } });
    expect(res.status).toBe(403);
    expect((await one<{ name: string }>(`select name from "user" where id = $1`, [parent.id])).name).not.toBe('Hijacked');
    const pre = await raw('/v1/users/me', { method: 'OPTIONS', origin: 'https://evil.example', headers: { 'Access-Control-Request-Method': 'PUT' } });
    expect(pre.headers.get('access-control-allow-origin')).not.toBe('https://evil.example');
    // The app's own API applies the same rule (RF-19): a cookie-bearing write
    // from another origin, or with no origin at all, is refused before any
    // handler runs; from the trusted origin it goes through.
    const forged = await raw('/v1/users/me', { method: 'PUT', cookie: parent.cookie, origin: 'https://evil.example', json: { name: 'Forged' } });
    expect(forged.status).toBe(403);
    const a = await app();
    const noOrigin = await a.request('/v1/users/me', {
      method: 'PUT', headers: { Cookie: parent.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'No Origin' }),
    });
    expect(noOrigin.status).toBe(403);
    expect((await one<{ name: string }>(`select name from "user" where id = $1`, [parent.id])).name).not.toMatch(/Forged|No Origin/);
    // The origin rule is the real defence: Hono's JSON validator does not
    // refuse a text/plain body (it validates it as {}), so without the rule a
    // form post from a sibling subdomain would reach any endpoint whose fields
    // are all optional, or that takes no body at all.
    const formPost = await raw('/v1/users/me/parent-setup', { cookie: parent.cookie, origin: 'https://evil.example', headers: { 'Content-Type': 'text/plain' } , method: 'POST' });
    expect(formPost.status).toBe(403);
    expect((await parent.api.v1.users.me.$put({ json: { name: 'Parent AS' } })).status).toBe(200);
  });

  it('sign-up refuses a weak password', async () => {
    const res = await raw('/api/auth/sign-up/email', { json: { name: 'Weak', email: 'weak.pw@test.local', password: 'password' } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await sql(`select 1 from "user" where email = 'weak.pw@test.local'`)).toEqual([]);
  });

  it('an oversized request body is refused before it is parsed', async () => {
    // A real 2 MB body with its real length, as a browser or curl sends it.
    const a = await app();
    const body = JSON.stringify({ newEmail: 'x'.repeat(2 * 1024 * 1024) + '@test.local' });
    const send = (path: string) => a.request(path, {
      method: 'POST',
      headers: { Origin: ORIGIN, Cookie: parent.cookie, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
      body,
    });
    expect((await send('/v1/users/me/change-email')).status).toBe(413);
    // Uploads get the room the file validators allow; the same size passes the limit there.
    expect((await send('/v1/files/document')).status).not.toBe(413);
  });

  it('rate limits key on the socket address unless the deployment names a proxy header (RF-11)', () => {
    // The limiter keys on clientIp(). A header the client sends itself must
    // not become its "address", or rotating it defeats the limit.
    const ctx = (headers: Record<string, string>) =>
      ({ req: { header: (n: string) => headers[n.toLowerCase()] }, env: {} }) as unknown as Parameters<typeof clientIp>[0];
    expect(clientIp(ctx({ 'cf-connecting-ip': '203.0.113.9' }), undefined)).toBe('unknown');
    expect(clientIp(ctx({ 'x-real-ip': '203.0.113.9' }), undefined)).toBe('unknown');
    expect(clientIp(ctx({ 'cf-connecting-ip': '203.0.113.9' }), 'cf-connecting-ip')).toBe('203.0.113.9');
    // x-forwarded-for: the rightmost entry is the one the proxy appended; the
    // client wrote everything to its left.
    expect(clientIp(ctx({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }), 'x-forwarded-for')).toBe('198.51.100.7');
    expect(clientIp(ctx({}), 'cf-connecting-ip')).toBe('unknown');
  });

  it('the sign-in limiter counts two different client-sent IP headers as one caller, and ignores session reads (RF-11)', async () => {
    // Observed through the limiter's own headers: before the fix each header
    // value opened a fresh bucket; now both land in the same one.
    const attempt = (ip: string) =>
      raw('/api/auth/sign-in/email', { json: { email: parent.email, password: 'WrongPass1' }, headers: { 'cf-connecting-ip': ip } });
    const first = Number((await attempt('203.0.113.1')).headers.get('ratelimit-remaining'));
    const second = Number((await attempt('203.0.113.2')).headers.get('ratelimit-remaining'));
    expect(Number.isFinite(first)).toBe(true);
    expect(second).toBe(first - 1);
    expect((await raw('/api/auth/get-session', { cookie: parent.cookie })).headers.get('ratelimit-remaining')).toBeNull();
  });

  it('email verification is required in production unless explicitly turned off (RF-22)', () => {
    expect(emailVerificationRequired(undefined, 'production')).toBe(true);
    expect(emailVerificationRequired('false', 'production')).toBe(false);
    expect(emailVerificationRequired(undefined, 'development')).toBe(false);
    expect(emailVerificationRequired('true', 'development')).toBe(true);
  });

  it('every response carries the baseline security headers (RF-21)', async () => {
    for (const path of ['/v1/health', '/v1/users/me', '/api/auth/get-session']) {
      const res = await raw(path, { cookie: parent.cookie });
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(res.headers.get('x-frame-options'), path).toBe('SAMEORIGIN');
      expect(res.headers.get('referrer-policy'), path).toBe('no-referrer');
    }
  });

  it("families and staff see a teacher's name, never their phone or email (RF-20)", async () => {
    const t = await apiResponse(adm.api.v1.teachers.$post({ json: { name: 'Ms Teacher AS', phone: '01234567890', email: 'teacher.as@test.local' } }));
    for (const who of [parent, student, officer, finadmin]) {
      const list = await apiResponse(who.api.v1.teachers.$get({ query: {} }));
      expect(list.find((x) => x.id === t!.id)).toMatchObject({ name: 'Ms Teacher AS', phone: null, email: null });
      expect(await apiResponse(who.api.v1.teachers[':id'].$get({ param: { id: t!.id } }))).toMatchObject({ phone: null, email: null });
    }
    expect(await apiResponse(adm.api.v1.teachers[':id'].$get({ param: { id: t!.id } })))
      .toMatchObject({ phone: '01234567890', email: 'teacher.as@test.local' });

    // A subject's teacher list is the same data by another route.
    await apiResponse(adm.api.v1.subjects[':id'].teachers.$put({ param: { id: econ }, json: { teacherIds: [t!.id] } }));
    for (const who of [parent, student, officer]) {
      const onSubject = await apiResponse(who.api.v1.subjects[':id'].teachers.$get({ param: { id: econ } }));
      expect(onSubject.find((x) => x.id === t!.id)).toMatchObject({ name: 'Ms Teacher AS', phone: null, email: null });
    }
    expect((await apiResponse(adm.api.v1.subjects[':id'].teachers.$get({ param: { id: econ } }))).find((x) => x.id === t!.id))
      .toMatchObject({ phone: '01234567890' });
  });

  it('a family cannot spend or withdraw escrow it does not hold', async () => {
    const reg = (await apiResponse(parent.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [econ], studentId } })))[0]!.id;
    const pay = await parent.api.v1.payments.initiate.$post({ json: { registrationIds: [reg], paymentMethod: 'in_school', escrowAmountToApply: 1000 } });
    expect([400, 422]).toContain(pay.status);
    expect(await sql(`select 1 from payment_registration where registration_id = $1`, [reg])).toEqual([]);

    const w = await parent.api.v1.escrow.withdraw.$post({ json: { studentId, amount: 1000 } });
    expect([400, 422]).toContain(w.status);
    expect(await sql(`select 1 from withdrawal_request w join escrow e on e.id = w.escrow_id where e.student_id = $1`, [studentId])).toEqual([]);
  });
});
