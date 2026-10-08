'use client';

import Link from 'next/link';
import type { ComponentProps, MouseEvent } from 'react';

/** A press that means "here": no new tab, no new window, no download. */
function isPlainPress(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

interface InPlaceLinkProps extends Omit<ComponentProps<typeof Link>, 'href' | 'onClick'> {
  href: string;
  /** Open the entry in place; absent, the link navigates. */
  onOpen?: () => void;
  /** The entry this link opens is the one already open. */
  isCurrent?: boolean;
  /** How the open one is announced: an entry of a list, or a page of a submenu. */
  currentAs?: 'true' | 'page';
}

/**
 * A link to an entry a screen opens beside its list (5.4, variant B): a real
 * address — it opens in a new tab and can be copied — while a plain press
 * opens the entry in place, without asking the server for the page again.
 * Ctrl, Cmd, Shift and the middle button are left to the browser.
 */
export function InPlaceLink({
  onOpen,
  isCurrent = false,
  currentAs = 'true',
  ...props
}: InPlaceLinkProps) {
  return (
    <Link
      {...props}
      aria-current={isCurrent ? currentAs : undefined}
      onClick={
        onOpen === undefined
          ? undefined
          : (event) => {
              if (isPlainPress(event)) {
                event.preventDefault();
                onOpen();
              }
            }
      }
    />
  );
}
