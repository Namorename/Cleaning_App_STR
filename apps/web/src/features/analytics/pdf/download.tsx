import { pdf } from '@react-pdf/renderer';

import { downloadFile } from '@/lib/download';

import { loadReportFonts, PUBLIC_FONTS } from './fonts';
import { ReportDocument } from './report-document';
import { readReportInput, type PdfRequest } from './report-input';
import { buildReportModel, reportFileName } from './report-model';

/**
 * The Analytics report as a PDF file, made in the browser: nothing leaves it
 * but the page's own questions to the database, and the file is handed over
 * as a download (woom-analytics_<from>_<to>.pdf).
 */
export async function downloadAnalyticsPdf(request: PdfRequest): Promise<void> {
  await loadReportFonts(PUBLIC_FONTS);
  const input = await readReportInput(request, new Date());
  const blob = await pdf(<ReportDocument model={buildReportModel(input)} />).toBlob();
  downloadFile(reportFileName(request.period), blob);
}
