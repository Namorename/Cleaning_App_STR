/**
 * Under `problems`, so a move of the head technician — which refreshes
 * `problemKeys.all` — refreshes the history he opens next. Keyed by the person,
 * as the board is.
 */
export const historyKeys = {
  events: (userId: string, problemId: string) => ['problems', 'events', userId, problemId] as const,
};
