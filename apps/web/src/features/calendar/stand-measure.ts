import { useEffect, useRef } from 'react';

/**
 * What the stand's measurement reads (docs/f10-plan.md, §5, 7.6). Nothing here
 * acts off the stand: the calendar passes `isStand` in.
 */

/** Left on the page's timeline once, after the first drawing with every layer. */
export const PAINTED_MARK = 'calendar:painted';

/** The virtualizer's usual margin of rows beyond the window. */
export const DEFAULT_OVERSCAN = 8;

/**
 * Marks the first frame painted after `isDrawn` turns true: the frame is
 * requested once the drawing is committed, and the mark waits for that frame
 * to be painted.
 */
export function useStandPaintMark(isStand: boolean, isDrawn: boolean): void {
  const isMarked = useRef(false);

  useEffect(() => {
    if (!isStand || !isDrawn || isMarked.current) {
      return;
    }
    let pending: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      pending = setTimeout(() => {
        isMarked.current = true;
        performance.mark(PAINTED_MARK);
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(pending);
    };
  }, [isStand, isDrawn]);
}

/** «overscan = count» of the 7.6 matrix: `?overscan=all`, on the stand only. */
export function standOverscan(isStand: boolean, rowCount: number): number {
  if (!isStand || typeof window === 'undefined') {
    return DEFAULT_OVERSCAN;
  }
  return new URLSearchParams(window.location.search).get('overscan') === 'all'
    ? Math.max(rowCount, DEFAULT_OVERSCAN)
    : DEFAULT_OVERSCAN;
}
