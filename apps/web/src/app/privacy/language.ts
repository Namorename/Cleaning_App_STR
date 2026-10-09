import { isSupportedLanguage, type Language } from '@str-ops/shared';

/**
 * The page's languages in the order it offers them: Czech first, as the
 * company works in Czechia (decision 17, docs/f11-plan.md), then English and
 * Russian. The language is the address's, not the panel's cookie: a link in
 * App Store Connect must open the same page for everyone.
 */
export const PRIVACY_LANGUAGES: readonly Language[] = ['cs', 'en', 'ru'];

export const DEFAULT_PRIVACY_LANGUAGE: Language = 'cs';

/** `?lang=` as the address gives it; anything but one known code is Czech. */
export function privacyLanguage(param: string | string[] | undefined): Language {
  return typeof param === 'string' && isSupportedLanguage(param) ? param : DEFAULT_PRIVACY_LANGUAGE;
}

export function privacyHref(language: Language): string {
  return `/privacy?lang=${language}`;
}
