'use client';

import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { formatVideoDuration } from './schema';

interface VideoTileProps {
  /** The signed link, the same kind a photo is drawn from; null when storage would not sign it. */
  url: string | null;
  /** The phone's own timer; null when it said nothing. */
  durationSec: number | null;
  /** What a screen reader calls the player: which step's video this is. */
  label: string;
  /**
   * Have the files signed again: the newest link failed, and it may only have
   * expired. Settles once the read is done; a fresh link arrives as `url`.
   */
  onExpired?: () => Promise<unknown>;
}

/** Square, so a step's videos line up; the frame is fitted, never cropped. */
const SCREEN = 'aspect-square w-full rounded-md border';

/**
 * `MediaError` codes the browser's own controls recover from: a load that was
 * stopped, and a connection that dropped. Decode (3) and "not supported" (4)
 * are a file this browser cannot play — and a link that no longer opens.
 */
const RECOVERABLE_ERRORS: ReadonlySet<number> = new Set([1, 2]);

interface VideoSource {
  /** The link the player holds. */
  src: string | null;
  /** The held link has failed for good: the tile says so instead of a dead player. */
  isBroken: boolean;
  onError: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onLoadedMetadata: () => void;
}

/**
 * Which link the player holds, and when it gives up on one.
 *
 * The link it plays is the one it was first handed. The work queries sign
 * every file again on each fetch, and a focus refetch would otherwise give the
 * player a new `src` and restart it at 0:00. A link that has failed gives way
 * to any newer one the parent hands over, at once if one is already held.
 *
 * When the failed link is the newest there is — a signed link lives an hour —
 * the parent is asked to sign the files again (`onExpired`) before anything
 * is declared. Once per run of failures: every read signs anew, and a file
 * this browser cannot play (an HEVC .mov in Chrome) would otherwise fail on
 * each fresh link and ask again without end; a link that loads its metadata
 * ends the run.
 *
 * Only a file that cannot be played or opened (3, 4) is declared unavailable.
 * After a stopped load or a dropped connection (1, 2) the browser's player
 * stays, and its own controls try again.
 */
function useVideoSource(url: string | null, onExpired?: () => Promise<unknown>): VideoSource {
  const [src, setSrc] = useState(url);
  /** The last link that raised an error: any other link replaces it. */
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  /** The link that failed for good: the tile is broken while it is the one held. */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  /** A fresh link has been asked for, and none has loaded since. */
  const [hasAsked, setHasAsked] = useState(false);

  // A file signed only on a later fetch is taken up once it has a link, and a
  // link that failed gives way to the next one handed over.
  if (url !== null && url !== src && (src === null || src === erroredSrc)) {
    setSrc(url);
  }

  const onError = (event: SyntheticEvent<HTMLVideoElement>) => {
    if (src === null) {
      return;
    }
    setErroredSrc(src);
    if (url !== null && url !== src) {
      // A newer link is already held: the render takes it.
      return;
    }

    const code = event.currentTarget.error?.code ?? null;
    const isFatal = code === null || !RECOVERABLE_ERRORS.has(code);
    const failed = src;
    if (onExpired !== undefined && !hasAsked) {
      setHasAsked(true);
      void onExpired()
        .catch(() => undefined)
        .then(() => {
          if (isFatal) {
            // A failure seen meanwhile, on a fresh link, is not written over.
            setFailedSrc((current) => current ?? failed);
          }
        });
      return;
    }
    if (isFatal) {
      setFailedSrc(failed);
    }
  };

  return {
    src,
    isBroken: src !== null && src === failedSrc,
    onError,
    onLoadedMetadata: () => setHasAsked(false),
  };
}

/**
 * A video taken on a step, played where it stands.
 *
 * The browser's own controls: they take the keyboard and speak to a screen
 * reader, and a home-made play button would have to learn both. The tile is
 * wide enough for them to be pressed (16rem), and the frame is fitted rather
 * than cropped — a phone films upright. Only the metadata is loaded until the
 * manager presses play — a step list of two-minute videos must not download
 * them all to be looked at. `playsInline` keeps an iPhone from going full
 * screen on play.
 *
 * Which link it plays, and when it gives up, is `useVideoSource`'s. A video
 * it cannot show — or one storage would not sign — is a line saying so, which
 * keeps the step's name and is announced when it takes the player's place.
 *
 * A photo opens larger in a new tab, and so does a video: a player cannot sit
 * inside a link, so the link is its own line under it — under the fallback
 * too, where the browser may still play or download what it cannot show here.
 */
export function VideoTile({ url, durationSec, label, onExpired }: VideoTileProps) {
  const { t } = useTranslation();
  const video = useVideoSource(url, onExpired);

  const duration = formatVideoDuration(durationSec);
  const link = url ?? video.src;

  return (
    <figure className="flex w-64 max-w-full flex-col gap-1">
      {video.src === null || video.isBroken ? (
        <p
          role="status"
          aria-label={label}
          className={cn(
            SCREEN,
            'flex items-center justify-center p-2 text-center text-xs text-muted-foreground',
          )}
        >
          {t('panel.media.videoUnavailable')}
        </p>
      ) : (
        <video
          src={video.src}
          controls
          preload="metadata"
          playsInline
          aria-label={label}
          onError={video.onError}
          onLoadedMetadata={video.onLoadedMetadata}
          className={cn(SCREEN, 'bg-black object-contain')}
        />
      )}
      <figcaption className="flex flex-col text-xs leading-tight text-muted-foreground">
        <span>
          {duration === null
            ? t('panel.media.video')
            : t('panel.media.videoDuration', { duration })}
        </span>
        {link === null ? null : (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            aria-label={t('panel.media.openVideoLabel')}
            className="inline-flex min-h-12 min-w-12 items-center self-start underline underline-offset-2 hover:text-foreground"
          >
            {t('panel.media.openVideo')}
          </a>
        )}
      </figcaption>
    </figure>
  );
}
