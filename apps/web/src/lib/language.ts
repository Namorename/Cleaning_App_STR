import { isSupportedLanguage, type Language } from '@str-ops/shared';

/**
 * The language rules the server side needs, free of any React binding so a
 * server component can import them.
 */
export const LANGUAGE_COOKIE = 'lang';

/** The panel speaks the company's language by default; the cookie overrides it. */
export const DEFAULT_PANEL_LANGUAGE: Language = 'ru';

export function languageFromCookie(value: string | undefined): Language {
  return value !== undefined && isSupportedLanguage(value) ? value : DEFAULT_PANEL_LANGUAGE;
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
