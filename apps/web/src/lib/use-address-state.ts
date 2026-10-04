'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

interface AddressView<T> {
  value: T;
  /** The query the value was last squared with. */
  seen: string;
  /** Queries this view wrote that the router has not shown back yet, oldest first. */
  pending: readonly string[];
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
 * `write` returns the query without its `?`, empty for the screen's defaults,
 * with the same encoding `URLSearchParams` gives it.
 */
export function useAddressState<T>(
  read: (params: URLSearchParams) => T,
  write: (value: T) => string,
): readonly [T, (next: T) => void] {
  const pathname = usePathname();
  const address = useSearchParams().toString();
  const [view, setView] = useState<AddressView<T>>(() => ({
    value: read(new URLSearchParams(address)),
    seen: address,
    pending: [],
  }));

  let current = view;
  if (address !== view.seen) {
    const own = view.pending.indexOf(address);
    current =
      own === -1
        ? { value: read(new URLSearchParams(address)), seen: address, pending: [] }
        : { value: view.value, seen: address, pending: view.pending.slice(own + 1) };
    setView(current);
  }

  const update = (next: T) => {
    const search = write(next);
    setView((previous) => ({ ...previous, value: next, pending: [...previous.pending, search] }));
    window.history.replaceState(null, '', search === '' ? pathname : `${pathname}?${search}`);
  };

  return [current.value, update] as const;
}
