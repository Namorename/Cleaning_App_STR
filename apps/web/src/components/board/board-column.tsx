'use client';

import type { CSSProperties, ReactNode, Ref } from 'react';

import { cn } from '@/lib/utils';

import type { ColumnDrop } from './use-column-drag';

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
  /** Under the items: «Показать ещё», a quick add. */
  footer?: ReactNode;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

/**
 * One column of a board, for any board (the manager boards now; written so
 * the technicians' board can take it later): the tone stripe, the head with
 * its count, the items or the line that says there are none, and what goes
 * under them. While an item is dragged, the column it may go to is outlined
 * in the primary colour, dashed; the item over it turns the outline solid
 * (the review of 05.10: a faint ring alone was below 3:1).
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
  children,
  ref,
}: BoardColumnFrameProps) {
  const isEmpty = count === 0;
  return (
    <section
      ref={ref}
      aria-label={label}
      onDragEnter={drop?.onDragEnter}
      onDragOver={drop?.onDragOver}
      onDragLeave={drop?.onDragLeave}
      onDrop={drop?.onDrop}
      data-droppable={isDroppable ? 'true' : undefined}
      className={cn(
        'flex min-h-32 flex-col gap-2 rounded-lg bg-muted/40 p-2 transition-colors',
        isDroppable && 'outline-2 outline-offset-2 outline-primary',
        isDroppable && (isOver ? 'bg-accent outline-solid' : 'outline-dashed'),
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-1 rounded-full', markClassName)}
        style={markStyle}
      />
      <header className="flex items-center justify-between gap-2 px-1">
        {heading}
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">{count}</span>
      </header>
      {isEmpty ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        children
      )}
      {footer}
    </section>
  );
}
