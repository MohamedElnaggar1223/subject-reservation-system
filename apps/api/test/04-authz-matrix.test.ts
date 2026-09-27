import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, admin, staff, onboard, clientFor, type Api } from './helpers';

/**
 * Authorization matrix (security audit, Phase 1.1).
 *
 * Every /v1 endpoint the app registers is called once per principal:
 * anonymous, a linked student, a linked parent, a finance officer, a
 * finance admin and an admin. Bodies are empty and path ids are a random
 * UUID, so the probe proves the ROLE gate only: an allowed principal gets
 * past it (400/404/409/422/200/201), a refused one gets 401 or 403.
 * Ownership of real records is proven separately in 05-object-access.
 *
 * Requests go through the Hono RPC client like every other test. The
 * client is walked by path segment because the matrix enumerates routes
 * at runtime; what it asserts (a status per principal) has no response
 * type to check.
 *
 * The expected gate for every endpoint and principal is the reviewed policy
 * in authz-policy.tsv. A new endpoint without a row fails the suite, so no
 * route ships without someone deciding who may call it.
 *
 * Set AUTHZ_MATRIX_OUT=/path/file.tsv to write the observed matrix.
 */

type Principal = 'anon' | 'student' | 'parent' | 'officer' | 'finadmin' | 'admin';
const PRINCIPALS: Principal[] = ['anon', 'student', 'parent', 'officer', 'finadmin', 'admin'];
const FAKE_ID = '00000000-0000-4000-8000-000000000000';

type Endpoint = { method: string; path: string };
type Gate = 'A' | 'D';

function loadPolicy(): Map<string, Record<Principal, Gate>> {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'authz-policy.tsv');
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const [header, ...rows] = lines;
  expect(header!.split('\t')).toEqual(['method', 'path', ...PRINCIPALS]);
  const policy = new Map<string, Record<Principal, Gate>>();
  for (const line of rows) {
    const [method, p, ...gates] = line.split('\t');
    const row = {} as Record<Principal, Gate>;
    PRINCIPALS.forEach((who, i) => { row[who] = gates[i] as Gate; });
    policy.set(`${method} ${p}`, row);
  }
  return policy;
}

const gateOf = (status: number): Gate => (status === 401 || status === 403 ? 'D' : 'A');

async function listEndpoints(): Promise<Endpoint[]> {
  const a = await app();
  const seen = new Set<string>();
  const out: Endpoint[] = [];
  for (const r of a.routes) {
    if (r.method === 'ALL' || !r.path.startsWith('/v1/')) continue;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method: r.method, path: r.path });
  }
  return out.sort((x, y) => (x.path + x.method).localeCompare(y.path + y.method));
}

/** Walk the typed client by path segment and call the endpoint with empty input. */
async function probe(api: Api, e: Endpoint): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = api;
  const param: Record<string, string> = {};
  for (const seg of e.path.replace(/^\//, '').split('/')) {
    node = node[seg];
    if (seg.startsWith(':')) param[seg.slice(1)] = FAKE_ID;
  }
  const fn = node[`$${e.method.toLowerCase()}`];
  if (typeof fn !== 'function') throw new Error(`client has no $${e.method.toLowerCase()} for ${e.path}`);
  const args: Record<string, unknown> = {};
  if (Object.keys(param).length) args.param = param;
  if (e.method === 'GET') args.query = {};
  else args.json = {};
  const res: Response = await fn(args);
  await res.text().catch(() => '');
  return res.status;
}

describe('authorization matrix', () => {
  let endpoints: Endpoint[];
  const clients = {} as Record<Principal, Api>;
  const observed = new Map<string, Record<Principal, number>>();

  beforeAll(async () => {
    endpoints = await listEndpoints();
    const adm = await admin('mx');
    const officer = await staff(adm, 'finance_officer', 'mx');
    const finadmin = await staff(adm, 'finance_admin', 'mx');
    const fam = await onboard(officer, 'mx');
    clients.anon = await clientFor();
    clients.student = fam.student.api;
    clients.parent = fam.parent.api;
    clients.officer = officer.api;
    clients.finadmin = finadmin.api;
    clients.admin = adm.api;
  });

  it('probes every /v1 endpoint as every principal', async () => {
    expect(endpoints.length).toBeGreaterThan(100);
    for (const e of endpoints) {
      const row = {} as Record<Principal, number>;
      for (const p of PRINCIPALS) row[p] = await probe(clients[p], e);
      observed.set(`${e.method} ${e.path}`, row);
    }
    const out = process.env.AUTHZ_MATRIX_OUT;
    if (out) {
      const lines = [['method', 'path', ...PRINCIPALS].join('\t')];
      for (const e of endpoints) {
        const row = observed.get(`${e.method} ${e.path}`)!;
        lines.push([e.method, e.path, ...PRINCIPALS.map((p) => String(row[p]))].join('\t'));
      }
      writeFileSync(out, lines.join('\n') + '\n');
    }

    // Every endpoint matches its reviewed row, and every row still has an endpoint.
    const policy = loadPolicy();
    const problems: string[] = [];
    for (const [key, row] of observed) {
      const want = policy.get(key);
      if (!want) { problems.push(`${key}: no row in authz-policy.tsv — decide who may call it`); continue; }
      for (const who of PRINCIPALS) {
        if (gateOf(row[who]) !== want[who]) problems.push(`${key}: ${who} got ${row[who]}, policy says ${want[who]}`);
      }
    }
    for (const key of policy.keys()) if (!observed.has(key)) problems.push(`${key}: in authz-policy.tsv but no longer registered`);
    expect(problems).toEqual([]);

    // No endpoint may answer an anonymous caller except the health probes.
    const anonymous = [...observed].filter(([, row]) => row.anon !== 401).map(([key]) => key);
    expect(anonymous.sort()).toEqual(['GET /v1/health', 'GET /v1/health/ready']);
  }, 300_000);
});
