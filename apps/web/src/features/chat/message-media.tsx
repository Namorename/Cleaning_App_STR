'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { MediaThumb, PhotoThumbContent } from '@/features/media/media-gallery';
import { useMediaViewer } from '@/features/media/use-media-viewer';
import type { ViewerItem } from '@/features/media/viewer-item';
import { cn } from '@/lib/utils';

import type { MessageTile, MessageTileStatus } from './message-tiles';

interface MessageMediaProps {
  tiles: readonly MessageTile[];
  /** Absent on someone else's message: nothing there is hers to change. */
  onRetry?: (mediaId: string) => void;
  onRemove?: (mediaId: string, hasRow: boolean) => void;
}

/** A photo that arrived, as the viewer opens it; nothing for one that has not. */
function viewerItemOf(tile: MessageTile): ViewerItem[] {
  if (tile.status !== 'uploaded' || tile.path === null) {
    return [];
  }
  return [{ id: tile.id, kind: 'photo', path: tile.path, createdAt: tile.createdAt ?? '' }];
}

/**
 * The photos inside a bubble.
 *
 * A picture where there is one; a grey square with a word where there is not
 * yet. Only a refused upload offers "try again", and only a refused or an
 * expired one offers "remove" — a photo that arrived is part of what was said.
 * A photo that arrived opens in the panel's viewer, over the conversation,
 * which walks through the photos of this message.
 *
 * The state is a word, never a colour alone: a grey square that could mean
 * three different things is not a mark anybody can read.
 */
export function MessageMedia({ tiles, onRetry, onRemove }: MessageMediaProps) {
  const { t } = useTranslation();
  const arrived = useMemo(() => tiles.flatMap(viewerItemOf), [tiles]);
  const viewer = useMediaViewer(arrived, t('panel.media.viewer.messagePhotos'));

  if (tiles.length === 0) {
    return null;
  }

  return (
    <>
      <ul data-media-gallery="" className="flex flex-wrap gap-2">
        {tiles.map((tile, index) => {
          const status = statusText(tile.status, t);
          const label = t('panel.chat.photoAlt', { index: index + 1, status });
          const canRetry = tile.canRetry && onRetry !== undefined;
          const canRemove =
            (tile.status === 'failed' || tile.status === 'expired') &&
            tile.canRemove &&
            onRemove !== undefined;
          const place = arrived.findIndex((item) => item.id === tile.id);

          return (
            <li key={tile.id} className="flex w-24 flex-col gap-1">
              {place >= 0 ? (
                <MediaThumb
                  itemId={tile.id}
                  label={t('panel.media.viewer.openPhoto', {
                    index: place + 1,
                    count: arrived.length,
                  })}
                  onOpen={(trigger) => viewer.open(place, trigger)}
                >
                  <PhotoThumbContent url={tile.url} />
                </MediaThumb>
              ) : tile.url === null ? (
                <span
                  role="img"
                  aria-label={label}
                  className="flex size-24 items-center justify-center rounded-md border bg-muted"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- a blob: preview of the file being uploaded
                <img
                  src={tile.url}
                  alt={label}
                  className="size-24 rounded-md border object-cover opacity-60"
                />
              )}
              {tile.status === 'uploaded' ? null : (
                <span
                  className={cn(
                    'text-xs',
                    tile.status === 'failed' || tile.status === 'expired'
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  {status}
                </span>
              )}
              {canRetry ? (
                <button
                  type="button"
                  className="text-left text-xs font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => onRetry(tile.id)}
                >
                  {t('panel.chat.retryPhoto')}
                </button>
              ) : null}
              {canRemove ? (
                <button
                  type="button"
                  className="text-left text-xs font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => onRemove(tile.id, tile.hasRow)}
                >
                  {t('panel.chat.removePhoto')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {viewer.element}
    </>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

function statusText(status: MessageTileStatus, t: Translate): string {
  return status === 'awaited'
    ? t('panel.chat.photoOnItsWay')
    : t(`panel.chat.photoStatus.${status}`);
}
