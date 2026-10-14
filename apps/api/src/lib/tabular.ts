/**
 * Reading the tables staff bring in (F4: a board's timetable pasted from its
 * PDF or a sheet; a board's results file): CSV or tab-separated text, and the
 * first sheet of an .xlsx workbook.
 *
 * The .xlsx reader is the import spike's (scripts/import-spike/xlsx.ts): an
 * .xlsx file is a zip of XML parts, read with node's zlib — no dependency, so
 * nothing new lands in the lockfile F1 and F7 share. It is hardened for files
 * staff upload: the inflated size of each part is capped (a zip bomb stops at
 * the cap), and so are the number of parts, rows and cells. Cells come back
 * as the text Excel stored: a date is its serial number (`excelSerialDate`).
 */
import { inflateRawSync } from 'node:zlib';

const MAX_PART_BYTES = 40 * 1024 * 1024;
const MAX_PARTS = 2000;
const MAX_ROWS = 20_000;
const MAX_CELLS = 1_000_000;

export class TabularError extends Error {}

function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new TabularError('This is not an .xlsx file (no zip directory found)');
  const entries = buf.readUInt16LE(eocd + 10);
  if (entries > MAX_PARTS) throw new TabularError('This workbook has too many parts to read');
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new TabularError('This .xlsx file is damaged');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (local + 30 > buf.length) throw new TabularError('This .xlsx file is damaged');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + compressed);
    // Only the parts a sheet needs are inflated.
    if (/^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(name)) {
      try {
        files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: MAX_PART_BYTES }));
      } catch {
        throw new TabularError('This .xlsx file is too large or damaged to read');
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const textOf = (xml: string) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!)).join('');
const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** The first sheet of a workbook as rows of cell text (blank rows kept, so row numbers match the sheet). */
export function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  const part = (name: string) => files.get(name)?.toString('utf8') ?? '';
  const shared = [...part('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));
  const rels = new Map([...part('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
    .map((m) => [m[1]!, m[2]!.replace(/^\//, '')]));
  const first = /<sheet [^>]*r:id="([^"]+)"/.exec(part('xl/workbook.xml'));
  if (!first) throw new TabularError('This workbook has no sheet');
  const target = rels.get(first[1]!) ?? '';
  const xml = part(target.startsWith('xl/') ? target : `xl/${target}`);
  const rows: string[][] = [];
  let cellCount = 0;
  for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = [];
    for (const c of (row[2] ?? '').matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (++cellCount > MAX_CELLS) throw new TabularError('This sheet has too many cells to read');
      const attrs = c[1]!;
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1];
      const i = colIndex(ref);
      if (i > 1000) continue;
      cells[i] = type === 's' && v !== undefined ? shared[Number(v)] ?? '' : type === 'inlineStr' ? textOf(c[2] ?? '') : unescapeXml(v ?? '');
    }
    const at = Number(/\br="(\d+)"/.exec(row[1]!)?.[1] ?? rows.length + 1) - 1;
    if (at >= MAX_ROWS) throw new TabularError('This sheet has too many rows to read');
    rows[at] = Array.from(cells, (x) => (x ?? '').trim());
  }
  return Array.from(rows, (r) => r ?? []);
}

/**
 * Text pasted from a sheet or a PDF, or a CSV file: tab-separated when any
 * line has a tab, otherwise comma- or semicolon-separated (whichever the first
 * line uses more), with quoted fields.
 */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = clean.split('\n', 1)[0] ?? '';
  const delim = clean.includes('\t') ? '\t' : (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; continue; }
    if (ch === delim) { row.push(cell.trim()); cell = ''; continue; }
    if (ch === '\n') {
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
      if (rows.length > MAX_ROWS) throw new TabularError('This table has too many rows to read');
      continue;
    }
    cell += ch;
  }
  if (cell.trim() !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

/** An Excel date serial (days since 30 Dec 1899) as YYYY-MM-DD. */
export function excelSerialDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** A table's header row (the `headerRow`-th, 1-based) and the non-blank rows after it, as objects by header. */
export function tableFrom(rows: string[][], headerRow = 1) {
  const header = (rows[headerRow - 1] ?? []).map((h) => h.trim());
  const body = rows.slice(headerRow)
    .map((cells, i) => ({ line: headerRow + i + 1, cells }))
    .filter((r) => r.cells.some((c) => c && c.trim() !== ''));
  const records = body.map((r) => ({
    line: r.line,
    values: Object.fromEntries(header.map((h, i) => [h, (r.cells[i] ?? '').trim()])) as Record<string, string>,
  }));
  return { header: header.filter((h) => h !== ''), records };
}
