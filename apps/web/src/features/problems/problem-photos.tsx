'use client';

import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/states';
import { PhotoSource } from '@/features/media/photo-source';
import type { MediaKind } from '@/features/media/schema';
import { VideoTile } from '@/features/media/video-tile';

import type { Photo } from './api';

/**
 * A file to show. The report's own files are photos and carry no kind; a
 * repair step's files say which they are, and a video is played, not drawn.
 */
export type ShownMedia = Photo & { kind?: MediaKind; duration_sec?: number | null };

interface ProblemPhotosProps {
  photos: readonly ShownMedia[];
  /** What to say when there is nothing to show. */
  emptyText: string;
  /** Whose video this is, for a screen reader: the step's name. */
  videoLabel?: string;
}

const TILE_PLACEHOLDER =
  'flex size-24 items-center justify-center rounded-md border text-xs text-muted-foreground';

/** Thumbnails that open the full photo in a new tab; a video plays where it stands. */
export function ProblemPhotos({ photos, emptyText, videoLabel }: ProblemPhotosProps) {
  const { t } = useTranslation();

  if (photos.length === 0) {
    return <EmptyState>{emptyText}</EmptyState>;
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {photos.map((photo, index) => (
        <li key={photo.id}>
          {photo.kind === 'video' ? (
            photo.url === null ? (
              <span className={TILE_PLACEHOLDER}>{t('panel.media.videoUnavailable')}</span>
            ) : (
              <VideoTile
                url={photo.url}
                durationSec={photo.duration_sec ?? null}
                label={
                  videoLabel === undefined
                    ? `${t('panel.media.video')} ${index + 1}`
                    : t('panel.media.videoOf', { step: videoLabel })
                }
                className="w-24"
              />
            )
          ) : photo.url === null ? (
            <span className={TILE_PLACEHOLDER}>{t('problems.noPhotos')}</span>
          ) : (
            <a href={photo.url} target="_blank" rel="noreferrer" className="relative block size-24">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage links */}
              <img
                src={photo.url}
                alt={`${t('panel.problems.detail.photos')} ${index + 1}`}
                className="size-24 rounded-md border object-cover"
                loading="lazy"
              />
              <PhotoSource source={photo.source} />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
