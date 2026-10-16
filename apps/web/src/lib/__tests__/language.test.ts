import { describe, expect, test } from 'vitest';

import {
  DEFAULT_PANEL_LANGUAGE,
  documentLanguage,
  languageFromCookie,
  PANEL_LANGUAGES,
} from '../language';

/**
 * The owner's decision of 14.10: the product speaks English unless somebody
 * chose otherwise. Czech and Russian stay on offer; the browser's own language
 * (Accept-Language) is never a choice — only the `lang` cookie, which the
 * sign-in fills from the profile, is.
 */
describe('the panel’s language rules', () => {
  test('English is the default', () => {
    expect(DEFAULT_PANEL_LANGUAGE).toBe('en');
  });

  test('a guest without a cookie reads English', () => {
    expect(languageFromCookie(undefined)).toBe('en');
  });

  test.each(['ru', 'cs', 'en'] as const)('a cookie %s is kept', (code) => {
    expect(languageFromCookie(code)).toBe(code);
  });

  test.each(['de', '', 'RU', 'ru-RU'])(
    'a cookie the panel does not speak, %j, reads English',
    (value) => {
      expect(languageFromCookie(value)).toBe('en');
    },
  );

  test('offers English first, then Czech and Russian', () => {
    expect(PANEL_LANGUAGES).toEqual(['en', 'cs', 'ru']);
  });

  test('<html lang> of a page with no language of its own and no cookie is English', () => {
    expect(documentLanguage(null, undefined)).toBe('en');
  });
});
