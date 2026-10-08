/**
 * The school F4's suites run in (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md), on the
 * reservations rework's model (RESERVATIONS_REWORK.md §3.2–§3.5): staff of every role, a catalogue
 * with a Cambridge AS syllabus (three components, two option codes) and a Pearson IAL award (two W
 * units and the cash-in), a winter session whose offers' items enter them — the Cambridge syllabus
 * whole (an award item, in Cambridge's November), Pearson's P1 (a units item, in Pearson's January)
 * and the whole Pearson award (an award item) — each with its board fee in its series' grid,
 * families reserved and paid at the desk (lines and consent), and the teachers who teach them.
 * Everything goes through the API.
 *
 * Every code carries the suite's tag, so suites sharing the database never collide in the
 * catalogue; the session and the series carry it as their label. Subjects are made through the
 * API, not the shared helper, so the file's other sessions are not offered them.
 */
import { expect } from 'vitest';
import { apiResponse, academicYearStartOf, seriesYearInAcademicYear } from '@repo/validations';
import { admin, staff, onboard, one, CONSENT, type Client } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const cairoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);

export type Family = { parent: Client; student: Client; studentId: string };
export type Month = 'january' | 'june' | 'october' | 'november';
export type Line = {
  offerItemId: string; attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study'; teacherId?: string | null;
  priorSittingSeriesId?: string | null; priorSitting?: { month: Month; year: number };
};

/**
 * `enrol: false` leaves course enrolment (and so this year's academic year)
 * alone: 05 runs before 08f, which creates this year's academic year itself.
 */
export async function examWorld(tag: string, opts: { enrol?: boolean } = {}) {
  const T = tag.toUpperCase();
  const Y = academicYearStartOf();
  const adm = await admin(`x-${tag}`);
  const coordinator = await staff(adm, 'coordinator', `x-${tag}`);
  const officer = await staff(adm, 'finance_officer', `x-${tag}`);
  const finadmin = await staff(adm, 'finance_admin', `x-${tag}`);
  const teacher = await staff(adm, 'teacher', `x-${tag}`);
  const teacher2 = await staff(adm, 'teacher', `x-${tag}-2`);
  const gate = await staff(adm, 'gate', `x-${tag}`);
  const teacherId = (await one<{ id: string }>(`select id from teacher where user_id = $1`, [teacher.id])).id;
  const teacher2Id = (await one<{ id: string }>(`select id from teacher where user_id = $1`, [teacher2.id])).id;
  // A winter session (November Y – January Y+1): Cambridge's AS sits November, Pearson's IAL January.
  const type = 'winter' as const;
  const level = 'as_level' as const;

  // ─── The catalogue ────────────────────────────────────────────────────────
  const cat = coordinator.api.v1.catalogue;
  const cSyllabus = await apiResponse(cat.qualifications.$post({ json: {
    boardCode: 'cambridge', code: `${T}97`, title: `Biology ${T}`, level, suite: 'Cambridge International AS & A Level',
    subjectArea: `Biology ${T}`, entryMethod: 'syllabus_option',
  } }));
  const component = async (code: string, title: string) => (await apiResponse(cat.units.$post({ json: {
    boardCode: 'cambridge', code, shortCode: title, title, unitLevel: 'as', kind: 'component',
  } }))).id;
  const cp1 = await component(`${T}97/12`, 'Paper 1');
  const cp2 = await component(`${T}97/22`, 'Paper 2');
  const cp3 = await component(`${T}97/33`, 'Paper 3');
  await apiResponse(cat.qualifications[':id'].units.$put({ param: { id: cSyllabus.id }, json: { units: [cp1, cp2, cp3].map((unitId) => ({ unitId, requirement: 'required' as const })) } }));
  const optAll = await apiResponse(cat.qualifications[':id'].options.$post({ param: { id: cSyllabus.id }, json: { code: 'A1', label: 'Papers 1, 2 and 3', unitIds: [cp1, cp2, cp3] } }));
  const optTwo = await apiResponse(cat.qualifications[':id'].options.$post({ param: { id: cSyllabus.id }, json: { code: 'B2', label: 'Papers 1 and 2', unitIds: [cp1, cp2] } }));

  const pUnit = async (code: string, title: string, shortCode: string) => (await apiResponse(cat.units.$post({ json: {
    boardCode: 'pearson_edexcel', code, shortCode, title, unitLevel: 'as', kind: 'unit',
  } }))).id;
  const pu1 = await pUnit(`${T}WMA11`, 'Pure Mathematics 1', 'P1');
  const pu2 = await pUnit(`${T}WMA12`, 'Pure Mathematics 2', 'P2');
  const pAward = await apiResponse(cat.qualifications.$post({ json: {
    boardCode: 'pearson_edexcel', code: `${T}XMA01`, title: `Mathematics ${T}`, level, suite: 'International Advanced Level',
    subjectArea: `Mathematics ${T}`, entryMethod: 'units_cash_in',
  } }));
  await apiResponse(cat.qualifications[':id'].units.$put({ param: { id: pAward.id }, json: { units: [pu1, pu2].map((unitId) => ({ unitId, requirement: 'required' as const })) } }));

  // ─── Subjects families reserve, mapped to what they enter ────────────────
  const sub = async (code: string, name: string, council: 'cambridge' | 'pearson_edexcel') => (await apiResponse(adm.api.v1.subjects.$post({ json: {
    name: `${name} ${T}`, code: `${T}-${code}`, council, courseFee: 1000, registrationFee: 500, isOfferedAtSchool: true, isCore: false, qualificationLevel: level,
  } })))!.id;
  const sc = await sub('BIO', 'Biology', 'cambridge');
  const sp1 = await sub('P1', 'Pure Mathematics 1', 'pearson_edexcel');
  const spx = await sub('MATHS', 'Mathematics', 'pearson_edexcel');
  const map = (subjectId: string, boardCode: 'cambridge' | 'pearson_edexcel', qualificationId: string | null, unitIds: string[]) =>
    apiResponse(cat.registrable[':subjectId'].$put({ param: { subjectId }, json: { boardCode, qualificationId, unitIds } }));
  await map(sc, 'cambridge', cSyllabus.id, []);
  await map(sp1, 'pearson_edexcel', pAward.id, [pu1]);
  await map(spx, 'pearson_edexcel', pAward.id, []);

  // ─── The series, their fee grids, and the session's offers ───────────────
  const now = Date.now();
  const mkSeries = async (boardCode: 'cambridge' | 'pearson_edexcel', month: 'november' | 'january', deadlineDays: number) =>
    (await apiResponse(adm.api.v1['board-series'].$post({ json: {
      boardCode, month, year: seriesYearInAcademicYear(month, Y), label: `exams ${tag}`, entryDeadline: new Date(now + deadlineDays * DAY),
    } }))).id;
  const cambridgeNov = await mkSeries('cambridge', 'november', 5);
  const pearsonJan = await mkSeries('pearson_edexcel', 'january', 6);
  const fee = (seriesId: string, keyKind: 'qualification' | 'unit', keyId: string) =>
    apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId }, json: { rows: [{ keyKind, keyId, amount: 500, provisional: false }] } }));
  await fee(cambridgeNov, 'qualification', cSyllabus.id);
  await fee(pearsonJan, 'unit', pu1);
  await fee(pearsonJan, 'qualification', pAward.id);
  const sessionId = (await apiResponse(adm.api.v1.sessions.$post({ json: {
    type, year: seriesYearInAcademicYear('november', Y), label: `exams ${tag}`,
    startDate: new Date(now - DAY).toISOString(), endDate: new Date(now + 3 * DAY).toISOString(),
    courseStartsOn: cairoDate(new Date(now)), paymentDueAt: new Date(now + 3 * DAY).toISOString(),
  } })))!.id;
  type ItemIn = { label: string; kind: 'whole' | 'unit'; enters: { kind: 'award'; qualificationId: string } | { kind: 'units'; unitIds: string[] }; boardSeriesId: string };
  const offerOf = async (subjectId: string, teachers: string[], item: ItemIn) =>
    (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: sessionId },
      json: { subjectId, courseFee: 1000, teachers: teachers.map((t) => ({ teacherId: t, mode: 'in_school' as const })), items: [{ ...item, availability: 'open' as const, requiredInSeries: false }] },
    })))!.items[0]!;
  const items = {
    sc: await offerOf(sc, [teacherId, teacher2Id], { label: 'Whole subject', kind: 'whole', enters: { kind: 'award', qualificationId: cSyllabus.id }, boardSeriesId: cambridgeNov }),
    sp1: await offerOf(sp1, [teacherId], { label: 'P1', kind: 'unit', enters: { kind: 'units', unitIds: [pu1] }, boardSeriesId: pearsonJan }),
    spx: await offerOf(spx, [teacherId], { label: 'Whole subject', kind: 'whole', enters: { kind: 'award', qualificationId: pAward.id }, boardSeriesId: pearsonJan }),
  };

  // ─── Families, reserved and paid at the desk ─────────────────────────────
  const families: Record<'a' | 'b' | 'c', Family> = {
    a: await onboard(officer, `x-${tag}-a`, 12),
    b: await onboard(officer, `x-${tag}-b`, 12),
    c: await onboard(officer, `x-${tag}-c`, 12),
  };
  /** A reservation at the desk, collected in cash unless `collect` is false: one line per item. */
  const reserve = async (f: Family, lines: Line[], collect = true, inSession = sessionId) => {
    const r = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId: inSession, lines, consent: CONSENT, ...(collect ? { collectNow: { instrumentUsed: 'cash' as const, escrowAmountToApply: 0 } } : {}) },
    }));
    return r.registrations;
  };
  /** A first entry in school (the item's or offer's only teacher unless one is named). */
  const first = (offerItemId: string, teacher?: string): Line => ({ offerItemId, attempt: 'first', mode: 'in_school', ...(teacher ? { teacherId: teacher } : {}) });
  const bySubject = (rs: { subjectId: string; id: string }[]) => Object.fromEntries(rs.map((x) => [x.subjectId, x.id])) as Record<string, string>;
  const regs = {
    a: bySubject(await reserve(families.a, [first(items.sc, teacherId), first(items.sp1)])),
    b: bySubject(await reserve(families.b, [first(items.sc, teacher2Id), first(items.spx)])),
    c: bySubject(await reserve(families.c, [first(items.sp1)])),
  };
  for (const id of [...Object.values(regs.a), ...Object.values(regs.b), ...Object.values(regs.c)]) {
    expect((await one<{ status: string }>(`select status from registration where id = $1`, [id])).status).toBe('confirmed');
  }

  // ─── Who teaches them this year (the forecast grades' teachers) ──────────
  let yearId: string | null = null;
  if (opts.enrol !== false) {
    const years = await apiResponse(coordinator.api.v1.academic.years.$get());
    yearId = years.find((y) => y.startYear === Y)?.id
      ?? (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    await apiResponse(coordinator.api.v1.enrolments.$post({ json: { academicYearId: yearId, studentId: families.a.studentId, subjectId: sc, teacherId } }));
    await apiResponse(coordinator.api.v1.enrolments.$post({ json: { academicYearId: yearId, studentId: families.b.studentId, subjectId: sc, teacherId: teacher2Id } }));
  }

  const close = () => apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: sessionId }, json: { reason: `exams ${tag} suite done` } }));

  return {
    T, Y, adm, coordinator, officer, finadmin, teacher, teacher2, gate, teacherId, teacher2Id, type, level,
    catalogue: { cSyllabus: cSyllabus.id, cp1, cp2, cp3, optAll: optAll.code, optTwo: optTwo.code, pu1, pu2, pAward: pAward.id },
    subjects: { sc, sp1, spx }, items, sessionId, windowId: sessionId, series: { cambridgeNov, pearsonJan }, families, regs, yearId, close,
    reserve, first,
  };
}

export type ExamWorld = Awaited<ReturnType<typeof examWorld>>;

/** YYYY-MM-DD `n` days from today (UTC calendar; the tests only need distinct future days). */
export const dayFromNow = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

// ─── A minimal .xlsx, as a board's broadsheet arrives (stored zip, inline strings) ───

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files: [string, string][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A one-sheet workbook of the rows given (every cell an inline string). */
export function xlsxOf(rows: string[][]): Uint8Array {
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`)
    .join('')}</sheetData></worksheet>`;
  return new Uint8Array(zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Broadsheet" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
  ]));
}
