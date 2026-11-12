'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { MediaViewer } from './media-viewer';
import type { ViewerItem } from './viewer-item';

/** Marks the list a set of thumbnails stands in; each thumbnail carries `data-media-id`. */
export const GALLERY_ATTRIBUTE = 'data-media-gallery';

export interface MediaViewerControl {
  /** Open the viewer on this file; `trigger` is the thumbnail pressed. */
  open: (index: number, trigger: HTMLElement) => void;
  /** The viewer while it is open, to be rendered beside the list. */
  element: ReactNode;
}

/** The thumbnail of `itemId` in the same list as `opener`, if it is still on the page. */
function thumbnailOf(opener: HTMLElement | null, itemId: string): HTMLElement | null {
  const gallery = opener?.closest(`[${GALLERY_ATTRIBUTE}]`);
  if (gallery === null || gallery === undefined) {
    return null;
  }
  const thumbnails = gallery.querySelectorAll<HTMLElement>('[data-media-id]');
  return [...thumbnails].find((thumbnail) => thumbnail.dataset.mediaId === itemId) ?? null;
}

/**
 * A list's way to the viewer: which file is open, and the viewer itself.
 *
 * On close the focus goes back to the thumbnail of the file last shown — the
 * manager may have walked from the third photo to the seventh — or to the one
 * that opened it when that one is gone. Moved once the viewer has left the
 * page: while it is open, the page behind it takes no focus.
 */
export function useMediaViewer(items: readonly ViewerItem[], title?: string): MediaViewerControl {
  const [opened, setOpened] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const focusBack = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (opened === null && focusBack.current !== null) {
      focusBack.current.focus();
      focusBack.current = null;
    }
  }, [opened]);

  const open = (index: number, trigger: HTMLElement) => {
    opener.current = trigger;
    setOpened(index);
  };
  const close = (itemId: string) => {
    focusBack.current = thumbnailOf(opener.current, itemId) ?? opener.current;
    setOpened(null);
  };

  // A list read again may have lost the file the viewer stood on.
  const index = opened !== null && opened < items.length ? opened : null;

  return {
    open,
    element:
      index === null ? null : (
        <MediaViewer
          items={items}
          index={index}
          onIndexChange={setOpened}
          onClose={close}
          title={title}
        />
      ),
  };
}
