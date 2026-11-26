'use client';

import { useLayoutEffect, useRef, useState, type FocusEvent } from 'react';

import type { ColumnRow } from './schema';
import { useOrderColumns } from './use-boards';

/** A change of the columns' order, counted from the order it meets when its turn comes. */
export interface Reorder {
  /** The column that moves: the one whose new place is said. */
  columnId: string;
  next: (live: readonly ColumnRow[]) => string[];
}

interface ColumnOrderOptions {
  boardId: string;
  /** The board's live columns in their order, as on screen. */
  live: readonly ColumnRow[];
  nameOf: (column: ColumnRow) => string;
  onSuccess: () => void;
  onError: (error: unknown) => void;
}

function isSameOrder(ids: readonly string[], live: readonly ColumnRow[]): boolean {
  return ids.length === live.length && ids.every((id, index) => id === live[index]?.id);
}

/**
 * The order of a board's columns as «Колонки» changes it (20261126120000): one order on its way at
 * a time, each counted from the order the last one made. A press while one is on its way waits its
 * turn — never dropped — and a refusal drops those after it, which counted on it. Every new place
 * is said for a screen reader: «Ждём ответа: 2 / 5».
 */
export function useColumnOrder({ boardId, live, nameOf, onSuccess, onError }: ColumnOrderOptions) {
  const order = useOrderColumns();
  const [announcement, setAnnouncement] = useState('');
  // The order on screen when a waiting press gets its turn: the one the last order made.
  const current = useRef(live);
  const waiting = useRef<readonly Reorder[]>([]);
  const isSending = useRef(false);
  useLayoutEffect(() => {
    current.current = live;
  });

  const send = (move: Reorder) => {
    const ids = move.next(current.current);
    if (isSameOrder(ids, current.current)) {
      sendNext();
      return;
    }
    const column = current.current.find((candidate) => candidate.id === move.columnId);
    if (column !== undefined) {
      setAnnouncement(`${nameOf(column)}: ${ids.indexOf(column.id) + 1} / ${ids.length}`);
    }
    isSending.current = true;
    order.mutate(
      { boardId, columnIds: ids },
      {
        onSuccess,
        onError: (error: unknown) => {
          waiting.current = [];
          onError(error);
        },
        onSettled: () => {
          isSending.current = false;
          sendNext();
        },
      },
    );
  };
  const sendNext = () => {
    const [head, ...rest] = waiting.current;
    waiting.current = rest;
    if (head !== undefined) {
      send(head);
    }
  };

  return {
    reorder: (move: Reorder) => {
      if (isSending.current) {
        waiting.current = [...waiting.current, move];
        return;
      }
      send(move);
    },
    announcement,
  };
}

/** The controls of a column's row that keep the focus through a change. */
export type RowControl = 'up' | 'down' | 'rename';

const OTHER: Readonly<Record<RowControl, RowControl>> = {
  up: 'down',
  down: 'up',
  rename: 'rename',
};

/**
 * Keeps the keyboard where it was through a change of the list: after «Выше» or «Ниже» on the
 * button pressed in the row that moved — the other one when the row reached an end and the pressed
 * one went disabled — and after a name is changed, on «Переименовать». A row moved in the page
 * loses the focus; it is put back each time the list is drawn anew (`renderKey`), until the
 * keyboard goes elsewhere.
 */
export function useRowFocus(renderKey: string) {
  const rows = useRef(new Map<string, HTMLElement>());
  const wanted = useRef<{ columnId: string; control: RowControl } | null>(null);
  const placed = useRef<Element | null>(null);

  useLayoutEffect(() => {
    const request = wanted.current;
    const row = request === null ? undefined : rows.current.get(request.columnId);
    if (request === null || row === undefined) {
      return;
    }
    const pick = (control: RowControl) =>
      row.querySelector<HTMLButtonElement>(`[data-control="${control}"]`);
    const asked = pick(request.control);
    const target = asked === null || asked.disabled ? pick(OTHER[request.control]) : asked;
    if (target !== null && !target.disabled && document.activeElement !== target) {
      placed.current = target;
      target.focus();
    }
  }, [renderKey]);

  return {
    rowRef: (columnId: string) => (element: HTMLElement | null) => {
      if (element === null) {
        rows.current.delete(columnId);
      } else {
        rows.current.set(columnId, element);
      }
    },
    request: (columnId: string, control: RowControl) => {
      wanted.current = { columnId, control };
    },
    /** The keyboard went elsewhere: the focus is no longer put back. */
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (event.target !== placed.current) {
        wanted.current = null;
        placed.current = null;
      }
    },
  };
}
