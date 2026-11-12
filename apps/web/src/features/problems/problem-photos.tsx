'use client';

import { EmptyState } from '@/components/states';
import { MediaGallery } from '@/features/media/media-gallery';
import type { MediaKind } from '@/features/media/schema';

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
  /** What the set is — the step's name — for the viewer's title. */
  title?: string;
}

/** Thumbnails that open the viewer over the page, on the report's or the step's whole set. */
export function ProblemPhotos({ media, emptyText, title }: ProblemPhotosProps) {
  if (media.length === 0) {
    return <EmptyState>{emptyText}</EmptyState>;
  }
  return <MediaGallery files={media} title={title} />;
}
