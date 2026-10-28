import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import {
  articleRowListSchema,
  articleSchema,
  personListSchema,
  placeListSchema,
  revisionListSchema,
  translationsPayload,
  writtenSchema,
  type Article,
  type ArticleDraft,
  type ArticleRow,
  type KbStatus,
  type Person,
  type Place,
  type Revision,
  type Written,
} from './schema';

export type Client = SupabaseClient<Database>;

const ROW_COLUMNS =
  'id, status, scope, language, title, rev, updated_at, ' +
  'targets:kb_article_targets(property_id), translations:kb_article_translations(language)';

const ARTICLE_COLUMNS =
  'id, status, scope, language, title, body, rev, updated_at, ' +
  'targets:kb_article_targets(property_id), ' +
  'translations:kb_article_translations(language, title, body)';

const REVISION_COLUMNS = 'rev, language, title, body, translations, edited_by, created_at';

/** Every article the reader sees, newest change first. Row level security draws the line. */
export async function fetchArticles(client: Client): Promise<ArticleRow[]> {
  const { data, error } = await client
    .from('kb_articles')
    .select(ROW_COLUMNS)
    .order('updated_at', { ascending: false });
  if (error) {
    throw error;
  }
  return articleRowListSchema.parse(data ?? []);
}

/** One article with its text and translations; null when it is not there for this reader. */
export async function fetchArticle(client: Client, id: string): Promise<Article | null> {
  const { data, error } = await client
    .from('kb_articles')
    .select(ARTICLE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data === null ? null : articleSchema.parse(data);
}

/** The versions of an article's text, newest first. */
export async function fetchRevisions(client: Client, articleId: string): Promise<Revision[]> {
  const { data, error } = await client
    .from('kb_article_revisions')
    .select(REVISION_COLUMNS)
    .eq('article_id', articleId)
    .order('rev', { ascending: false });
  if (error) {
    throw error;
  }
  return revisionListSchema.parse(data ?? []);
}

/**
 * The places an article may be about, as many as the reader sees: the
 * manager every one, the head technician those of his tasks.
 */
export async function fetchPlaces(client: Client): Promise<Place[]> {
  const { data, error } = await client
    .from('properties')
    .select('id, name, parent_id, hostaway_unit_id, status')
    .order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return placeListSchema.parse(data ?? []);
}

/** The colleagues' names, for who wrote a version: the one list both writers may read. */
export async function fetchPeople(client: Client): Promise<Person[]> {
  const { data, error } = await client.rpc('staff_directory');
  if (error) {
    throw error;
  }
  return personListSchema.parse(data ?? []);
}

/**
 * Creates (a draft) or rewrites an article. The id was minted by the panel, so
 * a retry after a lost answer finds its own article. `expectedUpdatedAt` is the
 * article the screen showed (its updated_at); null for a new article asks nothing.
 */
export async function saveArticle(
  client: Client,
  draft: ArticleDraft,
  expectedUpdatedAt: string | null,
): Promise<Written> {
  const { data, error } = await client.rpc('save_kb_article', {
    p_id: draft.id,
    p_language: draft.language,
    p_title: draft.title.trim(),
    p_body: draft.body,
    p_translations: translationsPayload(draft),
    p_scope: draft.scope,
    p_property_ids: draft.scope === 'company' ? [] : [...draft.propertyIds],
    p_expected_updated_at: expectedUpdatedAt ?? undefined,
  });
  if (error) {
    throw error;
  }
  return writtenSchema.parse(data);
}

/** Publishes, takes back to a draft, or archives. The server checks what publishing needs. */
export async function setArticleStatus(
  client: Client,
  id: string,
  status: KbStatus,
): Promise<Written> {
  const { data, error } = await client.rpc('set_kb_article_status', {
    p_id: id,
    p_status: status,
  });
  if (error) {
    throw error;
  }
  return writtenSchema.parse(data);
}

/** Brings a version back as the newest one. */
export async function restoreRevision(
  client: Client,
  id: string,
  rev: number,
  expectedUpdatedAt: string,
): Promise<Written> {
  const { data, error } = await client.rpc('restore_kb_revision', {
    p_article_id: id,
    p_rev: rev,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    throw error;
  }
  return writtenSchema.parse(data);
}
