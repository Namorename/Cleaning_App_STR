'use client';

import Link from 'next/link';
import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';

/** How a link to a listing's card is made, and what a plain press on it does. */
interface ListingLinks {
  href: (id: number) => string;
  /** Open the card in place; absent, the link navigates. */
  open?: (id: number) => void;
}

/** Outside the registry a card is reached by its address (`/apartments?listing=<id>`). */
const ListingLinksContext = createContext<ListingLinks>({
  href: (id) => `/apartments?listing=${id}`,
});

/**
 * The registry tells every link to a listing beneath it how to open a card:
 * beside it, keeping its own tab and search, as a step «Назад» walks back.
 */
export const ListingLinksProvider = ListingLinksContext.Provider;

/** A press that means "here": no new tab, no new window, no download. */
function isPlainPress(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

interface ListingLinkProps {
  id: number;
  className?: string;
  /** The listing this link opens is the one already open. */
  isCurrent?: boolean;
  children: ReactNode;
}

/**
 * A link to a listing's card: a real address — it opens in a new tab and can
 * be copied — while a plain press opens the card in place, without asking the
 * server for the page again.
 */
export function ListingLink({ id, className, isCurrent = false, children }: ListingLinkProps) {
  const links = useContext(ListingLinksContext);
  const { open } = links;

  return (
    <Link
      href={links.href(id)}
      className={className}
      data-listing-link={id}
      aria-current={isCurrent ? 'true' : undefined}
      onClick={
        open === undefined
          ? undefined
          : (event) => {
              if (isPlainPress(event)) {
                event.preventDefault();
                open(id);
              }
            }
      }
    >
      {children}
    </Link>
  );
}
