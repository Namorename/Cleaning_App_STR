import { SERVER_ERROR_COUNT_PARAMETER, translations } from '@str-ops/shared';

import type * as I18nModule from '../index';
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

/** i18next's plural suffixes: a key ending in one is a form of a counted phrase. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** The phrase a key belongs to: `x_few` is a form of `x`, anything else is itself. */
function phraseOf(path: string): string {
  return path.replace(PLURAL_SUFFIX, '');
}

/** Every phrase of a file once, however many plural forms it has. */
function phrases(dictionary: Dictionary): string[] {
  return [...new Set(keyPaths(dictionary).map(phraseOf))].sort();
}

/** The counted phrases of a file, each with the plural categories it carries. */
function pluralForms(dictionary: Dictionary): Map<string, string[]> {
  const forms = new Map<string, string[]>();
  for (const path of keyPaths(dictionary)) {
    const category = PLURAL_SUFFIX.exec(path)?.[1];
    if (category !== undefined) {
      forms.set(phraseOf(path), [...(forms.get(phraseOf(path)) ?? []), category].sort());
    }
  }
  return forms;
}

/** Every key a phrase can be read from: the phrase itself, or each of its plural forms. */
function formsOf(dictionary: Dictionary, phrase: string): string[] {
  return keyPaths(dictionary).filter((path) => phraseOf(path) === phrase);
}

/**
 * The phrases a number is read into — from live data, or from a limit the
 * manager sets per step — so each must agree with its count in every language:
 * "1 úkol, 2 úkoly, 5 úkolů". A number the phrase only labels ("Items: 3"), or a
 * fixed limit that reads right as it is, stays a plain key.
 */
const COUNTED = [
  'serverErrors.propertyHasOpenTasks',
  'serverErrors.photosMissing',
  'serverErrors.photosTooMany',
  'serverErrors.mediaLimitReached',
  'serverErrors.messagePhotoLimit',
  'serverErrors.videoTooLong',
  'steps.photosHint',
  'panel.apartments.info.bedrooms',
  'panel.apartments.info.guestsUpTo',
];

describe('translation files', () => {
  // A key present in one file and missing in another shows the cleaner an
  // untranslated identifier — the kind of defect that only appears on the one
  // phone set to that language. A counted phrase is compared as one phrase:
  // English has two forms of it, Czech and Russian four.
  test.each(['ru', 'cs'])('%s carries exactly the phrases English does', (language) => {
    expect(phrases(dictionaries[language])).toEqual(phrases(en));
  });

  // i18next picks the form through Intl.PluralRules. A category the file lacks
  // falls through to English on the one phone that needs it; a phrase that is
  // also a plain key is never read in its counted forms.
  test.each(['en', 'ru', 'cs'])(
    '%s gives every counted phrase exactly its own forms',
    (language) => {
      const categories = [
        ...new Intl.PluralRules(language).resolvedOptions().pluralCategories,
      ].sort();
      const paths = keyPaths(dictionaries[language]);
      const wrong = [...pluralForms(dictionaries[language])]
        .filter(([phrase, forms]) => forms.join() !== categories.join() || paths.includes(phrase))
        .map(([phrase]) => phrase);

      expect(wrong).toEqual([]);
    },
  );

  test.each(['en', 'ru', 'cs'])('%s counts every phrase a number is read into', (language) => {
    const counted = [...pluralForms(dictionaries[language]).keys()];

    expect(COUNTED.filter((phrase) => !counted.includes(phrase))).toEqual([]);
  });

  // The server sends its number under its own name ("total", "limit", "min");
  // the apps hand it to i18next as `count` through this table. A counted
  // refusal missing from it would be read as an unknown error.
  test('names the number of every counted refusal the server sends', () => {
    const countedRefusals = [...pluralForms(en).keys()].filter((phrase) =>
      phrase.startsWith('serverErrors.'),
    );

    expect(Object.keys(SERVER_ERROR_COUNT_PARAMETER).sort()).toEqual(countedRefusals.sort());
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
    const cleaningWords = SHARED_BY_EVERY_KIND.flatMap((phrase) =>
      formsOf(dictionaries[language], phrase),
    ).filter((key) => CLEANING_WORD.test(i18n.t(key, { lng: language })));

    expect(cleaningWords).toEqual([]);
  });

  test.each(['en', 'ru', 'cs'])('%s has every one of them', (language) => {
    const missing = SHARED_BY_EVERY_KIND.filter(
      (phrase) => formsOf(dictionaries[language], phrase).length === 0,
    );

    expect(missing).toEqual([]);
  });
});

describe('a number and its noun', () => {
  test.each([
    ['cs', 1, 'má 1 nedokončený úkol'],
    ['cs', 3, 'má 3 nedokončené úkoly'],
    ['cs', 5, 'má 5 nedokončených úkolů'],
    ['ru', 1, 'У объекта 1 незакрытая задача'],
    ['ru', 3, 'У объекта 3 незакрытые задачи'],
    ['ru', 5, 'У объекта 5 незакрытых задач'],
    ['ru', 21, 'У объекта 21 незакрытая задача'],
    ['en', 1, 'still has 1 open task on'],
    ['en', 2, 'still has 2 open tasks on'],
  ])('%s reads %i open tasks as "%s"', (lng, count, expected) => {
    expect(i18n.t('serverErrors.propertyHasOpenTasks', { lng, count, total: count })).toContain(
      expected,
    );
  });

  test.each([
    ['cs', 1, '1 ložnice, až 1 host'],
    ['cs', 2, '2 ložnice, až 4 hosté'],
    ['cs', 5, '5 ložnic, až 10 hostů'],
    ['ru', 1, '1 спальня, до 1 гостя'],
    ['ru', 2, '2 спальни, до 4 гостей'],
    ['ru', 5, '5 спален, до 10 гостей'],
    ['en', 1, '1 bedroom, up to 1 guest'],
    ['en', 2, '2 bedrooms, up to 4 guests'],
  ])('%s reads a listing of %i bedrooms as "%s"', (lng, bedrooms, expected) => {
    const guests = { 1: 1, 2: 4, 5: 10 }[bedrooms] ?? 0;
    const text = i18n.t('panel.apartments.info.sizeValue', {
      lng,
      bedrooms: i18n.t('panel.apartments.info.bedrooms', { lng, count: bedrooms }),
      guests: i18n.t('panel.apartments.info.guestsUpTo', { lng, count: guests }),
    });

    expect(text).toBe(expected);
  });
});

describe('on an engine without Intl.PluralRules', () => {
  // Hermes, the phone's JavaScript engine, may ship without it. i18next then
  // knows only "one" and "other", and a Czech cleaner reads "2 úkolů". The app
  // installs a polyfill before i18next starts, so the forms hold there too.
  test('still reads the Czech "few" form', async () => {
    const native = Intl.PluralRules;
    Reflect.deleteProperty(Intl, 'PluralRules');
    try {
      let fresh: typeof I18nModule | undefined;
      jest.isolateModules(() => {
        fresh = jest.requireActual<typeof I18nModule>('../index');
      });
      if (fresh === undefined) {
        throw new Error('The module was not imported');
      }
      const { i18n: isolated } = fresh;
      if (!isolated.isInitialized) {
        await new Promise((resolve) => isolated.on('initialized', resolve));
      }

      expect(
        isolated.t('serverErrors.propertyHasOpenTasks', { lng: 'cs', count: 2, total: 2 }),
      ).toContain('má 2 nedokončené úkoly');
    } finally {
      Object.defineProperty(Intl, 'PluralRules', {
        value: native,
        configurable: true,
        writable: true,
      });
    }
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
