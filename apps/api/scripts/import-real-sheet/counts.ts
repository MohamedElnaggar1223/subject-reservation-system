/**
 * The day-one import (F7) run on the school's real sheet, privately — the
 * import spike's successor (IMPORT_SPIKE.md §4). It stages the file through
 * the API exactly as staff would (upload, stage), reports every problem the
 * review finds by count and sheet row number, adds the missing catalogue rows
 * the way the admin would from the review, commits every family that is
 * ready, stages the same file again and commits it (a re-run must change
 * nothing), and reports the counts.
 *
 * The sheet holds real families. It is read from wherever the owner keeps it
 * and never copied into the repository; the report cites counts and sheet row
 * numbers only — never a name, an email or a phone — and is written outside
 * the repository's tracked files. The database (`igcse_import_real_test`) and
 * the uploaded copy are dropped at the end, even when the run fails.
 *
 *   pnpm --filter @repo/api exec tsx scripts/import-real-sheet/counts.ts <sheet.xlsx> [--out <report.md>]
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AppType } from '../../src/app';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file) throw new Error('Usage: counts.ts <sheet.xlsx> [--out <report.md>]');
const outPath = option('--out') ?? '/tmp/import-real-sheet-report.md';

process.env.TEST_DB_NAME = 'igcse_import_real_test';
const { TEST_DB_NAME, TEST_DATABASE_URL, TEST_PG_ADMIN_URL } = await import('../../test/env');
{
  const { default: pg } = await import('pg');
  const m = new pg.Client({ connectionString: TEST_PG_ADMIN_URL });
  await m.connect();
  await m.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await m.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await m.end();
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  execFileSync('pnpm', ['db:migrate'], { cwd: fileURLToPath(new URL('../../../../packages/db', import.meta.url)), env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: 'pipe' });
}
const lines: string[] = [];
try {
  const { appWithRoutes } = await import('../../src/app');
  const { hc } = await import('hono/client');
  const { apiResponse, academicYearStartOf } = await import('@repo/validations');
  const { db, sql } = await import('@repo/db');
  const ORIGIN = 'http://localhost:3000';
  const PASSWORD = 'ImportRun1';
  const client = (cookie?: string) => hc<AppType>('http://localhost', {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => appWithRoutes.request(input, init)) as typeof fetch,
    headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
  });
  const auth = async (path: string, json: Record<string, unknown>) => {
    const res = await appWithRoutes.request(path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
    if (res.status !== 200) throw new Error(`${path} answered ${res.status}`);
    return res;
  };
  const signIn = async (email: string) => {
    const res = await auth('/api/auth/sign-in/email', { email, password: PASSWORD });
    return client((res.headers as unknown as { getSetCookie(): string[] }).getSetCookie().map((c) => c.split(';')[0]).join('; '));
  };
  await auth('/api/auth/sign-up/email', { name: 'Run Admin', email: 'admin@import-run.local', password: PASSWORD });
  await db.execute(sql`update "user" set role = 'admin' where email = 'admin@import-run.local'`);
  const adm = await signIn('admin@import-run.local');
  await apiResponse(adm.v1.users.$post({ json: { name: 'Run Coordinator', email: 'coordinator@import-run.local', password: PASSWORD, role: 'coordinator' } }));
  const coord = await signIn('coordinator@import-run.local');
  // The academic year the live tab's classes are in, as the school would have set it up.
  const Y = academicYearStartOf();
  await apiResponse(coord.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }));

  const bytes = readFileSync(file);
  const stage = async () => {
    const f = await apiResponse(coord.v1.files.upload.$post({ form: { file: new File([new Uint8Array(bytes)], 'sheet.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), purpose: 'import_file' } }));
    return (await apiResponse(coord.v1.imports.$post({ json: { fileId: f.id, kind: 'school_sheet' } }))).id;
  };
  const view = (id: string) => apiResponse(coord.v1.imports[':id'].$get({ param: { id } }));
  type View = Awaited<ReturnType<typeof view>>;
  const ref = (r: { tab: string; rowNumber: number }) => `${r.tab}!${r.rowNumber}`;
  const report = (title: string, v: View) => {
    lines.push(`## ${title}`, '');
    lines.push(`Rows ${v.summary.rows}; importing ${v.summary.importing}; left out ${v.summary.skipped}. Families ${v.summary.families}: ready ${v.summary.readyFamilies}, held back ${v.summary.heldFamilies}, committed ${v.summary.committedFamilies}. Rows with an error ${v.summary.rowsWithErrors}.`, '');
    lines.push('Tabs: ' + v.mapping.tabs.map((t) => `${t.name} (${t.kind}, ${t.lines} lines${t.mainSeries ? `, ${t.mainSeries}` : ''})`).join('; '), '');
    lines.push('Notes: ' + v.notes.map((n) => n.code).join(', '), '');
    lines.push('Series groups: ' + v.mapping.series.map((s) => `${s.key} ${s.rows} rows, boards ${s.boards.join('+') || '-'}`).join('; '), '');
    lines.push('What a commit would make: ' + JSON.stringify(v.summary.plan), '');
    lines.push('| Problem | Severity | Rows or people | First sheet rows |', '|---|---|---|---|');
    const by = new Map<string, { sev: string; rows: string[]; people: number }>();
    for (const r of v.rows) for (const p of r.problems) {
      const g = by.get(p.code) ?? { sev: p.severity, rows: [], people: 0 };
      g.rows.push(ref(r));
      by.set(p.code, g);
    }
    for (const p of v.people) for (const pr of p.problems) {
      if (pr.severity === 'error') continue;
      const g = by.get(pr.code) ?? { sev: pr.severity, rows: [], people: 0 };
      g.people++;
      if (!g.rows.length) for (const id of p.rowIds.slice(0, 1)) { const r = v.rows.find((x) => x.id === id); if (r) g.rows.push(ref(r)); }
      by.set(pr.code, g);
    }
    for (const [code, g] of [...by.entries()].sort((a, b) => a[1].sev.localeCompare(b[1].sev) || b[1].rows.length - a[1].rows.length)) {
      lines.push(`| ${code} | ${g.sev} | ${g.people ? `${g.people} people` : `${g.rows.length} rows`} | ${g.rows.slice(0, 12).join(', ')} |`);
    }
    lines.push('');
  };

  lines.push('# The day-one import on the school\'s sheet — counts and row numbers only', '', `Run ${new Date().toISOString()} on a throwaway database, dropped at the end. No names, emails or phones.`, '');
  const first = await stage();
  let v = await view(first);
  report('Staged, before any review', v);

  // The admin adds the missing catalogue rows from the review, with today's assumptions (board, level, taught), no prices.
  const missing = v.mapping.subjects.filter((s) => !s.subjectId);
  if (missing.length) {
    await apiResponse(adm.v1.imports[':id'].subjects.$post({ param: { id: first }, json: { subjects: missing.map((s, i) => ({
      key: s.key, name: s.subject, code: `RUN-${String(i + 1).padStart(3, '0')}`, qualificationLevel: (s.levelSuggested ?? 'igcse') as 'igcse' | 'as_level' | 'a_level',
      council: (s.isUnit ? 'pearson_edexcel' : 'cambridge') as 'pearson_edexcel' | 'cambridge', isOfferedAtSchool: s.taughtInSchool, courseFee: 0, registrationFee: 0,
    })) } }));
  }
  v = await view(first);
  report(`After the admin added ${missing.length} catalogue rows (no other review)`, v);

  const out = await apiResponse(coord.v1.imports[':id'].commit.$post({ param: { id: first } }));
  // Staff names and ids are people too: only their count is reported.
  const shown = { ...out, result: { ...out.result, by: '<id>', teachersCreated: `${out.result.teachersCreated.length} teachers`,
    failed: out.result.failed.map((f) => ({ family: '<hidden>', error: (f.error ?? '').replace(/[\w.+-]+@[\w.-]+/g, '<email>') })) } };
  lines.push('## Commit (every ready family; the held ones wait for their fixes)', '', '```', JSON.stringify(shown, null, 1).replace(/"family": "[^"]*"/g, '"family": "<hidden>"'), '```', '');
  const counts = async () => Object.fromEntries(await Promise.all(['user', 'parent_student_link', 'section_membership', 'course_enrolment', 'registration_history', 'money_history', 'registration', 'payment', 'teacher', 'section'].map(async (t) => [t, Number(((await db.execute(sql.raw(`select count(*) as n from "${t}"`))).rows[0] as { n: string }).n)])));
  const before = await counts();
  lines.push('Tables after the commit: ' + JSON.stringify(before), '');

  const again = await stage();
  v = await view(again);
  report('The same file staged again (its review carried over)', v);
  const out2 = await apiResponse(coord.v1.imports[':id'].commit.$post({ param: { id: again } }).then((r) => r));
  lines.push('## The re-run committed', '', '```', JSON.stringify(out2.result.created), '```', '');
  const after = await counts();
  lines.push(`Tables after the re-run: ${JSON.stringify(after)}`, '', `Changed by the re-run: ${JSON.stringify(Object.fromEntries(Object.entries(after).filter(([k, n]) => n !== before[k])))}`, '');
  writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`[real-sheet] report: ${outPath}`);
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
} catch (err) {
  writeFileSync(outPath, lines.join('\n') + `\n\nFAILED: ${err instanceof Error ? err.message.replace(/[\w.+-]+@[\w.-]+/g, '<email>') : 'unknown'}\n`);
  console.error('[real-sheet] failed; see the report');
} finally {
  const { default: pg } = await import('pg');
  const m = new pg.Client({ connectionString: TEST_PG_ADMIN_URL });
  await m.connect();
  await m.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await m.end();
  rmSync(process.env.LOCAL_UPLOAD_DIR!, { recursive: true, force: true });
  console.log(`[real-sheet] dropped ${TEST_DB_NAME} and the uploaded copy`);
}
process.exit(0);
