import { translations } from '@str-ops/shared';

import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES, i18n, resolveLanguage } from '../index';

const { cs, en, ru } = translations;

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

describe('words shared by every kind of job', () => {
  // These are read on a cleaning, a mid-stay cleaning, an inspection and a
  // repair alike — the server's refusals above all, which know nothing of the
  // kind. Calling a boiler repair "the cleaning" is how a technician learns
  // the app was not written for him.
  const SHARED_BY_EVERY_KIND = [
    'tabs.myTasks',
    'tasks.loading',
    'tasks.loadFailed',
    'tasks.emptyMine',
    'tasks.startFailed',
    'tasks.finishFailed',
    'tasks.detail.parallel',
    'tasks.work.start',
    'tasks.work.finish',
    'tasks.work.window',
    'tasks.work.finished',
    'tasks.work.colleague',
    'tasks.work.steps',
    'tasks.kinds.maintenance',
    'steps.readOnly',
    'steps.commentPlaceholder',
    'steps.types.photos_before',
    'steps.types.photos_after',
    'serverErrors.parallelStartOff',
    'serverErrors.startTooEarly',
    'serverErrors.stepNotFound',
    'serverErrors.propertyHasOpenTasks',
  ];

  /** "Cleaning" in each language, in the forms these sentences would use. */
  const CLEANING_WORD = /уборк|уборок|úklid|clean/i;

  test.each(['en', 'ru', 'cs'])('%s does not call them cleanings', (language) => {
    const cleaningWords = SHARED_BY_EVERY_KIND.filter((key) =>
      CLEANING_WORD.test(i18n.t(key, { lng: language })),
    );

    expect(cleaningWords).toEqual([]);
  });

  test.each(['en', 'ru', 'cs'])('%s has every one of them', (language) => {
    const missing = SHARED_BY_EVERY_KIND.filter(
      (key) => !i18n.exists(key, { lng: language, fallbackLng: false }),
    );

    expect(missing).toEqual([]);
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
