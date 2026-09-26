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

export function money(v: unknown): number {
  return Math.round(Number(v) * 100) / 100;
}

export type Takings = {
  cashIn: number; escrowApplied: number; byInstrument: Record<string, number>;
  reversedTotal: number; cashRefunded: number; cashOut: number; net: number;
};

/**
 * Today's takings totals. The report is global for the day and the suites
 * share one database, so tests assert deltas against a snapshot, never
 * absolute figures.
 */
export async function takings(officer: Client): Promise<Takings> {
  const date = new Date().toISOString().slice(0, 10);
  const r = await apiResponse(officer.api.v1.payments['daily-takings'].$get({ query: { date } }));
  return r.totals as Takings;
}

export function takingsDelta(before: Takings, after: Takings) {
  const inst: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before.byInstrument), ...Object.keys(after.byInstrument)])) {
    inst[k] = money((after.byInstrument[k] ?? 0) - (before.byInstrument[k] ?? 0));
  }
  return {
    cashIn: money(after.cashIn - before.cashIn),
    escrowApplied: money(after.escrowApplied - before.escrowApplied),
    byInstrument: inst,
    reversedTotal: money(after.reversedTotal - before.reversedTotal),
    cashRefunded: money(after.cashRefunded - before.cashRefunded),
    cashOut: money(after.cashOut - before.cashOut),
    net: money(after.net - before.net),
  };
}
