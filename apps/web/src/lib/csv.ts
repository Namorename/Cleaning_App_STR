export type CellValue = string | number | null;

/** Excel on Windows reads UTF-8 only when the file announces it. */
const BOM = '﻿';
const NEEDS_QUOTES = /[",\r\n]/;

function csvField(value: CellValue): string {
  if (value === null) {
    return '';
  }
  const text = typeof value === 'number' ? String(value) : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 rows, CRLF-separated, with a byte order mark for spreadsheets. */
export function toCsv(rows: readonly (readonly CellValue[])[]): string {
  return BOM + rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
