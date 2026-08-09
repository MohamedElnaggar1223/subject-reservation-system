/**
 * CSV helpers for client-side exports.
 *
 * Mirrors the server-side guard in apps/api/src/routes/report.routes.ts:
 * spreadsheet apps execute cells that begin with = + - @ (or control
 * characters) as formulas, so any user-authored value — subject names
 * and codes come from an admin-editable, CSV-importable list — must be
 * neutralised before it lands in a file someone reopens in Excel.
 */

/** Escape one cell: neutralise formulas, then quote if needed. */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);

  // Formula injection guard — prefix with a single quote so Excel/Sheets
  // treat the cell as text.
  const neutralised = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;

  // Quote when the value contains a delimiter, quote, or newline.
  if (/[",\n\r]/.test(neutralised)) {
    return `"${neutralised.replace(/"/g, '""')}"`;
  }
  return neutralised;
}

/** Build a CSV document from a header row and data rows. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens UTF-8 (Arabic subject names) correctly
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
