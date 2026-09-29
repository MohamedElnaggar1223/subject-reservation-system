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
import { apiResponse, academicYearStartOf, academicYearLabel, seriesYearInAcademicYear } from '@repo/validations';
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

/**
 * A member of staff created on the Team page. A teacher account is linked
 * to a new teacher record made from it (F0a: teaching is a capability).
 */
export async function staff(
  adm: Client,
  role: 'finance_officer' | 'finance_admin' | 'coordinator' | 'teacher' | 'gate',
  tag: string,
  opts: { teacherRecord?: boolean } = {},
): Promise<Client> {
  const email = `${role}.${tag}@test.local`;
  const newTeacherRecord = role === 'teacher' || opts.teacherRecord ? true : undefined;
  await apiResponse(adm.api.v1.users.$post({ json: { name: `${role} ${tag}`, email, password: PASSWORD, role, newTeacherRecord } }));
  return signIn(email);
}

/** A student account with no parent link (created by the admin, not the desk). */
export async function loneStudent(adm: Client, tag: string): Promise<Client> {
  const email = `lone.${tag}@test.local`;
  await apiResponse(adm.api.v1.users.$post({ json: { name: `Lone ${tag}`, email, password: PASSWORD, role: 'student', grade: 11 } }));
  return signIn(email);
}

/** Walk-in family through the desk: parent + student + approved link. */
export async function onboard(officer: Client, tag: string, grade: 9 | 10 | 11 | 12 = 11) {
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

/**
 * A registration window. Its exam series year (F0a) defaults to the series of
 * that type in the academic year the window opens in, so a student's grade in
 * it is their grade that year — the suites' families keep the grade they were
 * onboarded with. A test about the series itself passes `seriesYear`.
 */
export async function session(
  adm: Client,
  name: string,
  sessionType: 'june' | 'october' | 'november' | 'january',
  qualificationLevel: 'igcse' | 'as_level' | 'a_level',
  opts: { startDate: string; endDate: string; activate?: boolean; seriesYear?: number }
): Promise<string> {
  const seriesYear = opts.seriesYear ?? seriesYearInAcademicYear(sessionType, academicYearStartOf(new Date(opts.startDate)));
  const r = await apiResponse(
    adm.api.v1.sessions.$post({
      json: { name, sessionType, seriesYear, qualificationLevel, startDate: opts.startDate, endDate: opts.endDate },
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

/**
 * The school's date (Africa/Cairo) — the day a section move, a leaving date or
 * any other school-calendar date means. Not localToday(): a run in another zone
 * (CI runs in UTC) is on a different date for part of every day.
 */
export function schoolToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
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
  // The API's rule (F0a): 1 July, in Cairo time whatever the zone the suite runs in.
  return academicYearLabel(academicYearStartOf(d));
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
    correctedEscrow: money(after.correctedEscrow - before.correctedEscrow),
    lateTransferTotal: money(after.lateTransferTotal - before.lateTransferTotal),
    closedMonthCorrectionTotal: money(after.closedMonthCorrectionTotal - before.closedMonthCorrectionTotal),
    closedMonthCorrectionEscrow: money(after.closedMonthCorrectionEscrow - before.closedMonthCorrectionEscrow),
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

/**
 * Run the scheduler's session step (close windows that ended, open drafts
 * whose start has come), as the scheduler does every minute. Like
 * runPaymentDeadlines, the scheduler is its only caller. It touches every
 * session in the database, so a suite calls it only where no other suite's
 * session is due to open or close.
 */
export async function runSessionScheduler() {
  const { autoManageSessions } = await import('../src/services/session.services');
  return autoManageSessions();
}

/**
 * Hold a row's lock from a connection of its own until release() is called,
 * so a race can be ordered on purpose: requests fired meanwhile queue on the
 * lock in the order they reach it. `table` is a test-supplied constant.
 */
export async function holdRowLock(table: string, id: string): Promise<() => Promise<void>> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  await client.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
  return async () => {
    await client.query('COMMIT');
    await client.end();
  };
}

/**
 * Wait until `n` sessions in this database are waiting on a lock — the
 * requests a test queued behind holdRowLock — so their order is the order they
 * were fired in, not a guess about how long a request takes to arrive.
 */
export async function lockWaiters(n: number, ms = 5000) {
  return waitFor(async () => {
    const [r] = await sql<{ n: string }>(
      `select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    );
    return Number(r?.n ?? 0) >= n || null;
  }, ms);
}

/**
 * Run the scheduler's recovery sweep (finish interrupted closes, capture
 * preregistrations an opening left behind; STATE_AUDIT.md ST-06), as the
 * scheduler does every minute.
 */
export async function runSessionRecovery() {
  const { recoverSessionTransitions } = await import('../src/services/session.services');
  return recoverSessionTransitions();
}

/**
 * Make the database refuse one audit action until release() is called, so a
 * test can prove a movement and its audit row commit together (SO-1): with
 * the row refused, the request fails and nothing moves. `action` is a
 * test-supplied constant. The trigger is dropped on release; test files run
 * one at a time, so no other suite sees it.
 */
export async function refuseAudit(action: string): Promise<() => Promise<void>> {
  if (!/^[A-Z_]+$/.test(action)) throw new Error(`not an audit action: ${action}`);
  await sql(`create or replace function test_refuse_audit() returns trigger language plpgsql as $$
    begin
      if new.action = '${action}' then raise exception 'test: audit row % refused', new.action; end if;
      return new;
    end $$`);
  await sql(`drop trigger if exists test_refuse_audit on audit_log`);
  await sql(`create trigger test_refuse_audit before insert on audit_log for each row execute function test_refuse_audit()`);
  return async () => {
    await sql(`drop trigger if exists test_refuse_audit on audit_log`);
    await sql(`drop function if exists test_refuse_audit()`);
  };
}

/**
 * The state a system expiry that committed leaves: the registration expired
 * and its REGISTRATION_EXPIRED row, written together as the app does (SO-1).
 * For tests that build a crash's aftermath by hand.
 */
export async function expireByHand(registrationId: string, reason = 'session_closed') {
  await sql(`update registration set status = 'expired', updated_at = now() where id = $1`, [registrationId]);
  await sql(
    `insert into audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data)
     values (gen_random_uuid()::text, null, 'REGISTRATION_EXPIRED', 'registration', $1, '{"status":"pending_payment"}', $2)`,
    [registrationId, JSON.stringify({ status: 'expired', reason })]
  );
}
