import { Font } from '@react-pdf/renderer';

import { splitLongWord } from './report-model';

/** The panel's own typeface (FONT in the shared tokens). */
export const REPORT_FONT = 'Nunito';

/** The three weights the report is written in: text 600, labels 700, figures and titles 800. */
export interface FontSources {
  regular: string;
  bold: string;
  heavy: string;
}

/**
 * The fonts as the browser fetches them, only when a report is made: static
 * TTF files of Nunito (SIL Open Font License, public/fonts/nunito/OFL.txt),
 * with the Czech letters and Cyrillic. The PDF embeds the letters it uses.
 */
export const PUBLIC_FONTS: FontSources = {
  regular: '/fonts/nunito/Nunito-SemiBold.ttf',
  bold: '/fonts/nunito/Nunito-Bold.ttf',
  heavy: '/fonts/nunito/Nunito-ExtraBold.ttf',
};

let registered: string | null = null;

/** Tells the renderer where the fonts are, once per set of sources. */
export function registerReportFonts(sources: FontSources): void {
  const key = JSON.stringify(sources);
  if (registered === key) {
    return;
  }
  Font.register({
    family: REPORT_FONT,
    fonts: [
      { src: sources.regular, fontWeight: 600 },
      { src: sources.bold, fontWeight: 700 },
      { src: sources.heavy, fontWeight: 800 },
    ],
  });
  // No dictionary hyphenation: a word breaks only when it cannot fit a line.
  Font.registerHyphenationCallback(splitLongWord);
  registered = key;
}

/** How the fonts are asked for: the browser's fetch, or a test's. */
export type FontFetch = (url: string) => Promise<{ ok: boolean }>;

/**
 * The fonts for a report made in the browser. Each file is fetched first and
 * registered only when all three came: the renderer keeps a failed font load
 * for good, so registering before a network blip would fail every later press
 * until the page is reloaded. The browser's cache serves the renderer's own
 * fetch afterwards.
 */
export async function loadReportFonts(
  sources: FontSources,
  fetcher: FontFetch = (url) => fetch(url),
): Promise<void> {
  if (registered === JSON.stringify(sources)) {
    return;
  }
  const answers = await Promise.all([sources.regular, sources.bold, sources.heavy].map((url) => fetcher(url)));
  if (answers.some((answer) => !answer.ok)) {
    throw new Error('The report fonts could not be loaded');
  }
  registerReportFonts(sources);
}
