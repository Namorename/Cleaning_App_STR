import { describe, expect, test } from 'vitest';

import { i18n } from '@/lib/i18n';

import { sizeText } from '../size-text';

describe('sizeText', () => {
  // Each number agrees with its own noun, so the line is two counted phrases
  // and not one sentence with two numbers in it.
  test.each([
    ['ru', 1, 2, '1 спальня, до 2 гостей'],
    ['ru', 3, 6, '3 спальни, до 6 гостей'],
    ['ru', 5, 21, '5 спален, до 21 гостя'],
    ['cs', 1, 2, '1 ložnice, až 2 hosté'],
    ['cs', 5, 12, '5 ložnic, až 12 hostů'],
    ['en', 1, 1, '1 bedroom, up to 1 guest'],
    ['en', 2, 4, '2 bedrooms, up to 4 guests'],
  ])('%s reads %i bedrooms and %i guests as "%s"', (language, bedrooms, guests, expected) => {
    expect(sizeText(i18n.getFixedT(language), bedrooms, guests)).toBe(expected);
  });

  test('counts a size Hostaway left out as none', () => {
    expect(sizeText(i18n.getFixedT('ru'), null, null)).toBe('0 спален, до 0 гостей');
  });
});
