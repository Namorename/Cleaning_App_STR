import { notFound } from 'next/navigation';

/**
 * Every address the panel has no page for. Without it Next answers with its
 * root 404, outside the panel's shell; through here the 404 is the panel's
 * own (`../not-found.tsx`), under the menu. Real pages and the files of
 * `public/` are matched before a catch-all, and the layout's role check still
 * runs first.
 */
export default function MissingPage(): never {
  notFound();
}
