'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';

import type { BoardStatus, Problem } from './schema';

interface BoardDragOptions {
  /** May this card be dropped on that column? */
  canMove: (problem: Problem, status: BoardStatus) => boolean;
  /** A card dropped where it may go. */
  onMove: (problem: Problem, status: BoardStatus) => void;
  /** A card let go over a column it may not enter: it stays where it was. */
  onRefused: () => void;
}

export interface CardDrag {
  onDragStart: (problem: Problem) => void;
  onDragEnd: () => void;
}

export interface ColumnDrop {
  onDragEnter: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export interface BoardDrag {
  /** The column the dragged card may be dropped on. */
  isDroppable: (status: BoardStatus) => boolean;
  /** The column the dragged card is over, if it may go there. */
  isOver: (status: BoardStatus) => boolean;
  card: CardDrag;
  column: (status: BoardStatus) => ColumnDrop;
}

/**
 * Dragging a card between the board's columns (owner, 05.10). A column takes
 * the card only where `canMove` says so — a browser drops nothing anywhere
 * else — so a card let go over another column is refused when the drag ends.
 *
 * The window hears the end too: a card a refresh moved to another column
 * while it was dragged is a new element, whose dragend never reaches the
 * board, and no column may stay lit after it.
 */
export function useBoardDrag({ canMove, onMove, onRefused }: BoardDragOptions): BoardDrag {
  const [dragging, setDragging] = useState<Problem | null>(null);
  const [over, setOver] = useState<BoardStatus | null>(null);
  // Where the card was last over, and whether a column took it.
  const lastOver = useRef<BoardStatus | null>(null);
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

  const isDroppable = (status: BoardStatus) => dragging !== null && canMove(dragging, status);

  return {
    isDroppable,
    isOver: (status) => over === status && isDroppable(status),
    card: {
      onDragStart: (problem) => {
        lastOver.current = null;
        wasDropped.current = false;
        setDragging(problem);
      },
      onDragEnd: () => {
        const at = lastOver.current;
        if (!wasDropped.current && dragging !== null && at !== null && at !== dragging.status) {
          if (!canMove(dragging, at)) {
            onRefused();
          }
        }
        stop();
      },
    },
    column: (status) => ({
      onDragEnter: () => {
        lastOver.current = status;
      },
      onDragOver: (event) => {
        if (!isDroppable(status)) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move';
        }
        setOver(status);
      },
      onDragLeave: () => setOver((current) => (current === status ? null : current)),
      // A browser drops only where dragover was accepted: anything else is no drop.
      onDrop: (event) => {
        event.preventDefault();
        if (dragging === null || !isDroppable(status)) {
          return;
        }
        wasDropped.current = true;
        const problem = dragging;
        stop();
        onMove(problem, status);
      },
    }),
  };
}
