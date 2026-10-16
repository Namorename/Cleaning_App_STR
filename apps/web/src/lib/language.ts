import { isSupportedLanguage, type Language } from '@str-ops/shared';

import { yearCookie } from './cookie';

/**
 * The language rules the server side needs, free of any React binding so a
 * server component can import them.
 */
export const LANGUAGE_COOKIE = 'lang';

/**
 * English unless somebody chose otherwise (the owner's decision of 14.10): a
 * guest on the sign-in page, a 404 or an error page reads English on any
 * device. A choice is the cookie alone — set by the switcher on the sign-in
 * page, by Settings → Account, or by the sign-in from the profile. The
 * browser's own language (Accept-Language) is deliberately not read.
 */
export const DEFAULT_PANEL_LANGUAGE: Language = 'en';

/** The choice the sign-in page and Settings → Account offer, the default first. */
export const PANEL_LANGUAGES: readonly Language[] = ['en', 'cs', 'ru'];

/** The cookie's language when it names one the panel speaks, else English. */
export function languageFromCookie(value: string | undefined): Language {
  return value !== undefined && isSupportedLanguage(value) ? value : DEFAULT_PANEL_LANGUAGE;
}

/** The cookie as `document.cookie` takes it: the whole panel, for a year. */
export function languageCookie(language: Language, isSecure: boolean): string {
  return yearCookie(LANGUAGE_COOKIE, language, isSecure);
}

/**
 * The browser's half of a language chosen in Settings or on the sign-in
 * page: <html> says it at once, and the cookie tells the server for every page
 * after — the root layout reads it before the first paint. The dictionary
 * itself is switched by the caller, which holds the i18next instance.
 */
export function applyLanguageChoice(doc: Document, language: Language): void {
  doc.documentElement.lang = language;
  doc.cookie = languageCookie(language, doc.location?.protocol === 'https:');
}

/**
 * The language a page is written in, for <html lang>: the page's own when the
 * proxy names one (`lib/page-language.ts`, the public privacy policy), else
 * the panel's, from the cookie. A value the panel does not speak is ignored.
 */
export function documentLanguage(
  pageLanguage: string | null | undefined,
  cookie: string | undefined,
): Language {
  return typeof pageLanguage === 'string' && isSupportedLanguage(pageLanguage)
    ? pageLanguage
    : languageFromCookie(cookie);
}
