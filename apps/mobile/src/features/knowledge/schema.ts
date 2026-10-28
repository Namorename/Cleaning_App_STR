import {
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  matchesAllTokens,
  parseKbMarkup,
  pickKbText,
  propertyPathOf,
  type KbBlock,
  type KbLine,
  type KbText,
  type KbTextChoice,
  type Language,
} from '@str-ops/shared';
import { z } from 'zod';

/**
 * An article as the phone reads it (docs/knowledge-base-step2.md): published,
 * one the rules of the base let this reader see (kb_staff_article_ids, step 1)
 * — the phone filters nothing of its own — with its places and translations.
 */
const translationSchema = z.object({
  language: z.string(),
  title: z.string(),
  body: z.string(),
});

interface KbTranslation extends KbText {
  readonly language: Language;
}

export const kbArticleSchema = z.object({
  id: z.string(),
  scope: z.enum(['company', 'building', 'properties']),
  language: z.enum(SUPPORTED_LANGUAGES),
  title: z.string(),
  body: z.string(),
  updated_at: z.string(),
  // Only the reader's own places among the article's: the rules hide the rest.
  targets: z.array(
    z.object({
      property_id: z.number(),
      // The house the place hangs under, when the reader may see the place's row.
      property: z.object({ parent_id: z.number().nullable() }).nullable(),
    }),
  ),
  // A language the apps do not speak yet is left out, not a list that breaks.
  translations: z
    .array(translationSchema)
    .transform((rows) =>
      rows.flatMap((row): KbTranslation[] =>
        isSupportedLanguage(row.language) ? [{ ...row, language: row.language }] : [],
      ),
    ),
});

export type KbArticle = z.infer<typeof kbArticleSchema>;

/**
 * Row by row: an article in a language or a place of a kind this build does
 * not know yet is left out, and the rest of the base stays readable. Read
 * again on the way out of the cache, it gives the same list.
 */
export const kbArticleListSchema = z.array(z.unknown()).transform((rows) =>
  rows.flatMap((row): KbArticle[] => {
    const parsed = kbArticleSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  }),
);

/** A place as the knowledge base needs it: its house, to find the house's articles, and its name. */
export const kbPlaceSchema = z.object({
  id: z.number(),
  name: z.string(),
  parent_id: z.number().nullable(),
  hostaway_unit_id: z.number().nullable(),
  parent: z.object({ name: z.string() }).nullable(),
});

export type KbPlace = z.infer<typeof kbPlaceSchema>;

export const kbPlaceListSchema = z.array(kbPlaceSchema);

/** The text the reader sees: the phone's language if the article has it, else the author's. */
export function readArticleText(article: KbArticle, language: Language): KbTextChoice {
  const translations = Object.fromEntries(
    article.translations.map((one) => [one.language, { title: one.title, body: one.body }]),
  ) as Partial<Record<Language, KbText>>;
  return pickKbText(
    { language: article.language, title: article.title, body: article.body },
    translations,
    language,
  );
}

/**
 * Whether an article belongs to a place's instructions, as the panel's filter
 * reads it (`articleTouchesPlace`): it names the place, the house above it, or
 * a room under it. An article for the whole company names no place.
 */
export function articleTouchesPlace(
  article: KbArticle,
  place: Pick<KbPlace, 'id' | 'parent_id'>,
): boolean {
  return article.targets.some(
    (target) =>
      target.property_id === place.id ||
      (place.parent_id !== null && target.property_id === place.parent_id) ||
      target.property?.parent_id === place.id,
  );
}

/** The articles in the order the reader finds them: by the title she sees. */
export function sortArticles(articles: readonly KbArticle[], language: Language): KbArticle[] {
  return articles
    .map((article) => ({ article, title: readArticleText(article, language).title }))
    .sort((a, b) => a.title.localeCompare(b.title, language))
    .map(({ article }) => article);
}

export function articlesOfPlace(
  articles: readonly KbArticle[],
  place: Pick<KbPlace, 'id' | 'parent_id'>,
  language: Language,
): KbArticle[] {
  return sortArticles(
    articles.filter((article) => articleTouchesPlace(article, place)),
    language,
  );
}

/**
 * The articles holding every word typed, in the title or the text of any of
 * their languages — the apps' one search rule (`matchesAllTokens`: any order,
 * case and diacritics aside), run on the phone over what is already loaded.
 */
export function searchArticles(articles: readonly KbArticle[], query: string): KbArticle[] {
  if (query.trim() === '') {
    return [...articles];
  }
  return articles.filter((article) =>
    matchesAllTokens(
      [
        article.title,
        article.body,
        ...article.translations.flatMap((one) => [one.title, one.body]),
      ].join('\n'),
      query,
    ),
  );
}

/** The longest line a row shows of an article's text. */
const EXCERPT_LENGTH = 120;

function linesOf(block: KbBlock): readonly KbLine[] {
  return block.kind === 'paragraph' || block.kind === 'important' ? block.lines : block.items;
}

/** The start of an article's text on one line, its marks read and dropped. */
export function articleExcerpt(body: string): string {
  const text = parseKbMarkup(body)
    .flatMap(linesOf)
    .map((line) => line.map((piece) => piece.text).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= EXCERPT_LENGTH ? text : `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

/** A room with its house — its own name never says which — anything else by its name. */
export function placeLabel(place: KbPlace): string {
  return propertyPathOf(place) ?? place.name;
}

/**
 * The cloud has no knowledge base yet: the tables come with the migration of
 * step 1, and a phone with this update may ask before it is applied. PostgREST
 * says so as a table or a relationship it cannot find (PGRST205, PGRST200),
 * Postgres as a relation that does not exist (42P01).
 */
const MISSING_CODES: ReadonlySet<string> = new Set(['PGRST205', 'PGRST200', '42P01']);

export function isKnowledgeBaseMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const { code } = error as { code: unknown };
  return typeof code === 'string' && MISSING_CODES.has(code);
}
