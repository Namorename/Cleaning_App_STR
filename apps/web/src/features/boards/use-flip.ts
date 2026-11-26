'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** How long a tab takes to slide into its new place. */
export const FLIP_MS = 180;

interface Point {
  x: number;
  y: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The offset a sliding node is drawn at now, on top of its place in the layout. */
export function slideOffset(node: HTMLElement): Point {
  const transform = getComputedStyle(node).transform;
  const matrix = /^matrix\(([^)]+)\)$/.exec(transform ?? '');
  if (matrix === null) {
    return { x: 0, y: 0 };
  }
  const parts = matrix[1].split(',').map(Number);
  return { x: parts[4] ?? 0, y: parts[5] ?? 0 };
}

/** Where each node stands in the layout, from its parent's corner (so a scroll moves nothing). */
function measure(nodes: ReadonlyMap<string, HTMLElement>): Map<string, Point> {
  const places = new Map<string, Point>();
  for (const [key, node] of nodes) {
    const rect = node.getBoundingClientRect();
    const origin = node.parentElement?.getBoundingClientRect();
    places.set(key, { x: rect.left - (origin?.left ?? 0), y: rect.top - (origin?.top ?? 0) });
  }
  return places;
}

/**
 * One step of the slide, after the order changed: every node is drawn where it stood (where it was
 * being drawn, if it was still sliding) and eased into its new place. Answers the new places.
 */
function flip(
  nodes: ReadonlyMap<string, HTMLElement>,
  before: ReadonlyMap<string, Point>,
  animate: boolean,
): Map<string, Point> {
  const drawnAt = new Map<string, Point>();
  for (const [key, node] of nodes) {
    drawnAt.set(key, animate ? slideOffset(node) : { x: 0, y: 0 });
    node.style.transition = '';
    node.style.transform = '';
  }
  const now = measure(nodes);
  if (!animate) {
    return now;
  }
  const sliding: HTMLElement[] = [];
  for (const [key, node] of nodes) {
    const was = before.get(key);
    const is = now.get(key);
    const offset = drawnAt.get(key);
    if (was === undefined || is === undefined || offset === undefined) {
      continue;
    }
    const dx = was.x + offset.x - is.x;
    const dy = was.y + offset.y - is.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      continue;
    }
    node.style.transform = `translate(${dx}px, ${dy}px)`;
    sliding.push(node);
  }
  if (sliding.length > 0) {
    // Lay the old places out before the slide starts from them.
    void sliding[0].getBoundingClientRect();
    for (const node of sliding) {
      node.style.transition = `transform ${FLIP_MS}ms ease`;
      node.style.transform = '';
    }
  }
  return now;
}

/**
 * Siblings that change places slide there instead of jumping (FLIP): after the
 * order changes, each node is drawn where it stood — where it was being drawn,
 * if it was still sliding — and eased into its new place. Only while
 * `isAnimated` says the person is moving them (a drag, the keyboard); an order
 * that comes from elsewhere, and any order for a person who asked for less
 * motion, takes its places at once.
 */
export function useFlip(
  order: readonly string[],
  nodes: RefObject<Map<string, HTMLElement>>,
  isAnimated: boolean,
): void {
  const places = useRef(new Map<string, Point>());
  const animated = useRef(isAnimated);
  useLayoutEffect(() => {
    animated.current = isAnimated;
  });
  const orderKey = order.join('|');

  useLayoutEffect(() => {
    places.current = flip(
      nodes.current,
      places.current,
      animated.current && !prefersReducedMotion(),
    );
  }, [orderKey, nodes]);

  // A wider or narrower window moves the tabs with no slide: the places are read again.
  useEffect(() => {
    const again = () => {
      places.current = measure(nodes.current);
    };
    window.addEventListener('resize', again);
    return () => window.removeEventListener('resize', again);
  }, [nodes]);
}
