import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { useSession } from '@/features/auth/session';
import { stepKeys } from '@/features/steps/keys';

import {
  addMedia,
  confirmMedia,
  fetchTaskMedia,
  removeMedia,
  signedMediaUrls,
  uploadMediaFile,
  type AddMediaVariables,
} from './api';
import { discardFile } from './file';
import { mediaKeys } from './keys';
import {
  forgetLocalMedia,
  loadLocalMedia,
  rememberLocalMedia,
  type LocalMediaRecord,
} from './local-store';
import type { MediaItemView, TaskMedia } from './schema';

export const mediaMutationKeys = {
  attach: ['media', 'attach'] as const,
  remove: ['media', 'remove'] as const,
};

/**
 * One task's uploads go one at a time, and so do everyone's: a stairwell's
 * worth of bandwidth is better spent finishing one photo than starting four.
 */
const ATTACH_SCOPE = { id: 'media-attach' };
const ATTACH_RETRIES = 3;

export interface AttachMediaVariables extends AddMediaVariables {
  /** Which task's caches to update; the server does not need it. */
  taskId: string;
  /** The file on the phone. */
  uri: string;
}

export interface RemoveMediaVariables {
  taskId: string;
  mediaId: string;
}

/**
 * Register, upload, confirm — the whole chain as one replayable action.
 *
 * Each link is idempotent on the server, so a chain cut anywhere can be
 * started again from the top: the row is returned rather than duplicated,
 * the duplicate object is read as already there, the confirmation returns a
 * confirmed row as it is.
 */
export async function attachMedia(variables: AttachMediaVariables): Promise<TaskMedia> {
  const row = await addMedia(variables);
  await uploadMediaFile(row.storage_path, variables.uri, variables.mimeType);
  return confirmMedia(variables.mediaId);
}

/** Teach the query client how to replay each media action after a restart. */
export function registerMediaMutations(queryClient: QueryClient): void {
  queryClient.setMutationDefaults(mediaMutationKeys.attach, {
    mutationFn: (variables: AttachMediaVariables) => attachMedia(variables),
    scope: ATTACH_SCOPE,
    retry: ATTACH_RETRIES,
  });
  queryClient.setMutationDefaults(mediaMutationKeys.remove, {
    mutationFn: ({ mediaId }: RemoveMediaVariables) => removeMedia(mediaId),
  });
}

export function useTaskMedia(taskId: string) {
  const { userId } = useSession();

  return useQuery({
    queryKey: mediaKeys.byTask(taskId),
    queryFn: () => fetchTaskMedia(taskId),
    enabled: userId !== null && taskId !== '',
  });
}

/** Signed links for the given paths, refreshed before they expire. */
export function useMediaUrls(paths: readonly string[]) {
  const sorted = useMemo(() => [...paths].sort(), [paths]);

  return useQuery({
    queryKey: mediaKeys.urls(sorted),
    queryFn: () => signedMediaUrls(sorted),
    enabled: sorted.length > 0,
    staleTime: 50 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

export function useLocalMedia() {
  return useQuery({
    queryKey: mediaKeys.local,
    queryFn: loadLocalMedia,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** A row as it looks the moment the shutter closes, before the server has it. */
function pendingRow(variables: AttachMediaVariables): TaskMedia {
  return {
    id: variables.mediaId,
    task_id: variables.taskId,
    step_id: variables.stepId,
    kind: variables.kind,
    storage_path: '',
    mime_type: variables.mimeType,
    duration_sec: variables.durationSec,
    device_taken_at: variables.takenAt,
    created_at: variables.takenAt,
    uploaded_at: null,
    deleted_at: null,
  };
}

export function useAttachMedia() {
  const queryClient = useQueryClient();

  return useMutation<TaskMedia, Error, AttachMediaVariables>({
    mutationKey: mediaMutationKeys.attach,
    mutationFn: attachMedia,
    scope: ATTACH_SCOPE,
    retry: ATTACH_RETRIES,
    onMutate: async (variables) => {
      const key = mediaKeys.byTask(variables.taskId);
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<TaskMedia[]>(key, (media = []) =>
        media.some((item) => item.id === variables.mediaId)
          ? media
          : [...media, pendingRow(variables)],
      );
    },
    onSuccess: (row, variables) => {
      queryClient.setQueryData<TaskMedia[]>(mediaKeys.byTask(variables.taskId), (media = []) =>
        media.map((item) => (item.id === row.id ? row : item)),
      );
    },
    onSettled: (_row, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: mediaKeys.byTask(variables.taskId) });
      void queryClient.invalidateQueries({ queryKey: stepKeys.byTask(variables.taskId) });
    },
  });
}

interface RemoveContext {
  previous: TaskMedia[] | undefined;
}

export function useRemoveMedia() {
  const queryClient = useQueryClient();

  return useMutation<TaskMedia, Error, RemoveMediaVariables, RemoveContext>({
    mutationKey: mediaMutationKeys.remove,
    mutationFn: ({ mediaId }) => removeMedia(mediaId),
    onMutate: async (variables) => {
      const key = mediaKeys.byTask(variables.taskId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskMedia[]>(key);
      queryClient.setQueryData<TaskMedia[]>(key, (media = []) =>
        media.filter((item) => item.id !== variables.mediaId),
      );
      return { previous };
    },
    onError: (_error, variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(mediaKeys.byTask(variables.taskId), context.previous);
      }
    },
    onSuccess: async (_row, variables) => {
      const local = (await loadLocalMedia())[variables.mediaId];
      if (local !== undefined) {
        discardFile(local.uri);
      }
      queryClient.setQueryData(mediaKeys.local, await forgetLocalMedia(variables.mediaId));
    },
    onSettled: (_row, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: mediaKeys.byTask(variables.taskId) });
    },
  });
}

/** Remember a capture on disk and in the cache, before its upload starts. */
export function useRememberLocalMedia() {
  const queryClient = useQueryClient();

  return async (record: LocalMediaRecord): Promise<void> => {
    queryClient.setQueryData(mediaKeys.local, await rememberLocalMedia(record));
  };
}

/** Ids of the uploads under way or waiting for signal. */
export function useUploadingMediaIds(): Set<string> {
  const variables = useMutationState({
    filters: { mutationKey: mediaMutationKeys.attach, status: 'pending' },
    select: (mutation) => (mutation.state.variables as AttachMediaVariables | undefined)?.mediaId,
  });

  return useMemo(
    () => new Set(variables.filter((id): id is string => typeof id === 'string')),
    [variables],
  );
}

/**
 * The tiles of one step, in the order the photos were taken.
 *
 * Where the picture comes from: the file on the phone when we still have it,
 * otherwise a signed link. Where the item stands: confirmed by the server,
 * still travelling, or stranded — a row without a file and no upload running
 * for it, which happens when the app was killed mid-upload.
 */
export function mediaItemViews(
  media: readonly TaskMedia[],
  local: Readonly<Record<string, LocalMediaRecord>>,
  urls: Readonly<Record<string, string>>,
  uploading: ReadonlySet<string>,
): MediaItemView[] {
  return media.map((item) => ({
    id: item.id,
    kind: item.kind,
    uri: local[item.id]?.uri ?? urls[item.storage_path] ?? null,
    status:
      item.uploaded_at !== null ? 'uploaded' : uploading.has(item.id) ? 'uploading' : 'failed',
    durationSec: item.duration_sec,
  }));
}
