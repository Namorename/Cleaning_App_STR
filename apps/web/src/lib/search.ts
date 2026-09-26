/**
 * Cyrillic и followed by a combining breve: what the canonical decomposition
 * makes of й. Matched before any lone mark, so й survives as itself.
 */
const DECOMPOSED_SHORT_I = '\u0438\u0306';
const SHORT_I = '\u0439';

/** Combining Diacritical Marks — what NFD splits off a letter. */
const MARK_OR_SHORT_I = new RegExp(`${DECOMPOSED_SHORT_I}|[\\u0300-\\u036f]`, 'g');

/**
 * The text as the search compares it: lower case, with diacritics dropped.
 *
 * A manager on an English or Russian keyboard types "sarka" for Šárka and
 * "vinohradska" for Vinohradská. Both sides go through here, so a query typed
 * with the marks still finds a name stored without them.
 *
 * Decomposing first (NFD) is what makes stored text in either Unicode form
 * compare equal. It also splits two Cyrillic letters: ё becomes е with a
 * diaeresis, and folding it into е is wanted — Russian writes ё as е half the
 * time. й becomes и with a breve, and it is put back: й is a letter of its
 * own, and "мой" must not find "мои".
 */
export function foldForSearch(text: string): string {
  return text
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(MARK_OR_SHORT_I, (match) => (match === DECOMPOSED_SHORT_I ? SHORT_I : ''));
}

/**
 * The one rule the panel's text searches follow.
 *
 * A manager types what she remembers — half a street, a room number, a name
 * off a booking — in whatever order it comes to her. Requiring every word and
 * caring about the order of none is what makes "vinohradska 2109" and
 * "2109 vinohradska" the same search, and what keeps a search working after a
 * label grows a second part: since the cleanings moved onto rooms, a flat is
 * written "CZ - Vinohradska Royal — 1 - 2109", and no single substring of that
 * is what a person would type. Case and diacritics do not count (`foldForSearch`).
 *
 * The registry searched this way first (`matchesTokens`); the rule lives here
 * so the two do not drift apart.
 */
export function matchesAllTokens(haystack: string, query: string): boolean {
  const tokens = foldForSearch(query)
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
  if (tokens.length === 0) {
    return true;
  }

  const target = foldForSearch(haystack);
  return tokens.every((token) => target.includes(token));
}
