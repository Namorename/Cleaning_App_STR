import type { MouseEvent } from 'react';

/**
 * A card's link opened in place: a plain left click opens the card over the
 * board through its own address (`openCard`), so «Назад» and the dialog's
 * close walk the same history and the page is not fetched again; a click with
 * a modifier or another button stays the link's own — a new tab, a copy.
 */
export function openPlainly(event: MouseEvent<HTMLElement>, open: (() => void) | undefined): void {
  if (
    open === undefined ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  open();
}
