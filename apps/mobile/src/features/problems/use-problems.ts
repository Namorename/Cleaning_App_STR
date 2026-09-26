import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import type { LocalMediaRecord } from '@/features/media/local-store';
import { attachMedia } from '@/features/media/use-media';
import { readCached } from '@/lib/read-cached';

import {
  fetchMyProblems,
  fetchProblem,
  reportProblem,
  updateProblem,
  type ReportProblemVariables,
  type UpdateProblemVariables,
} from './api';
import { problemKeys, problemMutationKeys } from './keys';
import { problemListSchema, problemSchema, type Problem } from './schema';

const REPORT_RETRIES = 3;

export interface ReportWithPhotosVariables extends ReportProblemVariables {
  /** Captures made on the form, handed over once the report exists. */
  photos: readonly LocalMediaRecord[];
}

/**
 * The report and its photos as one replayable action.
 *
 * A photo cannot be registered before the problem it belongs to, so the
 * order is fixed: report first, then each file in turn. Every link is
 * idempotent on the server, so a chain cut anywhere restarts from the top
 * without duplicates. More photos can be added from the problem's own screen
 * afterwards, through the ordinary upload queue.
 */
export async function reportProblemWithPhotos(
  variables: ReportWithPhotosVariables,
): Promise<Problem> {
  const problem = await reportProblem(variables);
  for (const photo of variables.photos) {
    await attachMedia({
      problemId: problem.id,
      uri: photo.uri,
      mediaId: photo.id,
      kind: photo.kind,
      mimeType: photo.mimeType,
      byteSize: photo.byteSize,
      width: photo.width,
      height: photo.height,
      durationSec: photo.durationSec,
      takenAt: photo.takenAt,
      source: photo.source,
    });
  }
  return problem;
}

/** Teach the query client how to replay each write after a restart. */
export function registerProblemMutations(queryClient: QueryClient): void {
  queryClient.setMutationDefaults(problemMutationKeys.report, {
    mutationFn: (variables: ReportWithPhotosVariables) => reportProblemWithPhotos(variables),
    retry: REPORT_RETRIES,
  });
  queryClient.setMutationDefaults(problemMutationKeys.update, {
    mutationFn: (variables: UpdateProblemVariables) => updateProblem(variables),
  });
}

/**
 * Reports restored from disk come back in the shape the build that saved them
 * read (`readCached`): the house under a room's name, asked for since, is
 * simply missing. Read through the schema it is null instead of undefined.
 * Module-level so a query runs them only when its data changes.
 */
const oneOrNoProblemSchema = problemSchema.nullable();

function readProblems(data: unknown): Problem[] {
  return readCached(problemListSchema, data, 'problems');
}

function readProblem(data: unknown): Problem | null {
  return readCached(oneOrNoProblemSchema, data, 'problem');
}

export function useMyProblems() {
  const { userId } = useSession();

  return useQuery({
    queryKey: problemKeys.mine(),
    queryFn: fetchMyProblems,
    select: readProblems,
    enabled: userId !== null,
  });
}

export function useProblem(problemId: string) {
  const { userId } = useSession();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: problemKeys.one(problemId),
    queryFn: () => fetchProblem(problemId),
    // The list's copy seeds the screen below, raw from disk like any other.
    select: readProblem,
    enabled: userId !== null && problemId !== '',
    initialData: () =>
      queryClient
        .getQueryData<Problem[]>(problemKeys.mine())
        ?.find((problem) => problem.id === problemId),
    initialDataUpdatedAt: 0,
  });
}

function useInvalidateProblems() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: problemKeys.all });
  };
}

export function useReportProblem() {
  const invalidate = useInvalidateProblems();

  return useMutation<Problem, Error, ReportWithPhotosVariables>({
    mutationKey: problemMutationKeys.report,
    mutationFn: reportProblemWithPhotos,
    retry: REPORT_RETRIES,
    onSuccess: invalidate,
  });
}

export function useUpdateProblem() {
  const invalidate = useInvalidateProblems();

  return useMutation<Problem, Error, UpdateProblemVariables>({
    mutationKey: problemMutationKeys.update,
    mutationFn: updateProblem,
    onSuccess: invalidate,
  });
}
