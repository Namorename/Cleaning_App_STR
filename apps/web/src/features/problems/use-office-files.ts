'use client';

import { ADDITION_MAX_FILES } from '@str-ops/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MediaKind } from '@/features/media/schema';
import { useHostSettings } from '@/features/settings/use-settings';
import { useSupabase } from '@/lib/supabase/use-client';

import { attachOfficeFile } from './additions-api';
import {
  officeFileKind,
  preparePhoto,
  readVideoDuration,
  refusalOf,
  type FileRefusal,
  type VideoLimits,
} from './office-files';

/** Where a picked file is: waiting, on its way, arrived, or failed (kept to try again). */
export type OfficeFileStatus = 'ready' | 'uploading' | 'done' | 'failed';

/** A file the office picked for a task, as it will be sent. */
export interface OfficePick {
  /** The media id, minted with the pick so a retry replays under it. */
  id: string;
  name: string;
  kind: MediaKind;
  file: File;
  /** A `blob:` link of a photo for its thumbnail; null for a video. */
  previewUrl: string | null;
  durationSec: number | null;
  status: OfficeFileStatus;
  error: unknown;
}

/** A file not taken, and why — said under the picker. */
export type PickNote =
  | { name: string; refusal: FileRefusal }
  | { name: string; refusal: { key: 'tooMany'; count: number } };

export interface UploadOutcome {
  done: number;
  failed: number;
}

export interface OfficeFiles {
  /** The batch the files go into; a new one after `reset`. */
  additionId: string;
  picks: readonly OfficePick[];
  notes: readonly PickNote[];
  /** Files are being read (a video's length, a photo redrawn). */
  isPreparing: boolean;
  isUploading: boolean;
  doneCount: number;
  failedCount: number;
  add: (files: readonly File[]) => Promise<void>;
  remove: (id: string) => void;
  /** Send every file not arrived yet, one by one; what failed stays to be tried again. */
  upload: () => Promise<UploadOutcome>;
  /** Forget the picks and start a new batch. */
  reset: () => void;
}

type Prepared = { pick: OfficePick } | { note: PickNote };

async function prepare(file: File, limits: VideoLimits | null): Promise<Prepared> {
  const kind = officeFileKind(file);
  if (kind === null) {
    return { note: { name: file.name, refusal: { key: 'notMedia' } } };
  }
  let sent = file;
  let durationSec: number | null = null;
  if (kind === 'photo') {
    try {
      sent = await preparePhoto(file);
    } catch {
      return { note: { name: file.name, refusal: { key: 'notMedia' } } };
    }
  } else {
    durationSec = await readVideoDuration(file);
  }
  const refusal = refusalOf(sent, kind, durationSec, limits);
  if (refusal !== null) {
    return { note: { name: file.name, refusal } };
  }
  return {
    pick: {
      id: crypto.randomUUID(),
      name: file.name,
      kind,
      file: sent,
      previewUrl: kind === 'photo' ? URL.createObjectURL(sent) : null,
      durationSec,
      status: 'ready',
      error: null,
    },
  };
}

function revoke(picks: readonly OfficePick[]): void {
  for (const pick of picks) {
    if (pick.previewUrl !== null) {
      URL.revokeObjectURL(pick.previewUrl);
    }
  }
}

/**
 * The files the office adds to a task in one go (20261126100000): picked, checked and redrawn
 * here, then sent down the pipeline one by one under the batch's id. A file that fails keeps its
 * place and its error, to be tried again or left out by the manager's choice.
 */
export function useOfficeFiles(problemId: string): OfficeFiles {
  const client = useSupabase();
  const host = useHostSettings();
  const hostData = host.data;
  const limits = useMemo<VideoLimits | null>(
    () =>
      hostData === null || hostData === undefined
        ? null
        : { maxSec: hostData.video_max_sec, maxMb: hostData.video_max_mb },
    [hostData],
  );
  const [additionId, setAdditionId] = useState(() => crypto.randomUUID());
  const [picks, setPicks] = useState<OfficePick[]>([]);
  const [notes, setNotes] = useState<PickNote[]>([]);
  const [isPreparing, setPreparing] = useState(false);
  const [isUploading, setUploading] = useState(false);
  // The picks as the last render saw them, for the sending loop and the clean-up.
  const picksRef = useRef(picks);
  useEffect(() => {
    picksRef.current = picks;
  }, [picks]);

  // The thumbnails' links go with the form; files still being read after it are let go of.
  const isAlive = useRef(true);
  useEffect(() => {
    isAlive.current = true;
    return () => {
      isAlive.current = false;
      revoke(picksRef.current);
    };
  }, []);

  const add = useCallback(
    async (files: readonly File[]) => {
      setPreparing(true);
      try {
        // Only as many as the batch still takes are read at all, one at a time: a photo is
        // decoded whole to be redrawn, and forty of them at once can take a browser tab down.
        const room = Math.max(0, ADDITION_MAX_FILES - picksRef.current.length);
        const taken: OfficePick[] = [];
        const refused: PickNote[] = files.slice(room).map((file) => ({
          name: file.name,
          refusal: { key: 'tooMany' as const, count: ADDITION_MAX_FILES },
        }));
        for (const file of files.slice(0, room)) {
          const item = await prepare(file, limits);
          if ('pick' in item) {
            taken.push(item.pick);
          } else {
            refused.unshift(item.note);
          }
        }
        if (!isAlive.current) {
          revoke(taken);
          return;
        }
        setPicks((current) => [...current, ...taken]);
        setNotes(refused);
      } finally {
        if (isAlive.current) {
          setPreparing(false);
        }
      }
    },
    [limits],
  );

  const remove = useCallback(
    (id: string) => {
      const going = picksRef.current.find((pick) => pick.id === id);
      if (going === undefined || going.status === 'uploading' || going.status === 'done') {
        return;
      }
      revoke([going]);
      // A file that failed may have its row already: taken back, it no longer counts towards
      // the batch's ten. One that never got a row is refused, which changes nothing.
      if (going.status === 'failed') {
        void client.rpc('remove_task_media', { p_id: id }).then(
          () => undefined,
          () => undefined,
        );
      }
      setPicks((current) => current.filter((pick) => pick.id !== id));
    },
    [client],
  );

  const setStatus = (id: string, status: OfficeFileStatus, error: unknown = null) =>
    setPicks((current) =>
      current.map((pick) => (pick.id === id ? { ...pick, status, error } : pick)),
    );

  const upload = useCallback(async (): Promise<UploadOutcome> => {
    setUploading(true);
    let failed = 0;
    let done = 0;
    try {
      for (const pick of picksRef.current) {
        if (pick.status === 'done') {
          done += 1;
          continue;
        }
        setStatus(pick.id, 'uploading');
        try {
          await attachOfficeFile(client, {
            mediaId: pick.id,
            additionId,
            problemId,
            file: pick.file,
            kind: pick.kind,
            durationSec: pick.durationSec,
          });
          done += 1;
          setStatus(pick.id, 'done');
        } catch (error: unknown) {
          failed += 1;
          setStatus(pick.id, 'failed', error);
        }
      }
    } finally {
      setUploading(false);
    }
    return { done, failed };
  }, [additionId, client, problemId]);

  const reset = useCallback(() => {
    revoke(picksRef.current);
    setPicks([]);
    setNotes([]);
    setAdditionId(crypto.randomUUID());
  }, []);

  return {
    additionId,
    picks,
    notes,
    isPreparing,
    isUploading,
    doneCount: picks.filter((pick) => pick.status === 'done').length,
    failedCount: picks.filter((pick) => pick.status === 'failed').length,
    add,
    remove,
    upload,
    reset,
  };
}
