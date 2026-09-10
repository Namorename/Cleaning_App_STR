'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import {
  cancelTask,
  fetchCompanyLanguage,
  fetchProperties,
  fetchStaff,
  fetchTaskProblems,
  fetchTaskWork,
  fetchTasks,
  saveTask,
  setDurationOverride,
  type SaveTaskVariables,
} from './api';
import { taskKeys } from './keys';

export function useTasks() {
  const client = useSupabase();
  return useQuery({ queryKey: taskKeys.list(), queryFn: () => fetchTasks(client) });
}

export function useStaff() {
  const client = useSupabase();
  return useQuery({ queryKey: taskKeys.staff(), queryFn: () => fetchStaff(client) });
}

export function useProperties() {
  const client = useSupabase();
  return useQuery({ queryKey: taskKeys.properties(), queryFn: () => fetchProperties(client) });
}

export function useCompanyLanguage() {
  const client = useSupabase();
  return useQuery({
    queryKey: taskKeys.companyLanguage(),
    queryFn: () => fetchCompanyLanguage(client),
  });
}

/** Steps and photos of one task; idle until a task is open. */
export function useTaskWork(taskId: string | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: taskKeys.steps(taskId ?? ''),
    queryFn: () => fetchTaskWork(client, taskId ?? ''),
    enabled: taskId !== null,
  });
}

export function useTaskProblems(taskId: string | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: taskKeys.problems(taskId ?? ''),
    queryFn: () => fetchTaskProblems(client, taskId ?? ''),
    enabled: taskId !== null,
  });
}

/** After any write the list and every open card are stale together. */
function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: taskKeys.all });
}

export function useSaveTask() {
  const client = useSupabase();
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (variables: SaveTaskVariables) => saveTask(client, variables),
    onSuccess: invalidate,
  });
}

export function useCancelTask() {
  const client = useSupabase();
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (taskId: string) => cancelTask(client, taskId),
    onSuccess: invalidate,
  });
}

export function useSetDuration() {
  const client = useSupabase();
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ taskId, minutes }: { taskId: string; minutes: number | null }) =>
      setDurationOverride(client, taskId, minutes),
    onSuccess: invalidate,
  });
}
