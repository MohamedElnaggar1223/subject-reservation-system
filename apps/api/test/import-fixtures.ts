/**
 * Synthetic files for the day-one import's scenarios (F7). The school's real
 * sheet never enters the repository or a test: these build workbooks with
 * the same shapes (IMPORT_SPIKE.md) — the tab titles and headers, the
 * unlabeled columns, Excel date serials for the series, phones stored as
 * numbers, trailing and non-breaking spaces, drifting columns — filled with
 * made-up names under @import.test.local.
 *
 * Years are never hard-coded: the live tab is the November of the current
 * academic year (and January after it), the history tab a June three years
 * back, so the suite passes on any day.
 */
import { deflateRawSync } from 'node:zlib';
import { academicYearStartOf } from '@repo/validations';

// ─── A minimal .xlsx writer ──────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const deflated = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, name, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20); central.writeUInt32LE(f.data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + deflated.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : col(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

/** A cell: text (shared string), or a number (as Excel stores phones and date serials). */
export type Cell = string | number | null;

/** An .xlsx workbook from tabs of rows (rows[0] is sheet row 1). Shared strings, as Google Sheets exports. */
export function workbook(tabs: { name: string; rows: Cell[][] }[]): Buffer {
  const shared: string[] = [];
  const index = new Map<string, number>();
  const si = (s: string) => {
    if (!index.has(s)) { index.set(s, shared.length); shared.push(s); }
    return index.get(s)!;
  };
  const sheets = tabs.map((t) => {
    const rows = t.rows.map((r, ri) => {
      const cells = r.map((v, ci) => {
        if (v === null || v === '') return '';
        const ref = `${col(ci)}${ri + 1}`;
        return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${si(v)}</v></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${tabs.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tabs.map((t, i) => `<sheet name="${esc(t.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tabs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${tabs.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
    ...sheets.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml })),
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>` },
  ];
  return zip(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, 'utf8') })));
}

// ─── The school's sheet, in its shapes ───────────────────────────────────────

/** An Excel date serial (days since 1899-12-30), as the form's series column stores it. */
export const serial = (y: number, m: number, d = 1) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);

export const years = () => {
  const now = academicYearStartOf();
  return { now, november: now, january: now + 1, historyJune: now - 3, historyClassYear: now - 4 };
};

export const D = '@import.test.local';
const NBSP = ' ';

/**
 * The live tab: "Nov. <year> Session", the November 2026 tab's columns
 * (Teacher, an unlabeled series column of date serials, the parent's name in
 * the unlabeled column after the student's email, the confirmation, the
 * self-study answer and the fee note in unlabeled columns).
 */
export function liveTabRows() {
  const y = years();
  const NOV = serial(y.november, 11);
  const JAN = serial(y.january, 1);
  const header: Cell[] = ['Student Name ', 'Class & Grade', 'Specification ', 'Subject ', 'Teacher', '', 'Student No.', 'Student Email', '', 'Parent  Email', 'Parent No.', '', '', ''];
  const C = 'I confirm my registration';
  // [name, class, spec, subject, teacher, series, student phone, student email, parent name, parent email, parent phone, confirm, self-study, fee]
  const r = (...cells: Cell[]) => cells;
  const rows: Cell[][] = [
    [`Nov.  ${y.november} Session`],
    header,
    // Row 3–5: a family, phones stored as numbers (IS-09), a name with a non-breaking space and doubled spaces (IS-10).
    r(`Amir  Fahmy${NBSP}`, '11F', 'O.L.', 'Combined Science', 'Ms Salma', NOV, 1011111111, `amir${D}`, 'Hany Fahmy', `hany${D}`, 1022222222, C, 'No', ''),
    r('Amir Fahmy', '11F', 'O.L.', 'Computer Science', 'Mr Karim', NOV, 1011111111, `amir${D}`, 'Hany Fahmy', `hany${D}`, 1022222222, C, 'No', ''),
    r('Amir Fahmy', '11F', 'O.L.', 'Computer Science', 'Mr Karim', NOV, 1011111111, `amir${D}`, 'Hany Fahmy', `hany${D}`, 1022222222, C, 'No', ''), // row 5: duplicate row (IS-13)
    // Row 6–7: a child with two parents (IS-06) — the second parent on the second row.
    r('Bassem Nour', '11G', 'O.L.', 'Combined Science', 'Ms Salma', NOV, '010 3333 3333', `bassem${D}`, 'Rania Nour', `rania${D}`, 1044444444, C, 'No', ''),
    r('Bassem Nour', '11G', 'O.L.', 'Environmental Management', 'Mr Karim', NOV, '010 3333 3333', `bassem${D}`, 'Tarek Nour', `tarek${D}`, 1055555555, C, 'No', ''),
    // Row 8–9: per-paper A-Level rows (IS-01): a unit, and "A.S./A.2." on that single unit; Pearson units.
    r('Dina Samir', '12F', 'A.S.', 'Pure Mathematics 1 (P1)', 'Mr Wael', NOV, 1066666666, `dina${D}`, 'Samir Adel', `samir${D}`, 1077777777, C, 'No', ''),
    r('Dina Samir', '12F', 'A.S./A.2.', 'Mechanics 1 (M1)', 'Mr Wael', NOV, 1066666666, `dina${D}`, 'Samir Adel', `samir${D}`, 1077777777, C, 'No', ''),
    // Row 10: a Biology paper set in the same series and level as P1 (another board: IS-14).
    r('Dina Samir', '12F', 'A.S.', 'Biology (Paper 1 & Paper 2)', 'Ms Mona', NOV, 1066666666, `dina${D}`, 'Samir Adel', `samir${D}`, 1077777777, C, 'No', ''),
    // Row 11: a January row in the November tab (IS-05).
    r('Dina Samir', '12F', 'A.S./A.2.', 'Biology (Paper 3 & Paper 4)', 'Ms Mona', JAN, 1066666666, `dina${D}`, 'Samir Adel', `samir${D}`, 1077777777, C, 'No', ''),
    // Row 12: self-study on a subject the school teaches, a first attempt (IS-03), with its fee note (IS-08).
    r('Eman Hosny', '11H', 'O.L.', 'Environmental Management', '', NOV, 1088888888, `eman${D}`, 'Hosny Ali', `hosny${D}`, 1099999999, C, 'Yes', 'Self Study 50% School Fees'),
    // Row 13: a missing student email (IS-06).
    r('Farid Gaber', '11H', 'O.L.', 'Computer Science', 'Mr Karim', NOV, 1012121212, '', 'Gaber Farid', `gaber${D}`, 1013131313, C, 'No', ''),
    // Row 14–15: two children under one email (IS-06): different first names, different classes.
    r('Hala Mostafa', '11J', 'O.L.', 'Computer Science', 'Mr Karim', NOV, 1014141414, `mostafa.kids${D}`, 'Mostafa Adel', `mostafa${D}`, 1015151515, C, 'No', ''),
    r('Omar Mostafa', '11K', 'O.L.', 'Environmental Management', 'Mr Karim', NOV, 1016161616, `mostafa.kids${D}`, 'Mostafa Adel', `mostafa${D}`, 1015151515, C, 'No', ''),
    // Row 16–17: a duplicate family — the same child under two emails with the same parent (IS-06).
    r('Karim Lotfy', '11J', 'O.L.', 'Computer Science', 'Mr Karim', NOV, 1017171717, `karim.lotfy${D}`, 'Lotfy Hassan', `lotfy${D}`, 1018181818, C, 'No', ''),
    r('Karim Lotfy', '11J', 'O.L.', 'Environmental Management', 'Mr Karim', NOV, 1017171717, `karim.l${D}`, 'Lotfy Hassan', `lotfy${D}`, 1018181818, C, 'No', ''),
    // Row 18: student and parent give the same email (IS-06).
    r('Laila Said', '11K', 'O.L.', 'Computer Science', 'Mr Karim', NOV, 1019191919, `said.family${D}`, 'Said Ahmed', `said.family${D}`, 1020202020, C, 'No', ''),
    // Row 19: an unusable phone (IS-09), no teacher named, a subject the catalogue does not have.
    r('Mona Adly', '11F', 'O.L.', 'French', '', NOV, '12345', `mona${D}`, 'Adly Fawzy', `adly${D}`, 1023232323, C, 'No', ''),
    // Row 20: a class not in the form "11A" (IS-04).
    r('Nader Ezz', 'Eleven', 'O.L.', 'Computer Science', 'Mr Karim', NOV, 1024242424, `nader${D}`, 'Ezz Nader', `ezz${D}`, 1025252525, C, 'No', ''),
    // Row 21: "I will drop the course" (IS-08).
    r('Amir Fahmy', '11F', 'O.L.', 'Environmental Management', 'Mr Karim', NOV, 1011111111, `amir${D}`, 'Hany Fahmy', `hany${D}`, 1022222222, 'I will drop the course', 'No', ''),
  ];
  return rows;
}

/**
 * The history tab: "June <year> Session", the June 2023 tab's columns — a
 * Signature column (staff names, "Carry forward on …"), no Teacher and no
 * series column, and two rows whose confirmation and fee note swapped
 * columns (IS-11).
 */
export function historyTabRows() {
  const y = years();
  const header: Cell[] = ['Student Name ', 'Class & Grade', 'Specification ', 'Subject ', 'Signature ', 'Student No.', 'Student Email', '', 'Parent  Email', 'Parent No.', '', '', ''];
  const C = 'I confirm my registration';
  const r = (...cells: Cell[]) => cells;
  return [
    [`June ${y.historyJune} Session`],
    header,
    // [name, class, spec, subject, signature, student phone, student email, parent name, parent email, parent phone, self-study, confirm, fee]
    r('Rami Kamal', '12H', 'A.2.', 'Sociology', 'Carry forward on June ' + (y.historyJune - 1), 1026262626, `rami${D}`, 'Kamal Rami', `kamal${D}`, 1027272727, 'No', C, ''),
    r('Rami Kamal', '12H', 'A.L.', 'Marine Science', 'Ms Signer', 1026262626, `rami${D}`, 'Kamal Rami', `kamal${D}`, 1027272727, 'No', C, ''),
    // Row 5: drift — the fee note in the confirmation's column and the confirmation in the fee column (IS-11).
    r('Sara Fikry', '12J', 'O.L.', 'Environmental Management', '', 1028282828, `sara${D}`, 'Fikry Sara', `fikry${D}`, 1029292929, 'Yes', 'Self Study 50% School fees', C),
    // Row 6: a past drop with its percentage (IS-08).
    r('Sara Fikry', '12J', 'O.L.', 'Computer Science', '', 1028282828, `sara${D}`, 'Fikry Sara', `fikry${D}`, 1029292929, 'No', C, 'Dropped 20% School fees'),
    // Row 7: a single unit with June's combined code.
    r('Rami Kamal', '12H', 'A.S./A.L.', 'Mechanics 1 (M1)', '', 1026262626, `rami${D}`, 'Kamal Rami', `kamal${D}`, 1027272727, 'No', C, ''),
  ];
}

/** A hand-made per-unit roster (A-04): a class list without emails, which the import leaves alone. */
export function rosterTabRows() {
  const y = years();
  return [[`June ${y.historyJune - 1} Session `], ['', 'Student Name ', 'Class & Grade', 'Specification ', 'Subject '], [1, 'Rami Kamal', '11G', 'A.S.', 'Statistics 1 (S1)']] as Cell[][];
}

export function schoolSheet(): Buffer {
  return workbook([
    { name: '2024', rows: liveTabRows() },
    { name: 'Sheet1', rows: historyTabRows() },
    { name: 'S1', rows: rosterTabRows() },
  ]);
}

// ─── SCL's grade-9 roster and the money record (templates) ───────────────────

export function sclRoster(): string {
  return [
    'student_name,student_email,student_phone,scl_student_id,grade,grade10_section,parent_name,parent_email,parent_phone,second_parent_name,second_parent_email,second_parent_phone',
    `Yara Nabil,yara${D},1030303030,SCL-9001,9,10A,Nabil Yara,nabil${D},01031313131,Heba Nabil,heba${D},01032323232`,
    `Ziad Farouk,ziad${D},,SCL-9002,9,10B,Farouk Ziad,farouk${D},01033333333,,,`,
    `"Wael, Junior",,01034343434,SCL-9003,9,10A,Wael Senior,wael.senior${D},01035353535,,,`,
  ].join('\n') + '\n';
}

export function moneyRecord(): string {
  return [
    'student,date,amount_egp,direction,kind,percent,method,receipt_number,series,subject,note',
    `amir${D},05/10/${years().november},"4,500",in,payment,,cash,R-0001,November ${years().november},Combined Science,`,
    `amir${D},${years().november}-10-20,,out,drop,20,,,November ${years().november},Physics,Dropped 20% School fees`,
    `nobody${D},${years().november}-10-21,100,in,payment,,cash,R-0002,,,`,
  ].join('\n') + '\n';
}
