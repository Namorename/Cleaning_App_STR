'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import { fetchProcess, saveProcess } from './api';
import { workflowKeys } from './keys';
import type { ProcessDraft, WorkflowScope } from './schema';

export function useProcess(scope: WorkflowScope, propertyId: number | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: workflowKeys.process(scope, propertyId),
    queryFn: () => fetchProcess(client, scope, propertyId),
  });
}

/**
 * Save a process.
 *
 * Every process is invalidated rather than only the one that was written:
 * a listing that inherits shows the company default's steps, so changing the
 * default changes what a dozen other pickers on this screen would show.
 */
export function useSaveProcess() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: ProcessDraft) => saveProcess(client, draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
}
