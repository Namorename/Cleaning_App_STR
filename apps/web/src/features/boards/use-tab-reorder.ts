'use client';

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';

import { isSameOrder, moveTabBy, tabOrderAfterDrop, type TabSide } from './tab-order';
import { slideOffset, useFlip } from './use-flip';

interface TabReorderOptions {
  /** The tabs in the person's order, as saved or about to be. */
  order: readonly string[];
  /** May the order change now (the boards and her order are read). */
  canReorder: boolean;
  /** A tab's name, for what a screen reader is told. */
  labelOf: (id: string) => string;
  /** A new order, let go. */
  onChange: (next: readonly string[]) => void;
}

/** What a tab of the row listens to. */
export interface TabHandlers {
  draggable: boolean;
  onDragStart: (event: DragEvent<HTMLAnchorElement>) => void;
  onDragOver: (event: DragEvent<HTMLAnchorElement>) => void;
  onDragEnd: () => void;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => void;
  onBlur: () => void;
}

export interface TabReorder {
  /** The order the row shows: the one a drag or the keyboard is making, or the person's. */
  shown: string[];
  dragging: string | null;
  picked: string | null;
  /** The last thing a screen reader is told: a tab picked up, moved, put down or put back. */
  announcement: string;
  nodes: RefObject<Map<string, HTMLElement>>;
  tab: (id: string) => TabHandlers;
  row: {
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
}

/** The side of a tab the pointer is on, by where the tab stands in the layout (not where it slides). */
function sideOf(clientX: number, node: HTMLElement): TabSide {
  const rect = node.getBoundingClientRect();
  const middle = rect.left - slideOffset(node).x + rect.width / 2;
  return clientX < middle ? 'before' : 'after';
}

/**
 * Moving the tabs of a row into another order (owner, 2026-11-26), by native
 * drag and drop — as the cards and the columns move — or from the keyboard.
 * A dragged tab shows its new place as it goes, the others sliding aside
 * (useFlip); it is let go over the row to take it, anywhere else or with
 * Escape to leave the order as it was. Space picks the focused tab up, the
 * arrows (Home, End) move it, Space or Enter puts it down, Escape puts it
 * back, Tab or focus leaving does too. The click a drag leaves behind, and
 * Enter on a picked tab, open nothing. A drag the browser never ends for the
 * row — its tab gone meanwhile — ends at the next press anywhere.
 */
export function useTabReorder({
  order,
  canReorder,
  labelOf,
  onChange,
}: TabReorderOptions): TabReorder {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const nodes = useRef(new Map<string, HTMLElement>());
  // From a drag's start until just after its end: the click a browser may send then opens nothing.
  const justDragged = useRef(false);
  const pickedRef = useRef<string | null>(null);

  const shown = preview ?? [...order];
  useFlip(shown, nodes, dragging !== null || picked !== null);

  const place = (within: readonly string[], id: string) => ({
    name: labelOf(id),
    position: within.indexOf(id) + 1,
    total: within.length,
  });
  const commit = (next: readonly string[]) => {
    if (!isSameOrder(next, order)) {
      onChange(next);
    }
  };
  const pick = (id: string | null) => {
    pickedRef.current = id;
    setPicked(id);
  };
  const endDrag = () => {
    setDragging(null);
    setPreview(null);
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
  };

  useEffect(() => {
    if (dragging === null) {
      return undefined;
    }
    const ends = ['dragend', 'pointerdown'] as const;
    for (const end of ends) {
      window.addEventListener(end, endDrag);
    }
    return () => {
      for (const end of ends) {
        window.removeEventListener(end, endDrag);
      }
    };
  }, [dragging]);

  const startDrag = (event: DragEvent<HTMLAnchorElement>, id: string) => {
    if (!canReorder) {
      event.preventDefault();
      return;
    }
    // Firefox starts a drag only when something is set.
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    justDragged.current = true;
    pick(null);
    setDragging(id);
    setPreview([...order]);
  };

  const dragOverTab = (event: DragEvent<HTMLAnchorElement>, id: string) => {
    if (dragging === null) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (id === dragging) {
      return;
    }
    const node = nodes.current.get(id);
    const side = node === undefined ? 'after' : sideOf(event.clientX, node);
    setPreview((current) => {
      const base = current ?? [...order];
      const next = tabOrderAfterDrop(base, dragging, id, side);
      return isSameOrder(base, next) ? current : next;
    });
  };

  const keyDown = (event: KeyboardEvent<HTMLAnchorElement>, id: string) => {
    if (!canReorder) {
      return;
    }
    if (picked === null) {
      if (event.key === ' ') {
        event.preventDefault();
        pick(id);
        setPreview([...order]);
        setAnnouncement(t('boards.tabPicked', place(order, id)));
      }
      return;
    }
    if (picked !== id) {
      return;
    }
    const base = preview ?? [...order];
    const moveTo = (next: string[]) => {
      event.preventDefault();
      setPreview(next);
      setAnnouncement(t('boards.tabMoved', place(next, id)));
    };
    const putBack = () => {
      pick(null);
      setPreview(null);
    };
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        moveTo(moveTabBy(base, id, -1));
        return;
      case 'ArrowRight':
      case 'ArrowDown':
        moveTo(moveTabBy(base, id, 1));
        return;
      case 'Home':
        moveTo(moveTabBy(base, id, -base.length));
        return;
      case 'End':
        moveTo(moveTabBy(base, id, base.length));
        return;
      case ' ':
      case 'Enter':
        event.preventDefault();
        putBack();
        commit(base);
        setAnnouncement(t('boards.tabDropped', place(base, id)));
        return;
      case 'Escape':
        event.preventDefault();
        putBack();
        setAnnouncement(t('boards.tabCancelled', place(order, id)));
        return;
      case 'Tab':
        putBack();
        return;
      default:
    }
  };

  // Focus that goes elsewhere puts a picked tab back. Checked a moment later: a tab that moves in
  // the row keeps its focus, but the browser may blur it on the way.
  const blur = (id: string) => {
    setTimeout(() => {
      if (pickedRef.current === id && document.activeElement !== nodes.current.get(id)) {
        pick(null);
        setPreview(null);
      }
    }, 0);
  };

  return {
    shown,
    dragging,
    picked,
    announcement,
    nodes,
    tab: (id) => ({
      draggable: canReorder,
      onDragStart: (event) => startDrag(event, id),
      onDragOver: (event) => dragOverTab(event, id),
      onDragEnd: endDrag,
      onClick: (event) => {
        if (justDragged.current || pickedRef.current !== null) {
          event.preventDefault();
        }
      },
      onKeyDown: (event) => keyDown(event, id),
      onBlur: () => blur(id),
    }),
    row: {
      // The row takes the drop anywhere — between the tabs too; the order is the one the drag showed.
      onDragOver: (event) => {
        if (dragging !== null) {
          event.preventDefault();
        }
      },
      onDrop: (event) => {
        if (dragging === null) {
          return;
        }
        event.preventDefault();
        const next = preview;
        const moved = dragging;
        endDrag();
        if (next !== null) {
          commit(next);
          setAnnouncement(t('boards.tabDropped', place(next, moved)));
        }
      },
    },
  };
}
