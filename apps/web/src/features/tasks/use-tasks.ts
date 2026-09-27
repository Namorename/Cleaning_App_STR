'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { serverErrorHint } from '@/lib/server-error';
import { useSupabase } from '@/lib/supabase/use-client';

import {
  cancelTask,
  fetchProperties,
  fetchReservationGuest,
  fetchStaff,
  fetchTask,
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

/**
 * Who is leaving from the booking a cleaning closes. Only a task with a
 * booking asks, so the form mounts the caller only for one.
 */
export function useReservationGuest(reservationId: number) {
  const client = useSupabase();
  return useQuery({
    queryKey: taskKeys.reservation(reservationId),
    queryFn: () => fetchReservationGuest(client, reservationId),
  });
}

/** One task whole, for the drawer a closed chip of the calendar opens. */
export function useTask(taskId: string | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: taskKeys.one(taskId ?? ''),
    queryFn: () => fetchTask(client, taskId as string),
    enabled: taskId !== null,
  });
}

/** After any write the list and every open card are stale together. */
function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: taskKeys.all });
}

/** A save refused because the task moved while the form was open (20260926160000). */
const MOVED_HINT = 'serverErrors.taskMovedMeanwhile';

/**
 * The calendar's own layers, read outside `tasks` (use-calendar.ts): the
 * bookings and what never happened. The stand's copies share the prefix and
 * are read only on the stand.
 */
const CALENDAR_LAYERS = ['calendar'] as const;

export function useSaveTask() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (variables: SaveTaskVariables) => saveTask(client, variables),
    onSuccess: invalidate,
    // A booking moved the task while the form was open: the list, the
    // calendar's chips and the bookings that moved it are all behind, and the
    // manager is told to open the task again on its new day.
    onError: (error) =>
      serverErrorHint(error) === MOVED_HINT
        ? Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: CALENDAR_LAYERS })])
        : undefined,
  });
}

export function useCancelTask() {
  const client = useSupabase();
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (taskId: string) => cancelTask(client, taskId),
    // A refusal means the task changed meanwhile: refresh either way.
    onSettled: invalidate,
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
