'use client';

import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import type { MessageTile, MessageTileStatus } from './message-tiles';

interface MessageMediaProps {
  tiles: readonly MessageTile[];
  /** Absent on someone else's message: nothing there is hers to change. */
  onRetry?: (mediaId: string) => void;
  onRemove?: (mediaId: string, hasRow: boolean) => void;
}

/**
 * The photos inside a bubble.
 *
 * A picture where there is one; a grey square with a word where there is not
 * yet. Only a refused upload offers "try again", and only a refused or an
 * expired one offers "remove" — a photo that arrived is part of what was said.
 *
 * The state is a word, never a colour alone: a grey square that could mean
 * three different things is not a mark anybody can read.
 */
export function MessageMedia({ tiles, onRetry, onRemove }: MessageMediaProps) {
  const { t } = useTranslation();

  if (tiles.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {tiles.map((tile, index) => {
        const status = statusText(tile.status, t);
        const label = t('panel.chat.photoAlt', { index: index + 1, status });
        const canRetry = tile.canRetry && onRetry !== undefined;
        const canRemove =
          (tile.status === 'failed' || tile.status === 'expired') && onRemove !== undefined;

        return (
          <li key={tile.id} className="flex w-24 flex-col gap-1">
            {tile.url === null ? (
              <span
                role="img"
                aria-label={label}
                className="flex size-24 items-center justify-center rounded-md border bg-muted"
              />
            ) : tile.status === 'uploaded' ? (
              <a href={tile.url} target="_blank" rel="noreferrer" className="block size-24">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage links */}
                <img
                  src={tile.url}
                  alt={label}
                  className="size-24 rounded-md border object-cover"
                  loading="lazy"
                />
              </a>
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
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

function statusText(status: MessageTileStatus, t: Translate): string {
  return status === 'awaited'
    ? t('panel.chat.photoOnItsWay')
    : t(`panel.chat.photoStatus.${status}`);
}
