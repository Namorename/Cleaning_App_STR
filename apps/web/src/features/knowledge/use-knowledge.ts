'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import {
  fetchArticle,
  fetchArticles,
  fetchPeople,
  fetchPlaces,
  fetchRevisions,
  restoreRevision,
  saveArticle,
  setArticleStatus,
} from './api';
import { knowledgeKeys } from './keys';
import type { ArticleDraft, KbStatus } from './schema';

/** Names and places change seldom while the page is open. */
const SLOW_STALE_MS = 5 * 60_000;

export function useArticles() {
  const client = useSupabase();
  return useQuery({ queryKey: knowledgeKeys.list(), queryFn: () => fetchArticles(client) });
}

/** The article open in the editor; nothing is asked for one still being written. */
export function useArticle(id: string | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: knowledgeKeys.article(id ?? ''),
    queryFn: () => fetchArticle(client, id ?? ''),
    enabled: id !== null,
  });
}

export function useRevisions(id: string | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: knowledgeKeys.revisions(id ?? ''),
    queryFn: () => fetchRevisions(client, id ?? ''),
    enabled: id !== null,
  });
}

export function usePlaces() {
  const client = useSupabase();
  return useQuery({
    queryKey: knowledgeKeys.places(),
    queryFn: () => fetchPlaces(client),
    staleTime: SLOW_STALE_MS,
  });
}

export function usePeople() {
  const client = useSupabase();
  return useQuery({
    queryKey: knowledgeKeys.people(),
    queryFn: () => fetchPeople(client),
    staleTime: SLOW_STALE_MS,
  });
}

/** After any write: the list, the article and its versions are read again. */
function useInvalidateArticle() {
  const queryClient = useQueryClient();
  return (id: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.list() }),
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.article(id) }),
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.revisions(id) }),
    ]);
}

export interface SaveVariables {
  draft: ArticleDraft;
  expectedRev: number | null;
}

export function useSaveArticle() {
  const client = useSupabase();
  const invalidate = useInvalidateArticle();
  return useMutation({
    mutationFn: ({ draft, expectedRev }: SaveVariables) => saveArticle(client, draft, expectedRev),
    onSuccess: (written) => invalidate(written.id),
  });
}

export function useSetArticleStatus() {
  const client = useSupabase();
  const invalidate = useInvalidateArticle();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: KbStatus }) =>
      setArticleStatus(client, id, status),
    // A refusal too: a colleague may have moved it first.
    onSettled: (_written, _error, { id }) => invalidate(id),
  });
}

export function useRestoreRevision() {
  const client = useSupabase();
  const invalidate = useInvalidateArticle();
  return useMutation({
    mutationFn: ({ id, rev, expectedRev }: { id: string; rev: number; expectedRev: number }) =>
      restoreRevision(client, id, rev, expectedRev),
    onSettled: (_written, _error, { id }) => invalidate(id),
  });
}
