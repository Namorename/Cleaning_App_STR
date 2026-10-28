import { FALLBACK_LANGUAGE, type Language } from '../i18n';

/** An article's text in one language. */
export interface KbText {
  readonly title: string;
  readonly body: string;
}

export interface KbOriginal extends KbText {
  /** The language the author wrote in. */
  readonly language: Language;
}

export interface KbTextChoice extends KbOriginal {
  /** The author's own text, not a translation. */
  readonly isOriginal: boolean;
}

/**
 * Which text of an article a reader sees: hers, else English (the product's
 * default language, the owner's decision of 2026-10-14), else the original.
 * A translation without a title is not there — the server keeps none, and an
 * editor's draft may still hold one.
 */
export function pickKbText(
  original: KbOriginal,
  translations: Partial<Readonly<Record<Language, KbText>>>,
  wanted: Language,
): KbTextChoice {
  for (const language of [wanted, FALLBACK_LANGUAGE]) {
    if (language === original.language) {
      return { ...original, isOriginal: true };
    }
    const translation = translations[language];
    // A title without a text would hide the original's text from the reader.
    const isComplete =
      translation !== undefined &&
      translation.title.trim() !== '' &&
      (translation.body.trim() !== '' || original.body.trim() === '');
    if (isComplete) {
      return { language, title: translation.title, body: translation.body, isOriginal: false };
    }
  }
  return { ...original, isOriginal: true };
}
