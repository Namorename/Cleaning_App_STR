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

import {
  authorIn,
  authorOf,
  oweParking,
  resumableFor,
  setQueuePerson,
  waitsForSignal,
} from '@/lib/move-queue';
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
 * leaves a move in both places, never in neither. The copy found twice comes
 * back once (`identityOf`).
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

/**
 * One move, wherever it is found: its key, what it sends, and when it was
 * tapped. TanStack stamps `submittedAt` once, when the move is set off; saving
 * it as waiting, parking it and restoring it keep the stamp — so the copy of
 * one move in the queue and in the store is the same move, a move saved by an
 * older build included. Two taps that send the same are two moves (MEDIUM-1 of
 * the review of dab5237..cb747a5): her push switched off, on and off again is
 * three choices, and the last one stands.
 */
function identityOf(mutationKey: unknown, variables: unknown, submittedAt: unknown): string {
  return hashKey([mutationKey ?? null, variables, submittedAt ?? null]);
}

function identityOfSaved(move: SavedMove): string {
  return identityOf(move.mutationKey, move.state.variables, move.state.submittedAt);
}

function identityOfQueued(mutation: Mutation): string {
  return identityOf(
    mutation.options.mutationKey,
    mutation.state.variables,
    mutation.state.submittedAt,
  );
}

/**
 * Where the text of a store that could not be read is kept before the store
 * is written over: the latest such text, so it never grows.
 */
const UNREADABLE_PARKED_KEY = `${PARKED_MOVES_KEY}.unreadable`;

/** The store as read: its moves, and its text when not all of it could be read. */
interface ParkedStore {
  parked: Parked;
  unreadable: string | null;
}

/**
 * What is parked. A store that cannot be read is reported and taken as empty:
 * what cannot be read cannot be restored either. Each move is read like
 * outside input; one that is not a move is dropped.
 */
async function readParked(): Promise<ParkedStore> {
  const raw = await AsyncStorage.getItem(PARKED_MOVES_KEY);
  if (raw === null) {
    return { parked: {}, unreadable: null };
  }
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch (error: unknown) {
    reportError(error);
    return { parked: {}, unreadable: raw };
  }
  const parsed = parkedSchema.safeParse(stored);
  if (!parsed.success) {
    reportError(parsed.error);
    return { parked: {}, unreadable: raw };
  }
  const entries = Object.entries(parsed.data);
  const parked = Object.fromEntries(
    entries.map(([author, moves]) => [
      author,
      moves.filter((move): move is SavedMove => savedMoveSchema.safeParse(move).success),
    ]),
  );
  const isWhole = entries.every(([author, moves]) => parked[author].length === moves.length);
  return { parked, unreadable: isWhole ? null : raw };
}

/**
 * `parked` written over the store `read` came from. A store that could not be
 * read whole held every other author's moves, or some of them: its text is
 * kept aside first (LOW-3 of the review of dab5237..cb747a5), and a disk that
 * refuses to keep it leaves the store as it was.
 */
async function writeParked(read: ParkedStore, parked: Parked): Promise<void> {
  if (read.unreadable !== null) {
    await AsyncStorage.setItem(UNREADABLE_PARKED_KEY, read.unreadable);
  }
  await AsyncStorage.setItem(PARKED_MOVES_KEY, JSON.stringify(parked));
}

/** The store's last step, settled either way: the next one waits for it. */
let storeTurn: Promise<unknown> = Promise.resolve();

/**
 * One step on the store, after the steps before it. Each reads the store,
 * changes it and writes it back; a sort and a retry of a parking the disk
 * refused (`parkLeftovers`) may overlap, and two at once would each write
 * over what the other added.
 */
function inTurn(step: () => Promise<void>): Promise<void> {
  const done = storeTurn.then(step);
  storeTurn = done.catch(() => undefined);
  return done;
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
 * Whom a parking is for, read when its step on the store runs: a person, or
 * nobody (null — every move with an author is parked); undefined when there is
 * nobody to park for yet, and the step does nothing.
 */
type ParkingFor = () => string | null | undefined;

/**
 * Whom a parking owed is for when its turn comes: the person the queue is
 * sorted for, while she is still the one signed in (`resumableFor`). Read
 * then, not when the retry was asked for (the review of 7553530..8a58d77,
 * LOW): asked for at his resume and run once she had signed in, it parked her
 * fresh moves, and her sort brought them straight back. In the middle of a
 * change of person there is nobody yet: the sort for the next one parks
 * everybody else's itself.
 */
function sortedPersonNow(queryClient: QueryClient): string | undefined {
  return resumableFor(queryClient) ?? undefined;
}

/**
 * Every move of the queue made by somebody other than the person `parkingFor`
 * names when the step runs — waiting or on its way — goes to the disk, saved
 * as waiting, and only then out of the queue. The cache on disk follows with
 * the persister's next write; a copy still there if the app is closed first
 * comes back once. A move on its way when it is parked may still land: its
 * copy is sent again once its author is back, as an idempotent call with the
 * same id.
 */
function parkMovesNotOf(queryClient: QueryClient, parkingFor: ParkingFor): Promise<void> {
  return inTurn(async () => {
    const person = parkingFor();
    if (person === undefined) {
      return;
    }
    const cache = queryClient.getMutationCache();
    const moves = cache.getAll().filter((mutation) => isSomebodyElses(mutation, person));
    if (moves.length === 0) {
      return;
    }
    const { mutations } = dehydrate(queryClient, {
      shouldDehydrateMutation: (mutation) => moves.includes(mutation),
      shouldDehydrateQuery: () => false,
    });
    const store = await readParked();
    await writeParked(store, withParked(store.parked, savedAsWaiting(mutations)));
    moves.forEach((mutation) => cache.remove(mutation));
  });
}

/**
 * Every move of anybody but the person `parkingFor` names parked
 * (`parkMovesNotOf`). One the disk refuses — full of videos, say — is
 * reported and stays in the queue, where it never runs and holds no line of
 * hers (lib/move-queue.ts, `AppMutationCache`); its parking is owed, and tried
 * again at the next resume of the queue (`retryOwedParking`), for whoever the
 * queue is sorted for then (`sortedPersonNow`), and at the next sort.
 */
async function parkLeftovers(queryClient: QueryClient, parkingFor: ParkingFor): Promise<void> {
  try {
    await parkMovesNotOf(queryClient, parkingFor);
  } catch (error: unknown) {
    reportError(error);
    oweParking(queryClient, () => parkLeftovers(queryClient, () => sortedPersonNow(queryClient)));
  }
}

/**
 * `person`'s parked moves back in the queue, after any of hers already in it.
 * The cache is on disk with them before the store lets go of them.
 */
function bringBackMovesOf(queryClient: QueryClient, person: string): Promise<void> {
  return inTurn(async () => {
    const store = await readParked();
    const theirs = store.parked[person];
    if (theirs === undefined) {
      return;
    }
    const queued = new Set(
      queryClient
        .getMutationCache()
        .getAll()
        .filter((mutation) => mutation.state.status === 'pending')
        .map(identityOfQueued),
    );
    const fresh = theirs.filter((move) => !queued.has(identityOfSaved(move)));
    hydrate(queryClient, { mutations: [...fresh], queries: [] });
    await saveCacheNow(queryClient);
    await writeParked(
      store,
      Object.fromEntries(Object.entries(store.parked).filter(([author]) => author !== person)),
    );
  });
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
 * session nor holds a line of hers (lib/move-queue.ts, `AppMutationCache`),
 * and is parked again at the next resume of the queue, the next change of
 * person or the next start (`parkLeftovers`).
 */
export async function settleQueueFor(
  queryClient: QueryClient,
  person: string | null,
): Promise<void> {
  await parkLeftovers(queryClient, () => person);
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
