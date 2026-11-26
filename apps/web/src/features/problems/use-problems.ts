'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { signalKeys } from '@/features/guest-signals/keys';
import { taskKeys } from '@/features/tasks/keys';
import { useSupabase } from '@/lib/supabase/use-client';

import {
  archiveProblem,
  assignProblem,
  cancelProblem,
  editProblemText,
  fetchFixTaskSteps,
  fetchProblem,
  fetchProblemPhotos,
  fetchProblems,
  fetchStaff,
  fetchWorkers,
  nameProblemWorker,
  markFalsePositive,
  reopenProblem,
  reportProblem,
  resolveProblem,
  setProblemDueDate,
  unarchiveProblem,
  unassignProblem,
  type AssignProblemVariables,
  type EditProblemTextVariables,
  type FalsePositiveVariables,
  type ReportProblemVariables,
  type ResolveProblemVariables,
  type SetProblemDueDateVariables,
} from './api';
import { fetchAdditions, publishOfficeFiles } from './additions-api';
import { fetchReportCatalog, reportCatalogOf, type ReportCatalog } from './catalog';
import { problemCatalogKeys, problemKeys } from './keys';

/** The catalogue changes seldom: read with the page, again only after a while. */
const CATALOG_FRESH_MS = 5 * 60_000;

/**
 * How «Новое задание» names a task: by a category of the company's catalogue when the company
 * reports by it (hosts.problem_report_mode = catalog, as the cleaners' phones), by a typed title
 * otherwise — and whenever the catalogue cannot be read: a task is never held up by it. The page
 * asks as it opens, so the form opens knowing.
 */
export function useReportCatalog({ isForm = false }: { isForm?: boolean } = {}): ReportCatalog {
  const client = useSupabase();
  const query = useQuery({
    queryKey: problemCatalogKeys.all,
    queryFn: () => fetchReportCatalog(client),
    staleTime: CATALOG_FRESH_MS,
    // A failed read is the typed title at once, not after a retry. The form opened after it
    // takes the failure as it stands rather than waiting on a read again; the page, opened
    // anew, reads again — so does a later focus of the window.
    retry: false,
    retryOnMount: !isForm,
  });
  return reportCatalogOf(query);
}

/** `refetchInterval` for a page that stays open and counts them, the dashboard. */
export function useProblems(refetchInterval?: number) {
  const client = useSupabase();
  return useQuery({
    queryKey: problemKeys.list(),
    queryFn: () => fetchProblems(client),
    refetchInterval,
  });
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

/** What the office added to the task: its batches, files and the closing's comment. */
export function useAdditions(problemId: string) {
  const client = useSupabase();
  return useQuery({
    queryKey: problemKeys.additions(problemId),
    queryFn: () => fetchAdditions(client, problemId),
  });
}

/** «Добавить»: the batch shows on the task; the task is read again with it. */
export function usePublishOfficeFiles(problemId: string) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (additionId: string) => publishOfficeFiles(client, additionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: problemKeys.additions(problemId) }),
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

export function useNameProblemWorker() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: (variables: { problemId: string; personId: string }) =>
      nameProblemWorker(client, variables),
    onSettled: invalidate,
  });
}

/** The technicians a manager may name as the one who did a task, those switched off too. */
export function useWorkers() {
  const client = useSupabase();
  return useQuery({ queryKey: problemKeys.workers(), queryFn: () => fetchWorkers(client) });
}

/**
 * After any write the lists and the card are stale together — and the tasks:
 * a problem's repair is a task, and the calendar and the Cleanings screen (/tasks) read it
 * (docs/f10-plan.md, §6). Both settle before the mutation does.
 */
function useInvalidateProblems() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: problemKeys.all }),
      queryClient.invalidateQueries({ queryKey: taskKeys.all }),
    ]);
}

/** «Новое задание»: the board and the list show the new row once the write settles. */
export function useReportProblem() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: (variables: ReportProblemVariables) => reportProblem(client, variables),
    onSuccess: invalidate,
  });
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

export function useUnassignProblem() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: ({ taskId, assigneeId }: { taskId: string; assigneeId: string | null }) =>
      unassignProblem(client, taskId, assigneeId),
    // A refusal means the task changed meanwhile: refresh either way.
    onSettled: invalidate,
  });
}

export function useResolveProblem() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: (variables: ResolveProblemVariables) => resolveProblem(client, variables),
    onSuccess: invalidate,
  });
}

export function useReopenProblem() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: (problemId: string) => reopenProblem(client, problemId),
    onSuccess: invalidate,
  });
}

/** «Изменить»: the office's new title and description of any task. */
export function useEditProblemText() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: (variables: EditProblemTextVariables) => editProblemText(client, variables),
    onSuccess: invalidate,
  });
}

/**
 * «Дата выполнения»: the office plans the task's day or clears it. The queues reorder and the
 * repair's tail counts from it, so the lists, the card and the repairs are read again.
 */
export function useSetProblemDueDate() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: (variables: SetProblemDueDateVariables) => setProblemDueDate(client, variables),
    onSuccess: invalidate,
  });
}

export function useArchiveProblem() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: (problemId: string) => archiveProblem(client, problemId),
    onSuccess: invalidate,
  });
}

/**
 * «Ложное срабатывание»: besides the task and its repair, the finding moved to
 * «Отклонённые» of «Гости» and left the menu's count.
 */
export function useMarkFalsePositive() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: (variables: FalsePositiveVariables) => markFalsePositive(client, variables),
    onSuccess: () =>
      Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: signalKeys.all })]),
  });
}

export function useUnarchiveProblem() {
  const client = useSupabase();
  const invalidate = useInvalidateProblems();
  return useMutation({
    mutationFn: (problemId: string) => unarchiveProblem(client, problemId),
    onSuccess: invalidate,
  });
}
