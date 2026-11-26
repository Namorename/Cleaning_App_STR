'use client';

import { useEffect, useState, type RefObject } from 'react';

/** How near a side of the box the pointer starts to scroll it, in px. */
export const EDGE_ZONE = 48;
/** The most one frame scrolls, in px: the pointer at the side itself, or past it. */
export const EDGE_MAX_STEP = 18;
/**
 * A browser repeats dragover while the pointer rests (every 350 ± 200 ms by the standard, far more
 * often in practice); this long without one, the pointer has gone and the scrolling stops.
 */
const IDLE_MS = 700;

export type EdgeAxis = 'x' | 'y';

/**
 * How far one frame scrolls a box that spans `start`..`end` with the pointer at `position`: back
 * (negative) near the start, on near the end, faster the nearer the side, the most past it, nothing
 * in between. A short box keeps a middle third where nothing scrolls.
 */
export function edgeStep(
  position: number,
  start: number,
  end: number,
  zone: number = EDGE_ZONE,
  max: number = EDGE_MAX_STEP,
): number {
  const reach = Math.min(zone, (end - start) / 3);
  if (reach <= 0) {
    return 0;
  }
  const depth = (into: number) => Math.ceil(max * Math.min(into / reach, 1));
  if (position < start + reach) {
    return -depth(start + reach - position);
  }
  if (position > end - reach) {
    return depth(position - (end - reach));
  }
  return 0;
}

interface Frames {
  request: (run: () => void) => number;
  cancel: (id: number) => void;
  now: () => number;
}

const BROWSER_FRAMES: Frames = {
  request: (run) => window.requestAnimationFrame(run),
  cancel: (id) => window.cancelAnimationFrame(id),
  now: () => performance.now(),
};

export interface EdgeScroller {
  /** A dragover: where the pointer is now. */
  over: (pointer: { clientX: number; clientY: number }) => void;
  /** The pointer left the element that heard `over` (dragleave), the item was dropped, or the drag ended. */
  leave: (event?: { currentTarget: EventTarget | null; relatedTarget: EventTarget | null }) => void;
  stop: () => void;
}

/**
 * Scrolls `box` along `axis` while a dragged item is held near one of its sides: a frame at a time,
 * until the pointer moves off the side, leaves, the box can go no further, or the drag ends.
 * The box itself is read at each frame, so it may come and go.
 */
export function edgeScroller(
  axis: EdgeAxis,
  box: () => HTMLElement | null,
  frames: Frames = BROWSER_FRAMES,
): EdgeScroller {
  let step = 0;
  let frame: number | null = null;
  let lastOver = 0;

  const stop = () => {
    step = 0;
    if (frame !== null) {
      frames.cancel(frame);
      frame = null;
    }
  };

  const tick = () => {
    frame = null;
    const element = box();
    if (element === null || step === 0 || frames.now() - lastOver > IDLE_MS) {
      step = 0;
      return;
    }
    const before = axis === 'y' ? element.scrollTop : element.scrollLeft;
    if (axis === 'y') {
      element.scrollTop = before + step;
    } else {
      element.scrollLeft = before + step;
    }
    const after = axis === 'y' ? element.scrollTop : element.scrollLeft;
    // At its end: nothing more to do until the pointer asks again.
    if (after === before) {
      step = 0;
      return;
    }
    frame = frames.request(tick);
  };

  return {
    over: ({ clientX, clientY }) => {
      const element = box();
      if (element === null) {
        return;
      }
      const rect = element.getBoundingClientRect();
      step =
        axis === 'y'
          ? edgeStep(clientY, rect.top, rect.bottom)
          : edgeStep(clientX, rect.left, rect.right);
      lastOver = frames.now();
      if (step !== 0 && frame === null) {
        frame = frames.request(tick);
      }
    },
    leave: (event) => {
      const into = event?.relatedTarget;
      const from = event?.currentTarget;
      // Moving onto a child of the element is no leaving.
      if (from instanceof Node && into instanceof Node && from.contains(into)) {
        return;
      }
      stop();
    },
    stop,
  };
}

/**
 * `edgeScroller` for a component: one scroller for its life, stopped when a drag ends anywhere —
 * an item a refresh replaced while it was dragged ends its drag on no element of the board.
 */
export function useEdgeScroll(axis: EdgeAxis, box: RefObject<HTMLElement | null>): EdgeScroller {
  const [scroller] = useState(() => edgeScroller(axis, () => box.current));

  useEffect(() => {
    const ends = ['dragend', 'drop'] as const;
    for (const end of ends) {
      window.addEventListener(end, scroller.stop);
    }
    return () => {
      for (const end of ends) {
        window.removeEventListener(end, scroller.stop);
      }
      scroller.stop();
    };
  }, [scroller]);

  return scroller;
}
