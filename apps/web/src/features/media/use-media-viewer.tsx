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
 * The open file is held by its id, not its place: a list read again with a
 * file added before it keeps the viewer on the same file, and one read
 * without it closes the viewer rather than show another.
 *
 * On close the focus goes back to the thumbnail of the file last shown — the
 * manager may have walked from the third photo to the seventh — or to the one
 * that opened it when that one is gone. Moved once the viewer has left the
 * page: while it is open, the page behind it takes no focus.
 */
export function useMediaViewer(items: readonly ViewerItem[], title?: string): MediaViewerControl {
  const [openedId, setOpenedId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const focusBack = useRef<HTMLElement | null>(null);

  const index = openedId === null ? -1 : items.findIndex((item) => item.id === openedId);
  if (openedId !== null && index < 0) {
    // The file is gone from the list: the viewer closes, and does not come
    // back on its own should the file return.
    setOpenedId(null);
  }

  useEffect(() => {
    if (openedId !== null) {
      return;
    }
    const target = focusBack.current ?? opener.current;
    focusBack.current = null;
    opener.current = null;
    if (target?.isConnected === true) {
      target.focus();
    }
  }, [openedId]);

  const open = (at: number, trigger: HTMLElement) => {
    const item = items[at];
    if (item !== undefined) {
      opener.current = trigger;
      setOpenedId(item.id);
    }
  };
  const close = (itemId: string) => {
    focusBack.current = thumbnailOf(opener.current, itemId) ?? opener.current;
    setOpenedId(null);
  };

  return {
    open,
    element:
      index < 0 ? null : (
        <MediaViewer
          items={items}
          index={index}
          onIndexChange={(to) => {
            const item = items[to];
            if (item !== undefined) {
              setOpenedId(item.id);
            }
          }}
          onClose={close}
          title={title}
        />
      ),
  };
}
