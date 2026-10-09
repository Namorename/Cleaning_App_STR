'use client';

import { useState } from 'react';
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
  className?: string;
}

/** Square, so a step's videos line up; the frame is fitted, never cropped. */
const SCREEN = 'aspect-square w-full rounded-md border';

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
 * The link it plays is the one it was first handed. The work queries sign
 * every file again on each fetch, and a focus refetch would otherwise give the
 * player a new `src` and restart it at 0:00. A newer link is taken only when
 * the one being played fails — it has expired; when there is no newer one,
 * or the newer one fails too (an HEVC .mov in Chrome), the tile says the video
 * is unavailable, as it does for a file storage would not sign.
 *
 * A photo opens larger in a new tab, and so does a video: a player cannot sit
 * inside a link, so the link is its own line under it — under the fallback
 * too, where the browser may still play or download what it cannot show here.
 */
export function VideoTile({ url, durationSec, label, className }: VideoTileProps) {
  const { t } = useTranslation();
  const [src, setSrc] = useState(url);
  const [isBroken, setIsBroken] = useState(false);

  // A file signed only on a later fetch is taken up once it has a link.
  if (src === null && url !== null) {
    setSrc(url);
  }

  const duration = formatVideoDuration(durationSec);
  const link = url ?? src;

  const handleError = () => {
    if (url !== null && url !== src) {
      setSrc(url);
      return;
    }
    setIsBroken(true);
  };

  return (
    <figure className={cn('flex w-64 max-w-full flex-col gap-1', className)}>
      {src === null || isBroken ? (
        <p
          className={cn(
            SCREEN,
            'flex items-center justify-center p-2 text-center text-xs text-muted-foreground',
          )}
        >
          {t('panel.media.videoUnavailable')}
        </p>
      ) : (
        <video
          src={src}
          controls
          preload="metadata"
          playsInline
          aria-label={label}
          onError={handleError}
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
