import { reportError } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';

import { kbArticleListSchema, kbPlaceListSchema, type KbArticle, type KbPlace } from './schema';

/**
 * An article with what the phone shows of it: the text in each language, and
 * its places — the reader's own only, with the house each hangs under, so a
 * room finds its house's articles and a house its rooms'.
 */
const KB_ARTICLE_COLUMNS =
  'id, scope, language, title, body, updated_at, ' +
  'targets:kb_article_targets(property_id, property:properties(parent_id)), ' +
  'translations:kb_article_translations(language, title, body)';

/**
 * Every published article this person may read, in one read: the rules of the
 * base decide which (step 1: the whole company's, her places', the places of
 * the work she holds now), the phone does not narrow or widen them. Published
 * is asked for by name: the head technician's office rule would hand him the
 * drafts and the archive too, and those stay in the panel.
 */
export async function fetchKbArticles(): Promise<KbArticle[]> {
  const { data, error } = await supabase
    .from('kb_articles')
    .select(KB_ARTICLE_COLUMNS)
    .eq('status', 'published');

  if (error) {
    throw error;
  }

  const rows: readonly unknown[] = data ?? [];
  const articles = kbArticleListSchema.parse(rows);
  if (articles.length < rows.length) {
    // Left out, not lost quietly: a newer panel wrote something this build cannot read.
    reportError(
      new Error(
        `Knowledge base: ${rows.length - articles.length} of ${rows.length} articles unreadable by this build`,
      ),
    );
  }
  return articles;
}

const KB_PLACE_COLUMNS = 'id, name, parent_id, hostaway_unit_id, parent:parent_id(name)';

/** One place, to know its house and its name; null for a place she may not read. */
export async function fetchKbPlace(id: number): Promise<KbPlace | null> {
  const { data, error } = await supabase.from('properties').select(KB_PLACE_COLUMNS).eq('id', id);

  if (error) {
    throw error;
  }

  return kbPlaceListSchema.parse(data ?? [])[0] ?? null;
}
