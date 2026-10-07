/**
 * Import spike (STRATEGY.md §6, step 6; DISCOVERY.md §1).
 *
 * Loads one tab of the school's registration sheet into a throwaway database
 * through the API, the way the desk would do it by hand — catalogue,
 * teachers, sessions, families, registrations — and records every row that
 * does not fit the model. It is a discovery instrument, not a day-one
 * importer: prices, the board and payments are not in the sheet, so subjects
 * are created at 0 EGP under a placeholder board and registrations are left
 * waiting for payment.
 *
 * The sheet holds real family data. It is read from wherever the owner keeps
 * it and never copied into the repository; the report cites sheet row numbers
 * and counts, never names, emails or phones, and is written outside the repo.
 *
 *   pnpm --filter @repo/api exec tsx scripts/import-spike/import-spike.ts <sheet.xlsx> [--tab 2024] [--out /tmp/import-spike-report.md]
 *
 * The database is `igcse_spike_test` on the test container, dropped and
 * migrated on every run (the same setup as the suite, test/global-setup.ts).
 */
import { writeFileSync } from 'node:fs';
import type { AppType } from '../../src/app';
import { readWorkbook } from './xlsx';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file) throw new Error('Usage: import-spike.ts <sheet.xlsx> [--tab <name>] [--out <report.md>]');
const tabName = option('--tab') ?? '2024';
const outPath = option('--out') ?? '/tmp/import-spike-report.md';
// The database holds the sheet's real families under a known password: dropped at
// the end of the run unless --keep is given for inspection.
const keep = args.includes('--keep');

process.env.TEST_DB_NAME = 'igcse_spike_test';
const { TEST_DB_NAME, TEST_DATABASE_URL, TEST_PG_ADMIN_URL } = await import('../../test/env');
// Recreate and migrate it as test/global-setup.ts does, but on a client of our
// own: that setup ends @repo/db's pool, which this process then needs for the app.
{
  const { default: pg } = await import('pg');
  const maintenance = new pg.Client({ connectionString: TEST_PG_ADMIN_URL });
  await maintenance.connect();
  await maintenance.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
  await maintenance.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await maintenance.end();
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  execFileSync('pnpm', ['db:migrate'], {
    cwd: fileURLToPath(new URL('../../../../packages/db', import.meta.url)),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
// Everything after the database exists runs inside try/finally, so a run that
// fails partway still drops the real family data it loaded (unless --keep).
try {
  const { appWithRoutes } = await import('../../src/app');
  const { hc } = await import('hono/client');
  const { apiResponse } = await import('@repo/validations');
  const { db, sql } = await import('@repo/db');

  // ─── Findings ────────────────────────────────────────────────────────────────

  type Finding = { title: string; meaning: string; rows: Set<number>; count: number };
  const findings = new Map<string, Finding>();
  function note(key: string, title: string, meaning: string, row?: number) {
    const f = findings.get(key) ?? { title, meaning, rows: new Set<number>(), count: 0 };
    f.count++;
    if (row !== undefined) f.rows.add(row);
    findings.set(key, f);
  }

  // ─── The API, in process, as the desk ────────────────────────────────────────

  const ORIGIN = 'http://localhost:3000';
  const PASSWORD = 'SpikePass1';
  const client = (cookie?: string) => hc<AppType>('http://localhost', {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => appWithRoutes.request(input, init)) as typeof fetch,
    headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
  });
  async function auth(path: string, json: Record<string, unknown>) {
    const res = await appWithRoutes.request(path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
    if (res.status !== 200) throw new Error(`${path} answered ${res.status}: ${await res.text()}`);
    return res;
  }
  async function signIn(email: string) {
    const res = await auth('/api/auth/sign-in/email', { email, password: PASSWORD });
    const set = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie().map((c) => c.split(';')[0]);
    return client(set.join('; '));
  }
  /** The sentence the API refused with, or null when it accepted. */
  async function attempt<T>(p: Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    const res = await p;
    const body = (await res.json().catch(() => ({}))) as { data?: T; error?: unknown };
    if (res.ok) return { ok: true, data: body.data as T };
    const e = body.error;
    return { ok: false, error: typeof e === 'string' ? e : (e as { message?: string })?.message ?? JSON.stringify(e) };
  }

  // ─── Read the tab ────────────────────────────────────────────────────────────

  const tab = readWorkbook(file).find((t) => t.name.trim() === tabName.trim());
  if (!tab) throw new Error(`No tab named '${tabName}'`);
  const header = (tab.rows[1] ?? []).map((h) => h.replace(/\s+/g, ' ').trim().toLowerCase());
  const body = tab.rows.slice(2).map((cells, i) => ({ row: i + 3, cells }));
  const clean = (s: string | undefined) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const colNamed = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const valuesOf = (c: number) => body.map((r) => clean(r.cells[c])).filter(Boolean);
  const unlabeled = header.map((h, i) => (h === '' ? i : -1)).filter((i) => i >= 0);
  const col = {
    name: colNamed('student name'),
    classGrade: colNamed('class & grade'),
    spec: colNamed('specification'),
    subject: colNamed('subject'),
    teacher: colNamed('teacher'),
    signature: colNamed('signature'),
    studentPhone: colNamed('student no.'),
    studentEmail: colNamed('student email'),
    parentEmail: colNamed('parent email'),
    parentPhone: colNamed('parent no.'),
    // Unlabeled columns, recognised by what they hold.
    parentName: unlabeled.find((i) => i === colNamed('student email') + 1) ?? -1,
    series: unlabeled.find((i) => valuesOf(i).length > 0 && valuesOf(i).every((v) => /^\d{5}$/.test(v))) ?? -1,
    confirm: unlabeled.find((i) => valuesOf(i).some((v) => /confirm my registration|drop the course/i.test(v))) ?? -1,
    selfStudy: unlabeled.find((i) => valuesOf(i).length > 0 && valuesOf(i).every((v) => /^(yes|no)$/i.test(v))) ?? -1,
    // Free-text fee notes ("Self Study 50% School fees", "Dropped 80% School fees", "Refund 100%").
    feeNote: unlabeled.find((i) => valuesOf(i).filter((v) => /school fees|refund \d+%/i.test(v)).length > valuesOf(i).length / 2) ?? -1,
  };
  // A tab with no series column names its series in its title row ("June 2023 Session").
  const titleSeries = (() => {
    const m = /(january|june|november|nov\.?)\s+(\d{4})/i.exec(clean(tab.rows[0]?.[0]));
    if (!m) return null;
    const type = m[1]!.toLowerCase().startsWith('nov') ? 'november' : (m[1]!.toLowerCase() as 'january' | 'june');
    return { type, label: `${type[0]!.toUpperCase()}${type.slice(1)} ${m[2]}` } as { type: 'june' | 'november' | 'january'; label: string };
  })();
  const cell = (r: { cells: string[] }, c: number) => (c >= 0 ? clean(r.cells[c]) : '');

  // ─── Normalise ───────────────────────────────────────────────────────────────

  const LEVEL: Record<string, 'igcse' | 'as_level' | 'a_level'> = {
    'O.L.': 'igcse', 'A.S.': 'as_level', 'A.2.': 'a_level', 'A.L.': 'a_level',
    'A.S./A.2.': 'a_level', 'A.S./A.L.': 'a_level', 'A.S.A.L.': 'a_level',
  };
  const LEVEL_NAME = { igcse: 'IGCSE', as_level: 'AS', a_level: 'A Level' } as const;
  const unitPattern = /\((?:P\d|M\d|S\d|Paper [\d &]+|Paper \d+)\)|\bPaper \d/i;
  /** Edit distance, to tell a respelled first name from a different child. */
  function distance(a: string, b: string): number {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
    for (let j = 1; j <= b.length; j++) d[0]![j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length]![b.length]!;
  }
  function phone(raw: string): string | null {
    const digits = raw.replace(/\D/g, '');
    if (/^01\d{9}$/.test(digits)) return digits;
    if (/^1\d{9}$/.test(digits)) return `0${digits}`; // stored as a number: the leading 0 was lost
    if (/^201\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
    return null;
  }
  const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  function series(serial: string): { type: 'june' | 'november' | 'january'; label: string } | null {
    if (!/^\d{5}$/.test(serial)) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86_400_000);
    const month = d.getUTCMonth() + 1;
    const type = month === 1 ? 'january' : month === 6 ? 'june' : month === 11 ? 'november' : null;
    return type && { type, label: `${type[0]!.toUpperCase()}${type.slice(1)} ${d.getUTCFullYear()}` };
  }

  type Row = {
    row: number; name: string; grade: number | null; section: string; level: 'igcse' | 'as_level' | 'a_level' | null; specRaw: string;
    subject: string; teacher: string; series: { type: 'june' | 'november' | 'january'; label: string } | null;
    studentEmail: string; studentPhone: string | null; parentName: string; parentEmail: string; parentPhone: string | null;
    confirm: string; selfStudy: boolean; feeNote: string;
  };
  const rows: Row[] = [];
  for (const r of body) {
    if (!cell(r, col.name) && !cell(r, col.subject)) continue;
    const classGrade = cell(r, col.classGrade);
    const m = /^(\d{2})\s*([A-Z])$/i.exec(classGrade);
    const specRaw = cell(r, col.spec);
    const rawStudentPhone = cell(r, col.studentPhone);
    const rawParentPhone = cell(r, col.parentPhone);
    // Read the free-text answers from wherever they sit: rows drift between the
    // confirmation and fee-note columns (review of 48ce5be).
    const rowTexts = unlabeled.map((i) => cell(r, i));
    const feeText = rowTexts.find((v) => /school fees|refund \d+%|self study/i.test(v)) ?? '';
    const confirmText = rowTexts.find((v) => /confirm my registration|drop the course/i.test(v)) ?? '';
    const row: Row = {
      row: r.row,
      name: cell(r, col.name),
      grade: m ? Number(m[1]) : null,
      section: m ? `${m[1]}${m[2]!.toUpperCase()}` : '',
      level: LEVEL[specRaw] ?? null,
      specRaw,
      subject: cell(r, col.subject),
      teacher: cell(r, col.teacher),
      series: col.series >= 0 ? series(cell(r, col.series)) : titleSeries,
      studentEmail: cell(r, col.studentEmail).toLowerCase(),
      studentPhone: phone(rawStudentPhone),
      parentName: cell(r, col.parentName),
      parentEmail: cell(r, col.parentEmail).toLowerCase(),
      parentPhone: phone(rawParentPhone),
      confirm: confirmText,
      selfStudy: /^yes$/i.test(cell(r, col.selfStudy)) || /self study/i.test(feeText),
      feeNote: feeText,
    };
    if ((feeText && col.feeNote >= 0 && cell(r, col.feeNote) !== feeText) || (confirmText && col.confirm >= 0 && cell(r, col.confirm) !== confirmText)) {
      note('column-drift', 'Values in the wrong column', 'The confirmation or the fee note sits in the other one\'s column: the form changed shape mid-collection. Read by column, the row imports wrong (this script reads both texts from anywhere in the row).', r.row);
    }
    const signature = cell(r, col.signature);
    if (/carry forward/i.test(signature)) note('carry-forward', '"Carry forward" in the Signature column', 'A result or payment carried from an earlier series (Q-02); the model has no carried-forward entry, so the row imports as a new registration.', r.row);
    else if (signature) note('signature', 'A staff name in the Signature column', 'Who signed and what the signature means is open (Q-03); not imported.', r.row);
    const fee = /^(self study|dropped|refund|school fees)\D*(\d+)%/i.exec(row.feeNote) ?? /^school fees (\d+)% (self study)/i.exec(row.feeNote);
    if (row.feeNote) {
      const kind = /dropped/i.test(row.feeNote) ? 'dropped' : /refund/i.test(row.feeNote) ? 'refund' : /self study/i.test(row.feeNote) ? 'self-study' : 'other';
      const pct = /(\d+)%/.exec(row.feeNote)?.[1] ?? '?';
      note(`fee-note:${kind}:${pct}`, `Fee note: ${kind} ${pct}%`, kind === 'dropped'
        ? 'A drop with this share of the school fee kept or refunded; the model refunds by refund window at drop time and cannot record which it was here.'
        : kind === 'refund' ? 'A refund recorded in the registration sheet; the money record (F-01) is where it belongs.'
        : kind === 'self-study' ? 'Self-study at this share of the school fee; the model prices outside-school study at a fixed 50%.'
        : 'Unclassified fee note.', r.row);
      if (!fee) note('fee-note-shape', 'Fee note in an unexpected shape', `"${row.feeNote.replace(/\d+/g, 'N')}"`, r.row);
    }
    if (r.cells[col.name] && r.cells[col.name] !== row.name) note('name-whitespace', 'Names needed trimming', 'Trailing or non-breaking spaces and doubled spaces; normalised on import.', r.row);
    if (!m) note('class-unreadable', 'Class & Grade not in the form "11A"', 'Grade and section cannot be read; the student is imported with no grade.', r.row);
    if (!row.level) note('level-unknown', 'Specification not recognised', `Values outside O.L./A.S./A.2./A.L.: the row cannot be placed in a session.`, r.row);
    if (specRaw !== 'O.L.' && specRaw !== 'A.S.' && row.level) {
      note(`level-code:${specRaw}`, `Level code "${specRaw}"`, specRaw === 'A.2.'
        ? 'The second A-Level year alone; the model has igcse, as_level and a_level, so it is imported as a_level and looks like a full A Level.'
        : specRaw === 'A.L.' ? 'A Level (this tab\'s code; the 2026 tab uses A.2. and A.S./A.2. instead); imported as a_level. Whether A.L. and A.2. mean the same is a question for the coordinator.'
        : 'Names both AS and A Level on one row; imported as a_level. What it marks (the student\'s year, or what the unit counts toward) is a question for the coordinator.', r.row);
      if (/\((?:P|M|S)\d\)/.test(row.subject) && specRaw !== 'A.2.') note('level-code-on-unit', 'A combined AS/A-Level code on a single unit (P1–P4, M1, S1)', 'A single unit cannot be two entries at two levels, so the code must mean something else — the student\'s year, or the qualifications the unit counts toward.', r.row);
    }
    if (!row.series) note('series-missing', 'No readable exam series', 'The series column is empty or not a date; the row cannot be placed in a session.', r.row);
    if (rawStudentPhone && !row.studentPhone) note('phone-student', 'Student phone unusable', 'Not an Egyptian mobile after normalising; imported without a phone.', r.row);
    if (rawParentPhone && !row.parentPhone) note('phone-parent', 'Parent phone unusable', 'Not an Egyptian mobile after normalising; imported without a phone.', r.row);
    if (/^1\d{9}$/.test(rawStudentPhone.replace(/\D/g, '')) || /^1\d{9}$/.test(rawParentPhone.replace(/\D/g, ''))) {
      note('phone-leading-zero', 'Phones stored as numbers (leading 0 lost)', 'Restored by prefixing 0.', r.row);
    }
    if (!row.teacher && col.teacher >= 0) note('teacher-missing', 'No teacher named', 'The registration is imported with no teacher.', r.row);
    if (row.teacher && row.selfStudy) note('teacher-and-self-study', 'A teacher named on a self-study row', 'Self-study (outside school) rows take no teacher in the model; the teacher is dropped.', r.row);
    if (/drop the course/i.test(row.confirm)) note('drop-intent', '"I will drop the course" rows', 'A registration the family meant to drop; skipped (the model has no "intends to drop" state).', r.row);
    rows.push(row);
  }

  // ─── Identities: one account per email ───────────────────────────────────────

  type Student = { email: string; names: Set<string>; grades: Set<number>; sections: Set<string>; phones: Set<string>; parentEmails: Set<string>; rows: Row[] };
  const students = new Map<string, Student>();
  type Parent = { email: string; names: Set<string>; phones: Set<string>; children: Set<string> };
  const parents = new Map<string, Parent>();
  for (const r of rows) {
    if (!emailOk(r.studentEmail)) { note('email-student', 'Student email missing or invalid', 'No account can be made; the row is skipped.', r.row); continue; }
    if (!emailOk(r.parentEmail)) { note('email-parent', 'Parent email missing or invalid', 'No parent account can be made; the row is skipped.', r.row); continue; }
    if (r.studentEmail === r.parentEmail) { note('email-shared', 'Student and parent give the same email', 'One account cannot be both; the row is skipped.', r.row); continue; }
    const s = students.get(r.studentEmail) ?? { email: r.studentEmail, names: new Set(), grades: new Set(), sections: new Set(), phones: new Set(), parentEmails: new Set(), rows: [] };
    s.names.add(r.name.toLowerCase()); if (r.grade) s.grades.add(r.grade); if (r.section) s.sections.add(r.section);
    if (r.studentPhone) s.phones.add(r.studentPhone); s.parentEmails.add(r.parentEmail); s.rows.push(r);
    students.set(r.studentEmail, s);
    const p = parents.get(r.parentEmail) ?? { email: r.parentEmail, names: new Set(), phones: new Set(), children: new Set() };
    if (r.parentName) p.names.add(r.parentName.toLowerCase()); if (r.parentPhone) p.phones.add(r.parentPhone); p.children.add(r.studentEmail);
    parents.set(r.parentEmail, p);
  }
  const sharedEmails = new Set<string>();
  for (const s of students.values()) {
    const first = s.rows[0]!.row;
    // Two children: the email spans two classes with different first names, or
    // the first names differ by more than a respelling.
    const firstNames = [...new Set([...s.names].map((n) => n.split(' ')[0]!))];
    const differentChild = firstNames.some((a, i) => firstNames.slice(i + 1).some((b) => distance(a, b) > 2));
    const twoChildren = firstNames.length > 1 && (s.sections.size > 1 || differentChild);
    if (twoChildren) sharedEmails.add(s.email);
    if (twoChildren) note('student-email-siblings', 'Two children under one student email', 'Siblings sharing an email become one student account: one child\'s registrations land on the other. The desk needs a separate email, or the import a key other than email.', first);
    else if (s.names.size > 1) note('student-name-variants', 'One student email, several spellings of the name', 'The first spelling is kept; the others are lost.', first);
    if (s.grades.size > 1 || s.sections.size > 1) note('student-class-conflict', 'One student in two classes', 'The first class is kept.', first);
    if (s.phones.size > 1) note('student-phone-conflict', 'One student, several phones', 'The first phone is kept.', first);
    if (s.parentEmails.size > 1) note('student-two-parents', 'A student with two parent emails on different rows', 'Both parents are linked to the student.', first);
    if (parents.has(s.email)) note('student-is-parent', 'A student email is also another row\'s parent email', 'The account cannot be both; its second role is refused.', first);
  }
  const byName = new Map<string, Set<string>>();
  for (const s of students.values()) for (const n of s.names) byName.set(n, (byName.get(n) ?? new Set()).add(s.email));
  for (const [, emails] of byName) {
    if (emails.size < 2) continue;
    const row = students.get([...emails][0]!)!.rows[0]!.row;
    if ([...emails].some((e) => sharedEmails.has(e))) note('student-misfiled', 'A child\'s rows under a sibling\'s email as well as their own', 'The same name appears under the child\'s own email and under a sibling\'s: rows filed under the wrong child. Matching on name and parent email in a review step resolves most of these.', row);
    else note('student-same-name', 'Two student emails under the same name', 'Kept as two students; they may be one child with two emails, or namesakes.', row);
  }
  for (const p of parents.values()) {
    if (p.names.size > 1) note('parent-name-variants', 'One parent email, several spellings of the name', 'The first spelling is kept.', rows.find((r) => r.parentEmail === p.email)!.row);
    if (p.names.size === 0) note('parent-name-missing', 'No parent name', 'The account is named after the email.', rows.find((r) => r.parentEmail === p.email)!.row);
  }

  // ─── Staff, catalogue, teachers, sessions ────────────────────────────────────

  await auth('/api/auth/sign-up/email', { name: 'Spike Admin', email: 'admin@spike.local', password: PASSWORD });
  await db.execute(sql`update "user" set role = 'admin' where email = 'admin@spike.local'`);
  const adm = await signIn('admin@spike.local');
  await apiResponse(adm.v1.users.$post({ json: { name: 'Spike Officer', email: 'officer@spike.local', password: PASSWORD, role: 'finance_officer' } }));
  const officer = await signIn('officer@spike.local');

  const catalogue = new Map<string, string>(); // `${level}|${subject}` → subject id
  // A subject nobody takes in school is created as not taught there, so the
  // model's own rule (outside school when not offered) applies to it.
  const taughtAtSchool = new Set(rows.filter((r) => r.level && !r.selfStudy).map((r) => `${r.level}|${r.subject}`));
  let code = 0;
  for (const r of rows) {
    if (!r.level || !r.subject) continue;
    const key = `${r.level}|${r.subject}`;
    if (catalogue.has(key)) continue;
    if (!taughtAtSchool.has(key)) note('subject-never-in-school', 'A subject with no in-school row', 'Every row for it is self-study; created as not taught at school, so outside-school study is allowed for it.', r.row);
    if (unitPattern.test(r.subject)) note('unit-as-subject', 'A-Level units and papers registered one by one', 'Each unit (P1, M1, S1, a Biology paper) becomes its own catalogue subject at its own price; nothing ties P1 and P2 to "AS Mathematics".', r.row);
    const created = await attempt<{ id: string }>(adm.v1.subjects.$post({
      json: { name: `${r.subject} (${LEVEL_NAME[r.level]})`, code: `SPK-${r.level}-${++code}`, council: 'cambridge', courseFee: 0, registrationFee: 0, qualificationLevel: r.level, isOfferedAtSchool: taughtAtSchool.has(key), isCore: false },
    }));
    if (!created.ok) { note('subject-refused', 'Subject refused by the catalogue', created.error, r.row); continue; }
    catalogue.set(key, created.data.id);
  }
  note('no-prices', 'No prices anywhere in the sheet', 'Every subject is created at 0 EGP; the fee split (course + board entry) must come from finance.');
  note('no-board', 'No exam board in the sheet', 'Every subject is created under a placeholder board; unit names (P1, M1, S1) read like Pearson Edexcel IAL, the Biology papers like Cambridge.');
  const baseNames = new Map<string, Set<string>>();
  for (const key of catalogue.keys()) { const [level, name] = key.split('|'); const base = name!.replace(/\s*\([^)]*\)\s*$/, ''); baseNames.set(`${level}|${base}`, (baseNames.get(`${level}|${base}`) ?? new Set()).add(name!)); }
  for (const [, names] of baseNames) if (names.size > 1 && [...names].some((n) => /\((cambridge|edexcel)\)/i.test(n))) note('subject-name-variants', 'One subject under two names ("Arabic" / "Arabic (Cambridge)")', 'Created as two subjects; the second name may be the same course or a different board.');

  const teacherIds = new Map<string, string>();
  for (const r of rows) {
    if (!r.teacher || teacherIds.has(r.teacher.toLowerCase())) continue;
    const t = await attempt<{ id: string }>(adm.v1.teachers.$post({ json: { name: r.teacher } }));
    if (t.ok) teacherIds.set(r.teacher.toLowerCase(), t.data.id);
    else note('teacher-refused', 'Teacher refused', t.error, r.row);
  }
  const teachersOf = new Map<string, Set<string>>();
  for (const r of rows) {
    const sid = r.level && catalogue.get(`${r.level}|${r.subject}`);
    const tid = r.teacher && teacherIds.get(r.teacher.toLowerCase());
    if (sid && tid) teachersOf.set(sid, (teachersOf.get(sid) ?? new Set()).add(tid));
  }
  for (const [sid, tids] of teachersOf) await apiResponse(adm.v1.subjects[':id'].teachers.$put({ param: { id: sid }, json: { teacherIds: [...tids] } }));

  const sessions = new Map<string, string>(); // `${seriesType}|${level}` → session id
  const day = 86_400_000;
  for (const r of rows) {
    if (!r.series || !r.level) continue;
    const key = `${r.series.type}|${r.level}`;
    if (sessions.has(key)) continue;
    // The reservations rework: a session is June or winter (its year: June's, or November's for a
    // January series); the tab's series and level become its label, its name derived.
    const labelYear = Number(r.series.label.slice(-4));
    const winter = r.series.type !== 'june';
    const s = await attempt<{ id: string; status: string }>(adm.v1.sessions.$post({
      json: {
        type: winter ? 'winter' : 'june', year: r.series.type === 'january' ? labelYear - 1 : labelYear,
        label: `${r.series.type} ${LEVEL_NAME[r.level]} spike`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        startDate: new Date(Date.now() - day).toISOString(), endDate: new Date(Date.now() + 30 * day).toISOString(),
        courseStartsOn: new Date(Date.now()).toISOString().slice(0, 10), paymentDueAt: new Date(Date.now() + 30 * day).toISOString(),
      },
    }));
    if (!s.ok) { note('session-refused', 'Session refused', `${r.series.label} ${LEVEL_NAME[r.level]}: ${s.error}`, r.row); sessions.set(key, ''); continue; }
    if (s.data.status === 'draft') await apiResponse(adm.v1.sessions[':id'].activate.$post({ param: { id: s.data.id } }));
    sessions.set(key, s.data.id);
  }
  const seriesMix = new Set(rows.filter((r) => r.series).map((r) => `${r.series!.label}|${r.level}`));
  if (new Set(rows.filter((r) => r.series).map((r) => r.series!.type)).size > 1) {
    note('two-series-one-tab', 'One tab mixes two exam series', `The tab holds ${[...new Set(rows.filter((r) => r.series).map((r) => r.series!.label))].join(' and ')}; the model needs one session per series and level (${seriesMix.size} here).`);
  }

  // ─── Families and registrations, as the desk ─────────────────────────────────

  const studentIds = new Map<string, string>();
  let onboarded = 0;
  for (const s of students.values()) {
    const first = s.rows[0]!;
    for (const parentEmail of s.parentEmails) {
      const p = parents.get(parentEmail)!;
      const r = await attempt<{ student: { id: string }; linkStatus: string }>(officer.v1.links['desk-onboard'].$post({
        json: {
          parent: { email: parentEmail, name: first.parentEmail === parentEmail && first.parentName ? first.parentName : [...p.names][0] ?? parentEmail.split('@')[0], password: PASSWORD, phone: [...p.phones][0] ?? null },
          student: { email: s.email, name: first.name, password: PASSWORD, phone: [...s.phones][0] ?? null, ...(first.grade && [10, 11, 12].includes(first.grade) ? { grade: first.grade as 10 | 11 | 12 } : {}) },
        },
      }));
      if (!r.ok) { note('onboard-refused', 'The desk could not enroll the family', r.error, first.row); continue; }
      studentIds.set(s.email, r.data.student.id);
      onboarded++;
    }
  }

  let registered = 0;
  const refusedRegistrations: { row: number; error: string }[] = [];
  for (const s of students.values()) {
    const studentId = studentIds.get(s.email);
    if (!studentId) continue;
    const bySession = new Map<string, Row[]>();
    for (const r of s.rows) {
      if (/drop the course/i.test(r.confirm) || !r.series || !r.level) continue;
      const sessionId = sessions.get(`${r.series.type}|${r.level}`);
      if (!sessionId) continue;
      bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), r]);
    }
    for (const [sessionId, list] of bySession) {
      const subjectIds: string[] = [];
      const subjectOptions: Record<string, { teacherId?: string; takeOutsideSchool?: boolean }> = {};
      for (const r of list) {
        const sid = catalogue.get(`${r.level}|${r.subject}`);
        if (!sid) continue;
        if (subjectIds.includes(sid)) { note('duplicate-row', 'The same subject twice for one student and series', 'Registered once.', r.row); continue; }
        subjectIds.push(sid);
        const tid = r.teacher ? teacherIds.get(r.teacher.toLowerCase()) : undefined;
        subjectOptions[sid] = r.selfStudy ? { takeOutsideSchool: true } : tid ? { teacherId: tid } : {};
      }
      if (subjectIds.length === 0) continue;
      const res = await attempt<{ registrations: { id: string }[] }>(officer.v1.registrations.desk.$post({ json: { studentId, sessionId, subjectIds, subjectOptions } }));
      if (res.ok) { registered += res.data.registrations.length; continue; }
      // Refused as a batch: try each subject alone, so every refusal is counted against its row.
      for (const r of list) {
        const sid = catalogue.get(`${r.level}|${r.subject}`);
        if (!sid) continue;
        const one = await attempt<{ registrations: { id: string }[] }>(officer.v1.registrations.desk.$post({ json: { studentId, sessionId, subjectIds: [sid], subjectOptions: { [sid]: subjectOptions[sid] ?? {} } } }));
        if (one.ok) registered += one.data.registrations.length;
        else { refusedRegistrations.push({ row: r.row, error: one.error }); note(`registration-refused:${one.error}`, 'The desk refused a registration', one.error, r.row); }
      }
    }
  }

  // ─── Read the database back ──────────────────────────────────────────────────

  const count = async (q: ReturnType<typeof sql>) => Number(((await db.execute(q)).rows[0] as { n: string }).n);
  const readBack = {
    parents: await count(sql`select count(*) as n from "user" where role = 'parent'`),
    students: await count(sql`select count(*) as n from "user" where role = 'student'`),
    links: await count(sql`select count(*) as n from parent_student_link where status = 'approved'`),
    subjects: await count(sql`select count(*) as n from subject`),
    teachers: await count(sql`select count(*) as n from teacher`),
    sessions: await count(sql`select count(*) as n from registration_session`),
    registrations: await count(sql`select count(*) as n from registration`),
    outsideSchool: await count(sql`select count(*) as n from registration where taken_outside_school`),
    withTeacher: await count(sql`select count(*) as n from registration where teacher_id is not null`),
  };
  const sections = new Set(rows.map((r) => r.section).filter(Boolean));
  note('sections-dropped', 'Homeroom sections have nowhere to go', `The sheet places students in ${sections.size} sections (${[...sections].sort().join(', ')}); the model has a grade but no section, so class lists cannot be produced.`);

  // ─── Report: counts and sheet rows, never people ─────────────────────────────

  const lines: string[] = [];
  lines.push(`# Import spike report — tab "${tab.name}"`, '', `Generated ${new Date().toISOString()} from a local copy of the sheet. Rows are sheet row numbers; no personal data.`, '');
  lines.push('## What went in', '', '| | Sheet | Imported (read back) |', '|---|---|---|');
  lines.push(`| Registration rows | ${rows.length} | ${readBack.registrations} registrations (${registered} accepted by the desk) |`);
  lines.push(`| Students (by email) | ${students.size} | ${readBack.students} |`, `| Parents (by email) | ${parents.size} | ${readBack.parents} (${readBack.links} approved links; ${onboarded} desk enrolments) |`);
  lines.push(`| Subjects (name × level) | ${catalogue.size} | ${readBack.subjects} |`, `| Teachers | ${teacherIds.size} | ${readBack.teachers} |`, `| Sessions (series × level) | ${sessions.size} | ${readBack.sessions} |`);
  lines.push(`| Self-study rows | ${rows.filter((r) => r.selfStudy).length} | ${readBack.outsideSchool} registered outside school |`, `| Rows with a teacher | ${rows.filter((r) => r.teacher).length} | ${readBack.withTeacher} registrations with a teacher |`, '');
  lines.push('## Rows that did not fit', '', '| Finding | Count | Sheet rows (first 12) | What it means |', '|---|---|---|---|');
  for (const f of [...findings.values()].sort((a, b) => b.count - a.count)) {
    const sample = [...f.rows].sort((a, b) => a - b).slice(0, 12).join(', ');
    lines.push(`| ${f.title} | ${f.count} | ${sample || '—'} | ${f.meaning.replace(/\|/g, '/')} |`);
  }
  writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`[spike] ${rows.length} rows → ${readBack.registrations} registrations, ${readBack.students} students, ${readBack.parents} parents; ${findings.size} kinds of finding. Report: ${outPath}`);
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
} finally {
  if (!keep) {
    const { default: pg } = await import('pg');
    const maintenance = new pg.Client({ connectionString: TEST_PG_ADMIN_URL });
    await maintenance.connect();
    await maintenance.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await maintenance.end();
    console.log(`[spike] dropped ${TEST_DB_NAME} (pass --keep to inspect it)`);
  }
}
process.exit(0);
