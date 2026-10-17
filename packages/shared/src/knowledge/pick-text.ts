import type { Language } from '../i18n';

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
 * Which text of an article a reader sees: hers, else the author's own (the
 * owner's decision of 2026-10-17 for the phone, step 2 — never a third
 * language in between). A translation without a title is not there — the
 * server keeps none, and an editor's draft may still hold one.
 */
export function pickKbText(
  original: KbOriginal,
  translations: Partial<Readonly<Record<Language, KbText>>>,
  wanted: Language,
): KbTextChoice {
  if (wanted === original.language) {
    return { ...original, isOriginal: true };
  }
  const translation = translations[wanted];
  // A title without a text would hide the original's text from the reader.
  const isComplete =
    translation !== undefined &&
    translation.title.trim() !== '' &&
    (translation.body.trim() !== '' || original.body.trim() === '');
  return isComplete
    ? { language: wanted, title: translation.title, body: translation.body, isOriginal: false }
    : { ...original, isOriginal: true };
}
