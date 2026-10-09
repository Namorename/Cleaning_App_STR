import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';

import { useSession } from '@/features/auth/session';
import { sendMessage, type SendMessageVariables } from '@/features/chat/api';
import { chatKeys } from '@/features/chat/keys';
import type { OwnMediaState, OwnMediaStates } from '@/features/chat/media-tiles';
import { stepKeys } from '@/features/steps/keys';
import { serverErrorKey } from '@/lib/server-error';
import { reportError } from '@/lib/sentry';

import {
  addMedia,
  confirmMedia,
  fetchProblemMedia,
  fetchTaskMedia,
  removeMedia,
  signedMediaUrls,
  uploadMediaFile,
  uploadVideoFile,
  type AddMediaVariables,
  type MediaOwnerRef,
} from './api';
import { discardFile } from './file';
import { mediaKeys } from './keys';
import {
  forgetLocalMedia,
  loadLocalMedia,
  readLocalMediaStore,
  rememberLocalMedia,
  type LocalMediaRecord,
} from './local-store';
import type { MediaItemView, TaskMedia } from './schema';
import {
  clearUploadProgress,
  reportUploadProgress,
  subscribeUploadProgress,
  uploadProgressSnapshot,
  type UploadProgress,
} from './upload-progress';

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
  /** The file on the phone. */
  uri: string;
  /**
   * For a photo of a chat message: the message itself, said again first.
   * The text goes out through its own queue, and the two queues do not wait
   * for each other; `send_message` is replayable by id, so saying it again
   * costs nothing and the photo can never run ahead of its message.
   */
  message?: SendMessageVariables;
}

export interface RemoveMediaVariables extends MediaOwnerRef {
  mediaId: string;
}

/** The cache a file's owner reads its media from. */
export function mediaOwnerKey(owner: MediaOwnerRef) {
  if (owner.messageId !== undefined) {
    return mediaKeys.byMessage(owner.messageId);
  }
  return owner.problemId !== undefined
    ? mediaKeys.byProblem(owner.problemId)
    : mediaKeys.byTask(owner.taskId ?? '');
}

/** The reads a file's owner shows up in, beyond its own media cache. */
function invalidateOwner(queryClient: QueryClient, owner: MediaOwnerRef): void {
  void queryClient.invalidateQueries({ queryKey: mediaOwnerKey(owner) });
  if (owner.taskId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: stepKeys.byTask(owner.taskId) });
  }
  if (owner.messageId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: chatKeys.all });
  }
}

/**
 * Forget the attempts that already failed for this file: a retry or a
 * removal is the answer to them, and a tile must not keep saying "failed"
 * on their account.
 */
function dropFailedAttempts(queryClient: QueryClient, mediaId: string): void {
  const cache = queryClient.getMutationCache();
  cache
    .findAll({
      mutationKey: mediaMutationKeys.attach,
      status: 'error',
      predicate: (mutation) =>
        (mutation.state.variables as AttachMediaVariables | undefined)?.mediaId === mediaId,
    })
    .forEach((mutation) => cache.remove(mutation));
}

/**
 * Register, upload, confirm — the whole chain as one replayable action.
 *
 * Each link is idempotent on the server, so a chain cut anywhere can be
 * started again from the top: the row is returned rather than duplicated,
 * the duplicate object is read as already there, the confirmation returns a
 * confirmed row as it is.
 *
 * A photo goes up in one request. A video goes in pieces and resumes where
 * the last attempt stopped (`attachVideo`). The query client, when given, is
 * told of the local ledger a video's release changes.
 */
export async function attachMedia(
  variables: AttachMediaVariables,
  queryClient?: QueryClient,
): Promise<TaskMedia> {
  if (variables.message !== undefined) {
    await sendMessage(variables.message);
  }
  const row = await addMedia(variables);
  if (variables.kind === 'video') {
    return attachVideo(row, variables, queryClient);
  }
  try {
    await uploadMediaFile(row.storage_path, variables.uri, variables.mimeType);
  } catch (error: unknown) {
    // The bucket refuses a path whose row has expired meanwhile, in words of
    // its own. Asked again, the registration says so in a key the screen can
    // show; a row still alive hands the bucket's refusal on as it was.
    if (variables.messageId !== undefined) {
      await addMedia(variables);
    }
    throw error;
  }
  return confirmMedia(variables.mediaId);
}

/**
 * A video's upload and confirmation, then its file let go.
 *
 * Resumable (docs/tech-plan.md §7.5): sent in pieces from the address kept in
 * its local record, saying how far it has got as it goes. A row the server
 * already confirmed is a replay after the file was let go — nothing is left
 * to send, and nothing to send it from. Once confirmed, the file is removed
 * from the phone: unlike a photo's, its tile never shows it, and a few
 * videos would fill the phone's memory.
 */
async function attachVideo(
  row: TaskMedia,
  variables: AttachMediaVariables,
  queryClient?: QueryClient,
): Promise<TaskMedia> {
  if (row.uploaded_at === null) {
    await uploadVideoFile({
      mediaId: variables.mediaId,
      storagePath: row.storage_path,
      uri: variables.uri,
      mimeType: variables.mimeType,
      onProgress: (sent, total) => reportUploadProgress(variables.mediaId, sent, total),
    });
  }
  const confirmed = await confirmMedia(variables.mediaId);
  await releaseVideo(variables, queryClient);
  return confirmed;
}

/** The file and its record, gone once the server has the video. Twice is not an error. */
async function releaseVideo(
  variables: AttachMediaVariables,
  queryClient: QueryClient | undefined,
): Promise<void> {
  discardFile(variables.uri);
  clearUploadProgress(variables.mediaId);
  try {
    const store = await forgetLocalMedia(variables.mediaId);
    queryClient?.setQueryData(mediaKeys.local, store);
  } catch (error: unknown) {
    // The video is in and confirmed; a ledger that could not be written only
    // keeps the record of a file that is gone.
    reportError(error);
  }
}

/** Teach the query client how to replay each media action after a restart. */
export function registerMediaMutations(queryClient: QueryClient): void {
  queryClient.setMutationDefaults(mediaMutationKeys.attach, {
    mutationFn: (variables: AttachMediaVariables) => attachMedia(variables, queryClient),
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

export function useProblemMedia(problemId: string) {
  const { userId } = useSession();

  return useQuery({
    queryKey: mediaKeys.byProblem(problemId),
    queryFn: () => fetchProblemMedia(problemId),
    enabled: userId !== null && problemId !== '',
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
    // Never reloaded, so a copy restored from disk is all it has: read it by
    // the store's own rules.
    select: readLocalMediaStore,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** A row as it looks the moment the shutter closes, before the server has it. */
function pendingRow(variables: AttachMediaVariables): TaskMedia {
  return {
    id: variables.mediaId,
    task_id: variables.taskId ?? null,
    step_id: variables.stepId ?? null,
    problem_id: variables.problemId ?? null,
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
    mutationFn: (variables) => attachMedia(variables, queryClient),
    scope: ATTACH_SCOPE,
    retry: ATTACH_RETRIES,
    onMutate: async (variables) => {
      dropFailedAttempts(queryClient, variables.mediaId);
      const key = mediaOwnerKey(variables);
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<TaskMedia[]>(key, (media = []) =>
        media.some((item) => item.id === variables.mediaId)
          ? media
          : [...media, pendingRow(variables)],
      );
    },
    onSuccess: (row, variables) => {
      queryClient.setQueryData<TaskMedia[]>(mediaOwnerKey(variables), (media = []) =>
        media.map((item) => (item.id === row.id ? row : item)),
      );
    },
    onSettled: (_row, _error, variables) => {
      invalidateOwner(queryClient, variables);
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
      dropFailedAttempts(queryClient, variables.mediaId);
      const key = mediaOwnerKey(variables);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskMedia[]>(key);
      queryClient.setQueryData<TaskMedia[]>(key, (media = []) =>
        media.filter((item) => item.id !== variables.mediaId),
      );
      return { previous };
    },
    onError: (_error, variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(mediaOwnerKey(variables), context.previous);
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
      invalidateOwner(queryClient, variables);
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

/** Let go of a capture that was never handed over: the file and the record. */
export function useDiscardLocalMedia() {
  const queryClient = useQueryClient();

  return async (record: LocalMediaRecord): Promise<void> => {
    discardFile(record.uri);
    queryClient.setQueryData(mediaKeys.local, await forgetLocalMedia(record.id));
  };
}

/**
 * What this phone's queue says about the photos of its own messages: still
 * travelling (including paused for lack of signal), refused by the server,
 * or expired. A failed attempt stays in the cache until the app restarts or
 * the photo is retried or removed, so the tile can say which it was.
 */
export function useOwnMediaStates(): OwnMediaStates {
  const entries = useMutationState({
    filters: {
      mutationKey: mediaMutationKeys.attach,
      predicate: (mutation) =>
        mutation.state.status === 'pending' || mutation.state.status === 'error',
    },
    select: (mutation): [string, OwnMediaState] | null => {
      const variables = mutation.state.variables as AttachMediaVariables | undefined;
      if (variables === undefined || variables.messageId === undefined) {
        return null;
      }
      const status: OwnMediaState['status'] =
        mutation.state.status === 'pending'
          ? 'uploading'
          : serverErrorKey(mutation.state.error) === 'serverErrors.messageMediaExpired'
            ? 'expired'
            : 'failed';
      return [variables.mediaId, { messageId: variables.messageId, status }];
    },
  });

  return useMemo(
    () => new Map(entries.filter((entry): entry is [string, OwnMediaState] => entry !== null)),
    [entries],
  );
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
 * Ids of the uploads the queue holds until there is signal again: pending,
 * and paused rather than running. Their tiles say they wait for the network,
 * not that they are uploading.
 */
export function useWaitingMediaIds(): Set<string> {
  const variables = useMutationState({
    filters: {
      mutationKey: mediaMutationKeys.attach,
      status: 'pending',
      predicate: (mutation) => mutation.state.isPaused,
    },
    select: (mutation) => (mutation.state.variables as AttachMediaVariables | undefined)?.mediaId,
  });

  return useMemo(
    () => new Set(variables.filter((id): id is string => typeof id === 'string')),
    [variables],
  );
}

/** How far each video upload of this run has got, by media id (`upload-progress.ts`). */
export function useUploadProgress(): UploadProgress {
  return useSyncExternalStore(subscribeUploadProgress, uploadProgressSnapshot);
}

/**
 * Why the queue gave up on this step's video, or null.
 *
 * A video is handed to the queue by the recording screen, which has gone by
 * the time the server answers; the step's screen did not start the upload and
 * has no mutation of its own to read the refusal from. The queue keeps the
 * failed attempt until a retry or a removal clears it (`dropFailedAttempts`),
 * so the step can say why its tile failed. Only the latest attempt speaks: a
 * video recorded again after a refusal outweighs it. Photos are not read
 * here: the step's screen starts them and reads their refusals itself.
 */
export function useFailedVideoAttach(stepId: string): Error | null {
  // Every attempt of this step's videos, in the order the queue took them.
  const attempts = useMutationState({
    filters: {
      mutationKey: mediaMutationKeys.attach,
      predicate: (mutation) => {
        const variables = mutation.state.variables as AttachMediaVariables | undefined;
        return variables?.stepId === stepId && variables.kind === 'video';
      },
    },
    select: (mutation) => mutation.state.error,
  });

  return attempts.at(-1) ?? null;
}

/**
 * The tiles of one step, in the order the photos were taken.
 *
 * Where the picture comes from: the file on the phone when we still have it,
 * otherwise a signed link. Where the item stands: confirmed by the server,
 * still travelling, or stranded — a row without a file and no upload running
 * for it, which happens when the app was killed mid-upload. A file still
 * travelling also says, when the queue knows, whether it waits for signal and
 * how much of it has gone (a video's resumable upload counts its pieces).
 */
export function mediaItemViews(
  media: readonly TaskMedia[],
  local: Readonly<Record<string, LocalMediaRecord>>,
  urls: Readonly<Record<string, string>>,
  uploading: ReadonlySet<string>,
  transfers: MediaTransfers = {},
): MediaItemView[] {
  return media.map((item) => {
    const view: MediaItemView = {
      id: item.id,
      kind: item.kind,
      uri: local[item.id]?.uri ?? urls[item.storage_path] ?? null,
      status:
        item.uploaded_at !== null ? 'uploaded' : uploading.has(item.id) ? 'uploading' : 'failed',
      durationSec: item.duration_sec,
    };
    if (view.status !== 'uploading') {
      return view;
    }
    return {
      ...view,
      isWaitingForNetwork: transfers.waiting?.has(item.id) === true,
      progress: transfers.progress?.[item.id],
    };
  });
}

/** What the queue knows of the uploads under way, beyond that they are. */
export interface MediaTransfers {
  /** Paused until there is signal (`useWaitingMediaIds`). */
  waiting?: ReadonlySet<string>;
  /** The share of each file sent so far (`useUploadProgress`). */
  progress?: UploadProgress;
}
