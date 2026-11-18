'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';

/**
 * Dragging an item between the columns of a board, for any board: the
 * manager boards use it now (20261118200000); the technicians' board keeps its
 * own `useBoardDrag` (features/problems) until it is moved onto this one.
 *
 * A column takes the item only where `canMove` says so — a browser drops
 * nothing anywhere else — so an item let go over another column is refused
 * when the drag ends. The window hears the end too: an item a refresh moved
 * while it was dragged is a new element, whose dragend never reaches the
 * board, and no column may stay lit after it.
 */
export interface ColumnDrop {
  onDragEnter: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export interface ItemDrag<T> {
  onDragStart: (item: T) => void;
  onDragEnd: () => void;
}

export interface ColumnDrag<T, C extends string> {
  /** The column the dragged item may be dropped on. */
  isDroppable: (column: C) => boolean;
  /** The column the dragged item is over, if it may go there. */
  isOver: (column: C) => boolean;
  item: ItemDrag<T>;
  column: (column: C) => ColumnDrop;
}

interface ColumnDragOptions<T, C extends string> {
  /** The column the item stands in now. */
  columnOf: (item: T) => C;
  /** May this item be dropped on that column? Every other column, by default. */
  canMove?: (item: T, column: C) => boolean;
  /** An item dropped where it may go. */
  onMove: (item: T, column: C) => void;
  /** An item let go over a column it may not enter: it stays where it was. */
  onRefused?: () => void;
}

export function useColumnDrag<T, C extends string>({
  columnOf,
  canMove,
  onMove,
  onRefused,
}: ColumnDragOptions<T, C>): ColumnDrag<T, C> {
  const [dragging, setDragging] = useState<T | null>(null);
  const [over, setOver] = useState<C | null>(null);
  // Where the item was last over, and whether a column took it.
  const lastOver = useRef<C | null>(null);
  const wasDropped = useRef(false);

  const stop = useCallback(() => {
    setDragging(null);
    setOver(null);
  }, []);

  useEffect(() => {
    if (dragging === null) {
      return undefined;
    }
    const ends = ['dragend', 'drop', 'pointerdown'] as const;
    for (const end of ends) {
      window.addEventListener(end, stop);
    }
    return () => {
      for (const end of ends) {
        window.removeEventListener(end, stop);
      }
    };
  }, [dragging, stop]);

  const allowed = (item: T, column: C) =>
    column !== columnOf(item) && (canMove === undefined || canMove(item, column));
  const isDroppable = (column: C) => dragging !== null && allowed(dragging, column);

  return {
    isDroppable,
    isOver: (column) => over === column && isDroppable(column),
    item: {
      onDragStart: (item) => {
        lastOver.current = null;
        wasDropped.current = false;
        setDragging(item);
      },
      onDragEnd: () => {
        const at = lastOver.current;
        if (!wasDropped.current && dragging !== null && at !== null && at !== columnOf(dragging)) {
          if (!allowed(dragging, at)) {
            onRefused?.();
          }
        }
        stop();
      },
    },
    column: (column) => ({
      onDragEnter: () => {
        lastOver.current = column;
      },
      onDragOver: (event) => {
        if (!isDroppable(column)) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move';
        }
        setOver(column);
      },
      onDragLeave: () => setOver((current) => (current === column ? null : current)),
      // A browser drops only where dragover was accepted: anything else is no drop.
      onDrop: (event) => {
        event.preventDefault();
        if (dragging === null || !isDroppable(column)) {
          return;
        }
        wasDropped.current = true;
        const item = dragging;
        stop();
        onMove(item, column);
      },
    }),
  };
}
