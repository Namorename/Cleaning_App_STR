/** What a screen knows about one of its moves: its last failure, and when it was made. */
export interface MoveState {
  error: Error | null;
  /** When the move was last made; 0 when it never was (TanStack's `submittedAt`). */
  submittedAt: number;
}

/**
 * The failure to show on a screen that offers several moves.
 *
 * Each move — take, accept, start, finish — is a mutation of its own and
 * keeps its last error until it is made again. The screen has one line for a
 * failure, and it belongs to the move she made last: an accept refused a
 * minute ago must not stand over the start she has just made, whether that
 * start went through or was refused in its turn.
 */
export function latestMoveError(moves: readonly MoveState[]): Error | null {
  const latest = moves.reduce<MoveState | null>(
    (newest, move) =>
      move.submittedAt > 0 && (newest === null || move.submittedAt > newest.submittedAt)
        ? move
        : newest,
    null,
  );
  return latest?.error ?? null;
}
