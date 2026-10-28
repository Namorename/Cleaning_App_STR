import type { DehydratedState } from '@tanstack/react-query';
import type { PersistedClient } from '@tanstack/react-query-persist-client';

import { mediaKeys } from './keys';
import { storedMediaPath } from './media-path';

type SavedMove = DehydratedState['mutations'][number];

const LOCAL_KEY = JSON.stringify(mediaKeys.local);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One saved mention of a file: its `uri` by its place; anything else as it was. */
function withStoredUri(value: unknown): unknown {
  if (!isRecord(value) || typeof value.uri !== 'string') {
    return value;
  }
  const uri = storedMediaPath(value.uri);
  return uri === value.uri ? value : { ...value, uri };
}

/**
 * What a saved move sends, with each file it names by its place: an upload's
 * own file (`AttachMediaVariables.uri`), a report's photos
 * (`ReportWithPhotosVariables.photos`). Every other move has neither.
 */
function withStoredVariables(variables: unknown): unknown {
  const own = withStoredUri(variables);
  if (!isRecord(own) || !Array.isArray(own.photos)) {
    return own;
  }
  const photos: unknown[] = own.photos;
  const moved = photos.map(withStoredUri);
  return moved.every((photo, index) => photo === photos[index]) ? own : { ...own, photos: moved };
}

/**
 * Saved moves with every file named by its place in the documents (iPhone
 * risk 1, docs/ios-first-device-checklist.md): a build before this one saved
 * the full path of its install, which a new build on an iPhone may not run in.
 * One rule for the queue restored from disk and for the moves parked for their
 * author (lib/parked-moves.ts), so a move found in both still reads as one.
 * Anything that is not a file is handed on as it was.
 */
export function storedMediaPathsOfMoves(moves: readonly SavedMove[]): SavedMove[] {
  return moves.map((move) => {
    const state: unknown = (move as { state?: unknown }).state;
    if (!isRecord(state)) {
      return move;
    }
    const variables = withStoredVariables(state.variables);
    return variables === state.variables ? move : { ...move, state: { ...move.state, variables } };
  });
}

/** The query cache's copy of the ledger of captures, its files by their places. */
function withStoredLocalCopy(query: unknown): unknown {
  if (!isRecord(query) || JSON.stringify(query.queryKey) !== LOCAL_KEY) {
    return query;
  }
  const { state } = query;
  if (!isRecord(state) || !isRecord(state.data)) {
    return query;
  }
  const data = Object.fromEntries(
    Object.entries(state.data).map(([id, record]) => [id, withStoredUri(record)]),
  );
  return { ...query, state: { ...state, data } };
}

/**
 * The cache saved on disk as the restore is to see it: the upload queue and
 * the ledger's copy with every file by its place in the documents. A cache of
 * another shape is handed on as it was, for the restore to decide.
 */
export function withStoredMediaPaths(
  saved: PersistedClient | undefined,
): PersistedClient | undefined {
  if (saved === undefined || !isRecord(saved.clientState)) {
    return saved;
  }
  const { mutations, queries }: { mutations?: unknown; queries?: unknown } = saved.clientState;
  return {
    ...saved,
    clientState: {
      ...saved.clientState,
      ...(Array.isArray(mutations) ? { mutations: storedMediaPathsOfMoves(mutations) } : {}),
      ...(Array.isArray(queries)
        ? { queries: queries.map(withStoredLocalCopy) as DehydratedState['queries'] }
        : {}),
    },
  };
}
