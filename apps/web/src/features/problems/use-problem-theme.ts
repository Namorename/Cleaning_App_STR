'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qualityKeys } from '@/features/quality/keys';
import { useSupabase } from '@/lib/supabase/use-client';

import { problemKeys } from './keys';
import { fetchProblemTheme, setProblemTheme } from './problem-theme-api';

export function useProblemTheme(problemId: string) {
  const client = useSupabase();
  return useQuery({
    queryKey: problemKeys.theme(problemId),
    queryFn: () => fetchProblemTheme(client, problemId),
  });
}

export function useSetProblemTheme(problemId: string) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (theme: string | null) => setProblemTheme(client, { problemId, theme }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: problemKeys.theme(problemId) }),
        queryClient.invalidateQueries({ queryKey: qualityKeys.all }),
      ]),
  });
}
