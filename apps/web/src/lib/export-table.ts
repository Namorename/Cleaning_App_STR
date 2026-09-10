import { toCsv, type CellValue } from './csv';
import { downloadFile } from './download';
import { XLSX_MIME, xlsxBytes } from './xlsx';

/** A table of cells, header row first, handed to the browser as a CSV download. */
export function downloadCsv(fileName: string, rows: CellValue[][]): void {
  downloadFile(fileName, new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
}

/** The same table as a one-sheet workbook. */
export function downloadXlsx(fileName: string, sheetName: string, rows: CellValue[][]): void {
  downloadFile(
    fileName,
    new Blob([new Uint8Array(xlsxBytes(sheetName, rows))], { type: XLSX_MIME }),
  );
}
