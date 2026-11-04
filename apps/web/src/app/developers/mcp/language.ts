import type { Language } from '@str-ops/shared';

/**
 * The MCP page's languages, English first and by default, as the privacy
 * policy has them (app/privacy/language.ts): the language is the address's,
 * so a link handed to a developer opens the same page for everyone. Only a
 * type is imported from the shared package, so the proxy does not carry the
 * dictionaries.
 */
export const MCP_PAGE_LANGUAGES: readonly Language[] = ['en', 'cs', 'ru'];

export const DEFAULT_MCP_PAGE_LANGUAGE: Language = 'en';

function isMcpPageLanguage(value: string): value is Language {
  return (MCP_PAGE_LANGUAGES as readonly string[]).includes(value);
}

/** `?lang=` as the page receives it; anything but one known code is English. */
export function mcpPageLanguage(param: string | string[] | undefined): Language {
  return typeof param === 'string' && isMcpPageLanguage(param) ? param : DEFAULT_MCP_PAGE_LANGUAGE;
}

/** The same reading from the address itself, as the proxy has it. */
export function mcpPageLanguageOf(searchParams: URLSearchParams): Language {
  const values = searchParams.getAll('lang');
  return mcpPageLanguage(
    values.length === 1 ? values[0] : values.length === 0 ? undefined : values,
  );
}

export function mcpPageHref(language: Language): string {
  return `/developers/mcp?lang=${language}`;
}
