/**
 * F7: reading a line — the school's words turned into fields the system
 * holds, each change the reading makes flagged (IMPORT_SPIKE.md: IS-01 level
 * codes and units, IS-02 carry forward, IS-03 self-study, IS-05 a second
 * series in a tab, IS-06 emails, IS-08 fee notes, IS-09 phones, IS-10 names,
 * IS-11 columns that drift, IS-12 the Signature column). Pure: no database.
 * Staff fixes (ImportRowEdits) are applied over what was read.
 */
import type {
  MoneyHistoryKind, ImportRowEditsType, ImportSeriesType, ImportSeries, ImportLevelFamily, ImportLineProblem, ImportSheetLine,
  ImportSclParent, ImportSclLine, ImportMoneyLine, ImportLineData,
} from '@repo/validations';
import { isUnlabeled, type SourceLine, type SourceTab } from './source';

export type SeriesType = ImportSeriesType;
export type Series = ImportSeries;
export type LevelFamily = ImportLevelFamily;
export type Problem = ImportLineProblem;
export type SheetLine = ImportSheetLine;
export type SclParent = ImportSclParent;
export type SclLine = ImportSclLine;
export type MoneyLine = ImportMoneyLine;
export type LineData = ImportLineData;

// ─── Small readers ───────────────────────────────────────────────────────────

/** Trailing, non-breaking and doubled spaces removed (IS-10). */
export const cleanText = (s: string | undefined | null) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normEmail = (s: string) => cleanText(s).toLowerCase();
export const emailOk = (s: string) => EMAIL_RE.test(s);

/**
 * An Egyptian mobile, as the school writes it (IS-09): a phone stored as a
 * number lost its leading 0 (1012345678 → 01012345678); +20 and 0020 are
 * dropped. Null: not a mobile after all that.
 */
export function readPhone(raw: string): { phone: string | null; restored: boolean } {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { phone: null, restored: false };
  if (/^01\d{9}$/.test(digits)) return { phone: digits, restored: false };
  if (/^1\d{9}$/.test(digits)) return { phone: `0${digits}`, restored: true };
  if (/^201\d{9}$/.test(digits)) return { phone: `0${digits.slice(2)}`, restored: false };
  if (/^00201\d{9}$/.test(digits)) return { phone: `0${digits.slice(4)}`, restored: false };
  return { phone: null, restored: false };
}

/** "11A", "11 A", "11-a" → grade 11, section "11A" (IS-04). */
export function readClass(raw: string): { grade: number | null; section: string | null } {
  const m = /^(\d{1,2})\s*[-/ ]?\s*([A-Za-z])$/.exec(cleanText(raw));
  if (!m) return { grade: null, section: null };
  return { grade: Number(m[1]), section: `${Number(m[1])}${m[2]!.toUpperCase()}` };
}

/** The school's level codes (IS-01), however spaced or dotted. */
export function readLevel(raw: string): { code: string | null; family: LevelFamily | null } {
  const k = cleanText(raw).toUpperCase().replace(/[\s.]/g, '');
  const map: Record<string, [string, LevelFamily]> = {
    OL: ['O.L.', 'igcse'], IGCSE: ['O.L.', 'igcse'], OLEVEL: ['O.L.', 'igcse'],
    AS: ['A.S.', 'as'],
    A2: ['A.2.', 'a2'],
    AL: ['A.L.', 'al'], ALEVEL: ['A.L.', 'al'],
    'AS/A2': ['A.S./A.2.', 'combined'],
    'AS/AL': ['A.S./A.L.', 'combined'],
    ASAL: ['A.S.A.L.', 'combined'],
    ASA2: ['A.S./A.2.', 'combined'],
  };
  const hit = map[k];
  return hit ? { code: hit[0], family: hit[1] } : { code: null, family: null };
}

/** A unit or paper set registered on its own (IS-01): "Pure Mathematics 1 (P1)", "Biology (Paper 3 & Paper 4)". */
export const isUnitSubject = (subject: string) => /\((?:P|M|S|D|FP|F)\d\)|\bPaper\s*\d/i.test(subject);

const MONTHS: Record<string, SeriesType> = { jan: 'january', june: 'june', jun: 'june', may: 'june', oct: 'october', nov: 'november' };

/** A series from an Excel date serial (the form's series column) or text ("November 2026", "Nov. 2026 Session"). */
export function readSeries(raw: string): Series | null {
  const t = cleanText(raw);
  if (/^\d{5}$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86_400_000);
    const month = d.getUTCMonth() + 1;
    const type: SeriesType | null = month === 1 ? 'january' : month === 5 || month === 6 ? 'june' : month === 10 ? 'october' : month === 11 ? 'november' : null;
    return type ? { type, year: d.getUTCFullYear() } : null;
  }
  const m = /\b(jan|june?|may|oct|nov)[a-z]*\.?\s*[-/ ]?\s*(\d{4})\b/i.exec(t);
  if (!m) return null;
  return { type: MONTHS[m[1]!.toLowerCase()]!, year: Number(m[2]) };
}

export const seriesText = (s: Series) => `${s.type[0]!.toUpperCase()}${s.type.slice(1)} ${s.year}`;

const CONFIRM_RE = /confirm my registration|drop the course/i;
const FEE_RE = /school fees|refund\s*\d|self\s*study|external/i;
const YESNO_RE = /^(yes|no)$/i;

/** A fee note (IS-08): its kind and percentage. */
export function readFeeNote(note: string, dropIntent: boolean): { kind: MoneyHistoryKind; percent: number | null } {
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(note);
  const percent = pct ? Math.min(100, Number(pct[1])) : null;
  const kind: MoneyHistoryKind =
    /dropped/i.test(note) ? 'drop'
    : /refund/i.test(note) ? 'refund'
    : /self\s*study/i.test(note) ? 'self_study_rate'
    : /external/i.test(note) ? 'external_rate'
    : dropIntent ? 'drop'
    : 'other';
  return { kind, percent };
}

// ─── The school's sheet ──────────────────────────────────────────────────────

type Roles = {
  byName: Map<string, string>; // lower-case header → label
  series: string | null;
  parentName: string | null;
  confirm: string | null;
  fee: string | null;
  yesno: string | null;
  titleSeries: Series | null;
};

/**
 * What each column of a tab holds. Named headers are read by name; the
 * form's unlabeled columns are recognised by what most of their values say
 * (the series dates, the confirmation, the fee note, the self-study
 * answer), and the parent's name is the unlabeled column after the student's
 * email (IS-11).
 */
export function tabRoles(tab: SourceTab, lines: SourceLine[]): Roles {
  const byName = new Map(tab.columns.filter((c) => !isUnlabeled(c)).map((c) => [c.toLowerCase(), c]));
  const unlabeled = tab.columns.filter(isUnlabeled);
  const values = (label: string) => lines.map((l) => l.raw.find(([k]) => k === label)?.[1] ?? '').map(cleanText).filter(Boolean);
  const dominant = (test: (v: string) => boolean) => {
    let best: string | null = null;
    let bestN = 0;
    for (const c of unlabeled) {
      const vs = values(c);
      const n = vs.filter(test).length;
      if (n > bestN && n >= vs.length / 2) { best = c; bestN = n; }
    }
    return best;
  };
  const emailCol = tab.columns.findIndex((c) => c.toLowerCase() === 'student email');
  const afterEmail = emailCol >= 0 ? tab.columns[emailCol + 1] : undefined;
  return {
    byName,
    series: dominant((v) => readSeries(v) !== null && /^\d{5}$|\d{4}/.test(v)),
    parentName: byName.get('parent name') ?? (afterEmail && isUnlabeled(afterEmail) ? afterEmail : null),
    confirm: dominant((v) => CONFIRM_RE.test(v)),
    fee: dominant((v) => FEE_RE.test(v)),
    yesno: dominant((v) => YESNO_RE.test(v)),
    titleSeries: readSeries(tab.title),
  };
}

/** One line of the school's sheet, read, with the staff's fixes over it. */
export function readSheetLine(line: SourceLine, roles: Roles, edits: ImportRowEditsType): SheetLine {
  const local: Problem[] = [];
  const cell = (label: string | null | undefined) => (label ? line.raw.find(([k]) => k === label)?.[1] ?? '' : '');
  const named = (...names: string[]) => {
    for (const n of names) {
      const label = roles.byName.get(n);
      if (label) return cell(label);
    }
    return '';
  };
  const cleaned = (raw: string, who: string) => {
    const c = cleanText(raw);
    if (raw && raw !== c && !local.some((p) => p.code === 'name_cleaned')) local.push({ code: 'name_cleaned', detail: who });
    return c;
  };

  // Free-text answers read by what they say, wherever they sit (IS-11).
  const unlabeledCells = line.raw.filter(([k]) => isUnlabeled(k));
  const find = (re: RegExp) => unlabeledCells.find(([, v]) => re.test(cleanText(v)));
  const confirmCell = find(CONFIRM_RE);
  const feeCell = unlabeledCells.find(([, v]) => FEE_RE.test(cleanText(v)) && !CONFIRM_RE.test(cleanText(v)));
  const yesnoCell = find(YESNO_RE);
  const drift: string[] = [];
  if (confirmCell && roles.confirm && confirmCell[0] !== roles.confirm) drift.push('the confirmation');
  if (feeCell && roles.fee && feeCell[0] !== roles.fee) drift.push('the fee note');
  if (yesnoCell && roles.yesno && yesnoCell[0] !== roles.yesno) drift.push('the self-study answer');
  if (drift.length) local.push({ code: 'column_drift', detail: `${drift.join(' and ')} ${drift.length === 1 ? 'is' : 'are'} in another column` });

  const confirmText = cleanText(confirmCell?.[1]);
  const confirm = /drop the course/i.test(confirmText) ? 'drop_intent' : /confirm my registration/i.test(confirmText) ? 'confirm' : null;
  const feeNote = cleanText(feeCell?.[1]) || null;

  // Names, emails, phones.
  const studentName = edits.studentName ?? cleaned(named('student name'), 'student');
  const parentName = edits.parentName ?? cleaned(cell(roles.parentName), 'parent');
  const studentEmail = normEmail(edits.studentEmail ?? named('student email'));
  const parentEmail = normEmail(edits.parentEmail ?? named('parent email'));
  const restored: string[] = [];
  const unusable: string[] = [];
  const phoneOf = (edited: string | undefined, raw: string, who: string) => {
    if (edited !== undefined) return readPhone(edited).phone;
    const p = readPhone(raw);
    if (p.restored) restored.push(who);
    else if (raw.trim() && !p.phone) unusable.push(who);
    return p.phone;
  };
  const studentPhone = phoneOf(edits.studentPhone, named('student no.', 'student phone', 'student no'), 'student');
  const parentPhone = phoneOf(edits.parentPhone, named('parent no.', 'parent phone', 'parent no'), 'parent');
  if (restored.length) local.push({ code: 'phone_restored', detail: restored.join(' and ') });
  if (unusable.length) local.push({ code: 'phone_unusable', detail: unusable.join(' and ') });

  // Class, level, subject, series.
  const classText = edits.classGrade ?? cleanText(named('class & grade', 'class', 'grade'));
  const cls = readClass(classText);
  if (!cls.grade) local.push({ code: 'class_unreadable', detail: classText ? `"${classText}"` : 'empty' });
  else if (cls.grade < 9 || cls.grade > 12) local.push({ code: 'grade_out_of_range', detail: `grade ${cls.grade}` });
  const levelText = edits.levelCode ?? cleanText(named('specification', 'level'));
  const level = readLevel(levelText);
  if (!level.code) local.push({ code: 'level_code_unknown', detail: levelText ? `"${levelText}"` : 'empty' });
  const subject = edits.subject ?? cleanText(named('subject'));
  const isUnit = isUnitSubject(subject);
  if (isUnit) local.push({ code: 'unit_row' });
  if (level.family === 'combined' && /\((?:P|M|S|D)\d\)/i.test(subject)) local.push({ code: 'level_code_combined_on_unit', detail: `${level.code} on ${subject}` });
  if (level.code === 'A.L.') local.push({ code: 'level_code_al' });

  let series: Series | null = null;
  let seriesSource: SheetLine['seriesSource'] = null;
  if (edits.series) { series = edits.series; seriesSource = 'edit'; }
  else {
    const fromColumn = roles.series ? readSeries(cell(roles.series)) : null;
    if (fromColumn) { series = fromColumn; seriesSource = 'column'; }
    else if (roles.titleSeries) { series = roles.titleSeries; seriesSource = 'title'; }
  }
  if (!series) local.push({ code: 'series_missing' });

  // Self-study: the yes/no answer or a fee note that says so (IS-03, IS-08).
  const answeredYes = /^yes$/i.test(cleanText(yesnoCell?.[1]));
  const noteSaysSelf = !!feeNote && /self\s*study|external/i.test(feeNote);
  const selfStudy = edits.selfStudy ?? (answeredYes || noteSaysSelf);

  const teacherText = edits.teacher ?? cleanText(named('teacher'));
  const teacher = teacherText || null;
  if (roles.byName.has('teacher') && !teacher && !selfStudy) local.push({ code: 'teacher_missing' });
  if (teacher && selfStudy) local.push({ code: 'teacher_on_self_study' });

  // The staff column (June 2023's Signature): carry forward, or a staff name (IS-02, IS-12).
  const signatureText = cleanText(named('signature'));
  let carryForwardFrom: string | null = null;
  let carryForwardNote: string | null = null;
  if (/carry\s*forward/i.test(signatureText)) {
    carryForwardNote = signatureText.replace(/[()]/g, '').trim();
    const from = readSeries(signatureText.replace(/carry\s*forward/i, ''));
    carryForwardFrom = from ? seriesText(from) : null;
    local.push({ code: 'carry_forward', detail: carryForwardFrom ? `from ${carryForwardFrom}` : undefined });
  } else if (signatureText) local.push({ code: 'signature' });

  const fee = feeNote ? readFeeNote(feeNote, confirm === 'drop_intent') : null;
  if (feeNote) local.push({ code: /dropped/i.test(feeNote) ? 'dropped' : 'fee_note', detail: feeNote });
  if (confirm === 'drop_intent') local.push({ code: 'drop_intent' });

  const noParent = edits.noParent === true;
  const studentEmailOk = emailOk(studentEmail);
  const parentEmailOk = emailOk(parentEmail);
  if (!studentEmailOk) local.push({ code: 'email_student_missing', detail: studentEmail ? 'not an email' : 'empty' });
  if (!noParent && !parentEmailOk) local.push({ code: 'email_parent_missing', detail: parentEmail ? 'not an email' : 'empty' });
  if (studentEmailOk && !noParent && studentEmail === parentEmail) local.push({ code: 'email_student_is_parent', detail: 'on this row' });

  return {
    kind: 'sheet',
    studentName, studentEmail, studentEmailOk, studentPhone,
    parentName, parentEmail: noParent ? '' : parentEmail, parentEmailOk: !noParent && parentEmailOk, parentPhone: noParent ? null : parentPhone, noParent,
    classText, grade: cls.grade, section: cls.section,
    levelText, levelCode: level.code, levelFamily: level.family,
    subject, isUnit, teacher,
    series, seriesSource,
    confirm, selfStudy, selfStudyChoice: edits.selfStudyChoice ?? null,
    feeNote, feeKind: fee?.kind ?? null, feePercent: fee?.percent ?? null,
    carryForwardFrom, carryForwardNote,
    local,
  };
}

// ─── SCL's grade-9 roster (template) ─────────────────────────────────────────

export function readSclLine(line: SourceLine, edits: ImportRowEditsType): SclLine {
  const local: Problem[] = [];
  const cell = (k: string) => cleanText(line.raw.find(([h]) => h === k)?.[1]);
  const studentName = edits.studentName ?? cell('student_name');
  const studentEmail = normEmail(edits.studentEmail ?? cell('student_email'));
  const restored: string[] = [];
  const unusable: string[] = [];
  const phone = (edited: string | undefined, raw: string, who: string) => {
    if (edited !== undefined) return readPhone(edited).phone;
    const p = readPhone(raw);
    if (p.restored) restored.push(who);
    else if (raw && !p.phone) unusable.push(who);
    return p.phone;
  };
  const gradeText = edits.classGrade ?? cell('grade');
  const grade = /^\d{1,2}$/.test(gradeText) ? Number(gradeText) : null;
  if (grade === null) local.push({ code: 'class_unreadable', detail: gradeText ? `"${gradeText}"` : 'empty' });
  else if (grade < 9 || grade > 12) local.push({ code: 'grade_out_of_range', detail: `grade ${grade}` });
  const sectionText = cell('grade10_section');
  const section = sectionText ? readClass(sectionText).section ?? sectionText : null;
  const noParent = edits.noParent === true;
  const parents: SclParent[] = [];
  const first = { name: edits.parentName ?? cell('parent_name'), email: normEmail(edits.parentEmail ?? cell('parent_email')), phone: phone(edits.parentPhone, cell('parent_phone'), 'parent') };
  if (!noParent) parents.push({ ...first, emailOk: emailOk(first.email) });
  const second = { name: cell('second_parent_name'), email: normEmail(cell('second_parent_email')), phone: phone(undefined, cell('second_parent_phone'), 'second parent') };
  if (!noParent && second.email) parents.push({ ...second, emailOk: emailOk(second.email) });
  const studentPhone = phone(edits.studentPhone, cell('student_phone'), 'student');
  if (restored.length) local.push({ code: 'phone_restored', detail: restored.join(' and ') });
  if (unusable.length) local.push({ code: 'phone_unusable', detail: unusable.join(' and ') });
  const studentEmailOk = emailOk(studentEmail);
  if (!studentEmailOk) local.push({ code: 'email_student_missing', detail: studentEmail ? 'not an email' : 'empty' });
  if (!noParent && !parents[0]?.emailOk) local.push({ code: 'email_parent_missing', detail: first.email ? 'not an email' : 'empty' });
  if (parents.some((p) => p.email && p.email === studentEmail)) local.push({ code: 'email_student_is_parent', detail: 'on this row' });
  return {
    kind: 'scl', studentName, studentEmail, studentEmailOk, studentPhone,
    sclId: cell('scl_student_id') || null, grade, section, parents, noParent, local,
  };
}

// ─── The money record (template; F-01) ───────────────────────────────────────

/** A date as a person writes it: 2026-10-05, 5/10/2026 (day first, as in Egypt), or an Excel serial. */
export function readDate(raw: string): string | null {
  const t = cleanText(raw);
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (hit) { y = +hit[1]!; m = +hit[2]!; d = +hit[3]!; }
  else if ((hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) { d = +hit[1]!; m = +hit[2]!; y = +hit[3]!; }
  else if (/^\d{5}$/.test(t)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86_400_000);
    return date.toISOString().slice(0, 10);
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

export function readMoneyLine(line: SourceLine, edits: ImportRowEditsType): MoneyLine {
  const local: Problem[] = [];
  const cell = (k: string) => cleanText(line.raw.find(([h]) => h === k)?.[1]);
  const studentRef = cleanText(edits.studentRef ?? cell('student'));
  const dateText = edits.date ?? cell('date');
  const happenedOn = dateText ? readDate(dateText) : null;
  if (dateText && !happenedOn) local.push({ code: 'date_unreadable', detail: `"${dateText}"` });
  const amountText = (edits.amount ?? cell('amount_egp')).replace(/[,\s]|egp|le|جنيه/gi, '');
  const amount = amountText ? (/^\d+(\.\d{1,2})?$/.test(amountText) ? Number(amountText) : NaN) : null;
  if (amount !== null && Number.isNaN(amount)) local.push({ code: 'amount_unreadable', detail: `"${edits.amount ?? cell('amount_egp')}"` });
  const kindText = cell('kind').toLowerCase();
  const note = cell('note') || null;
  const moneyKind: MoneyHistoryKind =
    /^pay|paid|payment/.test(kindText) ? 'payment'
    : /refund/.test(kindText) ? 'refund'
    : /drop/.test(kindText) ? 'drop'
    : /self/.test(kindText) ? 'self_study_rate'
    : /external/.test(kindText) ? 'external_rate'
    : /carr/.test(kindText) ? 'carried_forward'
    : 'other';
  const dirText = cell('direction').toLowerCase();
  const direction = /^in|paid|to the school/.test(dirText) ? 'in' : /^out|back|refund/.test(dirText) ? 'out'
    : amount === null ? null : moneyKind === 'payment' ? 'in' : moneyKind === 'refund' ? 'out' : null;
  const pctText = cell('percent').replace('%', '');
  const percent = pctText && /^\d+(\.\d+)?$/.test(pctText) ? Math.min(100, Number(pctText)) : null;
  return {
    kind: 'money', studentRef, happenedOn, amount: amount !== null && !Number.isNaN(amount) ? amount : null, direction, moneyKind, percent,
    method: cell('method') || null, receiptNumber: cell('receipt_number') || null, seriesLabel: cell('series') || null,
    subject: cell('subject') || null, note, local,
  };
}
