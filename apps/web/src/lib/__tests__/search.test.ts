import { describe, expect, test } from 'vitest';

import { matchesAllTokens } from '../search';

describe('matchesAllTokens', () => {
  test('every word has to be found, in any order', () => {
    expect(matchesAllTokens('CZ - Vinohradska Royal — 1 - 2109', 'vinohradska 2109')).toBe(true);
    expect(matchesAllTokens('CZ - Vinohradska Royal — 1 - 2109', '2109 vinohradska')).toBe(true);
    expect(matchesAllTokens('CZ - Vinohradska Royal — 1 - 2109', 'vinohradska karlin')).toBe(
      false,
    );
  });

  test('an empty search keeps everything', () => {
    expect(matchesAllTokens('Anglicka 7', '   ')).toBe(true);
  });

  // A manager on an English or Russian keyboard types a Czech name without
  // its marks. Listings and people are written with them.
  test('a search typed without diacritics finds the Czech spelling', () => {
    expect(matchesAllTokens('Šárka Nováková', 'sarka')).toBe(true);
    expect(matchesAllTokens('CZ - Vinohradská Royal', 'vinohradska')).toBe(true);
    expect(matchesAllTokens('Řehořova 5', 'rehorova 5')).toBe(true);
  });

  test('a search typed with them finds the plain spelling too', () => {
    expect(matchesAllTokens('CZ - Vinohradska Royal', 'Vinohradská')).toBe(true);
    expect(matchesAllTokens('Sarka Novakova', 'ŠÁRKA')).toBe(true);
  });

  test('Cyrillic is searched as before, ignoring case', () => {
    expect(matchesAllTokens('Течёт кран на кухне', 'КРАН')).toBe(true);
    expect(matchesAllTokens('Течёт кран на кухне', 'балкон')).toBe(false);
  });

  // Russian writes ё as е half the time; either spelling finds the other.
  test('ё and е are one letter to the search, both ways', () => {
    expect(matchesAllTokens('Ёлка в холле', 'елка')).toBe(true);
    expect(matchesAllTokens('Елка в холле', 'ёлка')).toBe(true);
  });

  // Unicode spells й as и with a breve, and stripping marks would quietly
  // turn "мой" into "мои". It is a letter of its own, and stays one.
  test('й is not и', () => {
    expect(matchesAllTokens('Мои ключи', 'мой')).toBe(false);
    expect(matchesAllTokens('Мой ключ', 'мои')).toBe(false);
    expect(matchesAllTokens('Мой ключ', 'МОЙ')).toBe(true);
  });

  test('text stored decomposed matches text typed composed, and the other way', () => {
    expect(matchesAllTokens('Šárka'.normalize('NFD'), 'šárka')).toBe(true);
    expect(matchesAllTokens('Šárka', 'šárka'.normalize('NFD'))).toBe(true);
    expect(matchesAllTokens('Мой ключ'.normalize('NFD'), 'мой')).toBe(true);
    expect(matchesAllTokens('Мой ключ'.normalize('NFD'), 'мои')).toBe(false);
  });
});
