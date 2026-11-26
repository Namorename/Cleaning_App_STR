'use client';

import {
  useRef,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';

import { cn } from '@/lib/utils';

import type { ColumnDrop } from './use-column-drag';
import { useEdgeScroll } from './use-edge-scroll';

interface BoardColumnFrameProps {
  /** The column's name, for the region a screen reader lands on. */
  label: string;
  /** What heads the column: its badge. */
  heading: ReactNode;
  /** The tone stripe above the head (a `bg-tone-*-mark` class, or a colour's swatch class). */
  markClassName: string;
  /** The colour variables a swatch class reads (cardColorStyle), for a column with its own colour. */
  markStyle?: CSSProperties;
  /** The count in the head: every item of the column, shown or not. */
  count: number;
  /** The dragged item may be dropped here. */
  isDroppable?: boolean;
  /** The dragged item is over this column, and may be dropped here. */
  isOver?: boolean;
  drop?: ColumnDrop;
  /** Said in place of the items when there are none. */
  emptyText: string;
  /** Under the scrolling items, always in sight: a quick add. */
  footer?: ReactNode;
  /** The box the items stand in, the one that scrolls: «Показать ещё» finds the items under it. */
  listRef?: RefObject<HTMLDivElement | null>;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

/**
 * One column of a board, for any board — the manager boards and the technicians' board: the tone
 * stripe, the head with its count, the items or the line that says there are none, and what goes
 * under them. While an item is dragged, the column it may go to is outlined in the primary colour,
 * dashed; the item over it turns the outline solid (the review of 05.10: a faint ring alone was
 * below 3:1).
 *
 * The items scroll on their own (owner, 2026-11-26): the stripe, the head and the footer stay in
 * sight, and the column is as tall as its board lets it (`BoardViewport`). A dragged item held near
 * the top or the bottom of the column — over its head or its footer too — scrolls it. A slim inner
 * margin keeps the focus ring of the first and the last card inside the scrolling box, and the room
 * of the scrollbar is kept in every column, so the cards are as wide in a long column as in a short.
 */
export function BoardColumnFrame({
  label,
  heading,
  markClassName,
  markStyle,
  count,
  isDroppable = false,
  isOver = false,
  drop,
  emptyText,
  footer,
  listRef,
  children,
  ref,
}: BoardColumnFrameProps) {
  const ownList = useRef<HTMLDivElement>(null);
  const list = listRef ?? ownList;
  const edge = useEdgeScroll('y', list);
  const isEmpty = count === 0;

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    edge.over(event);
    drop?.onDragOver(event);
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    edge.leave(event);
    drop?.onDragLeave();
  };

  return (
    <section
      ref={ref}
      aria-label={label}
      onDragEnter={drop?.onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={drop?.onDrop}
      data-droppable={isDroppable ? 'true' : undefined}
      className={cn(
        'flex min-h-32 min-w-0 flex-col gap-2 rounded-lg bg-muted/40 p-2 transition-colors',
        isDroppable && 'outline-2 outline-offset-2 outline-primary',
        isDroppable && (isOver ? 'bg-accent outline-solid' : 'outline-dashed'),
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-1 shrink-0 rounded-full', markClassName)}
        style={markStyle}
      />
      <header className="flex shrink-0 items-center justify-between gap-2 px-1">
        {heading}
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">{count}</span>
      </header>
      <div
        ref={list}
        data-slot="board-column-items"
        className="-m-1 flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto p-1 md:[scrollbar-gutter:stable]"
      >
        {isEmpty ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          children
        )}
      </div>
      {footer === undefined || footer === null ? null : <div className="shrink-0">{footer}</div>}
    </section>
  );
}
