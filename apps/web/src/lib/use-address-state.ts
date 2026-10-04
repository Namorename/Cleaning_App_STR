'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

interface AddressView<T> {
  value: T;
  /** The query the value was last squared with. */
  seen: string;
  /** Queries this view wrote that the router has not shown back yet, oldest first. */
  pending: readonly string[];
}

/** Whether the window's address still holds the last query a view wrote. */
function isLastWriteInWindow(pending: readonly string[]): boolean {
  return (
    pending.length > 0 &&
    typeof window !== 'undefined' &&
    window.location.search.slice(1) === pending[pending.length - 1]
  );
}

/**
 * A screen's state kept in its address (5.4: the tab and the filters of
 * «Уборки»): opened from a link, a bookmark, the sign-in page or «Назад», the
 * screen comes back as it was left.
 *
 * The state lives here and the address follows it. A change is written with
 * `history.replaceState` — Next takes that in without asking the server for
 * the page — and replaced, not pushed, so «Назад» leaves the screen instead
 * of walking back through every letter typed into a search.
 *
 * Next shows a written query back through `useSearchParams` a transition
 * later, so a fast typist is ahead of the router: those echoes are matched
 * against what this view wrote and ignored. Any other query — the menu's link
 * to the bare page, «Назад» onto it — is read afresh and wins.
 *
 * An echo is only an echo while the window's address is still this view's
 * last write. The router may skip a write undone before it was shown — type a
 * letter and take it back — and that query then waits in `pending` for an
 * echo that never comes; a link that brings the same query later moves the
 * window's address, so it is read as the foreign address it is.
 *
 * `write` returns the query without its `?`, empty for the screen's defaults,
 * with the same encoding `URLSearchParams` gives it.
 */
export function useAddressState<T>(
  read: (params: URLSearchParams) => T,
  write: (value: T) => string,
): readonly [T, (next: T) => void] {
  const address = useSearchParams().toString();
  const [view, setView] = useState<AddressView<T>>(() => ({
    value: read(new URLSearchParams(address)),
    seen: address,
    pending: [],
  }));

  let current = view;
  if (address !== view.seen) {
    const own = isLastWriteInWindow(view.pending) ? view.pending.indexOf(address) : -1;
    current =
      own === -1
        ? { value: read(new URLSearchParams(address)), seen: address, pending: [] }
        : { value: view.value, seen: address, pending: view.pending.slice(own + 1) };
    setView(current);
  }

  // The path and the anchor are the window's at the moment of writing: the
  // query is all this view owns of the address.
  const update = (next: T) => {
    const search = write(next);
    setView((previous) => ({ ...previous, value: next, pending: [...previous.pending, search] }));
    const { pathname, hash } = window.location;
    window.history.replaceState(null, '', `${pathname}${search === '' ? '' : `?${search}`}${hash}`);
  };

  return [current.value, update] as const;
}
