/**
 * F7: a file as the import reads it — its tabs, each with its title, its
 * header row and its lines, every cell labelled by the header above it
 * (IMPORT_SPIKE.md IS-11: columns are mapped by header, per tab, never by
 * position). A cell under a blank header keeps its column letter, so a value
 * can be read by what it says wherever it sits.
 *
 * Nothing here interprets a value: normalise.ts reads the lines.
 */
import { MONEY_RECORD_TEMPLATE, SCL_ROSTER_TEMPLATE, type ImportKind } from '@repo/validations';
import { readWorkbook, WorkbookError } from '../../lib/xlsx';
import { readCsv } from '../../lib/csv';

export class SourceError extends Error {}

/** A line of the file: where it is, and its cells labelled by their headers. */
export type SourceLine = { tab: string; rowNumber: number; raw: [string, string][] };

export type SourceTabKind = 'session' | 'roster' | 'other';

export type SourceTab = {
  name: string;
  kind: SourceTabKind;
  /** The title above the header ("Nov.  2026 Session"), if any. */
  title: string;
  /** The sheet row the headers are on (1-based). */
  headerRow: number;
  /** The labels, in column order (a blank header is "(column F)"). */
  columns: string[];
  lines: number;
};

export type Source = { tabs: SourceTab[]; lines: SourceLine[] };

const clean = (s: string | undefined) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const letter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : letter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
/** The label a column is known by: its header, or its letter when the header is blank. */
export const columnLabel = (header: string, i: number) => clean(header) || `(column ${letter(i)})`;
export const isUnlabeled = (label: string) => /^\(column [A-Z]+\)$/.test(label);

/** A header row of the school's registration form: it names the student and the subject. */
function findHeader(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const cells = (rows[i] ?? []).map((c) => clean(c).toLowerCase());
    if (cells.includes('student name') && (cells.includes('subject') || cells.includes('student email'))) return i;
  }
  return -1;
}

function tabOf(name: string, rows: string[][]): { tab: SourceTab; lines: SourceLine[] } {
  const h = findHeader(rows);
  if (h < 0) {
    return { tab: { name, kind: 'other', title: clean(rows[0]?.[0]), headerRow: 0, columns: [], lines: 0 }, lines: [] };
  }
  const header = rows[h] ?? [];
  const width = Math.max(header.length, ...rows.slice(h + 1).map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => columnLabel(header[i] ?? '', i));
  const lower = columns.map((c) => c.toLowerCase());
  // A registration tab names the student's email and the subject; the hand-made
  // per-unit rosters (A-04) list names and classes only.
  const kind: SourceTabKind = lower.includes('subject') && lower.includes('student email') ? 'session' : 'roster';
  const title = h > 0 ? clean((rows[0] ?? []).find((c) => clean(c)) ?? '') : '';
  const lines: SourceLine[] = [];
  if (kind === 'session') {
    for (let r = h + 1; r < rows.length; r++) {
      const cells = rows[r] ?? [];
      const raw: [string, string][] = [];
      cells.forEach((v, i) => {
        const text = (v ?? '').replace(/\r\n?/g, '\n');
        if (text.trim()) raw.push([columns[i] ?? columnLabel('', i), text]);
      });
      if (raw.length) lines.push({ tab: name, rowNumber: r + 1, raw });
    }
  }
  return { tab: { name, kind, title, headerRow: h + 1, columns, lines: lines.length }, lines };
}

const norm = (h: string) => clean(h).toLowerCase().replace(/[\s-]+/g, '_');

/** A template CSV (SCL's roster, the money record): its headers must be the template's. */
function templateCsv(name: string, rows: string[][], template: { headers: readonly string[]; required: readonly string[] }): Source {
  const header = (rows[0] ?? []).map(norm);
  const missing = template.required.filter((r) => !header.includes(r));
  if (missing.length) {
    throw new SourceError(`This file does not have the template's columns: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing. Download the template and fill it in.`);
  }
  const columns = header.map((h, i) => (template.headers.includes(h) ? h : columnLabel(rows[0]?.[i] ?? '', i)));
  const lines: SourceLine[] = [];
  for (let r = 1; r < rows.length; r++) {
    const raw: [string, string][] = [];
    (rows[r] ?? []).forEach((v, i) => { if ((v ?? '').trim()) raw.push([columns[i] ?? columnLabel('', i), v]); });
    if (raw.length) lines.push({ tab: name, rowNumber: r + 1, raw });
  }
  return { tabs: [{ name, kind: 'session', title: '', headerRow: 1, columns, lines: lines.length }], lines };
}

/** Read the uploaded file for an import of this kind. */
export function readSource(kind: ImportKind, bytes: Buffer, fileName: string, mimeType: string): Source {
  const isXlsx = mimeType.includes('spreadsheetml') || bytes.subarray(0, 2).toString('latin1') === 'PK';
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'CSV';
  if (kind === 'school_sheet') {
    let tabs: { name: string; rows: string[][] }[];
    if (isXlsx) {
      try {
        tabs = readWorkbook(bytes);
      } catch (err) {
        throw new SourceError(err instanceof WorkbookError ? err.message : 'This workbook could not be read');
      }
    } else {
      tabs = [{ name: baseName, rows: readCsv(bytes.toString('utf8')) }];
    }
    const read = tabs.map((t) => tabOf(t.name, t.rows));
    if (!read.some((t) => t.tab.kind === 'session')) {
      throw new SourceError('No tab of this file looks like the registration sheet: none has the headers "Student Name", "Subject" and "Student Email"');
    }
    return { tabs: read.map((t) => t.tab), lines: read.flatMap((t) => t.lines) };
  }
  if (isXlsx) throw new SourceError('This import takes a CSV file: save the sheet as CSV (comma-separated) and upload that');
  const rows = readCsv(bytes.toString('utf8'));
  return templateCsv(baseName, rows, kind === 'scl_roster' ? SCL_ROSTER_TEMPLATE : MONEY_RECORD_TEMPLATE);
}
