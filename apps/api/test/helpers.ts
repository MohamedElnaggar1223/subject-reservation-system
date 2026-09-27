/**
 * Shared helpers for the integration suite.
 *
 * Every call to the API goes through the Hono RPC client (`hc<AppType>`)
 * bound to the in-process app, exactly as the web and mobile apps call it,
 * so a test is typed end to end and a route change that breaks a client
 * breaks the test at compile time. Outcomes are asserted by reading the
 * database back. Nothing here reaches into a service directly.
 *
 * The only raw requests are the two better-auth endpoints (sign-up and
 * sign-in): they are not part of the app's typed surface and the apps use
 * better-auth's own client for them.
 */
import './env';
import { expect } from 'vitest';
import { hc } from 'hono/client';
import { apiResponse } from '@repo/validations';
import type { AppType } from '../src/app';

type Json = Record<string, unknown>;

export type Api = ReturnType<typeof hc<AppType>>;
export type Client = { api: Api; cookie: string; email: string; id: string };

let appPromise: Promise<typeof import('../src/app')> | null = null;
export async function app() {
  appPromise ??= import('../src/app');
  return (await appPromise).appWithRoutes;
}

let dbPromise: Promise<typeof import('@repo/db')> | null = null;
async function dbmod() {
  dbPromise ??= import('@repo/db');
  return dbPromise;
}

const ORIGIN = 'http://localhost:3000';

/** A typed RPC client bound to the in-process app, optionally signed in. */
export async function clientFor(cookie?: string): Promise<Api> {
  const a = await app();
  return hc<AppType>('http://localhost', {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => a.request(input, init)) as typeof fetch,
    headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
  });
}

/** Status and error sentence of a response the test expects to be refused. */
export async function refused(p: Promise<{ status: number; json(): Promise<unknown> }>) {
  const res = await p;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return { status: res.status, error: typeof body.error === 'string' ? body.error : JSON.stringify(body.error ?? '') };
}

/** Raw SQL against the test database. Values are bound, never interpolated. */
export async function sql<T = Json>(text: string, params: unknown[] = []): Promise<T[]> {
  const { db, sql: s } = await dbmod();
  const parts = text.split(/\$\d+/);
  let q = s.raw(parts[0] ?? '');
  for (let i = 1; i < parts.length; i++) {
    q = s`${q}${params[i - 1]}${s.raw(parts[i] ?? '')}`;
  }
  const result = await db.execute(q);
  return result.rows as T[];
}

export async function one<T = Json>(text: string, params: unknown[] = []): Promise<T> {
  const rows = await sql<T>(text, params);
  if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length} for: ${text}`);
  return rows[0] as T;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export const PASSWORD = 'TestPass1';

async function authPost(path: string, json: Json): Promise<Response> {
  const a = await app();
  return a.request(path, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  });
}

function cookieFrom(res: Response): string {
  const set = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const pairs = set.map((c) => c.split(';')[0]);
  if (pairs.length === 0) throw new Error('sign-in returned no cookie');
  return pairs.join('; ');
}

export async function signUp(name: string, email: string): Promise<string> {
  const res = await authPost('/api/auth/sign-up/email', { name, email, password: PASSWORD });
  const body = (await res.json()) as { user?: { id: string } };
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.user!.id;
}

export async function signIn(email: string): Promise<Client> {
  const res = await authPost('/api/auth/sign-in/email', { email, password: PASSWORD });
  const body = (await res.json()) as { user?: { id: string } };
  expect(res.status, JSON.stringify(body)).toBe(200);
  const cookie = cookieFrom(res);
  return { api: await clientFor(cookie), cookie, email, id: body.user!.id };
}

/** Admin accounts are provisioned outside sign-up (as the seed does). */
export async function admin(tag: string): Promise<Client> {
  const email = `admin.${tag}@test.local`;
  await signUp(`Admin ${tag}`, email);
  await sql(`update "user" set role = 'admin' where email = $1`, [email]);
  return signIn(email);
}

export async function staff(adm: Client, role: 'finance_officer' | 'finance_admin', tag: string): Promise<Client> {
  const email = `${role}.${tag}@test.local`;
  await apiResponse(adm.api.v1.users.$post({ json: { name: `${role} ${tag}`, email, password: PASSWORD, role } }));
  return signIn(email);
}

/** A student account with no parent link (created by the admin, not the desk). */
export async function loneStudent(adm: Client, tag: string): Promise<Client> {
  const email = `lone.${tag}@test.local`;
  await apiResponse(adm.api.v1.users.$post({ json: { name: `Lone ${tag}`, email, password: PASSWORD, role: 'student', grade: 11 } }));
  return signIn(email);
}

/** Walk-in family through the desk: parent + student + approved link. */
export async function onboard(officer: Client, tag: string, grade: 10 | 11 | 12 = 11) {
  const parentEmail = `parent.${tag}@test.local`;
  const studentEmail = `student.${tag}@test.local`;
  const r = await apiResponse(
    officer.api.v1.links['desk-onboard'].$post({
      json: {
        parent: { email: parentEmail, name: `Parent ${tag}`, password: PASSWORD, phone: '01000000000' },
        student: { email: studentEmail, name: `Student ${tag}`, password: PASSWORD, phone: '01111111111', grade },
      },
    })
  );
  expect(r.linkStatus).toBe('approved');
  return { parent: await signIn(parentEmail), student: await signIn(studentEmail), studentId: r.student.id };
}

// ─── Catalogue ───────────────────────────────────────────────────────────────

export async function subject(
  adm: Client,
  code: string,
  name: string,
  fees: { course: number; registration: number },
  extra: { qualificationLevel?: 'igcse' | 'as_level' | 'a_level'; isOfferedAtSchool?: boolean; isCore?: boolean } = {}
): Promise<string> {
  const r = await apiResponse(
    adm.api.v1.subjects.$post({
      json: {
        name, code, council: 'cambridge', courseFee: fees.course, registrationFee: fees.registration,
        isOfferedAtSchool: true, isCore: false, ...extra,
      },
    })
  );
  return r.id;
}

export async function session(
  adm: Client,
  name: string,
  sessionType: 'june' | 'november' | 'january',
  qualificationLevel: 'igcse' | 'as_level' | 'a_level',
  opts: { startDate: string; endDate: string; activate?: boolean }
): Promise<string> {
  const r = await apiResponse(
    adm.api.v1.sessions.$post({
      json: { name, sessionType, qualificationLevel, startDate: opts.startDate, endDate: opts.endDate },
    })
  );
  // A session whose start date has already passed is born active; only a
  // draft can (and needs to) be activated by hand.
  if (opts.activate && r.status === 'draft') {
    await apiResponse(adm.api.v1.sessions[':id'].activate.$post({ param: { id: r.id } }));
  }
  return r.id;
}

// ─── Observation ─────────────────────────────────────────────────────────────

/** Poll until `probe` returns a truthy value (fire-and-forget side effects). */
export async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function notificationsFor(email: string, type?: string) {
  return sql<{ type: string; title: string; body: string }>(
    `select n.type, n.title, n.body from notification n join "user" u on u.id = n.user_id
     where u.email = $1 ${type ? 'and n.type = $2' : ''} order by n.created_at`,
    type ? [email, type] : [email]
  );
}

/**
 * The notifications of one type a user has received, once there are `count`
 * of them. Notifications are written after the response, fire-and-forget,
 * and each recipient is a separate insert: reading a second recipient right
 * after the first one's row appeared raced on the CI runner (main run
 * 36276996869, 26 Sep 2026). Always wait per recipient.
 */
export async function notified(email: string, type: string, count: number) {
  return waitFor(async () => {
    const rows = await notificationsFor(email, type);
    return rows.length === count ? rows : null;
  });
}

/**
 * Audit actions recorded against the given entities, once `expected` are all
 * present. Since the security audit (RF-15) every audit write is awaited
 * before the response, so this returns on the first read; the polling is a
 * margin, not a dependency (07-audit-trail.test.ts reads without it).
 */
export async function audited(entityIds: string[], expected: string[]) {
  const placeholders = entityIds.map((_, i) => `$${i + 1}`).join(', ');
  return waitFor(async () => {
    const rows = await sql<{ action: string }>(
      `select action from audit_log where entity_id in (${placeholders}) order by created_at`, entityIds
    );
    const actions = rows.map((r) => r.action);
    const remaining = [...actions];
    const allPresent = expected.every((e) => {
      const i = remaining.indexOf(e);
      if (i === -1) return false;
      remaining.splice(i, 1);
      return true;
    });
    return allPresent ? actions : null;
  });
}

export function money(v: unknown): number {
  return Math.round(Number(v) * 100) / 100;
}

/**
 * Today's date as the server sees it. getDailyTakings reads `${date}T00:00:00`
 * as local midnight, so the date must be the local one, not the UTC one —
 * otherwise the first hours of each Cairo day query yesterday.
 */
export function localToday(): string {
  return new Date().toLocaleDateString('en-CA');
}

const fetchTakings = (officer: Client, date: string) =>
  apiResponse(officer.api.v1.payments['daily-takings'].$get({ query: { date } }));
export type Takings = Awaited<ReturnType<typeof fetchTakings>>['totals'];

/**
 * Today's takings totals. The report is global for the day and the suites
 * share one database, so tests assert deltas against a snapshot, never
 * absolute figures.
 */
export async function takings(officer: Client): Promise<Takings> {
  return (await fetchTakings(officer, localToday())).totals;
}

/** Takings totals for another local date (YYYY-MM-DD). */
export async function takingsOn(officer: Client, date: string): Promise<Takings> {
  return (await fetchTakings(officer, date)).totals;
}

/** Yesterday's local date, for scenarios that move a timestamp back a day. */
export function localYesterday(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
}

// ─── Dates that never expire ─────────────────────────────────────────────────
// The suite must pass on any day, so no test hard-codes a year. Sessions are
// placed relative to today; academic years follow the API's own rule
// (1 July rollover, see school-fee.services.ts academicYearForDate).

export function academicYearOf(d: Date): string {
  const y = d.getFullYear();
  return d.getMonth() >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

const days = (n: number) => n * 24 * 60 * 60 * 1000;

/** A window that is already open today and lies inside today's academic year. */
export function openWindow(): { startDate: string; endDate: string; academicYear: string } {
  const now = new Date();
  const ayStart = new Date(now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1, 6, 1);
  const start = new Date(Math.max(ayStart.getTime(), now.getTime() - days(1)));
  return {
    startDate: start.toISOString(),
    endDate: new Date(now.getTime() + days(300)).toISOString(),
    academicYear: academicYearOf(start),
  };
}

/** A window that has not opened yet (a draft session). */
export function futureWindow(): { startDate: string; endDate: string } {
  const now = new Date();
  return {
    startDate: new Date(now.getTime() + days(90)).toISOString(),
    endDate: new Date(now.getTime() + days(180)).toISOString(),
  };
}

export function takingsDelta(before: Takings, after: Takings) {
  const inst: Record<string, number> = {};
  const b = before.byInstrument as Record<string, number>;
  const a = after.byInstrument as Record<string, number>;
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    inst[k] = money((a[k] ?? 0) - (b[k] ?? 0));
  }
  return {
    moneyIn: money(after.moneyIn - before.moneyIn),
    escrowApplied: money(after.escrowApplied - before.escrowApplied),
    byInstrument: inst,
    reversedTotal: money(after.reversedTotal - before.reversedTotal),
    cashRefunded: money(after.cashRefunded - before.cashRefunded),
    moneyOut: money(after.moneyOut - before.moneyOut),
    net: money(after.net - before.net),
    correctedTotal: money(after.correctedTotal - before.correctedTotal),
    drawer: {
      cashIn: money(after.drawer.cashIn - before.drawer.cashIn),
      cashOut: money(after.drawer.cashOut - before.drawer.cashOut),
      net: money(after.drawer.net - before.drawer.net),
      corrected: money(after.drawer.corrected - before.drawer.corrected),
    },
  };
}

/**
 * Run the payment deadlines the scheduler enforces every minute (grace after
 * a close, exam-board entry deadlines; MONEY_AUDIT.md MO-10). The scheduler is
 * this code's only caller and does not run in tests, so the suite calls it
 * the same way the scheduler does, at a chosen time. The one place the suite
 * reaches past the API: there is no request that triggers it.
 */
export async function runPaymentDeadlines(now: Date = new Date()) {
  const { enforcePaymentDeadlines } = await import('../src/services/payment.services');
  return enforcePaymentDeadlines(now);
}
