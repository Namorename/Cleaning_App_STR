// Before i18next: it picks "1 úklid, 2 úklidy, 5 úklidů" through Intl.PluralRules,
// which Hermes may not ship. Without it i18next knows only "one" and "other"
// and a Czech or Russian reader gets "2 úklidů". Pure JavaScript, installed only
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

/**
 * The variant of the words a role reads, as an i18next context: a technician
 * reads `key_tech` where it exists — «работа» where a cleaner reads «уборка»
 * (docs/tech-plan.md §6) — and the key itself where it does not.
 */
export type WordContext = 'tech';

let activeWordContext: WordContext | undefined;

/**
 * Set by the session, as the language is set by the profile: the moment it
 * knows who signed in, before any screen draws her, and back to none when she
 * leaves, so the next person on a shared phone does not inherit his words.
 */
export function applyWordContext(next: WordContext | undefined): void {
  activeWordContext = next;
}

/**
 * The context to read a word about the job in: `t(key, { context: wordContext() })`.
 * Undefined reads the key itself — the cleaner's words, and anybody's before
 * the session is known.
 */
export function wordContext(): WordContext | undefined {
  return activeWordContext;
}

export { i18n };
