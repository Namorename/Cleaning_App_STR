'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { useEdgeScroll } from './use-edge-scroll';

/**
 * A board fills the window (owner, 2026-11-26): from `md` up, while a board shows, the shell's
 * `<main>` is the window's height (`h-window`, `app/(panel)/layout.tsx`) and a column of flex
 * boxes; this page takes what its padding leaves, and every box between the page and the board
 * takes what the rows above the board — the header, the filters, the tabs, the summary — and the
 * line under it leave. No height is counted anywhere: the boxes share the window (2026-11-28). The
 * columns scroll each on its own; the page does not grow. The list and the archive under the same
 * tabs show no board, so `<main>` is an ordinary box again and they grow the page as before. Below
 * `md` nothing is held: the columns are as long as their cards and the page scrolls, as it did.
 */
export const BOARD_PAGE_CLASS = 'group/board-page flex min-h-0 flex-1 flex-col gap-4';

/**
 * A box between the page and the board. Never shorter than 16rem while it holds a board: on a short
 * window under tall filters the page scrolls a little rather than the board shrinking to a strip.
 */
export const BOARD_STAGE_CLASS =
  'flex min-h-0 flex-1 flex-col md:group-has-[[data-board-fill]]/board-page:min-h-64';

interface BoardViewportProps {
  /** The columns' grid template: a board knows how many it has. */
  style?: CSSProperties;
  /** Names the grid, for the tests and the styles of a board. */
  slot: string;
  className?: string;
  children: ReactNode;
}

/**
 * The frame a board's columns stand in, for any board: side by side, scrolling sideways inside it
 * when they are wider than the window (decision 14), and on with the dragged card held near its left
 * or right side. From `md` up it is as tall as the page leaves it and the columns are that tall,
 * each scrolling its cards; below it the columns are as long as their cards. A slim margin round
 * the columns keeps the outline of the column a card may go to inside the frame. The frame scrolls,
 * so it is positioned (`relative`): nothing placed absolutely in it hangs on the page.
 */
export function BoardViewport({ style, slot, className, children }: BoardViewportProps) {
  const ref = useRef<HTMLDivElement>(null);
  const edge = useEdgeScroll('x', ref);

  return (
    <div
      ref={ref}
      data-board-fill=""
      onDragOver={edge.over}
      onDragLeave={edge.leave}
      className={cn(BOARD_STAGE_CLASS, 'relative -m-1 overflow-x-auto p-1')}
    >
      <div
        data-slot={slot}
        style={style}
        className={cn(
          'grid min-w-fit flex-1 items-start gap-3 md:min-h-0 md:items-stretch',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
