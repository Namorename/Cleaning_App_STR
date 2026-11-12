'use client';

import { useEffect, useRef } from 'react';

interface VideoStageProps {
  /** The signed link the player streams. */
  src: string;
  label: string;
  /** Where to start: where the last link stopped, when it failed mid-way. */
  startAt: number;
  /** The player could not open `src`, having reached `at` seconds. */
  onFailed: (src: string, at: number) => void;
  /** The player opened its link. */
  onOpened: () => void;
}

/**
 * A video played in the viewer, with the browser's own controls: they take
 * the keyboard and speak to a screen reader, and a home-made play button
 * would have to learn both. Nothing plays until the manager presses play.
 *
 * A fresh link after a failure starts where the old one stopped — a link that
 * ran out while the video stood paused for an hour is not a reason to watch
 * it again from 0:00. Closing the viewer, or moving to another file, pauses
 * the player first: a player taken off the page can keep its sound going.
 */
export function VideoStage({ src, label, startAt, onFailed, onOpened }: VideoStageProps) {
  const player = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = player.current;
    return () => video?.pause();
  }, []);

  return (
    <div
      data-viewer-backdrop=""
      className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4"
    >
      <video
        ref={player}
        src={src}
        controls
        playsInline
        preload="metadata"
        aria-label={label}
        className="max-h-full max-w-full bg-black"
        onError={(event) => onFailed(src, event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          if (startAt > 0) {
            event.currentTarget.currentTime = startAt;
          }
          onOpened();
        }}
      />
    </div>
  );
}
