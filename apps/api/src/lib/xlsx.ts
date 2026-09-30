/**
 * Reading an .xlsx workbook (F7's day-one import; first written for the
 * import spike, IMPORT_SPIKE.md, and hardened here).
 *
 * An .xlsx file is a zip of XML parts: this reads the zip's central
 * directory, inflates the parts with node's zlib, and pulls cell values out
 * of the sheet XML. No formulas, styles or dates — cells come back as the
 * text Excel stored (a date is its serial number, a formula its cached
 * value). Rich-text cells are joined. Each row keeps its own row number, so a
 * row number reported to staff is the one their spreadsheet shows.
 *
 * Hardened for files staff upload: every offset is checked against the
 * buffer; only the parts a workbook needs are inflated; a workbook may have
 * at most MAX_ENTRIES parts in its directory and MAX_SHEETS sheets; a part may
 * not inflate beyond MAX_PART_BYTES, and all the parts together beyond
 * MAX_TOTAL_BYTES (a zip bomb, one large part or many, stops there).
 */
import { inflateRawSync } from 'node:zlib';

const MAX_PART_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const MAX_SHEETS = 200;

export class WorkbookError extends Error {}

function unzip(buf: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  const at = (n: number, size: number) => {
    if (n < 0 || n + size > buf.length) throw new WorkbookError('This file is not a readable .xlsx workbook');
  };
  // End of central directory: signature 0x06054b50, within the last 64 KiB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new WorkbookError('This file is not a readable .xlsx workbook');
  const entries = buf.readUInt16LE(eocd + 10);
  if (entries > MAX_ENTRIES) throw new WorkbookError('This workbook has too many parts to read');
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  let total = 0;
  const keep = (name: string, data: Buffer) => {
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new WorkbookError('This workbook is too large to read');
    if (/^xl\/worksheets\//.test(name) && [...files.keys()].filter((k) => k.startsWith('xl/worksheets/')).length >= MAX_SHEETS) {
      throw new WorkbookError('This workbook has too many sheets to read');
    }
    files.set(name, data);
  };
  for (let n = 0; n < entries; n++) {
    at(p, 46);
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new WorkbookError('This file is not a readable .xlsx workbook');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    at(p + 46, nameLen);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    at(local, 30);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    at(dataStart, compressed);
    const raw = buf.subarray(dataStart, dataStart + compressed);
    if (method === 0) keep(name, Buffer.from(raw));
    else if (method === 8) {
      // The part may use what is left of the workbook's budget, never more than one part's cap.
      const left = MAX_TOTAL_BYTES - total;
      if (left < 1) throw new WorkbookError('This workbook is too large to read');
      let data: Buffer;
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.min(MAX_PART_BYTES, left) });
      } catch {
        throw new WorkbookError(left < MAX_PART_BYTES ? 'This workbook is too large to read' : 'This workbook has a part too large or damaged to read');
      }
      keep(name, data);
    } else throw new WorkbookError('This workbook is compressed in a way that cannot be read');
  }
  return files;
}

const unescape = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join('');
const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export type WorkbookTab = { name: string; rows: string[][] };

/** Every tab of the workbook as rows of cell text, in workbook order; rows[i] is sheet row i + 1. */
export function readWorkbook(bytes: Buffer): WorkbookTab[] {
  const files = unzip(bytes, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const part = (name: string) => files.get(name)?.toString('utf8') ?? '';
  const workbook = part('xl/workbook.xml');
  if (!workbook) throw new WorkbookError('This file is not an .xlsx workbook (no workbook part)');
  const shared = [...part('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));
  const rels = new Map([...part('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)]
    .map((m) => [m[1]!, m[2]!.replace(/^\//, '')]));
  // Attribute order varies between writers: read name and r:id separately.
  return [...workbook.matchAll(/<sheet\s([^>]*?)\/?>/g)].map((m) => {
    const attrs = m[1]!;
    const name = unescape(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(attrs)?.[1] ?? '';
    const target = rels.get(rid) ?? '';
    const xml = part(target.startsWith('xl/') ? target : `xl/${target}`);
    const rows: string[][] = [];
    for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells: string[] = [];
      for (const c of (row[2] ?? '').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const cattrs = c[1]!;
        const ref = /\br="([A-Z]+\d+)"/.exec(cattrs)?.[1];
        if (!ref) continue;
        const type = /\bt="([^"]+)"/.exec(cattrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1];
        const idx = colIndex(ref);
        if (idx < 0 || idx > 1000) continue;
        cells[idx] =
          type === 's' && v !== undefined ? shared[Number(v)] ?? '' :
          type === 'inlineStr' ? textOf(c[2] ?? '') :
          unescape(v ?? '');
      }
      const at = Number(/\br="(\d+)"/.exec(row[1]!)?.[1] ?? rows.length + 1) - 1;
      if (at < 0 || at > 100_000) continue;
      rows[at] = Array.from(cells, (x) => x ?? '');
    }
    return { name, rows: Array.from(rows, (r) => r ?? []) };
  });
}
