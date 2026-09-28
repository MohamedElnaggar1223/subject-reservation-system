/**
 * The smallest .xlsx reader the import spike needs: an .xlsx file is a zip of
 * XML parts, so this reads the zip's central directory, inflates the parts
 * with node's zlib, and pulls cell values out of the sheet XML. No formulas,
 * styles or dates — cells come back as the text Excel stored (a date is its
 * serial number). Good enough to profile a Google Form export; a day-one
 * importer would use a maintained library.
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: signature 0x06054b50, within the last 64 KiB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end of central directory)');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + compressed);
    files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const textOf = (xml: string) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join('');
const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Every tab of the workbook as rows of cell text, in workbook order. */
export function readWorkbook(path: string): { name: string; rows: string[][] }[] {
  const files = unzip(readFileSync(path));
  const part = (name: string) => files.get(name)?.toString('utf8') ?? '';
  const shared = [...part('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));
  const rels = new Map([...part('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
    .map((m) => [m[1]!, m[2]!.replace(/^\//, '')]));
  return [...part('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => {
    const target = rels.get(m[2]!)!;
    const xml = part(target.startsWith('xl/') ? target : `xl/${target}`);
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
      const cells: string[] = [];
      for (const c of row[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
        if (!ref) continue;
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1];
        cells[colIndex(ref)] =
          type === 's' && v !== undefined ? shared[Number(v)] ?? '' :
          type === 'inlineStr' ? textOf(c[2] ?? '') :
          unescape(v ?? '');
      }
      return Array.from(cells, (x) => x ?? '');
    });
    return { name: unescape(m[1]!), rows };
  });
}
