'use client';

import { useCallback, useEffect } from 'react';

/**
 * The link a press would follow away from this page, inside the panel; null
 * for anything that loses nothing or is not ours to ask about: a link opened
 * in another tab (a modifier, `target`, a download), one down this same page,
 * and one to another site — the page unloads for that, and the browser asks.
 */
function leavingLink(event: MouseEvent): HTMLAnchorElement | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.target instanceof Element)
  ) {
    return null;
  }
  const link = event.target.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement)) {
    return null;
  }
  if ((link.target !== '' && link.target !== '_self') || link.hasAttribute('download')) {
    return null;
  }
  const to = new URL(link.href, window.location.href);
  const here = window.location;
  if (to.origin !== here.origin) {
    return null;
  }
  return to.pathname === here.pathname && to.search === here.search ? null : link;
}

/**
 * Asks before a screen with unsaved changes is left, while `isActive`
 * (the owner's decision of 2026-10-17, the article editor):
 * - a link of the panel: `message`, in the panel's language; «no» keeps the
 *   screen as it is. The press is caught before Next's Link sees it;
 * - the tab closed or reloaded, or another site opened: the browser's own
 *   question — browsers no longer show a page's words there.
 * Returns the question for the screen's own ways out («Назад»): true when
 * there is nothing to lose or the answer was yes.
 *
 * The browser's «Back» is not asked: the App Router has no way to hold it.
 */
export function useLeaveGuard(isActive: boolean, message: string): () => boolean {
  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    const onClick = (event: MouseEvent) => {
      if (leavingLink(event) !== null && !window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome and Edge before 119 asked only when this was set.
      event.returnValue = true;
    };
    // The capture phase on the document runs before any bubbling listener —
    // React's, where Link's onClick moves the address — so a «no» stops it.
    // React's own capture listener on the document was there first: an
    // onClickCapture on the way still sees the press before the question.
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [isActive, message]);

  return useCallback(() => !isActive || window.confirm(message), [isActive, message]);
}
