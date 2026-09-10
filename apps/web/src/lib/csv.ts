export type CellValue = string | number | null;

/** Excel on Windows reads UTF-8 only when the file announces it. */
const BOM = '﻿';
const NEEDS_QUOTES = /[",\r\n]/;
/** A cell starting with one of these is a formula to a spreadsheet, whatever it says. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Text a spreadsheet will show as text.
 *
 * Item names come from the field, so "=HYPERLINK(...)" or "@SUM(...)" is a
 * line a cleaner could type. A leading apostrophe makes Excel, LibreOffice
 * and Google Sheets keep the cell literal; both exports go through here.
 */
export function safeCellText(text: string): string {
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

function csvField(value: CellValue): string {
  if (value === null) {
    return '';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const text = safeCellText(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 rows, CRLF-separated, with a byte order mark for spreadsheets. */
export function toCsv(rows: readonly (readonly CellValue[])[]): string {
  return BOM + rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
