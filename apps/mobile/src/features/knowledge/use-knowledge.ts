import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { readCached } from '@/lib/read-cached';

import { fetchKbArticles, fetchKbPlace } from './api';
import { knowledgeKeys } from './keys';
import {
  isKnowledgeBaseMissing,
  kbArticleListSchema,
  kbPlaceSchema,
  type KbArticle,
  type KbPlace,
} from './schema';

/**
 * Read for this session only: the disk never keeps the knowledge base
 * (lib/query-client.ts, `shouldSaveList`). Offline reading is its step 5;
 * until then a cold start without signal says so instead of showing
 * yesterday's texts.
 */
const SESSION_ONLY = { persist: false } as const;

/** As every list on the phone (lib/query-client.ts). */
const RETRIES = 2;

/**
 * A failed read is asked again, as every list is — unless the cloud has no
 * knowledge base yet: asking again only asks the same missing table.
 */
export function retryKnowledge(failureCount: number, error: unknown): boolean {
  return !isKnowledgeBaseMissing(error) && failureCount < RETRIES;
}

/** An article published a minute ago reaches a screen opened after this long at most. */
const ARTICLES_FRESH_FOR_MS = 5 * 60 * 1000;

/** Which house a place hangs under changes with a new listing, not in a day. */
const PLACE_FRESH_FOR_MS = 60 * 60 * 1000;

function readArticles(data: unknown): KbArticle[] {
  return readCached(kbArticleListSchema, data, 'knowledge base articles');
}

function readPlace(data: unknown): KbPlace | null {
  return readCached(kbPlaceSchema.nullable(), data, 'knowledge base place');
}

/** Every published article this person may read; one read for every screen of the base. */
export function useKbArticles(isEnabled = true): UseQueryResult<KbArticle[], Error> {
  return useQuery({
    queryKey: knowledgeKeys.articles(),
    queryFn: fetchKbArticles,
    select: readArticles,
    enabled: isEnabled,
    staleTime: ARTICLES_FRESH_FOR_MS,
    retry: (failureCount, error: Error) => retryKnowledge(failureCount, error),
    meta: SESSION_ONLY,
  });
}

/** One place, to know its house and its name; nothing asked without one. */
export function useKbPlace(id: number | null): UseQueryResult<KbPlace | null, Error> {
  return useQuery({
    queryKey: knowledgeKeys.place(id ?? 0),
    queryFn: () => fetchKbPlace(id ?? 0),
    select: readPlace,
    enabled: id !== null,
    staleTime: PLACE_FRESH_FOR_MS,
    retry: (failureCount, error: Error) => retryKnowledge(failureCount, error),
    meta: SESSION_ONLY,
  });
}
