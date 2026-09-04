import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES, i18n, resolveLanguage } from '../index';
import cs from '../locales/cs.json';
import en from '../locales/en.json';
import ru from '../locales/ru.json';

type Dictionary = { [key: string]: string | Dictionary };

/** Every leaf key, as a dotted path, so a missing nested key is visible. */
function keyPaths(dictionary: Dictionary, prefix = ''): string[] {
  return Object.entries(dictionary).flatMap(([key, value]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return typeof value === 'string' ? [path] : keyPaths(value, path);
  });
}

const dictionaries: Record<string, Dictionary> = { en, ru, cs };

describe('translation files', () => {
  // A key present in one file and missing in another shows the cleaner an
  // untranslated identifier — the kind of defect that only appears on the one
  // phone set to that language.
  test.each(['ru', 'cs'])('%s carries exactly the keys English does', (language) => {
    expect(keyPaths(dictionaries[language]).sort()).toEqual(keyPaths(en).sort());
  });

  test.each(['en', 'ru', 'cs'])('%s leaves no string empty', (language) => {
    const empty = keyPaths(dictionaries[language]).filter(
      (path) => i18n.t(path, { lng: language }).trim() === '',
    );

    expect(empty).toEqual([]);
  });

  test('there is a file for every language the app claims to support', () => {
    expect(Object.keys(dictionaries).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });
});

describe('resolveLanguage', () => {
  test('takes the first preference the app can actually speak', () => {
    expect(resolveLanguage(['cs', 'en'])).toBe('cs');
  });

  test('skips a language with no translation file', () => {
    // Arrange: a phone set to Slovak with Czech second.
    const preferences = ['sk', 'cs', 'en'];

    // Act & Assert: Czech serves this person far better than the fallback.
    expect(resolveLanguage(preferences)).toBe('cs');
  });

  test('reads a regional tag as its base language', () => {
    expect(resolveLanguage(['ru-BY'])).toBe('ru');
  });

  test('falls back when nothing matches', () => {
    expect(resolveLanguage(['ja', 'ko'])).toBe(FALLBACK_LANGUAGE);
  });

  test('survives a device that reports no language at all', () => {
    expect(resolveLanguage([null, undefined])).toBe(FALLBACK_LANGUAGE);
  });
});
