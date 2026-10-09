import {
  Mutation,
  MutationCache,
  type MutationMeta,
  type MutationOptions,
  type MutationState,
  type NetworkMode,
  type QueryClient,
} from '@tanstack/react-query';

/**
 * Whose the queue of moves is (owner's decision of 2026-10-09, MEDIUM-2 of the
 * last review): a move tapped without signal is sent only with the session of
 * the person who made it. On a phone handed from one person to another, the
 * last one's moves wait on disk for their author (lib/parked-moves.ts) — they
 * are never sent with the next one's session, nor with none.
 *
 * Every move records its author, the id of whoever was signed in when it was
 * made, in its `meta` — which TanStack writes to disk with it and gives back
 * on the restore. The id is read from one synchronous source fed by the auth
 * listener (`noteSignedIn`, features/auth/forget-on-sign-out.ts): no network.
 */

/** The key in a move's meta that names its author. */
const AUTHOR_KEY = 'authorId';

/** Who is signed in now, as the auth listener last heard it; null when nobody. */
let signedIn: string | null = null;

/** Called by the auth listener on every event, before anything else is done about it. */
export function noteSignedIn(userId: string | null): void {
  signedIn = userId;
}

export function signedInPerson(): string | null {
  return signedIn;
}

/** As much of a move's options as the queue reads. */
interface MoveOptions {
  meta?: MutationMeta;
  networkMode?: NetworkMode;
}

/** As much of a move as the queue reads; a mutation of any shape is one. */
export interface QueuedMove {
  options: MoveOptions;
}

/**
 * The author a move's meta names: the id of whoever was signed in when it was
 * made; null if nobody was; undefined when it was saved by a build from before
 * moves had authors (1.1.0, 1.2.0 at dab5237).
 */
export function authorIn(meta: unknown): string | null | undefined {
  if (typeof meta !== 'object' || meta === null) {
    return undefined;
  }
  const author = (meta as Record<string, unknown>)[AUTHOR_KEY];
  return typeof author === 'string' || author === null ? author : undefined;
}

export function authorOf(move: QueuedMove): string | null | undefined {
  return authorIn(move.options.meta);
}

function withAuthor<T extends MoveOptions>(options: T, author: string | null): T {
  return { ...options, meta: { ...options.meta, [AUTHOR_KEY]: author } };
}

/**
 * A move that waits for signal and is kept on disk while it waits: every
 * 'offlineFirst' move — the field moves and the uploads. The moves sent at
 * once or not at all ('always': the head technician's hand-out, a language,
 * a password) are not the queue's: they are never paused for an author,
 * parked, or saved on their way.
 */
export function waitsForSignal(move: QueuedMove): boolean {
  return move.options.networkMode !== 'always';
}

/**
 * A move that may run now: one sent at once or not at all, or one of the
 * queue made by the person signed in.
 */
function mayRunNow(move: QueuedMove): boolean {
  return !waitsForSignal(move) || authorOf(move) === signedIn;
}

/** The line a move waits in (TanStack's scope); undefined for a move that waits in none. */
function lineOf(move: Mutation): string | undefined {
  return move.options.scope?.id;
}

/**
 * A move that keeps the author it was given. A screen hands its mutation its
 * own options again on every draw (`MutationObserver.setOptions`), and they do
 * not name the author: taken as they come, the move would reach the disk with
 * nobody's name on it.
 */
class AuthoredMutation<TData, TError, TVariables, TOnMutateResult> extends Mutation<
  TData,
  TError,
  TVariables,
  TOnMutateResult
> {
  override setOptions(options: MutationOptions<TData, TError, TVariables, TOnMutateResult>): void {
    // Unset while the constructor hands over the first options.
    const current = this.options as MoveOptions | undefined;
    const author = authorIn(current?.meta);
    const keepsAuthor = author === undefined || authorIn(options.meta) !== undefined;
    super.setOptions(keepsAuthor ? options : withAuthor(options, author));
  }
}

/**
 * The app's mutation cache: each move is stamped with its author when it is
 * made, and runs only with its author's session.
 *
 * Stamped when built without a state — a new move, made the moment it is
 * built and run (`MutationObserver.mutate`); a move restored from disk is
 * built with the state it was saved in and keeps the author it was saved with.
 * Built as TanStack's own `build` builds, as a mutation that keeps its author.
 *
 * Run only with its author's session: TanStack asks the cache before every
 * try (`canRun`), however the move was set off — resumed, or continued by
 * the move ahead of it in its line (`runNext`). A move that is not the
 * signed-in person's waits instead, paused; parked on disk
 * (lib/parked-moves.ts), it is out of the cache and never runs again from
 * memory: its copy on disk is the one that goes once its author is back.
 *
 * And whose turn it is in a line is decided here, among the moves that may
 * run now (MEDIUM-2 of the review of dab5237..cb747a5). TanStack's own turn is
 * the first move still to send in the line, whoever made it, and its next is
 * the first one paused: somebody else's move the disk refused to park, left
 * ahead in the queue, held every move of the next person's in that line for
 * good. Here it is passed over, and never set off; the order among her own
 * moves is TanStack's, the order they were made in.
 */
export class AppMutationCache extends MutationCache {
  #lastMutationId = 0;

  override build<TData, TError, TVariables, TOnMutateResult>(
    client: QueryClient,
    options: MutationOptions<TData, TError, TVariables, TOnMutateResult>,
    state?: MutationState<TData, TError, TVariables, TOnMutateResult>,
  ): Mutation<TData, TError, TVariables, TOnMutateResult> {
    this.#lastMutationId += 1;
    const authored = state === undefined ? withAuthor(options, signedIn) : options;
    const mutation = new AuthoredMutation<TData, TError, TVariables, TOnMutateResult>({
      client,
      mutationCache: this,
      mutationId: this.#lastMutationId,
      options: client.defaultMutationOptions(authored),
      state,
    });
    this.add(mutation);
    return mutation;
  }

  override canRun(mutation: Parameters<MutationCache['canRun']>[0]): boolean {
    if (!this.getAll().includes(mutation) || !mayRunNow(mutation)) {
      return false;
    }
    const line = lineOf(mutation);
    if (line === undefined) {
      return true;
    }
    // A move just set off is not pending yet: it may start when nothing is ahead of it.
    const first = this.getAll().find(
      (move) => lineOf(move) === line && move.state.status === 'pending' && mayRunNow(move),
    );
    return first === undefined || first === mutation;
  }

  override runNext(mutation: Parameters<MutationCache['runNext']>[0]): Promise<unknown> {
    const line = lineOf(mutation);
    const next =
      line === undefined
        ? undefined
        : this.getAll().find(
            (move) =>
              move !== mutation && lineOf(move) === line && move.state.isPaused && mayRunNow(move),
          );
    return next?.continue() ?? Promise.resolve();
  }
}

/** Whose moves each client's queue holds now; unset until the first session after the restore. */
const queuePeople = new WeakMap<QueryClient, string | null>();

/**
 * The queue of `client` holds `person`'s moves and no one else's (or, null:
 * nobody is signed in). Set once the moves of anybody else are parked and
 * hers are back (lib/parked-moves.ts): from then on hers may be resumed.
 */
export function setQueuePerson(client: QueryClient, person: string | null): void {
  queuePeople.set(client, person);
}

export function queuePersonOf(client: QueryClient): string | null | undefined {
  return queuePeople.get(client);
}

/**
 * The person whose moves may be resumed now: the queue's, once it is known and
 * still the one signed in. Null otherwise — before the first session after the
 * restore, signed out, or a new person whose moves are still being sorted.
 */
export function resumableFor(client: QueryClient): string | null {
  const person = queuePeople.get(client);
  return typeof person === 'string' && person === signedIn ? person : null;
}

/** Parking each client's queue still owes the disk, for the person it is sorted for. */
const owedParkings = new WeakMap<QueryClient, (person: string) => Promise<void>>();

/**
 * The disk refused to park somebody else's moves in `client`'s queue
 * (lib/parked-moves.ts): `park` is tried again at the next resume of the
 * queue (`retryOwedParking`). Until then those moves wait in the queue, and
 * never run (`AppMutationCache`).
 */
export function oweParking(client: QueryClient, park: (person: string) => Promise<void>): void {
  owedParkings.set(client, park);
}

/**
 * The parking `client`'s queue owes the disk, tried again for `person`, the
 * one it is sorted for — once: a try the disk refuses again owes it anew.
 * Not awaited by the resume: the moves it parks never run anyway.
 */
export function retryOwedParking(client: QueryClient, person: string): void {
  const park = owedParkings.get(client);
  if (park === undefined) {
    return;
  }
  owedParkings.delete(client);
  void park(person);
}

/**
 * The moves saved before moves had authors (or made with nobody signed in)
 * become `person`'s: the one the owner stamp names, or with no stamp the first
 * person signed in after the restore (features/auth/forget-on-sign-out.ts).
 */
export function adoptMovesWithoutAuthor(client: QueryClient, person: string): void {
  client
    .getMutationCache()
    .getAll()
    .filter(
      (mutation) =>
        mutation.state.status === 'pending' &&
        waitsForSignal(mutation) &&
        authorOf(mutation) == null,
    )
    .forEach((mutation) => mutation.setOptions(withAuthor(mutation.options, person)));
}
