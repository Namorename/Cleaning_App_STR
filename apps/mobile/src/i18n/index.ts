// Before i18next: it picks "1 úkol, 2 úkoly, 5 úkolů" through Intl.PluralRules,
// which Hermes may not ship. Without it i18next knows only "one" and "other"
// and a Czech or Russian reader gets "2 úkolů". Pure JavaScript, installed only
// where the engine has no rules of its own.
import 'intl-pluralrules';

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

/**
 * The language to read before anyone has signed in.
 *
 * A guess, and the only sensible one: the profile that actually decides is on
 * the server, behind a login. Once it arrives, `applyLanguage` takes over —
 * and this is what the app goes back to when she signs out, so the next person
 * on a shared phone does not inherit her language.
 */
export function deviceLanguage(): Language {
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

/**
 * Switch the whole app to a language.
 *
 * Every component that shows translated text is subscribed through
 * `useTranslation`, so the redraw is the event's own doing and nothing here
 * has to walk the tree. The guard matters more than it looks: i18next emits
 * `languageChanged` even when the language did not change, and that is a
 * re-render of every screen for nothing.
 */
export async function applyLanguage(next: Language): Promise<void> {
  if (i18n.language === next) {
    return;
  }
  await i18n.changeLanguage(next);
}

export { i18n };
