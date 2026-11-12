'use client';

import { Play } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { PhotoSource, type MediaSource } from './photo-source';
import { formatVideoDuration, type MediaKind } from './schema';
import { useMediaViewer } from './use-media-viewer';
import type { ViewerItem } from './viewer-item';

/** A file a list holds: a row of `task_media`, and the link its thumbnail is drawn from. */
export interface GalleryFile {
  id: string;
  storage_path: string;
  created_at: string;
  /** A report's own files carry no kind: they are photos. */
  kind?: MediaKind;
  duration_sec?: number | null;
  source?: MediaSource;
  /** The thumbnail's link; null on a video, and on a photo storage would not sign. */
  url: string | null;
}

export function toViewerItem(file: GalleryFile): ViewerItem {
  return {
    id: file.id,
    kind: file.kind ?? 'photo',
    path: file.storage_path,
    createdAt: file.created_at,
    durationSec: file.duration_sec ?? null,
  };
}

const THUMB =
  'relative flex size-24 shrink-0 cursor-zoom-in items-center justify-center overflow-hidden rounded-md border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none';

interface MediaThumbProps {
  itemId: string;
  /** What a screen reader says: «Открыть фото 3 из 8». */
  label: string;
  onOpen: (trigger: HTMLElement) => void;
  className?: string;
  children: ReactNode;
}

/** A thumbnail that opens the viewer; the viewer gives the focus back to it. */
export function MediaThumb({ itemId, label, onOpen, className, children }: MediaThumbProps) {
  return (
    <button
      type="button"
      data-media-id={itemId}
      aria-label={label}
      title={label}
      className={cn(THUMB, className)}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {children}
    </button>
  );
}

/** A photo's square: the picture from the list's link, or a word when there is none. */
export function PhotoThumbContent({ url, source }: { url: string | null; source?: MediaSource }) {
  const { t } = useTranslation();
  return (
    <>
      {url === null ? (
        <span className="p-1 text-center text-xs text-muted-foreground">
          {t('panel.media.photoUnavailable')}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage links
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      )}
      {source === undefined ? null : <PhotoSource source={source} />}
    </>
  );
}

/**
 * A video's square: its length over a play mark. Nothing of the file is
 * loaded until it is opened — a list of two-minute videos is not downloaded
 * to be looked at.
 */
export function VideoThumbContent({ durationSec }: { durationSec: number | null }) {
  const { t } = useTranslation();
  const duration = formatVideoDuration(durationSec);
  return (
    <span className="flex size-full flex-col items-center justify-center gap-1 bg-neutral-900 text-white">
      <Play aria-hidden="true" className="size-6" />
      <span className="text-xs">{duration ?? t('panel.media.video')}</span>
    </span>
  );
}

interface MediaGalleryProps {
  files: readonly GalleryFile[];
  /** What the set is — a step's name — for the viewer's title. */
  title?: string;
  className?: string;
}

/**
 * The files of a report or of a step, as thumbnails that open the viewer on
 * the whole set: «назад» and «вперёд» walk through these files and no others.
 */
export function MediaGallery({ files, title, className }: MediaGalleryProps) {
  const { t } = useTranslation();
  const items = useMemo(() => files.map(toViewerItem), [files]);
  const viewer = useMediaViewer(items, title);
  const count = files.length;

  return (
    <>
      <ul data-media-gallery="" className={cn('flex flex-wrap gap-2', className)}>
        {files.map((file, index) => {
          const isVideo = file.kind === 'video';
          return (
            <li key={file.id}>
              <MediaThumb
                itemId={file.id}
                label={t(isVideo ? 'panel.media.viewer.openVideo' : 'panel.media.viewer.openPhoto', {
                  index: index + 1,
                  count,
                })}
                onOpen={(trigger) => viewer.open(index, trigger)}
              >
                {isVideo ? (
                  <VideoThumbContent durationSec={file.duration_sec ?? null} />
                ) : (
                  <PhotoThumbContent url={file.url} source={file.source} />
                )}
              </MediaThumb>
            </li>
          );
        })}
      </ul>
      {viewer.element}
    </>
  );
}
