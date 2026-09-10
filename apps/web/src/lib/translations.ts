/**
 * A bag of translations, trimmed and without the empty ones.
 *
 * A form has a field per language whether or not the manager fills it in;
 * the server refuses an empty translation (`is_localized_text`), and rightly
 * so — an empty string is not a translation, it is an untouched field.
 */
export function trimTranslations(translations: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(translations)
      .map(([code, text]) => [code, text.trim()])
      .filter(([, text]) => text !== ''),
  );
}
