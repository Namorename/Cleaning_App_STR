import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import cs from './locales/cs.json';
import en from './locales/en.json';
import ru from './locales/ru.json';

/**
 * The languages the app ships translation files for.
 *
 * Kept in step with the `public.app_language` enum in the database, which the
 * server side uses to pick a language for push notifications in F11. A code
 * with no file behind it would show up as untranslated keys.
 */
export const SUPPORTED_LANGUAGES = ['en', 'ru', 'cs'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Used when the phone asks for a language the app does not speak.
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

function isSupported(code: string): code is Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

/**
 * Pick a language from the device's ordered list of preferences.
 *
 * Ordered, not just the first: someone whose phone is set to Slovak with
 * Czech second is better served in Czech than in the fallback.
 */
export function resolveLanguage(preferences: readonly (string | null | undefined)[]): Language {
  for (const preference of preferences) {
    const code = preference?.split('-')[0].toLowerCase();
    if (code !== undefined && isSupported(code)) {
      return code;
    }
  }

  return FALLBACK_LANGUAGE;
}

function deviceLanguage(): Language {
  try {
    return resolveLanguage(getLocales().map((locale) => locale.languageCode));
  } catch {
    // Reading the device locale is a native call and can fail on a platform
    // where it is unavailable; a missing locale is not worth a blank screen.
    return FALLBACK_LANGUAGE;
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
    cs: { translation: cs },
  },
  lng: deviceLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  // React escapes on render, and there is no HTML here to escape into.
  interpolation: { escapeValue: false },
  // i18next prints a vendor notice through console.info on every init. It is
  // noise in the test output and a log line in a shipped build.
  showSupportNotice: false,
});

/** The active language, always one the app has a file for. */
export function currentLanguage(): Language {
  return isSupported(i18n.language) ? i18n.language : FALLBACK_LANGUAGE;
}

export { i18n };
