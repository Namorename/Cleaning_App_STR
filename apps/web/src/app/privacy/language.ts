import type { Language } from '@str-ops/shared';

/**
 * The page's languages in the order it offers them: English first and by
 * default (the owner's decision of 14.10; decision 17, docs/f11-plan.md, had
 * Czech), then Czech and Russian. The language is the address's, not the
 * panel's cookie: a link in App Store Connect must open the same page for
 * everyone.
 *
 * The one reading of `?lang=`, for the page and for the proxy, which forwards
 * it to the root layout for <html lang>. Only a type is imported from the
 * shared package, so the proxy does not carry the dictionaries.
 */
export const PRIVACY_LANGUAGES: readonly Language[] = ['en', 'cs', 'ru'];

export const DEFAULT_PRIVACY_LANGUAGE: Language = 'en';

function isPrivacyLanguage(value: string): value is Language {
  return (PRIVACY_LANGUAGES as readonly string[]).includes(value);
}

/**
 * `?lang=` as the page receives it (a repeated parameter is a list); anything
 * but one known code is English.
 */
export function privacyLanguage(param: string | string[] | undefined): Language {
  return typeof param === 'string' && isPrivacyLanguage(param) ? param : DEFAULT_PRIVACY_LANGUAGE;
}

/** The same reading from the address itself, as the proxy has it. */
export function privacyLanguageOf(searchParams: URLSearchParams): Language {
  const values = searchParams.getAll('lang');
  return privacyLanguage(
    values.length === 1 ? values[0] : values.length === 0 ? undefined : values,
  );
}

export function privacyHref(language: Language): string {
  return `/privacy?lang=${language}`;
}
