// F6: stage a day-one import with a one-paper line, to see the review's entry choice on it (F6a's review:
// "First entry" offered on a line the plan always makes a retake). Placeholders only; no phone numbers.
// Two rows of one child in June 2027: Biology "(One paper ONLY)" (staff then choose Paper 4 only), and
// Biology as a whole subject (the entry choice must stay there). Staged, never committed.
import { deflateRawSync } from 'node:zlib';
import { API, ORIGIN } from './api.mjs';

const JUNE = '6d34f4aa-11fc-45a8-b04b-55e04a25b3a9';

// ── A minimal .xlsx writer (apps/api/test/import-fixtures.ts, copied) ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'); const deflated = deflateRawSync(f.data); const crc = crc32(f.data);
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
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function workbook(tabs) {
  const shared = []; const index = new Map();
  const si = (s) => { if (!index.has(s)) { index.set(s, shared.length); shared.push(s); } return index.get(s); };
  const sheets = tabs.map((t) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${t.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    if (v === null || v === '') return '';
    const ref = `${col(ci)}${ri + 1}`;
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${si(v)}</v></c>`;
  }).join('')}</row>`).join('')}</sheetData></worksheet>`);
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

// ── Sign in as the admin; call the API with the cookie ──
const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email: 'admin@igcse.local', password: 'AdminPass1' }) });
if (r.status !== 200) throw new Error('sign-in ' + r.status);
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 600)}`);
  return JSON.parse(text).data;
};

const header = ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', '', ''];
const row = (subject, note) => ['Import Child', '11A', 'O.L.', subject, 'Teacher A', '', 'import.child@example.com', 'Import Parent', 'import.parent@example.com', '', 'I confirm my registration', 'No', note];
const bytes = workbook([{ name: 'June 2027', rows: [['June 2027 Session'], header,
  row('Biology', 'Retake in School 100% fees (One paper ONLY) From June 2026'),
  row('Biology', ''),
] }]);

const form = new FormData();
form.append('file', new File([bytes], 'one-paper-review.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
form.append('purpose', 'import_file');
const up = await fetch(`${API}/v1/files/upload`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: cookie }, body: form });
const upJson = await up.json();
if (!up.ok) throw new Error('upload ' + up.status + ' ' + JSON.stringify(upJson).slice(0, 300));
const id = (await call('POST', '/v1/imports', { fileId: upJson.data.id, kind: 'school_sheet' })).id;
let v = await call('GET', `/v1/imports/${id}`);
const keys = Object.keys(v.settings.series);
console.log('import', id, 'series keys', keys);
await call('PUT', `/v1/imports/${id}/settings`, { series: Object.fromEntries(keys.map((k) => [k, { mode: 'window', sessionId: JUNE }])), enrol: false, createSections: false });
v = await call('GET', `/v1/imports/${id}`);
const items = v.mapping.sessionItems[JUNE] ?? [];
const paper4 = items.find((it) => it.subjectName === 'Biology' && it.label === 'Paper 4 only (retake)');
for (const x of v.rows) console.log('row', x.rowNumber, x.id, 'lines', JSON.stringify(x.plan.lines.map((l) => [l.itemLabel, l.attempt])), 'problems', x.problems.map((p) => p.code).join(','));
const onePaperRow = v.rows.find((x) => x.rowNumber === 3);
if (onePaperRow && !onePaperRow.plan.lines.length && paper4) {
  await call('PUT', `/v1/imports/${id}/rows`, { rowIds: [onePaperRow.id], edits: { offerItemId: paper4.id } });
  v = await call('GET', `/v1/imports/${id}`);
  const again = v.rows.find((x) => x.rowNumber === 3);
  console.log('row 3 after choosing Paper 4 only:', JSON.stringify(again.plan.lines.map((l) => [l.itemLabel, l.attempt, l.priorSitting?.month, l.priorSitting?.year])));
}
console.log('review at', `/imports/${id}`);
