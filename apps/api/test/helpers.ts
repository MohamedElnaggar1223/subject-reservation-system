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

/**
 * A refusal with its machine-readable code (decision 2 of the P1b review: `{ success: false, error, code? }`); `code` is
 * undefined for a refusal that has none.
 */
export async function refusedWithCode(p: Promise<{ status: number; json(): Promise<unknown> }>) {
  const res = await p;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
  return { status: res.status, error: typeof body.error === 'string' ? body.error : JSON.stringify(body.error ?? ''), code: typeof body.code === 'string' ? body.code : undefined };
}

/**
 * Raw SQL against the test database. Values are bound, never interpolated — by position: the n-th placeholder takes
 * params[n - 1], whatever its number, so the placeholders must read $1, $2, … in the order they appear (refused
 * otherwise: `… = $2 where id = $1` bound the values the other way round and silently updated nothing, three times
 * before this check, P1c).
 */
export async function sql<T = Json>(text: string, params: unknown[] = []): Promise<T[]> {
  const { db, sql: s } = await dbmod();
  const numbers = [...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  if (numbers.some((n, i) => n !== i + 1)) throw new Error(`sql(): write the placeholders $1, $2, … in the order they appear (got ${numbers.map((n) => `$${n}`).join(', ')})`);
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

// ─── Sessions and offerings ──────────────────────────────────────────────────

type Level = 'igcse' | 'as_level' | 'a_level';
type OldType = 'june' | 'october' | 'november' | 'january';
type Board = 'cambridge' | 'pearson_edexcel' | 'oxford';
type Sitting = 'june' | 'november' | 'january';

/**
 * The coordinator rework (COORDINATOR_REWORK.md §12, "helpers first"): a suite's sessions and their
 * subjects are set up through the coordinator's routes — a session of a type and year
 * (`POST /sessions`), its dates (`PUT /sessions/:id`), prices final, and for each subject an
 * offering (`POST /sessions/:id/offerings`, the subject "not on the list" by its code) saved with an
 * all-papers row, its cells and its exam fee (`PUT …/offerings/:offeringId`). The suites' windows
 * offer every subject the file made at the window's level — what the conversion did for a converted
 * window — so the money scenarios keep naming subjects. Each file's subjects and sessions are
 * remembered here (vitest runs each file in its own module scope). The rework's own scenarios make
 * their offers explicitly.
 *
 * A suite session keeps a label of its own (so no two collide, one open per type, year and label)
 * and its rows sit in that label's sittings, made with an exam start far ahead (reservable, with no
 * entry deadline until a test sets one) — the board dates a real session reads from the reference
 * data. The deprecated routes and the fee grid they priced from (feedSeries, placeItemsIn, subjectFeeIn,
 * pricedByGrid) left with P1c: every suite subject is priced by its row's exam fee.
 */
type SubjectMeta = {
  id: string; code: string; name: string; level: Level; council: Board; courseFee: number; registrationFee: number; isOfferedAtSchool: boolean; isCore: boolean;
};
type SessionMeta = { id: string; oldType: OldType; level: Level; type: 'june' | 'winter'; year: number; oldYear: number; label: string; adm: Client };
const SUBJECTS: SubjectMeta[] = [];
const SESSIONS: SessionMeta[] = [];
const RUN = Math.random().toString(36).slice(2, 6);
let labels = 0;
let suiteTeacher: Promise<string> | null = null;

/** The file's teacher: an in-school option names who teaches it (D4). */
async function teacherOfTheSuite(adm: Client): Promise<string> {
  suiteTeacher ??= apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher (suite ${RUN})` } })).then((t) => t!.id);
  return suiteTeacher;
}

export async function subject(
  adm: Client,
  code: string,
  name: string,
  fees: { course: number; registration: number },
  extra: {
    qualificationLevel?: 'igcse' | 'as_level' | 'a_level'; isOfferedAtSchool?: boolean; isCore?: boolean;
    council?: 'cambridge' | 'pearson_edexcel' | 'oxford';
  } = {}
): Promise<string> {
  const fields = extra;
  const r = await apiResponse(
    adm.api.v1.subjects.$post({
      json: {
        name, code, council: extra.council ?? 'cambridge', courseFee: fees.course, registrationFee: fees.registration,
        isOfferedAtSchool: true, isCore: false, ...fields,
      },
    })
  );
  const meta: SubjectMeta = {
    id: r.id, code, name, level: extra.qualificationLevel ?? 'igcse', council: extra.council ?? 'cambridge', courseFee: fees.course,
    registrationFee: fees.registration, isOfferedAtSchool: extra.isOfferedAtSchool ?? true, isCore: extra.isCore ?? false,
  };
  SUBJECTS.push(meta);
  // Offered in the file's open and draft windows of its level, as the conversion offers it.
  for (const s of SESSIONS.filter((x) => x.level === meta.level)) {
    const [st] = await sql<{ status: string }>(`select status from registration_session where id = $1`, [s.id]);
    if (st?.status !== 'closed') await offerInSession(adm, s, meta);
  }
  return r.id;
}

/** The months a board sits, as the catalogue says (0038's seed). */
const BOARD_MONTHS: Record<Board, OldType[]> = {
  pearson_edexcel: ['january', 'june', 'october', 'november'],
  cambridge: ['june', 'november'],
  oxford: ['january', 'june', 'november'],
};

/**
 * The sitting a suite window's subject of this board sits in (C1, D12): June in a June window; in a
 * winter one January for a January window whose board sits it (IGCSE never does), else November.
 */
function sittingFor(s: SessionMeta, board: Board, level: Level): { sitting: Sitting; month: OldType; year: number } {
  if (s.type === 'june') return { sitting: 'june', month: 'june', year: s.year };
  if (s.oldType === 'january' && BOARD_MONTHS[board].includes('january') && level !== 'igcse') return { sitting: 'january', month: 'january', year: s.year + 1 };
  return { sitting: 'november', month: 'november', year: s.year };
}

/**
 * A suite window's own sitting for a board (labelled with the window's label, so no two files share
 * one), with an exam start far ahead: reservable, with no entry deadline until a test sets one.
 */
async function suiteSeries(adm: Client, s: SessionMeta, board: Board, level: Level): Promise<string> {
  // A session's series may have been corrected since it was made ("Correct series"): read it again.
  const [now] = await sql<{ type: 'june' | 'winter'; year: number }>(`select session_type as type, series_year as year from registration_session where id = $1`, [s.id]);
  if (now && (now.type !== s.type || now.year !== s.year)) {
    s.type = now.type;
    s.year = now.year;
    if (now.type === 'june') s.oldType = 'june';
    else if (s.oldType === 'june') s.oldType = 'november';
    s.oldYear = s.oldType === 'january' ? now.year + 1 : now.year;
  }
  const { month, year } = sittingFor(s, board, level);
  const [found] = await sql<{ id: string }>(`select id from board_series where board_code = $1 and month = $2 and year = $3 and label = $4`, [board, month, year, s.label]);
  if (found) return found.id;
  const made = await apiResponse(adm.api.v1['board-series'].$post({
    json: { boardCode: board, month, year, label: s.label, examsStart: `${year + 1}-12-31` },
  }));
  return made.id;
}

/**
 * Offer a subject in a suite window through the coordinator's routes: the subject "not on the list" by
 * its code, its course fee and teacher, and one all-papers row in the window's sitting — first entry,
 * retake in school and in self study where the school teaches it, retake in self study where it does
 * not — at its registration fee as the exam fee. A core subject keeps the grade-10 flag (a parked
 * feature the new model does not carry and no route sets since P1c: written as converted data holds it).
 */
async function offerInSession(adm: Client, s: SessionMeta, sub: SubjectMeta) {
  // A subject's board may have changed since it was made (a board-change test): read it again.
  const [now] = await sql<{ council: Board; name: string; code: string }>(`select council, name, code from subject where id = $1`, [sub.id]);
  if (now) { sub.council = now.council; sub.name = now.name; sub.code = now.code; }
  await suiteSeries(adm, s, sub.council, sub.level);
  const { sitting } = sittingFor(s, sub.council, sub.level);
  const teacherId = await teacherOfTheSuite(adm);
  const made = await apiResponse(adm.api.v1.sessions[':id'].offerings.$post({
    param: { id: s.id },
    json: { custom: { board: sub.council, name: sub.name, level: sub.level === 'igcse' ? 'igcse' : 'as_al', group: sub.level === 'igcse' ? 'O.L.' : 'A.S./A.L.', code: sub.code } },
  }));
  await apiResponse(adm.api.v1.sessions[':id'].offerings[':offeringId'].$put({
    param: { id: s.id, offeringId: made.id },
    json: {
      // Added to an open session it starts switched off until reviewed: the suite's subjects are offered at once.
      accepting: true,
      courseFee: sub.courseFee,
      teachers: sub.isOfferedAtSchool ? [{ teacherId, online: false, external: false }] : [],
      rows: [{
        kind: 'all_papers', referenceCodes: [sub.code], sitting, examFee: sub.registrationFee,
        cells: sub.isOfferedAtSchool
          ? { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false }
          : { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: true, firstSelfStudy: false },
      }],
    },
  }));
  if (sub.isCore) await sql(`update session_offer set grade10_core = true where id = $1`, [made.id]);
}

/**
 * A registration window, as a session set up by the coordinator: a window of June stays June, an
 * October or November window is the winter session of its year, a January one the winter of the year
 * before; each gets a label of its own (so the suites' sessions never collide) and offers every
 * subject the file made at the window's level. Its exam series year (F0a) defaults to the series of
 * that type in the academic year the window opens in, so a student's grade in it is their grade that
 * year. A test about the series itself passes `seriesYear`.
 *
 * Its header is made with the window's dates in one call (the deprecated dated contract of
 * `POST /sessions`: born open once its start has passed, a draft before — a preregistration target —
 * and no header change of its own in the session's audit trail, which scenarios count); its prices are
 * made final and every subject is offered through the coordinator's routes; `activate` opens a draft.
 */
export async function session(
  adm: Client,
  _name: string,
  sessionType: 'june' | 'october' | 'november' | 'january',
  qualificationLevel: 'igcse' | 'as_level' | 'a_level',
  opts: { startDate: string; endDate: string; activate?: boolean; seriesYear?: number; allowedGrades?: readonly ('10' | '11' | '12' | 'graduates')[] }
): Promise<string> {
  const oldYear = opts.seriesYear ?? seriesYearInAcademicYear(sessionType, academicYearStartOf(new Date(opts.startDate)));
  const type = sessionType === 'june' ? 'june' as const : 'winter' as const;
  const year = sessionType === 'january' ? oldYear - 1 : oldYear;
  const label = `t${++labels}-${RUN}`;
  const r = await apiResponse(adm.api.v1.sessions.$post({
    json: {
      type, year, label, startDate: opts.startDate, endDate: opts.endDate,
      courseStartsOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(opts.startDate)),
      paymentDueAt: opts.endDate,
    },
  }));
  await apiResponse(adm.api.v1.sessions[':id']['prices-final'].$put({ param: { id: r.id }, json: { final: true } }));
  // P1b: eligibility reads the session's grade list (C7). Made by the legacy create (dates in the body), a suite's
  // session takes the grades the old rules admitted — June grades 10 to 12, winter 11, 12 and graduates — unless a
  // suite gives its own list.
  if (opts.allowedGrades) await apiResponse(adm.api.v1.sessions[':id'].$put({ param: { id: r.id }, json: { allowedGrades: [...opts.allowedGrades] } }));
  const meta: SessionMeta = { id: r.id, oldType: sessionType, level: qualificationLevel, type, year, oldYear, label, adm };
  SESSIONS.push(meta);
  for (const sub of SUBJECTS.filter((x) => x.level === qualificationLevel)) await offerInSession(adm, meta, sub);
  // A session whose start date has already passed is born active; only a draft is opened by hand (the
  // deprecated activation, as before: the suites' sittings carry an exam start and no entry deadline, which
  // the Accepting switch's check list holds back — 08y and 08za open theirs by the switch).
  if (opts.activate && r.status === 'draft') {
    await apiResponse(adm.api.v1.sessions[':id'].activate.$post({ param: { id: r.id } }));
  }
  return r.id;
}

/**
 * The teachers of a session's offering of a subject (D4: who teaches it this cycle is the offering's;
 * a line names one of them).
 */
export async function teachOffer(adm: Client, sessionId: string, subjectId: string, teacherIds: string[]) {
  const o = await one<{ id: string }>(`select id from session_offer where session_id = $1 and subject_id = $2`, [sessionId, subjectId]);
  await apiResponse(adm.api.v1.sessions[':id'].offerings[':offeringId'].$put({
    param: { id: sessionId, offeringId: o.id }, json: { teachers: teacherIds.map((teacherId) => ({ teacherId, online: false, external: false })) },
  }));
}

/** Offer a subject in a session made by `session()` (one made after the session, at another level, or after its close). */
export async function offer(adm: Client, sessionId: string, subjectId: string) {
  const s = SESSIONS.find((x) => x.id === sessionId);
  const sub = SUBJECTS.find((x) => x.id === subjectId);
  if (!s || !sub) throw new Error('offer(): a session and a subject this file made');
  await offerInSession(adm, s, sub);
}

/**
 * The SQL for a subject's all-papers row in a session (`$s`, `$t`: the session's and subject's
 * placeholders) — what resolveItem picks — for a test that inserts a line by hand.
 */
export const wholeItemSql = (s: string, t: string) =>
  `(select i.id from session_offer_item i join session_offer o on o.id = i.offer_id where o.session_id = ${s} and o.subject_id = ${t} and i.kind = 'all_papers' order by not (i.first_in_school or i.retake_in_school or i.retake_self_study or i.first_self_study), (i.board_series_id is null), i.id limit 1)`;

/** The series a session's (ticked) rows of a board sit in. */
export async function seriesOfSession(sessionId: string, board: 'cambridge' | 'pearson_edexcel' | 'oxford' = 'pearson_edexcel') {
  return (await one<{ id: string }>(`select distinct i.board_series_id as id from session_offer_item i join board_series bs on bs.id = i.board_series_id
    where i.session_id = $1 and bs.board_code = $2 and (i.first_in_school or i.retake_in_school or i.retake_self_study or i.first_self_study)`, [sessionId, board])).id;
}

/** Both consents ticked: every reservation path takes them since step B (RESERVATIONS_REWORK.md §3.5). */
export const CONSENT = { refundPolicy: true, declaration: true } as const;

/** A subject's all-papers row in a session — what resolveItem picks: one with a cell ticked first, then one with a series. */
async function wholeItemOf(sessionId: string, subjectId: string) {
  const [it] = await sql<{ id: string; in_school: boolean }>(
    `select i.id, (i.first_in_school or i.retake_in_school) as in_school from session_offer_item i join session_offer o on o.id = i.offer_id
     where o.session_id = $1 and o.subject_id = $2 and i.kind = 'all_papers'
     order by not (i.first_in_school or i.retake_in_school or i.retake_self_study or i.first_self_study), (i.board_series_id is null), i.id limit 1`,
    [sessionId, subjectId]);
  return it ?? null;
}

/**
 * A file's subjects as one reservation's `lines` and `consent` (step B: every reservation path
 * takes lines — one per item — and both consents, not `subjectIds`): each subject's all-papers row in
 * the session, a first entry, in school unless the row is self-study only; `teachers` names a
 * line's teacher (else the server's default: the row's or offering's only teacher, or none).
 * A subject the session does not offer becomes an item id the server refuses as not on offer.
 */
export async function reservationOf(
  sessionId: string,
  subjectIds: string[],
  opts: { teachers?: Record<string, string> } = {},
) {
  const lines: { offerItemId: string; attempt: 'first'; mode: 'in_school' | 'self_study'; teacherId?: string }[] = [];
  for (const subjectId of subjectIds) {
    const it = await wholeItemOf(sessionId, subjectId);
    // A row taught nowhere in school (no in-school cell) is reserved in self study (D3).
    const selfStudyOnly = it ? !it.in_school : false;
    lines.push({
      offerItemId: it?.id ?? `not-offered:${subjectId}`,
      attempt: 'first',
      mode: selfStudyOnly ? 'self_study' : 'in_school',
      ...(opts.teachers?.[subjectId] ? { teacherId: opts.teachers[subjectId] } : {}),
    });
  }
  return { lines, consent: CONSENT };
}

/** A swap's new line (step B): the subject's all-papers row in the session of the line being swapped, a first entry. */
export async function swapTo(registrationId: string, subjectId: string) {
  const [r] = await sql<{ session_id: string }>(`select session_id from registration where id = $1`, [registrationId]);
  const { lines } = await reservationOf(r?.session_id ?? '', [subjectId]);
  return lines[0]!;
}

/** A session's name (derived from its type, year and label since the reservations rework). */
export async function sessionName(sessionId: string) {
  return (await one<{ name: string }>(`select name from registration_session where id = $1`, [sessionId])).name;
}

// ─── The coordinator's set-up (COORDINATOR_REWORK.md Appendix A) ─────────────

export type Impact = { repriced: number; listedForFinance: number; linesAffected: number; dueDatesMoved: number; cutOffsEarlier?: number; cutOffsPassed?: number };

/**
 * A set-up change that answers its impact first (A3): sent once; when it is not saved, sent again with
 * the counts it answered as `expected`, as the coordinator's screen does after showing them. Returns
 * the first answer (the counts shown) and the saved one.
 */
export async function confirmed<T extends { saved: boolean; impact: Impact }>(send: (expected?: Impact) => Promise<T>): Promise<{ shown: T; saved: T }> {
  const shown = await send();
  if (shown.saved) return { shown, saved: shown };
  const saved = await send(shown.impact);
  expect(saved.saved, JSON.stringify(saved.impact)).toBe(true);
  return { shown, saved };
}

/**
 * C6's one exception, as the admin makes it from the check list (PUT /reference/sittings/:id/board-date): a
 * sitting the reference data gives no board entry deadline gets one (and its retake deadline), once.
 */
export async function boardDate(adm: Client, seriesId: string, d: { entryDeadline: string; retakeDeadline?: string | null }) {
  return apiResponse(adm.api.v1.reference.sittings[':id']['board-date'].$put({ param: { id: seriesId }, json: d }));
}

/** The school's date (Cairo) `days` from now, as a board prints a date ('YYYY-MM-DD'). */
export function cairoDateIn(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(Date.now() + days * 86_400_000));
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
 * Bring lines past their cut-off (COORDINATOR_REWORK.md §6, C10): the due date moved back so that due + the
 * session's unpaid-cancel days fell a minute ago — the cut-off a line reaches when its family has not paid. A line
 * whose board deadline comes first is past its cut-off already, or not until that deadline. Returns each line's
 * cut-off as the database computes it.
 */
export async function passCutOff(registrationIds: string[]) {
  const ids = registrationIds.map((_, i) => `$${i + 1}`).join(', ');
  await sql(`update registration r set due_at = now() - make_interval(days => s.unpaid_cancel_days) - interval '1 minute'
    from registration_session s where s.id = r.session_id and r.id in (${ids})`, registrationIds);
  const rows = await sql<{ id: string; cut_off: string }>(
    `select id, line_cut_off(due_at, session_id, attempt, prior_sitting_series_id, board_series_id, declaration_rejected) as cut_off
     from registration where id in (${ids})`, registrationIds);
  return new Map(rows.map((r) => [r.id, new Date(r.cut_off)]));
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
 * were fired in, not a guess about how long a request takes to arrive. Up to
 * 20 seconds: on a loaded machine a request took longer than the 5 it had to
 * reach its lock, and a correct race timed out (F4's final merge, 8 Oct 2026;
 * F1 raised its own forced races' wait for the same reason). A race whose
 * second request never queues still fails, only later.
 */
export async function lockWaiters(n: number, ms = 20_000) {
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
 * Pause every transaction that writes one audit action, at that write, until release() is
 * called: the trigger waits on an advisory lock the test's own connection holds, so a second
 * request can be landed inside the first one's transaction on purpose — the race forced, not
 * hoped for (lockWaiters counts the paused transaction). `action` is a test-supplied constant;
 * the trigger is dropped on release (test files run one at a time, so no other suite sees it).
 */
export async function pauseAtAudit(action: string): Promise<() => Promise<void>> {
  const p = await pauseAtAudits([action]);
  return p.releaseAll;
}

/**
 * pauseAtAudit for several actions, each released on its own: `paused(action)` waits until a
 * transaction is held at that action's write, `release(action)` lets it go, `releaseAll()` lets
 * every one go and drops the trigger.
 */
export async function pauseAtAudits(actions: string[]) {
  for (const a of actions) if (!/^[A-Z_]+$/.test(a)) throw new Error(`not an audit action: ${a}`);
  const keys = new Map(actions.map((a, i) => [a, 40400 + i]));
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  for (const k of keys.values()) await client.query(`select pg_advisory_lock(${k})`);
  await sql(`create or replace function test_pause_audit() returns trigger language plpgsql as $$
    begin
      ${[...keys].map(([a, k]) => `if new.action = '${a}' then perform pg_advisory_xact_lock(${k}); end if;`).join('\n      ')}
      return new;
    end $$`);
  await sql(`drop trigger if exists test_pause_audit on audit_log`);
  await sql(`create trigger test_pause_audit before insert on audit_log for each row execute function test_pause_audit()`);
  const held = new Set(keys.values());
  const release = async (action: string) => {
    const k = keys.get(action)!;
    if (!held.delete(k)) return;
    await client.query(`select pg_advisory_unlock(${k})`);
  };
  let done = false;
  return {
    /**
     * Until a transaction waits at this action's write (an advisory wait on its key) — in this
     * database: an advisory key is per database, and another suite run side by side on the same
     * server (local time and TZ=UTC) waits on the same key in its own (F7's race test proceeded
     * before its import paused, on the other suite's wait).
     */
    paused: (action: string, ms = 5000) => waitFor(async () => {
      const [r] = await sql<{ n: string }>(`select count(*) as n from pg_locks where locktype = 'advisory' and not granted and classid = 0 and objid = $1 and objsubid = 1
        and database = (select oid from pg_database where datname = current_database())`, [keys.get(action)!]);
      return Number(r?.n ?? 0) > 0 || null;
    }, ms),
    release,
    releaseAll: async () => {
      if (done) return;
      done = true;
      for (const a of keys.keys()) await release(a);
      await client.end();
      await sql(`drop trigger if exists test_pause_audit on audit_log`);
      await sql(`drop function if exists test_pause_audit()`);
    },
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
