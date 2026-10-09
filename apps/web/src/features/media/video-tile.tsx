'use client';

import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { formatVideoDuration } from './schema';

interface VideoTileProps {
  /** The signed link, the same kind a photo is drawn from. */
  url: string;
  /** The phone's own timer; null when it said nothing. */
  durationSec: number | null;
  /** What a screen reader calls the player: which step's video this is. */
  label: string;
  /** The square of a photo tile beside it, so a step's files line up. */
  className?: string;
}

/**
 * A video taken on a step, played where it stands.
 *
 * The browser's own controls: they take the keyboard and speak to a screen
 * reader, and a home-made play button would have to learn both. Only the
 * metadata is loaded until the manager presses play — a step list of two-minute
 * videos must not download them all to be looked at. `playsInline` keeps an
 * iPhone from going full screen on play.
 *
 * A photo opens larger in a new tab, and so does a video: a player cannot sit
 * inside a link, so the link is its own line under it.
 */
export function VideoTile({ url, durationSec, label, className }: VideoTileProps) {
  const { t } = useTranslation();
  const duration = formatVideoDuration(durationSec);

  return (
    <figure className={cn('flex flex-col gap-1', className)}>
      <video
        src={url}
        controls
        preload="metadata"
        playsInline
        aria-label={label}
        className="aspect-square w-full rounded-md border bg-black object-cover"
      />
      <figcaption className="flex flex-col text-xs leading-tight text-muted-foreground">
        <span>
          {duration === null
            ? t('panel.media.video')
            : t('panel.media.videoDuration', { duration })}
        </span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={t('panel.media.openVideoLabel')}
          className="inline-flex min-h-6 items-center self-start underline underline-offset-2 hover:text-foreground"
        >
          {t('panel.media.openVideo')}
        </a>
      </figcaption>
    </figure>
  );
}
