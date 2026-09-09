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
