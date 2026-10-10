'use client';

import { useCallback, useRef, type UIEvent, type WheelEvent } from 'react';

import { daysBetween } from './dates';

/**
 * The grid's left edge and the past (the owner's word of 2026-10-10,
 * block 7): the past is asked for at the start of the days, and the days it
 * puts before the window do not move what is on screen.
 */

/**
 * How long the edge waits after a chunk lands: a trackpad's fling runs on for
 * a while, and one fling should bring one chunk, not three (review 2026-10-10).
 */
export const EDGE_QUIET_MS = 700;

/** A wheel that says «further left»: mostly sideways, or Shift with the wheel turned up. */
function isLeftward(event: WheelEvent<HTMLElement>): boolean {
  const isSideways = event.deltaX < 0 && Math.abs(event.deltaX) > Math.abs(event.deltaY);
  return isSideways || (event.shiftKey && event.deltaY < 0);
}

/** The days are wider than the grid: there is a scroll sideways to make at all. */
function canScrollSideways(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth;
}

/**
 * The scroller's handlers that ask for the past: a scroll that lands on the
 * start — the scrollbar dragged there, a trackpad, Shift and the wheel, the
 * keys — and, already at the start, a wheel that pushes further left. A
 * scroll up or down, or one that starts at the start, asks nothing.
 *
 * Only the manager's own scroll counts (review 2026-10-10, HIGH). `settle`
 * takes the position the grid itself set — days put in or dropped — so the
 * scroll event that follows is not read as her reaching the start; a scroll
 * to the start because the days now fit the grid (a wider window) is the
 * browser's, not hers. After a chunk lands the edge waits `EDGE_QUIET_MS`.
 */
export function useLeftEdge(onReachStart: (() => void) | undefined) {
  const lastLeft = useRef(0);
  const quietUntil = useRef(0);

  const settle = useCallback((left: number, didGrow: boolean) => {
    lastLeft.current = left;
    if (didGrow) {
      quietUntil.current = Date.now() + EDGE_QUIET_MS;
    }
  }, []);

  const reach = () => {
    if (Date.now() >= quietUntil.current) {
      onReachStart?.();
    }
  };

  return {
    onScroll: (event: UIEvent<HTMLElement>) => {
      const element = event.currentTarget;
      const left = element.scrollLeft;
      const wasAway = lastLeft.current > 0;
      lastLeft.current = left;
      if (left <= 0 && wasAway && canScrollSideways(element)) {
        reach();
      }
    },
    onWheel: (event: WheelEvent<HTMLElement>) => {
      if (event.currentTarget.scrollLeft <= 0 && isLeftward(event)) {
        reach();
      }
    },
    settle,
  };
}

/** The first and the last day shown. */
export interface DaySpan {
  first: string | undefined;
  last: string | undefined;
}

/**
 * How many days were put before the window (more than zero) or taken from
 * before it (less); zero when the past did not change — nothing did, or
 * another window (an arrow, a depth) moved both ends.
 */
export function pastChange(before: DaySpan, now: DaySpan): number {
  if (
    now.first === undefined ||
    before.first === undefined ||
    before.last !== now.last ||
    before.first === now.first
  ) {
    return 0;
  }
  return daysBetween(now.first, before.first);
}

/**
 * Days put before the window, or taken from before it, leave the days on
 * screen where they were: the scroll moves by their width, so the day under
 * the cursor stays under it. A chunk asked for by a press (`isRevealed`) is
 * brought into view instead: where the whole window fits, keeping the view
 * would leave the press with nothing to show (review 2026-10-10). Another
 * window — an arrow, a depth — leaves the scroll as it was (null).
 */
export function shiftedScroll(
  before: DaySpan,
  now: DaySpan,
  scrollLeft: number,
  dayWidth: number,
  isRevealed = false,
): number | null {
  const added = pastChange(before, now);
  if (added === 0) {
    return null;
  }
  return added > 0 && isRevealed ? 0 : Math.max(0, scrollLeft + added * dayWidth);
}
