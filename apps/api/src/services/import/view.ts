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
 * - The mapping: each series and level to history or the session of that
 *   series (the reservations rework: a line on the offer and item the sheet's
 *   words name, priced from the series' fee grid), each subject to a catalogue
 *   row, each teacher to a record, the sections, and the coordinator's pending
 *   answers (self-study, carry forward).
 * - Per row, what a commit would do (the plan) and every problem; the
 *   file-wide notes (no money, a second series in a tab, rosters ignored).
 */
import {
  db, user, subject, teacher, academicYear, section, sectionMembership, registrationSession, courseEnrolment,
  registration, parentStudentLink, registrationHistory, moneyHistory, subjectUnit, examUnit, qualificationUnit, qualification,
  sessionOffer, sessionOfferItem, sessionOfferTeacher, sessionOfferItemTeacher, boardSeries, examBoard,
  eq, ne, and, or, inArray, isNull, notInArray, sql,
  type importBatch, type importRow, type importPerson,
} from '@repo/db';
import {
  IMPORT_PROBLEMS, academicYearShortLabel, academicYearStartOf, gradeInAcademicYear, gradeToday, seriesAcademicYearStart,
  seriesLabel, seriesOrder, seriesEndedBy, deriveLevelCode, LEVEL_CODE_READINGS,
  type ImportProblemCode, type ImportSeverity, type ImportNoteCode, type ImportRowEditsType, type ImportSettingsType,
  type SelfStudyRule, type CarryForwardReading, type SeriesMode, type LevelCodeReading, type HistoryOutcome,
  type UnitLevel, type ImportRowPlan, type ImportViewProblem, type ImportLineView, type ImportLinePlan,
} from '@repo/validations';
import { getSetting } from '../settings.services';
import { judgeEligibility, mayRegisterFor, type Eligibility } from '../eligibility.services';
import { schoolFeeGateReason } from '../school-fee.services';
import { findOffer, findItem, findOrCreateSeries, availabilityConstraints, OfferError } from '../offer.services';
import { priceLine, PricingError } from '../pricing.services';
import { assertLineRules, LineRuleError, type RuleLine } from '../line-rules.services';
import { effectiveDeadlineFor, deadlinePassedSentence } from '../deadline.services';
import { sessionWindow, windowRefusal, schoolDate } from '../window.services';
import { lineExceptions } from '../line-exceptions';
import type { SourceLine, SourceTab } from './source';
import {
  readSheetLine, readSclLine, readMoneyLine, tabRoles, cleanText, seriesText, readSeries,
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

const noPlan = (): RowPlan => ({ student: 'none', parents: [], links: [], section: 'none', enrolment: 'none', registration: 'none', money: 'none', line: null });

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

/**
 * The money-record lines' fingerprints: what each says, and which of several identical lines it is
 * (the first, the second…), never where it sits — a line inserted above does not make the lines below
 * new (review flag 3). `lines` are the file's lines in order.
 */
export function moneyFingerprints(lines: { id: string; studentId: string | null; d: Omit<MoneyLine, 'local'> }[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const { id, studentId, d } of lines) {
    const base = `money|${d.happenedOn ?? ''}|${d.amount ?? ''}|${d.direction ?? ''}|${d.moneyKind}|${d.percent ?? ''}|${(d.receiptNumber ?? '').toLowerCase()}|${lower(d.seriesLabel ?? '')}|${lower(d.subject ?? '')}|${lower(d.note ?? '')}`;
    // Counted per student (the row is unique per student and fingerprint).
    const k = `${studentId ?? d.studentRef.toLowerCase()}|${base}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    out.set(id, `${base}|${n}`);
  }
  return out;
}

/** A student id that is never an account: the school-fee gate of a student the import will create. */
const NEW_STUDENT = '00000000-0000-0000-0000-import-new';

// ─── The catalogue as the review reads it ────────────────────────────────────

type CatalogueRow = {
  id: string; name: string; code: string; council: string; qualificationLevel: string; isActive: boolean; isOfferedAtSchool: boolean;
  isCore: boolean; unitShortCodes: string[]; unitLevels: UnitLevel[]; awardLevels: string[];
};

async function loadCatalogue(): Promise<CatalogueRow[]> {
  const [subjects, units, awards] = await Promise.all([
    db.select({
      id: subject.id, name: subject.name, code: subject.code, council: subject.council, qualificationLevel: subject.qualificationLevel,
      isActive: subject.isActive, isOfferedAtSchool: subject.isOfferedAtSchool, isCore: subject.isCore,
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
  /** Accounts already in the system this person may be (review flag 3): the same name and a parent, child or phone. */
  possibleAccounts: { id: string; name: string; email: string; why: string }[];
};

export type ImportViewInput = { batch: BatchRow; rows: RowRecord[]; people: PersonRecord[] };

/** Everything the review shows, worked out now. */
export async function computeView({ batch, rows, people }: ImportViewInput) {
  const source = batch.source as { tabs?: SourceTab[] };
  const tabs: SourceTab[] = source.tabs ?? [];
  const stored = (batch.settings ?? {}) as ImportSettingsType;
  const kind = batch.kind as 'school_sheet' | 'scl_roster' | 'money_record';
  const nowYear = academicYearStartOf();

  const [catalogue, teachers, years, sessions, defaultSelfStudy, defaultCarry, graduateRetakes, reading] = await Promise.all([
    loadCatalogue(),
    db.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(teacher),
    db.select().from(academicYear),
    db.select({
      id: registrationSession.id, name: registrationSession.name, sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear,
      label: registrationSession.label, status: registrationSession.status,
    }).from(registrationSession),
    getSetting('import.selfStudyOnTaught'),
    getSetting('import.carryForward'),
    getSetting('eligibility.graduateRetakes'),
    getSetting('catalogue.levelCodeReading'),
  ]);
  type SessionRow = (typeof sessions)[number];
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

  // 4. Existing accounts by email (and, for the money record, by school ID). A merge may point at an account
  // already in the system (a child imported before under another email).
  const emails = new Set<string>();
  const refs = new Set<string>();
  for (const p of people) if (p.mergedInto?.includes('@')) emails.add(p.mergedInto.toLowerCase());
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
    // A person's email is their key when the key is one: after a merge, the email they were merged into.
    if (key.includes('@')) p.email = key;
    else if (!p.email && email) p.email = email;
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
      sclIds: [...p.sclIds], possibleAccounts: [],
    });
  }
  for (const dec of people) {
    const id = `${dec.role}|${dec.key}`;
    if (personViews.has(id) || !dec.mergedInto) continue;
    personViews.set(id, {
      role: dec.role as Role, key: dec.key, email: dec.key.includes('@') ? dec.key : null, name: dec.key, names: [], phone: null, phones: [], classes: [],
      section: null, cohortYear: null, gradeToday: null, rowIds: [], parentKeys: [], childKeys: [], matched: null, problems: [], familyKey: null,
      decision: dec.decision === 'skip' ? 'skip' : 'import', mergedInto: canonical(dec.role as Role, dec.key), mergedFrom: [], distinct: dec.distinct,
      oneChild: dec.oneChild, edits: dec.edits, status: dec.status, userId: dec.userId, error: dec.error, sclIds: [], possibleAccounts: [],
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

  // Already in the system under another email (review flag 3): a student with the same name as a student
  // account that has one of this student's parents (or the same phone), a parent with the same phone as a
  // parent account (or the same name, parent of one of this parent's children). An error: the family waits
  // until staff merge the person into that account or say they are different people.
  const unmatched = active.filter((p) => !p.matched && !p.distinct && p.email);
  if (unmatched.length) {
    const names = [...new Set(unmatched.map((p) => lower(p.name)).filter(Boolean))];
    const phones = [...new Set(unmatched.map((p) => p.phone).filter((x): x is string => !!x))];
    // Accounts this file's own commit made are its people, not accounts already in the system: a look-alike
    // among them is the review's warning (duplicate_student, duplicate_parent), as before the commit began.
    const ownAccounts = new Set(people.map((p) => p.userId).filter((x): x is string => !!x));
    const candidates = (await db.select({ id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone }).from(user)
      .where(and(inArray(user.role, ['student', 'parent']), or(
        names.length ? inArray(sql`lower(${user.name})`, names) : undefined,
        phones.length ? inArray(user.phone, phones) : undefined,
      )))).filter((c) => !ownAccounts.has(c.id));
    const candidateIds = candidates.map((c) => c.id);
    const links = candidateIds.length
      ? await db.select({ parentId: parentStudentLink.parentId, studentId: parentStudentLink.studentId }).from(parentStudentLink)
        .where(and(or(inArray(parentStudentLink.parentId, candidateIds), inArray(parentStudentLink.studentId, candidateIds)), inArray(parentStudentLink.status, ['pending', 'approved'])))
      : [];
    const linkedIds = new Set(links.flatMap((l) => [l.parentId, l.studentId]));
    const others = linkedIds.size
      ? await db.select({ id: user.id, email: user.email, phone: user.phone }).from(user).where(inArray(user.id, [...linkedIds]))
      : [];
    const emailOf = new Map(others.map((o) => [o.id, o.email.toLowerCase()]));
    const phoneOf = new Map(others.map((o) => [o.id, o.phone]));
    const parentsOf = (studentId: string) => links.filter((l) => l.studentId === studentId).map((l) => l.parentId);
    const childrenOf = (parentId: string) => links.filter((l) => l.parentId === parentId).map((l) => l.studentId);
    for (const p of unmatched) {
      const mine = p.role === 'student' ? p.parentKeys : p.childKeys;
      const myPhones = new Set(p.role === 'student'
        ? p.parentKeys.map((k) => personViews.get(`parent|${k}`)?.phone).filter((x): x is string => !!x) : []);
      for (const c of candidates) {
        if (c.role !== p.role || c.email.toLowerCase() === p.key) continue;
        const sameName = lower(c.name) === lower(p.name);
        const related = (p.role === 'student' ? parentsOf(c.id) : childrenOf(c.id));
        const sharesFamily = related.some((id) => mine.includes(emailOf.get(id) ?? ''));
        const sharesParentPhone = p.role === 'student' && related.some((id) => { const ph = phoneOf.get(id); return !!ph && myPhones.has(ph); });
        const samePhone = !!p.phone && c.phone === p.phone;
        const why = p.role === 'student'
          ? (sameName && sharesFamily ? 'the same name and parent' : sameName && (sharesParentPhone || samePhone) ? 'the same name and phone' : null)
          : (samePhone ? 'the same phone' : sameName && sharesFamily ? 'the same name and child' : null);
        if (why) p.possibleAccounts.push({ id: c.id, name: c.name, email: c.email.toLowerCase(), why });
      }
      if (p.possibleAccounts.length) {
        p.problems.push({ code: 'duplicate_account', severity: 'error', detail: p.possibleAccounts.map((a) => `${a.name} (${a.email}): ${a.why}`).join('; ') });
      }
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
    knownIds.length ? db.select({ studentId: registration.studentId, sessionId: registration.sessionId, offerItemId: registration.offerItemId, offerId: sessionOfferItem.offerId })
      .from(registration).innerJoin(sessionOfferItem, eq(sessionOfferItem.id, registration.offerItemId))
      .where(and(inArray(registration.studentId, knownIds), notInArray(registration.status, ['dropped', 'rejected', 'expired']))) : [],
    knownIds.length ? db.select({ studentId: moneyHistory.studentId, fingerprint: moneyHistory.fingerprint }).from(moneyHistory).where(inArray(moneyHistory.studentId, knownIds)) : [],
    yearIds.length ? db.select({ id: section.id, name: section.name, grade: section.grade, yearId: section.academicYearId }).from(section).where(inArray(section.academicYearId, yearIds)) : [],
    knownIds.length ? db.select({ studentId: registration.studentId, subjectId: registration.subjectId, sessionId: registration.sessionId }).from(registration)
      .where(and(inArray(registration.studentId, knownIds), inArray(registration.status, ['confirmed', 'dropped']))) : [],
  ]);
  const linkSet = new Set(links.map((l) => `${l.parentId}|${l.studentId}`));
  const memberOf = new Map(memberships.map((m) => [`${m.studentId}|${m.yearId}`, m]));
  const enrolSet = new Set(enrolled.map((e) => `${e.studentId}|${e.subjectId}|${e.yearId}`));
  const historySet = new Set(historyRows.map((h) => `${h.studentId}|${h.fingerprint}`));
  const liveItemSet = new Set(liveRegs.map((r) => `${r.studentId}|${r.sessionId}|${r.offerItemId}`));
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

  const moneyLineKeys = moneyFingerprints(work.filter((w) => w.d.kind === 'money').map((w) => ({ id: w.r.id, studentId: w.studentId, d: w.d as MoneyLine })));

  // 8. Row by row: the mapping's problems and what a commit would do.
  const isHistory = (w: Working) => {
    const d = w.d as SheetLine;
    return !w.seriesKey || settings.series[w.seriesKey]?.mode !== 'window' || neverLive(d);
  };
  // In this file: a history row of the same subject in an earlier series, over by now, is a sitting
  // before a line of this file (it is committed first, in the same transaction, so it is committed now).
  const historyInFile = new Map<string, { type: Series['type']; year: number }[]>();
  const now = new Date();
  for (const w of work) {
    if (w.decision === 'import' && w.d.kind === 'sheet' && w.studentKey && w.subjectId && w.d.series && isHistory(w) && historyOutcome(w.d) !== 'drop_intended'
      && seriesEndedBy(w.d.series.type, w.d.series.year, now)) {
      const k = `${w.studentKey}|${w.subjectId}`;
      historyInFile.set(k, [...(historyInFile.get(k) ?? []), { type: w.d.series.type, year: w.d.series.year }]);
    }
  }
  const earliestInFile = (k: string) => Math.min(...(historyInFile.get(k) ?? []).map((h) => seriesOrder(h.type, h.year)), Infinity);
  const levelBoards = new Map<string, Set<string>>();
  const eligibilityCache = new Map<string, Eligibility>();
  const feeCache = new Map<string, string | null>();
  /** Per (student, session): the rows with a line, for the rules on lines asked together below. */
  const liveGroups = new Map<string, { sid: string | null; sessionId: string; rows: Working[] }>();
  const linePlans = new Map<string, ImportLinePlan>();
  const linePrior = new Map<string, string | null>();

  // ── A line in a session (RESERVATIONS_REWORK.md §9's F7 list) ──
  type Target = {
    offerId: string; offerItemId: string; sessionId: string; subjectId: string; subjectName: string; itemLabel: string; itemKind: string;
    needsPriorSeries: boolean; offerAvailability: string; itemAvailability: string; seriesId: string | null; boardCode: string | null;
    month: string | null; year: number | null; seriesName: string | null; boardMonths: string[]; teachers: string[];
  };
  const factsCache = new Map<string, Target | null>();
  const itemFacts = async (itemId: string): Promise<Target | null> => {
    if (!factsCache.has(itemId)) {
      const [r] = await db.select({
        item: sessionOfferItem, subjectId: sessionOffer.subjectId, offerAvailability: sessionOffer.availability, subjectName: subject.name,
        boardCode: boardSeries.boardCode, month: boardSeries.month, year: boardSeries.year, label: boardSeries.label, boardName: examBoard.name, boardMonths: examBoard.seriesMonths,
      }).from(sessionOfferItem).innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId)).innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
        .leftJoin(boardSeries, eq(boardSeries.id, sessionOfferItem.boardSeriesId)).leftJoin(examBoard, eq(examBoard.code, boardSeries.boardCode))
        .where(eq(sessionOfferItem.id, itemId));
      if (!r) factsCache.set(itemId, null);
      else {
        const own = await db.select({ id: sessionOfferItemTeacher.teacherId }).from(sessionOfferItemTeacher).where(eq(sessionOfferItemTeacher.itemId, itemId));
        const teachers = own.length ? own : await db.select({ id: sessionOfferTeacher.teacherId }).from(sessionOfferTeacher).where(eq(sessionOfferTeacher.offerId, r.item.offerId));
        factsCache.set(itemId, {
          offerId: r.item.offerId, offerItemId: r.item.id, sessionId: r.item.sessionId, subjectId: r.subjectId, subjectName: r.subjectName,
          itemLabel: r.item.label, itemKind: r.item.kind, needsPriorSeries: r.item.needsPriorSeries,
          offerAvailability: r.offerAvailability, itemAvailability: r.item.availability, seriesId: r.item.boardSeriesId, boardCode: r.boardCode,
          month: r.month, year: r.year, seriesName: r.boardName && r.month ? `${r.boardName} ${seriesLabel(r.month, r.year!)}${r.label ? ` (${r.label})` : ''}` : null,
          boardMonths: (r.boardMonths as string[] | null) ?? [], teachers: teachers.map((t) => t.id),
        });
      }
    }
    return factsCache.get(itemId)!;
  };
  const findCache = new Map<string, { target: Target | null; found: ImportLinePlan['found'] | null; offerName: string | null; candidates: string[] }>();
  /** The offer and item the line's words name in the session (findOffer, findItem), or staff's choice on the line. */
  const targetOf = async (w: Working, d: SheetLine, sessionId: string) => {
    const chosen = (w.r.edits as ImportRowEditsType | null)?.offerItemId;
    if (chosen) {
      const t = await itemFacts(chosen);
      return t && t.sessionId === sessionId ? { target: t, found: 'staff' as const, offerName: t.subjectName, candidates: [] }
        : { target: null, found: null, offerName: null, candidates: ['the item chosen on the line is not offered in this session'] };
    }
    const label = d.noteOnePaper && d.feeNote ? `${d.subject} ${d.feeNote}` : d.subject;
    const key = `${sessionId}|${w.subjectId ?? ''}|${lower(label)}|${d.series?.type}|${d.series?.year}`;
    if (!findCache.has(key)) {
      const offer = await findOffer(db, sessionId, d.subject, { subjectId: w.subjectId });
      if (!offer) findCache.set(key, { target: null, found: null, offerName: null, candidates: [] });
      else {
        const it = await findItem(db, offer.offer.id, label, { month: d.series?.type ?? null, year: d.series?.year ?? null });
        findCache.set(key, it.item
          ? { target: await itemFacts(it.item.id), found: it.how!, offerName: offer.offer.name, candidates: [] }
          : { target: null, found: null, offerName: offer.offer.name, candidates: it.candidates.map((c) => c.label) });
      }
    }
    return findCache.get(key)!;
  };
  /** An earlier sitting in the board's calendar (a board series of the item's board), when the board sits that month. */
  const sittingBefore = (t: Target, s: { type: string; year: number }) =>
    !!t.month && t.year !== null && seriesOrder(s.type, s.year) < seriesOrder(t.month, t.year) && t.boardMonths.includes(s.type);
  /** The student's legacy history of the subject, an earlier series that had ended when it was committed (the interim rule, MO-25): the latest. */
  const legacySitting = (w: Working, sid: string | null, t: Target) => {
    const subjectIds = [...new Set([w.subjectId, t.subjectId].filter((x): x is string => !!x))];
    const fromDb = sid ? historyRows.filter((h) => h.studentId === sid && h.subjectId && subjectIds.includes(h.subjectId) && h.outcome !== 'drop_intended'
      && seriesEndedBy(h.sessionType, h.seriesYear, h.committedAt)).map((h) => ({ type: h.sessionType as Series['type'], year: h.seriesYear })) : [];
    const fromFile = subjectIds.flatMap((sub) => historyInFile.get(`${w.studentKey}|${sub}`) ?? []);
    return [...fromDb, ...fromFile].filter((s) => sittingBefore(t, s)).sort((a, b) => seriesOrder(b.type, b.year) - seriesOrder(a.type, a.year))[0] ?? null;
  };
  const seriesIdCache = new Map<string, string | null>();
  const existingSeriesId = async (boardCode: string, month: string, year: number) => {
    const k = `${boardCode}|${month}|${year}`;
    if (!seriesIdCache.has(k)) {
      const [r] = await db.select({ id: boardSeries.id }).from(boardSeries)
        .where(and(eq(boardSeries.boardCode, boardCode), eq(boardSeries.month, month), eq(boardSeries.year, year), eq(boardSeries.label, '')));
      seriesIdCache.set(k, r?.id ?? null);
    }
    return seriesIdCache.get(k)!;
  };
  const selfStudyException = async (sid: string | null, t: Target) => !!sid && (await lineExceptions.active(db, sid, ['gate.selfStudyFirstEntry'],
    { sessionId: t.sessionId, subjectId: t.subjectId, offerId: t.offerId, offerItemId: t.offerItemId })).length > 0;

  /**
   * The line a row makes in its session: its offer and item, its attempt and mode from the note (the
   * coordinator's answers and staff's choices on the line over it), the sitting it follows and from
   * where, its teacher and its price from the series' fee grid now. Pushes the line's problems.
   */
  const lineOf = async (w: Working, d: SheetLine, s: PersonView | undefined, sid: string | null, sess: SessionRow) => {
    const e = (w.r.edits ?? {}) as ImportRowEditsType;
    const out = { live: true, mode: (d.selfStudy ? 'self_study' : 'in_school') as 'in_school' | 'self_study', refusals: [] as string[], line: null as ImportLinePlan | null };
    const found = await targetOf(w, d, sess.id);
    if (!found.target) {
      if (!found.offerName) w.problems.push({ code: 'not_offered', severity: 'error', detail: `${sess.name} offers no subject for "${d.subject}"` });
      else w.problems.push({ code: 'item_unclear', severity: 'error', detail: `${found.offerName}: ${found.candidates.join(' · ') || 'no item fits'}` });
      return out;
    }
    const t = found.target;
    const c = availabilityConstraints(t.offerAvailability, t.itemAvailability);
    if (c.selfStudyOnly) {
      if (d.selfStudy) w.problems.push({ code: 'self_study_not_taught', severity: 'info', detail: null });
      out.mode = 'self_study';
    }
    // The attempt and the sitting it follows: staff's choice on the line, the student's legacy history,
    // a sitting the sheet names ("From June 2026"; "Carry forward on …" read as a result).
    const named = e.priorSitting ? { month: e.priorSitting.month, year: e.priorSitting.year, from: 'line' as const } : null;
    const carried = settings.carryForward === 'result' && d.carryForwardFrom ? readSeries(d.carryForwardFrom) : null;
    const noted = d.noteSitting ? { month: d.noteSitting.type, year: d.noteSitting.year, from: 'note' as const }
      : carried ? { month: carried.type, year: carried.year, from: 'carry_forward' as const } : null;
    const legacy = e.attempt === 'first' ? null : legacySitting(w, sid, t);
    const wantsRetake = e.attempt === 'retake' || (e.attempt !== 'first' && (d.noteRetake || d.noteOnePaper || t.itemKind === 'one_paper'));
    let attempt: 'first' | 'retake' = 'first';
    let prior: ImportLinePlan['priorSitting'] = null;
    if (t.needsPriorSeries && !wantsRetake && !legacy && e.attempt !== 'retake') {
      // A carried-forward route: a first entry carrying the sitting named (gate.priorSeries asks for it).
      const p = named ?? noted;
      if (p) prior = { ...p, source: 'declared_by_desk' };
    } else if (e.attempt === 'first') {
      attempt = 'first';
    } else if (named) {
      attempt = 'retake'; prior = { ...named, source: 'declared_by_desk' };
    } else if (legacy) {
      attempt = 'retake'; prior = { month: legacy.type, year: legacy.year, source: 'legacy', from: 'history' };
    } else if (noted) {
      attempt = 'retake'; prior = { ...noted, source: 'declared_by_desk' };
    } else if (wantsRetake) {
      attempt = 'retake';
    }
    const rule = d.selfStudyChoice ?? (settings.selfStudyOnTaught === 'retake_only' ? null : settings.selfStudyOnTaught);
    if (prior && !sittingBefore(t, { type: prior.month, year: prior.year })) {
      out.refusals.push(`${seriesText({ type: prior.month, year: prior.year })} is not a sitting of ${t.seriesName ?? 'the item’s board'} before this one: name another sitting on the line`);
    }
    if (attempt === 'retake' && !prior) {
      if (out.mode === 'self_study' && !c.selfStudyOnly && rule) {
        // The coordinator's answer (or staff's on the line) settles a self-study note with no sitting.
        attempt = 'first';
      } else {
        w.problems.push({ code: 'retake_sitting_missing', severity: 'error', detail: `${d.feeNote ? `"${d.feeNote}"` : 'a retake'}: name the sitting it follows on the line, or make it a first entry` });
      }
    }
    if (out.mode === 'self_study' && attempt === 'first' && !c.selfStudyOnly) {
      if (rule === 'in_school') {
        out.mode = 'in_school';
        w.problems.push({ code: 'self_study_on_taught', severity: 'info', detail: 'taken as taught in school' });
      } else if (rule === 'enrol_only') {
        out.live = false;
        w.problems.push({ code: 'self_study_on_taught', severity: 'info', detail: 'enrolled as self-study, no exam line made' });
        return out;
      } else if (await selfStudyException(sid, t)) {
        w.problems.push({ code: 'self_study_on_taught', severity: 'info', detail: 'a first entry in self-study, by the student’s exception' });
      } else {
        w.problems.push({ code: 'self_study_on_taught', severity: 'error', detail: 'Self-study on a first entry needs the exception: grant it on the Exceptions page or make it a retake with its sitting' });
      }
    }
    if (out.mode === 'self_study' && attempt === 'retake' && prior) {
      w.problems.push({ code: 'self_study_retake', severity: 'info', detail: `a retake of ${seriesText({ type: prior.month, year: prior.year })} (${prior.source === 'legacy' ? 'the student’s history' : 'named on the sheet or the line, to verify'})` });
    }
    // The teacher: the one the sheet names when the item or the subject's offer has them; else its only one; else none yet.
    let teacherId: string | null = null;
    if (out.mode === 'in_school') {
      if (w.teacherId && t.teachers.includes(w.teacherId)) teacherId = w.teacherId;
      else {
        if (d.teacher && t.teachers.length) w.problems.push({ code: 'teacher_not_on_offer', severity: 'warning', detail: `${d.teacher} does not teach ${t.subjectName} in ${sess.name}` });
        teacherId = t.teachers.length === 1 ? t.teachers[0]! : null;
      }
    }
    // The family's confirmation on the sheet: the line's consent (the imported channel).
    if (d.confirm !== 'confirm') w.problems.push({ code: 'consent_missing', severity: 'error', detail: null });
    // The session, the series and its deadline for this line.
    const priorId = prior && t.boardCode ? await existingSeriesId(t.boardCode, prior.month, prior.year) : null;
    linePrior.set(w.r.id, priorId);
    if (sess.status === 'closed') out.refusals.push(`${sess.name} is closed`);
    else if (!t.seriesId) out.refusals.push(`${t.subjectName} is entered in no board series: it cannot be reserved`);
    else {
      const win = await sessionWindow(sid ?? NEW_STUDENT, sess.id, { boardSeriesId: t.seriesId, attempt, priorSittingSeriesId: priorId, declarationRejected: false, subjectId: t.subjectId }, db, now, [t.subjectId]);
      if (!win.open) out.refusals.push(windowRefusal(win, `${sess.name} is not open for reservations`));
      else {
        const dl = await effectiveDeadlineFor(db, { boardSeriesId: t.seriesId, attempt, priorSittingSeriesId: priorId, declarationRejected: false, studentId: sid ?? NEW_STUDENT });
        if (!dl.at) out.refusals.push(`${t.subjectName} is entered in a board series with no entry deadline and no exam dates yet: it opens for reservations once they are set`);
        else if (dl.at <= now) out.refusals.push(deadlinePassedSentence(dl, schoolDate));
      }
    }
    // The price, from the series' fee grid now: a missing row is refused, naming the grid; a provisional one is marked.
    let price: ImportLinePlan['price'] = null;
    try {
      const p = await priceLine(db, { item: { id: t.offerItemId }, attempt, mode: out.mode, studentId: sid ?? NEW_STUDENT, sessionId: sess.id });
      price = {
        total: p.total, courseFee: p.courseFee, boardFee: p.registrationFee, provisional: p.provisional,
        courseFeeBase: p.basis.courseFeeBase, coursePercent: p.basis.coursePercent, boardFeeBase: p.basis.boardFeeBase, boardPercent: p.basis.boardPercent,
      };
      if (p.provisional) w.problems.push({ code: 'price_provisional', severity: 'info', detail: `board fee ${p.basis.boardFeeBase} in ${t.seriesName ?? 'its series'}` });
    } catch (err) {
      if (!(err instanceof PricingError)) throw err;
      w.problems.push({ code: 'fee_missing', severity: 'error', detail: err.message });
    }
    out.line = {
      sessionId: sess.id, sessionName: sess.name, offerId: t.offerId, offerItemId: t.offerItemId, subjectName: t.subjectName, itemLabel: t.itemLabel,
      found: found.found!, series: t.seriesName, attempt, mode: out.mode, priorSitting: prior, teacherId, price,
    };
    return out;
  };

  for (const w of work) {
    if (w.decision !== 'import') continue;
    const d = w.d;
    const plan = noPlan();
    w.plan = plan;
    if (d.kind === 'money') {
      if (w.studentId) plan.money = moneySet.has(`${w.studentId}|${moneyLineKeys.get(w.r.id)}`) ? 'exists' : 'create';
      continue;
    }
    const s = w.studentKey ? personViews.get(`student|${w.studentKey}`) : undefined;
    const sid = w.studentId;
    plan.student = s?.matched ? 'match' : 'create';
    for (const pk of w.parentKeys) {
      const p = personViews.get(`parent|${pk}`);
      plan.parents.push(p?.matched ? 'match' : 'create');
      const link = sid && p?.matched && linkSet.has(`${p.matched.id}|${sid}`) ? 'exists' : 'create';
      plan.links.push(link);
      // A new link that touches an account already in the system is never made silently (review flag 6):
      // staff confirm on the line that the sheet's email is that person.
      const existing = [s?.matched?.role === 'student' ? s : null, p?.matched?.role === 'parent' ? p : null].filter((x): x is NonNullable<typeof x> => !!x);
      if (link === 'create' && existing.length && !(w.r.edits as ImportRowEditsType | null)?.confirmLink) {
        w.problems.push({
          code: 'link_to_existing_account', severity: 'error',
          detail: `Link ${p?.name || pk} to ${s?.name || w.studentKey}? Already in the system: ${existing.map((x) => `${x.matched!.name} (${x.email})`).join(', ')}`,
        });
      }
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

    // The exam entry: history (what the student sat before the system), or a line awaiting payment in the session.
    let mode: 'in_school' | 'self_study' = d.selfStudy ? 'self_study' : 'in_school';
    let registerLive = !isHistory(w) && !!d.series;
    if (registerLive) {
      const sessionId = settings.series[w.seriesKey!]!.sessionId;
      const sess = sessions.find((x) => x.id === sessionId);
      if (!sess) {
        w.problems.push({ code: 'registration_refused', severity: 'error', detail: 'choose the session for this series on the Mapping tab' });
        plan.registration = 'live';
      } else {
        const l = await lineOf(w, d, s, sid, sess);
        mode = l.mode;
        registerLive = l.live;
        if (l.live) {
          // Eligibility and the school fee, as every reservation path asks them.
          const eKey = `${w.studentKey}|${sess.id}`;
          if (!eligibilityCache.has(eKey)) {
            eligibilityCache.set(eKey, sid ? await mayRegisterFor(sid, sess.id) : judgeEligibility(
              { id: NEW_STUDENT, name: s?.name || 'The student', role: 'student', cohortYear: s?.cohortYear ?? null, leftOn: null, leftKind: null },
              { id: sess.id, sessionType: sess.sessionType, seriesYear: sess.seriesYear },
              { graduateRetakes, grade10ExceptionId: null },
            ));
          }
          const el = eligibilityCache.get(eKey)!;
          if (!el.allowed) l.refusals.push(el.reason ?? 'The student may not sit this series');
          else {
            if (!feeCache.has(eKey)) feeCache.set(eKey, await schoolFeeGateReason(sid ?? NEW_STUDENT, el));
            const gate = feeCache.get(eKey);
            if (gate) l.refusals.push(gate);
          }
          if (l.refusals.length) w.problems.push({ code: 'registration_refused', severity: 'error', detail: l.refusals.join('; ') });
          if (l.line) {
            linePlans.set(w.r.id, l.line);
            plan.line = l.line;
            plan.registration = sid && liveItemSet.has(`${sid}|${sess.id}|${l.line.offerItemId}`) ? 'live_exists' : 'live';
            const k = `${w.studentKey}|${sess.id}`;
            const g = liveGroups.get(k) ?? { sid, sessionId: sess.id, rows: [] };
            g.rows.push(w);
            liveGroups.set(k, g);
          } else plan.registration = 'live';
        }
      }
    }
    if (!registerLive) {
      // IS-03 on what the student sat (information only).
      if (sub && !sub.isOfferedAtSchool) {
        mode = 'self_study';
        if (d.selfStudy) w.problems.push({ code: 'self_study_not_taught', severity: 'info', detail: null });
      } else if (d.selfStudy && sub && !w.problems.some((p) => p.code === 'self_study_on_taught')) {
        const order = d.series ? seriesOrder(d.series.type, d.series.year) : Infinity;
        const retake = (!!sid && satBefore(sid, sub.id, order, null)) || earliestInFile(`${w.studentKey}|${sub.id}`) < order;
        w.problems.push(retake ? { code: 'self_study_retake', severity: 'info', detail: null } : { code: 'self_study_on_taught', severity: 'info', detail: 'kept as history' });
      }
      if (d.series) plan.registration = sid && historySet.has(`${sid}|${historyFingerprint(d)}`) ? 'history_exists' : 'history';
    }
    w.mode = mode;
    // Enrolment in the class year: this year's teaching (F0b).
    const seriesYearStart = d.series ? seriesAcademicYearStart(d.series.type, d.series.year) : null;
    if (settings.enrol && y && sub && seriesYearStart === w.classYear && !neverLive(d)) {
      const cohort = s?.matched?.role === 'student' ? s.matched.cohortYear : s?.cohortYear ?? null;
      const g = gradeInAcademicYear(cohort, y.startYear);
      if (g !== null && g >= 10 && g <= 12 && !s?.matched?.leftOn && (mode === 'self_study' || sub.isOfferedAtSchool)) {
        if (sub.isActive) plan.enrolment = sid && enrolSet.has(`${sid}|${sub.id}|${y.id}`) ? 'exists' : 'create';
        else w.problems.push({ code: 'subject_inactive', severity: 'warning', detail: `${sub.name}: no enrolment while it is turned off` });
      }
    }
    // Money history: a fee note (IS-08), or a carried-forward payment (IS-02, when read that way).
    const moneyKeys = [...(d.feeNote ? [feeFingerprint(d)] : []), ...(d.carryForwardNote && settings.carryForward === 'payment' ? [carryFingerprint(d)] : [])];
    if (moneyKeys.length) plan.money = sid && moneyKeys.every((k) => moneySet.has(`${sid}|${k}`)) ? 'exists' : 'create';
  }

  // The rules on lines (assertLineRules, as the commit asks them), per student and session, in a
  // transaction rolled back: each line against the student's lines in the system and the file's
  // lines before it (availability, a retake's sitting, exclusive items, the same entry once, the
  // items a first entry requires, the carry-forward period). A sitting not yet on record is made
  // in it to be checked, and goes with the rollback. The grade-10 core rule is asked over the
  // student's lines together, below.
  class DryRun extends Error {}
  for (const g of liveGroups.values()) {
    const checkable = g.rows.filter((w) => !w.problems.some((p) => p.severity === 'error') && w.plan.registration === 'live');
    if (!checkable.length) continue;
    const el = eligibilityCache.get(`${checkable[0]!.studentKey}|${g.sessionId}`);
    if (!el?.allowed) continue;
    const refused = new Map<string, string>();
    await db.transaction(async (tx) => {
      const accepted: RuleLine[] = [];
      for (const w of checkable) {
        const line = linePlans.get(w.r.id)!;
        let priorId = linePrior.get(w.r.id) ?? null;
        try {
          await tx.transaction(async (sp) => {
            if (line.priorSitting && !priorId) {
              const t = (await itemFacts(line.offerItemId))!;
              priorId = (await findOrCreateSeries(sp, t.boardCode!, line.priorSitting.month, line.priorSitting.year, '', null, 'checked by the import review (rolled back)')).id;
            }
            const rl: RuleLine = { offerItemId: line.offerItemId, attempt: line.attempt, mode: line.mode, priorSittingSeriesId: priorId, priorSittingSource: line.priorSitting?.source ?? null };
            await assertLineRules(sp, { studentId: g.sid ?? NEW_STUDENT, sessionId: g.sessionId, eligibility: { grade: null, series: el.series } }, [...accepted, rl]);
            accepted.push(rl);
          });
        } catch (err) {
          if (err instanceof LineRuleError || err instanceof OfferError) refused.set(w.r.id, err.message);
          else throw err;
        }
      }
      throw new DryRun();
    }).catch((err) => { if (!(err instanceof DryRun)) throw err; });
    for (const w of checkable) {
      const why = refused.get(w.r.id);
      if (why) w.problems.push({ code: 'registration_refused', severity: 'error', detail: why });
    }
  }
  // Grade 10 in June: every core subject of the session (gate.grade10Core), over the student's lines in it.
  for (const [k, g] of liveGroups) {
    const el = eligibilityCache.get(k);
    if (!el?.allowed || el.grade !== 10 || el.series.sessionType !== 'june') continue;
    const core = await db.select({ id: sessionOffer.id, name: subject.name }).from(sessionOffer).innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
      .where(and(eq(sessionOffer.sessionId, g.sessionId), eq(sessionOffer.grade10Core, true), ne(sessionOffer.availability, 'closed')));
    const have = new Set([
      ...g.rows.map((w) => linePlans.get(w.r.id)?.offerId).filter((x): x is string => !!x),
      ...(g.sid ? liveRegs.filter((r) => r.studentId === g.sid && r.sessionId === g.sessionId).map((r) => r.offerId) : []),
    ]);
    const missing = core.filter((c) => !have.has(c.id)).map((c) => c.name).sort();
    if (!missing.length) continue;
    for (const w of g.rows) {
      w.problems.push({ code: 'registration_refused', severity: 'error', detail: `Grade 10 June session requires all core subjects. Missing: ${missing.join(', ')}` });
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
      // The session a series belongs to: June Y is the June session of Y; October and November Y the winter of Y; January Y the winter of Y−1.
      const cycle = { type: g.series.type === 'june' ? 'june' : 'winter', year: g.series.type === 'january' ? g.series.year - 1 : g.series.year };
      const matching = sessions.filter((x) => x.sessionType === cycle.type && x.seriesYear === cycle.year);
      const open = matching.filter((x) => x.status === 'active');
      const boards = [...(levelBoards.get(g.key) ?? [])];
      return {
        key: g.key, label: seriesLabel(g.series.type, g.series.year), type: g.series.type, year: g.series.year, level: g.level,
        rows: work.filter((x) => x.seriesKey === g.key && x.decision === 'import').length,
        mode: st.mode, sessionId: st.sessionId,
        windows: matching.map((x) => ({ id: x.id, name: x.name, status: x.status })),
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
    // The items of each session a series is mapped to, for staff to choose a line's item when its words cannot tell.
    sessionItems: await sessionItemsOf([...new Set(Object.values(settings.series).filter((x) => x.mode === 'window' && x.sessionId).map((x) => x.sessionId!))]),
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
      subjects: catalogue.map((s) => ({ id: s.id, name: s.name, code: s.code, qualificationLevel: s.qualificationLevel, council: s.council, isActive: s.isActive, isOfferedAtSchool: s.isOfferedAtSchool })),
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

/** Each session's items (subject — item, its series), open ones first, for the row editor's choice. */
async function sessionItemsOf(sessionIds: string[]) {
  const out: Record<string, { id: string; subjectName: string; label: string; kind: string; availability: string; series: string | null }[]> = {};
  if (!sessionIds.length) return out;
  const rows = await db.select({
    id: sessionOfferItem.id, sessionId: sessionOfferItem.sessionId, subjectName: subject.name, label: sessionOfferItem.label, kind: sessionOfferItem.kind,
    availability: sessionOfferItem.availability, boardName: examBoard.name, month: boardSeries.month, year: boardSeries.year, seriesLabel: boardSeries.label,
  }).from(sessionOfferItem).innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId)).innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .leftJoin(boardSeries, eq(boardSeries.id, sessionOfferItem.boardSeriesId)).leftJoin(examBoard, eq(examBoard.code, boardSeries.boardCode))
    .where(inArray(sessionOfferItem.sessionId, sessionIds))
    .orderBy(subject.name, sessionOfferItem.sortOrder, sessionOfferItem.label);
  for (const r of rows) {
    (out[r.sessionId] ??= []).push({
      id: r.id, subjectName: r.subjectName, label: r.label, kind: r.kind, availability: r.availability,
      series: r.boardName && r.month ? `${r.boardName} ${seriesLabel(r.month, r.year!)}${r.seriesLabel ? ` (${r.seriesLabel})` : ''}` : null,
    });
  }
  return out;
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
