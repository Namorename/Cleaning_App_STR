'use client';

import { useState } from 'react';

import { pastChunk } from './dates';

interface PastOptions {
  /** The window's first day: the past is the days before it. */
  start: string;
  /** The window's depth: another depth is another window, and drops the past. */
  depth: number;
  /** The calendar's today: the past reaches sixty days before it. */
  today: string;
  /** False while there is no client to read with. */
  isReady: boolean;
  /** Reads what a chunk's days show; the chunk is shown once it resolves. */
  load: (days: readonly string[]) => Promise<unknown>;
}

export interface CalendarPast {
  /** The days shown before the window, oldest first; none until asked for. */
  days: readonly string[];
  /** A chunk is on its way. */
  isLoading: boolean;
  /** The last chunk did not come. */
  isError: boolean;
  /** Why it did not, as the read handed it over; null when it came, or none was asked. */
  error: unknown;
  /** Sixty days before today is shown: there is no more past to ask for. */
  isAtLimit: boolean;
  /** Asks for the next chunk: once at a time, never past the limit. */
  loadMore: () => void;
  /** Drops the past: «Сегодня» on the window it is already on. */
  reset: () => void;
}

interface PastState {
  /** The window this past belongs to. */
  window: string;
  days: readonly string[];
  /** The chunk on its way, by a token of its own: a late answer for another is dropped. */
  pending: object | null;
  /** The last chunk's failure, boxed: a read may fail with nothing to say. */
  failure: { error: unknown } | null;
}

const emptyFor = (window: string): PastState => ({
  window,
  days: [],
  pending: null,
  failure: null,
});

/**
 * The past of the calendar on demand (the owner's word of 2026-10-10,
 * block 7). By default nothing is held and nothing is read; each ask reads
 * the next chunk (`pastChunk`) and shows it only once its data has come, so
 * a chunk that fails takes nothing away from what is shown and is asked
 * again on the next press. A new window — an arrow, a depth — drops it.
 */
export function useCalendarPast({ start, depth, today, isReady, load }: PastOptions): CalendarPast {
  const windowKey = `${start}/${depth}`;
  const [state, setState] = useState(() => emptyFor(windowKey));
  // The window moved: the past and any chunk on its way go with it.
  const current = state.window === windowKey ? state : emptyFor(windowKey);
  if (state.window !== windowKey) {
    setState(current);
  }

  const next = pastChunk(current.days[0] ?? start, today);

  const loadMore = () => {
    if (!isReady || current.pending !== null || next.length === 0) {
      return;
    }
    const token = {};
    setState({ ...current, pending: token, failure: null });
    load(next).then(
      () =>
        setState((now) =>
          now.pending === token ? { ...now, days: [...next, ...now.days], pending: null } : now,
        ),
      (error: unknown) =>
        setState((now) =>
          now.pending === token ? { ...now, pending: null, failure: { error } } : now,
        ),
    );
  };

  return {
    days: current.days,
    isLoading: current.pending !== null,
    isError: current.failure !== null,
    error: current.failure === null ? null : current.failure.error,
    isAtLimit: next.length === 0,
    loadMore,
    reset: () => setState(emptyFor(windowKey)),
  };
}
