// @vitest-environment node
import { fileURLToPath } from 'node:url';

import { renderToBuffer } from '@react-pdf/renderer';
import { beforeAll, describe, expect, test } from 'vitest';

import { NO_FILTERS } from '../../schema';
import { registerReportFonts, type FontSources } from '../fonts';
import { ReportDocument } from '../report-document';
import { buildReportModel } from '../report-model';
import { EMPTY, listingRow, reportInput } from './fixtures';

/** The fonts the browser fetches from /fonts, read here from the files themselves. */
const LOCAL_FONTS: FontSources = {
  regular: fileURLToPath(new URL('../../../../../public/fonts/nunito/Nunito-SemiBold.ttf', import.meta.url)),
  bold: fileURLToPath(new URL('../../../../../public/fonts/nunito/Nunito-Bold.ttf', import.meta.url)),
  heavy: fileURLToPath(new URL('../../../../../public/fonts/nunito/Nunito-ExtraBold.ttf', import.meta.url)),
};

/** Rendering a document takes a moment: the fonts are read and laid out. */
const RENDER_MS = 60_000;

async function render(input: ReturnType<typeof reportInput>): Promise<Buffer> {
  return renderToBuffer(<ReportDocument model={buildReportModel(input)} />);
}

/** The page objects of a PDF: "/Type /Page", not "/Type /Pages". */
function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
}

beforeAll(() => {
  registerReportFonts(LOCAL_FONTS);
});

describe('the report as a PDF', () => {
  test(
    'a file that is a PDF, its font inside it, of a reasonable size',
    async () => {
      const pdf = await render(reportInput('en'));
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pdf.toString('latin1')).toContain('/FontFile2');
      expect(pdf.toString('latin1')).toContain('Nunito');
      expect(pdf.length).toBeLessThan(400_000);
      expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
    },
    RENDER_MS,
  );

  test(
    'an empty period is a single page',
    async () => {
      const pdf = await render(reportInput('en', { summary: EMPTY, previousSummary: EMPTY }));
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pageCount(pdf)).toBe(1);
    },
    RENDER_MS,
  );

  test(
    'a long table runs on over the next pages',
    async () => {
      const short = await render(reportInput('en'));
      const rows = Array.from({ length: 160 }, (_, at) =>
        listingRow(at + 1, `Riverside apartment number ${at + 1} with a garden and a very long name`),
      );
      const long = await render(
        reportInput('en', {
          tables: { ...reportInput('en').tables, cleaningsByProperty: rows },
        }),
      );
      expect(pageCount(long)).toBeGreaterThan(pageCount(short) + 2);
    },
    RENDER_MS,
  );

  test(
    'a bar list longer than a page runs on over the pages instead of being cut',
    async () => {
      const rows = Array.from({ length: 70 }, (_, at) => listingRow(100 + at, `Flat ${at + 1}`, 1));
      const tables = { ...reportInput('en').tables, cleaningsByProperty: rows };
      const plain = await render(reportInput('en', { tables }));
      const picked = await render(
        reportInput('en', { tables, filters: { ...NO_FILTERS, propertyIds: rows.map((row) => row.listing_id) } }),
      );
      // Seventy bars are some three pages of their own.
      expect(pageCount(picked)).toBeGreaterThanOrEqual(pageCount(plain) + 2);
    },
    RENDER_MS,
  );

  test.each(['en', 'cs', 'ru'] as const)(
    'it is made in %s',
    async (language) => {
      const pdf = await render(reportInput(language));
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
    },
    RENDER_MS,
  );
});
