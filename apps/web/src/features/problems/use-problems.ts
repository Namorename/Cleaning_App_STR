'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';

import {
  assignProblem,
  cancelProblem,
  fetchFixTaskSteps,
  fetchProblem,
  fetchProblemPhotos,
  fetchProblems,
  fetchStaff,
  resolveProblem,
  type AssignProblemVariables,
  type Client,
} from './api';
import { problemKeys } from './keys';

/** One browser client per component tree; the cookie session is shared anyway. */
export function useSupabase(): Client {
  const [client] = useState(() => createClient());
  return client;
}

export function useProblems() {
  const client = useSupabase();
  return useQuery({ queryKey: problemKeys.list(), queryFn: () => fetchProblems(client) });
}

export function useProblem(problemId: string) {
  const client = useSupabase();
  return useQuery({
    queryKey: problemKeys.detail(problemId),
    queryFn: () => fetchProblem(client, problemId),
  });
}

export function useProblemPhotos(problemId: string) {
  const client = useSupabase();
  return useQuery({
    queryKey: problemKeys.photos(problemId),
    queryFn: () => fetchProblemPhotos(client, problemId),
  });
}

/** Steps of the fix task; idle until there is a task to read. */
export function useFixTaskSteps(taskId: string | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: problemKeys.fixSteps(taskId ?? ''),
    queryFn: () => fetchFixTaskSteps(client, taskId ?? ''),
    enabled: taskId !== null,
  });
}

export function useStaff() {
  const client = useSupabase();
  return useQuery({ queryKey: problemKeys.staff(), queryFn: () => fetchStaff(client) });
}

/** After any write the lists and the card are stale together. */
function useInvalidateProblems() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: problemKeys.all });
}

export function useAssignProblem() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: (variables: AssignProblemVariables) => assignProblem(client, variables),
    onSuccess: invalidate,
  });
}

export function useCancelProblem() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: ({ problemId, reason }: { problemId: string; reason: string }) =>
      cancelProblem(client, problemId, reason),
    onSuccess: invalidate,
  });
}

export function useResolveProblem() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: (problemId: string) => resolveProblem(client, problemId),
    onSuccess: invalidate,
  });
}
