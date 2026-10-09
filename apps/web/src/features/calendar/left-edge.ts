'use client';

import { useRef, type UIEvent, type WheelEvent } from 'react';

import { daysBetween } from './dates';

/**
 * The grid's left edge and the past (the owner's word of 2026-10-10,
 * block 7): the past is asked for at the start of the days, and the days it
 * puts before the window do not move what is on screen.
 */

/** A wheel that says «further left»: mostly sideways, or Shift with the wheel turned up. */
function isLeftward(event: WheelEvent<HTMLElement>): boolean {
  const isSideways = event.deltaX < 0 && Math.abs(event.deltaX) > Math.abs(event.deltaY);
  return isSideways || (event.shiftKey && event.deltaY < 0);
}

/**
 * The scroller's handlers that ask for the past: a scroll that lands on the
 * start — the scrollbar dragged there, a trackpad, Shift and the wheel, the
 * keys — and, already at the start, a wheel that pushes further left. A
 * scroll up or down, or one that starts at the start, asks nothing.
 */
export function useLeftEdge(onReachStart: (() => void) | undefined) {
  const lastLeft = useRef(0);

  return {
    onScroll: (event: UIEvent<HTMLElement>) => {
      const left = event.currentTarget.scrollLeft;
      const wasAway = lastLeft.current > 0;
      lastLeft.current = left;
      if (left <= 0 && wasAway) {
        onReachStart?.();
      }
    },
    onWheel: (event: WheelEvent<HTMLElement>) => {
      if (event.currentTarget.scrollLeft <= 0 && isLeftward(event)) {
        onReachStart?.();
      }
    },
  };
}

/** The first and the last day shown. */
export interface DaySpan {
  first: string | undefined;
  last: string | undefined;
}

/**
 * Days put before the window, or taken from before it, leave the days on
 * screen where they were: the scroll moves by their width, so the day under
 * the cursor stays under it. Another window — an arrow, a depth — moves both
 * ends and leaves the scroll as it was (null).
 */
export function shiftedScroll(
  before: DaySpan,
  now: DaySpan,
  scrollLeft: number,
  dayWidth: number,
): number | null {
  if (
    now.first === undefined ||
    before.first === undefined ||
    before.last !== now.last ||
    before.first === now.first
  ) {
    return null;
  }
  return Math.max(0, scrollLeft + daysBetween(now.first, before.first) * dayWidth);
}
