/**
 * Reading a CSV file (F7: SCL's roster, the money record, or one tab of the
 * school's sheet saved as CSV). RFC 4180: quoted fields may hold the
 * delimiter, quotes ("") and line breaks. A byte-order mark is dropped. The
 * delimiter is the one the header line uses most: a comma, a semicolon (Excel
 * in Arabic and European locales) or a tab.
 */
export function readCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delimiter = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
      continue;
    }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Writing CSV is the web's (apps/web/lib/csv.ts, with its formula-injection guard) and the
// report routes'; this module only reads.
