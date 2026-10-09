import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  dehydrate,
  hashKey,
  hydrate,
  type DehydratedState,
  type Mutation,
  type QueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';

import { authorIn, authorOf, setQueuePerson, waitsForSignal } from '@/lib/move-queue';
import {
  QUERY_CACHE_KEY,
  resumeSavedMoves,
  saveCacheNow,
  savedAsWaiting,
} from '@/lib/query-client';
import { reportError } from '@/lib/sentry';

/**
 * The moves waiting on disk for their author (owner's decision of 2026-10-09):
 * the queue of a person who is not the one signed in. Kept apart from the
 * cache, by author, as TanStack saves a move — so none of it is touched by
 * what happens to the cache: no expiry (a «Готово» tapped on Friday is sent
 * whenever its author is back), not the cache buster, not «reset saved lists»
 * (`forgetSavedQueries`), not a sign-out.
 *
 * Written first, dropped from the queue second: an app closed in between
 * leaves a move in both places, never in neither. Each is told apart by its
 * key and what it sends (`hashKey`, as lib/move-retry.ts tells a move), so the
 * copy found twice comes back once.
 */
export const PARKED_MOVES_KEY = `${QUERY_CACHE_KEY}.parked`;

type SavedMove = DehydratedState['mutations'][number];

/** Parked moves, by author. */
type Parked = Readonly<Record<string, readonly SavedMove[]>>;

/** A move as TanStack saves it, read back from disk: enough of it to be restored. */
const savedMoveSchema = z.looseObject({
  mutationKey: z.array(z.unknown()).optional(),
  state: z.looseObject({ status: z.string(), isPaused: z.boolean(), variables: z.unknown() }),
});

const parkedSchema = z.record(z.string(), z.array(z.unknown()));

function identityOf(mutationKey: unknown, variables: unknown): string {
  return hashKey([mutationKey ?? null, variables]);
}

function identityOfSaved(move: SavedMove): string {
  return identityOf(move.mutationKey, move.state.variables);
}

/**
 * What is parked. A store that cannot be read is reported and taken as empty:
 * what cannot be read cannot be restored either. Each move is read like
 * outside input; one that is not a move is dropped.
 */
async function readParked(): Promise<Parked> {
  const raw = await AsyncStorage.getItem(PARKED_MOVES_KEY);
  if (raw === null) {
    return {};
  }
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch (error: unknown) {
    reportError(error);
    return {};
  }
  const parsed = parkedSchema.safeParse(stored);
  if (!parsed.success) {
    reportError(parsed.error);
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsed.data).map(([author, moves]) => [
      author,
      moves.filter((move): move is SavedMove => savedMoveSchema.safeParse(move).success),
    ]),
  );
}

async function writeParked(parked: Parked): Promise<void> {
  await AsyncStorage.setItem(PARKED_MOVES_KEY, JSON.stringify(parked));
}

/** `parked` with `moves` added under their authors, none twice. */
function withParked(parked: Parked, moves: readonly SavedMove[]): Parked {
  return moves.reduce<Parked>((all, move) => {
    const author = authorIn(move.meta);
    if (typeof author !== 'string') {
      return all;
    }
    const kept = all[author] ?? [];
    const isKnown = kept.some((other) => identityOfSaved(other) === identityOfSaved(move));
    return isKnown ? all : { ...all, [author]: [...kept, move] };
  }, parked);
}

/** A move of the queue still to send, made by somebody other than `person`. */
function isSomebodyElses(mutation: Mutation, person: string | null): boolean {
  const author = authorOf(mutation);
  return (
    mutation.state.status === 'pending' &&
    waitsForSignal(mutation) &&
    typeof author === 'string' &&
    author !== person
  );
}

/**
 * Every move of the queue made by somebody other than `person` — waiting or
 * on its way — goes to the disk, saved as waiting, and only then out of the
 * queue. The cache on disk follows with the persister's next write; a copy
 * still there if the app is closed first comes back once. A move on its way
 * when it is parked may still land: its copy is sent again once its author is
 * back, as an idempotent call with the same id.
 */
async function parkMovesNotOf(queryClient: QueryClient, person: string | null): Promise<void> {
  const cache = queryClient.getMutationCache();
  const moves = cache.getAll().filter((mutation) => isSomebodyElses(mutation, person));
  if (moves.length === 0) {
    return;
  }
  const { mutations } = dehydrate(queryClient, {
    shouldDehydrateMutation: (mutation) => moves.includes(mutation),
    shouldDehydrateQuery: () => false,
  });
  await writeParked(withParked(await readParked(), savedAsWaiting(mutations)));
  moves.forEach((mutation) => cache.remove(mutation));
}

/**
 * `person`'s parked moves back in the queue, after any of hers already in it.
 * The cache is on disk with them before the store lets go of them.
 */
async function bringBackMovesOf(queryClient: QueryClient, person: string): Promise<void> {
  const parked = await readParked();
  const theirs = parked[person];
  if (theirs === undefined) {
    return;
  }
  const queued = new Set(
    queryClient
      .getMutationCache()
      .getAll()
      .filter((mutation) => mutation.state.status === 'pending')
      .map((mutation) => identityOf(mutation.options.mutationKey, mutation.state.variables)),
  );
  const fresh = theirs.filter((move) => !queued.has(identityOfSaved(move)));
  hydrate(queryClient, { mutations: [...fresh], queries: [] });
  await saveCacheNow(queryClient);
  await writeParked(
    Object.fromEntries(Object.entries(parked).filter(([author]) => author !== person)),
  );
}

/**
 * The queue sorted for `person`, the one now signed in — or for nobody, null.
 * Every move of anybody else is parked on disk; `person`'s parked moves come
 * back; then hers are resumed, and only hers (`AppQueryClient`). Run by
 * features/auth/forget-on-sign-out.ts in its ordered chain, after the
 * restore and on every change of person, so the lists, the owner stamp and
 * the queue never race.
 *
 * A step the disk refuses is reported and the rest goes on: a move that could
 * not be parked stays in the queue, where it never runs with anybody else's
 * session (lib/move-queue.ts, `AppMutationCache.canRun`), and is parked again
 * at the next change of person or the next start.
 */
export async function settleQueueFor(
  queryClient: QueryClient,
  person: string | null,
): Promise<void> {
  try {
    await parkMovesNotOf(queryClient, person);
  } catch (error: unknown) {
    reportError(error);
  }
  if (person !== null) {
    try {
      await bringBackMovesOf(queryClient, person);
    } catch (error: unknown) {
      reportError(error);
    }
  }
  setQueuePerson(queryClient, person);
  if (person !== null) {
    void resumeSavedMoves(queryClient);
  }
}
