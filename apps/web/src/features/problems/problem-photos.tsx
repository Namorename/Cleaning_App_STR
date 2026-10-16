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
  media: readonly ShownMedia[];
  /** What to say when there is nothing to show. */
  emptyText: string;
  /** Whose video this is, for a screen reader: the step's name. */
  videoLabel?: string;
  /** Have the files signed again when a video's link fails (see `VideoTile`). */
  onExpired?: () => Promise<unknown>;
}

const TILE_PLACEHOLDER =
  'flex size-24 items-center justify-center rounded-md border p-1 text-center text-xs text-muted-foreground';

/** Thumbnails that open the full photo in a new tab; a video plays where it stands. */
export function ProblemPhotos({ media, emptyText, videoLabel, onExpired }: ProblemPhotosProps) {
  if (media.length === 0) {
    return <EmptyState>{emptyText}</EmptyState>;
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {media.map((item, index) => (
        <li key={item.id}>
          <MediaTile item={item} index={index} videoLabel={videoLabel} onExpired={onExpired} />
        </li>
      ))}
    </ul>
  );
}

interface MediaTileProps {
  item: ShownMedia;
  /** Its place in the list, for a name when nothing better is known. */
  index: number;
  videoLabel?: string;
  onExpired?: () => Promise<unknown>;
}

/**
 * One file as what it is: a video as a player — which says itself when it
 * cannot be shown — a photo as a picture that opens larger, and a photo
 * storage would not sign as a line saying so.
 */
function MediaTile({ item, index, videoLabel, onExpired }: MediaTileProps) {
  const { t } = useTranslation();

  if (item.kind === 'video') {
    return (
      <VideoTile
        url={item.url}
        durationSec={item.duration_sec ?? null}
        label={
          videoLabel === undefined
            ? `${t('panel.media.video')} ${index + 1}`
            : t('panel.media.videoOf', { step: videoLabel })
        }
        onExpired={onExpired}
      />
    );
  }
  if (item.url === null) {
    return <span className={TILE_PLACEHOLDER}>{t('panel.media.photoUnavailable')}</span>;
  }
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className="relative block size-24">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage links */}
      <img
        src={item.url}
        alt={`${t('panel.problems.detail.photos')} ${index + 1}`}
        className="size-24 rounded-md border object-cover"
        loading="lazy"
      />
      <PhotoSource source={item.source} />
    </a>
  );
}
