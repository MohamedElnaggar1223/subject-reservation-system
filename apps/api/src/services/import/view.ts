/**
 * F7: the review — everything staff see about a staged file, worked out each
 * time it is read from the lines as read, the staff's fixes and decisions,
 * the mapping settings and the database as it is now. Nothing here writes.
 *
 * - Each line is read (normalise.ts) and its fixes applied.
 * - People: a student or a parent per email (the rows that name them), with
 *   the staff's merges, "different people", "one child" and skips; flagged
 *   when an email is shared by two children, the same child appears under two
 *   emails, a parent under two, a name is spelt several ways, an email
 *   belongs to another kind of account (IS-06).
 * - Families: the students and parents the importing rows join — the unit a
 *   commit takes in one transaction.
 * - The mapping: each series and level to history or an open window, each
 *   subject to a catalogue row, each teacher to a record, the sections, and
 *   the coordinator's pending answers (self-study, carry forward).
 * - Per row, what a commit would do (the plan) and every problem; the
 *   file-wide notes (no money, a second series in a tab, rosters ignored).
 */
import {
  db, user, subject, teacher, academicYear, section, sectionMembership, registrationSession, courseEnrolment,
  registration, parentStudentLink, registrationHistory, moneyHistory, subjectUnit, examUnit, qualificationUnit, qualification,
  eq, and, or, inArray, isNull, notInArray, sql,
  type importBatch, type importRow, type importPerson,
} from '@repo/db';
import {
  IMPORT_PROBLEMS, academicYearShortLabel, academicYearStartOf, gradeInAcademicYear, gradeToday, seriesAcademicYearStart,
  seriesLabel, seriesOrder, seriesEndedBy, deriveLevelCode, LEVEL_CODE_READINGS,
  type ImportProblemCode, type ImportSeverity, type ImportNoteCode, type ImportRowEditsType, type ImportSettingsType,
  type SelfStudyRule, type CarryForwardReading, type SeriesMode, type LevelCodeReading, type HistoryOutcome,
  type UnitLevel, type ImportRowPlan, type ImportViewProblem, type ImportLineView,
} from '@repo/validations';
import { getSetting } from '../settings.services';
import { judgeEligibility, mayRegisterFor, type Eligibility } from '../eligibility.services';
import { schoolFeeGateReason } from '../school-fee.services';
import { routeAndCheck } from '../series.services';
import type { SourceLine, SourceTab } from './source';
import {
  readSheetLine, readSclLine, readMoneyLine, tabRoles, cleanText, seriesText,
  type LineData, type SheetLine, type MoneyLine, type Problem, type Series, type LevelFamily,
} from './normalise';

type BatchRow = typeof importBatch.$inferSelect;
type RowRecord = typeof importRow.$inferSelect;
type PersonRecord = typeof importPerson.$inferSelect;
type Role = 'student' | 'parent';

// ─── Resolved settings ───────────────────────────────────────────────────────

export type ResolvedSettings = {
  tabs: Record<string, { include: boolean; classYear: number }>;
  series: Record<string, { mode: SeriesMode; sessionId: string | null }>;
  subjects: Record<string, { subjectId: string | null }>;
  teachers: Record<string, { teacherId: string | null; create: boolean }>;
  createSections: boolean;
  enrol: boolean;
  selfStudyOnTaught: SelfStudyRule;
  carryForward: CarryForwardReading;
  graduates: 'import' | 'skip';
  gradeYear: number;
};

// ─── What a commit would do with a row ───────────────────────────────────────

export type RowPlan = ImportRowPlan;

const noPlan = (): RowPlan => ({ student: 'none', parents: [], links: [], section: 'none', enrolment: 'none', registration: 'none', money: 'none' });

export type ViewProblem = ImportViewProblem;

const problem = (p: Problem): ViewProblem => ({ code: p.code, severity: p.severity ?? IMPORT_PROBLEMS[p.code].severity, detail: p.detail ?? null });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length]![b.length]!;
}

export const lower = (s: string) => cleanText(s).toLowerCase();
const firstName = (name: string) => lower(name).split(' ')[0] ?? '';
/** The registrable row's level a code points to first. */
const LEVEL_OF: Record<LevelFamily, string[]> = {
  igcse: ['igcse'], as: ['as_level'], a2: ['a_level'], al: ['a_level'], combined: ['a_level', 'as_level'],
};
export const subjectKeyOf = (subjectText: string, levelCode: string | null) => `${lower(subjectText)}|${levelCode ?? ''}`;
export const teacherKeyOf = (name: string) => lower(name);
export const seriesKeyOf = (s: Series, level: string) => `${s.type}-${s.year}-${level}`;
function mostCommon<T>(xs: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | undefined;
  let n = 0;
  for (const [x, c] of counts) if (c > n) { best = x; n = c; }
  return best;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) { this.parent.set(x, x); return x; }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) { if (ra < rb) this.parent.set(rb, ra); else this.parent.set(ra, rb); }
  }
}

/** How a history row reads its outcome (IS-08): "I will drop the course", a "Dropped" note, or registered. */
export function historyOutcome(d: Pick<SheetLine, 'confirm' | 'feeNote'>): HistoryOutcome {
  if (d.confirm === 'drop_intent') return 'drop_intended';
  if (d.feeNote && /dropped/i.test(d.feeNote)) return 'dropped';
  return 'registered';
}

/** A row that may never become a live registration: a past drop or a drop the family meant. */
export const neverLive = (d: Pick<SheetLine, 'confirm' | 'feeNote'>) => historyOutcome(d) !== 'registered';

export const historyFingerprint = (d: Pick<SheetLine, 'series' | 'subject' | 'levelCode'>) => `${d.series!.type}|${d.series!.year}|${lower(d.subject)}|${d.levelCode ?? ''}`;
export const feeFingerprint = (d: Pick<SheetLine, 'series' | 'subject' | 'levelCode' | 'feeKind' | 'feePercent'>) => `fee|${d.series?.type}|${d.series?.year}|${lower(d.subject)}|${d.levelCode ?? ''}|${d.feeKind}|${d.feePercent ?? ''}`;
export const carryFingerprint = (d: Pick<SheetLine, 'series' | 'subject' | 'levelCode'>) => `carry|${d.series?.type}|${d.series?.year}|${lower(d.subject)}|${d.levelCode ?? ''}`;

/** A money-record line: its content, and where it is (so the same file again finds it). */
export function moneyFingerprint(d: Omit<MoneyLine, 'local'>, where: { tab: string; rowNumber: number }) {
  return `money|${d.happenedOn ?? ''}|${d.amount ?? ''}|${d.direction ?? ''}|${d.moneyKind}|${d.percent ?? ''}|${(d.receiptNumber ?? '').toLowerCase()}|${lower(d.seriesLabel ?? '')}|${lower(d.subject ?? '')}|${where.tab}!${where.rowNumber}`;
}

/** A student id that is never an account: the school-fee gate of a student the import will create. */
const NEW_STUDENT = '00000000-0000-0000-0000-import-new';

// ─── The catalogue as the review reads it ────────────────────────────────────

type CatalogueRow = {
  id: string; name: string; code: string; council: string; qualificationLevel: string; isActive: boolean; isOfferedAtSchool: boolean;
  courseFee: number; registrationFee: number; isCore: boolean; unitShortCodes: string[]; unitLevels: UnitLevel[]; awardLevels: string[];
};

async function loadCatalogue(): Promise<CatalogueRow[]> {
  const [subjects, units, awards] = await Promise.all([
    db.select({
      id: subject.id, name: subject.name, code: subject.code, council: subject.council, qualificationLevel: subject.qualificationLevel,
      isActive: subject.isActive, isOfferedAtSchool: subject.isOfferedAtSchool, courseFee: subject.courseFee, registrationFee: subject.registrationFee, isCore: subject.isCore,
    }).from(subject),
    db.select({ subjectId: subjectUnit.subjectId, shortCode: examUnit.shortCode, code: examUnit.code, unitLevel: examUnit.unitLevel, unitId: examUnit.id })
      .from(subjectUnit).innerJoin(examUnit, eq(examUnit.id, subjectUnit.unitId)),
    db.select({ unitId: qualificationUnit.unitId, level: qualification.level }).from(qualificationUnit).innerJoin(qualification, eq(qualification.id, qualificationUnit.qualificationId)),
  ]);
  return subjects.map((s) => {
    const us = units.filter((u) => u.subjectId === s.id);
    return {
      ...s,
      unitShortCodes: us.flatMap((u) => [u.shortCode, u.code].filter((x): x is string => !!x).map((x) => x.toLowerCase())),
      unitLevels: us.map((u) => u.unitLevel as UnitLevel),
      awardLevels: [...new Set(awards.filter((a) => us.some((u) => u.unitId === a.unitId)).map((a) => a.level))],
    };
  });
}

// ─── The view ────────────────────────────────────────────────────────────────

type Working = {
  r: RowRecord; d: LineData; problems: ViewProblem[];
  decision: 'import' | 'skip'; decisionSource: 'staff' | 'default' | 'person'; skipReason: string | null;
  studentKey: string | null; parentKeys: string[]; subjectKey: string | null; subjectId: string | null; seriesKey: string | null;
  classYear: number | null; cohortYear: number | null; plan: RowPlan; familyKey: string | null; mode: 'in_school' | 'self_study' | null;
  teacherId: string | null; studentId: string | null;
};

type PersonView = {
  role: Role; key: string; email: string | null; name: string; names: { name: string; rows: number }[];
  phone: string | null; phones: string[]; classes: { value: string; rows: number }[]; section: string | null;
  cohortYear: number | null; gradeToday: number | null; rowIds: string[]; parentKeys: string[]; childKeys: string[];
  matched: { id: string; name: string; role: string | null; cohortYear: number | null; leftOn: string | null } | null;
  problems: ViewProblem[]; familyKey: string | null; decision: 'import' | 'skip'; mergedInto: string | null;
  mergedFrom: string[]; distinct: boolean; oneChild: boolean; edits: Record<string, unknown>; status: string; userId: string | null; error: string | null;
  sclIds: string[];
};

export type ImportViewInput = { batch: BatchRow; rows: RowRecord[]; people: PersonRecord[] };

/** Everything the review shows, worked out now. */
export async function computeView({ batch, rows, people }: ImportViewInput) {
  const source = batch.source as { tabs?: SourceTab[] };
  const tabs: SourceTab[] = source.tabs ?? [];
  const stored = (batch.settings ?? {}) as ImportSettingsType;
  const kind = batch.kind as 'school_sheet' | 'scl_roster' | 'money_record';
  const nowYear = academicYearStartOf();

  const [catalogue, teachers, years, windows, defaultSelfStudy, defaultCarry, graduateRetakes, reading] = await Promise.all([
    loadCatalogue(),
    db.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(teacher),
    db.select().from(academicYear),
    db.select({
      id: registrationSession.id, name: registrationSession.name, sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear,
      qualificationLevel: registrationSession.qualificationLevel, status: registrationSession.status,
    }).from(registrationSession),
    getSetting('import.selfStudyOnTaught'),
    getSetting('import.carryForward'),
    getSetting('eligibility.graduateRetakes'),
    getSetting('catalogue.levelCodeReading'),
  ]);
  const subjectById = new Map(catalogue.map((s) => [s.id, s]));
  const yearByStart = new Map(years.map((y) => [y.startYear, y]));
  const teacherById = new Map(teachers.map((t) => [t.id, t]));

  // 1. Read every line, with its fixes.
  const linesByTab = new Map<string, SourceLine[]>();
  for (const r of rows) linesByTab.set(r.tab, [...(linesByTab.get(r.tab) ?? []), { tab: r.tab, rowNumber: r.rowNumber, raw: r.raw }]);
  const roles = new Map(tabs.filter((t) => t.kind === 'session').map((t) => [t.name, tabRoles(t, linesByTab.get(t.name) ?? [])]));
  const read = new Map<string, LineData>();
  for (const r of rows) {
    const edits = (r.edits ?? {}) as ImportRowEditsType;
    const line: SourceLine = { tab: r.tab, rowNumber: r.rowNumber, raw: r.raw };
    read.set(r.id, kind === 'school_sheet' ? readSheetLine(line, roles.get(r.tab)!, edits)
      : kind === 'scl_roster' ? readSclLine(line, edits) : readMoneyLine(line, edits));
  }

  // 2. Settings: the staff's choices over defaults worked out from the file.
  const tabMainSeries = new Map<string, Series | null>();
  for (const t of tabs) {
    const ss = rows.filter((r) => r.tab === t.name).map((r) => read.get(r.id))
      .filter((d): d is SheetLine => d?.kind === 'sheet' && !!d.series).map((d) => `${d.series!.type}|${d.series!.year}`);
    const main = mostCommon(ss);
    tabMainSeries.set(t.name, main ? { type: main.split('|')[0] as Series['type'], year: Number(main.split('|')[1]) } : null);
  }
  const settings: ResolvedSettings = {
    tabs: Object.fromEntries(tabs.filter((t) => t.kind === 'session').map((t) => {
      const main = tabMainSeries.get(t.name);
      const classYear = stored.tabs?.[t.name]?.classYear ?? (main ? seriesAcademicYearStart(main.type, main.year) : nowYear);
      return [t.name, { include: stored.tabs?.[t.name]?.include ?? true, classYear }];
    })),
    series: {},
    subjects: {},
    teachers: {},
    createSections: stored.createSections ?? true,
    enrol: stored.enrol ?? true,
    selfStudyOnTaught: stored.selfStudyOnTaught ?? defaultSelfStudy,
    carryForward: stored.carryForward ?? defaultCarry,
    graduates: stored.graduates ?? 'import',
    gradeYear: stored.gradeYear ?? nowYear,
  };
  // Subjects: the catalogue row each (subject, code) of the sheet is — by name, code, or a unit's short code ("P1").
  const subjectCandidates = (text: string, family: LevelFamily | null) => {
    const t = lower(text);
    const bare = lower(text.replace(/\s*\([^)]*\)\s*$/, ''));
    const paren = /\(([^)]+)\)\s*$/.exec(text)?.[1]?.toLowerCase().trim() ?? null;
    const unitParen = !!paren && /^(p|m|s|d|fp)\d$/.test(paren);
    // How close a row is: its own name or code first, then the name without "(…)", a unit's short code, a code in "(…)".
    const score = (s: CatalogueRow) =>
      lower(s.name) === t || s.code.toLowerCase() === t ? 0
      : !unitParen && bare !== t && lower(s.name) === bare ? 1
      : unitParen && s.unitShortCodes.length === 1 && s.unitShortCodes.includes(paren!) ? 2
      : !!paren && s.code.toLowerCase() === paren ? 3
      : 9;
    const prefs = family ? LEVEL_OF[family] : [];
    return catalogue
      .map((s) => ({ s, score: score(s) }))
      .filter((x) => x.score < 9 && (!family || prefs.includes(x.s.qualificationLevel)))
      .sort((a, b) => a.score - b.score || prefs.indexOf(a.s.qualificationLevel) - prefs.indexOf(b.s.qualificationLevel) || Number(b.s.isActive) - Number(a.s.isActive))
      .map((x) => x.s);
  };
  const subjectKeys = new Map<string, { subject: string; levelCode: string | null; family: LevelFamily | null }>();
  const teacherNames = new Map<string, string>();
  for (const d of read.values()) {
    if (d.kind !== 'sheet') continue;
    if (d.subject) subjectKeys.set(subjectKeyOf(d.subject, d.levelCode), { subject: d.subject, levelCode: d.levelCode, family: d.levelFamily });
    if (d.teacher) teacherNames.set(teacherKeyOf(d.teacher), d.teacher);
  }
  for (const [key, s] of subjectKeys) {
    const chosen = stored.subjects?.[key];
    settings.subjects[key] = { subjectId: chosen !== undefined ? chosen.subjectId : subjectCandidates(s.subject, s.family)[0]?.id ?? null };
  }
  for (const [key] of teacherNames) {
    const exact = teachers.find((t) => lower(t.name) === key && t.isActive) ?? teachers.find((t) => lower(t.name) === key);
    settings.teachers[key] = stored.teachers?.[key] ?? { teacherId: exact?.id ?? null, create: !exact };
  }

  // 3. Rows: their keys, and the review's own decisions under the staff's.
  const decisionsBy = new Map(people.map((p) => [`${p.role}|${p.key}`, p]));
  const canonical = (role: Role, key: string) => {
    let k = key;
    const seen = new Set<string>();
    for (;;) {
      const p = decisionsBy.get(`${role}|${k}`);
      if (!p?.mergedInto || seen.has(k)) return k;
      seen.add(k);
      k = p.mergedInto;
    }
  };
  const work: Working[] = rows.map((r) => {
    const d = read.get(r.id)!;
    const w: Working = {
      r, d, problems: d.local.map(problem), decision: 'import', decisionSource: 'default', skipReason: null,
      studentKey: null, parentKeys: [], subjectKey: null, subjectId: null, seriesKey: null, classYear: null, cohortYear: null,
      plan: noPlan(), familyKey: null, mode: null, teacherId: null, studentId: null,
    };
    if (d.kind === 'sheet' || d.kind === 'scl') w.studentKey = canonical('student', d.studentEmailOk ? d.studentEmail : `row:${r.id}`);
    if (d.kind === 'sheet') {
      w.subjectKey = d.subject ? subjectKeyOf(d.subject, d.levelCode) : null;
      w.subjectId = w.subjectKey ? settings.subjects[w.subjectKey]?.subjectId ?? null : null;
      w.classYear = settings.tabs[r.tab]?.classYear ?? nowYear;
      w.cohortYear = d.grade ? w.classYear - (d.grade - 10) : null;
      const level = w.subjectId ? subjectById.get(w.subjectId)?.qualificationLevel : d.levelFamily ? LEVEL_OF[d.levelFamily][0] : null;
      w.seriesKey = d.series && level ? seriesKeyOf(d.series, level) : null;
      const tk = d.teacher ? teacherKeyOf(d.teacher) : null;
      w.teacherId = tk ? settings.teachers[tk]?.teacherId ?? null : null;
    } else if (d.kind === 'scl') {
      w.classYear = settings.gradeYear;
      w.cohortYear = d.grade ? settings.gradeYear - (d.grade - 10) : null;
    }
    if (r.decision === 'import' || r.decision === 'skip') {
      w.decision = r.decision;
      w.decisionSource = 'staff';
      w.skipReason = r.decision === 'skip' ? r.decisionNote || 'Left out by staff' : null;
    }
    return w;
  });
  const skipByDefault = (w: Working, why: string) => {
    if (w.decisionSource === 'default' && w.decision === 'import') { w.decision = 'skip'; w.skipReason = why; }
  };

  // Series and level groups (the school's sheet).
  const seriesGroups = new Map<string, { key: string; series: Series; level: string; rows: number }>();
  for (const w of work) {
    if (w.d.kind !== 'sheet' || !w.seriesKey || !w.d.series) continue;
    const g = seriesGroups.get(w.seriesKey) ?? { key: w.seriesKey, series: w.d.series, level: w.seriesKey.split('-')[2]!, rows: 0 };
    g.rows++;
    seriesGroups.set(w.seriesKey, g);
  }
  for (const [key] of seriesGroups) {
    const chosen = stored.series?.[key];
    settings.series[key] = { mode: chosen?.mode ?? 'history', sessionId: chosen?.sessionId ?? null };
  }
  for (const w of work) {
    if (w.d.kind !== 'sheet') continue;
    if (settings.tabs[w.r.tab] && !settings.tabs[w.r.tab]!.include) skipByDefault(w, 'Its tab is left out');
    if (w.seriesKey && settings.series[w.seriesKey]?.mode === 'skip') skipByDefault(w, 'Its series is left out');
  }

  // 4. Existing accounts by email (and, for the money record, by school ID).
  const emails = new Set<string>();
  const refs = new Set<string>();
  for (const w of work) {
    const d = w.d;
    if (d.kind === 'sheet') { if (d.studentEmailOk) emails.add(d.studentEmail); if (d.parentEmailOk) emails.add(d.parentEmail); }
    else if (d.kind === 'scl') { if (d.studentEmailOk) emails.add(d.studentEmail); for (const p of d.parents) if (p.emailOk) emails.add(p.email); }
    else if (d.studentRef) refs.add(d.studentRef.toLowerCase());
  }
  const found = emails.size || refs.size
    ? await db.select({
        id: user.id, email: user.email, role: user.role, name: user.name, cohortYear: user.cohortYear, leftOn: user.leftOn, studentCode: user.studentId,
      }).from(user).where(or(
        emails.size ? inArray(sql`lower(${user.email})`, [...emails]) : undefined,
        refs.size ? inArray(sql`lower(${user.email})`, [...refs]) : undefined,
        refs.size ? inArray(sql`lower(${user.studentId})`, [...refs]) : undefined,
      ))
    : [];
  const userByEmail = new Map(found.map((u) => [u.email.toLowerCase(), u]));
  const userByCode = new Map(found.filter((u) => u.studentCode).map((u) => [u.studentCode!.toLowerCase(), u]));

  // Duplicate rows (IS-13): the same subject twice for one student and series — the later line is left out.
  const firstLine = new Map<string, Working>();
  for (const w of work) {
    const d = w.d;
    if (d.kind !== 'sheet' || !w.studentKey || !d.series || !d.subject || w.decision !== 'import') continue;
    const k = `${w.studentKey}|${d.series.type}|${d.series.year}|${w.subjectId ?? w.subjectKey}`;
    const first = firstLine.get(k);
    if (!first) { firstLine.set(k, w); continue; }
    w.problems.push({ code: 'duplicate_row', severity: 'warning', detail: `same as ${first.r.tab} row ${first.r.rowNumber}` });
    skipByDefault(w, 'The same subject is on an earlier row');
  }
  // Graduates, when staff leave them out.
  if (settings.graduates === 'skip') {
    for (const w of work) {
      if (w.d.kind === 'money' || !w.studentKey) continue;
      const email = (w.d as { studentEmail: string }).studentEmail;
      const cohort = userByEmail.get(email)?.cohortYear ?? w.cohortYear;
      const g = gradeToday(cohort);
      if (g !== null && g > 12) skipByDefault(w, 'Graduates are left out');
    }
  }
  // A person staff left out takes their rows with them.
  for (const w of work) {
    if (w.studentKey && decisionsBy.get(`student|${w.studentKey}`)?.decision === 'skip' && w.decision === 'import') {
      w.decision = 'skip'; w.decisionSource = 'person'; w.skipReason = 'The student is left out';
    }
  }

  // 5. People, from the importing rows.
  type Agg = {
    role: Role; key: string; rowIds: string[]; names: Map<string, number>; phones: Map<string, number>; classes: Map<string, number>;
    sections: Map<string, number>; cohorts: Map<number, number>; parentKeys: Set<string>; childKeys: Set<string>; email: string | null; sclIds: Set<string>;
  };
  const agg = new Map<string, Agg>();
  const personOf = (role: Role, key: string, email: string | null) => {
    const id = `${role}|${key}`;
    let p = agg.get(id);
    if (!p) {
      p = { role, key, rowIds: [], names: new Map(), phones: new Map(), classes: new Map(), sections: new Map(), cohorts: new Map(), parentKeys: new Set(), childKeys: new Set(), email, sclIds: new Set() };
      agg.set(id, p);
    }
    if (!p.email && email) p.email = email;
    return p;
  };
  const bump = <K,>(m: Map<K, number>, k: K | null | undefined) => { if (k !== null && k !== undefined && k !== '') m.set(k, (m.get(k) ?? 0) + 1); };
  for (const w of work) {
    const d = w.d;
    if (d.kind === 'money' || !w.studentKey) continue;
    if (w.decision !== 'import') {
      // A student left out still shows, so staff can bring them back.
      if (w.decisionSource === 'person') personOf('student', w.studentKey, d.studentEmailOk ? d.studentEmail : null).rowIds.push(w.r.id);
      continue;
    }
    const s = personOf('student', w.studentKey, d.studentEmailOk ? d.studentEmail : null);
    s.rowIds.push(w.r.id);
    bump(s.names, d.studentName);
    bump(s.phones, d.studentPhone);
    if (d.kind === 'sheet') { bump(s.classes, d.section ?? d.classText); bump(s.sections, d.section); }
    else { bump(s.classes, d.grade !== null ? `grade ${d.grade}` : null); bump(s.sections, d.section); if (d.sclId) s.sclIds.add(d.sclId); }
    bump(s.cohorts, w.cohortYear);
    const parents = d.kind === 'sheet'
      ? (d.noParent ? [] : [{ email: d.parentEmail, ok: d.parentEmailOk, name: d.parentName, phone: d.parentPhone }])
      : d.noParent ? [] : d.parents.length ? d.parents.map((p) => ({ email: p.email, ok: p.emailOk, name: p.name, phone: p.phone })) : [{ email: '', ok: false, name: '', phone: null }];
    for (const [i, pr] of parents.entries()) {
      const pKey = canonical('parent', pr.ok ? pr.email : `row:${w.r.id}:${i}`);
      if (decisionsBy.get(`parent|${pKey}`)?.decision === 'skip') continue;
      const p = personOf('parent', pKey, pr.ok ? pr.email : null);
      p.rowIds.push(w.r.id);
      bump(p.names, pr.name);
      bump(p.phones, pr.phone);
      p.childKeys.add(w.studentKey);
      s.parentKeys.add(pKey);
      w.parentKeys.push(pKey);
    }
  }
  // A parent left out still shows, so staff can bring them back.
  for (const dec of people) {
    if (dec.role === 'parent' && dec.decision === 'skip' && !agg.has(`parent|${dec.key}`)) personOf('parent', dec.key, dec.key.includes('@') ? dec.key : null);
  }

  const byCount = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  const personViews = new Map<string, PersonView>();
  for (const [id, p] of agg) {
    const dec = decisionsBy.get(id);
    const edits = (dec?.edits ?? {}) as { name?: string; phone?: string };
    const names = byCount(p.names);
    const matched = p.email ? userByEmail.get(p.email) ?? null : null;
    const cohort = [...p.cohorts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    personViews.set(id, {
      role: p.role, key: p.key, email: p.email, name: edits.name ?? names[0]?.[0] ?? matched?.name ?? (p.email ? p.email.split('@')[0]! : ''),
      names: names.map(([name, n]) => ({ name, rows: n })),
      phone: edits.phone ?? byCount(p.phones)[0]?.[0] ?? null, phones: byCount(p.phones).map(([x]) => x),
      classes: byCount(p.classes).map(([value, n]) => ({ value, rows: n })),
      section: p.role === 'student' ? byCount(p.sections)[0]?.[0] ?? null : null,
      cohortYear: p.role === 'student' ? cohort : null,
      gradeToday: p.role === 'student' ? gradeToday(matched?.role === 'student' ? matched.cohortYear ?? cohort : cohort) : null,
      rowIds: p.rowIds, parentKeys: [...p.parentKeys], childKeys: [...p.childKeys],
      matched: matched ? { id: matched.id, name: matched.name, role: matched.role, cohortYear: matched.cohortYear, leftOn: matched.leftOn } : null,
      problems: [], familyKey: null, decision: dec?.decision === 'skip' ? 'skip' : 'import', mergedInto: null,
      mergedFrom: people.filter((x) => x.role === p.role && x.mergedInto && x.key !== p.key && canonical(p.role, x.key) === p.key).map((x) => x.key),
      distinct: dec?.distinct ?? false, oneChild: dec?.oneChild ?? false, edits, status: dec?.status ?? 'pending', userId: dec?.userId ?? null, error: dec?.error ?? null,
      sclIds: [...p.sclIds],
    });
  }
  for (const dec of people) {
    const id = `${dec.role}|${dec.key}`;
    if (personViews.has(id) || !dec.mergedInto) continue;
    personViews.set(id, {
      role: dec.role as Role, key: dec.key, email: dec.key.includes('@') ? dec.key : null, name: dec.key, names: [], phone: null, phones: [], classes: [],
      section: null, cohortYear: null, gradeToday: null, rowIds: [], parentKeys: [], childKeys: [], matched: null, problems: [], familyKey: null,
      decision: dec.decision === 'skip' ? 'skip' : 'import', mergedInto: canonical(dec.role as Role, dec.key), mergedFrom: [], distinct: dec.distinct,
      oneChild: dec.oneChild, edits: dec.edits, status: dec.status, userId: dec.userId, error: dec.error, sclIds: [],
    });
  }

  // Person problems (IS-06).
  const active = [...personViews.values()].filter((p) => !p.mergedInto && p.decision === 'import' && p.rowIds.length);
  const students = active.filter((p) => p.role === 'student');
  const parentsList = active.filter((p) => p.role === 'parent');
  const parentKeySet = new Set(parentsList.filter((p) => p.email).map((p) => p.key));
  const studentKeySet = new Set(students.filter((s) => s.email).map((s) => s.key));
  for (const p of active) {
    if (new Set(p.names.map((n) => n.name.toLowerCase())).size > 1) p.problems.push({ code: 'name_variants', severity: 'info', detail: `${p.names.length} spellings` });
    if (p.matched && p.matched.role !== p.role) p.problems.push({ code: 'email_taken', severity: 'error', detail: `an account with the role ${p.matched.role ?? 'none'} has this email` });
  }
  for (const s of students) {
    const firsts = [...new Set(s.names.map((n) => firstName(n.name)))];
    const differentChild = firsts.some((a, i) => firsts.slice(i + 1).some((b) => distance(a, b) > 2));
    const sections = s.classes.filter((c) => /^\d+[A-Z]$/.test(c.value));
    if (!s.oneChild && s.email && firsts.length > 1 && (differentChild || sections.length > 1)) {
      s.problems.push({ code: 'student_email_shared', severity: 'error', detail: `${firsts.length} first names${sections.length > 1 ? `, ${sections.length} classes` : ''}` });
    }
    if (s.parentKeys.length > 1) s.problems.push({ code: 'student_two_parents', severity: 'info', detail: `${s.parentKeys.length} parents` });
    if (s.email && parentKeySet.has(s.key)) s.problems.push({ code: 'email_student_is_parent', severity: 'error', detail: 'another row gives it as a parent' });
    if (s.matched?.role === 'student') {
      if (s.cohortYear !== null && s.matched.cohortYear !== null && s.cohortYear !== s.matched.cohortYear) {
        s.problems.push({ code: 'cohort_differs', severity: 'warning', detail: `the file says grade ${gradeInAcademicYear(s.cohortYear, nowYear)} now, the record ${gradeInAcademicYear(s.matched.cohortYear, nowYear)}` });
      }
      if (s.matched.leftOn) s.problems.push({ code: 'left_school', severity: 'warning', detail: `left on ${s.matched.leftOn}` });
    }
    if (s.gradeToday !== null && s.gradeToday > 12) s.problems.push({ code: 'graduated', severity: 'info', detail: null });
    const cohorts = new Set(s.rowIds.map((id) => work.find((w) => w.r.id === id)?.cohortYear).filter((c): c is number => c !== null && c !== undefined));
    if (cohorts.size > 1) s.problems.push({ code: 'cohort_differs', severity: 'warning', detail: 'the file gives two different grades' });
  }
  for (const p of parentsList) if (p.email && studentKeySet.has(p.key)) p.problems.push({ code: 'email_student_is_parent', severity: 'error', detail: 'another row gives it as a student' });
  // Look-alikes: the same child under two emails (a duplicate family), the same parent under two.
  const groupBy = (xs: PersonView[], k: (p: PersonView) => string | null) => {
    const m = new Map<string, PersonView[]>();
    for (const x of xs) { const key = k(x); if (key) m.set(key, [...(m.get(key) ?? []), x]); }
    return [...m.values()].filter((g) => g.length > 1);
  };
  for (const group of groupBy(students, (s) => lower(s.name) || null)) {
    for (const s of group) {
      const others = group.filter((o) => o !== s && !(s.distinct && o.distinct));
      if (!others.length || s.distinct) continue;
      const shared = others.some((o) => o.parentKeys.some((k) => s.parentKeys.includes(k)));
      s.problems.push({ code: 'duplicate_student', severity: 'warning', detail: `also ${others.map((o) => o.key).join(', ')}${shared ? ' (same parent)' : ''}` });
    }
  }
  for (const group of groupBy(parentsList, (p) => p.phone)) {
    for (const p of group) {
      if (p.distinct) continue;
      const others = group.filter((o) => o !== p);
      p.problems.push({ code: 'duplicate_parent', severity: 'warning', detail: `also ${others.map((o) => o.key).join(', ')} (same phone)` });
    }
  }

  // 6. Families: the students and parents the importing rows join.
  const uf = new UnionFind();
  for (const w of work) {
    if (w.decision !== 'import' || !w.studentKey || w.d.kind === 'money') continue;
    uf.find(`student|${w.studentKey}`);
    for (const k of w.parentKeys) uf.union(`student|${w.studentKey}`, `parent|${k}`);
  }
  for (const w of work) if (w.decision === 'import' && w.studentKey && w.d.kind !== 'money') w.familyKey = uf.find(`student|${w.studentKey}`);
  for (const p of active) p.familyKey = uf.find(`${p.role}|${p.key}`);

  // The money record: the student must be an account already (F-01 is recorded on students in the system).
  for (const w of work) {
    if (w.d.kind !== 'money' || w.decision !== 'import') continue;
    const ref = w.d.studentRef.toLowerCase();
    const u = userByEmail.get(ref) ?? userByCode.get(ref);
    if (!u || u.role !== 'student') w.problems.push({ code: 'student_not_found', severity: 'error', detail: w.d.studentRef ? `"${w.d.studentRef}"` : 'empty' });
    else { w.studentKey = u.email.toLowerCase(); w.studentId = u.id; w.familyKey = `student|${u.id}`; }
  }

  // 7. What exists already, for the accounts that exist.
  for (const w of work) {
    if (w.d.kind === 'money' || !w.studentKey) continue;
    const s = personViews.get(`student|${w.studentKey}`);
    if (s?.matched?.role === 'student') w.studentId = s.matched.id;
  }
  const knownIds = [...new Set([
    ...[...personViews.values()].map((p) => p.matched?.id).filter((x): x is string => !!x),
    ...work.map((w) => w.studentId).filter((x): x is string => !!x),
  ])];
  const sectionYears = new Set<number>();
  for (const w of work) if (w.classYear !== null) sectionYears.add(w.classYear);
  if (kind === 'scl_roster') for (const s of students) if (s.cohortYear !== null) sectionYears.add(s.cohortYear);
  const yearIds = [...sectionYears].map((y) => yearByStart.get(y)?.id).filter((x): x is string => !!x);
  const [links, memberships, enrolled, historyRows, liveRegs, moneyRows, sections, priorRegs] = await Promise.all([
    knownIds.length ? db.select({ parentId: parentStudentLink.parentId, studentId: parentStudentLink.studentId })
      .from(parentStudentLink).where(and(inArray(parentStudentLink.studentId, knownIds), inArray(parentStudentLink.status, ['pending', 'approved']))) : [],
    knownIds.length && yearIds.length ? db.select({ studentId: sectionMembership.studentId, sectionId: sectionMembership.sectionId, yearId: sectionMembership.academicYearId, name: section.name })
      .from(sectionMembership).innerJoin(section, eq(section.id, sectionMembership.sectionId))
      .where(and(inArray(sectionMembership.studentId, knownIds), inArray(sectionMembership.academicYearId, yearIds), isNull(sectionMembership.endedOn))) : [],
    knownIds.length && yearIds.length ? db.select({ studentId: courseEnrolment.studentId, subjectId: courseEnrolment.subjectId, yearId: courseEnrolment.academicYearId })
      .from(courseEnrolment).where(and(inArray(courseEnrolment.studentId, knownIds), inArray(courseEnrolment.academicYearId, yearIds), isNull(courseEnrolment.endedOn))) : [],
    knownIds.length ? db.select({
      studentId: registrationHistory.studentId, fingerprint: registrationHistory.fingerprint, subjectId: registrationHistory.subjectId, outcome: registrationHistory.outcome,
      sessionType: registrationHistory.sessionType, seriesYear: registrationHistory.seriesYear, committedAt: registrationHistory.createdAt,
    })
      .from(registrationHistory).where(inArray(registrationHistory.studentId, knownIds)) : [],
    knownIds.length ? db.select({ studentId: registration.studentId, sessionId: registration.sessionId, subjectId: registration.subjectId })
      .from(registration).where(and(inArray(registration.studentId, knownIds), notInArray(registration.status, ['dropped', 'rejected', 'expired']))) : [],
    knownIds.length ? db.select({ studentId: moneyHistory.studentId, fingerprint: moneyHistory.fingerprint }).from(moneyHistory).where(inArray(moneyHistory.studentId, knownIds)) : [],
    yearIds.length ? db.select({ id: section.id, name: section.name, grade: section.grade, yearId: section.academicYearId }).from(section).where(inArray(section.academicYearId, yearIds)) : [],
    knownIds.length ? db.select({ studentId: registration.studentId, subjectId: registration.subjectId, sessionId: registration.sessionId }).from(registration)
      .where(and(inArray(registration.studentId, knownIds), inArray(registration.status, ['confirmed', 'dropped']))) : [],
  ]);
  const linkSet = new Set(links.map((l) => `${l.parentId}|${l.studentId}`));
  const memberOf = new Map(memberships.map((m) => [`${m.studentId}|${m.yearId}`, m]));
  const enrolSet = new Set(enrolled.map((e) => `${e.studentId}|${e.subjectId}|${e.yearId}`));
  const historySet = new Set(historyRows.map((h) => `${h.studentId}|${h.fingerprint}`));
  const liveSet = new Set(liveRegs.map((r) => `${r.studentId}|${r.sessionId}|${r.subjectId}`));
  const moneySet = new Set(moneyRows.map((m) => `${m.studentId}|${m.fingerprint}`));
  // A subject sat before (V3 §6.9), as getRetakeSubjectIds judges it at the commit: a confirmed or dropped
  // registration in another window, or a history row that was not only meant, of a series before this one
  // that had ended when it was committed (the interim rule, review flag 2).
  const earliestHistory = new Map<string, number>();
  for (const h of historyRows) {
    if (!h.subjectId || h.outcome === 'drop_intended' || !seriesEndedBy(h.sessionType, h.seriesYear, h.committedAt)) continue;
    const k = `${h.studentId}|${h.subjectId}`;
    earliestHistory.set(k, Math.min(earliestHistory.get(k) ?? Infinity, seriesOrder(h.sessionType, h.seriesYear)));
  }
  const satBefore = (studentId: string, subjectId: string, order: number, windowId: string | null) =>
    (earliestHistory.get(`${studentId}|${subjectId}`) ?? Infinity) < order
    || priorRegs.some((r) => r.studentId === studentId && r.subjectId === subjectId && r.sessionId !== windowId);
  const sectionByName = new Map(sections.map((s) => [`${s.yearId}|${s.name.toLowerCase()}`, s]));

  // 8. Row by row: the mapping's problems and what a commit would do.
  const isHistory = (w: Working) => {
    const d = w.d as SheetLine;
    return !w.seriesKey || settings.series[w.seriesKey]?.mode !== 'window' || neverLive(d);
  };
  // In this file: a history row of the same subject in an earlier series, over by now, makes a live one a
  // retake (it is committed first, in the same transaction, so it is committed now).
  const historyInFile = new Map<string, number>();
  const now = new Date();
  for (const w of work) {
    if (w.decision === 'import' && w.d.kind === 'sheet' && w.studentKey && w.subjectId && w.d.series && isHistory(w) && historyOutcome(w.d) !== 'drop_intended'
      && seriesEndedBy(w.d.series.type, w.d.series.year, now)) {
      const k = `${w.studentKey}|${w.subjectId}`;
      historyInFile.set(k, Math.min(historyInFile.get(k) ?? Infinity, seriesOrder(w.d.series.type, w.d.series.year)));
    }
  }
  const levelBoards = new Map<string, Set<string>>();
  const routeCache = new Map<string, string | null>();
  const routeRefusal = async (sessionId: string, s: CatalogueRow) => {
    const k = `${sessionId}|${s.id}`;
    if (!routeCache.has(k)) {
      try { await routeAndCheck(db, sessionId, [{ id: s.id, name: s.name, council: s.council }]); routeCache.set(k, null); }
      catch (err) { routeCache.set(k, err instanceof Error ? err.message : 'The window cannot enter this subject'); }
    }
    return routeCache.get(k)!;
  };
  const eligibilityCache = new Map<string, Eligibility>();
  const feeCache = new Map<string, string | null>();
  const liveByStudentWindow = new Map<string, Set<string>>();

  for (const w of work) {
    if (w.decision !== 'import') continue;
    const d = w.d;
    const plan = noPlan();
    w.plan = plan;
    if (d.kind === 'money') {
      if (w.studentId) plan.money = moneySet.has(`${w.studentId}|${moneyFingerprint(d, w.r)}`) ? 'exists' : 'create';
      continue;
    }
    const s = w.studentKey ? personViews.get(`student|${w.studentKey}`) : undefined;
    const sid = w.studentId;
    plan.student = s?.matched ? 'match' : 'create';
    for (const pk of w.parentKeys) {
      const p = personViews.get(`parent|${pk}`);
      plan.parents.push(p?.matched ? 'match' : 'create');
      plan.links.push(sid && p?.matched && linkSet.has(`${p.matched.id}|${sid}`) ? 'exists' : 'create');
    }
    // The section (the class year's; SCL: the year the student is in grade 10).
    const sectionYear = d.kind === 'scl' ? s?.cohortYear ?? null : w.classYear;
    const y = sectionYear !== null ? yearByStart.get(sectionYear) : undefined;
    const sectionName = s?.section ?? null;
    if (y && sectionName) {
      const current = sid ? memberOf.get(`${sid}|${y.id}`) : undefined;
      const target = sectionByName.get(`${y.id}|${sectionName.toLowerCase()}`);
      if (current && target && current.sectionId === target.id) plan.section = 'exists';
      else if (current) {
        plan.section = 'keep';
        w.problems.push({ code: 'section_differs', severity: 'warning', detail: `in ${current.name}, the file says ${sectionName}` });
      } else if (target || settings.createSections) plan.section = 'add';
    }
    if (d.kind !== 'sheet') continue;

    const sub = w.subjectId ? subjectById.get(w.subjectId) : undefined;
    if (!sub) w.problems.push({ code: 'subject_unmapped', severity: 'warning', detail: `"${d.subject}" ${d.levelCode ?? ''}`.trim() });
    if (sub && w.seriesKey) levelBoards.set(w.seriesKey, (levelBoards.get(w.seriesKey) ?? new Set()).add(sub.council));
    const tabMain = tabMainSeries.get(w.r.tab);
    if (d.series && tabMain && (d.series.type !== tabMain.type || d.series.year !== tabMain.year)) {
      w.problems.push({ code: 'series_other_than_tab', severity: 'warning', detail: `${seriesText(d.series)} in a ${seriesText(tabMain)} tab` });
    }
    // The school's code against the one the catalogue works out (IS-01).
    if (sub && d.levelCode && sub.unitLevels.length && d.series && d.levelCode !== 'A.L.') {
      const sheetCode = d.levelCode === 'A.S./A.L.' || d.levelCode === 'A.S.A.L.' ? 'A.S./A.2.' : d.levelCode;
      const derived = deriveLevelCode(levelInput(w, work, subjectById), reading);
      if (derived !== sheetCode) w.problems.push({ code: 'level_code_differs', severity: 'info', detail: `the sheet says ${d.levelCode}, the catalogue ${derived}` });
    }
    // Self-study (IS-03): taught or not, a retake or a first attempt, and the coordinator's answer.
    const history = isHistory(w);
    let registerLive = !history;
    let mode: 'in_school' | 'self_study' = d.selfStudy ? 'self_study' : 'in_school';
    if (sub && !sub.isOfferedAtSchool) {
      mode = 'self_study';
      if (d.selfStudy) w.problems.push({ code: 'self_study_not_taught', severity: 'info', detail: null });
    } else if (d.selfStudy && sub) {
      // Before which series: the window's for a registration, the row's own for history.
      const win = history ? undefined : windows.find((x) => x.id === settings.series[w.seriesKey!]?.sessionId);
      const order = win ? seriesOrder(win.sessionType, win.seriesYear) : d.series ? seriesOrder(d.series.type, d.series.year) : Infinity;
      const retake = (!!sid && satBefore(sid, sub.id, order, win?.id ?? null))
        || (!history && (historyInFile.get(`${w.studentKey}|${sub.id}`) ?? Infinity) < order);
      if (retake) w.problems.push({ code: 'self_study_retake', severity: 'info', detail: null });
      else {
        const rule = d.selfStudyChoice ?? (settings.selfStudyOnTaught === 'retake_only' ? null : settings.selfStudyOnTaught);
        if (rule === 'in_school') mode = 'in_school';
        if (rule === 'enrol_only') registerLive = false;
        w.problems.push({
          code: 'self_study_on_taught',
          severity: registerLive && rule === null ? 'error' : 'info',
          detail: rule === 'in_school' ? 'taken as taught in school' : rule === 'enrol_only' ? 'enrolled as self-study, no registration made' : registerLive ? 'a first attempt' : 'kept as history',
        });
      }
    }
    w.mode = mode;
    // Enrolment in the class year: this year's teaching (F0b).
    const seriesYearStart = d.series ? seriesAcademicYearStart(d.series.type, d.series.year) : null;
    if (settings.enrol && y && sub && seriesYearStart === w.classYear && !neverLive(d)) {
      const cohort = s?.matched?.role === 'student' ? s.matched.cohortYear : s?.cohortYear ?? null;
      const g = gradeInAcademicYear(cohort, y.startYear);
      if (g !== null && g >= 10 && g <= 12 && !s?.matched?.leftOn && (mode === 'self_study' || sub.isOfferedAtSchool)) {
        if (sub.isActive) plan.enrolment = sid && enrolSet.has(`${sid}|${sub.id}|${y.id}`) ? 'exists' : 'create';
        else w.problems.push({ code: 'subject_inactive', severity: 'warning', detail: `${sub.name}: no enrolment until its fees are set and it is turned on` });
      }
    }
    // The exam registration: history, or awaiting payment in an open window.
    if (d.series) {
      if (!registerLive) {
        plan.registration = sid && historySet.has(`${sid}|${historyFingerprint(d)}`) ? 'history_exists' : 'history';
      } else {
        const sessionId = settings.series[w.seriesKey!]!.sessionId;
        const win = windows.find((x) => x.id === sessionId);
        const refusals: string[] = [];
        if (!win) refusals.push('choose the window for this series on the Mapping tab');
        else if (!sub) refusals.push('the subject is not mapped to the catalogue');
        else {
          if (win.status !== 'active') refusals.push(`${win.name} is not open`);
          if (sub.qualificationLevel !== win.qualificationLevel) refusals.push(`${sub.name} is not at ${win.name}'s level`);
          if (!sub.isActive) refusals.push(`${sub.name} is inactive on Subjects`);
          if (sub.courseFee + sub.registrationFee <= 0) refusals.push(`${sub.name} has no price yet — set its fees on Subjects first`);
          if (!refusals.length) {
            const route = await routeRefusal(win.id, sub);
            if (route) refusals.push(route);
            const eKey = `${w.studentKey}|${win.id}`;
            if (!eligibilityCache.has(eKey)) {
              eligibilityCache.set(eKey, sid ? await mayRegisterFor(sid, win.id) : judgeEligibility(
                { id: NEW_STUDENT, name: s?.name || 'The student', role: 'student', cohortYear: s?.cohortYear ?? null, leftOn: null, leftKind: null },
                { id: win.id, sessionType: win.sessionType, seriesYear: win.seriesYear },
                { graduateRetakes, grade10ExceptionId: null },
              ));
            }
            const e = eligibilityCache.get(eKey)!;
            if (!e.allowed) refusals.push(e.reason ?? 'The student may not sit this series');
            else {
              if (!feeCache.has(eKey)) feeCache.set(eKey, await schoolFeeGateReason(sid ?? NEW_STUDENT, e));
              const gate = feeCache.get(eKey);
              if (gate) refusals.push(gate);
            }
          }
        }
        if (refusals.length) w.problems.push({ code: 'registration_refused', severity: 'error', detail: refusals.join('; ') });
        plan.registration = sid && sub && win && liveSet.has(`${sid}|${win.id}|${sub.id}`) ? 'live_exists' : 'live';
        if (win && sub) {
          const k = `${w.studentKey}|${win.id}`;
          liveByStudentWindow.set(k, (liveByStudentWindow.get(k) ?? new Set()).add(sub.id));
        }
      }
    }
    // Money history: a fee note (IS-08), or a carried-forward payment (IS-02, when read that way).
    const moneyKeys = [...(d.feeNote ? [feeFingerprint(d)] : []), ...(d.carryForwardNote && settings.carryForward === 'payment' ? [carryFingerprint(d)] : [])];
    if (moneyKeys.length) plan.money = sid && moneyKeys.every((k) => moneySet.has(`${sid}|${k}`)) ? 'exists' : 'create';
  }
  // Grade 10 in June: every core subject (URD CORE-003), across the student's rows in that window.
  const coreSubjects = catalogue.filter((s) => s.isCore && s.isActive);
  for (const [k, subjectIds] of liveByStudentWindow) {
    const e = eligibilityCache.get(k);
    if (!e?.allowed || e.grade !== 10 || e.series.sessionType !== 'june') continue;
    const [studentKey, sessionId] = k.split('|') as [string, string];
    const sid = work.find((w) => w.studentKey === studentKey)?.studentId;
    const already = sid ? liveRegs.filter((r) => r.studentId === sid && r.sessionId === sessionId).map((r) => r.subjectId) : [];
    const missing = coreSubjects.filter((c) => !subjectIds.has(c.id) && !already.includes(c.id));
    if (!missing.length) continue;
    for (const w of work) {
      if (w.studentKey === studentKey && w.plan.registration === 'live' && w.seriesKey && settings.series[w.seriesKey]?.sessionId === sessionId) {
        w.problems.push({ code: 'registration_refused', severity: 'error', detail: `Grade 10 June session requires all core subjects. Missing: ${missing.map((m) => m.name).join(', ')}` });
      }
    }
  }
  // Everything already there: the same file imported before.
  for (const w of work) {
    if (w.decision !== 'import' || w.r.status === 'committed') continue;
    const p = w.plan;
    const nothingNew = p.student !== 'create' && !p.parents.includes('create') && !p.links.includes('create') && p.section !== 'add'
      && p.enrolment !== 'create' && p.registration !== 'live' && p.registration !== 'history' && p.money !== 'create';
    if (nothingNew && (p.student === 'match' || p.money === 'exists')) w.problems.push({ code: 'already_imported', severity: 'info', detail: null });
  }
  // A person's error holds their rows back.
  for (const w of work) {
    if (w.decision !== 'import' || !w.studentKey || w.d.kind === 'money') continue;
    const ps = [personViews.get(`student|${w.studentKey}`), ...w.parentKeys.map((k) => personViews.get(`parent|${k}`))];
    for (const p of ps) for (const pr of p?.problems ?? []) if (pr.severity === 'error' && !w.problems.some((x) => x.code === pr.code)) w.problems.push(pr);
  }

  // 9. Families: ready to commit when nothing in them is an error.
  type FamilyView = {
    key: string; students: string[]; parents: string[]; rowIds: string[]; errors: number;
    status: 'ready' | 'held' | 'committed' | 'failed' | 'partly_committed'; error: string | null;
  };
  const rowById = new Map(work.map((w) => [w.r.id, w]));
  const families = new Map<string, FamilyView>();
  for (const w of work) {
    if (w.decision !== 'import' || !w.familyKey) continue;
    const f = families.get(w.familyKey) ?? { key: w.familyKey, students: [], parents: [], rowIds: [], errors: 0, status: 'ready' as const, error: null };
    f.rowIds.push(w.r.id);
    if (w.studentKey && !f.students.includes(w.studentKey)) f.students.push(w.studentKey);
    for (const k of w.parentKeys) if (!f.parents.includes(k)) f.parents.push(k);
    if (w.r.status !== 'committed') f.errors += w.problems.filter((p) => p.severity === 'error').length;
    families.set(w.familyKey, f);
  }
  for (const f of families.values()) {
    const rs = f.rowIds.map((id) => rowById.get(id)!.r);
    const committed = rs.filter((r) => r.status === 'committed').length;
    const failed = rs.find((r) => r.status === 'failed');
    f.status = committed === rs.length ? 'committed' : f.errors ? 'held' : failed ? 'failed' : committed ? 'partly_committed' : 'ready';
    f.error = failed?.error ?? null;
  }

  // 10. The mapping, as staff choose it.
  const seriesOfTab = (t: SourceTab) => [...new Set(rows.filter((r) => r.tab === t.name).map((r) => read.get(r.id))
    .filter((d): d is SheetLine => d?.kind === 'sheet' && !!d.series).map((d) => seriesText(d.series!)))];
  const mapping = {
    tabs: tabs.map((t) => {
      const st = settings.tabs[t.name];
      const main = tabMainSeries.get(t.name);
      return {
        name: t.name, kind: t.kind, title: t.title, lines: t.lines, include: st?.include ?? false,
        classYear: st?.classYear ?? null, classYearLabel: st ? academicYearShortLabel(st.classYear) : null, yearSetUp: st ? yearByStart.has(st.classYear) : false,
        mainSeries: main ? seriesText(main) : null, series: seriesOfTab(t),
      };
    }),
    series: [...seriesGroups.values()].map((g) => {
      const st = settings.series[g.key]!;
      const matching = windows.filter((w) => w.sessionType === g.series.type && w.seriesYear === g.series.year && w.qualificationLevel === g.level);
      const open = matching.filter((w) => w.status === 'active');
      const boards = [...(levelBoards.get(g.key) ?? [])];
      return {
        key: g.key, label: seriesLabel(g.series.type, g.series.year), type: g.series.type, year: g.series.year, level: g.level,
        rows: work.filter((w) => w.seriesKey === g.key && w.decision === 'import').length,
        mode: st.mode, sessionId: st.sessionId,
        windows: matching.map((w) => ({ id: w.id, name: w.name, status: w.status })),
        suggestedWindowId: open.length === 1 ? open[0]!.id : null,
        boards,
        problems: boards.length > 1 ? [{ code: 'boards_in_series' as const, severity: 'info' as const, detail: `${boards.length} boards` }] : [],
        academicYear: academicYearShortLabel(seriesAcademicYearStart(g.series.type, g.series.year)),
      };
    }),
    subjects: [...subjectKeys.entries()].map(([key, s]) => {
      const of = work.filter((w) => w.subjectKey === key);
      return {
        key, subject: s.subject, levelCode: s.levelCode, rows: of.length, subjectId: settings.subjects[key]?.subjectId ?? null,
        suggestedId: subjectCandidates(s.subject, s.family)[0]?.id ?? null, chosenByStaff: stored.subjects?.[key] !== undefined,
        taughtInSchool: of.some((w) => w.d.kind === 'sheet' && !w.d.selfStudy),
        levelSuggested: s.family ? LEVEL_OF[s.family][0]! : null,
        isUnit: of.some((w) => w.d.kind === 'sheet' && w.d.isUnit),
      };
    }).sort((a, b) => a.subject.localeCompare(b.subject) || (a.levelCode ?? '').localeCompare(b.levelCode ?? '')),
    teachers: [...teacherNames.entries()].map(([key, name]) => {
      const st = settings.teachers[key]!;
      return {
        key, name, rows: work.filter((w) => w.d.kind === 'sheet' && w.d.teacher && teacherKeyOf(w.d.teacher) === key).length,
        teacherId: st.teacherId, teacherName: st.teacherId ? teacherById.get(st.teacherId)?.name ?? null : null, create: st.create,
        candidates: teachers.filter((t) => { const a = lower(t.name); return a === key || a.includes(key) || key.includes(a) || distance(a, key) <= 3; }).map((t) => t.id),
      };
    }).sort((a, b) => a.name.localeCompare(b.name)),
    sections: sectionList(students, work, kind, yearByStart, sectionByName),
    levelCodes: levelCodePanel(work, subjectById, reading),
  };

  // 11. File-wide notes, and the summary.
  const notes: { code: ImportNoteCode; detail: string | null }[] = [];
  if (kind === 'school_sheet') notes.push({ code: 'no_money', detail: null });
  if (kind === 'money_record') notes.push({ code: 'money_history_only', detail: null });
  for (const t of mapping.tabs) {
    if (t.kind === 'roster') notes.push({ code: 'roster_tab_ignored', detail: t.name });
    if (t.series.length > 1) notes.push({ code: 'two_series_one_tab', detail: `${t.name}: ${t.series.join(', ')}` });
    if (t.kind === 'session' && t.include && !t.yearSetUp && t.classYearLabel) notes.push({ code: 'year_not_set_up', detail: t.classYearLabel });
  }
  if (kind === 'scl_roster') {
    for (const c of new Set(students.filter((s) => s.section).map((s) => s.cohortYear).filter((y): y is number => y !== null))) {
      if (!yearByStart.has(c)) notes.push({ code: 'year_not_set_up', detail: academicYearShortLabel(c) });
    }
  }

  const importing = work.filter((w) => w.decision === 'import');
  const pending = importing.filter((w) => w.r.status !== 'committed');
  const byProblem: Record<string, number> = {};
  for (const w of importing) for (const p of w.problems) byProblem[p.code] = (byProblem[p.code] ?? 0) + 1;
  for (const w of work) if (w.decision === 'skip') for (const p of w.problems) if (p.code === 'duplicate_row') byProblem[p.code] = (byProblem[p.code] ?? 0) + 1;
  for (const p of active) for (const pr of p.problems) if (pr.severity !== 'error') byProblem[pr.code] = (byProblem[pr.code] ?? 0) + 1;
  for (const s of mapping.series) for (const pr of s.problems) byProblem[pr.code] = (byProblem[pr.code] ?? 0) + 1;
  const count = (f: (p: RowPlan) => boolean) => pending.filter((w) => f(w.plan)).length;
  const pendingPeople = active.filter((p) => p.status !== 'committed');
  const summary = {
    rows: rows.length,
    importing: importing.length,
    skipped: work.length - importing.length,
    committedRows: rows.filter((r) => r.status === 'committed').length,
    errors: pending.reduce((n, w) => n + w.problems.filter((p) => p.severity === 'error').length, 0),
    rowsWithErrors: pending.filter((w) => w.problems.some((p) => p.severity === 'error')).length,
    rowsWithWarnings: pending.filter((w) => w.problems.some((p) => p.severity === 'warning')).length,
    byProblem,
    families: families.size,
    readyFamilies: [...families.values()].filter((f) => f.status === 'ready' || f.status === 'failed' || f.status === 'partly_committed').length,
    heldFamilies: [...families.values()].filter((f) => f.status === 'held').length,
    committedFamilies: [...families.values()].filter((f) => f.status === 'committed').length,
    plan: {
      students: { create: pendingPeople.filter((p) => p.role === 'student' && !p.matched).length, match: pendingPeople.filter((p) => p.role === 'student' && p.matched).length },
      parents: { create: pendingPeople.filter((p) => p.role === 'parent' && !p.matched).length, match: pendingPeople.filter((p) => p.role === 'parent' && p.matched).length },
      links: new Set(pending.flatMap((w) => w.parentKeys.filter((_, i) => w.plan.links[i] === 'create').map((k) => `${k}|${w.studentKey}`))).size,
      sectionPlacements: new Set(pending.filter((w) => w.plan.section === 'add').map((w) => w.studentKey)).size,
      newSections: mapping.sections.filter((s) => !s.exists && s.yearSetUp).length,
      enrolments: count((p) => p.enrolment === 'create'),
      history: count((p) => p.registration === 'history'),
      registrations: count((p) => p.registration === 'live'),
      money: count((p) => p.money === 'create'),
      newTeachers: mapping.teachers.filter((t) => !t.teacherId && t.create).length,
      existing: {
        enrolments: count((p) => p.enrolment === 'exists'), history: count((p) => p.registration === 'history_exists'),
        registrations: count((p) => p.registration === 'live_exists'), money: count((p) => p.money === 'exists'),
      },
    },
  };

  return {
    kind,
    settings,
    notes,
    rows: work.map((w) => ({
      id: w.r.id, tab: w.r.tab, rowNumber: w.r.rowNumber, raw: w.r.raw, edits: w.r.edits,
      decision: w.decision, decisionSource: w.decisionSource, skipReason: w.skipReason,
      status: w.r.status, outcome: w.r.outcome, error: w.r.error,
      data: stripLocal(w.d), mode: w.mode,
      problems: w.decision === 'import' ? w.problems : w.problems.filter((p) => p.code === 'duplicate_row'),
      studentKey: w.studentKey, parentKeys: w.parentKeys, familyKey: w.familyKey, studentId: w.studentId,
      subjectKey: w.subjectKey, subjectId: w.subjectId, teacherId: w.teacherId, seriesKey: w.seriesKey, classYear: w.classYear, cohortYear: w.cohortYear,
      plan: w.plan,
    })),
    people: [...personViews.values()].sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)),
    families: [...families.values()],
    mapping,
    summary,
    options: {
      subjects: catalogue.map((s) => ({ id: s.id, name: s.name, code: s.code, qualificationLevel: s.qualificationLevel, council: s.council, isActive: s.isActive, isOfferedAtSchool: s.isOfferedAtSchool, price: s.courseFee + s.registrationFee })),
      teachers: teachers.map((t) => ({ id: t.id, name: t.name, isActive: t.isActive })),
      years: years.map((y) => ({ id: y.id, startYear: y.startYear, label: academicYearShortLabel(y.startYear) })).sort((a, b) => a.startYear - b.startYear),
      readings: LEVEL_CODE_READINGS,
    },
  };
}

export type ImportView = Awaited<ReturnType<typeof computeView>>;
export type ImportRowView = ImportView['rows'][number];
export type ImportPersonView = ImportView['people'][number];

function stripLocal(d: LineData): ImportLineView {
  const { local: _local, ...rest } = d;
  return rest;
}

type WorkLike = { r: { id: string }; d: LineData; studentKey: string | null; subjectId: string | null; decision: string; cohortYear: number | null };

/** What the catalogue works the school's code out from, for one row (IS-01). */
function levelInput(w: WorkLike, all: WorkLike[], subjects: Map<string, CatalogueRow>) {
  const sub = subjects.get(w.subjectId!)!;
  const d = w.d as SheetLine;
  const s = d.series!;
  const sitsA2 = all.some((o) => o.studentKey === w.studentKey && o.decision === 'import' && o.d.kind === 'sheet'
    && o.d.series?.type === s.type && o.d.series?.year === s.year && !!o.subjectId && !!subjects.get(o.subjectId)?.unitLevels.includes('a2'));
  return {
    qualificationLevel: sub.qualificationLevel, unitLevels: sub.unitLevels, awardLevels: sub.awardLevels,
    gradeInSeriesYear: gradeInAcademicYear(w.cohortYear, seriesAcademicYearStart(s.type, s.year)), studentSitsA2InSeries: sitsA2,
  };
}

/** How many rows' codes each reading of "A.S./A.2." agrees with (the coordinator's question, IS-01). */
function levelCodePanel(work: WorkLike[], subjects: Map<string, CatalogueRow>, current: LevelCodeReading) {
  const rows = work.filter((w) => w.decision === 'import' && w.d.kind === 'sheet' && !!w.subjectId && !!subjects.get(w.subjectId)?.unitLevels.length
    && !!(w.d as SheetLine).levelCode && (w.d as SheetLine).levelCode !== 'A.L.' && !!(w.d as SheetLine).series);
  const byReading = Object.fromEntries(LEVEL_CODE_READINGS.map((r) => {
    let agree = 0;
    let combined = 0;
    let combinedAgree = 0;
    for (const w of rows) {
      const d = w.d as SheetLine;
      const sheet = d.levelCode === 'A.S./A.L.' || d.levelCode === 'A.S.A.L.' ? 'A.S./A.2.' : d.levelCode;
      const derived = deriveLevelCode(levelInput(w, work, subjects), r);
      if (derived === sheet) agree++;
      if (sheet === 'A.S./A.2.') { combined++; if (derived === sheet) combinedAgree++; }
    }
    return [r, { agree, total: rows.length, combined, combinedAgree }];
  })) as Record<LevelCodeReading, { agree: number; total: number; combined: number; combinedAgree: number }>;
  return { current, byReading };
}

/** The sections the file places students in, and whether each exists in its year. */
function sectionList(
  students: PersonView[], work: Working[], kind: string,
  yearByStart: Map<number, { id: string; startYear: number }>, sectionByName: Map<string, { id: string }>,
) {
  const out = new Map<string, { name: string; year: number | null; yearLabel: string | null; yearSetUp: boolean; exists: boolean; grade: number; students: number }>();
  for (const p of students) {
    if (!p.section) continue;
    const yStart = kind === 'scl_roster' ? p.cohortYear : work.find((w) => w.studentKey === p.key && w.decision === 'import')?.classYear ?? null;
    const yr = yStart !== null ? yearByStart.get(yStart) : undefined;
    const key = `${yStart}|${p.section.toLowerCase()}`;
    const cur = out.get(key) ?? {
      name: p.section, year: yStart, yearLabel: yStart !== null ? academicYearShortLabel(yStart) : null, yearSetUp: !!yr,
      exists: !!(yr && sectionByName.get(`${yr.id}|${p.section.toLowerCase()}`)), grade: Number(/^\d+/.exec(p.section)?.[0] ?? 0), students: 0,
    };
    cur.students++;
    out.set(key, cur);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
