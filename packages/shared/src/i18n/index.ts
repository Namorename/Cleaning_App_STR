import cs from './locales/cs.json';
import en from './locales/en.json';
import ru from './locales/ru.json';

/**
 * The languages both apps ship translation files for.
 *
 * Kept in step with the `public.app_language` enum in the database, which the
 * server side uses to pick a language for push notifications in F11. A code
 * with no file behind it would show up as untranslated keys.
 */
export const SUPPORTED_LANGUAGES = ['en', 'ru', 'cs'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Used when a device asks for a language the apps do not speak.
 *
 * English rather than Russian: the keys are written in English, so an
 * untranslated string degrades into something the next developer can place.
 */
export const FALLBACK_LANGUAGE: Language = 'en';

/**
 * Locale tags for `Intl`, which wants a region and not just a language.
 *
 * Dates and times follow the chosen language, not the device: a cleaner who
 * set the app to Czech should not be reading Russian month names.
 */
export const INTL_LOCALES: Record<Language, string> = {
  en: 'en-GB',
  ru: 'ru-RU',
  cs: 'cs-CZ',
};

export function isSupportedLanguage(code: string): code is Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

/**
 * Pick a language from an ordered list of preferences.
 *
 * Ordered, not just the first: someone whose phone is set to Slovak with
 * Czech second is better served in Czech than in the fallback.
 */
export function resolveLanguage(preferences: readonly (string | null | undefined)[]): Language {
  for (const preference of preferences) {
    const code = preference?.split('-')[0].toLowerCase();
    if (code !== undefined && isSupportedLanguage(code)) {
      return code;
    }
  }

  return FALLBACK_LANGUAGE;
}

export type TranslationDictionary = typeof en;

/** One dictionary per language, in the shape i18next's `resources` expects. */
export const translationResources: Record<Language, { translation: TranslationDictionary }> = {
  en: { translation: en },
  ru: { translation: ru },
  cs: { translation: cs },
};

export const translations: Record<Language, TranslationDictionary> = { en, ru, cs };

/**
 * The parameter whose number picks the plural form of a counted refusal.
 *
 * The server names its number after what it counts — "total", "limit", "min"
 * — and i18next picks a plural form from `count` alone. Every `serverErrors.`
 * key with plural forms is listed here; the phone's i18n test holds the two
 * together, because a counted key read without its count is not found at all.
 */
export const SERVER_ERROR_COUNT_PARAMETER: Readonly<Record<string, string>> = {
  'serverErrors.propertyHasOpenTasks': 'total',
  'serverErrors.photosMissing': 'min',
  'serverErrors.photosTooMany': 'limit',
  'serverErrors.mediaLimitReached': 'limit',
  'serverErrors.messagePhotoLimit': 'limit',
  'serverErrors.videoTooLong': 'limit',
};

/**
 * A refusal's parameters as i18next should read them: a counted refusal also
 * carries its number as `count`. When the server left the number out, nothing
 * is made up — the key is then not found, and the reader gets the general
 * sentence with the server's own words under it.
 */
export function serverErrorOptions(
  key: string,
  parameters: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const name = SERVER_ERROR_COUNT_PARAMETER[key];
  const count = name === undefined ? undefined : parameters[name];
  return typeof count === 'number' ? { ...parameters, count } : { ...parameters };
}
