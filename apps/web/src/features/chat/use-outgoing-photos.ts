'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { serverErrorKey } from '@/lib/server-error';

import type { OutgoingPhotoState, OutgoingPhotoStates } from './message-tiles';
import { useAttachPhoto, useRemovePhoto } from './use-chat';

/** A file picked in the composer and not yet sent. */
export interface PhotoDraft {
  /** The media id, minted with the draft so the whole chain replays under it. */
  id: string;
  file: File;
  /** A `blob:` link for the thumbnail; revoked once the photo is done with. */
  previewUrl: string;
}

/** A photo this panel is sending: its state, plus what it takes to try again. */
interface Outgoing extends OutgoingPhotoState {
  file: File;
  previewUrl: string;
}

/** The one refusal the whole chain answers with once a row has expired. */
const EXPIRED_KEY = 'serverErrors.messageMediaExpired';

export interface OutgoingPhotos {
  states: OutgoingPhotoStates;
  /** Object URLs by media id, so a photo is visible before it has landed. */
  previews: Readonly<Record<string, string>>;
  /** Send the photos of a message the server has just accepted. */
  start: (messageId: string, drafts: readonly PhotoDraft[]) => void;
  retry: (mediaId: string) => void;
  /** Clear a photo: from the server too, when a row was written for it. */
  discard: (mediaId: string, hasRow: boolean) => void;
}

/**
 * The photos on their way out of this panel.
 *
 * Held here rather than in the composer, because a photo outlives the draft it
 * was picked in: the message is sent first and the files follow under its id.
 * A failure leaves the photo here so it can be tried again — and the row it
 * may already have on the server is the hole the reader sees meanwhile.
 */
export function useOutgoingPhotos(): OutgoingPhotos {
  const [outgoing, setOutgoing] = useState<ReadonlyMap<string, Outgoing>>(new Map());
  const attach = useAttachPhoto();
  const remove = useRemovePhoto();

  // What retry() looks up, and what the browser still holds on unmount.
  const live = useRef<ReadonlyMap<string, Outgoing>>(new Map());
  useEffect(() => {
    live.current = outgoing;
  }, [outgoing]);
  useEffect(
    () => () => {
      for (const photo of live.current.values()) {
        URL.revokeObjectURL(photo.previewUrl);
      }
    },
    [],
  );

  const put = useCallback((mediaId: string, status: OutgoingPhotoState['status']) => {
    setOutgoing((current) => {
      const photo = current.get(mediaId);
      if (photo === undefined) {
        return current;
      }
      const next = new Map(current);
      next.set(mediaId, { ...photo, status });
      return next;
    });
  }, []);

  const drop = useCallback((mediaId: string) => {
    setOutgoing((current) => {
      const photo = current.get(mediaId);
      if (photo === undefined) {
        return current;
      }
      // Revoking a link twice is a no-op, so this is safe where React runs an
      // updater more than once.
      URL.revokeObjectURL(photo.previewUrl);
      const next = new Map(current);
      next.delete(mediaId);
      return next;
    });
  }, []);

  const run = useCallback(
    (mediaId: string, messageId: string, file: File) => {
      attach.mutate(
        { mediaId, messageId, file },
        {
          // Done: the row carries its file now and the transcript draws it.
          onSuccess: () => drop(mediaId),
          onError: (error) =>
            put(mediaId, serverErrorKey(error) === EXPIRED_KEY ? 'expired' : 'failed'),
        },
      );
    },
    [attach, drop, put],
  );

  const start = useCallback(
    (messageId: string, drafts: readonly PhotoDraft[]) => {
      setOutgoing((current) => {
        const next = new Map(current);
        for (const draft of drafts) {
          next.set(draft.id, {
            messageId,
            status: 'uploading',
            file: draft.file,
            previewUrl: draft.previewUrl,
          });
        }
        return next;
      });
      for (const draft of drafts) {
        run(draft.id, messageId, draft.file);
      }
    },
    [run],
  );

  const retry = useCallback(
    (mediaId: string) => {
      const photo = live.current.get(mediaId);
      if (photo === undefined) {
        return;
      }
      put(mediaId, 'uploading');
      run(mediaId, photo.messageId, photo.file);
    },
    [put, run],
  );

  const discard = useCallback(
    (mediaId: string, hasRow: boolean) => {
      if (hasRow) {
        // Whatever the server answers, this panel is done with the file. A
        // refusal simply leaves the row, and the transcript says so again.
        remove.mutate(mediaId, { onSettled: () => drop(mediaId) });
        return;
      }
      drop(mediaId);
    },
    [drop, remove],
  );

  const previews = useMemo(
    () => Object.fromEntries([...outgoing].map(([id, photo]) => [id, photo.previewUrl])),
    [outgoing],
  );

  return { states: outgoing, previews, start, retry, discard };
}
