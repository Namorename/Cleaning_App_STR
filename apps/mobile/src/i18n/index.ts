import {
  FALLBACK_LANGUAGE,
  INTL_LOCALES,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  resolveLanguage,
  translationResources,
  type Language,
} from '@str-ops/shared';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// The dictionaries and the language rules live in packages/shared, so the
// phone and the manager's panel read the same files. This module only adds
// what is the phone's own: the device locale and the i18next instance.
export { FALLBACK_LANGUAGE, INTL_LOCALES, SUPPORTED_LANGUAGES, resolveLanguage, type Language };

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
  resources: translationResources,
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
  return isSupportedLanguage(i18n.language) ? i18n.language : FALLBACK_LANGUAGE;
}

export { i18n };
