import { SUPPORTED_LANGUAGES, type Language } from '@str-ops/shared';
import { z } from 'zod';

/** An article's life (20261030100000): written, out for the staff, put away. */
export const KB_STATUSES = ['draft', 'published', 'archived'] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

/** Where an article shows: the whole company, one building, places chosen one by one. */
export const KB_SCOPES = ['company', 'building', 'properties'] as const;
export type KbScope = (typeof KB_SCOPES)[number];

/** The longest title and text the server takes. */
export const KB_TITLE_MAX = 200;
export const KB_BODY_MAX = 20_000;

const languageSchema = z.enum(SUPPORTED_LANGUAGES);
const targetSchema = z.object({ property_id: z.number() });

/** A row of the list: no text, the languages it has, its places. */
export const articleRowSchema = z.object({
  id: z.string(),
  status: z.enum(KB_STATUSES),
  scope: z.enum(KB_SCOPES),
  language: languageSchema,
  title: z.string(),
  rev: z.number(),
  updated_at: z.string(),
  targets: z.array(targetSchema),
  translations: z.array(z.object({ language: languageSchema })),
});
export type ArticleRow = z.infer<typeof articleRowSchema>;
export const articleRowListSchema = z.array(articleRowSchema);

/** An article as the editor opens it: the text and every translation. */
export const articleSchema = articleRowSchema.extend({
  body: z.string(),
  translations: z.array(z.object({ language: languageSchema, title: z.string(), body: z.string() })),
});
export type Article = z.infer<typeof articleSchema>;

/** What a write answers, of the article it wrote. */
export const writtenSchema = z.object({
  id: z.string(),
  rev: z.number(),
  status: z.enum(KB_STATUSES),
  /** What the screen sends back as the article it showed (p_expected_updated_at). */
  updated_at: z.string(),
});
export type Written = z.infer<typeof writtenSchema>;

const textSchema = z.object({ title: z.string(), body: z.string() });

/** A version of the text, newest first in the history. */
export const revisionSchema = z.object({
  rev: z.number(),
  language: languageSchema,
  title: z.string(),
  body: z.string(),
  translations: z.record(z.string(), textSchema),
  edited_by: z.string().nullable(),
  created_at: z.string(),
});
export type Revision = z.infer<typeof revisionSchema>;
export const revisionListSchema = z.array(revisionSchema);

/** A place an article may be about: as many as the reader's row security shows. */
export const placeSchema = z.object({
  id: z.number(),
  name: z.string(),
  parent_id: z.number().nullable(),
  hostaway_unit_id: z.number().nullable(),
  status: z.string(),
});
export type Place = z.infer<typeof placeSchema>;
export const placeListSchema = z.array(placeSchema);

/** Who wrote a version: the colleagues the manager and the head technician may name. */
export const personSchema = z.object({ id: z.string(), full_name: z.string().nullable() });
export type Person = z.infer<typeof personSchema>;
export const personListSchema = z.array(personSchema);

export interface KbTextDraft {
  title: string;
  body: string;
}

/** What the editor holds until it is saved. */
export interface ArticleDraft {
  /** Minted by the panel for a new article, so a retried save writes it once. */
  id: string;
  language: Language;
  title: string;
  body: string;
  /** The other languages; one with an empty title and text is none. */
  translations: Partial<Record<Language, KbTextDraft>>;
  scope: KbScope;
  propertyIds: readonly number[];
}

export function hasText(text: KbTextDraft | undefined): text is KbTextDraft {
  return text !== undefined && (text.title.trim() !== '' || text.body.trim() !== '');
}

const ascending = (ids: readonly number[]): number[] => [...ids].sort((a, b) => a - b);

export function draftOf(article: Article): ArticleDraft {
  return {
    id: article.id,
    language: article.language,
    title: article.title,
    body: article.body,
    translations: Object.fromEntries(
      article.translations.map((translation) => [
        translation.language,
        { title: translation.title, body: translation.body },
      ]),
    ),
    scope: article.scope,
    propertyIds: ascending(article.targets.map((target) => target.property_id)),
  };
}

/** A new article: for the whole company, in the writer's language, until she says otherwise. */
export function emptyDraft(id: string, language: Language): ArticleDraft {
  return { id, language, title: '', body: '', translations: {}, scope: 'company', propertyIds: [] };
}

/** The translations as they would be kept: other languages with something in them. */
function keptTranslations(draft: ArticleDraft): [Language, KbTextDraft][] {
  return SUPPORTED_LANGUAGES.filter((language) => language !== draft.language).flatMap(
    (language) => {
      const text = draft.translations[language];
      return hasText(text) ? [[language, text] as [Language, KbTextDraft]] : [];
    },
  );
}

/**
 * Whether saving would change nothing: the same text, translations and places,
 * as the server would keep them — titles trimmed, and no places for an
 * article of the whole company (the ones held while choosing do not count).
 */
export function isSameDraft(a: ArticleDraft, b: ArticleDraft): boolean {
  const content = (draft: ArticleDraft) =>
    JSON.stringify([
      draft.language,
      draft.title.trim(),
      draft.body,
      draft.scope,
      draft.scope === 'company' ? [] : ascending(draft.propertyIds),
      keptTranslations(draft).map(([language, text]) => [language, text.title.trim(), text.body]),
    ]);
  return content(a) === content(b);
}

/**
 * The translations a save sends: titles trimmed, empty ones left out, never
 * one in the original's language. A text without a title goes as it is, so the
 * server refuses it by name instead of the editor dropping it unsaid.
 */
export function translationsPayload(
  draft: ArticleDraft,
): Record<string, { title: string; body: string }> {
  return Object.fromEntries(
    keptTranslations(draft).map(([language, text]) => [
      language,
      { title: text.title.trim(), body: text.body },
    ]),
  );
}

/**
 * The original said to be in another language. When that language has a
 * translation, the two change places — nothing typed is lost; otherwise only
 * the label changes.
 */
export function withLanguage(draft: ArticleDraft, language: Language): ArticleDraft {
  if (language === draft.language) {
    return draft;
  }
  const { [language]: incoming, ...others } = draft.translations;
  if (!hasText(incoming)) {
    return { ...draft, language, translations: others };
  }
  return {
    ...draft,
    language,
    title: incoming.title,
    body: incoming.body,
    translations: { ...others, [draft.language]: { title: draft.title, body: draft.body } },
  };
}
