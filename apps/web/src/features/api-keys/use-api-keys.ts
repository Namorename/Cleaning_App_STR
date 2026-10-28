'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import { createApiKey, fetchApiKeys, revokeApiKey, updateApiKey } from './api';
import type { KeyDraft } from './schema';

export const apiKeysKeys = {
  all: ['api-keys'] as const,
  list: () => ['api-keys', 'list'] as const,
};

export function useApiKeys() {
  const client = useSupabase();
  return useQuery({ queryKey: apiKeysKeys.list(), queryFn: () => fetchApiKeys(client) });
}

/** The key the answer carries is handed to the caller and kept nowhere else — not in the query cache. */
export function useCreateApiKey() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: KeyDraft) => createApiKey(client, draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeysKeys.all }),
  });
}

export function useUpdateApiKey() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: KeyDraft }) => updateApiKey(client, id, draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeysKeys.all }),
  });
}

export function useRevokeApiKey() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeApiKey(client, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeysKeys.all }),
  });
}
