'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { InPlaceLink } from '@/components/in-place-link';

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
  const { href, open } = useContext(ListingLinksContext);

  return (
    <InPlaceLink
      href={href(id)}
      className={className}
      data-listing-link={id}
      isCurrent={isCurrent}
      onOpen={open === undefined ? undefined : () => open(id)}
    >
      {children}
    </InPlaceLink>
  );
}
