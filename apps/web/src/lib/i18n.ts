import { FALLBACK_LANGUAGE, translationResources, type Language } from '@str-ops/shared';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

export { DEFAULT_PANEL_LANGUAGE, LANGUAGE_COOKIE, languageFromCookie } from './language';

/**
 * One i18next instance for the browser, fed from the shared dictionaries.
 *
 * The same files the phone reads: a key the server sends in `hint` is
 * translated here with the same words a cleaner would see. Client
 * components only — the React binding has no place in a server component.
 */
export function initI18n(language: Language) {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources: translationResources,
      lng: language,
      fallbackLng: FALLBACK_LANGUAGE,
      interpolation: { escapeValue: false },
    });
  } else if (i18next.language !== language) {
    void i18next.changeLanguage(language);
  }
  return i18next;
}

export { i18next as i18n };
