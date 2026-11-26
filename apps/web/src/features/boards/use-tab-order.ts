'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { serverErrorText, type ServerErrorText } from '@/lib/server-error';
import { useSupabase } from '@/lib/supabase/use-client';

import { applyTabOrder } from './tab-order';
import { fetchBoardTabOrder, saveBoardTabOrder } from './tab-order-api';

/** How long after the last move the order is saved: a few moves in a row are one save. */
export const TAB_ORDER_SAVE_DELAY_MS = 600;
/**
 * A person's own order, under her id: a browser where another person signs in next reads hers
 * afresh. Apart from the boards' keys, so no write to a board reads it again.
 */
export const tabOrderKey = (viewerId: string) => ['board-tab-order', viewerId] as const;
const READ_AGAIN_AFTER_MS = 5 * 60_000;

export interface BoardTabOrder {
  /** The tabs the person has, in her order: what the row shows. */
  order: string[];
  /**
   * Her order has been read (she may have none): only then may it change — a move made on the
   * default order before hers arrived would overwrite hers. Never, when it cannot be read.
   */
  isReady: boolean;
  /** A new order of the tabs: shown at once, saved a moment later. */
  change: (next: readonly string[]) => void;
  /** Why the last save failed; the order shown is the saved one again. */
  failure: ServerErrorText | null;
}

/**
 * The person's own order of the board tabs (20261126160000), applied to the
 * tabs she has now (`applyTabOrder`). A change shows at once and is saved
 * TAB_ORDER_SAVE_DELAY_MS after the last one; a save that fails puts the saved
 * order back and says why. Saves go one after another, so the server keeps
 * the last. Unread, or unreadable (no table yet, no network), the tabs stand
 * in the default order. Leaving the page — or hiding it, which a closed tab
 * does first — saves what waits.
 */
export function useBoardTabOrder(viewerId: string, tabs: readonly string[]): BoardTabOrder {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const key = tabOrderKey(viewerId);
  const saved = useQuery({
    queryKey: key,
    queryFn: () => fetchBoardTabOrder(client),
    staleTime: READ_AGAIN_AFTER_MS,
  });
  const [local, setLocal] = useState<readonly string[] | null>(null);
  const [failure, setFailure] = useState<ServerErrorText | null>(null);
  // Every change counts up; only the answer to the latest one decides what shows.
  const generation = useRef(0);
  // The newest change whose save the server confirmed: an older answer never overwrites it.
  const confirmed = useRef(0);
  const waiting = useRef<readonly string[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);
  // The saves in flight, one after another.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const send = (tabIds: readonly string[], change: number) => {
    const save = queue.current.catch(() => undefined).then(() => saveBoardTabOrder(client, tabIds));
    queue.current = save;
    save.then(
      (stored) => {
        if (change > confirmed.current) {
          confirmed.current = change;
          queryClient.setQueryData(key, stored);
        }
        if (change === generation.current && isMounted.current) {
          setLocal(null);
        }
      },
      (error: unknown) => {
        // A later change is on its way: its own save decides.
        if (change !== generation.current || !isMounted.current) {
          return;
        }
        setLocal(null);
        setFailure(serverErrorText(error));
      },
    );
  };
  // The timer and the unmount call the send of the latest render: the client may be a new object.
  const sendLatest = useRef(send);
  useLayoutEffect(() => {
    sendLatest.current = send;
  });

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const tabIds = waiting.current;
    waiting.current = null;
    if (tabIds !== null) {
      sendLatest.current(tabIds, generation.current);
    }
  }, []);

  const change = useCallback(
    (next: readonly string[]) => {
      generation.current += 1;
      waiting.current = next;
      setLocal(next);
      setFailure(null);
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(flush, TAB_ORDER_SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    isMounted.current = true;
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      isMounted.current = false;
      flush();
    };
  }, [flush]);

  return {
    order: applyTabOrder(local ?? saved.data ?? null, tabs),
    isReady: saved.isSuccess,
    change,
    failure,
  };
}
