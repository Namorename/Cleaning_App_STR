/**
 * The letters the report's font draws, and a text made to fit them. Nunito
 * (public/fonts/nunito) has Latin with the Czech letters and Cyrillic, but no
 * emoji, arrows, stars or hearts: the renderer draws a letter its font has not
 * as a blank, so a listing called «Flat ★ Old Town 🏠» would come out with
 * gaps. The PDF leaves such letters out instead (owner, 2026-10-16).
 */

/**
 * The code points the font maps, as [first, last] runs: the same in the three
 * weights, read from the files by fontkit, the renderer's own font reader.
 * font-coverage.test.ts holds the table to the files.
 */
export const REPORT_FONT_RANGES: readonly (readonly [number, number])[] = [
  [0x0, 0x0], [0xd, 0xd], [0x20, 0x7e], [0xa0, 0x132], [0x134, 0x17e],
  [0x181, 0x181], [0x18a, 0x18a], [0x18f, 0x18f], [0x192, 0x192], [0x1a0, 0x1a1],
  [0x1af, 0x1b0], [0x1b3, 0x1b4], [0x1c4, 0x1ce], [0x1d4, 0x1d4], [0x1e5, 0x1e7],
  [0x1e9, 0x1eb], [0x1ef, 0x1ef], [0x1fa, 0x21b], [0x21f, 0x21f], [0x226, 0x228],
  [0x22a, 0x22d], [0x230, 0x233], [0x237, 0x237], [0x253, 0x253], [0x257, 0x257],
  [0x259, 0x259], [0x292, 0x292], [0x2b9, 0x2bc], [0x2be, 0x2bf], [0x2c6, 0x2cc],
  [0x2d8, 0x2dd], [0x300, 0x304], [0x306, 0x30c], [0x30f, 0x30f], [0x311, 0x312],
  [0x31b, 0x31b], [0x323, 0x324], [0x326, 0x328], [0x32e, 0x32e], [0x331, 0x331],
  [0x335, 0x335], [0x337, 0x338], [0x394, 0x394], [0x3a3, 0x3a3], [0x3a9, 0x3a9],
  [0x3bc, 0x3bc], [0x3c0, 0x3c0], [0x400, 0x45f], [0x462, 0x463], [0x46a, 0x46b],
  [0x472, 0x475], [0x48a, 0x4a5], [0x4a8, 0x4ff], [0x510, 0x513], [0x51a, 0x51d],
  [0x524, 0x529], [0x52e, 0x52f], [0x1e08, 0x1e09], [0x1e0c, 0x1e0f], [0x1e14, 0x1e17],
  [0x1e1c, 0x1e1d], [0x1e20, 0x1e21], [0x1e24, 0x1e25], [0x1e2a, 0x1e2b], [0x1e2e, 0x1e2f],
  [0x1e36, 0x1e37], [0x1e3a, 0x1e3b], [0x1e42, 0x1e49], [0x1e4c, 0x1e53], [0x1e5a, 0x1e5b],
  [0x1e5e, 0x1e69], [0x1e6c, 0x1e6f], [0x1e78, 0x1e7b], [0x1e80, 0x1e85], [0x1e8e, 0x1e8f],
  [0x1e92, 0x1e93], [0x1e97, 0x1e97], [0x1e9e, 0x1e9e], [0x1ea0, 0x1ef9], [0x2007, 0x200b],
  [0x2010, 0x2010], [0x2012, 0x2015], [0x2018, 0x201a], [0x201c, 0x201e], [0x2020, 0x2022],
  [0x2026, 0x2026], [0x2030, 0x2030], [0x2032, 0x2033], [0x2039, 0x203a], [0x2044, 0x2044],
  [0x2052, 0x2052], [0x2070, 0x2070], [0x2074, 0x2079], [0x2080, 0x2089], [0x20a1, 0x20a1],
  [0x20a3, 0x20a4], [0x20a6, 0x20a7], [0x20a9, 0x20a9], [0x20ab, 0x20ae], [0x20b1, 0x20b2],
  [0x20b4, 0x20b5], [0x20b8, 0x20ba], [0x20bc, 0x20bd], [0x2113, 0x2113], [0x2116, 0x2116],
  [0x2122, 0x2122], [0x2126, 0x2126], [0x212e, 0x212e], [0x2202, 0x2202], [0x2205, 0x2206],
  [0x220f, 0x220f], [0x2211, 0x2212], [0x2215, 0x2215], [0x2219, 0x221a], [0x221e, 0x221e],
  [0x222b, 0x222b], [0x2248, 0x2248], [0x2260, 0x2260], [0x2264, 0x2265], [0x25ca, 0x25ca],
  [0x27e8, 0x27e9], [0xf8ff, 0xf8ff], [0xfb01, 0xfb02], [0xffff, 0xffff],
];

/** Where the narrow no-break space (Intl's, before «PM») is, the font has only the wide one. */
const NARROW_NO_BREAK_SPACE = 0x202f;
const NO_BREAK_SPACE = '\u00a0';
/** What a text of nothing but left-out letters becomes: never an empty cell. */
const NOTHING_LEFT = '—';

/** Whether the font draws this code point: a binary search of the runs. */
export function isInReportFont(codePoint: number): boolean {
  let low = 0;
  let high = REPORT_FONT_RANGES.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [first, last] = REPORT_FONT_RANGES[middle];
    if (codePoint < first) {
      high = middle - 1;
    } else if (codePoint > last) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

/** Printable ASCII: all of it is in the font, so most cells need no look at all. */
const PLAIN_ASCII = /^[ -~]*$/;
const BYTE_ORDER_MARK = 0xfeff;

/** A C0 or C1 control: a stray carriage return or tab in a name from a booking site. */
function isControl(point: number): boolean {
  return point < 0x20 || (point >= 0x7f && point < 0xa0);
}

/** The letter in parts, when the font has every part but not the whole (g + acute). */
function inParts(letter: string): string | null {
  const parts = letter.normalize('NFD');
  return parts !== letter && [...parts].every((part) => isInReportFont(part.codePointAt(0) ?? 0))
    ? parts
    : null;
}

/**
 * The text as the font can draw it. A letter written as a base and a mark is
 * joined first (NFC), so «r» + caron is the «ř» the font has — and a letter
 * the font has only in parts stays in parts; a space the font has not, or a
 * control character, becomes a space it has; any other letter outside the
 * font — an emoji with its joiners and selectors, a flag, an arrow, a byte
 * order mark — is left out, and the spaces it stood between are closed.
 */
export function fitToFont(text: string): string {
  if (PLAIN_ASCII.test(text)) {
    return text;
  }
  let fitted = '';
  let isChanged = false;
  for (const letter of text.normalize('NFC')) {
    const point = letter.codePointAt(0) ?? 0;
    if (isControl(point)) {
      fitted += ' ';
      isChanged = true;
      continue;
    }
    if (isInReportFont(point)) {
      fitted += letter;
      continue;
    }
    const parts = inParts(letter);
    if (parts !== null) {
      fitted += parts;
    } else if (point === NARROW_NO_BREAK_SPACE) {
      fitted += NO_BREAK_SPACE;
    } else if (point !== BYTE_ORDER_MARK && /\s/u.test(letter)) {
      fitted += ' ';
    } else {
      isChanged = true;
    }
  }
  if (!isChanged) {
    return fitted;
  }
  const closed = fitted.replace(/ {2,}/g, ' ').trim();
  return closed === '' ? NOTHING_LEFT : closed;
}
