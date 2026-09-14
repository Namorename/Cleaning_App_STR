/**
 * The one rule the panel's text searches follow.
 *
 * A manager types what she remembers — half a street, a room number, a name
 * off a booking — in whatever order it comes to her. Requiring every word and
 * caring about the order of none is what makes "vinohradska 2109" and
 * "2109 vinohradska" the same search, and what keeps a search working after a
 * label grows a second part: since the cleanings moved onto rooms, a flat is
 * written "CZ - Vinohradska Royal — 1 - 2109", and no single substring of that
 * is what a person would type.
 *
 * The registry searched this way first (`matchesTokens`); the rule lives here
 * so the two do not drift apart.
 */
export function matchesAllTokens(haystack: string, query: string): boolean {
  const tokens = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '');
  if (tokens.length === 0) {
    return true;
  }

  const target = haystack.toLocaleLowerCase();
  return tokens.every((token) => target.includes(token));
}
