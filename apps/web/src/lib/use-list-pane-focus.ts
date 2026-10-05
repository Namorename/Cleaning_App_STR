'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Tailwind's `xl`: from here a list and the entry it opened stand side by side. */
export const SIDE_BY_SIDE = '(min-width: 80rem)';

/** Whether the two fit side by side now; a browser with no media queries is narrow. */
export function isSideBySide(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(SIDE_BY_SIDE).matches;
}

interface ListPaneFocus {
  /** The block of the list: hidden below xl while an entry is open. */
  listRef: RefObject<HTMLDivElement | null>;
  /** The block of the open entry: hidden below xl while none is. */
  paneRef: RefObject<HTMLDivElement | null>;
  /** Call as an entry is opened from the list, before the address changes. */
  noteOpening: () => void;
  /** For the entry's heading, asked once as it appears: true hands it the focus. */
  claimHeadingFocus: () => boolean;
}

/**
 * Where the keyboard's place goes on a screen of a list and the entry it
 * opened beside it («Объекты», «Заявки»; 5.4, variant B).
 *
 * From xl both stand side by side and the focus stays where it is. Below it
 * there is room for one: the block that held the focus is hidden when the
 * other shows, and the focus would fall into the body (the review of 04.10).
 * Opening an entry from the list hands it to the entry's heading; closing one
 * — by the pane's own way back or «Назад» — hands it back to that entry's
 * link in the list, found by `linkAttribute` (`data-listing-link="101"`), and
 * to the list's search when the list does not show it. Only when the focus
 * was in the block being hidden, or lost already.
 */
export function useListPaneFocus(
  open: string | number | null,
  linkAttribute: string,
): ListPaneFocus {
  const listRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const headingFocus = useRef(false);
  const shown = useRef(open);

  const claimHeadingFocus = useCallback(() => {
    const isClaimed = headingFocus.current;
    headingFocus.current = false;
    return isClaimed;
  }, []);

  const noteOpening = useCallback(() => {
    headingFocus.current =
      !isSideBySide() && listRef.current?.contains(document.activeElement) === true;
  }, []);

  useEffect(() => {
    const closed = shown.current;
    shown.current = open;
    if (closed === null || open !== null || isSideBySide()) {
      return;
    }
    const active = document.activeElement;
    const isLost =
      active === null || active === document.body || paneRef.current?.contains(active) === true;
    if (!isLost) {
      return;
    }
    const list = listRef.current;
    const target =
      list?.querySelector<HTMLElement>(`[${linkAttribute}="${closed}"]`) ??
      list?.querySelector<HTMLElement>('input[type="search"]');
    target?.focus();
  }, [open, linkAttribute]);

  return { listRef, paneRef, noteOpening, claimHeadingFocus };
}
